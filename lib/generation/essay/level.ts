/**
 * ESSAY CEFR LEVEL (mobile sprint, package G — `docs/mobile/R4-essay-level.md`).
 *
 * One pure, isomorphic module (no server imports) that owns EVERYTHING the
 * level means: the parameter values, the per-level prompt block for the
 * three essay languages (uz/ru/en), the deterministic measure of a written
 * text, the thresholds the measure is judged against, the level-scaled
 * structure minimums, and the Uzbek UI table the form renders.
 *
 * Why one module: the prompt, the review rule, the engine's repair pass and
 * the form caption must quote the SAME numbers — the form caption «~13 so‘z»
 * and the prompt's «average about 13 words» come from `LEVEL_BANDS`, so they
 * cannot drift apart.
 *
 * CEFR is an L2-learner scale, not a text-complexity standard; here it is a
 * "complexity dial" (sentence length, clause depth, vocabulary, terminology).
 * The UI says «matn murakkabligi», never "certified A2".
 *
 * THRESHOLDS ARE HEURISTICS (English readability rules of thumb; ru ≈ ×0.9,
 * uz ≈ ×0.75 because Uzbek is agglutinative: «Men maktabda o‘qiyman» = 3
 * words vs 5 in English). They are NOT measured on our outputs yet — the
 * lead calibrates them with `scripts/level-measure.mts` and the live matrix
 * (R4 §5). Every number lives in the tables below; logic never hard-codes one.
 *
 * Legacy rule: a document without a level (`EssayModel.level` absent) and
 * every IELTS essay get `null` — no prompt block, no rule, no judge note,
 * byte-identical prompts (`tests/essay-legacy-snapshot.json`).
 */
import type { EssayLang } from "./registry";
import type { EssayContextId } from "./types";

/* ────────────────────────── values ────────────────────────── */

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Owner decision O3 (2026-10-04): B2 when the user does not choose. */
export const DEFAULT_ESSAY_LEVEL: CefrLevel = "B2";

export function isCefrLevel(v: unknown): v is CefrLevel {
  return typeof v === "string" && (CEFR_LEVELS as readonly string[]).includes(v);
}

/** «b1», « C2 » → level; anything else → null. */
export function parseCefrLevel(v: unknown): CefrLevel | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  return isCefrLevel(s) ? s : null;
}

/** IELTS has its own band scale (owner decision O3): no CEFR control there. */
export function levelAppliesTo(context: EssayContextId): boolean {
  return context !== "ielts_task2";
}

/**
 * The level the engine uses for a form submission: IELTS → null whatever a
 * stale draft carries; missing/invalid → `DEFAULT_ESSAY_LEVEL`.
 */
export function essayLevelOf(context: EssayContextId, raw: unknown): CefrLevel | null {
  if (!levelAppliesTo(context)) return null;
  return parseCefrLevel(raw) ?? DEFAULT_ESSAY_LEVEL;
}

/* ────────────────────────── thresholds (ONE table) ────────────────────────── */

/**
 * Words per sentence, per output language and level:
 *   lo–hi   band for the MEAN sentence length (green inside);
 *   cap     a sentence longer than this counts as "over cap" (C2: soft cap);
 *   target  the number the prompt and the form caption quote (strictly
 *           increasing, ≥ 20 % apart — `tests/essay-level.test.mts`).
 * Bands of neighbouring levels overlap on purpose (levels are a continuum).
 */
export type LevelBand = { lo: number; hi: number; cap: number; target: number };

