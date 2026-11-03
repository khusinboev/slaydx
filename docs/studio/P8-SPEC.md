# Studio P8 — old media tools fold into the Studio + ffmpeg «Montaj» (spec, 2026-11-03)

Parent: `docs/studio/PLAN.md` §10.3 (owner: «the old Rasm / Video / Podkast / Tabriknoma tools move into the Studio
(as templates)»), §15 P8. Owner 2026-11-03: «P8 — ha boshlayver», «ffmpeg — ha qo'shaver». Production is now the new
server; merge to `main` = auto-deploy (normal flow again).

## Dark switch (already on the branch)
`studio.legacy_fold` (Funksiyalar, default OFF). Off: everything works exactly as today. On: the old pages and buttons
lead into the Studio. Prices, engines and old results NEVER change — the fold is navigation + placement only. Every
package reads the switch on the server (and the session exposes it as `features.legacyFold`).

## P8a — «Rasm» and «Video yaratish» → Studio tabs
- With the switch on: `/uz/image` → `/uz/studio?tab=rasm`, `/uz/video` → `/uz/studio?tab=video` (server redirect,
  query kept where meaningful); home / catalog / group cards of these two tools open the Studio; the bot keyboard
  «Rasm» button and any bot deep link to these tools open the Studio page (through the existing service layer, no bot
  logic of its own); the AI chat proposals that point to these tools point to the Studio.
- Old generations of `image` / `video` keep their result pages and downloads; «Qayta» on an old result still works.
- Nothing the old forms offered is lost: check the old Rasm form (models, count, style, ratio) and old Video form
  (provider, seconds, aspect, start image) against the Studio tabs; a missing option is added to the Studio (catalog
  param) — never a decorative control.

### P8a — what shipped / decisions
- One link builder, client-safe: `lib/media/legacy-fold.ts` (`LEGACY_FOLD` map tool id → Studio query, `toolHref`,
  `legacyFoldTarget`). One server read: `lib/server/media/legacy-fold.ts` (`legacyFoldOn`, `legacyFoldRedirect`). The
  pages, the session, the bot keyboard and the chat knowledge all go through these. P8b can add `podcast` / `greeting`
  entries to the same map (e.g. `{ tab: "ovoz", template: "podcast" }`) instead of a second mechanism.
- The «Rasm» tool's slug is `rasm`, so the redirect is `/uz/rasm` → `/uz/studio?tab=rasm` (`/uz/image` was never a
  route; it stays a 404). `/uz/video` → `/uz/studio?tab=video`. Both are own pages now (`app/uz/rasm`, `app/uz/video`,
  `force-dynamic`, added to `[slug]`'s `OWN_PAGE_SLUGS`): off, they draw exactly the `[slug]` page's `ToolWorkspace`
  with the same metadata (only difference: rendered per request instead of pre-rendered). On: the server redirect keeps
  the WHOLE query (the bot's `?bt=` login token, Telegram's `tgWebApp…`); the fold's own `tab` wins.
- Cards: home «Barcha vositalar» tiles, `/uz/create` catalogue, the «+» sheet and the search dialog use `toolHref`
  with `features.legacyFold` (new session key). «Tez boshlash» does not list these tools (unchanged). Old result pages
  («Yangi yaratish» / «Qaytadan yaratish» link to `/uz/rasm`) are untouched — the server redirect lands them in the Studio.
- Bot: `mainKeyboard` / `keyboardMessage` take `opts.legacyFold`; the four callers pass `legacyFoldSetting()` (the same
  server read). The «Rasm» web_app button opens `/uz/studio?tab=rasm&bt=…`; the block rule is unchanged. Keyboards
  already on users' screens keep `/uz/rasm?bt=…` and are redirected (token kept).
- AI chat: there are no tool-page links in proposals (a confirm enqueues the old `image` engine at the old price — kept,
  navigation only). The knowledge pack gets one line with the two Studio links while the fold is on; off = no line.
- Form parity (no new catalog param needed): Rasm — models (Nano Banana / ChatGPT, same availability rule) ⊂ Studio
  models; count 1/2/4 ⊂ Studio 1–4; all 9 styles (Studio «Uslub», advanced); all 6 ratios. Video — Veo (5/8 s,
  16:9/9:16, start image) is the same `google/omni-video` entry in the Studio; old «Kling AI» (`kling/video`, 5/10 s)
  is not in the Studio purpose, but Kling 3.0 / Pro cover every old option (3–15 s, 16:9/9:16/1:1, start image) —
  not re-added (a duplicate older tier); its price is the Studio's cost × markup, not the old 2 000 so'm/s ladder.
  Both video tabs are empty while `video.enabled` is off, exactly like the old tool.
- Tests: `tests/studio-legacy-fold.test.mts` (M1–M8), `tests/ui/home-hub.test.mts` + `tests/ui/create-sheet.test.mts`
  (fold tiles), `tests/pricing-server.test.mts` (session key `legacyFold`).

## P8b — «Podkast» and «Tabriknoma» → Studio «Ovoz» templates
- With the switch on: the Studio «Ovoz» tab shows a «Tayyor shablonlar» row with «Podkast» and «Tabriknoma»; each
  opens the EXISTING composer and engine (same tool id, same price, same result viewer) inside the Studio. This works
  even while `studio.voice.enabled` is OFF (these are live products today): then the Ovoz tab shows only the
  templates row. `/uz/podcast`, `/uz/greeting` redirect to `/uz/studio?tab=ovoz&template=podcast|greeting`.
- Results of these jobs appear in the Studio results list and the Studio gallery (`kind: "audio"`) as well as in
  «Ishlarim».

## P8c — ffmpeg + «Montaj» (voice / music onto a video; voice + background music)
- Worker image: `apk add ffmpeg` (Alpine). The web image does NOT get it (the job runs in the worker).
- New unlisted tool `studio-mix` (purpose `studio.mix`), two modes on the user's OWN finished Studio results (SQL
  ownership, generation ids, never URLs):
  - «Videoga ovoz qo'shish»: a finished video + a finished audio (Ovoz / Audio / Podkast / Tabriknoma) → MP4 with the
    audio laid on (options: replace the video's own sound or keep it under the new audio; audio volume; start offset
    0–N s; trimmed / padded to the video length).
  - «Ovoz + fon musiqa»: a finished speech + a finished music track → MP3 (music volume 5–50 %, simple ducking, fade
    out, length = the speech).
