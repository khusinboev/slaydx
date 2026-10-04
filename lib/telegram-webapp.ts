/**
 * Typed accessor for the Telegram Mini App APIs used by downloads, «Ulashish»
 * and «Saqlash» (docs/mobile/PLAN.md §4.3, R1 §4, R2 §5).
 *
 * Only this module touches `window.Telegram.WebApp` for these APIs;
 * `components/telegram/MiniAppBridge.tsx` keeps login, `ready/expand` and the
 * BackButton. The script itself is loaded by the bridge, and only inside a
 * genuine Telegram webview (`lib/telegram-miniapp.ts`), so outside Telegram
 * every function here is a safe no-op.
 *
 * Rules:
 *  - SSR-safe: nothing reads `window` at import time.
 *  - Every access to Telegram's object is wrapped in try/catch: the object is
 *    foreign, its methods throw on old clients (`WebAppMethodUnsupported`) and
 *    on a second open popup.
 *  - Methods newer than the client are never called (`tgVersionAtLeast`).
 *  - The capability functions are pure: components pass in what they know and
 *    branch on a string union.
 */
import { hasLaunchData, telegramWebviewSignal, type LaunchEnv } from "./telegram-miniapp";

/** Bot API version that added `downloadFile` and `shareMessage`. */
export const TG_DOWNLOAD_FILE_VERSION = "8.0";
export const TG_SHARE_MESSAGE_VERSION = "8.0";
/** Bot API version that added `requestWriteAccess` and `allows_write_to_pm`. */
export const TG_WRITE_ACCESS_VERSION = "6.9";

/** Payloads of the Mini App events this app listens to (tg-web-app.js `receiveWebViewEvent`). */
export type TelegramEventMap = {
  viewportChanged: { isStateStable: boolean };
  fileDownloadRequested: { status: "downloading" | "cancelled" };
  shareMessageSent: undefined;
  shareMessageFailed: { error: string };
  writeAccessRequested: { status: "allowed" | "cancelled" | string };
  activated: undefined;
  deactivated: undefined;
};
export type TelegramEventType = keyof TelegramEventMap;
export type TelegramEventHandler<E extends TelegramEventType> = (payload: TelegramEventMap[E]) => void;

export type DownloadFileParams = { url: string; file_name: string };

/** The subset of `Telegram.WebApp` this module calls. Every member is optional: clients differ. */
export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: { user?: { id?: number | string; allows_write_to_pm?: boolean } };
  version?: string;
  platform?: string;
  viewportHeight?: number;
  viewportStableHeight?: number;
  isVersionAtLeast?: (version: string) => boolean;
  downloadFile?: (params: DownloadFileParams, callback?: (accepted: boolean) => void) => void;
  shareMessage?: (id: string, callback?: (sent: boolean) => void) => void;
  requestWriteAccess?: (callback?: (allowed: boolean) => void) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink?: (url: string) => void;
  close?: (options?: { return_back?: boolean }) => void;
  onEvent?: (type: string, handler: (payload?: unknown) => void) => void;
  offEvent?: (type: string, handler: (payload?: unknown) => void) => void;
};

type TelegramGlobal = {
  WebApp?: TelegramWebApp;
  /** Low-level bridge of tg-web-app.js; used only to re-send a download request (see `requestDownload`). */
  WebView?: { postEvent?: (type: string, callback: unknown, data: unknown) => void };
};

/** What the detection reads: the launch environment plus Telegram's globals. */
export type MiniAppEnv = LaunchEnv & { Telegram?: TelegramGlobal };

function currentEnv(): MiniAppEnv | null {
  try {
    return typeof window === "undefined" ? null : (window as unknown as MiniAppEnv);
  } catch {
    return null;
  }
}

/**
 * Pure: the page runs as a genuine Telegram Mini App.
 *
 * Same rule as `isTelegramWebApp` (`lib/telegram-miniapp.ts`: a client-injected
 * webview signal AND launch data), with one addition: after a client-side
 * navigation the `#tgWebAppData` fragment is gone, so non-empty
 * `Telegram.WebApp.initData` also counts as launch data. That object only
 * exists because `MiniAppBridge` loaded Telegram's script after the full check
 * passed, and the webview signal (proxy / external / Telegram framer) survives
 * navigation. `MiniAppBridge` could switch to this function later.
 */
