# AUDIT-25 — Taqdimot 3: «Reja = shartnoma»

Sana: 2026-09-24. Filial: `slides-3` (main `e89c7c1` dan). Egasi shikoyati: «ba'zilari rejaga amal qilmayapti,
ba'zilarida axboriy matn kam, reja raqamlari slaydlarda xato, ba'zida shunchaki "3" raqami turadi».

## 1. Tashxis (ikki jonli deka + kod)

Ko'rilgan dekalar: `eval-out/live/Orol dengizi…pptx` (pro-slide, open_lesson, 10 slayd, reja 4 band) va
`Kasr sonlarni…pptx` (slide, 10 slayd, reja 3 band).

| # | Alomat | Ildiz sababi (kod) |
|---|---|---|
| S1 | Reja 4 band, lekin BIRORTA band o'z slaydiga ega emas: tana = iqtibos, maqsadlar, amaliyot, test×2, kalit, adabiyotlar. Reja — bezak. | `blocksToBeats` (`slide-blocks.ts`) tanani bloklar + shablon to'ldirgichlari bilan to'ldiradi; «har reja bandi ≥ 1 mazmun slaydi» degan invariant YO'Q. 10 slayd, 7 blok → 8 tanali o'rinning 8 tasi blok. |
| S2 | Raqamlar bir-biriga bog'lanmagan: reja 01–04; bo'lim slaydidagi katta «03» = dekadagi TARTIB raqami (`planSection*`, `visuals/*.ts`: `String(index+1)`); shablon rollari «1. Tushuncha / 2. Mexanizm» qattiq yozilgan; kartalar 1-2-3. | Bo'lim raqami rejadan emas, indeksdan. `SlideModel`da reja bandi maydoni yo'q. |
| S3 | «Shunchaki 3 raqami»: `beatToSlide` zaxira skeleti `stats: [{value:"3", label:"Asosiy nuqta"}, {value:"1", …}]`, process «Boshlash/O'zgarish/Natija» — bu skelet `plan` jonli hodisasi bilan ko'ruvchiga chiqadi (yozuv tugaguncha), LLM yiqilganda esa (kalitsiz rejim) faylga ham tushardi. | `slide-write.ts beatToSlide` uydirma raqamli placeholder. |
| S4 | Axboriy matn kam: mazmun slaydlari siqib chiqarilgan; qolganlarida 2–3 qisqa band; process karta matni `fitSize` bilan mayda; quiz variantlari «…» bilan kesilgan (`QUIZ_OPTION_MAX`). | Sig'im bloklarga ketadi; auditoriya qoidalari past chegara beradi; «yupqa slayd» detektori/ta'mirlash yo'q; `clip` limitlari maketdan o'lchanmagan. |

## 2. Qarorlar

1. **Reja — shartnoma.** `deckBeats` har reja bandi uchun KAMIDA bitta mazmun slaydi ajratadi (`plan: i`, 1-asosli),
   tartib rejadagidek. Bu slaydlar hech qachon qirqilmaydi: avval to'ldirgichlar, keyin yon beruvchi standart
   bloklar, keyin test soni 1 gacha va kalit; shunda ham sig'masa — `planCapacity` formada cheklaydi (3-band).
   Shablon `section` beat'i bo'lsa va sig'im yetsa band = `section` + mazmun (2 slayd), aks holda faqat mazmun.
2. **Reja slaydi mazmundan quriladi.** Modelga reja bandi i uchun slayd roli beriladi («REJA i-band: …»); yozuvdan keyin
   `agenda.bullets[i-1] := plan=i slaydining sarlavhasi` (deterministik, yagona manba). Model yozgan agenda
   ustiga yoziladi. Sarlavhalar boshidagi «1.», «1)» tartib raqami olib tashlanadi (raqam maketdan keladi).
3. **`planCapacity(v)`** (`slide-params.ts`, klient-xavfsiz): berilgan `slideCount/blocks/quizCount/agendaSlide/
   titleSlide/speakerNotes/internetSearch/slidePurpose` uchun nechta reja bandi sig'adi. `extractMeta` `planItems`ni
   `[1, capacity]` ga qisadi; forma jonli ko'rsatadi va sig'maydigan variantni o'chiradi; `preflightError` emas —
   avtomatik moslashish (foydalanuvchi so'ragan slayd soni va narx o'zgarmaydi).
