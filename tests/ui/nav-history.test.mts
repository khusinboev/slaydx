import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { Fragment, StrictMode, createElement as h, useCallback, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * History engine + overlay layer in a DOM (docs/nav/PLAN.md, R4 §5).
 *
 * The fake router writes entries exactly like Next's HistoryUpdater: its own
 * keys only (`__NA`, tree), no custom state (preserveCustomHistoryState is
 * false for navigate/refresh). A plain (non-capture) popstate listener stands
 * in for Next's: it must NOT see pops between our own same-URL entries.
 *
 * Mutations, each caught here:
 *   - `backToUnguarded` always `history.back()` (no parent fallback) → "fresh deep link" fails;
 *   - popstate ignores the token (`sx.o`) → "orphan skip" fails;
 *   - `releaseLayer` skips the "already popped" check (index lookup) → "exactly once" fails;
 *   - useDialog Escape not limited to the top dialog → "nested LIFO" fails.
 */

const nav = await import("../../lib/nav/history.ts");
const { useDialog } = await import("../../components/overlays/useDialog.ts");
const { useOverlayHistory } = await import("../../components/nav/useOverlayHistory.ts");

type Calls = string[];
const calls: Calls = [];
const nextSaw: string[] = [];
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
  refresh() {
    calls.push("refresh");
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree("r") }, "", window.location.href);
  },
  back() {
    window.history.back();
  },
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

window.addEventListener("popstate", () => nextSaw.push(window.location.pathname + window.location.search));

const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
const here = () => window.location.pathname + window.location.search;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

/** A fresh tab at `path`: engine reset, one unstamped entry. */
function fresh(path = "/uz") {
  nav.__resetNavForTests();
  // A new last entry (drops forward entries left by earlier tests), unstamped.
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
  nextSaw.length = 0;
}

afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
});

// --------------------------------------------------------------- dialogs harness

const ctl: Record<string, (v: boolean) => void> = {};
const closes: string[] = [];

function Dlg(props: { name: string; open: boolean; onClose: () => void; history?: boolean }) {
  const ref = useDialog(props.open, props.onClose, props.history === false ? { history: false } : undefined);
  if (!props.open) return null;
  return h(
    "div",
    { ref, role: "dialog", "aria-label": props.name },
    h("button", { type: "button" }, `${props.name} ok`),
    h("a", { href: "/uz/create", onClick: props.onClose }, `${props.name} link`),
  );
}

function Pair(props: { declineA?: boolean }) {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  ctl.a = setA;
  ctl.b = setB;
  const closeA = useCallback(() => {
    closes.push("a");
    if (!props.declineA) setA(false);
  }, [props.declineA]);
  const closeB = useCallback(() => {
    closes.push("b");
    setB(false);
  }, []);
  return h(Fragment, null, h(Dlg, { name: "A", open: a, onClose: closeA }), h(Dlg, { name: "B", open: b, onClose: closeB }));
}

function mount(node: React.ReactElement, strict = false) {
  closes.length = 0;
  const tree = h(AppRouterContext.Provider, { value: router }, node);
  return render(strict ? h(StrictMode, null, tree) : tree);
}

const isOpen = (name: string) => Boolean(document.querySelector(`[role=dialog][aria-label="${name}"]`));
/** A user input (the engine tells gestures apart by pointerdown/keydown). */
const tap = () => window.dispatchEvent(new window.Event("pointerdown"));

// --------------------------------------------------------------- index stamping

test("index: boot 0, push +1, replace and Next's refresh keep the stamp", () => {
  fresh("/uz");
  assert.equal(sx()?.i, 0);
  router.push("/uz/create");
  assert.equal(sx()?.i, 1);
  router.push("/uz/slide");
  assert.equal(sx()?.i, 2);
  router.replace("/uz/coursework");
  assert.equal(sx()?.i, 2, "replace keeps the slot");
  router.refresh();
  assert.equal(sx()?.i, 2, "router.refresh() would erase custom keys; the engine re-injects them");
  assert.equal((window.history.state as { __NA?: boolean }).__NA, true, "Next's keys pass through");
  assert.equal(nav.currentIndex(), 2);
  assert.equal(window.sessionStorage.getItem("sx:nav"), "2", "sessionStorage mirror");
});

