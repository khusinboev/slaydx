import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
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
const counter = () => document.querySelector("[data-slide-counter]")?.textContent ?? null;

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

test("visible ‹ › buttons: step, and disable at the ends; arrow keys keep working", () => {
  mountPresent();
  const prev = screen.getByLabelText("Oldingi slayd") as HTMLButtonElement;
  const next = screen.getByLabelText("Keyingi slayd") as HTMLButtonElement;
  assert.equal(prev.disabled, true, "first slide: no previous");
  assert.equal(next.disabled, false);
  fireEvent.click(next);
  assert.equal(counter(), "2 / 3");
  assert.equal(prev.disabled, false);
  fireEvent.click(next);
  assert.equal(counter(), "3 / 3");
  assert.equal(next.disabled, true, "last slide: no next");
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

test("the buttons are 44 px targets and labelled in Uzbek", () => {
  mountPresent();
  for (const label of ["Oldingi slayd", "Keyingi slayd"]) {
    const b = screen.getByLabelText(label);
    assert.ok(b.className.split(/\s+/).includes("size-11"), `${label}: size-11 = 44 px`);
  }
});

// ══════════════════════════════════ scope
test("the enlarged stage hands horizontal drags to the page (touch-action) and never navigates history", () => {
  mountPresent();
  const style = stage().style;
  assert.equal(style.touchAction, "pan-y pinch-zoom", "horizontal drags reach us; vertical scroll and pinch stay native");
  assert.equal(style.overscrollBehaviorX, "none", "no browser history swipe closing the presentation");
});

test("a pinch-zoomed page is panned, not navigated: gestures are off and touch-action goes back to the browser", async () => {
  const vv = Object.assign(new EventTarget(), { scale: 1 });
  win.visualViewport = vv;
  try {
    mountPresent();
    tap(350);
    assert.equal(counter(), "2 / 3", "not zoomed: taps navigate");
    await act(async () => {
      vv.scale = 2.4;
      vv.dispatchEvent(new Event("resize"));
    });
    assert.equal(stage().style.touchAction, "auto", "zoomed: the browser pans the page");
    assert.equal(stage().style.overscrollBehaviorX, "none", "…and still never navigates history");
    drag({ x: 300, y: 400 }, { x: 160, y: 400 });
    drag({ x: 100, y: 400 }, { x: 240, y: 400 });
    tap(350);
    tap(40);
    assert.equal(counter(), "2 / 3", "zoomed: swipes and taps do not change the slide");
    fireEvent.click(stage(), { clientX: 10, clientY: 10 });
    assert.equal(counter(), "3 / 3", "a mouse click is not a touch gesture: still advances");
    await act(async () => {
      vv.scale = 1;
      vv.dispatchEvent(new Event("resize"));
    });
    assert.equal(stage().style.touchAction, "pan-y pinch-zoom", "zoomed out: navigation gestures are back");
    drag({ x: 100, y: 400 }, { x: 240, y: 400 });
    assert.equal(counter(), "2 / 3");
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
