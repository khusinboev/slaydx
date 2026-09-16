import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { DocReview } from "../lib/generation/report/types.ts";

/**
 * O'QITUVCHI HUJJATI: «Hammasini tuzatish» va bandma-band «Tuzatish»
 * SERVER yo'li (AUDIT-20 WP-D) — `article-polish-route` naqshi.
 *
 * LLM stub + bazasiz DB stub. Qulflanadigan QARORLAR:
 *   • `POLISHERS.teacher` — hisobot `doc.teacher.review` dan, sayqal
 *     op lari ADAPTER tiliga o'giriladi (`teacherOpsFromPolish`), aks
 *     holda `commitDocOps` ularni qayta qo'llay olmasdi;
 *   • bandma-band «Tuzatish» o'qituvchi hujjatida ISHLAYDI (ilgari
 *     route faqat maqolani qabul qilardi) va hisobotni qayta hisoblaydi;
 *   • KREDIT yechilmaydi (tahrir bepul — mahsulot egasi qarori);
 *   • yozuv BITTA tranzaksiyada, `baseVersion` SQL predikatida.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { polishGeneration, polishableAdapters } = await import("../lib/server/doc-polish.ts");
const { rewriteArticle } = await import("../lib/server/article-rewrite.ts");
const { sampleTeacherDoc } = await import("../lib/generation/teacher/samples.ts");
const { reviewTeacher } = await import("../lib/generation/teacher/review.ts");
const { sampleGameDoc } = await import("../lib/generation/games/samples.ts");
const { reviewCrossword } = await import("../lib/generation/games/crossword/review.ts");
const { reviewFlashcards } = await import("../lib/generation/games/flashcards/review.ts");
const { reviewInfographic } = await import("../lib/generation/infographic/review.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000021";
const USER = "u-21";
const NOW = new Date("2026-09-16T10:00:00.000Z");

type Call = { role: string; user: string };

const clone = (d: AcademicDoc): AcademicDoc => JSON.parse(JSON.stringify(d)) as AcademicDoc;

function mapDoc(): AcademicDoc {
  return clone(sampleTeacherDoc("map"));
}

function lessonDoc(): AcademicDoc {
  return clone(sampleTeacherDoc("lesson"));
}

/**
 * LLM stub. Baholovchi BALLI `judge` bilan; jadval qayta yozish
 * qator/ustun sonini SAQLAYDI, bo'lim qayta yozish bitta paragraf.
 */
function stub(o: { judge?: number | number[] } = {}) {
  const calls: Call[] = [];
  let judgeN = 0;
  const complete = (async (role: string, _system: string, user: string) => {
    calls.push({ role, user });
    const usage = { provider: "stub", model: "stub", inputTokens: 1, outputTokens: 1 };
    if (role === "judge") {
      const list = Array.isArray(o.judge) ? o.judge : [o.judge ?? 3];
      const v = list[Math.min(judgeN++, list.length - 1)];
      return {
        text: JSON.stringify({
          topicProgression: v, methodDiversity: v, controlFit: v, subjectCoherence: v,
          topicAlignment: v, timeRealism: v, pedagogicalVariety: v, ageFit: v, homeworkRelevance: v,
          notes: [], fixes: [],
        }),
        usage,
      };
    }
    if (user.startsWith("Rewrite the table")) {
      const rows = Number(/EXACTLY (\d+) rows/.exec(user)?.[1] ?? 0);
      const cols = Number(/EXACTLY (\d+) cells/.exec(user)?.[1] ?? 6);
      return {
        text: JSON.stringify({
          rows: Array.from({ length: rows }, (_, i) =>
            Array.from({ length: cols }, (_, c) => (c === 0 ? String(i + 1) : c === 1 ? "2" : `Sayqallangan ${i}-${c}`)),
          ),
        }),
        usage,
      };
    }
    if (user.startsWith("Rewrite the section")) {
      return { text: JSON.stringify({ blocks: [{ kind: "p", text: "Sayqallangan bo'lim matni: o'quvchilar mavzu bo'yicha aniq mashq bajaradi." }] }), usage };
    }
    return { text: "{}", usage };
  }) as never;
  return { complete, calls };
}