test("index: survives a wipe that bypasses the wrapper (in-memory mirror), re-stamped on the next refresh", async () => {
  fresh("/uz");
  router.push("/uz/create");
  // A write straight to the native method (as if our wrapper were not in the chain).
  window.History.prototype.replaceState.call(window.history, { __NA: true }, "");
  assert.equal(sx(), undefined);
  assert.equal(nav.currentIndex(), 1, "memory still knows the index");
  router.refresh();
  assert.equal(sx()?.i, 1);
  // backTo still sees an in-app predecessor and goes back instead of replacing.
  await act(async () => {
    await nav.backTo();
  });
  await settle();
  assert.equal(here(), "/uz");
  assert.ok(!calls.some((c) => c.startsWith("replace")), calls.join(","));
});

test("index: reload keeps the stamped index; hard in-app navigation continues it; external referrer restarts at 0", () => {
  fresh("/uz");
  router.push("/uz/create");
  router.push("/uz/slide");
  // Reload: same entry, state survives, memory is gone.
  nav.__resetNavForTests();
  nav.installNav();
  assert.equal(nav.currentIndex(), 2);

  const ref = Object.getOwnPropertyDescriptor(window.Document.prototype, "referrer");
  try {
    // A new document reached from our own page (same-origin referrer): previous index + 1.
    nav.__resetNavForTests();
    window.history.pushState(null, "", "/uz/profile");
    Object.defineProperty(document, "referrer", { configurable: true, get: () => "http://localhost/uz/slide" });
    nav.installNav();
    assert.equal(nav.currentIndex(), 3);
    // From an external site: a fresh in-app run.
    nav.__resetNavForTests();
    window.history.pushState(null, "", "/uz/files/9");
    Object.defineProperty(document, "referrer", { configurable: true, get: () => "https://www.google.com/" });
    nav.installNav();
    assert.equal(nav.currentIndex(), 0);
  } finally {
    delete (document as unknown as Record<string, unknown>).referrer;
    if (ref) assert.ok(Object.getOwnPropertyDescriptor(window.Document.prototype, "referrer"));
  }
});

// --------------------------------------------------------------- backTo

test("backTo: fresh deep link → REPLACE with the parent (never history.back, never leaves the site)", async () => {
  fresh("/uz/create");
  const lengthBefore = window.history.length;
  let started = false;
  await act(async () => {
    started = await nav.backTo();
  });
  await settle();
  assert.equal(started, true);
  assert.deepEqual(calls, ["replace /uz"]);
  assert.equal(here(), "/uz");
  assert.equal(window.history.length, lengthBefore, "no new entry: back from /uz then leaves, no ping-pong");
  assert.equal(sx()?.i, 0);
});

test("backTo: in-app previous entry → history back; explicit fallback; nothing at a root", async () => {
  fresh("/uz");
  router.push("/uz/create");
  calls.length = 0;
  await act(async () => {
    await nav.backTo();
  });
  await settle();
  assert.equal(here(), "/uz");
  assert.deepEqual(calls, [], "went back, no replace/push");

  fresh("/uz/files/1");
  await act(async () => {
    await nav.backTo("/uz?filter=docs");
  });
  assert.deepEqual(calls, ["replace /uz?filter=docs"]);

  fresh("/uz/login?returnTo=%2Fuz%2Ffiles%2F7");
  await act(async () => {
    await nav.backTo();
  });
  assert.deepEqual(calls, ["replace /uz/files/7"], "safe returnTo as the parent");

  fresh("/uz");
  let started = true;
  await act(async () => {
    started = await nav.backTo();
  });
  assert.equal(started, false);
  assert.deepEqual(calls, []);
});

