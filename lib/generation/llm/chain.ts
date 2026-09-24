/**
 * Zaxira zanjiri (Maqola 2 / AUDIT-17, WP8; muddat/breaker/limiter — audit C28).
 *
 * `LLM_<ROL>=provider:model,provider:model,…` ro'yxatini birma-bir
 * sinaydi. Har spec ICHIDA ≤3 urinish: retryable xato (429/5xx/tarmoq)
 * — to'liq jitter'li eksponensial kutish (`random · 500 ms · 2ⁿ`, tarmoq
 * xatosida 2 s asos), provayder `Retry-After` bersa O'SHA ustunlik
 * qiladi, lekin `RETRY_AFTER_CAP_MS` dan uzun bo'lsa shu provayder
 * qayta urinilmaydi (1 soatlik kvota kutishi o'rniga keyingi spec).
 * `retryable:false` (400, refusal, Anthropic oylik sarf chegarasi) —
 * DARHOL keyingi specga. Kaliti yo'q provayder o'tkazib yuboriladi.
 *
 * MUDDAT (`opts.deadline`, epoch ms — ish muddati, W3 shartnomasi):
 *  - har urinish timeout'i = `min(timeoutMs, deadline - now - CHAIN_SAFETY_MS)`;
 *  - qolgan vaqt `CHAIN_MIN_ATTEMPT_MS` dan kam bo'lsa yangi urinish,
 *    qayta urinish yoki zaxira spec BOSHLANMAYDI va natija bo'lmasa
 *    `DeadlineError` otiladi (chaqiruvchi «vaqt tugadi»ni «model javob
 *    bermadi» dan ajrata olsin);
 *  - TIMEOUT (sekin provayder) — shu provayder qayta urinilmaydi, vaqt
 *    qolgan bo'lsa KEYINGI specga o'tiladi.
 * Muddat BERILMASA — eski xatti-harakat: timeout sozlangandek, timeout
 * butun zanjirni to'xtatadi (`null`), chunki chaqiruvchi byudjeti
 * noma'lum va yana bir provayderga urinish uni oshirib yuborishi mumkin.
 *
 * SAQLAGICH (`breaker.ts`): provayder bo'yicha; to'liq (≥ 15 s) timeout
 * yoki 5xx/tarmoq xatosi — nosozlik, javob (ok/4xx) — salomatlik. Ochiq
 * provayder o'tkazib yuboriladi — sekin Gemini'ni har chaqiruv qaytadan
 * «kashf» qilmaydi, zaxira spec darhol ishlaydi.
 *
 * CHEKLAGICH (`limiter.ts`): provayder bo'yicha bir vaqtdagi so'rovlar
 * soni; navbatda kutilgan vaqt urinish timeout'idan ayriladi.
 */
import { LLM_BREAKER, breakerFor, type CircuitBreaker } from "./breaker";
import { limiterFor, type Semaphore } from "./limiter";
import { backoffMs, equalJitterMs } from "./retry";
import type { Attempt, ProviderAdapter, ProviderId, RoleSpec } from "./types";

export type ChainOpts = {
  json?: boolean;
  maxTokens: number;
  timeoutMs: number;
  thinking?: number;
  /** Ish muddati (epoch ms). Berilmasa — eski xatti-harakat. */
  deadline?: number;
};

export type ChainUsage = { provider: ProviderId; model: string; inputTokens: number; outputTokens: number };

export type ChainResult = { text: string; usage: ChainUsage };

export type ChainDeps = {
  adapters: Partial<Record<ProviderId, ProviderAdapter>>;
  /** `[llm:<role>] provider:model → ok/xato (status) N ms` — standart `console.log`. */
  log?: (line: string) => void;
  /** Test seam'lari — standart: jarayon bo'yicha umumiy saqlagich/cheklagich. */
  breakerFor?: (provider: ProviderId) => CircuitBreaker;
  limiterFor?: (provider: ProviderId) => Semaphore;
  /** Jitter manbai (test: `() => 0`). */
  random?: () => number;
};

