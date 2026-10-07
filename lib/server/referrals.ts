import "server-only";
import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { cookies } from "next/headers";
import { query, queryOne } from "./db";
import { env } from "./env";
import { topUpInTx } from "./credits";
import { log } from "./log";
import {
  REF_CODE_ALPHABET,
  REF_CODE_LENGTH,
  REFERRAL_REWARD_POINTS,
  normalizeRefCode,
  refCodeFromStartPayload,
  referralBotLink,
  referralWebLink,
} from "../referral";

/**
 * Referral program — the money side (docs/todo-2026-10-07/PLAN.md T3, D1–D3).
 *
 * The one rule everything here protects: the inviter is rewarded ONLY in the
 * transaction that CREATES the invited account (`auth.ts upsertUser`, the
 * `INSERT` branch: `xmax = 0`). Deleting and re-adding the bot, reopening the
 * link or signing in on the site later never creates the account again, so
 * it can never reward again. Three more layers back that up:
 *   1. `applyReferralInTx` itself refuses a referee row that this transaction
 *      did not insert (`created_at = now()`, the transaction timestamp);
 *   2. `referrals.referee_user_id` and `referee_telegram_id` are UNIQUE;
 *   3. the ledger row is `topUpInTx` with the reference `referral:<referee id>`
 *      (`transactions_ref_idx` UNIQUE kind + reference), in the same transaction.
 * Wallets are never written directly: `topUpInTx` keeps balance == sum(ledger).
 */

export { REFERRAL_REWARD_POINTS };

/** More referrals than this by one inviter within 24 h raise the admin signal (D3). */
export const REFERRAL_BURST_THRESHOLD = 25;

/** `error_log.scope` of the burst signal (admin errors page, watchdog «new error type»). */
export const REFERRAL_BURST_SCOPE = "referral_burst";

/** Web-link capture cookie (`/uz?ref=…`) — read only by the Telegram sign-in routes. */
export const REF_COOKIE = "sx_ref";
export const REF_COOKIE_PATH = "/api/auth";
/** A week (review MINOR-4): long enough to sign in later, short enough not to credit a stranger on a shared device. */
export const REF_COOKIE_MAX_AGE_SEC = 7 * 24 * 3600;

export type ReferralSource = "bot" | "web";

/** A code claimed by a sign-in, applied only if that sign-in creates the account. */
export type ReferralClaim = { code: string; source: ReferralSource };

export type ReferralOutcome =
  | { applied: true; referrerId: string; points: number }
  | {
      applied: false;
      reason: "invalid" | "unknown" | "self" | "blocked" | "not_new" | "duplicate" | "error";
      referrerId?: string;
    };

/** Ledger reference of the reward for one invited account. */
export function referralRewardRef(refereeId: string): string {
  return `referral:${refereeId}`;
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < REF_CODE_LENGTH; i++) out += REF_CODE_ALPHABET[randomInt(REF_CODE_ALPHABET.length)];
  return out;
}

const isRefCodeTaken = (e: unknown) => {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return Boolean(err) && err!.code === "23505" && err!.constraint === "users_ref_code_idx";
};

/**
 * The user's invite code, created on first use. Concurrent first calls agree
 * (`WHERE ref_code IS NULL`: the loser re-reads the winner's code); a random
 * collision with another user's code just draws again.
 */
export async function ensureRefCode(userId: string): Promise<string> {
  const existing = await queryOne<{ ref_code: string | null }>("SELECT ref_code FROM users WHERE id = $1", [userId]);
  if (!existing) throw new Error("Foydalanuvchi topilmadi");
  if (existing.ref_code) return existing.ref_code;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      await query("UPDATE users SET ref_code = $2 WHERE id = $1 AND ref_code IS NULL", [userId, randomCode()]);
    } catch (e) {
      if (isRefCodeTaken(e)) continue;
      throw e;
    }
    const row = await queryOne<{ ref_code: string | null }>("SELECT ref_code FROM users WHERE id = $1", [userId]);
    if (row?.ref_code) return row.ref_code;
  }
  throw new Error("Taklif kodi yaratilmadi");
}

export type Referrer = { id: string; isBlocked: boolean };

