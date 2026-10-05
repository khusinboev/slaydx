import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "./env";
import { query, transaction } from "./db";

import { registerBotUser, upsertTelegramUser, type TelegramProfile } from "./auth";
import { isAdminPhone } from "./admin-phones";
import type { SessionUser } from "./session";

/**
 * Telegram bot: kirish chiptasi va kod yetkazish.
 *
 * Ilgari OTP kodi yaratilardi, lekin uni foydalanuvchiga yuboradigan
 * kanal yo'q edi — ya'ni kirish amalda ishlamasdi. Endi kod aynan
 * foydalanuvchining Telegram chatiga boradi.
 */

const TICKET_TTL_MS = 5 * 60_000;

export function botConfigured(): boolean {
  return Boolean(env.telegramBotToken);
}

function api(method: string): string {
  return `https://api.telegram.org/bot${env.telegramBotToken}/${method}`;
}

/** 429 dan keyingi yagona qayta urinishgacha eng uzoq kutish (webhook javobi kechikmasin). */
const TELEGRAM_RETRY_AFTER_CAP_S = 5;

/**
 * Telegram vaqtincha javob bermadi (tarmoq/timeout, 5xx yoki qayta
 * urinishdan keyin ham 429) — update'ni keyinroq QAYTA ishlash kerak
 * (BEA-17). Webhook buni 500 ga aylantiradi va Telegram qayta yuboradi.
 */
export class TelegramTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramTransientError";
  }
}

/** Postgres SQLSTATE: ulanish (08), resurs (53), o'chirilmoqda (57P0x), timeout (57014), poyga (40001/40P01). */
const RETRYABLE_PG = /^(08|53|57P0)|^(57014|40001|40P01)$/;
const RETRYABLE_NET = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * Update'ni keyinroq qayta ishlash foyda beradimi (review N1): faqat
 * Telegram'ning vaqtinchalik xatosi va baza ULANISH/yuklama xatolari.
 * Aniq (deterministik) xato — masalan kod nuqsoni yoki `22003` — qayta
 * yetkazishda ham takrorlanadi; unga 500 bersak Telegram uni bir necha
 * marta qayta yuborib, boshqa update'larni sekinlashtirardi.
 */
export function isRetryableUpdateError(e: unknown): boolean {
  if (e instanceof TelegramTransientError) return true;
  const code = String((e as { code?: unknown } | null)?.code ?? "");
  if (RETRYABLE_PG.test(code) || RETRYABLE_NET.has(code)) return true;
  const msg = e instanceof Error ? e.message : "";
  return /Connection terminated|timeout exceeded when trying to connect|connect ECONN/i.test(msg);
}

/** Default timeout of a JSON Bot API call. */
const JSON_TIMEOUT_MS = 15_000;
/**
 * Default timeout of a multipart upload. Stored files are capped at 25 MB
 * (`storage.ts MAX_FILE_BYTES`); from a data-centre uplink that is a few
 * seconds, so one minute leaves room for a slow Telegram edge without
 * holding the request forever.
 */
