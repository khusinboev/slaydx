/**
 * KIND × TUR REYESTRI (AUDIT-20 R0) — `work/registry.ts` naqshi.
 *
 * Reyestr — dvigatelning SPETSIFIKATSIYASI. To'rt joyda o'qiladi:
 * (1) promptlar (`teacher/prompts.ts` — «TYPE RULES» = `guidance`),
 * (2) dvigatel skeletga moslash (`engine.ts`, `test/engine.ts`),
 * (3) hisobot (`review.ts` — `rules` id lari va `judge`),
 * (4) forma (`TeacherComposer`, WP-E — `label`, `limits`).
 *
 * Manba: `docs/research/{lesson-plan,texnologik-xarita,glossary,keys,
 * test}.md` §3 «bizga tavsiya: reyestr» va §4 «sifat mezonlari».
 * Raqamlar shu hisobotlardan; ular bu yerda QULFLANADI
 * (`tests/teacher-registry.test.mts`).
 *
 * Har kind ro'yxatining BIRINCHI elementi — shu kindning STANDART turi
 * (noma'lum/bo'sh tur shunga tushadi, `teacherTypeOf`).
 */
import type { JudgeSpec } from "../report/types";
import {
  TEACHER_LIMITS,
  TEST_VARIANT_CHOICES,
  TEST_VARIANT_DEFAULT,
  type TeacherKind,
  type TestDifficulty,
  type TestQuestionKind,
  TEACHER_TOOL_IDS,
  isTeacherToolId,
} from "./types";

/* ══════════════════════════ umumiy shakl ══════════════════════════ */

export type TeacherLabel = { uz: string; ru: string; en: string };

type TypeBase<K extends TeacherKind> = {
  kind: K;
  id: string;
  label: TeacherLabel;
  /** Formadagi bir qatorli izoh (uz). */
  hint: string;
  /**
   * Hujjat SKELETI — bo'limlar tartibda (uz). `planTeacher` (WP-C) shu
   * ro'yxat bo'yicha chizadi, hisobot esa yo'q bo'limni ko'rsatadi.
   */
  skeleton: readonly string[];
  /** Yozish qoidalari (en, 3–5 qator) — tizim promptining «TYPE RULES» i. */
  guidance: readonly string[];
};

/* ══════════════════════════ baholovchi ══════════════════════════ */

const LESSON_JUDGE_ROLE = "an experienced school methodologist reviewing a teacher's lesson outline against everyday Uzbek school practice";
const MAP_JUDGE_ROLE = "a school methodologist checking a subject's yearly calendar-thematic plan before it is approved";
const GLOSSARY_JUDGE_ROLE = "a subject teacher checking a terminology glossary prepared for their own students";
const KEYS_JUDGE_ROLE = "a lecturer reviewing case-study materials prepared for a seminar";
const TEST_JUDGE_ROLE = "an assessment specialist reviewing a school test against standard item-writing rules";

export const LESSON_JUDGE_CRITERIA = ["topicAlignment", "timeRealism", "pedagogicalVariety", "ageFit", "homeworkRelevance"] as const;
export type LessonJudgeCriterion = (typeof LESSON_JUDGE_CRITERIA)[number];

const LESSON_JUDGE_LABELS: Record<LessonJudgeCriterion, string> = {
  topicAlignment: "Bosqichlarning mavzuga bog'liqligi",
  timeRealism: "Vaqt taqsimotining realligi",
  pedagogicalVariety: "Pedagogik xilma-xillik",
  ageFit: "Yosh/sinfga moslik",
  homeworkRelevance: "Uyga vazifaning maqsadga mosligi",
};

const LESSON_JUDGE_DESCRIBE: Record<LessonJudgeCriterion, string> = {
  topicAlignment: "does every stage connect to the stated topic with a concrete example, question or exercise rather than generic filler?",
  timeRealism: "are the per-stage minutes realistic for the activity described (no 2-minute «explain the new concept», no 20-minute greeting)?",
  pedagogicalVariety: "do the stages combine different interaction modes — teacher-led explanation, student practice, pair/group work, discussion — instead of repeating one pattern?",
  ageFit: "is the vocabulary and cognitive demand appropriate for the stated grade (1–11)?",
  homeworkRelevance: "does the homework directly reinforce the lesson's stated goal, and is it doable in the time a pupil of this grade has?",
};

export const MAP_JUDGE_CRITERIA = ["topicProgression", "methodDiversity", "hoursRealism", "controlFit", "subjectCoherence"] as const;
export type MapJudgeCriterion = (typeof MAP_JUDGE_CRITERIA)[number];

const MAP_JUDGE_LABELS: Record<MapJudgeCriterion, string> = {
  topicProgression: "Mavzular izchilligi",
  methodDiversity: "Metodlar xilma-xilligi",
  hoursRealism: "Soat taqsimotining realligi",
  controlFit: "Nazorat turining mavzuga mosligi",
  subjectCoherence: "Fan va sinfga muvofiqlik",
};

const MAP_JUDGE_DESCRIBE: Record<MapJudgeCriterion, string> = {
  topicProgression: "do topics move from simpler to more complex across the year/quarter, consistent with a spiral curriculum?",
  methodDiversity: "is there a believable mix of lecture, practice, laboratory and independent-work methods rather than one repeated label?",
  hoursRealism: "do hour allocations look proportionate to topic complexity instead of being uniformly identical?",
  controlFit: "does the control/assessment type plausibly match the topic and method (a laboratory topic gets a practical control, not a random label)?",
  subjectCoherence: "do all topics genuinely belong to the stated subject and grade level, with no unrelated filler?",
};

export const GLOSSARY_JUDGE_CRITERIA = ["definitionAccuracy", "levelFit", "termRelevance", "alphabeticalIntegrity", "exampleQuality"] as const;
export type GlossaryJudgeCriterion = (typeof GLOSSARY_JUDGE_CRITERIA)[number];

const GLOSSARY_JUDGE_LABELS: Record<GlossaryJudgeCriterion, string> = {
  definitionAccuracy: "Ta'riflarning aniqligi",
  levelFit: "Daraja/sinfga moslik",
  termRelevance: "Atamalarning fanga tegishliligi",
  alphabeticalIntegrity: "Ro'yxat butunligi (takror/yaqin shakl)",
  exampleQuality: "Misollarning sifati",
};

