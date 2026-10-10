import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import type { CostJson } from "../lib/generation/types.ts";

/**
 * Canonical AI spend (`lib/server/admin-cost.ts`; docs/admin/02-plan.md §6.3,
 * §6.7, §17.3–17.4) against a real Postgres (a throwaway database):
 *   - a job with both `cost_json` and a completed `ai_usage` row counts once,
 *     also when the two timestamps fall on different days;
 *   - a legacy job (only `cost_json`) counts once; failed, abandoned (deleted
 *     generation) and free rows count; a FAILED job's `cost_json` does not;
 *   - range edges and day buckets are Asia/Tashkent days (`[from, to)`);
 *   - every grouping sums to the totals; coverage math; empty range → zeros;
 *   - `spendForJobs` (per job, all time) applies the same rule and sums to
 *     `spendTotals` minus free calls (mutation-checked: excluding abandoned rows
 *     only there, or dropping the per-job SQL sum, fails it);
 *   - the fragment composes with the caller's own `$n` params and runs in a
 *     READ ONLY transaction.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("cost") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const jc = await import("../lib/generation/job-cost.ts");
const { parseDateRange } = await import("../lib/server/admin-list.ts");
const cost = await import("../lib/server/admin-cost.ts");

const D = "2026-03-10";
const D1 = "2026-03-11";
/** A Tashkent wall-clock instant (UTC+5, no DST). */
const tk = (day: string, time: string): string => new Date(`${day}T${time}+05:00`).toISOString();

const SONNET = (inputTokens: number, outputTokens: number) => ({ provider: "anthropic", model: "claude-sonnet-5", inputTokens, outputTokens });

function meter(fill: (c: InstanceType<typeof jc.JobCost>) => void): CostJson {
  const c = new jc.JobCost();
  fill(c);
  return c.toJson();
}

