"use client";

import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";

/**
 * Studio layout «Ish stoli» (docs/studio/P11-SPEC.md §D, variant A): the settings on the left, the results on the right,
 * on EVERY tab. From `md` (768 px) two columns — the form in a 22 rem column, the results beside it; below that one
 * column with the form first, the sticky price button, and the results under it. The phone scrolls to the results after
 * a submit (`useResultsScroll`); the two-column layout never needs to, the results are already on screen. On the phone
 * the column is at least a screen tall: a short card at the page's end could not reach the top otherwise, and the scroll
 * would stop with the result below the fold when the card grows.
 */

/** The media query of the two-column layout (the `md:` breakpoint). */
export const WORKBENCH_MEDIA = "(min-width: 768px)";

/** `true` while the layout shows two columns (client only; `false` where `matchMedia` does not exist, e.g. jsdom). */
export function twoColumns(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WORKBENCH_MEDIA).matches;
}

/**
 * The results column's ref and the «scroll to it» a tab calls once its job is queued: one column → the results come into
 * view; two columns → nothing (they are beside the form). The scroll runs after the commit that draws the new job: before
 * it the column is empty at the very end of the page, the browser clamps there, and the card lands below the fold.
 */
export function useResultsScroll(): { resultsRef: RefObject<HTMLElement | null>; scrollToResults: () => void } {
  const resultsRef = useRef<HTMLElement>(null);
  const pending = useRef(false);
  const scrollToResults = useCallback(() => {
    pending.current = !twoColumns();
  }, []);
  // Every render: a queued job always renders its tab (the job list, the submit flag); this runs after that commit.
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  });
  return { resultsRef, scrollToResults };
}

export function StudioWorkbench({
  form,
  results,
  resultsRef,
  hasResults,
  empty,
  label = "Natijalar",
}: {
  /** The left column: the tab's form, its own price button included. */
  form: ReactNode;
  /** The right column: the tab's results list (the running job on top, the recent work under it). */
  results: ReactNode;
  resultsRef?: RefObject<HTMLElement | null>;
  /** With no job to show the column says what goes there (two columns only; the phone shows nothing below the button). */
  hasResults: boolean;
  empty: string;
  label?: string;
}) {
  return (
    <div data-studio-workbench className="md:grid md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start md:gap-6">
      <div data-studio-form className="min-w-0">
        {form}
      </div>
      <section ref={resultsRef} aria-label={label} data-studio-pane="results" className={cn("min-w-0 scroll-mt-20 md:mt-0", hasResults && "mt-5 max-md:min-h-[calc(100svh-5rem)]")}>
        {hasResults ? (
          <>
            <h2 className="text-muted-foreground mb-2 hidden text-[13px] font-semibold tracking-[0.06em] uppercase md:block" data-studio-pane-title>
              {label}
            </h2>
            {results}
          </>
        ) : (
          <p className="text-muted-foreground bg-card hidden rounded-[20px] border p-6 text-center text-[14.5px] md:block" data-studio-empty>
            {empty}
          </p>
        )}
      </section>
    </div>
  );
}
