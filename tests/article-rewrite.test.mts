import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { ArticleReview } from "../lib/generation/article/types.ts";

/**
 * «Tuzatish» — `lib/server/article-rewrite.ts` (Maqola 2, AUDIT-17 WP7).
 *
 * LLM STUB (`complete` seami) + bazasiz DB stub (`resume-commit` naqshi).
 * Qulflanadi: nishon → op turi (`setSection`/`abstract`/`keywords`/
 * `highlights`), reyestrda yo'q iqtibos o'chishi, vizual bloklar
 * saqlanishi, bo'sh/kech javob → 422 (hujjat o'zgarmaydi), hisobot
 * qayta hisoblanishi (qoidalar yangi, baholovchi CHAQIRILMAYDI —
 * ballari eskisidan, izoh bilan), 409 LLM chaqiruvidan OLDIN, KREDIT
 * YECHILMASLIGI (kredit/tranzaksiya SQL i umuman yo'q).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { REWRITE_REVIEW_NOTE, judgeFromReview, keepVisuals, parseArticleFix, recomputeReview, rewriteArticle, rewriteArticleSection } = await import(
  "../lib/server/article-rewrite.ts"
);
const { sampleArticleDoc } = await import("../lib/generation/article/samples.ts");
const { applyArticleOps } = await import("../lib/generation/article/edit.ts");
const { JUDGE_CRITERIA } = await import("../lib/generation/article/review.ts");

type CompleteFn = NonNullable<Parameters<typeof rewriteArticleSection>[2]>["complete"] & object;
type Call = { role: string; system: string; user: string; opts: Record<string, unknown> };

const GEN = "a1b2c3d4-0000-4000-8000-000000000009";
const USER = "u-42";
const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article", targetPages: 5 } as unknown as DocMeta;

const NOW = new Date("2026-09-12T10:00:00.000Z");

/** Chuqur nusxa: `sampleArticleDoc` modeli (`keywords`, `figures`) namunaviy obyekt bilan ULASHILGAN — testlar bir-birini buzmasin. */
function doc(): AcademicDoc {
  return JSON.parse(JSON.stringify(sampleArticleDoc(META))) as AcademicDoc;
}

/** Avvalgi hisobot — baholovchi 3/3 hamma mezonda, bitta baholovchi tavsiyasi. */
function prevReview(): ArticleReview {
  return {
    score: 88,
    checks: [
      { id: "structure", level: "green", label: "Tuzilma" },
      ...JUDGE_CRITERIA.map((c) => ({ id: `judge:${c}`, level: "green" as const, label: c, detail: "3/3" })),
      { id: "judge:fix:1", level: "yellow", label: "Baholovchi tavsiyasi", detail: "discussion: Compare with sources", fix: { op: "rewrite", target: "discussion", instruction: "Compare with sources" } },
      { id: "judge:fix:2", level: "yellow", label: "Baholovchi tavsiyasi", detail: "intro: Sharpen the aim", fix: { op: "rewrite", target: "intro", instruction: "Sharpen the aim" } },
    ],
    judgeNotes: ["Xulosa natijadan oshadi"],
    verifiedShare: 1,
    recentShare: 1,
    builtAt: "2026-09-11T00:00:00.000Z",
  };
}

/** LLM stubi: rolni yozib, tayyor JSON qaytaradi. */
function stub(reply: (c: Call) => string | null): { complete: CompleteFn; calls: Call[] } {
  const calls: Call[] = [];
  const complete = (async (role: string, system: string, user: string, opts: Record<string, unknown> = {}) => {
    const c = { role, system, user, opts };
    calls.push(c);
    const text = reply(c);
    return text === null ? null : { text, usage: { provider: "stub", model: "stub", inputTokens: 1, outputTokens: 1 } };
  }) as unknown as CompleteFn;
  return { complete, calls };
}

