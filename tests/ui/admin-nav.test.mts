import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { StrictMode, createElement as h, useEffect, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AdminIdentityProvider } from "../../components/admin/shell/admin-identity.tsx";
import { DetailBack } from "../../components/admin/shell/DetailBack.tsx";
import { AdminShell } from "../../components/admin/shell/AdminShell.tsx";
import { AuditPage } from "../../components/admin/audit/AuditPage.tsx";
import { ErrorsPage } from "../../components/admin/errors/ErrorsPage.tsx";
import { Drawer } from "../../components/admin/ui/Drawer.tsx";
import { useToastStore } from "../../components/admin/ui/Toaster.tsx";

/**
 * Back navigation of the admin panel (docs/nav/PLAN.md, N3), against the REAL
 * history engine and a fake router that writes entries like Next does:
 *   - detail «←» (`DetailBack`) returns to the filtered list: real back when the
 *     previous entry is in-app, else REPLACE with the remembered list URL (bare
 *     list when nothing is remembered), never a push;
 *   - the audit / errors `?id=` drawers are pushed, so the phone's back button
 *     closes them and removes `id` from the URL; X goes back (no ping-pong) or,
 *     for a deep link, replaces `id` away;
 *   - a dialog over such a drawer: back closes only the top;
 *   - the admin mobile nav drawer closes on back.
 *
 * Mutations, each caught here (see the report):
 *   - `DetailBack` back to a plain `<Link href="/admin/users">` → filters lost;
 *   - `useUrlDrawer.open` uses `router.replace` → back leaves the page instead of closing;
 *   - `useUrlDrawer.close` always `router.replace` → X leaves the drawer entry behind (ping-pong);
 *   - `Drawer` ignores `history` (always on) → a second entry per drawer.
 */

const nav = await import("../../lib/nav/history.ts");

const realFetch = globalThis.fetch;
afterEach(async () => {
  cleanup();
  useToastStore.getState().clear();
  globalThis.fetch = realFetch;
  await settle();
  nav.__resetNavForTests();
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const tree = (href: string) => ["", { children: [href] }];
const here = () => window.location.pathname + window.location.search;
const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

const calls: string[] = [];
let setLoc: ((u: string) => void) | null = null;

function write(kind: "pushState" | "replaceState", href: string) {
  window.history[kind]({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  setLoc?.(here());
}

const router = {
  push: (href: string) => {
    calls.push(`push ${href}`);
    write("pushState", href);
  },
  replace: (href: string) => {
    calls.push(`replace ${href}`);
    write("replaceState", href);
  },
  refresh() {},
  back: () => window.history.back(),
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

/** Fresh tab at `path`: engine reset, one unstamped entry (the first entry of the tab). */
function fresh(path: string) {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
}

/** Renders `children` with pathname/search taken from the live location (popstate included). */
function Env({ children, perms }: { children: ReactNode; perms: string[] }) {
  const [loc, set] = useState(here());
  useEffect(() => {
    setLoc = set;
    const onPop = () => set(here());
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      setLoc = null;
    };
  }, []);
  const [pathname, search = ""] = loc.split("?");
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: pathname! },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(search) },
        h(AdminIdentityProvider, { value: { adminId: "1", role: "owner", permissions: perms, name: "Test", username: null, twoFactor: true }, children }),
      ),
    ),
  );
}

const mount = (node: ReactNode, perms: string[] = ["audit.view", "errors.view", "errors.resolve", "admins.view"]) =>
  render(h(StrictMode, null, h(Env, { perms, children: node })));

// ------------------------------------------------------------------ DetailBack

