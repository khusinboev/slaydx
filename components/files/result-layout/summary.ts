import type { ArticleReview } from "@/lib/generation/article/types";

export type ChipTone = "green" | "yellow" | "red" | "neutral";

/**
 * Sarlavha chipi uchun hisobot xulosasi: «Tayyorlik 77 · 2 xato · 3 e’tibor».
 *
 * Panel ichidagi sonlar bilan BIR XIL qoida (`ArticleReviewPanel`:
 * `red`/`yellow` barcha bandlardan). Rang — `scoreTone` chegaralari
 * (80/60), ya'ni chip va panel halqasi bir xil rangda. V3 panelning
 * o'zidan ixcham xulosa API berganda shu funksiya o'shanga ulanadi.
 */
export function reviewSummary(review: Pick<ArticleReview, "score" | "checks">): {
  score: number;
  errors: number;
  warnings: number;
  label: string;
  tone: ChipTone;
} {
  const errors = review.checks.filter((c) => c.level === "red").length;
  const warnings = review.checks.filter((c) => c.level === "yellow").length;
  const parts = [`Tayyorlik ${review.score}`];
  if (errors) parts.push(`${errors} xato`);
  if (warnings) parts.push(`${warnings} e’tibor`);
  const tone: ChipTone = review.score >= 80 ? "green" : review.score >= 60 ? "yellow" : "red";
  return { score: review.score, errors, warnings, label: parts.join(" · "), tone };
}
