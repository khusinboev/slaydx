/**
 * LaTeX (cheklangan to'plam) → OMML (`docx` `Math*` bolalari) — Maqola 2.
 *
 * Formulani ko'ruvchi KaTeX bilan chizadi (`WordViewer`), DOCX esa Word
 * ning tug'ma formula obyekti (`<m:oMath>`) bilan — rasm emas: Word da
 * tahrirlanadi, LibreOffice ham o'qiydi. Qamrov ATAYIN cheklangan (maqola
 * dvigateli shu to'plamda yozadi, `article/prompts.ts`):
 *
 *   \frac{a}{b}  \sqrt{x} \sqrt[n]{x}  x^{2} x_{i} x_{i}^{2}
 *   \sum_{i=1}^{n} …   \int_{a}^{b} …   \bar{x} \overline{AB}
 *   \alpha … \Omega   \cdot \times \pm \leq \geq \neq \approx \infty \rightarrow \ldots
 *   \sin \cos \tan \log \ln \exp \max \min   \text{…} \mathrm{…}   \%  \left( \right)  \, \; \quad
 *
 * QOPLANMAGAN buyruq hujjatni BUZMAYDI: u xom matn sifatida (`MathRun`)
 * chiqadi — foydalanuvchi Word da o'zi tuzatadi, hisobotda sariq belgi.
 * Izomorf emas (docx importi) — faqat render tomonda chaqiriladi.
 */
import {
  MathFraction,
  MathFunction,
  MathIntegral,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
  type MathComponent,
} from "docx";

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
  infty: "∞", rightarrow: "→", to: "→", leftarrow: "←", Rightarrow: "⇒", leftrightarrow: "↔", ldots: "…", cdots: "⋯", dots: "…",
  partial: "∂", nabla: "∇", in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩", forall: "∀", exists: "∃", prime: "′", degree: "°",
  propto: "∝", sim: "∼", div: "÷", ast: "∗", star: "⋆", circ: "∘", langle: "⟨", rangle: "⟩", lVert: "‖", rVert: "‖",
  "%": "%", "&": "&", "#": "#", "{": "{", "}": "}", _: "_", "\\": "", ",": " ", ";": " ", ":": " ", "!": "", " ": " ", quad: "  ", qquad: "    ",
  "left": "", "right": "", "displaystyle": "", "textstyle": "",
};

const FUNCTIONS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "max", "min", "det", "dim", "lim", "sup", "inf", "arg", "gcd"]);

/** Nary (yig'indi/integral) tanasi shu tokenlarda tugaydi. */
const RELATIONS = new Set(["=", "<", ">", "\\leq", "\\geq", "\\le", "\\ge", "\\neq", "\\ne", "\\approx", "\\equiv", "\\rightarrow", "\\to", "\\Rightarrow", "\\sim", "\\propto"]);

type Tok = { t: "cmd"; v: string } | { t: "ch"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (m) {
        out.push({ t: "cmd", v: m[1] });
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    out.push({ t: "ch", v: c });
    i++;
  }
  return out;
}

