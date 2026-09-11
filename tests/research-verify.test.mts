import test from "node:test";
import assert from "node:assert/strict";
import { citationOrder, citedOnly, verifyCitations, verifyCitationsInText, referenceIndex } from "../lib/generation/research/verify.ts";
import type { Reference } from "../lib/generation/article/types.ts";
import type { DocSection } from "../lib/generation/types.ts";

/**
 * Iqtibos tekshiruvi (Maqola 2, WP1): reyestrda yo'q id O'CHIRILADI,
 * jumla saqlanadi; bor id `cited:true`; ro'yxatga faqat cited.
 */

const REFS: Reference[] = [
  { id: "W2741809807", doi: "10.1186/s40561-023-00260-y", title: "A", authors: [], verified: "openalex", cited: false },
  { id: "W4385000001", title: "B", authors: [], verified: "openalex", cited: false },
  { id: "u1", title: "C", authors: [], verified: "user", cited: false },
];

const sec = (id: string, ...texts: string[]): DocSection => ({ id, title: id, blocks: texts.map((text) => ({ kind: "p" as const, text })) });

test("verifyCitations: bor id qoladi va cited bo'ladi; yo'q id o'chadi, jumla saqlanadi; unresolved yoziladi", () => {
  const sections = [
    sec("intro", "Adaptiv tizimlar rivojlandi [W2741809807]. Boshqa da'vo [W9999999999]. Uchinchi gap qoladi."),
    sec("results", "Mahalliy ishlarda [u1] va [W4385000001; 25-b.] ko‘rsatilgan."),
  ];
  const v = verifyCitations(sections, REFS);
  assert.equal(v.sections[0].blocks[0].text, "Adaptiv tizimlar rivojlandi [W2741809807]. Boshqa da'vo. Uchinchi gap qoladi.");
  assert.equal(v.sections[1].blocks[0].text, "Mahalliy ishlarda [u1] va [W4385000001; 25-b.] ko‘rsatilgan.");
  assert.deepEqual(v.refs.map((r) => r.cited), [true, true, true]);
  assert.deepEqual(v.unresolved.map((u) => [u.sectionId, u.id]), [["intro", "W9999999999"]]);
  assert.equal(v.removed, 1);
  assert.equal(v.kept, 3);
  // Kirish o'zgarmagan (immutable).
  assert.match(sections[0].blocks[0].text, /W9999999999/);
  assert.equal(REFS[0].cited, false);
});

test("guruh ichida aralash: yo'q id tushadi, borlari va lokator qoladi; hammasi yo'q bo'lsa butun guruh o'chadi", () => {
  const index = referenceIndex(REFS);
  assert.equal(verifyCitationsInText("Gap [W2741809807; W1; 12-b.].", index), "Gap [W2741809807; 12-b.].");
  assert.equal(verifyCitationsInText("Gap [W1, W2].", index), "Gap.");
  assert.equal(verifyCitationsInText("Gap [W1; 25-b.] davom.", index), "Gap davom.", "lokator yolg'iz qolmaydi");
  // Sof raqamli [3] — eski uslub, reyestrda yo'q → o'chadi.
  assert.equal(verifyCitationsInText("Gap [3] davom [12].", index), "Gap davom.");
  // Iqtibos bo'lmagan qavs tegilmaydi.
  assert.equal(verifyCitationsInText("Matn [sic] va [kerakli izoh].", index), "Matn [sic] va [kerakli izoh].");
  // DOI orqali ham topiladi; registr farqi yo'q.
  assert.equal(verifyCitationsInText("Gap [doi:10.1186/S40561-023-00260-Y] va [w4385000001].", index), "Gap [W2741809807] va [W4385000001].");
  // Takror id bitta guruhda birlashadi.
  assert.equal(verifyCitationsInText("Gap [u1; u1].", index), "Gap [u1].");
});

test("citedOnly: faqat matnda iqtibos qilinganlar ro'yxatga kiradi", () => {
  const v = verifyCitations([sec("s", "Faqat [u1].")], REFS);
  assert.deepEqual(citedOnly(v.refs).map((r) => r.id), ["u1"]);
  assert.deepEqual(citedOnly(REFS), [], "cited:false — ro'yxat bo'sh");
});

test("citationOrder: birinchi uchrash tartibi, takrorsiz; figure/tableRef sarlavhalari ham tekshiriladi, formula emas", () => {
  const sections: DocSection[] = [
    { id: "a", title: "A", blocks: [{ kind: "p", text: "x [u1] y [W4385000001]" }, { kind: "figure", text: "Sxema [W2741809807]", figureId: "f1" }, { kind: "formula", text: "\\sum [W4385000001]" }] },
    { id: "b", title: "B", blocks: [{ kind: "li", text: "[u1] yana" }] },
  ];
  assert.deepEqual(citationOrder(sections, REFS), ["u1", "W4385000001", "W2741809807"]);
  const v = verifyCitations(sections, REFS);
  assert.equal(v.sections[0].blocks[2].text, "\\sum [W4385000001]", "formula matniga tegilmaydi");
});
