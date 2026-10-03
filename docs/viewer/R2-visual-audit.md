# R2: Visual UX audit of the result/viewer pages (prod, 2026-10-03)

**Scope.** 21 content types (latest sample from `samples.txt`), on https://slaydxx.uz with the owner session. Each was checked at 1920×1080, 1366×768 and 390×844 (mobile), plus dark mode at 1366. The audit was read-only. Every non-GET request was aborted at the browser level, and none was attempted. Wheel scrolling was the only interaction.

**Files.** Screenshots are in `shots/<type>-<vp>-{a-viewport,b-full,c-wheel,d-end,e-dark}.png` (273 files). Raw and summary metrics are in `metrics.json` (`_summary` holds the per-type numbers). The script is `audit.cjs`.

**Checks with no findings.** There were no console errors on any page and no horizontal overflow at document level. Dark mode applies everywhere, and the white document "paper" stays white in dark mode, as intended. The `b-full` screenshots match the viewport because the document never scrolls (see P2).

## Per-type verdicts

"Content %" is the share of the first viewport that shows the actual document, given as 1920 / 1366 / 390. "Clip" is how many pixels of the viewer's own scroll box sit below the screen edge. Those pixels can never be seen, so the end of the document is unreachable.

| Type | Verdict | Content % | Scroll model | Main problems |
|---|---|---|---|---|
| listening | **broken** | 8 / **0** / **0** | 3 stacked inner scrollers | Report (45vh) + game link/QR/results (342–380 px) + viewer (min 70vh) do not fit in the clipped box. At 1366 and mobile the viewer is pushed **entirely** off-screen, and its toolbar is invisible. At 1920 only a 101 px slit is visible, with 615 px clipped. Wheel scrolling over the page scrolls the report, not the document. |
| sorting | **broken** | 8 / **0** / **0** | same | Same as listening (game link with results table). |
| crossword | **broken** | 25 / 15 / 15 | stacked inner | "Hali havola yaratilmagan" share panel (125–185 px) + report. Viewer slit is 128–318 px. Clip is 352–423 px, so the last third of every scroll position is never visible. |
| flashcards | **broken** | 25 / 13 / 15 | stacked inner | Same as crossword. Clip is 372–423 px. |
| test | **broken** | 25 / 15 / 15 | stacked inner | Same as crossword. 11 pages are read through a 146 px slit at 1366. |
| article | **broken** (end cut) | 36 / 29 / 37 | report + inner | Report panel fixed at 45vh and open by default. Clip is 227–273 px, so the bottom of the last page is unreachable. Page counter stays at "1 / 11" after scrolling to the end at 1366. Download button permanently reads "Fayl yangilanmoqda…" (fileVersion < docVersion), which is misleading. |
| essay | **broken** (end cut) | 36 / 29 / 37 | report + inner | Same as article. Clip is 227–273 px. |
| referat | **broken** (end cut) | 36 / 29 / 37 | report + inner | Same. Counter stuck at 1/15 at 1366. |
| keys | **broken** (end cut) | 36 / 29 / 37 | report + inner | Same. |
| lesson-plan | **broken** (end cut) | 36 / 29 / 37 | report + inner | Same. |
| infographic | annoying | 36 / 29 / 37 | report + inner | ImageViewer uses `flex-1`, so there is no clip. However, a 1630 px poster is shown through a 271–443 px window. |
| coursework | OK | 75 / 65 / 82 | single inner | At 1920, fit-to-width snaps to 150%, so one A4 page is 1684 px (1.8 viewports). Mobile has 19 px of horizontal scroll (50% zoom floor). |
| mustaqil-ish | OK | 75 / 65 / 82 | single inner | Same as coursework. |
| thesis | OK | 75 / 65 / 82 | single inner | Same. |
| glossary | OK | 75 / 65 / 82 | single inner | Same. |
| texnologik-xarita | annoying | 75 / 65 / 82 | single inner | Landscape sheet is wider than the scroller at **every** size (1709/1664, 1147/1110, 574/390). The right edge and table borders are cut, so the user must scroll sideways. |
| resume | annoying | 75 / 65 / 82 | single inner | Bottom 40 px of the scroller is clipped at every size (toolbar height). On mobile the zoom stays at 100%: the 794 px page in a 390 px viewport cuts off half of the text, and the toolbar's right side (font and edit controls) scrolls sideways. |
| slide | OK (desktop) / annoying (mobile) | 75 / 65 / 82 | no scroll + thumbnail rail | Mobile: the toolbar overflows ("O'chirisl" is cut off), the "O'z rasmim / Rasmsiz" image overlay buttons are always visible, and the slide fills about 25% of the screen with a large black void around it. |
| pro-slide | OK / annoying (mobile) | 75 / 65 / 82 | same | Same as slide. |
| image | OK | 78 / 65 / 82 | single inner | None. |
| translation | OK | 75 / 70 / 87 | **one page scroll** (`data-result-flow`) | The only type with a single page-level scroll.. |

