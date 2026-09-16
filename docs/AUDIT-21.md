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

### WP-A — krossvord dvigateli ✅ (2026-09-16…17)

Ikki bosqichda: avval R0 dan MUSTAQIL qatlamlar (grid/svg/input/prompts/
qoidalar — 4 kommit), keyin R0 substrati kelgach shartnomaga moslash va
dvigatelning o'zi (3 kommit). Jami **85 test, 31 mutatsiya o'ldirilgan**,
`tsc`/eslint toza.

**`buildCrosswordDoc(meta, values, opts: CrosswordBuildOpts) → Promise<GameBuilt | null>`**
(`GameBuilder` shartnomasi + `buildFigures`/`sourceTextOf`/`seed` seam lari).
Bo'lim id lari SHARTNOMA: **`grid · across · down · answers`**.

| Fayl | Nima | Testlar | Mutatsiya |
|---|---|---|---|
| `games/crossword/grid.ts` | `placeWords` — sof greedy + backtracking, harf→katak, raqamlash, ramka kesish, `autoGridSize`, determinizm | `crossword-grid` 22 | 7/7 |
| `games/crossword/svg.ts` | to'r SVG i mm o'lchovda (bo'sh + javob), `figurePng` uchun | `crossword-svg` 10 | 5/5 |
| `games/crossword/input.ts` · `prompts.ts` | forma → `CrosswordInput` (reyestr chegaralari, avtomat to'r); LLM faqat so'z+ta'rif, tur qoidalari reyestrdan | `crossword-engine` | 6/6 |
| `games/crossword/engine.ts` | `buildCrosswordDoc`, bo'limlar, figure o'rami, qo'shimcha so'rov, `delivered` | `crossword-engine` 35 | 12/12 |
| `games/crossword/polish.ts` | ta'rifni qayta yozish (so'z daxlsiz), `userNeeds` | (yuqoridagi) | (yuqoridagi) |
| `games/crossword/review.ts` | 10 qoida + baholovchi + `rescore` | `crossword-review` 18 | 7/7 |
| `games/engine.ts` | dispatch: krossvord → shu dvigatel, flesh kartalar → dinamik import | (yuqoridagi) | (yuqoridagi) |

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

**R0 shartnomasiga moslash** (2026-09-17): `grid.ts` endi R0 tiplarining
O'ZINI qaytaradi (`CrosswordWord`/`CrosswordGrid`/`CrosswordDropped`,
`clues` → `CrosswordClue`), adapter qatlami ATAYLAB yozilmadi — ikkinchi
shakl bo'lsa maket, hisobot va ko'ruvchi ertami-kechmi boshqa-boshqa
kataklarni ko'rardi. `answer` — KATAK harflari ro'yxati; satr kerak
bo'lganda bitta joyda (`wordText`) aylantiriladi. Chegaralar
`GAME_LIMITS` dan, tur qoidalari va baholovchi mezonlari reyestrdan.

**Egasining qarorlari bajarildi**: qora katak YO'Q (`blackCells: false`
standart, zich ko'rinish opsiya bo'lib qoldi); tutuq belgisi tashlanadi
(`sanʼat` → `SANAT`); `gridSize` AVTOMAT (`autoGridSize(wordCount)` →
`normalizeGridSize`), formada maydon yo'q.

**Dvigatel qarorlari**:
- qayta urinish TIL darajasida: sig'magan so'z o'rniga qisqaroq so'z
  so'raladi (BIR marta), to'r esa boshidan, to'liq ro'yxat bilan qayta
  quriladi — eski to'rga yamoq qo'yilsa ixchamlik yo'qolardi;
- `trimTo` — va'dadan ortiq so'z kesiladi (10 so'z so'ragan o'qituvchi
  13 so'zli to'r olmasin);
- javoblar bo'limida rasm BILAN BIRGA raqam→so'z ro'yxati: `sharp`
  yiqilsa ham javoblar yo'qolmaydi;
- sayqal TA'RIFNI qayta yozadi, SO'ZNI EMAS — aks holda to'r, raqamlar
  va javob varag'i qaytadan quriladi va bu «sayqal» emas, yangi
  krossvord bo'lardi; to'r bandlari hisobotda `manual` deb belgilanadi;
- hisobot qoidalari `GAME_RULE_IDS.crossword` (8) + WP-A ning 2 ta
  qo'shimchasi: `clueNotContainsAnswer` (eng qimmat nuqson, o'zak
  solishtiruvi bilan deterministik tutiladi) va `gridConnected`
  (baholovchining `gridConnectedness` mezonini faktga aylantiradi).

**Jonli tekshiruv** (mock LLM, haqiqiy `figurePng`): «Fotosintez» mavzusi,
10 so'z → 14×16 to'r, 9 kesishma, 0 tashlangan, **ball 97**, 10/10 qoida
yashil; bo'sh va javob to'rlari 1748×1535 px @300 dpi — ko'z bilan ko'rildi
(raqamlar, harflar, `Oʻ` bitta katakda).

**Lead uchun ochiq bandlar**: (1) `GAME_RULE_IDS.crossword` ga
`clueNotContainsAnswer` va `gridConnected` qo'shilsin (`registry.ts` WP-A
egaligida emas — hozircha `review.ts` ro'yxatni reyestr + qo'shimchalar
sifatida quradi); (2) `games/layout.ts planGame` javoblar bo'limini YANGI
BETDAN boshlashi kerak (`answerSeparate` reyestrda `true`); (3) jonli
sinov (`npm run live`) va LibreOffice ko'zi — R bosqichida.

