import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Bot keyboard links in `MiniAppBridge` (docs/bot/PLAN.md Q1): `?bt=` is
 * exchanged once at `POST /api/auth/bot-link` after the session check — in a
 * keyboard-launched Telegram webview (empty initData) and in a plain browser —
 * and removed from the URL without a new history entry; «Kirish…» while it
 * runs; an expired link shows «botga qayting»; another account is switched
 * only after «O'tish». `fetch` is stubbed.
 */

const { MiniAppBridge } = await import("../../components/telegram/MiniAppBridge.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const navMod = await import("../../lib/nav/history.ts");

const SRC = "https://telegram.org/js/telegram-web-app.js";
type W = Record<string, unknown>;
const win = window as unknown as W;

/** A version-1-shaped token for `id` (the MAC is the server's business). */
function token(id: number): string {
  const b = Buffer.alloc(29, 7);
  b.writeUInt8(1, 0);
  b.writeUInt32BE(Math.floor(id / 2 ** 32), 1);
  b.writeUInt32BE(id % 2 ** 32, 5);
  return b.toString("base64url");
}
const OWNER = 7012345678;
const BT = token(OWNER);

const base = {
  id: "u1", telegramId: String(OWNER), username: "ali", name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 0, university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "",
  teacher: "", city: "", position: "", organization: "", phone: null, isAdmin: false,
};
const other = { ...base, id: "u2", telegramId: "77", name: "Boshqa", username: "boshqa" };
const phoneUser = { ...base, id: "u3", telegramId: null, name: "Telefon", username: null };

let posts: Array<Record<string, unknown>> = [];
let tgPosts = 0;
let refreshed = 0;
/** Answers for successive bot-link POSTs (status + body); the last one repeats. */
let answers: Array<{ status: number; body: Record<string, unknown> }> = [];
let gate: Promise<void> | null = null;
const router: AppRouterInstance = {
  back() {}, forward() {}, refresh() { refreshed++; }, push() {}, replace() {}, prefetch() {},
};
const realFetch = globalThis.fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type TestUser = Omit<typeof base, "telegramId" | "username"> & { telegramId: string | null; username: string | null };
function setup(opts: { url: string; session?: TestUser | null; sessionChecked?: boolean; webview?: boolean }) {
  posts = [];
  tgPosts = 0;
  refreshed = 0;
  gate = null;
  answers = [{ status: 200, body: { user: base } }];
  window.history.replaceState(null, "", opts.url);
  if (opts.webview) win.TelegramWebviewProxy = { postEvent() {} };
  useAppStore.setState({
    sessionChecked: opts.sessionChecked ?? true,
    loggedIn: Boolean(opts.session),
    user: (opts.session ?? null) as never,
    features: { telegramBot: "SlaydxTestBot" } as never,
  });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/bot-link" && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      if (gate) await gate;
      const a = answers[Math.min(posts.length - 1, answers.length - 1)]!;
      return json(a.status, a.body);
    }
    if (url === "/api/auth/telegram") {
      tgPosts++;
      return json(200, { user: base });
    }
    return json(200, { generations: [] });
  };
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  delete win.TelegramWebviewProxy;
  delete win.Telegram;
  for (const s of document.querySelectorAll(`script[src="${SRC}"]`)) s.remove();
  window.history.replaceState(null, "", "/");
  useUi.setState({ overlay: null, returnTo: null });
  navMod.__resetNavForTests();
});

