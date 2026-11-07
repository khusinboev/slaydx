# Studio P11: workbench, professional parameters, more providers (spec, 2026-11-06)

Owner request 2026-11-06: review every Studio section; make it stronger, more reliable and better designed; professional and
convenient parameters; a choice of providers in each section where possible; AI prompt rewriting everywhere.

Owner decisions:
- Layout: variant A «Ish stoli», https://claude.ai/artifact/VW19kEkeYAfsEzSRV8TQGc.
- Kling 4.0 and 4.0 Flash sold; Kling 3.0 and effects hidden (`defaultOff`) until a pack covers them.
- Providers: existing keys plus fal.ai. No new accounts.
- Kling 4.0 and Flash ship on: the owner asked for them, and the first real clip proves the path. Every other new model is
  live-tested before users see it: it ships `defaultOff` and the admin switches it on.
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
| G. Templates and automatic prompts | Video templates and samples, English library, «AI yaxshilash» in the worker | M |

## B. Prompt rewriting

`POST /api/media/enhance` takes `{ prompt, kind }`, with `kind` one of `image | video | music | sfx`. A missing `kind` means `image`.

- The model detects the language and answers in English, whatever language came in, including English prompts.
- The subject and every named detail stay. It adds detail fitting the kind: light and camera for image, motion and pacing for
  video, genre, tempo and instruments for music, source and acoustics for sound effects.
- Text meant to be seen or heard stays verbatim in its own language: anything in quotes, and signs or captions the user asks for.
- No real people's names, brands or logos the user did not ask for.
- The answer is `{"prompt":"..."}`. The result goes back into the box for the user to edit; nothing is charged.
- `max` comes from the `kind` and never exceeds that tool's prompt limit. It stays free, under the `enhance` daily bucket.

Not rewritten: speech text, dialogue, song lyrics, avatar scripts, dubbing and transcripts. There the words are the product.

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

## G. Templates and automatic prompts

Owner decision 2026-11-07: templates are wanted, prompts are English, and a user's prompt is translated to English and improved
automatically.

### Library

- `studio_prompts.media` is `image | video | music | sfx`, `studio_templates.media` is `image | video` (migration 076). Each kind
  has its own categories (`categoriesOf`). `GET /api/media/library?media=` and `GET /api/media/templates?media=` default to `image`.
- A picture template stays bound to its model. A clip template's model is a suggestion: it is listed while any clip model is on
  sale, and lands on the suggested model, else the model on screen, else the first (`videoTemplateTarget`). What that model
  cannot take is dropped by `carryOver`, and a line says which model it landed on. Effects and avatars cannot carry a skeleton.
- Text is English. Titles and slot labels stay Uzbek. A slot's `placeholder` stays the Uzbek example the input shows; its new
  `fallback` is the English value an empty slot puts into the prompt, so an untouched template reads English with the switch off.
- Migration 076 rewrites the 40 prompts and 10 skeletons only where `seed_key` matches and the text is still the seeded text, so
  admin edits survive. Quoted on-screen text stays verbatim.

### «AI yaxshilash»

A switch in the prompt box of a drawing, a clip, music, a sound effect and «Solishtirish». On by default, one choice per user,
kept beside the drafts but not cleared by a submit (`useAiImprove`). The request carries `aiImprove`, next to the ParamSchema: it
changes no price.

| `aiImprove` | Drawing | Clip, music, effect |
|---|---|---|
| `true` | the rewrite is the scene (`expandPrompt` is skipped: one LLM pass) | the rewrite goes to the provider |
| `false` | the user's words | the user's words |
| absent (an older job or client) | `expandPrompt`, as before | the user's words, as before |

- It runs in the worker, right before the provider call (`lib/generation/studio/auto-prompt.ts`), with the system prompt and
  `restoreQuoted` of the «Yaxshilash (AI)» button, on the `fast` role: 20 s per attempt, 25 s in all.
- **Once.** `studio_prompt_rewrites` (migration 077) is claimed BEFORE the call. A re-claim reads the row and pays nothing. A
  pending row older than 30 s belongs to a dead worker whose call may be paid: it is closed as failed, not repeated.
- **Never a failure.** An LLM error, timeout or unusable answer (a declining sentence counts), or a store error, sends the user's
  own prompt: no failure, no refund. A failed rewrite is stored too, so a re-claim does not try again.
- **Kill switch.** `free_llm.disabled` stops the call, and the job goes on with the user's prompt. A rewrite already stored is
  still used. `expandPrompt` and the edit instruction's translation are not under it.
- **Refused rewrite.** A provider's safety refusal of the rewrite gets the user's own words once, on the same purchase: the user
  never saw that text. A picture retries per picture, an audio variant on its own step and the remaining variants follow. A clip
  retries only when the provider has not accepted the job (`e.accepted` false), on the same `media_jobs` row. A refusal after
  acceptance is not retried: that clip was a paid operation and a second one would be a second bill, so the refund runs and the
  failed card shows the text (`failedSentPrompt`, `sentPrompt` of `GET /api/generations/<id>`).
- **Picture rule.** `workerRewriteRule` adds what `expandPrompt` forbade: no style, medium or camera brand, and no lettering unless
  the model has the `matn` badge, because `composePrompt` adds the style and the text rule afterwards. Quoted text stays.
- **Limits.** `fitPrompt` cuts to the model's `max` and `maxBytes` at a word end. A cut that loses quoted text, or leaves less than
  the model's minimum, sends the user's own prompt.
- **«Solishtirish».** A batch shares one row through `compare_group`, so every model gets the same prompt; otherwise the batch would
  compare prompts. The first member makes the rewrite and carries its cost, the others wait. A batch cannot mix the switch. A
  failed cell retried alone is a new job with its own rewrite.
- **Record.** The gallery, the history and `values_json` keep the user's text. `doc.sentPrompt` holds the English when it differs,
  and the result card shows it under «Yuborilgan prompt». The cost goes to `cost_json`: through the build meter for pictures and
  audio; a clip has no build meter, so it is stored at submit, reaches `ai_usage` from there, and `finalizeVideo` adds the clip to it.
- **The button.** «Yaxshilash (AI)» stays the see-it-first way. A prompt that is still the button's own answer goes as it is
  (`aiImprove: false`): the user has read that text, and it stays known across a refresh. Any edit makes it theirs again.

Never rewritten: an image edit instruction, an avatar script, speech, dialogue, dubbing, transcripts, and pasted lyrics
(`looksLikeLyrics`: section tags such as `[1-band]`, labels such as `Naqorat:` or `1-band:`, or three or more mostly short lines). Lines
are judged on the text as typed, in the form and in the job, because the request collapses them. The button refuses lyrics too.

The edit box has no switch. The improver adds lighting and composition, and an edit must change only what was asked
(`composeEditPrompt`). Its existing translation-only step stays, so Uzbek instructions still reach the model in English.

«Ovoz» has no samples: its box holds the words to be spoken, which the user brings. «Audio» gained 8 music and 8 effect samples
on the same library. Voice changer, isolator, transcripts and dubbing have no prompt.

## Definition of done per package

Own branch and PR; full test run on a fresh database; a mutation for each new assertion; browser smoke at desktop and phone width for UI;
independent review; CI; merge; production check.