/** Muddatdan oldin qoldiriladigan zaxira (javobni qayta ishlash, yozish). */
export const CHAIN_SAFETY_MS = 1_000;
/** Bundan kam vaqtda yangi urinish boshlanmaydi. */
export const CHAIN_MIN_ATTEMPT_MS = 5_000;
/** `Retry-After` shundan uzun bo'lsa shu provayder qayta urinilmaydi. */
export const RETRY_AFTER_CAP_MS = 30_000;
/** Shundan qisqa timeout (byudjet tugashi tufayli) saqlagichga nosozlik deb yozilmaydi. */
export const BREAKER_TIMEOUT_FLOOR_MS = 15_000;

/** Zanjir muddat tufayli to'xtadi (natija yo'q, vaqt tugadi). */
export class DeadlineError extends Error {
  readonly role: string;
  constructor(role: string, leftMs: number) {
    super(`[llm:${role}] muddat tugadi (${Math.max(0, Math.round(leftMs))} ms qoldi) — yangi urinish boshlanmadi`);
    this.name = "DeadlineError";
    this.role = role;
  }
}

const KEY_ENV: Record<ProviderId, string> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
  openai: "OPENAI_API_KEY",
};

const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * Xabar matnidan timeout/abort ni taniydi — Gemini/xAI/OpenRouter/OpenAI
 * fetch yo'lida "aborted" (`AbortController`), Anthropic SDKda "timed
 * out"/"aborted" (`APIConnectionTimeoutError`/`APIUserAbortError`).
 */
function isTimeoutSignal(error: string): boolean {
  // `\b` — `ETIMEDOUT`/`UND_ERR_CONNECT_TIMEOUT` (ulanish uzilishi) timeout
  // EMAS: ular tarmoq xatosi, byudjet ichida qayta uriladi (review R2).
  return /abort|\btimed?\s?out\b/i.test(error);
}

/** Ochiq saqlagich uchun eng uzun muddat — soxta ulkan `Retry-After` provayderni abadiy o'chirmasin. */
const BREAKER_TRIP_MAX_MS = 10 * 60_000;

type Ctx = {
  role: string;
  opts: ChainOpts;
  log: (line: string) => void;
  breaker: CircuitBreaker;
  limiter: Semaphore;
  random: () => number;
};

/** Muddatgacha ishlatsa bo'ladigan vaqt; muddatsiz — cheksiz. */
function leftMs(opts: ChainOpts): number {
  return opts.deadline === undefined ? Number.POSITIVE_INFINITY : opts.deadline - CHAIN_SAFETY_MS - Date.now();
}

