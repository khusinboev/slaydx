/**
 * Gemini orqali LLM chaqiruvlari (standart yo'l).
 * Kalit bo‘lmasa chaqiruv ketmaydi. When Gemini fails, the direct calls walk on to the fallbacks of the text chain
 * (`walkTextChain`, docs/ops/LLM-FALLBACK.md).
 */
import { recordGrounding, recordLlmUsage } from "./job-cost";
import { allowOrWait, breakerFor } from "./llm/breaker";
import { BREAKER_WAIT_MAX_MS, CHAIN_MIN_ATTEMPT_MS, CHAIN_SAFETY_MS, DeadlineError, TIMEOUT_RETRY_MIN_LEFT_MS, completeWithChain } from "./llm/chain";
import { ACCOUNT_BREAKER_MS, classifyFailure, isAccountFailure, isSafetyFinish, reportFailure, reportFallback, withJsonRetry, type FailureKind } from "./llm/failure";
import { FALLBACK_ADAPTERS } from "./llm/fallback-adapters";
import { limiterFor } from "./llm/limiter";
import type { RoleSpec } from "./llm/types";
import { log } from "../server/log";
import { geminiTextModel, usableTextChain } from "../server/providers/route-effective";
import { getProviderKey } from "../server/providers/resolve";
import { backoffMs, describeNetError, equalJitterMs, geminiRetryDelayMs, parseRetryAfter } from "./llm/retry";

export { describeNetError };

type Provider = "gemini" | null;

export function llmProvider(): Provider {
  return getProviderKey("gemini") ? "gemini" : null;
}

/** Some text provider can answer: Gemini, or a fallback of the text chain (`llm.chain`). */
export function llmEnabled() {
  return usableTextChain().length > 0;
}

/** The default Gemini text model: the admin's choice (`llm.model` slot), else `GEMINI_MODEL`, else the built-in default. */
export function llmModel() {
  return geminiTextModel();
}

export type LlmOpts = {
  json?: boolean;
  timeoutMs?: number;
  /**
   * Gemini «o'ylash» byudjeti (token).
   *
   * Standart 0 — tez va arzon, qisqa JSON javoblar uchun to'g'ri.
   * Lekin uzun akademik matnda o'ylash sifatni oshiradi: dalil
   * zanjiri, takrorsiz tuzilma. Shuning uchun u faqat kerakli
   * joyda (kurs ishi bo'limlari) yoqiladi — narxi bor.
   * `GEMINI_THINKING_BUDGET` bilan bekor qilish mumkin.
   */
  thinking?: number;
  /**
   * Internet qidiruvi (Gemini `google_search` grounding).
   *
   * Yoqilsa so'rov TANASIGA `tools: [{ google_search: {} }]` qo'shiladi
   * va javobda `groundingMetadata` keladi: model o'zi tuzgan qidiruv
   * so'rovlari, topilgan sahifalar va Google ToS talab qiladigan
   * qidiruv takliflari bloki.
   *
   * JSON rejimi bilan BIRGA ISHLAMAYDI — jonli tasdiqlangan
   * (2026-09-08): `responseMimeType: "application/json"` qo'shilsa
   * kandidat BO'SH qaytadi va xato ham bermaydi. Shuning uchun quyida
   * qat'iy qulf bor: tadqiqot MATN rejimida alohida chaqiruvda olinadi,
   * deck JSON esa ikkinchi chaqiruvda.
   */
  grounding?: boolean;
  /**
   * ISH muddati (epoch ms, audit EXT-03 / W3 shartnomasi — `llm/chain.ts`
   * bilan bir xil qoida). Berilsa: har urinish timeout'i muddatgacha
   * qolgan vaqt bilan cheklanadi; qolgan vaqt `CHAIN_MIN_ATTEMPT_MS` dan
   * kam bo'lsa yangi urinish/qayta urinish BOSHLANMAYDI va natija
   * bo'lmasa `DeadlineError` OTILADI — ish «AI javob bermadi» bilan
   * yarim hujjat emas, aniq «vaqt tugadi» bilan yiqiladi (pul qaytadi).
   * Berilmasa — eski xatti-harakat (faqat `timeoutMs` byudjeti).
   */
  deadline?: number;
  /**
   * Optional improvement call (thin-slide repair, research): a TIMEOUT is not
   * retried even when the job deadline would allow it. Essential text steps
   * leave it unset and get one retry after a timeout.
   */
  noTimeoutRetry?: boolean;
  /**
   * Gemini `responseSchema` (OpenAPI subset), sent together with the JSON mime type. Needs `json`.
   * Constrained decoding: the answer cannot be malformed JSON.
   */
  responseSchema?: Record<string, unknown>;
  /**
   * Like `responseSchema`, but ONLY for the JSON-quality retry (the second attempt after an
   * unparseable first answer). The first attempt keeps the free form it always had.
   */
  retrySchema?: Record<string, unknown>;
  /** The Gemini model of this call (a `llm.chain` entry). Absent: the default text model. */
  model?: string;
};

/** Grounding topgan bitta sahifa. `uri` — Google redirect, `title` — domen. */
export type GroundedSource = { title: string; uri: string };

/**
 * Grounding chaqiruvining natijasi.
 *
 * `queries` — model O'ZI tuzgan qidiruv so'rovlari (hisobot uchun),
 * `entryPoint` — Google ToS bo'yicha ko'rsatilishi shart bo'lgan
 * qidiruv takliflari HTML bloki.
 */
export type GroundedResult = {
  text: string;
  queries: string[];
  sources: GroundedSource[];
  entryPoint?: string;
  /** Provider's raw stop reason (Gemini `finishReason`): `MAX_TOKENS` means the answer was cut. */
  finishReason?: string;
  /** Who answered, when it was not Gemini (a fallback spec of the text chain). */
  provider?: string;
  model?: string;
};

/**
 * Bitta urinish natijasi.
 *
 * `retryable` — xato o'tkinchimi. Tarmoq uzilishi, 429 (rate limit) va
 * 5xx qayta urinishga arziydi; 4xx (noto'g'ri so'rov, kalit) va to'liq
 * timeout esa yo'q — timeout byudjetni allaqachon yeb bo'lgan.
 */
