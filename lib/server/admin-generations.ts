import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { transaction } from "./db";
import { env } from "./env";
import { adminTx, writeDeniedAudit } from "./admin-audit";
import type { AdminActor } from "./admin-handler";
import { spendForJobs } from "./admin-cost";
import {
  buildKeyset,
  countCapped,
  decodeCursor,
  keysetSelect,
  pageResult,
  parseListParams,
  type CursorColumns,
  type ListSpec,
  type ParsedList,
} from "./admin-list";
import { maskValues } from "./admin-mask";
import { can } from "./admin-rbac";
import { TOOLS, TOOL_BY_ID } from "../tools";

/**
 * Admin generations (jobs) read side: list, CSV export, detail, file
 * (docs/admin/02-plan.md §6.5 GET rows, §7.1 S6/S7, §9).
 *
 * Mutations (cancel / fail / refund) live in `admin-job-actions.ts`.
 *
 * Rules kept here:
 *   - the list never touches a wide column (`values_json`, `html`, `doc_json`,
 *     `doc_prev`, `live_json`, file bytes); it reads the same narrow set as
 *     `SUMMARY_COLUMNS` in jobs.ts plus the lease/budget columns;
 *   - per-job AI cost comes from `admin-cost.ts` `spendForJobs` (the canonical
 *     spend rule, looked up by job id), so a job's figure here always adds up
 *     to the dashboard / AI-cost totals;
 *   - every read runs in a READ ONLY transaction with a 10 s statement timeout
 *     (§9, T18), so a pathological filter cannot hold a pool connection.
 */

export const GENERATION_STATUSES = ["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED", "REVOKED"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

const TOOL_IDS: readonly string[] = Object.freeze(Object.keys(TOOL_BY_ID));

/** `{ value: toolId, label: title }` for the tool filter; server pages pass it to the client table. */
export function adminToolOptions(): Array<{ value: string; label: string }> {
  return TOOLS.map((t) => ({ value: t.id, label: t.title }));
}

export const GENERATIONS_LIST_SPEC = {
  sorts: {
    created_desc: { column: "g.created_at", dir: "DESC", type: "timestamptz" },
    created_asc: { column: "g.created_at", dir: "ASC", type: "timestamptz" },
    // Not indexed (an expression over two columns); acceptable at today's size, see §9.
    duration_desc: { column: "g.duration_ms", dir: "DESC", type: "bigint", nullable: true },
  },
  id: { column: "g.id", type: "uuid" },
  filters: {
    status: { kind: "enumList", values: GENERATION_STATUSES },
    tool: { kind: "enum", values: TOOL_IDS },
    userId: { kind: "int", min: 1, max: Number.MAX_SAFE_INTEGER },
    hasError: { kind: "flag" },
    unrefunded: { kind: "flag" },
    stuck: { kind: "flag" },
  },
  range: {},
} as const satisfies ListSpec;

export type GenerationsListParams = ParsedList<typeof GENERATIONS_LIST_SPEC>;

/** Validates the list query (400 on any bad value; nothing reaches SQL unchecked). */
export function parseGenerationsQuery(url: URL): GenerationsListParams {
  return parseListParams(url, GENERATIONS_LIST_SPEC);
}

/** The filters as they were requested, for the export audit row (`meta.filters`). */
export function filtersForAudit(p: GenerationsListParams): Record<string, unknown> {
  const f = p.filters;
  return {
    sort: p.sortKey,
    ...(f.status ? { status: f.status } : {}),
    ...(f.tool ? { tool: f.tool } : {}),
    ...(f.userId !== undefined ? { userId: String(f.userId) } : {}),
    ...(f.hasError !== undefined ? { hasError: f.hasError } : {}),
    ...(f.unrefunded ? { unrefunded: true } : {}),
    ...(f.stuck ? { stuck: true } : {}),
    ...(p.range ? { from: p.range.fromDay, to: p.range.toDay } : {}),
  };
}

// ---------------------------------------------------------------------------
// SQL building blocks (constant text; user values only ever travel as $n)

/**
 * Narrow projection of `generations` with the derived duration. A plain
 * subquery: Postgres pulls it up, so `ORDER BY g.created_at` still walks
 * `generations_created_idx`.
 */
const BASE = `(SELECT id, user_id, tool_id, topic, status, price, progress, attempts, error,
         created_at, started_at, finished_at, locked_at, budget_ms, files_purged_at,
         CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL
              THEN (EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::bigint END AS duration_ms
    FROM generations)`;

/**
 * Stuck = IN_PROGRESS whose lease is older than its own budget + 30 s, the
 * exact rule of `reclaimStaleJobs` (jobs.ts; legacy rows with `budget_ms = 0`
 * use the global job timeout, `$n`). An IN_PROGRESS row with no lease at all is
 * an orphan nothing will ever reclaim, so it counts as stuck too.
 */
const stuckSql = (alias: string, timeoutParam: number): string =>
  `(${alias}.status = 'IN_PROGRESS' AND (${alias}.locked_at IS NULL OR ${alias}.locked_at < now() - make_interval(secs =>
      (CASE WHEN ${alias}.budget_ms > 0 THEN ${alias}.budget_ms / 1000 ELSE $${timeoutParam}::int END) + 30)))`;

/** The charge row of a job counts only when non-zero, as in `refundInTx`. */
const CHARGED = `EXISTS (SELECT 1 FROM transactions c2 WHERE c2.kind = 'charge' AND c2.reference = g.id::text
      AND (c2.points_delta + c2.quota_delta + c2.balance_delta) <> 0)`;
const REFUNDED = `EXISTS (SELECT 1 FROM transactions r2 WHERE r2.kind = 'refund' AND r2.reference = g.id::text)`;

const jobTimeoutSec = (): number => Math.round(env.worker.jobTimeoutMs / 1000);

type Queryable = Pick<PoolClient, "query">;

async function readOnly<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    return fn(client);
  });
}

