import { languageDirective } from "./i18n";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { isDeadlineError } from "./deadline";
import { remainingMs } from "./quality";
import { bodyRules, type BodyRules } from "./slide-audience";
import { CHAR_EM, LAYOUT_KIT, planSlide, type SlideLayer } from "./slide-layout";
import { SLIDE_LIMITS, clipTo, limitsFor } from "./slide-limits";
import type { SlidePromptCtx } from "./slide-prompt/ctx";
import { researchLines } from "./slide-prompt/research";
import type { SlideTemplate, SlideVisual } from "./slide-templates";
import { getSlideTheme } from "./slide-themes";
import type { SlideModel, SlideSrc, SlideStep } from "./slide-types";
import type { DocMeta } from "./types";
import { DESIGN_VISUALS, LEGACY_VISUALS } from "./visuals/spec";

/**
 * Matn ZICHLIGI — «yupqa slayd» detektori va bitta chaqiruvli ta'mir
 * (AUDIT-25 S4 / 6-qaror).
 *
 * Jonli dekada (Orol dengizi, Kasr sonlar) mazmun slaydlarida 2–3 qisqa
 * band, process kartalarida 3–4 so'zli matn, bo'lim slaydida bo'sh
 * subtitle, test variantlari esa «…» bilan kesilgan chiqdi. Uch qatlam:
 *
 *   1) `layoutWordTargets` — har maket uchun SO'Z ORALIG'I. Raqamlar
 *      `BodyRules` dan (auditoriya × matn hajmi) va MAKETNING O'ZIDAN
 *      (`planSlide` qutisi, auditoriya shrift poli) hisoblanadi — prompt
 *      (`slide-prompt/brief.ts`) va detektor BIR manbadan o'qiydi;
 *   2) `thinSlides` — deterministik detektor (LLM yo'q);
 *   3) `repairThinSlides` — faqat yupqa slaydlar uchun BITTA qo'shimcha
 *      LLM chaqiruvi; javob faqat slayd endi yupqa bo'lmasa qabul
 *      qilinadi, aks holda asl slayd qoladi. Hech qachon otmaydi.
 */

// ───────────────────────────────────────────────────────── chegaralar

/**
 * Bandlar: o'rtacha so'z soni ⌊`THIN_BULLET_K × bulletChars/8`⌋ dan kam
 * bo'lsa — yupqa. Promptdagi QUYI chegara ham aynan shu son
 * (`bulletMinWords`), ya'ni ko'rsatmaga rioya qilgan model hech qachon
 * «yupqa» deb topilmaydi.
 */
export const THIN_BULLET_K = 0.55;
/** `process` bosqich matni shundan kam so'z bo'lsa — yupqa («Boshlash», «Natija» kabi yorliq). */
export const STEP_MIN_WORDS = 6;
/** `process` da shundan kam bosqich — jarayon emas, ro'yxat parchasi. */
export const PROCESS_MIN_STEPS = 3;
/** `twoCol`/`compare` ustunida shundan kam band — ustun bo'sh ko'rinadi. */
export const COL_MIN_ITEMS = 2;
/** Ustun bandlarining o'rtacha so'z soni shundan kam — yorliq, gap emas. */
export const COL_MIN_WORDS = 5;
/**
 * `section` subtitle shundan kam so'z — amalda BO'SH: skelet
 * (`beatToSlide`) subtitle ga faqat mavzu nomini yozadi («Orol dengizi»).
 */
export const SECTION_SUBTITLE_MIN_WORDS = 6;
/**
 * Iqtibos uchun PROMPT poli (so'z). Detektor iqtibosni o'lchamaydi:
 * haqiqiy qisqa iqtibosni («Bilim — kuch.») uzaytirish — uydirma.
 */
export const QUOTE_MIN_WORDS = 8;

/**
 * Sig'imni so'zga aylantirish koeffitsiyenti: o'zbekcha o'rtacha so'z +
 * probel ~9 belgi (`tests/slide-chart.test.mts` o'lchovi bilan bir xil).
 * Belgidan so'zga o'tishda ATAYLAB past baho — «≤ N so'z» ga rioya
 * qilgan javob qutiga albatta sig'sin.
 */
export const CHARS_PER_WORD = 9;

/** Bandning quyi chegarasi (so'z) — prompt ham, detektor ham shuni o'qiydi. */
export function bulletMinWords(rules: Pick<BodyRules, "bulletChars">): number {
  // `floor`: 1–4 sinfda 5.5 → 5 (round 6 ga chiqarib, 5 so'zli bolalar bandini «yupqa» derdi).
  return Math.floor((rules.bulletChars * THIN_BULLET_K) / 8);
}

/**
 * Bandning yuqori chegarasi (so'z). Ilgari `bulletChars / 8` edi —
 * talabada 21 so'z ≈ 190 belgi, qirqish esa 165 da: ko'rsatmaga TO'LIQ
 * rioya qilgan band «…» bilan kesilardi. Endi `CHARS_PER_WORD` bilan.
 */
export function bulletMaxWords(rules: Pick<BodyRules, "bulletChars">): number {
  return Math.floor(rules.bulletChars / CHARS_PER_WORD);
}

// ───────────────────────────────────────────────────────── maket sig'imi

/**
 * O'lchanadigan maydonlar. Soni o'zgaruvchi maydonlarda (`bullets`,
 * `colItem`, `stepText`, `stepTitle`, `statLabel`, `tableCell`,
 * `tableHeader`) sig'im elementlar SONIGA bog'liq — `fitChars` ning
 * `count` argumenti (jadvalda — ustunlar; qatorlar `opts.rows`).
 */
export type FitField =
  | "title"
  | "colTitle"
  | "bullets"
  | "colItem"
  | "stepText"
  | "stepTitle"
  | "statLabel"
  | "tableCell"
  | "tableHeader"
  | "subtitleSection"
  | "subtitleClosing"
  | "quote"
  | "quoteBy"
  | "quizQ"
  | "quizOption";

/**
 * Shrifti AUDITORIYA oralig'ida tanlanadigan maydonlar (`fitLines`/
 * `bodyFit` — `bodyPt` → `minPt`). P2 A2-04 dan keyin `bodyFit` matn
 * polda ham sig'masa shriftni polDAN PAST tushirib qutida saqlaydi —
 * shuning uchun bu maydonlarda «sig'di» = qutiga sig'di VA shrift
 * auditoriya polidan past emas (Slide Law). Qolgan maydonlarning
 * shrifti dizayndan (sarlavha, iqtibos) — ularda faqat quti.
 */
const AUDIENCE_FIELDS: ReadonlySet<FitField> = new Set([
  "bullets",
  "colItem",
  "stepText",
  "stepTitle",
  "statLabel",
  "tableCell",
  "tableHeader",
  "quizOption",
]);

