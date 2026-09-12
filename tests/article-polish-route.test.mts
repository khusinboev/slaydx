import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { ArticleReview, ReviewCheck } from "../lib/generation/article/types.ts";

/**
 * «Hammasini tuzatish» — `lib/server/article-polish.ts` (Maqola 3, AUDIT-18 WP-A).
 *
 * LLM stub + bazasiz DB stub (`article-rewrite` naqshi). Qulflanadi:
 * 409 versiya LLM dan OLDIN, 409 legacy, 422 hisobot yo'q / tuzatiladigan
 * band yo'q / model javobsiz (yozuv yo'q), qabul → op lar + `review` opi
 * BITTA yozuvda (jurnal `accepted:true`), rad → FAQAT `review` opi (eski
 * matn, jurnal `accepted:false`), KREDIT SQL yo'q, baholovchi chaqiriladi.
 * UDK: `parseUdk` shakl tekshiruvi.
 *
 * Mutatsiyalar (har biri qizardi): rad etilganda ham op lar yozildi —
 * «faqat review opi» testi; `review` opi tashlab qo'yildi — «jurnal
 * bazada» testi; versiya tekshiruvi LLM dan keyinga ko'chdi — «LLM
 * chaqirilmadi» testi; `parseUdk` shakl tekshiruvi olib tashlandi —
 * «uydirma UDK» testi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { polishArticle } = await import("../lib/server/article-polish.ts");
const { sampleArticleDoc } = await import("../lib/generation/article/samples.ts");
const { JUDGE_CRITERIA, reviewArticle } = await import("../lib/generation/article/review.ts");
const { UDK_NOTE, parseUdk, udkSystemPrompt, udkUserPrompt } = await import("../lib/generation/article/udk.ts");

type CompleteFn = NonNullable<Parameters<typeof polishArticle>[3]>["complete"] & object;
type Call = { role: string; user: string };

const GEN = "a1b2c3d4-0000-4000-8000-000000000009";
const USER = "u-42";
const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article", targetPages: 4, figureCount: 1 } as unknown as DocMeta;
const NOW = new Date("2026-09-12T10:00:00.000Z");

function doc(): AcademicDoc {
  return structuredClone(sampleArticleDoc(META));
}

/** LLM stub: bo'lim → tayyor JSON; baholovchi → `judge` ball (null = javobsiz). */
function stub(o: { judge?: number | null; sectionFail?: boolean } = {}) {
  const calls: Call[] = [];
  const complete = (async (role: string, _system: string, user: string) => {
    calls.push({ role, user });
    const usage = { provider: "stub", model: "stub", inputTokens: 1, outputTokens: 1 };
    if (role === "judge") {
      if (o.judge === null) return null;
      const j = o.judge ?? 3;
      return { text: JSON.stringify({ novelty: j, chain: j, methods: j, comparison: j, overclaim: j, style: j, notes: [], fixes: [] }), usage };
    }
    if (o.sectionFail) return null;
    if (user.startsWith("Write the section")) {
      const id = user.match(/\(id ([\w:-]+)\)/)?.[1] ?? "";
      return { text: JSON.stringify({ blocks: [{ kind: "p", text: `Sayqallangan «${id}»: aniq da’vo va manba [W2741809807]. Tadqiqot cheklovlari: tanlanma bitta universitet bilan chegaralangan; 1-rasm va 1-jadval shuni ko‘rsatadi.` }] }), usage };
    }
    if (user.startsWith("Write the abstract")) return { text: JSON.stringify({ text: "Yangi annotatsiya. ".repeat(40), keywords: ["a", "b", "c", "d", "e"] }), usage };
    return { text: "{}", usage };
  }) as unknown as CompleteFn;
  return { complete, calls };
}