/** Hisobot — haqiqiy qoidalar + baholovchi ballari. */
async function baseReview(d: AcademicDoc, j: number): Promise<DocReview> {
  const s = stub({ judge: j });
  return reviewTeacher(d, { complete: s.complete, deadline: Date.now() + 30_000, now: NOW, judge: true });
}

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

/* ══════════════════════════════ DB stub ══════════════════════════════ */

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

function editRow(d: AcademicDoc, toolId = "texnologik-xarita", over: Record<string, unknown> = {}) {
  return { doc_json: d, doc_version: 3, file_version: 3, image_redraws: 0, tool_id: toolId, file_name: "xarita.docx", topic: d.meta.topic, status: "COMPLETED", ...over };
}

function detailRow(d: AcademicDoc, toolId = "texnologik-xarita") {
  return {
    id: GEN, user_id: USER, tool_id: toolId, topic: d.meta.topic, status: "COMPLETED", price: "6000", format: "docx", progress: 100, step: "Tayyor",
    file_name: "xarita.docx", error: null, preview: null, delivered_json: null, created_at: NOW, started_at: NOW, finished_at: NOW, expires_at: null,
    doc_version: 4, file_version: 3, image_redraws: 0, edited_at: NOW, live_seq: 0, html: "<html></html>", doc_json: d, live_json_out: null,
  };
}

const written = (seen: Seen[]) => {
  const upd = seen.filter((x) => /UPDATE generations SET doc_json/.test(x.text));
  return { upd, doc: upd.length ? (JSON.parse(upd[0].params[2] as string) as AcademicDoc) : null };
};

/* ══════════════════════════════ «Hammasini tuzatish» ══════════════════════════════ */

test("POLISHERS reyestri: o'qituvchi hujjati sayqal qila oladi", () => {
  assert.ok(polishableAdapters().includes("teacher"), `sayqal adapterlari: ${polishableAdapters().join(", ")}`);
  // Mavjudlari o'zgarmagan.
  for (const id of ["article", "essay", "work"]) assert.ok(polishableAdapters().includes(id), `«${id}» yo'qoldi`);
});

test("polishGeneration (teacher) QABUL: jadval sayqallanadi, MODEL ergashadi, `review` opi BITTA yozuvda", async (t) => {
  const d = mapDoc();
  d.teacher!.review = await baseReview(d, 1);
  const seen = mockDb(t, { forEdit: editRow(d), updateDoc: { doc_version: 4 }, detail: detailRow(d) });
  const s = stub({ judge: 3 });
  const out = await polishGeneration(GEN, USER, 3, { complete: s.complete, now: NOW });

  assert.ok(s.calls.some((c) => c.role === "writer"), "yozuvchi chaqirilmadi");
  assert.equal(s.calls.filter((c) => c.role === "judge").length, 1, "baholovchi qayta baholashi kerak");
  assert.equal(out.polish.accepted, true, JSON.stringify(out.polish));
  assert.equal(out.ops[out.ops.length - 1].op, "review", "hisobot opi oxirida bo'lishi kerak");
  /*
   * Sayqal `setTable` beradi, adapter esa `cell` ni tushunadi —
   * `teacherOpsFromPolish` o'girmasi bo'lmasa `commitDocOps` op larni
   * qayta qo'llay olmasdi.
   */
  assert.ok(out.ops.some((o) => o.op === "cell"), `op turlari: ${out.ops.map((o) => o.op).join(", ")}`);

  const w = written(seen);
  assert.equal(w.upd.length, 1, "bitta yozuv kutilgan edi");
  assert.equal(w.upd[0].params[5], 3, "baseVersion SQL predikatiga tushmadi");
  assert.match(w.doc!.tables![0].rows[0][2], /Sayqallangan/, "jadval sayqaldan keyin o'zgarmadi");
  assert.match(
    w.doc!.teacher!.map!.quarters[0].weeks[0].topic,
    /Sayqallangan/,
    "MUTATSIYA: jadval sayqallandi, MODEL eski mavzuda qoldi — hisobot ikki manbadan chiqardi",
  );
  assert.equal(w.doc!.teacher!.review!.polish?.accepted, true, "sayqal jurnali bazaga yozilmadi");
  // KREDIT yechilmaydi.
  assert.equal(seen.filter((x) => /UPDATE users SET/.test(x.text)).length, 0, "sayqal uchun kredit yechildi");
});

