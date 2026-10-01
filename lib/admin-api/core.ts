"use client";

import { ApiError, request, type RequestOptions } from "../api-client";

/**
 * Core of the admin API client: a thin layer over the shared `request()`.
 *
 *  - every call accepts an `AbortSignal` (a stale request is aborted when a filter changes);
 *  - `Idempotency-Key` helpers (money actions);
 *  - error classification: 401 `admin_auth` -> redirect to login,
 *    401 `reauth` -> step-up dialog + exactly ONE retry, 403 / 404 -> typed errors.
 *
 * Other admin modules (`users.ts`, `generations.ts`, ...) reach the network
 * only through `adminGet` / `adminSend` below.
 */

// Re-exported so admin modules and UI check `instanceof ApiError` against the same
// class that `request()` throws (one import path for the whole admin client).
export { ApiError };

/** Shared list envelope of every admin list endpoint (plan §6.0). */
export type ListResult<T> = {
  items: T[];
  nextCursor: string | null;
  /** `null` when the server did not count. */
  total: number | null;
  /** `true` means `total` is a cap, shown as "10 000+". */
  totalCapped: boolean;
};

/* ───────────────────────────── typed errors ───────────────────────────── */

function codeOf(data: Record<string, unknown>): string | undefined {
  return typeof data.code === "string" ? data.code : undefined;
}

/** 403: missing permission (`code:"forbidden"`) or a bad Origin. */
export class AdminForbiddenError extends ApiError {
  readonly code: string | undefined;
  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message, 403, data);
    this.name = "AdminForbiddenError";
    this.code = codeOf(data);
  }
}

/**
 * 404 from `/api/admin`: "not an admin" (plan §6.0). The server also uses 404
 * for a missing resource, so callers that care should look at `data.code`.
 */
export class AdminNotFoundError extends ApiError {
  readonly code: string | undefined;
  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message, 404, data);
    this.name = "AdminNotFoundError";
    this.code = codeOf(data);
  }
}

/** 401 `admin_auth`: the redirect has already started; callers may swallow this silently. */
export class AdminAuthRequiredError extends ApiError {
  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message, 401, data);
    this.name = "AdminAuthRequiredError";
  }
}

/** 401 `reauth`, but the user dismissed the step-up dialog (or no handler is registered). */
export class AdminReauthCancelledError extends ApiError {
  constructor(data: Record<string, unknown> = {}) {
    super("Qayta tasdiqlash bekor qilindi", 401, data);
    this.name = "AdminReauthCancelledError";
  }
}

/** True when the caller aborted the request (UIs must not show this as an error). */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** `requestId` from the error body (500 responses), passed on to `ErrorState`. */
export function adminRequestId(e: unknown): string | undefined {
  if (!(e instanceof ApiError)) return undefined;
  const id = e.data.requestId;
  return typeof id === "string" && id ? id : undefined;
}

/** User-facing error text; non-API errors never leak their raw message. */
export function adminErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.message) return e.message;
  return "Kutilmagan xatolik. Qayta urinib ko'ring.";
}

/* ───────────────────────────── registered handlers ───────────────────────────── */

type AuthHandler = (nextPath: string) => void;
type StepUpHandler = () => Promise<boolean>;

let authHandler: AuthHandler | null = null;
let stepUpHandler: StepUpHandler | null = null;
// Concurrent `reauth` failures share a single dialog.
let stepUpInFlight: Promise<boolean> | null = null;

/** Current page, used as `next` so login returns the admin here. */
function currentPath(): string {
  if (typeof location === "undefined") return "/admin";
  return `${location.pathname}${location.search}`;
}

function defaultAuthHandler(nextPath: string): void {
  if (typeof location === "undefined") return;
  // Avoid a redirect loop when already on the login page.
  if (location.pathname.startsWith("/admin/login")) return;
  location.assign(`/admin/login?next=${encodeURIComponent(nextPath)}`);
}

/**
 * Registers the handler for 401 `admin_auth` (default: `/admin/login?next=...`).
 * The returned function unregisters it, but only if it is still the current one.
 */
export function setOnAdminAuthRequired(fn: AuthHandler | null): () => void {
  authHandler = fn;
  return () => {
    if (authHandler === fn) authHandler = null;
  };
}

