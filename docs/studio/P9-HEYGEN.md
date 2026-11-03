# Studio P9 — HeyGen avatar videos («Video» tab)

Owner decision (2026-11-03): build HeyGen completely now; there is no HeyGen key yet. **OFF state = no key**: the model
is not listed (`GET /api/media/catalog?purpose=studio.video`) and `POST /api/generations` refuses it with 400
`model_unavailable` before anything is charged (`modelAvailable`: provider on + keyed). The admin turns it on by entering
the key in «Provayderlar» (HeyGen card), and can still switch the model off in «Media modellari». The tab itself also
needs `video.enabled` (P3).

## What ships

- Provider `heygen` (`lib/server/providers/registry.ts`): kinds `video`, env fallback `HEYGEN_API_KEY` (production:
  the key lives in the store only), «Tekshirish» = `GET https://api.heygen.com/v3/users/me` (account + API balance,
  nothing generated). Card text in `catalog.ts` `PROVIDER_META.heygen`; listed in the «Video yaratish» purpose.
- Catalog `heygen/avatar` (`lib/media/catalog-video.ts`, after Sora, before the effects), route `heygen` /
  adapter `heygen-video` (`lib/media/adapters/heygen.ts`, registered in `studioVideoAdapters`).
- Params: `prompt` = the script (≤ 720 characters, Uzbek fine) **or** `audioId` = one of the user's own finished speech
  results (the «Montaj» speech role: «Ovoz», podcast, greeting, voice changer / isolator; ≤ 60 s; SQL ownership before
  charging and again at submit) — exactly one of the two; `avatar` (4 curated stock avatars), `voice` (female / male),
  `language` (uz / ru / en — picks the HeyGen voice), `engine` («Sifat»: Avatar IV / Avatar III, priced), `aspect`
  16:9 | 9:16; `seconds` is computed, never a form row.
- Length / price BEFORE the job: `withAvatarSeconds` (one function, browser and server): script → `ceil(chars / 12)`
  seconds (a slow pace, so the estimate is rarely short), own speech → its stored length rounded to 0.1 s, up to a whole
  second. The server OVERWRITES the request's `seconds` before pricing (`prepareAvatarRequest`, the «Audio» tab's
  `inputSeconds` rule). A clip more than 1 s shorter than paid refunds the difference (the shared video `delivered`
  rule); a longer one is never charged extra.
- Async on THE shared video poll loop: submit = voice lookup (or own-speech asset upload) + ONE `POST /v3/videos` with
  `Idempotency-Key` = the media job key → op `heygen:<video_id>` → poll `GET /v3/videos/{id}` → MP4 downloaded without
  the key (`safeFetchUrl`, first host in `heygen.ai` / `heygen.com` / `cloudfront.net`, 25 MB cap, MP4 sniff) →
  `finalizeVideo`. Deadline / too many errors → best-effort `DELETE /v3/videos/{id}`, then one refund.
- Form (`components/studio/video/VideoTab.tsx` + `avatar.ts`): the script box reads «Avatar nima desin?»; «Avatar
  ovozi» card with the own-speech picker (`GET /api/media/mix-sources` → `speech`, known length ≤ 1 min); with an own
  speech the script box, «Ovoz» and «Matn tili» hide (they would change nothing). Everything else = generic `ParamRows`.
- Admin: «Media modellari» lists it automatically (unit «10 soniya»), «Narxlar» ladder gets a rung per engine at 1 s
  and 60 s (`studioVideoRungs` now also treats a priced `engine` enum as a tier).

## HeyGen API facts (read 2026-11-03)

