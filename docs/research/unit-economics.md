# SlaydX — vosita tannarxi (unit economics), 2026-09-20

Faqat o'qish/tahlil. Kod o'zgartirilmadi, og'ir buyruq yurgizilmadi. Manbalar:
real telemetriya (foydalanuvchi bergan `cost_json` o'rtachalari), kod o'qish
(`lib/tools.ts`, `lib/generation/**`), va `docs/research/provider-pricing.md`
(boshqa agent tekshirgan rasmiy narxlar — 2026-09-20).

**`eval-out/live/*.doc.json` (50 fayl) tekshirildi — HECH BIRIDA `cost`/`usd`
maydoni YO'Q.** Bu fayllar faqat tayyor `AcademicDoc` (chiqish), generatsiya
metama'lumoti emas; `grep '"usd"'` ikkita faylda "topdi", lekin ikkalasi ham
base64 rasm baytidagi tasodifiy mos kelish edi (haqiqiy JSON maydon emas).
Demak 2-manba bo'yicha qo'shimcha ma'lumot YO'Q — pastdagi hisob-kitob
telemetriya (1-manba) va kod-baho (3-manba) ga tayanadi.

## 0. Asosiy taxminlar

| Belgi | Qiymat | Manba |
|---|---|---|
| `SOUM_PER_USD` | **12 700** | `lib/generation/llm-pricing.ts` standart; rasmiy CBU kursi 2026-09-19 = **11 839.59** (7.3% past) — pastdagi hammasi 12 700 bilan hisoblangan, ya'ni USD tannarx rasmiydan ~7% KAM ko'rinadi |
| Gemini 3.7 Flash | $0.75 in / $3.75 out /1M | `llm-pricing.ts`, rasmiy tasdiqlangan |
| Claude Sonnet 5 | $2 in / $10 out /1M | `llm-pricing.ts`, rasmiy tasdiqlangan |
| Gemini rasm (`gemini-3.1-flash-lite-image`, 1K — 2026-09-22 dan standart, «Rasm» va pro-slayd) | **$0.034/rasm** | rasmiy (`provider-pricing.md` §2); jonli tasdiq 2026-09-22 (8 s, 785 KB); `gemini-3.1-flash-image` $0.067 ixtiyoriy |
| fal.ai `flux/schnell` (2026-09-22 dan HAQIQIY yo'lda ishlatilmaydi — o'lik zanjir) | **$0.003/megapiksel** (≈$0.003/rasm 1024×1024 atrofida) | Rasmiy, `provider-pricing.md` §3 — steps (4 vs premium 8) narxga ta'sir qilmaydi (fal megapiksel bo'yicha to'laydi) |
| Azure TTS | $16/1M belgi | `tts/types.ts TTS_PRICES`, rasmiy taxminan mos |
| Aisha TTS | $80/1M belgi | `tts/types.ts` — **tasdiqlanmagan taxmin** (rasmiy sahifada narx yo'q, `provider-pricing.md` §4) |
| Gemini grounding (qidiruv) | 5000/oy bepul, keyin $14/1000 so'rov | Rasmiy — SlaydX hajmida (oyiga ~90 ish) deyarli har doim BEPUL chegarada |

## 1. Arxitektura topilmasi — KIM Claude baholovchidan ta'sirlanadi

`lib/generation/llm-roles.ts` izohi qat'iy: rol-asosli `complete(role,…)`
(writer/researcher/judge/fast, WP8, `LLM_JUDGE` zanjiriga bog'liq) va
to'g'ridan-to'g'ri `llmComplete`/`llmGrounded` (hech qachon judge zanjiriga
kirmaydi) ikki AYRIM yo'l. Kodni o'qib chiqilganda:

- **Judge zanjiriga BOG'LIQ** (Claude Sonnet 5 yoqilsa tannarx oshadi):
  article, thesis, coursework, referat, mustaqil-ish, lesson-plan,
  texnologik-xarita, glossary, keys, test, essay, podcast, greeting,
  infographic, crossword, flashcards, sorting, listening
  (barchasi `llm-roles.ts complete as completeRole` import qiladi,
  `*/review.ts` da 1 ta `complete("judge", …, maxTokens:1200-1500)`).
- **Judge zanjiridan MUSTAQIL** (Claude yoqilsa ham tannarx O'ZGARMAYDI,
  doim standart provayder — hozir Gemini): **slide**, **pro-slide**
  (`slide-write.ts`, `slide-research.ts` — `llmComplete`/`llmGrounded`
  to'g'ridan-to'g'ri), **translation** (`translate/engine.ts`),
  **resume** (`resume/write.ts`), **image** (`image-studio.ts
  expandPrompt`).

Bu amaliy jihatdan muhim: prod hajmining katta qismi (slide 26 + image 17 +
translation 8 + pro-slide 5 + resume 4 = 60/89 ≈ 67% buyurtma) **Claude
baholovchi narxidan umuman ta'sirlanmaydi** — WP8 "rejalashtirilgan"
konfiguratsiya faqat qolgan ~33% buyurtmaga tegadi.

## 2. Asosiy jadval — har vosita

Narx — `lib/tools.ts priceFor`. Tannarx — past/odatiy/yuqori (parametr
bo'yicha). "Gemini-only" — hozirgi holat (baholovchi ham Gemini'ga tushadi).
"+Claude judge" — agar `LLM_JUDGE=anthropic:claude-sonnet-5` ishlasa,
FAQAT judge-bog'liq vositalarga qo'llaniladi (§1); judge tokenlarining ulushi
kod-baho (odatda kirish ~15%, chiqish ~20% — judge `maxTokens` 1200-1500 va
butun hujjatni o'qiydi).

| Vosita | Narx so'm (past/odatiy/yuqori) | Chaqiruvlar | Tokenlar in/out (odatiy) | Tannarx USD Gemini-only (past/odatiy/yuqori) | +Claude judge (odatiy) | Marja % (odatiy, Gemini-only) | Manba |
|---|---|---|---|---|---|---|---|
| slide | 3000 / 3000 / 8000 | 1 matn (+1 ixtiyoriy grounding) | 2000/2800 → 3000/5000 → 4000/8500 | 0.012 / 0.021 / 0.035 | — (judgesiz) | ~90–99% | KOD: `slide-write.ts:586,641`, `slide-images.ts:241` (rasm BEPUL — Pexels/Pixabay) |
| pro-slide | 8000 / 24000 / 60000 | 1 matn +1 grounding + N Gemini rasm (N≈min(slayd,10-24)) | matn: 3500/2500 → 4000/5500 → 4500/8500 | **0.28 / 0.69 / 1.64** | — (judgesiz) | **~55–65%** (ENG PAST marja loyihada) | KOD: `image-provider.ts:241` (pro=Gemini rasm), `image-provider-gemini.ts:19` ($0.067/rasm real), `slide-images.ts:72` (`imageBudget`) |
| image | 2000 / 3500 / 6000 | 1 kichik LLM +1-4 fal rasm | ~300/200 (faqat prompt kengaytirish) | 0.004 / 0.008 / 0.014 | — (judgesiz) | ~95–99% | KOD: `image-studio.ts:205-216` (`premium:true`, fal), rasmiy fal narx |
| translation | 3000 (≤10k belgi) / 3000 / 11000 (50k belgi) | 1 glossariy +N partiya (`BATCH_CHARS=3500`) | 1500/900 → 5300/4900 → 23300/22900 | 0.005 / 0.022 / 0.103 | — (judgesiz) | 88–98% | KOD: `translate/engine.ts:60,178,319,333` |
| resume | 3000 (flat) | 0-1 (`enrich` ixtiyoriy, standart YOQILGAN) | ~1200/2500 | 0 (enrich=off) / 0.010 (enrich=on) | — (judgesiz) | 96% (enrich yoqilganda) | KOD: `resume/write.ts:110,358` (`llmComplete`, maxTokens 3200) |
| article | 4000 / 6000 / 12000 | 14 (TELEM) | 42k/6k | **0.0585** (TELEM, aralash hajm) | 0.074 (+26%) | ~88% (o'rtacha narxda) | **TELEM** (foydalanuvchi bergan) |
| thesis | 4000 / 4000 / 5000 | 8 (TELEM) | 5.4k/2.8k | **0.0145** (TELEM) | 0.019 (+31%) | 95% | **TELEM** |
| referat | 3000 / 3000-6000 / 6000 | 18 (TELEM) | 60k/15k | **0.146** (TELEM) | 0.176 (+21%) | ~54% (4500 so'm o'rtacha narxda) — ENG PAST marjali matn vositasi | **TELEM** |
| mustaqil-ish | 3000 / 4000 / 6000 | ~15-18 (referatdan skala, KOD-baho) | referatga o'xshash, biroz kamroq | 0.12 / 0.16 / 0.24 (KOD-baho) | +~20% | ~55–65% | KOD-baho: `work/registry.ts` `independent` kind, referat telemetriyasidan skala |
| coursework | 12000 / 16000 / 24000 | referatdan ko'p (majburiy jadval/sxema, ko'proq bob) | KOD-baho | 0.18 / 0.28 / 0.50 (KOD-baho, sahifa nisbatida referatdan skala) | +~20% | **74–81%** (referatdan YAXSHI — narx sahifaga nisbatan 4× yuqori) | KOD-baho: `work/registry.ts` COURSEWORK_PAGES, `priceFor` |
| essay | 2000-4000 (odatiy 2500) | 4 (TELEM) | 6.9k/3.9k | **0.031** (TELEM) | 0.037 (+20%) | 84% | **TELEM** |
| lesson-plan | 4000 (flat) | 1 (TELEM) | 1k/1.9k | **0.0078** (TELEM) | +~85% (1 → 2 chaqiruvga, KOD-baho) → ~0.014 | 97.5% | **TELEM** |
| texnologik-xarita | 6000 (flat) | ~4-6 (chorak/hafta bo'yicha bo'lakli, KOD-baho) | lesson-plandan 4-6× ko'p (yillik jadval) | 0.03 / 0.045 / 0.06 (KOD-baho) | +~20% | 87–94% | KOD-baho: `teacher/map.ts:53` (`for i<chunks`) |
| glossary | 6000 / 9000 / 15000 (10/20/40 atama) | 1 / 2 / 3-4 (round-based) | lesson-plan bazasidan skala | 0.008 / 0.016 / 0.028 (KOD-baho) | +~20% | 97–98% | KOD-baho: `teacher/glossary.ts:47` (`MAX_ROUNDS`) |
| keys | 6000 (flat) | 2-4 (case-based) | lesson-plan bazasidan skala | 0.015 / 0.02 / 0.03 (KOD-baho) | +~20% | 94–97% | KOD-baho: `teacher/keys.ts:99` |
| test | 3000 (flat) | 3 (TELEM) | 4.7k/5.6k | **0.0246** (TELEM) | 0.0325 (+32%) | ~90% | **TELEM** |
| crossword | 2000 (flat) | ~3-5 (KOD-baho, writer+polish+judge) | — | **0.0039** (TELEM) | ~0.010 (KOD-baho, +~170%: kichik bazaga nisbatan judge ulushi katta) | 98% | **TELEM** + KOD (`crossword/review.ts:438`) |
| flashcards | 2000 (flat) | KOD-baho | — | **0.0021** (TELEM) | ~0.008 (KOD-baho) | 98.7% | **TELEM** |
| infographic | 2000 (flat) | 1-2 (KOD-baho) | — | **0.0020** (TELEM) | ~0.007 (KOD-baho) | 98.7% | **TELEM** |
| sorting | 2000 (flat) | KOD-baho | — | **0.0010** (TELEM) | ~0.007 (KOD-baho) | 99.4% | **TELEM** |
| listening | 2000 (flat) | KOD-baho +TTS | — | **0.0014** (TELEM, TTS siz) + TTS 0.0024-0.0048 (Azure, 150-300 belgi) = ~0.005 | ~0.011 (KOD-baho) | 96–97% | **TELEM** + KOD (`tts/types.ts:421`) |
| podcast | 4000 (flat, 1-5 daq) | ~4-6 LLM (essayga o'xshash) + TTS | LLM: essayga o'xshash | Azure TTS: **0.030 (1 daq) / 0.076 (3 daq) / 0.126 (5 daq)**; **Aisha TTS tanlansa: 0.076/0.258/0.43** (5 daqiqada NARXDAN OSHADI) | +~20% (LLM qismiga) | 60–90% (Azure) / **18% dan MANFIYgacha (Aisha)** | KOD-baho: `audio/types.ts:106-123` (150 so'z/daq), `tts/types.ts:374-376` |
| greeting | 4000 (flat, 1-4 daq) | ~4-6 LLM + TTS | LLM: essayga o'xshash | Azure: 0.03 (1 daq) / 0.10 (4 daq); **Aisha: 0.304-0.344 (4 daqiqada NARXDAN OSHISHI MUMKIN)** | +~20% | 68–90% (Azure) / manfiy bo'lishi mumkin (Aisha) | KOD-baho, xuddi shu manba |

## 3. Tannarx tarkibi (taxminiy foizlar, odatiy hajmda)

| Vosita | Yozuvchi | Baholovchi (judge) | Sayqal | Rasm | TTS |
|---|---|---|---|---|---|
| article/referat/coursework/thesis/essay/test | 70-80% | 15-20% | 5-10% (article/thesis'da avto-sayqal bor) | — | — |
| lesson-plan/glossary/keys/texnologik-xarita | 80-90% | 10-20% | — | — | — |
| slide | 100% (judge yo'q) | 0% | — | 0% (BEPUL stock) | — |
| pro-slide | ~3-5% | 0% | — | **~95-97%** (Gemini rasm dominant xarajat) | — |
| image | ~10% (prompt kengaytirish) | 0% | — | ~90% (fal) | — |
| translation | 100% (judge yo'q, glossariy+partiya) | 0% | — | — | — |
| resume | 100% (judge yo'q, ixtiyoriy) | 0% | — | — | — |
| podcast/greeting | 30-50% (LLM) | 5-10% | 5-10% | — | **40-90%** (TTS, ayniqsa Aisha tanlansa dominant) |
| crossword/flashcards/sorting/listening/infographic | 60-70% | 20-30% | 5-10% | — | (listening: kichik TTS qo'shimcha) |

## 4. Oylik hajm asosida tannarx (30 kun, 89 ish, 460 500 so'm tushum — foydalanuvchi bergan)

Faqat berilgan taqsimot (73/89 ish aniq, qolgan 16 ish taxminiy o'rtacha bilan):

| Vosita | Soni | Daromad (so'm, taxminiy) | Tannarx (USD, Gemini-only, odatiy × soni) | Tannarx (so'm) |
|---|---|---|---|---|
| slide | 26 | ~91 000 (3500/ish) | 26×0.021=0.55 | ~7 000 |
| image | 17 | ~42 500 (2500/ish) | 17×0.008=0.14 | ~1 750 |
| translation | 8 | ~32 000 (4000/ish) | 8×0.03=0.24 | ~3 000 |
| article | 7 | ~42 000 (6000/ish) | 7×0.0585=0.41 | ~5 200 |
| **pro-slide** | 5 | **154 000** (30 800/ish — o'rt. ~15 slayd) | **5×0.83=4.15** | **~52 700** |
| resume | 4 | ~12 000 | 4×0.01=0.04 | ~500 |
| essay | 3 | ~7 500 | 3×0.031=0.09 | ~1 200 |
| lesson-plan | 3 | ~12 000 | 3×0.0078=0.02 | ~300 |
| **Qism jami (73 ish)** | 73 | **~393 000** | **~5.62** | **~71 400** |
| Qolgan ~16 ish (referat/thesis/coursework/o'qituvchi/o'yin/media aralash, taxminan) | 16 | ~67 500 (qoldiq) | ~16×0.03=0.48 (KOD-baho, past-tannarxli vositalar ulushi katta) | ~6 100 |
| **JAMI (89 ish)** | 89 | **460 500 so'm (~$36.3)** | **~$6.1** | **~77 500 so'm** |

**Yalpi foyda (Gemini-only, hozirgi holat) ≈ 460 500 − 77 500 = ~383 000 so'm, yalpi marja ≈ 83%.**

**Diqqat:** pro-slide — hajmda faqat 5/89 (5.6%) buyurtma, lekin daromadning
**33%** (154 000/460 500) va taxminiy oylik tannarxning **~68%** (52 700/77 500)
ini yeydi — chunki u yagona vosita bo'lib, har buyurtmada haqiqiy pullik
Gemini rasm chaqiradi (o'rtacha 12 rasm × $0.067). Agar Claude judge
yoqilsa, bu jadval DEYARLI O'ZGARMAYDI (pro-slide/slide/image/tarjima/rezyume
judgesiz) — qo'shimcha xarajat faqat qolgan 16 ta "matn" ishga tegadi va
taxminan +$0.3-0.6/oy (≈+4 000-7 500 so'm) qo'shadi.

## 5. Muhim noaniqliklar

1. **`eval-out/live/*.doc.json` da cost yo'q** — jonli sinov xarajati faqat
   berilgan `cost_json` telemetriyasidan ma'lum, alohida "Claude judge bilan"
   jonli yozuv topilmadi.
2. **Aisha TTS narxi tasdiqlanmagan** ($80/1M — kodda taxmin, rasmiy sahifada
   yo'q) — agar haqiqiy narx bundan farq qilsa, podcast/greeting marjasi
   butunlay boshqacha bo'lishi mumkin (hozirgi baho: Aisha ovozi baland
   davomiylikda MANFIY marjaga olib kelishi mumkin).
3. **coursework/mustaqil-ish/texnologik-xarita/glossary/keys uchun aniq
   token/chaqiruv soni telemetriyada YO'Q** — referat/lesson-plan
   telemetriyasidan chiziqli skala qilingan, real profillash (`npm run live`,
   og'ir buyruq, shu tahlilchi yurita olmaydi) kerak.
4. **Judge ulushi (15%/20%) taxminiy** — real `cost_json` faqat YIG'INDI
   `provider`/`model`/`usd` saqlaydi (`llm-roles.ts CostMeter.toJson`,
   eng ko'p chiqish tokenli juftlikni "top" deb belgilaydi), ya'ni writer va
   judge ulushini ANIQ ajratib bo'lmaydi — faqat kod (`maxTokens: 1200-1500`
   judge uchun) asosida baholandi.
5. **`SOUM_PER_USD=12700` rasmiy kursdan (11 839.59) ~7% yuqori** — barcha
   USD→so'm hisob shu 12 700 bilan, ya'ni haqiqiy so'm xarajat bu jadvaldagidan
   ~7% KAM bo'lishi mumkin (marja hisobdagidan biroz YUQORIROQ bo'ladi).
6. **fal.ai megapiksel yaxlitlash qoidasi aniq emas** ("yaqin butungacha") —
   `image`/`slide` uchun 1024×576/768 kabi o'lchamlar 0.5-1MP oralig'ida,
   $0.003/rasm baho ±30% xato bilan bo'lishi mumkin.