type Attempt<T> = {
  value: T | null;
  retryable?: boolean;
  /** HTTP status (tarmoq xatosi/timeout'da yo'q). */
  status?: number;
  /** Provayder aytgan kutish: `Retry-After` yoki Gemini `RetryInfo`. */
  retryAfterMs?: number;
  /** Bizning timeout'imiz (abort) — sekin provayder belgisi. */
  timedOut?: boolean;
  /** Token spend of the attempt (EXT-11 telemetry); on a FAILED attempt it is a paid, empty answer. */
  usage?: RawUsage;
  /** Failure classification the provider call already knows (empty/safety/...); HTTP/network/timeout are derived. */
  kind?: FailureKind;
  /** Short provider error text for the structured failure line (never prompt text). */
  message?: string;
  /** Provider stop reason (also on success: `MAX_TOKENS` marks a truncated answer). */
  finishReason?: string;
};

/** Qayta urinish uchun kamida shuncha vaqt qolishi kerak (ms). */
const RETRY_MIN_LEFT_MS = 6_000;
/** Shundan qisqa timeout (byudjet tufayli) saqlagichga nosozlik deb yozilmaydi. */
const BREAKER_TIMEOUT_FLOOR_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * QULF: grounding + JSON birga bo'lmaydi.
 *
 * Ikkovi birga kelsa Gemini bo'sh kandidat qaytaradi va xato ham
 * bermaydi — natijada «na tadqiqot, na deck» holati JIMGINA yuzaga
 * kelardi. Shuning uchun bu chaqiruv xatosi emas, DASTUR xatosi: kalit
 * bor-yo'qligidan ham, provayderdan ham oldin otiladi.
 */
function assertGroundingMode(opts: LlmOpts): void {
  if (opts.grounding && opts.json) {
    throw new Error("[llm] grounding JSON rejimi bilan mos emas — ikki chaqiruv qiling");
  }
}

/**
 * O'tkinchi xatoda qayta urinish sikli — YAGONA nusxa.
 *
 * Nega kerak: jonli sinovda Gemini ga bir nechta parallel so'rov ketganda
 * `fetch failed` uzilishi kuzatildi. Qayta urinish bo'lmagani uchun bitta
 * uzilish BUTUN hujjatni yo'q qilardi — 4 ta bo'lim ham bo'sh qaytib,
 * ish `FAILED` bo'lardi va foydalanuvchi hech narsa olmasdi.
 *
 * Timeout bo'yicha qayta urinilmaydi: byudjet allaqachon sarflangan,
 * ikkinchi urinish worker muddatini buzardi.
 *
 * Sikl `<T>` bo'yicha umumiy: oddiy matn ham, grounding natijasi ham
 * AYNAN shu yo'ldan o'tadi. Nusxa ko'chirilganda tadqiqot yo'li qayta
 * urinishsiz qolar va bitta tarmoq uzilishi butun tadqiqotni o'chirardi.
 */
