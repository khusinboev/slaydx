/**
 * Word conversion = exception dictionary + letter rules.
 *
 * Dictionary (generated `exceptions.ts`, [Cyrillic, current Latin]):
 *   1. WHOLE word: `цирк` <-> `sirk`, case-preserving (lower / Title / UPPER;
 *      a mixed-case word skips the dictionary and uses the letter rules).
 *      A hyphenated entry (`Нью-Йорк`) is looked up as a whole first.
 *   2. STEM prefix (inflected forms): when the word is not a whole entry, the
 *      LONGEST entry that is a prefix of the word (>= 3 letters) is used if the
 *      rest of the word is a chain of Uzbek suffixes from `SUFFIXES` (at most
 *      `MAX_TAIL` letters): `цирки`, `концертлар`, `stansiyada`, `sirkda`.
 *      The stem is written from the dictionary, the tail by the letter rules
 *      with the stem's last letter as context. A tail that is NOT a suffix
 *      chain (`sirka` = vinegar is `sirk` + `a`, and `a` is no suffix;
 *      `цирковой`) leaves the dictionary out, so unrelated words that merely
 *      start like an entry are not damaged.
 *   The same table works in both directions (Latin keys are normalised).
 */

import { EXCEPTIONS } from "./exceptions";
import { capitalize, cyrToLat, isUpperChar, latToCyr, normalizeLatApostrophes } from "./rules";

const MIN_STEM = 3;
const MAX_TAIL = 14;

/** Uzbek inflection / derivation suffixes (current Latin), used only to validate a stem match. */
const SUFFIXES_LAT = [
  "lar", "ni", "ning", "ga", "ka", "qa", "da", "dan", "ing", "im", "i", "si", "m", "ng", "imiz", "ingiz", "ngiz", "miz",
  "lari", "ligi", "lik", "li", "siz", "sizlik", "chi", "chilik", "dagi", "gi", "ki", "dek", "day", "cha", "dir", "mi",
  "la", "lash", "lan", "lashtir", "gina",
] as const;

type Dict = {
  /** whole-word map, lower-case key */
  words: Map<string, string>;
  /** sorted stem lengths present, longest first (for the prefix scan) */
  stemLengths: number[];
  /** valid suffix atoms in this direction's SOURCE script */
  suffixes: Set<string>;
};

const cyrToLatWords = new Map<string, string>();
const latToCyrWords = new Map<string, string>();
for (const [cyr, lat] of EXCEPTIONS) {
  cyrToLatWords.set(cyr.toLowerCase(), normalizeLatApostrophes(lat.toLowerCase()));
  const key = normalizeLatApostrophes(lat.toLowerCase());
  if (!latToCyrWords.has(key)) latToCyrWords.set(key, cyr.toLowerCase());
}

const lengthsOf = (m: Map<string, string>): number[] =>
  [...new Set([...m.keys()].map((k) => k.length))].filter((n) => n >= MIN_STEM).sort((a, b) => b - a);

const SUFFIXES_CYR = new Set(SUFFIXES_LAT.map((s) => latToCyr(s)));

const CYR: Dict = { words: cyrToLatWords, stemLengths: lengthsOf(cyrToLatWords), suffixes: SUFFIXES_CYR };
const LAT: Dict = { words: latToCyrWords, stemLengths: lengthsOf(latToCyrWords), suffixes: new Set<string>(SUFFIXES_LAT) };

/** Can `tail` be written as a chain of suffix atoms? (tiny DP, tails are short) */
export function isSuffixChain(tail: string, atoms: ReadonlySet<string>): boolean {
  if (!tail || tail.length > MAX_TAIL) return false;
  const ok = new Array<boolean>(tail.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < tail.length; i++) {
    if (!ok[i]) continue;
    for (let j = i + 1; j <= tail.length; j++) if (atoms.has(tail.slice(i, j))) ok[j] = true;
  }
  return ok[tail.length]!;
}

