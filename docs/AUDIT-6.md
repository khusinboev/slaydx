# SlaydX — 6-raund audit: jonli ko'ruvchi va yasalgan kontent

**Sana:** 2026-09-06
**Obyekt:** `components/viewers/*`, `lib/viewers/*`, `components/files/ResultView.tsx`,
`components/home/{HomeFiles,FilePreview}.tsx` va ular bilan juftlashadigan
`lib/generation/{render-docx,render-pptx,render-html,title-model,toc-model,docx-profile}.ts`.
**Usul:** kod qatlamma-qatlam o'qildi va ikki mustaqil tahlil (ichki + tashqi AI)
o'zaro solishtirildi. Har topilma `file:line` da tekshirilgan. Jonli DOCX namunasi
(`eval-out/live/`) ochib ko'rildi.
**Baza:** 265 test o'tadi, `typecheck` + `lint` toza (2026-09-06).
**Munosabat:** `AUDIT.md` ... `AUDIT-5.md` ni **davom ettiradi**. Ularda yopilgan
bandlar qayta sanalmaydi; bu yerda faqat hozir ham amalda bo'lgan narsalar.

---

## 1. 60 soniyalik xulosa

`AUDIT-5` savoli — "saytda ko'rganim = yuklab olganim" — hali barcha 14 vositada
bajarilmagan. Slayd va rasm yagona-manba naqshi tufayli deyarli pro; akademik
Word yaqin; o'qituvchi 4 vositasi va rezyume hali saytda boshqa hujjat, faylda
boshqa hujjat.

`AUDIT-5` da yo'q, yangi topilgan narsalar:

1. **Titul yili render vaqtidan olinadi** — 2025-da yaratilgan fayl 2026-da
   ochilganda ko'ruvchi "2026" va "2026-2027 o'quv yili" ko'rsatadi, faylda esa
   "2025" muzlagan. (`title-model.ts:60`)
