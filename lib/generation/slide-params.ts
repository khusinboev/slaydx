/**
 * SLAYD PARAMETRLARI REYESTRI — yagona manba.
 *
 * Nega bu fayl bor. AUDIT-7 da 21 ta shablon «har xilini tanlasam ham
 * bir xil chiqadi» edi: parametr formada turar, lekin promptga ham,
 * maketga ham yetib bormasdi. Foydalanuvchi talabi qat'iy: **har bir
 * parametr o'lchanadigan ta'sir qiladi, bezak maydon yo'q.**
 *
 * Kafolat mexanizmi:
 *   1. Har parametr shu yerda `impacts` bilan e'lon qilinadi — qaysi
 *      chiqishni o'zgartirishi SHART (prompt, beats, maket, narx, rasm
 *      prompti, tadqiqot chaqiruvi).
 *   2. `tests/slide-params.test.mts` har parametr uchun `probeA`/`probeB`
 *      qiymat bilan differensial zond o'tkazadi: e'lon qilingan har
 *      `impact` da farq bo'lmasa — test qizil.
 *   3. Formalar maydonlarni FAQAT shu ro'yxatdan chizadi; «reyestrda bor,
 *      formada yo'q» va aksi qamrov testi bilan ushlanadi.
 *
 * Yangi maydon qo'shish tartibi: avval shu yerga qator, keyin `DocMeta`,
 * keyin ta'sir nuqtasi, keyin forma. Teskarisi kompilyatsiya/test bilan
 * to'xtatiladi.
 */
import type { FormValues } from "../types";

/** Matn hajmi — band soni va uzunligini boshqaradi; shrift POLI o'zgarmaydi (Slide Law). */
export const SLIDE_TEXT_VOLUMES = ["qisqa", "standart", "kop"] as const;
export type SlideTextVolume = (typeof SLIDE_TEXT_VOLUMES)[number];
export function isSlideTextVolume(v: string): v is SlideTextVolume {
  return (SLIDE_TEXT_VOLUMES as readonly string[]).includes(v);
}

/**
 * Rasm uslubi — `image-studio.ts` `IMAGE_STYLES` id lari. `chalk` (doska)
 * yangi qo'shiladi (WP-E). Bu `SLIDE_THEME_IDS` dagi `chalk` TEMASI emas —
 * boshqa namespace.
 */
export const SLIDE_IMAGE_STYLES = ["minimal", "illustration", "chalk", "photo"] as const;
export type SlideImageStyle = (typeof SLIDE_IMAGE_STYLES)[number];
export function isSlideImageStyle(v: string): v is SlideImageStyle {
  return (SLIDE_IMAGE_STYLES as readonly string[]).includes(v);
}

/** Pro-slayd: slaydlar soni chegarasi va narxi (har slaydga). */
export const PRO_SLIDE_MIN = 4;
export const PRO_SLIDE_MAX = 30;
export const PRO_SLIDE_DEFAULT = 12;
export const PRO_SLIDE_PER_SLIDE = 2000;
/** Dvigatel qabul qiladigan eng ko'p slayd (ilgari `wantSlides` 20 da qirqardi). */
export const SLIDE_MAX = PRO_SLIDE_MAX;

/**
 * Oddiy slayd: pro bilan BIR XIL slayder (4–30), lekin narx paket emas,
 * formula — `SLIDE_INCLUDED` (20) tagacha bitta narx, keyingi har slayd
 * `SLIDE_EXTRA_PRICE`. «Sifat / hajm» paketlari (standard/long/premium)
 * olib tashlangan (Formalar 2): 25 slayd = 5 500, 30 = 8 000.
 */
export const SLIDE_MIN = PRO_SLIDE_MIN;
export const SLIDE_DEFAULT = 10;
export const SLIDE_BASE_PRICE = 3000;
export const SLIDE_INCLUDED = 20;
export const SLIDE_EXTRA_PRICE = 500;

/** Oddiy slayd narxi — `priceFor` (server) va forma bitta formuladan. */
export function slidePrice(count: number): number {
  const n = clampInt(count, SLIDE_MIN, SLIDE_MAX, SLIDE_DEFAULT);
  return SLIDE_BASE_PRICE + Math.max(0, n - SLIDE_INCLUDED) * SLIDE_EXTRA_PRICE;
}

export const PLAN_ITEMS_MIN = 3;
export const PLAN_ITEMS_MAX = 6;
export const PLAN_ITEMS_DEFAULT = 5;
export const QUIZ_COUNTS = [0, 3, 5, 10] as const;
export const KEY_IDEAS_MAX = 3;
export const KEY_IDEA_CHARS = 120;

export type SlideTool = "slide" | "pro-slide";
export type SlideParamImpact = "prompt" | "beats" | "layout" | "price" | "images" | "research";

export type SlideParam = {
  id: string;
  /** Qaysi vositalarning formasida chiziladi. */
  tools: SlideTool[];
  /** `FormValues` massiv qabul qilmaydi — ro'yxatlar vergul bilan (`csv`). */
  encode: "string" | "number" | "boolean" | "csv";
  /** Differensial zond uchun ikki xil qiymat. */
  probeA: FormValues[string];
  probeB: FormValues[string];
  /** Shu chiqishlarda A va B farq qilishi SHART. */
  impacts: SlideParamImpact[];
  /** Zond boshqa parametrni ham talab qilsa (masalan `quizCount` faqat `blocks` da `test` bilan). */
  probeWith?: FormValues;
};

