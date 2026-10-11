import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * Client side of the bearer fallback (docs/auth/COOKIELESS.md) against a
 * simulated server that keeps real session state: in "refuse" mode the
 * webview never stores the cookie (the Telegram Desktop report), in "accept"
 * mode it does. Covers `loginExchange` (probe → opt-in retry), the
 * `Authorization` header on later calls, storage fallback, OTP, 401/logout,
 * admin paths, `useApiSrc`, and the MiniAppBridge «Kirish» dialog flow.
 */

const api = await import("../../lib/api-client.ts");
const transport = await import("../../lib/session-transport.ts");
const { useApiSrc } = await import("../../lib/use-api-src.tsx");
const { MiniAppBridge } = await import("../../components/telegram/MiniAppBridge.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const navMod = await import("../../lib/nav/history.ts");

const base = {
  id: "u1", telegramId: "7012345678", username: "ali", name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 0, university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "",
  teacher: "", city: "", position: "", organization: "", phone: null, isAdmin: false,
};

/** A version-1-shaped bot link token for `id` (the MAC is the server's business). */
function linkToken(id: number): string {
  const b = Buffer.alloc(29, 7);
  b.writeUInt8(1, 0);
  b.writeUInt32BE(Math.floor(id / 2 ** 32), 1);
  b.writeUInt32BE(id % 2 ** 32, 5);
  return b.toString("base64url");
}

type Seen = { url: string; method: string; auth: string | null; transport: string | null; body: unknown };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;

/** A server with real session state; `cookies: false` = the webview drops every Set-Cookie. */
function server(opts: { cookies: boolean }) {
  const s = { jar: null as string | null, sessions: new Map<string, string>(), seen: [] as Seen[], n: 0 };
  const issue = (bearer: boolean) => {
    const t = `T${++s.n}`.padEnd(43, "x");
    s.sessions.set(t, "u1");
    if (opts.cookies) s.jar = t;
    return bearer ? { user: base, sessionToken: t } : { user: base };
  };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const auth = headers.get("authorization");
    const optIn = headers.get("x-session-transport") === "bearer";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    s.seen.push({ url, method: init?.method ?? "GET", auth, transport: headers.get("x-session-transport"), body });
    const cookieUser = s.jar ? s.sessions.get(s.jar) : undefined;
    const bearerUser = auth?.startsWith("Bearer ") ? s.sessions.get(auth.slice(7)) : undefined;
    const current = cookieUser ?? bearerUser ?? null;
    if (url === "/api/auth/bot-link") {
      if (!body.confirm) return json(409, { error: "Kirishni tasdiqlang.", code: "login_confirm", to: "Ali (@ali)" });
      return json(200, issue(optIn));
    }
    if (url === "/api/auth/telegram") return json(200, issue(optIn));
    if (url === "/api/auth/otp?action=verify") {
      if (body.code !== "12345") return json(401, { error: "Kod noto'g'ri" });
      body.code = null;
      return json(200, issue(optIn));
    }
    if (url === "/api/auth/session" && (init?.method ?? "GET") === "GET") return json(200, { user: current ? base : null, features: {} });
    if (url.startsWith("/api/auth/session") && init?.method === "DELETE") {
      if (auth) s.sessions.delete(auth.slice(7));
      return json(200, { ok: true });
    }
    if (url.startsWith("/api/admin/")) return json(404, { error: "Topilmadi" });
    if (url.startsWith("/api/")) {
      if (!current) return json(401, { error: "Kirish talab qilinadi" });
      if (url.startsWith("/api/generations/") && url.includes("/assets/")) return new Response(new Blob(["png"]), { status: 200 });
      return json(200, { generations: [], nextCursor: null });
    }
    return json(404, {});
  }) as typeof fetch;
  return s;
}

function reset() {
  try {
    window.sessionStorage.clear();
  } catch {
    /* blocked in one test */
  }
  transport.__resetSessionTransportForTests();
}
beforeEach(reset);
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  reset();
});