- Entry points: on finished Studio results (P7b «Keyingi qadam» row: «Videoga ovoz qo'shish», «Fon musiqa qo'shish»)
  and a «Montaj» mode in the Audio tab with two pickers from the user's gallery.
- Price: no provider cost → a fixed `studio.mix_price` setting (Narx va marja, default 500 so'm, 0–100 000) + the
  tool's `tool_pricing` %. Charge + enqueue in one transaction; ffmpeg failure / missing binary → FAILED + full refund.
- Safety / limits: inputs ≤ 3 min video, ≤ 10 min audio; ffmpeg with a hard timeout (≤ 120 s) and `-nostdin`, no
  network protocols (`-protocol_whitelist file,pipe`), temp files in a per-job dir removed afterwards; the arguments are
  built from validated numbers only (no user text reaches the command line).
- Tests: pure argument builder (golden args per option), probe (each param changes the args or the price), flow on the
  test DB with a real ffmpeg when present (CI ubuntu runners and the dev box have it; the test skips cleanly with a
  message when `ffmpeg` is missing) — output duration / streams checked with ffprobe.

### P8c — what shipped / decisions (builder, 2026-11-03, branch `feat/studio-p8c`)
- **Worker image**: `RUN apk add --no-cache ffmpeg && ffmpeg -hide_banner -version` in the `worker` stage only, before the
  COPY layers (stable layer). The web image has no ffmpeg; nothing in the web container decodes media.
- **Tool** `studio-mix` (unlisted, group media, `output: "mp3"` at enqueue; the stored format follows the real file —
  `mp4` / `mp3` — via `formatOf`). `/uz/studio-mix` redirects to `/uz/studio?tab=audio`; excluded from the AI chat.
  Modes = `modelId` `studio/mix-video` («Videoga ovoz qo'shish») / `studio/mix-voice` («Ovoz + fon musiqa»), described in
  `lib/media/catalog-mix.ts` as `ClientEntry`-shaped entries (NOT media-catalog entries: no route, no `media_jobs` row)
  so `ParamRows` / `requestValues` draw and send them like every tab. Purpose name `studio.mix` is a constant only (no
  router purpose — nothing is routed).
- **Params** (each changes the ffmpeg argv — probe test): video `videoId`, `audioId` (generation UUIDs), `keepOriginal`
  bool (default off = replace; on = the video's own sound mixed under at a fixed 35 %; a video without a sound track is a
  replace), `audioVolume` 10–200 % step 10 (default 100), `startOffset` 0–179 s (must be < the video's length, 400
  otherwise). Voice: `speechId`, `musicId`, `musicVolume` 5–50 % step 5 (default 20), `ducking` bool (default on:
  `sidechaincompress` keyed by the speech), `fadeOut` 0–10 s (default 3, at most half the speech). Output length = the
  video (audio delayed, `apad`, cut with `-t`) / the speech (music looped with `-stream_loop -1`, cut with `-t`).
- **ffmpeg** (`lib/generation/studio/mix-args.ts`, pure; `mix-ffmpeg.ts`, runner): `spawn` argv, no shell; `-nostdin`;
  `-protocol_whitelist file,pipe` + an explicit demuxer (`-f mov` / `-f mp3`) before EACH input; constant file names
  (`in-video.mp4`, …) inside a per-job `mkdtemp` dir used as `cwd` and removed in `finally`; numbers clamped and printed
  with fixed decimals (no request text on the command line — ids never reach the argv); `-threads 2`; hard timeout
  120 s (SIGKILL). Video stream copied (`-c:v copy`), audio AAC 160k 48 kHz + `+faststart`; MP3 libmp3lame 192k 44.1 kHz.
  `ENOENT` → «Montaj hozircha ishlamayapti. Kredit qaytariladi.»; any other failure → «Montaj bajarilmadi…» (stderr only
  in the log). Output checked (MP4 must have video + audio tracks; length > 0; ≤ 25 MB = `MAX_FILE_BYTES`).
- **Inputs / ownership** (`lib/server/media/mix-sources.ts`): every lookup `g.user_id = $1 AND status = 'COMPLETED' AND
  files_purged_at IS NULL`; roles — video: `studio-video`, `video`, a `studio-mix` MP4 (mime video/mp4); audio:
  `studio-speech`, `studio-audio` (any mode), `podcast`, `greeting`, a `studio-mix` MP3; speech: `studio-speech`,
  `podcast`, `greeting`, `studio-audio` voice changer / isolator; music: `studio-audio` music. Another user's id = 400
  `input_missing` (same as missing), before pricing. Limits pre-charge from the stored `doc_json` seconds (bytes measured
  when absent); the worker re-reads the bytes with the owner's id and MEASURES them (`mp4Seconds` / `mp3Seconds`, MP4 track
  handlers parsed in JS) — video ≤ 180 s, audio ≤ 600 s (+0.5 s tolerance). A source gone before the run → FAILED, refund.
- **Price**: `studio.mix_price` (Narx va marja, int 0–100 000, default 500; 0 = free) + `tool_pricing` %. Server:
  `effectivePrice` passes `{ ...mediaPricing(), mixPrice }`, `basePriceFor` reads `media.mixPrice`; browser:
  `GET /api/media/mix-sources` returns `price` (stored client-side like the clone price) + the session %. Admin price
  ladder: one rung «1 montaj». `expectedPrice` mismatch → 409 as every tool. No migration (072 not needed).
- **Cost telemetry**: nothing recorded (no provider call — the P7c rule for the clone's $0 IVC): `cost_json` stays
  `null`, no `ai_usage` row; the flow test asserts it.
- **UI**: «Audio» tab chips end with «Montaj» (always offered — it needs no provider; when the ElevenLabs modes are off
  the tab shows only that chip + a line). `MixPanel`: sub-mode chips, two pickers (`<select>` of the user's results:
  title · kind · seconds; a handed-over id not yet listed shows as «Tanlangan natija»), `ParamRows` for the options,
  sticky «Montaj qilish · <mode> · ~X so'm»; results: MP4 via `VideoResults` (no star — not a gallery item), MP3 via
  `VoiceResults`. Viewer: `viewerKind("studio-mix") = "audio"`; `ArtifactViewer` hands an MP4 mix (`doc.mix.output`) to
  `VideoViewer` (the engine also writes `doc.video`), an MP3 one plays in `AudioViewer` without a transcript block.
- **«Keyingi qadam»**: a React context (`components/studio/audio/mix-handoff.tsx`) provided by `StudioPage` and read by
  `VideoResults` («Videoga ovoz qo'shish» on any finished clip, effects included) and `VoiceResults` («Videoga qo'shish»
  on any audio; «Fon musiqa qo'shish» on a speech — not music / effect / mix). Deviation: the buttons live in those two
  result components, not in `StudioResults` (that one renders pictures only); no prop threading through the tabs.
  Gallery cards have no «Montaj» button (the pickers list the same results).
- **Open / follow-ups**: `studio-mix` results are not in the Studio gallery / favourites (`public.ts` / `favorites.ts`
  tool lists belong to P8b / P7b — add `studio-mix` there if wanted); no dark switch (the feature is live once the worker
  image has ffmpeg — before that every job refunds); the fixed 35 % original-sound level and the ducking constants are
  untuned by ear on real speech.

## File ownership (parallel agents)
- P8a: redirects in `app/uz/[slug]` / tool pages for image + video, home / catalog cards, bot keyboard + router image /
  video entries, chat toolspec links, session `features.legacyFold`, their tests.
- P8b: `components/studio/voice/*` templates row, Studio page wiring for `template=` (small hunk), podcast / greeting
  redirects, gallery inclusion of podcast / greeting results (`lib/server/media/public.ts` tool list), their tests.
- P8c: Dockerfile worker apk line, `lib/generation/studio/mix*`, `lib/media/catalog-mix.ts`, tool + setting
  `studio.mix_price`, migration only if needed (072), «Keyingi qadam» buttons in StudioResults (small hunk) + Audio tab
  «Montaj» mode, their tests.
- Shared enumeration tests (document, nav-pure, admin-settings-tabs, settings, admin-migrations, migration-additive,
  pricing-server session keys, ui/studio-page, ui/shell-phone, download-formats, viewer-kind): each package adds its
  own lines; the lead merges.

## P8b — what shipped / decisions
- **Templates row** (`components/studio/voice/VoiceTemplates.tsx`): with `features.legacyFold` true the «Ovoz» tab starts
  with «Tayyor shablonlar» — «Podkast», «Tabriknoma» (tool icon, title, description, «X so'm dan» = `priceFor(tool, {})`,
  the standard-voice price; the premium voice adds per minute in the composer). A card opens the tool's OWN
  `MediaComposer` in place of the speech form; «Yopish» brings the speech form back. With `studio.voice.enabled` off
  (no speech model listed) the tab shows only the row (`VoiceTab quietWhenNone`), no «hozircha mavjud emas» card.
  Switch off: nothing of this is drawn and `?template=` is ignored — the tab is exactly as before.
- **Same tool, same price, same engine**: `MediaComposer` got an optional `onQueued` (embedded mode, `ToolChrome
  embedded`: no page header, no second channel gate, the Studio column). The request is `queueToolGeneration(tool,
  values)` = `runGeneration`'s own target + `priceFor(tool, values)` (runGeneration now delegates to it), slug
  `podcast` / `greeting`. Without `onQueued` the composer behaves exactly as before (navigates to `/uz/files/<id>`).
- **Results**: decision — inside the Studio the queued job is NOT navigated to; it is followed in the template's own
  results list (`VoiceResults`: progress → MP3 player, «Yuklab olish (MP3)», «Qayta» = the same values again at the
  same `priceFor` price, and «To'liq ko'rish va ulashish →» = the unchanged `/uz/files/<id>` result viewer). The jobs
  also land in «Ishlarim» (the shared `upsertGeneration`). `repeat: true` as every Studio submit (the form stays on
  screen, a second press with the same text is a new job).
- **Redirect**: `app/uz/podcast/page.tsx`, `app/uz/greeting/page.tsx` (own static routes, `force-dynamic`, added to
  `[slug]` `OWN_PAGE_SLUGS`) read the switch per request (`lib/server/media/voice-fold.ts voiceFoldTarget`): on →
  `redirect("/uz/studio?tab=ovoz&template=<id>")`, every other query param of the old link kept (`?bt=`); off → the
  same `ToolWorkspace` as before. The `[slug]` page is SSG, so reading a setting there would bake the build-time value.
- **Gallery / favourites**: `studioGalleryToolIds()` (`lib/server/media/favorites.ts`) = the Studio tools, + `podcast`,
  `greeting` while the switch is on. The gallery lists them as `kind: "audio"` (player `?inline=1`, seconds from
  `doc.audio.seconds`, label = the tool title, line = the topic / recipient); the star accepts them only then. Off =
  the old hard-coded list exactly.
- **Session key**: the client reads `features.legacyFold` (P8a adds it; absent = off). Not added here.
- **Tests**: `tests/studio-voice-fold.test.mts` (server, 5, 7 mutations), `tests/ui/studio-voice-fold.test.mts` (UI, 5,
  7 mutations).
