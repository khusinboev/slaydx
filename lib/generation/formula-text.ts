/**
 * Formulas in slide text, written the way a reader expects: H₂O, CₙH₂ₙ₊₁COOH, x², Ca²⁺.
 *
 * Slides are plain text runs (viewer and PPTX), so a formula cannot be typeset. The model is asked
 * for Unicode sub- and superscripts (`slide-prompt/base.ts`), but it still writes LaTeX habits
 * (`C_n H_{2n+1}`, `x^2`, `\cdot`) or bare digits (`C6H8O7`). This turns those into Unicode.
 *
 * It errs on the side of leaving text alone:
 * - URLs, e-mails and paths are never touched.
 * - `_x` only after a formula symbol (an element such as `H`, `Na`, or a lone variable such as `x`),
 *   so `max_len`, `item_2` and `Windows_11` stay. The body is digits, one letter, or the `2n+1` shape.
 * - `^x` takes digits, one letter, `(n+1)` or a charge (`2+` followed by no term), so `x^2+1` stays a sum.
 * - LaTeX commands of school math and physics become their symbols: `\\sqrt{2}` √2, `\\angle` ∠, `\\frac{a}{b}` a/b.
 * - Bare digits only in a token made of real element symbols, with carbon, hydrogen, oxygen or
 *   nitrogen or a two-letter element, counts of at most two digits, and not a known product or
 *   protocol name: `A4`, `B12`, `PS5`, `B2B`, `ISO9001`, `H1N1` stay.
 * A `_x` / `^x` whose characters have no Unicode form is left as written.
 */

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ", i: "ᵢ", j: "ⱼ",
};

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ",
  o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};

/** Subscript characters that stand for a variable, not a count: they mark a LaTeX-born formula. */
const SUB_VARS = "ₐₑₒₓₕₖₗₘₙₚₛₜᵢⱼ";
const SUB_ANY = Object.values(SUB).join("");
const SUP_ANY = Object.values(SUP).join("");

const ELEMENTS = new Set(
  (
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm " +
    "Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr"
  ).split(" "),
);

/** Single-element tokens that are real formulas; `B12`, `K2`, `F2` (a key) or `S8` (a phone) are not. */
const DIATOMIC = new Set(["H2", "N2", "O2", "O3", "Cl2", "Br2", "I2"]);

/** Element-shaped names of products, protocols and viruses. */
const NOT_CHEM = /^(?:PS\d|CSS\d|B2[BCG]|P2P|W3C|Y2K|I2C|FC\d+|HP\d+|H\d+N\d+)$/;

/** Spans never rewritten: URLs, e-mails, Windows and Unix paths, file names with an extension. */
const PROTECTED =
  /(?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.]+|[A-Za-z]:\\\S*|\S*\/\S*\.[A-Za-z]\S*|\b\w+\.(?:png|jpe?g|gif|svg|pdf|docx?|pptx?|xlsx?|py|js|ts|html?|css|txt|csv|json|zip)\b/gi;

