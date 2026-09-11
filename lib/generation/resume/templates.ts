/**
 * Rezyume shablonlari (Rezyume 2 → AUDIT-16) — 10 ta maket, 6 ta palitra.
 *
 * Shablon — DATA: `planResume` (`layout.ts`) undan zonalarni yasaydi,
 * `render-docx.ts` va `ResumePage.tsx` ikkalasi ham shu ma'lumotdan
 * chizadi. Bu yerda DOM/docx importi YO'Q (izomorf).
 *
 * ── Nega qayta loyihalandi ───────────────────────────────────────────
 * Birinchi to'plamda 6 shablondan TO'RTTASI bir ustunli edi va faqat
 * sarlavha bezagi bilan farq qilardi (`classic`, `minimal`, `banner`,
 * `creative`) — foydalanuvchi ularni «bir xil» deb ko'rdi, haqli ravishda.
 * Endi farq BEZAKDA emas, TUZILMADA: ustun tartibi (`columns`), sarlavha
 * bloki (`header`), sana joylashuvi (`rowStyle`) va bo'lim sarlavhasining
 * o'rni (`heading`) — to'rt mustaqil o'lcham. Har shablon shu o'lchamlarda
 * boshqalardan kamida ikkitasi bilan ajralib turadi.
 *
 * Surat: 4 shablonda SLOT UMUMAN YO'Q (`photo: null`) — ular ATS va
 * rasmiy hujjat uchun; qolgan 6 tasida bor. Bu foydalanuvchi talabi:
 * «4 ta rasmsiz, 6 ta rasmli».
 */

export const RESUME_TEMPLATE_IDS = [
  // Suratsiz (ATS va rasmiy):
  "ats",
  "timeline",
  "compact",
  "letter",
  // Suratli:
  "modern",
  "twocol",
  "banner",
  "card",
  "split",
  "portrait",
] as const;
export type ResumeTemplateId = (typeof RESUME_TEMPLATE_IDS)[number];

export const RESUME_PALETTE_IDS = ["ember", "ocean", "forest", "graphite", "plum", "sand"] as const;
export type ResumePaletteId = (typeof RESUME_PALETTE_IDS)[number];

/** Hex `#`SIZ — DOCX (`fill`, `color`) va CSS (`#${x}`) ikkalasi uchun. */
export type ResumePalette = {
  id: ResumePaletteId;
  title: string;
  /** Sarlavha chizig'i, aksent yozuvlar. */
  accent: string;
  /** Aksentning ochiq varianti (to'q panelda ikkilamchi matn). */
  accentSoft: string;
  /** To'q panel/banner foni. */
  dark: string;
  /** Asosiy matn. */
  ink: string;
  /** Ikkilamchi matn (sana, yorliq). */
  muted: string;
  /** Ochiq panel foni (twocol) va bo'yalgan sarlavha foni (creative). */
  panel: string;
  /** To'q fondagi matn. */
  onDark: string;
};

export const RESUME_PALETTES: Record<ResumePaletteId, ResumePalette> = {
  ember: { id: "ember", title: "Ember", accent: "F97316", accentSoft: "FDBA74", dark: "1C1917", ink: "1C1917", muted: "78716C", panel: "FFF7ED", onDark: "F5F5F4" },
  ocean: { id: "ocean", title: "Ocean", accent: "0369A1", accentSoft: "7DD3FC", dark: "0C2A3F", ink: "0F172A", muted: "64748B", panel: "F0F9FF", onDark: "F1F5F9" },
  forest: { id: "forest", title: "Forest", accent: "15803D", accentSoft: "86EFAC", dark: "14261B", ink: "1A2E22", muted: "6B7280", panel: "F0FDF4", onDark: "F1F5F1" },
  graphite: { id: "graphite", title: "Graphite", accent: "374151", accentSoft: "D1D5DB", dark: "111827", ink: "111827", muted: "6B7280", panel: "F3F4F6", onDark: "F9FAFB" },
  plum: { id: "plum", title: "Plum", accent: "7E22CE", accentSoft: "D8B4FE", dark: "2E1065", ink: "1E1B4B", muted: "6B7280", panel: "FAF5FF", onDark: "F5F3FF" },
  sand: { id: "sand", title: "Sand", accent: "B45309", accentSoft: "FCD34D", dark: "3F2A14", ink: "292524", muted: "78716C", panel: "FEFCE8", onDark: "FEFCE8" },
};

