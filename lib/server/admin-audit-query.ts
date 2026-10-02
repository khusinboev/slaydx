import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import {
  buildKeyset,
  countCapped,
  decodeCursor,
  keysetSelect,
  likePrefix,
  pageResult,
  parseListParams,
  type KeysetCursor,
  type ListSpec,
  type ParsedList,
} from "./admin-list";
import { readOnlyTx } from "./admin-system";

/**
 * Read side of the admin audit log (docs/admin/02-plan.md §6.12, §7.1 S17, §8).
 *
 * The table is append-only (028 triggers): this module only ever SELECTs.
 * The list never selects `before` / `after` / `meta` (they can be large and
 * hold PII that was the subject of a change); the detail and the CSV do.
 * Filters are whitelisted or exact; free text reaches SQL only as `$n`, and the
 * `action` prefix has its `LIKE` metacharacters escaped (`likePrefix`).
 */

export const AUDIT_OUTCOMES = ["ok", "denied", "failed"] as const;
export type AuditOutcomeValue = (typeof AUDIT_OUTCOMES)[number];

/** Same truncations as the writer (`admin-audit.ts`): longer filter values can never match anything. */
const MAX_ACTION_CHARS = 100;
const MAX_TARGET_TYPE_CHARS = 64;
const MAX_TARGET_ID_CHARS = 200;
const INT64_MAX = BigInt("9223372036854775807");

export type AuditListItem = {
  id: string;
  at: string;
  /** `null` for CLI / system rows. */
  adminId: string | null;
  adminName: string | null;
  adminUsername: string | null;
  /** Role at the time of the action (`admin_audit_log.actor_role`), not today's role. */
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcomeValue;
  reason: string | null;
  ip: string | null;
};

export type AuditDetail = AuditListItem & {
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  requestId: string | null;
  userAgent: string | null;
};