Key screenshots:
- Owner's complaint reproduced: `shots/listening-1920-a-viewport.png`, `listening-1920-d-end.png` (scrolled to "2 / 2" and still showing a blank top-of-page slit)
- Viewer invisible: `listening-1366-a-viewport.png`, `sorting-390-a-viewport.png`
- Report squeezing the viewer: `article-1366-a-viewport.png`, `test-1920-a-viewport.png`, `crossword-1366-a-viewport.png`
- Width bugs: `resume-390-a-viewport.png`, `texnologik-xarita-1366-a-viewport.png`
- Mobile slide: `slide-390-a-viewport.png`
- Good references: `translation-1366-a-viewport.png`, `coursework-1366-a-viewport.png`, `pro-slide-1366-a-viewport.png`

## Cross-cutting problems, ranked

1. **Fixed-height shell plus stacked panels makes content unreachable** (10 types; listening/sorting 0%). Cause: `ResultView.tsx:588` puts the review `<details open max-h-[45vh] shrink-0>`, the share panel (`max-h-[45vh] shrink-0`) and the viewer (root `h-full min-h-[70vh]`, `WordViewer.tsx:476`, `ResumeViewer.tsx:272`) into one `min-h-0 flex-1 overflow-hidden` box. 45 + 45 + 70 vh is about 160vh inside a box of roughly 90vh, and `overflow-hidden` silently cuts off the excess. The viewer's scroll box keeps its full height under the clip, so its last 227–615 px can never be seen, even when its scrollTop is at the end.
2. **No page-level scroll; 2–3 sibling scroll traps.** The document never scrolls (root `overflow-hidden`; translation is the only exception). The report, the share panel and the viewer each scroll separately. Where the wheel lands decides what moves: on mobile, scrolling moved only the report (`listening-390-c-wheel.png`).
3. **Report is open by default and too large.** `<details open>` takes 346–486 px (45vh) on every reviewed type, every visit. The score is useful, but the full checklist is secondary to the document.
4. **Game share and results block sits above the content.** QR code, link, "Yangi havola" and the results table take up to 380 px. It is teacher tooling, not the artifact, and on mobile it pushes the viewer off-screen.
5. **Fit-to-width rounds up.** In `WordViewer.fit`, zoom snaps to the *nearest* `ZOOM_STEPS` value rather than flooring. Landscape sheets therefore overflow at every width (96%→100%). The 50% minimum overflows a 390 px phone by 19 px, and ResumeViewer has no fit at all on mobile (100%). At 1920 the 150% cap makes a single page 1.8 screens tall.
6. **The toolbar is not sticky to the viewport**, only to its box. When panels push the viewer down, the "1 / N 150%" bar sits at the bottom edge or off-screen (the owner's complaint). The page counter also stops updating when the visible window is small (stuck at "1 / N" at 1366).
7. **Mobile toolbars overflow**: the right-hand actions scroll sideways (resume: 106 of 408 px visible; slides: "O'chirish" clipped).
8. Minor: "Fayl yangilanmoqda…" stuck on stale files (article); the mobile header title is truncated to about 12 characters.

## What good looks like

1. **One page scroll, content first.** Use the translation `flow` model for all types. The page scrolls; the nav and a slim viewer toolbar are `position: sticky` (top: 0 and 56 px). Pages render inline, so there is no inner `overflow-auto` box and no `min-h-[70vh]`. The end of the document is always reachable, and the browser scrollbar shows the real length.
2. **Report as a summary chip plus a drawer.** The header shows one line: "Tayyorlik 77 · 2 xato · 7 e'tibor ›". Clicking it opens:
   - on ≥1280 px, a right side panel (360–420 px, collapsible, remembered per user);
   - on smaller screens, a bottom sheet or tab.

   The panel should not be open by default, except possibly when there are errors, and then only as the chip, not the full checklist.
3. **Games: tabs or a side panel for sharing.** Use tabs `[Hujjat] [O'yin havolasi · 1 natija]`, or put link/QR/results in the same side panel. The document stays first; the results count is a badge.
4. **Sticky toolbar.** Pin it under the nav and give it a page jump. The page counter should be driven by IntersectionObserver against the viewport.
5. **Zoom defaults:**
   - Fit-to-width with the snap value floored, never rounded up.
   - Desktop: cap reading width at about 900–1000 px (≈110–125%) rather than 150%, so a page is about one screen tall.
   - Landscape sheets: fit to their own width.
   - Mobile: true fit (zoom = (vw − 16)/sheetW, no 50% floor), the same for the resume, and pinch-zoom allowed.
6. **Mobile:**
   - Collapse the toolbar to ‹ 1/N › plus an overflow "⋯" menu.
   - Put download, PDF and delete in a bottom action bar.
   - Show the slide rail as a swipe deck with the slide filling the width.
   - Show image overlay actions only on tap.
7. **Regression guard:** a Playwright check per type at 1366×768 asserting content ≥60% of the first viewport, the last page's bottom reachable, and the toolbar visible (reuse `MEASURE` from `audit.cjs`).
