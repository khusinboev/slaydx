import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P7b favourites (docs/studio/P7-SPEC.md «P7b»): `PUT` / `DELETE /api/media/favorites/<generationId>` and the
 * gallery's `favorite` flag + `?favorites=1` filter, on a real Postgres (own isolated database).
 *
 * Locked here:
 *   - star / un-star my own finished Studio result (every Studio tool): idempotent, answers `{ id, favorite }`, the
 *     state survives a fresh read (the gallery says `favorite: true`);
 *   - OWNERSHIP in SQL: another user's generation, a non-Studio job, an unfinished job, a malformed or unknown id are a
 *     404 and write nothing; un-starring never removes another user's star;
 *   - the gallery: every item carries `favorite`, `?favorites=1` lists only my starred items, newest first, paged with
 *     the same keyset cursor, never another user's star;
 *   - the rows go with the generation and with the user (ON DELETE CASCADE);
 *   - 401 without a session.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `setFavorite` star CTE without `AND user_id = $1`                       -> «ownership»;
 *   2. star CTE without the `tool_id = ANY(...)` predicate                     -> «ownership» (the «rasm» job);
 *   3. star CTE without `status = 'COMPLETED'`                                 -> «ownership» (the queued job);
 *   4. un-star DELETE without `f.user_id = $1`                                 -> «ownership» (the other user's star);
 *   5. gallery filter `NOT $5::boolean OR` → `$5::boolean OR` (filter ignored) -> «gallery filter»;
 *   6. gallery `favorite` EXISTS without `f.user_id = $1`                      -> «gallery filter» (other user's star shows);
 *   7. route `favorites` read from `=== "true"` instead of `=== "1"`            -> «gallery filter».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiofav") : { isolated: false, drop: async () => {} };
const skipDb = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  return mod;
}
after(async () => {
  if (!dbReady) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function mkUser(): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'Fav') RETURNING id", [`fav-${process.pid}-${seq++}`]))[0]!.id);
}
async function cookieOf(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function gen(userId: string, o: { tool?: string; status?: string; minutesAgo?: number } = {}): Promise<string> {
  const { query } = await db();
  const id = randomUUID();
  const doc = { imageModel: "google/nano-banana", imagePrompt: `p ${seq}`, images: [{ id: "a", url: `/api/generations/${id}/assets/abc123`, w: 1, h: 1 }] };
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json, created_at)
     VALUES ($1, $2, $3, 'T', $4, 900, 'png', $5::jsonb, now() - $6::int * interval '1 minute')`,
    [id, userId, o.tool ?? "studio-image", o.status ?? "COMPLETED", JSON.stringify(doc), o.minutesAgo ?? 0],
  );
  return id;
}

async function star(cookie: string | null, id: string, on = true) {
  const route = await import("../app/api/media/favorites/[id]/route.ts");
  const req = new Request(`http://localhost/api/media/favorites/${id}`, { method: on ? "PUT" : "DELETE", headers: cookie ? { cookie } : {} });
  const ctx = { params: Promise.resolve({ id }) };
  const r = await inRequest(req, () => (on ? route.PUT(req, ctx) : route.DELETE(req, ctx)));
  return { status: r.status, body: (await r.json()) as { id?: string; favorite?: boolean; code?: string } };
}

type Page = { items: { id: string; favorite: boolean }[]; nextCursor: string | null };
async function gallery(cookie: string, query = ""): Promise<Page> {
  const route = await import("../app/api/media/gallery/route.ts");
  const req = new Request(`http://localhost/api/media/gallery${query}`, { headers: { cookie } });
  const r = await inRequest(req, () => route.GET(req));
  assert.equal(r.status, 200, `gallery ${query}`);
  return (await r.json()) as Page;
}

async function starsOf(userId: string): Promise<string[]> {
  const { query } = await db();
  return (await query<{ g: string }>("SELECT generation_id::text AS g FROM studio_favorites WHERE user_id = $1 ORDER BY generation_id", [userId])).map((r) => r.g);
}

test("star / un-star my own result: idempotent, every Studio tool, the state survives a fresh read", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const cookie = await cookieOf(me);
  const ids = [await gen(me), await gen(me, { tool: "studio-video" }), await gen(me, { tool: "studio-speech" }), await gen(me, { tool: "studio-audio" })];
  for (const id of ids) {
    const r = await star(cookie, id);
    assert.equal(r.status, 200, `star ${id}`);
    assert.deepEqual(r.body, { id, favorite: true });
  }
  assert.equal((await star(cookie, ids[0]!)).status, 200, "a second star is a no-op");
  assert.deepEqual(await starsOf(me), [...ids].sort(), "one row per starred generation");
  const g = await gallery(cookie);
  assert.deepEqual(g.items.filter((i) => i.favorite).map((i) => i.id).sort(), [...ids].sort(), "the gallery reads the stars back");
  // Upper-case ids are the same generation.
  assert.deepEqual((await star(cookie, ids[1]!.toUpperCase(), false)).body, { id: ids[1], favorite: false });
  assert.equal((await star(cookie, ids[1]!, false)).status, 200, "un-starring twice is a no-op");
  assert.deepEqual(await starsOf(me), [ids[0], ids[2], ids[3]].sort());
  assert.equal((await star(null, ids[0]!)).status, 401);
});