4. **Raqam faqat rejadan.** `section` (va bo'lim vazifasidagi kicker raqamlari) `s.plan` ni ko'rsatadi; `plan` yo'q
   bo'lsa raqam CHIZILMAYDI (eski doc_json ham shunday). Ro'yxat tartib raqamlari (agenda 01…N, kartalar, process
   `n`) — ro'yxat ichida ma'noli, qoladi. Shablon rollaridan qattiq raqamlar olib tashlanadi.
5. **Skelet halol.** `beatToSlide` uydirma raqam yozmaydi: stats `value: "—"`, process matni rol, bullets `["…"]`.
   `fallbackSlides` faylga hech qachon tushmaydi (LLM yiqilsa — FAILED + qaytarish, allaqachon shunday).
6. **Matn zichligi.** (a) prompt: har maket uchun so'z oralig'i (bullet, step.text, subtitle, quote, option);
   (b) `slide-quality.ts`: `thinSlides(slides, rules)` detektori (band soni < min, so'z < min, step matni < 6 so'z,
   section subtitle bo'sh, option «…» bilan tugagan) + `repairThinSlides()` — BITTA qo'shimcha LLM chaqiruvi
   (faqat yupqa slaydlar, byudjet qolsa), yaxshilansa qabul; (c) `SLIDE_LIMITS` maketdan o'lchanadi — quiz
   variantlari kesilmaydi, o'rniga `fitSize`.
7. **Tekshiruv.** `scripts/slide-audit.mts`: doc.json → reja qamrovi, agenda == sarlavhalar, yupqa slaydlar,
   raqamsiz bo'limlar, «…» kesiklar; `npm run live` slayd holatlariga shu tekshiruvlar kiradi. Jonli byudjet ≤ $4.

## 3. Paketlar va fayl egaligi

| Paket | Model | Fayllar (FAQAT shular) | Testlar |
|---|---|---|---|
| P1 dvigatel: reja beat'lari, agenda sinxroni, `plan` maydoni, `planCapacity`, skelet | opus | `slide-blocks.ts`, `slide-write.ts`, `slide-templates.ts` (rollar), `slide-types.ts`, `slide-params.ts`, `meta.ts` (clamp), `slide-prompt/structure.ts` | `tests/slide-plan.test.mts` (yangi), `slide-blocks`, `slide-length`, `slide-params` |
| P2 maket: raqam = `plan` | opus | `slide-layout.ts`, `slide-layout-extra.ts`, `visuals/*.ts` | `tests/slide-plan-numbers.test.mts` (yangi), `slide-layout`, `slide-visuals`, `slide-src*` |
| P3 zichlik: detektor + ta'mir + limitlar + brief | opus | `slide-quality.ts` (yangi), `slide-audience.ts`, `slide-limits.ts`, `slide-prompt/brief.ts`, `slide-quiz.ts` (option clip) | `tests/slide-quality.test.mts` (yangi), `slide-limits`, `slide-audience` |
| P4 forma: sig'im ko'rsatkichi | sonnet | `components/forms/slide-fields.tsx`, `SlideComposer.tsx`, `ProSlideForm.tsx`, `SlideForm.tsx` | `tests/ui/slide-*.test.mts`, Playwright smoke |
| P5 tekshiruv skripti + jonli holatlar | sonnet | `scripts/slide-audit.mts` (yangi), `scripts/live-engine.mts` (slayd holatlari) | — |

Shartnomalar (yakuniy, review'lardan keyin):
- `SlideModel.plan?: number`, `SlideBeat.plan?: number`, `SlideBeat.structural?: true` (metodik rol — reja slaydi bo'lmaydi).
- `slide-params.ts` (klient-xavfsiz): `planCapacity(v: PlanCapacityInput): number` (`tool` maydoni bilan),
  `effectivePlanItems(raw, capacity, slideCount?)`, `defaultPlanItems(slideCount) = clamp(round(n/3), 3, 6)`,
  `resolvePlanFlags`, `activeBlockIds`; `slide-blocks.ts`: `plannedBlocks(meta, bodyWant)` — beats va prompt bir manbadan.
- `slide-quality.ts` (server): `thinSlides(slides, rules, visual?) → {index, reasons}[]`,
  `repairThinSlides(slides, meta, tpl, ctx, deadline?, jobDeadline?)` — bitta LLM chaqiruvi, xatoda kirishni qaytaradi;
  `slide-limits.ts`: `limitsFor(rules, counts)`, `clipTo(text, n)` (so'z chegarasida).
- P1 `writeSlidesWithLlm`: `slideFloor` → `repairThinSlides` (6 arg) → `syncAgenda` → `finalizeQuiz`.

## 4. Bajarilish yozuvi

### Jarayon
- 4 auditor (A1 prompt/limit, A2 maket, A3 tuzilma/parametr, A4 jonli baza) → 24 topilma (`docs/audit-25/`). A4: 6 ta «oldin» deka ($0.46) — hammasida S1+S2 takrorlandi.
- Paketlar alohida worktree'larda, har biriga mustaqil Opus reviewer (`audit/reviews/AUDIT-25-P*.md`); hech biri birinchi
  urinishda o'tmadi — jami 14 review raundi. Har o'zgarish: qizil→yashil regressiya testi + mutatsiya tekshiruvi.
- Merge tartibi: P6 → P5 → P2 → P1 → P7 → P3 → P4 → P1 ulanishi (W1–W6) → P3 follow-up.

### Nima o'zgardi (merge qilingan)
| Paket | Natija |
|---|---|
| P1 dvigatel | `deckBeats` har reja bandiga ≥ 1 mazmun slaydi (`plan: i`, hech qachon qirqilmaydi); agenda mazmun sarlavhalaridan quriladi (`syncAgenda`); `planCapacity`/`effectivePlanItems`/`defaultPlanItems` (10 slayd → 3 band); `plannedBlocks` — beats va prompt bir manbadan; aniq `quizCount: 0` = testsiz, aniq `agendaSlide: true` = reja; pro-slide'da yuborilgan `blocks` ustun; lesson shablonining metodik rollari (`structural`) reja bandi bo'lmaydi; sarlavhadagi tartib raqami va `REJA i-band:` prefiksi olib tashlanadi; halol skelet (uydirma raqam yo'q). Reviewer zondi: 60 000 tasodifiy kirishda invariantlar buzilmadi. |
| P2 maket | 15 ta «deka indeksi» raqami olib tashlandi; bo'lim raqami faqat `s.plan`dan, yo'q bo'lsa chizilmaydi (bo'shliqsiz); `bodyFit` — auditoriya poli (`minPt`), overflow'siz, so'z bo'linmaydi (bold kengligi 0.60 em), qator kartalari bir xil o'lcham; 14 auditoriya × 17 vizual × 14 holat = 35 462 qatlam testi. |
| P3 zichlik | `slide-quality.ts`: yupqa slayd detektori (`thinSlides`) + BITTA xavfsiz ta'mir chaqiruvi (qadamlar soni, test kaliti, iqtibos saqlanadi); `limitsFor(rules, counts)` — auditoriya poli × element soni bo'yicha P2 maketida o'lchangan limitlar; `clipTo` so'z chegarasida; prompt maqsadlari (`MAKET HAJMI`) qoidalardan hisoblanadi; kattalar jadvali kamida 3 so'zli katak. |
| P4 forma | «Reja bandlari» sig'imga qarab (o'chirilgan variantlar, moslashuvchan standart, «Tanlangan N band sig‘maydi» izohi); chiplar ⇄ tugmalar dvigatel bilan bir xil (`resolvePlanFlags`/`activeBlockIds`); `quizCount`/`agendaSlide` faqat tanlanganda yuboriladi; `blocks` faqat pro-slide; eski qoralamalar `v:2` bilan tozalanadi; Chromium smoke. |
| P5 tekshiruv | `scripts/slide-audit.mts` (reja qamrovi, tartib raqami sizishi, «…» kesik, skelet sizishi, yupqa matn — `meta` bo'lsa dvigatel detektori) + 7 jonli holat (`npm run live -- slide pro-slide slide-lesson slide-lecture pro-slide-open-lesson slide-report pro-slide-min`). |
| P6 | `deliveredCount` pro-slide'ni ham hisoblaydi — kam yetkazilganda qisman qaytarish (A3-03). |
| P7/W7 | Ko'ruvchi tahriri `plan`ni saqlaydi; tahrir limitlari auditoriya bo'yicha (`limitsFor`), tegilmagan matn qisqarmaydi (undo aynan qaytaradi). |
| P8 | «Matn rasmdan ustun»: prompt maqsadlariga 15 % zahira (7 jonli dekada p90 = 10.4 belgi/so'z o'lchandi), yozuv bosqichi rasmsiz quti sig'imida kesadi, matni rasm yonida sig'maydigan slayd rasmsiz qoladi (rasm va'dasi shundan keyin hisoblanadi — D1), bullet'lar ham quti sig'imida; rasm yuklash yo'li matn sig'masa 400 qaytaradi. |
| P9 | Bo'limsiz dekalarda ham reja slaydlari «0N» belgisi bilan (17 vizualda o'z uslubida); rejasiz slaydlar 14 280 kombinatsiyada bayt-bo'yicha o'zgarmagan. |
| P10 | Grounding redirect'lari 3 tadan parallel, 6 s byudjet, so'rov boshiga 3 s; hal bo'lmasa manbalar slaydida domen ko'rsatiladi, redirect URL hech qachon chiqmaydi. |

### Egasi qarori (2026-09-25)
- **D1 — «matn rasmdan ustun» (P8):** slayd matni rasm yonida sig'masa, slayd rasmsiz qoladi va rasm va'dasiga
  kirmaydi (qisman qaytarish yo'q). Egasi (a) variantini tanladi: qoida qabul qilindi, pro-slayd tavsifi
  «Har mos slaydga AI chizgan rasm» (`lib/tools.ts`), narx o'zgarmaydi.

### Tekshiruv
- Gate `slides3-pre` (879f495): typecheck 0, lint 0, unit yashil, viewer, UI, build, fresh-Postgres smoke — hammasi yashil.
- Gate `slides3-mid` (7d4525c, W7+P10+P8+docs dan keyin): typecheck 0, lint 0, unit **3 412/3 412**, viewer 248/248, UI **475/475**, build (first-load 221/220 kB), smoke — hammasi yashil.
- Review'lar: INTEGRATION (1 P1 + 5 P2 + 8 P3 → P9/P11/P12/P13 ga taqsimlandi), OLDDECKS — SAFE (6 eski deka piksel-bo'yicha bir xil, faqat mo'ljallangan raqamlar olib tashlangan), PRE-DEPLOY — GO-WITH-FIXES (deploy commit'ida gate, scope muzlatish, qaytarish qoidasi tasdig'i).
- Jonli «keyin» (7 deka, real Gemini): reja qamrovi 7/7 (oldin 0/6), tartib raqami sizishi 0, halol skelet; ko'z bilan: Orol 4/4, Kvant 5/5 band o'z slaydi bilan, sarlavha = reja bandi.
- Qolgan (P8/P9/P10 bilan yopildi): «…» kesiklar, reja slaydida raqam, redirect URL — yakuniy jonli tekshiruv pastda.

### Qarz (keyingi sprintga)
- Undo/`imageRestore` orqali rasm qaytarilganda matn uzaytirilgan bo'lsa tekshiruv yo'q (faqat yuklash yo'li himoyalangan; `slide-edit.ts` brauzerga ham yuklanadi, `slide-quality.ts` esa server-only).
- Juda kichik dekada (4 slayd, test + reja) reja slaydi tushib qolsa forma tugmasi ON turadi, izoh yo'q.
- `planFlags` uch joyda takrorlangan (meta.ts, planBudget, forma) — bitta eksportga yig'ish.
- P2 tor qutilar: circle/editorial bo'lim sarlavhasi (bold, 16–24 belgi), cards test varianti 24 pt da, rail 5 bosqich — maket o'zgarishi kerak; hozir matn ustun, rasm joy beradi.
- `sanitizeSlideModel` bo'sh satrli `kicker/subtitle/footer` kalitini tashlab yuboradi (render bir xil, lekin undo JSON tengligi qat'iy emas) — testga qulflash yoki `""` saqlash.
- Vizuallarda bold sarlavha o'lchovi `CHAR_EM_BOLD`siz (`inkHeight`) — `layerFits` bilan kelishtirish (P2 titles follow-up).
- circle twoCol karta sarlavhasi birinchi band bilan ustma-ust (eski nuqson, AUDIT-25 dan oldin ham bor edi).
- Agenda ichida element o'lchamlari har xil (uzun band kichikroq) — bitta o'lcham qoidasi (kichik follow-up).
- Split vizualida o'rta uzunlikdagi eski agenda bandlari endi kattaroq chiziladi (overflow yo'q; qabul qilingan yaxshilanish).
- Sarlavhalar `fitSize`da bold kengligi 0.55 bilan o'lchanadi (0.60 kerak) — «titles» follow-up.
- Stok rasm mosligi (Pexels qidiruvi `imageHint` bo'yicha) — mavzuga yaqin emas ba'zan; bu sprint doirasidan tashqarida.
- Pro-slayd rasm ulushi bo'yicha qaytarish (audit P6 review taklifi: 0.5–0.75 ulush) — egasi qarori kutilmoqda.

