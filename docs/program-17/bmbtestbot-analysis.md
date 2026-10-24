# bmbtestbot (@BMB_testbot) analysis and SlaydX import plan

Date: 2026-10-24. Source: read-only inspection of <prod-server> (code, `pg_stat`, schema, counts, 3 sample rows). Nothing was changed on the server. No secrets were read or printed.

## 1. TL;DR

- **Two different bots exist on the box. Do not confuse them.**
  1. **@BMB_testbot = `/home/ques/ques-bot`** (systemd `sav.service`, ACTIVE, Postgres DB `ques`). This is the live one: 190k accounts, 425k finished attempts. Its question bank is **390 questions, each one a SCREENSHOT (image)** with answer letters A-D. There is no question text, no options text, no explanations.
  2. **"DTM Test Bot" = `/home/savol/quest`** (`savol-bot` + `savol-admin`, DISABLED/inactive since Aug 2026, Postgres DBs `dtm2` and `dtm_bot`, webhook host talim24.uz). A rewrite with text questions, a 90-question DTM block (10+10+10+30+30; 1.1 / 3.1 / 2.1 points), a 180-min timer, a leaderboard and referral gating. Its bank is **seed/sample data**: of 420 rows in `dtm2`, 210 are placeholders such as "Fan 2 - Savol 26" with options "A variant". It is not a real bank.
- The mechanics the owner describes (3.1 / 2.1 / 1.1, 90 questions) exist only in the DTM bot (2). The real, valuable content exists only in the BMB bot (1), as images.
- **Money:** neither bot has payments. BMB uses a referral gate (invite 3 friends for another try) plus mandatory channel subscription. The DTM bot has the same gate, configurable.
- **Recommendation:** import the 390 BMB images as a new "ready-made test bank" (new tables, images in an asset table), play them with the BMB mechanics (10 random questions of one random variant per subject, 20 min; or the 30-question combined mode), and charge per attempt. Add the DTM 90-question scoring as a second mode only when real DTM text content exists. Reveal answers at the end (new behaviour: the source bots never show them).
- **Biggest blocker:** the original PNG files are NOT on the server (the DB stores only `photo='math/img.png'` and Telegram `file_id`s). Either the owner supplies the originals, or we download them through the BMB bot token (`getFile`), which works because file_ids belong to that bot.

## 2. Where / how it runs

| Item | BMB_testbot (live) | DTM Test Bot (disabled) |
|---|---|---|
| Directory | `/home/ques/ques-bot` (venv `/home/ques/venv`) | `/home/savol/quest` (venv `/home/savol/.venv`) |
| Git | github.com/khusinboev/ques-bot, last commit 2026-08-14 | github.com/khusinboev/questions, last commit 2026-08-14 |
| Framework | Python 3.12, aiogram 3, long polling, psycopg2 (raw SQL, one reconnecting cursor), FSM in `MemoryStorage` | Python, aiogram 3 webhook, SQLAlchemy async, Flask admin, Redis |
| Run | systemd `sav.service` (`python main.py`), active | systemd `savol-bot.service` + `savol-admin.service`, both `inactive` and `disabled` |
| DB | Postgres on host Postgres (localhost:5432), DB **`ques`**, 64 MB | same Postgres, DBs **`dtm2`** (25 MB, used) and **`dtm_bot`** (9 MB, empty test) |
| Cache | none | Redis localhost:6379/0 |
| Env names (BMB) | `BOT_TOKEN, ADMINS_ID, DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT` | `BOT_TOKEN, WEBHOOK_URL, WEBHOOK_SECRET, WEB_SERVER_HOST/PORT, DATABASE_URL, DB_POOL_SIZE, DB_MAX_OVERFLOW, REDIS_URL, SECRET_KEY, FLASK_*, ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_IDS` |

Notes:
- The "dtm" bot's admin panel template links to `t.me/BMB_testbot`, so it was planned as the BMB successor. It was never switched on (it has 4 users in `dtm_bot`, and `dtm2` still has ~102k imported users).
- A leftover SQLite file `/home/ques/ques-bot/src/db/savollar.db` (20 KB) is an old artefact and not used (config uses Postgres).
- There is no admin handler in the BMB code to ADD questions (grep finds none); questions were inserted out of band (script/SQL), with local files `math/img*.png`. Those local files are not on the server.

## 3. Data model + counts

### 3.1 BMB DB `ques` (live)

