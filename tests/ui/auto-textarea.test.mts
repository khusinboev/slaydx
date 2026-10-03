import "./setup.ts";
import test, { afterEach, before, after } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, createRef, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AutoTextarea, type AutoTextareaProps } from "../../components/common/AutoTextarea.tsx";

/**
 * AutoTextarea (docs/TEXTAREA-POLICY.md): height follows the text in "auto"
 * mode, stays at `rows` lines in "fixed" mode, and there is never a manual
 * resize handle.
 *
 * jsdom has no layout (scrollHeight is always 0), so the prototype's
 * `scrollHeight` is stubbed: every line of text is LINE px of content, plus
 * the vertical padding — exactly what a browser reports. Inline styles give
 * the computed line height, padding, border and box-sizing.
 */

const LINE = 20;
const PAD = 4; // top and bottom
const BORDER = 1; // top and bottom
/** Simulated wrap factor: a narrower textarea wraps each line into this many visual lines. */
let wrap = 1;

const proto = (globalThis as unknown as { window: Window & typeof globalThis }).window.HTMLTextAreaElement.prototype;
const original = Object.getOwnPropertyDescriptor(proto, "scrollHeight");

before(() => {
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      const lines = this.value === "" ? 1 : this.value.split("\n").length;
      return lines * wrap * LINE + 2 * PAD;
    },
  });
});
after(() => {
  if (original) Object.defineProperty(proto, "scrollHeight", original);
  else delete (proto as unknown as Record<string, unknown>).scrollHeight;
});
afterEach(() => {
  cleanup();
  wrap = 1;
});

const BOX = {
  lineHeight: `${LINE}px`,
  fontSize: "14px",
  padding: `${PAD}px 8px`,
  borderWidth: `${BORDER}px`,
  borderStyle: "solid",
  boxSizing: "border-box",
} as const;

/** Border-box height for `n` content lines. */
const heightFor = (n: number) => `${n * LINE + 2 * PAD + 2 * BORDER}px`;
const lines = (n: number) => Array.from({ length: n }, (_, i) => `qator ${i + 1}`).join("\n");
const area = (c: HTMLElement) => c.querySelector("textarea") as HTMLTextAreaElement;

test("auto: grows with the content up to maxRows, then caps and scrolls internally", () => {
  const { container } = render(h(AutoTextarea, { "aria-label": "Mavzu", defaultValue: "", style: BOX }));
  const el = area(container);
  assert.equal(el.style.height, heightFor(2), "empty → minRows (2)");
  assert.equal(el.style.overflowY, "hidden");

  fireEvent.change(el, { target: { value: lines(5) } });
  assert.equal(el.style.height, heightFor(5));
  assert.equal(el.style.overflowY, "hidden", "below the cap there is no scrollbar");

  fireEvent.change(el, { target: { value: lines(20) } });
  assert.equal(el.style.height, heightFor(8), "capped at maxRows (8)");
  assert.equal(el.style.overflowY, "auto", "past the cap it scrolls");
});

test("auto: shrinks back when the text is deleted", () => {
  const { container } = render(h(AutoTextarea, { defaultValue: lines(7), style: BOX }));
  const el = area(container);
  assert.equal(el.style.height, heightFor(7));
  fireEvent.change(el, { target: { value: lines(3) } });
  assert.equal(el.style.height, heightFor(3));
  fireEvent.change(el, { target: { value: "" } });
  assert.equal(el.style.height, heightFor(2));
});

test("auto: respects minRows and custom maxRows", () => {
  const { container } = render(h(AutoTextarea, { defaultValue: "bir", minRows: 4, maxRows: 6, style: BOX }));
  const el = area(container);
  assert.equal(el.style.height, heightFor(4), "one line still shows minRows");
  fireEvent.change(el, { target: { value: lines(10) } });
  assert.equal(el.style.height, heightFor(6));
  assert.equal(el.style.overflowY, "auto");
});

test("auto: recomputes when the controlled value changes programmatically (draft restore, AI rewrite, reset)", () => {
  let set!: (v: string) => void;
  function Host() {
    const [v, setV] = useState("");
    set = setV;
    return h(AutoTextarea, { value: v, onChange: (e) => setV(e.target.value), style: BOX });
  }
  const { container } = render(h(Host));
  const el = area(container);
  assert.equal(el.style.height, heightFor(2));
  act(() => set(lines(6)));
  assert.equal(el.style.height, heightFor(6), "restored draft grows the box without any input event");
  act(() => set(""));
  assert.equal(el.style.height, heightFor(2), "reset shrinks it back");
});

