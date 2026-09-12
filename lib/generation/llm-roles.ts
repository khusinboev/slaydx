/**
 * LLM ROLLARI fasadi (Maqola 2, AUDIT-17).
 *
 * Maqola dvigateli modelni ROL bo'yicha chaqiradi — `writer` (uzun matn),
 * `researcher` (manba tanlash/sintez), `judge` (tayyorlik hisoboti
 * baholovchisi), `fast` (kichik JSON) — provayder/model nomi bilan emas.
 * Sabab: bitta provayderga bog'lanib qolmaslik va rolga qarab arzon/kuchli
 * modelni tanlash (yozuvchi Gemini 3.7 Flash, baholovchi Claude Sonnet 5).
 *
 * WP8: `.env` dagi `LLM_<ROL>=provider:model,provider:model,…` ro'yxati
 * `llm/chain.ts` orqali ZAXIRA ZANJIRIGA aylanadi (birinchisi 429/5xx dan
 * keyin ham yiqilsa — keyingisi). Har provayder `llm/{gemini,anthropic,
 * openrouter,xai,openai}.ts` adapteri orqali chaqiriladi.
 *
 * ENV BERILMAGAN holat — bu BOSHQA VOSITALARGA (slayd, kurs ishi,
 * tarjimon) TA'SIR QILMASLIGI kerak bo'lgan chegara: ular `llm.ts`
 * `llmComplete`/`llmGrounded`ni TO'G'RIDAN-TO'G'RI chaqiradi va WP8 ULARGA
 * UMUMAN TEGMAGAN. `complete(role, …)` o'zi ham env yo'q bo'lsa xuddi
 * o'sha standart provayderga (`llmProvider()` — Gemini bo'lsa Gemini,
 * bo'lmasa xAI) BITTA spec bilan tushadi — natijada xatti-harakat
 * "hozirgidek" (Gemini standart), faqat endi `usage` HAM qaytadi (buni
 * eski `llmComplete` bermas edi — token sonini bilmasdi).
 */
import { llmModel, llmProvider, type LlmOpts } from "./llm";
import { completeWithChain } from "./llm/chain";
import { anthropicAdapter } from "./llm/anthropic";
import { geminiAdapter } from "./llm/gemini";
import { openaiAdapter } from "./llm/openai";
import { openrouterAdapter } from "./llm/openrouter";
import { parseRoleSpec, type ProviderAdapter, type ProviderId, type RoleSpec } from "./llm/types";
import { xaiAdapter } from "./llm/xai";
import { costUsd } from "./llm-pricing";

export type LlmRole = "writer" | "researcher" | "judge" | "fast";

export type LlmUsage = { provider: string; model: string; inputTokens: number; outputTokens: number };

export type RoleResult = { text: string; usage?: LlmUsage };

export type RoleOpts = Pick<LlmOpts, "json" | "timeoutMs" | "thinking"> & { maxTokens?: number };

const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  openrouter: openrouterAdapter,
  xai: xaiAdapter,
  openai: openaiAdapter,
};

const ROLE_ENV: Record<LlmRole, string> = {
  writer: "LLM_WRITER",
  researcher: "LLM_RESEARCHER",
  judge: "LLM_JUDGE",
  fast: "LLM_FAST",
};

/**
 * `.env`da `LLM_<ROL>` bo'lmasa (yoki buzuq) — hozirgi standart provayder
 * (`llm.ts llmProvider()`, Gemini bo'lsa Gemini) bitta spec sifatida.
 * Kalit umuman yo'q bo'lsa `[]` — `complete()` `null` qaytaradi, aynan
 * eski `llmComplete` ham kalitsiz `null` qaytargani kabi.
 */
function defaultSpec(): RoleSpec[] {
  const provider = llmProvider();
  return provider ? [{ provider, model: llmModel() }] : [];
}

/**
 * Bitta chaqiruv. `null` — model javob bermadi (timeout/xato/bo'sh/
 * zanjir tugadi) — chaqiruvchi o'zi qaror qiladi (retry, fallback matn,
 * xato).
 */
export async function complete(
  role: LlmRole,
  system: string,
  user: string,
  opts: RoleOpts = {},
): Promise<RoleResult | null> {
  const { maxTokens = 2048, timeoutMs = 40_000, ...rest } = opts;
  const envSpecs = parseRoleSpec(process.env[ROLE_ENV[role]]);
  const specs = envSpecs.length > 0 ? envSpecs : defaultSpec();
  if (specs.length === 0) return null;

  const res = await completeWithChain(
    role,
    specs,
    system,
    user,
    { ...rest, maxTokens, timeoutMs },
    { adapters: ADAPTERS, log: (line) => console.log(line) },
  );
  if (!res) return null;
  return { text: res.text, usage: res.usage };
}

/**
 * Sarf hisoblagichi — generatsiya davomida `usage` lar yig'iladi,
 * yakunda `generations.cost_json` ga tushadi (`worker.ts`).
 *
 * `provider`/`model` — chiqish tokenlari YIG'INDISI eng katta juftlik
 * (jonli tezis: 9 Gemini chaqiruvi 3 000 token, bitta Claude baholovchi
 * 1 500 token — bitta chaqiruv bo'yicha tanlansa hisobot «anthropic» deb
 * ko'rsatardi, `cost-report` esa vositani noto'g'ri guruhlardi). `usd` —
 * `llm-pricing.ts costUsd` bo'yicha har chaqiruv YIG'INDISI (sana —
 * chaqiruv payti, `Date.now()`; narx jadvali kelajakda o'zgarsa ham
 * o'sha kunlik hisob-kitobga mos qoladi).
 */
export class CostMeter {
  private items: LlmUsage[] = [];

  add(u?: LlmUsage) {
    if (u) this.items.push(u);
  }

  toJson() {
    const inputTokens = this.items.reduce((a, u) => a + u.inputTokens, 0);
    const outputTokens = this.items.reduce((a, u) => a + u.outputTokens, 0);
    const usd = this.items.reduce((a, u) => a + costUsd(u, new Date()), 0);
    const sums = new Map<string, { u: LlmUsage; out: number }>();
    for (const u of this.items) {
      const key = `${u.provider}:${u.model}`;
      const cur = sums.get(key);
      if (cur) cur.out += u.outputTokens;
      else sums.set(key, { u, out: u.outputTokens });
    }
    // Teng bo'lsa BIRINCHI uchragan juftlik qoladi (Map tartibi — qo'shilish tartibi).
    let top: LlmUsage | undefined;
    let topOut = -1;
    for (const { u, out } of sums.values()) {
      if (out > topOut) {
        top = u;
        topOut = out;
      }
    }
    return {
      provider: top?.provider ?? "none",
      model: top?.model ?? "",
      inputTokens,
      outputTokens,
      calls: this.items.length,
      usd,
    };
  }
}
