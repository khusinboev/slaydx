import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import type { CostJson } from "../lib/generation/types.ts";

/**
 * Computed cost caveats and the rollout-based coverage (`lib/server/admin-cost.ts`
 * `costCaveats`, `spendCoverage`, `spendRollout`) against a real Postgres (a
 * throwaway database). The old fixed list of ten sentences is gone: an item must
 * appear ONLY when it applies, with the real numbers.
 *
 * Mutations (each turned the named test red):
 *   - coverage counting historical jobs (drop the rollout filter): "coverage starts
 *     at the ai_usage rollout";
 *   - historical jobs alone raising the "yangi ishda" item: "historical jobs alone
 *     never raise the new-jobs item";
 *   - an unpriced part not flagged / listed: "unpriced LLM models and services".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("caveats") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const jc = await import("../lib/generation/job-cost.ts");
const { parseDateRange } = await import("../lib/server/admin-list.ts");
const cost = await import("../lib/server/admin-cost.ts");

/** A Tashkent wall-clock instant (UTC+5, no DST). */
const tk = (day: string, time: string): string => new Date(`${day}T${time}+05:00`).toISOString();
const SONNET = (inputTokens: number, outputTokens: number) => ({ provider: "anthropic", model: "claude-sonnet-5", inputTokens, outputTokens });

function meter(fill: (c: InstanceType<typeof jc.JobCost>) => void): CostJson {
  const c = new jc.JobCost();
  fill(c);
  return c.toJson();
}
const sonnetJob = (): CostJson => meter((c) => c.addLlm(SONNET(10_000, 2_000)));

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
}