2. **Muddati o'tgan hujjat chalkash bo'sh ko'ruvchi beradi** — `FILE_TTL_HOURS=72`
   dan keyin qator qoladi, kontent NULL, ko'ruvchi "Hujjat matni topilmadi" yoki
   rasmda "qayta generate qiling" (chalg'ituvchi). (`ResultView.tsx:210`)
3. **Varaqdan oshgan yagona blok jim kesiladi** — `.word-sheet{overflow:hidden}` +
   `packPages` blok darajasida; uzun paragraf yoki katta jadval varaqqa sig'masa
   pasti yo'qoladi. (`globals.css:155`, `paginate.ts`)
4. **Ekranda ko'rinadigan lentalar faylda yo'q** — "TARJIMA", "Badiiy-ilmiy
   insho", maqola "org . email" (bu titulda takror). (`WordViewer.tsx:91`)
5. **Zoom bosqichlari buzilgan** — `TableViewer` default `80` `ZOOM_STEPS` da yo'q;
   zoom foizi tugmasi 5 ko'ruvchida o'lik. (`metrics.ts:27`, `TableViewer.tsx:40`)
6. **Sichqoncha bilan varaqlanganda sahifa raqami yangilanmaydi** —
   `IntersectionObserver` faqat `WordViewer` da.
7. **Ctrl+F ikki marta topadi** — o'lchov node offscreen, lekin qidiriladi.
8. **O'chirish tasdiqsiz** — `ResultView` + `HomeFiles` darhol `DELETE`.

| Qatlam | Ball /10 | Izoh |
|---|---:|---|
| Slayd (`planSlide` -> `SlideCanvas` = PPTX) | 8.5 | Yagona manba; presenter dual-screen yo'q |
| Rasm (`ImageViewer`) | 8 | Lightbox klaviaturasiz; qisman yetkazish jim |
| Akademik Word (`WordViewer`) | 7.5 | Titul/mundarija/sahifalash/imzo; kesilish, yil, Ctrl+F |
| Maqola / insho / tarjima | 7 | Lentalar faylda yo'q; maqola lentasi takror |
| Rezyume | 6.5 | 2 ustun g'oyasi bor; 1 sahifaga qirqiladi; til qattiq uz |
| Glossariy / keys / dars / xarita | 5.5-6.5 | GOST titul qo'shilgan, lekin brend-muqova qolgan |

**Yakuniy: ~7.3/10.** Ochilishga yaqin. Slayd va'dani bajaradi; qolgan 12
vositada "ko'rdim = oldim" hali yopilmagan.

---

## 2. Nima puxta qilingan (tegmaslik kerak)

- **Slayd preview = eksport.** `SlideCanvas` va `render-pptx` bir xil
  `planSlide()` koordinatalaridan chiziladi (thumbnail, sahna, presenter, keyingi
  slayd eskizi — hammasi). Loyihaning eng kuchli joyi.
- **Yagona titul modeli** (`title-model.ts`) — GOST va jurnal titulini ajratadi;
  `render-docx` ham, `TitlePage` ham shu modelni chizadi (`AUDIT-5` P0-2).
- **Sahifalash o'ylangan** — `packPages` / `useMeasuredPages` haqiqiy DOM
  balandligidan; sarlavha keyingi matn bilan birga ko'chadi (`blockHeight`),
  o'lchov `flow-root` da, 165 mm haqiqiy kenglikda.
- **Varaq chrome** — kulrang workspace, A4 soya, pastki raqam 11 pt, hoshiya
  3+1.5+2 sm, Tinos, insho ramkasi faqat inshoda.
- **Halollik** — `referencesNote` ko'ruvchida bor; bo'sh bo'lim sarlavhasi
  chizilmaydi; ostmavzu chapda; PDF tugmasi faqat DOCX/PPTX da; rasm kengaytmasi
  MIME dan; `delivered` qisman qaytarish.
- **Kontent sifati** — jonli DOCX namunasi (`Kasrlarni qoshish...docx`): aniq
  misollar (`1/2 + 1/3 = 3/6 + 2/6 = 5/6`), daqiqalar yig'indisi 45, real matnli
  masalalar. Professional daraja.

---

## 3. Topilmalar — og'irlik tartibida

Belgilar: **[P1]** mahsulot sharti / pul / ko'p foydalanuvchi . **[P2]** aniq
"ko'rdim != oldim" yoki ma'lumot yo'qolishi . **[P3]** izchillik / UX nuqsoni .
**[P4]** mayda / latent.

### A. Ko'rinish != Fayl

| # | Sev | Joy | Muammo | Reja |
|---|---|---|---|---|
| A1 | P2 | `GlossaryViewer:81`, `KeysViewer:102`, `LessonViewer:75`, `TableViewer:78`, `ResumeViewer:37` | Maxsus ko'ruvchilar brend-muqova / kartochka / info-grid chizadi; DOCX esa GOST sarlavha. Titul qo'shilgan (`AUDIT-5` P1-5), lekin ikkinchi, brendlangan muqova qolgan. | **Mahsulot qarori** — pastdagi bo'lim. Sprintda emas. |
| A2 | P2 | `write-specials.ts` `writeKeysWithLlm` -> `toc:true`; `KeysViewer` TOC chizmaydi | Faylda mundarija varag'i bor, ko'ruvchida yo'q -> varaq raqamlari siljiydi. | **Sprint 1:** `toc:false` (glossary bilan bir xil). |
| A3 | P2 | `WordViewer.tsx:91-105` | Ekranda "TARJIMA" yashil lenti, "Badiiy-ilmiy insho" kursiv qatori, maqola "org . email". `render-docx` bularni chizmaydi. Maqolada "org . email" titulda takror. | **Sprint 1:** uch lentani ham olib tashlash. |
| A4 | P2 | `Glossary/Keys/Lesson/Table/ResumeViewer` | ru/en hujjatda ham qattiq o'zbekcha yozuv. `LessonViewer:81` `Til: {doc.meta.language}` — til nomi emas, xom kod. | **Sprint 3:** ko'ruvchi chromeni `sectionLabels(doc.meta.language)` ga ulash; `Til:` uchun `languageName(code)`. |
| A5 | P3 | `paginate.ts:72` | `if (item.type === "abstract") flush()` — har annotatsiyani alohida varaqqa majburlaydi. `annotationLangs:"all"` -> 3 varaq, faylda ~1. Varaq raqamlari ~2 taga siljiydi. | **Sprint 4:** faqat birinchi annotatsiya oldida `flush`. |
| A6 | P2 | `title-model.ts:60` `new Date(Date.now()).getFullYear()` | Yil render vaqtida hisoblanadi. DOCX baytlari muzlaydi, ko'ruvchi qayta hisoblaydi. Yil chegarasida ajraladi. | **Sprint 1:** `DocMeta.year`, `extractMeta` da muzlatish; `title-model` `meta.year ?? new Date()`. Eski `doc_json` — `createdAt` dan orqaga to'ldirish. |
| A7 | P3 | `TitlePage.tsx:51` | `title.university` har doim chiziladi. `render-docx.ts:435` esa "Oliy ta'lim muassasasi" o'rinbosarini tashlaydi. | **Sprint 1:** guardni `title-model` ga (yagona joy). |
| A8 | P4 | `globals.css:182` `.word-inner` = 14 pt / 1.5 / justify | Ko'ruvchi CSS qat'iy GOST tipografiya. Glossariy DOCX `reference` (13 pt), dars 13 pt, albom 12 pt, rezyume Calibri. | **Kelajak:** `docx-profile` tipografiyasini CSS o'zgaruvchilariga chiqarish. Katta ish. |
| A9 | P3 | `render-docx.ts:277` `columnWidths()` eksport qilinmagan | Xarita/dars jadvali DOCX da og'irlikli (`[5,8,33,15,25,14]`), ko'ruvchida auto layout -> "Mavzu" ustuni siqiladi. | **Sprint 3:** `columnWidths` ni umumiy modulga chiqarib, `TableViewer`/`LessonViewer` `<colgroup>` bilan qo'ysin. |

### B. Kontent yo'qolishi / kesilishi

| # | Sev | Joy | Muammo | Reja |
|---|---|---|---|---|
| B1 | P2 | `globals.css:155` + `paginate.ts` | Sahifalash blok darajasida — uzun paragraf yoki katta jadval bitta varaqqa qo'yiladi, sig'masa pasti jim kesiladi. | **Sprint 5:** WordViewer jadvalini `docToFlow` da bo'lish; balandlik chegarasidan oshgan blokda ogohlantirish. |
| B2 | P2 | `GlossaryViewer:79`, `LessonViewer:66`, `TableViewer:69` | "Qattiq" muqova/pasport/kirish varag'i o'lchanmaydi — uzun kirish chetdan chiqadi. | **Sprint 5:** muqova bloklarini `useMeasuredPages` oqimiga qo'shish. |
| B3 | P2 | `ResumeViewer.tsx:34` `overflow-hidden`, `pages={1}` | Rezyume 1 sahifaga qat'iy qirqiladi — uzun tajriba pasti yo'qoladi. | **Sprint 3:** o'ng ustunni varaqqa bo'lish. |
| B4 | P3 | `slide-layout.ts:225-247` `fitSize`/`fitLines` | `rows = ceil(chars / perLine)` — so'z-o'ralishni kam baholaydi. Zich bandda matn qutidan chiqadi -> viewer + PPTX da kesiladi. | **Kelajak:** `fitLines` tuzatmasi yoki band belgi chegarasini pasaytirish. Risk. |
| B5 | P4 | `write-specials.ts:174` `clip(st.activity, 120)` | Dars vaqt jadvali kataklari "..." bilan kesiladi; nasr allaqachon to'liq bor -> jadval yarim va takror. | **Sprint 4:** "Faoliyat" ustunini "maqsad/natija" ga almashtirish. |

### C. Ko'ruvchi UX va xatolar

| # | Sev | Joy | Muammo | Reja |
|---|---|---|---|---|
| C1 | P1 | `ResultView.tsx:210`, `HomeFiles.tsx:223` | `FILE_TTL_HOURS=72`. Muddat tugagach kontent NULL, fayl o'chadi, qator 90 kun `COMPLETED`. `ResultView` `expiresAt`/`hasFile` ni tekshirmaydi -> "Tayyor" + bo'sh ko'ruvchi. Muddatdan oldin ham ogohlantirish yo'q. | **Sprint 2:** `COMPLETED && !hasFile` -> alohida "muddati tugagan" holat + "Yaratish". Kartochkada belgi. TTL 72->168 tavsiya. |
| C2 | P3 | `TableViewer.tsx:40` `useState(80)` | `80` `ZOOM_STEPS` da yo'q -> `+` darhol 150 ga, `-` 50 ga. | **Sprint 1:** default `80` -> `75`. |
| C3 | P3 | `Glossary/Keys/Lesson/Table/ResumeViewer` | `<ViewerToolbar>` ga `onFit` uzatilmaydi -> zoom foizi tugmasi o'lik. | **Sprint 1:** har biriga `onFit`. |
| C4 | P3 | `Glossary/Keys/Lesson/TableViewer` | Sichqoncha bilan varaqlanganda toolbar `page` yangilanmaydi — `IntersectionObserver` faqat `WordViewer` da. | **Sprint 3:** umumiy `useVisiblePage` hook. |
| C5 | P3 | `WordViewer.tsx:152`, `measure.tsx:63` | O'lchov node offscreen `aria-hidden`, lekin Ctrl+F uni ham sanaydi -> hit soni 2x. | **Sprint 1:** o'lchov node ga `visibility:hidden`. |
| C6 | P3 | `ResultView.tsx:75`, `HomeFiles.tsx:46` | "O'chirish" darhol `DELETE`. | **Sprint 1:** ikki bosqichli tasdiq. |
| C7 | P3 | `ResultView.tsx` | Worker `delivered` bo'yicha farq qaytaradi, lekin natija sahifasi chizmaydi. | **Sprint 4:** `delivered_json` ustuni + izoh satri. |
| C8 | P4 | `SlideViewer.tsx:87-108` | Global `keydown` — overlay ochiq bo'lsa ham slayd almashadi; taqdimotda emasda ham Space/Page*/Home/End ushlanadi; F5 sahifa yangilash o'rniga taqdimot ochadi. | **Sprint 1:** handlerni `present` va fokus bilan cheklash. |
| C9 | P4 | `SlideViewer.tsx:69-76` | `present=true` holida unmount bo'lsa fullscreendan chiqmaydi. | **Sprint 5:** effekt cleanup. |
| C10 | P4 | `SlideViewer.tsx:69` | `requestFullscreen(documentElement)` butun sahifani oladi -> presenter paneli proyektorda ham ko'rinadi. | **Kelajak:** Presentation API. Vaqtincha: panelni fullscreenda yashirish. |
| C11 | P4 | `ImageViewer.tsx:75`, `:96` | Lightbox klaviaturasiz (Esc/strelka yo'q); `downloadImage` anchor DOM ga qo'shilmaydi. | **Sprint 4:** lightbox keydown; anchor `document.body` ga. |
| C12 | P4 | `SlideViewer.tsx:221` | Yon panel thumbnail `scale(0.117)` qattiq. | **Sprint 5:** `ResizeObserver` bilan o'lchash. |
| C13 | P4 | `ResultView.tsx:237` `toLegacyShape` `values:{}` | `doc` yo'qolsa HTML zaxira yo'li metasiz. | **Sprint 2:** C1 holati buni qoplaydi. |
| C14 | P4 | `render-pptx.ts:78` vs `SlideCanvas` | `layer.uppercase` + `layer.lines` birga: viewer CSS, PPTX faqat `text`. Hozir birga ishlatilmaydi — latent. | **Sprint 5:** `lines` ga ham uppercase. |

### D. Pro darajaga yetishmovchilik (xato emas, kelajak)

- **D1** Hujjat ichida qidiruv, mundarijadan sakrash, sarlavha outline yo'q.
- **D2** `WordViewer` da klaviatura navigatsiyasiz.
- **D3** Chop etish joriy zoomda; 100% A4 print-mode yo'q.
- **D4** Presenter dual-screen yo'q (C10).
- **D5** Slayd thumbnail lari to'liq 1280x720 DOM — 16 slaydda og'ir.
- **D6** Mobil: min zoom 50% telefonda yon scroll qoldiradi; ikki toolbar.
- **D7** Tinos != Times New Roman — satr uzilishi fayldan 1-3 qator farq qiladi (kutilgan).

---

## 4. Ikki tahlil o'zaro — kelishuv va farq

| Mavzu | Ichki | Tashqi AI | Yakuniy |
|---|---|---|---|
| Yagona-manba slayd | pro | 8.5/10 | kelishildi — tegilmaydi |
| "Ko'rdim != oldim" hali ochiq | 5-6 vositada | 5 vositada + lentalar | A1-A9 |
| Titul yili `new Date()` | topilmadi | topdi | A6 — qo'shildi |
| Muddati o'tgan hujjat | topdi | topilmadi | C1 — qo'shildi |
| `overflow:hidden` kesish | yengil qayd | batafsil | B1 — kuchaytirildi |
| Zoom 80 / o'lik fit tugma | topilmadi | topdi | C2, C3 |
| Ctrl+F 2x | topilmadi | topdi | C5 |
| Presenter auditoriyaga ko'rinadi | topilmadi | topdi | C10 |
| ru/en lokalizatsiya | topdi | topdi (rezyume) | A4 — birlashdi |
| Ko'p tilli annotatsiya sahifalashi | topdi | topilmadi | A5 |

Ziddiyat yo'q — ikki ro'yxat bir-birini to'ldiradi.

---

## 5. Mahsulot qarori kutayotgan band (A1)

O'qituvchi 4 vositasi va glossariy ko'ruvchisi brend-muqova (rangli kartochka,
info-grid) chizadi; DOCX esa toza GOST/Word. `AUDIT-5` P1-5 titulni tenglashtirdi,
lekin ichki brend-muqova qoldi.

Ikki yo'l, egasi tanlaydi:

- **(a) Fayl = sayt:** DOCX ga ham rangli muqova / kartochka qo'shish. O'qituvchi
  "chiroyli" hujjat oladi, lekin GOST ko'rinishidan uzoqlashadi.
- **(b) Sayt = fayl:** ko'ruvchidan brend-muqovani olib tashlash, GOST sarlavha
  qoldirish. Sodda, izchil, lekin sayt "quruq" ko'rinadi.

Tavsiya: **(b)** — mahsulot va'dasi "topshirishga yaroqli hujjat", bezak emas.
Ammo bu 5 ko'ruvchini qayta dizayn qilishni talab qiladi — Sprint rejasidan
tashqarida, alohida qaror.

---

## 6. Boshqa tavsiyalar (kod emas)

- **`FILE_TTL_HOURS` 72 -> 168** (yoki `pro` uchun 720). 3 kun juda qisqa;
  foydalanuvchi dushanba yaratgan hujjatni payshanba topolmaydi. Box uch loyiha
  bilan bo'linadi — storage o'sishi kuzatilsin.
- Muddat tugashidan oldin eslatma — kartochkada "2 kun qoldi".

---

## 7. Sprint rejasi

| Sprint | Bandlar | Xatar |
|---|---|---|
| **1 — Aniq bir xillik** | A2, A3, A6, A7, C2, C3, C5, C6, C8 | Past — CSS/JSX, sof funksiya |
| **2 — Muddat** | C1, C13 | Past-o'rtacha |
| **3 — Lokalizatsiya + jadval + rezyume** | A4, A9, B3, C4 | O'rtacha |
| **4 — Halollik + mayda** | A5, B5, C7, C11 | O'rtacha — migratsiya |
| **5 — Kesilish + slayd** | B1, B2, C9, C12, C14 | Yuqori — sahifalash o'zgarishi, jonli smoke shart |
| **Kelajak** | A1 (qaror), A8, B4, C10, D1-D7 | — |

Verifikatsiya standarti (`AUDIT-5` dan): sof funksiya o'zgarsa — before-snapshot +
mutatsiya-test; jonli DOCX/PPTX render qilib ko'z bilan ko'rish (Sprint 5 shart).

---

## 8. Bajarilish yozuvi

### Sprint 1 — Aniq bir xillik (2026-09-06)

Baza: 265 test. Yakun: **269 test**, typecheck + lint toza. Har yangi tasdiq
mutatsiya bilan tekshirildi (A6/A7/A2 — kod buzilganda test yiqiladi).

| Band | Nima qilindi | Fayllar |
|---|---|---|
| **A6** | `DocMeta.year` qo'shildi, `extractMeta` da muzlatiladi; `title-model` `meta.year ?? new Date()`; `from-html` va `ResultView.toLegacyShape` eski `doc_json` uchun `createdAt` dan orqaga to'ldiradi | `types.ts`, `meta.ts`, `title-model.ts`, `from-html.ts`, `ResultView.tsx` |
| **A7** | `cleanUniversity()` `title-model` da — "Oliy ta'lim muassasasi" -> ""; `TitlePage` va `render-docx` faqat chizadi | `title-model.ts`, `render-docx.ts`, `TitlePage.tsx` |
| **A3** | "TARJIMA" / "Badiiy-ilmiy insho" / maqola "org . email" lentalari `WordViewer` dan olindi; endi o'lik `variant` va `ribbon` proplari ham | `WordViewer.tsx`, `TitlePage.tsx`, `ArtifactViewer.tsx` |
| **A2** | `writeKeysWithLlm` `toc: true` -> `false` (glossary bilan bir xil, `KeysViewer` bilan tenglashdi) | `write-specials.ts` |
| **C2** | `TableViewer` default zoom `80` -> `75` (`ZOOM_STEPS` ichida) | `TableViewer.tsx` |
| **C3** | `onFit` 5 maxsus ko'ruvchiga uzatildi — zoom foizi tugmasi endi "default zoomga qayt" (to'liq fit-to-width — Sprint 3) | `Glossary/Keys/Lesson/Table/ResumeViewer.tsx` |
| **C5** | O'lchov node lariga `visibility:hidden` (`invisible`) — layout qoladi, Ctrl+F o'tkazib yuboradi | `WordViewer.tsx`, `measure.tsx` |
| **C6** | Ikki bosqichli o'chirish (`useConfirmClick` hook + ro'yxatda `confirmId`) | `useConfirmClick.ts` (yangi), `ResultView.tsx`, `HomeFiles.tsx` |
| **C8** | `SlideViewer` global `keydown`: editable/modal fokusda o'tkazib yuboradi; taqdimotda emas paytda faqat left/right/f (Space, Page*, Home/End, F5, P — faqat taqdimotda) | `SlideViewer.tsx` |
| — | (yon topilma) `document.test.mts` da `/s` regex bayrog'i `tsconfig target: ES2017` da xato berardi — `[^]` ga almashtirildi. `npm run check` endi yashil. | `tests/document.test.mts` |