async function withRetry<T>(
  provider: "gemini",
  budget: number,
  call: (timeoutMs: number) => Promise<Attempt<T>>,
  deadline?: number,
  role = "complete",
  noTimeoutRetry = false,
  step: GeminiStep = {},
): Promise<{ value: T; finishReason?: string } | null> {
  let started = Date.now();
  const breaker = breakerFor(provider);
  const limiter = limiterFor(provider);
  const model = step.model ?? llmModel();
  const MAX_ATTEMPTS = 3;
  let timeoutRetried = false;
  // Ish muddatigacha ishlatsa bo'ladigan vaqt (`llm/chain.ts leftMs` bilan bir xil); muddatsiz — cheksiz.
  const jobLeft = () => (deadline === undefined ? Number.POSITIVE_INFINITY : deadline - CHAIN_SAFETY_MS - Date.now());
  const skipped = (attempt: number, kind: FailureKind, message: string) =>
    reportFailure({ role, provider, model, attempt: attempt + 1, durationMs: 0, kind, retryable: false, message });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const left = budget - (Date.now() - started);
    // Qayta urinish uchun kamida 6 soniya qolishi kerak.
    if (attempt > 0 && left < RETRY_MIN_LEFT_MS) break;
    // Ish muddati: yangi urinishga joy yo'q — «vaqt tugadi» (EXT-03).
    const dl = jobLeft();
    if (dl < CHAIN_MIN_ATTEMPT_MS) throw new DeadlineError(provider, dl);
    /*
     * Saqlagich (audit EXT-04): ketma-ket sekin/5xx javoblardan keyin
     * provayder sovish davrida CHAQIRILMAYDI — har chaqiruv nosozlikni
     * qaytadan «kashf qilib» to'liq timeout'ni kutmasin. Ish muddati bor
     * bo'lsa va sovish qisqa bo'lsa — kutamiz (2026-10-10: bir to'da 503
     * saqlagichni ochdi va barcha ishlar ~2 s da yiqildi). A fallback spec would answer sooner than the cooldown ends.
     */
    const waitMax = deadline !== undefined && !step.hasFallback ? Math.min(BREAKER_WAIT_MAX_MS, dl - CHAIN_MIN_ATTEMPT_MS - 5_000) : 0;
    if (!(waitMax > 0 ? await allowOrWait(breaker, waitMax) : breaker.allow())) {
      console.warn(`[llm] ${provider} saqlagichi ochiq — chaqiruv o'tkazib yuborildi`);
      skipped(attempt, "other", "circuit breaker open - call skipped");
      return null;
    }
    const slot = Math.min(attempt === 0 ? budget : Math.min(left, budget), jobLeft());
    // Cheklagich (audit EXT-09): ortiqcha parallel so'rov qisqa navbatda kutadi.
    const queued = limiter.active >= limiter.max ? Date.now() : 0;
    const release = await limiter.acquire(slot);
    if (!release) {
      console.warn(`[llm] ${provider} navbatida vaqt tugadi (${slot} ms)`);
      skipped(attempt, "timeout", `limiter queue wait exceeded ${slot} ms (max ${limiter.max} in flight)`);
      return null;
    }
    // Navbatda kutilgan vaqt ayriladi; bo'sh slotda timeout aynan avvalgidek.
    const timeoutMs = queued ? Math.max(1, slot - (Date.now() - queued)) : slot;
    const attemptStarted = Date.now();
    let res: Attempt<T>;
    try {
      res = await call(timeoutMs);
    } finally {
      release();
    }
    if (res.usage) recordLlmUsage({ provider, model, ...res.usage });
    if (res.value) {
      breaker.success();
      return { value: res.value, ...(res.finishReason ? { finishReason: res.finishReason } : {}) };
    }
    // ONE structured line per failed attempt (kind/status/tokens; never prompt text).
    reportFailure({
      role,
      provider,
      model,
      attempt: attempt + 1,
      durationMs: Date.now() - attemptStarted,
      kind: res.kind ?? classifyFailure({ status: res.status, message: res.message, timedOut: res.timedOut }),
      status: res.status,
      retryable: Boolean(res.retryable),
      message: res.message ?? (res.status !== undefined ? `HTTP ${res.status}` : "no details"),
      finishReason: res.finishReason,
      inputTokens: res.usage?.inputTokens,
      outputTokens: res.usage?.outputTokens,
    });
    if (res.timedOut) {
      if (step.onTimeout) step.onTimeout();
      if (timeoutMs >= BREAKER_TIMEOUT_FLOOR_MS) breaker.failure();
      // Urinishni ish muddati kesgan bo'lsa — bu «vaqt tugadi», «model javob bermadi» emas.
      if (jobLeft() < CHAIN_MIN_ATTEMPT_MS) throw new DeadlineError(provider, jobLeft());
      // One retry after a timeout, only inside a job deadline with real time left (fresh per-call budget).
      if (deadline !== undefined && !noTimeoutRetry && !step.hasFallback && !timeoutRetried && attempt < MAX_ATTEMPTS - 1 && jobLeft() >= TIMEOUT_RETRY_MIN_LEFT_MS) {
        timeoutRetried = true;
        started = Date.now();
        await sleep(equalJitterMs(0, 500));
        continue;
      }
    } else if (res.kind === "empty" || res.kind === "safety") {
      // Provider answered (empty candidate / policy block): healthy transport, not a breaker failure (review R1).
    } else if (isAccountFailure(res.status, res.message)) {
      // Every later call would get the same refusal: one is enough to open the breaker (2026-11-05 outage).
      breaker.trip(ACCOUNT_BREAKER_MS, `hisob xatosi ${res.status}`);
    } else if (res.status === undefined ? res.retryable : res.status >= 500) {
      breaker.failure();
    } else if (res.status !== undefined && res.status !== 429) {
      breaker.success();
    }
    if (!res.retryable) break;
    // Oxirgi urinishdan keyin uxlash — bekor vaqt (audit EXT-13).
    if (attempt === MAX_ATTEMPTS - 1) break;
    // Tarmoq uzilishida teng jitter (kamida yarim asos), HTTP xatosida to'liq jitter; bo'sh javobda qisqa teng jitter.
    const wait =
      res.retryAfterMs ??
      (res.kind === "empty" ? equalJitterMs(attempt, 500) : res.status === undefined ? equalJitterMs(attempt, 500) : backoffMs(attempt, 500));
    // Kutish + keyingi urinish byudjetga sig'masa — hozir voz kechamiz.
    if (Date.now() - started + wait + RETRY_MIN_LEFT_MS > budget) break;
    // Kutishdan keyin ish muddatiga urinish sig'maydi — uxlamasdan «vaqt tugadi».
    if (jobLeft() - wait < CHAIN_MIN_ATTEMPT_MS) throw new DeadlineError(provider, jobLeft());
    await sleep(wait);
  }
  return null;
}

/** How `withRetry` runs inside the text chain. All absent = Gemini is the only provider, the path as it always was. */
type GeminiStep = {
  model?: string;
  /** A fallback spec follows: no waiting for an open breaker, no second try after a timeout. */
  hasFallback?: boolean;
  onTimeout?: () => void;
};

/**
 * Walks the text chain (`llm.chain`) for the direct tools. Gemini keeps its own path (`withRetry`: streaming, grounding,
 * response schema); any other provider goes through `completeWithChain`, in runs of consecutive specs. With only Gemini
 * usable (no fallback key) this is one `gemini()` call with an empty step, exactly the old path.
 *
 * A timeout without a job deadline stops the walk, the rule of `chain.ts`: the caller's budget is unknown.
 */
async function walkTextChain<T>(
  role: string,
  deadline: number | undefined,
  gemini: (step: GeminiStep) => Promise<T | null>,
  others: (specs: RoleSpec[], afterPrimary: boolean) => Promise<T | null>,
): Promise<T | null> {
  const specs = usableTextChain();
  let afterPrimary = false;
  for (let i = 0; i < specs.length; ) {
    const spec = specs[i];
    if (spec.provider === "gemini") {
      let timedOut = false;
      const hasFallback = i < specs.length - 1;
      const res = await gemini({ model: spec.model, hasFallback, onTimeout: () => (timedOut = true) });
      if (res) {
        if (afterPrimary) reportFallback({ role, provider: spec.provider, model: spec.model });
        return res;
      }
      if (timedOut && deadline === undefined) return null;
      i += 1;
    } else {
      let end = i;
      while (end < specs.length && specs[end].provider !== "gemini") end += 1;
      const res = await others(specs.slice(i, end), afterPrimary);
      if (res) return res;
      i = end;
    }
    afterPrimary = true;
  }
  return null;
}

