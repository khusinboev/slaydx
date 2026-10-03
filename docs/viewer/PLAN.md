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

## Contract for V1–V4 (defined by V0, 2026-10-03)

### What V0 built
- **One page scroll.** `ResultView` renders inside `components/files/ResultLayout.tsx`. The page scrolls in AppShell `<main id="main">` (AppShell unchanged). No element between `<main>` and a viewer frame may set `overflow` (locked by `tests/ui/result-layout.test.mts` and `tests/ui/result-flow.test.mts`).
- **CSS variables** on `[data-result-layout]`:
  - `--app-topbar-h`: `3.5rem` (TopBar `h-14`).
  - `--result-header-h`: the sticky header height in px, measured by ResizeObserver and set with `style.setProperty`, so changes do not re-render the tree. It covers the header row, the transient notices and the chips row.
  - `--result-fill-h`: `calc(100svh - var(--app-topbar-h) - var(--result-header-h))`, the viewport height left under the header.
- **Sticky header** `[data-result-header]` uses `sticky top-0 z-20`. It holds the nav row (back, title, `EditActions`, download, PDF, delete), the transient notices (`[data-pdf-status]` and the error `role=alert`, so they stay visible at any scroll position) and the chips row `[data-result-chips]`.
- **Panel.** `ResultLayout` takes `sections: PanelSection[]` (`{ id, title, chip, tone?: "green"|"yellow"|"red"|"neutral", content }`). The panel element `[data-result-panel]` is rendered once and only its classes change between modes:
  - **≥ 1280 px:** `"dock"`, sticky at `top: var(--result-header-h)`, `max-height: var(--result-fill-h)`, 380 px wide. Its body `[data-panel-body]` is the only allowed secondary scroller.
  - **Below 1280 px:** `"sheet"`, a fixed bottom sheet up to 85svh. It uses `role=dialog` and `useDialog`, so it has a focus trap, closes on Escape and returns focus to the opener.
  - **Hooks:** sections are `[data-panel-section="review"|"share"]`, plus `[data-panel-chip=<id>]`, `[data-panel-toggle]` (xl only) and `[data-panel-close]`.
  - **State:** `[data-panel-open]` reports it. The dock is open by default and the choice is saved in `localStorage["slaydx:result-panel"]` (`"1"`/`"0"`, try/catch wrapper in `result-layout/prefs.ts`). The sheet is always closed on load.
- **Chips.** `result-layout/summary.ts` `reviewSummary(review)` builds «Tayyorlik 77 · 2 xato · 1 e’tibor». It uses the same red/yellow counting as the `ArticleReviewPanel` header, and the same 80/60 tone thresholds as `scoreTone`. The share chip reads «O‘yin havolasi».
- **Frame.** `components/files/result-layout/frame.ts`:
  - `VIEWER_FRAME[kind] = { mode: "flow" | "fill", boxed }`, with `frameClass(spec)`.
  - `ArtifactViewer` wraps every viewer, including the Suspense fallback, in `<div data-viewer-frame=<mode> data-viewer-kind=<kind> data-viewer-boxed?>`. `RunningPanel`'s live slide viewer uses the same `fill` frame.
  - **fill** (slides): `height: var(--result-fill-h)`, `min-h-80`, `flex flex-col`.
  - **flow, boxed:** the same fixed height. This is a temporary bridge so the current inner `Workspace` scroller keeps working with nothing clipped. It applies to academic, essay, article, teacher, game and resume.
  - **flow, not boxed:** `min-height: var(--result-fill-h)`, `flex flex-col`, auto height. It applies to image, audio and translation.
- **Delivered banner** (`[data-delivered]`): one compact line at the top of the content column that scrolls away with the page. It stays out of the panel because it describes the artifact itself.
- **«Fayl yangilanmoqda…» root cause.** Server AI edits (`POST …/rewrite`, `POST …/polish` via `commitDocOps`) bump `doc_version` but not the DOCX, because the article family rebuilds only through `POST …/rebuild`. Nothing calls the rebuild until download. `ResultView` showed the label whenever `fileVersion < docVersion`, so after any «Tuzatish»/«Hammasini tuzatish» it stayed up indefinitely. The fix is inside `ResultView`:
  - The label is shown only while a download/rebuild is actually running.
  - A stale file gets `data-file-stale` and the title «Fayl oxirgi tahrirlar bilan yangilanib yuklanadi».
  - The download still rebuilds first (`ensureGenerationFresh`).