export function isGenuineMiniApp(env: MiniAppEnv): boolean {
  try {
    if (telegramWebviewSignal(env) === null) return false;
    if (hasLaunchData(env.location.hash)) return true;
    const initData = env.Telegram?.WebApp?.initData;
    return typeof initData === "string" && initData.length > 0;
  } catch {
    return false;
  }
}

/** `true` inside a genuine Telegram Mini App (see `isGenuineMiniApp`); `false` on the server. */
export function isInTelegramWebApp(): boolean {
  const env = currentEnv();
  return env ? isGenuineMiniApp(env) : false;
}

/**
 * `Telegram.WebApp` when running as a genuine Mini App and the script has
 * loaded, else `null` (server, ordinary browser, script not loaded yet).
 */
export function getTelegramWebApp(): TelegramWebApp | null {
  const env = currentEnv();
  if (!env || !isGenuineMiniApp(env)) return null;
  try {
    return env.Telegram?.WebApp ?? null;
  } catch {
    return null;
  }
}

/**
 * Pure: compares dotted versions the way tg-web-app.js does
 * (`"8.0" > "7.10" > "7.9"`; missing parts are 0; garbage counts as 0).
 * Returns -1, 0 or 1.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = String(a ?? "").trim().split(".");
  const pb = String(b ?? "").trim().split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(pa[i] ?? "", 10) || 0;
    const y = parseInt(pb[i] ?? "", 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** The client's Bot API version is at least `v`. `false` outside Telegram or on any error. */
export function tgVersionAtLeast(v: string): boolean {
  const wa = getTelegramWebApp();
  if (!wa) return false;
  try {
    if (typeof wa.isVersionAtLeast === "function") return wa.isVersionAtLeast(v) === true;
    return typeof wa.version === "string" && compareVersions(wa.version, v) >= 0;
  } catch {
    return false;
  }
}

/** The client's Bot API version string, or `null` outside Telegram. */
export function tgVersion(): string | null {
  const wa = getTelegramWebApp();
  try {
    return wa && typeof wa.version === "string" ? wa.version : null;
  } catch {
    return null;
  }
}

type AnyHandler = (payload: never) => void;
type Wrapped = (payload?: unknown) => void;
/** `onEvent` wraps handlers (error isolation); type → caller's handler → wrapper, for `offEvent`. */
const registry = new Map<string, Map<AnyHandler, Wrapped>>();
function handlersOf(type: string): Map<AnyHandler, Wrapped> {
  let map = registry.get(type);
  if (!map) registry.set(type, (map = new Map()));
  return map;
}

/**
 * Subscribes to a Mini App event. Returns an unsubscribe function (a no-op
 * when there is no Mini App). Handler errors are caught and logged. The same
 * handler added twice for one type is subscribed once.
 */
export function onEvent<E extends TelegramEventType>(type: E, handler: TelegramEventHandler<E>): () => void {
  const wa = getTelegramWebApp();
  if (!wa || typeof wa.onEvent !== "function") return () => {};
  if (handlersOf(type).has(handler as AnyHandler)) return () => offEvent(type, handler);
  const wrapped: Wrapped = (payload) => {
    try {
      handler(payload as TelegramEventMap[E]);
    } catch (e) {
      console.warn(`[telegram-webapp] ${type} handler:`, e instanceof Error ? e.message : e);
    }
  };
  try {
    wa.onEvent(type, wrapped);
  } catch {
    return () => {};
  }
  handlersOf(type).set(handler as AnyHandler, wrapped);
  return () => offEvent(type, handler);
}

