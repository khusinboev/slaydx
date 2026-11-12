# Work rating («Tahrirlash» / «Baholash» under the file message)

Owner request 2026-11-12: «Tahrirlash va baholash tugmasi bo'lishi kerak. Tahrirlashda webappga o'tib beradi.»
Decision with the owner: «Baholash» rates THIS work with 1–5 stars inside the bot, the rating is stored per generation,
no bonus is paid, the admin sees ratings per tool.

Not the app rating of `lib/server/ratings.ts` / migration 053 (one rating of the whole app per user, written feedback,
a one-time bonus). That feature is unchanged.

## Data — migration `078_generation_ratings.sql`

`generation_ratings`, one row per (generation, user), primary key `(generation_id, user_id)`:

| column | meaning |
|---|---|
| `generation_id` | FK → `generations`, `ON DELETE CASCADE` (a deleted work takes its rating with it) |
| `user_id` | FK → `users`, `ON DELETE CASCADE` |
| `stars` | 1–5 (CHECK) |
| `reason` | `design` · `images` · `text` · `errors` · `other`, only when `stars <= 3` (CHECK) |
| `comment` | optional, ≤ 500 characters (CHECK); only the web writes one |
| `source` | `bot` · `web` — where the CURRENT value was given |
| `created_at` / `updated_at` | first rating / current value (admin windows read `updated_at`) |

