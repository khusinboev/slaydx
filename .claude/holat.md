# SlaydX — holat (2026-09-12, main `be0f737`+docs, tekshiruv: unit 1424/1426 (2 tasi `.env.local` fal.ai holati), ko'ruvchi 140, UI 158, lint/tsc toza)

Sprint: **Maqola 2 (AUDIT-17)** — reja `~/.claude/plans/sen-senior-fullstack-dev-majestic-starfish.md`, jurnal `docs/AUDIT-17.md`.
Umumiy: **~95% bajarildi — kod tugadi, deploy qoldi (foydalanuvchi kalitlari kerak).**

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
| 10 | Deploy (zaxira → 020 → `.env` kalitlari → nohup deploy.sh → prod smoke) | 0 | **Foydalanuvchidan:** `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENALEX_API_KEY`+mailto; deploy tasdig'i |

## Ochiq savol (mahsulot egasi)
- 3–5 betlik paket OAK profilida ~6 bet chiqadi (apparatura ≈3,7 bet; bo'lim 45 % poli) — yorliqni profilga qarab ko'rsatish yoki kichik paketda apparaturani qisqartirish? (`docs/AUDIT-17.md` §7)

## Muhit
- Dev server 3111 (heavy.sh ostida) ishlab turibdi — sinovdan keyin to'xtatish mumkin; scratch fayllar `scratch-tmp/` (gitignored) va scratchpad `pw/`.

## Davom etish qadamlari
1. Foydalanuvchi kalitlarni bersa: prod `.env` (`LLM_WRITER=gemini:gemini-3.7-flash`, `LLM_JUDGE=anthropic:claude-sonnet-5,gemini:gemini-3.7-flash`, `LLM_RESEARCHER`/`LLM_FAST` gemini, `OPENALEX_*`, `CROSSREF_MAILTO`, `WORKER_JOB_TIMEOUT_MS=660000`), pg_dump zaxira, `nohup bash /opt/slaydx/deploy.sh`, prod smoke (`pw/article17.mjs` BASE=prod, eski maqolalar ochilishi).
2. Ochiq savol bo'yicha qaror → kichik tuzatish (yorliq yoki apparatura).
