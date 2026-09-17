/**
 * AUDIO PROMPTLARI (AUDIT-22 WP-A) — `infographic/prompts.ts` naqshi.
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective`: JSON
 * sxemasi, replika soni va rollar kabi TUZILMA qoidalarini model
 * inglizcha ko'rsatmada ishonchliroq bajaradi, chiqish tilini esa
 * birinchi qator qat'iy belgilaydi.
 *
 * Bu oilada promptning YANA BIR vazifasi bor: matn AYTILADI, o'qilmaydi.
 * Shuning uchun «spoken language» qoidalari (qavs yo'q, qisqartma yo'q,
 * URL yo'q, raqam so'z bilan) prompt va hisobot (`noWrittenOnly`) da
 * IKKI TOMONDAN ushlab turiladi — ular bitta shartnoma.
 *
 * HALOLLIK CHEGARASI ikkala vositada BOSHQACHA va shuning uchun
 * alohida yozilgan:
 *   • podkast — o'ylab topilgan STATISTIKA/tadqiqot taqiqlanadi
 *     (`podcast.md` §4: tinglovchi eshitayotganda tekshira olmaydi);
 *   • tabriknoma — o'ylab topilgan SHAXSIY tafsilot (yosh, sana,
 *     «o'sha kulgingizni eslayman») taqiqlanadi (`greeting.md` §4).
 */
import { languageDirective } from "../i18n";
import { AUDIO_LIMITS } from "./types";
import type { AudioTypeSpec, PodcastTypeSpec } from "./registry";
import { wordRange } from "./script";
import type { AudioInput } from "./input";

/* ══════════════════════════ kontekst ══════════════════════════ */

export type AudioContext = { spec: AudioTypeSpec; input: AudioInput };

export const audioCtx = (spec: AudioTypeSpec, input: AudioInput): AudioContext => ({ spec, input });

const isPodcast = (s: AudioTypeSpec): s is PodcastTypeSpec => s.kind === "podcast";

/* ══════════════════════════ umumiy bloklar ══════════════════════════ */

/**
 * AYTILADIGAN matn qoidalari — ikkala vosita uchun bir xil.
 *
 * `speakability` baholovchi mezoni va `noWrittenOnly` qoidasi aynan
 * shu ro'yxatni tekshiradi.
 */
const SPOKEN_RULES = [
  "This text will be READ ALOUD by a speech engine and never shown as a document. Therefore:",
  "- every sentence must be sayable in one breath — no nested clauses, no parentheses, no dashes used as asides;",
  "- no abbreviations, no URLs, no e-mail addresses, no formulas, no bullet markers, no emoji, no markdown;",
  "- numbers, dates and percentages are written the way they are SPOKEN in the output language, not as digits with symbols;",
  "- no stage directions, no speaker names inside the text, no «[pause]» markers — pauses are added by the engine.",
].join("\n");

/** Rollar bo'limi — ovoz soniga qarab. */
function rolesBlock(speakers: number): string {
  return speakers >= 2
    ? [
        'ROLES: exactly TWO voices, written in the JSON as "A" and "B". A third speaker is not possible — the engine has two voices.',
        "Alternate turns: a block where one voice speaks three times in a row has failed the format.",
      ].join("\n")
    : 'ROLES: ONE voice only. Every line carries "speaker": "A".';
}

/** So'z byudjeti — daqiqa × 150, ±15 % (`AUDIO_LIMITS`). */
function budgetBlock(input: AudioInput): string {
  const { min, max } = wordRange(input.wordBudget);
  return [
    `LENGTH: the finished audio must run about ${input.minutes} minute${input.minutes > 1 ? "s" : ""}.`,
    `At ${AUDIO_LIMITS.wordsPerMinute} spoken words per minute that is ${input.wordBudget} words in total — write between ${min} and ${max} words across ALL lines.`,
    `Each single line stays under ${AUDIO_LIMITS.lineCharsMax} characters; ${AUDIO_LIMITS.linesMin} lines is the minimum for any length.`,
    "Counting words matters more than filling the structure: cut a wish or an example rather than overrun the budget.",
  ].join("\n");
}