test("auto: maxHeight caps instead of maxRows", () => {
  // 100px border-box cap → 100 - 8 padding - 2 border = 90px of content (4.5 lines).
  const { container } = render(h(AutoTextarea, { defaultValue: lines(3), maxHeight: "100px", maxRows: 50, style: BOX }));
  const el = area(container);
  assert.equal(el.style.maxHeight, "100px");
  assert.equal(el.style.height, heightFor(3));
  assert.equal(el.style.overflowY, "hidden");
  fireEvent.change(el, { target: { value: lines(30) } });
  assert.equal(el.style.height, "100px", "capped by maxHeight, not by maxRows=50");
  assert.equal(el.style.overflowY, "auto");
});

test("auto: a width change (ResizeObserver) re-measures the wrapped text", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = g.ResizeObserver;
  const callbacks: ResizeObserverCallback[] = [];
  g.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      callbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  try {
    const { container } = render(h(AutoTextarea, { defaultValue: lines(2), style: BOX }));
    const el = area(container);
    assert.equal(el.style.height, heightFor(2));
    assert.ok(callbacks.length > 0, "a ResizeObserver is attached");
    wrap = 2; // the textarea got narrower: every line now wraps once
    const entry = { contentRect: { width: 120 } } as unknown as ResizeObserverEntry;
    act(() => callbacks.forEach((cb) => cb([entry], {} as ResizeObserver)));
    assert.equal(el.style.height, heightFor(4));
  } finally {
    g.ResizeObserver = prev;
  }
});

test("fixed: height is `rows` lines and never changes with the content", () => {
  const { container } = render(h(AutoTextarea, { mode: "fixed", rows: 5, defaultValue: "", style: BOX }));
  const el = area(container);
  assert.equal(el.style.height, heightFor(5));
  assert.equal(el.style.overflowY, "auto");
  fireEvent.change(el, { target: { value: lines(40) } });
  assert.equal(el.style.height, heightFor(5));
  fireEvent.change(el, { target: { value: "" } });
  assert.equal(el.style.height, heightFor(5));
});

test("fixed: without `rows` it uses minRows", () => {
  const { container } = render(h(AutoTextarea, { mode: "fixed", minRows: 3, readOnly: true, value: lines(12), style: BOX }));
  assert.equal(area(container).style.height, heightFor(3));
});

test("never a manual resize handle, even when the caller asks for one", () => {
  for (const props of [
    {},
    { mode: "fixed" as const },
    { style: { ...BOX, resize: "vertical" as const } },
    { maxHeight: "60vh" },
  ]) {
    const { container, unmount } = render(h(AutoTextarea, props));
    assert.equal(area(container).style.resize, "none", JSON.stringify(props));
    unmount();
  }
});

test("forwards the ref and native props (maxLength, aria-*, data-*, className, onChange)", () => {
  const ref = createRef<HTMLTextAreaElement>();
  const seen: string[] = [];
  // data-* attributes are valid JSX but not part of the props type for an object literal.
  const props: AutoTextareaProps & { ref: typeof ref; "data-field": string } = {
    ref,
    maxLength: 300,
    "aria-label": "Tavsif",
    "aria-describedby": "hint",
    "data-field": "description",
    className: "w-full",
    placeholder: "Qisqa tavsif",
    name: "description",
    onChange: (e) => {
      seen.push(e.target.value);
    },
  };
  const { container } = render(h(AutoTextarea, props));
  const el = area(container);
  assert.ok(ref.current === el, "ref points at the <textarea>");
  assert.equal(el.maxLength, 300);
  assert.equal(el.getAttribute("aria-label"), "Tavsif");
  assert.equal(el.getAttribute("aria-describedby"), "hint");
  assert.equal(el.getAttribute("data-field"), "description");
  assert.equal(el.className, "w-full");
  assert.equal(el.placeholder, "Qisqa tavsif");
  assert.equal(el.name, "description");
  fireEvent.change(el, { target: { value: "salom" } });
  assert.deepEqual(seen, ["salom"]);
});

test("callback refs are supported too", () => {
  let got: HTMLTextAreaElement | null = null;
  const { container } = render(h(AutoTextarea, { ref: (n: HTMLTextAreaElement | null) => { got = n; } }));
  assert.ok(got === area(container));
});
