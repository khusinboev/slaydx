/**
 * Download delivery driver (docs/mobile/PLAN.md §4.5, R1 §4–§6).
 *
 *   prepareDownload — POST the prepare route, poll while the server converts
 *                     (every ~1.5 s, 60 s budget), resolve with a signed URL;
 *   deliver         — hand the prepared file to the device:
 *                       Telegram ≥ 8.0 → `downloadFile` (gesture window rules),
 *                       Telegram < 8.0 / refused → caller shows «Botga yuborish» /
 *                         «Brauzerda ochish»,
 *                       browser → fetch with real % progress → blob → `<a download>`,
 *                         navigation to the signed URL as the last resort;
 *   rowReducer      — the per-row state machine of the «Yuklab olish» sheet
 *                     (idle → preparing → ready → delivering → done | error).
 *
 * Why not `<a download>` everywhere: Android bot webviews have no download
 * handler and iOS keeps only `.pkpass`, so inside the Mini App nothing was
 * saved (R1 §4). The Telegram client downloads the signed URL itself, without
 * our cookie.
 *
 * Gesture window: Android ignores `web_app_request_file_download` sent more
 * than 10 s after the last touch, without any event. Every pointerdown in the
 * sheet / on the download buttons calls `markGesture()`; when the last tap is
 * older than {@link GESTURE_WINDOW_MS} the row asks for one more tap
 * («Tayyor — yuklab olish»), and when Android sends no event within
 * {@link TG_EVENT_WAIT_MS} the tap button is shown again.
 *
 * No React here: the sheet and buttons own the state; this module is pure
 * logic plus the network/Telegram calls (with test seams).
 */
import {
  ApiError,
  prepareGenerationDownload,
  saveGenerationToBot,
  shareGenerationToTelegram,
  retryAfterText,
  withRetryHint,
  type DownloadPrepareResponse,
  type TelegramPreparing,
  type TelegramSaveResult,
  type TelegramShareResult,
} from "../api-client";
import type { DownloadFormatId } from "./formats";
import {
  downloadCapability,
  getTelegramWebApp,
  isInMiniAppShell,
  openExternalLink,
  requestDownload,
  tgVersion,
  type DownloadCapability,
  type DownloadFileParams,
  type DownloadOutcome,
} from "../telegram-webapp";

/** Poll interval while the server prepares (R1 §5: every 1.5 s). */
export const PREPARE_POLL_MS = 1_500;
/** Total preparing budget before «Qayta urinish» (R1 §5: 60 s). */
export const PREPARE_BUDGET_MS = 60_000;
/** A Telegram download is sent directly only within this long after the last tap (Android drops > 10 s). */
export const GESTURE_WINDOW_MS = 8_000;
/** Android: no `fileDownloadRequested` within this long → the request was dropped, ask for a tap. */
export const TG_EVENT_WAIT_MS = 2_000;
/** Telegram's `downloadFile` answer (popup accepted/declined) is awaited at most this long. */
export const TG_DOWNLOAD_TIMEOUT_MS = 60_000;
/** A prepared URL is reused only while it has at least this long left (TTL is 15 min). */
export const READY_MARGIN_MS = 60_000;

/** A prepared file: the signed URL (`/api/dl/<token>`, relative) and what the server said about it. */
export type ReadyFile = {
  format: DownloadFormatId;
  url: string;
  fileName: string;
  size: number;
  mime: string;
  expiresAt: string;
};