| Fact | Source |
|---|---|
| Auth header `X-Api-Key`; verify with `GET /v3/users/me`; keys at https://platform.heygen.com/api-keys | https://developers.heygen.com/docs/api-key.md |
| `POST /v3/videos` `type: "avatar"`: `avatar_id`, `script` + `voice_id` **or** `audio_url` / `audio_asset_id` (mutually exclusive), `resolution` 720p/1080p/4k, `aspect_ratio` 16:9 · 9:16 · 4:5 · 5:4 · 1:1 · auto, `engine.type` avatar_iii / avatar_iv (default) / avatar_v; `Idempotency-Key` (24 h replay, 409 `request_in_progress` while running); answer `data.video_id` | https://developers.heygen.com/reference/create-video |
| `GET /v3/videos/{id}`: `status` pending / processing / completed / failed, `video_url` (presigned), `duration`, `failure_code`, `failure_message` | https://developers.heygen.com/reference/get-video.md |
| `DELETE /v3/videos/{id}` (whether it stops a running render's bill is not documented) | https://developers.heygen.com/reference/delete-video.md |
| `GET /v3/voices?type=public&language=&gender=&limit=` → `voice_id`, `language`, `gender` | https://developers.heygen.com/reference/list-voices.md |
| `GET /v3/avatars/looks?ownership=public&avatar_type=studio_avatar` | https://developers.heygen.com/reference/list-avatar-looks.md |
| `POST /v3/assets` multipart `file`, mp3 / wav ≤ 50 MB → `data.asset_id` | https://developers.heygen.com/reference/upload-asset.md |
| Script ≤ 5 000 characters; ≤ 30 min per scene; pay-as-you-go 10 concurrent jobs, 10 creates / s | https://developers.heygen.com/docs/usage-limits.md |
| Error codes: 402 `insufficient_credit`, 400 `content_policy_violation` / `avatar_not_usable`, 404 `avatar_not_found`, 429 `rate_limit_exceeded` | https://developers.heygen.com/docs/error-codes.md |
| «Uzbek (Latin, Uzbekistan)» is in HeyGen's voice-language list | https://help.heygen.com/en/articles/11391932-voice-languages-we-support |
| API = separate prepaid wallet (from $5), billed per second of output | https://www.heygen.com/blog/best-ai-avatar-talking-head-apis (2026-10-29) |

## Prices (so'm = USD × s × 2 × 12 700, rounded up to 100)

| Engine | USD / s (quote) | 5 s | 30 s | 60 s |
|---|---|---|---|---|
| Avatar IV (default) | 0.0805 ($4.83 / min) | 10 300 | 61 400 | 122 700 |
| Avatar III | 0.0167 ($1.00 / min) | 2 200 | 12 800 | 25 500 |

The blog's table says Avatar IV studio / twin $4.00 / min and Avatar III $1.00 / min, its FAQ $4.83 and $0.60 — the
higher figure of each is the quote, so a real bill should not exceed it. HeyGen's own pricing table
(app.heygen.com/developers/api?modal=pricing) needs a login and was not read.

## UNVERIFIED (answer on the first live calls, admin account `adkhambek_4`)

1. **Prices**: the per-second rates above vs the HeyGen wallet after one Avatar IV and one Avatar III clip. Higher →
   raise the model's markup in «Media modellari» and fix `HEYGEN_USD_PER_SECOND`.
2. **Avatar ids**: `Angela-inblackskirt-20220820`, `Daisy-inskirt-20220818`, `Tyler-incasualsuit-20220721`,
   `Josh_lite3_20230714` come from HeyGen's v2 examples; v3 calls `avatar_id` a «look ID». Check each in
   `GET /v3/avatars/looks?ownership=public&avatar_type=studio_avatar` (and that each supports `avatar_iii` /
   `avatar_iv` in `supported_api_engines`). A wrong id is a 4xx before acceptance → full refund, nothing billed.
3. **Uzbek voices**: the voice filter value `language=Uzbek` and the answer's `language` text (we accept a value that
   starts with «Uzbek»). No Uzbek voice of a gender → the job is refunded before any video exists.
4. **Download host**: the `video_url` host (allowlist `heygen.ai`, `heygen.com`, `cloudfront.net`). Another host →
   every clip fails AFTER HeyGen billed it (refunded to the user) — check on the first clip.
5. **Billing of failures**: a `failed` render and a deadline `DELETE` — billed or not (the docs say only that
   `render_not_started` charges nothing).
6. **Speech rate**: 12 characters / s for Uzbek text; compare the first clips' `duration` with `ceil(chars / 12)`.
   Much shorter clips mean frequent partial refunds (fine); longer ones mean we pay seconds we did not charge.
7. **Own audio**: the multipart upload of an MP3 (`file` field) and lip-sync with `audio_asset_id`.

## Owner smoke checklist (once a key exists)

1. «Provayderlar» → HeyGen → enter the key → «Tekshirish»: «Kalit qabul qilindi · … API balansi $X».
2. «Sozlamalar»: `video.enabled` on. Studio → Video → «Matndan / rasmdan» → model «HeyGen avatar» is listed.
3. Uzbek script (~50 characters, Avatar III, 16:9) → plays; the avatar speaks Uzbek; compare the wallet with
   `media_jobs.cost_usd`.
4. Same script, Avatar IV, 9:16, «Erkak ovozi» → plays; compare the wallet.
5. «Ovoz» tab → make a 10–20 s speech → Video → HeyGen → «O‘z ovozingiz» → that speech → the avatar lip-syncs it.
6. Try each of the 4 avatars once (or check their ids in the looks list, UNVERIFIED 2).
7. Remove the key → the model disappears from the picker; a direct POST is 400 `model_unavailable`.

## Tests

`tests/studio-video-heygen.test.mts` (12 tests, 14 mutations: catalog, length, golden bodies, auth host, errors, key
scrub, poll states, download, prices client == server, preflight, provider), `tests/studio-video-heygen-flow.test.mts`
(isolated DB: gating by key, script + own speech flows on the shared poll loop, refunds; 4 mutations),
`tests/ui/studio-video-heygen.test.mts` (3 tests, 4 mutations). Updated lists (no assertion removed): `studio-video`
(purpose list + probe fixtures), `studio-video-sora` (picker order), `studio-admin-media` (managed list),
`provider-keys` (registry ids).
