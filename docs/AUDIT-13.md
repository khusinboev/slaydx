# AUDIT-13 — Shablonlar 2: 10 alohida dizayn, haqiqiy preview galereyasi, «O'z shablonim» (Pro)

Sana: 2026-09-10. `AUDIT-12` dan keyin. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar

| № | Talab | Qaror | Holat |
|---|---|---|---|
| T-1 | Shablon tanlashda taqdimot qanday bo'lishini aniq ko'rish; shablonlar bir-biridan keskin farq qilsin (dumaloq rasm, chap/o'ng rasm…); 1-varaq shablon yuzasida | 14 → **10 shablon, 10 alohida dizayn** (`lib/generation/visuals/`), galereya `SlideCanvas` bilan haqiqiy titul + 3 eskiz, rang swatchlari galereya ostida (shablon → o'z palitrasi, keyin swatch) | ✅ Sprint A |
| T-2 | «O'z shablonim» (Pro): PPTX namuna yuklab, shu shablonda chiqarish; ko'proq vaqt ogohlantirishi | **Haqiqiy shablon** — namuna master/layout/temasi saqlanadi, slaydlar OOXML placeholder'larga yoziladi; ko'ruvchi rasterlangan layout fonlari ustida chizadi; ustamasiz, PPTX ≤ 20 MB | ✅ Sprint B |

## 2. Arxitektura

### Sprint A — dizaynlar va galereya

- `VisualSpec` (`visuals/spec.ts`): `base` (eski oila), `photo[layout]`, `fullBleed`, `plan[layout]`. `slide-layout.ts` `dispatch`/`photoSlot` avval dizaynni, keyin `base` ni chaqiradi. Eski 7 oila (`classic…dense`) kodda qoladi — eski `doc_json` va testlar uchun.
- Qatlam kengaytmalari: `image.shape: "circle"` (PPTX `rounding`, ko'ruvchi `border-radius: 50%`), `rect.shadow` (PPTX `shadow`, `box-shadow`) — paritet testi.
- Reyestr: `story` = literature + bio + magazine, `pitch` += problem, `timeline` += process; aliaslar `LEGACY_TEMPLATE_ALIASES`; `defaultTheme` har shablonda.
- Namuna dekalar `slide-samples.ts` (9 slayd, o'zbekcha, `public/samples/` Pexels fotolari) — galereya va `npm run shots` (PPTX → PDF → PNG) BITTA manbadan.
- Dizayn imzolari (har biri `visuals/<id>.ts`, ikki opus agent parallel, worktree):

| Shablon | Dizayn | Imzo |
|---|---|---|
| Ma'ruza | academic | och sahifa, tepada aksent chiziq, o'ngda yumshoq kartadagi foto; bo'lim — 110 pt raqam + vertikal chiziq; bandlar aksent chiziqli kartada |
| Dars / trening | circle | dumaloq foto (halqa bilan), aksent disklar, dumaloq raqamli kartalar 2 ustun, bo'lim — katta disk |
| Tajriba | notebook | 0.5″ katak daftar foni, polaroid ramkali foto + «skotch», bo'lim — daftar yorlig'i, bandlar — o'lchov shkalasi bo'ylab kuzatuv qatorlari, iqtibos — yopishqoq qog'oz |
| Himoya | formal | Georgia serif, to'q titul + ikki qator ramka, bo'lim — to'q tasma, reja — mundarija (raqamlar o'ngda), fotosiz |
| Foto-hikoya | story | to'la ekran foto + ikki qatlam qora parda, bo'limda 5.2″ to'q chap panel, bandlar — chapda to'la balandlik foto ustuni + serif paragraflar |
| Qiyos | split | har slayd x=6.55 da ikkiga bo'lingan (to'q/och), aksent choki, agenda — zigzag chiplar, qiyos — «VS» belgisi |
| Pitch | bold | kartasiz plakat tipografiyasi: chapda 45 % foto, bandlar — katta `01` raqamli qatorlar, stats — 66 pt raqamlar, bo'lim — to'q sahifa + aksent tasma |
| Hisobot | dashboard | tepada ingichka aksent, hamma narsa soyali plitkalarda (grid), KPI plitkalari, iqtibos keng plitkada |
| Vaqt chizig'i | rail | butun deka bo'ylab bitta rels: titulda gorizontal rels + dumaloq foto, bandlar — vertikal rels tugunlari, bosqichlar — raqamli tugunlar kartalar ustida |
| Keys | editorial | o'ngda to'la balandlik foto ustuni (aksent ramka ichida), chapda ulkan bezak raqam, bandlar — ikki ustun paragraf (bullet belgisiz), Georgia pull-quote |