const ALL_VISUALS: SlideVisual[] = [...LEGACY_VISUALS, ...DESIGN_VISUALS];
const PROBE_THEME = getSlideTheme("atlas");
/** Tasma rasmi — `twoCol`/`process`/`stats`/`table` da kontent zonasini toraytiradi (A1-01). */
const PROBE_IMAGE = { url: "data:image/png;base64,AAAA" };
/** Real o'zbekcha so'zlar — sig'im «ooo…» bilan emas, so'z bo'yicha qatorlashda o'lchanadi. */
const PROBE_WORDS =
  "Orol dengizining qurishi mintaqadagi iqlim sharoitini keskin o‘zgartirdi va aholining sog‘lig‘iga jiddiy ta’sir ko‘rsatdi shuning uchun suv resurslarini tejash hamda qishloq xo‘jaligida zamonaviy sug‘orish usullarini joriy etish muhim vazifa hisoblanadi".split(
    " ",
  );

function probeText(words: number): string {
  return Array.from({ length: words }, (_, i) => PROBE_WORDS[i % PROBE_WORDS.length]).join(" ");
}

type Probe = {
  /** Soni o'zgaruvchi maydonda standart son (auditoriya ruxsati). */
  count?: (rules: BodyRules) => number;
  slide: (t: string, n: number, rows: number) => SlideModel;
  match: (src: SlideSrc | undefined) => boolean;
};

const fill = (n: number, t: string) => Array.from({ length: n }, () => t);
const isSteps = (s: SlideSrc | undefined) => s?.f === "steps" && s.k === "text";
const stepsOf = (n: number, title: string, text: string): SlideStep[] =>
  Array.from({ length: n }, (_, i) => ({ n: String(i + 1), title, text }));
const tableOf = (cols: number, rows: number, head: string, cell: string) => ({
  headers: fill(cols, head),
  rows: Array.from({ length: rows }, () => fill(cols, cell)),
});

/** Sinov slaydi va shu maydon qatlamini taniydigan predikat. */
const PROBES: Record<FitField, Probe> = {
  title: {
    // Eng tor sarlavha — rasmli `section` (classic): sarlavha qutisi rasm yonida.
    slide: (t) => ({ id: "fit", layout: "section", title: t, subtitle: probeText(10) }),
    match: (s) => s?.f === "title",
  },
  colTitle: {
    slide: (t) => ({ id: "fit", layout: "twoCol", title: "Ikki tomon", leftTitle: t, rightTitle: t, left: ["Band matni."], right: ["Band matni."] }),
    match: (s) => s?.f === "leftTitle" || s?.f === "rightTitle",
  },
  bullets: {
    count: (r) => r.maxBullets,
    slide: (t, n) => ({ id: "fit", layout: "bullets", title: "Sarlavha", bullets: fill(n, t) }),
    match: (s) => s?.f === "bullets",
  },
  colItem: {
    count: () => SLIDE_LIMITS.colItems,
    slide: (t, n) => ({ id: "fit", layout: "twoCol", title: "Ikki tomon", leftTitle: "Chap", rightTitle: "O‘ng", left: fill(n, t), right: fill(n, t) }),
    match: (s) => s?.f === "left" || s?.f === "right",
  },
  stepText: {
    count: (r) => r.stepsMax,
    slide: (t, n) => ({ id: "fit", layout: "process", title: "Jarayon", steps: stepsOf(n, "Bosqich nomi", t) }),
    match: isSteps,
  },
  stepTitle: {
    count: (r) => r.stepsMax,
    slide: (t, n) => ({ id: "fit", layout: "process", title: "Jarayon", steps: stepsOf(n, t, probeText(5)) }),
    match: (s) => s?.f === "steps" && s.k === "title",
  },
  statLabel: {
    count: (r) => r.statsMax,
    slide: (t, n) => ({ id: "fit", layout: "stats", title: "Ko‘rsatkichlar", stats: Array.from({ length: n }, (_, i) => ({ value: `${i + 2}0 %`, label: t })) }),
    match: (s) => s?.f === "stats" && s.k === "label",
  },
  tableCell: {
    count: (r) => r.tableCols,
    slide: (t, n, rows) => ({ id: "fit", layout: "table", title: "Jadval", table: tableOf(n, rows, "Ustun", t) }),
    match: (s) => s?.f === "table" && s.k === "cell",
  },
  tableHeader: {
    count: (r) => r.tableCols,
    slide: (t, n, rows) => ({ id: "fit", layout: "table", title: "Jadval", table: tableOf(n, rows, t, "Katak") }),
    match: (s) => s?.f === "table" && s.k === "header",
  },
  subtitleSection: { slide: (t) => ({ id: "fit", layout: "section", title: "Bo‘lim sarlavhasi", subtitle: t }), match: (s) => s?.f === "subtitle" },
  subtitleClosing: { slide: (t) => ({ id: "fit", layout: "closing", title: "Xulosa", subtitle: t }), match: (s) => s?.f === "subtitle" },
  quote: { slide: (t) => ({ id: "fit", layout: "quote", title: "Iqtibos", quote: t, quoteBy: "Muallif" }), match: (s) => s?.f === "quote" },
  quoteBy: {
    slide: (t) => ({ id: "fit", layout: "quote", title: "Iqtibos", quote: probeText(15), quoteBy: t }),
    match: (s) => s?.f === "quoteBy",
  },
  quizQ: {
    slide: (t) => ({ id: "fit", layout: "quiz", title: "Nazorat savoli", quiz: [{ q: t, options: ["Bir", "Ikki", "Uch", "To‘rt"], answer: 0 }] }),
    match: (s) => s?.f === "quiz" && "k" in s && s.k === "q",
  },
  quizOption: {
    slide: (t) => ({ id: "fit", layout: "quiz", title: "Nazorat savoli", quiz: [{ q: probeText(12), options: fill(4, t), answer: 0 }] }),
    match: (s) => s?.f === "quiz" && "k" in s && s.k === "option",
  },
};

type TextLayer = Extract<SlideLayer, { t: "text" }>;

/**
 * Qatlam o'z shriftida qutiga sig'adimi — maketning O'Z o'lchovi bilan:
 * oddiy matn `LAYOUT_KIT.inkHeight` (qalin qatlamda `CHAR_EM_BOLD`,
 * P2 A2-04), ro'yxat `listRows` (band chekinishi bilan). Ikkala joyda
 * alohida formula bo'lmasin — aks holda o'lchov maketdan ajralib ketadi.
 * 1 pt bardosh: 0.2 pt «oshish» ko'zga ko'rinmaydi.
 */
