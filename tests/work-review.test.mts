import test from "node:test";
import assert from "node:assert/strict";
import {
  WORK_RULE_IDS,
  neutralWorkJudge,
  parseWorkJudge,
  reviewWork,
  scoreWorkReview,
  workJudgeChecks,
  workJudgeSystemPrompt,
  workJudgeUserPrompt,
  workRuleChecks,
  workVisualCoverage,
} from "../lib/generation/work/review.ts";
import { workKindOf } from "../lib/generation/work/registry.ts";
import type { AcademicDoc, Block, DocMeta, DocSection } from "../lib/generation/types.ts";
import type { Reference } from "../lib/generation/article/types.ts";
import type { WorkModel } from "../lib/generation/work/types.ts";
import type { ReviewLevel } from "../lib/generation/report/types.ts";

/**
 * TAYYORLIK HISOBOTI — TALABA ISHI (AUDIT-19 WP-A). Har qoida uchun
 * yashil/sariq/qizil holat: hisobot foydalanuvchiga BAHO beradi, ya'ni
 * har band haqiqatan o'lchanayotganini qulflash shart.
 */

const meta: DocMeta = { pagesLabel: "25-30", targetPages: 28, language: "uz", topic: "Mavzu", includeVisuals: true } as DocMeta;

const INTRO_PARTS = [
  "Mavzuning dolzarbligi — bugungi ta'lim tizimining asosiy masalasi [W1].",
  "Ishning maqsadi — usullarni aniqlash.",
  "Ish vazifalari: tushunchani aniqlash, yondashuvlarni qiyoslash, tavsiyalar berish.",
  "Tadqiqot obyekti — ta'lim jarayoni.",
  "Tadqiqot predmeti — ko'nikma shakllantirish yo'llari.",
  "Tadqiqot metodlari: tahlil, qiyoslash, umumlashtirish.",
  "Ish tuzilmasi: kirish, ikki bob, xulosa va adabiyotlar ro'yxati.",
];

const p = (text: string): Block => ({ kind: "p", text });
const words = (n: number, seed = "so") => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

function refs(n: number, o: { verified?: Reference["verified"] } = {}): Reference[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `W${i + 1}`,
    title: `Manba ${i + 1}`,
    authors: ["Muallif A."],
    year: 2022,
    verified: o.verified ?? "openalex",
    cited: true,
  }));
}

type DocOpts = {
  intro?: Block[];
  chapters?: { id: string; title: string; paragraphs: { id: string; title: string; blocks: Block[] }[] }[];
  conclusion?: Block[];
  references?: Reference[];
  refsMin?: number;
  userFacts?: string;
  figures?: WorkModel["figures"];
  tables?: AcademicDoc["tables"];
  model?: Partial<WorkModel>;
  meta?: Partial<DocMeta>;
};

/*
 * SOG'LOM kurs ishi (25–30 bet paketi): tana ≈5 800 so'z — kirish
 * ≈12 % (700), xulosa ≈3 bet (700), boblar 4 × 1 100. Sxema va jadval
 * matnda havola qilingan. Testlar shu asosdan CHETLASHADI.
 */
const DEFAULT_FIGURE: WorkModel["figures"] = [{ id: "f1", kind: "scheme", caption: "Sxema", spec: { kind: "process", steps: ["a", "b"] }, w: 100, h: 100, url: "data:image/png;base64,x" }];
const DEFAULT_TABLES: AcademicDoc["tables"] = [{ id: "t1", caption: "Jadval", headers: ["a", "b"], rows: [["1", "2"]], anchor: "ch1.2" }];

