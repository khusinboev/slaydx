import "./setup.ts";
import "./render-count.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renders, resetRenders } from "./render-count.ts";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { SlideEditor, type StylePatch } from "../../components/viewers/SlideEditor.tsx";
import { scrollEditBoxIntoView } from "../../components/viewers/slide-edit/viewport.tsx";
import { PANEL_GAP } from "../../components/viewers/slide-edit/geometry.ts";
import { bodyRules } from "../../lib/generation/slide-audience.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel, SlideSrc } from "../../lib/generation/slide-types.ts";
import type { ListField } from "../../lib/generation/slide-edit.ts";

/**
 * Slide text editing on PHONES (docs/mobile/PLAN.md §3 O4, R3 S1) — jsdom
 * with a stubbed `matchMedia` (coarse pointer).
 *
 * Contract: on a phone the floating panel is gone; a 44 px style bar is
 * portalled into the toolbar slot (never over the slide) with «✕»/«Tayyor»,
 * chips sheet above it (no `<select>`), the bar never takes focus, phone back
 * closes the sheet first and then commits, a pointer double TAP opens a text,
 * and a stage scale change never re-renders the field (caret stays). Desktop:
 * the floating panel is placed from its MEASURED height.
 *
 * Mutations (package D report): bar buttons back to `p-1` → size test fails;
 * `keepEditorFocus` removed → focus test fails; sheet rendered after the bar →
 * order test fails; `useOverlayHistory` for the edit or the sheet removed →
 * back tests fail; detector window broken → double-tap test fails; field
 * keyed by scale → caret test fails; `scrollEditBoxIntoView` call removed →
 * keep-visible test fails; placement back to `top - 34` → desktop test fails.
 */

const nav = await import("../../lib/nav/history.ts");

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
const coarse = () => stubMedia((q) => q.includes("pointer: coarse"));