test("polishGeneration (teacher): eski hujjat — 409 `legacy`; hisobotsiz — 422 `review`", async (t) => {
  const legacy = mapDoc();
  delete legacy.teacher;
  mockDb(t, { forEdit: editRow(legacy) });
  const e1 = await expectApiError(polishGeneration(GEN, USER, 3, { complete: stub().complete, now: NOW }), 409);
  assert.equal(e1.extra.code, "legacy");

  const noReview = mapDoc();
  mockDb(t, { forEdit: editRow(noReview) });
  const e2 = await expectApiError(polishGeneration(GEN, USER, 3, { complete: stub().complete, now: NOW }), 422);
  assert.equal(e2.extra.code, "review");
});

test("polishGeneration (teacher): versiya LLM dan OLDIN tekshiriladi — 409, model CHAQIRILMAYDI", async (t) => {
  const d = mapDoc();
  d.teacher!.review = await baseReview(d, 1);
  const seen = mockDb(t, { forEdit: editRow(d, "texnologik-xarita", { doc_version: 5 }) });
  const s = stub({ judge: 3 });
  const e = await expectApiError(polishGeneration(GEN, USER, 3, { complete: s.complete, now: NOW }), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(s.calls.length, 0, "MUTATSIYA: eskirgan tab LLM pulini yedi");
  assert.equal(written(seen).upd.length, 0);
});

/* ══════════════════════════════ bandma-band «Tuzatish» ══════════════════════════════ */

test("rewriteArticle (teacher): bo'lim qayta yoziladi, hisobot QAYTA hisoblanadi, kredit yechilmaydi", async (t) => {
  const d = lessonDoc();
  d.teacher!.review = await baseReview(d, 2);
  const before = d.teacher!.review.score;
  const seen = mockDb(t, { forEdit: editRow(d, "lesson-plan"), updateDoc: { doc_version: 4 }, detail: detailRow(d, "lesson-plan") });
  const s = stub({ judge: 3 });
  const out = await rewriteArticle(GEN, USER, 3, { op: "rewrite", target: "homework", instruction: "Uy vazifasini aniqlashtiring." }, { complete: s.complete, now: NOW });

  assert.equal(out.generation.id, GEN);
  assert.equal(out.ops[out.ops.length - 1].op, "review", "hisobot qayta hisoblanmadi");
  // Baholovchi QAYTA chaqirilmaydi — ballar avvalgi hisobotdan ko'chadi (narx/vaqt).
  assert.equal(s.calls.filter((c) => c.role === "judge").length, 0, "«Tuzatish» baholovchini chaqirdi");

  const w = written(seen);
  assert.equal(w.upd.length, 1);
  assert.match(w.doc!.sections.find((x) => x.id === "homework")!.blocks[0].text, /Sayqallangan bo'lim matni/);
  // NASR → MODEL: «Tuzatish» dan keyin ham model izchil.
  assert.match(w.doc!.teacher!.lesson!.homework, /Sayqallangan bo'lim matni/, "model eski uy vazifasida qoldi");
  assert.ok(typeof w.doc!.teacher!.review!.score === "number" && before >= 0);
  assert.equal(seen.filter((x) => /UPDATE users SET/.test(x.text)).length, 0, "«Tuzatish» uchun kredit yechildi");
});

test("rewriteArticle (teacher): JADVAL nishoni (`table:<n>`) — xaritada butun mazmun jadvalda", async (t) => {
  const d = mapDoc();
  d.teacher!.review = await baseReview(d, 2);
  const seen = mockDb(t, { forEdit: editRow(d), updateDoc: { doc_version: 4 }, detail: detailRow(d) });
  const s = stub({ judge: 3 });
  await rewriteArticle(GEN, USER, 3, { op: "rewrite", target: "table:0", instruction: "Mavzularni aniqlashtiring." }, { complete: s.complete, now: NOW });
  const w = written(seen);
  assert.match(w.doc!.tables![0].rows[0][2], /Sayqallangan/);
  assert.match(w.doc!.teacher!.map!.quarters[0].weeks[0].topic, /Sayqallangan/, "jadval «Tuzatish» i modelga ko'chmadi");
});

/* ══════════════════════════════ AUDIT-21 WP-D: o'yin va plakat ══════════════════════════════ */

/**
 * BOSMA O'YIN va PLAKAT — tahrir ADAPTERI yo'q oilalar.
 *
 * Qulflanadigan QARORLAR:
 *   • sayqal adapterga BOG'LIQ EMAS (`loadDocForPolish`): ilgari butun
 *     yo'l `loadDocForEdit` ga tayanardi va adaptersiz vosita 409
 *     `legacy` olardi — hisoboti bor hujjat sayqal qila olmasdi;
 *   • yozuv op lar bilan emas, HUJJATNING O'ZI bilan, va model bilan
 *     bo'lim BIRGA o'zgaradi (krossvordda `across`/`down`, kartada
 *     `cards`);
 *   • FAYL hujjat bilan BITTA tranzaksiyada: `file_version` har doim
 *     `doc_version` ga tenglashadi (bu oilalarda `POST …/rebuild`
 *     ishlamaydi), qabul qilinganda esa yangi bayt ham yoziladi;
 *   • plakat qayta chizilmasa hujjat HAM yozilmaydi (422 `render`);
 *   • plakatda bandma-band «Tuzatish» yo'q (422 `infographic`),
 *     o'yinda bor.
 */

const CW_JUDGE = { clueClarity: 3, wordGrade: 3, gridConnectedness: 3, answerAccuracy: 3, originality: 3 };
const FC_JUDGE = { termClarity: 3, definitionCompleteness: 3, languageLevel: 3, exampleRelevance: 3, memorability: 3 };
const IG_JUDGE = { topicClarity: 3, visualLogic: 3, headingConciseness: 3, ageFit: 3, honestyCheck: 3 };

/**
 * O'yin/plakat LLM stubi. Yozuvchi javobi HAR DOIM haqiqiy shakl
 * chegaralaridan o'tadi (ta'rif 10–150 belgi va javobni oshkor
 * qilmaydi, kartalar soni AYNAN o'sha, spetsifikatsiya blok soni va
 * id lari saqlangan) — aks holda `rewrite*` uni o'zi rad etardi va
 * test sayqalni emas, filtrni sinagan bo'lardi.
 */
function gameStub(o: { judge?: number } = {}) {
  const calls: Call[] = [];
  const complete = (async (role: string, _system: string, user: string) => {
    calls.push({ role, user });
    const usage = { provider: "stub", model: "stub", inputTokens: 1, outputTokens: 1 };
    const v = o.judge ?? 3;
    if (role === "judge") {
      const all = Object.fromEntries([...Object.keys(CW_JUDGE), ...Object.keys(FC_JUDGE), ...Object.keys(IG_JUDGE)].map((k) => [k, v]));
      return { text: JSON.stringify({ ...all, notes: [], fixes: [] }), usage };
    }
    if (user.startsWith("INSTRUCTION: ")) {
      // Krossvord: `— <id> · <javob> · <ta'rif>` qatorlaridan id lar.
      const ids = [...user.matchAll(/^— (\S+) · /gm)].map((m) => m[1]);
      return { text: JSON.stringify({ clues: ids.map((id) => ({ id, clue: `Sayqallangan aniq ta'rif — ${id} uchun qayta yozildi.` })) }), usage };
    }
    if (user.startsWith("Improve the flashcard set")) {
      const n = Number(/EXACTLY (\d+) cards/.exec(user)?.[1] ?? 0);
      return {
        text: JSON.stringify({ cards: Array.from({ length: n }, (_, i) => ({ front: `Sayqallangan atama ${i + 1}`, back: `Sayqallangan ta'rif ${i + 1}: tushuncha to'liq va aniq yoziladi.` })) }),
        usage,
      };
    }
    if (user.startsWith("Current poster specification:")) {
      const spec = JSON.parse(user.split("\n")[1]) as { blocks: { text: string }[] };
      return { text: JSON.stringify({ ...spec, blocks: spec.blocks.map((b) => ({ ...b, text: `Sayqallangan blok matni — qisqa va aniq.` })) }), usage };
    }
    return { text: "{}", usage };
  }) as never;
  return { complete, calls };
}

/** To'r bandlarini tinch qoldirib, BITTA ta'rifni chegaradan chiqaradi (`clueLength` sariq). */
function crosswordDoc(): AcademicDoc {
  const d = clone(sampleGameDoc("crossword"));
  d.game!.crossword!.words[0].clue = "qisqa";
  d.game!.crossword!.clues.across[0].text = "qisqa";
  return d;
}

const cardsDoc = (): AcademicDoc => clone(sampleGameDoc("flashcards"));

function posterDoc(): AcademicDoc {
  const spec = {
    title: "Suv aylanishi",
    type: "list" as const,
    // Blok matni ATAYLAB uzun: `textLength`/`noOverflow` bandlari qizaradi,
    // ya'ni sayqalda TUZATILADIGAN band bo'ladi (toza plakatda 422 `nothing`).
    blocks: [1, 2, 3, 4].map((n) => ({
      id: `b${n}`,
      icon: "bulb",
      heading: `Bosqich ${n}`,
      text: `${n}-bosqich ${"juda uzun bayon qilingan va bosma kartaga sig'maydigan matn bilan yozilgan chunki har bir jumla ortiqcha takrorlar bilan cho'zilgan ".repeat(3)}`,
    })),
    palette: "indigo" as const,
    size: "A4" as const,
    language: "uz",
  };
  return {
    meta: { toolId: "infographic", topic: spec.title, language: "uz", extra: "" },
    titlePage: false,
    toc: false,
    sections: [],
    images: [{ id: "poster", url: "data:image/png;base64,AAAA", alt: spec.title, w: 10, h: 14, mime: "image/png" }],
    infographic: { v: 1, spec },
  } as unknown as AcademicDoc;
}

/** Sayqal seami — `sharp`/`docx` chaqirilmaydi, lekin yozilgan BAYT tekshiriladi. */
const stubFile = (bytes: string, mime = "image/png") => {
  const calls: string[] = [];
  const fn = async (doc: AcademicDoc) => {
    calls.push(doc.infographic?.spec.blocks[0].text ?? doc.game?.crossword?.words[0].clue ?? doc.game?.cards?.cards[0].back ?? "");
    return {
      bytes: new TextEncoder().encode(bytes),
      mime,
      ...(doc.infographic ? { html: "<article>plakat</article>", doc: { ...doc, images: [{ id: "poster", url: "data:image/png;base64,BBBB", alt: "x", w: 10, h: 14, mime: "image/png" }] } } : {}),
    };
  };
  return { fn, calls };
};

const fileWrites = (seen: Seen[]) => seen.filter((x) => /INSERT INTO generation_files/.test(x.text));
const fileVersions = (seen: Seen[]) => seen.filter((x) => /UPDATE generations SET file_version/.test(x.text));

test("POLISHERS reyestri: o'yin va plakat ham sayqal qila oladi; ular TAHRIRLANMAYDI (adapter yo'q)", async () => {
  for (const id of ["game", "infographic"]) assert.ok(polishableAdapters().includes(id), `sayqal adapterlari: ${polishableAdapters().join(", ")}`);
  const { editableTools } = await import("../lib/server/edit-adapters.ts");
  for (const tool of ["crossword", "flashcards", "infographic"]) {
    assert.ok(!editableTools().includes(tool), `MUTATSIYA: «${tool}» tahrir adapteriga qo'shilgan — natija sahifasida «Tahrirlash» chiqib ketardi`);
  }
  const { polisherIdFor } = await import("../lib/server/doc-polish.ts");
  assert.equal(polisherIdFor("crossword"), "game");
  assert.equal(polisherIdFor("flashcards"), "game");
  assert.equal(polisherIdFor("infographic"), "infographic");
  assert.equal(polisherIdFor("article"), "article");
  assert.equal(polisherIdFor("slide"), "slide");
});

test("polishGeneration (krossvord) QABUL: ta'rif almashadi, MODEL va `across` bo'limi BIRGA, DOCX qayta yasaladi, fayl versiyasi tenglashadi", async (t) => {
  const d = crosswordDoc();
  d.game!.review = await reviewCrossword(d, { judge: false });
  const before = d.game!.review.score;
  const seen = mockDb(t, { forEdit: editRow(d, "crossword"), updateDoc: { doc_version: 4 }, detail: detailRow(d, "crossword") });
  const s = gameStub();
  const docx = stubFile("DOCX-BYTES", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const out = await polishGeneration(GEN, USER, 3, { complete: s.complete, now: NOW, rebuildFile: docx.fn });

  assert.equal(out.polish.accepted, true, JSON.stringify(out.polish));
  assert.ok(out.polish.after > before, `ball oshmadi: ${before} → ${out.polish.after}`);
  assert.equal(out.ops[out.ops.length - 1].op, "review", "hisobot opi yo'q");

  const w = written(seen);
  assert.equal(w.upd.length, 1, "bitta yozuv kutilgan edi");
  assert.equal(w.upd[0].params[5], 3, "baseVersion SQL predikatiga tushmadi");
  assert.match(w.doc!.game!.crossword!.words[0].clue, /Sayqallangan/, "model eski ta'rifda qoldi");
  assert.match(
    w.doc!.sections.find((x) => x.id === "across")!.blocks[0].text,
    /Sayqallangan/,
    "MUTATSIYA: model sayqallandi, `across` bo'limi eski ta'rifda qoldi — ko'ruvchi va hisobot ikki xil matn ko'rsatardi",
  );
  // TO'R DAXLSIZ — sayqal so'zga tegmaydi.
  assert.deepEqual(w.doc!.game!.crossword!.grid, d.game!.crossword!.grid, "sayqal to'rni o'zgartirdi");
  assert.deepEqual(w.doc!.game!.crossword!.words.map((x) => x.answer), d.game!.crossword!.words.map((x) => x.answer), "sayqal JAVOBNI o'zgartirdi");
  assert.equal(w.doc!.game!.review!.polish?.accepted, true, "sayqal jurnali bazaga yozilmadi");

  // Fayl: yangi DOCX + `file_version` yangi `doc_version` ga.
  assert.equal(docx.calls.length, 1, "DOCX qayta yasalmadi");
  assert.match(docx.calls[0], /Sayqallangan/, "DOCX ESKI hujjatdan yasaldi");
  assert.equal(fileWrites(seen).length, 1, "MUTATSIYA: fayl yozilmadi — tuzatilgan krossvordning DOCX i eski ta'riflar bilan qolardi");
  assert.equal(fileVersions(seen).length, 1, "MUTATSIYA: `file_version` ko'tarilmadi — sahifa abadiy «Fayl yangilanmoqda…» deb turardi");
  assert.equal(seen.filter((x) => /UPDATE users SET/.test(x.text)).length, 0, "sayqal uchun kredit yechildi");
});

test("polishGeneration (krossvord): toza hujjatda 422 `nothing`; modelsiz o'yin — 409 `legacy`", async (t) => {
  const clean = clone(sampleGameDoc("crossword"));
  clean.game!.review = await reviewCrossword(clean, { judge: false, complete: gameStub().complete, deadline: Date.now() + 30_000 });
  mockDb(t, { forEdit: editRow(clean, "crossword") });
  const e1 = await expectApiError(polishGeneration(GEN, USER, 3, { complete: gameStub().complete, now: NOW }), 422);
  assert.equal(e1.extra.code, "nothing", "to'r bandlari `manual` — ular sayqalga tushmasligi kerak");

  const legacy = crosswordDoc();
  delete legacy.game;
  mockDb(t, { forEdit: editRow(legacy, "crossword") });
  const e2 = await expectApiError(polishGeneration(GEN, USER, 3, { complete: gameStub().complete, now: NOW }), 409);
  assert.equal(e2.extra.code, "legacy");
});

test("polishGeneration (flesh kartalar) QABUL: MODEL va `cards` bo'limi izchil, karta soni saqlanadi", async (t) => {
  const d = cardsDoc();
  d.game!.review = await reviewFlashcards(d, { judge: false });
  const n = d.game!.cards!.cards.length;
  const seen = mockDb(t, { forEdit: editRow(d, "flashcards"), updateDoc: { doc_version: 4 }, detail: detailRow(d, "flashcards") });
  const s = gameStub();
  const docx = stubFile("DOCX-BYTES", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const out = await polishGeneration(GEN, USER, 3, { complete: s.complete, now: NOW, rebuildFile: docx.fn });

  assert.equal(out.polish.accepted, true, JSON.stringify(out.polish));
  const w = written(seen);
  assert.equal(w.doc!.game!.cards!.cards.length, n, "karta soni o'zgardi");
  assert.match(w.doc!.game!.cards!.cards[0].back, /Sayqallangan/, "model eski kartada qoldi");
  assert.match(
    w.doc!.sections.find((x) => x.id === "cards")!.blocks.map((b) => b.text ?? "").join(" "),
    /Sayqallangan/,
    "MUTATSIYA: model sayqallandi, `cards` bo'limi eski matnda qoldi",
  );
  assert.deepEqual(w.doc!.game!.cards!.cards.map((c) => c.id), d.game!.cards!.cards.map((c) => c.id), "barqaror id lar siljidi");
  assert.equal(fileWrites(seen).length, 1);
});

test("polishGeneration (infografika) QABUL: spetsifikatsiya almashadi, PNG QAYTA yoziladi, eskiz va html chizishdan keladi", async (t) => {
  const d = posterDoc();
  d.infographic!.review = await reviewInfographic(d, { judge: false, want: 4 });
  const seen = mockDb(t, { forEdit: editRow(d, "infographic"), updateDoc: { doc_version: 4 }, detail: detailRow(d, "infographic") });
  const s = gameStub();
  const png = stubFile("PNG-BYTES");
  const out = await polishGeneration(GEN, USER, 3, { complete: s.complete, now: NOW, rebuildFile: png.fn });

  assert.equal(out.polish.accepted, true, JSON.stringify(out.polish));
  const w = written(seen);
  assert.match(w.doc!.infographic!.spec.blocks[0].text, /Sayqallangan/, "spetsifikatsiya yozilmadi");
  assert.equal(png.calls.length, 1, "plakat qayta chizilmadi");
  assert.match(png.calls[0], /Sayqallangan/, "plakat ESKI spetsifikatsiyadan chizildi");
  // Eskiz VA fayl ikkalasi ham yangi chizishdan.
  assert.equal(w.doc!.images![0].url, "data:image/png;base64,BBBB", "MUTATSIYA: eskiz eski PNG da qoldi — ekranda eski plakat, faylda yangisi bo'lardi");
  assert.equal(w.upd[0].params[3], "<article>plakat</article>", "html dvigatel chizuvchisidan kelmadi");
  assert.equal(fileWrites(seen).length, 1, "yangi PNG bazaga yozilmadi");
  assert.equal(Buffer.from(fileWrites(seen)[0].params[4] as Buffer).toString(), "PNG-BYTES");
});

test("polishGeneration (infografika): qayta chizish yiqilsa 422 `render` va hujjat YOZILMAYDI", async (t) => {
  const d = posterDoc();
  d.infographic!.review = await reviewInfographic(d, { judge: false, want: 4 });
  const seen = mockDb(t, { forEdit: editRow(d, "infographic"), updateDoc: { doc_version: 4 }, detail: detailRow(d, "infographic") });
  const e = await expectApiError(
    polishGeneration(GEN, USER, 3, { complete: gameStub().complete, now: NOW, rebuildFile: async () => null }),
    422,
  );
  assert.equal(e.extra.code, "render");
  assert.equal(written(seen).upd.length, 0, "MUTATSIYA: plakat chizilmagan bo'lsa ham hujjat yozildi — ekranda yangi matn, faylda eski plakat qolardi");
});

test("rewriteArticle: o'yinda bandma-band «Tuzatish» ISHLAYDI (`clues`), plakatda 422 `infographic`", async (t) => {
  const d = crosswordDoc();
  d.game!.review = await reviewCrossword(d, { judge: false });
  const seen = mockDb(t, { forEdit: editRow(d, "crossword"), updateDoc: { doc_version: 4 }, detail: detailRow(d, "crossword") });
  const s = gameStub();
  const docx = stubFile("DOCX-BYTES", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const out = await rewriteArticle(
    GEN,
    USER,
    3,
    { op: "rewrite", target: "clues", instruction: "Ta'riflarni aniqlashtiring." },
    { complete: s.complete, now: NOW, rebuildFile: docx.fn },
  );
  assert.equal(out.generation.id, GEN);
  assert.equal(out.ops[out.ops.length - 1].op, "review", "hisobot qayta hisoblanmadi");
  // Baholovchi QAYTA chaqirilmaydi — ballar avvalgi hisobotdan (narx/vaqt).
  assert.equal(s.calls.filter((c) => c.role === "judge").length, 0, "«Tuzatish» baholovchini chaqirdi");
  const w = written(seen);
  assert.match(w.doc!.game!.crossword!.words[0].clue, /Sayqallangan/);
  assert.match(w.doc!.sections.find((x) => x.id === "across")!.blocks[0].text, /Sayqallangan/, "bo'lim model bilan birga o'zgarmadi");
  assert.equal(fileWrites(seen).length, 1, "«Tuzatish» dan keyin DOCX qayta yasalmadi");
  assert.equal(seen.filter((x) => /UPDATE users SET/.test(x.text)).length, 0, "«Tuzatish» uchun kredit yechildi");

  // To'r bandi (`grid`) — sayqal ham, «Tuzatish» ham tuzatolmaydi.
  mockDb(t, { forEdit: editRow(d, "crossword"), updateDoc: { doc_version: 4 }, detail: detailRow(d, "crossword") });
  await expectApiError(
    rewriteArticle(GEN, USER, 3, { op: "rewrite", target: "grid", instruction: "x" }, { complete: gameStub().complete, now: NOW, rebuildFile: docx.fn }),
    422,
  );

  // PLAKAT — bandma-band yo'l umuman yo'q.
  const p = posterDoc();
  p.infographic!.review = await reviewInfographic(p, { judge: false, want: 4 });
  const seen2 = mockDb(t, { forEdit: editRow(p, "infographic"), detail: detailRow(p, "infographic") });
  const e = await expectApiError(
    rewriteArticle(GEN, USER, 3, { op: "rewrite", target: "spec", instruction: "x" }, { complete: gameStub().complete, now: NOW }),
    422,
  );
  assert.equal(e.extra.code, "infographic");
  assert.equal(written(seen2).upd.length, 0);
});

test("rewriteArticle (teacher): eski hujjat — 409; yo'q bo'lim — 422", async (t) => {
  const legacy = lessonDoc();
  delete legacy.teacher;
  mockDb(t, { forEdit: editRow(legacy, "lesson-plan") });
  await expectApiError(
    rewriteArticle(GEN, USER, 3, { op: "rewrite", target: "homework", instruction: "x" }, { complete: stub().complete, now: NOW }),
    409,
  );

  const d = lessonDoc();
  mockDb(t, { forEdit: editRow(d, "lesson-plan") });
  await expectApiError(
    rewriteArticle(GEN, USER, 3, { op: "rewrite", target: "yo-q-bolim", instruction: "x" }, { complete: stub().complete, now: NOW }),
    422,
  );
});
