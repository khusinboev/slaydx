import "server-only";
import { ApiError } from "./api";
import { query, queryOne } from "./db";
import { log } from "./log";
import { getSetting } from "./settings";

/**
 * Public offer (oferta) acceptance -- owner decision D6 (docs/program-17/PLAN.md item 12).
 *
 * The gate is behind the setting `oferta.gate_enabled` (OFF on deploy). With it off nothing here changes
 * behaviour: `assertOfferAccepted` returns, `offerStatus().required` is false. With it on, a user whose
 * `users.offer_version` is below the current `oferta.version` (or NULL) cannot create work or start a
 * payment (`assertOfferAccepted` -> 403 `offer_required`) until `acceptOffer`. Admin accounts are exempt
 * (same rule as the mandatory-channels gate). Reads, login and payment-provider webhooks are never gated:
 * only the two call sites (POST /api/generations, payment order creation) call `assertOfferAccepted`.
 */

export const OFFER_REQUIRED_MESSAGE = "Davom etish uchun ommaviy ofertani qabul qiling";

export type OfertaConfig = {
  /** The gate is effectively on: the flag AND non-empty requisites (a public text without them has a hole). */
  enabled: boolean;
  version: number;
  requisites: string;
};

export async function ofertaConfig(): Promise<OfertaConfig> {
  const [flag, version, requisites] = await Promise.all([
    getSetting("oferta.gate_enabled"),
    getSetting("oferta.version"),
    getSetting("oferta.requisites"),
  ]);
  return { enabled: flag && requisites.trim() !== "", version, requisites };
}

export type OfferStatus = {
  /** The user must accept before creating work / paying (gate on, not accepted the current version, not an admin). */
  required: boolean;
  /** The current offer version. */
  version: number;
  /** The version the user accepted (null = never). */
  acceptedVersion: number | null;
};

type Row = { offer_version: number | null; admin: boolean };

async function userRow(userId: string): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT u.offer_version,
            EXISTS (SELECT 1 FROM admin_accounts a WHERE a.user_id = u.id AND a.status <> 'disabled') AS admin
       FROM users u WHERE u.id = $1`,
    [userId],
  );
}

/** Whether `acceptedVersion` satisfies the current `version`. */
export function isAccepted(acceptedVersion: number | null, version: number): boolean {
  return acceptedVersion !== null && acceptedVersion >= version;
}

export async function offerStatus(userId: string, config?: OfertaConfig): Promise<OfferStatus> {
  const cfg = config ?? (await ofertaConfig());
  if (!cfg.enabled) {
    return { required: false, version: cfg.version, acceptedVersion: null };
  }
  const row = await userRow(userId);
  if (!row) return { required: false, version: cfg.version, acceptedVersion: null };
  return {
    required: !row.admin && !isAccepted(row.offer_version, cfg.version),
    version: cfg.version,
    acceptedVersion: row.offer_version,
  };
}

/**
 * THE gate: 403 `offer_required` when the offer must be accepted first. Called by generation submit and
 * payment-order creation only. A replayed (already created) generation is answered by the caller before
 * this runs, like the mandatory-channel gate.
 */
export async function assertOfferAccepted(userId: string): Promise<void> {
  const s = await offerStatus(userId);
  if (s.required) throw new ApiError(OFFER_REQUIRED_MESSAGE, 403, { code: "offer_required", version: s.version });
}

/**
 * Records the acceptance of the CURRENT version. Idempotent: a user who already accepted this (or a later)
 * version keeps the original timestamp. Works with the gate off too (a user may accept ahead of time).
 */
export async function acceptOffer(userId: string): Promise<{ version: number }> {
  const version = await getSetting("oferta.version");
  const rows = await query<{ id: string }>(
    `UPDATE users SET offer_version = $2, offer_accepted_at = now()
      WHERE id = $1 AND (offer_version IS NULL OR offer_version < $2)
      RETURNING id`,
    [userId, version],
  );
  if (rows.length) log("info", "[oferta] accepted", { userId, version });
  return { version };
}
