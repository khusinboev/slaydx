import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * PROGRESS ORQAGA KETMAYDI (AUDIT prod-readiness BEB-07, W4-B).
 *
 * Ilgari ish qayta olinganda (`reclaimStaleJobs` yoki SIGTERM `releaseJobs`
 * dan keyin) `claimJob` `progress = 5, step = 'Boshlandi'` yozardi: 60% ni
 * ko'rib turgan foydalanuvchi uni 5% ga qaytganini ko'rardi, yangi yurishning
 * soxta egri chizig'i / jonli dekasi (`plan` = 2%) / dvigatel bosqichlari esa
 * pastdan qayta ko'tarilardi.
 *
 * Endi:
 *   - `claimJob`: qayta olishda progress SAQLANADI (`GREATEST`), bosqich aniq
 *     «Qayta boshlandi»; qaytgan `progressFloor`/`restarted`;
 *   - worker'ning uch yozuvchisi (`progressTicker`, `onStage`, `LiveReporter`)
 *     `monotonicProgress` orqali — `progressFloor` dan past yozmaydi, qayta
 *     olingan ishda bosqich «Qayta boshlandi» bo'lib turadi; oshgach — odatdagidek.
 *
 * Haqiqiy Postgres, alohida baza.
 * MUTATSIYA: `claimJob` dagi `GREATEST(g.progress, 5)` → `5` — «qayta olish»
 * testi; `monotonicProgress` ning `progress >= floor` shoxi har doim
 * tanlansa — ticker/jonli deka/onStage testlari qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("prmono") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("qayta olingan ishda progress monoton", { skip }, async (t) => {
  const { query, queryOne, migrate, pool } = await import("../lib/server/db.ts");
  const jobs = await import("../lib/server/jobs.ts");
  const worker = await import("../lib/server/worker.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });

  const uid = String(
    (await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ('prmono', 'T') RETURNING id`))[0].id,
  );
  const state = async (id: string) => {
    const r = await queryOne<{ progress: number; step: string }>(`SELECT progress, step FROM generations WHERE id = $1`, [id]);
    return { progress: r!.progress, step: r!.step };
  };
  const mkQueued = async (toolId = "essay") => {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, step, budget_ms) VALUES ($1, $2, $3, 'x', 'Navbatga qo''yildi', 60000)`,
      [id, uid, toolId],
    );
    return id;
  };
  /** Ish 60% gacha borib, `via` bilan navbatga qaytadi va qayta olinadi. */
  const restartAt60 = async (via: "reclaimStaleJobs" | "releaseJobs", toolId = "essay") => {
    const id = await mkQueued(toolId);
    const first = (await jobs.claimJob(jobs.newLease("w1")))!;
    assert.equal(first.id, id);
    await jobs.setProgress(id, first.lease, 60, "Bob yozilmoqda");
    if (via === "reclaimStaleJobs") {
      await query(`UPDATE generations SET locked_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      await jobs.reclaimStaleJobs();
      await query(`UPDATE generations SET run_after = now() WHERE id = $1`, [id]);
    } else {
      assert.deepEqual(await jobs.releaseJobs([first.lease]), [id]);
    }
    assert.equal((await state(id)).progress, 60, "navbatga qaytganda progress tushmasligi kerak");
    const second = (await jobs.claimJob(jobs.newLease("w2")))!;
    assert.equal(second.id, id);
    return second;
  };

  await t.test("birinchi olish: 5% «Boshlandi», restarted=false", async () => {
    const id = await mkQueued();
    const job = (await jobs.claimJob(jobs.newLease("w1")))!;
    assert.equal(job.id, id);
    assert.deepEqual(await state(id), { progress: 5, step: "Boshlandi" });
    assert.equal(job.progressFloor, 5);
    assert.equal(job.restarted, false);
    await jobs.failJob(id, job.lease, "x");
  });

  for (const via of ["reclaimStaleJobs", "releaseJobs"] as const) {
    await t.test(`${via} → qayta olish: progress 60 saqlanadi, «Qayta boshlandi»`, async () => {
      const job = await restartAt60(via);
      assert.deepEqual(await state(job.id), { progress: 60, step: jobs.RESTART_STEP });
      assert.equal(job.progressFloor, 60);
      assert.equal(job.restarted, true);
      await jobs.failJob(job.id, job.lease, "x");
    });
  }

  await t.test("progressTicker: soxta egri chiziq 5 dan boshlanadi — bazada 60 qoladi", async (tt) => {
    const job = await restartAt60("reclaimStaleJobs");
    await query(`UPDATE generations SET locked_at = now() - interval '1 minute' WHERE id = $1`, [job.id]);
    tt.mock.timers.enable({ apis: ["setInterval"] });
    const stop = worker.progressTicker(job, null);
    tt.mock.timers.tick(2000);
    await sleep(150);
    stop();
    tt.mock.timers.reset();
    const r = await queryOne<{ progress: number; step: string; fresh: boolean }>(
      `SELECT progress, step, locked_at > now() - interval '30 seconds' AS fresh FROM generations WHERE id = $1`,
      [job.id],
    );
    assert.equal(r!.fresh, true, "ticker yozmadi (test yaroqsiz)");
    assert.deepEqual({ progress: r!.progress, step: r!.step }, { progress: 60, step: jobs.RESTART_STEP });
    await jobs.failJob(job.id, job.lease, "x");
  });

  await t.test("LiveReporter: `plan` (2%) — bazada 60, «Qayta boshlandi»; oshgach odatdagidek", async () => {
    const job = await restartAt60("releaseJobs", "slide");
    const r = new LiveReporter(job.id, job.lease, job);
    r.sink({ type: "plan", slides: [], roles: [], meta: {} as never, theme: "atlas", template: "lecture" } as never);
    await r.stop();
    assert.deepEqual(await state(job.id), { progress: 60, step: jobs.RESTART_STEP });
    // Monotonlik faqat pastga — yuqori qiymat o'tadi.
    assert.deepEqual(jobs.monotonicProgress(job, 72, "Rasmlar"), { progress: 72, step: "Rasmlar" });
    // Birinchi yurish: 2% < 5% — qiymat 5, bosqich dekaniki (qayta boshlanmagan).
    assert.deepEqual(jobs.monotonicProgress({ progressFloor: 5, restarted: false }, 2, "Reja"), { progress: 5, step: "Reja" });
    await jobs.failJob(job.id, job.lease, "x");
  });

  await t.test("onStage (runJob): past bosqich 60 dan tushirmaydi, yuqorisi yoziladi", async () => {
    const job = await restartAt60("reclaimStaleJobs");
    const seen: Array<{ progress: number; step: string }> = [];
    await worker.runJob(job, {
      hardStopMs: 30_000,
      build: (async (_tool: unknown, _values: unknown, opts: { onStage?: (e: { progress: number; step: string }) => void }) => {
        opts.onStage?.({ progress: 12, step: "Reja tuzilmoqda" });
        await sleep(150);
        seen.push(await state(job.id));
        opts.onStage?.({ progress: 70, step: "Xulosa" });
        await sleep(150);
        seen.push(await state(job.id));
        throw new Error("sinov: to'xtatildi");
      }) as never,
    });
    assert.deepEqual(seen, [
      { progress: 60, step: jobs.RESTART_STEP },
      { progress: 70, step: "Xulosa" },
    ]);
  });
});