const GLOSSARY_JUDGE_DESCRIBE: Record<GlossaryJudgeCriterion, string> = {
  definitionAccuracy: "is each definition factually correct and specific to the stated subject/topic, not a vague generic sentence?",
  levelFit: "is the explanation depth appropriate for the stated grade or level (school vs university)?",
  termRelevance: "does every term genuinely belong to the subject/topic, not borrowed from an unrelated domain (generic pedagogy words in a biology glossary)?",
  alphabeticalIntegrity: "flag near-duplicates the deterministic check missed — singular/plural or spelling variants of the same concept listed twice.",
  exampleQuality: "does the example sentence use the term in a natural, subject-relevant context rather than restating the definition?",
};

export const KEYS_JUDGE_CRITERIA = ["situationRealism", "taskAlignment", "keyQuality", "rubricSpecificity", "levelFit"] as const;
export type KeysJudgeCriterion = (typeof KEYS_JUDGE_CRITERIA)[number];

const KEYS_JUDGE_LABELS: Record<KeysJudgeCriterion, string> = {
  situationRealism: "Vaziyatning aniqligi",
  taskAlignment: "Topshiriqlarning vaziyatga bog'liqligi",
  keyQuality: "Namunaviy kalit sifati",
  rubricSpecificity: "Rubrika mezonlarining aniqligi",
  levelFit: "Auditoriyaga moslik",
};

const KEYS_JUDGE_DESCRIBE: Record<KeysJudgeCriterion, string> = {
  situationRealism: "is the situation concrete (named roles, context, numbers where appropriate) rather than a generic «a company faced a problem» template?",
  taskAlignment: "do the tasks require applying this case's specific facts — could they be answered without reading the situation at all?",
  keyQuality: "does the model answer resolve the tasks with reasoning, instead of restating the situation?",
  rubricSpecificity: "are the rubric criteria specific to THIS case, not generic «correctness»/«clarity» that would fit any case?",
  levelFit: "is the complexity appropriate for the declared audience (senior school grades vs university)?",
};

export const TEST_JUDGE_CRITERIA = ["answerCorrectness", "clarity", "distractors", "coverage", "levelFit"] as const;
export type TestJudgeCriterion = (typeof TEST_JUDGE_CRITERIA)[number];

const TEST_JUDGE_LABELS: Record<TestJudgeCriterion, string> = {
  answerCorrectness: "Javoblar kalitining to'g'riligi",
  clarity: "Savol o'zaklarining aniqligi",
  distractors: "Distraktorlar sifati",
  coverage: "Mavzu qamrovi",
  levelFit: "Sinf/daraja mosligi",
};

const TEST_JUDGE_DESCRIBE: Record<TestJudgeCriterion, string> = {
  answerCorrectness: "is the marked key actually correct for every item? Verify each stem against its keyed option; a single wrong key is a 0.",
  clarity: "is each stem a complete, self-contained question a student of this grade can answer without seeing the options? No ambiguity, no double negatives, no unclear referents.",
  distractors: "are the wrong options plausible, mutually exclusive, grammatically parallel with the stem, and free of giveaway cues (length, absolutes like «always/never», «all of the above»)?",
  coverage: "do the items span the requested topic(s)/source evenly, without over-testing one subsection or repeating the same fact in different words?",
  levelFit: "do vocabulary, sentence length and cognitive demand match the declared grade and the declared Bloom level of each item?",
};

type JudgeOpts<C extends string> = { describe?: Partial<Record<C, string>>; skip?: readonly C[] };

function specOf<C extends string>(
  criteria: readonly C[],
  describe: Record<C, string>,
  labels: Record<C, string>,
  roleLine: string,
  typeNoun: string,
  typeLabel: string,
  o: JudgeOpts<C> = {},
): JudgeSpec<C> {
  return {
    criteria,
    describe: { ...describe, ...(o.describe ?? {}) },
    labels,
    ...(o.skip?.length ? { skip: o.skip } : {}),
    roleLine,
    typeLabel,
    typeNoun,
  };
}

const lessonJudge = (typeLabel: string, o?: JudgeOpts<LessonJudgeCriterion>) =>
  specOf(LESSON_JUDGE_CRITERIA, LESSON_JUDGE_DESCRIBE, LESSON_JUDGE_LABELS, LESSON_JUDGE_ROLE, "lesson type", typeLabel, o);
const mapJudge = (typeLabel: string, o?: JudgeOpts<MapJudgeCriterion>) =>
  specOf(MAP_JUDGE_CRITERIA, MAP_JUDGE_DESCRIBE, MAP_JUDGE_LABELS, MAP_JUDGE_ROLE, "map type", typeLabel, o);
const glossaryJudge = (typeLabel: string, o?: JudgeOpts<GlossaryJudgeCriterion>) =>
  specOf(GLOSSARY_JUDGE_CRITERIA, GLOSSARY_JUDGE_DESCRIBE, GLOSSARY_JUDGE_LABELS, GLOSSARY_JUDGE_ROLE, "glossary type", typeLabel, o);
const keysJudge = (typeLabel: string, o?: JudgeOpts<KeysJudgeCriterion>) =>
  specOf(KEYS_JUDGE_CRITERIA, KEYS_JUDGE_DESCRIBE, KEYS_JUDGE_LABELS, KEYS_JUDGE_ROLE, "case type", typeLabel, o);
const testJudge = (typeLabel: string, o?: JudgeOpts<TestJudgeCriterion>) =>
  specOf(TEST_JUDGE_CRITERIA, TEST_JUDGE_DESCRIBE, TEST_JUDGE_LABELS, TEST_JUDGE_ROLE, "test type", typeLabel, o);

/* ══════════════════════════ tur shakllari ══════════════════════════ */

export type LessonTypeSpec = TypeBase<"lesson"> & {
  limits: {
    /** Bosqich soni [min, max] — `TEACHER_LIMITS.stages*` ichida. */
    stages: readonly [number, number];
    stagesDefault: number;
    /** Ruxsat etilgan dars davomiyligi (daqiqa) va standarti. */
    durations: readonly number[];
    durationDefault: number;
  };
  judge: JudgeSpec<LessonJudgeCriterion>;
};

