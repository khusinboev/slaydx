import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
import { ResultLayout } from "../../components/files/ResultLayout.tsx";
import { EDIT_HINT_KEY, EDIT_HINT_TEXT } from "../../components/viewers/slide-edit/EditHint.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * Slide viewer on PHONES while a text is edited (docs/mobile/PLAN.md §3 O4,
 * R3 S2) — jsdom with a stubbed `matchMedia`.
 *
 * Contract: the toolbar becomes the slot of the 44 px style bar (the bar
 * REPLACES it), the stage temporarily focus-zooms on the edited box and comes
 * back to the exact previous view after «Tayyor»/«✕», the thumbnail strip and
 * the status row are hidden, the result header is compact while editing,
 * and touch users get a one-time dismissible double-tap hint. Desktop: no
 * hint, no bar, toolbar unchanged.
 *
 * Mutations (package D report): `editBar` ignored by SlideToolbar → "bar
 * replaces the toolbar" fails; `focus` not passed → zoom test fails; strip /
 * status not hidden → hide test fails; `useCompactHeaderWhile` removed →
 * compact test fails; hint storage write removed → hint test fails.
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
/** A 390 px phone: coarse pointer, < md, not wide. */
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

const stage = () => document.querySelector("[data-slide-stage]") as HTMLElement;
const frame = () => document.querySelector("[data-slide-stage] > div") as HTMLElement;
const toolbar = () => document.querySelector("[data-slide-toolbar]") as HTMLElement;

/** Phone stage: 374 px inner width, aspect box (R3 numbers at 390 px). */
async function sizeStage(w = 390, hgt = 219) {
  const el = stage();
  Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: hgt, configurable: true });
  await act(async () => {
    for (const o of [...observers]) if (o.el === el) o.cb();
  });
}

async function mountViewer() {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  await sizeStage();
}

async function openFooter() {
  // Slide 2 has a footer — a small box that needs the focus zoom.
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Keyingi sahifa"));
  });
  const footer = document.querySelector(`[data-slide-frame] [data-src='{"f":"footer"}']`) as HTMLElement;
  assert.ok(footer, "footer layer");
  await act(async () => {
    fireEvent.doubleClick(footer);
  });
}

test("phone editing: the 44 px bar REPLACES the toolbar (same in-flow slot); after «Tayyor» the toolbar is back", async () => {
  phone();
  await mountViewer();
  assert.ok(screen.getByLabelText("Oldingi sahifa"), "toolbar before editing");
  await openFooter();
  assert.equal(toolbar().getAttribute("data-slide-toolbar-mode"), "edit");
  assert.ok(toolbar().className.split(/\s+/).includes("min-h-11"), "slot is 44 px high (toolbar 40 → ≤ 4 px stage change)");
  assert.ok(toolbar().querySelector("[data-slide-editbar-slot] [data-slide-edit-bar]"), "bar inside the toolbar slot");
  assert.ok(!screen.queryByLabelText("Oldingi sahifa"), "page/zoom controls replaced while editing");
  assert.ok(!stage().contains(document.querySelector("[data-slide-edit-bar]")), "bar is not on the stage");
  await act(async () => {
    fireEvent.click(screen.getByText("Tayyor"));
  });
  assert.ok(!toolbar().hasAttribute("data-slide-toolbar-mode"));
  assert.ok(screen.getByLabelText("Oldingi sahifa"), "toolbar restored");
});

test("phone focus zoom: a small box zooms the stage while editing; «✕» restores the exact previous fit view", async () => {
  phone();
  await mountViewer();
  // Cover slide footer: 550 slide px ≈ 167 px at phone fit (< 60 % of the stage).
  const fitW = parseFloat(frame().style.width);
  const label = document.querySelector("[data-zoom-label]")!.textContent;
  assert.equal(stage().getAttribute("data-slide-stage"), "fit");
  const footer = document.querySelector(`[data-slide-frame] [data-src='{"f":"footer"}']`) as HTMLElement;
  await act(async () => {
    fireEvent.doubleClick(footer);
  });
  assert.ok(stage().hasAttribute("data-focus-zoom"), "focus zoom on");
  assert.equal(stage().getAttribute("data-slide-stage"), "zoom", "scrollable stage while zoomed");
  const zoomedW = parseFloat(frame().style.width);
  assert.ok(zoomedW > fitW * 1.2, `stage zoomed (${fitW} → ${zoomedW})`);
  const boxW = parseFloat((document.querySelector("[data-slide-edit-box]") as HTMLElement).style.width);
  const scale = zoomedW / 1280;
  assert.ok(boxW * scale >= 0.6 * (390 - 16) - 1, "edited box ≥ 60 % of the stage width");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Bekor qilish"));
  });
  assert.ok(!stage().hasAttribute("data-focus-zoom"));
  assert.equal(stage().getAttribute("data-slide-stage"), "fit", "fit mode restored");
  assert.equal(parseFloat(frame().style.width), fitW, "same scale as before");
  assert.equal(document.querySelector("[data-zoom-label]")!.textContent, label, "zoom label unchanged");
});

