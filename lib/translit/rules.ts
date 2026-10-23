/**
 * Letter rules of the Uzbek script converter — WORD level, no dictionary.
 *
 * Everything here works on ONE word (no spaces, hyphen parts are split by the
 * caller). The dictionary / stem matching lives in `words.ts`, the text
 * tokenizer in `index.ts`.
 *
 * Unicode used on purpose:
 *   ʻ U+02BB  okina — the second half of `oʻ` / `gʻ` in the current Latin;
 *   ʼ U+02BC  tutuq belgisi (apostrophe letter) — `maʼno`, `sʼh`.
 */

export const OKINA = "ʻ";
export const TUTUQ = "ʼ";

/** Every apostrophe-like character accepted on input. */
export const APOSTROPHES = "'`´‘’ʻʼ′";
const APOS_SET = new Set(APOSTROPHES);
export const isApostrophe = (c: string | undefined): boolean => c !== undefined && APOS_SET.has(c);

export const isUpperChar = (c: string): boolean => c !== c.toLowerCase();

/** Two or more cased letters, all upper case (`ШАҲАР`, `OʻZ`). A single capital is a Title-case word. */
export function isCapsWord(w: string): boolean {
  let upper = 0;
  for (const c of w) {
    if (isUpperChar(c)) upper++;
    else if (c !== c.toUpperCase()) return false;
  }
  return upper >= 2;
}

/** Upper-case the first letter, keep the rest. */
export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/* ───────────────────────────── Cyrillic → Latin ───────────────────────────── */

const CYR_VOWELS = new Set("аеёиоуэюяўы");
const CYR_TO_LAT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ч: "ch", ш: "sh",
  ъ: TUTUQ, ь: "", ы: "i", э: "e", ю: "yu", я: "ya", ё: "yo", ў: `o${OKINA}`, қ: "q", ғ: `g${OKINA}`, ҳ: "h", щ: "shch",
};

/**
 * Cyrillic word (from index `from`) -> current Latin.
 *
 *  - `е` -> `ye` at the word start and after a vowel or ъ/ь, else `e`;
 *  - `ц` -> `s` at the word start and after a consonant, `ts` after a vowel;
 *  - `ъ` -> ʼ, `ь` dropped, `э` -> `e`;
 *  - a digraph keeps the word's case: `Ш` -> `Sh` in a Title-case word, `SH` in an ALL-CAPS word;
 *  - `с` + `ҳ` would read as the digraph `sh`, so a tutuq is inserted: `sʼh`.
 *
 * `from` > 0 converts only the tail of a word whose stem was already produced
 * by the dictionary; `lastOut` is that stem's last Latin character.
 */
export function cyrToLat(word: string, from = 0, lastOut = ""): string {
  const caps = isCapsWord(word);
  let prev = from > 0 ? word[from - 1]!.toLowerCase() : "";
  let last = lastOut;
  let out = "";
  for (let i = from; i < word.length; i++) {
    const ch = word[i]!;
    const lo = ch.toLowerCase();
    let piece: string;
    if (lo === "е") piece = prev === "" || CYR_VOWELS.has(prev) || prev === "ъ" || prev === "ь" ? "ye" : "e";
    else if (lo === "ц") piece = prev === "" || !CYR_VOWELS.has(prev) ? "s" : "ts";
    else if (lo in CYR_TO_LAT) piece = CYR_TO_LAT[lo]!;
    else piece = ch;
    if (isUpperChar(ch) && piece !== ch) piece = caps ? piece.toUpperCase() : capitalize(piece);
    if (piece.toLowerCase() === "h" && lo === "ҳ" && (last === "s" || last === "S")) piece = TUTUQ + piece;
    out += piece;
    if (piece) last = piece[piece.length - 1]!;
    prev = lo;
  }
  return out;
}

/* ───────────────────────────── Latin → Cyrillic ───────────────────────────── */

const LAT_TO_CYR: Readonly<Record<string, string>> = {
  a: "а", b: "б", d: "д", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н",
  o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "й", z: "з", [TUTUQ]: "ъ",
};

/**
 * Normalises every apostrophe variant inside a Latin word: after `o`/`g` it is
 * the okina (`oʻ gʻ`), anywhere else the tutuq (`maʼno`). Idempotent.
 */
export function normalizeLatApostrophes(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!;
    if (!isApostrophe(ch)) {
      out += ch;
      continue;
    }
    const before = (word[i - 1] ?? "").toLowerCase();
    out += before === "o" || before === "g" ? OKINA : TUTUQ;
  }
  return out;
}