function makeDoc(o: DocOpts = {}): AcademicDoc {
  const chapters =
    o.chapters ??
    [1, 2].map((c) => ({
      id: `ch${c}`,
      title: `Bob ${c}`,
      paragraphs: [1, 2].map((q) => {
        const blocks: Block[] = [p(`${words(1100, `c${c}p${q}w`)} [W1].`)];
        if (c === 1 && q === 1) {
          blocks[0] = p(`Quyidagi sxemada ko'rsatilgan [fig:f1]. ${words(1100, "c1p1w")} [W1].`);
          blocks.push({ kind: "figure", text: "Sxema", figureId: "f1" });
        }
        if (c === 1 && q === 2) {
          blocks[0] = p(`Natijalar jadvalda keltirilgan [tab:t1]. ${words(1100, "c1p2w")} [W1].`);
          blocks.push({ kind: "tableRef", text: "Jadval", tableId: "t1" });
        }
        return { id: `ch${c}.${q}`, title: `${c}.${q} paragraf`, blocks };
      }),
    }));
  const sections: DocSection[] = [{ id: "intro", title: "Kirish", blocks: o.intro ?? INTRO_PARTS.map((t, i) => p(`${t} ${words(90, `i${i}`)}`)) }];
  for (const c of chapters) {
    sections.push({ id: c.id, title: c.title, blocks: [] });
    for (const q of c.paragraphs) sections.push({ id: q.id, title: q.title, blocks: q.blocks });
  }
  sections.push({ id: "conclusion", title: "Xulosa", blocks: o.conclusion ?? [p(`Birinchi vazifa bo'yicha: ${words(700, "x")}`)] });
  const model: WorkModel = {
    v: 1,
    genre: "coursework",
    kind: "theory",
    subject: "humanities",
    language: "uz",
    university: "TDU",
    faculty: "F",
    department: "K",
    subjectName: "Pedagogika",
    group: "301",
    course: "3",
    author: "Aliyev Ali",
    teacher: "Rahimov B.",
    city: "Toshkent",
    ministry: "oliy",
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, paragraphs: c.paragraphs.map((q) => ({ id: q.id, title: q.title, sectionId: q.id })) })),
    intro: { parts: {} as WorkModel["intro"]["parts"] },
    references: o.references ?? refs(15),
    figures: o.figures ?? (o.chapters ? [] : DEFAULT_FIGURE),
    refsMin: o.refsMin ?? 15,
    ...(o.userFacts ? { userFacts: o.userFacts } : {}),
    ...(o.model ?? {}),
  };
  return {
    meta: { ...meta, ...(o.meta ?? {}) },
    titlePage: true,
    toc: true,
    sections,
    ...(o.tables ?? (o.chapters ? undefined : DEFAULT_TABLES) ? { tables: o.tables ?? DEFAULT_TABLES } : {}),
    work: model,
  };
}

const levelOf = (doc: AcademicDoc, id: string, extra: Parameters<typeof workRuleChecks>[1] = {}): ReviewLevel | undefined =>
  workRuleChecks(doc, extra).checks.find((c) => c.id === id)?.level;

const checkOf = (doc: AcademicDoc, id: string, extra: Parameters<typeof workRuleChecks>[1] = {}) => workRuleChecks(doc, extra).checks.find((c) => c.id === id);

/* ───────────────────────────── umumiy ───────────────────────────── */

test("sog'lom hujjat: reyestrdagi HAR qoida bandi chiqadi, qizil yo'q", () => {
  const doc = makeDoc();
  const r = workRuleChecks(doc);
  const ids = r.checks.map((c) => c.id);
  for (const id of WORK_RULE_IDS) assert.ok(ids.includes(id), `«${id}» bandi yo'q`);
  const red = r.checks.filter((c) => c.level === "red");
  assert.deepEqual(red.map((c) => `${c.id}: ${c.detail}`), []);
});

test("eski hujjat (`doc.work` yo'q) — hisobot qizil band bilan qaytadi, yiqilmaydi", () => {
  const doc = makeDoc();
  delete doc.work;
  const r = workRuleChecks(doc);
  assert.equal(r.checks[0].level, "red");
  assert.match(r.checks[0].detail ?? "", /qaytadan yarating/);
});

/* ───────────────────────────── kirish ───────────────────────────── */

