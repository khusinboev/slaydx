import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { LoginForm } from "../../components/admin/shell/LoginForm.tsx";
import { EnrollForm } from "../../components/admin/shell/EnrollForm.tsx";
import { AccountPage, describeDevice } from "../../components/admin/shell/AccountPage.tsx";
import { AdminIdentityProvider } from "../../components/admin/shell/admin-identity.tsx";
import { recoveryFileText } from "../../components/admin/shell/RecoveryCodes.tsx";
import { fmtCountdown } from "../../components/admin/shell/auth-common.tsx";

/*
 * S1 login, S2 enrollment, S19 own account (docs/admin/02-plan.md §7.1):
 * real components against a stubbed `fetch`, asserting the exact requests
 * and what the admin sees.
 */
const { useToastStore } = createRequire(import.meta.url)("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

type Call = { url: string; method: string; body: unknown };
type Route = (call: Call) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useToastStore.getState().clear();
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Routes by `METHOD path` (query ignored); unknown requests fail the test. */
function stubFetch(routes: Record<string, Route | Route[]>): Call[] {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { url, method, body };
    calls.push(call);
    const key = `${method} ${url.split("?")[0]}`;
    const route = routes[key];
    assert.ok(route, `kutilmagan so'rov: ${key}`);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const fn = Array.isArray(route) ? route[Math.min(n, route.length - 1)] : route;
    return fn(call);
  }) as typeof fetch;
  return calls;
}

function makeRouter() {
  const replaced: string[] = [];
  let refreshed = 0;
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    prefetch() {},
    push() {},
    refresh: () => void refreshed++,
    replace: (href: string) => void replaced.push(href),
  };
  return { router, replaced, refreshed: () => refreshed };
}

function withRouter(node: ReactNode, router: AppRouterInstance, pathname = "/admin/login") {
  return h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: pathname }, node));
}

function codeInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"], input[placeholder="XXXX-XXXX-XX"]');
  assert.ok(el, "kod maydoni topilmadi");
  return el;
}

async function typeAndSubmit(value: string, button = "Kirish") {
  fireEvent.change(codeInput(), { target: { value } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: button }));
  });
}

const ADMIN = {
  id: "1",
  userId: "10",
  name: "Ali",
  username: "ali",
  role: "owner",
  permissions: ["dashboard.view", "self"],
  status: "active",
  totpEnabled: true,
};
const SESSION = { id: "5", expiresAt: "2026-10-02T20:00:00.000Z", idleExpiresAt: "2026-10-02T08:30:00.000Z", reauthUntil: null };

/* ───────────────────────────── S1 login ───────────────────────────── */

test("LoginForm: to'g'ri kod -> POST login va next sahifaga o'tish", async () => {
  const calls = stubFetch({ "POST /api/admin/auth/login": () => json(200, { admin: ADMIN, session: SESSION }) });
  const { router, replaced, refreshed } = makeRouter();
  render(withRouter(h(LoginForm, { next: "/admin/users?q=ali", userName: "Ali Valiyev" }), router));
  assert.ok(screen.getByText("Ali Valiyev"), "1-qadam: kim sifatida kirgani");
  const input = codeInput();
  assert.equal(input.getAttribute("autocomplete"), "one-time-code");
  assert.equal(input.getAttribute("inputmode"), "numeric");
  // Non-digits are dropped and the length is capped at 6.
  fireEvent.change(input, { target: { value: "12a34567" } });
  assert.equal(codeInput().value, "123456");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Kirish" }));
  });
  await waitFor(() => assert.deepEqual(replaced, ["/admin/users?q=ali"]));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { code: "123456" });
  assert.ok(refreshed() >= 1, "server layout yangi cookie bilan qayta chiziladi");
});

test("LoginForm: xavfli next prop ham /admin ga tushadi (ikkinchi qatlam)", async () => {
  stubFetch({ "POST /api/admin/auth/login": () => json(200, { admin: ADMIN, session: SESSION }) });
  const { router, replaced } = makeRouter();
  render(withRouter(h(LoginForm, { next: "//evil.example/admin", userName: "Ali" }), router));
  await typeAndSubmit("654321");
  await waitFor(() => assert.deepEqual(replaced, ["/admin"]));
});

