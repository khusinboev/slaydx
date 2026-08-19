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
    return process.env.GEMINI_MODEL || "gemini-3.5-flash";
  }
  return process.env.XAI_MODEL || "grok-4.3";
}

export type LlmOpts = {
  json?: boolean;
  timeoutMs?: number;
};

export async function llmComplete(
  system: string,
  user: string,
  maxTokens = 1200,
  opts: LlmOpts = {},
): Promise<string | null> {
  const provider = llmProvider();
  if (provider === "gemini") return completeGemini(system, user, maxTokens, opts);
  if (provider === "xai") return completeXai(system, user, maxTokens, opts);
  return null;
}

async function completeGemini(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
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
          thinkingConfig: { thinkingBudget: 0 },
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
      return null;
    }
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    return text || null;
  } catch (e) {
    console.warn("[gemini]", e instanceof Error ? e.message : "network error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function completeXai(
  system: string,
  user: string,
  maxTokens: number,
  opts: LlmOpts,
): Promise<string | null> {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
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
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
