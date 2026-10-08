import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { query, queryOne, transaction } from "./db";
import { env } from "./env";
import { log } from "./log";
import { rateLimit, windowStartOf } from "./ratelimit";
import { sendMessage } from "./telegram";
import {
  adminCryptoAvailable,
  enrollmentSecret,
  generateRecoveryCode,
  hashToken,
  hmacCode,
  isAdminCryptoError,
  normalizeRecoveryCode,
  open,
  randomToken,
  seal,
} from "./admin-crypto";
import { otpauthUri, qrSvg, verifyTotp } from "./admin-totp";
import { canManageRole, isRole, permissionsOf, type Permission, type Role } from "./admin-rbac";
import { adminTx, writeAudit, writeFailedAudit, writeSystemAudit, type AuditActor, type AuditFn } from "./admin-audit";
import {
  ACCOUNT_COLUMNS,
  createAdminSession,
  markReauth,
  reauthUntil,
  revokeAdminSession,
  revokeAllAdminSessions,
  rowToAccount,
  type AdminAccount,
  type AdminSessionInfo,
  type NewAdminSession,
} from "./admin-session";
import { rateLimitedError, type AdminActor, type AdminAuthContext } from "./admin-handler";

/**
 * Admin accounts, enrollment and second-factor flows
 * (docs/admin/02-plan.md §3.2, §3.3, §4.3 invariants, §6.1, §6.2, §6.13).
 *
 * Security notes:
 *   • Codes are never logged or audited; audit rows carry only the flow name.
 *   • Errors are deliberately generic ("Kod noto'g'ri"), whatever failed.
 *   • Brute force (§3.3), all fail-closed: 20 attempts / 15 min per IP;
 *     5 failed codes / 15 min per account → 429 + `auth.locked` + Telegram
 *     notice; an enrollment token burns after 5 failed codes.
 *   • TOTP replay: a step is accepted only if it is greater than the stored
 *     `totp_last_step`, and the step is persisted with a conditional UPDATE in
 *     the same transaction that creates the session — two parallel requests
 *     with the same code cannot both win.
 */

export const FAIL_LIMIT = 5;
export const FAIL_WINDOW_SEC = 900;
export const IP_LIMIT = 20;
export const IP_WINDOW_SEC = 900;
export const ENROLL_TTL_MIN = 30;
export const ENROLL_MAX_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;

const BAD_CODE = "Kod noto'g'ri";
const ENROLL_GONE = "Havola yaroqsiz yoki muddati o'tgan";
const REASON_ERROR = "Sabab 5–500 belgidan iborat bo'lishi kerak";

// ───────────────────────────── input helpers

/**
 * Guards every TOTP-factor flow (enrollment, TOTP/recovery login, step-up,
 * recovery codes). With the 2FA switch off they do not exist: 409 `2fa_off`,
 * whatever the key (simple mode must work without `ADMIN_TOTP_KEY`). With it
 * on: 503 `admin_disabled` when `ADMIN_TOTP_KEY` is missing or invalid (§3.4).
 */
export function requireAdminCrypto(): void {
  if (!env.admin2faRequired) {
    throw new ApiError("Ikki bosqichli himoya o'chirilgan", 409, { code: "2fa_off" });
  }
  if (!adminCryptoAvailable()) {
    throw new ApiError("Admin panelga kirish vaqtincha o'chirilgan", 503, { code: "admin_disabled" });
  }
}

/** A positive BIGINT id as a decimal string, or `null` (→ 404 for path params). */
export function parseBigintId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw);
  if (!/^[1-9]\d{0,18}$/.test(s)) return null;
  return BigInt(s) <= BigInt("9223372036854775807") ? s : null;
}

export function parseTotpCode(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(s)) throw new ApiError("Kod 6 xonali raqam bo'lishi kerak", 400);
  return s;
}

export function parseReason(raw: unknown, opts: { optional?: boolean } = {}): string | null {
  if (raw === undefined || raw === null || raw === "") {
    if (opts.optional) return null;
    throw new ApiError(REASON_ERROR, 400);
  }
  if (typeof raw !== "string") throw new ApiError(REASON_ERROR, 400);
  const s = raw.trim();
  if (s.length < 5 || s.length > 500) {
    if (opts.optional && !s) return null;
    throw new ApiError(REASON_ERROR, 400);
  }
  return s;
}

function parseEnrollToken(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}

// ───────────────────────────── notices

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tashkentNow(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}

/**
 * Best-effort Telegram DM. Never awaited by the request and never throws:
 * a bot outage must not block or fail a login. All dynamic text is escaped
 * (`sendMessage` uses parse_mode HTML).
 */
export function notifyAdmin(telegramId: string | null, title: string, lines: string[]): void {
  if (!telegramId) return;
  const text = [`<b>${escapeHtml(title)}</b>`, ...lines.map(escapeHtml)].join("\n");
  void sendMessage(telegramId, text).catch((e: unknown) => {
    log("warn", "[admin] telegram notice failed", { err: e });
  });
}

// ───────────────────────────── brute-force gates

type Who = {
  adminId: string;
  userId: string;
  role: Role;
  telegramId: string | null;
  ip: string;
  userAgent: string | null;
  requestId: string | null;
};

function whoFromAuth(a: AdminAuthContext): Who {
  return {
    adminId: a.account.id,
    userId: a.user.id,
    role: a.account.role,
    telegramId: a.user.telegramId,
    ip: a.ip,
    userAgent: a.userAgent,
    requestId: a.requestId,
  };
}

function whoFromActor(a: AdminActor): Who {
  return {
    adminId: a.id,
    userId: a.userId,
    role: a.role,
    telegramId: a.user.telegramId,
    ip: a.ip,
    userAgent: a.userAgent,
    requestId: a.requestId,
  };
}

function actorOf(w: Who): AuditActor {
  return { id: w.adminId, userId: w.userId, role: w.role, ip: w.ip, userAgent: w.userAgent, requestId: w.requestId };
}

const failBucket = (adminId: string) => `admin-auth-fail:${adminId}`;

