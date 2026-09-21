# O'yinlar + Media (6 vosita) — StandardForm, natija sahifasi, navigatsiya auditi

Auditor xulosasi (FAQAT O'QISH). Ko'lam: krossvord/flesh kartalar (AUDIT-21),
saralash/tinglash/podkast/tabriknoma (AUDIT-22) — 6 vosita, hammasi
`ToolWorkspace.tsx:132-347` dagi `StandardForm` orqali chiziladi (alohida
composer yo'q). Etalon — `docs/research/forms3-etalon.md` (AUDIT-12…17,
`compact.tsx` primitivlari, ≈1100-1200 px @1400 yopiq, `docs/AUDIT-12.md:15-16`).

## 1. 6 forma inventari

`StandardForm` (`ToolWorkspace.tsx:132`) barchasida bir xil qobiq:
`ModeSwitch` (bor bo'lsa) → mavzu/fayl → `mainFields` (`FieldBlock`,
`fields.tsx:302-346`) → yopiq «Qo'shimcha (ixtiyoriy)» — faqat erkin matn
(`ToolChrome.tsx:48-58`, `ToolWorkspace.tsx:247-256`), HECH BIR haqiqiy
parametr emas.

| Vosita | Maydon | Turi | Majburiy | Standart (`ToolWorkspace.tsx:29-69`) | Chips | Reyestr `impacts` |
|---|---|---|---|---|---|---|
| Krossvord (`tools.ts:734-759`) | mode | modeswitch | yo'q | `topic` | 2 karta | ✓ `game-params.ts:80` |
| | wordCount | chips | yo'q | `10` (bor, :60) | 4 (5/10/15/20) | ✓ :96 |
| | crosswordType | chips | yo'q | `klassik` (bor, :61) | 2 | ✓ :97 |
| | language | language | yo'q | `uz` (global, :34) | 3 | ✓ :83 |
| Flesh kartalar (`tools.ts:760-778`) | cardCount | chips | yo'q | `10` (bor, :62) | 4 | ✓ :100 |
| | cardType | chips | yo'q | `term-def` (bor, :63) | 2 | ✓ :101 |
| | includeExample | chips (YES_NO) | yo'q | `yoq` (bor, :64) | 2 | ✓ :106 |
| | language | language | yo'q | `uz` (global) | 3 | ✓ :83 |
| Saralash (`tools.ts:800-821`) | sortingType | chips | yo'q | **YO'Q** ⚠ | 2 | ✓ :112 |
| | categoryCount | chips | yo'q | **YO'Q** ⚠ (`hideWhen`) | 5 (2-6) | ✓ :117 |
| | itemsPerCategory | chips | yo'q | **YO'Q** ⚠ | 5 (3-8) | ✓ :118 |
| | language | language | yo'q | `uz` (global) | 3 | ✓ :83 |
| Tinglash (`tools.ts:822-840`) | listeningType | chips | yo'q | **YO'Q** ⚠ | 2 | ✓ :121 |
| | nativeLanguage | language | yo'q | `uz` (fallback, `fields.tsx:331`) | 3 | ✓ :122 |
| | targetLanguage | language | yo'q | `uz` (fallback) | 3 | ✓ :123 |
| | itemCount | chips | yo'q | **YO'Q** ⚠ | 3 (10/15/20) | ✓ :124 |
| Podkast (`tools.ts:841-871`) | mode | modeswitch (3) | yo'q | `topic` | 3 karta | ✓ `audio-params.ts:78` |
| | sourceText | textarea | yo'q (mode=text da amalda kerak) | `""` | — | ✓ :86 |
| | podcastType | chips | yo'q | **YO'Q** ⚠ | 3 | ✓ :88 |
| | durationMin | chips | yo'q | **YO'Q** ⚠ | 5 (1-5) | ✓ :69 |
| | language | language | yo'q | `uz` (global) | 3 | ✓ :68 |
| Tabriknoma (`tools.ts:872-893`) | recipient | text | **HA** (`:299`) | `""` | — | ✓ :91 |
| | relation | text | yo'q | `""` | — | ✓ :92 |
| | occasion | chips | yo'q | **YO'Q** ⚠ | 6 | ✓ :101 |
| | durationMin | chips | yo'q | **YO'Q** ⚠ | 4 (1-4) | ✓ :69 |
| | language | language | yo'q | `uz` (global) | 3 | ✓ :68 |

**Reyestr butunligi yaxshi**: har bir parametr `game-params.ts`/`audio-params.ts`
da e'lon qilingan, `impacts` bo'sh emas, differensial testlar bor
(`tests/game-params.test.mts` 138 qator, `tests/audio-params.test.mts` 274
qator). `hideWhen` bitta joyda ishlatiladi — `categoryCount` `sortingType`
bitta toifali turda yashiriladi (`tools.ts:247`, ta'sirlangan turlar
`qarama-qarshi`).

### ⚠ TOPILMA — 4 vositada chip standart YO'Q (AUDIT-21 bilan nomuvofiqlik)

`ToolWorkspace.tsx:29-69` dagi `defaultsFor()` faqat krossvord/kartalar/
infografika uchun `gameDefaultTypeId("crossword"|"flashcards")` (:61,:63) va
`infographicDefaultTypeId()` (:65) chaqiradi. **Saralash/tinglash/podkast/
tabriknoma uchun mos `gameDefaultTypeId("sorting"|"listening")` va
`audioDefaultTypeId("podcast"|"greeting")` HECH QAYERDA chaqirilmaydi** —
`audioDefaultTypeId` funksiyasining o'zi `audio/registry.ts:413` da bor,
lekin import/ishlatilishi butun kod bazasida FAQAT o'sha e'lon qatorida
(grep tasdiqlaydi). Xuddi shunday `GAME_LIMITS.categoryCountDefault` (4),
`.itemsPerCategoryDefault` (5), `.listeningCountDefault` (10)
(`games/types.ts:333-360`) va `AUDIO_LIMITS.podcastMinutesDefault` (2),
`.greetingMinutesDefault` (1) (`audio/types.ts:109-113`) reyestrda bor,
lekin forma ularni o'qimaydi.

Natija: `FieldBlock` (`fields.tsx:327-329`) `ChipGroup`ni `text=""` bilan
chizadi — HECH BIR chip yoqilmagan holda ochiladi (8 ta chip guruhi: 
`sortingType`, `categoryCount`, `itemsPerCategory`, `listeningType`,
`itemCount`, `podcastType`, `durationMin`×2, `occasion`). Foydalanuvchi
birontasini bosmasdan yuborsa, server `normalizeGameType`/`normalizeAudioType`
birinchi turga tushiradi — FUNKSIONAL xato emas, lekin EKRANDA hech narsa
tanlanmagandek ko'rinadi, xolbuki krossvord/kartalar ochilganda darhol
«10 so'z»/«klassik» yoqilgan turadi. Bir xil oilada ikki xil xulq —
tuzatish arzon: `defaultsFor()` ga 8 qator qo'shish.

### FieldBlock sifat auditi (`fields.tsx:302-346`)

- `field.hint` (masalan wordCount: «To'rga sig'magan so'z tashlanadi…»,
  `tools.ts:198`; includeExample: «Orqa yuzga…», `:216`; blockCount,
  podcastType durationMin) — **HECH QAYERDA CHIZILMAYDI**. `FieldBlock`
  faqat `Legend` + boshqaruvni chizadi (`:314-343`), `field.hint`ni
  o'qimaydi ham. Boshqa formalarda (`Combobox.tsx:167`, `WorkComposer.tsx:402`,
  `EssayComposer.tsx:285`) `hint`/`o.hint` ko'rinadi — bu yerda yo'q.