test("backTo with an overlay open on a fresh deep link: pops the overlay entry, then replaces the page", async () => {
  fresh("/uz/files/1");
  mount(h(Pair));
  act(() => ctl.a!(true));
  assert.equal(sx()?.i, 1);
  await act(async () => {
    await nav.backTo();
  });
  await settle();
  assert.deepEqual(calls, ["replace /uz/files"], "parent of the file page = the Ishlarim list (redesign F0)");
  assert.equal(here(), "/uz/files");
  assert.equal(sx()?.i, 0, "the page's base entry was replaced, not the overlay entry");
  assert.ok(!isOpen("A"), "the overlay closed with the page");
});

// --------------------------------------------------------------- overlay layer

test("overlay: open pushes one same-URL entry; back closes it, URL unchanged, Next never sees the pop", async () => {
  fresh("/uz");
  mount(h(Pair));
  const len = window.history.length;
  act(() => ctl.a!(true));
  assert.ok(isOpen("A"));
  assert.equal(window.history.length, len + 1);
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 1);
  assert.ok(sx()?.o, "entry carries the layer token");
  await settle();
  assert.equal(nav.getNavSnapshot().overlays, 1);

  window.history.back();
  await settle();
  assert.ok(!isOpen("A"));
  assert.deepEqual(closes, ["a"]);
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0);
  assert.deepEqual(nextSaw, [], "same-URL pop swallowed (no RESTORE that could cancel a navigation)");
  assert.equal(nav.getNavSnapshot().overlays, 0);
});

test("overlay: programmatic close pops exactly once (no double back)", async () => {
  fresh("/uz");
  router.push("/uz/create"); // an in-app page under the dialog, with /uz before it
  mount(h(Pair));
  act(() => ctl.a!(true));
  assert.equal(sx()?.i, 2);
  fireEvent.keyDown(window, { key: "Escape" });
  await settle();
  assert.deepEqual(closes, ["a"]);
  assert.equal(here(), "/uz/create", "a second back would have landed on /uz");
  assert.equal(sx()?.i, 1);
  assert.equal(nav.currentIndex(), 1);
  // Unmount while open also pops once.
  act(() => ctl.a!(true));
  assert.equal(sx()?.i, 2);
  cleanup();
  await settle();
  assert.equal(here(), "/uz/create");
  assert.equal(sx()?.i, 1);
});

test("overlay: nested dialogs unwind LIFO; Escape closes only the top one", async () => {
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true));
  act(() => ctl.b!(true));
  assert.equal(sx()?.i, 2);

  fireEvent.keyDown(window, { key: "Escape" });
  await settle();
  assert.deepEqual(closes, ["b"], "one Escape closes one dialog");
  assert.ok(isOpen("A"));
  assert.equal(sx()?.i, 1);

  act(() => ctl.b!(true));
  window.history.back();
  await settle();
  assert.deepEqual(closes, ["b", "b"], "back closes only the top dialog");
  assert.ok(isOpen("A"));
  window.history.back();
  await settle();
  assert.deepEqual(closes, ["b", "b", "a"]);
  assert.equal(sx()?.i, 0);
  assert.equal(here(), "/uz");
});

test("overlay: a dialog that declines to close gets its entry back", async () => {
  fresh("/uz");
  mount(h(Pair, { declineA: true }));
  act(() => ctl.a!(true));
  window.history.back();
  await settle();
  assert.deepEqual(closes, ["a"]);
  assert.ok(isOpen("A"));
  assert.equal(sx()?.i, 1, "re-armed");
  assert.ok(sx()?.o);
});

