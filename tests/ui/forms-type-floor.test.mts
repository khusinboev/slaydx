/**
 * Redesign W6 «type sweep» — the type floor of the tool forms.
 *
 * The owner asked for slightly larger text everywhere: nothing under
 * `components/forms/` may be set below 12.5 px (the PLAN typography rule:
 * body/inputs 16, labels 14.5–15, hints >= 13, captions/badges >= 12.5).
 * This is a source scan — class names are the only place the sizes live
 * (no inline `fontSize` in the forms), so it is cheap and exact.
 *
 * Exempt on purpose: the miniature citation line inside the publication
 * profile's page illustration (`PublicationProfilePage`, `text-[6px]`) — a
 * thumbnail of a document, scaled like the SlideThumb/ResumeThumb mocks
 * that R1 §6 forbids touching.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..", "components", "forms");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const EXEMPT = new Map<string, RegExp>([["PublicationProfileDialog.tsx", /text-\[6px\] leading-none/]]);

test("no form text class is below 12.5 px (text-xs / text-[<12.5px])", () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const short = file.slice(ROOT.length + 1);
    const exempt = EXEMPT.get(short.split("/").pop()!);
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const where = `${short}:${i + 1}`;
      if (/(?:^|[^\w:[-])text-xs(?![\w-])/.test(line)) offenders.push(`${where} text-xs`);
      for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
        const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
        if (px < 12.5 && !(exempt && exempt.test(line))) offenders.push(`${where} ${m[0]}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "nothing below 12.5 px in components/forms");
});

test("text inputs carry a 16 px desktop font (the touch layer already forces 16 px)", () => {
  const offenders: string[] = [];
  const files = ["fields.tsx", "PhoneInput.tsx", "slide-fields.tsx", "Combobox.tsx", "MonthPicker.tsx", "YearPicker.tsx"];
  for (const f of files) {
    readFileSync(join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      // an <input>/<select>/<textarea> class string: outline-none focus:ring-2 marks the field chrome
      if (/border-input bg-card focus:ring-ring/.test(line) && !/text-\[16px\]/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], "field chrome without text-[16px]");
});

test("the «Barchasi» catalogue (/uz/create CreateGrid), the «+» sheet and the tab bar: nothing below 12.5 px", () => {
  const COMPONENTS = join(import.meta.dirname, "..", "..", "components");
  const offenders: string[] = [];
  for (const rel of ["home/CreateGrid.tsx", "shell/CreateSheet.tsx", "shell/TabBar.tsx"]) {
    readFileSync(join(COMPONENTS, rel), "utf8").split("\n").forEach((line, i) => {
      if (/(?:^|[^\w:[-])text-xs(?![\w-])/.test(line)) offenders.push(`${rel}:${i + 1} text-xs`);
      for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
        const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
        if (px < 12.5) offenders.push(`${rel}:${i + 1} ${m[0]}`);
      }
    });
  }
  assert.deepEqual(offenders, [], "redesign type floor (PLAN «Typography»)");
});
