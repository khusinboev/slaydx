import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import * as core from "../../lib/admin-api/core.ts";
import { AdminsPage } from "../../components/admin/admins/AdminsPage.tsx";
import { UserDetail } from "../../components/admin/users/UserDetail.tsx";
import { AdminIdentityProvider } from "../../components/admin/shell/admin-identity.tsx";
import { useToastStore } from "../../components/admin/ui/Toaster.tsx";
import { ADMIN_ADDED_TOAST, ALREADY_ADMIN, BLOCKED_USER } from "../../components/admin/admins/CreateAdminDialog.tsx";

/*
 * Choosing new admins from the users list (owner request 2026-10-02):
 *   - "Admin qo'shish" on /admin/admins searches `GET /api/admin/users?q=…&limit=10` through a
 *     combobox (debounced, every keystroke aborts the request in flight, keyboard navigation,
 *     already-admin / blocked rows disabled) and POSTs `{userId, role, reason}`;
 *   - the user page offers "Admin qilish" only with admins.manage, never for oneself, an existing
 *     admin account (badge + link to /admin/admins instead) or a blocked user (disabled + reason);
 *   - simple mode toasts the "Admin panel" hint, 2FA mode shows the one-time enroll URL.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useToastStore.getState().clear();
  core.setStepUpHandler(null);
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

type Call = { path: string; params: URLSearchParams; method: string; body: Record<string, unknown>; signal: AbortSignal | null | undefined };
type Handler = (c: Call) => Response | Promise<Response>;

/** Routes by `METHOD /path`; rejects with AbortError when the request's signal aborts (like real fetch). */
function stubFetch(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((input: string, init: RequestInit = {}) => {
    const [path, qs = ""] = String(input).split("?");
    const method = (init.method ?? "GET").toUpperCase();
    const call: Call = { path: path!, params: new URLSearchParams(qs), method, body: typeof init.body === "string" ? JSON.parse(init.body) : {}, signal: init.signal };
    calls.push(call);
    const route = routes[`${method} ${path}`];
    assert.ok(route, `kutilmagan so'rov: ${method} ${path}`);
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (init.signal?.aborted) return onAbort();
      init.signal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(route(call)).then(resolve, reject);
    });
  }) as typeof fetch;
  return calls;
}
const never = () => new Promise<Response>(() => {});