const NL = "(?![A-Za-z])";
const LATEX: [RegExp, string][] = [
  [/\^\{?\\circ\}?/g, "°"],
  [new RegExp(`\\\\cdot${NL}`, "g"), "·"],
  [new RegExp(`\\\\times${NL}`, "g"), "×"],
  [new RegExp(`\\\\(?:rightarrow|to)${NL}`, "g"), "→"],
  [new RegExp(`\\\\(?:leftrightarrow|rightleftharpoons)${NL}`, "g"), "⇄"],
  [new RegExp(`\\\\pm${NL}`, "g"), "±"],
  [new RegExp(`\\\\(?:leq|le)${NL}`, "g"), "≤"],
  [new RegExp(`\\\\(?:geq|ge)${NL}`, "g"), "≥"],
  [new RegExp(`\\\\(?:neq|ne)${NL}`, "g"), "≠"],
  [new RegExp(`\\\\approx${NL}`, "g"), "≈"],
  [new RegExp(`\\\\infty${NL}`, "g"), "∞"],
  [new RegExp(`\\\\Delta${NL}`, "g"), "Δ"],
  [new RegExp(`\\\\alpha${NL}`, "g"), "α"],
  [new RegExp(`\\\\beta${NL}`, "g"), "β"],
  [new RegExp(`\\\\gamma${NL}`, "g"), "γ"],
  [new RegExp(`\\\\lambda${NL}`, "g"), "λ"],
  [new RegExp(`\\\\mu${NL}`, "g"), "μ"],
  [new RegExp(`\\\\pi${NL}`, "g"), "π"],
  [new RegExp(`\\\\(?:circ|degree)${NL}`, "g"), "°"],
  [new RegExp(`\\\\theta${NL}`, "g"), "θ"],
  [new RegExp(`\\\\Theta${NL}`, "g"), "Θ"],
  [new RegExp(`\\\\phi${NL}`, "g"), "φ"],
  [new RegExp(`\\\\varphi${NL}`, "g"), "φ"],
  [new RegExp(`\\\\Phi${NL}`, "g"), "Φ"],
  [new RegExp(`\\\\omega${NL}`, "g"), "ω"],
  [new RegExp(`\\\\Omega${NL}`, "g"), "Ω"],
  [new RegExp(`\\\\sigma${NL}`, "g"), "σ"],
  [new RegExp(`\\\\Sigma${NL}`, "g"), "Σ"],
  [new RegExp(`\\\\rho${NL}`, "g"), "ρ"],
  [new RegExp(`\\\\epsilon${NL}`, "g"), "ε"],
  [new RegExp(`\\\\varepsilon${NL}`, "g"), "ε"],
  [new RegExp(`\\\\nu${NL}`, "g"), "ν"],
  [new RegExp(`\\\\tau${NL}`, "g"), "τ"],
  [new RegExp(`\\\\eta${NL}`, "g"), "η"],
  [new RegExp(`\\\\delta${NL}`, "g"), "δ"],
  [new RegExp(`\\\\psi${NL}`, "g"), "ψ"],
  [new RegExp(`\\\\Psi${NL}`, "g"), "Ψ"],
  [new RegExp(`\\\\chi${NL}`, "g"), "χ"],
  [new RegExp(`\\\\xi${NL}`, "g"), "ξ"],
  [new RegExp(`\\\\kappa${NL}`, "g"), "κ"],
  [new RegExp(`\\\\Gamma${NL}`, "g"), "Γ"],
  [new RegExp(`\\\\Lambda${NL}`, "g"), "Λ"],
  [new RegExp(`\\\\sum${NL}`, "g"), "Σ"],
  [new RegExp(`\\\\prod${NL}`, "g"), "∏"],
  [new RegExp(`\\\\int${NL}`, "g"), "∫"],
  [new RegExp(`\\\\oint${NL}`, "g"), "∮"],
  [new RegExp(`\\\\partial${NL}`, "g"), "∂"],
  [new RegExp(`\\\\nabla${NL}`, "g"), "∇"],
  [new RegExp(`\\\\angle${NL}`, "g"), "∠"],
  [new RegExp(`\\\\triangle${NL}`, "g"), "△"],
  [new RegExp(`\\\\perp${NL}`, "g"), "⊥"],
  [new RegExp(`\\\\parallel${NL}`, "g"), "∥"],
  [new RegExp(`\\\\cdots${NL}`, "g"), "⋯"],
  [new RegExp(`\\\\ldots${NL}`, "g"), "…"],
  [new RegExp(`\\\\dots${NL}`, "g"), "…"],
  [new RegExp(`\\\\div${NL}`, "g"), "÷"],
  [new RegExp(`\\\\propto${NL}`, "g"), "∝"],
  [new RegExp(`\\\\equiv${NL}`, "g"), "≡"],
  [new RegExp(`\\\\sim${NL}`, "g"), "∼"],
  [new RegExp(`\\\\cong${NL}`, "g"), "≅"],
  [new RegExp(`\\\\in${NL}`, "g"), "∈"],
  [new RegExp(`\\\\notin${NL}`, "g"), "∉"],
  [new RegExp(`\\\\subset${NL}`, "g"), "⊂"],
  [new RegExp(`\\\\cup${NL}`, "g"), "∪"],
  [new RegExp(`\\\\cap${NL}`, "g"), "∩"],
  [new RegExp(`\\\\forall${NL}`, "g"), "∀"],
  [new RegExp(`\\\\exists${NL}`, "g"), "∃"],
  [new RegExp(`\\\\Rightarrow${NL}`, "g"), "⇒"],
  [new RegExp(`\\\\Leftrightarrow${NL}`, "g"), "⇔"],
  [new RegExp(`\\\\leftarrow${NL}`, "g"), "←"],
  [new RegExp(`\\\\uparrow${NL}`, "g"), "↑"],
  [new RegExp(`\\\\downarrow${NL}`, "g"), "↓"],
  [new RegExp(`\\\\hbar${NL}`, "g"), "ℏ"],
  [new RegExp(`\\\\ell${NL}`, "g"), "ℓ"],
  [new RegExp(`\\\\emptyset${NL}`, "g"), "∅"],
  [new RegExp(`\\\\neg${NL}`, "g"), "¬"],
  [new RegExp(`\\\\land${NL}`, "g"), "∧"],
  [new RegExp(`\\\\lor${NL}`, "g"), "∨"],
  [new RegExp(`\\\\mp${NL}`, "g"), "∓"],
  // `\\sqrt{…}` and `\\sqrt[3]{…}` are handled with their argument.
  [/\\sqrt(?![A-Za-z{[])/g, "√"],
];

/** A fraction part keeps its brackets when it is more than one term. */
function wrap(x: string): string {
  return /^[\w.²³ⁿ√πα-ω]+$/u.test(x) ? x : `(${x})`;
}

function mapAll(s: string, table: Record<string, string>): string | null {
  let out = "";
  for (const ch of s) {
    const m = table[ch];
    if (!m) return null;
    out += m;
  }
  return out;
}

const CHEM_PART = new RegExp(`([A-Z][a-z]?)|(\\d+)|([()[\\]])|([${SUB_ANY}${SUP_ANY}]+)`, "g");

/** The element symbols of a chemical token, or null when any letter is not a real element. */
function chemElements(token: string): string[] | null {
  const out: string[] = [];
  let pos = 0;
  for (const m of token.matchAll(CHEM_PART)) {
    if (m.index !== pos) return null;
    pos = m.index + m[0].length;
    if (m[1]) {
      if (!ELEMENTS.has(m[1])) return null;
      out.push(m[1]);
    }
  }
  return pos === token.length && out.length ? out : null;
}

function subscriptBareDigits(token: string): string {
  if (!/\d/.test(token)) return token;
  // A leading coefficient stays a normal digit (`2H2O`).
  const lead = token.match(/^\d+/)?.[0];
  if (lead) return lead + subscriptBareDigits(token.slice(lead.length));
  const elements = chemElements(token);
  if (!elements || NOT_CHEM.test(token)) return token;
  const groups = token.match(/\d+/g) ?? [];
  // Chemists never write a count of 1, a leading zero or a three-digit count.
  if (groups.some((g) => g === "1" || g.startsWith("0") || g.length > 2)) return token;
  const sub = () => token.replace(/\d+/g, (d) => mapAll(d, SUB)!);
  if (elements.length < 2) return DIATOMIC.has(token) ? sub() : token;
  const chemish = elements.some((e) => e === "C" || e === "H" || e === "O" || e === "N" || e.length === 2);
  return chemish ? sub() : token;
}

/**
 * A formula symbol right before `_`: a lone letter, two capitals (`SO_4`, not `API_2`), an element-like `Na`, a Greek letter, a digit, a group or a script.
 * The body may be followed by a capital (`C_nH`, the next element) but not by a small letter (`max_len`).
 */
const BEFORE = `(?<=(?:^|[^A-Za-z])[A-Za-z]|(?:^|[^A-Za-z])[A-Z]{2}|[A-Z][a-z]|[0-9)\\]α-ωΑ-Ω${SUB_ANY}${SUP_ANY}])`;
const SUB_RE = new RegExp(
  `${BEFORE}_(?:\\{([^{}]{1,12})\\}|(\\d+(?:[a-z](?:[+-]\\d+)?)?|[a-z](?:[+-]\\d+)?)(?![a-z0-9]))`,
  "g",
);
/** `^` is never prose, so any symbol may carry a power: `mc^2`, `at^2`, `sin^2`. */
const SUP_RE = new RegExp(
  `(?<=[A-Za-z0-9)\\]${SUB_ANY}${SUP_ANY}])\\^(?:\\{([^{}]{1,12})\\}|\\(([^()]{1,10})\\)|(\\d*[+-](?![A-Za-z0-9(])|\\d+|[a-z](?![A-Za-z0-9])))`,
  "g",
);
const TOKEN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_])[0-9A-Z()[\\]][0-9A-Za-z()[\\]${SUB_ANY}${SUP_ANY}]*(?![\\p{L}\\p{N}_])`,
  "gu",
);
const RUN = `[A-Za-z0-9()${SUB_ANY}]`;
const JOIN_RE = new RegExp(`(${RUN}*[${SUB_VARS}]${RUN}*) (?=([A-Z(]${RUN}*))`, "g");
const HAS_COUNT = new RegExp(`[0-9${SUB_ANY}]`);

function prettySpan(text: string): string {
  if (!/[_^\\\d$]/.test(text)) return text;
  // `$x^2$` / `$$x^2$$` inline math markers: tight against a formula, never a price or a variable.
  let s = text.replace(/(?<![\w$])(\${1,2})(?=\S)([^$\n]{1,80}?[_^\\][^$\n]{0,80}?)(?<=\S)\1(?![\w$])/g, "$2");
  if (s.includes("\\")) {
    for (const [re, to] of LATEX) s = s.replace(re, to);
    s = s.replace(/\\(sin|cos|tan|cot|tg|ctg|log|ln|lg|exp|lim|max|min|arcsin|arccos|arctan)(?![A-Za-z])/g, "$1");
    s = s.replace(/\\(?:vec|overrightarrow|bar|overline|hat|mathbf|mathit)\{([^{}]{1,12})\}/g, "$1");
    s = s.replace(/\\sqrt\[3\]\{([^{}]{1,20})\}/g, (_a, x: string) => (/^\w+$/.test(x) ? `∛${x}` : `∛(${x})`));
    s = s.replace(/\\[dt]?frac\{([^{}]{1,20})\}\{([^{}]{1,20})\}/g, (_a, a: string, b: string) => `${wrap(a)}/${wrap(b)}`);
    s = s.replace(/\\sqrt\{([^{}]{1,20})\}/g, (_a, x: string) => (/^\w+$/.test(x) ? `√${x}` : `√(${x})`));
    // `\left(`, `\,` spacing and leftover `\{ \}` braces.
    s = s.replace(/\\(?:left|right)(?=[()[\]|])/g, "").replace(/\\[,;:! ]/g, " ").replace(/\\([{}])/g, "$1");
  }
  // Twice: in `C_nH_{2n+1}` the `H` is a lone symbol only once `C_n` became `Cₙ`.
  for (let pass = 0; pass < 2; pass += 1) {
    s = s.replace(SUB_RE, (all, braced?: string, bare?: string) => mapAll((braced ?? bare ?? "").replace(/\s+/g, ""), SUB) ?? all);
  }
  s = s.replace(SUP_RE, (all, braced?: string, paren?: string, bare?: string) => {
    const body = (braced ?? paren ?? bare ?? "").replace(/\s+/g, "");
    return mapAll(body, SUP) ?? all;
  });
  // `\mathrm{H_{2}O}` unwraps once its inner braces are gone.
  if (s.includes("\\")) s = s.replace(/\\(?:mathrm|text|ce)\{([^{}]{1,40})\}/g, "$1");

  // Bare counts inside chemical tokens: C6H8O7, Ca(OH)2, (CH2).
  s = s.replace(TOKEN_RE, (tok) => subscriptBareDigits(tok));

  // `Cₙ H₂ₙ₊₁ COOH` → one formula, only after a variable subscript (which only LaTeX produces):
  // a list such as `CO₂ CH₄` keeps its spaces.
  s = s.replace(JOIN_RE, (all, before: string, next: string) => {
    const nextEls = chemElements(next);
    if (!nextEls || !chemElements(before)) return all;
    return nextEls.length >= 2 || HAS_COUNT.test(next) ? before : all;
  });
  return s;
}

/** One string: LaTeX habits and bare chemical counts to Unicode. Text without them comes back as is. */
export function prettyFormula(text: string): string {
  if (!/[_^\\\d$]/.test(text)) return text;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(PROTECTED)) {
    out += prettySpan(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + prettySpan(text.slice(last));
}

/** Keys whose text is not prose on the slide: ids, enums, links. */
const SKIP_KEYS = new Set(["layout", "id", "imageHint", "image", "src", "url", "source", "icon", "plan"]);

/** Every string in an LLM slide object, depth-limited. */
export function prettyFormulasDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return prettyFormula(value) as T;
  if (depth > 6 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => prettyFormulasDeep(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // defineProperty: a parsed `__proto__` key stays an own key, never the prototype.
    Object.defineProperty(out, k, {
      value: SKIP_KEYS.has(k) ? v : prettyFormulasDeep(v, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out as T;
}
