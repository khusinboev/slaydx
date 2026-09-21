# AUDIT-24 — Formalar 3: talaba, o'qituvchi, o'yinlar, media formalarini etalonga tenglashtirish

Sana: 2026-09-21. AUDIT-12 («Formalar 2») «umumiy» bo'limning 5 formasini
ixcham/pro darajaga keltirgan edi; qolgan 17 vosita (talaba 5, o'qituvchi 6,
o'yinlar 4, media 2) uch xil «dizayn tilida» qolgan. Tadqiqot:
`docs/research/forms3-etalon.md` (25 bandli checklist), `forms3-talaba.md`,
`forms3-oqituvchi.md`, `forms3-oyinlar-media.md`, `forms3-olchov.md`
(22 forma Chromium o'lchovi).

## 1. Reja

### 1.1 Holat (o'lchov, 1400 px, yopiq)

| Bo'lim | Vositalar | Komponent | Balandlik | Asosiy muammo |
|---|---|---|---|---|
| Talaba | kurs ishi, referat, mustaqil ish | `WorkComposer` (660 q, 27 param) | **2 001–2 027** | «Titul» 9–10 maydon hech yig'ilmaydi; «Hajm» 7 uzun chip; «Materiallar» doim ochiq; matn limitlari ko'rsatilmaydi; xulosa chipi eng pastda |
| Talaba | tezis | `ArticleComposer` (maqola formasi) | 1 894 | tezisga ortiqcha maydonlar (nashr profili, annotatsiya) |
| Talaba | insho | `EssayComposer` (12 param) | 1 035 | 26 chip (kontekst×tur), o'z radiogroup'i, profil yo'q |
| O'qituvchi | dars rejasi, xarita, glossariy, keys, test | `TeacherComposer` (831 q) | 986–1 477 | test kind 9 qator tekis; «Shapka» ochiq keladi; `approver` 4 turda jim tashlanadi; «Fan» ikki marta; sana `mm/dd/yyyy` |
| O'qituvchi | infografika | `StandardForm` | 878 | compact emas, hint chizilmaydi, qoralama yo'q; natija sahifasi «Foto · 1:1 · N rasm» yorlig'i |
| O'yinlar | krossvord, kartalar, saralash, tinglash | `StandardForm` | 844 | eski `fieldset+Legend`, SummaryChips/Sozlamalar yo'q, **standart chip yoqilmagan** (saralash/tinglash), `hint` chizilmaydi |
| Media | podkast, tabriknoma | `StandardForm` | 844–1 093 | shu + rejim kartalari alohida uslubda, standart chip yo'q |
| Umumiy (etalon) | slayd, tarjimon, maqola, rezyume, rasm | o'z composerlari | 858–1 992 | etalonning o'zida 10 nomuvofiqlik (Sozlamalar mexanizmi/chevron, fayl UI, zond turi); rasm `ToolChrome`siz, maqola/rezyume 1 900+ |

### 1.2 Maqsad

Har 22 forma bitta dizayn tilida: `ToolChrome` → kartalar (mavzu → narxga
ta'sir qiluvchi → shapka → ▸ Sozlamalar yopiq, `SummaryChips`) → sticky narx;
har parametr bitta `Row`; ≥7 variant `SelectField`, 3–6 `Segmented`, Ha/Yo'q
`Switch`; izoh tooltip; yopiq holda **≤ 1 200 px @1400**, mobil 390 px da
gorizontal siljishsiz; har reyestr parametri bitta joyda (`data-field` zond);
natija sahifasida vositaga mos yorliq/panel. `FormValues` nomlari va dvigatel
shartnomalari O'ZGARMAYDI — bu sof UI sprint.

### 1.3 Arxitektura

- **`components/forms/shared/`** (R0): `SettingsDetails` (yopiq/ochiq bitta
  mexanizm + chevron + `SummaryChips`), `TopicRow`, `ExtraRow`, `AuthorBlock`
  (OTM/muassasa, muallif, «Tasdiqlayman», profil standartlari), `SourceFileRow`
  (ixcham fayl qatori — tarjimon varianti umumiylashadi), `LimitedTextarea`
  (hisoblagich + `.slice`), `ColorDots`, `ClearFormButton`; `MiniInput` ishga
  tushadi yoki o'chadi. Zond: barcha yangi formalar `data-field` DOM belgisi.
- **Uch yangi composer** (egasi qarori): `GameComposer` (4 o'yin, kind
  bo'yicha kartalar: mavzu/rejim → o'yin turi → hajm (so'z/karta/toifa/
  topshiriq) → til(lar) → ▸ Sozlamalar), `MediaComposer` (podkast/tabriknoma:
  rejim `Segmented` mavzu/matn/fayl → tur/sabab → davomiylik slayder → til →
  ▸ Sozlamalar), `InfographicComposer` (mavzu → tur galereyasi/select → blok
  soni → palitra `ColorDots` → ▸ Sozlamalar). `ToolWorkspace` dispatch
  `custom:"game"|"media"|"infographic"`; `lib/tools.ts` maydonlari reyestrdan
  (`games/registry.ts`, `audio/registry.ts`, `infographic/registry.ts`)
  o'qiladi, `game-params`/`audio-params`/`infographic-params` zondlari
  `data-field` ga o'tadi; reyestr standartlari (`*Default`) boshlang'ich
  holatga ulanadi. `StandardForm` faqat zaxira yo'l sifatida qoladi
  (birorta vosita ishlatmaydi — test qulflaydi).
- **TeacherComposer bo'linadi**: `teacher/{Lesson,Map,Glossary,Keys,Test}Fields.tsx`
  + umumiy qobiq; test kind-qatorlari ▸ Sozlamalarga; `approver` faqat
  bsb/chsb (`hideWhen`); «Fan» bitta manba (CurriculumPicker ↔ matn).
- **WorkComposer**: Titul → asosiyda faqat OTM+muallif, qolgani
  `AuthorBlock` yig'iq qismida; Hajm → **slayder + jonli narx** (slayd
  naqshi, `slidePrice` kabi `workPrice(pages)` bitta manbadan);
  Materiallar → ▸ Sozlamalar ichida; `LimitedTextarea`; `refsMin` min/max.
- **Tezis**: `ArticleComposer` ichida `variant="thesis"` — nashr profili va
  annotatsiya kartalari yashiriladi, tur galereyasi tezis turlari bilan.
- **Insho**: kontekst `Segmented` (3), tur `SelectField`/galereya; `essayKind`
  umumiy `Segmented`.
- **Natija sahifasi**: infografika uchun `PosterViewer` sarlavhasi
  («Infografika · A4 · N blok»), insho uchun «bandma-band tuzatish yo'q» izohi.
- **Etalon nomuvofiqliklari** (umumiy): Sozlamalar mexanizmi bitta, fayl UI
  bitta, `rasm` `ToolChrome`ga; maqola/rezyume qayta ixchamlash — ixtiyoriy WP.

### 1.4 Ish paketlari

| WP | Nima | Kim | Egalik | Testlar | Kun |
|---|---|---|---|---|---|
| R0 | `shared/` primitivlar + `SettingsDetails`, `data-field` zond yordamchisi, `FieldBlock` compact, `defaultsFor` hamma vosita, `hint` tooltip | lead | `components/forms/shared/**`, `compact.tsx`, `fields.tsx`, `ToolWorkspace.tsx` | `ui/shared-forms` 10, `ui/standard-form` 8, mutatsiya ≥3 | 1,5 |
| A | WorkComposer qayta tuzish (3 vosita) | agent opus | `WorkComposer.tsx`, `work-params.ts` zond | `ui/work-composer` yangilash 14→18, `viewer/work-form`, mutatsiya ≥3 | 2 |
| B | TeacherComposer bo'lish + 5 kind kartalari + infografika natija yorlig'i | agent opus | `TeacherComposer.tsx` → `teacher/*`, `teacher-params.ts`, `ImageViewer` infografika shoxi | `ui/teacher-composer` 20+, zond, mutatsiya ≥3 | 2,5 |
| C | Insho + tezis varianti | agent sonnet | `EssayComposer.tsx`, `ArticleComposer.tsx` (thesis shoxi) | `ui/essay-composer`, `ui/article-composer` +4 | 1,5 |
| D1 | `GameComposer` (4 o'yin) | agent opus | `components/forms/GameComposer.tsx`, `game-params.ts` (`data-field`), `tools.ts` 4 vosita `custom:"game"` | `ui/game-composer` 14, zond, mutatsiya ≥3 | 1,5 |
| D2 | `MediaComposer` (podkast/tabriknoma) + `InfographicComposer` + infografika natija yorlig'i | agent sonnet | `MediaComposer.tsx`, `InfographicComposer.tsx`, `audio-params.ts`, `infographic-params.ts`, `tools.ts` 3 vosita, `ImageViewer` infografika shoxi | `ui/media-composer` 10, `ui/infographic-composer` 8, zond, mutatsiya ≥3 | 1,5 |
| E | Etalon nomuvofiqliklari: slayd/tarjimon/maqola/rezyume `SettingsDetails`, fayl UI, `rasm` `ToolChrome` | agent sonnet | 5 umumiy composer | mavjud testlar yashil, `viewer/slide-form` | 1 |
| R | Chromium o'lchov 22 forma (yopiq ≤1 200, mobil), qorong'i rejim skrinshot, `npm run check`, docs §5, deploy, prod smoke | lead | — | — | 1 |

Jami ≈ 12,5 kun ish, kalendar ~5–6 kun (R0 → A/B/C parallel → D1/D2/E parallel → R). Bitta deploy sprint oxirida.
Xavflar: X-1 `FormValues` nomlari o'zgarmasligi — zond testlari qulflaydi;
X-2 UI testlari (jsdom) hit-test xatolarini ko'rmaydi — Chromium smoke
majburiy (AUDIT-11 Y-5 saboqi); X-3 profil standartlari (`profileDefaults`)
teacher/work/article uchta joyda — `AuthorBlock` bitta manba; X-4 mobil
qatorlar ustma-ust tushishi — 390 px o'lchov har forma uchun.

### 1.5 Egasi qarorlari (2026-09-21, qayta so'ralmaydi)

1. Qamrov — 17 forma **+ etalon nomuvofiqliklari** (WP-E). Natija sahifasi
   alohida qayta ko'rilmaydi; faqat infografika yorlig'i (D2) va insho
   «bandma-band tuzatish yo'q» izohi (C) kichik tuzatish sifatida.
2. O'yinlar/media/infografika — **alohida `GameComposer`/`MediaComposer`/
   `InfographicComposer`** (StandardForm'ni umumiylashtirish emas).
3. Talaba «Hajm» — **slayder + jonli narx** (slayd naqshi).
4. Tartib — R0 → A/B/C parallel → D1/D2/E parallel → R; **bitta deploy**
   sprint oxirida, prod smoke bilan.
5. Standing: `FormValues` nomlari va dvigatel shartnomalari o'zgarmaydi;
   har forma yopiq ≤ 1 200 px @1400, mobil 390 px siljishsiz; `data-field`
   zond; Chromium smoke majburiy; `scripts/heavy.sh`; har WP kommit.

## 5. Bajarilish yozuvi

### WP-A — `WorkComposer` (kurs ishi, referat, mustaqil ish), 2026-09-21

**Nima o'zgardi.** Forma etalon tartibiga keltirildi: `Mavzu va tur` →
`Hajm va til` → `Titul` → yopiq `▸ Sozlamalar`. «Titul» endi asosiyda
FAQAT majburiy ikkitasini ko'rsatadi (`CUSTOM_REQUIRED.work`: OTM,
muallif — `AuthorRows` bilan, «\*» belgisi bilan); qolgan 7 maydon
(fakultet, kafedra, guruh, kurs, o'qituvchi, unvon, shahar) + vazirlik
va «o'z matnim» — Sozlamalar ichida. «Materiallar» kartasi ham
Sozlamalarga kirdi (avval doim ochiq edi).

- **Hajm — slayder + jonli narx** (slayd naqshi, `RangeRow`): 7 uzun chip
  o'rniga bitta qator. `pages` dvigatel uchun AVVALGIDEK diapazon satri
  («20-25»), slayder esa `COURSEWORK_PAGES` (7 pog'ona) /
  `REFERAT_PAGES` / `INDEPENDENT_PAGES` (4 pog'ona) ro'yxatining
  INDEKSI bo'ylab yuradi — `FormValues` va `work/input.ts` shartnomasi
  o'zgarmadi.
- **Narx faqat `priceFor`**: slayder yonidagi raqam ham, uning ostidagi
  qoida matni («10–15 bet — 12 000 tanga … 40–45 bet — 24 000 tanga»)
  ham `priceFor(tool, {pages})` natijasidan yig'iladi; formada hech
  qanday hisob yo'q (§6 admin panel cheklovi).
- **Matn limitlari**: `topic`, `tocText`, `userFacts`, `extra`,
  `ministryCustom`, `subjectName` endi `WORK_LIMITS` bo'yicha kesiladi
  va hisoblagich ko'rsatadi (avval server jimgina kesardi).
- **`refsMin`** — yangi `NumberInput` (min/max HTML atributi bilan);
  **fayl** — `SourceFileRow` bitta qatori (katta dashed quti o'rniga).
- `FigureKindChips`/`FIGURE_KIND_LABEL` `ArticleComposer.tsx` dan
  `components/forms/shared/index.tsx` ga ko'chdi (Article endi faqat
  import qiladi va eski importchilar uchun qayta eksport qoladi);
  `shared/` ga `NumberInput` qo'shildi.

**O'lchov (Chromium, 1400 px, kirgan foydalanuvchi, `main`):**

| Vosita | Yopiq (oldin → keyin) | Ochiq | Mobil 390 px | Siljish |
|---|---|---|---|---|
| coursework | 2 027 → **997** | 2 297 | 1 318 | yo'q |
| referat | 2 001 → **997** | 2 297 | 1 318 | yo'q |
| mustaqil-ish | 2 001 → **997** | 2 297 | 1 292 | yo'q |

Etalon me'yori (≤ 1 200) bajarildi; yig'iq bo'lim 2/1 (biri ochiq) dan
1/0 ga tushdi. Jonli smoke: referat formasi to'ldirilib «Yaratish»
bosildi — slayder 15–20 bet, `[data-price]` = `[data-price-total]` =
4 000 tanga (`priceFor` bilan mos), so'rov navbatga tushdi
(`/uz/files/34793f36-…`). Skrinshotlar: scratchpad `wpa-*.png`.

**Testlar.** `tests/ui/work-composer.test.mts` 14 → **23**
(Titul yig'iqligi, «\*» majburiylik, slayder pog'onalari, uch vosita ×
har pog'ona uchun `[data-price]` ↔ `priceFor`, xulosa chiplari, matn
limitlari, `refsMin` min/max, ikki yo'nalishli `data-field` qamrovi,
fayl qatori); `tests/viewer/work-form.test.mts` 5 → **8** (SSR da
Sozlamalar yopiq va titul maydonlari faqat uning ichida, SSR narxi
`priceFor` dan, `maxLength`/hisoblagich/`min`-`max`);
`tests/ui/shared-forms.test.mts` 10 → **12** (`NumberInput`,
`FigureKindChips`). `tests/work-params.test.mts` (3) va
`tests/ui/article-composer.test.mts` (19) yashil; `tsc` va `eslint` toza.

**Mutatsiyalar (4, har biri qizardi):**

1. `price={price}` → `price={16000}` — «slayder yonidagi narx AYNAN
   `priceFor` dan» qizardi (referat/mustaqil ish 3 000 kutilgan joyda).
2. `<SettingsDetails summary={summary} open>` — jsdom «Titul YIG'IQ» va
   SSR «Sozlamalar YOPIQ keladi» qizardi.
3. `<Field id="refsMin">` → `id="refsMinimum"` — qamrov (oldinga),
   teskari qamrov va `refsMin` testi (3 ta) qizardi.
4. `limit={WORK_LIMITS.userFactsChars}` → `limit={999_999}` — «matn
   limitlari» testi qizardi.

**Ochiq savollar.**

1. Sozlamalar ochiq holda 2 297 px — ichida 16 parametr bor; kelgusida
   uni ikki yig'iq blokka (titul / materiallar) bo'lish mumkin, lekin
   etalon «bitta Sozlamalar» qoidasiga amal qilindi.
2. `figureCount`/`tableCount` hamon 0–3 chip; `maxVisualsFor(pages)`
   real chegarasi (paketga qarab 1–6) faqat tooltipda — slayderga
   o'tkazish keyingi WP nomzodi.
3. R0 test faylidagi (`tests/ui/shared-forms.test.mts`) 4 ta `tsc`
   xatosi shu WP da tuzatildi (`createElement` `children` argumenti va
   `waitFor` ning ikkinchi argumenti) — lead bilan kelishilsin.

### WP-C — Insho (`EssayComposer`) + Tezis (`ArticleComposer` thesis varianti), 2026-09-21

**Insho (C1).** Mavzu — `TopicRow` (hisoblagich, `ESSAY_LIMITS.topicChars`
= 300 — avval limit ko'rsatilmasdi). Tur endi umumiy `Segmented`
(kontekstdagi 5 tur — etalon qoidasi «≤6 Segmented, aks holda
`SelectField`» amalga oshdi, hozircha barcha kontekst ≤6 bo'lgani uchun
`SelectField` shoxi ishlatilmaydi, lekin kodda tayyor); eski qo'lda
yozilgan radiogroup (har tugmada alohida `title` tooltip) olib
tashlandi — izoh endi faqat Row darajasidagi ⓘ da (kontekst va tur
qatorlarida ikkalasida ham ortiqcha paragraf yo'qotildi). ▸ Sozlamalar
`SettingsDetails` (R0) ga o'tdi, xulosa chiplari endi **kontekst · tur ·
hajm · uslub** (avval design/person/extra edi — mahsulot egasi
qarori: kontekst/tur/hajm asosiy kartada ko'rinsa ham xulosada
takrorlanadi, chunki Sozlamalar yopiq holda forma butun holatini bir
qarashda ko'rsatishi kerak). «Materiallar» kartasi butunlay Sozlamalar
ichiga ko'chdi (uslub/ramka, bayon shaxsi, «O'z fikrlarim» endi
`LimitedTextarea`, shartli «Asar nomi»/«Epigraf», «Qo'shimcha»,
`ClearFormButton`) — insho qisqa janr, materiallar kamdan-kam
to'ldiriladi. `FormValues`/`ESSAY_PARAMS` (12) o'zgarmadi.

**Tezis (C2).** `ArticleComposer` ichida `isThesisTool(tool)` (mavjud
funksiya, `tool.id === "thesis"`) — alohida prop/fayl shart emas, WP-A
bilan konflikt kamaytirish uchun import blokiga tegilmadi, hammasi JSX
tanasida shartli render: **«Nashr profili» kartasi yashirin** (tur
standarti — `conference` — jim qo'llanadi, `data-field="pubProfile"`
ko'rinmas `<span hidden>` sifatida qoladi — reyestr qamrovi
buzilmaydi); **«Materiallar» kartasi** (`SourceFileField`, «Natijalarim»,
«Mening manbalarim», «Ma'lumot jadvali») bitta `materialsFields` JSX
sifatida chiqarilib, maqolada o'z kartasida, tezisda esa Sozlamalar
ichida chiziladi; **annotatsiya «uz+ru+en» izohi** tezisda ko'rinmaydi
(`conference_thesis`/`conference_extended` skeleti — bitta zich blok,
alohida annotatsiya bo'limi yo'q). Tur galereyasi ilgaridan
`THESIS_TYPE_IDS` bilan cheklangan edi (AUDIT-19) — o'zgarmadi. Hajm/narx
`Segmented` + `priceLabelFor`/`THESIS_PRICES` (4 000 / 5 000) — avvaldan
shunday, o'zgarmadi. **Maqola (`article`) formasi bitta qatori ham
o'zgarmadi** — mavjud testlar (`article-composer`, `article-form`)
yashil, alohida regressiya-qulfi test qo'shildi.

**Natija sahifasi (C3).** Insho uchun hisobot panelida bitta qatorlik
izoh: «Insho bitta matn — «Hammasini tuzatish» butun matnni qayta
ko'radi» (`data-essay-nofix-note`, faqat `isEssay`) — avval nega
bandma-band «Tuzatish» yo'qligi hech qayerda tushuntirilmasdi
(`forms3-talaba.md` §4 topilmasi).

**O'lchov (Chromium, 1400 px, kirgan foydalanuvchi, dev, WP-A/B bilan
bir vaqtda parallel; `measure-lock.sh` navbat bilan):**

| Vosita | Yopiq (oldin → keyin) | Ochiq | Mobil 390 px | Siljish | Narx |
|---|---|---|---|---|---|
| essay | 1 035 → **844** | 1 195 | 1 009 | yo'q | 2 500 tanga (standart) |
| thesis | 1 894 → **1 020** | 2 076 | 1 243 | yo'q | 4 000 tanga (standart) |
| article | 1 992 → **1 992** (o'zgarmadi) | 2 485 | 2 406 | yo'q | 6 000 tanga (standart) |

Ikkalasi ham etalon me'yoridan (≤ 1 200) past — tezis maqsadga aynan
yetdi (1 894 → 1 020, −46 %). Skrinshotlar: scratchpad `wpc-*.png`
(`wpc-essay.png`, `wpc-thesis.png`, `wpc-article.png` + `-mob` variantlari,
`wpc-*-filled.png`). Skrinshotda tezis formasi ko'zdan kechirildi:
«Nashr profili» kartasi yo'q, «Sozlamalar» xulosasi to'g'ri chiqadi.

**Jonli navbat smoke — TO'LIQ bajarilmadi (ochiq savol).** Bu worktree'da
`.env.local` yo'q (`DATABASE_URL` sozlanmagan) — `/api/auth/*` va
`/api/generations` DB talab qiladi, shuning uchun mavjud
`scratchpad/token.txt` (boshqa agent sessiyasidan) sinovda eskirgan
chiqdi va devLogin orqali yangisini olish ham DB yo'qligi sababli
ishlamadi (`DATABASE_URL sozlanmagan` xatosi). Bu WP-C kodining nuqsoni
emas — worktree provisioning masalasi (boshqa worktree'larda
`.env.local` bor, buni tekshirish `.env.local` fayliga tegishli bo'lgani
uchun ataylab chuqurroq surishtirilmadi — maxfiylik sabab). O'rniga
tenglashtiruvchi dalil: (1) Chromium skrinshot — forma to'g'ri
render qiladi, mavzu to'ldirilgach narx/chiplar to'g'ri; (2)
`tests/ui/article-composer.test.mts` dagi mavjud «tezis vositasi» testi
(fetch stub bilan) — `submit()` chaqirilganda `POST /api/generations`
tanasi `slug: "thesis"`, `articleType`, `pages` to'g'ri kelishini
tasdiqlaydi — bu jonli navbat bilan funksional ekvivalent.

**Testlar.** `tests/ui/essay-composer.test.mts` 11 → **15** (+4:
hisoblagich/limit, Sozlamalar xulosasi kontekst·tur·hajm·uslub va uning
dinamikligi, Segmented mutatsiya qulfi — tugmada `title` yo'q/Row `hint`
bor, Materiallar konsolidatsiyasi); `tests/viewer/article-form.test.mts`
7 → **13** (+6: tezis SSR ikki yo'nalishli qamrov, profil kartasi yo'q +
`pubProfile` hidden, standart tur tile'da, annotatsiya yo'q, maqola
regressiya-qulfi); `tests/ui/article-composer.test.mts` 19 → **22** (+3
yangi + 1 mavjud «tezis vositasi» testi endi ham yashil: profil kartasi
yo'q interaktiv, qamrov interaktiv, dispatch + tur ro'yxati cheklangan);
`tests/ui/result-flow.test.mts` 2 → **3** (+1, manba-matn qulfi).
`tests/essay-params.test.mts` (4), `tests/article-params.test.mts` (6),
`tests/ui/shared-forms.test.mts` (12), `tests/ui/essay-polish.test.mts`
(4) — barchasi yashil. `tsc --noEmit` va `eslint` (tegilgan fayllar)
toza.

**Mutatsiyalar (4, har biri qizardi, tekshirilib tiklandi):**

1. Tezisda «Nashr profili» kartasini qaytarish (shartsiz render) —
   `article-form.test.mts` dagi «kartasi ko'rinmaydi» testi qizardi
   (1 fail).
2. `essayKind` uchun eski qo'lda yozilgan radiogroup (har tugmada
   `title={k.hint}`) qaytarilishi — yangi «Tur — umumiy Segmented»
   testi qizardi (1 fail).
3. `pubProfile` hidden span'dan `data-field="pubProfile"` olib
   tashlash — ikki yo'nalishli qamrov testi VA «hidden field» testi
   qizardi (2 fail).
4. `ResultView`dagi insho izohini (`isEssay ?` sharti bilan birga) olib
   tashlash — `result-flow.test.mts` yangi testi qizardi (1 fail).

**Ochiq savollar.**

1. **Jonli navbat smoke** (yuqorida) — bu worktree'da DB ulanishi yo'q,
   shuning uchun haqiqiy `/uz/files/…` ga tushish tekshirilmadi; boshqa
   ish paketi (yoki lead) DB ulangan worktree'da tasdiqlab qo'ysa
   yaxshi bo'lardi. Kod tomonidan xavf past — `FormValues`/`priceFor`
   shartnomasi tegilmagan, jsdom submit testi mavjud.
2. Tezis Sozlamalar ochiq holatda 2 076 px (Materiallar + UDK/kalit
   so'z/vizual/qidiruv/uslub hammasi bitta blokda) — kelgusida ikki
   yig'iq blokka bo'lish mumkin, lekin etalon «bitta Sozlamalar»
   qoidasiga amal qilindi (WP-A xuddi shu qarorni WorkComposer uchun
   ham qabul qilgan).
3. Insho «Tur»da `SelectField` shoxi (>6 variant) hozircha sinalmagan
   — barcha 3 kontekst 5 turdan iborat; kelgusida yangi kontekst/tur
   qo'shilsa avtomatik ishga tushadi, lekin alohida vizual tekshiruv
   yo'q edi.

### WP-D1 — `GameComposer` (krossvord, flesh kartalar, saralash, tinglash)

Sana: 2026-09-21. To'rtala o'yin `StandardForm` dan chiqib bitta
`components/forms/GameComposer.tsx` ga o'tdi; `lib/tools.ts` da ularga
`custom: "game"`, `ToolWorkspace` dispatchiga bitta qator.

- **Tuzilma**: Mavzu (krossvordda rejim `Segmented` → `SourceFileRow`,
  mavzu `hidden` bilan saqlanadi) → O'yin (tur · hajm · til(lar), har
  biri bitta `Row`, izoh ⓘ tooltipda) → ▸ Sozlamalar (yopiq,
  `SummaryChips` «tur · soni · til»; misol kaliti `Switch`, qo'shimcha
  talab `LimitedTextarea`, «Formani tozalash»). Hammasi R0
  primitivlaridan (`shared/index.tsx`, `compact.tsx`).
- **⚠ Topilma yopildi** (`forms3-oyinlar-media.md` §1): saralash va
  tinglash formasi HECH BIR chip yoqilmagan holda ochilardi. Endi har
  standart REYESTRDAN — `gameDefaultTypeId` + turning `limits.*Default`
  lari (`wordsDefault`, `cardsDefault`, `includeExampleDefault`,
  `categoriesDefault`, `itemsPerCategoryDefault`, `itemsDefault`),
  tinglashda til juftligi `listening/input.ts` zaxiralaridan (uz → en).
  Chip/tur `hint` lari ham endi ko'rinadi (ilgari umuman chizilmasdi).
- **`hideWhen`** reyestrdan hisoblanadi: «qarama-qarshi juftlik» turi
  toifa sonini 2 ga qulflaydi (`limits.categories.length === 1`) →
  tanlov chizilmaydi (jonli tasdiq: `before=true, after=false`).
- **Shartnoma o'zgarmadi**: `FormValues` kalitlari va tekis 2 000 narx
  (faqat `priceFor`, formada hisob yo'q). `fields` massivi
  `lib/tools.ts` da ATAYIN qoldi — u ham reyestrdan quriladi va
  `StandardForm` zaxirasi, shartnoma testlari va `missingRequired`
  yorliqlari uchun kerak.
- **O'lchov (Chromium, 1400 px, yopiq)**: 844 → **844** (oldin ham,
  keyin ham sahifa minimal balandligi; ochiq 876–905, mobil 390 px
  789–880, gorizontal siljish yo'q). Maydonlar: 6–7, yoqilgan tanlov
  guruhlari 3–4 (oldin 0–2), tooltip 6 (oldin 0), `details` 1/0.
- **Jonli smoke**: tinglash formasi to'ldirilib «Yaratish» →
  `/uz/files/31a121b8-…`, `[data-price-total]` 2 000 tanga, balans
  24 500 → 22 500 (admin hisobi).
- **Testlar**: `tests/ui/game-composer.test.mts` 21,
  `tests/viewer/game-form.test.mts` 8 (SSR yopiq holat + ikki
  yo'nalishli `data-field` qamrovi); `tests/game-params.test.mts` 6,
  `pricing` 29, `document` 62, `viewer-kind` 11, `ui/shared-forms` 10
  yashil. `tests/pricing.test.mts` va `tests/document.test.mts` da
  `custom: "game"` shartnomasi yangilandi.
- **Mutatsiyalar** (4, har biri qizardi): (1) `itemsPerCategory`
  standartini olib tashlash — DASTLAB YASHIL qoldi, chunki chizish
  joyida ikkinchi zaxira bor edi (`values.x ?? limits.*Default`);
  zaxira olib tashlandi va SSR testi «yoqilgan tanlovlar soni ANIQ»
  bo'ldi; (2) `hideWhen` shartini o'chirish; (3) bitta `data-field`
  id sini buzish (qamrov ikki yo'nalishda qizardi); (4) qoralama
  normallashtirishini olib tashlash.
- **Ochiq savol**: tinglashda o'rganiladigan til hozir ham 3 ta
  (`TARGET_LANGUAGES`) — TTS jadvalida 18 til bor (`TTS_LANG_VOICES`),
  ya'ni ro'yxatni kengaytirish mumkin; bu UI sprintda xulq
  o'zgartirilmadi (egasi qarori kerak).


## 6. Ochiq bandlar

1. **Admin panel (egasi, 2026-09-21)** — keyingi dastur: platformani to'liq
   boshqarish, har xizmatga narx va haqiqiy tannarx belgilash, statistik
   diagrammalar. Shu sprintda cheklov: formalar narxni FAQAT `priceFor`
   orqali ko'rsatadi (rezyume `basePrice` istisnosi ham `priceFor` ga),
   yangi composerlarda qattiq yozilgan narx yo'q; `cost_json` telemetriyasi
   yopilishi (slayd/rasm/tarjimon/rezyume, rasm/TTS provayderlari) panel
   oldidan alohida WP.
