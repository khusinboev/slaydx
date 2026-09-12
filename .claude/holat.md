# SlaydX — holat (2026-09-12, main `90e192a`+, prod deploy qilingan; tekshiruv: unit 1424/1426 (2 tasi `.env.local` fal.ai holati), ko'ruvchi 140, UI 158, lint/tsc toza)

Sprint: **Maqola 2 (AUDIT-17)** — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`, jurnal `docs/AUDIT-17.md`.
Umumiy: **100% — Maqola 2 prod'da (2026-09-12).**

| # | Bosqich | % | Izoh |
|---|---|---|---|
| 0 | WP0 poydevor (tiplar, 12 tur, 5 profil, reyestr, 020 migratsiya, deps) | 100 | `b774836`, `47222fa` |
| 1 | WP1 dvigatel + manba qidiruv (OpenAlex/Crossref, post-verify) | 100 | `727385a`; jonli 4 holat |
| 2 | WP2 render DOCX + ko'ruvchi paritet (planArticle, OMML, KaTeX) | 100 | `0027803` |
| 3 | WP3 sxemalar SVG→PNG + dvigatelga ulash | 100 | `f780ed2`, `791b67c` |
| 4 | WP4 server: form_drafts, cost_json, aktivlar, karta, cost-report | 100 | `f95a696` |
| 5 | WP6 forma ArticleComposer + galereyalar | 100 | `4a09e77` |
| 6 | WP5 iqtibos uslublari + translit + tayyorlik hisoboti + panel | 100 | `31df451` |
| 7 | WP8 LLM rollari (adapterlar, zaxira zanjiri, usage, narx jadvali) | 100 | `7ddfdc1` |
| 8 | WP7 ko'ruvchida tahrir (article adapter, rewrite, editor) | 100 | `8d7e871` + `4ba96b4` (tahrir ikkilanishi) |
| 9 | R5 lead: integratsiya, jonli, Chromium smoke (tahrir + «Tuzatish»), hajm kalibrovkasi, ko'ruvchi shrifti, DOCX lineRule, docs | 100 | `b06c86d`…`be0f737`; jurnal §6–§7, structure.md, CLAUDE.md, README, xotira |
| 10 | Deploy (zaxira → 020 → `.env` kalitlari → nohup deploy.sh → compose env → prod smoke) | 100 | `3663b63` + `90e192a`; eski maqolalar ochiladi, yangi maqola Claude baholovchi bilan, tahrir/«Tuzatish» prod'da yashil |

## Ochiq bandlar
- `docs/AUDIT-17.md` §7: manbalar soni 8–12 (OAK ≥10), Claude baholovchi qattiqroq, apparaturani qisqartirish varianti.
- OpenRouter/OpenAlex hisoblarida pul yo'q (zaxira zanjiri faqat Anthropic → Gemini ishlaydi); Anthropic $3 — baholovchi ~$0.02–0.03/maqola.

## Muhit
- Dev server 3111 (heavy.sh ostida) ishlab turibdi — sinovdan keyin to'xtatish mumkin; scratch fayllar `scratch-tmp/` (gitignored) va scratchpad `pw/`.

## Davom etish qadamlari
1. Keyingi sprint — foydalanuvchi bilan kelishiladi (`docs/AUDIT-17.md` §7 dan boshlash mumkin).
2. `scripts/cost-report.mts` ni prod'da (worker konteynerida) bir haftadan keyin yurgizib marjani tekshirish.
