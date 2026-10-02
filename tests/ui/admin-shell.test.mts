import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { Permission, Role } from "../../lib/server/admin-rbac.ts";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as StoreModule from "../../lib/store.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import { AdminShell } from "../../components/admin/shell/AdminShell.tsx";
import { AdminLoginRedirect } from "../../components/admin/shell/AdminLoginRedirect.tsx";
import { ADMIN_NAV, visibleNav } from "../../components/admin/shell/nav-registry.ts";

/*
 * Admin shell (docs/admin/02-plan.md §7.0): permission-filtered nav per role,
 * active item, mobile drawer, theme switch and the 401 `admin_auth` redirect.
 *
 * Module state (the core's auth handler, the theme store) must be read from the
 * SAME instance the components use; tsx loads those through `require`.
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { useAppStore } = req("../../lib/store.ts") as typeof StoreModule;

/*
 * Copy of `ROLE_PERMISSIONS` from lib/server/admin-rbac.ts: jsdom cannot load
 * `server-only` modules. tests/admin-nav-registry.test.mts fails if this drifts.
 */
const ROLE_FIXTURE: Record<Role, readonly Permission[]> = /* ROLE_FIXTURE_BEGIN */ {
  "owner": ["dashboard.view","users.view","users.pii","users.export","users.block","users.sessions","users.wallet","users.message","jobs.view","jobs.input","jobs.export","jobs.cancel","jobs.refund","payments.view","payments.export","payments.refund_record","finance.view","finance.export","ai.view","moderation.view","moderation.act","broadcasts.view","broadcasts.send","settings.view","settings.edit","system.view","errors.view","errors.resolve","audit.view","audit.export","pricing.view","pricing.edit","admins.view","admins.manage","self"],
  "admin": ["dashboard.view","users.view","users.pii","users.export","users.block","users.sessions","users.wallet","users.message","jobs.view","jobs.input","jobs.export","jobs.cancel","jobs.refund","payments.view","payments.export","payments.refund_record","finance.view","finance.export","ai.view","moderation.view","moderation.act","broadcasts.view","broadcasts.send","settings.view","settings.edit","system.view","errors.view","errors.resolve","audit.view","pricing.view","pricing.edit","admins.view","admins.manage","self"],
  "finance": ["dashboard.view","users.view","users.export","users.wallet","jobs.view","jobs.export","jobs.refund","payments.view","payments.export","payments.refund_record","finance.view","finance.export","ai.view","settings.view","system.view","pricing.view","self"],
  "support": ["dashboard.view","users.view","users.pii","users.block","users.sessions","users.message","jobs.view","jobs.input","jobs.cancel","jobs.refund","payments.view","moderation.view","broadcasts.view","system.view","errors.view","self"],
  "moderator": ["dashboard.view","users.view","users.block","jobs.view","moderation.view","moderation.act","self"],
  "viewer": ["dashboard.view","users.view","jobs.view","payments.view","finance.view","ai.view","settings.view","system.view","errors.view","pricing.view","self"]
} /* ROLE_FIXTURE_END */;

type RouterCalls = { replace: string[]; push: string[] };

function makeRouter(): { router: AppRouterInstance; calls: RouterCalls } {
  const calls: RouterCalls = { replace: [], push: [] };
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push: (href: string) => void calls.push.push(href),
    replace: (href: string) => void calls.replace.push(href),
  };
  return { router, calls };
}

function withRouter(node: ReactNode, router: AppRouterInstance, pathname: string) {
  return h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: pathname }, node));
}

function renderShell(role: Role, pathname = "/admin/users/42") {
  const { router, calls } = makeRouter();
  const utils = render(
    withRouter(
      h(AdminShell, {
        adminId: "7",
        role,
        permissions: ROLE_FIXTURE[role],
        name: "Ali Valiyev",
        username: "ali",
        children: h("p", null, "Sahifa mazmuni"),
      }),
      router,
      pathname,
    ),
  );
  return { ...utils, calls };
}