test("overlay: React StrictMode mounts twice but pushes one entry and pops one", async () => {
  fresh("/uz");
  router.push("/uz/create");
  const len = window.history.length;
  mount(h(Pair), true);
  act(() => ctl.a!(true));
  await settle();
  assert.equal(window.history.length, len + 1, "one entry despite the double effect");
  assert.equal(sx()?.i, 2);
  fireEvent.keyDown(window, { key: "Escape" });
  await settle();
  assert.equal(here(), "/uz/create");
  assert.equal(sx()?.i, 1);

  // An always-open dialog (TemplateGallery style) in StrictMode.
  function Always() {
    const [open, setOpen] = useState(true);
    const ref = useDialog(open, () => setOpen(false));
    return open ? h("div", { ref, role: "dialog", "aria-label": "G" }, "g") : null;
  }
  cleanup();
  await settle();
  const len2 = window.history.length;
  mount(h(Always), true);
  await settle();
  assert.equal(sx()?.i, 2);
  assert.ok(window.history.length <= len2 + 1);
  window.history.back();
  await settle();
  assert.ok(!isOpen("G"));
  assert.equal(here(), "/uz/create");
  assert.equal(sx()?.i, 1);
});

test("overlay: orphan entries (overlay gone after a navigation / reload) are skipped in the direction of travel", async () => {
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true)); // entry 1 = A
  tap(); // a later gesture navigates while the overlay is still open
  act(() => router.push("/uz/create")); // entry 2
  await settle();
  assert.ok(!isOpen("A"), "the abandoned overlay closes with the route change");
  assert.equal(sx()?.i, 2);

  // Reload on /uz/create: every in-memory layer is gone, the entries stay.
  nav.__resetNavForTests();
  nav.installNav();
  nav.setNavRouter(router);

  window.history.back();
  await settle();
  assert.equal(sx()?.i, 0, "the orphan (1) was skipped backwards");
  assert.equal(here(), "/uz");
  window.history.forward();
  await settle();
  assert.equal(sx()?.i, 2, "and forwards");
  assert.equal(here(), "/uz/create");
});

test("navigateFromOverlay: replaces the overlay entry (back returns to the page under it); plain push without overlay", async () => {
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true));
  act(() => nav.navigateFromOverlay("/uz/files/3"));
  await settle();
  assert.deepEqual(calls, ["replace /uz/files/3"]);
  assert.ok(!isOpen("A"));
  assert.equal(sx()?.i, 1);
  assert.equal(sx()?.o, undefined, "the new page's entry is not a layer entry");
  window.history.back();
  await settle();
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0);

  calls.length = 0;
  act(() => nav.navigateFromOverlay("/uz/create"));
  assert.deepEqual(calls, ["push /uz/create"]);
});

test("useDialog: an internal link inside the dialog replaces the dialog's entry", async () => {
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true));
  const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "A link")!;
  act(() => {
    fireEvent.click(link);
  });
  await settle();
  assert.deepEqual(closes, ["a"], "the dialog's own onClick still ran");
  assert.deepEqual(calls, ["replace /uz/create"]);
  assert.equal(sx()?.i, 1);
});

test("close(); router.push(): the navigation is not undone by the overlay's pop (both orders)", async () => {
  // Pop lands first (usual), then Next commits the push.
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true));
  act(() => ctl.a!(false));
  await settle();
  act(() => router.push("/uz/create"));
  await settle();
  assert.equal(here(), "/uz/create");
  assert.equal(sx()?.i, 1);
  window.history.back();
  await settle();
  assert.equal(here(), "/uz");

  // Next commits the push before our queued pop lands: the pop is hidden from Next and undone.
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true));
  act(() => ctl.a!(false)); // history.go(-1) is queued now
  router.push("/uz/create");
  await settle();
  assert.equal(here(), "/uz/create", "the user stays on the new page");
  assert.ok(!nextSaw.includes("/uz"), `Next saw: ${nextSaw.join(",")}`);
  window.history.back();
  await settle();
  assert.equal(here(), "/uz", "back from the new page skips the orphan overlay entry");
  assert.equal(sx()?.i, 0);
});