test("introParts: 7 element bor — yashil; 1 tasi yo'q — sariq; yarmi yo'q — qizil; bo'sh — qizil", () => {
  assert.equal(levelOf(makeDoc(), "introParts"), "green");
  assert.equal(levelOf(makeDoc({ intro: INTRO_PARTS.slice(0, 6).map(p) }), "introParts"), "yellow");
  assert.equal(levelOf(makeDoc({ intro: INTRO_PARTS.slice(0, 3).map(p) }), "introParts"), "red");
  assert.equal(levelOf(makeDoc({ intro: [] }), "introParts"), "red");
  // Fix — kirishni qayta yozish, yo'qolgan elementlar nomi bilan.
  const fix = checkOf(makeDoc({ intro: INTRO_PARTS.slice(0, 5).map(p) }), "introParts")?.fix;
  assert.equal(fix?.target, "intro");
  assert.match(fix?.instruction ?? "", /methods|structure/);
});

test("introShare: 10–15 % yashil; chetda sariq; juda katta — qizil", () => {
  assert.equal(levelOf(makeDoc(), "introShare"), "green");
  // Kirish juda qisqa (≈1 %).
  assert.equal(levelOf(makeDoc({ intro: [p(words(20))] }), "introShare"), "red");
  // Kirish biroz qisqa (≈8 %) — sariq, chunki chegara 10 % dan uncha uzoq emas.
  const smallish = makeDoc({ intro: [p(`${words(340)} ${INTRO_PARTS.join(" ")}`)] });
  assert.equal(levelOf(smallish, "introShare"), "yellow");
});

/* ───────────────────────────── boblar ───────────────────────────── */

test("chapterBalance: teng boblar yashil; ±30 % dan chetda sariq; paragraf yetmasa qizil", () => {
  assert.equal(levelOf(makeDoc(), "chapterBalance"), "green");
  const skew = makeDoc({
    chapters: [
      { id: "ch1", title: "Bob 1", paragraphs: [1, 2].map((q) => ({ id: `ch1.${q}`, title: "p", blocks: [p(words(1200, `a${q}`))] })) },
      { id: "ch2", title: "Bob 2", paragraphs: [1, 2].map((q) => ({ id: `ch2.${q}`, title: "p", blocks: [p(words(200, `b${q}`))] })) },
    ],
  });
  assert.equal(levelOf(skew, "chapterBalance"), "yellow");
  const thin = makeDoc({
    chapters: [
      { id: "ch1", title: "Bob 1", paragraphs: [{ id: "ch1.1", title: "p", blocks: [p(words(600, "a"))] }] },
      { id: "ch2", title: "Bob 2", paragraphs: [1, 2].map((q) => ({ id: `ch2.${q}`, title: "p", blocks: [p(words(300, `b${q}`))] })) },
    ],
  });
  assert.equal(levelOf(thin, "chapterBalance"), "red");
  const one = makeDoc({ chapters: [{ id: "ch1", title: "Bob 1", paragraphs: [1, 2].map((q) => ({ id: `ch1.${q}`, title: "p", blocks: [p(words(600, `a${q}`))] })) }] });
  assert.equal(levelOf(one, "chapterBalance"), "red", "kamida 2 bob");
});

/* ───────────────────────────── hajm ───────────────────────────── */

test("length: maqsad ±20 % yashil, ±40 % sariq, undan tashqarisi qizil", () => {
  assert.equal(levelOf(makeDoc(), "length"), "green");
  const short = makeDoc({ chapters: [1, 2].map((c) => ({ id: `ch${c}`, title: "B", paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [p(words(100, `s${c}${q}`))] })) })) });
  assert.equal(levelOf(short, "length"), "red");
  const nearly = makeDoc({ chapters: [1, 2].map((c) => ({ id: `ch${c}`, title: "B", paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [p(words(660, `n${c}${q}`))] })) })) });
  assert.equal(levelOf(nearly, "length"), "yellow");
});

