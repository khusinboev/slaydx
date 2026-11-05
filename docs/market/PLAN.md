# «Ishlar bozori» (Market) — plan, architecture and decisions

Owner request (2026-11-05, decided without questions — the owner was asleep; every decision below carries its reason):
finished, resellable content (slides, tezis, insho, konspekt and similar) is resold on the site in a MARKET section, priced
2× cheaper than the original by default, configurable in the admin panel, with no way to steal the content, complete and
beautiful, thought through for every situation.

Status: PLAN ONLY. No product code on this branch. Ships DARK (`market.enabled` default OFF); the owner switches it on.
Builders follow `docs/todo-2026-10-07/AGENT-BRIEF.md` + `CLAUDE.md`. Migrations start at **073** (072 is reserved elsewhere).

---

## 0. Decision register (the short list)

| # | Decision | Reason |
|---|---|---|
| M1 | The market sells **neutral copies** of AI-generated works, never the author's file: a sanitised `AcademicDoc` is stored on `market_items`; the user's `generations` row is only the *source* and is never read again after candidate creation. | A listing must survive the author deleting / editing / purging (`files_purged_at`) his work, and the author's PII must never be served. |
| M2 | A purchase **is a real `generations` row of the buyer** (status QUEUED → worker renders the copy without any LLM call → COMPLETED). Charge = the existing `enqueueGeneration` charge with `reference = generation id`. | Every existing mechanism (viewer, editor, downloads, PDF, Telegram save, thumb, refunds on failure, admin refund, Ishlarim list, retention) works unchanged; money stays in `credits.ts` + ledger. |
| M3 | Buyer gets a **personalised title page** (his name, university, …) through the same required fields the original tool demands; the body is identical for every buyer. | «Ko'rdim = oldim»: the viewer and the file come from one model; a fresh title page is the real need of a student buying a referat. |
| M4 | Default price = **50 %** of the *current* original price computed through `effectivePrice` (= `basePriceFor` × `tool_pricing`) from the item's stored parameters, then `market.percent` → per-tool % → per-item override → rounding → minimum. | Single price source (house rule); when the owner changes an original price the market follows automatically. |
| M5 | **Automatic candidates + admin approval.** No user-facing «sell my work» button. | Keeps quality and legal control in the owner's hands; users are not sellers (no payouts, no disputes). |
| M6 | **Author reward: none by default**; setting `market.author_reward_percent` (0–50, default 0) pays bonus so'm via `topUpInTx(kind "bonus", ref "market-author:<purchaseId>")`. | Content is AI-made and already discounted; a reward creates an incentive to farm generations. The setting costs one `if` because the ambassador pattern exists. |
| M7 | **Opt-out** per user («Mening ishlarim bozorga chiqmasin», profile → Xavfsizlik, bot /profil). Oferta gets an explicit clause; version bump is the owner's call at enable time. | Consent must be visible and revocable; existing generations of an opted-out user are withdrawn from the queue (not from already-active items, which hold no PII — admin can retire manually). |
| M8 | **Previews are server-rendered watermarked JPEG rasters** (cover + N pages, low resolution); nothing else of the body leaves the server before purchase. Public, cacheable, rate-limited. | Devtools / API / scraping get only what a shop window shows; UUID ids, no enumeration. |
| M9 | **Copy caps**: per item `max_copies` (defaults by family: slides 30, teacher docs 50, essays 10, academic works 5, thesis 3) + per (item, normalised university) cap 2. Sold-out items leave the catalog but stay downloadable for buyers. | Academic honesty: the same referat must not reach a whole group. Caps are configurable. |
| M10 | **No paid «uniqueness rewrite»** in v1. The item page offers «Shu mavzuda yangi yaratish» → the original tool prefilled at full price. | Zero LLM cost for the market; the upsell already exists (the tool). A rewrite needs its own quality gate — later. |
| M11 | **Bonus so'm may pay** for market purchases (not `paidOnly`), toggle `market.paid_only`. | Zero marginal cost; the market is a healthy bonus sink. |
| M12 | **Refunds**: automatic when the copy job fails (existing worker path); otherwise only an admin refund with reason through the existing generation refund (ledger reference = generation id). No self-service refund after download. | Owner policy «money is not refunded» + files are deterministic renders. |
| M13 | **Invisible per-buyer fingerprint** in OOXML metadata (`docProps/core.xml` keywords + custom property), no visible mark. | The buyer paid for a clean document; metadata + `generation_files.downloads` + purchase log are enough to trace a leak. |
| M14 | Konspekt is added to `workAdapter.tools`. | Found defect: konspekt has no edit adapter, so it cannot be re-rendered from `doc_json` (and cannot be edited in the viewer) — the copy pipeline needs `adapterFor(toolId).render`. |
| M15 | Catalog and item pages are **public and indexable** (title, summary, outline headings, previews); purchase needs login. | Organic traffic toward the 50k target; nothing indexable is the body. |

---

## 1. SUPPLY

### 1.1 Tools that qualify (`lib/market/registry.ts` `MARKET_TOOLS`)

| Tool | In v1 | Family (cap default) | Why |
|---|---|---|---|
| `slide`, `pro-slide` | yes | slides (30) | Owner's first ask; decks are generic by topic; re-render via `slideAdapter.render` (PPTX). |
| `essay` | yes | essay (10) | Owner's ask (insho). Body is generic; title page carries the PII. |
| `thesis` | yes | thesis (3) | Owner's ask (tezis). Cap 3: a conference thesis is a publication; many identical copies would hurt buyers. |
| `konspekt` | yes | slides-like (30) | Owner's ask; lecture notes are meant to be shared. Needs M14. |
| `referat`, `mustaqil-ish` | yes | work (5) | «Similar materials»; strongest demand. |
| `coursework` | yes | work (5) | High value (12 000–24 000 → 6 000–12 000). |
| `lesson-plan` | yes | teacher (50) | Teachers share plans; no honesty issue. |
| `texnologik-xarita`, `glossary`, `keys`, `test`, `article`, `crossword`, `flashcards`, `sorting`, `listening`, `infographic` | **no (v2)** | — | Article: authors/ORCID/org are the work's identity and duplicate publication is a real harm. Teacher extras/games: low demand, PNG/game-session shapes. Enabling later = one registry line + sanitiser rule. |
| `resume`, `translation`, `image`, `portrait`, `video`, `podcast`, `greeting`, all `studio-*` | **never** | — | Personal data, user-provided sources, media (Studio has its own gallery). |

Admin can switch a tool off at runtime: setting `market.tools_disabled` (type `tool_ids`).

### 1.2 How items enter (pipeline `lib/server/market/candidates.ts`)

