import test from "node:test";
import assert from "node:assert/strict";
import { workGateWords } from "../lib/generation/index.ts";
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
