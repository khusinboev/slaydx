import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * «Tepaga chiqish» (todo T2): `ScrollToTop` listens on the page scroller
 * (`<main id="main">` of the app shell), shows after 1.5 screens, hides near the
 * top, scrolls to 0 on click, resets on route change, stays away while an
 * overlay is open and clears the bottom bars. jsdom has no layout, so the
 * scroller's `scrollTop`/`clientHeight` and the bars' rects are faked; the real
 * pixels come from the Chromium smoke.
 *
 * Mutations (each turned this file red, see the sprint report):
 *   - listen on `window` instead of the container;
 *   - drop the `overlays > 0` check (dialogs and the shell's drawer both own a nav layer);
 *   - drop `pathname` from the effect deps (no route reset);
 *   - ignore `prefers-reduced-motion` (always smooth);
 *   - click does not scroll to 0 (`top: 0` → `top: 1`);
 *   - drop the lift (`liftAbove` result unused);
 *   - AppShell: drop `ref={setScroller}` (the shell never hands the scroller over);
 *   - drop the effect cleanup (listener stays on the old container);
 *   - `ScrollToTopButton` without `useVisualViewport` (no `--kb-h` above the keyboard).
 */

const nav = await import("../../lib/nav/history.ts");
const { ScrollToTop } = await import("../../components/shell/ScrollToTop.tsx");
const { AppShell } = await import("../../components/shell/AppShell.tsx");
const { useUi } = await import("../../lib/ui.ts");
const { useAppStore } = await import("../../lib/store.ts");

const win = window as unknown as Record<string, unknown>;
// The shared jsdom setup does not expose MutationObserver; the component watches for bars with it.
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.MutationObserver !== "function") g.MutationObserver = win.MutationObserver;

const tree = (href: string) => ["", { children: [href] }];
const router = {
  push(href: string) {
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  replace(href: string) {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  refresh() {},
  back() {
    window.history.back();
  },
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

function inRouter(node: React.ReactElement, pathname = "/uz") {
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(PathnameContext.Provider, { value: pathname }, h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, node)),
  );
}

const frames = () => new Promise((r) => setTimeout(r, 12));
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await frames();
  });
}

function fresh(path = "/uz") {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
}

/** Rects the fake layout hands out (jsdom returns zeros). */
const rects = new Map<Element, { top: number; bottom: number; left?: number; right?: number }>();
const realRect = window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const r = rects.get(this);
  if (!r) return realRect.call(this);
  const left = r.left ?? 0;
  const right = r.right ?? 100;
  return { ...r, left, right, width: right - left, height: r.bottom - r.top, x: left, y: r.top, toJSON() {} } as DOMRect;
};

const realFetch = globalThis.fetch;
afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  rects.clear();
  delete win.matchMedia;
  delete win.visualViewport;
  document.documentElement.style.removeProperty("--kb-h");
  document.documentElement.style.removeProperty("--vv-h");
  document.body.innerHTML = "";
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({ loggedIn: false, user: null });
  globalThis.fetch = realFetch;
});

type Scroller = HTMLElement & { fake: { top: number; height: number }; scrolled: Array<{ top?: number; behavior?: string }> };

/** A scroll container with a controllable `scrollTop` / `clientHeight` and a recording `scrollTo`. */
function fakeScroller(el: HTMLElement = document.createElement("div"), height = 740): Scroller {
  const fake = { top: 0, height };
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => fake.top, set: (v: number) => (fake.top = v) });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => fake.height });
  const scrolled: Scroller["scrolled"] = [];
  (el as unknown as { scrollTo: (o: { top?: number; behavior?: string }) => void }).scrollTo = (o) => {
    scrolled.push(o);
    fake.top = o.top ?? fake.top;
    el.dispatchEvent(new window.Event("scroll"));
  };
  return Object.assign(el, { fake, scrolled });
}

/** The scroller `mount()` last mounted: `scrollTo(top)` drives it, `scrollTo(sc, top)` drives another. */
let current: Scroller | null = null;