/** Removes a handler added with `onEvent`. */
export function offEvent<E extends TelegramEventType>(type: E, handler: TelegramEventHandler<E>): void {
  const map = handlersOf(type);
  const wrapped = map.get(handler as AnyHandler);
  if (!wrapped) return;
  map.delete(handler as AnyHandler);
  const wa = getTelegramWebApp();
  try {
    wa?.offEvent?.(type, wrapped);
  } catch {
    // The object went away (page unloading): nothing to detach.
  }
}

/** The Telegram user id of the Mini App user (`initDataUnsafe.user.id`, UX only — never for authorization). */
export function miniAppUserId(): string | null {
  const wa = getTelegramWebApp();
  try {
    const id = wa?.initDataUnsafe?.user?.id;
    if (typeof id === "number" && Number.isFinite(id)) return String(id);
    if (typeof id === "string" && /^\d+$/.test(id)) return id;
    return null;
  } catch {
    return null;
  }
}

/**
 * Pure: the Mini App user is a different Telegram account than the session's
 * (R2 §4: the client refuses «Saqlash»/«Ulashish» then). Unknown on either
 * side is not a mismatch.
 */
export function isMiniAppUserMismatch(sessionTelegramId: string | null | undefined, miniAppId: string | null): boolean {
  if (!sessionTelegramId || !miniAppId) return false;
  return String(sessionTelegramId) !== miniAppId;
}

/** `initDataUnsafe.user.allows_write_to_pm` (6.9+), or `null` when unknown. */
export function allowsWriteToPm(): boolean | null {
  const wa = getTelegramWebApp();
  try {
    const v = wa?.initDataUnsafe?.user?.allows_write_to_pm;
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Outcome of a `downloadFile` request:
 *  - `downloading` — the client accepted and started the download;
 *  - `cancelled` — the user (or Telegram's server check) declined;
 *  - `unsupported` — no Mini App, client < 8.0, or invalid params (non-HTTPS URL);
 *  - `no-response` — no answer within `timeoutMs` (Android drops calls made > 10 s after a touch);
 *  - `error` — the call threw for another reason.
 */
export type DownloadOutcome = "downloading" | "cancelled" | "unsupported" | "no-response" | "error";

/**
 * Asks the Telegram client to download `url` (HTTPS, self-authorizing) as
 * `file_name`. Resolves once: from the callback or the `fileDownloadRequested`
 * event, whichever comes first, or `no-response` after `timeoutMs` (default:
 * never times out).
 *
 * tg-web-app.js keeps a request "open" until the client answers, and a later
 * `downloadFile` then throws `WebAppDownloadFilePopupOpened`. After a dropped
 * request (Android gesture rule) that would block every retry for the page's
 * lifetime, so in that case the request is re-sent through `Telegram.WebView`
 * and the answer is read from the `fileDownloadRequested` event.
 */
export function requestDownload(params: DownloadFileParams, opts: { timeoutMs?: number } = {}): Promise<DownloadOutcome> {
  const wa = getTelegramWebApp();
  if (!wa || typeof wa.downloadFile !== "function" || !tgVersionAtLeast(TG_DOWNLOAD_FILE_VERSION)) {
    return Promise.resolve("unsupported");
  }
  if (!isHttpsUrl(params.url) || !params.file_name) return Promise.resolve("unsupported");
  return new Promise<DownloadOutcome>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (o: DownloadOutcome) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      off();
      resolve(o);
    };
    const off = onEvent("fileDownloadRequested", (p) => finish(p?.status === "downloading" ? "downloading" : "cancelled"));
    if (opts.timeoutMs !== undefined) timer = setTimeout(() => finish("no-response"), opts.timeoutMs);
    try {
      wa.downloadFile!({ url: params.url, file_name: params.file_name }, (accepted) =>
        finish(accepted ? "downloading" : "cancelled"),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "WebAppDownloadFilePopupOpened" && resend(params)) return;
      finish(msg === "WebAppMethodUnsupported" || msg === "WebAppDownloadFileParamInvalid" ? "unsupported" : "error");
    }
  });
}

