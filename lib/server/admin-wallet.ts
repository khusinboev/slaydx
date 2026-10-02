import "server-only";
import { ApiError } from "./api";
import { adminAdjustWalletInTx, type Wallet } from "./credits";
import { getSetting } from "./settings";
import { parseReason } from "./admin-accounts";
import type { AdminActor } from "./admin-handler";
import { bodyHashOf, idempotencyConflict, idempotentMutation, type IdempotentResult } from "./admin-idempotency";
import { assertMayActOn } from "./admin-users";

/**
 * Admin wallet adjustment (docs/admin/02-plan.md §6.4, §10 T13).
 *
 *   - one ledger row (`admin_credit` / `admin_debit`) with
 *     `reference = 'admin:' || <idempotency uuid>` — the existing
 *     `UNIQUE (kind, reference)` is the last line of defence against a double
 *     write — and the neutral user-visible note "Ma'muriy tuzatish";
 *   - the actor, the reason and the reason code live only in the audit row;
 *   - an admin never adjusts their own wallet (409 `self`), and an active or
 *     pending admin account's wallet only within `admins.manage` rank limits
 *     (403 `admin_target`, the same `assertMayActOn` rule as blocking);
 *   - above `admin.wallet_confirm_threshold` the formatted amount must be
 *     typed back (400 `confirm`);
 *   - only `points` and `balance` are adjustable: subscriptions are removed and
 *     migration 034 merged every legacy `quota` into `balance`, so a new quota
 *     credit would recreate a wallet nothing sells any more (400).
 */

/** The adjustable wallets; `quota` stays in `Wallet` and in the snapshot as read-only history. */
export type AdjustableWallet = Exclude<Wallet, "quota">;
export const WALLETS: readonly AdjustableWallet[] = ["points", "balance"];
export const WALLET_REASON_CODES = ["compensation", "promo", "correction", "manual_refund", "test", "other"] as const;
export type WalletReasonCode = (typeof WALLET_REASON_CODES)[number];

/** Hard cap per request (a bigger number is almost certainly a typo). */
export const MAX_DELTA = 100_000_000;
/** The user-visible ledger note of every admin adjustment (migration 031 rewrites legacy rows to it). */
export const ADMIN_LEDGER_NOTE = "Ma'muriy tuzatish";

export type WalletAdjustInput = {
  wallet: AdjustableWallet;
  delta: number;
  reasonCode: WalletReasonCode;
  reason: string;
  confirm: string | null;
};

export type WalletUserSnapshot = {
  id: string;
  name: string;
  username: string | null;
  points: number;
  quota: number;
  balance: number;
};

export type WalletAdjustResponse = {
  transactionId: string;
  wallet: AdjustableWallet;
  before: number;
  after: number;
  user: WalletUserSnapshot;
};

function isWallet(v: unknown): v is AdjustableWallet {
  return typeof v === "string" && (WALLETS as readonly string[]).includes(v);
}

function isReasonCode(v: unknown): v is WalletReasonCode {
  return typeof v === "string" && (WALLET_REASON_CODES as readonly string[]).includes(v);
}

/** Every field is validated from `unknown`; nothing else in the body is read. */
export function parseWalletAdjustBody(body: Record<string, unknown>): WalletAdjustInput {
  if (!isWallet(body.wallet)) throw new ApiError(`Hamyon noto'g'ri. Kerak: ${WALLETS.join(" | ")}`, 400);
  const delta = body.delta;
  if (typeof delta !== "number" || !Number.isSafeInteger(delta) || delta === 0) {
    throw new ApiError("Miqdor butun va noldan farqli son bo'lishi kerak", 400);
  }
  if (Math.abs(delta) > MAX_DELTA) throw new ApiError("Miqdor juda katta", 400);
  if (!isReasonCode(body.reasonCode)) {
    throw new ApiError(`Sabab turi noto'g'ri. Kerak: ${WALLET_REASON_CODES.join(" | ")}`, 400);
  }
  const reason = parseReason(body.reason)!;
  const confirm = body.confirm === undefined || body.confirm === null ? null : body.confirm;
  if (confirm !== null && typeof confirm !== "string") throw new ApiError("Tasdiq matni satr bo'lishi kerak", 400);
  return { wallet: body.wallet, delta, reasonCode: body.reasonCode, reason, confirm };
}

/** Group separators (regular, NBSP, narrow NBSP) are ignored: `1 000 000` and `1000000` both confirm 1000000. */
export function confirmMatches(confirm: string | null, amount: number): boolean {
  if (confirm === null) return false;
  return confirm.replace(/[\s  ]/g, "") === String(Math.abs(Math.trunc(amount)));
}

export async function adjustWallet(
  actor: AdminActor,
  targetUserId: string,
  input: WalletAdjustInput,
  idempotencyKey: string,
): Promise<IdempotentResult<WalletAdjustResponse>> {
  if (targetUserId === actor.userId) {
    throw new ApiError("O'z hamyoningizni tuzata olmaysiz", 409, { code: "self" });
  }
  const threshold = await getSetting("admin.wallet_confirm_threshold");
  if (Math.abs(input.delta) >= threshold && !confirmMatches(input.confirm, input.delta)) {
    throw new ApiError("Miqdorni tasdiqlash uchun uni aynan yozing", 400, {
      code: "confirm",
      expected: Math.abs(input.delta).toLocaleString("uz-UZ"),
    });
  }
  // The target is part of the action (same key for another user is a conflict,
  // never a replay); `confirm` is a UI guard, so a corrected retry does not conflict.
  const bodyHash = bodyHashOf({ userId: targetUserId, wallet: input.wallet, delta: input.delta, reasonCode: input.reasonCode, reason: input.reason });
  const reference = `admin:${idempotencyKey}`;

  return idempotentMutation<WalletAdjustResponse>(actor, { action: "users.wallet.adjust", key: idempotencyKey, bodyHash }, async (client) => {
    await assertMayActOn(client, actor, targetUserId);
    const res = await client.query<{ id: string; name: string; username: string | null; points: string; quota: string; balance: string }>(
      `SELECT id::text AS id, name, username, points, quota, balance FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId],
    );
    const row = res.rows[0];
    if (!row) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    // Second guard (a key older than the audit lookup window): the unique
    // ledger reference must become a 422, never a 500.
    const taken = await client.query(
      `SELECT 1 FROM transactions WHERE kind IN ('admin_credit', 'admin_debit') AND reference = $1`,
      [reference],
    );
    if (taken.rows[0]) throw idempotencyConflict();

    const r = await adminAdjustWalletInTx(client, {
      userId: targetUserId,
      wallet: input.wallet,
      delta: input.delta,
      reference,
      note: ADMIN_LEDGER_NOTE,
    });
    if (!r.ok) {
      throw new ApiError(`Mablag' yetarli emas. Mavjud: ${r.available.toLocaleString("uz-UZ")}`, 409, {
        code: "insufficient",
        available: r.available,
      });
    }
    const user: WalletUserSnapshot = {
      id: row.id,
      name: row.name,
      username: row.username,
      points: Number(row.points),
      quota: Number(row.quota),
      balance: Number(row.balance),
    };
    user[input.wallet] = r.after;
    return {
      response: { transactionId: r.transactionId, wallet: input.wallet, before: r.before, after: r.after, user },
      audit: {
        targetType: "user",
        targetId: targetUserId,
        reason: input.reason,
        before: { [input.wallet]: r.before },
        after: { [input.wallet]: r.after },
        meta: { reasonCode: input.reasonCode, transactionId: r.transactionId },
      },
    };
  });
}