### R — jonli holatlar, delivered/darvoza, zondlar (2026-09-17)

WP-A/WP-B/WP-C dan MUSTAQIL, `main`ga 479f353 gacha qo'shilib bo'lgan
qatlamlar ustiga: jonli tekshiruv urug'lari, pul/element darvozalari va
«bezak maydon yo'q» zondlari. WP-B (`games/flashcards/**`) va WP-C
(`infographic/engine.ts` tanasi, `infographic/input.ts`) hali STUB —
shu sababli bu ish ularga TEGMASDAN, ular ulanganda O'ZI ishga
tushadigan shartnoma yozadi (AUDIT-20 naqshi).

**`scripts/live-engine.mts`** — 4 yangi holat (`--list` bilan
tekshirildi, LLM chaqirilmadi):

- `crossword` («Fotosintez», 10 so'z, klassik) va `crossword-file`
  (`--source <docx>` — fayl rejimi) BIR XIL `crosswordChecks()` dan:
  `doc.game.crossword` bor, so'z ≥ wordCount−1 (dropped ≤1), to'r
  ≤21×21, kesishma ≥ so'z/2 (`countGridCrossings`, WP-A dan import),
  bo'limlar `grid·across·down·answers` (`CROSSWORD_SECTION_IDS` bilan
  solishtiriladi — QO'LDA qayta yozilmadi), figure 2 ta, hisobot ≥55,
  `cost.calls>0`, `delivered` mos, DOCX 2–4 bet, fayl nomi
  `-krossvord`; fayl rejimida qo'shimcha `--source` mavjudligi.
- `flashcards` (10 ta term-def, misol bilan): `doc.game.cards` 10,
  old/orqa yuz `GAME_LIMITS` chegarasida, misol qatori, hisobot,
  `delivered`; **DOCX bet soni YUMSHOQ** (`pages >= 1`) — WP-B ning
  `drawCards`/`gameFlow` maketi kelmaguncha 2×4 duplex bet sonini
  qat'iy talab qilib bo'lmaydi (mahsulot egasi ko'rsatmasi).
- `infographic` (`process` turi, 5 blok): PNG mavjudligi, o'lcham
  `sharp` bilan HAQIQIY o'qiladi va A4 @300dpi ≈2480×3508 px ga ±2%
  solishtiriladi, `doc.infographic.spec.blocks` 5, hisobot ≥55,
  `cost.calls>0`. Buning uchun `Case.checks` imzosi
  `Check[] | Promise<Check[]>` ga kengaytirildi (`runCase` da
  `await`) — qolgan 29 holat sinxron qolib, xatti-harakati o'zgarmadi.
- WP-B/WP-C hali ulanmagan holatda maxsus «yiqilish» kodi YOZILMADI:
  `buildGameDoc`/`buildInfographicArtifact` `null` qaytaradi →
  `buildArtifact` mavjud xato matnini tashlaydi → `runCase`ning
  `try/catch` i buni «✘ XATO» deb ANIQ ko'rsatadi. `checks()` funksiyasi
  bu holda umuman chaqirilmaydi, ya'ni soxta yashil FIZIK jihatdan
  bo'lishi mumkin emas.
- `doc.json` yozuvi ikki yangi shoxga qo'shildi (`file.doc.game` /
  `file.doc.infographic`) — WP-B/WP-C maketi va ko'ruvchi paritetini
  o'lchash uchun urug', teacher/work naqshi bilan bir xil.

**`scripts/seed-demo.mts`** — `crossword`/`flashcards`/`infographic`
uchta namuna, `live-engine.mts` dagi keyslar bilan AYNI qiymatlar
(demo — jonli sinovda tekshirilgan aniq holatni ko'rsatsin). Ishga
TUSHIRILMADI (LLM/kredit sarfi — egasi hisobiga bo'lsa ham lead qaror
qiladi).

**`lib/generation/delivered.ts`** — `doc.game`/infografika shoxi:

- `gameDelivered(meta, doc, values)` — krossvordda VA'DA
  `crosswordInputFromValues(meta, values).wordCount` (WP-A ning O'ZI,
  ikkinchi hisob-kitob YO'Q), GOT `crossword.words.length` (to'rga
  JOYLASHGAN so'z, `dropped` hisobga olinmaydi), unit **«so'z»**;
  kartalarda VA'DA `normalizeGameCount(values.cardCount ?? values.count)`
  — R0 ning umumiy normalizatori, `games/flashcards/input.ts` (WP-B)
  ULANMASA HAM ishlaydi va WP-B ulangach AYNI sonni beradi (ikkalasi
  bitta chegara ro'yxatidan o'qiydi), unit **«karta»**. `deliveredCount`
  ichida `doc.teacher` shoxidan keyin, eski `switch(meta.toolId)` dan
  OLDIN tekshiriladi — krossvord/kartalar avvalgi `default: undefined`
  ga tushardi.
- `infographicDelivered(values, got)` — EXPORT qilingan, lekin
  `deliveredCount` ICHIDAN chaqirilmaydi: infografika `AcademicDoc`
  yo'lidan o'tmaydi (`buildInfographicArtifact` `BuiltFile`ni
  to'g'ridan-to'g'ri qaytaradi, `rasm` vositasi naqshida). VA'DA
  `normalizeBlockCountFor(values.infographicType, values.blockCount)`
  (WP-C ning R0 substrati, tur chegarasiga kesilgan), unit **«blok»**.
  WP-C dvigateli buni `packImages` naqshida O'ZI chaqiradi (PNG
  chizilgandan keyin, blok sonini bilgach) — chaqiruv joyi shu WP da.

**`lib/generation/index.ts`** — `gameGateFail(meta, values, doc)`,
`teacherGateFail` bilan AYNI o'rinda (`buildArtifact` ichida, ketma-
ket) chaqiriladi: krossvord/kartalar ELEMENT darvozasi, `GAME_COUNT_RATIO
= 0.7` (glossariy/keys bilan bir xil ulush). Model YO'Q → xato; model
BOR-u element floor dan kam → xato (`crossword.words`/`flashcards.cards`
qoidasi). `doc.game` yo'q bo'lsa (boshqa vosita, yoki WP-B hali
ulanmagan — bu holatga darvoza UMUMAN yetib kelmaydi, chunki
`writeWithLlm` oldinroq `null` bilan to'xtaydi) — `null`, jim o'tadi.

**`tests/game-wiring.test.mts`** (11 test, 4 mutatsiya o'ldirilgan —
qo'lda tekshirildi, avtomatlashtirilmadi): darvoza chegarasi
(krossvord/kartalar, 6/10 yiqiladi, 7/10 o'tadi), `doc.game` yo'q →
`null`, model yo'q → xato, `index.ts`da chaqiruv borligi (manba
matnidan `assert.match`), `deliveredCount` unit va son (krossvord/
kartalar/glossariy — oxirgisi `doc.game` shoxi glossariy yo'liga
«sizib» qolmasligini qulflaydi), `infographicDelivered` (ikki tur —
`process` max 6, `list` max 8), fayl nomi qo'shimchasi (uch vosita
noyob), `buildGameDoc` dispatch (kartalar hali `null` — WP-B ulanguncha
ANIQ tekshiriladi).

**`tests/game-params.test.mts`** (6 test) va **`tests/infographic-
params.test.mts`** (5 test) — reyestr butunligi (id noyob, impacts
bo'sh emas, narx ta'siri YO'Q) HAR DOIM to'liq sinaladi; differensial
zond esa dvigatel bor joyda (krossvord — `crosswordInputFromValues`,
WP-A) HAQIQIY probeA/probeB farqini o'lchaydi, yo'q joyda
(`games/flashcards/input.ts`, `infographic/input.ts`) yo'l
O'ZGARUVCHIDA dinamik import bilan sinaladi va topilmasa
`ENGINE_NOT_WIRED` ro'yxatiga yozilib o'tkazib yuboriladi — bu holatda
ham «hamma kutilgan parametr o'tkazib yuborildimi» tekshiriladi (soni
mos kelmasa test qizaradi), ya'ni WP ulanib ketsa-yu zond jim
o'tkazilib qolsa buni HAM ushlaydi.

**`tsc --noEmit` va `eslint`** — toza (`lib/generation/index.ts`,
`delivered.ts`, `scripts/live-engine.mts`, `scripts/seed-demo.mts`, uch
yangi test fayli).

**Ochiq bandlar (keyingi WP/R uchun)**:

1. WP-B (`games/flashcards/**`) va WP-C (`infographic/engine.ts` tanasi,
   `infographic/input.ts`) ulangach: `game-params.test.mts`/
   `infographic-params.test.mts` dagi `ENGINE_NOT_WIRED` shoxi o'zi
   nol bo'lib qoladi (assertlar buni allaqachon tekshiradi — qo'shimcha
   o'zgarish shart emas), `live-engine.mts` dagi 3 holat
   (`flashcards`/`infographic`/`crossword-file` fayl qismi) birinchi
   marta HAQIQIY natija beradi.
2. `npm run live -- crossword flashcards infographic` va
   `npm run seed -- adkhambek_4 crossword flashcards infographic` —
   ISHGA TUSHIRILMADI (LLM/kredit sarfi), lead qachon o'tkazishini
   o'zi hal qiladi.
3. `infographicDelivered` chaqiruvi WP-C ning O'ZIGA qoladi (`engine.ts`
   ichida, PNG chizilgandan keyin) — bu fayl faqat FUNKSIYANI tayyorlab
   qo'ydi va `tests/game-wiring.test.mts` unga TO'G'RIDAN-TO'G'RI
   (WP-C mavjud bo'lmagan holatda) test yozdi.

### WP-C — Infografika (opus, 2026-09-17) ✅

R0 ning STUB dvigateli (`null`) to'liq quvurga aylandi: forma →
`InfographicSpec` (LLM) → maket → rangli SVG → PNG 300 dpi → hisobot →
avto-sayqal → `packImages`. R0 shartnomasi (`buildInfographicArtifact`
imzosi va `null` xulqi) O'ZGARMADI, `index.ts` shoxi tegilmadi.

**Ikonlar** (`scripts/gen-icons.mts` → `infographic/icons.ts`,
`data/ICONS-LICENSE.md`): `@tabler/icons@3.46.0` DEV bog'liqlik, build
vaqtida 41 ikonning 24×24 `d` satrlari ko'chiriladi — runtime bog'liqlik
YO'Q (paket 50 MB va u JS moduli emas, SVG FAYLLAR to'plami; undan
runtime da o'qish `fs` demakdir va `infographic/svg.ts` izomorf bo'lmay
qolardi). **R0 ochiq savoli 3 yopildi:** `ICONS` dagi 41 nomdan 40 tasi
Tabler da AYNI nom bilan bor, yagona farq — `sigma` (Tabler da `sum`).
`types.ts` o'zgartirilmadi: `ICONS` PROMPTGA tushadi va model uchun
«sigma» yig'indi belgisi, «sum» esa pul summasi bilan adashtiradi;
moslik generatorning `ALIASES` jadvalida.

**Maket** (`infographic/layout.ts`) — SOF, IZOMORF va RANGSIZ. Birlik
MILLIMETR (`viewBox="0 0 210 297"`): hisobot §3 jadvali mm da yozilgan
va `figurePng({widthMm})` ham mm kutadi. A3 — A4 ning MASSHTABI
(k = 297/210): plakat devorga osiladi, kattaroq varaqda shrift ham
kattalashishi kerak. Yetti tur: ro'yxat, jarayon (raqamli zanjir),
taqqoslash (2 ustun, juft qatorlar), statistika (katta raqam),
xronologiya (vertikal chiziq + sana), sabab-natija (2 guruh + markaziy
o'q), tuzilma (ildiz + shox + ikki daraja). `overflow[]` — `noOverflow`
qoidasining manbasi. TIL maketga TA'SIR QILADI: manba prefiksi va
sabab/natija ustun nomlari uz/ru/en (noma'lum til — INGLIZCHA), RTL
tillarda butun maket ko'zguda aks etadi.

**SVG** (`infographic/svg.ts`) — **tadqiqot §6 ochiq savoli 4 shu tarafga
hal qilindi:** `figures/svg.ts` (monoxrom, `STROKE = "#000"` qattiq
yozilgan) TEGILMADI, rangli chizuvchi ALOHIDA fayl. Rol → palitra
JUFTLIGI jadvali (`fillOf`/`inkOf`) — `types.ts` da WCAG bo'yicha
qulflangan juftliklarning yagona ijrochisi. `<svg width>` BIRLIKSIZ:
`210mm` yozilsa librsvg zichlikni ikki marta qo'llab A4 @300 dpi ni
2480 o'rniga 7027 px qilardi.

**Dvigatel** (`engine.ts`): bir martalik qayta so'rov (faqat maket/miqdor
bandlari uchun va faqat javob YAXSHILANSA qabul), IKKI RENDER bitta SVG
dan — fayl 300 dpi (2480×3508), eskiz 110 dpi (≈910 px) `doc.images` ga
`data:` URL bo'lib tushadi (300 dpi li base64 `doc_json` ga ≈1.5 MB
qo'shardi); sayqal QABUL qilinsa plakat QAYTA CHIZILADI; `delivered`
blok soni bo'yicha.

**Hisobot** (`review.ts`) — §4 ning o'nta bandi. Halollik bandi RAQAMNI
ajratib oladi va foydalanuvchi matnidagi raqamlar bilan solishtiradi,
ya'ni «to'g'ri, lekin berilmagan» foiz ham rad etiladi (§5 dagi «71%
Yer yuzasi suv» misoli). `contrast` runtime emas — band foydalanuvchiga
«tekshirildi» deb aytadi. **Sayqal** (`polish.ts`) `runPolishWith`
yadrosida, lekin NISHON BITTA (`spec`): plakat bloklari o'zaro bog'liq.

**KO'Z SINOVI** (7 tur × A4 PNG, uch aylanish) — topilgan va tuzatilgan
oltita nuqson:

1. kartalar panjarani to'ldirib, ichida 50 mm bo'sh joy qoldirardi →
   `cardNeed` (tabiiy balandlik) + `fitRows` (qolgan joy ORALIQQA,
   `growMax` 1.15, guruh markazda, mazmun karta ichida vertikal markazda);
2. 5 blokli plakatda oxirgi karta chap ustunda yolg'iz qolardi → toq
   qator BUTUN kenglikni oladi;
3. `compare`/`cause-effect` ustun tasmasi mazmun tepasiga qotib turar,
   kartalar markazga tushardi (orada 40 mm bo'shliq) → tasma kartalardan
   KEYIN, birinchi qator `y` idan chiziladi;
4. tuzilmada shoxdan kartagacha uzun bo'sh chiziq → butun daraxt birga
   markazlashtiriladi, katakchalar 1.6 gacha cho'ziladi;
5. `statLabel`/`source` siyohi 28 % edi — deyarli ko'rinmasdi → 62 %;
6. ustun tasmasining ikkinchisi yengil tint ustiga OQ matn qo'yardi
   (1.1:1) → `accent`+`onAccent` qulflangan juftligiga.

**Testlar:** `infographic-layout` 27, `infographic-svg` 13 (ikon qamrovi
+ PNG o'lchami), `infographic-engine` 19, `infographic-review` 17,
`infographic-params` 5 (differensial zond). `npm test` 2 144 yashil,
`tsc`/eslint toza.

**Mutatsiyalar (21 ta, har biri qizardi):** `fitRows growMax` ·
`fit().clipped` doim `false` · toq qator shoxi · A3 masshtabi `k=1` ·
`mirror()` chaqiruvi · `order` bo'yicha saralash · `icons.ts` dan
`sigma` · `iconPaths` fallback · `<svg width>` ga `mm` · `columnHeadAlt`
siyohi · `textSvg` dagi `xmlEscape` · `normalizeSpec` turni modeldan
olishi · qayta so'rov shoxi · `delivered` hisobi · eskiz 300 dpi da ·
sayqaldan keyin qayta chizmaslik · `groundedIn` doim `true` ·
`noOverflow` maketni qayta hisoblamasligi · `compare` ustun muvozanati ·
`statPresent` turni tekshirmasligi · `userNeeds` manba shoxi.

**Qo'shimcha:** `infographic-params.ts` ga `budget` ta'siri qo'shildi
(`blockCount` → `infographicBudgetMs`) — R0 uni e'lon qilmagan edi va
zondning «o'lik ta'sir yo'q» bandi qizarardi.

**Ochiq savollar (WP-C dan):**

1. `textWordsMax` 160 hali ham egasi tasdig'ini kutadi (R0 savoli 1).
   WP-C da amalda sinaldi: 8 blokli A4 plakat 160 so'z bilan
   `noOverflow` dan o'tadi, 200 so'zda esa kesiladi — ya'ni 160
   maketning O'Z chegarasiga yaqin.
2. Sabab-natija ustun nomlari (`Sabablar`/`Natijalar`) va manba
   prefiksi faqat uz/ru/en da; qolgan 15 tilda INGLIZCHA chiqadi.
   Forma hozir shu uch tilni beradi (`TARGET_LANGUAGES`), lekin
   hisobot 18 til deb yozgan — qaysi biri to'g'ri?
3. A3 hozir A4 ning masshtabi (matn hajmi bir xil). Egasi «A3 da
   ko'proq blok» ni xohlaydimi (masalan 8 → 12)?
4. PDF o'rami (bir betlik DOCX) hali yo'q — reja bo'yicha «tadqiqotdan
   keyin»; hozir chiqish faqat PNG.
- **R (lead) — birlashtiruv va jonli (1)**: R0 (`9e4a0cf`), WP-A (`96244bd`, qoidalar reyestrga `479f353`), WP-F (`a661dcb`), WP-C (`ac4f91d`; `tests/infographic-params` — WP-C nusxasi olindi, `@tabler/icons` devDep o'rnatildi) main da. Jonli: **krossvord** ✔ (10/10 so'z, 15×14, 9 kesishma, 3 bet, 8,8 s, 2 chaqiruv), **infografika** ✔ (PNG 348 KB 2480×3507, 5 blok, 6,8 s, 1 chaqiruv) — ko'z: shapka tasmasi, raqamli zanjir, ikonli kartalar, o'zbekcha matn to'g'ri. Eslatma: Anthropic kaliti hamma joyda tugagan (`credit balance too low`) → baholovchi Gemini flash (100 ball). OMR composer testi (AUDIT-20 qoldig'i) tuzatildi (`e77ea93`).
### WP-B — flesh kartalar + `planGame` (yagona maket) ✅ (2026-09-17)

`planGame(doc)` — IKKALA kind uchun YAGONA MANBA (`planTeacher` naqshi):
DOCX (`render-docx.ts drawGame`) ham, ko'ruvchi (`lib/viewers/flow.ts
gameFlow` → `WordViewer gameSheet`) ham faqat shu rejani chizadi.

```ts
planGame(doc: AcademicDoc): GamePlan
GamePlan = { model, kind, type, language, labels,
             head: GameHeadItem[],        // krossvord: title/subtitle/field
             body: GameBodyItem[],        // h1 · h3 · p · li · note · clues · cards · figure
             tables: [], pageBreaks: string[], landscape: false,
             page: { marginsCm, sizePt, line, tableSizePt, smallPt,
                     card: { wMm, hMm, cols, rows, padMm, headMm, backPt, examplePt } },
             headingAlign: "left" }
```

**Ikki kind — ikki manba, ATAYLAB:** krossvord BO'LIM BLOKLARIDAN
(`crosswordSections` — ko'rsatma, savol, javoblar hujjatning O'ZIDA
yozilgan matn; `path` = `sections.<i>.blocks.<j>`, teacher shartnomasi),
kartalar esa MODELDAN (`game.cards`; `path` = `game.cards.<k>.front|back`)
— nasrda old yuz bilan orqa yuz ajralmaydi (`h3` + `p`) va panjarani
bloklardan qayta yig'ish «qaysi paragraf qaysi kartaniki» degan taxminga
tayanardi. Nasr baribir quriladi (`cardSections`): hisobot, baholovchi va
qidiruv shuni o'qiydi.

**Kartalarda HUJJAT SHAPKASI YO'Q** — bu maketning markaziy qarori.
Kartalar duplex bosiladi va old bet bilan orqa bet KATAKMA-KATAK ustma-ust
tushishi kerak; birinchi betning tepasidagi sarlavha old betni pastga
surib, kesilgan kartaning orqasida QO'SHNISINING ta'rifini qoldirardi.
O'rniga har betda BIR XIL BALANDLIKDAGI ikki qatorli varaq shapkasi
(««Mavzu» · 1/2-varaq · old yuzlar» + duplex ko'rsatmasi).

**Oynali orqa tartib** (`mirrorRow`): «flip on long edge» da portret
varaqning uzun chekkasi chap/o'ngda, ya'ni QATOR ICHIDA ustunlar almashadi
(`[A B] → [B A]`), qatorlar tartibi esa O'ZGARMAYDI. Bo'sh kataklar ham
oynalanadi (to'lmagan oxirgi varaq).

**A7 geometriyasi — halol yozuv (chekinish).** R5 §1 dagi «A7 74×105 mm,
A4 da 2×4» PORTRET A4 da mumkin emas: 4 × 105 = 420 mm > 297 mm. A4 ni
sakkizga bo'lish A7 ni YOTIQ qo'yishni talab qiladi (2 × 105 = 210,
4 × 74 = 296 mm) — chegara uchun joy qolmaydi. Shuning uchun katak A7
NISBATINI (105:74) saqlab bosiladigan maydonga sig'diriladi (`cardCellMm`,
sof funksiya): 10 mm chegara + varaq shapkasi bilan **92,0 × 64,9 mm**.
`GAME_LIMITS.cardWidthMm/cardHeightMm` NOMINAL o'lcham (nisbat manbasi)
bo'lib qoladi, `CARDS_PER_SHEET = 8` esa shartnoma.

**Dvigatel** (`games/flashcards/{input,prompts,engine,review,polish}.ts`):

- `buildFlashcardsDoc(meta, values, opts)` — `games/engine.ts buildGameDoc`
  dinamik import bilan chaqiradi; `complete("writer")` + `CostMeter`,
  normalizatsiya (`clipWords` SO'Z chegarasida kesadi — matn katakdan
  chiqmasin), dublikat (`frontKey`), yetishmasa BIR qo'shimcha so'rov,
  70 % darvozasi, `delivered {got, want, unit: "karta"}`;
- `review.ts` — 6 qoida (`cardCount`, `frontLength`, `backLength`,
  `noDuplicate`, `examplePresence`, `cardTypeMatch`) + 5 mezonli
  baholovchi (`CARDS_JUDGE_CRITERIA`). `cardCount` VA'DANI hujjatdan
  tiklaydi: son reyestr chipi (5/10/15/20) bo'lmasa — kamomad;
  `examplePresence` «so'ralmagan» bilan «berilmagan» ni ajratadi;
- `polish.ts` — karta MODEL shaklida qayta yoziladi (AUDIT-20 glossariy
  saboqi: nasr yo'li `h3` larni yeb qo'ygan edi), karta SONI saqlanadi
  (kam qaytgan javob rad etiladi), `applyCardsOps` model VA nasrni
  BIRGA almashtiradi.

**Quvur:** `gameProfile(kind)` (kartalar 10 mm chegara, TNR 14/1,0;
krossvord portret TNR 12/1,15; ikkalasida `titlePage: "none"`) ·
`drawGame` (katak kengligi va qator BALANDLIGI millimetrda,
`HeightRule.EXACT`; kesish chizig'i — nuqtali katak chegarasi; savollar
chegarasiz 2 ustunli jadval; jadval chegarasi JADVAL darajasida ham aniq
yoziladi, chunki `docx` standart `single` ni yozadi va LibreOffice katakni,
Word jadvalni tinglaydi) · `gameFlow` → `WordViewer` (tahrirsiz —
panjara maketning O'ZI) · `packPages` karta varag'iga majburiy uzilish ·
`sampleGameDoc` (kartalar 10 ta; krossvord WP-A ning O'Z quvuridan:
`placeWords` → `crosswordSections` → `crosswordFigure`) · to'r rasmining
CHOP ETILADIGAN kengligi `FigureSpec kind:"svg" widthMm` dan (DOCX ham,
ko'ruvchi ham).

**Testlar:** `game-layout` 20, `game-docx` 11, `flashcards-engine` 18,
`flashcards-review` 17, `viewer/game-parity` 10. `npm test` 2 201 yashil,
`test:viewer` 211, `test:ui` 234 — hammasi yashil; `tsc`/eslint toza.

**Mutatsiyalar (har biri qizardi):** oynali tartibni olib tashlash
(`mirrorRow` chaqiruvi) · varaqni 8 emas 4 kartaga bo'lish · karta
varag'idan `pageBreak` ni olib tashlash (DOCX va `packPages` ikkalasi
ham qizardi) · `cardCount` bandini doim yashil qilish · `frontLength`
chegarasini reyestr o'rniga qattiq songa bog'lash · qo'shimcha so'rov
aylanishini o'chirish · qator balandligini `EXACT` dan `ATLEAST` ga
almashtirish (**LibreOffice ko'zi ham qizardi** — orqa betdagi uzunroq
ta'rif qatorni cho'zib, kesish chiziqlarini siljitdi).

**LibreOffice ko'zi (avtomatlashtirilgan):** 10 karta → AYNAN 4 bet
(2 old + 2 orqa), krossvord 2 bet, ikkalasi ham portret. Old va orqa
betlar PNG ga o'girilib, QORA PIKSEL PROFILI solishtiriladi: nuqtali
kesish chizig'i bet enining 0,67 ini qoplaydi (eng zich matn qatori —
0,55), ikkala betda ham chiziqlar AYNAN bir xil piksel qatorida
(51/230/408/587/766 @70 dpi). Ko'z bilan ham ko'rildi: old bet
[Fotosintez | Xlorofill], orqa bet [Xlorofill ta'rifi | Fotosintez
ta'rifi] — oyna to'g'ri.

**Ochiq savollar (lead uchun):**

1. **Karta o'lchami 92 × 64,9 mm** — A7 (74 × 105) EMAS. Egasi
   tasdiqlasinmi? Muqobil: A4 ni ALBOM qilib 4 × 2 joylashuv (o'shanda
   katak A7 ga yaqinroq, lekin `landscape` va varaq shapkasi qaytadan
   o'ylanadi).
2. Varaq shapkasi (mavzu + varaq raqami + duplex ko'rsatmasi) HAR betda
   takrorlanadi — bu ataylab (balandlik o'zgarmasin), lekin bosmada
   «shovqin» deb qaralishi mumkin. Ko'rsatmani faqat BIRINCHI betda
   qoldirish maketni buzadi.
3. `FlashcardsModel` da VA'DA (`want`) maydoni yo'q; `cardCount` bandi
   uni reyestr chipidan tiklaydi. Maydon qo'shilsinmi (`types.ts` —
   R0 egaligida)?
4. Flesh kartalarda FAYL rejimi yo'q (AUDIT-21 §6 savol 5 hali ochiq) —
   `modes` qo'shilsa `prompts.ts` ga `sourceBlock` kerak bo'ladi.

### WP-D — Hisobot + avto-sayqal + «Hammasini tuzatish» (2026-09-17) ✅

AUDIT-20 qaror 4 ning («hisobot + avto-sayqal + «Hammasini tuzatish»
HAMMASIDA») oxirgi uch vositasi. Dvigatel sayqali WP-A/WP-B/WP-C da
allaqachon bor edi; yetishmagani — NATIJA SAHIFASI: hisobot paneli
o'yin/plakat hisobotini umuman o'qimasdi va «Hammasini tuzatish»
serverga yetib bormasdi.

**Ildiz sabab:** butun sayqal serveri (`doc-polish.ts`) `loadDocForEdit`
ga tayanardi, u esa TAHRIR ADAPTERINI talab qiladi. Krossvord, flesh
kartalar va infografikada adapter ATAYLAB yo'q (so'z/karta/spec qo'lda
o'zgarsa to'r, A7 panjarasi yoki plakat hujjatdan ajralib ketardi) —
ya'ni hisoboti to'liq hujjat 409 `legacy` olardi. Sayqal endi tahrirdan
AJRATILDI:

- `loadDocForPolish` — adapter SHART EMAS; adapterli hujjatlarda darvoza
  aynan eskisi (`adapter.hasModel`), shuning uchun eski maqolaning
  «Tuzatish» i o'zgarmadi.
- `Polisher` shartnomasiga uch maydon: `docOf` (op lar o'rniga
  HUJJATNING O'ZI — sayqal yadrosi uni `apply` bilan allaqachon
  yasagan), `htmlOf` va `rebuild`.
- `commitPolishedDoc` — `commitDocOps` ning adaptersiz egizagi: egalik
  va `doc_version` SQL predikatida, bitta tranzaksiya, `doc_prev`.

**Fayl versiyasi — eng nozik joy.** Bu oilalarda `POST …/rebuild`
ishlamaydi (u adapter renderini so'raydi), shuning uchun `file_version`
HAR yozuvda `doc_version` ga tenglashtiriladi. Tenglashtirilmasa natija
sahifasi abadiy «Fayl yangilanmoqda…» deb turar va «Yuklab olish» har
bosishda 409 `legacy` olardi — ya'ni sayqal hujjatni YUKLAB BO'LMAYDIGAN
holatga keltirardi. Sayqal QABUL qilinganda esa fayl shu tranzaksiyada
qayta yasaladi: `renderGameFile` (DOCX) / `renderPosterFile` (PNG +
`posterHtml` + yangi eskiz `doc.images[0]`). Yasab bo'lmasa hujjat ham
YOZILMAYDI (422 `render`) — aks holda ekranda yangi matn, faylda eski
plakat qolardi.

**Krossvord konteksti.** `runCrosswordPolish`/`crosswordContextOf` —
dvigateldagi `runPolishWith` chaqiruvining server varianti: dvigatel
`input`/`spec`/`place` ni formadan biladi, server esa faqat saqlangan
hujjatni ko'radi. VA'DA qilingan so'z soni HISOBOTDAN o'qiladi
(`wordCount` bandi «7 / 10 so'z to'rga tushdi» deb yozib qo'ygan):
`words.length` dan hisoblansa qayta hisobotda o'sha band O'ZI yashil
bo'lib qolar, ball soxta oshar va Q-3 darvozasi hech narsani ushlamasdi.
`CROSSWORD_ACCEPT_DELTA` `polish.ts` ga ko'chdi (dvigatel va server
bitta qiymatdan o'qisin), `engine.ts` uni re-eksport qiladi.

**Bandma-band «Tuzatish»** (`article-rewrite.ts`): krossvordda `clues`
nishoni (to'r bandlari 422 `target` — ularni faqat qaytadan yaratish
tuzatadi), kartalarda `cards`; plakatda YO'Q — 422 `infographic`,
chunki nishon bitta (`spec`) va har tuzatish butun plakatni qayta
chizdiradi, ya'ni bu «Hammasini tuzatish» ning baholovchisiz nusxasi
bo'lardi (insho bilan bir xil qaror, boshqa ildizdan). O'yin
«Tuzatish» i ham DOCX ni shu yerda qayta yasaydi.

**Panel** (`ResultView`): hisobot manbasi endi OLTI model —
`article ?? essay ?? work ?? teacher ?? game ?? infographic`.
«Manbalar» va «Vizuallar» guruhlari o'yin va plakatda ham yashiriladi
(`hideGroups`, insho ro'yxati bilan aynan bir xil): bu oilalar manba
keltirmaydi va sxema chizmaydi, bo'sh guruh esa «manbalar
tekshirilmadi» deb o'qilardi. «Tahrirlash» ko'rinmaydi va bu panelda
emas, `edit-adapters.ts` da hal qilingan (adapter yo'q → `editableTools()`
da yo'q → `WordViewer` `editable` false).

**`assets.ts` — R0/WP-A da ulanmagan joy:** `doc.game.figures`
(krossvord to'ri va javob varag'i PNG i) aktivga chiqmasdan, `doc_json`
ichida `data:` bo'lib qolardi. Ikki oqibati bor edi: har ochilishda
yuzlab kilobayt ortiqcha JSON, va sayqaldan keyingi DOCX
(`assetImageResolver` faqat `assetId` dan o'qiydi) TO'RSIZ chiqardi.

**Qo'llab-quvvatlash jadvali** (AUDIT-20 qaror 4 bo'yicha):

| Vosita | Hisobot | Avto-sayqal (dvigatel) | «Hammasini tuzatish» | Bandma-band «Tuzatish» | Tahrir |
|---|---|---|---|---|---|
| krossvord | ✅ | ✅ | ✅ (DOCX qayta) | ✅ `clues` | ❌ (ataylab) |
| flesh kartalar | ✅ | ✅ | ✅ (DOCX qayta) | ✅ `cards` | ❌ (ataylab) |
| infografika | ✅ | ✅ | ✅ (PNG qayta) | ❌ 422 | ❌ (ataylab) |

**Testlar:** `doc-polish-route` 7 → 14 (+7: reyestr va
`polisherIdFor`, krossvord qabul, krossvord 422 `nothing`/409 `legacy`,
kartalar qabul, plakat qabul, plakat 422 `render`, bandma-band
«Tuzatish» + 422 `infographic`), `viewer/article-review-panel` 8 → 9
(review manbasi OLTI model, `hideGroups` chizmaydi),
`assets-article` 6 → 7 (o'yin rasmlari aktivga). `test:viewer` 212
(210 yashil — 2 qizil PARITET, pastdagi ochiq band), `tsc`/eslint toza.

**Mutatsiyalar (har biri qizardi):** (1) review manbasidan `game`/
`infographic` shoxini olib tashlash; (2) `hideGroups` ni faqat inshoga
qoldirish; (3) `applyClueOps` bo'lim bloklarini yangilamay qo'yish
(model sayqallanar, `across` eski matnda qolardi — ikkita test); (4)
`markFileVersion` ni olib tashlash (fayl abadiy eskirgan holatda
qolardi); (5) `rebuild` qaytargan yangi eskizni e'tiborsiz qoldirish
(ekranda eski plakat, faylda yangisi); (6) `assets.ts` dagi `game`
shoxini olib tashlash.

**Ochiq bandlar:**

1. **`tests/viewer/game-parity` 2 ta qizil — WP-D DAN OLDIN ham qizil.**
   Sabab `9c5e8fa` («krossvord savollari jadvali har savol o'z
   qatorida»): u `render-docx.ts` da savollar jadvalini ustunlar bo'yicha
   emas, QATORLAR bo'yicha chiqaradigan qildi, ya'ni DOCX matn tartibi
   `Gorizontal → 4,6 → Vertikal → 1,2,3,5` bo'ldi, ko'ruvchi
   (`gameFlow`) esa eski tartibda qoldi. Paritet testi ham
   yangilanmagan. Egasi: krossvord WP — `games/layout.ts`/`flow.ts` ni
   DOCX ga moslash yoki teskarisi (WP-D `render-docx`/`layout` ga
   tegmaydi).
2. **Jonli sinov qilinmadi** (LLM kaliti/kredit): server yo'li stub
   bilan qulflangan, lekin haqiqiy krossvord/plakat ustida «Hammasini
   tuzatish» hali bosilmagan. Chromium smoke ham (AUDIT-20 §5 naqshi)
   lead navbatida.
3. **Plakat bandma-band «Tuzatish» 422** — panel tugmani umuman
   chizmaydi, lekin hisobotdagi `fix` maydonlari saqlanadi (sayqal
   ularni o'qiydi). Kelajakda «bitta bandni tuzat» kerak bo'lsa u
   baribir butun `spec` ni qayta yozadi — qaror hujjatlashtirildi.