const SECTION_JSON = JSON.stringify({
  blocks: [
    { kind: "p", text: "Adabiyotlar tahlili: intellektual o‘qitish tizimlari tez rivojlandi [W2741809807]. Uydirma manba [W99999] ham iqtibos qilinadi." },
    { kind: "p", text: "Mahalliy tadqiqotlar raqamli texnologiyalarni pedagogik jihatdan o‘rgangan [u1; 12-b.]. Tajriba 120 talaba bilan o‘tkazildi." },
  ],
});

const FIX = { op: "rewrite" as const, target: "litreview_methods", instruction: "Remove filler phrases and make every sentence carry a specific claim." };

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

/* ══════════════════════════════ fix parse ══════════════════════════════ */

test("parseArticleFix: hisobot shartnomasi qabul, boshqasi 400", () => {
  assert.deepEqual(parseArticleFix({ op: "rewrite", target: "intro", instruction: "  Sharpen   the aim " }), { op: "rewrite", target: "intro", instruction: "Sharpen the aim" });
  assert.equal(parseArticleFix({ op: "rewrite", target: "abstract:ru", instruction: "x" }).target, "abstract:ru");
  for (const bad of [null, [], { op: "delete", target: "intro", instruction: "x" }, { op: "rewrite", target: "", instruction: "x" }, { op: "rewrite", target: "a b", instruction: "x" }, { op: "rewrite", target: "intro", instruction: "" }, { op: "rewrite", target: "intro", instruction: "x".repeat(601) }]) {
    assert.throws(() => parseArticleFix(bad), (e: unknown) => e instanceof ApiError && e.status === 400, `qabul qilindi: ${JSON.stringify(bad)}`);
  }
});

/* ══════════════════════════════ bo'lim ══════════════════════════════ */

test("bo'lim nishoni → `setSection`: writer roli, ko'rsatma + joriy matn promptda, noma'lum iqtibos O'CHADI, vizual blok saqlanadi", async () => {
  const s = stub(() => SECTION_JSON);
  const ops = await rewriteArticleSection(doc(), FIX, { complete: s.complete, now: NOW });
  assert.equal(ops.length, 1);
  const op = ops[0];
  assert.equal(op.op, "setSection");
  if (op.op !== "setSection") return;
  assert.equal(op.sectionId, "litreview_methods");

  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].role, "writer", "yozuvchi roli emas");
  assert.match(s.calls[0].user, /EDITOR INSTRUCTION.*Remove filler phrases/);
  assert.match(s.calls[0].user, /CURRENT TEXT/);
  assert.match(s.calls[0].user, /Adabiyotlar tahlili shuni ko‘rsatadiki/, "joriy matn promptga kirmadi");
  assert.match(s.calls[0].user, /\[W2741809807\]/, "manbalar ro'yxati promptda yo'q");
  assert.equal(s.calls[0].opts.json, true);

  const texts = op.blocks.map((b) => b.text).join("\n");
  assert.ok(!texts.includes("W99999"), `reyestrda yo'q iqtibos qoldi: ${texts}`);
  assert.match(texts, /\[W2741809807\]/, "haqiqiy iqtibos yo'qoldi");
  assert.match(texts, /\[u1; 12-b\.\]/, "lokator yo'qoldi");
  // Eski bo'limda rasm bloki 1-indeksda edi — yangi matnda ham o'sha joyda.
  const fig = op.blocks[1];
  assert.equal(fig.kind, "figure");
  assert.equal(fig.kind === "figure" ? fig.figureId : "", "f1");
  assert.equal(op.blocks.length, 3);
});

test("keepVisuals: rasm/jadval/formula eski indeks bo'yicha, matn qisqa bo'lsa oxiriga", () => {
  const old: AcademicDoc["sections"][0]["blocks"] = [
    { kind: "p", text: "a" },
    { kind: "figure", text: "c", figureId: "f1" },
    { kind: "p", text: "b" },
    { kind: "tableRef", text: "t", tableId: "t1" },
    { kind: "formula", text: "x" },
  ];
  const out = keepVisuals(old, [{ kind: "p", text: "yangi" }]);
  assert.deepEqual(
    out.map((b) => b.kind),
    ["p", "figure", "tableRef", "formula"],
  );
  assert.deepEqual(keepVisuals([{ kind: "p", text: "a" }], [{ kind: "p", text: "b" }]), [{ kind: "p", text: "b" }]);
});

