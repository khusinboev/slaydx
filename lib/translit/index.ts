/**
 * Free Uzbek script converter (owner request 6): Cyrillic <-> current Latin <-> NEW Latin
 * (Law ЎРҚ-1184, 21.10.2026, in force 22.04.2027). Pure and deterministic — the same code
 * runs in the browser (live page) and on the server (file conversion).
 *
 *   convert("Ўзбекистон", "cyr", "lat") === "Oʻzbekiston"
 *   convert("Ўзбекистон", "cyr", "new") === "Özbekiston"
 *
 * Pipeline per WORD: cyr -> (exceptions + letter rules) -> current Latin -> (letter mapping) -> new Latin;
 * and back through the same stages. Everything that is not an Uzbek letter of the SOURCE script is
 * copied untouched: digits, punctuation, spaces, other-script words (`iPhone` inside Cyrillic text) and any
 * whitespace-delimited token that contains `@` or `://` (e-mails, URLs), starts with `www.`/`mailto:` or
 * looks like a domain (`kitob.uz`).
 *
 * Latin source: a word cannot be told apart from an English one by script, so a heuristic keeps words
 * with `w`, with a `c` that is not part of `ch`, or in camelCase (`iPhone`) as they are.
 *
 * Rules: see `rules.ts` (letters) and `words.ts` (exception dictionary + stem matching).
 */

import { APOSTROPHES, latToNew, newToLat, normalizeLatApostrophes } from "./rules";
import type { Script } from "./script";
import { cyrWordToLat, latWordToCyr } from "./words";

export { SCRIPTS, SCRIPT_LABEL, isScript, type Script } from "./script";

const APO = APOSTROPHES.replace(/[\\\]^-]/g, "\\$&");
const CYR_LETTERS = "\\u0400-\\u04FF";
const LAT_LETTERS = "A-Za-z\\u00D6\\u00F6\\u011E\\u011F\\u015E\\u015F\\u00C7\\u00E7";

const WORD_CYR = new RegExp(`[${CYR_LETTERS}]+(?:-[${CYR_LETTERS}]+)*`, "g");
/** Latin word: letters, inner hyphens/apostrophes, and ONE trailing apostrophe (`togʻ`) — validated in `latWords`. */
const WORD_LAT = new RegExp(`[${LAT_LETTERS}]+(?:[-${APO}][${LAT_LETTERS}]+)*[${APO}]?`, "g");

const DOMAIN = /(?:^|[^A-Za-z0-9])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|uz|ru|io|info|edu|gov|me|app|dev|kz|tj)(?![A-Za-z])/i;

/** E-mails, URLs and domains are never converted. */
export function isProtectedToken(token: string): boolean {
  return token.includes("@") || token.includes("://") || /^(?:www\.|mailto:)/i.test(token) || DOMAIN.test(token);
}

/** Latin-source guard: foreign words (`Google`-like cannot be known, but `w`, stray `c`, camelCase can). */
function looksForeign(word: string, from: Script): boolean {
  if (/w/i.test(word)) return true;
  if (from === "new" ? /c/i.test(word) : /c(?!h)/i.test(word)) return true;
  return /[a-zöğşç][A-ZÖĞŞÇ]/.test(word);
}

function convertWord(word: string, from: Script, to: Script): string {
  if (from === "cyr") {
    const lat = cyrWordToLat(word);
    return to === "lat" ? lat : latToNew(lat);
  }
  if (looksForeign(word, from)) return word;
  const lat = from === "new" ? newToLat(word) : normalizeLatApostrophes(word);
  if (to === "cyr") return latWordToCyr(lat);
  if (to === "lat") return lat;
  return latToNew(lat);
}

function convertChunk(chunk: string, from: Script, to: Script): string {
  const re = from === "cyr" ? WORD_CYR : WORD_LAT;
  return chunk.replace(re, (word: string) => {
    if (from === "cyr") return convertWord(word, from, to);
    // A trailing apostrophe belongs to the word only after o/g (`togʻ`, `qoʻ`); otherwise it is a quote.
    const last = word[word.length - 1]!;
    if (APOSTROPHES.includes(last)) {
      const before = (word[word.length - 2] ?? "").toLowerCase();
      if (before !== "o" && before !== "g") return convertWord(word.slice(0, -1), from, to) + last;
    }
    return convertWord(word, from, to);
  });
}

/**
 * Converts `text` between Uzbek scripts. `from === to` returns the text unchanged.
 * Whitespace (including line breaks) is preserved exactly.
 */
export function convert(text: string, from: Script, to: Script): string {
  if (from === to || !text) return text;
  return text.replace(/\S+/g, (chunk) => (isProtectedToken(chunk) ? chunk : convertChunk(chunk, from, to)));
}
