# Studio P6 — «Audio» tab: music, sound effects, voice changer, voice isolator (spec, 2026-11-02)

Parent: `docs/studio/PLAN.md` §17 (ElevenLabs rows marked P6), §16 roadmap («P6 becomes Audio»). Builds on P0 (core,
`media_jobs`, `runMedia`), P1 (Studio shell, cost × markup, `studioEntryPrice`), P5 (Ovoz tab, ElevenLabs adapter, voice
list incl. own clones, browser → WAV conversion, server WAV / MP3 sniff + `mp3Seconds`). Work collects on
`feat/studio-next` — **no merge to `main`, no deploy, no server access** (owner 2026-11-02).

## What ships
- **One tool** `studio-audio` (group media, output MP3, unlisted like `studio-speech`; `/uz/studio-audio` redirects to
  `/uz/studio?tab=audio`; excluded from the AI chat), four modes = four catalog entries, four purposes:

| Mode (UI) | Catalog id | Purpose | Endpoint |
|---|---|---|---|
| «Musiqa» | `elevenlabs/music` | `studio.music` | `POST /v1/music` (`prompt`, `music_length_ms`, `force_instrumental`, `model_id: music_v1`) |
| «Effekt» | `elevenlabs/sfx` | `studio.sfx` | `POST /v1/sound-generation` (`text`, `duration_seconds`, `prompt_influence`, `loop`, `model_id: eleven_text_to_sound_v2`) |
| «Ovozni almashtirish» | `elevenlabs/voice-changer` | `studio.voice-changer` | `POST /v1/speech-to-speech/{voice_id}` multipart `audio`, `model_id: eleven_multilingual_sts_v2`, `remove_background_noise` |
| «Shovqindan tozalash» | `elevenlabs/isolator` | `studio.isolate` | `POST /v1/audio-isolation` multipart `audio` |

  All with `?output_format=mp3_44100_128`. Every provider call = one `runMedia` call (`media_jobs` row; prompt stored
  only as its length, uploaded audio never logged).
- **Dark switch** `studio.audio.enabled` (default OFF; «Funksiyalar» tab in Sozlamalar with its effect sentence — the
  `admin-settings-tabs` test requires the tab entry). Off = no mode listed, routes refuse (400), nothing charged. Then
  per model: ElevenLabs on + keyed; model not switched off in «Media modellari».

## Parameters (each changes the request or the price — differential probe test, «every param must work»)
- **Musiqa**: prompt (min 5, max 2 000 chars — Uzbek allowed; the UI hints English styles work best), length enum
  15 / 30 / 60 / 90 / 120 / 180 s (default 30), «Faqat kuy (so'zsiz)» bool → `force_instrumental`.
- **Effekt**: prompt (min 3, max 450), duration int 1–30 s (default 5; always SENT, never «auto» — the price must be
  known before charging), «Aniqlik» enum Erkin 0.3 / O'rta 0.5 / Aniq 0.8 → `prompt_influence`, «Takrorlanuvchi
  (loop)» bool, variants int 1–4 (default 1) → that many calls, one MP3 each (price × count; a failed variant is a
  partial refund through the existing `delivered` rule).
- **Ovozni almashtirish**: one uploaded audio (3–300 s), target voice (the P5 voice list: ElevenLabs library + «Mening
  ovozlarim» own clone; speaking with a clone updates its `last_used_at` like P5), «Fon shovqinini olib tashlash» bool.
- **Shovqindan tozalash**: one uploaded audio (3–300 s). No other control.

## Price (owner rule: real cost × `media.markup`, rounded UP to 100 so'm — shared `studioEntryPrice`, then `tool_pricing` %)
Cost basis = the owner's ElevenLabs **Creator** plan, as P5: $22 / 121 000 credits = $0.000181818 per credit (one constant,
next to `ELEVENLABS_CREATOR_USD_PER_M_CHARS`). Credit rates (ElevenLabs pricing page / docs, read 2026-11-02):

| Mode | Credits | USD | so'm at ×2, 12 700 so'm/$ |
|---|---|---|---|
| Musiqa | 900 / min = 15 / s | 0.002727 / s | 30 s → 2 100 · 60 s → 4 200 · 180 s → 12 500 |
| Effekt | 40 / s of `duration_seconds`, per variant | 0.007273 / s | 5 s → 1 000 · 30 s → 5 600 |
| Ovozni almashtirish | 1 000 / min of input | 0.0030303 / s | 60 s → 4 700 |
| Shovqindan tozalash | 1 000 / min of input | 0.0030303 / s | 60 s → 4 700 |

