import "./setup.ts";
import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
import { CHROME_HIDE_MS } from "../../components/viewers/slide-nav/useAutoHide.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * Enlarged («To‘liq ekran») slide navigation on touch devices (T1, todo sprint
 * 2026-10-07) — jsdom.
 *
 * Owner report: on a phone a tap on the right went to the next slide, but a tap
 * on the LEFT also went forward and a swipe did nothing. Contract: left third /
 * swipe right → previous; right and middle third / swipe left → next; the ends
 * stay put; vertical drags, short drags and pinches are ignored; a MOUSE keeps
 * "click anywhere advances"; outside the enlarged mode none of this runs (the
 * inline viewer's double tap, focus zoom and pan are untouched); the enlarged
 * mode gets visible ‹ › buttons (it had no way back but the arrow keys).
 *
 * Mutations (T1 report): left zone mapped to +1 → "left tap" fails; compat-click
 * swallow removed → "one tap, one step" fails; swipe branch removed from `stepOf`
 * → swipe tests fail; `enabled` forced true → "outside the enlarged mode" fails;
 * dominance check removed → "vertical drag" fails; second-finger rule removed →
 * "pinch" fails; `touch-action` style removed → style test fails; `go` made
 * wrapping → boundary tests fail.
 *
 * Review fixes (m1–m4, n5, n6): Space on a focused bar button no longer pages
 * forward; the ends are `aria-disabled` (focus stays), not `disabled`; the
 * position is a polite live region; close/presenter are 44 px and named; the
 * pill respects the safe areas; on fine pointers it fades after 2.5 s idle
 * (pointer move/press/focus wakes it, hover/focus inside keeps it), touch never
 * hides it. Mutations: guard removed, `disabled` back, live region / sr-only
 * word / close label / close size / safe-area removed, never-hide, hover and
 * focus ignored, wake not re-showing, touch hides, focusin/pointerdown not waking.
 */

const observers: { cb: () => void; el: Element }[] = [];
(globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
  cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
  }
  observe(el: Element) {
    observers.push({ cb: this.cb, el });
  }
  unobserve() {}
  disconnect() {
    for (let k = observers.length - 1; k >= 0; k--) if (observers[k].cb === this.cb) observers.splice(k, 1);
  }
};

const win = window as unknown as Record<string, unknown>;
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
/** A 390 px phone: coarse pointer, < md. */
const phone = () => stubMedia((q) => q.includes("pointer: coarse") || q.includes("max-width: 767px"));