async function runSpec(
  spec: RoleSpec,
  adapter: ProviderAdapter,
  system: string,
  user: string,
  ctx: Ctx,
): Promise<ChainResult | null | "timeout" | "deadline"> {
  const { role, opts, log, breaker, limiter } = ctx;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const left = leftMs(opts);
    if (left < CHAIN_MIN_ATTEMPT_MS) return "deadline";
    if (attempt > 0 && !breaker.allow()) {
      log(`[llm:${role}] ${spec.provider}:${spec.model} → saqlagich ochildi, keyingi specga`);
      return null;
    }
    const budget = Math.min(opts.timeoutMs, left);
    const queued = limiter.active >= limiter.max ? Date.now() : 0;
    const release = await limiter.acquire(budget);
    if (!release) {
      log(`[llm:${role}] ${spec.provider}:${spec.model} → navbatda vaqt tugadi (${budget} ms)`);
      return "timeout";
    }
    // Navbatda kutilgan vaqt ayriladi; bo'sh slotda timeout aynan sozlangandek.
    const timeoutMs = queued ? Math.max(1, budget - (Date.now() - queued)) : budget;
    const started = Date.now();
    let res: Attempt;
    try {
      res = await adapter.complete(spec.model, system, user, {
        json: opts.json,
        maxTokens: opts.maxTokens,
        timeoutMs,
        thinking: opts.thinking,
      });
    } finally {
      release();
    }
    const ms = Date.now() - started;
    if (res.ok) {
      breaker.success();
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
    if (isTimeoutSignal(res.error)) {
      if (timeoutMs >= BREAKER_TIMEOUT_FLOOR_MS) breaker.failure();
      return "timeout";
    }
    /*
     * Saqlagich faqat TRANSPORT nosozligini sanaydi: tarmoq xatosi
     * (status yo'q + retryable) va 5xx. Bo'sh javob (xavfsizlik bloki,
     * `max_tokens`), refusal, 4xx — provayder SOG'; ularni sanash bitta
     * ishning muammoli promptlari tufayli Gemini'ni butun jarayon uchun
     * o'chirib qo'yardi (review R1). `llm.ts withRetry` bilan bir xil qoida.
     */
    if (res.status === undefined ? res.retryable : res.status >= 500) breaker.failure();
    else if (res.status !== undefined && res.status !== 429) breaker.success();
    // Kvota: sarf chegarasi (429, retryable:false) yoki uzun `Retry-After` —
    // provayder shu muddat javob bermaydi; har chaqiruvda qayta urmaslik uchun darhol ochamiz.
    if (res.status === 429 && (!res.retryable || (res.retryAfterMs ?? 0) > RETRY_AFTER_CAP_MS)) {
      breaker.trip(Math.min(BREAKER_TRIP_MAX_MS, res.retryAfterMs ?? LLM_BREAKER.cooldownMs), "429 kvota");
    }
    if (!res.retryable) return null;
    if (attempt === MAX_ATTEMPTS - 1) break;
    if (res.retryAfterMs !== undefined && res.retryAfterMs > RETRY_AFTER_CAP_MS) {
      log(`[llm:${role}] ${spec.provider}:${spec.model} → Retry-After ${res.retryAfterMs} ms juda uzun, keyingi specga`);
      return null;
    }
    // Tarmoq xatosi (status yo'q: ETIMEDOUT/ECONNRESET) — uzilish odatda bir
    // necha soniya: asos 2 s va TENG jitter (≥ yarmi kutiladi, AUDIT-19 smoke);
    // HTTP xatosida 500 ms asos, to'liq jitter.
    const wait = res.retryAfterMs ?? (res.status === undefined ? equalJitterMs(attempt, 2_000, ctx.random) : backoffMs(attempt, 500, ctx.random));
    if (leftMs(opts) - wait < CHAIN_MIN_ATTEMPT_MS) return "deadline";
    await sleep(wait);
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
  const getBreaker = deps.breakerFor ?? ((p: ProviderId) => breakerFor(p));
  const getLimiter = deps.limiterFor ?? ((p: ProviderId) => limiterFor(p));
  const random = deps.random ?? Math.random;
  let outOfTime = false;
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
    if (leftMs(opts) < CHAIN_MIN_ATTEMPT_MS) {
      outOfTime = true;
      break;
    }
    const breaker = getBreaker(spec.provider);
    if (!breaker.allow()) {
      log(`[llm:${role}] ${spec.provider}:${spec.model} → saqlagich ochiq, o'tkazib yuborildi`);
      continue;
    }
    const result = await runSpec(spec, adapter, system, user, { role, opts, log, breaker, limiter: getLimiter(spec.provider), random });
    if (result === "deadline") {
      outOfTime = true;
      break;
    }
    if (result === "timeout") {
      // Muddatsiz chaqiruvchi byudjetini bilmaymiz — eski qoida: to'xtaymiz.
      if (opts.deadline === undefined) return null;
      continue;
    }
    if (result) return result;
  }
  if (outOfTime) throw new DeadlineError(role, leftMs(opts));
  return null;
}
