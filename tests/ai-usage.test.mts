import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * AI spend capture `ai_usage` (WP-X1; docs/admin/02-plan.md §17.3, §17.7):
 * `lib/server/ai-usage.ts`, `trackJobCost` / `recordFalImage` in
 * `lib/generation/job-cost.ts`, the worker flush and the free endpoints.
 *
 * Unit: a tracker sees the spend of a build that throws (nested
 * `withJobCost` included) while `withJobCost`'s own success result is
 * unchanged; fal images are priced only where a price is documented.
 * DB (throwaway database, real `runJob` with stub builds): a failed job's
 * spend is recorded; an abandoned (hard-stopped) build is recorded when it
 * settles; a completed job is recorded once with exactly its `cost_json`; the
 * row survives the user deleting the generation; a free endpoint call is
 * recorded as source 'free' (also when it fails), and nothing is written when
 * no provider was called.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("aiusage") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const jc = await import("../lib/generation/job-cost.ts");

/** Sonnet 5: $2 / $10 per 1M tokens → 1M in + 100k out = $3. */
const USAGE = { provider: "anthropic", model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 100_000 };

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

test("trackJobCost: spend of a build that throws is retrievable; withJobCost success is unchanged", async () => {
  const tracked = jc.trackJobCost(async () => {
    const { cost } = await jc.withJobCost(async () => {
      jc.recordLlmUsage(USAGE);
      return 1;
    });
    assert.equal(cost.toJson().usd, 3, "the nested meter still reports its own spend");
    jc.recordGrounding(2); // outside the nested meter → the tracker's own meter
    await jc.withJobCost(async () => {
      jc.recordLlmUsage(USAGE);
      throw new Error("provider down");
    });
  });
  await assert.rejects(tracked.promise, /provider down/);
  const snap = tracked.snapshot().toJson();
  assert.equal(snap.calls, 3);
  assert.equal(snap.inputTokens, 2_000_000);
  assert.equal(snap.usd, Number((6 + 2 * jc.GROUNDING_USD).toFixed(6)));
  // A synchronous throw becomes a rejection, not an exception at the call site.
  const sync = jc.trackJobCost((() => {
    throw new Error("sync");
  }) as never);
  await assert.rejects(sync.promise, /sync/);
  // Outside any context nothing is recorded (unchanged behaviour).
  assert.doesNotThrow(() => jc.recordLlmUsage(USAGE));
});

test("fal images: schnell priced per started megapixel (provider-pricing.md §3), others unpriced", async () => {
  assert.equal(jc.falImageUnitUsd("fal-ai/flux/schnell", 1280, 720), 0.003);
  assert.equal(jc.falImageUnitUsd("fal-ai/flux/schnell", 1600, 1200), 0.006);
  assert.equal(jc.falImageUnitUsd("fal-ai/flux/dev", 1024, 1024), null);
  const { cost } = await jc.withJobCost(async () => {
    jc.recordFalImage("fal-ai/flux/schnell", 1280, 720);
    jc.recordFalImage("fal-ai/flux/schnell", 1280, 720);
    jc.recordFalImage("fal-ai/flux/dev", 1024, 1024);
  });
  const parts = cost.toJson().parts!;
  const schnell = parts.find((p) => p.model === "fal-ai/flux/schnell")!;
  assert.deepEqual({ ...schnell }, { kind: "image", provider: "fal", model: "fal-ai/flux/schnell", calls: 2, inputTokens: 0, outputTokens: 0, units: 2, usd: 0.006 });
  const dev = parts.find((p) => p.model === "fal-ai/flux/dev")! as (typeof parts)[number] & { priced?: boolean };
  assert.equal(dev.units, 1);
  assert.equal(dev.usd, 0);
  assert.equal(dev.priced, false);
  assert.equal(cost.toJson().usd, 0.006);
});