type Pattern = "lower" | "title" | "upper" | "mixed";

/** Case shape of a word: lower, Title, UPPER (2+ letters) or mixed. Hyphen parts are judged one by one. */
export function casePattern(w: string): Pattern {
  if (w.includes("-")) {
    const parts = w.split("-").filter(Boolean).map(casePattern);
    if (parts.includes("mixed")) return "mixed";
    if (parts.every((p) => p === "upper")) return "upper";
    if (parts.every((p) => p === "lower")) return "lower";
    return "title";
  }
  let upper = 0;
  let lower = 0;
  for (const c of w) {
    if (isUpperChar(c)) upper++;
    else if (c !== c.toUpperCase()) lower++;
  }
  if (!upper) return "lower";
  if (!lower) return upper === 1 ? "title" : "upper";
  return isUpperChar(firstLetter(w)) && upper === 1 ? "title" : "mixed";
}

function firstLetter(w: string): string {
  for (const c of w) if (c !== c.toLowerCase() || c !== c.toUpperCase()) return c;
  return "";
}

function recase(out: string, pattern: Pattern, source: string): string {
  if (pattern === "lower" || pattern === "mixed") return out;
  const outParts = out.split("-");
  const srcParts = source.split("-");
  if (pattern === "upper") return out.toUpperCase();
  // Title: «Нью-Йорк» -> «Nyu-York» (each part is Title-cased when the source part is)
  if (outParts.length === srcParts.length) return outParts.map((p, i) => (isUpperChar(firstLetter(srcParts[i]!)) ? capitalize(p) : p)).join("-");
  return capitalize(out);
}

/**
 * Longest dictionary match for `lower`: `{ stem, out }` where `stem` is the
 * number of leading characters the dictionary covers (the whole word, or a
 * stem followed by a valid suffix chain).
 */
function lookup(dict: Dict, lower: string): { stem: number; out: string } | null {
  const whole = dict.words.get(lower);
  if (whole !== undefined) return { stem: lower.length, out: whole };
  for (const n of dict.stemLengths) {
    if (n >= lower.length) continue;
    if (lower.length - n > MAX_TAIL) break;
    const hit = dict.words.get(lower.slice(0, n));
    if (hit !== undefined && isSuffixChain(lower.slice(n), dict.suffixes)) return { stem: n, out: hit };
  }
  return null;
}

/**
 * Cyrillic word (letters and inner hyphens only) -> current Latin, with exceptions.
 */
export function cyrWordToLat(word: string): string {
  const pattern = casePattern(word);
  const lower = word.toLowerCase();
  const hit = pattern === "mixed" ? null : lookup(CYR, lower);
  if (!hit) return word.includes("-") ? joinParts(word, cyrWordToLat) : cyrToLat(word);
  const head = recase(hit.out, pattern, word.slice(0, hit.stem));
  if (hit.stem === word.length) return head;
  return head + cyrToLat(word, hit.stem, head[head.length - 1] ?? "");
}

/**
 * Latin word (apostrophes already normalised by the caller or here) -> Cyrillic, with exceptions.
 */
export function latWordToCyr(word: string): string {
  const w = normalizeLatApostrophes(word);
  const pattern = casePattern(w);
  const lower = w.toLowerCase();
  const hit = pattern === "mixed" ? null : lookup(LAT, lower);
  if (!hit) return w.includes("-") ? joinParts(w, latWordToCyr) : latToCyr(w);
  const head = recase(hit.out, pattern, w.slice(0, hit.stem));
  if (hit.stem === w.length) return head;
  return head + latToCyr(w, hit.stem, head[head.length - 1]!.toLowerCase());
}

/** A hyphenated word that is not a dictionary entry: convert each part on its own. */
function joinParts(word: string, f: (part: string) => string): string {
  return word
    .split("-")
    .map((p) => (p ? f(p) : p))
    .join("-");
}