test("bo'sh/qisqa javob, javobsiz model, noma'lum bo'lim — 422, op yo'q", async () => {
  const empty = stub(() => JSON.stringify({ blocks: [{ kind: "p", text: "qisqa" }] }));
  const e1 = await expectApiError(rewriteArticleSection(doc(), FIX, { complete: empty.complete }), 422);
  assert.match(e1.message, /urinib/);
  const none = stub(() => null);
  await expectApiError(rewriteArticleSection(doc(), FIX, { complete: none.complete }), 422);
  const boom = stub(() => {
    throw new Error("tarmoq");
  });
  await expectApiError(rewriteArticleSection(doc(), FIX, { complete: boom.complete }), 422);
  const ok = stub(() => SECTION_JSON);
  await expectApiError(rewriteArticleSection(doc(), { ...FIX, target: "nonexistent" }, { complete: ok.complete }), 422);
  assert.equal(ok.calls.length, 0, "bo'lim yo'q bo'lsa LLM chaqirilmasligi kerak");
});

test("30 s timeout: model javob bermasa 422 «qayta urinib ko'ring» (deadline bilan)", async () => {
  const hang = { complete: (() => new Promise(() => {})) as unknown as CompleteFn };
  const t0 = Date.now();
  const e = await expectApiError(rewriteArticleSection(doc(), FIX, { complete: hang.complete, deadline: Date.now() + 80 }), 422);
  assert.match(e.message, /urinib/);
  assert.ok(Date.now() - t0 < 2000, "timeout ishlamadi");
});

test("eski maqola (`doc.article` yo'q) — 409 legacy, LLM chaqirilmaydi", async () => {
  const d = doc();
  delete d.article;
  const s = stub(() => SECTION_JSON);
  const e = await expectApiError(rewriteArticleSection(d, FIX, { complete: s.complete }), 409);
  assert.equal(e.extra.code, "legacy");
  assert.equal(s.calls.length, 0);
});

/* ══════════════════════════════ annotatsiya / kalit so'z / highlights ══════════════════════════════ */

test("`abstract:ru` → `abstract` opi (kalit so'zlar bor — qo'shilmaydi); yo'q tilda `keywords` ham", async () => {
  const s = stub(() => JSON.stringify({ text: "Новая аннотация. ".repeat(12), keywords: ["ии", "обучение", "вуз", "оценка", "успеваемость"] }));
  const ops = await rewriteArticleSection(doc(), { op: "rewrite", target: "abstract:ru", instruction: "Rewrite to 150–250 words." }, { complete: s.complete });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "abstract");
  assert.equal(ops[0].op === "abstract" ? ops[0].lang : "", "ru");
  assert.match(s.calls[0].system, /Russian|русск/i);
  assert.match(s.calls[0].user, /CURRENT ABSTRACT/);

  const d = doc();
  delete d.article!.keywords.ru;
  const ops2 = await rewriteArticleSection(d, { op: "rewrite", target: "abstract:ru", instruction: "x" }, { complete: s.complete });
  assert.deepEqual(
    ops2.map((o) => o.op),
    ["abstract", "keywords"],
  );
});