test("DetailBack: with an in-app previous entry «←» is a real back to the filtered list (no ping-pong)", async () => {
  fresh("/admin/users?q=ali&status=blocked");
  router.push("/admin/users/42");
  mount(h(DetailBack, { label: "Foydalanuvchilar" }));
  const link = screen.getByRole("link", { name: "Orqaga" });
  assert.equal(link.getAttribute("href"), "/admin/users", "a real link for middle-click / new tab");
  fireEvent.click(link);
  await settle();
  assert.equal(here(), "/admin/users?q=ali&status=blocked", "the filters survive");
  assert.deepEqual(calls, ["push /admin/users/42"], "back is history.back(), not a push or replace");
  assert.equal(sx()?.i, 0);
  window.history.forward();
  await settle();
  assert.equal(here(), "/admin/users/42", "forward still has the detail: nothing was pushed on top");
});

test("DetailBack: deep link in a fresh tab REPLACES with the remembered filtered list, else the bare list", async () => {
  // A list URL remembered in this tab (the engine records every URL change of an admin list).
  fresh("/admin/users");
  router.replace("/admin/users?q=ali&sort=name");
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/admin/users/42");
  window.sessionStorage.removeItem("sx:nav"); // a new tab keeps sessionStorage's list memory but starts at index 0
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
  const lenBefore = window.history.length;
  mount(h(DetailBack, { label: "Foydalanuvchilar" }));
  fireEvent.click(screen.getByRole("link", { name: "Orqaga" }));
  await settle();
  assert.equal(here(), "/admin/users?q=ali&sort=name");
  assert.deepEqual(calls, ["replace /admin/users?q=ali&sort=name"]);
  assert.equal(window.history.length, lenBefore, "no entry added");
  cleanup();

  // Nothing remembered: the bare list.
  fresh("/admin/payments/abc");
  mount(h(DetailBack, { label: "To'lovlar" }));
  fireEvent.click(screen.getByRole("link", { name: "Orqaga" }));
  await settle();
  assert.deepEqual(calls, ["replace /admin/payments"]);
  assert.equal(here(), "/admin/payments");
});