const ipBucket = (ip: string) => `admin-auth-ip:${ip}`;

/**
 * The IP budget only makes sense for a real client address. `clientIp` is
 * "direct" for everyone without `TRUST_PROXY` and "unknown" when the proxy
 * sent no address: one shared bucket would let a single admin's failures lock
 * every other admin out (Phase 4 review). The per-account lock still applies;
 * `runtimeWarnings` flags the missing proxy in production.
 */
export function ipGateApplies(ip: string): boolean {
  return ip !== "" && ip !== "direct" && ip !== "unknown";
}

/**
 * Refuses before verifying anything once the IP's FAILED codes (any flow)
 * reached the limit. Reads the counter through a zero-weight upsert — the
 * same statement path the counter uses — so an unavailable store refuses
 * (fail-closed) without counting the attempt; successes never consume the
 * budget (`countIpFailure` does).
 */
async function ipGate(ip: string): Promise<void> {
  if (!ipGateApplies(ip)) return;
  const now = Date.now();
  const windowStart = windowStartOf(now, IP_WINDOW_SEC);
  let hits: number;
  try {
    const row = await queryOne<{ hits: number }>(
      `INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, $2, 0)
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits
       RETURNING hits`,
      [ipBucket(ip), windowStart],
    );
    hits = row?.hits ?? 0;
  } catch (e) {
    log("error", "[admin] IP limit check failed", { err: e });
    throw rateLimitedError(30);
  }
  if (hits >= IP_LIMIT) {
    throw rateLimitedError(Math.max(1, Math.ceil((windowStart.getTime() + IP_WINDOW_SEC * 1000 - now) / 1000)));
  }
}

/** One failed code against the caller's IP; the NEXT attempt's `ipGate` refuses once over the limit. */
async function countIpFailure(ip: string): Promise<void> {
  if (!ipGateApplies(ip)) return;
  await rateLimit(ipBucket(ip), IP_LIMIT, IP_WINDOW_SEC, { failClosed: true });
}

/** Refuses before verifying anything while the account is locked. Fail-closed. */
async function lockGate(adminId: string): Promise<void> {
  const now = Date.now();
  const windowStart = windowStartOf(now, FAIL_WINDOW_SEC);
  const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + FAIL_WINDOW_SEC * 1000 - now) / 1000));
  let hits: number;
  try {
    const row = await queryOne<{ hits: number }>(`SELECT hits FROM rate_limits WHERE bucket = $1 AND window_start = $2`, [
      failBucket(adminId),
      windowStart,
    ]);
    hits = row?.hits ?? 0;
  } catch (e) {
    log("error", "[admin] lockout check failed", { err: e });
    throw rateLimitedError(30);
  }
  if (hits >= FAIL_LIMIT) {
    throw new ApiError(`Juda ko'p noto'g'ri urinish. ${retryAfterSec} soniyadan keyin urinib ko'ring.`, 429, {
      code: "locked",
      retryAfter: retryAfterSec,
      retryAfterSec,
    });
  }
}

/**
 * Counts one failed code, audits it, and throws: 401 `bad_code`, or 429 when
 * this failure reached the limit (then also `auth.locked` + a notice, once).
 */
async function failCode(w: Who, flow: string): Promise<never> {
  const r = await rateLimit(failBucket(w.adminId), FAIL_LIMIT, FAIL_WINDOW_SEC, { failClosed: true });
  await countIpFailure(w.ip);
  await writeFailedAudit(actorOf(w), { action: "auth.login_failed", targetType: "admin", targetId: w.adminId, meta: { flow } });
  if (r.error) throw rateLimitedError(r.retryAfterSec);
  if (!r.ok || r.remaining === 0) {
    if (r.ok) {
      await writeFailedAudit(actorOf(w), {
        action: "auth.locked",
        targetType: "admin",
        targetId: w.adminId,
        meta: { flow, failures: FAIL_LIMIT, windowSec: FAIL_WINDOW_SEC },
      });
      notifyAdmin(w.telegramId, "Admin hisobi vaqtincha bloklandi", [
        `${FAIL_LIMIT} marta noto'g'ri kod kiritildi.`,
        `Vaqt: ${tashkentNow()}`,
        `IP: ${w.ip}`,
        "Agar bu siz bo'lmasangiz, darhol boshqa egaga xabar bering.",
      ]);
    }
    throw new ApiError(`Juda ko'p noto'g'ri urinish. ${r.retryAfterSec} soniyadan keyin urinib ko'ring.`, 429, {
      code: "locked",
      retryAfter: r.retryAfterSec,
      retryAfterSec: r.retryAfterSec,
    });
  }
  throw new ApiError(BAD_CODE, 401, { code: "bad_code" });
}

async function clearFailures(adminId: string): Promise<void> {
  await query(`DELETE FROM rate_limits WHERE bucket = $1`, [failBucket(adminId)]).catch((e: unknown) =>
    log("warn", "[admin] failure counter reset failed", { err: e }),
  );
}

function openSecretOrDisabled(sealed: string, adminId: string): string {
  try {
    return open(sealed, `admin:${adminId}`);
  } catch (e) {
    // Key rotated/lost or the row was altered: not the user's fault, and not
    // something a retry fixes. Logged without the value.
    log("error", "[admin] TOTP secret cannot be opened", { adminId, code: isAdminCryptoError(e) ? e.code : "unknown" });
    throw new ApiError("Admin panelga kirish vaqtincha o'chirilgan", 503, { code: "admin_disabled" });
  }
}

/**
 * Verifies a TOTP for an enrolled, active account and runs `inTx` in the
 * transaction that atomically records the step (replay guard).
 */