/**
 * Registers the step-up handler used on 401 `reauth`: `true` means the code was
 * accepted (the request is retried), `false` means the user cancelled.
 * `StepUpProvider` plugs itself in here.
 */
export function setStepUpHandler(fn: StepUpHandler | null): () => void {
  stepUpHandler = fn;
  return () => {
    if (stepUpHandler === fn) stepUpHandler = null;
  };
}

/** Runs the registered step-up handler once for all concurrent callers; `false` when none is registered. */
export function runStepUp(): Promise<boolean> {
  const handler = stepUpHandler;
  if (!handler) return Promise.resolve(false);
  if (!stepUpInFlight) {
    stepUpInFlight = handler()
      .catch(() => false)
      .finally(() => {
        stepUpInFlight = null;
      });
  }
  return stepUpInFlight;
}

/* ───────────────────────────── Idempotency-Key ───────────────────────────── */

/** UUID v4; money dialogs generate one per open. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID exists only in secure contexts (the admin runs in one), but an
  // older WebView must not crash, so fall back to a v4 built from getRandomValues.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The `Idempotency-Key` header. */
export function idempotencyHeaders(key: string): Record<string, string> {
  return { "Idempotency-Key": key };
}

/* ───────────────────────────── requests ───────────────────────────── */

export type AdminQueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;
export type AdminParams = Record<string, AdminQueryValue>;

export type AdminCallOptions = {
  /** Aborts a stale request when a filter or page changes. */
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type AdminSendOptions = AdminCallOptions & {
  /** Required for money actions; the reauth retry reuses the same key. */
  idempotencyKey?: string;
};

/**
 * Builds the query string. `null` / `undefined` / empty values are dropped,
 * arrays (multi-select) are comma-joined (`status=FAILED,COMPLETED`) and
 * booleans become `1` / `0`.
 */
export function buildQuery(params: AdminParams | undefined): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
    } else if (typeof v === "boolean") {
      sp.set(k, v ? "1" : "0");
    } else if (v !== "") {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

type Attempt = { method: string; path: string; body: unknown; opts: AdminSendOptions };

function execute<T>({ method, path, body, opts }: Attempt): Promise<T> {
  const init: RequestOptions = {
    method,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    headers: opts.idempotencyKey ? idempotencyHeaders(opts.idempotencyKey) : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return request<T>(path, init);
}

/** Maps an `ApiError` to its admin-specific class (no retry logic here). */
function classify(e: unknown): unknown {
  if (!(e instanceof ApiError)) return e;
  const code = codeOf(e.data);
  if (e.status === 403) return new AdminForbiddenError(e.message, e.data);
  if (e.status === 404) return new AdminNotFoundError(e.message, e.data);
  if (e.status === 401 && code === "admin_auth") return new AdminAuthRequiredError(e.message, e.data);
  return e;
}

async function call<T>(attempt: Attempt): Promise<T> {
  try {
    return await execute<T>(attempt);
  } catch (first) {
    if (first instanceof ApiError && first.status === 401 && codeOf(first.data) === "reauth") {
      if (!(await runStepUp())) throw new AdminReauthCancelledError(first.data);
      // Retry ONCE with the same key so the server can never apply a money action twice.
      try {
        return await execute<T>(attempt);
      } catch (second) {
        throw await finalize(second);
      }
    }
    throw await finalize(first);
  }
}

/** Classifies the error and fires the auth handler on 401 `admin_auth`. */
async function finalize(e: unknown): Promise<unknown> {
  const err = classify(e);
  if (err instanceof AdminAuthRequiredError) (authHandler ?? defaultAuthHandler)(currentPath());
  return err;
}

/** GET with query parameters. */
export function adminGet<T>(path: string, params?: AdminParams, opts: AdminCallOptions = {}): Promise<T> {
  return call<T>({ method: "GET", path: `${path}${buildQuery(params)}`, body: undefined, opts });
}

/** POST/PUT/PATCH/DELETE. `body` is sent as JSON (`undefined` sends no body). */
export function adminSend<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  opts: AdminSendOptions = {},
): Promise<T> {
  return call<T>({ method, path, body, opts });
}
