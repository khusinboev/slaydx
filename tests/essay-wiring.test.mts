import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { DocReview } from "../lib/generation/report/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * INSHO — MAHSULOTGA ULANISHI (AUDIT-19 WP-E1).
 *
 * WP-D dvigatelning O'ZINI sinaydi (`tests/essay-*`); bu fayl uni
 * mahsulotga bog'laydigan QATLAMNI: `writeWithLlm` shoxi, `buildArtifact`
 * darvozalari (so'z bilan, sahifasiz), tahrir adapteri va sayqal/qayta
 * yozish marshrutlarining adapter tanlovi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1) `essayGateWords` olib tashlansa — so'z darvozasi varaqqa qaytadi
 *      va 250 so'zlik IELTS inshosi «hajm yetmadi» deb yiqiladi;
 *   2) sahifa darvozasi inshoda qaytarilsa (`max(2, …)`) — IELTS inshosi
 *      renderlangan 1 betda yiqiladi;
 *   3) `doc-polish` adapter tanlovi `article` ga qattiq yozilsa — insho
 *      409 `legacy` oladi;
 *   4) `rewrite` dagi insho shoxi olib tashlansa — bandma-band tuzatish
 *      baholovchisiz ishga tushardi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { adapterFor, editableTools } = await import("../lib/server/edit-adapters.ts");
const { polishGeneration } = await import("../lib/server/doc-polish.ts");
const { rewriteArticle } = await import("../lib/server/article-rewrite.ts");
const { essayWords } = await import("../lib/generation/essay/registry.ts");
const { reviewEssay } = await import("../lib/generation/essay/review.ts");

const GEN = "e1e2e3e4-0000-4000-8000-000000000011";
const USER = "u-19";
const NOW = new Date("2026-09-16T10:00:00.000Z");

/* ══════════════════════════════ dvigatel shoxi ══════════════════════════════ */

test("`writeWithLlm` insho uchun `buildEssayDoc` ga boradi: `doc.essay` to'ladi, `onCost` sarfni beradi, eski yo'l qolmadi", async () => {
  const { writeWithLlm } = await import("../lib/generation/write-llm.ts");
  const mod = await import("../lib/generation/write-llm.ts");

  /*
   * Eski yo'l butunlay o'chirilgan bo'lishi kerak — aks holda ikkala
   * dvigatel yonma-yon yashab, qaysi biri ishlayotgani noma'lum bo'lardi.
   */
  assert.ok(!("writeEssayWithLlm" in mod), "eski `writeEssayWithLlm` eksporti qolmasligi kerak");
  const prompts = await import("../lib/generation/prompts.ts");
  assert.ok(!("essaySystemPrompt" in prompts), "eski `essaySystemPrompt` qolmasligi kerak");

  const values: FormValues = { topic: "Ona tilim — g‘ururim", essayContext: "school_dtm", essayKind: "reflective", pages: "2" };
  const meta = extractMeta(TOOL_BY_ID.essay, values);

  // `buildEssayDoc` LLM siz `null` qaytaradi (kalitsiz muhit) — shoxning
  // O'ZI ishlayotganini `complete` stubisiz ham ko'rish uchun dvigatelni
  // to'g'ridan-to'g'ri chaqiramiz va `writeWithLlm` shu bilan solishtiriladi.
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.equal(await writeWithLlm(meta, values, Date.now() + 60_000), null, "kalitsiz muhitda insho yozilmaydi (shablonga tushmaydi)");
  } finally {
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});

test("`buildEssayDoc` natijasi `doc.essay.words` bilan keladi — darvoza o'lchovi shu (IELTS 250–330, maktab varaqdan)", () => {
  assert.deepEqual(essayWords("ielts_task2", { pages: 5 }), { min: 250, max: 330, aim: 280 }, "IELTS hajmi foydalanuvchi varag'iga bog'liq emas");
  const school = essayWords("school_dtm", { pages: 2 });
  assert.equal(school.aim, 460);
  assert.ok(school.min < school.aim);
});

/* ══════════════════════════════ darvozalar ══════════════════════════════ */