class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}

  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  next(): Tok | undefined {
    return this.toks[this.i++];
  }
  atClose(): boolean {
    const t = this.peek();
    return !t || (t.t === "ch" && t.v === "}");
  }
  /** `{…}` guruhi yoki bitta atom — `\frac`, `^`, `_` argumentlari uchun. */
  arg(): MathComponent[] {
    const t = this.peek();
    if (!t) return [];
    if (t.t === "ch" && t.v === "{") {
      this.next();
      const inner = this.seq();
      const close = this.peek();
      if (close && close.t === "ch" && close.v === "}") this.next();
      return inner;
    }
    return this.atom();
  }
  /** Guruh ichidagi ketma-ketlik (`}` yoki tugaguncha). */
  seq(stopAtRelation = false): MathComponent[] {
    const out: MathComponent[] = [];
    while (!this.atClose()) {
      const t = this.peek()!;
      if (stopAtRelation && ((t.t === "ch" && RELATIONS.has(t.v)) || (t.t === "cmd" && RELATIONS.has("\\" + t.v)))) break;
      out.push(...this.atomWithScripts());
    }
    return merge(out);
  }
  /** Atom + undan keyingi `^`/`_` skriptlari. */
  atomWithScripts(): MathComponent[] {
    const base = this.atom();
    let sup: MathComponent[] | undefined;
    let sub: MathComponent[] | undefined;
    for (let k = 0; k < 2; k++) {
      const t = this.peek();
      if (!t || t.t !== "ch") break;
      if (t.v === "^" && !sup) {
        this.next();
        sup = this.arg();
      } else if (t.v === "_" && !sub) {
        this.next();
        sub = this.arg();
      } else break;
    }
    if (!sup && !sub) return base;
    const children = base.length ? base : [mkRun("")];
    if (sup && sub) return [new MathSubSuperScript({ children, subScript: sub, superScript: sup })];
    if (sup) return [new MathSuperScript({ children, superScript: sup })];
    return [new MathSubScript({ children, subScript: sub! })];
  }
  /** Bitta atom (skriptsiz). */
  atom(): MathComponent[] {
    const t = this.next();
    if (!t) return [];
    if (t.t === "ch") {
      if (t.v === "{") {
        const inner = this.seq();
        const close = this.peek();
        if (close && close.t === "ch" && close.v === "}") this.next();
        return inner.length ? inner : [mkRun("")];
      }
      if (t.v === "}") return [];
      return [mkRun(t.v)];
    }
    const cmd = t.v;
    switch (cmd) {
      case "frac":
      case "dfrac":
      case "tfrac":
        return [new MathFraction({ numerator: this.arg(), denominator: this.arg() })];
      case "sqrt": {
        let degree: MathComponent[] | undefined;
        const p = this.peek();
        if (p && p.t === "ch" && p.v === "[") {
          this.next();
          const d: MathComponent[] = [];
          while (!this.atClose() && !(this.peek()!.t === "ch" && this.peek()!.v === "]")) d.push(...this.atomWithScripts());
          if (this.peek()?.t === "ch") this.next();
          degree = merge(d);
        }
        return [new MathRadical({ children: this.arg(), ...(degree ? { degree } : {}) })];
      }
      case "sum":
      case "prod":
      case "int":
      case "iint":
      case "oint": {
        const limits = this.limits();
        const body = this.seq(true);
        const children = body.length ? body : [mkRun("")];
        if (cmd === "sum" || cmd === "prod") {
          // `MathSum` — Σ; ko'paytma uchun ham shu shakl (belgi `∏` xom matn bilan).
          return cmd === "prod"
            ? [mkRun("∏"), ...scripted(limits), ...children]
            : [new MathSum({ children, ...limits })];
        }
        return [new MathIntegral({ children, ...limits })];
      }
      case "bar":
      case "overline":
      case "hat":
      case "vec":
      case "tilde": {
        const inner = this.arg();
        const accent = cmd === "hat" ? "̂" : cmd === "vec" ? "⃗" : cmd === "tilde" ? "̃" : cmd === "overline" ? "̅" : "̄";
        const text = plainText(inner);
        if (text !== null) return [mkRun([...text].map((ch) => ch + accent).join(""))];
        return inner;
      }
      case "text":
      case "mathrm":
      case "mathbf":
      case "textbf":
      case "mathit":
      case "operatorname": {
        const raw = this.rawGroup();
        return [mkRun(raw)];
      }
      default:
        break;
    }
    if (GREEK[cmd]) return [mkRun(GREEK[cmd])];
    if (cmd in SYMBOLS) return SYMBOLS[cmd] ? [mkRun(SYMBOLS[cmd])] : [];
    if (FUNCTIONS.has(cmd)) {
      const arg = this.arg();
      return [new MathFunction({ name: [mkRun(cmd)], children: arg.length ? arg : [mkRun("")] })];
    }
    // Qoplanmagan buyruq — xom matn; hujjat buzilmaydi.
    return [mkRun(`\\${cmd}`)];
  }
  /** `_{…}^{…}` istalgan tartibda. */
  limits(): { subScript?: MathComponent[]; superScript?: MathComponent[] } {
    const out: { subScript?: MathComponent[]; superScript?: MathComponent[] } = {};
    for (let k = 0; k < 2; k++) {
      const t = this.peek();
      if (!t || t.t !== "ch") break;
      if (t.v === "_" && !out.subScript) {
        this.next();
        out.subScript = this.arg();
      } else if (t.v === "^" && !out.superScript) {
        this.next();
        out.superScript = this.arg();
      } else break;
    }
    return out;
  }
  /** `\text{…}` ichidagi xom matn (bo'shliqlar saqlanadi — tokenizator ularni tashlagan, shuning uchun qayta yig'iladi). */
  rawGroup(): string {
    const t = this.peek();
    if (!t || t.t !== "ch" || t.v !== "{") return plainText(this.atom()) ?? "";
    this.next();
    const parts: string[] = [];
    let depth = 0;
    while (this.peek()) {
      const x = this.next()!;
      if (x.t === "ch" && x.v === "{") depth++;
      else if (x.t === "ch" && x.v === "}") {
        if (!depth) break;
        depth--;
      }
      parts.push(x.t === "cmd" ? (GREEK[x.v] ?? SYMBOLS[x.v] ?? x.v) : x.v);
    }
    return parts.join("");
  }
}