const page = (items: unknown[], nextCursor: string | null = null) => ({ items, nextCursor, total: items.length, totalCapped: false });
function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Seed ${id}`,
    username: `seed${id}`,
    telegramId: `70000000${id}`,
    phoneMasked: "+998 ** *** ** 67",
    points: 0,
    quota: 0,
    balance: 0,
    isBlocked: false,
    isAdmin: false,
    createdAt: "2026-09-01T05:00:00.000Z",
    lastSeenAt: null,
    generations: 0,
    ...over,
  };
}
const SEED_ADMIN = row("11", { name: "Seed Admin", isAdmin: true });
const SEED_FREE = row("12", { name: "Seed Bo'sh" });
const SEED_BLOCKED = row("13", { name: "Seed Blok", isBlocked: true });
const SEED_FREE2 = row("14", { name: "Seed Ikkinchi", username: null, phoneMasked: null });

const ACCOUNT = {
  id: "1",
  userId: "10",
  name: "Egasi",
  username: "owner_me",
  role: "owner",
  status: "active",
  totpEnabled: false,
  lastLoginAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  activeSessions: 1,
};
const created = (userId: string, role: string, status = "active") => ({ ...ACCOUNT, id: "9", userId, name: "Seed Bo'sh", username: "seed12", role, status });

const MANAGE = ["admins.view", "admins.manage", "users.view"];
const identity = (role: string, permissions: string[], twoFactor: boolean) => ({ adminId: "1", role, permissions, name: "Test", username: null, twoFactor });

/* ───────────────────────────── /admin/admins: the picker ───────────────────────────── */

function adminsRoutes(over: Record<string, Handler> = {}) {
  const accounts: unknown[] = [ACCOUNT];
  return {
    accounts,
    routes: {
      "GET /api/admin/admins": () => json(200, { items: accounts }),
      "GET /api/admin/users": (c: Call) => json(200, page(c.params.get("q")?.startsWith("@seed") ? [SEED_ADMIN, SEED_FREE, SEED_BLOCKED, SEED_FREE2] : [])),
      "POST /api/admin/admins": (c: Call) => {
        const a = created(String(c.body.userId), String(c.body.role));
        accounts.push(a);
        return json(201, { admin: a, enrollUrl: null, expiresAt: null });
      },
      ...over,
    } as Record<string, Handler>,
  };
}

function renderAdmins(role = "owner", twoFactor = false) {
  return render(h(AdminIdentityProvider, { value: identity(role, MANAGE, twoFactor), children: h(AdminsPage) }));
}

async function openAdd() {
  await waitFor(() => assert.ok(document.querySelector('tr[data-row-key="1"]')));
  fireEvent.click(screen.getByRole("button", { name: "Admin qo'shish" }));
  return screen.findByRole("dialog", { name: "Admin qo'shish" });
}
const combo = (d: HTMLElement) => within(d).getByRole("combobox", { name: "Foydalanuvchini toping" }) as HTMLInputElement;
/** The picker's options (the role `<select>` has options too). */
const options = (d: HTMLElement) =>
  within(within(d).getByRole("listbox", { name: "Topilgan foydalanuvchilar", hidden: true })).queryAllByRole("option", { hidden: true });

test("picker: '@seed' searches the users list (limit 10); options show name, @username, masked phone, #id; admins and blocked users are disabled", async () => {
  const { routes } = adminsRoutes();
  const calls = stubFetch(routes);
  renderAdmins();
  const d = await openAdd();
  const input = combo(d);
  assert.equal(input.getAttribute("aria-expanded"), "false");
  fireEvent.change(input, { target: { value: "@seed" } });
  await waitFor(() => assert.equal(options(d).length, 4));

  const search = calls.filter((c) => c.path === "/api/admin/users");
  assert.equal(search.length, 1);
  assert.equal(search[0]!.params.get("q"), "@seed");
  assert.equal(search[0]!.params.get("limit"), "10");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(input.getAttribute("aria-controls"), within(d).getByRole("listbox", { name: "Topilgan foydalanuvchilar" }).id);

  const [admin, free, blocked, free2] = options(d);
  assert.match(free!.textContent ?? "", /Seed Bo'sh/);
  assert.match(free!.textContent ?? "", /@seed12 · \+998 \*\* \*\*\* \*\* 67 · #12/);
  assert.match(free2!.textContent ?? "", /^Seed Ikkinchi#14$/, "no username / phone → only the id");
  assert.equal(admin!.getAttribute("aria-disabled"), "true");
  assert.match(admin!.textContent ?? "", new RegExp(ALREADY_ADMIN));
  assert.equal(blocked!.getAttribute("aria-disabled"), "true");
  assert.match(blocked!.textContent ?? "", /Bloklangan/);
  assert.ok(blocked!.textContent?.includes(BLOCKED_USER));
  assert.equal(free!.getAttribute("aria-disabled"), null);

  // The first pickable option is active, never the disabled admin.
  assert.equal(input.getAttribute("aria-activedescendant"), free!.id);
  // Clicking a disabled option picks nothing.
  fireEvent.click(admin!);
  assert.ok(combo(d), "still searching");
  assert.ok(!within(d).queryByRole("group", { name: "Tanlangan foydalanuvchi" }));
});

test("picker: keyboard — ArrowDown/ArrowUp skip disabled options and wrap, Enter picks without submitting, the payload carries userId", async () => {
  const { routes } = adminsRoutes();
  const calls = stubFetch(routes);
  const { container } = renderAdmins("owner", false);
  const d = await openAdd();
  const input = combo(d);
  fireEvent.change(input, { target: { value: "@seed" } });
  await waitFor(() => assert.equal(options(d).length, 4));
  const ids = options(d).map((o) => o.id);
  const active = () => input.getAttribute("aria-activedescendant");
  assert.equal(active(), ids[1]);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  assert.equal(active(), ids[3], "skips the blocked option");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  assert.equal(active(), ids[1], "wraps past the disabled admin");
  fireEvent.keyDown(input, { key: "ArrowUp" });
  assert.equal(active(), ids[3]);
  assert.equal(options(d)[3]!.getAttribute("aria-selected"), "true");

  // Escape closes the list only, not the dialog.
  fireEvent.keyDown(input, { key: "Escape" });
  assert.equal(input.getAttribute("aria-expanded"), "false");
  assert.ok(screen.getByRole("dialog", { name: "Admin qo'shish" }));
  fireEvent.keyDown(input, { key: "ArrowDown" });
  assert.equal(input.getAttribute("aria-expanded"), "true", "arrows reopen the list");

  assert.equal(active(), ids[1]);
  fireEvent.keyDown(input, { key: "Enter" });
  const picked = within(d).getByRole("group", { name: "Tanlangan foydalanuvchi" });
  assert.match(picked.textContent ?? "", /Seed Bo'sh/);
  assert.match(picked.textContent ?? "", /#12/);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "Enter in the search box never submits");

  const confirm = within(d).getByRole("button", { name: "Admin qo'shish" }) as HTMLButtonElement;
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "support" } });
  assert.equal(confirm.disabled, true, "reason missing");
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "yangi qo'llab-quvvatlash xodimi" } });
  assert.equal(confirm.disabled, false);
  await act(async () => {
    fireEvent.click(confirm);
  });
  await waitFor(() => assert.ok(toasts().includes(ADMIN_ADDED_TOAST)));
  assert.deepEqual(calls.find((c) => c.method === "POST")!.body, { userId: "12", role: "support", reason: "yangi qo'llab-quvvatlash xodimi" });
  assert.ok(!screen.queryByRole("dialog", { name: "Admin qo'shildi" }), "simple mode: no link dialog");
  await waitFor(() => assert.ok(container.querySelector('tr[data-row-key="9"]'), "the list refreshed"));
});

test("picker: 'Boshqasini tanlash' clears the pick; confirm needs a picked user", async () => {
  const { routes } = adminsRoutes();
  stubFetch(routes);
  renderAdmins();
  const d = await openAdd();
  fireEvent.change(combo(d), { target: { value: "@seed" } });
  await waitFor(() => assert.equal(options(d).length, 4));
  fireEvent.click(options(d)[1]!);
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "viewer" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "kuzatuvchi kerak" } });
  const confirm = within(d).getByRole("button", { name: "Admin qo'shish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, false);
  fireEvent.click(within(d).getByRole("button", { name: "Boshqasini tanlash" }));
  assert.ok(combo(d));
  assert.equal(confirm.disabled, true, "MUTATSIYA: no user → no submit");
});

test("picker: typing is debounced and every keystroke aborts the request in flight; a bare '@' sends nothing", async () => {
  const signals: Array<{ q: string; signal: AbortSignal | null | undefined }> = [];
  const { routes } = adminsRoutes({
    "GET /api/admin/users": (c) => {
      signals.push({ q: c.params.get("q") ?? "", signal: c.signal });
      return c.params.get("q") === "@seed" ? json(200, page([SEED_FREE])) : never();
    },
  });
  stubFetch(routes);
  renderAdmins();
  const d = await openAdd();
  const input = combo(d);
  // Fast typing: one request for the last value only.
  fireEvent.change(input, { target: { value: "@s" } });
  fireEvent.change(input, { target: { value: "@se" } });
  await waitFor(() => assert.equal(signals.length, 1));
  assert.equal(signals[0]!.q, "@se");
  assert.equal(signals[0]!.signal?.aborted, false);
  assert.match(d.textContent ?? "", /Qidirilmoqda/);
  // A new keystroke aborts the pending "@se" at once (before its own debounce ends).
  fireEvent.change(input, { target: { value: "@see" } });
  assert.equal(signals[0]!.signal?.aborted, true, "MUTATSIYA: stale request aborted");
  await waitFor(() => assert.equal(signals.length, 2));
  fireEvent.change(input, { target: { value: "@seed" } });
  assert.equal(signals[1]!.signal?.aborted, true);
  await waitFor(() => assert.equal(options(d).length, 1));
  assert.match(options(d)[0]!.textContent ?? "", /Seed Bo'sh/);
  // A bare "@" (or clearing the box) sends nothing and closes the list.
  fireEvent.change(input, { target: { value: "@" } });
  assert.equal(input.getAttribute("aria-expanded"), "false");
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(signals.length, 3);
});

test("picker: empty result and a refused search are explained; the ID fallback still sends telegramId", async () => {
  let refuse = false;
  const { routes } = adminsRoutes({
    "GET /api/admin/users": () => (refuse ? json(403, { error: "Ruxsat yo'q", code: "forbidden" }) : json(200, page([]))),
  });
  const calls = stubFetch(routes);
  renderAdmins();
  const d = await openAdd();
  fireEvent.change(combo(d), { target: { value: "Hech" } });
  await within(d).findByText(/Hech kim topilmadi/);
  refuse = true;
  fireEvent.change(combo(d), { target: { value: "Hechkim" } });
  await within(d).findByText(/qidirishga ruxsatingiz yo'q/);

  fireEvent.click(within(d).getByRole("button", { name: "ID bo'yicha kiritish" }));
  fireEvent.change(within(d).getByLabelText("Telegram ID"), { target: { value: "555000111" } });
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "moderator" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "moderator kerak" } });
  await act(async () => {
    fireEvent.click(within(d).getByRole("button", { name: "Admin qo'shish" }));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  assert.deepEqual(calls.find((c) => c.method === "POST")!.body, { telegramId: "555000111", role: "moderator", reason: "moderator kerak" });
});

test("picker as admin: roles offered stop below admin; 2FA mode shows the one-time enroll URL", async () => {
  const { routes } = adminsRoutes({
    "POST /api/admin/admins": (c) =>
      json(201, { admin: created(String(c.body.userId), String(c.body.role), "pending"), enrollUrl: "https://slaydxx.uz/admin/enroll?token=PICK-ONCE", expiresAt: "2026-10-02T09:30:00.000Z" }),
  });
  stubFetch(routes);
  renderAdmins("admin", true);
  const d = await openAdd();
  const roleSel = within(d).getByLabelText("Rol") as HTMLSelectElement;
  assert.deepEqual([...roleSel.options].map((o) => o.value).filter(Boolean), ["finance", "support", "moderator", "viewer"]);
  fireEvent.change(combo(d), { target: { value: "@seed" } });
  await waitFor(() => assert.equal(options(d).length, 4));
  fireEvent.click(options(d)[1]!);
  fireEvent.change(roleSel, { target: { value: "finance" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "moliya xodimi" } });
  fireEvent.click(within(d).getByRole("button", { name: "Admin qo'shish" }));
  const link = await screen.findByRole("dialog", { name: "Admin qo'shildi" });
  assert.equal((within(link).getByLabelText("Ulanish havolasi") as HTMLInputElement).value, "https://slaydxx.uz/admin/enroll?token=PICK-ONCE");
  assert.ok(!toasts().includes(ADMIN_ADDED_TOAST));
});

/* ───────────────────────────── user page: "Admin qilish" ───────────────────────────── */

const USER = {
  id: "42",
  name: "Ali Valiyev",
  username: "ali",
  telegramId: "5123456789",
  points: 0,
  quota: 0,
  balance: 0,
  isBlocked: false,
  isAdmin: false,
  createdAt: "2026-09-01T05:00:00.000Z",
  lastSeenAt: null,
  phone: "+998 ** *** ** 67",
  localId: null,
  profile: {},
  language: "uz",
  updatedAt: "2026-09-02T05:00:00.000Z",
  revealed: false,
};
const DETAIL = {
  user: USER,
  stats: { generations: 0, completed: 0, failed: 0, spentTanga: 0, paidSoum: 0, storageBytes: 0 },
  flags: { isAdminAccount: false, adminRole: null as string | null, adminStatus: null as string | null, self: false },
  counts: { activeSessions: 0, queuedJobs: 0, activeGameLinks: 0 },
  walletConfirmThreshold: 1_000_000,
};
const asAdmin = (role: string, status = "active") => ({ ...DETAIL, flags: { ...DETAIL.flags, isAdminAccount: status !== "disabled", adminRole: role, adminStatus: status } });

function Harness({ children, who }: { children: ReactNode; who: ReturnType<typeof identity> }) {
  const [url, setUrl] = useState("/admin/users/42");
  const [pathname, search = ""] = url.split("?");
  const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace: (href: string) => setUrl(href) };
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: pathname! },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, h(AdminIdentityProvider, { value: who, children })),
    ),
  );
}
const USER_PERMS = ["users.view", "users.block", "users.sessions"];
function renderUser(role: string, permissions: string[], twoFactor = false) {
  return render(h(Harness, { who: identity(role, permissions, twoFactor), children: h(UserDetail, { id: "42", tools: [] }) }));
}
const makeAdminBtn = () => screen.queryByRole("button", { name: "Admin qilish" }) as HTMLButtonElement | null;

test("user page: «Admin qilish» only with admins.manage; never for oneself or an existing admin account (badge + link instead)", async () => {
  stubFetch({ "GET /api/admin/users/42": () => json(200, DETAIL) });
  renderUser("support", USER_PERMS);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(!makeAdminBtn(), "MUTATSIYA: no admins.manage → no action");
  cleanup();

  stubFetch({ "GET /api/admin/users/42": () => json(200, DETAIL) });
  renderUser("owner", [...USER_PERMS, ...MANAGE]);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(makeAdminBtn());
  assert.equal(makeAdminBtn()!.disabled, false);
  assert.ok(!screen.queryByRole("link", { name: "Adminlar bo'limida ko'rish" }));
  cleanup();

  stubFetch({ "GET /api/admin/users/42": () => json(200, { ...DETAIL, flags: { ...DETAIL.flags, self: true } }) });
  renderUser("owner", [...USER_PERMS, ...MANAGE]);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(!makeAdminBtn(), "not for one's own account");
  cleanup();

  stubFetch({ "GET /api/admin/users/42": () => json(200, asAdmin("moderator")) });
  renderUser("owner", [...USER_PERMS, ...MANAGE]);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(!makeAdminBtn(), "MUTATSIYA: an admin account has no «Admin qilish»");
  assert.ok(screen.getByText("Admin · Moderator"));
  const link = screen.getByRole("link", { name: "Adminlar bo'limida ko'rish" });
  assert.equal(link.getAttribute("href"), "/admin/admins");
  cleanup();

  // A disabled account still blocks a new one (the server's 409): badge with its status, no action.
  stubFetch({ "GET /api/admin/users/42": () => json(200, asAdmin("support", "disabled")) });
  renderUser("owner", [...USER_PERMS, ...MANAGE]);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  assert.ok(!makeAdminBtn());
  assert.ok(screen.getByText(/Admin · Qo'llab-quvvatlash \(o'chirilgan\)/));
  assert.ok(screen.getByRole("link", { name: "Adminlar bo'limida ko'rish" }));
});

test("user page: a blocked user gets a disabled «Admin qilish» with the reason", async () => {
  stubFetch({ "GET /api/admin/users/42": () => json(200, { ...DETAIL, user: { ...USER, isBlocked: true } }) });
  renderUser("owner", [...USER_PERMS, ...MANAGE]);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  const btn = makeAdminBtn()!;
  assert.equal(btn.disabled, true, "MUTATSIYA: blocked → disabled");
  const why = document.getElementById(btn.getAttribute("aria-describedby") ?? "");
  assert.equal(why?.textContent, BLOCKED_USER);
});

test("user page: admin actor → rank-limited roles, POST {userId, role, reason}, toast, detail refreshed (badge replaces the action)", async () => {
  let made = false;
  const calls = stubFetch({
    "GET /api/admin/users/42": () => json(200, made ? asAdmin("moderator") : DETAIL),
    "POST /api/admin/admins": (c) => {
      made = true;
      return json(201, { admin: created("42", String(c.body.role)), enrollUrl: null, expiresAt: null });
    },
  });
  renderUser("admin", [...USER_PERMS, ...MANAGE]);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(makeAdminBtn()!);
  const d = await screen.findByRole("dialog", { name: "Admin qilish" });
  assert.match(d.textContent ?? "", /Ali Valiyev · @ali · #42/);
  assert.match(d.textContent ?? "", /darhol faol bo'ladi/);
  assert.ok(!within(d).queryByRole("combobox", { name: "Foydalanuvchini toping" }), "the target is fixed: no picker");
  const roleSel = within(d).getByLabelText("Rol") as HTMLSelectElement;
  assert.deepEqual([...roleSel.options].map((o) => o.value).filter(Boolean), ["finance", "support", "moderator", "viewer"], "MUTATSIYA: no admin/owner for an admin");
  fireEvent.change(roleSel, { target: { value: "moderator" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "moderatsiya uchun" } });
  await act(async () => {
    fireEvent.click(within(d).getByRole("button", { name: "Admin qilish" }));
  });
  await waitFor(() => assert.ok(toasts().includes(ADMIN_ADDED_TOAST)));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.path, "/api/admin/admins");
  assert.deepEqual(post.body, { userId: "42", role: "moderator", reason: "moderatsiya uchun" });
  await waitFor(() => assert.ok(screen.getByText("Admin · Moderator")));
  assert.equal(calls.filter((c) => c.path === "/api/admin/users/42").length, 2, "MUTATSIYA: detail refetched");
  assert.ok(!makeAdminBtn());
  assert.ok(!screen.queryByRole("dialog", { name: "Admin qilish" }));
});

test("user page: the server's 409 already_admin stays inline and the dialog stays open", async () => {
  stubFetch({
    "GET /api/admin/users/42": () => json(200, DETAIL),
    "POST /api/admin/admins": () => json(409, { error: "Bu foydalanuvchi allaqachon admin", code: "already_admin" }),
  });
  renderUser("owner", [...USER_PERMS, ...MANAGE]);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(makeAdminBtn()!);
  const d = await screen.findByRole("dialog", { name: "Admin qilish" });
  const roleSel = within(d).getByLabelText("Rol") as HTMLSelectElement;
  assert.deepEqual([...roleSel.options].map((o) => o.value).filter(Boolean), ["owner", "admin", "finance", "support", "moderator", "viewer"]);
  fireEvent.change(roleSel, { target: { value: "admin" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "operatsiyalar rahbari" } });
  fireEvent.click(within(d).getByRole("button", { name: "Admin qilish" }));
  assert.ok(await within(d).findByText("Bu foydalanuvchi allaqachon admin"));
  assert.ok(screen.getByRole("dialog", { name: "Admin qilish" }));
  assert.deepEqual(toasts(), []);
});

test("user page in 2FA mode: the one-time enroll URL dialog (the admins page's component), no toast", async () => {
  stubFetch({
    "GET /api/admin/users/42": () => json(200, DETAIL),
    "POST /api/admin/admins": (c) =>
      json(201, { admin: created("42", String(c.body.role), "pending"), enrollUrl: "https://slaydxx.uz/admin/enroll?token=USER-ONCE", expiresAt: "2026-10-02T09:30:00.000Z" }),
  });
  renderUser("owner", [...USER_PERMS, ...MANAGE], true);
  await screen.findByRole("heading", { name: /Ali Valiyev/ });
  fireEvent.click(makeAdminBtn()!);
  const d = await screen.findByRole("dialog", { name: "Admin qilish" });
  assert.match(d.textContent ?? "", /kutilmoqda/);
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "viewer" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "kuzatuvchi kerak" } });
  fireEvent.click(within(d).getByRole("button", { name: "Admin qilish" }));
  const link = await screen.findByRole("dialog", { name: "Admin qo'shildi" });
  assert.equal((within(link).getByLabelText("Ulanish havolasi") as HTMLInputElement).value, "https://slaydxx.uz/admin/enroll?token=USER-ONCE");
  assert.match(link.textContent ?? "", /14:30/, "expiry in Tashkent time");
  assert.ok(!toasts().includes(ADMIN_ADDED_TOAST));
  fireEvent.click(within(link).getByRole("button", { name: "Nusxaladim, yopish" }));
  await waitFor(() => assert.ok(!document.body.textContent?.includes("USER-ONCE")));
});

test("the server's 409 blocked (e.g. through the ID fallback) is mapped to the actionable message inline; the dialog stays open", async () => {
  const { routes } = adminsRoutes({
    "POST /api/admin/admins": () => json(409, { error: "Bloklangan foydalanuvchini admin qilib bo'lmaydi", code: "blocked" }),
  });
  const calls = stubFetch(routes);
  renderAdmins();
  const d = await openAdd();
  fireEvent.click(within(d).getByRole("button", { name: "ID bo'yicha kiritish" }));
  fireEvent.click(within(d).getByRole("radio", { name: "Foydalanuvchi ID" }));
  fireEvent.change(within(d).getByLabelText("Foydalanuvchi ID"), { target: { value: "13" } });
  fireEvent.change(within(d).getByLabelText("Rol"), { target: { value: "viewer" } });
  fireEvent.change(within(d).getByLabelText(/Sabab/), { target: { value: "kuzatuvchi kerak" } });
  fireEvent.click(within(d).getByRole("button", { name: "Admin qo'shish" }));
  const alert = await within(d).findByRole("alert");
  assert.equal(alert.textContent, BLOCKED_USER, "MUTATSIYA: code `blocked` → the UI wording with the next step");
  assert.ok(screen.getByRole("dialog", { name: "Admin qo'shish" }));
  assert.deepEqual(calls.find((c) => c.method === "POST")!.body, { userId: "13", role: "viewer", reason: "kuzatuvchi kerak" });
  assert.deepEqual(toasts(), []);
});
