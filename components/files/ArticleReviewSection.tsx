"use client";

import type { ComponentProps } from "react";
import { ArticleReviewPanel, ESSAY_HIDDEN_GROUPS } from "../viewers/ArticleReviewPanel";

/**
 * `ArticleReviewPanel` as `ResultView` mounts it, in the lazy result-panel
 * chunk (ops sprint WP-C, `./lazy-panels.tsx`). `ResultView` used to import
 * `ESSAY_HIDDEN_GROUPS` from the panel module, which kept the whole panel in
 * the result page's first load even for slides; it now passes a flag and the
 * group list stays in ONE place (`ArticleReviewPanel.tsx`).
 */
export function ArticleReviewSection({
  hideEssayGroups,
  ...props
}: Omit<ComponentProps<typeof ArticleReviewPanel>, "hideGroups"> & {
  /** Essay, game, poster and audio reports: no «Manbalar»/«Vizuallar» blocks. */
  hideEssayGroups: boolean;
}) {
  return <ArticleReviewPanel {...props} {...(hideEssayGroups ? { hideGroups: ESSAY_HIDDEN_GROUPS } : {})} />;
}