test("source lock: the four detail pages use DetailBack, not a fixed Link to the bare list", () => {
  const files: Record<string, string> = {
    "components/admin/users/UserDetail.tsx": "/admin/users",
    "components/admin/generations/GenerationDetail.tsx": "/admin/generations",
    "components/admin/payments/OrderDetailPage.tsx": "/admin/payments",
    "components/admin/broadcasts/BroadcastDetail.tsx": "/admin/broadcasts",
  };
  for (const [file, list] of Object.entries(files)) {
    const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.match(src, /<DetailBack label=/, `${file} renders DetailBack`);
    assert.ok(!src.includes(`href="${list}"`), `${file} has no fixed Link to ${list}`);
    assert.ok(!src.includes("ArrowLeft"), `${file} draws no arrow of its own`);
  }
  const shell = readFileSync(new URL("../../components/admin/shell/AdminShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /href="\/uz"[\s\S]{0,400}Saytga qaytish/, "«Saytga qaytish» stays a plain link (a section switch, not a back)");
});

// ------------------------------------------------------------------ Drawer prop

function Plain({ history }: { history?: boolean }) {
  const [open, setOpen] = useState(false);
  return h(
    "div",
    null,
    h("button", { type: "button", onClick: () => setOpen(true) }, "ochish"),
    h(Drawer, { open, onClose: () => setOpen(false), title: "Panel", ...(history === undefined ? {} : { history }), children: "tana" }),
  );
}

test("Drawer: a history entry by default (back closes it); history={false} adds none", async () => {
  fresh("/admin/pricing");
  mount(h(Plain, {}));
  fireEvent.click(screen.getByRole("button", { name: "ochish" }));
  await screen.findByRole("dialog", { name: "Panel" });
  assert.equal(sx()?.i, 1, "one overlay entry");
  window.history.back();
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(here(), "/admin/pricing");
  cleanup();

  fresh("/admin/pricing?id=1");
  mount(h(Plain, { history: false }));
  const len = window.history.length;
  fireEvent.click(screen.getByRole("button", { name: "ochish" }));
  await screen.findByRole("dialog", { name: "Panel" });
  assert.equal(window.history.length, len);
  assert.equal(sx()?.i, 0, "no entry: the URL is the entry");
});

// ------------------------------------------------------------------ audit ?id= drawer

const ITEM = {
  id: "9",
  at: "2026-03-09T08:00:00.000Z",
  adminId: "2",
  adminName: "Admin Test",
  adminUsername: "admintest",
  actorRole: "admin",
  action: "users.block",
  targetType: "user",
  targetId: "77",
  outcome: "ok",
  reason: "spam",
  ip: "10.9.9.9",
};
const ENTRY = { ...ITEM, actorUserId: "20", before: { a: 1 }, after: { a: 2 }, meta: null, requestId: "req-1", userAgent: "UA" };

function stubAudit() {
  globalThis.fetch = (async (input: string) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/admin/audit") return json(200, { items: [ITEM], nextCursor: null, total: 1, totalCapped: false });
    if (path === "/api/admin/admins") return json(200, { items: [] });
    if (path === "/api/admin/audit/9") return json(200, { entry: ENTRY });
    return json(404, { error: "Topilmadi" });
  }) as typeof fetch;
}

const drawerOpen = () => Boolean(screen.queryByRole("dialog", { name: "Audit yozuvi" }));

test("audit: row pushes ?id=; phone back closes the drawer (id removed, filters kept); back again leaves the list", async () => {
  stubAudit();
  fresh("/admin/dashboard");
  router.push("/admin/audit?outcome=ok");
  mount(h(AuditPage));
  const row = await waitFor(() => {
    const r = document.querySelector('tr[data-row-key="9"]') as HTMLElement | null;
    assert.ok(r);
    return r;
  });
  fireEvent.click(row);
  await screen.findByRole("dialog", { name: "Audit yozuvi" });
  assert.equal(here(), "/admin/audit?outcome=ok&id=9");
  assert.deepEqual(calls.slice(-1), ["push /admin/audit?outcome=ok&id=9"]);
  assert.equal(sx()?.i, 2, "exactly one entry for the drawer (the drawer itself adds none)");

  window.history.back();
  await waitFor(() => assert.ok(!drawerOpen()));
  assert.equal(here(), "/admin/audit?outcome=ok", "id removed, filter kept");

  window.history.back();
  await settle();
  assert.equal(here(), "/admin/dashboard", "second back leaves the list as usual");
});

test("audit: X goes back one entry (no ping-pong); a deep-linked drawer replaces id away", async () => {
  stubAudit();
  fresh("/admin/audit");
  mount(h(AuditPage));
  const row = await waitFor(() => {
    const r = document.querySelector('tr[data-row-key="9"]') as HTMLElement | null;
    assert.ok(r);
    return r;
  });
  fireEvent.click(row);
  const dialog = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  assert.equal(sx()?.i, 1);
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Yopish" }).at(-1)!);
  await waitFor(() => assert.ok(!drawerOpen()));
  assert.equal(here(), "/admin/audit");
  assert.equal(sx()?.i, 0, "the drawer entry was popped, not stacked");
  assert.deepEqual(calls, ["push /admin/audit?id=9"], "closing is a back, not another push/replace");
  window.history.forward();
  await waitFor(() => assert.ok(drawerOpen()), { timeout: 2000 });
  cleanup();
  await settle();

  // Deep link: there is no list entry below the drawer, so X replaces ?id away.
  fresh("/admin/audit?outcome=denied&id=9");
  const len = window.history.length;
  mount(h(AuditPage));
  const d2 = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  fireEvent.click(within(d2).getAllByRole("button", { name: "Yopish" }).at(-1)!);
  await waitFor(() => assert.ok(!drawerOpen()));
  assert.deepEqual(calls, ["replace /admin/audit?outcome=denied"]);
  assert.equal(window.history.length, len);
  assert.equal(sx()?.i, 0);
});

test("audit: a filter shortcut inside the drawer replaces the drawer's entry with the narrowed list", async () => {
  stubAudit();
  fresh("/admin/audit");
  mount(h(AuditPage));
  const row = await waitFor(() => {
    const r = document.querySelector('tr[data-row-key="9"]') as HTMLElement | null;
    assert.ok(r);
    return r;
  });
  fireEvent.click(row);
  const dialog = await screen.findByRole("dialog", { name: "Audit yozuvi" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Shu amal bo'yicha filtrlash" }));
  await waitFor(() => assert.ok(!drawerOpen()));
  assert.equal(here(), "/admin/audit?action=users.block");
  assert.equal(sx()?.i, 1, "replaced in place, no extra entry");
  window.history.back();
  await settle();
  assert.equal(here(), "/admin/audit", "back returns to the unfiltered list");
});

// ------------------------------------------------------------------ errors: dialog over the drawer

const ERR = {
  id: "30",
  fingerprint: "fp-30",
  firstSeenAt: "2026-10-01T00:00:00.000Z",
  lastSeenAt: "2026-10-02T00:00:00.000Z",
  count: 3,
  level: "error",
  scope: "pdf",
  message: "[pdf] soffice timeout",
  requestId: null,
  userId: null,
  jobId: null,
  path: "/api/pdf",
  process: "web",
  resolvedAt: null,
  resolvedBy: null,
};

test("errors: a dialog over the ?id= drawer: back closes only the dialog, the next back closes the drawer", async () => {
  globalThis.fetch = (async (input: string) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/admin/errors") return json(200, { items: [ERR], nextCursor: null, total: 1, totalCapped: false });
    if (path === "/api/admin/errors/30") return json(200, { error: { ...ERR, stack: "Error: x\n  at y" } });
    return json(404, { error: "Topilmadi" });
  }) as typeof fetch;
  fresh("/admin/errors");
  mount(h(ErrorsPage));
  const row = await waitFor(() => {
    const r = document.querySelector('tr[data-row-key="30"]') as HTMLElement | null;
    assert.ok(r);
    return r;
  });
  fireEvent.click(row);
  const drawer = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  assert.equal(here(), "/admin/errors?id=30");
  fireEvent.click(await within(drawer).findByRole("button", { name: /Hal qilindi deb belgilash/ }));
  await screen.findByRole("dialog", { name: /Xatoni hal qilindi deb belgilash/ });
  assert.equal(sx()?.i, 2, "drawer URL entry + confirm layer");

  window.history.back();
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: /Xatoni hal qilindi/ })));
  assert.ok(screen.queryByRole("dialog", { name: "Xato tafsiloti" }), "the drawer is still open");
  assert.equal(here(), "/admin/errors?id=30");

  window.history.back();
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(here(), "/admin/errors");
});

