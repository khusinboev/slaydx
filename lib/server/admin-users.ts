import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { pool, transaction } from "./db";
import { adminTx, writeDeniedAudit, type AuditActor } from "./admin-audit";
import type { AdminActor } from "./admin-handler";
import { parseReason } from "./admin-accounts";
import { can, canManageRole } from "./admin-rbac";
import {
  buildKeyset,
  classifyUserQuery,
  countCapped,
  decodeCursor,
  keysetSelect,
  likePrefix,
  pageResult,
  parseListParams,
  type KeysetCursor,
  type ListSpec,
  type ParsedList,
  type SortDef,
  type UserQuery,
} from "./admin-list";
import { CSV_MAX_ROWS, csvResponse, flattenBatches, keysetBatches } from "./admin-csv";
import { maskPhone } from "./admin-mask";
import { cancelQueuedInTx } from "./admin-job-actions";
import { LEDGER_COLUMNS, TRANSACTION_KINDS, resolveLedgerLinks, type LedgerDbRow, type TransactionKind } from "./admin-payments";
import { escapeTelegramHtml } from "./broadcast-delivery";
import { getSetting } from "./settings";
import { TelegramTransientError, sendMessage } from "./telegram";

/**
 * Users module of the admin panel (docs/admin/02-plan.md §6.4, §7.1 S4/S5).
 *
 * PII rules (§6.0 Masking, §4.3):
 *   - lists and exports ALWAYS carry the masked phone (`maskPhone`), never the
 *     raw one; OTP `local_id` (often a phone) is not listed at all;
 *   - the detail is masked by default; `reveal=1` needs `users.pii`, writes one
 *     `users.pii.view` audit row and only then returns the phone and `local_id`
 *     in clear (the OTP `local_id` is often a phone, so it follows the phone);
 *   - profile fields (university, faculty, …) are shown to every `users.view` role (§6.0);
 *   - a reveal without `users.pii` is a 403 plus a `denied` audit row.
 *
 * Mutations (block, session revoke, message) write exactly one `ok` audit row
 * in the same transaction as their change. Money moves only through F6's
 * `cancelQueuedInTx` (QUEUED → REVOKED + the idempotent `refundInTx`); wallet
 * adjustments are F6's own route (`users/[id]/wallet-adjustments`).
 */

type Queryable = Pick<PoolClient, "query">;

export const USER_PLANS = ["free", "pro"] as const;
export type UserPlan = (typeof USER_PLANS)[number];

/** Search text longer than this is a 400 (the classifier clips names anyway). */
const MAX_Q_CHARS = 200;
/** Masked stand-in for a non-empty PII text field. */
const MASKED = "•••";
/** Message text bounds (§6.4). */
export const MESSAGE_MAX = 2000;
/** Sessions shown per user (the table keeps 7 days of dead rows, see `purgeExpiredSessions`). */
const SESSIONS_MAX = 100;
/** Cancelled job ids kept in the block audit row's `meta` (the counts are always complete). */
const AUDIT_JOB_IDS_MAX = 100;

/*
 * Sort whitelist. Index coverage (plan §9 / §5.3):
 *   - created_desc / created_asc: `users_created_idx (created_at DESC, id DESC)`
 *     (scanned forward or backward);
 *   - balance_desc: NO index (a sort over the filtered set; fine at today's size);
 *   - last_seen_desc: NO index — `max(sessions.last_seen_at)` per user is a LATERAL
 *     over `sessions_user_idx`, so the whole filtered set is aggregated and sorted.
 */
export const USER_LIST_SPEC = {
  sorts: {
    created_desc: { column: "u.created_at", dir: "DESC", type: "timestamptz" },
    created_asc: { column: "u.created_at", dir: "ASC", type: "timestamptz" },
    balance_desc: { column: "u.balance", dir: "DESC", type: "bigint" },
    last_seen_desc: { column: "ls.last_seen_at", dir: "DESC", type: "timestamptz", nullable: true },
  },
  id: { column: "u.id", type: "bigint" },
  filters: {
    blocked: { kind: "flag" },
    plan: { kind: "enum", values: USER_PLANS },
    isAdmin: { kind: "flag" },
  },
  range: { maxDays: 366 },
} as const satisfies ListSpec;

type UserListParsed = ParsedList<typeof USER_LIST_SPEC>;
type UserFilter = { parsed: UserListParsed; q: UserQuery | null };

