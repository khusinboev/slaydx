import test from "node:test";
import assert from "node:assert/strict";
import {
  JUDGE_CRITERIA,
  JUDGE_NEUTRAL,
  RULE_IDS,
  jaccard,
  judgeChecks,
  judgeSystemPrompt,
  judgeUserPrompt,
  neutralJudge,
  parseJudge,
  reviewArticle,
  ruleChecks,
  scoreReview,
  trigrams,
  type JudgeResult,
} from "../lib/generation/article/review.ts";
import { sampleArticleDoc } from "../lib/generation/article/samples.ts";
import type { ArticleTypeId, PublicationProfileId, Reference, ReviewCheck } from "../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * Tayyorlik hisoboti (Maqola 2, WP5) — har qoida uchun yashil/sariq/qizil
 * fikstura, judge stub, ball formulasi, javobsiz baholovchi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   • `verified` chegarasi 0.8 → 0.5 — «2/3 tasdiqlangan → qizil» testi yiqildi (sariq chiqdi);
 *   • `recent` `>=` → `>` — «aynan chegarada yashil» testi yiqildi;
 *   • `citations` da `orphan` tekshiruvi olib tashlandi — «ro'yxatda bor, matnda yo'q → sariq» yiqildi;
 *   • `RULE_WEIGHT` 0.6 → 0.5 — ball formulasi testi (60·r + 40·j) yiqildi;
 *   • sariq 0.5 → 0 — «sariq yarim ball» testi yiqildi;
 *   • `parseJudge` null → neytral o'rniga 0 — «javob bermasa 2/3» testi yiqildi;
 *   • `REPETITION_JACCARD` 0.15 → 0.5 — takror testi yiqildi.
 */

const NOW = new Date("2026-09-12T10:00:00Z");

const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "Karimova D.", workLabel: "Maqola", language: "uz", toolId: "article", targetPages: 4, figureCount: 1, udk: "004.8", research: true } as unknown as DocMeta;

const long = (seed: string, n = 60) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

/** Namuna + «to'g'ri» holatga keltirish: 12 manba, annotatsiya 150–250 so'z, havolalar, cheklov. */
function goodDoc(type: ArticleTypeId = "imrad_oak", profile: PublicationProfileId = "oak"): AcademicDoc {
  // Chuqur nusxa: namuna manba OBYEKTLARI modul konstantasi bilan umumiy — testlar bir-birini bulg'amasin.
  const doc = structuredClone(sampleArticleDoc(META, { type, profile }));
  const m = doc.article!;
  const refs: Reference[] = Array.from({ length: 12 }, (_, i) => ({
    id: `W${100 + i}`,
    doi: `10.1/w${i}`,
    title: `Paper ${i}`,
    authors: [`Author${i} A.`],
    year: 2022 + (i % 4),
    venue: "J. AI",
    verified: i % 2 ? "openalex" : "crossref",
    cited: true,
  }));
  m.references = [...m.references, ...refs];
  m.authors = m.authors.map((a) => ({ ...a, org: a.org ?? "TDIU", email: a.email ?? "x@y.uz", orcid: a.orcid ?? "0000-0000-0000-0000" }));
  const cites = refs.map((r) => `[${r.id}]`).join(" ");
  doc.sections[0].blocks.push({ kind: "p", text: `${long("kirish")} ${cites}.` });
  doc.sections[1].blocks.push({ kind: "p", text: `Tizim tuzilmasi quyidagi rasmda ko‘rsatilgan (1-rasm). ${long("metod")}` });
  doc.sections[2].blocks.push({ kind: "p", text: `Natijalar 1-jadvalda keltirilgan. ${long("natija")}` });
  doc.sections[3].blocks.push({ kind: "p", text: `Tadqiqot cheklovlari: tanlama bitta universitet bilan chegaralangan. ${long("muhokama")}` });
  doc.sections[4].blocks.push({ kind: "p", text: long("xulosa", 30) });
  doc.abstracts = doc.abstracts!.map((a) => ({ ...a, text: `${a.text} ${long(a.lang, 150)}` }));
  return doc;
}

