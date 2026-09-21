# Formalar 3 — o'lchov (Chromium, 2026-09-21, dev `406f8ac`)

Barcha 22 vosita formasi, kirgan foydalanuvchi, 1400 px kenglik. `h` — `main` balandligi yopiq holda (px), `ochiq` — barcha `<details>` ochilgan, `mob` — 390 px kenglikda; maydon sonlari DOM dan (`input`/`textarea`/`select`, chips = `button[aria-pressed]`, `details` = yig'iq bo'limlar soni / ochiq holda kelganlari). Etalon (AUDIT-12): yopiq ≈ 1 100–1 200 px.

| Vosita | Guruh | Komponent | h | ochiq | mob | input | textarea | select | chips | switch | details | fayl | tooltip | Narx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slide | umumiy | SlideComposer | 1208 | 1504 | 2325 | 6 | 1 | 2 | 26 | 5 | 1/0 | 1 | 33 | 3,000 tanga |
| rasm | umumiy | ImageStudio | 1359 | 1359 | 1888 | 0 | 1 | 0 | 0 | 0 | 0/0 | 0 | 0 | - |
| article | umumiy | ArticleComposer | 1992 | 2485 | 3112 | 9 | 3 | 1 | 17 | 1 | 1/0 | 1 | 13 | 6,000 tanga |
| resume | umumiy | ResumeComposer | 1937 | 2327 | 2863 | 9 | 3 | 5 | 4 | 6 | 1/0 | 1 | 10 | 3,000 tanga |
| translation | umumiy | TranslationForm | 858 | 1041 | 1216 | 0 | 2 | 2 | 6 | 0 | 1/0 | 0 | 3 | 3,000 tanga |
| coursework | talaba | WorkComposer | 2027 | 2392 | 3272 | 14 | 3 | 0 | 40 | 1 | 2/1 | 1 | 10 | 16,000 tanga |
| referat | talaba | WorkComposer | 2001 | 2366 | 3194 | 14 | 3 | 0 | 38 | 1 | 2/1 | 1 | 10 | 3,000 tanga |
| mustaqil-ish | talaba | WorkComposer | 2001 | 2366 | 3168 | 14 | 3 | 0 | 35 | 1 | 2/1 | 1 | 10 | 3,000 tanga |
| essay | talaba | EssayComposer | 1035 | 1321 | 1688 | 1 | 2 | 0 | 26 | 0 | 1/0 | 0 | 13 | 2,500 tanga |
| thesis | talaba | ArticleComposer | 1894 | 2383 | 2921 | 9 | 3 | 1 | 13 | 1 | 1/0 | 1 | 14 | 4,000 tanga |
| lesson-plan | oqituvchi | TeacherComposer | 1424 | 1596 | 2030 | 7 | 2 | 3 | 17 | 0 | 2/1 | 0 | 7 | 4,000 tanga |
| texnologik-xarita | oqituvchi | TeacherComposer | 1187 | 1359 | 1691 | 7 | 1 | 3 | 7 | 0 | 2/1 | 0 | 7 | 6,000 tanga |
| glossary | oqituvchi | TeacherComposer | 986 | 1158 | 1465 | 4 | 1 | 1 | 12 | 1 | 2/1 | 0 | 4 | 6,000 tanga |
| keys | oqituvchi | TeacherComposer | 989 | 1161 | 1442 | 4 | 1 | 1 | 12 | 0 | 2/1 | 0 | 3 | 6,000 tanga |
| test | oqituvchi | TeacherComposer | 1477 | 1649 | 2211 | 9 | 1 | 3 | 32 | 2 | 2/1 | 1 | 7 | 3,000 tanga |
| infografika | oqituvchi | StandardForm | 878 | 878 | 1046 | 1 | 0 | 0 | 0 | 0 | 0/0 | 0 | 0 | 2,000 tanga |
| crossword | oyinlar | StandardForm | 844 | 844 | 897 | 1 | 0 | 0 | 0 | 0 | 0/0 | 0 | 0 | 2,000 tanga |
| flashcards | oyinlar | StandardForm | 844 | 844 | 788 | 1 | 0 | 0 | 0 | 0 | 0/0 | 0 | 0 | 2,000 tanga |
| sorting | oyinlar | StandardForm | 844 | 844 | 872 | 1 | 0 | 0 | 0 | 0 | 0/0 | 0 | 0 | 2,000 tanga |
| listening | oyinlar | StandardForm | 844 | 844 | 788 | 1 | 0 | 0 | 0 | 0 | 0/0 | 0 | 0 | 2,000 tanga |
| podcast | media | StandardForm | 1093 | 1093 | 1271 | 1 | 1 | 0 | 0 | 0 | 0/0 | 0 | 0 | 4,000 tanga |
| greeting | media | StandardForm | 844 | 844 | 924 | 2 | 0 | 0 | 0 | 0 | 0/0 | 0 | 0 | 4,000 tanga |

## Kuzatuvlar

- **Talaba (WorkComposer)** — eng uzun formalar: 2 001–2 027 px yopiq (etalondan 1,8×), 14 input + 3 textarea + 35–40 chip; «Titul» kartasi (9 maydon) OCHIQ keladi (`details 2/1`), «Hajm» 7 ta uzun chip, «Materiallar» kartasi (fayl + natijalar + manbalar + manba minimumi) doim ochiq; «Sozlamalar» xulosa chipi eng pastda (ma'nosi yo'q). Mobil 3 200 px.
- **Tezis (ArticleComposer)** — 1 894 px: maqola formasi bilan bir xil, tezis uchun ortiqcha (nashr profili, annotatsiya maydonlari).
- **Insho** — 1 035 px: me'yorga yaqin, lekin 26 chip (kontekst × tur) — select/galereya nomzodi.
- **O'qituvchi (TeacherComposer)** — 986–1 477 px: kartalar bor, lekin «Fan, sinf, til» kartasida 8–9 qator ochiq, «Shapka» ochiq keladi (`2/1`), sana maydoni brauzer standarti (`mm/dd/yyyy`), «Qo'shimcha» xulosa pastda; test 32 chip.
- **Infografika, o'yinlar, media (StandardForm)** — 844–1 093 px, lekin bu «ixchamlik» emas, dizayn yo'qligi: kartasiz, legend + chips ro'yxati, tooltip 0, `SummaryChips` yo'q, «Qo'shimcha (ixtiyoriy)» ochilmasi — etalon vizual tilidan butunlay farq qiladi; podkast rejim kartalari (Mavzu/Matn/Fayl) alohida uslubda; mobil `!` (gorizontal siljish) yo'q.
- **Umumiy (etalon)** ham bir xil emas: slayd 1 208, tarjimon 858, rasm 1 359 (ixchamlashtirilmagan, `ToolChrome` siz), maqola 1 992, rezyume 1 937 — maqola/rezyume «ixcham» me'yorga tushmagan (ular tuzilmali ko'p maydonli formalar, lekin yig'iq bo'lim faqat bitta).

Skrinshotlar: sessiya scratchpad `main-<slug>.png`.