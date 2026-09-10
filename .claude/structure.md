# SlaydX — Direktoriya xaritasi

Loyiha strukturasi: **poydevor** (umumiy qatlam) → **1-to'lqin** (jonli generatsiya) → **2-to'lqin** (tahrirlash UI) → **integratsiya**.

## Poydevor

| Jild | Nima |
|---|---|
| `lib/generation/` | Dvigatel: LLM, maketlar, render (DOCX/PPTX/PNG) |
| `lib/server/` | Server: auth, kredit, navbat, fayl, baza |
| `lib/` | Shareh: tiplar, utils, API klienti |
| `app/api/` | Route handlerlar: yo'llar va permissioner |
| `components/` | React komponentlar: UI, ko'ruvchilar |
| `tests/` | Testlar: birlik + ko'ruvchi (SSR) |

## Yangi fayllar (1-2 to'lqin)

### Jonli generatsiya — Tiplar va progressi

- **`lib/generation/slide-progress.ts`** (yangi)
  - `SlideProgressEvent` — dvigatelning chiqarishi (plan/stage/slide/image/done)
  - `LiveDeck` — qo'rtilgan holat, web ga `live_json` shaklida
  - `applyLiveEvent(state, event)` — hodisani qabul qilish
  - `liveProgress()` — ikkiti raqami (0–1 oraliq)
  - `liveStep()` — «Matn · 7/12 slayd» tugasa-tugasa matni

- **`lib/generation/slide-limits.ts`** (yangi)
  - `SLIDE_LIMITS` — har maydon uchun belgilangan chegara (title 80, subtitle 140…)
  - `clipTo(text, maxChars)` — harmoniya bilan qisqartirish
  - `UNDO_DEPTH=100`, `REBUILD_DEBOUNCE_MS=3000`

- **`lib/generation/slide-edit.ts`** (yangi, izomorf)
  - `DocOp` — tahrir operatsiyasi (text/layout/delete/reorder…)
  - `applyDocOps(doc, ops, ctx)` — operatsiyalar ro'yxatini qo'llash
  - `readSlideField() / writeSlideField()` — maydonni o'qish/yozish
  - `canConvert() / convertLayout()` — maket o'girrish qoidalari
  - `inverseOps()` — Ctrl+Z uchun teskarisi
  - `parseDocOps()` — PATCH tanasini tipni tekshirib tahlil qilish

### Server — Navbat, kreditlar, fayllar

- **`lib/server/migrations/013_live_edit.sql`** (yangi)
  - `live_json JSONB` — jonli dekani saqlay
  - `live_seq INT` — tahrirlash va polling uchun versiya
  - `doc_version INT` — hujjat tahriri, eng oxirgi yozuv
  - `file_version INT` — PPTX yasash
  - `image_redraws INT` — rasm qayta chizish saylagichi
  - `edited_at TIMESTAMPTZ` — oxirgi tahrirlash vaqti

- **`lib/server/live.ts`** (yangi)
  - `LiveReporter` — hodisalarni yig'adi, debounce qiladi, asset yuklaydi
  - `setLive()` — `live_json` → Postgres
  - `getGeneration(id, userId, {since})` — Live dekani qaytarish

- **`lib/server/slide-commit.ts`** (yangi)
  - `loadDocForEdit()` — dekani load qilish, maket normallashtirish
  - `commitDocOps()` — `applyDocOps` + SQL ubaytishlar
  - `rebuildFile()` — `renderPptx()` qulflash bilan

- **`lib/server/slide-image.ts`** (yangi)
  - `uploadSlideImage()` — multipart fayl upload, asset simpletoring

- **`lib/server/preview.ts`** (yangi)
  - `buildPreview()` — deka XML/HTML ko'rish (worker dan ko'chdi)

