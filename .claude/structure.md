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
  - `IMAGE_REDRAW_LIMIT=5` (dekaga qayta chizish)
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
  - `regenerateSlideImage()` — qayta chizish, limit tekshiruvi

- **`lib/server/preview.ts`** (yangi)
  - `buildPreview()` — deka XML/HTML ko'rish (worker dan ko'chdi)

- **`lib/server/jobs.ts`** (o'zgaradi)
  - `setLive(id, workerId, live)` — jonli dekani yozish
  - `updateGenerationDoc()` — doc_version ubaytish
  - `markFileVersion()` — file_version ubaytish
  - `reserveRedraw() / releaseRedraw()` — rasm qayta chizish saylagichi

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

- **`components/viewers/SlideEditor.tsx`** (yangi)
  - Overlay: tahrirlash textarea, DnD, Ctrl+Z, maket chiplar

- **`components/viewers/SlideViewer.tsx`** (o'zgaradi)
  - `SlideViewer({ doc, live?, overlay? })`
  - `live` qiymatida jonli ko'rish
  - `overlay` qiymatida tahrirlash

- **`components/viewers/SlideRail.tsx`** (yangi)
  - Slaydlarning mini ko'rish
  - DnD yordamida o'girrish

- **`components/viewers/SlideStage.tsx`** (yangi)
  - Asosiy tasvir + overlay sloti

- **`components/viewers/SlideCanvas.tsx`** (o'zgaradi)
  - `data-src` atributi — matn manba
  - `reveal?: number` — jonli kitob effekti

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

### API klienti

- **`lib/api-edit.ts`** (yangi)
  - `patchGenerationDoc()` — PATCH /api/generations/{id}/doc
  - `rebuildGeneration()` — POST .../rebuild
  - `uploadSlideImage()` — POST .../slides/{i}/image
  - `regenerateSlideImage()` — POST .../image/regenerate

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

- **`app/api/generations/[id]/slides/[index]/image/regenerate/route.ts`** (yangi)
  - `POST` — `regenerateSlideImage()` limit tekshiruvi

### Testlar

- **`tests/slide-edit.test.mts`** — `applyDocOps` muhim qoidalari
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
