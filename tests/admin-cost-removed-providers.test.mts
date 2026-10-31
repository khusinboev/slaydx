import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * HISTORY OF REMOVED PROVIDERS STAYS READABLE.
 *
 * fal.ai, xAI, OpenRouter and OpenAI-as-text were removed from the code (no adapter, no price row, no registry
 * entry), but `ai_usage` and `generations.cost_json` rows written while they were live stay in the database
 * (nothing is migrated or deleted). The admin cost reports read the STORED `usd` of every part -- they never
 * price a part again -- so such rows must still aggregate and display:
 *
 *   - `spendTotals` / `spendBy` (provider, model, kind, tool, day) / `spendByProviderModel` count them, and the
 *     groupings still add up to the totals;
 *   - a priced stored part keeps its stored usd (no price row needed), an unpriced stored image part keeps its
 *     `priced: false` marker (and shows in `costCaveats`);
 *   - a legacy `cost_json` WITHOUT parts (an old engine CostMeter) is attributed to its top provider/model;
 *   - the admin AI page payload (`aiCost`) shows them by provider.
 *
 * Mutation checks (each made the named test fail, then restored): drop the `usd` read of a part in
 * `admin-cost.ts` (sum from `llm-pricing.costUsd` instead) -> "stored usd" assertions fail; filter parts to the
 * providers of `llm/types.ts ProviderId` -> every test below fails.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("rmprov") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { parseDateRange } = await import("../lib/server/admin-list.ts");
const cost = await import("../lib/server/admin-cost.ts");
const adminAi = await import("../lib/server/admin-ai.ts");

const D = "2026-03-10";
/** A Tashkent wall-clock instant (UTC+5, no DST). */
const tk = (day: string, time: string): string => new Date(`${day}T${time}+05:00`).toISOString();
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);

type Part = { kind: string; provider: string; model: string; calls: number; inputTokens: number; outputTokens: number; units: number; usd: number; priced?: boolean };

const llm = (provider: string, model: string, calls: number, inputTokens: number, outputTokens: number, usd: number): Part => ({ kind: "llm", provider, model, calls, inputTokens, outputTokens, units: 0, usd });

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
}

