import test from "node:test";
import assert from "node:assert/strict";
import {
  BODY_FLOOR,
  WORK_OVERHEAD,
  WORK_WORDS_PER_PAGE,
  chapterWords,
  estimateWorkDocPages,
  estimateWorkPages,
  paragraphWords,
  workOverheadPages,
  workVisualNumbers,
  workWordPlan,
} from "../lib/generation/work/plan.ts";
import { pagesMid, workKindOf } from "../lib/generation/work/registry.ts";
import { SUBJECT_PROFILES } from "../lib/generation/work/subjects.ts";
import { workBudgetMs } from "../lib/generation/budget.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * SO'Z VA BET REJASI (AUDIT-19 WP-A). Dvigatel, hisobot va forma bitta
 * formuladan o'qiydi — standart raqamlari (kirish 10–15 %, xulosa 2–4
 * bet, apparatura) shu yerda qulflanadi.
 */

const meta = (pages: string): DocMeta => ({ pagesLabel: pages, targetPages: pagesMid(pages) }) as DocMeta;

const coursework = workKindOf("coursework", "theory");
const referat = workKindOf("referat", "informative");
const independent = workKindOf("independent", "written");
const humanities = SUBJECT_PROFILES.humanities;

test("apparatura: titul 1 + mundarija 1 + adabiyot 0.05 × N + sxema 0.45 + jadval 0.25 + ilova", () => {
  assert.equal(workOverheadPages({ refs: 0, figures: 0, tables: 0, appendices: 0 }), 2);
  assert.equal(workOverheadPages({ refs: 20, figures: 0, tables: 0, appendices: 0 }), 3);
  assert.equal(workOverheadPages({ refs: 0, figures: 2, tables: 2, appendices: 1 }), 2 + 0.9 + 0.5 + 1);
  assert.equal(WORK_OVERHEAD.refLine, 0.05);
  assert.equal(WORK_WORDS_PER_PAGE, 230);
  // Manfiy qiymat apparaturani kamaytirmaydi.
  assert.equal(workOverheadPages({ refs: -5, figures: -1, tables: 0, appendices: 0 }), 2);
});

test("kurs ishi 25–30 bet: kirish 10–15 %, xulosa 2–4 bet, umumiy so'z hajmi mo'ljalda", () => {
  const p = workWordPlan(meta("25-30"), coursework, humanities, { refs: 15, figures: 1, tables: 1 });
  assert.equal(p.pages, 28);
  const introShare = p.introPages / p.pages;
  assert.ok(introShare >= 0.1 && introShare <= 0.15, `kirish ulushi ${introShare}`);
  assert.ok(p.conclusionPages >= 2 && p.conclusionPages <= 4, `xulosa ${p.conclusionPages} bet`);
  // Apparatura: 2 + 0.75 + 0.45 + 0.25 = 3.45 bet → matn ≈ 24.5 bet ≈ 5 600 so'z.
  assert.ok(Math.abs(p.overheadPages - 3.45) < 0.01, `apparatura ${p.overheadPages}`);
  assert.ok(p.body > 5200 && p.body < 6000, `hajm ${p.body} so'z`);
  assert.equal(p.intro + p.conclusion + p.chapters, p.body);
  // Boblar kirish va xulosadan ancha katta.
  assert.ok(p.chapters > (p.intro + p.conclusion) * 2, "boblar asosiy hajmni oladi");
});

test("referat 10–15 bet: xulosa ≈1 bet, apparatura kichik (ilova/annotatsiya yo'q)", () => {
  const p = workWordPlan(meta("10-15"), referat, humanities, { refs: 5, figures: 0, tables: 0 });
  assert.equal(p.pages, 13);
  assert.ok(p.conclusionPages >= 0.8 && p.conclusionPages <= 1.3, `xulosa ${p.conclusionPages} bet`);
  const introShare = p.introPages / p.pages;
  assert.ok(introShare >= 0.1 && introShare <= 0.15, `kirish ulushi ${introShare}`);
  assert.equal(p.overheadPages, 2.25);
  // Referat kurs ishidan ANCHA qisqa.
  const cw = workWordPlan(meta("25-30"), coursework, humanities, { refs: 15, figures: 1, tables: 1 });
  assert.ok(p.body < cw.body / 2, `referat ${p.body} vs kurs ishi ${cw.body}`);
});

