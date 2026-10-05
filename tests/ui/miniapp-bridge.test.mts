import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * `MiniAppBridge` in a DOM: a plain browser with a crafted `#tgWebAppData`
 * loads nothing and logs nobody in (FE-10); a Telegram webview loads the
 * script, calls ready()/expand() and logs in once when there is no session;
 * an existing session (any user) is kept. `fetch` is stubbed; jsdom never
 * downloads the external script, its `load` is simulated.
 */

const { MiniAppBridge } = await import("../../components/telegram/MiniAppBridge.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { isMiniAppUserMismatch } = await import("../../lib/telegram-webapp.ts");

const SRC = "https://telegram.org/js/telegram-web-app.js";
const INIT = "query_id=AAH1&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Ali%22%7D&auth_date=1790000000&hash=abc123";
const HASH = `#tgWebAppData=${encodeURIComponent(INIT)}&tgWebAppVersion=8.0&tgWebAppPlatform=android`;

type W = Record<string, unknown>;
const win = window as unknown as W;

const user = {
  id: "u1", telegramId: "42", username: "ali", name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 0, university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "",
  teacher: "", city: "", position: "", organization: "", phone: null, isAdmin: false,
};
const other = { ...user, id: "u2", telegramId: "77", name: "Boshqa" };

let posts: string[] = [];
let refreshed = 0;
const pushed: string[] = [];
const replaced: string[] = [];
let logouts = 0;
let loginStatus = 200;
let loginCode: string | null = null;
/** When set, `/api/auth/telegram` waits for it (the switch in flight). */
let loginGate: Promise<void> | null = null;
/** `/api/generations` answers 503 (the list cannot be re-fetched): the store must still drop the old list. */
let listDown = false;
const router: AppRouterInstance = {
  back() {}, forward() {}, refresh() { refreshed++; }, push(href: string) { pushed.push(href); },
  replace(href: string) { replaced.push(href); }, prefetch() {},
};
const realFetch = globalThis.fetch;

function setup(opts: { webview: boolean; session: typeof user | null }) {
  posts = [];
  refreshed = 0;
  pushed.length = 0;
  replaced.length = 0;
  logouts = 0;
  loginStatus = 200;
  loginCode = null;
  loginGate = null;
  listDown = false;
  window.location.hash = HASH;
  if (opts.webview) win.TelegramWebviewProxy = { postEvent() {} };
  useAppStore.setState({ sessionChecked: true, loggedIn: Boolean(opts.session), user: opts.session as never });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/telegram" && init?.method === "POST") {
      posts.push(String(init.body));
      if (loginGate) await loginGate;
      if (loginStatus !== 200) {
        const error = loginCode === "switch_stale" ? "Telegram ma'lumotlari eskirgan. Mini ilovani yopib, qayta oching." : "Telegram imzosi tekshiruvdan o'tmadi";
        return new Response(JSON.stringify({ error, ...(loginCode ? { code: loginCode } : {}) }), { status: loginStatus, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ user }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("/api/auth/session") && init?.method === "DELETE") {
      logouts++;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (listDown) return new Response(JSON.stringify({ error: "down" }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ generations: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

const afterEachHooks: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const f of afterEachHooks.splice(0)) f();
  globalThis.fetch = realFetch;
  delete win.TelegramWebviewProxy;
  delete win.Telegram;
  for (const s of document.querySelectorAll(`script[src="${SRC}"]`)) s.remove();
  window.location.hash = "";
  useUi.setState({ overlay: null, returnTo: null });
});

const scriptTag = () => document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);

async function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(MiniAppBridge)));
  await act(async () => {});
}

/** What `telegram-web-app.js` does when it runs: expose `Telegram.WebApp`, then the tag fires `load`. */
async function scriptLoads() {
  const calls: string[] = [];
  win.Telegram = { WebApp: { initData: INIT, ready: () => calls.push("ready"), expand: () => calls.push("expand") } };
  await act(async () => {
    scriptTag()!.dispatchEvent(new window.Event("load"));
    await new Promise((r) => setTimeout(r, 20));
  });
  return calls;
}

