/**
 * Formulas in slide text, written the way a reader expects: H₂O, CₙH₂ₙ₊₁COOH, x², Ca²⁺.
 *
 * Slides are plain text runs (viewer and PPTX), so a formula cannot be typeset. The model is asked
 * for Unicode sub- and superscripts (`slide-prompt/base.ts`), but it still writes LaTeX habits
 * (`C_n H_{2n+1}`, `x^2`, `\cdot`) or bare digits (`C6H8O7`). This turns those into Unicode.
 *
 * Bare digits are touched only in a token that parses fully as a chemical formula with real element
 * symbols and at least two elements (or a diatomic gas such as O2): `A4`, `B12`, `MP3`, `H1N1` stay.
 * A `_x` / `^x` whose characters have no Unicode form is left as written.
 */

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ", i: "ᵢ", j: "ⱼ",
};

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", k: "ᵏ", m: "ᵐ",
};

const SUB_CHARS = Object.values(SUB).join("");

const ELEMENTS = new Set(
  (
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm " +
    "Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr"
  ).split(" "),
);

/** Single-element tokens that are real formulas; `B12` or `K2` are not. */
const DIATOMIC = new Set(["H2", "N2", "O2", "O3", "F2", "Cl2", "Br2", "I2", "P4", "S8"]);

const LATEX: [RegExp, string][] = [
  [/\\cdot\b/g, "·"],
  [/\\times\b/g, "×"],
  [/\\(?:rightarrow|to)\b/g, "→"],
  [/\\(?:leftrightarrow|rightleftharpoons)\b/g, "⇄"],
  [/\\pm\b/g, "±"],
  [/\\(?:leq|le)\b/g, "≤"],
  [/\\(?:geq|ge)\b/g, "≥"],
  [/\\(?:neq|ne)\b/g, "≠"],
  [/\\approx\b/g, "≈"],
  [/\\infty\b/g, "∞"],
  [/\\Delta\b/g, "Δ"],
  [/\\alpha\b/g, "α"],
  [/\\beta\b/g, "β"],
  [/\\gamma\b/g, "γ"],
  [/\\lambda\b/g, "λ"],
  [/\\mu\b/g, "μ"],
  [/\\pi\b/g, "π"],
  [/\\(?:circ|degree)\b/g, "°"],
];

function mapAll(s: string, table: Record<string, string>): string | null {
  let out = "";
  for (const ch of s) {
    const m = table[ch];
    if (!m) return null;
    out += m;
  }
  return out;
}

/** A token that is a chemical formula: elements, counts and groups only, every symbol real (`Co` cobalt, `CO` C + O). */
function isChemToken(token: string): { elements: number } | null {
  const re = /([A-Z][a-z]?)|(\d+)|([()[\]])|([₀-₉ₙₘₓ₊₋]+)/g;
  let elements = 0;
  let pos = 0;
  for (const m of token.matchAll(re)) {
    if (m.index !== pos) return null;
    pos = m.index + m[0].length;
    if (m[1]) {
      if (!ELEMENTS.has(m[1])) return null;
      elements += 1;
    }
  }
  return pos === token.length && elements > 0 ? { elements } : null;
}

function subscriptBareDigits(token: string): string {
  const chem = isChemToken(token);
  if (!chem || !/\d/.test(token)) return token;
  const groups = token.match(/\d+/g) ?? [];
  // `H1N1`, `C0`: chemists never write a count of 1 or a leading zero.
  if (groups.some((g) => g === "1" || g.startsWith("0"))) return token;
  // A count must follow an element or a closing group, never open the token (`2H2O` keeps its 2).
  if (/^\d/.test(token)) {
    const lead = token.match(/^\d+/)![0];
    return lead + subscriptBareDigits(token.slice(lead.length));
  }
  if (chem.elements < 2 && !DIATOMIC.has(token)) return token;
  return token.replace(/\d+/g, (d) => mapAll(d, SUB)!);
}

/** One string: LaTeX habits and bare chemical counts to Unicode. Text without them comes back as is. */
export function prettyFormula(text: string): string {
  if (!/[_^\\\d$]/.test(text)) return text;
  // `$x^2$` inline math markers, only when they wrap a formula.
  let s = text.replace(/\$([^$\n]{1,60}[_^\\][^$\n]{0,60})\$/g, "$1");
  if (s.includes("\\")) {
    for (const [re, to] of LATEX) s = s.replace(re, to);
    s = s.replace(/\\frac\{([^{}]{1,20})\}\{([^{}]{1,20})\}/g, "$1/$2");
    s = s.replace(/\\sqrt\{([^{}]{1,20})\}/g, "√($1)");
    s = s.replace(/\\(?:mathrm|text|ce)\{([^{}]{1,40})\}/g, "$1");
  }

  // `_x`, `_{x}` after a symbol, digit or closing group.
  s = s.replace(/(?<=[A-Za-z0-9)\]])_(?:\{([^{}]{1,12})\}|([0-9a-z]+(?:[+-][0-9a-z]+)*))/g, (all, braced, bare) => {
    const body = (braced ?? bare) as string;
    return mapAll(body.replace(/\s+/g, ""), SUB) ?? all;
  });
  // `^x`, `^{x}`: charges and powers.
  s = s.replace(/(?<=[A-Za-z0-9)\]])\^(?:\{([^{}]{1,12})\}|([+-]?[0-9a-z]+[+-]?))/g, (all, braced, bare) => {
    const body = (braced ?? bare) as string;
    return mapAll(body.replace(/\s+/g, ""), SUP) ?? all;
  });

  // Bare counts inside chemical tokens: C6H8O7, Ca(OH)2, (CH2).
  s = s.replace(/(?<![\p{L}\p{N}_])[0-9A-Z()[\]][0-9A-Za-z()[\]₀-₉ₙₘₓ₊₋]*(?![\p{L}\p{N}_])/gu, (tok) => subscriptBareDigits(tok));

  // `Cₙ H₂ₙ₊₁ COOH` → one formula: a space after a subscript joins the next chemical token.
  s = s.replace(new RegExp(`(?<=[${SUB_CHARS}]) (?=([A-Z(][A-Za-z0-9()₀-₉ₙₘₓ₊₋]*))`, "g"), (sp, _m, offset: number, whole: string) => {
    const next = whole.slice(offset + 1).match(/^[A-Z(][A-Za-z0-9()₀-₉ₙₘₓ₊₋]*/)![0];
    const chem = isChemToken(next);
    const before = whole.slice(0, offset).match(/[A-Za-z0-9()₀-₉ₙₘₓ₊₋]+$/)?.[0] ?? "";
    if (!chem || !isChemToken(before)) return sp;
    return chem.elements >= 2 || /[0-9₀-₉ₙₘₓ]/.test(next) ? "" : sp;
  });
  return s;
}

/** Keys whose text is not shown on the slide as prose. */
const SKIP_KEYS = new Set(["layout", "id", "imageHint", "image", "src", "url", "icon"]);

/** Every string in an LLM slide object, depth-limited. */
export function prettyFormulasDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return prettyFormula(value) as T;
  if (depth > 6 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => prettyFormulasDeep(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SKIP_KEYS.has(k) ? v : prettyFormulasDeep(v, depth + 1);
  }
  return out as T;
}
