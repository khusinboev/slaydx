/**
 * QO'LYOZMA KO'RINISH (mustaqil ish, Program 17 band 10) — YAGONA MANBA.
 *
 * Mustaqil ish mazmuni o'zgarmaydi; faqat KO'RINISH: maktab daftari
 * (chiziqli yoki katakli varaq, siyoh rangi, qo'lyozma shrifti). Bu
 * fayldagi sonlarni uch joy o'qiydi — ular ajralib ketmasligi uchun
 * shu yerda turadi:
 *
 *   • `render-hand.ts` — DOCX (qator balandligi, chegaralar, varaq foni);
 *   • `components/viewers/WordViewer.tsx` + `app/globals.css` — sayt
 *     ko'ruvchisi (CSS o'zgaruvchilar `handCssVars` dan);
 *   • `paper-png.ts` — chizilgan varaq PNG si (DOCX foni).
 *
 * Izomorf: DOM ham, `docx` ham, Node importi ham YO'Q.
 *
 * ── Qator ← → chiziq qoidasi ───────────────────────────────────────────
 * Matn QAT'IY (exact) qator balandligida yoziladi: har qator = daftarning
 * bitta chizig'i oralig'i (`pitchTw`). Barcha bo'shliqlar (`before`/`after`)
 * shu oraliqning butun karrasi, shuning uchun sahifaning istalgan qatori
 * chiziqqa tushadi. LibreOffice (va Word) aniq balandlikda matn asosini
 * (baseline) qator balandligining 80 % ida qo'yadi — chiziq aynan shu
 * balandlikda chiziladi (`BASELINE_FRACTION`, render orqali tasdiqlangan).
 * Brauzerda esa asos shrift o'lchamlaridan chiqadi (`handBaselinePx`).
 */

/* ────────────────────────── tanlovlar ────────────────────────── */

export const WORK_VIEWS = ["plain", "hand"] as const;
export type WorkView = (typeof WORK_VIEWS)[number];
export const WORK_VIEW_LABELS: Record<WorkView, string> = { plain: "Oddiy (Word)", hand: "Qo‘lyozma" };

export const HAND_INKS = ["blue", "black", "purple"] as const;
export type HandInk = (typeof HAND_INKS)[number];
export const HAND_INK_LABELS: Record<HandInk, string> = { blue: "Ko‘k", black: "Qora", purple: "Binafsha" };
/** Siyoh ranglari (HEX, `#` siz) — ruchka siyohiga yaqin, oq qog'ozda o'qiladigan to'qlikda. */
export const HAND_INK_HEX: Record<HandInk, string> = { blue: "1B3AA6", black: "1C1C1E", purple: "5B2A9E" };

export const HAND_PAPERS = ["lined", "grid"] as const;
export type HandPaper = (typeof HAND_PAPERS)[number];
export const HAND_PAPER_LABELS: Record<HandPaper, string> = { lined: "Chiziqli", grid: "Katakli" };

export const HAND_FONT_IDS = ["badscript", "caveat"] as const;
export type HandFontId = (typeof HAND_FONT_IDS)[number];

export const HAND_DEFAULTS = { ink: "blue", paper: "lined", font: "badscript" } as const satisfies { ink: HandInk; paper: HandPaper; font: HandFontId };

/** Modelga (`WorkModel.hand`) saqlanadigan tanlov. */
export type WorkHand = { ink: HandInk; paper: HandPaper; font: HandFontId };

/* ────────────────────────── shriftlar ────────────────────────── */

export type HandFontSpec = {
  id: HandFontId;
  label: string;
  /** CSS/DOCX oila nomi (shrift faylining ichidagi nom). */
  family: string;
  /** `public/fonts/handwriting/` ichidagi fayl. */
  file: string;
  /** Sayt ko'ruvchisi uchun URL. */
  url: string;
  /** Yozuv o'lchami (pt) — daftar chizig'iga nisbatan. */
  sizePt: number;
  /** `hhea` (em ulushi) — brauzer asosini hisoblash uchun; test fayl bilan solishtiradi. */
  ascent: number;
  descent: number;
  /**
   * Shrift YOPMAYDIGAN, lekin hujjatda uchrashi mumkin bo'lgan belgilar
   * va ularning o'rinbosari. Test faylning haqiqiy `cmap` ini solishtiradi
   * (ro'yxat eskirsa qizaradi).
   */
  fallback: Record<number, number>;
};

/** U+02BB «ʻ» (o‘/g‘ ning belgisi) — ikkala shriftda ham yo'q; U+2018 «‘» bor. */
const TURNED_COMMA = 0x02bb;
const LEFT_QUOTE = 0x2018;

