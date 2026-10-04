# R3 — Phone-friendly text editing (owner request #4)

Research only. No product code changed. Screenshots, scripts and raw JSON: `scratchpad/mobile/r3/` (`slides.cjs`, `docs.cjs`, `resume.cjs`, `seed.mts`, `slides-*.json`). Test DB `slaydx_r3`, dev server :3203 (stopped).
Method: Chromium 153 (Playwright), `isMobile`+`hasTouch`+DPR 3, 360x740 and 390x844 with a Telegram stub (`TelegramWebviewProxy` + stubbed `telegram-web-app.js`) and 1366x768 desktop. Seeded `slide` and `pro-slide` (9 slides, templates lecture/pitch from `sampleDeck`), plus article, lesson-plan and resume. Opening a text = two real touch taps (`page.touchscreen.tap` x2). Keyboard simulated with `page.setViewportSize` to 420 px (390 wide) and 400 px (360 wide), i.e. the Telegram-Android behaviour (webview shrinks). Real device / iOS visual-viewport behaviour NOT verified (see risks).

---
## 1. Code map

| What | Where |
|---|---|
| Editor overlay (the whole feature: tap -> edit box -> style panel) | `components/viewers/SlideEditor.tsx` |
| Opening gesture: **`dblclick` only**, on `[data-slide-frame]`, `closest("[data-src]")` | `SlideEditor.tsx:287-311` (single tap does nothing: probe `pointerdown,click` only) |
| Edit state / commit / cancel / outside-`mousedown` closes | `SlideEditor.tsx:167-285`; Enter = commit, Esc = cancel (`:322-345`) — **no Esc on a phone keyboard**, no Save/Cancel button |
| WYSIWYG edit box = `textLayerStyle(editLayer)` inside a twin `transform: scale(scale)` container | `SlideEditor.tsx:547-612`; `textLayerStyle` in `SlideCanvas.tsx` (shared with canvas) |
| **The "style block"** (`[data-slide-font-panel]`): label, `<select>` of 8 fonts + Standart, `-`/`+`, current size, **12 preset buttons**, «Standart» | `SlideEditor.tsx:469-545` (font + size only: no colour/bold/italic/alignment exist in the product) |
| Panel position: `absolute z-10`, `left = box.left*scale`, `top = panelTop>=34 ? panelTop-34 : panelTop+panelH+4`, `max-w-[min(640px,95%)] flex-wrap`, 11 px text, buttons `p-1`/`px-1 py-0.5` | `SlideEditor.tsx:470-481`, offsets `:462-464` |
| Panel stays focus-neutral: `onMouseDown preventDefault` (except `<select>`), `onBlur` ignores focus moving into the panel | `:482-486`, `:352-357` |
| Stage / scaling: `SlideStage` — fit mode `overflow-hidden`, `max-md:aspect-video`, scale = measured fit (~0.28 at 390); zoom mode `overflow-auto` | `SlideStage.tsx:93-206` |
| Overlay mounted in the **scaled, clipped stage frame** (`relative m-auto shrink-0`, `[data-slide-frame]`) | `SlideStage.tsx:172-205`, wired in `SlideViewer.tsx:536-576` |
| Toolbar (slides): `SlideToolbar`, `h-10`, `relative z-10`; mobile «⋯» menu | `SlideToolbar.tsx:68-80` |
| Vertical budget on phones: TopBar 56 + result header 55.5 (sticky, `z-20`, compact on scroll) + toolbar 40 + stage + thumbnail strip + 32 px status row, all inside `--result-fill-h = 100svh - topbar - header` | `ResultLayout.tsx:246`, `frame.ts:49`, `SlideViewer.tsx:451-615` |
| Result bottom sheet `fixed z-50`, backdrop `z-40` (no conflict: panel is z-10 inside the slide) | `ResultLayout.tsx:330-346` |
| Keyboard / visualViewport handling | **None anywhere** (`grep visualViewport|viewportChanged|tg-viewport|dvh` in app/components/lib -> only `svh` in `--result-fill-h`, `Viewport` has no `interactiveWidget`). `svh` does not track the keyboard in Chrome/iOS (only in a resizing webview). |
| Other in-place editors | Word-like: `WordViewer.tsx:478-495` («Tahrirlash» toggle in `right`, hidden in reading mode), `ArticleEditor.tsx`; resume: `ResumeViewer.tsx:180-291`, `resume/ResumeEditor.tsx:147` (dblclick). All `contentEditable` in place via `editable.ts`; **no floating panel** |
| Tests that lock the current panel | `tests/ui/slide-editor.test.mts:311-405` (labels «Shrift oilasi», «Shriftni kattalashtirish/kichraytirish», «Shrift 24 pt», «Joriy shrift o‘lchami», text «Standart», «Barcha bandlar», «Shrift»); `tests/viewer/parity.test.mts`; mouseDown-preventDefault test `:403` |

