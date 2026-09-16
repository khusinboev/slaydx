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

