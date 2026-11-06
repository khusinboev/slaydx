import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * `GET /api/media/active-jobs` on an isolated Postgres (docs/studio/P11-SPEC.md «C. Reliability»), the REAL route with a
 * real session: a refresh brings back the caller's own unfinished Studio jobs and nothing else.
 *
 * Mutations (each turned the named test red, then restored):
 *   `user_id = $1` dropped from the SQL                                       -> «only the caller's own»;
 *   `status IN (...)` dropped                                                 -> «only unfinished»;
 *   `tool_id = ANY` dropped                                                   -> «only Studio tools»;
 *   `ORDER BY created_at DESC` -> `ASC`                                       -> «newest first»;
 *   `purpose` no longer read from `studioPurposeOf`                           -> «what a tab needs».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("activejobs") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  return mod;
}
after(async () => {
  if (!dbReady) return;
  const { stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  stopProviderKeyRefresh();
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function mkUser(): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Jobs', 0, 0, 0) RETURNING id", [`jobs-${process.pid}-${seq++}`]))[0]!.id);
}
async function mkJob(userId: string, tool: string, status: string, values: Record<string, unknown> = {}, topic = "ish", ageSec = 0): Promise<string> {
  const { query } = await db();
  const id = randomUUID();
  await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, values_json, created_at) VALUES ($1, $2, $3, $4, $5, 2600, 'png', $6::jsonb, now() - make_interval(secs => $7))`, [id, userId, tool, topic, status, JSON.stringify(values), ageSec]);
  return id;
}
async function get(userId: string | null) {
  const route = await import("../app/api/media/active-jobs/route.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const headers: Record<string, string> = userId ? { cookie: `${SESSION_COOKIE}=${(await createSession(userId)).token}` } : {};
  const req = new Request("http://localhost/api/media/active-jobs", { headers });
  const res = await inRequest(req, () => route.GET(req));
  return { status: res.status, body: (await res.json()) as { items: { id: string; tool: string; modelId: string; modelLabel: string; prompt: string; price: number; purpose: string | null; sent: Record<string, unknown> }[] } };
}

test("signed out: 401, nothing listed", { skip }, async () => {
  assert.equal((await get(null)).status, 401);
});

test("only the caller's own jobs", { skip }, async () => {
  const me = await mkUser();
  const other = await mkUser();
  const mine = await mkJob(me, "studio-image", "QUEUED");
  await mkJob(other, "studio-image", "IN_PROGRESS");
  assert.deepEqual((await get(me)).body.items.map((j) => j.id), [mine]);
});

test("only unfinished jobs, and only Studio tools", { skip }, async () => {
  const me = await mkUser();
  const queued = await mkJob(me, "studio-video", "QUEUED");
  const running = await mkJob(me, "studio-dub", "IN_PROGRESS");
  for (const s of ["COMPLETED", "FAILED", "REVOKED"]) await mkJob(me, "studio-video", s);
  await mkJob(me, "slide", "IN_PROGRESS");
  await mkJob(me, "podcast", "IN_PROGRESS");
  await mkJob(me, "studio-voice", "IN_PROGRESS");
  assert.deepEqual(new Set((await get(me)).body.items.map((j) => j.id)), new Set([queued, running]));
});

test("newest first", { skip }, async () => {
  const me = await mkUser();
  const old = await mkJob(me, "studio-speech", "QUEUED", {}, "a", 60);
  const fresh = await mkJob(me, "studio-speech", "QUEUED", {}, "b", 1);
  assert.deepEqual((await get(me)).body.items.map((j) => j.id), [fresh, old]);
});

test("what a tab needs: the model, the price, the request, the purpose of a picture job", { skip }, async () => {
  const me = await mkUser();
  const { STUDIO_IMAGE_PURPOSE, MEDIA_CATALOG, studioPurposeOf } = await import("../lib/media/catalog.ts");
  const { MIX_MODES } = await import("../lib/media/catalog-mix.ts");
  const edit = MEDIA_CATALOG.clientView().find((e) => studioPurposeOf(e.id) === "studio.edit")!;
  const draw = MEDIA_CATALOG.clientView().find((e) => studioPurposeOf(e.id) === STUDIO_IMAGE_PURPOSE)!;
  const sent = { modelId: edit.id, prompt: "fonni almashtir", inputImages: "abc" };
  const a = await mkJob(me, "studio-image", "QUEUED", sent, "fonni almashtir", 3);
  const b = await mkJob(me, "studio-image", "QUEUED", { modelId: draw.id }, "rasm", 2);
  const c = await mkJob(me, "studio-mix", "QUEUED", { modelId: MIX_MODES[0]!.model }, "m", 1);
  const items = (await get(me)).body.items;
  const by = (id: string) => items.find((j) => j.id === id)!;
  assert.deepEqual(by(a), { id: a, tool: "studio-image", modelId: edit.id, modelLabel: edit.label, prompt: "fonni almashtir", price: 2600, purpose: "studio.edit", sent });
  assert.equal(by(b).purpose, STUDIO_IMAGE_PURPOSE);
  assert.equal(by(c).modelLabel, "Montaj");
  assert.equal(by(c).purpose, null);
});