---
## 2. Reproduction and measurements (Chromium)

Screenshots (all in `r3/`): `slide-p390-title0-kb420.png`, `slide-p390-closing8-kb420.png`, `slide-p390-z3-bullets3-nokb.png`, `slide-p390-z3-title0-kb420.png`, `pro-slide-p390-z0-title0-nokb.png`, `slide-p360-*`, `slide-d1366-*`.

### 2.1 Fit mode (default on phones; panel overlays the slide), overlap = panel bbox ∩ edited-text bbox

| Viewport | Target | Panel size (px) | Rows | Overlap with edited text |
|---|---|---|---|---|
| 390x844 | title slide 1 | 339x53 | 2 | **32.9 %** |
| 390x844 | bullets (list) | 324x77 | 3 | **36.9 %** |
| 390x844 | footer (bottom edge) | 339x53 | 2 | **99.9 %** |
| 390x844 | closing subtitle | 301x77.5 | 3 | **99.8 %** |
| 390x844 | title at top of slide | 339x53 | 2 | 0 % but panel flips below the title and **covers the slide body** |
| 360x740 | title / bullets / footer / closing | 313x77.5 / 299x77 / 313x77.5 / 278x77 | 3 | **82.8 / 39.7 / 100 / 100 %** |
| pro-slide 390 | title (text in right column) | **185x101.5** | **4** | **87.7 %** |
| pro-slide 390 | bullets / footer / closing | 301x77.5 / 338x53 / 297x77.5 | 3/2/3 | **99.8 / 100 / 100 %** |
| 1366x768 | all five | 630x28.5 (1 row), bullets 640x53 | 1-2 | 0 % (bullets 6.7 %) |

- Keyboard simulated (390x420 / 360x400): the slide stage (TopBar 56 + header 55.5 + toolbar 40 = 151.5 px, stage 219 px, bottom 371 px) still fits above 420 px, so the panel/text stay visible — **the keyboard is not what breaks fit mode, the panel geometry is.** Real device behaviour differs (see risks).
- Touch targets in the panel: **16 of 16 controls are < 44 px; smallest 20x20, text 11 px** (WCAG/Material minimum 44-48). Select and size presets are 20-26 px high.
- Horizontal page overflow: 0 in every run. Panel never clipped horizontally in fit mode (max-w 95 %).
- z-index: panel `z-10` in the page stacking context equals `SlideToolbar z-10`; DOM order makes the panel win but it never reaches the toolbar in practice (flips below when < 34 px from the slide top). Result header `z-20` and sheet `z-50` sit above. Telegram header is native chrome, outside the webview — no overlap possible. No z-conflict found.

### 2.2 Zoom mode (user taps «+» to ~90 %, the realistic way to make the 10 px text editable)

- Panel is `630-640x28-53 px` on a 390 px screen: **it runs off-screen to the right inside the scroll stage** — the font select works, but «−/+», presets and «Standart» are only reachable by panning the stage horizontally (`slide-p390-z3-bullets3-nokb.png`: the panel is cut at the "Standart (Arial) v  -" control).
- The panel is inside the scrolling/transformed slide frame, so it scrolls away with the slide and is not anchored to the caret or the screen.
- With the keyboard (420 px): the edited text box ended up **below the visible area** (`box.b > viewport` true; screenshot `slide-p390-z3-title0-kb420.png` shows an empty slide top, edit box off-screen). The app has no scroll-into-view logic; it depends on the browser scrolling the caret into view after the webview resize (not reproducible in Playwright). Visible stage height with kb = 420 - 151.5 - strip (~130) ≈ 140 px.