test("stored parts of removed providers still aggregate and display in the admin cost reports", { skip }, async (t) => {
  quiet(t);
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const uid = (await queryOne<{ id: string }>(`INSERT INTO users (name) VALUES ('Removed providers') RETURNING id::text AS id`, []))!.id;

  async function usage(o: { at: string; tool: string; parts: Part[] }) {
    const sum = (f: (p: Part) => number) => o.parts.reduce((a, p) => a + f(p), 0);
    await query(
      `INSERT INTO ai_usage (at, source, outcome, generation_id, user_id, tool_id, calls, input_tokens, output_tokens, usd, parts)
       VALUES ($1, 'job', 'completed', $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [o.at, randomUUID(), uid, o.tool, sum((p) => p.calls), sum((p) => p.inputTokens), sum((p) => p.outputTokens), sum((p) => p.usd), JSON.stringify(o.parts)],
    );
  }
  async function legacyGeneration(o: { tool: string; finishedAt: string; costJson: unknown }) {
    await query(
      `INSERT INTO generations (id, user_id, tool_id, status, cost_json, created_at, finished_at)
       VALUES ($1, $2, $3, 'COMPLETED', $4::jsonb, $5::timestamptz - interval '1 minute', $5::timestamptz)`,
      [randomUUID(), uid, o.tool, JSON.stringify(o.costJson), o.finishedAt],
    );
  }

  // 1. ai_usage: an xAI text call and two PRICED fal images (stored usd, no price row exists any more).
  const fal = { kind: "image", provider: "fal", model: "fal-ai/flux/schnell", calls: 2, inputTokens: 0, outputTokens: 0, units: 2, usd: 0.006 };
  await usage({ at: tk(D, "10:00:00"), tool: "slide", parts: [llm("xai", "grok-4.3", 2, 3_000, 1_200, 0.0067), fal] });
  // 2. ai_usage: OpenRouter + OpenAI-text parts next to a current Gemini part.
  await usage({
    at: tk(D, "11:00:00"),
    tool: "referat",
    parts: [llm("openrouter", "anthropic/claude-sonnet-5", 1, 1_000, 500, 0.00753), llm("openai", "gpt-5.6-luna", 1, 2_000, 800, 0.0004), llm("gemini", "gemini-3.7-flash", 3, 9_000, 3_000, 0.018)],
  });
  // 3. Legacy cost_json WITH parts: an UNPRICED fal image (priced:false, usd 0).
  const falDev: Part = { kind: "image", provider: "fal", model: "fal-ai/flux/dev", calls: 1, inputTokens: 0, outputTokens: 0, units: 1, usd: 0, priced: false };
  await legacyGeneration({
    tool: "pro-slide",
    finishedAt: tk(D, "12:00:00"),
    costJson: { provider: "none", model: "", inputTokens: 0, outputTokens: 0, calls: 1, usd: 0, parts: [falDev] },
  });
  // 4. Legacy engine CostMeter cost_json WITHOUT parts: attributed to its top provider/model (xai).
  await legacyGeneration({
    tool: "essay",
    finishedAt: tk(D, "13:00:00"),
    costJson: { provider: "xai", model: "grok-4.3", inputTokens: 500, outputTokens: 100, calls: 1, usd: 0.0009 },
  });

  const range = parseDateRange(D, D);
  const expectedUsd = 0.0067 + 0.006 + 0.00753 + 0.0004 + 0.018 + 0 + 0.0009;
  const expectedCalls = 2 + 2 + 1 + 1 + 3 + 1 + 1;

  await t.test("totals count every stored row at its stored usd", async () => {
    const totals = await cost.spendTotals(pool(), range);
    assert.equal(totals.records, 4);
    assert.equal(totals.calls, expectedCalls);
    near(totals.usd, expectedUsd, "usd");
  });

  await t.test("spendByProviderModel: every removed provider/model pair is present with its stored usd, calls, units and unpriced marker", async () => {
    const pairs = await cost.spendByProviderModel(pool(), range);
    const find = (p: string, m: string) => pairs.find((r) => r.provider === p && r.model === m);
    // xAI: the ai_usage part (2 calls, 0.0067) plus the legacy part-less cost_json (1 call, 0.0009).
    assert.equal(find("xai", "grok-4.3")?.calls, 3);
    near(find("xai", "grok-4.3")?.usd ?? -1, 0.0067 + 0.0009, "xai usd");
    assert.equal(find("xai", "grok-4.3")?.inputTokens, 3_500);
    // fal: priced images keep their stored usd and units; the unpriced one is counted and flagged.
    assert.equal(find("fal", "fal-ai/flux/schnell")?.units, 2);
    near(find("fal", "fal-ai/flux/schnell")?.usd ?? -1, 0.006, "fal usd");
    assert.equal(find("fal", "fal-ai/flux/schnell")?.unpricedCalls, 0);
    assert.equal(find("fal", "fal-ai/flux/dev")?.units, 1);
    assert.equal(find("fal", "fal-ai/flux/dev")?.unpricedCalls, 1);
    near(find("fal", "fal-ai/flux/dev")?.usd ?? -1, 0, "unpriced fal usd");
    // OpenRouter / OpenAI text.
    near(find("openrouter", "anthropic/claude-sonnet-5")?.usd ?? -1, 0.00753, "openrouter usd");
    near(find("openai", "gpt-5.6-luna")?.usd ?? -1, 0.0004, "openai usd");
    assert.equal(find("gemini", "gemini-3.7-flash")?.calls, 3);
    // Pairs add up to the totals and are ordered by usd.
    const totals = await cost.spendTotals(pool(), range);
    near(pairs.reduce((a, r) => a + r.usd, 0), totals.usd, "pairs usd = totals");
    assert.equal(pairs.reduce((a, r) => a + r.calls, 0), totals.calls);
    assert.ok(pairs.every((r, i) => i === 0 || pairs[i - 1]!.usd >= r.usd), "usd descending");
  });

  await t.test("spendBy provider / model / kind / tool / day: a stored fal part aggregates and every grouping sums to the totals", async () => {
    const totals = await cost.spendTotals(pool(), range);
    for (const by of ["provider", "model", "kind", "tool", "day"] as const) {
      const rows = await cost.spendBy(pool(), range, by);
      near(rows.reduce((a, r) => a + r.usd, 0), totals.usd, `${by}: usd`);
      assert.equal(rows.reduce((a, r) => a + r.calls, 0), totals.calls, `${by}: calls`);
    }
    const byProvider = Object.fromEntries((await cost.spendBy(pool(), range, "provider")).map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(byProvider).sort(), ["fal", "gemini", "openai", "openrouter", "xai"]);
    near(byProvider.fal!.usd, 0.006, "fal provider usd");
    assert.equal(byProvider.fal!.calls, 3, "2 priced + 1 unpriced fal image");
    assert.equal(byProvider.fal!.units, 3);
    assert.equal(byProvider.fal!.unpricedCalls, 1);
    near(byProvider.xai!.usd, 0.0067 + 0.0009, "xai provider usd");
    const byKind = Object.fromEntries((await cost.spendBy(pool(), range, "kind")).map((r) => [r.key, r]));
    assert.equal(byKind.image!.units, 3);
    near(byKind.llm!.usd, expectedUsd - 0.006, "llm kind usd (every removed LLM provider included)");
    const byTool = Object.fromEntries((await cost.spendBy(pool(), range, "tool")).map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(byTool).sort(), ["essay", "pro-slide", "referat", "slide"]);
  });

  await t.test("the unpriced stored fal image shows in the cost caveats", async () => {
    const caveats = await cost.costCaveats(pool(), range);
    assert.ok(caveats.some((c) => c.includes("fal:fal-ai/flux/dev")), caveats.join("\n"));
  });

  await t.test("the admin AI page payload lists the removed providers by provider (the screen the owner reads)", async () => {
    adminAi.clearAiCache();
    const body = await adminAi.aiCost(range, "provider");
    const keys = body.rows.map((r) => r.key).sort();
    assert.deepEqual(keys, ["fal", "gemini", "openai", "openrouter", "xai"]);
    near(body.totals.usd, expectedUsd, "payload usd");
    assert.equal(body.rows.find((r) => r.key === "fal")?.unpricedCalls, 1);
    adminAi.clearAiCache();
    const byModel = await adminAi.aiCost(range, "model");
    assert.ok(byModel.rows.some((r) => r.key === "grok-4.3") && byModel.rows.some((r) => r.key === "fal-ai/flux/schnell"));
  });
});