- Chip `option.hint` (masalan `gameTypesOf("crossword")` dagi `t.hint`,
  krossvord/kartalar/saralash/tinglash/podkast/tabriknoma turlarining
  har biri tavsif matniga ega — `games/registry.ts`, `audio/registry.ts`)
  — `ChipGroup` (`fields.tsx:54-85`) faqat `o.label`ni chizadi, `o.hint`
  hech qanday `title`/tooltipga bormaydi. 8+ tur/janr orasidan (masalan
  6 ta tabriknoma sababi) foydalanuvchi farqni FAQAT labeldan taxmin qiladi.
- Chips 6+ variant bo'lganda (`occasion` — 6, `categoryCount` — 5) oddiy
  `flex flex-wrap gap-2` bilan ikkiga bo'linadi — funksional, lekin
  etalondagi `Segmented`/`SelectField` farqlash qoidasiga (3-6→Segmented,
  ≥7→select, `forms3-etalon.md:36-40`) mos emas — bu yerda hammasi bir xil
  katta pilюль tugma, uzun ro'yxat kichraytirilmagan.
- Balandlik: har `fieldset` ≈ 88-100 px (`Legend` 20 + gap 10 + chip qator
  34 + `mb-6` 24). 6 vositada 3-5 maydon bo'lgani uchun YOPIQ balandlik
  taxminan 450-650 px (+ header/submit ≈140 px) — etalon 1100 px dan
  PASTROQ, chunki bu formalarda umuman kam parametr bor; muammo balandlik
  emas, **uslub** (pastga qarang).

