# Text fallback: Qwen and DeepSeek after Gemini

Written 2026-11-05 after the Gemini outage of the same day: Gemini answered 403 for hours (billing or outage) and 90 paid
text jobs failed, because the text path had only Gemini. **Until a key is entered nothing changes in production.** A
fallback without a key is not in any chain.

## What happens during an outage

1. A job calls Gemini. A 401/402/403, or a 400 that says the key is bad, is an account failure: no retry on Gemini.
2. Gemini's breaker opens for 60 s, so the rest of the job and other jobs do not rediscover the failure. One probe per
   minute notices the recovery. It opens at once for 401, 402 or a refusal that names the account (balance, billing,
   API key, suspended); a bare 403 may be one gated model, so that takes two in a row. Either way the job itself moves on
   at once.
3. The chain moves on at once: Qwen, then DeepSeek. A 5xx or 429 is retried three times on Gemini first.
4. The job completes. The price the user paid is unchanged; `cost_json` and `ai_usage` show the provider really used.

With no fallback key, a job with a deadline can wait up to 35 s for the breaker's probe once the cooldown is that close,
then fail as before. So during an account outage such a job may fail up to 35 s later than it used to.

A Gemini that HANGS falls back only inside a deadline. Generation jobs and the AI chat have one. Web and bot calls with no
deadline (`/api/media/enhance`, `/api/article/udk`, the domla's questions) stop at the first timeout, because the caller's
budget is unknown: they fall back on HTTP errors only, so during a hang they fail as they always did.

The worker log has one line per fallback answer, metadata only: `grep "fallback used"`. Spend appears under the provider's
own row in admin «Provayderlar» and in the AI cost pages.

## Default order and why

`gemini:<llm.model>` → `qwen:qwen3.7-plus` → `deepseek:deepseek-flash`.

Qwen comes first as the provider marketed as most multilingual; DeepSeek is second as the cheaper one. GLM and Kimi were
not added: they cost more, and Kimi K2 is retiring (lead's analysis, not re-verified here).

### Official prices, read 2026-11-05 (USD per 1M tokens)

| Model | Input | Output | Source |
|---|---|---|---|
| `qwen3.7-plus` (Singapore, ≤ 256K input) | 0.40 | 1.60 | [pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [model page](https://www.alibabacloud.com/help/en/model-studio/qwen3-7-plus) |
| `qwen3.8-flash` (Singapore) | 0.15 | 0.47 | [pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) |
| `deepseek-flash` (V4.1 Flash) | 0.30 peak, 0.15 off-peak | 1.20 peak, 0.60 off-peak | [pricing](https://api-docs.deepseek.com/quick_start/pricing) |
| `deepseek-v4-pro` | 1.32 peak, 0.66 off-peak | 3.96 peak, 1.98 off-peak | [pricing](https://api-docs.deepseek.com/quick_start/pricing) |
| `gemini-3.7-flash` (for comparison) | 0.75 | 3.75 | `lib/generation/llm-pricing.ts` |

DeepSeek's peak is 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. The price book stores the PEAK rate, so a fallback
is never under-reported. Cached input is cheaper on both but is priced as ordinary input, for the same reason.

The two Alibaba pages disagree: the model page calls $0.40/$1.60 the original price, the pricing page calls the same row a
limited-time 20 % discount. If the discount reading is right, the list price is about $0.50/$2.00 when it ends.

## What is UNVERIFIED

- **Uzbek quality.** No published benchmark covers Uzbek on these models. Run the bench below and read it before relying
  on them; if the text is poor, the honest choice is to leave the key out, because a job that fails is refunded.
- **The real API.** Every test runs on a stubbed fetch. No request has been sent to Alibaba or DeepSeek: the ids, base
  URLs and parameters come from their documentation. The first real check is «Tekshirish» and the bench.
- `enable_thinking: false` on `qwen3.7-plus` together with `response_format`. The docs say structured output works in
  non-thinking mode.
- The wording of a provider's `max_tokens` 400, and of Gemini's account refusals other than the suspended-consumer one
  seen in production. A refusal that names nothing counts as a bare 403.
- The HTTP status of some DashScope failures (`Arrearage` is listed as 403, `isv.OUT_OF_SERVICE` has none). They are
  matched by code string, so either way they count as account failures.
- Slide quality on a fallback: prompts were written and tuned on Gemini. A deck completes; its gates may still refuse a
  thin answer from a weaker model.
- Data residency: a fallback sends the user's topic and text to Alibaba (Singapore) or DeepSeek. The owner should decide
  whether the public offer needs to say so.

## Owner steps

1. **Qwen.** [Model Studio console](https://modelstudio.console.alibabacloud.com/), region **Singapore**, create an API
   key. A key from another region answers 401.
2. **DeepSeek.** [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys), top up, create a key.
3. **Admin → Provayderlar → Matn**, each provider: enter the key, «Tekshirish». It spends one token (a fraction of a
   cent) on the model in the chain, so a wrong model id or an empty balance shows here. DeepSeek also shows the balance.
4. **Test Uzbek before relying on it** (a few cents, real money):
   ```
   DASHSCOPE_API_KEY=… DEEPSEEK_API_KEY=… GEMINI_API_KEY=… \
     scripts/heavy.sh npx tsx --conditions=react-server scripts/llm-uz-bench.mts
   ```
   Output: `eval-out/llm-uz-bench.md`, five prompts side by side with latency and cost. A model with no key is skipped.
5. **Check the order.** «Matn zanjiri (asosiy va zaxira)» shows Gemini, Qwen, DeepSeek. Reorder with the arrows, or put a
   Chinese model first; «Saqlash» asks for a reason and is audited.
6. **Check the roles.** A role badged as the admin's choice runs its stored chain EXACTLY and does not gain the fallbacks:
   add them in that role or press «Standartga qaytarish». Roles from the server environment (`LLM_WRITER`…) keep their
   order and gain only Qwen and DeepSeek, never Gemini: `LLM_JUDGE=anthropic:…` does not start calling Gemini. Production's
   rows were not inspected for this work.

To switch a fallback off: the provider's on/off switch or removing its key. The change reaches the workers within 30 s.

## What never falls back

| Path | Why |
|---|---|
| Internet search (`llmGrounded`, pro-slide) | No search tool. An answer from another model's memory would enter the deck's prompt under the «verified» heading, so research is skipped and the deck is written without it, the path that already existed. |
| Domla voice answers | Audio goes only to Gemini. A typed answer does fall back. |
| Test analysis (`tests.analysis`) | Multimodal, and one answer is cached for all users forever: a weaker answer written during an outage would stay. It fails and «Qayta urinish» works once Gemini is back. |
| Images, TTS, video, music | Not text. They have their own providers. |

Gemini-only options degrade safely: `thinking` is ignored and thinking is off, `responseSchema` becomes a prompt hint.

## Two checks on a fallback's answer

- `<think>…</think>` in the answer is removed.
- **Language guard.** An answer with more than 2 % Chinese, Korean or Japanese letters (at least 3 characters) counts as
  failed: logged as `[llm] attempt failed` with `kind: empty`, the provider stays healthy, the chain moves on. It does not
  apply when the request itself allows CJK: `languageDirective` and the translation prompts name the output language, so
  a zh/ko/ja job passes. This reads the prompt, not a language field, and it fails open: a topic such as «Xitoy tarixi»
  also switches it off. Those answers are simply not checked. Gemini and Claude are not guarded.

`max_tokens` is capped at 65 536. Documented limits are higher (131 072 for `qwen3.7-plus`, 384K for DeepSeek), but none
was found for `qwen3.8-flash`, so a 400 about the limit gets one more try with the limit the message names, else half.

## How it is built

- `lib/generation/llm/openai-compat.ts`: one adapter, one preset row per provider.
- `lib/server/providers/route-effective.ts`: the `llm.chain` slot and `DEFAULT_TEXT_FALLBACKS`. A new slot rather than a
  new shape for `llm.model`, because an old stored `llm.model` row would otherwise mean «no fallback» silently.
- `lib/generation/llm.ts walkTextChain`: the direct tools (slide, course work, translation, resume...) walk the chain.
  Gemini keeps its own path; with only Gemini usable this is the old code path, call for call.
- `lib/generation/llm/chain.ts`: the roles. Keyless fallbacks are removed in `roleSpecs`, not merely skipped, because
  being the LAST spec decides the breaker wait and the timeout retry.
- `lib/generation/llm/failure.ts isAccountFailure`: what counts as an account failure.

### Adding another OpenAI-compatible provider

1. `OPENAI_COMPAT_IDS` in `llm/types.ts`, then a row in `OPENAI_COMPAT_PRESETS` and `OPENAI_COMPAT_ADAPTERS`.
2. `TEXT_PROVIDERS` in `providers/routes.ts`, the `text` purpose in `catalog.ts`.
3. A registry row, `PROVIDER_META`, its price rows, the env key in `docker-compose.yml` (both services), `.env.example`,
   `tests/helpers/hermetic-env.mts`.

TypeScript and `tests/llm-openai-compat.test.mts` («every preset is wired end to end») fail until these are done.
