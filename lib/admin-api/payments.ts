"use client";

import {
  AdminAuthRequiredError,
  AdminForbiddenError,
  AdminNotFoundError,
  AdminReauthCancelledError,
  ApiError,
  adminGet,
  buildQuery,
  runStepUp,
  type AdminCallOptions,
  type AdminParams,
  type ListResult,
} from "./core";

/**
 * Payments and finance API (docs/admin/02-plan.md §6.6): orders (S8/S9),
 * finance summary, reconciliation and the global ledger (S10). Types mirror
 * `lib/server/admin-payments.ts` / `admin-finance.ts`; they are declared
 * here because admin client code never imports `lib/server/**`.
 * The external-refund mutation lives in `money.ts` (F6).
 */

export type OrderState = "created" | "pending" | "paid" | "cancelled";
export type OrderProvider = "click" | "payme";
export type OrderPurpose = "topup" | "pro";

export const ORDER_STATES: readonly OrderState[] = ["created", "pending", "paid", "cancelled"];
export const ORDER_PROVIDERS: readonly OrderProvider[] = ["click", "payme"];
export const ORDER_PURPOSES: readonly OrderPurpose[] = ["topup", "pro"];
export const ORDER_SORTS = ["created_desc", "amount_desc"] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export type AdminOrderRow = {
  id: string;
  userId: string;
  userName: string;
  provider: OrderProvider;
  purpose: OrderPurpose;
  amountSoum: number;
  state: OrderState;
  providerTxn: string | null;
  prepareId: string | null;
  createdAt: string;
  /** Provider times (stored as epoch ms), as ISO instants; `null` when unset. */
  createTime: string | null;
  performTime: string | null;
  cancelTime: string | null;
  cancelReason: number | null;
  credited: boolean;
  externalRefunds: number;
};

/** Query of `GET /api/admin/orders` (and its export). Empty values are dropped. */
export type OrderListParams = {
  state?: readonly OrderState[];
  provider?: OrderProvider | "";
  purpose?: OrderPurpose | "";
  userId?: string;
  /** Exact order uuid, Click prepare id or provider transaction id. */
  q?: string;
  /** `YYYY-MM-DD` (Asia/Tashkent), on `created_at`. */
  from?: string;
  to?: string;
  sort?: OrderSort;
  cursor?: string | null;
  limit?: number;
};

export type AdminOrderDetail = AdminOrderRow & {
  userUsername: string | null;
  updatedAt: string;
  settlementReference: string;
  recordedSoum: number;
  remainingSoum: number;
};

export type AdminPaymentEvent = {
  id: string;
  provider: OrderProvider;
  method: string;
  providerTxn: string | null;
  responseCode: number | null;
  receivedAt: string;
  /** Redacted on the server; render as text only. */
  payload: unknown;
};

export type TransactionKind = "charge" | "refund" | "topup" | "bonus" | "subscription" | "admin_credit" | "admin_debit";
export const TRANSACTION_KINDS: readonly TransactionKind[] = ["charge", "refund", "topup", "bonus", "subscription", "admin_credit", "admin_debit"];

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

export type OrderLedgerEntry = LedgerEntry & { role: "credit" | "clawback" };

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
  eventsCapped: boolean;
  ledger: OrderLedgerEntry[];
  refunds: AdminOrderRefund[];
};

export type LedgerListParams = {
  kind?: readonly TransactionKind[];
  userId?: string;
  /** Exact ledger reference. */
  reference?: string;
  from?: string;
  to?: string;
  cursor?: string | null;
  limit?: number;
};

export type Wallets = { points: number; quota: number; balance: number };
export type RevenueBucket = { soum: number; orders: number };
export type RevenueDay = { day: string; soum: number; orders: number; click: number; payme: number; topup: number; pro: number };