export type AuditList = {
  items: AuditListItem[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

type AuditRow = {
  id: string;
  at: Date;
  admin_id: string | null;
  admin_name: string | null;
  admin_username: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcomeValue;
  reason: string | null;
  ip: string | null;
};

type AuditFullRow = AuditRow & {
  actor_user_id: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  request_id: string | null;
  user_agent: string | null;
};

/** Newest first; `(at, id)` is unique, so rows sharing one timestamp still page deterministically. */
const SPEC = {
  sorts: { at_desc: { column: "l.at", dir: "DESC", type: "timestamptz" } },
  id: { column: "l.id", type: "bigint" },
  filters: { outcome: { kind: "enum", values: AUDIT_OUTCOMES } },
  range: { maxDays: 366 },
} as const satisfies ListSpec;

export type AuditQuery = {
  list: ParsedList<typeof SPEC>;
  adminId: string | null;
  action: string | null;
  targetType: string | null;
  targetId: string | null;
};

/** Narrow list projection: no `before` / `after` / `meta` / `user_agent`. */
const LIST_COLUMNS = `l.id::text AS id, l.at, l.admin_id::text AS admin_id, u.name AS admin_name, u.username AS admin_username,
       l.actor_role, l.action, l.target_type, l.target_id, l.outcome, l.reason, l.ip`;
const FULL_COLUMNS = `${LIST_COLUMNS}, l.actor_user_id::text AS actor_user_id, l.before, l.after, l.meta, l.request_id, l.user_agent`;
const JOINS = `LEFT JOIN admin_accounts a ON a.id = l.admin_id LEFT JOIN users u ON u.id = a.user_id`;

/** Single-valued text param; a repeat, an over-long value or a NUL byte is a 400. */
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

/** Positive int64 digits as text (ids are BIGSERIAL), or `null`. */
export function parseBigintText(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^[1-9]\d{0,18}$/.test(raw)) return null;
  return BigInt(raw) <= INT64_MAX ? raw : null;
}

/** Validates every list / export parameter; bad input is a 400, never a 500. */
export function parseAuditQuery(url: URL): AuditQuery {
  const list = parseListParams(url, SPEC);
  const adminRaw = textParam(url, "adminId", 20);
  const adminId = adminRaw === null ? null : parseBigintText(adminRaw);
  if (adminRaw !== null && adminId === null) throw new ApiError("Noto'g'ri parametr: adminId", 400);
  return {
    list,
    adminId,
    action: textParam(url, "action", MAX_ACTION_CHARS),
    targetType: textParam(url, "targetType", MAX_TARGET_TYPE_CHARS),
    targetId: textParam(url, "targetId", MAX_TARGET_ID_CHARS),
  };
}

/** The filters as stored in the `export.audit` row's `meta.filters` (only what was set). */
export function filtersForAudit(q: AuditQuery): Record<string, unknown> {
  const f = q.list.filters;
  return {
    ...(q.adminId !== null ? { adminId: q.adminId } : {}),
    ...(q.action !== null ? { action: q.action } : {}),
    ...(q.targetType !== null ? { targetType: q.targetType } : {}),
    ...(q.targetId !== null ? { targetId: q.targetId } : {}),
    ...(f.outcome ? { outcome: f.outcome } : {}),
    ...(q.list.range ? { from: q.list.range.fromDay, to: q.list.range.toDay } : {}),
  };
}

/** `FROM ... WHERE ...` (constant text) and its `$n` values; shared by the count, the page and the export. */
function buildWhere(q: AuditQuery): { fromWhere: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (q.adminId !== null) add((n) => `l.admin_id = $${n}::bigint`, q.adminId);
  // Prefix match (`users.` finds every users.* action); `admin_audit_action_idx` serves it under a C collation.
  if (q.action !== null) add((n) => `l.action LIKE $${n} ESCAPE '\\'`, likePrefix(q.action));
  if (q.targetType !== null) add((n) => `l.target_type = $${n}`, q.targetType);
  if (q.targetId !== null) add((n) => `l.target_id = $${n}`, q.targetId);
  if (q.list.filters.outcome) add((n) => `l.outcome = $${n}`, q.list.filters.outcome);
  if (q.list.range) {
    add((n) => `l.at >= $${n}::timestamptz`, q.list.range!.fromTs);
    add((n) => `l.at < $${n}::timestamptz`, q.list.range!.toTsExclusive);
  }
  return { fromWhere: `FROM admin_audit_log l ${JOINS} WHERE ${where.length ? where.join(" AND ") : "TRUE"}`, params };
}

function toItem(r: AuditRow): AuditListItem {
  return {
    id: r.id,
    at: r.at.toISOString(),
    adminId: r.admin_id,
    adminName: r.admin_name,
    adminUsername: r.admin_username,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    outcome: r.outcome,
    reason: r.reason,
    ip: r.ip,
  };
}

function toDetail(r: AuditFullRow): AuditDetail {
  return {
    ...toItem(r),
    actorUserId: r.actor_user_id,
    before: r.before ?? null,
    after: r.after ?? null,
    meta: r.meta ?? null,
    requestId: r.request_id,
    userAgent: r.user_agent,
  };
}

type Page<T> = { items: T[]; nextCursor: string | null };

/** One keyset page. `full` adds `before` / `after` / `meta` / request id / user agent (CSV only). */
async function fetchPage(
  client: Pick<PoolClient, "query">,
  q: AuditQuery,
  cursor: KeysetCursor | null,
  limit: number,
  full: boolean,
): Promise<Page<AuditListItem | AuditDetail>> {
  const { fromWhere, params } = buildWhere(q);
  const sort = q.list.sort;
  const ks = buildKeyset({ sort, cursor, id: SPEC.id, paramOffset: params.length });
  const res = await client.query<(AuditRow | AuditFullRow) & { cursor_v: string | null; cursor_id: string }>(
    `SELECT ${full ? FULL_COLUMNS : LIST_COLUMNS}, ${keysetSelect(sort, SPEC.id)}
       ${fromWhere} AND ${ks.where}
      ORDER BY ${ks.orderBy}
      LIMIT $${params.length + ks.params.length + 1}`,
    [...params, ...ks.params, limit + 1],
  );
  const { items, nextCursor } = pageResult(res.rows, limit, sort);
  return {
    items: items.map((r) => (full ? toDetail(r as unknown as AuditFullRow) : toItem(r as unknown as AuditRow))),
    nextCursor,
  };
}

/** `GET /api/admin/audit`. */
export async function listAudit(url: URL): Promise<AuditList> {
  const q = parseAuditQuery(url);
  return readOnlyTx(async (client) => {
    const page = await fetchPage(client, q, q.list.cursor, q.list.limit, false);
    const { fromWhere, params } = buildWhere(q);
    const count = await countCapped(client, fromWhere, params);
    return { items: page.items as AuditListItem[], nextCursor: page.nextCursor, total: count.total, totalCapped: count.totalCapped };
  });
}

function notFound(): ApiError {
  return new ApiError("Audit yozuvi topilmadi", 404, { code: "not_found" });
}

/** `GET /api/admin/audit/:id`: the full row. A malformed or unknown id is a 404, never a 500. */
export async function getAudit(rawId: unknown): Promise<AuditDetail> {
  const id = parseBigintText(rawId);
  if (!id) throw notFound();
  const row = await readOnlyTx(async (client) => {
    const res = await client.query<AuditFullRow>(`SELECT ${FULL_COLUMNS} FROM admin_audit_log l ${JOINS} WHERE l.id = $1`, [id]);
    return res.rows[0];
  });
  if (!row) throw notFound();
  return toDetail(row);
}

// ---------------------------------------------------------------------------
// CSV export

export const AUDIT_CSV_HEADER = [
  "id",
  "at",
  "at_utc",
  "admin_id",
  "admin_name",
  "admin_username",
  "actor_user_id",
  "actor_role",
  "action",
  "target_type",
  "target_id",
  "outcome",
  "reason",
  "ip",
  "user_agent",
  "request_id",
  "before",
  "after",
  "meta",
] as const;

const TASHKENT_OFFSET_MS = 5 * 3_600_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `DD.MM.YYYY HH:mm:ss` in Asia/Tashkent: audit analysis needs the seconds the shared CSV stamp drops. */
export function tashkentSeconds(d: Date): string {
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";
  const x = new Date(t + TASHKENT_OFFSET_MS);
  return `${pad2(x.getUTCDate())}.${pad2(x.getUTCMonth() + 1)}.${x.getUTCFullYear()} ${pad2(x.getUTCHours())}:${pad2(x.getUTCMinutes())}:${pad2(x.getUTCSeconds())}`;
}

const jsonCell = (v: unknown): string => (v === null || v === undefined ? "" : JSON.stringify(v));

export function csvRowOf(r: AuditDetail): unknown[] {
  return [
    r.id,
    tashkentSeconds(new Date(r.at)),
    r.at,
    r.adminId,
    r.adminName,
    r.adminUsername,
    r.actorUserId,
    r.actorRole,
    r.action,
    r.targetType,
    r.targetId,
    r.outcome,
    r.reason,
    r.ip,
    r.userAgent,
    r.requestId,
    jsonCell(r.before),
    jsonCell(r.after),
    jsonCell(r.meta),
  ];
}

/** Page fetcher for `keysetBatches`: each batch is its own short read-only transaction (plan §9). */
export function exportPageFetcher(q: AuditQuery) {
  return async (cursor: string | null, limit: number): Promise<Page<AuditDetail>> => {
    let decoded: KeysetCursor | null = null;
    if (cursor !== null) {
      decoded = decodeCursor(cursor, q.list.sort, SPEC.id);
      // Cursors here come from `fetchPage` itself, so a bad one is a bug, not user input.
      if (!decoded) throw new Error("admin-audit-query: export cursor did not decode");
    }
    const page = await readOnlyTx((client) => fetchPage(client, q, decoded, limit, true));
    return { items: page.items as AuditDetail[], nextCursor: page.nextCursor };
  };
}