/** Single-valued query param; `?q=a&q=b` is a 400, never "the first one wins". */
function singleParam(url: URL, name: string): string | null {
  const all = url.searchParams.getAll(name);
  if (all.length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
  const v = all[0];
  return v === undefined || v === "" ? null : v;
}

/** §6.4.1: classified on the server, matched exactly or by an indexed prefix; never substring-scanned. */
export function parseUserQuery(raw: string | null): UserQuery | null {
  if (raw === null) return null;
  if (raw.length > MAX_Q_CHARS) throw new ApiError("Qidiruv matni juda uzun", 400);
  return classifyUserQuery(raw);
}

function parseUserFilter(url: URL): UserFilter {
  const parsed = parseListParams(url, USER_LIST_SPEC);
  return { parsed, q: parseUserQuery(singleParam(url, "q")) };
}

/* -------------------------------------------------------------------------- */
/* Shared SQL                                                                  */
/* -------------------------------------------------------------------------- */

/** Effective Pro, the same rule as `rowToUser` in session.ts (an expired Pro is free). */
const PRO_SQL = `(u.plan = 'pro' AND (u.plan_expires_at IS NULL OR u.plan_expires_at > now()))`;
/** "Is an admin" exactly as `SessionUser.isAdmin` (session.ts `userColumns`): an active or pending account. */
const IS_ADMIN_SQL = `EXISTS (SELECT 1 FROM admin_accounts aa WHERE aa.user_id = u.id AND aa.status IN ('active', 'pending'))`;
const LAST_SEEN_JOIN = `LEFT JOIN LATERAL (SELECT max(s.last_seen_at) AS last_seen_at FROM sessions s WHERE s.user_id = u.id) ls ON TRUE`;

/** `FROM … WHERE …` with `$n` placeholders only; user values never reach the SQL text. */
function userFromWhere(f: UserFilter, withLastSeen: boolean): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const conds: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const { filters, range } = f.parsed;
  if (filters.blocked !== undefined) conds.push(`u.is_blocked = ${p(filters.blocked)}::boolean`);
  if (filters.plan === "pro") conds.push(PRO_SQL);
  if (filters.plan === "free") conds.push(`NOT ${PRO_SQL}`);
  if (filters.isAdmin === true) conds.push(IS_ADMIN_SQL);
  if (filters.isAdmin === false) conds.push(`NOT ${IS_ADMIN_SQL}`);
  if (range) conds.push(`u.created_at >= ${p(range.fromTs)}::timestamptz AND u.created_at < ${p(range.toTsExclusive)}::timestamptz`);
  const q = f.q;
  if (q) {
    switch (q.kind) {
      case "id":
        conds.push(`u.id = ${p(q.value)}::bigint`);
        break;
      case "numeric": {
        const n = p(q.value);
        conds.push(`(u.id = ${n}::bigint OR u.telegram_id = ${n}::bigint)`);
        break;
      }
      case "phone": {
        // Bot contacts are stored as `+<digits>` (telegram.ts handleContact); an OTP
        // `local_id` may have been typed with or without the plus. Both columns have
        // partial unique indexes, so every branch is an index lookup.
        const plus = p(`+${q.value}`);
        const bare = p(q.value);
        conds.push(`(u.phone = ${plus} OR u.local_id = ${plus} OR u.local_id = ${bare})`);
        break;
      }
      case "username":
        // `users_username_lower_idx` is partial (`username IS NOT NULL`); the explicit
        // predicate lets the planner prove it applies.
        conds.push(`u.username IS NOT NULL AND lower(u.username) LIKE ${p(likePrefix(q.value))} ESCAPE '\\'`);
        break;
      case "name":
        conds.push(`lower(u.name) LIKE ${p(likePrefix(q.value))} ESCAPE '\\'`);
        break;
    }
  }
  const where = conds.length ? conds.join(" AND ") : "TRUE";
  return { sql: `FROM users u ${withLastSeen ? LAST_SEEN_JOIN : ""} WHERE ${where}`, params };
}

const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

function effectivePlan(plan: string, expires: Date | null): UserPlan {
  return plan === "pro" && (!expires || new Date(expires).getTime() > Date.now()) ? "pro" : "free";
}

/* -------------------------------------------------------------------------- */
/* List (S4)                                                                   */
/* -------------------------------------------------------------------------- */

export type AdminUserRow = {
  id: string;
  name: string;
  username: string | null;
  telegramId: string | null;
  /** Always masked (`+998 ** *** ** 67`); `null` when the user has no phone. */
  phoneMasked: string | null;
  /** Effective plan (an expired Pro is `free`), as the product sees it. */
  plan: UserPlan;
  planExpiresAt: string | null;
  points: number;
  quota: number;
  balance: number;
  isBlocked: boolean;
  isAdmin: boolean;
  createdAt: string;
  /** Latest `sessions.last_seen_at` (the product refreshes it at most hourly); `null` without sessions. */
  lastSeenAt: string | null;
  generations: number;
};

type UserDbRow = {
  id: string;
  name: string;
  username: string | null;
  telegram_id: string | null;
  phone: string | null;
  plan: string;
  plan_expires_at: Date | null;
  points: string;
  quota: string;
  balance: string;
  is_blocked: boolean;
  is_admin: boolean;
  created_at: Date;
};