afterEach(() => {
  cleanup();
  observers.length = 0;
  delete win.matchMedia;
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh" },
  { id: "s1", layout: "bullets", title: "Birinchi", bullets: ["Bir", "Ikki"], footer: "Aliyev · TDPU" },
  { id: "s2", layout: "bullets", title: "Ikkinchi", bullets: ["Uch"] },
];
function makeDoc(): AcademicDoc {
  return {
    meta: { topic: "Mavzu", author: "Aliyev", workLabel: "Taqdimot", language: "uz", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides,
  } as unknown as AcademicDoc;
}
function gen(doc: AcademicDoc) {
  return { id: "gen1", type: "slide", status: "COMPLETED", doc, docVersion: 1, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

const W = 390;
const stage = () => document.querySelector("[data-slide-stage]") as HTMLElement;
/** «2 / 9» — the hidden « slayd» suffix is for screen readers only. */
const counter = () => document.querySelector("[data-slide-counter]")?.textContent?.replace(/\s*slayd$/, "") ?? null;

/** jsdom lays nothing out: give the stage the rect the zones are measured against. */
function sizeStage(width = W, height = 844) {
  Object.defineProperty(stage(), "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON() {} }),
  });
}

function mountPresent() {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  fireEvent.click(screen.getByLabelText("To‘liq ekran"));
  assert.equal(stage().getAttribute("data-slide-stage"), "present");
  sizeStage();
  assert.equal(counter(), "1 / 3");
}

type Pointer = { id?: number; type?: "touch" | "pen" | "mouse" };
const ev = (x: number, y: number, p: Pointer = {}) => ({
  pointerType: p.type ?? "touch",
  pointerId: p.id ?? 1,
  isPrimary: true,
  clientX: x,
  clientY: y,
});

/** A finger tap: down, up, and the browser's compat `click` that follows a touch tap. */
function tap(x: number, y = 400, p: Pointer = {}) {
  const el = stage();
  fireEvent.pointerDown(el, ev(x, y, p));
  fireEvent.pointerUp(el, ev(x, y, p));
  fireEvent.click(el, { clientX: x, clientY: y });
}

/** A finger drag from `a` to `b` in a few moves; releases unless `hold`. */
function drag(a: { x: number; y: number }, b: { x: number; y: number }, p: Pointer = {}) {
  const el = stage();
  fireEvent.pointerDown(el, ev(a.x, a.y, p));
  for (let k = 1; k <= 4; k++) {
    fireEvent.pointerMove(el, ev(a.x + ((b.x - a.x) * k) / 4, a.y + ((b.y - a.y) * k) / 4, p));
  }
  fireEvent.pointerUp(el, ev(b.x, b.y, p));
}

// ══════════════════════════════════ tap zones
test("tap in the LEFT third goes to the previous slide, the right third to the next, the middle keeps advancing", () => {
  mountPresent();
  tap(350); // right third
  assert.equal(counter(), "2 / 3");
  tap(40); // left third
  assert.equal(counter(), "1 / 3", "the left tap went BACK (it used to advance)");
  tap(195); // middle third = today's behaviour
  assert.equal(counter(), "2 / 3");
  tap(40);
  assert.equal(counter(), "1 / 3");
  // The edges of the middle third (130…260 of 390) are still "advance", not "back".
  tap(140);
  assert.equal(counter(), "2 / 3");
  tap(250);
  assert.equal(counter(), "3 / 3");
});

test("one finger tap = exactly one step (the compat click after it must not advance again)", () => {
  mountPresent();
  tap(350);
  assert.equal(counter(), "2 / 3", "pointerup stepped once; the click that followed was swallowed");
  tap(40);
  assert.equal(counter(), "1 / 3");
  tap(40);
  assert.equal(counter(), "1 / 3", "tap left on the first slide: stays, does not wrap");
});

test("a pen tap behaves like a finger", () => {
  mountPresent();
  tap(350, 400, { type: "pen" });
  assert.equal(counter(), "2 / 3");
  tap(40, 400, { type: "pen" });
  assert.equal(counter(), "1 / 3");
});

// ══════════════════════════════════ swipes
test("swipe RIGHT goes to the previous slide, swipe LEFT to the next — from anywhere on the stage", () => {
  mountPresent();
  drag({ x: 300, y: 400 }, { x: 180, y: 405 }); // left → next
  assert.equal(counter(), "2 / 3");
  drag({ x: 300, y: 400 }, { x: 180, y: 405 });
  assert.equal(counter(), "3 / 3");
  drag({ x: 20, y: 300 }, { x: 160, y: 310 }); // right → previous, even from the left edge
  assert.equal(counter(), "2 / 3");
  drag({ x: 100, y: 700 }, { x: 240, y: 690 });
  assert.equal(counter(), "1 / 3");
});

test("the ends stay put: no wrap-around by swipe or tap", () => {
  mountPresent();
  drag({ x: 100, y: 400 }, { x: 240, y: 400 }); // swipe right on the first slide
  assert.equal(counter(), "1 / 3");
  tap(40);
  assert.equal(counter(), "1 / 3");
  tap(350);
  tap(350);
  assert.equal(counter(), "3 / 3");
  drag({ x: 300, y: 400 }, { x: 160, y: 400 }); // swipe left on the last slide
  assert.equal(counter(), "3 / 3");
  tap(350);
  tap(195);
  assert.equal(counter(), "3 / 3", "tap right / middle on the last slide: stays");
});

test("a swipe is not also a tap (no step from the compat click, none from the zone it started in)", () => {
  mountPresent();
  tap(350);
  assert.equal(counter(), "2 / 3");
  // Starts in the LEFT zone but moves left: NEXT (a misread "left tap" would go back).
  drag({ x: 100, y: 400 }, { x: 40, y: 400 });
  assert.equal(counter(), "3 / 3");
  // Starts in the RIGHT zone but moves right: PREVIOUS (a misread "right tap" would go forward).
  drag({ x: 330, y: 400 }, { x: 380, y: 400 });
  assert.equal(counter(), "2 / 3");
});

// ══════════════════════════════════ ignored gestures
test("vertical drags, short drags and a 39 px swipe do not navigate", () => {
  mountPresent();
  tap(350);
  assert.equal(counter(), "2 / 3");
  drag({ x: 200, y: 200 }, { x: 260, y: 600 }); // page scroll
  drag({ x: 200, y: 600 }, { x: 200, y: 200 });
  drag({ x: 200, y: 400 }, { x: 222, y: 400 }); // 22 px: between a tap and a swipe
  drag({ x: 200, y: 400 }, { x: 239, y: 400 }); // 39 px
  assert.equal(counter(), "2 / 3");
  drag({ x: 200, y: 400 }, { x: 240, y: 400 }); // 40 px — a swipe
  assert.equal(counter(), "1 / 3");
});

test("a pinch / two-finger gesture never navigates; the next single finger works again", () => {
  mountPresent();
  tap(350);
  assert.equal(counter(), "2 / 3");
  const el = stage();
  // Spread: the second finger would read as a swipe RIGHT, the first as a swipe LEFT.
  fireEvent.pointerDown(el, ev(100, 400, { id: 1 }));
  fireEvent.pointerDown(el, ev(300, 400, { id: 2 }));
  fireEvent.pointerMove(el, ev(20, 400, { id: 1 }));
  fireEvent.pointerMove(el, ev(380, 400, { id: 2 }));
  fireEvent.pointerUp(el, ev(380, 400, { id: 2 }));
  fireEvent.pointerUp(el, ev(20, 400, { id: 1 }));
  assert.equal(counter(), "2 / 3", "the pinch moved nothing");
  tap(350, 400, { id: 3 });
  assert.equal(counter(), "3 / 3", "the next single finger works again");
});

test("pointercancel (the browser took the gesture) navigates nothing", () => {
  mountPresent();
  const el = stage();
  fireEvent.pointerDown(el, ev(300, 400));
  fireEvent.pointerMove(el, ev(220, 400));
  fireEvent.pointerCancel(el, ev(180, 400));
  fireEvent.pointerUp(el, ev(180, 400));
  assert.equal(counter(), "1 / 3");
});

// ══════════════════════════════════ mouse, keys, buttons
test("a MOUSE click keeps the old behaviour: anywhere advances (no zones for the mouse)", () => {
  mountPresent();
  const el = stage();
  fireEvent.pointerDown(el, ev(40, 400, { type: "mouse" }));
  fireEvent.pointerUp(el, ev(40, 400, { type: "mouse" }));
  fireEvent.click(el, { clientX: 40, clientY: 400 });
  assert.equal(counter(), "2 / 3", "a click in the LEFT third with a mouse still advances");
  fireEvent.click(el, { clientX: 350, clientY: 400 });
  assert.equal(counter(), "3 / 3");
  fireEvent.click(el);
  assert.equal(counter(), "3 / 3", "last slide: stays");
});

test("a click without any pointer events (assistive tech) still advances", () => {
  mountPresent();
  fireEvent.click(stage());
  assert.equal(counter(), "2 / 3");
});

test("visible ‹ › buttons: step, are aria-disabled at the ends (focus stays), arrow keys keep working", () => {
  mountPresent();
  const prev = screen.getByLabelText("Oldingi slayd") as HTMLButtonElement;
  const next = screen.getByLabelText("Keyingi slayd") as HTMLButtonElement;
  assert.equal(prev.getAttribute("aria-disabled"), "true", "first slide: no previous");
  assert.equal(next.hasAttribute("aria-disabled"), false);
  assert.equal(prev.disabled, false, "never `disabled`: a focused disabled button drops focus to <body>");
  fireEvent.click(prev);
  assert.equal(counter(), "1 / 3", "the aria-disabled ‹ is a no-op on the first slide");
  fireEvent.click(next);
  assert.equal(counter(), "2 / 3");
  assert.equal(prev.hasAttribute("aria-disabled"), false);
  fireEvent.click(next);
  assert.equal(counter(), "3 / 3");
  assert.equal(next.getAttribute("aria-disabled"), "true", "last slide: no next");
  assert.equal(next.disabled, false);
  next.focus();
  fireEvent.click(next);
  assert.equal(counter(), "3 / 3", "the aria-disabled › is a no-op on the last slide");
  assert.ok(document.activeElement === next, "keyboard focus stays on the button at the end");
  fireEvent.click(prev);
  assert.equal(counter(), "2 / 3");
  fireEvent.keyDown(document.body, { key: "ArrowLeft" });
  assert.equal(counter(), "1 / 3");
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  assert.equal(counter(), "2 / 3");
  // Tapping a bar button is not a stage gesture: one step, not two.
  fireEvent.pointerDown(next, ev(350, 20));
  fireEvent.pointerUp(next, ev(350, 20));
  fireEvent.click(next);
  assert.equal(counter(), "3 / 3");
});

test("Space on a focused bar button activates THAT button — the page-forward key must not also fire (and swallow it)", () => {
  mountPresent();
  tap(350);
  assert.equal(counter(), "2 / 3");
  const prev = screen.getByLabelText("Oldingi slayd");
  // The keys handler is on `window`: a Space keydown whose target is the ‹ button must be left alone.
  const notPrevented = fireEvent.keyDown(prev, { key: " " });
  assert.equal(counter(), "2 / 3", "Space on ‹ did not page forward");
  assert.equal(notPrevented, true, "…and its default (the button activation) is not cancelled");
  fireEvent.keyDown(screen.getByLabelText("Yopish"), { key: "Enter" });
  assert.equal(counter(), "2 / 3");
  // Anywhere else Space / PageDown still page forward, PageUp back.
  fireEvent.keyDown(document.body, { key: " " });
  assert.equal(counter(), "3 / 3");
  fireEvent.keyDown(document.body, { key: "PageUp" });
  assert.equal(counter(), "2 / 3");
  // PageDown is not an activation key: it pages even from a focused button.
  fireEvent.keyDown(prev, { key: "PageDown" });
  assert.equal(counter(), "3 / 3");
});

test("the position is a polite live region («2 / 9 slayd» for screen readers)", () => {
  mountPresent();
  const c = document.querySelector("[data-slide-counter]") as HTMLElement;
  assert.equal(c.getAttribute("aria-live"), "polite");
  assert.equal(c.getAttribute("aria-atomic"), "true");
  assert.equal(c.textContent, "1 / 3 slayd", "visible «1 / 3» plus the screen-reader word");
  assert.ok(c.querySelector(".sr-only"), "the word «slayd» is visually hidden");
  tap(350);
  assert.equal(c.textContent, "2 / 3 slayd", "the same live node updates (that is what is announced)");
});

test("the bar's buttons are ≥ 44 px targets with Uzbek names; close and presenter work", () => {
  mountPresent();
  for (const label of ["Oldingi slayd", "Keyingi slayd", "Yopish", "Taqdimotchi rejimi"]) {
    const b = screen.getByLabelText(label);
    assert.ok(b.className.split(/\s+/).includes("size-11"), `${label}: size-11 = 44 px`);
  }
  const presenterBtn = screen.getByLabelText("Taqdimotchi rejimi");
  assert.equal(presenterBtn.getAttribute("aria-pressed"), "false");
  fireEvent.click(presenterBtn);
  assert.equal(presenterBtn.getAttribute("aria-pressed"), "true");
  assert.ok(document.body.textContent?.includes("Keyingi slayd"), "presenter panel opened");
  fireEvent.click(screen.getByLabelText("Yopish"));
  assert.notEqual(stage().getAttribute("data-slide-stage"), "present", "«Yopish» leaves the enlarged mode");
});

test("the control pill respects the safe areas (notch / Telegram header / side inset) with env() fallbacks", () => {
  mountPresent();
  const bar = document.querySelector("[data-slide-present-bar]") as HTMLElement;
  const style = bar.getAttribute("style") ?? "";
  assert.match(style, /--tg-safe-top, env\(safe-area-inset-top/, "top: Telegram safe top, else the env() inset");
  assert.match(style, /--tg-content-safe-top/, "…plus Telegram's own header");
  assert.match(style, /--tg-safe-right, env\(safe-area-inset-right/, "right: safe inset");
});

// ══════════════════════════════════ auto-hide (fine pointers)
const bar = () => document.querySelector("[data-slide-present-bar]") as HTMLElement;
const chrome = () => bar().getAttribute("data-slide-chrome");
/** jsdom has no focus-visible heuristics: answer `:focus-visible` the way a browser would for keyboard / mouse focus. */
function focusVisibleAs(el: Element, on: boolean) {
  const real = Element.prototype.matches;
  Object.defineProperty(el, "matches", {
    configurable: true,
    value: (q: string) => (q === ":focus-visible" ? on : real.call(el, q)),
  });
}
const tick = (ms: number) =>
  act(async () => {
    mock.timers.tick(ms);
  });

test("fine pointer: the pill fades after the idle, a pointer move/press wakes it, and it fades again", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    mountPresent();
    assert.equal(chrome(), "visible");
    await tick(CHROME_HIDE_MS - 1);
    assert.equal(chrome(), "visible", "not before the idle has passed");
    await tick(1);
    assert.equal(chrome(), "hidden");
    assert.ok(bar().className.includes("opacity-0") && bar().className.includes("pointer-events-none"), "faded and click-through");
    await act(async () => {
      fireEvent.pointerMove(document.body, { pointerType: "mouse", clientX: 5, clientY: 5 });
    });
    assert.equal(chrome(), "visible", "a pointer move shows it again");
    await tick(CHROME_HIDE_MS);
    assert.equal(chrome(), "hidden", "…and the idle is re-armed");
    await act(async () => {
      fireEvent.pointerDown(document.body, { pointerType: "mouse" });
    });
    assert.equal(chrome(), "visible", "a press shows it too");
    // Movement keeps pushing the fade back.
    await tick(CHROME_HIDE_MS - 100);
    await act(async () => {
      fireEvent.pointerMove(document.body, { pointerType: "mouse", clientX: 9, clientY: 9 });
    });
    await tick(CHROME_HIDE_MS - 100);
    assert.equal(chrome(), "visible", "the timer restarted on the move");
  } finally {
    mock.timers.reset();
  }
});

test("fine pointer: the pill never fades while the pointer rests on it or a control inside has focus", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    mountPresent();
    await act(async () => {
      fireEvent.pointerEnter(bar(), { pointerType: "mouse" });
    });
    await tick(CHROME_HIDE_MS * 3);
    assert.equal(chrome(), "visible", "resting on the pill");
    await act(async () => {
      fireEvent.pointerLeave(bar(), { pointerType: "mouse" });
    });
    await tick(CHROME_HIDE_MS);
    assert.equal(chrome(), "hidden", "left the pill: it fades");
    // Keyboard: a Tab onto a button shows it and keeps it while focused.
    const prev = screen.getByLabelText("Oldingi slayd");
    focusVisibleAs(prev, true);
    await act(async () => {
      prev.focus();
      fireEvent.focusIn(prev);
    });
    assert.equal(chrome(), "visible", "focus shows it");
    await tick(CHROME_HIDE_MS * 3);
    assert.equal(chrome(), "visible", "focus inside keeps it");
    await act(async () => {
      prev.blur();
    });
    await tick(CHROME_HIDE_MS);
    assert.equal(chrome(), "hidden", "focus left: it fades");
  } finally {
    mock.timers.reset();
  }
});

test("fine pointer: a button the MOUSE just clicked (focused, not :focus-visible) does not pin the pill", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    mountPresent();
    const next = screen.getByLabelText("Keyingi slayd");
    focusVisibleAs(next, false); // focused by a mouse click
    await act(async () => {
      next.focus();
      fireEvent.click(next);
    });
    await tick(CHROME_HIDE_MS * 2);
    assert.ok(document.activeElement === next, "the button still has focus");
    assert.equal(chrome(), "hidden", "…but a mouse-focused button lets the pill fade");
  } finally {
    mock.timers.reset();
  }
});

