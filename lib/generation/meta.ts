import type { FormValues, ToolConfig } from "../types";
import { isSlideAudience, isSlideTemplateId } from "./slide-templates";
import { isSlideThemeId } from "./slide-types";
import type { DocMeta } from "./types";

function s(v: FormValues, key: string, fallback = "") {
  const x = v[key];
  if (x === null || x === undefined || x === "") return fallback;
  return String(x).trim();
}

function parsePages(raw: string, fallback: number) {
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return Math.max(1, Number(raw));
  const m = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return Math.round((Number(m[1]) + Number(m[2])) / 2);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function ministryTitle(code: string) {
  if (code === "maktab") {
    return "O‘ZBEKISTON RESPUBLIKASI\nMAKTABGACHA VA MAKTAB TA’LIMI VAZIRLIGI";
  }
  return "O‘ZBEKISTON RESPUBLIKASI\nOLIY TA’LIM, FAN VA INNOVATSIYALAR VAZIRLIGI";
}

/**
 * Manba matnining PROMPTGA tushadigan qismi.
 *
 * Bu `lib/server/validate.ts` dagi `MAX_SOURCE` (60 000) bilan bir xil
 * emas va bo'lmasligi ham kerak — ular boshqa savolga javob beradi:
 *
 *   `MAX_SOURCE`        — bazaga va so'rovga umuman nima kiradi (xom shift);
 *   `SOURCE_TEXT_LIMIT` — shundan qanchasi MODELGA yuboriladi.
 *
 * Ikkalasi ham kerak, chunki vositalar manbani turlicha ishlatadi:
 *   • referat/kurs ishi «fayl asosida» — manba KONTEKST, ya'ni undan
 *     xulosa yoziladi; birinchi 24 000 belgi yetadi va token narxini
 *     ushlab turadi;
 *   • tarjima — manba MAHSULOTNING O'ZI, bir belgi ham yo'qolmasligi
 *     kerak. Shuning uchun u `values.sourceText` ni XOM holda o'qiydi va
 *     o'z chegarasiga (`TRANSLATION_MAX_CHARS`, 48 000) bo'ysunadi,
 *     undan oshgani esa pul yechilishidan oldin rad etiladi
 *     (`preflightError`).
 *
 * Ilgari bu bog'liqlik hech qayerda yozilmagandi va ikki konstanta
 * bir-biriga zid ko'rinardi (P1-21).
 */
export const SOURCE_TEXT_LIMIT = 24_000;

/**
 * Muallif satridan kurs va guruhni ajratadi.
 *
 * Formada alohida «kurs» va «guruh» maydonlari yo'q — foydalanuvchi
 * hammasini bitta qatorga yozadi: «Aliyev Ali — 3-kurs, 301-guruh».
 * Natijada titul sahifada `course`/`group` qatorlari doim bo'sh qolar,
 * muallif o'rnida esa butun satr chiqar edi. Endi satr ajratiladi:
 * titulda «Bajardi: Aliyev Ali» va alohida «3-kurs, 301-guruh».
 */
export function parseAuthorLine(raw: string): { name: string; course: string; group: string } {
  const line = raw.replace(/\s+/g, " ").trim();
  const course = line.match(/(\d{1,2})\s*-?\s*kurs/i)?.[1] ?? "";
  const group = line.match(/([0-9]+[a-zA-Z]?)\s*-?\s*guruh/i)?.[1] ?? "";
  const name = line
    .replace(/\d{1,2}\s*-?\s*kurs/gi, "")
    .replace(/[0-9]+[a-zA-Z]?\s*-?\s*guruh/gi, "")
    .replace(/[\s,;—–-]+$/g, "")
    .replace(/^[\s,;—–-]+/g, "")
    .trim();
  return { name: name || line, course, group };
}

export function extractMeta(tool: ToolConfig, values: FormValues): DocMeta {
  const topic = s(values, "topic", s(values, "subject", s(values, "targetRole", tool.title)));
  const pagesLabel = s(values, "pages", tool.id === "essay" ? "2" : tool.id === "coursework" ? "20-25" : "10-15");
  const fallbackPages =
    tool.id === "essay" ? 2 : tool.id === "coursework" ? 22 : tool.id === "article" || tool.id === "thesis" ? 6 : 12;
  const quality = s(values, "quality", "standard");
  const slidePages =
    quality === "premium_long" ? 16 : quality === "long" ? 14 : quality === "premium" ? 12 : 10;
  const authorParts = parseAuthorLine(s(values, "author", s(values, "fullName")));
  const audienceRaw = s(values, "slideAudience", "auto");
  const themeRaw = s(values, "slideTheme", "atlas");
  const templateRaw = s(values, "slideTemplate", "auto");
  return {
    toolId: tool.id,
    workLabel: tool.title,
    topic,
    language: s(values, "language", "uz"),
    extra: s(values, "extra"),
    sourceText: s(values, "sourceText").slice(0, SOURCE_TEXT_LIMIT),
    author: authorParts.name,
    university: s(values, "university").replace(/\s+/g, " "),
    faculty: s(values, "faculty").replace(/\s+/g, " "),
    department: s(values, "department").replace(/\s+/g, " "),
    subject: s(
      values,
      "subject",
      tool.id === "glossary" || tool.id === "keys" || tool.id === "translation" || tool.id === "image"
        ? topic
        : "",
    ).replace(/\s+/g, " "),
    teacher: s(values, "teacher").replace(/\s+/g, " "),
    city: s(values, "city", "Toshkent"),
    // Alohida maydon bo'lsa u ustun; bo'lmasa muallif satridan olinadi.
    group: s(values, "group", authorParts.group),
    course: s(values, "course", authorParts.course),
    ministry:
      s(
        values,
        "ministry",
        tool.id === "lesson-plan" || tool.id === "texnologik-xarita" ? "maktab" : "oliy",
      ) === "maktab"
        ? "maktab"
        : "oliy",
    kind: s(values, "kind", "standard"),
    pagesLabel: tool.id === "slide" ? String(slidePages) : pagesLabel,
    targetPages: tool.id === "slide" ? slidePages : parsePages(pagesLabel, fallbackPages),
    slideTheme: isSlideThemeId(themeRaw) ? themeRaw : "atlas",
    slideTemplate: isSlideTemplateId(templateRaw) ? templateRaw : "auto",
    annotationLangs: s(values, "annotationLangs", "same") === "all" ? "all" : "same",
    email: s(values, "email"),
    organization: s(values, "organization", s(values, "university")),
    degree: s(values, "degree"),
    weeklyHours: Number(values.weeklyHours || 4),
    totalHours: Number(values.totalHours || 136),
    grade: Number(values.grade || 8),
    duration: Number(values.duration || 45),
    fileNameHint: topic.replace(/[^\p{L}\p{N}\- ]/gu, "").trim().slice(0, 60) || tool.slug,
    tocMethod: s(values, "tocMethod", "ai") === "manual" ? "manual" : "ai",
    tocText: s(values, "tocText"),
    includeVisuals: s(values, "images", "yes") !== "no",
    // Formada belgilanmagan bo'lsa titul slaydi qoladi (eski xatti-harakat).
    titleSlide: values.titleSlide !== false,
    premiumVisuals: quality === "premium" || quality === "premium_long",
    slideAudience: isSlideAudience(audienceRaw) ? audienceRaw : "auto",
    design: s(values, "design", "iris"),
  };
}