function layerFits(l: TextLayer): boolean {
  const room = l.box.h * 72 + 1;
  if (l.lines) {
    const rows = LAYOUT_KIT.listRows(l.lines, l.box, l.size);
    // Oxirgi banddan keyingi oraliq ko'rinmaydi (matn tepadan boshlanadi) — n−1 ta oraliq.
    return rows * l.size * 1.3 + Math.max(0, l.lines.length - 1) * (l.paraSpace ?? 0) <= room;
  }
  const em = l.bold ? LAYOUT_KIT.CHAR_EM_BOLD : CHAR_EM;
  return LAYOUT_KIT.inkHeight(l.text ?? "", l.box.w, l.size, em) * 72 <= room;
}

function probeLayers(p: Probe, words: number, n: number, rows: number, rules: BodyRules, visual: SlideVisual, image: boolean): TextLayer[] {
  const slide = p.slide(probeText(words), n, rows);
  const plan = planSlide(image ? { ...slide, image: PROBE_IMAGE } : slide, PROBE_THEME, visual, 3, 10, "auto", "lecture", {
    bodyType: rules,
  });
  return plan.layers.filter(
    (l): l is TextLayer => l.t === "text" && (p.match(l.src) || (l.srcLines ?? []).some((s) => p.match(s))),
  );
}

/** 40 so'z ≈ 340 belgi — eng uzun qopqoqdan (quote 280) ham katta. */
const MAX_PROBE_WORDS = 40;
const fitCache = new Map<string, number>();

export type FitOpts = {
  /** Jadval qatorlari (faqat `tableCell`/`tableHeader`); berilmasa — auditoriya ruxsati `rules.tableRows`. */
  rows?: number;
  /** "both" — rasmli va rasmsizning kichigi (standart); "none" — faqat rasmsiz (`limitsFor` jadvali qulfi). */
  images?: "both" | "none";
};

/**
 * Maydon maketda auditoriya shrift POLIDA necha BELGI ko'taradi —
 * `planSlide` ning o'zidan o'lchanadi (yagona manba: P2 qutini yoki
 * polni o'zgartirsa, prompt, detektor va qirqish ham avtomatik
 * ergashadi). Rasmli VA rasmsiz holatning kichigi olinadi: rasm matn
 * yozilgandan KEYIN qo'shiladi (`attachSlideImages`), yozuv paytida
 * uning bo'lishi noma'lum. `visual` berilmasa — 17 vizualning ENG TORI.
 * `count` — elementlar soni (bosqich, karta, ustun, band).
 */