export type MapTypeSpec = TypeBase<"map"> & {
  limits: {
    weeks: readonly [number, number];
    /** Nechta jadval: `yillik` — 1, `choraklik` — 4. */
    tables: number;
  };
  judge: JudgeSpec<MapJudgeCriterion>;
};

export type GlossaryTypeSpec = TypeBase<"glossary"> & {
  limits: {
    /** Atama soni chiplari (narx shu uchtasi bilan bog'liq) va standarti. */
    terms: readonly number[];
    termsDefault: number;
    /** Shu turda minimal ma'qul atama soni (`mavzu-lugati` da pastroq). */
    termsMin: number;
    /** Ta'rif uzunligi [min, max] belgi. */
    defChars: readonly [number, number];
    /** Qo'shimcha tarjima ustunlari (faqat `uch-tilli`). */
    translationLangs: readonly string[];
    includeExampleDefault: boolean;
  };
  judge: JudgeSpec<GlossaryJudgeCriterion>;
};

export type KeysTypeSpec = TypeBase<"keys"> & {
  limits: {
    cases: readonly number[];
    casesDefault: number;
    questions: readonly [number, number];
    rubric: readonly [number, number];
    rubricTotal: number;
  };
  judge: JudgeSpec<KeysJudgeCriterion>;
};

export type TestTypeSpec = TypeBase<"test"> & {
  limits: {
    count: readonly number[];
    countDefault: number;
    /** Ruxsat etilgan savol turlari (R3 §3.1/3.3). */
    kinds: readonly TestQuestionKind[];
    /** Ochiq savollar ULUSHI (0–1) — `openCount` standarti shundan. */
    openShare: number;
    /** Qiyinlik taqsimoti, foiz (R3 §3.5) — `difficultyMix` qoidasi maqsadi. */
    difficultyMix: Record<TestDifficulty, number>;
    /** E'lon qilingan jami ball; `null` — `perQuestion × count`. */
    totalPoints: number | null;
    /** Variant tanlovi — hamma turda 1/2/4, standart 2. */
    variants: readonly number[];
    variantsDefault: number;
    /** Mezon+ball jadvali (BSB/ChSB da standart yoqiq). */
    criteriaTable: boolean;
    /** «Tasdiqlayman» qatori (R3 §3.7 — faqat bsb/chsb). */
    approver: boolean;
    /** Turning o'zi variant sonini qat'iy belgilasa (DTM — 4). */
    optionCountFixed: number | null;
    timeMin: readonly number[];
    timeMinDefault: number;
  };
  judge: JudgeSpec<TestJudgeCriterion>;
};

export type TeacherTypeSpec = LessonTypeSpec | MapTypeSpec | GlossaryTypeSpec | KeysTypeSpec | TestTypeSpec;

type SpecByKind = {
  lesson: LessonTypeSpec;
  map: MapTypeSpec;
  glossary: GlossaryTypeSpec;
  keys: KeysTypeSpec;
  test: TestTypeSpec;
};

/* ══════════════════════════ skeletlar ══════════════════════════ */

const LESSON_SKELETON = [
  "Shapka (muassasa, fan, sinf, sana, tuzuvchi)",
  "Dars maqsadi (ta'limiy, tarbiyaviy, rivojlantiruvchi)",
  "Kompetensiyalar",
  "Jihozlar",
  "Dars bosqichlari",
  "Vaqt jadvali (Bosqich | Daqiqa | Kutilgan natija)",
  "Uyga vazifa",
] as const;

const LESSON_SKELETON_ASSESSED = [...LESSON_SKELETON, "Baholash mezoni"] as const;

const MAP_SKELETON = [
  "Shapka (fan, o'quv yili, haftalik va jami soat)",
  "Kirish qatori",
  "Jadval (Hafta | Soat | Mavzu | Metod | Kutilgan natija | Nazorat)",
] as const;

const GLOSSARY_SKELETON = ["Sarlavha", "Kirish (qamrov)", "Atamalar ro'yxati (atama → ta'rif → misol)"] as const;
const GLOSSARY_SKELETON_TRI = ["Sarlavha", "Kirish (qamrov)", "Atamalar jadvali (Atama | Ta'rif | Ru | En)"] as const;

const KEYS_SKELETON = [
  "Sarlavha",
  "Kirish",
  "Keys sarlavhasi va vaziyat bayoni",
  "Topshiriqlar",
  "Namunaviy kalit",
  "Baholash rubrikasi (jami 10 ball)",
] as const;

const TEST_SKELETON = [
  "Shapka (muassasa, tur nomi, fan, sinf, variant, tuzuvchi, sana)",
  "O'quvchi maydoni (F.I.Sh., sinf, sana, ball, baho)",
  "Ko'rsatma",
  "Savollar",
  "OMR javoblar varag'i (yangi bet)",
  "Javoblar kaliti (yangi bet)",
] as const;

const TEST_SKELETON_CRITERIA = [...TEST_SKELETON, "Mezon va ball jadvali"] as const;

/* ══════════════════════════ qiyinlik profillari ══════════════════════════ */

/** R3 §3.5 — foizlar; `difficultyMix` qoidasi ± 1 savol tolerans bilan tekshiradi. */
export const DIFFICULTY_MIX = {
  oson: { oson: 60, orta: 30, qiyin: 10 },
  aralash: { oson: 30, orta: 50, qiyin: 20 },
  qiyin: { oson: 10, orta: 40, qiyin: 50 },
  dtm: { oson: 20, orta: 60, qiyin: 20 },
} as const satisfies Record<string, Record<TestDifficulty, number>>;

export type DifficultyProfileId = keyof typeof DIFFICULTY_MIX;

const TEST_VARIANTS = { variants: TEST_VARIANT_CHOICES, variantsDefault: TEST_VARIANT_DEFAULT } as const;
const TEST_TIMES = [20, 30, 45, 90] as const;

/* ══════════════════════════ REYESTR ══════════════════════════ */

