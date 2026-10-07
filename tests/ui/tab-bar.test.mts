import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * Bottom tab bar (docs/redesign/PLAN.md F0): routes, active state, where it is
 * hidden (routes, keyboard, modal), 44 px targets, and what a tap does to the
 * history — with the real nav engine (`lib/nav/history.ts`) under a router stub
 * that writes real jsdom history entries. The page path the components see
 * follows the engine (`Live`), like Next's pathname follows the URL.
 *
 * Mutations (each turned this file red, see the F0 report):
 *   - `useTabBarState`: drop the route check / the keyboard check / the overlay check;
 *   - `useTabBarState`: count the «+» sheet as a modal (the bar would vanish under its own sheet);
 *   - TabBar: `aria-current` on every tab / never; tabs `min-h-11` → `min-h-8`;
 *   - TabBar `onTab`: always `router.push` (history grows, back from Hamyon lands on Ishlarim);
 *   - TabBar `onTab`: no `preventDefault` for the scroll-top case (navigates to itself);
 *   - AppShell: `--tabbar-h` always `var(--tabbar-room)`; no bottom room spacer;
 *   - history.ts `recordPath` not called on push (previousPagePath null → Bosh replaces).
 */

const nav = await import("../../lib/nav/history.ts");
const { AppShell } = await import("../../components/shell/AppShell.tsx");
const { NavProvider } = await import("../../components/nav/NavProvider.tsx");
const { useUi } = await import("../../lib/ui.ts");
const { useAppStore } = await import("../../lib/store.ts");

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

const win = window as unknown as { matchMedia?: unknown; visualViewport?: unknown };
const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
const here = () => window.location.pathname + window.location.search;
const tap = () => window.dispatchEvent(new window.Event("pointerdown"));

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
  delete win.matchMedia;
  delete win.visualViewport;
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({ loggedIn: false, user: null, sessionChecked: false });
});

/** The app router + a pathname that follows the URL (as Next's does). */
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
  return render(h(Live, null, h(AppShell, null, h("div", { "data-page-body": "" }, "sahifa"))));
}

const bar = () => document.querySelector<HTMLElement>("[data-tabbar]")!;
const tabLink = (id: string) => document.querySelector<HTMLAnchorElement>(`[data-tab="${id}"]`)!;
const plus = () => document.querySelector<HTMLButtonElement>("[data-create-button]")!;
const shown = () => !bar().hasAttribute("data-hidden");
const cls = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const has = (el: Element | null, c: string) => cls(el).includes(c);

async function clickTab(id: string) {
  tap();
  await act(async () => {
    fireEvent.click(tabLink(id));
  });
  await settle();
}

// ------------------------------------------------------------------ structure

test("Bosh · Ishlarim · [+] · Hamyon · Profil: four tab links and the «+» button in the middle", async () => {
  fresh("/uz");
  shell();
  await settle();
  const cells = [...bar().querySelectorAll("[data-tab], [data-create-button]")];
  assert.deepEqual(
    cells.map((c) => c.getAttribute("data-tab") ?? "+"),
    ["bosh", "ishlarim", "+", "hamyon", "profil"],
  );
  assert.deepEqual(
    ["bosh", "ishlarim", "hamyon", "profil"].map((id) => tabLink(id).getAttribute("href")),
    ["/uz", "/uz/files", "/uz/wallet", "/uz/profile"],
  );
  assert.deepEqual(
    ["bosh", "ishlarim", "hamyon", "profil"].map((id) => tabLink(id).textContent),
    ["Bosh", "Ishlarim", "Hamyon", "Profil"],
  );
  assert.equal(bar().tagName, "NAV");
  assert.equal(bar().getAttribute("aria-label"), "Asosiy bo‘limlar");
  assert.equal(plus().tagName, "BUTTON");
  assert.equal(plus().getAttribute("aria-label"), "Yaratish");
  assert.equal(plus().getAttribute("aria-expanded"), "false");
  assert.equal(plus().getAttribute("aria-haspopup"), "dialog");
});

