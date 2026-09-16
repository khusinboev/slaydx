/**
 * INSHO REYESTRI (AUDIT-19 WP-D) — kontekst × tur.
 *
 * `article/types-registry.ts` naqshi: bitta ma'lumot manbasi uch joyga
 * xizmat qiladi — (1) promptlar (`prompts.ts` RULES / TYPE RULES),
 * (2) tayyorlik hisoboti qoidalari (`review.ts`), (3) forma galereyasi
 * (WP-E `EssayComposer`). Dvigatel bu yerdan tashqarida hech qanday
 * janr qoidasi SAQLAMAYDI.
 *
 * Hajm ham shu yerda (`essayWords`) — YAGONA formula: maktab konteksti
 * varaq bilan (`pages` chipi, narx o'zgarmaydi), akademik esse va IELTS
 * so'z bilan o'lchanadi. Hisobot, prompt va sayqal bir xil oraliqni
 * ko'radi.
 */
import type { JudgeSpec } from "../report/types";
import {
  ACADEMIC_CRITERIA,
  DTM_CRITERIA,
  ESSAY_CONTEXT_IDS,
  ESSAY_KIND_IDS,
  ESSAY_LIMITS,
  IELTS_CRITERIA,
  type EssayContextId,
  type EssayJudgeCriterion,
  type EssayKindId,
  type EssayRubricId,
  type EssayWords,
} from "./types";

/* ────────────────────────── tiplar ────────────────────────── */

export type EssayLang = "uz" | "ru" | "en";
export type EssayPerson = "first" | "third";
/** Iqtibos siyosati: umuman yo'q / faqat foydalanuvchi bergan asardan. */
export type EssayCitations = "none" | "work_only";
export type EssayEpigraphPolicy = "optional" | "none";

export type EssayKindSpec = {
  id: EssayKindId;
  label: Record<EssayLang, string>;
  hint: string;
  /** Promptdagi TYPE RULES (inglizcha, 3–5 qator). */
  guidance: string[];
  /** Kontekst standartini bekor qiladi (adabiy insho — epigraf/asar iqtibosi). */
  epigraph?: EssayEpigraphPolicy;
  citations?: EssayCitations;
  /** Adabiy tahlil: asar nomi so'raladi. */
  needsWork?: boolean;
};

/**
 * Baholovchi spetsifikatsiyasi. Mezonlar ro'yxati kontekstga qarab
 * TURLICHA (DTM 5, akademik 5, IELTS 4), shuning uchun neytral
 * `JudgeSpec<C>` ning `Record<C, …>` maydonlari shu yerda faqat O'Z
 * mezonlari bilan to'ldiriladi va bir marta kengaytiriladi: neytral
 * qatlam (`report/judge.ts`) FAQAT `criteria` dagi kalitlarni o'qiydi.
 */
export type EssayJudgeSpec = JudgeSpec<EssayJudgeCriterion>;

type NarrowSpec = {
  criteria: readonly EssayJudgeCriterion[];
  describe: Partial<Record<EssayJudgeCriterion, string>>;
  labels: Partial<Record<EssayJudgeCriterion, string>>;
  roleLine: string;
  typeNoun: string;
};

const asSpec = (s: NarrowSpec): EssayJudgeSpec => s as EssayJudgeSpec;

export type EssayContextSpec = {
  id: EssayContextId;
  label: Record<EssayLang, string>;
  hint: string;
  /** Ruxsat etilgan tillar (IELTS — faqat ingliz). */
  languages: readonly EssayLang[];
  /** Hajm varaq bilan (`pages` chipi) yoki so'z bilan o'lchanadimi. */
  sizing: "pages" | "words";
  /** `sizing: "words"` uchun ruxsat etilgan so'z oralig'i va standarti. */
  wordRange?: { min: number; max: number; aim: number };
  paragraphs: { min: number; max: number };
  /** Kirish/xulosa ulushi (butun insho so'zidan). */
  introShare: [number, number];
  conclusionShare: [number, number];
  /** Kirishning oxirgi jumlasi — aniq da'vo (majburiy). */
  thesisStatement: boolean;
  /** Har tana bandi topic sentence bilan boshlanadi. */
  topicSentences: boolean;
  epigraph: EssayEpigraphPolicy;
  citations: EssayCitations;
  person: EssayPerson;
  /** Titul varaq (OTM akademik esse — GOST talabi). */
  titlePage: boolean;
  rubric: EssayRubricId;
  judge: EssayJudgeSpec;
  kinds: Partial<Record<EssayKindId, EssayKindSpec>>;
};

