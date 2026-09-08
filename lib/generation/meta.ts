import { defaultPages } from "../tools";
import type { FormValues, ToolConfig } from "../types";
import { normalizeAudienceId } from "./slide-audience";
import { isSlideBlockId, type SlideBlockId } from "./slide-blocks";
import {
  KEY_IDEAS_MAX,
  KEY_IDEA_CHARS,
  PLAN_ITEMS_DEFAULT,
  PLAN_ITEMS_MAX,
  PLAN_ITEMS_MIN,
  PRO_SLIDE_DEFAULT,
  PRO_SLIDE_MAX,
  PRO_SLIDE_MIN,
  QUIZ_COUNTS,
  clampInt,
  isSlideImageStyle,
  isSlideTextVolume,
  splitCsv,
} from "./slide-params";
import { isSlidePurpose, purposeDefaults } from "./slide-purpose";
import { normalizeTemplateId } from "./slide-templates";
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

/**
 * Diapazonning PASTKI chegarasi — post-render sahifa darvozasi uchun.
 *
 * `parsePages` o'rtachani beradi (narx va matn hajmi hisobi uchun mos),
 * lekin foydalanuvchiga «15–20 bet» deb va'da berilganda, u kamida 15
 * bet kutadi — 18 emas. Renderlangan PDF shu pastki chegara bilan
 * solishtiriladi.
 */
export function minPages(raw: string, fallback: number): number {
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return Math.max(1, Number(raw));
  const m = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return Math.max(1, Number(m[1]));
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
  /*
   * Standart hajm `lib/tools.ts` dan — narx bilan BIR XIL manbadan
   * (P1-7). Ilgari bu yerda o'z ro'yxati turar va maqola/tezis uchun
   * «10–15» berardi, narx esa «3–5» tarifidan hisoblanardi.
   */
  const fallbackLabel = defaultPages(tool.id);
  const pagesLabel = s(values, "pages", fallbackLabel);
  const fallbackPages = parsePages(fallbackLabel, 12);
  const quality = s(values, "quality", "standard");
  /*
   * Slaydlar soni: oddiy `slide` — paketdan (10/12/14/16), `pro-slide` —
   * slayderdan (4–30). Ikkalasi ham `targetPages` ga tushadi; narx
   * (`priceFor`) va byudjet (`budgetFor`) shu songa qaraydi.
   */
  const slidePages =
    tool.id === "pro-slide"
      ? clampInt(values.slideCount, PRO_SLIDE_MIN, PRO_SLIDE_MAX, PRO_SLIDE_DEFAULT)
      : quality === "premium_long" ? 16 : quality === "long" ? 14 : quality === "premium" ? 12 : 10;
  const authorParts = parseAuthorLine(s(values, "author", s(values, "fullName")));
  const themeRaw = s(values, "slideTheme", "atlas");
  const templateRaw = s(values, "slideTemplate", "auto");
  const purposeRaw = s(values, "slidePurpose", "general");
  const slidePurpose = isSlidePurpose(purposeRaw) ? purposeRaw : "general";
  /*
   * Bloklar: foydalanuvchi yuborgan bo'lsa u ustun (oq ro'yxat bilan),
   * yubormasa taqdimot turining standarti. Bo'sh satr ≠ yubormagan:
   * `blocks: ""` — ataylab hammasini o'chirgan.
   */
  const blocks: SlideBlockId[] =
    values.blocks === undefined || values.blocks === null
      ? purposeDefaults(slidePurpose).blocks
      : splitCsv(values.blocks, 12, 24).filter(isSlideBlockId);
  const textVolumeRaw = s(values, "textVolume", "standart");
  const imageStyleRaw = s(values, "slideImageStyle", "photo");
  const quizRaw = clampInt(values.quizCount, 0, 10, 0);
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
    pagesLabel: tool.id === "slide" || tool.id === "pro-slide" ? String(slidePages) : pagesLabel,
    targetPages: tool.id === "slide" || tool.id === "pro-slide" ? slidePages : parsePages(pagesLabel, fallbackPages),
    slideTheme: isSlideThemeId(themeRaw) ? themeRaw : "atlas",
    // Eski (olib tashlangan) id ham qabul qilinadi: `normalizeTemplateId`
    // uni o‘rnini bosgan shablonga yo‘naltiradi, «auto» ga tashlamaydi.
    slideTemplate: normalizeTemplateId(templateRaw),
    annotationLangs: s(values, "annotationLangs", "same") === "all" ? "all" : "same",
    email: s(values, "email"),
    organization: s(values, "organization", s(values, "university")),
    degree: s(values, "degree"),
    weeklyHours: Number(values.weeklyHours || 4),
    totalHours: Number(values.totalHours || 136),
    termCount: Math.max(6, Math.min(40, Number(values.termCount) || 10)),
    grade: Number(values.grade || 8),
    duration: Number(values.duration || 45),
    fileNameHint: topic.replace(/[^\p{L}\p{N}\- ]/gu, "").trim().slice(0, 60) || tool.slug,
    tocMethod: s(values, "tocMethod", "ai") === "manual" ? "manual" : "ai",
    tocText: s(values, "tocText"),
    includeVisuals: s(values, "images", "yes") !== "no",
    // Formada belgilanmagan bo'lsa titul slaydi qoladi (eski xatti-harakat).
    titleSlide: values.titleSlide !== false,
    premiumVisuals: quality === "premium" || quality === "premium_long",
    // Eski id lar (`school`, `defense`…) bazada qoladi — alias orqali yangi ro'yxatga.
    slideAudience: normalizeAudienceId(s(values, "slideAudience", "auto")),
    position: s(values, "position").replace(/\s+/g, " ").slice(0, 80),
    logoAssetId: /^[0-9a-f]{8,64}$/i.test(s(values, "logoAssetId")) ? s(values, "logoAssetId").toLowerCase() : "",
    slidePurpose,
    keyIdeas: splitCsv(values.keyIdeas, KEY_IDEAS_MAX, KEY_IDEA_CHARS),
    localExamples: values.localExamples === true,
    blocks,
    planItems: clampInt(values.planItems, PLAN_ITEMS_MIN, PLAN_ITEMS_MAX, PLAN_ITEMS_DEFAULT),
    // Formada belgilanmagan bo'lsa reja slaydi qoladi (eski xatti-harakat).
    agendaSlide: values.agendaSlide !== false,
    textVolume: isSlideTextVolume(textVolumeRaw) ? textVolumeRaw : "standart",
    // Faqat ruxsat etilgan sonlar (0/3/5/10) — oraliq qiymat eng yaqin pastkisiga.
    quizCount: [...QUIZ_COUNTS].reverse().find((n) => n <= quizRaw) ?? 0,
    internetSearch: values.internetSearch === true,
    speakerNotes: values.speakerNotes !== false,
    slideImageStyle: isSlideImageStyle(imageStyleRaw) ? imageStyleRaw : "photo",
    design: s(values, "design", "iris"),
    // Yil SHU YERDA muzlaydi — `title-model.ts` uni `doc.meta` dan oladi,
    // `new Date()` dan emas. Aks holda ekran va fayl yil chegarasida ajralardi.
    year: new Date().getFullYear(),
  };
}
