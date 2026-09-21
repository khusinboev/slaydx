# Forma auditi — «Talaba» bo'limi (kurs ishi / referat / mustaqil ish / insho / tezis)

Faqat o'qish: kod o'zgartirilmadi. Etalon — `ArticleComposer.tsx` (tezis ham shundan
foydalanadi) va `compact.tsx` primitivlari (AUDIT-12/17/19 naqshi).

## 1. Inventar

### 1.1 Kurs ishi / Referat / Mustaqil ish — `WorkComposer.tsx` (660 qator, 27 param)

Bitta komponent uchala vositani chizadi (`genre = workGenreOfTool(tool.id)`,
`components/forms/WorkComposer.tsx:284`). Reyestr — `lib/generation/work-params.ts:46-91`
(27 `WORK_PARAMS`, hammasi `data-field` bilan chizilgan — `tests/ui/work-composer.test.mts`
qamrov testi bilan qulflangan, «bezak maydon yo'q»).

| Bo'lim | Maydon | Turi | Majburiy | Standart | Joyi |
|---|---|---|---|---|---|
| Mavzu va tur (Card, `WorkComposer.tsx:387-421`) | topic | matn | ha (submit, :355) | — | asosiy |
| | workKind | Segmented | yo'q | genre standarti | asosiy |
| | subjectProfile | Segmented (5) | yo'q | humanities | asosiy |
| | subjectName | Combobox | yo'q | profil.subject | asosiy |
| Titul (`<details open>`, `:424-491`) | university | matn | **ha** (`CUSTOM_REQUIRED.work`, `lib/tools.ts:86`) | profil.university | asosiy (yopilmaydigan) |
| | faculty/department/group/course | matn | yo'q | profildan | " |
| | author | matn | **ha** (`lib/tools.ts:87`) | profil.author | " |
| | teacher/teacherDegree/city | matn | yo'q | profildan | " |
| | ministry | Segmented (3) | yo'q | oliy | " |
| | ministryCustom | matn | shartli (`ministry==custom`) | — | " |
| Hajm va til (Card, `:493-504`) | pages | Segmented (narx bilan) | yo'q | `defaultPages("coursework")=20-25` | asosiy |
| | language | Segmented (3) | yo'q | uz | asosiy |
| Reja (Card, `:506-534`) | tocMethod | Segmented (ai/manual) | yo'q | ai | asosiy |
| | tocText | TextArea + jonli «N bob, M paragraf» | shartli | — | asosiy |
| Materiallar (Card, `:536-594`) | sourceText/fileName | `SourceFileField` | yo'q (fileName reyestrda YO'Q) | — | asosiy |
| | userFacts | TextArea (**limitsiz UI**) | yo'q | — | asosiy |
| | userRefs | RowList (DOI/ISBN/matn) | yo'q | [] | asosiy |
| | refsMin | number input | yo'q | tur standarti | asosiy |
| Sozlamalar (`<details>`, `:596-656`, boshida YOPIQ) | includeVisuals | Switch | yo'q | true | **yig'iq** |
| | figureCount/tableCount | Segmented (0-3) | yo'q | fan profilidan | **yig'iq** |
| | figureKinds | Chips (`ArticleComposer`dan import, `:34`) | yo'q | [] (avto) | **yig'iq** |
| | extra | TextArea (**limitsiz UI**) | yo'q | — | **yig'iq** |