function scripted(l: { subScript?: MathComponent[]; superScript?: MathComponent[] }): MathComponent[] {
  if (l.subScript && l.superScript) return [new MathSubSuperScript({ children: [mkRun("")], subScript: l.subScript, superScript: l.superScript })];
  if (l.subScript) return [new MathSubScript({ children: [mkRun("")], subScript: l.subScript })];
  if (l.superScript) return [new MathSuperScript({ children: [mkRun("")], superScript: l.superScript })];
  return [];
}

/** Faqat `MathRun` lardan iborat bo'lsa — matni; aks holda `null`. */
function plainText(list: MathComponent[]): string | null {
  const parts: string[] = [];
  for (const c of list) {
    if (!(c instanceof MathRun)) return null;
    parts.push(runText(c));
  }
  return parts.join("");
}

/**
 * `MathRun` matnini `docx` tashqariga chiqarmaydi (`m:t` ichida) —
 * qo'shish (`merge`) va urg'u (`\bar`) uchun konstruktorga berilgan
 * qiymat kuzatiladi.
 */
const RUN_TEXT = new WeakMap<MathRun, string>();
function runText(r: MathRun): string {
  return RUN_TEXT.get(r) ?? "";
}
function mkRun(text: string): MathRun {
  const r = new MathRun(text);
  RUN_TEXT.set(r, text);
  return r;
}

/** Ketma-ket `MathRun` larni bittaga qo'shadi — XML ixcham, Word tez ochadi. */
function merge(list: MathComponent[]): MathComponent[] {
  const out: MathComponent[] = [];
  for (const c of list) {
    const prev = out[out.length - 1];
    if (c instanceof MathRun && prev instanceof MathRun && RUN_TEXT.has(c) && RUN_TEXT.has(prev)) {
      out[out.length - 1] = mkRun(runText(prev) + runText(c));
    } else out.push(c);
  }
  return out;
}

/**
 * LaTeX → `Math` bolalari. Bo'sh/buzuq kirishda ham xato TASHLAMAYDI —
 * eng yomoni xom matn qaytadi.
 */
export function omml(latex: string): MathComponent[] {
  const src = (latex ?? "").trim();
  if (!src) return [mkRun("")];
  try {
    const p = new Parser(tokenize(src));
    const out = p.seq();
    // `}` ortiqcha qolgan bo'lsa — qolganini ham o'qiymiz (buzilmasin).
    while (p.peek()) {
      p.next();
      out.push(...p.seq());
    }
    return out.length ? merge(out) : [mkRun(src)];
  } catch {
    return [mkRun(src)];
  }
}
