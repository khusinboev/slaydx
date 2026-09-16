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