/** Boshlang'ich hisobot: haqiqiy qoidalar + baholovchi `j` + kirishga xavfsiz tavsiya. */
async function baseReview(d: AcademicDoc, j: number): Promise<ArticleReview> {
  const s = stub({ judge: j });
  const r = await reviewArticle(d, { complete: s.complete, deadline: Date.now() + 30_000, now: NOW, wordTarget: 400 });
  const fix: ReviewCheck = { id: "judge:fix:1", level: "yellow", label: "Baholovchi tavsiyasi", detail: "intro: Kirishda maqsadni aniq yozing", fix: { op: "rewrite", target: "intro", instruction: "Kirishda maqsadni aniq yozing" } };
  return { ...r, checks: [...r.checks, fix] };
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

function editRow(d: AcademicDoc, over: Record<string, unknown> = {}) {
  return { doc_json: d, doc_version: 3, file_version: 3, image_redraws: 0, tool_id: "article", file_name: "maqola.docx", topic: META.topic, status: "COMPLETED", ...over };
}

function detailRow(d: AcademicDoc) {
  return {
    id: GEN, user_id: USER, tool_id: "article", topic: META.topic, status: "COMPLETED", price: "8000", format: "docx", progress: 100, step: "Tayyor",
    file_name: "maqola.docx", error: null, preview: null, delivered_json: null, created_at: NOW, started_at: NOW, finished_at: NOW, expires_at: null,
    doc_version: 4, file_version: 3, image_redraws: 0, edited_at: NOW, live_seq: 0, html: "<html></html>", doc_json: d, live_json_out: null,
  };
}

const written = (seen: Seen[]) => {
  const upd = seen.filter((x) => /UPDATE generations SET doc_json/.test(x.text));
  return { upd, doc: upd.length ? (JSON.parse(upd[0].params[2] as string) as AcademicDoc) : null };
};

/* ══════════════════════════════ testlar ══════════════════════════════ */

test("polishArticle QABUL: writer + judge chaqiriladi, op lar + `review` opi BITTA yozuvda, jurnal accepted:true, KREDIT SQL yo'q", async (t) => {
  const d = doc();
  d.article!.review = await baseReview(d, 1);
  const seen = mockDb(t, { forEdit: editRow(d), updateDoc: { doc_version: 4 }, detail: detailRow(d) });
  const s = stub({ judge: 3 });
  const out = await polishArticle(GEN, USER, 3, { complete: s.complete, now: NOW });

  assert.ok(s.calls.some((c) => c.role === "writer"), "yozuvchi chaqirilmadi");
  assert.equal(s.calls.filter((c) => c.role === "judge").length, 1, "baholovchi (Claude) qayta baholashi kerak");
  assert.equal(out.generation.id, GEN);
  assert.equal(out.polish.accepted, true, JSON.stringify(out.polish));
  assert.ok(out.polish.after > out.polish.before);
  assert.equal(out.ops[out.ops.length - 1].op, "review");
  assert.ok(out.ops.some((o) => o.op === "setSection" && o.sectionId === "intro"));

  const w = written(seen);
  assert.equal(w.upd.length, 1, "bitta yozuv kutilgan edi");
  assert.equal(w.upd[0].params[5], 3, "baseVersion SQL predikatiga tushmadi");
  assert.match(w.doc!.sections[0].blocks[0].text, /^Sayqallangan «intro»/);
  const rv = w.doc!.article!.review!;
  assert.equal(rv.polish?.accepted, true, "jurnal bazaga yozilmadi");
  assert.equal(rv.score, out.polish.after);
  assert.ok(Array.isArray(rv.userNeeds));
  assert.equal(rv.checks.find((c) => c.id === "judge:novelty")?.detail, "3/3");

  const money = seen.filter((x) => /credits|balance|transactions|chargeInTx|users SET/i.test(x.text));
  assert.equal(money.length, 0, `kredit SQL i ketdi: ${money.map((m) => m.text).join(" | ")}`);
});

test("polishArticle RAD (Q-3): ball oshmasa FAQAT `review` opi yoziladi — eski matn bazada, jurnal accepted:false", async (t) => {
  const d = doc();
  d.article!.review = await baseReview(d, 2);
  const before = d.article!.review!.score;
  const seen = mockDb(t, { forEdit: editRow(d), updateDoc: { doc_version: 4 }, detail: detailRow(d) });
  const s = stub({ judge: 0 });
  const out = await polishArticle(GEN, USER, 3, { complete: s.complete, now: NOW });
  assert.equal(out.polish.accepted, false);
  assert.deepEqual(
    out.ops.map((o) => o.op),
    ["review"],
    "rad etilganda faqat hisobot opi",
  );
  const w = written(seen);
  assert.equal(w.upd.length, 1);
  assert.match(w.doc!.sections[0].blocks[0].text, /^Oliy ta’limda/, "eski matn o'zgardi");
  const rv = w.doc!.article!.review!;
  assert.equal(rv.score, before, "eski ball qolishi kerak");
  assert.equal(rv.polish?.accepted, false);
  assert.ok(rv.polish!.applied.length >= 1, "urinish jurnalda");
  for (const c of JUDGE_CRITERIA) assert.equal(rv.checks.find((x) => x.id === `judge:${c}`)?.detail, "2/3", "eski baholovchi ballari qolishi kerak");
});

test("polishArticle: baseVersion mos kelmasa 409 LLM CHAQIRILMASDAN; eski maqola 409 legacy; hisobotsiz 422; tuzatiladigan band yo'q 422", async (t) => {
  const d = doc();
  d.article!.review = await baseReview(d, 1);
  mockDb(t, { forEdit: editRow(d, { doc_version: 5 }) });
  const s = stub();
  const e = await expectApiError(polishArticle(GEN, USER, 3, { complete: s.complete }), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(e.extra.docVersion, 5);
  assert.equal(s.calls.length, 0, "eskirgan versiya bilan LLM chaqirildi");

  t.mock.reset();
  const legacy = doc();
  delete legacy.article;
  mockDb(t, { forEdit: editRow(legacy) });
  assert.equal((await expectApiError(polishArticle(GEN, USER, 3, { complete: s.complete }), 409)).extra.code, "legacy");

  t.mock.reset();
  const noReview = doc();
  delete noReview.article!.review;
  mockDb(t, { forEdit: editRow(noReview) });
  assert.equal((await expectApiError(polishArticle(GEN, USER, 3, { complete: s.complete }), 422)).extra.code, "review");

  t.mock.reset();
  const green = doc();
  green.article!.review = { score: 95, checks: [{ id: "udk", level: "yellow", label: "UDK" }], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: NOW.toISOString() };
  mockDb(t, { forEdit: editRow(green) });
  assert.equal((await expectApiError(polishArticle(GEN, USER, 3, { complete: s.complete }), 422)).extra.code, "nothing");
  assert.equal(s.calls.length, 0);
});

test("polishArticle: model javob bermasa 422 va bazaga yozilmaydi", async (t) => {
  const d = doc();
  d.article!.review = await baseReview(d, 1);
  const seen = mockDb(t, { forEdit: editRow(d), updateDoc: { doc_version: 4 }, detail: detailRow(d) });
  const s = stub({ sectionFail: true });
  const e = await expectApiError(polishArticle(GEN, USER, 3, { complete: s.complete, now: NOW }), 422);
  assert.equal(e.extra.code, "llm");
  assert.equal(seen.filter((x) => /UPDATE generations SET doc_json/.test(x.text)).length, 0);
  assert.ok(!s.calls.some((c) => c.role === "judge"), "tuzatish bo'lmasa baholovchi chaqirilmaydi");
});

/* ══════════════════════════════ UDK ══════════════════════════════ */

test("UDK: promptlar (JSON, sinf nomi tilda), parseUdk — haqiqiy shakl qabul, prefiks tozalanadi, uydirma/matn rad, note doim", () => {
  assert.match(udkSystemPrompt(), /UDC|УДК/);
  assert.match(udkSystemPrompt(), /"udk"/);
  assert.match(udkUserPrompt("Digital twin", "ru"), /Russian/);
  assert.match(udkUserPrompt("Digital twin", "uz"), /Uzbek/);
  const ok = parseUdk(JSON.stringify({ udk: "UDK 621.7:004.9", label: "Mashinasozlik texnologiyasi" }));
  assert.deepEqual(ok, { udk: "621.7:004.9", label: "Mashinasozlik texnologiyasi", note: UDK_NOTE });
  assert.equal(parseUdk(JSON.stringify({ udk: "37.02(575.1)", label: "x" }))?.udk, "37.02(575.1)");
  for (const bad of [JSON.stringify({ udk: "unknown", label: "x" }), JSON.stringify({ udk: "", label: "x" }), JSON.stringify({ udk: "621.7; DROP TABLE", label: "x" }), "not json", null, JSON.stringify({ udk: "abc.12" })]) {
    assert.equal(parseUdk(bad), null, `qabul qilindi: ${bad}`);
  }
  assert.equal(parseUdk(JSON.stringify({ udk: "6".repeat(80), label: "x" })), null, "40 belgidan uzun UDK yo'q");
  assert.equal(parseUdk(JSON.stringify({ udk: "621.7", label: "L".repeat(500) }))!.label.length, 120);
});
