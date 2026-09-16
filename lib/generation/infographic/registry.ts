/**
 * INFOGRAFIKA TUR REYESTRI (AUDIT-21 R0) — `games/registry.ts` naqshi.
 *
 * Reyestr — dvigatelning SPETSIFIKATSIYASI. To'rt joyda o'qiladi:
 * (1) prompt (`infographic/prompts.ts` — «TYPE RULES» = `guidance`),
 * (2) dvigatel va maket (`infographic/engine.ts`, `figures/layout-infographic.ts`),
 * (3) hisobot (`infographic/review.ts` — `INFOGRAPHIC_RULE_IDS` va `judge`),
 * (4) forma (`lib/tools.ts` chiplari — `label`, `limits`).
 *
 * Manba: `docs/research/infographic.md` §3 (7 tur jadvali, blok
 * chegaralari, maxsus maydonlar) va §4 (qoidalar, judge). Raqamlar shu
 * yerda QULFLANADI (`tests/infographic-registry.test.mts`).
 *
 * Ro'yxatning BIRINCHI elementi — STANDART tur (`list`), noma'lum/bo'sh
 * tur shunga tushadi (`infographicTypeOf`).
 */
import type { JudgeSpec } from "../report/types";
import { INFOGRAPHIC_LIMITS, type InfographicLabel, type InfographicTypeId } from "./types";

/* ══════════════════════════ baholovchi ══════════════════════════ */

const JUDGE_ROLE = "a teacher reviewing a one-page classroom poster before printing it for the wall";

/** R6 (`infographic.md`) §4 — beshta mezon. */
export const INFOGRAPHIC_JUDGE_CRITERIA = ["topicClarity", "visualLogic", "headingConciseness", "ageFit", "honestyCheck"] as const;
export type InfographicJudgeCriterion = (typeof INFOGRAPHIC_JUDGE_CRITERIA)[number];

const JUDGE_LABELS: Record<InfographicJudgeCriterion, string> = {
  topicClarity: "Bitta aniq g'oya",
  visualLogic: "Tur va mazmun mosligi",
  headingConciseness: "Blok sarlavhalarining qisqaligi",
  ageFit: "Maktab auditoriyasiga moslik",
  honestyCheck: "Raqam va manbalar halolligi",
};

const JUDGE_DESCRIBE: Record<InfographicJudgeCriterion, string> = {
  topicClarity:
    "does the poster communicate ONE clear idea about the topic at a glance? Every block must carry information a reader could not guess from the title; a block of generic filler («this is an important process») is a failure even if the rest is good.",
  visualLogic: "does the chosen type genuinely fit the content, or has unordered content been forced into a process/timeline shape (or an ordered sequence flattened into a list)?",
  headingConciseness: "are block headings short scannable phrases of a few words, not full sentences repeating the block text?",
  ageFit: "is the language simple enough for the stated school audience, with every specialist term either avoided or explained inside the block?",
  honestyCheck:
    "do the stat values, dates and the source line come ONLY from what the user supplied? Any percentage, count or citation the model produced from its own knowledge is a failure here, even if it happens to be correct.",
};

function judgeOf(typeLabel: string, describe: Partial<Record<InfographicJudgeCriterion, string>> = {}): JudgeSpec<InfographicJudgeCriterion> {
  return {
    criteria: INFOGRAPHIC_JUDGE_CRITERIA,
    describe: { ...JUDGE_DESCRIBE, ...describe },
    labels: JUDGE_LABELS,
    roleLine: JUDGE_ROLE,
    typeNoun: "infographic type",
    typeLabel,
  };
}

/* ══════════════════════════ tur shakli ══════════════════════════ */

export type InfographicTypeSpec = {
  id: InfographicTypeId;
  label: InfographicLabel;
  /** Formadagi bir qatorli izoh (uz). */
  hint: string;
  limits: {
    /** Blok soni [min, max] — `INFOGRAPHIC_LIMITS.blocks*` ichida. */
    blocks: readonly [number, number];
    blocksDefault: number;
  };
  /**
   * Shu turda MAJBURIY blok maydonlari (`InfographicBlock` ning
   * ixtiyoriy maydonlari). Hisobot shu ro'yxatni aylanib chiqadi —
   * har tur uchun alohida qoida yozilmaydi.
   */
  requires: readonly ("stat" | "when" | "role" | "side" | "order")[];
  /** Yozish qoidalari (en, 3–5 qator) — tizim promptining «TYPE RULES» i. */
  guidance: readonly string[];
  judge: JudgeSpec<InfographicJudgeCriterion>;
};

/* ══════════════════════════ turlar ══════════════════════════ */