/**
 * `$n` parameter list. The job-timeout parameter of the stuck rule is added
 * lazily, so a query that does not use it never sends an untyped, unused `$n`.
 */
class SqlParams {
  readonly values: unknown[] = [];
  private timeoutIdx = 0;
  add(v: unknown): number {
    this.values.push(v);
    return this.values.length;
  }
  timeout(): number {
    if (this.timeoutIdx === 0) this.timeoutIdx = this.add(jobTimeoutSec());
    return this.timeoutIdx;
  }
}

/** WHERE conditions for the list filters (shared by list, count and export). */
function whereFor(p: GenerationsListParams, P: SqlParams): string[] {
  const conds: string[] = [];
  const f = p.filters;
  if (f.status && f.status.length === 1) conds.push(`g.status = $${P.add(f.status[0])}`);
  else if (f.status && f.status.length > 1) conds.push(`g.status = ANY($${P.add(f.status)}::text[])`);
  if (f.tool) conds.push(`g.tool_id = $${P.add(f.tool)}`);
  if (f.userId !== undefined) conds.push(`g.user_id = $${P.add(String(f.userId))}::bigint`);
  if (p.range) {
    conds.push(`g.created_at >= $${P.add(p.range.fromTs)}::timestamptz`);
    conds.push(`g.created_at < $${P.add(p.range.toTsExclusive)}::timestamptz`);
  }
  if (f.hasError === true) conds.push("g.error IS NOT NULL");
  if (f.hasError === false) conds.push("g.error IS NULL");
  if (f.unrefunded) conds.push(`(g.status = 'FAILED' AND ${CHARGED} AND NOT ${REFUNDED})`);
  if (f.stuck) conds.push(stuckSql("g", P.timeout()));
  return conds;
}

// ---------------------------------------------------------------------------
// List

export type ChargeSplit = { points: number; quota: number; balance: number };