export const LEVEL_BANDS: Record<EssayLang, Record<CefrLevel, LevelBand>> = {
  en: {
    A1: { lo: 4, hi: 8, cap: 12, target: 6 },
    A2: { lo: 7, hi: 12, cap: 18, target: 9 },
    B1: { lo: 11, hi: 16, cap: 24, target: 13 },
    B2: { lo: 14, hi: 21, cap: 32, target: 17 },
    C1: { lo: 17, hi: 26, cap: 42, target: 21 },
    C2: { lo: 19, hi: 32, cap: 52, target: 26 },
  },
  ru: {
    A1: { lo: 4, hi: 7, cap: 11, target: 5 },
    A2: { lo: 6, hi: 11, cap: 16, target: 8 },
    B1: { lo: 10, hi: 14, cap: 22, target: 12 },
    B2: { lo: 13, hi: 19, cap: 29, target: 15 },
    C1: { lo: 15, hi: 23, cap: 38, target: 19 },
    C2: { lo: 17, hi: 29, cap: 47, target: 23 },
  },
  uz: {
    A1: { lo: 3, hi: 6, cap: 9, target: 5 },
    A2: { lo: 5, hi: 9, cap: 14, target: 7 },
    B1: { lo: 8, hi: 12, cap: 18, target: 10 },
    B2: { lo: 10, hi: 16, cap: 24, target: 13 },
    C1: { lo: 13, hi: 20, cap: 32, target: 16 },
    C2: { lo: 14, hi: 24, cap: 39, target: 20 },
  },
};

/**
 * Share of sentences allowed over `cap` before the verdict leaves green.
 * R4 proposed 0 % for A1/A2; 5 % is used so one splitter error (a few % of
 * sentences, R4 §3.4) does not trigger a paid repair call by itself.
 */
export const OVER_CAP_ALLOWED: Record<CefrLevel, number> = { A1: 0.05, A2: 0.05, B1: 0.1, B2: 0.1, C1: 0.1, C2: 0.1 };

/** Yellow ↔ red: relative distance of the mean from the band edge, and extra over-cap share. */
export const LEVEL_YELLOW_MARGIN = 0.25;

/** Fewer sentences than this → the text is too short to judge (verdict green, "not measured"). */
export const LEVEL_MIN_SENTENCES = 3;

/**
 * "Long word" length per language — INFORMATIONAL only (shown in the report,
 * never gates). Not computed for Uzbek: agglutination makes word length
 * meaningless there.
 */
export const LONG_WORD_MIN: Record<EssayLang, number | null> = { en: 7, ru: 9, uz: null };

export function levelTargets(level: CefrLevel, lang: EssayLang): LevelBand {
  return LEVEL_BANDS[lang][level];
}

/* ────────────────────────── descriptors (prompt data) ────────────────────────── */

type Figurative = "none" | "minimal" | "light" | "free";
type Hedging = "none" | "simple" | "free";

export type CefrSpec = {
  /** English name for the prompt. */
  name: string;
  clauses: string;
  vocabulary: string;
  terminology: string;
  style: string;
  figurative: Figurative;
  hedging: Hedging;
};