## 2. Etalon bilan farqlar (`docs/research/forms3-etalon.md`)

| Etalon (AUDIT-12, umumiy guruh) | Oyinlar/Media (AUDIT-21/22) |
|---|---|
| `Card` guruhlash (`compact.tsx:18-38`), 4-6 karta | Karta yo'q — bitta uzluksiz `fieldset` oqimi |
| `Row` — bitta qator = yorliq(7.5rem)+boshqaruv (`compact.tsx:41-65`) | `Legend` tepada, boshqaruv pastda — 2x balandroq har band |
| `ⓘ` tooltip (`Row` hint prop) | hint umuman ko'rinmaydi (yuqorida) |
| Yig'iq «▸ Sozlamalar» + `SummaryChips` (joriy tanlov qisqa chip, `compact.tsx:190-200`) | «Qo'shimcha (ixtiyoriy)» faqat erkin matn — struktura maydoni yo'q, demak yashiradigan/xulosa qiladigan narsa yo'q |
| `Segmented`/`SelectField` variant soniga qarab tanlanadi | Hammasi bitta `ChipGroup` uslubida, variant sonidan qat'i nazar |
| Standartlar reyestrdan to'liq o'qiladi (`defaultsFor`, slayd/rezyume/maqolada) | 4 vositada (yuqorida) standart chaqirilmagan |
| Profil standartlari (`profileDefaults`) muallif maydonlariga | O'yin/media vositalarida muallif maydoni yo'q — bu tabiiy (auditoriya o'qituvchi/o'quvchi, muallif shart emas) |

Xulosa: StandardForm 6 vosita uchun **funksional yetarli** (hech bir
parametr yo'qolmagan, reyestr qulflangan), lekin vizual til AUDIT-12
dan OLDINGI davrga tegishli — foydalanuvchi «Rezyume»dan «Krossvord»ga
o'tganda interfeys bir zumda qadimiy fieldset uslubiga qaytadi.

## 3. Natija sahifasi auditi

`ResultView.tsx:32-636` — bitta qobiq hammasi uchun. Vositaga qarab nima
ko'rinishi `isGame`/`isAudio`/`isPoster` bayroqlari bilan hal qilinadi
(`:296-312`):

| Blok | Krossvord/Kartalar/Saralash/Tinglash | Podkast/Tabriknoma |
|---|---|---|
| Ko'ruvchi (`viewerKind`, `lib/viewers/kind.ts:60-71,72-75`) | `WordViewer` (bosma DOCX ko'rinish — to'r/karta panjarasi, `gameFlow`) | `AudioViewer` (pleer+transkript) |
| Tayyorlik hisoboti (`review`, `:271-278`) | ✓ `doc.game.review` | ✓ `doc.audio.review` |
| «Tuzatish» band-band (`onFix`) | ✓ bor (`noFix` false) | ✗ YO'Q (`noFix = isAudio`, `:303`) |
| «Hammasini tuzatish» (`onPolish`) | ✓ bor | ✗ YO'Q (`noPolish = isAudio`, `:311`) — sabab: TTS oldidan ichkarida sayqal bo'ladi |
| «Tahrirlash» (`EditActions`) | ✗ yo'q — `WordViewer`da `doc.game` uchun adapter yo'q (`ArtifactViewer.tsx:67-79` izohi) | ✗ yo'q — audioda tahrir ATAYLAB yo'q (transkript audiodan uzilib qolmasin) |
| «Manbalar»/«Vizuallar» guruhi | yashirilgan (`ESSAY_HIDDEN_GROUPS`, `:312`) | yashirilgan |
| `GameSharePanel` (`shareKind`, `:325`) | ✓ Saralash/Tinglash/Krossvord/Kartalar — `publicGameKindOf` ro'yxatidan | ✗ podkast/tabriknoma o'ynaladigan emas |

**Muhim**: natija sahifasida krossvord/karta/saralash/tinglash uchun
FAQAT bosma (DOCX) ko'rinish chiziladi (`ArtifactViewer.tsx:67-79`,
`WordViewer`). O'YIN sifatida INTERAKTIV oldindan ko'rish natija sahifasida
YO'Q — uni ko'rish uchun foydalanuvchi `GameSharePanel`dagi havolani
o'zi ochishi kerak. O'qituvchi o'z hujjatini yaratgach, «bu qanday
o'ynaladi» ni ko'rish uchun alohida havola ochishga majbur — kichik ishqalanish.