test("ownership: another user's, a non-Studio, an unfinished, an unknown or malformed id are a 404 and write nothing", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const other = await mkUser();
  const cookie = await cookieOf(me);
  const theirs = await gen(other);
  const rasm = await gen(me, { tool: "image" });
  const queued = await gen(me, { status: "QUEUED" });
  for (const id of [theirs, rasm, queued, randomUUID(), "not-a-uuid", "1; DROP TABLE studio_favorites"]) {
    const r = await star(cookie, id);
    assert.equal(r.status, 404, `star ${id}`);
    assert.equal(r.body.code, "not_found");
  }
  assert.deepEqual(await starsOf(me), [], "nothing was written for me");
  assert.deepEqual(await starsOf(other), [], "nothing was written for them");
  // Their own star stays when I «un-star» their generation (a 404, and their row is untouched).
  assert.equal((await star(await cookieOf(other), theirs)).status, 200);
  assert.equal((await star(cookie, theirs, false)).status, 404);
  assert.deepEqual(await starsOf(other), [theirs]);
});

test("gallery filter: ?favorites=1 lists only my starred items, newest first, keyset-paged; never another user's star", { skip: skipDb }, async (t) => {
  quiet(t);
  const me = await mkUser();
  const other = await mkUser();
  const cookie = await cookieOf(me);
  const mine: string[] = [];
  for (let i = 0; i < 30; i++) mine.push(await gen(me, { minutesAgo: i }));
  // Every second one starred: 15 starred, newest first.
  const starred = mine.filter((_, i) => i % 2 === 0);
  for (const id of starred) assert.equal((await star(cookie, id)).status, 200);
  // Another user stars nothing of mine (they cannot) — but stars their own, and the filter never shows it to me.
  const theirs = await gen(other);
  assert.equal((await star(await cookieOf(other), theirs)).status, 200);

  const all = await gallery(cookie);
  assert.equal(all.items.length, 24, "the unfiltered gallery is unchanged");
  assert.deepEqual(all.items.map((i) => i.favorite), mine.slice(0, 24).map((_, i) => i % 2 === 0), "each item carries its own flag");

  const page = await gallery(cookie, "?favorites=1");
  assert.deepEqual(page.items.map((i) => i.id), starred, "only my starred items, newest first");
  assert.ok(page.items.every((i) => i.favorite));
  assert.equal(page.nextCursor, null);
  assert.ok(!page.items.some((i) => i.id === theirs));

  // Keyset paging of the filtered list: 24 + the rest.
  for (let i = 0; i < 20; i++) {
    const id = await gen(me, { minutesAgo: 100 + i });
    assert.equal((await star(cookie, id)).status, 200);
    starred.push(id);
  }
  const p1 = await gallery(cookie, "?favorites=1");
  assert.equal(p1.items.length, 24);
  assert.ok(p1.nextCursor);
  const p2 = await gallery(cookie, `?favorites=1&cursor=${encodeURIComponent(p1.nextCursor!)}`);
  assert.deepEqual([...p1.items, ...p2.items].map((i) => i.id), starred, "the second page continues the filtered list");
  assert.equal(p2.nextCursor, null);
  // The other user's filtered gallery: only their own star.
  assert.deepEqual((await gallery(await cookieOf(other), "?favorites=1")).items.map((i) => i.id), [theirs]);
});

test("cascade: a deleted generation or user takes its stars with it", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const me = await mkUser();
  const cookie = await cookieOf(me);
  const a = await gen(me);
  const b = await gen(me);
  await star(cookie, a);
  await star(cookie, b);
  await query("DELETE FROM generations WHERE id = $1", [a]);
  assert.deepEqual(await starsOf(me), [b]);
  await query("DELETE FROM users WHERE id = $1", [me]);
  assert.deepEqual(await starsOf(me), []);
});
