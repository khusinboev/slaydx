import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";
import { query, queryOne } from "./db";
import { log } from "./log";

/**
 * Sessiya boshqaruvi.
 *
 * Ilgari "auth" faqat `localStorage.loggedIn = true` edi — ya'ni hech qanday
 * server tomonlama shaxs yo'q edi. Endi:
 *   - token brauzerga faqat httpOnly cookie sifatida beriladi (JS o'qiy olmaydi),
 *   - bazada tokenning o'zi emas, SHA-256 hashi turadi,
 *   - har sessiyani alohida bekor qilish mumkin.
 * Exception: a webview that refuses cookies may opt in to the bearer transport
 * for the same rows (`startSession`, `currentSessionRef(req)`; docs/auth/COOKIELESS.md).
 */

export const SESSION_COOKIE = "slaydx_session";

export type SessionUser = {
  id: string;
  telegramId: string | null;
  username: string | null;
  name: string;
  photoUrl: string | null;
  language: string;
  points: number;
  /**
   * Olib tashlangan Pro obunaning kvotasi — 034 dan keyin doim 0.
   * Bir reliz qoldiriladi: ochiq eski tab `points + quota + balance`
   * hisoblaydi, maydon yo'qolsa uning `creditTotal` i NaN bo'lardi.
   */
  quota: number;
  balance: number;
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  subject: string;
  teacher: string;
  city: string;
  /** Slayd muallifi lavozimi va tashkiloti (015) — forma standartlari. */
  position: string;
  organization: string;
  /**
   * Faqat adminlik tekshiruvi uchun. Telegram orqali kirgan oddiy
   * foydalanuvchida deyarli har doim `null` — Telegram login oqimi
   * telefon raqamini bermaydi, admin uni botga bir marta ulashadi.
   */
  phone: string | null;
  /**
   * The user has an `admin_accounts` row with status active or pending
   * (docs/admin/02-plan.md §3.1). Only drives the admin link and page gates;
   * every admin API still requires a valid admin session (`admin-handler.ts`).
   */
  isAdmin: boolean;
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
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  subject: string;
  teacher: string;
  city: string;
  position: string;
  organization: string;
  is_blocked: boolean;
  phone: string | null;
  /** Computed by `userColumns()` (EXISTS on `admin_accounts`). */
  is_admin?: boolean;
};

export function rowToUser(r: UserRow): SessionUser {
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
    university: r.university,
    faculty: r.faculty,
    department: r.department,
    group: r.group,
    course: r.course,
    author: r.author,
    subject: r.subject,
    teacher: r.teacher,
    city: r.city,
    position: r.position ?? "",
    organization: r.organization ?? "",
    phone: r.phone,
    isAdmin: r.is_admin === true,
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
  "university",
  "faculty",
  "department",
  '"group"',
  "course",
  "author",
  "subject",
  "teacher",
  "city",
  "position",
  "organization",
  "is_blocked",
  "phone",
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
  // `isAdmin`: one EXISTS on the unique `admin_accounts.user_id` index. The
  // outer row is referenced by table name/alias explicitly — a bare `id`
  // inside the subquery would bind to `admin_accounts.id`. Every user query
  // (session, profile, login RETURNING) carries it, so `isAdmin` never
  // differs between `/api/users/me` GET and PATCH.
  const isAdmin =
    `EXISTS (SELECT 1 FROM admin_accounts aa WHERE aa.user_id = ${alias || "users"}.id ` +
    `AND aa.status IN ('active', 'pending')) AS is_admin`;
  return [...USER_FIELDS.map((f) => `${p}${f}`), isAdmin].join(", ");
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
  opts: { ttlMs?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? env.sessionTtlDays * 86_400_000));
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

/**
 * A login route's one way to open a session: the row, the cookie exactly as
 * before, and — ONLY when the request opted in with `X-Session-Transport:
 * bearer` — the raw token for the JSON body (`sessionJson` in api.ts), with a
 * shorter lifetime and one `info` line (route + UA family, never the token).
 * Without the opt-in the answer carries no token at all.
 */