`GameSharePanel.tsx:31-297` — sifatli: bo'sh holat tushuntiradi
(`:143-163`), QR (`:166-175`, `qrcode` dinamik import), nusxalash
(`:186-194`), ko'p havola tab (`:202-219`), natijalar jadvali + CSV
eksport (`:249-258`) va bo'sh natija holati (`:288-291`). Kamchilik:
real-time/auto-refresh yo'q — qo'lda «Yangilash» (ataylab, izohda
asoslangan, `:14-17`).

`AudioViewer.tsx:20-89` — pleer (`inline=1`, `:36-38`) + transkript
(rol bo'yicha rangli, `:60-77`) + yuklab olish (`:40-46`). Yo'q narsalar:
waveform, tezlik boshqaruvi, replika bo'yicha "seek" (matn bosilganda
audio o'sha joyga o'tishi) — kichik, lekin transkript+audio bog'lanishini
kuchaytirar edi.

Tayyorlik hisoboti (`ArticleReviewPanel.tsx`) — ball halqasi (`ScoreRing`,
`:65-86`), guruhlangan bandlar, «Sizdan kutiladi» bloki forma havolasi
bilan (`:243`, `hrefBase`) — 6 vositaning barchasida bir xil shakl.

**O'yinchi sahifasi `app/o/[token]` (`Player.tsx:1-245`)** — sifat yaxshi:
5 ekran (yuklanmoqda→ism→o'yin→natija, `:108-133`), mobil-birinchi
(`max-w-2xl`, `min-h-dvh`, `app/o/[token]/page.tsx:29-35`), progress-bar +
taymer (`:144-158`), xato matnlari holatga qarab aniqlashtirilgan
(`:231-242`), yuborilmasa javob YO'QOLMAYDI (`:99-102`). Kamchilik:
tur bo'yicha o'yin komponentlari (`Crossword`/`Cards`/`Sorting`/`Listening`)
alohida fayllarda — vizual izchillikni ular ta'minlaydi, bu auditda
ochilmadi (chuqur ko'rib chiqish tavsiya etiladi, quyida).

## 4. Navigatsiya/landing auditi

Bo'lim ro'yxati **bitta manba** — `TOOL_GROUPS` (`tools.ts:937-943`):
Umumiy → Talaba ishlari → O'qituvchi vositalari → **O'yinlar** → **Media**,
`visibleToolGroups()` (`:952-954`) bo'sh guruhni yashiradi. `CreateGrid.tsx:25`
va `Sidebar.tsx:15` ikkalasi ham shu funksiyadan o'qiydi — ikki alohida
ro'yxat yo'q (ilgari muammo bo'lgan, izoh `:930-936`).

`CreateGrid.tsx:33-95` — har guruh sarlavha + 1-2-3 ustunli karta panjarasi;
karta: rang chizig'i (`t.tc`), ikonka (`TOOL_ICONS[t.icon]`), sarlavha,
tavsif, narx («N tanga dan», `:60-63`) yoki bloklanish sababi (`:57-58`).
Barcha 6 ikonka mavjud (`icons.tsx:46-52`: `puzzle`, `layers`, `boxes`,
`headphones`, `mic`, `gift`) — yangi vositalar ESKI vositalar bilan
BIR XIL karta shablonida, dizayn sifati farq qilmaydi.

Kichik noaniqlik: narx yorlig'i har doim «… tanga **dan**» deydi
(`CreateGrid.tsx:61`), lekin 6 vositaning barchasida narx TEKIS (2000/4000) —
«dan» so'zi variatsiya bor degan taassurot beradi, holbuki yo'q (bu naqsh
boshqa tekis narxli vositalarda ham bor, oyinlar/mediaga xos emas).

`Sidebar.tsx:72-102` xuddi shu guruh/tartib/ikonka bilan — mobil menyu
`AppShell.tsx:40-52` FAQAT shu `Sidebar`ni drawer'da qayta ishlatadi
(`md:hidden` overlay), ya'ni ikkinchi mobil-maxsus ro'yxat yo'q, farq yo'q.

## 5. Tavsiya

**GameComposer/MediaComposer kerak emas — hozircha.** 6 vositaning har
birida 2-5 maydon bor (etalon vositalaridagi 15-30 dan farqli) — alohida
composer yozish ortiqcha murakkablik qo'shardi. Tavsiya etilgan yo'l:

1. **Tezkor (past xavf, ~0.5-1 kun)**: `ToolWorkspace.tsx:29-69`dagi
   `defaultsFor()` ga 8 qator qo'shib `gameDefaultTypeId("sorting"|"listening")`
   va `audioDefaultTypeId("podcast"|"greeting")` + `GAME_LIMITS`/`AUDIO_LIMITS`
   `*Default` qiymatlarini ulash — ⚠ topilgan nomuvofiqlikni yopadi.
   Mutatsiya testi: `defaultsFor` dan bittasini olib tashlab, boshlang'ich
   `values`da chip tanlanmaganini UI testida ushlash mumkin.
2. **O'rta (past-o'rta xavf, ~1-2 kun)**: `FieldBlock`ga `field.hint`ni
   `Row`dagi kabi `ⓘ` tooltip qilib qo'shish (yoki `compact.tsx Row`ga
   ko'chirish) — 6+ maydonda mavjud, lekin chizilmayotgan matn ishga
   tushadi. Xavf past: faqat qo'shimcha matn, mavjud testlarni buzmaydi.
3. **Strategik (o'rta xavf, ~3-5 kun, PM qarori kerak)**: 6 vositani
   `compact.tsx` primitivlariga o'tkazish (StandardForm'ni umuman
   almashtirmasdan — `FieldBlock`ning o'zini `Card`/`Row`/`Segmented`
   variantiga ko'chirish, chunki maydon soni kam, 1 karta yetadi har
   vositaga). Foyda: vizual izchillik butun saytda; xavf: `tests/ui/*`
   va `data-*` atributlarga bog'liq testlar (`game-share-panel.test.mts`,
   `result-flow.test.mts`) qayta tekshirilishi kerak, chunki forma
   qatlamiga tegiladi (natija sahifasi/share panelga tegmaydi).
4. **ResultView**: krossvord/kartalar/saralash/tinglash uchun natija
   sahifasida kichik «O'ynab ko'rish» tugmasi (`GameSharePanel` ichida
   allaqachon havola bor, faqat yorqinroq CTA qilish) — `Player.tsx`
   sifatli, uni topish osonlashsin. Audio uchun ixtiyoriy: transkript
   qatoriga bosilganda audio pozitsiyasi sakrashi (seek) — kichik UX foyda.
5. Landing/nav ($4) o'zgartirish shart emas — bitta manba, ikonka, karta
   shabloni allaqachon izchil; narx yorlig'idagi «dan» so'zini tekis
   narxli vositalarda olib tashlash kosmetik, alohida band ochish shart
   emas (loyihaning boshqa 10+ tekis narxli vositasida ham bor).

**Umumiy ish hajmi**: band 1 — kichik (bitta fayl, aniq); band 2 — kichik;
band 3 — o'rta, PM roziligi kerak (memory: «server/pricing/money/yangi
sprint oldidan kelishish», bu UI refaktor — kelishuv tavsiya etiladi,
majburiy emas); band 4 — kichik-kosmetik.
