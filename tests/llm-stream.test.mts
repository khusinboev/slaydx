import test from "node:test";
import assert from "node:assert/strict";
import { llmStream } from "../lib/generation/llm.ts";

/**
 * OQIMLI LLM CHAQIRUVI (`llmStream`) — Gemini SSE.
 *
 * Bu yerda qulflanadigan narsa to'rtta:
 *
 *  1. TRANSPORT. `streamGenerateContent?alt=sse` va tana `generateContent`
 *     bilan AYNAN bir xil bo'lsin — 4xx da oqimsiz yo'lga tushamiz va
 *     u yerda BOSHQA tana ketsa (masalan JSON rejimisiz) parse jimgina
 *     yiqilardi.
 *  2. PARSING. Bo'lak chegarasi qator chegarasi EMAS: tarmoq JSON
 *     satrining o'rtasidan uzishi mumkin, `\r\n` ham kelishi mumkin.
 *     Bufer bo'lmasa oqim JIMGINA bo'sh qaytardi — xato ham bermay.
 *  3. O'YLASH. `thought: true` qismlari javob EMAS; ular oqib chiqsa
 *     foydalanuvchi model mulohazasini o'qir, JSON esa buzilardi.
 *  4. YIQILISH — HALOKAT EMAS. Timeout, 5xx, oqimni rad etuvchi 4xx,
 *     kill-switch, xAI: hech biri throw bo'lmasin va matn baribir
 *     yetkazilsin (yoki halol `null`).
 */

/** Bitta tutilgan so'rov. */
type Caught = { url: string; body: string; method: string };

type Env = { gemini?: string; xai?: string; stream?: string };

/**
 * `globalThis.fetch` ni almashtiradi va oxirida TIKLAYDI.
 *
 * Naqsh `slide-research.test.mts` dan: kalit ham vaqtincha qo'yiladi,
 * chunki `llmProvider()` env'ni o'qiydi va kalitsiz chaqiruv umuman
 * ketmaydi — test hech narsani tekshirmagan bo'lardi. Bu yerda ustiga
 * `LLM_STREAM` kill-switch'i ham boshqariladi.
 */
async function withFetch(
  reply: (req: Caught, index: number) => unknown,
  fn: (calls: Caught[]) => Promise<void>,
  env: Env = {},
): Promise<void> {
  const realFetch = globalThis.fetch;
  const saved = {
    gemini: process.env.GEMINI_API_KEY,
    xai: process.env.XAI_API_KEY,
    stream: process.env.LLM_STREAM,
  };
  const put = (name: "GEMINI_API_KEY" | "XAI_API_KEY" | "LLM_STREAM", v: string | undefined) => {
    if (v === undefined) delete process.env[name];
    else process.env[name] = v;
  };
  put("GEMINI_API_KEY", "gemini" in env ? env.gemini : "test-key");
  put("XAI_API_KEY", env.xai);
  put("LLM_STREAM", env.stream);
  const calls: Caught[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string; method?: string }) => {
    const req = { url: String(url), body: String(init?.body ?? ""), method: init?.method ?? "GET" };
    calls.push(req);
    return reply(req, calls.length - 1) as never;
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    put("GEMINI_API_KEY", saved.gemini);
    put("XAI_API_KEY", saved.xai);
    put("LLM_STREAM", saved.stream);
  }
}

/** SSE `data:` qatori. */
const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

/** Bitta matn bo'lagi (ixtiyoriy `thought` bayrog'i bilan). */
function part(text: string, thought = false) {
  return { candidates: [{ content: { parts: [{ text, ...(thought ? { thought: true } : {}) }] } }] };
}

/**
 * Oqim tanasi — chegaralar AYNAN berilgan joyda.
 *
 * Bo'laklar ataylab qator chegarasiga mos KELMAYDI: haqiqiy TCP ham
 * shunday uzadi.
 */
function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) c.enqueue(enc.encode(chunks[i++]));
      else c.close();
    },
  });
}

/** Muvaffaqiyatli oqim javobi. */
const streamReply = (chunks: string[]) => ({
  ok: true,
  status: 200,
  body: bodyOf(chunks),
  json: async () => ({}),
});

/** Xato javobi — `res.json()` bilan (kod `error` ni o'qiydi). */
const errReply = (status: number, message = "nope") => ({
  ok: false,
  status,
  json: async () => ({ error: { message, code: status } }),
});

/** Oqimsiz `generateContent` javobi (mavjud `json:`-only stub naqshi). */
const jsonReply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

test("oqim: URL, tana va o'suvchi onText", async () => {
  // Bir nechta `data:` qatori bitta bo'lakda, bittasi esa JSON satrining
  // O'RTASIDAN uzilgan — yig'ish buferda bo'lishi shart.
  const a = sse(part("Salom "));
  const b = sse(part("dunyo"));
  const cut = Math.floor(b.length / 2);
  await withFetch(
    () => streamReply([a.slice(0, 4), a.slice(4) + b.slice(0, cut), b.slice(cut), "data: [DONE]\n\n"]),
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { json: true, onText: (t) => seen.push(t) });
      assert.equal(out, "Salom dunyo");
      assert.deepEqual(seen, ["Salom ", "Salom dunyo"], "har bo'lakda TO'PLANGAN matn");
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.includes(":streamGenerateContent"), calls[0].url);
      assert.ok(calls[0].url.includes("alt=sse"), calls[0].url);
      assert.equal(calls[0].method, "POST");
      const body = JSON.parse(calls[0].body);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.equal(body.system_instruction.parts[0].text, "S");
      assert.equal(body.contents[0].parts[0].text, "U");
      assert.ok(body.generationConfig.thinkingConfig, "thinkingConfig tanada bo'lsin");
    },
  );
});