const LESSON_TYPES: readonly LessonTypeSpec[] = [
  {
    kind: "lesson",
    id: "yangi-mavzu",
    label: { uz: "Yangi mavzu darsi", ru: "Урок изучения новой темы", en: "New-topic lesson" },
    hint: "Yangi tushunchani tushuntirish → mustahkamlash → uyga vazifa",
    skeleton: LESSON_SKELETON,
    limits: { stages: [5, 8], stagesDefault: 6, durations: [30, 45, 90], durationDefault: 45 },
    guidance: [
      "New-topic lesson: the middle stages carry the NEW concept — motivation, presentation of the new material with a worked example, guided practice, then independent practice; never spend more than a fifth of the lesson on greeting and revision together.",
      "The presentation stage must name the concrete facts, terms, formulas or rules being introduced — not «the teacher explains the topic».",
      "Every stage states what the TEACHER does and what the PUPIL does; the pupil column must contain an observable action (answers, solves, compares, writes), not «listens».",
      "The consolidation stage contains at least one concrete task/question a pupil of this grade can actually answer within the stated minutes.",
      "Do not invent textbook page numbers, author names or programme clause numbers; use only what the teacher supplied.",
    ],
    judge: lessonJudge("New-topic lesson"),
  },
  {
    kind: "lesson",
    id: "mustahkamlash",
    label: { uz: "Mustahkamlash darsi", ru: "Урок закрепления", en: "Consolidation lesson" },
    hint: "O'tilganni takrorlash va mashq qilish — yangi tushuncha kiritilmaydi",
    skeleton: LESSON_SKELETON,
    limits: { stages: [4, 7], stagesDefault: 5, durations: [30, 45, 90], durationDefault: 45 },
    guidance: [
      "Consolidation lesson: NO new concept is introduced — the stages are graded practice, from recall through standard exercises to a transfer/application task.",
      "Most of the time belongs to the pupils: at least half of the minutes go to stages where the pupil works (individually, in pairs or in groups).",
      "Name the actual exercise types at each stage (e.g. «5 short equations at the board», «pair work on the comparison table»), so the teacher can run it as written.",
      "Close with a diagnostic moment that shows who still has a gap, and let the homework follow from that gap.",
    ],
    judge: lessonJudge("Consolidation lesson", {
      describe: { pedagogicalVariety: "does the practice escalate (recall → standard exercise → transfer task) with different working modes, instead of the same drill repeated?" },
    }),
  },
  {
    kind: "lesson",
    id: "amaliy",
    label: { uz: "Amaliy (laboratoriya) dars", ru: "Практическое (лабораторное) занятие", en: "Practical / laboratory lesson" },
    hint: "Xavfsizlik → topshiriq → bajarish → natija rasmiylashtirish",
    skeleton: LESSON_SKELETON_ASSESSED,
    limits: { stages: [4, 7], stagesDefault: 6, durations: [45, 90], durationDefault: 90 },
    guidance: [
      "Practical/laboratory lesson: the stages are safety briefing and equipment check, task statement, hands-on work, recording of results, and conclusion — the hands-on stage takes the largest share of the minutes.",
      "The equipment list is concrete and complete for the described work; if a listed item is missing the lesson cannot run, so list only what the task needs.",
      "State what the pupil RECORDS (table, drawing, measurement, code output) and how it is checked — a practical lesson without a recorded result is not assessable.",
      "Do not invent measured values or reagent quantities; describe the procedure and let the pupils obtain the numbers.",
    ],
    judge: lessonJudge("Practical / laboratory lesson", {
      describe: { timeRealism: "is the hands-on stage long enough to actually perform the described work, with time left to record results?" },
    }),
  },
  {
    kind: "lesson",
    id: "nazorat",
    label: { uz: "Nazorat darsi", ru: "Контрольный урок", en: "Assessment lesson" },
    hint: "Nazorat topshirig'i + baholash mezoni; yangi mavzu tushuntirilmaydi",
    skeleton: LESSON_SKELETON_ASSESSED,
    limits: { stages: [4, 6], stagesDefault: 4, durations: [45, 90], durationDefault: 45 },
    guidance: [
      "Assessment lesson: there is NO «explain the new topic» stage — the structure is organisation and instructions, the assessment task itself, collection of the work, and a short debrief.",
      "The assessment task stage names WHAT is assessed (which skills from which topics) and in which form (written work, test, oral, practical).",
      "The assessment criteria are stated explicitly with their point values and add up to the announced total.",
      "Homework after an assessment lesson is light or is revision of the gaps the work will reveal — never a large new assignment.",
    ],
    judge: lessonJudge("Assessment lesson", {
      describe: { pedagogicalVariety: "an assessment lesson is deliberately uniform — judge instead whether organisation, task and debrief are each given a realistic slot." },
    }),
  },
  {
    kind: "lesson",
    id: "aralash",
    label: { uz: "Aralash dars", ru: "Комбинированный урок", en: "Combined lesson" },
    hint: "Takrorlash + yangi mavzu + mustahkamlash — eng keng tarqalgan shakl",
    skeleton: LESSON_SKELETON,
    limits: { stages: [5, 8], stagesDefault: 6, durations: [30, 45, 90], durationDefault: 45 },
    guidance: [
      "Combined lesson: revision of the previous topic, presentation of the new one, consolidation and homework all fit into one lesson — so each block must be tight and explicitly budgeted.",
      "The revision block asks about the PREVIOUS topic by name and feeds into the new one (say how they connect); it is not a generic warm-up.",
      "Keep the new-material block focused on one or two ideas — a combined lesson cannot carry a whole chapter.",
      "State an observable pupil action in every block, and make the minutes add up exactly to the lesson duration.",
    ],
    judge: lessonJudge("Combined lesson"),
  },
];

