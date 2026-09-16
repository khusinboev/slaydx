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


### R0 — Substrat (lead, 2026-09-16) ✅

WP-A/WP-B/WP-C tayanadigan SHARTNOMA. Dvigatellar STUB (`null`) — vosita,
narx, byudjet, ko'ruvchi va forma ULAR YOZILGUNCHA ulanadi, shunda uch WP
bir-birini kutmasdan ketadi (AUDIT-20 R0 da ishlagan naqsh).

**Tiplar** (`lib/generation/games/types.ts`, `infographic/types.ts`):

- `GameKind = "crossword" | "flashcards"`; `GameModel` = `AcademicDoc.game`
  `{v, kind, type, language, topic, crossword?, cards?, figures?, review?,
  polish?, userNeeds?}`; `GAME_TOOL_IDS`/`GAME_TOOL_BY_KIND` — vosita ↔ kind
  yagona xaritasi (dispatch, byudjet, ko'ruvchi shundan o'qiydi).
- `CrosswordModel {words[{id, answer, clue, dir, row, col, number}], grid
  {rows, cols, cells}, clues{across[], down[]}, dropped[]}`.
  **`answer` — MATN emas, KATAK HARFLARI ro'yxati (`string[]`)**: R5 §6.4
  ochiq savolining javobi — `oʻ`/`gʻ` ikki kod nuqtasi, lekin bitta katak;
  satr bo'lganda `[...str]` «BOGʻ» ni to'rt katakka cho'zib, kesishma va
  raqamlashni siljitardi. `dropped[{answer, clue, reason}]` — to'rga
  sig'magan so'z (`delivered` manbasi).
- `FlashcardsModel {type: "term-def"|"qa", cards[{id, front, back, example?,
  hint?}], includeExample?}`. Oxirgi bayroq `GlossaryModel` dagi bilan ayni
  sabab: `examplePresence` bandi «so'ralmagan» bilan «berilmagan» ni
  ajratishi kerak, hisobot esa hujjatdan QAYTA hisoblanadi.
- `GAME_LIMITS`: so'z 3–15 katak, savol 10–150 belgi, to'r 13–21 (TOQ),
  5/10/15/20, old yuz 5–50, orqa yuz 20–200 belgi, A7 74×105 mm, A4 da 2×4.
- `InfographicSpec {title, subtitle?, type, blocks[3–8]{id, icon, heading,
  text, stat?{value,label}, when?, role?, side?, order?, parent?}, palette,
  size, language, source?}`; `InfographicModel` = `AcademicDoc.infographic`
  `{v, spec, review?, polish?, userNeeds?}`. `size`/`language` ATAYLAB spec
  ichida: WP-C ning `layoutInfographic(spec, palette)` i sof funksiya
  bo'lishi kerak (`planResume` naqshi).
- `INFOGRAPHIC_TYPES` — 7 tur (`list`/`process`/`compare`/`stat`/`timeline`/
  `cause-effect`/`map-structure`), uz/ru/en yorliq, blok chegarasi va
  `requires` (tur MAJBURIY maydonlari: `order`/`side`/`stat`/`when`/`role`).