test("computed caveats: rollout coverage, historical split, unpriced, estimated, grounding, free share", { skip }, async (t) => {
  quiet(t);
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const uid = (await queryOne<{ id: string }>(`INSERT INTO users (name) VALUES ('Caveats test') RETURNING id::text AS id`, []))!.id;

  async function gen(o: { tool: string; status?: string; finishedAt: string; costJson?: CostJson | null }): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, status, cost_json, created_at, finished_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz - interval '1 minute', $6::timestamptz)`,
      [id, uid, o.tool, o.status ?? "COMPLETED", o.costJson ? JSON.stringify(o.costJson) : null, o.finishedAt],
    );
    return id;
  }
  async function usage(o: { at: string; source?: "job" | "free"; outcome?: string; genId?: string | null; tool: string; cost: CostJson }) {
    await query(
      `INSERT INTO ai_usage (at, source, outcome, generation_id, user_id, tool_id, calls, input_tokens, output_tokens, usd, parts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [o.at, o.source ?? "job", o.outcome ?? "completed", o.genId ?? null, uid, o.tool, o.cost.calls, o.cost.inputTokens, o.cost.outputTokens, o.cost.usd, JSON.stringify(o.cost.parts ?? [])],
    );
  }
  const reset = async () => {
    await query(`DELETE FROM ai_usage`, []);
    await query(`DELETE FROM generations`, []);
  };

  const R = "2026-03-10"; // the rollout day: first ai_usage row at 09:00 Tashkent
  const rBefore = parseDateRange("2026-03-01", "2026-03-09");
  const rWide = parseDateRange("2026-03-01", "2026-03-20");

  await t.test("empty database: nothing applies → no caveats, no rollout", async () => {
    await reset();
    assert.equal(await cost.spendRollout(pool()), null);
    // Only the always-true notes (the retry gap, today's FX rate) remain.
    assert.deepEqual(await cost.costCaveats(pool(), rWide), [...cost.COST_CAVEATS]);
    const cov = await cost.spendCoverage(pool(), rWide);
    assert.deepEqual(cov, { jobsWithCost: 0, jobsCompleted: 0, pct: 0, rolloutAt: null, historicalCompleted: 0, historicalWithCost: 0 });
  });

  await t.test("no ai_usage row yet: jobs are not historical, coverage is the old cost_json share", async () => {
    await reset();
    await gen({ tool: "slide", finishedAt: tk("2026-03-05", "10:00:00"), costJson: sonnetJob() });
    await gen({ tool: "slide", finishedAt: tk("2026-03-05", "11:00:00"), costJson: null });
    const cov = await cost.spendCoverage(pool(), rWide);
    assert.deepEqual(cov, { jobsWithCost: 1, jobsCompleted: 2, pct: 50, rolloutAt: null, historicalCompleted: 0, historicalWithCost: 0 });
    const text = await cost.costCaveats(pool(), rWide);
    assert.equal(text.length, 1 + cost.COST_CAVEATS.length);
    assert.match(text[0], /^1 ta yangi ishda \(2 ta tugallangandan, 50,0%\) tannarx umuman yozilmagan: Slayd \(1\/2\)\./);
  });

  await t.test("the job behind the very first ai_usage row is current, not historical (its row lands after it finished)", async () => {
    await reset();
    const c = sonnetJob();
    const id = await gen({ tool: "slide", finishedAt: tk(R, "12:00:00"), costJson: c });
    await usage({ at: tk(R, "12:00:01"), genId: id, tool: "slide", cost: c });
    await gen({ tool: "slide", finishedAt: tk(R, "11:00:00"), costJson: null }); // an hour earlier: really historical
    assert.equal(await cost.spendRollout(pool()), tk(R, "12:00:00"));
    const cov = await cost.spendCoverage(pool(), rWide);
    assert.deepEqual([cov.jobsCompleted, cov.jobsWithCost, cov.historicalCompleted, cov.historicalWithCost], [1, 1, 1, 0]);
  });

  await t.test("coverage starts at the ai_usage rollout; earlier jobs are historical and reported apart", async () => {
    await reset();
    // Historical: 4 completed jobs before the rollout (only one kept a legacy cost_json).
    await gen({ tool: "article", finishedAt: tk("2026-03-02", "10:00:00"), costJson: sonnetJob() });
    for (let i = 0; i < 3; i++) await gen({ tool: "article", finishedAt: tk("2026-03-03", `1${i}:00:00`), costJson: null });
    // The rollout: the first ai_usage row (a free call).
    await usage({ at: tk(R, "09:00:00"), source: "free", outcome: "free", tool: "free:outline", cost: sonnetJob() });
    // Current: 3 completed jobs after it — two measured, one not (a Maqola).
    for (const tool of ["slide", "referat"]) {
      const c = sonnetJob();
      const id = await gen({ tool, finishedAt: tk(R, "12:00:00"), costJson: c });
      await usage({ at: tk(R, "12:00:01"), genId: id, tool, cost: c });
    }
    await gen({ tool: "article", finishedAt: tk(R, "13:00:00"), costJson: null });

    const rolloutAt = tk(R, "09:00:00");
    assert.equal(await cost.spendRollout(pool()), rolloutAt);
    const cov = await cost.spendCoverage(pool(), rWide);
    // MUTATION (rollout filter dropped): jobsCompleted 7, pct 4/7.
    assert.deepEqual(cov, { jobsWithCost: 2, jobsCompleted: 3, pct: (2 / 3) * 100, rolloutAt, historicalCompleted: 4, historicalWithCost: 1 });
    // A range that ends before the rollout has no current jobs at all.
    assert.deepEqual(await cost.spendCoverage(pool(), rBefore), { jobsWithCost: 0, jobsCompleted: 0, pct: 0, rolloutAt, historicalCompleted: 4, historicalWithCost: 1 });

    const byTool = await cost.spendCoverageByTool(pool(), rWide);
    assert.deepEqual(
      byTool.map((r) => [r.toolId, r.jobsWithCost, r.jobsCompleted, r.historicalCompleted, r.historicalWithCost]),
      [
        ["article", 0, 1, 4, 1],
        ["referat", 1, 1, 0, 0],
        ["slide", 1, 1, 0, 0],
      ],
    );

    const caveats = await cost.costCaveats(pool(), rWide);
    // new-jobs gap, historical gap, and the rollout's own free call ($0.04 of $0.16).
    assert.equal(caveats.length, 3 + cost.COST_CAVEATS.length, caveats.join("\n"));
    assert.deepEqual(caveats.slice(3), [...cost.COST_CAVEATS], "the always-true notes close the list");
    assert.ok(caveats[2].startsWith("Bepul AI so'rovlari") && caveats[2].includes("25,0%"), caveats[2]);
    assert.equal(
      caveats[0],
      "1 ta yangi ishda (3 ta tugallangandan, 33,3%) tannarx umuman yozilmagan: Maqola (0/1). Bu vositalarning tannarxi kam baholangan.",
    );
    assert.equal(
      caveats[1],
      "Tarixiy: AI xarajatlari hisobi ishga tushgunga (2026-03-10) qadar tugagan 4 ta ishning 3 tasida tannarx ma'lumoti yo'q. Ular qamrov ko'rsatkichiga kirmaydi va endi tuzatib bo'lmaydi.",
    );
  });

  await t.test("historical jobs alone never raise the new-jobs item (the false '88,5%' warning)", async () => {
    await reset();
    for (let i = 0; i < 9; i++) await gen({ tool: "slide", finishedAt: tk("2026-03-03", `0${i}:00:00`), costJson: null });
    await usage({ at: tk(R, "09:00:00"), source: "free", outcome: "free", tool: "free:polish", cost: sonnetJob() });
    const c = sonnetJob();
    const id = await gen({ tool: "slide", finishedAt: tk(R, "12:00:00"), costJson: c });
    await usage({ at: tk(R, "12:00:01"), genId: id, tool: "slide", cost: c });

    const cov = await cost.spendCoverage(pool(), rWide);
    assert.equal(cov.pct, 100, "every measurable job is covered");
    assert.equal(cov.historicalCompleted, 9);
    const caveats = await cost.costCaveats(pool(), rWide);
    assert.ok(!caveats.some((c) => c.includes("yangi ishda")), caveats.join("\n"));
    assert.ok(caveats.some((c) => c.startsWith("Tarixiy:") && c.includes("9 ta ishning 9 tasida")), caveats.join("\n"));
    // Historical jobs that kept a cost_json are not a gap: no «Tarixiy» item then.
    await query(`UPDATE generations SET cost_json = $1::jsonb WHERE finished_at < $2::timestamptz`, [JSON.stringify(sonnetJob()), tk(R, "00:00:00")]);
    assert.ok(!(await cost.costCaveats(pool(), rWide)).some((c) => c.startsWith("Tarixiy:")));
  });

  await t.test("unpriced LLM models and services are named, with call counts", async () => {
    await reset();
    const c = meter((m) => {
      m.addLlm(SONNET(1_000, 100));
      m.addLlm({ provider: "openrouter", model: "mystery-model", inputTokens: 100, outputTokens: 50 });
      m.addLlm({ provider: "openrouter", model: "mystery-model", inputTokens: 100, outputTokens: 50 });
      m.addUnpricedImage("fal", "fal-ai/flux/dev", 3);
      m.addTts("gemini", "gemini-3.1-flash-tts-preview", 500, 0, { priced: false });
      m.addTts("gemini", "gemini-3.1-flash-tts-preview", 500, 0, { priced: false });
    });
    const id = await gen({ tool: "podcast", finishedAt: tk(R, "12:00:00"), costJson: c });
    await usage({ at: tk(R, "12:00:01"), genId: id, tool: "podcast", cost: c });

    const caveats = await cost.costCaveats(pool(), rWide);
    assert.equal(
      caveats.find((x) => x.startsWith("Narxi noma'lum LLM modellari")),
      "Narxi noma'lum LLM modellari: openrouter:mystery-model (2 chaqiruv). Ular 0 dollar deb hisoblangan, haqiqiy xarajat yuqoriroq; model narxlar jadvaliga (llm-pricing.ts) qo'shilishi kerak.",
    );
    assert.equal(
      caveats.find((x) => x.startsWith("Narxlanmagan xizmatlar")),
      "Narxlanmagan xizmatlar: rasm fal:fal-ai/flux/dev (3 chaqiruv), ovoz (TTS) gemini:gemini-3.1-flash-tts-preview (2 chaqiruv). Ular 0 dollar deb yozilgan, haqiqiy xarajat yuqoriroq.",
    );
    // The priced Sonnet call is not accused of anything.
    assert.ok(!caveats.some((x) => x.includes("claude-sonnet-5")));
  });

  await t.test("estimated prices (unknown image model, TTS tokens from audio length) are listed apart", async () => {
    await reset();
    const c = meter((m) => {
      m.addImage("gemini", "gemini-9-image", 3);
      m.addTts("gemini", "gemini-2.5-flash-preview-tts", 400, 0.0037, { estimated: true, textTokens: 134, audioTokens: 375 });
    });
    const id = await gen({ tool: "greeting", finishedAt: tk(R, "12:00:00"), costJson: c });
    await usage({ at: tk(R, "12:00:01"), genId: id, tool: "greeting", cost: c });
    const caveats = await cost.costCaveats(pool(), rWide);
    assert.equal(
      caveats.find((x) => x.startsWith("Narxi taxminiy")),
      "Narxi taxminiy xizmatlar: rasm gemini:gemini-9-image (3 chaqiruv), ovoz (TTS) gemini:gemini-2.5-flash-preview-tts (1 chaqiruv). Narx standart qiymat yoki audio uzunligidan baholangan tokenlar bilan hisoblangan.",
    );
    // An estimate is priced, not «unpriced».
    assert.ok(!caveats.some((x) => x.startsWith("Narxlanmagan") || x.startsWith("Narxi noma'lum")));
  });

  await t.test("grounding is listed with the query count and cost; free-LLM share with its percentage", async () => {
    await reset();
    const c = meter((m) => {
      m.addLlm(SONNET(1_000_000, 100_000)); // 2 + 1 = $3.00
      m.addGrounding(3); // 3 × 0.014 = $0.042
    });
    const id = await gen({ tool: "pro-slide", finishedAt: tk(R, "12:00:00"), costJson: c });
    await usage({ at: tk(R, "12:00:01"), genId: id, tool: "pro-slide", cost: c });
    const free = meter((m) => m.addLlm(SONNET(500_000, 50_000))); // $1.50
    await usage({ at: tk(R, "13:00:00"), source: "free", outcome: "free", tool: "free:rewrite", cost: free });

    const caveats = await cost.costCaveats(pool(), rWide);
    assert.equal(
      caveats.find((x) => x.startsWith("Google qidiruvi")),
      "Google qidiruvi: 3 ta so'rov har biri $0.014 dan $0.0420 deb hisoblangan. Oyiga 5 000 ta bepul so'rov ayirilmagan, shuning uchun bu qism oshirib ko'rsatilgan.",
    );
    // total = 3.042 + 1.5 = 4.542; free share = 1.5 / 4.542 = 33.0%.
    assert.equal(
      caveats.find((x) => x.startsWith("Bepul AI so'rovlari")),
      "Bepul AI so'rovlari (reja, UDK, tuzatish, sayqal): 1 ta chaqiruv, $1.50 — jami AI xarajatining 33,0%. Bu xarajat hech bir vositaning tannarxiga kirmaydi.",
    );
    assert.equal(caveats.length, 2 + cost.COST_CAVEATS.length, caveats.join("\n"));
  });

  await t.test("a fully priced, fully covered period has only the always-true notes", async () => {
    await reset();
    const c = sonnetJob();
    const id = await gen({ tool: "slide", finishedAt: tk(R, "12:00:00"), costJson: c });
    await usage({ at: tk(R, "12:00:01"), genId: id, tool: "slide", cost: c });
    assert.deepEqual(await cost.costCaveats(pool(), rWide), [...cost.COST_CAVEATS]);
  });

  await t.test("a long list of unpriced names is capped, the rest summarised", async () => {
    await reset();
    const c = meter((m) => {
      for (let i = 0; i < 8; i++) m.addLlm({ provider: "openrouter", model: `m${i}`, inputTokens: 10, outputTokens: 5 });
    });
    await usage({ at: tk(R, "12:00:01"), source: "free", outcome: "free", tool: "free:polish", cost: c });
    const line = (await cost.costCaveats(pool(), rWide)).find((x) => x.startsWith("Narxi noma'lum LLM"))!;
    assert.match(line, /va yana 3 ta\./);
    assert.equal((line.match(/openrouter:m\d/g) ?? []).length, 5);
  });
});
