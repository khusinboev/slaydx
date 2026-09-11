/**
 * LLM adapter umumiy tili (Maqola 2 / AUDIT-17, WP8).
 *
 * Har provayder (`gemini.ts`, `anthropic.ts`, `openrouter.ts`, `xai.ts`,
 * `openai.ts`) shu tipga qarab yoziladi — `chain.ts` va `llm-roles.ts`
 * provayderga xos hech narsani BILMAYDI: JSON rejimi, thinking, xatolar
 * hammasi `Attempt` shakliga normallashtirilgan bo'lib keladi.
 */

/** `LLM_<ROL>` env qiymatidagi bitta yozuv: `"anthropic:claude-sonnet-5"`. */
export type ProviderId = "gemini" | "anthropic" | "openrouter" | "xai" | "openai";

const PROVIDER_IDS: readonly ProviderId[] = ["gemini", "anthropic", "openrouter", "xai", "openai"];

export type AdapterOpts = {
  json?: boolean;
  maxTokens: number;
  timeoutMs: number;
  /** Faqat Gemini o'qiydi (fixed byudjet, token). Boshqa adapterlar e'tiborsiz qoldiradi. */
  thinking?: number;
};

export type Usage = { inputTokens: number; outputTokens: number };

/**
 * Bitta urinish natijasi.
 *
 * `retryable` — `chain.ts` shu maydonga qarab qaror qiladi: true bo'lsa
 * eksponensial orqada eksponensial kutib qayta uradi (429/5xx/tarmoq),
 * false bo'lsa DARHOL keyingi zanjir a'zosiga o'tadi (400, refusal,
 * Anthropic oylik sarf chegarasi). `retryAfterMs` — provayder `Retry-After`
 * sarlavhasini yuborsa, eksponensial kutish o'rniga shu qiymat ishlatiladi
 * (fixed maydonlar ro'yxatidan tashqari, lekin ixtiyoriy — yo'q bo'lsa
 * chain o'zi eksponensial hisoblaydi).
 */
export type Attempt =
  | { ok: true; text: string; usage: Usage }
  | { ok: false; error: string; retryable: boolean; status?: number; retryAfterMs?: number };

export type ProviderAdapter = {
  id: ProviderId;
  complete(model: string, system: string, user: string, opts: AdapterOpts): Promise<Attempt>;
};

export type RoleSpec = { provider: ProviderId; model: string };

/**
 * `"anthropic:claude-sonnet-5,gemini:gemini-3.7-flash"` → zaxira zanjiri
 * tartibda. Bo'sh (`undefined`/`""`) yoki NOTO'G'RI (bo'sh model, provayder
 * ro'yxatda yo'q, `:` yo'q yozuv) — BUTUN natija `[]`: chaqiruvchi
 * (`llm-roles.ts`) buni "env berilmagan" bilan bir xil ko'radi va eski
 * standart yo'lga (Gemini) tushadi — yarim buzuq zanjir bilan jimgina
 * ishlashdan ko'ra shov-shuvsiz standart xatti-harakat xavfsizroq.
 */
export function parseRoleSpec(spec: string | undefined | null): RoleSpec[] {
  if (!spec || !spec.trim()) return [];
  const out: RoleSpec[] = [];
  for (const raw of spec.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const i = part.indexOf(":");
    if (i <= 0) return [];
    const provider = part.slice(0, i).trim();
    const model = part.slice(i + 1).trim();
    if (!model || !PROVIDER_IDS.includes(provider as ProviderId)) return [];
    out.push({ provider: provider as ProviderId, model });
  }
  return out;
}
