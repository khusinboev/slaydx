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
  content?: { parts?: { text?: string }[] };
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    searchEntryPoint?: { renderedContent?: string };
  };
};

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
      body: JSON.stringify({
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
      }),
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
