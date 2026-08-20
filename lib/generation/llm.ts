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
};

/**
 * Chaqiruv natijasi.
 *
 * `retryable` — xato o'tkinchimi. Tarmoq uzilishi, 429 (rate limit) va
 * 5xx qayta urinishga arziydi; 4xx (noto'g'ri so'rov, kalit) va to'liq
 * timeout esa yo'q — timeout byudjetni allaqachon yeb bo'lgan.
 */
type LlmResult = { text: string | null; retryable?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * LLM ga so'rov — o'tkinchi xatoda qayta urinish bilan.
 *
 * Nega kerak: jonli sinovda Gemini ga bir nechta parallel so'rov ketganda
 * `fetch failed` uzilishi kuzatildi. Qayta urinish bo'lmagani uchun bitta
 * uzilish BUTUN hujjatni yo'q qilardi — 4 ta bo'lim ham bo'sh qaytib,
 * ish `FAILED` bo'lardi va foydalanuvchi hech narsa olmasdi.
 *
 * Timeout bo'yicha qayta urinilmaydi: byudjet allaqachon sarflangan,
 * ikkinchi urinish worker muddatini buzardi.
 */
export async function llmComplete(
  system: string,
  user: string,
  maxTokens = 1200,
  opts: LlmOpts = {},
): Promise<string | null> {
  const provider = llmProvider();
  if (!provider) return null;
  const call = provider === "gemini" ? completeGemini : completeXai;
  const budget = opts.timeoutMs ?? 40_000;
  const started = Date.now();

  for (let attempt = 0; attempt < 3; attempt++) {
    const left = budget - (Date.now() - started);
    // Qayta urinish uchun kamida 6 soniya qolishi kerak.
    if (attempt > 0 && left < 6_000) break;
    const res = await call(system, user, maxTokens, {
      ...opts,
      timeoutMs: attempt === 0 ? budget : Math.min(left, budget),
    });
    if (res.text) return res.text;
    if (!res.retryable) break;
    await sleep(500 * 2 ** attempt);
  }
  return null;
}

function thinkingBudget(requested?: number): number {
  const override = Number(process.env.GEMINI_THINKING_BUDGET);
  if (Number.isFinite(override) && override >= 0) return Math.round(override);
  return Math.max(0, Math.min(4096, Math.round(requested ?? 0)));
}

async function completeGemini(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<LlmResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: null, retryable: false };
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
        generationConfig: {
          temperature: opts.json ? 0.4 : 0.5,
          maxOutputTokens: Math.max(maxTokens, 4096),
          thinkingConfig: { thinkingBudget: thinkingBudget(opts.thinking) },
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    });
    const data = (await res.json()) as {
      error?: { message?: string };
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    if (!res.ok) {
      console.warn("[gemini]", res.status, data.error?.message ?? "request failed");
      return { text: null, retryable: res.status === 429 || res.status >= 500 };
    }
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    return { text: text || null, retryable: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    console.warn("[gemini]", message);
    // `aborted` — bizning timeout'imiz; qolgani tarmoq uzilishi.
    return { text: null, retryable: !/abort/i.test(message) };
  } finally {
    clearTimeout(timer);
  }
}

async function completeXai(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<LlmResult> {
  const key = process.env.XAI_API_KEY;
  if (!key) return { text: null, retryable: false };
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
      return { text: null, retryable: res.status === 429 || res.status >= 500 };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return { text: text || null, retryable: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    console.warn("[xai]", message);
    return { text: null, retryable: !/abort/i.test(message) };
  } finally {
    clearTimeout(timer);
  }
}