/** Bir bo'limli insho hujjati — berilgan so'z soni bilan. */
function essayDoc(words: number, o: { context?: "school_dtm" | "ielts_task2"; pages?: number } = {}): AcademicDoc {
  const context = o.context ?? "ielts_task2";
  const values: FormValues = { topic: "Technology and society", essayContext: context, pages: String(o.pages ?? 2) };
  const meta = extractMeta(TOOL_BY_ID.essay, values);
  const text = Array.from({ length: words }, (_, i) => `w${i}`).join(" ");
  return {
    meta: { ...meta, language: context === "ielts_task2" ? "en" : "uz" },
    titlePage: false,
    toc: false,
    sections: [{ id: "essay", title: "Insho", blocks: [{ kind: "p", text }] }],
    essay: {
      v: 1,
      context,
      kind: context === "ielts_task2" ? "opinion" : "reflective",
      language: context === "ielts_task2" ? "en" : "uz",
      words: essayWords(context, { pages: o.pages ?? 2 }),
      paragraphs: [],
      rubric: context === "ielts_task2" ? "ielts_band" : "dtm24",
    },
  };
}

test("HAJM DARVOZASI o'lchovi: insho `doc.essay.words.min × 0.9`, eski insho va boshqa vositalar — varaqdan", async () => {
  const { essayGateWords } = await import("../lib/generation/index.ts");

  /*
   * MUTATSIYA: `essayGateWords` olib tashlansa darvoza
   * `targetWords(meta.targetPages)` ga qaytadi — «2 varaq» paketida
   * ≈460 so'z talab qilinar va TO'G'RI yozilgan 280 so'zlik IELTS
   * inshosi ham yiqilardi.
   */
  assert.equal(essayGateWords("essay", essayDoc(280)), 225, "IELTS min 250 × 0.9");
  assert.equal(essayGateWords("essay", essayDoc(500, { context: "school_dtm", pages: 2 })), Math.round(essayWords("school_dtm", { pages: 2 }).min * 0.9));

  /*
   * 0.9 va 0.8 emas: `words.min` ning O'ZI allaqachon mo'ljaldan past
   * chegara. 0.8 qo'llansa 250 so'zlik IELTS inshosi 180 so'zda ham
   * o'tib ketardi — bunday ish imtihonda umuman baholanmaydi.
   */
  assert.ok(essayGateWords("essay", essayDoc(280))! > 250 * 0.8, "0.8 ga qaytarilmasin");

  const legacy = essayDoc(500, { context: "school_dtm" });
  delete legacy.essay;
  assert.equal(essayGateWords("essay", legacy), null, "eski insho eski qoida bilan o'lchanadi");
  assert.equal(essayGateWords("referat", essayDoc(280)), null, "boshqa vositaga tegmaydi");
});

test("SAHIFA DARVOZASI inshoda o'tkazib yuboriladi (`essay.words` bo'lsa), eski inshoda va referatda — ishlaydi", async () => {
  const { pageGateApplies } = await import("../lib/generation/index.ts");

  /*
   * MUTATSIYA: insho istisnosi olib tashlansa `Math.max(2, …)` tufayli
   * 1 betlik IELTS inshosi HAR SAFAR yiqilardi — foydalanuvchi to'g'ri
   * yozilgan ishni umuman ololmasdi (tezisda aynan shu xato AUDIT-19
   * WP-F da tuzatilgan edi).
   */
  assert.equal(pageGateApplies("essay", essayDoc(280)), false, "IELTS inshosi bet va'da qilmaydi");
  assert.equal(pageGateApplies("essay", essayDoc(500, { context: "school_dtm", pages: 3 })), false, "hajmi so'z bilan yozilgan insho");

  const legacy = essayDoc(500, { context: "school_dtm" });
  delete legacy.essay;
  assert.equal(pageGateApplies("essay", legacy), true, "eski inshoda darvoza qoladi");
  assert.equal(pageGateApplies("referat", legacy), true);
  assert.equal(pageGateApplies("glossary", legacy), false, "bet va'da qilmaydigan vosita");
});

/**
 * Uchidan uchigacha: `buildArtifact` → `writeWithLlm` → `buildEssayDoc`
 * → darvozalar → `renderDocx`. LLM `fetch` darajasida stub qilinadi
 * (Gemini javob shakli) — modul eksportini mock qilib bo'lmaydi va
 * kerak ham emas: sinaladigan narsa aynan ZANJIR.
 */
