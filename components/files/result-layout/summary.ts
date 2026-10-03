import type { ArticleReview } from "@/lib/generation/article/types";

export type ChipTone = "green" | "yellow" | "red" | "neutral";

/** Sarlavha chipi shakli — `ResultView` uni `PanelSection.chip/tone` ga xaritalaydi. */
export type ChipSummary = { label: string; tone: ChipTone };

/**
 * Sarlavha chipi uchun hisobot xulosasi: «Tayyorlik 77 · 2 xato · 3 e’tibor».
 *
 * Panel ichidagi sonlar bilan BIR XIL qoida (`ArticleReviewPanel`:
 * `red`/`yellow` barcha bandlardan). Rang — `scoreTone` chegaralari
 * (80/60), ya'ni chip va panel halqasi bir xil rangda. Shakl
 * (`{score, errors, warnings, label, tone}`) o'zgarmaydi: V0 testi uni
 * `deepEqual` bilan qulflaydi. Ball 0–100 ga qisiladi va butunlanadi
 * (buzuq/kasrli ball chipda «Tayyorlik NaN» bo'lmasin).
 */
export function reviewSummary(review: Pick<ArticleReview, "score" | "checks">): {
  score: number;
  errors: number;
  warnings: number;
  label: string;
  tone: ChipTone;
} {
  const checks = review.checks ?? [];
  const errors = checks.filter((c) => c.level === "red").length;
  const warnings = checks.filter((c) => c.level === "yellow").length;
  const score = Number.isFinite(review.score) ? Math.max(0, Math.min(100, Math.round(review.score))) : 0;
  const parts = [`Tayyorlik ${score}`];
  if (errors) parts.push(`${errors} xato`);
  if (warnings) parts.push(`${warnings} e’tibor`);
  const tone: ChipTone = score >= 80 ? "green" : score >= 60 ? "yellow" : "red";
  return { score, errors, warnings, label: parts.join(" · "), tone };
}

/** O'yin havolasi paneli (`GameSharePanel`) holati — `onSummary` qiymati. */
export type ShareSummary = ChipSummary & {
  /** Havola yaratilganmi (sessiya bor). */
  hasLink: boolean;
  /** Natijalar soni (serverning `total` i, bo'lmasa qatorlar soni); havola yo'q bo'lsa 0. */
  results: number;
};

/**
 * «O‘yin havolasi» chipi: havola yo'q — «O‘yin havolasi» (harakatga
 * chaqiruv, neytral); havola bor, natija yo'q — «… · natija yo‘q»;
 * natijalar bor — «… · 12 natija» (yashil: sinf o'ynagan).
 */
export function shareSummary(s: { hasLink: boolean; results: number }): ShareSummary {
  const results = Number.isFinite(s.results) && s.results > 0 ? Math.floor(s.results) : 0;
  if (!s.hasLink) return { hasLink: false, results: 0, label: "O‘yin havolasi", tone: "neutral" };
  if (!results) return { hasLink: true, results: 0, label: "O‘yin havolasi · natija yo‘q", tone: "neutral" };
  return { hasLink: true, results, label: `O‘yin havolasi · ${results.toLocaleString("uz-UZ")} natija`, tone: "green" };
}
