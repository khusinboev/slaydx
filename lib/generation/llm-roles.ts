/**
 * LLM ROLLARI fasadi (Maqola 2, AUDIT-17).
 *
 * Maqola dvigateli modelni ROL bo'yicha chaqiradi — `writer` (uzun matn),
 * `researcher` (manba tanlash/sintez), `judge` (tayyorlik hisoboti
 * baholovchisi), `fast` (kichik JSON) — provayder/model nomi bilan emas.
 * Sabab: bitta provayderga bog'lanib qolmaslik va rolga qarab arzon/kuchli
 * modelni tanlash (yozuvchi Gemini 3.7 Flash, baholovchi Claude Sonnet 5).
 *
 * WP8 bu faylning ICHINI almashtiradi: `.env` `LLM_<ROL>=provider:model,…`
 * zanjiri, adapterlar (`llm/{gemini,anthropic,openrouter,xai}.ts`),
 * zaxiraga o'tish va `usage` telemetriyasi. Hozircha hammasi mavjud
 * `llmComplete` ga boradi — dvigatel (WP1) shu API ga qarshi yoziladi va
 * WP8 dan keyin o'zgarmaydi.
 */
import { llmComplete, llmModel, llmProvider, type LlmOpts } from "./llm";

export type LlmRole = "writer" | "researcher" | "judge" | "fast";

export type LlmUsage = { provider: string; model: string; inputTokens: number; outputTokens: number };

export type RoleResult = { text: string; usage?: LlmUsage };

export type RoleOpts = Pick<LlmOpts, "json" | "timeoutMs" | "thinking"> & { maxTokens?: number };

/**
 * Bitta chaqiruv. `null` — model javob bermadi (timeout/xato/bo'sh) —
 * chaqiruvchi o'zi qaror qiladi (retry, fallback matn, xato).
 */
export async function complete(role: LlmRole, system: string, user: string, opts: RoleOpts = {}): Promise<RoleResult | null> {
  const { maxTokens = 2048, ...rest } = opts;
  const text = await llmComplete(system, user, maxTokens, rest);
  if (!text) return null;
  return { text, usage: { provider: llmProvider() ?? "none", model: llmModel(), inputTokens: 0, outputTokens: 0 } };
}

/**
 * Sarf hisoblagichi — generatsiya davomida `usage` lar yig'iladi,
 * yakunda `generations.cost_json` ga tushadi (`worker.ts`). Narx jadvali
 * (`llm-pricing.ts`) WP8 da; hozir `usd` 0 qoladi.
 */
export class CostMeter {
  private items: LlmUsage[] = [];
  add(u?: LlmUsage) {
    if (u) this.items.push(u);
  }
  toJson() {
    const inputTokens = this.items.reduce((a, u) => a + u.inputTokens, 0);
    const outputTokens = this.items.reduce((a, u) => a + u.outputTokens, 0);
    const first = this.items[0];
    return { provider: first?.provider ?? "none", model: first?.model ?? "", inputTokens, outputTokens, calls: this.items.length, usd: 0 };
  }
}