Taxminiy balandlik (yopiq holda, Sozlamalar yopiq): **4 karta + 1 doim-ochiq «Titul»
blok** ≈ 21 qator/maydon (Titul o'zi 10-11) → grubo baholab ≈**1 700-1 900 px** @1400 —
etalondan (≈1 100 px) sezilarli KATTA, chunki Titul yopilmaydi (pastga qarang §2).

### 1.2 Insho — `EssayComposer.tsx` (454 qator, 12 param)

Reyestr — `lib/generation/essay-params.ts:41-62` (12 `ESSAY_PARAMS`, xuddi shu qamrov
qoidasi, `tests/ui/essay-composer.test.mts`). `profile`/`user` PROPI UMUMAN
QABUL QILINMAYDI (`EssayComposer.tsx:213`) — pastga qarang §2 (profil bog'lanmagan).

| Bo'lim | Maydon | Turi | Majburiy | Standart | Joyi |
|---|---|---|---|---|---|
| Mavzu va kontekst (`:279-316`) | topic | matn | ha (:262) | — | asosiy |
| | essayContext | Segmented (3) | **ha** (`CUSTOM_REQUIRED.essay`, `lib/tools.ts:76`) | school_dtm | asosiy |
| | essayKind | o'z radiogroup (Segmented EMAS, tooltip uchun) | yo'q | kontekstning 1-turi | asosiy |
| Hajm va til (`:318-376`) | pages **yoki** wordTarget (kontekstga qarab biri) | Segmented | yo'q | 2 varaq / 700 so'z | asosiy |
| | language | Segmented (kontekst cheklaydi) | yo'q | uz | asosiy |
| Materiallar (`:378-410`) | userFacts | TextArea + hisoblagich | yo'q | — | asosiy |
| | workTitle | matn + hisoblagich | shartli (`needsWork`) | — | asosiy |
| | epigraph (matn+muallif) | 2 TextInput + hisoblagich | shartli | — | asosiy |
| Sozlamalar (`:412-451`, boshida yopiq) | design | `DesignChips` (o'z markup, `:187-209`) | yo'q | iris | **yig'iq** |
| | person | Segmented | yo'q | kontekst standarti | **yig'iq** |
| | extra | TextArea + hisoblagich | yo'q | — | **yig'iq** |

Faylsiz (SourceFileField yo'q — janr shunday: insho tashqi manba emas, shaxsiy fikr).
Yopiq holatda ≈**3 karta**, ≈9-10 qator — etalondan HAM ixchamroq (mos, chunki maydon
kam), lekin karta soni jihatidan izchil.

### 1.3 Tezis — `ArticleComposer.tsx` (thesis rejimi, 716 qator, umumiy dvigatel)

Alohida forma YO'Q — `tool.custom === "article"` (`lib/tools.ts:567`), forma
`ArticleComposer` ning o'zi, faqat: `isThesisTool` (`ArticleComposer.tsx:157`) tur
tanlovchini `THESIS_TYPE_IDS` bilan cheklaydi (`:465-466`), narx yorlig'i
`THESIS_PRICES`dan (`:158`), standart tur/hajm `conference_thesis`/`1-2`
(`:161-162`). Kartalar: **Mavzu va tur, Nashr profili, Mualliflar, Materiallar,
Hajm va til** (5 ta, `:439-605`) + yig'iq Sozlamalar (`:607-712`, UDK/kalit
so'z/vizual/manba qidiruvi/iqtibos uslubi/qo'shimcha). Bu — haqiqiy ETALON
tuzilma; vazifa matnidagi «4 karta» taxminiy, amalda **5 karta**.

## 2. Etalon bilan farqlar

- **Primitivlar**: Essay/Article/Work'ning aksariyat qatorlari `Card`/`Row`/`Segmented`
  bilan izchil. Ammo WorkComposer'dagi «Titul» bo'limi `Card` EMAS — qo'lda yozilgan
  `<details open className="bg-card mb-3 rounded-2xl border p-4">`
  (`WorkComposer.tsx:424-427`), holat kuzatilmaydi (`settingsOpen` faqat Sozlamalar
  uchun), `SummaryChips` yo'q. Natijada foydalanuvchi 9-10 titul maydonini HECH QACHON
  yig'a olmaydi — eng katta bo'lim doim ekranda.
- **Yig'iq bo'lim**: Article/Essay'da bitta yig'iq Sozlamalar bor va u BOSHIDA yopiq
  (`settingsOpen` state `false`). Work'da ham bor, lekin Titul (eng katta blok)
  yig'ilmaganligi uchun umumiy balandlik etalondan taxminan 1,5-1,7× baland.
- **Matn maydon limitlari (UI)**: Essay va Article'da HAR limitli maydon (`userFacts`,
  `extra`, `workTitle`, `epigraph`, `udk`, `rawRef`) `onChange` ichida `.slice(0, LIMIT)`
  bilan kesiladi va hisoblagich ko'rsatiladi (masalan `EssayComposer.tsx:383`,
  `ArticleComposer.tsx:517,703`). **WorkComposer'da BIRORTA HAM matn maydonida
  `.slice()` yo'q** (`WorkComposer.tsx:547-550` `userFacts`, `:646-648` `extra`,
  `tocText`, `subjectName`, `ministryCustom` — tekshirildi: `grep .slice(0,` faqat
  Combobox takliflari uchun chiqadi). Server `WORK_LIMITS.userFactsChars=12000`
  (`lib/generation/work/types.ts:162`) baribir kesadi (`text()`, `work/input.ts:348`)
  — ya'ni foydalanuvchi 12 000 belgidan uzun yozsa, XATOSIZ, OGOHLANTIRISHSIZ
  matn ustidan kesib yuboriladi. Bu etalon qoidasidan (limit + hisoblagich) og'ish.
