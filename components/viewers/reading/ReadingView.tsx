"use client";

import type { CSSProperties, ReactNode } from "react";
import type { TitleModel } from "@/lib/viewers/flow";
import { cn } from "@/lib/cn";
import { TitlePage } from "../TitlePage";

/**
 * «O‘qish» (reading mode) styles, scoped to `.reading-shell .reading-doc`.
 *
 * The content itself comes from the SAME block renderers as the sheets
 * (`WordViewer` `PageBody`/`FlowBlock`, `TitlePage`); only the measures
 * change here: text flows to the screen width at a legible size, headings
 * get a size step, tables scroll inside their own block, images and
 * formulas fit the width. The sheet path (`.word-sheet`, `.word-inner`,
 * the measuring box) never sees these rules: every selector needs the
 * reading wrapper. The `.reading-shell` prefix out-ranks the sheet's
 * `.word-article .word-*` rules (0,2,0).
 *
 * Rendered as a React 19 hoisted `<style>` (deduped by `href`), so it costs
 * nothing until reading mode is used and needs no global CSS change.
 */
export const READING_CSS = `
.reading-shell .reading-doc{font-family:var(--font-doc);font-size:17px;line-height:1.6;overflow-wrap:break-word;text-indent:0}
.reading-shell .reading-doc .word-p{margin:0 0 .8em;text-align:left;text-indent:1.5em}
.reading-shell .reading-doc .word-h1{font-size:1.3em;line-height:1.3;margin:1.6em 0 .7em;text-indent:0}
.reading-shell .reading-doc .word-h2{font-size:1.15em;line-height:1.35;margin:1.3em 0 .5em;text-indent:0}
.reading-shell .reading-doc .word-h3{font-size:1.05em;line-height:1.4;margin:1.1em 0 .4em}
.reading-shell .reading-doc .word-li{margin:0 0 .4em .25em}
.reading-shell .reading-doc .word-quote{margin:0 0 .8em 1em}
.reading-shell .reading-doc .word-ref{margin:0 0 .5em;text-align:left;font-size:.94em;line-height:1.5;overflow-wrap:anywhere}
.reading-shell .reading-doc .word-ref--hanging{padding-left:1.5em;text-indent:-1.5em}
.reading-shell .reading-doc :is(.word-udk,.word-author-aff,.word-abstract-p,.word-highlight,.word-figure-source){font-size:.92em}
.reading-shell .reading-doc .word-abstract-p{line-height:1.55}
.reading-shell .reading-doc .word-table-caption{margin:1em 0 .4em}
.reading-shell .reading-doc .word-table{width:100%;margin:0;font-size:15px;line-height:1.45}
.reading-shell .reading-doc .word-table :is(th,td){padding:6px 8px}
.reading-shell .reading-doc .reading-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;margin:.4em 0 1.1em}
.reading-shell .reading-doc .reading-scroll:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.reading-shell .reading-doc .reading-scroll--cols>table{min-width:max(100%,calc(var(--reading-cols,1) * 7.5rem))}
.reading-shell .reading-doc .word-figure{margin:1em 0 1.2em}
.reading-shell .reading-doc .word-figure-img{max-width:100%;height:auto;max-height:80vh}
.reading-shell .reading-doc .word-formula{grid-template-columns:minmax(0,1fr) auto;column-gap:.75em}
.reading-shell .reading-doc .word-formula-body{grid-column:1;min-width:0;overflow-x:auto;overflow-y:hidden;text-align:center}
.reading-shell .reading-doc .word-formula-num{grid-column:2}
.reading-shell .reading-doc pre{max-width:100%}
.reading-shell .reading-doc .reading-title{margin:0 0 2em;padding-bottom:1.5em;border-bottom:1px solid var(--border)}
.reading-shell .reading-doc .reading-title .word-inner{height:auto;min-height:min(34rem,80svh);padding:1.5em .25em;font-size:16px}
.dark .reading-shell .reading-doc .word-table :is(th,td){border-color:color-mix(in srgb,currentColor 45%,transparent)}
.dark .reading-shell .reading-doc .word-figure-img{background:#fff;border-radius:4px}
.dark .reading-shell .reading-doc .word-figure-placeholder{color:var(--muted-foreground)}
.dark .reading-shell .reading-doc pre{background:#26221c;border-color:#3a3126}
.dark .reading-shell .reading-doc .reading-paper{background:#fff;color:#111;border-radius:6px;padding:8px}
.dark .reading-shell .reading-doc .reading-title .border-black\\/60{border-color:currentColor;opacity:.6}
`;

/**
 * Sheet measures that do not apply to a reflowed page: margins (padding),
 * the profile's font size and line height. The profile's CSS variables
 * (`--doc-h1-align`, `--doc-small`, …) stay, so headings keep the file's
 * alignment and case.
 */
export function readingVars(style: CSSProperties | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose.
  const { padding, fontSize, lineHeight, ...vars } = style;
  return vars;
}

/**
 * Reading-mode shell: a themed surface with one readable column.
 * `no-print`: printing always uses the sheets («Varaq»), which stay mounted
 * (hidden on screen) while reading.
 */
export function ReadingView({
  article = false,
  sheetStyle,
  children,
}: {
  /** Profiled sheet (`.word-article`): headings keep the file's case/alignment rules. */
  article?: boolean;
  /** The sheet's inline style (`articleSheet`/`workSheet`/…); only its CSS variables are used. */
  sheetStyle?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div data-reading-view className="reading-shell no-print grow bg-[#e9e5de] sm:px-6 sm:py-8 dark:bg-[#0d0b0e]">
      <style href="slaydx-reading-mode" precedence="default">
        {READING_CSS}
      </style>
      <article
        className={cn(
          "reading-doc mx-auto max-w-[44rem] bg-card px-4 py-6 text-card-foreground sm:rounded-lg sm:px-10 sm:py-10 sm:shadow-md",
          article && "word-article",
        )}
        style={readingVars(sheetStyle)}
      >
        {children}
      </article>
    </div>
  );
}

/** The title page from the same `titleModel` as the sheet (`TitlePage`), as a cover block. */
export function ReadingTitle({ title }: { title: TitleModel }) {
  return (
    <div data-reading-title className="reading-title">
      <TitlePage title={title} />
    </div>
  );
}

/**
 * Horizontal scroll block for a table (or a printed card grid): wide tables
 * scroll inside it and never widen the page. `cols` gives the table a
 * minimum width per column (7.5rem), so a 6-column texnologik xarita stays
 * readable instead of being squeezed to the phone width. `paper` keeps a
 * white sheet under fixed-colour print content (game cards) in dark mode.
 * Focusable (`tabIndex=0`) so keyboard users can scroll it.
 */
export function ReadingScroll({ cols, paper = false, children }: { cols?: number; paper?: boolean; children: ReactNode }) {
  return (
    <div
      data-reading-scroll
      role="region"
      aria-label="Jadval"
      tabIndex={0}
      className={cn("reading-scroll", Boolean(cols) && "reading-scroll--cols", paper && "reading-paper")}
      style={cols ? ({ "--reading-cols": cols } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