/* ────────────────────────── bog'lovchi so'zlar (IELTS) ────────────────────────── */

/**
 * IELTS Coherence & Cohesion — matnda kamida 3 xil bog'lovchi. Ro'yxat
 * qisqa va aniq: keng qolip («and», «but») har matnda uchrab, qoidani
 * ma'nosiz qilardi.
 */
export const IELTS_LINKERS: readonly string[] = [
  "however",
  "moreover",
  "furthermore",
  "in addition",
  "therefore",
  "consequently",
  "nevertheless",
  "on the other hand",
  "for instance",
  "for example",
  "in contrast",
  "as a result",
  "firstly",
  "secondly",
  "finally",
  "in conclusion",
  "overall",
  "to sum up",
];

/* ────────────────────────── turlar ────────────────────────── */

const K = (
  id: EssayKindId,
  label: Record<EssayLang, string>,
  hint: string,
  guidance: string[],
  o: Partial<Pick<EssayKindSpec, "epigraph" | "citations" | "needsWork">> = {},
): EssayKindSpec => ({ id, label, hint, guidance, ...o });

/* ── maktab / DTM ── */

const SCHOOL_KINDS: Partial<Record<EssayKindId, EssayKindSpec>> = {
  reflective: K(
    "reflective",
    { uz: "Mulohazali insho", ru: "Сочинение-рассуждение", en: "Reflective essay" },
    "Muammo qo‘yiladi, o‘z fikri dalillanadi, shaxsiy xulosa chiqariladi",
    [
      "Reflective school essay: open with the question or moral problem the topic raises, then develop the author's own reasoning step by step — each body paragraph one thought, supported by an example from life, literature or history.",
      "The voice is personal and sincere (first person), but the reasoning must be concrete: no slogans, no praise of the topic in general terms.",
      "The conclusion states what the author personally concluded — it must NOT repeat the introduction in other words.",
    ],
  ),
  descriptive: K(
    "descriptive",
    { uz: "Tavsiflovchi insho", ru: "Сочинение-описание", en: "Descriptive essay" },
    "Manzara, inson yoki holat his-tuyg‘u va tafsilot bilan tasvirlanadi",
    [
      "Descriptive school essay: build the picture from concrete sensory detail — what is seen, heard, smelled, felt — instead of naming emotions directly («ajoyib», «go‘zal» alone are not description).",
      "Move through the description in a clear order (far → near, morning → evening, whole → detail) so the reader can follow it.",
      "Use figurative language (comparison, epithet, personification) sparingly but at least once per paragraph; keep every sentence grammatical.",
      "Close with the feeling or thought the described scene leaves behind — one short, quiet paragraph.",
    ],
  ),
  generalizing: K(
    "generalizing",
    { uz: "Umumlashtiruvchi insho", ru: "Обобщающее сочинение", en: "Generalizing essay" },
    "Bir necha asar, davr yoki hodisa umumlashtirilib, umumiy xulosa chiqariladi",
    [
      "Generalizing school essay: gather several cases (works, periods, people, events) that belong to the topic and show what they have IN COMMON — the common idea is the backbone of the text.",
      "Each body paragraph presents one case and immediately ties it to the common idea; do not retell the case for its own sake.",
      "The conclusion formulates the generalization as one clear statement and notes its significance today.",
    ],
  ),
  argumentative: K(
    "argumentative",
    { uz: "Argumentli insho", ru: "Аргументативное сочинение", en: "Argumentative essay" },
    "Tezis — dalil — qarshi fikr — xulosa zanjiri",
    [
      "Argumentative school essay: state the thesis (the author's position) explicitly at the end of the introduction — one sentence, arguable, not a definition.",
      "Each body paragraph gives ONE argument with evidence (example, fact, quotation) and explains how the evidence supports the thesis.",
      "One paragraph must present the OPPOSING view honestly and then answer it — an argumentative essay without a counter-argument is incomplete.",
      "The conclusion returns to the thesis and states what follows from it; it introduces no new argument.",
    ],
  ),
  literary: K(
    "literary",
    { uz: "Adabiy insho (asar tahlili)", ru: "Сочинение по литературе", en: "Literary essay" },
    "Epigraf, asardan iqtibos, obraz va muallif uslubi tahlili",
    [
      "Literary school essay: the subject is the WORK — its idea, its characters and the author's craft, not the pupil's general opinion about life.",
      "Open with an epigraph when one is given (quotation + its author on a separate line), then name the work and the author in the first paragraph.",
      "Quote the work only from the passage the user supplied — quote it verbatim in «…» and analyse it (what the image means, how the language works); NEVER invent a quotation, a character, a line number or a plot detail.",
      "Analyse at least one character and one feature of the author's style (imagery, epithets, composition, tone); end with what the work says to today's reader.",
    ],
    { epigraph: "optional", citations: "work_only", needsWork: true },
  ),
};

