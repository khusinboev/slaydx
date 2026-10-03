# R1: code map of the result page and its viewers (branch feat/viewer-redesign = main)

Paths are worktree-relative. RV = `components/files/ResultView.tsx`, WV = `components/viewers/WordViewer.tsx`.

## 1. Result page architecture and the scroll chain

**Route:** `app/uz/files/[id]/page.tsx:3-5` → `<ResultView id/>`, inside `<AppShell>` (`app/uz/layout.tsx:3-4`).

**Height and overflow chain, outer to inner** (non-translation, COMPLETED):

| # | Element | Classes | Effect |
|---|---|---|---|
| 1 | AppShell root `components/shell/AppShell.tsx:37` | `flex h-svh overflow-hidden` | Viewport-locked, never scrolls |
| 2 | Content column `AppShell.tsx:58` | `flex-1 flex-col overflow-hidden` | |
| 3 | TopBar `components/shell/TopBar.tsx:30` | `h-14 shrink-0` | 56 px |
| 4 | `<main>` `AppShell.tsx:61` | `flex min-h-0 flex-1 flex-col overflow-y-auto` | Could scroll, but see 5 |
| 5 | RV root `RV:425` | `flex h-full min-h-0 flex-1 flex-col` + **`overflow-hidden`** (`overflow-y-auto` only when `flow` = translation, `RV:342`) | Page scroll is killed here |
| 6 | Header nav `RV:426-430` | `sticky top-0` (meaningless, since 5 does not scroll) | About 53 px: back, title, EditActions, download, PDF, delete |
| 7 | Completed wrapper `RV:588` | `flex flex-col min-h-0 flex-1` + **`overflow-hidden`** | Clips everything below the fold |
| 8 | delivered banner `RV:597` | plain `<p>` | |
| 9 | **Review** `<details open>` `RV:637` | `max-h-[45vh] shrink-0 overflow-y-auto` | Own scrollbar, open by default |
| 10 | **GameSharePanel** wrapper `RV:672` | `max-h-[45vh] shrink-0 overflow-y-auto` | Own scrollbar: link, QR 168 px, results table |
| 11 | `ArtifactViewer` `components/viewers/ArtifactViewer.tsx:50` | Suspense → per-kind wrapper (`flex min-h-0 flex-1 flex-col` for slides/audio/image) | |
| 12 | WV root `WV:476` | `flex h-full` + **`min-h-[70vh]`** `flex-col` | Refuses to shrink below 70vh |
| 13 | ViewerToolbar `components/viewers/toolbar.tsx:40` | `h-10 shrink-0` | Shows "1 / 2 · 150%" |
| 14 | host `WV:494` → `Workspace` `components/viewers/sheet.tsx:32` | `min-h-0 flex-1` → `viewer-workspace min-h-full overflow-auto h-full` | **Real** scroll container for the pages |
| 15 | `ZoomFrame` `sheet.tsx:18-21` | width/height × zoom, `transform: scale` | |

**Why only the toolbar shows at the bottom (listening game, 1920×1080, ≈950 px usable).**

- TopBar 56 + nav 53 + review ≤45vh (≈430) + share ≤45vh (≈430) ≈ 970 px: the screen is full before the viewer starts.
- The WV root's `min-h-[70vh]` (≈670 px) stops it shrinking, so it overflows the `overflow-hidden` wrapper 7 and is clipped. Only the 40 px toolbar is visible; the Workspace holding the pages is entirely below the clip.
- The wheel never reaches the pages: over the panels it scrolls their own `overflow-y-auto` (three nested scroll areas), and `<main>` cannot scroll because 5 and 7 are `overflow-hidden`.
- With one panel only (article, work, teacher): 56+53+430+670 > 950. The bottom ≈250 px of the Workspace is unreachable, and `useVisiblePage` (`components/viewers/useVisiblePage.ts:30-39`, IntersectionObserver on the clipped root) misreports the page.
- Zoom: `fit()` (`WV:315-323`) is **fit-width** `(w-32)/sheetW`, clamped to [50,150] and snapped to `ZOOM_STEPS` (`lib/viewers/metrics.ts`). On a 1664 px column it is always 150 % (a 1191×1684 px page). It refits only on `window.resize` (`WV:325-330`).
- `RV:618-620` shows the caps were deliberate; together they exceed 100 %.

