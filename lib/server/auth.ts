import "server-only";
import { createHash, createHmac, randomInt } from "node:crypto";
import { env } from "./env";
import { query, queryOne, transaction } from "./db";
import { rowToUser, safeEqual, userColumns, type SessionUser } from "./session";

/**
 * Telegram autentifikatsiyasi va zaxira OTP.
 *
 * Ikkala Telegram oqimi ham imzoni server tomonda tekshiradi — klientdan
 * kelgan `user_id` ga hech qachon ishonilmaydi.
 */

/** Yangi foydalanuvchiga beriladigan tanish bonusi. */
export const SIGNUP_BONUS_POINTS = 3000;

export type TelegramProfile = {
  telegramId: string;
  username: string | null;
  name: string;
  photoUrl: string | null;
};

function checkString(pairs: Map<string, string>): string {
  return [...pairs.entries()]
    .filter(([k]) => k !== "hash" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/**
 * Telegram Login Widget (brauzer) imzosi.
 * secret = SHA256(bot_token), hash = HMAC-SHA256(data_check_string, secret)
 */
export function verifyLoginWidget(data: Record<string, string>): TelegramProfile | null {
  if (!env.telegramBotToken) return null;
  const hash = data.hash;
  if (!hash) return null;

  const pairs = new Map(Object.entries(data).map(([k, v]) => [k, String(v)]));
  const secret = createHash("sha256").update(env.telegramBotToken).digest();
  const expected = createHmac("sha256", secret).update(checkString(pairs)).digest("hex");
  if (!safeEqual(expected, hash)) return null;

  // Widget imzosi eskirmaydi — takroriy ishlatishni cheklash uchun 1 kun.
  const authDate = Number(data.auth_date ?? 0);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > 86_400) return null;

  if (!data.id) return null;
  return {
    telegramId: String(data.id),
    username: data.username || null,
    name: [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "Foydalanuvchi",
    photoUrl: data.photo_url || null,
  };
}

/**
 * Telegram Mini App `initData` imzosi.
 * secret = HMAC-SHA256(bot_token, "WebAppData")
 */
export function verifyMiniAppInitData(initData: string): TelegramProfile | null {
  if (!env.telegramBotToken || !initData) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) return null;

  const pairs = new Map<string, string>();
  params.forEach((v, k) => pairs.set(k, v));

  const secret = createHmac("sha256", "WebAppData").update(env.telegramBotToken).digest();
  const expected = createHmac("sha256", secret).update(checkString(pairs)).digest("hex");
  if (!safeEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > 86_400) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;
  let user: { id?: number; username?: string; first_name?: string; last_name?: string; photo_url?: string };
  try {
    user = JSON.parse(rawUser);
  } catch {
    return null;
  }
  if (!user.id) return null;
  return {
    telegramId: String(user.id),
    username: user.username || null,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Foydalanuvchi",
    photoUrl: user.photo_url || null,
  };
}

/** Ustunlar ro'yxati bitta joyda — nusxa ko'chirilsa ikkisi ajralib ketardi. */
const USER_COLUMNS = userColumns();

/**
 * Telegram profili bo'yicha foydalanuvchini topadi yoki yaratadi.
 * Yangi akkauntga tanish bonusi jurnal bilan birga beriladi.
 */
export async function upsertTelegramUser(p: TelegramProfile): Promise<SessionUser> {
  return transaction(async (client) => {
    const existing = await client.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE telegram_id = $1 FOR UPDATE`,
      [p.telegramId],
    );
    if (existing.rows[0]) {
      const updated = await client.query(
        `UPDATE users
            SET username = $2, name = $3, photo_url = $4, updated_at = now()
          WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
        [existing.rows[0].id, p.username, p.name, p.photoUrl],
      );
      return rowToUser(updated.rows[0]);
    }

    const created = await client.query(
      `INSERT INTO users (telegram_id, username, name, photo_url, points, author)
       VALUES ($1, $2, $3, $4, $5, $3)
       RETURNING ${USER_COLUMNS}`,
      [p.telegramId, p.username, p.name, p.photoUrl, SIGNUP_BONUS_POINTS],
    );
    await client.query(
      `INSERT INTO transactions (user_id, kind, points_delta, reference, note)
       VALUES ($1, 'bonus', $2, $3, 'Ro''yxatdan o''tish bonusi')`,
      [created.rows[0].id, SIGNUP_BONUS_POINTS, `signup:${created.rows[0].id}`],
    );
    return rowToUser(created.rows[0]);
  });
}

