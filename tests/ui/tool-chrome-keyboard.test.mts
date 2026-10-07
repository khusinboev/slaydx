import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * Mobile sprint P3 — tool form chrome on phones (docs/mobile/PLAN.md §5 P3, R5 F4/F11/F18).
 *
 * Locked here:
 *  - The sticky submit bar leaves the bottom edge (`data-submit-bar="inline"`, `static`)
 *    ONLY while a text field inside the form is focused, the keyboard is open (fake
 *    `visualViewport` or an Android-style window shrink) and the pointer is coarse;
 *    it is sticky again when the keyboard closes or focus leaves. Fine pointer: never.
 *  - The focused field is scrolled into the visible area with a 16 px margin when the
 *    keyboard opens and after each edit of a growing textarea (caret at the end).
 *  - Touch hit areas: back links 44 px (`pointer-coarse:size-11`), «Qo'shimcha»
 *    and «Balansni to'ldirish →» 44 px rows, topic chips 44 px in one scrolling row.
 *  - `#main` scroll padding follows the bar (AppShell).
 */

const { ToolChrome, TopicChips } = await import("../../components/forms/ToolChrome.tsx");
const { PageBack } = await import("../../components/shell/PageBack.tsx");
const { AppShell } = await import("../../components/shell/AppShell.tsx");
const { revealDelta, isTextEntry, REVEAL_MARGIN_PX } = await import("../../components/forms/useKeyboardInset.ts");
const { useAppStore } = await import("../../lib/store.ts");

const win = window as unknown as Record<string, unknown>;

function setInner(height: number, width = 390) {
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
}