/** Uzbek copy (R1 §5, R2 §5). One place, the tests pin it. */
export const DELIVER_TEXT = {
  preparing: "Tayyorlanmoqda…",
  preparingPdf: "PDF tayyorlanmoqda… (odatda 5–15 soniya)",
  tapToDownload: "Tayyor — yuklab olish uchun bosing",
  tapButton: "Tayyor — yuklab olish",
  saved: "Yuklab olindi",
  navigated: "Brauzer yuklab olmoqda",
  tgStarted: "Telegram yuklab olmoqda — bildirishnoma yoki «Yuklamalar»da ko‘rasiz",
  tgDelivering: "Telegram yuklab olmoqda…",
  cancelled: "Yuklab olish bekor qilindi",
  tgOld: "Telegram ilovangiz eski — faylni botga yuboramizmi?",
  tgFailed: "Telegram faylni yuklab ololmadi — botga yuboramizmi?",
  sendToBot: "Botga yuborish",
  openInBrowser: "Brauzerda ochish",
  openedInBrowser: "Brauzerda ochildi — yuklab olish o‘sha yerda",
  sentToBot: "✅ Fayl bot chatiga yuborildi",
  sending: "Botga yuborilmoqda…",
  retry: "Qayta urinish",
  timeout: "Fayl tayyorlanishi odatdagidan uzoq davom etdi — qayta urinib ko‘ring",
  interrupted: "Aloqa uzildi — qayta urinib ko‘ring",
  offline: "Internetga ulanib bo‘lmadi. Aloqani tekshiring.",
  expired: "Fayl muddati tugagan yoki o‘chirilgan — qayta yuklab oling",
  failed: "Fayl yuklab olinmadi — qayta urinib ko‘ring",
  shared: "Ulashildi",
  shareForwarded: "Fayl bot chatiga yuborildi — u yerdan uzating",
  noTelegram: "Telegram akkaunti bog‘lanmagan",
  mismatch: "Bu Telegram akkaunti boshqa SlaydX akkauntiga kirgan. Akkauntni almashtirish uchun Mini ilovani yopib, qayta oching.",
  botUnreachable: "Bot sizga yoza olmadi. Botni ochib /start bosing, so‘ng qayta urinib ko‘ring.",
  openBot: "Botni ochish",
  shareReady: "Tayyor — «Ulashish»ni yana bir bor bosing",
  /** Share sheet row: the file is ready, the next tap on THIS row opens the picker (Android gesture rule / Web Share). */
  tapToShare: "Tayyor — ulashish uchun bosing",
  /** Share sheet row while the server uploads the file and prepares the message. */
  sharing: "Ulashishga tayyorlanmoqda…",
  /** Share sheet row while Telegram's chat picker is open. */
  pickChat: "Chatni tanlang…",
  /** «Saqlash» / «Ulashish» was running when the file changed (an edit): the action stopped, its result is ignored. */
  fileChanged: "Fayl yangilandi — qayta urinib ko‘ring",
  shareExpired: "Ulashish havolasi eskirdi — qayta urinib ko‘ring",
  shareNoBrowser: "Bu brauzer faylni ulasha olmaydi — yuklab olib, o‘zingiz yuboring",
  shareNoAccount: "Telegram akkaunti bog‘lanmagan — faylni yuklab olib, o‘zingiz yuboring",
  /** The browser's share sheet failed (not cancelled) for a downloaded file: the file is handed over as a download. */
  shareFailed: "Ulashib bo‘lmadi — faylni yuklab olib, o‘zingiz yuboring",
  tooLarge: "Fayl Telegram uchun juda katta — «Yuklab olish» dan foydalaning.",
  idUnsupported: "Bu Telegram akkaunti bilan ulashib bo‘lmadi — «Saqlash» yoki «Yuklab olish» dan foydalaning.",
} as const;

/* ───────────────────────────── errors ───────────────────────────── */

export type DeliverErrorCode = "timeout" | "interrupted" | "offline" | "http";

