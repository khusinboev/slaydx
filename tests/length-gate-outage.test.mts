import test from "node:test";
import assert from "node:assert/strict";

/**
 * Length gate vs. provider outage (prod 2026-11-13).
 *
 * Gemini answered 402 «prepayment credits are depleted» for ten minutes. A mustaqil ish kept its skeleton (~1 page) and
 * the length gate told the user «Matn hajmi yetarli chiqmadi … kichikroq hajm tanlang» — wrong advice: the size was not
 * the problem, the AI service was down. Now the gate asks the same «every provider down» verdict as the «chain gave
 * nothing» throw sites (`llmOutage`) and answers with `AI_OUTAGE_ERROR`.
 *
 * Mutation (red): `throw llmOutage() ? errorWithCause(short) : new Error(short)` → `throw new Error(short)` in
 * `lib/generation/index.ts` — the 402 case gets the length message again.
 * The 400 case (one request's own problem, not an outage) locks the other side: the gate keeps its message.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { buildArtifact } = await import("../lib/generation/index.ts");
const { withJobCost } = await import("../lib/generation/job-cost.ts");
const { resetBreakers } = await import("../lib/generation/llm/breaker.ts");
const { resetFailureCounters } = await import("../lib/generation/llm/failure.ts");
const { AI_OUTAGE_ERROR, UserFacingError, userMessage } = await import("../lib/server/user-error.ts");

const VALUES = { topic: "Raqamli iqtisodiyot va kichik biznes", pages: "10-15", language: "uz" };

/** Every LLM call fails with the given HTTP status and body (Gemini error shape). */
async function withFailingProvider<T>(status: number, message: string, fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  resetBreakers();
  resetFailureCounters();
  const body = JSON.stringify({ error: { code: status, message, status: "FAILED_PRECONDITION" } });
  globalThis.fetch = (async () =>
    ({ ok: false, status, headers: new Headers(), json: async () => JSON.parse(body), text: async () => body }) as never) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
    resetBreakers();
    resetFailureCounters();
  }
}

async function failure(status: number, message: string): Promise<Error> {
  try {
    await withFailingProvider(status, message, () =>
      withJobCost(() => buildArtifact(TOOL_BY_ID["mustaqil-ish"]!, VALUES as never, { deadline: Date.now() + 60_000 })),
    );
  } catch (e) {
    return e as Error;
  }
  assert.fail("the job must fail when no provider writes anything");
}

test("prepaid credits depleted (402): the user hears «AI xizmati vaqtincha ishlamayapti», not «Matn hajmi yetarli chiqmadi»", async () => {
  const e = await failure(402, "Your prepayment credits are depleted. Please go to AI Studio to manage your billing.");
  assert.ok(e instanceof UserFacingError, `got ${e.name}: ${e.message}`);
  assert.equal(e.message, AI_OUTAGE_ERROR);
  assert.equal(userMessage(e), AI_OUTAGE_ERROR, "the worker shows this text as is");
  assert.ok(!/hajm/i.test(userMessage(e)), "no «choose a smaller size» advice for an outage");
});

test("one request's own refusal (400, not an outage) keeps the engine's own message", async () => {
  const e = await failure(400, "Request contains an invalid argument.");
  assert.ok(!(e instanceof UserFacingError) || e.message !== AI_OUTAGE_ERROR, `outage message for a non-outage: ${e.message}`);
  assert.notEqual(userMessage(e), AI_OUTAGE_ERROR);
});