1. **Candidate scan** — worker housekeeping step `market-candidates` (leader only, every 6 h, batch `market.backfill_batch` default 100; manual trigger from admin). Also a cheap **on-completion hook** is NOT added to the worker (reason: the 24 h settling window below makes it pointless).
2. **Eligibility (SQL, one query):** `status='COMPLETED'`, `finished_at < now() - 24h` (cancel/refund/edit settle), `files_purged_at IS NULL`, `market_item_id IS NULL` (never a bought copy), tool in registry and not in `market.tools_disabled`, no `transactions` row `kind='refund' AND reference=g.id` (full or partial), `delivered_json IS NULL` (everything promised was delivered), user `is_blocked=false AND market_opt_out=false`, no admin account (admin test jobs are not products), not already in `market_items.source_generation_id`, `values_json` has no `sourceAssetId`/`sourceText`/`templateAssetId`/`logoAssetId`/`userFacts` (user-provided material = not ours to resell).
3. **Quality score** (`lib/market/quality.ts`, pure, 0–100, no LLM): `review.score` when the model has one (`work.review`, `essay.review`, `teacher.review`; weight 60), word count ≥ 0.9 × target (20), structure (≥ 3 sections / ≥ 6 slides, intro+conclusion where the genre has them; 10), slide image report `got === want` (10). Threshold `market.min_quality` default 70. Below → not a candidate (row written with status `rejected`, reason `quality`, so the scan does not re-evaluate it).
4. **Sanitise** (§1.4) → `doc_json`, `pii_flags`, `params_json`, `outline_json`, `title`, `summary`, `subject`, `level`, `language`, `pages`/`slide_count`, `topic_norm`, `simhash`.
5. **Dedupe:** exact `topic_norm` + same tool → skip; near-dup `simhash` Hamming ≤ 6 against active/candidate items of the same tool → skip. **Per-topic limit** `market.per_topic_limit` (default 3 active items per `(tool_id, topic_norm)`).
6. Row inserted with `status='candidate'`. Admin **approves** (edits title/summary/subject/level/max_copies/price override) or **rejects** with reason. Approval renders the neutral file (`market_item_files`) and triggers preview rasters lazily (§3.2).

Subjects (`lib/market/subjects.ts`, fixed 14 ids, keyword classifier uz-Latin/Cyrillic/ru + fallback from `work.subject` profile): matematika, fizika, kimyo, biologiya, informatika, tarix, ona-tili-adabiyot, ingliz-tili, iqtisodiyot, huquq, pedagogika-psixologiya, tibbiyot, texnika, boshqa. Levels: `maktab | kollej | otm` from `meta.ministry`, `slideAudience`, essay context, teacher `school.grade`.

### 1.3 Author rights, consent, privacy

- **Oferta clause** (new 4.x, lead drafts, owner approves before enabling): «Xizmat yaratgan materialning shaxsiy ma'lumotlardan tozalangan (titul sahifasidagi ism, muassasa, guruh, o'qituvchi va boshqa rekvizitlarsiz) nusxasini Ijrochi «Ishlar bozori» bo'limida boshqa foydalanuvchilarga taqdim etishi mumkin. Foydalanuvchi profilidagi «Mening ishlarim bozorga chiqmasin» tanlovi bilan bundan voz kechishi mumkin; voz kechish kelgusi tanlovlarga qo'llanadi.» `oferta.version` bump = owner decision at enable time (existing mechanism re-asks everyone).
- **Opt-out:** `users.market_opt_out` (migration 073). Toggle in Profil → Xavfsizlik («Mening ishlarim bozorga chiqmasin») and bot profile screen. Setting it deletes this user's `candidate` rows (not `active` ones — they are sanitised and already sold; admin may retire).
- **Author identity is never stored on the item**: `source_user_id` only for admin (opt-out purge, abuse review) — `users.pii` permission to see it.
- **Reward:** M6.

### 1.4 Sanitiser (`lib/market/sanitize.ts`, isomorphic, pure, unit-tested per tool)

Input: `AcademicDoc` + `values_json`. Output: `{ doc, params, flags }`.

