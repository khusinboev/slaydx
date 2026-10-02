"use client";

import {
  AdminAuthRequiredError,
  AdminForbiddenError,
  AdminNotFoundError,
  AdminReauthCancelledError,
  ApiError,
  adminGet,
  adminSend,
  buildQuery,
  runStepUp,
  type AdminCallOptions,
  type AdminParams,
  type ListResult,
} from "./core";

/**
 * Users API (docs/admin/02-plan.md §6.4): list (S4), detail (S5) and its tabs,
 * block, session revoke, direct message, CSV export. Types mirror
 * `lib/server/admin-users.ts`; they are declared here because admin client
 * code never imports `lib/server/**`. The wallet adjustment lives in
 * `money.ts` (F6).
 */

export const USER_SORTS = ["created_desc", "created_asc", "balance_desc", "last_seen_desc"] as const;
export type UserSort = (typeof USER_SORTS)[number];
export type UserPlan = "free" | "pro";
export const USER_PLANS: readonly UserPlan[] = ["free", "pro"];

export type AdminUserRow = {
  id: string;
  name: string;
  username: string | null;
  telegramId: string | null;
  /** Always masked by the server (`+998 ** *** ** 67`). */
  phoneMasked: string | null;
  plan: UserPlan;
  planExpiresAt: string | null;
  points: number;
  quota: number;
  balance: number;
  isBlocked: boolean;
  isAdmin: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  generations: number;
};

/** Query of `GET /api/admin/users` (and its export). Empty values are dropped. */
export type UserListParams = {
  /** `#id`, Telegram id, `+phone` (exact), `@username` or name prefix (classified on the server). */
  q?: string;
  /** `true` → `1`, `false` → `0`, omitted → no filter. */
  blocked?: boolean;
  plan?: UserPlan | "";
  isAdmin?: boolean;
  /** Signup day range, `YYYY-MM-DD` (Asia/Tashkent). */
  from?: string;
  to?: string;
  sort?: UserSort;
  cursor?: string | null;
  limit?: number;
};

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
  localId: string | null;
  profile: Record<ProfileField, string>;
  language: string;
  updatedAt: string;
  revealed: boolean;
};

export type AdminUserStats = {
  generations: number;
  completed: number;
  failed: number;
  spentTanga: number;
  paidSoum: number;
  storageBytes: number;
};

export type AdminUserDetailResponse = {
  user: AdminUserDetail;
  stats: AdminUserStats;
  flags: { isAdminAccount: boolean; adminRole: string | null; adminStatus: string | null; self: boolean };
  counts: { activeSessions: number; queuedJobs: number; activeGameLinks: number };
  walletConfirmThreshold: number;
};

export type TransactionKind = "charge" | "refund" | "topup" | "bonus" | "subscription" | "admin_credit" | "admin_debit";
export const TRANSACTION_KINDS: readonly TransactionKind[] = ["charge", "refund", "topup", "bonus", "subscription", "admin_credit", "admin_debit"];

export type AdminUserTransaction = {
  id: string;
  kind: TransactionKind;
  points: number;
  quota: number;
  balance: number;
  reference: string | null;
  note: string | null;
  createdAt: string;
  generationId: string | null;
  orderId: string | null;
};

export type AdminUserSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  active: boolean;
};

export type BlockBody = {
  blocked: boolean;
  reason: string;
  revokeSessions?: boolean;
  cancelQueued?: boolean;
  revokeLinks?: boolean;
};

export type BlockSideEffects = { sessionsRevoked: number; jobsCancelled: number; refunds: number; linksRevoked: number };
export type BlockResult = { user: AdminUserDetail; sideEffects: BlockSideEffects };

export const MESSAGE_MAX = 2000;

const base = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

function userQuery(p: UserListParams): AdminParams {
  return {
    q: p.q?.trim() || undefined,
    blocked: p.blocked,
    plan: p.plan || undefined,
    isAdmin: p.isAdmin,
    from: p.from || undefined,
    to: p.to || undefined,
    sort: p.sort && p.sort !== "created_desc" ? p.sort : undefined,
    cursor: p.cursor ?? undefined,
    limit: p.limit,
  };
}

/** GET /api/admin/users (users.view). */
export function listUsers(params: UserListParams, opts?: AdminCallOptions): Promise<ListResult<AdminUserRow>> {
  return adminGet<ListResult<AdminUserRow>>("/api/admin/users", userQuery(params), opts);
}

/** GET /api/admin/users/:id; `reveal` needs users.pii and is audited on the server. */
export function getUser(id: string, opts: AdminCallOptions & { reveal?: boolean } = {}): Promise<AdminUserDetailResponse> {
  const { reveal, ...call } = opts;
  return adminGet<AdminUserDetailResponse>(base(id), reveal ? { reveal: 1 } : undefined, call);
}

/** GET /api/admin/users/:id/transactions (users.view). */
export function listUserTransactions(
  id: string,
  params: { kind?: readonly TransactionKind[]; cursor?: string | null; limit?: number },
  opts?: AdminCallOptions,
): Promise<ListResult<AdminUserTransaction>> {
  return adminGet<ListResult<AdminUserTransaction>>(
    `${base(id)}/transactions`,
    { kind: params.kind && params.kind.length ? params.kind : undefined, cursor: params.cursor ?? undefined, limit: params.limit },
    opts,
  );
}

/** GET /api/admin/users/:id/sessions (users.sessions). */
export function listUserSessions(id: string, opts?: AdminCallOptions): Promise<{ items: AdminUserSession[] }> {
  return adminGet<{ items: AdminUserSession[] }>(`${base(id)}/sessions`, undefined, opts);
}

/** POST /api/admin/users/:id/sessions/revoke (users.sessions). 409 `self`. */
export function revokeUserSessions(id: string, reason: string, opts?: AdminCallOptions): Promise<{ revoked: number }> {
  return adminSend<{ revoked: number }>("POST", `${base(id)}/sessions/revoke`, { reason }, opts);
}

/** POST /api/admin/users/:id/block (users.block). 409 `self` / `unchanged`; 403 `admin_target`. */
export function setUserBlocked(id: string, body: BlockBody, opts?: AdminCallOptions): Promise<BlockResult> {
  return adminSend<BlockResult>("POST", `${base(id)}/block`, body, opts);
}

/** POST /api/admin/users/:id/message (users.message). 409 `no_telegram`; 503 when Telegram is briefly down. */
export function messageUser(id: string, text: string, opts?: AdminCallOptions): Promise<{ sent: boolean }> {
  return adminSend<{ sent: boolean }>("POST", `${base(id)}/message`, { text }, opts);
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
 * GET /api/admin/users/export (users.export, step-up). Fetched as a blob so a
 * 401 `reauth` opens the step-up dialog and retries once (same contract as
 * `adminGet`), and an error is never saved as the file.
 */
export async function downloadUsersCsv(params: UserListParams, signal?: AbortSignal): Promise<void> {
  const url = `/api/admin/users/export${buildQuery({ ...userQuery(params), cursor: undefined, limit: undefined })}`;
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
  save(await res.blob(), filenameOf(res, "foydalanuvchilar.csv"));
}