export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * Bot API outcome. `code` is Telegram's `error_code` (400, 403, 429, 5xx);
 * `0` means no usable answer: network error, timeout, a non-JSON body
 * (a proxy's HTML 502) or the bot is not configured.
 */
export type BotResult<T> = { ok: true; result: T } | { ok: false; code: number; description: string };

export type CallBotOptions = {
  /** `payload` is a `FormData` (file upload); fetch sets the multipart boundary itself. */
  multipart?: boolean;
  /** Abort after this many ms (default 15 s for JSON, `UPLOAD_TIMEOUT_MS` for multipart). */
  timeoutMs?: number;
  /** Injected for tests (default: the global `fetch`). */
  fetch?: typeof fetch;
};

/** A failure worth retrying later: no answer, rate limit or Telegram 5xx. */
export function isTransientBotFailure(r: { ok: false; code: number }): boolean {
  return r.code === 0 || r.code === 429 || r.code >= 500;
}

/**
 * Generic Bot API call (JSON or multipart) that keeps Telegram's error code.
 *
 * 429 with `parameters.retry_after` <= 5 s is retried ONCE after waiting
 * (audit EXT-05: many simultaneous `/start` must not silently lose the login
 * link); a longer wait would most likely hit 429 again, so it is returned.
 * Nothing else is retried. Never throws.
 *
 * The token lives only in the URL path; only the method and Telegram's
 * description are logged, never the URL or the body.
 */
export async function callBot<T = unknown>(
  method: string,
  payload: unknown,
  opts: CallBotOptions = {},
): Promise<BotResult<T>> {
  if (!botConfigured()) return { ok: false, code: 0, description: "bot is not configured" };
  const timeoutMs = opts.timeoutMs ?? (opts.multipart ? UPLOAD_TIMEOUT_MS : JSON_TIMEOUT_MS);
  for (let attempt = 0; attempt < 2; attempt++) {
    let data: {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    };
    try {
      const res = await (opts.fetch ?? fetch)(
        api(method),
        opts.multipart
          ? { method: "POST", body: payload as FormData, signal: AbortSignal.timeout(timeoutMs) }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(timeoutMs),
            },
      );
      // A proxy may answer 502 with HTML — a `json()` failure is a network failure too.
      data = (await res.json()) as typeof data;
    } catch (e) {
      const why = e instanceof Error ? e.message : "tarmoq xatosi";
      console.warn(`[telegram] ${method}:`, why);
      return { ok: false, code: 0, description: why };
    }
    if (!data.ok) {
      console.warn(`[telegram] ${method}:`, data.description ?? "xato");
      const after = Number(data.parameters?.retry_after);
      if (attempt === 0 && data.error_code === 429 && Number.isFinite(after) && after >= 0 && after <= TELEGRAM_RETRY_AFTER_CAP_S) {
        await new Promise((r) => setTimeout(r, after * 1000));
        continue;
      }
      return { ok: false, code: Number(data.error_code ?? 0), description: data.description ?? "" };
    }
    return { ok: true, result: data.result as T };
  }
  // Unreachable: the loop either returns or retries exactly once.
  return { ok: false, code: 429, description: "Too Many Requests" };
}

/**
 * Legacy wrapper used by `sendMessage`, `getMe`, `setBotCommands`:
 * the result or `null`.
 *
 * `throwTransient` — on a transient failure throw `TelegramTransientError`
 * instead of returning `null` (BEA-17), so the webhook answers 500 and
 * Telegram redelivers the update. A permanent error (400/403 — e.g. the
 * user blocked the bot) is still `null`: retrying it is useless.
 */
async function call<T>(
  method: string,
  payload: unknown,
  opts: { throwTransient?: boolean } = {},
): Promise<T | null> {
  if (!botConfigured()) return null;
  const r = await callBot<T>(method, payload);
  if (r.ok) return r.result ?? null;
  if (opts.throwTransient && isTransientBotFailure(r)) {
    throw new TelegramTransientError(`${method}: ${r.code ? `${r.code} ` : ""}${r.description}`.trim());
  }
  return null;
}

/**
 * Xabar yuboradi. Doimiy xatoda (`403` — bot bloklangan, `400`) `false`;
 * vaqtinchalik xatoda `TelegramTransientError` otadi — `handleUpdate`
 * update'ni «ishlangan» deb belgilamaydi va Telegram uni qayta yuboradi.
 */
export async function sendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const out = await call(
    "sendMessage",
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    },
    { throwTransient: true },
  );
  return out !== null;
}

export async function getMe(): Promise<{ id: number; username: string } | null> {
  return call<{ id: number; username: string }>("getMe", {});
}

/**
 * Bot menyusidagi buyruqlar (Telegram «/» tugmasi). Idempotent — har
 * ishga tushishda chaqirish xavfsiz. Prod webhook rejimida bo'lgani
 * uchun `scripts/bot.mts` dan tashqari `npm run bot:commands` ham bor.
 */
export async function setBotCommands(): Promise<boolean> {
  const out = await call("setMyCommands", {
    commands: [
      { command: "start", description: "Saytga kirish havolasi" },
      { command: "login", description: "Yangi kirish havolasi" },
      { command: "admin", description: "Admin sifatida tasdiqlash" },
    ],
  });
  return out !== null;
}

