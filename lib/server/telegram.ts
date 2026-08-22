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
    chat: { id: number };
    text?: string;
    from?: { id: number; username?: string; first_name?: string; last_name?: string };
    contact?: { phone_number: string; user_id?: number };
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
  "Bu bot orqali saytga kirasiz.",
  "Saytda «Telegram orqali kirish» tugmasini bosing — kirish havolasi shu yerga keladi.",
].join("\n");

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
 * Raqam har doim saqlanadi (keyingi safar qayta ulashish shart
 * bo'lmasin), lekin admin ekanligi HAR SAFAR `isAdminPhone` bilan
 * qayta tekshiriladi — ro'yxatdan o'chirilgan raqam avtomatik
 * huquqini yo'qotadi, saqlangan `phone` qatori o'zi hech narsani
 * bermaydi.
 *
 * Foydalanuvchi hali saytga bir marta ham kirmagan bo'lsa (bazada
 * akkaunti yo'q) — kontakt e'tiborsiz qoldiriladi: avval «Telegram
 * orqali kirish» orqali akkaunt ochilishi kerak.
 */
async function handleContact(
  chatId: number,
  fromId: number,
  contact: { phone_number: string; user_id?: number },
): Promise<void> {
  if (contact.user_id != null && contact.user_id !== fromId) {
    await sendMessage(chatId, "Faqat o'zingizning raqamingizni ulashing.");
    return;
  }
  const phone = `+${contact.phone_number.replace(/\D/g, "")}`;
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
    await handleContact(msg.chat.id, msg.from.id, msg.contact);
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

  if (!text.startsWith("/start")) {
    await sendMessage(msg.chat.id, "Kod olish uchun saytdagi «Telegram orqali kirish» tugmasini bosing.");
    return;
  }

  const nonce = text.slice("/start".length).trim();
  if (!nonce) {
    await sendMessage(msg.chat.id, WELCOME, publicSiteButton());
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