export const HAND_FONTS: Record<HandFontId, HandFontSpec> = {
  badscript: {
    id: "badscript",
    label: "Bad Script",
    family: "Bad Script",
    file: "BadScript-Regular.ttf",
    url: "/fonts/handwriting/BadScript-Regular.ttf",
    sizePt: 16,
    ascent: 1.324,
    descent: 0.648,
    fallback: { [TURNED_COMMA]: LEFT_QUOTE },
  },
  caveat: {
    id: "caveat",
    label: "Caveat",
    family: "Caveat",
    file: "Caveat-Regular.ttf",
    url: "/fonts/handwriting/Caveat-Regular.ttf",
    sizePt: 20,
    ascent: 0.96,
    descent: 0.3,
    fallback: { [TURNED_COMMA]: LEFT_QUOTE },
  },
};

export const HAND_FONT_LIST: HandFontSpec[] = HAND_FONT_IDS.map((id) => HAND_FONTS[id]);

/**
 * Shrift yopmaydigan belgini o'rinbosariga almashtiradi (`ʻ` → `‘`).
 * DOCX ham, ko'ruvchi ham matnni SHU funksiya orqali o'tkazadi.
 */
export function handText(font: HandFontId, text: string): string {
  const map = HAND_FONTS[font].fallback;
  let out = "";
  for (const ch of text) {
    const to = map[ch.codePointAt(0)!];
    out += to === undefined ? ch : String.fromCodePoint(to);
  }
  return out;
}

/* ────────────────────────── daftar varag'i ────────────────────────── */

/** Twip → mm / px (96 dpi) / pt. */
export const twToMm = (tw: number) => (tw / 1440) * 25.4;
export const twToPx = (tw: number) => tw / 15;
export const mmToTw = (mm: number) => Math.round((mm / 25.4) * 1440);

/** LibreOffice/Word: aniq qator balandligida matn asosi qator balandligining 80 % ida. */
export const BASELINE_FRACTION = 0.8;

export type HandPaperSpec = {
  id: HandPaper;
  /** Matn qatorlari oralig'i (twip) — bitta qator = bitta daftar oralig'i. */
  pitchTw: number;
  /** Chizma oralig'i (mm): chiziqlida = qator; katakli daftarda 5 mm katak, qator ikki katak. */
  cellMm: number;
  ruleHex: string;
  /** Chiziq qalinligi (mm). */
  ruleMm: number;
};

export const HAND_PAPER_SPECS: Record<HandPaper, HandPaperSpec> = {
  lined: { id: "lined", pitchTw: 510, cellMm: twToMm(510), ruleHex: "8FB3D9", ruleMm: 0.3 },
  grid: { id: "grid", pitchTw: 567, cellMm: 5, ruleHex: "A9C4E4", ruleMm: 0.25 },
};

/** Sahifa (A4) va chap chegara chizig'i. */
export const HAND_PAGE = {
  widthTw: 11906,
  heightTw: 16838,
  topTw: mmToTw(18),
  /** Pastki chegara kamida shuncha (sahifa raqami sig'sin), qolgani butun qatorlardan chiqadi. */
  bottomMinTw: 1000,
  /** Qizil chap chegara chizig'i (mm, sahifa chetidan). */
  redLineMm: 20,
  redHex: "E0736F",
  redMm: 0.4,
  /** Matn chap chekkasi — qizil chiziqdan 5 mm o'ngda (katak chizig'iga tushadi). */
  leftTw: mmToTw(25),
  rightTw: mmToTw(12),
  /** Abzats chekinishi. */
  firstLineTw: mmToTw(12),
} as const;

export type HandGeometry = {
  paper: HandPaper;
  font: HandFontSpec;
  pitchTw: number;
  pitchPx: number;
  /** Bir sahifadagi qatorlar soni. */
  lines: number;
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
  sizePt: number;
  /** Matn kengligi (twip). */
  contentTw: number;
  /** DOCX (LibreOffice/Word) da birinchi chiziq: sahifa tepasidan mm. */
  docxRuleY0Mm: number;
  /** Ko'ruvchida (brauzer) birinchi chiziq: sahifa tepasidan px. */
  viewerRuleY0Px: number;
};

/** Brauzerda qator ichida matn asosi (px, qator qutisi tepasidan): yarim-leading + ascent. */
export function handBaselinePx(font: HandFontSpec, sizePt: number, pitchPx: number): number {
  const sizePx = (sizePt * 96) / 72;
  return (pitchPx - (font.ascent + font.descent) * sizePx) / 2 + font.ascent * sizePx;
}