/** Narrow columns only; the raw phone is read just to be masked before it leaves this module. */
const ROW_COLUMNS = `u.id::text AS id, u.name, u.username, u.telegram_id::text AS telegram_id, u.phone, u.plan, u.plan_expires_at,
  u.points::text AS points, u.quota::text AS quota, u.balance::text AS balance, u.is_blocked, ${IS_ADMIN_SQL} AS is_admin, u.created_at`;

/**
 * Generation counts and last-seen times for one page, in ONE query: per id an
 * index lookup on `generations_user_idx` and `sessions_user_idx` (never a
 * per-row round trip, never a scan of the big tables).
 */
async function pageExtras(db: Queryable, ids: readonly string[]): Promise<Map<string, { generations: number; lastSeenAt: string | null }>> {
  const out = new Map<string, { generations: number; lastSeenAt: string | null }>();
  if (!ids.length) return out;
  const res = await db.query<{ id: string; generations: string; last_seen_at: Date | null }>(
    `SELECT x.id::text AS id,
            (SELECT count(*) FROM generations g WHERE g.user_id = x.id) AS generations,
            (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = x.id) AS last_seen_at
       FROM unnest($1::bigint[]) AS x(id)`,
    [ids],
  );
  for (const r of res.rows) out.set(r.id, { generations: Number(r.generations), lastSeenAt: iso(r.last_seen_at) });
  return out;
}

function toUserRow(r: UserDbRow, extra: { generations: number; lastSeenAt: string | null } | undefined): AdminUserRow {
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    telegramId: r.telegram_id,
    phoneMasked: maskPhone(r.phone),
    plan: effectivePlan(r.plan, r.plan_expires_at),
    planExpiresAt: iso(r.plan_expires_at),
    points: Number(r.points),
    quota: Number(r.quota),
    balance: Number(r.balance),
    isBlocked: r.is_blocked,
    isAdmin: r.is_admin,
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: extra?.lastSeenAt ?? null,
    generations: extra?.generations ?? 0,
  };
}

async function fetchUserPage(
  db: Queryable,
  f: UserFilter,
  sort: SortDef,
  cursor: KeysetCursor | null,
  limit: number,
): Promise<{ items: AdminUserRow[]; nextCursor: string | null }> {
  // The LATERAL is joined only when the page is ordered by it.
  const fw = userFromWhere(f, sort.column.startsWith("ls."));
  const ks = buildKeyset({ sort, cursor, id: USER_LIST_SPEC.id, paramOffset: fw.params.length });
  const params = [...fw.params, ...ks.params, limit + 1];
  const res = await db.query<UserDbRow & { cursor_v: string | null; cursor_id: string }>(
    `SELECT ${ROW_COLUMNS}, ${keysetSelect(sort, USER_LIST_SPEC.id)}
       ${fw.sql} AND ${ks.where}
      ORDER BY ${ks.orderBy}
      LIMIT $${params.length}`,
    params,
  );
  const page = pageResult(res.rows, limit, sort);
  const extras = await pageExtras(
    db,
    page.items.map((r) => r.id),
  );
  return { items: page.items.map((r) => toUserRow(r, extras.get(r.id))), nextCursor: page.nextCursor };
}

export type AdminList<T> = { items: T[]; nextCursor: string | null; total: number | null; totalCapped: boolean };