test("oqim: `thought` qismlari javobga kirmaydi", async () => {
  await withFetch(
    () =>
      streamReply([
        sse({
          candidates: [
            { content: { parts: [{ text: "MULOHAZA", thought: true }, { text: "Javob" }] } },
          ],
        }),
        sse(part("!")),
      ]),
    async () => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, "Javob!");
      assert.ok(!seen.some((s) => s.includes("MULOHAZA")), "o'ylash oqib chiqmasin");
    },
  );
});

test("oqim: `\\r\\n` qator oxiri va bo'lak o'rtasidan uzilish", async () => {
  const line = `data: ${JSON.stringify(part("Toshkent"))}\r\n\r\n`;
  // Uzilish `\r` va `\n` ORASIDA — eng yomon holat.
  const at = line.indexOf("\r\n") + 1;
  await withFetch(
    () => streamReply([line.slice(0, at), line.slice(at)]),
    async () => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, "Toshkent");
      assert.deepEqual(seen, ["Toshkent"]);
    },
  );
});

test("oqimsiz stub (`body` yo'q) — bitta onText", async () => {
  await withFetch(
    () => jsonReply("Butun javob"),
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, "Butun javob");
      assert.deepEqual(seen, ["Butun javob"]);
      assert.equal(calls.length, 1);
    },
  );
});

test("abort (timeout) — null va QAYTA URINISH yo'q", async () => {
  await withFetch(
    () => {
      throw new Error("This operation was aborted");
    },
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, null);
      assert.equal(calls.length, 1, "timeout byudjetni yeb bo'lgan — qayta urinilmaydi");
      assert.deepEqual(seen, []);
    },
  );
});

test("503 — qayta urinish, ikkinchi urinish ham OQIM", async () => {
  await withFetch(
    (_req, i) => (i === 0 ? errReply(503) : streamReply([sse(part("Ikkinchi"))])),
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, "Ikkinchi");
      assert.equal(calls.length, 2);
      assert.ok(calls[1].url.includes(":streamGenerateContent"));
      assert.deepEqual(seen, ["Ikkinchi"]);
    },
  );
});

test("oqim ichidagi 500 xatosi — qayta urinish `partial` BOSHIDAN", async () => {
  await withFetch(
    (_req, i) =>
      i === 0
        ? streamReply([sse(part("Yarim")), sse({ error: { message: "uzildi", code: 500 } })])
        : streamReply([sse(part("Yarim")), sse(part(" to'liq"))]),
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, "Yarim to'liq");
      assert.equal(calls.length, 2);
      // Ikkinchi urinish BOSHIDAN oqadi — `onText` monoton EMAS.
      assert.deepEqual(seen, ["Yarim", "Yarim", "Yarim to'liq"]);
    },
  );
});

test("400 — SHU urinishda `generateContent` ga tushadi, tana bir xil", async () => {
  await withFetch(
    (_req, i) => (i === 0 ? errReply(400, "stream endpoint rad etdi") : jsonReply("Zaxira matn")),
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { json: true, onText: (t) => seen.push(t) });
      assert.equal(out, "Zaxira matn");
      assert.equal(calls.length, 2, "4xx da qayta urinilmaydi — darhol zaxira");
      assert.ok(calls[1].url.includes(":generateContent"), calls[1].url);
      assert.ok(!calls[1].url.includes("alt=sse"));
      assert.equal(calls[0].body, calls[1].body, "oqimli va oqimsiz TANA aynan bir xil");
      assert.deepEqual(seen, ["Zaxira matn"]);
    },
  );
});

test("`promptFeedback.blockReason` — null, qayta urinishsiz", async () => {
  await withFetch(
    () => streamReply([sse({ promptFeedback: { blockReason: "SAFETY" } })]),
    async (calls) => {
      const out = await llmStream("S", "U", 1200, { onText: () => {} });
      assert.equal(out, null);
      assert.equal(calls.length, 1);
    },
  );
});

test("LLM_STREAM=false — kill-switch, oqimsiz yo'l", async () => {
  await withFetch(
    () => jsonReply("Oqimsiz"),
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, "Oqimsiz");
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.includes(":generateContent"));
      assert.ok(!calls[0].url.includes("streamGenerateContent"), calls[0].url);
      assert.deepEqual(seen, ["Oqimsiz"]);
    },
    { stream: "false" },
  );
});

test("xAI — oqim yo'q, bitta to'liq onText", async () => {
  await withFetch(
    () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Grok javobi" } }] }),
    }),
    async (calls) => {
      const seen: string[] = [];
      const out = await llmStream("S", "U", 1200, { onText: (t) => seen.push(t) });
      assert.equal(out, "Grok javobi");
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.includes("chat/completions"), calls[0].url);
      assert.deepEqual(seen, ["Grok javobi"]);
    },
    { gemini: undefined, xai: "xai-key" },
  );
});

test("kalitsiz — tarmoqqa umuman chiqmaydi", async () => {
  await withFetch(
    () => {
      throw new Error("chaqirilmasligi kerak edi");
    },
    async (calls) => {
      const out = await llmStream("S", "U", 1200, { onText: () => {} });
      assert.equal(out, null);
      assert.equal(calls.length, 0);
    },
    { gemini: undefined },
  );
});

test("grounding + JSON qulfi oqimda ham ishlaydi", async () => {
  await withFetch(
    () => streamReply([]),
    async (calls) => {
      await assert.rejects(
        () => llmStream("S", "U", 1200, { grounding: true, json: true, onText: () => {} }),
        /grounding/,
      );
      assert.equal(calls.length, 0);
    },
  );
});
