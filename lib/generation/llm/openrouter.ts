/**
 * OpenRouter adapteri (Maqola 2 / AUDIT-17, WP8) — universal zaxira.
 *
 * OpenAI-mos `chat/completions` (`https://openrouter.ai/api/v1/...`):
 * bitta kalit bilan GPT/DeepSeek/Qwen va h.k.ga yetadi. `HTTP-Referer`/
 * `X-Title` OpenRouter tavsiyasi — ranking/monitoring uchun, xatosiz ham
 * ishlaydi, lekin ular bo'lmasa OpenRouter konsolida so'rov "noma'lum
 * ilova" sifatida ko'rinadi.
 */
import type { AdapterOpts, Attempt, ProviderAdapter } from "./types";

export type OpenrouterDeps = { fetchImpl?: typeof fetch };

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function makeOpenrouterAdapter(deps: OpenrouterDeps = {}): ProviderAdapter {
  return {
    id: "openrouter",
    async complete(model, system, user, opts: AdapterOpts): Promise<Attempt> {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) return { ok: false, error: "OPENROUTER_API_KEY yo'q", retryable: false };
      const fetchImpl = deps.fetchImpl ?? fetch;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
      try {
        const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://slaydxx.uz",
            "X-Title": "SlaydX",
          },
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

export const openrouterAdapter = makeOpenrouterAdapter();
