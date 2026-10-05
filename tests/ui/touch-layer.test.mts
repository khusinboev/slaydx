import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Card, Row, Segmented, SelectField, Switch, SummaryChips } from "../../components/forms/compact.tsx";
import { ChipGroup, MultiChipGroup, RangeField } from "../../components/forms/fields.tsx";
import { ClearFormButton, ColorDots, Counter, NumberInput, RangeRow } from "../../components/forms/shared/index.tsx";

/**
 * Mobile sprint P12 — touch layer + form primitives (docs/mobile/PLAN.md O5, R5 F1/F2/F3/F13).
 *
 * Locked here:
 *  - Row ⓘ hint: desktop keeps the `title` tooltip; on a coarse pointer it becomes a
 *    `button[aria-expanded]` that toggles an inline `[data-hint]` paragraph.
 *  - globals.css: the `* { border-color }` rule lives in `@layer base` (an unlayered
 *    rule beats every `border-*` utility), the coarse-pointer block sets 16 px inputs
 *    and defines the `.hit-44` expander.
 *  - Primitives carry the `pointer-coarse:` size classes (44 px targets on touch) and
 *    keep their desktop classes (fine-pointer visuals unchanged).
 */

const win = window as unknown as Record<string, unknown>;
afterEach(() => {
  cleanup();
  delete win.matchMedia;
});