/** `GET /api/admin/users`. */
export async function listAdminUsers(url: URL): Promise<AdminList<AdminUserRow>> {
  const f = parseUserFilter(url);
  const db = pool();
  const count = userFromWhere(f, false);
  const [page, total] = await Promise.all([
    fetchUserPage(db, f, f.parsed.sort, f.parsed.cursor, f.parsed.limit),
    countCapped(db, count.sql, count.params),
  ]);
  return { ...page, total: total.total, totalCapped: total.totalCapped };
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

/** Filters as written to the export audit row; a phone search is stored masked (§8: no incidental PII). */
function userFilterMeta(f: UserFilter): Record<string, unknown> {
  const { filters, range, sortKey } = f.parsed;
  const q = f.q;
  return {
    sort: sortKey,
    ...(filters.blocked !== undefined ? { blocked: filters.blocked } : {}),
    ...(filters.plan ? { plan: filters.plan } : {}),
    ...(filters.isAdmin !== undefined ? { isAdmin: filters.isAdmin } : {}),
    ...(range ? { from: range.fromDay, to: range.toDay } : {}),
    ...(q ? { qKind: q.kind, q: q.kind === "phone" ? maskPhone(`+${q.value}`) : q.value } : {}),
  };
}

export const USER_CSV_HEADER = [
  "ID",
  "Ism",
  "Username",
  "Telegram ID",
  "Telefon (yashirilgan)",
  "Tarif",
  "Tarif tugashi",
  "Ball",
  "Kvota",
  "Balans",
  "Bloklangan",
  "Admin",
  "Generatsiyalar",
  "Ro'yxatdan o'tgan",
  "Oxirgi faollik",
] as const;

const isoToDate = (v: string | null): Date | null => (v ? new Date(v) : null);

function userCsvRow(u: AdminUserRow): unknown[] {
  return [
    u.id,
    u.name,
    u.username,
    u.telegramId,
    u.phoneMasked,
    u.plan,
    isoToDate(u.planExpiresAt),
    u.points,
    u.quota,
    u.balance,
    u.isBlocked ? "ha" : "yo'q",
    u.isAdmin ? "ha" : "yo'q",
    u.generations,
    new Date(u.createdAt),
    isoToDate(u.lastSeenAt),
  ];
}

/**
 * `GET /api/admin/users/export` (users.export, step-up): the list's filters and
 * sort, CSV in keyset batches of 1 000, capped at 100 000 rows, phone masked.
 * The audit row (`export.users`, `meta.filters`) commits before the first byte.
 */
export async function exportAdminUsers(url: URL, actor: AuditActor): Promise<Response> {
  const f = parseUserFilter(url);
  const sort = f.parsed.sort;
  await adminTx(actor, (_client, audit) => audit({ action: "export.users", targetType: "users", meta: { filters: userFilterMeta(f) } }));
  const db = pool();
  const batches = keysetBatches<AdminUserRow>(
    async (cursor, limit) => {
      const decoded = cursor === null ? null : decodeCursor(cursor, sort, USER_LIST_SPEC.id);
      return fetchUserPage(db, f, sort, decoded, limit);
    },
    1000,
    CSV_MAX_ROWS + 1,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse({ filename: `foydalanuvchilar-${stamp}.csv`, header: USER_CSV_HEADER, rows: flattenBatches(batches, userCsvRow) });
}

/* -------------------------------------------------------------------------- */
/* Detail (S5)                                                                 */
/* -------------------------------------------------------------------------- */

export const PROFILE_FIELDS = [
  "university",
  "faculty",
  "department",
  "group",
  "course",
  "author",
  "subject",
  "teacher",
  "city",
  "position",
  "organization",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type AdminUserDetail = Omit<AdminUserRow, "phoneMasked" | "generations"> & {
  /** Masked unless `revealed`. */
  phone: string | null;
  /** OTP login identifier (often a phone); masked unless `revealed`. */
  localId: string | null;
  /** Form-default profile, shown in clear to every `users.view` role (plan §6.0 Masking). */
  profile: Record<ProfileField, string>;
  language: string;
  updatedAt: string;
  /** `true` only in a `reveal=1` response (audited as `users.pii.view`). */
  revealed: boolean;
};

export type AdminUserStats = {
  generations: number;
  completed: number;
  failed: number;
  /** Cash wallets (balance + quota) charged for jobs minus what was refunded; the dashboard's `cashSpendTanga` rule. */
  spentTanga: number;
  /** Paid orders, gross (external refunds are not subtracted). */
  paidSoum: number;
  /** Stored bytes: generated files and assets plus the user's uploads (logos, photos, templates, sources). */
  storageBytes: number;
};

export type AdminUserDetailResponse = {
  user: AdminUserDetail;
  stats: AdminUserStats;
  flags: {
    isAdminAccount: boolean;
    adminRole: string | null;
    adminStatus: string | null;
    /** The target is the signed-in admin's own user (wallet, block and session actions refuse it). */
    self: boolean;
  };
  /** Current counts the block dialog shows for its side effects. */
  counts: { activeSessions: number; queuedJobs: number; activeGameLinks: number };
  /** `admin.wallet_confirm_threshold`, for the wallet dialog's typed confirmation. */
  walletConfirmThreshold: number;
};

type DetailDbRow = UserDbRow & {
  local_id: string | null;
  language: string;
  updated_at: Date;
  last_seen_at: Date | null;
} & Record<ProfileField, string>;

const DETAIL_COLUMNS = `${ROW_COLUMNS}, u.local_id, u.language, u.updated_at,
  u.university, u.faculty, u.department, u."group", u.course, u.author, u.subject, u.teacher, u.city, u.position, u.organization,
  (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at`;

/** A non-phone `local_id` keeps nothing; a phone-like one keeps its last two digits like any phone. */
function maskLocalId(v: string | null): string | null {
  if (v === null || v === "") return v;
  return /^\+?[\d\s()-]{7,}$/.test(v) ? maskPhone(v) : MASKED;
}

function toDetail(r: DetailDbRow, revealed: boolean): AdminUserDetail {
  const base = toUserRow(r, { generations: 0, lastSeenAt: iso(r.last_seen_at) });
  const { phoneMasked: _pm, generations: _g, ...rest } = base;
  void _pm;
  void _g;
  const profile = {} as Record<ProfileField, string>;
  for (const k of PROFILE_FIELDS) {
    const v = r[k] ?? "";
    profile[k] = v;
  }
  return {
    ...rest,
    phone: revealed ? r.phone : maskPhone(r.phone),
    localId: revealed ? r.local_id : maskLocalId(r.local_id),
    profile,
    language: r.language,
    updatedAt: new Date(r.updated_at).toISOString(),
    revealed,
  };
}

async function loadDetailRow(db: Queryable, id: string): Promise<DetailDbRow> {
  const res = await db.query<DetailDbRow>(`SELECT ${DETAIL_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  const row = res.rows[0];
  if (!row) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  return row;
}

type StatsDbRow = {
  generations: string;
  completed: string;
  failed: string;
  queued: string;
  spent: string;
  paid: string;
  storage: string;
  active_sessions: string;
  active_links: string;
};

/** Per-user aggregates; every subquery is bounded by a `user_id` index. */
const STATS_SQL = `
SELECT g.total AS generations, g.completed, g.failed, g.queued,
  (SELECT COALESCE(-sum(t.balance_delta + t.quota_delta), 0) FROM transactions t
    WHERE t.user_id = $1 AND t.kind IN ('charge', 'refund')) AS spent,
  (SELECT COALESCE(sum(o.amount_soum), 0) FROM payment_orders o WHERE o.user_id = $1 AND o.state = 'paid') AS paid,
  (SELECT COALESCE(sum(f.size_bytes), 0) FROM generation_files f JOIN generations x ON x.id = f.generation_id WHERE x.user_id = $1)
  + (SELECT COALESCE(sum(a.size_bytes), 0) FROM generation_assets a JOIN generations x ON x.id = a.generation_id WHERE x.user_id = $1)
  + (SELECT COALESCE(sum(size_bytes), 0) FROM logo_uploads WHERE user_id = $1)
  + (SELECT COALESCE(sum(size_bytes), 0) FROM photo_uploads WHERE user_id = $1)
  + (SELECT COALESCE(sum(size_bytes), 0) FROM template_uploads WHERE user_id = $1)
  + (SELECT COALESCE(sum(size_bytes), 0) FROM source_uploads WHERE user_id = $1) AS storage,
  (SELECT count(*) FROM sessions s WHERE s.user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions,
  (SELECT count(*) FROM game_sessions gs WHERE gs.user_id = $1 AND (gs.expires_at IS NULL OR gs.expires_at > now())) AS active_links
FROM (SELECT count(*) AS total,
             count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
             count(*) FILTER (WHERE status = 'FAILED') AS failed,
             count(*) FILTER (WHERE status = 'QUEUED') AS queued
        FROM generations WHERE user_id = $1) g`;

async function loadStats(db: Queryable, id: string): Promise<{ stats: AdminUserStats; counts: AdminUserDetailResponse["counts"] }> {
  const r = (await db.query<StatsDbRow>(STATS_SQL, [id])).rows[0]!;
  return {
    stats: {
      generations: Number(r.generations),
      completed: Number(r.completed),
      failed: Number(r.failed),
      spentTanga: Number(r.spent),
      paidSoum: Number(r.paid),
      storageBytes: Number(r.storage),
    },
    counts: { activeSessions: Number(r.active_sessions), queuedJobs: Number(r.queued), activeGameLinks: Number(r.active_links) },
  };
}

async function adminAccountOf(db: Queryable, userId: string): Promise<{ role: string; status: string } | null> {
  const res = await db.query<{ role: string; status: string }>(`SELECT role, status FROM admin_accounts WHERE user_id = $1`, [userId]);
  return res.rows[0] ?? null;
}

async function buildDetail(db: Queryable, actor: AdminActor, id: string, revealed: boolean): Promise<AdminUserDetailResponse> {
  const row = await loadDetailRow(db, id);
  const { stats, counts } = await loadStats(db, id);
  const account = await adminAccountOf(db, id);
  return {
    user: toDetail(row, revealed),
    stats,
    flags: {
      isAdminAccount: account !== null && account.status !== "disabled",
      adminRole: account?.role ?? null,
      adminStatus: account?.status ?? null,
      self: id === actor.userId,
    },
    counts,
    walletConfirmThreshold: await getSetting("admin.wallet_confirm_threshold"),
  };
}

/** Bounded read for the aggregates (§9): read-only, 10 s statement timeout. */
async function readOnly<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    return fn(client);
  });
}

/** `reveal` query param: absent / `0` = masked, `1` = reveal; anything else is a 400. */
export function parseReveal(url: URL): boolean {
  const raw = singleParam(url, "reveal");
  if (raw === null || raw === "0") return false;
  if (raw === "1") return true;
  throw new ApiError("Noto'g'ri parametr: reveal", 400);
}

/**
 * `GET /api/admin/users/:id`. A reveal is checked BEFORE anything is read
 * (403 + `denied` row without `users.pii`), and the clear values leave only
 * after its `users.pii.view` audit row has committed.
 */
export async function getAdminUser(actor: AdminActor, id: string, reveal: boolean, scope: string): Promise<AdminUserDetailResponse> {
  if (reveal && !can(actor.role, "users.pii")) {
    await writeDeniedAudit(actor, "users.pii", scope);
    throw new ApiError("Bu amal uchun ruxsatingiz yo'q", 403, { code: "forbidden" });
  }
  const detail = await readOnly((client) => buildDetail(client, actor, id, reveal));
  if (reveal) {
    await adminTx(actor, (_client, audit) =>
      audit({
        action: "users.pii.view",
        targetType: "user",
        targetId: id,
        meta: { fields: ["phone", "localId"] },
      }),
    );
  }
  return detail;
}

/* -------------------------------------------------------------------------- */
/* Ledger tab                                                                  */
/* -------------------------------------------------------------------------- */

export const USER_TX_SPEC = {
  sorts: { created_desc: { column: "t.created_at", dir: "DESC", type: "timestamptz" } },
  id: { column: "t.id", type: "bigint" },
  filters: { kind: { kind: "enumList", values: TRANSACTION_KINDS } },
} as const satisfies ListSpec;

export type AdminUserTransaction = {
  id: string;
  kind: TransactionKind;
  points: number;
  quota: number;
  balance: number;
  reference: string | null;
  /** The user-visible note (admin rows carry the neutral "Ma'muriy tuzatish"). */
  note: string | null;
  createdAt: string;
  /** Set when the reference resolves to an existing job / order (links are built from these ids). */
  generationId: string | null;
  orderId: string | null;
};

async function assertUserExists(db: Queryable, id: string): Promise<void> {
  const res = await db.query(`SELECT 1 FROM users WHERE id = $1`, [id]);
  if (!res.rows[0]) throw new ApiError("Topilmadi", 404, { code: "not_found" });
}

/**
 * `GET /api/admin/users/:id/transactions` (users.view): the user's ledger,
 * newest first, keyset on `(created_at, id)` over `transactions_user_idx`.
 */
export async function listUserTransactions(id: string, url: URL): Promise<AdminList<AdminUserTransaction>> {
  const parsed = parseListParams(url, USER_TX_SPEC);
  const db = pool();
  await assertUserExists(db, id);
  const params: unknown[] = [id];
  const conds = ["t.user_id = $1::bigint"];
  if (parsed.filters.kind && parsed.filters.kind.length) {
    params.push(parsed.filters.kind);
    conds.push(`t.kind = ANY($${params.length}::text[])`);
  }
  const fromWhere = `FROM transactions t JOIN users u ON u.id = t.user_id WHERE ${conds.join(" AND ")}`;
  const ks = buildKeyset({ sort: parsed.sort, cursor: parsed.cursor, id: USER_TX_SPEC.id, paramOffset: params.length });
  const pageParams = [...params, ...ks.params, parsed.limit + 1];
  const [res, total] = await Promise.all([
    db.query<LedgerDbRow & { cursor_v: string | null; cursor_id: string }>(
      `SELECT ${LEDGER_COLUMNS}, ${keysetSelect(parsed.sort, USER_TX_SPEC.id)}
         ${fromWhere} AND ${ks.where}
        ORDER BY ${ks.orderBy}
        LIMIT $${pageParams.length}`,
      pageParams,
    ),
    countCapped(db, `FROM transactions t WHERE ${conds.join(" AND ")}`, params),
  ]);
  const page = pageResult(res.rows, parsed.limit, parsed.sort);
  const links = await resolveLedgerLinks(db, page.items);
  const items = page.items.map((r, i): AdminUserTransaction => {
    const link = links[i] ?? null;
    return {
      id: r.id,
      kind: r.kind,
      points: Number(r.points_delta),
      quota: Number(r.quota_delta),
      balance: Number(r.balance_delta),
      reference: r.reference,
      note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
      generationId: link?.type === "generation" ? link.id : null,
      orderId: link?.type === "order" ? link.id : null,
    };
  });
  return { items, nextCursor: page.nextCursor, total: total.total, totalCapped: total.totalCapped };
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export type AdminUserSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  /** Not revoked and not expired (computed by the database clock). */
  active: boolean;
};

/** `GET /api/admin/users/:id/sessions` (users.sessions): newest first, at most 100. */
export async function listUserSessions(id: string): Promise<{ items: AdminUserSession[] }> {
  const db = pool();
  await assertUserExists(db, id);
  const res = await db.query<{
    id: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
    user_agent: string | null;
    active: boolean;
  }>(
    `SELECT id::text AS id, created_at, last_seen_at, expires_at, revoked_at, user_agent,
            (revoked_at IS NULL AND expires_at > now()) AS active
       FROM sessions WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT ${SESSIONS_MAX}`,
    [id],
  );
  return {
    items: res.rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      revokedAt: iso(r.revoked_at),
      userAgent: r.user_agent,
      active: r.active,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Guards shared by the mutations                                              */
/* -------------------------------------------------------------------------- */

function refuseSelf(actor: AdminActor, id: string, what: string): void {
  if (id === actor.userId) throw new ApiError(`O'zingizga nisbatan ${what} mumkin emas`, 409, { code: "self" });
}

/**
 * §4.3 invariant: acting on an admin's user account (block, session revoke —
 * both end that admin's panel access; wallet adjustments — money on a
 * colleague's account) needs `admins.manage`, and within its rank limits
 * (`canManageRole`: strictly lower rank, owners may act on owners). Pending
 * accounts count as admin accounts, as in `SessionUser.isAdmin`. Exported for
 * `admin-wallet.ts` (Phase 4 review): one rule, one message.
 */
export async function assertMayActOn(db: Queryable, actor: AdminActor, id: string): Promise<void> {
  const account = await adminAccountOf(db, id);
  if (account && account.status !== "disabled" && !canManageRole(actor.role, account.role)) {
    throw new ApiError("Admin hisobiga ega foydalanuvchi ustida bu amal uchun ruxsatingiz yo'q", 403, { code: "admin_target" });
  }
}

async function lockUser(client: Queryable, id: string): Promise<{ is_blocked: boolean }> {
  const res = await client.query<{ is_blocked: boolean }>(`SELECT is_blocked FROM users WHERE id = $1 FOR UPDATE`, [id]);
  const row = res.rows[0];
  if (!row) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  return row;
}

/** Revokes every live session of the user; returns how many were live. */
async function revokeUserSessionsInTx(client: Queryable, id: string): Promise<number> {
  const res = await client.query(
    `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [id],
  );
  return res.rowCount ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Block                                                                       */
/* -------------------------------------------------------------------------- */

export type BlockInput = {
  blocked: boolean;
  reason: string;
  revokeSessions: boolean;
  cancelQueued: boolean;
  revokeLinks: boolean;
};

/** A present field must be a real boolean (`"false"` used to block, A5 / T9). */
function strictBool(v: unknown, name: string, fallback: boolean | undefined): boolean {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== "boolean") throw new ApiError(`${name} true yoki false bo'lishi kerak`, 400, { field: name });
  return v;
}

/** Every field is validated from `unknown`; nothing else in the body is read. */
export function parseBlockBody(body: Record<string, unknown>): BlockInput {
  const blocked = strictBool(body.blocked, "blocked", undefined);
  const revokeSessions = strictBool(body.revokeSessions, "revokeSessions", true);
  const cancelQueued = strictBool(body.cancelQueued, "cancelQueued", false);
  const revokeLinks = strictBool(body.revokeLinks, "revokeLinks", false);
  const reason = parseReason(body.reason)!;
  return { blocked, reason, revokeSessions, cancelQueued, revokeLinks };
}

export type BlockSideEffects = { sessionsRevoked: number; jobsCancelled: number; refunds: number; linksRevoked: number };
export type BlockResponse = { user: AdminUserDetail; sideEffects: BlockSideEffects };

/**
 * `POST /api/admin/users/:id/block`. One transaction: the flag, the chosen side
 * effects and one `users.block` / `users.unblock` audit row. `blocked:false`
 * reverses only the flag (side-effect options are ignored). Asking for the
 * state the user is already in is a 409 `unchanged` (no audit noise).
 *
 * Effect for the user: `currentSessionRef` (session.ts) refuses any session of
 * a blocked user, so the next request is anonymous even if sessions were kept.
 * Queued jobs are cancelled by the same step as F6's admin cancel
 * (`cancelQueuedInTx`: QUEUED → REVOKED, then `refundInTx` with the same note).
 */
export async function setUserBlocked(actor: AdminActor, id: string, input: BlockInput): Promise<BlockResponse> {
  refuseSelf(actor, id, "bloklash");
  return adminTx(actor, async (client, audit) => {
    // Lock order generations → users, like every other money path (the
    // user's own cancel, queue-ttl, reconcile, admin cancel/fail,
    // commitJobResult): the job rows FIRST, the user row after. The reverse
    // order deadlocked against a concurrent user cancel (40P01 → 500).
    // Row locks on the job rows also settle the race with a worker claim
    // (SKIP LOCKED): a job claimed first is IN_PROGRESS and untouched below;
    // a job locked here is skipped by the worker and cancelled. A job the user
    // cancels meanwhile is no longer QUEUED when the lock is granted
    // (READ COMMITTED re-check) and drops out of the list.
    const queued =
      input.blocked && input.cancelQueued
        ? await client.query<{ id: string }>(
            `SELECT id::text AS id FROM generations WHERE user_id = $1 AND status = 'QUEUED' ORDER BY id FOR UPDATE`,
            [id],
          )
        : null;
    const before = await lockUser(client, id);
    await assertMayActOn(client, actor, id);
    if (before.is_blocked === input.blocked) {
      throw new ApiError(input.blocked ? "Foydalanuvchi allaqachon bloklangan" : "Foydalanuvchi bloklanmagan", 409, {
        code: "unchanged",
        isBlocked: before.is_blocked,
      });
    }
    await client.query(`UPDATE users SET is_blocked = $2, updated_at = now() WHERE id = $1`, [id, input.blocked]);

    const effects: BlockSideEffects = { sessionsRevoked: 0, jobsCancelled: 0, refunds: 0, linksRevoked: 0 };
    const refunded = { points: 0, quota: 0, balance: 0 };
    const jobIds: string[] = [];
    if (input.blocked) {
      if (input.revokeSessions) effects.sessionsRevoked = await revokeUserSessionsInTx(client, id);
      if (queued) {
        for (const { id: jobId } of queued.rows) {
          const r = await cancelQueuedInTx(client, { id: jobId, userId: id });
          if (!r.cancelled) continue;
          jobIds.push(jobId);
          if (r.refunded) {
            effects.refunds += 1;
            refunded.points += r.refunded.points;
            refunded.quota += r.refunded.quota;
            refunded.balance += r.refunded.balance;
          }
        }
        jobIds.sort();
        effects.jobsCancelled = jobIds.length;
      }
      if (input.revokeLinks) {
        const res = await client.query(
          `UPDATE game_sessions SET expires_at = now() WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
          [id],
        );
        effects.linksRevoked = res.rowCount ?? 0;
      }
    }

    await audit({
      action: input.blocked ? "users.block" : "users.unblock",
      targetType: "user",
      targetId: id,
      reason: input.reason,
      before: { is_blocked: before.is_blocked },
      after: { is_blocked: input.blocked },
      meta: input.blocked
        ? {
            options: { revokeSessions: input.revokeSessions, cancelQueued: input.cancelQueued, revokeLinks: input.revokeLinks },
            sideEffects: effects,
            refunded,
            ...(jobIds.length ? { jobIds: jobIds.slice(0, AUDIT_JOB_IDS_MAX) } : {}),
          }
        : { sideEffects: effects },
    });
    const row = await loadDetailRow(client, id);
    return { user: toDetail(row, false), sideEffects: effects };
  });
}

/* -------------------------------------------------------------------------- */
/* Session revoke                                                              */
/* -------------------------------------------------------------------------- */

/** `POST /api/admin/users/:id/sessions/revoke` (users.sessions): every live session, one audit row. */
export async function revokeUserSessions(actor: AdminActor, id: string, rawReason: unknown): Promise<{ revoked: number }> {
  const reason = parseReason(rawReason)!;
  refuseSelf(actor, id, "sessiyalarni bekor qilish");
  return adminTx(actor, async (client, audit) => {
    await lockUser(client, id);
    await assertMayActOn(client, actor, id);
    const revoked = await revokeUserSessionsInTx(client, id);
    await audit({
      action: "users.sessions.revoke",
      targetType: "user",
      targetId: id,
      reason,
      before: { activeSessions: revoked },
      after: { activeSessions: 0 },
      meta: { revoked },
    });
    return { revoked };
  });
}

/* -------------------------------------------------------------------------- */
/* Direct message                                                              */
/* -------------------------------------------------------------------------- */

/** Text 1..2000 characters after trimming; NUL bytes are dropped. */
export function parseMessageBody(body: Record<string, unknown>): string {
  if (typeof body.text !== "string") throw new ApiError("Xabar matni kerak", 400);
  const text = body.text.replace(/\0/g, "").trim();
  if (text.length < 1 || text.length > MESSAGE_MAX) {
    throw new ApiError(`Xabar 1 dan ${MESSAGE_MAX} gacha belgi bo'lishi kerak`, 400);
  }
  return text;
}

/**
 * `POST /api/admin/users/:id/message` (users.message). The text is HTML-escaped
 * before it reaches `sendMessage` (which uses `parse_mode: HTML`, T8).
 * `{sent:false}` when Telegram refuses for good (bot blocked by the user, or no
 * bot token configured). A transient Telegram failure is a 503 the admin can
 * retry. The audit row records only the length and the outcome, never the text.
 */
export async function messageUser(actor: AdminActor, id: string, text: string): Promise<{ sent: boolean }> {
  const res = await pool().query<{ telegram_id: string | null }>(`SELECT telegram_id::text AS telegram_id FROM users WHERE id = $1`, [id]);
  const row = res.rows[0];
  if (!row) throw new ApiError("Topilmadi", 404, { code: "not_found" });
  if (!row.telegram_id) throw new ApiError("Foydalanuvchi Telegram orqali bog'lanmagan", 409, { code: "no_telegram" });

  let sent = false;
  let transient = false;
  try {
    sent = await sendMessage(row.telegram_id, escapeTelegramHtml(text));
  } catch (e) {
    if (!(e instanceof TelegramTransientError)) throw e;
    transient = true;
  }
  await adminTx(actor, (_client, audit) =>
    audit({
      action: "users.message",
      targetType: "user",
      targetId: id,
      meta: { length: text.length, sent, ...(transient ? { transient: true } : {}) },
    }),
  );
  if (transient) {
    throw new ApiError("Telegram vaqtincha javob bermadi. Birozdan keyin qayta urinib ko'ring.", 503, { code: "telegram_unavailable" });
  }
  return { sent };
}
