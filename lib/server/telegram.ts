import "server-only";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { env } from "./env";
import { query, transaction } from "./db";
import { safeEqual } from "./session";
import { upsertTelegramUser, type TelegramProfile } from "./auth";
import type { SessionUser } from "./session";

/**
 * Telegram bot: kirish chiptasi va kod yetkazish.
 *
 * Ilgari OTP kodi yaratilardi, lekin uni foydalanuvchiga yuboradigan
 * kanal yo'q edi — ya'ni kirish amalda ishlamasdi. Endi kod aynan
 * foydalanuvchining Telegram chatiga boradi.
 */

const TICKET_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

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

export type Ticket = { nonce: string; url: string; expiresAt: string };

function hashCode(nonce: string, code: string): string {
  return createHmac("sha256", env.sessionSecret).update(`${nonce}:${code}`).digest("hex");
}

/** Sayt tomonda chipta ochadi va Telegram havolasini beradi. */
export async function createTicket(botUsername: string): Promise<Ticket> {
  // `start` parametri uchun faqat [A-Za-z0-9_-] ruxsat etiladi.
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
 * Bot `/start <nonce>` ni oldi: chiptani foydalanuvchiga bog'laydi,
 * kod yaratadi va shu chatga yuboradi.
 */
export async function attachTicket(nonce: string, profile: TelegramProfile): Promise<string | null> {
  const code = String(randomInt(10_000, 100_000));
  const rows = await query<{ nonce: string }>(
    `UPDATE login_tickets
        SET telegram_id = $2, username = $3, name = $4, photo_url = $5,
            code_hash = $6, attempts = 0
      WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING nonce`,
    [nonce, profile.telegramId, profile.username, profile.name, profile.photoUrl, hashCode(nonce, code)],
  );
  return rows.length ? code : null;
}

export type TicketCheck =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "pending" | "expired" | "invalid" | "attempts" };

/**
 * Foydalanuvchi kiritgan kodni tekshiradi va akkauntni ochadi.
 * Kod bir martalik: muvaffaqiyatli tekshiruvdan keyin chipta yopiladi.
 */
export async function redeemTicket(nonce: string, code: string): Promise<TicketCheck> {
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 5) return { ok: false, reason: "invalid" };

  const profile = await transaction<TelegramProfile | TicketCheck>(async (client) => {
    const res = await client.query<{
      code_hash: string | null;
      telegram_id: string | null;
      username: string | null;
      name: string | null;
      photo_url: string | null;
      attempts: number;
    }>(
      `SELECT code_hash, telegram_id, username, name, photo_url, attempts
         FROM login_tickets
        WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [nonce],
    );
    const t = res.rows[0];
    if (!t) return { ok: false as const, reason: "expired" as const };
    // Foydalanuvchi hali Telegram da Start bosmagan.
    if (!t.code_hash || !t.telegram_id) return { ok: false as const, reason: "pending" as const };
    if (t.attempts >= MAX_ATTEMPTS) {
      await client.query("UPDATE login_tickets SET consumed_at = now() WHERE nonce = $1", [nonce]);
      return { ok: false as const, reason: "attempts" as const };
    }
    if (!safeEqual(t.code_hash, hashCode(nonce, digits))) {
      await client.query("UPDATE login_tickets SET attempts = attempts + 1 WHERE nonce = $1", [nonce]);
      return { ok: false as const, reason: "invalid" as const };
    }
    await client.query("UPDATE login_tickets SET consumed_at = now() WHERE nonce = $1", [nonce]);
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
function publicSiteButton(): Record<string, unknown> {
  const url = `${env.appUrl}/uz`;
  const isPublic = /^https:\/\//.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
  if (!isPublic) return {};
  return { reply_markup: { inline_keyboard: [[{ text: "Saytni ochish", url }]] } };
}

const WELCOME = [
  "Assalomu alaykum! 👋",
  "",
  "Bu bot orqali saytga kirish kodini olasiz.",
  "Saytda «Telegram orqali kirish» tugmasini bosing — kod shu yerga keladi.",
].join("\n");

/**
 * `/start` va `/start <nonce>` ni qayta ishlaydi.
 * Boshqa xabarlarga qisqa yo'riqnoma qaytaradi.
 */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (!(await isNewUpdate(update.update_id))) return;

  const msg = update.message;
  if (!msg?.from || !msg.text) return;

  const profile: TelegramProfile = {
    telegramId: String(msg.from.id),
    username: msg.from.username ?? null,
    name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ").trim() || "Foydalanuvchi",
    photoUrl: null,
  };

  const text = msg.text.trim();
  if (!text.startsWith("/start")) {
    await sendMessage(msg.chat.id, "Kod olish uchun saytdagi «Telegram orqali kirish» tugmasini bosing.");
    return;
  }

  const nonce = text.slice("/start".length).trim();
  if (!nonce) {
    await sendMessage(msg.chat.id, WELCOME, publicSiteButton());
    return;
  }

  const code = await attachTicket(nonce, profile);
  if (!code) {
    await sendMessage(
      msg.chat.id,
      "Bu havola eskirgan. Saytga qaytib «Telegram orqali kirish» tugmasini qayta bosing.",
    );
    return;
  }

  await sendMessage(
    msg.chat.id,
    [
      `Kirish kodingiz: <b>${code}</b>`,
      "",
      "Kodni saytdagi maydonga kiriting. 5 daqiqa amal qiladi.",
      "Agar bu siz bo'lmasangiz — kodni hech kimga bermang.",
    ].join("\n"),
  );
}