/**
 * Current Latin word (already `normalizeLatApostrophes`-ed) -> Cyrillic,
 * from index `from`; `prevCyr` is the last Cyrillic letter produced before it.
 *
 * Greedy, longest match first: `oʻ gʻ sh ch yo yu ya ye`, `sʼh` -> `сҳ`.
 *  - `e` -> `э` at the word start (or after a vowel / ъ), else `е`; `ye` -> `е` at the word start (or after a vowel / ъ),
 *    else `й` + `е`. After a vowel a plain `e` can only come from `э` (a Cyrillic `е` there is written `ye`), so this
 *    keeps the conversion lossless;
 *  - `yo/yu/ya` -> `ё/ю/я` (but `yoʻ` is `й` + `ў`);
 *  - `ng` needs no rule: it is `н` + `г`;
 *  - `ts` -> `ц` only right after a vowel and before `iya / ion / iy / ial` (-tsiya words); other `ts` is `тс`
 *    (the dictionary knows the specific Russian loans);
 *  - the case of a digraph follows its first letter (`Sh`, `SH` -> `Ш`).
 */
export function latToCyr(word: string, from = 0, prevCyr = ""): string {
  let prev = prevCyr;
  let out = "";
  const lower = word.toLowerCase();
  for (let i = from; i < word.length; ) {
    const ch = word[i]!;
    const lo = lower[i]!;
    const nx = lower[i + 1] ?? "";
    const nx2 = lower[i + 2] ?? "";
    const edge = prev === "" || CYR_VOWELS.has(prev) || prev === "ъ";
    let piece: string;
    let used = 1;
    if (lo === "o" && nx === OKINA) [piece, used] = ["ў", 2];
    else if (lo === "g" && nx === OKINA) [piece, used] = ["ғ", 2];
    else if (lo === "s" && nx === "h") [piece, used] = ["ш", 2];
    else if (lo === "c" && nx === "h") [piece, used] = ["ч", 2];
    else if (lo === "s" && nx === TUTUQ && nx2 === "h") {
      out += isUpperChar(ch) ? "С" : "с";
      const h = word[i + 2]!;
      const piece2 = isUpperChar(h) ? "Ҳ" : "ҳ";
      out += piece2;
      prev = "ҳ";
      i += 3;
      continue;
    } else if (lo === "t" && nx === "s" && CYR_VOWELS.has(prev) && /^(iya|ion|iy|ial)/.test(lower.slice(i + 2))) [piece, used] = ["ц", 2];
    else if (lo === "y" && nx === "e" && edge) [piece, used] = ["е", 2];
    else if (lo === "y" && nx === "a") [piece, used] = ["я", 2];
    else if (lo === "y" && nx === "u") [piece, used] = ["ю", 2];
    else if (lo === "y" && nx === "o" && nx2 !== OKINA) [piece, used] = ["ё", 2];
    else if (lo === "e") piece = edge ? "э" : "е";
    else if (lo in LAT_TO_CYR) piece = LAT_TO_CYR[lo]!;
    else piece = ch;
    if (piece !== ch && isUpperChar(ch)) piece = piece.toUpperCase();
    out += piece;
    prev = piece.toLowerCase();
    i += used;
  }
  return out;
}

/* ───────────────────── current Latin ↔ NEW Latin (letter mapping) ───────────────────── */

/**
 * Current Latin word -> new Latin (Law ЎРҚ-1184): `oʻ gʻ sh ch` -> `Ö Ğ Ş Ç`.
 * `ng` is untouched. A `sʼh` (s, tutuq, h) is untouched too, because the tutuq
 * separates the letters.
 */
export function latToNew(word: string): string {
  const w = normalizeLatApostrophes(word);
  const lower = w.toLowerCase();
  let out = "";
  for (let i = 0; i < w.length; i++) {
    const ch = w[i]!;
    const lo = lower[i]!;
    const nx = lower[i + 1];
    let piece: string | null = null;
    if (lo === "o" && nx === OKINA) piece = "ö";
    else if (lo === "g" && nx === OKINA) piece = "ğ";
    else if (lo === "s" && nx === "h") piece = "ş";
    else if (lo === "c" && nx === "h") piece = "ç";
    if (piece === null) {
      out += ch;
      continue;
    }
    out += isUpperChar(ch) ? piece.toUpperCase() : piece;
    i++;
  }
  return out;
}

const NEW_TO_LAT: Readonly<Record<string, string>> = { ö: `o${OKINA}`, ğ: `g${OKINA}`, ş: "sh", ç: "ch" };

/**
 * New Latin word -> current Latin. Apostrophes are normalised first (so old-style
 * input still works). `Ş` becomes `Sh` (`SH` in an ALL-CAPS word); a plain `s`
 * followed by `h` — two letters in the new Latin — becomes `sʼh`, otherwise it
 * would read back as the digraph `sh`.
 */
export function newToLat(word: string): string {
  const w = normalizeLatApostrophes(word);
  const caps = isCapsWord(w);
  const lower = w.toLowerCase();
  let out = "";
  for (let i = 0; i < w.length; i++) {
    const ch = w[i]!;
    const lo = lower[i]!;
    if (lo in NEW_TO_LAT) {
      const piece = NEW_TO_LAT[lo]!;
      out += isUpperChar(ch) ? (caps ? piece.toUpperCase() : capitalize(piece)) : piece;
    } else if (lo === "s" && lower[i + 1] === "h") {
      out += ch + TUTUQ;
    } else {
      out += ch;
    }
  }
  return out;
}
