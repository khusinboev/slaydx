# SlaydX — holat (2026-09-16 PAUZA, main `6b7d627`; prod: AUDIT-19 `552a46c`; tekshiruv: tsc toza, teacher testlari 87+74 yashil, to'liq to'plam R0 da 1767/169/209)

Sprint: **O'qituvchi vositalari 2 + 9 yangi xizmat (AUDIT-20…23)** — reja `docs/AUDIT-20.md` §1, tadqiqot `docs/research/` (15 hisobot). Oldingi: Talaba ishlari 2 (AUDIT-19) — prod'da.

Eski sprint jadvali (AUDIT-19) — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md` (§1 `docs/AUDIT-19.md`), jurnal `docs/AUDIT-19.md` §5.
AUDIT-20 holati: **~35 %** — R tadqiqot 100, R0 substrat 100, WP-A dvigatel 100 (main), WP-B ~40 (worktree), WP-C ~60 (worktree), WP-E ~5, WP-D/WP-F/R3 0.

| # | AUDIT-20 bosqich | % | Izoh |
|---|---|---|---|
| R | Tadqiqot 15 hisobot | 100 | `docs/research/` |
| R0 | Substrat (teacher tiplari/reyestr, test vositasi, curriculum API) | 100 | `8fabe09` |
| A | 4 vosita dvigateli (lesson/map/glossary/keys) | 100 | `6b7d627`, 74 test |
| B | Test dvigateli + o'quv bazasi ≥6 fan | 40 | worktree `agent-a5106a1b84f359a35` |
| C | planTeacher yagona manba, drawTeacher, paritet, legacy, eski ko'ruvchilar o'chishi | 60 | worktree `agent-a7dae8c6277a8125d` |
| E | TeacherComposer forma + zond | 5 | worktree `agent-af37ea237a44603ea` |
| D | Tahrir/server (teacherAdapter, doc-polish, useTeacherEdit, worker source, delivered) | 0 | WP-C dan keyin |
| F | Ulash (index.ts darvozalari, delivered, i18n, live 6 holat, seed) | 0 | |
| R3 | Jonli, smoke, ko'z, docs, deploy | 0 | deploy WP-E siz TAQIQ (4 vosita formasi bo'sh) |

## To'xtatilgan jarayonlar
`.claude/actions/2026-09-16-01-pause.md` — 3 agent worktree'da (WP-B WIP `a22a233`, WP-C 4 kommit, WP-E boshlanmagan).

## Davom etish qadamlari (AUDIT-20)
1. «davom et» — uchala worktree agentini davom ettirish (`git merge main` → qolgan ish), keyin WP-D/WP-F, jonli 6 holat, smoke, LibreOffice ko'z, docs, deploy.
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
