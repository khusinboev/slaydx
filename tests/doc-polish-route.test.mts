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