/* ───────────────────────── Kirish chiptasi ───────────────────────── */

function hashToken(token: string): string {
  return createHmac("sha256", env.sessionSecret).update(token).digest("hex");
}

export type Ticket = { nonce: string; url: string; expiresAt: string };

/** Login nonce bytes: `createTicket` / `createBotLoginLink` use `randomBytes(24)`. */
const NONCE_BYTES = 24;
/** base64url of `NONCE_BYTES` bytes: exactly 32 characters of `[A-Za-z0-9_-]`. */
const NONCE_RE = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((NONCE_BYTES * 4) / 3)}}$`);

/**
 * Whether a `/start` payload has the shape of a login nonce. Only such a
 * payload can be an (expired) login ticket; anything else — a future share
 * payload (`s_…`), the inline-mode button (`inline`), random text — is not
 * a login attempt and gets the welcome message instead of «eskirgan».
 */
export function isLoginNonce(payload: string): boolean {
  return NONCE_RE.test(payload);
}

export async function createTicket(botUsername: string): Promise<Ticket> {
  await purgeExpiredTickets();
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
  await query(
    "INSERT INTO login_tickets (nonce, expires_at) VALUES ($1, $2)",
    [nonce, expiresAt],
  );
  return {
    nonce,
    url: `https://t.me/${botUsername.replace(/^@/, "")}?start=${nonce}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Bot `/start <nonce>` ni oldi: chiptani foydalanuvchiga bog'laydi va
 * BIR MARTALIK KIRISH HAVOLASINI qaytaradi.
 *
 * Ilgari bu yerda 5 xonali kod yaratilardi va foydalanuvchi uni saytga
 * ko'chirib yozardi. Havola ikki sababga ko'ra yaxshiroq:
 *
 *   — Foydalanuvchi uchun: bitta bosish, ko'chirish yo'q, xato yo'q.
 *   — Xavfsizlik uchun: sessiya nonce'ni yaratgan brauzerda emas,
 *     HAVOLANI BOSGAN brauzerda ochiladi. Havola esa faqat shu
 *     Telegram chatiga boradi. Shuning uchun «o'z nonce'ini qurbonga
 *     yuborish» hujumi ishlamaydi — kod o'ynagan rolni endi havolaning
 *     yetkazilish kanali o'ynaydi.
 *
 * Token bazada faqat XESH holida turadi.
 */
export async function attachTicket(nonce: string, profile: TelegramProfile): Promise<string | null> {
  const token = randomBytes(32).toString("base64url");
  const rows = await query<{ nonce: string }>(
    `UPDATE login_tickets
        SET telegram_id = $2, username = $3, name = $4, photo_url = $5,
            token_hash = $6, attempts = 0
      WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING nonce`,
    [nonce, profile.telegramId, profile.username, profile.name, profile.photoUrl, hashToken(token)],
  );
  if (!rows.length) return null;
  return `${env.appUrl}/api/auth/telegram/enter?t=${token}`;
}

/**
 * BOTDAN BOSHLANGAN kirish: foydalanuvchi saytga kirmay, to'g'ridan-to'g'ri
 * botga `/start` (yoki `/login`) bosdi — chiptani ham, kirish havolasini
 * ham bot o'zi yaratadi.
 *
 * Xavfsizlik modeli saytdan boshlangan oqim bilan BIR XIL: token 32
 * tasodifiy bayt, bazada faqat xesh, bir martalik, 5 daqiqa; u faqat
 * shu Telegram chatiga boradi. Farq faqat nonce'ni kim yaratganida —
 * bu yerda nonce hech qachon brauzerga ko'rinmaydi.
 *
 * LEKIN (SECA-05): chat egasi HAVOLANING O'ZINI boshqaga yuborishi
 * mumkin — tajovuzkor o'z akkauntiga havola olib, qurbonga «shu yerdan
 * kiring» deydi (login-CSRF). Shuning uchun `/enter` GET darhol kirmaydi:
 * «Siz <ism> sifatida kirmoqdasiz» sahifasi va tugma (POST + Origin).
 *
 * Ikki qadam (`createTicket` + `attachTicket`) bitta INSERT ga
 * yig'ildi: oraliq «bog'lanmagan chipta» holati bu yerda kerak emas.
 */