export function handGeometry(paper: HandPaper, fontId: HandFontId): HandGeometry {
  const spec = HAND_PAPER_SPECS[paper];
  const font = HAND_FONTS[fontId];
  const lines = Math.floor((HAND_PAGE.heightTw - HAND_PAGE.topTw - HAND_PAGE.bottomMinTw) / spec.pitchTw);
  // +10 twip zaxira: yaxlitlash oxirgi qatorni keyingi sahifaga tashlamasin.
  const bottom = HAND_PAGE.heightTw - HAND_PAGE.topTw - lines * spec.pitchTw - 10;
  const pitchPx = twToPx(spec.pitchTw);
  return {
    paper,
    font,
    pitchTw: spec.pitchTw,
    pitchPx,
    lines,
    margins: { top: HAND_PAGE.topTw, bottom, left: HAND_PAGE.leftTw, right: HAND_PAGE.rightTw, header: 0, footer: mmToTw(7) },
    sizePt: font.sizePt,
    contentTw: HAND_PAGE.widthTw - HAND_PAGE.leftTw - HAND_PAGE.rightTw,
    docxRuleY0Mm: twToMm(HAND_PAGE.topTw + BASELINE_FRACTION * spec.pitchTw),
    viewerRuleY0Px: twToPx(HAND_PAGE.topTw) + handBaselinePx(font, font.sizePt, pitchPx),
  };
}

/* ────────────────────────── reja uslubi ────────────────────────── */

/** `planWork` ko'tarib yuradigan uslub: DOCX ham, ko'ruvchi ham FAQAT shundan o'qiydi. */
export type HandStyle = WorkHand & {
  kind: "handwritten";
  inkHex: string;
  family: string;
  fontFile: string;
  fontUrl: string;
};

export function handStyleOf(hand: WorkHand): HandStyle {
  const font = HAND_FONTS[hand.font];
  return { kind: "handwritten", ...hand, inkHex: HAND_INK_HEX[hand.ink], family: font.family, fontFile: font.file, fontUrl: font.url };
}

export const isHandInk = (v: unknown): v is HandInk => (HAND_INKS as readonly string[]).includes(String(v));
export const isHandPaper = (v: unknown): v is HandPaper => (HAND_PAPERS as readonly string[]).includes(String(v));
export const isHandFont = (v: unknown): v is HandFontId => (HAND_FONT_IDS as readonly string[]).includes(String(v));

/** Tashqi (xom) qiymatdan toza tanlov; noma'lum qiymat standartga tushadi. */
export function normalizeHand(raw: { ink?: unknown; paper?: unknown; font?: unknown }): WorkHand {
  return {
    ink: isHandInk(raw.ink) ? raw.ink : HAND_DEFAULTS.ink,
    paper: isHandPaper(raw.paper) ? raw.paper : HAND_DEFAULTS.paper,
    font: isHandFont(raw.font) ? raw.font : HAND_DEFAULTS.font,
  };
}

/* ────────────────────────── ko'ruvchi CSS ────────────────────────── */

/**
 * Ko'ruvchi varag'i uchun CSS o'zgaruvchilar. Chiziq fonini `app/globals.css`
 * `.word-hand` qoidasi shu o'zgaruvchilardan quradi.
 */
export function handCssVars(style: HandStyle): Record<string, string> {
  const g = handGeometry(style.paper, style.font);
  const spec = HAND_PAPER_SPECS[style.paper];
  const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;
  const mmPx = (mm: number) => (mm / 25.4) * 96;
  const ruleW = Math.max(1, mmPx(spec.ruleMm));
  const redX = mmPx(HAND_PAGE.redLineMm);
  /* Chiziq qadami: chiziqlida = qator oralig'i; katakli varaqda ikki katak = bir qator. */
  const cell = style.paper === "grid" ? g.pitchPx / 2 : g.pitchPx;
  const mod = (v: number, m: number) => v - Math.floor(v / m) * m;
  return {
    "--hand-ink": `#${style.inkHex}`,
    "--hand-family": `"${g.font.family}"`,
    "--hand-size": `${g.sizePt}pt`,
    "--hand-pitch": px(g.pitchPx),
    "--hand-lines": String(g.lines),
    "--hand-rule": `#${spec.ruleHex}`,
    "--hand-rule-w": px(ruleW),
    "--hand-red": `#${HAND_PAGE.redHex}`,
    "--hand-red-x": px(redX),
    "--hand-red-w": px(Math.max(1, mmPx(HAND_PAGE.redMm))),
    "--hand-y0": px(g.viewerRuleY0Px),
    "--hand-cell": px(cell),
    /** Birinchi gorizontal chiziq `--hand-phase` da (0…cell), birinchi vertikal katak chizig'i `--hand-vphase` da. */
    "--hand-phase": px(mod(g.viewerRuleY0Px, cell)),
    "--hand-vphase": px(mod(redX, cell)),
    "--hand-first-line": px(twToPx(HAND_PAGE.firstLineTw)),
    "--hand-pad": `${px(twToPx(g.margins.top))} ${px(twToPx(g.margins.right))} ${px(twToPx(g.margins.bottom))} ${px(twToPx(g.margins.left))}`,
  };
}

