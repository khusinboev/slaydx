/**
 * xAI (Grok) adapteri (Maqola 2 / AUDIT-17, WP8).
 *
 * Mavjud `llm.ts` xAI yo'lidan — `runLlmRaw` seam orqali: OpenAI-mos
 * `chat/completions`, `usage.prompt_tokens`/`completion_tokens`. Faqat
 * zaxira yozuvchi (tadqiqotda foydalanilmaydi — qidiruv vositasi yo'q).
 */
import { runLlmRaw } from "../llm";
import type { AdapterOpts, Attempt, ProviderAdapter } from "./types";

export type XaiDeps = { fetchImpl?: typeof fetch };

export function makeXaiAdapter(deps: XaiDeps = {}): ProviderAdapter {
  return {
    id: "xai",
    async complete(model, system, user, opts: AdapterOpts): Promise<Attempt> {
      const res = await runLlmRaw("xai", model, system, user, opts.maxTokens, {
        json: opts.json,
        timeoutMs: opts.timeoutMs,
        fetchImpl: deps.fetchImpl,
      });
      if (res.ok) return { ok: true, text: res.text, usage: res.usage };
      return { ok: false, error: res.error, retryable: res.retryable, status: res.status, retryAfterMs: res.retryAfterMs };
    },
  };
}

export const xaiAdapter = makeXaiAdapter();