test("LoginForm: noto'g'ri kod -> umumiy «Kod noto'g'ri», maydon tozalanadi, o'tish yo'q", async () => {
  stubFetch({ "POST /api/admin/auth/login": () => json(401, { error: "Server matni", code: "bad_code" }) });
  const { router, replaced } = makeRouter();
  render(withRouter(h(LoginForm, { next: "/admin", userName: "Ali" }), router));
  assert.equal((screen.getByRole("button", { name: "Kirish" }) as HTMLButtonElement).disabled, true, "6 raqamsiz tugma o'chiq");
  await typeAndSubmit("000000");
  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Kod noto'g'ri");
  assert.equal(codeInput().value, "");
  assert.deepEqual(replaced, []);
});

test("LoginForm: tiklash kodi rejimi -> POST recovery, katta harf, keyin qaytish", async () => {
  const calls = stubFetch({
    "POST /api/admin/auth/recovery": () => json(200, { admin: ADMIN, session: SESSION, remaining: 7 }),
  });
  const { router, replaced } = makeRouter();
  render(withRouter(h(LoginForm, { next: "/admin/account", userName: "Ali" }), router));
  fireEvent.click(screen.getByRole("button", { name: "Tiklash kodi bilan kirish" }));
  const input = codeInput();
  assert.equal(input.getAttribute("placeholder"), "XXXX-XXXX-XX");
  assert.notEqual(input.getAttribute("autocomplete"), "one-time-code");
  fireEvent.change(input, { target: { value: "abcd-ef" } });
  assert.equal((screen.getByRole("button", { name: "Kirish" }) as HTMLButtonElement).disabled, true, "to'liq bo'lmagan kod");
  await typeAndSubmit("abcd-efgh-23");
  await waitFor(() => assert.deepEqual(replaced, ["/admin/account"]));
  assert.equal(calls[0].url, "/api/admin/auth/recovery");
  assert.deepEqual(calls[0].body, { code: "ABCD-EFGH-23" });
  // And back to the authenticator code.
  cleanup();
  render(withRouter(h(LoginForm, { next: "/admin", userName: "Ali" }), makeRouter().router));
  fireEvent.click(screen.getByRole("button", { name: "Tiklash kodi bilan kirish" }));
  fireEvent.click(screen.getByRole("button", { name: "Authenticator kodi bilan kirish" }));
  assert.equal(codeInput().getAttribute("autocomplete"), "one-time-code");
});

test("LoginForm: 429 -> qolgan vaqt sanog'i, tugma o'chiq, vaqt tugagach yana ochiladi", async () => {
  stubFetch({
    "POST /api/admin/auth/login": () =>
      json(429, { error: "Juda ko'p noto'g'ri urinish.", code: "locked", retryAfter: 2, retryAfterSec: 2 }),
  });
  render(withRouter(h(LoginForm, { next: "/admin", userName: "Ali" }), makeRouter().router));
  await typeAndSubmit("111111");
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /0:02/);
  fireEvent.change(codeInput(), { target: { value: "222222" } });
  assert.equal((screen.getByRole("button", { name: "Kirish" }) as HTMLButtonElement).disabled, true, "blok paytida yuborib bo'lmaydi");
  await waitFor(() => assert.match(screen.getByRole("alert").textContent ?? "", /0:01/), { timeout: 2500 });
  await waitFor(() => assert.ok(!screen.queryByRole("alert")), { timeout: 3000 });
  assert.equal((screen.getByRole("button", { name: "Kirish" }) as HTMLButtonElement).disabled, false);
});

