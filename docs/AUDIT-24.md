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

## 6. Ochiq bandlar

1. **Admin panel (egasi, 2026-09-21)** — keyingi dastur: platformani to'liq
   boshqarish, har xizmatga narx va haqiqiy tannarx belgilash, statistik
   diagrammalar. Shu sprintda cheklov: formalar narxni FAQAT `priceFor`
   orqali ko'rsatadi (rezyume `basePrice` istisnosi ham `priceFor` ga),
   yangi composerlarda qattiq yozilgan narx yo'q; `cost_json` telemetriyasi
   yopilishi (slayd/rasm/tarjimon/rezyume, rasm/TTS provayderlari) panel
   oldidan alohida WP.
