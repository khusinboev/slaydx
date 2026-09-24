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

/* ────────────── O'qituvchi dvigateli dispatchi (AUDIT-20 R0) ────────────── */

/**
 * R0 SUBSTRAT KAFOLATI: `teacher/engine.ts` hali STUB, shuning uchun
 * `writeWithLlm` beshala o'qituvchi vositasi uchun ESKI yo'lga
 * (`write-specials.ts`) qaytishi SHART. Aks holda shu kommitdan keyin
 * dars rejasi, texnologik xarita, glossariy va kalitlar — to'rttala
 * sotilayotgan xizmat — bo'sh hujjat qaytarardi.
 *
 * Mutatsiya (qizardi): stubga `throw new Error("teacher engine: WP-A")`
 * qo'yildi — birinchi test; dispatchdagi `if (built)` o'rniga
 * `if (!built) return null` yozildi — ikkinchi test.
 */
test("teacher dvigateli stub: `null` qaytaradi, xato TASHLAMAYDI", async () => {
  /*
   * GERMETIK (prod-readiness W4-A): ilgari bu test `.env.local` dagi
   * HAQIQIY kalit bilan dvigatelni chaqirardi — dvigatel endi stub emas,
   * ya'ni test pullik Gemini so'rovini yuborardi (va to'liq hujjat olib
   * yiqilardi). Endi model har so'rovni rad etadi (400), kalit soxta,
   * `LLM_*` rollari olib tashlanadi: «model javob bermadi → `null`» sinaladi.
   */
  const keys = ["GEMINI_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "LLM_WRITER", "LLM_RESEARCHER", "LLM_JUDGE", "LLM_FAST"];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  for (const k of keys) delete process.env[k];
  process.env.GEMINI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "stub" } }), { status: 400 });
  }) as typeof fetch;
  try {
    const { buildTeacherDoc } = await import("../lib/generation/teacher/engine.ts");
    const meta = { toolId: "lesson-plan", topic: "Fotosintez", language: "uz" } as unknown as DocMeta;
    const built = await buildTeacherDoc(meta, { topic: "Fotosintez" }, { deadline: Date.now() + 300_000 });
    assert.equal(built, null, "stub null qaytarmasa, chaqiruvchi eski yo'lni tanlay olmaydi");
    assert.ok(calls > 0, "model (stub) haqiqatan so'ralgan");
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("write-llm: teacher shoxi `null` da eski `write-specials.ts` yo'liga TUSHADI", () => {
  const src = readFileSync(new URL("../lib/generation/write-llm.ts", import.meta.url), "utf8");
  // Shox bor va bayroq bilan o'chadi (X-6: eski yo'l bir sprint qoladi).
  assert.match(src, /TEACHER_TOOLS\.has\(meta\.toolId\) && process\.env\.TEACHER_ENGINE !== "0"/);
  // Natija BO'LSAGINA qaytadi — `if (!built) return null` bo'lsa eski yo'l o'lardi.
  const branch = src.slice(src.indexOf("TEACHER_TOOLS.has(meta.toolId)"));
  const body = branch.slice(0, branch.indexOf("\n  if (WRITER.has"));
  // Qavsli ham, bir qatorli ham bo'lishi mumkin — MUHIMI shart `built` da.
  assert.match(body, /if \(built\)\s*(\{|return built\.doc;)/);
  assert.ok(!/if \(!built\) return null;/.test(body), "MUTATSIYA: teacher shoxi eski yo'lni kesib tashladi");
  // To'rtta eski shox O'Z O'RNIDA (WP-A ko'chirgunga qadar).
  for (const call of ["writeLessonWithLlm", "writeGlossaryWithLlm", "writeKeysWithLlm", "writeMapWithLlm"]) {
    assert.ok(src.includes(`return ${call}(meta, deadline)`), `eski shox yo'qoldi: ${call}`);
  }
});