test("touch device (coarse pointer): the pill stays visible, it is never hidden", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    phone();
    mountPresent();
    await tick(CHROME_HIDE_MS * 4);
    assert.equal(chrome(), "visible");
    assert.ok(!bar().className.includes("opacity-0"));
  } finally {
    mock.timers.reset();
  }
});

test("leaving the enlarged mode and coming back shows the pill again (a hidden pill does not stay hidden)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    mountPresent();
    await tick(CHROME_HIDE_MS);
    assert.equal(chrome(), "hidden");
    fireEvent.click(screen.getByLabelText("Yopish"));
    assert.notEqual(stage().getAttribute("data-slide-stage"), "present");
    fireEvent.click(screen.getByLabelText("To‘liq ekran"));
    assert.equal(chrome(), "visible", "a new session starts with the pill shown");
    await tick(CHROME_HIDE_MS);
    assert.equal(chrome(), "hidden", "…and fades again after the idle");
  } finally {
    mock.timers.reset();
  }
});

// ══════════════════════════════════ scope
test("the enlarged stage hands horizontal drags to us (touch-action) — the browser neither claims them nor swipes history", () => {
  mountPresent();
  assert.equal(stage().style.touchAction, "pan-y pinch-zoom", "horizontal drags reach us; vertical scroll and pinch stay native");
});