/* ── OTM akademik esse ── */

const ACADEMIC_KINDS: Partial<Record<EssayKindId, EssayKindSpec>> = {
  argumentative: K(
    "argumentative",
    { uz: "Argumentli esse", ru: "Аргументативное эссе", en: "Argumentative essay" },
    "Tezis, dalillar, qarshi dalilga javob, xulosa",
    [
      "Academic argumentative essay: the introduction moves from a general context sentence to a narrow, arguable THESIS STATEMENT as its last sentence.",
      "Every body paragraph opens with a topic sentence that states the claim of that paragraph, then supports it with reasoning and evidence, then links back to the thesis.",
      "Include one paragraph that states the strongest counter-argument fairly and refutes it with reasoning.",
      "Register is formal and impersonal (no «I think»); claims are hedged where appropriate («suggests», «is likely to», «tends to»).",
    ],
  ),
  expository: K(
    "expository",
    { uz: "Tushuntiruvchi esse", ru: "Объяснительное эссе", en: "Expository essay" },
    "Tushuncha yoki jarayon tahlil qilinib, tushuntiriladi",
    [
      "Expository academic essay: explain the concept, mechanism or process — the aim is understanding, not persuasion, so no advocacy language.",
      "The thesis statement announces WHAT will be explained and along which dimensions; each body paragraph covers one dimension with a topic sentence.",
      "Define technical terms on first use and illustrate each abstract point with a concrete, plausible example that is clearly labelled as an example.",
      "The conclusion synthesises the explanation (how the parts fit together) rather than repeating it.",
    ],
  ),
  compare_contrast: K(
    "compare_contrast",
    { uz: "Taqqoslovchi esse", ru: "Сравнительное эссе", en: "Compare & contrast essay" },
    "Ikki hodisa aniq mezonlar bo‘yicha taqqoslanadi",
    [
      "Compare-and-contrast academic essay: name the two subjects and the CRITERIA of comparison in the thesis statement.",
      "Use point-by-point organisation: each body paragraph takes ONE criterion and treats both subjects within it (not one subject per half of the essay).",
      "Make both similarities and differences explicit with comparative language (whereas, by contrast, similarly, unlike).",
      "The conclusion states what the comparison shows — which subject is stronger on which criterion, or what the comparison reveals about both.",
    ],
  ),
  problem_solution: K(
    "problem_solution",
    { uz: "Muammo–yechim essesi", ru: "Эссе «проблема — решение»", en: "Problem–solution essay" },
    "Muammo, sabablari, yechim va uning amaliyligi",
    [
      "Problem–solution academic essay: the thesis statement names the problem and previews the proposed solution(s).",
      "Analyse causes and consequences before proposing anything — a solution paragraph that does not answer a stated cause is off-target.",
      "Each proposed solution is evaluated: how it works, who implements it, what it costs or limits it faces; do not promise outcomes the essay cannot support.",
      "The conclusion states which solution is the most feasible and why, without adding new proposals.",
    ],
  ),
  literary: K(
    "literary",
    { uz: "Adabiy tahlil essesi", ru: "Литературоведческое эссе", en: "Literary analysis essay" },
    "Asar matni tahlili — tezis, iqtibos, izoh",
    [
      "Academic literary analysis: the thesis statement makes an interpretive claim about the work (what it means or how it achieves its effect), not a summary of the plot.",
      "Each body paragraph: topic sentence (the claim) → the quotation from the supplied passage → close analysis of the language → link back to the thesis.",
      "Quote ONLY from the passage the user supplied, verbatim in «…»; never invent lines, characters, dates or scholarly opinions.",
      "Use the present tense for the action of the work and formal, impersonal register throughout.",
    ],
    { citations: "work_only", needsWork: true },
  ),
};

/* ── IELTS Writing Task 2 ── */