/** A delivery failure the UI shows as is (Uzbek `message`), with «Qayta urinish». */
export class DeliverError extends Error {
  constructor(
    readonly code: DeliverErrorCode,
    message: string,
    readonly status = 0,
    readonly serverCode: string | null = null,
  ) {
    super(message);
    this.name = "DeliverError";
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/**
 * Uzbek text for any download/save/share failure. The server already answers
 * in Uzbek (`{error, code, retryAfterSec}`); 429/503 get «qachon qayta» from
 * Retry-After. A 410 (signed link expired / file edited) has its own line.
 */
export function deliverErrorText(e: unknown): string {
  if (e instanceof DeliverError) return e.message;
  if (e instanceof ApiError) {
    const code = typeof e.data.code === "string" ? e.data.code : null;
    if (code === "no_telegram") return DELIVER_TEXT.noTelegram;
    if (code === "bot_unreachable") return DELIVER_TEXT.botUnreachable;
    // The server's Uzbek text first; ours when it sent none.
    if (code === "too_large") return e.message || DELIVER_TEXT.tooLarge;
    if (code === "telegram_id_unsupported") return e.message || DELIVER_TEXT.idUnsupported;
    if (e.status === 410) return DELIVER_TEXT.expired;
    return retryText(e.message || DELIVER_TEXT.failed, e.retryAfterSec);
  }
  return DELIVER_TEXT.failed;
}

/** The server's `code` of an API failure (`bot_unreachable`, `share_unavailable`, …), else `null`. */
export function apiErrorCode(e: unknown): string | null {
  return e instanceof ApiError && typeof e.data.code === "string" ? e.data.code : null;
}

/** `botUrl` the Telegram routes attach (`https://t.me/<bot>`), only when it is a t.me link. */
export function botUrlOf(e: unknown, fallback: string | null = null): string | null {
  const raw = e instanceof ApiError ? e.data.botUrl : null;
  const url = typeof raw === "string" ? raw : fallback;
  return url && /^https:\/\/t\.me\/[A-Za-z0-9_]{3,64}$/.test(url) ? url : null;
}

/* ───────────────────────────── gesture window ───────────────────────────── */

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

let lastGestureAt: number | null = null;

/** Records a user tap (pointerdown in the sheet or on a download/share/save button). */
export function markGesture(at: number = nowMs()): void {
  lastGestureAt = at;
}

/** `performance.now()` of the last recorded tap, or `null`. */
export function lastGesture(): number | null {
  return lastGestureAt;
}

/** Test seam: forget the recorded tap. */
export function resetGesture(): void {
  lastGestureAt = null;
}

/**
 * Pure: when the server sent Retry-After, say WHEN to retry once. A text that
 * already says «birozdan keyin» gets the exact time in its place (no second
 * «(qayta urinish: …)» after «…qayta urinib ko‘ring.»); others get the hint appended.
 */
export function retryText(message: string, sec: number | null): string {
  if (!sec) return message;
  const vague = /birozdan keyin/i;
  if (vague.test(message)) {
    return message.replace(vague, (m) => {
      const t = retryAfterText(sec);
      return m[0] === "B" ? t[0].toUpperCase() + t.slice(1) : t;
    });
  }
  return withRetryHint(message, sec);
}

/**
 * Pure: the Telegram client needs a fresh tap for `downloadFile` (Android drops
 * requests > 10 s after the last touch). iOS, desktop and web clients have no
 * such rule, so a long preparation is delivered straight away there. Unknown
 * platform: keep the rule (safe side).
 */
export function gestureRequired(platform: string | null | undefined): boolean {
  return !platform || /^android/i.test(platform);
}

/** Pure: a Telegram download may be sent now (the last tap is recent enough). */
export function gestureFresh(last: number | null, now: number, windowMs: number = GESTURE_WINDOW_MS): boolean {
  return last !== null && now >= last && now - last <= windowMs;
}

/** Pure: the signed URL still has at least {@link READY_MARGIN_MS} to live. */
export function readyFresh(file: Pick<ReadyFile, "expiresAt">, now: number = Date.now()): boolean {
  const exp = Date.parse(file.expiresAt);
  return Number.isFinite(exp) && exp - now > READY_MARGIN_MS;
}

/* ───────────────────────────── prepare ───────────────────────────── */

export type PrepareOptions = {
  signal?: AbortSignal;
  budgetMs?: number;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  request?: (id: string, format: DownloadFormatId, signal?: AbortSignal) => Promise<DownloadPrepareResponse>;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Bekor qilindi", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Bekor qilindi", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Asks the server for `format` of generation `id` and polls while it is being
 * prepared. `onState` gets the elapsed time on every `preparing` answer.
 * Rejects with the API error (Uzbek text, Retry-After) or a
 * `DeliverError("timeout")` after the budget; an abort rejects with
 * `AbortError`.
 */
export async function prepareDownload(
  id: string,
  format: DownloadFormatId,
  onState?: (s: { state: "preparing"; elapsedMs: number }) => void,
  opts: PrepareOptions = {},
): Promise<ReadyFile> {
  const now = opts.now ?? Date.now;
  const wait = opts.sleep ?? sleep;
  const ask = opts.request ?? ((i, f, s) => prepareGenerationDownload(i, f, { signal: s }));
  const budget = opts.budgetMs ?? PREPARE_BUDGET_MS;
  const started = now();
  for (;;) {
    const r = await ask(id, format, opts.signal);
    if (r.state === "ready") {
      return { format, url: r.url, fileName: r.fileName, size: r.size, mime: r.mime, expiresAt: r.expiresAt };
    }
    const elapsed = now() - started;
    if (elapsed >= budget) throw new DeliverError("timeout", DELIVER_TEXT.timeout);
    onState?.({ state: "preparing", elapsedMs: elapsed });
    const pause = Number.isFinite(r.retryAfterMs) ? Math.min(5_000, Math.max(500, r.retryAfterMs)) : PREPARE_POLL_MS;
    await wait(Math.min(pause, Math.max(0, budget - elapsed)), opts.signal);
  }
}

/* ───────────────────────────── deliver ───────────────────────────── */

/** What the current page can do (read at tap time: the Telegram script may load late). */
export type DeliveryEnv = { capability: DownloadCapability; platform: string | null };

export function currentDeliveryEnv(): DeliveryEnv {
  const inTelegram = isInMiniAppShell();
  let platform: string | null = null;
  try {
    const p = getTelegramWebApp()?.platform;
    platform = typeof p === "string" ? p : null;
  } catch {
    platform = null;
  }
  return { capability: downloadCapability({ inTelegram, version: inTelegram ? tgVersion() : null }), platform };
}

/** Absolute URL of a same-origin path (Telegram needs `https://host/api/dl/<token>`). */
export function absoluteUrl(path: string, base?: string): string {
  try {
    return new URL(path, base ?? (typeof window !== "undefined" ? window.location.href : "http://localhost/")).href;
  } catch {
    return path;
  }
}

export type DeliverResult =
  /** Browser: the blob was handed to `<a download>`. */
  | { kind: "saved" }
  /** Browser: fetch was impossible, the page navigated to the signed URL (the browser downloads it). */
  | { kind: "navigated" }
  /** Telegram accepted and started downloading. */
  | { kind: "tg-downloading" }
  /** Telegram: the tap is too old, or Android sent no event — ask the user to tap once more. `late` settles if Telegram answers after all. */
  | { kind: "needs-tap"; late?: Promise<DownloadOutcome> }
  /** Telegram refused (cancelled / too old / not https / threw) → «Botga yuborish» / «Brauzerda ochish». */
  | { kind: "tg-refused"; reason: "cancelled" | "unsupported" | "error" };

export type DeliverOptions = DeliveryEnv & {
  lastGestureAt?: number | null;
  onProgress?: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
  /** Test seams. */
  now?: () => number;
  eventWaitMs?: number;
  answerTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  requestDownloadImpl?: (p: DownloadFileParams, o?: { timeoutMs?: number }) => Promise<DownloadOutcome>;
  saveBlobImpl?: (blob: Blob, name: string) => void;
  navigate?: (url: string) => void;
  online?: () => boolean;
  origin?: string;
};

/**
 * Hands a prepared file to the device, the way the environment allows
 * (see the module comment). Throws `DeliverError` for a broken transfer and
 * the server's error for an HTTP failure of the signed URL (410 expired, …).
 */
export async function deliver(file: ReadyFile, opts: DeliverOptions): Promise<DeliverResult> {
  if (opts.capability === "tg-fallback") return { kind: "tg-refused", reason: "unsupported" };
  if (opts.capability === "tg-download") return deliverTelegram(file, opts);
  return deliverBrowser(file, opts);
}

async function deliverTelegram(file: ReadyFile, opts: DeliverOptions): Promise<DeliverResult> {
  const now = (opts.now ?? nowMs)();
  const last = opts.lastGestureAt === undefined ? lastGesture() : opts.lastGestureAt;
  if (gestureRequired(opts.platform) && !gestureFresh(last, now)) return { kind: "needs-tap" };
  const ask = opts.requestDownloadImpl ?? requestDownload;
  // No answer ever (a dropped event) must not leave the row «delivering» forever: the popup answer
  // may take a while on iOS/desktop, but after TG_DOWNLOAD_TIMEOUT_MS the row offers the tap again.
  const pending = ask(
    { url: absoluteUrl(file.url, opts.origin), file_name: file.fileName },
    { timeoutMs: opts.answerTimeoutMs ?? TG_DOWNLOAD_TIMEOUT_MS },
  );
  const outcome =
    gestureRequired(opts.platform)
      ? await Promise.race([
          pending,
          new Promise<"wait">((r) => setTimeout(() => r("wait"), opts.eventWaitMs ?? TG_EVENT_WAIT_MS)),
        ])
      : await pending;
  if (outcome === "wait" || outcome === "no-response") return { kind: "needs-tap", late: pending };
  if (outcome === "downloading") return { kind: "tg-downloading" };
  if (outcome === "cancelled") return { kind: "tg-refused", reason: "cancelled" };
  return { kind: "tg-refused", reason: outcome === "unsupported" ? "unsupported" : "error" };
}

/** Saves a blob through a temporary `<a download>` (Firefox needs it in the DOM). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs a moment to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function deliverBrowser(file: ReadyFile, opts: DeliverOptions): Promise<DeliverResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const navigate = opts.navigate ?? ((url: string) => window.location.assign(url));
  const online = opts.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  let res: Response;
  try {
    // No timeout on purpose: a 10 MB deck on a slow mobile line takes minutes; progress shows it moving.
    res = await doFetch(file.url, { credentials: "same-origin", signal: opts.signal });
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) throw e;
    if (!online()) throw new DeliverError("offline", DELIVER_TEXT.offline);
    // fetch itself is blocked (old webview, extension): the browser's own download handles the signed URL.
    navigate(file.url);
    return { kind: "navigated" };
  }
  const blob = await responseBlob(res, file, opts);
  try {
    (opts.saveBlobImpl ?? saveBlob)(blob, file.fileName);
  } catch {
    navigate(file.url);
    return { kind: "navigated" };
  }
  return { kind: "saved" };
}

/**
 * The bytes of a prepared file as a Blob (Web Share needs a `File`, not a
 * download). Same error texts as the browser download; no navigation fallback.
 */
export async function fetchFileBlob(
  file: ReadyFile,
  opts: Pick<DeliverOptions, "onProgress" | "signal" | "fetchImpl"> = {},
): Promise<Blob> {
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(file.url, { credentials: "same-origin", signal: opts.signal });
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) throw e;
    throw new DeliverError("offline", DELIVER_TEXT.offline);
  }
  return responseBlob(res, file, opts);
}

/**
 * Reads a signed-URL response: HTTP errors become `DeliverError("http")` with
 * the server's Uzbek text + Retry-After (a 503 when a regenerated derived file
 * ran out of time → «Qayta urinish»), 410 → «muddati tugagan»; the body is
 * read in chunks with real progress from `Content-Length`.
 */
async function responseBlob(
  res: Response,
  file: ReadyFile,
  opts: Pick<DeliverOptions, "onProgress" | "signal">,
): Promise<Blob> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const header = Number(res.headers.get("retry-after"));
    const msg =
      res.status === 410
        ? DELIVER_TEXT.expired
        : retryText(
            typeof data.error === "string" && data.error ? data.error : DELIVER_TEXT.failed,
            Number.isFinite(header) && header > 0 ? Math.ceil(header) : null,
          );
    throw new DeliverError("http", msg, res.status, typeof data.code === "string" ? data.code : null);
  }
  const lengthHeader = Number(res.headers.get("content-length"));
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : file.size > 0 ? file.size : null;
  let blob: Blob;
  try {
    const reader = res.body?.getReader?.();
    if (!reader) {
      blob = await res.blob();
      opts.onProgress?.(blob.size, total ?? blob.size);
    } else {
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      opts.onProgress?.(0, total);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.byteLength;
          opts.onProgress?.(loaded, total);
        }
      }
      blob = new Blob(chunks as BlobPart[], { type: file.mime });
    }
  } catch (e) {
    if (isAbort(e) || opts.signal?.aborted) throw e;
    throw new DeliverError("interrupted", DELIVER_TEXT.interrupted);
  }
  return blob;
}

