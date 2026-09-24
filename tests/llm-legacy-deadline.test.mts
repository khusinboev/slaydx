import test from "node:test";
import assert from "node:assert/strict";
import { llmComplete, llmGrounded, llmStream } from "../lib/generation/llm.ts";
import { CHAIN_MIN_ATTEMPT_MS, CHAIN_SAFETY_MS, DeadlineError } from "../lib/generation/llm/chain.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { resetLimiters } from "../lib/generation/llm/limiter.ts";
import { GROUNDING_USD, JobCost, withJobCost } from "../lib/generation/job-cost.ts";

/**
 * ESKI `llm.ts` YO'LI — ish muddati va sarf (audit EXT-03, EXT-11).
 *
 * Slayd/pro-slayd, rasm, tarjima, rezyume va eski yozuvchilar
 * `llmComplete`/`llmStream`/`llmGrounded` ni chaqiradi — `llm/chain.ts`
 * dagi muddat shartnomasi ularga ham tegishli bo'lishi kerak:
 *  - muddat o'tgan → provayderga so'rov YO'Q, `DeadlineError`;
 *  - qayta urinish + kutish muddatga sig'masa → uxlamasdan `DeadlineError`;
 *  - urinish timeout'i ≤ muddatgacha qolgan vaqt;
 *  - muddatsiz — eski xatti-harakat (null, xato yo'q).
 * Sarf: ish kontekstida (`withJobCost`) token (o'ylash tokenlari chiqishga),
 * grounding birligi yoziladi; kontekstdan tashqarida hech narsa.
 * Tarmoq YO'Q — `fetch` stub.
 */

type Call = { url: string; signal?: AbortSignal };

async function withGemini(reply: (n: number) => Response | Promise<Response>, fn: (calls: Call[]) => Promise<void>) {
  resetBreakers();
  resetLimiters();
  const saved = { fetch: globalThis.fetch, g: process.env.GEMINI_API_KEY, x: process.env.XAI_API_KEY, s: process.env.LLM_STREAM };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  delete process.env.LLM_STREAM;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), signal: init?.signal ?? undefined });
    return reply(calls.length);
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [k, v] of [["GEMINI_API_KEY", saved.g], ["XAI_API_KEY", saved.x], ["LLM_STREAM", saved.s]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const okBody = (text: string, extra: Record<string, unknown> = {}) =>
  Response.json({
    candidates: [{ content: { parts: [{ text }] }, ...extra }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 60 },
  });

test("llmComplete: muddat o'tgan — so'rov yo'q, DeadlineError", async () => {
  await withGemini(
    () => okBody("bo'lmasligi kerak"),
    async (calls) => {
      await assert.rejects(llmComplete("s", "u", 100, { deadline: Date.now() - 1 }), DeadlineError);
      await assert.rejects(llmComplete("s", "u", 100, { deadline: Date.now() + CHAIN_MIN_ATTEMPT_MS }), DeadlineError, "xavfsizlik zaxirasi hisobga olinadi");
      await assert.rejects(llmStream("s", "u", 100, { deadline: Date.now() - 1, onText: () => {} }), DeadlineError, "oqim yo'li ham");
      await assert.rejects(llmGrounded("s", "u", 100, { deadline: Date.now() - 1 }), DeadlineError, "grounding yo'li ham");
      assert.equal(calls.length, 0, "provayderga so'rov ketmasligi kerak");
    },
  );
});

test("llmComplete: muddatsiz — eski xatti-harakat (javob; 4xx da null, xato yo'q)", async () => {
  await withGemini(
    (n) => (n === 1 ? okBody("salom") : Response.json({ error: { message: "bad" } }, { status: 400 })),
    async () => {
      assert.equal(await llmComplete("s", "u", 100, {}), "salom");
      assert.equal(await llmComplete("s", "u", 100, {}), null);
    },
  );
});

test("llmComplete: 503 dan keyingi kutish muddatga sig'masa — uxlamasdan DeadlineError", async () => {
  await withGemini(
    () => new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503, headers: { "retry-after": "3" } }),
    async (calls) => {
      const t0 = Date.now();
      await assert.rejects(llmComplete("s", "u", 100, { timeoutMs: 60_000, deadline: Date.now() + CHAIN_MIN_ATTEMPT_MS + CHAIN_SAFETY_MS + 2_000 }), DeadlineError);
      assert.equal(calls.length, 1, "ikkinchi urinish boshlanmasligi kerak");
      assert.ok(Date.now() - t0 < 1_000, "sig'maydigan kutish uxlanmaydi");
    },
  );
});

