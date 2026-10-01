import "server-only";
import { ApiError } from "./api";
import { adminTx, type AuditActor } from "./admin-audit";
import {
  buildKeyset,
  countCapped,
  keysetSelect,
  likePrefix,
  pageResult,
  parseListParams,
  type ListSpec,
} from "./admin-list";
import { readOnlyTx } from "./admin-system";

/**
 * Persisted error log for the admin panel (docs/admin/02-plan.md §6.11, §7.1 S16).
 *
 * Rows are written by `error-sink.ts` (one OPEN row per fingerprint, enforced
 * by the partial unique index `error_log_open_fp_idx`). This module lists and
 * shows them and resolves them. Resolving frees the fingerprint: the next
 * occurrence inserts a NEW open row, so a regression after a fix is visible.
 *
 * The list never selects `stack` (up to 8 KB per row); only the detail does.
 */

export const ERROR_LEVELS = ["error", "warn"] as const;
export const BULK_RESOLVE_MAX = 100;
const REASON_MIN = 5;
const REASON_MAX = 500;
const MAX_SCOPE_CHARS = 64;
const MAX_QUERY_CHARS = 120;

export type ErrorItem = {
  id: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
  level: "error" | "warn";
  scope: string;
  message: string;
  requestId: string | null;
  userId: string | null;
  jobId: string | null;
  path: string | null;
  process: string | null;
  resolvedAt: string | null;
  /** `admin_accounts.id` of the resolver (`null` while open, or when that account is gone). */
  resolvedBy: string | null;
};

export type ErrorDetail = ErrorItem & { stack: string | null };