/** «Brauzerda ochish»: the external browser downloads the signed URL (`Content-Disposition: attachment`). */
export function openInBrowser(file: ReadyFile): boolean {
  return openExternalLink(absoluteUrl(file.url));
}

/* ───────────────────────────── «Saqlash» / «Ulashish» requests ───────────────────────────── */

type ActionResult<K extends "save" | "share"> = K extends "save" ? TelegramSaveResult : TelegramShareResult;

export type TelegramActionOptions = Omit<PrepareOptions, "request"> & {
  /** Test seam: one POST of the route. */
  request?: (id: string, format: DownloadFormatId | undefined, signal?: AbortSignal) => Promise<unknown>;
};

/**
 * `POST …/telegram/{save|share}` with polling: for a converted format whose
 * file is not ready the route answers `202 {state:"preparing", retryAfterMs}`
 * and the same request (same body) is repeated until 200 or an error, within
 * the same 60 s budget as downloads. `onState` drives the row's «preparing» UI.
 */
export async function telegramAction<K extends "save" | "share">(
  kind: K,
  id: string,
  format: DownloadFormatId | undefined,
  onState?: (s: { state: "preparing"; elapsedMs: number }) => void,
  opts: TelegramActionOptions = {},
): Promise<ActionResult<K>> {
  const now = opts.now ?? Date.now;
  const wait = opts.sleep ?? sleep;
  const ask =
    opts.request ??
    ((i: string, f: DownloadFormatId | undefined, s?: AbortSignal) =>
      kind === "save" ? saveGenerationToBot(i, f, { signal: s }) : shareGenerationToTelegram(i, f, { signal: s }));
  const budget = opts.budgetMs ?? PREPARE_BUDGET_MS;
  const started = now();
  for (;;) {
    const r = (await ask(id, format, opts.signal)) as ActionResult<K> | TelegramPreparing;
    if (!isPreparing(r)) return r;
    const elapsed = now() - started;
    if (elapsed >= budget) throw new DeliverError("timeout", DELIVER_TEXT.timeout);
    onState?.({ state: "preparing", elapsedMs: elapsed });
    const pause = Number.isFinite(r.retryAfterMs) ? Math.min(5_000, Math.max(500, r.retryAfterMs)) : PREPARE_POLL_MS;
    await wait(Math.min(pause, Math.max(0, budget - elapsed)), opts.signal);
  }
}