/** `goodDoc` ≈ 958 so'z (bo'limlar + annotatsiya ×3) — ±20% ichida. */
// `goodDoc` bo'lim matni ≈405 so'z (`long(...)` qo'shimchalari bilan) — maqsad FAQAT bo'lim matni (annotatsiya alohida qoida).
const WORD_TARGET = 400;
const rules = (doc: AcademicDoc, o: Partial<Parameters<typeof ruleChecks>[1]> = {}) => ruleChecks(doc, { wordTarget: WORD_TARGET, now: NOW, ...o });
const level = (checks: ReviewCheck[], id: string) => checks.find((c) => c.id === id)?.level;
const detail = (checks: ReviewCheck[], id: string) => checks.find((c) => c.id === id)?.detail ?? "";

/* ══════════════════════════════ qoidalar ══════════════════════════════ */

test("to'g'ri hujjat: barcha qoidalar yashil; har check id/level/label (uz) bor; faqat mos qoidalar (udk bor, doi/prisma/highlights yo'q)", () => {
  const r = rules(goodDoc());
  const bad = r.checks.filter((c) => c.level !== "green");
  assert.deepEqual(bad.map((c) => `${c.id}:${c.detail}`), [], "hamma yashil bo'lishi kerak");
  for (const c of r.checks) {
    assert.ok(RULE_IDS.includes(c.id as (typeof RULE_IDS)[number]), c.id);
    assert.ok(c.label && /[a-z‘’]/i.test(c.label), "yorliq");
  }
  const ids = r.checks.map((c) => c.id);
  assert.ok(ids.includes("udk") && !ids.includes("doi") && !ids.includes("prisma") && !ids.includes("highlights"));
  assert.equal(r.verifiedShare, 1);
  assert.equal(r.recentShare, 1);
});

test("structure: majburiy bo'lim yo'q → qizil; ixtiyoriy/bo'sh → sariq; tartib buzilgan → sariq", () => {
  const doc = goodDoc();
  doc.sections = doc.sections.filter((s) => s.id !== "results");
  assert.equal(level(rules(doc).checks, "structure"), "red");
  assert.match(detail(rules(doc).checks, "structure"), /Natijalar/);
  const d2 = goodDoc();
  d2.sections = d2.sections.filter((s) => s.id !== "discussion");
  assert.equal(level(rules(d2).checks, "structure"), "yellow");
  const d3 = goodDoc();
  d3.sections = [d3.sections[4], ...d3.sections.slice(0, 4)];
  assert.equal(level(rules(d3).checks, "structure"), "yellow");
  assert.match(detail(rules(d3).checks, "structure"), /tartib/);
  const d4 = goodDoc();
  assert.equal(level(rules(d4, { guard: { emptySections: ["discussion"] } }).checks, "structure"), "yellow");
});

test("udk: profil talab qilsa va yo'q → sariq; apa profilida tekshiruv yo'q", () => {
  const doc = goodDoc();
  doc.article!.udk = "";
  assert.equal(level(rules(doc).checks, "udk"), "yellow");
  assert.equal(level(rules(goodDoc("imrad_classic", "apa")).checks, "udk"), undefined);
});

test("abstracts: til yo'q → qizil (+fix abstract:<lang>); so'z chegarasidan tashqari → sariq", () => {
  const doc = goodDoc();
  doc.abstracts = doc.abstracts!.filter((a) => a.lang !== "en");
  const c = rules(doc).checks.find((x) => x.id === "abstracts")!;
  assert.equal(c.level, "red");
  assert.deepEqual(c.fix?.target, "abstract:en");
  const d2 = goodDoc();
  d2.abstracts![1].text = "Qisqa.";
  const c2 = rules(d2).checks.find((x) => x.id === "abstracts")!;
  assert.equal(c2.level, "yellow");
  assert.match(c2.detail!, /ru 1/);
  assert.equal(c2.fix?.target, "abstract:ru");
});

test("keywords: til yo'q → qizil; chegaradan tashqari → sariq; modelda yo'q bo'lsa annotatsiya qatoridan sanaladi", () => {
  const doc = goodDoc();
  doc.article!.keywords = { ...doc.article!.keywords, en: [] };
  doc.abstracts![2].keywords = "";
  assert.equal(level(rules(doc).checks, "keywords"), "red");
  const d2 = goodDoc();
  d2.article!.keywords = { ...d2.article!.keywords, uz: ["a", "b"] };
  assert.equal(level(rules(d2).checks, "keywords"), "yellow");
  const d3 = goodDoc();
  d3.article!.keywords = {};
  d3.abstracts = d3.abstracts!.map((a) => ({ ...a, keywords: "a, b, c, d, e, f" }));
  assert.equal(level(rules(d3).checks, "keywords"), "green");
});

