/**
 * Gemini (asosiy) yoki ixtiyoriy xAI.
 * Kalit bo‘lmasa chaqiruv ketmaydi.
 */

type Provider = "gemini" | "xai" | null;

export function llmProvider(): Provider {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.XAI_API_KEY) return "xai";
  return null;
}

export function llmEnabled() {
  return llmProvider() !== null;
}

export function llmModel() {
  if (llmProvider() === "gemini") {
    return process.env.GEMINI_MODEL || "gemini-3.7-flash";
  }
  return process.env.XAI_MODEL || "grok-4.3";
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
};

/**
 * Bitta urinish natijasi.
 *
 * `retryable` — xato o'tkinchimi. Tarmoq uzilishi, 429 (rate limit) va
 * 5xx qayta urinishga arziydi; 4xx (noto'g'ri so'rov, kalit) va to'liq
 * timeout esa yo'q — timeout byudjetni allaqachon yeb bo'lgan.
 */
type Attempt<T> = { value: T | null; retryable?: boolean };

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
  budget: number,
  call: (timeoutMs: number) => Promise<Attempt<T>>,
): Promise<T | null> {
  const started = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = budget - (Date.now() - started);
    // Qayta urinish uchun kamida 6 soniya qolishi kerak.
    if (attempt > 0 && left < 6_000) break;
    const res = await call(attempt === 0 ? budget : Math.min(left, budget));
    if (res.value) return res.value;
    if (!res.retryable) break;
    await sleep(500 * 2 ** attempt);
  }
  return null;
}

/**
 * Provayderga so'rov — qayta urinish bilan.
 *
 * Gemini ham, xAI ham `GroundedResult` qaytaradi; grounding so'ralmagan
 * (yoki xAI) yo'lda `sources`/`queries` bo'sh bo'ladi. Shu tufayli
 * `llmComplete` va `llmGrounded` bitta tanadan foydalanadi.
 */
async function runLlm(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<GroundedResult | null> {
  assertGroundingMode(opts);
  const provider = llmProvider();
  if (!provider) return null;
  const call = provider === "gemini" ? completeGemini : completeXai;
  const budget = opts.timeoutMs ?? 40_000;
  return withRetry(budget, (timeoutMs) => call(system, user, maxTokens, { ...opts, timeoutMs }));
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
 * Faqat Gemini yo'lida ishlaydi. xAI da qidiruv vositasi YO'Q va u yerda
 * `null` qaytadi — ataylab: grounding'siz javob oddiy model bilimi
 * bo'lardi, uni esa promptga «internetdan, TEKSHIRILGAN» sarlavhasi
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
  // Qulf provayderdan OLDIN: xAI da ham, kalitsiz ham bir xil otiladi.
  assertGroundingMode(grounded);
  if (llmEnabled() && llmProvider() !== "gemini") {
    console.warn("[llm] grounding faqat Gemini da bor — tadqiqot o'tkazib yuborildi");
    return null;
  }
  return runLlm(system, user, maxTokens, grounded);
}

function thinkingBudget(requested?: number): number {
  const override = Number(process.env.GEMINI_THINKING_BUDGET);
  if (Number.isFinite(override) && override >= 0) return Math.round(override);
  return Math.max(0, Math.min(4096, Math.round(requested ?? 0)));
}

type GeminiCandidate = {
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
    },
  });
}

async function completeGemini(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<Attempt<GroundedResult>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { value: null, retryable: false };
  const model = llmModel();
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
    };
    if (!res.ok) {
      console.warn("[gemini]", res.status, data.error?.message ?? "request failed");
      return { value: null, retryable: res.status === 429 || res.status >= 500 };
    }
    const cand = data.candidates?.[0];
    const text = cand?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) return { value: null, retryable: false };
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
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    console.warn("[gemini]", message);
    // `aborted` — bizning timeout'imiz; qolgani tarmoq uzilishi.
    return { value: null, retryable: !/abort/i.test(message) };
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
  | { kind: "text"; text: string }
  | { kind: "blocked" }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "skip" };