function isPreparing(r: unknown): r is TelegramPreparing {
  return typeof r === "object" && r !== null && (r as { state?: unknown }).state === "preparing";
}

/** «Botga yuborish»: the same server path as «Saqlash», with the row's format (polls while it converts). */
export function sendToBot(
  genId: string,
  format: DownloadFormatId,
  onState?: (s: { state: "preparing"; elapsedMs: number }) => void,
  signal?: AbortSignal,
) {
  return telegramAction("save", genId, format, onState, { signal });
}

/**
 * Prepare + deliver in one go, in the current environment (no sheet): used by
 * the legacy `downloadGeneration` export. Telegram refusals throw the matching
 * Uzbek text (the caller has no fallback rows).
 */
export async function downloadToDevice(id: string, format: DownloadFormatId): Promise<DeliverResult> {
  markGesture();
  const file = await prepareDownload(id, format);
  const r = await deliver(file, { ...currentDeliveryEnv(), lastGestureAt: lastGesture() });
  if (r.kind === "tg-refused") throw new DeliverError("http", r.reason === "cancelled" ? DELIVER_TEXT.cancelled : DELIVER_TEXT.tgOld);
  return r;
}

/* ───────────────────────────── row state machine ───────────────────────────── */

export type RowState =
  | { s: "idle" }
  /** `since` — epoch ms when preparation started (the elapsed-seconds counter). */
  | { s: "preparing"; since: number }
  /** The file exists; the next tap delivers (Telegram gesture rule). */
  | { s: "ready"; file: ReadyFile }
  | { s: "delivering"; via: "browser" | "telegram"; loaded: number; total: number | null }
  | { s: "done"; text: string }
  /** Telegram refused or is too old: «Botga yuborish» / «Brauzerda ochish» (+ tap to retry). */
  | { s: "fallback"; file: ReadyFile; text: string }
  /** «Botga yuborish» in flight. */
  | { s: "sending"; file: ReadyFile; since?: number }
  | { s: "error"; text: string };

