import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ClientEntry, ParamSchema } from "../../lib/studio-core/index.ts";
import { GPT, NANO, withParams } from "./studio-fixtures.ts";

const { ParamRows, intValues, presetsOf, snapInt, aspectHint, styleBlurb, SELECT_FROM, SEGMENT_MAX } = await import("../../components/studio/ParamRows.tsx");
const { carryOver, effective, requestValues, normalizedPrompt, promptLimit, promptMin } = await import("../../components/studio/studio-values.ts");

/**
 * ParamSchema → settings rows (`components/studio/ParamRows.tsx`) and the value helpers behind the form
 * (`studio-values.ts`). «Every param must work» for the generated form:
 *
 *   - every schema param except the prompt renders EXACTLY ONE `data-field={param.name}`, for every real model and for a
 *     synthetic model with one param of every type; nothing else carries `data-field` (two-way coverage);
 *   - `advanced` params sit under the COLLAPSED «Qo'shimcha sozlamalar» (`<details>` without `open`) and are still drawn
 *     once; a model without advanced params has no such section;
 *   - control by type: enum < 7 options → radio group, ≥ 7 → `<select>`; int ≤ 6 values → radio group, longer → stepper;
 *     number → range; bool → switch; extra text → input; image → upload control (P2b); voice → the honest note, never a dead control;
 *   - a change reaches the model-normalized values (`effective`), the request (`requestValues` = `{modelId}` + schema);
 *   - `carryOver` keeps what the new model accepts (the prompt always) and defaults what it does not.
 *
 * Mutations (each turned the named tests red, then restored):
 *   ParamRows draws `p.advanced` rows in the main card too                -> «advanced params…collapsed» (the param is drawn twice);
 *   Control: enum threshold `>= SELECT_FROM` -> `> SELECT_FROM`            -> «control by type», «a change reaches…»;
 *   Control: int always `Segmented` (drop the stepper branch)              -> «control by type», «the stepper…»;
 *   ParamRows forgets to skip the prompt param                             -> «coverage», «advanced…», «a model without advanced…» (prompt drawn twice: box + row);
 *   Row without `<Field id>`                                               -> «coverage» and every test that reads `data-field` (7 of 9);
 *   carryOver keeps invalid values (`validate` check removed)              -> «carryOver»;
 *   requestValues drops `modelId`                                          -> «request values».
 */

afterEach(() => cleanup());

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const fields = () => qa("[data-field]").map((e) => e.getAttribute("data-field")!);

function Harness({ entry, start = {} }: { entry: ClientEntry; start?: Record<string, unknown> }) {
  const [raw, setRaw] = useState<Record<string, unknown>>(start);
  return h(
    "div",
    null,
    h(ParamRows, { entry, raw, onChange: (name: string, value: unknown) => setRaw((r) => ({ ...r, [name]: value })) }),
    h("output", { "data-raw": "" }, JSON.stringify(effective(entry, raw))),
  );
}
const mount = (entry: ClientEntry, start?: Record<string, unknown>) => render(h(Harness, { entry, start }));
const shown = () => JSON.parse(q("[data-raw]")!.textContent ?? "{}") as Record<string, unknown>;

