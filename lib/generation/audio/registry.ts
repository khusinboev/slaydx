/**
 * KIND × TUR REYESTRI (AUDIT-22 R0) — `games/registry.ts` naqshi.
 *
 * Reyestr — dvigatelning SPETSIFIKATSIYASI. To'rt joyda o'qiladi:
 * (1) promptlar (`audio/prompts.ts` — «TYPE RULES» = `guidance`),
 * (2) dvigatel (`audio/engine.ts` — skelet, so'z byudjeti),
 * (3) hisobot (`audio/review.ts` — `AUDIO_RULE_IDS` va `judge`),
 * (4) forma (`lib/tools.ts` chiplari — `label`, `limits`).
 *
 * Manba: `docs/research/{podcast,greeting}.md` §3 «bizga tavsiya:
 * reyestr» va §4 «sifat mezonlari». Raqamlar shu hisobotlardan; ular bu
 * yerda QULFLANADI (`tests/audio-registry.test.mts`).
 *
 * Har kind ro'yxatining BIRINCHI elementi — shu kindning STANDART turi
 * (noma'lum/bo'sh tur shunga tushadi, `audioTypeOf`).
 */
import type { JudgeSpec } from "../report/types";
import { AUDIO_LIMITS, AUDIO_TOOL_IDS, isAudioToolId, type AudioKind } from "./types";

/* ══════════════════════════ umumiy shakl ══════════════════════════ */

export type AudioLabel = { uz: string; ru: string; en: string };

type TypeBase<K extends AudioKind> = {
  kind: K;
  id: string;
  label: AudioLabel;
  /** Formadagi bir qatorli izoh (uz). */
  hint: string;
  /**
   * SSENARIY skeleti — bloklar tartibda (uz). Dvigatel shu ro'yxat
   * bo'yicha yozdiradi, hisobot esa yo'q blokni ko'rsatadi.
   */
  skeleton: readonly string[];
  /** Yozish qoidalari (en, 3–5 qator) — tizim promptining «TYPE RULES» i. */
  guidance: readonly string[];
};

/* ══════════════════════════ baholovchi ══════════════════════════ */

const PODCAST_JUDGE_ROLE = "an audio editor listening to a short educational podcast episode before it is published";
const GREETING_JUDGE_ROLE = "a host reading a congratulation message aloud at a celebration before an audience";

/** R8 (`podcast.md`) §4 — beshta mezon. */
export const PODCAST_JUDGE_CRITERIA = ["hook", "structure", "accuracy", "speakability", "closing"] as const;
export type PodcastJudgeCriterion = (typeof PODCAST_JUDGE_CRITERIA)[number];

const PODCAST_JUDGE_LABELS: Record<PodcastJudgeCriterion, string> = {
  hook: "Kirishning qiziqarliligi",
  structure: "Bloklarning tuzilishi",
  accuracy: "Faktlarning ishonchliligi",
  speakability: "Ovoz chiqarib o'qilishi",
  closing: "Yakunning to'liqligi",
};

const PODCAST_JUDGE_DESCRIBE: Record<PodcastJudgeCriterion, string> = {
  hook: "does the opening line make a listener stay — a concrete question, number or situation — rather than «today we will talk about the topic of…»?",
  structure: "do the three middle blocks each cover a DIFFERENT facet of the topic, in an order a listener can follow without seeing anything on screen?",
  accuracy:
    "are the claims ones a subject teacher would accept? Invented statistics, invented studies and invented quotations are the worst defect here, because a listener cannot check them while listening.",
  speakability:
    "read two turns aloud: is every sentence sayable in one breath, free of parenthetical asides, abbreviations, URLs and formulas that only work in writing?",
  closing: "does the ending actually close — a one-sentence summary plus a question or suggestion for the listener — instead of stopping mid-thought?",
};

/** R8 (`greeting.md`) §4 — beshta mezon. */
export const GREETING_JUDGE_CRITERIA = ["addressee", "occasionFit", "warmth", "speakability", "originality"] as const;
export type GreetingJudgeCriterion = (typeof GREETING_JUDGE_CRITERIA)[number];

const GREETING_JUDGE_LABELS: Record<GreetingJudgeCriterion, string> = {
  addressee: "Murojaatning to'g'riligi",
  occasionFit: "Sababga mosligi",
  warmth: "Iliqlik darajasi",
  speakability: "Ovoz chiqarib o'qilishi",
  originality: "Iboralarning original ligi",
};

