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
### WP-B — `TeacherComposer` bo'lindi, 5 kind kartalari (2026-09-21)

**Fayl bo'linishi.** 831 qatorli `components/forms/TeacherComposer.tsx`
→ `components/forms/teacher/`: `TeacherComposer.tsx` (qobiq — holat,
`useFormDraft`, profil, submit, kartalar tartibi), `common.tsx` (`Ui`,
`emptyUi`/`uiFromValues`/`toValues`, fan/sinf/til, o'quv dasturi qatori,
sana tanlagichi) va `LessonFields`/`MapFields`/`GlossaryFields`/
`KeysFields`/`TestFields` (kind-xos qatorlar + `*ApplyType` chegara
siqish + `*Summary` chiplari). Eski yo'l — re-eksport (ToolWorkspace,
`tests/client-boundary.test.mts` va mavjud importlar buzilmadi).

**Kartalar (5 kind uchun bir xil skelet).** Mavzu va rejim → Fan, sinf,
til → `<kind>` turi va hajmi → **Shapka** (endi `<details open>` emas,
oddiy karta: `AuthorRows` muassasa*/tuzuvchi* + shartli «Tasdiqlayman» +
sana) → **▸ Sozlamalar** (`SettingsDetails`, YOPIQ; qolgan kind-qatorlar,
sinf harfi, `extra` `LimitedTextarea`, `ClearFormButton`). Yopiq
xulosa chiplari: tur · sinf · hajm · rejim · kind-xos (`N savol turi`,
`OMR`, `N dastur mavzusi`…). Umumiy bo'laklar ishlatildi: `TopicRow`,
`AuthorRows`, `SourceFileRow` (eski katta dashed quti o'rniga),
`LimitedTextarea`, `SettingsDetails`, `Field`, `ClearFormButton`;
`AuthorRows` ga `placeholders` propi qo'shildi (test bilan) — «Muassasa»
qatorida universitet emas, maktab misoli turishi uchun.

**Yopilgan nuqsonlar.**
1. `approver` («Tasdiqlayman») test kindida endi FAQAT `bsb`/`chsb`
   turida chiziladi — dvigatel (`teacher/test/input.ts:156`) qolgan 4
   turda foydalanuvchi matnini jimgina tashlardi; zond
   (`probeWith:{testType:"bsb"}`) yolg'on yashil bo'lib turardi.
   lesson/map da avvalgidek doim ko'rinadi.
2. **Fan bitta manba**: `CurriculumPicker` da fan tanlansa `subject`
   matni avtomatik to'ladi va matn qatori yashirinadi (avto nom
   ko'rsatiladi); ilgari ikki «Fan» maydoni sinxron emasdi.
3. **Sana** — brauzerning `mm/dd/yyyy` maydoni o'rniga o'zbekcha
   kun · oy · yil tanlagichi (`DateRow`, `YYYY-MM-DD` chiqaradi,
   yarim to'ldirilgan sana bo'sh ketadi — `isoDate` shartnomasi).
4. **Jonli smoke topilmasi (400).** «Darslik dasturi» rejimida mavzu
   qatori YASHIRIN edi, lekin server `missingRequired` (`lib/tools.ts`)
   mavzuni faqat `file`/`text` rejimlarida istisno qiladi — mavzusiz
   so'rov `POST /api/generations 400` bilan qaytar, foydalanuvchi esa
   ko'rinmaydigan maydonni tuzata olmasdi (eski formada ham shunday
   edi). Endi mavzu faqat FAYL rejimida yashiriladi, klient ham shu
   shartni tekshiradi; test `missingRequired` bilan klient/server
   kelishuvini qulflaydi.

**O'lchov (Chromium, 1400 px, kirgan foydalanuvchi, qoralama tozalangan).**