/** Owner of a code (`null` for a malformed or unknown code). */
export async function resolveReferrer(code: unknown, db: Pick<PoolClient, "query"> | null = null): Promise<Referrer | null> {
  const c = normalizeRefCode(code);
  if (!c) return null;
  const sql = "SELECT id::text AS id, is_blocked FROM users WHERE ref_code = $1";
  const row = db ? (await db.query<{ id: string; is_blocked: boolean }>(sql, [c])).rows[0] : await queryOne<{ id: string; is_blocked: boolean }>(sql, [c]);
  return row ? { id: row.id, isBlocked: row.is_blocked } : null;
}

/** Ledger note the inviter sees in «Hisob harakati». */
function rewardNote(name: string): string {
  const who = name.replace(/\s+/g, " ").trim().slice(0, 40) || "Foydalanuvchi";
  return `Do'st taklifi: ${who}`;
}

/**
 * Records the referral and rewards the inviter, INSIDE the transaction that
 * just inserted the referee. Call it ONLY from the account-creating branch.
 * Ignores (no row, no money): a malformed or unknown code, a self-referral,
 * a referee this transaction did not create. A blocked inviter is recorded
 * with 0 points. A second call for the same referee is a no-op.
 *
 * Runs under a SAVEPOINT: a failure here is logged (admin errors page) and
 * rolled back to the savepoint, so it can never cost the person their
 * sign-up — only the reward is lost, and the error says so.
 */
export async function applyReferralInTx(
  client: PoolClient,
  input: { refereeId: string; code: unknown; source: ReferralSource },
): Promise<ReferralOutcome> {
  const code = normalizeRefCode(input.code);
  if (!code) return { applied: false, reason: "invalid" };
  await client.query("SAVEPOINT referral_apply");
  try {
    const out = await applyCore(client, input.refereeId, code, input.source);
    await client.query("RELEASE SAVEPOINT referral_apply");
    return out;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT referral_apply");
    log("error", "[referral] taklif yozilmadi — ro'yxatdan o'tish davom etdi", {
      userId: input.refereeId,
      source: input.source,
      err,
    });
    return { applied: false, reason: "error" };
  }
}