### Sprint B — «O'z shablonim»

- **Yuklash** (`lib/server/template-upload.ts`, `POST /api/uploads/template`, `maxDuration 120`): 20 MB, zip imzosi + `ppt/presentation.xml` sniff, `parsePptxTemplate` (o'lcham, tema ranglari/shriftlari, layout placeholder'lari EMU→dyuym, rollar cover/section/content/two/picture/blank), 422 `no-content`/`no-layouts`/`not-pptx`. Rasterlash yuklashda: bo'sh layout varag'i (`renderLayoutSheet`) → LibreOffice PDF → `pdftoppm` 72 dpi PNG + `-gray` bilan qorong'ilik → `template_uploads.previews` (016). `pdftoppm` bo'lmasa `{}` — ko'ruvchi tema ranglari bilan chizadi, yuklash yiqilmaydi. Dockerfile runner: `poppler-utils`.
- **Render** (`render-pptx-template.ts`): namuna zip'idan `ppt/slides/*`, `notesSlides/*`, ularning rels/content-type/`sldIdLst` yozuvlari o'chiriladi; har `SlideModel` uchun `slideN.xml` faqat `<p:sp>` placeholder'lar (`type`/`idx` layoutdagi bilan aynan) — shrift, rang, o'lcham, joylashuv layoutdan meros, `<a:normAutofit/>` sig'masa kichraytiradi; jadval `<a:tbl>`; notes (namunada `notesMaster` bo'lsa); rasm FAQAT `pic` placeholder bo'lsa. Rol/mazmun xaritasi (`template-content.ts`: `roleFor`, `contentOf`) PPTX yozuvchisi va ko'ruvchi bilan bitta.
- **Ko'ruvchi** (`slide-custom.ts` `planCustom`): fon — rol layoutining PNG si (to'la ekran `image` qatlami), matn — placeholder qutilarida (4:3 → 16:9 masshtab), sarlavha `major`, tana `minor` shriftda, siyoh `dark ? lt1 : dk1`; `src`/`srcLines` bilan tahrir ishlaydi; tasma/logotip yo'q. `planSlide(..., {custom})` shu yo'lga o'tadi, `applyFontOverrides` qoladi.
- **Oqim**: reyestr `templateAssetId` (faqat pro, impact `layout`, zondda stub profil) → `extractMeta` → worker `templateForJob` → `buildArtifact({template})` → `slideDoc.customTemplate` + `renderPptxWithTemplate` → `extractAssets` fon PNG larini aktivga chiqaradi → ko'ruvchi `deck.custom`. Tahrirdan keyin `rebuildFile` namuna baytini bazadan olib shu yozuvchi bilan qayta yasaydi (namuna o'chirilgan bo'lsa — ichki renderer).
- **UI** (`CustomTemplateCard.tsx`): galereyaning oxirgi kartasi (Pro · ustamasiz): PPTX tanlash → «Tahlil qilinmoqda… (20–40 s)» → namunada chizilgan HAQIQIY titul + 3 eskiz (`SlideCanvas custom`), nom, «Boshqa fayl»/«Olib tashlash», oldingi namunalar chiplari (`GET`), ogohlantirish «Namuna asosida yaratish ko'proq vaqt oladi (≈1–2 daqiqa qo'shimcha)». Ichki shablon bosilsa `templateAssetId` tozalanadi; rang qatori «Namunaning o'z ranglari» ga aylanadi.

## 3. Sinov