async function scrollTo(a: Scroller | number, b?: number) {
  const sc = typeof a === "number" ? current! : a;
  const top = typeof a === "number" ? a : b!;
  sc.fake.top = top;
  await act(async () => {
    sc.dispatchEvent(new window.Event("scroll"));
    await frames();
  });
}

const button = () => document.querySelector<HTMLButtonElement>("[data-scroll-top]");
const anchor = () => document.querySelector<HTMLElement>("[data-scroll-top-anchor]");

function mount(sc: Scroller, pathname = "/uz") {
  current = sc;
  document.body.appendChild(sc);
  const view = render(inRouter(h(ScrollToTop, { container: sc }), pathname));
  return {
    view,
    rerender(next: { container?: HTMLElement | null }, path = pathname) {
      view.rerender(inRouter(h(ScrollToTop, { container: next.container === undefined ? sc : next.container }), path));
    },
  };
}

function stubMedia(match: (q: string) => boolean) {
  win.matchMedia = (q: string) => ({
    matches: match(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

/* --------------------------------------------------------------- visibility */

test("hidden until 1.5 screens, shown beyond, hidden again near the top", async () => {
  fresh();
  const sc = fakeScroller(); // 740 px tall: shows from 1110
  mount(sc);
  await settle();
  assert.ok(!button(), "page not scrolled: no button");
  await scrollTo(500);
  assert.ok(!button(), "half a screen");
  await scrollTo(1000);
  assert.ok(!button(), "1.35 screens: still hidden (scrolling down)");
  await scrollTo(1150);
  assert.ok(button(), "past 1.5 screens: shown");
  await scrollTo(800);
  assert.ok(button(), "inside the hysteresis band it stays");
  await scrollTo(300);
  assert.ok(!button(), "near the top: hidden");
  await scrollTo(0);
  assert.ok(!button());
});

test("the 600 px floor: a short window shows the button only past 600 px", async () => {
  fresh();
  const sc = fakeScroller(document.createElement("div"), 320);
  mount(sc);
  await scrollTo(590);
  assert.ok(!button(), "590 < 600");
  await scrollTo(620);
  assert.ok(button(), "620 ≥ 600");
});

test("scrolling UP reveals it earlier than the downward threshold", async () => {
  fresh();
  const sc = fakeScroller(); // show ≥ 1110, hide < 555, up-reveal ≥ 740
  mount(sc);
  await scrollTo(1000);
  assert.ok(!button(), "downward in the band: hidden");
  await scrollTo(900);
  assert.ok(button(), "now scrolling up from 1000 to 900 (≥ one screen): shown");
  await scrollTo(500);
  assert.ok(!button(), "near the top again: hidden");
});

test("no layout effect where the page never passes the threshold: nothing mounted, no listeners on the viewport", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(200);
  await settle();
  assert.ok(!button());
  assert.ok(!anchor());
  assert.equal(document.documentElement.style.getPropertyValue("--kb-h"), "", "the keyboard variables are only kept while the button is mounted");
});

/* ------------------------------------------------------------------- button */

test("the button: 44 px round up-arrow, aria-label «Tepaga chiqish», keyboard-reachable, below the dialogs", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(2000);
  const b = button()!;
  assert.ok(b);
  assert.equal(b.tagName, "BUTTON");
  assert.equal(b.getAttribute("type"), "button");
  assert.equal(b.getAttribute("aria-label"), "Tepaga chiqish");
  assert.equal(b.getAttribute("title"), "Tepaga chiqish");
  assert.ok(b.classList.contains("size-11"), "44 × 44 px");
  assert.ok(b.classList.contains("rounded-full"));
  assert.ok(b.querySelector("svg"), "lucide arrow icon");
  assert.equal(b.querySelector("svg")!.getAttribute("aria-hidden"), "true");
  assert.ok(b.getAttribute("tabindex") === null || b.tabIndex >= 0, "focusable");
  const a = anchor()!;
  assert.ok(a.classList.contains("fixed"));
  assert.ok(a.classList.contains("z-30"), "below the drawer (z-40) and the dialogs / sheets (z-50+)");
  // Theme tokens, not fixed colours: works in light and dark.
  assert.ok(b.classList.contains("bg-card") && b.classList.contains("text-foreground"));
  // Dark: the card token is almost the page colour, so the fill and the border are lifted explicitly.
  assert.ok(b.className.includes("dark:bg-[#") && b.className.includes("dark:border-white/"), "visible against the dark page");
});

test("position: above the safe areas (Telegram vars with env() fallbacks) and the keyboard", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(2000);
  const style = anchor()!.getAttribute("style") ?? "";
  assert.ok(style.includes("--tg-safe-bottom"), "Telegram bottom safe area");
  assert.ok(style.includes("env(safe-area-inset-bottom"), "env() fallback");
  assert.ok(style.includes("--kb-h"), "lifted by the keyboard variable");
  assert.ok(style.includes("--tg-safe-right") && style.includes("env(safe-area-inset-right"), "right safe area");
  assert.ok(document.documentElement.style.getPropertyValue("--kb-h") !== "", "`useVisualViewport` keeps --kb-h alive while the button is mounted");
  await scrollTo(0);
  assert.equal(document.documentElement.style.getPropertyValue("--kb-h"), "", "released when the button goes");
});

test("click scrolls the container to the top, smoothly", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(3000);
  await act(async () => {
    fireEvent.click(button()!);
    await frames();
  });
  assert.deepEqual(sc.scrolled, [{ top: 0, behavior: "smooth" }]);
  assert.equal(sc.fake.top, 0);
  assert.ok(!button(), "the scroll reached the top: the button is gone");
});