test("active tab: aria-current=page and the accent chip on exactly one tab, nested routes included", async () => {
  const rows: Array<[string, string | null]> = [
    ["/uz", "bosh"],
    ["/uz/files", "ishlarim"],
    ["/uz/wallet", "hamyon"],
    ["/uz/profile", "profil"],
    ["/uz/profile/korinish", "profil"],
    ["/uz/create", null],
  ];
  for (const [path, id] of rows) {
    fresh(path);
    const view = shell();
    await settle();
    const current = [...document.querySelectorAll("[data-tab][aria-current]")];
    assert.deepEqual(current.map((c) => c.getAttribute("data-tab")), id ? [id] : [], path);
    if (id) assert.equal(tabLink(id).getAttribute("aria-current"), "page");
    for (const t of ["bosh", "ishlarim", "hamyon", "profil"]) {
      const chip = tabLink(t).querySelector("[data-tab-chip]");
      assert.equal(has(chip, "bg-accent-soft"), t === id, `${path}: chip of ${t}`);
    }
    view.unmount();
  }
});

test("targets: every tab is a ≥ 44 px cell of the 64 px bar, the «+» is 56 px with a 20 px radius and a 4 px page-coloured ring", async () => {
  fresh("/uz");
  shell();
  await settle();
  const pill = bar().firstElementChild;
  assert.ok(has(pill, "h-16") && has(pill, "grid-cols-5"), "64 px bar, five equal cells");
  assert.ok(has(pill, "max-w-[560px]") && has(pill, "w-full"), "floating pill: full width on phones, ≤ 560 px centred on wide screens");
  assert.ok(has(bar(), "justify-center") && has(bar(), "fixed") && has(bar(), "bottom-0"));
  for (const id of ["bosh", "ishlarim", "hamyon", "profil"]) {
    const a = tabLink(id);
    assert.ok(has(a, "min-h-11"), `${id}: ≥ 44 px`);
    assert.ok(has(a, "focus-visible:ring-2"), `${id}: keyboard focus ring`);
    const label = a.lastElementChild;
    assert.ok(has(label, "text-[12px]"), `${id}: 12 px label`);
  }
  for (const c of ["size-14", "rounded-[20px]", "ring-4", "ring-[var(--page-bg)]", "-mt-3"]) assert.ok(has(plus(), c), `«+»: ${c}`);
  assert.ok(cls(plus()).some((c) => c.startsWith("focus-visible:outline")), "«+» keyboard focus ring");
});

