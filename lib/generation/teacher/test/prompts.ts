/**
 * TEST PROMPTLARI (AUDIT-20 WP-B).
 *
 * Tizim prompti INGLIZCHA (`work/prompts.ts`, `article/prompts.ts` bilan
 * bir xil qaror: ko'rsatmalar ingliz tilida barqarorroq bajariladi),
 * CHIQISH tili esa `languageDirective` bilan qat'iy belgilanadi — bu
 * ikkisi bir-biriga zid emas va `languagePurity` qoidasi buni tekshiradi.
 *
 * Tur qoidalari (`TYPE RULES`) — REYESTRDAN (`registry.ts guidance`):
 * promptda ikkinchi nusxa yozilmaydi, aks holda «bsb ochiq topshiriq»
 * qoidasi ikki joyda ajralib ketardi.
 *
 * Uch rejim (R3 §3.2):
 *   `topic`      — mavzu matnidan;
 *   `file`       — FAQAT yuklangan manbadan, har savolga `source.quote`
 *                  (10–25 so'z) — tekshiriladigan va'da (§3.8);
 *   `curriculum` — o'quv dasturidan ≤5 mavzu, har savolda `topicId`.
 */
import { languageDirective } from "../../i18n";
import { sourceBlock } from "../../prompts";
import type { DocMeta } from "../../types";
import { TEACHER_LIMITS, type TestDifficulty, type TestQuestionKind } from "../types";
import type { TestTypeSpec } from "../registry";
import type { TestInput } from "./input";

/** `curriculumBlock` uchun yengil shakl (`lib/curriculum.ts CurriculumTopic`). */
export type PromptTopic = { id: string; title: string; unit?: string };

const KIND_RULES: Record<TestQuestionKind, string> = {
  single: "single — exactly one correct option; `answer` is the 0-based index of the correct option.",
  multi: "multi — 2 or 3 correct options; `answer` is an array of 0-based indexes. Say in the stem how many are correct.",
  truefalse: "truefalse — no `options`; `answer` is the boolean true/false.",
  open: "open — no `options`; `answer` is the model solution, and `rubric` lists the marking steps with points.",
  match: "match — `options` holds the LEFT column first, then the RIGHT column; `answer` pairs them by index.",
};

const DIFFICULTY_WORD: Record<TestDifficulty, string> = {
  oson: "easy (recall / understanding)",
  orta: "medium (application / analysis)",
  qiyin: "hard (multi-step, analysis or judgement)",
};

/**
 * Yaxshi/yomon savol MISOLLARI — R3 §5 jadvalidan.
 *
 * Nega promptda: qoidani so'z bilan aytish yetmaydi («o'zak to'liq
 * savol bo'lsin»), model uni tushunmasligi mumkin. Jonli sinovda
 * misolsiz prompt «Fotosintez haqida nima deyish mumkin?» tipidagi
 * o'zaklarni beraverardi.
 */
const EXAMPLES = [
  "BAD:  «Fotosintez haqida nima deyish mumkin? A) Yashil o'simliklarda B) Yaxshi jarayon C) Hammasi to'g'ri D) Hech biri» — the stem is not a question, «hammasi to'g'ri» is banned, the options are not parallel.",
  "GOOD: «Fotosintez jarayonida o'simlik qaysi gazni yutadi? A) kislorod B) karbonat angidrid C) azot D) vodorod»",
  "BAD:  «Quyidagilardan qaysi biri to'g'ri emas? …» — the negation is invisible to the pupil.",
  "GOOD: «Quyidagilardan qaysi biri suvda eriMAYDI? …» — the negation is capitalised.",
  "BAD:  «Nyuton qonunini tushuntiring. (1 ball)» — an open task with no marking rubric cannot be marked.",
  "GOOD: «Nyutonning ikkinchi qonunini yozing; 2 kg jismga 6 N kuch ta'sir qilsa, tezlanishni toping.» rubric: formula 1, a = F/m 1, javob 3 m/s² 1 — jami 3 ball.",
];

/**
 * Tizim prompti — bir marta quriladi va HAR bo'lak so'rovida qayta
 * ishlatiladi (prompt keshi va barqarorlik uchun).
 */
