import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "./env";
import { query, transaction } from "./db";

import { registerBotUser, upsertTelegramUser, type TelegramProfile } from "./auth";
import { isAdminPhone } from "./admin-phones";
import type { SessionUser } from "./session";
import { normalizeRefCode, refCodeFromStartPayload, REFERRAL_REWARD_POINTS } from "../referral";
import type { ReferralClaim } from "./referrals";
import { inlineButton, tgEmoji, type Screen } from "./bot/ui";
import { langFromTelegram, langOf, t, LANGS, type Lang } from "./bot/i18n";
import { mainKeyboard } from "./bot/keyboard";
import { loginScreen, welcomeScreen } from "./bot/screens";

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

/** A failed / empty `getMe` is retried at most this often (review MINOR-5). */
const BOT_USERNAME_RETRY_MS = 60_000;

/**
 * `getMe` result: a username is kept for the process (it does not change at
 * run time); `null` (Telegram down, wrong token) only until `at + 60 s`, so a
 * missing env does not turn every `GET /api/referral` and `/taklif` into a
 * Bot API call. `pending` lets concurrent callers share one request.
 */
let botUsernameCache: { value: string | null; at: number } | null = null;
let botUsernamePending: Promise<string | null> | null = null;

/**
 * The bot's username for deep links (`t.me/<bot>?start=…`): the configured
 * `NEXT_PUBLIC_TELEGRAM_BOT`, else `getMe` (cached as above). `null` when
 * neither is available (local run without a bot). `now` — test clock.
 */
export async function botUsername(now: number = Date.now()): Promise<string | null> {
  const configured = env.telegramBotUsername.trim().replace(/^@/, "");
  if (configured) return configured;
  if (!botConfigured()) return null;
  const c = botUsernameCache;
  if (c && (c.value !== null || now - c.at < BOT_USERNAME_RETRY_MS)) return c.value;
  botUsernamePending ??= getMe()
    .catch(() => null)
    .then((me) => {
      const value = me?.username ? me.username.replace(/^@/, "") : null;
      botUsernameCache = { value, at: now };
      return value;
    })
    .finally(() => {
      botUsernamePending = null;
    });
  return botUsernamePending;
}

/** The bot's commands, in menu order. */
export const BOT_COMMANDS = ["start", "login", "taklif", "admin", "til"] as const;

/**
 * Bot menyusidagi buyruqlar (Telegram «/» tugmasi). Idempotent — har
 * ishga tushishda chaqirish xavfsiz. Prod webhook rejimida bo'lgani
 * uchun `scripts/bot.mts` dan tashqari `npm run bot:commands` ham bor.
 *
 * B2: the default list is Uzbek; Russian and English clients get their own
 * descriptions (`language_code` scopes of `setMyCommands`).
 */
export async function setBotCommands(): Promise<boolean> {
  let ok = true;
  for (const lang of LANGS) {
    const out = await call("setMyCommands", {
      commands: BOT_COMMANDS.map((command) => ({ command, description: t(lang, `cmd.${command}`) })),
      ...(lang === "uz" ? {} : { language_code: lang }),
    });
    ok &&= out !== null;
  }
  return ok;
}

/**
 * The chat menu button («Ilova») → the Mini App home. The menu button carries
 * initData, so the plain app URL logs the user in silently (no link token).
 * `false` without a public https app URL (Telegram rejects it) or on failure.
 */