// ------------------------------------------------------------------ admin shell

test("AdminShell: the mobile nav drawer has a history entry; back closes it and the URL stays", async () => {
  fresh("/admin/users");
  render(
    h(
      StrictMode,
      null,
      h(Env, {
        perms: ["users.view", "dashboard.view"],
        children: h(AdminShell, { adminId: "1", role: "owner", permissions: ["users.view", "dashboard.view"], name: "Test", username: null, twoFactor: true, children: h("p", null, "sahifa") }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Bo'limlar menyusini ochish" }));
  await screen.findByRole("dialog", { name: "Bo'limlar" });
  assert.equal(sx()?.i, 1);
  window.history.back();
  await waitFor(() => assert.ok(!screen.queryByRole("dialog", { name: "Bo'limlar" })));
  assert.equal(here(), "/admin/users");

  // A link inside the drawer replaces the drawer's entry: back from the new page returns to the page under it.
  fireEvent.click(screen.getByRole("button", { name: "Bo'limlar menyusini ochish" }));
  const nav2 = await screen.findByRole("dialog", { name: "Bo'limlar" });
  fireEvent.click(within(nav2).getByRole("link", { name: /Boshqaruv|Dashboard|Bosh/i }));
  await settle();
  assert.ok(!screen.queryByRole("dialog", { name: "Bo'limlar" }));
  assert.notEqual(here(), "/admin/users");
  window.history.back();
  await settle();
  assert.equal(here(), "/admin/users");
});
