import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * The «+» sheet (docs/redesign/PLAN.md D1, F0): a `useDialog` overlay with its
 * own history entry (phone back closes it, LIFO), the catalogue from
 * `visibleToolGroups()` / `TOOLS` with the most-used tools first, «Barchasi»
 * → `/uz/create`, and the Sidebar's login gate (session checked + signed out →
 * the tool page opens with the login over it).
 *
 * Mutations (each turned this file red, see the F0 report):
 *   - CreateSheet: `useDialog(open, close, { history: false })` (back leaves the page);
 *   - CreateSheet: `close` closes any overlay (the login opened by the same tap dies);
 *   - CreateSheet: gate on `!loggedIn` only (FE-09: login before the session is known);
 *   - CreateSheet: a hand-written group list (a group label disappears / a tool missing);
 *   - CreateSheet: drop `mostUsedToolIds` (top section = defaults).
 */

const nav = await import("../../lib/nav/history.ts");
const { AppShell } = await import("../../components/shell/AppShell.tsx");
const { NavProvider } = await import("../../components/nav/NavProvider.tsx");
const { useUi } = await import("../../lib/ui.ts");
const { useAppStore } = await import("../../lib/store.ts");
const { TOOLS, visibleToolGroups } = await import("../../lib/tools.ts");

const calls: string[] = [];
const tree = (href: string) => ["", { children: [href] }];
const router = {
  push(href: string) {
    calls.push(`push ${href}`);
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  replace(href: string) {
    calls.push(`replace ${href}`);
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  refresh() {},
  back() {
    window.history.back();
  },
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
const here = () => window.location.pathname + window.location.search;
const tap = () => window.dispatchEvent(new window.Event("pointerdown"));
const realFetch = globalThis.fetch;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

function fresh(path = "/uz") {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
}

afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({ loggedIn: false, user: null, sessionChecked: false, generations: [] });
  globalThis.fetch = realFetch;
});

function Live({ children }: { children: React.ReactNode }) {
  const href = useSyncExternalStore(nav.subscribeNav, () => nav.getNavSnapshot().href, () => "");
  const url = new URL(href || window.location.href);
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: url.pathname },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(url.search) }, h(NavProvider), children),
    ),
  );
}

function shell() {
  // The login modal asks for features on open; nothing here needs a server.
  (globalThis as unknown as { fetch: unknown }).fetch = async () => new Response("{}", { status: 404 });
  return render(h(Live, null, h(AppShell, null, h("div", null, "sahifa"))));
}

const sheet = () => document.querySelector<HTMLElement>("[data-create-sheet]");
const plus = () => document.querySelector<HTMLButtonElement>("[data-create-button]")!;

async function openSheet() {
  tap();
  await act(async () => {
    fireEvent.click(plus());
  });
  await settle();
  assert.ok(sheet(), "sheet open");
}

const signedIn = () =>
  useAppStore.setState({ sessionChecked: true, loggedIn: true, user: { id: "u1", name: "Ali", points: 0, quota: 0, balance: 0, isAdmin: false } as never });

test("«+» opens «Nima yaratamiz?» with its own history entry; phone back closes it, the page stays", async () => {
  fresh("/uz");
  shell();
  await settle();
  await openSheet();
  assert.equal(sheet()!.getAttribute("role"), "dialog");
  assert.equal(sheet()!.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById(sheet()!.getAttribute("aria-labelledby")!)?.textContent, "Nima yaratamiz?");
  assert.ok(sx()?.o, "sheet entry pushed");
  assert.equal(sx()?.i, 1);
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!sheet(), "back closed it");
  assert.equal(useUi.getState().overlay, null);
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0);
});

test("backdrop, the header «×» and Escape close it and pop its entry exactly once", async () => {
  for (const how of ["scrim", "x", "escape"] as const) {
    fresh("/uz/files");
    const view = shell();
    await settle();
    await openSheet();
    const len = sx()?.i;
    await act(async () => {
      if (how === "scrim") fireEvent.click(document.querySelector("[data-create-scrim]")!);
      else if (how === "x") fireEvent.click(sheet()!.querySelector('[aria-label="Yopish"]:not([data-create-scrim])')!);
      else fireEvent.keyDown(window, { key: "Escape" });
    });
    await settle();
    assert.ok(!sheet(), `${how}: closed`);
    assert.equal(sx()?.i, (len ?? 1) - 1, `${how}: one entry popped`);
    assert.equal(here(), "/uz/files", how);
    view.unmount();
    await settle();
  }
});