Sprint 1 da o'zgarmagani: A1 (mahsulot qarori), A5/A8/A9, B*, C1 (Sprint 2), C4/C7/C9-C14, D*.

### Sprint 2 — Muddat (2026-09-06)

269 test (o'zgarmadi — o'zgarish sof UI holati), typecheck + lint toza, prod
build o'tadi.

| Band | Nima qilindi | Fayllar |
|---|---|---|
| **C1** | `ResultView`: `completed && !hasFile` -> alohida "Hujjat muddati tugagan" kartasi + "Qaytadan yaratish" (`/uz/{slug}`) havolasi; yuklab olish / PDF tugmalari yashiriladi. Nav subtitleda: `expired` -> "Muddati tugagan"; 24 soatdan kam qolganda "N soatdan keyin o'chadi". `HomeFiles`: kartochkada "Muddati tugagan" yozuvi + preview `opacity-50`. | `ResultView.tsx`, `HomeFiles.tsx` |
| **C13** | Alohida tuzatish shart emas — `expired` holatida ko'ruvchi umuman render qilinmaydi, ya'ni `academicDocFromHtml`/`toLegacyShape` zaxira yo'liga tushilmaydi. Non-expired'da `gen.doc` har doim bor (`BuiltFile.doc` majburiy). | — |