test("conclusionShare: 2–4 bet yashil, qisqa/uzun sariq, yo'q — qizil", () => {
  assert.equal(levelOf(makeDoc({ conclusion: [p(words(600, "k"))] }), "conclusionShare"), "green");
  assert.equal(levelOf(makeDoc({ conclusion: [p(words(60, "k"))] }), "conclusionShare"), "yellow");
  assert.equal(levelOf(makeDoc({ conclusion: [] }), "conclusionShare"), "red");
  assert.equal(checkOf(makeDoc({ conclusion: [p(words(60, "k"))] }), "conclusionShare")?.fix?.target, "conclusion");
});

/* ───────────────────────────── manbalar ───────────────────────────── */

test("refsCount: minimum bajarilsa yashil; kam — sariq; yarmidan kam — qizil; FIX YO'Q", () => {
  assert.equal(levelOf(makeDoc(), "refsCount"), "green");
  const few = makeDoc({ references: refs(10) });
  assert.equal(levelOf(few, "refsCount"), "yellow");
  assert.equal(checkOf(few, "refsCount")?.fix, undefined, "manba qo'shish — foydalanuvchi ishi, avtomatik tuzatilmaydi");
  assert.equal(levelOf(makeDoc({ references: refs(3) }), "refsCount"), "red");
  // Janr minimumi modeldan: referatda 5 ta yetadi.
  const ref5 = makeDoc({ references: refs(5), refsMin: 5, model: { genre: "referat", kind: "informative", refsMin: 5 } });
  assert.equal(levelOf(ref5, "refsCount"), "green");
});

test("refsVerified: 100 % yashil; qisman sariq; 80 % dan kam — qizil", () => {
  assert.equal(levelOf(makeDoc(), "refsVerified"), "green");
  const mixed = [...refs(14), { ...refs(1)[0], id: "X1", verified: "unverified" as const }];
  assert.equal(levelOf(makeDoc({ references: mixed }), "refsVerified"), "yellow");
  assert.equal(levelOf(makeDoc({ references: refs(15, { verified: "unverified" }) }), "refsVerified"), "red");
});

test("refsCited: 1:1 yashil; ro'yxatda bor matnda yo'q — sariq; iqtibossiz — qizil; o'chirilgan id — qizil", () => {
  // Sog'lom hujjatda faqat [W1] iqtibos qilinadi → qolgan 14 ta «yetim».
  assert.equal(levelOf(makeDoc(), "refsCited"), "yellow");
  assert.equal(levelOf(makeDoc({ references: refs(1), refsMin: 1 }), "refsCited"), "green");
  const noCite = makeDoc({
    references: refs(15),
    chapters: [1, 2].map((c) => ({ id: `ch${c}`, title: "B", paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [p(words(600, `z${c}${q}`))] })) })),
    intro: [p("Dolzarblik. Maqsad. Vazifalar. Obyekt. Predmet. Metodlar. Tuzilma.")],
  });
  assert.equal(levelOf(noCite, "refsCited"), "red");
  assert.equal(levelOf(makeDoc(), "refsCited", { guard: { unresolved: [{ id: "W999", sectionId: "ch1.1" }] } }), "red");
});

test("refsOrder: O'zbekiston tartibi (qonun → kitob → maqola) — mos yashil, buzilgan sariq", () => {
  assert.equal(levelOf(makeDoc(), "refsOrder"), "green");
  const law: Reference = { id: "lex:1", kind: "law", title: "Ta'lim to'g'risidagi qonun", authors: [], docNo: "O'RQ-637", verified: "lexuz", cited: true };
  const book: Reference = { id: "gb:1", kind: "book", title: "Pedagogika", authors: ["Karimov A."], year: 2020, verified: "googlebooks", cited: true };
  const article: Reference = { id: "W1", kind: "article", title: "Reading", authors: ["Smith J."], year: 2021, verified: "openalex", cited: true };
  // To'g'ri tartib — qonun boshda.
  assert.equal(levelOf(makeDoc({ references: [law, book, article], refsMin: 3 }), "refsOrder"), "green");
  // Teskari tartib — hisobot ko'radi.
  const wrong = checkOf(makeDoc({ references: [article, book, law], refsMin: 3 }), "refsOrder");
  assert.equal(wrong?.level, "yellow");
  assert.match(wrong?.detail ?? "", /qonun/);
});