async function withVerifiedTotp<T>(
  w: Who,
  code: string,
  flow: string,
  inTx: (client: PoolClient, audit: AuditFn) => Promise<T>,
): Promise<T> {
  await ipGate(w.ip);
  await lockGate(w.adminId);
  const row = await queryOne<{ totp_secret_enc: string | null; totp_last_step: string; status: string }>(
    `SELECT totp_secret_enc, totp_last_step::text AS totp_last_step, status FROM admin_accounts WHERE id = $1`,
    [w.adminId],
  );
  if (!row || row.status !== "active" || !row.totp_secret_enc) {
    throw new ApiError("Ikki bosqichli himoya hali sozlanmagan", 409, { code: "not_enrolled" });
  }
  const secret = openSecretOrDisabled(row.totp_secret_enc, w.adminId);
  const v = verifyTotp(secret, code, Date.now(), Number(row.totp_last_step));
  if (!v.ok) return failCode(w, flow);
  const out = await adminTx(actorOf(w), async (client, audit) => {
    const upd = await client.query(
      `UPDATE admin_accounts SET totp_last_step = $2
        WHERE id = $1 AND status = 'active' AND totp_last_step < $2`,
      [w.adminId, v.step],
    );
    if (!upd.rowCount) return { replay: true as const };
    return { replay: false as const, value: await inTx(client, audit) };
  });
  if (out.replay) return failCode(w, flow);
  await clearFailures(w.adminId);
  return out.value;
}

// ───────────────────────────── recovery codes

async function replaceRecoveryCodes(client: PoolClient, adminId: string): Promise<string[]> {
  await client.query(`DELETE FROM admin_recovery_codes WHERE admin_id = $1`, [adminId]);
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(generateRecoveryCode());
  const list = [...codes];
  await client.query(
    `INSERT INTO admin_recovery_codes (admin_id, code_hash) SELECT $1, unnest($2::text[])`,
    [adminId, list.map((c) => hmacCode(c))],
  );
  return list;
}

// ───────────────────────────── enrollment

async function createEnrollment(
  client: Pick<PoolClient, "query">,
  adminId: string,
  createdBy: string | null,
): Promise<{ enrollUrl: string; expiresAt: string }> {
  // Only the newest link works: older unconsumed ones are closed.
  await client.query(`UPDATE admin_enrollments SET consumed_at = now() WHERE admin_id = $1 AND consumed_at IS NULL`, [adminId]);
  const token = randomToken();
  const res = await client.query<{ expires_at: Date }>(
    `INSERT INTO admin_enrollments (token_hash, admin_id, created_by, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))
     RETURNING expires_at`,
    [hashToken(token), adminId, createdBy, ENROLL_TTL_MIN],
  );
  return {
    enrollUrl: `${env.appUrl}/admin/enroll?token=${token}`,
    expiresAt: new Date(res.rows[0]!.expires_at).toISOString(),
  };
}

type EnrollRow = { admin_id: string; attempts: number; usable: boolean };

const ENROLL_SELECT = `SELECT admin_id::text AS admin_id, attempts,
        (consumed_at IS NULL AND expires_at > now() AND attempts < ${ENROLL_MAX_ATTEMPTS}) AS usable
   FROM admin_enrollments WHERE token_hash = $1`;

/** GET /api/admin/auth/enroll — the secret, key URI and QR for the matching pending account. */
export async function enrollmentInfo(
  auth: AdminAuthContext,
  rawToken: unknown,
): Promise<{ account: { role: Role }; secret: string; otpauthUri: string; qrSvg: string }> {
  requireAdminCrypto();
  const token = parseEnrollToken(rawToken);
  if (!token) throw new ApiError(ENROLL_GONE, 404);
  // QR rendering costs CPU; views do not count against the code-attempt budget.
  const rl = await rateLimit(`admin-enroll-view:${auth.ip}`, 30, IP_WINDOW_SEC, { failClosed: true });
  if (!rl.ok) throw rateLimitedError(rl.retryAfterSec);
  const row = await queryOne<EnrollRow>(ENROLL_SELECT, [hashToken(token)]);
  if (!row || !row.usable || String(row.admin_id) !== auth.account.id || auth.account.status !== "pending") {
    throw new ApiError(ENROLL_GONE, 404);
  }
  const secret = enrollmentSecret(token);
  const label = auth.user.username || auth.user.name || `admin-${auth.account.id}`;
  const uri = otpauthUri({ issuer: env.brandName, account: label, secret });
  return { account: { role: auth.account.role }, secret, otpauthUri: uri, qrSvg: await qrSvg(uri) };
}