test("plain browser + crafted #tgWebAppData: no script tag, no login request", async () => {
  setup({ webview: false, session: null });
  await mount();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  assert.ok(!scriptTag(), "telegram-web-app.js not loaded for a normal visitor");
  assert.equal(posts.length, 0);
  assert.equal(useAppStore.getState().loggedIn, false);
});

test("Telegram webview + no session: loads the script, ready()/expand(), logs in once with initData", async () => {
  setup({ webview: true, session: null });
  await mount();
  const tag = scriptTag();
  assert.ok(tag, "script injected");
  assert.equal(tag!.async, true);
  assert.equal(posts.length, 0, "no login before the script ran");
  const calls = await scriptLoads();
  assert.deepEqual(calls, ["ready", "expand"]);
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0]!), { initData: INIT });
  assert.equal(useAppStore.getState().loggedIn, true);
  assert.equal(useAppStore.getState().user?.telegramId, "42");
  assert.equal(refreshed, 1, "server components refreshed like LoginModal");

  // Sign-out inside the Mini App: no silent re-login in the same page load.
  await act(async () => {
    useAppStore.setState({ loggedIn: false, user: null });
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(posts.length, 1, "one attempt per page load");
});

test("Telegram webview + login overlay open: overlay closes and returnTo is followed", async () => {
  setup({ webview: true, session: null });
  useUi.setState({ overlay: "login", returnTo: "/uz/create" });
  await mount();
  await scriptLoads();
  assert.equal(posts.length, 1);
  assert.equal(useUi.getState().overlay, null);
  assert.deepEqual(pushed, ["/uz/create"]);
});

test("Telegram webview + the same user already signed in: no login call", async () => {
  setup({ webview: true, session: user });
  await mount();
  const calls = await scriptLoads();
  assert.deepEqual(calls, ["ready", "expand"], "the WebApp is still initialised");
  assert.equal(posts.length, 0);
});

const dialog = () => document.querySelector("[data-account-switch]");
async function tap(sel: string) {
  await act(async () => {
    (document.querySelector(sel) as HTMLButtonElement | null)?.click();
    await new Promise((r) => setTimeout(r, 30));
  });
}

test("DIFFERENT Telegram user signed in: asks first — no request until «O'tish» (security review B1)", async () => {
  setup({ webview: true, session: other });
  await mount();
  await scriptLoads();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.ok(dialog(), "confirm dialog shown");
  assert.equal(posts.length, 0, "MUTATION: the switch went out silently");
  const text = document.querySelector("[data-switch-text]")?.textContent ?? "";
  assert.match(text, /Siz hozir Boshqa \(@ali\) sifatida kirgansiz\. Telegram'dagi Ali akkauntiga o'tasizmi\?/);
  assert.ok(document.querySelector("[data-switch-go]") && document.querySelector("[data-switch-stay]"));
  assert.equal(useAppStore.getState().user?.telegramId, "77", "nothing changes while asking");
});

