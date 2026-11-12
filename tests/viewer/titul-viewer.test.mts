import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { TitulPage } from "../../components/viewers/titul/TitulPage.tsx";
import { titulInputFromValues } from "../../lib/generation/title-page/input.ts";
import { planTitlePage, titulRuns } from "../../lib/generation/title-page/layout.ts";
import { renderTitulDocx } from "../../lib/generation/title-page/render-docx.ts";
import { TITUL_LAYOUTS_OF, TITUL_WORK_TYPES, type TitulModel } from "../../lib/generation/title-page/types.ts";
import type { FormValues } from "../../lib/types.ts";

/**
 * «Ko'rdim = oldim» for «Titul»: the viewer sheet (`TitulPage`) shows the plan's runs in the plan's order — the same
 * sequence the DOCX writes as `<w:t>` — with the plan's geometry (zone heights, margins, the double border).
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `TitulPage` drops the tail (city line) -> «same runs, same order as the plan and the DOCX»;
 *   M2. the border div rendered unconditionally -> «border only when the plan has one»;
 *   M3. zone `minHeight` from a constant 80 mm -> «zone heights from the plan».
 */

const SAMPLE: FormValues = {
  university: "Toshkent davlat universiteti",
  faculty: "Kompyuter injiniringi",
  department: "Axborot xavfsizligi",
  subject: "Dasturlash asoslari",
  topic: "Sun'iy intellekt",
  author: "Aliyev V.",
  group: "912-21",
  course: "3",
  supervisor: "Karimov B.",
  supervisorRole: "katta o'qituvchi",
  direction: "Kompyuter injiniringi",
  speciality: "Axborot xavfsizligi",
  reviewer: "dotsent Yusupov A.",
  udk: "004.8",
  year: 2026,
};

const model = (v: FormValues): TitulModel => ({ input: titulInputFromValues(v), overrides: {} });
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&apos;/g, "'");

function viewerRuns(html: string): Array<{ id: string; text: string }> {
  return [...html.matchAll(/<span data-path="([^"]+)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({ id: m[1]!, text: decode(m[2]!) }));
}

async function docxText(m: TitulModel): Promise<string> {
  const xml = await (await JSZip.loadAsync(await renderTitulDocx(m))).file("word/document.xml")!.async("string");
  return decode([...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((x) => x[1]!).join("")).replace(/\s+/g, "");
}

test("same runs, same order as the plan and the DOCX — every type × layout", async () => {
  for (const t of TITUL_WORK_TYPES) {
    for (const layout of TITUL_LAYOUTS_OF[t]) {
      const m = model({ ...SAMPLE, workType: t, layout });
      const plan = planTitlePage(m);
      const html = renderToStaticMarkup(h(TitulPage, { plan }));
      const seen = viewerRuns(html);
      assert.deepEqual(
        seen.map((r) => r.id),
        titulRuns(plan).map((r) => r.id),
        `${t}/${layout} ids`,
      );
      assert.deepEqual(
        seen.map((r) => r.text),
        titulRuns(plan).map((r) => r.text),
        `${t}/${layout} texts`,
      );
      assert.equal(seen.map((r) => r.text).join("").replace(/\s+/g, ""), await docxText(m), `${t}/${layout}: viewer = DOCX`);
    }
  }
});

test("border only when the plan has one; sheet is A4 with the plan's margins", () => {
  const on = renderToStaticMarkup(h(TitulPage, { plan: planTitlePage(model({ ...SAMPLE, layout: "classic" })) }));
  assert.match(on, /data-titul-border[^>]*style="[^"]*inset:14pt[^"]*border:2.25pt double #000/);
  assert.match(on, /width:210mm;height:297mm/);
  assert.match(on, /padding:20mm 22mm 18mm 22mm/);
  const off = renderToStaticMarkup(h(TitulPage, { plan: planTitlePage(model({ ...SAMPLE, layout: "classic", border: false })) }));
  assert.ok(!off.includes("data-titul-border"));
});

test("zone heights and vertical alignment come from the plan", () => {
  const plan = planTitlePage(model({ ...SAMPLE, layout: "classic" }));
  const html = renderToStaticMarkup(h(TitulPage, { plan }));
  for (const z of plan.zones) {
    const just = { top: "flex-start", center: "center", bottom: "flex-end" }[z.valign];
    assert.match(html, new RegExp(`data-titul-zone="${z.id}" style="min-height:${z.heightMm}mm;display:flex;flex-direction:column;justify-content:${just}"`), z.id);
  }
  // A blank signature value is still a clickable, one-line-high run on the underline.
  const blank = renderToStaticMarkup(h(TitulPage, { plan: planTitlePage(model({ ...SAMPLE, author: "" })) }));
  assert.match(blank, /<span data-path="author.value" style="[^"]*display:block;min-height:1.15em"><\/span>/);
});