export type FinanceSummary = {
  range: { from: string; to: string; days: number };
  revenue: {
    total: RevenueBucket;
    byDay: RevenueDay[];
    byProvider: Record<OrderProvider, RevenueBucket>;
    byPurpose: Record<OrderPurpose, RevenueBucket>;
  };
  cashSpend: Wallets & { charges: number };
  refunds: Wallets & { count: number };
  adjustments: Wallets & { count: number };
  liabilities: Wallets & { users: number };
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

export type ReconciliationCheckId =
  | "paid_without_ledger"
  | "wallet_ledger_mismatch"
  | "failed_unrefunded"
  | "partial_refund_missing"
  | "orders_pending_12h"
  | "orders_created_24h";

export type OrderSample = {
  type: "order";
  id: string;
  userId: string;
  userName: string;
  provider: OrderProvider;
  purpose: OrderPurpose;
  amountSoum: number;
  state: OrderState;
  createdAt: string;
  credited: boolean;
};

export type GenerationSample = {
  type: "generation";
  id: string;
  userId: string;
  userName: string;
  toolId: string;
  finishedAt: string | null;
  charged: Wallets;
  delivered: { got: number; want: number } | null;
};

export type WalletSample = { type: "user"; id: string; userName: string; wallet: Wallets; ledger: Wallets };

export type ReconciliationSample = OrderSample | GenerationSample | WalletSample;

export type ReconciliationCheck = {
  id: ReconciliationCheckId;
  title: string;
  severity: "error" | "warning" | "info";
  count: number | null;
  countCapped: boolean;
  sample: ReconciliationSample[];
  timedOut: boolean;
};

export type Reconciliation = {
  checks: ReconciliationCheck[];
  walletRange: { from: string; to: string } | null;
  generatedAt: string;
};

/* ───────────────────────────── queries ───────────────────────────── */

function orderQuery(p: OrderListParams): AdminParams {
  return {
    state: p.state,
    provider: p.provider,
    purpose: p.purpose,
    userId: p.userId,
    q: p.q?.trim(),
    from: p.from,
    to: p.to,
    sort: p.sort && p.sort !== "created_desc" ? p.sort : undefined,
    cursor: p.cursor ?? undefined,
    limit: p.limit,
  };
}

function ledgerQuery(p: LedgerListParams): AdminParams {
  return {
    kind: p.kind,
    userId: p.userId,
    reference: p.reference?.trim(),
    from: p.from,
    to: p.to,
    cursor: p.cursor ?? undefined,
    limit: p.limit,
  };
}

/** GET /api/admin/orders (payments.view). */
export function listOrders(params: OrderListParams, opts?: AdminCallOptions): Promise<ListResult<AdminOrderRow>> {
  return adminGet<ListResult<AdminOrderRow>>("/api/admin/orders", orderQuery(params), opts);
}

/** GET /api/admin/orders/:id (payments.view); 404 `not_found` for an unknown id. */
export function getOrder(id: string, opts?: AdminCallOptions): Promise<AdminOrderDetailResponse> {
  return adminGet<AdminOrderDetailResponse>(`/api/admin/orders/${encodeURIComponent(id)}`, undefined, opts);
}

/** GET /api/admin/finance/summary (finance.view); `from`/`to` default to the last 30 days. */
export function getFinanceSummary(range: { from?: string; to?: string }, opts?: AdminCallOptions): Promise<FinanceSummary> {
  return adminGet<FinanceSummary>("/api/admin/finance/summary", { from: range.from, to: range.to }, opts);
}

/**
 * GET /api/admin/finance/reconciliation (finance.view). The optional range
 * narrows the wallet check to users who signed up in it.
 */
export function getReconciliation(range: { from?: string; to?: string }, opts?: AdminCallOptions): Promise<Reconciliation> {
  // The checks are bounded to 10 s each on the server; leave room for all six.
  return adminGet<Reconciliation>("/api/admin/finance/reconciliation", { from: range.from, to: range.to }, { timeoutMs: 75_000, ...opts });
}

/** GET /api/admin/transactions (finance.view). */
export function listLedger(params: LedgerListParams, opts?: AdminCallOptions): Promise<ListResult<LedgerEntry>> {
  return adminGet<ListResult<LedgerEntry>>("/api/admin/transactions", ledgerQuery(params), opts);
}

/* ───────────────────────────── CSV download ───────────────────────────── */

function filenameOf(res: Response, fallback: string): string {
  const m = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "");
  return m?.[1] ?? fallback;
}

async function errorOf(res: Response): Promise<ApiError> {
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  const message = typeof data.error === "string" && data.error ? data.error : `Xatolik (${res.status})`;
  if (res.status === 403) return new AdminForbiddenError(message, data);
  if (res.status === 404) return new AdminNotFoundError(message, data);
  if (res.status === 401 && data.code === "admin_auth") return new AdminAuthRequiredError(message, data);
  return new ApiError(message, res.status, data);
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Downloads an admin CSV export. Exports need a fresh step-up: on 401
 * `reauth` the registered step-up dialog opens and the request is retried
 * once (same contract as `adminGet`). 401 `admin_auth` sends the admin to the
 * login page. Errors are thrown as the same typed errors `core.ts` uses.
 */
async function downloadCsv(path: string, params: AdminParams, fallbackName: string, signal?: AbortSignal): Promise<void> {
  const url = `${path}${buildQuery(params)}`;
  const attempt = () => fetch(url, { credentials: "same-origin", signal });
  let res = await attempt();
  if (res.status === 401) {
    const err = await errorOf(res.clone());
    if (err.data.code === "reauth") {
      if (!(await runStepUp())) throw new AdminReauthCancelledError(err.data);
      res = await attempt();
    }
  }
  if (!res.ok) {
    const err = await errorOf(res);
    if (err instanceof AdminAuthRequiredError && typeof location !== "undefined" && !location.pathname.startsWith("/admin/login")) {
      location.assign(`/admin/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
    }
    throw err;
  }
  save(await res.blob(), filenameOf(res, fallbackName));
}

/** GET /api/admin/orders/export (payments.export, step-up). */
export function downloadOrdersCsv(params: OrderListParams, signal?: AbortSignal): Promise<void> {
  return downloadCsv("/api/admin/orders/export", { ...orderQuery(params), cursor: undefined, limit: undefined }, "buyurtmalar.csv", signal);
}

/** GET /api/admin/transactions/export (finance.export, step-up). */
export function downloadLedgerCsv(params: LedgerListParams, signal?: AbortSignal): Promise<void> {
  return downloadCsv("/api/admin/transactions/export", { ...ledgerQuery(params), cursor: undefined, limit: undefined }, "hisob-kitobi.csv", signal);
}