let slot: HTMLElement | null = null;
afterEach(async () => {
  cleanup();
  slot?.remove();
  slot = null;
  delete win.matchMedia;
  await settle();
  nav.__resetNavForTests();
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

const theme = getSlideTheme("atlas");
const rules = bodyRules({ planItems: 6, textVolume: "standart" }, "lecture");

function bulletsSlide(): SlideModel {
  return { id: "s0", layout: "bullets", title: "Sarlavha matni", bullets: ["Birinchi band", "Ikkinchi band"], footer: "Aliyev · TDPU" };
}

type Calls = { text: [SlideSrc, string][]; list: [ListField, string[]][]; style: [SlideSrc, StylePatch][]; footer: string[] };

function tree(slide: SlideModel, scale: number, calls: Calls) {
  const common = { slide, theme, visual: "classic" as const, audience: "auto" as const, templateId: "lecture" as const, bodyType: rules, index: 1, total: 3 };
  return h(
    "div",
    { "data-slide-stage": "zoom" },
    h(
      "div",
      { "data-slide-frame": "" },
      h(SlideCanvas, { key: "canvas", ...common }),
      h(SlideEditor, {
        key: "editor",
        ...common,
        scale,
        editBarSlot: slot,
        onText: (src: SlideSrc, value: string) => calls.text.push([src, value]),
        onList: (field: ListField, items: string[]) => calls.list.push([field, items]),
        onFooter: (v: string) => calls.footer.push(v),
        onAnswer: () => {},
        onStyle: (src: SlideSrc, patch: StylePatch) => calls.style.push([src, patch]),
        onImage: () => {},
        onUpload: () => {},
        onRestoreImage: () => {},
      }),
    ),
  );
}

function mount(slide = bulletsSlide(), scale = 0.3) {
  slot = document.createElement("div");
  slot.setAttribute("data-slide-editbar-slot", "");
  document.body.appendChild(slot);
  const calls: Calls = { text: [], list: [], style: [], footer: [] };
  const r = render(tree(slide, scale, calls));
  return { calls, rerender: (s: number) => r.rerender(tree(slide, s, calls)), rerenderSlide: (next: SlideModel) => r.rerender(tree(next, scale, calls)) };
}

const box = () => screen.getByLabelText("Matnni tahrirlash");
const boxOpen = () => screen.queryByLabelText("Matnni tahrirlash") !== null;
const titleEl = () => document.querySelector(`[data-src='{"f":"title"}']`) as HTMLElement;
const bar = () => document.querySelector("[data-slide-edit-bar]") as HTMLElement | null;
const sheet = () => document.querySelector("[data-slide-edit-sheet]") as HTMLElement | null;
function type(el: HTMLElement, text: string) {
  el.textContent = text;
  fireEvent.input(el);
}

// ═══════════════════════════════════════ bar

test("phone: no floating panel — the 44 px bar lands in the toolbar SLOT (outside the slide) with Uzbek labels", () => {
  coarse();
  mount();
  fireEvent.doubleClick(titleEl());
  assert.ok(boxOpen());
  assert.ok(!document.querySelector("[data-slide-font-panel]"), "no floating panel over the slide on a phone");
  assert.ok(bar(), "bar rendered");
  assert.ok(slot!.contains(bar()), "bar is portalled into the toolbar slot");
  assert.ok(!document.querySelector("[data-slide-frame]")!.contains(bar()), "nothing of the bar inside the slide frame");
  for (const label of ["Bekor qilish", "Shriftni kichraytirish", "Joriy shrift o‘lchami", "Shriftni kattalashtirish", "Shrift oilasi", "Standart o‘lcham"]) {
    assert.ok(screen.getByLabelText(label), label);
  }
  assert.ok(screen.getByText("Tayyor"));
  assert.equal(slot!.querySelectorAll("select").length, 0, "no native <select> on touch");
  const buttons = Array.from(bar()!.querySelectorAll("button"));
  assert.equal(buttons.length, 7);
  for (const b of buttons) {
    const cls = b.className.split(/\s+/);
    assert.ok(cls.includes("h-11"), `44 px tall: ${b.getAttribute("aria-label") ?? b.textContent}`);
    assert.ok(cls.includes("min-w-11"), `≥ 44 px wide: ${b.getAttribute("aria-label") ?? b.textContent}`);
  }
  assert.ok(bar()!.className.split(/\s+/).includes("h-11"), "bar itself 44 px");
});

test("phone: «Tayyor» commits the typed text; «✕» drops it", () => {
  coarse();
  const { calls } = mount();
  fireEvent.doubleClick(titleEl());
  type(box(), "Yangi sarlavha");
  fireEvent.click(screen.getByText("Tayyor"));
  assert.deepEqual(calls.text, [[{ f: "title" }, "Yangi sarlavha"]]);
  assert.ok(!boxOpen() && !bar(), "box and bar closed");

  fireEvent.doubleClick(titleEl());
  type(box(), "Bekor bo‘ladi");
  fireEvent.click(screen.getByLabelText("Bekor qilish"));
  fireEvent.blur(document.body);
  assert.equal(calls.text.length, 1, "cancel sends nothing");
  assert.ok(!boxOpen());
});

test("phone: the bar never takes focus — pointerdown/mousedown cancelled, the edit stays open and focused", () => {
  coarse();
  const { calls } = mount();
  fireEvent.doubleClick(titleEl());
  const field = box();
  assert.ok(document.activeElement === field, "field focused");
  const plus = screen.getByLabelText("Shriftni kattalashtirish");
  assert.equal(fireEvent.pointerDown(plus, { pointerType: "touch" }), false, "pointerdown default prevented (no focus move)");
  assert.equal(fireEvent.mouseDown(plus), false, "mousedown default prevented");
  fireEvent.click(plus);
  assert.ok(boxOpen(), "a bar press is not an outside press");
  assert.ok(document.activeElement === field, "focus (and the phone keyboard) stays on the text");
  assert.equal(calls.style.length, 1);
  assert.ok(typeof calls.style[0][1].size === "number");
});

// ═══════════════════════════════════════ sheet

test("phone sheet: opens ABOVE the bar (in-flow, same slot), chips for 9 fonts and 12 sizes, ≤ 40 % of the visible height", () => {
  coarse();
  const { calls } = mount();
  fireEvent.doubleClick(titleEl());
  assert.ok(!sheet());
  const chip = screen.getByLabelText("Shrift oilasi");
  assert.equal(chip.getAttribute("aria-expanded"), "false");
  fireEvent.click(chip);
  const s = sheet();
  assert.ok(s, "sheet open");
  assert.equal(chip.getAttribute("aria-expanded"), "true");
  assert.equal(chip.getAttribute("aria-controls"), s!.id);
  assert.ok(slot!.contains(s), "in the toolbar slot, not over the slide");
  assert.ok(s!.compareDocumentPosition(bar()!) & Node.DOCUMENT_POSITION_FOLLOWING, "sheet is above the bar");
  assert.ok(s!.style.maxHeight.includes("0.4"), "height capped at 40 % of --vv-h");
  assert.equal(s!.querySelectorAll("[data-slide-edit-fonts] button").length, 9, "Standart + 8 fonts");
  assert.equal(s!.querySelectorAll("[data-slide-edit-sizes] button[aria-label^='Shrift ']").length, 12);
  for (const b of Array.from(s!.querySelectorAll("button"))) assert.ok(b.className.split(/\s+/).includes("h-11"), "44 px chips");

  fireEvent.click(screen.getByText("Georgia"));
  fireEvent.click(screen.getByLabelText("Shrift 24 pt"));
  assert.deepEqual(calls.style, [
    [{ f: "title" }, { font: "georgia" }],
    [{ f: "title" }, { size: 24 }],
  ]);
  assert.ok(boxOpen() && sheet(), "choosing keeps the edit and the sheet open");
  assert.ok(document.activeElement === box(), "focus still on the text");
});

test("phone sheet: «Standart» chip resets the family; current size chip pressed; size toggle opens the same sheet", () => {
  coarse();
  const { calls } = mount({ ...bulletsSlide(), font: { '{"f":"title"}': "georgia" }, fontSize: { '{"f":"title"}': 36 } });
  fireEvent.doubleClick(titleEl());
  fireEvent.click(screen.getByLabelText("Joriy shrift o‘lchami"));
  assert.ok(sheet());
  assert.equal(screen.getByLabelText("Shrift 36 pt").getAttribute("aria-pressed"), "true");
  assert.equal(within(sheet()!).getByText("Georgia").getAttribute("aria-pressed"), "true");
  fireEvent.click(within(sheet()!).getByText("Standart"));
  assert.deepEqual(calls.style[0], [{ f: "title" }, { font: null }]);
  fireEvent.click(screen.getByText("Standart o‘lcham"));
  assert.deepEqual(calls.style[1], [{ f: "title" }, { size: null }]);
});

// ═══════════════════════════════════════ phone back

test("phone back: first back closes the sheet, the next one ends the edit with a commit", async () => {
  coarse();
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/files/1");
  nav.installNav();
  const { calls } = mount();
  await act(async () => {
    fireEvent.doubleClick(titleEl());
  });
  await settle();
  type(box(), "Orqaga bilan");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Shrift oilasi"));
  });
  await settle();
  assert.ok(sheet());
  window.history.back();
  await settle();
  assert.ok(!sheet(), "back closed the sheet");
  assert.ok(boxOpen(), "…and only the sheet");
  assert.deepEqual(calls.text, []);
  window.history.back();
  await settle();
  assert.ok(!boxOpen(), "second back ended the edit");
  assert.deepEqual(calls.text, [[{ f: "title" }, "Orqaga bilan"]], "auto-save rule: committed, not dropped");
  assert.equal(window.location.pathname, "/uz/files/1", "still on the page");
});

