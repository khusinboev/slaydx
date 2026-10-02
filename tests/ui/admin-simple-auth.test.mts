import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import type * as StoreModule from "../../lib/store.ts";
import type * as UiModule from "../../lib/ui.ts";
import type { ServerUser } from "../../lib/api-client.ts";
import type { AdminAccountItem } from "../../lib/admin-api/admins.ts";
import { AdminAutoEnter } from "../../components/admin/shell/AdminAutoEnter.tsx";
import { AccountPage } from "../../components/admin/shell/AccountPage.tsx";
import { AdminIdentityProvider, type AdminIdentity } from "../../components/admin/shell/admin-identity.tsx";
import { AdminsPage } from "../../components/admin/admins/AdminsPage.tsx";
import { Sidebar } from "../../components/shell/Sidebar.tsx";

/*
 * Simple admin entry — the 2FA switch OFF (docs/admin/HANDOFF.md "Admin 2FA
 * switch"): the site's sidebar button, the auto-entry component the panel
 * layout mounts, and the parts of the panel that must not mention a second
 * factor. Real components against a stubbed `fetch`, asserting the exact
 * requests and what the admin sees.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - `AdminAutoEnter` without the `started` ref guard and with `attempt` in
 *     state only → still one POST here (React 18 without StrictMode), so the
 *     guard is pinned by the retry test instead: dropping `setAttempt` from
 *     `retry` → "retry POSTs again" fails (one call);
 *   - `router.refresh()` removed → "refreshes once";
 *   - `twoFactor ? ... : ...` in AccountPage replaced by the 2FA branch →
 *     "simple mode hides" (button found, note missing);
 *   - the `reset2fa` row no longer filtered in `ManageModal` → "no reset
 *     action".
 */
const req = createRequire(import.meta.url);
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;
const { useAppStore } = req("../../lib/store.ts") as typeof StoreModule;
const { useUi } = req("../../lib/ui.ts") as typeof UiModule;

type Call = { url: string; method: string; body: unknown };
type Route = (call: Call) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useToastStore.getState().clear();
  useAppStore.setState({ loggedIn: false, sessionChecked: true, user: null });
  useUi.setState({ overlay: null, returnTo: null });
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Routes by `METHOD path` (query ignored); unknown requests fail the test; an array answers call N with entry N. */
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

function withRouter(node: ReactNode, router: AppRouterInstance, pathname = "/admin") {
  return h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: pathname }, node));
}

const ADMIN = { id: "1", userId: "10", name: "Ali Valiyev", username: "ali", role: "owner", permissions: ["self"], status: "active", totpEnabled: false };
const SESSION = { id: "77", expiresAt: "2026-10-02T21:00:00.000Z", idleExpiresAt: "2026-10-02T09:30:00.000Z", reauthUntil: null };
const AUTO_OK = () => json(200, { admin: ADMIN, session: SESSION });

/* ───────────────────────────── AdminAutoEnter ───────────────────────────── */

test("AdminAutoEnter: POSTs /api/admin/auth/auto exactly once (empty JSON body) and refreshes once; no replace without `next`", async () => {
  const calls = stubFetch({ "POST /api/admin/auth/auto": AUTO_OK });
  const r = makeRouter();
  render(withRouter(h(AdminAutoEnter, {}), r.router));
  assert.ok(screen.getByText("Admin panelga kirilmoqda…"));
  await waitFor(() => assert.equal(r.refreshed(), 1));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { url: "/api/admin/auth/auto", method: "POST", body: {} });
  assert.deepEqual(r.replaced, []);
  // Nothing else fires afterwards (no polling, no second POST).
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(calls.length, 1);
  assert.equal(r.refreshed(), 1);
});

test("AdminAutoEnter on /admin/login: goes to the sanitised `next` and refreshes; a foreign `next` falls back to /admin", async () => {
  stubFetch({ "POST /api/admin/auth/auto": AUTO_OK });
  const r = makeRouter();
  render(withRouter(h(AdminAutoEnter, { next: "/admin/users?q=ali" }), r.router, "/admin/login"));
  await waitFor(() => assert.equal(r.refreshed(), 1));
  assert.deepEqual(r.replaced, ["/admin/users?q=ali"]);
  cleanup();

  stubFetch({ "POST /api/admin/auth/auto": AUTO_OK });
  const r2 = makeRouter();
  render(withRouter(h(AdminAutoEnter, { next: "https://evil.example/admin" }), r2.router, "/admin/login"));
  await waitFor(() => assert.equal(r2.refreshed(), 1));
  assert.deepEqual(r2.replaced, ["/admin"]);
});