const MAP_TYPES: readonly MapTypeSpec[] = [
  {
    kind: "map",
    id: "yillik",
    label: { uz: "Yillik taqvim-mavzu reja", ru: "Годовой календарно-тематический план", en: "Yearly calendar-thematic plan" },
    hint: "Butun o'quv yili bitta jadvalda — hafta bo'yicha",
    skeleton: MAP_SKELETON,
    limits: { weeks: [TEACHER_LIMITS.weeksMin, TEACHER_LIMITS.weeksMax], tables: 1 },
    guidance: [
      "Yearly plan: ONE table covering the whole academic year week by week; the hours column must sum exactly to the declared yearly total.",
      "Topics follow a spiral progression — earlier weeks build the base the later weeks rely on; state real topic names, never «Topic 1», «Topic 2».",
      "The method column names a concrete teaching method appropriate to the topic (lecture, laboratory, problem solving, project, independent work) and must vary across the year.",
      "The control column matches the topic and the method; assessment weeks are placed at the end of the thematic blocks, not at random.",
      "Do not invent textbook chapter or page numbers or programme clause numbers — the teacher supplies those.",
    ],
    judge: mapJudge("Yearly calendar-thematic plan"),
  },
  {
    kind: "map",
    id: "choraklik",
    label: { uz: "Choraklik reja", ru: "Четвертной план", en: "Quarterly plan" },
    hint: "To'rt chorak alohida jadval, har biri o'z soat yig'indisi bilan",
    skeleton: MAP_SKELETON,
    limits: { weeks: [TEACHER_LIMITS.weeksMin, TEACHER_LIMITS.weeksMax], tables: TEACHER_LIMITS.quarters },
    guidance: [
      "Quarterly plan: FOUR separate tables (I–IV chorak), each with its own heading and its own hour subtotal; the four subtotals sum to the yearly total.",
      "Each quarter ends with a summarising/assessment week, and the first week of the next quarter opens by linking back to it.",
      "Distribute the weeks realistically across quarters (roughly 8–10 teaching weeks each) rather than splitting the year into four equal arbitrary blocks.",
      "Topic names, methods and controls follow the same rules as the yearly plan: concrete, varied, and matched to each other.",
    ],
    judge: mapJudge("Quarterly plan", {
      describe: { topicProgression: "does each quarter form a coherent block AND continue the previous one, so the four tables read as one year rather than four unrelated lists?" },
    }),
  },
];

const GLOSSARY_TYPES: readonly GlossaryTypeSpec[] = [
  {
    kind: "glossary",
    id: "fan-lugati",
    label: { uz: "Fan lug'ati", ru: "Словарь по предмету", en: "Subject glossary" },
    hint: "Fan bo'yicha umumiy atamalar — eng keng tarqalgan shakl",
    skeleton: GLOSSARY_SKELETON,
    limits: {
      terms: [10, 20, 40],
      termsDefault: 10,
      termsMin: 10,
      defChars: [TEACHER_LIMITS.defCharsMin, TEACHER_LIMITS.defCharsMax],
      translationLangs: [],
      includeExampleDefault: true,
    },
    guidance: [
      "Subject glossary: every entry is a TERM of the stated subject — never a general pedagogical word (competence, method, analysis) that would fit any subject.",
      "A definition is one or two complete sentences that say what the thing IS and what distinguishes it; it must not repeat the term as its own explanation.",
      "Add a short example showing the term used in a real subject context, not a paraphrase of the definition.",
      "Entries are sorted alphabetically in the output language, and no concept appears twice under two spellings.",
      "Do not cite dictionaries, standards numbers or page references — you do not know them.",
    ],
    judge: glossaryJudge("Subject glossary"),
  },
  {
    kind: "glossary",
    id: "mavzu-lugati",
    label: { uz: "Mavzu lug'ati", ru: "Словарь по теме", en: "Topic glossary" },
    hint: "Bitta bob yoki tor mavzu atamalari — kamroq, lekin aniqroq",
    skeleton: GLOSSARY_SKELETON,
    limits: {
      terms: [10, 20, 40],
      termsDefault: 10,
      termsMin: TEACHER_LIMITS.termsMin,
      defChars: [TEACHER_LIMITS.defCharsMin, TEACHER_LIMITS.defCharsMax],
      translationLangs: [],
      includeExampleDefault: true,
    },
    guidance: [
      "Topic glossary: the scope is ONE chapter or narrow topic — every term must be needed to understand exactly that topic, and terms from the wider subject are out of scope.",
      "Definitions are anchored in the topic's context: say how the term functions inside this topic, not only its general meaning.",
      "It is better to return fewer genuine terms than to pad the list with neighbouring-topic vocabulary.",
      "Keep the alphabetical order and the no-tautology rule of the subject glossary.",
    ],
    judge: glossaryJudge("Topic glossary", {
      describe: { termRelevance: "is every term required by THIS narrow topic, rather than borrowed from the wider subject to reach the requested count?" },
    }),
  },
  {
    kind: "glossary",
    id: "uch-tilli",
    label: { uz: "Uch tilli glossariy", ru: "Трёхъязычный глоссарий", en: "Trilingual glossary" },
    hint: "Har atama uchun ruscha va inglizcha muqobil — jadval ko'rinishida",
    skeleton: GLOSSARY_SKELETON_TRI,
    limits: {
      terms: [10, 20, 40],
      termsDefault: 10,
      termsMin: 10,
      defChars: [TEACHER_LIMITS.defCharsMin, TEACHER_LIMITS.defCharsMax],
      translationLangs: ["ru", "en"],
      includeExampleDefault: false,
    },
    guidance: [
      "Trilingual glossary: each entry carries the term, its definition, and the accepted Russian and English equivalents used in this subject's literature.",
      "Give the ESTABLISHED term in each language, not a word-by-word translation; if a term genuinely has no accepted equivalent, leave that cell empty rather than inventing one.",
      "Keep the definition in the document language; the other two columns hold single terms, not sentences.",
      "Alphabetical order follows the document language, and no concept appears twice.",
    ],
    judge: glossaryJudge("Trilingual glossary", {
      describe: { definitionAccuracy: "are the Russian and English equivalents the terms actually used in this field's literature, not literal word-by-word translations?" },
    }),
  },
  {
    kind: "glossary",
    id: "imtihon-atamalari",
    label: { uz: "Imtihon atamalari", ru: "Экзаменационные термины", en: "Exam terminology" },
    hint: "Imtihonda so'raladigan darajadagi qisqa, aniq ta'riflar",
    skeleton: GLOSSARY_SKELETON,
    limits: {
      terms: [10, 20, 40],
      termsDefault: 20,
      termsMin: 10,
      defChars: [TEACHER_LIMITS.defCharsMin, 240],
      translationLangs: [],
      includeExampleDefault: false,
    },
    guidance: [
      "Exam terminology: definitions are SHORT and exam-precise — the wording a student could reproduce under time pressure and still be marked correct.",
      "Select the terms an examiner actually asks about: those that carry a distinction, a formula or a classification, not decorative vocabulary.",
      "Where a term is easily confused with a neighbouring one, say the distinguishing feature explicitly in the definition.",
      "No examples and no padding — one or at most two sentences per entry.",
    ],
    judge: glossaryJudge("Exam terminology", {
      describe: { levelFit: "is each definition compact enough to be reproduced in an exam while remaining complete and unambiguous?" },
      skip: ["exampleQuality"],
    }),
  },
];