test("«Tayyor» pops the edit's history entry exactly once (back afterwards leaves nothing open)", async () => {
  coarse();
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/files/1");
  nav.installNav();
  mount();
  const before = window.history.length;
  await act(async () => {
    fireEvent.doubleClick(titleEl());
  });
  await settle();
  assert.equal(window.history.length, before + 1, "the edit pushed one entry");
  await act(async () => {
    fireEvent.click(screen.getByText("Tayyor"));
  });
  await settle();
  const sx = (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
  assert.ok(!sx?.o, "back on the page entry, not on an orphan overlay entry");
});

// ═══════════════════════════════════════ double tap

function tapAt(el: HTMLElement, id: number) {
  const r = { clientX: 50, clientY: 40 };
  fireEvent.pointerDown(el, { pointerType: "touch", pointerId: id, isPrimary: true, ...r });
  fireEvent.pointerUp(el, { pointerType: "touch", pointerId: id, isPrimary: true, ...r });
  return fireEvent.touchEnd(el, { cancelable: true });
}

test("double TAP (touch pointers) opens the text without `dblclick`; the second touchend is cancelled; a single tap does not", () => {
  coarse();
  mount();
  tapAt(titleEl(), 1);
  assert.ok(!boxOpen(), "one tap does nothing (no accidental edits while scrolling)");
  const notCancelled = tapAt(titleEl(), 2);
  assert.ok(boxOpen(), "second tap opened the text");
  assert.equal(notCancelled, false, "second touchend prevented: no compat mousedown/click/dblclick");
  assert.ok(document.activeElement === box(), "focused inside the gesture (iOS keyboard)");
  // A compat mousedown that slipped through right after the tap does not close the box.
  fireEvent.mouseDown(titleEl());
  assert.ok(boxOpen());
});

const firstBullet = () => document.querySelector(`[data-src='{"f":"bullets","i":0}']`) as HTMLElement;
function pointerTap(el: HTMLElement, id: number, pointerType: "touch" | "pen") {
  const r = { clientX: 50, clientY: 40 };
  fireEvent.pointerDown(el, { pointerType, pointerId: id, isPrimary: true, ...r });
  fireEvent.pointerUp(el, { pointerType, pointerId: id, isPrimary: true, ...r });
}

test("review D-1: double-tapping ANOTHER text with no compat mousedown first saves the open one", () => {
  coarse();
  const { calls } = mount();
  fireEvent.doubleClick(titleEl());
  type(box(), "Yozilgan yangi sarlavha");
  const oldField = box();
  // Pointer events only — no mousedown reaches the outside-press handler.
  pointerTap(firstBullet(), 1, "touch");
  pointerTap(firstBullet(), 2, "touch");
  assert.deepEqual(calls.text, [[{ f: "title" }, "Yozilgan yangi sarlavha"]], "typed title saved before switching");
  assert.equal(box().tagName, "UL", "the list is now open");
  assert.equal(box().getAttribute("data-edit-key"), '{"f":"bullets","i":0}');
  // Browsers that blur a removed focused node: the OLD field's blur must not end the new session.
  fireEvent.blur(oldField);
  assert.ok(boxOpen() && box().tagName === "UL", "new session survives the old field's blur");
  assert.equal(calls.list.length, 0, "and nothing was committed for it");
  fireEvent.click(screen.getByText("Tayyor"));
  assert.equal(calls.text.length, 1);
  assert.equal(calls.list.length, 0, "list unchanged → no op");
});

test("phone: a tap on the slide (first tap of a double tap on another text) keeps the edit and the focus; the switch then saves", async () => {
  coarse();
  const { calls } = mount();
  fireEvent.doubleClick(titleEl());
  type(box(), "Sarlavha (tahrir)");
  const field = box();
  // Real touch: first tap's compat mousedown on the bullets.
  assert.equal(fireEvent.mouseDown(firstBullet()), false, "default prevented: focus (keyboard) stays on the text");
  assert.ok(boxOpen() && box() === field, "the edit (and the focus zoom) survive the first tap");
  assert.deepEqual(calls.text, []);
  pointerTap(firstBullet(), 1, "touch");
  pointerTap(firstBullet(), 2, "touch");
  assert.deepEqual(calls.text, [[{ f: "title" }, "Sarlavha (tahrir)"]]);
  assert.equal(box().tagName, "UL");
  // A press outside the slide still ends the edit (after the opening tap's swallow window).
  await new Promise((r) => setTimeout(r, 650));
  fireEvent.mouseDown(document.body);
  assert.ok(!boxOpen());
});

test("review D-3: a pen double tap never arms the touchend cancel; a missing touchend is forgotten on the next contact", () => {
  coarse();
  mount();
  pointerTap(titleEl(), 1, "pen");
  pointerTap(titleEl(), 2, "pen");
  assert.ok(boxOpen(), "pen double tap opens");
  assert.equal(fireEvent.touchEnd(titleEl(), { cancelable: true }), true, "an unrelated touchend after a pen open is not cancelled");
  cleanup();
  slot?.remove();
  mount();
  // Finger double tap whose touchend never arrives (webview quirk)…
  pointerTap(titleEl(), 3, "touch");
  pointerTap(titleEl(), 4, "touch");
  assert.ok(boxOpen());
  // …the next contact (e.g. «O‘z rasmim») keeps its click.
  fireEvent.pointerDown(document.querySelector("[data-slide-frame]")!, { pointerType: "touch", pointerId: 5, clientX: 300, clientY: 300 });
  assert.equal(fireEvent.touchEnd(document.querySelector("[data-slide-frame]")!, { cancelable: true }), true);
});

test("review D-4: a slide update between the two taps (optimistic style op) does not reset the detector", () => {
  coarse();
  const { rerenderSlide } = mount();
  pointerTap(titleEl(), 1, "touch");
  rerenderSlide({ ...bulletsSlide(), fontSize: { '{"f":"bullets","i":0}': 30 } });
  pointerTap(titleEl(), 2, "touch");
  assert.ok(boxOpen(), "the second tap still completes the double tap");
});

test("mouse pointers never trigger the tap detector (desktop keeps dblclick only)", () => {
  coarse();
  mount();
  for (let k = 0; k < 2; k++) {
    fireEvent.pointerDown(titleEl(), { pointerType: "mouse", pointerId: 1, clientX: 50, clientY: 40 });
    fireEvent.pointerUp(titleEl(), { pointerType: "mouse", pointerId: 1, clientX: 50, clientY: 40 });
  }
  assert.ok(!boxOpen());
});

// ═══════════════════════════════════════ caret, keep-visible

test("focus zoom / keyboard rescale: the field node, the typed text and the caret survive; the field is NOT re-rendered", () => {
  coarse();
  const { rerender } = mount(bulletsSlide(), 0.3);
  fireEvent.doubleClick(titleEl());
  const field = box();
  type(field, "Kursor joyida");
  const textNode = field.firstChild as Text;
  const sel = window.getSelection()!;
  sel.collapse(textNode, 6);
  resetRenders();
  rerender(0.62);
  rerender(0.48);
  assert.ok(box() === field, "same DOM node");
  assert.equal(field.textContent, "Kursor joyida", "typed text kept");
  assert.ok(sel.anchorNode === textNode, "caret in the same text node");
  assert.equal(sel.anchorOffset, 6, "caret did not move");
  assert.equal(renders("EditField"), 0, "the memoised field was not re-rendered by the scale change");
  assert.ok(renders("SlideEditor") >= 2, "the editor itself did re-render (new scale)");
  const twin = document.querySelector("[data-slide-edit-box]")!.parentElement as HTMLElement;
  assert.equal(twin.style.transform, "scale(0.48)");
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
}

test("keep-visible: a box under the keyboard scrolls the STAGE up into the visible band (and only the stage)", () => {
  const stage = document.createElement("div");
  stage.setAttribute("data-slide-stage", "zoom");
  const boxEl = document.createElement("div");
  stage.appendChild(boxEl);
  document.body.appendChild(stage);
  stage.getBoundingClientRect = () => rect(0, 100, 390, 400); // stage 100..500
  boxEl.getBoundingClientRect = () => rect(40, 380, 200, 40); // box 380..420
  // Keyboard: only 0..340 visible.
  const d = scrollEditBoxIntoView(boxEl, { height: 340, offsetTop: 0 });
  assert.equal(d.dy, 420 - (340 - 8));
  assert.equal(stage.scrollTop, d.dy, "stage scrolled by the delta");
  assert.equal(document.documentElement.scrollTop, 0, "page not scrolled");
  // Already visible → no scroll.
  boxEl.getBoundingClientRect = () => rect(40, 150, 200, 40);
  assert.deepEqual(scrollEditBoxIntoView(boxEl, { height: 340, offsetTop: 0 }), { dx: 0, dy: 0 });
  // iOS: the visual viewport scrolled down by 120 → visible band 120..460.
  boxEl.getBoundingClientRect = () => rect(40, 105, 200, 40);
  assert.equal(scrollEditBoxIntoView(boxEl, { height: 340, offsetTop: 120 }).dy, 105 - 128);
  stage.remove();
});

test("keep-visible runs on open: the phone editor scrolls the stage to the edited box", async () => {
  coarse();
  mount();
  const stage = document.querySelector("[data-slide-stage]") as HTMLElement;
  stage.getBoundingClientRect = () => rect(0, 100, 390, 200);
  const proto = window.HTMLElement.prototype;
  const orig = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function (this: HTMLElement) {
    if (this.hasAttribute("data-slide-edit-box")) return rect(30, 600, 200, 40);
    return orig.call(this);
  };
  try {
    await act(async () => {
      fireEvent.doubleClick(titleEl());
    });
    await settle();
    assert.equal(stage.scrollTop, 640 - (300 - 8), "stage scrolled so the box is inside the visible stage");
  } finally {
    proto.getBoundingClientRect = orig;
  }
});

// ═══════════════════════════════════════ desktop placement

test("desktop: the floating panel is placed from its MEASURED height — a 2-row panel flips below instead of covering the box", () => {
  // No matchMedia → desktop path.
  const probe = mount(bulletsSlide(), 1);
  void probe;
  const top1 = parseFloat(titleEl().style.top);
  const h1 = parseFloat(titleEl().style.height);
  cleanup();
  slot?.remove();
  // Scale chosen so the title starts 50 px below the frame top: the old
  // `top - 34` rule put a 53 px panel at 16..69 — over the text.
  const scale = 50 / top1;
  const proto = window.HTMLElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-slide-font-panel") ? 53 : 0;
    },
  });
  try {
    mount(bulletsSlide(), scale);
    fireEvent.doubleClick(titleEl());
    const panel = document.querySelector("[data-slide-font-panel]") as HTMLElement;
    assert.ok(panel, "desktop keeps the floating panel");
    const top = parseFloat(panel.style.top);
    const boxTop = top1 * scale;
    const boxBottom = (top1 + h1) * scale;
    assert.ok(top >= boxBottom || top + 53 <= boxTop, `panel ${top}..${top + 53} must not overlap box ${boxTop}..${boxBottom}`);
    assert.equal(Math.round(top), Math.round(boxBottom + PANEL_GAP), "flipped below with the gap");
    assert.ok(!bar(), "no phone bar on desktop");
  } finally {
    if (desc) Object.defineProperty(proto, "offsetHeight", desc);
  }
});