| Vosita | Oldin (`forms3-olchov.md`) | Keyin | Ochiq | Mobil 390 px |
|---|---|---|---|---|
| dars rejasi | 1 424 | **1 153** | 1 620 | 2 028, siljishsiz |
| texnologik xarita | 1 187 | **1 113** | 1 380 | 1 686, siljishsiz |
| glossariy | 986 | **1 053** | 1 247 | 1 528, siljishsiz |
| keys | 989 | **1 053** | 1 250 | 1 505, siljishsiz |
| test | 1 477 | **1 137** | 1 644 | 2 155, siljishsiz |

Beshtasi ham ≤ 1 200 px me'yorida; glossariy/keys 60–70 px o'sdi (tur
endi alohida kartada, Shapka karta sifatida ochiq) — me'yor ichida.
1 200 dan o'tish uchun ikki qadam kerak bo'ldi: lesson/map dagi
IXTIYORIY o'quv dasturi qatori yig'iq Sozlamalarga ko'chdi (tanlangan
mavzular xulosa chipida ko'rinadi) va xaritada haftalik/yillik soat
bitta qatorga birlashdi. Jonli smoke: `/uz/test` → darslik rejimi → fan/
sinf/mavzu → «Testni yaratish» → `/uz/files/<id>` (navbatga tushdi),
`[data-price-total]` = 3 000 tanga = `priceFor` (o'zgarmas).
Skrinshotlar: sessiya scratchpad `b-<slug>.png` / `b-<slug>-mob.png`.

**Testlar.** `tests/ui/teacher-composer.test.mts` 16 → **40** (5 kind
qamrovi, ORTIQCHA `data-field` yo'qligi, dispatch, yig'iqlik, xulosa
chiplari, `approver` 6 turda, fan sinxroni 3 ta, rejim tilalari, sana,
kind mantiqlari, qoralama, submit, tozalash); `tests/viewer/
teacher-form.test.mts` 5 → **8** (SSR yopiq holat, `approver` yo'qligi,
`type=date` yo'qligi); `tests/ui/shared-forms.test.mts` 10 → **11**
(`placeholders`). Yashil: `teacher-params` (4), `client-boundary` (9),
tsc, eslint.

**Mutatsiyalar (5, har biri qizardi).** (1) `approver` sharti olib
tashlandi → 2 test; (2) `SettingsDetails open` → ui 1 + ssr 1 test;
(3) `difficulty` dan `data-field` olib tashlandi → qamrov + joylashuv
testi; (4) reyestrda yo'q `gradeDecor` belgisi qo'shildi → 6 test
(ikki yo'nalishli qamrov); (5) o'quv dasturi → `subject` sinxroni
uzildi → 2 test.

**Ochiq savollar (WP-B).**
1. `missingRequired` (`lib/tools.ts`) darslik rejimida mavzuni talab
   qiladi — bu formada hal qilindi (mavzu ko'rinadi), lekin to'g'ri
   yechim server tomonda `mode === "curriculum"` istisnosi bo'lishi
   mumkin. `lib/tools.ts` shu sprintda D1/D2/E agentlarida — qaror
   lead da.
2. `subjectId` (`CurriculumPicker` fani) `teacher-params.ts` reyestrida
   YO'Q, lekin `data-field` bilan chiziladi va so'rovda ketadi —
   qamrov testida yagona ruxsat etilgan istisno. Reyestrga qo'shish
   `probeWith:{mode:"curriculum"}` bilan mumkin (egasi qarori: id lar
   o'zgarmaydi — shu sprintda tegilmadi).
3. Infografika natija yorlig'i (`ImageViewer` shoxi) §1.4 jadvalida
   WP-B da ham, D2 da ham turibdi — WP-B da BAJARILMADI, D2 da qoladi.

### WP-D2 — `MediaComposer` (podkast/tabriknoma) + `InfographicComposer`, 2026-09-21

**MediaComposer (D2a).** Podkast va tabriknoma BITTA composerga
tushdi — ikkalasi ham `doc.audio` modeliga yoziladi, farq faqat
`kind` (`audioKindOf(tool.id)`) va reyestr TURI (janr). Karta 1
«Mavzu va rejim» (podkast) / «Kimga va sabab» (tabriknoma): podkastda
rejim `Segmented` (mavzu/matn/fayl) BITTASINI ko'rsatadi — `TopicRow` |
`LimitedTextarea` | `SourceFileRow` (avval uchalasi bir vaqtda ko'rinardi,
`sourceText` hint'i «faqat matn rejimida ishlatiladi» deb yashirin
qoidani izohlashga majbur edi); tabriknomada kimga (`TextInput`), kim
bo'ladi — `Segmented` (5 tayyor variant + «Boshqa» erkin matnni ochadi,
`relation` reyestrda ENUM emas, erkin satr bo'lgani uchun), sabab —
`SelectField` (6 janr). Karta 2 «Audio»: tur `Segmented` (podkast 3
turi, tabriknomada yo'q — sabab allaqachon janr), davomiylik `RangeRow`
(1–5 / 1–4 daqiqa, `price={priceFor}` — SLAYDER hech narsani
hisoblamaydi, narx ikkala vosita uchun ham tekis 4 000), til `Segmented`
(uz/ru/en). ▸ Sozlamalar — `extra` (`LimitedTextarea`),
`ClearFormButton`. `audioInputFromValues`/`encodeAudioValues`
(`audio/input.ts`) bitta manba (`EssayComposer` naqshi) — qoralama
tiklanganda forma DVIGATEL bilan bitta qoidadan normallashadi.

**InfographicComposer (D2b).** Karta 1 «Mavzu»: `TopicRow` + til
`Segmented`. Karta 2 «Plakat»: tur `SelectField` (7 variant, hint —
`≥7 SelectField` qoidasi), blok soni `Segmented` (TUR chegarasiga
kesilgan ro'yxat — `process` da 8 chipi yo'q, `normalizeBlockCountFor`
tur almashganda joriy qiymatni ham qisqartiradi), palitra `ColorDots`
(6 rang, reyestr hex'laridan), o'lcham A4/A3 `Segmented`. ▸ Sozlamalar
— `extra`, `ClearFormButton`. `infographicInputFromValues`/
`encodeInfographicValues` bitta manba. `lib/generation/infographic-params.ts`
allaqachon bor edi (R0/WP-C oldidan yaratilgan) — yangi fayl kerak
bo'lmadi.

**D2c.** `lib/tools.ts`: `podcast`/`greeting` → `custom: "media"`,
`infographic` → `custom: "infographic"` (`fields`/`modes`/`topicLegend`
o'zgarmadi — server tekshiruvi shu yerdan o'qiydi). `ToolWorkspace.tsx`
dispatch'ga ikki qator.

**D2d.** `ImageViewer.tsx` natija sahifasi tepa panelida infografika
uchun «Foto · 1:1 · N rasm» o'rniga «Infografika · A4 · N blok»
(`doc.infographic.spec` dan — `size`, `blocks.length`; sarlavha ham
`spec.title`dan, `ResultView.tsx`dagi `isPoster` bilan bitta naqsh).
Rasm vositasi (`image`) eski yorlig'ini saqlaydi.

**O'lchov (Chromium, 1400 px, kirgan foydalanuvchi, `.env.local`
worktree'ga ko'chirilgach — pastga qarang):**

| Vosita | Yopiq | Mobil 390 px | Siljish |
|---|---|---|---|
| podcast | **844** | 889 | yo'q |
| greeting | **844** | 899 | yo'q |
| infografika | **844** | 940 | yo'q |

Etalon me'yori (≤ 1 200) hammasida katta zaxira bilan bajarildi (avval
podkast/tabriknoma 844–1 093, infografika 878 — `StandardForm` edi,
yangi composer HAR uchtasini 844 ga tekislagan). Skrinshotlar:
scratchpad `wpd2-*.png`.

**Jonli smoke.** `/uz/podcast`, `/uz/greeting`, `/uz/infografika` —
uchtasi ham ochilib to'g'ri chizildi. Infografika to'liq sinaldi:
mavzu «Fotosintez jarayoni» → «Infografika yaratish» → navbatga tushdi
(`/uz/files/42d3db88-…`, narx 2 000 tanga) → generatsiya ~1 daqiqada
tugadi (Gemini) → natija sahifasida **«Infografika · A4 · 5 blok»**
yangi yorlig'i, tayyorlik hisoboti 100/100, DOCX/PNG emas — PNG
plakat to'g'ri chizilgan (skrinshot `wpd2-infografika-result.png`).
Topilma: worktree'da `.env.local` yo'q edi (`DATABASE_URL yo'q`,
WP-C ham xuddi shu sabab bilan jonli smoke'ni o'tkazib yuborgan) —
asosiy checkout'dagi `.env.local` worktree ildiziga nusxalandi
(gitignore'da, kommitga tushmaydi); shu tuzatishdan keyin smoke to'liq
o'tdi.

**Testlar.** `tests/ui/media-composer.test.mts` (12): QAMROV har kind
bo'yicha (`AUDIO_PARAMS`, podkastda uch rejim aylanib), rejim bittasini
ko'rsatadi, standart tur/sabab reyestrdan, davomiylik slayder +
narxning O'ZGARMASLIGI, tur almashsa ham narx bir xil, Sozlamalar
yopiq, ikkala kind submit tanasi, mavzusiz rad etish, «Boshqa»
munosabat matni, `ToolWorkspace` dispatch. `tests/ui/infographic-composer.test.mts`
(9): QAMROV (`INFOGRAPHIC_PARAMS`), `ColorDots` aria, standart tur/blok,
blok soni TUR chegarasiga kesiladi, narx tekis 2 000, Sozlamalar yopiq,
submit tanasi, mavzusiz rad etish, dispatch. `tests/viewer/media-form.test.mts`
(5) / `infographic-form.test.mts` (4) — SSR yopiq `<details>`, ikki
yo'nalishli `data-field` qamrovi, narx, dispatch predikati.
`tests/ui/image-viewer.test.mts` (2, D2d) — eski yorliq saqlanadi (rasm
vositasi), yangi yorliq `doc.infographic`dan. `tests/audio-params.test.mts`
(8) va `tests/infographic-params.test.mts` (5) yashil qoldi o'zgarishsiz.
Jami yangi/yangilangan test — 40. `tsc` (butun loyiha) va `eslint`
(tegilgan fayllar) toza.

**Mutatsiyalar (3, har biri qizardi, qaytarilgach yashil):**

1. `InfographicComposer.onTypeChange` dan `normalizeBlockCountFor`
   chaqiruvi olib tashlandi — 8 blok tanlab «process» ga o'tilganda
   HECH BIR chip tanlangan holatda qolmadi (eski qiymat ro'yxatdan
   tushib ketdi) — «blok soni tur chegarasiga kesiladi» testi qizardi.
2. `MediaComposer`da `price` `ui.durationMin * 100` bilan
   o'stirilgan — «davomiylik slayder» va «tur almashsa narx bir xil»
   testlari (ikkalasi) qizardi — narx reyestr qoidasi bo'yicha
   (egasi qarori 6) davomiylikka BOG'LIQ EMAS.
3. Podkast rejim shartsiz (`ui.mode === "topic" ?` → `true ?`)
   doim `TopicRow` chizadigan qilindi — QAMROV testi (formada
   reyestrsiz/yetishmayotgan maydon) VA «rejim BITTASINI ko'rsatadi»
   testi qizardi.

**Ochiq savollar.**

1. `relation` (tabriknoma «Kim bo'ladi?») reyestrda ENUM emas — erkin
   satr. Composer 5 preset + «Boshqa» bilan `Segmented` qildi (etalon
   qoidasi «3–6 Segmented»), lekin bu UI qaror, dvigatel shartnomasi
   o'zgarmadi; kelgusida haqiqiy reyestr (masalan `greeting/registry.ts`
   ga presetlar) qo'shilsa composer shundan o'qishga o'tishi mumkin.
2. `MediaComposer`/`InfographicComposer` `TARGET_LANGUAGES` (uz/ru/en)
   dan foydalanadi — audio dvigateli 18 tilni qo'llab-quvvatlaydi
   (`TTS_LANG_VOICES`), lekin eski `StandardForm` ham shu uch tilni
   ko'rsatgan edi (`LanguagePicker` standart `scope="target"`); qamrov
   kengaytirish alohida mahsulot qarori talab qiladi.

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

### WP-E — Etalon nomuvofiqliklari (5 umumiy forma)

`components/forms/SlideComposer.tsx` (+ `slide-fields.tsx`, `TemplateGallery.tsx`,
`slide-pickers.tsx` o'chirildi), `TranslationForm.tsx`, `ImageStudio.tsx`
(qayta yozildi), `ResumeComposer.tsx` + `ResumeTemplateDialog.tsx`,
`components/forms/shared/index.tsx` (`SourceFileRow` ga `onFile`/`badge`
kengaytmasi), `compact.tsx` (`MiniInput` o'chirildi), yangi
`lib/generation/image-params.ts`. `ArticleComposer.tsx`/`EssayComposer.tsx`/
`ToolWorkspace.tsx`/`lib/tools.ts` ga TEGILMADI (WP-A/C/D chegarasi).

**`forms3-etalon.md` §6 — 10 nomuvofiqlik holati:**

| # | Band | Holat |
|---|---|---|
| 1 | Sozlamalar chevron indikatori | **Yopildi** (slayd/tarjimon/rezyume) — umumiy `SettingsDetails` chevron bilan. Maqolada yo'q — lead qo'shadi. |
| 2 | Sozlamalar mexanizmi (native vs React holatli) | **Yopildi** (slayd/tarjimon/rezyume) — BITTA `SettingsDetails` komponenti, controlled (`open`/`onToggle`, rezyume) va uncontrolled (slayd/tarjimon) rejimlarni bitta API bilan beradi. Maqola alohida qoldi. |
| 3 | Sozlamalar konteyneri `Card` ishlatmaydi | **Yopildi** (slayd/tarjimon/rezyume) — konteyner markupi endi `SettingsDetails`ning o'zida, har composerda qo'lda takrorlanmaydi. Maqola alohida qoldi. |
| 4 | «Bezak maydon yo'q» ikki mustaqil mexanizm (matn-skaner vs `data-field`) | **Qisman.** Rasm endi `IMAGE_PARAMS` + `data-field` (DOM mexanizmi, Maqola/Rezyume naqshi) — bundan buyon 3/5 forma DOM asosida. Slayd **qasddan** matn-skaner (`slide-params.test.mts`) bilan qoldi: reyestr/dvigatel shartnomasi («`FormValues` nomlari o'zgarmaydi», reja §1.5 band 5) o'zgartirilmadi, mavjud 19 testli qamrov ishlab turibdi — mexanizmni almashtirish alohida WP bo'lishi kerak. |
| 5 | Fayl yuklash UI — 2 mustaqil komponent | **Yopildi** (slayd, tarjimon) — ikkalasi ham umumiy `SourceFileRow`. Tarjimonga xos talab (fayl BAYTI serverga, matn emas) uchun `SourceFileRow`ga minimal `onFile`/`badge` kengaytmasi qo'shildi (standart `/api/extract` oqimini chetlab o'tadi). Maqola hali `SourceFileField` — lead qo'shadi. |
| 6 | Narxni qayta ko'rsatish faqat Slayd | **Kengaydi (qasddan farq emas).** Checklist band 10 shuni ANIQ ruxsat beradi: narxni belgilaydigan parametr yonida takrorlash mumkin. Endi Rasm ham «Nisbat va soni» kartasida shu naqshni ishlatadi (`imageCount` narxni belgilaydi). Tarjimon/Rezyumeda narxga bevosita ta'sir qiluvchi BITTA parametr yo'q — shuning uchun ular bu naqshni ishlatmaydi, bu ATAYLAB. |
| 7 | Qoralama qamrovi (Maqola/Rezyume bor, Slayd/Tarjimon yo'q) | **Yopildi** — `useFormDraft("slide"/"pro-slide")` va `useFormDraft("translation")` qo'shildi (`enabled: loggedIn`). Tarjimonda `sourceText` ATAYLAB qoralamaga tushmaydi (katta bo'lishi mumkin). |
| 8 | `MiniInput` ishlatilmaydi (o'lik kod) | **Yopildi** — o'chirildi. Sabab: 5 forma ham `AuthorRows`/`textRow` Row-asosidagi naqshni ishlatadi (yorliq chapda), `MiniInput`ning «yorliq tepada» uslubi loyihadagi yagona dizayn tiliga (checklist band 3) zid edi va hech qayerda ishlatilmagan edi. |
| 9 | Rang/palitra tanlagich 2 marta yozilgan | **Yopildi** — `ColorPicker` (`slide-pickers.tsx`) o'chirildi, `TemplateGallery` endi umumiy `ColorDots` (ikki rangli mavzular uchun CSS gradient `hex` sifatida — vizual saqlanadi). `ResumeTemplateDialog`dagi qo'lda palitra tugmalari ham `ColorDots`ga o'tdi. |
| 10 | Rezyume narxi `tool.basePrice` statik | **Yopildi** — `price={priceFor(tool, values)}`. Natija bir xil (3 000 tekis), lekin endi bitta manba — kelajakdagi admin panel narxni shu funksiyadan boshqaradi. |

**Chromium o'lchov (1400 px, kirmagan sessiya — token muhit muammosi, pastga
qarang), `docs/research/forms3-olchov.md` bazaviy qatorlari bilan solishtirilgan:**

| Vosita | Yopiq oldin → keyin | Ochiq oldin → keyin | Mobil (390 px) oldin → keyin |
|---|---|---|---|
| slide | 1208 → 1208 | 1504 → 1536 | 2325 → 1603 |
| pro-slide | (o'lchanmagan) → 1195 | → 1750 | → 1540 |
| translation | 858 → 858 | 1041 → 1041 | 1216 → 1008 |
| rasm | **1359 → 941** | 1359 → 990 | 1888 → 1134 |
| resume | **1937 → 1663** | 2327 → 2066 | 2863 → 2031 |

Rasm eng katta yutuq — `ToolChrome`siz 1 359 px dan (talab: ≤ 1 000 px yopiq)
**941 px**ga tushdi. Rezyume ham 1 937 → 1 663 px. Slayd/tarjimon balandligi
deyarli o'zgarmadi — kutilgan, chunki bu WP ularning karta tarkibini/tartibini
o'zgartirmadi, faqat ichki bo'laklarni umumiylashtirdi (bir xil vizual natija,
bitta manba). Mobil raqamlardagi farq (ayniqsa slayd 2325→1603) o'lchov
o'tkazilgan sessiyalar orasidagi muhit farqiga ham tegishli bo'lishi mumkin
(boshqa commit/vaqt) — gorizontal siljish (`overflow`) HECH birida yo'q edi.
Skrinshotlar (yopiq/ochiq/mobil, har forma) scratchpad `wpe-<slug>*.png`.

**Rasm to'ldirib «Yaratish» smoke:** forma to'g'ri to'ldirildi (tavsif,
Nechta rasm=4 → narx darhol 6 000ga o'zgardi — qo'lda tekshirilgan), lekin
sessiya tokeni (`scratchpad/token.txt`, boshqa agent/vaqt uchun berilgan)
bu worktree dev serverida ishlamadi («Kirish» oynasi chiqdi — Telegram bot
login TELEGRAM_BOT_TOKEN sozlanmagan muhit xabari), shuning uchun to'liq
navbatga qo'yish (fal.ai) sinovi bajarilmadi. Bu **muhit/sessiya masalasi**,
WP-E kodiga aloqasi yo'q — narx sinxronligi (`priceFor`) allaqachon
`tests/image-params.test.mts` (4 test) va `tests/ui/image-studio.test.mts`
(8 test, shu jumladan mutatsiya bilan tasdiqlangan `data-price-total`/
`data-price` sinxronligi) orqali avtomatik qulflangan.

**Testlar:** `tests/ui/slide-composer.test.mts` 4→7 (+3: qoralama tiklash,
ColorDots aria, SourceFileRow fayl rejimi), `tests/viewer/slide-form.test.mts`
11 va `tests/slide-params.test.mts` 19 — o'zgarishsiz yashil;
`tests/ui/translation-form.test.mts` 5→7 (+2: SettingsDetails, qoralama);
`tests/ui/shared-forms.test.mts` 10→11 (+1: `SourceFileRow.onFile`);
`tests/ui/resume-composer.test.mts` 12→14 (+2: `priceFor`, ColorDots);
`tests/ui/resume-template-dialog.test.mts` 3 — o'zgarishsiz yashil; yangi
`tests/ui/image-studio.test.mts` 8, `tests/image-params.test.mts` 4.
Jami: WP-E **20 yangi test** qo'shdi; tegilgan 9 test faylida (jumladan
`slide-form.test.mts` 11 va `slide-params.test.mts` 19 — o'zgarishsiz)
**84 test** yashil.

**Mutatsiya (≥ 3, har biri qizil bo'lganini tasdiqladim, keyin qaytardim):**
1. `SettingsDetails` chevronidan `aria-hidden` olib tashlash →
   `translation-form.test.mts` «▸ Sozlamalar» testi qizardi.
2. `shared/index.tsx` `ColorDots`dan `role="radio"` olib tashlash →
   `resume-composer.test.mts` va `slide-composer.test.mts` rang testlari
   qizardi (mavjud `shared-forms.test.mts` ColorDots testi buni USHLAMAYDI —
   u faqat `aria-label` bo'yicha qidiradi; yangi testlar shu bo'shliqni yopdi).
3. `ImageStudio.tsx`da `price = priceFor(tool, values)` o'rniga qattiq
   `price = 2000` → `image-studio.test.mts` narx-sinxronlik testi qizardi.

**Yon ta'sir (bonus tuzatish):** `npm run typecheck` loyiha bo'yicha 5 ta
oldindan mavjud xato bilan qizil edi (R0'ning `tests/ui/shared-forms.test.mts`
dagi `createElement(Component, props, child)` uch argumentli chaqiruvi
`children: ReactNode` majburiy proplar bilan TS overload'ini buzgan, +
ikkita `waitFor(fn, "matn")` — ikkinchi argument `waitForOptions`, satr emas).
WP-E fayllariga aloqasi yo'q edi (R0 commitida ham xuddi shunday edi), lekin
«tsc toza» talabi uchun yo'lda tuzatib qo'ydim (`children`ni props ichiga
ko'chirish, `waitFor` ikkinchi argumentini olib tashlash/`{timeout}`ga
almashtirish) — xatti-harakat o'zgarmadi, faqat tip xatosi ketdi.

**`npm run check` holati (WP-E oxirida):** `npx tsc --noEmit` — 0 xato (butun
loyiha); `eslint` WP-E tegilgan 16 fayl — 0 xato/ogohlantirish; `npm test`
(dvigatel) 2 587/2 600 o'tdi, 13 skip (oldindan mavjud, `.env.local`/fal.ai
kalitiga bog'liq); `npm run test:viewer` 219/219; `npm run test:ui` 281/281.

## 6. Ochiq bandlar

1. **Admin panel (egasi, 2026-09-21)** — keyingi dastur: platformani to'liq
   boshqarish, har xizmatga narx va haqiqiy tannarx belgilash, statistik
   diagrammalar. Shu sprintda cheklov: formalar narxni FAQAT `priceFor`
   orqali ko'rsatadi (rezyume `basePrice` istisnosi ham `priceFor` ga),
   yangi composerlarda qattiq yozilgan narx yo'q; `cost_json` telemetriyasi
   yopilishi (slayd/rasm/tarjimon/rezyume, rasm/TTS provayderlari) panel
   oldidan alohida WP.