- **Profil bog'lanishi**: Work `profileDefaults`ni to'liq oladi (`emptyUi`,
  `WorkComposer.tsx:141-157`: university/faculty/department/group/course/author/
  teacher/city). Article ham (`authors[0].name = profile.author`, `:173`). **Essay
  UMUMAN `profile` propini olmaydi** (`EssayComposer({ tool })`, `:213`) — bu
  qasddan (insho muallif shapkasi so'ramaydi), lekin natijada `updateProfile` patch
  ham yo'q (Work/Article submit'da bor, Essay submit'da yo'q, `:259-275`) — izchil,
  lekin hujjatlashtirilmagan farq.
- **Chip uzunligi**: Work'ning yopiq-holat `SummaryChips` (`:604-611`) `figureKinds`
  ro'yxatini vergul bilan qo'shib bitta uzun chipga aylantiradi (masalan
  «sxema: blok-sxema, jarayon, daraxt, qatlamlar» — 4 ta tanlansa juda uzun,
  wrap qiladi). Article'da xuddi shu naqsh bor (`:620`) — izchil muammo, lekin
  Article'da qisqartirilmagan (max belgilanmagan).
- **Narx ko'rsatish**: uchalasida ham har `pages`/`wordTarget` chipida narx yorlig'i
  bor (`formatTanga(priceFor(...))`) — izchil, yaxshi.
- **Mobil/qorong'i/a11y**: uchalasi ham bitta `compact.tsx`dan foydalangani uchun
  farqsiz (`Row` `sm:grid-cols-[7.5rem_1fr]`, `bg-card`/`text-muted-foreground`
  semantik token, `Segmented`/`Switch` `role`/`aria-*`). Alohida nuqson topilmadi.
- **Draft**: uchalasida ham `useFormDraft(tool.id)` — izchil.

## 3. Takrorlanishlar (umumiy komponentga nomzod)

