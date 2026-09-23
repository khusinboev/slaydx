import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "./env";
import { query, transaction } from "./db";

import { upsertTelegramUser, type TelegramProfile } from "./auth";
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

async function call<T>(method: string, payload: unknown): Promise<T | null> {
  if (!botConfigured()) return null;
  try {
    const res = await fetch(api(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      console.warn(`[telegram] ${method}:`, data.description ?? "xato");
      return null;
    }
    return data.result ?? null;
  } catch (e) {
    console.warn(`[telegram] ${method}:`, e instanceof Error ? e.message : "tarmoq xatosi");
    return null;
  }
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const out = await call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
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

export async function createTicket(botUsername: string): Promise<Ticket> {
  await purgeExpiredTickets();
  const nonce = randomBytes(24).toString("base64url");
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
 * bu yerda nonce hech qachon brauzerga ko'rinmaydi, shuning uchun
 * «o'z nonce'ini qurbonga yuborish» hujumi bu oqimda umuman yo'q.
 *
 * Ikki qadam (`createTicket` + `attachTicket`) bitta INSERT ga
 * yig'ildi: oraliq «bog'lanmagan chipta» holati bu yerda kerak emas.
 */
export async function createBotLoginLink(profile: TelegramProfile): Promise<string> {
  await purgeExpiredTickets();
  const nonce = randomBytes(24).toString("base64url");
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
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
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
};

/** Bir xil update ikki marta kelmasin (webhook takrorlashi normal holat). */
async function isNewUpdate(updateId: number): Promise<boolean> {
  const rows = await query<{ update_id: string }>(
    "INSERT INTO telegram_updates (update_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING update_id",
    [updateId],
  );
  return rows.length > 0;
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
  const isPublic = /^https:\/\//.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
  if (!isPublic) return {};
  return { reply_markup: { inline_keyboard: [[{ text: label, url }]] } };
}

const WELCOME = [
  "Assalomu alaykum! 👋",
  "",
  "SlaydX — AI yordamida slayd, referat, kurs ishi, maqola va o'qituvchi hujjatlarini yaratadi.",
  "",
  "Saytga kirish uchun quyidagi tugmani bosing — akkauntingiz avtomatik ochiladi.",
  "Havola <b>bir martalik</b> va 5 daqiqa amal qiladi. Yangi havola kerak bo'lsa /login yozing.",
].join("\n");

/** Kirish havolasi tugmasi — Telegram `localhost` URL ni rad etadi, shunda havola matnda ketadi. */
function loginButton(link: string, label = "🔑 Saytga kirish"): Record<string, unknown> {
  const isPublic = /^https:\/\//.test(link) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(link);
  if (!isPublic) return {};
  return { reply_markup: { inline_keyboard: [[{ text: label, url: link }]] } };
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

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (!(await isNewUpdate(update.update_id))) return;

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
    await sendLoginLink(msg.chat.id, await createBotLoginLink(profile), "Kirish uchun quyidagi tugmani bosing 👇\n\nHavola <b>bir martalik</b> va 5 daqiqa amal qiladi.");
    return;
  }

  if (!text.startsWith("/start")) {
    await sendMessage(msg.chat.id, "Saytga kirish uchun /login yozing yoki saytdagi «Telegram orqali kirish» tugmasini bosing.");
    return;
  }

  const nonce = text.slice("/start".length).trim();
  if (!nonce) {
    // Oddiy /start — foydalanuvchi botga saytdan emas, to'g'ridan-to'g'ri
    // keldi. Uni saytga «bor va u yerdan qayta kel» deb yubormaymiz:
    // kirish havolasini shu yerning o'zida beramiz.
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