/** POST /api/admin/auth/enroll — confirms the first code, activates the account, opens a session. */
export async function confirmEnrollment(
  auth: AdminAuthContext,
  rawToken: unknown,
  rawCode: unknown,
): Promise<{ recoveryCodes: string[]; session: NewAdminSession }> {
  requireAdminCrypto();
  const token = parseEnrollToken(rawToken);
  if (!token) throw new ApiError(ENROLL_GONE, 404);
  const code = parseTotpCode(rawCode);
  await ipGate(auth.ip);
  const w = whoFromAuth(auth);
  const tokenHash = hashToken(token);

  type Out = { kind: "gone" } | { kind: "bad"; burned: boolean } | { kind: "ok"; codes: string[]; session: NewAdminSession };
  const out = await transaction(async (client): Promise<Out> => {
    const e = (await client.query<EnrollRow>(`${ENROLL_SELECT} FOR UPDATE`, [tokenHash])).rows[0];
    if (!e || !e.usable || String(e.admin_id) !== auth.account.id) return { kind: "gone" };
    const acc = (await client.query<{ status: string }>(`SELECT status FROM admin_accounts WHERE id = $1 FOR UPDATE`, [auth.account.id]))
      .rows[0];
    if (!acc || acc.status !== "pending") return { kind: "gone" };

    const secret = enrollmentSecret(token);
    const v = verifyTotp(secret, code, Date.now(), 0);
    if (!v.ok) {
      const upd = await client.query<{ attempts: number }>(
        `UPDATE admin_enrollments
            SET attempts = attempts + 1,
                consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE consumed_at END
          WHERE token_hash = $1
          RETURNING attempts`,
        [tokenHash, ENROLL_MAX_ATTEMPTS],
      );
      return { kind: "bad", burned: (upd.rows[0]?.attempts ?? ENROLL_MAX_ATTEMPTS) >= ENROLL_MAX_ATTEMPTS };
    }

    await client.query(
      `UPDATE admin_accounts
          SET totp_secret_enc = $2, totp_enabled_at = now(), totp_last_step = $3, status = 'active',
              last_login_at = now(), updated_at = now()
        WHERE id = $1`,
      [auth.account.id, seal(secret, `admin:${auth.account.id}`), v.step],
    );
    await client.query(`UPDATE admin_enrollments SET consumed_at = now() WHERE admin_id = $1 AND consumed_at IS NULL`, [
      auth.account.id,
    ]);
    const codes = await replaceRecoveryCodes(client, auth.account.id);
    const session = await createAdminSession(client, {
      adminId: auth.account.id,
      userSessionId: auth.userSessionId,
      ip: auth.ip,
      userAgent: auth.userAgent,
      reauth: true,
    });
    await writeAudit(client, actorOf(w), {
      action: "auth.enroll",
      targetType: "admin",
      targetId: auth.account.id,
      before: { status: "pending", totpEnabled: false },
      after: { status: "active", totpEnabled: true },
      meta: { sessionId: session.id },
    });
    return { kind: "ok", codes, session };
  });

  if (out.kind === "gone") throw new ApiError(ENROLL_GONE, 404);
  if (out.kind === "bad") {
    await countIpFailure(auth.ip);
    await writeFailedAudit(actorOf(w), {
      action: "auth.login_failed",
      targetType: "admin",
      targetId: auth.account.id,
      meta: { flow: "enroll", tokenBurned: out.burned },
    });
    throw new ApiError(BAD_CODE, 401, { code: "bad_code" });
  }
  notifyAdmin(w.telegramId, "Admin panel: ikki bosqichli himoya yoqildi", [`Vaqt: ${tashkentNow()}`, `IP: ${w.ip}`]);
  return { recoveryCodes: out.codes, session: out.session };
}

// ───────────────────────────── login / recovery / reauth

function assertEnrolled(account: AdminAccount): void {
  if (account.status !== "active" || !account.totpEnabled) {
    throw new ApiError("Ikki bosqichli himoya hali sozlanmagan", 409, { code: "not_enrolled" });
  }
}

/** POST /api/admin/auth/login. */
export async function loginWithTotp(auth: AdminAuthContext, rawCode: unknown): Promise<NewAdminSession> {
  requireAdminCrypto();
  const code = parseTotpCode(rawCode);
  assertEnrolled(auth.account);
  const w = whoFromAuth(auth);
  const session = await withVerifiedTotp(w, code, "login", async (client, audit) => {
    await client.query(`UPDATE admin_accounts SET last_login_at = now() WHERE id = $1`, [w.adminId]);
    const s = await createAdminSession(client, {
      adminId: w.adminId,
      userSessionId: auth.userSessionId,
      ip: w.ip,
      userAgent: w.userAgent,
      reauth: true,
    });
    await audit({ action: "auth.login", targetType: "admin", targetId: w.adminId, meta: { method: "totp", sessionId: s.id } });
    return s;
  });
  notifyAdmin(w.telegramId, "Admin panelga yangi kirish", [
    `Vaqt: ${tashkentNow()}`,
    `IP: ${w.ip}`,
    "Agar bu siz bo'lmasangiz, darhol boshqa egaga xabar bering.",
  ]);
  return session;
}

