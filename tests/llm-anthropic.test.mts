import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { makeAnthropicAdapter } from "../lib/generation/llm/anthropic.ts";

/**
 * ANTHROPIC ADAPTERI (`llm/anthropic.ts`) — Maqola 2 / AUDIT-17, WP8.
 *
 * SDK `deps.client` orqali STUB qilinadi — tarmoqqa chiqmasdan. To'rtta
 * qulf:
 *  1. SO'ROV SHAKLI — `thinking:{type:"adaptive"}`, `budget_tokens` YO'Q
 *     (Claude 5 avlodi buni 400 bilan rad etadi — jonli tasdiqlangan).
 *  2. Oylik sarf chegarasi (`enforced_spend_limit_reached`) — `RateLimitError`
 *     bo'lsa ham `retryable:false` (soniyalarda tiklanmaydi).
 *  3. Oddiy 429 — `retryable:true` (qayta urinishga arziydi).
 *  4. `stop_reason:"refusal"` — `ok:false, retryable:false`.
 */

const OPTS = { maxTokens: 1000, timeoutMs: 5000 };

function textMessage(text: string, over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
      output_tokens_details: null,
    },
    ...over,
  } as Anthropic.Message;
}

test("so'rov shakli: thinking:{type:'adaptive'}, budget_tokens YO'Q, max_tokens/system/model bor", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    messages: {
      create: async (body: Record<string, unknown>) => {
        captured = body;
        return textMessage("Salom");
      },
    },
  } as unknown as Pick<Anthropic, "messages">;

  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "SYS", "USER", { ...OPTS, json: false });

  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.text, "Salom");
    assert.deepEqual(res.usage, { inputTokens: 100, outputTokens: 40 });
  }
  assert.equal(captured?.model, "claude-sonnet-5");
  assert.equal(captured?.max_tokens, 1000);
  assert.equal(captured?.system, "SYS");
  assert.deepEqual(captured?.messages, [{ role: "user", content: "USER" }]);
  assert.deepEqual(captured?.thinking, { type: "adaptive" }, "MUTATSIYA: budget_tokens qo'shilsa bu qizarishi kerak");
  assert.ok(!("budget_tokens" in (captured?.thinking as object)), "budget_tokens Claude 5 avlodida 400 qaytaradi");
});

test("json:true — promptga «faqat JSON» ko'rsatmasi qo'shiladi, sxema YO'Q", async () => {
  let captured: Record<string, unknown> | undefined;
  const client = {
    messages: {
      create: async (body: Record<string, unknown>) => {
        captured = body;
        return textMessage('{"ok":true}');
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  await adapter.complete("claude-sonnet-5", "SYS", "USER", { ...OPTS, json: true });
  assert.ok(String(captured?.system).includes("SYS"));
  assert.match(String(captured?.system), /JSON/i);
  assert.equal(captured?.output_config, undefined, "sxemasiz — output_config yuborilmaydi");
});

test("oylik sarf chegarasi (enforced_spend_limit_reached) — retryable:false", async () => {
  const client = {
    messages: {
      create: async () => {
        throw new Anthropic.RateLimitError(
          429,
          { message: "enforced_spend_limit_reached: organization monthly spend limit reached" },
          undefined,
          new Headers(),
          "rate_limit_error",
        );
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.retryable, false, "MUTATSIYA: bu true bo'lib qolsa, chain foydasiz qayta uradi");
    assert.equal(res.status, 429);
    assert.match(res.error, /enforced_spend_limit_reached/);
  }
});

test("oddiy 429 (sarf chegarasisiz) — retryable:true", async () => {
  const client = {
    messages: {
      create: async () => {
        throw new Anthropic.RateLimitError(429, { message: "rate limited, slow down" }, undefined, new Headers(), "rate_limit_error");
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.retryable, true);
});

test("Retry-After sarlavhasi — retryAfterMs ga o'tkaziladi", async () => {
  const client = {
    messages: {
      create: async () => {
        throw new Anthropic.RateLimitError(429, { message: "slow down" }, undefined, new Headers({ "retry-after": "3" }), "rate_limit_error");
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.retryAfterMs, 3000);
});

test("5xx — retryable:true", async () => {
  const client = {
    messages: {
      create: async () => {
        throw new Anthropic.InternalServerError(500, { message: "overloaded" }, undefined, new Headers(), "api_error");
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.retryable, true);
});

test("400 (BadRequestError) — retryable:false", async () => {
  const client = {
    messages: {
      create: async () => {
        throw new Anthropic.BadRequestError(400, { message: "invalid model" }, undefined, new Headers(), "invalid_request_error");
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.retryable, false);
    assert.equal(res.status, 400);
  }
});

test("timeout (APIConnectionTimeoutError) — xabarda 'timed out', retryable:true", async () => {
  const client = {
    messages: {
      create: async () => {
        throw new Anthropic.APIConnectionTimeoutError();
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.match(res.error, /timed out/i, "chain.ts bu xabardan timeout'ni taniydi");
    assert.equal(res.retryable, true);
  }
});

test("stop_reason:'refusal' — ok:false, retryable:false", async () => {
  const client = {
    messages: {
      create: async () =>
        textMessage("", {
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "cyber", explanation: null },
          content: [],
        }),
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.retryable, false);
    assert.match(res.error, /refusal/);
  }
});

test("bo'sh matn javob — ok:false, retryable:false", async () => {
  const client = {
    messages: { create: async () => textMessage("", { content: [] }) },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  const res = await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.retryable, false);
});

test("kalitsiz — `new Anthropic()` chaqirilmaydi (deps.client stub ishlatiladi)", async () => {
  // Bu sinov `deps.client` bo'lmasa nima bo'lishini emas, balki `deps.client`
  // BERILGANDA haqiqiy SDK konstruktoriga umuman murojaat qilinmasligini
  // tasdiqlaydi — ya'ni test tarmoqqa chiqmaydi.
  let called = 0;
  const client = {
    messages: {
      create: async () => {
        called++;
        return textMessage("ok");
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  const adapter = makeAnthropicAdapter({ client });
  await adapter.complete("claude-sonnet-5", "S", "U", OPTS);
  assert.equal(called, 1);
});
