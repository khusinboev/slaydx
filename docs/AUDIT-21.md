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


### WP-A — krossvord dvigateli (2026-09-16)

R0 substratidan MUSTAQIL bo'lgan qatlamlar yozildi va qulflandi (4 kommit).
`buildCrosswordDoc`, `polish.ts`, `games/engine.ts` va hisobotning
baholovchi yarmi R0 (`games/types.ts CrosswordModel`, `AcademicDoc.game`,
`FigureSpec kind:"svg"`, `games/registry.ts JudgeSpec`) kelgach ulanadi.

| Fayl | Nima | Testlar | Mutatsiya |
|---|---|---|---|
| `games/crossword/grid.ts` | `placeWords` — sof greedy + backtracking, harf→katak bo'lish, raqamlash, ramka kesish, determinizm | `crossword-grid` 22 | 7/7 |
| `games/crossword/svg.ts` | to'r SVG i mm o'lchovda (bo'sh + javob), `figurePng` uchun | `crossword-svg` 10 | 5/5 |
| `games/crossword/input.ts` | `crosswordInputFromValues`, reyestr chegaralari, `crosswordSeed` | `crossword-engine` 14 | 6/6 |
| `games/crossword/prompts.ts` | LLM faqat so'z+ta'rif; javob/ta'rif qoidalari, fayl rejimi bloki, yorliqlar | (yuqoridagi) | (yuqoridagi) |
| `games/crossword/review.ts` | 10 deterministik qoida (§4.1 + to'r butunligi) | `crossword-review` 13 | 7/7 |

**Qarorlar va sabablari**

- **Harf → katak** (§6 4-savolga javob, egasining qarori): `oʻ`/`gʻ` —
  BITTA katak (`o'`, `o‘`, `o’`, `ʼ` → `oʻ` normalizatsiya), `sh`/`ch`/
  `ng` — ikki katak; tutuq belgisi (`sanʼat`) alifbo harfi emas, katak
  olmaydi. So'z uzunligi KATAKDA o'lchanadi (`OʻSIMLIK` = 7).
- **Backtracking uch qatlam**: navbatga qaytarish (sweep) → qurbon so'zni
  olib tashlab qayta joylash (chuqurlik 1, natija `validatePlacement`
  bilan tekshiriladi) → seeded restart (16 tartib). To'liq DFS ataylab
  olinmadi (20 so'zda eksponensial); namuna lug'atda 20/20 so'z joylashdi,
  18×19 to'r, 21 kesishma, 2 ms.
- **To'r RAMKA bo'yicha kesiladi** — «13–21 toq» qoidasi yumshatildi:
  5 so'zli krossvord 10×11 bo'lib chiqadi va shu holda bosiladi; buyurtma
  o'lchami (`gridSize`) endi YUQORI chegara. `gridSize` hisobot bandi ham
  shu mantiqda (kichik — yashil, katta — nuqson).
- **«Qora katak»**: standart ko'rinishda so'zga tegishli bo'lmagan katak
  CHIZILMAYDI (bizniki siyrak criss-cross, 30–40 % to'la; 21×21 ramkaning
  60 % ini qora bo'yash betni qoraytiradi). Zich ko'rinish — `blackCells`
  opsiyasi (ikkala yo'l ham testda).
- **Model geometriya bermaydi**: promptda koordinata so'ralmaydi
  («YOU DO NOT BUILD THE GRID») — modeldan kelgan to'r ko'pincha o'zi
  bilan zid bo'ladi, baribir qayta tekshiriladi.
- **Ta'rif javobni oshkor qilishi** — qoida bilan tutiladi (o'zak
  solishtiruvi, agglutinativ shakllar ham), baholovchiga qoldirilmadi.

**Testda ushlangan nuqson**: katak o'lchami yuqoriga yaxlitlanganda 19
ustunli to'r 170,05 mm bo'lib bosma chegaradan chiqardi → pastga
yaxlitlash.

**Ko'z bilan ko'rish**: 12 so'zli krossvord → 15×17 to'r → `figurePng`
1854×1641 px @300 dpi (bo'sh va javob varianti) ko'rildi — raqamlar,
harflar, `Oʻ` bitta katakda to'g'ri chiqdi.

**Ochiq savollar**: (1) R0 shartnomasida `CrosswordModel.words[].answer`
— KATAK ro'yxati (`string[]`), bu yerda esa satr + `letters()`; ulashda
adapter kerak. (2) To'r o'lchami `gridSize` formada qolsinmi yoki
avtomatmi (kesilgan to'r baribir kichikroq chiqadi). (3) Bosma betda
«qora katak» ko'rinishi egasiga ko'rsatilsin.
