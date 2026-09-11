/**
 * Zaxira zanjiri (Maqola 2 / AUDIT-17, WP8).
 *
 * `LLM_<ROL>=provider:model,provider:model,…` ro'yxatini birma-bir
 * sinaydi. Har spec ICHIDA ≤3 urinish: retryable xato (429/5xx/tarmoq)
 * — eksponensial kutish (500 ms × 2ⁿ), provayder `Retry-After` bersa
 * O'SHA ustunlik qiladi. `retryable:false` (400, refusal, Anthropic
 * oylik sarf chegarasi) — DARHOL keyingi specga, qayta urinmasdan.
 * TIMEOUT (abort) — keyingi specga O'TILMAYDI: byudjet (worker/so'rov
 * muddati) allaqachon sarflangan, yana bir provayderga urinish
 * foydalanuvchini yana shuncha kutdirardi — butun zanjir `null` bilan
 * to'xtaydi. Kaliti yo'q provayder (`process.env.<X>_API_KEY` bo'sh)
 * adapter chaqirilmasdan o'tkazib yuboriladi — bu XATO emas, oddiy
 * konfiguratsiya holati (jurnalga yoziladi).
 */
import type { Attempt, ProviderAdapter, ProviderId, RoleSpec } from "./types";

export type ChainOpts = { json?: boolean; maxTokens: number; timeoutMs: number; thinking?: number };

export type ChainUsage = { provider: ProviderId; model: string; inputTokens: number; outputTokens: number };

export type ChainResult = { text: string; usage: ChainUsage };

export type ChainDeps = {
  adapters: Partial<Record<ProviderId, ProviderAdapter>>;
  /** `[llm:<role>] provider:model → ok/xato (status) N ms` — standart `console.log`. */
  log?: (line: string) => void;
};

const KEY_ENV: Record<ProviderId, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
  openai: "OPENAI_API_KEY",
};

const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Xabar matnidan timeout/abort ni taniydi — Gemini/xAI/OpenRouter/OpenAI
 * fetch yo'lida "aborted" (`AbortController`), Anthropic SDKda "timed
 * out"/"aborted" (`APIConnectionTimeoutError`/`APIUserAbortError`).
 */
function isTimeoutSignal(error: string): boolean {
  return /abort|timed?\s?out/i.test(error);
}

async function runSpec(
  role: string,
  spec: RoleSpec,
  adapter: ProviderAdapter,
  system: string,
  user: string,
  opts: ChainOpts,
  log: (line: string) => void,
): Promise<ChainResult | null | "timeout"> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    const res: Attempt = await adapter.complete(spec.model, system, user, {
      json: opts.json,
      maxTokens: opts.maxTokens,
      timeoutMs: opts.timeoutMs,
      thinking: opts.thinking,
    });
    const ms = Date.now() - started;
    if (res.ok) {
      log(`[llm:${role}] ${spec.provider}:${spec.model} → ok ${ms} ms`);
      return {
        text: res.text,
        usage: {
          provider: spec.provider,
          model: spec.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
        },
      };
    }
    log(`[llm:${role}] ${spec.provider}:${spec.model} → xato (${res.status ?? "-"}) ${ms} ms: ${res.error}`);
    if (isTimeoutSignal(res.error)) return "timeout";
    if (!res.retryable) return null;
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(res.retryAfterMs ?? 500 * 2 ** attempt);
    }
  }
  return null;
}

export async function completeWithChain(
  role: string,
  specs: RoleSpec[],
  system: string,
  user: string,
  opts: ChainOpts,
  deps: ChainDeps,
): Promise<ChainResult | null> {
  const log = deps.log ?? (() => {});
  for (const spec of specs) {
    if (!process.env[KEY_ENV[spec.provider]]?.trim()) {
      log(`[llm:${role}] ${spec.provider}:${spec.model} → kalit yo'q, o'tkazib yuborildi`);
      continue;
    }
    const adapter = deps.adapters[spec.provider];
    if (!adapter) {
      log(`[llm:${role}] ${spec.provider}:${spec.model} → adapter ro'yxatda yo'q, o'tkazib yuborildi`);
      continue;
    }
    const result = await runSpec(role, spec, adapter, system, user, opts, log);
    if (result === "timeout") return null;
    if (result) return result;
  }
  return null;
}
