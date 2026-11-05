import type { AcademicDoc } from "../generation/types";
import { TOOL_BY_ID } from "../tools";
import type { ToolId } from "../types";
import { cyrillicShare } from "./normalize";
import type { MarketParams } from "./params";
import type { MarketLevel } from "./types";

/**
 * The facts of a listing derived from a document (docs/market/PLAN.md §1.2): level, language, outline, summary and the
 * text behind the near-duplicate hash. Pure. The outline and the summary are public, so they hold headings only: not one
 * sentence of the body (M15, `tests/viewer/market-ssr-leak.test.mts`).
 */

export const TITLE_MAX = 160;
export const SUMMARY_MAX = 400;
const OUTLINE_MAX = 40;
const OUTLINE_ITEM_MAX = 120;
/** Script share above which an Uzbek document is shown as «Kirill» (§9). */
const CYRILLIC_SHARE = 0.6;

const clip = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/**
 * `school_*` audiences and school-grade teacher documents are «maktab»; a title page naming a college or a lyceum is
 * «kollej»; everything else defaults to «otm». Must run on the RAW document: the sanitised one has no institution.
 */
export function marketLevelOf(doc: AcademicDoc): MarketLevel {
  const school = doc.teacher?.school;
  if (school) return school.grade > 0 ? "maktab" : "otm";
  if (doc.essay) return doc.essay.context === "school_dtm" ? "maktab" : "otm";
  if (doc.meta.slideAudience?.startsWith("school_")) return "maktab";
  const institution = `${doc.work?.university ?? ""} ${doc.meta.university ?? ""}`.toLowerCase();
  if (/kollej|texnikum|litsey|колледж|техникум|лицей|коллеж/.test(institution)) return "kollej";
  if (doc.meta.ministry === "maktab" || /maktab|мактаб|школ/.test(institution)) return "maktab";
  return "otm";
}

/** The document's language; an Uzbek text mostly in Cyrillic letters is `uz-cyr`. */
export function marketLanguageOf(doc: AcademicDoc): string {
  const lang = doc.meta.language || "uz";
  if (!lang.startsWith("uz")) return lang;
  return cyrillicShare(bodyTextOf(doc).slice(0, 20_000)) >= CYRILLIC_SHARE ? "uz-cyr" : "uz";
}

/** Headings of the document: section titles, slide titles of a deck. */
export function outlineOf(doc: AcademicDoc): string[] {
  const slides = doc.slides ?? [];
  const raw = slides.length
    ? slides.filter((s) => s.layout !== "title" && s.layout !== "closing").map((s) => s.title)
    : (doc.sections ?? []).map((s) => s.title);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const title = clip(t ?? "", OUTLINE_ITEM_MAX);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
    if (out.length >= OUTLINE_MAX) break;
  }
  return out;
}

/** The text compared for near duplicates (and for the language share). */
export function bodyTextOf(doc: AcademicDoc): string {
  const parts: string[] = [];
  for (const s of doc.slides ?? []) {
    parts.push(s.title, ...(s.bullets ?? []), ...(s.left ?? []), ...(s.right ?? []), s.quote ?? "", ...(s.steps ?? []).map((x) => x.text));
  }
  for (const s of doc.sections ?? []) for (const b of s.blocks ?? []) if (b.kind === "p" || b.kind === "li" || b.kind === "quote") parts.push(b.text);
  return parts.filter(Boolean).join(" ");
}

/** A template over public facts, never a body sentence; the admin rewrites it at approval when he wants to. */
export function summaryOf(toolId: ToolId, title: string, outline: readonly string[], params: MarketParams): string {
  const tool = TOOL_BY_ID[toolId]?.title ?? toolId;
  const size = params.slideCount ? `${params.slideCount} slayd` : params.pages ? `${params.pages} bet` : "";
  const head = [tool, size].filter(Boolean).join(", ");
  const parts = outline.slice(0, 4).join("; ");
  return clip(`${head}: «${title}».${parts ? ` Bo'limlar: ${parts}.` : ""}`, SUMMARY_MAX);
}

export const marketTitleOf = (topic: string): string => clip(topic, TITLE_MAX);
