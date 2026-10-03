# Result page and viewers redesign — plan (2026-10-03)

Research: `R1-code-map.md` (code, root causes, seams) and `R2-visual-audit.md` (prod audit of 21 types × 3 sizes; screenshots kept outside the repo).
Problem: on 10 of 21 content types the document is partly or fully unreachable (listening/sorting 0 % at 1366 and mobile) because `ResultView` stacks the review panel (45vh) + game share panel (45vh) + viewer (`min-h-[70vh]`) inside `overflow-hidden` boxes; the page never scrolls, 2–3 nested scroll traps.

## Owner decisions
1. **Layout = content first + side panel.** Desktop (≥ 1280 px): content column on the left, a collapsible right panel (≈ 360–400 px) holding the report («Tayyorlik hisoboti»), game link/QR/results and other secondary blocks. Collapsed/open state remembered per browser (localStorage, safe wrapper). Header carries summary chips (e.g. «Tayyorlik 77 · 2 xato ›», «O'yin havolasi ›») that open/focus the panel. Below 1280 px: the panel is a bottom sheet / drawer opened from the same chips. Nothing secondary is ever stacked above the content.
2. **One page scroll.** No nested scroll traps; the end of every document is reachable; the viewer toolbar is sticky at the top of the content column.
3. **Default zoom = fit to width, max 125 %**, floor-snapped (never wider than the column), refits on container resize (ResizeObserver); on phones it fits the width (no 50 % floor overflow). Manual zoom stays.

## Viewer frame contract (V0 defines it, V1–V4 implement)
- `flow` viewers (paged documents: WordViewer, ResumeViewer, image/infographic, audio, translation): render inline in the page scroll; no inner `overflow-auto` scroller, no `min-h-[70vh]`/`h-full`; toolbar `position: sticky` under the result header. Page counter observes the page scroll (viewport root).
- `fill` viewers (slides): occupy exactly the remaining viewport height below the sticky header (`calc(100svh - header)`), own their stage, never pushed by panels.
- Panels are rendered by `ResultLayout`/panel dock, never by viewers.

## Must not change
Parity contract (`.word-sheet*`, `.word-inner`, measuring box, `packPages`, slide 1280×720 transform model, print rules), edit plumbing, `ensureGenerationFresh` before download, fix/polish flows, `publicGameKindOf`, lazy viewer chunks. Parity tests stay green unchanged. Tests that locked the old order (`tests/ui/result-flow`, order asserts in `tests/viewer/article-review-panel` and `tests/ui/game-share-panel`) are updated deliberately to assert the NEW contract (same strength).

## Work packages
| WP | Scope (files) | Model | Order |
|---|---|---|---|
| V0 | `components/files/ResultView.tsx` layout, new `components/files/ResultLayout.tsx` + panel dock/sheet + header chips, AppShell scroll chain if needed, the three order-locking tests, stale «Fayl yangilanmoqda…» check | opus | first |
| V1 | `WordViewer.tsx` shell, `sheet.tsx`, `toolbar.tsx`, `useVisiblePage.ts`, `lib/viewers/metrics.ts` fit, `ResumeViewer.tsx` shell (shared fit hook) | opus | after V0 |
| V2 | `SlideViewer.tsx`, `SlideStage.tsx`, `SlideRail.tsx`: fill mode, mobile toolbar overflow menu, correct zoom label, over-zoom scroll, touch image overlay | sonnet | after V0 |
| V3 | `ArticleReviewPanel.tsx`, `GameSharePanel.tsx`: compact summary API for chips, narrow side-panel layout, responsive results table | sonnet | after V0 |
| V4 | `ImageViewer.tsx`, `AudioViewer.tsx`, `TranslationViewer.tsx`: flow mode, touch-visible actions, poster/infographic viewing, translation mobile pairs | sonnet | after V0 |
| Gate | full regression, Chromium walk of all 21 types × 3 sizes (re-run R2 metrics: content % first viewport, end reachable), review, deploy | lead | last |