test("cookies accepted: one exchange, probe confirms → no bearer mode, later calls carry no Authorization", async () => {
  const s = server({ cookies: true });
  const { user } = await api.botLinkLogin("bt", true);
  assert.equal(user.id, "u1");
  assert.equal(s.seen.filter((x) => x.url === "/api/auth/bot-link").length, 1, "MUTATION: retried although cookies work");
  assert.ok(s.seen.every((x) => x.transport === null), "never opts in");
  assert.equal(transport.bearerToken(), null);
  await api.listGenerations();
  assert.equal(s.seen.at(-1)!.auth, null);
  assert.equal(window.sessionStorage.getItem("slaydx-session-bearer"), null);
});

test("cookies refused: probe says signed out → one opt-in retry → token → every later consumer call carries Authorization", async () => {
  const s = server({ cookies: false });
  const answer = await api.botLinkLogin("bt", true);
  const logins = s.seen.filter((x) => x.url === "/api/auth/bot-link");
  assert.equal(logins.length, 2, "MUTATION: the client never switches to bearer");
  assert.equal(logins[0]!.transport, null, "first attempt: cookie transport");
  assert.equal(logins[1]!.transport, "bearer", "retry opts in");
  assert.deepEqual(logins[1]!.body, { token: "bt", confirm: true }, "the confirmed exchange is repeated as is");
  assert.equal("sessionToken" in answer, false, "the token never leaves loginExchange");
  const token = transport.bearerToken();
  assert.match(token ?? "", /^T2x+$/);
  assert.equal(window.sessionStorage.getItem("slaydx-session-bearer"), token, "mirrored to sessionStorage");
  await api.listGenerations();
  assert.equal(s.seen.at(-1)!.auth, `Bearer ${token}`);
  await api.fetchMe();
  assert.equal(s.seen.at(-1)!.auth, `Bearer ${token}`);
  // Admin stays cookie-only.
  await api.request("/api/admin/session").catch(() => {});
  assert.equal(s.seen.at(-1)!.url, "/api/admin/session");
  assert.equal(s.seen.at(-1)!.auth, null, "admin calls never get the bearer");
  // A later login in this tab opts in on the first attempt (no orphan cookie session).
  await api.loginWithTelegram({ initData: "x" });
  const tg = s.seen.filter((x) => x.url === "/api/auth/telegram");
  assert.equal(tg.length, 1);
  assert.equal(tg[0]!.transport, "bearer");
});

test("sessionStorage unavailable: memory-only bearer mode still works", async () => {
  const desc = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
  Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  try {
    transport.__resetSessionTransportForTests();
    const s = server({ cookies: false });
    await api.loginWithTelegram({ initData: "x" });
    assert.ok(transport.bearerToken(), "token kept in memory");
    await api.listGenerations();
    assert.equal(s.seen.at(-1)!.auth, `Bearer ${transport.bearerToken()}`);
  } finally {
    Object.defineProperty(window, "sessionStorage", desc);
  }
});

test("OTP is single use: refused cookie → clear message, no second verify; the next verify opts in at once", async () => {
  const s = server({ cookies: false });
  await assert.rejects(api.verifyOtp("+998900000001", "12345"), (e: unknown) => {
    assert.ok(e instanceof api.ApiError);
    assert.equal(e.message, api.COOKIES_REFUSED_OTP_TEXT);
    return true;
  });
  assert.equal(s.seen.filter((x) => x.url.startsWith("/api/auth/otp")).length, 1, "the consumed code is never re-sent");
  assert.equal(transport.bearerToken(), null);
  await api.verifyOtp("+998900000001", "12345");
  const verifies = s.seen.filter((x) => x.url.startsWith("/api/auth/otp"));
  assert.equal(verifies.length, 2);
  assert.equal(verifies[1]!.transport, "bearer");
  assert.ok(transport.bearerToken());
});