function stubCoarse(matches: boolean) {
  win.matchMedia = () => ({
    matches,
    media: "",
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

/** Text of every top-level block `<head> { … }` (balanced braces); `head` is matched literally. */
function topLevelBlocks(src: string): Array<{ head: string; body: string }> {
  const out: Array<{ head: string; body: string }> = [];
  let depth = 0;
  let headStart = 0;
  let bodyStart = 0;
  let head = "";
  // Comments can hold braces — strip them first.
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === "{") {
      if (depth === 0) {
        head = clean.slice(headStart, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        out.push({ head, body: clean.slice(bodyStart, i) });
        headStart = i + 1;
      }
    } else if (c === ";" && depth === 0) headStart = i + 1;
  }
  return out;
}

/* ───────────────────────── Row hint ───────────────────────── */

test("Row hint, desktop (fine pointer): `title` tooltip stays, no button, no inline hint", () => {
  stubCoarse(false);
  const { container } = render(h(Row, { label: "Tur", hint: "Hujjat turi" }, h("span", null, "ctl")));
  const tip = container.querySelector("[title]");
  assert.ok(tip, "ⓘ with title");
  assert.equal(tip!.getAttribute("title"), "Hujjat turi");
  assert.ok(!container.querySelector("button"), "no button on desktop");
  assert.ok(!container.querySelector("[data-hint]"), "no inline hint on desktop");
});

test("Row hint, no matchMedia at all (SSR/jsdom default) behaves like desktop", () => {
  const { container } = render(h(Row, { label: "Tur", hint: "Hujjat turi" }, h("span", null, "ctl")));
  assert.ok(container.querySelector("[title]"));
  assert.ok(!container.querySelector("button"));
});

test("Row hint, touch: ⓘ is a button[aria-expanded]; tap toggles the inline hint under the row", () => {
  stubCoarse(true);
  const { container } = render(h(Row, { label: "Tur", hint: "Hujjat turi: referat yoki kurs ishi" }, h("span", { "data-ctl": "" }, "ctl")));
  const btn = container.querySelector("button") as HTMLButtonElement;
  assert.ok(btn, "tap-to-expand button");
  assert.ok(!container.querySelector("[title]"), "no hover-only tooltip on touch");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.ok(!container.querySelector("[data-hint]"), "collapsed: hint text absent");

  fireEvent.click(btn);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  const hint = container.querySelector("[data-hint]") as HTMLElement;
  assert.ok(hint, "expanded: hint paragraph visible");
  assert.equal(hint.textContent, "Hujjat turi: referat yoki kurs ishi");
  assert.equal(btn.getAttribute("aria-controls"), hint.id, "button controls the hint");
  // the hint follows the control (rendered below the row), not before the label
  const ctl = container.querySelector("[data-ctl]")!;
  assert.ok(ctl.compareDocumentPosition(hint) & 4 /* DOCUMENT_POSITION_FOLLOWING */, "hint is below the control");

  fireEvent.click(btn);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.ok(!container.querySelector("[data-hint]"), "second tap collapses");
});

test("Row hint, touch: hint state is per row; a row without a hint renders no button", () => {
  stubCoarse(true);
  const { container } = render(
    h("div", null, h(Row, { label: "A", hint: "izoh A" }, "a"), h(Row, { label: "B", hint: "izoh B" }, "b"), h(Row, { label: "C" }, "c")),
  );
  const buttons = container.querySelectorAll("button");
  assert.equal(buttons.length, 2);
  fireEvent.click(buttons[1]!);
  const hints = [...container.querySelectorAll("[data-hint]")].map((e) => e.textContent);
  assert.deepEqual(hints, ["izoh B"]);
});

test("Row hint, touch: the ⓘ button is a 44 px target (size-11) that does not grow the row (negative margin)", () => {
  stubCoarse(true);
  const { container } = render(h(Row, { label: "Tur", hint: "izoh" }, "x"));
  const cls = container.querySelector("button")!.className;
  assert.match(cls, /\bsize-11\b/);
  assert.match(cls, /-m-3\b/);
});

/* ───────────────────────── globals.css ───────────────────────── */

test("globals.css: `* { border-color }` lives in @layer base so border-* utilities win", () => {
  const blocks = topLevelBlocks(css);
  // no UNLAYERED universal border-colour rule
  const unlayered = blocks.filter((b) => b.head === "*" && /border-color/.test(b.body));
  assert.equal(unlayered.length, 0, "unlayered `* { border-color }` overrides every border-* utility");
  const base = blocks.filter((b) => b.head === "@layer base");
  assert.ok(base.length >= 1, "@layer base block exists");
  const inBase = base.some((b) => topLevelBlocks(b.body).some((r) => r.head === "*" && /border-color:\s*var\(--border\)/.test(r.body)));
  assert.ok(inBase, "the universal border-color default is inside @layer base");
});

test("globals.css: coarse-pointer layer — 16 px inputs/selects/textareas, hit-area expander, 44 px", () => {
  const coarse = topLevelBlocks(css).filter((b) => b.head === "@media (pointer: coarse)");
  assert.ok(coarse.length >= 1, "@media (pointer: coarse) exists");
  const all = coarse.map((b) => b.body).join("\n");
  const inputRule = topLevelBlocks(all).find((r) => /\btextarea\b/.test(r.head) && /\bselect\b/.test(r.head) && /\binput\b/.test(r.head));
  assert.ok(inputRule, "one rule covers input, textarea and select");
  assert.match(inputRule!.body, /font-size:\s*16px/);
  const hit = topLevelBlocks(all).find((r) => /\.hit-44::after/.test(r.head));
  assert.ok(hit, ".hit-44::after expander rule");
  assert.match(hit!.body, /position:\s*absolute/);
  assert.match(hit!.body, /44px/);
  // the fine-pointer desktop must not be affected: no 16px rule outside the coarse query
  const outside = topLevelBlocks(css).filter((b) => b.head !== "@media (pointer: coarse)" && /^(input|textarea|select)/.test(b.head));
  assert.equal(outside.length, 0);
});

/* ───────────────────────── primitives ───────────────────────── */

test("Segmented: option buttons are 44 px on touch (min-h-11 + min-w-11), desktop classes intact", () => {
  const { container } = render(
    h(Segmented, { options: [{ value: "a", label: "3" }, { value: "b", label: "4" }], value: "a", onChange() {}, ariaLabel: "Reja" }),
  );
  const b = container.querySelector("button")!;
  assert.match(b.className, /pointer-coarse:min-h-11/);
  assert.match(b.className, /pointer-coarse:min-w-11/);
  assert.match(b.className, /\bpx-2\.5\b/);
  assert.match(b.className, /\bpy-1\b/);
  assert.match(b.className, /\btext-xs\b/);
});

test("Segmented/Switch/ColorDots keep their behaviour: click, aria-checked", () => {
  const seen: string[] = [];
  const { container } = render(
    h("div", null,
      h(Segmented, { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], value: "a", onChange: (v: string) => void seen.push(v) }),
      h(Switch, { checked: false, onChange: (v: boolean) => void seen.push(String(v)), ariaLabel: "Yoqish" }),
      h(ColorDots, { options: [{ id: "x", hex: "#111111", label: "Qora" }, { id: "y", hex: "#eeeeee", label: "Oq" }], value: "x", onChange: (id: string) => void seen.push(id) }),
    ),
  );
  fireEvent.click(container.querySelector('[role="radio"][aria-checked="false"]') as HTMLElement); // Segmented "B"
  fireEvent.click(container.querySelector('[role="switch"]') as HTMLElement);
  const dots = container.querySelectorAll('[role="radiogroup"]')[1]!.querySelectorAll("[role=radio]");
  assert.equal(dots[0]!.getAttribute("aria-checked"), "true");
  fireEvent.click(dots[1] as HTMLElement);
  assert.deepEqual(seen, ["b", "true", "y"]);
});

test("Switch: the button is a 44 px target on touch, the track keeps its visual size", () => {
  const { container } = render(h(Switch, { checked: true, onChange() {}, ariaLabel: "x" }));
  const btn = container.querySelector("button")!;
  assert.match(btn.className, /pointer-coarse:h-11/);
  assert.match(btn.className, /pointer-coarse:w-14/);
  const track = btn.firstElementChild!;
  assert.match(track.className, /\bh-5\b/);
  assert.match(track.className, /\bw-9\b/);
  assert.match(track.className, /pointer-coarse:h-7/);
  assert.match(track.className, /pointer-coarse:w-12/);
});

test("SelectField is h-11 on touch; ColorDots buttons are 44 px on touch with a smaller visual dot", () => {
  const { container } = render(
    h("div", null,
      h(SelectField, { options: [{ value: "a", label: "A" }], value: "a", onChange() {}, ariaLabel: "tanlov" }),
      h(ColorDots, { options: [{ id: "x", hex: "#123456", label: "Ko'k" }], value: "x", onChange() {} }),
    ),
  );
  assert.match(container.querySelector("select")!.className, /pointer-coarse:h-11/);
  const dotBtn = container.querySelector("[role=radio]") as HTMLElement;
  assert.match(dotBtn.className, /pointer-coarse:size-11/);
  const dot = dotBtn.firstElementChild as HTMLElement;
  assert.ok(dot, "visual dot inside the 44 px button");
  assert.match(dot.className, /pointer-coarse:size-7/);
  assert.ok(/#123456|rgb\(18, 52, 86\)/i.test(dot.style.background), "dot carries the colour");
});

test("Chip groups, range inputs, number input, clear button: 44 px on touch", () => {
  const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  const { container } = render(
    h("div", null,
      h(ChipGroup, { options: opts, value: "a", onChange() {} }),
      h(MultiChipGroup, { options: opts, value: [], onChange() {} }),
      h(RangeField, { value: 5, min: 1, max: 10, onChange() {} }),
      h(RangeRow, { label: "Hajm", id: "n", value: 5, min: 1, max: 10, onChange() {} }),
      h(NumberInput, { value: 3, min: 1, max: 9, onChange() {}, ariaLabel: "son" }),
      h(ClearFormButton, { armed: false, onClick() {} }),
    ),
  );
  for (const b of container.querySelectorAll("button")) assert.match(b.className, /pointer-coarse:min-h-11/, `button ${b.textContent}`);
  for (const r of container.querySelectorAll("input[type=range]")) assert.match(r.className, /pointer-coarse:h-11/);
  assert.match(container.querySelector("input[type=number]")!.className, /pointer-coarse:h-11/);
});

test("Card title, summary chips and counter are >= 12 px on touch", () => {
  const { container } = render(
    h("div", null, h(Card, { title: "Mavzu" }, "x"), h(SummaryChips, { items: ["a"] }), h(Counter, { len: 1, limit: 10 })),
  );
  assert.match(container.querySelector("h2")!.className, /pointer-coarse:text-xs/);
  assert.match(container.querySelector("[data-summary-chips]")!.className, /pointer-coarse:text-xs/);
  assert.match(container.querySelector("[data-counter]")!.className, /pointer-coarse:text-xs/);
});