const IELTS_KINDS: Partial<Record<EssayKindId, EssayKindSpec>> = {
  opinion: K(
    "opinion",
    { uz: "Opinion (fikr bildirish)", ru: "Opinion (мнение)", en: "Opinion (agree/disagree)" },
    "«To what extent do you agree?» — aniq pozitsiya, 2 tana bandi",
    [
      "IELTS Task 2 opinion essay: take a CLEAR position in the introduction (fully agree / partly agree / disagree) and keep it consistent to the last sentence.",
      "Write exactly two body paragraphs, each with one main idea, an explanation and one specific example; do not add a third idea.",
      "Use a range of cohesive devices (however, moreover, as a result, for instance) but do not start every sentence with one.",
      "Hedge claims appropriately (may, tends to, is likely to) and avoid absolute statements; the conclusion restates the position in different words.",
    ],
  ),
  discussion: K(
    "discussion",
    { uz: "Discussion (ikki qarash)", ru: "Discussion (обе точки зрения)", en: "Discuss both views" },
    "«Discuss both views and give your own opinion» — har qarashga bir band",
    [
      "IELTS Task 2 discussion essay: the introduction paraphrases the prompt, announces that both views will be discussed, and states the writer's own opinion.",
      "Body paragraph 1 presents the first view with its reasons; body paragraph 2 presents the second view; both must be presented fairly, whatever the writer's own opinion is.",
      "The writer's own opinion must appear in the introduction AND the conclusion — an essay that only reports the two views loses Task Response marks.",
      "Use contrastive cohesion between the paragraphs (on the other hand, by contrast, while).",
    ],
  ),
  problem_solution: K(
    "problem_solution",
    { uz: "Problem–solution / cause–solution", ru: "Проблема — решение", en: "Problem & solution" },
    "Sabab/muammo bir bandda, yechim ikkinchisida",
    [
      "IELTS Task 2 problem-and-solution essay: paragraph 1 explains the problem or its causes, paragraph 2 proposes solutions that directly answer those causes.",
      "Each solution names WHO acts (governments, schools, individuals) and HOW it works — vague calls to «raise awareness» score low.",
      "Give one concrete example or consequence per paragraph; invented statistics score no better than none, so stay qualitative.",
      "The conclusion summarises the problem and the main solution in one or two sentences.",
    ],
  ),
  advantages_disadvantages: K(
    "advantages_disadvantages",
    { uz: "Advantages & disadvantages", ru: "Преимущества и недостатки", en: "Advantages & disadvantages" },
    "Ijobiy va salbiy tomonlar, so‘ralsa — qay biri ustun",
    [
      "IELTS Task 2 advantages/disadvantages essay: one body paragraph for the advantages, one for the disadvantages, each with one developed main idea and an example.",
      "If the prompt asks whether the advantages outweigh the disadvantages, answer that question explicitly in the introduction and the conclusion.",
      "Balance the two paragraphs in length; an essay that lists five short points instead of developing two is penalised for underdevelopment.",
      "Use comparative and concessive language (although, whereas, outweigh, on balance).",
    ],
  ),
  double_question: K(
    "double_question",
    { uz: "Double question (ikki savol)", ru: "Два вопроса", en: "Two-part question" },
    "Promptdagi ikki savolning har biriga alohida band",
    [
      "IELTS Task 2 two-part question essay: identify BOTH questions in the prompt and answer each in its own body paragraph — a missing answer caps Task Response.",
      "The introduction paraphrases the prompt and previews both answers in one sentence.",
      "Each body paragraph: direct answer → reason → example; do not merge the two questions into one discussion.",
      "The conclusion restates both answers briefly, in different wording from the introduction.",
    ],
  ),
};

/* ────────────────────────── kontekstlar ────────────────────────── */