const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Variant ${i}` }));
const everyType: readonly ParamSchema[] = [
  { name: "prompt", label: "Tavsif", type: "text", min: 3, max: 500, affects: "request" },
  { name: "few", label: "Kam variant", type: "enum", options: opts(SELECT_FROM - 1), default: "v0", affects: "request" },
  { name: "many", label: "Ko'p variant", type: "enum", options: opts(SELECT_FROM), default: "v0", affects: "request" },
  { name: "count", label: "Soni", type: "int", min: 1, max: SEGMENT_MAX, default: 1, affects: "price" },
  { name: "length", label: "Uzunlik", type: "int", min: 2, max: 2 * (SEGMENT_MAX + 4), step: 2, default: 4, affects: "both" },
  { name: "strength", label: "Kuch", type: "number", min: 0, max: 1, default: 0.5, affects: "request" },
  { name: "hd", label: "HD", type: "bool", default: false, affects: "request" },
  { name: "negative", label: "Nima bo'lmasin", type: "text", min: 0, max: 100, affects: "request" },
  { name: "ref", label: "Namuna rasm", type: "image", max: 1, mimes: ["image/png"], maxBytes: 1024, affects: "request" },
  { name: "voice", label: "Ovoz", type: "voice", source: "catalog", affects: "request" },
];
const SYNTH = withParams(NANO, "test/every-type", everyType);

test("coverage: every param but the prompt is drawn exactly once as a data-field — real models and one of every type", () => {
  for (const entry of [NANO, GPT, SYNTH]) {
    const { unmount } = mount(entry);
    const want = entry.params.map((p) => p.name).filter((n) => n !== "prompt").sort();
    assert.deepEqual(fields().sort(), want, entry.id);
    unmount();
  }
});

test("advanced params sit under the collapsed «Qo'shimcha sozlamalar» and are still drawn once", () => {
  const entry = withParams(NANO, "test/adv", NANO.params.map((p) => (p.name === "imageStyle" ? { ...p, advanced: true } : p)));
  mount(entry);
  const details = q<HTMLDetailsElement>('details[data-settings="studio-advanced"]');
  assert.ok(details, "the advanced section is drawn");
  assert.ok(!details.open, "…collapsed");
  assert.match(details.querySelector("summary")?.textContent ?? "", /Qo‘shimcha sozlamalar/);
  assert.deepEqual([...details.querySelectorAll("[data-field]")].map((e) => e.getAttribute("data-field")), ["imageStyle"]);
  const main = qa("[data-field]").filter((e) => !details.contains(e)).map((e) => e.getAttribute("data-field")!);
  assert.deepEqual(main.sort(), ["imageCount", "imageRatio"], "the others are in the main card");
  assert.equal(fields().filter((f) => f === "imageStyle").length, 1);
  // The collapsed header says what is set inside (the style's label).
  assert.match(details.querySelector("summary")?.textContent ?? "", /Foto/);
});

test("a model without advanced params has no «Qo'shimcha sozlamalar» section", () => {
  mount(withParams(NANO, "test/plain", NANO.params.map((p) => ({ ...p, advanced: false }))));
  assert.ok(!q("[data-settings]"), "no details");
  assert.equal(fields().length, NANO.params.length - 1);
});

test("control by type", () => {
  mount(SYNTH);
  const control = (id: string) => q(`[data-field="${id}"]`)!;
  assert.ok(control("few").querySelector('[role="radiogroup"]'), `enum with ${SELECT_FROM - 1} options is a radio group`);
  assert.ok(!control("few").querySelector("select"));
  assert.ok(control("many").querySelector("select"), `enum with ${SELECT_FROM} options is a <select>`);
  assert.equal(control("many").querySelectorAll("option").length, SELECT_FROM);
  assert.ok(control("count").querySelector('[role="radiogroup"]'), `int of ${SEGMENT_MAX} values is a radio group`);
  assert.equal(control("count").querySelectorAll('[role="radio"]').length, SEGMENT_MAX);
  // P11 §D: a long int is preset chips + a direct number input (the stepper of P0 made a 15 s clip twelve presses away).
  assert.ok(control("length").querySelector('[role="group"][data-presets]'), "a long int is presets + an input");
  assert.ok(control("length").querySelector('input[type="number"]'), "…with a direct input");
  assert.ok(!control("length").querySelector('[role="radiogroup"]'));
  assert.ok(control("strength").querySelector('input[type="range"]'));
  assert.equal(control("hd").querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
  assert.ok(control("negative").querySelector("input[type=text]"));
  // P2b: an image param is a real control (upload + thumbnails, `ImageInputs`); voice is still an honest note.
  assert.ok(control("ref").querySelector("[data-image-add]"), "image: an add button");
  assert.ok(control("ref").querySelector('input[type="file"]'), "image: a file input");
  for (const id of ["voice"]) {
    assert.match(control(id).textContent ?? "", /hali ishlamaydi/, `${id}: an honest note`);
    assert.equal(control(id).querySelectorAll("button, input, select, textarea").length, 0, `${id}: no dead control`);
  }
});

test("a long int: preset chips are the round values the range accepts (ends included); the input applies an accepted value at once and snaps the rest on blur", async () => {
  mount(SYNTH);
  const range = q('[data-field="length"]')!;
  const chips = () => [...range.querySelectorAll<HTMLButtonElement>("[data-preset]")];
  const input = range.querySelector<HTMLInputElement>('input[type="number"]')!;
  // 2–20 by 2: the round numbers it accepts between the ends are 8 and 10.
  assert.deepEqual(chips().map((b) => Number(b.dataset.preset)), [2, 8, 10, 20]);
  assert.equal(chips().find((b) => b.getAttribute("aria-pressed") === "true"), undefined, "4 is no preset: none pressed");
  assert.equal(input.value, "4");
  assert.equal(input.min, "2");
  assert.equal(input.max, "20");
  assert.equal(input.step, "2");
  await act(async () => void fireEvent.click(chips()[1]!));
  assert.equal(shown().length, 8, "a chip applies its value");
  assert.equal(input.value, "8", "the box follows");
  await act(async () => void fireEvent.change(input, { target: { value: "6" } }));
  assert.equal(shown().length, 6, "MUTATSIYA: an accepted typed value applies at once");
  await act(async () => void fireEvent.change(input, { target: { value: "7" } }));
  assert.equal(shown().length, 6, "7 is off the step: nothing sent while typing");
  await act(async () => void fireEvent.blur(input));
  assert.equal(shown().length, 8, "MUTATSIYA: snapped to the step on blur");
  await act(async () => void fireEvent.change(input, { target: { value: "99" } }));
  await act(async () => void fireEvent.keyDown(input, { key: "Enter" }));
  assert.equal(shown().length, 20, "clamped to the max on Enter");
  assert.equal(input.value, "20");
  assert.deepEqual(intValues({ name: "x", label: "x", type: "int", min: 2, max: 8, step: 2, default: 2, affects: "price" }), [2, 4, 6, 8]);
  // The real ranges: a Kling clip, an effect, a volume by tens, a long offset.
  assert.deepEqual(presetsOf(3, 15), [3, 5, 8, 10, 15]);
  assert.deepEqual(presetsOf(1, 30), [1, 10, 15, 20, 30]);
  assert.deepEqual(presetsOf(10, 200, 10), [10, 60, 100, 150, 200], "MUTATSIYA: every chip must sit on the step");
  assert.deepEqual(presetsOf(0, 179), [0, 45, 90, 120, 179]);
  assert.deepEqual(presetsOf(4, 12, 4), [4, 8, 12]);
  assert.deepEqual(presetsOf(5, 50, 5), [5, 15, 30, 45, 50]);
  assert.equal(snapInt(7, 2, 20, 2), 8);
  assert.equal(snapInt(-5, 2, 20, 2), 2);
  assert.equal(snapInt(Number.NaN, 2, 20, 2), 2);
});

test("a host cap below the schema's max bounds the range (the «Montaj» start offset ends with the video)", async () => {
  const entry = withParams(NANO, "x/cap", [{ name: "startOffset", label: "Boshlanish", type: "int", min: 0, max: 179, default: 0, affects: "request" }]);
  render(h(ParamRows, { entry, raw: { startOffset: 0 }, onChange: () => {}, limits: { startOffset: { max: 29 } } }));
  const range = q('[data-field="startOffset"]')!;
  assert.equal(range.querySelector<HTMLInputElement>('input[type="number"]')!.max, "29", "MUTATSIYA: the schema's 179 must not stay");
  assert.deepEqual([...range.querySelectorAll<HTMLButtonElement>("[data-preset]")].map((b) => Number(b.dataset.preset)), [0, 5, 15, 20, 29]);
});

test("a ratio enum is shapes with the catalog's hint under it; the picture style says what it is", async () => {
  mount(NANO, { imageRatio: "9:16" });
  const ratio = q('[data-field="imageRatio"]')!;
  assert.ok(ratio.querySelector("[data-aspect-picker]"), "shapes, not a plain segmented control");
  const radios = [...ratio.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.deepEqual(radios.map((b) => b.textContent), ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2"], "the label is the only text (the shape is aria-hidden)");
  assert.equal(ratio.querySelector("[data-aspect-hint]")!.textContent, "9:16 · Stories", "MUTATSIYA: the hint of the chosen ratio, from IMAGE_RATIOS");
  await act(async () => void fireEvent.click(radios[1]!));
  assert.equal(ratio.querySelector("[data-aspect-hint]")!.textContent, "16:9 · Slayd");
  assert.equal(aspectHint("21:9"), null, "a ratio the image catalog does not hold has no hint");
  const style = q('[data-field="imageStyle"]')!;
  assert.ok(style.querySelector("select"), "nine styles: a select");
  assert.equal(style.querySelector("[data-style-blurb]")!.textContent, "Foto — Haqiqiy surat");
  await act(async () => void fireEvent.change(style.querySelector("select")!, { target: { value: "watercolor" } }));
  assert.equal(style.querySelector("[data-style-blurb]")!.textContent, "Akvarel — Suv bo‘yoq", "MUTATSIYA: the description follows the pick");
  assert.equal(styleBlurb("nope"), null);
});

test("a change reaches the normalized values; an enum / int / bool / text each round-trip", async () => {
  mount(SYNTH);
  await act(async () => void fireEvent.click(q('[data-field="few"] [role="radio"]:nth-child(3)')!));
  assert.equal(shown().few, "v2");
  await act(async () => void fireEvent.change(q('[data-field="many"] select')!, { target: { value: "v5" } }));
  assert.equal(shown().many, "v5");
  await act(async () => void fireEvent.click(q('[data-field="count"] [role="radio"]:nth-child(4)')!));
  assert.equal(shown().count, 4);
  await act(async () => void fireEvent.click(q('[data-field="hd"] [role="switch"]')!));
  assert.equal(shown().hd, true);
  await act(async () => void fireEvent.change(q('[data-field="negative"] input')!, { target: { value: "  blur  " } }));
  assert.equal(shown().negative, "blur", "the model normalizes the text");
});

test("a value the model does not accept is shown as the default (normalized view)", () => {
  mount(NANO, { imageRatio: "7:3", imageCount: 99 });
  assert.equal(shown().imageRatio, "1:1");
  assert.equal(shown().imageCount, 1);
  const on = qa('[data-field="imageRatio"] [role="radio"]').find((b) => b.getAttribute("aria-checked") === "true");
  assert.equal(on?.textContent, "1:1");
});

test("carryOver keeps what the new model accepts (the prompt always, cut to the limit) and defaults the rest", () => {
  const strict = withParams(NANO, "test/strict", [
    { name: "prompt", label: "Tavsif", type: "text", min: 3, max: 10, affects: "request" },
    { name: "imageRatio", label: "O'lcham", type: "enum", options: [{ value: "1:1", label: "1:1" }, { value: "16:9", label: "16:9" }], default: "1:1", affects: "request" },
    { name: "imageCount", label: "Soni", type: "int", min: 1, max: 2, default: 1, affects: "price" },
  ]);
  const prev = { prompt: "Samarqand Registon", imageRatio: "9:16", imageCount: 3, imageStyle: "cinematic" };
  const next = carryOver(strict, prev);
  assert.deepEqual(next, { prompt: "Samarqand " }, "9:16 / 3 are refused by the new model, the style is unknown to it");
  assert.deepEqual(carryOver(strict, { imageRatio: "16:9", imageCount: 2 }), { imageRatio: "16:9", imageCount: 2 }, "accepted values stay");
  assert.equal(effective(strict, next).imageRatio, "1:1", "…and read as the new model's default");
});

test("request values are exactly {modelId} + the model's schema, the prompt normalized; limits come from the schema", () => {
  const raw = { prompt: "  Registon   kechqurun \n", imageStyle: "cinematic", imageRatio: "16:9", imageCount: 2, extra: "x", topic: "y" };
  for (const entry of [NANO, GPT]) {
    const v = requestValues(entry, raw);
    assert.deepEqual(Object.keys(v).sort(), ["modelId", ...entry.params.map((p) => p.name)].sort(), entry.id);
    assert.equal(v.modelId, entry.id);
    assert.equal(v.prompt, "Registon kechqurun");
    assert.equal(v.imageRatio, "16:9");
    assert.equal(v.imageCount, 2);
  }
  assert.equal(normalizedPrompt(NANO, { prompt: "  ab  " }), "ab");
  const p = NANO.params.find((x) => x.name === "prompt")! as Extract<ParamSchema, { type: "text" }>;
  assert.equal(promptLimit(NANO), p.max);
  assert.equal(promptMin(NANO), p.min);
});