test("authors: yo'q → qizil; tashkilotsiz → sariq; email/ORCID yo'q → sariq", () => {
  const doc = goodDoc();
  doc.article!.authors = [];
  assert.equal(level(rules(doc).checks, "authors"), "red");
  const d2 = goodDoc();
  d2.article!.authors[0].org = "";
  assert.equal(level(rules(d2).checks, "authors"), "yellow");
  const d3 = goodDoc();
  d3.article!.authors[1].orcid = undefined;
  assert.equal(level(rules(d3).checks, "authors"), "yellow");
});

test("citations 1:1: unresolved → qizil; ro'yxatda bor, matnda yo'q → sariq; matnda iqtibos yo'q → qizil", () => {
  const doc = goodDoc();
  assert.equal(level(rules(doc, { guard: { unresolved: [{ id: "W9", sectionId: "intro" }] } }).checks, "citations"), "red");
  const d2 = goodDoc();
  d2.article!.references.push({ id: "W999", title: "Orphan", authors: ["O O."], year: 2024, verified: "openalex", cited: true });
  const c = rules(d2).checks.find((x) => x.id === "citations")!;
  assert.equal(c.level, "yellow");
  assert.match(c.detail!, /W999/);
  const d3 = goodDoc();
  for (const s of d3.sections) for (const b of s.blocks) if (b.kind !== "formula") b.text = b.text.replace(/\[[^\]]+\]/g, "");
  assert.equal(level(rules(d3).checks, "citations"), "red");
});

test("verified: <0.8 qizil, <1 sariq, 1 yashil; ulush `verifiedShare` ga tushadi", () => {
  const doc = goodDoc();
  const refs = doc.article!.references;
  // 15 manbadan 4 tasi tekshirilmagan → 11/15 = 0.73 → qizil.
  for (let i = 0; i < 4; i++) refs[i].verified = "unverified";
  const r = rules(doc);
  assert.equal(level(r.checks, "verified"), "red");
  assert.ok(Math.abs(r.verifiedShare - 11 / 15) < 1e-9);
  // 1 tasi → 14/15 = 0.93 → sariq.
  const d2 = goodDoc();
  d2.article!.references[0].verified = "unverified";
  assert.equal(level(rules(d2).checks, "verified"), "yellow");
  // Aynan 0.8 → sariq (chegara `<0.8` qizil).
  const d3 = goodDoc();
  d3.article!.references = d3.article!.references.slice(0, 10);
  for (let i = 0; i < 2; i++) d3.article!.references[i].verified = "unverified";
  assert.equal(level(rules(d3).checks, "verified"), "yellow");
});

test("refsCount: profil chegarasi (oak 10–30): kam → qizil, ko'p → sariq; research statistikasi detail da", () => {
  const doc = goodDoc();
  doc.article!.references = doc.article!.references.slice(0, 5);
  const c = rules(doc, { research: { user: 1, userVerified: 1, queries: ["q"], found: 40, candidates: 30, selected: 5, failedQueries: 2 } }).checks.find((x) => x.id === "refsCount")!;
  assert.equal(c.level, "red");
  assert.match(c.detail!, /40 topildi, 5 tanlandi, 2 so‘rov xato/);
  const d2 = goodDoc();
  for (let i = 0; i < 20; i++) d2.article!.references.push({ id: `X${i}`, title: `t${i}`, authors: [], year: 2025, verified: "openalex", cited: true });
  d2.sections[0].blocks.push({ kind: "p", text: Array.from({ length: 20 }, (_, i) => `[X${i}]`).join(" ") });
  assert.equal(level(rules(d2).checks, "refsCount"), "yellow");
});

test("recent: ulush >= profil → yashil (aynan chegarada ham); yarmidan kam → qizil; yilsiz manbalar hisobga olinmaydi", () => {
  // oak: recentShare 0.4, 5 yil (2021+). 10 manba: 4 yangi, 6 eski → 0.4 → yashil.
  const doc = goodDoc();
  const refs = doc.article!.references.slice(0, 10);
  refs.forEach((r, i) => (r.year = i < 4 ? 2024 : 2010));
  doc.article!.references = refs;
  const r = rules(doc);
  assert.equal(level(r.checks, "recent"), "green", detail(r.checks, "recent"));
  assert.equal(r.recentShare, 0.4);
  // 3 yangi → 0.3 → sariq (≥ 0.2); 1 yangi → 0.1 → qizil.
  refs[3].year = 2010;
  assert.equal(level(rules(doc).checks, "recent"), "yellow");
  refs[1].year = 2010;
  refs[2].year = 2010;
  assert.equal(level(rules(doc).checks, "recent"), "red");
  // Yilsiz manba hisobga olinmaydi: 1 yangi + 9 yilsiz → 1/1 = 100%.
  refs.forEach((x, i) => (x.year = i === 0 ? 2025 : undefined));
  const r2 = rules(doc);
  assert.equal(r2.recentShare, 1);
  assert.equal(level(r2.checks, "recent"), "green");
});