test("mustaqil ish 10–15 bet: xulosa 1–2 bet, manba 8 ta", () => {
  const p = workWordPlan(meta("10-15"), independent, humanities, { refs: independent.refsMin, figures: 1, tables: 1 });
  assert.ok(p.conclusionPages >= 1 && p.conclusionPages <= 2, `xulosa ${p.conclusionPages}`);
  assert.equal(p.refs, 8);
});

test("apparatura katta bo'lsa ham matn paketning 40 % idan pastga tushmaydi", () => {
  // 10 bet, 40 manba, 6 sxema, 6 jadval → apparatura 2 + 2 + 2.7 + 1.5 = 8.2 bet.
  const p = workWordPlan(meta("10-15"), coursework, humanities, { refs: 40, figures: 6, tables: 6 });
  assert.ok(p.overheadPages > 8);
  const contentPages = p.introPages + p.conclusionPages + p.chapterPages;
  assert.ok(contentPages >= p.pages * BODY_FLOOR - 0.01, `matn beti ${contentPages} < ${p.pages * BODY_FLOOR}`);
});

test("estimateWorkPages: paket UMUMIY bet — apparatura matndan olinadi, sig'masa hujjat oshadi", () => {
  const base = estimateWorkPages("25-30", coursework, humanities, { refs: 15, figures: 1, tables: 1 });
  assert.ok(base >= 25 && base <= 31, `taxminiy bet ${base}`);
  /*
   * Katta paketda apparatura (40 manba + 6 sxema + 6 jadval ≈ 8,2 bet)
   * MATN hisobidan qoplanadi — hujjat baribir paket ichida qoladi.
   * Bu maqoladagi «3–5 bet OAK → 6 bet» holatining aksi: talaba ishida
   * paket katta, apparatura esa kichik.
   */
  assert.equal(estimateWorkPages("25-30", coursework, humanities, { refs: 40, figures: 6, tables: 6 }), base);
  // Kichik paketda esa apparatura poli (40 %) ishlaydi va hujjat paketdan OSHADI.
  const small = estimateWorkPages("10-15", coursework, humanities, { refs: 40, figures: 6, tables: 6, appendices: 3 });
  assert.ok(small > pagesMid("10-15"), `10–15 bet + katta apparatura → ${small} bet`);
  assert.ok(estimateWorkPages("10-15", referat, humanities, { refs: 5, figures: 0, tables: 0 }) >= 10);
});

test("so'z taqsimoti: boblar teng, paragraflar teng, pastki chegara bor", () => {
  assert.deepEqual(chapterWords(3000, 3), [1000, 1000, 1000]);
  assert.deepEqual(chapterWords(10, 2), [200, 200], "pastki chegara 200 so'z");
  assert.deepEqual(paragraphWords(900, 3), [300, 300, 300]);
  assert.deepEqual(paragraphWords(100, 3), [120, 120, 120], "pastki chegara 120 so'z");
  assert.deepEqual(paragraphWords(500, 0), [500], "0 paragraf — kamida bitta");
});

test("estimateWorkDocPages: tayyor hujjatning beti matn + apparaturadan", () => {
  const doc = {
    meta: meta("25-30"),
    titlePage: true,
    toc: true,
    sections: [
      { id: "intro", title: "Kirish", blocks: [{ kind: "p", text: "so'z ".repeat(460).trim() }] },
      { id: "ch1", title: "Bob", blocks: [] },
      { id: "ch1.1", title: "Paragraf", blocks: [{ kind: "p", text: "so'z ".repeat(920).trim() }] },
    ],
    tables: [{ id: "t1", headers: ["a", "b"], rows: [["1", "2"]] }],
    work: {
      v: 1,
      genre: "coursework",
      kind: "theory",
      subject: "humanities",
      language: "uz",
      university: "",
      faculty: "",
      department: "",
      subjectName: "",
      group: "",
      course: "",
      author: "",
      teacher: "",
      city: "",
      ministry: "oliy",
      chapters: [],
      intro: { parts: {} },
      references: Array.from({ length: 10 }, (_, i) => ({ id: `W${i}`, title: "t", authors: [], verified: "openalex", cited: true })),
      figures: [],
      refsMin: 15,
    },
  } as unknown as AcademicDoc;
  // 1380 so'z ≈ 6 bet + apparatura (2 + 0.5 + 0.25) = 8.75.
  const est = estimateWorkDocPages(doc);
  assert.ok(Math.abs(est - (1380 / 230 + 2.75)) < 0.01, `bet ${est}`);
});

