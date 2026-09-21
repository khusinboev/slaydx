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

(bo'sh)

## 6. Ochiq bandlar

1. **Admin panel (egasi, 2026-09-21)** — keyingi dastur: platformani to'liq
   boshqarish, har xizmatga narx va haqiqiy tannarx belgilash, statistik
   diagrammalar. Shu sprintda cheklov: formalar narxni FAQAT `priceFor`
   orqali ko'rsatadi (rezyume `basePrice` istisnosi ham `priceFor` ga),
   yangi composerlarda qattiq yozilgan narx yo'q; `cost_json` telemetriyasi
   yopilishi (slayd/rasm/tarjimon/rezyume, rasm/TTS provayderlari) panel
   oldidan alohida WP.
