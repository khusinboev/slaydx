import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import type { AcademicDoc, Block } from "../lib/generation/types.ts";
import type { DocReview } from "../lib/generation/report/types.ts";
import { essayWords } from "../lib/generation/essay/registry.ts";
import type { EssayContextId, EssayKindId, EssayModel } from "../lib/generation/essay/types.ts";
import { reviewEssay, ruleChecks, essayModelOf, essayTextOf, isClaimSentence, sentencesOf, unsourcedStats } from "../lib/generation/essay/review.ts";
import { essayUserNeeds } from "../lib/generation/essay/polish.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * INSHO HISOBOTI (AUDIT-19 WP-D) — har qoida alohida sinaladi.
 *
 * Mutatsiyalar: `thesisStatement` qoidasi akademik kontekstda
 * o'chirilsa, klişe (`filler`) hisobga olinmasa, `linking` IELTS dan
 * olib tashlansa yoki `unsourcedStats` foydalanuvchi faktini
 * tekshirmasa — quyidagi testlar qizaradi.
 */

/* ────────────────────────── yordamchilar ────────────────────────── */

/** `n` ta noyob so'z — takror (3-gram) qoidasini ataylab qo'zg'atmaydi. */
const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");

/** Da'vo bilan boshlanadigan band: birinchi jumla 11 so'z. */
const para = (tag: string, n = 60) => `Bu ${tag} bandi asosiy fikrni aniq bayon qiladi va misol bilan asoslaydi. ${filler(n, tag)}.`;

function docOf(o: {
  context?: EssayContextId;
  kind?: EssayKindId;
  paras: string[];
  title?: string;
  pages?: number;
  model?: Partial<EssayModel>;
  epigraph?: string;
}): AcademicDoc {
  const context = o.context ?? "school_dtm";
  const pages = o.pages ?? 2;
  const values: FormValues = { topic: "Ona tilim — g‘ururim", pages: String(pages) };
  const meta = extractMeta(TOOL_BY_ID.essay, values);
  const blocks: Block[] = [
    ...(o.epigraph ? [{ kind: "quote" as const, text: o.epigraph }] : []),
    ...o.paras.map((text) => ({ kind: "p" as const, text })),
  ];
  const model: EssayModel = {
    v: 1,
    context,
    kind: o.kind ?? (context === "ielts_task2" ? "opinion" : context === "academic" ? "argumentative" : "reflective"),
    language: context === "ielts_task2" ? "en" : "uz",
    words: essayWords(context, { pages }),
    paragraphs: [],
    rubric: context === "school_dtm" ? "dtm24" : context === "academic" ? "academic100" : "ielts_band",
    ...(o.model ?? {}),
  };
  return {
    meta,
    titlePage: context === "academic",
    toc: false,
    sections: [{ id: "essay", title: o.title ?? "Ona tilim — g‘ururim", blocks }],
    essay: model,
  };
}

const rulesOf = (doc: AcademicDoc) => {
  const model = essayModelOf(doc);
  return ruleChecks({ doc, model, text: essayTextOf(doc, model) });
};
const levelOf = (doc: AcademicDoc, id: string) => rulesOf(doc).find((c) => c.id === id)?.level;
const checkOf = (doc: AcademicDoc, id: string) => rulesOf(doc).find((c) => c.id === id);

/** Maktab inshosi (2 varaq → 368–575 so'z) uchun oraliqqa tushadigan matn. */
const schoolParas = () => [para("kirish", 55), para("birinchi", 110), para("ikkinchi", 110), para("uchinchi", 110), para("xulosa", 55)];

/** Shaxsiy ovozli variant — maktab inshosida «person» bandi yashil bo'ladi. */
const personalParas = () => {
  const p = schoolParas();
  p[1] = `Menimcha ona tili insonning ichki dunyosini ochadigan kalitdir. ${filler(105, "birinchi")}.`;
  return p;
};

/* ────────────────────────── qoidalar ────────────────────────── */

test("yaxshi insho — barcha asosiy qoidalar yashil", () => {
  const doc = docOf({ paras: personalParas() });
  const checks = rulesOf(doc);
  const bad = checks.filter((c) => c.level !== "green").map((c) => `${c.id}:${c.detail}`);
  assert.deepEqual(bad, [], `yashil bo'lmagan bandlar: ${bad.join(" | ")}`);
  assert.deepEqual(
    checks.map((c) => c.id).sort(),
    ["filler", "paragraphs", "person", "repetition", "title", "unsourcedNumbers", "words"].sort(),
  );
});

