import test from "node:test";
import assert from "node:assert/strict";
import { llmComplete, llmStream } from "../lib/generation/llm.ts";
import { CostMeter, complete } from "../lib/generation/llm-roles.ts";
import { CHAIN_MIN_ATTEMPT_MS, CHAIN_SAFETY_MS, DeadlineError, completeWithChain } from "../lib/generation/llm/chain.ts";
import { CircuitBreaker, allowOrWait, resetBreakers } from "../lib/generation/llm/breaker.ts";
import { resetLimiters } from "../lib/generation/llm/limiter.ts";
import {
  STRICT_JSON_REMINDER,
  biggerMaxTokens,
  checkJson,
  classifyFailure,
  describeLastFailure,
  errorWithCause,
  failureCounters,
  resetFailureCounters,
} from "../lib/generation/llm/failure.ts";
import { JobCost, withJobCost } from "../lib/generation/job-cost.ts";
import { serializeError, withLogContext } from "../lib/server/log.ts";
import type { Attempt, ProviderAdapter, RoleSpec } from "../lib/generation/llm/types.ts";

/**
 * LLM nosozliklari (prod 2026-10-10): kuzatuvchanlik + chidamlilik.
 *
 *  1. `classifyFailure` jadvali — har tur.
 *  2. Har muvaffaqiyatsiz urinish = BITTA tuzilmali `warn` qator (kontekst: jobId/toolId),
 *     prompt/foydalanuvchi matni HECH QACHON yozilmaydi, xabar 200 belgiga qisqartiriladi.
 *  3. Qayta urinish matritsasi (soxta Gemini `fetch`): 5xx→ok, 429→ok, bo'sh→ok,
 *     yaroqsiz JSON→qat'iy eslatma→ok, kesilgan→kattaroq token→ok, xavfsizlik→qayta urinish YO'Q.
 *  4. Muddat qayta urinishlarni cheklaydi; har pullik urinish sarfga yoziladi (JobCost + CostMeter).
 *  5. Zanjir (soxta adapter): bo'sh javob qayta uriladi; timeout — faqat oxirgi specda va muddat bilan.
 */

/* ───────────────────────── yordamchilar ───────────────────────── */

const SECRET_PROMPT = "TOP-SECRET-PROMPT-XYZ-9731";

type Req = { system: string; user: string; maxOutputTokens: number };

async function withGemini(
  replies: (Response | (() => Response))[],
  fn: (reqs: Req[], logs: string[]) => Promise<void>,
): Promise<void> {
  resetBreakers();
  resetLimiters();
  resetFailureCounters();
  const saved = {
    fetch: globalThis.fetch,
    warn: console.warn,
    log: console.log,
    g: process.env.GEMINI_API_KEY,
    x: process.env.XAI_API_KEY,
    w: process.env.LLM_WRITER,
    s: process.env.LLM_STREAM,
  };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  delete process.env.LLM_WRITER;
  delete process.env.LLM_STREAM;
  const reqs: Req[] = [];
  const logs: string[] = [];
  console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    reqs.push({
      system: body.system_instruction?.parts?.[0]?.text ?? "",
      user: body.contents?.[0]?.parts?.[0]?.text ?? "",
      maxOutputTokens: body.generationConfig?.maxOutputTokens ?? 0,
    });
    const r = replies[Math.min(reqs.length - 1, replies.length - 1)];
    return typeof r === "function" ? r() : r.clone();
  }) as typeof fetch;
  try {
    await fn(reqs, logs);
  } finally {
    globalThis.fetch = saved.fetch;
    console.warn = saved.warn;
    console.log = saved.log;
    for (const [k, v] of [
      ["GEMINI_API_KEY", saved.g],
      ["XAI_API_KEY", saved.x],
      ["LLM_WRITER", saved.w],
      ["LLM_STREAM", saved.s],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const USAGE = { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 0 };
const ok = (text: string, finishReason = "STOP") =>
  Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: USAGE });
const empty = () => Response.json({ candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0, thoughtsTokenCount: 30 } });
const http = (status: number, message = "nope", headers: Record<string, string> = {}) =>
  Response.json({ error: { message, code: status } }, { status, headers });

