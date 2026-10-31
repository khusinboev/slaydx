import test from "node:test";
import assert from "node:assert/strict";
import { complete } from "../lib/generation/llm-roles.ts";
import { parseRoleSpec, resetRoleSpecWarnings } from "../lib/generation/llm/types.ts";

/**
 * LLM ROLLARI FASADI (`llm-roles.ts complete`) — Maqola 2 / AUDIT-17, WP8.
 *
 * `globalThis.fetch` stub qilinadi (`tests/llm-stream.test.mts` naqshi) —
 * `gemini.ts` adapteri mavjud `llm.ts` HTTP yo'lidan
 * foydalanadi, shuning uchun HAQIQIY tarmoqqa chiqmasdan ham chain va
 * "env yo'q" yo'llarini bir xil darajada sinash mumkin.
 *
 * Uchta qulf:
 *  1. ENV YO'Q — standart provayderga (Gemini, `GEMINI_MODEL` yoki
 *     standart `gemini-3.7-flash`) bitta spec bilan tushadi; `usage`
 *     qaytadi (buni eski `llmComplete` bermas edi).
 *  2. ENV BOR — `LLM_<ROL>` dagi ANIQ model ishlatiladi (default
 *     `GEMINI_MODEL`dan FARQLI) — bu chain yo'lining haqiqatan
 *     ishlatilganini isbotlaydi.
 *  3. Kalit umuman yo'q — `null`.
 */

const ENV_NAMES = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "LLM_WRITER",
  "LLM_RESEARCHER",
  "LLM_JUDGE",
  "LLM_FAST",
];

type Caught = { url: string; body: string };

async function withFetchAndEnv(
  env: Record<string, string | undefined>,
  reply: (req: Caught) => unknown,
  fn: (calls: Caught[]) => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch;
  const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
  for (const n of ENV_NAMES) delete process.env[n];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const calls: Caught[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const req = { url: String(url), body: String(init?.body ?? "") };
    calls.push(req);
    return reply(req) as never;
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const n of ENV_NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

const geminiOk = (text: string, inTok = 12, outTok = 34) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok },
  }),
});

test("ENV YO'Q — standart provayderga (Gemini) bitta spec bilan, usage qaytadi", async () => {
  await withFetchAndEnv({ GEMINI_API_KEY: "g-key" }, () => geminiOk("Salom dunyo"), async (calls) => {
    const res = await complete("writer", "SYS", "USER");
    assert.equal(res?.text, "Salom dunyo");
    assert.equal(res?.usage?.provider, "gemini");
    assert.equal(res?.usage?.model, "gemini-3.7-flash", "GEMINI_MODEL standart qiymati");
    assert.deepEqual(res?.usage && { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens }, {
      inputTokens: 12,
      outputTokens: 34,
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("gemini-3.7-flash"));
  });
});

test("ENV YO'Q — GEMINI_MODEL bekor qilingan bo'lsa o'sha model ishlatiladi", async () => {
  await withFetchAndEnv({ GEMINI_API_KEY: "g-key", GEMINI_MODEL: "gemini-3.5-flash-lite" }, () => geminiOk("javob"), async (calls) => {
    const res = await complete("fast", "SYS", "USER");
    assert.equal(res?.usage?.model, "gemini-3.5-flash-lite");
    assert.ok(calls[0].url.includes("gemini-3.5-flash-lite"));
  });
});

test("ENV YO'Q — kalit umuman yo'q — null, tarmoqqa chiqmaydi", async () => {
  await withFetchAndEnv({}, () => {
    throw new Error("chaqirilmasligi kerak edi");
  }, async (calls) => {
    const res = await complete("writer", "SYS", "USER");
    assert.equal(res, null);
    assert.equal(calls.length, 0);
  });
});

test("ENV BOR (LLM_FAST) — chain yo'li ANIQ spec modelini ishlatadi (GEMINI_MODEL'dan FARQLI)", async () => {
  await withFetchAndEnv(
    { GEMINI_API_KEY: "g-key", GEMINI_MODEL: "gemini-3.7-flash", LLM_FAST: "gemini:gemini-3.1-pro" },
    () => geminiOk("maxsus model javobi"),
    async (calls) => {
      const res = await complete("fast", "SYS", "USER");
      assert.equal(res?.text, "maxsus model javobi");
      assert.equal(res?.usage?.model, "gemini-3.1-pro", "LLM_FAST dagi model ishlatilishi kerak, GEMINI_MODEL emas");
      assert.ok(calls[0].url.includes("gemini-3.1-pro"));
      assert.ok(!calls[0].url.includes("gemini-3.7-flash"));
    },
  );
});

test("ENV BOR, lekin buzuq format — parseRoleSpec [] qaytaradi, standart yo'lga tushadi", async () => {
  assert.deepEqual(parseRoleSpec("noto'g'ri-format-ikki-nuqtasiz"), []);
  await withFetchAndEnv(
    { GEMINI_API_KEY: "g-key", LLM_WRITER: "noto'g'ri-format-ikki-nuqtasiz" },
    () => geminiOk("standart yo'l"),
    async (calls) => {
      const res = await complete("writer", "SYS", "USER");
      assert.equal(res?.text, "standart yo'l");
      assert.equal(res?.usage?.model, "gemini-3.7-flash", "buzuq env — standart Gemini modeliga tushishi kerak");
      assert.equal(calls.length, 1);
    },
  );
});

test("ENV BOR — birinchi provayderning kaliti yo'q, zanjir keyingisiga o'tadi", async () => {
  // LLM_JUDGE: anthropic (kalitsiz) → gemini (kalit bor). Anthropic
  // chaqirilmasligi kerak (fetch orqali emas — SDK orqali ishlaydi, shu
  // sabab bu yerda faqat GEMINI ga fetch borishini tekshiramiz).
  await withFetchAndEnv(
    { GEMINI_API_KEY: "g-key", LLM_JUDGE: "anthropic:claude-sonnet-5,gemini:gemini-3.7-flash" },
    () => geminiOk("zaxiradan"),
    async (calls) => {
      const res = await complete("judge", "SYS", "USER");
      assert.equal(res?.text, "zaxiradan");
      assert.equal(res?.usage?.provider, "gemini");
      assert.equal(calls.length, 1, "faqat gemini'ga fetch borishi kerak (anthropic SDK orqali, kalitsiz o'tkazib yuboriladi)");
    },
  );
});

test("maxTokens/timeoutMs standart qiymatlari qo'llanadi", async () => {
  await withFetchAndEnv({ GEMINI_API_KEY: "g-key" }, () => geminiOk("ok"), async (calls) => {
    await complete("fast", "SYS", "USER");
    const body = JSON.parse(calls[0].body);
    // `maxOutputTokens` `llm.ts geminiBody`da `Math.max(maxTokens, 4096)` — standart 2048 → 4096 ga ko'tariladi.
    assert.equal(body.generationConfig.maxOutputTokens, 4096);
  });
});

/* ───────────── olib tashlangan provayderlar: qoldiq env qiymati ───────────── */

/** `log("warn", …)` JSON qatorini `console.warn` ga yozadi — shuni ushlaymiz. */
function captureWarns<T>(fn: () => T): { out: T; lines: string[] } {
  const realWarn = console.warn;
  const lines: string[] = [];
  console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    return { out: fn(), lines };
  } finally {
    console.warn = realWarn;
  }
}