export type AdminGenerationListItem = {
  id: string;
  userId: string;
  userName: string;
  toolId: string;
  topic: string;
  status: GenerationStatus;
  price: number;
  progress: number;
  attempts: number;
  /** Truncated to 300 characters (the detail has the full text). */
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number | null;
  /** What the charge took from each wallet (positive numbers; zeros when nothing was charged). */
  charged: ChargeSplit;
  refunded: boolean;
  /** Canonical AI spend of the job (`admin-cost.ts`); `null` when it has no spend rows. */
  costUsd: number | null;
  filesPurged: boolean;
  /** IN_PROGRESS past its budget + 30 s (or without a lease). */
  stuck: boolean;
};

type ListRow = CursorColumns & {
  id: string;
  user_id: string;
  user_name: string;
  tool_id: string;
  topic: string;
  status: GenerationStatus;
  price: string;
  progress: number;
  attempts: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: string | null;
  charged_points: string;
  charged_quota: string;
  charged_balance: string;
  refunded: boolean;
  files_purged: boolean;
  stuck: boolean;
};

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Per-job canonical spend (usd) for a set of ids (see the module comment). */
async function costsFor(db: Queryable, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const [id, spend] of await spendForJobs(db, ids)) out.set(id, spend.usd);
  return out;
}

const listColumns = (timeoutParam: number): string => `g.id::text AS id, g.user_id::text AS user_id, u.name AS user_name, g.tool_id, g.topic, g.status,
       g.price::text AS price, g.progress, g.attempts, left(g.error, 300) AS error,
       g.created_at, g.started_at, g.finished_at, g.duration_ms::text AS duration_ms,
       COALESCE(-c.points_delta, 0)::text AS charged_points,
       COALESCE(-c.quota_delta, 0)::text AS charged_quota,
       COALESCE(-c.balance_delta, 0)::text AS charged_balance,
       (r.id IS NOT NULL) AS refunded,
       (g.files_purged_at IS NOT NULL) AS files_purged,
       ${stuckSql("g", timeoutParam)} AS stuck`;

const LIST_FROM = `FROM ${BASE} g
  JOIN users u ON u.id = g.user_id
  LEFT JOIN transactions c ON c.kind = 'charge' AND c.reference = g.id::text
  LEFT JOIN transactions r ON r.kind = 'refund' AND r.reference = g.id::text`;

function toItem(r: Omit<ListRow, keyof CursorColumns>, costs: Map<string, number>): AdminGenerationListItem {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    toolId: r.tool_id,
    topic: r.topic,
    status: r.status,
    price: num(r.price),
    progress: Number(r.progress),
    attempts: Number(r.attempts),
    error: r.error,
    createdAt: new Date(r.created_at).toISOString(),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    durationSec: r.duration_ms === null ? null : Math.round(num(r.duration_ms) / 1000),
    charged: { points: num(r.charged_points), quota: num(r.charged_quota), balance: num(r.charged_balance) },
    refunded: r.refunded,
    costUsd: costs.get(r.id) ?? null,
    filesPurged: r.files_purged,
    stuck: r.stuck,
  };
}

/** One keyset page; `limit` is trusted (the list caps it at 100, the export uses 1 000). */
async function fetchPage(
  client: Queryable,
  p: GenerationsListParams,
  cursor: GenerationsListParams["cursor"],
  limit: number,
): Promise<{ items: AdminGenerationListItem[]; nextCursor: string | null }> {
  const P = new SqlParams();
  const conds = whereFor(p, P);
  const columns = listColumns(P.timeout());
  const ks = buildKeyset({ sort: p.sort, cursor, id: GENERATIONS_LIST_SPEC.id, paramOffset: P.values.length });
  const all = [...P.values, ...ks.params, limit + 1];
  const where = [...conds, ks.where].join(" AND ");
  const res = await client.query<ListRow>(
    `SELECT ${columns}, ${keysetSelect(p.sort, GENERATIONS_LIST_SPEC.id)}
       ${LIST_FROM}
      WHERE ${where}
      ORDER BY ${ks.orderBy}
      LIMIT $${all.length}`,
    all,
  );
  const page = pageResult(res.rows, limit, p.sort);
  const costs = await costsFor(client, page.items.map((r) => r.id));
  return { items: page.items.map((r) => toItem(r, costs)), nextCursor: page.nextCursor };
}