function failureLines(logs: string[]): Record<string, unknown>[] {
  return logs
    .filter((l) => l.startsWith("{") && l.includes("[llm] attempt failed"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/* ───────────────────────── 1. tasnif jadvali ───────────────────────── */

test("classifyFailure: har tur uchun jadval", () => {
  const rows: [Parameters<typeof classifyFailure>[0], string][] = [
    [{ status: 503, message: "overloaded" }, "http"],
    [{ status: 429 }, "http"],
    [{ status: 400, message: "bad" }, "http"],
    [{ message: "This operation was aborted" }, "timeout"],
    [{ message: "request timed out" }, "timeout"],
    [{ timedOut: true }, "timeout"],
    [{ message: "fetch failed (ECONNRESET)" }, "network"],
    [{ message: "getaddrinfo ENOTFOUND x (EAI_AGAIN)" }, "network"],
    [{ message: "connect ETIMEDOUT 1.2.3.4:443" }, "network"], // ETIMEDOUT — tarmoq, timeout EMAS
    [{ empty: true }, "empty"],
    [{ badJson: true }, "bad_json"],
    [{ truncated: true }, "truncated"],
    [{ safety: true }, "safety"],
    [{ message: "something odd" }, "other"],
    [{}, "other"],
    // bayroq matndan ustun
    [{ safety: true, status: 400 }, "safety"],
    [{ empty: true, message: "aborted" }, "empty"],
  ];
  for (const [input, want] of rows) assert.equal(classifyFailure(input), want, JSON.stringify(input));
});

test("checkJson: to'liq / kesilgan / yaroqsiz", () => {
  assert.equal(checkJson('{"a":1}'), "ok");
  assert.equal(checkJson('```json\n{"a":1}\n```'), "ok");
  assert.equal(checkJson('{"a":"b","c":"d', "STOP"), "ok", "yumshoq tiklash mumkin va provayder token chegarasiga urilmagan");
  assert.equal(checkJson('{"a":"b', "STOP"), "bad_json", "tiklangandan keyin bo'sh obyekt — foydali narsa yo'q");
  assert.equal(checkJson('{"a":"b","c":"d', "MAX_TOKENS"), "truncated");
  assert.equal(checkJson("kechirasiz, bajara olmayman"), "bad_json");
  assert.equal(checkJson("kechirasiz", "MAX_TOKENS"), "truncated");
  assert.equal(biggerMaxTokens(5000), 8000);
  assert.equal(biggerMaxTokens(14000), 16000, "yuqori chegara bor");
});

/* ───────────────────────── 2. jurnal shakli ───────────────────────── */

test("jurnal: BITTA tuzilmali qator, kontekst (jobId/toolId), prompt yo'q, xabar 200 belgi", async () => {
  const long = "x".repeat(500);
  await withGemini([http(503, long), ok('{"a":1}')], async (_reqs, logs) => {
    const out = await withLogContext({ jobId: "job-1", toolId: "slide" }, () =>
      llmComplete("S", `foydalanuvchi: ${SECRET_PROMPT}`, 500, { json: true }),
    );
    assert.equal(out, '{"a":1}');
    const lines = failureLines(logs);
    assert.equal(lines.length, 1, `bitta muvaffaqiyatsiz urinish — bitta qator: ${JSON.stringify(lines)}`);
    const l = lines[0];
    assert.equal(l.level, "warn");
    assert.equal(l.provider, "gemini");
    assert.equal(l.model, "gemini-3.7-flash");
    assert.equal(l.kind, "http");
    assert.equal(l.status, 503);
    assert.equal(l.attempt, 1);
    assert.equal(l.retryable, true);
    assert.equal(l.role, "complete");
    assert.equal(l.jobId, "job-1");
    assert.equal(l.toolId, "slide");
    assert.equal(typeof l.durationMs, "number");
    assert.ok(String(l.error).length <= 201, `xabar qisqartirilgan: ${String(l.error).length}`);
    assert.ok(!logs.join("\n").includes(SECRET_PROMPT), "prompt matni hech qaysi jurnal qatorida bo'lmasligi kerak");
    assert.ok(!logs.join("\n").includes("test-key"), "kalit yo'q");
    assert.deepEqual(failureCounters(), [{ provider: "gemini", kind: "http", count: 1 }]);
  });
});

test("jurnal: bo'sh javob — kind=empty, finishReason va token soni bilan", async () => {
  await withGemini([empty(), ok('{"a":1}')], async (_reqs, logs) => {
    await llmComplete("S", "U", 500, { json: true });
    const [l] = failureLines(logs);
    assert.equal(l.kind, "empty");
    assert.equal(l.finishReason, "STOP");
    assert.equal(l.inputTokens, 100);
    assert.equal(l.outputTokens, 30);
  });
});

test("xato `cause`: foydalanuvchi matni o'zgarmaydi, ishchi qatori sababni ko'radi", async () => {
  await withGemini([http(500, "boom")], async () => {
    // Hamma urinish yiqiladi (qayta urinishlar tugaydi) → null.
    const out = await withLogContext({ jobId: "j" }, () => llmComplete("S", "U", 500, {}));
    assert.equal(out, null);
    const e = errorWithCause("Taqdimot matni yozilmadi. Kredit qaytariladi — qayta urinib ko‘ring.");
    assert.equal(e.message, "Taqdimot matni yozilmadi. Kredit qaytariladi — qayta urinib ko‘ring.");
    assert.match(String((e.cause as Error).message), /kind=http status=500/);
    const ser = serializeError(e);
    assert.match(String((ser.cause as { message: string }).message), /kind=http status=500/, "ishchining `failed` qatori sababni chop etadi");
  });
  resetFailureCounters();
  assert.equal(describeLastFailure(), undefined);
  assert.equal(errorWithCause("x").cause, undefined, "sabab yo'q bo'lsa — oddiy xato");
});

/* ───────────────────────── 3. qayta urinish matritsasi ───────────────────────── */

test("qayta urinish: 5xx → ok", async () => {
  await withGemini([http(503), ok("javob")], async (reqs) => {
    assert.equal(await llmComplete("S", "U", 500, {}), "javob");
    assert.equal(reqs.length, 2);
  });
});

test("qayta urinish: 429 (Retry-After: 0) → ok", async () => {
  await withGemini([http(429, "quota", { "retry-after": "0" }), ok("javob")], async (reqs) => {
    assert.equal(await llmComplete("S", "U", 500, {}), "javob");
    assert.equal(reqs.length, 2);
  });
});

test("qayta urinish: bo'sh kandidat → ok (ilgari jimgina null)", async () => {
  await withGemini([empty(), ok("javob")], async (reqs) => {
    assert.equal(await llmComplete("S", "U", 500, {}), "javob");
    assert.equal(reqs.length, 2);
  });
});

test("qayta urinish: bo'sh kandidat har safar → 3 urinishdan keyin null (chegaralangan)", async () => {
  await withGemini([empty()], async (reqs) => {
    assert.equal(await llmComplete("S", "U", 500, {}), null);
    assert.equal(reqs.length, 3);
  });
});

test("qayta urinish: yaroqsiz JSON → qat'iy eslatma bilan BITTA qayta urinish → ok", async () => {
  await withGemini([ok("kechirasiz, bajara olmayman"), ok('{"a":1}')], async (reqs, logs) => {
    assert.equal(await llmComplete("SYS", "U", 500, { json: true }), '{"a":1}');
    assert.equal(reqs.length, 2);
    assert.ok(!reqs[0].system.includes(STRICT_JSON_REMINDER.trim()));
    assert.ok(reqs[1].system.startsWith("SYS") && reqs[1].system.includes(STRICT_JSON_REMINDER.trim()), "ikkinchi so'rov qat'iy eslatma bilan");
    assert.equal(reqs[1].maxOutputTokens, reqs[0].maxOutputTokens, "yaroqsiz JSON — token chegarasi o'zgarmaydi");
    assert.equal(failureLines(logs)[0]?.kind, "bad_json");
  });
});

test("qayta urinish: yaroqsiz JSON ikki marta → ortiq urinish YO'Q (jami 2 so'rov)", async () => {
  await withGemini([ok("yo'q")], async (reqs) => {
    await llmComplete("S", "U", 500, { json: true });
    assert.equal(reqs.length, 2);
  });
});

test("qayta urinish: kesilgan JSON (MAX_TOKENS) → kattaroq maxOutputTokens → ok", async () => {
  await withGemini([ok('{"a":"b', "MAX_TOKENS"), ok('{"a":"bcd"}')], async (reqs, logs) => {
    assert.equal(await llmComplete("S", "U", 5000, { json: true }), '{"a":"bcd"}');
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0].maxOutputTokens, 5000);
    assert.equal(reqs[1].maxOutputTokens, 8000, "bir yarim barobar, chegaralangan");
    assert.ok(reqs[1].system.includes(STRICT_JSON_REMINDER.trim()));
    const l = failureLines(logs)[0];
    assert.equal(l?.kind, "truncated");
    assert.equal(l?.finishReason, "MAX_TOKENS");
  });
});

test("qayta urinish: kesilgan, qayta urinish ham yaroqsiz → birinchi (tiklanadigan) javob saqlanadi", async () => {
  await withGemini([ok('{"a":"b', "MAX_TOKENS"), http(400, "bad")], async (reqs) => {
    assert.equal(await llmComplete("S", "U", 5000, { json: true }), '{"a":"b', "yaxshiroq javob yo'qolmaydi");
    assert.equal(reqs.length, 2);
  });
});

test("xavfsizlik bloki: qayta urinish YO'Q, kind=safety", async () => {
  await withGemini([Response.json({ promptFeedback: { blockReason: "SAFETY" } })], async (reqs, logs) => {
    assert.equal(await llmComplete("S", "U", 500, { json: true }), null);
    assert.equal(reqs.length, 1);
    assert.equal(failureLines(logs)[0]?.kind, "safety");
  });
  await withGemini([Response.json({ candidates: [{ finishReason: "SAFETY" }] })], async (reqs) => {
    assert.equal(await llmComplete("S", "U", 500, {}), null);
    assert.equal(reqs.length, 1, "finishReason=SAFETY ham qayta urinilmaydi");
  });
});

test("4xx (429 dan tashqari): qayta urinish YO'Q", async () => {
  await withGemini([http(400, "bad request")], async (reqs, logs) => {
    assert.equal(await llmComplete("S", "U", 500, {}), null);
    assert.equal(reqs.length, 1);
    const l = failureLines(logs)[0];
    assert.equal(l.kind, "http");
    assert.equal(l.retryable, false);
  });
});

test("oqim yo'li ham: bo'sh → ok va yaroqsiz JSON → qayta urinish", async () => {
  const sse = (text: string, finish = "STOP") =>
    new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: finish }], usageMetadata: USAGE })}\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  await withGemini([sse("") , sse('{"a":1}')], async (reqs, logs) => {
    const out = await llmStream("S", "U", 500, { json: true, onText: () => {} });
    assert.equal(out, '{"a":1}');
    assert.equal(reqs.length, 2);
    assert.equal(failureLines(logs)[0]?.kind, "empty");
  });
});