export async function createBotLoginLink(profile: TelegramProfile): Promise<string> {
  await purgeExpiredTickets();
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  const token = randomBytes(32).toString("base64url");
  await query(
    `INSERT INTO login_tickets (nonce, expires_at, telegram_id, username, name, photo_url, token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [nonce, new Date(Date.now() + TICKET_TTL_MS), profile.telegramId, profile.username, profile.name, profile.photoUrl, hashToken(token)],
  );
  return `${env.appUrl}/api/auth/telegram/enter?t=${token}`;
}

export type TicketCheck =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "expired" | "invalid" };

/**
 * Kirish havolasidagi tokenni tekshiradi va akkauntni ochadi.
 *
 * Token bir martalik: birinchi muvaffaqiyatli tekshiruvda chipta
 * yopiladi. Havola boshqa birovga yuborilsa ham ikkinchi marta
 * ishlamaydi.
 */
export async function redeemLoginToken(token: string): Promise<TicketCheck> {
  const raw = String(token ?? "").trim();
  if (raw.length < 20 || raw.length > 200) return { ok: false, reason: "invalid" };

  const profile = await transaction<TelegramProfile | TicketCheck>(async (client) => {
    const res = await client.query<{
      nonce: string;
      telegram_id: string | null;
      username: string | null;
      name: string | null;
      photo_url: string | null;
    }>(
      `SELECT nonce, telegram_id, username, name, photo_url
         FROM login_tickets
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [hashToken(raw)],
    );
    const t = res.rows[0];
    if (!t || !t.telegram_id) return { ok: false as const, reason: "expired" as const };
    await client.query("UPDATE login_tickets SET consumed_at = now() WHERE nonce = $1", [t.nonce]);
    return {
      telegramId: String(t.telegram_id),
      username: t.username,
      name: t.name || "Foydalanuvchi",
      photoUrl: t.photo_url,
    } satisfies TelegramProfile;
  });

  if ("ok" in profile) return profile;
  return { ok: true, user: await upsertTelegramUser(profile) };
}

/**
 * Tokenni SARFLAMASDAN ko'radi: kimning akkauntiga kirilmoqda (SECA-05).
 * Tasdiqlash sahifasi uchun — sessiya faqat `redeemLoginToken` (POST) da.
 */
export async function peekLoginToken(
  token: string,
): Promise<{ telegramId: string; username: string | null; name: string } | null> {
  const raw = String(token ?? "").trim();
  if (raw.length < 20 || raw.length > 200) return null;
  const rows = await query<{ telegram_id: string; username: string | null; name: string | null }>(
    `SELECT telegram_id, username, name
       FROM login_tickets
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() AND telegram_id IS NOT NULL`,
    [hashToken(raw)],
  );
  const t = rows[0];
  if (!t) return null;
  return { telegramId: String(t.telegram_id), username: t.username, name: t.name || "Foydalanuvchi" };
}

/** Muddati o'tgan chiptalarni tozalaydi. */
export async function purgeExpiredTickets(): Promise<void> {
  await query("DELETE FROM login_tickets WHERE expires_at < now() - interval '1 hour'");
  await query("DELETE FROM telegram_updates WHERE created_at < now() - interval '1 day'");
}

/* ──────────────────────── Update ni qayta ishlash ─────────────────── */

export type TelegramUpdate = {
  update_id: number;
  message?: {
    // `type` — faqat shaxsiy chatda ("private") kontakt qabul qilinadi;
    // guruh/kanalda botga ulashilgan kontakt hech qachon "o'zining
    // raqami" bo'la olmaydi (reviewer nit — chat.type === "private").
    chat: { id: number; type?: string };
    text?: string;
    from?: { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string };
    contact?: { phone_number: string; user_id?: number };
    // Forward qilingan xabar belgilari (Bot API): SECA-01 — forward qilingan
    // kontaktni ham "o'ziniki" deb qabul qilib bo'lmaydi, hattoki uning
    // `user_id`si jo'natuvchiga teng chiqib qolgan taqdirda ham (masalan
    // odam o'z kontaktini o'ziga forward qilsa emas — bu maydonlar aynan
    // ASL jo'natuvchi haqida, joriy jo'natuvchi haqida emas).
    forward_origin?: unknown;
    forward_date?: number;
    forward_from?: { id: number };
  };
  /**
   * Inline mode (`@bot …` typed in any chat). Arrives only when inline mode
   * is enabled in @BotFather; we have no inline results, so it gets an empty
   * answer with a button that opens the Mini App (`answerStrayInlineQuery`).
   */
  inline_query?: {
    id: string;
    from: { id: number; is_bot?: boolean; username?: string; first_name?: string };
    query: string;
    offset: string;
    chat_type?: string;
  };
};