export const SLIDE_PARAMS: SlideParam[] = [
  { id: "topic", tools: ["slide", "pro-slide"], encode: "string", probeA: "Fotosintez", probeB: "Suv aylanishi", impacts: ["prompt", "images"] },
  { id: "language", tools: ["slide", "pro-slide"], encode: "string", probeA: "uz", probeB: "ru", impacts: ["prompt"] },
  { id: "author", tools: ["slide", "pro-slide"], encode: "string", probeA: "Aliyev Ali", probeB: "Karimova Dilnoza", impacts: ["layout"] },
  { id: "position", tools: ["pro-slide"], encode: "string", probeA: "Fizika o‘qituvchisi", probeB: "Katta o‘qituvchi", impacts: ["prompt", "layout"] },
  { id: "organization", tools: ["slide", "pro-slide"], encode: "string", probeA: "12-maktab", probeB: "TDPU", impacts: ["prompt", "layout"] },
  { id: "logoAssetId", tools: ["slide", "pro-slide"], encode: "string", probeA: "", probeB: "0123456789abcdef01234567", impacts: ["layout"] },
  { id: "subject", tools: ["slide", "pro-slide"], encode: "string", probeA: "Biologiya", probeB: "Kimyo", impacts: ["prompt"] },
  { id: "slideAudience", tools: ["slide", "pro-slide"], encode: "string", probeA: "school_1_4", probeB: "students_master", impacts: ["prompt", "layout"] },
  { id: "slidePurpose", tools: ["slide", "pro-slide"], encode: "string", probeA: "lesson", probeB: "defense", impacts: ["beats", "prompt"] },
  { id: "keyIdeas", tools: ["pro-slide"], encode: "csv", probeA: "", probeB: "Suv bug‘lanadi,Bulut hosil bo‘ladi", impacts: ["prompt"] },
  { id: "localExamples", tools: ["slide", "pro-slide"], encode: "boolean", probeA: false, probeB: true, impacts: ["prompt", "images"] },
  { id: "blocks", tools: ["pro-slide"], encode: "csv", probeA: "reja", probeB: "reja,test,adabiyotlar", impacts: ["beats"] },
  { id: "planItems", tools: ["slide", "pro-slide"], encode: "number", probeA: 3, probeB: 6, impacts: ["prompt", "layout"] },
  // 4 → 25: oddiyda narx 3 000 → 5 500, proda 8 000 → 50 000 — ikkalasida ham «price» farq qiladi.
  { id: "slideCount", tools: ["slide", "pro-slide"], encode: "number", probeA: 4, probeB: 25, impacts: ["beats", "price"] },
  { id: "titleSlide", tools: ["slide", "pro-slide"], encode: "boolean", probeA: true, probeB: false, impacts: ["beats"] },
  { id: "agendaSlide", tools: ["slide", "pro-slide"], encode: "boolean", probeA: true, probeB: false, impacts: ["beats"] },
  { id: "textVolume", tools: ["slide", "pro-slide"], encode: "string", probeA: "qisqa", probeB: "kop", impacts: ["prompt", "layout"] },
  { id: "quizCount", tools: ["slide", "pro-slide"], encode: "number", probeA: 0, probeB: 5, impacts: ["beats", "prompt"] },
  { id: "internetSearch", tools: ["slide", "pro-slide"], encode: "boolean", probeA: false, probeB: true, impacts: ["research", "beats"] },
  { id: "speakerNotes", tools: ["slide", "pro-slide"], encode: "boolean", probeA: true, probeB: false, impacts: ["prompt"] },
  { id: "extra", tools: ["slide", "pro-slide"], encode: "string", probeA: "", probeB: "ko‘proq diagramma bo‘lsin", impacts: ["prompt"] },
  // Faqat pro: oddiy slayd rasmlari DOIM bepul stock (Pexels/Pixabay) — u faqat `photo` uslubini biladi.
  { id: "slideImageStyle", tools: ["pro-slide"], encode: "string", probeA: "minimal", probeB: "chalk", impacts: ["images"] },
  { id: "slideTemplate", tools: ["slide", "pro-slide"], encode: "string", probeA: "lecture", probeB: "report", impacts: ["beats", "layout"] },
  { id: "slideTheme", tools: ["slide", "pro-slide"], encode: "string", probeA: "atlas", probeB: "graphite", impacts: ["layout"] },
];

export function slideParamsFor(tool: SlideTool): SlideParam[] {
  return SLIDE_PARAMS.filter((p) => p.tools.includes(tool));
}

/**
 * Ro'yxatni `FormValues` ga sig'adigan satrga va qaytariga o'giradi.
 * Yagona joy — forma ham, `extractMeta` ham shu ikkisini ishlatadi;
 * ikki nusxa bo'lsa vergul/yangi qator bo'yicha ajralib ketardi.
 */
export function splitCsv(v: unknown, max: number, itemMax: number): string[] {
  return String(v ?? "")
    .split(/[,\n]/)
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, itemMax))
    .filter(Boolean)
    .slice(0, max);
}

export function joinCsv(items: readonly string[]): string {
  return items.map((s) => s.replace(/,/g, " ").trim()).filter(Boolean).join(",");
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