export const INFOGRAPHIC_TYPES: readonly InfographicTypeSpec[] = [
  {
    id: "list",
    label: { uz: "Ro'yxat", ru: "Список", en: "List" },
    hint: "Qoidalar, tavsiyalar, belgilar — tartibi muhim bo'lmagan bandlar",
    limits: { blocks: [3, 8], blocksDefault: 5 },
    requires: [],
    guidance: [
      "List poster: each block is an independent item — the reader may start anywhere, so no block may refer to «the previous step».",
      "Items must be parallel in grammar and in scope: all rules, or all features, or all warning signs — not a mixture.",
      "Each block adds one fact the title does not already give.",
    ],
    judge: judgeOf("List / checklist poster"),
  },
  {
    id: "process",
    label: { uz: "Jarayon", ru: "Процесс", en: "Process" },
    hint: "Bosqichma-bosqich ketma-ketlik (1 → 2 → 3)",
    limits: { blocks: [3, 6], blocksDefault: 4 },
    requires: ["order"],
    guidance: [
      "Process poster: blocks are ordered stages, numbered from 1; the `order` field carries the number and the blocks are written in that order.",
      "Each stage names what HAPPENS in it, with the actor or the driving force — «heat from the sun turns sea water into vapour», not «evaporation is important».",
      "Neighbouring stages must be causally linked: the end of one is the start of the next.",
      "Six stages is the maximum a single page can carry; merge finer steps rather than shrinking the text.",
    ],
    judge: judgeOf("Step-by-step process poster", {
      visualLogic: "are the blocks genuinely sequential stages where each one follows from the previous, rather than a list that has been numbered after the fact?",
    }),
  },
  {
    id: "compare",
    label: { uz: "Taqqoslash", ru: "Сравнение", en: "Comparison" },
    hint: "Ikki tushuncha yonma-yon — o'xshashlik va farqlar",
    limits: { blocks: [4, 8], blocksDefault: 6 },
    requires: ["side"],
    guidance: [
      "Comparison poster: every block belongs to the left or the right column via the `side` field, and both columns must get the same number of blocks.",
      "Blocks are compared PAIRWISE in order: the first left block and the first right block must address the same criterion, the second pair the next criterion, and so on.",
      "Name the criterion inside the heading («Energiya manbai»), so the reader can see what is being compared without reading both texts.",
      "Do not use this type for one concept with pros and cons unless both columns are genuinely parallel.",
    ],
    judge: judgeOf("Side-by-side comparison poster", {
      visualLogic: "do the two columns hold the same number of blocks and does each pair address the same criterion, or have unrelated facts been stacked on either side?",
    }),
  },
  {
    id: "stat",
    label: { uz: "Statistika", ru: "Статистика", en: "Statistics" },
    hint: "Katta raqamlar va ularning izohi — faqat foydalanuvchi bergan ma'lumotdan",
    limits: { blocks: [3, 6], blocksDefault: 4 },
    requires: ["stat"],
    guidance: [
      "Statistics poster: EVERY block carries a `stat` with a value and a short label; a block without a number does not belong in this type.",
      "Numbers may come ONLY from the data the user supplied in the topic, the extra notes or the source file. If there are not enough numbers for the requested block count, produce fewer blocks — never invent one.",
      "Keep the value short and printable («73%», «1 200 km», «2,5 mln») and put the unit inside the value, not in the label.",
      "The block text says what the number MEANS for the reader; repeating the number in words wastes the only line the block has.",
    ],
    judge: judgeOf("Statistics poster", {
      honestyCheck: "does every single stat value trace back to a number the user supplied? One invented figure fails this criterion outright.",
    }),
  },
  {
    id: "timeline",
    label: { uz: "Xronologiya", ru: "Хронология", en: "Timeline" },
    hint: "Sana yoki davr bo'yicha voqealar ketma-ketligi",
    limits: { blocks: [3, 8], blocksDefault: 5 },
    requires: ["when"],
    guidance: [
      "Timeline poster: every block carries a `when` (a year, a date or a named period) and the blocks are written in chronological order.",
      "Dates may come ONLY from the user's material or from the uncontested factual record of the topic; an approximate period («XV asr oxiri») is better than a precise date you are not sure of.",
      "Each block says what CHANGED at that moment, not what existed around it.",
      "Keep the `when` values in one format throughout — mixing «1991» with «20-asrning oxiri» makes the axis unreadable.",
    ],
    judge: judgeOf("Chronological timeline poster", {
      visualLogic: "are the blocks in true chronological order with a consistent date format, and does each entry mark a change rather than a background fact?",
    }),
  },
  {
    id: "cause-effect",
    label: { uz: "Sabab — natija", ru: "Причина — следствие", en: "Cause and effect" },
    hint: "Chapda sabablar, o'ngda natijalar — markazda bog'lanish",
    limits: { blocks: [4, 8], blocksDefault: 6 },
    requires: ["role"],
    guidance: [
      "Cause-and-effect poster: every block is marked `cause` or `effect`, and there must be at least two of each.",
      "Causes are written first in the block list, effects after them; the layout draws the arrow between the two groups.",
      "A cause block states a condition or action; an effect block states the resulting change. A block that restates the topic belongs to neither group.",
      "Do not mix in blocks that are merely related facts — this type claims a causal link and the reader will believe it.",
    ],
    judge: judgeOf("Cause-and-effect poster", {
      visualLogic: "is there a real causal link between the two groups, with at least two causes and two effects, rather than two piles of related facts?",
    }),
  },
  {
    id: "map-structure",
    label: { uz: "Tuzilma", ru: "Структура", en: "Structure map" },
    hint: "Markaziy tushuncha va uning tarkibiy qismlari",
    limits: { blocks: [3, 7], blocksDefault: 5 },
    requires: [],
    guidance: [
      "Structure poster: the title names the whole, and each block names one part of it; the `parent` field may point at another block's id for a second level.",
      "Keep the hierarchy to two levels at most — a printed A4 page cannot carry a deeper tree legibly.",
      "Sibling blocks must divide the whole without overlapping: two blocks describing the same part is a defect.",
      "Each block says what its part DOES inside the whole, not just what it is called.",
    ],
    judge: judgeOf("Structure / concept map poster", {
      visualLogic: "do the blocks divide the whole named in the title into non-overlapping parts, at most two levels deep?",
    }),
  },
];

