import "server-only";
import { applyPriceAdjust, basePriceFor, isPriceAdjust, TOOL_BY_ID } from "../tools";
import type { PriceAdjust, PriceAdjustMap } from "../tools";
import type { FormValues, ToolConfig, ToolId } from "../types";
import { query } from "./db";
import { log } from "./log";

/**
 * Admin price adjustments read side (docs/admin/02-plan.md §17.2, §17.7).
 *
 * `tool_pricing` holds at most one row per tool. The whole table (a few dozen
 * rows at most) is loaded with one query into a 15 s per-process cache; a
 * write invalidates the cache of the process that made it (the admin route
 * calls `invalidatePricingCache()` after COMMIT) and other processes pick the
 * change up within 15 s.
 *
 * Safety: rows are re-validated on read (bounds of the 032 CHECK constraints,
 * tool id in the registry); an invalid row is ignored, i.e. that tool stays at
 * its base price. A failing read never throws into product code: it logs and
 * keeps the last good snapshot, or — when there is none — applies no
 * adjustment. Whatever this returns, the `expectedPrice` guard in
 * `POST /api/generations` stops a charge the user did not see.
 */

type Row = { tool_id: string; percent: number; round_to: number };

/** Validated, non-default adjustments by tool (100 % rows are no-ops and left out). */
type Snapshot = Map<ToolId, PriceAdjust>;

type Cache = {
  values: Snapshot | null;
  /** Epoch ms after which the snapshot is reloaded. */
  expiresAt: number;
  /** Bumped by `invalidatePricingCache`; a load started earlier is discarded. */
  version: number;
  inflight: Promise<Snapshot | null> | null;
};

const TTL_MS = 15_000;
/** After a failed load: retry no sooner than this (do not hammer a sick DB). */
const ERROR_RETRY_MS = 5_000;

// On globalThis: Next dev reloads modules, and a second module instance must
// share the snapshot that `invalidatePricingCache` clears.
const g = globalThis as typeof globalThis & { __slaydxPricingCache?: Cache };

function cache(): Cache {
  return (g.__slaydxPricingCache ??= { values: null, expiresAt: 0, version: 0, inflight: null });
}

function isToolId(v: string): v is ToolId {
  return Object.prototype.hasOwnProperty.call(TOOL_BY_ID, v);
}

/** Rows are validated once per load, so a bad row logs every 15 s, not per request. */
function toSnapshot(rows: Row[]): Snapshot {
  const out: Snapshot = new Map();
  for (const r of rows) {
    // pg returns INT4 as a JS number; Number() also tolerates a driver that returns strings.
    const adj = { percent: Number(r.percent), roundTo: Number(r.round_to) };
    if (!isToolId(r.tool_id) || !isPriceAdjust(adj)) {
      log("warn", "[pricing] yaroqsiz tool_pricing qatori — bazaviy narx ishlatiladi", {
        toolId: String(r.tool_id).slice(0, 64),
        percent: r.percent,
        roundTo: r.round_to,
      });
      continue;
    }
    if (adj.percent !== 100) out.set(r.tool_id, { percent: adj.percent, roundTo: adj.roundTo });
  }
  return out;
}

async function loadSnapshot(): Promise<Snapshot | null> {
  const c = cache();
  // Fresh snapshot, or backing off after an error (then `values` may be null).
  if (Date.now() < c.expiresAt) return c.values;
  if (c.inflight) return c.inflight;
  const version = c.version;
  const p: Promise<Snapshot | null> = query<Row>("SELECT tool_id, percent, round_to FROM tool_pricing").then(
    (rows) => {
      const snap = toSnapshot(rows);
      if (c.version === version) {
        c.values = snap;
        c.expiresAt = Date.now() + TTL_MS;
      }
      return snap;
    },
    (err: unknown) => {
      log("warn", "[pricing] tool_pricing o'qilmadi — oxirgi narxlar yoki bazaviy narx ishlatiladi", { err });
      if (c.version === version) c.expiresAt = Date.now() + ERROR_RETRY_MS;
      return c.values;
    },
  );
  c.inflight = p;
  void p.finally(() => {
    if (c.inflight === p) c.inflight = null;
  });
  return p;
}

/**
 * Drops the snapshot freshness so the next read reloads. Call after the
 * transaction that wrote `tool_pricing` has committed. The last snapshot is
 * kept only as the fallback for a failing reload.
 */
export function invalidatePricingCache(): void {
  const c = cache();
  c.version++;
  c.expiresAt = 0;
  c.inflight = null;
}

/** Adjustment of one tool, or `null` = base price. Never throws because of the database. */
export async function getToolPricing(toolId: ToolId): Promise<PriceAdjust | null> {
  const snap = await loadSnapshot();
  const adj = snap?.get(toolId);
  return adj ? { ...adj } : null;
}

/**
 * Every non-default adjustment (for `GET /api/auth/session` `features.pricing`).
 * Empty object when no tool is adjusted. Never throws because of the database.
 */
export async function getAllToolPricing(): Promise<PriceAdjustMap> {
  const snap = await loadSnapshot();
  const out: PriceAdjustMap = {};
  if (snap) for (const [id, adj] of snap) out[id] = { ...adj };
  return out;
}

/**
 * The price the server charges: the code formula (`basePriceFor`, never the
 * browser-only client registry) with the tool's admin adjustment applied.
 */
export async function effectivePrice(tool: ToolConfig, values: FormValues): Promise<number> {
  return applyPriceAdjust(basePriceFor(tool, values), await getToolPricing(tool.id));
}
