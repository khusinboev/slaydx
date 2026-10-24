import "server-only";
import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { ChatConfirmCard } from "../../chat/types";
import { PROPOSAL_TTL_MS } from "../../chat/types";
import { TOOL_BY_ID } from "../../tools";
import type { FormValues, ToolId } from "../../types";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { env } from "../env";
import { toJsonb } from "../jsonb";
import { rateLimit } from "../ratelimit";
import { getUserById } from "../session";
import { submitGeneration } from "../submit-generation";
import { canonicalValues, checkProposal, type ProposalCheck } from "./toolspec";

/**
 * Proposal tokens (owner request 8: "the model text can never trigger a charge directly").
 *
 * The assistant only ever produces TEXT and a tool + values suggestion. This module turns a validated suggestion into a
 * `chat_proposals` row and a token that a human tap can present:
 *
 *   token = HMAC-SHA256(SESSION_SECRET, id | user | values hash | expiry)      (43 url-safe chars)
 *
 *   - bound to the user: another account's token finds no row for them;
 *   - bound to the values: the hash covers the canonical values, the tool and the SERVER price, so a changed row or a
 *     tampered `hash` echo fails;
 *   - single use: `used_at` is claimed with one UPDATE, so two taps (or a replay) enqueue one generation at most;
 *   - ten minutes: `expires_at` (checked in SQL) and part of the HMAC;
 *   - only `sha256(token)` is stored; the token can be re-derived for the owner (so a reloaded page can still show the
 *     open card) but never read back from the database.
 *
 * Confirming goes through `submitGeneration` -- the same validation, price guard and one-transaction charge as the form --
 * and any refusal BEFORE the charge (balance, pause, price change) releases the claim so the user can retry or top up.
 */

const SHORT_HASH = 16;

export function valuesHash(tool: string, values: FormValues, price: number): string {
  return createHash("sha256").update(`${tool}\n${price}\n${canonicalValues(values)}`).digest("hex");
}

const KEY_INFO = "slaydx-chat-proposal-token-v1";
let cachedKey: { secret: string; key: Buffer } | null = null;

/** An HKDF subkey of SESSION_SECRET, so the session secret itself never keys this MAC (same pattern as the download tokens). */
function subkey(): Buffer {
  const secret = env.sessionSecret;
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), KEY_INFO, 32));
  cachedKey = { secret, key };
  return key;
}