test("words — hajm oralig'i, tuzatish ko'rsatmasi bilan", () => {
  const short = docOf({ paras: [para("kirish", 20), para("tana", 30), para("xulosa", 20)] });
  const c = checkOf(short, "words");
  assert.equal(c?.level, "red");
  assert.match(c?.detail ?? "", /kerak 368–575/);
  assert.equal(c?.fix?.target, "essay");
  assert.match(c?.fix?.instruction ?? "", /Expand the essay/);

  const long = docOf({ paras: [para("a", 300), para("b", 300), para("c", 300), para("d", 300)] });
  assert.equal(levelOf(long, "words"), "red");
  assert.match(checkOf(long, "words")?.fix?.instruction ?? "", /Condense/);
});

test("paragraphs — soni va kirish/xulosa ulushi 12–20 %", () => {
  // 3 band — maktab konteksti kamida 4 talab qiladi.
  const few = docOf({ paras: [para("kirish", 120), para("tana", 130), para("xulosa", 120)] });
  const c = checkOf(few, "paragraphs");
  assert.equal(c?.level, "red");
  assert.match(c?.detail ?? "", /kerak 4–9/);

  // Kirish juda katta (≈40 %) — ulush bandi sariq.
  const fatIntro = docOf({ paras: [para("kirish", 220), para("a", 60), para("b", 60), para("c", 60), para("xulosa", 55)] });
  const share = checkOf(fatIntro, "paragraphs");
  assert.equal(share?.level, "yellow");
  assert.match(share?.detail ?? "", /kirish \d+%/);
  assert.equal(share?.fix?.target, "intro");
});

test("thesisStatement — akademik esseda kirish oxiri aniq da'vo bo'lishi shart", () => {
  const long = (tag: string, n: number) => para(tag, n);
  const good = docOf({
    context: "academic",
    paras: [
      `Kitob o‘qish insonning fikrlash tarzini shakllantiradigan eng muhim mashg‘ulotlardan biridir. ${filler(70, "k")}. Muntazam kitob o‘qish o‘quvchining tanqidiy fikrlash va yozma nutq malakasini izchil rivojlantiradi.`,
      long("a", 140),
      long("b", 140),
      long("c", 140),
      `Shunday ekan kitob o‘qish malakasi maktab dasturining markaziy vazifasi bo‘lib qolishi kerak. ${filler(60, "x")}.`,
    ],
    pages: 3,
    model: { thesisStatement: "Muntazam kitob o‘qish o‘quvchining tanqidiy fikrlash va yozma nutq malakasini izchil rivojlantiradi." },
  });
  assert.equal(levelOf(good, "thesisStatement"), "green");

  // Savol bilan tugagan kirish — da'vo emas.
  const bad = docOf({
    context: "academic",
    paras: [`Kitob o‘qish nima beradi? ${filler(70, "k")}. Nima uchun kitob o‘qish kerak?`, long("a", 140), long("b", 140), long("c", 140), long("x", 60)],
    pages: 3,
  });
  const c = checkOf(bad, "thesisStatement");
  assert.equal(c?.level, "red");
  assert.equal(c?.fix?.target, "intro");
  assert.match(c?.fix?.instruction ?? "", /thesis statement/i);

  // Maktab inshosida bunday qoida umuman yo'q.
  assert.equal(levelOf(docOf({ paras: schoolParas() }), "thesisStatement"), undefined);
});

test("topicSentences — har tana bandi da'vo bilan boshlanadi", () => {
  const paras = [para("kirish", 80), `Nega shunday? ${filler(120, "a")}.`, para("b", 140), para("c", 140), para("xulosa", 80)];
  const doc = docOf({ context: "academic", paras, pages: 3 });
  const c = checkOf(doc, "topicSentences");
  assert.equal(c?.level, "yellow", "1/3 band — sariq");
  assert.match(c?.detail ?? "", /1\/3/);
  // Maktab inshosida qoida yo'q.
  assert.equal(levelOf(docOf({ paras: schoolParas() }), "topicSentences"), undefined);
});