/* ───────────────────────────── vizuallar ───────────────────────────── */

test("visualRef: havola bor — yashil; yo'q — sariq (fix bilan); majburiy turda vizual yo'q — qizil", () => {
  const figure: WorkModel["figures"] = [{ id: "f1", kind: "scheme", caption: "Sxema", spec: { kind: "process", steps: ["a", "b"] }, w: 100, h: 100 }];
  const withRef = makeDoc({
    figures: figure,
    chapters: [
      { id: "ch1", title: "B1", paragraphs: [{ id: "ch1.1", title: "p", blocks: [p(`Quyidagi rasmda ko'rsatilgan [fig:f1]. ${words(600, "a")}`), { kind: "figure", text: "Sxema", figureId: "f1" }] }, { id: "ch1.2", title: "p", blocks: [p(words(600, "b"))] }] },
      { id: "ch2", title: "B2", paragraphs: [1, 2].map((q) => ({ id: `ch2.${q}`, title: "p", blocks: [p(words(600, `c${q}`))] })) },
    ],
  });
  assert.equal(levelOf(withRef, "visualRef"), "green");
  const noRef = makeDoc({
    figures: figure,
    chapters: [
      { id: "ch1", title: "B1", paragraphs: [{ id: "ch1.1", title: "p", blocks: [p(words(600, "a")), { kind: "figure", text: "Sxema", figureId: "f1" }] }, { id: "ch1.2", title: "p", blocks: [p(words(600, "b"))] }] },
      { id: "ch2", title: "B2", paragraphs: [1, 2].map((q) => ({ id: `ch2.${q}`, title: "p", blocks: [p(words(600, `c${q}`))] })) },
    ],
  });
  assert.equal(levelOf(noRef, "visualRef"), "yellow");
  assert.match(checkOf(noRef, "visualRef")?.fix?.instruction ?? "", /\[fig:f1\]/);
  // Kurs ishida jadval va sxema MAJBURIY — bittasi ham yo'q → qizil.
  const noVisuals = makeDoc({ chapters: [1, 2].map((c) => ({ id: `ch${c}`, title: "B", paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [p(words(600, `v${c}${q}`))] })) })) });
  assert.equal(levelOf(noVisuals, "visualRef"), "red");
  // Referatda ixtiyoriy → yashil.
  noVisuals.work!.genre = "referat";
  noVisuals.work!.kind = "informative";
  assert.equal(levelOf(noVisuals, "visualRef"), "green");
  // Raqamlash bob bo'yicha: `1.1-rasm`.
  assert.equal(workVisualCoverage(noRef).unreferenced[0].label, "1.1-rasm");
});

/* ───────────────────────────── mundarija ───────────────────────────── */

test("tocMatch: sarlavhalar mos — yashil; farq qilsa sariq; bo'lim yo'q — qizil", () => {
  assert.equal(levelOf(makeDoc(), "tocMatch"), "green");
  const renamed = makeDoc();
  renamed.sections.find((s) => s.id === "ch1")!.title = "Boshqa nom";
  assert.equal(levelOf(renamed, "tocMatch"), "yellow");
  const dropped = makeDoc();
  dropped.sections = dropped.sections.filter((s) => s.id !== "ch2.2");
  assert.equal(levelOf(dropped, "tocMatch"), "red");
});

/* ───────────────────────────── matn sifati ───────────────────────────── */

