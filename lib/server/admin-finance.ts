import "server-only";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { pool, transaction } from "./db";
import { adminTx, type AuditActor } from "./admin-audit";
import {
  buildKeyset,
  countCapped,
  decodeCursor,
  keysetSelect,
  pageResult,
  parseDateRange,
  parseListParams,
  type DateRange,
  type KeysetCursor,
  type ListSpec,
  type ParsedList,
  type SortDef,
} from "./admin-list";
import { CSV_MAX_ROWS, csvResponse, flattenBatches, keysetBatches } from "./admin-csv";
import {
  CREDITED_SQL,
  LEDGER_COLUMNS,
  TRANSACTION_KINDS,
  resolveLedgerLinks,
  toLedgerEntry,
  type AdminList,
  type LedgerDbRow,
  type LedgerEntry,
} from "./admin-payments";
import type { Provider, Purpose } from "./payments";
import { toolKeyTitle } from "./admin-ai";

/**
 * Finance for the admin panel (docs/admin/02-plan.md §6.6, §7.1 S10, §9):
 * revenue summary, the global ledger and the reconciliation checks.
 *
 * Every aggregation runs in its own `READ ONLY` transaction with
 * `statement_timeout = 10s`; days are Asia/Tashkent calendar days. The summary
 * is cached in-process for 60 s per range; the ledger list and the
 * reconciliation are never cached (reconciliation runs on demand only).
 */

type Queryable = Pick<PoolClient, "query">;

const AGG_TIMEOUT_MS = 10_000;
const PG_QUERY_CANCELED = "57014";

/** `SET TRANSACTION READ ONLY` + a local statement timeout (plan §9). */
async function readOnly<T>(timeoutMs: number, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const ms = Math.max(1, Math.min(Math.trunc(timeoutMs), 60_000));
  return transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    // SET does not take bind parameters; `ms` is a clamped integer, never user text.
    await client.query(`SET LOCAL statement_timeout = ${ms}`);
    return fn(client);
  });
}

function isTimeout(e: unknown): boolean {
  return Boolean(e && typeof e === "object" && (e as { code?: unknown }).code === PG_QUERY_CANCELED);
}

const num = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));

