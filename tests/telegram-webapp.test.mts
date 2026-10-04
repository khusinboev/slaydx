import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  allowsWriteToPm,
  closeApp,
  compareVersions,
  downloadCapability,
  downloadFile,
  getTelegramWebApp,
  isGenuineMiniApp,
  isInTelegramWebApp,
  isMiniAppUserMismatch,
  miniAppUserId,
  offEvent,
  onEvent,
  openExternalLink,
  requestDownload,
  requestWriteAccess,
  saveCapability,
  shareCapability,
  shareMessage,
  shareMessageResult,
  tgVersion,
  tgVersionAtLeast,
  type MiniAppEnv,
} from "../lib/telegram-webapp.ts";

/**
 * `lib/telegram-webapp.ts` (docs/mobile/PLAN.md §4.3). The fake below mirrors
 * the relevant parts of telegram-web-app.js (scratchpad r2/tg-web-app.js):
 * version gate → `WebAppMethodUnsupported`, one open request per kind →
 * `…PopupOpened` / `WebAppShareMessageOpened`, callback first and then the
 * `receiveWebViewEvent` dispatch, `web_app_*` events through `WebView.postEvent`.
 */

const LAUNCH = "#tgWebAppData=" + encodeURIComponent("user=%7B%22id%22%3A42%7D&hash=abc") + "&tgWebAppVersion=8.0";
const g = globalThis as unknown as Record<string, unknown>;

type Fake = ReturnType<typeof makeFake>;

function versionAtLeast(have: string, want: string) {
  return compareVersions(have, want) >= 0;
}

function makeFake(version = "8.0", user: Record<string, unknown> | null = { id: 42, allows_write_to_pm: false }) {
  const handlers = new Map<string, Set<(p?: unknown) => void>>();
  const posted: { type: string; data: unknown }[] = [];
  let downloadOpen: false | { cb?: (ok: boolean) => void } = false;
  let shareOpen: false | { cb?: (ok: boolean) => void } = false;
  let writeOpen: false | { cb?: (ok: boolean) => void } = false;
  let closed = 0;
  const opened: string[] = [];
  /** Every invocation of a gated method, also ones that throw (real clients log an error for those). */
  const calls: string[] = [];
  const emit =(type: string, payload?: unknown) => {
    for (const h of [...(handlers.get(type) ?? [])]) h(payload);
  };
  const WebApp = {
    initData: "user=%7B%22id%22%3A42%7D&hash=abc",
    initDataUnsafe: user ? { user } : {},
    version,
    isVersionAtLeast: (v: string) => versionAtLeast(version, v),
    onEvent(type: string, h: (p?: unknown) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(h);
    },
    offEvent(type: string, h: (p?: unknown) => void) {
      handlers.get(type)?.delete(h);
    },
    downloadFile(params: { url: string; file_name: string }, cb?: (ok: boolean) => void) {
      calls.push("downloadFile");
      if (!versionAtLeast(version, "8.0")) throw Error("WebAppMethodUnsupported");
      if (downloadOpen) throw Error("WebAppDownloadFilePopupOpened");
      if (!params?.url || !params.url.startsWith("https:")) throw Error("WebAppDownloadFileParamInvalid");
      if (!params.file_name) throw Error("WebAppDownloadFileParamInvalid");
      downloadOpen = { cb };
      posted.push({ type: "web_app_request_file_download", data: params });
    },
    shareMessage(id: string, cb?: (ok: boolean) => void) {
      calls.push("shareMessage");
      if (!versionAtLeast(version, "8.0")) throw Error("WebAppMethodUnsupported");
      if (shareOpen) throw Error("WebAppShareMessageOpened");
      shareOpen = { cb };
      posted.push({ type: "web_app_send_prepared_message", data: { id } });
    },
    requestWriteAccess(cb?: (ok: boolean) => void) {
      calls.push("requestWriteAccess");
      if (!versionAtLeast(version, "6.9")) throw Error("WebAppMethodUnsupported");
      if (writeOpen) throw Error("WebAppWriteAccessRequested");
      writeOpen = { cb };
      posted.push({ type: "web_app_request_write_access", data: null });
    },
    close() {
      closed++;
    },
    openLink(url: string) {
      opened.push(url);
    },
  };
  const WebView = {
    postEvent(type: string, _cb: unknown, data: unknown) {
      posted.push({ type, data });
    },
  };
  /** What the native client sends back (tg-web-app.js `on…` handlers). */
  const client = {
    fileDownloadRequested(status: "downloading" | "cancelled") {
      if (!downloadOpen) return;
      const r = downloadOpen;
      downloadOpen = false;
      r.cb?.(status === "downloading");
      emit("fileDownloadRequested", { status });
    },
    preparedMessageSent() {
      if (!shareOpen) return;
      const r = shareOpen;
      shareOpen = false;
      r.cb?.(true);
      emit("shareMessageSent");
    },
    preparedMessageFailed(error: string) {
      if (!shareOpen) return;
      const r = shareOpen;
      shareOpen = false;
      r.cb?.(false);
      emit("shareMessageFailed", { error });
    },
    writeAccessRequested(status: "allowed" | "cancelled") {
      if (!writeOpen) return;
      const r = writeOpen;
      writeOpen = false;
      r.cb?.(status === "allowed");
      emit("writeAccessRequested", { status });
    },
    emit,
  };
  return { WebApp, WebView, client, posted, handlers, calls, get closed() { return closed; }, opened };
}

