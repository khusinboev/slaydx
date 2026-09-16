# SlaydX — holat (2026-09-16, main `b15c560`, prod: AUDIT-19 `552a46c` (2026-09-16); tekshiruv: unit 1768/1770 (2 tasi `.env.local` fal.ai holati), ko'ruvchi 168, UI 209, lint/tsc toza)

Sprint: **Talaba ishlari 2 (AUDIT-19)** — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md` (§1 `docs/AUDIT-19.md`), jurnal `docs/AUDIT-19.md` §5.
Umumiy: **100% — Talaba ishlari 2 prod'da (2026-09-16, `552a46c`).**

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