test("`keywords` → uch tilda `keywords` op (chegara ichida); `highlights` → `highlights` op (≤85 belgi)", async () => {
  const kw = stub(() => JSON.stringify({ uz: ["a", "b", "c", "d", "e", "f"], ru: ["а", "б", "в", "г", "д"], en: ["one", "two"] }));
  const ops = await rewriteArticleSection(doc(), { op: "rewrite", target: "keywords", instruction: "Provide 5–12 keywords." }, { complete: kw.complete });
  assert.deepEqual(
    ops.map((o) => (o.op === "keywords" ? o.lang : o.op)),
    ["uz", "ru"],
    "en 2 ta — profil minimumidan kam, tushishi kerak",
  );

  const hl = stub(() => JSON.stringify({ highlights: ["Adaptive learning raised the mean grade from 4.1 to 4.6 in a 120-student trial", "Second " + "long ".repeat(30), "Third result"] }));
  const d = JSON.parse(JSON.stringify(sampleArticleDoc({ ...META, language: "en" }, { type: "elsevier_ieee_style" }))) as AcademicDoc;
  const ops2 = await rewriteArticleSection(d, { op: "rewrite", target: "highlights", instruction: "Write 3–5 highlights." }, { complete: hl.complete });
  assert.equal(ops2[0].op, "highlights");
  if (ops2[0].op !== "highlights") return;
  assert.equal(ops2[0].items.length, 3);
  assert.ok(ops2[0].items.every((x) => x.length <= 85), ops2[0].items.join(" | "));
});

/* ══════════════════════════════ hisobot ══════════════════════════════ */

test("judgeFromReview: ballar `judge:*` bandlaridan, bajarilgan tavsiya chiqariladi; hisobotsiz → null", () => {
  const j = judgeFromReview(prevReview(), { op: "rewrite", target: "discussion", instruction: "Compare with sources" });
  assert.ok(j);
  assert.equal(j!.novelty, 3);
  assert.deepEqual(j!.fixes, [{ target: "intro", instruction: "Sharpen the aim" }]);
  assert.deepEqual(j!.notes, ["Xulosa natijadan oshadi"]);
  assert.equal(judgeFromReview(undefined), null);
  assert.equal(judgeFromReview({ ...prevReview(), checks: [] }), null);
});

test("recomputeReview: qoidalar yangi hujjatdan, baholovchi ballari eskisidan, izoh qo'shiladi, `judge` chaqirilmaydi", async () => {
  const d = doc();
  const changed = applyArticleOps(d, [{ op: "keywords", lang: "uz", items: ["bitta"] }], { genId: GEN });
  assert.ok(changed.ok);
  const r = await recomputeReview(changed.ok ? changed.doc : d, prevReview(), undefined, NOW);
  const kw = r.checks.find((c) => c.id === "keywords");
  assert.ok(kw && kw.level !== "green", "kalit so'z qoidasi yangi hujjatga qarab qayta hisoblanmadi");
  for (const c of JUDGE_CRITERIA) assert.equal(r.checks.find((x) => x.id === `judge:${c}`)?.detail, "3/3");
  assert.ok(r.judgeNotes.includes(REWRITE_REVIEW_NOTE), "izoh yo'q");
  assert.ok(r.judgeNotes.includes("Xulosa natijadan oshadi"), "eski izoh yo'qoldi");
  assert.ok(!r.judgeNotes.includes("Baholovchi javob bermadi"), "baholovchi chaqirilmagani xato sifatida ko'rsatildi");
  assert.equal(r.builtAt, NOW.toISOString());
  // Ballda baholovchi ulushi 40% × 18/18 — eskicha; qoidalar bo'yicha bitta sariq/qizil ko'proq.
  const base = await recomputeReview(d, prevReview(), undefined, NOW);
  assert.ok(r.score < base.score, `ball tushishi kerak edi: ${r.score} vs ${base.score}`);
});

/* ══════════════════════════════ to'liq oqim (DB stub) ══════════════════════════════ */

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
    // Hamyon so'rovi (kredit yechish MUTATSIYASI uchun): to'ldirilgan hamyon —
    // yechish "yo'l topilmadi" bilan emas, pastdagi «kredit SQL yo'q» assertion bilan qizarsin.
    else if (/FROM users/.test(q)) out = [{ points: "100000", quota: "0", balance: "0" }];
    return { rows: out, rowCount: out.length };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

function editRow(over: Record<string, unknown> = {}) {
  const d = doc();
  d.article!.review = prevReview();
  return { doc_json: d, doc_version: 3, file_version: 3, image_redraws: 0, tool_id: "article", file_name: "maqola.docx", topic: META.topic, status: "COMPLETED", ...over };
}