export type GenerationsListResult = {
  items: AdminGenerationListItem[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

export async function listAdminGenerations(p: GenerationsListParams): Promise<GenerationsListResult> {
  return readOnly(async (client) => {
    const page = await fetchPage(client, p, p.cursor, p.limit);
    // The count needs neither the user nor the ledger joins (FK: every job has a user).
    const P = new SqlParams();
    const conds = whereFor(p, P);
    const count = await countCapped(client, `FROM ${BASE} g WHERE ${conds.length ? conds.join(" AND ") : "TRUE"}`, P.values);
    return { ...page, ...count };
  });
}

/** CSV column order and the matching row mapper (dates are Tashkent-formatted by `csvCell`). */
export const GENERATIONS_CSV_HEADER = [
  "id",
  "user_id",
  "user_name",
  "tool_id",
  "topic",
  "status",
  "price",
  "charged_points",
  "charged_quota",
  "charged_balance",
  "refunded",
  "attempts",
  "duration_sec",
  "ai_usd",
  "error",
  "created_at",
  "started_at",
  "finished_at",
] as const;

export function csvRowOf(g: AdminGenerationListItem): unknown[] {
  const d = (s: string | null) => (s ? new Date(s) : null);
  return [
    g.id,
    g.userId,
    g.userName,
    g.toolId,
    g.topic,
    g.status,
    g.price,
    g.charged.points,
    g.charged.quota,
    g.charged.balance,
    g.refunded,
    g.attempts,
    g.durationSec,
    g.costUsd,
    g.error,
    new Date(g.createdAt),
    d(g.startedAt),
    d(g.finishedAt),
  ];
}

/**
 * Page fetcher for `keysetBatches` (export): each batch is its own short
 * READ ONLY transaction, so an export never holds one long query open (§9).
 */
export function exportPageFetcher(p: GenerationsListParams) {
  return async (cursor: string | null, limit: number) => {
    let decoded: GenerationsListParams["cursor"] = null;
    if (cursor !== null) {
      decoded = decodeCursor(cursor, p.sort, GENERATIONS_LIST_SPEC.id);
      // Cursors here come from `fetchPage` itself, so a bad one is a bug, not user input.
      if (!decoded) throw new Error("admin-generations: export cursor did not decode");
    }
    return readOnly((client) => fetchPage(client, p, decoded, limit));
  };
}

// ---------------------------------------------------------------------------
// Detail

export type CostPartView = {
  kind: string;
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  usd: number;
  /** Which spend row it came from: completed | failed | abandoned. */
  outcome: string;
};

export type LedgerRow = {
  id: string;
  kind: "charge" | "refund";
  points: number;
  quota: number;
  balance: number;
  note: string | null;
  createdAt: string;
};

export type AdminGenerationDetail = {
  id: string;
  userId: string;
  userName: string;
  userUsername: string | null;
  toolId: string;
  topic: string;
  status: GenerationStatus;
  price: number;
  format: string;
  progress: number;
  step: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number | null;
  runAfter: string;
  expiresAt: string | null;
  budgetMs: number;
  lockedBy: string | null;
  lockedAt: string | null;
  stuck: boolean;
  delivered: unknown;
  cost: { usd: number; parts: CostPartView[] } | null;
  docVersion: number;
  fileVersion: number;
  editedAt: string | null;
  filesPurgedAt: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  downloads: number | null;
  charged: ChargeSplit;
  refunded: boolean;
  /** `values_json`, masked (keys + topic) unless `inputsRevealed`. */
  inputs: unknown;
  inputsRevealed: boolean;
};

export type AdminGenerationDetailResponse = {
  generation: AdminGenerationDetail;
  ledger: LedgerRow[];
  gameLinks: number;
};

type DetailRow = {
  id: string;
  user_id: string;
  user_name: string;
  user_username: string | null;
  tool_id: string;
  topic: string;
  status: GenerationStatus;
  price: string;
  format: string;
  progress: number;
  step: string;
  attempts: number;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  run_after: Date;
  expires_at: Date | null;
  budget_ms: number;
  locked_by: string | null;
  locked_at: Date | null;
  stuck: boolean;
  delivered_json: unknown;
  doc_version: number;
  file_version: number;
  edited_at: Date | null;
  files_purged_at: Date | null;
  values_json: unknown;
  file_name: string | null;
  file_mime: string | null;
  file_size: string | null;
  downloads: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route id → lowercase uuid; anything else is a 404 (never a 500 from a cast). */
export function parseGenerationId(raw: string): string {
  if (!UUID_RE.test(raw)) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  return raw.toLowerCase();
}

/** `reveal` query flag: absent / `0` → false, `1` → true, anything else → 400. */
export function parseReveal(url: URL): boolean {
  const all = url.searchParams.getAll("reveal");
  if (all.length === 0) return false;
  if (all.length > 1 || (all[0] !== "0" && all[0] !== "1")) throw new ApiError("Noto'g'ri parametr: reveal", 400);
  return all[0] === "1";
}

function partOf(p: unknown, outcome: string): CostPartView {
  const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v ? v : "unknown");
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    kind: s(o.kind),
    provider: s(o.provider),
    model: s(o.model),
    calls: n(o.calls),
    inputTokens: n(o.inputTokens),
    outputTokens: n(o.outputTokens),
    units: n(o.units),
    usd: Math.max(n(o.usd), 0),
    outcome,
  };
}

async function costOf(client: Queryable, id: string): Promise<AdminGenerationDetail["cost"]> {
  const spend = (await spendForJobs(client, [id])).get(id);
  if (!spend) return null;
  const parts: CostPartView[] = [];
  for (const r of spend.rows) {
    if (Array.isArray(r.parts)) for (const p of r.parts) parts.push(partOf(p, r.outcome));
  }
  return { usd: spend.usd, parts };
}

/**
 * Detail of one job. `reveal` (the route has checked nothing yet): requires
 * `jobs.input`, otherwise a `denied` audit row and 403; when allowed, the
 * unmasked inputs are returned and ONE `jobs.input.view` audit row is written.
 */
export async function getAdminGeneration(admin: AdminActor, id: string, reveal: boolean): Promise<AdminGenerationDetailResponse> {
  if (reveal && !can(admin.role, "jobs.input")) {
    await writeDeniedAudit(admin, "jobs.input", "admin/generations/detail");
    throw new ApiError("Bu amal uchun ruxsatingiz yo'q", 403, { code: "forbidden" });
  }

  const out = await readOnly(async (client) => {
    const res = await client.query<DetailRow>(
      `SELECT g.id::text AS id, g.user_id::text AS user_id, u.name AS user_name, u.username AS user_username,
              g.tool_id, g.topic, g.status, g.price::text AS price, g.format, g.progress, g.step, g.attempts, g.error,
              g.created_at, g.started_at, g.finished_at, g.run_after, g.expires_at, g.budget_ms,
              g.locked_by, g.locked_at, ${stuckSql("g", 2)} AS stuck,
              g.delivered_json, g.doc_version, g.file_version, g.edited_at, g.files_purged_at, g.values_json,
              f.file_name, f.mime AS file_mime, f.size_bytes::text AS file_size, f.downloads
         FROM generations g
         JOIN users u ON u.id = g.user_id
         LEFT JOIN generation_files f ON f.generation_id = g.id
        WHERE g.id = $1::uuid`,
      [id, jobTimeoutSec()],
    );
    const r = res.rows[0];
    if (!r) throw new ApiError("Topilmadi", 404, { code: "not_found" });

    const ledgerRes = await client.query<{
      id: string;
      kind: "charge" | "refund";
      points_delta: string;
      quota_delta: string;
      balance_delta: string;
      note: string | null;
      created_at: Date;
    }>(
      `SELECT id::text AS id, kind, points_delta, quota_delta, balance_delta, note, created_at
         FROM transactions
        WHERE kind = ANY(ARRAY['charge', 'refund']) AND reference = $1
        ORDER BY created_at, id`,
      [id],
    );
    const games = await client.query<{ n: string }>(`SELECT count(*) AS n FROM game_sessions WHERE generation_id = $1::uuid`, [id]);
    const cost = await costOf(client, id);
    return { r, ledgerRows: ledgerRes.rows, gameLinks: num(games.rows[0]?.n), cost };
  });

  const { r, ledgerRows, gameLinks, cost } = out;
  const ledger: LedgerRow[] = ledgerRows.map((t) => ({
    id: t.id,
    kind: t.kind,
    points: num(t.points_delta),
    quota: num(t.quota_delta),
    balance: num(t.balance_delta),
    note: t.note,
    createdAt: new Date(t.created_at).toISOString(),
  }));
  const charge = ledger.find((t) => t.kind === "charge");

  if (reveal) {
    await adminTx(admin, (_client, audit) =>
      audit({ action: "jobs.input.view", targetType: "generation", targetId: id, meta: { field: "values_json" } }),
    );
  }

  const started = r.started_at ? new Date(r.started_at).getTime() : null;
  const finished = r.finished_at ? new Date(r.finished_at).getTime() : null;
  return {
    generation: {
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      userUsername: r.user_username,
      toolId: r.tool_id,
      topic: r.topic,
      status: r.status,
      price: num(r.price),
      format: r.format,
      progress: Number(r.progress),
      step: r.step,
      attempts: Number(r.attempts),
      error: r.error,
      createdAt: new Date(r.created_at).toISOString(),
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
      durationSec: started !== null && finished !== null ? Math.round((finished - started) / 1000) : null,
      runAfter: new Date(r.run_after).toISOString(),
      expiresAt: iso(r.expires_at),
      budgetMs: Number(r.budget_ms),
      lockedBy: r.locked_by,
      lockedAt: iso(r.locked_at),
      stuck: r.stuck,
      delivered: r.delivered_json ?? null,
      cost,
      docVersion: Number(r.doc_version),
      fileVersion: Number(r.file_version),
      editedAt: iso(r.edited_at),
      filesPurgedAt: iso(r.files_purged_at),
      hasFile: r.file_name !== null,
      fileName: r.file_name,
      fileMime: r.file_mime,
      fileSize: r.file_size === null ? null : num(r.file_size),
      downloads: r.downloads === null ? null : Number(r.downloads),
      charged: charge ? { points: -charge.points, quota: -charge.quota, balance: -charge.balance } : { points: 0, quota: 0, balance: 0 },
      refunded: ledger.some((t) => t.kind === "refund"),
      inputs: maskValues(r.values_json, { reveal }),
      inputsRevealed: reveal,
    },
    ledger,
    gameLinks,
  };
}

// ---------------------------------------------------------------------------
// File

export type GenerationFile = { bytes: Buffer; fileName: string; mime: string };

/**
 * The stored file of a job, any status (support inspects failed builds too),
 * with ONE `jobs.file.download` audit row in the same transaction as the read.
 * The user-facing `downloads` counter is not touched: an admin look is not a
 * user download.
 */
export async function readGenerationFileAudited(admin: AdminActor, id: string): Promise<GenerationFile> {
  return adminTx(admin, async (client, audit) => {
    const res = await client.query<{ bytes: Buffer; file_name: string; mime: string; size_bytes: string }>(
      `SELECT bytes, file_name, mime, size_bytes FROM generation_files WHERE generation_id = $1::uuid`,
      [id],
    );
    const f = res.rows[0];
    if (!f) throw new ApiError("Fayl topilmadi", 404, { code: "not_found" });
    await audit({
      action: "jobs.file.download",
      targetType: "generation",
      targetId: id,
      meta: { fileName: f.file_name, mime: f.mime, size: num(f.size_bytes) },
    });
    return { bytes: f.bytes, fileName: f.file_name, mime: f.mime };
  });
}