test("«O'tish»: switches to the Mini App user, old state cleared, home rendered; mismatch guard holds while in flight", async () => {
  setup({ webview: true, session: other });
  useAppStore.setState({ generations: [{ id: "g-of-77" }] as never, generationsLoaded: true });
  useUi.setState({ overlay: "notifications", returnTo: null });
  let open!: () => void;
  loginGate = new Promise((r) => (open = r));
  listDown = true;
  await mount();
  await scriptLoads();
  await tap("[data-switch-go]");
  assert.equal(posts.length, 1, "one switch request after the tap");
  // In flight: the old account stays in the store, so «Saqlash»/«Ulashish» refuse (mismatch).
  assert.equal(useAppStore.getState().user?.telegramId, "77");
  assert.equal(isMiniAppUserMismatch(useAppStore.getState().user?.telegramId, "42"), true);
  await act(async () => {
    open();
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.deepEqual(JSON.parse(posts[0]!), { initData: INIT });
  assert.equal(useAppStore.getState().user?.telegramId, "42", "now the Mini App user");
  assert.ok(!useAppStore.getState().generations.some((g) => g.id === "g-of-77"), "the other account's files are gone");
  assert.equal(useUi.getState().overlay, null, "overlay of the other account closed");
  assert.ok(!dialog(), "dialog closed");
  assert.deepEqual(replaced, ["/uz"]);
  assert.ok(refreshed >= 1, "server components re-rendered for the new user");
  // No loop: the id was tried once.
  await act(async () => {
    useAppStore.setState({ user: other as never });
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(posts.length, 1, "one attempt per Mini App user id per page load");
  assert.ok(!dialog(), "not asked again");
});

test("«Yo'q, qolaman»: session kept, no request, not asked again this page load, Saqlash/Ulashish stay blocked", async () => {
  setup({ webview: true, session: other });
  await mount();
  await scriptLoads();
  await tap("[data-switch-stay]");
  assert.ok(!dialog());
  assert.equal(posts.length, 0);
  assert.equal(logouts, 0);
  assert.equal(useAppStore.getState().user?.telegramId, "77", "still the signed-in account");
  assert.equal(isMiniAppUserMismatch(useAppStore.getState().user?.telegramId, "42"), true, "mismatch keeps blocking delivery");
  await act(async () => {
    useAppStore.setState({ user: { ...other } as never });
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.ok(!dialog(), "MUTATION: asked again after «Yo'q»");
});

test("phone back / Escape on the prompt = «Yo'q, qolaman»", async () => {
  setup({ webview: true, session: other });
  await mount();
  await scriptLoads();
  assert.ok(dialog());
  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.ok(!dialog(), "closed");
  assert.equal(posts.length, 0);
  assert.equal(useAppStore.getState().user?.telegramId, "77");
});

test("phone back (history pop) on the prompt = «Yo'q, qolaman»", async () => {
  const navMod = await import("../../lib/nav/history.ts");
  navMod.__resetNavForTests();
  navMod.installNav();
  navMod.setNavRouter(router);
  afterEachHooks.push(() => navMod.__resetNavForTests());
  setup({ webview: true, session: other });
  await mount();
  await scriptLoads();
  assert.ok(dialog());
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 60));
  });
  assert.ok(!dialog(), "MUTATION: back did not close the prompt");
  assert.equal(posts.length, 0);
  assert.equal(useAppStore.getState().user?.telegramId, "77");
});

test("«O'tish» refused by the server (409 switch_stale): calm message, session kept, not signed out", async () => {
  setup({ webview: true, session: other });
  loginStatus = 409;
  loginCode = "switch_stale";
  await mount();
  await scriptLoads();
  await tap("[data-switch-go]");
  assert.equal(posts.length, 1);
  assert.match(document.querySelector("[data-switch-text]")?.textContent ?? "", /eskirgan/);
  assert.equal(logouts, 0);
  assert.equal(useAppStore.getState().user?.telegramId, "77");
  await tap("[data-switch-ok]");
  assert.ok(!dialog());
  assert.deepEqual(replaced, []);
});

test("«O'tish» then 401: signed out and sent to login, never the other account", async () => {
  setup({ webview: true, session: other });
  loginStatus = 401;
  await mount();
  await scriptLoads();
  await tap("[data-switch-go]");
  assert.equal(posts.length, 1);
  assert.equal(logouts, 1, "this webview's session is ended");
  assert.equal(useAppStore.getState().loggedIn, false);
  assert.equal(useAppStore.getState().user, null);
  assert.deepEqual(replaced, ["/uz/login"]);
});

test("Telegram webview + an account without Telegram (phone login) signed in: kept, no request", async () => {
  setup({ webview: true, session: { ...other, telegramId: null } as never });
  await mount();
  await scriptLoads();
  assert.equal(posts.length, 0);
  assert.equal(useAppStore.getState().user?.id, "u2");
});

test("Telegram webview but the session check has not answered: waits, then logs in", async () => {
  setup({ webview: true, session: null });
  useAppStore.setState({ sessionChecked: false });
  await mount();
  await scriptLoads();
  assert.equal(posts.length, 0, "unknown session: no call yet");
  await act(async () => {
    useAppStore.setState({ sessionChecked: true });
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(posts.length, 1);
});
