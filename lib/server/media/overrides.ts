import "server-only";
import type { PoolClient } from "pg";
import { isValidMarkup } from "../../studio-core";
import { MEDIA_CATALOG } from "../../media/catalog";
import { query } from "../db";
import { log } from "../log";

/**
 * Admin per-model overrides of the media catalog (migration 066 `media_model_overrides`, docs/studio/P1-SPEC.md):
 * `enabled = false` hides a model (availability), `markup` replaces the global `media.markup` for its price.
 *
 * Read side: the whole table (one row per touched model, a handful) in a 30 s per-process cache, the `pricing.ts`
 * pattern. A write invalidates this process's cache after COMMIT (`invalidateMediaOverrides`); other processes see it
 * within 30 s, and the `expectedPrice` guard of `POST /api/generations` stops a charge the user did not see meanwhile.
 * Rows are re-validated on read (unknown model id, markup outside 1–20 → ignored); a failing read never throws into
 * product code: the last good snapshot, else no overrides (every model on, global markup).
 */

export type ModelOverride = { enabled: boolean | null; markup: number | null; updatedBy: string | null; updatedAt: string };
export type OverrideMap = ReadonlyMap<string, ModelOverride>;

type Row = { model_id: string; enabled: boolean | null; markup: string | number | null; updated_by: string | null; updated_at: Date };

const TTL_MS = 30_000;
const ERROR_RETRY_MS = 5_000;

type Cache = { values: OverrideMap | null; expiresAt: number; version: number; inflight: Promise<OverrideMap | null> | null };
const g = globalThis as typeof globalThis & { __slaydxMediaOverrides?: Cache };
const cache = (): Cache => (g.__slaydxMediaOverrides ??= { values: null, expiresAt: 0, version: 0, inflight: null });

export function rowToOverride(r: Row): ModelOverride | null {
  if (!MEDIA_CATALOG.byId(r.model_id)) return null;
  const markup = r.markup === null ? null : Number(r.markup);
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : null,
    markup: markup !== null && isValidMarkup(markup) ? markup : null,
    updatedBy: r.updated_by,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

const SELECT = "SELECT model_id, enabled, markup, updated_by, updated_at FROM media_model_overrides";

function toMap(rows: readonly Row[]): Map<string, ModelOverride> {
  const out = new Map<string, ModelOverride>();
  for (const r of rows) {
    const o = rowToOverride(r);
    if (o) out.set(r.model_id, o);
    else log("warn", "[media] media_model_overrides: unknown model row ignored", { modelId: String(r.model_id).slice(0, 80) });
  }
  return out;
}

/** Every override, fresh (no cache) — the admin page and the write path. */
export async function readOverrides(db?: Pick<PoolClient, "query">): Promise<Map<string, ModelOverride>> {
  const rows = db ? (await db.query<Row>(SELECT)).rows : await query<Row>(SELECT);
  return toMap(rows);
}

/** Cached snapshot (≤ 30 s). Never throws because of the database. */
export async function mediaOverrides(): Promise<OverrideMap> {
  const c = cache();
  if (Date.now() < c.expiresAt) return c.values ?? new Map();
  if (!c.inflight) {
    const version = c.version;
    const p = query<Row>(SELECT).then(
      (rows) => {
        const map = toMap(rows);
        if (c.version === version) {
          c.values = map;
          c.expiresAt = Date.now() + TTL_MS;
        }
        return map as OverrideMap;
      },
      (err: unknown) => {
        log("warn", "[media] media_model_overrides o'qilmadi — oxirgi qiymatlar yoki standart ishlatiladi", { err });
        if (c.version === version) c.expiresAt = Date.now() + ERROR_RETRY_MS;
        return c.values;
      },
    );
    c.inflight = p;
    void p.finally(() => {
      if (c.inflight === p) c.inflight = null;
    });
  }
  return (await c.inflight) ?? new Map();
}

/** After the transaction that wrote `media_model_overrides` has committed. */
export function invalidateMediaOverrides(): void {
  const c = cache();
  c.version++;
  c.expiresAt = 0;
  c.inflight = null;
}