/** Posts `web_app_request_file_download` directly (see `requestDownload`). `false` when impossible. */
function resend(params: DownloadFileParams): boolean {
  try {
    const post = currentEnv()?.Telegram?.WebView?.postEvent;
    if (typeof post !== "function") return false;
    post("web_app_request_file_download", false, { url: params.url, file_name: params.file_name });
    return true;
  } catch {
    return false;
  }
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** `requestDownload` as a boolean: `true` only when the client started downloading. */
export async function downloadFile(params: DownloadFileParams, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  return (await requestDownload(params, opts)) === "downloading";
}

/**
 * Outcome of `shareMessage`:
 *  - `sent` — the user picked a chat and the message went out;
 *  - `failed` — closed or failed without a specific reason;
 *  - `expired` — the prepared message expired (`MESSAGE_EXPIRED`): prepare a new one;
 *  - `unsupported` — no Mini App, client < 8.0, or the client answered `UNSUPPORTED`;
 *  - `busy` — a share dialog is already open;
 *  - `error` — the call threw for another reason.
 */
export type ShareOutcome = "sent" | "failed" | "expired" | "unsupported" | "busy" | "error";

/**
 * Opens Telegram's chat picker for a prepared inline message
 * (`savePreparedInlineMessage` id from the server). tg-web-app.js calls the
 * callback before it dispatches `shareMessageFailed {error}`, so the result is
 * settled one microtask after the callback to include the error code.
 */
export function shareMessageResult(id: string): Promise<ShareOutcome> {
  const wa = getTelegramWebApp();
  if (!wa || typeof wa.shareMessage !== "function" || !tgVersionAtLeast(TG_SHARE_MESSAGE_VERSION)) {
    return Promise.resolve("unsupported");
  }
  return new Promise<ShareOutcome>((resolve) => {
    let done = false;
    let error: string | null = null;
    const finish = (o: ShareOutcome) => {
      if (done) return;
      done = true;
      offSent();
      offFailed();
      resolve(o);
    };
    const failedOutcome = (): ShareOutcome =>
      error === "MESSAGE_EXPIRED" ? "expired" : error === "UNSUPPORTED" ? "unsupported" : "failed";
    const offSent = onEvent("shareMessageSent", () => finish("sent"));
    const offFailed = onEvent("shareMessageFailed", (p) => {
      error = typeof p?.error === "string" ? p.error : null;
      finish(failedOutcome());
    });
    try {
      wa.shareMessage!(id, (sent) => {
        if (sent) finish("sent");
        else queueMicrotask(() => finish(failedOutcome()));
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      finish(msg === "WebAppMethodUnsupported" ? "unsupported" : msg === "WebAppShareMessageOpened" ? "busy" : "error");
    }
  });
}

/** `shareMessageResult` as a boolean: `true` only when the message was sent. */
export async function shareMessage(id: string): Promise<boolean> {
  return (await shareMessageResult(id)) === "sent";
}

/**
 * Asks the user to let the bot write to them (6.9+). Resolves `true` when
 * allowed; `false` when declined, unsupported, already pending or failed.
 * Callers check `allowsWriteToPm()` first and skip the popup when it is `true`.
 */
export function requestWriteAccess(): Promise<boolean> {
  const wa = getTelegramWebApp();
  if (!wa || typeof wa.requestWriteAccess !== "function" || !tgVersionAtLeast(TG_WRITE_ACCESS_VERSION)) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    try {
      wa.requestWriteAccess!((allowed) => resolve(allowed === true));
    } catch {
      resolve(false);
    }
  });
}

/** Closes the Mini App. Returns `false` when there is no Mini App or the call threw. */
export function closeApp(): boolean {
  const wa = getTelegramWebApp();
  if (!wa || typeof wa.close !== "function") return false;
  try {
    wa.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens `url` in the external browser (`WebApp.openLink`) — the «Brauzerda
 * ochish» download fallback. Returns `false` when there is no Mini App.
 */
export function openExternalLink(url: string): boolean {
  const wa = getTelegramWebApp();
  if (!wa || typeof wa.openLink !== "function") return false;
  try {
    wa.openLink(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens a `https://t.me/…` link inside Telegram (`WebApp.openTelegramLink`),
 * e.g. the bot chat after «Bot sizga yoza olmadi». `false` when unavailable.
 */
export function openTelegramLink(url: string): boolean {
  const wa = getTelegramWebApp();
  if (!wa || typeof wa.openTelegramLink !== "function") return false;
  try {
    wa.openTelegramLink(url);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * Pure capability decisions. Components gather the inputs (`isInTelegramWebApp()`,
 * `tgVersion()`, the session user's `telegramId`, a `navigator.canShare` probe)
 * and branch on the result.
 * ------------------------------------------------------------------------- */

export type CapabilityInput = {
  /** `isInTelegramWebApp()`. */
  inTelegram: boolean;
  /** `tgVersion()`; `null`/empty when unknown (treated as old). */
  version: string | null;
};

/**
 * How «Yuklab olish» delivers a prepared file (R1 §4 strategy):
 *  - `tg-download` — Telegram ≥ 8.0: `downloadFile` with the signed URL;
 *  - `tg-fallback` — Telegram < 8.0: «Botga yuborish» (bot sends it) or «Brauzerda ochish» (`openLink`);
 *  - `browser` — ordinary browser: fetch with % progress → `<a download>`, navigation as last resort.
 */
export type DownloadCapability = "tg-download" | "tg-fallback" | "browser";

export function downloadCapability(s: CapabilityInput): DownloadCapability {
  if (!s.inTelegram) return "browser";
  return atLeast(s.version, TG_DOWNLOAD_FILE_VERSION) ? "tg-download" : "tg-fallback";
}

/**
 * How «Ulashish» works (R2 §2, §5):
 *  - `tg-prepared` — Telegram ≥ 8.0 and the account has Telegram: server prepares, `shareMessage` opens the chat picker;
 *  - `tg-save-forward` — older Telegram with a Telegram account: «Saqlash» to the bot chat + "forward from there" hint;
 *  - `web-share-files` — ordinary browser whose Web Share accepts this file (`navigator.canShare({files})`);
 *  - `download-only` — nothing better: download it and share by hand. Also inside Telegram without a
 *    linked account (the Android webview's `navigator.share` is not relied on).
 */
export type ShareCapability = "tg-prepared" | "tg-save-forward" | "web-share-files" | "download-only";

export function shareCapability(
  s: CapabilityInput & {
    /** The session user has a `telegramId` (the server sends to it). */
    hasTelegramId: boolean;
    /** `navigator.canShare({ files: [file] })` for this file type; ignored inside Telegram. */
    canShareFiles: boolean;
  },
): ShareCapability {
  if (s.inTelegram) {
    if (!s.hasTelegramId) return "download-only";
    return atLeast(s.version, TG_SHARE_MESSAGE_VERSION) ? "tg-prepared" : "tg-save-forward";
  }
  return s.canShareFiles ? "web-share-files" : "download-only";
}

/**
 * What «Saqlash» does after the bot sent the file (lead decisions in PLAN §3):
 *  - `tg-close` — inside Telegram: toast, then `closeApp()` after ~1 s (the user lands in the bot chat);
 *  - `tg-toast` — inside Telegram but a leave guard has unsaved work: toast only, never close;
 *  - `web-toast` — ordinary browser with a linked Telegram account: toast «Fayl bot chatiga yuborildi»;
 *  - `hidden` — no Telegram account on the session: the button is not shown.
 */
export type SaveCapability = "tg-close" | "tg-toast" | "web-toast" | "hidden";

export function saveCapability(s: {
  inTelegram: boolean;
  hasTelegramId: boolean;
  /** Some leave guard has unsaved work (`useLeaveGuard` pending): closing would lose it. */
  pending?: boolean;
}): SaveCapability {
  if (!s.hasTelegramId) return "hidden";
  if (!s.inTelegram) return "web-toast";
  return s.pending ? "tg-toast" : "tg-close";
}

function atLeast(version: string | null, min: string): boolean {
  return typeof version === "string" && version.trim() !== "" && compareVersions(version, min) >= 0;
}