test("filler / repetition / unsourcedNumbers / userFacts", () => {
  assert.equal(levelOf(makeDoc(), "filler"), "green");
  const filler = makeDoc({ intro: [p(`bugungi kunda ${INTRO_PARTS.join(" ")}`)] });
  assert.equal(levelOf(filler, "filler"), "yellow");
  const manyFiller = makeDoc({
    chapters: [1, 2].map((c) => ({
      id: `ch${c}`,
      title: "B",
      paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [p(`bugungi kunda ma'lumki hozirgi vaqtda ${words(600, `f${c}${q}`)}`)] })),
    })),
  });
  assert.equal(levelOf(manyFiller, "filler"), "red");
  assert.ok(checkOf(manyFiller, "filler")?.fix);

  assert.equal(levelOf(makeDoc(), "repetition"), "green");
  const same = p(`${words(400, "same")} takror matn`);
  const repeated = makeDoc({
    chapters: [1, 2].map((c) => ({ id: `ch${c}`, title: "B", paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [{ ...same }] })) })),
  });
  assert.equal(levelOf(repeated, "repetition"), "yellow");

  assert.equal(levelOf(makeDoc(), "unsourcedNumbers"), "green");
  const unsourced = makeDoc({ conclusion: [p(`Natijada 45% o'sish kuzatildi. ${words(300, "u")}`)] });
  assert.equal(levelOf(unsourced, "unsourcedNumbers"), "red");
  assert.ok(checkOf(unsourced, "unsourcedNumbers")?.fix);

  assert.equal(levelOf(makeDoc(), "userFacts"), "green");
  const facts = makeDoc({ userFacts: "120 o'quvchi, ball 4,6" });
  assert.equal(levelOf(facts, "userFacts"), "yellow", "faktlar matnda uchramadi");
  const factsUsed = makeDoc({ userFacts: "120 o'quvchi", conclusion: [p(`Tajribada 120 o'quvchi qatnashdi. ${words(300, "q")}`)] });
  assert.equal(levelOf(factsUsed, "userFacts"), "green");
});

test("pageLimit: paket ichida yashil; ancha qisqa/uzun — sariq yoki qizil", () => {
  assert.equal(levelOf(makeDoc(), "pageLimit"), "green");
  const tiny = makeDoc({ chapters: [1, 2].map((c) => ({ id: `ch${c}`, title: "B", paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [p(words(50, `t${c}${q}`))] })) })) });
  assert.equal(levelOf(tiny, "pageLimit"), "red");
  const big = makeDoc({ chapters: [1, 2].map((c) => ({ id: `ch${c}`, title: "B", paragraphs: [1, 2].map((q) => ({ id: `ch${c}.${q}`, title: "p", blocks: [p(words(2500, `g${c}${q}`))] })) })) });
  assert.ok(levelOf(big, "pageLimit") !== "green");
  assert.ok(checkOf(big, "pageLimit")?.fix, "uzun hujjatda qisqartirish fix i bo'ladi");
});

/* ───────────────────────────── baholovchi va ball ───────────────────────────── */

test("baholovchi: 5 mezon, turning prompti, JSON tahlili, noma'lum nishon tashlanadi", () => {
  const kind = workKindOf("coursework", "theory");
  const prompt = workJudgeSystemPrompt(kind, ["intro", "ch1.1", "conclusion"]);
  for (const c of ["logic", "depth", "style", "aimMatch", "originality"]) assert.match(prompt, new RegExp(`"${c}"|- ${c}:`), `${c} promptda yo'q`);
  assert.match(prompt, /lecturer/i);
  assert.match(prompt, /work type: Theoretical course paper/);
  const j = parseWorkJudge(
    kind,
    JSON.stringify({ logic: 3, depth: 2, style: 3, aimMatch: 1, originality: 2, notes: ["izoh"], fixes: [{ target: "ch1.1", instruction: "Chuqurlashtiring" }, { target: "zzz", instruction: "yo'q" }] }),
    ["intro", "ch1.1", "conclusion"],
  )!;
  assert.equal(j.aimMatch, 1);
  assert.deepEqual(j.fixes, [{ target: "ch1.1", instruction: "Chuqurlashtiring" }]);
  const checks = workJudgeChecks(kind, j);
  assert.equal(checks.find((c) => c.id === "judge:logic")?.level, "green");
  assert.equal(checks.find((c) => c.id === "judge:depth")?.level, "yellow");
  assert.equal(checks.find((c) => c.id === "judge:aimMatch")?.level, "red");
  assert.ok(checks.some((c) => c.id === "judge:fix:1"));
  assert.equal(parseWorkJudge(kind, "not json", []), null);
});

