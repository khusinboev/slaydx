# Slide text `bad_json` (prod, 2026-10-12..14)

Symptom: ~3.7 % of slide jobs (4 of 107 in 48 h) failed with «Taqdimot matni yozilmadi» (credits refunded).
Worker log: `[llm] attempt failed  role=stream provider=gemini kind=bad_json error="answer is not parseable JSON"
finishReason=STOP durationMs=0 retryable=true` 34 times in 48 h; the stricter retry (and the Anthropic fallback,
which was also broken by a missing workspace header) often failed the same way.

`finishReason=STOP` means the model finished normally: this is not output truncation.
`durationMs=0` is only how `withJsonRetry` reports the post-hoc quality check (it does not time the call).

## How the answer is assembled and parsed

1. `slide-write.ts askRange` asks one chunk (<= 8 slides) with `llmStream(system, user, maxTokens, { json: true, onText })`
   when the job has a progress sink (always in the worker), otherwise `llmComplete`.
2. `llm.ts llmStream` -> `withJsonRetry(once)` -> `once` = `withRetry` (breaker, limiter, 3 attempts for transport errors)
   -> `streamGemini`: POST `streamGenerateContent?alt=sse`, body from `geminiBody` (`responseMimeType: "application/json"`
   is ALREADY set because `json: true`; there was no `responseSchema`). The SSE bytes are split on `\n`; every `data:` line
   was `JSON.parse`d on its own and a line that failed was **silently dropped**. `thought` parts are filtered; the text
   deltas are concatenated; `finishReason` and `usageMetadata` are taken from the last chunks.
3. `withJsonRetry` runs `checkJson(text, finishReason)`: strict `JSON.parse` (after removing fences) -> else `parseLlmJson`
   (`json.ts`) -> `ok` / `truncated` (MAX_TOKENS) / `bad_json`. Not `ok` -> ONE retry with `STRICT_JSON_REMINDER` appended to the
   system prompt, same streaming call, same JSON mime type. The better of the two answers wins; every paid attempt is
   recorded (`recordLlmUsage` inside `withRetry`).
4. `parseDeckJson` / `extractNewSlides` read `data.slides`. Anything else gives `[]`; an empty chunk is asked once more;
   no slides at all -> «Taqdimot matni yozilmadi».

Old `parseLlmJson`: strip fences, start at the first `{`/`[`, try `slice(start, lastIndexOf(close))`, then the whole rest,
then `repairTruncated` (close open strings/brackets, drop a half-written last token). It only knew about truncation,
fences, prose around the value and trailing commas at the end of a *cut* answer.

## Root cause

Not reproduced live: 12 real streamed slide calls (4 topics x 1-2 chunks, uz/ru/en, 3-16 slides, with notes and quizzes)
all returned strictly valid JSON, so the failure is rare and content dependent. What the code shows is that every
malformation below made `parseLlmJson` return `null` (-> `bad_json`) although the content was complete, and that the retry
was the same blind re-roll (streaming, no schema), so a content-triggered failure repeated. Two further weak spots:

* a `data:` line that was not valid JSON on its own (an SSE event spread over several `data:` lines is legal) was dropped
  without a trace, leaving a hole in the text with `finishReason=STOP`;
* `bad_json` carried no information about *why*.

## Malformations vs the parser

| Malformation | Before | Now (`json-repair.ts`, strategy name in the repair log) |
|---|---|---|
| ```` ```json ```` fence | repaired | repaired (`fence`) |
| prose before / after the object | repaired | repaired (`prose`) |
| BOM | repaired | repaired (`bom`) |
| trailing comma inside a complete answer | NOT repaired (only at a cut) | `trailing_comma`, `extra_comma` |
| raw newline / tab / control char inside a string | NOT repaired | `control_chars` (escaped) |
| unescaped `"` inside a string (`O"zbekiston`, `u "ha", dedi`) | NOT repaired | `inner_quotes` (lookahead decides by what follows the quote) |
| invalid escape (`\alpha`, `\(`, `\_`, `\'`, `\underline`) | NOT repaired | `bad_escape` (backslash kept as text; `\'` -> `'`) |
| typographic quotes as delimiters (`{“a”: “b”}`) | NOT repaired | `smart_quote_delimiters` |
| missing comma between pairs / elements / objects | NOT repaired | `missing_comma` |
| NBSP / zero-width / control chars between tokens | NOT repaired | `stray_chars` |
| the whole object twice | NOT repaired | `duplicate_object` (first copy) |
| NDJSON / several top-level objects | NOT repaired | `multi_object` (array); `extra_fragment` when the last one is cut |
| top-level array of slides, single slide, `[{"slides":..}]` | NOT accepted by `parseDeckJson` | `slideListOf` accepts the wrappers |
| cut answer + any of the above | partly | all combine (rewriter output goes through `repairTruncated`) |

Deliberately NOT repaired (still `null` / `bad_json`, nothing invented): mismatched brackets (`{"a":[1,2}`), unquoted keys,
single-quoted strings, Python literals (`None`), a key without a value, refusal prose, a slide list inside prose that has its
own `[1]` before the JSON (first bracket wins, as before). `\f`, `\b`, `\n`, `\r`, `\t` followed by a letter (LaTeX `\frac`)
are valid JSON escapes and parse as control characters; guessing otherwise would corrupt real newlines.

The rewriter is a single bounded recursive descent (depth 64, 2 MB input, no `eval`, linear time).
It only changes how a value is written; it never adds a key, a value or a word. Valid JSON is not touched (test locks it).

## Retry

First retry (only when the first answer is not `ok`) now:

* is NOT streamed: one `generateContent` call, so the answer arrives atomically;
* keeps `responseMimeType: "application/json"` (it was already on) and adds `responseSchema = deckResponseSchema()`
  (`slide-prompt/schema.ts`, mirrors `deckJsonSchema()` field by field, test-locked) - constrained decoding cannot produce
  broken brackets, commas or quotes. The first attempt stays schema-free (unchanged quality);
* appends `STRICT_JSON_REMINDER` as before; `onText` receives the final text once;
* is counted like any attempt: `withRetry` records the usage, so `cost_json` has both calls; refunds are unchanged.

Other callers of `llmComplete`/roles are unchanged (no `retrySchema` given -> same body as before, the retry only gains the
`retry` flag).

## Observability

* `[llm] json repaired {role, provider, model, repairs:"control_chars,trailing_comma", finishReason}` - one warn line when an
  answer parsed only after repairs (no retry was needed). Count with `grep "json repaired"`.
* `[llm] stream anomaly {model, droppedChunks, finishReason, chars}` - SSE chunks that never became JSON (now assembled
  across `data:` lines first) or a stream that ended without `finishReason`.
* `[llm] attempt failed kind=bad_json` lines remain for answers that are still unusable.

If `json repaired` lines show one strategy dominating, fix the prompt at the source; if `bad_json` persists with neither
line, capture one failing answer (sanitised, synthetic topic) into `tests/slide-bad-json.test.mts`.
