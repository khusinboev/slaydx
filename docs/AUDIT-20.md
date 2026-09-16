# AUDIT-20 — O'qituvchi vositalari 2 + Test + o'quv bazasi (1-dastur); umumiy dastur AUDIT-20…23

## 1. Reja (tasdiqlangan 2026-09-16)


## Kontekst

Raqobatchi tahlili (`docs/research/slaydtop-*.md`, sodda.ai/slaydtop.uz) ko'rsatdi: bizda yo'q 9 xizmat (test, atestatsiya, infografika, krossvord, flesh kartalar, tinglash o'yini, saralash o'yini, podkast, tabriknoma) va bizning «O'qituvchi vositalari» bo'limi (dars rejasi, texnologik xarita, glossariy, keys) mahsulotning **eng eski qatlami**: to'g'ridan-to'g'ri Gemini (`lib/generation/llm.ts llmComplete`, rol qatlami/zaxira zanjiri/`CostMeter` yo'q), sifat hisoboti/avto-sayqal/tahrir yo'q (`report/`, `edit-adapters`, `doc-polish` ulanmagan), texnologik xaritada qayta urinish yo'q, keys/dars rejasida `delivered` va jonli holat yo'q, dars rejasida `extra` maydoni e'lon qilinmagan (`extraOptional` o'lik bayroq), ko'ruvchi brend-muqova chizadi, DOCX esa rasmiy shakl (AUDIT-6 A1 ochiq qarori), `structureNeeds`/hajm darvozalari qamramaydi. Oxirgi 10+ sprint faqat talaba/maqola/insho yo'nalishida ketgan.

Maqsad: (1) 4 vositani AUDIT-17/19 darajasiga chiqarish (rasmiy maktab shakllari asosida), (2) 9 yangi xizmatni to'liq mukammal qo'shish, (3) hammasi yirik tadqiqot (rasmiy hujjatlar + raqobatchilar) asosida, o'zbek foydalanuvchilari uchun.

## Mahsulot egasi qarorlari (2026-09-16, qayta so'ralmaydi)