const GREETING_JUDGE_DESCRIBE: Record<GreetingJudgeCriterion, string> = {
  addressee: "is the addressee named and addressed in the form the stated relationship requires (respectful «Siz» by default), from the very first sentence?",
  occasionFit: "do the wishes belong to THIS occasion? A teacher's-day text that would fit a birthday just as well has failed this criterion.",
  warmth: "is the tone warm without being servile or overfamiliar for the stated relationship?",
  speakability: "read it aloud: are the sentences short enough to say in one breath, with no written-only constructions?",
  originality: "spot-check two sentences: are they written for this person and occasion, or stock greeting-card lines that could be pasted anywhere?",
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

const podcastJudge = (typeLabel: string, o?: JudgeOpts<PodcastJudgeCriterion>) =>
  specOf(PODCAST_JUDGE_CRITERIA, PODCAST_JUDGE_DESCRIBE, PODCAST_JUDGE_LABELS, PODCAST_JUDGE_ROLE, "episode type", typeLabel, o);
const greetingJudge = (typeLabel: string, o?: JudgeOpts<GreetingJudgeCriterion>) =>
  specOf(GREETING_JUDGE_CRITERIA, GREETING_JUDGE_DESCRIBE, GREETING_JUDGE_LABELS, GREETING_JUDGE_ROLE, "greeting genre", typeLabel, o);

/* ══════════════════════════ tur shakllari ══════════════════════════ */

export type PodcastTypeSpec = TypeBase<"podcast"> & {
  /** Standart ovoz soni: dialog (2) yoki monolog (1) — forma ham shundan. */
  speakers: 1 | 2;
  limits: {
    /** Daqiqa chiplari va standarti (narxga TA'SIR QILMAYDI). */
    minutes: readonly number[];
    minutesDefault: number;
    /** Ssenariy o'rtasidagi mazmun bloklari soni. */
    blocks: number;
  };
  judge: JudgeSpec<PodcastJudgeCriterion>;
};

export type GreetingTypeSpec = TypeBase<"greeting"> & {
  /** Tabriknoma DOIM monolog (`greeting.md` §3) — maydon shartnoma uchun. */
  speakers: 1;
  limits: {
    minutes: readonly number[];
    minutesDefault: number;
  };
  /**
   * Forma chipi bo'lgan «sabab» matni (`occasion`) — janr tanlanganda
   * promptga SHU ibora tushadi. `umumiy` turda bo'sh: o'shanda sababni
   * foydalanuvchi o'z so'zi bilan yozadi.
   */
  occasion: string;
  judge: JudgeSpec<GreetingJudgeCriterion>;
};

export type AudioTypeSpec = PodcastTypeSpec | GreetingTypeSpec;

type SpecByKind = {
  podcast: PodcastTypeSpec;
  greeting: GreetingTypeSpec;
};

/* ══════════════════════════ skeletlar ══════════════════════════ */

/**
 * PODKAST SKELETLARI — TUR bo'yicha ALOHIDA (WP-A2 tuzatishi).
 *
 * WP-A da uchala tur BITTA `PODCAST_SKELETON`ni, bitta `blocks: 3`ni va
 * bitta `speakers: 2`ni ishlatgan — ya'ni ssenariy TUZILMASI tur
 * bo'yicha farqlanmagan (farq faqat `guidance` matnida edi, `structure`
 * ta'siri esa reyestrda (`audio-params.ts podcastType`) e'lon qilingan
 * bo'lsa ham HAQIQATDA hech narsaga bog'lanmagan — differensial zond
 * shuni ushlaydi). Lead qarori (`docs/AUDIT-22.md` §5 WP-A2):
 *   • `tushuntirish` — MONOLOG (bitta hikoyachi), 3 blok;
 *   • `intervyu` — DIALOG (boshlovchi + mehmon), 3 blok, har blok
 *     savol→javob juftligi;
 *   • `savol-javob` — DIALOG, 4 QISQA savol-javob jufti (uchtasi emas).
 * `prompts.ts`/`review.ts` bloklar sonini/ovoz sonini reyestrdan
 * (`spec.limits.blocks`, `spec.speakers`) o'qiydi — bu yerdagi son
 * O'ZGARSA ular AVTOMATIK moslashadi.
 */
const PODCAST_SKELETONS: Record<"tushuntirish" | "intervyu" | "savol-javob", readonly string[]> = {
  tushuntirish: [
    "Kirish (hook: savol yoki fakt)",
    "1-blok (mavzuning birinchi qirrasi)",
    "2-blok (ikkinchi qirrasi)",
    "3-blok (uchinchi qirrasi)",
    "Yakun (xulosa + tinglovchiga savol)",
  ],
  intervyu: [
    "Kirish (hook + mehmonni qisqa tanishtirish)",
    "1-savol → javob (mavzuning birinchi qirrasi)",
    "2-savol → javob (ikkinchi qirrasi, oldingisidan chuqurroq)",
    "3-savol → javob (nima qilish kerakligi)",
    "Yakun (mehmonga rahmat + tinglovchiga xulosa)",
  ],
  "savol-javob": [
    "Kirish (hook: mavzu bir jumlada)",
    "1-savol → qisqa javob",
    "2-savol → qisqa javob",
    "3-savol → qisqa javob",
    "4-savol → qisqa javob",
    "Yakun (qisqa xulosa)",
  ],
};

/** `greeting.md` §3: murojaat → asosiy tabrik → tilaklar → yakun. */
const GREETING_SKELETON = [
  "Murojaat va ochilish jumlasi",
  "Asosiy tabrik (sabab bilan bog'liq)",
  "Shaxsiy tilaklar",
  "Yakuniy tilak/duo",
] as const;

/* ══════════════════════════ podkast turlari ══════════════════════════ */

const PODCAST_MINUTES = AUDIO_LIMITS.podcastMinutes;
const GREETING_MINUTES = AUDIO_LIMITS.greetingMinutes;

const PODCAST_TYPES: readonly PodcastTypeSpec[] = [
  {
    kind: "podcast",
    id: "tushuntirish",
    label: { uz: "Mavzu tushuntirish", ru: "Объяснение темы", en: "Explainer" },
    hint: "Bitta hikoyachi mavzuni uchta qirradan tushuntiradi — eng keng tarqalgan format",
    skeleton: PODCAST_SKELETONS.tushuntirish,
    // MONOLOG (WP-A2): dialog turlaridan farqi shu — boshlovchi/mehmon rollari yo'q.
    speakers: 1,
    limits: { minutes: PODCAST_MINUTES, minutesDefault: AUDIO_LIMITS.podcastMinutesDefault, blocks: 3 },
    guidance: [
      "Explainer episode with ONE voice: a single narrator hosts, frames and explains the topic directly to the listener — there is no second speaker to hand off to.",
      "Open with a hook — a concrete question, number or everyday situation the listener recognises — never with «today we will talk about».",
      "Each of the three middle blocks covers one facet of the topic and ends with a bridge sentence into the next one; a listener has no screen, so the structure must be audible.",
      "Speak in spoken language: short sentences, no parentheses, no abbreviations, no URLs, no formulas. Numbers are written out the way they are said.",
    ],
    judge: podcastJudge("Single-voice explainer episode"),
  },
  {
    kind: "podcast",
    id: "intervyu",
    label: { uz: "Intervyu", ru: "Интервью", en: "Interview" },
    hint: "Boshlovchi savol beradi, mehmon-ekspert javob beradi",
    skeleton: PODCAST_SKELETONS.intervyu,
    speakers: 2,
    limits: { minutes: PODCAST_MINUTES, minutesDefault: AUDIO_LIMITS.podcastMinutesDefault, blocks: 3 },
    guidance: [
      "Interview episode: A is the host and asks ONE question per turn; B is the invited expert and answers it in two to four sentences.",
      "The host never explains the subject matter — if the host starts teaching, the format has collapsed into an explainer.",
      "Questions get progressively deeper: what it is, why it matters, what to do about it. A question the previous answer already covered is a defect.",
      "The expert speaks from general professional knowledge; do NOT invent a name, an institution, a study or a statistic for the expert.",
    ],
    judge: podcastJudge("Host-and-expert interview", {
      describe: {
        structure: "does each host question open a NEW facet, and does each expert answer stay on that question rather than drifting into the next one?",
      },
    }),
  },
  {
    kind: "podcast",
    id: "savol-javob",
    label: { uz: "Savol-javob", ru: "Вопрос-ответ", en: "Q&A" },
    hint: "Tinglovchilarning tez-tez beriladigan savollariga to'rtta qisqa javob",
    skeleton: PODCAST_SKELETONS["savol-javob"],
    speakers: 2,
    // To'RTTA qisqa savol-javob jufti (dialog turlari orasida YAGONA 4 blokli tur — WP-A2).
    limits: { minutes: PODCAST_MINUTES, minutesDefault: AUDIO_LIMITS.podcastMinutesDefault, blocks: 4 },
    guidance: [
      "Q&A episode: each middle block is one frequently asked question about the topic, read out by A and answered by B in under 60 spoken words.",
      "Questions are the ones people actually ask — practical, concrete, sometimes naive — not the ones a textbook chapter would pose.",
      "Answer first, explanation second: the listener must get the verdict in the first sentence and the reasoning after it.",
      "Do not invent statistics or cite studies; where the honest answer is «it depends», say what it depends on.",
    ],
    judge: podcastJudge("Question-and-answer episode", {
      describe: {
        structure: "is every middle block a self-contained question with its own answer, so a listener joining mid-episode still follows?",
      },
    }),
  },
];

/* ══════════════════════════ tabriknoma janrlari ══════════════════════════ */

const greetingType = (id: string, label: AudioLabel, hint: string, occasion: string, guidance: readonly string[], judgeLabel: string): GreetingTypeSpec => ({
  kind: "greeting",
  id,
  label,
  hint,
  skeleton: GREETING_SKELETON,
  speakers: 1,
  occasion,
  limits: { minutes: GREETING_MINUTES, minutesDefault: AUDIO_LIMITS.greetingMinutesDefault },
  guidance,
  judge: greetingJudge(judgeLabel),
});

/**
 * Janrlar (`greeting.md` §2–§3). BIRINCHISI standart emas — standart
 * `umumiy`, chunki forma «sabab» chipi bo'sh qolganda ham ishlashi kerak;
 * shuning uchun `umumiy` ro'yxatning boshida turadi (`audioTypeOf`).
 */
const GREETING_TYPES: readonly GreetingTypeSpec[] = [
  greetingType(
    "umumiy",
    { uz: "Umumiy tabrik", ru: "Общее поздравление", en: "General greeting" },
    "Sabab foydalanuvchi so'zlari bilan — universal tabriknoma",
    "",
    [
      "General congratulation: the occasion comes from the user's own words — use them, do not substitute a different holiday.",
      "Name the addressee in the first sentence and keep the respectful «Siz» form unless the user explicitly asked otherwise.",
      "Wishes must be concrete enough to belong to this person (their work, their family, their studies) — generic health-and-happiness lines alone are a defect.",
      "Close with one wish, not a list of five.",
    ],
    "General congratulation",
  ),
  greetingType(
    "ustoz-kuni",
    { uz: "Ustozlar kuni", ru: "День учителя", en: "Teacher's day" },
    "1-oktabr — ustoz va murabbiylar kuni",
    "Ustozlar va murabbiylar kuni",
    [
      "Teacher's day greeting: thank the teacher for a specific kind of work — patience with pupils, subject knowledge passed on, a life lesson — not for «noble work» in the abstract.",
      "The respectful form is mandatory here regardless of the stated relationship: a pupil, a colleague and a head teacher all address a teacher with «Siz».",
      "Mention the subject or school only if the user supplied it; do not invent the school's name or the teacher's length of service.",
      "End with a wish about pupils and health — the two wishes this genre expects.",
    ],
    "Teacher's day greeting",
  ),
  greetingType(
    "tugilgan-kun",
    { uz: "Tug'ilgan kun", ru: "День рождения", en: "Birthday" },
    "Tug'ilgan kun tabrigi — yosh aytilmaydi (foydalanuvchi so'ramasa)",
    "Tug'ilgan kun",
    [
      "Birthday greeting: open by naming the person and the day, then wish things that belong to their life stage as the user described it.",
      "Never state an age, a year or a number of years unless the user gave it — an invented age turns the greeting into an embarrassment.",
      "One personal detail beats three generic wishes; if the user gave no details, keep it short rather than padding with clichés.",
      "Close with a single warm wish, said the way one says it aloud at a table.",
    ],
    "Birthday greeting",
  ),
  greetingType(
    "bitiruv",
    { uz: "Bitiruv", ru: "Выпускной", en: "Graduation" },
    "Maktab yoki OTM bitiruvi — yangi bosqich tilagi",
    "Bitiruv marosimi",
    [
      "Graduation greeting: acknowledge the effort that ended and the step that begins — both, in that order.",
      "Address the graduates (or the single graduate) directly; if the user named the school or faculty, use it exactly as given and invent nothing else.",
      "Avoid warnings and advice-giving: this genre congratulates, it does not lecture.",
      "Close with a wish for the road ahead, one sentence.",
    ],
    "Graduation greeting",
  ),
  greetingType(
    "8-mart",
    { uz: "8-mart", ru: "8 марта", en: "Women's day" },
    "Xalqaro xotin-qizlar kuni tabrigi",
    "8-mart — Xalqaro xotin-qizlar kuni",
    [
      "Women's day greeting: warm and respectful; the addressee is congratulated as a person, not as a set of roles assigned to her.",
      "Spring imagery is expected in this genre but one image is enough — three make it a greeting card, not a spoken text.",
      "Keep the respectful «Siz» form; familiarity here reads as disrespect when the text is played aloud in a room.",
      "Close with a wish for health and for the things she herself cares about, as the user described them.",
    ],
    "Women's day greeting",
  ),
  greetingType(
    "navroz",
    { uz: "Navro'z", ru: "Навруз", en: "Navruz" },
    "21-mart — Navro'z bayrami tabrigi",
    "Navro'z bayrami",
    [
      "Navruz greeting: the holiday is the renewal of the year — new beginnings, the first day of spring, the table shared with family.",
      "Traditional elements (sumalak, the shared table, neighbours) may appear, but describe them as a wish for the addressee, not as an encyclopaedia entry about the holiday.",
      "Keep it sayable aloud at a gathering: short sentences, no dates, no historical explanations.",
      "Close with a wish for abundance and peace in the addressee's home.",
    ],
    "Navruz greeting",
  ),
];

export const AUDIO_TYPES: { [K in AudioKind]: readonly SpecByKind[K][] } = {
  podcast: PODCAST_TYPES,
  greeting: GREETING_TYPES,
};

/* ══════════════════════════ hisobot qoidalari ══════════════════════════ */

/**
 * Deterministik hisobot qoidalari — hisobotlar §4 dagi `ReviewCheck`
 * id lari. BU YERDA faqat NOMLAR: implementatsiya WP-A
 * (`audio/review.ts`) da. Ro'yxat shu yerda, chunki hisobot paneli qaysi
 * bandlar bo'lishini oldindan bilishi kerak, va chunki qoidani unutib
 * qo'yish testda ko'rinadi.
 *
 * `lineLength` ikkala kindda ham bor va u BEZAK emas: 900 belgidan uzun
 * replika TTS bo'lagiga sig'maydi (`tts.md` §3) — ya'ni bu qoida
 * hisobotda sariq bo'lsa, audio ham ikkiga bo'linib ketardi.
 */
export const AUDIO_RULE_IDS: Record<AudioKind, readonly string[]> = {
  podcast: ["durationWords", "blockCount", "speakerBalance", "lineLength", "hookPresent", "closingPresent", "noWrittenOnly", "noFakeStats"],
  greeting: ["durationWords", "addresseeNamed", "occasionMatch", "lineLength", "closingPresent", "noWrittenOnly", "respectForm"],
};

/* ══════════════════════════ kirish nuqtalari ══════════════════════════ */

/** Vosita id → kind; audio vositasi bo'lmasa `null`. */
export function audioKindOf(toolId: string): AudioKind | null {
  return isAudioToolId(toolId) ? AUDIO_TOOL_IDS[toolId] : null;
}

/** Kindning barcha turlari (forma tartibida; birinchisi — standart). */
export function audioTypesOf<K extends AudioKind>(kind: K): readonly SpecByKind[K][] {
  return AUDIO_TYPES[kind];
}

/** Kind × tur; noma'lum/bo'sh tur → kindning STANDART turi (birinchisi). */
export function audioTypeOf<K extends AudioKind>(kind: K, id: unknown): SpecByKind[K] {
  const list = AUDIO_TYPES[kind] as readonly SpecByKind[K][];
  const want = String(id ?? "").trim();
  return list.find((t) => t.id === want) ?? list[0];
}

/** Kindning standart tur id si (forma va dvigatel bir xil qoidadan o'qisin). */
export function audioDefaultTypeId(kind: AudioKind): string {
  return AUDIO_TYPES[kind][0].id;
}

/** Noma'lum tur → standart id (`normalizeGameType` naqshi). */
export function normalizeAudioType(kind: AudioKind, v: unknown): string {
  return audioTypeOf(kind, v).id;
}