## 2. Viewer inventory

The choice is made by `lib/viewers/kind.ts:46-92` `viewerKind(toolId)` and `ArtifactViewer.tsx:69-150` `viewerFor`. Panels come from `RV:368-422`:

- `review` = first of `doc.{article,essay,work,teacher,game,infographic,audio}.review`.
- `noFix` = essay | poster | audio; `noPolish` = audio; `hideGroups` = essay, game, poster, audio.
- `shareKind` = `publicGameKindOf` (`lib/game/public.ts:47-51`): test→quiz, crossword, flashcards, sorting, listening.

The header (`RV:446-525`) is the same for every tool:

- Download (`gen.format`; "Fayl yangilanmoqda…" when `fileStale`; `ensureGenerationFresh` runs first, `RV:136-170`).
- PDF only for docx/pptx when `features.pdf` (`RV:480`, `PDF_CONVERTIBLE` `RV:766`).
- Delete with two-step confirm.
- `EditActions` («Asliga qaytarish», «Saqlash · N»), shown only when the viewer reports an edit state.

| Tool id(s) | Kind → viewer | Toolbar / sizing | Extra panels on result page | Editing |
|---|---|---|---|---|
| slide, pro-slide | slides → `SlideViewer.tsx` (+`SlideStage`, `SlideRail`, `SlideCanvas`, `SlideEditor`) | ViewerToolbar `SlideViewer.tsx:439` (page, zoom, fullscreen, template label, delete-slide); duplicate bottom nav bar `:596`. `zoom` state 75 but `fitOn` true (`:100-101`), so the label says "75%" while the real scale is `fitScale` (`SlideStage.tsx:77-91`, ResizeObserver, contain-fit, min 0.18). Present/presenter mode `fixed inset-0` (`:420`, `:637`) | delivered (images), no review/share | `useSlideEdit`, always on (overlay via `SlideStage` slot `:133`) |
| resume | resume → `ResumeViewer.tsx` (`resume/ResumePage.tsx`) | ViewerToolbar `:273`, right side: template/palette selects, photo, undo/redo, «Tahrirlash». **Fixed 100 %, no auto-fit** (`:75`, `onFit` = 100 `:279`). Workspace **without `h-full`/flex-1 host** (`:290`), root `min-h-[70vh]` `:272` | none | `useResumeEdit` |
| article, thesis | article → WV (`ArticleHead`, `ArticleEditor`) | WV toolbar, fit-width ≤150 | **review** (fix + polish) | `useArticleEdit` |
| essay | essay → WV (frame `word-sheet--framed`) | same | review (no Fix, note `RV:645`) | `useArticleEdit` |
| coursework, referat, mustaqil-ish | academic (default) → WV, `TitlePage` | same | review (`doc.work`) | `useWorkEdit` |
| lesson-plan, texnologik-xarita (landscape `word-sheet-ls`), glossary, keys, test | teacher → WV (`teacherFlow`) | same; fit uses landscape width | review (`doc.teacher`), **test: + share (quiz)** | `useTeacherEdit` |
| crossword, flashcards, sorting, listening | game → WV (`gameFlow`, printable sheet; interactive play only at `app/o/[token]`) | same | review (`doc.game`, Fix allowed) **+ GameSharePanel** (link, QR, expiry, results table, `components/files/GameSharePanel.tsx:167-340`) | none |
| image | image → `ImageViewer.tsx` | own 40 px header `:41`, own scroll `:47`, 1–2 col grid, hover-only actions `:67`, lightbox `fixed` `:100` | delivered | none |
| infographic | image → ImageViewer (poster) | same | review (`doc.infographic`, no Fix) | none |
| podcast, greeting (`tts/audio`) | audio → `AudioViewer.tsx` | header with `<audio>` + **its own MP3 download** `:36-45`, transcript scroll `:49` | review (no Fix/Polish) | none (deliberately) |
| translation | translation → `TranslationViewer.tsx` | **flow mode**: page scrolls; header chips + warnings/glossary `<details>` `:90-120`; tabs «Taqqoslash»/«Fayl» `:63`; pairs 2-col grid `:136`; PDF iframe `h-[calc(100vh-4.5rem)]` `:187`; legacy → WV `:51` | none | none |