test("doi: apa/ieee da DOI/URL siz manba → sariq; `raw` hisobga olinmaydi; gost da tekshiruv yo'q", () => {
  const doc = goodDoc("imrad_classic", "apa");
  const c = rules(doc).checks.find((x) => x.id === "doi")!;
  assert.equal(c.level, "yellow", "namunadagi u1 (kitob) DOI siz");
  assert.match(c.detail!, /u1/);
  doc.article!.references.find((r) => r.id === "u1")!.raw = "Karimov A. Kitob. – T., 2022.";
  assert.equal(level(rules(doc).checks, "doi"), "green");
});

test("visuals: matnda havola yo'q → sariq ([fig:id]/«1-rasm»/«rasm» so'zi yetarli); fallback → sariq; so'ralgan, lekin yo'q → sariq", () => {
  const doc = goodDoc();
  doc.sections[1].blocks = doc.sections[1].blocks.map((b) => (b.kind === "p" ? { ...b, text: b.text.replace(/rasm/gi, "chizilgan narsa") } : b));
  const c = rules(doc).checks.find((x) => x.id === "visuals")!;
  assert.equal(c.level, "yellow");
  assert.match(c.detail!, /1-rasm/);
  // [fig:f1] havolasi boshqa bo'limda bo'lsa ham yetadi.
  doc.sections[4].blocks.push({ kind: "p", text: "Qarang: [fig:f1]." });
  assert.equal(level(rules(doc).checks, "visuals"), "green");
  const d2 = goodDoc();
  d2.article!.figures[0].fallbackBlocks = [{ kind: "li", text: "1. Talaba faoliyati" }];
  assert.equal(level(rules(d2).checks, "visuals"), "yellow");
  assert.match(detail(rules(d2).checks, "visuals"), /chizilmadi/);
  const d3 = goodDoc();
  d3.article!.figures = [];
  d3.tables = [];
  for (const s of d3.sections) s.blocks = s.blocks.filter((b) => b.kind !== "figure" && b.kind !== "tableRef");
  assert.equal(level(rules(d3).checks, "visuals"), "yellow");
});

test("unsourcedNumbers: iqtibossiz foiz → qizil (+fix bo'limga); foydalanuvchi faktidagi foiz — manbali", () => {
  const doc = goodDoc();
  doc.sections[2].blocks.push({ kind: "p", text: "So‘rovda 37% talaba rozi bo‘ldi." });
  const c = rules(doc).checks.find((x) => x.id === "unsourcedNumbers")!;
  assert.equal(c.level, "red");
  assert.match(c.detail!, /37%/);
  assert.equal(c.fix?.target, "results");
  doc.article!.userFacts = "So‘rovda 37% talaba rozi bo‘ldi.";
  assert.equal(level(rules(doc).checks, "unsourcedNumbers"), "green");
});

test("userFacts: berilgan raqam matnda yo'q → sariq (+fix results ga); fakt yo'q → yashil", () => {
  const doc = goodDoc();
  doc.article!.userFacts = "Tajribada 120 talaba, ball 4,1 dan 4,6 ga; xatolik 0,05.";
  const c = rules(doc).checks.find((x) => x.id === "userFacts")!;
  assert.equal(c.level, "yellow");
  assert.match(c.detail!, /0\.05/);
  assert.equal(c.fix?.target, "results");
  doc.sections[2].blocks.push({ kind: "p", text: "Statistik ahamiyat darajasi 0,05." });
  assert.equal(level(rules(doc).checks, "userFacts"), "green");
});