/* -------------------------------------------------------------------------- */
/* 60 s cache                                                                  */
/* -------------------------------------------------------------------------- */

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 64;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await compute();
  cache.delete(key);
  cache.set(key, { at: Date.now(), value });
  // Map keeps insertion order: drop the oldest entries beyond the bound.
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/** Test hook: forget every cached summary. */
export function clearFinanceCache(): void {
  cache.clear();
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

export type Wallets = { points: number; quota: number; balance: number };
export type RevenueBucket = { soum: number; orders: number };

export type RevenueDay = {
  /** `YYYY-MM-DD`, Asia/Tashkent. Every day of the range is present (zero-filled). */
  day: string;
  soum: number;
  orders: number;
  click: number;
  payme: number;
  topup: number;
  pro: number;
};

export type FinanceSummary = {
  range: { from: string; to: string; days: number };
  /**
   * Paid orders by the Tashkent day of the provider's perform time
   * (`perform_time`, epoch ms) — the same definition as the dashboard
   * (`admin-metrics.ts` revenueSoum), so both screens agree. A paid order
   * without a perform time (never written by `settleOrder`) is not revenue here;
   * reconciliation reports it if it also lacks the ledger row.
   */
  revenue: {
    total: RevenueBucket;
    byDay: RevenueDay[];
    byProvider: Record<Provider, RevenueBucket>;
    byPurpose: Record<Purpose, RevenueBucket>;
  };
  /** Spent on jobs (`charge` rows, as positive amounts): balance is real-money tanga, quota is Pro, points are bonus. */
  cashSpend: Wallets & { charges: number };
  /** Job refunds (`refund` rows), full and partial. */
  refunds: Wallets & { count: number };
  /** Manual wallet adjustments (`admin_credit` / `admin_debit` incl. clawbacks), signed sums. */
  adjustments: Wallets & { count: number };
  /** Σ of every wallet right now (what users can still spend). */
  liabilities: Wallets & { users: number };
  /** External refunds / chargebacks recorded in range (`payment_refunds`). */
  externalRefunds: {
    count: number;
    amountSoum: number;
    refunds: number;
    chargebacks: number;
    clawedBack: { balance: number; quota: number };
    shortfall: number;
  };
  generatedAt: string;
};

type DayRow = { day: string; soum: string; orders: string; click: string; payme: string; topup: string; pro: string; click_n: string; payme_n: string; topup_n: string; pro_n: string };

async function revenue(client: Queryable, range: DateRange): Promise<FinanceSummary["revenue"]> {
  const fromMs = String(Date.parse(range.fromTs));
  const toMs = String(Date.parse(range.toTsExclusive));
  const res = await client.query<DayRow>(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d
     ), paid AS (
       SELECT o.provider, o.purpose, o.amount_soum,
              (to_timestamp(o.perform_time / 1000.0) AT TIME ZONE 'Asia/Tashkent')::date AS day
         FROM payment_orders o
        WHERE o.state = 'paid' AND o.perform_time >= $3::bigint AND o.perform_time < $4::bigint
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(sum(p.amount_soum), 0)::text AS soum,
            count(p.amount_soum)::text AS orders,
            COALESCE(sum(p.amount_soum) FILTER (WHERE p.provider = 'click'), 0)::text AS click,
            COALESCE(sum(p.amount_soum) FILTER (WHERE p.provider = 'payme'), 0)::text AS payme,
            COALESCE(sum(p.amount_soum) FILTER (WHERE p.purpose = 'topup'), 0)::text AS topup,
            COALESCE(sum(p.amount_soum) FILTER (WHERE p.purpose = 'pro'), 0)::text AS pro,
            count(*) FILTER (WHERE p.provider = 'click')::text AS click_n,
            count(*) FILTER (WHERE p.provider = 'payme')::text AS payme_n,
            count(*) FILTER (WHERE p.purpose = 'topup')::text AS topup_n,
            count(*) FILTER (WHERE p.purpose = 'pro')::text AS pro_n
       FROM days d LEFT JOIN paid p ON p.day = d.day
      GROUP BY d.day
      ORDER BY d.day`,
    [range.fromDay, range.toDay, fromMs, toMs],
  );
  const total: RevenueBucket = { soum: 0, orders: 0 };
  const byProvider: Record<Provider, RevenueBucket> = { click: { soum: 0, orders: 0 }, payme: { soum: 0, orders: 0 } };
  const byPurpose: Record<Purpose, RevenueBucket> = { topup: { soum: 0, orders: 0 }, pro: { soum: 0, orders: 0 } };
  const byDay = res.rows.map((r): RevenueDay => {
    total.soum += num(r.soum);
    total.orders += num(r.orders);
    byProvider.click.soum += num(r.click);
    byProvider.click.orders += num(r.click_n);
    byProvider.payme.soum += num(r.payme);
    byProvider.payme.orders += num(r.payme_n);
    byPurpose.topup.soum += num(r.topup);
    byPurpose.topup.orders += num(r.topup_n);
    byPurpose.pro.soum += num(r.pro);
    byPurpose.pro.orders += num(r.pro_n);
    return { day: r.day, soum: num(r.soum), orders: num(r.orders), click: num(r.click), payme: num(r.payme), topup: num(r.topup), pro: num(r.pro) };
  });
  return { total, byDay, byProvider, byPurpose };
}

type KindRow = { kind: string; n: string; points: string; quota: string; balance: string };

async function ledgerTotals(client: Queryable, range: DateRange) {
  const res = await client.query<KindRow>(
    `SELECT t.kind, count(*)::text AS n,
            COALESCE(sum(t.points_delta), 0)::text AS points,
            COALESCE(sum(t.quota_delta), 0)::text AS quota,
            COALESCE(sum(t.balance_delta), 0)::text AS balance
       FROM transactions t
      WHERE t.created_at >= $1::timestamptz AND t.created_at < $2::timestamptz
        AND t.kind IN ('charge', 'refund', 'admin_credit', 'admin_debit')
      GROUP BY t.kind`,
    [range.fromTs, range.toTsExclusive],
  );
  const by = new Map(res.rows.map((r) => [r.kind, r]));
  const w = (k: string, sign = 1): Wallets & { n: number } => {
    const r = by.get(k);
    return { n: num(r?.n), points: sign * num(r?.points), quota: sign * num(r?.quota), balance: sign * num(r?.balance) };
  };
  const charge = w("charge", -1);
  const refund = w("refund");
  const credit = w("admin_credit");
  const debit = w("admin_debit");
  return {
    cashSpend: { charges: charge.n, points: charge.points, quota: charge.quota, balance: charge.balance },
    refunds: { count: refund.n, points: refund.points, quota: refund.quota, balance: refund.balance },
    adjustments: {
      count: credit.n + debit.n,
      points: credit.points + debit.points,
      quota: credit.quota + debit.quota,
      balance: credit.balance + debit.balance,
    },
  };
}

async function liabilities(client: Queryable): Promise<FinanceSummary["liabilities"]> {
  const res = await client.query<{ points: string; quota: string; balance: string; users: string }>(
    `SELECT COALESCE(sum(points), 0)::text AS points, COALESCE(sum(quota), 0)::text AS quota,
            COALESCE(sum(balance), 0)::text AS balance,
            count(*) FILTER (WHERE points > 0 OR quota > 0 OR balance > 0)::text AS users
       FROM users`,
  );
  const r = res.rows[0];
  return { points: num(r?.points), quota: num(r?.quota), balance: num(r?.balance), users: num(r?.users) };
}

async function externalRefunds(client: Queryable, range: DateRange): Promise<FinanceSummary["externalRefunds"]> {
  const res = await client.query<{ n: string; amount: string; refunds: string; chargebacks: string; balance: string; quota: string; shortfall: string }>(
    `SELECT count(*)::text AS n, COALESCE(sum(amount_soum), 0)::text AS amount,
            count(*) FILTER (WHERE kind = 'refund')::text AS refunds,
            count(*) FILTER (WHERE kind = 'chargeback')::text AS chargebacks,
            COALESCE(sum(clawback_amount) FILTER (WHERE clawback_wallet = 'balance'), 0)::text AS balance,
            COALESCE(sum(clawback_amount) FILTER (WHERE clawback_wallet = 'quota'), 0)::text AS quota,
            COALESCE(sum(shortfall), 0)::text AS shortfall
       FROM payment_refunds
      WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
    [range.fromTs, range.toTsExclusive],
  );
  const r = res.rows[0];
  return {
    count: num(r?.n),
    amountSoum: num(r?.amount),
    refunds: num(r?.refunds),
    chargebacks: num(r?.chargebacks),
    clawedBack: { balance: num(r?.balance), quota: num(r?.quota) },
    shortfall: num(r?.shortfall),
  };
}

/** Parses `from`/`to` (default: the last 30 days) with the shared single-value rule. */
function summaryRange(url: URL): DateRange {
  for (const name of ["from", "to"]) {
    if (url.searchParams.getAll(name).length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
  }
  return parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"), { maxDays: 366, defaultDays: 30 });
}

/** `GET /api/admin/finance/summary` (cached 60 s per range). */
export async function financeSummary(url: URL): Promise<FinanceSummary> {
  const range = summaryRange(url);
  return cached(`summary:${range.fromDay}:${range.toDay}`, () =>
    readOnly(AGG_TIMEOUT_MS, async (client) => {
      const rev = await revenue(client, range);
      const led = await ledgerTotals(client, range);
      const liab = await liabilities(client);
      const ext = await externalRefunds(client, range);
      return {
        range: { from: range.fromDay, to: range.toDay, days: range.days },
        revenue: rev,
        ...led,
        liabilities: liab,
        externalRefunds: ext,
        generatedAt: new Date().toISOString(),
      };
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

export const RECONCILIATION_CHECK_IDS = [
  "paid_without_ledger",
  "wallet_ledger_mismatch",
  "failed_unrefunded",
  "partial_refund_missing",
  "orders_pending_12h",
  "orders_created_24h",
] as const;
export type ReconciliationCheckId = (typeof RECONCILIATION_CHECK_IDS)[number];

export const SAMPLE_LIMIT = 20;
/** `wallet_ledger_mismatch` stops after this many users (plan §9). */
export const WALLET_MISMATCH_LIMIT = 100;

export type OrderSample = {
  type: "order";
  id: string;
  userId: string;
  userName: string;
  provider: Provider;
  purpose: Purpose;
  amountSoum: number;
  state: string;
  createdAt: string;
  credited: boolean;
};

export type GenerationSample = {
  type: "generation";
  id: string;
  userId: string;
  userName: string;
  toolId: string;
  /** Uzbek title of `toolId` (`toolKeyTitle`); `toolId` itself is unchanged. */
  toolTitle: string;
  finishedAt: string | null;
  charged: Wallets;
  delivered: { got: number; want: number } | null;
};

export type WalletSample = {
  type: "user";
  id: string;
  userName: string;
  wallet: Wallets;
  ledger: Wallets;
};

export type ReconciliationSample = OrderSample | GenerationSample | WalletSample;

export type ReconciliationCheck = {
  id: ReconciliationCheckId;
  title: string;
  /** `error`: money is wrong; `warning`: needs a look; `info`: usually benign. */
  severity: "error" | "warning" | "info";
  /** `null` when the check timed out. */
  count: number | null;
  /** The count hit its bound (10 000+, or 100 for the wallet check). */
  countCapped: boolean;
  sample: ReconciliationSample[];
  /** The 10 s bound was hit (plan §9); the UI asks to narrow the range. */
  timedOut: boolean;
};

export type Reconciliation = {
  checks: ReconciliationCheck[];
  /** Users' signup range the wallet check was narrowed to, when given. */
  walletRange: { from: string; to: string } | null;
  generatedAt: string;
};

const CHECK_META: Record<ReconciliationCheckId, { title: string; severity: ReconciliationCheck["severity"] }> = {
  paid_without_ledger: { title: "To'langan, lekin hisobga yozilmagan buyurtmalar", severity: "error" },
  wallet_ledger_mismatch: { title: "Hamyon qoldig'i hisob yozuvlari yig'indisiga teng emas", severity: "error" },
  failed_unrefunded: { title: "Xato bilan tugagan, puli qaytarilmagan ishlar", severity: "error" },
  partial_refund_missing: { title: "Qisman yetkazilgan, farqi qaytarilmagan ishlar", severity: "warning" },
  orders_pending_12h: { title: "12 soatdan ortiq kutilayotgan buyurtmalar", severity: "warning" },
  orders_created_24h: { title: "24 soatdan ortiq «yaratilgan» holatida qolgan buyurtmalar", severity: "info" },
};

type CheckResult = { count: number; countCapped: boolean; sample: ReconciliationSample[] };

type OrderSampleRow = {
  id: string;
  user_id: string;
  user_name: string;
  provider: Provider;
  purpose: Purpose;
  amount_soum: string;
  state: string;
  created_at: Date;
  credited: boolean;
};

const ORDER_SAMPLE_COLUMNS = `o.id::text AS id, o.user_id::text AS user_id, u.name AS user_name, o.provider, o.purpose,
  o.amount_soum::text AS amount_soum, o.state, o.created_at, ${CREDITED_SQL} AS credited`;

async function orderCheck(client: Queryable, fromWhere: string, orderBy: string): Promise<CheckResult> {
  const count = await countCapped(client, fromWhere, []);
  const res = await client.query<OrderSampleRow>(`SELECT ${ORDER_SAMPLE_COLUMNS} ${fromWhere} ORDER BY ${orderBy} LIMIT ${SAMPLE_LIMIT}`);
  return {
    count: count.total,
    countCapped: count.totalCapped,
    sample: res.rows.map((r) => ({
      type: "order",
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      provider: r.provider,
      purpose: r.purpose,
      amountSoum: Number(r.amount_soum),
      state: r.state,
      createdAt: new Date(r.created_at).toISOString(),
      credited: r.credited,
    })),
  };
}

const ORDERS_FROM = `FROM payment_orders o JOIN users u ON u.id = o.user_id`;

const CHECK_SQL = {
  paid_without_ledger: `${ORDERS_FROM} WHERE o.state = 'paid' AND NOT ${CREDITED_SQL}`,
  // Pending since the provider transaction was attached (Payme voids it after 12 h, payments.ts PAYME_TIMEOUT_MS).
  orders_pending_12h: `${ORDERS_FROM} WHERE o.state = 'pending'
    AND GREATEST(o.created_at, CASE WHEN o.create_time > 0 THEN to_timestamp(o.create_time / 1000.0) ELSE o.created_at END) < now() - interval '12 hours'`,
  orders_created_24h: `${ORDERS_FROM} WHERE o.state = 'created' AND o.created_at < now() - interval '24 hours'`,
  // Same rule as the worker's safety net (refund-reconcile.ts), but any age.
  failed_unrefunded: `FROM generations g
      JOIN users u ON u.id = g.user_id
      JOIN transactions c ON c.kind = 'charge' AND c.reference = g.id::text AND c.user_id = g.user_id
     WHERE g.status = 'FAILED'
       AND (c.points_delta + c.quota_delta + c.balance_delta) < 0
       AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.kind = 'refund' AND r.reference = g.id::text)`,
} as const;

type GenSampleRow = {
  id: string;
  user_id: string;
  user_name: string;
  tool_id: string;
  finished_at: Date | null;
  points: string;
  quota: string;
  balance: string;
  got: string | null;
  want: string | null;
};

function toGenSample(r: GenSampleRow): GenerationSample {
  return {
    type: "generation",
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    toolId: r.tool_id,
    toolTitle: toolKeyTitle(r.tool_id),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    charged: { points: num(r.points), quota: num(r.quota), balance: num(r.balance) },
    delivered: r.got !== null && r.want !== null ? { got: Number(r.got), want: Number(r.want) } : null,
  };
}

async function failedUnrefunded(client: Queryable): Promise<CheckResult> {
  const fw = CHECK_SQL.failed_unrefunded;
  const count = await countCapped(client, fw, []);
  const res = await client.query<GenSampleRow>(
    `SELECT g.id::text AS id, g.user_id::text AS user_id, u.name AS user_name, g.tool_id, g.finished_at,
            (-c.points_delta)::text AS points, (-c.quota_delta)::text AS quota, (-c.balance_delta)::text AS balance,
            NULL::text AS got, NULL::text AS want
       ${fw}
      ORDER BY g.finished_at DESC NULLS LAST, g.id DESC
      LIMIT ${SAMPLE_LIMIT}`,
  );
  return { count: count.total, countCapped: count.totalCapped, sample: res.rows.map(toGenSample) };
}

/**
 * COMPLETED jobs that delivered less than promised (`delivered.got < want`),
 * were charged, and have no `refund` row (`worker.ts` → `refundPartial` writes
 * one with `reference = <job id>`). Mirrors `refundRatio` (lib/generation/
 * delivered.ts): a shortfall whose price share is 0 (`refundShare` /
 * `noneShare` ≤ 0) owes nothing and is not reported. The JSON numbers are
 * cast only inside `CASE` so a malformed row can never fail the query.
 */
const PARTIAL_FROM = `FROM (
    SELECT g.id, g.user_id, g.tool_id, g.finished_at,
           CASE WHEN jsonb_typeof(g.delivered_json->'got') = 'number' THEN (g.delivered_json->>'got')::numeric END AS got,
           CASE WHEN jsonb_typeof(g.delivered_json->'want') = 'number' THEN (g.delivered_json->>'want')::numeric END AS want,
           CASE WHEN jsonb_typeof(g.delivered_json->'refundShare') = 'number' THEN (g.delivered_json->>'refundShare')::numeric END AS refund_share,
           CASE WHEN jsonb_typeof(g.delivered_json->'noneShare') = 'number' THEN (g.delivered_json->>'noneShare')::numeric END AS none_share
      FROM generations g
     WHERE g.status = 'COMPLETED' AND g.delivered_json IS NOT NULL
  ) d
  JOIN users u ON u.id = d.user_id
  JOIN transactions c ON c.kind = 'charge' AND c.reference = d.id::text AND c.user_id = d.user_id
 WHERE d.want > 0 AND d.got < d.want
   AND CASE WHEN d.got <= 0 THEN COALESCE(d.none_share, 1) > 0 ELSE COALESCE(d.refund_share, 1) > 0 END
   AND (c.points_delta + c.quota_delta + c.balance_delta) < 0
   AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.kind = 'refund' AND r.reference = d.id::text)`;

async function partialRefundMissing(client: Queryable): Promise<CheckResult> {
  const count = await countCapped(client, PARTIAL_FROM, []);
  const res = await client.query<GenSampleRow>(
    `SELECT d.id::text AS id, d.user_id::text AS user_id, u.name AS user_name, d.tool_id, d.finished_at,
            (-c.points_delta)::text AS points, (-c.quota_delta)::text AS quota, (-c.balance_delta)::text AS balance,
            d.got::text AS got, d.want::text AS want
       ${PARTIAL_FROM}
      ORDER BY d.finished_at DESC NULLS LAST, d.id DESC
      LIMIT ${SAMPLE_LIMIT}`,
  );
  return { count: count.total, countCapped: count.totalCapped, sample: res.rows.map(toGenSample) };
}

/**
 * Users whose wallets differ from the sum of their ledger rows. Every wallet
 * write goes through the ledger (credits.ts, refund-tx.ts, signup bonus), so
 * any hit means a write bypassed it. A full aggregate over `transactions`:
 * bounded by the statement timeout and `LIMIT 100` (plan §9), optionally
 * narrowed to users who signed up in `range`.
 */
async function walletLedgerMismatch(client: Queryable, range: DateRange | null): Promise<CheckResult> {
  const params: unknown[] = [];
  let userCond = "TRUE";
  if (range) {
    params.push(range.fromTs, range.toTsExclusive);
    userCond = `u.created_at >= $1::timestamptz AND u.created_at < $2::timestamptz`;
  }
  const res = await client.query<{ id: string; name: string; points: string; quota: string; balance: string; l_points: string; l_quota: string; l_balance: string }>(
    `SELECT u.id::text AS id, u.name, u.points::text AS points, u.quota::text AS quota, u.balance::text AS balance,
            COALESCE(l.points, 0)::text AS l_points, COALESCE(l.quota, 0)::text AS l_quota, COALESCE(l.balance, 0)::text AS l_balance
       FROM users u
       LEFT JOIN (
         SELECT t.user_id, sum(t.points_delta) AS points, sum(t.quota_delta) AS quota, sum(t.balance_delta) AS balance
           FROM transactions t
          ${range ? "WHERE t.user_id IN (SELECT u.id FROM users u WHERE " + userCond + ")" : ""}
          GROUP BY t.user_id
       ) l ON l.user_id = u.id
      WHERE ${userCond}
        AND (u.points, u.quota, u.balance) IS DISTINCT FROM (COALESCE(l.points, 0), COALESCE(l.quota, 0), COALESCE(l.balance, 0))
      ORDER BY u.id
      LIMIT ${WALLET_MISMATCH_LIMIT}`,
    params,
  );
  return {
    count: res.rows.length,
    countCapped: res.rows.length >= WALLET_MISMATCH_LIMIT,
    sample: res.rows.slice(0, SAMPLE_LIMIT).map((r) => ({
      type: "user",
      id: r.id,
      userName: r.name,
      wallet: { points: num(r.points), quota: num(r.quota), balance: num(r.balance) },
      ledger: { points: num(r.l_points), quota: num(r.l_quota), balance: num(r.l_balance) },
    })),
  };
}

function runCheck(id: ReconciliationCheckId, client: Queryable, range: DateRange | null): Promise<CheckResult> {
  switch (id) {
    case "paid_without_ledger":
      return orderCheck(client, CHECK_SQL.paid_without_ledger, "o.created_at DESC, o.id DESC");
    case "wallet_ledger_mismatch":
      return walletLedgerMismatch(client, range);
    case "failed_unrefunded":
      return failedUnrefunded(client);
    case "partial_refund_missing":
      return partialRefundMissing(client);
    case "orders_pending_12h":
      return orderCheck(client, CHECK_SQL.orders_pending_12h, "o.created_at ASC, o.id ASC");
    case "orders_created_24h":
      return orderCheck(client, CHECK_SQL.orders_created_24h, "o.created_at DESC, o.id DESC");
  }
}

export type ReconciliationOptions = {
  /** Per-check statement timeout; the route always uses the default 10 s. Exposed for tests. */
  timeoutMs?: number;
};

/**
 * Optional `from`/`to` narrow `wallet_ledger_mismatch` to users who signed up
 * in that Tashkent range (the way out when the full aggregate times out).
 */
function walletRangeOf(url: URL): DateRange | null {
  for (const name of ["from", "to"]) {
    if (url.searchParams.getAll(name).length > 1) throw new ApiError(`Noto'g'ri parametr: ${name}`, 400);
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from && !to) return null;
  return parseDateRange(from, to, { maxDays: 366, defaultDays: 30 });
}

/**
 * `GET /api/admin/finance/reconciliation`. Each check runs in its own
 * read-only transaction with its own timeout, so one slow check (typically the
 * wallet aggregate) reports `timedOut` while the others still answer.
 */
export async function runReconciliation(url: URL, opts: ReconciliationOptions = {}): Promise<Reconciliation> {
  const range = walletRangeOf(url);
  const timeoutMs = opts.timeoutMs ?? AGG_TIMEOUT_MS;
  const checks: ReconciliationCheck[] = [];
  // Sequential on purpose: one pooled connection at a time (the admin shares the 10-connection pool, §9).
  for (const id of RECONCILIATION_CHECK_IDS) {
    const meta = CHECK_META[id];
    try {
      const r = await readOnly(timeoutMs, (client) => runCheck(id, client, range));
      checks.push({ id, ...meta, ...r, timedOut: false });
    } catch (e) {
      if (!isTimeout(e)) throw e;
      checks.push({ id, ...meta, count: null, countCapped: false, sample: [], timedOut: true });
    }
  }
  return { checks, walletRange: range ? { from: range.fromDay, to: range.toDay } : null, generatedAt: new Date().toISOString() };
}

/* -------------------------------------------------------------------------- */
/* Global ledger                                                               */
/* -------------------------------------------------------------------------- */

export const LEDGER_LIST_SPEC = {
  sorts: {
    created_desc: { column: "t.created_at", dir: "DESC", type: "timestamptz" },
  },
  id: { column: "t.id", type: "bigint" },
  filters: {
    kind: { kind: "enumList", values: TRANSACTION_KINDS },
    userId: { kind: "int", min: 1, max: Number.MAX_SAFE_INTEGER },
  },
  range: { maxDays: 366 },
} as const satisfies ListSpec;

type LedgerFilter = { parsed: ParsedList<typeof LEDGER_LIST_SPEC>; reference: string | null };

const MAX_REFERENCE_CHARS = 200;

function parseReference(url: URL): string | null {
  const all = url.searchParams.getAll("reference");
  if (all.length > 1) throw new ApiError("Noto'g'ri parametr: reference", 400);
  const raw = all[0];
  if (raw === undefined) return null;
  if (raw.includes("\0")) throw new ApiError("Noto'g'ri parametr: reference", 400);
  const s = raw.trim();
  if (s === "") return null;
  if (s.length > MAX_REFERENCE_CHARS) throw new ApiError("Havola juda uzun", 400);
  return s;
}

function ledgerFromWhere(f: LedgerFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const conds: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const { filters, range } = f.parsed;
  // With an exact reference and no kind, all kinds are listed so `transactions_ref_idx (kind, reference)` still applies.
  const kinds = filters.kind && filters.kind.length ? filters.kind : f.reference !== null ? [...TRANSACTION_KINDS] : null;
  if (kinds) conds.push(`t.kind = ANY(${p(kinds)}::text[])`);
  if (f.reference !== null) conds.push(`t.reference = ${p(f.reference)}`);
  if (filters.userId !== undefined) conds.push(`t.user_id = ${p(String(filters.userId))}::bigint`);
  if (range) conds.push(`t.created_at >= ${p(range.fromTs)}::timestamptz AND t.created_at < ${p(range.toTsExclusive)}::timestamptz`);
  const where = conds.length ? conds.join(" AND ") : "TRUE";
  return { sql: `FROM transactions t JOIN users u ON u.id = t.user_id WHERE ${where}`, params };
}

function parseLedgerFilter(url: URL): LedgerFilter {
  return { parsed: parseListParams(url, LEDGER_LIST_SPEC), reference: parseReference(url) };
}

async function fetchLedgerPage(
  db: Queryable,
  f: LedgerFilter,
  sort: SortDef,
  cursor: KeysetCursor | null,
  limit: number,
): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
  const fw = ledgerFromWhere(f);
  const ks = buildKeyset({ sort, cursor, id: LEDGER_LIST_SPEC.id, paramOffset: fw.params.length });
  const params = [...fw.params, ...ks.params, limit + 1];
  const res = await db.query<LedgerDbRow & { cursor_v: string | null; cursor_id: string }>(
    `SELECT ${LEDGER_COLUMNS}, ${keysetSelect(sort, LEDGER_LIST_SPEC.id)}
       ${fw.sql} AND ${ks.where}
      ORDER BY ${ks.orderBy}
      LIMIT $${params.length}`,
    params,
  );
  const page = pageResult(res.rows, limit, sort);
  const rows = page.items as LedgerDbRow[];
  const links = await resolveLedgerLinks(db, rows);
  return { items: rows.map((r, i) => toLedgerEntry(r, links[i] ?? null)), nextCursor: page.nextCursor };
}

/** `GET /api/admin/transactions`. */
export async function listLedger(url: URL): Promise<AdminList<LedgerEntry>> {
  const f = parseLedgerFilter(url);
  const db = pool();
  const fw = ledgerFromWhere(f);
  const [page, count] = await Promise.all([
    fetchLedgerPage(db, f, f.parsed.sort, f.parsed.cursor, f.parsed.limit),
    countCapped(db, fw.sql, fw.params),
  ]);
  return { ...page, total: count.total, totalCapped: count.totalCapped };
}

export const LEDGER_CSV_HEADER = [
  "ID",
  "Vaqt",
  "Foydalanuvchi ID",
  "Foydalanuvchi",
  "Turi",
  "Bonus ball",
  "Pro kvota",
  "Balans",
  "Havola",
  "Izoh",
  "Bog'liq obyekt",
  "Bog'liq obyekt ID",
] as const;

function ledgerCsvRow(e: LedgerEntry): unknown[] {
  return [
    e.id,
    new Date(e.createdAt),
    e.userId,
    e.userName,
    e.kind,
    e.points,
    e.quota,
    e.balance,
    e.reference,
    e.note,
    e.link ? (e.link.type === "order" ? "buyurtma" : "generatsiya") : null,
    e.link?.id ?? null,
  ];
}

function ledgerFilterMeta(f: LedgerFilter): Record<string, unknown> {
  const { filters, range, sortKey } = f.parsed;
  return {
    sort: sortKey,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.userId !== undefined ? { userId: String(filters.userId) } : {}),
    ...(f.reference !== null ? { reference: f.reference } : {}),
    ...(range ? { from: range.fromDay, to: range.toDay } : {}),
  };
}

/** `GET /api/admin/transactions/export` (finance.export, step-up). */
export async function exportLedger(url: URL, actor: AuditActor): Promise<Response> {
  const f = parseLedgerFilter(url);
  const sort = f.parsed.sort;
  await adminTx(actor, (_client, audit) => audit({ action: "export.transactions", targetType: "transactions", meta: { filters: ledgerFilterMeta(f) } }));
  const db = pool();
  const batches = keysetBatches<LedgerEntry>(
    async (cursor, limit) => {
      const decoded = cursor === null ? null : decodeCursor(cursor, sort, LEDGER_LIST_SPEC.id);
      return fetchLedgerPage(db, f, sort, decoded, limit);
    },
    1000,
    CSV_MAX_ROWS + 1,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return csvResponse({ filename: `hisob-kitobi-${stamp}.csv`, header: LEDGER_CSV_HEADER, rows: flattenBatches(batches, ledgerCsvRow) });
}