export const INFOGRAPHIC_TYPE_BY_ID = Object.fromEntries(INFOGRAPHIC_TYPES.map((t) => [t.id, t])) as Record<InfographicTypeId, InfographicTypeSpec>;

/* ══════════════════════════ hisobot qoidalari ══════════════════════════ */

/**
 * Deterministik hisobot qoidalari — hisobot §4 dagi `ReviewCheck` id lari.
 * BU YERDA faqat NOMLAR: implementatsiya WP-C (`infographic/review.ts`) da.
 *
 * `contrast` — RUNTIME tekshiruv emas: palitralar statik va ular
 * `tests/infographic-registry.test.mts` da WCAG formulasi bilan
 * oldindan qulflanadi (hisobot §4 shuni talab qiladi). Band baribir
 * ro'yxatda qoladi, chunki hujjat paneli foydalanuvchiga «kontrast
 * tekshirildi» deb aytishi kerak.
 */
export const INFOGRAPHIC_RULE_IDS: readonly string[] = [
  "blockCount",
  "textLength",
  "titleLength",
  "headingLength",
  "iconKnown",
  "contrast",
  "noOverflow",
  "statPresent",
  "typeFields",
  "sourceGrounded",
];

/* ══════════════════════════ kirish nuqtalari ══════════════════════════ */

/** Turlar ro'yxati — forma shu tartibda chizadi (birinchisi standart). */
export function infographicTypes(): readonly InfographicTypeSpec[] {
  return INFOGRAPHIC_TYPES;
}

/** Noma'lum/bo'sh tur → STANDART tur (`list`). */
export function infographicTypeOf(id: unknown): InfographicTypeSpec {
  const want = String(id ?? "").trim();
  return INFOGRAPHIC_TYPES.find((t) => t.id === want) ?? INFOGRAPHIC_TYPES[0];
}

/** Standart tur id si (forma va dvigatel bir xil qoidadan o'qisin). */
export function infographicDefaultTypeId(): InfographicTypeId {
  return INFOGRAPHIC_TYPES[0].id;
}

/** Noma'lum tur → standart id. */
export function normalizeInfographicType(v: unknown): InfographicTypeId {
  return infographicTypeOf(v).id;
}

/**
 * Blok soni — TUR chegarasiga tushiriladi.
 *
 * Forma umumiy chiplarni (3/4/5/6/8) ko'rsatadi, lekin `process` da
 * 8 blok yo'q: qiymat turning yuqori chegarasiga kesiladi. Narx
 * o'zgarmaydi (tekis 2 000), shuning uchun bu kesish foydalanuvchini
 * hech narsadan mahrum qilmaydi — plakat esa o'qilarli qoladi.
 */
export function normalizeBlockCountFor(typeId: unknown, v: unknown): number {
  const type = infographicTypeOf(typeId);
  const [min, max] = type.limits.blocks;
  const n = Number(v);
  if (!INFOGRAPHIC_LIMITS.blockCounts.includes(n)) return type.limits.blocksDefault;
  return Math.min(max, Math.max(min, n));
}
