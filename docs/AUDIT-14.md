# AUDIT-14 — Tarjimon 2: tuzilmani saqlab tarjima, 18 til, pro sifat, ixcham forma

Sana: 2026-09-10. `AUDIT-13` dan keyin. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar

| № | Talab | Qaror | Holat |
|---|---|---|---|
| T-1 | Dizayn jihatdan yangilash, optimallash | Formalar 2 uslubidagi ixcham kartalar: «Manba» (Matn/Fayl, sudrab tashlash, jonli belgi/narx) · «Tillar» (⇄) · ▸ «Sozlamalar» (uslub, o'z lug'ati) | ✅ |
| T-2 | Gemini bo'lgani uchun kiruvchi tillarning BARCHASIGA tarjima | 18 til ikkala yo'nalishda (`TRANSLATION_LANGUAGES`), manba «Avtomatik» — aniqlangan til natijada chip bilan | ✅ |
| T-3 | Pro tarzda tarjima | 1-o'tish glossariy + til aniqlash → har partiya glossariy + oldingi kontekst; uslub (Rasmiy/ilmiy · Biznes · Oddiy · Adabiy); raqam/URL/email/placeholder/akronim verbatim (prompt + `checkVerbatim` + retry + ogohlantirish); yonma-yon taqqoslash | ✅ |
| T-4 | Yuklangan fayl tuzilmasi, shrifti, jadvallari, titul sahifasi buzilmasdan tarjima | Bayt `source_uploads` ga; fayl ICHIDA matn tugunlari almashtiriladi: DOCX→DOCX, PPTX→PPTX, XLSX→XLSX, TXT/MD/CSV→o'zi, PDF→toza DOCX | ✅ |