### 2.3 Other facts
- Gesture: only a **double tap** opens editing; there is **no hint** on a touch device (no text on the slide editor mentions it; the Word viewer has the hint only as a `title=` tooltip, invisible on touch).
- Edited text on phone fit: title 36 pt at 0.28 scale = ~10 px glyphs (box 187x57 px) — caret and selection are tiny regardless of the panel.
- Esc (cancel) does not exist on a phone; commit happens on Enter, outside-`mousedown`, or blur. There is no on-screen «Tayyor/Bekor».

### 2.4 Other in-place editors on a 390 px phone

| Editor | Findings |
|---|---|
| Word viewer (article, lesson plan; `WordViewer.tsx`) | Opens in «O'qish» (reading) by default on phones: **no «Tahrirlash» there** (`right={reading ? null : right}`); user must find «Varaq» (48x24 px) first. In «Varaq» the «Tahrirlash» toggle (69x26) lives inside the «⋯» menu. Double tap -> in-place contentEditable (blue box, no floating panel -> no covering problem). Edited field is visible with kb 420 (y 247-256 / 311-362 vs header bottom 152). Problems: no Save/Cancel/Done on screen (Enter on soft keyboard saves, no Esc), hint only in `title=`, 24-28 px toolbar buttons. |
| Resume (`ResumeViewer.tsx`, `ResumeEditor.tsx`) | Page fit 46 %: edited span 61x6.5 px, font 11 px (tiny). «Tahrirlash»/undo/redo/template/palette are in the «⋯» menu which opens over the page top (`resume-p390-1-editon.png`); menu items 26-31 px. Same missing Done/Cancel; tapping through the template `<select>` stole focus in my probe. No floating style panel. |
| Article/teacher editing | Same engine as Word viewer (ArticleEditor). Same issues as above. |

Summary: the "panel covers the text" bug is slide-specific; the other editors have the generic phone gaps (no Done/Cancel, hidden entry point, no hint, tiny targets, no keyboard handling).

---
## (a) Root causes

1. **Panel height is assumed, not measured.** `top = panelTop - 34` assumes a single 34 px row, but `flex-wrap` + `max-w 95 %` + `left = box.left` produce 2-4 rows (53-101 px) at <= 390 px, so the panel's bottom lands inside the edited box. When the text is at the top it is placed below and covers the body; at the bottom edge it covers the footer/body. (`SlideEditor.tsx:470-481`.)
2. **The panel lives inside the slide frame**: scaled/clipped/scrolling stage, width bounded by `containing width - left` (so the right-hand text of pro-slide gets a 185 px wide panel), unreachable in zoom mode, scrolls away with the slide.
3. **Desktop controls on a touch screen**: 11 px text, 20 px hit areas, 12 presets + select + steppers in one block — meant for a mouse.
4. **No viewport/keyboard layer**: nothing reacts to the on-screen keyboard (`visualViewport`, Telegram viewport, `interactive-widget`), no scroll-the-edited-box-into-view, no collapse of header/strip while editing; ~151 px chrome above and ~160 px below the slide eat the rest.
5. **Gesture/hint**: dblclick-only, undiscoverable; no explicit end-of-edit control (no Esc on phone).

---
## (b) Proposed design

### Principles
- On phones (`(pointer: coarse)` or `< 768 px`) the style controls leave the slide: a **slim 44 px docked bar** outside the scaled frame, never overlapping the stage. Desktop (mouse) keeps the floating panel (with the measured-height fix so it cannot overlap in the 2-row case).
- The bar is **in-flow, replacing `SlideToolbar` while a text is being edited** (same 40-44 px slot), so the slide gets no extra obstruction and nothing needs a z-index.
- Secondary controls (font family, presets) live in a small sheet that opens **above the bar's own row, over the thumbnail strip/bottom area, never over the slide** and keeps the edit field focused.
- On keyboard open: keep the edited box visible (scroll into view inside the stage), hide the thumbnail strip and status row while editing, collapse the result header to its compact form.

