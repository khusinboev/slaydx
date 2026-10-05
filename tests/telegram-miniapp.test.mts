import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Telegram Mini App detection (`lib/telegram-miniapp.ts`). The fragment
 * `#tgWebAppData=…` alone must never count (FE-10 login-CSRF): only a
 * Telegram-injected environment plus exactly one launch-data entry does.
 */

const { telegramWebviewSignal, hasLaunchData, isTelegramWebApp, shouldAutoLogin, TELEGRAM_WEB_APP_SCRIPT } =
  await import("../lib/telegram-miniapp.ts");
type LaunchEnv = import("../lib/telegram-miniapp.ts").LaunchEnv;

const INIT = "query_id=AAH1&user=%7B%22id%22%3A42%7D&auth_date=1790000000&hash=abc";
const HASH = `#tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;

/** A top-level tab: `parent === self`. */
function tab(extra: Partial<LaunchEnv> & { hash?: string; referrer?: string; ancestors?: string[] } = {}): LaunchEnv {
  const win: LaunchEnv = {
    location: { hash: extra.hash ?? HASH, ...(extra.ancestors ? { ancestorOrigins: extra.ancestors } : {}) },
    document: { referrer: extra.referrer ?? "" },
    ...("TelegramWebviewProxy" in extra ? { TelegramWebviewProxy: extra.TelegramWebviewProxy } : {}),
    ...("external" in extra ? { external: extra.external } : {}),
  };
  win.parent = "parent" in extra ? extra.parent : win;
  return win;
}
const framed = (o: { ancestors?: string[]; referrer?: string; hash?: string }) => tab({ ...o, parent: {} });
const proxy = { postEvent() {} };

test("plain browser tab with a crafted #tgWebAppData: not a Mini App", () => {
  assert.equal(telegramWebviewSignal(tab()), null);
  assert.equal(isTelegramWebApp(tab()), false);
  // Chrome/Edge expose `window.external` without `notify`.
  assert.equal(isTelegramWebApp(tab({ external: { AddSearchProvider() {}, IsSearchProviderInstalled() {} } })), false);
  // A Telegram-looking referrer on a top-level tab proves nothing (links from t.me / web.telegram.org).
  assert.equal(isTelegramWebApp(tab({ referrer: "https://web.telegram.org/" })), false);
});

test("Telegram webview proxy + launch data: Mini App", () => {
  assert.equal(telegramWebviewSignal(tab({ TelegramWebviewProxy: proxy })), "proxy");
  assert.equal(isTelegramWebApp(tab({ TelegramWebviewProxy: proxy })), true);
});

test("a non-callable TelegramWebviewProxy (e.g. a DOM element id clash) is not a signal", () => {
  assert.equal(isTelegramWebApp(tab({ TelegramWebviewProxy: { postEvent: "x" } })), false);
  assert.equal(isTelegramWebApp(tab({ TelegramWebviewProxy: null })), false);
});

test("Windows webview bridge (external.notify) + launch data: Mini App", () => {
  assert.equal(isTelegramWebApp(tab({ external: { notify() {} } })), true);
});

test("framed by Telegram Web: ancestorOrigins first, referrer only as fallback", () => {
  assert.equal(telegramWebviewSignal(framed({ ancestors: ["https://web.telegram.org"] })), "frame");
  assert.equal(isTelegramWebApp(framed({ ancestors: ["https://web.telegram.org"] })), true);
  assert.equal(isTelegramWebApp(framed({ referrer: "https://web.telegram.org/k/" })), true);
  // ancestorOrigins wins over a referrer that claims Telegram.
  assert.equal(isTelegramWebApp(framed({ ancestors: ["https://evil.example"], referrer: "https://web.telegram.org/" })), false);
  for (const bad of ["https://evil.example", "http://web.telegram.org", "https://telegram.org.evil.example", "https://evil-telegram.org"]) {
    assert.equal(isTelegramWebApp(framed({ ancestors: [bad] })), false, bad);
  }
  assert.equal(isTelegramWebApp(framed({ referrer: "" })), false);
});

test("launch data must be present exactly once and non-empty", () => {
  assert.equal(hasLaunchData(HASH), true);
  assert.equal(isTelegramWebApp(tab({ TelegramWebviewProxy: proxy, hash: "" })), false, "proxy alone is not enough");
  assert.equal(isTelegramWebApp(tab({ TelegramWebviewProxy: proxy, hash: "#tgWebAppVersion=8.0" })), false);
  assert.equal(hasLaunchData("#tgWebAppData="), false);
  assert.equal(hasLaunchData(`${HASH}&tgWebAppData=${encodeURIComponent(INIT)}`), false, "pre-filled duplicate refused");
});

test("shouldAutoLogin: only a ready webview, no session of anyone, one attempt", () => {
  const base = { webAppReady: true, initData: INIT, sessionChecked: true, loggedIn: false, attempted: false };
  assert.equal(shouldAutoLogin(base), true);
  assert.equal(shouldAutoLogin({ ...base, webAppReady: false }), false, "plain browser: script never loaded");
  assert.equal(shouldAutoLogin({ ...base, loggedIn: true }), false, "already signed in (same or other user)");
  assert.equal(shouldAutoLogin({ ...base, sessionChecked: false }), false, "session not known yet");
  assert.equal(shouldAutoLogin({ ...base, attempted: true }), false, "no second attempt (e.g. after sign-out)");
  assert.equal(shouldAutoLogin({ ...base, initData: "" }), false);
});

test("the Telegram script URL lives only in the gated bridge and is never imported statically", () => {
  assert.equal(TELEGRAM_WEB_APP_SCRIPT, "https://telegram.org/js/telegram-web-app.js");
  const bridge = readFileSync(new URL("../components/telegram/MiniAppBridge.tsx", import.meta.url), "utf8");
  assert.match(bridge, /if \(!isGenuineMiniApp\(/, "script injection is gated by the detection");
  for (const f of ["../app/layout.tsx", "../components/providers.tsx", "../lib/store.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!src.includes("telegram-web-app.js"), `${f} must not load the Telegram script`);
  }
  // FE-10: initData is never persisted by our code.
  const lib = readFileSync(new URL("../lib/telegram-miniapp.ts", import.meta.url), "utf8");
  for (const src of [bridge, lib]) assert.ok(!/(local|session)Storage/.test(src), "no storage of initData");
});