export const CEFR_SPECS: Record<CefrLevel, CefrSpec> = {
  A1: {
    name: "beginner",
    clauses: "one clause per sentence; no subordinate clauses; at most one «and/but/because» link in a sentence",
    vocabulary: "only the most frequent everyday words (about 500); concrete nouns and verbs; no abstract nouns, no idioms",
    terminology: "no terms at all — replace every term with a plain word or a short description",
    style: "present tense (simple past where needed); repeating the same simple words is fine; no figurative language",
    figurative: "none",
    hedging: "none",
  },
  A2: {
    name: "elementary",
    clauses: "one or two clauses; only simple «when / if / because» clauses",
    vocabulary: "common everyday words plus the most frequent words of the topic; no idioms",
    terminology: "at most one term per paragraph, explained in the same sentence",
    style: "plain and direct; at most one simple comparison in the whole essay; no chains of passive verbs",
    figurative: "minimal",
    hedging: "simple",
  },
  B1: {
    name: "intermediate",
    clauses: "mostly two clauses; simple relative clauses are fine",
    vocabulary: "familiar topic vocabulary and a few common collocations or idioms",
    terminology: "common terms only, each defined at first use",
    style: "clear and plain; light figurative use (a few simple comparisons, not in every paragraph)",
    figurative: "light",
    hedging: "simple",
  },
  B2: {
    name: "upper-intermediate",
    clauses: "two or three clauses; varied sentence openings, passives and conditionals",
    vocabulary: "broad topic vocabulary, precise verbs, natural collocations",
    terminology: "topic terminology used freely; uncommon terms explained briefly",
    style: "argued and well organised; moderate hedging («tends to», «is likely to»)",
    figurative: "free",
    hedging: "free",
  },
  C1: {
    name: "advanced",
    clauses: "three or more clauses where useful; nominalisation, participial constructions; vary the rhythm (mix long and short sentences)",
    vocabulary: "wide, precise, discipline-specific; low-frequency words where they are exact; idiom and implicit meaning",
    terminology: "exact discipline terminology without explanation",
    style: "fluent academic or literary register, nuanced hedging, implicit cohesion (not only connectors)",
    figurative: "free",
    hedging: "free",
  },
  C2: {
    name: "proficient",
    clauses: "free: rhetorical periodic sentences alongside deliberately short ones",
    vocabulary: "the full range: connotation, irony, stylistic choice; idioms, proverbs and rare words used naturally",
    terminology: "assumed shared knowledge; no definitions",
    style: "mastery: rhetorical figures, a distinct voice, precise nuance",
    figurative: "free",
    hedging: "free",
  },
};

/**
 * Connectors introduced AT each level, per output language. The prompt
 * shows the level's own set plus the previous level's as "simpler ones".
 * Uzbek/Russian lists are drafts — a native reader should check them
 * (data only, no logic depends on the words).
 */
export const LEVEL_CONNECTORS: Record<CefrLevel, Record<EssayLang, readonly string[]>> = {
  A1: { en: ["and", "but", "because", "then"], uz: ["va", "lekin", "chunki", "keyin"], ru: ["и", "но", "потому что", "потом"] },
  A2: {
    en: ["so", "first", "then", "finally", "when", "if"],
    uz: ["shuning uchun", "agar", "qachonki", "avval", "keyin", "oxirida"],
    ru: ["поэтому", "если", "когда", "сначала", "затем", "наконец"],
  },
  B1: {
    en: ["however", "for example", "although", "as a result", "also"],
    uz: ["biroq", "masalan", "garchi", "natijada", "shuningdek"],
    ru: ["однако", "например", "хотя", "в результате", "также"],
  },
  B2: {
    en: ["moreover", "on the other hand", "in contrast", "therefore", "whereas", "despite"],
    uz: ["bundan tashqari", "boshqa tomondan", "aksincha", "shu sababli", "holbuki", "…ga qaramay"],
    ru: ["кроме того", "с другой стороны", "напротив", "следовательно", "в то время как", "несмотря на"],
  },
  C1: {
    en: ["nevertheless", "consequently", "furthermore", "thus"],
    uz: ["shunga qaramay", "binobarin", "shu bilan birga", "demak"],
    ru: ["тем не менее", "вместе с тем", "таким образом", "более того"],
  },
  C2: {
    en: ["granted", "that said", "insofar as", "admittedly"],
    uz: ["gap shundaki", "aytish joiz", "shu ma’noda", "tan olish kerakki"],
    ru: ["впрочем", "надо признать", "постольку поскольку", "стало быть"],
  },
};

const LANG_NAME: Record<EssayLang, string> = { uz: "Uzbek", ru: "Russian", en: "English" };

const levelIndex = (l: CefrLevel) => CEFR_LEVELS.indexOf(l);

/* ────────────────────────── prompt ────────────────────────── */

function sentenceLine(level: CefrLevel, lang: EssayLang): string {
  const b = levelTargets(level, lang);
  const cap = level === "C2" ? `rarely longer than ${b.cap} words` : `never longer than ${b.cap} words`;
  return `Sentences: average about ${b.target} words per sentence in ${LANG_NAME[lang]} (acceptable average ${b.lo}–${b.hi}), ${cap}; ${CEFR_SPECS[level].clauses}.`;
}