test("safe areas: the bar sits above the home indicator (Telegram var, env() fallback) and inside the side insets", async () => {
  fresh("/uz");
  shell();
  await settle();
  const style = bar().getAttribute("style") ?? "";
  assert.match(style, /padding-bottom: calc\(var\(--tg-safe-bottom, env\(safe-area-inset-bottom, 0px\)\) \+ 0\.5rem\)/);
  assert.match(style, /--tg-safe-left/);
  assert.match(style, /--tg-safe-right/);
  // The shell keeps every page below the notch / Telegram header (the old TopBar did it).
  const strip = document.querySelector<HTMLElement>("[data-top-inset]")!;
  assert.match(strip.getAttribute("style") ?? "", /--tg-safe-top.*env\(safe-area-inset-top.*--tg-content-safe-top/);
});

// ------------------------------------------------------------------ where it shows

test("shown on the tab pages and /uz/create; hidden (inert, aria-hidden, --tabbar-h 0, no bottom room) on tool forms, the result page and login", async () => {
  const rows: Array<[string, boolean]> = [
    ["/uz", true],
    ["/uz/files", true],
    ["/uz/wallet", true],
    ["/uz/profile", true],
    ["/uz/profile/shaxsiy", true],
    ["/uz/create", true],
    ["/uz/slide", false],
    ["/uz/referat", false],
    ["/uz/files/3f1c2a9e", false],
    ["/uz/login", false],
  ];
  for (const [path, on] of rows) {
    fresh(path);
    const view = shell();
    await settle();
    assert.equal(shown(), on, `${path}: bar`);
    assert.equal(bar().hasAttribute("inert"), !on, `${path}: inert when hidden`);
    assert.equal(bar().getAttribute("aria-hidden"), on ? null : "true", `${path}: aria-hidden when hidden`);
    const root = document.querySelector<HTMLElement>("[data-app-shell]")!;
    assert.equal(root.getAttribute("data-tabbar-state"), on ? "on" : "off");
    assert.equal(root.style.getPropertyValue("--tabbar-h"), on ? "var(--tabbar-room)" : "0px", `${path}: --tabbar-h`);
    const roomEl = document.querySelector("#main > [data-tabbar-room]");
    assert.equal(Boolean(roomEl), on, `${path}: bottom room under the page`);
    view.unmount();
  }
});

test("bottom room: the page ends in a spacer of --tabbar-h + the safe area (a spacer, never padding on <main>)", async () => {
  fresh("/uz/files");
  shell();
  await settle();
  const main = document.getElementById("main")!;
  const spacer = main.querySelector<HTMLElement>("[data-tabbar-room]")!;
  assert.equal(main.lastElementChild, spacer, "last child of the scroller");
  assert.equal(spacer.getAttribute("aria-hidden"), "true");
  assert.ok(spacer.className.includes("h-[calc(var(--tabbar-h,0px)+var(--tg-safe-bottom,env(safe-area-inset-bottom,0px)))]"));
  assert.ok(!/(^|\s)pb-/.test(main.className), "no bottom padding on the scroller");
});

function touchKeyboard() {
  win.matchMedia = (q: string) => ({ matches: q.includes("pointer: coarse") || q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const listeners: Array<() => void> = [];
  const vv = {
    height: 740,
    offsetTop: 0,
    scale: 1,
    addEventListener: (_: string, l: () => void) => void listeners.push(l),
    removeEventListener() {},
  };
  win.visualViewport = vv;
  return async (open: boolean) => {
    vv.height = open ? 300 : window.innerHeight;
    await act(async () => {
      for (const l of listeners) l();
      window.dispatchEvent(new window.Event("resize"));
    });
    await settle();
  };
}

test("touch: the on-screen keyboard hides the bar (and frees its room); closing the keyboard brings it back", async () => {
  const keyboard = touchKeyboard();
  fresh("/uz/profile");
  shell();
  await settle();
  assert.ok(shown(), "keyboard closed");
  await keyboard(true);
  assert.ok(!shown(), "keyboard open: hidden");
  assert.equal(document.querySelector<HTMLElement>("[data-app-shell]")!.style.getPropertyValue("--tabbar-h"), "0px");
  await keyboard(false);
  assert.ok(shown(), "keyboard closed again");
});

test("a modal dialog hides the bar; the «+» sheet does not (the «+» turns into «×»)", async () => {
  fresh("/uz");
  shell();
  await settle();
  await act(async () => {
    useUi.getState().open("search");
  });
  await settle();
  assert.ok(!shown(), "search dialog open: hidden");
  await act(async () => {
    useUi.getState().close();
  });
  await settle();
  assert.ok(shown(), "closed: back");
  tap();
  await act(async () => {
    fireEvent.click(plus());
  });
  await settle();
  assert.equal(useUi.getState().overlay, "create");
  assert.ok(shown(), "the bar stays above its own sheet");
  assert.equal(plus().getAttribute("aria-label"), "Yopish");
  assert.equal(plus().getAttribute("aria-expanded"), "true");
  assert.equal(plus().getAttribute("aria-controls"), "create-sheet");
  assert.ok(has(plus().querySelector("svg"), "rotate-45"), "+ rotated into ×");
  tap();
  await act(async () => {
    fireEvent.click(plus());
  });
  await settle();
  assert.equal(useUi.getState().overlay, null, "× closes it");
  assert.ok(!sx()?.o, "its history entry is gone");
});

// ------------------------------------------------------------------ history

test("history: Bosh → Ishlarim pushes, Ishlarim → Hamyon replaces, back lands on Bosh", async () => {
  fresh("/uz");
  shell();
  await settle();
  await clickTab("ishlarim");
  assert.equal(here(), "/uz/files");
  assert.equal(sx()?.i, 1, "a new entry above Bosh");
  await clickTab("hamyon");
  assert.equal(here(), "/uz/wallet");
  assert.equal(sx()?.i, 1, "replaced, not stacked");
  assert.deepEqual(calls, ["push /uz/files", "replace /uz/wallet"]);
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.equal(here(), "/uz", "back from Hamyon → Bosh");
  assert.equal(sx()?.i, 0);
});

test("history: a tab → Bosh goes BACK when the entry under it is Bosh (no second Bosh entry)", async () => {
  fresh("/uz");
  shell();
  await settle();
  await clickTab("profil");
  calls.length = 0;
  await clickTab("bosh");
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0, "back to the first entry");
  assert.deepEqual(calls, [], "no push / replace: a history traversal");
});

test("history: on a deep link (no in-app entry under it) a tab → Bosh REPLACES, so Bosh becomes the root", async () => {
  fresh("/uz/wallet");
  shell();
  await settle();
  await clickTab("bosh");
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0);
  assert.deepEqual(calls, ["replace /uz"]);
});

test("the active tab again: #main scrolls to the top, no navigation", async () => {
  fresh("/uz/files");
  shell();
  await settle();
  const main = document.getElementById("main")! as HTMLElement & { scrollTo: (o: ScrollToOptions) => void };
  const scrolled: ScrollToOptions[] = [];
  main.scrollTo = (o: ScrollToOptions) => void scrolled.push(o);
  const len = window.history.length;
  const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  await act(async () => {
    tabLink("ishlarim").dispatchEvent(ev);
  });
  await settle();
  assert.ok(ev.defaultPrevented, "the link does not navigate to itself");
  assert.deepEqual(scrolled, [{ top: 0, behavior: "smooth" }]);
  assert.equal(window.history.length, len);
  assert.deepEqual(calls, []);
});

test("a modified click (Ctrl / middle) is left to the browser: no preventDefault, no in-app navigation", async () => {
  fresh("/uz");
  shell();
  await settle();
  const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
  // Next's Link also bails out on a modified click; stop jsdom from following the href.
  tabLink("hamyon").addEventListener("click", (e) => e.stopPropagation(), { once: true });
  await act(async () => {
    tabLink("hamyon").dispatchEvent(ev);
  });
  assert.deepEqual(calls, []);
  assert.equal(here(), "/uz");
});

test("with the «+» sheet open, a tab tap closes it and the tab lands right above Bosh (the sheet entry is replaced)", async () => {
  fresh("/uz");
  shell();
  await settle();
  tap();
  await act(async () => {
    fireEvent.click(plus());
  });
  await settle();
  assert.ok(sx()?.o, "sheet entry");
  await clickTab("ishlarim");
  assert.equal(here(), "/uz/files");
  assert.equal(useUi.getState().overlay, null, "sheet closed");
  assert.equal(sx()?.i, 1);
  assert.ok(!sx()?.o);
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.equal(here(), "/uz", "back → Bosh, not a dead sheet entry");
});

test("page enter: the page wrapper animates on route changes, sliding only between tab roots", async () => {
  fresh("/uz");
  shell();
  await settle();
  const page = document.querySelector<HTMLElement>("[data-page]")!;
  assert.equal(page.dataset.dir, "initial", "first paint: no animation");
  assert.ok(page.classList.contains("slx-page-enter"));
  await clickTab("hamyon");
  assert.equal(page.dataset.dir, "left", "to a tab further right");
  await clickTab("ishlarim");
  assert.equal(page.dataset.dir, "right");
  assert.ok(page.classList.contains("slx-page-enter"), "class re-applied (animation restarted)");
  assert.ok(document.querySelector("[data-page] [data-page-body]"), "the page itself is not remounted elsewhere");
});