/** One run of non-Gemini specs of the text chain, with the spend recorded like every other answer. */
async function completeOthers(role: string, specs: RoleSpec[], afterPrimary: boolean, system: string, user: string, maxTokens: number, opts: LlmOpts, budget: number, onText?: (partial: string) => void): Promise<GroundedResult | null> {
  const res = await completeWithChain(
    role,
    specs,
    system,
    user,
    {
      json: opts.json,
      maxTokens,
      timeoutMs: budget,
      thinking: opts.thinking,
      deadline: opts.deadline,
      noTimeoutRetry: opts.noTimeoutRetry,
      responseSchema: opts.responseSchema,
      onText,
    },
    { adapters: FALLBACK_ADAPTERS, log: (line) => console.log(line), afterPrimary },
  );
  if (!res) return null;
  recordLlmUsage(res.usage);
  return { text: res.text, queries: [], sources: [], provider: res.usage.provider, model: res.usage.model, ...(res.finishReason ? { finishReason: res.finishReason } : {}) };
}

/**
 * A text-only request to the fallback providers, for a direct Gemini call outside the text chain (the domla's typed
 * answer). `null` when no fallback is configured or none answered.
 */
export async function llmFallback(role: string, system: string, user: string, maxTokens: number, opts: LlmOpts = {}): Promise<string | null> {
  const specs = usableTextChain().filter((s) => s.provider !== "gemini");
  if (specs.length === 0) return null;
  const res = await completeOthers(role, specs, true, system, user, maxTokens, opts, opts.timeoutMs ?? 40_000);
  return res?.text ?? null;
}

/**
 * Provayderga so'rov — qayta urinish bilan.
 *
 * Grounding so'ralmagan yo'lda `sources`/`queries` bo'sh bo'ladi. Shu tufayli
 * `llmComplete` va `llmGrounded` bitta tanadan foydalanadi.
 */
async function runLlm(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
  role = "complete",
): Promise<GroundedResult | null> {
  assertGroundingMode(opts);
  const budget = opts.timeoutMs ?? 40_000;
  const gemini = async (o: { system: string; maxTokens: number; retry?: boolean }, step: GeminiStep): Promise<GroundedResult | null> => {
    const call = { ...retryOpts(opts, o.retry), ...(step.model ? { model: step.model } : {}) };
    const done = await withRetry("gemini", budget, (timeoutMs) => completeGemini(o.system, user, o.maxTokens, { ...call, timeoutMs }), opts.deadline, role, opts.noTimeoutRetry, step);
    return done ? { ...done.value, ...(done.finishReason ? { finishReason: done.finishReason } : {}) } : null;
  };
  /*
   * Grounding exists only on Gemini and never falls back: an answer from another model's memory would enter the deck's
   * prompt under the «verified on the internet» heading (see `llmGrounded`). The caller carries on without research.
   */
  const once = async (o: { system: string; maxTokens: number; retry?: boolean }): Promise<GroundedResult | null> =>
    opts.grounding
      ? llmProvider()
        ? gemini(o, {})
        : null
      : walkTextChain(role, opts.deadline, (step) => gemini(o, step), (specs, afterPrimary) => completeOthers(role, specs, afterPrimary, o.system, user, o.maxTokens, retryOpts(opts, o.retry), budget));
  // JSON answers that are cut or unparseable get ONE stricter retry (every paid attempt is already recorded in the job meter).
  return withJsonRetry(once, { system, maxTokens, json: opts.json, deadline: opts.deadline }, { role, provider: (r) => r.provider ?? "gemini", model: (r) => r.model ?? llmModel() }, (winner) => winner);
}

export async function llmComplete(
  system: string,
  user: string,
  maxTokens = 1200,
  opts: LlmOpts = {},
): Promise<string | null> {
  const res = await runLlm(system, user, maxTokens, opts);
  return res?.text ?? null;
}

/**
 * Internet qidiruvi bilan chaqiruv (Gemini grounding).
 *
 * Faqat Gemini yo'lida ishlaydi (qidiruv vositasi shu provayderda): the
 * fallback providers have no search tool and are never asked. Kalit
 * yo'q bo'lsa `null` qaytadi — ataylab: grounding'siz javob oddiy model
 * bilimi bo'lardi, uni esa promptga «internetdan, TEKSHIRILGAN» sarlavhasi
 * bilan qo'yish uydirma raqamni ishonchli qilib ko'rsatishdan boshqa
 * narsa emas, ustiga manba ham bo'lmaydi. Tadqiqot bo'lmasa deck
 * baribir yoziladi — `runSlideResearch` `null` ni shunday o'qiydi.
 */
export async function llmGrounded(
  system: string,
  user: string,
  maxTokens = 2048,
  opts: LlmOpts = {},
): Promise<GroundedResult | null> {
  const grounded: LlmOpts = { ...opts, grounding: true };
  // Qulf kalitdan OLDIN: kalitsiz ham bir xil otiladi.
  assertGroundingMode(grounded);
  const res = await runLlm(system, user, maxTokens, grounded, "grounded");
  // Qidiruv haqiqatan bo'lgan javob — alohida pullik birlik (EXT-11).
  if (res && (res.queries.length || res.sources.length)) recordGrounding(res.queries.length);
  return res;
}

/** Gemini `usageMetadata` — hisob uchun kerakli qismi. */
type GeminiUsageMetadata = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };

/**
 * Token sarfi. O'ylash tokenlari (`thoughtsTokenCount`) CHIQISH narxida
 * hisoblanadi — ilgari tashlab ketilardi va o'ylaydigan chaqiruvlar
 * arzon ko'rinardi (audit EXT-11).
 */
function geminiUsage(u: GeminiUsageMetadata): RawUsage {
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

/**
 * Why a Gemini answer has no text. A policy block (prompt feedback / safety
 * finish) is final; anything else (empty candidate list, `STOP` with no parts,
 * thinking ate the whole limit) is transient and worth another try.
 */
function geminiEmpty(blockReason: string | undefined, finishReason: string | undefined): { kind: FailureKind; retryable: boolean; message: string } {
  if (blockReason || isSafetyFinish(finishReason)) {
    return { kind: "safety", retryable: false, message: `blocked: ${blockReason ?? finishReason}` };
  }
  return { kind: "empty", retryable: true, message: `empty answer (finishReason=${finishReason ?? "none"})` };
}

function thinkingBudget(requested?: number): number {
  const override = Number(process.env.GEMINI_THINKING_BUDGET);
  if (Number.isFinite(override) && override >= 0) return Math.round(override);
  return Math.max(0, Math.min(4096, Math.round(requested ?? 0)));
}

type GeminiCandidate = {
  /** `STOP`, `MAX_TOKENS`, `SAFETY`, ... */
  finishReason?: string;
  /** `thought: true` — modelning ichki o'ylashi, javob matni EMAS. */
  content?: { parts?: { text?: string; thought?: boolean }[] };
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    searchEntryPoint?: { renderedContent?: string };
  };
};

