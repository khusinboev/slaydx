import { languageDirective } from "./i18n";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { remainingMs } from "./quality";
import { bodyRules, type BodyRules } from "./slide-audience";
import { LAYOUT_KIT, planSlide, type SlideLayer } from "./slide-layout";
import { SLIDE_LIMITS, clipTo } from "./slide-limits";
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
 * Bandlar: o'rtacha so'z soni `THIN_BULLET_K × bulletChars/8` dan kam
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
/** Iqtibos shundan kam so'z — shior, iqtibos emas. */
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
  return Math.round((rules.bulletChars * THIN_BULLET_K) / 8);
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

export type FitField =
  | "title"
  | "bullets"
  | "colItem"
  | "stepText4"
  | "stepText5"
  | "statLabel"
  | "subtitleSection"
  | "subtitleClosing"
  | "quote"
  | "quoteBy"
  | "quizQ"
  | "quizOption"
  | "colTitle";

const ALL_VISUALS: SlideVisual[] = [...LEGACY_VISUALS, ...DESIGN_VISUALS];
const PROBE_THEME = getSlideTheme("atlas");
/** Tasma rasmi — `twoCol`/`process`/`stats` da kontent zonasini toraytiradi (A1-01). */
const PROBE_IMAGE = { url: "data:image/png;base64,AAAA" };
/** Real o'zbekcha so'zlar — sig'im «ooo…» bilan emas, so'z bo'yicha qatorlashda o'lchanadi. */
const PROBE_WORDS =
  "Orol dengizining qurishi mintaqadagi iqlim sharoitini keskin o‘zgartirdi va aholining sog‘lig‘iga jiddiy ta’sir ko‘rsatdi shuning uchun suv resurslarini tejash hamda qishloq xo‘jaligida zamonaviy sug‘orish usullarini joriy etish muhim vazifa hisoblanadi".split(
    " ",
  );

function probeText(words: number): string {
  return Array.from({ length: words }, (_, i) => PROBE_WORDS[i % PROBE_WORDS.length]).join(" ");
}

type Probe = { slide: (t: string, rules: BodyRules) => SlideModel; match: (src: SlideSrc | undefined) => boolean };

const stepsOf = (n: number, text: string): SlideStep[] =>
  Array.from({ length: n }, (_, i) => ({ n: String(i + 1), title: "Bosqich nomi", text }));
const isSteps = (s: SlideSrc | undefined) => s?.f === "steps" && s.k === "text";

