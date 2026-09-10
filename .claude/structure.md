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
- **`components/forms/slide-pickers.tsx`** — `TemplatePicker` (yig'iq), `ColorPicker` (faqat doiralar)
- **`components/forms/SlideForm.tsx` / `ProSlideForm.tsx`** — yupqa o'ram; eksport ro'yxatlari reyestr bilan `tests/viewer/slide-form.test.mts` da solishtiriladi
- **`lib/profile-sync.ts`** — `profilePatchFrom(values, profile)`: faqat o'zgargan muallif maydonlari (bo'sh ham)
- **`lib/generation/slide-params.ts`** — `SLIDE_MIN/MAX/DEFAULT`, `slidePrice(n)` = 3 000 + max(0, n−20)·500; `slideCount` ikkala vositada, `quality` yo'q, `slideImageStyle` faqat pro
- **`lib/generation/image-provider.ts`** `pickProvider`: `slide` → `stock` zanjiri (Pexels → Pixabay, fal YO'Q), `pro-slide` → gemini, meta'siz → eski zanjir
- **`lib/server/migrations/015_profile_position.sql`** — `users.position`, `users.organization`

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
