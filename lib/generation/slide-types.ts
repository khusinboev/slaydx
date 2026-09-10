import type { CustomTemplate } from "./pptx-template";
import type { BodyRules } from "./slide-audience";
import type { SlideFontId } from "./slide-fonts";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "./slide-templates";

export const SLIDE_LAYOUTS = [
  "title",
  "agenda",
  "section",
  "bullets",
  "twoCol",
  "compare",
  "quote",
  "stats",
  "process",
  "table",
  "closing",
  /*
   * AUDIT-9 bloklari. `quiz` — nazorat testi (savol + 4 variant, javob
   * izohda yoki `answers` slaydida); `references` — tadqiqot manbalari;
   * `answers` — izohlar o'chiq bo'lganda test javoblari. Maketlari
   * `slide-layout-extra.ts` da (WP-C); dispatch `planSlide` da.
   */
  "quiz",
  "references",
  "answers",
] as const;

export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export type SlideStat = { value: string; label: string };
export type SlideTable = { headers: string[]; rows: string[][] };
export type SlideStep = { n: string; title: string; text: string };

export type SlideModel = {
  id: string;
  layout: SlideLayout;
  kicker?: string;
  title: string;
  subtitle?: string;
  bullets?: string[];
  leftTitle?: string;
  left?: string[];
  rightTitle?: string;
  right?: string[];
  quote?: string;
  quoteBy?: string;
  stats?: SlideStat[];
  steps?: SlideStep[];
  table?: SlideTable;
  footer?: string;
  /** Notiq nutqi — PPTX ning «Speaker notes» maydoniga tushadi. */
  notes?: string;
  imageHint?: string;
  image?: { url: string; alt?: string };
  /** `quiz`: savol, aynan 4 variant, to'g'ri javob indeksi 0..3. */
  quiz?: { q: string; options: string[]; answer: number }[];
  /** `references`: manba nomi (domen) va izoh — tadqiqotdan, uydirma emas. */
  refs?: { title: string; source: string }[];
  /** `stats`: diagramma majburiy («Diagramma» bloki) — 2+ bir birlikli qiymatda ham chiziladi. */
  chart?: boolean;
  /**
   * Foydalanuvchi tanlagan shrift o'lchamlari (pt) — kalit `SlideSrc`
   * ning JSON matni (masalan `{"f":"title"}`). `planSlide` OXIRIDA shu
   * qatlamga qo'llanadi, ya'ni PPTX ham, ko'ruvchi ham bir xil o'qiydi.
   * LLM yozmaydi; faqat ko'ruvchidagi tahrir (`style` op) to'ldiradi.
   */
  fontSize?: Record<string, number>;
  /**
   * Foydalanuvchi tanlagan shrift OILASI — kalit `fontSize` bilan bir xil
   * (`src` JSON), qiymat `SLIDE_FONTS` reyestridagi `id`. `applyFontOverrides`
   * qatlamga `face` yozadi — PPTX `fontFace` va ko'ruvchi `font-family`
   * bir joydan. LLM yozmaydi; faqat `style` op to'ldiradi.
   */
  font?: Record<string, SlideFontId>;
  /**
   * ASL (AI chizgan) rasm — foydalanuvchi «Rasmsiz» qilganda yoki o'z
   * rasmini qo'yganda `image` shu yerga ko'chadi, «Rasmni qaytarish»
   * (`imageRestore` op) uni qaytaradi. `planSlide` bu maydonni CHIZMAYDI.
   */
  imageOrig?: { url: string; alt?: string };
};

export type SlideDeck = {
  topic: string;
  author: string;
  workLabel: string;
  themeId: SlideThemeId;
  templateId: SlideTemplateId;
  visual: SlideVisual;
  audience: SlideAudience;
  slides: SlideModel[];
  /** Auditoriya × matn hajmi — PPTX va ko'ruvchi `planSlide` ga BIR XIL beradi. */
  bodyType: BodyRules;
  /** Logotip URL (data: yoki asset) — har slaydga `planSlide` qo'shadi. */
  logo?: string;
  /** «O'z shablonim» — bo'lsa `planSlide` namuna layoutlarida chizadi. */
  custom?: CustomTemplate;
  /** Ma'ruzachi izohlari yozilsinmi (PPTX notes + ko'ruvchi paneli standarti). */
  speakerNotes: boolean;
};

export const SLIDE_THEME_IDS = [
  "atlas",
  "lumen",
  "graphite",
  "parchment",
  "orbit",
  "clinic",
  "forge",
  "grove",
  "summit",
  "ink",
  "slate",
  "sakura",
  "legal",
  "aurora",
  "chalk",
] as const;

export type SlideThemeId = (typeof SLIDE_THEME_IDS)[number];

export type SlideChrome = "bar-left" | "bar-top" | "split" | "frame" | "block";

export type SlideThemeGroup = "akademik" | "talim" | "stem" | "biznes" | "ijodiy" | "minimal";

export type SlideTheme = {
  id: SlideThemeId;
  name: string;
  nameUz: string;
  group: SlideThemeGroup;
  blurb: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  /**
   * Aksent rangning MATN uchun varianti.
   *
   * `accent` to'ldirish (chiziq, ustun, karta) uchun tanlangan va yorug'
   * fonda ko'pincha WCAG AA dan o'tmaydi — masalan `atlas` ning oltini
   * krem fon ustida 2.20 edi, ya'ni raqamlar deyarli ko'rinmasdi.
   * Aksent MATN (agenda raqami, stats qiymati, diagramma yorlig'i) shu
   * maydondan oladi. `tests/themes.test.mts` har bir juftni o'lchaydi.
   */
  accentInk: string;
  accent2: string;
  titleBg: string;
  titleText: string;
  titleMuted: string;
  chrome: SlideChrome;
  darkContent: boolean;
};

export function isSlideThemeId(v: string): v is SlideThemeId {
  return (SLIDE_THEME_IDS as readonly string[]).includes(v);
}

export function isSlideLayout(v: string): v is SlideLayout {
  return (SLIDE_LAYOUTS as readonly string[]).includes(v);
}

/**
 * Manba ko'rsatkichi — matn qatlami `SlideModel` ning qaysi maydonidan
 * chizilgan (ko'ruvchida joyida tahrirlash uchun). Faqat `plan*`
 * funksiyalari biladi: `s.quote || s.title` zaxirasi, `— quoteBy`
 * prefiksi, `shortSource()` kabi transformatsiyalar bor. Dekorativ
 * qatlamlar (raqam, «→», A/B/C/D, sahifa raqami) ko'rsatkichsiz qoladi —
 * ular tahrirlanmaydi. PPTX renderer bu maydonni o'qimaydi.
 */
export type SlideSrc =
  | { f: "title" | "subtitle" | "kicker" | "quote" | "quoteBy" | "leftTitle" | "rightTitle" | "imageHint" | "footer" }
  | { f: "bullets" | "left" | "right"; i: number }
  | { f: "stats"; i: number; k: "value" | "label" }
  | { f: "steps"; i: number; k: "n" | "title" | "text" }
  | { f: "refs"; i: number; k: "title" | "source" }
  | { f: "quiz"; i: number; k: "q" }
  | { f: "quiz"; i: number; k: "option"; j: number }
  | { f: "table"; k: "header"; c: number }
  | { f: "table"; k: "cell"; r: number; c: number };