test("baholovchi matni: kirish va xulosa TO'LIQ, boblar mutanosib kesiladi", () => {
  const doc = makeDoc();
  // Byudjet butun hujjatga yetmaydi, lekin KIRISH + XULOSA to'liq sig'adi (X-4).
  const text = workJudgeUserPrompt(doc, 12_000);
  assert.match(text, /GENRE: coursework/);
  assert.match(text, /## intro/);
  assert.match(text, /## conclusion/);
  // Kirish elementlari to'liq ko'rinadi (X-4: `aimMatch` mezoni shu ikki bo'limga qaraydi).
  assert.match(text, /Ishning maqsadi/);
  assert.match(text, /truncated/);
});

test("ball: qoidalar 60 % + baholovchi 40 %; neytral javob — o'rtacha ball", async () => {
  const doc = makeDoc();
  const kind = workKindOf("coursework", "theory");
  const perfect = { logic: 3, depth: 3, style: 3, aimMatch: 3, originality: 3, notes: [], fixes: [] };
  const zero = { logic: 0, depth: 0, style: 0, aimMatch: 0, originality: 0, notes: [], fixes: [] };
  const rules = workRuleChecks(doc).checks;
  assert.ok(scoreWorkReview(rules, perfect as never) > scoreWorkReview(rules, zero as never));
  assert.ok(scoreWorkReview(rules, neutralWorkJudge(kind)) > 0);

  // Baholovchi javob bermasa — izoh va neytral ballar.
  const noJudge = await reviewWork(doc, { complete: async () => null, deadline: Date.now() + 60_000 });
  assert.ok(noJudge.judgeNotes.includes("Baholovchi javob bermadi"));
  assert.ok(noJudge.score > 0 && noJudge.score <= 100);
  assert.ok(noJudge.checks.some((c) => c.id === "judge:logic"));

  // Baholovchisiz (`judge: false`) — `judge:*` bandlari baribir neytral sifatida qo'shiladi.
  const noCall = await reviewWork(doc, { judge: false });
  assert.ok(!noCall.judgeNotes.includes("Baholovchi javob bermadi"));
  assert.equal(noCall.builtAt.length > 0, true);
});

test("`reviewWork`: baholovchi javobi ballga va bandlarga tushadi, `onUsage` chaqiriladi", async () => {
  const doc = makeDoc();
  const usages: unknown[] = [];
  const review = await reviewWork(doc, {
    deadline: Date.now() + 60_000,
    onUsage: (u) => usages.push(u),
    complete: async (role) => {
      assert.equal(role, "judge");
      return {
        text: JSON.stringify({ logic: 3, depth: 3, style: 3, aimMatch: 3, originality: 3, notes: ["yaxshi"], fixes: [] }),
        usage: { provider: "stub", model: "m", inputTokens: 10, outputTokens: 5 },
      };
    },
  });
  assert.equal(usages.length, 1);
  assert.ok(review.judgeNotes.includes("yaxshi"));
  assert.equal(review.checks.find((c) => c.id === "judge:logic")?.level, "green");
  const low = await reviewWork(doc, {
    deadline: Date.now() + 60_000,
    complete: async () => ({ text: JSON.stringify({ logic: 0, depth: 0, style: 0, aimMatch: 0, originality: 0, notes: [], fixes: [] }) }),
  });
  assert.ok(low.score < review.score, `${low.score} < ${review.score}`);
});