const SSE_SKIP: SseLine = { kind: "skip" };

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
    return SSE_SKIP;
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
  if (chunk.promptFeedback?.blockReason) return { kind: "blocked" };
  const text = candidateText(chunk.candidates?.[0]);
  return text === "" ? SSE_SKIP : { kind: "text", text };
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
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { value: null, retryable: false };
  const model = llmModel();
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
      console.warn("[gemini:stream]", res.status, err?.error?.message ?? "request failed");
      if (res.status === 429 || res.status >= 500) return { value: null, retryable: true };
      /*
       * Boshqa 4xx — oqim endpointining O'ZI rad etdi (proksi uni
       * bilmaydi, model oqimni qo'llamaydi, `alt=sse` bloklangan).
       * Qayta urinish AYNAN shu javobni berardi, shuning uchun SHU
       * urinishda oqimsiz yo'lga tushamiz: foydalanuvchi jonli matnni
       * yo'qotadi, lekin hujjatni oladi.
       */
      const fallback = await completeGemini(system, user, maxTokens, opts);
      if (fallback.value) onText(fallback.value.text);
      return { value: fallback.value?.text ?? null, retryable: fallback.retryable };
    }
    if (!res.body) {
      // Oqim tanasi yo'q (proksi buferladi yoki `json:`-only stub) —
      // butun javobni bir marta o'qiymiz, bitta `onText`.
      const data = (await res.json()) as GeminiStreamChunk;
      const whole = candidateText(data.candidates?.[0]).trim();
      if (!whole) return { value: null, retryable: false };
      onText(whole);
      return { value: whole, retryable: false };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    /*
     * Bo'lak chegarasi qator chegarasi EMAS: bitta `data:` qatori ikki
     * bo'lakka bo'linishi mumkin, hatto JSON satrining o'rtasidan.
     * Shuning uchun to'liq qator yig'ilmaguncha buferda saqlanadi.
     */
    let buf = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Oxirida newline'siz qolgan quyruq ham to'liq qator.
      if (done && buf !== "" && !buf.endsWith("\n")) buf += "\n";
      let stop: SseLine | null = null;
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const ev = parseSseLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
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
          console.warn("[gemini:stream] javob bloklandi");
          return { value: null, retryable: false };
        }
        console.warn("[gemini:stream]", stop.message);
        return { value: null, retryable: stop.retryable };
      }
      if (done) break;
    }
    const full = text.trim();
    if (!full) return { value: null, retryable: false };
    return { value: full, retryable: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    console.warn("[gemini:stream]", message);
    // `aborted` — bizning timeout'imiz; qolgani tarmoq uzilishi.
    return { value: null, retryable: !/abort/i.test(message) };
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
 * Oqimsiz yo'lga uchta chiqish bor va uchalasi ham `onText` ni BIR
 * MARTA to'liq matn bilan chaqiradi — chaqiruvchi uchun ikki yo'l
 * farqsiz:
 *   1. `LLM_STREAM=false` — kill-switch (oqim ishonchsiz chiqsa
 *      serverni qayta yig'masdan o'chirish);
 *   2. xAI provayderi — u yerda oqim qo'llanmaydi;
 *   3. Gemini oqim endpointi 4xx bersa (`streamGemini` ichida).
 */
export async function llmStream(
  system: string,
  user: string,
  maxTokens = 1200,
  opts: LlmOpts & { onText: (partial: string) => void },
): Promise<string | null> {
  const { onText, ...rest } = opts;
  assertGroundingMode(rest);
  const provider = llmProvider();
  if (!provider) return null;
  if (provider !== "gemini" || process.env.LLM_STREAM === "false") {
    const res = await runLlm(system, user, maxTokens, rest);
    if (!res) return null;
    onText(res.text);
    return res.text;
  }
  const budget = rest.timeoutMs ?? 40_000;
  return withRetry(budget, (timeoutMs) =>
    streamGemini(system, user, maxTokens, { ...rest, timeoutMs }, onText),
  );
}

async function completeXai(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<Attempt<GroundedResult>> {
  const key = process.env.XAI_API_KEY;
  if (!key) return { value: null, retryable: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llmModel(),
        temperature: 0.4,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // Gemini o'chib qolganda slayd/dars/glossariy JSON so'raydi;
        // `response_format` bo'lmasa model matn qaytarib, parse yiqilardi.
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) {
      console.warn("[xai]", res.status);
      return { value: null, retryable: res.status === 429 || res.status >= 500 };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { value: null, retryable: false };
    // xAI da qidiruv vositasi yo'q — manba ham, so'rov ham bo'sh.
    return { value: { text, queries: [], sources: [] }, retryable: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    console.warn("[xai]", message);
    return { value: null, retryable: !/abort/i.test(message) };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * WP8 SEAM — `runLlmRaw` (token telemetriyasi uchun, AUDIT-17)
 * ------------------------------------------------------------------ *
 * `llm/gemini.ts` va `llm/xai.ts` adapterlari (va `llm-roles.ts`ning
 * `LLM_<ROL>` env BERILMAGAN standart yo'li) shu orqali `usageMetadata`/
 * `usage` token sonlarini oladi. `llmComplete`/`llmGrounded`/`llmStream`
 * VA ularning yo'lidagi `completeGemini`/`completeXai`ga BUTUNLAY
 * TEGILMAYDI — boshqa vositalar (slayd, kurs ishi, tarjimon) shulardan
 * foydalanadi va xatti-harakati o'zgarmasligi shart.
 *
 * Bitta urinish (qayta urinish YO'Q) — zaxira zanjiri endi `llm/chain.ts`
 * da, adapter darajasida boshqariladi; eski `withRetry` bilan aralashib
 * ketmasin deb ataylab alohida.
 */

export type RawUsage = { inputTokens: number; outputTokens: number };

export type RawAttempt =
  | { ok: true; text: string; usage: RawUsage }
  | { ok: false; error: string; retryable: boolean; status?: number; retryAfterMs?: number };

/** `Retry-After` sarlavhasi — soniya (son) yoki HTTP-sana bo'lishi mumkin. */
function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function rawGemini(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts & { fetchImpl?: typeof fetch },
): Promise<RawAttempt> {
  const key = process.env.GEMINI_API_KEY;
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
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error?.message ?? `HTTP ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
        status: res.status,
        retryAfterMs: retryAfterMs(res.headers),
      };
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => p.thought !== true)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) return { ok: false, error: "bo'sh javob", retryable: false };
    return {
      ok: true,
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    // `aborted` — bizning timeout'imiz; qolgani tarmoq uzilishi.
    return { ok: false, error: message, retryable: !/abort/i.test(message) };
  } finally {
    clearTimeout(timer);
  }
}

async function rawXai(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts & { fetchImpl?: typeof fetch },
): Promise<RawAttempt> {
  const key = process.env.XAI_API_KEY;
  if (!key) return { ok: false, error: "XAI_API_KEY yo'q", retryable: false };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await fetchImpl("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error?.message ?? `HTTP ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
        status: res.status,
        retryAfterMs: retryAfterMs(res.headers),
      };
    }
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { ok: false, error: "bo'sh javob", retryable: false };
    return {
      ok: true,
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    return { ok: false, error: message, retryable: !/abort/i.test(message) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provayder + ANIQ model (spec'dan, `llmModel()` env'idan emas) bilan
 * BITTA urinish, `usage` bilan. `llm/gemini.ts`/`llm/xai.ts` adapterlari
 * va `llm-roles.ts`ning standart (env'siz) yo'li shundan foydalanadi.
 */
export async function runLlmRaw(
  provider: "gemini" | "xai",
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts & { fetchImpl?: typeof fetch } = {},
): Promise<RawAttempt> {
  return provider === "gemini"
    ? rawGemini(model, system, user, maxTokens, opts)
    : rawXai(model, system, user, maxTokens, opts);
}