/** `@font-face` (ko'ruvchi va forma namunasi) — `app/globals.css` bilan bir xil nom/URL. */
export function handFontFaceCss(): string {
  return HAND_FONT_LIST.map((f) => `@font-face{font-family:"${f.family}";src:url("${f.url}") format("truetype");font-display:swap}`).join("\n");
}

/* ────────────────────────── titul (daftar muqovasi) ────────────────────────── */

export type HandCoverLine =
  | { role: "gap" }
  | { role: "center"; text: string; big?: boolean }
  | { role: "field"; label: string; text: string };

/** Titul modelining (`title-model.ts`, `kind: "gost"`) daftar muqovasiga kerakli qismi. */
export type HandCoverSource = {
  university: string;
  workLabel: string;
  subjectLine?: string;
  topic: string;
  topicLabel?: string;
  author?: string;
  authorLabel: string;
  courseLine?: string;
  teacher?: string;
  teacherLabel: string;
  cityYear: string;
};

/**
 * Daftar muqovasi: «Mustaqil ish / fan / mavzu / bajardi / tekshirdi».
 * Rasmiy titulning vazirlik, fakultet, kafedra va o'quv yili qatorlari
 * ATAYIN yo'q — qo'lyozma muqova sodda. DOCX va ko'ruvchi BIR ro'yxatni chizadi.
 */
export function handCoverLines(T: HandCoverSource): HandCoverLine[] {
  const out: HandCoverLine[] = [{ role: "gap" }, { role: "gap" }];
  if (T.university) out.push({ role: "center", text: T.university }, { role: "gap" });
  out.push({ role: "center", text: T.workLabel, big: true });
  if (T.subjectLine) out.push({ role: "center", text: T.subjectLine });
  out.push({ role: "gap" });
  out.push({ role: "center", text: T.topicLabel ? `${T.topicLabel} «${T.topic}»` : `«${T.topic}»` });
  out.push({ role: "gap" }, { role: "gap" });
  if (T.author) out.push({ role: "field", label: T.authorLabel, text: T.author });
  if (T.courseLine) out.push({ role: "field", label: "", text: T.courseLine });
  if (T.teacher) out.push({ role: "field", label: T.teacherLabel, text: T.teacher });
  out.push({ role: "gap" }, { role: "gap" });
  out.push({ role: "center", text: T.cityYear });
  return out;
}

/* ────────────────────────── formula (qo'lyozmada) ────────────────────────── */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
const OPS: Record<string, string> = {
  cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", infty: "∞", sum: "Σ", prod: "Π",
  int: "∫", partial: "∂", nabla: "∇", rightarrow: "→", to: "→", leftarrow: "←", Rightarrow: "⇒", cdots: "…", ldots: "…", degree: "°",
};
const ACCENT: Record<string, string> = { bar: "\u0304", overline: "\u0304", hat: "\u0302", vec: "\u20D7", tilde: "\u0303" };
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ", i: "ⁱ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };

function script(body: string, table: Record<string, string>, mark: string): string {
  const chars = [...body];
  return chars.every((c) => table[c]) ? chars.map((c) => table[c]).join("") : `${mark}(${body})`;
}

/**
 * LaTeX → oddiy matn («E = mc²»). Qo'lyozmada formula qo'lda yoziladi:
 * brauzer/LibreOffice formula tahrirchisi (matematik shrift, aniq bo'lmagan
 * balandlik) chiziqlarga mos kelmaydi. Murakkab tuzilma (kasr, ildiz,
 * daraja) qavs bilan ochiq yoziladi.
 */
export function handFormulaText(latex: string): string {
  let s = latex
    .replace(/\\(?:left|right|,|;|!|quad|qquad)/g, " ")
    .replace(/\\([%$&#_{}])/g, "$1")
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1")
    .replace(/\\(bar|overline|hat|vec|tilde)\{([^{}]*)\}/g, (_, cmd: string, body: string) => `${body}${ACCENT[cmd]}`);
  // Ichki-ichiga tushgan kasr/ildizlarni ketma-ket yechamiz.
  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, "$1√($2)")
      .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/\^\{([^{}]*)\}/g, (_, b: string) => script(b, SUP, "^"))
    .replace(/\^(\w)/g, (_, b: string) => script(b, SUP, "^"))
    .replace(/_\{([^{}]*)\}/g, (_, b: string) => script(b, SUB, "_"))
    .replace(/_(\w)/g, (_, b: string) => script(b, SUB, "_"))
    .replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? OPS[name] ?? name)
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}