/** POST /api/admin/auth/recovery — consumes one recovery code (single use, atomic). */
export async function loginWithRecovery(
  auth: AdminAuthContext,
  rawCode: unknown,
): Promise<{ session: NewAdminSession; remaining: number }> {
  requireAdminCrypto();
  const normalized = normalizeRecoveryCode(rawCode);
  if (!normalized) throw new ApiError("Kod formati noto'g'ri", 400);
  assertEnrolled(auth.account);
  const w = whoFromAuth(auth);
  await ipGate(w.ip);
  await lockGate(w.adminId);
  // Lookup by HMAC: the attacker cannot steer the hash, so the index lookup
  // leaks nothing a constant-time compare would protect.
  const codeHash = hmacCode(normalized);
  const out = await adminTx(actorOf(w), async (client, audit) => {
    const used = await client.query(
      `UPDATE admin_recovery_codes SET used_at = now()
        WHERE admin_id = $1 AND code_hash = $2 AND used_at IS NULL
          AND EXISTS (SELECT 1 FROM admin_accounts WHERE id = $1 AND status = 'active')
        RETURNING id`,
      [w.adminId, codeHash],
    );
    if (!used.rowCount) return null;
    await client.query(`UPDATE admin_accounts SET last_login_at = now() WHERE id = $1`, [w.adminId]);
    // No step-up from a recovery code: sensitive actions still need a TOTP.
    const s = await createAdminSession(client, {
      adminId: w.adminId,
      userSessionId: auth.userSessionId,
      ip: w.ip,
      userAgent: w.userAgent,
      reauth: false,
    });
    const left = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM admin_recovery_codes WHERE admin_id = $1 AND used_at IS NULL`,
      [w.adminId],
    );
    const remaining = left.rows[0]?.n ?? 0;
    await audit({
      action: "auth.recovery_used",
      targetType: "admin",
      targetId: w.adminId,
      meta: { remaining, sessionId: s.id },
    });
    return { session: s, remaining };
  });
  if (!out) return failCode(w, "recovery");
  await clearFailures(w.adminId);
  notifyAdmin(w.telegramId, "Admin panelga zaxira kodi bilan kirildi", [
    `Vaqt: ${tashkentNow()}`,
    `IP: ${w.ip}`,
    `Qolgan zaxira kodlari: ${out.remaining}`,
    "Agar bu siz bo'lmasangiz, darhol boshqa egaga xabar bering.",
  ]);
  return out;
}

/** POST /api/admin/auth/reauth — a fresh TOTP opens the 10-minute step-up window. */
export async function reauth(admin: AdminActor, rawCode: unknown): Promise<{ reauthUntil: string }> {
  requireAdminCrypto();
  const code = parseTotpCode(rawCode);
  const until = await withVerifiedTotp(whoFromActor(admin), code, "reauth", async (client, audit) => {
    const u = await markReauth(client, admin.sessionId);
    await audit({ action: "auth.reauth", targetType: "admin", targetId: admin.id, meta: { sessionId: admin.sessionId } });
    return u;
  });
  return { reauthUntil: until.toISOString() };
}

/**
 * Bot panel step-up (docs/bot-admin/PLAN.md, 2FA mode only): the linked admin typed the
 * current TOTP code in the bot chat. Same verification as `reauth` — per-account failure
 * lock, replay guard (`totp_last_step`), `auth.login_failed` / `auth.locked` rows — and an
 * `auth.reauth` row (`meta.via = "bot"`) in the transaction that runs `inTx` (the bot
 * records its 10-minute step-up window there). The bot has no client IP: the IP budget
 * does not apply ("unknown"), the account lock does. Throws `ApiError` 400/401/409/429/503.
 */
export async function botStepUp(
  who: { adminId: string; userId: string; role: Role; telegramId: string | null; requestId: string | null },
  rawCode: unknown,
  inTx: (client: PoolClient) => Promise<void>,
): Promise<void> {
  requireAdminCrypto();
  const code = parseTotpCode(rawCode);
  const w: Who = { ...who, ip: "unknown", userAgent: "telegram-bot" };
  await withVerifiedTotp(w, code, "bot_reauth", async (client, audit) => {
    await inTx(client);
    await audit({ action: "auth.reauth", targetType: "admin", targetId: who.adminId, meta: { via: "bot" } });
  });
}

/** POST /api/admin/me/recovery-codes — new set (old ones invalidated); needs a fresh TOTP in the body. */
export async function regenerateRecoveryCodes(admin: AdminActor, rawCode: unknown): Promise<{ recoveryCodes: string[] }> {
  requireAdminCrypto();
  const code = parseTotpCode(rawCode);
  const codes = await withVerifiedTotp(whoFromActor(admin), code, "recovery_codes", async (client, audit) => {
    const list = await replaceRecoveryCodes(client, admin.id);
    await markReauth(client, admin.sessionId);
    await audit({ action: "auth.recovery_regenerate", targetType: "admin", targetId: admin.id, meta: { count: list.length } });
    return list;
  });
  return { recoveryCodes: codes };
}

/**
 * POST /api/admin/auth/auto — simple mode only (2FA switch off): a designated
 * admin (`active`, or `pending` → activated here, on first entry) gets an
 * admin session with no second factor. Same `admin_sessions` row, cookie,
 * idle/absolute expiry and user-session binding as a TOTP login; only the
 * factor is skipped. One `auth.login` row with `meta.mode = "simple"` (and the
 * status change when the account was pending). No Telegram notice: a session
 * is minted on every visit after expiry, so notices would be noise. With the
 * switch on the route does not exist (404, the cloak).
 */
export async function autoLogin(auth: AdminAuthContext): Promise<NewAdminSession> {
  if (env.admin2faRequired) throw new ApiError("Topilmadi", 404);
  const w = whoFromAuth(auth);
  // A loop of a broken client must not mint sessions without bound.
  const rl = await rateLimit(`admin-auto:${w.adminId}`, 30, 60, { failClosed: true });
  if (!rl.ok) throw rateLimitedError(rl.retryAfterSec);
  return adminTx(actorOf(w), async (client, audit) => {
    const acc = (
      await client.query<{ status: AdminAccount["status"] }>(`SELECT status FROM admin_accounts WHERE id = $1 FOR UPDATE`, [w.adminId])
    ).rows[0];
    // The handler saw pending|active a moment ago; a concurrent disable wins.
    if (!acc || acc.status === "disabled") throw new ApiError("Topilmadi", 404);
    const activated = acc.status === "pending";
    await client.query(
      `UPDATE admin_accounts SET status = 'active', last_login_at = now(), updated_at = now() WHERE id = $1`,
      [w.adminId],
    );
    const s = await createAdminSession(client, {
      adminId: w.adminId,
      userSessionId: auth.userSessionId,
      ip: w.ip,
      userAgent: w.userAgent,
      // No fresh factor to record; the step-up gate is off in this mode anyway.
      reauth: false,
    });
    await audit({
      action: "auth.login",
      targetType: "admin",
      targetId: w.adminId,
      before: activated ? { status: "pending" } : null,
      after: activated ? { status: "active" } : null,
      meta: { mode: "simple", sessionId: s.id, activated },
    });
    return s;
  });
}

/** DELETE /api/admin/session — revokes the session behind `token` (if it is this account's). */
export async function logout(auth: AdminAuthContext, token: string | null): Promise<void> {
  if (!token) return;
  const w = whoFromAuth(auth);
  await adminTx(actorOf(w), async (client, audit) => {
    const res = await client.query<{ id: string }>(
      `UPDATE admin_sessions SET revoked_at = now(), revoke_reason = 'logout'
        WHERE token_hash = $1 AND admin_id = $2 AND revoked_at IS NULL
        RETURNING id::text AS id`,
      [hashToken(token), w.adminId],
    );
    const id = res.rows[0]?.id;
    if (id) await audit({ action: "auth.logout", targetType: "admin_session", targetId: id });
  });
}

// ───────────────────────────── own sessions (§6.2)

export type OwnSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
};

export async function listOwnSessions(admin: AdminActor): Promise<OwnSession[]> {
  const rows = await query<{ id: string; created_at: Date; last_seen_at: Date; ip: string | null; user_agent: string | null }>(
    `SELECT id::text AS id, created_at, last_seen_at, ip, user_agent
       FROM admin_sessions
      WHERE admin_id = $1 AND revoked_at IS NULL AND expires_at > now() AND idle_expires_at > now()
      ORDER BY created_at DESC, id DESC
      LIMIT 50`,
    [admin.id],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    ip: r.ip,
    userAgent: r.user_agent,
    current: r.id === admin.sessionId,
  }));
}

/** Revokes one of the caller's own sessions; 404 when it is not theirs or already gone. */
export async function revokeOwnSession(admin: AdminActor, sessionId: string, reason: string | null): Promise<{ current: boolean }> {
  await adminTx(admin, async (client, audit) => {
    const ok = await revokeAdminSession(client, sessionId, "self", admin.id);
    if (!ok) throw new ApiError("Sessiya topilmadi", 404);
    await audit({ action: "auth.session_revoke", targetType: "admin_session", targetId: sessionId, reason });
  });
  return { current: sessionId === admin.sessionId };
}

// ───────────────────────────── admin accounts (§6.13)

export type AdminListItem = {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  role: Role;
  status: "pending" | "active" | "disabled";
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  activeSessions: number;
};

type ItemRow = {
  id: string;
  user_id: string;
  name: string;
  username: string | null;
  role: Role;
  status: "pending" | "active" | "disabled";
  totp_enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
  active_sessions: number;
};

const ITEM_SELECT = `SELECT a.id::text AS id, a.user_id::text AS user_id, u.name, u.username, a.role, a.status,
        (a.totp_enabled_at IS NOT NULL AND a.totp_secret_enc IS NOT NULL) AS totp_enabled,
        a.last_login_at, a.created_at,
        (SELECT count(*)::int FROM admin_sessions s
           JOIN sessions us ON us.id = s.user_session_id
          WHERE s.admin_id = a.id AND s.revoked_at IS NULL AND s.expires_at > now() AND s.idle_expires_at > now()
            AND us.revoked_at IS NULL AND us.expires_at > now()) AS active_sessions
   FROM admin_accounts a JOIN users u ON u.id = a.user_id`;

function rowToItem(r: ItemRow): AdminListItem {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    username: r.username,
    role: r.role,
    status: r.status,
    totpEnabled: Boolean(r.totp_enabled),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    activeSessions: Number(r.active_sessions),
  };
}

export async function listAdmins(): Promise<AdminListItem[]> {
  // Admin accounts are few (a handful): no pagination by design (§6.13).
  const rows = await query<ItemRow>(`${ITEM_SELECT} ORDER BY a.id LIMIT 500`);
  return rows.map(rowToItem);
}

async function adminItem(client: Pick<PoolClient, "query">, id: string): Promise<AdminListItem> {
  const res = await client.query<ItemRow>(`${ITEM_SELECT} WHERE a.id = $1`, [id]);
  return rowToItem(res.rows[0]!);
}

type TargetRow = AccountRowLite & { telegram_id: string | null };
type AccountRowLite = { id: string; user_id: string; role: Role; status: "pending" | "active" | "disabled"; totp_enabled: boolean };

async function lockTarget(client: PoolClient, id: string): Promise<TargetRow> {
  const res = await client.query<TargetRow>(
    `SELECT a.id::text AS id, a.user_id::text AS user_id, a.role, a.status,
            (a.totp_enabled_at IS NOT NULL AND a.totp_secret_enc IS NOT NULL) AS totp_enabled,
            u.telegram_id::text AS telegram_id
       FROM admin_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.id = $1
      FOR UPDATE OF a`,
    [id],
  );
  const row = res.rows[0];
  if (!row) throw new ApiError("Admin topilmadi", 404);
  return row;
}

function assertNotSelf(actor: AdminActor, target: { id: string }): void {
  if (target.id === actor.id) throw new ApiError("O'zingizning hisobingizni bu yerda o'zgartirib bo'lmaydi", 409, { code: "self" });
}

function assertRank(actor: AdminActor, role: string): void {
  if (!canManageRole(actor.role, role)) {
    throw new ApiError("Bu darajadagi hisobni boshqarishga ruxsatingiz yo'q", 403, { code: "rank" });
  }
}

/** Locks the other active owners and refuses when none would remain. */
async function assertOtherActiveOwner(client: PoolClient, targetId: string): Promise<void> {
  const res = await client.query(
    `SELECT id FROM admin_accounts WHERE role = 'owner' AND status = 'active' AND id <> $1 FOR UPDATE`,
    [targetId],
  );
  if (!res.rowCount) throw new ApiError("Oxirgi faol egani o'zgartirib bo'lmaydi", 409, { code: "last_owner" });
}

export type CreateAdminInput = {
  userId?: unknown;
  telegramId?: unknown;
  role?: unknown;
  reason?: unknown;
  sendViaTelegram?: unknown;
};

/**
 * A one-time enrollment link, or `null` with the 2FA switch off: in simple mode
 * the account is created `active` and the person enters through the site's
 * "Admin panel" button, so there is nothing to enroll.
 */
export type EnrollmentLink = { enrollUrl: string | null; expiresAt: string | null };

const NO_LINK: EnrollmentLink = { enrollUrl: null, expiresAt: null };

/** POST /api/admin/admins. */
export async function createAdmin(
  actor: AdminActor,
  input: CreateAdminInput,
): Promise<{ admin: AdminListItem } & EnrollmentLink> {
  if (!isRole(input.role)) throw new ApiError("Rol noto'g'ri", 400);
  const role = input.role;
  const reason = parseReason(input.reason);
  const hasUser = input.userId !== undefined && input.userId !== null && input.userId !== "";
  const hasTg = input.telegramId !== undefined && input.telegramId !== null && input.telegramId !== "";
  if (hasUser === hasTg) throw new ApiError("userId yoki telegramId dan bittasini yuboring", 400);
  const key = parseBigintId(hasUser ? input.userId : input.telegramId);
  if (!key) throw new ApiError("Foydalanuvchi topilmadi", 404);
  if (input.sendViaTelegram !== undefined && typeof input.sendViaTelegram !== "boolean") {
    throw new ApiError("sendViaTelegram mantiqiy qiymat bo'lishi kerak", 400);
  }
  assertRank(actor, role);
  // Simple mode (2FA switch off): the account is usable at once, no link.
  const twoFactor = env.admin2faRequired;
  const status = twoFactor ? "pending" : "active";

  const out = await adminTx(actor, async (client, audit) => {
    const user = (
      await client.query<{ id: string; telegram_id: string | null; is_blocked: boolean }>(
        `SELECT id::text AS id, telegram_id::text AS telegram_id, is_blocked FROM users WHERE ${hasUser ? "id" : "telegram_id"} = $1`,
        [key],
      )
    ).rows[0];
    if (!user) throw new ApiError("Foydalanuvchi topilmadi", 404);
    // A blocked user cannot sign in, so the account would be dead on arrival; unblock first.
    if (user.is_blocked) throw new ApiError("Bloklangan foydalanuvchini admin qilib bo'lmaydi", 409, { code: "blocked" });
    const ins = await client.query<{ id: string }>(
      `INSERT INTO admin_accounts (user_id, role, status, created_by)
       VALUES ($1, $2, $4, $3)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING id::text AS id`,
      [user.id, role, actor.id, status],
    );
    const id = ins.rows[0]?.id;
    if (!id) throw new ApiError("Bu foydalanuvchi allaqachon admin", 409, { code: "already_admin" });
    const enroll = twoFactor ? await createEnrollment(client, id, actor.id) : NO_LINK;
    await audit({
      action: "admins.create",
      targetType: "admin",
      targetId: id,
      reason,
      after: { userId: user.id, role, status },
      meta: { sendViaTelegram: input.sendViaTelegram === true, ...(twoFactor ? {} : { mode: "simple" }) },
    });
    return { admin: await adminItem(client, id), telegramId: user.telegram_id, ...enroll };
  });
  if (input.sendViaTelegram === true) {
    if (out.enrollUrl) {
      notifyAdmin(out.telegramId, "Sizni admin panelga taklif qilishdi", [
        `Havola ${ENROLL_TTL_MIN} daqiqa amal qiladi va faqat sizning hisobingizda ochiladi:`,
        out.enrollUrl,
      ]);
    } else {
      notifyAdmin(out.telegramId, "Sizni admin panelga taklif qilishdi", [
        "Saytga Telegram orqali kiring va chap menyudagi «Admin panel» tugmasini bosing.",
      ]);
    }
  }
  return { admin: out.admin, enrollUrl: out.enrollUrl, expiresAt: out.expiresAt };
}

/** PATCH /api/admin/admins/:id — role and/or status, within rank limits. */
export async function updateAdmin(
  actor: AdminActor,
  targetId: string,
  input: { role?: unknown; status?: unknown; reason?: unknown },
): Promise<{ admin: AdminListItem }> {
  const role = input.role === undefined ? undefined : input.role;
  if (role !== undefined && !isRole(role)) throw new ApiError("Rol noto'g'ri", 400);
  const status = input.status;
  if (status !== undefined && status !== "active" && status !== "disabled") throw new ApiError("Holat noto'g'ri", 400);
  if (role === undefined && status === undefined) throw new ApiError("O'zgartiriladigan maydon yo'q", 400);
  const reason = parseReason(input.reason);

  return adminTx(actor, async (client, audit) => {
    const t = await lockTarget(client, targetId);
    assertNotSelf(actor, t);
    assertRank(actor, t.role);
    if (role !== undefined) assertRank(actor, role);

    const nextRole: Role = role ?? t.role;
    // "active" restores access only for an enrolled account; otherwise it waits for
    // enrollment. Without the 2FA switch there is no enrollment: "active" is final.
    const enrolled = t.totp_enabled || !env.admin2faRequired;
    const nextStatus = status === undefined ? t.status : status === "disabled" ? "disabled" : enrolled ? "active" : "pending";
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (nextRole !== t.role) {
      before.role = t.role;
      after.role = nextRole;
    }
    if (nextStatus !== t.status) {
      before.status = t.status;
      after.status = nextStatus;
    }
    if (!Object.keys(after).length) throw new ApiError("Hech narsa o'zgarmadi", 400);
    if (t.role === "owner" && t.status === "active" && (nextRole !== "owner" || nextStatus !== "active")) {
      await assertOtherActiveOwner(client, t.id);
    }

    await client.query(
      `UPDATE admin_accounts
          SET role = $2, status = $3, updated_at = now(),
              disabled_at = CASE WHEN $3 = 'disabled' THEN COALESCE(disabled_at, now()) ELSE NULL END,
              disabled_reason = CASE WHEN $3 = 'disabled' THEN $4 ELSE NULL END
        WHERE id = $1`,
      [t.id, nextRole, nextStatus, reason],
    );
    // T20: a disabled admin loses every session in the same transaction.
    const revoked = nextStatus === "disabled" ? await revokeAllAdminSessions(client, t.id, "disabled") : 0;
    await audit({
      action: "admins.update",
      targetType: "admin",
      targetId: t.id,
      reason,
      before,
      after,
      meta: revoked ? { revokedSessions: revoked } : null,
    });
    return { admin: await adminItem(client, t.id) };
  });
}

/**
 * POST /api/admin/admins/:id/reset-2fa. With the 2FA switch off the secret and
 * codes are still cleared and the sessions revoked, but the account stays
 * `active` and no link is issued (the UI hides the action in that mode).
 */
export async function resetAdmin2fa(actor: AdminActor, targetId: string, rawReason: unknown): Promise<EnrollmentLink> {
  const reason = parseReason(rawReason);
  const twoFactor = env.admin2faRequired;
  return adminTx(actor, async (client, audit) => {
    const t = await lockTarget(client, targetId);
    assertNotSelf(actor, t);
    assertRank(actor, t.role);
    // A disabled account stays disabled: resetting 2FA must not re-enable it.
    const nextStatus = t.status === "disabled" ? "disabled" : twoFactor ? "pending" : "active";
    if (t.role === "owner" && t.status === "active" && nextStatus !== "active") await assertOtherActiveOwner(client, t.id);
    await client.query(
      `UPDATE admin_accounts
          SET status = $2, totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = 0, updated_at = now()
        WHERE id = $1`,
      [t.id, nextStatus],
    );
    await client.query(`DELETE FROM admin_recovery_codes WHERE admin_id = $1`, [t.id]);
    const revoked = await revokeAllAdminSessions(client, t.id, "reset_2fa");
    const enroll = twoFactor ? await createEnrollment(client, t.id, actor.id) : NO_LINK;
    await audit({
      action: "admins.reset_2fa",
      targetType: "admin",
      targetId: t.id,
      reason,
      before: { status: t.status, totpEnabled: t.totp_enabled },
      after: { status: nextStatus, totpEnabled: false },
      meta: { revokedSessions: revoked },
    });
    return enroll;
  });
}

/** POST /api/admin/admins/:id/sessions/revoke. */
export async function revokeSessionsOf(actor: AdminActor, targetId: string, rawReason: unknown): Promise<{ revoked: number }> {
  const reason = parseReason(rawReason);
  return adminTx(actor, async (client, audit) => {
    const t = await lockTarget(client, targetId);
    // Own sessions go through /admin/account (plan §4.3), like role, status and 2FA.
    assertNotSelf(actor, t);
    assertRank(actor, t.role);
    const revoked = await revokeAllAdminSessions(client, t.id, "admin_revoke");
    await audit({ action: "admins.revoke_sessions", targetType: "admin", targetId: t.id, reason, meta: { revoked } });
    return { revoked };
  });
}

// ───────────────────────────── CLI bootstrap / break-glass (§3.2, §15.1)

export type CliResult = { adminId: string; created: boolean; revokedSessions: number } & EnrollmentLink;

/**
 * `npm run admin:create`: creates the account, or resets an existing one
 * (any status) to `pending` with a cleared 2FA and revoked sessions. Writes
 * one system audit row (`admin_id` NULL, `meta.via = "cli"`). With the 2FA
 * switch off the account is `active` right away and there is no link: the
 * person enters through the site's "Admin panel" button.
 */
export async function cliUpsertAdmin(p: {
  userId?: string;
  telegramId?: string;
  role: Role;
  host: string;
}): Promise<CliResult> {
  const key = parseBigintId(p.userId ?? p.telegramId);
  if (!key || (p.userId !== undefined) === (p.telegramId !== undefined)) throw new Error("exactly one of userId/telegramId is required");
  if (!isRole(p.role)) throw new Error("invalid role");
  return transaction(async (client) => {
    const user = (
      await client.query<{ id: string }>(
        `SELECT id::text AS id FROM users WHERE ${p.userId !== undefined ? "id" : "telegram_id"} = $1`,
        [key],
      )
    ).rows[0];
    if (!user) throw new Error("user not found (the person must log in to the site once first)");
    const existing = (
      await client.query<AccountRowLite>(
        `SELECT a.id::text AS id, a.user_id::text AS user_id, a.role, a.status,
                (a.totp_enabled_at IS NOT NULL AND a.totp_secret_enc IS NOT NULL) AS totp_enabled
           FROM admin_accounts a WHERE a.user_id = $1 FOR UPDATE`,
        [user.id],
      )
    ).rows[0];
    const twoFactor = env.admin2faRequired;
    const status = twoFactor ? "pending" : "active";
    let adminId: string;
    let revokedSessions = 0;
    if (existing) {
      adminId = existing.id;
      await client.query(
        `UPDATE admin_accounts
            SET role = $2, status = $3, totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = 0,
                disabled_at = NULL, disabled_reason = NULL, updated_at = now()
          WHERE id = $1`,
        [adminId, p.role, status],
      );
      await client.query(`DELETE FROM admin_recovery_codes WHERE admin_id = $1`, [adminId]);
      revokedSessions = await revokeAllAdminSessions(client, adminId, "cli_reset");
    } else {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, $3) RETURNING id::text AS id`,
        [user.id, p.role, status],
      );
      adminId = ins.rows[0]!.id;
    }
    const enroll = twoFactor ? await createEnrollment(client, adminId, null) : NO_LINK;
    await writeSystemAudit(client, {
      action: existing ? "admins.reset_2fa" : "admins.create",
      targetType: "admin",
      targetId: adminId,
      reason: existing ? "CLI break-glass reset" : "CLI bootstrap",
      before: existing ? { role: existing.role, status: existing.status, totpEnabled: existing.totp_enabled } : null,
      after: { userId: user.id, role: p.role, status, totpEnabled: false },
      meta: { via: "cli", host: p.host.slice(0, 100), revokedSessions, ...(twoFactor ? {} : { mode: "simple" }) },
    });
    return { adminId, created: !existing, revokedSessions, ...enroll };
  });
}

