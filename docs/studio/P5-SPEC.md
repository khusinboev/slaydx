# Studio P5 — «Ovoz» tab: speech, dialogue, voice library, voice cloning (spec + what shipped, 2026-11-02)

Parent: `docs/studio/PLAN.md` §3 (voice), §10 / §13 (owner: Gemini TTS + ElevenLabs v3 with cloning; ToS line +
«I have the right to use this voice» checkbox, abuse limits), §17 (ElevenLabs rows). Builds on P0 (core, `media_jobs`),
P1 (Studio shell, cost × markup), P3 (tab bar). Owner decisions 2026-11-02 are implemented as written below.

## What ships
- **Tools** `studio-speech` (speech / dialogue) and `studio-voice` (one voice clone), group media, output MP3, both
  unlisted (`UNLISTED_TOOL_IDS`: sold inside the Studio only; `/uz/studio-speech`, `/uz/studio-voice` redirect to
  `/uz/studio?tab=ovoz`), excluded from the AI chat. Purposes **`studio.speech`** / **`studio.clone`**; every provider call
  is one `runMedia` call (`media_jobs` row per call; the user's text is stored only as its length).
- **Dark switch** `studio.voice.enabled` (Sozlamalar → Media dvigateli, default OFF): off = no model listed, the route
  refuses (400), nothing charged. Then per model: provider on + keyed in «Provayderlar»; Gemini also needs
  `TTS_GEMINI_MODEL` (the podcast rule); not switched off in «Media modellari».
- **Price** (owner): provider cost × `media.markup` (model override wins), rounded UP to 100 so'm — the shared
  `studioEntryPrice` — then the tool's `tool_pricing` %. Client preview = server (`speechClientPrice` vs
  `basePriceFor`; `expectedPrice` 409 guard). **Clone** = fixed `studio.clone_price` (Narxlar group, default 5 000 so'm,
  100–1 000 000) + the `studio-voice` tool %; speaking with a clone costs the normal ElevenLabs price.
- **UI** (`components/studio/voice/`): «Ovoz» tab after «Rasm» | «Video»; text box with «N / 4 000 belgi · ~M s» and
  «Fayldan» (.txt ≤ 64 KB into the box); «Matn» | «Suhbat»; model picker (cards «~X so'm / 1 000 belgi»); voice list with
  chips Hammasi / Erkak / Ayol / Mening ovozlarim (the last only for ElevenLabs models), ▶ preview per voice (one player,
  mounted only on click); «+ O'z ovozimni klonlash (30 s yozuv) · 5 000 so'm»; the model's own settings (Tezlik,
  Kayfiyat, Til — only those the model really has); sticky «Ovozlash · <model> · ~X so'm»; results with an MP3 player,
  «Yuklab olish (MP3)», «Qayta». The result page uses the existing `AudioViewer` (reads `doc.speech`). Gallery: `kind:
  "audio"` items (tile + player; no «again» button — the gallery does not carry the full text).
- **Not built**: «Fon musiqa» (P6, no control drawn); «AI bilan yozish» (no fitting free-LLM endpoint yet — gap, no
  decorative button); ElevenLabs Voice Design (gap, see below).

## Models, endpoints, prices (read 2026-11-02; so'm at ×2, 12 700 so'm/$)
| Catalog id | Endpoint | Params (each changes request or price: probe test) | USD | so'm |
|---|---|---|---|---|
| `elevenlabs/eleven-v3` (default) | `POST /v1/text-to-speech/{voice}?output_format=mp3_44100_128`, `model_id: eleven_v3` | text ≤ 4 000, voice (library or own clone), speed 0.8–1.2 (`voice_settings.speed`), Kayfiyat = stability 0 / 0.5 / 1, language (16 of our 18) | 0.1818 / 1 000 chars (Creator plan) | 1 000 chars 4 700 · 140 chars 700 |
| `google/gemini-tts` | existing Gemini TTS adapter (`TTS_GEMINI_MODEL`, ≤ 1 400 chars per call, chunks joined) | text, voice (12 prebuilt) | 0.016833 / 1 000 chars (quote) | 1 000 chars 500 |
| `elevenlabs/v3-dialogue` | `POST /v1/text-to-dialogue`, `{inputs:[{text, voice_id}], model_id: eleven_v3, settings:{stability}}` | script ≤ 2 000 («Ism: gap» lines, 2 speakers), voice1, voice2, Kayfiyat, language | 0.1818 / 1 000 chars | as v3 |
| `google/gemini-dialogue` | Gemini multi-speaker (`multiSpeakerVoiceConfig`, one call) | script ≤ 1 400, voice1, voice2 | 0.016833 / 1 000 chars | as Gemini |
| `elevenlabs/voice-clone` | `POST /v1/voices/add` (multipart `name`, `files`, `remove_background_noise=false`) → `voice_id`; `DELETE /v1/voices/{id}`; slots `GET /v1/user/subscription` (`voice_slots_used`, `voice_limit`) | name, sample | no per-call price | fixed 5 000 |

