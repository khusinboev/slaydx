# SlaydX — holat (pauza 2026-09-11, commit `594a206`, tekshiruv: main yashil — oxirgi to'liq unit 1 121, WP2–WP6 testlari birlashmada bittadan yashil)

Sprint: **Maqola 2 (AUDIT-17)** — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`, jurnal `docs/AUDIT-17.md`.
Umumiy: **~65% bajarildi, ~35% qoldi.**

| # | Bosqich | % | Izoh |
|---|---|---|---|
| 0 | WP0 poydevor (tiplar, 12 tur, 5 profil, reyestr, 020 migratsiya, deps) | 100 | `b774836`, `47222fa` |
| 1 | WP1 dvigatel + manba qidiruv (OpenAlex/Crossref, post-verify) | 100 | `727385a`; jonli 4 holat o'tgan |
| 2 | WP2 render DOCX + ko'ruvchi paritet (planArticle, OMML, KaTeX) | 100 | `0027803` |
| 3 | WP3 sxemalar SVG→PNG + dvigatelga ulash | 100 | `f780ed2`, `791b67c` |
| 4 | WP4 server: form_drafts, cost_json, aktivlar, karta, cost-report | 100 | `f95a696` |
| 5 | WP6 forma ArticleComposer + galereyalar | 100 | `4a09e77` |
| 6 | WP5 iqtibos uslublari + translit + tayyorlik hisoboti + panel | 25 | TO'XTATILGAN — yarim ish worktree `agent-a1297408f45a01ba0` (`28a3d62` WIP): `cite/{gost,apa,ieee,numeric}` boshlangan, `review.ts`/translit/panel yo'q |
| 7 | WP8 LLM rollari (adapterlar, zaxira zanjiri, usage, narx jadvali) | 0 | TO'XTATILGAN — hali fayl yozilmagan (worktree yo'q) |
| 8 | WP7 ko'ruvchida tahrir (article adapter, rewrite, editor) | 0 | boshlanmagan |
| 9 | R5 lead: integratsiya, jonli 4 holat (hisobot bilan), Chromium smoke, LibreOffice ko'z, docs, deploy | 0 | boshlanmagan; `.env` kalitlari kerak (Anthropic, OpenRouter, OpenAlex) |

## To'xtatilgan jarayonlar
- **WP5** (opus, worktree `.claude/worktrees/agent-a1297408f45a01ba0`, branch `worktree-agent-a1297408f45a01ba0`): `cite/gost|apa|ieee|numeric.ts` + `layout.ts formatReferenceLine` delegatsiyasi yozilgan, testlar boshlangan, TEKSHIRILMAGAN; qolgan: `translit.ts`, `cite/index.ts`, `article/review.ts` (qoidalar + judge), `engine.ts` review bosqichi, `ArticleReviewPanel.tsx`, `ResultView` ulanishi, testlar/mutatsiya.
- **WP8** (sonnet): to'xtatilganda hali hech narsa yozmagan — qaytadan boshlanadi (prompt: LLM rollari adapterlari, `chain.ts`, `llm-pricing.ts`, `CostMeter.usd`, testlar).
- Fon jarayonlar: dev server/LibreOffice yo'q.

## Davom etish qadamlari
1. `SendMessage` bilan WP5 agentini (`a1297408f45a01ba0`) davom ettirish: «WIP `28a3d62` dan davom et: cite testlarini yashil qil, translit, review.ts, engine review bosqichi, panel» — yoki yangi opus agent shu worktree'dan.
2. WP8 ni yangi sonnet agent bilan qaytadan (prompt transkriptda; `git merge main` avval).
3. WP7 (tahrir) — opus; WP5 `fix` shartnomasini ishlatadi.
4. R5: `npm run live -- article-oak …` (hisobot bilan), Chromium smoke, ko'z, `AUDIT-17` §6–§7, `.claude/structure.md`, `CLAUDE.md`, xotira, deploy (`.env`: `OPENALEX_API_KEY/MAILTO`, `CROSSREF_MAILTO`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `LLM_*`, `WORKER_JOB_TIMEOUT_MS=660000`; migratsiya 020; `nohup deploy.sh`).