/**
 * Bir xil update ikki marta ishlanmasin (webhook takrorlashi normal holat).
 *
 * Qator — «bu update'ni men olgan/ishlaganman» belgisi: `INSERT … ON
 * CONFLICT DO NOTHING` parallel ikkinchi yetkazishni darhol to'sadi.
 * Ishlash muvaffaqiyatsiz bo'lsa `releaseUpdate` belgini O'CHIRADI
 * (BEA-17) — ya'ni qator faqat MUVAFFAQIYATLI ishlangan update uchun
 * qoladi va Telegram'ning qayta yetkazishi yana ishlanadi.
 *
 * Ma'lum bo'shliq (review N2, kam uchraydi): Telegram birinchi urinish
 * HALI ishlayotganda (15 s timeout ×2 + `retry_after` — ~35 s gacha)
 * qayta yuborsa, ikkinchisi belgini ko'rib 200 oladi; birinchisi keyin
 * yiqilib belgini o'chirsa, bu update yo'qoladi. Foydalanuvchi /login ni
 * qayta yozadi — to'liq kafolat uchun holat ustuni va lease kerak bo'lardi.
 */
async function claimUpdate(updateId: number): Promise<boolean> {
  const rows = await query<{ update_id: string }>(
    "INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id",
    [updateId],
  );
  return rows.length > 0;
}

async function releaseUpdate(updateId: number): Promise<void> {
  await query("DELETE FROM telegram_updates WHERE update_id = $1", [updateId]);
}

/** Telegram accepts only public https URLs in `url` / `web_app` buttons («Wrong HTTP URL»). */
function isPublicHttps(url: string): boolean {
  return /^https:\/\//.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

/**
 * Sayt havolasi tugmasi.
 *
 * Telegram `localhost` va boshqa ichki manzillarni tugma URL sifatida
 * qabul qilmaydi («Wrong HTTP URL»), shuning uchun lokal ishlab
 * chiqishda tugmasiz yuboramiz.
 */
function publicSiteButton(path = "/uz", label = "Saytni ochish"): Record<string, unknown> {
  const url = `${env.appUrl}${path}`;
  if (!isPublicHttps(url)) return {};
  return { reply_markup: { inline_keyboard: [[{ text: label, url }]] } };
}

const WELCOME = [
  "Assalomu alaykum! 👋",
  "",
  "SlaydX — AI yordamida slayd, referat, kurs ishi, maqola va o'qituvchi hujjatlarini yaratadi.",
  "",
  "📱 <b>Ilovada ochish</b> — SlaydX shu yerning o'zida, Telegram ichida ochiladi va siz avtomatik kirasiz.",
  "🌐 <b>Saytda ochish</b> — brauzerda ochiladi; sahifadagi «Kirish» ni tasdiqlang.",
  "Sayt havolasi <b>bir martalik</b> va 5 daqiqa amal qiladi. Yangi havola kerak bo'lsa /login yozing.",
].join("\n");

/** `/login` matni — xuddi shu ikki yo'l, qisqaroq. */
const LOGIN_TEXT = [
  "Qayerda ochishni tanlang 👇",
  "",
  "📱 <b>Ilovada ochish</b> — Telegram ichida, avtomatik kirish bilan.",
  "🌐 <b>Saytda ochish</b> — brauzerda; havola <b>bir martalik</b> va 5 daqiqa amal qiladi.",
].join("\n");

/** Mini App (Telegram ichidagi WebApp) ochiladigan sahifa. */
const WEB_APP_PATH = "/uz";

/**
 * `/start` va `/login` tugmalari — har biri o'z qatorida (telefonda yozuvlar
 * qisqarmasin): avval Mini App (`web_app`), keyin bir martalik sayt havolasi.
 *
 * Telegram `localhost` va ichki manzillarni ham `url`, ham `web_app` tugmasi
 * sifatida rad etadi («Wrong HTTP URL»; `web_app` faqat https qabul qiladi),
 * shuning uchun lokal ishlab chiqishda tugmasiz yuboramiz — `sendLoginLink`
 * havolani matnga qo'shadi.
 */
function loginButton(link: string): Record<string, unknown> {
  const app = `${env.appUrl}${WEB_APP_PATH}`;
  const isPublic = [link, app].every((u) => /^https:\/\//.test(u) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u));
  if (!isPublic) return {};
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📱 Ilovada ochish", web_app: { url: app } }],
        [{ text: "🌐 Saytda ochish", url: link }],
      ],
    },
  };
}