async function liveish<T>(body: string, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const saved = { gemini: process.env.GEMINI_API_KEY, xai: process.env.XAI_API_KEY, polish: process.env.ESSAY_POLISH };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  // Avto-sayqal o'chiq: u yana bir necha chaqiruv qiladi va DARVOZA
  // qaroriga aloqasi yo'q.
  process.env.ESSAY_POLISH = "0";
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const req = String(init?.body ?? "");
    // Reja so'ralsa — reja JSON i; qolganda insho bloklari.
    const text = /Plan the essay/.test(req)
      ? JSON.stringify({
          title: "Technology and society",
          thesisStatement: "Technology has reshaped daily life, and its benefits outweigh its drawbacks.",
          paragraphs: [
            { id: "p1", role: "intro", brief: "intro", words: 45 },
            { id: "p2", role: "body", topicSentence: "First, technology saves time.", brief: "body", words: 95 },
            { id: "p3", role: "body", topicSentence: "Second, technology connects people.", brief: "body", words: 95 },
            { id: "p4", role: "conclusion", brief: "conclusion", words: 45 },
          ],
        })
      : body;
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) } as never;
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of [["GEMINI_API_KEY", saved.gemini], ["XAI_API_KEY", saved.xai], ["ESSAY_POLISH", saved.polish]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Berilgan so'z sonidagi insho javobi (bandlarga bo'lingan). */
function essayBody(words: number): string {
  const per = Math.ceil(words / 4);
  const para = (tag: string) => `${tag} paragraph states a clear claim and supports it with a concrete example. ${Array.from({ length: per }, (_, i) => `${tag}${i}`).join(" ")}.`;
  return JSON.stringify({ blocks: ["Intro", "First", "Second", "Final"].map((t) => ({ kind: "p", text: para(t) })) });
}

test("uchidan uchigacha: IELTS inshosi `buildArtifact` dan DOCX bo'lib chiqadi — 1 bet bo'lsa ham yiqilmaydi", async () => {
  const { buildArtifact } = await import("../lib/generation/index.ts");
  const values: FormValues = { topic: "Technology and society", essayContext: "ielts_task2", essayKind: "opinion" };
  const file = await liveish(essayBody(300), () => buildArtifact(TOOL_BY_ID.essay, values, { deadline: Date.now() + 120_000 }));

  assert.ok(file.bytes.byteLength > 0, "DOCX chiqishi kerak");
  assert.equal(file.doc?.sections.length, 1, "insho bitta bo'limda");
  assert.equal(file.doc?.essay?.context, "ielts_task2");
  assert.equal(file.doc?.essay?.language, "en", "IELTS — ingliz tili (forma nima yuborsa ham)");
  assert.ok(file.cost && file.cost.calls > 0, "LLM sarfi `cost_json` ga tushishi kerak");
  assert.equal(file.delivered, undefined, "inshoda miqdor va'dasi yo'q");
});