Tavsiya (§6) — `FILE_TTL_HOURS` 72->168 — bu **kod emas**, egasi hal qiladi
(`.env`, storage byudjeti). Sprintda bajarilmadi.

Sprint 2 da o'zgarmagani: A1, A4, A5, A8, A9, B*, C4, C7, C9-C12, C14, D*.

### Sprint 3 — Lokalizatsiya + jadval + varaq raqami (2026-09-06)

272 test (271 -> +1 A9; A4 uchun 2 test Sprint 1 blokida hisoblangan),
typecheck + lint toza, prod build o'tadi (A4 render-docx mutatsiya bilan
tekshirildi).

| Band | Nima qilindi | Fayllar |
|---|---|---|
| **A4** | `SectionLabels` ga 10 ta ko'ruvchi yorlig'i qo'shildi (uz/ru/en). `GlossaryViewer`, `KeysViewer`, `LessonViewer`, `TableViewer`, `ResumeViewer` muqova/yorliqlari endi `sectionLabels(doc.meta.language)` dan. `LessonViewer` `Til:` endi `languageName(code)` (xom kod emas). `render-docx` `resumeBody` ham lokalizatsiya qilindi -> ru/en rezyume ekran = fayl. `flow.ts` "(davomi)" ham. | `i18n.ts`, `Glossary/Keys/Lesson/Table/ResumeViewer.tsx`, `render-docx.ts`, `flow.ts` |
| **A9** | `lib/generation/table-columns.ts` (yangi) — `columnPercents(headers)` DOCX va ko'ruvchi uchun yagona manba. `TableViewer` + `LessonViewer` jadvallariga `<colgroup>` + `table-layout: fixed` (o'lchov ham, ko'rinish ham). `.word-table td` ga `overflow-wrap: break-word`. | `table-columns.ts`, `render-docx.ts`, `TableViewer.tsx`, `LessonViewer.tsx`, `globals.css` |
| **C4** | `components/viewers/useVisiblePage.ts` (yangi) — scroll paytida ko'rinib turgan varaqni kuzatuvchi umumiy `IntersectionObserver` hook. `WordViewer` migratsiya qilindi (o'z observeri o'chirildi), `Glossary/Keys/Lesson/TableViewer` ga qo'shildi (`Workspace` ga `ref`). Endi sichqoncha bilan varaqlanganda ham "3 / 8" yangilanadi. | `useVisiblePage.ts`, `WordViewer.tsx`, `Glossary/Keys/Lesson/TableViewer.tsx` |
| **B3** | **Kechiktirildi** -> Sprint 5. Rezyume 1-sahifa qirqilishi — bu render o'zgarishi, boshqa sahifalash ishlari (B1, B2) bilan birga jonli smoke bilan qilinishi kerak. | — |

Sprint 3 da o'zgarmagani: A1, A5, A8, B1, B2, B3 (ko'chirildi), B4, B5, C7, C9-C12, C14, D*.

### Sprint 4-5

_(kelgusi — B3, B5, A5, C7, C11 + pagination bundle)_