test("prefers-reduced-motion: the jump is instant", async () => {
  fresh();
  stubMedia((q) => q.includes("prefers-reduced-motion"));
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(3000);
  await act(async () => {
    fireEvent.click(button()!);
    await frames();
  });
  assert.deepEqual(sc.scrolled, [{ top: 0, behavior: "auto" }]);
});

test("a container without scrollTo (old webview) is reset through scrollTop", async () => {
  fresh();
  const sc = fakeScroller();
  (sc as unknown as { scrollTo?: unknown }).scrollTo = undefined;
  mount(sc);
  await scrollTo(3000);
  await act(async () => {
    fireEvent.click(button()!);
    await frames();
  });
  assert.equal(sc.fake.top, 0);
});

test("keyboard activation hands the focus to the start of the page", async () => {
  fresh();
  const sc = fakeScroller();
  const first = document.createElement("a");
  first.href = "/uz";
  first.textContent = "Orqaga";
  sc.appendChild(first);
  mount(sc);
  await scrollTo(3000);
  button()!.focus();
  await act(async () => {
    fireEvent.click(button()!, { detail: 0 }); // Enter / Space → click with detail 0
    await frames();
  });
  assert.equal(document.activeElement, first, "the next Tab continues from the top of the page");
});

test("a pointer tap (detail 1) does not move the focus", async () => {
  fresh();
  const sc = fakeScroller();
  const first = document.createElement("a");
  first.href = "/uz";
  sc.appendChild(first);
  mount(sc);
  await scrollTo(3000);
  await act(async () => {
    fireEvent.click(button()!, { detail: 1 });
    await frames();
  });
  assert.notEqual(document.activeElement, first);
});

/* ---------------------------------------------------------- what it listens to */

test("it listens on the container: window scroll and inner scrollers are ignored", async () => {
  fresh();
  const sc = fakeScroller();
  const inner = fakeScroller(document.createElement("div"), 300);
  sc.appendChild(inner);
  mount(sc);
  // An inner scroller (slide stage, panel body, chip row) scrolls a long way.
  await scrollTo(inner, 5000);
  assert.ok(!button(), "inner scroller: nothing");
  // The window scrolling does not matter either.
  await act(async () => {
    window.dispatchEvent(new window.Event("scroll"));
    await frames();
  });
  assert.ok(!button());
  await scrollTo(sc, 2000);
  assert.ok(button(), "the page scroller: shown");
});