/* ─────────────────────── OTP (zaxira / dev kirish) ─────────────────────── */

const OTP_TTL_MS = 2 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

function hashCode(identifier: string, code: string): string {
  return createHmac("sha256", env.sessionSecret).update(`${identifier}:${code}`).digest("hex");
}

/** Identifikatorni normallashtiradi — bir xil raqam bir xil bucket ga tushsin. */
export function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "").slice(0, 120);
}

/**
 * Kod yaratadi va hashini saqlaydi. Kodning o'zi qaytariladi — uni
 * yetkazish (Telegram OTP bot / SMS) chaqiruvchi tomonning ishi.
 * Dev rejimida javobda ko'rsatiladi, prod da hech qachon.
 */
export async function issueLoginCode(identifier: string): Promise<string> {
  const id = normalizeIdentifier(identifier);
  const code = String(randomInt(10_000, 100_000));
  // Eski faol kodlarni bekor qilamiz — bir vaqtda bitta kod ishlasin.
  await query("UPDATE login_codes SET consumed_at = now() WHERE identifier = $1 AND consumed_at IS NULL", [id]);
  await query(
    `INSERT INTO login_codes (identifier, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '2 minutes')`,
    [id, hashCode(id, code)],
  );
  return code;
}

export type CodeCheck = { ok: true } | { ok: false; reason: "expired" | "invalid" | "attempts" };

/**
 * Kodni tekshiradi va bir martalik qiladi.
 *
 * Urinishlar soni bazada hisoblanadi: 5 tadan keyin kod o'ladi, ya'ni
 * 5 xonali kodni brute-force qilib bo'lmaydi.
 */
export async function consumeLoginCode(identifier: string, code: string): Promise<CodeCheck> {
  const id = normalizeIdentifier(identifier);
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 5) return { ok: false, reason: "invalid" };

  return transaction(async (client) => {
    const row = await client.query<{ id: string; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts
         FROM login_codes
        WHERE identifier = $1 AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [id],
    );
    const rec = row.rows[0];
    if (!rec) return { ok: false, reason: "expired" } as const;
    if (rec.attempts >= OTP_MAX_ATTEMPTS) {
      await client.query("UPDATE login_codes SET consumed_at = now() WHERE id = $1", [rec.id]);
      return { ok: false, reason: "attempts" } as const;
    }
    if (!safeEqual(rec.code_hash, hashCode(id, digits))) {
      await client.query("UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1", [rec.id]);
      return { ok: false, reason: "invalid" } as const;
    }
    await client.query("UPDATE login_codes SET consumed_at = now() WHERE id = $1", [rec.id]);
    return { ok: true } as const;
  });
}

export { OTP_TTL_MS };

/**
 * OTP identifikatori bo'yicha lokal akkaunt.
 *
 * Diqqat: qidiruv **`local_id`** bo'yicha, `username` bo'yicha emas.
 * Ilgari `username` ishlatilardi, lekin unga Telegram username ham
 * yozilardi — natijada OTP orqali «egam_haq» deb kirgan kishi
 * @egam_haq Telegram akkauntiga tushib qolardi (akkauntni o'zlashtirish).
 */
export async function upsertLocalUser(identifier: string): Promise<SessionUser> {
  const id = normalizeIdentifier(identifier);
  if (!id) throw new Error("Identifikator bo'sh");

  const existing = await queryOne(`SELECT ${USER_COLUMNS} FROM users WHERE local_id = $1`, [id]);
  if (existing) return rowToUser(existing as never);

  return transaction(async (client) => {
    const created = await client.query(
      `INSERT INTO users (local_id, name, points, author)
       VALUES ($1, $2, $3, $2)
       RETURNING ${USER_COLUMNS}`,
      [id, id, SIGNUP_BONUS_POINTS],
    );
    await client.query(
      `INSERT INTO transactions (user_id, kind, points_delta, reference, note)
       VALUES ($1, 'bonus', $2, $3, 'Ro''yxatdan o''tish bonusi')`,
      [created.rows[0].id, SIGNUP_BONUS_POINTS, `signup:${created.rows[0].id}`],
    );
    return rowToUser(created.rows[0]);
  });
}