// ───────────────────────────── response views (§6.1)

export type AdminView = {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  role: Role;
  permissions: Permission[];
  status: AdminAccount["status"];
  totpEnabled: boolean;
};

export type SessionView = { id: string; expiresAt: string; idleExpiresAt: string; reauthUntil: string | null };

/** The `admin` object of the session/login responses (fresh from the DB). */
export async function adminView(accountId: string): Promise<AdminView> {
  const row = await queryOne<Parameters<typeof rowToAccount>[0] & { name: string; username: string | null }>(
    `SELECT ${ACCOUNT_COLUMNS}, u.name, u.username FROM admin_accounts a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
    [accountId],
  );
  if (!row) throw new ApiError("Topilmadi", 404);
  const acc = rowToAccount(row);
  return {
    id: acc.id,
    userId: acc.userId,
    name: row.name,
    username: row.username,
    role: acc.role,
    permissions: permissionsOf(acc.role),
    status: acc.status,
    totpEnabled: acc.totpEnabled,
  };
}

export function newSessionView(s: NewAdminSession): SessionView {
  return {
    id: s.id,
    expiresAt: s.expiresAt.toISOString(),
    idleExpiresAt: s.idleExpiresAt.toISOString(),
    reauthUntil: s.reauthUntil ? s.reauthUntil.toISOString() : null,
  };
}

export function resolvedSessionView(s: AdminSessionInfo): SessionView {
  return { id: s.id, expiresAt: s.expiresAt, idleExpiresAt: s.idleExpiresAt, reauthUntil: reauthUntil(s) };
}