export const ESSAY_CONTEXTS: Record<EssayContextId, EssayContextSpec> = {
  school_dtm: {
    id: "school_dtm",
    label: { uz: "Maktab / DTM inshosi", ru: "Школьное сочинение (DTM)", en: "School essay (DTM)" },
    hint: "Maktab bitiruv va DTM inshosi — mulohazali, tavsiflovchi, umumlashtiruvchi, argumentli, adabiy tahlil",
    languages: ["uz"],
    sizing: "pages",
    paragraphs: { min: 4, max: 9 },
    introShare: [0.12, 0.2],
    conclusionShare: [0.12, 0.2],
    thesisStatement: false,
    topicSentences: false,
    epigraph: "none",
    citations: "none",
    person: "first",
    titlePage: false,
    rubric: "dtm24",
    judge: asSpec({
      criteria: DTM_CRITERIA,
      roleLine: "an experienced Uzbek language and literature examiner (DTM)",
      typeNoun: "essay type",
      describe: {
        content: "the topic is fully disclosed: the thoughts are the author's own, concrete and on-topic, with real examples rather than general praise.",
        structure: "introduction – body – conclusion are clearly separated, the paragraphs follow one another logically, the conclusion does not repeat the introduction.",
        language: "richness of language: varied vocabulary and sentence structure, figurative means used appropriately, no repeated words or clichés.",
        literacy: "literacy: grammatical, spelling and punctuation correctness, correct word order and agreement.",
        creativity: "originality: an individual voice, an unexpected angle or image — not a template essay that would fit any topic.",
      },
      labels: {
        content: "Mazmun (mavzuning ochilishi)",
        structure: "Tuzilma va mantiq",
        language: "Til boyligi",
        literacy: "Savodxonlik",
        creativity: "Ijodiylik",
      },
    }),
    kinds: SCHOOL_KINDS,
  },
  academic: {
    id: "academic",
    label: { uz: "OTM akademik esse", ru: "Академическое эссе (вуз)", en: "University academic essay" },
    hint: "500–1 000 so‘z, thesis statement + har bandda topic sentence, rasmiy uslub",
    languages: ["uz", "ru", "en"],
    sizing: "words",
    wordRange: { min: 500, max: 1000, aim: 700 },
    paragraphs: { min: 4, max: 8 },
    introShare: [0.12, 0.2],
    conclusionShare: [0.12, 0.2],
    thesisStatement: true,
    topicSentences: true,
    epigraph: "none",
    citations: "none",
    person: "third",
    titlePage: true,
    rubric: "academic100",
    judge: asSpec({
      criteria: ACADEMIC_CRITERIA,
      roleLine: "a university writing instructor grading an academic essay",
      typeNoun: "essay type",
      describe: {
        thesis: "the introduction ends with an explicit, arguable thesis statement and the whole essay serves it.",
        evidence: "each claim is supported by reasoning and concrete evidence or example; no unsupported generalisations.",
        structure: "every body paragraph has a topic sentence, one controlling idea and a link back to the thesis; the conclusion synthesises rather than repeats.",
        language: "formal academic register, precise vocabulary, appropriate hedging, varied sentence structure, no filler openers.",
        format: "paragraphing, length and the introduction/conclusion proportions match the requirements of an academic essay.",
      },
      labels: {
        thesis: "Tezis (thesis statement)",
        evidence: "Dalil va asoslash",
        structure: "Tuzilma (topic sentence)",
        language: "Akademik til",
        format: "Rasmiylashtirish va hajm",
      },
    }),
    kinds: ACADEMIC_KINDS,
  },
  ielts_task2: {
    id: "ielts_task2",
    label: { uz: "IELTS Writing Task 2", ru: "IELTS Writing Task 2", en: "IELTS Writing Task 2" },
    hint: "≥250 so‘z, TR/CC/LR/GRA band 1–9; kirish + 2 tana bandi + xulosa",
    languages: ["en"],
    sizing: "words",
    wordRange: { min: 250, max: 330, aim: 280 },
    paragraphs: { min: 4, max: 5 },
    introShare: [0.12, 0.2],
    conclusionShare: [0.12, 0.2],
    thesisStatement: true,
    topicSentences: true,
    epigraph: "none",
    citations: "none",
    person: "first",
    titlePage: false,
    rubric: "ielts_band",
    judge: asSpec({
      criteria: IELTS_CRITERIA,
      roleLine: "an IELTS examiner applying the official Writing Task 2 band descriptors",
      typeNoun: "essay type",
      describe: {
        tr: "Task Response: the prompt is fully addressed, the position is clear and consistent throughout, main ideas are extended and supported.",
        cc: "Coherence and Cohesion: logical paragraphing (one central idea per paragraph) and a range of cohesive devices used naturally, not mechanically.",
        lr: "Lexical Resource: range and precision of vocabulary, collocation, appropriate register; errors do not impede communication.",
        gra: "Grammatical Range and Accuracy: a variety of complex structures, with the majority of sentences error-free.",
      },
      labels: {
        tr: "Task Response",
        cc: "Coherence & Cohesion",
        lr: "Lexical Resource",
        gra: "Grammatical Range & Accuracy",
      },
    }),
    kinds: IELTS_KINDS,
  },
};