function connectorLine(level: CefrLevel, lang: EssayLang): string {
  const own = LEVEL_CONNECTORS[level][lang];
  const i = levelIndex(level);
  if (i === 0) return `Connectors: use only ${own.map((w) => `«${w}»`).join(", ")} — no other linking words.`;
  const simpler = LEVEL_CONNECTORS[CEFR_LEVELS[i - 1]][lang];
  const ceiling = level === "C2" ? "" : " Do not use connectors typical of a higher level.";
  return `Connectors: such as ${own.map((w) => `«${w}»`).join(", ")}, and simpler ones (${simpler.map((w) => `«${w}»`).join(", ")}).${ceiling}`;
}

/**
 * The block placed in the essay SYSTEM prompt (every call — outline, write,
 * word-range retry, level repair, rewrite/polish — inherits it). The last
 * sentence makes the level win over kind guidance and over the author's
 * free-text «Qo‘shimcha» on complexity.
 */
export function levelPromptBlock(level: CefrLevel, lang: EssayLang): string {
  const s = CEFR_SPECS[level];
  return [
    `WRITING LEVEL — CEFR ${level} (${s.name}). This is a hard constraint on style; the STRUCTURE rules above (thesis, topic sentences, counter-argument, paragraph count, word budget) stay, but express them AT THIS LEVEL.`,
    ` • ${sentenceLine(level, lang)}`,
    ` • Vocabulary: ${s.vocabulary}.`,
    ` • ${connectorLine(level, lang)}`,
    ` • Terminology: ${s.terminology}.`,
    ` • Style: ${s.style}.`,
    ` The level OVERRIDES any request in this prompt for richer vocabulary, figurative language, hedging or longer sentences, and it overrides the author's additional requirements about sentence length or complexity. Do NOT write above or below this level; never mention the level in the text.`,
  ].join("\n");
}

/** Two-line reminder for USER prompts (the user prompt is attended to more than the system prompt). */
export function levelReminder(level: CefrLevel, lang: EssayLang): string {
  const b = levelTargets(level, lang);
  return `LEVEL: write at CEFR ${level} (${CEFR_SPECS[level].name}) — about ${b.target} words per sentence, ${level === "C2" ? "rarely" : "never"} over ${b.cap}; vocabulary and terminology as the WRITING LEVEL rules say. The level beats any wish for richer or simpler style.`;
}

/**
 * Instruction for a level fix (review rule «Til darajasi» → «Tuzatish», and
 * the engine's repair pass). `direction` says which way the text missed.
 */
export function levelRepairInstruction(level: CefrLevel, lang: EssayLang, direction: "high" | "low" | null = null): string {
  const b = levelTargets(level, lang);
  const how =
    direction === "high"
      ? "split long sentences, remove subordinate chains, replace rare or abstract words with common ones"
      : direction === "low"
        ? "combine choppy sentences, add precise vocabulary and varied clause structure — without padding"
        : "adjust sentence length and vocabulary to the level";
  return `Rewrite the whole essay at CEFR ${level} (${CEFR_SPECS[level].name}): average about ${b.target} words per sentence (acceptable ${b.lo}–${b.hi}), ${level === "C2" ? "rarely" : "no sentence"} longer than ${b.cap} words; ${how}. Keep the structure, every paragraph's thought, the thesis, every USER FACT verbatim, the same language and the same length.`;
}

/** Judge calibration (R4 §2 #1): the judge must not pull a deliberate A2 text upward. */
export function levelJudgeNote(level: CefrLevel): string {
  const s = CEFR_SPECS[level];
  return `TARGET LEVEL: the essay is DELIBERATELY written at CEFR ${level} (${s.name}: ${s.clauses}; ${s.vocabulary}). Judge vocabulary, sentence-variety and language-richness criteria against THIS target: do not penalise simplicity that matches the level; penalise errors, repetition and a mismatch with the level in either direction. Never propose a fix that raises or lowers the level.`;
}