const KEYS_TYPES: readonly KeysTypeSpec[] = [
  {
    kind: "keys",
    id: "muammoli",
    label: { uz: "Muammoli keys", ru: "Проблемный кейс", en: "Problem case" },
    hint: "Vaziyatda hal qilinmagan muammo bor — yechim variantlari so'raladi",
    skeleton: KEYS_SKELETON,
    limits: { cases: [3, 5, 8], casesDefault: 5, questions: [TEACHER_LIMITS.caseQuestionsMin, TEACHER_LIMITS.caseQuestionsMax], rubric: [TEACHER_LIMITS.rubricMin, TEACHER_LIMITS.rubricMax], rubricTotal: TEACHER_LIMITS.rubricTotal },
    guidance: [
      "Problem case: the situation ends with an UNRESOLVED problem — the reader must first name the problem, then propose and weigh solutions.",
      "The situation is concrete: named roles, a setting, a timeline, and the constraints that make the problem hard; invent them as fiction, never present them as a real organisation or real statistics.",
      "Tasks must be unanswerable without reading the situation — each one refers to a specific fact of the case.",
      "The model key resolves the tasks with reasoning (why this option, at what cost), and the rubric criteria name what a good answer must contain for THIS case; the points add up to 10.",
    ],
    judge: keysJudge("Problem case"),
  },
  {
    kind: "keys",
    id: "tahliliy",
    label: { uz: "Tahliliy keys", ru: "Аналитический кейс", en: "Analytical case" },
    hint: "Bo'lib o'tgan vaziyatni tahlil qilish — sabab va oqibatni aniqlash",
    skeleton: KEYS_SKELETON,
    limits: { cases: [3, 5, 8], casesDefault: 5, questions: [TEACHER_LIMITS.caseQuestionsMin, TEACHER_LIMITS.caseQuestionsMax], rubric: [TEACHER_LIMITS.rubricMin, TEACHER_LIMITS.rubricMax], rubricTotal: TEACHER_LIMITS.rubricTotal },
    guidance: [
      "Analytical case: the events have ALREADY happened — the task is to explain why, tracing causes to consequences; a solution is not required.",
      "Supply enough detail (sequence of events, decisions taken, their visible results) for more than one causal reading to be defensible.",
      "At least one task must ask for evidence FROM the case text supporting the proposed explanation.",
      "The model key shows the causal chain step by step; the rubric rewards the quality of the reasoning, not agreement with one «right» answer.",
    ],
    judge: keysJudge("Analytical case", {
      describe: { keyQuality: "does the model answer reconstruct the causal chain from the case's own facts rather than offering a generic moral?" },
    }),
  },
  {
    kind: "keys",
    id: "qaror-qabul-qilish",
    label: { uz: "Qaror qabul qilish keysi", ru: "Кейс на принятие решения", en: "Decision-forcing case" },
    hint: "Qahramon bir necha yo'l oldida — «nima qilishi kerak?»",
    skeleton: KEYS_SKELETON,
    limits: { cases: [3, 5, 8], casesDefault: 5, questions: [TEACHER_LIMITS.caseQuestionsMin, TEACHER_LIMITS.caseQuestionsMax], rubric: [TEACHER_LIMITS.rubricMin, TEACHER_LIMITS.rubricMax], rubricTotal: TEACHER_LIMITS.rubricTotal },
    guidance: [
      "Decision-forcing case: the situation stops at the moment of choice, with a named protagonist facing two or more genuinely defensible options.",
      "Each option must have a real cost as well as a benefit — if one option is obviously right, the case fails its genre.",
      "The LAST task is always «choose the best option and justify it»; earlier tasks prepare that choice (identify the criteria, compare the options).",
      "The model key states a choice, the criteria behind it and what is given up; the rubric explicitly rewards weighing the alternatives, not just naming one.",
    ],
    judge: keysJudge("Decision-forcing case", {
      describe: { taskAlignment: "does the final task force an explicit, justified choice between the case's own options rather than a general discussion?" },
    }),
  },
  {
    kind: "keys",
    id: "rolli",
    label: { uz: "Rolli keys", ru: "Ролевой кейс", en: "Role-play case" },
    hint: "O'quvchi vaziyatdagi bir tomon rolida ishlaydi",
    skeleton: KEYS_SKELETON,
    limits: { cases: [3, 5, 8], casesDefault: 5, questions: [TEACHER_LIMITS.caseQuestionsMin, TEACHER_LIMITS.caseQuestionsMax], rubric: [TEACHER_LIMITS.rubricMin, TEACHER_LIMITS.rubricMax], rubricTotal: TEACHER_LIMITS.rubricTotal },
    guidance: [
      "Role-play case: the reader is placed INSIDE the situation («you are the head teacher…») and answers from that role's interests and constraints.",
      "State the role's authority and limits explicitly — what this person may decide and what they may not — otherwise the answers drift into wishful thinking.",
      "Name at least one other party with a conflicting interest, so the role has something to negotiate against.",
      "Tasks are phrased in the second person and ask for what the role would SAY or DO; the rubric rewards staying in role and respecting its constraints.",
    ],
    judge: keysJudge("Role-play case", {
      describe: { situationRealism: "does the case give the role a concrete remit, counterpart and constraints, so acting in role is possible?" },
    }),
  },
];

