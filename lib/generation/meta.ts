import type { FormValues, ToolConfig } from "../types";
import { isSlideTemplateId } from "./slide-templates";
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

/** Manba matni promptga to‘liq ketmasin — token narxi va limit uchun. */
export const SOURCE_TEXT_LIMIT = 24_000;

export function extractMeta(tool: ToolConfig, values: FormValues): DocMeta {
  const topic = s(values, "topic", s(values, "subject", s(values, "targetRole", tool.title)));
  const pagesLabel = s(values, "pages", tool.id === "essay" ? "2" : tool.id === "coursework" ? "20-25" : "10-15");
  const fallbackPages =
    tool.id === "essay" ? 2 : tool.id === "coursework" ? 22 : tool.id === "article" || tool.id === "thesis" ? 6 : 12;
  const quality = s(values, "quality", "standard");
  const slidePages =
    quality === "premium_long" ? 16 : quality === "long" ? 14 : quality === "premium" ? 12 : 10;
  const themeRaw = s(values, "slideTheme", "atlas");
  const templateRaw = s(values, "slideTemplate", "auto");
  return {
    toolId: tool.id,
    workLabel: tool.title,
    topic,
    language: s(values, "language", "uz"),
    extra: s(values, "extra"),
    sourceText: s(values, "sourceText").slice(0, SOURCE_TEXT_LIMIT),
    author: s(values, "author", s(values, "fullName")),
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
    group: s(values, "group"),
    course: s(values, "course"),
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
    design: s(values, "design", "iris"),
  };
}