| Where PII lives (real fields) | Action |
|---|---|
| `meta.author, university, faculty, department, teacher, city, group, course, email, organization, position, degree, udk` | cleared (`""`). `meta.city` → `""` (title model falls back to «Toshkent» only at buyer merge). |
| `doc.work.{university,faculty,department,group,course,author,teacher,teacherDegree,city,ministryCustom}` | cleared; `ministry: "custom"` → `"oliy"`. `work.userFacts` → deleted. |
| `doc.teacher.school.{institution,author,approver,date}` | cleared. |
| `doc.article.authors` | n/a in v1 (article excluded); sanitiser still clears it so enabling later is safe. |
| Slide `footer` of every slide | recomputed = `deckFooter(sanitisedMeta)` (= `""`). Title slide `subtitle` kept only if equal to `meta.workLabel`. `notes` kept (content). |
| `doc.slideLogo`, `doc.customTemplate` | deleted (user's logo / template) — such generations are excluded in §1.2 anyway; double guard. |
| `doc.images`, `doc.resume`, `photoAssetId` | not present for registry tools; deleted defensively. |
| Body text (`sections[].blocks`, slides, tables) | **name scrub**: tokens of the author/teacher names (≥ 3 chars, from meta/work/teacher fields and the user's profile `author`) replaced by «____»; regex scrub of phones (`\+?998\d{9}`, `\d{2}[ -]\d{3}[ -]\d{2}[ -]\d{2}`), e-mails, `@username`, `t.me/…`. Every hit → `flags.push({kind, path})` so the admin sees «PII topildi: 2 joy» and can inspect. |
| `values_json` | **not copied**. `params_json` = per-tool allow-list (`lib/market/params.ts`): slide/pro-slide `slideCount, slideTheme, slideTemplate, slideAudience, textVolume, quizCount, agendaSlide, language, design`; work `pages, kind, language, subject(profile), hand`; essay `essayContext, pages, kind, level, language, design`; thesis `thesisType, pages, language`; lesson-plan `type, grade, language`. Unknown keys dropped. These are exactly the keys `basePriceFor` and the viewer need. |
| Asset URLs `/api/generations/<srcId>/assets/<assetId>` inside `doc` | rewritten to `market-asset://<assetId>` placeholders; bytes copied into `market_assets` at candidate creation; the buyer's clone rewrites them to `/api/generations/<newId>/assets/<assetId>` and copies bytes into `generation_assets` (`ASSET_URL_RE`/`ownAssetUrlRe` already exist). |
| `fontSize`/`fontFace` overrides on slides | kept (style, not PII). |

Neutral render = `adapterFor(toolId).render({doc: sanitised, resolveImage: marketAssetResolver})` → `market_item_files`. Used for admin download and preview rasters; **never served to users**.

---

## 2. BUYING (`lib/server/market/purchase.ts`)

### 2.1 Flow (`POST /api/market/items/{id}/purchase`)

```
requireUser → market.enabled? (503 market_disabled) → item active (410 gone / sold_out) → already owned? (409 already_owned {generationId})
→ assertCanCreate (mandatory channels, 403) → assertOfferAccepted (403) → generation.paused (503 paused)
→ price = marketPrice(item) ; expectedPrice !== price → 409 price_changed {price}
→ fields = validate buyer title-page fields (same required set as the tool: work/teacher need author+university)
→ enqueueGeneration({ toolId: item.tool_id, topic: item.title, price, format: tool.output, values: cloneValues, budgetMs: 60_000,
     idempotencyKey, admission: await queueLimits(), paidOnly: market.paid_only,
     inTx: async (client, genId) => {                       // NEW optional hook in EnqueueInput (WP-B, jobs.ts)
        UPDATE market_items SET sold_count = sold_count + 1
          WHERE id=$1 AND status='active' AND (max_copies IS NULL OR sold_count < max_copies) RETURNING price_version
        → no row: throw MarketGone (whole tx rolls back: no charge, no row)
        → price_version changed since read: throw PriceChanged
        university cap: SELECT count(*) FROM market_purchases WHERE item_id=$1 AND university_norm=$2 → ≥ cap: throw UniversityCap (409 university_cap)
        INSERT market_purchases (id, item_id, buyer_user_id, generation_id=genId, price, original_price, university_norm, fingerprint)
        UPDATE generations SET market_item_id=$item WHERE id=genId
        if market.author_reward_percent > 0 and source_user_id not null and ≠ buyer: topUpInTx(bonus, ref "market-author:<purchaseId>")
        if sold_count reached max_copies: UPDATE market_items SET status='sold_out'
     } })
→ 402 insufficient (existing `insufficientError`, body carries required/available; UI deep-links to /uz/wallet with ?return=)
→ 200 { generationId, price, replayed }
```

`cloneValues = { marketItemId, author, university, faculty, department, group, course, teacher, city, language }` (only allowed keys; stored as `values_json`; `isMarketCopyValues(values)` = `typeof values.marketItemId === "string"`).

**Idempotency / double click:** client sends a fresh `Idempotency-Key` per confirmed click; the existing replay returns the same generation; the UI disables the button until the response. **Double purchase:** `UNIQUE (item_id, buyer_user_id)` on `market_purchases` + the 409 `already_owned` pre-check; the unique index is the real guard (23505 → map to 409).

### 2.2 Worker side (`lib/generation/market-copy.ts`, hook at the top of `buildArtifactInner`)

`if (isMarketCopyValues(values)) return buildMarketCopy(values, opts)`: load item (`status IN ('active','sold_out','retired')` — a retired item still fulfils paid copies), merge buyer fields into `doc.meta`/`doc.work`/`doc.teacher.school`, recompute slide footers (`deckFooter`), rewrite asset placeholders to the new generation's URLs and return the bytes through the normal `BuiltFile` (assets as `data:` URLs → the worker's `extractAssets` stores them; same path as logos today). Render = `adapterFor(toolId).render`. Then `stampFingerprint(bytes, code)` (`lib/market/fingerprint.ts`: `docProps/core.xml` `<cp:keywords>SLX-<code></cp:keywords>` + `docProps/custom.xml` `SlaydX` property; zip walk reused from `lib/translit/files.ts`). No LLM, `cost_json` stays null. Failure → existing FAILED + full refund + «Qayta urinish» in Ishlarim (and `market_purchases.generation_id` stays; `restore` below re-clones).

### 2.3 After purchase

- The copy appears in **Ishlarim** like any work, with a «Bozordan» badge (`generations.market_item_id` → `GenerationSummary.marketItemId`). Viewer, editor (slides/work/essay/teacher adapters), PDF, PNG, Telegram save/share, rebuild — unchanged.
- **Re-download forever:** the generation is permanent (`expires_at NULL`). If the buyer deleted it: market page → «Xaridlarim» → «Qayta tiklash» (`POST /api/market/purchases/{id}/restore`, free, idempotent while `generation_id IS NULL` or that generation no longer exists) creates a new copy row (no charge; `inTx` only re-points `generation_id`). Retention: copies paid with bonus so'm fall under the existing 180-day `purgeBonusFiles`; restore recovers them (reason to keep the sanitised doc on the item forever).
- **Reselling by a buyer:** copies are never candidates (`market_item_id IS NOT NULL`). Leaks are traced by fingerprint.
- **Rating:** after the copy is COMPLETED and ≥ 10 min old, `POST /api/market/purchases/{id}/rating` (1–5 stars, optional ≤ 300 chars text, once, editable within 7 days). Item shows average when `rating_count ≥ 3`.
- **Refund abuse:** no self-service refund; admin refund requires reason (existing). A refunded purchase (`transactions kind='refund' reference=generation_id`) blocks `restore` and shows «Qaytarilgan».

### 2.4 Insufficient balance return path
402 → `PaySheet` opens the existing wallet top-up (`/uz/wallet?return=/uz/market/<id>?buy=1`); `usePaymentReturn` already handles `return`. After the top-up the item page reopens the confirm sheet with the fresh price.

---

## 3. ANTI-THEFT

### 3.1 Threat model → countermeasure

| Threat | Countermeasure |
|---|---|
| Catalog scraping | Public list returns only card fields (§5 `MarketCard`); cursor pagination ≤ 48; per-IP `IP_LIMITS.marketListPerIp` 300/5 min, per-browser-key 120/5 min (`browserKey` cookie); search ≥ 2 chars; `q` ≤ 100 chars. |
| Preview scraping / hotlinking | Rasters are low-res (≤ 720 px wide, JPEG q 60), tiled diagonal watermark «SlaydX · namuna», only `market.preview_pages` (default 2; decks 3 slides) pages; later pages served as 64-px-wide blurred stubs (unreadable by construction). `Cache-Control: public, max-age=86400, immutable` keyed by `?v=<preview_version>` (cheap at 50k users); per-IP 600/5 min. Hotlinking is harmless (watermarked). |
| API enumeration | UUID v4 ids; item GET only for `active/sold_out`; 404 for everything else (no status oracle). |
| Devtools / viewer leak | Non-buyers never receive `doc_json`, `outline` beyond section **titles**, slide text or any file bytes. The item page uses rasters, not `SlideCanvas`. The `preview.slide` JSON model is NOT used for market cards. |
| Viewer / download routes | Must stay owner-only (verified in code, SQL ownership): `GET /api/generations/[id]` (`getGeneration(id, user.id)`), `/file` (`getGenerationFile … AND g.user_id=$2`), `/download` + `/api/dl/[token]` (token carries `u`), `/assets/[assetId]` (`getAsset(id, assetId, user.id)`), `/thumb` (`getOrBuildVersionedThumb(id, user.id)`), `/doc`, `/rebuild`, `/results`, `/telegram/save|share`, `/slides/[index]/image`, `/photo`. Market adds NO route that reads a generation by id without `user_id`. Tests: `tests/market-routes-guard.test.mts` hits every market route with a foreign user and asserts 404/403. |
| SSR/SEO leak | Item page SSR renders title, summary, outline headings, meta facts, previews. `tests/market-ssr-leak.test.mts` renders the page with a fixture doc and asserts no body sentence appears in the HTML. `robots.ts`: allow `/uz/market`, `noindex` on `?q=` result pages. |
| Telegram WebApp | Same session/`?bt=` auth; previews are plain `<img>` (no `window.open`). |
| CDN / nginx | Only `/api/market/items/*/preview/*` is cacheable; all other market JSON `private, no-store`. |
| Admin-only originals | `source_generation_id` + neutral file readable only via `GET /api/admin/market/items/{id}/file` (`market.manage`, audited `market.file_read`). |
| Buyer leaking the file | M13 fingerprint (`SLX-` + 10 base32 chars = HMAC(`SESSION_SECRET`, purchaseId)); `generation_files.downloads` counter per copy; admin item page lists buyers (masked) with download counts; «Suiiste'mol» flag on a purchase (`market_purchases.abuse_flag`, reason, audited) blocks restore and rating. |
| Account farming (many accounts buying one item to resell) | University cap (M9), item caps, signup bonus rules already limited; `market.paid_only` switch if bonus abuse appears; admin stats show purchases by signup age. |
| Screenshotting the viewer after purchase | Accepted: a buyer owns the content. Pre-purchase screenshots get only watermarked rasters. |
| Refund abuse | §2.3. |
| Price tampering | Price computed server-side; `expectedPrice` guard; `price_version` re-checked in the charge transaction. |
| Chat tool (`CHAT_EXCLUDED_TOOLS`) | Unaffected: market is not a `ToolId`; `isChatTool` sees no change. |

### 3.2 Preview raster pipeline (`lib/server/market/previews.ts`)
Lazy on first request (thumb.ts pattern: in-flight map, `soffice` gate, 503 → placeholder): neutral file → `toPdf` (web container) → `pdftoppm -r 60 -jpeg` first N pages → `sharp` composite watermark SVG + downscale; blurred stubs for pages N+1…min(total, 6). Stored in `market_previews`, `preview_version` bumped on re-sanitise. Decks: N = 3 slides. Admin «Qayta chizish» button.

---

## 4. PRICING (`lib/market/pricing.ts` pure + `lib/server/market/pricing.ts`)

```
original = effectivePrice(TOOL_BY_ID[item.tool_id], paramsAsFormValues(item.params_json))   // base × tool_pricing, live
pct      = item.price_override ? null : (market_tool_pricing[tool].percent ?? setting market.percent)   // default 50
raw      = item.price_override ?? Math.round(original * pct / 100)
price    = Math.max(setting market.min_price (1000), roundTo(raw, setting market.round_to (500)))
```
- `tool_pricing` interplay: applied inside `original` → the market follows the admin's original adjustments; the market % is on top, never compounding twice.
- Per-item override is absolute so'm (admin, `pricing.edit`, step-up, reason, audited `market.price`).
- `original_price` snapshot stored on the item at approval (display «Asl narx» if the live original is unavailable, e.g. tool paused); the live value wins when computable.
- Display: «1 500 so'm  ~~3 000~~  −50 %». Both numbers come from one server function; the client never computes.
- Cost telemetry: copies have `cost_json NULL` → AI-cost reports see 0 cost; admin market stats compute revenue from `market_purchases.price` minus refunds (ledger).
- `price_version` on `market_items` increments on any override/percent change (settings change bumps a global `market.price_epoch` compared too) → concurrent checkout gets 409.

---

## 5. DISCOVERY & UX

Naming: **«Ishlar bozori»** (short «Bozor»). Routes: `/uz/market` (catalog), `/uz/market/[id]` (item), `/uz/market/purchases` («Xaridlarim»). Design language: existing tokens (`--primary #f59e0b`, cards `bg-card border-border rounded-[--radius]`), `PageHeader`, `Card/Row/Segmented/SelectField` from `components/forms/compact.tsx`, lucide icons, Geist; dark mode via `.dark` tokens; targets ≥ 44 px; safe-area aware (`components/shell/safe-area.ts`).

### 5.1 Entry points
1. **Home hub** (`HomeHub`): new `HubSection id="market" title="Ishlar bozori"` between «Davom ettirish» and «Barcha vositalar»: horizontal rail of 6 cards (popular) + «Hammasi →». Hidden while `features.market` is false.
2. **Service tile** in `lib/services.ts`: `{ id: "market", href: "/uz/market", title: "Ishlar bozori", description: "Tayyor slayd, referat, insho · 2 barobar arzon", icon: "store", tc: "16 185 129", group: "talaba", badge: "−50 %", flag: "market" }` → appears in «+» sheet, `/uz/create`, hub groups, search.
3. **After-generation upsell** on tool pages (`MarketSuggest`, mounted by the tool page wrapper, not inside composers): when `topic.length ≥ 8` and the tool is in the registry → debounce 600 ms → `GET /api/market/suggest?tool=&q=` → chip «Tayyor varianti bor: «<title>» — 1 500 so'm» → item page. On the generation result page: «Shunga o'xshash tayyor ishlar» (3 cards) only for registry tools.
4. **Bot**: keyboard `web_app` button «🛍 Ishlar bozori» (behind the flag) + `/market` in-chat screen (§7).
5. **Bottom tabs unchanged** (4 tabs + «+»; a fifth would crowd phones).

### 5.2 Catalog page (`/uz/market`)
- Header `PageHeader title="Ishlar bozori" subtitle="Tayyor ishlar — asl narxdan 2 barobar arzon"` + search field (`HubSearch` styling).
- **Filter bar** (sticky, horizontal scroll): tool chips (Slayd, Pro slayd, Referat, Mustaqil ish, Kurs ishi, Insho, Tezis, Konspekt, Dars rejasi) → `?tool=`; subject `SelectField` (14) → `?subject=`; level `Segmented` (Maktab/Kollej/OTM); sort `SelectField` (Yangi · Ommabop · Arzon · Yuqori baho). Phone: one row of chips + «Filtr» button opening a sheet (reuses `useDialog` overlay history → phone back closes it).
- **Grid**: 2 columns at 360 px, 3 at ≥ 768, 4 at ≥ 1200. Card = cover raster (aspect 3:4 docs, 16:9 decks) with tool badge top-left, price row «1 500 so'm ~~3 000~~», title (2 lines), meta line «Referat · 15–20 bet · O'zbekcha», sold count «12 marta olingan», stars when ≥ 3 ratings.
- Infinite scroll with cursor; skeleton shimmer cards (`slx-shimmer`).
- **Empty states**: no results → «Hech narsa topilmadi. Boshqa so'z bilan qidiring yoki shu mavzuda yangi ish yarating →» (button to the tool); market empty (dark launch / no approved items) → page shows «Bozor tez orada ochiladi» only for admins; for users the entry points are hidden by the flag.
- Search: Postgres FTS on `search_text` (`to_tsvector('simple', …)`), query normalised the same way (Cyrillic → Latin through `lib/translit convert(text,"cyr","lat")`, `ʻ’'` → `'`, lowercase); `plainto_tsquery` + prefix match on the last token; if `pg_trgm` is installed (`market.trgm_available` detected at migration time) fall back to `similarity(topic_norm, q) > 0.3` when FTS returns < 3 rows. Results page `noindex`.

### 5.3 Item page (`/uz/market/[id]`)
Desktop: two columns — left preview carousel (cover + pages/slides, blurred stubs with lock icon «Xariddan keyin to'liq»), right «sticky» buy card: price block, «Sotib olish» primary (44 px), facts list (Vosita, Hajm «18 bet» / «12 slayd», Til, Fan, Daraja, «N marta olingan», baho), «Nima olasiz» bullets (DOCX/PPTX + PDF, saytda ko'rish va tahrirlash, Telegramga yuborish, titul sahifa o'z ismingiz bilan), outline «Mundarija» (section titles only), «Shu mavzuda yangi yaratish» secondary link (M10). Phone: single column, buy bar fixed above the tab-bar area (`SAFE_BOTTOM`).
Buy sheet («Titul sahifasi»): `AuthorRows` prefilled from profile (author, university, faculty/department, group, course, teacher, city); required = the tool's `CUSTOM_REQUIRED` set; price line; «Tasdiqlash — 1 500 so'm»; balance chip; 402 → top-up path. Success → navigate to `/uz/files/<generationId>` (progress «Nusxa tayyorlanmoqda», then the viewer). Owned → button becomes «Ishlarimda ochish».

### 5.4 Accessibility & i18n
All images have `alt` «<title> — 1-sahifa namunasi»; focus rings (`--ring`); filter chips are buttons with `aria-pressed`; price announced as text; `prefers-reduced-motion` honoured by the carousel. UI copy Uzbek Latin; doc language shown as «O'zbekcha / Ruscha / Inglizcha / Kirill».

---

## 6. ADMIN (`/admin/market`, nav group «Boshqaruv», icon `store`)

Permissions (additive in `admin-rbac.ts`): `market.view` (ALL roles), `market.manage` (owner, admin, moderator; in `STEP_UP`? **no** — approval is not money), price override uses existing `pricing.edit` (step-up), settings via `settings.edit`.

Tabs:
1. **Navbat** — candidates: table (title, tool, subject, quality score, PII flags count, source age, duplicates note), row → drawer: sanitised preview (rendered through the real `WordViewer`/`SlideViewer` from the sanitised doc — admin only), flags list with paths, editable title/summary/subject/level/max copies, «Tasdiqlash» / «Rad etish (sabab)» / «Qayta tozalash». Bulk approve ≤ 20 with one reason.
2. **Katalog** — active/sold_out/retired items: search, sold count, revenue, rating, «Narx» (override dialog, step-up), «Olib tashlash (sabab)», «Qayta chizish» previews, buyers list (masked name, date, downloads, abuse flag).
3. **Sotuvlar** — KPIs for range (7/30/90 days, Tashkent days): purchases, revenue (ledger net of refunds), avg price, conversion (purchases / item views; `market_views` daily upsert), top 10 items, by tool, by subject, refunds; CSV export under `finance.export`.
4. **Sozlamalar** — link to Sozlamalar → tab «Bozor» (keys below) + per-tool % table (`market_tool_pricing`, `pricing.edit`).

Audit actions (all in `adminTx`): `market.approve`, `market.reject`, `market.edit`, `market.retire`, `market.resanitize`, `market.price`, `market.tool_pricing`, `market.scan`, `market.file_read`, `market.abuse_flag`. Mutations need `Idempotency-Key` (existing `idempotentMutation`).

Settings (`lib/server/settings.ts` + `components/admin/settings/layout.ts` tab `market` «Bozor»; `market.enabled` also listed in «Funksiyalar»):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `market.enabled` | bool | **false** | Whole feature (session `features.market`, all `/api/market` → 503 `market_disabled` except admin). |
| `market.percent` | int 10–100 | 50 | Global share of the original price. |
| `market.round_to` | int ∈ {100,500,1000} | 500 | Rounding. |
| `market.min_price` | int 0–20000 | 1000 | Floor. |
| `market.paid_only` | bool | false | Bonus so'm may not pay. |
| `market.author_reward_percent` | int 0–50 | 0 | Bonus so'm to the source author per sale. |
| `market.max_copies_slides` / `_teacher` / `_essay` / `_work` / `_thesis` | int 1–1000 | 30 / 50 / 10 / 5 / 3 | Default `max_copies` by family at approval (editable per item). |
| `market.same_university_cap` | int 0–50 (0 = off) | 2 | Purchases per (item, normalised university). |
| `market.preview_pages` | int 1–5 | 2 | Pages rendered as previews (decks: +1). |
| `market.min_quality` | int 0–100 | 70 | Candidate threshold. |
| `market.per_topic_limit` | int 1–20 | 3 | Active items per (tool, topic). |
| `market.backfill_batch` | int 0–1000 | 100 | Candidates per 6 h scan (0 = scanner off). |
| `market.tools_disabled` | tool_ids | [] | Tools withdrawn from the market at runtime. |

---

## 7. BOT (one service layer)

- `lib/server/bot/keyboard.ts`: action `market` → `web_app` «🛍 Ishlar bozori» (path `/uz/market`, shown when `market.enabled`). Keyboard refresh follows the existing `keyboardMessage` flow.
- `/market` command and the keyboard text: `marketScreen(lang, items)` = 5 newest active items (`listMarketItems({sort:"new", limit:5})` — the same service the web uses) with inline `web_app` buttons «Ko'rish — 1 500 so'm» (deep link `/uz/market/<id>`). No in-chat purchase in v1 (the title-page form needs the web; one flow = fewer money paths).
- Delivery: a finished copy is a generation → the existing «Botga yuborish» and the bot «Ishlarim» screen list it; after COMPLETED the worker's existing completion DM path (if any) is unchanged. Opt-out toggle on the bot profile screen (`profile.ts`), same service as the web.
- i18n keys `market.*` in `bot/i18n.ts` (uz/ru/en).

---

## 8. DATA MODEL

### 8.1 Migration `073_market_core.sql` (additive, header + ROLLBACK block, `SET LOCAL lock_timeout='5s'`)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS market_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE generations ADD COLUMN IF NOT EXISTS market_item_id UUID;          -- set on bought copies only
CREATE INDEX IF NOT EXISTS generations_market_item_idx ON generations (market_item_id) WHERE market_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS market_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_generation_id  UUID REFERENCES generations(id) ON DELETE SET NULL,
  source_user_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  tool_id               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('candidate','active','sold_out','retired','rejected')),
  title                 TEXT NOT NULL,                 -- ≤ 160
  summary               TEXT NOT NULL DEFAULT '',      -- ≤ 400, admin-editable
  subject               TEXT NOT NULL DEFAULT 'boshqa',
  level                 TEXT NOT NULL DEFAULT 'otm' CHECK (level IN ('maktab','kollej','otm')),
  language              TEXT NOT NULL DEFAULT 'uz',
  pages                 INT, slide_count INT,
  doc_json              JSONB NOT NULL,                -- sanitised AcademicDoc (asset placeholders)
  params_json           JSONB NOT NULL DEFAULT '{}',   -- allow-listed form params (pricing + viewer)
  outline_json          JSONB NOT NULL DEFAULT '[]',   -- section titles only
  pii_flags             JSONB NOT NULL DEFAULT '[]',
  quality_json          JSONB NOT NULL DEFAULT '{}',   -- {score, parts}
  topic_norm            TEXT NOT NULL,
  simhash               BIGINT NOT NULL DEFAULT 0,
  search_text           TEXT NOT NULL DEFAULT '',      -- normalised Latin title+summary+outline
  original_price        BIGINT NOT NULL DEFAULT 0,     -- snapshot at approval
  price_override        BIGINT CHECK (price_override IS NULL OR price_override >= 0),
  price_version         INT NOT NULL DEFAULT 1,
  max_copies            INT CHECK (max_copies IS NULL OR max_copies > 0),
  sold_count            INT NOT NULL DEFAULT 0,
  view_count            BIGINT NOT NULL DEFAULT 0,
  rating_sum            INT NOT NULL DEFAULT 0, rating_count INT NOT NULL DEFAULT 0,
  preview_version       INT NOT NULL DEFAULT 1,
  reject_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at           TIMESTAMPTZ, approved_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL,
  retired_at            TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_items_source_idx ON market_items (source_generation_id) WHERE source_generation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_items_catalog_idx  ON market_items (approved_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_popular_idx  ON market_items (sold_count DESC, id DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_tool_idx     ON market_items (tool_id, approved_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_subject_idx  ON market_items (subject, approved_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_items_topic_idx    ON market_items (tool_id, topic_norm) WHERE status IN ('candidate','active','sold_out');
CREATE INDEX IF NOT EXISTS market_items_queue_idx    ON market_items (created_at DESC) WHERE status = 'candidate';

CREATE TABLE IF NOT EXISTS market_item_files (        -- neutral render, admin-only
  item_id UUID PRIMARY KEY REFERENCES market_items(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, mime TEXT NOT NULL, size_bytes BIGINT NOT NULL, bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS market_assets (            -- copied generation_assets of the source
  item_id UUID NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL, mime TEXT NOT NULL, size_bytes BIGINT NOT NULL, bytes BYTEA NOT NULL,
  PRIMARY KEY (item_id, asset_id));
CREATE TABLE IF NOT EXISTS market_previews (
  item_id UUID NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
  page SMALLINT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('page','stub')),
  mime TEXT NOT NULL, size_bytes INT NOT NULL, bytes BYTEA NOT NULL, version INT NOT NULL,
  PRIMARY KEY (item_id, page));

CREATE TABLE IF NOT EXISTS market_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID NOT NULL REFERENCES market_items(id) ON DELETE RESTRICT,
  buyer_user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id   UUID REFERENCES generations(id) ON DELETE SET NULL,
  price           BIGINT NOT NULL, original_price BIGINT NOT NULL,
  university_norm TEXT NOT NULL DEFAULT '',
  fingerprint     TEXT NOT NULL,
  abuse_flag      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(), restored_at TIMESTAMPTZ,
  UNIQUE (item_id, buyer_user_id));
CREATE INDEX IF NOT EXISTS market_purchases_buyer_idx ON market_purchases (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_purchases_item_idx  ON market_purchases (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_purchases_day_idx   ON market_purchases (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS market_ratings (
  purchase_id UUID PRIMARY KEY REFERENCES market_purchases(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5), text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS market_tool_pricing (
  tool_id TEXT PRIMARY KEY, percent INT NOT NULL CHECK (percent BETWEEN 10 AND 100),
  updated_by BIGINT REFERENCES admin_accounts(id) ON DELETE SET NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS market_views (
  item_id UUID NOT NULL REFERENCES market_items(id) ON DELETE CASCADE, day DATE NOT NULL, views INT NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, day));
```
`gen_random_uuid()` is core in PG 13+ (prod is postgres:16). `transactions.kind` needs **no change** (purchase = `charge` with the generation id; reward = `bonus`).

### 8.2 Migration `074_market_search.sql`
`ALTER TABLE market_items ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED; CREATE INDEX … USING GIN (search_tsv);` plus a guarded `DO $$ … CREATE EXTENSION IF NOT EXISTS pg_trgm … EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE … $$;` (036 pattern) and, when it exists, `CREATE INDEX … USING GIN (topic_norm gin_trgm_ops)`. The server detects `pg_trgm` once at boot (`SELECT 1 FROM pg_extension WHERE extname='pg_trgm'`).

`075` reserved for follow-ups found during build (not used by WPs without the lead's OK).

### 8.3 Storage & scale
- Sanitised `doc_json` ≈ 50–400 KB (TOAST), neutral file 0.1–6 MB (pro-slide decks with images are the heavy end: `PPTX_SIZE_LIMIT` bound), previews ≈ 3 × 40 KB + stubs 2 KB. 2 000 items ≈ 4–8 GB worst case — **live check**: measure `avg(size_bytes)` of `generation_files` per registry tool on prod before the first scan; `market.backfill_batch` throttles growth. Market assets are copied once per item, and once more per buyer copy (same as any generation today).
- Catalog query = partial index scan + ≤ 48 rows; first page per `(tool, subject, level, sort)` cached in-process 15 s (settings-cache pattern). Item page: one row + previews by `(item_id,page)`.
- `view_count`: `market_views` upsert, debounced per (user|browserKey, item) 1 h via `rateLimit`.
- Housekeeping steps: `market-candidates` (6 h), `market-previews-gc` (delete previews of `retired/rejected` items older than 30 days), `market-rejected-gc` (rejected rows older than 90 days lose `doc_json` → `'{}'`, keep the row so the scan stays idempotent).
- Concurrency: sold-out and university caps are enforced inside the charge transaction with `UPDATE … RETURNING` (row lock on the item), `UNIQUE (item_id, buyer_user_id)` guards double purchase, `price_version` guards mid-checkout price edits. The candidate scanner takes `pg_try_advisory_lock(727_000_006)`.

---

## 9. EDGE CASES

| Situation | Behaviour |
|---|---|
| Item retired/sold-out after purchase | Copy stays; restore still works (`status IN active/sold_out/retired`); item page shows «Sotuvda yo'q» but «Ishlarimda ochish» for owners. |
| Tool removed from registry / `market.tools_disabled` | Active items of that tool hidden (list filter), purchases refused 410 `gone`; owners keep copies; the worker's clone still renders (adapter stays). |
| Price changed mid-checkout | 409 `price_changed {price}` → sheet shows the new price, new Idempotency-Key on confirm. |
| Sanitiser fails on a candidate | Row written `rejected` reason `sanitize_error` with the error (admin sees it under «Xatolar» filter); scan continues. |
| Clone render fails for a buyer | Existing FAILED path: full refund (`refundThenCleanup`), `market_purchases` row stays with `generation_id` of the failed row; «Qayta urinish» = `restore` (free). `sold_count` is NOT decremented (simplicity; admin can raise `max_copies`). |
| Cyrillic works | `language` = `uz-cyr` detected from script share (≥ 60 % Cyrillic letters); shown «Kirill»; search normalises both scripts to Latin. |
| Old doc shape (legacy generations without `work`/`slides` model) | `adapterFor(tool).hasModel(doc)` false → not a candidate (reason `legacy`). |
| User deleted his source generation | Item unaffected (own copy of doc, assets, file); `source_generation_id` → NULL. |
| User deleted account | `source_user_id` → NULL; author reward silently skipped; buyer deletion cascades purchases (copies are his generations, cascaded too). |
| Blocked user | `requireUser` refuses; his generations are not candidates; his existing active items stay (sanitised); admin may retire. |
| Opt-out set later | His `candidate` rows deleted; `active` ones stay (no PII); admin list shows «muallif voz kechgan» badge for manual retire. |
| Moderation / illegal, hateful, medical, legal advice content | Admin approval is the gate; the candidate drawer shows the full text; reject reasons list includes «Noqonuniy/zararli», «Tibbiy/huquqiy maslahat», «Mualliflik huquqi». Users can «Shikoyat» on an item page (`POST /api/market/items/{id}/report`, 1 per user per item, rate-limited) → admin queue filter «Shikoyatlar»; 3 reports auto-hide (`status` unchanged, `hidden_until_review` flag in `quality_json`) pending review. |
| Copyright complaint from a third party | Admin «Olib tashlash» with reason `copyright`; purchases keep copies (we cannot recall files); audit row + ledger untouched. |
| Language variants (ru/en works) | Allowed; `language` facet; UI chrome stays Uzbek. |
| `CHAT_EXCLUDED_TOOLS` / AI chat | Unchanged. Chat may later recommend market items (not in v1). |
| Oferta gate on | Purchase 403 `offer_required` → existing modal, then retry. |
| Mandatory channels | Purchase 403 `channel_required` → existing gate UI. |
| Admin pause (`generation.paused` or tool paused) | Purchase 503 `paused` (the worker must render). Catalog stays browsable with «Hozircha xarid to'xtatilgan» strip. |
| `market.enabled` turned off while users browse | Every market API → 503 `market_disabled`; pages show «Bozor vaqtincha yopiq»; copies in Ishlarim unaffected. |
| Refund after download | Only admin; the copy stays (we cannot un-download); purchase marked refunded; restore and rating disabled. |
| Buyer buys the same item twice (two tabs) | Second insert hits `UNIQUE` → tx rollback → 409 `already_owned {generationId}`; no charge. |
| University cap reached | 409 `university_cap` «Bu ish sizning muassasangizda allaqachon olingan — boshqa variantni tanlang»; suggestions list of same-topic items. |
| Buyer edits his copy in the viewer | Allowed (his generation); edits never flow back to the item. |
| Source author edits/rebuilds his work after the scan | Irrelevant: the item holds its own snapshot. |
| Worker image lacks LibreOffice | Clone needs only `renderDocx`/`renderPptx` (JS). Previews run in the web container (soffice there). |
| `pg_trgm` missing on prod | FTS only; fuzzy fallback disabled; admin System page shows «pg_trgm: yo'q». |
| Soffice gate busy during preview build | 503 → card/page shows a neutral placeholder cover (tool icon + title), retried on next view. |
| Huge pro-slide deck (> 25 MB) | Candidate skipped (reason `too_large`, threshold `PPTX_SIZE_LIMIT`). |
| Telegram Desktop cookieless session | Same Bearer fallback as everywhere (`docs/auth/COOKIELESS.md`). |
| Retention purge of bonus-paid copies (180 d) | Files purged; `restore` re-clones for free (doc lives on the item). |

---

## 10. BUILD PLAN

Four opus builders in separate worktrees from `feat/market-plan` merged into `main` first (plan only). **WP-A merges first; B, C, D start from the A branch** (they import its types/SQL). Lead merges, runs the full suite via `scripts/heavy.sh`, browser smoke, deploys dark.

### 10.1 Shared contracts (fixed here; builders must not change them without the lead)

`lib/market/types.ts` (WP-A writes it in its first commit):
```ts
export type MarketStatus = "candidate" | "active" | "sold_out" | "retired" | "rejected";
export type MarketLevel = "maktab" | "kollej" | "otm";
export type MarketSubjectId = "matematika" | "fizika" | "kimyo" | "biologiya" | "informatika" | "tarix" | "ona-tili-adabiyot" | "ingliz-tili" | "iqtisodiyot" | "huquq" | "pedagogika-psixologiya" | "tibbiyot" | "texnika" | "boshqa";
export type MarketSort = "new" | "popular" | "cheap" | "rating";
export type MarketCard = { id: string; toolId: ToolId; title: string; summary: string; subject: MarketSubjectId; level: MarketLevel; language: string;
  pages: number | null; slideCount: number | null; price: number; originalPrice: number; soldCount: number; rating: { avg: number; count: number } | null;
  cover: string /* /api/market/items/{id}/preview/1?v= */; status: "active" | "sold_out" };
export type MarketItemView = MarketCard & { outline: string[]; previewPages: number; totalPages: number | null; owned: { generationId: string | null; purchaseId: string } | null;
  requiredFields: string[]; createTool: { slug: string; topic: string } };
export type MarketListResponse = { items: MarketCard[]; nextCursor: string | null; facets: { tools: { id: ToolId; count: number }[]; subjects: { id: MarketSubjectId; count: number }[] } };
export type PurchaseFields = { author?: string; university?: string; faculty?: string; department?: string; group?: string; course?: string; teacher?: string; city?: string };
export type PurchaseRequest = { expectedPrice: number; fields: PurchaseFields };
export type PurchaseResponse = { generationId: string; price: number; replayed: boolean };
export type MarketCloneValues = PurchaseFields & { marketItemId: string; language?: string };
export const isMarketCopyValues = (v: Record<string, unknown>): v is MarketCloneValues => typeof v.marketItemId === "string";
```
API routes, error codes (`market_disabled`, `gone`, `sold_out`, `already_owned`, `price_changed`, `university_cap`, `offer_required`, `channel_required`, `paused`), settings keys (§6), permissions `market.view`/`market.manage`, audit action names (§6), ledger references (`generation id` for the charge; `market-author:<purchaseId>`), migration numbers 073/074, `EnqueueInput.inTx?: (client: PoolClient, generationId: string) => Promise<void>` (runs after the generations INSERT, inside the transaction; a throw rolls back charge + row), `Features.market?: boolean`, service id `market`.

### 10.2 Packages (disjoint ownership)

| WP | Model | Owns (files) | Delivers | Depends |
|---|---|---|---|---|
| **A — Core & supply** | opus | `lib/market/{types,registry,subjects,sanitize,params,normalize,simhash,quality,pricing}.ts`; `lib/server/market/{items,candidates,pricing,previews,search,store}.ts`; `lib/server/migrations/073_market_core.sql`, `074_market_search.sql`; `lib/server/settings.ts` (+keys), `components/admin/settings/layout.ts` (tab «Bozor»), `lib/server/edit-adapters.ts` (konspekt line, M14); `lib/server/worker.ts` (housekeeping steps `market-candidates`, `market-previews-gc`, `market-rejected-gc` only); `lib/server/ip-limits.ts` (+keys); tests `tests/market-{sanitize,params,quality,pricing,candidates,search,previews,migration}.test.mts` | Types, schema, sanitiser, candidate scanner, catalog read services (`listMarketItems`, `getMarketItem`, `suggestMarketItems`), price function, preview builder | — |
| **B — Buying & worker** 🔒 money review | opus | `lib/server/market/{purchase,restore,ratings,reports,opt-out}.ts`; `lib/generation/market-copy.ts` + one hook line in `lib/generation/index.ts`; `lib/market/fingerprint.ts`; `lib/server/jobs.ts` (`inTx` hook + `marketItemId` in summaries); `app/api/market/**`; `app/api/auth/session/route.ts` (`features.market`); tests `tests/market-{purchase,clone,restore,ratings,routes-guard,fingerprint}.test.mts` | Purchase/replay/409/402/410, clone build, restore, rating, report, opt-out service + routes, public catalog routes wired to A's services | A |
| **C — Web UI** | opus | `app/uz/market/**`; `components/market/**`; `lib/api-client.ts` (market client fns, `Features.market`); `lib/services.ts` (+market tile); `components/home/HomeHub.tsx` + `components/home/hub/MarketRail.tsx`; `components/home/FilePreview.tsx` (badge); `components/profile/**` (opt-out toggle); tool page wrapper for `MarketSuggest` (`app/uz/[slug]/page.tsx` + `components/market/MarketSuggest.tsx`); `app/sitemap.ts`, `app/robots.ts`; tests `tests/ui/market-*.test.mts`, `tests/viewer/market-ssr-leak.test.mts` | Catalog, item, buy sheet, Xaridlarim, entry points, SEO, dark mode, phone layouts | A (types), B (routes; C stubs `fetch` in tests until B lands) |
| **D — Admin & bot** | opus | `app/admin/(panel)/market/**`; `components/admin/market/**`; `components/admin/shell/nav-registry.ts`; `lib/server/admin-rbac.ts` (+2 permissions); `lib/server/admin-market.ts`; `app/api/admin/market/**`; `lib/server/bot/{keyboard,screens,router,profile,i18n}.ts` (market button, `/market`, opt-out line); tests `tests/admin-market*.test.mts`, `tests/bot-market.test.mts`; update `tests/admin-permission-matrix.test.mts` & `tests/admin-nav-registry.test.mts` to the new contract (equal strength) | Queue/approve/reject/edit/retire/price/stats/scan, bot entry | A (+ B for opt-out service: D calls `lib/server/market/opt-out.ts`; until merged D stubs in tests) |

Order: A (≈ 1.5 days) → B ∥ C ∥ D (≈ 2 days) → lead merge in the order B, D, C → full `npm run check` under heavy.sh → browser smoke → PR → deploy dark.

### 10.3 Tests (each new assertion mutation-checked; list before→after for any rewritten assertion)

- **Sanitiser** (A): fixture docs per tool (slide w/ logo+footer, work w/ custom ministry+userFacts, essay first-person with the author's name in the body, lesson-plan with approver, thesis) → every PII path empty, footers `""`, flags listed with paths, asset URLs → placeholders, `params` only allow-listed keys. Mutations: skip `work.teacher` clear → fails; drop phone regex → fails; keep `userFacts` → fails.
- **Quality/dedupe** (A): score parts; threshold; `simhash` Hamming on near-identical texts ≤ 6, different ≥ 20; `topic_norm` Cyrillic/Latin equality («Ўзбекистон тарихи» == «O'zbekiston tarixi»).
- **Candidates** (A, isolated DB): seed via `enqueueGeneration` + `commitJobResult`; the scan picks only eligible rows (each exclusion rule has a row that must NOT be picked: refunded, partial refund, purged, opted out, blocked, admin, sourceAssetId, copy, < 24 h, duplicate, per-topic limit, quality low); idempotent second scan; batch size honoured; advisory lock.
- **Pricing** (A): 50 % of `effectivePrice` with a `tool_pricing` row present (no double application), per-tool %, override, rounding, min; `price_version` bump on each change.
- **Search** (A): FTS hits for Latin/Cyrillic/apostrophe variants; prefix on last token; `pg_trgm` branch skipped when absent (EXPLAIN uses GIN).
- **Purchase** (B, isolated DB, real routes): happy path (ledger `charge` reference = generation id, purchase row, `sold_count` +1, `generations.market_item_id`), replay with same key (no second charge), concurrent two keys → one 409 `already_owned`, 402 with bonus/paid split, `paid_only`, 409 `price_changed`, sold-out at cap (tx rollback: no charge, no row), university cap, 410 for retired, 503 disabled/paused, 403 offer/channel, author reward paid once (ref `market-author:`), reward 0 default → no row. Mutations: remove `RETURNING` cap check → sold-out test fails; charge outside `inTx` → rollback test fails.
- **Clone** (B): `buildArtifact` with `marketItemId` values makes zero `fetch` calls (stubbed fetch asserts 0), renders DOCX/PPTX, title page shows buyer fields (`titleModel(doc)`), assets rewritten to the new id, fingerprint present in `docProps/core.xml`; FAILED path refunds (existing worker test harness).
- **Routes guard** (B): every `/api/market/*` and the generation routes with a foreign user → 404/403; non-buyer never receives `doc`, `slides`, `sections`.
- **Admin** (D): permission matrix rows for the new routes; approve writes audit + neutral file in one tx (failing render rolls back); reject reason required; price override needs step-up; stats fixture hand-computed; scan trigger.
- **Bot** (D): keyboard shows the button only when enabled; `/market` screen lists 5 items with web_app links.
- **UI** (C, jsdom): filter chips update the query; buy sheet required fields; 402 opens top-up path; 409 shows new price; owned state; empty states; `assert.ok(!el)` rule.
- **SSR leak** (C): item page HTML contains no body sentence of the fixture doc.

### 10.4 Browser smoke (lead + C, Playwright/Chromium via `scripts/smoke/gpu-launch.cjs`, Telegram stub, 360×740 / 390×844 / 1366×768, light+dark)
Catalog scroll without horizontal overflow; filter sheet opens/closes with phone back; item page carousel, blurred stubs, buy bar above tab bar; buy sheet → 402 path → wallet → return; successful purchase → progress → viewer; «Bozordan» badge in Ishlarim; admin queue drawer renders sanitised preview; screenshots LOOKED at.

### 10.5 Rollout
1. Merge → CI → deploy (dark: `market.enabled=false`; nothing visible).
2. Prod: run `SELECT avg(size_bytes), count(*) FROM generation_files f JOIN generations g … WHERE tool_id IN (registry)` (storage estimate) and `SELECT 1 FROM pg_extension WHERE extname='pg_trgm'`.
3. Admin: set `market.backfill_batch`, trigger a scan, approve 20–30 items across tools, inspect previews and the PII flags, fix sanitiser gaps if any (patch release).
4. Owner: approve the oferta clause text; decide on `oferta.version` bump; look at the catalog as a user (admin sees the dark catalog).
5. Switch `market.enabled` on; broadcast announcement (existing E'lonlar) to active users; watch `/admin/market` Sotuvlar, worker logs `[market]`, failed-copy ratio alert (reuse failed-generation ratio rule).
6. Week 1 review: caps, percent, subjects correctness, search quality.

### 10.6 Live checks that must confirm plan assumptions
- `pg_trgm` present on prod Postgres (else FTS-only path).
- LibreOffice preview build time per item under the soffice gate at peak (< 8 s), else pre-build previews at approval instead of lazily.
- Storage: average sanitised `doc_json` + neutral file size per tool on real data; set `market.backfill_batch` accordingly.
- `renderPptx` in the worker image for market copies (fonts present since the parity fixes) — one real pro-slide copy in prod.
- The name-scrub false-positive rate on real essays (common words as names) — tune min token length / stop-list before enabling.
- Oferta wording and whether a version bump is wanted at launch.

---

## 11. Findings in the current code relevant to this feature

1. **Konspekt has no edit adapter** (`lib/server/edit-adapters.ts` `workAdapter.tools` = coursework, referat, mustaqil-ish): konspekt cannot be re-rendered from `doc_json` by `ensureFreshFileShared`/`rebuildFile`, and the viewer cannot edit it. The copy pipeline needs the adapter → M14 adds `"konspekt"` (its doc has `work` + `sections`, rendered by `renderDocx` like the others). Side effect: konspekt becomes editable in the viewer — a behaviour change to mention in the release note.
2. **Oferta has no clause about reuse of generated materials** (`lib/oferta/text.ts`): clause needed before the market goes live (§1.3).
3. `pptx.author = doc.meta.author` and the deck footer (`deckFooter`) put the author's identity into every slide's footer and the PPTX core properties — correct for the owner's own file, and exactly what the sanitiser must clear (and does).
4. `enqueueGeneration` has no in-transaction extension point; the `inTx` hook (contract above) is the minimal additive change that keeps «charge + row + purchase + caps» atomic without a second money path.
5. `transactions.note` for a copy will read `<toolId>: <title>` like any generation; the wallet history therefore shows a bought referat as a referat charge. Acceptable; if the owner wants «Bozor:» wording, `EnqueueInput.note?` is a one-line follow-up (not in v1 to keep ledger parsing in `wallet-model.ts`/bot screens untouched).
6. `robots.ts` disallows `/uz/files/` and `/uz/profile` but has no rule for `/uz/market` — add `allow` + `noindex` for search result pages in WP-C.
