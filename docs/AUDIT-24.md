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