/**
 * Gemini so'rov tanasi — oqimli va oqimsiz yo'l uchun YAGONA nusxa.
 *
 * `streamGenerateContent` va `generateContent` AYNAN bir xil tanani
 * kutadi, va ular orasida farq paydo bo'lishi eng yomon nosozlik
 * bo'lardi: 4xx da oqim oqimsiz yo'lga tushadi — agar tana boshqacha
 * bo'lsa foydalanuvchi zaxira yo'lda BOSHQA javob olardi (masalan JSON
 * rejimisiz matn) va parse jimgina yiqilardi. Shuning uchun tana bitta
 * joyda quriladi.
 */
function geminiBody(system: string, user: string, maxTokens: number, opts: LlmOpts): string {
  return JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    // Qidiruv vositasi — faqat so'ralganda va `generationConfig` dan
    // TASHQARIDA, tana darajasida (jonli tasdiqlangan).
    ...(opts.grounding ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      temperature: opts.json ? 0.4 : 0.5,
      /*
       * O'ylaydigan modelda `maxOutputTokens` O'YLASHNI HAM qamraydi:
       * chegara past bo'lsa model o'ylab bo'lgach javobga token
       * qolmagani uchun bo'sh kandidat qaytaradi. Shu sabab pastki
       * chegara 4096.
       */
      maxOutputTokens: Math.max(maxTokens, 4096),
      thinkingConfig: { thinkingBudget: thinkingBudget(opts.thinking) },
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      ...(opts.json && opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
  });
}

/** Options of the stricter second attempt: the retry schema (when given) becomes the response schema. */
function retryOpts<T extends LlmOpts>(opts: T, retry: boolean | undefined): T {
  return retry && opts.retrySchema ? { ...opts, responseSchema: opts.retrySchema } : opts;
}

async function completeGemini(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<Attempt<GroundedResult>> {
  const key = getProviderKey("gemini");
  if (!key) return { value: null, retryable: false, kind: "other", message: "GEMINI_API_KEY missing" };
  const model = opts.model ?? llmModel();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 40_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: geminiBody(system, user, maxTokens, opts),
    });
    const data = (await res.json()) as {
      error?: { message?: string };
      candidates?: GeminiCandidate[];
      usageMetadata?: GeminiUsageMetadata;
      promptFeedback?: { blockReason?: string };
    };
    if (!res.ok) {
      return {
        value: null,
        retryable: res.status === 429 || res.status >= 500,
        status: res.status,
        message: data.error?.message ?? "request failed",
        retryAfterMs: retryAfterMs(res.headers) ?? geminiRetryDelayMs(data),
      };
    }
    const cand = data.candidates?.[0];
    const text = cand?.content?.parts
      ?.filter((p) => p.thought !== true)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      const why = geminiEmpty(data.promptFeedback?.blockReason, cand?.finishReason);
      return {
        value: null,
        ...why,
        finishReason: cand?.finishReason ?? data.promptFeedback?.blockReason,
        ...(data.usageMetadata ? { usage: geminiUsage(data.usageMetadata) } : {}),
      };
    }
    const meta = cand?.groundingMetadata;
    if (opts.grounding && !meta) {
      // Model qidirmaslikka qaror qildi: matn bor, manba yo'q. Bu xato
      // emas — chaqiruvchi bo'sh `sources` bilan yashaydi.
      console.warn("[gemini] grounding so'raldi, lekin groundingMetadata kelmadi");
    }
    const sources: GroundedSource[] = (meta?.groundingChunks ?? [])
      .map((c) => ({ title: (c.web?.title ?? "").trim(), uri: (c.web?.uri ?? "").trim() }))
      .filter((s) => s.title !== "" && s.uri !== "");
    return {
      value: {
        text,
        queries: (meta?.webSearchQueries ?? []).filter((q) => typeof q === "string" && q.trim() !== ""),
        sources,
        entryPoint: meta?.searchEntryPoint?.renderedContent,
      },
      retryable: false,
      ...(cand?.finishReason ? { finishReason: cand.finishReason } : {}),
      ...(data.usageMetadata ? { usage: geminiUsage(data.usageMetadata) } : {}),
    };
  } catch (e) {
    // `fetch failed` sababi (`ENOTFOUND`/`EAI_AGAIN`/`ECONNRESET`) `cause` da — logda ko'rinsin.
    const message = describeNetError(e);
    // `aborted` — FAQAT bizning timer'imiz; `ETIMEDOUT`/`UND_ERR_CONNECT_TIMEOUT` — tarmoq xatosi, qayta uriladi (review R2).
    const timedOut = /abort/i.test(message);
    return { value: null, retryable: !timedOut, timedOut, message };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * OQIM (SSE) — `llmStream`
 * ------------------------------------------------------------------ */

/** Bitta SSE `data:` bo'lagi. */
type GeminiStreamChunk = {
  error?: { message?: string; code?: number };
  promptFeedback?: { blockReason?: string };
  candidates?: GeminiCandidate[];
  /** Odatda oxirgi bo'lakda — butun javob bo'yicha yig'indi. */
  usageMetadata?: GeminiUsageMetadata;
};

/**
 * Kandidat qismlaridan javob matni — `thought` qismlari TASHLANADI.
 *
 * O'ylash yoqilganda Gemini o'z mulohazasini ham `parts` ichida, lekin
 * `thought: true` bayrog'i bilan yuboradi. Filtrsiz u foydalanuvchiga
 * javob sifatida oqib chiqardi — JSON deck rejimida esa mulohaza matni
 * JSON ning oldiga yopishib, parse ni ham buzardi.
 */
function candidateText(cand: GeminiCandidate | undefined): string {
  return (cand?.content?.parts ?? [])
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? "")
    .join("");
}

