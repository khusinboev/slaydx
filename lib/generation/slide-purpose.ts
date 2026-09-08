import type { SlideTemplateId } from "./slide-templates";
import type { SlideBlockId } from "./slide-blocks";

/**
 * Taqdimot TURI — deck nima uchun (dars, ma'ruza, himoya…).
 *
 * Auditoriya «kimga», tur esa «nima maqsadda». Tur standart shablonni
 * va standart tuzilma bloklarini beradi; foydalanuvchi bloklarni
 * o'zgartirsa uning tanlovi ustun (`blocks` maydoni).
 *
 * `general` → shablon `auto` (mavzudan `inferSlideTemplate`).
 */
export const SLIDE_PURPOSES = [
  "general",
  "lesson",
  "lecture",
  "seminar",
  "open_lesson",
  "report",
  "training",
  "defense",
  "pitch",
] as const;
export type SlidePurpose = (typeof SLIDE_PURPOSES)[number];

export function isSlidePurpose(v: string): v is SlidePurpose {
  return (SLIDE_PURPOSES as readonly string[]).includes(v);
}

export type PurposeDefaults = {
  label: string;
  templateId: SlideTemplateId;
  blocks: SlideBlockId[];
};

export const PURPOSE_DEFAULTS: Record<SlidePurpose, PurposeDefaults> = {
  general: { label: "Umumiy taqdimot", templateId: "auto", blocks: ["reja"] },
  lesson: { label: "Dars (yangi mavzu)", templateId: "lesson", blocks: ["reja", "maqsadlar", "motivatsiya", "amaliyot", "uyga_vazifa"] },
  lecture: { label: "Ma’ruza", templateId: "lecture", blocks: ["reja", "maqsadlar", "adabiyotlar"] },
  seminar: { label: "Seminar / amaliy mashg‘ulot", templateId: "lecture", blocks: ["reja", "amaliyot", "jadval"] },
  open_lesson: { label: "Ochiq dars / attestatsiya", templateId: "lesson", blocks: ["reja", "maqsadlar", "motivatsiya", "amaliyot", "test", "uyga_vazifa"] },
  report: { label: "Hisobot / tahlil", templateId: "report", blocks: ["reja", "diagramma", "jadval"] },
  training: { label: "Trening / master-klass", templateId: "lesson", blocks: ["maqsadlar", "motivatsiya", "amaliyot", "test"] },
  defense: { label: "Himoya (kurs ishi / diplom)", templateId: "defense", blocks: ["reja", "diagramma", "jadval", "adabiyotlar"] },
  pitch: { label: "Taklif / marketing", templateId: "pitch", blocks: ["motivatsiya", "diagramma"] },
};

export function purposeDefaults(p: SlidePurpose | string | undefined): PurposeDefaults {
  return PURPOSE_DEFAULTS[isSlidePurpose(p ?? "") ? (p as SlidePurpose) : "general"];
}
