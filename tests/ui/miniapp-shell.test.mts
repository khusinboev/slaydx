import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { Fragment, StrictMode, createElement as h, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * Mini App shell in `MiniAppBridge` (docs/mobile/PLAN.md O6/O8, R5 §3.G)
 * against a fake `Telegram.WebApp` that records every call:
 *  - `disableVerticalSwipes` once, only in a genuine session on 7.7+;
 *  - header / background / bottom-bar colours from the app's `--page-bg`,
 *    re-sent when the app theme flips, version-gated;
 *  - `--tg-safe-*` / `--tg-content-safe-*` on <html>, updated on events;
 *  - `BackLink` renders nothing in the Mini App while Telegram's BackButton
 *    works, and stays in browsers / old clients / when the script fails.
 */

const nav = await import("../../lib/nav/history.ts");
const { MiniAppBridge } = await import("../../components/telegram/MiniAppBridge.tsx");
const { BackLink } = await import("../../components/nav/BackLink.tsx");
const { applyTheme, useAppStore } = await import("../../lib/store.ts");
const { useInTelegramMiniApp } = await import("../../components/telegram/useMiniAppShell.ts");

const SRC = "https://telegram.org/js/telegram-web-app.js";
const INIT = "query_id=AAH1&user=%7B%22id%22%3A42%7D&auth_date=1790000000&hash=abc123";
const HASH = `#tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;
type W = Record<string, unknown>;
const win = window as unknown as W;

const router = {
  push(href: string) {
    window.history.pushState({ __NA: true }, "", href);
  },
  replace(href: string) {
    window.history.replaceState({ __NA: true }, "", href);
  },
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

/** The app's two page colours, as `app/globals.css` defines them. */
const THEME_CSS = ":root { --page-bg: #faf5ee; } .dark { --page-bg: #121014; }";
const LIGHT = "#faf5ee";
const DARK = "#121014";

let log: string[] = [];
let listeners: Record<string, Array<() => void>> = {};

type FakeOpts = { version: string; isExpanded?: boolean; safe?: Record<string, number>; content?: Record<string, number> };

function fakeWebApp(o: FakeOpts) {
  const cmp = (min: string) => {
    const a = o.version.split(".").map(Number);
    const b = min.split(".").map(Number);
    return a[0]! !== b[0]! ? a[0]! > b[0]! : (a[1] ?? 0) >= (b[1] ?? 0);
  };
  return {
    initData: INIT,
    version: o.version,
    isExpanded: o.isExpanded ?? false,
    isVersionAtLeast: cmp,
    safeAreaInset: o.safe ?? { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: o.content ?? { top: 0, bottom: 0, left: 0, right: 0 },
    ready: () => log.push("ready"),
    expand: () => log.push("expand"),
    disableVerticalSwipes: () => log.push("disableVerticalSwipes"),
    setHeaderColor: (c: string) => log.push(`header ${c}`),
    setBackgroundColor: (c: string) => log.push(`background ${c}`),
    setBottomBarColor: (c: string) => log.push(`bottomBar ${c}`),
    enableClosingConfirmation() {},
    disableClosingConfirmation() {},
    BackButton: {
      show: () => log.push("bb.show"),
      hide: () => log.push("bb.hide"),
      onClick() {},
      offClick() {},
    },
    onEvent: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
    offEvent: (type: string, fn: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
  };
}

let style: HTMLStyleElement | null = null;

function fresh(path: string, opts: { webview?: boolean } = {}) {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path + HASH);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  log = [];
  listeners = {};
  if (opts.webview !== false) win.TelegramWebviewProxy = { postEvent() {} };
  useAppStore.setState({ sessionChecked: true, loggedIn: true });
  applyTheme("light");
  style = document.createElement("style");
  style.textContent = THEME_CSS;
  document.head.appendChild(style);
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify({ generations: [] }), { status: 200, headers: { "content-type": "application/json" } });
}

const realFetch = globalThis.fetch;
afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  globalThis.fetch = realFetch;
  delete win.TelegramWebviewProxy;
  delete win.Telegram;
  for (const s of document.querySelectorAll(`script[src="${SRC}"]`)) s.remove();
  style?.remove();
  applyTheme("light");
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

function Probe() {
  const inTg = useInTelegramMiniApp();
  return h("span", { "data-in-tg": String(inTg) });
}

function App(props: { path: string }) {
  const [path] = useState(props.path);
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: path },
      h(Fragment, null, h(BackLink, { "data-testid": "back" }, "←"), h(Probe), h(MiniAppBridge)),
    ),
  );
}

async function mountApp(path: string, strict = false) {
  const app = h(App, { path });
  render(strict ? h(StrictMode, null, app) : app);
  await act(async () => {});
}

/** telegram-web-app.js runs (exposes WebApp) and its tag fires `load`. */
async function scriptLoads(o: FakeOpts) {
  const wa = fakeWebApp(o);
  win.Telegram = { WebApp: wa };
  await act(async () => {
    document.querySelector(`script[src="${SRC}"]`)?.dispatchEvent(new window.Event("load"));
    await new Promise((r) => setTimeout(r, 10));
  });
  await settle();
  return wa;
}

const backLink = () => document.querySelector('[data-testid="back"]');
const inTg = () => document.querySelector("[data-in-tg]")?.getAttribute("data-in-tg");
const count = (entry: string) => log.filter((l) => l === entry).length;
const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);

// ---------------------------------------------------------------- swipes (O8)

test("swipes: disabled exactly once in a genuine 8.0 session (StrictMode double mount included)", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create", true);
  await scriptLoads({ version: "8.0" });
  assert.equal(count("disableVerticalSwipes"), 1);
  // Theme flips and re-renders do not repeat it.
  await act(async () => applyTheme("dark"));
  await settle();
  assert.equal(count("disableVerticalSwipes"), 1);
});

test("swipes: a remounted bridge on the same WebApp does not disable them again", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "8.0" });
  assert.equal(count("disableVerticalSwipes"), 1);
  cleanup();
  await settle();
  // Same page, Telegram.WebApp already there (the script tag is reused).
  await mountApp("/uz/create");
  await settle();
  assert.equal(count("ready"), 2, "the second session started");
  assert.equal(count("disableVerticalSwipes"), 1);
});

test("swipes: 7.7 yes, 7.6 no (version gate)", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "7.7" });
  assert.equal(count("disableVerticalSwipes"), 1);
  cleanup();
  await settle();
  delete win.Telegram;
  for (const s of document.querySelectorAll(`script[src="${SRC}"]`)) s.remove();

  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "7.6" });
  assert.equal(count("disableVerticalSwipes"), 0);
  assert.ok(log.includes("ready"), "the session itself still started");
});

test("ordinary browser (no webview signal): nothing is called, no CSS variables, «←» shown", async () => {
  fresh("/uz/create", { webview: false });
  await mountApp("/uz/create");
  // Even if some script defined Telegram.WebApp, the bridge stays inert.
  win.Telegram = { WebApp: fakeWebApp({ version: "8.0" }) };
  await settle();
  assert.deepEqual(log, []);
  assert.ok(!document.querySelector(`script[src="${SRC}"]`));
  assert.equal(cssVar("--tg-safe-top"), "");
  assert.ok(backLink(), "browsers keep the in-app back");
  assert.equal(inTg(), "false");
});

test("expand(): skipped when Telegram already opened the app expanded", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "8.0", isExpanded: true });
  assert.ok(log.includes("ready"));
  assert.equal(count("expand"), 0);
});

// ---------------------------------------------------------------- colours

test("colours: header, background and bottom bar get the light page colour, then the dark one on theme change", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "8.0" });
  assert.deepEqual(
    log.filter((l) => /^(header|background|bottomBar) /.test(l)),
    [`header ${LIGHT}`, `background ${LIGHT}`, `bottomBar ${LIGHT}`],
  );
  log = [];
  await act(async () => applyTheme("dark"));
  await settle();
  assert.deepEqual(log, [`header ${DARK}`, `background ${DARK}`, `bottomBar ${DARK}`]);
  // A class change that keeps the colour does not re-send anything.
  log = [];
  await act(async () => document.documentElement.classList.add("unrelated"));
  await settle();
  document.documentElement.classList.remove("unrelated");
  await settle();
  assert.deepEqual(log, []);
  await act(async () => applyTheme("light"));
  await settle();
  assert.deepEqual(log, [`header ${LIGHT}`, `background ${LIGHT}`, `bottomBar ${LIGHT}`]);
});

test("colours: version gates — 7.9 no bottom bar, 6.8 background only, 6.0 nothing", async () => {
  for (const [version, want] of [
    ["7.9", [`header ${LIGHT}`, `background ${LIGHT}`]],
    ["6.8", [`background ${LIGHT}`]],
    ["6.0", []],
  ] as const) {
    fresh("/uz/create");
    await mountApp("/uz/create");
    await scriptLoads({ version });
    assert.deepEqual(log.filter((l) => /^(header|background|bottomBar) /.test(l)), want, `client ${version}`);
    cleanup();
    await settle();
    delete win.Telegram;
    for (const s of document.querySelectorAll(`script[src="${SRC}"]`)) s.remove();
    style?.remove();
  }
});

test("colours: unmount stops following the theme", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "8.0" });
  cleanup();
  await settle();
  log = [];
  applyTheme("dark");
  await settle();
  assert.deepEqual(log, []);
});

// ---------------------------------------------------------------- safe areas

test("safe areas: Telegram insets as CSS variables, updated on safeAreaChanged / contentSafeAreaChanged, removed on unmount", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  const wa = await scriptLoads({
    version: "8.0",
    safe: { top: 47, bottom: 34, left: 0, right: 0 },
    content: { top: 56, bottom: 0, left: 0, right: 0 },
  });
  assert.equal(cssVar("--tg-safe-top"), "47px");
  assert.equal(cssVar("--tg-safe-bottom"), "34px");
  assert.equal(cssVar("--tg-safe-left"), "0px");
  assert.equal(cssVar("--tg-safe-right"), "0px");
  assert.equal(cssVar("--tg-content-safe-top"), "56px");
  assert.equal(cssVar("--tg-content-safe-bottom"), "0px");

  wa.safeAreaInset = { top: 0, bottom: 20, left: 44, right: 44 };
  await act(async () => (listeners.safeAreaChanged ?? []).forEach((f) => f()));
  assert.equal(cssVar("--tg-safe-top"), "0px");
  assert.equal(cssVar("--tg-safe-bottom"), "20px");
  assert.equal(cssVar("--tg-safe-left"), "44px");

  wa.contentSafeAreaInset = { top: 0, bottom: 8, left: 0, right: 0 };
  await act(async () => (listeners.contentSafeAreaChanged ?? []).forEach((f) => f()));
  assert.equal(cssVar("--tg-content-safe-top"), "0px");
  assert.equal(cssVar("--tg-content-safe-bottom"), "8px");

  cleanup();
  await settle();
  assert.equal(cssVar("--tg-safe-bottom"), "", "variables removed");
  assert.equal((listeners.safeAreaChanged ?? []).length, 0, "offEvent on unmount");
  assert.equal((listeners.contentSafeAreaChanged ?? []).length, 0);
});

test("safe areas: client < 8.0 gets env() fallbacks and no event subscription", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "7.10", safe: { top: 47, bottom: 34, left: 0, right: 0 } });
  assert.equal(cssVar("--tg-safe-top"), "env(safe-area-inset-top, 0px)");
  assert.equal(cssVar("--tg-safe-bottom"), "env(safe-area-inset-bottom, 0px)");
  assert.equal(cssVar("--tg-content-safe-top"), "0px");
  assert.equal((listeners.safeAreaChanged ?? []).length, 0);
});

// ---------------------------------------------------------------- BackLink (O6)

test("BackLink: hidden in the Mini App from the first client frame and after Telegram's BackButton is up", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  assert.ok(!backLink(), "pending: Telegram's BackButton is being set up");
  assert.equal(inTg(), "true");
  await scriptLoads({ version: "8.0" });
  assert.ok(log.includes("bb.show"), "Telegram's BackButton is shown on a non-root page");
  assert.ok(!backLink(), "one back control: Telegram's");
});

test("BackLink: comes back when the client has no BackButton (6.0)", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  await scriptLoads({ version: "6.0" });
  assert.ok(!log.includes("bb.show"));
  assert.ok(backLink(), "no Telegram BackButton → the in-app «←» stays");
});

test("BackLink: comes back when telegram-web-app.js fails to load", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  assert.ok(!backLink());
  await act(async () => {
    document.querySelector(`script[src="${SRC}"]`)?.dispatchEvent(new window.Event("error"));
    await new Promise((r) => setTimeout(r, 10));
  });
  await settle();
  assert.ok(backLink());
});

test("BackLink: comes back when BackButton.show throws", async () => {
  fresh("/uz/create");
  await mountApp("/uz/create");
  const wa = fakeWebApp({ version: "8.0" });
  wa.BackButton.show = () => {
    throw new Error("WebAppMethodUnsupported");
  };
  win.Telegram = { WebApp: wa };
  await act(async () => {
    document.querySelector(`script[src="${SRC}"]`)?.dispatchEvent(new window.Event("load"));
    await new Promise((r) => setTimeout(r, 10));
  });
  await settle();
  assert.ok(backLink());
});

test("BackLink: the bridge unmounting (e.g. leaving for /admin) restores it", async () => {
  fresh("/uz/create");
  function Shell() {
    const [bridge, setBridge] = useState(true);
    ctl.setBridge = setBridge;
    return h(
      AppRouterContext.Provider,
      { value: router },
      h(
        PathnameContext.Provider,
        { value: "/uz/create" },
        h(Fragment, null, h(BackLink, { "data-testid": "back" }, "←"), bridge ? h(MiniAppBridge) : null),
      ),
    );
  }
  render(h(Shell));
  await act(async () => {});
  await scriptLoads({ version: "8.0" });
  assert.ok(!backLink());
  await act(async () => ctl.setBridge!(false));
  await settle();
  assert.ok(backLink());
});

const ctl: { setBridge?: (v: boolean) => void } = {};