test("a container swap re-attaches: the old container stops driving the button", async () => {
  fresh();
  const a = fakeScroller();
  const b = fakeScroller();
  const m = mount(a);
  document.body.appendChild(b);
  await scrollTo(a, 2000);
  assert.ok(button());
  m.rerender({ container: b });
  await settle();
  assert.ok(!button(), "new container starts at the top");
  await scrollTo(a, 3000);
  assert.ok(!button(), "the old container is no longer listened to");
  await scrollTo(b, 2000);
  assert.ok(button());
  m.rerender({ container: null });
  await settle();
  assert.ok(!button(), "no container: no button");
});

test("unmount removes the listeners", async () => {
  fresh();
  const sc = fakeScroller();
  const removed: string[] = [];
  const realRemove = sc.removeEventListener.bind(sc);
  sc.removeEventListener = ((type: string, ...rest: unknown[]) => {
    removed.push(type);
    return (realRemove as (...a: unknown[]) => void)(type, ...rest);
  }) as typeof sc.removeEventListener;
  const m = mount(sc);
  await scrollTo(2000);
  m.view.unmount();
  assert.ok(removed.includes("scroll"));
});

/* ------------------------------------------------------------------ route change */

test("route change: hidden at once, and re-read after the new page settled (reset vs restore)", async () => {
  fresh();
  const sc = fakeScroller();
  const m = mount(sc, "/uz");
  await scrollTo(2000);
  assert.ok(button());
  // The new page opens at the top (what a push does).
  sc.fake.top = 0;
  await act(async () => {
    m.rerender({}, "/uz/create");
  });
  assert.ok(!button(), "hidden in the same commit as the route change");
  await settle();
  assert.ok(!button(), "new page at the top: stays hidden");
  // Back navigation restores a deep position: shown once the scroll settled.
  sc.fake.top = 2500;
  await act(async () => {
    m.rerender({}, "/uz/files/1");
  });
  assert.ok(!button(), "hidden while the restore runs");
  await settle();
  assert.ok(button(), "restored deep position: the button is back");
});

/* ------------------------------------------------------------------ overlays */

test("an open dialog (nav overlay layer) hides it; closing the dialog brings it back", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(2000);
  assert.ok(button());
  let token = "";
  await act(async () => {
    token = nav.pushLayer("overlay", () => {});
  });
  await settle();
  assert.ok(!button(), "overlay open");
  await act(async () => {
    nav.releaseLayer(token);
  });
  await settle();
  assert.ok(button(), "overlay closed");
});

test("a leave guard is not an overlay: the button stays", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(2000);
  let token = "";
  await act(async () => {
    token = nav.pushLayer("guard", () => {});
  });
  await settle();
  assert.ok(button());
  await act(async () => {
    nav.releaseLayer(token);
  });
});

/* ------------------------------------------------------------------ typing (M1) */

const coarse = () => stubMedia((q) => q.includes("pointer: coarse"));

/** A scroller with a long page scrolled deep and one control inside; returns both. */
async function deepWith(make: () => HTMLElement, inside = true) {
  const sc = fakeScroller();
  const el = make();
  (inside ? sc : document.body).appendChild(el);
  mount(sc);
  await scrollTo(2000);
  assert.ok(button(), "precondition: the button is shown");
  return { sc, el };
}

async function focusEl(el: HTMLElement) {
  await act(async () => {
    el.focus();
    await frames();
  });
}
async function blurEl(el: HTMLElement) {
  await act(async () => {
    el.blur();
    await frames();
  });
}

const input = (type?: string) => () => {
  const i = document.createElement("input");
  if (type) i.type = type;
  return i;
};

for (const [name, make] of [
  ["text input", input()],
  ["search input", input("search")],
  ["tel input", input("tel")],
  ["number input", input("number")],
  ["textarea", () => document.createElement("textarea")],
  [
    "contentEditable",
    () => {
      const d = document.createElement("div");
      d.tabIndex = 0;
      // jsdom does not implement `isContentEditable`.
      Object.defineProperty(d, "isContentEditable", { value: true });
      return d;
    },
  ],
] as const) {
  test(`touch: a focused ${name} inside the page hides the button (keyboard slot); blur brings it back`, async () => {
    fresh();
    coarse();
    const { el } = await deepWith(make);
    await focusEl(el);
    assert.ok(!button(), "typing: no button on top of the field");
    await blurEl(el);
    assert.ok(button(), "blurred: back");
  });
}