test("AdminAutoEnter: a 404 shows the error with «Qayta urinish»; retry POSTs again and then refreshes", async () => {
  const calls = stubFetch({ "POST /api/admin/auth/auto": [() => json(404, { error: "Topilmadi" }), AUTO_OK] });
  const r = makeRouter();
  render(withRouter(h(AdminAutoEnter, {}), r.router));
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /Admin panelga kirib bo'lmadi: Topilmadi/);
  assert.equal(r.refreshed(), 0, "no refresh on failure (it would loop)");
  assert.ok(within(alert).getByRole("link", { name: "Saytga qaytish" }).getAttribute("href"), "/uz");
  await act(async () => {
    fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  });
  await waitFor(() => assert.equal(r.refreshed(), 1));
  assert.equal(calls.length, 2);
});

/* ───────────────────────────── Sidebar button ───────────────────────────── */

const USER: ServerUser = {
  id: "10",
  telegramId: "500100",
  username: "ali",
  name: "Ali Valiyev",
  photoUrl: null,
  language: "uz",
  points: 3000,
  quota: 0,
  balance: 12_000,
  university: "",
  faculty: "",
  department: "",
  group: "",
  course: "",
  author: "",
  subject: "",
  teacher: "",
  city: "",
  position: "",
  organization: "",
  phone: null,
  isAdmin: false,
};

function signIn(user: ServerUser) {
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    user,
    features: { payments: { click: true, payme: true } } as never,
    refreshSession: async () => {},
  });
}

test("Sidebar: «Admin panel» → /admin is shown for a user with an admin account (isAdmin), hidden for everyone else", () => {
  signIn({ ...USER, isAdmin: true });
  const { unmount } = render(withRouter(h(Sidebar, {}), makeRouter().router, "/uz"));
  const link = screen.getByRole("link", { name: /Admin panel/ });
  assert.equal(link.getAttribute("href"), "/admin");
  unmount();

  signIn({ ...USER, isAdmin: false });
  render(withRouter(h(Sidebar, {}), makeRouter().router, "/uz"));
  assert.ok(!screen.queryByRole("link", { name: /Admin panel/ }), "no button for a plain user");
  cleanup();

  useAppStore.setState({ loggedIn: false, sessionChecked: true, user: null });
  render(withRouter(h(Sidebar, {}), makeRouter().router, "/uz"));
  assert.ok(!screen.queryByRole("link", { name: /Admin panel/ }), "no button when signed out");
});

/* ───────────────────────────── AccountPage ───────────────────────────── */

const IDENTITY = (twoFactor: boolean, permissions: string[] = ["dashboard.view", "self"]): AdminIdentity => ({
  adminId: "1",
  role: "owner",
  permissions,
  name: "Ali Valiyev",
  username: "ali",
  twoFactor,
});

function renderAccount(router: AppRouterInstance, twoFactor: boolean) {
  return render(withRouter(h(AdminIdentityProvider, { value: IDENTITY(twoFactor), children: h(AccountPage) }), router, "/admin/account"));
}

test("AccountPage in simple mode hides TOTP and recovery codes, shows the «2FA off» note; «Chiqish» revokes and returns to the site", async () => {
  const calls = stubFetch({
    "GET /api/admin/me/sessions": () => json(200, { items: [] }),
    "DELETE /api/admin/session": () => json(200, { ok: true }),
  });
  const r = makeRouter();
  renderAccount(r.router, false);
  await screen.findByText("Faol sessiya yo'q");
  assert.ok(document.querySelector('[data-note="2fa-off"]'), "the note is shown");
  assert.match(document.querySelector('[data-note="2fa-off"]')!.textContent ?? "", /Admin panel/);
  assert.ok(!screen.queryByRole("button", { name: "Yangi tiklash kodlari" }), "no recovery-code button");
  assert.ok(!screen.queryByText(/Qayta tasdiqlash/), "no step-up row");
  assert.ok(screen.getByText("O'chirilgan"), "2FA badge reads off");

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Chiqish" }));
  });
  await waitFor(() => assert.deepEqual(r.replaced, ["/uz"]));
  assert.ok(calls.some((c) => c.method === "DELETE" && c.url === "/api/admin/session"));
  assert.equal(r.refreshed(), 1);
});

test("AccountPage with the switch on keeps the TOTP section and sends «Chiqish» to the login page (unchanged behaviour)", async () => {
  stubFetch({
    "GET /api/admin/me/sessions": () => json(200, { items: [] }),
    "DELETE /api/admin/session": () => json(200, { ok: true }),
  });
  const r = makeRouter();
  renderAccount(r.router, true);
  await screen.findByText("Faol sessiya yo'q");
  assert.ok(!document.querySelector('[data-note="2fa-off"]'));
  assert.ok(screen.getByRole("button", { name: "Yangi tiklash kodlari" }));
  assert.ok(screen.getByText(/Qayta tasdiqlash/));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Chiqish" }));
  });
  await waitFor(() => assert.deepEqual(r.replaced, ["/admin/login"]));
});