**ElevenLabs cost basis (owner decision 2026-11-02):** the REAL plan cost — Creator $22 / 121 000 credits, 1 credit per
eleven_v3 character → $22 / 121 000 × 1 000 ≈ $0.1818 per 1 000 characters (`ELEVENLABS_CREATOR_USD_PER_M_CHARS` in
`lib/generation/llm-pricing.ts` `TTS_PRICING`, which the Studio catalog reads). The same row is the podcast / greeting
premium voice's COST telemetry (now truthful in admin cost reports); their PRICE (`PREMIUM_VOICE_SOUM_PER_MIN`) is
unchanged. The $0.08 API list price is not what the owner pays.

Sources: https://elevenlabs.io/pricing/api (v3 list price $0.08 / 1K chars), https://elevenlabs.io/pricing (Starter $6 / 30 000
credits, 10 custom voice slots; Creator $22 / 121 000, 30 slots), https://elevenlabs.io/docs/overview/models (eleven_v3:
Uzbek, 5 000 chars / request), https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert (≤ 2 000 chars, ≤ 10
voices), …/voices/ivc/create, …/voices/delete, …/user/subscription/get, …/text-to-speech/convert (voice_settings).
Gemini: `TTS_PRICING` Flash TTS row ($10 / 1M audio tokens, 25 tokens / s) at an assumed 15 chars / s.

## Voice cloning (owner 2026-11-02)
- **Sample**: `POST /api/media/voices/samples` — `file` + `consent=1` (mandatory «Bu ovozdan foydalanishga haqqim bor»).
  The browser converts any recording (MediaRecorder WebM / Ogg / MP4) or upload to 16-bit mono WAV 24 kHz; an MP3 goes as
  is. The server sniffs WAV / MP3 from the bytes, measures 30–180 s, ≤ 10 MB; stores consent time, HMAC(IP, session
  secret), wording version. Limits: 5 uploads / hour, 10 / day per user.
- **Before charging** (`assertCloneAllowed`): tab on + ElevenLabs available; the sample is the user's own (SQL); no
  active clone and no clone job in flight; ElevenLabs slots read (30 s cache) and `used < limit` — else 409
  `no_voice_slot` («Hozir yangi ovoz klonlash uchun bo'sh joy yo'q…»); unreadable slots → 503 (never charge blind).