function detailRow() {
  return {
    id: GEN, user_id: USER, tool_id: "article", topic: META.topic, status: "COMPLETED", price: "8000", format: "docx", progress: 100, step: "Tayyor",
    file_name: "maqola.docx", error: null, preview: null, delivered_json: null, created_at: NOW, started_at: NOW, finished_at: NOW, expires_at: null,
    doc_version: 4, file_version: 3, image_redraws: 0, edited_at: NOW, live_seq: 0, html: "<html></html>", doc_json: doc(), live_json_out: null,
  };
}

test("rewriteArticle: op lar + qayta hisoblangan hisobot BITTA yozuvda; judge chaqirilmaydi; KREDIT YECHILMAYDI", async (t) => {
  const seen = mockDb(t, { forEdit: editRow(), updateDoc: { doc_version: 4 }, detail: detailRow() });
  const s = stub(() => SECTION_JSON);
  const out = await rewriteArticle(GEN, USER, 3, FIX, { complete: s.complete, now: NOW });

  assert.deepEqual(
    s.calls.map((c) => c.role),
    ["writer"],
    "faqat yozuvchi chaqirilishi kerak (baholovchi emas)",
  );
  assert.deepEqual(
    out.ops.map((o) => o.op),
    ["setSection", "review"],
  );
  assert.equal(out.generation.id, GEN);

  const upd = seen.filter((x) => /UPDATE generations SET doc_json/.test(x.text));
  assert.equal(upd.length, 1, "bitta yozuv kutilgan edi");
  assert.equal(upd[0].params[5], 3, "baseVersion SQL predikatiga tushmadi");
  const written = JSON.parse(upd[0].params[2] as string) as AcademicDoc;
  assert.match(written.sections[1].blocks[0].text, /^Adabiyotlar tahlili: intellektual/);
  assert.ok(!JSON.stringify(written.sections).includes("W99999"));
  assert.ok(written.article!.review, "hisobot yozilmadi");
  assert.ok(written.article!.review!.judgeNotes.includes(REWRITE_REVIEW_NOTE));
  assert.equal(written.article!.review!.builtAt, NOW.toISOString(), "hisobot qayta hisoblanmadi");
  assert.ok(written.article!.review!.checks.some((c) => c.id === "judge:novelty" && c.detail === "3/3"), "baholovchi ballari yo'qoldi");

  // Kredit/tranzaksiya jadvaliga BIRORTA so'rov yo'q — tahrir bepul.
  const money = seen.filter((x) => /credits|balance|transactions|chargeInTx|users SET/i.test(x.text));
  assert.equal(money.length, 0, `kredit SQL i ketdi: ${money.map((m) => m.text).join(" | ")}`);
});

test("rewriteArticle: baseVersion mos kelmasa — 409 LLM CHAQIRILMASDAN; eski maqola — 409 legacy", async (t) => {
  mockDb(t, { forEdit: editRow({ doc_version: 5 }) });
  const s = stub(() => SECTION_JSON);
  const e = await expectApiError(rewriteArticle(GEN, USER, 3, FIX, { complete: s.complete }), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(e.extra.docVersion, 5);
  assert.equal(s.calls.length, 0, "eskirgan versiya bilan LLM chaqirildi");

  t.mock.reset();
  const legacy = doc();
  delete legacy.article;
  mockDb(t, { forEdit: editRow({ doc_json: legacy }) });
  const e2 = await expectApiError(rewriteArticle(GEN, USER, 3, FIX, { complete: s.complete }), 409);
  assert.equal(e2.extra.code, "legacy");
});

test("rewriteArticle: model javob bermasa 422 va bazaga yozilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow(), updateDoc: { doc_version: 4 }, detail: detailRow() });
  const s = stub(() => null);
  await expectApiError(rewriteArticle(GEN, USER, 3, FIX, { complete: s.complete }), 422);
  assert.equal(seen.filter((x) => /UPDATE generations SET doc_json/.test(x.text)).length, 0);
});
