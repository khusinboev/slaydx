import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";
import { query, queryOne } from "./db";

/**
 * Sessiya boshqaruvi.
 *
 * Ilgari "auth" faqat `localStorage.loggedIn = true` edi — ya'ni hech qanday
 * server tomonlama shaxs yo'q edi. Endi:
 *   - token brauzerga faqat httpOnly cookie sifatida beriladi (JS o'qiy olmaydi),
 *   - bazada tokenning o'zi emas, SHA-256 hashi turadi,
 *   - har sessiyani alohida bekor qilish mumkin.
 */

export const SESSION_COOKIE = "sodda_session";

export type SessionUser = {
  id: string;
  telegramId: string | null;
  username: string | null;
  name: string;
  photoUrl: string | null;
  language: string;
  points: number;
  quota: number;
  balance: number;
  plan: "free" | "pro";
  planExpiresAt: string | null;
  premium: boolean;
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  subject: string;
  teacher: string;
  city: string;
};

type UserRow = {
  id: string;
  telegram_id: string | null;
  local_id: string | null;
  username: string | null;
  name: string;
  photo_url: string | null;
  language: string;
  points: string;
  quota: string;
  balance: string;
  plan: "free" | "pro";
  plan_expires_at: Date | null;
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  subject: string;
  teacher: string;
  city: string;
  is_blocked: boolean;
};

export function rowToUser(r: UserRow): SessionUser {
  const expires = r.plan_expires_at ? new Date(r.plan_expires_at) : null;
  const activePro = r.plan === "pro" && (!expires || expires.getTime() > Date.now());
  return {
    id: String(r.id),
    telegramId: r.telegram_id ? String(r.telegram_id) : null,
    username: r.username,
    name: r.name,
    photoUrl: r.photo_url,
    language: r.language,
    points: Number(r.points),
    quota: Number(r.quota),
    balance: Number(r.balance),
    plan: activePro ? "pro" : "free",
    planExpiresAt: expires ? expires.toISOString() : null,
    premium: activePro,
    university: r.university,
    faculty: r.faculty,
    department: r.department,
    group: r.group,
    course: r.course,
    author: r.author,
    subject: r.subject,
    teacher: r.teacher,
    city: r.city,
  };
}

const USER_FIELDS = [
  "id",
  "telegram_id",
  "local_id",
  "username",
  "name",
  "photo_url",
  "language",
  "points",
  "quota",
  "balance",
  "plan",
  "plan_expires_at",
  "university",
  "faculty",
  "department",
  '"group"',
  "course",
  "author",
  "subject",
  "teacher",
  "city",
  "is_blocked",
];

/**
 * Ustunlar ro'yxati, ixtiyoriy alias bilan.
 *
 * Alias majburiy bo'lgan joy bor: `sessions` bilan JOIN qilinganda
 * qo'shimchasiz `id` ikkala jadvalda ham bor va Postgres
 * «column reference "id" is ambiguous» xatosini beradi.
 */
export function userColumns(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return USER_FIELDS.map((f) => `${p}${f}`).join(", ");
}

const USER_COLUMNS = userColumns();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** IP ni ochiq saqlamaymiz — sessiyalar ro'yxatida faqat taqqoslash uchun kerak. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${env.sessionSecret}:${ip}`).digest("hex").slice(0, 32);
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.sessionTtlDays * 86_400_000);
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      hashToken(token),
      (meta.userAgent ?? "").slice(0, 400) || null,
      hashIp(meta.ip ?? null),
      expiresAt,
    ],
  );
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // `SameSite=None` ni brauzer faqat `Secure` bilan qabul qiladi.
    secure: env.isProd || env.sessionSameSite === "none",
    sameSite: env.sessionSameSite,
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: env.isProd || env.sessionSameSite === "none",
    sameSite: env.sessionSameSite,
    path: "/",
    maxAge: 0,
  });
}

/**
 * Joriy sessiyani o'qiydi. Topilmasa yoki muddati o'tgan bo'lsa `null`.
 * `last_seen_at` faqat bir soatda bir marta yangilanadi — har so'rovda
 * yozish bazani ortiqcha yuklaydi.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<UserRow & { session_id: string; last_seen_at: Date }>(
    `SELECT ${userColumns("u")}, s.id AS session_id, s.last_seen_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row || row.is_blocked) return null;

  if (Date.now() - new Date(row.last_seen_at).getTime() > 3_600_000) {
    void query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]).catch(
      () => {},
    );
  }
  return rowToUser(row);
}

export async function getUserById(id: string): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return row ? rowToUser(row) : null;
}

export async function revokeCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [hashToken(token)]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await query(
    "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
}

/** Muddati o'tgan sessiya va kodlarni tozalaydi (cron chaqiradi). */
export async function purgeExpiredSessions(): Promise<number> {
  const rows = await query<{ count: string }>(
    `WITH gone AS (
       DELETE FROM sessions
        WHERE expires_at < now() - interval '7 days'
           OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')
       RETURNING 1
     )
     SELECT count(*)::text AS count FROM gone`,
  );
  await query("DELETE FROM login_codes WHERE expires_at < now() - interval '1 day'");
  return Number(rows[0]?.count ?? 0);
}

/** Doimiy vaqtli string taqqoslash — timing attack ga qarshi. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