- **`lib/server/jobs.ts`** (o'zgaradi)
  - `setLive(id, workerId, live)` — jonli dekani yozish
  - `updateGenerationDoc()` — doc_version ubaytish
  - `markFileVersion()` — file_version ubaytish

- **`lib/server/assets.ts`** (o'zgaradi)
  - `assetImageResolver()` — renderPptx uchun aktiv resolver
  - `putAssetBytes()` — asset saqlash (SHA-256)
  - `getAsset()` — aktiv aktiv olish (egalik tekshiruvi)

### Ko'ruvchi — Tahrirlash UI

- **`lib/generation/slide-types.ts`** (o'zgaradi)
  - `SlideSrc` — matn manba ko'rsatkichi (maydon + indeks)

- **`lib/generation/slide-layout.ts`** (o'zgaradi)
  - `src?: SlideSrc` — har qatlam uchun manba
  - `srcLines?: SlideSrc[]` — bandlar uchun manbalar
  - `planSlide()` — `src` atributi qo'shib chizadi

- **`lib/generation/slide-fonts.ts`** (Muharrir 2)
  - `SLIDE_FONTS` — 8 xavfsiz shrift oilasi (`id`/`face`/`css`/`em`), PPTX `fontFace` va ko'ruvchi `font-family` bitta ro'yxatdan
  - `isSlideFontId()`, `fontCss(face)`, `FONT_BY_ID`

- **`lib/generation/slide-edit.ts`** (Muharrir 2)
  - `style` op: `size?` va/yoki `font?` (`SlideModel.fontSize` / `SlideModel.font`)
  - `list` op — ro'yxat butunicha (PowerPoint qutisi), `listCap()` chegarasi
  - `imageRestore` op — `SlideModel.imageOrig` (asl AI rasm) ni qaytaradi; `image` op aslini `imageOrig` ga ko'chiradi

- **`components/viewers/SlideEditor.tsx`** (Muharrir 2 — WYSIWYG)
  - Sahna bilan bir masshtabli egizak konteyner, `contentEditable` maydon `textLayerStyle` bilan (oq textarea yo'q)
  - Ro'yxat `<ul>` butunicha (Enter → yangi band), bitta matn `<div>`; Esc/Enter/blur/tashqariga bosish
  - Shrift paneli: oila `<select>` + o'lcham; rasm: «O‘z rasmim», «Rasmsiz», «Rasmni qaytarish»
  - `onEditing(key)` → `SlideStage.hideSrc` → `SlideCanvas` asl qatlamni yashiradi

- **`components/files/EditActions.tsx`** (Muharrir 2)
  - Sahifa sarlavhasida `[Asliga qaytarish (2 bosish)] [Saqlash · N] [Saqlandi ✓]` — `SlideViewer.onEditState` dan
  - `useSlideEdit.discard()` — saqlanmagan navbatni tashlaydi (tarmoqsiz)

- **`components/viewers/SlideViewer.tsx`** (o'zgaradi)
  - `SlideViewer({ doc, live?, overlay?, gen?, onGen?, onEditState? })`
  - `live` qiymatida jonli ko'rish, `gen` bilan tahrir
  - Asboblar paneli minimal (Muharrir 2): sahifa/zoom/to'liq ekran + slayd «O‘chirish»; eslatma paneli yo'q (taqdimotchi rejimida qoladi)

- **`components/viewers/SlideRail.tsx`** (yangi)
  - Slaydlarning mini ko'rish
  - DnD yordamida o'girrish

- **`components/viewers/SlideStage.tsx`** (yangi)
  - Asosiy tasvir + overlay sloti

- **`components/viewers/SlideCanvas.tsx`** (o'zgaradi)
  - `data-src` atributi — matn manba
  - `reveal?: number` — jonli kitob effekti
  - `textLayerStyle(layer)` — matn qatlami CSS i (muharrir bilan bitta), `hideSrc?` — tahrirlanayotgan qatlamni yashirish

- **`components/viewers/SkeletonSlide.tsx`** (yangi)
  - Shimmer — deka yaratilayotgani kulamkesi

- **`components/viewers/LiveStrip.tsx`** (yangi)
  - Bosqichli progress: «Tadqiqot · Matn · Rasmlar» sotasi
  - Haqiqiy foiz

- **`components/viewers/ImageWaitPlaque.tsx`** (yangi)
  - «Rasm izlanmoqda…» — slaydning rasm katakida

- **`components/viewers/useReveal.ts`** (yangi)
  - Matn animatsiyasi (typing effekt), rAF, 0.8–2.5 s

- **`components/viewers/useSlideKeys.ts`** (yangi)
  - Sarlavha navigatsiyasi (← / → / Esc)

### Formalar — slayd (Formalar 2, 2026-09-10)

- **`components/forms/SlideComposer.tsx`** — ikkala slayd formasining kompozitori: 4 karta (Mavzu · Slaydlar soni · Muallif · Ko'rinish) + `<details>` «Sozlamalar» (yopiq holda `settingsSummary` chiplari); «Yaratish»dan keyin `profilePatchFrom` → `PATCH /api/users/me`
- **`components/forms/compact.tsx`** — `Card`, `Row` (yorliq | boshqaruv, izoh tooltip), `Segmented`, `SelectField`, `Switch`, `MiniInput`, `SummaryChips`
- **`components/forms/slide-fields.tsx`** — reyestr id → bitta qator (`renderSlideParam(id, values, set, {tool})`), `settingsSummary`
- **`components/forms/slide-pickers.tsx`** — `ColorPicker` (faqat doiralar); shablon tanlagich endi `TemplateGallery.tsx` da (Shablonlar 2)
- **`components/forms/SlideForm.tsx` / `ProSlideForm.tsx`** — yupqa o'ram; eksport ro'yxatlari reyestr bilan `tests/viewer/slide-form.test.mts` da solishtiriladi
- **`lib/profile-sync.ts`** — `profilePatchFrom(values, profile)`: faqat o'zgargan muallif maydonlari (bo'sh ham)
- **`lib/generation/slide-params.ts`** — `SLIDE_MIN/MAX/DEFAULT`, `slidePrice(n)` = 3 000 + max(0, n−20)·500; `slideCount` ikkala vositada, `quality` yo'q, `slideImageStyle` faqat pro
- **`lib/generation/image-provider.ts`** `pickProvider`: `slide` → `stock` zanjiri (Pexels → Pixabay, fal YO'Q), `pro-slide` → gemini, meta'siz → eski zanjir
- **`lib/server/migrations/015_profile_position.sql`** — `users.position`, `users.organization`

### Shablonlar 2 (AUDIT-13, 2026-09-10) — 10 dizayn, galereya, «O'z shablonim»

- **`lib/generation/visuals/`** — `spec.ts` (`VisualSpec`: `base`, `photo`, `fullBleed`, `plan[layout]`), `index.ts` (`VISUALS`, `designOf`), 10 dizayn `academic/circle/notebook/formal/story/split/bold/dashboard/rail/editorial.ts`, `README.md` (dizayner brifi). `slide-layout.ts` `dispatch`/`photoSlot` avval dizaynni, keyin `base` oilasini chaqiradi; `LAYOUT_KIT` — dizaynlar uchun umumiy asboblar (faqat funksiya ichida ishlatiladi)
- **`lib/generation/slide-templates.ts`** — 10 shablon (`auto` + lecture/lesson/science/defense/story/compare/pitch/report/timeline/case), `LEGACY_TEMPLATE_ALIASES`, `defaultTheme`
- **`lib/generation/slide-samples.ts`** — `sampleDeck(id)` 9 o'zbekcha slayd (`public/samples/tpl-*.jpg`), `GALLERY_SLIDES`; galereya va `npm run shots` bitta manbadan
- **`components/forms/TemplateGallery.tsx`** — haqiqiy titul + 3 eskiz (`SlideCanvas`), rang swatchlari galereya ostida (shablon → `defaultTheme`); `Thumb.tsx` — 1280×720 → karta masshtabi
- **`components/forms/CustomTemplateCard.tsx`** — «O'z shablonim» (faqat pro): PPTX yuklash, «Tahlil qilinmoqda…», namunada chizilgan preview, oldingi namunalar, `templateAssetId`
- **`lib/generation/pptx-template.ts`** — `parsePptxTemplate` (o'lcham, tema ranglari/shriftlari, layout placeholder'lari, rollar), `CustomTemplate` (hujjatdagi yengil nusxa), `TemplateError`
- **`lib/generation/template-content.ts`** — `roleFor`, `contentOf` — `SlideModel` → namuna roli va matn bloklari (PPTX yozuvchisi va ko'ruvchi planeri BITTA xaritadan)
- **`lib/generation/render-pptx-template.ts`** — deka namuna PPTX ichiga: eski slaydlar o'chadi, master/layout/tema qoladi, `slideN.xml` faqat placeholder'lar (`normAutofit`), jadval `<a:tbl>`, notes, rasm faqat `pic` placeholder'da; `renderLayoutSheet` — bo'sh layout varag'i (rasterlash uchun)
- **`lib/generation/slide-custom.ts`** — `planCustom`: ko'ruvchi uchun fon = layout PNG, matn placeholder qutilarida, namuna shrifti/rangi; `planSlide(..., {custom})` shu yo'lga o'tadi (tasma/logo yo'q)
- **`lib/server/template-upload.ts`** — `uploadTemplate` (20 MB, zip sniff, 422 kodlari), `rasterizeTemplate` (LibreOffice → `pdftoppm` PNG + `-gray` qorong'ilik), `putTemplate/getTemplate/listTemplates/deleteTemplate/templateForJob`; jadval `template_uploads` (`016_template_uploads.sql`)
- **`app/api/uploads/template/route.ts`** (`POST` yuklash, `GET` ro'yxat, `maxDuration 120`), **`[assetId]/route.ts`** (`DELETE`)
- Oqim: worker `templateForJob` → `buildArtifact({template})` → `slideDoc.customTemplate` + `renderPptxWithTemplate`; `extractAssets` fon PNG larini aktivga chiqaradi; `rebuildFile` (tahrirdan keyin) namuna baytini bazadan olib shu yozuvchi bilan qayta yasaydi
- Dockerfile runner: `poppler-utils` (`pdftoppm`); `scripts/live-engine.mts --template <fayl.pptx>`
- Testlar: `tests/slide-visuals`, `pptx-template`, `render-pptx-template` (LibreOffice sahifa soni), `template-upload` (haqiqiy rasterlash), `slide-custom`, `ui/template-gallery` (custom karta), `slide-params` (`templateAssetId` zondi)

### Tarjimon 2 (AUDIT-14, 2026-09-10) — tuzilmani saqlab tarjima

- **`lib/generation/translate/`** — `segments.ts` (Segment/token modeli, `isTranslatable`, dublikat, `splitOversize`), `xml-scan.ts`, `docx.ts`/`pptx.ts`/`xlsx.ts`/`plain.ts`/`pdf.ts` (extract/apply adapterlari — matn tugunlari almashtiriladi, `rPr/pPr/tbl/drawing` tegilmaydi), `index.ts` (`extractSegments`, `applySegments`, `textToSegments`, `OUTPUT_MIME`, `outputFileName`, `pdfBlocksToDoc`), `engine.ts` (glossariy + til aniqlash 1-o'tish, partiyalar `mapPool(4)`, tekshiruv id/token/verbatim, retry, 3% qisman qoidasi → `delivered`, `buildTranslationArtifact`), `prompts.ts` (inglizcha ko'rsatma + `languageDirective`), `report.ts` (`TranslationReport` — `AcademicDoc.translation`), `glossary.ts` (`parseUserGlossary`, klient ham ishlatadi)
- **`lib/generation/source-types.ts`** — `SourceKind`, `TranslationSource`, `SourceUploadResult`; **`lib/server/source-upload.ts`** — `uploadSource` (20 MB, sniff, `chars` = tarjima qilinadigan segmentlar, skanlangan PDF 422), `sourceForJob`, `sourceCharsForRequest`, `purgeOldSources(30)`; jadval `source_uploads` (`017_source_uploads.sql`)
- **`app/api/uploads/source/route.ts`** (`POST`), **`[assetId]/route.ts`** (`DELETE`); `app/api/generations/route.ts` — `sourceAssetId` → bazadan ISHONCHLI `sourceChars`
- **`lib/tools.ts`** — `TRANSLATION_MAX_CHARS 200 000`, `translationChars/translationPrice` (≤10k → 3 000, +1 000 / 5k), `TRANSLATION_STYLES`, `TRANSLATION_LANGUAGES` (18, ikkala yo'nalish); `lib/generation/budget.ts` — `60 s + 2.5 s / 1k belgi`
- **`components/forms/TranslationForm.tsx`** — Manba (Matn/Fayl, sudrab tashlash, narx) · Tillar (⇄) · ▸ Sozlamalar (uslub, o'z lug'ati); **`components/viewers/TranslationViewer.tsx`** — chiplar, ogohlantirishlar, «Taqqoslash» (2 ustun) | «Fayl» (`?format=pdf` iframe)
- Worker: `sourceForJob` → `buildArtifact({source, onStage})`, `onStage` → `setProgress` (soxta egri chiziq to'xtaydi)
- Testlar: `tests/translate-{docx,pptx,xlsx,plain,pdf,engine}.test.mts`, `source-upload`, `pricing`, `ui/translation-form`, `viewer/translation-viewer`; `npm run live -- translation-text` / `translation-file --source <fayl>`

### API klienti

- **`lib/api-edit.ts`** (yangi)
  - `patchGenerationDoc()` — PATCH /api/generations/{id}/doc
  - `rebuildGeneration()` — POST .../rebuild
  - `uploadSlideImage()` — POST .../slides/{i}/image

- **`lib/api-client.ts`** (o'zgaradi)
  - `mergeLive()` — yangi `live` olamni qadimgi bilan birlashtrish
  - `nextPollDelay()` — live bo'lsa 1.2 s
  - `pollGeneration()` → `?since=liveSeq`

### Route handlerlar

- **`app/api/generations/[id]/route.ts`** (o'zgaradi)
  - `GET ?since=` → `liveSeq` qo'shish

- **`app/api/generations/[id]/doc/route.ts`** (yangi)
  - `PATCH` — `commitDocOps()` bilan
  - Versiya tekshiruvi (409 conflict)

- **`app/api/generations/[id]/rebuild/route.ts`** (yangi)
  - `POST` — `rebuildFile()` qulflash bilan

- **`app/api/generations/[id]/slides/[index]/image/route.ts`** (yangi)
  - `POST` — `uploadSlideImage()`

### Testlar

- **`tests/slide-edit.test.mts`** — `applyDocOps` muhim qoidalari (+ `list`, `imageRestore`, `imageOrig`)
- **`tests/slide-fonts.test.mts`**, **`tests/slide-font-size.test.mts`** — shrift reyestri, `style.font`, `applyFontOverrides`
- **`tests/ui/slide-editor.test.mts`** — WYSIWYG muharrir (contentEditable, ro'yxat qutisi, shrift paneli, rasm tugmalari)
- **`tests/ui/slide-viewer-edit.test.mts`** — ko'ruvchi + `EditActions` tarmoq oqimi (bitta PATCH, discard, Ctrl+S/Z)
- **`tests/ui/theme.test.mts`** — Kun/Tun (tizim rejimi yo'q), OS rejimi migratsiyasi
- **`tests/slide-limits.test.mts`** — chegara va normallashtirish
- **`tests/slide-progress.test.mts`** — `applyLiveEvent`
- **`tests/slide-convert.test.mts`** — maket o'girrish
- **`tests/jobs-live-edit.test.mts`** — SQL predikatlari
- **`tests/llm-stream.test.mts`** — `llmStream()` Gemini oqimi
- **`tests/slide-live.test.mts`** — dvigateli hodisalari
- **`tests/api-client-live.test.mts`** — live polling
- **`tests/viewer/live.test.mts`** — jonli ko'ruvchi SSR
- **`tests/ui/setup.ts`** — jsdom sozlamasi
- **`tests/ui/smoke.test.mts`** — UIning asosiy o'nglanishi

### Skriptlar

- **`scripts/slide-eyes.mts`** (o'zgaradi)
  - `edit` profili — `applyDocOps` qadamlarini sinayddi
  - Har qadam: PPTX → PDF → PNG

- **`scripts/live-engine.mts`** (o'zgaradi)
  - `onProgress()` → hodisalari stdout da

## Qizil / ko'k

Ko'ruvchi testlari:

```bash
npm run test:viewer    # React SSR, node:test, renderToStaticMarkup
npm run test:ui        # jsdom + @testing-library/react (V2)
npm run check          # ikkalasi + tiplar + lint
```

Tunning:

```bash
npm run live -- slide pro-slide   # `onProgress` chiqarish
npm run image-lab                  # rasm uslublari solishtirish
```