export function isResumePaletteId(v: unknown): v is ResumePaletteId {
  return typeof v === "string" && (RESUME_PALETTE_IDS as readonly string[]).includes(v);
}

export type ResumeSectionId = "summary" | "experience" | "education" | "certificates" | "languages" | "skills" | "links";

/**
 * Ustun tuzilmasi.
 *  - `single`      — bitta oqim (butun kenglik);
 *  - `sidebar-left` / `sidebar-right` — RANGLI yon panel + asosiy ustun;
 *  - `split-main`  — ikki TENG huquqli ustun, rangli panel YO'Q: bo'limlar
 *                    ikkiga taqsimlanadi (uzun tajribani bir varaqqa sig'dirish).
 */
export type ResumeColumns = "single" | "sidebar-left" | "sidebar-right" | "split-main";

/**
 * Sarlavha bloki (ism/lavozim/aloqa qayerda va qanday):
 *  - `plain`    — chapda ism, o'ngda aloqa, ostida chiziq;
 *  - `centered` — hammasi markazda (rasmiy hujjat ko'rinishi);
 *  - `banner`   — varaq kengligidagi RANGLI tasma;
 *  - `card`     — ochiq rangli blok: chapda surat, o'ngda ism va aloqa;
 *  - `aside`    — sarlavha yon panelga tushadi (asosiy ustunda sarlavha yo'q).
 */
export type ResumeHeaderStyle = "plain" | "centered" | "banner" | "card" | "aside";

/**
 * Ish joyi/ta'lim qatorining geometriyasi:
 *  - `inline` — sarlavha chapda, davr o'ng chekkada (klassik);
 *  - `rail`   — davr CHAP ustunda, yonida vertikal chiziq va nuqta (taymlayn).
 */
export type ResumeRowStyle = "inline" | "rail";

/**
 * Bo'lim sarlavhasi:
 *  - `rule`     — matn ostida aksent chiziq;
 *  - `caps`     — katta harf + harflar orasi kengaytirilgan;
 *  - `block`    — aksent fonli blok (matn oq);
 *  - `hairline` — ingichka to'liq kenglikdagi chiziq;
 *  - `tab`      — chap tomonda qalin aksent tasma (vertikal);
 *  - `hanging`  — sarlavha CHAP maydonda, matn o'ngda (xat uslubi).
 */
export type ResumeHeadingStyle = "rule" | "caps" | "block" | "hairline" | "tab" | "hanging";

export type ResumeTemplate = {
  id: ResumeTemplateId;
  title: string;
  hint: string;
  columns: ResumeColumns;
  header: ResumeHeaderStyle;
  rowStyle: ResumeRowStyle;
  heading: ResumeHeadingStyle;
  /** Yon panel kengligi (mm); `single` uchun 0. `split-main` da — IKKINCHI ustun kengligi. */
  sidebarMm: number;
  /** Banner balandligi (mm); faqat `header: "banner"`. */
  bannerMm: number;
  /** `heading: "hanging"` va `rowStyle: "rail"` uchun chap ustun kengligi (mm). */
  railMm: number;
  /** Surat sloti; `null` — bu shablon SURATSIZ. */
  photo: { shape: "circle" | "square"; sizeMm: number; where: "aside" | "banner" | "header" } | null;
  defaultPalette: ResumePaletteId;
  /** Yon panel to'q (palette.dark) yoki ochiq (palette.panel). */
  darkAside: boolean;
  /** pt: shrift nomi va o'lchamlar; `line` — qator oralig'i (×). */
  type: { font: string; body: number; h1: number; h2: number; small: number; line: number };
  /** Yon panelga/ikkinchi ustunga tushadigan bo'limlar. */
  asideSections: ResumeSectionId[];
  marginsMm: { top: number; bottom: number; left: number; right: number };
};