test("a pinch-zoomed page is panned, not navigated: gestures are off and touch-action goes back to the browser", async () => {
  const vv = Object.assign(new EventTarget(), { scale: 1 });
  win.visualViewport = vv;
  try {
    mountPresent();
    assert.equal(stage().style.touchAction, "pan-y pinch-zoom", "not zoomed: navigation gestures on");
    await act(async () => {
      vv.scale = 2.4;
      vv.dispatchEvent(new Event("resize"));
    });
    assert.equal(stage().style.touchAction, "auto", "zoomed: the browser pans the page");
    fireEvent.click(stage(), { clientX: 10, clientY: 10 });
    fireEvent.click(stage(), { clientX: 10, clientY: 10 });
    assert.equal(counter(), "3 / 3", "a mouse click is not a touch gesture: still advances");
    // On the last slide a swipe RIGHT / a tap LEFT would go back — zoomed, they must not.
    drag({ x: 100, y: 400 }, { x: 240, y: 400 });
    tap(40);
    assert.equal(counter(), "3 / 3", "zoomed: swipes and taps do not change the slide");
    await act(async () => {
      vv.scale = 1;
      vv.dispatchEvent(new Event("resize"));
    });
    assert.equal(stage().style.touchAction, "pan-y pinch-zoom", "zoomed out: navigation gestures are back");
    drag({ x: 100, y: 400 }, { x: 240, y: 400 });
    assert.equal(counter(), "2 / 3", "zoomed out: a swipe right goes back again");
  } finally {
    delete win.visualViewport;
  }
});