test("touch: controls that raise no keyboard keep the button (select, checkbox, button, read-only input)", async () => {
  fresh();
  coarse();
  const sc = fakeScroller();
  const sel = document.createElement("select");
  const check = Object.assign(document.createElement("input"), { type: "checkbox" });
  const btn = document.createElement("button");
  const ro = Object.assign(document.createElement("input"), { readOnly: true });
  sc.append(sel, check, btn, ro);
  mount(sc);
  await scrollTo(2000);
  for (const el of [sel, check, btn, ro]) {
    await focusEl(el);
    assert.ok(button(), `${el.tagName.toLowerCase()} focused: the button stays`);
  }
});

test("touch: focus moving from one field to another keeps it hidden; leaving the fields brings it back", async () => {
  fresh();
  coarse();
  const sc = fakeScroller();
  const a = document.createElement("input");
  const b = document.createElement("textarea");
  const plain = document.createElement("button");
  sc.append(a, b, plain);
  mount(sc);
  await scrollTo(2000);
  await focusEl(a);
  assert.ok(!button());
  await focusEl(b);
  assert.ok(!button(), "field → field");
  await focusEl(plain);
  assert.ok(button(), "field → button");
});

test("touch: a field that already has focus when the button would appear keeps it hidden", async () => {
  fresh();
  coarse();
  const sc = fakeScroller();
  const i = document.createElement("input");
  sc.appendChild(i);
  document.body.appendChild(sc);
  i.focus();
  render(inRouter(h(ScrollToTop, { container: sc })));
  current = sc;
  await scrollTo(2000);
  assert.ok(!button(), "focused at mount, then scrolled deep: still no button");
  await blurEl(i);
  assert.ok(button());
});

test("touch: a field OUTSIDE the page scroller does not hide it", async () => {
  fresh();
  coarse();
  const { el } = await deepWith(input(), false);
  await focusEl(el);
  assert.ok(button());
});

test("a mouse pointer (no on-screen keyboard): a focused field keeps the button", async () => {
  fresh(); // no matchMedia → not coarse
  const { el } = await deepWith(input());
  await focusEl(el);
  assert.ok(button());
  await blurEl(el);
  stubMedia(() => false);
  await focusEl(el);
  assert.ok(button(), "matchMedia present but the pointer is fine: still shown");
});

/* ------------------------------------------------------------------ bottom room (m1) */

test("onShownChange mirrors the button: true when it shows, false when it goes (top, overlay, typing, unmount)", async () => {
  fresh();
  coarse();
  const calls: boolean[] = [];
  const sc = fakeScroller();
  const field = document.createElement("input");
  sc.appendChild(field);
  current = sc;
  document.body.appendChild(sc);
  const onShownChange = (v: boolean) => calls.push(v);
  const view = render(inRouter(h(ScrollToTop, { container: sc, onShownChange })));
  await settle();
  const last = () => calls[calls.length - 1];
  assert.notEqual(last(), true, "page at the top: not shown");
  await scrollTo(2000);
  assert.equal(last(), true, "shown");
  await scrollTo(0);
  assert.equal(last(), false, "back at the top");
  await scrollTo(2000);
  assert.equal(last(), true);
  await focusEl(field);
  assert.equal(last(), false, "typing hides it");
  await blurEl(field);
  assert.equal(last(), true);
  let token = "";
  await act(async () => {
    token = nav.pushLayer("overlay", () => {});
  });
  await settle();
  assert.equal(last(), false, "overlay open");
  await act(async () => {
    nav.releaseLayer(token);
  });
  await settle();
  assert.equal(last(), true);
  view.unmount();
  assert.equal(last(), false, "unmount releases the room");
});