export type ErrorList = {
  items: ErrorItem[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

type ErrorRow = {
  id: string;
  fingerprint: string;
  first_seen_at: Date;
  last_seen_at: Date;
  count: number;
  level: "error" | "warn";
  scope: string;
  message: string;
  request_id: string | null;
  user_id: string | null;
  job_id: string | null;
  path: string | null;
  process: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
};

/** Constant column list shared by list and detail (`stack` is added by the detail only). */
const ERROR_COLUMNS = `e.id::text AS id, e.fingerprint, e.first_seen_at, e.last_seen_at, e.count, e.level, e.scope, e.message,
       e.request_id, e.user_id::text AS user_id, e.job_id, e.path, e.process, e.resolved_at, e.resolved_by::text AS resolved_by`;

const SPEC = {
  sorts: { last_seen_desc: { column: "e.last_seen_at", dir: "DESC", type: "timestamptz" } },
  id: { column: "e.id", type: "bigint" },
  filters: {
    level: { kind: "enum", values: ERROR_LEVELS },
    resolved: { kind: "flag" },
  },
  range: { maxDays: 366 },
} as const satisfies ListSpec;

function toItem(r: ErrorRow): ErrorItem {
  return {
    id: r.id,
    fingerprint: r.fingerprint,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    count: r.count,
    level: r.level,
    scope: r.scope,
    message: r.message,
    requestId: r.request_id,
    userId: r.user_id,
    jobId: r.job_id,
    path: r.path,
    process: r.process,
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    resolvedBy: r.resolved_by,
  };
}

/** Single-valued text param; a repeated param or an over-long / NUL-carrying value is a 400. */
function textParam(url: URL, name: string, max: number): string | null {
  const all = url.searchParams.getAll(name);
  if (all.length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
  const raw = all[0];
  if (raw === undefined) return null;
  const v = raw.trim();
  if (v === "") return null;
  if (v.length > max || v.includes("\0")) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
  return v;
}

/** `error_log.id` from a URL segment or a JSON value: positive int64 digits, nothing else. */
export function parseErrorId(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw);
  if (!/^[1-9]\d{0,18}$/.test(s)) return null;
  return BigInt(s) <= BigInt("9223372036854775807") ? s : null;
}

/** `GET /api/admin/errors`: filters level, scope (exact), resolved, from/to (last seen), q (message prefix). */
export async function listErrors(url: URL): Promise<ErrorList> {
  const p = parseListParams(url, SPEC);
  const scope = textParam(url, "scope", MAX_SCOPE_CHARS);
  const q = textParam(url, "q", MAX_QUERY_CHARS);

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (p.filters.level) add((n) => `e.level = $${n}`, p.filters.level);
  if (p.filters.resolved !== undefined) where.push(p.filters.resolved ? "e.resolved_at IS NOT NULL" : "e.resolved_at IS NULL");
  if (scope !== null) add((n) => `e.scope = $${n}`, scope);
  if (q !== null) add((n) => `e.message ILIKE $${n} ESCAPE '\\'`, likePrefix(q));
  if (p.range) {
    add((n) => `e.last_seen_at >= $${n}::timestamptz`, p.range!.fromTs);
    add((n) => `e.last_seen_at < $${n}::timestamptz`, p.range!.toTsExclusive);
  }
  const fromWhere = `FROM error_log e WHERE ${where.length ? where.join(" AND ") : "TRUE"}`;

  return readOnlyTx(async (client) => {
    const ks = buildKeyset({ sort: p.sort, cursor: p.cursor, id: SPEC.id, paramOffset: params.length });
    const rows = await client.query<ErrorRow & { cursor_v: string | null; cursor_id: string }>(
      `SELECT ${ERROR_COLUMNS}, ${keysetSelect(p.sort, SPEC.id)}
         ${fromWhere} AND ${ks.where}
        ORDER BY ${ks.orderBy}
        LIMIT $${params.length + ks.params.length + 1}`,
      [...params, ...ks.params, p.limit + 1],
    );
    const { items, nextCursor } = pageResult(rows.rows, p.limit, p.sort);
    const count = await countCapped(client, fromWhere, params);
    return {
      items: items.map((r) => toItem(r as unknown as ErrorRow)),
      nextCursor,
      total: count.total,
      totalCapped: count.totalCapped,
    };
  });
}

function notFound(): ApiError {
  return new ApiError("Xato topilmadi", 404, { code: "not_found" });
}

/** `GET /api/admin/errors/:id`: the row with its stack. A bad id is a 404, never a 500. */
export async function getError(rawId: unknown): Promise<ErrorDetail> {
  const id = parseErrorId(rawId);
  if (!id) throw notFound();
  const row = await readOnlyTx(async (client) => {
    const res = await client.query<ErrorRow & { stack: string | null }>(
      `SELECT ${ERROR_COLUMNS}, e.stack FROM error_log e WHERE e.id = $1`,
      [id],
    );
    return res.rows[0];
  });
  if (!row) throw notFound();
  return { ...toItem(row), stack: row.stack };
}

/** Optional audit reason: absent or blank is fine; anything else must be 5..500 characters. */
export function parseOptionalReason(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new ApiError("Sabab matn bo'lishi kerak", 400);
  const s = raw.trim();
  if (s === "") return null;
  if (s.length < REASON_MIN || s.length > REASON_MAX) {
    throw new ApiError(`Sabab ${REASON_MIN} dan ${REASON_MAX} gacha belgi bo'lishi kerak`, 400);
  }
  return s;
}

/**
 * `POST /api/admin/errors/:id/resolve`. Resolving an already-resolved row is a
 * no-op: no error and no audit row (nothing changed). A real change writes
 * exactly one `errors.resolve` row in the same transaction.
 */
export async function resolveError(admin: AuditActor, rawId: unknown, rawReason: unknown): Promise<ErrorDetail> {
  const id = parseErrorId(rawId);
  if (!id) throw notFound();
  const reason = parseOptionalReason(rawReason);
  await adminTx(admin, async (client, audit) => {
    // Only an open row is updated, so two racing resolvers produce one winner and one audit row.
    const done = await client.query<{ fingerprint: string; scope: string; count: number }>(
      `UPDATE error_log SET resolved_at = now(), resolved_by = $2
        WHERE id = $1 AND resolved_at IS NULL
        RETURNING fingerprint, scope, count`,
      [id, admin.id],
    );
    const row = done.rows[0];
    if (row) {
      await audit({
        action: "errors.resolve",
        targetType: "error",
        targetId: id,
        reason,
        before: { resolved: false },
        after: { resolved: true },
        meta: { fingerprint: row.fingerprint, scope: row.scope, count: row.count },
      });
      return;
    }
    const exists = await client.query(`SELECT 1 FROM error_log WHERE id = $1`, [id]);
    if (exists.rowCount === 0) throw notFound();
  });
  return getError(id);
}

/** Validates `{ids}` of the bulk resolve: 1..100 distinct valid ids. */
export function parseBulkIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError("Kamida bitta xato tanlang", 400);
  if (raw.length > BULK_RESOLVE_MAX) throw new ApiError(`Bir vaqtda ${BULK_RESOLVE_MAX} tadan ko'p xatoni belgilab bo'lmaydi`, 400);
  const ids = new Set<string>();
  for (const v of raw) {
    const id = parseErrorId(v);
    if (!id) throw new ApiError("Xato identifikatori noto'g'ri", 400);
    ids.add(id);
  }
  return [...ids];
}

/**
 * `POST /api/admin/errors/resolve`: resolves every OPEN row among `ids` and
 * writes ONE audit row listing the requested and the actually resolved ids.
 * Unknown or already-resolved ids are skipped; when nothing changed there is
 * no audit row.
 */
export async function resolveErrors(admin: AuditActor, rawIds: unknown, rawReason: unknown): Promise<{ resolved: number }> {
  const ids = parseBulkIds(rawIds);
  const reason = parseOptionalReason(rawReason);
  return adminTx(admin, async (client, audit) => {
    const done = await client.query<{ id: string }>(
      `UPDATE error_log SET resolved_at = now(), resolved_by = $2
        WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL
        RETURNING id::text AS id`,
      [ids, admin.id],
    );
    const resolvedIds = done.rows.map((r) => r.id).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    if (resolvedIds.length > 0) {
      await audit({
        action: "errors.resolve",
        targetType: "error",
        targetId: null,
        reason,
        before: { resolved: false },
        after: { resolved: true },
        meta: { ids, resolvedIds, resolved: resolvedIds.length },
      });
    }
    return { resolved: resolvedIds.length };
  });
}