function tokenFor(id: string, userId: string, hash: string, expiresAtMs: number): string {
  return createHmac("sha256", subkey()).update(`chat-proposal\n${id}\n${userId}\n${hash}\n${expiresAtMs}`).digest("base64url");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A deterministic UUID for the idempotency key of one proposal's generation. */
function idemKey(proposalId: string): string {
  const h = createHash("sha256").update(`chat-proposal-generation\n${proposalId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type ProposalRow = {
  id: string;
  user_id: string;
  token_hash: string;
  tool: string;
  values: FormValues;
  values_hash: string;
  price: number;
  expires_at: string;
  used_at: string | null;
  generation_id: string | null;
};

export type IssuedProposal = { id: string; token: string; hash: string; expiresAt: string };

/** Stores a VALID proposal (`check.ok`) and returns the token. */
export async function issueProposal(userId: string, check: Extract<ProposalCheck, { ok: true }>, now: number = Date.now()): Promise<IssuedProposal> {
  const tool = check.tool.id;
  const hash = valuesHash(tool, check.values, check.price);
  const expiresMs = now + PROPOSAL_TTL_MS;
  // The id is needed inside the token, so the row is created first with a placeholder hash and then bound.
  const row = await queryOne<{ id: string }>(
    `INSERT INTO chat_proposals (user_id, token_hash, tool, values, values_hash, price, expires_at)
     VALUES ($1, md5(random()::text || clock_timestamp()::text), $2, $3::jsonb, $4, $5, $6) RETURNING id::text AS id`,
    [userId, tool, toJsonb(check.values), hash, check.price, new Date(expiresMs)],
  );
  const id = row!.id;
  const token = tokenFor(id, userId, hash, expiresMs);
  await query("UPDATE chat_proposals SET token_hash = $2 WHERE id = $1", [id, sha256(token)]);
  return { id, token, hash: hash.slice(0, SHORT_HASH), expiresAt: new Date(expiresMs).toISOString() };
}

/** The card of a stored proposal for the owner (history reload): open, used or expired. */
export async function cardForProposal(userId: string, proposalId: string): Promise<ChatConfirmCard | null> {
  const row = await queryOne<ProposalRow>(
    `SELECT id::text AS id, user_id::text AS user_id, token_hash, tool, values, values_hash, price,
            expires_at::text AS expires_at, used_at::text AS used_at, generation_id::text AS generation_id
       FROM chat_proposals WHERE id = $1 AND user_id = $2`,
    [proposalId, userId],
  );
  if (!row || !Object.prototype.hasOwnProperty.call(TOOL_BY_ID, row.tool)) return null;
  const tool = TOOL_BY_ID[row.tool as ToolId];
  const expiresMs = new Date(row.expires_at).getTime();
  const state: "open" | "used" | "expired" = row.used_at ? "used" : expiresMs <= Date.now() ? "expired" : "open";
  return {
    kind: "confirm",
    proposalId: row.id,
    tool: tool.id,
    toolTitle: tool.title,
    params: [],
    price: row.price,
    token: state === "open" ? tokenFor(row.id, userId, row.values_hash, expiresMs) : "",
    hash: row.values_hash.slice(0, SHORT_HASH),
    expiresAt: new Date(expiresMs).toISOString(),
    state,
  };
}

export type ConfirmFailure =
  | { ok: false; reason: "invalid" | "used" | "expired" | "tampered" | "rate" | "unavailable" }
  | { ok: false; reason: "adjust"; issues: string[] }
  | { ok: false; reason: "price_changed"; price: number }
  | { ok: false; reason: "insufficient"; required: number; available: number }
  | { ok: false; reason: "refused"; status: number; message: string; code?: string; extra?: Record<string, unknown> }
  | { ok: false; reason: "admission"; message: string; retryAfterSec: number };
export type ConfirmResult = { ok: true; generationId: string; price: number; replayed: boolean } | ConfirmFailure;

async function release(id: string): Promise<void> {
  await query("UPDATE chat_proposals SET used_at = NULL WHERE id = $1 AND generation_id IS NULL", [id]);
}

/**
 * The ONLY way a chat proposal becomes a paid generation: a user's tap that carries the server-issued token and the
 * hash of what the card showed.
 */
export async function confirmProposal(input: { userId: string; token: unknown; hash: unknown }): Promise<ConfirmResult> {
  const { userId } = input;
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const echo = typeof input.hash === "string" ? input.hash.trim().toLowerCase() : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !echo) return { ok: false, reason: "invalid" };

  const row = await queryOne<ProposalRow>(
    `SELECT id::text AS id, user_id::text AS user_id, token_hash, tool, values, values_hash, price,
            expires_at::text AS expires_at, used_at::text AS used_at, generation_id::text AS generation_id
       FROM chat_proposals WHERE token_hash = $1`,
    [sha256(token)],
  );
  // Somebody else's token looks exactly like a wrong one.
  if (!row || row.user_id !== String(userId)) return { ok: false, reason: "invalid" };

  const expiresMs = new Date(row.expires_at).getTime();
  if (!safeEqual(token, tokenFor(row.id, row.user_id, row.values_hash, expiresMs))) return { ok: false, reason: "tampered" };
  if (echo.length < 8 || !row.values_hash.startsWith(echo)) return { ok: false, reason: "tampered" };
  if (valuesHash(row.tool, row.values, row.price) !== row.values_hash) return { ok: false, reason: "tampered" };

  // The same budgets as `POST /api/generations`, shared with it: a chat confirmation is a generation.
  if (!(await rateLimit(`gen:burst:${userId}`, 5, 60)).ok) return { ok: false, reason: "rate" };
  if (!(await rateLimit(`gen:hour:${userId}`, 60, 3600)).ok) return { ok: false, reason: "rate" };

  // Single use: one UPDATE decides which tap wins.
  const claimed = await queryOne<{ id: string }>(
    "UPDATE chat_proposals SET used_at = now() WHERE id = $1 AND used_at IS NULL AND expires_at > now() RETURNING id::text AS id",
    [row.id],
  );
  if (!claimed) {
    // Read the row again: a racing tap may have used it between our SELECT and the claim, and that is "used", not "expired".
    const now = await queryOne<{ used: boolean; expired: boolean }>("SELECT used_at IS NOT NULL AS used, expires_at <= now() AS expired FROM chat_proposals WHERE id = $1", [row.id]);
    return { ok: false, reason: now?.used ? "used" : "expired" };
  }

  try {
    const user = await getUserById(userId);
    if (!user) {
      await release(row.id);
      return { ok: false, reason: "invalid" };
    }
    // The registries or the prices may have moved since the card was shown: validate again, never trust the stored row.
    const check = await checkProposal(row.tool, row.values, user);
    if (!check.ok) {
      await release(row.id);
      return { ok: false, reason: "adjust", issues: check.issues };
    }
    if (check.price !== row.price) {
      await release(row.id);
      return { ok: false, reason: "price_changed", price: check.price };
    }
    const result = await submitGeneration({
      userId,
      tool: check.tool,
      values: check.values,
      idempotencyKey: idemKey(row.id),
      expectedPrice: row.price,
    });
    if (result.kind === "admission") {
      await release(row.id);
      return { ok: false, reason: "admission", message: result.error, retryAfterSec: result.retryAfterSec };
    }
    await query("UPDATE chat_proposals SET generation_id = $2 WHERE id = $1", [row.id, result.id]);
    if (env.worker.inline) (await import("../worker")).startInlineWorker();
    return { ok: true, generationId: result.id, price: result.price, replayed: result.replayed };
  } catch (e) {
    // Nothing was charged when submitGeneration refuses; a crash after the charge is not a refusal (see below).
    if (e instanceof ApiError) {
      await release(row.id);
      if (e.status === 402) {
        return { ok: false, reason: "insufficient", required: Number(e.extra.required) || row.price, available: Number(e.extra.available) || 0 };
      }
      if (e.status === 409 && e.extra.code === "price_changed") return { ok: false, reason: "price_changed", price: Number(e.extra.price) || row.price };
      return { ok: false, reason: "refused", status: e.status, message: e.message, code: typeof e.extra.code === "string" ? e.extra.code : undefined, extra: e.extra };
    }
    // An unexpected error: if the generation exists the charge happened -- keep the claim; otherwise free it.
    const made = await queryOne<{ id: string }>("SELECT id::text AS id FROM generations WHERE user_id = $1 AND idempotency_key = $2", [userId, idemKey(row.id)]);
    if (made) {
      await query("UPDATE chat_proposals SET generation_id = $2 WHERE id = $1", [row.id, made.id]);
      return { ok: true, generationId: made.id, price: row.price, replayed: true };
    }
    await release(row.id);
    throw e;
  }
}

/** The user dismissed the card: the token stops working (no generation, no charge). */
export async function cancelProposal(input: { userId: string; token: unknown }): Promise<boolean> {
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const row = await queryOne<{ id: string }>(
    "UPDATE chat_proposals SET used_at = now() WHERE token_hash = $1 AND user_id = $2 AND used_at IS NULL RETURNING id::text AS id",
    [sha256(token), input.userId],
  );
  return row !== null;
}