test("outside the enlarged mode the stage has no navigation gestures and no touch-action override", () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  assert.notEqual(stage().getAttribute("data-slide-stage"), "present");
  sizeStage();
  assert.equal(stage().style.touchAction, "");
  const page = () => document.querySelector("[data-slide-page]")?.textContent;
  assert.equal(page(), "1 / 3");
  tap(350);
  drag({ x: 300, y: 400 }, { x: 160, y: 400 });
  fireEvent.click(stage());
  assert.equal(page(), "1 / 3", "inline viewer: taps and swipes on the stage do not move the slide");
});

test("the enlarged mode has no text-edit overlay, so edit gestures cannot collide with navigation", () => {
  mountPresent();
  assert.ok(!document.querySelector("[data-slide-frame]"), "no edit frame in the enlarged mode");
  assert.ok(!document.querySelector("[data-slide-editor]"));
});

test("while a text is being edited on a phone, a swipe on the stage does not change the slide or end the edit", async () => {
  phone();
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  sizeStage();
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Keyingi sahifa"));
  });
  const footer = document.querySelector(`[data-slide-frame] [data-src='{"f":"footer"}']`) as HTMLElement;
  assert.ok(footer, "slide 2 has a footer layer");
  await act(async () => {
    fireEvent.doubleClick(footer);
  });
  assert.ok(document.querySelector("[data-slide-editing]"), "phone editing is on");
  assert.ok(document.querySelector("[data-edit-key]"), "the text box is open");
  drag({ x: 300, y: 400 }, { x: 160, y: 400 });
  drag({ x: 100, y: 400 }, { x: 260, y: 400 });
  tap(40);
  tap(350);
  assert.ok(document.querySelector("[data-slide-editing]"), "still editing");
  assert.ok(document.querySelector("[data-edit-key]"), "the text box survived the gestures");
  await act(async () => {
    fireEvent.click(screen.getByText("Tayyor"));
  });
  assert.equal(document.querySelector("[data-slide-page]")?.textContent, "2 / 3", "still on slide 2");
});