test("LoginForm: 409 not_enrolled va 503 admin_disabled tushunarli matn beradi", async () => {
  stubFetch({
    "POST /api/admin/auth/login": [
      () => json(409, { error: "x", code: "not_enrolled" }),
      () => json(503, { error: "x", code: "admin_disabled" }),
    ],
  });
  render(withRouter(h(LoginForm, { next: "/admin", userName: "Ali" }), makeRouter().router));
  await typeAndSubmit("123123");
  assert.match((await screen.findByRole("alert")).textContent ?? "", /hali sozlanmagan/);
  await typeAndSubmit("123123");
  await waitFor(() => assert.match(screen.getByRole("alert").textContent ?? "", /vaqtincha o'chirilgan/));
});

test("fmtCountdown: m:ss", () => {
  assert.equal(fmtCountdown(0), "0:00");
  assert.equal(fmtCountdown(9), "0:09");
  assert.equal(fmtCountdown(900), "15:00");
});

/* ───────────────────────────── S2 enroll ───────────────────────────── */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>window.__pwned = 1</script><rect width="10" height="10"/></svg>`;
const ENROLL_INFO = {
  account: { role: "owner" },
  secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  otpauthUri: "otpauth://totp/SlaydX:ali?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SlaydX",
  qrSvg: SVG,
};
const CODES = [..."ABCDEFGHIJ"].map((c) => `${c.repeat(4)}-2345-${c}7`);

test("EnrollForm: QR <img> data-URI sifatida, kalit ko'rinadi, SVG DOM ga kiritilmaydi", async () => {
  const calls = stubFetch({ "GET /api/admin/auth/enroll": () => json(200, ENROLL_INFO) });
  render(withRouter(h(EnrollForm, { token: "tok_abc" }), makeRouter().router, "/admin/enroll"));
  const img = await screen.findByRole("img", { name: "Authenticator ilovasi uchun QR kod" });
  const src = img.getAttribute("src") ?? "";
  const prefix = "data:image/svg+xml;charset=utf-8,";
  assert.ok(src.startsWith(prefix), src.slice(0, 40));
  assert.equal(decodeURIComponent(src.slice(prefix.length)), SVG);
  assert.ok(!document.querySelector("svg script, script"), "SVG belgilari sahifaga kiritilmaydi");
  assert.equal(document.querySelector("[data-secret]")?.textContent, "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
  assert.ok(screen.getByText("Egasi"), "rol ko'rinadi");
  assert.equal(calls[0].url, "/api/admin/auth/enroll?token=tok_abc");
});

test("EnrollForm: kod tasdiqlangach 10 tiklash kodi; «Saqladim» belgilanmaguncha davom etib bo'lmaydi", async () => {
  const calls = stubFetch({
    "GET /api/admin/auth/enroll": () => json(200, ENROLL_INFO),
    "POST /api/admin/auth/enroll": () => json(200, { recoveryCodes: CODES }),
  });
  const { router, replaced } = makeRouter();
  render(withRouter(h(EnrollForm, { token: "tok_abc" }), router, "/admin/enroll"));
  await screen.findByRole("img");
  await typeAndSubmit("123456", "Tasdiqlash");
  const list = await screen.findByRole("list", { name: "Tiklash kodlari" });
  assert.deepEqual(
    within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent),
    CODES,
  );
  assert.deepEqual(calls[1].body, { token: "tok_abc", code: "123456" });
  assert.ok(screen.getByRole("button", { name: "Nusxa olish" }));
  assert.ok(screen.getByRole("button", { name: "Yuklab olish (.txt)" }));
  const go = screen.getByRole("button", { name: "Davom etish" }) as HTMLButtonElement;
  assert.equal(go.disabled, true);
  fireEvent.click(go);
  assert.deepEqual(replaced, []);
  fireEvent.click(screen.getByRole("checkbox", { name: /Saqladim/ }));
  assert.equal(go.disabled, false);
  fireEvent.click(go);
  assert.deepEqual(replaced, ["/admin"]);
});

test("EnrollForm: noto'g'ri kod xabari; yonib ketgan havola (404) yakuniy xatoga o'tadi", async () => {
  stubFetch({
    "GET /api/admin/auth/enroll": () => json(200, ENROLL_INFO),
    "POST /api/admin/auth/enroll": [
      () => json(401, { error: "x", code: "bad_code" }),
      () => json(404, { error: "Havola yaroqsiz yoki muddati o'tgan" }),
    ],
  });
  render(withRouter(h(EnrollForm, { token: "tok_abc" }), makeRouter().router, "/admin/enroll"));
  await screen.findByRole("img");
  await typeAndSubmit("000000", "Tasdiqlash");
  assert.equal((await screen.findByRole("alert")).textContent, "Kod noto'g'ri");
  await typeAndSubmit("000001", "Tasdiqlash");
  await waitFor(() => assert.match(screen.getByRole("alert").textContent ?? "", /Havola yaroqsiz/));
  assert.ok(!screen.queryByRole("img"), "QR yashiriladi");
  assert.ok(!screen.queryByRole("button", { name: "Qayta urinish" }), "yonib ketgan havolani qayta urinish befoyda");
});

test("EnrollForm: tokensiz yoki yaroqsiz havola -> xato, so'rov yo'q yoki 404", async () => {
  const calls = stubFetch({ "GET /api/admin/auth/enroll": () => json(404, { error: "Havola yaroqsiz yoki muddati o'tgan" }) });
  render(withRouter(h(EnrollForm, { token: null }), makeRouter().router, "/admin/enroll"));
  assert.match(screen.getByRole("alert").textContent ?? "", /Havola yaroqsiz/);
  assert.equal(calls.length, 0);
  cleanup();
  render(withRouter(h(EnrollForm, { token: "gone" }), makeRouter().router, "/admin/enroll"));
  await waitFor(() => assert.match(screen.getByRole("alert").textContent ?? "", /yangi havola so'rang/));
  assert.equal(calls.length, 1);
});

test("recoveryFileText: har kod alohida qatorda (CRLF)", () => {
  const text = recoveryFileText(["AAAA-BBBB-CC", "DDDD-EEEE-FF"]);
  assert.ok(text.includes("\r\nAAAA-BBBB-CC\r\nDDDD-EEEE-FF\r\n"));
});

/* ───────────────────────────── S19 account ───────────────────────────── */

const MY_SESSIONS = {
  items: [
    {
      id: "8",
      createdAt: "2026-10-02T07:00:00.000Z",
      lastSeenAt: "2026-10-02T07:10:00.000Z",
      ip: "10.0.0.8",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      current: true,
    },
    {
      id: "7",
      createdAt: "2026-10-01T07:00:00.000Z",
      lastSeenAt: "2026-10-01T09:00:00.000Z",
      ip: "10.0.0.7",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      current: false,
    },
  ],
};

function renderAccount(router: AppRouterInstance) {
  return render(
    withRouter(
      h(AdminIdentityProvider, {
        value: { adminId: "1", role: "support", permissions: ["dashboard.view", "users.view", "self"], name: "Ali Valiyev", username: "ali" },
        children: h(AccountPage),
      }),
      router,
      "/admin/account",
    ),
  );
}

test("AccountPage: rol, ruxsatlar va sessiyalar; joriy sessiya belgilangan, uni bekor qilish tugmasi yo'q", async () => {
  stubFetch({ "GET /api/admin/me/sessions": () => json(200, MY_SESSIONS) });
  renderAccount(makeRouter().router);
  assert.match(screen.getByText(/Rol: Qo'llab-quvvatlash/).textContent ?? "", /Ali Valiyev · @ali/);
  const perms = screen.getByRole("list", { name: "Ruxsatlar ro'yxati" });
  assert.deepEqual(
    within(perms)
      .getAllByRole("listitem")
      .map((li) => li.textContent),
    ["Bosh sahifani ko'rish", "Foydalanuvchilarni ko'rish", "O'z hisobim: sessiyalar va tiklash kodlari"],
    "Uzbek labels, never raw permission keys",
  );
  assert.deepEqual(
    within(perms)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("data-permission")),
    ["dashboard.view", "users.view", "self"],
  );
  await waitFor(() => assert.ok(document.querySelector('[data-session="8"]')));
  const current = document.querySelector<HTMLElement>('[data-session="8"]')!;
  const other = document.querySelector<HTMLElement>('[data-session="7"]')!;
  assert.ok(within(current).getByText("Joriy"));
  assert.ok(within(current).getByText("Chrome · Linux"));
  assert.ok(!within(current).queryByRole("button", { name: "Bekor qilish" }));
  assert.ok(within(other).getByText("Safari · iOS"));
  assert.ok(!within(other).queryByText("Joriy"));
  assert.ok(within(other).getByRole("button", { name: "Bekor qilish" }));
});

test("AccountPage: boshqa sessiyani bekor qilish -> tasdiq, POST revoke, ro'yxatdan chiqadi", async () => {
  const calls = stubFetch({
    "GET /api/admin/me/sessions": () => json(200, MY_SESSIONS),
    "POST /api/admin/me/sessions/7/revoke": () => json(200, { ok: true }),
  });
  renderAccount(makeRouter().router);
  await waitFor(() => assert.ok(document.querySelector('[data-session="7"]')));
  fireEvent.click(within(document.querySelector<HTMLElement>('[data-session="7"]')!).getByRole("button", { name: "Bekor qilish" }));
  const dialog = screen.getByRole("dialog");
  assert.match(dialog.textContent ?? "", /Safari · iOS · 10\.0\.0\.7/);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "tasdiqsiz so'rov yo'q");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Bekor qilish" }));
  });
  await waitFor(() => assert.ok(!document.querySelector('[data-session="7"]')));
  const post = calls.find((c) => c.method === "POST");
  assert.ok(post);
  assert.equal(post.url, "/api/admin/me/sessions/7/revoke");
  assert.deepEqual(post.body, {});
  assert.ok(document.querySelector('[data-session="8"]'), "joriy sessiya qoladi");
  assert.deepEqual(
    useToastStore.getState().toasts.map((t) => t.message),
    ["Sessiya bekor qilindi"],
  );
});

test("AccountPage: yangi tiklash kodlari TOTP kod bilan; «Saqladim» siz yopib bo'lmaydi", async () => {
  const calls = stubFetch({
    "GET /api/admin/me/sessions": () => json(200, MY_SESSIONS),
    "POST /api/admin/me/recovery-codes": [() => json(401, { error: "x", code: "bad_code" }), () => json(200, { recoveryCodes: CODES })],
  });
  renderAccount(makeRouter().router);
  fireEvent.click(screen.getByRole("button", { name: "Yangi tiklash kodlari" }));
  let dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Authenticator kodi" }), { target: { value: "999999" } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Yangi kodlar yaratish" }));
  });
  assert.equal((await within(dialog).findByRole("alert")).textContent, "Kod noto'g'ri");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Authenticator kodi" }), { target: { value: "123456" } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Yangi kodlar yaratish" }));
  });
  dialog = await screen.findByRole("dialog");
  const list = await within(dialog).findByRole("list", { name: "Tiklash kodlari" });
  assert.equal(within(list).getAllByRole("listitem").length, 10);
  const posts = calls.filter((c) => c.method === "POST");
  assert.deepEqual(
    posts.map((c) => c.body),
    [{ code: "999999" }, { code: "123456" }],
  );
  // Escape does not drop the one-time codes.
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  assert.ok(screen.getByRole("dialog"));
  const done = within(dialog).getByRole("button", { name: "Tayyor" }) as HTMLButtonElement;
  assert.equal(done.disabled, true);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /Saqladim/ }));
  fireEvent.click(done);
  assert.ok(!screen.queryByRole("dialog"));
});

test("AccountPage: «Chiqish» DELETE session va kirish sahifasiga o'tish", async () => {
  const calls = stubFetch({
    "GET /api/admin/me/sessions": () => json(200, MY_SESSIONS),
    "DELETE /api/admin/session": () => json(200, { ok: true }),
  });
  const { router, replaced } = makeRouter();
  renderAccount(router);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Chiqish" }));
  });
  await waitFor(() => assert.deepEqual(replaced, ["/admin/login"]));
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url === "/api/admin/session"));
});

test("AccountPage: sessiyalarni yuklash xatosi requestId va qayta urinish bilan", async () => {
  stubFetch({
    "GET /api/admin/me/sessions": [
      () => json(500, { error: "Server javob bermadi", requestId: "req-42" }),
      () => json(200, MY_SESSIONS),
    ],
  });
  renderAccount(makeRouter().router);
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /req-42/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.ok(document.querySelector('[data-session="7"]')));
});

test("describeDevice: brauzer va tizim", () => {
  assert.equal(describeDevice(null), "Noma'lum qurilma");
  assert.equal(describeDevice("curl/8.0"), "Noma'lum qurilma");
  assert.equal(
    describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0"),
    "Edge · Windows",
  );
  assert.equal(describeDevice("Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0"), "Firefox · Android");
});