test("filler: 1–3 → sariq, >3 → qizil; fix eng «suvli» bo'limga", () => {
  const doc = goodDoc();
  doc.sections[0].blocks.push({ kind: "p", text: "Bugungi kunda AI muhim rol o‘ynaydi." });
  const c = rules(doc).checks.find((x) => x.id === "filler")!;
  assert.equal(c.level, "yellow");
  assert.equal(c.fix?.target, "intro");
  doc.sections[3].blocks.push({ kind: "p", text: "Ma’lumki, hozirgi vaqtda shuni ta’kidlash joizki, bugungi kunda …" });
  const c2 = rules(doc).checks.find((x) => x.id === "filler")!;
  assert.equal(c2.level, "red");
  assert.equal(c2.fix?.target, "discussion");
});

test("repetition: 3-gram Jaccard > 0.15 → sariq; trigrams/jaccard yordamchilari", () => {
  assert.deepEqual([...trigrams("A b, c d!")], ["a b c", "b c d"]);
  assert.equal(jaccard(new Set(["x", "y"]), new Set(["y", "z"])), 1 / 3);
  const doc = goodDoc();
  const same = long("takror", 80);
  doc.sections[1].blocks.push({ kind: "p", text: same });
  doc.sections[3].blocks.push({ kind: "p", text: same });
  const c = rules(doc).checks.find((x) => x.id === "repetition")!;
  assert.equal(c.level, "yellow");
  assert.match(c.detail!, /Adabiyotlar tahlili va metodlar.*Muhokama/);
  assert.equal(c.fix?.target, "discussion");
});

test("length: maqsad ±20% yashil, ±40% sariq, undan tashqari qizil; wordRange turida oraliq", () => {
  const doc = goodDoc();
  // Faqat BO'LIM matni (annotatsiyalar `abstracts` qoidasida alohida o'lchanadi).
  const total = doc.sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + (b.kind === "p" ? b.text.split(/\s+/).length : 0), 0), 0);
  assert.equal(level(rules(doc, { wordTarget: total }).checks, "length"), "green");
  assert.equal(level(rules(doc, { wordTarget: Math.round(total / 1.3) }).checks, "length"), "yellow");
  assert.equal(level(rules(doc, { wordTarget: total * 3 }).checks, "length"), "red");
  const thesis = sampleArticleDoc(META, { type: "conference_thesis", profile: "conference" });
  thesis.sections = [{ id: "body", title: "Tezis", blocks: [{ kind: "p", text: long("t", 250) }] }];
  assert.equal(level(rules(thesis).checks, "length"), "green");
  thesis.sections[0].blocks = [{ kind: "p", text: long("t", 330) }];
  assert.equal(level(rules(thesis).checks, "length"), "yellow");
  thesis.sections[0].blocks = [{ kind: "p", text: long("t", 50) }];
  assert.equal(level(rules(thesis).checks, "length"), "red");
});

test("prisma: sistematik sharhda PRISMA figure bo'limda bo'lmasa qizil; highlights: elsevier 3–5 × ≤85", () => {
  const sys = goodDoc("review_systematic", "apa");
  assert.equal(level(rules(sys).checks, "prisma"), "red");
  sys.article!.figures.push({ id: "f9", kind: "scheme", caption: "PRISMA", spec: { kind: "prisma", identified: 10, screened: 8, excludedScreen: 2, eligible: 6, excludedElig: 1, included: 5 }, w: 1, h: 1 });
  sys.sections[2].blocks.push({ kind: "figure", text: "PRISMA", figureId: "f9" });
  assert.equal(level(rules(sys).checks, "prisma"), "green");
  const els = goodDoc("elsevier_ieee_style", "ieee");
  const c = rules(els).checks.find((x) => x.id === "highlights")!;
  assert.equal(c.level, "red");
  assert.equal(c.fix?.target, "highlights");
  els.article!.highlights = ["A", "B", "x".repeat(90)];
  assert.equal(level(rules(els).checks, "highlights"), "yellow");
  els.article!.highlights = ["A", "B", "C"];
  assert.equal(level(rules(els).checks, "highlights"), "green");
});

test("limitations: muhokama/xulosada «cheklov/limitation/ограничен» yo'q → sariq (+fix discussion)", () => {
  const doc = goodDoc();
  doc.sections[3].blocks = doc.sections[3].blocks.map((b) => (b.kind === "p" ? { ...b, text: b.text.replace(/cheklov|chegaralangan/gi, "x") } : b));
  const c = rules(doc).checks.find((x) => x.id === "limitations")!;
  assert.equal(c.level, "yellow");
  assert.equal(c.fix?.target, "discussion");
  assert.equal(c.fix?.op, "rewrite");
  doc.sections[4].blocks.push({ kind: "p", text: "Study limitations include the sample size." });
  assert.equal(level(rules(doc).checks, "limitations"), "green");
});