export async function setMenuButton(): Promise<boolean> {
  const url = `${env.appUrl.replace(/\/$/, "")}/uz`;
  if (!isPublicHttps(url)) return false;
  const out = await call("setChatMenuButton", {
    menu_button: { type: "web_app", text: t("uz", "menu.app"), web_app: { url } },
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

/**
 * Site-started login ticket. `refCode` — the invite code this browser captured
 * (`/uz?ref=…` cookie): the account is CREATED by the bot's `/start <nonce>`
 * (`registerBotUser`), which has no access to the browser, so the ticket
 * carries the code there.
 */
export async function createTicket(botUsername: string, refCode: string | null = null): Promise<Ticket> {
  await purgeExpiredTickets();
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
  await query(
    "INSERT INTO login_tickets (nonce, expires_at, ref_code) VALUES ($1, $2, $3)",
    [nonce, expiresAt, normalizeRefCode(refCode)],
  );
  return {
    nonce,
    url: `https://t.me/${botUsername.replace(/^@/, "")}?start=${nonce}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** The invite code a live site ticket carries (`/start <nonce>` before the account exists). */
async function ticketReferral(nonce: string): Promise<ReferralClaim | null> {
  const rows = await query<{ ref_code: string | null }>(
    "SELECT ref_code FROM login_tickets WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()",
    [nonce],
  );
  const code = normalizeRefCode(rows[0]?.ref_code);
  return code ? { code, source: "web" } : null;
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

  const ticket = await transaction<{ profile: TelegramProfile; refCode: string | null } | TicketCheck>(async (client) => {
    const res = await client.query<{
      nonce: string;
      telegram_id: string | null;
      username: string | null;
      name: string | null;
      photo_url: string | null;
      ref_code: string | null;
    }>(
      `SELECT nonce, telegram_id, username, name, photo_url, ref_code
         FROM login_tickets
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [hashToken(raw)],
    );
    const t = res.rows[0];
    if (!t || !t.telegram_id) return { ok: false as const, reason: "expired" as const };
    await client.query("UPDATE login_tickets SET consumed_at = now() WHERE nonce = $1", [t.nonce]);
    return {
      profile: {
        telegramId: String(t.telegram_id),
        username: t.username,
        name: t.name || "Foydalanuvchi",
        photoUrl: t.photo_url,
      } satisfies TelegramProfile,
      refCode: t.ref_code,
    };
  });

  if ("ok" in ticket) return ticket;
  // Normally the bot's `/start <nonce>` already created the account (and applied
  // the code there); this only matters if that did not happen.
  const code = normalizeRefCode(ticket.refCode);
  return { ok: true, user: await upsertTelegramUser(ticket.profile, code ? { code, source: "web" } : null) };
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
    message_id?: number;
    chat: { id: number; type?: string };
    text?: string;
    from?: { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string; language_code?: string };
    contact?: { phone_number: string; user_id?: number };
    // Forward qilingan xabar belgilari (Bot API): SECA-01 — forward qilingan
    // kontaktni ham "o'ziniki" deb qabul qilib bo'lmaydi, hattoki uning
    // `user_id`si jo'natuvchiga teng chiqib qolgan taqdirda ham (masalan
    // odam o'z kontaktini o'ziga forward qilsa emas — bu maydonlar aynan
    // ASL jo'natuvchi haqida, joriy jo'natuvchi haqida emas).
    forward_origin?: unknown;
    forward_date?: number;
    forward_from?: { id: number };
    // Admin panel input (docs/bot-admin/PLAN.md): a broadcast message as the admin sent it.
    caption?: string;
    entities?: unknown[];
    caption_entities?: unknown[];
    photo?: Array<{ file_id: string; width?: number; height?: number; file_size?: number }>;
    video?: { file_id: string };
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
  /**
   * An inline button tap (bot screens, `bot/router.ts handleCallback`). Always
   * answered with `answerCallbackQuery`; only the private chat's own user may
   * use its buttons. The webhook's `allowed_updates` must include it.
   */
  callback_query?: {
    id: string;
    from: { id: number; is_bot?: boolean };
    message?: { message_id: number; chat: { id: number; type?: string } };
    data?: string;
  };
  /**
   * A member's status changed in a chat where the bot is an admin (bonus channels: joining
   * pays the join bonus, `recordChannelJoin` — the only reply is that user's «+N so‘m» notice;
   * leaving before day N forfeits the stay bonus, `recordChannelLeave`). Sent only
   * when `allowed_updates` names it explicitly (webhook and `scripts/bot.mts`). No reply.
   */
  chat_member?: {
    chat: { id: number; type?: string; title?: string };
    from?: { id: number; is_bot?: boolean };
    date?: number;
    old_chat_member?: { status?: string; is_member?: boolean; user?: { id: number; is_bot?: boolean } };
    new_chat_member?: { status?: string; is_member?: boolean; user?: { id: number; is_bot?: boolean } };
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
function publicSiteButton(path: string, label: string): Record<string, unknown> {
  const url = `${env.appUrl}${path}`;
  if (!isPublicHttps(url)) return {};
  return { reply_markup: { inline_keyboard: [[inlineButton("admin", label, { url })]] } };
}

/** Mini App (Telegram ichidagi WebApp) ochiladigan sahifa. */
const WEB_APP_PATH = "/uz";

/** A rendered screen as `sendMessage` extras. */
function markupOf(screen: Screen): Record<string, unknown> {
  return screen.reply_markup ? { reply_markup: screen.reply_markup } : {};
}

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
 *
 * Bot UI (B2): `/admin` ning bir martalik kontakt klaviaturasi yopilgach
 * asosiy klaviatura qaytadi — matnli javoblarga `keyboard` (ma'lum
 * foydalanuvchi, shaxsiy chat) shu xabarning o'ziga qo'shiladi; inline
 * tugmali «Admin panel» javobidan keyin esa alohida xabar bilan.
 */
async function handleContact(
  chatId: number,
  fromId: number,
  contact: { phone_number: string; user_id?: number },
  forwarded: boolean,
  isPrivateChat: boolean,
  lang: Lang,
  keyboard: Record<string, unknown> | null,
): Promise<boolean> {
  const kb = keyboard ? { reply_markup: keyboard } : {};
  if (forwarded || contact.user_id !== fromId || !isPrivateChat) {
    await sendMessage(chatId, t(lang, "contact.onlyOwn"), kb);
    return Boolean(keyboard);
  }
  const digits = contact.phone_number.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    await sendMessage(chatId, t(lang, "contact.onlyOwn"), kb);
    return Boolean(keyboard);
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
      await sendMessage(chatId, t(lang, "contact.taken"), kb);
      return Boolean(keyboard);
    }
    throw e;
  }
  if (!updated.length) {
    await sendMessage(chatId, t(lang, "contact.noAccount"), kb);
    return Boolean(keyboard);
  }
  if (isAdminPhone(phone)) {
    await sendMessage(chatId, t(lang, "contact.admin"), publicSiteButton("/uz/admin", t(lang, "btn.adminPanel")));
    if (keyboard) await sendMessage(chatId, keyboardNote(lang), kb);
  } else {
    await sendMessage(chatId, t(lang, "contact.notAdmin"), kb);
  }
  return Boolean(keyboard);
}

/** The short text that carries a re-sent main keyboard. */
function keyboardNote(lang: Lang): string {
  return `${tgEmoji("pointDown")} ${t(lang, "kb.note")}`;
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
 * idempotent; bot ekranlari (`bot/router.ts`) tahrirlash va update id
 * bo'yicha band qilingan kutilayotgan qiymat bilan qayta ishlashga chidamli.
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

/**
 * Inline query. `f_<generation>_<format>` (typed by the «📤 Ulashish» button
 * under a saved file, `telegram-files.ts shareQuery`) answers with that file
 * for its owner only — personal, never cached by Telegram, empty for anyone
 * else. Anything else gets the default empty answer.
 */
async function answerInlineQuery(q: NonNullable<TelegramUpdate["inline_query"]>): Promise<void> {
  // Loaded lazily: the file module pulls in the download producers, which the
  // login/contact paths of the webhook never need.
  const { inlineFileResults } = await import("./telegram-files");
  const results = await inlineFileResults(q.query ?? "", q.from?.id);
  if (results === null) {
    await answerStrayInlineQuery(q.id);
    return;
  }
  await callBot("answerInlineQuery", { inline_query_id: q.id, results, cache_time: 0, is_personal: true });
}

/**
 * The invite a `/start` payload claims: `ref_<code>` (bot link), or a login
 * nonce whose site ticket carries a captured web code. Anything else: none.
 */
async function startReferral(payload: string): Promise<ReferralClaim | null> {
  const code = refCodeFromStartPayload(payload);
  if (code) return { code, source: "bot" };
  return isLoginNonce(payload) ? ticketReferral(payload) : null;
}

/**
 * The private-chat user for a message: an existing account is read as is;
 * the account is (re)written by `registerBotUser` only when it does not exist
 * yet or on `/start` (B2). Before, EVERY message re-ran the upsert, which
 * overwrote `users.name` with the Telegram name — a «Ism» saved in the bot's
 * Profilim would have been reverted by the very next message.
 * A NEW account gets the bot language from Telegram's `language_code`
 * (ru → ru, en → en, else uz) — only at creation, never later.
 */
async function botUser(
  profile: TelegramProfile,
  languageCode: string | undefined,
  startPayload: string | null,
  findUser: (telegramId: number) => Promise<SessionUser | null>,
): Promise<SessionUser> {
  const existing = await findUser(Number(profile.telegramId));
  if (existing && startPayload === null) return existing;
  const me = await registerBotUser(profile, startPayload === null ? null : await startReferral(startPayload));
  if (existing) return me;
  const lang = langFromTelegram(languageCode);
  if (lang === "uz") return me;
  await query("UPDATE users SET language = $2 WHERE id = $1 AND language = 'uz'", [me.id, lang]);
  return { ...me, language: lang };
}

async function processUpdate(update: TelegramUpdate): Promise<void> {
  if (update.chat_member) {
    // Loaded lazily. A leave forfeits the unpaid stay bonus; a join pays the join bonus at once
    // (B2-Q2, `recordChannelJoin` never throws). Other changes need no database round trip.
    const cm = update.chat_member;
    const bonus = await import("./bonus-channels");
    if (bonus.isLeaveStatus(cm.new_chat_member)) await bonus.recordChannelLeave(cm);
    else if (bonus.isJoinStatus(cm.new_chat_member)) await bonus.recordChannelJoin(cm);
    return;
  }
  if (update.inline_query) {
    await answerInlineQuery(update.inline_query);
    return;
  }
  if (update.callback_query) {
    // Loaded lazily (like telegram-files): the screens pull in referrals/credits/jobs.
    const bot = await import("./bot/router");
    await bot.handleCallback(update.callback_query, update.update_id);
    return;
  }
  const msg = update.message;
  if (!msg?.from) return;
  // m2: the update was parsed as JSON numbers; an id above 2^53 is already rounded to a
  // DIFFERENT id (it could match another user's `telegram_id`). Never act on it.
  if (!Number.isSafeInteger(msg.from.id) || !Number.isSafeInteger(msg.chat.id)) {
    console.warn(`[telegram] update ${update.update_id}: unsafe integer id ignored`);
    return;
  }
  const isPrivate = msg.chat.type === "private" && !msg.from.is_bot;
  const bot = await import("./bot/router");

  if (msg.contact) {
    const forwarded = msg.forward_origin != null || msg.forward_date != null || msg.forward_from != null;
    const known = isPrivate ? await bot.userByTelegram(msg.from.id) : null;
    const lang = langOf(known?.language);
    const { isLinkedAdmin } = await import("./bot/admin-access");
    const keyboard = known ? mainKeyboard(lang, msg.from.id, undefined, { admin: await isLinkedAdmin(msg.from.id) }) : null;
    const sent = await handleContact(msg.chat.id, msg.from.id, msg.contact, forwarded, msg.chat.type === "private", lang, keyboard);
    if (sent && known) await bot.markKeyboardSent(msg.chat.id, known.id);
    return;
  }
  // An admin panel step waiting for input (a broadcast text / photo / video, a button, a channel
  // forward or @username, a step-up code). The admin account is re-checked inside.
  if (isPrivate) {
    const adminBot = await import("./bot/admin");
    if (await adminBot.handleAdminInput(msg, update.update_id)) return;
  }
  if (!msg.text) return;

  const profile: TelegramProfile = {
    telegramId: String(msg.from.id),
    username: msg.from.username ?? null,
    name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ").trim() || "Foydalanuvchi",
    photoUrl: null,
  };

  const text = msg.text.trim();
  if (isPrivate && (await bot.isBlockedTelegram(msg.from.id))) {
    const known = await bot.userByTelegram(msg.from.id);
    await sendMessage(msg.chat.id, t(langOf(known?.language), "account.blocked"), { reply_markup: { remove_keyboard: true } });
    return;
  }
  // `/start` and `/login` build a personal site login link: never in a group chat.
  if (msg.chat.type != null && msg.chat.type !== "private" && (text.startsWith("/start") || text.startsWith("/login"))) {
    await sendMessage(msg.chat.id, t("uz", "private.only"));
    return;
  }
  // `/start <payload>` — `/startfoo` keeps the historical «payload foo» reading.
  const startPayload = text.startsWith("/start") ? text.slice("/start".length).trim() : null;

  // Botga shaxsiy chatda yozgan har bir odam (avvalo `/start`) darhol
  // bazaga yoziladi — saytga kirmagan bo'lsa ham admin panelda ko'rinadi.
  // Invite (T3): `/start ref_<code>`, or a site ticket that carries the code the
  // browser captured. It counts only if THIS message creates the account.
  const me: SessionUser | null = isPrivate ? await botUser(profile, msg.from.language_code, startPayload, bot.userByTelegram) : null;
  const lang = langOf(me?.language);
  const ctx = me ? { chatId: msg.chat.id, telegramId: msg.from.id, lang, user: me } : null;

  if (ctx) {
    if (text.startsWith("/")) {
      // A command always wins over a pending «Kafedra nomini yozing».
      await bot.cancelPending(ctx.chatId);
    } else {
      // «🛠 Admin» (only linked admins have the button; anyone else's text falls through as usual).
      const adminBot = await import("./bot/admin");
      if (adminBot.isAdminButtonText(text) && (await adminBot.openPanel(ctx.chatId, ctx.telegramId))) return;
      const action = bot.matchKeyboard(text);
      if (action) {
        await bot.handleKeyboard(ctx, action);
        return;
      }
      if (await bot.handlePendingInput(ctx, msg.text, update.update_id)) return;
    }
  }

  if (text.startsWith("/taklif")) {
    if (!me) {
      await sendMessage(msg.chat.id, t(lang, "ref.groupOnly"));
      return;
    }
    await bot.sendReferral(msg.chat.id, me, lang);
    return;
  }

  if (text.startsWith("/til") && ctx) {
    await bot.sendLanguageMenu(ctx);
    return;
  }

  if (text.startsWith("/admin")) {
    // A linked admin gets the panel (and the keyboard with its «🛠 Admin» row); anyone else keeps the contact flow.
    if (ctx) {
      const adminBot = await import("./bot/admin");
      if (await adminBot.openPanel(ctx.chatId, ctx.telegramId)) {
        await bot.sendMainKeyboard(ctx, "refreshed");
        return;
      }
    }
    await sendMessage(msg.chat.id, t(lang, "admin.ask"), {
      reply_markup: {
        keyboard: [[{ text: `📱 ${t(lang, "admin.shareButton")}`, request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }

  // `/login` — qayta havola (masalan, oldingisi eskirgan bo'lsa).
  if (text.startsWith("/login")) {
    const screen = loginScreen(lang, await createBotLoginLink(profile));
    await sendMessage(msg.chat.id, screen.text, markupOf(screen));
    return;
  }

  if (!text.startsWith("/start")) {
    await sendMessage(msg.chat.id, t(lang, "fallback"));
    return;
  }

  const nonce = startPayload ?? "";
  if (!isLoginNonce(nonce)) {
    // Oddiy /start — foydalanuvchi botga saytdan emas, to'g'ridan-to'g'ri
    // keldi. Uni saytga «bor va u yerdan qayta kel» deb yubormaymiz:
    // kirish havolasini shu yerning o'zida beramiz.
    // A payload that is not nonce-shaped (a share/inline deep link, an invite
    // `ref_<code>` — already applied above —, random text) is not a login
    // attempt either: welcome, never «eskirgan».
    // B2: the welcome card (inline buttons) + the persistent main keyboard in a
    // second message (one message holds one reply_markup); the keyboard's
    // personal links are refreshed by every /start.
    const screen = welcomeScreen(lang, { user: me, loginLink: await createBotLoginLink(profile), rewardPoints: REFERRAL_REWARD_POINTS });
    await sendMessage(msg.chat.id, screen.text, markupOf(screen));
    if (ctx) await bot.sendMainKeyboard(ctx, "note");
    return;
  }

  const link = await attachTicket(nonce, profile);
  if (!link) {
    await sendMessage(msg.chat.id, t(lang, "ticket.expired"));
    return;
  }

  await sendMessage(msg.chat.id, t(lang, "ticket.text"), {
    reply_markup: { inline_keyboard: [[inlineButton("key", t(lang, "ticket.button"), { url: link })]] },
  });
}