export type RowEvent =
  | { t: "prepare"; since: number }
  | { t: "await-tap"; file: ReadyFile }
  | { t: "deliver"; via: "browser" | "telegram" }
  | { t: "progress"; loaded: number; total: number | null }
  | { t: "result"; result: DeliverResult; file: ReadyFile }
  | { t: "send" }
  | { t: "send-wait"; since: number }
  | { t: "sent" }
  | { t: "opened" }
  | { t: "fail"; text: string }
  | { t: "reset" };

export const IDLE: RowState = { s: "idle" };

/** Rows that must not start again on a second tap (double-tap safety). */
export function rowBusy(s: RowState): boolean {
  return s.s === "preparing" || s.s === "delivering" || s.s === "sending";
}

/** Pure transition function of one sheet row. Unknown/out-of-order events keep the state. */
export function rowReducer(state: RowState, e: RowEvent): RowState {
  switch (e.t) {
    case "reset":
      return IDLE;
    case "prepare":
      return { s: "preparing", since: e.since };
    case "await-tap":
      return { s: "ready", file: e.file };
    case "deliver":
      return { s: "delivering", via: e.via, loaded: 0, total: null };
    case "progress":
      return state.s === "delivering" ? { ...state, loaded: e.loaded, total: e.total } : state;
    case "result":
      switch (e.result.kind) {
        case "saved":
          return { s: "done", text: DELIVER_TEXT.saved };
        case "navigated":
          return { s: "done", text: DELIVER_TEXT.navigated };
        case "tg-downloading":
          return { s: "done", text: DELIVER_TEXT.tgStarted };
        case "needs-tap":
          return { s: "ready", file: e.file };
        case "tg-refused":
          return {
            s: "fallback",
            file: e.file,
            text:
              e.result.reason === "cancelled"
                ? DELIVER_TEXT.cancelled
                : e.result.reason === "unsupported"
                  ? DELIVER_TEXT.tgOld
                  : DELIVER_TEXT.tgFailed,
          };
      }
      return state;
    case "send":
      return state.s === "fallback" ? { s: "sending", file: state.file } : state;
    case "send-wait":
      // The route converts (202 preparing): the elapsed counter starts once.
      return state.s === "sending" ? { ...state, since: state.since ?? e.since } : state;
    case "sent":
      return { s: "done", text: DELIVER_TEXT.sentToBot };
    case "opened":
      return { s: "done", text: DELIVER_TEXT.openedInBrowser };
    case "fail":
      return { s: "error", text: e.text };
  }
}