Question tables: three identical tables, one per subject, no FK between them:

```
math | literature | history
  id        serial PK
  photo     text      -- local path like 'math/img_3.png' (file NOT on server)
  file_id   text      -- Telegram file_id of the uploaded screenshot (used to render)
  answer    text      -- single letter a/b/c/d, MIXED CASE (a-d and A-D both occur)
  varyant   bigint    -- variant number 1..10
  status    text      -- 'True' as TEXT; all 130 rows are 'True'
```

Other tables: `accounts(id, user_id bigint, lang_code varchar(10), date)`, `referal(user_id UNIQUE, chance bool, member bigint, ready bool, starter bool)`, `results(id, user_id bigint, math bool, literature bool, history bool, number int, finished_at)`, `mandatorys(id, chat_id, title, username, types, status)` (required channels), `config(key, value)` (`referral_threshold = 3`), `admins`, and leftovers `cinema`, `qualites` (copied from another bot, empty).

| Table | Rows | Note |
|---|---|---|
| math | 130 | 10 variants |
| literature (Ona tili) | 130 | 10 variants |
| history (Tarix) | 130 | 10 variants |
| accounts | 190,392 | user_id + language only; since 2025-06-28 |
| referal | 91,696 | |
| results | 425,430 | 2025-07-04 .. 2026-10-23, one row per subject attempt, `number` = correct count 0..59 |
| mandatorys | 3 | required channels |
| payments / orders | none | no payment table at all |

Variant sizes (same in all three subjects): variants 1-5 and 9-10 have 10 questions, variants 6-8 have 20. Total per subject 130, total **390 questions**. Result mix: math 147k attempts (avg 5.3 correct), literature 112k (4.4), history 166k (4.4).

Format: one question = one screenshot (photo). Single choice, 4 options (A-D) with the option labels only on the buttons; option text exists only inside the image. Images may contain Cyrillic or Latin text, formulas and diagrams. Language: Uzbek (subject names in Latin script; image script unknown, needs a visual check). No LaTeX, no multi-select.

Personal data: question tables contain none. `accounts`/`referal`/`results` hold Telegram user ids (not to be imported).

### 3.2 DTM DB `dtm2` (disabled bot)