/* ───────────────────────── 4. muddat va sarf ───────────────────────── */

test("muddat: kutish muddatga sig'masa — uxlamasdan DeadlineError, ortiqcha so'rov yo'q", async () => {
  await withGemini([http(503, "x", { "retry-after": "3" })], async (reqs) => {
    const deadline = Date.now() + CHAIN_MIN_ATTEMPT_MS + CHAIN_SAFETY_MS + 200;
    await assert.rejects(llmComplete("S", "U", 500, { deadline }), DeadlineError);
    assert.equal(reqs.length, 1);
  });
});

test("muddat: JSON qayta urinishi muddat yetmasa BOSHLANMAYDI (birinchi javob qaytadi)", async () => {
  await withGemini([ok("yaroqsiz")], async (reqs) => {
    const deadline = Date.now() + 9_000; // JSON qayta urinishi uchun kamida 12 s kerak
    assert.equal(await llmComplete("S", "U", 500, { json: true, deadline }), "yaroqsiz");
    assert.equal(reqs.length, 1);
  });
});

test("sarf: har pullik urinish ish hisoblagichiga yoziladi (bo'sh javob tokenlari ham)", async () => {
  await withGemini([empty(), ok('{"a":1}')], async () => {
    const { cost } = await withJobCost(async () => llmComplete("S", "U", 500, { json: true }));
    const j = (cost as JobCost).toJson();
    assert.equal(j.calls, 2, "bo'sh urinish + muvaffaqiyatli urinish");
    assert.equal(j.inputTokens, 200);
    assert.equal(j.outputTokens, 70, "40 + bo'sh urinishning 30 o'ylash tokeni");
  });
  await withGemini([ok("yaroqsiz"), ok('{"a":1}')], async () => {
    const { cost } = await withJobCost(async () => llmComplete("S", "U", 500, { json: true }));
    assert.equal((cost as JobCost).toJson().calls, 2, "JSON qayta urinishi ham hisobda");
  });
});

