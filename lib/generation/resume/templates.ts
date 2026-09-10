/**
 * Rezyume shablonlari (Rezyume 2, AUDIT-15) — 6 ta maket, 6 ta palitra.
 *
 * Shablon — DATA: `planResume` (`layout.ts`) undan zonalarni yasaydi,
 * `render-docx.ts` va `ResumePage.tsx` ikkalasi ham shu ma'lumotdan
 * chizadi. Bu yerda DOM/docx importi YO'Q (izomorf).
 */

export const RESUME_TEMPLATE_IDS = ["modern", "classic", "minimal", "twocol", "banner", "creative"] as const;
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

export type ResumeTemplate = {
  id: ResumeTemplateId;
  title: string;
  hint: string;
  /** Ustun tuzilmasi: bir ustun, chap/o'ng panel yoki bosh banner. */
  columns: "single" | "sidebar-left" | "sidebar-right" | "banner";
  /** Panel kengligi (mm); single/banner uchun 0. */
  sidebarMm: number;
  /** Banner balandligi (mm); faqat `banner`. */
  bannerMm: number;
  photo: { shape: "circle" | "square"; sizeMm: number; where: "aside" | "banner" | "header" };
  /** Surat standart holatda ko'rsatiladimi (classic — yo'q). */
  photoDefault: boolean;
  defaultPalette: ResumePaletteId;
  /** Panel to'q (palette.dark) yoki ochiq (palette.panel). */
  darkAside: boolean;
  /** pt: shrift nomi va o'lchamlar; `line` — qator oralig'i (×). */
  type: { font: string; body: number; h1: number; h2: number; small: number; line: number };
  /** h2 uslubi: pastki chiziq, katta harf, bo'yalgan blok, ingichka chiziq. */
  heading: "rule" | "caps" | "block" | "hairline";
  /** Panel/bannerga tushadigan bo'limlar (qolganlari asosiy ustunda). */
  asideSections: ResumeSectionId[];
  marginsMm: { top: number; bottom: number; left: number; right: number };
};

const TYPE_SANS = { font: "Arial", body: 10, h1: 20, h2: 11, small: 8.5, line: 1.25 } as const;
const TYPE_SERIF = { font: "Times New Roman", body: 11, h1: 20, h2: 12, small: 9, line: 1.2 } as const;

export const RESUME_TEMPLATES: Record<ResumeTemplateId, ResumeTemplate> = {
  modern: {
    id: "modern",
    title: "Modern",
    hint: "To‘q yon panel, doira surat",
    columns: "sidebar-left",
    sidebarMm: 68,
    bannerMm: 0,
    photo: { shape: "circle", sizeMm: 36, where: "aside" },
    photoDefault: true,
    defaultPalette: "ember",
    darkAside: true,
    type: { ...TYPE_SANS },
    heading: "rule",
    asideSections: ["skills", "languages", "links"],
    marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  classic: {
    id: "classic",
    title: "Classic",
    // Surat SLOTI bor (sarlavhada), lekin standart holatda YOQILMAGAN:
    // ATS tizimlari suratli rezyumeni yomon o'qiydi. Foydalanuvchi o'zi
    // qo'shsa chiziladi — galereya kartasi ham shuni ko'rsatadi.
    hint: "Bir ustun, ATS uchun qulay",
    columns: "single",
    sidebarMm: 0,
    bannerMm: 0,
    photo: { shape: "square", sizeMm: 30, where: "header" },
    photoDefault: false,
    defaultPalette: "graphite",
    darkAside: false,
    type: { ...TYPE_SERIF },
    heading: "caps",
    asideSections: [],
    marginsMm: { top: 18, bottom: 18, left: 20, right: 20 },
  },
  minimal: {
    id: "minimal",
    title: "Minimal",
    hint: "Ingichka chiziqlar, kvadrat surat",
    columns: "single",
    sidebarMm: 0,
    bannerMm: 0,
    photo: { shape: "square", sizeMm: 28, where: "header" },
    photoDefault: true,
    defaultPalette: "graphite",
    darkAside: false,
    type: { font: "Arial", body: 10, h1: 22, h2: 10, small: 8.5, line: 1.3 },
    heading: "hairline",
    asideSections: [],
    marginsMm: { top: 18, bottom: 16, left: 20, right: 20 },
  },
  twocol: {
    id: "twocol",
    title: "Ikki ustun",
    hint: "Ochiq o‘ng panel",
    columns: "sidebar-right",
    sidebarMm: 62,
    bannerMm: 0,
    photo: { shape: "circle", sizeMm: 32, where: "aside" },
    photoDefault: true,
    defaultPalette: "ocean",
    darkAside: false,
    type: { ...TYPE_SANS },
    heading: "rule",
    asideSections: ["skills", "languages", "certificates", "links"],
    marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
  },
  banner: {
    id: "banner",
    title: "Banner",
    hint: "Rangli bosh banner, surat banner ichida",
    columns: "banner",
    sidebarMm: 0,
    bannerMm: 52,
    photo: { shape: "circle", sizeMm: 34, where: "banner" },
    photoDefault: true,
    defaultPalette: "forest",
    darkAside: true,
    type: { ...TYPE_SANS },
    heading: "caps",
    asideSections: [],
    marginsMm: { top: 0, bottom: 16, left: 18, right: 18 },
  },
  creative: {
    id: "creative",
    title: "Creative",
    hint: "Aksent chiziqlar, bo‘yalgan sarlavhalar",
    columns: "single",
    sidebarMm: 0,
    bannerMm: 0,
    photo: { shape: "square", sizeMm: 30, where: "header" },
    photoDefault: true,
    defaultPalette: "plum",
    darkAside: false,
    type: { font: "Arial", body: 10, h1: 24, h2: 11, small: 8.5, line: 1.25 },
    heading: "block",
    asideSections: [],
    marginsMm: { top: 16, bottom: 16, left: 18, right: 18 },
  },
};

export function isResumeTemplateId(v: unknown): v is ResumeTemplateId {
  return typeof v === "string" && (RESUME_TEMPLATE_IDS as readonly string[]).includes(v);
}

/** Noma'lum/bo'sh → `modern`. */
export function normalizeResumeTemplate(v: unknown): ResumeTemplateId {
  return isResumeTemplateId(v) ? v : "modern";
}
