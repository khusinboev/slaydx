# Studio P10 — «Transkripsiya» (Speech to Text) and «Dublyaj» (Dubbing) (spec + what shipped, 2026-11-03)

Parent: `docs/studio/PLAN.md` §17 ElevenLabs rows «Speech to Text (Scribe v2)» and «Dubbing». Owner decisions
2026-11-03 (final): both on ElevenLabs; Uzbek is supported by both (Scribe: WER tier «Good»; Dubbing lists `uz`).
Branch `feat/studio-p10` — the lead merges, smokes in the browser and runs the paid live check.

## Placement — two new tools, drawn as two chips of the «Audio» tab

Decision: **two unlisted tools** `studio-transcribe` and `studio-dub` (purposes `studio.transcribe`, `studio.dub`, one
catalog model each), rendered in the Studio **«Audio» tab** as the chips «Transkripsiya» and «Dublyaj», between the
provider modes (Musiqa / Effekt / …) and «Montaj». Why not two more `AUDIO_MODES` of `studio-audio`:

- `studio-audio` is «one MP3 out of one call» end to end (`doc.studioAudio`, MP3 viewer, `output: "mp3"`, upload-only
  inputs). P10 outputs differ per job — a transcript TXT + SRT / VTT, a subtitled MP4, a dubbed MP4 or MP3 — and its
  sources are the «Montaj» ones (the user's own finished results), not only uploads.
- Separate tools give separate `tool_pricing` %, separate budgets (STT ≤ 6 min, dub ≤ 10 min of worker time),
  separate admin ladder rows and separate dark switches without branching inside `studio-audio`.
- They are still REAL catalog entries (`lib/media/catalog-transcribe.ts`) — routes, availability («Provayderlar» key +
  switch, «Media modellari» on / off and markup), `media_jobs` rows, cost telemetry — unlike «Montaj» (no provider).

The same «Audio» catalog listing (`GET /api/media/catalog?purpose=studio.audio`) now also lists the P10 models while their
switches are on, so the tab needs one request; the session carries `features.studioSpeechToolModels`.

## Switches (Sozlamalar → «Funksiyalar», default OFF)

`studio.transcribe.enabled`, `studio.dub.enabled` (MEDIA group). Off = no chip, the route refuses (400
`model_unavailable`) before anything is priced or charged. On = ElevenLabs on + keyed + the model not switched off in
«Media modellari».

## Sources (both tools)

`source` = `upload:<24 hex>` (a P6 `studio_audio_inputs` upload / recording, WAV or MP3, 3–300 s) or `result:<uuid>`
(a finished result that fits the «Montaj» `video` or `audio` role, `lib/server/media/mix-sources.ts` — ownership in SQL).
Picker: «Natijalarimdan» (the `GET /api/media/mix-sources` lists, video then audio) | «Audio yuklash» (the P6 upload row).
Limits: transcribe video ≤ 3 min, audio ≤ 10 min; dub ≤ 3 min (any). A dubbed MP4 / MP3 and a subtitled MP4 are new
«Montaj» sources too. No migration (072 / 073 not used).

**Billed seconds** (`sourceSeconds`): the server sets them before pricing — the upload's `billed_seconds`, or the
result's stored length (as the picker shows it, 0.1 s) rounded UP (`billedSeconds`); bytes are measured when nothing is
stored. The client's number is overwritten; a different preview is a 409 `price_changed`. The worker re-reads the bytes
with the owner's id and MEASURES them.

**Refused before charging (400)**: switch off; another user's / missing / purged / wrong-kind source (`input_missing`);
too long (`input_too_long`); a burn on an audio / upload (`input_invalid`); a burn whose re-encode cannot fit 25 MB at
≥ 800 kb/s, a video dub whose file (≈ the source size) cannot fit 25 MB (`input_too_large`); a dub with the same
source and target language.

## «Transkripsiya» (`elevenlabs/scribe-v2`, adapter `studio-elevenlabs-stt`)

- One `POST /v1/speech-to-text` (multipart): `file` (the source bytes as stored: MP4 / MP3 / WAV), `model_id: scribe_v2`,
  `timestamps_granularity: word`, `tag_audio_events: false`, `diarize`, `language_code` (only when chosen). Sync, through
  `runMedia` (a `media_jobs` row; the answer is handed back as normalized JSON).
- Params (each changes the request or the price — probe test): `language` (Avtomatik + 16 languages) → `language_code`;
  `speakers` («Gapiruvchilarni ajratish») → `diarize` + «1:», «2:» labels; `burn` («Subtitrni videoga yopishtirish»,
  shown only for a video source) → the ffmpeg burn; `source` → the file; `sourceSeconds` → the price.
- Cues (`lib/generation/studio/subtitles.ts`): ≤ 2 lines × 42 characters (word wrap, words never cut), ≤ 6 s, split on a
  1 s pause, a sentence end (cue ≥ 1.5 s), a speaker change; ≥ 0.7 s unless the next cue starts earlier; no overlap.
  Text is never rewritten (Uzbek ʻ ’ ‘ ' kept); VTT escapes `& < >`; the burn copy neutralises libass `{…}` / `\`.
- Result file: the subtitled MP4 (burn), else the transcript TXT. Downloads (registry): native + `subtitles-srt` +
  `subtitles-vtt`, both built from `doc.transcribe.cues` — the cues the viewer (`TranscriptViewer`) shows and the burn used.
- No speech found = a result (honest «Nutq topilmadi», nothing burned), not a refund; a provider / ffmpeg failure =
  FAILED + full refund.
- **Burn** (`lib/generation/studio/burn-args.ts`, pure argv like `mix-args.ts`): `-protocol_whitelist file -f mov -i
  in-video.mp4`, `subtitles=filename=subs.srt:charenc=UTF-8:force_style='FontName=Noto Sans,…'` (vertical clips get a
  smaller font), H.264 `veryfast` CRF 23 with `-maxrate` = what fits 24 MB (≤ 6 000 kb/s; < 800 kb/s = refused before
  charging), audio copied (`0:a?`), `+faststart`. Runner: the P8c `runFfmpeg` (now also takes `.srt`, ceiling 300 s;
  the burn asks 240 s; «Montaj» keeps its 120 s default). Worker image: the build now also fails without `libx264`, the
  ` subtitles ` filter and the `Noto Sans` font (Dockerfile worker stage).

## «Dublyaj» (`elevenlabs/dubbing`, adapter `studio-elevenlabs-dub`)

- `POST /v1/dubbing` (multipart): `file`, `target_lang`, `source_lang` (only when chosen), `num_speakers: 0`,
  `watermark: false`, `name: "SlaydX Studio"` (no user text) → `dubbing_id`; op id `<dubbing_id>:<target>`.
  `GET /v1/dubbing/{id}` (`dubbing` → wait, `dubbed` → done, `failed` → fail; a moderation / policy text = safety);
  `GET /v1/dubbing/{id}/audio/{target}` (MP4 for a video source, MP3 for audio — checked); `DELETE /v1/dubbing/{id}`
  after the download and on give-up (best effort: privacy, and a late finish is not kept).
- Params: `target` (16 languages, default `uz`) → `target_lang`; `sourceLang` (Avtomatik + 16) → `source_lang`;
  `source` → the file; `sourceSeconds` → the price.
- **Async — worker-side polling within the job budget** (`lib/generation/studio/dub.ts`), not the shared video poll loop.
  Why: the video loop (`video-ops.ts`) finalizes a generation AS A VIDEO (`doc.video`, `VIDEO_TOOLS_SQL` capacity, its
  messages, its own refund path) — a dub may be an MP3, and wiring a second kind into that 900-line state machine is a
  bigger risk than holding one worker slot for a ≤ 3-minute source (the dub budget is 600 s, under the 660 s job cap;
  polls 10 / 15 / 20 / 30 s; 45 s kept for the download). Exactly once at the provider: the `media_jobs` row
  (`<generationId>:dub:0`, purpose `studio.dub`) is written BEFORE the call and parked with the op id; a re-run of the job
  (worker died, a deploy re-queued it) RESUMES that op; a row still 'submitting' (the call may have been billed, the id
  is unknown) or 'failed' → FAILED + refund, never resent. One route only, and an accepted (timed-out) submit is never
  retried. Deadline / provider failure / wrong output / > 25 MB → FAILED + full refund (+ DELETE).

## Prices (provider cost × `media.markup` ×2, the model override wins, rounded up to 100 so'm; then `tool_pricing` %)

Cost basis = the owner's ElevenLabs Creator plan, as P5 / P6: $22 / 121 000 credits. Credit rates from
https://elevenlabs.io/pricing (read 2026-11-03): **Speech to Text 330 credits / min**, **Dubbing 3 000 credits / min**
(automatic, no watermark — paid plans; 2 000 with a watermark, which paid plans do not get).

| Job | USD | so'm at ×2, 12 700 so'm/$ |
|---|---|---|
| Transkripsiya | $0.060 / min | 30 s → 800 · 1 min → 1 600 · 10 min → 15 300 |
| Dublyaj | $0.545 / min | 15 s → 3 500 · 1 min → 13 900 · 3 min → 41 600 |

The usage-billed API list (https://elevenlabs.io/pricing/api, read 2026-11-03) shows Scribe v2 **$0.22 / hour** and
Dubbing v1 $0.50 / min without watermark. The STT gap is ×16: if the owner's key is billed in USD (not credits), the
admin should lower the STT markup in «Media modellari» after the live comparison. Both rates **UNVERIFIED** until one
live job of each is compared with the ElevenLabs usage page. Admin: «Media modellari» lists both (unit «1 daqiqa»);
«Narxlar» ladder rows Transkripsiya 30 s / 1 / 5 / 10 daq, Dublyaj 15 s / 1 / 3 daq.

## Tests

`tests/studio-transcribe.test.mts` (15, 15 mutations), `tests/studio-transcribe-flow.test.mts` (3, isolated DB, 6
mutations), `tests/ui/studio-speech-tools.test.mts` (5, 5 mutations); enumeration tests extended (download-formats,
download-produce, viewer-kind, settings, pricing, pricing-server session keys, studio-admin-media).

## UNVERIFIED (the lead's live check)

1. The credit rates above vs the usage page (one 1-minute STT, one 15 s dub).
2. Scribe accepts our MP4 / WAV / MP3 as stored; the response's `words[].speaker_id` with `diarize=true`.
3. Dubbing: the status strings (`dubbing` / `dubbed` / `failed` — the docs show only `dubbed`), that `watermark: false` is
   accepted on the Creator plan, that an audio source comes back as MP3 (the engine refuses anything else), the real
   render time of a 1–3 minute source (must fit 600 s, or the job refunds).
4. The worker image build check (`libx264`, ` subtitles `, `Noto Sans` in Alpine's `font-noto`).
5. A burned subtitle in Chinese / Japanese / Korean / Arabic / Hindi needs CJK / Arabic / Devanagari fonts in the worker
   image (only Latin / Cyrillic / Greek are there): those letters may render as boxes — Latin / Cyrillic (uz, ru, kk, ky,
   tg, az, tr, en, de, fr, es) are fine.
