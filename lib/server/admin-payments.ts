import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { pool } from "./db";
import { adminTx, type AuditActor } from "./admin-audit";
import {
  buildKeyset,
  countCapped,
  decodeCursor,
  keysetSelect,
  pageResult,
  parseListParams,
  type KeysetCursor,
  type ListSpec,
  type ParsedList,
  type SortDef,
} from "./admin-list";
import { CSV_MAX_ROWS, csvResponse, flattenBatches, keysetBatches } from "./admin-csv";
import { redactPayload } from "./payment-events";
import type { OrderState, Provider, Purpose } from "./payments";

/**
 * Payment orders for the admin panel (docs/admin/02-plan.md §6.6, §7.1 S8/S9).
 *
 * Read-only: the only money action on an order (external refund) lives in
 * `admin-order-refund.ts` (F6). Lists are keyset-paginated through
 * `admin-list.ts`; search `q` is classified on the server and matched exactly
 * (order uuid, `prepare_id` or `provider_txn`), never substring-scanned.
 *
 * "Credited" means the settlement ledger row exists: `settleOrder` writes
 * `topup` (top-up) or `subscription` (Pro) with
 * `reference = <provider>:<provider_txn ?? order id>` — the same reference
 * `admin-order-refund.ts settlementReference` and the `payment_ledger` view use.
 */

type Queryable = Pick<PoolClient, "query">;