test("filler — klişelar (neytral ro'yxat + insho klişelari) hisobga olinadi", () => {
  const paras = schoolParas();
  paras[0] = `Bugungi kunda ona tili masalasi juda dolzarb. ${filler(50, "kirish")}.`;
  const one = docOf({ paras: [...paras] });
  assert.equal(levelOf(one, "filler"), "yellow");
  assert.match(checkOf(one, "filler")?.detail ?? "", /bugungi kunda/);
  // DTM kontekstida izoh «ijodiylik» ga ta'sirini aytadi.
  assert.match(checkOf(one, "filler")?.detail ?? "", /ijodiylik/);

  paras[4] = `Xulosa qilib aytganda, ona tili — milliy boylik. ${filler(50, "xulosa")}.`;
  paras[2] = `Ma’lumki, til millat ko‘zgusidir. ${filler(105, "ikkinchi")}.`;
  const many = docOf({ paras });
  assert.equal(levelOf(many, "filler"), "red", "uchta va undan ko'p klişe — qizil");
  assert.match(checkOf(many, "filler")?.fix?.instruction ?? "", /cliché/i);
});

test("repetition — bandlar bir-birini takrorlasa ushlaydi", () => {
  const same = para("takror", 110);
  const doc = docOf({ paras: [para("kirish", 55), same, same, para("uchinchi", 110), para("xulosa", 55)] });
  const c = checkOf(doc, "repetition");
  assert.ok(c?.level === "yellow" || c?.level === "red", `takror ushlanmadi: ${c?.detail}`);
  assert.match(c?.detail ?? "", /2↔3/);
  assert.equal(levelOf(docOf({ paras: schoolParas() }), "repetition"), "green");
});

test("unsourcedNumbers — statistika faqat foydalanuvchi faktidan", () => {
  const paras = schoolParas();
  paras[1] = `Tadqiqotlarga ko‘ra yoshlarning 78 % i kitob o‘qimaydi. ${filler(100, "birinchi")}.`;
  const doc = docOf({ paras: [...paras] });
  const c = checkOf(doc, "unsourcedNumbers");
  assert.equal(c?.level, "red");
  assert.match(c?.detail ?? "", /78/);

  // O'sha raqam foydalanuvchi faktida bo'lsa — yashil.
  const withFacts = docOf({ paras: [...paras], model: { userFacts: "Sinfimizda o‘tkazgan so‘rovimda o‘quvchilarning 78 % i kitob o‘qimasligini aytdi." } });
  assert.equal(levelOf(withFacts, "unsourcedNumbers"), "green");

  assert.deepEqual(unsourcedStats("Bu yerda 12 % va 4,6 foiz bor", undefined), ["12 %", "4,6 foiz"]);
  assert.deepEqual(unsourcedStats("Bu yerda 12 % bor", "menda 12 % bor"), []);
});

test("person — kontekst talab qilgan shaxs", () => {
  // Akademik esse 3-shaxsda: «menimcha» sariq band beradi.
  const paras = [para("kirish", 80), `Menimcha bu masala juda muhim va uni hal qilish kerak. ${filler(130, "a")}.`, para("b", 140), para("c", 140), para("xulosa", 80)];
  const academic = docOf({ context: "academic", paras, pages: 3 });
  const c = checkOf(academic, "person");
  assert.equal(c?.level, "yellow");
  assert.match(c?.fix?.instruction ?? "", /third person/i);

  // Maktab inshosida aksincha: shaxsiy ovoz bo'lmasa sariq.
  assert.equal(levelOf(docOf({ paras: schoolParas() }), "person"), "yellow");
  assert.equal(levelOf(docOf({ paras: personalParas() }), "person"), "green");
});

test("epigraph va workQuote — adabiy inshoda asar va iqtibos", () => {
  const paras = schoolParas();
  const noWork = docOf({ kind: "literary", paras });
  assert.equal(levelOf(noWork, "epigraph"), "yellow", "epigraf yo'q — sariq");
  assert.equal(levelOf(noWork, "workQuote"), "yellow");
  assert.match(checkOf(noWork, "workQuote")?.detail ?? "", /Asar nomi berilmagan/);

  const quoted = [...paras];
  quoted[1] = `«Alpomish» dostonida qahramonlik g‘oyasi markazda turadi va bu fikr butun asar davomida rivojlanadi. «Alpomish, alpomish, yurtga qaytgil, elga qaytgil», deyiladi asarda. ${filler(90, "birinchi")}.`;
  const good = docOf({
    kind: "literary",
    paras: quoted,
    epigraph: "So‘z — qalb kaliti — Alisher Navoiy",
    model: { workTitle: "Alpomish", epigraph: { text: "So‘z — qalb kaliti", author: "Alisher Navoiy" } },
  });
  assert.equal(levelOf(good, "epigraph"), "green");
  assert.equal(levelOf(good, "workQuote"), "green");
  // Epigraf band sifatida sanalmaydi.
  const model = essayModelOf(good);
  assert.equal(essayTextOf(good, model).paragraphs.length, 5);
  assert.ok(essayTextOf(good, model).epigraph?.includes("qalb kaliti"));
});