Qarorlar (mahsulot egasi): narx ≤10 000 belgi 3 000, keyingi har 5 000 (yoki qismi) +1 000; chegara 200 000; PDF `unpdf` bilan tuzilma tiklanib DOCX (LibreOffice import yo'q); skanlangan PDF pul yechilmasdan rad.

## 2. Arxitektura

```
Forma ──fayl──▶ POST /api/uploads/source ─▶ source_uploads (017: bytes, kind, chars, text)
      ──matn──▶ sourceText
  ▼ POST /api/generations: sourceAssetId → bazadan ISHONCHLI chars → priceFor / budgetFor (60 s + 2.5 s/1k)
Worker: sourceForJob → buildArtifact({source, onStage})            (onStage → setProgress, soxta egri chiziq to'xtaydi)
  ▼ lib/generation/translate/
    extractSegments(kind, bytes) ─▶ Segment[] {id, text(+⟦token⟧), kind, ctx}
    engine: dublikat → oversize split → glossariy+detect → partiyalar (≤3 500) → mapPool(4)
            → tekshiruv (id, token multiset, verbatim) → retry (partiya ½, band STRICT ≤2) → 3% qoidasi (delivered)
    applySegments(kind, bytes, map) ─▶ o'sha fayl, faqat matn tugunlari almashgan
    (pdf/matn) → AcademicDoc → renderDocx(profile "translation")
  ▼ BuiltFile {bytes, mime = kirish, doc.translation: TranslationReport}
Natija: TranslationViewer — chiplar · ogohlantirishlar · Taqqoslash (2 ustun) | Fayl (iframe ?format=pdf)
```

- **Segment modeli** (`translate/segments.ts`, `xml-scan.ts`): tokenlar `⟦tab⟧ ⟦br⟧ ⟦n⟧ ⟦rK⟧…⟦/rK⟧ ⟦lK⟧…⟦/lK⟧`; `isTranslatable` (harf bor, faqat raqam/punktuatsiya/URL/kod emas); dublikat bir marta; uzun segment jumla chegarasida bo'linadi (`MAX_SEGMENT_CHARS 2000`).
- **DOCX** (`docx.ts`): `document.xml` + kolontitullar + izohlar; `<w:p>` runlari rPr kaliti bo'yicha birlashadi (≤4 farqli run → markerlar, ko'p bo'lsa dominant run); maydonlar `PAGE|NUMPAGES|DATE|…|PAGEREF|=` opaque, TOC/HYPERLINK natija matni tarjima qilinadi; `w:txbxContent` ichki paragraf; tahrirlar KAMAYUVCHI tartibda; `<w:t xml:space="preserve">`; `pPr/rPr/tblPr/sectPr/drawing/numbering` tegilmaydi.
- **PPTX** (`pptx.ts`): slaydlar (raqam tartibida) + notes (`slideN.xml.rels` orqali), `<a:br/>`, `<a:fld>` opaque, `hlinkClick`, `a:tc`→cell, `ph type`→title; charts/SmartArt tegilmaydi + ogohlantirish.
- **XLSX** (`xlsx.ts`): sharedStrings (oddiy + boy runlar, `rPh` opaque, `count/uniqueCount` o'zgarmaydi), inlineStr; `<f>/<v>/t="str"` va `=`-satrlar tegilmaydi.
- **TXT/MD/CSV** (`plain.ts`): MD kod bloklari/prefikslar/havola/urg'u markerlari; CSV RFC 4180, ajratgich/BOM/quoting saqlanadi.
- **PDF** (`pdf.ts`): `unpdf` koordinatalari → qatorlar, takrorlanuvchi kolontitul tashlanadi, paragraf/sarlavha/ro'yxat/jadval evristikasi → `AcademicDoc` (jadvalli hujjatda bir nechta `body` bo'limi — jadval o'z joyida); `docx-profile.ts` yangi `translation` profili (A4, Times 12, titulsiz) — matn rejimi ham shu.
- **Dvigatel** (`engine.ts`, `prompts.ts`, `report.ts`, `glossary.ts`): inglizcha ko'rsatma + `languageDirective`; glossariy namunasi ≤12k (katta hujjatda tekis oynalar), `src` namunada uchrashi shart, foydalanuvchi lug'ati ustun; partiya `maxTokens = min(8000, chars·1.6/3+400)`, `timeout = clamp(25–90 s, qolgan/to'lqinlar)`; qisman qoida `≤ max(1, ceil(3%)) va ≤ 20` → asl matn + `untranslated` + `delivered {got, want, unit:"band"}` (mavjud `refundPartial`); ko'proq → to'liq qaytarish. `pairs` ≤ 3 000 / 700k belgi.
- **Saqlash/narx** (`lib/server/source-upload.ts`, `lib/tools.ts`): 20 MB, sniff (zip yo'l satrlari / `%PDF-` / NUL), `chars` = tarjima qilinadigan segmentlar yig'indisi (narx modelga yuboriladigan hajmga teng), skanlangan PDF `chars < 20×pages` → 422; `purgeOldSources(30)`; `missingRequired` `sourceAssetId` bilan qanoatlanadi; `readJson` 1.2 MB.
- **Forma/ko'ruvchi**: `TranslationForm.tsx` (yuklangan faylning matni faqat ko'rish uchun — «Matn sifatida ochish» tugmasi), `TranslationViewer.tsx` (eski hujjat → `WordViewer`), `ArtifactViewer` `pdf` propi, `ToolChrome` `data-price-total`.

## 3. Sinov

- Unit **895/903** (8 skip — env), viewer **62/62**, UI **85/85**; `tsc`, `eslint` toza.
- `translate-docx` 5 · `translate-pptx` 4 · `translate-xlsx` 3 · `translate-plain` 11 · `translate-pdf` 5 (fikstura: `docx` v9 + pptxgenjs + xom XML: text box, TOC `fldChar`, `<a:br/>`, `<a:fld slidenum>`, chart; LibreOffice sahifa soni tengligi), `translate-engine` 15 (LLM stub: partiyalash, id xaritasi, yarim partiya retry, STRICT retry, verbatim jadvali, token mos kelmasa, 2/100 → delivered, 5/100 → xato, deadline, glossariy oynalari/aniqlangan til/foydalanuvchi ustunligi, progress monoton, dublikat bir marta), `source-upload` 11, `pricing` (+2), `validate/document/generation` yangilandi, `ui/translation-form` 5, `viewer/translation-viewer` 4.
- **Mutatsiya** (qizil tasdiqlangan): narx `ceil→floor`; skanlangan PDF qoidasi; `missingRequired` istisnosi; `xml:space="preserve"` olib tashlash (1); maydon qoidasi (3); tahrir tartibi o'sish (3, LibreOffice testi ham); dvigatel token tekshiruvi o'chirilsa (2); 3% qoidasi o'chirilsa (2).
- **Ko'z bilan**: DOCX/PPTX fikstura asl ↔ tarjima PNG (50 dpi) — Title/Heading uslublari, ko'k sarlavha rangi, qalin run, tab, raqamli ro'yxat, izoh, rasm, 3 ustunli jadval, kolontitul, sahifa raqami, text box — hammasi joyida; PPTX: placeholder tipografiyasi, `<a:br/>`, qalin run, jadval ustunlari, slayd raqami maydoni. Ataylab 6 xil formatli paragraf dominant runga tushadi (ma'lum cheklov).
- **Jonli** (`npm run live -- translation-text` / `translation-file --source eval-out/fixtures/sample.docx`, Gemini): matn — 4/4 band, aniqlangan til `uz`, 16 atama glossariy, «1 250» va `https://aral.uz` saqlangan, ogohlantirish yo'q, 4.6 s; DOCX — 21/21 band, `sample-en.docx`, 1 bet, 6.1 s; jonli DOCX PNG'da asl bilan bir xil maket.
- **Chromium smoke** (`scratchpad/pw/translate.mjs`, admin sessiya): matn 12 000 belgi → 4 000 tanga; DOCX yuklash 0.8 s → «sample.docx · DOCX · 424 belgi», 3 000 tanga; Yaratish → natija 6 s; sarlavha chiplari (`o‘zbek tili → English`, 21/21 band, aniqlangan til, domen, lug'at 19), 21 juft, «Fayl» tabida iframe (headless Chromium PDF chizmaydi — haqiqiy brauzerda ishlaydi; «PDF ni yangi oynada ochish» zaxira havolasi qo'shildi); sahifa xatolari yo'q.

## 4. Bajarilish yozuvi

- WP1 (server/narx, agent) `992601b`+`f233660`; WP2 (adapterlar, agent) `3e79ac6`+`b4da32c`; WP3/4/5 `879eaf1`, `0264591`, `1627fa5`, `9f566c4`; birlashma + tuzatish `d026c15`.
- Ikki opus agent parallel worktree'da; WP2 agenti sessiya limitidan to'xtab, reset'dan keyin `SendMessage` bilan davom ettirildi (AUDIT-13 naqshi).
- Ochiq bandlar: (1) >4 formatli run'li paragrafda aralash formatlash dominant runga tushadi; (2) chart/SmartArt matni tarjima qilinmaydi (ogohlantirish); (3) PDF bir tomonlama (→DOCX), OCR yo'q, ustun/sarlavha evristik; (4) `w:del`, `comments.xml`, `glossary` qismlari tarjima qilinmaydi; (5) verbatim tekshiruvi so'z bilan yozilgan raqamda yolg'on salbiy — faqat ogohlantirish; (6) RTL (`ar`) yo'nalishi faylda qo'lda; (7) `source_uploads` 30 kundan keyin o'chadi — eski `sourceAssetId` bilan qayta yaratish 400 beradi; (8) narx formati `formatTanga` (`3,000 tanga`) — butun ilova bo'ylab mavjud uslub.