/** Bitta SSE qatorining ma'nosi. */
type SseLine =
  | { kind: "text"; text: string; usage?: RawUsage; finish?: string }
  | { kind: "blocked"; reason?: string }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "skip"; usage?: RawUsage; finish?: string }
  /** A `data:` payload that is not (yet) valid JSON - possibly the first line of a multi-line event. */
  | { kind: "bad" };

const SSE_SKIP: SseEvent = { kind: "skip" };
const SSE_BAD: SseLine = { kind: "bad" };
/** What the stream loop sees: everything but the internal `bad` marker. */
type SseEvent = Exclude<SseLine, { kind: "bad" }>;

/**
 * SSE `data:` lines -> events, tolerant of an event whose JSON is spread over several `data:` lines
 * (the SSE spec joins them with `\n`). A `data:` line that does not parse is held back and joined with
 * the following lines until the JSON is complete; a payload that never completes is DROPPED and counted
 * (`dropped`) - before, such a chunk vanished silently and the answer lost a piece of its text.
 */
export class SseAssembler {
  dropped = 0;
  private pending = "";

  feed(rawLine: string): SseEvent {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) {
      if (line.trim() === "" && this.pending) this.drop();
      return SSE_SKIP;
    }
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") return SSE_SKIP;
    const joined = this.pending ? `${this.pending}\n${payload}` : payload;
    const ev = parseSseLine(`data:${joined}`);
    if (ev.kind !== "bad") {
      this.pending = "";
      return ev;
    }
    if (this.pending) {
      // The held payload did not complete with this line: maybe this line is a fresh, valid event.
      const alone = parseSseLine(`data:${payload}`);
      if (alone.kind !== "bad") {
        this.drop();
        return alone;
      }
    }
    if (joined.length > 1_000_000) {
      this.drop();
      return SSE_SKIP;
    }
    this.pending = joined;
    return SSE_SKIP;
  }

  /** End of stream: an unfinished held payload is a dropped chunk. */
  end(): void {
    if (this.pending) this.drop();
  }

  private drop(): void {
    this.dropped += 1;
    this.pending = "";
  }
}

/**
 * Bitta SSE qatorini o'qish.
 *
 * Bo'sh qatorlar, `event:`/izoh qatorlari va `[DONE]` e'tiborsiz.
 * Buzuq JSON ham tashlanadi: oqim o'rtasidagi bitta nuqsonli bo'lak
 * uchun butun hujjatni yo'qotish mantiqsiz.
 */
function parseSseLine(raw: string): SseLine {
  if (!raw.startsWith("data:")) return SSE_SKIP;
  // `trim()` — bu yerda `\r` ni ham oladi: SSE spetsifikatsiyasi `\r\n`
  // ga ruxsat beradi va qator buferi faqat `\n` bo'yicha kesadi, ya'ni
  // `\r` payload oxirida qolib ketadi (`[DONE]` solishtiruvini buzardi).
  const payload = raw.slice(5).trim();
  if (payload === "" || payload === "[DONE]") return SSE_SKIP;
  let chunk: GeminiStreamChunk;
  try {
    chunk = JSON.parse(payload) as GeminiStreamChunk;
  } catch {
    return SSE_BAD;
  }
  if (chunk.error) {
    const code = chunk.error.code ?? 0;
    return {
      kind: "error",
      message: chunk.error.message ?? "stream error",
      retryable: code === 429 || code >= 500,
    };
  }
  // Xavfsizlik filtri: matn kelmaydi va qayta urinish ham yordam bermaydi.
  if (chunk.promptFeedback?.blockReason) return { kind: "blocked", reason: chunk.promptFeedback.blockReason };
  const text = candidateText(chunk.candidates?.[0]);
  const usage = chunk.usageMetadata ? geminiUsage(chunk.usageMetadata) : undefined;
  const finish = chunk.candidates?.[0]?.finishReason;
  const extra = { ...(usage ? { usage } : {}), ...(finish ? { finish } : {}) };
  if (text === "") return usage || finish ? { kind: "skip", ...extra } : SSE_SKIP;
  return { kind: "text", text, ...extra };
}

/**
 * Gemini SSE oqimi — bitta urinish.
 *
 * `onText` HAR SAFAR to'plangan TO'LIQ matnni oladi (delta emas): shu
 * tufayli chaqiruvchi bitta bo'lakni o'tkazib yuborsa ham holat to'g'ri
 * qoladi. Bitta urinish ichida matn faqat o'sadi, lekin QAYTA
 * urinishda oqim boshidan boshlanadi va `onText` yana qisqa matn bilan
 * chaqiriladi — monotonlikni chaqiruvchi o'zi ta'minlashi kerak
 * (`emittedAbs`).
 */