- **Job** (all or nothing): row `studio_voices` in 'creating' BEFORE the provider call (partial unique index = one
  active clone per user in the DB) → IVC → a short Uzbek preview with the new voice (the job's MP3) → ready, sample bytes
  cleared. Any failure removes the clone (and deletes the ElevenLabs voice if made) → FAILED, full refund.
- **Delete**: `DELETE /api/media/voices/<id>` (SQL ownership; 404 otherwise) — hidden at once (a new clone may be bought),
  ElevenLabs voice deleted now or by housekeeping (`provider_deleted_at`).
- **30-day purge** (housekeeping step `studio-voices`): unused 27 days → one bot DM (`sendUserDm`, claimed by
  `warned_at`; users without Telegram see the in-app notice «ishlatilmasa N kundan keyin o'chadi» in «Mening
  ovozlarim»); unused 30 days → deleted + provider DELETE; owed deletes retried; 'creating' rows > 1 h closed; samples
  older than 1 day deleted. Speaking with a clone resets `last_used_at` / `warned_at`.
- **Admin**: slots on the ElevenLabs «Tekshirish» line («ovoz slotlari: 3 / 10 band»); speech models in «Media
  modellari» (unit «1 000 belgi»); clone price in Sozlamalar.

## Previews
`GET /api/media/voices/preview/<key>` (`elevenlabs:<id>`, `gemini:<name>`, `clone:<id>` own only): served from
`studio_voice_previews`; a voice never heard before costs ONE provider call ever (concurrent misses share it).
Telemetry: a preview runs outside a job, so it writes no `media_jobs` / `ai_usage` row (review NIT, documented, not
built): the whole library is at most 22 calls × ~80 characters once (ElevenLabs 10 × ≈ $0.015, Gemini 12 × ≈ $0.0013 —
under $0.20 in total, ever); a clone's preview is part of its clone job (metered there).

## Review fixes (2026-11-02)
- **M1** what is spoken = what is priced: `studioSpeechError` refuses a text / script whose normalized length is over the
  model's `max` (400 «Matn juda uzun…» before the charge); the engine re-checks (refund) and sends only the parsed turns;
  `doc.speech.chars` = the characters actually sent.
- **m5** the dialogue PRICE stays on the whole normalized script (speaker names and line breaks included) — slightly
  above what ElevenLabs bills (it bills the turns' text): house-favourable by design, a few characters per line.
- **m1** orphan clones: hourly `reconcileOrphanClones` lists `GET /v2/voices?category=cloned&search=SlaydX Studio`
  (https://elevenlabs.io/docs/api-reference/voices/search: `voice_id`, `category`, `description`, `created_at_unix`,
  `has_more` / `next_page_token`) and deletes our marked clones older than 1 h that no `studio_voices` row names; a voice
  without a creation time, an unmarked one, a young one or a listing failure is left alone.
- **m2** a 'creating' row is swept when its job is over (FAILED / REVOKED / COMPLETED / gone) or after 10 min.
- **m3** tested: IVC ok → preview fails → the ElevenLabs voice is deleted, `delete_reason = 'failed'`, full refund.
- **m4** the worker reads the trimmed voice value (the one the route validated).
- NITs: strict UUID on delete (404, never a 500 from the cast); a malformed preview escape is a 404.

## Migration 068 `studio_voices.sql`
`studio_voice_samples`, `studio_voices` (+ `studio_voices_one_active` unique partial index, CHECKs: ready needs the
provider id, delete_reason with deleted_at), `studio_voice_previews`. Additive, header + ROLLBACK, in
`tests/admin-migrations.test.mts`.

## Tests (mutations listed in each file header, all turned red then restored)
`tests/studio-speech.test.mts` (pure, 21), `tests/studio-speech-flow.test.mts` (isolated DB, 10),
`tests/ui/studio-voice.test.mts` (5); enumerations updated in settings, download-formats, viewer-kind, pricing-server,
studio-admin-media, admin-migrations, ui/studio-page, ui/studio-video, ui/shell-phone.

## UNVERIFIED / gaps
1. **Uzbek quality of each library voice** — needs a live listen (the previews are what users judge by).
2. Gemini voice gender labels (Google's descriptions), and the Gemini quote for a **Pro** TTS model (2× the Flash price).
3. IVC sample formats/limits are not stated on the reference page (we send WAV / MP3 ≤ 10 MB).
4. A clone call that times out after ElevenLabs created the voice: the job is refunded and the orphan voice is deleted
   by the hourly reconciliation after 1 h (review m1). UNVERIFIED: that `search` matches the description marker and that
   `created_at_unix` is set for new IVC voices (without it the voice is left for the admin).
5. **Voice Design** (text → voice) not built: it costs preview characters, saving a designed voice takes a scarce slot
   (Starter: 10), and the pricing is not on the API price page.
6. «AI bilan yozish» not built (no free-LLM text writer endpoint for this; a P5.1 item).
7. ElevenLabs v4 (`eleven_v4`, Uzbek, $0.08) exists now; the owner decided v3 — switching is one catalog line.
8. No live provider call was made (no keys here).