/* ────────────────────────── kind guidance vs level ────────────────────────── */

const FIGURATIVE_RE = /figurative/i;
const HEDGING_RE = /hedg/i;

const FIGURATIVE_LINE: Record<Exclude<Figurative, "free">, string> = {
  none: "No figurative language (no metaphors, personification or epithets): describe with plain, concrete words.",
  minimal: "At most ONE simple comparison («like …») in the whole essay; otherwise describe with plain, concrete words.",
  light: "Light figurative language: a few simple comparisons or epithets in the whole essay, not in every paragraph.",
};

const HEDGING_LINE: Record<Exclude<Hedging, "free">, string> = {
  none: "Register is impersonal (no «I think»); state claims plainly in short sentences — no hedging phrases.",
  simple: "Register is impersonal (no «I think»); soften strong claims only with simple words («may», «often», «usually»).",
};

/**
 * Kind guidance (`registry.ts`) asks for figurative language «at least once
 * per paragraph» and for hedging — both push a text upward (R4 §2 #3). At
 * low levels those lines are REPLACED by a level-appropriate version; the
 * structural guidance lines stay untouched. `null` → lines unchanged.
 */
export function levelGuidance(lines: readonly string[], level: CefrLevel | null): string[] {
  if (!level) return [...lines];
  const s = CEFR_SPECS[level];
  return lines.map((g) => {
    if (FIGURATIVE_RE.test(g) && s.figurative !== "free") return FIGURATIVE_LINE[s.figurative];
    if (HEDGING_RE.test(g) && s.hedging !== "free") return HEDGING_LINE[s.hedging];
    return g;
  });
}

/* ────────────────────────── level-scaled structure numbers ────────────────────────── */

/** Pre-level values (legacy docs and IELTS keep them exactly). */
export const LEGACY_THESIS_WORDS: [number, number] = [12, 35];
export const LEGACY_CLAIM_MIN = { thesis: 8, topic: 5 } as const;

const THESIS_BASE: Record<CefrLevel, [number, number]> = {
  A1: [6, 10],
  A2: [8, 14],
  B1: [10, 20],
  B2: [12, 28],
  C1: [14, 35],
  C2: [14, 35],
};