### Required changes per WP
**V1 (WordViewer, ResumeViewer, sheet, toolbar, useVisiblePage, metrics)**
1. `WordViewer.tsx:476` root `flex h-full min-h-[70vh] flex-col` → `flex flex-col`. Remove `h-full` and `min-h-[70vh]`, because the min-height is what clipped the scroller.
2. `WordViewer.tsx:494` host `min-h-0 flex-1` plus `<Workspace className="h-full">` → no vertical scroller. In `sheet.tsx:32`, `Workspace` (`min-h-full overflow-auto h-full`) must not be `overflow-auto` in the result page.
   - Note that `overflow-x: auto` alone also makes the box a vertical scroll container (CSS overflow rule).
   - Keep pages inside the column with the floored fit. If a manual zoom wider than the column needs a horizontal scrollbar, put it on an inner row that does not affect vertical flow. Never put it on an ancestor of all pages.
3. `toolbar.tsx:40` `ViewerToolbar`: add `sticky top-[var(--result-header-h)] z-10`. It must stay below `z-20` (the result header).
4. `useVisiblePage.ts:30-39`:
   - Use the viewport as root (`root: null`).
   - Set `rootMargin` to `-<header>px 0px 0px 0px`. Read the header height from `getComputedStyle(el).getPropertyValue("--result-header-h")`.
5. Fit:
   - Run a ResizeObserver on the frame (`[data-viewer-frame]`) width, not `window.resize`.
   - Floor-snap the fit and cap it at 125 %. On phones, use a true fit with no 50 % floor.
6. `ResumeViewer.tsx:272` root: make the same change as item 1. At `:290`, apply the same `Workspace` rule and the shared fit hook.
7. When done, flip `boxed: false` on the lines for academic, essay, article, teacher, game and resume in `result-layout/frame.ts`. Each kind has its own line, to avoid merge conflicts. The flow frame then gives `min-height` only.
8. Keep `.word-sheet*`, the measuring box, `packPages` and the print rules. The print rules hide `.no-print`; the result header and panel are `no-print`.

**V2 (SlideViewer, SlideStage, SlideRail)**
1. The frame already gives a definite height, `var(--result-fill-h)`. The root `flex min-h-0 flex-1 flex-col` (`SlideViewer.tsx:420`) and the `ArtifactViewer` inner wrapper fill it. Do not add `min-h-[…vh]` or a page-level scroller.
2. Over-zoom scrolling belongs inside `SlideStage`, because a fill viewer owns its stage. The rail and strip scroll inside the frame.
3. Present/presenter mode is `fixed inset-0 z-50` (`:420`, `:637`). It is above the header (`z-20`) and the panel dock (`xl:z-10`). Slides have no panel sections today.
4. Keep the live → done sizing identical. `RunningPanel` uses `frameClass({ mode: "fill" })` with `data-viewer-frame="fill"`.

**V3 (ArticleReviewPanel, GameSharePanel)**
1. Both now render inside `[data-panel-section]` (p-3). That container is 380 px wide on xl (about 356 px of content) or a full-width sheet. Viewport breakpoints inside them are wrong there; use container queries (`@container` / `@md:`) or a single column.
   - `ArticleReviewPanel.tsx:259`, `sm:grid-cols-2 lg:grid-cols-3`: three columns of about 100 px. «Tuzatish» overlaps the label (smoke screenshot `article-1366-b-end.png`).
   - `GameSharePanel.tsx:204`, `sm:flex-row`: the QR and link go side by side and squeeze the link field to about 40 px (`listening-1920`).
   - `GameSharePanel.tsx:304`, results table `min-w-[420px]`: it scrolls sideways inside the panel. Make it responsive.
2. Do not add `max-h`/`overflow` inside the panels. `[data-panel-body]` is the single scroller.
3. Summary API: replace or absorb `result-layout/summary.ts` `reviewSummary`, keeping the `{ label, tone }` shape that `ResultView` maps to `PanelSection.chip/tone`.
   - Optionally add a share summary, such as a results-count badge. It needs either a callback (`onSummary`) from `GameSharePanel` or a light fetch; `ResultView` passes the chip text.