/** Ssenariy skeleti reyestrdan — bloklar tartibda. */
function skeletonBlock(spec: AudioTypeSpec): string {
  return ["STRUCTURE (in this order, every part present):", ...spec.skeleton.map((s, i) => `${i + 1}. ${s}`)].join("\n");
}

/** Podkastning halollik chegarasi — manba bor/yo'qligiga qarab. */
function podcastHonesty(input: AudioInput): string {
  const grounded = Boolean(input.sourceText.trim());
  return [
    "HONESTY LIMIT (absolute):",
    grounded
      ? "- every fact, figure, name and date must come from the SOURCE TEXT below. If the source does not say it, the episode does not say it either."
      : "- the user gave NO source, so you may NOT state a statistic, a study, a survey result, a named researcher or an institution's finding. «Tadqiqotlar 73 foizni ko'rsatadi» with no source is the worst defect in this format.",
    "- where the honest answer needs a number you do not have, say what it depends on instead, or describe the direction («ko'proq», «kamayib bormoqda») without inventing a figure.",
    "- a listener cannot check anything while listening — that is exactly why an invented fact is worse here than in a written document.",
  ].join("\n");
}

/** Tabriknomaning halollik chegarasi — soxta SHAXSIY tafsilot taqiqi. */
function greetingHonesty(input: AudioInput): string {
  return [
    "HONESTY LIMIT (absolute):",
    "- you know about this person ONLY what the user wrote below. Do not invent an age, a year, a workplace, a shared memory, a number of children, an illness or an achievement.",
    '- a line like «sizning o\'sha mashhur kulgingizni eslayman» is a fabrication when the user never mentioned it; it embarrasses the person who plays the file aloud.',
    input.relation.trim()
      ? `- the stated relationship is «${input.relation}» — let the warmth follow from it, but do not invent a history for it.`
      : "- the user did not say who they are to the addressee, so keep the warmth general and respectful.",
  ].join("\n");
}

/* ══════════════════════════ tizim prompti ══════════════════════════ */

export function audioSystemPrompt(ctx: AudioContext): string {
  const { spec, input } = ctx;
  const podcast = isPodcast(spec);
  return [
    languageDirective(input.language),
    podcast
      ? `You write the script of a short educational podcast episode in Uzbek media style. Episode type: ${spec.label.en}. Return ONLY a JSON object, no prose, no markdown fence.`
      : `You write the text of a spoken congratulation that one person will play aloud to another. Genre: ${spec.label.en}. Return ONLY a JSON object, no prose, no markdown fence.`,
    "",
    "TYPE RULES:",
    ...spec.guidance.map((g) => `- ${g}`),
    "",
    skeletonBlock(spec),
    podcast ? `The three middle blocks are the body of the episode — ${(spec as PodcastTypeSpec).limits.blocks} of them, each on a different facet.` : "",
    "",
    rolesBlock(input.speakers),
    "",
    budgetBlock(input),
    "",
    SPOKEN_RULES,
    "",
    podcast ? podcastHonesty(input) : greetingHonesty(input),
    "",
    'JSON schema (keys in English, VALUES in the output language): {"script":[{"speaker":"A","text":"…"},{"speaker":"B","text":"…"}]}',
    'Write nothing outside that object — no "title", no notes, no explanation.',
  ]
    .filter(Boolean)
    .join("\n");
}

/* ══════════════════════════ foydalanuvchi prompti ══════════════════════════ */

/** Manba matn bloki — «matn/fayl» rejimida (`podcast.md` §3 `sourceBlock`). */
export function sourceBlock(input: AudioInput): string {
  const src = input.sourceText.trim();
  if (!src) return "";
  const label = input.mode === "file" ? "SOURCE TEXT (from the file the user uploaded)" : "SOURCE TEXT (pasted by the user)";
  return `${label} — the ONLY admissible source of facts for this episode:\n${src.slice(0, AUDIO_LIMITS.sourceTextChars)}`;
}