export function fitChars(field: FitField, rules: BodyRules, visual?: SlideVisual, count?: number, opts: FitOpts = {}): number {
  const p = PROBES[field];
  const n = Math.max(1, Math.round(count ?? p.count?.(rules) ?? 1));
  const rows = Math.max(1, Math.round(opts.rows ?? rules.tableRows));
  const images = opts.images ?? "both";
  const key = `${field}|${n}|${rows}|${visual ?? "*"}|${rules.bodyPt}|${rules.minPt}|${images}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  const floored = AUDIENCE_FIELDS.has(field);
  let chars = Number.POSITIVE_INFINITY;
  for (const v of visual ? [visual] : ALL_VISUALS) {
    for (const image of images === "none" ? [false] : [false, true]) {
      const base = probeLayers(p, 1, n, rows, rules, v, image);
      // Bu vizualda maydon chizilmaydi — cheklov yo'q.
      if (!base.length) continue;
      // Pol: auditoriya poli, lekin dizayn shrifti undan kichik bo'lsa — o'sha (1 so'zdagi o'lcham).
      const floors = base.map((l) => (floored ? Math.min(rules.minPt, l.size) : 0));
      const fits = (words: number) => {
        const ls = probeLayers(p, words, n, rows, rules, v, image);
        return ls.length === floors.length && ls.every((l, i) => layerFits(l) && l.size >= floors[i]);
      };
      /*
       * CHIZIQLI qidiruv — BIRINCHI sig'masligigacha. Ikkilik qidiruv
       * noto'g'ri edi: ba'zi vizuallar matn uzunligiga qarab boshqa
       * joylashuvga o'tadi (sig'im monoton emas) va u tasodifiy nuqtani
       * topardi (`dashboard` twoCol: 111 o'rniga 75).
       */
      let fit = 0;
      while (fit < MAX_PROBE_WORDS && fits(fit + 1)) fit += 1;
      chars = Math.min(chars, probeText(fit).length);
    }
  }
  if (!Number.isFinite(chars)) chars = probeText(MAX_PROBE_WORDS).length;
  fitCache.set(key, chars);
  return chars;
}

// ───────────────────────────────────────────────────────── qirqish chegarasi

/**
 * O'LCHOV shundan past qisilmaydi (~3 so'z): vizualning eng tor qutisi
 * bundan ham tor bo'lsa, qirqish ma'noni o'ldiradi — bu MAKET muammosi.
 * DIQQAT: bu faqat jonli o'lchovga tegishli. `limitsFor` jadvali
 * (auditoriya poli × son) undan PAST bo'lishi mumkin (1–4 sinf 5
 * bosqich — 10 belgi, 5×6 jadval — 5): bunday son yosh auditoriyaga
 * ruxsat etilmaydi (`countRules`), ya'ni `normalizeSlide` AVVAL sonni
 * qisadi (P1 W3), keyin uzunlikni — shunda bu kataklar ishlatilmaydi.
 */
export const CLIP_FLOOR_CHARS = 24;

/**
 * Mos qopqoq: bandlar — auditoriya `bulletChars`; soni o'zgaruvchi
 * maydonlar va test varianti — `limitsFor` (pol × son jadvali, klient
 * ham o'qiydi); qolgani — statik `SLIDE_LIMITS`.
 */
function staticCap(field: FitField, rules: BodyRules, count?: number, rows?: number): number {
  switch (field) {
    case "bullets":
      return rules.bulletChars;
    case "stepText":
    case "stepTitle":
      return limitsFor(rules, { steps: count })[field];
    case "statLabel":
      return limitsFor(rules, { stats: count })[field];
    case "tableCell":
    case "tableHeader":
      return limitsFor(rules, { cols: count, rows })[field];
    case "quizOption":
      return limitsFor(rules).quizOption;
    case "subtitleSection":
    case "subtitleClosing":
    case "quote":
    case "quoteBy":
    case "quizQ":
    case "title":
    case "colTitle":
    case "colItem":
      return SLIDE_LIMITS[field];
  }
}

/**
 * Model matnini QIRQISH chegarasi — auditoriya × vizual × element soni.
 *
 * = min(`limitsFor` (yoki statik qopqoq), max(`CLIP_FLOOR_CHARS`, deka
 * vizualidagi jonli sig'im)). Maket avval shriftni polgacha kichraytiradi,
 * pol shriftida ham sig'maydigan qismigina so'z chegarasida (`clipTo`)
 * qirqiladi. `limitsFor` dan hech qachon oshmaydi (generatsiya ⊆ tahrir).
 *
 * P1: `normalizeSlide` da AVVAL son (`rules.stepsMax`/`statsMax`/
 * `tableCols`/`tableRows`), keyin `clipTo(x, clipLimit("stepText",
 * rules, tpl.visual, steps.length))`; jadvalda `clipLimit("tableCell",
 * rules, visual, cols, rows)`.
 */
export function clipLimit(field: FitField, rules: BodyRules, visual?: SlideVisual, count?: number, rows?: number): number {
  const cap = staticCap(field, rules, count, rows);
  return Math.min(cap, Math.max(CLIP_FLOOR_CHARS, fitChars(field, rules, visual, count, { rows })));
}

// ───────────────────────────────────────────────────────── so'z oraliqlari

export type WordRange = { min: number; max: number };

export type LayoutWordTargets = {
  bullet: WordRange;
  /** Ustundagi band soni yuqori chegarasi (band kamida `COL_MIN_WORDS` so'z sig'sin). */
  maxColItems: number;
  /** `maxColItems` bandli ustunda bitta band. */
  colItem: WordRange;
  /** Ustun sarlavhasi — faqat yuqori chegara (quti va `SLIDE_LIMITS.colTitle`). */
  colTitleMax: number;
  /** Bosqich soni yuqori chegarasi — auditoriya ruxsati, vizual sig'imi bilan qisilgan. */
  maxSteps: number;
  /** Bosqich matni — HAR SON uchun alohida (3 bosqichda keng, 4–5 da tor). */
  stepTextBy: Record<number, WordRange>;
  /** `maxSteps` bosqichdagi (eng tor) oraliq. */
  stepText: WordRange;
  /** Karta soni yuqori chegarasi (label kamida `STAT_LABEL_MIN_WORDS` so'z sig'sin). */
  maxStats: number;
  statLabelMax: number;
  /** Jadval ustunlari yuqori chegarasi (katak kamida `tableCellMinWords(rules)` so'z sig'sin). */
  maxTableCols: number;
  /** Jadval qatorlari — auditoriya ruxsati (`BodyRules.tableRows`). */
  maxTableRows: number;
  /** (`maxTableCols`, `maxTableRows`) jadvalidagi katak — `limitsFor`/`clipLimit` bilan BIR kalit. */
  tableCellMax: number;
  sectionSubtitle: WordRange;
  closingSubtitle: WordRange;
  quote: WordRange;
  quoteByMax: number;
  quizQMax: number;
  quizOptionMax: number;
};

/** Stats yorlig'i shundan kam so'z sig'adigan karta soni taklif qilinmaydi. */
export const STAT_LABEL_MIN_WORDS = 3;
/** Jadval katagi shundan kam so'z sig'adigan ustun soni taklif qilinmaydi (yosh auditoriya, pol ≥ 18 pt). */
export const TABLE_CELL_MIN_WORDS = 2;
/**
 * Kattalar (pol ≤ 16 pt) uchun katak poli: talaba jadvali 4 ta 2 so'zli
 * ustundan ko'ra 3 ta TO'LIQROQ ustunni afzal ko'radi (AUDIT-25 P3
 * qayta sharh N2 — «4 tagacha ustun, katak ≤ 2 so'z» chiqardi).
 */
export const TABLE_CELL_MIN_WORDS_ADULT = 3;

/** Auditoriya uchun katak poli (so'z) — ustun soni shunga qarab tanlanadi. */
export function tableCellMinWords(rules: Pick<BodyRules, "minPt">): number {
  return rules.minPt <= 16 ? TABLE_CELL_MIN_WORDS_ADULT : TABLE_CELL_MIN_WORDS;
}

/** Belgi sig'imi → so'z, qopqoqdan oshmasdan. */
function capWords(chars: number, limit: number): number {
  return Math.max(1, Math.floor(Math.min(chars, limit) / CHARS_PER_WORD));
}

/** Maydonning so'zdagi sig'imi (qopqoq bilan). */
function fitWords(field: FitField, rules: BodyRules, visual?: SlideVisual, count?: number, rows?: number): number {
  return capWords(fitChars(field, rules, visual, count, { rows }), staticCap(field, rules, count, rows));
}

/** `from..to` oralig'idagi eng KATTA son, unda maydon kamida `minWords` so'z ko'taradi; yo'q bo'lsa `from`. */
function maxCount(field: FitField, rules: BodyRules, visual: SlideVisual | undefined, from: number, to: number, minWords: number, rows?: number): number {
  for (let n = to; n > from; n -= 1) if (fitWords(field, rules, visual, n, rows) >= minWords) return n;
  return from;
}

/**
 * Oraliq: yuqori = auditoriya istagi (`want`), lekin quti sig'imidan
 * (`cap`) oshmaydi; quyi = `floor` (detektor chegarasi) va yuqorining
 * `share` qismidan kattasi. Quti juda tor bo'lsa (bolalar shrifti) —
 * oraliq quti ichida qoladi: sig'maydigan hajmni so'ramaymiz.
 */
function range(want: number, floor: number, cap: number, share: number): WordRange {
  const max = Math.min(cap, Math.max(floor, want));
  const min = Math.min(max, Math.max(floor, Math.round(max * share)));
  return { min, max };
}

/** «6–9» yoki bitta son («6») — «1–1» kabi ma'nosiz oraliq chiqmasin. */
export function fmtRange(r: WordRange): string {
  return r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
}

/**
 * Har maket uchun so'z oralig'i va element soni — `BodyRules`
 * (auditoriya × matn hajmi) va maket sig'imidan (auditoriya polida,
 * rasm tasmasi bilan). Prompt (`briefLines`), `thinSlides` va ta'mir
 * shu funksiyani o'qiydi.
 */
export function layoutWordTargets(rules: BodyRules, visual?: SlideVisual): LayoutWordTargets {
  // Bitta «to'liq band» so'z soni — auditoriya/hajm shu orqali hammasiga o'tadi.
  const unit = rules.bulletChars / 8;
  const bulletCap = fitWords("bullets", rules, visual);
  // Son: auditoriya ruxsati (`countRules`, P2 o'lchovi) — deka vizualining sig'imi bilan yana qisiladi.
  const maxSteps = maxCount("stepText", rules, visual, PROCESS_MIN_STEPS, Math.max(PROCESS_MIN_STEPS, rules.stepsMax), STEP_MIN_WORDS);
  const maxStats = maxCount("statLabel", rules, visual, 2, Math.max(2, rules.statsMax), STAT_LABEL_MIN_WORDS);
  const maxTableRows = rules.tableRows;
  const maxTableCols = maxCount("tableCell", rules, visual, 2, Math.max(2, rules.tableCols), tableCellMinWords(rules), maxTableRows);
  const maxColItems = maxCount("colItem", rules, visual, COL_MIN_ITEMS, SLIDE_LIMITS.colItems, COL_MIN_WORDS);
  const stepRange = (n: number) => range(Math.round(unit * 0.7), STEP_MIN_WORDS + 2, fitWords("stepText", rules, visual, n), 0.6);
  const stepTextBy: Record<number, WordRange> = {};
  for (let n = PROCESS_MIN_STEPS; n <= maxSteps; n += 1) stepTextBy[n] = stepRange(n);
  return {
    bullet: { min: Math.min(bulletMinWords(rules), bulletCap), max: Math.min(bulletMaxWords(rules), bulletCap) },
    maxColItems,
    colItem: range(Math.round(unit * 0.7), COL_MIN_WORDS + 1, fitWords("colItem", rules, visual, maxColItems), 0.6),
    colTitleMax: fitWords("colTitle", rules, visual),
    maxSteps,
    stepTextBy,
    stepText: stepTextBy[maxSteps],
    maxStats,
    statLabelMax: fitWords("statLabel", rules, visual, maxStats),
    maxTableCols,
    maxTableRows,
    tableCellMax: fitWords("tableCell", rules, visual, maxTableCols, maxTableRows),
    sectionSubtitle: range(Math.round(unit * 1.5), SECTION_SUBTITLE_MIN_WORDS + 6, fitWords("subtitleSection", rules, visual), 0.65),
    closingSubtitle: range(Math.round(unit * 0.8), 8, fitWords("subtitleClosing", rules, visual), 0.6),
    // Iqtibos — faqat PROMPT oralig'i; detektor iqtibosni «yupqa» demaydi (haqiqiy iqtibosni uzaytirib bo'lmaydi).
    quote: range(Math.round(unit * 1.3), QUOTE_MIN_WORDS + 4, fitWords("quote", rules, visual), 0.45),
    quoteByMax: fitWords("quoteBy", rules, visual),
    quizQMax: fitWords("quizQ", rules, visual),
    quizOptionMax: Math.max(2, fitWords("quizOption", rules, visual)),
  };
}

/**
 * Brif qatorlari — `slide-prompt/brief.ts` shu yerdan oladi (raqamlar
 * detektor bilan bitta manbadan). Ta'mir prompti ham aynan shu qatorlarni
 * beradi.
 */
export function wordTargetLines(rules: BodyRules, visual?: SlideVisual): string[] {
  const t = layoutWordTargets(rules, visual);
  const steps = t.maxSteps > PROCESS_MIN_STEPS ? `${PROCESS_MIN_STEPS}–${t.maxSteps}` : `AYNAN ${PROCESS_MIN_STEPS}`;
  const stepTexts = Object.entries(t.stepTextBy)
    .map(([n, r]) => `${n} bosqichda ${fmtRange(r)}`)
    .join(", ");
  const colItems = fmtRange({ min: Math.min(3, t.maxColItems), max: t.maxColItems });
  return [
    `MAKET HAJMI (so‘z; qutiga sig‘adigan oraliq — kam yozilsa slayd bo‘sh ko‘rinadi, ko‘p yozilsa kesiladi):`,
    `— twoCol/compare: har ustunda ${colItems} band, har band ${fmtRange(t.colItem)} so‘z; ustun sarlavhasi (leftTitle/rightTitle) ≤ ${t.colTitleMax} so‘z;`,
    `— process: ${steps} bosqich; har bosqich text: ${stepTexts} so‘z;`,
    `— stats: ${t.maxStats} tagacha karta, har label ≤ ${t.statLabelMax} so‘z;`,
    /*
     * Qator soni POLI 3 (AUDIT-8): faqat yuqori chegara («N tagacha»)
     * so'ralganda model 2 qatorli jadval qaytarar, jadval slaydning yuqori
     * uchdan birida qolardi (2 dan kami esa `normalizeSlide` da bandlarga
     * tushadi). `maxTableRows` har auditoriyada ≥ 4 — pol shift bilan zid emas.
     * Katak so'zi — P3 N2: kattalar uchun kamida 3 so'z (`tableCellMinWords`).
     */
    `— table: ${t.maxTableCols > 2 ? `2–${t.maxTableCols}` : "AYNAN 2"} ustun, ${t.maxTableRows > 3 ? `3–${t.maxTableRows}` : `AYNAN ${t.maxTableRows}`} qator, katak ${fmtRange({ min: Math.min(tableCellMinWords(rules), t.tableCellMax), max: t.tableCellMax })} so‘z;`,
    `— section: subtitle ${fmtRange(t.sectionSubtitle)} so‘z, bo‘sh qolmasin;`,
    `— closing: subtitle ${fmtRange(t.closingSubtitle)} so‘z;`,
    `— quote: ${fmtRange(t.quote)} so‘z (haqiqiy iqtibos bo‘lsa — aynan asl matn); quoteBy — faqat muallif (≤ ${t.quoteByMax} so‘z), tavsif emas;`,
    `— quiz: savol ≤ ${t.quizQMax} so‘z; har variant ≤ ${t.quizOptionMax} so‘z — qisqa, lekin tugallangan (kesilmasin).`,
  ];
}

// ───────────────────────────────────────────────────────── detektor

/**
 * `short-quote` YO'Q (AUDIT-25 P3 sharhi, 3-band): «Bilim — kuch.»
 * kabi haqiqiy qisqa iqtibosni «boyitish» — uydirma iqtibos; savol-
 * iqtibos («Orol nega qurib qoldi?») ham qisqa bo'lishi tabiiy.
 * `QUOTE_MIN_WORDS` faqat prompt poli.
 */
export type ThinReason = "few-bullets" | "short-bullets" | "short-steps" | "empty-subtitle" | "clipped-option" | "short-columns";

function words(s: string | undefined): number {
  return String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function avgWords(list: string[]): number {
  return list.length ? list.reduce((a, s) => a + words(s), 0) / list.length : 0;
}

/**
 * Qirqilgan matn: «…» bilan tugaydi VA qirqish qopqog'iga yaqin uzun.
 * `clipTo` natijasi doim ≥ ⌈0.6·(qopqoq−1)⌉ belgi (so'z chegarasi 60 %
 * dan keyin, aks holda qattiq kesish). Qisqa «1/2 + 1/4 = …» — bo'sh
 * joyli savol, qirqilgan emas.
 */
function clippedAt(s: string | undefined, cap: number): boolean {
  const t = String(s ?? "").trimEnd();
  return t.endsWith("…") && t.length >= Math.ceil(0.6 * (cap - 1));
}

/** Reja MAZMUN slaydi — P1 `plan` maydoni (1-asosli reja bandi). Blok slaydlari (maqsadlar, uy vazifasi) qisqa bo'lishi tabiiy. */
function isPlanSlide(s: SlideModel): boolean {
  return typeof (s as SlideModel & { plan?: unknown }).plan === "number";
}

const norm = (s: string | undefined) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Bitta slaydning yupqalik sabablari.
 *
 *   — bandlar/ustunlar/bosqichlar qoidasi FAQAT reja mazmun slaydlariga
 *     (`plan` raqam) — blok slaydlari (maqsadlar, uy vazifasi) qisqa
 *     bo'lishi tabiiy (P5 bilan bir qoida);
 *   — `empty-subtitle` va `clipped-option` — hamma slaydga;
 *   — `title`/`agenda`/`closing`/`answers`/`references`/`stats`/`table`/
 *     `quote` — hech qachon nomzod emas.
 *
 * Chegara quti sig'imidan katta bo'lmaydi: bolalar shriftida ustun
 * bandiga 4 so'z sig'sa, 5 so'z talab qilinmaydi (`Math.min`).
 */
export function thinReasons(s: SlideModel, rules: BodyRules, visual?: SlideVisual): ThinReason[] {
  const out: ThinReason[] = [];
  if (s.layout === "bullets") {
    if (!isPlanSlide(s)) return out;
    const list = (s.bullets ?? []).filter((b) => b.trim());
    if (list.length < rules.minBullets) out.push("few-bullets");
    // `bullet.min` = `bulletMinWords`, quti torroq bo'lsa undan ham past (sig'maydiganini talab qilmaymiz).
    if (!list.length || avgWords(list) < layoutWordTargets(rules, visual).bullet.min) out.push("short-bullets");
    return out;
  }
  if (s.layout === "process") {
    if (!isPlanSlide(s)) return out;
    const list = s.steps ?? [];
    /*
     * Chegara AUDITORIYA ruxsat bergan sondagi quti sig'imida
     * (`min(soni, stepsMax)`): ortiqcha bosqichli ro'yxat o'z chegarasini
     * o'zi pasaytira olmaydi (5 bosqich × 2 so'z «sig'adi» ≠ to'liq).
     */
    const n = Math.max(PROCESS_MIN_STEPS, Math.min(list.length, rules.stepsMax));
    const minWords = Math.min(STEP_MIN_WORDS, fitWords("stepText", rules, visual, n));
    // Ko'pchilik qoidasi: o'rtacha past YOKI birorta bosqich deyarli yorliq (≤ 3 so'z).
    const tiny = Math.min(4, minWords);
    if (list.length < PROCESS_MIN_STEPS || avgWords(list.map((st) => st.text)) < minWords || list.some((st) => words(st.text) < tiny)) {
      out.push("short-steps");
    }
    return out;
  }
  if (s.layout === "twoCol" || s.layout === "compare") {
    if (!isPlanSlide(s)) return out;
    const left = (s.left ?? []).filter((x) => x.trim());
    const right = (s.right ?? []).filter((x) => x.trim());
    const n = Math.min(SLIDE_LIMITS.colItems, Math.max(left.length, right.length, COL_MIN_ITEMS));
    const minWords = Math.min(COL_MIN_WORDS, fitWords("colItem", rules, visual, n));
    if (left.length < COL_MIN_ITEMS || right.length < COL_MIN_ITEMS || avgWords([...left, ...right]) < minWords) {
      out.push("short-columns");
    }
    return out;
  }
  if (s.layout === "section") {
    // Skelet subtitle ga faqat mavzu nomini yozadi; sarlavhani takrorlagan subtitle ham bo'sh.
    if (words(s.subtitle) < SECTION_SUBTITLE_MIN_WORDS || norm(s.subtitle) === norm(s.title)) out.push("empty-subtitle");
    return out;
  }
  if (s.layout === "quiz") {
    const cap = clipLimit("quizOption", rules, visual);
    const bad = (s.quiz ?? []).some((q) => clippedAt(q.q, SLIDE_LIMITS.quizQ) || q.options.some((o) => clippedAt(o, cap) || o.length > cap));
    if (bad) out.push("clipped-option");
  }
  return out;
}

/**
 * Yupqa slaydlar ro'yxati (deka tartibida). `visual` — deka vizuali;
 * berilmasa sig'im barcha vizuallarning eng torisidan olinadi.
 */
export function thinSlides(slides: SlideModel[], rules: BodyRules, visual?: SlideVisual): { index: number; reasons: ThinReason[] }[] {
  const out: { index: number; reasons: ThinReason[] }[] = [];
  slides.forEach((s, index) => {
    const reasons = thinReasons(s, rules, visual);
    if (reasons.length) out.push({ index, reasons });
  });
  return out;
}

// ───────────────────────────────────────────────────────── ta'mir

/** Ta'mirga shundan kam vaqt qolsa — chaqirilmaydi (ta'mir yaxshilash, majburiyat emas). */
export const REPAIR_MIN_MS = 12_000;
/** Bitta ta'mir chaqiruvining eng uzun kutishi. */
export const REPAIR_TIMEOUT_MS = 45_000;
/** Bitta chaqiruvda eng ko'p shuncha slayd — javob token chegarasiga urilmasin. */
export const REPAIR_MAX_SLIDES = 8;
/** Ta'mirlangan variant/savol asli bilan shu ulushdagi BOSHI bo'yicha mos bo'lishi shart. */
export const REPAIR_PREFIX_SHARE = 0.6;

function list(v: unknown, n: number, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clipTo(String(x ?? ""), max))
    .filter(Boolean)
    .slice(0, n);
}

/**
 * Yangi matn asl matnning DAVOMI yoki QISQARTMASImi — kalit o'zgarmasin.
 * Asl «…» siz; ikkalasining qisqasining `REPAIR_PREFIX_SHARE` qismi
 * (katta-kichik harfsiz) bir xil bo'lishi shart. Kesilgan variantni
 * to'ldirish ham, sig'maydiganini qisqartirish ham o'tadi; boshqa
 * variantning matnini shu o'ringa qo'yish (javob kalitini buzish) — yo'q.
 *
 * Qisqartirish ham TO'LIQ bo'lsin: yangi matn kamida min(asl uzunligi,
 * ⌈0.5 · qopqoq⌉) belgi (qayta sharh N1 — 178 belgilik variant «Am» ga
 * qisqartirilsa ham 2 belgili umumiy bosh bilan o'tib ketardi).
 */
function samePrefix(orig: string, next: string, cap: number): boolean {
  const a = norm(orig.replace(/…\s*$/u, ""));
  const b = norm(next.replace(/…\s*$/u, ""));
  if (b.length < Math.min(a.length, Math.ceil(0.5 * cap))) return false;
  const k = Math.ceil(REPAIR_PREFIX_SHARE * Math.min(a.length, b.length));
  return k > 0 && a.slice(0, k) === b.slice(0, k);
}

/**
 * Model javobini ASL slayd ustiga qo'yadi — faqat shu maketning MATN
 * maydonlari. `id`, `layout`, `title`, `plan`, rasm, izoh va boshqa
 * hamma narsa asl slayddan (spread) qoladi. Yaroqsiz javob — `null`.
 * Qirqish `clipLimit` bilan — ta'mirlangan matn ham qutiga sig'adi.
 */
function mergeRepair(orig: SlideModel, raw: Record<string, unknown>, rules: BodyRules, visual?: SlideVisual): SlideModel | null {
  switch (orig.layout) {
    case "bullets": {
      const bullets = list(raw.bullets, rules.maxBullets, clipLimit("bullets", rules, visual));
      return bullets.length ? { ...orig, bullets } : null;
    }
    case "process": {
      if (!Array.isArray(raw.steps)) return null;
      /*
       * Son AVVAL qisiladi — auditoriya ruxsati va vizual sig'imi
       * (`maxSteps`): 1–4 sinfga 5 bosqich qaytarilsa ham 3 tasi olinadi,
       * matn esa AYNAN shu sondagi quti bilan qirqiladi. 3 dan kam — rad.
       */
      const n = Math.min(raw.steps.length, rules.stepsMax, layoutWordTargets(rules, visual).maxSteps);
      if (n < PROCESS_MIN_STEPS) return null;
      const textMax = clipLimit("stepText", rules, visual, n);
      const titleMax = clipLimit("stepTitle", rules, visual, n);
      const steps: SlideStep[] = [];
      for (const [i, x] of raw.steps.slice(0, n).entries()) {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const title = clipTo(String(o.title ?? orig.steps?.[i]?.title ?? ""), titleMax);
        const text = clipTo(String(o.text ?? ""), textMax);
        if (!title || !text) return null;
        steps.push({ n: clipTo(String(orig.steps?.[i]?.n ?? o.n ?? i + 1), SLIDE_LIMITS.stepN), title, text });
      }
      return { ...orig, steps };
    }
    case "twoCol":
    case "compare": {
      const n = Math.min(SLIDE_LIMITS.colItems, Math.max(Array.isArray(raw.left) ? raw.left.length : 0, Array.isArray(raw.right) ? raw.right.length : 0));
      const itemMax = clipLimit("colItem", rules, visual, n);
      const left = list(raw.left, SLIDE_LIMITS.colItems, itemMax);
      const right = list(raw.right, SLIDE_LIMITS.colItems, itemMax);
      if (!left.length || !right.length) return null;
      return {
        ...orig,
        leftTitle: orig.leftTitle || clipTo(String(raw.leftTitle ?? ""), SLIDE_LIMITS.colTitle),
        left,
        rightTitle: orig.rightTitle || clipTo(String(raw.rightTitle ?? ""), SLIDE_LIMITS.colTitle),
        right,
      };
    }
    case "section": {
      const subtitle = clipTo(String(raw.subtitle ?? ""), clipLimit("subtitleSection", rules, visual));
      return subtitle ? { ...orig, subtitle } : null;
    }
    case "quiz": {
      /*
       * Test — eng xavfli ta'mir: javob kaliti buzilmasin.
       *   — savollar soni bir xil, har savolda AYNAN 4 variant;
       *   — `answer` asl indeks bilan bir xil (boshqasi — rad);
       *   — FAQAT belgilangan (kesilgan yoki qutiga sig'maydigan)
       *     variant o'zgaradi, qolgani asl matn BAYTMA-BAYT;
       *   — o'zgargan variant/savol asl matnning boshi bilan mos
       *     (`samePrefix`) — boshqa variant matnini shu o'ringa qo'yib
       *     javobni «ko'chirish» rad etiladi.
       */
      const cap = clipLimit("quizOption", rules, visual);
      const orig_ = orig.quiz ?? [];
      if (!Array.isArray(raw.quiz) || raw.quiz.length !== orig_.length) return null;
      const quiz: NonNullable<SlideModel["quiz"]> = [];
      for (let j = 0; j < orig_.length; j += 1) {
        const x = raw.quiz[j];
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        if (o.answer !== undefined && Number(o.answer) !== orig_[j].answer) return null;
        if (!Array.isArray(o.options) || o.options.length !== SLIDE_LIMITS.quizOptions) return null;
        const options: string[] = [];
        for (let k = 0; k < SLIDE_LIMITS.quizOptions; k += 1) {
          const was = orig_[j].options[k] ?? "";
          if (!clippedAt(was, cap) && was.length <= cap) {
            options.push(was);
            continue;
          }
          const next = clipTo(String(o.options[k] ?? ""), cap);
          if (!next || !samePrefix(was, next, cap)) return null;
          options.push(next);
        }
        let q = orig_[j].q;
        if (clippedAt(q, SLIDE_LIMITS.quizQ) && o.q) {
          const next = clipTo(String(o.q), SLIDE_LIMITS.quizQ);
          if (!samePrefix(q, next, SLIDE_LIMITS.quizQ)) return null;
          q = next;
        }
        quiz.push({ q, options, answer: orig_[j].answer });
      }
      return { ...orig, quiz };
    }
    default:
      return null;
  }
}

const REASON_TEXT: Record<ThinReason, (t: LayoutWordTargets, r: BodyRules) => string> = {
  "few-bullets": (_t, r) => `band kam — ${r.minBullets}–${r.maxBullets} ta band yozing`,
  "short-bullets": (t) => `bandlar juda qisqa — har biri ${fmtRange(t.bullet)} so‘zli TO‘LIQ gap (ta’rif, sabab, misol, oqibat)`,
  "short-steps": (t) =>
    `bosqich matni qisqa — ${t.maxSteps > PROCESS_MIN_STEPS ? `${PROCESS_MIN_STEPS}–${t.maxSteps}` : PROCESS_MIN_STEPS} bosqich; text: ${Object.entries(t.stepTextBy)
      .map(([n, r]) => `${n} bosqichda ${fmtRange(r)}`)
      .join(", ")} so‘z — nima qilinadi va natija nima`,
  "empty-subtitle": (t) => `subtitle bo‘sh — ${fmtRange(t.sectionSubtitle)} so‘zlik kirish: bu bo‘limda nima ko‘riladi`,
  "clipped-option": (t) =>
    `variant kesilgan yoki qutiga sig‘maydi — faqat shu variantni ≤ ${t.quizOptionMax} so‘z qilib, ASL MATNNING BOSHINI saqlab to‘ldiring/qisqartiring; qolgan variantlar, tartib va answer o‘zgarmasin`,
  "short-columns": (t) => `ustunlar yupqa — har ustunda ${fmtRange({ min: Math.min(3, t.maxColItems), max: t.maxColItems })} band, har band ${fmtRange(t.colItem)} so‘z`,
};

/** Maket bo'yicha model qaytaradigan maydonlar (javob sxemasi uchun). */
const FIELDS: Partial<Record<SlideModel["layout"], string>> = {
  bullets: `"bullets":[""]`,
  process: `"steps":[{"n":"1","title":"","text":""}]`,
  twoCol: `"left":[""],"right":[""]`,
  compare: `"left":[""],"right":[""]`,
  section: `"subtitle":""`,
  quiz: `"quiz":[{"q":"","options":["","","",""],"answer":0}]`,
};

/** Modelga ko'rsatiladigan joriy mazmun — faqat matn maydonlari. */
function current(s: SlideModel): Record<string, unknown> {
  const pick: Record<string, unknown> = { layout: s.layout, title: s.title };
  for (const k of ["subtitle", "bullets", "leftTitle", "left", "rightTitle", "right", "steps", "quiz"] as const) {
    if (s[k] !== undefined) pick[k] = s[k];
  }
  return pick;
}

/**
 * Yupqa slaydlarni BITTA LLM chaqiruvi bilan to'ldiradi.
 *
 * Shartnoma (AUDIT-25, P1 `writeSlidesWithLlm` oxirida, `finalizeQuiz`
 * dan OLDIN, OLTI argument bilan chaqiradi):
 *   — YANGI massiv qaytaradi, kirishni o'zgartirmaydi;
 *   — hech qachon otmaydi: LLM yo'q/yiqildi/vaqt yetmadi → kirish nusxasi;
 *   — faqat yupqa slaydlar so'raladi (ko'pi bilan `REPAIR_MAX_SLIDES`);
 *   — javob faqat slayd ENDI yupqa bo'lmasa qabul qilinadi; `id`,
 *     `layout`, `title`, `plan`, rasm maydonlari asl slayddan qoladi.
 */
export async function repairThinSlides(
  slides: SlideModel[],
  meta: DocMeta,
  tpl: SlideTemplate,
  ctx: SlidePromptCtx,
  deadline?: number,
  jobDeadline?: number,
): Promise<SlideModel[]> {
  const out = slides.slice();
  try {
    if (!llmEnabled()) return out;
    const rules = bodyRules(meta, tpl.id);
    const visual = tpl.visual;
    const thin = thinSlides(out, rules, visual).slice(0, REPAIR_MAX_SLIDES);
    if (!thin.length) return out;
    const left = remainingMs(deadline);
    if (left < REPAIR_MIN_MS) return out;
    if (jobDeadline !== undefined && jobDeadline - Date.now() < REPAIR_MIN_MS) return out;

    const t = layoutWordTargets(rules, visual);
    const system = [
      languageDirective(meta.language),
      `Siz taqdimot muharririsiz: tayyor slaydlardagi YUPQA matnni boyitasiz.`,
      `Mavzu: «${meta.topic}». Fan: ${meta.subject || "—"}.`,
      rules.note,
      `Har bullet — TO‘LIQ gap, ${fmtRange(t.bullet)} so‘z.`,
      ...wordTargetLines(rules, visual),
      `QOIDALAR: layout va title O‘ZGARMAYDI; faqat ko‘rsatilgan maydonlarni to‘liq qayta yozing. Mavjud fikrni chuqurlashtiring — ta’rif, sabab, misol, oqibat. Uydirma raqam, sana, manba, iqtibos YO‘Q. Boshqa slaydlarni takrorlamang.`,
      `Faqat JSON: {"slides":[{"index":0, ...maydonlar}]} — index so‘rovdagidek.`,
      ...researchLines(meta, tpl, ctx),
    ]
      .filter(Boolean)
      .join("\n");
    const user = [
      // Takrorlamaslik uchun deka tarkibi — bir qator.
      `Dekadagi slaydlar: ${out.map((s, i) => `${i}) ${s.title}`).join("; ")}.`,
      `Quyidagi ${thin.length} ta slayd yupqa. Har biri uchun ko‘rsatilgan maydonlarni qaytaring.`,
      ...thin.map(({ index, reasons }) => {
        const s = out[index];
        return [
          `index=${index} layout=${s.layout}`,
          `kamchilik: ${reasons.map((r) => REASON_TEXT[r](t, rules)).join("; ")}`,
          `qaytaring: {"index":${index},${FIELDS[s.layout] ?? ""}}`,
          `hozirgi: ${JSON.stringify(current(s))}`,
        ].join("\n");
      }),
    ].join("\n\n");
    const maxTokens = Math.min(6_000, 600 + 450 * thin.length);
    const raw = await llmComplete(system, user, maxTokens, {
      json: true,
      timeoutMs: Math.min(REPAIR_TIMEOUT_MS, left),
      deadline: jobDeadline,
    });
    const data = parseLlmJson(raw) as { slides?: unknown } | null;
    if (!Array.isArray(data?.slides)) return out;
    const wanted = new Set(thin.map((x) => x.index));
    let accepted = 0;
    for (const item of data.slides) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const index = Number(o.index);
      if (!Number.isInteger(index) || !wanted.has(index)) continue;
      wanted.delete(index);
      const merged = mergeRepair(out[index], o, rules, visual);
      // Faqat YAXSHILANGAN javob: slayd endi yupqa emas.
      if (merged && !thinReasons(merged, rules, visual).length) {
        out[index] = merged;
        accepted += 1;
      }
    }
    if (accepted < thin.length) console.warn("[slide-quality] ta’mir qabul qilindi", accepted, "/", thin.length);
    return out;
  } catch (e) {
    /*
     * Ta'mir — IXTIYORIY bosqich (`deadline.ts` qoidasi: ixtiyoriy bosqich
     * `DeadlineError` ni ham o'zining «o'tkazib yuborish» yo'liga
     * tushiradi). Tayyor deka yiqilmaydi va bu chaqiruv ish muddatini
     * cho'zmaydi: timeout — min(45 s, BOSQICH qoldig'i), bosqich muddati
     * esa rasm/yig'ish ulushidan OLDIN tugaydi, zanjir `jobDeadline` bilan
     * chegaralangan.
     */
    if (isDeadlineError(e)) console.warn("[slide-quality] ta’mir: ish muddati — o‘tkazib yuborildi");
    else console.warn("[slide-quality] ta’mir o‘tkazib yuborildi:", e instanceof Error ? e.message : e);
    return slides.slice();
  }
}