4. The panel header already shows the section title(s). A compact mode may drop the duplicated inner «Tayyorlik hisoboti» / «O‘yin havolasi» headings.
5. Keep `noFix`/`noPolish`/`hideGroups`, the `data-article-review-panel` wrapper, `data-ai-unpaid`, `data-essay-nofix-note` and `<GameSharePanel id={gen.id} kind={shareKind} />` as they are (source-locked).

**V4 (ImageViewer, AudioViewer, TranslationViewer)**
1. `ImageViewer.tsx:41`, the root `flex min-h-0 flex-1 flex-col`, and `:47`, the inner `min-h-0 flex-1 overflow-auto`:
   - In the flow frame the inner box grows to its content, so it never scrolls today. Remove the `overflow-auto` and make it explicit flow.
   - Make the 40 px header `sticky top-[var(--result-header-h)]`.
   - The lightbox (`:100`, `fixed z-50`) is fine.
2. `AudioViewer.tsx:28` root and `:49` transcript (`overflow-auto`): apply the same flow change. The player block may be sticky under the header.
3. `ArtifactViewer` `case "audio"` / `case "image"` inner wrappers (`flex min-h-0 flex-1 flex-col`) may be dropped. Keep the `gen={{ id: gen.id, … }}` prop (locked by `tests/viewer-kind.test.mts`).
4. `TranslationViewer.tsx:54`: the comment references `data-result-flow`, which is removed. The markers are now `[data-viewer-frame="flow"][data-viewer-kind="translation"]`.
   - The PDF iframe `h-[calc(100vh-4.5rem)]` (`:187`) should become `h-[var(--result-fill-h)]`.
   - When V4 makes that change, update `tests/ui/result-flow.test.mts` test 3 deliberately; it locks the old class.

### Smoke hooks (Gate)
- `[data-result-layout][data-result-frame]`, `[data-result-header]`, `[data-result-content]`, `[data-viewer-frame][data-viewer-kind][data-viewer-boxed]`
- `[data-result-panel=dock|sheet][data-panel-open]`, `[data-panel-section]`, `[data-panel-chip]`, `[data-panel-toggle]`, `[data-panel-close]`, `[data-panel-body]`
- `[data-delivered]`, `[data-file-stale]`

### V2 result (slide, pro-slide) — decisions
- **Navigation:** the toolbar holds the only page navigation (prev, «n / N», next) and the only full-screen button. The bottom bar is status only (Saqlanmoqda / Fayl yangilanmoqda / error / topic). Keyboard arrows stay.
- **Toolbar:** `SlideToolbar.tsx` replaces `ViewerToolbar` for slides, because `ViewerToolbar` takes the zoom label from `ZOOM_STEPS` and knows nothing about fit. The label is the measured fit percentage (`SlideStage.onFitScale`), «Moslash» is an `aria-pressed` toggle, ± step from the current percentage through `SLIDE_ZOOM_STEPS` (25…200). No toolbar.tsx change needed.
- **Over-zoom:** `SlideStage` is the scroller (`overflow-auto`, both axes) only when fit is off; the slide frame is `m-auto shrink-0`, not `justify-center`, so the left/top edge stays reachable. Fit mode is `overflow-hidden` and centred. Present mode keeps its old classes and fit calculation.
- **Mobile (< md):** secondary actions (delete slide, template name, legacy note) live in the «Boshqa amallar» menu (`aria-haspopup=menu`, focus on first item, ↑/↓, Escape returns focus, outside tap closes). In fit mode the stage is `aspect-video` (sized by width, 8 px padding) and `SlideRail variant="strip"` becomes a 3/4-column thumbnail grid filling the rest of the frame (`data-strip-layout="grid"`); with manual zoom the stage takes the frame and the strip is the old one-row strip (`"row"`).
- **Touch image buttons:** `SlideEditor` marks the image control layer `data-slide-image-controls` (only change in that file). On `@media (hover: none)` it is hidden until a non-mouse pointerdown lands on the slide (`data-touch-sel` on the frame); it resets on slide change or when the empty stage is tapped. Desktop is unchanged.
- **Smoke hooks:** `[data-slide-toolbar]`, `[data-slide-stage=fit|zoom|present]`, `[data-zoom-label][data-zoom-mode]`, `[data-zoom-fit]`, `[data-slide-page]`, `[data-slide-more]`, `[data-slide-more-panel]`, `[data-rail=strip][data-strip-layout]`.
