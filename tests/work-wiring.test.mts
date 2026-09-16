import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { workGateWords } from "../lib/generation/index.ts";
import { bodyWordCount, wordCount } from "../lib/generation/quality.ts";
import { targetWords } from "../lib/generation/quality.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * Talaba ishi hajm darvozasi (AUDIT-19): `workWordPlan.body` bilan — eski
 * `targetWords(targetPages)` referatni (12,5 bet paketda ≈2 000 so'z matn
 * byudjeti) «9 bet» deb yiqitardi (jonli sinov).
 */
test("workGateWords: doc.work bo'lsa reja tanasi (apparatura ayirilgan), 230×bet dan kichik; work yo'q → null", () => {
  const meta = { toolId: "referat", topic: "x", language: "uz", pagesLabel: "10-15", targetPages: 12.5 } as unknown as DocMeta;
  const doc = {
    meta,
    sections: [],
    tables: [],
    work: { v: 1, genre: "referat", kind: "informative", subject: "humanities", language: "uz", chapters: [], intro: { parts: {} }, references: [], figures: [], refsMin: 5 },
  } as unknown as AcademicDoc;
  const want = workGateWords(doc);
  assert.ok(want && want > 1200, `reja tanasi: ${want}`);
  assert.ok(want! < targetWords(12.5), `MUTATSIYA: apparatura ayirilmasa ${want} ≥ ${targetWords(12.5)}`);
  assert.equal(workGateWords({ ...doc, work: undefined } as AcademicDoc), null);
});

/*
 * Kurs ishi jonli sinovi: 24 manba (~600 so'z) va jadval `wordCount` ga
 * kirib, 2 400 so'zlik matn 3 200 so'zlik rejadan o'tib ketdi. Talaba
 * ishi darvozasi FAQAT matn (`p`/`li`/`quote`) bilan o'lchanadi.
 */
test("bodyWordCount: sarlavha, adabiyotlar, jadval va annotatsiya hisobga kirmaydi", () => {
  const doc = {
    meta: {},
    sections: [
      { id: "intro", title: "Kirish sarlavha uch so'z", blocks: [{ kind: "p", text: "bir ikki uch to'rt" }, { kind: "li", text: "besh olti" }, { kind: "quote", text: "yetti" }, { kind: "h2", text: "sarlavha ikki" }, { kind: "figure", text: "rasm nomi" }] },
    ],
    references: ["Muallif A. Kitob nomi. – Toshkent: Fan, 2020. – 120 b."],
    abstracts: [{ lang: "uz", text: "annotatsiya matni bu yerda" }],
    tables: [{ id: "t1", headers: ["a b", "c"], rows: [["d e f", "g"]] }],
  } as never;
  assert.equal(bodyWordCount(doc), 7);
  assert.ok(wordCount(doc) > 20, `MUTATSIYA: wordCount apparaturani sanaydi (${wordCount(doc)})`);
});

test("hajm darvozasi: talaba ishida bodyWordCount, maqolada wordCount (manba matni)", () => {
  const src = readFileSync(new URL("../lib/generation/index.ts", import.meta.url), "utf8");
  assert.match(src, /const got = academic\.work \? bodyWordCount\(academic\) : wordCount\(academic\);/);
});