/** Sinov slaydi va shu maydon qatlamini taniydigan predikat. */
const PROBES: Record<FitField, Probe> = {
  bullets: {
    slide: (t, r) => ({ id: "fit", layout: "bullets", title: "Sarlavha", bullets: Array.from({ length: r.maxBullets }, () => t) }),
    match: (s) => s?.f === "bullets",
  },
  colItem: {
    slide: (t) => ({ id: "fit", layout: "twoCol", title: "Ikki tomon", leftTitle: "Chap", rightTitle: "O‘ng", left: [t, t, t, t], right: [t, t, t, t] }),
    match: (s) => s?.f === "left" || s?.f === "right",
  },
  stepText4: { slide: (t) => ({ id: "fit", layout: "process", title: "Jarayon", steps: stepsOf(4, t) }), match: isSteps },
  stepText5: { slide: (t) => ({ id: "fit", layout: "process", title: "Jarayon", steps: stepsOf(5, t) }), match: isSteps },
  statLabel: {
    slide: (t) => ({ id: "fit", layout: "stats", title: "Ko‘rsatkichlar", stats: [2, 3, 4, 5].map((k) => ({ value: `${k}0 %`, label: t })) }),
    match: (s) => s?.f === "stats" && s.k === "label",
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
  title: {
    // Eng tor sarlavha — rasmli `section` (classic): sarlavha qutisi rasm yonida.
    slide: (t) => ({ id: "fit", layout: "section", title: t, subtitle: probeText(10) }),
    match: (s) => s?.f === "title",
  },
  colTitle: {
    slide: (t) => ({ id: "fit", layout: "twoCol", title: "Ikki tomon", leftTitle: t, rightTitle: t, left: ["Band matni."], right: ["Band matni."] }),
    match: (s) => s?.f === "leftTitle" || s?.f === "rightTitle",
  },
  quizOption: {
    slide: (t) => ({ id: "fit", layout: "quiz", title: "Nazorat savoli", quiz: [{ q: probeText(12), options: [t, t, t, t], answer: 0 }] }),
    match: (s) => s?.f === "quiz" && "k" in s && s.k === "option",
  },
};

type TextLayer = Extract<SlideLayer, { t: "text" }>;

/**
 * Qatlam o'z shriftida qutiga sig'adimi — `fitSize`/`fitLines` bilan
 * AYNAN bir formula (`LAYOUT_KIT.listRows`, qator = 1.3 × pt). 1 pt
 * bardosh: formula taxminiy, 0.2 pt «oshish» ko'zga ko'rinmaydi.
 */
function layerFits(l: TextLayer): boolean {
  const room = l.box.h * 72 + 1;
  if (l.lines) {
    const rows = LAYOUT_KIT.listRows(l.lines, l.box, l.size);
    // Oxirgi banddan keyingi oraliq ko'rinmaydi (matn tepadan boshlanadi) — n−1 ta oraliq.
    return rows * l.size * 1.3 + Math.max(0, l.lines.length - 1) * (l.paraSpace ?? 0) <= room;
  }
  // `listRows` band chekinishini (0.28") ayiradi — oddiy matn qutisi uchun qaytarib qo'shamiz.
  const rows = LAYOUT_KIT.listRows([l.text ?? ""], { ...l.box, w: l.box.w + 0.28 }, l.size);
  return rows * l.size * 1.3 <= room;
}

function fitsAt(field: FitField, words: number, rules: BodyRules, visual: SlideVisual, image: boolean): boolean {
  const p = PROBES[field];
  const slide = p.slide(probeText(words), rules);
  const plan = planSlide(image ? { ...slide, image: PROBE_IMAGE } : slide, PROBE_THEME, visual, 3, 10, "auto", "lecture", {
    bodyType: rules,
  });
  const ls = plan.layers.filter(
    (l): l is TextLayer => l.t === "text" && (p.match(l.src) || (l.srcLines ?? []).some((s) => p.match(s))),
  );
  // Bu vizualda maydon chizilmaydi — cheklov yo'q.
  if (!ls.length) return true;
  return ls.every(layerFits);
}

/** 40 so'z ≈ 340 belgi — eng uzun qopqoqdan (quote 280) ham katta. */
const MAX_PROBE_WORDS = 40;
const fitCache = new Map<string, number>();

/**
 * Maydon maketda auditoriya shrift polida necha BELGI ko'taradi —
 * `planSlide` ning o'zidan o'lchanadi (yagona manba: P2 qutini
 * kattalashtirsa, prompt va detektor ham avtomatik kengayadi). Rasmli
 * VA rasmsiz holatning kichigi olinadi: rasm matn yozilgandan KEYIN
 * qo'shiladi (`attachSlideImages`), yozuv paytida uning bo'lishi
 * noma'lum. `visual` berilmasa — barcha 17 vizualning ENG TORI.
 */
export function fitChars(field: FitField, rules: BodyRules, visual?: SlideVisual): number {
  const key = `${field}|${visual ?? "*"}|${rules.bodyPt}|${rules.minPt}|${rules.maxBullets}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  let chars = Number.POSITIVE_INFINITY;
  for (const v of visual ? [visual] : ALL_VISUALS) {
    for (const image of [false, true]) {
      /*
       * CHIZIQLI qidiruv — BIRINCHI sig'masligigacha. Ikkilik qidiruv
       * noto'g'ri edi: ba'zi vizuallar matn uzunligiga qarab boshqa
       * joylashuvga o'tadi (sig'im monoton emas) va u tasodifiy nuqtani
       * topardi (`dashboard` twoCol: 111 o'rniga 75).
       */
      let fit = 0;
      while (fit < MAX_PROBE_WORDS && fitsAt(field, fit + 1, rules, v, image)) fit += 1;
      chars = Math.min(chars, probeText(fit).length);
    }
  }
  fitCache.set(key, chars);
  return chars;
}

// ───────────────────────────────────────────────────────── so'z oraliqlari

export type WordRange = { min: number; max: number };

export type LayoutWordTargets = {
  bullet: WordRange;
  colItem: WordRange;
  /** Ustun sarlavhasi — faqat yuqori chegara (quti va `SLIDE_LIMITS.colTitle`). */
  colTitleMax: number;
  /** 4 bosqichgacha. */
  stepText: WordRange;
  /** 5 bosqichli qatorda (kartalar tor) — faqat yuqori chegara. */
  stepText5Max: number;
  statLabelMax: number;
  sectionSubtitle: WordRange;
  closingSubtitle: WordRange;
  quote: WordRange;
  quoteByMax: number;
  quizQMax: number;
  quizOptionMax: number;
};

/** Belgi sig'imi → so'z, `SLIDE_LIMITS` qirqish chegarasidan oshmasdan. */
function capWords(chars: number, limit: number): number {
  return Math.max(1, Math.floor(Math.min(chars, limit) / CHARS_PER_WORD));
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

/**
 * Har maket uchun so'z oralig'i — `BodyRules` (auditoriya × matn
 * hajmi) va maket sig'imidan. Prompt (`briefLines`) va `thinSlides`
 * shu funksiyani o'qiydi.
 */
export function layoutWordTargets(rules: BodyRules, visual?: SlideVisual): LayoutWordTargets {
  // Bitta «to'liq band» so'z soni — auditoriya/hajm shu orqali hammasiga o'tadi.
  const unit = rules.bulletChars / 8;
  const bulletCap = capWords(fitChars("bullets", rules, visual), rules.bulletChars);
  return {
    bullet: { min: Math.min(bulletMinWords(rules), bulletCap), max: Math.min(bulletMaxWords(rules), bulletCap) },
    colItem: range(Math.round(unit * 0.7), COL_MIN_WORDS + 1, capWords(fitChars("colItem", rules, visual), SLIDE_LIMITS.colItem), 0.6),
    colTitleMax: capWords(fitChars("colTitle", rules, visual), SLIDE_LIMITS.colTitle),
    stepText: range(Math.round(unit * 0.7), STEP_MIN_WORDS + 2, capWords(fitChars("stepText4", rules, visual), SLIDE_LIMITS.stepText), 0.6),
    stepText5Max: capWords(fitChars("stepText5", rules, visual), SLIDE_LIMITS.stepText),
    statLabelMax: capWords(fitChars("statLabel", rules, visual), SLIDE_LIMITS.statLabel),
    sectionSubtitle: range(
      Math.round(unit * 1.5),
      SECTION_SUBTITLE_MIN_WORDS + 6,
      capWords(fitChars("subtitleSection", rules, visual), SLIDE_LIMITS.subtitleSection),
      0.65,
    ),
    closingSubtitle: range(Math.round(unit * 0.8), 8, capWords(fitChars("subtitleClosing", rules, visual), SLIDE_LIMITS.subtitleClosing), 0.6),
    quote: range(Math.round(unit * 1.3), QUOTE_MIN_WORDS + 4, capWords(fitChars("quote", rules, visual), SLIDE_LIMITS.quote), 0.45),
    quoteByMax: capWords(fitChars("quoteBy", rules, visual), SLIDE_LIMITS.quoteBy),
    quizQMax: capWords(fitChars("quizQ", rules, visual), SLIDE_LIMITS.quizQ),
    quizOptionMax: Math.max(2, capWords(fitChars("quizOption", rules, visual), SLIDE_LIMITS.quizOption)),
  };
}

/**
 * Brif qatorlari — `slide-prompt/brief.ts` shu yerdan oladi (raqamlar
 * detektor bilan bitta manbadan). Ta'mir prompti ham aynan shu qatorlarni
 * beradi.
 */
export function wordTargetLines(rules: BodyRules, visual?: SlideVisual): string[] {
  const t = layoutWordTargets(rules, visual);
  return [
    `MAKET HAJMI (so‘z; qutiga sig‘adigan oraliq — kam yozsang slayd bo‘sh ko‘rinadi, ko‘p yozsang kesiladi):`,
    `— twoCol/compare: har ustunda 3–4 band, har band ${t.colItem.min}–${t.colItem.max} so‘z; ustun sarlavhasi (leftTitle/rightTitle) ≤ ${t.colTitleMax} so‘z;`,
    `— process: 3–4 bosqich, har bosqich text ${t.stepText.min}–${t.stepText.max} so‘z (5 bosqich bo‘lsa ≤ ${t.stepText5Max} so‘z);`,
    `— stats: har label ≤ ${t.statLabelMax} so‘z;`,
    `— section: subtitle ${t.sectionSubtitle.min}–${t.sectionSubtitle.max} so‘z, bo‘sh qolmasin;`,
    `— closing: subtitle ${t.closingSubtitle.min}–${t.closingSubtitle.max} so‘z;`,
    `— quote: ${t.quote.min}–${t.quote.max} so‘z; quoteBy — faqat muallif (≤ ${t.quoteByMax} so‘z), tavsif emas;`,
    `— quiz: savol ≤ ${t.quizQMax} so‘z; har variant ≤ ${t.quizOptionMax} so‘z — qisqa, lekin tugallangan (kesilmasin).`,
  ];
}

// ───────────────────────────────────────────────────────── detektor

export type ThinReason =
  | "few-bullets"
  | "short-bullets"
  | "short-steps"
  | "empty-subtitle"
  | "clipped-option"
  | "short-columns"
  | "short-quote";

function words(s: string | undefined): number {
  return String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function avgWords(list: string[]): number {
  return list.length ? list.reduce((a, s) => a + words(s), 0) / list.length : 0;
}

const clipped = (s: string | undefined) => String(s ?? "").trimEnd().endsWith("…");

/**
 * Bitta slaydning yupqalik sabablari. `title`/`agenda`/`closing`/
 * `answers`/`references`/`stats`/`table` — hech qachon nomzod emas;
 * `quiz` faqat kesilgan (yoki qutiga sig'maydigan) variant bo'yicha.
 *
 * Chegara quti sig'imidan katta bo'lmaydi: bolalar shriftida ustun
 * bandiga 4 so'z sig'sa, 5 so'z talab qilinmaydi (`Math.min`).
 */
export function thinReasons(s: SlideModel, rules: BodyRules, visual?: SlideVisual): ThinReason[] {
  const out: ThinReason[] = [];
  if (s.layout === "bullets") {
    const list = (s.bullets ?? []).filter((b) => b.trim());
    if (list.length < rules.minBullets) out.push("few-bullets");
    // `bullet.min` = `bulletMinWords`, quti torroq bo'lsa undan ham past (sig'maydiganini talab qilmaymiz).
    if (!list.length || avgWords(list) < layoutWordTargets(rules, visual).bullet.min) out.push("short-bullets");
    return out;
  }
  if (s.layout === "process") {
    const t = layoutWordTargets(rules, visual);
    const list = s.steps ?? [];
    const minWords = Math.min(STEP_MIN_WORDS, list.length >= 5 ? t.stepText5Max : t.stepText.max);
    if (list.length < PROCESS_MIN_STEPS || list.some((st) => words(st.text) < minWords)) out.push("short-steps");
    return out;
  }
  if (s.layout === "twoCol" || s.layout === "compare") {
    const minWords = Math.min(COL_MIN_WORDS, layoutWordTargets(rules, visual).colItem.max);
    const left = (s.left ?? []).filter((x) => x.trim());
    const right = (s.right ?? []).filter((x) => x.trim());
    if (left.length < COL_MIN_ITEMS || right.length < COL_MIN_ITEMS || avgWords([...left, ...right]) < minWords) {
      out.push("short-columns");
    }
    return out;
  }
  if (s.layout === "section") {
    if (words(s.subtitle) < SECTION_SUBTITLE_MIN_WORDS) out.push("empty-subtitle");
    return out;
  }
  if (s.layout === "quote") {
    if (words(s.quote) < QUOTE_MIN_WORDS) out.push("short-quote");
    return out;
  }
  if (s.layout === "quiz") {
    const fit = Math.min(fitChars("quizOption", rules, visual), SLIDE_LIMITS.quizOption);
    const bad = (s.quiz ?? []).some((q) => clipped(q.q) || q.options.some((o) => clipped(o) || o.length > fit));
    if (bad) out.push("clipped-option");
  }
  return out;
}

/**
 * Yupqa slaydlar ro'yxati (deka tartibida). `visual` — deka vizuali;
 * berilmasa sig'im barcha vizuallarning eng torisidan olinadi.
 */
export function thinSlides(
  slides: SlideModel[],
  rules: BodyRules,
  visual?: SlideVisual,
): { index: number; reasons: ThinReason[] }[] {
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

function list(v: unknown, n: number, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clipTo(String(x ?? ""), max))
    .filter(Boolean)
    .slice(0, n);
}

/**
 * Model javobini ASL slayd ustiga qo'yadi — faqat shu maketning MATN
 * maydonlari. `id`, `layout`, `title`, `plan`, rasm, izoh va boshqa
 * hamma narsa asl slayddan (spread) qoladi. Yaroqsiz javob — `null`.
 */
function mergeRepair(orig: SlideModel, raw: Record<string, unknown>, rules: BodyRules): SlideModel | null {
  switch (orig.layout) {
    case "bullets": {
      const bullets = list(raw.bullets, rules.maxBullets, rules.bulletChars);
      return bullets.length ? { ...orig, bullets } : null;
    }
    case "process": {
      if (!Array.isArray(raw.steps)) return null;
      const steps = raw.steps
        .map((x, i) => {
          if (!x || typeof x !== "object") return null;
          const o = x as Record<string, unknown>;
          const title = clipTo(String(o.title ?? orig.steps?.[i]?.title ?? ""), SLIDE_LIMITS.stepTitle);
          const text = clipTo(String(o.text ?? ""), SLIDE_LIMITS.stepText);
          if (!title || !text) return null;
          return { n: clipTo(String(orig.steps?.[i]?.n ?? o.n ?? i + 1), SLIDE_LIMITS.stepN), title, text };
        })
        .filter((x): x is SlideStep => Boolean(x))
        .slice(0, SLIDE_LIMITS.stepsMax);
      return steps.length ? { ...orig, steps } : null;
    }
    case "twoCol":
    case "compare": {
      const left = list(raw.left, SLIDE_LIMITS.colItems, SLIDE_LIMITS.colItem);
      const right = list(raw.right, SLIDE_LIMITS.colItems, SLIDE_LIMITS.colItem);
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
      const subtitle = clipTo(String(raw.subtitle ?? ""), SLIDE_LIMITS.subtitleSection);
      return subtitle ? { ...orig, subtitle } : null;
    }
    case "quote": {
      const quote = clipTo(String(raw.quote ?? ""), SLIDE_LIMITS.quote);
      return quote ? { ...orig, quote } : null;
    }
    case "quiz": {
      /*
       * Test — eng xavfli ta'mir: variant tartibi o'zgarsa javob YOLG'ON
       * bo'ladi. Shuning uchun: savollar soni bir xil, har savolda AYNAN
       * 4 variant, `answer` asl indeks bilan bir xil (model boshqasini
       * yozsa — rad). Savol matni faqat asli kesilgan bo'lsa almashadi.
       */
      const orig_ = orig.quiz ?? [];
      if (!Array.isArray(raw.quiz) || raw.quiz.length !== orig_.length) return null;
      const quiz: NonNullable<SlideModel["quiz"]> = [];
      for (let j = 0; j < orig_.length; j += 1) {
        const x = raw.quiz[j];
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const options = list(o.options, SLIDE_LIMITS.quizOptions, SLIDE_LIMITS.quizOption);
        if (options.length !== SLIDE_LIMITS.quizOptions) return null;
        if (o.answer !== undefined && Number(o.answer) !== orig_[j].answer) return null;
        const q = clipped(orig_[j].q) && o.q ? clipTo(String(o.q), SLIDE_LIMITS.quizQ) : orig_[j].q;
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
  "short-bullets": (t) => `bandlar juda qisqa — har biri ${t.bullet.min}–${t.bullet.max} so‘zli TO‘LIQ gap (ta’rif, sabab, misol, oqibat)`,
  "short-steps": (t) => `bosqich matni qisqa — 3–4 bosqich, har text ${t.stepText.min}–${t.stepText.max} so‘z: nima qilinadi va natija nima`,
  "empty-subtitle": (t) => `subtitle bo‘sh — ${t.sectionSubtitle.min}–${t.sectionSubtitle.max} so‘zlik kirish: bu bo‘limda nima ko‘riladi`,
  "clipped-option": (t) => `variant kesilgan yoki qutiga sig‘maydi — har variant ≤ ${t.quizOptionMax} so‘z; variantlar TARTIBI va answer o‘zgarmasin`,
  "short-columns": (t) => `ustunlar yupqa — har ustunda 3–4 band, har band ${t.colItem.min}–${t.colItem.max} so‘z`,
  "short-quote": (t) => `iqtibos qisqa — ${t.quote.min}–${t.quote.max} so‘z`,
};

/** Maket bo'yicha model qaytaradigan maydonlar (javob sxemasi uchun). */
const FIELDS: Partial<Record<SlideModel["layout"], string>> = {
  bullets: `"bullets":[""]`,
  process: `"steps":[{"n":"1","title":"","text":""}]`,
  twoCol: `"left":[""],"right":[""]`,
  compare: `"left":[""],"right":[""]`,
  section: `"subtitle":""`,
  quote: `"quote":""`,
  quiz: `"quiz":[{"q":"","options":["","","",""],"answer":0}]`,
};

/** Modelga ko'rsatiladigan joriy mazmun — faqat matn maydonlari. */
function current(s: SlideModel): Record<string, unknown> {
  const pick: Record<string, unknown> = { layout: s.layout, title: s.title };
  for (const k of ["subtitle", "bullets", "leftTitle", "left", "rightTitle", "right", "quote", "quoteBy", "steps", "quiz"] as const) {
    if (s[k] !== undefined) pick[k] = s[k];
  }
  return pick;
}

/**
 * Yupqa slaydlarni BITTA LLM chaqiruvi bilan to'ldiradi.
 *
 * Shartnoma (AUDIT-25, P1 `writeSlidesWithLlm` oxirida, `finalizeQuiz`
 * dan OLDIN chaqiradi):
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
      `Har bullet — TO‘LIQ gap, ${t.bullet.min}–${t.bullet.max} so‘z.`,
      ...wordTargetLines(rules, visual),
      `QOIDALAR: layout va title O‘ZGARMAYDI; faqat ko‘rsatilgan maydonlarni to‘liq qayta yozing. Mavjud fikrni chuqurlashtiring — ta’rif, sabab, misol, oqibat. Uydirma raqam, sana, manba YO‘Q. Boshqa slaydlarni takrorlamang.`,
      `Faqat JSON: {"slides":[{"index":0, ...maydonlar}]} — index so‘rovdagidek.`,
      ...researchLines(meta, tpl, ctx),
    ]
      .filter(Boolean)
      .join("\n");
    const user = [
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
      const merged = mergeRepair(out[index], o, rules);
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
     * Ta'mir — yaxshilash, majburiyat emas: tayyor deka yiqilmasin.
     * Ish muddati HAQIQATAN tugagan bo'lsa keyingi bosqich
     * (`assertJobTime`) uni o'zi to'xtatadi.
     */
    console.warn("[slide-quality] ta’mir o‘tkazib yuborildi:", e instanceof Error ? e.message : e);
    return slides.slice();
  }
}