export function testSystemPrompt(input: TestInput, spec: TestTypeSpec): string {
  const gradeLine = input.grade >= 1 ? `grade ${input.grade} (Uzbek general secondary school)` : "general secondary school";
  return [
    languageDirective(input.language),
    `You are an assessment specialist writing a classroom test for an Uzbek school teacher.`,
    `TEST TYPE: ${spec.label.en} · SUBJECT: ${input.subject || "from the topic"} · LEVEL: ${gradeLine}.`,
    "",
    "TYPE RULES:",
    ...spec.guidance.map((g) => `— ${g}`),
    "",
    "ITEM-WRITING RULES (Haladyna/Downing/Rodriguez 2002; DTM item format):",
    `— every stem is a complete, self-contained question of ${TEACHER_LIMITS.stemCharsMin}–${TEACHER_LIMITS.stemCharsMax} characters, answerable without reading the options;`,
    `— closed items carry EXACTLY ${input.optionCount} options, each at most ${TEACHER_LIMITS.optionChars} characters, mutually exclusive, grammatically parallel with the stem;`,
    "— NEVER write «hammasi to'g'ri», «yuqoridagilarning barchasi», «hech biri», «A va B» or their translations as an option;",
    "— the correct option must not be the longest or the most detailed one; distractors are real mistakes pupils of this grade make;",
    "— write negations in CAPITALS inside the word (eriMAYDI, EMAS, NOTO'G'RI);",
    "— never repeat the same fact in two items, and never ask two things in one stem;",
    "— every item carries a one-sentence explanation the teacher reads out when going through the answers;",
    "— decimal separator is a COMMA (3,14), as in Uzbek school practice.",
    "",
    "QUESTION KINDS ALLOWED:",
    ...input.kinds.map((k) => `— ${KIND_RULES[k]}`),
    "",
    "DIFFICULTY AND BLOOM:",
    "— `difficulty` is one of oson / orta / qiyin; `bloom` is one of remember, understand, apply, analyze, evaluate, create;",
    "— evaluate and create may appear ONLY in open tasks — a multiple-choice item cannot measure them reliably;",
    "— difficulty and bloom must agree: oson → remember/understand, orta → apply/analyze, qiyin → analyze/evaluate/create.",
    "",
    "EXAMPLES:",
    ...EXAMPLES,
    "",
    "Answer with JSON only: {\"questions\":[{…}]} — no prose, no markdown fence.",
  ].join("\n");
}

export type QuestionsAsk = {
  /** Shu bo'lakda nechta savol so'ralmoqda. */
  n: number;
  /** Bo'lakning qiyinlik buyurtmasi (R3 §3.5 taqsimotidan). */
  mix: Record<TestDifficulty, number>;
  /** Shu bo'lakdagi ochiq topshiriqlar soni. */
  open: number;
  /** Oldingi bo'laklarda yozilgan o'zaklar — TAKRORLANMASIN. */
  avoid: string[];
  /** Nechanchi savoldan boshlanadi (raqamlash izchil bo'lsin). */
  from: number;
};

/**
 * Fayl rejimining «faqat manbadan» bloki.
 *
 * Umumiy `sourceBlock` (manbani promptga qo'yish) QAYTA ishlatiladi;
 * bu yerda faqat TEST uchun qo'shimcha shart bor — har savol iqtibos
 * bilan qaytadi va iqtibos manbada topilmasa savol o'chiriladi
 * (`questions.ts`, `sourceGrounded` qoidasi).
 */
export function testSourceBlock(meta: DocMeta): string {
  const base = sourceBlock(meta);
  if (!base) return "";
  return [
    base,
    "",
    "SOURCE MODE — HARD RULE:",
    "— every item must be answerable from the source text ALONE; do not use outside knowledge;",
    `— every item carries \`source.quote\`: ${TEACHER_LIMITS.quoteWordsMin}–${TEACHER_LIMITS.quoteWordsMax} words copied VERBATIM from the source text above (no paraphrase, no ellipsis);`,
    "— if you cannot find a verbatim quote for an item, do not write that item at all;",
    "— `source.section` names the heading the quote came from, when the source has headings.",
  ].join("\n");
}

/**
 * Darslik rejimi bloki — o'quv dasturidan ≤5 mavzu.
 *
 * `topicId` MAJBURIY: `curriculumCoverage` qoidasi har tanlangan
 * mavzuga kamida bitta savol tushganini shu maydon bilan tekshiradi.
 */
