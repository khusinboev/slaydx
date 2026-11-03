# Studio P9 — new models: Sora 2 (fal) and Lyria (Gemini)

Owner decisions (2026-11-03): add **Sora 2 through fal** and **Lyria music through the existing Gemini key**; HeyGen
waits (it needs its own account and key). Price = provider cost × `media.markup` (×2 default), like every Studio
model. One live job per model on the admin account before the owner announces it. HeyGen (later the same day): built
dark until a key exists — `docs/studio/P9-HEYGEN.md`.

## Sora 2 / Sora 2 Pro («Video» tab)

| | Sora 2 | Sora 2 Pro |
|---|---|---|
| Catalog id | `openai/sora-2` | `openai/sora-2-pro` |
| fal endpoints | `fal-ai/sora-2/{text,image}-to-video` | `fal-ai/sora-2/{text,image}-to-video/pro` |
| Lengths | 4 / 8 / 12 s (int, step 4) | same |
| Quality | 720p only (no «Sifat» row) | 720p / 1080p (default 1080p) |
| USD / s | 0.10 (OpenAI's rate; UNVERIFIED on fal until the live job) | 0.30 / 0.50 (fal Pro page) |
| Price, 4 s, ×2 @ 12 700 | 10 200 so'm | 30 500 (720p) / 50 800 (1080p) |

- Same queue adapter as P4 (`fal-video`): submit → `fal:<endpoint>:<id>` → shared poll; the poll URL is the app
  `fal-ai/sora-2` (`ownerApp`), the download is the fal CDN URL without the key.
- Aspect 16:9 | 9:16 (image → video sends «auto»: the frame decides; the form hides «O'lcham»). Sound always on — no
  switch. No end frame. `delete_video: true` (OpenAI drops its copy); `model: "sora-2"` pinned on the standard endpoint.
- Not sold: 16 / 20 s and `true_1080p` (price and the 25 MB result cap).
- OpenAI refuses many photos of real people in image → video: that is a content-policy failure → full refund.

## Lyria («Audio» tab → «Musiqa», second model)

- Catalog `google/lyria-3`, route `gemini` / `studio-gemini-lyria` (`lib/media/adapters/lyria.ts`).
- One synchronous call: `POST https://generativelanguage.googleapis.com/v1beta/interactions`, headers
  `x-goog-api-key`, `Api-Revision: 2026-05-20`, body `{ model, input }`; the answer's `steps[].content[]` holds a
  `type: "audio"` block (`mime_type: "audio/mpeg"`, base64) and a text block (lyrics). Shape confirmed by one live clip
  on 2026-11-03 (200 in 12.8 s, ~745 KB MP3).
- «Turi»: `clip` → `lyria-3-clip-preview` (always 30 s, $0.04) · `song` → `lyria-3.5` (full song, length steered by the
  prompt, $0.08). Price ×2 @ 12 700: 1 100 / 2 100 so'm. «Faqat kuy» appends the documented line
  «Instrumental only, no vocals.» (the API has no field for it).
- `studio.music` now allows [ElevenLabs, Lyria], ElevenLabs default, `userCanChoose: true`. `AUDIO_MODES[].models`
  lists a mode's models (first = default); the tab draws a «Model» picker only where a mode has more than one offered
  model; switching carries over the values the other model accepts (the prompt, «Faqat kuy»).
- Errors: 429 / 5xx / network retryable; our own timeout = accepted (may be billed); 400 with a policy text, or a
  completed answer without audio whose text says blocked = safety; the key is scrubbed from every message.

## Tests

`tests/studio-video-sora.test.mts` (6, 5 mutations), `tests/studio-lyria.test.mts` (6, 5 mutations),
`tests/ui/studio-audio.test.mts` «P9 model picker» (2 mutations); catalog / admin / probe tests extended.

## Owner smoke checklist

1. Video → Sora 2, 4 s, a text prompt → plays; compare the fal usage page with $0.40.
2. Video → Sora 2 Pro 720p, 4 s, from a photo (no person) → plays.
3. Audio → Musiqa → Model «Google Lyria 3» → «Qisqa (30 s)» and «To'liq qo'shiq» → both play; the Gemini bill shows
   $0.04 / $0.08.