Indexes: `created_at DESC`, `updated_at DESC` (admin window + latest-low list), `user_id` (the user's cascade).
Additive only; the rollback block drops the table.

## Service — `lib/server/generation-ratings.ts`

One service for the bot, the web API and the admin (CLAUDE.md «Bot va web — bitta servis qatlami»).
Pure rules shared with the client live in `lib/generation-rating.ts` (reason set, limits, Uzbek reason labels).

- `rateGeneration({ userId, generationId, stars, reason?, comment?, source })` — rate or re-rate. The whole value is
  replaced (a reason / comment left out becomes `null`): the last rating wins. Ownership and «only COMPLETED» are part of
  the write itself: `INSERT … SELECT … FROM generations g WHERE g.id = $1 AND g.user_id = $2 AND g.status = 'COMPLETED'
  ON CONFLICT … DO UPDATE`. When no row comes back a lookup only chooses the error.
- `setRatingReason({ userId, generationId, reason | null, source })` — the bot's second step: only the reason of an
  existing 1–3 rating changes (`null` = skip).
- `ratingTarget(userId, generationId)` / `getGenerationRating(...)` — the owner's view (tool, status, purged, rating).
- `ratingSummary({ from, to, lowLimit })` — admin, read-only: per tool count, average, 1–5 distribution, low (≤ 3) count
  and share, reason histogram, the newest 3 low ratings; plus the newest `lowLimit` (≤ 50) low ratings over all tools.
- Errors: `GenerationRatingError` (an `ApiError` with `code`): `bad_stars`, `bad_reason`, `reason_needs_low`,
  `bad_comment`, `bad_source` (400), `not_found`, `not_owner` (404), `not_ready`, `not_rated` (409), `rate_limited` (429).
- Rate limit: 30 writes per user per hour (`gen-rating:<userId>`, the shared Postgres limiter), bot and web together.

## Web API — `app/api/generations/[id]/rating/route.ts`

- `GET` → `{ rating: GenerationRating | null, rateable: boolean }` (`rateable` = COMPLETED).
- `PUT { stars, reason?, comment? }` → `{ rating }`; `source` is always `web`.
- Session required (`requireUser`, same-origin check on PUT). Someone else's generation answers exactly like a missing
  one (404 `not_found`) — the web never learns that an id exists.
- Client: `getGenerationRating(id)` / `rateGeneration(id, body)` in `lib/api-client.ts`. No web control is built yet
  (the viewer's owner adds one on top of this API).

## Bot

### Keyboard of the owner's copy (`lib/server/bot/work-rating.ts workKeyboard`, used by `telegram-files.ts savedMarkup`)

```
[ ✏️ Tahrirlash (web_app) | ⭐ Baholash  (or ⭐ N/5 once rated) ]
[ 📤 Ulashish (switch_inline_query f_<32 hex>_<format>)          ]
```

- Built fresh for every upload and every resend by `file_id` (in the user's bot language, with the current stars);
  nothing about the keyboard is stored, so old messages and old `telegram_files` rows are unaffected.
- «✏️ Tahrirlash» is an inline `web_app` button to `appUrl("/uz/files/<id>?edit=1")` (URL contract with the viewer:
  `edit=1` opens the viewer in edit mode). Inline web_app buttons carry initData, so no signed `?bt=` link is used.
  Shown only when the tool has an edit adapter (`edit-adapters.ts adapterFor`: slides, pro slides, résumé, article/thesis,
  coursework/referat/mustaqil ish/konspekt, essay, teacher documents), the files are not purged by retention, and the
  app URL is public https. Pictures, AI-picture slides, audio, video, games, translations get no edit button.
- The copy other people receive (prepared share message, inline results, `backLinkMarkup`) keeps the single
  «SlaydX'da ochish» url button: web_app buttons work only in the private bot chat.

### Callback codes (`lib/server/bot/codes.ts`; `<g>` = generation id as 32 hex, `<f>` = download format id)

| code | action |
|---|---|
| `gr:o:<g>:<f>` | show the star row `1⭐ … 5⭐` + «‹ Orqaga» |
| `gr:s:<g>:<f>:<n>` | rate n stars; 4–5 → «Rahmat! Bahoyingiz qabul qilindi» and the normal keyboard with «⭐ n/5»; 1–3 → saved, then the reason buttons |
| `gr:r:<g>:<f>:<r>` | reason `d` design · `i` images · `t` text · `e` errors · `o` other · `x` skip, then the normal keyboard |
| `gr:b:<g>:<f>` | back to the normal keyboard |

The longest code is 53 bytes (`gr:r:<32 hex>:transcript-txt:d`), under Telegram's 64. The format is carried so the
«📤 Ulashish» button can be rebuilt for the same format.

### Rules of every callback

- Only `editMessageReplyMarkup` (the message is a document; prompts go into the callback toast).
- The presser is looked up by Telegram id; every id in the data is checked with that owner in SQL. A forwarded message's
  button pressed by someone else answers «Bu ish sizniki emas» and changes nothing; a deleted generation answers
  «Bu ish topilmadi — o‘chirilgan bo‘lishi mumkin»; an unfinished one «Ish hali tayyor emas»; a leftover reason button
  after the rating was changed to 4–5 answers «Bu tugma eskirgan». The callback query is always answered.
- Idempotent: a repeated tap writes the same value; «message is not modified» counts as success; a transient Bot API
  failure is re-thrown so Telegram redelivers (the write repeats harmlessly).
- The webhook does one small upsert + one rate-limit row — no heavy work.
- Texts in uz / ru / en (`wr.*` keys in `lib/server/bot/i18n.ts`).

## Admin

- Web: `/admin/ratings` («Baholar») → «Ish baholari» block (`components/admin/ratings/WorkRatings.tsx`), data from
  `GET /api/admin/ratings/works?days=7|30|90` (`adminHandler`, permission `jobs.view`, read-only, no audit entry): per tool
  count, average (1 decimal), share of ≤ 3, top reasons; the newest 20 low ratings link to `/admin/generations/<id>`.
- Bot «📈 Statistika»: «Baholar (30 kun): o‘rtacha 4.3 · N ta · ≤3: M ta» (`lib/server/bot/admin-stats.ts`, same 30
  Tashkent days as the other «30 kun» lines).

## Tests

`tests/generation-ratings.test.mts` (service + API), `tests/work-rating-bot.test.mts` (keyboards, callback flow, admin
stats line), `tests/migration-additive.test.mts` and `tests/admin-migrations.test.mts` (078 apply / CHECKs / rollback).