test("complete(): JSON qayta urinishida CostMeter ikkala pullik urinishni ham sanaydi", async () => {
  await withGemini([ok("yaroqsiz"), ok('{"a":1}')], async (reqs) => {
    const meter = new CostMeter();
    const { value, cost } = await withJobCost(async () => {
      const r = await complete("writer", "SYS", "U", { json: true, maxTokens: 500, timeoutMs: 5_000 });
      meter.add(r?.usage);
      return r;
    });
    assert.equal(value?.text, '{"a":1}');
    assert.equal(reqs.length, 2);
    const m = meter.toJson();
    assert.equal(m.calls, 2, "CostMeter: ikkala urinish");
    assert.equal(m.inputTokens, 200);
    assert.equal((cost as JobCost).toJson().calls, 2, "ish hisoblagichi: ikkala urinish, ikki marta sanalmaydi");
  });
});

test("complete(): barcha urinishlar yiqilsa — null (ishchi pulni qaytaradi) va sabab saqlanadi", async () => {
  await withGemini([http(503, "overloaded")], async (reqs) => {
    const r = await complete("writer", "S", "U", { json: true, maxTokens: 500, timeoutMs: 5_000 });
    assert.equal(r, null);
    assert.ok(reqs.length >= 2 && reqs.length <= 3, `chegaralangan: ${reqs.length}`);
    assert.match(describeLastFailure() ?? "", /kind=http status=503/);
  });
});