/**
 * Havolani yuboradi. Tugma qo'yib bo'lmasa (lokal manzil) havolaning
 * o'zi matnga qo'shiladi — aks holda dev muhitida foydalanuvchi
 * «tugmani bosing» degan xabarni tugmasiz olardi.
 */
async function sendLoginLink(chatId: number, link: string, intro: string): Promise<void> {
  const btn = loginButton(link);
  const text = "reply_markup" in btn ? intro : `${intro}\n\n${link}`;
  await sendMessage(chatId, text, btn);
}

/**
 * `/start` va `/start <nonce>` ni qayta ishlaydi.
 * Boshqa xabarlarga qisqa yo'riqnoma qaytaradi.
 */
/**
 * Foydalanuvchi botga o'z kontaktini ulashdi (`/admin` javobi).
 *
 * Faqat O'ZINING kontaktini qabul qilamiz (`contact.user_id ===
 * from.id`) — aks holda foydalanuvchi boshqa birovning vizit
 * kartochkasini ulashib, o'sha raqam nomidan admin bo'lib ololardi.
 *
 * SECA-01: Bot API'da `Contact.user_id` IXTIYORIY — u faqat Telegram
 * yuboruvchi uchun ANIQLAY OLGAN raqamlarda beriladi. Har qanday
 * vizit-kartochka yoki MTProto klient (masalan Pyrogram
 * `send_contact(phone_number=...)`) uni umuman bermaydi. Shuning uchun
 * "yo'q bo'lsa ham o'tkazib yuborish" QATʼIYAN NOTO'G'RI — faqat
 * `user_id === fromId` bo'lgan holat qabul qilinadi, aks holda (yo'q
 * yoki boshqa) rad etiladi. Forward qilingan xabar ham rad etiladi —
 * forward qilingan kontaktning `user_id`si sof "o'z" kontakti bilan
 * bir xil chiqishi mumkin, lekin xabarning o'zi jo'natuvchi tomonidan
 * TANLAB yuborilmagan bo'lishi mumkin.
 *
 * Raqam Telegram YUBORGAN holida, XOM saqlanadi (`+<raqamlar>`) —
 * hech qanday mamlakat-kodi TAXMINI YO'Q. Ilgari 9 xonali qiymat "998"
 * bilan kengaytirilardi ("milliy format" deb taxmin qilib), lekin bu
 * ikki jihatdan xato edi: (1) o'zining kontaktini ulashgan foydalanuvchi
 * 9 xonali raqam yuborsa (masalan +299/+298/+376 kabi qisqa xalqaro
 * raqamlar), uning haqiqiy raqami BUZILARDI; (2) xuddi shu kengaytirish
 * tasodifan yoki ataylab admin raqamining ko'rinishini hosil qilishi
 * mumkin edi. Telegram o'zining kontaktini ulashganda HAR DOIM to'liq
 * xalqaro raqamni (mamlakat kodi bilan) beradi — taxmin qilish shart
 * emas. Shubhali uzunlik (E.164 diapazonidan tashqari, 7–15 raqamdan
 * kam/ko'p) rad etiladi — bunday qiymat haqiqiy telefon bo'la olmaydi.
 *
 * Admin ekanligi HAR SAFAR `isAdminPhone` bilan qayta tekshiriladi —
 * ro'yxatdan o'chirilgan raqam avtomatik huquqini yo'qotadi, saqlangan
 * `phone` qatori o'zi hech narsani bermaydi. `isAdminPhone` QATʼIY
 * (kengaytirishsiz, aniq raqamlar) taqqoslaydi.
 *
 * Faqat SHAXSIY chatda qabul qilinadi (`chat.type === "private"`) —
 * guruh/kanalda ulashilgan kontakt bot uchun "o'zining raqami" bo'la
 * olmaydi.
 *
 * Foydalanuvchi hali saytga bir marta ham kirmagan bo'lsa (bazada
 * akkaunti yo'q) — kontakt e'tiborsiz qoldiriladi: avval «Telegram
 * orqali kirish» orqali akkaunt ochilishi kerak.
 */