/* ───────────────────────────── AdminsPage ───────────────────────────── */

const acct = (over: Partial<AdminAccountItem> & { id: string }): AdminAccountItem => ({
  userId: `${Number(over.id) * 10}`,
  name: `Admin ${over.id}`,
  username: `adm${over.id}`,
  role: "support",
  status: "active",
  totpEnabled: false,
  lastLoginAt: "2026-10-02T08:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  activeSessions: 1,
  ...over,
});
const OWNER_ME = acct({ id: "1", name: "Egasi Men", username: "owner_me", role: "owner" });
const SUPPORT = acct({ id: "3", name: "Qo'llab Sardor", username: "sardor" });

function renderAdmins(twoFactor: boolean) {
  const items = [OWNER_ME, SUPPORT];
  const calls = stubFetch({
    "GET /api/admin/admins": () => json(200, { items }),
    "POST /api/admin/admins": (c) => {
      const body = c.body as { role: AdminAccountItem["role"] };
      const created = acct({ id: "9", name: "Yangi Admin", username: null, role: body.role, activeSessions: 0 });
      items.push(created);
      return json(201, { admin: created, enrollUrl: null, expiresAt: null });
    },
  });
  const r = makeRouter();
  const view = render(
    withRouter(
      h(AdminIdentityProvider, { value: IDENTITY(twoFactor, ["admins.view", "admins.manage", "self"]), children: h(AdminsPage) }),
      r.router,
      "/admin/admins",
    ),
  );
  return { ...view, calls };
}

/** The DataTable renders each account once as a table row (`data-row-key`) and once as a card; the row is the stable handle. */
const rowOf = (container: HTMLElement, id: string) => container.querySelector(`tr[data-row-key="${id}"]`) as HTMLElement;

test("AdminsPage in simple mode: no 2FA column, no «2FA ni tiklash» action; adding an admin toasts the button hint and shows no link dialog", async () => {
  const { container, calls } = renderAdmins(false);
  await waitFor(() => assert.ok(rowOf(container, "3")));
  assert.match(container.textContent ?? "", /2FA o'chirilgan/);
  assert.ok(!within(container).queryByRole("columnheader", { name: "2FA" }), "no 2FA column");

  fireEvent.click(within(rowOf(container, "3")).getByRole("button", { name: /boshqarish/ }));
  const manage = await screen.findByRole("dialog", { name: "Adminni boshqarish" });
  assert.deepEqual(
    within(manage)
      .getAllByRole("button")
      .map((b) => b.textContent)
      // The modal's own close (icon, aria-label only) and footer buttons are not actions.
      .filter((t) => t && t !== "Yopish"),
    ["Rolni o'zgartirish", "O'chirish", "Sessiyalarni bekor qilish"],
  );
  // The footer "Yopish" (text), not the icon close (aria-label "Yopish").
  fireEvent.click(within(manage).getByText("Yopish"));

  fireEvent.click(screen.getByRole("button", { name: "Admin qo'shish" }));
  const d = await screen.findByRole("dialog", { name: "Admin qo'shish" });
  assert.match(d.textContent ?? "", /darhol faol bo'ladi/);
  assert.ok(within(d).getByLabelText("Telegram orqali xabar yuborish"));
  fireEvent.change(within(d).getByLabelText("Telegram ID"), { target: { value: "555000111" } });
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "support" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "yangi qo'llab-quvvatlash xodimi" } });
  await act(async () => {
    fireEvent.click(within(d).getByRole("button", { name: "Admin qo'shish" }));
  });
  await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message === "Admin qo'shildi — u saytdagi «Admin panel» tugmasi orqali kiradi")));
  assert.ok(!screen.queryByRole("dialog", { name: "Admin qo'shildi" }), "no one-time link dialog");
  assert.deepEqual(calls.find((c) => c.method === "POST")!.body, { telegramId: "555000111", role: "support", reason: "yangi qo'llab-quvvatlash xodimi" });
  await waitFor(() => assert.ok(rowOf(container, "9")));
  assert.match(rowOf(container, "9").textContent ?? "", /Faol/);
});

test("AdminsPage with the switch on still offers «2FA ni tiklash» and the 2FA column (unchanged behaviour)", async () => {
  const { container } = renderAdmins(true);
  await waitFor(() => assert.ok(rowOf(container, "3")));
  assert.ok(within(container).getByRole("columnheader", { name: "2FA" }));
  fireEvent.click(within(rowOf(container, "3")).getByRole("button", { name: /boshqarish/ }));
  const manage = await screen.findByRole("dialog", { name: "Adminni boshqarish" });
  assert.ok(within(manage).getByRole("button", { name: "2FA ni tiklash" }));
});