### Mockup A — recommended: bar replaces the toolbar, 390 px, keyboard closed (fit mode)
```
+--------------------------------------+  <- Telegram native header (outside webview)
| TopBar                       0  (R)  | 56
| <- Fotosintez..   [dl] [PDF] [bin]   | 55  (compact when scrolled)
+--------------------------------------+
| [A-] 36 [A+] [Arial v ] [Std]  [ OK ]| 44  <- edit bar (replaces slide toolbar), 44x44 hit areas
|--------------------------------------|
|  +--------------------------------+  |
|  | slide (fit, text box outlined) |  |  219  (nothing overlaps it)
|  |  [Fotosintez jarayoni va|]      |  |
|  +--------------------------------+  |
|  [thumb][thumb][thumb]   (strip)     |
+--------------------------------------+
```
Keyboard open (visible height ~ 420): TopBar+header compact (56+44) + bar 44 + stage (fits in the remaining ~270) — strip and status row hidden:
```
+--------------------------------------+ 
| TopBar / compact header              | 100
| [A-] 36 [A+] [Arial v ] [Std]  [ OK ]| 44
|  +--------------------------------+  |
|  | slide  (text box, auto-scrolled|  |  ~215
|  |  into view, caret visible)     |  |
|  +--------------------------------+  |
|  [ q w e r t y u i o p ]  keyboard   |
```

### Mockup B — presets/font in a mini sheet (opens from «Arial v» or «36»), above keyboard
```
|  slide stage (top part, visible)     |
|--------------------------------------|
| Shrift                    [x]        | 36  mini sheet, max 40% of visible height
| (Arial)(Calibri)(Times)(Georgia)  -> | 44  horizontal chips, 8 fonts, no native <select>
| 12 14 16 18 20 24 28 32 36 44 54 66  | 44  horizontal scroll, 44 px chips
| [Standart]                           |
|======================================|
| [A-] 36 [A+] [Arial v ] [Std] [ OK ] | 44  bar stays pinned (moves above keyboard)
| keyboard ....                        |
```

### Mockup C — alternative: bar pinned to the visual-viewport bottom (Google-Docs style)
```
|  slide stage (edited text visible)   |
|--------------------------------------|
| [A-] 36 [A+] [Arial v ] [Std] [ OK ] | 44  position: fixed; bottom: kbHeight
| keyboard ....                        |
```
Pro: thumb reach, familiar. Con: depends on correct keyboard height (`visualViewport` on iOS) — most fragile in Telegram; recommend A first, C only if the owner prefers.

### Contract

**Shared hooks (new, `lib/hooks/` or `components/viewers/hooks/`)**
- `useCoarsePointer(): boolean` — `matchMedia("(pointer: coarse), (max-width: 767px)")`, `false` on the server and in jsdom (tests unchanged).
- `useVisualViewport(): { height: number; offsetTop: number; keyboardOpen: boolean }` — `window.visualViewport` (`resize`, `scroll`) with fallback to `innerHeight`; `keyboardOpen = layoutHeight - vv.height > 120 || innerHeight < 0.8 * maxInnerHeightSeen`; also writes `--vv-h` on `<html>`; subscribes to Telegram `WebApp.onEvent("viewportChanged")` when present. SSR-safe, try/catch around every access (project rule for browser storage/APIs).

