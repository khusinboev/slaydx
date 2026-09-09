# AUDIT-11 — Muharrir 2: minimal panel, WYSIWYG tahrir, rasm tugmalari, Kun/Tun

Sana: 2026-09-10. `AUDIT-10` ni DAVOM ETTIRADI (E6/E9 tahrir qatlami ustiga).
Manba — foydalanuvchi ekran rasmi (pro slayd ko'ruvchisi) va 4 ta talab.

## 1. Talablar va holat

| № | Talab (foydalanuvchi so'zi bilan) | Qaror | Holat |
|---|---|---|---|
| T-1 | Asboblar panelidan Eslatma, Reja…Bandlar (maket chiplari), +Slayd, ▲▼, Saqlash olib tashlansin; faqat «O‘chirish» qolsin. O'zgarish bo'lganda sarlavhada `[Asliga qaytarish] [Saqlash · N]`. Pastki eslatma paneli olib tashlansin | «Asliga qaytarish» = **saqlanmagan** o'zgarishlarni bekor qilish (klientda, tarmoqsiz). Server `doc_prev`/`POST …/doc/restore` qoladi, UI da chiqmaydi. Taqdimotchi (P) panelidagi eslatma qoladi | ✅ WP1 `278ead8` |
| T-2 | Ikki bosish → matn slaydning o'zida, «yozganim yozganday», shrift biriktirish | `contentEditable` sahna bilan bir masshtabli egizak konteynerda, `textLayerStyle` — `SlideCanvas` bilan BITTA funksiya; ro'yxat butun quti (PowerPoint kabi, Enter → yangi band); 8 xavfsiz shrift oilasi | ✅ WP2 `1529bb1`, WP3 `ca415dc` |
| T-3 | «Qayta chizish» to'liq olib tashlansin; `[O‘z rasmim] [Rasmsiz]` + rasmni eskiga qaytarish | UI + klient + **server route** o'chirildi (pulli Gemini chaqiruvi bo'lgan o'lik endpoint qoldirilmadi); `image_redraws` ustuni qoladi (migratsiya yo'q). Asl rasm `SlideModel.imageOrig` da, `imageRestore` op | ✅ WP4a `30205b2`, WP4b `68ddc0b`, WP2 |
| T-4 | Mavzu tugmasida faqat Kun/Tun, «Tizim» yo'q | Birinchi kirishda OS rejimi BIR MARTA o'qilib saqlanadi; eski «system» → migratsiya (`persist` v2) | ✅ WP5 `02962c6` |

## 2. Arxitektura qarorlari

- **«Ko'rdim = oldim» tahrir paytida ham.** `SlideCanvas.textLayerStyle(layer)`
  eksport qilindi (kalitlar tartibi SSR `style=""` satrini belgilaydi —
  o'zgartirilmadi, `parity.test` qulfi). `SlideEditor` tahrir qutisini shu
  funksiya bilan chizadi: shrift, o'lcham, rang, tekislash, harf oralig'i,
  uppercase — qatlamniki. Farqi: `overflow: visible`, ko'k ramka, fon yo'q.
- **Masshtab CSS `transform` da** (qo'lda ko'paytirish emas): overlay ichida
  `SLIDE.w × SLIDE.h` egizak konteyner `scale(scale)` bilan — quti
  koordinatalari `boxStyle(layer.box)` dan, piksel-piksel sahna bilan
  ustma-ust. `hideSrc` → asl qatlam `visibility: hidden` (joyi saqlanadi).
- **Ro'yxat butun quti.** Yangi `list` op (`{field, items}`), bo'sh bandlar
  tashlanadi, `listCap()` chegarasi op va muharrirda bitta joydan. Teskarisi
  `set`. «+ band» tugmasi yo'q.
- **Shrift oilasi — reyestr** `lib/generation/slide-fonts.ts` (`id/face/css/em`).
  `SlideModel.font` (kalit `src` JSON, `fontSize` naqshi) → `applyFontOverrides`
  qatlamga `face` yozadi → `render-pptx` `fontFace`, `SlideCanvas` `fontCss`.
  Kengroq shrift (Verdana, em 0.63) `fitSize` o'lchamini `CHAR_EM/em` ga
  KICHRAYTIRADI (faqat kichraytiradi — balandlik byudjeti fit paytida
  hisoblangan); foydalanuvchi o'lcham tanlagan bo'lsa tegilmaydi.
  Google Fonts ATAYLAB yo'q (PPTX da almashadi).
- **Asl rasm.** `image` op (null yoki yangi url) `s.image` ni BIRINCHI marta
  `imageOrig` ga ko'chiradi, keyingilari ustidan yozmaydi; `imageRestore`
  qaytaradi va `imageOrig` ni o'chiradi. Server `uploadSlideImage` ham
  `commitDocOps` orqali kelgani uchun avtomatik qamrab olinadi.
- **Saqlash sahifa sarlavhasida.** `SlideViewer.onEditState` →
  `ResultView` → `EditActions`: `[Asliga qaytarish (2 bosish)] [Saqlash · N]`,
  saqlangach `Saqlandi ✓`. `useSlideEdit.discard()` — navbat, undo/redo
  tozalanadi, hujjat oxirgi serverdan kelgan nusxaga (`baseDocRef`).
- **F2 paritet fiksturasi o'chirildi** (`__SlideViewerOld.fixture.tsx`,
  `slide-viewer-seams.test.mts`) — passiv HTML ni bayt-baytiga qulflab har UI
  o'zgarishini ikki marta yozdirar edi; F2 bo'linish allaqachon yakunlangan.
- **Mavzu.** `ThemeMode = "light" | "dark"`, `resolveOsTheme()` bir marta,
  `migrateUiPrefs()` (`persist` v2), `THEME_OPTIONS` = Kun/Tun, `TopBar`
  Sun/Moon.

## 3. Sinov

- Har WP alohida kommit; har yangi qoida uchun **mutatsiya**: WP2 — 7, WP1 — 5,
  WP3 — 7, WP5 — 5 (hammasi testlar tomonidan ushlandi; jadval kommit
  xabarlarida).
- `tests/ui/slide-editor.test.mts` qayta yozildi (33 test): contentEditable
  maydon, ro'yxat qutisi (jsdom da brauzer Enter'i yo'q — `<li>` qo'lda
  qo'shiladi, komponent DOM dan o'qiydi), shrift oilasi `<select>`, `blur`
  `relatedTarget` panelga o'tsa yopilmaydi, quti stili qatlam bilan bir xil,
  egizak konteyner `scale`, `onEditing` kaliti, `readText`/`readItems`.
- `tests/ui/slide-viewer-edit.test.mts`: `Page` harness (`SlideViewer` +
  `EditActions`), saqlanmagan op generatori — mobil tasma ◀/▶ (`reorder`),
  discard (UI + hook), `hideSrc` zanjiri.
- **PPTX haqiqiy tekshiruv:** `renderPptx` bilan `font: georgia/verdana`
  berilgan deka → `ppt/slides/slide1.xml` da `typeface="Georgia"` (3),
  `slide2.xml` da `typeface="Verdana"` (6) — `fontFace` faylga yetadi.
- `npm run check` (6G xotira chegarasi ostida): typecheck ✅, lint ✅,
  **unit 842/844**, **viewer 57/57**, **UI 70/70**. Unit dagi 2 ta yiqilish
  (`tests/document.test.mts` — «fal.ai hisobni bloklasa…», «rasm va'dasi
  reja bilan…») **bu sprintdan OLDIN ham bor**: bazaviy `8d9f82d` da ham
  yiqiladi, `.env.local` siz o'tadi — `PEXELS_API_KEY`/`PIXABAY_API_KEY`
  lokal muhitda FAL_KEY'siz ham rasm va'da qildiradi (Y-4, pastda).

## 4. Ochiq qolganlar / ogohlantirish

- Brauzerda ko'z bilan: ikki bosish → kursor, Enter → yangi band,
  `<select>` ochilishi, Shift+Enter — Chrome/Firefox da qo'lda ko'rish kerak
  (jsdom brauzer tahrir xatti-harakatini taqlid qilmaydi).
- `clipTo` `\n` ni bo'shliqqa tushiradi (avvalgi holat ham shunday) —
  ko'p qatorli `subtitle`/`quote` da Shift+Enter faqat tahrir paytida
  ko'rinadi, saqlangach bitta qator. Kerak bo'lsa alohida band.
- Mavzu: `theme.test` jsdom `matchMedia` stubi bilan; haqiqiy OS rejimi
  brauzerda birinchi kirishda tekshirilsin.
- **Y-4 (bu sprintdan oldingi):** `tests/document.test.mts` dagi ikki
  «FAL_KEY yo'q» testi `.env.local` dagi Pexels/Pixabay kalitlari bilan
  yiqiladi — test muhit kalitlarini o'zi tozalashi kerak (`delete
  process.env.PEXELS_API_KEY` kabi). Tegilmadi — alohida band.

## 5. Bajarilish yozuvi

`main`: WP4a `30205b2` → WP2 `1529bb1` → WP1 `278ead8` → (agent, worktree)
WP4b `68ddc0b` + WP5 `02962c6` → merge `21043fa` → WP3 `ca415dc` → hujjat.