async function handleContact(
  chatId: number,
  fromId: number,
  contact: { phone_number: string; user_id?: number },
  forwarded: boolean,
  isPrivateChat: boolean,
): Promise<void> {
  if (forwarded || contact.user_id !== fromId || !isPrivateChat) {
    await sendMessage(chatId, "Faqat o'zingizning raqamingizni ulashing.");
    return;
  }
  const digits = contact.phone_number.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    await sendMessage(chatId, "Faqat o'zingizning raqamingizni ulashing.");
    return;
  }
  const phone = `+${digits}`;
  let updated: { id: string }[];
  try {
    updated = await query<{ id: string }>(
      "UPDATE users SET phone = $2, updated_at = now() WHERE telegram_id = $1 RETURNING id",
      [String(fromId), phone],
    );
  } catch (e) {
    // `users_phone_key` — bu raqam allaqachon BOSHQA akkauntga bog'langan
    // (masalan, avval boshqa Telegram akkaunt bilan ulashilgan). Xato
    // yutilib jim qolmasin — foydalanuvchi nima bo'lganini bilishi kerak.
    const msg = e instanceof Error ? e.message : "";
    if (/users_phone_key/.test(msg)) {
      await sendMessage(chatId, "Bu raqam allaqachon boshqa akkauntga bog'langan.");
      return;
    }
    throw e;
  }
  if (!updated.length) {
    await sendMessage(
      chatId,
      "Avval saytga «Telegram orqali kirish» orqali bir marta kiring, keyin qaytadan /admin bosing.",
    );
    return;
  }
  if (isAdminPhone(phone)) {
    await sendMessage(chatId, "✅ Admin sifatida tasdiqlandingiz.", publicSiteButton("/uz/admin", "🛠 Admin panel"));
  } else {
    await sendMessage(chatId, "Bu raqam admin ro'yxatida yo'q.");
  }
}

/**
 * Update'ni bir marta ishlaydi (ko'pi bilan bir muvaffaqiyatli marta).
 *
 * BEA-17 / EXT-05: ilgari id ishlashdan OLDIN yozilib qolardi va webhook
 * har xatoni yutib 200 qaytarardi — Telegram 429/5xx, tarmoq yoki baza
 * xatosida kirish havolasi jimgina yo'qolar, qayta yetkazish esa
 * «takror» deb tashlanardi. Endi xatoda belgi olib tashlanadi va xato
 * yuqoriga otiladi: webhook 500 qaytaradi, Telegram qayta yuboradi.
 * Qayta ishlash xavfsiz: `/login`/`/start` yangi chipta/token yaratadi
 * (eskisi yetkazilmagan va 5 daqiqada eskiradi), kontakt UPDATE —
 * idempotent.
 */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (!(await claimUpdate(update.update_id))) return;
  try {
    await processUpdate(update);
  } catch (e) {
    try {
      await releaseUpdate(update.update_id);
    } catch (releaseErr) {
      // Belgi qolib ketdi — bu update endi qayta ishlanmaydi; jurnalda ko'rinsin.
      console.error(
        `[telegram] update ${update.update_id} belgisi o'chirilmadi:`,
        releaseErr instanceof Error ? releaseErr.message : releaseErr,
      );
    }
    throw e;
  }
}