const SANS = { font: "Arial", body: 10, h1: 20, h2: 11, small: 8.5, line: 1.25 } as const;
const SERIF = { font: "Times New Roman", body: 11, h1: 20, h2: 12, small: 9, line: 1.2 } as const;

export const RESUME_TEMPLATES: Record<ResumeTemplateId, ResumeTemplate> = {
  /* ─────────────── SURATSIZ ─────────────── */
  ats: {
    id: "ats",
    title: "ATS",
    hint: "Bir ustun, markazlashgan sarlavha — robot o‘qishi uchun eng qulay",
    columns: "single",
    header: "centered",
    rowStyle: "inline",
    heading: "caps",
    sidebarMm: 0,
    bannerMm: 0,
    railMm: 0,
    photo: null,
    defaultPalette: "graphite",
    darkAside: false,
    type: { ...SERIF },
    asideSections: [],
    marginsMm: { top: 18, bottom: 18, left: 20, right: 20 },
  },
  timeline: {
    id: "timeline",
    title: "Taymlayn",
    hint: "Sanalar chap ustunda, vertikal chiziq va nuqtalar bilan",
    columns: "single",
    header: "plain",
    rowStyle: "rail",
    heading: "hairline",
    sidebarMm: 0,
    bannerMm: 0,
    railMm: 30,
    photo: null,
    defaultPalette: "ocean",
    darkAside: false,
    type: { font: "Arial", body: 10, h1: 21, h2: 10, small: 8.5, line: 1.3 },
    asideSections: [],
    marginsMm: { top: 16, bottom: 16, left: 18, right: 18 },
  },
  compact: {
    id: "compact",
    title: "Ixcham",
    hint: "Ikki teng ustun — uzun tajriba bir varaqqa sig‘adi",
    columns: "split-main",
    header: "plain",
    rowStyle: "inline",
    heading: "tab",
    sidebarMm: 66,
    bannerMm: 0,
    railMm: 0,
    photo: null,
    defaultPalette: "forest",
    darkAside: false,
    type: { font: "Arial", body: 9.5, h1: 19, h2: 10, small: 8, line: 1.2 },
    asideSections: ["skills", "languages", "certificates", "links"],
    marginsMm: { top: 15, bottom: 15, left: 16, right: 16 },
  },
  letter: {
    id: "letter",
    title: "Xat",
    hint: "Bo‘lim nomlari chap maydonda, matn o‘ngda — rasmiy uslub",
    columns: "single",
    header: "plain",
    rowStyle: "inline",
    heading: "hanging",
    sidebarMm: 0,
    bannerMm: 0,
    railMm: 34,
    photo: null,
    defaultPalette: "sand",
    darkAside: false,
    type: { ...SERIF, h1: 24 },
    asideSections: [],
    marginsMm: { top: 20, bottom: 18, left: 18, right: 18 },
  },

  /* ─────────────── SURATLI ─────────────── */
  modern: {
    id: "modern",
    title: "Modern",
    hint: "To‘q chap panel, doira surat",
    columns: "sidebar-left",
    header: "aside",
    rowStyle: "inline",
    heading: "rule",
    sidebarMm: 68,
    bannerMm: 0,
    railMm: 0,
    photo: { shape: "circle", sizeMm: 36, where: "aside" },
    defaultPalette: "ember",
    darkAside: true,
    type: { ...SANS },
    asideSections: ["skills", "languages", "links"],
    marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  twocol: {
    id: "twocol",
    title: "Ikki ustun",
    hint: "Ochiq o‘ng panel, doira surat",
    columns: "sidebar-right",
    header: "aside",
    rowStyle: "inline",
    heading: "rule",
    sidebarMm: 62,
    bannerMm: 0,
    railMm: 0,
    photo: { shape: "circle", sizeMm: 32, where: "aside" },
    defaultPalette: "ocean",
    darkAside: false,
    type: { ...SANS },
    asideSections: ["skills", "languages", "certificates", "links"],
    marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  banner: {
    id: "banner",
    title: "Banner",
    hint: "Varaq kengligidagi rangli tasma, surat tasma ichida",
    columns: "single",
    header: "banner",
    rowStyle: "inline",
    heading: "caps",
    sidebarMm: 0,
    bannerMm: 52,
    railMm: 0,
    photo: { shape: "circle", sizeMm: 34, where: "banner" },
    defaultPalette: "forest",
    darkAside: true,
    type: { ...SANS },
    asideSections: [],
    marginsMm: { top: 0, bottom: 16, left: 18, right: 18 },
  },
  card: {
    id: "card",
    title: "Karta",
    hint: "Ochiq rangli sarlavha kartasi: chapda kvadrat surat",
    columns: "single",
    header: "card",
    rowStyle: "inline",
    heading: "block",
    sidebarMm: 0,
    bannerMm: 44,
    railMm: 0,
    photo: { shape: "square", sizeMm: 32, where: "header" },
    defaultPalette: "plum",
    darkAside: false,
    type: { font: "Arial", body: 10, h1: 22, h2: 10.5, small: 8.5, line: 1.25 },
    asideSections: [],
    marginsMm: { top: 14, bottom: 16, left: 16, right: 16 },
  },
  split: {
    id: "split",
    title: "Split",
    hint: "Keng ochiq chap panel, katta kvadrat surat; ism o‘ng ustunda",
    columns: "sidebar-left",
    header: "plain",
    rowStyle: "inline",
    heading: "tab",
    sidebarMm: 76,
    bannerMm: 0,
    railMm: 0,
    photo: { shape: "square", sizeMm: 52, where: "aside" },
    defaultPalette: "graphite",
    darkAside: false,
    type: { ...SANS, h1: 22 },
    asideSections: ["skills", "languages", "certificates", "links"],
    marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  portrait: {
    id: "portrait",
    title: "Portret",
    hint: "Katta doira surat markazda, ism ostida",
    columns: "single",
    header: "centered",
    rowStyle: "inline",
    heading: "rule",
    sidebarMm: 0,
    bannerMm: 0,
    railMm: 0,
    photo: { shape: "circle", sizeMm: 40, where: "header" },
    defaultPalette: "sand",
    darkAside: false,
    type: { ...SANS, h1: 23 },
    asideSections: [],
    marginsMm: { top: 16, bottom: 16, left: 20, right: 20 },
  },
};

/** Suratsiz shablonlar — galereyada alohida guruh. */
export const PHOTOLESS_TEMPLATE_IDS = RESUME_TEMPLATE_IDS.filter((id) => !RESUME_TEMPLATES[id].photo);
/** Suratli shablonlar. */
export const PHOTO_TEMPLATE_IDS = RESUME_TEMPLATE_IDS.filter((id) => Boolean(RESUME_TEMPLATES[id].photo));

export function isResumeTemplateId(v: unknown): v is ResumeTemplateId {
  return typeof v === "string" && (RESUME_TEMPLATE_IDS as readonly string[]).includes(v);
}

/**
 * Noma'lum/bo'sh → `modern`.
 *
 * Eski nomlar ham qabul qilinadi: bazadagi rezyumelarda `classic`,
 * `minimal` va `creative` saqlangan bo'lishi mumkin — ular endi yo'q,
 * lekin eski hujjat ochilganda «shablon topilmadi» degan sakrash
 * bo'lmasligi kerak, shuning uchun eng yaqin yangi maketga ko'chiriladi.
 */
const RENAMED: Record<string, ResumeTemplateId> = {
  classic: "ats",
  minimal: "timeline",
  creative: "card",
};

export function normalizeResumeTemplate(v: unknown): ResumeTemplateId {
  if (isResumeTemplateId(v)) return v;
  if (typeof v === "string" && RENAMED[v]) return RENAMED[v];
  return "modern";
}

/** Shu shablon suratni chizadimi. */
export function templateHasPhoto(id: ResumeTemplateId): boolean {
  return Boolean(RESUME_TEMPLATES[id].photo);
}