- `tests/slide-visuals.test.mts`: har shablon × 14 maket × 3 tema × qisqa/uzun × rasmli/rasmsiz — chegara, shrift poli; `src` qoidasi; `photoSlot`; dizayn noyobligi; **har dizayn 6 majburiy maketni o'zi chizadi** va **juftlik farqi** (45 juft × 6 maket) — `todo` olib tashlandi.
- `tests/pptx-template.test.mts` (pptxgenjs fikstura), `tests/render-pptx-template.test.mts` (JSZip bilan qayta o'qish: 9 slayd, placeholder, `normAutofit`, `sz` yo'q, rels/sldIdLst/content-types, rId takrorlanmaydi, notes, rasm yo'q; **LibreOffice** PDF sahifa soni = 9), `tests/template-upload.test.mts` (413/400/415/422, `looksLikePptx`, `pgmIsDark`, **haqiqiy rasterlash**: muqova qorong'i, mazmun och; `extractAssets` fonlari), `tests/slide-custom.test.mts` (fon PNG, qutilar, siyoh, pic qoidasi, ikki ustun, 4:3 masshtab, har maket chegarada, `planSlide(custom)` — logo yo'q, shrift ustidan yozish), `tests/slide-params.test.mts` (`templateAssetId` → `layout` farqi), `tests/ui/template-gallery.test.mts` (+3: oddiy slaydda karta yo'q; yuklash → tanlangan, fon PNG + `data-src`, rang qatori; docx serverga bormaydi, ro'yxatdan tanlash/o'chirish).
- Natijalar: unit 838/846 (8 skip — env), viewer 58/58, UI 79/79; `tsc`, `eslint` toza.
- Ko'z bilan: `npm run shots` — 10 × 9 PNG (standart palitralar + chalk/ink/graphite agentlar tomonidan); topilgan va tuzatilgan: `dense` stats raqami `accent` → `titleMuted` (legal palitrada zumrad ustida zumrad ko'rinmas edi), agentlarning o'z ro'yxati (rail titul chizig'i, dashboard plitka balandligi/manfiy quti, bold bo'lim tasmasi, editorial qator bo'shlig'i, iqtibos bloklari o'lchangan balandlikda…).
- Chromium smoke (`scratchpad/pw/custom.mjs`, admin sessiyasi): namuna yuklash + rasterlash 2.2 s (lokal), karta tanlandi, preview fon PNG + `data-src` titul, «Namunaning o'z ranglari», ichki shablon → bekor, qayta bosish → tanlandi. **Ushlangan nuqson**: tanlanmagan holatda karta o'rtasi yuklash zonasi edi — bosish fayl oynasini ochib, qayta tanlanmasdi (jsdom ko'rmaydi) → preview xira qoladi, zona faqat namuna yo'q bo'lganda.
- Jonli (`npm run live -- pro-slide --template <fayl>`): §4 ga qarang.

### Qo'shimcha (foydalanuvchi so'rovi, deploydan keyin)

Standart tanlov — «Avtomatik», lekin unda shablon preview'i ko'rsatilmaydi (bezakli plitka: palitra gradienti + kartalar yelpig'ichi, «mavzuga qarab dizayn va rang tanlanadi»). Formada faqat bitta plitka (joriy tanlov: auto bezak / tanlangan shablonning haqiqiy tituli / namunada chizilgan titul); bosilsa qalqib chiquvchi oyna (`useDialog`: Esc, fokus tsikli) — barcha shablonlar + pro'da «O'z shablonim»; karta bosilishi bilan tanlov qo'llanib oyna yopiladi. Rang swatchlari plitka ostida qoladi (oynasiz). Ikkala forma. Namuna holati (`customTpl`, ro'yxat) oyna tashqarisida — yopilganda yo'qolmaydi. UI 80/80, Chromium smoke (slide + pro: oyna 11/12 karta, tanlash → yopiladi, rang → plitka, namuna yuklash → plitka, Esc).

## 4. Bajarilish yozuvi

- A1–A2 yadro `11d589f`, A3 galereya `8ba9ed0`, dizaynlar `5d4abf0` (academic/circle/notebook/formal/story) va `223d323` (split/bold/dashboard/rail/editorial), merge + juftlik testi + stats rangi `8d1d26c`.
- B1 tahlilchi `eed2b74`, B2 OOXML yozuvchisi `7c97616`, B1 yuklash/rasterlash/016/Dockerfile `dc4057f`, B2–B3 ulanish + `planCustom` `9d5f3be`, B4 karta `4cb9b97` + `0129dd8`.
- Ochiq: (1) rasm faqat `pic` placeholder'li layoutda — namunada bunday layout bo'lmasa deka rasmsiz (ataylab: matn ustiga tushmasin); (2) `stats`/`process`/`references`/`quiz` namunada oddiy qatorlar (`value — label`), ko'ruvchida tahrirlanmaydi (`src` yo'q); (3) `normAutofit` ni LibreOffice/PowerPoint o'zi qo'llaydi — ko'ruvchi `fitSize` bilan yaqinlashadi, aynan bir xil emas; (4) agent B eslatmasi: `split` `orbit`/`chalk` da tonal bo'linish; ba'zi dizaynlar bir qancha maketlarda `photoSlot=null` — rasm so'rovi ham kamayadi.
