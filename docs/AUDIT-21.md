# AUDIT-21 — Krossvord + Flesh kartalar + Infografika (2-dastur, bosma)

Umumiy dastur rejasi va egasi qarorlari: `docs/AUDIT-20.md` §1 (14 qaror). Tadqiqot: `docs/research/{crossword,flashcards,infographic}.md`. Raqobatchi: `docs/research/slaydtop-summary.md`.

## 1. Reja (AUDIT-20 §1 dan, 2026-09-17)

### 2-dastur (AUDIT-21) — krossvord + flesh kartalar + infografika (bosma)

- **Krossvord** (`crossword`, O'yinlar, 2 000, docx): LLM faqat so'z+ta'rif (5/10/15/20, mavzu/fayl), to'r **sof algoritm** `lib/generation/games/crossword/grid.ts` (greedy + backtracking, kesishma ≥1, maks 21×21, seeded; sig'magan so'z tashlanadi → `delivered`), `svg.ts` → `figurePng` → mavjud `figure` blok (`FigureSpec kind:"svg"` — tayyor SVG); model `AcademicDoc.game = {kind:"crossword", words[], grid, clues}`, `games/layout.ts planGame` → `drawGame`/`gameFlow`. Javoblar yangi betdan.
- **Flesh kartalar** (`flashcards`, 2 000): `game.cards[{front, back, hint?}]` 5/10/15/20; `drawCards` — DOCX jadval 2×4 (74×105 mm), old betlar + orqa betlar oynali (duplex); ko'ruvchi shu jadval.
- **Infografika** (`infographic`, O'qituvchi, 2 000, png): LLM spetsifikatsiya `{title, subtitle, blocks[3–6]{icon, heading, text≤40 so'z, stat?}, palette}` → `figures/layout-infographic.ts` (A4 portret) + `figures/icons.ts` (≤40 SVG path) → `figureSvg` → `figurePng` (A4 @300 dpi) → `packImages`/`ImageViewer`; PDF — bir betlik DOCX o'rami (tadqiqotdan keyin).
- WP (≈6 kun): R0 lead — `ToolGroup "oyinlar"`, 3 vosita, `AcademicDoc.game`, `FigureSpec svg`, narx (1); WP-A opus — grid/svg + engine (`crossword-grid` 16, mutatsiya ≥5) (2); WP-B sonnet — flashcards + `drawCards`/flow + paritet (1.5); WP-C opus — infografika layout + ikonlar + quvur + ko'z (2); R lead — forma (`StandardForm` + `modes` yetadi, zond `game-params.ts`), jonli 3, smoke, deploy (1).


### Aniqlashtirishlar (tadqiqot hisobotlaridan)
- **Krossvord** (`crossword.md`): to'r 13–21 toq, raqamlash chapdan-o'ngga/yuqoridan-pastga, kesishma ≥1, so'z 3–15 harf, o'zbek `oʻ gʻ` apostrofli harflar BITTA katak; simmetriya shart emas; DOCX: 1-bet to'r (SVG→PNG `figure`), keyin Gorizontal/Vertikal savollar 2 ustunda, javob to'ri yangi betdan; turlar klassik / ta'rifli (rasmli keyin); parametrlar: `wordCount` 5/10/15/20, `mode` topic|file, `language` 18, `gridSize` auto; qoidalar wordCount, gridSize, minCrossings, wordLength, clueLength 10–150, uniqueWords, answerSheet; judge clueClarity, wordGrade, gridConnectedness, answerAccuracy, originality; narx 2 000 tekis.
- **Flesh kartalar** (`flashcards.md`): A7 74×105 mm, A4 da 2×4, duplex «flip on long edge» — orqa bet oynali; turlar atama–ta'rif / savol–javob (rasm–so'z keyin); `cardCount` 5/10/15/20, `includeExample`; qoidalar cardCount, frontLength 5–50, backLength 20–200, noDuplicate, examplePresence, cardTypeMatch; judge termClarity, definitionCompleteness, languageLevel, exampleRelevance, memorability.
- **Infografika** (`infographic.md`): 7 tur (ro'yxat, jarayon, taqqoslash, statistika, xronologiya, sabab-natija, tuzilma), 3–8 blok, ≤120 so'z (yumshatish mumkin), A4 portret 300 dpi PNG, 6 palitra (WCAG AA), Tabler Icons (MIT) ≈40 ta, alohida `figures/infographic-svg.ts` (rangli; `svg.ts` monoxrom o'zgarmaydi); halollik — statistika faqat foydalanuvchi bergan raqamlar; parametrlar `topic/type/blockCount/palette/size/language/extra`; qoidalar blockCount, textLength, titleLength, iconKnown, contrast, noOverflow, statPresent; judge 5.
- Guruhlar: `crossword`, `flashcards` → `ToolGroup "oyinlar"` («O'yinlar» bo'limi — `CreateGrid`/`Sidebar` yorlig'i), `infographic` → `oqituvchi`. Forma: `StandardForm` + `modes` (krossvord) yetadi — yangi composer YO'Q; zond `game-params.ts`/`infographic-params.ts`.

## 5. Bajarilish yozuvi