test("close(); router.refresh(): no popstate reaches Next (a RESTORE would discard the refresh)", async () => {
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true));
  act(() => {
    ctl.a!(false);
    router.refresh();
  });
  await settle();
  assert.deepEqual(nextSaw, []);
  assert.equal(sx()?.i, 0);
});

test("overlay: router.refresh() while open keeps the layer token; back still closes it", async () => {
  fresh("/uz");
  mount(h(Pair));
  act(() => ctl.a!(true));
  const token = sx()?.o;
  router.refresh();
  assert.equal(sx()?.o, token);
  window.history.back();
  await settle();
  assert.ok(!isOpen("A"));
  assert.equal(sx()?.i, 0);
});

test("overlay: a same-page URL change while open (`?id=`) is carried to the entry under it", async () => {
  fresh("/admin/audit");
  mount(h(Pair));
  act(() => ctl.a!(true));
  router.replace("/admin/audit?id=5");
  act(() => ctl.a!(false));
  await settle();
  assert.equal(here(), "/admin/audit?id=5", "closing the overlay does not resurrect the old URL");
  assert.equal(sx()?.i, 0);
  assert.deepEqual(nextSaw, []);
});

test("backTo between same-path entries (`?id=` pushed → list): Next sees the pop (no layer carry)", async () => {
  fresh("/admin/audit");
  router.push("/admin/audit?id=5");
  nextSaw.length = 0;
  await act(async () => {
    await nav.backTo();
  });
  await settle();
  assert.equal(here(), "/admin/audit");
  assert.deepEqual(nextSaw, ["/admin/audit"], "Next must render the list (useSearchParams updates)");

  // Same with a dialog open over the `?id=` page: the dialog pops with it, Next still sees the page change.
  fresh("/admin/audit");
  router.push("/admin/audit?id=7");
  mount(h(Pair));
  act(() => ctl.a!(true));
  nextSaw.length = 0;
  await act(async () => {
    await nav.backTo();
  });
  await settle();
  assert.equal(here(), "/admin/audit");
  assert.ok(!isOpen("A"));
  assert.deepEqual(nextSaw, ["/admin/audit"]);
});

test("useDialog {history:false}: no entry, Escape still closes", async () => {
  fresh("/uz");
  function UrlDrawer() {
    const [open, setOpen] = useState(true);
    const ref = useDialog(open, () => setOpen(false), { history: false });
    return open ? h("div", { ref, role: "dialog", "aria-label": "D" }, "d") : null;
  }
  const len = window.history.length;
  mount(h(UrlDrawer));
  await settle();
  assert.equal(window.history.length, len);
  assert.equal(sx()?.i, 0);
  fireEvent.keyDown(window, { key: "Escape" });
  assert.ok(!isOpen("D"));
});

test("useOverlayHistory directly (drawer/menu): back closes, onClose identity may change every render", async () => {
  fresh("/uz/create");
  let renders = 0;
  function Menu() {
    const [open, setOpen] = useState(false);
    ctl.m = setOpen;
    renders++;
    useOverlayHistory(open, () => setOpen(false)); // new function every render
    return open ? h("div", { role: "menu" }, "m") : null;
  }
  mount(h(Menu));
  act(() => ctl.m!(true));
  act(() => ctl.m!(true));
  assert.equal(sx()?.i, 1, "re-renders do not push again");
  window.history.back();
  await settle();
  assert.ok(!document.querySelector("[role=menu]"));
  assert.equal(here(), "/uz/create");
  assert.ok(renders >= 3);
});