/** Expected spend row (what the canonical row set must contain exactly once). */
type Spend = { at: string; tool: string; outcome: string; cost: CostJson };

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? "usd"}: ${a} ≠ ${b}`);

function sumOf(rows: Spend[]) {
  return {
    records: rows.length,
    calls: rows.reduce((a, r) => a + r.cost.calls, 0),
    inputTokens: rows.reduce((a, r) => a + r.cost.inputTokens, 0),
    outputTokens: rows.reduce((a, r) => a + r.cost.outputTokens, 0),
    usd: rows.reduce((a, r) => a + r.cost.usd, 0),
  };
}

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
}

test("canonical spend: dedupe, legacy, outcomes, Tashkent days, groupings, coverage", { skip }, async (t) => {
  quiet(t);
  const { query, queryOne, migrate, pool, transaction } = await import("../lib/server/db.ts");
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const u = await queryOne<{ id: string }>(`INSERT INTO users (name) VALUES ('Cost test') RETURNING id::text AS id`, []);
  const uid = u!.id;

  async function gen(o: { tool: string; status: string; finishedAt: string; costJson?: CostJson | null }): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, status, cost_json, created_at, finished_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz - interval '1 minute', $6::timestamptz)`,
      [id, uid, o.tool, o.status, o.costJson ? JSON.stringify(o.costJson) : null, o.finishedAt],
    );
    return id;
  }
  async function usage(o: { at: string; source: "job" | "free"; outcome: string; genId: string | null; tool: string; cost: CostJson; parts?: unknown[] }) {
    await query(
      `INSERT INTO ai_usage (at, source, outcome, generation_id, user_id, tool_id, calls, input_tokens, output_tokens, usd, parts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [o.at, o.source, o.outcome, o.genId, uid, o.tool, o.cost.calls, o.cost.inputTokens, o.cost.outputTokens, o.cost.usd, JSON.stringify(o.parts ?? o.cost.parts ?? [])],
    );
  }

  // --- Day D -------------------------------------------------------------
  // A: completed, cost in BOTH cost_json and ai_usage → counted once.
  const costA = meter((c) => {
    c.addLlm(SONNET(1_000_000, 100_000));
    c.addImage("gemini", "gemini-3.1-flash-lite-image", 2);
  });
  const genA = await gen({ tool: "slide", status: "COMPLETED", finishedAt: tk(D, "10:00:00"), costJson: costA });
  await usage({ at: tk(D, "10:00:01"), source: "job", outcome: "completed", genId: genA, tool: "slide", cost: costA });

  // B: legacy completed (cost_json with parts only), finished 23:30 Tashkent → day D.
  const costB = meter((c) => {
    c.addLlm(SONNET(20_000, 4_000));
    c.addGrounding(2);
  });
  const genB = await gen({ tool: "article", status: "COMPLETED", finishedAt: tk(D, "23:30:00"), costJson: costB });

  // C: legacy engine CostMeter cost_json without parts.
  const costC: CostJson = { provider: "openai", model: "gpt-legacy", inputTokens: 1_000, outputTokens: 500, calls: 3, usd: 0.25 };
  const genC = await gen({ tool: "referat", status: "COMPLETED", finishedAt: tk(D, "12:00:00"), costJson: costC });

  // D: failed job; its cost_json was written before it failed — only the ai_usage row counts.
  const costD = meter((c) => {
    c.addLlm(SONNET(10_000, 2_000));
    c.addUnpricedImage("fal", "fal-ai/flux/dev");
    c.addLlm({ provider: "openrouter", model: "mystery-model", inputTokens: 100, outputTokens: 50 });
  });
  const genD = await gen({ tool: "pro-slide", status: "FAILED", finishedAt: tk(D, "13:00:00"), costJson: costD });
  await usage({ at: tk(D, "13:00:01"), source: "job", outcome: "failed", genId: genD, tool: "pro-slide", cost: costD });

  // E: abandoned build of a generation the user deleted (no generations row).
  const costE = meter((c) => c.addLlm(SONNET(5_000, 1_000)));
  const genE = randomUUID();
  await usage({ at: tk(D, "14:00:00"), source: "job", outcome: "abandoned", genId: genE, tool: "image", cost: costE });

  // Free call recorded without parts → the "unknown" pseudo-part.
  const costFree: CostJson = { provider: "none", model: "", inputTokens: 10, outputTokens: 5, calls: 1, usd: 0.02 };
  await usage({ at: tk(D, "15:00:00"), source: "free", outcome: "free", genId: null, tool: "free:polish", cost: costFree, parts: [] });

  // Free call at exactly Tashkent midnight that STARTS day D.
  const costFree0 = meter((c) => c.addLlm(SONNET(1_000, 100)));
  await usage({ at: tk(D, "00:00:00"), source: "free", outcome: "free", genId: null, tool: "free:outline", cost: costFree0 });

  // F: completed without any cost data (coverage denominator only).
  const genF = await gen({ tool: "slide", status: "COMPLETED", finishedAt: tk(D, "16:00:00"), costJson: null });

  // G: completed, cost_json write failed, ai_usage row exists → counted once, covered.
  const costG = meter((c) => c.addLlm(SONNET(30_000, 6_000)));
  const genG = await gen({ tool: "essay", status: "COMPLETED", finishedAt: tk(D, "17:00:00"), costJson: null });
  await usage({ at: tk(D, "17:00:01"), source: "job", outcome: "completed", genId: genG, tool: "essay", cost: costG });

  // I: finished at the very end of D, its ai_usage row lands on D+1 → counted once, on D+1.
  const costI = meter((c) => c.addLlm(SONNET(40_000, 8_000)));
  const genI = await gen({ tool: "slide", status: "COMPLETED", finishedAt: tk(D, "23:59:59.900"), costJson: costI });
  await usage({ at: tk(D1, "00:00:00.200"), source: "job", outcome: "completed", genId: genI, tool: "slide", cost: costI });

  // --- Day D+1 and outside ---------------------------------------------------
  // H: legacy job finished 00:30 Tashkent on D+1 (19:30 UTC on D) → day D+1.
  const costH = meter((c) => c.addLlm(SONNET(70_000, 9_000)));
  const genH = await gen({ tool: "article", status: "COMPLETED", finishedAt: tk(D1, "00:30:00"), costJson: costH });
  // Free call at exactly the Tashkent midnight that ENDS day D → day D+1.
  const costFree1 = meter((c) => c.addLlm(SONNET(2_000, 300)));
  await usage({ at: tk(D1, "00:00:00"), source: "free", outcome: "free", genId: null, tool: "free:udk", cost: costFree1 });
  // Before D (23:59:59 Tashkent on D-1) → in neither range.
  const costOld = meter((c) => c.addLlm(SONNET(900_000, 90_000)));
  await usage({ at: tk("2026-03-09", "23:59:59"), source: "free", outcome: "free", genId: null, tool: "free:rewrite", cost: costOld });

  const dayD: Spend[] = [
    { at: "A", tool: "slide", outcome: "completed", cost: costA },
    { at: "B", tool: "article", outcome: "completed", cost: costB },
    { at: "C", tool: "referat", outcome: "completed", cost: costC },
    { at: "D", tool: "pro-slide", outcome: "failed", cost: costD },
    { at: "E", tool: "image", outcome: "abandoned", cost: costE },
    { at: "free", tool: "free:polish", outcome: "free", cost: costFree },
    { at: "free0", tool: "free:outline", outcome: "free", cost: costFree0 },
    { at: "G", tool: "essay", outcome: "completed", cost: costG },
  ];
  const dayD1: Spend[] = [
    { at: "I", tool: "slide", outcome: "completed", cost: costI },
    { at: "H", tool: "article", outcome: "completed", cost: costH },
    { at: "free1", tool: "free:udk", outcome: "free", cost: costFree1 },
  ];

  const rD = parseDateRange(D, D);
  const rDD1 = parseDateRange(D, D1);

  await t.test("totals: each job once, legacy once, failed/abandoned/free counted, FAILED cost_json ignored", async () => {
    const got = await cost.spendTotals(pool(), rD);
    const want = sumOf(dayD);
    assert.equal(got.records, want.records, "one row per job outcome / free call");
    assert.equal(got.calls, want.calls);
    assert.equal(got.inputTokens, want.inputTokens);
    assert.equal(got.outputTokens, want.outputTokens);
    near(got.usd, want.usd);

    const both = await cost.spendTotals(pool(), rDD1);
    const wantBoth = sumOf([...dayD, ...dayD1]);
    assert.equal(both.records, wantBoth.records);
    near(both.usd, wantBoth.usd);

    // Row-level: job A and job I appear exactly once each across the whole period.
    const spend = cost.spendRowsSql(rDD1);
    const perJob = await query<{ generation_id: string; n: string }>(
      `SELECT s.generation_id, count(*) AS n FROM (${spend.sql}) s WHERE s.generation_id = ANY($3::uuid[]) GROUP BY 1`,
      [...spend.params, [genA, genI, genG, genD]],
    );
    assert.deepEqual(Object.fromEntries(perJob.map((r) => [r.generation_id, Number(r.n)])), { [genA]: 1, [genI]: 1, [genG]: 1, [genD]: 1 });
  });

  await t.test("spendForJobs: the same rule by job id, summing to spendTotals minus free calls", async () => {
    const jobsD = [genA, genB, genC, genD, genE, genG];
    const free = (rows: Spend[]) => rows.filter((r) => r.outcome === "free");
    for (const [range, ids, rows] of [
      [rD, jobsD, dayD],
      [rDD1, [...jobsD, genI, genH], [...dayD, ...dayD1]],
    ] as const) {
      const per = await cost.spendForJobs(pool(), ids);
      const totals = await cost.spendTotals(pool(), range);
      const freeSum = sumOf(free([...rows]));
      const jobs = [...per.values()];
      assert.equal(jobs.reduce((a, j) => a + j.records, 0), totals.records - freeSum.records, "records");
      assert.equal(jobs.reduce((a, j) => a + j.calls, 0), totals.calls - freeSum.calls, "calls");
      assert.equal(jobs.reduce((a, j) => a + j.inputTokens, 0), totals.inputTokens - freeSum.inputTokens, "input");
      assert.equal(jobs.reduce((a, j) => a + j.outputTokens, 0), totals.outputTokens - freeSum.outputTokens, "output");
      near(jobs.reduce((a, j) => a + j.usd, 0), totals.usd - freeSum.usd, "usd");
    }

    const per = await cost.spendForJobs(pool(), [genA, genB, genC, genD, genE, genF, genG, genI, randomUUID()]);
    // A: cost_json AND a completed ai_usage row → one row (the ai_usage one).
    assert.equal(per.get(genA)!.records, 1);
    assert.equal(per.get(genA)!.rows[0]!.outcome, "completed");
    assert.equal(per.get(genA)!.rows[0]!.at, tk(D, "10:00:01"), "the ai_usage row, not the legacy one");
    near(per.get(genA)!.usd, costA.usd, "A");
    assert.deepEqual(per.get(genA)!.rows[0]!.parts, JSON.parse(JSON.stringify(costA.parts)));
    // C: legacy CostMeter without parts → its one attributed LLM part.
    const partsC = per.get(genC)!.rows[0]!.parts as Array<Record<string, unknown>>;
    assert.equal(partsC.length, 1);
    assert.equal(partsC[0]!.provider, "openai");
    assert.equal(partsC[0]!.model, "gpt-legacy");
    // D: FAILED → only its ai_usage row, never its cost_json.
    assert.equal(per.get(genD)!.records, 1);
    assert.equal(per.get(genD)!.rows[0]!.outcome, "failed");
    // E: abandoned spend of a deleted generation still belongs to its id.
    assert.equal(per.get(genE)!.rows[0]!.outcome, "abandoned");
    // I: not range-limited — its D+1 ai_usage row counts once.
    assert.equal(per.get(genI)!.records, 1);
    near(per.get(genI)!.usd, costI.usd, "I");
    // F (no cost data) and an unknown id have no entry.
    assert.ok(!per.has(genF));
    assert.equal(per.size, 7);

    // Same figures inside a READ ONLY transaction (how admin-generations calls it).
    const inTx = await transaction(async (c) => {
      await c.query("SET TRANSACTION READ ONLY");
      return cost.spendForJobs(c, [genA]);
    });
    near(inTx.get(genA)!.usd, costA.usd, "A in tx");

    // J (on its own day, outside every other range here): a retried job — a
    // failed attempt plus the completed run (with a cost_json too) → two rows, one total.
    const DJ = "2026-04-01";
    const costJ1 = meter((c) => c.addLlm(SONNET(3_000, 700)));
    const costJ2 = meter((c) => c.addLlm(SONNET(11_000, 1_300)));
    const genJ = await gen({ tool: "slide", status: "COMPLETED", finishedAt: tk(DJ, "11:00:00"), costJson: costJ2 });
    await usage({ at: tk(DJ, "10:00:00"), source: "job", outcome: "failed", genId: genJ, tool: "slide", cost: costJ1 });
    await usage({ at: tk(DJ, "11:00:01"), source: "job", outcome: "completed", genId: genJ, tool: "slide", cost: costJ2 });
    const j = (await cost.spendForJobs(pool(), [genJ])).get(genJ)!;
    assert.deepEqual(j.rows.map((r) => r.outcome), ["failed", "completed"], "oldest first");
    assert.equal(j.records, 2);
    assert.equal(j.calls, costJ1.calls + costJ2.calls);
    near(j.usd, costJ1.usd + costJ2.usd, "J total");
    near(j.usd, (await cost.spendTotals(pool(), parseDateRange(DJ, DJ))).usd, "J = its day's spendTotals");
  });

  await t.test("Tashkent days: 23:30 stays on its day, 00:00 starts the next, edges are [from, to)", async () => {
    const days = await cost.spendBy(pool(), rDD1, "day");
    assert.deepEqual(days.map((d) => d.key), [D, D1]);
    near(days[0].usd, sumOf(dayD).usd, D);
    near(days[1].usd, sumOf(dayD1).usd, D1);
    assert.equal(days[0].records, dayD.length);
    assert.equal(days[1].records, dayD1.length);
    // The D+1 range alone holds exactly the D+1 rows (the 00:00 free call and the 00:30 job included).
    const only1 = await cost.spendTotals(pool(), parseDateRange(D1, D1));
    assert.equal(only1.records, dayD1.length);
    near(only1.usd, sumOf(dayD1).usd);
  });

  await t.test("every grouping sums to the totals", async () => {
    const totals = await cost.spendTotals(pool(), rDD1);
    for (const by of cost.SPEND_GROUP_BY) {
      const rows = await cost.spendBy(pool(), rDD1, by);
      near(rows.reduce((a, r) => a + r.usd, 0), totals.usd, `${by} usd`);
      assert.equal(rows.reduce((a, r) => a + r.calls, 0), totals.calls, `${by} calls`);
      assert.equal(rows.reduce((a, r) => a + r.inputTokens, 0), totals.inputTokens, `${by} input`);
      assert.equal(rows.reduce((a, r) => a + r.outputTokens, 0), totals.outputTokens, `${by} output`);
      assert.equal(rows.reduce((a, r) => a + r.unpricedCalls, 0), 2, `${by} unpriced (fal dev + unknown LLM)`);
      if (by === "day" || by === "tool" || by === "outcome") {
        assert.equal(rows.reduce((a, r) => a + r.records, 0), totals.records, `${by} records`);
        assert.ok(rows.every((r) => r.units === null), `${by}: no mixed-kind units`);
      }
    }
  });

  await t.test("groupings: keys and values", async () => {
    const outcome = Object.fromEntries((await cost.spendBy(pool(), rD, "outcome")).map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(outcome).sort(), ["abandoned", "completed", "failed", "free"]);
    near(outcome.completed.usd, costA.usd + costB.usd + costC.usd + costG.usd, "completed");
    near(outcome.failed.usd, costD.usd, "failed");
    assert.equal(outcome.free.records, 2);

    const tool = Object.fromEntries((await cost.spendBy(pool(), rD, "tool")).map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(tool).sort(), ["article", "essay", "free:outline", "free:polish", "image", "pro-slide", "referat", "slide"]);
    near(tool.slide.usd, costA.usd, "slide (job A once, job I is on D+1)");
    assert.equal(tool["pro-slide"].unpricedCalls, 2);

    const kind = Object.fromEntries((await cost.spendBy(pool(), rD, "kind")).map((r) => [r.key, r]));
    assert.deepEqual(Object.keys(kind).sort(), ["grounding", "image", "llm", "unknown"]);
    assert.equal(kind.image.units, 3, "2 gemini + 1 fal");
    assert.equal(kind.image.unpricedCalls, 1);
    assert.equal(kind.llm.unpricedCalls, 1);
    assert.equal(kind.grounding.units, 2);
    near(kind.unknown.usd, costFree.usd, "row with spend but no parts");
    assert.equal(kind.unknown.calls, 1);

    const provider = Object.fromEntries((await cost.spendBy(pool(), rD, "provider")).map((r) => [r.key, r]));
    near(provider.openai.usd, costC.usd, "legacy CostMeter cost attributed to its top pair");
    assert.equal(provider.openai.calls, 3);
    assert.equal(provider.fal.usd, 0);
    assert.equal(provider.fal.unpricedCalls, 1);
    const model = Object.fromEntries((await cost.spendBy(pool(), rD, "model")).map((r) => [r.key, r]));
    assert.equal(model["gpt-legacy"].inputTokens, 1_000);
    assert.equal(model["mystery-model"].unpricedCalls, 1);
    // Sorted by usd descending.
    const byUsd = await cost.spendBy(pool(), rD, "model");
    assert.ok(byUsd.every((r, i) => i === 0 || byUsd[i - 1].usd >= r.usd));
  });

  await t.test("spendByProviderModel: pairs sum to the totals and to the provider / model groupings, unknown included", async () => {
    for (const range of [rD, rDD1]) {
      const pairs = await cost.spendByProviderModel(pool(), range);
      const totals = await cost.spendTotals(pool(), range);
      near(pairs.reduce((a, r) => a + r.usd, 0), totals.usd, "usd = spendTotals");
      assert.equal(pairs.reduce((a, r) => a + r.calls, 0), totals.calls);
      assert.equal(pairs.reduce((a, r) => a + r.inputTokens, 0), totals.inputTokens);
      assert.equal(pairs.reduce((a, r) => a + r.outputTokens, 0), totals.outputTokens);
      assert.equal(pairs.reduce((a, r) => a + r.unpricedCalls, 0), 2);

      for (const [by, field] of [["provider", "provider"], ["model", "model"]] as const) {
        for (const g of await cost.spendBy(pool(), range, by)) {
          const mine = pairs.filter((p) => p[field] === g.key);
          near(mine.reduce((a, r) => a + r.usd, 0), g.usd, `${by} ${g.key} usd`);
          assert.equal(mine.reduce((a, r) => a + r.calls, 0), g.calls, `${by} ${g.key} calls`);
          assert.equal(mine.reduce((a, r) => a + r.units, 0), g.units, `${by} ${g.key} units`);
          assert.equal(mine.reduce((a, r) => a + r.unpricedCalls, 0), g.unpricedCalls, `${by} ${g.key} unpriced`);
        }
      }
      assert.ok(pairs.every((r, i) => i === 0 || pairs[i - 1].usd >= r.usd), "usd descending");
    }
    const pairs = await cost.spendByProviderModel(pool(), rD);
    const find = (p: string, m: string) => pairs.find((r) => r.provider === p && r.model === m);
    // The free call recorded with spend but no parts is the unknown/unknown pseudo-part.
    const unknown = find("unknown", "unknown");
    assert.ok(unknown, "unknown pseudo-part present");
    assert.equal(unknown.calls, 1);
    near(unknown.usd, costFree.usd, "unknown usd");
    // Legacy CostMeter cost attributed to its top pair; images and grounding as their own pairs.
    near(find("openai", "gpt-legacy")?.usd ?? -1, costC.usd, "legacy pair");
    assert.equal(find("gemini", "gemini-3.1-flash-lite-image")?.units, 2);
    assert.equal(find("fal", "fal-ai/flux/dev")?.unpricedCalls, 1);
    assert.equal(find("openrouter", "mystery-model")?.unpricedCalls, 1);
  });

  await t.test("spendByProviderModel: an empty range gives no rows", async () => {
    assert.deepEqual(await cost.spendByProviderModel(pool(), parseDateRange("2020-01-01", "2020-01-02")), []);
  });

  await t.test("coverage: completed with cost data ÷ completed, by Tashkent day", async () => {
    // D: A, B, C, G, I have cost data; F does not.
    // The first ai_usage row (the rollout) is the free call at 23:59:59 on D-1, before every job here: nothing is historical.
    const rolloutAt = tk("2026-03-09", "23:59:59");
    assert.equal(await cost.spendRollout(pool()), rolloutAt);
    const noHistory = { rolloutAt, historicalCompleted: 0, historicalWithCost: 0 };
    assert.deepEqual(await cost.spendCoverage(pool(), rD), { jobsWithCost: 5, jobsCompleted: 6, pct: (5 / 6) * 100, ...noHistory });
    assert.deepEqual(await cost.spendCoverage(pool(), rDD1), { jobsWithCost: 6, jobsCompleted: 7, pct: (6 / 7) * 100, ...noHistory });
    const byTool = await cost.spendCoverageByTool(pool(), rD);
    assert.deepEqual(
      byTool.map((r) => [r.toolId, r.jobsWithCost, r.jobsCompleted]),
      [
        ["article", 1, 1],
        ["essay", 1, 1],
        ["referat", 1, 1],
        ["slide", 2, 3],
      ],
    );
  });

  await t.test("empty range → zeros, not nulls", async () => {
    const empty = parseDateRange("2020-01-01", "2020-01-02");
    assert.deepEqual(await cost.spendTotals(pool(), empty), { records: 0, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 });
    assert.deepEqual(await cost.spendCoverage(pool(), empty), { jobsWithCost: 0, jobsCompleted: 0, pct: 0, rolloutAt: tk("2026-03-09", "23:59:59"), historicalCompleted: 0, historicalWithCost: 0 });
    assert.deepEqual(await cost.spendCoverageByTool(pool(), empty), []);
    const days = await cost.spendBy(pool(), empty, "day");
    assert.deepEqual(days, [
      { key: "2020-01-01", records: 0, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, units: null, unpricedCalls: 0 },
      { key: "2020-01-02", records: 0, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, units: null, unpricedCalls: 0 },
    ]);
    for (const by of ["tool", "outcome", "provider", "model", "kind"] as const) assert.deepEqual(await cost.spendBy(pool(), empty, by), []);
  });

  await t.test("composable params and a READ ONLY + statement_timeout transaction", async () => {
    const spend = cost.spendRowsSql(rD, 3);
    assert.deepEqual(spend.params, [rD.fromTs, rD.toTsExclusive]);
    assert.equal(spend.nextParam, 5);
    assert.ok(spend.sql.includes("$3::timestamptz") && spend.sql.includes("$4::timestamptz") && !spend.sql.includes("$1"));
    const rows = await query<{ n: string; usd: string }>(
      `SELECT count(*) AS n, COALESCE(sum(s.usd), 0) AS usd FROM (${spend.sql}) s WHERE s.tool_id = $1 OR s.tool_id = $2`,
      ["slide", "article", ...spend.params],
    );
    assert.equal(Number(rows[0].n), 2);
    near(Number(rows[0].usd), costA.usd + costB.usd);

    const inTx = await transaction(async (c) => {
      await c.query("SET TRANSACTION READ ONLY");
      await c.query("SET LOCAL statement_timeout = '10s'");
      return {
        totals: await cost.spendTotals(c, rD),
        kind: await cost.spendBy(c, rD, "kind"),
        coverage: await cost.spendCoverage(c, rD),
      };
    });
    near(inTx.totals.usd, sumOf(dayD).usd);
    assert.equal(inTx.coverage.jobsCompleted, 6);
    assert.ok(inTx.kind.length > 0);
  });

  await t.test("soumPerUsd follows the finance.soum_per_usd setting", async () => {
    invalidateSettingsCache();
    const before = await cost.soumPerUsd();
    assert.ok(Number.isInteger(before) && before > 0);
    await query(`INSERT INTO app_settings (key, value) VALUES ('finance.soum_per_usd', '13250'::jsonb)`, []);
    invalidateSettingsCache();
    assert.equal(await cost.soumPerUsd(), 13_250);
    await query(`DELETE FROM app_settings WHERE key = 'finance.soum_per_usd'`, []);
    invalidateSettingsCache();
    assert.equal(await cost.soumPerUsd(), before);
  });
});

test("input validation", async () => {
  const r = parseDateRange(D, D);
  assert.throws(() => cost.spendRowsSql({ fromTs: "x", toTsExclusive: r.toTsExclusive }), /invalid range/);
  assert.throws(() => cost.spendRowsSql({ fromTs: r.toTsExclusive, toTsExclusive: r.fromTs }), /invalid range/);
  assert.throws(() => cost.spendRowsSql(r, 0), /invalid firstParam/);
  assert.throws(() => cost.spendRowsSql(r, 1.5), /invalid firstParam/);
  await assert.rejects(cost.spendBy({ query: async () => ({ rows: [] }) } as never, r, "user" as never), /invalid groupBy/);
  // Range instants never reach the SQL text.
  const s = cost.spendRowsSql(r);
  assert.ok(!s.sql.includes(r.fromTs) && !s.sql.includes(r.toTsExclusive));
  assert.ok(!/\bhtml\b|doc_json|values_json|live_json|\*/.test(s.sql.replace(/u\.\*|s\.\*|r\.\*/g, "")), "no wide generation columns");
  // spendForJobs: empty input never queries; malformed ids are a programming error, never SQL.
  const never = { query: async () => assert.fail("must not query") } as never;
  assert.equal((await cost.spendForJobs(never, [])).size, 0);
  await assert.rejects(cost.spendForJobs(never, ["1; DROP TABLE ai_usage"]), /invalid job ids/);
  await assert.rejects(cost.spendForJobs(never, Array.from({ length: 1_001 }, () => randomUUID())), /invalid job ids/);
  // The ten-sentence static list is gone: only the two permanent limits remain (the computed notes: admin-cost-caveats.test.mts).
  assert.equal(cost.COST_CAVEATS.length, 2);
  assert.ok(Object.isFrozen(cost.COST_CAVEATS));
  for (const c of cost.COST_CAVEATS) assert.ok(c.length > 20 && !/fal\.ai|bepul sinov|TODO|FIXME/.test(c), "no stale rows");
  await assert.rejects(cost.costCaveats({ query: async () => ({ rows: [] }) } as never, { fromTs: "x", toTsExclusive: r.toTsExclusive }), /invalid range/);
});
