# Studio P11: workbench, professional parameters, more providers (spec, 2026-11-06)

Owner request 2026-11-06: review every Studio section; make it stronger, more reliable and better designed; professional and
convenient parameters; a choice of providers in each section where possible; AI prompt rewriting everywhere.

Owner decisions:
- Layout: variant A «Ish stoli», https://claude.ai/artifact/VW19kEkeYAfsEzSRV8TQGc.
- Kling 4.0 and 4.0 Flash sold; Kling 3.0 and effects hidden (`defaultOff`) until a pack covers them.
- Providers: existing keys plus fal.ai. No new accounts.
- New models are live-tested before users see them. They ship `defaultOff`; the admin switches them on.
- Prompt rewriting in every prompt box: detects the language itself and writes the English prompt.

## Packages, in merge order

| Package | Content | Size |
|---|---|---|
| A. Kling 4.0 | Models, `defaultOff`, old «Video» tool on Flash, «Tekshirish» shows pack scope | S |
| B. Prompt | `POST /api/media/enhance` with `kind`; one `PromptCard` for all tabs | S |
| C. Reliability | Shared `SubmitError`, `CatalogState`, `JobResult`, `useStudioSend`; drafts; tab and mode in the URL; jobs restored after refresh; audit's silent-failure fixes | L |
| D. Workbench | Variant A on all tabs; phone scrolls to the result; model cards with specs; better controls | L |
| E. Audio providers | fal Scribe v2, fal dubbing, HeyGen translate, SFX, clean audio, fal ElevenLabs TTS | M |
| F. Video and image providers | Pixverse effects, Kling 1.6 effects, Grok lite, Pixverse v6, Happy Horse, Muse, FLUX Klein, avatars | M |

## B. Prompt rewriting

`POST /api/media/enhance` takes `{ prompt, kind }`, with `kind` one of `image | video | music | sfx`. A missing `kind` means `image`.

- The model detects the language and answers in English, whatever language came in, including English prompts.
- The subject and every named detail stay. It adds detail fitting the kind: light and camera for image, motion and pacing for
  video, genre, tempo and instruments for music, source and acoustics for sound effects.
- Text meant to be seen or heard stays verbatim in its own language: anything in quotes, and signs or captions the user asks for.
- No real people's names, brands or logos the user did not ask for.
- The answer is `{"prompt":"...","language":"uz"}`. The result goes back into the box for the user to edit; nothing is charged.
- `max` comes from the `kind` and never exceeds that tool's prompt limit. It stays free, under the `enhance` daily bucket.

Not rewritten: speech text, dialogue, song lyrics, dubbing and transcripts. There the words are the product.

## C. Reliability

From the audit of 2026-11-06:
- A refresh keeps the form draft (per tab, in `localStorage`, wrapped in try/catch), the tab and the mode. In-progress jobs come back from the server.
- `enterMode` no longer wipes the prompt.
- Errors of gallery picture tools are visible. Voices list has loading, failure and retry. Speech tools show `job.error` with a retry.
- Retry shows its price. Refund wording is one phrase.
- One component each for the error and top-up block, catalog state, job card, download, send.

## D. Workbench

- Desktop: settings on the left, results on the right, on every tab. Phone: one column, sticky price button, scroll to the result after submit.
- Model card: maker, length limit, best quality, capabilities, price. `ModelSpecs` derives from the catalog params, so a card cannot disagree with the form.
- Controls: presets plus direct input for long ranges; shape preview for aspect; ratio and style hints; `startOffset` capped to the chosen video.
- A model switch that drops a value says so instead of resetting silently.
- Dublyaj and Transkripsiya accept the user's own video.

## E and F. Providers

Every endpoint is checked against its fal page before coding: path, params, price, output. Prices enter the catalog with the source URL.
Uzbek is stated on fal only for Wizper, VEED dubbing and HeyGen translate. Any other speech or text-in-media model needs a live Uzbek test before the admin enables it.

The first models, ordered by value:
1. `fal-ai/elevenlabs/speech-to-text/scribe-v2`, $0.008 / min. Works without the ElevenLabs key's missing permission.
2. `fal-ai/elevenlabs/dubbing`, $0.6 / min.
3. `fal-ai/heygen/v2/translate/speed`, $0.05 / s, states Uzbek (Latin).
4. `fal-ai/pixverse/v5.5/effects`, 720p $0.20 / 5 s, about 150 effects.
5. `fal-ai/kling-video/v1.6/standard/effects`, $0.056 / s, the nine scene ids we already sell.
6. `xai/grok-imagine-video/v1.5/lite`, 720p $0.03 / s.
7. `meta/muse-image` generate and edit, $0.01 each.
8. `blackforestlabs/flux-3/klein` generate and edit, $0.009 at 1K.
9. `fal-ai/pixverse/v6`, 720p $0.045 / s silent, $0.06 with audio.
10. `alibaba/happy-horse/v1.1`, 720p $0.14 / s.
11. `bytedance/omnihuman/v2`, `fal-ai/kling-video/ai-avatar/v2/standard`, avatars driven by the user's own speech.
12. `elevenlabs/sound-effects/v3`, `veed/clean-audio`, `fal-ai/elevenlabs/tts/eleven-v3`, `elevenlabs/tts/eleven-v4-turbo`.

Open before E: whether fal takes large audio and video as data URIs, or needs fal storage upload first. Not stated on the pages.

## Definition of done per package

Own branch and PR; full test run on a fresh database; a mutation for each new assertion; browser smoke at desktop and phone width for UI;
independent review; CI; merge; production check.