test("LIFO: a dialog opened over the sheet is closed by the first back, the sheet by the second", async () => {
  fresh("/uz");
  shell();
  await settle();
  await openSheet();
  // Another overlay on top (a nested useDialog, as the login would be): simulated with a raw layer.
  const closed: string[] = [];
  const token = nav.pushLayer("overlay", () => closed.push("top"));
  await settle();
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.deepEqual(closed, ["top"]);
  assert.ok(sheet(), "the sheet is still open under it");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!sheet());
  nav.releaseLayer(token);
});

test("catalogue: every visible group (visibleToolGroups) with all its tools; most-used first; «Barchasi» → /uz/create", async () => {
  fresh("/uz");
  signedIn();
  useAppStore.setState({ generations: [{ type: "crossword" }, { type: "test" }, { type: "crossword" }] as never });
  shell();
  await settle();
  await openSheet();
  const groups = visibleToolGroups();
  const drawn = [...sheet()!.querySelectorAll("[data-create-group]")].map((s) => s.getAttribute("data-create-group"));
  assert.deepEqual(drawn, groups.map((g) => g.id));
  for (const g of groups) {
    const section = sheet()!.querySelector(`[data-create-group="${g.id}"]`)!;
    assert.equal(section.querySelector("h3")?.textContent, g.label);
    const ids = [...section.querySelectorAll("[data-create-tool]")].map((a) => a.getAttribute("data-create-tool"));
    assert.deepEqual(ids, TOOLS.filter((t) => t.group === g.id).map((t) => t.id), g.id);
  }
  const top = [...sheet()!.querySelectorAll("[data-create-top] [data-create-tool]")].map((a) => a.getAttribute("data-create-tool"));
  assert.deepEqual(top.slice(0, 2), ["crossword", "test"], "the user's most-used tools lead");
  assert.equal(top.length, 4);
  for (const a of sheet()!.querySelectorAll<HTMLAnchorElement>("[data-create-tool]")) {
    const t = TOOLS.find((x) => x.id === a.getAttribute("data-create-tool"))!;
    assert.equal(a.getAttribute("href"), `/uz/${t.slug}`);
    assert.ok(a.querySelector("svg"), `${t.id}: icon`);
    assert.ok(a.className.includes("min-h-[5.5rem]"), `${t.id}: ≥ 44 px target`);
  }
  const all = sheet()!.querySelector<HTMLAnchorElement>("[data-create-all]")!;
  assert.equal(all.getAttribute("href"), "/uz/create");
  assert.equal(all.textContent, "Barchasi");
  assert.ok(all.className.includes("h-12"));
});

test("a tool tap (signed in): the sheet's entry is REPLACED by the tool page; back returns to the page under the sheet", async () => {
  fresh("/uz/files");
  signedIn();
  shell();
  await settle();
  await openSheet();
  tap();
  await act(async () => {
    fireEvent.click(sheet()!.querySelector('[data-create-top] [data-create-tool="slide"]')!);
  });
  await settle();
  assert.equal(here(), "/uz/slide");
  assert.equal(sx()?.i, 1, "tool page took the sheet's entry");
  assert.equal(useUi.getState().overlay, null, "no login for a signed-in user");
  assert.ok(!sheet());
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.equal(here(), "/uz/files");
});

test("login gate (as the Sidebar): signed out → the tool page opens AND the login is over it with returnTo", async () => {
  fresh("/uz");
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null });
  shell();
  await settle();
  await openSheet();
  tap();
  await act(async () => {
    fireEvent.click(sheet()!.querySelector('[data-create-group] [data-create-tool="referat"]')!);
  });
  await settle();
  await settle();
  assert.equal(here(), "/uz/referat");
  assert.equal(useUi.getState().overlay, "login", "the sheet's deferred close did not take the login with it");
  assert.equal(useUi.getState().returnTo, "/uz/referat");
  assert.ok(sx()?.o, "the login owns an entry on top of the tool page");
});

test("FE-09: before the session is known a tool tap does not open the login", async () => {
  fresh("/uz");
  useAppStore.setState({ sessionChecked: false, loggedIn: false, user: null });
  shell();
  await settle();
  await openSheet();
  tap();
  await act(async () => {
    fireEvent.click(sheet()!.querySelector('[data-create-tool="essay"]')!);
  });
  await settle();
  assert.equal(here(), "/uz/essay");
  assert.equal(useUi.getState().overlay, null);
});

test("route change closes a sheet left open (NavProvider)", async () => {
  fresh("/uz");
  shell();
  await settle();
  await openSheet();
  tap();
  await act(async () => {
    router.push("/uz/wallet");
  });
  await settle();
  assert.ok(!sheet(), "closed on the new page");
  assert.equal(useUi.getState().overlay, null);
  assert.ok(screen.getByText("sahifa"));
});