test("AppShell: <main> gets the bottom room only while the button is on screen", async () => {
  fresh();
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  await settle();
  const main = document.getElementById("main")!;
  const sc = fakeScroller(main);
  assert.equal(main.getAttribute("data-scroll-top-room"), null, "no button: no room");
  await scrollTo(sc, 2000);
  assert.ok(button());
  assert.equal(main.getAttribute("data-scroll-top-room"), "on");
  // The padding that makes room: 4.5 rem + the Telegram / device bottom safe area.
  assert.ok(main.className.includes("data-[scroll-top-room=on]:pb-[calc(4.5rem+var(--tg-safe-bottom,env(safe-area-inset-bottom,0px)))]"));
  await scrollTo(sc, 0);
  assert.equal(main.getAttribute("data-scroll-top-room"), null, "back at the top: the room is released");
});

/* ------------------------------------------------------------------ bottom bars */

function stickyBar(top: number, bottom: number, mode: "sticky" | "inline" = "sticky") {
  const bar = document.createElement("div");
  bar.setAttribute("data-submit-bar", mode);
  document.body.appendChild(bar);
  rects.set(bar, { top, bottom });
  return bar;
}

test("a sticky submit bar docked at the bottom: the button sits 12 px above it", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  stickyBar(667, 740);
  await scrollTo(2000);
  rects.set(anchor()!, { top: 724, bottom: 724 });
  await scrollTo(2100);
  await settle();
  const tf = button()!.style.transform;
  assert.equal(tf, `translateY(-${724 - (667 - 12)}px)`, "bottom edge 12 px above the bar");
});

test("a bar resting at the end of the form (above the bottom padding) does not move the button", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  stickyBar(555, 628);
  await scrollTo(2000);
  rects.set(anchor()!, { top: 724, bottom: 724 });
  await scrollTo(2100);
  await settle();
  assert.equal(button()!.style.transform, "");
});

test("a bar that appears later (typing → inline, edit bar) is cleared without a scroll", async () => {
  fresh();
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(2000);
  rects.set(anchor()!, { top: 724, bottom: 724 });
  await settle();
  assert.equal(button()!.style.transform, "");
  await act(async () => {
    stickyBar(650, 740, "inline");
    await frames();
    await frames();
  });
  assert.equal(button()!.style.transform, `translateY(-${724 - (650 - 12)}px)`);
});

test("the keyboard variable change re-measures", async () => {
  fresh();
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number; scale: number };
  Object.assign(target, { height: 844, offsetTop: 0, scale: 1 });
  win.visualViewport = target;
  Object.defineProperty(window, "innerHeight", { value: 844, configurable: true, writable: true });
  const sc = fakeScroller();
  mount(sc);
  await scrollTo(2000);
  const bar = stickyBar(300, 373, "inline");
  rects.set(anchor()!, { top: 540, bottom: 540 });
  await settle();
  assert.equal(button()!.style.transform, "", "bar far above the button");
  rects.set(bar, { top: 470, bottom: 540 }); // the layout moved (keyboard opened)
  await act(async () => {
    Object.assign(target, { height: 540 });
    target.dispatchEvent(new Event("resize"));
    await frames();
    await frames();
  });
  assert.equal(button()!.style.transform, `translateY(-${540 - (470 - 12)}px)`);
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true, writable: true });
});

/* ------------------------------------------------------------------ result dock (m2) */

function dockAside(open: "1" | "0", mode: "dock" | "sheet" = "dock", left = 1060, right = 1440) {
  const a = document.createElement("aside");
  a.setAttribute("data-result-panel", mode);
  a.setAttribute("data-panel-open", open);
  document.body.appendChild(a);
  rects.set(a, { top: 0, bottom: 900, left, right });
  return a;
}

test("the open result dock (≥ 1280 px): the button sits left of it, not over its bottom-right corner", async () => {
  fresh();
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true, writable: true });
  const sc = fakeScroller();
  dockAside("1");
  mount(sc);
  await scrollTo(2000);
  await settle();
  // dock left 1060 → 380 px from the right edge, plus the 12 px gap
  assert.equal(anchor()!.style.right, `${1440 - 1060 + 12}px`);
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true, writable: true });
});

