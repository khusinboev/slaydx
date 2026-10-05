import "server-only";
import { ApiError } from "../api";
import { SofficeBusyError } from "../soffice-gate";

/**
 * Download failures with a stable `code` (the client and the Telegram package
 * map on it) and the HTTP status the routes answer with. Extends `ApiError`,
 * so `handler()` already turns it into `{error, code, retryAfter?}` JSON; the
 * routes add `Retry-After` for 503 too (`downloadErrorResponse`).
 */
export type DownloadErrorCode =
  | "unknown_format"
  | "not_found"
  | "not_ready"
  | "unsupported"
  | "unavailable"
  | "empty"
  | "failed"
  | "busy"
  | "rate_limited"
  | "stale"
  | "expired";

const MESSAGES: Record<DownloadErrorCode, string> = {
  unknown_format: "Noma'lum fayl formati",
  not_found: "Fayl topilmadi",
  not_ready: "Fayl hali tayyor emas",
  unsupported: "Bu format ushbu natija uchun mavjud emas",
  unavailable: "Bu format hozircha serverda mavjud emas",
  empty: "Bu formatda beriladigan ma'lumot yo'q",
  failed: "Faylni tayyorlab bo'lmadi — qayta urinib ko'ring",
  busy: "Fayl tayyorlash navbati band — birozdan keyin qayta urinib ko'ring",
  rate_limited: "Juda ko'p so'rov — birozdan keyin qayta urinib ko'ring",
  stale: "Fayl yangilangan — qayta yuklab oling",
  expired: "Havola muddati tugagan — qayta yuklab oling",
};

const STATUS: Record<DownloadErrorCode, number> = {
  unknown_format: 400,
  not_found: 404,
  not_ready: 409,
  unsupported: 400,
  unavailable: 503,
  empty: 409,
  failed: 502,
  busy: 503,
  rate_limited: 429,
  stale: 410,
  expired: 410,
};

/** `Retry-After` of a 503 that names no better value (e.g. `unavailable`). */
export const DEFAULT_RETRY_AFTER_SEC = 30;

export class DownloadError extends ApiError {
  readonly code: DownloadErrorCode;
  readonly retryAfterSec: number | null;

  constructor(code: DownloadErrorCode, opts: { retryAfterSec?: number; message?: string } = {}) {
    // Every 503 carries Retry-After (a client or proxy must not hammer a server that said "later").
    const retryAfterSec = opts.retryAfterSec ?? (STATUS[code] === 503 ? DEFAULT_RETRY_AFTER_SEC : null);
    super(opts.message ?? MESSAGES[code], STATUS[code], {
      code,
      ...(retryAfterSec !== null ? { retryAfter: retryAfterSec } : {}),
    });
    this.name = "DownloadError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Duck-typed (tsx may load a module twice under different specifiers). */
export function isDownloadError(e: unknown): e is DownloadError {
  return e instanceof Error && e.name === "DownloadError" && typeof (e as { code?: unknown }).code === "string";
}

/**
 * Normalizes what producers can throw into a `DownloadError`:
 * `SofficeBusyError` → `busy` (503 + Retry-After), a 429 `ApiError` from
 * `limit()` → `rate_limited`. Anything else is returned unchanged.
 */
export function toDownloadError(e: unknown): unknown {
  if (isDownloadError(e)) return e;
  if (e instanceof SofficeBusyError || (e instanceof Error && e.name === "SofficeBusyError")) {
    return new DownloadError("busy", { retryAfterSec: (e as SofficeBusyError).retryAfterSec });
  }
  if (e instanceof ApiError && e.status === 429) {
    const ra = typeof e.extra.retryAfter === "number" ? e.extra.retryAfter : 60;
    return new DownloadError("rate_limited", { retryAfterSec: ra, message: e.message });
  }
  return e;
}

/**
 * JSON error response for the download routes, with `Retry-After` on 429/503
 * and any extra headers (the token route adds the Telegram Web CORS header).
 * Non-download errors are rethrown for `handler()` (500 with request id).
 */
export function downloadErrorResponse(e: unknown, headers: Record<string, string> = {}): Response {
  const err = toDownloadError(e);
  if (!isDownloadError(err)) throw err;
  const h: Record<string, string> = { "Cache-Control": "private, no-store", ...headers };
  if (err.retryAfterSec !== null) h["Retry-After"] = String(err.retryAfterSec);
  return Response.json(
    { error: err.message, code: err.code, ...(err.retryAfterSec !== null ? { retryAfterSec: err.retryAfterSec } : {}) },
    { status: err.status, headers: h },
  );
}