- Audio-input modes price on the **server-measured** input length, rounded UP to the whole second (`CostRule` per
  second). The client shows the same price after the upload (the upload response returns the measured seconds).
- Client preview = server (`basePriceFor`), `expectedPrice` → 409 like every Studio tab.

## Audio uploads
- `POST /api/media/audio-inputs`: `file` (the browser converts a recording / any upload to 16-bit mono WAV 24 kHz with
  P5 `components/studio/voice/wav.ts`; an MP3 goes as is). Server sniffs WAV / MP3 from the bytes, measures 3–300 s,
  ≤ 25 MB; returns `{ id, seconds }`. Owner-only reads (SQL `user_id`). Limits 20 uploads / hour, 60 / day per user.
- Reuse the P5 sample storage if it fits (do NOT reuse the consent semantics — a voice-changer input is not a clone
  sample); otherwise an additive migration **069** `studio_audio_inputs.sql` (header + ROLLBACK, in
  `tests/admin-migrations.test.mts`, ids given by code). Housekeeping deletes inputs older than 1 day.
- Voice changer needs the same ToS line as P5: «Faqat o'zingizning yoki ruxsatingiz bor yozuvni yuklang» (text, no
  checkbox — the clone checkbox stays clone-only).

## UI (`components/studio/audio/`)
«Audio» tab after «Ovoz» (Rasm | Video | Ovoz | Audio). Mode chips Musiqa / Effekt / Ovozni almashtirish / Shovqindan
tozalash; per mode only its controls (`ParamRows` from the catalog); upload row with recorder for audio-input modes
(reuse the P5 recorder/converter); sticky «Yaratish · <mode> · ~X so'm»; results list with MP3 player + «Yuklab olish
(MP3)» + «Qayta» (reuse `VoiceResults` / `AudioViewer`; the doc carries `kind: "audio"`). Gallery: `kind: "audio"` tiles as
P5. Mobile 360 px: no horizontal scroll.

## Not built in P6 (gaps, documented — no decorative control)
- **Voice + background music mix** (PLAN §16 P6 row): the worker image has no ffmpeg and no MP3 decoder; mixing needs
  decode → PCM mix → `lamejs` encode. Deferred to P7 chains (owner can add ffmpeg to the worker image then).
- Music composition plan / sections / lyrics editor, inpainting, finetunes (`music_v2*` once their credit price is read).
- SFX `eleven_text_to_sound_v3` (credit price not stated).

## Tests (mutation for each new assertion, listed in file headers)
Pure: catalog/params/price rows above (exact so'm), probe test (each param changes request or price), refusal before
charge (switch off, model off, over-limit prompt, bad duration, input too short/long, foreign input id). Flow on an
isolated test DB (127.0.0.1:55440 only): charge → job → output; provider failure → full refund; SFX 3 of 4 variants →
partial refund; upload ownership. UI (jsdom): tab, modes show only their rows, price button + `data-field` probe.
Enumeration tests that always break on a new tool / setting / page: `document.test`, `nav-pure`,
`admin-settings-tabs`, settings, download-formats, viewer-kind, pricing-server, studio-admin-media, ui/studio-page,
ui/shell-phone. Browser smoke (Playwright, `scripts/heavy.sh`) of the Audio tab at 1400 px and 360 px.

## UNVERIFIED (to confirm live after the owner allows deploy)
1. Credit rates above (pricing page rows are estimates; ElevenLabs bills per second for non-TTS) — compare one
   job of each mode against the ElevenLabs usage page; adjust the constants if different.
2. Music API availability on the Creator plan, and Uzbek prompts' quality.
3. Voice changer quality on Uzbek speech (`eleven_multilingual_sts_v2`).

Sources: https://elevenlabs.io/pricing/api, https://elevenlabs.io/pricing, https://elevenlabs.io/docs/api-reference/music/compose,
https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert, https://elevenlabs.io/docs/overview/capabilities/sound-effects
(40 credits / s with a duration), https://help.elevenlabs.io/hc/en-us/articles/26446706351377 (isolator 1 000 credits / min).