export function audioPrompt(ctx: AudioContext): string {
  const { input } = ctx;
  if (input.kind === "greeting") {
    return [
      `ADDRESSEE: ${input.recipient || "(the user did not name the addressee)"}`,
      input.relation ? `RELATIONSHIP (the speaker is the addressee's …): ${input.relation}` : "RELATIONSHIP: not stated",
      input.occasion ? `OCCASION: ${input.occasion}` : `OCCASION: the user's own words — ${input.topic || input.extra || "not stated"}`,
      input.extra ? `EXTRA INSTRUCTIONS FROM THE USER: ${input.extra}` : "",
      "",
      "Write the congratulation now. Name the addressee in the first sentence and keep the respectful form throughout.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `TOPIC: ${input.topic}`,
    `MODE: ${input.mode === "topic" ? "from the topic alone (no source supplied)" : "from the source text below"}`,
    input.extra ? `EXTRA INSTRUCTIONS FROM THE USER: ${input.extra}` : "",
    sourceBlock(input),
    "",
    "Write the script now. The opening line must make a listener stay; the last line must close the episode.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ══════════════════════════ qayta so'rov ══════════════════════════ */

/**
 * BIR MARTALIK qayta so'rov — MIQDOR bandlari buzilganda (so'z
 * byudjeti, replika soni, rol muvozanati).
 *
 * Model o'z javobini KO'RADI va aniq nima buzilganini o'qiydi: mavhum
 * «qisqaroq yoz» ko'rsatmasi matnni 5 % qisqartirib, byudjetga yana
 * tushmasdi (`infographic/prompts.ts` da o'rganilgan sabob).
 */
export function audioRetryPrompt(ctx: AudioContext, script: readonly { speaker: string; text: string }[], problems: string[]): string {
  const { min, max } = wordRange(ctx.input.wordBudget);
  return [
    "Your previous script did not meet the format. Here it is:",
    JSON.stringify({ script }),
    "",
    "Problems:",
    ...problems.map((p) => `- ${p}`),
    "",
    `Rewrite the WHOLE script keeping the same topic, the same structure and the same meaning, with the listed problems fixed. Total length must land between ${min} and ${max} words.`,
    "Cut wording, not information: drop adjectives, repeated framing and filler openings first. Return the same JSON schema.",
  ].join("\n");
}

/* ══════════════════════════ sayqal ══════════════════════════ */

/**
 * Avto-sayqal — butun ssenariyni QAYTA so'raydi (bitta replikani emas).
 *
 * Nega butunlay: suhbatdagi replikalar bir-biriga bog'liq (savol →
 * javob → ko'prik). Bitta replikani alohida qayta yozish keyingisini
 * javobsiz qoldirardi — bu plakatdagi taqqoslash juftini uzish bilan
 * ayni nuqson (`infographic/polish.ts` izohi).
 */
export function audioRewritePrompt(ctx: AudioContext, script: readonly { speaker: string; text: string }[], instructions: string[]): string {
  const { min, max } = wordRange(ctx.input.wordBudget);
  return [
    "Current script:",
    JSON.stringify({ script }),
    "",
    "Review notes to act on:",
    ...instructions.map((s, i) => `${i + 1}. ${s}`),
    "",
    `Return the improved script in the same JSON schema, still between ${min} and ${max} words in total and still ${ctx.input.speakers >= 2 ? 'using both "A" and "B"' : 'using only "A"'}.`,
    "The honesty limit still holds: you may not add a figure, a study, a date or a personal detail that is absent from the current script and from the user's own words.",
  ].join("\n");
}

/** Baholovchiga beriladigan matn (JSON emas — o'qilishi oson). */
export function judgeText(script: readonly { speaker: string; text: string }[]): string {
  return script.map((l) => `${l.speaker}: ${l.text}`).join("\n");
}
