# AUDIT-14 — Tarjimon 2: tuzilmani saqlab tarjima, 18 til, pro sifat, ixcham forma

Sana: 2026-09-10. `AUDIT-13` dan keyin. Reja: `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`.

## 1. Talablar

| № | Talab | Qaror | Holat |
|---|---|---|---|
| T-1 | Dizayn jihatdan yangilash, optimallash | Formalar 2 uslubidagi ixcham kartalar: «Manba» (Matn/Fayl, sudrab tashlash, narx) · «Tillar» (⇄) · ▸ «Sozlamalar» (uslub, o'z lug'ati) | 🔄 |
| T-2 | Gemini bo'lgani uchun kiruvchi tillarning BARCHASIGA tarjima | 18 til ikkala yo'nalishda (`TRANSLATION_LANGUAGES`), manba «Avtomatik» — aniqlangan til natijada | 🔄 |
| T-3 | Pro tarzda tarjima | 1-o'tish glossariy + til aniqlash → har partiya glossariy + oldingi kontekst; uslub (Rasmiy/ilmiy · Biznes · Oddiy · Adabiy); raqam/sana/ism/URL/email/placeholder verbatim (prompt + `checkVerbatim` + retry + ogohlantirish); yonma-yon taqqoslash | 🔄 |
| T-4 | Yuklangan fayl (DOCX/PPTX/…) tuzilmasi, shrifti, jadvallari, titul sahifasi buzilmasdan tarjima | Bayt `source_uploads` ga; fayl ICHIDA matn tugunlari almashtiriladi (`lib/generation/translate/`): DOCX→DOCX, PPTX→PPTX, XLSX→XLSX, TXT/MD/CSV→o'zi, PDF→toza DOCX | 🔄 |

Qarorlar (mahsulot egasi): narx ≤10 000 belgi 3 000, keyingi har 5 000 +1 000; chegara 200 000; PDF `unpdf` bilan tuzilma tiklanib DOCX (LibreOffice import yo'q); skanlangan PDF pul yechilmasdan rad.

## 2. Arxitektura

(WP lar tugagach to'ldiriladi: A — saqlash/narx, B — segment modeli, C — dvigatel, D — forma, E — ko'ruvchi.)

## 3. Sinov

(to'ldiriladi)

## 4. Bajarilish yozuvi

(to'ldiriladi)
