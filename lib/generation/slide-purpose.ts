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
  /**
   * Promptga tushadigan 1–2 gaplik ko'rsatma — bu tur qanday YOZILISHI
   * kerakligini aytadi (auditoriya «kimga»ni aytadi, bu «qanday»ni).
   * `general` da bo'sh — mahsus ko'rsatma yo'q, `briefLines` qatorni
   * umuman tashlaydi.
   */
  guidance: string;
};

export const PURPOSE_DEFAULTS: Record<SlidePurpose, PurposeDefaults> = {
  general: { label: "Umumiy taqdimot", templateId: "auto", blocks: ["reja"], guidance: "" },
  lesson: { label: "Dars (yangi mavzu)", templateId: "lesson", blocks: ["reja", "maqsadlar", "motivatsiya", "amaliyot", "uyga_vazifa"], guidance: "Yangi mavzu: avval nima uchun kerakligi, keyin tushuncha, keyin mashq." },
  lecture: { label: "Ma’ruza", templateId: "lecture", blocks: ["reja", "maqsadlar", "adabiyotlar"], guidance: "Ta’rif + misol + cheklov." },
  seminar: { label: "Seminar / amaliy mashg‘ulot", templateId: "lecture", blocks: ["reja", "amaliyot", "jadval"], guidance: "Amaliy: har bo‘limda auditoriya bajaradigan narsa bo‘lsin." },
  open_lesson: { label: "Ochiq dars / attestatsiya", templateId: "lesson", blocks: ["reja", "maqsadlar", "motivatsiya", "amaliyot", "test", "uyga_vazifa"], guidance: "Attestatsiya: maqsad → jarayon → nazorat → refleksiya." },
  report: { label: "Hisobot / tahlil", templateId: "report", blocks: ["reja", "diagramma", "jadval"], guidance: "Raqam va tavsiya — har xulosa ortida ko‘rsatkich turadi." },
  training: { label: "Trening / master-klass", templateId: "lesson", blocks: ["maqsadlar", "motivatsiya", "amaliyot", "test"], guidance: "Master-klass: qadam, xato, natija." },
  defense: { label: "Himoya (kurs ishi / diplom)", templateId: "defense", blocks: ["reja", "diagramma", "jadval", "adabiyotlar"], guidance: "Tadqiqot savoli SAVOL shaklida bo‘lsin, har da’vo ortida asos ko‘rinsin." },
  pitch: { label: "Taklif / marketing", templateId: "pitch", blocks: ["motivatsiya", "diagramma"], guidance: "Bitta slayd — bitta fikr, uydirma bozor raqami YO‘Q." },
};

export function purposeDefaults(p: SlidePurpose | string | undefined): PurposeDefaults {
  return PURPOSE_DEFAULTS[isSlidePurpose(p ?? "") ? (p as SlidePurpose) : "general"];
}