const TEST_TYPES: readonly TestTypeSpec[] = [
  {
    kind: "test",
    id: "nazorat",
    label: { uz: "Joriy nazorat ishi", ru: "Текущая контрольная работа", en: "Regular class test" },
    hint: "Odatdagi nazorat ishi — asosan yopiq savollar, har savol 1 ball",
    skeleton: TEST_SKELETON,
    limits: {
      count: [5, 10, 15, 20, 30, 40],
      countDefault: 20,
      kinds: ["single", "truefalse"],
      openShare: 0,
      difficultyMix: DIFFICULTY_MIX.aralash,
      totalPoints: null,
      ...TEST_VARIANTS,
      criteriaTable: false,
      approver: false,
      optionCountFixed: null,
      timeMin: TEST_TIMES,
      timeMinDefault: 45,
    },
    guidance: [
      "Regular class test: closed items only (single choice and true/false), one point each, covering the requested topic evenly.",
      "Exactly one option is correct in a single-choice item; the distractors must be plausible mistakes a pupil of this grade actually makes.",
      "Never use «all of the above», «none of the above» or «both A and B» as options, and never make the correct option the longest one.",
      "Each stem is a complete, self-contained question answerable without reading the options; negations are written in capitals (EMAS, NOTO'G'RI).",
      "Give a one-sentence explanation for every item — the teacher uses it when going through the answers.",
    ],
    judge: testJudge("Regular class test"),
  },
  {
    kind: "test",
    id: "bsb",
    label: { uz: "Bob bo'yicha ish (BSB uslubida)", ru: "Работа по разделу (в стиле БСБ)", en: "Chapter assessment (BSB style)" },
    hint: "Ochiq topshiriqlar ustun, mezon va ball jadvali bilan — jami 50 ball",
    skeleton: TEST_SKELETON_CRITERIA,
    limits: {
      // R3 §3.1: BSB uslubida 6–8 TOPSHIRIQ (savol emas) — chiplar shunga.
      count: [5, 8, 10],
      countDefault: 8,
      kinds: ["single", "truefalse", "open", "match"],
      openShare: 0.6,
      difficultyMix: DIFFICULTY_MIX.aralash,
      totalPoints: 50,
      ...TEST_VARIANTS,
      criteriaTable: true,
      approver: true,
      optionCountFixed: null,
      timeMin: TEST_TIMES,
      timeMinDefault: 45,
    },
    guidance: [
      "Chapter assessment in BSB style: most of the marks go to OPEN tasks that require the pupil to show working, explain or apply — closed items only carry the recall part.",
      "Every task is tied to a named assessed skill and carries an explicit point value; the points sum exactly to the announced total of 50.",
      "Each open task comes with a marking rubric of concrete observable steps («writes the formula — 2 points», «obtains the correct value — 3 points»), never a single «correct answer» line.",
      "The higher Bloom levels (evaluate, create) may appear ONLY in open tasks; closed items stay at remember/understand/apply.",
      "This is a teacher-made auxiliary material — never present it as the official assessment issued by the assessment centre.",
    ],
    judge: testJudge("Chapter assessment (BSB style)", {
      describe: { coverage: "do the tasks cover the chapter's assessed skills as declared in the criteria table, with no skill left unassessed and none over-weighted?" },
    }),
  },
  {
    kind: "test",
    id: "chsb",
    label: { uz: "Chorak ishi (ChSB uslubida)", ru: "Четвертная работа (в стиле ЧСБ)", en: "Quarterly assessment (ChSB style)" },
    hint: "Chorak yakuni — yopiq va ochiq savollar aralash, jami 40 ball",
    skeleton: TEST_SKELETON_CRITERIA,
    limits: {
      count: [10, 15, 20],
      countDefault: 15,
      kinds: ["single", "truefalse", "open", "match"],
      openShare: 0.4,
      difficultyMix: DIFFICULTY_MIX.aralash,
      totalPoints: 40,
      ...TEST_VARIANTS,
      criteriaTable: true,
      approver: true,
      optionCountFixed: null,
      timeMin: TEST_TIMES,
      timeMinDefault: 45,
    },
    guidance: [
      "Quarterly assessment in ChSB style: the items must span the WHOLE quarter, not the last chapter — distribute them across the quarter's topics in proportion to their teaching hours.",
      "Roughly three fifths closed items for breadth and two fifths open tasks for depth; the points sum exactly to the announced total of 40.",
      "Each open task carries a step-by-step marking rubric, and the criteria table names the assessed skill for every task.",
      "Do not repeat the same fact in two items — with a whole quarter to cover, duplication wastes the pupil's time.",
      "This is a teacher-made auxiliary material — never present it as the official quarterly assessment.",
    ],
    judge: testJudge("Quarterly assessment (ChSB style)", {
      describe: { coverage: "do the items span the whole quarter in proportion to the topics' teaching hours, rather than clustering on the most recent chapter?" },
    }),
  },
  {
    kind: "test",
    id: "dtm",
    label: { uz: "DTM uslubida mashq", ru: "Тренировка в стиле ГЦТ", en: "DTM-style practice test" },
    hint: "Faqat bitta to'g'ri javobli savollar, 4 variant — imtihonga tayyorgarlik",
    skeleton: TEST_SKELETON,
    limits: {
      count: [10, 15, 20, 30, 40],
      countDefault: 30,
      kinds: ["single"],
      openShare: 0,
      difficultyMix: DIFFICULTY_MIX.dtm,
      totalPoints: null,
      ...TEST_VARIANTS,
      criteriaTable: false,
      approver: false,
      optionCountFixed: 4,
      timeMin: TEST_TIMES,
      timeMinDefault: 90,
    },
    guidance: [
      "DTM-style practice: single-choice items ONLY, always four options, one correct — the format of the national entrance test.",
      "Distractors are built from the typical errors of the topic (wrong formula, swapped sign, confused definition), so a guessing candidate cannot eliminate them by form.",
      "Stems are compact and self-contained; no «all of the above», no double negatives, and the correct answer's position is spread evenly across the paper.",
      "Weight the paper towards medium difficulty with a genuine hard tail, so the score separates candidates.",
      "This is practice material written by the teacher — never claim these are real examination questions.",
    ],
    judge: testJudge("DTM-style practice test", {
      describe: { distractors: "are all four options drawn from real topic misconceptions and formally indistinguishable from the key (length, structure, specificity)?" },
    }),
  },
  {
    kind: "test",
    id: "olimpiada",
    label: { uz: "Olimpiadaga tayyorgarlik", ru: "Подготовка к олимпиаде", en: "Olympiad preparation" },
    hint: "Qiyin, ko'p bosqichli topshiriqlar — yarmi ochiq savol",
    skeleton: TEST_SKELETON,
    limits: {
      count: [5, 10, 15],
      countDefault: 10,
      kinds: ["single", "open", "match"],
      openShare: 0.5,
      difficultyMix: DIFFICULTY_MIX.qiyin,
      totalPoints: null,
      ...TEST_VARIANTS,
      criteriaTable: false,
      approver: false,
      optionCountFixed: null,
      timeMin: TEST_TIMES,
      timeMinDefault: 90,
    },
    guidance: [
      "Olympiad preparation: items require several linked steps or a non-obvious idea — a task solvable by direct substitution does not belong here.",
      "About half the items are open tasks where the pupil writes the full solution; those carry the analyse/evaluate/create levels.",
      "Each open task gets a full worked solution in the key, not just the final answer, because the point is to teach the method.",
      "Closed items in this set are hard by CONTENT, not by trick wording — ambiguity is not difficulty.",
    ],
    judge: testJudge("Olympiad preparation", {
      describe: { levelFit: "are the items genuinely hard through multi-step content rather than through obscure wording or trivia?" },
    }),
  },
  {
    kind: "test",
    id: "diagnostika",
    label: { uz: "Kirish diagnostikasi", ru: "Входная диагностика", en: "Diagnostic (entry) test" },
    hint: "Yil yoki chorak boshida bilim darajasini aniqlash — oson savollar",
    skeleton: TEST_SKELETON,
    limits: {
      count: [10, 15, 20],
      countDefault: 15,
      kinds: ["single", "truefalse"],
      openShare: 0,
      difficultyMix: DIFFICULTY_MIX.oson,
      totalPoints: null,
      ...TEST_VARIANTS,
      criteriaTable: false,
      approver: false,
      optionCountFixed: null,
      timeMin: TEST_TIMES,
      timeMinDefault: 30,
    },
    guidance: [
      "Diagnostic test: the aim is to LOCATE gaps, so coverage beats difficulty — spread the items over the prerequisite topics, one or two per topic.",
      "Keep items easy and unambiguous: a wrong answer must mean «this pupil lacks this prerequisite», not «this pupil misread the question».",
      "Test one prerequisite per item; combined items make the diagnosis useless.",
      "The explanation names the prerequisite being checked, so the teacher can plan the remediation from the result sheet.",
    ],
    judge: testJudge("Diagnostic (entry) test", {
      describe: { coverage: "does each prerequisite topic get its own item, so a wrong answer identifies exactly one gap?" },
    }),
  },
];