test("workVisualNumbers: raqam BOB bo'yicha (1.1, 1.2, 2.1); bobdan tashqarisi tekis", () => {
  const doc = {
    sections: [
      { id: "intro", title: "Kirish", blocks: [{ kind: "figure", text: "Sxema", figureId: "f0" }] },
      { id: "ch1", title: "Bob 1", blocks: [] },
      { id: "ch1.1", title: "1.1", blocks: [{ kind: "figure", text: "A", figureId: "f1" }, { kind: "tableRef", text: "J", tableId: "t1" }] },
      { id: "ch1.2", title: "1.2", blocks: [{ kind: "figure", text: "B", figureId: "f2" }] },
      { id: "ch2", title: "Bob 2", blocks: [] },
      { id: "ch2.1", title: "2.1", blocks: [{ kind: "tableRef", text: "J2", tableId: "t2" }] },
    ],
  } as unknown as AcademicDoc;
  const n = workVisualNumbers(doc);
  assert.deepEqual(n.figures, { f0: "1", f1: "1.1", f2: "1.2" });
  assert.deepEqual(n.tables, { t1: "1.1", t2: "2.1" });
});

test("workBudgetMs: 45 bet worker timeoutiga (660 s) sig'adi, 10 bet ancha kichik", () => {
  assert.equal(workBudgetMs(28), 150_000 + 90_000 + 28 * 9_000);
  assert.ok(workBudgetMs(45) <= 660_000, `45 bet: ${workBudgetMs(45)} ms`);
  assert.ok(workBudgetMs(13) < workBudgetMs(28));
  assert.ok(workBudgetMs(NaN) >= 150_000);
});

/*
 * WP-C ochiq bandi: referatda maket tekis («1-jadval») berar, hisobot esa
 * bob shaklini («1.1») o'qirdi. Endi `workVisualNumbers` turning shaklini
 * O'ZI biladi — DOCX/ko'ruvchi/hisobot bitta hisob. Mutatsiya: `flat`
 * shartini olib tashlasangiz referat «1.2» qaytaradi → test yiqiladi.
 */
test("workVisualNumbers: referat (bo'limlar) — tekis, kurs ishi — bob bo'yicha", async () => {
  const { workVisualNumbers } = await import("../lib/generation/work/plan.ts");
  const sections = [
    { id: "intro", title: "Kirish", blocks: [] },
    { id: "ch1", title: "1", blocks: [] },
    { id: "ch1.1", title: "1.1", blocks: [{ kind: "p", text: "x" }] },
    { id: "ch1.2", title: "1.2", blocks: [{ kind: "figure", text: "s", figureId: "f1" }, { kind: "tableRef", text: "t", tableId: "t1" }] },
    { id: "ch2", title: "2", blocks: [] },
    { id: "ch2.1", title: "2.1", blocks: [{ kind: "figure", text: "s", figureId: "f2" }] },
  ];
  const referat = { sections, work: { genre: "referat", kind: "informative" } } as never;
  const coursework = { sections, work: { genre: "coursework", kind: "theory" } } as never;
  assert.deepEqual(workVisualNumbers(referat), { figures: { f1: "1", f2: "2" }, tables: { t1: "1" } });
  assert.deepEqual(workVisualNumbers(coursework), { figures: { f1: "1.1", f2: "2.1" }, tables: { t1: "1.1" } });
});
