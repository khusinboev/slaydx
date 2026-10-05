"use client";

import { Component, Suspense, useCallback, useState, type ReactNode } from "react";
import { reloadOnceForChunkError } from "@/lib/chunk-reload";
import { resetViewerChunks, retryableLazy } from "../viewers/ViewerBoundary";

/*
 * Result-page side-panel blocks in their own chunks (ops sprint WP-C,
 * docs/ops/O4-frontend-speed.md §5 #10): the readiness report and the game
 * share panel are needed only for some results, and only in the panel next
 * to the viewer, so they no longer ride in `/uz/files/[id]`'s first load.
 * `retryableLazy` (the viewers' loader) lets «Qayta urinish» re-run a failed
 * `import()` instead of replaying the cached rejection.
 */
export const LazyArticleReviewSection = retryableLazy(() => import("./ArticleReviewSection").then((m) => ({ default: m.ArticleReviewSection })));
export const LazyGameSharePanel = retryableLazy(() => import("./GameSharePanel").then((m) => ({ default: m.GameSharePanel })));

class PanelBoundary extends Component<{ onRetry: () => void; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[result] panel bo‘lagi yuklanmadi", error);
    // Stale hashes after a deploy: one automatic full reload, as for the viewers (`ViewerBoundary`).
    reloadOnceForChunkError(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" data-panel-chunk-error className="flex flex-col items-start gap-2 py-1 text-xs">
        <p className="text-muted-foreground">Bo‘limni yuklab bo‘lmadi. Aloqani tekshirib, qayta urinib ko‘ring.</p>
        <button type="button" onClick={this.props.onRetry} className="bg-card inline-flex h-11 items-center rounded-lg border px-4 text-sm md:h-9">
          Qayta urinish
        </button>
      </div>
    );
  }
}

/**
 * Suspense + error boundary for one lazy panel block. A load failure stays
 * inside the block (the viewer and the rest of the page keep working);
 * «Qayta urinish» re-imports the chunk.
 */
export function PanelChunk({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    resetViewerChunks();
    setAttempt((a) => a + 1);
  }, []);
  return (
    <PanelBoundary key={attempt} onRetry={retry}>
      <Suspense
        fallback={
          <div role="status" aria-busy="true" data-panel-chunk-loading className="flex flex-col gap-2 py-1">
            <div aria-hidden className="bg-muted/60 h-4 w-2/3 animate-pulse rounded" />
            <div aria-hidden className="bg-muted/60 h-4 w-1/2 animate-pulse rounded" />
            <span className="sr-only">Yuklanmoqda...</span>
          </div>
        }
      >
        {children}
      </Suspense>
    </PanelBoundary>
  );
}