- `PALETTES` — 6 palitra. Ranglar JUFTLIK bo'lib e'lon qilinadi
  (`dominant`+`onDominant`, `accent`+`onAccent`, `accentInk`+`surface`):
  bitta aksent ikkala ishni bajara olmaydi — amber (#F59E0B) qora matn
  ostida 6.87:1, lekin o'sha rang bilan yozilgan raqam oq fonda 1.97:1.
  **Chekinish:** `berry` aksenti hisobotdagi #059669 dan **#047857** ga
  o'zgardi — #059669 hisobotning O'Z qoidasidan (≥4.5:1) o'tmaydi (oq bilan
  3.77, qora bilan 3.92). `tests/infographic-registry` WCAG 2.1 formulasini
  HISOBLAB tekshiradi (ro'yxatga ishonmaydi) — 6 palitra × 5 juftlik.
- `ICONS` — 40 ta Tabler slug NOMI + `ICON_FALLBACK`; SVG `path` lar WP-C da.
- `INFOGRAPHIC_LIMITS`: matn ≤160 so'z (hisobot 120 ni tavsiya qilgan —
  8 blokda blokka 12 so'zdan qolar va hisobotning O'Z «yaxshi misol» i
  ham o'tmasdi), blok matni ≤40 so'z, sarlavha ≤80 belgi, A4 210×297 /
  A3 297×420 mm, 300 dpi.
- `FigureSpec kind:"svg" {svg, widthMm}` — TAYYOR SVG: `buildFigure` uni
  chizmaydi, faqat `figurePng` bilan PNG qiladi va kenglikni SPECDAN oladi
  (160 mm standarti A4 plakatga yaramaydi). `FIGURE_KINDS`/
  `SELECTABLE_FIGURE_KINDS` ga TEGILMADI — `omr`/`prisma` bilan bir xil
  qaror: SVG ni dvigatel quradi, LLM emas. Matn fallback i yo'q (chizilgan
  to'rni `li` ro'yxat bilan almashtirib bo'lmaydi), yiqilganda eski
  `url`/`assetId` tozalanadi.

**Reyestrlar** (`games/registry.ts`, `infographic/registry.ts`): krossvord
`klassik`/`tarifli` (ta'rifli turda savol pastki chegarasi 40 belgi),
kartalar `term-def`/`qa`, infografika 7 tur; `guidance[]` (en), `JudgeSpec`
(krossvord 5 / kartalar 5 / plakat 5 mezon, hisobotlar §4 dan), `GAME_RULE_IDS`
(+ `gridMatchesWords` — to'r va so'zlar ajralib ketmasin) va
`INFOGRAPHIC_RULE_IDS` (+ `typeFields`, `sourceGrounded`).

**Quvur:**

- `ToolId += crossword|flashcards|infographic`; `lib/tools.ts` 3 vosita —
  tekis 2 000, `custom` YO'Q (`StandardForm` yetadi), chiplar REYESTRDAN
  quriladi. Krossvordda `modes` topic|file (worker `sourceForJob` avtomat).
  `includeExample` — `chips`, `toggle` EMAS: `FieldKind.toggle` e'lon
  qilingan, lekin `FieldBlock` uni chizmaydi, ya'ni toggle formada
  ko'rinmasdi (aynan «bezak maydon»).
- `TOOL_GROUPS` + `visibleToolGroups()` — bo'lim yorliqlari YAGONA manbadan
  (`CreateGrid` va `Sidebar` dagi ikki nusxa olib tashlandi); vositasi yo'q
  bo'lim (`media`) chizilmaydi. `TOOL_ICONS` ga `puzzle`/`layers`/
  `pie-chart` va yo'qolib qolgan `list-checks` (AUDIT-20 da `test` ga
  berilgan, jadvalga qo'shilmagan — kartochka ikonkasiz chiqardi).
- `TEACHER_FIELDS` avtomat qo'shilishiga `output === "docx"` sharti:
  infografika o'qituvchi bo'limida, lekin PLAKAT — titul sahifasi yo'q,
  ya'ni muassasa/tuzuvchi maydonlari hech qayerga chiqmasdi.
- `viewerKind`: krossvord/kartalar → yangi `"game"` (`ArtifactViewer`
  `case "game"` → `WordViewer` tahrir proplari bilan; WP-B `gameFlow` ni
  ichiga qo'shadi), infografika → mavjud `"image"`.
- `budget.ts`: `gameBudgetMs(kind, n)` (20 so'z ≈ 120 s),
  `infographicBudgetMs(blocks)` (8 blok ≈ 150 s); `budgetFor` ularni
  `wordCount`/`cardCount`/`blockCount` dan o'qiydi (tur chegarasi bilan).
- `write-llm.ts` → `buildGameDoc` (STUB `null`): eski yozuvchilarga
  TUSHMAYDI (aks holda krossvord o'rniga referat chiqardi), `null` esa
  MAVJUD «AI javob bermadi» xulqini beradi. `index.ts buildArtifact` →
  `buildInfographicArtifact` (STUB `null`) `rasm` vositasi naqshida, PNG
  chiqish; `fileSuffix` += `-krossvord`/`-kartalar`/`-infografika`.
- Zond reyestrlari: `game-params.ts` (9 parametr), `infographic-params.ts`
  (7 parametr) — `impacts` + probeA/probeB; zondning O'ZI WP larda.

**Testlar:** `game-registry` 10, `infographic-registry` 11, `figures-png` +3,
`viewer-kind` +3, `pricing` +3, `generation` +3, `document`/`teacher-registry`
moslashtirildi. `npm test` 2 063 yashil, `test:viewer` 201 yashil,
`test:ui` 233/234 (yagona qizil — `teacher-composer` «omr» bandi,
**AUDIT-21 dan OLDIN ham qizil**, 8f4da9d da tekshirildi). `tsc`/eslint toza.

**Mutatsiyalar (har biri qizardi):** `berry` aksentini #059669 ga qaytarish ·
`process` turining 6 blok chegarasini 8 ga ko'tarish · `normalizeGridSize`
dagi toqlik shoxini olib tashlash · `buildFigure` dagi `svg` shoxini olib
tashlash · `GAME_RULE_IDS.crossword` dan `gridMatchesWords` ni o'chirish ·
`write-llm.ts` dagi `GAME_TOOLS` shoxini olib tashlash (krossvord referat
qaytardi) · `budgetFor` dagi o'yin shoxini olib tashlash · `buildArtifact`
dagi infografika shoxini olib tashlash · `ArtifactViewer case "game"` ni
proplarsiz yozish · bo'sh «Media» bo'limini ko'rsatish.

**Ochiq savollar (WP larga):**

1. `textWordsMax` 160 — egasi tasdiqlasinmi yoki hisobotdagi 120 ga
   qaytarilsinmi? (`INFOGRAPHIC_LIMITS`, bitta joyda.)
2. `berry` aksenti #047857 — dizayner ko'rsinmi? Qolgan 5 palitra
   hisobotdagidek.
3. Tabler slug lari (`ICONS`) WP-C boshida `@tabler/icons` paketidan
   TASDIQLANSIN — hozirgisi hisobotning konseptual ro'yxati.
4. Krossvordning `gridSize` parametri formada YO'Q (hisobot §6.1 ochiq
   savoli): to'r o'lchamini algoritm so'z uzunliklaridan o'zi tanlaydi.
   Egasi tanlov bersinmi?
5. Flesh kartalarda fayl rejimi yo'q (mavzudan tuziladi) — krossvorddagi
   kabi `modes` kerakmi?
6. `FieldKind` dagi `toggle` va `file` HECH QAYERDA chizilmaydi (o'lik
   qiymatlar) — o'chirilsinmi yoki `FieldBlock` ga qo'shilsinmi?

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
