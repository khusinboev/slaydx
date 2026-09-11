/**
 * Anthropic adapteri (Maqola 2 / AUDIT-17, WP8) — tayyorlik hisoboti
 * baholovchisi (`judge`) va zaxira yozuvchi.
 *
 * `@anthropic-ai/sdk`: Claude 5 avlodi (shu jumladan `claude-sonnet-5`)
 * `thinking: {type:"enabled", budget_tokens:N}` ni RAD ETADI (400) —
 * FAQAT `{type:"adaptive"}` ishlatiladi. Prefill (oxirgi `assistant`
 * xabari bilan javobni cheklash) HAM yo'q — shu sabab JSON rejimi
 * SXEMASIZ: prompt ichiga «faqat JSON qaytar» ko'rsatmasi qo'shiladi,
 * javob esa chaqiruvchida (mavjud yo'l bilan bir xil, `lib/generation/
 * json.ts parseLlmObject`) tozalanadi — adapter faqat XOM matnni
 * qaytaradi.
 *
 * Xatolar — `.status`/`.message`/`.headers` maydonlariga qarab (DIQQAT:
 * `instanceof Anthropic.RateLimitError` ATAYLAB ISHLATILMAYDI — bu
 * loyihada `.ts` fayllar `tsx` orqali CommonJS sifatida, `.mts`
 * testlar ESM sifatida yuklanadi; `@anthropic-ai/sdk` ikkalasi uchun
 * ALOHIDA build beradi (`index.js`/`index.mjs`), shuning uchun
 * `instanceof` ikki modul chegarasida band-o'chirilgan bo'lib chiqadi —
 * jonli tasdiqlangan: sinov klassni `.mts`da qursa, adapter `.ts`dagi
 * `instanceof`i FALSE qaytaradi, garchi `e.constructor.name` to'g'ri
 * bo'lsa ham. `.status`/`.message` esa oddiy ma'lumot maydoni — modul
 * chegarasidan MUSTAQIL, shuning uchun ishonchli):
 *  - `status === 429` — ODATDA qayta urinishga arziydi, LEKIN xabarida
 *    `enforced_spend_limit_reached` bo'lsa (ORGANIZATSIYA OYLIK sarf
 *    chegarasi) — bu soniyalar ichida tiklanmaydi, shuning uchun
 *    `retryable:false` (keyingi zanjir a'zosiga darhol o'tiladi).
 *  - `status === undefined` — ulanish xatosi/timeout/abort (SDKda
 *    `APIConnectionError`/`APIConnectionTimeoutError`/`APIUserAbortError`
 *    hammasi `status`siz) — `retryable:true`; xabar "timed out"/"abort"
 *    bo'lsa `chain.ts` buni TIMEOUT deb tanib, BUTUN zanjirni to'xtatadi.
 *  - `status >= 500` — qayta uriladi; boshqa aniq status (4xx) — yo'q.
 *  - `stop_reason: "refusal"` — xavfsizlik rad etishi, qayta urinish
 *    foydasiz — `retryable:false`.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AdapterOpts, Attempt, ProviderAdapter } from "./types";

export type AnthropicDeps = {
  /** Testda haqiqiy SDK o'rniga stub — tarmoqqa chiqmasdan. */
  client?: Pick<Anthropic, "messages">;
};

const JSON_INSTRUCTION =
  "\n\nReturn ONLY a single valid JSON object as your entire response. No markdown code fences, no commentary before or after the JSON.";

function isSpendLimit(message: string): boolean {
  return /enforced_spend_limit_reached/i.test(message);
}

/** `Headers`ga o'xshasa (`.get` bor) — instanceof EMAS, duck-typing (yuqoridagi izohdagi sabab bilan bir xil ehtiyot). */
function retryAfterMs(headers: unknown): number | undefined {
  const get = (headers as { get?: (name: string) => string | null })?.get;
  const raw = typeof get === "function" ? get.call(headers, "retry-after") : null;
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function mapError(e: unknown): Attempt & { ok: false } {
  const err = e as { message?: unknown; status?: unknown; headers?: unknown };
  const message = typeof err?.message === "string" ? err.message : e instanceof Error ? e.message : "unknown error";
  const status = typeof err?.status === "number" ? err.status : undefined;

  if (status === undefined) {
    // Ulanish xatosi/timeout/abort (yoki Anthropic-emas kutilmagan xato) —
    // status yo'q. `chain.ts` xabar matnidan timeout'ni o'zi taniydi.
    return { ok: false, error: message, retryable: true };
  }
  if (status === 429) {
    return { ok: false, error: message, retryable: !isSpendLimit(message), status, retryAfterMs: retryAfterMs(err.headers) };
  }
  if (status >= 500) {
    return { ok: false, error: message, retryable: true, status, retryAfterMs: retryAfterMs(err.headers) };
  }
  return { ok: false, error: message, retryable: false, status };
}

export function makeAnthropicAdapter(deps: AnthropicDeps = {}): ProviderAdapter {
  return {
    id: "anthropic",
    async complete(model, system, user, opts: AdapterOpts): Promise<Attempt> {
      const client: Pick<Anthropic, "messages"> =
        deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: opts.timeoutMs });
      try {
        const res = await client.messages.create({
          model,
          max_tokens: opts.maxTokens,
          system: opts.json ? `${system}${JSON_INSTRUCTION}` : system,
          messages: [{ role: "user", content: user }],
          // DIQQAT: `budget_tokens` YO'Q — Claude 5 avlodida 400 qaytaradi.
          thinking: { type: "adaptive" },
        });
        if (res.stop_reason === "refusal") {
          return { ok: false, error: "refusal", retryable: false };
        }
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        if (!text) return { ok: false, error: "bo'sh javob", retryable: false };
        return {
          ok: true,
          text,
          usage: {
            inputTokens: res.usage.input_tokens ?? 0,
            outputTokens: res.usage.output_tokens ?? 0,
          },
        };
      } catch (e) {
        return mapError(e);
      }
    },
  };
}

export const anthropicAdapter = makeAnthropicAdapter();