async function streamGemini(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
  onText: (partial: string) => void,
): Promise<Attempt<string>> {
  const key = getProviderKey("gemini");
  if (!key) return { value: null, retryable: false, kind: "other", message: "GEMINI_API_KEY missing" };
  const model = opts.model ?? llmModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
  try {
    const res = await fetch(url, {
      method: "POST",
      // `AbortSignal.timeout` taymeri unref qilingan — jarayonni
      // ushlab qolmaydi (`completeGemini` dagi `setTimeout` dan farqi).
      signal: AbortSignal.timeout(opts.timeoutMs ?? 40_000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: geminiBody(system, user, maxTokens, opts),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.status === 429 || res.status >= 500) {
        return {
          value: null,
          retryable: true,
          status: res.status,
          message: err?.error?.message ?? "request failed",
          retryAfterMs: retryAfterMs(res.headers) ?? geminiRetryDelayMs(err),
        };
      }
      // The account is refused, not the streaming endpoint: the plain call would get the same answer.
      if (isAccountFailure(res.status, err?.error?.message)) return { value: null, retryable: false, status: res.status, message: err?.error?.message ?? "request failed" };
      /*
       * Boshqa 4xx — oqim endpointining O'ZI rad etdi (proksi uni
       * bilmaydi, model oqimni qo'llamaydi, `alt=sse` bloklangan).
       * Qayta urinish AYNAN shu javobni berardi, shuning uchun SHU
       * urinishda oqimsiz yo'lga tushamiz: foydalanuvchi jonli matnni
       * yo'qotadi, lekin hujjatni oladi.
       */
      const fallback = await completeGemini(system, user, maxTokens, opts);
      if (fallback.value) onText(fallback.value.text);
      return { ...fallback, value: fallback.value?.text ?? null };
    }
    if (!res.body) {
      // Oqim tanasi yo'q (proksi buferladi yoki `json:`-only stub) —
      // butun javobni bir marta o'qiymiz, bitta `onText`.
      const data = (await res.json()) as GeminiStreamChunk;
      const whole = candidateText(data.candidates?.[0]).trim();
      const wholeFinish = data.candidates?.[0]?.finishReason;
      if (!whole) {
        return { value: null, ...geminiEmpty(data.promptFeedback?.blockReason, wholeFinish), ...(wholeFinish ? { finishReason: wholeFinish } : {}), ...(data.usageMetadata ? { usage: geminiUsage(data.usageMetadata) } : {}) };
      }
      onText(whole);
      return {
        value: whole,
        retryable: false,
        ...(wholeFinish ? { finishReason: wholeFinish } : {}),
        ...(data.usageMetadata ? { usage: geminiUsage(data.usageMetadata) } : {}),
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseAssembler();
    /*
     * Bo'lak chegarasi qator chegarasi EMAS: bitta `data:` qatori ikki
     * bo'lakka bo'linishi mumkin, hatto JSON satrining o'rtasidan.
     * Shuning uchun to'liq qator yig'ilmaguncha buferda saqlanadi.
     */
    let buf = "";
    let text = "";
    // `usageMetadata` — oxirgi ko'ringani (yig'indi, delta emas).
    let usage: RawUsage | undefined;
    let finish: string | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Oxirida newline'siz qolgan quyruq ham to'liq qator.
      if (done && buf !== "" && !buf.endsWith("\n")) buf += "\n";
      let stop: SseEvent | null = null;
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const ev = sse.feed(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if ((ev.kind === "text" || ev.kind === "skip") && ev.usage) usage = ev.usage;
        if ((ev.kind === "text" || ev.kind === "skip") && ev.finish) finish = ev.finish;
        if (ev.kind === "text") {
          text += ev.text;
          onText(text);
        } else if (ev.kind !== "skip") {
          stop = ev;
          break;
        }
        nl = buf.indexOf("\n");
      }
      if (stop) {
        await reader.cancel().catch(() => {});
        if (stop.kind === "blocked") {
          return { value: null, retryable: false, kind: "safety", message: `blocked: ${stop.reason ?? "prompt feedback"}`, ...(usage ? { usage } : {}) };
        }
        return { value: null, retryable: stop.retryable, message: stop.message, ...(usage ? { usage } : {}) };
      }
      if (done) break;
    }
    sse.end();
    // A dropped SSE chunk (or a stream cut before `finishReason`) leaves a hole in the text: log it, metadata only.
    if (sse.dropped > 0 || !finish) {
      log("warn", "[llm] stream anomaly", { model, droppedChunks: sse.dropped, finishReason: finish ?? "none", chars: text.length });
    }
    const full = text.trim();
    if (!full) return { value: null, ...geminiEmpty(undefined, finish), ...(finish ? { finishReason: finish } : {}), ...(usage ? { usage } : {}) };
    return { value: full, retryable: false, ...(finish ? { finishReason: finish } : {}), ...(usage ? { usage } : {}) };
  } catch (e) {
    const message = describeNetError(e);
    // `aborted` — FAQAT bizning timer'imiz; `ETIMEDOUT`/`UND_ERR_CONNECT_TIMEOUT` — tarmoq xatosi, qayta uriladi (review R2).
    const timedOut = /abort/i.test(message);
    return { value: null, retryable: !timedOut, timedOut, message };
  }
}

/**
 * Oqimli chaqiruv — matn yozilayotgan payt ko'rinsin uchun.
 *
 * `llmComplete` dan farqi faqat shu: natija bir xil (to'liq matn yoki
 * `null`), lekin yo'lda `onText` to'plangan matn bilan chaqiriladi.
 * Ataylab ALOHIDA funksiya: mavjud chaqiruvchilarning hech biri
 * o'zgarmaydi va oqim faqat progress kerak bo'lgan joyda yoqiladi.
 *
 * Oqimsiz yo'lga ikkita chiqish bor va ikkalasi ham `onText` ni BIR
 * MARTA to'liq matn bilan chaqiradi — chaqiruvchi uchun ikki yo'l
 * farqsiz:
 *   1. `LLM_STREAM=false` — kill-switch (oqim ishonchsiz chiqsa
 *      serverni qayta yig'masdan o'chirish);
 *   2. Gemini oqim endpointi 4xx bersa (`streamGemini` ichida).
 */
export async function llmStream(
  system: string,
  user: string,
  maxTokens = 1200,
  opts: LlmOpts & { onText: (partial: string) => void },
): Promise<string | null> {
  const { onText, ...rest } = opts;
  assertGroundingMode(rest);
  if (!llmEnabled()) return null;
  if (process.env.LLM_STREAM === "false") {
    const res = await runLlm(system, user, maxTokens, rest, "stream");
    if (!res) return null;
    onText(res.text);
    return res.text;
  }
  const budget = rest.timeoutMs ?? 40_000;
  const geminiPass = async (o: { system: string; maxTokens: number; retry?: boolean }, step: GeminiStep): Promise<{ text: string; finishReason?: string } | null> => {
    const own = { ...rest, ...(step.model ? { model: step.model } : {}) };
    /*
     * The JSON-quality retry is NOT streamed: one plain `generateContent` call (JSON mime type, plus the
     * retry schema when the caller has one). The whole answer arrives atomically, so a bad SSE chunk or a
     * mid-stream hiccup cannot corrupt it. The live text callback gets the finished text once (`onText`
     * is cumulative, the caller's indices are monotonic).
     */
    if (o.retry) {
      const plain = await withRetry(
        "gemini",
        budget,
        (timeoutMs) => completeGemini(o.system, user, o.maxTokens, { ...retryOpts(own, true), timeoutMs }),
        rest.deadline,
        "stream",
        rest.noTimeoutRetry,
        step,
      );
      if (!plain) return null;
      onText(plain.value.text);
      return { text: plain.value.text, ...(plain.finishReason ? { finishReason: plain.finishReason } : {}) };
    }
    const done = await withRetry(
      "gemini",
      budget,
      (timeoutMs) => streamGemini(o.system, user, o.maxTokens, { ...own, timeoutMs }, onText),
      rest.deadline,
      "stream",
      rest.noTimeoutRetry,
      step,
    );
    return done ? { text: done.value, ...(done.finishReason ? { finishReason: done.finishReason } : {}) } : null;
  };
  // The stricter retry is not streamed on a fallback either: the finished text reaches `onText` once.
  const once = (o: { system: string; maxTokens: number; retry?: boolean }): Promise<{ text: string; finishReason?: string; provider?: string; model?: string } | null> =>
    walkTextChain(
      "stream",
      rest.deadline,
      (step) => geminiPass(o, step),
      async (specs, afterPrimary) => {
        const r = await completeOthers("stream", specs, afterPrimary, o.system, user, o.maxTokens, retryOpts(rest, o.retry), budget, o.retry ? undefined : onText);
        if (r && o.retry) onText(r.text);
        return r;
      },
    );
  const res = await withJsonRetry(once, { system, maxTokens, json: rest.json, deadline: rest.deadline }, { role: "stream", provider: (r) => r.provider ?? "gemini", model: (r) => r.model ?? llmModel() }, (winner) => winner);
  return res?.text ?? null;
}

/* ------------------------------------------------------------------ *
 * WP8 SEAM — `runLlmRaw` (token telemetriyasi uchun, AUDIT-17)
 * ------------------------------------------------------------------ *
 * `llm/gemini.ts` adapteri (va `llm-roles.ts`ning
 * `LLM_<ROL>` env BERILMAGAN standart yo'li) shu orqali `usageMetadata`/
 * `usage` token sonlarini oladi. `llmComplete`/`llmGrounded`/`llmStream`
 * VA ularning yo'lidagi `completeGemini`ga BUTUNLAY
 * TEGILMAYDI — boshqa vositalar (slayd, kurs ishi, tarjimon) shulardan
 * foydalanadi va xatti-harakati o'zgarmasligi shart.
 *
 * Bitta urinish (qayta urinish YO'Q) — zaxira zanjiri endi `llm/chain.ts`
 * da, adapter darajasida boshqariladi; eski `withRetry` bilan aralashib
 * ketmasin deb ataylab alohida.
 */

export type RawUsage = { inputTokens: number; outputTokens: number };

export type RawAttempt =
  | { ok: true; text: string; usage: RawUsage; finishReason?: string }
  | { ok: false; error: string; retryable: boolean; status?: number; retryAfterMs?: number; kind?: FailureKind; finishReason?: string; usage?: RawUsage };

/** `Retry-After` sarlavhasi — soniya (son) yoki HTTP-sana bo'lishi mumkin. */
function retryAfterMs(headers: Headers | null | undefined): number | undefined {
  // Sarlavhasiz javob (proksi/stub) — kutish noma'lum, xato EMAS.
  return typeof headers?.get === "function" ? parseRetryAfter(headers.get("retry-after")) : undefined;
}

async function rawGemini(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts & { fetchImpl?: typeof fetch },
): Promise<RawAttempt> {
  const key = getProviderKey("gemini");
  if (!key) return { ok: false, error: "GEMINI_API_KEY yo'q", retryable: false };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 40_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetchImpl(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      // `model` shu yerda spec'dan keladi — `geminiBody` o'zi model bilmaydi (URLda).
      body: geminiBody(system, user, maxTokens, opts),
    });
    const data = (await res.json()) as {
      error?: { message?: string };
      candidates?: GeminiCandidate[];
      usageMetadata?: GeminiUsageMetadata;
      promptFeedback?: { blockReason?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error?.message ?? `HTTP ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
        status: res.status,
        // Gemini kutishni tanada beradi (`RetryInfo`), sarlavhada emas.
        retryAfterMs: retryAfterMs(res.headers) ?? geminiRetryDelayMs(data),
      };
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => p.thought !== true)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    const finish = data.candidates?.[0]?.finishReason;
    if (!text) {
      const why = geminiEmpty(data.promptFeedback?.blockReason, finish);
      return {
        ok: false,
        error: `bo'sh javob (${why.message})`,
        retryable: why.retryable,
        kind: why.kind,
        ...(finish ? { finishReason: finish } : {}),
        ...(data.usageMetadata ? { usage: geminiUsage(data.usageMetadata) } : {}),
      };
    }
    return {
      ok: true,
      text,
      usage: geminiUsage(data.usageMetadata ?? {}),
      ...(finish ? { finishReason: finish } : {}),
    };
  } catch (e) {
    const message = describeNetError(e);
    // `aborted` — bizning timeout'imiz; qolgani tarmoq uzilishi.
    return { ok: false, error: message, retryable: !/abort/i.test(message) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ANIQ Gemini modeli (spec'dan, `llmModel()` env'idan emas) bilan
 * BITTA urinish, `usage` bilan. `llm/gemini.ts` adapteri
 * va `llm-roles.ts`ning standart (env'siz) yo'li shundan foydalanadi.
 */
export async function runLlmRaw(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts & { fetchImpl?: typeof fetch } = {},
): Promise<RawAttempt> {
  return rawGemini(model, system, user, maxTokens, opts);
}