/* ────────────────────────── tanlov yordamchilari ────────────────────────── */

export function essayContextSpec(context: EssayContextId): EssayContextSpec {
  return ESSAY_CONTEXTS[context];
}

/** Noma'lum tur → kontekstning BIRINCHI turi (forma eskirgan bo'lsa ham hujjat chiqadi). */
export function essayKindSpec(context: EssayContextId, kind: EssayKindId): EssayKindSpec {
  const c = ESSAY_CONTEXTS[context];
  return c.kinds[kind] ?? c.kinds[ESSAY_KIND_IDS[context][0]]!;
}

/** Turga xos bekor qilish bilan: epigraf siyosati. */
export function essayEpigraphPolicy(context: EssayContextId, kind: EssayKindId): EssayEpigraphPolicy {
  return essayKindSpec(context, kind).epigraph ?? ESSAY_CONTEXTS[context].epigraph;
}

/** Turga xos bekor qilish bilan: iqtibos siyosati (adabiy — faqat asar). */
export function essayCitationPolicy(context: EssayContextId, kind: EssayKindId): EssayCitations {
  return essayKindSpec(context, kind).citations ?? ESSAY_CONTEXTS[context].citations;
}

/** Shu kontekstda til ruxsat etilganmi; yo'q bo'lsa birinchi ruxsat etilgan til. */
export function essayLanguage(context: EssayContextId, language: string): EssayLang {
  const c = ESSAY_CONTEXTS[context];
  const code = (language || "uz").slice(0, 2).toLowerCase() as EssayLang;
  return c.languages.includes(code) ? code : c.languages[0];
}

/* ────────────────────────── hajm ────────────────────────── */

/**
 * So'z byudjeti — YAGONA formula (prompt, hisobot va sayqal shundan).
 *
 *   school_dtm  varaq × 230 so'z; oraliq −20 % … +25 % (`lengthLine`
 *               bilan bir qaror: model o'zbek so'zini kam sanaydi).
 *   academic    so'z maqsadi 500–1 000 ga qisiladi; `wordTarget`
 *               berilmasa `pages × 250` (1 varaq ≈ 250 so'z).
 *   ielts_task2 qat'iy 250–330, mo'ljal 280 (rasmiy minimum 250).
 */
export function essayWords(context: EssayContextId, o: { pages?: number; wordTarget?: number } = {}): EssayWords {
  const c = ESSAY_CONTEXTS[context];
  const pages = Math.max(ESSAY_LIMITS.pagesMin, Math.min(ESSAY_LIMITS.pagesMax, Math.round(o.pages || 2)));
  if (c.sizing === "pages") {
    const aim = pages * ESSAY_LIMITS.wordsPerPage;
    return { aim, min: Math.round(aim * 0.8), max: Math.round(aim * 1.25) };
  }
  const r = c.wordRange!;
  // IELTS — chegara qat'iy, foydalanuvchi hajmi ta'sir qilmaydi.
  if (context === "ielts_task2") return { ...r };
  const want = o.wordTarget && o.wordTarget > 0 ? o.wordTarget : pages * ESSAY_LIMITS.academicWordsPerPage;
  const aim = Math.max(r.min, Math.min(r.max, Math.round(want)));
  return { aim, min: Math.max(r.min, Math.round(aim * 0.85)), max: Math.min(r.max, Math.round(aim * 1.15)) };
}

/** Kirish/xulosa uchun so'z oralig'i (ulushdan). */
export function essayEdgeWords(context: EssayContextId, words: EssayWords): { intro: [number, number]; conclusion: [number, number] } {
  const c = ESSAY_CONTEXTS[context];
  const span = (s: [number, number]): [number, number] => [Math.round(words.aim * s[0]), Math.round(words.aim * s[1])];
  return { intro: span(c.introShare), conclusion: span(c.conclusionShare) };
}

/** Tana bandlari soni (kirish va xulosadan tashqari) — reja uchun. */
export function essayBodyParagraphs(context: EssayContextId, words: EssayWords): number {
  const c = ESSAY_CONTEXTS[context];
  const bodyWords = words.aim * (1 - c.introShare[1] - c.conclusionShare[1]);
  const n = Math.round(bodyWords / 130);
  return Math.max(c.paragraphs.min - 2, Math.min(c.paragraphs.max - 2, Math.max(2, n)));
}

export { ESSAY_CONTEXT_IDS, ESSAY_KIND_IDS };