| Bo'lak | Work | Essay | Article | Izoh |
|---|---|---|---|---|
| Mavzu qatori + misollar tugmalari | `:388-401` | `:280-284` (misollarsiz) | `:440-458` | deyarli bir xil JSX, 3 marta |
| `SourceFileField` o'rami | `:537-545` | **yo'q** | `:504-512` | Essayda yo'q (qasddan), Work/Article aynan bir xil |
| «Mening manbalarim» RowList (DOI/…/matn) | `:551-584` | — | `:525-559` | Work DOI+ISBN+matn, Article DOI+matn — 80% bir xil |
| `FigureKindChips`/`FIGURE_KIND_LABEL` | Article'dan **import** (`:34`) | — | e'lon qilingan joy (`:87-130`) | Work o'z komponentini emas, Article faylidan chizadi — umumiy modulga (`figure-fields.tsx`) chiqarilmagan, Article o'zgarsa Work sinab ko'rilmasdan buziladi |
| «Qo'shimcha» (extra) qatori | `:645-649` | `:440-443` | `:701-705` | 3 marta deyarli aynan bitta JSX |
| «Formani tozalash» tugmasi + `clearConfirm` | `:650-654` | `:445-449` | `:706-710` | 3 marta so'zma-so'z bir xil |
| userFacts + hisoblagich naqshi | limitsiz (yuqoriga qarang) | `:379-390` | `:513-524` | Work bu naqshni TAKRORLAMAYDI — aksincha, yo'qotgan |
| Sozlamalar `<details>` sarlavha+SummaryChips skeleti | `:596-613` | `:412-429` | `:607-626` | struktura bir xil, mazmuni har xil — allaqachon "yarim-umumiy", `<SettingsPanel>` deb ajratish mumkin |

**Tavsiya**: `TopicRow`, `ExtraRow`, `ClearFormButton`, `SourceMaterialsBlock` va
`SettingsDetails` (sarlavha+chips skeleti) kabi kichik umumiy komponentlarni
`components/forms/shared.tsx` ga chiqarish — 3 formada ~120-150 qator takror kod
kamayadi, kelgusi audit (o'qituvchi/rezyume) ham ulardan foydalana oladi.

## 4. UX kamchiliklari

1. **Titul bo'lim hech qachon yig'ilmaydi** (`WorkComposer.tsx:424`) — eng katta
   nuqson: 9-10 maydon doim ko'rinadi, ekran balandligi etalondan ~1,5× baland.
   Tuzatish: `Card`ga o'tkazish yoki Sozlamalar tarkibiga (universitet/muallif —
   majburiy bo'lgani uchun asosiyda qolishi kerak, qolgani — fakultet/kafedra/
   guruh/kurs/o'qituvchi/shahar/vazirlik — yig'iqqa ko'chirilishi mumkin).
2. **Matn maydonlarida limit ko'rsatilmaydi** (Work) — foydalanuvchi qancha
   yozganini, qachon kesilishini bilmaydi; Essay/Article'da bu hal qilingan
   (hisoblagich + `.slice`). Ehtimoliy real muammo: uzun `userFacts`/`extra`
   xatosiz kesilib, LLM kutilmagan joyda to'xtaydi.
3. **`refsMin` raqamli input — chegarasi yashirin**: `TextInput type=number`
   (`WorkComposer.tsx:587-592`), min/max HTML atributi yo'q (faqat `onChange`
   ichida `Math.max(0, Math.min(40, …))` bilan qisqartiriladi) — brauzer
   ustunlari (spinner) 0-40 chegarasini bildirmaydi, foydalanuvchi 100 yozib,
   ko'rinmasdan 40 ga tushib qolishini bilmaydi.