export async function startSession(
  req: Request,
  userId: string,
  ip: string | null,
  route: string,
): Promise<{ sessionToken?: string }> {
  const bearer = wantsBearer(req);
  const userAgent = req.headers.get("user-agent");
  const { token, expiresAt } = await createSession(
    userId,
    { userAgent, ip },
    bearer ? { ttlMs: Math.min(env.sessionTtlDays, BEARER_TTL_DAYS) * 86_400_000 } : {},
  );
  await setSessionCookie(token, expiresAt);
  if (!bearer) return {};
  log("info", "[auth] bearer-mode session issued", { route, uaFamily: userAgentFamily(userAgent) });
  return { sessionToken: token };
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
 *
 * `req` given → the bearer transport is accepted too (docs/auth/COOKIELESS.md);
 * without it (SSR pages, the admin panel) the reader is cookie-only.
 */
export async function currentUser(req?: Request): Promise<SessionUser | null> {
  return (await currentSessionRef(req))?.user ?? null;
}

/* ───────────── Bearer transport (webviews that refuse cookies) ───────────── */

/** Request header a client sends to receive `sessionToken` in a login answer. */
export const SESSION_TRANSPORT_HEADER = "x-session-transport";
/** `createSession` tokens: 32 random bytes as base64url, exactly 43 characters. */
const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{43})$/;
/** Bearer sessions live shorter: the token is readable by page JS (XSS trade-off). */
export const BEARER_TTL_DAYS = 7;

/** The well-formed `Authorization: Bearer <token>` of `req`, else `null` (malformed values never reach the DB). */
export function bearerTokenOf(req: Request | undefined): string | null {
  const raw = req?.headers.get("authorization");
  if (!raw) return null;
  return BEARER_RE.exec(raw.trim())?.[1] ?? null;
}

/** The client asked for the bearer transport (`X-Session-Transport: bearer`). */
export function wantsBearer(req: Request): boolean {
  return req.headers.get(SESSION_TRANSPORT_HEADER)?.trim().toLowerCase() === "bearer";
}

/** Coarse user-agent family for the bearer-usage log line (never the full UA). */
export function userAgentFamily(ua: string | null): string {
  const s = ua ?? "";
  if (/Android/i.test(s)) return "android";
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Windows/i.test(s)) return /Edg\//i.test(s) ? "webview2" : "windows-other";
  const webkitOnly = /AppleWebKit/i.test(s) && !/Chrome|Chromium/i.test(s);
  if (/X11|Linux/i.test(s)) return webkitOnly ? "webkitgtk" : "linux-other";
  if (/Macintosh/i.test(s)) return webkitOnly ? "wkwebview-mac" : "mac-other";
  return "other";
}

/** The session row of a raw token: not revoked, not expired, user not blocked; `last_seen_at` at most hourly. */
async function sessionByToken(token: string): Promise<{ sessionId: string; user: SessionUser } | null> {
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
  return { sessionId: String(row.session_id), user: rowToUser(row) };
}

/**
 * The current user AND the id of the `sessions` row behind the user cookie.
 * Admin sessions are bound to that row (`admin_sessions.user_session_id`,
 * docs/admin/02-plan.md §3.1): a user logout, expiry or block ends admin
 * access too. Same checks and `last_seen_at` throttle as `currentUser()`.
 *
 * With `req`, `Authorization: Bearer` is the fallback transport: a VALID
 * cookie session always wins; the bearer is looked up only when the cookie is
 * absent or does not resolve (a webview may keep sending an old revoked cookie
 * while ignoring new ones). Same table, same checks. Admin readers never pass
 * `req`, so the panel stays cookie-only.
 */
export async function currentSessionRef(req?: Request): Promise<{ sessionId: string; user: SessionUser } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const viaCookie = token ? await sessionByToken(token) : null;
  if (viaCookie || !req) return viaCookie;
  const bearer = bearerTokenOf(req);
  return bearer ? sessionByToken(bearer) : null;
}

export async function getUserById(id: string): Promise<SessionUser | null> {
  const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return row ? rowToUser(row) : null;
}

/**
 * Revokes this browser's session: the cookie's row and, with `req`, the row
 * of its `Authorization: Bearer` token (logout in bearer mode). A token only
 * revokes the row it hashes to, so nobody can end a session they do not hold.
 */
export async function revokeCurrentSession(req?: Request): Promise<void> {
  const jar = await cookies();
  const hashes = [jar.get(SESSION_COOKIE)?.value, bearerTokenOf(req)]
    .filter((t): t is string => Boolean(t))
    .map(hashToken);
  if (!hashes.length) return;
  await query("UPDATE sessions SET revoked_at = now() WHERE token_hash = ANY($1)", [hashes]);
}

/** Revokes one `sessions` row (the caller's own, from `currentSessionRef`); other devices are untouched. */
export async function revokeSessionById(sessionId: string): Promise<void> {
  await query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [sessionId]);
}

/**
 * «Barcha qurilmalardan chiqish»: every session of the user, plus every bot
 * keyboard link issued so far (`users.bot_links_before`, docs/bot/PLAN.md Q1).
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await query(
    `WITH links AS (UPDATE users SET bot_links_before = now() WHERE id = $1)
     UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
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
