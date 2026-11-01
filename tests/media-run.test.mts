import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import type { AdapterInput, MediaAdapter } from "../lib/studio-core/index.ts";

/**
 * `runMedia` (lib/server/media/run.ts): one sync call through the core, recorded in `media_jobs` inside a job.
 *
 * Mutations (each turned the named step red, then restored): `{ ...params, ...i.extra }` → `params` -> "extra reaches
 * the adapter"; `upstream` hook ignored -> "upstream override"; failMediaJob call removed -> "failure is recorded".
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("mediarun") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function adapter(seen: AdapterInput[], fail?: Error): MediaAdapter {
  return {
    id: "google-image",
    configured: () => true,
    submit: async (input) => {
      seen.push(input);
      if (fail) throw fail;
      return { done: [{ kind: "inline", bytes: PNG, mime: "image/png" }] };
    },
    fetchOutput: async () => PNG,
  };
}

test("runMedia: outside a job — no rows, extra + upstream reach the adapter", async () => {
  const { runMedia } = await import("../lib/server/media/run.ts");
  const seen: AdapterInput[] = [];
  const out = await runMedia({
    purpose: "rasm.image",
    modelId: "google/nano-banana",
    values: { imageCount: "2", imageStyle: "pencil" },
    extra: { prompt: "FULL PROMPT", width: 1024 },
    step: "image:0",
    adapters: { "google-image": adapter(seen) },
    upstream: () => "gemini-3.1-flash-image",
  });
  assert.equal(out.outputs.length, 1);
  assert.equal(seen[0].upstreamModel, "gemini-3.1-flash-image", "upstream override");
  assert.equal(seen[0].params.prompt, "FULL PROMPT", "extra reaches the adapter");
  assert.equal(seen[0].params.imageCount, 2);
  assert.equal(seen[0].idempotencyKey, "adhoc:image:0");
  await assert.rejects(runMedia({ purpose: "rasm.image", modelId: "nope/x", values: {}, step: "s", adapters: {} }), /unknown model/);
});

test("runMedia: inside a job — succeeded and failed rows", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { runMedia } = await import("../lib/server/media/run.ts");
  const { withMediaContext } = await import("../lib/media/context.ts");
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const { MediaError } = await import("../lib/studio-core/index.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const [user] = await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ('media-run', 'T', 0, 0, 0) RETURNING id");
  const gen = randomUUID();
  await query("INSERT INTO generations (id, user_id, tool_id, status) VALUES ($1, $2, 'image', 'IN_PROGRESS')", [gen, user.id]);
  const ctx = { generationId: gen, core: { image: true, video: false, speech: false } };
  await withMediaContext(ctx, () => runMedia({ purpose: "rasm.image", modelId: "google/nano-banana", values: { imageCount: 1 }, step: "image:0", adapters: { "google-image": adapter([]) } }));
  await assert.rejects(
    withMediaContext(ctx, () => runMedia({ purpose: "rasm.image", modelId: "google/nano-banana", values: { imageCount: 1 }, step: "image:1", adapters: { "google-image": adapter([], new MediaError("gemini", "403 blocked")) } })),
    /blocked/,
  );
  const rows = await mediaJobsOf(gen);
  assert.deepEqual(rows.map((r) => [r.idempotency_key, r.status]), [[`${gen}:image:0`, "succeeded"], [`${gen}:image:1`, "failed"]]);
  assert.deepEqual(rows[0].outputs, [{ mime: "image/png", size: PNG.byteLength }]);
  assert.equal(Number((rows[0] as unknown as { cost_usd: string }).cost_usd), 0.034);
  assert.match(rows[1].last_error ?? "", /403 blocked/, "failure is recorded");
});