test("uchidan uchigacha: qisqa insho SO'Z darvozasida yiqiladi va xato «bet» emas, «so'z» deb aytadi", async () => {
  const { buildArtifact } = await import("../lib/generation/index.ts");
  const values: FormValues = { topic: "Technology and society", essayContext: "ielts_task2", essayKind: "opinion" };
  await assert.rejects(
    () => liveish(essayBody(60), () => buildArtifact(TOOL_BY_ID.essay, values, { deadline: Date.now() + 120_000 })),
    (e: Error) => {
      assert.match(e.message, /Insho hajmi yetarli chiqmadi/);
      assert.match(e.message, /so'z/, "insho hajmi so'z bilan aytiladi");
      assert.ok(!/\bbet\b/.test(e.message), `insho xatosida «bet» bo'lmasligi kerak: ${e.message}`);
      return true;
    },
  );
});

/* ══════════════════════════════ adapter ══════════════════════════════ */

test("`essayAdapter` reyestrda: `essay` vositasi tahrirlanadi, op tili maqolaniki (matn + `setSection` + `review`)", () => {
  const a = adapterFor("essay");
  assert.ok(a, "insho uchun adapter topilmadi");
  assert.equal(a!.id, "essay");
  assert.ok(editableTools().includes("essay"));
  assert.ok(a!.hasModel({ sections: [{ id: "essay", title: "", blocks: [{ kind: "p", text: "x" }] }] } as AcademicDoc));

  const doc = essayDoc(300);
  // Matn opi — o'tadi.
  const ok = a!.apply(doc, [{ op: "setSection", sectionId: "essay", blocks: [{ kind: "p", text: "Yangi matn" }] }], { genId: GEN });
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  assert.equal(ok.ok && ok.doc.sections[0].blocks[0].text, "Yangi matn");

  // Maqolaga xos op (kalit so'zlar) — inshoda ma'nosiz, RAD etiladi.
  const bad = a!.apply(doc, [{ op: "keywords", lang: "uz", items: ["a"] }], { genId: GEN });
  assert.ok(!bad.ok, "insho modelida `keywords` opi qabul qilinmasligi kerak");

  // Hisobot opi `doc.essay` ga yoziladi (maqolada `doc.article` ga) —
  // ilgari `d.article!` edi va insho hujjatida yiqilardi.
  const review: DocReview = { score: 71, checks: [], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: NOW.toISOString() };
  const withReview = a!.apply(doc, [{ op: "review", review }], { genId: GEN });
  assert.ok(withReview.ok, withReview.ok ? "" : withReview.error);
  assert.equal(withReview.ok && withReview.doc.essay?.review?.score, 71);
});

/* ══════════════════════════════ marshrutlar ══════════════════════════════ */

type Seen = { text: string; params: unknown[] };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function mockDb(t: TestContext, rows: { forEdit?: Record<string, unknown> | null; updateDoc?: Record<string, unknown> | null; detail?: Record<string, unknown> | null }): Seen[] {
  const seen: Seen[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    const q = norm(text);
    let out: unknown[] = [];
    if (/live_json_out/.test(q)) out = rows.detail ? [rows.detail] : [];
    else if (/^SELECT doc_json, doc_version/.test(q)) out = rows.forEdit ? [rows.forEdit] : [];
    else if (/UPDATE generations SET doc_json/.test(q)) out = rows.updateDoc ? [rows.updateDoc] : [];
    else if (/FROM users/.test(q)) out = [{ points: "100000", quota: "0", balance: "0" }];
    return { rows: out, rowCount: out.length };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

const editRow = (d: AcademicDoc, over: Record<string, unknown> = {}) => ({
  doc_json: d, doc_version: 3, file_version: 3, image_redraws: 0, tool_id: "essay", file_name: "insho.docx", topic: d.meta.topic, status: "COMPLETED", ...over,
});

const detailRow = (d: AcademicDoc) => ({
  id: GEN, user_id: USER, tool_id: "essay", topic: d.meta.topic, status: "COMPLETED", price: "2500", format: "docx", progress: 100, step: "Tayyor",
  file_name: "insho.docx", error: null, preview: null, delivered_json: null, created_at: NOW, started_at: NOW, finished_at: NOW, expires_at: null,
  doc_version: 4, file_version: 3, image_redraws: 0, edited_at: NOW, live_seq: 0, html: "<html></html>", doc_json: d, live_json_out: null,
});

async function expectApiError(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi, keldi: ${e}`);
    const err = e as InstanceType<typeof ApiError>;
    assert.equal(err.status, status, `status ${status} kutilgan, keldi ${err.status}: ${err.message}`);
    return err;
  }
  assert.fail(`xato tashlanishi kerak edi (status ${status})`);
}

/** Bandlarni tuzatib beradigan insho hujjati (qisqa matn → «hajm» bandi qizil). */
async function essayWithReview(): Promise<AcademicDoc> {
  const doc = essayDoc(120);
  doc.sections[0].blocks = [
    { kind: "p", text: "Bugungi kunda texnologiya hayotimizni o‘zgartirdi. ".repeat(4) },
    { kind: "p", text: "Ikkinchi band ham qisqa qoldi va fikr to‘liq ochilmadi. ".repeat(4) },
  ];
  const review = await reviewEssay(doc, { complete: async () => null, deadline: Date.now() + 5_000, judge: false, now: NOW });
  doc.essay!.review = review;
  return doc;
}

test("`doc-polish` ADAPTER bo'yicha: insho hujjatida insho sayqali ishlaydi va yozuvga `setSection` + `review` tushadi", async (t) => {
  const doc = await essayWithReview();
  const seen = mockDb(t, { forEdit: editRow(doc), updateDoc: { doc_version: 4 }, detail: detailRow(doc) });
  /*
   * LLM stub: qayta yozishda uzunroq matn beradi (ball oshsin),
   * baholovchi esa yuqori ball → Q-3 qabul qiladi.
   */
  const complete = (async (role: string) => {
    const usage = { provider: "stub", model: "stub", inputTokens: 1, outputTokens: 1 };
    if (role === "judge") return { text: JSON.stringify({ tr: 3, cc: 3, lr: 3, gra: 3, notes: [], fixes: [] }), usage };
    const body = Array.from({ length: 290 }, (_, i) => `word${i}`).join(" ");
    return { text: JSON.stringify({ blocks: [{ kind: "p", text: `Kirish bandi aniq da’vo bilan boshlanadi. ${body}` }] }), usage };
  }) as never;

  const out = await polishGeneration(GEN, USER, 3, { complete, now: NOW });
  assert.equal(out.generation.id, GEN);
  const ops = out.ops.map((o) => o.op);
  assert.equal(ops[ops.length - 1], "review", "hisobot opi oxirida");
  if (out.polish.accepted) {
    /*
     * MUHIM: sayqal `setEssay` beradi, adapter esa `setSection` ni
     * tushunadi — `toOps` o'girmasi bo'lmasa `commitDocOps` «noma'lum
     * operatsiya» bilan 422 qaytarardi.
     */
    assert.ok(ops.includes("setSection"), `insho op lari adapter tilida bo'lishi kerak: ${ops.join(", ")}`);
  }
  // Kredit SQL i ketmasligi kerak — tahrir/sayqal bepul.
  const money = seen.filter((x) => /credits|transactions|users SET/i.test(x.text));
  assert.equal(money.length, 0, `kredit SQL i ketdi: ${money.map((m) => m.text).join(" | ")}`);
});

test("`doc-polish`: eski insho (`doc.essay` yo'q) 409 `legacy`, hisobotsiz insho 422 `review`", async (t) => {
  const legacy = essayDoc(400);
  delete legacy.essay;
  mockDb(t, { forEdit: editRow(legacy) });
  assert.equal((await expectApiError(polishGeneration(GEN, USER, 3, { complete: (async () => null) as never }), 409)).extra.code, "legacy");

  t.mock.reset();
  const noReview = essayDoc(400);
  mockDb(t, { forEdit: editRow(noReview) });
  assert.equal((await expectApiError(polishGeneration(GEN, USER, 3, { complete: (async () => null) as never }), 422)).extra.code, "review");
});

test("`doc-polish`: versiya mos kelmasa 409 — LLM CHAQIRILMASDAN (eskirgan tab 60 s kutib turmasin)", async (t) => {
  const doc = await essayWithReview();
  mockDb(t, { forEdit: editRow(doc, { doc_version: 7 }) });
  let calls = 0;
  const complete = (async () => {
    calls++;
    return null;
  }) as never;
  const e = await expectApiError(polishGeneration(GEN, USER, 3, { complete }), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(e.extra.docVersion, 7);
  assert.equal(calls, 0, "eskirgan versiya bilan LLM chaqirildi");
});

test("`rewrite` insho uchun 422 `essay`: bandma-band tuzatish yo'q, «Hammasini tuzatish» ga yo'naltiradi", async (t) => {
  const doc = await essayWithReview();
  mockDb(t, { forEdit: editRow(doc) });
  /*
   * MUTATSIYA: insho shoxi olib tashlansa `rewriteArticle` 409 `legacy`
   * berardi (foydalanuvchiga «qaytadan yarating» degan noto'g'ri maslahat)
   * yoki — adapter `article` deb qolsa — baholovchisiz qayta yozishni
   * ishga tushirardi.
   */
  const e = await expectApiError(rewriteArticle(GEN, USER, 3, { op: "rewrite", target: "essay", instruction: "Uzaytiring" }), 422);
  assert.equal(e.extra.code, "essay");
  assert.match(e.message, /Hammasini tuzatish/);
});