export const ORDER_STATES = ["created", "pending", "paid", "cancelled"] as const satisfies readonly OrderState[];
export const ORDER_PROVIDERS = ["click", "payme"] as const satisfies readonly Provider[];
export const ORDER_PURPOSES = ["topup", "pro"] as const satisfies readonly Purpose[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_Q_CHARS = 200;

export const ORDER_LIST_SPEC = {
  sorts: {
    created_desc: { column: "o.created_at", dir: "DESC", type: "timestamptz" },
    amount_desc: { column: "o.amount_soum", dir: "DESC", type: "bigint" },
  },
  id: { column: "o.id", type: "uuid" },
  filters: {
    state: { kind: "enumList", values: ORDER_STATES },
    provider: { kind: "enum", values: ORDER_PROVIDERS },
    purpose: { kind: "enum", values: ORDER_PURPOSES },
    userId: { kind: "int", min: 1, max: Number.MAX_SAFE_INTEGER },
  },
  range: { maxDays: 366 },
} as const satisfies ListSpec;

type OrderListParsed = ParsedList<typeof ORDER_LIST_SPEC>;

/* -------------------------------------------------------------------------- */
/* Search classification                                                      */
/* -------------------------------------------------------------------------- */

export type OrderQuery =
  /** An order uuid: `payment_orders.id`. */
  | { kind: "id"; value: string }
  /** Digits only: Click `merchant_prepare_id` or a numeric provider transaction (Click `click_trans_id`). */
  | { kind: "number"; value: string }
  /** Anything else: an exact provider transaction id (Payme ids are 24 hex characters). */
  | { kind: "txn"; value: string };

/** Single-valued query param; `?q=a&q=b` is a 400, never "the first one wins". */
function singleParam(url: URL, name: string): string | null {
  const all = url.searchParams.getAll(name);
  if (all.length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
  const v = all[0];
  return v === undefined || v === "" ? null : v;
}

/**
 * Classifies the order search text (plan §6.6: exact match on the order uuid,
 * `provider_txn` or `prepare_id`). Blank → `null`. NUL bytes (invalid in
 * Postgres text, 22021 → 500) and overlong input are a 400.
 */
export function classifyOrderQuery(raw: string | null): OrderQuery | null {
  if (raw === null) return null;
  if (raw.includes("\0")) throw new ApiError("Qidiruv matni noto'g'ri", 400);
  const s = raw.trim();
  if (s === "") return null;
  if (s.length > MAX_Q_CHARS) throw new ApiError("Qidiruv matni juda uzun", 400);
  if (UUID_RE.test(s)) return { kind: "id", value: s.toLowerCase() };
  // 18 digits always fit a bigint (`prepare_id`), so the cast below can never overflow.
  if (/^\d{1,18}$/.test(s)) return { kind: "number", value: s };
  return { kind: "txn", value: s };
}

/* -------------------------------------------------------------------------- */
/* Shared SQL                                                                  */
/* -------------------------------------------------------------------------- */

/** The settlement ledger reference of order `o` (`settleOrder`). */
const SETTLE_REF_SQL = `o.provider || ':' || COALESCE(o.provider_txn, o.id::text)`;
/** The ledger kind `settleOrder` writes for the order's purpose. */
const SETTLE_KIND_SQL = `CASE WHEN o.purpose = 'pro' THEN 'subscription' ELSE 'topup' END`;
/** Uses `transactions_ref_idx (kind, reference)`. */
export const CREDITED_SQL = `EXISTS (SELECT 1 FROM transactions t WHERE t.kind = ${SETTLE_KIND_SQL} AND t.reference = ${SETTLE_REF_SQL})`;

const ORDER_COLUMNS = `o.id::text AS id, o.user_id::text AS user_id, u.name AS user_name, o.provider, o.purpose,
  o.amount_soum::text AS amount_soum, o.state, o.provider_txn, o.prepare_id::text AS prepare_id, o.created_at,
  o.create_time::text AS create_time, o.perform_time::text AS perform_time, o.cancel_time::text AS cancel_time,
  o.cancel_reason, ${CREDITED_SQL} AS credited,
  (SELECT count(*) FROM payment_refunds r WHERE r.order_id = o.id)::int AS external_refunds`;

type OrderDbRow = {
  id: string;
  user_id: string;
  user_name: string;
  provider: Provider;
  purpose: Purpose;
  amount_soum: string;
  state: OrderState;
  provider_txn: string | null;
  prepare_id: string | null;
  created_at: Date;
  create_time: string;
  perform_time: string;
  cancel_time: string;
  cancel_reason: number | null;
  credited: boolean;
  external_refunds: number;
};

export type AdminOrderRow = {
  id: string;
  userId: string;
  userName: string;
  provider: Provider;
  purpose: Purpose;
  amountSoum: number;
  state: OrderState;
  providerTxn: string | null;
  /** Click `merchant_prepare_id`; `null` until the order is attached to a provider transaction. */
  prepareId: string | null;
  createdAt: string;
  /** Provider times are stored in epoch ms (0 = not set); returned as ISO instants or `null`. */
  createTime: string | null;
  performTime: string | null;
  cancelTime: string | null;
  cancelReason: number | null;
  /** The settlement ledger row exists. */
  credited: boolean;
  /** Number of recorded external refunds / chargebacks. */
  externalRefunds: number;
};

/** Provider epoch-ms column (`'0'` = unset) → ISO instant or `null`. */
export function msToIso(ms: string | number | null | undefined): string | null {
  const n = typeof ms === "string" ? Number(ms) : ms;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toOrderRow(r: OrderDbRow): AdminOrderRow {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    provider: r.provider,
    purpose: r.purpose,
    amountSoum: Number(r.amount_soum),
    state: r.state,
    providerTxn: r.provider_txn,
    prepareId: r.prepare_id,
    createdAt: new Date(r.created_at).toISOString(),
    createTime: msToIso(r.create_time),
    performTime: msToIso(r.perform_time),
    cancelTime: msToIso(r.cancel_time),
    cancelReason: r.cancel_reason,
    credited: r.credited,
    externalRefunds: r.external_refunds,
  };
}

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

type OrderFilter = { parsed: OrderListParsed; q: OrderQuery | null };

/** `FROM … WHERE …` with `$n` placeholders only; user values never reach the SQL text. */
function orderFromWhere(f: OrderFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const conds: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const { filters, range } = f.parsed;
  if (filters.state && filters.state.length) conds.push(`o.state = ANY(${p(filters.state)}::text[])`);
  if (filters.provider) conds.push(`o.provider = ${p(filters.provider)}`);
  if (filters.purpose) conds.push(`o.purpose = ${p(filters.purpose)}`);
  if (filters.userId !== undefined) conds.push(`o.user_id = ${p(String(filters.userId))}::bigint`);
  if (range) conds.push(`o.created_at >= ${p(range.fromTs)}::timestamptz AND o.created_at < ${p(range.toTsExclusive)}::timestamptz`);
  if (f.q) {
    if (f.q.kind === "id") conds.push(`o.id = ${p(f.q.value)}::uuid`);
    else if (f.q.kind === "number") {
      const asNum = p(f.q.value);
      const asText = p(f.q.value);
      // Row-value IN uses the unique (provider, provider_txn) index for both providers.
      conds.push(`(o.prepare_id = ${asNum}::bigint OR (o.provider, o.provider_txn) IN (('click', ${asText}::text), ('payme', ${asText}::text)))`);
    } else {
      const txn = p(f.q.value);
      conds.push(`(o.provider, o.provider_txn) IN (('click', ${txn}::text), ('payme', ${txn}::text))`);
    }
  }
  const where = conds.length ? conds.join(" AND ") : "TRUE";
  return { sql: `FROM payment_orders o JOIN users u ON u.id = o.user_id WHERE ${where}`, params };
}

function parseOrderFilter(url: URL): OrderFilter {
  const parsed = parseListParams(url, ORDER_LIST_SPEC);
  return { parsed, q: classifyOrderQuery(singleParam(url, "q")) };
}

async function fetchOrderPage(
  db: Queryable,
  f: OrderFilter,
  sort: SortDef,
  cursor: KeysetCursor | null,
  limit: number,
): Promise<{ items: AdminOrderRow[]; nextCursor: string | null }> {
  const fw = orderFromWhere(f);
  const ks = buildKeyset({ sort, cursor, id: ORDER_LIST_SPEC.id, paramOffset: fw.params.length });
  const params = [...fw.params, ...ks.params, limit + 1];
  const res = await db.query<OrderDbRow & { cursor_v: string | null; cursor_id: string }>(
    `SELECT ${ORDER_COLUMNS}, ${keysetSelect(sort, ORDER_LIST_SPEC.id)}
       ${fw.sql} AND ${ks.where}
      ORDER BY ${ks.orderBy}
      LIMIT $${params.length}`,
    params,
  );
  const page = pageResult(res.rows, limit, sort);
  return { items: page.items.map(toOrderRow), nextCursor: page.nextCursor };
}

export type AdminList<T> = { items: T[]; nextCursor: string | null; total: number | null; totalCapped: boolean };

/** `GET /api/admin/orders`. */
export async function listAdminOrders(url: URL): Promise<AdminList<AdminOrderRow>> {
  const f = parseOrderFilter(url);
  const db = pool();
  const [page, count] = await Promise.all([
    fetchOrderPage(db, f, f.parsed.sort, f.parsed.cursor, f.parsed.limit),
    (() => {
      const fw = orderFromWhere(f);
      return countCapped(db, fw.sql, fw.params);
    })(),
  ]);
  return { ...page, total: count.total, totalCapped: count.totalCapped };
}

/** Filters as written to the export audit row (`meta.filters`). */
function orderFilterMeta(f: OrderFilter): Record<string, unknown> {
  const { filters, range, sortKey } = f.parsed;
  return {
    sort: sortKey,
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.purpose ? { purpose: filters.purpose } : {}),
    ...(filters.userId !== undefined ? { userId: String(filters.userId) } : {}),
    ...(range ? { from: range.fromDay, to: range.toDay } : {}),
    ...(f.q ? { q: f.q.value, qKind: f.q.kind } : {}),
  };
}

export const ORDER_CSV_HEADER = [
  "Buyurtma ID",
  "Foydalanuvchi ID",
  "Foydalanuvchi",
  "Provayder",
  "Maqsad",
  "Summa (so'm)",
  "Holat",
  "Provayder tranzaksiyasi",
  "Prepare ID",
  "Yaratilgan",
  "Provayderda yaratilgan",
  "To'langan",
  "Bekor qilingan",
  "Bekor qilish sababi",
  "Hisobga yozilgan",
  "Tashqi qaytarishlar",
] as const;

const isoToDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null);