async function applyCore(client: PoolClient, refereeId: string, code: string, source: ReferralSource): Promise<ReferralOutcome> {
  const referrer = await resolveReferrer(code, client);
  if (!referrer) return { applied: false, reason: "unknown" };
  if (referrer.id === String(refereeId)) return { applied: false, reason: "self", referrerId: referrer.id };

  /*
   * Lock the inviter's row FIRST (review BLOCKER-1). The `referrals` INSERT
   * below takes FOR KEY SHARE on it (FK) and `topUpInTx` then wants FOR
   * UPDATE: two new invitees of one inviter at once each held the share lock
   * and waited for the other's — 40P01, the savepoint swallowed it and the
   * reward was lost for good. With FOR UPDATE up front they queue instead.
   *
   * Lock order is always [own new row → inviter row]. No cycle is possible:
   * nobody else can lock the invitee's row (uncommitted, unseen), and an
   * inviter is never itself being created in a transaction — its code is
   * generated lazily on a committed row (`ensureRefCode`). Every other path
   * (charges, sign-ins, admin) locks a single user row. The `is_blocked` flag
   * and the 24 h burst count are re-read under this lock.
   */
  const locked = await client.query<{ is_blocked: boolean }>("SELECT is_blocked FROM users WHERE id = $1 FOR UPDATE", [referrer.id]);
  if (!locked.rows[0]) return { applied: false, reason: "unknown" };
  referrer.isBlocked = locked.rows[0].is_blocked;

  // Layer 1 (see the module comment): this transaction must have INSERTed the
  // referee. `now()` is the transaction timestamp, which is also what the
  // row's `created_at DEFAULT now()` got when this transaction created it.
  const referee = (
    await client.query<{ telegram_id: string | null; name: string; fresh: boolean }>(
      "SELECT telegram_id::text AS telegram_id, name, created_at = now() AS fresh FROM users WHERE id = $1",
      [refereeId],
    )
  ).rows[0];
  if (!referee || !referee.fresh || !referee.telegram_id) {
    // Reaching this is a caller bug (the create-branch gate in auth.ts was bypassed).
    log("error", "[referral] mavjud akkaunt uchun taklif chaqirildi — e'tiborsiz qoldirildi", { userId: refereeId, source });
    return { applied: false, reason: "not_new", referrerId: referrer.id };
  }

  const points = referrer.isBlocked ? 0 : REFERRAL_REWARD_POINTS;
  const ref = points > 0 ? referralRewardRef(refereeId) : null;
  const inserted = await client.query(
    `INSERT INTO referrals (referee_user_id, referee_telegram_id, referrer_user_id, source, reward_points, reward_ref)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [refereeId, referee.telegram_id, referrer.id, source, points, ref],
  );
  if (!inserted.rowCount) return { applied: false, reason: "duplicate", referrerId: referrer.id };

  await flagBurstInTx(client, referrer.id);
  if (referrer.isBlocked) return { applied: false, reason: "blocked", referrerId: referrer.id };

  const credited = await topUpInTx(client, referrer.id, { points }, ref!, "bonus", rewardNote(referee.name));
  if (!credited) {
    // The ledger already holds this reference (e.g. a restored ledger): no money moved
    // now, so the row keeps who-invited-whom but claims nothing (review MINOR-2) —
    // the counters (profile, /taklif, admin) sum `reward_points`.
    await client.query("UPDATE referrals SET reward_points = 0, reward_ref = NULL WHERE referee_user_id = $1", [refereeId]);
    log("warn", "[referral] mukofot jurnalda allaqachon bor — qayta yozilmadi", { userId: referrer.id, reference: ref });
    return { applied: false, reason: "duplicate", referrerId: referrer.id };
  }
  // Inside the sign-up transaction: it commits (or rolls back) together with the new account.
  log("info", "[referral] do'st taklifi mukofoti tranzaksiyaga qo'shildi", { userId: referrer.id, refereeId, source, points });
  return { applied: true, referrerId: referrer.id, points };
}

/**
 * D3 burst signal: more than `REFERRAL_BURST_THRESHOLD` referrals by one
 * inviter in 24 h → ONE `error_log` row per inviter per (Tashkent) day, level
 * `error` so the watchdog's «new error type» alert fires once. Nothing is
 * blocked: the owner decided on no cap, only a signal.
 */
async function flagBurstInTx(client: PoolClient, referrerId: string): Promise<void> {
  const n = Number(
    (
      await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM referrals WHERE referrer_user_id = $1 AND created_at > now() - interval '24 hours'",
        [referrerId],
      )
    ).rows[0]!.n,
  );
  if (n <= REFERRAL_BURST_THRESHOLD) return;
  // The fingerprint names the inviter and the day: a resolved row still blocks a second one that day.
  await client.query(
    `INSERT INTO error_log (fingerprint, level, scope, message, user_id)
     SELECT f.fp, 'error', $3, $4, $1
       FROM (SELECT $2::text || ':' || to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS fp) f
      WHERE NOT EXISTS (SELECT 1 FROM error_log e WHERE e.fingerprint = f.fp)
     ON CONFLICT (fingerprint) WHERE resolved_at IS NULL DO NOTHING`,
    [
      referrerId,
      `${REFERRAL_BURST_SCOPE}:${referrerId}`,
      REFERRAL_BURST_SCOPE,
      `Taklif portlashi: #${referrerId} 24 soatda ${n} ta yangi do'st olib keldi (chegara ${REFERRAL_BURST_THRESHOLD}). Soxta akkauntlarni tekshiring.`,
    ],
  );
}

/** A code from a Telegram `/start` / `startapp` payload or from the web cookie, as a claim. */
export function referralClaim(payload: { startParam?: unknown; cookie?: unknown }): ReferralClaim | null {
  const fromStart = refCodeFromStartPayload(payload.startParam);
  if (fromStart) return { code: fromStart, source: "bot" };
  const fromCookie = normalizeRefCode(payload.cookie);
  return fromCookie ? { code: fromCookie, source: "web" } : null;
}