4. **`essayKind` o'z radiogroup'i, `Segmented` emas** (`EssayComposer.tsx:291-315`)
   — vizual jihatdan boshqa segmentlardan farq qiladi (to'liq pill, primary fon),
   izchillik buziladi (garchi funksional sabab bor — har tugmada `title` tooltip).
5. **Bezak maydon xavfi yo'q, lekin nazorat qatlami yupqa**: har uchala forma
   ham reyestr+zond bilan qulflangan (`WORK_PARAMS`/`ESSAY_PARAMS`/
   `ARTICLE_PARAMS`) — bu yo'nalishda muammo topilmadi.
6. **Natija sahifasi (`ResultView.tsx`)**:
   - Ishning tayyorlik hisoboti — YAGONA nuqta: `gen.doc?.article?.review ??
     …essay… ?? …work…` (`ResultView.tsx:271-278`) — izchil.
   - **Insho «Tuzatish» (bandma-band)ga EGA EMAS**: `noFix = isEssay || isPoster
     || isAudio` (`:303`) — Work va Article/Thesis'da bor. Bu qasddan (insho
     bitta bo'lim, band-ma-band tuzatish ma'nosiz), lekin foydalanuvchiga
     hech qayerda TUSHUNTIRILMAYDI — hisobot panelida shunchaki tugma yo'q,
     nega yo'qligi izohlanmaydi (Article/Work'da bor bo'lgani uchun kutilishi
     mumkin).
   - **Insho «Manbalar»/«Vizuallar» guruhlari yashirilgan** (`ESSAY_HIDDEN_GROUPS`,
     `ArticleReviewPanel.tsx:43`, `ResultView.tsx:312`) — izchil va to'g'ri
     (insho manba keltirmaydi).
   - Tahrirlash uchastkasi ikkalasida ham bor: Work → `useWorkEdit`
     (`useWorkEdit.ts:26`, faqat `coursework/referat/mustaqil-ish`), Essay →
     `useArticleEdit` (`useArticleEdit.ts:33`, `ARTICLE_TOOLS` ichida
     `essay` bor) — izchil, ikkalasi ham «Tahrirlash»ga ega.
   - «Hammasini tuzatish» (`onPolish`) ikkalasida ham bor (`noPolish` faqat
     audio uchun) — izchil.

## 5. Tavsiya

**WorkComposer** — kichik-o'rta ish (1-2 kun): (a) «Titul»ni `Card` ichiga olib,
majburiy ikkitasini (university, author) asosiy `Card "Mavzu va tur"`ga ko'chirish,
qolgan 7-8 maydonni (fakultet, kafedra, guruh, kurs, o'qituvchi+daraja, shahar,
vazirlik) mavjud Sozlamalar `<details>`iga qo'shish yoki alohida
«▸ Titul tafsilotlari» yig'iq blokka aylantirish — natijada yopiq balandlik
etalonga yaqinlashadi; (b) barcha matn maydonlariga `.slice(0, WORK_LIMITS.*)` +
hisoblagich qo'shish (`userFacts`, `extra`, `tocText`, `subjectName`,
`ministryCustom`) — sof UI o'zgarishi, `FormValues` nomlari o'zgarmaydi, dvigatelga
tegmaydi. **Xavf**: past — `data-field` va reyestr saqlanadi, faqat markup.

**EssayComposer** — o'zgartirish shart emas (allaqachon ixcham va etalonga yaqin);
ixtiyoriy: `essayKind` uchun ham `Segmented`ga o'xshash umumiy «tooltip'li chips»
komponenti chiqarish (Article'dagi `FigureKindChips` naqshiga o'xshab).

**Umumiy komponentlar** (o'rta ish, 1 kun): §3'dagi `TopicRow`/`ExtraRow`/
`ClearFormButton`/`SettingsDetails` ni `components/forms/shared.tsx`ga chiqarish;
`FigureKindChips`ni `ArticleComposer.tsx`dan mustaqil `figure-fields.tsx`ga
ko'chirish (Work import qiladigan joy o'zgaradi, lekin bog'liqlik yo'qoladi).

**Xavflar**: `FormValues` maydon nomlari (`data-field` qiymatlari) — dvigatel
(`work/input.ts`, `essay/input.ts`) va zond testlar (`work-params.test.mts`,
`essay-params.test.mts`) shu nomlarga qattiq bog'langan, o'zgartirilmasligi kerak.
Har qanday markup o'zgarishidan keyin `tests/ui/work-composer.test.mts` (14),
`tests/ui/essay-composer.test.mts` (8), `tests/viewer/work-form.test.mts` (5) va
mutatsiya testlari (Titul yig'ilsa — «ministry/tocMethod ko'rinish bog'lanishi»
mutatsiyasi) qayta yurgizilishi shart (`scripts/heavy.sh` orqali, CLAUDE.md
qoidasi).