test("phone editing hides the thumbnail strip and the status row (kept mounted), shows them again after", async () => {
  phone();
  await mountViewer();
  const strip = () => document.querySelector("[data-slide-strip-wrap]") as HTMLElement;
  const status = () => document.querySelector("[data-slide-status]") as HTMLElement;
  assert.equal(strip().className, "contents");
  assert.ok(!status().className.split(/\s+/).includes("hidden"));
  await openFooter();
  assert.ok(document.querySelector("[data-slide-editing]"), "editing marker on the viewer");
  assert.equal(strip().className, "hidden");
  assert.ok(strip().querySelector("[data-rail='strip']"), "strip stays mounted (scroll position survives)");
  assert.ok(status().className.split(/\s+/).includes("hidden"));
  await act(async () => {
    fireEvent.click(screen.getByText("Tayyor"));
  });
  assert.equal(strip().className, "contents");
  assert.ok(!status().className.split(/\s+/).includes("hidden"));
});

test("desktop (no coarse pointer): no hint, no bar, no focus zoom — the floating panel as before", async () => {
  await mountViewer();
  assert.ok(!screen.queryByText(EDIT_HINT_TEXT));
  await openFooter();
  assert.ok(document.querySelector("[data-slide-font-panel]"), "floating panel");
  assert.ok(!document.querySelector("[data-slide-edit-bar]"));
  assert.ok(!toolbar().hasAttribute("data-slide-toolbar-mode"));
  assert.ok(!stage().hasAttribute("data-focus-zoom"));
  assert.ok(!document.querySelector("[data-slide-editing]"));
});

// ═══════════════════════════════════════ hint

test("touch hint: shown once under the stage, «✕» hides it and remembers (localStorage)", async () => {
  phone();
  await mountViewer();
  const hint = screen.getByText(EDIT_HINT_TEXT);
  assert.ok(hint);
  const note = hint.closest("[data-slide-edit-hint]") as HTMLElement;
  assert.ok(!stage().contains(note), "never over the slide");
  const close = screen.getByLabelText("Maslahatni yopish");
  assert.ok(close.className.split(/\s+/).includes("size-11"), "44 px close");
  await act(async () => {
    fireEvent.click(close);
  });
  assert.ok(!screen.queryByText(EDIT_HINT_TEXT));
  assert.equal(window.localStorage.getItem(EDIT_HINT_KEY), "1");
  cleanup();
  await mountViewer();
  assert.ok(!screen.queryByText(EDIT_HINT_TEXT), "not shown again");
});

test("touch hint: opening a text counts as learned (hidden, remembered)", async () => {
  phone();
  await mountViewer();
  assert.ok(screen.getByText(EDIT_HINT_TEXT));
  await openFooter();
  await act(async () => {
    fireEvent.click(screen.getByText("Tayyor"));
  });
  assert.ok(!screen.queryByText(EDIT_HINT_TEXT));
  assert.equal(window.localStorage.getItem(EDIT_HINT_KEY), "1");
});

test("touch hint: storage that throws never breaks the viewer (hint still dismissible)", async () => {
  phone();
  const ls = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    await mountViewer();
    assert.ok(screen.getByText(EDIT_HINT_TEXT));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Maslahatni yopish"));
    });
    assert.ok(!screen.queryByText(EDIT_HINT_TEXT));
  } finally {
    if (ls) Object.defineProperty(window, "localStorage", ls);
  }
});

// ═══════════════════════════════════════ compact header

test("result header is compact while editing on a phone (frozen outer height — no jump), full again after", async () => {
  phone();
  render(
    h(ResultLayout, {
      header: h("div", { style: { height: 55 } }, "Sarlavha"),
      frame: "fill",
      children: h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }),
    }),
  );
  await sizeStage();
  const inner = () => document.querySelector("[data-result-header-inner]") as HTMLElement;
  const outer = () => document.querySelector("[data-result-header]") as HTMLElement;
  assert.ok(!inner().hasAttribute("data-compact"));
  outer().getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 55.5, right: 390, bottom: 55.5, x: 0, y: 0, toJSON() {} }) as DOMRect;
  await openFooter();
  assert.equal(inner().getAttribute("data-compact"), "1", "compact while editing");
  assert.equal(outer().style.minHeight, "55.5px", "outer keeps the full height: the stage does not move");
  await act(async () => {
    fireEvent.click(screen.getByText("Tayyor"));
  });
  assert.ok(!inner().hasAttribute("data-compact"), "back to the full header");
});