1. **Hammasi kiritiladi**: 4 upgrade (to'liq AUDIT-17/19 darajasi) + 9 yangi xizmat.
2. **Tartib**: 1-dastur — 4 upgrade + Test yaratuvchi + o'quv dasturi bazasi; 2-dastur — krossvord, flesh kartalar, infografika (bosma); 3-dastur — TTS (podkast, tabriknoma, tinglash o'yini) + interaktiv runtime (saralash o'yini; test/krossvord/flesh karta 2-bosqich); 4-dastur — atestatsiya.
3. **O'yin-xizmatlar** — ikki bosqich: avval bosma DOCX/PDF (mavjud quvur), keyin interaktiv web.
4. **O'quv dasturi bazasi** (fan → sinf → mavzu) — o'zimiz quramiz: rasmiy DTS/Milliy o'quv dasturi (2021+) + darslik mundarijalari (uzedu.uz, eduportal, lex.uz); 1–11 sinf, asosiy fanlar; jadval sifatida bazada.
5. **TTS** — avval sinov: Google Cloud TTS (uz-UZ), Azure (uz-UZ), ElevenLabs — namuna audio + narx/daqiqa; egasi eshitib tanlaydi, kalitlarni beradi.
6. **Narx** — raqobatchi darajasi: test 3 000; krossvord/flesh karta/infografika/saralash/tinglash 2 000; podkast/tabriknoma 4 000; atestatsiya keyin; parametrlar narxga ta'sir qilmaydi; tannarx hisobi (`cost_json`, `cost-report`) bilan tekshiriladi. Mavjud 4 vosita narxi o'zgarmaydi.
7. **Bo'limlar**: O'qituvchi vositalari (dars rejasi, texnologik xarita, glossariy, keys, test, infografika, atestatsiya) + **O'yinlar** (krossvord, flesh kartalar, saralash, tinglash) + **Media** (podkast, tabriknoma) — `ToolGroup` kengayadi.
8. **Interaktiv o'yinchi tomoni**: ochiq havola + QR, loginsiz o'ynash (ism kiritadi); natijalar o'qituvchiga (jadval, eksport). Jonli reyting/real-time — yo'q.
9. **Atestatsiya** — rasmiy attestatsiya dasturi mavzulari asosida AI tuzadi (javob + izoh), haqiqiy savollar bazasi da'vo qilinmaydi.
10. **Tadqiqot manbalari** — rasmiy hujjatlar (vazirlik buyruqlari, metodik tavsiyalar, DTS, lex.uz/uzedu.uz/edu.uz) + raqobatchilar (sodda.ai, MagicSchool, Diffit, Quizizz, Kahoot, Twee); chuqur: har vosita uchun alohida hisobot `docs/research/`, 1–2 kun.
11. **Auditoriya** (4 vosita): maktab 1–11 sinf — Milliy o'quv dasturi, dars ishlanmasi shakli.
12. **Ko'rdim = oldim**: sayt = fayl — ko'ruvchi rasmiy DOCX ko'rinishini chizadi (yagona manba `planX`), brend-muqova olib tashlanadi.
13. **Infografika** — vektor plakat: LLM spetsifikatsiyasi → SVG → PNG/PDF (`figures/` kengaytiriladi).
14. Standing qoidalar: `scripts/heavy.sh`, bitta test fayli, ≤3 og'ir jarayon (agentlar `-m 1500M`), «bezak maydon yo'q» (reyestr + zond + mutatsiya), har WP kommit, jonli sinov, Chromium smoke, LibreOffice ko'z, deploy `.claude/deploy.md`; namunaviy kontent egasi hisobiga (`enqueueGeneration`).

## Kod holati (xaritalangan)

- O'qituvchi vositalari: `lib/tools.ts` 4 vosita (`group:"oqituvchi"` → `TEACHER_FIELDS` avtomat), `write-llm.ts:922–925` → `write-specials.ts` (`writeLessonWithLlm/lessonDoc/normalizeMinutes`, `writeGlossaryWithLlm/pickTerms`, `writeKeysWithLlm/rubricBlocks`, `writeMapWithLlm/mapDoc/mapWeeks`; `llmComplete` to'g'ridan-to'g'ri, `CostMeter` yo'q), `index.ts buildArtifact` umumiy DOCX shoxi (`LENGTH_GATED` da yo'q; `delivered` faqat glossary/xarita), `structureNeeds` default [], `docx-profile.ts` `lesson|landscape|reference`, ko'ruvchilar 4 ta alohida (`LessonViewer/TableViewer/GlossaryViewer/KeysViewer`, brend-muqova), `viewers/flow.ts` faqat article|work, `edit-adapters.ts` 5 adapter (teacher yo'q), `doc-polish.ts POLISHERS` article|essay|work; jonli faqat `glossary`, `lesson`; `budget.ts FIXED` 120–150 s; `lesson-plan` da `extra` maydoni yo'q.
- Qayta ishlatiladi: `report/` (`JudgeSpec<C>`, `runPolishWith`, `guardSection`), `llm-roles.ts complete/CostMeter`, `figures/{svg,png,layout-*}.ts` (`figurePng` 300 dpi), `slide-quiz.ts QUIZ_LETTERS/answerIndex`, `prompts.ts sourceBlock`, `SourceFileField`, `lib/extract-text.ts`, `source-upload.ts` (worker faqat `translation` uchun uzatadi — `worker.ts:196`), `lib/professions.ts` + `data/` statik reference naqshi, `lib/server/api.ts` (`handler/requireUser/optionalUser/checkOrigin/limit`), `ratelimit.ts`, `storage.ts` (MIME erkin), `file/route.ts inline=1`, `llm/chain.ts` zanjir naqshi, `*-params.ts` zond, `live-engine.mts CASES`, `seed-demo.mts SAMPLES`; migratsiya oxirgisi `020_article.sql`. Yo'q: middleware, ochiq share/embed route, QR kutubxona, realtime, audio/ffmpeg/TTS.

## 1. R — Tadqiqot bosqichi (1–2 kun, ≤3 parallel agent, sonnet/haiku; R3 opus)

**Hisobot shabloni** `docs/research/<vosita>.md` (≤200 qator, manbasiz da'vo yo'q): (1) rasmiy shakl/standart — hujjat nomi/raqami/sanasi/URL, bo'limlar jadvali (majburiy/ixtiyoriy); (2) raqobatchilar parametrlari — sodda.ai (`slaydtop-*.md`) + xalqaro: parametr → qiymatlar → biz olamizmi (ha/yo'q/keyin) + sabab; (3) bizga tavsiya: reyestr (turlar/parametrlar `id`, chegaralar, standart, `impacts`); (4) sifat mezonlari: hisobot QOIDALARI (`ReviewCheck` id/threshold), `JudgeSpec` mezonlari (3–6, en), halollik chegarasi; (5) namunalar (2–3 haqiqiy hujjat, LLM uchun yaxshi/yomon misol); (6) ochiq savollar / egasidan kerak narsalar.

| Agent | Model | Hisobot | Asosiy manbalar |
|---|---|---|---|
| R1 | sonnet | `lesson-plan.md`, `texnologik-xarita.md` | Milliy o'quv dasturi 2021+ (uzedu.uz), «Dars ishlanmasi» metodik tavsiya (RTM/uzedu), DTS (VM 187/2017, 2021 yangilanish, lex.uz), yillik taqvim-mavzu reja shakli (chorak/soat/mavzu) |
| R2 | sonnet | `glossary.md`, `keys.md` | Keys-stadi metodikasi (TDPU/TATU uslubiy), fan atamalari lug'ati standarti, uch tilli glossariy amaliyoti |
| R3 | opus | `test.md` | DTM test tuzish qoidalari (4/5 variant, distraktor, «hammasi to'g'ri» taqiqi), Bloom (Anderson 2001), qiyinlik taqsimoti, OMR javob varag'i (DTM), BSB/ChSB tartibi (uzedu buyrug'i), Quizizz/Kahoot/MagicSchool/Twee/Diffit eksportlari |
| R4 | sonnet | `curriculum.md` (o'quv bazasi rejasi) | uzedu.uz o'quv dasturlari (fan × sinf PDF), eduportal.uz/kitob.uz darslik mundarijalari, DTS; natija: manba ro'yxati (URL/format/hajm), ≥12 fan × 1–11 sinf, JSON sxema, tekshirish rejasi (soat yig'indisi ↔ rasmiy) |
| R5 | haiku | `crossword.md`, `flashcards.md` | bosma krossvord (to'r 13–21, raqamlash), flesh karta (A4 2×4 = 74×105 mm, duplex), Leitner, Quizlet/Wordwall |
| R6 | sonnet | `infographic.md` | ta'lim plakati kompozitsiyasi (Canva education), A4/A3, WCAG kontrast, ≤120 so'z, ochiq SVG ikonlar (Tabler/Lucide) |
| R7 | sonnet | `tts.md` (TTS sinov rejasi) | Google Cloud TTS `uz-UZ`, Azure `uz-UZ-Madina/SardorNeural`, ElevenLabs multilingual; narx/1M belgi → narx/daqiqa; `scripts/tts-lab.mts` (3 provayder × 60 s namuna → `scratch/`), egasidan 3 kalit; NotebookLM audio overview formati |
| R8 | sonnet | `sorting-game.md`, `listening-game.md`, `podcast.md`, `greeting.md` | Wordwall «Group sort», Kahoot/Blooket o'yinchi oqimi, tinglash (so'z → variantlar), podkast ssenariy (intro/3 blok/outro, 1–5 daq ≈ 150–750 so'z), tabriknoma janrlari |
| R9 | sonnet | `attestation.md` | Attestatsiya nizomi (VM/vazirlik, lex.uz), fan bo'yicha attestatsiya DASTURI mavzulari, savol shakli (test + izoh), Milliy sertifikat farqi |

«Tadqiqotdan keyin aniqlanadi»: dars ishlanmasi/xarita turlari va bo'limlari (R1 → `teacher/registry.ts`), test savol turlari/Bloom/OMR (R3), o'quv bazasi sxemasi va fan ro'yxati (R4), TTS provayder/ovoz (R7 — egasi tanlaydi), infografika bloklari (R6), attestatsiya mavzulari mavjudligi (R9). Lead hisobotlarni 1 soatda ko'zdan kechiradi, reyestrga o'tkazadi.

## 2. 1-dastur (AUDIT-20) — O'qituvchi vositalari 2 + Test + o'quv bazasi

**Arxitektura — BITTA `lib/generation/teacher/` dvigateli** (`work/` naqshi): 5 vosita (lesson-plan, texnologik-xarita, glossary, keys, test) bitta qobiq (hisobot/sayqal/tahrir/adapter/composer/`planTeacher` bir yo'l), har vosita **o'z modeli** va o'z engine fayli.

```
lib/generation/teacher/
  types.ts      TeacherKind = lesson|map|glossary|keys|test; TeacherModel = AcademicDoc.teacher =
                { kind, school:{institution,author,subject,grade,language}, lesson?|map?|glossary?|keys?|test?, review?, polish?, userNeeds? }
                LessonModel {type, goal:{talim,tarbiya,rivoj}, competencies[], equipment[], stages[{title,minutes,teacher,student,method,result}], homework, assessment}
                MapModel {type, quarters[{n, weeks[{n, topic, hours, method, resources, control}]}]}
                GlossaryModel {terms[{term, def, example?, ru?, en?}], order}
                KeysModel {cases[{title, situation, questions[], solution, rubric[]}]}
                TestModel {mode: topic|file|curriculum, questions[], variants[{id, order[]}], key, omr, bloom, difficulty}
  registry.ts   kind × tur (R1–R3 dan), skelet, guidance[], JudgeSpec, hajm chegaralari
  input.ts · prompts.ts (en tizim + TYPE RULES + sourceBlock + curriculumBlock) · engine.ts (buildTeacherDoc → lesson.ts/map.ts/glossary.ts/keys.ts/test/engine.ts; complete("writer"|"judge"|"fast") + CostMeter; xarita chorak bo'yicha mapPool(2) + qayta urinish; review → polish)
  lesson.ts / map.ts / glossary.ts / keys.ts   (write-specials.ts dan ko'chirilgan sof mantiq)
  test/{types,questions,omr,prompts,engine,review}.ts
  review.ts (kind bo'yicha qoidalar + judge) · polish.ts (runPolishWith, acceptDelta +1)
  layout.ts     planTeacher(doc) — YAGONA MANBA (rasmiy shapka, brend-muqova YO'Q, landscape?)
  edit.ts       TeacherOp (ArticleOp qismi) · legacy.ts (legacyTeacherModel — faqat o'qish) · samples.ts
lib/generation/teacher-params.ts   reyestr + zond
lib/curriculum.ts + data/curriculum/{index.json, <subject>.json} + data/CURRICULUM-SOURCES.md
```

**Test dvigateli**: `Question {id, kind: single|multi|truefalse|open|match, stem, options[], answer, bloom, difficulty, explanation}`; `questions.ts` — normalizatsiya (`answerIndex`/`QUIZ_LETTERS`), dublikat/«hammasi to'g'ri» filtri, seeded shuffle → `variants` (A/B), `key` variant bo'yicha; `omr.ts` — javoblar varag'i SVG → `figurePng` → `figure` blok; qiyinlik/Bloom taqsimoti reyestrdan (R3); fayl rejimi `sourceBlock` — savollar faqat manbadan; darslik rejimi — `curriculum` mavzular promptga. Hisobot qoidalari: count, oneCorrect, optionCount, noDuplicates, difficultyMix, bloomCoverage, stemLength, sourceGrounded, keyMatchesVariants; judge: clarity, distractors, coverage, levelFit. `delivered` savol soni. Narx 3 000 tekis.

**Upgrade 4 vosita**: `write-llm.ts` → `buildTeacherDoc` (eski `write-specials.ts` shoxi `TEACHER_ENGINE=0` bilan bir sprint qoladi); `llmComplete` → `complete`; `CostMeter` → `cost_json`; xarita qayta urinish + `delivered` (hafta), glossary (atama), keys (keys soni), lesson (daqiqa yig'indisi hisobotda); `structureNeeds` teacher shoxlari; darvoza element soni bo'yicha; `lesson-plan` `extra` reyestrga; `budget.ts teacherBudgetMs(kind, n)`.

**Render/paritet**: `docx-profile.ts teacherProfile(kind)` (lesson portret, xarita landscape, test portret, kalit yangi betdan); `render-docx.ts drawTeacher(plan)`; `title-model.ts` maktab shapkasi («Tasdiqlayman», muassasa, fan, sinf, tuzuvchi — R1 shakli); `viewers/flow.ts teacherFlow(plan)` → `WordViewer` (`metrics.ts` landscape); **4 eski ko'ruvchi o'chadi**, `viewerKind` → `teacher`; eski hujjatlar `legacyTeacherModel`; `ArtifactViewer case "teacher"` tahrir proplari bilan.

**Tahrir/sayqal**: `edit-adapters.ts teacherAdapter` (5 vosita; legacy 409), `doc-polish.ts POLISHERS.teacher`, `components/files/useTeacherEdit.ts`, `ResultView` review `?? doc.teacher?.review`, `hrefBase` `/uz/<vosita>#…`.

**Forma**: bitta `components/forms/TeacherComposer.tsx` (`custom:"teacher"`): mavzu/rejim (test: mavzu | fayl `SourceFileField` | darslik `CurriculumPicker` `Combobox` ← `/api/curriculum`), fan/sinf/til/davomiylik yoki soatlar, shapka (muassasa, tuzuvchi, «Tasdiqlayman» lavozimi), ▸ Sozlamalar (tur, savol soni 10/20/30, savol turlari, qiyinlik, variantlar 1/2, Bloom, OMR, atama soni, extra). Har maydon `teacher-params.ts` da (zond). `CUSTOM_REQUIRED.teacher` = university + author. `validate.ts JSON_FIELDS` += `TEACHER_JSON_FIELDS`. Fayl rejimi: worker `sourceForJob` `tool.modes` bo'lgan har vosita uchun (`worker.ts:196`).

**O'quv bazasi — statik `data/curriculum/` + `lib/curriculum.ts`** (professions naqshi, migratsiya yo'q): faqat o'qiladi, gitda ko'rib chiqiladi, deploy = kod; ≈12 fan × 11 sinf × 40–70 mavzu (~1.5 MB) klient bandliga KIRMAYDI — `index.json` (fan×sinf, ~5 KB) klientga, mavzular `GET /api/curriculum?subject=&grade=` (`handler`, 60/min). Sxema (R4): `{subject:{id,uz,ru,en}, grade, source:{title,url,year}, units:[{title, topics:[{id,title,hours?,quarter?}]}]}`. `scripts/fetch-curriculum.mts` (PDF/DOCX → `extractFromBuffer`, kesh), `scripts/gen-curriculum.mts` (LLM faqat normalizatsiya, `--dry/--only`), `tests/curriculum.test.mts` (id unikal, soat yig'indisi ± rasmiy, bo'sh mavzu yo'q). Dars rejasi/xarita formasi ham tanlovni ixtiyoriy oladi.

| Raund | WP | Kim | Egalik | Testlar (taxm.) | Mutatsiya | Kun |
|---|---|---|---|---|---|---|
| R0 | Substrat: `teacher/types.ts`, `registry.ts` skeleti, `AcademicDoc.teacher`, `ToolGroup`/`ToolId`, `tools.ts` test vositasi (`custom:"teacher"`, 3 000) + 5 vositada `custom`, `viewerKind teacher`, `budget.ts teacherBudgetMs`, `lib/curriculum.ts` + `index.json` | lead | shu fayllar | `teacher-registry` 8, `pricing` +3, `viewer-kind` +2, `curriculum` 6 | ≥3 | 1 |
| R1 | **WP-A dvigatel** (lesson/map/glossary/keys): `engine.ts`, 4 kind fayli, `prompts.ts`, `input.ts`, `review.ts`, `polish.ts`; `write-specials.ts` dan ko'chirish, `write-llm.ts` shoxi | agent (opus) | `teacher/**` (test/, layout, edit dan tashqari), `write-llm.ts` | `teacher-engine` 16, `teacher-review` 14, `teacher-polish` 8, `teacher-input` 8 | ≥5 | 2.5 |
| R1 | **WP-B test dvigateli + curriculum yig'ish**: `teacher/test/**`, `omr.ts`, `scripts/*curriculum*`, `data/curriculum/*` (≥6 fan to'liq) | agent (opus) | shu fayllar | `teacher-test-questions` 14, `-engine` 10, `-review` 10, `teacher-omr` 6, `curriculum-data` 8 | ≥5 | 2.5 |
| R1 | **WP-C render+paritet+legacy**: `layout.ts planTeacher`, `legacy.ts`, `docx-profile.ts`, `render-docx.ts drawTeacher`, `title-model.ts`, `viewers/flow.ts`, `metrics.ts` landscape, `WordViewer`, 4 eski ko'ruvchi o'chadi | agent (opus) | shu fayllar | `teacher-layout` 14, `teacher-docx` 10 (LibreOffice), `viewer/teacher-parity` 10, `viewer/teacher-legacy` 6 | ≥5 | 2 |
| R2 | **WP-D tahrir + server**: `teacher/edit.ts`, `edit-adapters.ts`, `doc-polish.ts`, `useTeacherEdit.ts`, `ResultView`, `assets.ts` (OMR PNG), `preview.ts`, `worker.ts` source, `/api/curriculum` | agent (opus) | shu fayllar | `teacher-edit` 12, `teacher-commit` 6, `curriculum-route` 4, `ui/teacher-viewer-edit` 8 | ≥4 | 1.5 |
| R2 | **WP-E forma**: `TeacherComposer.tsx`, `CurriculumPicker.tsx`, `ToolWorkspace` dispatch, `teacher-params.ts`, `validate.ts` | agent (sonnet) | shu fayllar | `ui/teacher-composer` 14, `viewer/teacher-form` 4, zond 3 | ≥3 | 1.5 |
| R2 | **WP-F ulash**: `index.ts` (darvozalar, `delivered`, `suffix`), `structure.ts`, `delivered.ts`, `i18n.ts`, `live-engine.mts` 6 holat, `seed-demo.mts` | lead | shu fayllar | `generation` +6, `delivered` +4 | ≥3 | 1 |
| R3 | Integratsiya: jonli, smoke (`pw/teacher20.mjs`), ko'z, docs (`AUDIT-20.md`, `structure.md`, `CLAUDE.md`), deploy | lead | — | — | — | 1.5 |

Jami ≈ 12 kun ish, kalendar ~7 kun (+ R bosqichi 1–2 kun). **Xavflar**: X-1 rasmiy shakl variantlari → reyestrda `type`, standart = uzedu; X-2 baza to'liqmas → `curriculum` rejimi faqat mavjud fan/sinfda; X-3 test distraktor sifati → judge + qoidalar, fayl rejimida manbasiz savol o'chadi; X-4 landscape `WordViewer` o'lchovi → paritet testi; X-5 eski hujjatlar → legacy faqat o'qish; X-6 `write-specials.ts` o'chishi → `TEACHER_ENGINE=0` bir sprint; X-7 OMR PNG worker shriftlari (`dockerfile-fonts` qulfi bor).

## 3. 2-dastur (AUDIT-21) — krossvord + flesh kartalar + infografika (bosma)

- **Krossvord** (`crossword`, O'yinlar, 2 000, docx): LLM faqat so'z+ta'rif (5/10/15/20, mavzu/fayl), to'r **sof algoritm** `lib/generation/games/crossword/grid.ts` (greedy + backtracking, kesishma ≥1, maks 21×21, seeded; sig'magan so'z tashlanadi → `delivered`), `svg.ts` → `figurePng` → mavjud `figure` blok (`FigureSpec kind:"svg"` — tayyor SVG); model `AcademicDoc.game = {kind:"crossword", words[], grid, clues}`, `games/layout.ts planGame` → `drawGame`/`gameFlow`. Javoblar yangi betdan.
- **Flesh kartalar** (`flashcards`, 2 000): `game.cards[{front, back, hint?}]` 5/10/15/20; `drawCards` — DOCX jadval 2×4 (74×105 mm), old betlar + orqa betlar oynali (duplex); ko'ruvchi shu jadval.
- **Infografika** (`infographic`, O'qituvchi, 2 000, png): LLM spetsifikatsiya `{title, subtitle, blocks[3–6]{icon, heading, text≤40 so'z, stat?}, palette}` → `figures/layout-infographic.ts` (A4 portret) + `figures/icons.ts` (≤40 SVG path) → `figureSvg` → `figurePng` (A4 @300 dpi) → `packImages`/`ImageViewer`; PDF — bir betlik DOCX o'rami (tadqiqotdan keyin).
- WP (≈6 kun): R0 lead — `ToolGroup "oyinlar"`, 3 vosita, `AcademicDoc.game`, `FigureSpec svg`, narx (1); WP-A opus — grid/svg + engine (`crossword-grid` 16, mutatsiya ≥5) (2); WP-B sonnet — flashcards + `drawCards`/flow + paritet (1.5); WP-C opus — infografika layout + ikonlar + quvur + ko'z (2); R lead — forma (`StandardForm` + `modes` yetadi, zond `game-params.ts`), jonli 3, smoke, deploy (1).

## 4. 3-dastur (AUDIT-22) — TTS + interaktiv runtime

- **TTS adapteri** `lib/generation/tts/{types,google,azure,elevenlabs,chain}.ts` (`llm/chain.ts` naqshi: `TTS_VOICE=provider:voice,…` zanjir, `synthesize(text,{lang,voice,speed}) → {mp3, seconds, chars}`, `TtsMeter` → `cost_json`, `env.ts` kalitlari, `compose-env` qulfi); uzun matn 4 500 belgili bo'laklar; MP3 birlashtirish — CBR frame konkatenatsiya (`tts/mp3.ts`), aks holda `ffmpeg` (tadqiqotdan keyin).
- **Vositalar** (Media, 4 000): `podcast` (mavzu/matn/fayl, 1–5 daq, ssenariy → 1–2 ovoz → MP3), `greeting` (kimga/sabab/til/1–4 daq); `ToolConfig.output`/`Generation.format` += `mp3`, `ViewerKind "audio"` → `AudioViewer.tsx` (`<audio src=…/file?inline=1>` + transkript), model `AcademicDoc.audio = {script[{speaker,text}], seconds, voice}`, `delivered` soniya.
- **Interaktiv runtime**: `021_games.sql` — `game_sessions(id, generation_id, user_id, token unique, kind, settings_json, expires_at)` + `game_results(id, session_id, player_name, score, total, answers_json, seconds, ip_hash)`; ochiq `app/o/[token]/page.tsx` (noindex) + `app/api/o/[token]` (GET — `publicGameView(doc)`: to'g'ri javob CHIQMAYDI; `submit` POST `checkOrigin` + `rateLimit` 30/daq, ball serverda); egasi `POST /api/generations/[id]/share`, `results` (jadval + CSV), `ResultView` «O'yin havolasi + QR» (`qrcode` npm, SVG); `components/game/{Player,Sorting,Listening,Quiz,Crossword,Cards}.tsx` + `lib/game/engine.ts` (sof holat mashinasi, jsdom testlari). Saralash (`sorting`, 2 000): `game.sorting = {categories[2–20]{name, items[]}}`, bosma versiya jadval. Tinglash (`listening`, 2 000): so'z/ibora → TTS parchalar (`putAssetBytes`), o'yinchi variant tanlaydi.
- WP (≈9–10 kun): R0 lead — TTS lab/egasi tanlovi, migratsiya, `mp3`, `ToolGroup "media"` (1); WP-A opus — `tts/**` + podcast/greeting + `AudioViewer` (2.5); WP-B opus — sessions/results + ochiq API + `publicGameView` (javob sizmasligi — mutatsiya majburiy) (2); WP-C sonnet — o'yinchi UI 5 tur + `lib/game/engine.ts` (2.5); WP-D sonnet — saralash/tinglash dvigateli + bosma (1.5); R lead — QR/natijalar paneli, jonli, smoke (havola → ism → o'yin → natija egasida), deploy (1.5).

## 5. 4-dastur (AUDIT-23) — Atestatsiya (≈3 kun)

`attestation` (O'qituvchi, narx egasi bilan — taxmin 3 000): `data/attestation/<subject>.json` (R9 rasmiy dastur mavzulari; yo'q fanlarda `curriculum`), `teacher/test/` `kind:"attestation"` — savol + javob + izoh majburiy, 20/30/50, pedagogika/metodika + fan bloklari; DOCX + 3-dastur runtime orqali interaktiv; hisobotda «rasmiy savollar bazasi emas» izohi. WP: lead 1 (data + reyestr), sonnet 1.5 (prompt/review/live), lead 0.5 (deploy).

## 6. Umumiy

- `lib/types.ts` `ToolGroup = "umumiy"|"talaba"|"oqituvchi"|"oyinlar"|"media"`; `TEACHER_FIELDS` avtomat faqat `custom` bo'lmagan `oqituvchi` vositalarga; landing/nav guruh yorliqlari (`CreateGrid`, `Sidebar`).
- Narx (`priceFor` tekis `basePrice`): test 3 000; krossvord/flesh/infografika/saralash/tinglash 2 000; podkast/tabriknoma 4 000; atestatsiya TBD; mavjud 4 o'zgarmaydi; har dastur oxirida `cost-report` marja (TTS belgi narxi `cost_json` da).
- `CLAUDE.md` yagona manba jadvali: O'qituvchi hujjatlari → `teacher/layout.ts planTeacher` (`drawTeacher` + `teacherFlow`); O'yin hujjati → `games/layout.ts planGame`; Infografika → `figures/layout-infographic.ts`; Ochiq o'yin ko'rinishi → `lib/game/public.ts publicGameView`. `.claude/structure.md`, `docs/AUDIT-20…23.md` (§1 reja, §5 bajarilish, §6 ochiq), memory.
- Deploy (`.claude/deploy.md`): zaxira → `.env` (TTS kalitlari — 3-dastur) → compose env + `compose-env` testi → migratsiya (021 — 3-dastur) → `nohup deploy.sh` → prod smoke (eski dars rejasi/xarita/glossary/keys ochilishi — legacy; yangi test; `/o/<token>` loginsiz).

## 7. Tekshirish (har dastur)

- **Unit/mutatsiya** (bitta fayl, `heavy.sh`): 1 — daqiqa normalizatsiyasi, hafta ↔ `delivered`, bitta to'g'ri javob, A/B kaliti mos, Bloom qamrovi, fayl rejimida manbasiz savol, landscape paritet, legacy o'qish, adapter tanlovi, zond «bezak maydon»; 2 — kesishmasiz so'z rad, to'r chegarasi, duplex orqa tartib, infografika matn chegarasi; 3 — ochiq API da to'g'ri javob YO'Q, token bo'lmasa 404, rate-limit, ball serverda, MP3 uzunligi; 4 — izoh majburiy.
- **Jonli** (`npm run live -- …`): 1 — `lesson`, `map`, `glossary`, `keys`, `test-topic`, `test-file --source`, `test-curriculum` (hisobot >0, `cost.calls>0`, `delivered`, bet soni); 2 — `crossword`, `flashcards`, `infographic` (PNG ko'z); 3 — `podcast`, `greeting`, `listening` (MP3 ≥ 0.8× daqiqa); 4 — `attestation`.
- **Chromium smoke** (scratch `pw/*.mjs`, dev 3111 + worker): forma → natija → hisobot → «Hammasini tuzatish» → tahrir → DOCX; 3-dasturda loginsiz kontekst `/o/<token>` → ism → o'yin → natija egasida; 0 brauzer xatosi.
- **LibreOffice ko'z**: 1 — shapka («Tasdiqlayman»), pasport jadvali, bosqich jadvali landscape, kalit alohida bet, OMR; 2 — to'r raqamlari, karta kesish chiziqlari, duplex; 4 — izoh formati.
- **Deploy**: yuqoridagi tartib; prod smoke egasi hisobida (`enqueueGeneration`).

## Birinchi qadam (tasdiqdan keyin)

R bosqichi: 9 tadqiqot agenti 3 tadan parallel (R1/R3/R4 → R2/R6/R7 → R5/R8/R9), hisobotlar `docs/research/`; TTS lab uchun egasidan 3 provayder kaliti; hisobotlar lead ko'rigidan o'tgach AUDIT-20 R0 substrat boshlanadi.

### Tadqiqotdan keyingi qarorlar (2026-09-16, egasi + lead)

- **Test**: variantlar 1/2/4 tanlov, standart 2 (A/B); BSB/ChSB uslubidagi tur ham 3 000 tekis; `FigureSpec kind:"omr"` (strukturaviy: count, optionCount, columns, variantIds, idBoxes) R0 da; `TestModel` ga `scoring`, `instructions`, `timeMin`, `topicIds`, `criteria` (BSB mezon jadvali), savolda `source.quote`, `points`, `optionOrder[]`; `bsb`/`chsb` turlari ochiq topshiriq + rubrika; 20 hisobot qoidasi + judge `answerCorrectness`; GIFT eksporti keyin (AUDIT-22 bilan); 1–4 sinf 3 variant, rasmli savollar AUDIT-21+; `curriculum` rejimi faqat bazada mavjud fan/sinfda (X-2); rasmiy BSB/ChSB materiallari Markazniki — hujjatda «BSB uslubida» izohi (halollik).
- **Dars rejasi / xarita / keys**: rasmiy yagona blank yo'q — amaldagi konvensiya (tadqiqot jadvallari) reyestrga; `lesson-plan` ga `extra`, `sinf harfi`, `sana` maydonlari; xaritaga `choraklik` turi (4 jadval) + `yillik`; `pickMapControl` LLM javobidan (fallback saqlanadi); keys turlari tahliliy/muammoli/qaror/rolli, `caseCount` narxsiz, `audience` (maktab/OTM) rubrika shkalasi uchun.
- **Glossariy**: `type` uch-tilli (uz/ru/en) narx o'zgarmasdan, `includeExample` standart yoqiq, `noStubDefinition` qoidasi; fayl rejimi keyin.
- **O'quv bazasi**: uzbmb.uz rasmiy RTM dasturlari (`curl -k`) + 121-son buyruq (2025-04-10) soat jadvali; mavzu darajasida soat yo'q (bob darajasida); versiyalash (`version` maydoni) — yangi DTS loyihasi 2026-08 (X-1); 1–4 sinf va informatika manbalari WP-B da qo'shimcha qidiriladi.
- **Infografika**: alohida `figures/infographic-svg.ts` (rangli; `svg.ts` monoxrom o'zgarmaydi), Tabler Icons (MIT), 6 palitra, 7 tur — AUDIT-21.

## 5. Bajarilish yozuvi

- **R — tadqiqot (9 agent, 3 tadan parallel, ~2 soat)**: 15 hisobot `docs/research/` (lesson-plan, texnologik-xarita, glossary, keys, test, curriculum, infographic, crossword, flashcards, tts, sorting-game, listening-game, podcast, greeting, attestation). Asosiy topilmalar: rasmiy yagona blank yo'q (dars ishlanmasi/xarita/keys — amaldagi konvensiya); test — MMTV 248-son (2023) BSB/ChSB tartibi, 86/66/30 shkala, rasmiy BSB materiallari Markazniki (halollik izohi), DTM 4 variant; o'quv bazasi — uzbmb.uz RTM PDF dasturlari + 121-son (2025) soat jadvali, yangi DTS loyihasi 2026-08 (versiyalash); TTS — Google/ElevenLabs/Gemini da o'zbek ovozi YO'Q, faqat Azure `uz-UZ` va mahalliy Aisha AI (WAV, 1 000 belgi); attestatsiya — VM 572-son (2021), 40 fan + 10 pedagogika, mavzular = curriculum + pedagogika ro'yxati; Wordwall Group Sort leaderboardsiz (qaror 8 ga mos). Egasi qarorlari — §1 «Tadqiqotdan keyingi qarorlar».
- **R0 (opus agent, 2 kommit, `8fabe09`)** — substrat: `teacher/types.ts` (5 kind modeli, `TestModel` R3 tuzatishlari bilan, `TEACHER_LIMITS`, variant 1/2/4 standart 2, 1–4 sinf 3 javob), `registry.ts` (21 tur, guidance, `JudgeSpec`, `TEACHER_RULE_IDS`), `engine.ts` stub (null → eski yo'l), `FigureSpec kind:"omr"`, `ToolId test`/`ToolGroup oyinlar|media`/`custom teacher`, `tools.ts` test 3 000 + 5 vositada `custom:"teacher"` (`TEACHER_FIELDS` faqat custom bo'lmaganlarga), `viewerKind teacher`, `budget.ts teacherBudgetMs`, `write-llm.ts` dispatch, `lib/curriculum.ts` + `data/curriculum/{index,matematika}.json` + `/api/curriculum`, `teacher-params.ts` (38 param). Testlar: teacher-registry 10, teacher-params 3, curriculum 7, pricing +3, viewer-kind +2, work-wiring +2, client-boundary +1; 6 mutatsiya. Ochiq (WP-E gacha deploy YO'Q): 4 vosita formasi `fields: []` — maydonlar composer'da; `test` vositasi dvigatelsiz ko'rinadi (WP-B gacha); soat diapazoni serverda (`teacher/input.ts`); xarita `topic` (WP-E); curriculum `FILES` jadvali qo'lda.
### WP-A — 4 vosita dvigateli (dars rejasi / xarita / glossariy / keys), 2026-09-16

**Holat:** bajarildi (jonli sinov va ko'z — R3 raundida, lead).

**Fayllar** (`lib/generation/teacher/`): `input.ts`, `prompts.ts`,
`guard.ts`, `lesson.ts`, `map.ts`, `glossary.ts`, `keys.ts`,
`engine.ts` (stub → to'liq), `review.ts`, `polish.ts`;
`lib/generation/write-llm.ts` (dispatch). `types.ts` ga ikki maydon
(izoh bilan). Testlar: `tests/teacher-{input,engine,review,polish}.test.mts`.

**Bo'lim id SHARTNOMASI** — WP-C `planTeacher` shunga tayanadi, WP-D
tahrir oplari ham shu id larni ko'radi:

| kind | bo'limlar | jadvallar |
|---|---|---|
| lesson | `passport` · `goal` · `stages` · `homework` · `assessment`? | 1 ta, `anchor: "stages"` (`timeCols`) |
| map (yillik) | `passport` · `year` | 1 ta, `anchor: "year"` (`yearCols`) |
| map (choraklik) | `passport` · `q1` · `q2` · `q3` · `q4` | 4 ta, `anchor: "q1".."q4"` |
| glossary | `intro` · `terms` | `uch-tilli` da 1 ta (`Atama \| Ruscha \| Inglizcha`), `anchor: "terms"` |
| keys | `intro` · `case1`..`caseN` · `rubric` | yo'q |

`assessment` bo'limi turning skeleti talab qilsa (`nazorat`, `amaliy`)
yoki `assessmentStyle=bsb` tanlansa chiqadi. Sayqal/tahrir nishoni
sifatida JADVAL ham qo'llab-quvvatlanadi: `table:<n>` (`review.ts
tableTarget`/`parseTableTarget`) — xaritada hujjatning butun mazmuni
jadvalda va bo'lim matnini qayta yozish u yerda hech nimani tuzatmaydi.

**Testlar:** `teacher-input` 12, `teacher-engine` 26, `teacher-review` 23,
`teacher-polish` 13 — jami 74. `generation` (62) va `document` (62)
yashil, eski `write-specials` testlari saqlangan (X-6: eski yo'l bir
sprint qoladi, `TEACHER_ENGINE=0`).

**Mutatsiya 7/7:** daqiqa yig'indisi tsikli, hafta ↔ soat klampi,
`noStubDefinition` birinchi belgisi, rubrika ball normalizatsiyasi,
`acceptDelta` standarti, jadval qator soni tekshiruvi, alifbo tartibi.
Ikkitasi birinchi urinishda OMON QOLGAN va testlar shu sababli
tuzatilgan: hafta soni `weeksFor` ning o'zi bilan solishtirilardi
(tavtologiya), stub ta'rif esa qoidaning ikkinchi shoxi bilan ushlanib,
birinchisi sinovsiz qolardi.

**Reja bo'yicha bajarilgan qarorlar:** `choraklik` xarita (4 jadval,
`mapPool(2)` bilan chorak bo'yicha so'rov), `control` ustuni LLM
javobidan (`fallbackControl` faqat bo'sh ustunda), `lesson-plan` ga
`extra`/sinf harfi/sana, maqsad uchligi, o'qituvchi va o'quvchi
ustunlari, `uch-tilli` glossariy, `includeExample`, `noStubDefinition`,
keys turlari + `caseCount` + `audience`, rubrika 10 ball, halollik
chegarasi (darslik sahifasi/dastur bandi/real tashkilot uydirilmaydi)
beshala promptda va `teacherUserNeeds` bandida.

**Ikki model maydoni qo'shildi** (R0 `types.ts`, izoh bilan):
`MapWeek.result` — `sectionLabels.yearCols` allaqachon «Kutilgan
natija» ustunini e'lon qiladi va eski `mapDoc` ham uni chizardi, R0
modelida tushib qolgan edi; `GlossaryModel.includeExample` — hisobot
hujjatdan QAYTA hisoblanadi (tahrirdan keyin ham) va `exampleCoverage`
bandi bu bayroqsiz «misol so'ralmagan» bilan «model bermagan» ni
ajrata olmaydi.

**Jim nuqson topildi va tuzatildi:** `teacherInputFromValues` son
maydonlarini `DocMeta` dan o'qiganda REYESTR standartlari HECH QACHON
ishlamas edi — `extractMeta` ularga o'z standartini qo'yadi
(`duration: 45`, `grade: 8`, `termCount: 10`, `weeklyHours: 4`) va u
hech qachon `undefined` bo'lmaydi. Ya'ni «amaliy dars 90 daqiqa» va
«imtihon atamalari 20 ta» kabi tur qarorlari qisman bezak edi. Endi
son maydonlari faqat `values` dan o'qiladi.

**WP-A dan qolgan ochiq bandlar:**

1. `delivered` — dvigatel `built.delivered` ni QAYTARADI, lekin
   `lib/generation/delivered.ts` hali `deliveredCount` (eski, `h3`
   sanog'i va `mapWeeks`) bilan ishlaydi — ULASH WP-F da. Shu paytgacha
   `uch-tilli` glossariy uchun eski hisob to'g'ri ishlaydi, chunki
   atamalar matnda `h3` bo'lib qolgan (jadval QO'SHIMCHA, nusxa emas).
2. Uch tilli jadval ustunlari reyestr skeletida «Atama \| Ta'rif \| Ru
   \| En» deb yozilgan, amalda esa «Atama \| Ruscha \| Inglizcha» —
   ta'rif yuqorida to'liq turibdi va uni jadvalda kesib takrorlash
   aynan AUDIT-6 B5 da olib tashlangan naqsh. WP-C maketi bilan
   kelishilishi kerak (skeletni tuzatamizmi yoki ustun qaytariladimi).
3. Keys rubrikasi ALOHIDA `rubric` bo'limida (tadqiqot skeletida har
   keys ichida edi) — reja §1 dagi id shartnomasiga mos, lekin WP-C
   maketi buni alohida bet qilib chizadimi yoki keys yoniga
   qaytaradimi — lead qarori.
4. `curriculumBlock` dars rejasi va xarita uchun ULANGAN, lekin forma
   (WP-E) hozircha `subjectId`/`topicIds` yubormaydi — darslik rejimi
   shu ikki vositada faqat WP-E dan keyin ko'rinadi.
5. Jonli sinov (`npm run live -- lesson|map|glossary|keys`) va
   LibreOffice ko'z — WP-C maketi kelgandan keyin, R3 raundida.

### WP-B — test dvigateli + o'quv dasturi bazasi (2026-09-16)

**Fayllar.** `lib/generation/teacher/test/`: `questions.ts`
(normalizatsiya, seeded variantlar, kalit, ball), `omr.ts` (spec),
`input.ts` (forma → `TestInput`, reyestr chegaralari), `prompts.ts`
(en tizim + tur qoidalari + `sourceBlock`/`curriculumBlock`),
`engine.ts` (`buildTestDoc`), `review.ts` (20 qoida + baholovchi),
`export.ts` (GIFT), `labels.ts` (hujjat tili yorliqlari).
`lib/generation/figures/omr.ts` — javoblar varag'ining SVG maketi;
`figures/index.ts` ning `omr` shoxi endi PNG chizadi (180 mm @ 300 dpi).
`scripts/{fetch,gen}-curriculum.mts`, `data/curriculum/` (8 fayl +
indeks), `data/CURRICULUM-SOURCES.md`.

**`buildTestDoc` imzosi** — WP-A shartnomasi (`TeacherBuilder`) bilan
AYNI: `buildTestDoc(meta: DocMeta, values: FormValues, opts:
TestBuildOpts) → Promise<TeacherBuilt | null>`, bunda `TestBuildOpts =
TeacherBuildOpts & { buildFigures?, topics?, sourceTextOf?, seed? }`
(hammasi ixtiyoriy test seam lari). `TeacherBuilt` da `delivered =
{got: savol soni, want: count}` va `opts.onCost(cost)`.

**Bosqichlar** (`onStage`): reja 0→8 · savollar 8→60 (10 talik bo'lak,
`mapPool(2)`) · yig'ish 60→70 · hisobot 70→85 · sayqal 85→100.

**Qarorlar.**
- Variantlar YANGI savol yaratmaydi — bitta savol bazasi + seeded
  Fisher–Yates (qiyinlik pariteti kafolatlanadi, `variantParity`).
- To'g'ri javob harflari aylanma ro'yxatdan olinadi, ya'ni `keyBalance`
  ± 1 savol KAFOLATLANGAN, tasodifga tashlanmagan.
- Sayqal rejasidagi barcha «Tuzatish» bandlari BITTA fix ga
  birlashtiriladi: hammasi `questions` nishoniga tegadi, parallel qayta
  yozish bir-birini yo'q qilardi.
- `explanationPresent` qoidasi reyestrga qo'shildi (R3 §4.1 ning 20-si).
- OMR PNG `doc.teacher.figures` da (`TeacherModel.figures` qo'shildi) —
  `data:` URL ni `sections` ichida saqlash tahrir va qidiruvni
  og'irlashtirardi; `assets.ts` (WP-D) shu ro'yxatdan o'qiydi.

**Baza qamrovi** (8 fan · 42 fan×sinf · 311 bob · 2 424 mavzu, 480 KB):

| Fan | Sinflar | Bob | Mavzu |
|---|---|---|---|
| matematika | 5, 6, 7, 8, 10, 11 | 80 | 425 |
| fizika | 6–11 | 43 | 318 |
| kimyo | 7–11 | 29 | 210 |
| biologiya | 5–11 | 49 | 333 |
| geografiya | 5–10 | 40 | 419 |
| tarix | 5, 6 | 15 | 128 |
| jahon-tarixi | 7–11 | 26 | 289 |
| ozbekiston-tarixi | 7–11 | 29 | 302 |

Bo'shliqlar manbaning o'zida: matematika 9-sinf va geografiya 11-sinf
fayllari sahifada YO'Q; matematika 6–7 bitta hujjatda; tarix 7-sinfdan
ikkiga bo'lingan. Hech biri to'ldirilmadi (`hasCurriculum` yo'q deydi).

**Testlar.** `teacher-test-questions` 18, `teacher-test-engine` 17,
`teacher-test-review` 18, `teacher-omr` 8, `curriculum-data` 11 — jami
72 yangi test. Mutatsiyalar (har biri qizardi): javob indeksi chegarasi,
harf aylanasi, `optionOrder` siz kalit, `difficultyTargets` yaxlitlash,
blanket variant filtri, ball qoldig'i, `omrSpecOf` da ochiq savol, OMR
PNG shoxi, `assignPoints` siz bsb ball, sayqaldan keyin eski kalit,
ochiq topshiriqlar bo'lakka tarqalmasligi, fayl rejimida manba
uzatilmasligi, `difficultyMix` toleransi, `scoreSum` bazasi, `keyTrust`
chegarasi, `dedupe` siz takroriy id, uslubiy nasr filtri, bob soatining
yillik soat deb olinishi.

**Ochiq savollar / keyingi ish.**
1. Tayanch o'quv reja (121-son buyruq) PDF i 502 — bob soatlari
   dasturning O'ZIDA e'lon qilingan yillik soatga solishtiriladi (42
   dan 25 tasida bor). Boshqa barqaror ko'zgu topilsa test qattiqlashadi.
2. Format B hujjatlarida mavzu chegarasi qator uzilishi bilan
   topiladi — ba'zi mavzu ikkiga bo'linadi. `gen-curriculum.mts --llm`
   buni tozalaydi, lekin joriy baza LLM SIZ yig'ilgan (kalit/byudjet
   qarori egasiniki).
3. 1–4-sinf, informatika, ona tili/adabiyot, chet tillari bazada yo'q
   (R4 X-3) — manba formati boshqacha, alohida ish.
4. GIFT eksporti (`test/export.ts`) yozildi, lekin CHIQISHGA ulanmagan
   (tugma/fayl — AUDIT-22 reja bo'yicha).
5. `tests/work-wiring.test.mts` dagi «teacher shoxi» assertion i
   WP-A ning `if (built) return built.doc;` bir qatorli shakliga
   moslandi (mutatsiya qo'riqchisi saqlandi).
6. Jonli sinov (`npm run live -- test-topic|test-file|test-curriculum`)
   va OMR ning LibreOffice ko'z tekshiruvi — WP-C maketidan keyin.
### WP-C — render + paritet + legacy (maket, DOCX, ko'ruvchi), 2026-09-16

**Holat:** bajarildi. Jonli sinov (`npm run live`) — R3 raundida, lead.

**Fayllar:** `lib/generation/teacher/{layout,legacy,samples}.ts` (yangi),
`docx-profile.ts` (`teacherProfile(kind)` + `profileFor` shoxi),
`render-docx.ts` (`drawTeacher` + `renderDocx` shoxi),
`lib/viewers/{flow,metrics,paginate}.ts`,
`components/viewers/{WordViewer,ArtifactViewer}.tsx`,
`lib/viewers/kind.ts`. **O'CHIRILDI:** `components/viewers/
{LessonViewer,TableViewer,GlossaryViewer,KeysViewer}.tsx`.

**Qaror 12 bajarildi — «sayt = fayl»:** titul beti ham, brend-muqova
ham YO'Q. Hujjat birinchi betning O'ZIDAGI rasmiy shapka bilan
boshlanadi: «Tasdiqlayman» + lavozim + imzo chizig'i O'NG YUQORIDA,
ostida muassasa va hujjat nomi markazda, keyin «Fan: … Sinf: 7-A …
Tuzuvchi: … Sana: …» qatorlari (yorliq qalin). `teacherProfile(kind)
.titlePage === "none"`, `teacherFlow` esa `type:"title"` bandini umuman
chiqarmaydi. Uch auditda ochiq qolgan AUDIT-6 A1 / AUDIT-5 P1-5 shu
bilan yopildi.

**`planTeacher(doc)` — yagona manba.** Tartib: sarlavha → bo'lim
BLOKLARI (dvigatel nasri) → langarlangan JADVALLAR → (faqat bo'lim
bo'sh bo'lsa) modeldan qurilgan ZAXIRA. Zaxira yo'l qo'lda yig'ilgan
hujjat, namuna va `test` vositasi (WP-B gacha) uchun; dvigatel chiqishi
kelganda o'z-o'zidan o'chadi va matn IKKI MARTA chizilmaydi.
Yo'nalish: xarita ALBOM, qolgan to'rttasi portret. Sahifa uzilishi
FAQAT testda (har variant, kalit, OMR) — dars ishlanmasi 1–2 bet va
har bo'limni betga chiqarish qog'ozni behuda sarflardi.

**WP-A shartnomasi bilan kelishildi** (WP-A ochiq bandlari 2–3):
uch tilli jadval ustunlari «Atama \| Ruscha \| Inglizcha» bo'lib
QOLADI (ta'rif yuqoridagi ro'yxatda, jadvalda takrorlanmaydi — AUDIT-6
B5); keys rubrikasi alohida `rubric` bo'limi bo'lib qoladi va alohida
bet TALAB QILMAYDI. Reyestr skeleti matnini WP-F tuzatsin.

**Testlar:** `teacher-layout` 24, `teacher-docx` 17 (LibreOffice: 5 kind
→ PDF, bet soni va yo'nalish), `viewer/teacher-parity` 13 (5 kind ×
TO'LIQ matn pariteti + ru/en), `viewer/teacher-legacy` 14. Mutatsiya 8
tasi ham ushlandi (shapka, albom, kalit sahifa uzilishi, legacy model,
alifbo, ko'ruvchi shapkasi, javob chiziqlari, titul beti).

**LibreOffice ko'zi (5 kind → PDF → PNG) topgan va tuzatilgan 4 nuqson:**

1. **Ochiq savol javob chiziqlari BIRLASHIB ketardi** — pastki
   chegarali ketma-ket bo'sh paragraflarni LibreOffice bitta blokka
   qo'shib, chiziqni faqat oxirida chizardi (4 chiziq o'rniga 1,
   ustida katta bo'sh joy). Endi chegarasiz jadvalning qatorlari.
2. **Kalit jadvalida «Variant A» sarlavhasi ikki qatorga sinardi** —
   `columnPercents` 6 ustunli bu jadvalni tanimaydi va teng taqsimlab
   qo'yardi. Ustun kengliklari endi aniq beriladi.
3. **Pasport bo'limi SHAPKANI takrorlardi** — dvigatel «Fan: … Sinf: …
   Davomiyligi: …» ni qayta yozadi (eski shaklda shapka yo'q edi).
   Paragraf FAQAT shapkadagi juftlardan iborat bo'lsa tashlanadi;
   qo'shimcha fakt bo'lsa («Haftalar: 12») butunligicha qoladi — matn
   hech qachon qayta yozilmaydi (tahrir yo'li saqlangan matnga tayanadi).
4. **«1. Fan pasporti»** — `sectionLabels.subjectPassport` dagi eski
   raqam sarlavhada qolardi, qolgan bo'limlar esa raqamsiz edi.

**Eski hujjatlar (X-5):** `legacyTeacherModel(doc)` shapkani `meta` dan
tiklaydi (muassasa `meta.university` dan), kind modelini BO'SH
qoldiradi — ya'ni zaxira yo'l hech narsa qo'shmaydi va hujjat
avvalgidek «sarlavha + bloklar + langarlangan jadval» bo'lib chiqadi.
`tests/document.test.mts` ning 62 testi O'ZGARISHSIZ yashil qoldi.
«Tasdiqlayman» eski hujjatda YO'Q edi — o'ylab topilmaydi.

**WP-D uchun `TeacherPlan` shartnomasi:** har `head`/`body` bandida
`path` bor — nasr `sections.<i>.blocks.<j>`, hujjat jadvali `table:<n>`
(`review.ts tableTarget` bilan AYNI), modeldan qurilgan band
`teacher.<kind>.<...>`. `plan.tablePaths` jadval id → yo'l xaritasi,
`plan.legacy` esa tahrir 409 qaytarishi kerakligini bildiradi.

**WP-C dan qolgan ochiq bandlar:**

1. **OMR PNG**: `TeacherModel` da sxema ombori yo'q, shuning uchun
   `planTeacher` hozircha o'rinbosar ramka chizadi. WP-B/WP-D PNG ni
   aktiv sifatida bergach, `figure` bandiga payload qo'shiladi —
   shartnoma o'zgarmaydi.
2. **Test bo'lim tartibi**: reja §1 id lari `instructions · variantX ·
   key · criteria · omr`, tadqiqot (`test.md` §3.7) esa OMR ni kalitdan
   OLDIN qo'yadi (o'quvchiga tarqatiladigan qism birga tursin). Maket
   id tartibiga ergashdi — WP-B bilan tasdiqlansin.
3. **`match` savoli**: `options` ikki ro'yxatni ketma-ket saqlaydi deb
   o'qilyapti (chap yarmi / o'ng yarmi) — WP-B shartnomani aniq
   yozsin.
4. **`tests/work-wiring.test.mts` qizil** (WP-C emas): R0 testi
   `write-llm.ts` da `if (built) {` blokini kutadi, WP-A esa uni
   `if (built) return built.doc;` qilib qisqartirgan. Semantika
   to'g'ri, test matni eskirgan — `write-llm.ts` egasi yangilasin.
5. **`teacher/lesson.ts` da metod yorlig'i** — bosqich metodikasi
   «Bosqich: Suhbat» bo'lib chiqadi (`L.stage` = «Bosqich»). Ko'z
   tekshiruvida noto'g'ri o'qiladi; yorliq WP-A egaligida.
### WP-E — forma (`TeacherComposer` + `CurriculumPicker`), 2026-09-16

**Holat:** bajarildi (unit/jsdom/SSR sathida; jonli sinov va ko'z R3
raundida, WP-C maket kelgandan keyin — WP-A ochiq band 5 bilan bir xil).

**Fayllar:** `components/forms/TeacherComposer.tsx` (bitta forma, 5
vosita — `lesson-plan`/`texnologik-xarita`/`glossary`/`keys`/`test`),
`components/forms/CurriculumPicker.tsx` (fan → sinf → mavzular ≤5),
`components/forms/ToolWorkspace.tsx` (`custom === "teacher"` dispatch
qatori), `lib/api-client.ts` (`fetchCurriculumTopics`),
`lib/generation/teacher-params.ts` (`translationLangs` probe tuzatildi
— pastda), `tests/{teacher-params,client-boundary}.test.mts`,
`tests/ui/teacher-composer.test.mts`, `tests/viewer/teacher-form.test.mts`.

**Forma tuzilishi** (`WorkComposer` naqshi — kartalar, `useFormDraft`,
`runGeneration`): Karta 1 «Mavzu va rejim» — `topic` (test kindda
rejim `topic` bo'lmasa yashirin), test uchun `mode` segmentli plitkalar
(mavzu/fayl/darslik dasturi) + shartli `SourceFileField`/
`CurriculumPicker`; lesson/map uchun ixtiyoriy `CurriculumPicker`
doim ko'rinadi (alohida yoqish tugmasisiz — fan tanlanmasa `subjectId`/
`topicIds` bo'sh yuboriladi). Karta 2 «Fan, sinf, til» — `subject`
(mapda `topic` o'zgarganda avtomatik ko'chiriladi, `subjectTouched`
bilan qo'lda bekor qilinadi — «Xarita: topic = fan nomi, ikkalasi
yuboriladi»), `grade`, shartli `gradeLetter` (lesson/test),
`language`, «Tur» segmentli tile (`teacherTypesOf(kind)`, hint bilan,
`data-field` kindga xos nom — `lessonType`/`mapType`/`glossaryType`/
`keysType`/`testType`), keyin kind-ga xos sozlamalar (dars rejasi:
davomiylik/bosqich/kompetensiya/baholash; xarita: haftalik-yillik soat
(klient + server diapazon)/nazorat ustuni; glossariy: atama soni (narx
chipi bilan)/misol/tarjima tillari (faqat `uch-tilli`); keys: keyslar
soni/auditoriya; test: savol soni/ochiq savol/soni savol turlari
(turga cheklangan)/qiyinlik/variantlar/OMR/javoblar kaliti/mezon
jadvali (faqat BSB/ChSB)/vaqt). «Shapka» — `university`/`author`
majburiy, shartli `approver`/`date`. «Qo'shimcha» — `extra`.

**`uiFromValues` ↔ `toValues` yagona manba:** umumiy + lesson/map/
glossary/keys qismi `teacherInputFromValues`/`encodeTeacherValues`
(`teacher/input.ts`) orqali — `teacher/input.ts` o'zgartirilmadi
(ownership: faqat nom nomuvofiqligida minimal tuzatish ruxsat edi,
kerak bo'lmadi). **Ochiq topilma (muhim):** test vositasining o'ziga
xos maydonlari — `mode`, `count`, `openCount`, `questionKinds`,
`difficulty`, `variants`, `omr`, `answerKey`, `criteriaTable`,
`timeMin` — `TeacherInput` tipida HALI YO'Q, chunki test dvigateli
(WP-B, `teacher/test/**`) hali yozilmagan (`engine.ts` faqat lesson/
map/glossary/keys ni biladi). Composer bu 10 maydonni **bevosita**
`FormValues` orqali o'qiydi/yozadi (izohli, `TeacherComposer.tsx`
boshida). `testType` va `topicIds`/`sourceText` esa ALLAQACHON ishlaydi
— `teacherTypeIdOf`/`parseTeacherList` chaqiruvlari kind ga qaramay
umumiy hisoblanadi. WP-B ulanganda bu 10 maydon `teacher/input.ts`ga
ko'chishi va `teacher-params.test.mts`dagi `ENGINE_NOT_WIRED` ro'yxati
bo'shashi kerak — reyestrdan O'CHIRILMAGAN, faqat belgilangan.

**`CurriculumPicker`:** `lib/curriculum.ts curriculumIndex()` klient
tomonida TO'G'RIDAN-TO'G'RI (statik `index.json`, tarmoqsiz) — alohida
`?index=1` route KERAK EMASLIGI R0 dayoq hal qilingan (fayl o'zi
izomorf yozilgan, WP-E buni tekshirdi va tasdiqladi). Mavzular
`GET /api/curriculum?subject=&grade=` (yangi `fetchCurriculumTopics`
helper, `lib/api-client.ts`). Faqat `hasCurriculum` fan/sinf ko'rinadi.

**Topilgan va tuzatilgan nuqson:** `teacher-params.ts`dagi
`translationLangs` probeA=`""`/probeB=`"ru,en"` juftligi
`teacherInputFromValues` orqali BIR XIL natija berardi — bo'sh tanlov
`uch-tilli` turida RUXSAT ETILGAN BARCHA tillarga (`["ru","en"]`)
tushadi, probeB esa aynan shu ikkalasini so'raydi. Differensial zond
buni RED holatda ushladi (`tests/teacher-params.test.mts`, mutatsiya
bilan qayta tasdiqlangan); probeB `"ru"` ga tuzatildi.

**Testlar:** `ui/teacher-composer` 16 (qamrov ×2, dispatch, tur
almashish chegarasi, test rejim tilalari, `CurriculumPicker` mock
fetch + topicIds, narx, shartli maydonlar ×2 mutatsiya bilan, savol
soni chegara siqilishi, qoralama saqlash+tiklash, required, «Tozalash»,
to'liq submit); `viewer/teacher-form` 5 (SSR qamrov, 5 standart tur,
narx, profil prefill, dispatch predikati); `teacher-params` zond — R0
dagi 3 + WP-E dagi 2 yangi (differensial `teacherInputFromValues`,
ochiq topilma ro'yxati). **Mutatsiya 3/3 tasdiqlangan** (qizil →
tuzatish/tiklash → yashil): (1) `translationLangs` probe juftligi —
yuqorida; (2) `criteriaTable` ko'rinish sharti (`t.limits.criteriaTable`
olib tashlansa `ui/teacher-composer` testi qizardi); (3) `omr`
`data-field` olib tashlansa qamrov testi qizardi.

**Regressiya (yashil):** `ui/work-composer` 30, `ui/article-composer`
19, `viewer/{teacher,work,article}-form` 17, `pricing`+`client-boundary`
35 (`teacher-params` bilan birga), to'liq `npm run test:viewer` 174 va
`npm run test:ui` 225. `tsc --noEmit` va `eslint` toza.

**Pre-existing, WP-E dan tashqari topilma:** to'liq `npm test` (1 828
dan 1) da `tests/work-wiring.test.mts` — «write-llm: teacher shoxi
`null` da eski `write-specials.ts` yo'liga TUSHADI» qizil chiqadi:
`write-llm.ts` (WP-A, `4adcf31`) kod matni endi `if (built) return
built.doc;` (bitta qator), test esa eski `if (built) {` blok shaklini
kutadi. WP-E bu faylga tegmagan (`teacher/{engine,layout,edit}` va
`write-llm.ts` — boshqa WP egaligida), lead/WP-A qaytishida tuzatilishi
kerak.

**WP-E dan qolgan ochiq bandlar:**

1. Test dvigateli maydonlari (`mode`/`count`/`openCount`/
   `questionKinds`/`difficulty`/`variants`/`omr`/`answerKey`/
   `criteriaTable`/`timeMin`) — WP-B ulanganda `teacher/input.ts`ga
   ko'chirilishi kerak (yuqorida batafsil).
2. Jonli sinov (`npm run live`) va brauzer smoke (AUDIT-11 lesson) —
   WP-C maketi va WP-B dvigateli kelgandan keyin, R3 raundida (WP-A
   bilan bir xil sabab: hozir test/xarita/lesson dvigatelisiz yoki
   makatsiz DOCX chiqmaydi).
3. Karta joylashuvi lead tomonidan tasdiqlangan reja bilan bir-birga
   ozgina farq qiladi: `subject` (fan nomi) topshiriqda Karta 3
   (shapka) ostida ko'rsatilgan edi, WP-E uni Karta 2 «Fan, sinf, til»
   ga qo'ydi (mantiqiy guruhlash — shapka faqat muassasa/tuzuvchi/
   tasdiqlovchi/sana). Funksional farq yo'q, faqat joylashuv.
4. «Bezak maydon» topilmadi — har 38 parametr kamida bitta jsdom yoki
   SSR testda ko'rinadi va kind ga xos maydonlar shartli
   ko'rinish/qiymat orqali tasdiqlangan (band 1 dagi 10 tasidan
   tashqari, ular dvigatelsiz «bezak» emas — WP-B kutmoqda, izohli).

### WP-F — ulash (darvoza, delivered, yorliq, jonli holat), 2026-09-16

**Holat:** bajarildi (jonli 7 holat YOZILDI, lekin ISHGA TUSHIRILMADI —
LLM sarfi lead qarori, R3 raundida).

**Fayllar.** `lib/generation/index.ts` (`teacherGateFail`, `fileSuffix`,
`pageGateApplies` istisnosi), `lib/generation/structure.ts`
(`teacher:<id>` talab turi, kind bo'yicha bo'lim shartnomasi),
`lib/generation/delivered.ts` (`deliveredCount` teacher shoxi),
`lib/generation/i18n.ts` (`teacherExtraLabels`, `teacherSectionLabel`),
`lib/generation/teacher/prompts.ts` (yorliqlar `i18n.ts` dan — bitta
manba), `lib/server/worker.ts` (manba fayl sharti), `scripts/live-engine.mts`
(7 holat + `--list`), `scripts/seed-demo.mts` (5 namuna).
Testlar: `tests/teacher-wiring.test.mts` 14, `tests/delivered.test.mts` 6.

**Darvoza qoidalari** (hajm SO'Z bilan emas — `LENGTH_GATED` da beshala
vosita ATAYIN yo'q, `pageGateApplies` ularda `false`):

| kind | qoida | konstanta |
|---|---|---|
| lesson | bosqich ≥ tur minimumi (reyestr) VA \|Σ daqiqa − davomiylik\| ≤ 5 | `TEACHER_MINUTES_TOLERANCE` |
| map | hafta ≥ 0.9 × `weeksFor(haftalik, jami)`; `choraklik` da 4 chorak | `MAP_WEEK_RATIO` |
| glossary | atama ≥ 0.7 × `termCount` | `TEACHER_COUNT_RATIO` |
| keys | keys ≥ 0.7 × `caseCount` | `TEACHER_COUNT_RATIO` |
| test | savol ≥ 0.8 × `count` VA har variant kaliti savol soniga teng | `TEST_COUNT_RATIO` |

Nisbatlar `delivered` floori bilan AYNI (0.70) — pastda xato + to'liq
qaytarish, floor va va'da orasida farq qaytariladi. Testda 0.80: test
BAHOLASH quroli va 20 savolga mo'ljallangan ball shkalasi 12 savolda
boshqa ish bo'lib qoladi. Xaritada 0.90: xarita YILNI qoplaydi.

Daqiqa toleransi 0 EMAS, chunki `guard.ts normalizeMinutes` yig'indini
aynan `duration` ga tenglashtiradi — 0 tolerans dvigatel ishlaganda
hech qachon ishlamas edi. Darvoza DVIGATELDAN KEYINGI qadamlarni
qo'riqlaydi: avto-sayqal bosqichni qayta yozsa yoki foydalanuvchi
tahrir qilsa, 45 daqiqalik dars 60 daqiqaga aylanib ketishi mumkin.

**Bo'lim id SHARTNOMASI** (`hard`; WP-A jadvalidan chiqarilgan):

| kind | qat'iy bo'limlar | qat'iy EMAS |
|---|---|---|
| lesson | `passport` · `goal` · `stages` · `homework` | `assessment` (tur/uslub tanlovi) |
| map (yillik) | `passport` · `year` | — |
| map (choraklik) | `passport` · `q1`..`q4` | — |
| glossary | `terms` | `intro` (muqaddima, mazmun emas) |
| keys | `intro` · `case1` · `rubric` | `case2..caseN` (`delivered` o'lchaydi) |
| test | `instructions` · `variant-<id>` (har variant) | `key`/`criteria`/`omr` (forma tanlovi) |

Talab `doc.teacher` BOR bo'lgandagina qo'yiladi: eski yo'l
(`TEACHER_ENGINE=0`, `write-specials.ts`, bazadagi eski `doc_json`)
boshqa bo'lim id lari bilan yozadi va yangi shartnoma bilan o'lchansa
to'rtala xizmat ham o'lardi. Shu sabab `structureNeeds` endi ikkinchi,
IXTIYORIY parametr (`doc`) oladi — xarita bo'limlari turga, test
bo'limlari variant soniga bog'liq va ularni `meta` dan bilib bo'lmaydi.

**`built.delivered` shakli va yagona manba.** Dvigatel
(`TeacherBuilt.delivered`) va `deliveredCount` ikkalasi ham
`{got, want, unit}` qaytaradi, lekin YOZUVCHISI bitta:
`writeWithLlm` shartnomasi `AcademicDoc | null` bo'lgani uchun
`built.delivered` `index.ts` ga YETIB BORMAYDI, shuning uchun miqdor
hujjatdan (`doc.teacher`) QAYTA hisoblanadi — bu bir vaqtning o'zida
to'g'riroq ham: sayqal va tahrirdan keyingi holatni ko'rsatadi.
Va'da (`want`) esa `values` dan, `teacher/input.ts` orqali — dvigatel
ishlatgan aynan o'sha reyestr chegaralari bilan. Shuning uchun
`deliveredCount` uchinchi, ixtiyoriy `values` parametrini oldi.

Eski hisob ikki joyda JIM XATO berardi: `uch-tilli` glossariyda
atamalar jadvalda TAKRORLANADI (`h3` + jadval), `choraklik` xaritada
esa `tables[0]` yilning atigi choragi — to'liq bajarilgan 34 haftalik
xarita «9 hafta» bo'lib ko'rinar va pulning uchdan ikki qismi
qaytarilardi. Keys va testda umuman o'lchov yo'q edi. Dars rejasida
miqdor va'dasi YO'Q (narx bosqich soniga bog'lanmagan).

**Yorliqlar bitta manbada.** WP-A vaqtincha `teacher/prompts.ts` ichida
saqlagan `EXTRA` jadvali `i18n.ts teacherExtraLabels` ga ko'chdi;
`teacherLabels` o'z joyida qoldi, chunki u KONTEKST yig'uvchisi
(`sectionLabels` + extra + til kodi). Qo'shilgan qatorlar: WP-C shapkasi
(«Tasdiqlayman», «Tuzuvchi», «Sana», «Variant», «Javoblar kaliti»,
«Ko'rsatma») va `delivered` birliklari (hafta/atama/keys/savol) —
uz/ru/en. «Sinf» va «Baholash mezonlari» QO'SHILMADI: ular allaqachon
`SectionLabels` da (`fieldGrade`, `rubric`). `teacherSectionLabel(id)`
bo'lim id ni o'zbekcha nomga o'giradi — tuzilma darvozasi yiqilganda
foydalanuvchi «`stages` yo'q» emas, «„Dars bosqichlari“ bo'limi yo'q»
degan xabarni ko'radi.

**Fayl nomi:** `-dars`, `-xarita`, `-glossariy`, `-keys`, `-test`
(`fileSuffix`). Ilgari faqat ikkitasi bor edi va bitta jildga yuklangan
uchta hujjat brauzerda `(1)`, `(2)` bo'lib raqamlanardi.

**Worker:** manba fayl endi `tool.modes` e'lon qilgan HAR vositaga
uzatiladi. `tool.id === "translation"` sharti forma VA'DA QILGAN fayl
rejimini jimgina o'chirardi — test vositasi «faylingizdan test tuzaman»
deb yuklatib, testni mavzu nomidan yozardi.

**Jonli holatlar (7, `npm run live`):** `lesson`, `map` (yillik 34
hafta), `map-quarters` (4 chorak, 4 jadval), `glossary` (uch tilli 20
atama), `keys` (5 keys, rubrika 10 ball), `test-topic` (20 savol, 2
variant, OMR PNG, hisobot ≥ 55, `keyMatchesVariants`), `test-file`
(`--source <docx>` → `sourceGrounded`), `test-curriculum` (fizika
8-sinf, 5 mavzu → `curriculumCoverage`). Har holatda umumiy blok
(`teacherChecks`): `doc.teacher` bor, hisobot bali > 0, `cost.calls > 0`,
`delivered` va'daga mos, DOCX bet chegarada. `doc.json` `eval-out/live/`
ga yoziladi (WP-C maketi va ko'ruvchi paritetini LLM sarfisiz qayta
o'lchash uchun urug'). Yangi `--list` bayrog'i holatlarni CHAQIRUVSIZ
ko'rsatadi.

**Testlar.** `teacher-wiring` 14, `delivered` 6; `generation` (62),
`document` (62), `work-wiring`, `teacher-engine` (26),
`teacher-test-engine` (17) yashil. Mutatsiya 6/6 qizardi: daqiqa
toleransi 5→10, test nisbati 0.8→0.7, xarita haftasi faqat
1-chorakdan (darvozada), bo'sh bo'lim «bor» deb sanalishi,
`delivered` da hafta `tables[0]` dan, `delivered` teacher shoxi
o'chirilishi.

**Ochiq savollar / keyingi ish.**
1. **Jonli 7 holat ishga tushirilmadi** — LLM sarfi lead qarori
   (R3). `test-file` uchun `--source <fayl.docx>` namunasi ham kerak.
2. **Bet chegaralari vaqtinchalik** (`TEACHER_PAGES`): WP-C
   `planTeacher` maketi bu worktree'da yo'q va DOCX umumiy shox bilan
   chizilmoqda. Maket kelgach chegaralar toraytiriladi, LibreOffice
   ko'zi bilan.
3. **`keys` ning `rubric` bo'limi QAT'IY qilindi** — WP-A ochiq bandi 3
   (WP-C uni alohida bet qiladimi yoki keys yoniga qaytaradimi) hali
   yopilmagan. Bo'lim ID i o'zgarsa, shartnoma ham o'zgaradi.
4. **`test/labels.ts` va `i18n.ts` qisman ustma-ust**: «Ko'rsatma»,
   «Javoblar kaliti», «Variant» ikkala jadvalda ham bor (qiymatlari
   bir xil). WP-B fayli hujjat TANASI uchun, `i18n.ts` esa WP-C
   SHAPKASI uchun — birlashtirish WP-C maketidan keyin, u qaysinisini
   o'qishini ko'rgach.
5. **`encodeTeacherValues` test kindini bilmaydi** (`teacher/input.ts`
   faqat 4 kind uchun teskari yo'l beradi), shuning uchun
   `seed-demo.mts` da `test` namunasi qo'lda yozildi. Forma qoralamasi
   (WP-E) shu funksiyani test uchun ham talab qiladi.
6. **`deliveredCount(meta, doc)` uchinchi parametrsiz chaqirilsa**
   (eski chaqiruvchi, boshqa modul) teacher hujjatida va'da REYESTR
   STANDARTI bilan hisoblanadi. Hozir yagona chaqiruvchi `index.ts` va
   u `values` ni uzatadi; yangi chaqiruvchi qo'shilsa shu shart
   eslansin.

### WP-D — tahrir + server (op tili, adapter, sayqal, aktivlar, ko'ruvchi), 2026-09-16

**Yetkazildi:** `lib/generation/teacher/edit.ts` (yangi), `polish.ts`
(`apply` → `applyTeacherOps`, glossariy uchun tuzilmali qayta yozish),
`prompts.ts` (`method` yorlig'i, `glossaryRewritePrompt`), `guard.ts`
(`glossaryTermBlocks`/`glossaryTriTable`), `glossary.ts`, `lesson.ts`,
`samples.ts`, `layout.ts` (kichik bandlar), `test/engine.ts`;
`lib/server/{edit-adapters,doc-polish,article-rewrite,assets,preview}.ts`;
`components/files/{useTeacherEdit.ts,ResultView.tsx}`,
`components/viewers/{ArticleEditor,WordViewer,ArtifactViewer}.tsx`.

#### `TeacherOp` shartnomasi

`ArticleOp` ning QISMI (`refRemove`/`abstract`/`highlights` yo'q):
`text` · `heading` · `cell` · `caption` · `blockRemove` · `blockInsert`
· `setSection` · `set` · `review` (oxirgisini FAQAT server yozadi —
`parseTeacherOps` uni rad etadi).

Yo'llar `planTeacher` bilan bitta manbadan:

| nishon | yo'l | qayerga yoziladi |
|---|---|---|
| nasr bloki | `sections.<i>.blocks.<j>` | blok + (xarita bo'lsa) model |
| hujjat jadvali | `table:<n>` (`review.ts tableTarget`) | katak + model |
| model bandi | `teacher.<kind>.<...>` | model |
| shapkadagi mavzu | `meta.topic` | `doc.meta` + pasport takrori |

**Reja DARVOZASI:** har op yo'li `planTeacher` bergan yo'llar to'plami
bilan solishtiriladi — ekranda ko'rinmagan bandni tahrirlab bo'lmaydi.
Bu «`teacherFlow` band id lari `plan.body` bilan bir-bir» kafolatining
ikkinchi yarmi (birinchisi — `teacherEditTargets`, u ham AYNI rejani
yuradi).

**`text` opi FAQAT satrli maydonni o'zgartiradi.** Rejada ko'rinadigan,
lekin son/sanov bo'lgan maydonlar (`school.grade`, `lesson.durationMin`,
`map.weeklyHours`, `test.scoring.total`, `bloom`, `difficulty`) rad
etiladi — ular formada (WP-E). Sabab: hisobot arifmetikasi (`minutesSum`,
`scoreSum`, `variantParity`) shu sonlarga tayanadi.

#### model ⇄ sections izchilligi (WP-D ning asosiy ishi)

Dvigatel nasrni ham, modelni ham yozadi; hisobot/prompt/«Tuzatish» esa
MODELDAN o'qiydi. Uch joyda sinxron ushlanadi:

1. **nasr → model** (`teacherMirrors`): blok indeksidan model yo'liga
   xarita, dvigatel yozgan TARTIB bo'yicha qurilgan (matn tahlil
   qilinmaydi). Qamrov: lesson (`passport`/`goal`/`stages`/`homework`/
   `assessment`), glossary (`terms`), keys (`caseN`/`rubric`), test
   (`instructions`/`variant-X`/`key`). Shakl mos kelmasa o'sha bo'lim
   xaritasi BUTUNLAY tashlanadi — sinxronni yo'qotish noto'g'ri
   maydonga yozishdan xavfsizroq.
2. **jadval katagi → model**: faqat TAHRIRLANGAN katak. Butun jadvalni
   qayta hisoblash mumkin emas edi — dars jadvali modelni `clip(…, 44)`
   bilan kesib saqlaydi.
3. **shapka → pasport takrori**: `isHeadRecap` paragrafni faqat aynan
   mos kelganda tashlaydi, ya'ni shapka maydoni o'zgargach eski takror
   ekranda DUBLIKAT bo'lib chiqardi.

`setSection` (sayqal yo'li) modelli bo'limda ham izchil: glossariyda
atamalar bloklardan QAYTA o'qiladi (uch tilli jadval ham shu
ro'yxatdan, `ru`/`en` eski modeldan atama nomi bo'yicha ko'chadi),
boshqa modelli bo'limlarda tuzilma buzilgan qayta yozish 422 bilan rad
etiladi va hujjat O'ZGARMAY qoladi.

#### Server

- `teacherAdapter` — BESHALA vosita bitta adapterda (`TEACHER_TOOL_LIST`
  reyestridan). Eski hujjat (`doc.teacher` yo'q) 409 `legacy`:
  `legacyTeacherModel` modelni TAXMIN qiladi, ya'ni model yo'llari
  kafolatlanmaydi.
- `POLISHERS.teacher` — «Hammasini tuzatish». Sayqal tili
  (`setSection`/`setTable`) adapter tiliga `teacherOpsFromPolish` bilan
  o'giriladi (insho `toOps` i naqshi).
- `rewriteTeacher` (`article-rewrite.ts`) — bandma-band «Tuzatish»:
  nishon bo'lim id yoki `table:<n>`, hisobot qoidalar bilan qayta
  hisoblanadi, baholovchi ballari avvalgisidan ko'chadi, kredit
  yechilmaydi.
- `assets.ts` — `doc.teacher.figures` (OMR PNG) aktivga; usiz
  `doc_json` da `data:` qolib, tahrirdan keyingi rebuild blankani
  yo'qotardi.
- `preview.ts` — o'qituvchi eskizi (hujjat nomi + mavzu + fan + birinchi
  band). Generik ajratgich pasport TAKRORINI olardi va beshta karta bir
  xil ko'rinardi.

#### Ko'ruvchi

`useTeacherEdit` (`useWorkEdit` naqshi) + `WordViewer` uchinchi hook +
`teacherEditTargets(plan, items)`. Nishon REJADAN olinadi; model yo'li
nishon bo'ladi FAQAT satrli maydonda, yorliq `h3` si va matni bir xil
yo'lga ega bo'lsa («Javob kaliti» sarlavhasi va yechim matni) OXIRGISI
qoladi. `ResultView` hisobotni `doc.teacher.review` dan ham o'qiydi;
`hrefBase` `/uz/${gen.type}` allaqachon o'qituvchi vosita id sini beradi.

#### WP-C ochiq bandlari — yopildi

1. **OMR PNG** — `planTeacher` figure bandiga `figure` payload'i
   (`model.figures`); `drawTeacher` va `teacherFlow` uni allaqachon
   o'qiydi, ya'ni blanka endi chiziladi.
2. **Test bo'lim tartibi** — OMR KALITDAN OLDIN (o'quvchi qismi birga):
   `instructions · variantX · omr · key · criteria`. `test/engine.ts`
   ALLAQACHON shunday yozardi; `TEACHER_SECTION_IDS` va `samples.ts`
   esa `omr` ni oxirida ko'rsatib, hech qachon yaratilmaydigan tartibni
   qulflab qo'ygan edi (shuning uchun `teacher-layout`/`teacher-docx`
   dagi uzilish kutilmalari ham yangilandi).
3. **`match` savoli** — `options` chap+o'ng ro'yxat sifatida o'qilishi
   `layout.ts` da aniq yozilgan (ikki ustunli jadval); shartnoma
   o'zgarmadi.
5. **«Bosqich: Suhbat» → «Metod:»** — yorliq `teacherLabels.method`
   (`prompts.ts`, yagona manba: maket ham shuni o'qiydi), `L.stage`
   emas. `lesson.ts` va `samples.ts` tuzatildi.

(4-band — `work-wiring` testi — WP-D egaligida emas, tegilmadi.)

#### Jonli/ko'z tekshiruvidan kelgan tuzatishlar

- **Glossariy sayqal korruptsiyasi (jonli):** `terms` bo'limi nasr
  sifatida qayta yozilganda `blocksFromLlm` `h3` sarlavhalarni `p` ga
  aylantirib, 20 atamadan 18 tasining NOMI yo'qolgan; model esa
  o'zgarmagani uchun hisobot yolg'on yashil ko'rsatardi. Ikki tomondan
  yopildi: sayqal endi MODEL shaklini so'raydi
  (`glossaryRewritePrompt`, bloklarni `glossaryTermBlocks` yig'adi,
  atama soni o'zgarsa 422), `setSection` esa modelga izchil yozadi yoki
  rad etadi. Sayqal op lari BITTALAB qo'llanadi — rad etilgan bo'lim
  o'zgarmay qoladi va qolgan tuzatishlar yo'qolmaydi (tahrir PATCH i
  avvalgidek ATOMAR).
- **TEST 1-bet:** «F.I.Sh. ___ Sinf ___ …» qatori IKKI marta chizilardi
  (shapka + ko'rsatma bo'limi) — dvigatel endi yozmaydi, shapka yagona
  manba; eski hujjatlar uchun `planTeacher` ham tashlaydi.
- **TEST sahifa uzilishi:** birinchi variant ko'rsatma bilan BIR betda
  (aks holda 1-bet deyarli bo'sh qolardi); uzilish faqat variantlar
  ORASIDA, OMR va kalit oldida.
- **XARITA shapkasi:** mavzu fanning aynan o'zi bo'lsa «Mavzu» qatori
  chizilmaydi («Fan: Biologiya» + «Mavzu: Biologiya» takrori).

#### Testlar va mutatsiyalar

`teacher-edit` 29 · `teacher-commit` 11 · `doc-polish-route` 7 ·
`ui/teacher-viewer-edit` 9 · `teacher-polish` +2 · `teacher-layout` +4
(reja: 12 / 6 / 4 / 8).

Mutatsiya — 10 ta, har biri qizardi: nasr→model sinxroni (4 test);
ikkala `legacy` darvozasi (bittasini olib tashlash YETMAYDI — ikkinchisi
to'sadi); jadval katagi→model (3 test); `parse` op chegarasi; reja
darvozasi (`planPaths`); shapka→pasport takrori; `setSection` model
sinxroni (2 test); glossariy blok tekshiruvi; glossariy tuzilmali yo'li;
`teacherAdapter.tools` beshtadan bittaga.

**Ochiq savollar (WP-E/WP-F ga):**

1. `teacher.school.grade` / `durationMin` / `weeklyHours` / `timeMin`
   tahrirda RAD etiladi (son). Forma ularni qayta tahrirlash imkonini
   berishi kerakmi, yoki ko'ruvchida raqamli maydon ochilsinmi —
   mahsulot qarori.
2. Test `variant-X` bo'limida savol matni ASL indeksga yoziladi, ya'ni
   B variantidagi tahrir A variantida ham ko'rinadi (bitta savol
   bazasi — R3 §3.4 qarori). Bu kutilgan xatti-harakat, lekin
   ko'ruvchida ogohlantirish kerak bo'lishi mumkin.
3. `keys` va `test` prose bo'limlarida `blockRemove` model ro'yxatini
   QISQARTIRMAYDI (faqat xaritani buzadi va keyingi sinxronni
   o'chiradi). Model elementini o'chirish opi kerakmi — hozircha
   forma orqali.
- **R3 (lead) — birlashtiruv, jonli, ko'z**: barcha WP main da (`db692f7` WP-C, `26e374d` WP-E, `bde8082` WP-F, `df5d83c` WP-D; konfliktlar — docs va `teacher/prompts.ts` yorliqlari → `i18n.ts` yagona manba, `method` yorlig'i qo'shildi). Zond test dvigateli kiritmasiga ulandi (`f22e6b6`) — 3 bezak nomzodi ushlandi (approver faqat bsb/chsb, openCount faqat open ruxsatli turda, sourceText TestInput ga). **Jonli 7/7**: lesson (hisobot, bosqich/daqiqa ✔), map (92, 34 hafta/136 soat), glossary (95, 20 uch tilli atama, alifbo ✔ — birinchi urinishda sayqal `h3` sarlavhalarni yo'qotgan edi → WP-D: glossariy sayqali model shaklida, `setSection` modelli bo'limda izchil), keys (100 — realism heuristikasi kengaytirildi `7c66a58`: rol+ism, «2-«B» sinf», daqiqa), test-topic (91, 20 savol/2 variant, OMR PNG 2126 px, kalit mos), test-file (87, 15/15 savol manbada tasdiqlangan — `sourceGrounded`), test-curriculum (95, 5/5 mavzu — birinchi urinish tarmoq uzilishi). **LibreOffice ko'z**: dars rejasi (shapka, pasport, kompetensiyalar, bosqichlar), xarita (albom, 1-jadval 6 ustun, «Mavzu» takrori olib tashlandi), test (ko'rsatma, variantlar, OMR, kalit — F.I.Sh. qatori takrori va bo'sh 1-bet WP-D da tuzatildi), glossariy (h3 + ta'rif + misol, uch tilli jadval), keys (vaziyat/topshiriq/namunaviy kalit) — rasmiy ko'rinishda. To'plamlar: unit 2 063/2 066 (2 fal.ai + 1 env-bog'liq test tuzatildi `c51f6ee`), ko'ruvchi 201, UI 234, lint/tsc toza.