test("overlay opened by the gesture that navigates (open login, then router.push) stays open on the new page", async () => {
  fresh("/uz");
  mount(h(Pair));
  tap();
  act(() => {
    ctl.a!(true);
  });
  act(() => router.push("/uz/create"));
  await settle();
  assert.ok(isOpen("A"), "meant for the destination");
  assert.equal(here(), "/uz/create");
  assert.ok(sx()?.o, "re-pushed on top of the new page");
  const top = sx()!.i;
  window.history.back();
  await settle();
  assert.ok(!isOpen("A"));
  assert.equal(here(), "/uz/create");
  assert.equal(sx()?.i, top - 1);
  window.history.back();
  await settle();
  assert.equal(here(), "/uz", "the stale entry under the new page is skipped");
  assert.equal(sx()?.i, 0);
});

test("NavProvider: the overlay store closes on a route change unless opened by that gesture or the new page", async () => {
  const { NavProvider } = await import("../../components/nav/NavProvider.tsx");
  const { useUi } = await import("../../lib/ui.ts");
  const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
  fresh("/uz");
  render(h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: "/uz" }, h(NavProvider))));
  await settle();

  tap();
  act(() => useUi.getState().open("notifications"));
  tap(); // a later click navigates
  act(() => router.push("/uz/create"));
  await settle();
  assert.equal(useUi.getState().overlay, null, "left-open overlay closed with the route change");

  tap();
  act(() => {
    useUi.getState().open("login", { returnTo: "/uz/slide" });
    router.push("/uz/slide");
  });
  await settle();
  assert.equal(useUi.getState().overlay, "login", "opened by the navigating gesture");
  act(() => useUi.getState().close());

  tap();
  act(() => router.push("/uz?returnTo=%2Fuz%2Fcreate"));
  act(() => useUi.getState().open("login", { returnTo: "/uz/create" })); // the new page opens it on mount
  await settle();
  assert.equal(useUi.getState().overlay, "login");

  tap();
  act(() => router.replace("/uz?filter=docs")); // same page: search-param state, not a route change
  await settle();
  assert.equal(useUi.getState().overlay, "login");
  act(() => useUi.getState().close());
});

test("navigateFromOverlay external: pops the overlay entry, then leaves; \"replace\" uses location.replace", async () => {
  const exits: Array<[string, boolean]> = [];
  nav.__setLeaveSiteForTests((href, replace) => exits.push([href, replace]));
  try {
    fresh("/uz/purchase");
    mount(h(Pair));
    act(() => ctl.a!(true));
    act(() => nav.navigateFromOverlay("https://pay.example/checkout?o=1", { external: "replace" }));
    await settle();
    assert.deepEqual(exits, [["https://pay.example/checkout?o=1", true]]);
    assert.equal(sx()?.i, 0, "the overlay entry was popped before leaving: the provider replaces the page entry");
    assert.equal(sx()?.o, undefined);

    act(() => nav.navigateFromOverlay("https://pay.example/other", { external: true }));
    assert.deepEqual(exits[1], ["https://pay.example/other", false], "plain external = assign");
  } finally {
    nav.__setLeaveSiteForTests(null);
  }
});

test("PayDialog sends the user to the checkout with location.replace", async () => {
  const { PayDialog } = await import("../../components/overlays/PayDialog.tsx");
  const { useUi } = await import("../../lib/ui.ts");
  const { useAppStore } = await import("../../lib/store.ts");
  const exits: Array<[string, boolean]> = [];
  nav.__setLeaveSiteForTests((href, replace) => exits.push([href, replace]));
  const realFetch = globalThis.fetch;
  try {
    fresh("/uz/purchase");
    useAppStore.setState({
      loggedIn: true,
      features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: true, payme: false } },
    } as never);
    (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) =>
      new Response(JSON.stringify(String(input) === "/api/payments/orders" ? { checkoutUrl: "https://my.click.uz/pay?x=1", orderId: "o1" } : {}), {
        status: String(input) === "/api/payments/orders" ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    mount(h(PayDialog));
    await act(async () => {
      useUi.getState().open("pay");
    });
    await settle();
    assert.ok(sx()?.o);
    const click = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Click"))!;
    fireEvent.click(click);
    await settle();
    await settle();
    assert.deepEqual(exits, [["https://my.click.uz/pay?x=1", true]]);
    assert.equal(sx()?.o, undefined, "dialog entry popped first");
  } finally {
    nav.__setLeaveSiteForTests(null);
    globalThis.fetch = realFetch;
    useUi.getState().close();
  }
});