test("a 401 on a consumer call drops the token; logout sends it and then forgets it", async () => {
  const s = server({ cookies: false });
  await api.botLinkLogin("bt", true);
  const token = transport.bearerToken()!;
  await api.logout();
  const del = s.seen.find((x) => x.method === "DELETE")!;
  assert.equal(del.auth, `Bearer ${token}`, "the server can revoke the bearer row");
  assert.equal(transport.bearerToken(), null, "MUTATION: token survives logout");

  await api.botLinkLogin("bt", true);
  s.sessions.clear(); // revoked server-side (logout elsewhere / admin)
  await assert.rejects(api.listGenerations());
  assert.equal(transport.bearerToken(), null, "a refused token is dropped");
});

test("useApiSrc: unchanged URL in cookie mode; a blob: URL fetched with the header in bearer mode; foreign URLs untouched", async () => {
  const urls: string[] = [];
  const u = URL as unknown as { createObjectURL?: unknown };
  const realCreate = u.createObjectURL;
  u.createObjectURL = () => "blob:http://localhost/1";
  function Probe({ src }: { src: string }) {
    urls.push(useApiSrc(src) ?? "(pending)");
    return null;
  }
  try {
    const s = server({ cookies: false });
    render(h(Probe, { src: "/api/generations/g1/assets/a1" }));
    assert.equal(urls.at(-1), "/api/generations/g1/assets/a1", "cookie mode: the original URL, synchronously");
    cleanup();
    await api.botLinkLogin("bt", true);
    urls.length = 0;
    render(h(Probe, { src: "/api/generations/g1/assets/a1" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    assert.equal(urls[0], "(pending)");
    assert.equal(urls.at(-1), "blob:http://localhost/1");
    const asset = s.seen.find((x) => x.url.includes("/assets/"))!;
    assert.equal(asset.auth, `Bearer ${transport.bearerToken()}`);
    cleanup();
    urls.length = 0;
    render(h(Probe, { src: "data:image/png;base64,AAAA" }));
    assert.equal(urls.at(-1), "data:image/png;base64,AAAA");
    assert.deepEqual(transport.bearerHeaders("https://evil.example/api/x"), {}, "never to another origin");
    assert.deepEqual(transport.bearerHeaders("//evil.example/api/x"), {});
  } finally {
    u.createObjectURL = realCreate;
  }
});

test("MiniAppBridge: «… sifatida kirasizmi?» → «Kirish» in a cookie-refusing webview ends signed in, file list loads with the bearer", async () => {
  navMod.__resetNavForTests();
  const s = server({ cookies: false });
  window.history.replaceState(null, "", `/uz?bt=${linkToken(7012345678)}`);
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null, features: { telegramBot: "SlaydxTestBot" } as never });
  let refreshed = 0;
  const router: AppRouterInstance = { back() {}, forward() {}, refresh() { refreshed++; }, push() {}, replace() {}, prefetch() {} };
  render(h(AppRouterContext.Provider, { value: router }, h(MiniAppBridge)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  const go = document.querySelector("[data-bot-login-go]") as HTMLButtonElement | null;
  if (!go) {
    // The token shape is the bridge's business: skip loudly rather than pass silently.
    assert.fail("login confirmation did not open");
  }
  await act(async () => {
    go.click();
    await new Promise((r) => setTimeout(r, 60));
  });
  assert.equal(useAppStore.getState().loggedIn, true, "MUTATION: signed out right after «Kirish»");
  assert.equal(useAppStore.getState().user?.id, "u1");
  assert.ok(!document.querySelector("[data-bot-login-confirm]"), "dialog closed");
  const gens = s.seen.filter((x) => x.url.startsWith("/api/generations"));
  assert.ok(gens.length >= 1, "the file list was requested");
  assert.ok(gens.every((x) => x.auth === `Bearer ${transport.bearerToken()}`), "with the bearer");
  assert.ok(refreshed >= 1);
  useUi.setState({ overlay: null, returnTo: null, linkLogin: false });
  useAppStore.setState({ loggedIn: false, user: null });
  window.history.replaceState(null, "", "/");
});
