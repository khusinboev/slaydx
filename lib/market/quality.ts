import { bodyWordCount, targetWords } from "../generation/quality";
import type { AcademicDoc } from "../generation/types";

/**
 * The candidate quality score (docs/market/PLAN.md §1.2): pure, 0–100, no LLM.
 *
 *   review     60  the document's own readiness report, when it has one
 *   volume     20  body words ≥ 0.9 × target (a deck: filled slides)
 *   structure  10  ≥ 3 sections / ≥ 6 slides, intro + conclusion where the genre has them
 *   images     10  every promised slide image delivered (decks that promised any)
 *
 * A part that does not apply to a document (no report on a deck, no images on a referat) leaves the sum and the total
 * is rescaled over the parts that do: otherwise a deck could never reach the 70-point default threshold.
 */

export type QualityPart = { name: "review" | "volume" | "structure" | "images"; weight: number; value: number };
export type QualityResult = { score: number; parts: QualityPart[] };

const WEIGHT = { review: 60, volume: 20, structure: 10, images: 10 } as const;

/** Word gate of the plan: at or above this share of the target earns the full volume part. */
const VOLUME_SHARE = 0.9;
const MIN_SECTIONS = 3;
const MIN_SLIDES = 6;

function reviewScore(doc: AcademicDoc): number | null {
  const score = doc.work?.review?.score ?? doc.essay?.review?.score ?? doc.teacher?.review?.score ?? doc.article?.review?.score;
  return typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function targetOf(doc: AcademicDoc): number {
  const essayAim = doc.essay?.words?.min;
  if (essayAim) return essayAim;
  return targetWords(doc.meta?.targetPages ?? 1);
}

function volumeScore(doc: AcademicDoc): number {
  const slides = doc.slides ?? [];
  if (slides.length) {
    const filled = slides.filter((s) => s.title?.trim() && (s.layout === "title" || s.layout === "section" || s.bullets?.length || s.left?.length || s.right?.length || s.stats?.length || s.steps?.length || s.table || s.quote || s.quiz?.length || s.refs?.length)).length;
    return Math.min(100, Math.round((filled / slides.length) * 100 / VOLUME_SHARE));
  }
  const target = targetOf(doc);
  return target ? Math.min(100, Math.round((bodyWordCount(doc) / (target * VOLUME_SHARE)) * 100)) : 0;
}

/** Student works open with «Kirish» and close with «Xulosa»: both are required of them, in any of the three languages. */
function hasBookends(doc: AcademicDoc): boolean {
  if (!doc.work) return true;
  if (doc.work.genre === "konspekt" || doc.work.genre === "essay") return true;
  const ids = doc.sections.map((s) => s.id);
  const titles = doc.sections.map((s) => s.title.toLowerCase());
  const has = (id: string, re: RegExp) => ids.includes(id) || titles.some((t) => re.test(t));
  return has("intro", /kirish|введение|introduction/) && has("conclusion", /xulosa|заключение|conclusion/);
}

function structureScore(doc: AcademicDoc): number {
  const slides = doc.slides?.length ?? 0;
  if (slides) return Math.min(100, Math.round((slides / MIN_SLIDES) * 100));
  const n = doc.sections?.length ?? 0;
  if (doc.essay) return n ? 100 : 0;
  const body = Math.min(100, Math.round((n / MIN_SECTIONS) * 100));
  return hasBookends(doc) ? body : Math.round(body / 2);
}

function imagesScore(doc: AcademicDoc): number | null {
  const report = doc.slideImages;
  if (!report || !report.want) return null;
  return report.got >= report.want ? 100 : Math.round((report.got / report.want) * 100);
}

export function marketQuality(doc: AcademicDoc): QualityResult {
  const parts: QualityPart[] = [];
  const review = reviewScore(doc);
  if (review !== null) parts.push({ name: "review", weight: WEIGHT.review, value: review });
  parts.push({ name: "volume", weight: WEIGHT.volume, value: volumeScore(doc) });
  parts.push({ name: "structure", weight: WEIGHT.structure, value: structureScore(doc) });
  const images = imagesScore(doc);
  if (images !== null) parts.push({ name: "images", weight: WEIGHT.images, value: images });
  const total = parts.reduce((n, p) => n + p.weight, 0);
  const sum = parts.reduce((n, p) => n + p.weight * p.value, 0);
  return { score: Math.round(sum / total), parts };
}