test("/uz/files/[id] «←» restores the Ishlarim view (/uz/files?filter&sort&desc) the user last had", async () => {
  // Redesign F0: the list moved from /uz to /uz/files; the file page's parent is the list.
  fresh("/uz/files");
  router.replace("/uz/files?filter=docs&sort=name&desc=0&returnTo=%2Fuz%2Fcreate");
  router.push("/uz/files/9");
  assert.equal(nav.parentHref("/uz/files/9"), "/uz/files?filter=docs&sort=name&desc=0", "view keys only, no returnTo");
  assert.equal(nav.parentHref("/uz/create"), "/uz", "only the file page goes back to the filtered list");

  // A later visit to the list without filters resets the memory.
  router.push("/uz/files");
  assert.equal(nav.parentHref("/uz/files/9"), "/uz/files");
  router.replace("/uz/files?filter=image");
  // Bosh (/uz) with search params is not the list: it does not overwrite the memory.
  router.push("/uz?filter=docs");
  assert.equal(nav.parentHref("/uz/files/9"), "/uz/files?filter=image");

  // Reload on the file page with no in-app history (memory lives in sessionStorage): backTo replaces with it.
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/files/9");
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
  await act(async () => {
    await nav.backTo();
  });
  assert.deepEqual(calls, ["replace /uz/files?filter=image"]);
});

test("previousPagePath: the page under the current one (overlay entries skipped), null on a fresh run; survives a reload", async () => {
  fresh("/uz");
  assert.equal(nav.previousPagePath(), null, "first entry");
  router.push("/uz/files");
  assert.equal(nav.previousPagePath(), "/uz");
  router.replace("/uz/wallet");
  assert.equal(nav.previousPagePath(), "/uz", "replace keeps the entry under it");
  const token = nav.pushLayer("overlay", () => {});
  await settle();
  assert.equal(nav.previousPagePath(), "/uz", "an overlay entry on top does not count");
  nav.releaseLayer(token);
  await settle();
  router.push("/uz/profile");
  assert.equal(nav.previousPagePath(), "/uz/wallet");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.equal(window.location.pathname, "/uz/wallet");
  assert.equal(nav.previousPagePath(), "/uz", "after a traversal");
  // Reload (same stamped entry): the paths come back from sessionStorage.
  nav.__resetNavForTests();
  nav.installNav();
  nav.setNavRouter(router);
  assert.equal(nav.previousPagePath(), "/uz");
  // A push truncates the forward entries.
  router.push("/uz/files");
  assert.equal(nav.previousPagePath(), "/uz/wallet");
  // Two pushes in a row: the entry under the page is the first push's page.
  router.push("/uz/profile");
  assert.equal(nav.previousPagePath(), "/uz/files");
});

test("replacePage: replaces the page entry itself, popping an open overlay's entry first", async () => {
  fresh("/uz");
  router.push("/uz/files");
  const closed: string[] = [];
  nav.pushLayer("overlay", () => closed.push("sheet"));
  await settle();
  assert.ok(sx()?.o);
  calls.length = 0;
  await act(async () => {
    await nav.replacePage("/uz/wallet");
  });
  await settle();
  assert.deepEqual(calls, ["replace /uz/wallet"]);
  assert.equal(here(), "/uz/wallet");
  assert.equal(sx()?.i, 1, "the page entry (index 1) was replaced, not the overlay entry above it");
  assert.ok(!sx()?.o);
  assert.deepEqual(closed, ["sheet"], "the overlay was closed");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.equal(here(), "/uz", "back → Bosh");
});