**Components**
- `SlideEditStyleBar` (new, `components/viewers/slide-edit/StyleBar.tsx`): props `{ size, min, max, hasOverride, font, wholeList, onSize, onFont, onReset, onDone, onCancel? }` — pure/controlled; keeps the exact `aria-label`s the tests use («Shriftni kattalashtirish», «Shriftni kichraytirish», «Joriy shrift o‘lchami», «Shrift 24 pt», «Shrift oilasi» on the desktop select, text «Standart», «Barcha bandlar»/«Shrift»).
- `SlideEditFontSheet` (new): font chips + preset chips, opened from the bar; `aria-label`s mirror the desktop ones.
- `SlideEditor` renders: desktop -> existing floating panel (extracted into the same props-driven component; position computed from the **measured** panel height, flip rule: above if `top - h >= 0`, else below, else inside the frame bottom; clamp `left` so width never shrinks below 280 px or `min(640, frame width)`); phone -> `createPortal` of `SlideEditStyleBar` into a slot `[data-slide-editbar-slot]`.
- Slot owner: `SlideToolbar` accepts `editBar?: ReactNode`; when present it replaces the toolbar contents (still `data-slide-toolbar`, height 44, `sticky` is unnecessary because it is in-flow above the stage).
- Phone positioning rules (all in one place, JSDoc'd): bar is 44 px high, in-flow, never `absolute` over the slide; hit areas >= 44x44 (visual size may stay 32 px); no `<select>` on touch (native picker blurs the editor and covers the screen) — chips instead; the bar never takes focus (`onPointerDown` preventDefault on non-interactive parts, `onMouseDown` as today); «OK» = `commit()`, a second small «x» (or long-press Esc substitute) = `cancel()`.
- Keyboard handling in `SlideViewer`/`SlideStage` (phone only, only while `editingKey` is set): hide strip + status row (`hidden` via a `data-editing` attribute on the frame), call `scrollIntoView({block: "nearest", inline: "nearest"})` on the edit box on `keyboardOpen`/`vv.height` change and on open; ask `ResultLayout` to show the compact header while editing (same `data-compact` mechanism, new prop/CSS variable, no layout jump); in zoom mode additionally scroll so that the caret line is inside `[offsetTop, offsetTop + vv.height)`.
- Optional (owner decision): "focus zoom" — on phone, opening a text temporarily zooms the stage so the box is >= ~60 % of the stage width (e.g. 100 % scale), restoring fit on commit. Makes the caret/selection usable (10 px glyphs today) and does not conflict with the bar because the bar is outside the stage.
- Gesture: keep `dblclick` and add a pointer-based double-tap detector on touch (2 taps < 300 ms, < 24 px apart) so iOS/Telegram do not depend on synthetic `dblclick`; show a one-time hint on touch devices («Matnni tahrirlash uchun ikki marta bosing», dismissible, stored in `localStorage` with try/catch) and an `editOn` toggle chip when the user opens edit mode.
- Other editors (Word/Article/Resume): shared `EditDoneBar` (new `components/viewers/EditDoneBar.tsx`): phone only, appears while a field is open, `position: fixed; left: 0; right: 0; bottom: var(--kb-h, 0)` (from `useVisualViewport`), 44 px, buttons «Bekor» / «Tayyor» (calls the same `commit`/`cancel` exported by `editable.ts` consumers), safe-area padding. Move «Tahrirlash» out of the «⋯» menu (always visible chip) and show it also in reading mode (switches to «Varaq» + enables edit) or at least a visible hint. Hint text visible, not `title=`.

**Desktop unchanged** except the measured-height placement fix (removes the 6.7 % overlap in the 2-row bullets case).

### Work packages (non-overlapping file ownership)

| WP | Scope | Files (owner) | Model |
|---|---|---|---|
| H1 | Shared hooks + unit tests | NEW `lib/hooks/useCoarsePointer.ts`, `lib/hooks/useVisualViewport.ts`, `tests/ui/use-visual-viewport.test.mts`; optional `app/layout.tsx` (`interactiveWidget`, only if owner approves Q3) | sonnet |
| S1 | Slide edit UI: extract panel, phone bar + sheet, measured placement | `components/viewers/SlideEditor.tsx`, NEW `components/viewers/slide-edit/StyleBar.tsx`, `FontSheet.tsx`, `tests/ui/slide-editor.test.mts` (extend; existing assertions kept) | opus |
| S2 | Slide host wiring: slot in toolbar, keyboard-aware stage, hide strip/status while editing, scroll-into-view, optional focus zoom, compact header while editing | `components/viewers/SlideToolbar.tsx`, `SlideStage.tsx`, `SlideViewer.tsx`, `components/files/ResultLayout.tsx` (compact-header prop only), tests | opus |
| D1 | Document editors phone UX: `EditDoneBar`, visible «Tahrirlash», hint, keyboard scroll | NEW `components/viewers/EditDoneBar.tsx`, `components/viewers/WordViewer.tsx`, `ArticleEditor.tsx`, `resume/ResumeEditor.tsx`, `ResumeViewer.tsx`, `toolbar.tsx`, `editable.ts` | sonnet |
| Q | Browser smoke (Playwright touch, 360/390, kb sim) + mutation checks on the new bar; real-device check (Android + iPhone Telegram) | `scratchpad` scripts reuse of `r3/*.cjs`; no product files | lead |

Order: H1 -> (S1 || S2 || D1) -> Q. S1/S2 share only the `[data-slide-editbar-slot]` and the `onEditing` key contract (documented here).

Test plan: ui tests with a stubbed `matchMedia` (coarse) for the bar (sizes >= 44, labels, commit/cancel), mutation: restore `panelTop-34` / remove `scrollIntoView` and confirm tests fail; Playwright smoke asserts `overlap(bar-or-sheet, editBox) == 0`, no horizontal overflow, edit box inside `[offsetTop, vv.height)` after kb sim, touch targets >= 44 via `getBoundingClientRect`.

---
## (d) Questions for the OWNER (recommended first)

1. **Where should the phone style bar sit?** (a) **top, in the toolbar slot, replacing the toolbar while editing** (recommended; nothing can cover the slide); (b) bottom, pinned above the keyboard (Google Docs style); (c) keep floating but fix geometry only (cheapest, still covers on small screens).
2. **Which controls stay in the one-row bar?** (a) **«−/+» + current size + font chip + «Standart» + «Tayyor»; font list and 12 presets in the small sheet** (recommended); (b) everything in a horizontally scrollable single row (no sheet); (c) only «−/+» and «Tayyor».
3. **Auto-zoom the edited text on phones?** (a) **yes — temporary focus zoom so the text is readable (>= ~60 % box width) and restore fit after saving** (recommended; today the glyphs are ~10 px); (b) no, user zooms manually; (c) zoom only when the text box is < N px.
4. **Editing gesture on touch:** (a) **keep double tap + add a reliable double-tap detector and a one-time hint** (recommended); (b) single tap on text edits (risk of accidental edits when scrolling/swiping slides); (c) long-press.
5. **Document editors (Word/Resume):** (a) **add the same «Bekor / Tayyor» bar above the keyboard and put «Tahrirlash» out of the «⋯» menu** (recommended); (b) only the Done bar; (c) leave as is.
6. **Viewport meta `interactive-widget=resizes-content` for the whole app?** (a) no, handle it with `useVisualViewport` only (recommended: smaller blast radius); (b) yes, add it globally (also helps forms) after a real-device check.

## (e) Risks
- **Real-device behaviour not verified.** Chromium emulation cannot raise a real keyboard: Android Telegram resizes the webview (my simulation); iOS keeps the layout viewport and shrinks only `visualViewport`, scrolling the page; Telegram's `viewportChanged` timing varies. Must be checked on an Android phone and an iPhone in the Mini App before release.
- **iOS double tap**: synthetic `dblclick` on touch is not guaranteed in WKWebView; the pointer-based detector is needed (and must not conflict with the double-tap-zoom/scroll gestures).
- **Focus**: any control in the bar must not blur the contentEditable (iOS closes the keyboard on blur). `<select>` and native pickers do exactly that — hence chips; keep `preventDefault` on `pointerdown`/`mousedown` and re-check iOS.
- **Parity contract**: do not touch `SlideCanvas`/`textLayerStyle`/scale twin; the bar is pure UI outside the frame. `tests/viewer/parity.test.mts` and the `FONT_PRESETS` import must stay green.
- **Test coupling**: `tests/ui/slide-editor.test.mts` asserts desktop labels; jsdom has no `matchMedia` -> desktop path stays the default, so existing tests remain valid; the phone path needs its own tests.
- **Layout shift**: swapping the toolbar for the bar and hiding the strip while editing must not change the stage size beyond +/- 4 px or the fit scale jumps (the cursor moves); keep the bar the same 40-44 px slot.
- **Header collapse while editing** reuses the V5b compact-header logic (scroll driven); making it editing-driven must not re-trigger measurement loops (`--result-header-h` is written in the same commit — keep that invariant).
- Focus zoom (if approved) changes `scale` while a contentEditable is focused: the twin container re-renders; verify caret position is preserved (uncontrolled field — React must not re-render the field node).
- The panel `top-34` fix alone (Q1c) lowers overlap on desktop but cannot fix zoom-mode unreachability or the 20 px targets on phones.
