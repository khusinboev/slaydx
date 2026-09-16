# SlaydX — holat (2026-09-16, main `b15c560`, prod: AUDIT-18 `cfa5b84` (tasdiqlangan); tekshiruv: unit 1768/1770 (2 tasi `.env.local` fal.ai holati), ko'ruvchi 168, UI 209, lint/tsc toza)

Sprint: **Talaba ishlari 2 (AUDIT-19)** — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md` (§1 `docs/AUDIT-19.md`), jurnal `docs/AUDIT-19.md` §5.
Umumiy: **~92% — kod tayyor, smoke/ko'z o'tdi; deploy qolgan.**

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
| 8 | R Chromium smoke (forma → natija → hisobot → sayqal → tahrir → DOCX) + LibreOffice ko'z | 95 | referat oqimi yashil; topilgan va tuzatilgan: klient chegarasi 500, ArtifactViewer tahrir proplari, {parts} JSON matnga tushishi, titul «fakulteti fakulteti»; insho/tezis smoke yurmoqda |
| 9 | Docs (AUDIT-19 §5, CLAUDE.md, structure.md, README, xotira) | 90 | §6/§7 yakuniy yozuv deploydan keyin |
| 10 | Deploy (zaxira → prod .env GOOGLE_BOOKS_API_KEY → compose → nohup deploy.sh → prod smoke) | 0 | kalit foydalanuvchidan kutilmoqda; kalitsiz ham deploy mumkin (Books 429 → boshqa manbalar) |

## Ochiq bandlar
- `GOOGLE_BOOKS_API_KEY` — foydalanuvchidan; `.env.local` + prod `/opt/slaydx/.env` + `docker-compose.yml` (compose-env testi).
- Wi-Fi uzilishlari (ETIMEDOUT) jonli sinovlarda — dvigatel endi chidamli (qayta urinish 2 s/4 s, bo'sh paragraf qayta yoziladi); prod tarmog'ida kuzatilmagan.
- Eski yozuvchi yo'li (`writeWriterWithLlm`, `WORK_ENGINE=0`) hali kodda — keyingi sprintda olib tashlash.
- Mundarijada bet raqami LibreOffice'da bo'sh (Word to'ldiradi) — avvalgi qaror.

## Muhit
- Dev server 3111 + worker (heavy.sh ostida) smoke uchun ishlab turibdi — sinovdan keyin to'xtatish; Playwright scratchpad'da (`work19.mjs`, `mksession.mts`).

## Davom etish qadamlari
1. Smoke natijasi (insho/tezis) → jurnal §5; `docs/AUDIT-19.md` §6 ochiq bandlar.
2. Deploy `.claude/deploy.md` bo'yicha: zaxira, prod `.env` (Books kaliti bo'lsa), `nohup bash /opt/slaydx/deploy.sh`, prod smoke (eski kurs ishi/referat/tezis ochilishi + yangi referat).