test("the dock closing / opening moves the button without a scroll", async () => {
  fresh();
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true, writable: true });
  const sc = fakeScroller();
  const dock = dockAside("0");
  mount(sc);
  await scrollTo(2000);
  await settle();
  assert.ok(!anchor()!.style.right.endsWith("px"), "closed dock: the safe-area offset");
  assert.ok(anchor()!.style.right.includes("--tg-safe-right"));
  await act(async () => {
    dock.setAttribute("data-panel-open", "1");
    await frames();
    await frames();
  });
  assert.equal(anchor()!.style.right, `${1440 - 1060 + 12}px`, "dock opened");
  await act(async () => {
    dock.setAttribute("data-panel-open", "0");
    await frames();
    await frames();
  });
  assert.ok(anchor()!.style.right.includes("--tg-safe-right"), "dock closed again");
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true, writable: true });
});

test("the narrow-screen sheet (data-result-panel=sheet) never shifts the button", async () => {
  fresh();
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true, writable: true });
  const sc = fakeScroller();
  dockAside("1", "sheet");
  mount(sc);
  await scrollTo(2000);
  await settle();
  assert.ok(anchor()!.style.right.includes("--tg-safe-right"));
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true, writable: true });
});

/* ------------------------------------------------------------------ AppShell wiring */

test("AppShell hands <main id=main> over: its scroll shows the button, a click scrolls it to 0, an inner scroller does not", async () => {
  fresh();
  render(
    inRouter(
      h(
        AppShell,
        null,
        h("div", { "data-page": "" }, h("div", { "data-inner-scroller": "", style: { overflowY: "auto" } }, "ichki")),
      ),
    ),
  );
  await settle();
  const main = document.getElementById("main")!;
  assert.ok(main);
  const sc = fakeScroller(main);
  const inner = fakeScroller(document.querySelector<HTMLElement>("[data-inner-scroller]")!, 300);
  await scrollTo(inner, 9000);
  assert.ok(!button(), "inner scroller inside the page: nothing");
  await scrollTo(sc, 2000);
  assert.ok(button(), "the shell's scroller: shown");
  await act(async () => {
    fireEvent.click(button()!);
    await frames();
  });
  assert.deepEqual(sc.scrolled, [{ top: 0, behavior: "smooth" }]);
  assert.ok(!button());
});

test("AppShell: an open search dialog hides it, closing it brings it back", async () => {
  fresh();
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  await settle();
  const sc = fakeScroller(document.getElementById("main")!);
  await scrollTo(sc, 2000);
  assert.ok(button());
  await act(async () => {
    useUi.getState().open("search");
  });
  await settle();
  assert.ok(!button(), "search dialog open");
  await act(async () => {
    useUi.getState().close();
  });
  await settle();
  assert.ok(button(), "search dialog closed");
});

test("AppShell: the open mobile drawer hides it", async () => {
  fresh();
  render(inRouter(h(AppShell, null, h("div", null, "sahifa"))));
  await settle();
  const sc = fakeScroller(document.getElementById("main")!);
  await scrollTo(sc, 2000);
  assert.ok(button());
  fireEvent.click(screen.getByLabelText("Yon panelni ko‘rsatish/yashirish"));
  await settle();
  assert.ok(document.querySelector(".fixed.inset-0.z-40"), "drawer open");
  assert.ok(!button(), "drawer open: no button");
});

test("AppShell: a route change clears it", async () => {
  fresh();
  const tree1 = h(AppShell, null, h("div", null, "sahifa"));
  const view = render(inRouter(tree1, "/uz"));
  await settle();
  const sc = fakeScroller(document.getElementById("main")!);
  await scrollTo(sc, 2000);
  assert.ok(button());
  sc.fake.top = 0;
  await act(async () => {
    view.rerender(inRouter(tree1, "/uz/create"));
  });
  await settle();
  assert.ok(!button());
});
