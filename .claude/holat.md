# SlaydX — holat (2026-09-21, main `b928b01`+; prod: **AUDIT-24 `8194d6a`** (2026-09-21, rollback `406f8ac`); tekshiruv: tsc/lint 0, unit 2 634/2 636 (2 ma'lum fal.ai), UI 370, ko'ruvchi 248)

Sprint: **Formalar 3 (AUDIT-24) — 100 %, prod'da.** 17 forma + etalon nomuvofiqliklari, reja `docs/AUDIT-24.md` §1, tadqiqot `docs/research/forms3-*.md`.

| # | AUDIT-24 bosqich | % | Izoh |
|---|---|---|---|
| R | 4 audit + 22 forma o'lchovi + reja + egasi qarorlari | 100 | `ad0fd8c` |
| R0 | `components/forms/shared` (SettingsDetails, Field, TopicRow, LimitedTextarea, AuthorRows, SourceFileRow, RangeRow, ColorDots, ClearFormButton), 10 test, 3 mutatsiya | 100 | `15a27c9` |
| A | WorkComposer — 2 027 → 997 px, hajm slayder+narx, 43 test | 100 | merge `3e2c89c` |
| B | TeacherComposer 7 faylga, 5 kind ≤ 1 200 px, approver bsb/chsb, fan bitta manba, darslik rejimi 400 tuzatildi | 100 | merge `e1ec29c`; CurriculumPicker ixcham `b928b01` |
| C | Insho 844 px, tezis 1 020 px, insho natija izohi | 100 | merge `ac103f7` |
| D1 | GameComposer (4 o'yin), standartlar reyestrdan | 100 | merge `8261a0a` |
| D2 | MediaComposer + InfographicComposer + «Infografika · A4 · N blok» | 100 | merge `1662b8c` |
| E | Etalon 10 banddan 9 yopildi (rasm 1 359 → 941, rezyume → 1 663, qoralama, ColorDots, priceFor) | 100 | ff `4760457`, tuzatuv `5f524a4` |
| R2 | 22 forma o'lchovi, qorong'i rejim, to'liq to'plam, navbat smoke, docs, deploy, prod smoke (22 forma + 2 navbat) | 100 | prod `8194d6a` |

Oldingi sprintlar: AUDIT-22 prod'da (`03a64e4`), bot avtologin (`406f8ac`), tannarx hisoboti (`cc074e1`, `docs/research/tannarx-hisobot.html`). Kelajak: admin panel (narx/tannarx, statistika) — xotira `project_slaydx_admin_panel_future.md`.

Oldingi sprint: **O'qituvchi vositalari 2 + 9 yangi xizmat (AUDIT-20…23)** — reja `docs/AUDIT-20.md` §1, tadqiqot `docs/research/` (15 hisobot). Oldingi: Talaba ishlari 2 (AUDIT-19) — prod'da.

Eski sprint jadvali (AUDIT-19) — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md` (§1 `docs/AUDIT-19.md`), jurnal `docs/AUDIT-19.md` §5.
AUDIT-20: **100 % — prod'da (`5852285`).**

AUDIT-21 (krossvord + flesh kartalar + infografika, bosma): **100 % — prod'da (`9bb8a43`)**, prod smoke 3/3 (`docs/AUDIT-21.md`).

AUDIT-22 (TTS podkast/tabriknoma/tinglash + interaktiv runtime + saralash): **100 % — prod'da (`03a64e4`)**, prod smoke saralash/tinglash + loginsiz o'yinchi yashil; podkast/tabriknoma KALIT KUTMOQDA — jurnal `docs/AUDIT-22.md` §5, ochiq §6.

| # | AUDIT-22 bosqich | % | Izoh |
|---|---|---|---|
| R0 | Substrat (021_games.sql, game_sessions/results, mp3, media guruhi, TTS shartnoma) | 100 | main |
| WP-B/C | Ochiq API (`/api/o/[token]`, submit, share, results CSV), o'yinchi 5 ekran, QR paneli | 100 | main |
| WP-D | Saralash/tinglash dvigatellari + bosma maketlar | 100 | main; byudjet 160 s (`061e495`) |
| WP-A | TTS adapterlari (Azure/Aisha/Gemini), zanjir, MP3, podkast/tabriknoma dvigateli, tts-lab | 100 | merge `247b147`; +79 test; haqiqiy sinov KALITSIZ |
| R | Tinglash TTS seam ulash, ochiq audio route, 4 o'yin o'yinchi oqimi 100 % | 100 | `9c780bf`, `c3bcb57` |
| R1 | Jonli holatlar (sorting/listening/podcast/greeting), public.ts, promised count, purge, robots | 100 | merge `a3d8095` |
| WP-A2 | audio-params differensial zond, turga xos podkast skeletlari, lamejs LGPL, audio «Tuzatish» yashirish | 100 | merge `e55692c` |
| R2 | Merge'lar, hideWhen (`7a93b2d`), jonli 2/2, to'liq to'plam, docs §6, deploy + hotfix (TTS kaliti = ogohlantirish, `a5e5183`), prod smoke | 100 | prod `03a64e4` |

Egasidan: Azure Speech kaliti + region, Aisha AI kaliti (`npm run tts-lab`), Anthropic to'ldirish.

| # | AUDIT-20 bosqich | % | Izoh |
|---|---|---|---|
| R | Tadqiqot 15 hisobot | 100 | `docs/research/` |
| R0 | Substrat (teacher tiplari/reyestr, test vositasi, curriculum API) | 100 | `8fabe09` |
| A | 4 vosita dvigateli (lesson/map/glossary/keys) | 100 | `6b7d627`, 74 test |
| B | Test dvigateli + o'quv bazasi (8 fan, 2 424 mavzu) | 100 | `1c50961` |
| C | planTeacher yagona manba, drawTeacher, paritet, legacy, eski ko'ruvchilar o'chishi | 100 | `db692f7` |
| E | TeacherComposer forma + zond | 100 | `26e374d`, `f22e6b6` |
| D | Tahrir/server (teacherAdapter, doc-polish, useTeacherEdit, glossariy sayqal, maket nuqsonlari) | 100 | `df5d83c` |
| F | Ulash (index.ts darvozalari, delivered, i18n, live 8 holat, seed) | 100 | `bde8082` |
| R3 | Jonli 7/7, smoke (lesson-plan, test), ko'z 5 kind, docs, deploy + prod smoke | 100 | prod `5852285`, rollback `552a46c` |

## To'xtatilgan jarayonlar
Yo'q — 7 WP ham merge qilindi, worktree'lar tozalandi. Dev server 3111 (`WORKER_INLINE`) ishlayapti — yakuniy smoke uchun.

## Davom etish qadamlari (AUDIT-20)
1. Anthropic hisobini to'ldirish (baholovchi Gemini ga tushgan).
2. Keyingi: AUDIT-22 (TTS podkast/tabriknoma/tinglash + interaktiv runtime, saralash) — reja `docs/AUDIT-20.md` §4; Azure Speech / Aisha AI kalitlari egasidan (TTS lab).
2. Egasidan (AUDIT-22 uchun, shoshilinch emas): Azure Speech kaliti + region, Aisha AI kaliti.

Oldingi sprint (AUDIT-19) yakuni: **100% — prod'da (2026-09-16, `552a46c`).**

| # | Bosqich | % | Izoh |
|---|---|---|---|
| 0 | R0-A neytral `report/` qatlami (score/judge/text/guard/polish-core) | 100 | main |
| 1 | WP-B manbalar: Google Books, lex.uz tasdiq, O'zbekiston tartibi, GOST kitob/qonun/web | 100 | main; Books kalitsiz 429 (kalit kutilmoqda) |
| 2 | WP-A work dvigateli (3 janr × 8 tur, 5 profil, hisobot 16 qoida + baholovchi, sayqal, zond) | 100 | main |
| 3 | WP-D insho dvigateli (3 kontekst, rubric) + WP-E1 ulash (EssayComposer, doc-polish) | 100 | jonli 3/3 |
| 4 | WP-F tezis → maqola dvigateli (narx 4 000/5 000, konf. turlari) | 100 | jonli yashil |
| 5 | WP-E2 WorkComposer formasi (28 maydon, reyestr) | 100 | `4a32217` |
| 6 | WP-C planWork yagona manba, drawWork, workProfile, tahrir (work/edit, workAdapter), paritet/legacy | 100 | `e98df41`, `02571bc` |
| 7 | R jonli: referat/kurs ishi nazariy/amaliy/mustaqil ish 4/4 (82–90 ball, manbalar 100 % tekshirilgan) | 100 | 7+ tuzatish: max_tokens poli, workGateWords/bodyWordCount, kengaytirish+to'ldirish, manba taqsimoti, judge timeout, bo'sh paragraf qayta yozish |
| 8 | R Chromium smoke (forma → natija → hisobot → sayqal → tahrir → DOCX) + LibreOffice ko'z | 100 | referat/insho/tezis yashil; 4 nuqson topilib tuzatildi (klient chegarasi 500, ArtifactViewer proplari, kesilgan JSON kirish, titul yorliqlari) |
| 9 | Docs (AUDIT-19 §5–§6, CLAUDE.md, structure.md, README, xotira) | 100 | §7 (keyingi sprint) deploydan keyin |
| 10 | Deploy (zaxira → prod .env GOOGLE_BOOKS_API_KEY → nohup deploy.sh → prod smoke) | 100 | zaxira `slaydx-20260916090605.sql`, rollback `cfa5b84`; eski hujjatlar 5/5, yangi referat 90 ball + sayqal + tahrir + DOCX |

## Ochiq bandlar
- Google Books: kalit qo'yildi, lekin kalit bilan so'rovga Google javob bermaydi (15–25 s jim; kalitsiz 0,2 s da 429) — Cloud Console'da «Books API» yoqilganini/kalit cheklovlarini tekshirish kerak; hozircha 10 s timeout bilan bo'sh qaytadi, manbalar OpenAlex/Crossref/lex.uz dan.
- Wi-Fi uzilishlari (ETIMEDOUT) jonli sinovlarda — dvigatel endi chidamli (qayta urinish 2 s/4 s, bo'sh paragraf qayta yoziladi); prod tarmog'ida kuzatilmagan.
- Eski yozuvchi yo'li (`writeWriterWithLlm`, `WORK_ENGINE=0`) hali kodda — keyingi sprintda olib tashlash.
- Mundarijada bet raqami LibreOffice'da bo'sh (Word to'ldiradi) — avvalgi qaror.

## Muhit
- Dev server 3111 va worker to'xtatildi; Playwright scratchpad'da (`work19.mjs`, `mksession.mts`).

## Davom etish qadamlari
1. Google Books kalitini Cloud Console'da tekshirish (Books API yoqilganmi, cheklovlar) → prod'da `[googlebooks]` log satrlari.
2. Keyingi sprint — foydalanuvchi bilan kelishiladi (`docs/AUDIT-19.md` §6 dan boshlash mumkin).