/** Thesis length asked in the outline; never above the level's sentence cap. */
export function thesisWordRange(level: CefrLevel | null, lang: EssayLang): [number, number] {
  if (!level) return LEGACY_THESIS_WORDS;
  const [lo, hi] = THESIS_BASE[level];
  const top = Math.min(hi, levelTargets(level, lang).cap);
  return [Math.min(lo, top - 2), top];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Minimum words of a thesis / topic sentence in the review (R4 §2 #2): the
 * fixed 8/5 made a natural A1 thesis («Kitob bizga bilim beradi.») red.
 */
export function claimMinWords(level: CefrLevel | null, lang: EssayLang): { thesis: number; topic: number } {
  if (!level) return { ...LEGACY_CLAIM_MIN };
  const t = levelTargets(level, lang).target;
  return { thesis: clamp(Math.round(0.8 * t), 4, LEGACY_CLAIM_MIN.thesis), topic: clamp(Math.round(0.6 * t), 3, LEGACY_CLAIM_MIN.topic) };
}

/* ────────────────────────── measure ────────────────────────── */

const WORD_RE = /\p{L}[\p{L}\p{M}]*(?:['’‘ʻʼ`]\p{L}[\p{L}\p{M}]*)*|\d+(?:[.,]\d+)*/gu;

export function wordTokens(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/** Lower-case abbreviations that may be followed by a capitalised word without ending a sentence. */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "mas", "проф", "акад", "им", "ул"]);

const OPENING = /^[\p{Lu}\p{N}«"“„‘(\[—–-]/u;
const END_RE = /[.!?…]+["»”’)\]]*/gu;

/** True when the token before a «.» is an initial («A.», «G‘.», «Sh.») or a known abbreviation. */
function isAbbreviationBefore(before: string): boolean {
  const m = /([\p{L}]+(?:['’‘ʻʼ`][\p{L}]*)?)$/u.exec(before);
  if (!m) return false;
  const tok = m[1];
  const letters = tok.replace(/['’‘ʻʼ`]/g, "");
  if (/^\p{Lu}$/u.test(letters)) return true; // «A.»
  if (/^\p{Lu}['’‘ʻʼ`]$/u.test(tok)) return true; // «G‘.», «O‘.»
  if (/^(Sh|Ch|Ng)$/u.test(letters)) return true; // Uzbek digraph initials
  return ABBREVIATIONS.has(tok.toLowerCase());
}

/**
 * Language-aware sentence splitter (NOT `review.ts sentencesOf`, which
 * splits after every dot): a boundary is `[.!?…]` (+ closing quote/bracket)
 * followed by whitespace and a token that starts like a sentence (capital,
 * digit, opening quote, dialogue dash), or a line break. Initials and a
 * SHORT abbreviation list never end a sentence; decimals («3.5») have no
 * whitespace so they never split.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const p = para.replace(/\s+/g, " ").trim();
    if (!p) continue;
    let start = 0;
    END_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = END_RE.exec(p))) {
      const end = m.index + m[0].length;
      const rest = p.slice(end);
      if (rest && !/^\s/.test(rest)) continue;
      const next = rest.trimStart();
      if (next && !OPENING.test(next)) continue;
      if (m[0].startsWith(".") && m[0].length === 1 && isAbbreviationBefore(p.slice(start, m.index))) continue;
      const s = p.slice(start, end).trim();
      if (s) out.push(s);
      start = end;
    }
    const tail = p.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out.filter((s) => wordTokens(s).length > 0);
}

export type LevelMeasure = {
  sentences: number;
  words: number;
  /** Mean words per sentence — the PRIMARY metric. */
  mean: number;
  max: number;
  /** Words per sentence, in order (over-cap share is computed per level). */
  lengths: number[];
  /** Clause proxy — informational. */
  commasPerSentence: number;
  /** Share of long words (en ≥ 7 letters, ru ≥ 9) — informational; `null` for Uzbek. */
  longWordShare: number | null;
};

export function measureLevel(text: string, lang: EssayLang): LevelMeasure {
  const sentences = splitSentences(text);
  const lengths = sentences.map((s) => wordTokens(s).length);
  const words = lengths.reduce((a, b) => a + b, 0);
  const commas = sentences.reduce((n, s) => n + (s.match(/[,;]/g) ?? []).length, 0);
  const longMin = LONG_WORD_MIN[lang];
  let longWordShare: number | null = null;
  if (longMin !== null) {
    const tokens = wordTokens(text).filter((w) => !/^\d/.test(w));
    longWordShare = tokens.length ? tokens.filter((w) => w.replace(/['’‘ʻʼ`]/g, "").length >= longMin).length / tokens.length : 0;
  }
  return {
    sentences: sentences.length,
    words,
    mean: sentences.length ? words / sentences.length : 0,
    max: lengths.length ? Math.max(...lengths) : 0,
    lengths,
    commasPerSentence: sentences.length ? commas / sentences.length : 0,
    longWordShare,
  };
}

export type LevelVerdict = {
  level: "green" | "yellow" | "red";
  /** Which way the text missed: «high» = too complex, «low» = too simple. */
  direction: "high" | "low" | null;
  band: LevelBand;
  overCapShare: number;
  /** 0 = on level; larger = further away (`levelDistance`). */
  distance: number;
  /** Too few sentences to judge. */
  unmeasured: boolean;
};

export function levelVerdict(m: LevelMeasure, level: CefrLevel, lang: EssayLang): LevelVerdict {
  const band = levelTargets(level, lang);
  const overCapShare = m.sentences ? m.lengths.filter((n) => n > band.cap).length / m.sentences : 0;
  if (m.sentences < LEVEL_MIN_SENTENCES) return { level: "green", direction: null, band, overCapShare, distance: 0, unmeasured: true };
  const meanOff = m.mean < band.lo ? (band.lo - m.mean) / band.lo : m.mean > band.hi ? (m.mean - band.hi) / band.hi : 0;
  const capOff = Math.max(0, overCapShare - OVER_CAP_ALLOWED[level]);
  const distance = meanOff + capOff;
  const direction: LevelVerdict["direction"] = m.mean < band.lo ? "low" : m.mean > band.hi || capOff > 0 ? "high" : null;
  const level3: LevelVerdict["level"] = distance === 0 ? "green" : meanOff > LEVEL_YELLOW_MARGIN || capOff > LEVEL_YELLOW_MARGIN ? "red" : "yellow";
  return { level: level3, direction, band, overCapShare, distance, unmeasured: false };
}

/** Scalar distance to the level (0 = on level) — the repair pass accepts only a strict improvement. */
export function levelDistance(m: LevelMeasure, level: CefrLevel, lang: EssayLang): number {
  return levelVerdict(m, level, lang).distance;
}

const num1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1).replace(".", ",");
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Report detail, Uzbek: «B1: o‘rtacha gap 13,2 so‘z (kerak 10–14) · eng uzun 31 · vergul/gap 1,4». */
export function levelDetail(m: LevelMeasure, v: LevelVerdict, level: CefrLevel): string {
  if (v.unmeasured) return `${level}: matn juda qisqa — daraja o‘lchanmadi`;
  const parts = [`${level}: o‘rtacha gap ${num1(m.mean)} so‘z (kerak ${v.band.lo}–${v.band.hi})`, `eng uzun ${m.max}`];
  if (v.overCapShare > 0) parts.push(`${v.band.cap} so‘zdan uzun gaplar ${pct(v.overCapShare)}`);
  parts.push(`vergul/gap ${num1(m.commasPerSentence)}`);
  if (m.longWordShare !== null) parts.push(`uzun so‘zlar ${pct(m.longWordShare)}`);
  const tail = v.direction === "high" ? " — matn darajadan murakkab" : v.direction === "low" ? " — matn darajadan sodda" : "";
  return parts.join(" · ") + tail;
}

/* ────────────────────────── UI table (Uzbek) ────────────────────────── */

export type CefrUi = { id: CefrLevel; name: string; phrase: string };

/** Form labels: buttons show only the code; the caption under the control shows name + phrase. */
export const CEFR_UI: readonly CefrUi[] = [
  { id: "A1", name: "Boshlang‘ich", phrase: "juda qisqa, sodda gaplar, atamasiz" },
  { id: "A2", name: "Sodda", phrase: "qisqa gaplar, oddiy bog‘lovchilar" },
  { id: "B1", name: "O‘rta", phrase: "ravshan gaplar, atamalar izohli" },
  { id: "B2", name: "O‘rta-yuqori", phrase: "qo‘shma gaplar, atamalar erkin" },
  { id: "C1", name: "Ilg‘or", phrase: "tarkibli gaplar, aniq atamalar" },
  { id: "C2", name: "Mukammal", phrase: "boy leksika, ritorik vositalar" },
];

/** Tooltip/footnote for the control (all levels). */
export const LEVEL_HINT = "CEFR — matn murakkabligi darajasi: gap uzunligi, so‘z boyligi, atamalar. Insho tilidan qat’i nazar ishlaydi; «Qo‘shimcha» talabidan ustun turadi.";

/** Visible one-line caption under the control; the number is the prompt's own target for that language. */
export function levelCaption(level: CefrLevel, lang: EssayLang): string {
  const ui = CEFR_UI.find((u) => u.id === level)!;
  return `${ui.name}: ${ui.phrase}, gap ~${levelTargets(level, lang).target} so‘z`;
}