test("linking — IELTS da kamida 3 xil bog'lovchi", () => {
  const en = (tag: string, n: number) => `This paragraph states a clear claim about the topic and supports it with one example. ${filler(n, tag)}.`;
  const poor = docOf({ context: "ielts_task2", paras: [en("a", 45), en("b", 70), en("c", 70), en("d", 45)] });
  const c = checkOf(poor, "linking");
  assert.equal(c?.level, "red");
  assert.match(c?.fix?.instruction ?? "", /cohesive devices/);

  const rich = docOf({
    context: "ielts_task2",
    paras: [`${en("a", 40)} However, the picture is more complex.`, `${en("b", 60)} Moreover, the evidence is clear.`, `${en("c", 60)} For instance, many schools report this.`, `${en("d", 35)} In conclusion, the benefits outweigh the costs.`],
  });
  assert.equal(levelOf(rich, "linking"), "green");
  // Boshqa kontekstlarda bu qoida yo'q.
  assert.equal(levelOf(docOf({ paras: schoolParas() }), "linking"), undefined);
});

test("title — sarlavha bor va jumla emas", () => {
  assert.equal(levelOf(docOf({ paras: schoolParas(), title: "" }), "title"), "red");
  assert.equal(levelOf(docOf({ paras: schoolParas(), title: "Ona tilim mening g‘ururim va iftixorimdir, chunki u meni xalqim bilan bog‘laydi." }), "title"), "yellow");
  assert.equal(levelOf(docOf({ paras: schoolParas() }), "title"), "green");
});

/* ────────────────────────── baholovchi va ball ────────────────────────── */

const judgeStub = (payload: object) =>
  (async (role: LlmRole) => (role === "judge" ? { text: JSON.stringify(payload) } : null)) as never;

test("baholovchi ballari hisobotga tushadi; IELTS da band ko'rinadi", async () => {
  const doc = docOf({ context: "ielts_task2", paras: [para("a", 60), para("b", 90), para("c", 90), para("d", 60)] });
  const review = await reviewEssay(doc, { complete: judgeStub({ tr: 2, cc: 2, lr: 1, gra: 3, notes: ["extend the second idea"], fixes: [{ target: "essay", instruction: "Develop the second body paragraph with one concrete example." }] }) });
  const tr = review.checks.find((c) => c.id === "judge:tr");
  assert.equal(tr?.detail, "Band 7 · 2/3");
  assert.equal(review.checks.find((c) => c.id === "judge:lr")?.detail, "Band 6 · 1/3");
  assert.ok(review.judgeNotes.includes("extend the second idea"));
  assert.ok(review.checks.some((c) => c.id === "judge:fix:1" && c.fix?.target === "essay"));
  assert.ok(review.score > 0 && review.score <= 100);
});

test("baholovchi javob bermasa — izoh va neytral ball; DTM izohi doim bor", async () => {
  const doc = docOf({ paras: schoolParas() });
  const review: DocReview = await reviewEssay(doc, { complete: (async () => null) as never });
  assert.ok(review.judgeNotes.includes("Baholovchi javob bermadi"));
  assert.ok(review.judgeNotes.some((n) => /TAXMINIY/.test(n)), "X-8 paneli izohi");
  assert.ok(review.checks.some((c) => c.id === "judge:content"));
  assert.equal(review.verifiedShare, 1, "inshoda manba yo'q");
});

test("«Sizdan kutiladi» — adabiy asar va o'z dalillari", async () => {
  const doc = docOf({ kind: "literary", paras: schoolParas() });
  const review = await reviewEssay(doc, { judge: false });
  const needs = essayUserNeeds(review, doc);
  assert.deepEqual(needs.map((n) => n.id).sort(), ["epigraph", "work"]);
  assert.match(needs.find((n) => n.id === "work")?.hint ?? "", /o‘ylab topmaydi/);
});

test("yordamchilar: jumla ajratish va da'vo tekshiruvi", () => {
  assert.deepEqual(sentencesOf("Birinchi jumla. Ikkinchi jumla! Uchinchi?"), ["Birinchi jumla.", "Ikkinchi jumla!", "Uchinchi?"]);
  assert.ok(isClaimSentence("Bu jumla yetarlicha uzun va aniq da'voni bayon qiladi."));
  assert.ok(!isClaimSentence("Nima uchun bu shunday bo'ladi va nega biz buni o'ylashimiz kerak?"));
  assert.ok(!isClaimSentence("Juda qisqa."));
});
