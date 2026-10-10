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
 * Admin cost capture (docs/admin/02-plan.md §17.3): the worker wraps the build
 * in `trackJobCost` so the spend of failed and abandoned jobs is not lost, and
 * `withFreeLlm` (lib/server/spend.ts) tracks the free endpoints the same way;
 * both flush into `ai_usage`.
 *
 * Kontekst `AsyncLocalStorage` da (faqat Node runtime — `lib/generation`
 * klientga chiqmaydi): parallel `mapPool` yo'laklari, taymerlar va
 * dinamik importlar ham o'sha ishning hisoblagichini ko'radi, ikki ish
 * bir jarayonda birga yursa ham sarflar aralashmaydi.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { FAL_USD_PER_MEGAPIXEL, GROUNDING_USD, IMAGE_PRICES, costUsd, falImageUnitUsd, imagePriceOf, imageUnitUsd, type UsageLike } from "./llm-pricing";
import type { CostJson, CostPart } from "./types";

/*
 * Every price lives in `llm-pricing.ts` (the price book); these re-exports keep the
 * historical import path working.
 */
export { FAL_USD_PER_MEGAPIXEL, GROUNDING_USD, IMAGE_PRICES, falImageUnitUsd, imageUnitUsd };

type Key = `${CostPart["kind"]}|${string}|${string}`;

/** A part; `priced: false` / `estimated` are the optional markers of `CostPart`. */
type MeterPart = CostPart;

/** Bitta ishning barcha sarfi — tur × provayder × model bo'yicha yig'indi. */
export class JobCost {
  private parts = new Map<Key, MeterPart>();

  private part(kind: CostPart["kind"], provider: string, model: string): MeterPart {
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

  /**
   * Muvaffaqiyatli (pullik) rasm. `units` — rasm soni. Without an explicit
   * `unitUsd` the price comes from the price book; a model missing there gets the
   * lite default and the part is marked `estimated` (never a silent guess).
   */
  addImage(provider: string, model: string, count = 1, unitUsd?: number): void {
    const p = this.part("image", provider, model);
    p.calls += count;
    p.units += count;
    if (unitUsd === undefined && imagePriceOf(model) === null) p.estimated = true;
    p.usd += count * (unitUsd ?? imageUnitUsd(model));
  }

  /** An image from a model without a documented price: counted, usd 0, `priced: false`. */
  addUnpricedImage(provider: string, model: string, count = 1): void {
    const p = this.part("image", provider, model);
    p.calls += count;
    p.units += count;
    p.priced = false;
  }

  /** Adds every part of `other` into this meter (used to merge nested meters). */
  absorb(other: JobCost): void {
    for (const o of other.parts.values()) {
      const p = this.part(o.kind, o.provider, o.model);
      p.calls += o.calls;
      p.inputTokens += o.inputTokens;
      p.outputTokens += o.outputTokens;
      p.units += o.units;
      p.usd += o.usd;
      if (o.priced === false) p.priced = false;
      if (o.estimated) p.estimated = true;
      if (o.textTokens !== undefined) p.textTokens = (p.textTokens ?? 0) + o.textTokens;
      if (o.audioTokens !== undefined) p.audioTokens = (p.audioTokens ?? 0) + o.audioTokens;
    }
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

  /**
   * TTS parchasi. `units` — belgilar (display only); the money is `usd`, computed by
   * `ttsCost` from the price book. `model` is the provider's model id (Gemini) or
   * `provider:voice` for per-character providers. `extra.priced === false` marks a
   * synthesis the book could not price (usd 0); `estimated` and the token counts
   * (`textTokens` = prompt, `audioTokens` = audio output) come from Gemini usage.
   */
  addTts(provider: string, model: string, chars: number, usd: number, extra: { priced?: boolean; estimated?: boolean; textTokens?: number; audioTokens?: number } = {}): void {
    const p = this.part("tts", provider, model);
    p.calls += 1;
    p.units += Math.max(0, Math.round(chars));
    p.usd += Math.max(0, usd);
    if (extra.priced === false) p.priced = false;
    if (extra.estimated) p.estimated = true;
    if (extra.textTokens) p.textTokens = (p.textTokens ?? 0) + Math.round(extra.textTokens);
    if (extra.audioTokens) p.audioTokens = (p.audioTokens ?? 0) + Math.round(extra.audioTokens);
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

/** Meters opened inside one `trackJobCost` call (its own first). */
type Tracker = { meters: JobCost[] };
const trackers = new AsyncLocalStorage<Tracker>();

/** `fn` ichidagi barcha sarf yangi hisoblagichga yoziladi. */
export async function withJobCost<T>(fn: () => Promise<T>): Promise<{ value: T; cost: JobCost }> {
  const cost = new JobCost();
  // Also visible to an enclosing `trackJobCost`, which can read it even when
  // `fn` throws (the value below is then never returned).
  trackers.getStore()?.meters.push(cost);
  const value = await store.run(cost, fn);
  return { value, cost };
}

export type TrackedJobCost<T> = {
  /** Settles exactly like `fn()`. */
  promise: Promise<T>;
  /**
   * Everything spent inside `fn` so far: its own meter plus every meter a
   * nested `withJobCost` opened (they are disjoint, so the sum is exact). Valid
   * at any time — after success, after a throw, or while an abandoned build is
   * still running.
   */
  snapshot(): JobCost;
};

/**
 * Runs `fn` with spend tracking that survives failure (admin `ai_usage`,
 * docs/admin/02-plan.md §17.3). `buildArtifact` keeps its own `withJobCost`
 * and its success result (`file.cost`) is unchanged; this only lets the caller
 * also see the spend of a build that threw or was abandoned. Calls made inside
 * `fn` but outside any nested `withJobCost` go to the tracker's own meter.
 */
export function trackJobCost<T>(fn: () => Promise<T>): TrackedJobCost<T> {
  const own = new JobCost();
  const tracker: Tracker = { meters: [own] };
  let promise: Promise<T>;
  try {
    promise = trackers.run(tracker, () => store.run(own, fn));
  } catch (e) {
    // A synchronous throw settles the same way an async one would.
    promise = Promise.reject(e);
  }
  return {
    promise,
    snapshot() {
      const all = new JobCost();
      for (const m of tracker.meters) all.absorb(m);
      return all;
    },
  };
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

/** One successful fal.ai image (priced per megapixel when the model's price is documented). */
export function recordFalImage(model: string, width: number, height: number): void {
  const meter = store.getStore();
  if (!meter) return;
  const unitUsd = falImageUnitUsd(model, width, height);
  if (unitUsd === null) meter.addUnpricedImage("fal", model);
  else meter.addImage("fal", model, 1, unitUsd);
}

export function recordGrounding(queries = 1): void {
  store.getStore()?.addGrounding(queries);
}

export function recordTts(provider: string, model: string, chars: number, usd: number, extra?: Parameters<JobCost["addTts"]>[4]): void {
  store.getStore()?.addTts(provider, model, chars, usd, extra);
}