/** `(pointer: coarse)` answer for every query (useCoarsePointer and AppShell's narrow query). */
function stubPointer(coarse: boolean) {
  win.matchMedia = () => ({
    matches: coarse,
    media: "",
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

/** iOS-style keyboard: only the visual viewport shrinks. */
function stubVisualViewport(height: number, offsetTop = 0) {
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number; scale: number };
  Object.assign(target, { height, offsetTop, scale: 1 });
  win.visualViewport = target;
  return {
    async set(next: { height?: number; offsetTop?: number }) {
      await act(async () => {
        Object.assign(target, next);
        target.dispatchEvent(new Event("resize"));
        await frames();
      });
    },
  };
}

const frames = () => new Promise((r) => setTimeout(r, 10));
const tick = () => act(async () => frames());

afterEach(async () => {
  cleanup();
  await frames();
  delete win.matchMedia;
  delete win.visualViewport;
  setInner(768, 1024);
});

function form(extra?: { outside?: boolean }) {
  return h(
    "div",
    null,
    extra?.outside ? h("input", { "aria-label": "tashqi qidiruv" }) : null,
    h(ToolChrome, {
      title: "Slayd",
      submitLabel: "Yaratish",
      onSubmit() {},
      children: h(
        "div",
        null,
        h("input", { "aria-label": "Mavzu" }),
        h("textarea", { "aria-label": "Izoh" }),
        h("button", { type: "button" }, "Segment"),
        h("input", { "aria-label": "Sana", type: "date" }),
      ),
    }),
  );
}

const bar = () => document.querySelector<HTMLElement>("[data-submit-bar]")!;
const byLabel = (l: string) => document.querySelector<HTMLElement>(`[aria-label="${l}"]`)!;
const isSticky = () => {
  const b = bar();
  return b.getAttribute("data-submit-bar") === "sticky" && b.classList.contains("sticky") && b.classList.contains("bottom-0");
};
const isInline = () => {
  const b = bar();
  return b.getAttribute("data-submit-bar") === "inline" && b.classList.contains("static") && !b.classList.contains("sticky");
};

async function focus(el: HTMLElement) {
  await act(async () => {
    el.focus();
    await frames();
  });
}

/* ------------------------------------------------------------ bar vs keyboard */

test("coarse + text field focused + keyboard opens → bar leaves the bottom edge; closes → sticky again", async () => {
  setInner(844);
  stubPointer(true);
  const vv = stubVisualViewport(844);
  render(form());
  await tick();
  assert.ok(isSticky(), "keyboard closed: sticky");
  await focus(byLabel("Mavzu"));
  assert.ok(isSticky(), "focus without a keyboard (hardware keyboard / not yet open): still sticky");
  await vv.set({ height: 420 });
  assert.ok(isInline(), "keyboard open while typing: bar in the flow");
  await vv.set({ height: 844 });
  assert.ok(isSticky(), "keyboard closed: sticky again");
});

test("moving focus between fields keeps the bar in the flow; blur restores it", async () => {
  setInner(844);
  stubPointer(true);
  const vv = stubVisualViewport(844);
  render(form());
  await focus(byLabel("Mavzu"));
  await vv.set({ height: 420 });
  assert.ok(isInline());
  await focus(byLabel("Izoh"));
  assert.ok(isInline(), "textarea focused: still typing");
  await act(async () => {
    byLabel("Izoh").blur();
    await frames();
  });
  assert.ok(isSticky(), "nothing focused: sticky even if the viewport is still short");
});

test("non-text controls and fields outside the form never move the bar", async () => {
  setInner(844);
  stubPointer(true);
  const vv = stubVisualViewport(844);
  render(form({ outside: true }));
  await vv.set({ height: 420 });
  await focus([...document.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Segment")!);
  assert.ok(isSticky(), "a focused button raises no keyboard");
  await focus(byLabel("Sana"));
  assert.ok(isSticky(), "a date picker is not typing");
  await focus(byLabel("tashqi qidiruv"));
  assert.ok(isSticky(), "a field outside ToolChrome (top bar search) does not count");
});

test("Android-style keyboard (window shrinks, no visualViewport) → bar in the flow", async () => {
  setInner(844);
  stubPointer(true);
  render(form());
  await focus(byLabel("Mavzu"));
  assert.ok(isSticky());
  await act(async () => {
    setInner(420);
    window.dispatchEvent(new window.Event("resize"));
    await frames();
  });
  assert.ok(isInline(), "innerHeight 844 → 420 = keyboard");
  await act(async () => {
    setInner(844);
    window.dispatchEvent(new window.Event("resize"));
    await frames();
  });
  assert.ok(isSticky());
});

test("desktop (fine pointer): a short window with a focused field keeps the sticky bar", async () => {
  setInner(844);
  stubPointer(false);
  const vv = stubVisualViewport(844);
  render(form());
  await focus(byLabel("Mavzu"));
  await vv.set({ height: 420 });
  assert.ok(isSticky(), "devtools/short window on desktop: unchanged");
});

/* ---------------------------------------------------------------- reveal */

/** jsdom has no layout: give the scroller and a field fixed client rects. */
function rect(top: number, bottom: number) {
  return () => ({ top, bottom, height: bottom - top, left: 0, right: 390, width: 390, x: 0, y: top, toJSON() {} }) as DOMRect;
}

function scrollerAround(): HTMLElement {
  const main = document.createElement("main");
  main.style.overflowY = "auto";
  Object.defineProperty(main, "scrollHeight", { value: 3000, configurable: true });
  Object.defineProperty(main, "clientHeight", { value: 788, configurable: true });
  let y = 0;
  Object.defineProperty(main, "scrollTop", {
    configurable: true,
    get: () => y,
    set: (v: number) => {
      y = v;
    },
  });
  main.getBoundingClientRect = rect(56, 844); // layout viewport keeps its size (iOS)
  document.body.appendChild(main);
  return main;
}

test("keyboard opens: the focused field is scrolled above the visible bottom with a 16 px margin", async () => {
  setInner(844);
  stubPointer(true);
  const vv = stubVisualViewport(844);
  const main = scrollerAround();
  render(form(), { container: main });
  main.scrollTop = 100;
  const topic = byLabel("Mavzu");
  topic.getBoundingClientRect = rect(380, 424);
  await focus(topic);
  assert.equal(main.scrollTop, 100, "keyboard closed: no scroll");
  await vv.set({ height: 420 });
  // visible bottom = min(844, 0 + 420) = 420; field bottom 424 + 16 → 20 px.
  assert.equal(main.scrollTop, 120);
  await act(async () => {
    cleanup();
    main.remove();
  });
});

test("growing textarea: each edit keeps its last line (caret at the end) visible", async () => {
  setInner(844);
  stubPointer(true);
  const vv = stubVisualViewport(844);
  const main = scrollerAround();
  render(form(), { container: main });
  main.scrollTop = 0;
  const ta = byLabel("Izoh") as HTMLTextAreaElement;
  ta.getBoundingClientRect = rect(200, 300);
  await focus(ta);
  await vv.set({ height: 420 });
  assert.equal(main.scrollTop, 0, "fits: nothing to do");
  // The textarea grew past the visible bottom while typing at the end.
  ta.value = "1\n2\n3\n4\n5\n6\n7\n8";
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.getBoundingClientRect = rect(200, 430);
  await act(async () => {
    fireEvent.input(ta);
    await frames();
  });
  assert.equal(main.scrollTop, 430 + REVEAL_MARGIN_PX - 420, "26 px: last line back above the keyboard");
  await act(async () => {
    cleanup();
    main.remove();
  });
});

test("tall textarea with the caret mid-text: no forced scroll (browser reveals the caret)", async () => {
  setInner(844);
  stubPointer(true);
  const vv = stubVisualViewport(844);
  const main = scrollerAround();
  render(form(), { container: main });
  const ta = byLabel("Izoh") as HTMLTextAreaElement;
  ta.value = "a\n".repeat(40);
  ta.setSelectionRange(2, 2);
  ta.getBoundingClientRect = rect(100, 900);
  await focus(ta);
  main.scrollTop = 50;
  await vv.set({ height: 420 });
  assert.equal(main.scrollTop, 50);
  await act(async () => {
    cleanup();
    main.remove();
  });
});

test("desktop: no reveal scrolling", async () => {
  setInner(844);
  stubPointer(false);
  const vv = stubVisualViewport(844);
  const main = scrollerAround();
  render(form(), { container: main });
  main.scrollTop = 100;
  const topic = byLabel("Mavzu");
  topic.getBoundingClientRect = rect(380, 424);
  await focus(topic);
  await vv.set({ height: 420 });
  assert.equal(main.scrollTop, 100);
  await act(async () => {
    cleanup();
    main.remove();
  });
});

test("revealDelta: fits / below / above / taller than the room", () => {
  const view = { top: 56, bottom: 420 };
  assert.equal(revealDelta({ top: 100, bottom: 144 }, view), 0, "inside with margins");
  assert.equal(revealDelta({ top: 380, bottom: 424 }, view), 20, "below: bottom + 16 − 420");
  assert.equal(revealDelta({ top: 60, bottom: 104 }, view), -12, "above: top − 16 − 56");
  assert.equal(revealDelta({ top: 0, bottom: 600 }, view), 196, "taller: align the bottom");
  assert.equal(revealDelta({ top: 0, bottom: 380 }, view), 0, "taller but the bottom is visible");
  assert.equal(revealDelta({ top: 0, bottom: 30 }, { top: 0, bottom: 20 }), 0, "no room at all");
});

test("isTextEntry: text inputs, textarea, contentEditable; not buttons, pickers, read-only", () => {
  const mk = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    document.body.appendChild(d);
    return d.firstElementChild as HTMLElement;
  };
  assert.ok(isTextEntry(mk("<input>")));
  assert.ok(isTextEntry(mk('<input type="number">')));
  assert.ok(isTextEntry(mk("<textarea></textarea>")));
  assert.ok(!isTextEntry(mk("<textarea readonly></textarea>")));
  assert.ok(!isTextEntry(mk("<input disabled>")));
  assert.ok(!isTextEntry(mk('<input type="checkbox">')));
  assert.ok(!isTextEntry(mk('<input type="range">')));
  assert.ok(!isTextEntry(mk("<button>x</button>")));
  assert.ok(!isTextEntry(null));
  document.body.innerHTML = "";
});

/* ------------------------------------------------------------ touch targets */

// Redesign W5: the «←» is the PageHeader back (44 px on every pointer, was 32 px desktop / 44 px touch);
// the bar's bottom padding also reads Telegram's `--tg-safe-bottom` (was env() only).
test("ToolChrome touch hit areas: back 44 px (PageHeader), «Qo'shimcha» and top-up 44 px rows", () => {
  useAppStore.setState({
    loggedIn: true,
    user: { id: "u1", balance: 1000, points: 0, quota: 0 } as never,
  });
  render(
    h(ToolChrome, {
      title: "Slayd",
      submitLabel: "Yaratish",
      price: 3000,
      onSubmit() {},
      extra: h("div", null, "qo'shimcha"),
      onExtra() {},
      children: h("div"),
    }),
  );
  const back = document.querySelector("[data-page-header-back]")!;
  assert.ok(back, "PageHeader «←»");
  for (const c of ["size-11", "-ml-2", "focus-visible:ring-2"]) {
    assert.ok(back.classList.contains(c), `back link: ${c}`);
  }
  const more = [...document.querySelectorAll("button")].find((b) => /Qo/.test(b.textContent ?? ""))!;
  assert.ok(more.classList.contains("pointer-coarse:min-h-11"), "«Qo'shimcha» toggle 44 px on touch");
  const topUp = document.querySelector("[data-topup]")!;
  for (const c of ["pointer-coarse:flex", "pointer-coarse:min-h-11", "pointer-coarse:w-fit"]) {
    assert.ok(topUp.classList.contains(c), `top-up link: ${c}`);
  }
  // Safe-area padding on the bar (Telegram first, then env()), desktop 12 px kept.
  assert.ok(bar().classList.contains("pb-[max(0.75rem,var(--tg-safe-bottom,env(safe-area-inset-bottom,0px)))]"));
  assert.ok(bar().classList.contains("pt-3"));
  cleanup();
  useAppStore.setState({ loggedIn: false, user: null });
});

test("PageBack: 44 px circle on touch, desktop 32 px", () => {
  render(h(PageBack));
  const a = document.querySelector("[data-page-back]")!;
  for (const c of ["pointer-coarse:size-11", "pointer-coarse:-my-1.5", "pointer-coarse:-ml-2.5", "h-8", "w-8"]) {
    assert.ok(a.classList.contains(c), c);
  }
});

test("TopicChips: one scrolling row of 44 px chips on touch, wrapping pills on desktop; a tap fills the topic", () => {
  const picked: string[] = [];
  render(h(TopicChips, { examples: ["Fotosintez", "Sun’iy intellekt"], onPick: (t: string) => picked.push(t) }));
  const row = document.querySelector("[data-topic-chips]")!;
  for (const c of ["flex-wrap", "pointer-coarse:flex-nowrap", "pointer-coarse:overflow-x-auto"]) {
    assert.ok(row.classList.contains(c), `row: ${c}`);
  }
  const chips = row.querySelectorAll("button");
  assert.equal(chips.length, 2);
  for (const c of ["pointer-coarse:min-h-11", "pointer-coarse:shrink-0", "pointer-coarse:max-w-[80%]", "pointer-coarse:truncate"]) {
    assert.ok(chips[0].classList.contains(c), `chip: ${c}`);
  }
  fireEvent.click(chips[1]);
  assert.deepEqual(picked, ["Sun’iy intellekt"]);
  cleanup();
  render(h(TopicChips, { examples: [], onPick() {} }));
  assert.ok(!document.querySelector("[data-topic-chips]"), "no examples → no row");
});

/* ------------------------------------------------------------ AppShell */

test("AppShell #main: scroll padding follows the submit bar (sticky 6 rem + safe area, in the flow 16 px)", () => {
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  render(
    h(
      AppRouterContext.Provider,
      { value: router as never },
      h(
        PathnameContext.Provider,
        { value: "/uz/slide" },
        h(SearchParamsContext.Provider, { value: new URLSearchParams() as never }, h(AppShell, null, h("div"))),
      ),
    ),
  );
  const main = document.getElementById("main")!;
  assert.ok(main.classList.contains("has-[[data-submit-bar=sticky]]:scroll-pb-[calc(6rem+env(safe-area-inset-bottom))]"));
  assert.ok(main.classList.contains("has-[[data-submit-bar=inline]]:scroll-pb-4"));
  assert.ok(main.classList.contains("overflow-y-auto"), "still the page scroller");
});
