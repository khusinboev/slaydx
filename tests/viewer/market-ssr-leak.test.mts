import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { MarketCatalog } from "../../components/market/MarketCatalog.tsx";
import { MarketItemPage } from "../../components/market/MarketItemPage.tsx";
import { outlineOf, summaryOf } from "../../lib/market/listing.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { MarketItemView } from "../../lib/market/types.ts";
import { ID, card, item, list, withRouter } from "../ui/market-fixture.ts";

/**
 * SSR leak (docs/market/PLAN.md §3.1, M15): the HTML a crawler or a devtools user gets from the public pages holds the title,
 * the summary, the outline headings, the facts and the preview URLs, and not one sentence of the body.
 *
 * The view goes through the real listing functions (`outlineOf`, `summaryOf`) from a fixture document, then through the real
 * page component, so a listing that started quoting the body turns this red as well as a page that did.
 *
 * Mutations (each turned this file red, restored byte for byte):
 *   M1 `lib/market/listing.ts outlineOf`: a heading + its first paragraph → «no body sentence»;
 *   M2 `MarketItemPage`: draw a `sections` field that came along → «the page never holds a body field»;
 *   M3 `MarketItemPage`: `enabled`/`live` check removed → «dark: the page holds nothing of an item»;
 *   M4 `app/uz/market/[id]/page.tsx`: import `getItemDoc` → «the page module never reads a document».
 */

const SECRET = [
  "Bu jumla faqat xaridor ko'radigan matnning birinchi gapi hisoblanadi",
  "Ikkinchi paragrafda muallif o'z xulosasini batafsil bayon etadi",
  "Jadval katagida turgan sir qiymat",
];

const doc = {
  meta: { title: "Amir Temur davri", language: "uz" },
  sections: [
    { title: "Kirish", blocks: [{ kind: "p", text: SECRET[0] }] },
    { title: "Davlat boshqaruvi", blocks: [{ kind: "p", text: SECRET[1] }, { kind: "table", headers: ["A"], rows: [[SECRET[2]]] }] },
    { title: "Xulosa", blocks: [{ kind: "li", text: SECRET[1] }] },
  ],
} as unknown as AcademicDoc;

const outline = outlineOf(doc);
const view: MarketItemView = item({ title: "Amir Temur davri", outline, summary: summaryOf("referat", "Amir Temur davri", outline, { pages: 18 } as never) });

const page = (v: MarketItemView | null, enabled = true) => renderToString(withRouter(h(MarketItemPage, { id: ID, enabled, initial: v }), { pathname: `/uz/market/${ID}` }));

test("the item page: title, summary, headings, facts and previews are in the HTML", () => {
  const html = page(view);
  assert.ok(html.includes("Amir Temur davri"));
  for (const t of ["Kirish", "Davlat boshqaruvi", "Xulosa"]) assert.ok(html.includes(t), t);
  assert.ok(html.includes("Mundarija"));
  assert.ok(html.includes(`/api/market/items/${ID}/preview/1?v=2`), "the cover raster");
  assert.ok(html.includes(`/api/market/items/${ID}/preview/3?v=2`), "a stub");
});

test("the item page: no body sentence", () => {
  const html = page(view);
  for (const s of SECRET) assert.ok(!html.includes(s), s);
  for (const w of ["faqat xaridor", "batafsil bayon", "sir qiymat"]) assert.ok(!html.includes(w), w);
});

test("the page never holds a body field, whatever a server object brought along", () => {
  // A future server bug must not surface through the page: it reads only the fields of the contract.
  const dirty = { ...view, doc, sections: doc.sections, slides: [{ title: SECRET[0] }] } as MarketItemView;
  const html = page(dirty);
  for (const s of SECRET) assert.ok(!html.includes(s), s);
});

test("dark: the page holds nothing of an item", () => {
  const html = page(null, false);
  assert.ok(html.includes("Bozor tez orada ochiladi"));
  assert.ok(!html.includes("/api/market/items/"));
  const withView = page(view, false);
  assert.ok(!withView.includes("Amir Temur davri"), "even if a view reached it");
});

test("the catalog: card fields only, nothing of a body; dark holds no card", () => {
  const initial = list([card("a", { title: "Amir Temur davri", summary: view.summary })]);
  const html = renderToString(withRouter(h(MarketCatalog, { enabled: true, initial })));
  assert.ok(html.includes("Amir Temur davri"));
  assert.ok(html.includes("/api/market/items/a/preview/1?v=2"));
  for (const s of SECRET) assert.ok(!html.includes(s), s);
  const dark = renderToString(withRouter(h(MarketCatalog, { enabled: false, initial: null })));
  assert.ok(dark.includes("Bozor tez orada ochiladi"));
  assert.ok(!dark.includes("data-market-card"));
});

test("the page modules read the public view only: never a document, never a neutral file", () => {
  for (const f of ["app/uz/market/[id]/page.tsx", "app/uz/market/page.tsx", "components/market/MarketItemPage.tsx", "components/market/PreviewGallery.tsx", "components/market/MarketCard.tsx"]) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    for (const banned of ["getItemDoc", "doc_json", "getNeutralFile", "SlideCanvas", "WordViewer"]) assert.ok(!src.includes(banned), `${f}: ${banned}`);
  }
});
