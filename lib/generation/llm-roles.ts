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
 * keyin ham yiqilsa — keyingisi). Har provayder `llm/{gemini,anthropic}.ts`
 * adapteri orqali chaqiriladi.
 *
 * ENV BERILMAGAN holat — bu BOSHQA VOSITALARGA (slayd, kurs ishi,
 * tarjimon) TA'SIR QILMASLIGI kerak bo'lgan chegara: ular `llm.ts`
 * `llmComplete`/`llmGrounded`ni TO'G'RIDAN-TO'G'RI chaqiradi va WP8 ULARGA
 * UMUMAN TEGMAGAN. `complete(role, …)` o'zi ham env yo'q bo'lsa xuddi
 * o'sha standart provayderga (`llmProvider()` — Gemini kaliti
 * bo'lsa Gemini) BITTA spec bilan tushadi — natijada xatti-harakat
 * "hozirgidek" (Gemini standart), faqat endi `usage` HAM qaytadi (buni
 * eski `llmComplete` bermas edi — token sonini bilmasdi).
 */
import { llmProvider, type LlmOpts } from "./llm";
import { effectiveRoute } from "../server/providers/route-effective";
import { completeWithChain, type ChainResult, type ChainUsage } from "./llm/chain";
import { withJsonRetry } from "./llm/failure";
export { DeadlineError } from "./llm/chain";
import { anthropicAdapter } from "./llm/anthropic";
import { geminiAdapter } from "./llm/gemini";
import type { ProviderAdapter, ProviderId, RoleSpec } from "./llm/types";
import { costUsd } from "./llm-pricing";
import { recordLlmUsage } from "./job-cost";

export type LlmRole = "writer" | "researcher" | "judge" | "fast";

export type LlmUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Earlier PAID attempts of the same call (a JSON-quality retry): `CostMeter.add`
   * counts them too, so retried spend is never lost. Engines pass `usage` through
   * untouched, so nothing else has to know.
   */
  prior?: LlmUsage[];
};

export type RoleResult = { text: string; usage?: LlmUsage };

export type RoleOpts = Pick<LlmOpts, "json" | "timeoutMs" | "thinking"> & {
  maxTokens?: number;
  /**
   * Ish muddati (epoch ms, audit C28/W3 shartnomasi). Berilsa har urinish
   * timeout'i qolgan vaqt bilan cheklanadi, sekin provayderdan keyin zaxira
   * specga o'tiladi va vaqt tugasa `DeadlineError` (`llm/chain.ts`) OTILADI —
   * chaqiruvchi uni ushlashi kerak. Berilmasa — eski xatti-harakat.
   */
  deadline?: number;
  /** Optional improvement call: a timeout is not retried even when the job deadline would allow it. */
  noTimeoutRetry?: boolean;
};

const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
};

/**
 * The provider:model chain of `role`, first = preferred, the rest = fallbacks. Precedence (admin «Provayderlar»):
 * the admin's stored choice, else the `LLM_<ROL>` environment variable (how it ran before the page existed), else the
 * current default provider (`llm.ts llmProvider()`: Gemini when its key resolves) with the default text model.
 * No key at all gives `[]`, so `complete()` returns `null` exactly like the old `llmComplete` did without a key.
 * `route-effective.ts` is the ONE place that decides this; the admin page shows the same result.
 */
export function roleSpecs(role: LlmRole): RoleSpec[] {
  const eff = effectiveRoute(`llm.${role}`);
  if (eff.source === "default" && !llmProvider()) return [];
  // A slot entry whose provider has no adapter (a provider that was removed) is dropped instead of failing the call.
  return eff.entries.flatMap((e) => (e.model && ADAPTERS[e.provider as ProviderId] ? [{ provider: e.provider as ProviderId, model: e.model }] : []));
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
  const specs = roleSpecs(role);
  if (specs.length === 0) return null;

  const deps = { adapters: ADAPTERS, log: (line: string) => console.log(line) };
  // Every attempt that returns text is paid: record it in the job meter right away.
  const once = async (o: { system: string; maxTokens: number }): Promise<ChainResult | null> => {
    const r = await completeWithChain(role, specs, o.system, user, { ...rest, maxTokens: o.maxTokens, timeoutMs }, deps);
    // Ish sarfi (EXT-11): `buildArtifact` konteksti bo'lsa `cost_json` ga — dvigatel o'z hisoblagichini yuritmasa ham.
    if (r) recordLlmUsage(r.usage);
    return r;
  };
  // JSON answers that are cut or unparseable get ONE stricter retry; the better answer wins and carries the other's usage.
  const res = await withJsonRetry(
    once,
    { system, maxTokens, json: rest.json, deadline: rest.deadline },
    { role, provider: (r) => r.usage.provider, model: (r) => r.usage.model, tokens: (r) => r.usage },
    (winner, other) => {
      const { provider, model, inputTokens, outputTokens } = other.usage;
      const usage: ChainUsage = {
        ...winner.usage,
        prior: [...(winner.usage.prior ?? []), ...(other.usage.prior ?? []), { provider, model, inputTokens, outputTokens }],
      };
      return { ...winner, usage };
    },
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
    if (!u) return;
    // Earlier paid attempts of the same call first (JSON-quality retry), then the answer's own usage.
    for (const p of u.prior ?? []) this.add(p);
    this.items.push({ provider: u.provider, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens });
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