/* ══════════════════════════════ baholovchi ══════════════════════════════ */

test("judge promptlari: tizim — 6 mezon + JSON sxema + uz til ko'rsatmasi; foydalanuvchi — bo'limlar «[1]» bilan, ro'yxat, ≤25k belgi", () => {
  const sys = judgeSystemPrompt(["intro", "results"]);
  for (const c of JUDGE_CRITERIA) assert.ok(sys.includes(`- ${c}:`), c);
  assert.ok(sys.includes('"fixes":[{"target"') && sys.includes("Allowed target ids: intro, results"));
  assert.ok(sys.includes("OUTPUT LANGUAGE: Uzbek"));
  const user = judgeUserPrompt(goodDoc());
  assert.ok(user.startsWith("TITLE: Sun’iy intellekt"));
  assert.ok(user.includes("## intro — Kirish") && user.includes("## conclusion — Xulosa"));
  assert.ok(user.includes("[1]") && !user.includes("[W2741809807]"), "iqtiboslar raqamlangan bo'lishi kerak");
  assert.ok(/REFERENCES \(15\):\n1\. /.test(user));
  // Kesish: har bo'lim o'z ulushida, xulosa ham ko'rinadi.
  const big = goodDoc();
  for (const s of big.sections) s.blocks.push({ kind: "p", text: long("katta", 4000) });
  const cut = judgeUserPrompt(big, 5000);
  const body = cut.slice(cut.indexOf("SECTIONS:"), cut.indexOf("REFERENCES ("));
  assert.ok(body.length < 5000 + 5 * 300, `${body.length}`);
  assert.ok(cut.includes("## conclusion") && cut.includes("[…truncated]"));
});

test("parseJudge: ballar 0–3 ga qisiladi, yo'q maydon → 2, notes ≤5, fixes faqat ruxsat etilgan target bilan; JSON emas → null", () => {
  const j = parseJudge(JSON.stringify({ novelty: 3, chain: 9, methods: -1, comparison: "2", notes: Array.from({ length: 7 }, (_, i) => `n${i}`), fixes: [{ target: "results", instruction: "x" }, { target: "zzz", instruction: "y" }, { target: "abstract:uz", instruction: "" }] }), ["intro", "results"])!;
  assert.deepEqual({ ...j, notes: j.notes.length }, { novelty: 3, chain: 3, methods: 0, comparison: 2, overclaim: JUDGE_NEUTRAL, style: JUDGE_NEUTRAL, notes: 5, fixes: [{ target: "results", instruction: "x" }] });
  assert.equal(parseJudge("not json at all", []), null);
  assert.equal(parseJudge(null, []), null);
  const checks = judgeChecks(j);
  assert.deepEqual(
    checks.map((c) => `${c.id}:${c.level}`),
    ["judge:novelty:green", "judge:chain:green", "judge:methods:red", "judge:comparison:yellow", "judge:overclaim:yellow", "judge:style:yellow", "judge:fix:1:yellow"],
  );
  assert.deepEqual(checks[6].fix, { op: "rewrite", target: "results", instruction: "x" });
});

test("ball: 60% qoidalar (yashil 1 / sariq 0.5 / qizil 0) + 40% baholovchi (6 × 3); neytral judge = 26.7", () => {
  const mk = (levels: ("green" | "yellow" | "red")[]): ReviewCheck[] => levels.map((level, i) => ({ id: `c${i}`, level, label: "x" }));
  const full: JudgeResult = { novelty: 3, chain: 3, methods: 3, comparison: 3, overclaim: 3, style: 3, notes: [], fixes: [] };
  assert.equal(scoreReview(mk(["green", "green"]), full), 100);
  assert.equal(scoreReview(mk(["red", "red"]), full), 40);
  assert.equal(scoreReview(mk(["green", "green"]), neutralJudge()), Math.round(60 + 40 * (12 / 18)));
  // Sariq — yarim ball: 2 sariq = 1 yashil + 1 qizil.
  assert.equal(scoreReview(mk(["yellow", "yellow"]), full), scoreReview(mk(["green", "red"]), full));
  assert.equal(scoreReview(mk(["green", "yellow", "red"]), { ...full, novelty: 0, chain: 0, methods: 0 }), Math.round(60 * 0.5 + 40 * 0.5));
  assert.equal(scoreReview([], neutralJudge()), Math.round(60 + 40 * (2 / 3)));
});

