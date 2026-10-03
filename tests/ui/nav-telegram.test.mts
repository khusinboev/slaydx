import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { Fragment, StrictMode, createElement as h, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * Telegram BackButton + closing confirmation in `MiniAppBridge`
 * (docs/nav/R4-back-nav.md §4) against a stubbed `Telegram.WebApp`:
 * visible iff an overlay is open or the route is not a root; a click closes
 * the top overlay (history.back) or runs backTo; `offClick` on unmount;
 * nothing is called on clients older than 6.1 / 6.2; inert outside a webview.
 *
 * Mutations, each caught here: drop `offClick` from the cleanup → "unmount"
 * and "StrictMode" fail; ignore `overlays` → "overlay at a root" fails; skip
 * the version gate → "old client" fails.
 */

const nav = await import("../../lib/nav/history.ts");
const { MiniAppBridge } = await import("../../components/telegram/MiniAppBridge.tsx");
const { useDialog } = await import("../../components/overlays/useDialog.ts");
const { useLeaveGuard } = await import("../../components/nav/useLeaveGuard.ts");
const { useAppStore } = await import("../../lib/store.ts");

const SRC = "https://telegram.org/js/telegram-web-app.js";
const INIT = "query_id=AAH1&user=%7B%22id%22%3A42%7D&auth_date=1790000000&hash=abc123";
const HASH = `#tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;
type W = Record<string, unknown>;
const win = window as unknown as W;

const calls: string[] = [];
const router = {
  push(href: string) {
    calls.push(`push ${href}`);
    window.history.pushState({ __NA: true }, "", href);
  },
  replace(href: string) {
    calls.push(`replace ${href}`);
    window.history.replaceState({ __NA: true }, "", href);
  },
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

const here = () => window.location.pathname;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

type Stub = { log: string[]; visible: boolean; handlers: Array<() => void> };
let tg: Stub;

function webApp(version: string) {
  const cmp = (min: string) => {
    const a = version.split(".").map(Number);
    const b = min.split(".").map(Number);
    return a[0]! !== b[0]! ? a[0]! > b[0]! : (a[1] ?? 0) >= (b[1] ?? 0);
  };
  return {
    initData: INIT,
    version,
    ready() {},
    expand() {},
    isVersionAtLeast: cmp,
    BackButton: {
      show() {
        tg.log.push("show");
        tg.visible = true;
      },
      hide() {
        tg.log.push("hide");
        tg.visible = false;
      },
      onClick(cb: () => void) {
        tg.log.push("onClick");
        tg.handlers.push(cb);
      },
      offClick(cb: () => void) {
        tg.log.push("offClick");
        tg.handlers = tg.handlers.filter((x) => x !== cb);
      },
    },
    enableClosingConfirmation() {
      tg.log.push("confirm:on");
    },
    disableClosingConfirmation() {
      tg.log.push("confirm:off");
    },
  };
}

/** A Telegram webview tab at `path` (launch fragment included), engine fresh. */
function fresh(path: string, opts: { webview?: boolean } = {}) {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path + HASH);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
  tg = { log: [], visible: false, handlers: [] };
  if (opts.webview !== false) win.TelegramWebviewProxy = { postEvent() {} };
  // Signed in already: the bridge does not try to log in.
  useAppStore.setState({ sessionChecked: true, loggedIn: true });
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
});

const ctl: Record<string, (v: never) => void> = {};
const closes: string[] = [];

function Dialog() {
  const [open, setOpen] = useState(false);
  ctl.dialog = setOpen as (v: never) => void;
  const ref = useDialog(open, () => {
    closes.push("dialog");
    setOpen(false);
  });
  return open ? h("div", { ref, role: "dialog" }, h("button", null, "x")) : null;
}

function Editor() {
  const [pending, setPending] = useState(0);
  ctl.pending = setPending as (v: never) => void;
  useLeaveGuard(pending, async () => true);
  return null;
}

function App(props: { path: string }) {
  const [path, setPath] = useState(props.path);
  ctl.path = setPath as (v: never) => void;
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(PathnameContext.Provider, { value: path }, h(Fragment, null, h(Dialog), h(Editor), h(MiniAppBridge))),
  );
}

async function mount(path: string, version = "8.0", strict = false) {
  closes.length = 0;
  const app = h(App, { path });
  render(strict ? h(StrictMode, null, app) : app);
  await act(async () => {});
  // telegram-web-app.js runs: expose WebApp, then the tag's `load`.
  win.Telegram = { WebApp: webApp(version) };
  const tag = document.querySelector(`script[src="${SRC}"]`);
  await act(async () => {
    tag?.dispatchEvent(new window.Event("load"));
    await new Promise((r) => setTimeout(r, 10));
  });
  await settle();
}

test("non-root page: BackButton shown; click with no overlay → backTo (fresh deep link → parent, replace)", async () => {
  fresh("/uz/create");
  await mount("/uz/create");
  assert.equal(tg.visible, true);
  assert.equal(tg.handlers.length, 1);
  await act(async () => {
    tg.handlers[0]!();
  });
  await settle();
  assert.deepEqual(calls, ["replace /uz"]);
  assert.equal(here(), "/uz");
  // The route is now a root: hidden (Android back then closes the Mini App).
  act(() => ctl.path!("/uz" as never));
  await settle();
  assert.equal(tg.visible, false);
});

test("root page: hidden; an overlay shows it; click closes the overlay only (history.back)", async () => {
  fresh("/uz");
  await mount("/uz");
  assert.equal(tg.visible, false);
  assert.ok(tg.log.includes("hide"));
  act(() => ctl.dialog!(true as never));
  await settle();
  assert.equal(tg.visible, true, "overlay open at a root");
  await act(async () => {
    tg.handlers[0]!();
  });
  await settle();
  assert.deepEqual(closes, ["dialog"]);
  assert.equal(here(), "/uz");
  assert.deepEqual(calls, [], "no route change");
  assert.equal(tg.visible, false);
});

test("in-app history: click goes back instead of replacing", async () => {
  fresh("/uz");
  router.push("/uz/files/7" + HASH);
  calls.length = 0;
  await mount("/uz/files/7");
  await act(async () => {
    tg.handlers[0]!();
  });
  await settle();
  assert.equal(here(), "/uz");
  assert.deepEqual(calls, []);
});

test("unmount removes the handler with offClick", async () => {
  fresh("/uz/create");
  await mount("/uz/create");
  assert.equal(tg.handlers.length, 1);
  cleanup();
  assert.equal(tg.handlers.length, 0);
  assert.ok(tg.log.includes("offClick"));
});

test("StrictMode: one live handler after the double mount", async () => {
  fresh("/uz/create");
  await mount("/uz/create", "8.0", true);
  assert.equal(tg.handlers.length, 1);
  assert.equal(tg.visible, true);
});

test("closing confirmation follows pending edits", async () => {
  fresh("/uz/files/1");
  await mount("/uz/files/1");
  assert.ok(tg.log.includes("confirm:off"));
  act(() => ctl.pending!(2 as never));
  await settle();
  assert.equal(tg.log.at(-1), "confirm:on");
  act(() => ctl.pending!(0 as never));
  await settle();
  assert.equal(tg.log.at(-1), "confirm:off");
});

test("old client (6.0): BackButton and closing confirmation are never touched", async () => {
  fresh("/uz/create");
  await mount("/uz/create", "6.0");
  act(() => ctl.pending!(1 as never));
  await settle();
  assert.deepEqual(tg.log, []);
});

test("6.1 client: BackButton yes, closing confirmation (6.2) no", async () => {
  fresh("/uz/create");
  await mount("/uz/create", "6.1");
  act(() => ctl.pending!(1 as never));
  await settle();
  assert.ok(tg.log.includes("show"));
  assert.ok(!tg.log.some((l) => l.startsWith("confirm")));
});

test("ordinary browser (no webview signal): inert, the stub is never called", async () => {
  fresh("/uz/create", { webview: false });
  await mount("/uz/create");
  assert.deepEqual(tg.log, []);
  assert.ok(!document.querySelector(`script[src="${SRC}"]`));
});
