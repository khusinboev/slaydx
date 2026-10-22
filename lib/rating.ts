/**
 * App rating bonus (owner request 2026-10-22, docs/program-17/PLAN.md item 9): pure rules shared by
 * the service (`lib/server/ratings.ts`, authoritative), the web card (live hint) and the bot.
 *
 * A rating is 1-5 stars plus MANDATORY written feedback. The feedback must look like real text, so
 * typing random letters does not earn the bonus. The checks are heuristics for Latin / Cyrillic
 * (Uzbek, Russian, English); they reject mashes, repeats and filler, not opinions.
 */

/** `app_settings` key of the one-time reward in bonus so'm. */
export const RATING_BONUS_KEY = "bonus.rating_points";
export const RATING_BONUS_DEFAULT = 500;
export const RATING_BONUS_MAX = 100_000;

export const RATING_MIN_CHARS = 30;
export const RATING_MAX_CHARS = 1000;
export const RATING_MIN_WORDS = 5;

/** Ledger reference (unique per user => paid at most once) and note (`ledgerTitle` maps it back). */
export function ratingRef(userId: string): string {
  return `rating:${userId}`;
}
export const RATING_NOTE = "Baholash bonusi";

export type FeedbackCode = "too_short" | "too_long" | "too_few_words" | "not_text" | "repetitive" | "gibberish";

export type FeedbackCheck = { ok: true; text: string } | { ok: false; code: FeedbackCode; message: string };

const MESSAGES: Record<FeedbackCode, string> = {
  too_short: `Fikringiz kamida ${RATING_MIN_CHARS} ta belgidan iborat bo'lsin.`,
  too_long: `Fikr ${RATING_MAX_CHARS} belgidan oshmasin.`,
  too_few_words: `Fikringizda kamida ${RATING_MIN_WORDS} ta so'z bo'lsin.`,
  not_text: "Fikrni so'z bilan yozing: harflar matnning asosiy qismi bo'lishi kerak.",
  repetitive: "Bir xil harf yoki so'z juda ko'p takrorlangan. Fikringizni o'z so'zlaringiz bilan yozing.",
  gibberish: "Matn mazmunli ko'rinmayapti. Ilova haqida o'z fikringizni oddiy so'zlar bilan yozing.",
};

const bad = (code: FeedbackCode): FeedbackCheck => ({ ok: false, code, message: MESSAGES[code] });

/** A word: letters, with apostrophes / hyphens inside (o'qituvchi, ko‘rdim, qulay-da). */
const WORD_RE = /\p{L}(?:[\p{L}'ʻʼ’‘`-]*\p{L})?/gu;
const VOWELS = new Set([..."aeiouyаеёиоуыэюяўәөүі"]);
/** Keyboard rows (Latin QWERTY, Cyrillic ЙЦУКЕН); a run of 4 neighbours, forward or backward, is a mash. */
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "йцукенгшщзхъ", "фывапролджэ", "ячсмитьбю", "ғқҳўшҷ"];
const MASH_RUNS = new Set<string>();
for (const row of ROWS) {
  for (let i = 0; i + 4 <= row.length; i++) {
    const run = row.slice(i, i + 4);
    MASH_RUNS.add(run);
    MASH_RUNS.add([...run].reverse().join(""));
  }
}

function lettersOf(word: string): string {
  return word.replace(/[^\p{L}]/gu, "");
}

/** Whether one word looks like a keyboard mash / repeated chunk rather than a word. */
export function isJunkWord(word: string): boolean {
  const w = lettersOf(word).toLowerCase();
  if (w.length < 3) return false;
  if (/(.)\1{3,}/u.test(w)) return true; // «aaaa»
  for (let i = 0; i + 4 <= w.length; i++) if (MASH_RUNS.has(w.slice(i, i + 4))) return true; // «asdf», «qwer», «ячсм»
  const chars = [...w];
  const vowels = chars.filter((c) => VOWELS.has(c)).length;
  if (chars.length >= 3 && vowels === 0) return true; // «sdfg», «fgh»: no real word of 3+ letters lacks vowels
  if (chars.length >= 6 && vowels / chars.length < 0.16) return true; // «bcdfgh»
  if (chars.length >= 6) {
    const bigrams = new Set<string>();
    for (let i = 0; i + 2 <= chars.length; i++) bigrams.add(chars[i]! + chars[i + 1]!);
    if (bigrams.size / (chars.length - 1) < 0.6) return true; // «asdasdasd», «lalalala»
  }
  return false;
}

/** Collapses whitespace and trims: the stored form of the feedback. */
export function normalizeFeedback(raw: unknown): string {
  return typeof raw === "string" ? raw.normalize("NFC").replace(/\s+/gu, " ").trim() : "";
}

/**
 * Checks the feedback text (the ONE rule set; the web hint and the service both call it).
 *  - trimmed length >= 30 (and <= 1000);
 *  - letters are >= 60 % of the non-space characters (digits / emoji / punctuation alone fail);
 *  - >= 5 words of >= 2 letters;
 *  - no single letter is more than 40 % of the letters;
 *  - no word of 4+ letters repeats more than 3 times, and >= 4 different words;
 *  - at most 25 % of the words look like keyboard mashes (and >= 5 real words remain).
 */
export function checkFeedback(raw: unknown): FeedbackCheck {
  const text = normalizeFeedback(raw);
  if ([...text].length < RATING_MIN_CHARS) return bad("too_short");
  if ([...text].length > RATING_MAX_CHARS) return bad("too_long");

  const nonSpace = [...text].filter((c) => !/\s/u.test(c));
  const letters = nonSpace.filter((c) => /\p{L}/u.test(c));
  if (letters.length / nonSpace.length < 0.6) return bad("not_text");

  const words = (text.match(WORD_RE) ?? []).filter((w) => lettersOf(w).length >= 2);
  if (words.length < RATING_MIN_WORDS) return bad("too_few_words");

  const counts = new Map<string, number>();
  for (const l of letters) counts.set(l.toLowerCase(), (counts.get(l.toLowerCase()) ?? 0) + 1);
  if (Math.max(...counts.values()) / letters.length > 0.4) return bad("repetitive");

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w.toLowerCase(), (freq.get(w.toLowerCase()) ?? 0) + 1);
  for (const [w, n] of freq) if (lettersOf(w).length >= 4 && n > 3) return bad("repetitive");
  if (freq.size < 4) return bad("repetitive");

  const junk = words.filter(isJunkWord).length;
  if (junk / words.length > 0.25 || words.length - junk < RATING_MIN_WORDS) return bad("gibberish");
  return { ok: true, text };
}

/** `1..5` integer. */
export function isStars(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

/** Live hint under the textarea: what is still missing, or `null` when the text passes. */
export function feedbackHint(raw: string): string | null {
  const text = normalizeFeedback(raw);
  const len = [...text].length;
  if (len < RATING_MIN_CHARS) return `Yana kamida ${RATING_MIN_CHARS - len} ta belgi kerak (${len}/${RATING_MIN_CHARS}).`;
  const c = checkFeedback(text);
  return c.ok ? null : c.message;
}
