# SlaydX — holat (2026-09-17, main `c3bcb57`+; prod: AUDIT-21 `9bb8a43` (2026-09-17); tekshiruv: tsc/lint toza, tegilgan testlar yashil; to'liq to'plam AUDIT-22 merge'laridan keyin)

Sprint: **O'qituvchi vositalari 2 + 9 yangi xizmat (AUDIT-20…23)** — reja `docs/AUDIT-20.md` §1, tadqiqot `docs/research/` (15 hisobot). Oldingi: Talaba ishlari 2 (AUDIT-19) — prod'da.

Eski sprint jadvali (AUDIT-19) — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md` (§1 `docs/AUDIT-19.md`), jurnal `docs/AUDIT-19.md` §5.
AUDIT-20: **100 % — prod'da (`5852285`).**

AUDIT-21 (krossvord + flesh kartalar + infografika, bosma): **100 % — prod'da (`9bb8a43`)**, prod smoke 3/3 (`docs/AUDIT-21.md`).

AUDIT-22 (TTS podkast/tabriknoma/tinglash + interaktiv runtime + saralash): **~85 %** — jurnal `docs/AUDIT-22.md` §5.

| # | AUDIT-22 bosqich | % | Izoh |
|---|---|---|---|
| R0 | Substrat (021_games.sql, game_sessions/results, mp3, media guruhi, TTS shartnoma) | 100 | main |
| WP-B/C | Ochiq API (`/api/o/[token]`, submit, share, results CSV), o'yinchi 5 ekran, QR paneli | 100 | main |
| WP-D | Saralash/tinglash dvigatellari + bosma maketlar | 100 | main; byudjet 160 s (`061e495`) |
| WP-A | TTS adapterlari (Azure/Aisha/Gemini), zanjir, MP3, podkast/tabriknoma dvigateli, tts-lab | 100 | merge `247b147`; +79 test; haqiqiy sinov KALITSIZ |
| R | Tinglash TTS seam ulash, ochiq audio route, 4 o'yin o'yinchi oqimi 100 % | 100 | `9c780bf`, `c3bcb57` |
| R1 | Jonli holatlar (sorting/listening/podcast/greeting), public.ts, promised count, purge, robots | 80 | agent ishlamoqda (worktree `agent-abd9c9364f893e484`) |
| WP-A2 | audio-params differensial zond, turga xos podkast skeletlari, lamejs LGPL, audio «Tuzatish» yashirish | 30 | agent ishlamoqda (worktree `agent-aac90129c4eb6104a`) |
| R2 | Merge'lar → dev qayta ishga tushirish → `npm run live -- sorting listening` → to'liq to'plam/lint → docs §6, xotira → deploy (`.env` TTS kalitlari, compose, 021) → prod smoke (`/o/<token>` loginsiz) | 0 | |

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
Yo'q — R1 va WP-A2 agentlari faol (yuqoridagi jadval). Dev server 3111 (`WORKER_INLINE`) ishlayapti, `9c780bf` DAN OLDINGI kod bilan — merge'lardan keyin qayta ishga tushirish shart.

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
