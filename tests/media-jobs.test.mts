import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `media_jobs` DAO (migration 065, docs/studio/P0-SPEC.md §5) on a real isolated Postgres.
 *
 * Mutations (each turned the named step red, then restored): `ON CONFLICT … DO NOTHING` → plain INSERT -> "idempotent
 * begin"; `AND status <> 'succeeded'` dropped from failMediaJob -> "a finished row is never failed"; scrubSecrets
 * skipped -> "errors are scrubbed".
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("mediajobs") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

test("media_jobs: begin / park / finish / fail", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const jobs = await import("../lib/server/media/jobs.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const [user] = await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ('media-jobs', 'T', 0, 0, 0) RETURNING id");
  const gen = randomUUID();
  await query("INSERT INTO generations (id, user_id, tool_id, status) VALUES ($1, $2, 'image', 'IN_PROGRESS')", [gen, user.id]);
  const base = { generationId: gen, purpose: "rasm.image", modelId: "google/nano-banana", provider: "gemini", upstreamModel: "gemini-3.1-flash-lite-image", params: { imageCount: 2 }, costUsd: 0.068 };

  await t.test("idempotent begin", async () => {
    const a = await jobs.beginMediaJob({ ...base, idempotencyKey: `${gen}:image:0` });
    assert.equal(a.fresh, true);
    assert.equal(a.row.status, "submitting");
    assert.equal(a.row.attempts, 1);
    const b = await jobs.beginMediaJob({ ...base, idempotencyKey: `${gen}:image:0` });
    assert.equal(b.fresh, false);
    assert.equal(b.row.id, a.row.id);
    assert.equal(b.row.attempts, 2);
    const [{ n }] = await query<{ n: string }>("SELECT count(*) AS n FROM media_jobs WHERE generation_id = $1", [gen]);
    assert.equal(Number(n), 1);
  });

  await t.test("park then finish", async () => {
    const { row } = await jobs.beginMediaJob({ ...base, idempotencyKey: `${gen}:video:0` });
    await jobs.parkMediaJob(row.id, "op-123", new Date(Date.now() + 5000));
    const parked = (await jobs.mediaJobsOf(gen)).find((r) => r.id === row.id)!;
    assert.equal(parked.status, "pending");
    assert.equal(parked.op_id, "op-123");
    await jobs.finishMediaJob(row.id, [{ mime: "video/mp4", size: 10, sha256: "ab" }]);
    const done = (await jobs.mediaJobsOf(gen)).find((r) => r.id === row.id)!;
    assert.equal(done.status, "succeeded");
    assert.equal(done.next_poll_at, null);
    assert.deepEqual(done.outputs, [{ mime: "video/mp4", size: 10, sha256: "ab" }]);
  });

  await t.test("a finished row is never failed", async () => {
    const { row } = await jobs.beginMediaJob({ ...base, idempotencyKey: `${gen}:image:1` });
    await jobs.finishMediaJob(row.id, [{ mime: "image/png", size: 1 }]);
    await jobs.failMediaJob(row.id, "late error");
    const r = (await jobs.mediaJobsOf(gen)).find((x) => x.id === row.id)!;
    assert.equal(r.status, "succeeded");
    assert.equal(r.last_error, null);
  });

  await t.test("errors are scrubbed", async () => {
    const { row } = await jobs.beginMediaJob({ ...base, idempotencyKey: `${gen}:image:2` });
    await jobs.failMediaJob(row.id, "401 for key sk-secret-123456 Bearer abc.def", ["sk-secret-123456"]);
    const r = (await jobs.mediaJobsOf(gen)).find((x) => x.id === row.id)!;
    assert.equal(r.status, "failed");
    assert.equal(r.errors, 1);
    assert.ok(!r.last_error!.includes("sk-secret-123456") && !r.last_error!.includes("abc.def"), r.last_error!);
  });

  await t.test("rows go with their generation", async () => {
    await query("DELETE FROM generations WHERE id = $1", [gen]);
    assert.equal((await jobs.mediaJobsOf(gen)).length, 0);
  });
});