test("parseRoleSpec: noma'lum provayder yozuvi o'tkazib yuboriladi, to'g'ri yozuvlar SAQLANADI (bitta ogohlantirish)", () => {
  resetRoleSpecWarnings();
  const { out, lines } = captureWarns(() => parseRoleSpec("anthropic:claude-sonnet-5,openrouter:x/y,gemini:gemini-3.7-flash"));
  assert.deepEqual(out, [
    { provider: "anthropic", model: "claude-sonnet-5" },
    { provider: "gemini", model: "gemini-3.7-flash" },
  ]);
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0]!, /"level":"warn"/);
  assert.match(lines[0]!, /openrouter/);
  // Tartib va model nomi saqlanadi, noma'lum yozuv o'rtada bo'lsa ham.
  assert.deepEqual(parseRoleSpec("xai:grok-4.3,gemini:g1,fal:m,anthropic:a1").map((r) => `${r.provider}:${r.model}`), ["gemini:g1", "anthropic:a1"]);
});

test("parseRoleSpec: har noma'lum id uchun BITTA ogohlantirish — chaqiruv sonidan va takrordan qat'i nazar", () => {
  resetRoleSpecWarnings();
  const { lines } = captureWarns(() => {
    for (let i = 0; i < 5; i++) parseRoleSpec("openrouter:a,xai:b,openrouter:c,gemini:g");
  });
  assert.equal(lines.length, 2, `openrouter va xai — har biri bir marta:\n${lines.join("\n")}`);
  assert.ok(lines.some((l) => l.includes("openrouter")) && lines.some((l) => l.includes("xai")));
  // Faqat noma'lum id bo'lsa — natija bo'sh (standart yo'l), lekin ogohlantirish baribir.
  resetRoleSpecWarnings();
  const only = captureWarns(() => parseRoleSpec("openai:gpt-5.6-luna"));
  assert.deepEqual(only.out, []);
  assert.equal(only.lines.length, 1);
});

test("parseRoleSpec: `provider:model` shakli buzuq yozuv BUTUN natijani bekor qiladi (eski qoida)", () => {
  resetRoleSpecWarnings();
  const { lines } = captureWarns(() => {
    assert.deepEqual(parseRoleSpec("gemini:g1,ikki-nuqtasiz"), []);
    assert.deepEqual(parseRoleSpec("gemini:g1,anthropic:"), [], "bo'sh model");
    assert.deepEqual(parseRoleSpec(":model,gemini:g1"), [], "bo'sh provayder");
    assert.deepEqual(parseRoleSpec("openrouter:x,buzuq"), [], "noma'lum id ham, buzuq yozuv ham — buzuq ustun");
    assert.deepEqual(parseRoleSpec("gemini:g1,openrouter:"), [], "noma'lum id + bo'sh model = buzuq");
    assert.deepEqual(parseRoleSpec("   "), []);
    assert.deepEqual(parseRoleSpec(undefined), []);
  });
  assert.deepEqual(lines, [], "buzuq spec ogohlantirish yozmaydi");
});

test("ENV qoldig'i: LLM_WRITER=openrouter:x,gemini:… — to'g'ri yozuv (model) ishlatiladi, standart modelga tushmaydi", async () => {
  resetRoleSpecWarnings();
  await withFetchAndEnv(
    { GEMINI_API_KEY: "g-key", GEMINI_MODEL: "gemini-3.7-flash", LLM_WRITER: "openrouter:x/y,gemini:gemini-3.1-pro" },
    () => geminiOk("qoldiqdan keyin"),
    async (calls) => {
      const realWarn = console.warn;
      console.warn = () => {};
      try {
        const res = await complete("writer", "SYS", "USER");
        assert.equal(res?.text, "qoldiqdan keyin");
        assert.equal(res?.usage?.model, "gemini-3.1-pro", "bitta eski yozuv butun zanjirni tashlab yubormasin");
        assert.ok(calls[0].url.includes("gemini-3.1-pro"));
        assert.equal(calls.length, 1);
      } finally {
        console.warn = realWarn;
      }
    },
  );
});