/* ───────────────────────── 5. zanjir (soxta adapter) ───────────────────────── */

const SPEC: RoleSpec[] = [{ provider: "gemini", model: "m1" }];
const TWO: RoleSpec[] = [
  { provider: "gemini", model: "m1" },
  { provider: "openrouter", model: "m2" },
];

function fake(id: ProviderAdapter["id"], replies: Attempt[]): { adapter: ProviderAdapter; calls: number[] } {
  const calls: number[] = [];
  let i = 0;
  return {
    calls,
    adapter: {
      id,
      async complete() {
        calls.push(Date.now());
        return replies[Math.min(i++, replies.length - 1)];
      },
    },
  };
}

async function withChainEnv(fn: () => Promise<void>) {
  resetFailureCounters();
  const saved = { g: process.env.GEMINI_API_KEY, o: process.env.OPENROUTER_API_KEY, warn: console.warn };
  process.env.GEMINI_API_KEY = "k";
  process.env.OPENROUTER_API_KEY = "k";
  console.warn = () => {};
  try {
    await fn();
  } finally {
    console.warn = saved.warn;
    if (saved.g === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.g;
    if (saved.o === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.o;
  }
}

const OKA: Attempt = { ok: true, text: "javob", usage: { inputTokens: 1, outputTokens: 1 } };
const OPTS = { maxTokens: 500, timeoutMs: 5_000 };
const DEPS = (adapters: Record<string, ProviderAdapter>) => ({
  adapters: adapters as never,
  random: () => 0,
  breakerFor: () => new CircuitBreaker("t", { log: () => {} }),
});

test("zanjir: bo'sh javob (kind=empty, retryable) qayta uriladi → ok", async () => {
  await withChainEnv(async () => {
    const a = fake("gemini", [{ ok: false, error: "bo'sh javob", retryable: true, kind: "empty" }, OKA]);
    const res = await completeWithChain("writer", SPEC, "s", "u", OPTS, DEPS({ gemini: a.adapter }));
    assert.equal(res?.text, "javob");
    assert.equal(a.calls.length, 2);
  });
});

test("zanjir: xavfsizlik (retryable:false, kind=safety) — qayta urinish yo'q", async () => {
  await withChainEnv(async () => {
    const a = fake("gemini", [{ ok: false, error: "blocked", retryable: false, kind: "safety" }]);
    assert.equal(await completeWithChain("writer", SPEC, "s", "u", OPTS, DEPS({ gemini: a.adapter })), null);
    assert.equal(a.calls.length, 1);
    assert.deepEqual(failureCounters(), [{ provider: "gemini", kind: "safety", count: 1 }]);
  });
});

test("zanjir: timeout — oxirgi specda va muddat bilan BITTA qayta urinish; muddatsiz yoki zaxira bor bo'lsa yo'q", async () => {
  const TO: Attempt = { ok: false, error: "This operation was aborted", retryable: false };
  await withChainEnv(async () => {
    const a = fake("gemini", [TO, OKA]);
    const res = await completeWithChain("writer", SPEC, "s", "u", { ...OPTS, deadline: Date.now() + 120_000 }, DEPS({ gemini: a.adapter }));
    assert.equal(res?.text, "javob", "muddat bor — timeout'dan keyin qayta urinildi");
    assert.equal(a.calls.length, 2);

    const b = fake("gemini", [TO, OKA]);
    assert.equal(await completeWithChain("writer", SPEC, "s", "u", OPTS, DEPS({ gemini: b.adapter })), null, "muddatsiz — eski qoida");
    assert.equal(b.calls.length, 1);

    const c = fake("gemini", [TO, OKA]);
    const d = fake("openrouter", [OKA]);
    const res2 = await completeWithChain("writer", TWO, "s", "u", { ...OPTS, deadline: Date.now() + 120_000 }, DEPS({ gemini: c.adapter, openrouter: d.adapter }));
    assert.equal(res2?.text, "javob");
    assert.equal(c.calls.length, 1, "zaxira spec bor — sekin provayder qayta urinilmaydi");
    assert.equal(d.calls.length, 1);

    const e = fake("gemini", [TO]);
    assert.equal(await completeWithChain("writer", SPEC, "s", "u", { ...OPTS, deadline: Date.now() + 120_000 }, DEPS({ gemini: e.adapter })), null);
    assert.equal(e.calls.length, 2, "timeout qayta urinishi BITTA bilan cheklangan");
  });
});

test("zanjir: muvaffaqiyatsiz, lekin pullik urinish sarfi ish hisoblagichiga yoziladi", async () => {
  await withChainEnv(async () => {
    const a = fake("gemini", [{ ok: false, error: "bo'sh javob", retryable: true, kind: "empty", usage: { inputTokens: 50, outputTokens: 70 } }, OKA]);
    const { cost } = await withJobCost(async () => completeWithChain("writer", SPEC, "s", "u", OPTS, DEPS({ gemini: a.adapter })));
    assert.equal((cost as JobCost).toJson().inputTokens, 50, "bo'sh urinish tokenlari hisobda (zanjir faqat muvaffaqiyatli javob usage'ini qaytaradi)");
  });
});

/* ───────────────────────── 6. saqlagich: qisqa sovishni kutish ───────────────────────── */

test("allowOrWait: qisqa sovish kutiladi, uzun sovish kutilmaydi", async () => {
  const b = new CircuitBreaker("x", { threshold: 1, cooldownMs: 60, log: () => {} });
  b.failure();
  assert.equal(b.allow(), false);
  const t0 = Date.now();
  assert.equal(await allowOrWait(b, 2_000, () => 0), true, "sovishdan keyin sinov o'tdi");
  assert.ok(Date.now() - t0 >= 40, "haqiqatan kutildi");

  const long = new CircuitBreaker("y", { threshold: 1, cooldownMs: 60_000, log: () => {} });
  long.failure();
  const t1 = Date.now();
  assert.equal(await allowOrWait(long, 1_000, () => 0), false);
  assert.ok(Date.now() - t1 < 200, "uzun sovish kutilmaydi");
});

test("breaker ochiq + ish muddati: qisqa sovishdan keyin chaqiruv o'tadi (barcha ishlar bir zumda yiqilmaydi)", async () => {
  await withGemini([ok("javob")], async (reqs) => {
    const { breakerFor } = await import("../lib/generation/llm/breaker.ts");
    const b = breakerFor("gemini", { threshold: 1, cooldownMs: 80, log: () => {} });
    b.failure();
    assert.equal(b.allow(), false);
    assert.equal(await llmComplete("S", "U", 500, { deadline: Date.now() + 120_000 }), "javob");
    assert.equal(reqs.length, 1);
  });
  await withGemini([ok("javob")], async (reqs, logs) => {
    const { breakerFor } = await import("../lib/generation/llm/breaker.ts");
    breakerFor("gemini", { threshold: 1, cooldownMs: 80, log: () => {} }).failure();
    assert.equal(await llmComplete("S", "U", 500, {}), null, "muddatsiz — eski xatti-harakat: kutmaydi");
    assert.equal(reqs.length, 0);
    const l = failureLines(logs)[0];
    assert.equal(l?.kind, "other");
    assert.match(String(l?.error), /circuit breaker open/);
  });
});