export const TEACHER_TYPES: { [K in TeacherKind]: readonly SpecByKind[K][] } = {
  lesson: LESSON_TYPES,
  map: MAP_TYPES,
  glossary: GLOSSARY_TYPES,
  keys: KEYS_TYPES,
  test: TEST_TYPES,
};

/* ══════════════════════════ hisobot qoidalari ══════════════════════════ */

/**
 * Deterministik hisobot qoidalari — hisobotlar §4 dagi `ReviewCheck`
 * id lari. BU YERDA faqat NOMLAR: implementatsiya WP-A (`teacher/review.ts`)
 * va WP-B (`teacher/test/review.ts`) da. Ro'yxat shu yerda, chunki forma
 * va hujjat paneli qaysi bandlar bo'lishini oldindan bilishi kerak, va
 * chunki qoidani unutib qo'yish testda ko'rinadi.
 */
export const TEACHER_RULE_IDS: Record<TeacherKind, readonly string[]> = {
  lesson: ["minutesSum", "topicGrounded", "stageCount", "noGenericActivity", "homeworkPresent", "competencyTagged"],
  map: ["weekCount", "uniqueTopics", "hoursSum", "noPlaceholderTopic", "resultVariety", "controlRelevance"],
  glossary: ["termCount", "alphaOrder", "defLength", "noGenericTerm", "exampleCoverage", "duplicateTerm", "noStubDefinition"],
  keys: ["caseCount", "hasQuestions", "hasSolution", "rubricSum", "situationLength", "realism", "noDuplicateCase"],
  test: [
    "count",
    "oneCorrect",
    "optionCount",
    "noDuplicates",
    "noBlanketOption",
    "stemLength",
    "optionBalance",
    "keyBalance",
    "difficultyMix",
    "bloomCoverage",
    "keyMatchesVariants",
    "variantParity",
    "sourceGrounded",
    "curriculumCoverage",
    "scoreSum",
    "omrFits",
    "languagePurity",
    "negativeStem",
    "answerPresent",
    /*
     * WP-B qo'shdi (R3 §4.1 ro'yxatining 20-bandi): har savolga bir
     * gaplik izoh. Reyestrda, chunki forma va hisobot paneli bandlar
     * ro'yxatini oldindan biladi (`tests/teacher-test-review.test.mts`
     * ikkala ro'yxat AYNAN mos ekanini tekshiradi).
     */
    "explanationPresent",
  ],
};

/* ══════════════════════════ kirish nuqtalari ══════════════════════════ */

/** Vosita id → kind; o'qituvchi vositasi bo'lmasa `null`. */
export function teacherKindOf(toolId: string): TeacherKind | null {
  return isTeacherToolId(toolId) ? TEACHER_TOOL_IDS[toolId] : null;
}

/** Kindning barcha turlari (forma galereyasi tartibida; birinchisi — standart). */
export function teacherTypesOf<K extends TeacherKind>(kind: K): readonly SpecByKind[K][] {
  return TEACHER_TYPES[kind];
}

/** Kind × tur; noma'lum/bo'sh tur → kindning STANDART turi (birinchisi). */
export function teacherTypeOf<K extends TeacherKind>(kind: K, id: unknown): SpecByKind[K] {
  const list = TEACHER_TYPES[kind] as readonly SpecByKind[K][];
  const want = String(id ?? "").trim();
  return list.find((t) => t.id === want) ?? list[0];
}

/** Kindning standart tur id si (forma va narx bir xil qoidadan o'qisin). */
export function teacherDefaultTypeId(kind: TeacherKind): string {
  return TEACHER_TYPES[kind][0].id;
}

/** Noma'lum tur → standart id (`normalizeWorkKind` naqshi). */
export function normalizeTeacherType(kind: TeacherKind, v: unknown): string {
  return teacherTypeOf(kind, v).id;
}