/** `/start` payload of the inline-mode button when no public Mini App URL exists (local dev). */
const INLINE_START_PARAMETER = "inline";

/**
 * Empty answer to an inline query, so the user's Telegram client does not spin.
 * The button opens the Mini App (`web_app`) on a public https deployment; on a
 * local one (Telegram rejects such URLs) it opens the bot chat with
 * `/start inline`, which gets the welcome message. Not retried: an inline
 * query expires within seconds, a late answer is useless.
 */
async function answerStrayInlineQuery(inlineQueryId: string): Promise<void> {
  const app = `${env.appUrl}${WEB_APP_PATH}`;
  const button = isPublicHttps(app)
    ? { text: "SlaydX'ni ochish", web_app: { url: app } }
    : { text: "SlaydX'ni ochish", start_parameter: INLINE_START_PARAMETER };
  await callBot("answerInlineQuery", {
    inline_query_id: inlineQueryId,
    results: [],
    cache_time: 300,
    is_personal: false,
    button,
  });
}

async function processUpdate(update: TelegramUpdate): Promise<void> {
  if (update.inline_query) {
    await answerStrayInlineQuery(update.inline_query.id);
    return;
  }
  const msg = update.message;
  if (!msg?.from) return;

  if (msg.contact) {
    const forwarded = msg.forward_origin != null || msg.forward_date != null || msg.forward_from != null;
    const isPrivateChat = msg.chat.type === "private";
    await handleContact(msg.chat.id, msg.from.id, msg.contact, forwarded, isPrivateChat);
    return;
  }
  if (!msg.text) return;

  const profile: TelegramProfile = {
    telegramId: String(msg.from.id),
    username: msg.from.username ?? null,
    name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ").trim() || "Foydalanuvchi",
    photoUrl: null,
  };

  // Botga shaxsiy chatda yozgan har bir odam (avvalo `/start`) darhol
  // bazaga yoziladi — saytga kirmagan bo'lsa ham admin panelda ko'rinadi.
  if (msg.chat.type === "private" && !msg.from.is_bot) {
    await registerBotUser(profile);
  }

  const text = msg.text.trim();

  if (text.startsWith("/admin")) {
    await sendMessage(
      msg.chat.id,
      "Admin sifatida tasdiqlash uchun raqamingizni ulashing.",
      {
        reply_markup: {
          keyboard: [[{ text: "📱 Raqamni ulashish", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
    );
    return;
  }

  // `/login` — qayta havola (masalan, oldingisi eskirgan bo'lsa).
  if (text.startsWith("/login")) {
    await sendLoginLink(msg.chat.id, await createBotLoginLink(profile), LOGIN_TEXT);
    return;
  }

  if (!text.startsWith("/start")) {
    await sendMessage(msg.chat.id, "Saytga kirish uchun /login yozing yoki saytdagi «Telegram orqali kirish» tugmasini bosing.");
    return;
  }

  const nonce = text.slice("/start".length).trim();
  if (!isLoginNonce(nonce)) {
    // Oddiy /start — foydalanuvchi botga saytdan emas, to'g'ridan-to'g'ri
    // keldi. Uni saytga «bor va u yerdan qayta kel» deb yubormaymiz:
    // kirish havolasini shu yerning o'zida beramiz.
    // A payload that is not nonce-shaped (a share/inline deep link, random
    // text) is not a login attempt either: welcome, never «eskirgan».
    await sendLoginLink(msg.chat.id, await createBotLoginLink(profile), WELCOME);
    return;
  }

  const link = await attachTicket(nonce, profile);
  if (!link) {
    await sendMessage(
      msg.chat.id,
      "Bu havola eskirgan. Saytga qaytib «Telegram orqali kirish» tugmasini qayta bosing.",
    );
    return;
  }

  await sendMessage(
    msg.chat.id,
    [
      "Kirish uchun quyidagi tugmani bosing 👇",
      "",
      "Havola <b>bir martalik</b> va 5 daqiqa amal qiladi.",
      "Agar bu siz bo'lmasangiz — havolani hech kimga yubormang.",
    ].join("\n"),
    { reply_markup: { inline_keyboard: [[{ text: "🔑 Saytga kirish", url: link }]] } },
  );
}