test("llmComplete: urinish timeout'i muddatgacha qolgan vaqt bilan cheklanadi", async () => {
  let aborted = false;
  await withGemini(
    (n) =>
      n === 1
        ? new Promise<Response>((_, reject) => {
            // Javob kelmaydi — timeout faqat muddat tufayli (8 s) otiladi, 60 s emas.
            const sig = callsRef[0]?.signal;
            sig?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("This operation was aborted", "AbortError"));
            });
          })
        : okBody("x"),
    async (calls) => {
      callsRef = calls;
      const t0 = Date.now();
      await assert.rejects(llmComplete("s", "u", 100, { timeoutMs: 60_000, deadline: Date.now() + CHAIN_MIN_ATTEMPT_MS + CHAIN_SAFETY_MS + 1_500 }), DeadlineError);
      const took = Date.now() - t0;
      assert.ok(aborted, "urinish muddat bilan abort qilinishi kerak");
      assert.ok(took < CHAIN_MIN_ATTEMPT_MS + 3_000, `urinish ${took} ms davom etdi — muddatdan oshib ketdi`);
      assert.equal(calls.length, 1);
    },
  );
});
let callsRef: Call[] = [];

test("sarf: ish kontekstida token (o'ylash chiqishga) va grounding yoziladi; kontekstsiz — hech narsa", async () => {
  await withGemini(
    () => okBody("fakt", { groundingMetadata: { webSearchQueries: ["q"], groundingChunks: [{ web: { uri: "https://a.uz/", title: "a.uz" } }] } }),
    async () => {
      const { value, cost } = await withJobCost(async () => {
        await llmComplete("s", "u", 100, {});
        await llmGrounded("s", "u", 100, {});
        return "ok";
      });
      assert.equal(value, "ok");
      const j = cost.toJson();
      assert.equal(j.inputTokens, 200);
      assert.equal(j.outputTokens, 200, "o'ylash tokenlari (60) chiqishga qo'shilishi kerak: 2 × (40 + 60)");
      assert.equal(j.calls, 3, "2 LLM + 1 grounding");
      const g = j.parts?.find((p) => p.kind === "grounding");
      assert.equal(g?.units, 1);
      assert.equal(g?.usd, GROUNDING_USD);
      assert.equal(j.provider, "gemini");
      assert.ok(j.usd > GROUNDING_USD, "LLM narxi ham qo'shilgan");

      // Kontekstdan tashqarida — yozuv yo'q (so'rov yo'li, testlar).
      const outside = new JobCost();
      await llmComplete("s", "u", 100, {});
      assert.equal(outside.calls, 0);
    },
  );
});

test("sarf: oqim (SSE) yo'li oxirgi bo'lakdagi usageMetadata ni yozadi", async () => {
  const sse = [
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Sal" }] } }] })}`,
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "om" }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2 } })}`,
    "",
  ].join("\n");
  await withGemini(
    () => new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    async () => {
      const { value, cost } = await withJobCost(() => llmStream("s", "u", 100, { onText: () => {} }));
      assert.equal(value, "Salom");
      const j = cost.toJson();
      assert.equal(j.inputTokens, 7);
      assert.equal(j.outputTokens, 5);
      assert.equal(j.calls, 1);
    },
  );
});