/** Installs a Telegram-webview-like `window` (proxy signal + launch hash) carrying the fake. */
function install(fake: Fake | null, opts: { hash?: string; proxy?: boolean } = {}) {
  const win: Record<string, unknown> = {
    location: { hash: opts.hash ?? LAUNCH },
    document: { referrer: "" },
  };
  win.parent = win;
  if (opts.proxy !== false) win.TelegramWebviewProxy = { postEvent() {} };
  if (fake) win.Telegram = { WebApp: fake.WebApp, WebView: fake.WebView };
  g.window = win;
  return win;
}

afterEach(() => {
  delete g.window;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------------ pure */

test("compareVersions follows tg-web-app.js versionCompare", () => {
  assert.equal(compareVersions("8.0", "8.0"), 0);
  assert.equal(compareVersions("8", "8.0"), 0);
  assert.equal(compareVersions("8.0", "7.10"), 1);
  assert.equal(compareVersions("7.10", "7.9"), 1, "numeric, not lexicographic");
  assert.equal(compareVersions("6.9", "8.0"), -1);
  assert.equal(compareVersions("", "6.0"), -1);
  assert.equal(compareVersions("x.y", "0"), 0);
  assert.equal(compareVersions(" 9.1 ", "9.1"), 0);
});

test("downloadCapability: Telegram ≥ 8.0 → downloadFile; older → fallback; browser → fetch", () => {
  assert.equal(downloadCapability({ inTelegram: true, version: "8.0" }), "tg-download");
  assert.equal(downloadCapability({ inTelegram: true, version: "10.1" }), "tg-download");
  assert.equal(downloadCapability({ inTelegram: true, version: "7.10" }), "tg-fallback");
  assert.equal(downloadCapability({ inTelegram: true, version: null }), "tg-fallback");
  assert.equal(downloadCapability({ inTelegram: true, version: "" }), "tg-fallback");
  assert.equal(downloadCapability({ inTelegram: false, version: "9.0" }), "browser");
  assert.equal(downloadCapability({ inTelegram: false, version: null }), "browser");
});

test("shareCapability covers every branch", () => {
  const s = (inTelegram: boolean, version: string | null, hasTelegramId: boolean, canShareFiles: boolean) =>
    shareCapability({ inTelegram, version, hasTelegramId, canShareFiles });
  assert.equal(s(true, "8.0", true, false), "tg-prepared");
  assert.equal(s(true, "8.0", true, true), "tg-prepared", "Telegram path wins over Web Share");
  assert.equal(s(true, "7.10", true, true), "tg-save-forward");
  assert.equal(s(true, null, true, false), "tg-save-forward");
  assert.equal(s(true, "8.0", false, true), "download-only", "no account: never navigator.share inside Telegram");
  assert.equal(s(false, null, true, true), "web-share-files");
  assert.equal(s(false, null, false, true), "web-share-files");
  assert.equal(s(false, "8.0", true, false), "download-only");
});

test("saveCapability: hidden without Telegram account; close in Telegram unless work is pending", () => {
  assert.equal(saveCapability({ inTelegram: true, hasTelegramId: true }), "tg-close");
  assert.equal(saveCapability({ inTelegram: true, hasTelegramId: true, pending: true }), "tg-toast");
  assert.equal(saveCapability({ inTelegram: true, hasTelegramId: true, pending: false }), "tg-close");
  assert.equal(saveCapability({ inTelegram: false, hasTelegramId: true }), "web-toast");
  assert.equal(saveCapability({ inTelegram: false, hasTelegramId: true, pending: true }), "web-toast");
  assert.equal(saveCapability({ inTelegram: true, hasTelegramId: false }), "hidden");
  assert.equal(saveCapability({ inTelegram: false, hasTelegramId: false }), "hidden");
});

test("isMiniAppUserMismatch: only two known, different ids", () => {
  assert.equal(isMiniAppUserMismatch("42", "42"), false);
  assert.equal(isMiniAppUserMismatch("42", "77"), true);
  assert.equal(isMiniAppUserMismatch(null, "77"), false);
  assert.equal(isMiniAppUserMismatch("42", null), false);
  assert.equal(isMiniAppUserMismatch(undefined, null), false);
});

test("isGenuineMiniApp: webview signal AND (launch hash OR loaded initData)", () => {
  const base = (over: Partial<MiniAppEnv>): MiniAppEnv => {
    const env = { location: { hash: "" }, document: { referrer: "" }, ...over } as MiniAppEnv;
    if (!("parent" in over)) (env as { parent?: unknown }).parent = env;
    return env;
  };
  const proxy = { postEvent() {} };
  assert.equal(isGenuineMiniApp(base({ TelegramWebviewProxy: proxy, location: { hash: LAUNCH } })), true);
  // After client navigation the hash is gone; the script's initData still proves the launch.
  assert.equal(isGenuineMiniApp(base({ TelegramWebviewProxy: proxy, Telegram: { WebApp: { initData: "a=1" } } })), true);
  assert.equal(isGenuineMiniApp(base({ TelegramWebviewProxy: proxy, Telegram: { WebApp: { initData: "" } } })), false);
  assert.equal(isGenuineMiniApp(base({ TelegramWebviewProxy: proxy })), false);
  // A plain browser tab with a crafted hash or a planted object is not a Mini App.
  assert.equal(isGenuineMiniApp(base({ location: { hash: LAUNCH } })), false);
  assert.equal(isGenuineMiniApp(base({ Telegram: { WebApp: { initData: "a=1" } } })), false);
  // Throwing getters do not escape.
  const evil = base({ TelegramWebviewProxy: proxy });
  Object.defineProperty(evil, "location", { get() { throw new Error("boom"); } });
  assert.equal(isGenuineMiniApp(evil), false);
});

/* --------------------------------------------------------- accessor/env */

test("outside a Mini App everything is a safe no-op (no window, plain browser)", async () => {
  delete g.window;
  assert.equal(isInTelegramWebApp(), false);
  assert.equal(getTelegramWebApp(), null);
  assert.equal(tgVersionAtLeast("6.0"), false);
  assert.equal(tgVersion(), null);
  assert.equal(miniAppUserId(), null);
  assert.equal(allowsWriteToPm(), null);
  assert.equal(closeApp(), false);
  assert.equal(openExternalLink("https://x.test/"), false);
  assert.equal(await downloadFile({ url: "https://x.test/a", file_name: "a.pdf" }), false);
  assert.equal(await shareMessage("p1"), false);
  assert.equal(await requestWriteAccess(), false);
  const off = onEvent("viewportChanged", () => {});
  off();

  // A plain browser where somebody planted `Telegram.WebApp`: still ignored.
  const fake = makeFake();
  install(fake, { proxy: false });
  assert.equal(isInTelegramWebApp(), false);
  assert.equal(getTelegramWebApp(), null);
  assert.equal(closeApp(), false);
  assert.equal(fake.closed, 0);
});

test("inside a Mini App: accessor, version, user id, write access flag", () => {
  const fake = makeFake("8.0", { id: 42, allows_write_to_pm: true });
  install(fake);
  assert.equal(isInTelegramWebApp(), true);
  assert.equal(getTelegramWebApp(), fake.WebApp);
  assert.equal(tgVersion(), "8.0");
  assert.equal(tgVersionAtLeast("8.0"), true);
  assert.equal(tgVersionAtLeast("8.1"), false);
  assert.equal(miniAppUserId(), "42");
  assert.equal(allowsWriteToPm(), true);

  install(makeFake("8.0", { id: "77" }));
  assert.equal(miniAppUserId(), "77", "numeric string id");
  install(makeFake("8.0", { id: "77abc" }));
  assert.equal(miniAppUserId(), null, "non-numeric id is ignored");
  install(makeFake("8.0", { id: Number.NaN }));
  assert.equal(miniAppUserId(), null);

  install(makeFake("7.0", null));
  assert.equal(miniAppUserId(), null);
  assert.equal(allowsWriteToPm(), null);
  assert.equal(tgVersionAtLeast("6.9"), true);
  assert.equal(tgVersionAtLeast("8.0"), false);

  // Script not loaded yet: genuine launch, but no object.
  install(null);
  assert.equal(isInTelegramWebApp(), true);
  assert.equal(getTelegramWebApp(), null);
});

test("tgVersionAtLeast falls back to `version` when isVersionAtLeast is missing or throws", () => {
  const fake = makeFake("7.10");
  (fake.WebApp as Record<string, unknown>).isVersionAtLeast = undefined;
  install(fake);
  assert.equal(tgVersionAtLeast("7.9"), true);
  assert.equal(tgVersionAtLeast("8.0"), false);
  (fake.WebApp as Record<string, unknown>).isVersionAtLeast = () => {
    throw new Error("x");
  };
  assert.equal(tgVersionAtLeast("6.0"), false);
});

test("onEvent/offEvent wrap Telegram's bus, isolate handler errors, dedupe the same handler", () => {
  const fake = makeFake();
  install(fake);
  const seen: unknown[] = [];
  const h = (p: { isStateStable: boolean }) => seen.push(p.isStateStable);
  const off = onEvent("viewportChanged", h);
  onEvent("viewportChanged", h);
  assert.equal(fake.handlers.get("viewportChanged")!.size, 1);
  fake.client.emit("viewportChanged", { isStateStable: true });
  assert.deepEqual(seen, [true]);

  // A throwing handler does not break the others.
  const warn = console.warn;
  console.warn = () => {};
  const bad = () => {
    throw new Error("bad");
  };
  onEvent("viewportChanged", bad);
  fake.client.emit("viewportChanged", { isStateStable: false });
  console.warn = warn;
  assert.deepEqual(seen, [true, false]);

  off();
  offEvent("viewportChanged", bad);
  assert.equal(fake.handlers.get("viewportChanged")!.size, 0);
  // The same function may listen to two types independently.
  const tags: string[] = [];
  const any = () => tags.push("x");
  onEvent("activated", any);
  onEvent("deactivated", any);
  offEvent("activated", any);
  fake.client.emit("activated");
  fake.client.emit("deactivated");
  fake.client.emit("viewportChanged", { isStateStable: true });
  assert.deepEqual(tags, ["x"]);
  assert.deepEqual(seen, [true, false], "removed viewport handlers no longer fire");
  offEvent("deactivated", any);
});

/* ------------------------------------------------------------ download */

const PARAMS = { url: "https://slaydx.test/api/dl/tok", file_name: "Referat.pdf" };

test("requestDownload: accepted → downloading; the request reaches the client", async () => {
  const fake = makeFake();
  install(fake);
  const p = requestDownload(PARAMS);
  assert.deepEqual(fake.posted.at(-1), { type: "web_app_request_file_download", data: PARAMS });
  fake.client.fileDownloadRequested("downloading");
  assert.equal(await p, "downloading");
  assert.equal(fake.handlers.get("fileDownloadRequested")!.size, 0, "listener removed");
});

test("requestDownload: cancelled; downloadFile boolean wrapper", async () => {
  const fake = makeFake();
  install(fake);
  const p = requestDownload(PARAMS);
  fake.client.fileDownloadRequested("cancelled");
  assert.equal(await p, "cancelled");
  const q = downloadFile(PARAMS);
  fake.client.fileDownloadRequested("downloading");
  assert.equal(await q, true);
  const r = downloadFile(PARAMS);
  fake.client.fileDownloadRequested("cancelled");
  assert.equal(await r, false);
});

test("requestDownload: unsupported below 8.0, without the method, or for a non-HTTPS URL", async () => {
  const old = makeFake("7.10");
  install(old);
  assert.equal(await requestDownload(PARAMS), "unsupported");
  assert.deepEqual(old.calls, [], "never called on an old client");

  const fake = makeFake();
  install(fake);
  assert.equal(await requestDownload({ url: "http://slaydx.test/a", file_name: "a.pdf" }), "unsupported");
  assert.equal(await requestDownload({ url: "/api/dl/tok", file_name: "a.pdf" }), "unsupported");
  assert.equal(await requestDownload({ url: PARAMS.url, file_name: "" }), "unsupported");
  assert.deepEqual(fake.calls, [], "invalid params are refused before calling Telegram");
  (fake.WebApp as Record<string, unknown>).downloadFile = undefined;
  assert.equal(await requestDownload(PARAMS), "unsupported");
});

test("requestDownload: a dropped request times out, and a retry is re-sent through WebView", async () => {
  const fake = makeFake();
  install(fake);
  // Android drops the call (no touch in the last 10 s): no answer at all.
  const hung = new Promise((r) => setTimeout(() => r("hung"), 500));
  assert.equal(await Promise.race([requestDownload(PARAMS, { timeoutMs: 5 }), hung]), "no-response");
  assert.equal(fake.handlers.get("fileDownloadRequested")!.size, 0, "listener removed after timeout");
  // tg-web-app.js still has the request "open": downloadFile would throw, so the retry posts directly.
  const retry = requestDownload(PARAMS);
  assert.equal(fake.posted.length, 2);
  assert.deepEqual(fake.posted[1], { type: "web_app_request_file_download", data: PARAMS });
  fake.client.fileDownloadRequested("downloading");
  assert.equal(await retry, "downloading");
});

test("requestDownload: popup open and no WebView bridge → error; other throws → error", async () => {
  const fake = makeFake();
  const win = install(fake);
  void requestDownload(PARAMS, { timeoutMs: 1 });
  await flush();
  (win.Telegram as Record<string, unknown>).WebView = undefined;
  assert.equal(await requestDownload(PARAMS), "error");
  (fake.WebApp as Record<string, unknown>).downloadFile = () => {
    throw new Error("weird");
  };
  assert.equal(await requestDownload(PARAMS), "error");
});

/* --------------------------------------------------------------- share */

test("shareMessageResult: sent", async () => {
  const fake = makeFake();
  install(fake);
  const p = shareMessageResult("prep-1");
  assert.deepEqual(fake.posted.at(-1), { type: "web_app_send_prepared_message", data: { id: "prep-1" } });
  fake.client.preparedMessageSent();
  assert.equal(await p, "sent");
  assert.equal(fake.handlers.get("shareMessageSent")!.size, 0);
  assert.equal(fake.handlers.get("shareMessageFailed")!.size, 0);
});

test("shareMessageResult: failure reasons come from the event dispatched after the callback", async () => {
  const fake = makeFake();
  install(fake);
  let p = shareMessageResult("prep-1");
  fake.client.preparedMessageFailed("MESSAGE_EXPIRED");
  assert.equal(await p, "expired");
  p = shareMessageResult("prep-2");
  fake.client.preparedMessageFailed("UNSUPPORTED");
  assert.equal(await p, "unsupported");
  p = shareMessageResult("prep-3");
  fake.client.preparedMessageFailed("USER_DECLINED");
  assert.equal(await p, "failed");
  const b = shareMessage("prep-4");
  fake.client.preparedMessageSent();
  assert.equal(await b, true);
  const c = shareMessage("prep-5");
  fake.client.preparedMessageFailed("X");
  assert.equal(await c, false);
});

test("shareMessageResult: callback-only clients (no event) still settle", async () => {
  const fake = makeFake();
  install(fake);
  (fake.WebApp as Record<string, unknown>).shareMessage = (_id: string, cb: (ok: boolean) => void) => cb(false);
  assert.equal(await shareMessageResult("p"), "failed");
  (fake.WebApp as Record<string, unknown>).shareMessage = (_id: string, cb: (ok: boolean) => void) => cb(true);
  assert.equal(await shareMessageResult("p"), "sent");
});

test("shareMessageResult: unsupported (old client), busy (dialog open), error", async () => {
  const old = makeFake("7.9");
  install(old);
  assert.equal(await shareMessageResult("p"), "unsupported");
  assert.deepEqual(old.calls, [], "never called below 8.0");

  const fake = makeFake();
  install(fake);
  void shareMessageResult("p1");
  assert.equal(await shareMessageResult("p2"), "busy");
  fake.client.preparedMessageSent();
  (fake.WebApp as Record<string, unknown>).shareMessage = () => {
    throw new Error("odd");
  };
  assert.equal(await shareMessageResult("p3"), "error");
});

/* ------------------------------------------------------ write access/close */

test("requestWriteAccess: allowed / cancelled / unsupported below 6.9 / pending", async () => {
  const fake = makeFake("8.0");
  install(fake);
  let p = requestWriteAccess();
  fake.client.writeAccessRequested("allowed");
  assert.equal(await p, true);
  p = requestWriteAccess();
  fake.client.writeAccessRequested("cancelled");
  assert.equal(await p, false);
  void requestWriteAccess();
  assert.equal(await requestWriteAccess(), false, "second popup while one is open");

  const old = makeFake("6.8");
  install(old);
  assert.equal(await requestWriteAccess(), false);
  assert.deepEqual(old.calls, [], "never called below 6.9");
});

test("closeApp and openExternalLink call Telegram and swallow throws", () => {
  const fake = makeFake();
  install(fake);
  assert.equal(closeApp(), true);
  assert.equal(fake.closed, 1);
  assert.equal(openExternalLink("https://slaydx.test/api/dl/tok"), true);
  assert.deepEqual(fake.opened, ["https://slaydx.test/api/dl/tok"]);
  (fake.WebApp as Record<string, unknown>).close = () => {
    throw new Error("x");
  };
  assert.equal(closeApp(), false);
});