/** The capture cookie's value from a request (`null` when absent or not code-shaped). */
export function refCookieFromRequest(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== REF_COOKIE) continue;
    // Codes are plain [a-z2-9]: no decoding needed, and anything encoded is not a code.
    return normalizeRefCode(part.slice(eq + 1).trim());
  }
  return null;
}

/** Cookie attributes shared by the capture route (set) and the sign-in routes (clear). */
export function refCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: env.isProd, sameSite: "lax" as const, path: REF_COOKIE_PATH, maxAge };
}

/** The request carries an `sx_ref` cookie at all (well-formed or not). */
export function hasRefCookie(req: Request): boolean {
  return new RegExp(`(?:^|;)\\s*${REF_COOKIE}=`).test(req.headers.get("cookie") ?? "");
}

/**
 * Spends the capture cookie once a Telegram sign-in has completed in this
 * browser (review MINOR-4): the person is a user now, and a later stranger on
 * the same device must not be credited to the old code. Route handlers only.
 */
export async function clearRefCookie(req: Request): Promise<void> {
  if (!hasRefCookie(req)) return;
  (await cookies()).set(REF_COOKIE, "", refCookieOptions(0));
}

export type ReferralSummary = {
  code: string;
  botLink: string | null;
  webLink: string;
  rewardPoints: number;
  invitedCount: number;
  earnedPoints: number;
  /** Display names only — never ids, usernames or phones of other people. */
  recent: { name: string; joinedAt: string }[];
};

export const REFERRAL_RECENT_LIMIT = 20;

/** Everything the profile section and `/taklif` show. */
export async function referralSummary(
  userId: string,
  links: { botUsername: string | null; appUrl: string },
): Promise<ReferralSummary> {
  const code = await ensureRefCode(userId);
  const totals = (await queryOne<{ n: string; pts: string }>(
    "SELECT count(*)::text AS n, COALESCE(sum(reward_points), 0)::text AS pts FROM referrals WHERE referrer_user_id = $1",
    [userId],
  ))!;
  const recent = await query<{ name: string | null; created_at: Date }>(
    `SELECT u.name, r.created_at
       FROM referrals r
       LEFT JOIN users u ON u.id = r.referee_user_id
      WHERE r.referrer_user_id = $1
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $2`,
    [userId, REFERRAL_RECENT_LIMIT],
  );
  return {
    code,
    botLink: referralBotLink(links.botUsername, code),
    webLink: referralWebLink(links.appUrl, code),
    rewardPoints: REFERRAL_REWARD_POINTS,
    invitedCount: Number(totals.n),
    earnedPoints: Number(totals.pts),
    recent: recent.map((r) => ({
      name: (r.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "Foydalanuvchi",
      joinedAt: new Date(r.created_at).toISOString(),
    })),
  };
}

/** Admin user detail (read-only): who invited this user, how many they invited. */
export type AdminReferralInfo = {
  referredBy: { id: string | null; name: string; source: ReferralSource; at: string; rewardPoints: number } | null;
  invitedCount: number;
  earnedPoints: number;
};

export async function adminReferralInfo(db: Pick<PoolClient, "query">, userId: string): Promise<AdminReferralInfo> {
  const by = (
    await db.query<{ id: string | null; name: string | null; source: ReferralSource; created_at: Date; reward_points: number }>(
      `SELECT r.referrer_user_id::text AS id, u.name, r.source, r.created_at, r.reward_points
         FROM referrals r LEFT JOIN users u ON u.id = r.referrer_user_id
        WHERE r.referee_user_id = $1`,
      [userId],
    )
  ).rows[0];
  const totals = (
    await db.query<{ n: string; pts: string }>(
      "SELECT count(*)::text AS n, COALESCE(sum(reward_points), 0)::text AS pts FROM referrals WHERE referrer_user_id = $1",
      [userId],
    )
  ).rows[0]!;
  return {
    referredBy: by
      ? { id: by.id, name: by.name ?? "", source: by.source, at: new Date(by.created_at).toISOString(), rewardPoints: Number(by.reward_points) }
      : null,
    invitedCount: Number(totals.n),
    earnedPoints: Number(totals.pts),
  };
}