Running: `RunningPanel` (`RV:701-758`), live `SlideViewer` or progress card. FAILED/expired/purged: cards (`RV:550-586`).

## 3. Shared code vs duplication; tests that lock behaviour

**Shared:** `ViewerToolbar` (WV, Resume, Slides; Image/Audio/Translation have none), `Workspace`/`ZoomFrame` (`sheet.tsx`: WV, Resume, TitlePage), `useVisiblePage` (WV, Resume), constants in `lib/viewers/metrics.ts`.

**Duplicated:** zoom/fit ×3 (WV fit-width `:315`, Resume fixed 100, Slides contain-fit); undo/redo/«Tahrirlash» and the edit error bar ×2 (WV `:443-460`/`:487`, Resume `:240-268`/`:283`); downloads ×4 (RV header, Audio, Image per image + lightbox, translation pane); slide page navigation ×2; one 45vh cap per panel in RV, with no panel abstraction.

**Source-text locks a redesign will trip.** These must be updated deliberately, with owner sign-off:

- `tests/ui/result-flow.test.mts:15-21`: regexes on `flow ? "overflow-y-auto" : "overflow-hidden"`, `flow ? "shrink-0" : "sticky top-0"`, `data-result-flow`. Also `:40-44`: iframe `h-[calc(100vh-4.5rem)]`, no `data-translation-scroll`.
- `tests/viewer/article-review-panel.test.mts:~175-225`: `<details open[^>]*data-article-review-panel`, the noFix/noPolish/hideGroups/isGame/isPoster/isAudio lines, and **`indexOf("data-article-review-panel") < indexOf("<ArtifactViewer")` ("panel before viewer")**.
- `tests/ui/game-share-panel.test.mts:~273-288`: the `shareKind` line, `<GameSharePanel id={gen.id} kind={shareKind} />`, and **"share panel before `<ArtifactViewer`, after ArticleReviewPanel"**.
- `tests/edit-reconcile.test.mts:134`: `withReconcile(...)` calls in RV.
- `tests/viewer-kind.test.mts:70-143`, `tests/viewer/essay-viewer.test.mts:107`, `work-legacy.test.mts:127`: ArtifactViewer edit-prop wiring.
- `tests/viewer/translation-viewer.test.mts:58-59`: no inner scroll and no `h-full` on the translation root.

**Parity tests (must stay green and unchanged in meaning):**

- `tests/viewer/{parity,logo-parity,quiz-parity,live}`: `SlideCanvas` vs PPTX. `{article,work,teacher,game,resume}-parity`: WV/`TitlePage`/`ResumePage` vs DOCX (sheet margins/font at `article-parity:173`, `work-parity:219`). Plus `*-legacy`, `slide-edit-ssr`, `audio-viewer`, `article-viewer`, `file-preview`.
- UI: `tests/ui/{slide,resume,article,work,teacher}-viewer-edit`, `slide-editor`, `image-viewer`, `translation-viewer-file`, `result-view-poll`, `doc-edit-save`, `render-storm`.

**Parity contract** (do not touch):

- `.word-sheet` 210×297 mm / `.word-sheet-ls`, `overflow:hidden`, `.word-inner` padding, profile `style` (`app/globals.css:203-245`).
- The hidden measuring box (`WV:551-575`, `invisible fixed -left-[12000px]`, `flow-root`), plus `packPages`/`splitByHeight`.
- 1280×720 slide stage scaled by `transform` only.
- `@media print` rules (`globals.css:563-575`, `.no-print`, `.viewer-workspace`).

## 4. Mobile (360 px) as implemented

- **Shell:** the sidebar becomes a `fixed` drawer (`AppShell.tsx:40-53`). The same overflow chain applies and is worse: 45vh review + 70vh viewer exceeds ≈640 svh.
- **RV header:** labels collapse to icons below `sm` (`RV:462`, `:520`), but «Saqlash · N» keeps its text, so the row is tight.
- **WV:** the fit floor is **50 %**, giving a 397 px sheet (landscape 562 px) plus `px-3`, so the Workspace scrolls sideways. The toolbar `right` group is `overflow-x-auto`.
- **Resume:** fixed 100 %, a 794 px page.
- **Slides:** contain-fit ≈0.26. The side rail `hidden md:block` (`SlideRail.tsx:226`) is replaced by the strip `md:hidden` (`:156`). Chrome is ≈40+110+36 px.
- **Image:** one column. Actions are `opacity-0 group-hover` (`ImageViewer.tsx:67`), invisible on touch; the lightbox still downloads.
- **Audio:** fine.
- **Translation:** pairs fixed `grid-cols-2`; the iframe is 100vh tall.
- **GameSharePanel:** stacks (`:204`); the results table is `min-w-[420px]` with x-scroll (`:303-304`).