test("fal provider records a successful image into the job meter", async (t) => {
  quiet(t);
  const prevKey = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-fal-key";
  delete process.env.FAL_MODEL;
  const realFetch = globalThis.fetch;
  let ok = true;
  globalThis.fetch = (async () =>
    ok
      ? new Response(JSON.stringify({ images: [{ url: "https://fal.media/x.jpg", width: 1280, height: 720 }] }))
      : new Response(JSON.stringify({ detail: "boom" }), { status: 500 })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = prevKey;
  });
  const { requestFalImage } = await import("../lib/generation/image-provider-fal.ts");
  const { cost } = await jc.withJobCost(async () => {
    assert.equal((await requestFalImage("p", { width: 1280, height: 720 })).ok, true);
    ok = false;
    assert.equal((await requestFalImage("p", { width: 1280, height: 720 })).ok, false);
  });
  const json = cost.toJson();
  assert.equal(json.calls, 1, "only the successful image is billed");
  assert.equal(json.usd, 0.003);
  assert.equal(json.parts![0].provider, "fal");
});

test("ai_usage (Postgres)", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const worker = await import("../lib/server/worker.ts");
  const au = await import("../lib/server/ai-usage.ts");
  const { withFreeLlm, FREE_LLM_DEFAULTS } = await import("../lib/server/spend.ts");
  await migrate();
  t.after(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await pool().end();
    await iso.drop();
  });

  const uid = String((await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ('aiusage', 'T') RETURNING id`))[0].id);
  const enqueue = async (toolId = "essay") => {
    await query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, step, budget_ms, values_json) VALUES ($1, $2, $3, 'x', 'q', 60000, '{"topic":"x"}'::jsonb)`,
      [id, uid, toolId],
    );
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    return job!;
  };
  type Row = { source: string; outcome: string; generation_id: string | null; user_id: string | null; tool_id: string; calls: number; input_tokens: string; output_tokens: string; usd: string; parts: unknown[] };
  const usage = async (genId: string) => query<Row>("SELECT * FROM ai_usage WHERE generation_id = $1 ORDER BY id", [genId]);
  const file = (cost?: unknown) => ({
    html: "<p>ok</p>",
    bytes: new Uint8Array(Buffer.from("FILE")),
    fileName: "natija.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: { title: "ok" },
    ...(cost ? { cost } : {}),
  });

  await t.test("recordAiUsage: idempotent per (generation, outcome); nothing spent → no row", async () => {
    const gen = crypto.randomUUID();
    const cost = { provider: "anthropic", model: "m", inputTokens: 1, outputTokens: 2, calls: 1, usd: 0.5, parts: [] };
    assert.equal(await au.recordAiUsage({ source: "job", outcome: "failed", generationId: gen, userId: uid, toolId: "essay", cost }), true);
    assert.equal(await au.recordAiUsage({ source: "job", outcome: "failed", generationId: gen, userId: uid, toolId: "essay", cost }), false);
    assert.equal(await au.recordAiUsage({ source: "job", outcome: "completed", generationId: gen, userId: uid, toolId: "essay", cost }), true);
    assert.equal((await usage(gen)).length, 2);
    const empty = { provider: "none", model: "", inputTokens: 0, outputTokens: 0, calls: 0, usd: 0, parts: [] };
    assert.equal(await au.recordAiUsage({ source: "job", outcome: "failed", generationId: crypto.randomUUID(), toolId: "essay", cost: empty }), false);
  });

  await t.test("failed job: the spend of the throwing build is recorded", async (tt) => {
    quiet(tt);
    const job = await enqueue();
    await worker.runJob(job, {
      build: (async () => {
        const { value } = await jc.withJobCost(async () => {
          jc.recordLlmUsage(USAGE);
          throw new Error("provider down");
        });
        return value;
      }) as never,
      hardStopMs: 30_000,
    });
    await au.flushAiUsage();
    const rows = await usage(job.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "job");
    assert.equal(rows[0].outcome, "failed");
    assert.equal(String(rows[0].user_id), uid);
    assert.equal(rows[0].tool_id, "essay");
    assert.equal(rows[0].calls, 1);
    assert.equal(Number(rows[0].input_tokens), 1_000_000);
    assert.equal(Number(rows[0].usd), 3);
    assert.equal((await query<{ status: string }>("SELECT status FROM generations WHERE id = $1", [job.id]))[0].status, "FAILED");
  });

  await t.test("abandoned build: recorded once it settles, not as failed", async (tt) => {
    quiet(tt);
    const job = await enqueue();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await worker.runJob(job, {
      build: (async () => {
        const { value } = await jc.withJobCost(async () => {
          jc.recordLlmUsage(USAGE);
          await gate;
          jc.recordLlmUsage(USAGE);
          return file();
        });
        return value;
      }) as never,
      hardStopMs: 50,
    });
    assert.equal((await query<{ status: string }>("SELECT status FROM generations WHERE id = $1", [job.id]))[0].status, "FAILED");
    await au.flushAiUsage();
    assert.equal((await usage(job.id)).length, 0, "nothing until the orphan settles");
    release();
    for (let i = 0; i < 50 && (await usage(job.id)).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      await au.flushAiUsage();
    }
    const rows = await usage(job.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "abandoned");
    assert.equal(rows[0].calls, 2, "the whole orphan spend, including after the hard stop");
    assert.equal(Number(rows[0].usd), 6);
  });

  await t.test("completed job: recorded once with its cost_json; survives deleting the generation", async (tt) => {
    quiet(tt);
    const job = await enqueue();
    // Mimics `buildArtifact`: its own meter becomes `file.cost`.
    await worker.runJob(job, {
      build: (async () => {
        const { value, cost } = await jc.withJobCost(async () => {
          jc.recordLlmUsage(USAGE);
          return file();
        });
        return { ...value, cost: cost.toJson() };
      }) as never,
      hardStopMs: 30_000,
    });
    await au.flushAiUsage();
    const gen = (await query<{ status: string; cost_json: { usd: number; calls: number } }>(
      "SELECT status, cost_json FROM generations WHERE id = $1",
      [job.id],
    ))[0];
    assert.equal(gen.status, "COMPLETED");
    let rows = await usage(job.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, "completed");
    assert.equal(Number(rows[0].usd), gen.cost_json.usd);
    assert.equal(rows[0].calls, gen.cost_json.calls);
    // A repeated flush for the same job and outcome does not add a row.
    assert.equal(
      await au.recordAiUsage({ source: "job", outcome: "completed", generationId: job.id, userId: uid, toolId: "essay", cost: gen.cost_json as never }),
      false,
    );
    await query("DELETE FROM generations WHERE id = $1", [job.id]);
    rows = await usage(job.id);
    assert.equal(rows.length, 1, "spend survives the user deleting the generation");
  });

  await t.test("free endpoint: recorded as source 'free' (also on failure); no provider call → no row", async (tt) => {
    quiet(tt);
    await query("DELETE FROM ai_usage WHERE source = 'free'");
    const deps = { policy: { ...FREE_LLM_DEFAULTS }, bucketPrefix: `aiusage-${Date.now()}:` };
    const out = await withFreeLlm({ endpoint: "udk", userId: uid }, async () => {
      jc.recordLlmUsage(USAGE);
      return "ok";
    }, deps);
    assert.equal(out, "ok");
    await assert.rejects(
      withFreeLlm({ endpoint: "outline", userId: uid }, async () => {
        jc.recordLlmUsage(USAGE);
        throw new Error("model fell over");
      }, deps),
      /model fell over/,
    );
    await withFreeLlm({ endpoint: "udk", userId: uid }, async () => "no provider call", deps);
    await au.flushAiUsage();
    const rows = await query<Row>("SELECT * FROM ai_usage WHERE source = 'free' ORDER BY id");
    assert.deepEqual(rows.map((r) => [r.outcome, r.tool_id, String(r.user_id), r.generation_id, Number(r.usd)]), [
      ["free", "free:udk", uid, null, 3],
      ["free", "free:outline", uid, null, 3],
    ]);
  });
});