function navHrefs(container: ParentNode): string[] {
  const nav = container.querySelector('nav[aria-label="Bo\'limlar"]');
  assert.ok(nav, "nav topilmadi");
  return [...nav.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
}

const realFetch = globalThis.fetch;
const realLocation = Object.getOwnPropertyDescriptor(globalThis, "location");

beforeEach(() => {
  core.setOnAdminAuthRequired(null);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  if (realLocation) Object.defineProperty(globalThis, "location", realLocation);
  else Reflect.deleteProperty(globalThis, "location");
  core.setOnAdminAuthRequired(null);
  document.documentElement.classList.remove("dark");
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/* ───────────────────────────── nav per role ───────────────────────────── */

const EXPECTED_BY_ROLE: Record<Role, string[]> = {
  owner: ADMIN_NAV.map((i) => i.href),
  admin: ADMIN_NAV.map((i) => i.href),
  finance: ["/admin", "/admin/users", "/admin/generations", "/admin/payments", "/admin/finance", "/admin/ai", "/admin/pricing", "/admin/settings", "/admin/system", "/admin/account"],
  support: ["/admin", "/admin/users", "/admin/generations", "/admin/payments", "/admin/moderation", "/admin/broadcasts", "/admin/system", "/admin/errors", "/admin/account"],
  moderator: ["/admin", "/admin/users", "/admin/generations", "/admin/moderation", "/admin/account"],
  viewer: ["/admin", "/admin/users", "/admin/generations", "/admin/payments", "/admin/finance", "/admin/ai", "/admin/pricing", "/admin/settings", "/admin/system", "/admin/errors", "/admin/account"],
};

for (const role of Object.keys(ROLE_FIXTURE) as Role[]) {
  test(`AdminShell: ${role} roli faqat ruxsat etilgan bo'limlarni ko'radi`, () => {
    const { container } = renderShell(role);
    const hrefs = navHrefs(container);
    assert.deepEqual(hrefs, EXPECTED_BY_ROLE[role]);
    assert.deepEqual(hrefs, visibleNav(ROLE_FIXTURE[role]).map((i) => i.href));
  });
}

test("AdminShell: ko'ruvchi audit, adminlar, e'lonlar va moderatsiyani ko'rmaydi", () => {
  const { container } = renderShell("viewer");
  const hrefs = navHrefs(container);
  for (const hidden of ["/admin/audit", "/admin/admins", "/admin/broadcasts", "/admin/moderation"]) {
    assert.ok(!hrefs.includes(hidden), hidden);
  }
});

test("AdminShell: joriy bo'lim aria-current bilan belgilanadi (ichki sahifada ham)", () => {
  const { container } = renderShell("owner", "/admin/users/42");
  const current = container.querySelectorAll('nav a[aria-current="page"]');
  assert.equal(current.length, 1);
  assert.equal(current[0].getAttribute("href"), "/admin/users");
  cleanup();
  const again = renderShell("owner", "/admin");
  const dash = again.container.querySelectorAll('nav a[aria-current="page"]');
  assert.equal(dash.length, 1);
  assert.equal(dash[0].getAttribute("href"), "/admin");
});

test("AdminShell: sahifa mazmuni, ism va rol ko'rsatiladi", () => {
  renderShell("finance");
  assert.ok(screen.getByText("Sahifa mazmuni"));
  assert.ok(screen.getAllByText("Ali Valiyev").length >= 1);
  assert.ok(screen.getAllByText(/@ali · Moliya/).length >= 1);
  assert.ok(document.getElementById("main"), "skip-link nishoni #main bor");
});

test("AdminShell: sahifalarga adminId bilan identity beradi (useAdminIdentity)", () => {
  // Shell and hook from the same (require) module graph, so the context instance matches.
  const { AdminShell: Shell } = req("../../components/admin/shell/AdminShell.tsx") as { AdminShell: typeof AdminShell };
  const { useAdminIdentity } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;
  function Probe() {
    const id = useAdminIdentity();
    return h("p", null, `id:${id.adminId}|${id.role}|${id.name}`);
  }
  const { router } = makeRouter();
  render(
    withRouter(
      h(Shell, { adminId: "7", role: "support", permissions: ROLE_FIXTURE.support, name: "Ali Valiyev", username: null, children: h(Probe) }),
      router,
      "/admin",
    ),
  );
  assert.ok(screen.getByText("id:7|support|Ali Valiyev"));
});

/* ───────────────────────────── drawer ───────────────────────────── */

test("AdminShell: mobil menyu ochiladi, Escape, X va havola bosilganda yopiladi", async () => {
  renderShell("moderator");
  const opener = screen.getByRole("button", { name: "Bo'limlar menyusini ochish" });
  assert.ok(!screen.queryByRole("dialog"));

  fireEvent.click(opener);
  let dialog = screen.getByRole("dialog");
  assert.deepEqual(navHrefs(dialog), EXPECTED_BY_ROLE.moderator, "drawer da ham filtrlangan nav");
  assert.equal(opener.getAttribute("aria-expanded"), "true");
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  assert.ok(!screen.queryByRole("dialog"), "Escape yopadi");

  fireEvent.click(opener);
  dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Menyuni yopish" })[0]);
  assert.ok(!screen.queryByRole("dialog"), "X yopadi");

  fireEvent.click(opener);
  dialog = screen.getByRole("dialog");
  const link = within(dialog).getByRole("link", { name: "Moderatsiya" });
  link.addEventListener("click", (e) => e.preventDefault());
  fireEvent.click(link);
  await waitFor(() => assert.ok(!screen.queryByRole("dialog"), "havola bosilganda yopiladi"));
});

test("AdminShell: fon ustiga bosish menyuni yopadi", () => {
  const { container } = renderShell("viewer");
  fireEvent.click(screen.getByRole("button", { name: "Bo'limlar menyusini ochish" }));
  const backdrop = container.ownerDocument.querySelector<HTMLButtonElement>('button[tabindex="-1"][aria-label="Menyuni yopish"]');
  assert.ok(backdrop);
  fireEvent.click(backdrop);
  assert.ok(!screen.queryByRole("dialog"));
});

/* ───────────────────────────── theme ───────────────────────────── */

test("AdminShell: mavzu tugmasi umumiy theme store ni almashtiradi", () => {
  useAppStore.setState({ theme: "light" });
  renderShell("viewer");
  const toggle = screen.getAllByRole("button", { name: "Kunduzgi yoki tungi rejim" })[0];
  fireEvent.click(toggle);
  assert.equal(useAppStore.getState().theme, "dark");
  assert.ok(document.documentElement.classList.contains("dark"));
  fireEvent.click(toggle);
  assert.equal(useAppStore.getState().theme, "light");
  assert.ok(!document.documentElement.classList.contains("dark"));
});

/* ───────────────────────────── 401 admin_auth ───────────────────────────── */

test("AdminShell: 401 admin_auth kirish sahifasiga next bilan yo'naltiradi", async () => {
  Object.defineProperty(globalThis, "location", {
    value: { pathname: "/admin/users/42", search: "?tab=ledger", assign: () => assert.fail("standart handler ishlamasligi kerak") },
    configurable: true,
  });
  globalThis.fetch = (async () => json(401, { error: "Admin sessiyasi tugagan", code: "admin_auth" })) as typeof fetch;
  const { calls } = renderShell("support");
  await assert.rejects(core.adminGet("/api/admin/users"), (e: unknown) => e instanceof core.AdminAuthRequiredError);
  assert.deepEqual(calls.replace, ["/admin/login?next=%2Fadmin%2Fusers%2F42%3Ftab%3Dledger"]);
});

test("AdminShell: unmount handler ni olib tashlaydi", async () => {
  const assigned: string[] = [];
  Object.defineProperty(globalThis, "location", {
    value: { pathname: "/admin/ai", search: "", assign: (u: string) => assigned.push(u) },
    configurable: true,
  });
  globalThis.fetch = (async () => json(401, { code: "admin_auth" })) as typeof fetch;
  const { calls, unmount } = renderShell("owner");
  unmount();
  await assert.rejects(core.adminGet("/api/admin/ai/usage"));
  assert.deepEqual(calls.replace, [], "eski router ishlatilmaydi");
  assert.deepEqual(assigned, ["/admin/login?next=%2Fadmin%2Fai"], "standart handler ishlaydi");
});

/* ───────────────────────────── session redirect ───────────────────────────── */

test("AdminLoginRedirect: sessiyasiz panel sahifasi login?next=<joriy yo'l> ga o'tadi", async () => {
  Object.defineProperty(globalThis, "location", {
    value: { pathname: "/admin/payments", search: "?state=2" },
    configurable: true,
  });
  const { router, calls } = makeRouter();
  render(withRouter(h(AdminLoginRedirect), router, "/admin/payments"));
  await waitFor(() => assert.equal(calls.replace.length, 1));
  assert.equal(calls.replace[0], "/admin/login?next=%2Fadmin%2Fpayments%3Fstate%3D2");
  assert.ok(screen.getByRole("link", { name: "Kirish sahifasiga o'tish" }));
});