/** «8,1 MB», «640 KB», «512 B» (Uzbek decimal comma). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${(mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace(".", ",")} MB`;
}

/** Whole seconds since `since` (epoch ms), never negative. */
export function elapsedSeconds(since: number, now: number): number {
  return Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * The status line of a row: what the user reads under the format name.
 * `idle` → the hint (+ size when known); the other states → their progress text.
 */
export function rowStatusText(
  state: RowState,
  f: { id: DownloadFormatId; hint?: string; cost: "instant" | "convert" },
  ctx: { now: number; size?: number | null },
): string {
  switch (state.s) {
    case "idle": {
      const size = ctx.size ? formatBytes(ctx.size) : "";
      return [f.hint, size].filter(Boolean).join(" · ");
    }
    case "preparing": {
      const base = f.id === "pdf" ? DELIVER_TEXT.preparingPdf : DELIVER_TEXT.preparing;
      return `${base} ${elapsedSeconds(state.since, ctx.now)} s`;
    }
    case "ready":
      return DELIVER_TEXT.tapToDownload;
    case "delivering": {
      if (state.via === "telegram") return DELIVER_TEXT.tgDelivering;
      if (state.total && state.total > 0) {
        const pct = Math.min(100, Math.floor((state.loaded / state.total) * 100));
        return `Yuklab olinmoqda — ${pct}% · ${formatBytes(state.loaded)} / ${formatBytes(state.total)}`;
      }
      return `Yuklab olinmoqda — ${formatBytes(state.loaded)}`;
    }
    case "sending":
      return state.since === undefined
        ? DELIVER_TEXT.sending
        : `${f.id === "pdf" ? DELIVER_TEXT.preparingPdf : DELIVER_TEXT.preparing} ${elapsedSeconds(state.since, ctx.now)} s`;
    case "done":
    case "fallback":
    case "error":
      return state.text;
  }
}

/** Percent for a progress bar, or `null` when unknown / not transferring. */
export function rowPercent(state: RowState): number | null {
  if (state.s !== "delivering" || state.via !== "browser" || !state.total) return null;
  return Math.min(100, Math.floor((state.loaded / state.total) * 100));
}
