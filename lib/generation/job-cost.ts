/**
 * ISH SARFI hisoblagichi (audit EXT-11) — `generations.cost_json` ning
 * yagona manbai.
 *
 * Muammo: `cost_json` faqat o'z `CostMeter`i bor dvigatellarda (maqola,
 * kurs ishi, insho, o'qituvchi, o'yin, infografika, audio) to'lardi. Eng
 * qimmat yo'llar — pro-slayd (≈21 Gemini rasm + deka matni + grounding),
 * rasm vositasi, tarjima, rezyume va eski `llm.ts` yozuvchilari — hech
 * narsa yozmasdi va `scripts/cost-report.mts` ularning marjasini NOL
 * tannarx bilan hisoblardi.
 *
 * Yechim: sarf MANBADA yoziladi — LLM chaqiruvi (`llm-roles complete`,
 * `llm.ts` Gemini/xAI), rasm (`image-provider-gemini`), grounding
 * (`llmGrounded`), TTS (`tts/chain`) — ish KONTEKSTIDAGI hisoblagichga.
 * Kontekstni `buildArtifact` (`withJobCost`) ochadi; undan tashqaridagi
 * chaqiruv (so'rov yo'li: sayqal/qayta yozish/UDK, testlar) hech narsa
 * yozmaydi. Faqat TELEMETRIYA: narx/kredit bilan aloqasi yo'q.
 *
 * Kontekst `AsyncLocalStorage` da (faqat Node runtime — `lib/generation`
 * klientga chiqmaydi): parallel `mapPool` yo'laklari, taymerlar va
 * dinamik importlar ham o'sha ishning hisoblagichini ko'radi, ikki ish
 * bir jarayonda birga yursa ham sarflar aralashmaydi.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { costUsd, type UsageLike } from "./llm-pricing";
import type { CostJson, CostPart } from "./types";

/**
 * Grounding (Google qidiruvi) — bitta QIDIRUV narxi, USD (Gemini 3 qidiruv bo'yicha to'laydi).
 * Oyiga 5 000 tasi bepul, keyin $14/1 000 (`slide-research.ts`); bepul
 * kvota butun hisob bo'yicha, ish bo'yicha emas — telemetriya ehtiyotkor
 * (yuqori) chegarani yozadi.
 */
export const GROUNDING_USD = 0.014;

/**
 * Gemini rasm modeli → bitta rasm narxi (USD, 1K). Model nomi PREFIKS
 * bo'yicha (eng uzuni); jadvalda yo'q model — standart lite narxi va
 * jurnal ogohlantirishi (`.env.example`: lite $0.034, flash $0.067).
 */
export const IMAGE_PRICES: Record<string, number> = {
  "gemini-3.1-flash-lite-image": 0.034,
  "gemini-3.1-flash-image": 0.067,
};
const IMAGE_DEFAULT_USD = 0.034;

