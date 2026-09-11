/**
 * Gemini adapteri (Maqola 2 / AUDIT-17, WP8).
 *
 * Mavjud `llm.ts` Gemini yo'lidan — `runLlmRaw` seam orqali: so'rov
 * shakli (JSON rejimi, thinking, `geminiBody`) AYNAN bir xil, qo'shimcha
 * ravishda `usageMetadata.promptTokenCount`/`candidatesTokenCount` ham
 * qaytadi. Qayta urinish BU YERDA yo'q — `llm/chain.ts` boshqaradi
 * (zanjirning har a'zosi o'z byudjetiga ega, 429/5xx qayta uriladi).
 */
import { runLlmRaw } from "../llm";
import type { AdapterOpts, Attempt, ProviderAdapter } from "./types";

export type GeminiDeps = { fetchImpl?: typeof fetch };

export function makeGeminiAdapter(deps: GeminiDeps = {}): ProviderAdapter {
  return {
    id: "gemini",
    async complete(model, system, user, opts: AdapterOpts): Promise<Attempt> {
      const res = await runLlmRaw("gemini", model, system, user, opts.maxTokens, {
        json: opts.json,
        timeoutMs: opts.timeoutMs,
        thinking: opts.thinking,
        fetchImpl: deps.fetchImpl,
      });
      if (res.ok) return { ok: true, text: res.text, usage: res.usage };
      return { ok: false, error: res.error, retryable: res.retryable, status: res.status, retryAfterMs: res.retryAfterMs };
    },
  };
}

export const geminiAdapter = makeGeminiAdapter();