export function curriculumBlock(topics: readonly PromptTopic[]): string {
  const list = topics.slice(0, TEACHER_LIMITS.curriculumTopicsMax);
  if (!list.length) return "";
  return [
    "CURRICULUM MODE — the items come from the official programme topics below, nothing else:",
    ...list.map((t) => `— [${t.id}] ${t.title}${t.unit ? ` (${t.unit})` : ""}`),
    "— every item carries `topicId` — the identifier in square brackets of the topic it tests;",
    "— every listed topic gets at least one item; spread the items evenly across the topics.",
  ].join("\n");
}

/** Bo'lak so'rovi — savollarni 10 talab so'raymiz (`mapPool(2)`). */
export function questionsUserPrompt(input: TestInput, ask: QuestionsAsk, blocks: { source?: string; curriculum?: string }): string {
  const mix = Object.entries(ask.mix)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} × ${DIFFICULTY_WORD[k as TestDifficulty]}`)
    .join(", ");
  const closed = ask.n - ask.open;
  return [
    input.mode === "topic" ? `TOPIC: «${input.topic}»` : input.mode === "file" ? `TOPIC (for the heading only): «${input.topic}»` : `SUBJECT: ${input.subject}`,
    `Write ${ask.n} items, numbered ${ask.from}…${ask.from + ask.n - 1} in your head (the JSON is a plain list).`,
    `Difficulty for this batch: ${mix || `${ask.n} × medium`}.`,
    ask.open > 0 ? `Of these, ${ask.open} are OPEN tasks with a marking rubric and ${closed} are closed items.` : `All ${ask.n} items are closed.`,
    `Allowed kinds: ${input.kinds.join(", ")}.`,
    ask.avoid.length ? `ALREADY WRITTEN — do not repeat these facts or rephrase these stems:\n${ask.avoid.map((a) => `— ${a}`).join("\n")}` : "",
    blocks.curriculum ?? "",
    blocks.source ?? "",
    input.extra ? `TEACHER'S EXTRA REQUEST: ${input.extra}` : "",
    "",
    "JSON shape:",
    '{"questions":[{"kind":"single","stem":"…","options":["…","…","…","…"],"answer":1,"difficulty":"orta","bloom":"apply","explanation":"…","points":1' +
      (input.mode === "file" ? ',"source":{"quote":"…","section":"…"}' : "") +
      (input.mode === "curriculum" ? ',"topicId":"…"' : "") +
      ',"rubric":[{"text":"…","points":2}]}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Ko'rsatma matni (hujjatdagi 3–5 qator) — LLM dan emas, DVIGATELDAN. */
export function instructionLines(input: TestInput, questionCount: number, total: number, openCount: number): string[] {
  const lines = [
    `Testda jami ${questionCount} ta topshiriq bor, ishlash vaqti — ${input.timeMin} daqiqa.`,
    `Har savolda faqat BITTA to'g'ri javob belgilanadi; jami ${total} ball to'plash mumkin.`,
  ];
  if (openCount > 0) lines.push(`Ochiq topshiriqlar javobi ajratilgan joyga to'liq yozib boriladi — yechim qadamlari ham baholanadi.`);
  if (input.omr) lines.push(`Javoblar alohida javoblar varag'iga ko'chiriladi: doira to'liq bo'yaladi, ko'k siyohli ruchka ishlatiladi.`);
  lines.push(`Ish daftar chetiga yozilmaydi; o'chirg'ich bilan tuzatilgan javob hisobga olinmaydi.`);
  return lines.slice(0, TEACHER_LIMITS.instructionsMax);
}

/**
 * HALOLLIK izohi (R3 §4.3.1) — hujjat oxirida DOIM turadi.
 *
 * Rasmiy BSB/ChSB topshiriqlari Pedagogik mahorat markazi tomonidan
 * maxfiy tarzda yetkaziladi (248-son buyruq, 5-band), ya'ni biz ularni
 * tuza olmaymiz. Shuning uchun mahsulot «BSB USLUBIDA» deydi va hujjat
 * buni o'quvchi ham, tekshiruvchi ham ko'radigan joyda yozadi.
 */
export function honestyNote(type: string): string {
  const official =
    "Ushbu material o'qituvchi tomonidan tuzilgan yordamchi nazorat materiali. Rasmiy BSB/ChSB topshiriqlari Pedagogik mahorat va xalqaro baholash markazi tomonidan taqdim etiladi (MMTV 2023-yil 16-avgustdagi 248-son buyrug'i, 5-band).";
  const dtm =
    "Ushbu material o'qituvchi tomonidan DTM uslubida tuzilgan mashq materiali. Bu haqiqiy kirish imtihoni savollari emas.";
  return type === "dtm" ? dtm : official;
}