export function imageUnitUsd(model: string): number {
  const hit = Object.keys(IMAGE_PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (hit) return IMAGE_PRICES[hit];
  console.warn(`[job-cost] noma'lum rasm modeli: ${model} — ${IMAGE_DEFAULT_USD} USD deb hisoblanadi`);
  return IMAGE_DEFAULT_USD;
}

type Key = `${CostPart["kind"]}|${string}|${string}`;

/** Bitta ishning barcha sarfi — tur × provayder × model bo'yicha yig'indi. */
export class JobCost {
  private parts = new Map<Key, CostPart>();

  private part(kind: CostPart["kind"], provider: string, model: string): CostPart {
    const key: Key = `${kind}|${provider}|${model}`;
    let p = this.parts.get(key);
    if (!p) {
      p = { kind, provider, model, calls: 0, inputTokens: 0, outputTokens: 0, units: 0, usd: 0 };
      this.parts.set(key, p);
    }
    return p;
  }

  addLlm(u: UsageLike): void {
    const p = this.part("llm", u.provider, u.model);
    p.calls += 1;
    p.inputTokens += Math.max(0, u.inputTokens || 0);
    p.outputTokens += Math.max(0, u.outputTokens || 0);
    p.usd += costUsd(u, new Date());
  }

  /** Muvaffaqiyatli (pullik) rasm. `units` — rasm soni. */
  addImage(provider: string, model: string, count = 1, unitUsd = imageUnitUsd(model)): void {
    const p = this.part("image", provider, model);
    p.calls += count;
    p.units += count;
    p.usd += count * unitUsd;
  }

  /**
   * Qidiruv bilan javob bergan grounding so'rovi. `queries` — model bajargan
   * qidiruvlar soni: Gemini 3 da grounding QIDIRUV bo'yicha to'lanadi
   * (review N6), so'rov bo'yicha emas — kamida 1.
   */
  addGrounding(queries = 1, provider = "gemini", model = "google_search"): void {
    const n = Math.max(1, Math.floor(queries) || 0);
    const p = this.part("grounding", provider, model);
    p.calls += 1;
    p.units += n;
    p.usd += n * GROUNDING_USD;
  }

  /** TTS parchasi. `units` — belgilar (token EMAS — `TtsMeter` izohi). */
  addTts(provider: string, voice: string, chars: number, usd: number): void {
    const p = this.part("tts", provider, voice);
    p.calls += 1;
    p.units += Math.max(0, Math.round(chars));
    p.usd += Math.max(0, usd);
  }

  get calls(): number {
    let n = 0;
    for (const p of this.parts.values()) n += p.calls;
    return n;
  }

  /**
   * `CostJson` — `CostMeter.toJson` bilan mos ustunlar (`cost-report`
   * `usd` ni o'qiydi) + `parts` (xizmat bo'yicha tafsilot, admin panel
   * uchun). `provider`/`model` — chiqish tokeni eng ko'p LLM juftligi;
   * LLM umuman bo'lmasa (masalan faqat rasm) — eng qimmat bo'lak.
   */
  toJson(): CostJson {
    const parts = [...this.parts.values()].map((p) => ({ ...p, usd: Number(p.usd.toFixed(6)) }));
    const llm = parts.filter((p) => p.kind === "llm");
    // Teng bo'lsa BIRINCHI uchragani (Map tartibi — qo'shilish tartibi), `CostMeter` bilan bir xil.
    const pick = (list: CostPart[], by: (p: CostPart) => number) => list.reduce<CostPart | undefined>((best, p) => (!best || by(p) > by(best) ? p : best), undefined);
    const top = pick(llm, (p) => p.outputTokens) ?? pick(parts, (p) => p.usd);
    return {
      provider: top?.provider ?? "none",
      model: top?.model ?? "",
      inputTokens: llm.reduce((a, p) => a + p.inputTokens, 0),
      outputTokens: llm.reduce((a, p) => a + p.outputTokens, 0),
      calls: parts.reduce((a, p) => a + p.calls, 0),
      usd: Number(parts.reduce((a, p) => a + p.usd, 0).toFixed(6)),
      parts,
    };
  }
}

const store = new AsyncLocalStorage<JobCost>();

/** `fn` ichidagi barcha sarf yangi hisoblagichga yoziladi. */
export async function withJobCost<T>(fn: () => Promise<T>): Promise<{ value: T; cost: JobCost }> {
  const cost = new JobCost();
  const value = await store.run(cost, fn);
  return { value, cost };
}

/** Joriy ish hisoblagichi (ish kontekstidan tashqarida — `undefined`). */
export function currentJobCost(): JobCost | undefined {
  return store.getStore();
}

export function recordLlmUsage(u: UsageLike | undefined): void {
  if (u) store.getStore()?.addLlm(u);
}

export function recordImage(provider: string, model: string, count = 1): void {
  store.getStore()?.addImage(provider, model, count);
}

export function recordGrounding(queries = 1): void {
  store.getStore()?.addGrounding(queries);
}

export function recordTts(provider: string, voice: string, chars: number, usd: number): void {
  store.getStore()?.addTts(provider, voice, chars, usd);
}
