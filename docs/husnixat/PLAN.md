# Husnixat 2 — varoq, format va xizmatlar rejasi (2026-10-28)

Egasi bilan kelishilgan qarorlar:
- Qator oralig'i: katakli daftarda **tanlanadi, standart 1 katak (5 mm)**; 2 katak (10 mm) ham bor. Eski ishlar o'zgarmaydi (2 katak).
- Oq qog'oz (chiziqsiz) va **«daftarga chop etish»** (chiziqsiz, qator/chekka haqiqiy daftar kataklariga mos) — alohida rejimlar.
- Format: A4 (to'liq varoq) · A5 (daftar) · **A5 × 2** (bitta A4 albom yuzida, 100 % o'lcham, hech qanday masshtabsiz).
- Qizil chiziq: yo'q / chapda / navbatma-navbat (toq chapda, juft o'ngda; 2×A5 da ikkalasi tashqi chetda).
- Xizmatlar tartibi: **yadro → Referat → Konspekt (yangi xizmat) → Insho**. Bittadan, oldingisi tugagach.
- Konspekt: kirish «mavzu yoki fayl (PPTX/PDF/DOCX)», narx 5–10: 3 000 · 10–20: 4 000 · 20–30: 5 000, ko'pi bilan 30 varoq.

## Parametrlar (har xizmatda faqat kerakligi)
| Guruh | Parametr | Qiymat |
|---|---|---|
| Yozuv | font, ink, lively, headings, underline, cover | mavjud |
| Varoq | paper | lined · grid · blank · print |
| Varoq | format | a4 · a5 · a5x2 |
| Varoq | margin | left · alternate · none |
| Varoq | pitch (faqat grid) | 1 · 2 katak |

| Xizmat | Yozuv | Varoq |
|---|---|---|
| Mustaqil ish | hammasi | hammasi |
| Referat | hammasi | hammasi |
| Konspekt | font, ink, lively | hammasi (standart: grid + a5x2) |
| Insho | font, ink, lively | hammasi |
| Kurs ishi va boshqalar | — | — |

Mexanizm: `HAND_SERVICE_CAPS` — xizmat → ruxsat etilgan parametrlar. Forma faqat shularni ko'rsatadi, server qolganini e'tiborsiz qoldiradi.

## Texnik asos
- «Sahifa» = A4 yoki A5. **2×A5 — faqat eksport o'rami**: DOCX albom A4, 2 ustun, orqa fon bitta rasm (ikki A5 yarmi). Ko'ruvchi A5 sahifalarni alohida ko'rsatadi; har sahifa sig'imi DOCX ustuniga teng.
- Qator oralig'i butun twip (`pitchTw`), orqa fon chiziqlari shu qadam bilan chiziladi — drift yo'q.
- `blank`/`print`: orqa fon rasmi yo'q, qizil chiziq yo'q; `print` da qator qadami va chekkalar daftar kataklariga (5 mm) mos.

## Bosqichlar
1. **Yadro:** geometriya (sahifa o'lchami, qator, chekka), `paperPng` (A5, blank/print, margin tomoni, 2-up rasm), `render-hand` (A5, 2 ustun), ko'ruvchi (A5 sahifa, juft/toq chiziq), forma qatorlari, differensial zond, LibreOffice ko'z tekshiruvi.
2. **Xizmat ro'yxati** (`HAND_SERVICE_CAPS`) + Referatga ochish.
3. **Konspekt xizmati** (tool, dvigatel, varaq soniga moslash, narx).
4. **Insho** (alohida dvigatelga ulash).

## Status (2026-10-28)
- Stage 1 (paper/format core) — deployed (PR #88). Stage 2 (service capabilities, referat) — deployed (PR #89).
- Stage 3 (konspekt service) — `lib/generation/konspekt/` (input/plan, engine, params registry), `KonspektComposer`,
  genre `konspekt` / shape `notes` in the work registry, tool `konspekt` (3 000 / 4 000 / 5 000 by notebook pages).
  Volume: word plan from the hand geometry (`FILL` calibrated on a rendered live konspekt) + a rendered-size fit in
  `buildArtifact` (DOCX → PDF page count; over the tier → trim from the end, far below → refund).
- Stage 4 (essay) — not started.
- Stage 4 (essay) — `HAND_SERVICE_CAPS.essay` (font/ink/lively/paper/format/margin/cells), `EssayInput.hand`, the essay engine attaches a `doc.work` (genre `essay`, kind `handwritten`, shape `notes`, no cover page) that carries the layout for the shared renderer/viewer; essay form: «Ko'rinish» + `HandRows`; 8 new registry params with differential probes. Note: 2026-10-28 stage-2 deploy (7573dbf) aborted before the swap (registry pull reset); the next commit's deploy carries it.
