/**
 * OpenAI adapteri (Maqola 2 / AUDIT-17, WP8).
 *
 * `openrouter.ts` bilan bir xil shakl (OpenAI-mos `chat/completions`),
 * lekin to'g'ridan-to'g'ri `api.openai.com`ga, `OPENAI_API_KEY` bilan.
 * Sprint qarori bo'yicha SOTIB OLINMAYDI (OpenRouter allaqachon GPT
 * modellariga yetadi) — adapter kelajak uchun tayyor, kalit bo'lmasa
 * `chain.ts` uni jimgina o'tkazib yuboradi.
 */
import type { AdapterOpts, Attempt, ProviderAdapter } from "./types";

export type OpenaiDeps = { fetchImpl?: typeof fetch };

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function makeOpenaiAdapter(deps: OpenaiDeps = {}): ProviderAdapter {
  return {
    id: "openai",
    async complete(model, system, user, opts: AdapterOpts): Promise<Attempt> {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { ok: false, error: "OPENAI_API_KEY yo'q", retryable: false };
      const fetchImpl = deps.fetchImpl ?? fetch;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            temperature: 0.4,
            max_tokens: opts.maxTokens,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        if (!res.ok) {
          return {
            ok: false,
            error: data.error?.message ?? `HTTP ${res.status}`,
            retryable: res.status === 429 || res.status >= 500,
            status: res.status,
            retryAfterMs: retryAfterMs(res.headers),
          };
        }
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) return { ok: false, error: "bo'sh javob", retryable: false };
        return {
          ok: true,
          text,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
          },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : "network error";
        return { ok: false, error: message, retryable: !/abort/i.test(message) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export const openaiAdapter = makeOpenaiAdapter();