Tables (rows in `dtm2`): `subjects` 11, `questions` 420, `directions` 152 (bakalavr yo'nalishlari with two profile subjects), `regions` 14, `districts` 209, `users` 102,817 (PII: name, phone, region), `test_sessions` 58, `user_test_participation` 536, `user_answers` 22,625, `scores` 536, `leaderboard` 849, `referral_*`, `mandatory_channels`, `broadcast_messages` 16, `advertisements`.

```
questions(id, subject_id FK, text_uz, text_oz, text_ru, option_a..option_d text,
          correct_answer char(1), difficulty easy|medium|hard,
          image_url text null, question_type 'mandatory'|'specialized')
subjects(id, name_uz/oz/ru, question_count, points_per_question float, is_mandatory bool)
user_test_participation(..., deadline_at, status, completion_reason manual|timeout|force,
                        snapshot_questions/snapshot_answers JSON)
user_answers(participation_id, question_id, selected_answer, is_correct) UNIQUE(participation,question)
```

| Subject | Questions | Role | Points per correct |
|---|---|---|---|
| Matematika (60: 30 mandatory + 30 specialized) | 60 | mandatory | 1.1 |
| Tarix (60) | 60 | mandatory | 1.1 |
| Ona tili (60) | 60 | mandatory | 1.1 |
| Fizika, Kimyo, Biologiya, Huquq | 30 each | specialized | 3.1 (1st profile subject) |
| Adabiyot, Geografiya, Ingliz tili, Rus tili | 30 each | specialized | 2.1 (2nd profile subject) |

Data quality: 210 of 420 rows are placeholders ("Fan N - Savol K", options "A variant"); `text_uz = text_oz = text_ru` in all 420 (no real translations); 90 duplicated question texts; the "real" mandatory rows look like hand-written samples ("2 + 2 nechaga teng?"). `image_url` is used in 52 math rows only. Conclusion: treat `dtm2` as a schema/mechanics reference, not as a content source. Real usage: 536 completed attempts (390 ended by timeout/force, 146 manually), avg score 25.5 / max 115.5, avg 47 answers of 90.

## 4. Mechanics (from the code)

### 4.1 BMB_testbot (live)

- **Menu:** "Majburiy blokdan test ishlash" gives a menu: Matematika / Ona tili / Tarix / "Hamasidan" (all three). Each has a confirm button "Boshlash".
- **Gate before start:** user must be a member of all channels in `mandatorys` (`CheckData.check_member`), else a "join these channels" screen.
- **Question selection:** pick ONE random variant (`SELECT DISTINCT varyant ... random.choice`), then `random.sample(questions of that variant, 10)`. So one attempt = 10 random questions out of one random variant (variants of 10 give a fixed set in random order; variants of 20 give a random half). "Hamasidan": 10 from each of the three subjects = **30 questions** in fixed subject order (Ona tili, Matematika, Tarix).
- **Order / shuffling:** question order is random (random.sample). Options are NOT shuffled (they are part of the image, buttons are always A B C D).
- **Timer:** one deadline per attempt (monotonic loop time): **20 min** for a single subject, **60 min** for "Hamasidan". It is only checked when the user presses a button (no background auto-finish; the state is `MemoryStorage`, lost on restart). The caption shows elapsed and remaining time.
- **Scoring:** +1.1 per correct answer, no negative marking, no skipping (no "skip" button), no going back. Total printed as `correct count` and `score` (e.g. 7 x 1.1 = 7.7). The attempt row in `results` stores only the correct count per subject.
- **Result screen:** per-subject "N correct | score" + total + elapsed time. **Correct answers and per-question review are NOT shown.** No explanations exist in the data.
- **Retries:** unlimited by the engine; limited only by the referral gate (4.3).
- **Security note:** the correct letter is encoded in the inline-button `callback_data` (`answer:B:+:3:...`), so a user (or a modified client) could read it. SlaydX must not copy this; it keeps answers server-side.

### 4.2 DTM Test Bot (disabled)

- User registers (name, phone, region), picks a `direction` (yo'nalish) which defines two profile subjects.
- **Test = 90 questions:** 3 mandatory subjects x 10 (Matematika, Ona tili, Tarix) + 30 from profile subject 1 + 30 from profile subject 2 (`TestService.get_test_questions`, `question_type` mandatory vs specialized). Questions inside each group and the option order are shuffled randomly; the shuffled order and the correct letter live in a JSON snapshot on the participation row (supports resume).
- **Timer:** 180 min per participation (`deadline_at`), expired ones are finished by a scheduler with reason `timeout`.
- **Scoring (DTM style):** mandatory 1.1 each (max 33), profile subject 1 = 3.1 each (max 93), profile subject 2 = 2.1 each (max 63); **max 189**. No negative marking.
- **Skip** is allowed (`answer = skip`), navigation via inline buttons. Result: score, rank on a per-direction leaderboard (daily/period). It saves the score only; no answer review.
- **Referral gate:** admin-set `required_count` (0 = off) to start another test the same day.

### 4.3 Payment / subscription logic

None in either bot. Access control = mandatory channels + referral threshold (`config.referral_threshold = 3`; 0 disables). In BMB a user gets the first test free (`starter`), then needs `member >= 3` invited users (`ready`) or a "chance" flag.

## 5. Sample questions (abbreviated)

BMB `math` (real format, image-only):

```
id=11  variant=2  photo='math/img.png'    file_id='AgACAgIAAxkD...'  answer='a'
id=12  variant=2  photo='math/img_1.png'  file_id='AgACAgIAAxkD...'  answer='d'
id=13  variant=2  photo='math/img_2.png'  file_id='AgACAgIAAxkD...'  answer='d'
(question text and options A-D are inside the picture; the buttons are A / B / C / D)
```

Answer distribution in `math`: d 29, b 23, a 21, c 17, plus uppercase A 14, B 10, C 8, D 8 (mixed case: normalise to lowercase on import).

DTM `dtm2` (text rows, seed data):

```
id=12  Matematika/specialized/easy  "(-3)^2 = ?"   A -9  B -6  C 6  D 9   -> D
id=332 Tarix/mandatory/medium       "Amir Temur vafoti?"  A 1404 B 1405 C 1406 D 1407 -> B
id=116 Fizika/specialized/medium    "Fan 2 - Savol 26"  "A variant" ...  -> B   (placeholder)
```

Personal data check: no names, phones or Telegram ids in any question/option column of either bot. Only `users`/`accounts`/`results`/`referal` hold personal ids and must NOT be exported.

## 6. Import plan for SlaydX

### 6.1 What SlaydX has today

- `lib/generation/teacher/types.ts` `TestQuestion`: `{id, kind, stem, options[], answer, points, bloom, difficulty, explanation, topicId?, source?}`, living inside `doc.teacher.test` of a generation (AI output, owner-scoped, expiring).
- `lib/game/public.ts` strips the answer, shuffles options deterministically from the item id; `lib/game/score.ts` re-scores on the server; `lib/game/engine.ts` is a pure client state machine; `lib/server/game-sessions.ts` + migration `021_games.sql` give link/token sessions and `game_results` (login-less students, per-link). `generation_assets` stores image bytes per generation (with expiry).
- Existing pieces do NOT fit directly: sessions belong to a generation and a teacher (no per-user paid attempt), `generation_assets` expire, and the public view is text-only (no image stem, no timer, no per-subject scoring).

### 6.2 Target schema (recommended: new tables, reuse the pure engine ideas)

Do not push the bank through `doc.teacher.test` (it is generation-bound, expiring, text-only, and 390 image questions would be duplicated per attempt). New migration `054_test_bank.sql`:

```
tb_banks      (id uuid pk, slug text unique, title, locale, source text, version int, active bool)
tb_subjects   (id, bank_id fk, code 'math|ona_tili|tarix|...', name_uz, points_per_correct numeric, sort)
tb_questions  (id uuid pk, subject_id fk, variant int, stem_text text null, stem_asset_id uuid null fk tb_assets,
               options jsonb null,            -- null for image-only questions (A-D only)
               option_count smallint default 4, correct char(1) check in ('a','b','c','d'),
               explanation text null, content_hash text unique, legacy_ref text unique, active bool)
tb_assets     (id uuid pk, mime, size_bytes, sha256 unique, bytes bytea)   -- permanent, no expiry
tb_attempts   (id uuid pk, user_id bigint fk users, bank_id, mode text,    -- 'subject' | 'combo30' | 'dtm90'
               question_ids jsonb,  -- frozen order
               answers jsonb, started_at, deadline_at, finished_at, status, score numeric, correct int, total int,
               order_id/charge_id text null)   -- entitlement link
```

Image questions are rendered as `<img src="/api/tests/q/{id}/image">` behind an authenticated route (check an active attempt that contains the question). The answer letter never leaves the server until `finished`.

Text-based DTM mode (`dtm90`) re-uses the same tables with `stem_text` + `options`; scoring weights come from `tb_subjects.points_per_correct`, with the per-direction 3.1 / 2.1 weights resolved at attempt creation (store the weight snapshot in the attempt).

### 6.3 Import approach (two steps, both idempotent)

1. **Export (one-off, read-only, on the server or via ssh):** a script runs `SELECT id, photo, file_id, lower(answer), varyant FROM math|literature|history WHERE status='True'` and writes `bmb-export.json` (390 rows, ~60 KB, no user data), then downloads each image via the bot's own `getFile` (390 requests, the token never leaves the server; run it there, copy only the PNG/JPG files and the JSON out). Fallback: the owner uploads the original `math/*.png` etc.
2. **Import (SlaydX `scripts/import-bmb.ts`):** upsert by `legacy_ref = 'bmb:<subject>:<id>'` and `content_hash = sha256(image bytes)`; insert subjects/questions/assets in one transaction; re-running changes nothing. Validate: answer in a-d, exactly 130 per subject, variant counts 10/10/10/10/10/20/20/20/10/10, image decodes and size is below the limit, no two questions with the same hash (report duplicates, skip them).
3. Admin UI: list/edit/deactivate questions, upload new questions later (so the owner can extend the bank without scripts), per the repo rule that every parameter must be admin-editable and tested.

### 6.4 Images

390 screenshots: expect roughly 20-150 KB each, i.e. 10-60 MB in total. Storing in Postgres `bytea` is acceptable at this size (same pattern as `generation_assets`) but the box has a tight RAM budget: serve with `Cache-Control: private, max-age=86400` + ETag, and re-encode to WebP at import (target <= 80 KB). If the bank grows past ~200 MB, move to a file volume under `/opt/slaydx`.

### 6.5 Entitlement and payment

Recommended: **pay per attempt** (a "ticket"), using the existing wallet/`priceFor` machinery, with the price kept in admin settings (not hard-coded). Reasons: the source mechanics are attempt-based, abuse (screenshotting the whole bank) is limited to what one attempt reveals, and the owner can later add bundles ("5 attempts", "unlimited for 30 days") on top. Flow: `POST /api/tests/start` debits the wallet atomically and creates the attempt with a frozen question order and `deadline_at` (idempotent by key); finishing or timeout never refunds; abandoned attempts expire server-side (cron), so the timer does not depend on the client. Keep the referral idea as an optional "free attempt" bonus through the existing referral/points system rather than copying the BMB gate. Free first attempt (like `starter`) is a cheap conversion hook; decide with the owner.

### 6.6 Reveal answers at the end

On `finished` (manual or timeout) return per-question `{chosen, correct, isCorrect}` plus the stem image URL, shown as a review list ("Xatolar ustida ishlash") with per-subject totals. Before `finished`, no endpoint returns the correct letter. Review is available only to the attempt owner and stays available as long as the attempt row exists (the image route allows finished attempts of that owner). If an explanation is added later it uses the same payload.

### 6.7 Mechanics to port (keep the same logic)

- Subject mode: pick random variant, 10 random questions, 20 min, +1.1 per correct, no negatives. Combo mode: 10 per subject x 3 = 30, 60 min. Optional DTM-90 mode (needs real text bank).
- Server-side deadline; the engine continues to be a pure state machine (extend `lib/game/engine.ts` ideas, but a new `lib/tests/*` module is cleaner than overloading game kinds).
- Resume after reload: attempt state is in the DB (BMB loses it on restart because of `MemoryStorage`).

## 7. Risks

- **Content is images:** no search, no dedup by text, no translation, accessibility/dark-mode issues (white screenshots), mobile legibility. OCR would be needed to turn them into text (also needed to detect duplicates and wrong keys).
- **Missing originals:** only Telegram file_ids exist; if the bot token is revoked or the files were deleted from Telegram, images are lost. Export soon, keep a backup copy.
- **Answer key quality:** nothing verifies the keys; mixed-case letters show manual entry. Do a QA pass (owner spot-check, plus compare against the 425k historical results: questions answered correctly by an abnormally low or high share point to wrong keys; per-question stats are not stored in the old DB, so this is not available retroactively).
- **Duplicates:** variants overlap in the DTM seed (90 duplicated texts). The BMB tables have not been checked for duplicate images; use image hashes at import.
- **Licence / ownership:** the owner states the content is theirs; the source questions look like copies of official DTM/BMB past-exam material. Get written confirmation of the rights (and the contents of `uzbmb.py` in `/home/mandat` is a separate project) before charging for it; keep the "BMB/DTM" naming neutral in the UI.
- **Leak value:** a paid bank of only 390 questions is fully exposed to a determined user over a few attempts (the review screen shows the answers). Mitigate with per-attempt random subsets, rate limits, watermarking is not practical.
- **Size / load:** small (390 files). The existing BMB audience is large (190k accounts, 425k attempts in 15 months) so a promotion could produce load spikes; the image route must be cached.
- **Cross-system consistency:** points `1.1` are floats; use `numeric(6,2)` or integer tenths to avoid rounding drift.
- **Do not import:** `users`, `accounts`, `referal`, `results` (PII / ids), and the `cinema`/`qualites` leftovers.

## 8. Open questions for the owner

1. Which bot is "bmbtestbot"? We assume @BMB_testbot (`ques`). Confirm, and confirm the disabled DTM Test Bot (`dtm2`) holds no real content that must be imported.
2. Do you have the original image files (`math/img*.png`, etc.) and is a spoken/written licence for the exam material OK? If not, may we download them through the bot token?
3. Do you have real TEXT questions for a 90-question DTM block (3 mandatory x 10 + 2 profile x 30)? Without them only the image mode can ship.
4. Pricing: per attempt, bundle, or time pass? Price per attempt, per mode (single subject vs 30 vs 90)? Is the first attempt free? Should referral still grant free attempts?
5. Should correct answers be shown only at the end, or also per question in practice mode? Should explanations be written (AI draft + owner review)?
6. Any negative marking or skipping in the paid version? (Source bots have none.)
7. Should the BMB bot itself link users into SlaydX or stay as a free funnel with its referral gate?
8. Keep the question order/variant logic (random variant, 10 random) or serve each question at most once per user across attempts?