## 5. Root causes and other likely UX problems

1. **The page cannot scroll:** RV root `:425` and wrapper `:588` are `overflow-hidden`, so `<main>`'s scroll never applies (translation `flow` excepted).
2. **Panels sit above the content, open by default, each capped at 45vh** (`RV:637`, `:672`), giving three competing scroll areas. A 100-point report still opens; wide screens waste horizontal space.
3. **`min-h-[70vh]`** (`WV:476`, `ResumeViewer.tsx:272`) inside an overflow-hidden flex parent silently clips the scroll container.
4. **Default zoom is fit-width capped at 150 %**, never "page fits". It does not refit on container resize.
5. **ResumeViewer has no fit**, and its Workspace is not in a flex-1 host, so it can overflow by the toolbar height.
6. **The toolbar is not viewport-sticky.** It stays at the top of a viewer box that can sit at the bottom of the screen.
7. **Slides:** the toolbar shows a stale "75%" while fit is on. Manual zoom above fit overflows `SlideStage` (`:96`, centred, no scroll), so the left part is unreachable. Page navigation is duplicated.
8. **Downloads are fragmented** (header, Audio, Image, translation pane). The PDF status line (`RV:528`) and errors (`RV:564`) push content down.
9. **Print:** overflow-hidden ancestors plus inner scroll likely print only the visible slice (needs a browser check).
10. **Mobile:** 50 % zoom floor, resume at 100 %, hover-only image actions, 2-col translation grid.

## 6. Redesign constraints and work-package seams

**Must not change:** sheet geometry/CSS (`.word-sheet*`, `.word-inner`, profile `style`, A4/LANDSCAPE/SLIDE); the measure box and `packPages`; the `SlideCanvas`/`SlideStage` transform model and overlay `scale` contract (`SlideStage.tsx:14,133`); `ArticleEditor` hit-testing on the scaled sheet; edit plumbing (`onEditState` → `EditActions`, `ensureGenerationFresh` before download, `onFix`/`onPolish` save-first + `withReconcile`); `noFix`/`noPolish`/`hideGroups`; `publicGameKindOf` as the single share source (hidden when expired); lazy per-kind chunks with a single SlideViewer `lazy` (`ArtifactViewer.tsx:19`); print `.no-print`; audio without edit props.

**Natural seams (file ownership):**

- **A. Page shell and scroll model:** `components/files/ResultView.tsx` (layout only), with a new `ResultLayout`/panel-dock component. Also update `tests/ui/result-flow`, the order asserts in `article-review-panel`/`game-share-panel`, and `RunningPanel`.
- **B. Paged-document viewer:** `WordViewer.tsx` shell (root, host, fit; not `FlowBlock`/`PageBody`), `sheet.tsx`, `toolbar.tsx`, `useVisiblePage.ts`, ZOOM_STEPS: fit default, ResizeObserver, sticky toolbar, mobile floor.
- **C. Resume viewer shell:** `ResumeViewer.tsx` lines 270-320, reusing B's fit hook.
- **D. Slides shell:** `SlideViewer.tsx` (toolbar/bottom bar/zoom label), `SlideStage.tsx` (scrollable over-zoom), `SlideRail.tsx` strip.
- **E. Side panels:** `ArticleReviewPanel.tsx` (compact summary mode), `GameSharePanel.tsx` (collapsed or drawer layout, results table).
- **F. Media viewers:** `ImageViewer.tsx`, `AudioViewer.tsx`, `TranslationViewer.tsx` (touch actions, download dedupe, mobile pairs).

A and E share the RV tree: define the panel-slot API first. B, C and D are independent once a shared "viewer frame" contract (fills its box, owns its scroll) is agreed.