function orderCsvRow(o: AdminOrderRow): unknown[] {
  return [
    o.id,
    o.userId,
    o.userName,
    o.provider,
    o.purpose,
    o.amountSoum,
    o.state,
    o.providerTxn,
    o.prepareId,
    new Date(o.createdAt),
    isoToDate(o.createTime),
    isoToDate(o.performTime),
    isoToDate(o.cancelTime),
    o.cancelReason,
    o.credited ? "ha" : "yo'q",
    o.externalRefunds,
  ];
}

/**
 * `GET /api/admin/orders/export` (payments.export, step-up): same filters as
 * the list, CSV in batches of 1 000 via keyset paging, capped at 100 000 rows.
 * The audit row (`export.orders`, `meta.filters`) commits before the first byte.
 */
export async function exportAdminOrders(url: URL, actor: AuditActor): Promise<Response> {
  const f = parseOrderFilter(url);
  const sort = f.parsed.sort;
  await adminTx(actor, (_client, audit) => audit({ action: "export.orders", targetType: "orders", meta: { filters: orderFilterMeta(f) } }));
  const db = pool();
  const batches = keysetBatches<AdminOrderRow>(
    async (cursor, limit) => {
      const decoded = cursor === null ? null : decodeCursor(cursor, sort, ORDER_LIST_SPEC.id);
      return fetchOrderPage(db, f, sort, decoded, limit);
    },
    1000,
    CSV_MAX_ROWS + 1,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse({ filename: `buyurtmalar-${stamp}.csv`, header: ORDER_CSV_HEADER, rows: flattenBatches(batches, orderCsvRow) });
}

/* -------------------------------------------------------------------------- */
/* Ledger rows and their links (shared with admin-finance.ts)                  */
/* -------------------------------------------------------------------------- */

export const TRANSACTION_KINDS = ["charge", "refund", "topup", "bonus", "subscription", "admin_credit", "admin_debit"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** What a ledger `reference` resolves to, for a link in the UI (built from ids, never from raw data). */
export type LedgerLink = { type: "order"; id: string } | { type: "generation"; id: string };

export type LedgerEntry = {
  id: string;
  userId: string;
  userName: string | null;
  kind: TransactionKind;
  points: number;
  quota: number;
  balance: number;
  reference: string | null;
  note: string | null;
  createdAt: string;
  link: LedgerLink | null;
};

export type LedgerDbRow = {
  id: string;
  user_id: string;
  user_name: string | null;
  kind: TransactionKind;
  points_delta: string;
  quota_delta: string;
  balance_delta: string;
  reference: string | null;
  note: string | null;
  created_at: Date;
};

export const LEDGER_COLUMNS = `t.id::text AS id, t.user_id::text AS user_id, u.name AS user_name, t.kind,
  t.points_delta::text AS points_delta, t.quota_delta::text AS quota_delta, t.balance_delta::text AS balance_delta,
  t.reference, t.note, t.created_at`;

const SETTLE_REF_RE = /^(click|payme):([\s\S]+)$/;
const CLAWBACK_REF_RE = /^refund:(\d{1,18})$/;

/**
 * Resolves each ledger reference to the admin screen it belongs to, with a
 * few batched lookups per page (never a per-row query):
 *   - `charge` / `refund` → the generation uuid (`credits.ts`: reference = job id);
 *   - `topup` / `subscription` → the order (`settleOrder` reference);
 *   - `admin_debit` with `refund:<payment_refunds.id>` → that refund's order (F6 clawback).
 * A reference that does not resolve to an existing row gets no link.
 */
export async function resolveLedgerLinks(db: Queryable, rows: readonly LedgerDbRow[]): Promise<Array<LedgerLink | null>> {
  const genIds = new Set<string>();
  const settle: Array<{ provider: string; rest: string }> = [];
  const refundIds = new Set<string>();
  for (const r of rows) {
    const ref = r.reference;
    if (!ref) continue;
    if ((r.kind === "charge" || r.kind === "refund") && UUID_RE.test(ref)) genIds.add(ref.toLowerCase());
    else if (r.kind === "topup" || r.kind === "subscription") {
      const m = SETTLE_REF_RE.exec(ref);
      if (m) settle.push({ provider: m[1] as string, rest: m[2] as string });
    } else if (r.kind === "admin_debit") {
      const m = CLAWBACK_REF_RE.exec(ref);
      if (m) refundIds.add(m[1] as string);
    }
  }

  const genFound = new Set<string>();
  if (genIds.size) {
    const res = await db.query<{ id: string }>(`SELECT id::text AS id FROM generations WHERE id = ANY($1::uuid[])`, [[...genIds]]);
    for (const r of res.rows) genFound.add(r.id);
  }

  // settlement reference → order id
  const orderByRef = new Map<string, string>();
  if (settle.length) {
    const providers = settle.map((s) => s.provider);
    const rests = settle.map((s) => s.rest);
    const uuids = settle.filter((s) => UUID_RE.test(s.rest)).map((s) => s.rest.toLowerCase());
    const res = await db.query<{ id: string; ref: string }>(
      `SELECT o.id::text AS id, ${SETTLE_REF_SQL} AS ref
         FROM payment_orders o
        WHERE (o.provider, o.provider_txn) IN (SELECT * FROM unnest($1::text[], $2::text[]))
           OR (o.provider_txn IS NULL AND o.id = ANY($3::uuid[]))`,
      [providers, rests, uuids],
    );
    for (const r of res.rows) orderByRef.set(r.ref, r.id);
  }

  const orderByRefund = new Map<string, string>();
  if (refundIds.size) {
    const res = await db.query<{ id: string; order_id: string }>(
      `SELECT id::text AS id, order_id::text AS order_id FROM payment_refunds WHERE id = ANY($1::bigint[])`,
      [[...refundIds]],
    );
    for (const r of res.rows) orderByRefund.set(r.id, r.order_id);
  }

  return rows.map((r): LedgerLink | null => {
    const ref = r.reference;
    if (!ref) return null;
    if (r.kind === "charge" || r.kind === "refund") {
      const id = ref.toLowerCase();
      return genFound.has(id) ? { type: "generation", id } : null;
    }
    if (r.kind === "topup" || r.kind === "subscription") {
      const id = orderByRef.get(ref);
      return id ? { type: "order", id } : null;
    }
    if (r.kind === "admin_debit") {
      const m = CLAWBACK_REF_RE.exec(ref);
      const id = m ? orderByRefund.get(m[1] as string) : undefined;
      return id ? { type: "order", id } : null;
    }
    return null;
  });
}

export function toLedgerEntry(r: LedgerDbRow, link: LedgerLink | null): LedgerEntry {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    kind: r.kind,
    points: Number(r.points_delta),
    quota: Number(r.quota_delta),
    balance: Number(r.balance_delta),
    reference: r.reference,
    note: r.note,
    createdAt: new Date(r.created_at).toISOString(),
    link,
  };
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

export type AdminOrderDetail = AdminOrderRow & {
  userUsername: string | null;
  updatedAt: string;
  /** The ledger reference the settlement uses (`<provider>:<provider_txn ?? id>`). */
  settlementReference: string;
  /** Soum already recorded as external refunds / chargebacks, and what is left of the order. */
  recordedSoum: number;
  remainingSoum: number;
};

export type AdminPaymentEvent = {
  id: string;
  provider: Provider;
  method: string;
  providerTxn: string | null;
  responseCode: number | null;
  receivedAt: string;
  /** The stored body, redacted at write time and redacted again here (defence in depth). */
  payload: unknown;
};

export type OrderLedgerEntry = LedgerEntry & {
  /** `credit`: the settlement row; `clawback`: an `admin_debit` written by an external refund. */
  role: "credit" | "clawback";
};

export type AdminOrderRefund = {
  id: string;
  amountSoum: number;
  kind: "refund" | "chargeback";
  reason: string;
  clawbackWallet: "balance" | "quota" | null;
  clawbackAmount: number;
  shortfall: number;
  clawbackTxId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type AdminOrderDetailResponse = {
  order: AdminOrderDetail;
  events: AdminPaymentEvent[];
  /** More than {@link MAX_ORDER_EVENTS} events exist; only the first ones are returned. */
  eventsCapped: boolean;
  ledger: OrderLedgerEntry[];
  refunds: AdminOrderRefund[];
};

export const MAX_ORDER_EVENTS = 200;

/** `GET /api/admin/orders/:id`; `null` when the order does not exist. */
export async function getAdminOrder(id: string): Promise<AdminOrderDetailResponse | null> {
  if (!UUID_RE.test(id)) return null;
  const orderId = id.toLowerCase();
  const db = pool();
  const res = await db.query<OrderDbRow & { user_username: string | null; updated_at: Date; settle_ref: string; recorded_soum: string }>(
    `SELECT ${ORDER_COLUMNS}, u.username AS user_username, o.updated_at, ${SETTLE_REF_SQL} AS settle_ref,
            (SELECT COALESCE(sum(r.amount_soum), 0) FROM payment_refunds r WHERE r.order_id = o.id)::text AS recorded_soum
       FROM payment_orders o JOIN users u ON u.id = o.user_id
      WHERE o.id = $1::uuid`,
    [orderId],
  );
  const row = res.rows[0];
  if (!row) return null;
  const base = toOrderRow(row);
  const recordedSoum = Number(row.recorded_soum);
  const order: AdminOrderDetail = {
    ...base,
    userUsername: row.user_username,
    updatedAt: new Date(row.updated_at).toISOString(),
    settlementReference: row.settle_ref,
    recordedSoum,
    remainingSoum: Math.max(0, base.amountSoum - recordedSoum),
  };

  const [events, refunds] = await Promise.all([
    db.query<{ id: string; provider: Provider; method: string; provider_txn: string | null; response_code: number | null; received_at: Date; payload: unknown }>(
      `SELECT id::text AS id, provider, method, provider_txn, response_code, received_at, payload
         FROM payment_events
        WHERE order_id = $1 OR ($2::text IS NOT NULL AND provider = $3 AND provider_txn = $2::text)
        ORDER BY received_at, id
        LIMIT $4`,
      [orderId, base.providerTxn, base.provider, MAX_ORDER_EVENTS + 1],
    ),
    db.query<{
      id: string;
      amount_soum: string;
      kind: "refund" | "chargeback";
      reason: string;
      clawback_wallet: "balance" | "quota" | null;
      clawback_amount: string;
      shortfall: string;
      clawback_tx_id: string | null;
      created_by: string | null;
      created_by_name: string | null;
      created_at: Date;
    }>(
      `SELECT r.id::text AS id, r.amount_soum::text AS amount_soum, r.kind, r.reason, r.clawback_wallet,
              r.clawback_amount::text AS clawback_amount, r.shortfall::text AS shortfall,
              r.clawback_tx_id::text AS clawback_tx_id, r.created_by::text AS created_by, cu.name AS created_by_name, r.created_at
         FROM payment_refunds r
         LEFT JOIN admin_accounts a ON a.id = r.created_by
         LEFT JOIN users cu ON cu.id = a.user_id
        WHERE r.order_id = $1::uuid
        ORDER BY r.id`,
      [orderId],
    ),
  ]);

  const refundRefs = refunds.rows.map((r) => `refund:${r.id}`);
  const ledgerRes = await db.query<LedgerDbRow>(
    `SELECT ${LEDGER_COLUMNS}
       FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE (t.kind = $1 AND t.reference = $2)
         OR (t.kind = 'admin_debit' AND t.reference = ANY($3::text[]))
      ORDER BY t.created_at, t.id`,
    [base.purpose === "pro" ? "subscription" : "topup", row.settle_ref, refundRefs],
  );
  const ledger: OrderLedgerEntry[] = ledgerRes.rows.map((r) => ({
    ...toLedgerEntry(r, { type: "order", id: orderId }),
    role: r.kind === "admin_debit" ? "clawback" : "credit",
  }));

  return {
    order,
    events: events.rows.slice(0, MAX_ORDER_EVENTS).map((e) => ({
      id: e.id,
      provider: e.provider,
      method: e.method,
      providerTxn: e.provider_txn,
      responseCode: e.response_code,
      receivedAt: new Date(e.received_at).toISOString(),
      payload: redactPayload(e.payload),
    })),
    eventsCapped: events.rows.length > MAX_ORDER_EVENTS,
    ledger,
    refunds: refunds.rows.map((r) => ({
      id: r.id,
      amountSoum: Number(r.amount_soum),
      kind: r.kind,
      reason: r.reason,
      clawbackWallet: r.clawback_wallet,
      clawbackAmount: Number(r.clawback_amount),
      shortfall: Number(r.shortfall),
      clawbackTxId: r.clawback_tx_id,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}