/* ══════════════════════════════ reviewArticle ══════════════════════════════ */

const stubComplete = (reply: string | null, calls: { role: LlmRole; system: string; user: string }[] = []) =>
  (async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    return reply === null ? null : { text: reply, usage: { provider: "stub", model: "judge-1", inputTokens: 500, outputTokens: 80 } };
  }) as never;

test("reviewArticle: judge stub → ball, checks (qoidalar + judge), izohlar, fix lar, usage; builtAt/verifiedShare/recentShare", async () => {
  const calls: { role: LlmRole; system: string; user: string }[] = [];
  const usage: unknown[] = [];
  const reply = JSON.stringify({ novelty: 3, chain: 3, methods: 2, comparison: 3, overclaim: 3, style: 2, notes: ["Kirishda maqsad aniqroq yozilsin", "Metodlar bo‘limida tanlama hajmi"], fixes: [{ target: "intro", instruction: "Maqsadni aniq yozing" }] });
  const r = await reviewArticle(goodDoc(), { complete: stubComplete(reply, calls), deadline: Date.now() + 60_000, wordTarget: WORD_TARGET, now: NOW, onUsage: (u) => usage.push(u) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, "judge");
  assert.equal(usage.length, 1);
  assert.deepEqual(r.judgeNotes, ["Kirishda maqsad aniqroq yozilsin", "Metodlar bo‘limida tanlama hajmi"]);
  assert.equal(r.builtAt, NOW.toISOString());
  assert.equal(r.verifiedShare, 1);
  assert.equal(r.recentShare, 1);
  const rulesOnly = r.checks.filter((c) => !c.id.startsWith("judge:"));
  assert.ok(rulesOnly.every((c) => c.level === "green"));
  assert.equal(r.score, Math.round(60 + 40 * (16 / 18)));
  const fix = r.checks.find((c) => c.id === "judge:fix:1")!;
  assert.deepEqual(fix.fix, { op: "rewrite", target: "intro", instruction: "Maqsadni aniq yozing" });
});

test("baholovchi javob bermasa (null / JSON emas / vaqt yo'q): «Baholovchi javob bermadi», ballar neytral 2/3; judge:false — chaqirilmaydi, izohsiz", async () => {
  for (const reply of [null, "sorry, no json"]) {
    const r = await reviewArticle(goodDoc(), { complete: stubComplete(reply), deadline: Date.now() + 60_000, wordTarget: WORD_TARGET, now: NOW });
    assert.deepEqual(r.judgeNotes, ["Baholovchi javob bermadi"]);
    assert.ok(JUDGE_CRITERIA.every((c) => r.checks.find((x) => x.id === `judge:${c}`)?.detail === "2/3"));
    assert.equal(r.score, Math.round(60 + 40 * (2 / 3)));
  }
  // Vaqt qolmagan — chaqirilmaydi.
  const calls: { role: LlmRole; system: string; user: string }[] = [];
  const late = await reviewArticle(goodDoc(), { complete: stubComplete("{}", calls), deadline: Date.now() + 3_000, wordTarget: WORD_TARGET, now: NOW });
  assert.equal(calls.length, 0);
  assert.deepEqual(late.judgeNotes, ["Baholovchi javob bermadi"]);
  // Baholovchi xato tashlasa ham hisobot chiqadi.
  const throwing = (async () => {
    throw new Error("boom");
  }) as never;
  const err = await reviewArticle(goodDoc(), { complete: throwing, deadline: Date.now() + 60_000, wordTarget: WORD_TARGET, now: NOW });
  assert.deepEqual(err.judgeNotes, ["Baholovchi javob bermadi"]);
  const off = await reviewArticle(goodDoc(), { complete: stubComplete("{}", calls), judge: false, wordTarget: WORD_TARGET, now: NOW });
  assert.equal(calls.length, 0);
  assert.deepEqual(off.judgeNotes, []);
});

test("wordTarget berilmasa dvigatel rejasidan (`articleWordPlan`) olinadi", async () => {
  const r = await reviewArticle(goodDoc(), { judge: false, now: NOW });
  const c = r.checks.find((x) => x.id === "length")!;
  assert.match(c.detail!, /maqsad ≈\d+/);
});
