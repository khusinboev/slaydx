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
(to'ldiriladi)