async function settle(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function mount(strict = false) {
  const tree = h(AppRouterContext.Provider, { value: router }, h(MiniAppBridge));
  render(strict ? h(StrictMode, null, tree) : tree);
  await settle();
}
const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
const notice = () => document.querySelector("[data-bot-link-notice]");
const busy = () => document.querySelector("[data-bot-link-busy]");
const switchDialog = () => document.querySelector("[data-account-switch]");

test("plain browser, no session: one exchange, signed in, bt removed (other params kept) without a new history entry", async () => {
  navMod.installNav();
  setup({ url: `/uz/slide?x=1&bt=${BT}&y=2` });
  const len = window.history.length;
  const index = navMod.getNavSnapshot().index;
  await mount(true);
  assert.equal(posts.length, 1, "MUTATION: StrictMode double effect sent two exchanges / none");
  assert.deepEqual(posts[0], { token: BT });
  assert.equal(here(), "/uz/slide?x=1&y=2", "MUTATION: the token stays in the address bar");
  assert.equal(window.history.length, len, "replaceState, not pushState");
  assert.equal(navMod.getNavSnapshot().index, index, "the nav engine sees no new entry");
  assert.equal(useAppStore.getState().loggedIn, true);
  assert.equal(useAppStore.getState().user?.id, "u1");
  assert.equal(refreshed, 1, "server components re-rendered");
  assert.ok(!busy(), "«Kirish…» gone");
  assert.ok(!notice());
});

test("«Kirish…» shows while the exchange runs; nothing is sent before the session check", async () => {
  setup({ url: `/uz/slide?bt=${BT}`, sessionChecked: false });
  let open!: () => void;
  gate = new Promise((r) => (open = r));
  await mount();
  assert.equal(posts.length, 0, "waits for the session check");
  assert.equal(here(), "/uz/slide", "removed from the URL right away");
  await act(async () => {
    useAppStore.setState({ sessionChecked: true });
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(posts.length, 1);
  assert.ok(busy(), "MUTATION: no «Kirish…» state");
  assert.match(busy()!.textContent ?? "", /Kirish…/);
  assert.equal(busy()!.getAttribute("role"), "status");
  await act(async () => {
    open();
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.ok(!busy());
  assert.equal(useAppStore.getState().loggedIn, true);
});

test("expired link (401) → «Kirish havolasi eskirgan» with a way back to the bot; not signed in", async () => {
  setup({ url: `/uz/slide?bt=${BT}` });
  answers = [{ status: 401, body: { error: "Kirish havolasi eskirgan.", code: "bot_link_expired" } }];
  await mount();
  assert.equal(posts.length, 1);
  assert.ok(notice(), "MUTATION: the expired state is not shown");
  assert.match(notice()!.textContent ?? "", /Kirish havolasi eskirgan/);
  assert.match(notice()!.textContent ?? "", /Botga qayting va \/start bosing/);
  const a = document.querySelector<HTMLAnchorElement>("[data-bot-link-bot]");
  assert.ok(a);
  assert.equal(a!.getAttribute("href"), "https://t.me/SlaydxTestBot");
  assert.equal(useAppStore.getState().loggedIn, false);
  assert.equal(here(), "/uz/slide");
  await act(async () => {
    (document.querySelector("[data-bot-link-close]") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.ok(!notice(), "«Yopish» closes it");
  assert.equal(posts.length, 1, "no retry loop");
});

test("inside Telegram the bot button opens the chat with openTelegramLink", async () => {
  setup({ url: `/uz/slide?bt=${BT}#tgWebAppVersion=8.0&tgWebAppPlatform=android`, webview: true });
  answers = [{ status: 401, body: { error: "x", code: "bot_link_invalid" } }];
  await mount();
  const opened: string[] = [];
  win.Telegram = { WebApp: { initData: "", openTelegramLink: (u: string) => opened.push(u) } };
  await settle();
  await act(async () => {
    document.querySelector<HTMLAnchorElement>("[data-bot-link-bot]")!.click();
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.deepEqual(opened, ["https://t.me/SlaydxTestBot"]);
});

test("keyboard launch (webview + Telegram launch params, no initData): the Mini App shell loads AND the link is exchanged", async () => {
  setup({ url: `/uz/slide?bt=${BT}#tgWebAppVersion=8.0&tgWebAppPlatform=android`, webview: true });
  await mount();
  assert.ok(document.querySelector(`script[src="${SRC}"]`), "telegram-web-app.js injected for the shell");
  assert.equal(posts.length, 1);
  assert.equal(here(), "/uz/slide#tgWebAppVersion=8.0&tgWebAppPlatform=android", "Telegram's fragment kept");
  // Telegram's script runs: empty initData → no initData login.
  win.Telegram = { WebApp: { initData: "", ready() {}, expand() {} } };
  await act(async () => {
    document.querySelector(`script[src="${SRC}"]`)!.dispatchEvent(new window.Event("load"));
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.equal(tgPosts, 0);
});

test("genuine Mini App with signed launch data: initData logs in, the bt token is only removed", async () => {
  const init = "query_id=AAH1&user=%7B%22id%22%3A42%7D&auth_date=1790000000&hash=abc123";
  setup({ url: `/uz/slide?bt=${BT}#tgWebAppData=${encodeURIComponent(init)}&tgWebAppVersion=8.0`, webview: true });
  await mount();
  assert.equal(posts.length, 0, "MUTATION: the token was used next to signed launch data");
  assert.equal(window.location.search, "");
});

test("already signed in as the link owner, or with a phone login: no request, URL cleaned", async () => {
  for (const session of [base, phoneUser]) {
    setup({ url: `/uz/slide?bt=${BT}`, session });
    await mount();
    assert.equal(posts.length, 0, `MUTATION: needless exchange for ${session.name}`);
    assert.equal(here(), "/uz/slide");
    cleanup();
  }
});

test("another Telegram account signed in: 409 switch_confirm → asks; «O'tish» sends confirm:true and switches", async () => {
  setup({ url: `/uz/slide?bt=${BT}`, session: other });
  useAppStore.setState({ generations: [{ id: "g-of-77" }] as never, generationsLoaded: true });
  answers = [
    { status: 409, body: { error: "Tasdiqlang", code: "switch_confirm", to: "Ali (@ali)" } },
    { status: 200, body: { user: base } },
  ];
  await mount();
  assert.equal(posts.length, 1);
  assert.ok(switchDialog(), "MUTATION: no confirm prompt");
  assert.match(document.querySelector("[data-switch-text]")?.textContent ?? "", /Boshqa \(@boshqa\).*Ali \(@ali\)/);
  assert.equal(useAppStore.getState().user?.id, "u2", "nothing changes while asking");
  await act(async () => {
    (document.querySelector("[data-switch-go]") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1], { token: BT, confirm: true });
  assert.equal(useAppStore.getState().user?.id, "u1");
  assert.ok(!useAppStore.getState().generations.some((g) => g.id === "g-of-77"), "the other account's files are gone");
  assert.ok(!switchDialog());
});

test("«Yo'q, qolaman» on the switch prompt: no second request, session kept", async () => {
  setup({ url: `/uz/slide?bt=${BT}`, session: other });
  answers = [{ status: 409, body: { error: "Tasdiqlang", code: "switch_confirm", to: "Ali" } }];
  await mount();
  await act(async () => {
    (document.querySelector("[data-switch-stay]") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(posts.length, 1);
  assert.equal(useAppStore.getState().user?.id, "u2");
  assert.ok(!switchDialog());
});

test("a malformed or repeated bt is removed and never sent; no bt → nothing at all", async () => {
  for (const url of ["/uz/slide?bt=a%20b&x=1", `/uz/slide?bt=${BT}&bt=${BT}&x=1`]) {
    setup({ url });
    await mount();
    assert.equal(posts.length, 0, url);
    assert.equal(here(), "/uz/slide?x=1", url);
    cleanup();
  }
  setup({ url: "/uz/slide?x=1" });
  const len = window.history.length;
  await mount();
  assert.equal(posts.length, 0);
  assert.equal(window.history.length, len);
  assert.equal(here(), "/uz/slide?x=1");
});
