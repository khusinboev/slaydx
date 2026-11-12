/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Work rating service + web API (docs/ratings/GENERATION-RATING.md) on a real, isolated Postgres:
 * `lib/server/generation-ratings.ts` and `GET/PUT /api/generations/[id]/rating` through the real
 * route handlers (session cookie, same-origin check, error shapes).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `AND g.user_id = $2` dropped from the INSERT ... SELECT      -> «ownership in SQL»;
 *   2. `AND g.status = 'COMPLETED'` dropped                        -> «only COMPLETED»;
 *   3. `ON CONFLICT ... DO UPDATE` turned into DO NOTHING           -> «re-rate updates the row»;
 *   4. `checkReason` accepts a reason for 4-5 stars                 -> «validation» (and the CHECK catches it too);
 *   5. `checkRate` not called                                       -> «rate limit»;
 *   6. `hideForeign` removed from the route                         -> «API: a foreign id is a plain 404»;
 *   7. the summary counts `<= 2` as low                              -> «summary per tool».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.WORKER_INLINE = "false";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("genrating") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const dbm = await import("../lib/server/db.ts");
if (!skip) await dbm.migrate();
const svc = await import("../lib/server/generation-ratings.ts");
const { GenerationRatingError, rateGeneration, setRatingReason, getGenerationRating, ratingSummary, RATING_WRITES_PER_HOUR } = svc;

after(async () => {
  if (skip) return;
  await dbm.pool().end();
  await iso.drop();
});

let seq = 0;
type U = { id: string; cookie: string };

async function mkUser(): Promise<U> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const [row] = await dbm.query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'Baho Sinov') RETURNING id::text AS id", [`gr-${process.pid}-${seq++}`]);
  return { id: row!.id, cookie: `${SESSION_COOKIE}=${(await createSession(row!.id)).token}` };
}

async function mkGen(userId: string, o: { tool?: string; status?: string; topic?: string } = {}): Promise<string> {
  const id = randomUUID();
  await dbm.query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, format, file_name) VALUES ($1, $2, $3, $4, $5, 'pptx', 'x.pptx')`,
    [id, userId, o.tool ?? "slide", o.topic ?? "Quyosh tizimi", o.status ?? "COMPLETED"],
  );
  return id;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof GenerationRatingError, `GenerationRatingError expected, got ${e}`);
    return e.code;
  }
  assert.fail("expected a refusal");
}

const rowOf = async (gen: string, user: string) =>
  (await dbm.query<any>("SELECT stars, reason, comment, source, created_at, updated_at FROM generation_ratings WHERE generation_id = $1 AND user_id = $2", [gen, user]))[0] ?? null;

/* ───────────────────────── service ───────────────────────── */

test("rate: stores the owner's rating of a COMPLETED work", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  assert.equal(await getGenerationRating(u.id, gen), null, "nothing before the first rating");
  const r = await rateGeneration({ userId: u.id, generationId: gen, stars: 2, reason: "images", comment: "  Rasmlar mavzuga mos emas  ", source: "web" });
  assert.equal(r.stars, 2);
  assert.equal(r.reason, "images");
  assert.equal(r.comment, "Rasmlar mavzuga mos emas", "trimmed");
  assert.equal(r.source, "web");
  const row = await rowOf(gen, u.id);
  assert.equal(row.stars, 2);
  assert.equal(row.reason, "images");
  assert.deepEqual(await getGenerationRating(u.id, gen), r);
});

test("ownership in SQL: someone else's generation is refused and nothing is written — MUTATSIYA 1", { skip }, async () => {
  const owner = await mkUser();
  const other = await mkUser();
  const gen = await mkGen(owner.id);
  assert.equal(await code(rateGeneration({ userId: other.id, generationId: gen, stars: 5, source: "bot" })), "not_owner");
  assert.equal(await code(setRatingReason({ userId: other.id, generationId: gen, reason: "text", source: "bot" })), "not_owner");
  assert.equal(await code(getGenerationRating(other.id, gen)), "not_owner");
  assert.equal((await dbm.query("SELECT 1 FROM generation_ratings WHERE generation_id = $1", [gen])).length, 0);
  // The owner's own rating is not touched by a foreign attempt either.
  await rateGeneration({ userId: owner.id, generationId: gen, stars: 1, source: "bot" });
  await code(rateGeneration({ userId: other.id, generationId: gen, stars: 5, source: "bot" }));
  assert.equal((await rowOf(gen, owner.id)).stars, 1);
  assert.equal((await dbm.query("SELECT 1 FROM generation_ratings WHERE generation_id = $1", [gen])).length, 1);
});

test("only COMPLETED: queued, running, failed, revoked works are refused — MUTATSIYA 2", { skip }, async () => {
  const u = await mkUser();
  for (const status of ["QUEUED", "IN_PROGRESS", "FAILED", "REVOKED"]) {
    const gen = await mkGen(u.id, { status });
    assert.equal(await code(rateGeneration({ userId: u.id, generationId: gen, stars: 4, source: "web" })), "not_ready", status);
    assert.equal(await rowOf(gen, u.id), null, status);
  }
});

test("missing or malformed generation: not_found", { skip }, async () => {
  const u = await mkUser();
  assert.equal(await code(rateGeneration({ userId: u.id, generationId: randomUUID(), stars: 4, source: "web" })), "not_found");
  assert.equal(await code(rateGeneration({ userId: u.id, generationId: "not-a-uuid", stars: 4, source: "web" })), "not_found");
  assert.equal(await code(getGenerationRating(u.id, randomUUID())), "not_found");
});

test("re-rate updates the row: the last value wins, created_at stays — MUTATSIYA 3", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  await rateGeneration({ userId: u.id, generationId: gen, stars: 2, reason: "design", comment: "Ranglar", source: "web" });
  const first = await rowOf(gen, u.id);
  await dbm.query("UPDATE generation_ratings SET updated_at = now() - interval '1 hour', created_at = now() - interval '1 hour' WHERE generation_id = $1", [gen]);
  const r = await rateGeneration({ userId: u.id, generationId: gen, stars: 5, source: "bot" });
  assert.equal(r.stars, 5);
  assert.equal(r.reason, null, "a re-rate replaces the whole value");
  assert.equal(r.comment, null);
  assert.equal(r.source, "bot");
  const row = await rowOf(gen, u.id);
  assert.equal(row.stars, 5);
  assert.ok(new Date(row.updated_at).getTime() > new Date(row.created_at).getTime(), "updated_at moves, created_at does not");
  assert.ok(first);
  assert.equal((await dbm.query("SELECT 1 FROM generation_ratings WHERE generation_id = $1", [gen])).length, 1, "still one row");
});

test("setRatingReason: only the reason of a 1-3 rating changes; null = skip; 4-5 refuses", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  assert.equal(await code(setRatingReason({ userId: u.id, generationId: gen, reason: "text", source: "bot" })), "not_rated");
  await rateGeneration({ userId: u.id, generationId: gen, stars: 3, comment: "Matn qisqa", source: "web" });
  const r = await setRatingReason({ userId: u.id, generationId: gen, reason: "text", source: "bot" });
  assert.deepEqual([r.stars, r.reason, r.comment, r.source], [3, "text", "Matn qisqa", "bot"]);
  assert.equal((await setRatingReason({ userId: u.id, generationId: gen, reason: null, source: "bot" })).reason, null, "skip clears it");
  await rateGeneration({ userId: u.id, generationId: gen, stars: 4, source: "bot" });
  assert.equal(await code(setRatingReason({ userId: u.id, generationId: gen, reason: "design", source: "bot" })), "reason_needs_low");
  assert.equal((await rowOf(gen, u.id)).reason, null);
});

test("validation: stars, reason (fixed set, 1-3 only), comment ≤ 500, source — MUTATSIYA 4", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const base = { userId: u.id, generationId: gen, source: "web" };
  for (const stars of [0, 6, 2.5, "5", null, undefined]) assert.equal(await code(rateGeneration({ ...base, stars })), "bad_stars", String(stars));
  assert.equal(await code(rateGeneration({ ...base, stars: 2, reason: "price" })), "bad_reason");
  assert.equal(await code(rateGeneration({ ...base, stars: 5, reason: "design" })), "reason_needs_low");
  assert.equal(await code(rateGeneration({ ...base, stars: 4, reason: "text" })), "reason_needs_low");
  assert.equal(await code(rateGeneration({ ...base, stars: 2, comment: 42 })), "bad_comment");
  assert.equal(await code(rateGeneration({ ...base, stars: 2, comment: "a".repeat(501) })), "bad_comment");
  assert.equal(await code(rateGeneration({ ...base, stars: 2, source: "admin" })), "bad_source");
  assert.equal(await rowOf(gen, u.id), null, "no refused value was written");
  assert.equal((await rateGeneration({ ...base, stars: 2, comment: "b".repeat(500) })).comment!.length, 500, "exactly 500 is fine");
  assert.equal((await rateGeneration({ ...base, stars: 3, comment: "   " })).comment, null, "a blank comment is no comment");
  // The table refuses what the service would: a reason on a high rating.
  await assert.rejects(dbm.query("UPDATE generation_ratings SET stars = 5, reason = 'design' WHERE generation_id = $1", [gen]), /generation_ratings_reason_check/);
});

test("rate limit: 30 writes per hour per user, then rate_limited — MUTATSIYA 5", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  for (let i = 0; i < RATING_WRITES_PER_HOUR; i++) await rateGeneration({ userId: u.id, generationId: gen, stars: (i % 5) + 1, source: "bot" });
  assert.equal(await code(rateGeneration({ userId: u.id, generationId: gen, stars: 5, source: "bot" })), "rate_limited");
  assert.equal(await code(setRatingReason({ userId: u.id, generationId: gen, reason: null, source: "bot" })), "rate_limited");
  // Another user's budget is separate.
  const v = await mkUser();
  assert.equal((await rateGeneration({ userId: v.id, generationId: await mkGen(v.id), stars: 5, source: "bot" })).stars, 5);
});

test("a deleted generation takes its rating with it (ON DELETE CASCADE)", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  await rateGeneration({ userId: u.id, generationId: gen, stars: 4, source: "bot" });
  await dbm.query("DELETE FROM generations WHERE id = $1", [gen]);
  assert.equal((await dbm.query("SELECT 1 FROM generation_ratings WHERE generation_id = $1", [gen])).length, 0);
});

/* ───────────────────────── admin summary ───────────────────────── */

test("summary: empty window", { skip }, async () => {
  const s = await ratingSummary({ from: "2001-01-01T00:00:00Z", to: "2001-02-01T00:00:00Z" });
  assert.deepEqual(s, { from: "2001-01-01T00:00:00.000Z", to: "2001-02-01T00:00:00.000Z", count: 0, average: null, low: 0, tools: [], recentLow: [] });
});

test("summary per tool: count, average, distribution, low share, reasons, latest ≤ 3 lows; window by updated_at — MUTATSIYA 7", { skip }, async () => {
  // Own window far in the past so the other tests' rows never fall in it.
  const at = (d: string) => `2002-03-${d}T10:00:00Z`;
  const u = await mkUser();
  const put = async (tool: string, stars: number, reason: string | null, day: string, topic = `Mavzu ${tool} ${stars} ${day}`) => {
    const gen = await mkGen(u.id, { tool, topic });
    await dbm.query("INSERT INTO generation_ratings (generation_id, user_id, stars, reason, source, created_at, updated_at) VALUES ($1, $2, $3, $4, 'bot', $5, $5)", [
      gen,
      u.id,
      stars,
      reason,
      at(day),
    ]);
    return gen;
  };
  await put("slide", 5, null, "01");
  await put("slide", 4, null, "02");
  const s3 = await put("slide", 3, "images", "03");
  const s1 = await put("slide", 1, "images", "04");
  const s2 = await put("slide", 2, "design", "05");
  const s1b = await put("slide", 1, null, "06");
  const r2 = await put("referat", 2, "text", "07");
  await put("referat", 5, null, "08");
  await put("slide", 1, "errors", "28"); // outside [01, 20)
  const s = await ratingSummary({ from: at("01"), to: "2002-03-20T00:00:00Z" });
  assert.equal(s.count, 8);
  assert.equal(s.low, 5);
  assert.equal(s.average, Math.round(((5 + 4 + 3 + 1 + 2 + 1 + 2 + 5) / 8) * 100) / 100);
  assert.deepEqual(s.tools.map((t) => t.toolId), ["slide", "referat"], "busiest first");
  const slide = s.tools[0]!;
  assert.equal(slide.count, 6);
  assert.equal(slide.average, Math.round((16 / 6) * 100) / 100);
  assert.deepEqual(slide.distribution, [2, 1, 1, 1, 1]);
  assert.equal(slide.low, 4);
  assert.equal(slide.lowShare, 0.67);
  assert.deepEqual(slide.reasons, { design: 1, images: 2, text: 0, errors: 0, other: 0 });
  assert.deepEqual(slide.latestLow.map((l) => l.generationId), [s1b, s2, s1], "the newest three lows of the tool");
  assert.equal(slide.latestLow[1]!.topic, "Mavzu slide 2 05");
  assert.equal(slide.latestLow[1]!.reason, "design");
  assert.notEqual(slide.latestLow.at(-1)!.generationId, s3);
  const ref = s.tools[1]!;
  assert.deepEqual([ref.count, ref.average, ref.low, ref.lowShare], [2, 3.5, 1, 0.5]);
  assert.deepEqual(ref.latestLow.map((l) => l.generationId), [r2]);
  assert.deepEqual(s.recentLow.map((l) => l.generationId), [r2, s1b, s2, s1, s3]);
  assert.deepEqual((await ratingSummary({ from: at("01"), to: "2002-03-20T00:00:00Z", lowLimit: 2 })).recentLow.map((l) => l.generationId), [r2, s1b]);
});

/* ───────────────────────── API ───────────────────────── */

const URL_BASE = "http://localhost:3000";
function req(path: string, o: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}): Request {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin) headers.origin = o.origin;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${URL_BASE}${path}`, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
}

async function api(method: "GET" | "PUT", id: string, o: { cookie?: string; body?: unknown; origin?: string } = {}) {
  const route = await import("../app/api/generations/[id]/rating/route.ts");
  const r = req(`/api/generations/${id}/rating`, { method, ...o });
  const res = await inRequest(r, () => (route[method] as (q: Request, c: unknown) => Promise<Response>)(r, { params: Promise.resolve({ id }) }));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

test("API: GET before / after, PUT rates and re-rates through the same service", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  assert.deepEqual(await api("GET", gen, { cookie: u.cookie }), { status: 200, body: { rating: null, rateable: true } });
  const put = await api("PUT", gen, { cookie: u.cookie, body: { stars: 3, reason: "errors", comment: "Imlo xatolari" } });
  assert.equal(put.status, 200);
  assert.deepEqual([put.body.rating.stars, put.body.rating.reason, put.body.rating.comment, put.body.rating.source], [3, "errors", "Imlo xatolari", "web"]);
  const again = await api("PUT", gen, { cookie: u.cookie, body: { stars: 5 } });
  assert.equal(again.body.rating.stars, 5);
  assert.equal(again.body.rating.reason, null);
  const got = await api("GET", gen, { cookie: u.cookie });
  assert.equal(got.body.rating.stars, 5);
  assert.equal(got.body.rateable, true);
  const running = await mkGen(u.id, { status: "IN_PROGRESS" });
  assert.deepEqual(await api("GET", running, { cookie: u.cookie }), { status: 200, body: { rating: null, rateable: false } });
  const refused = await api("PUT", running, { cookie: u.cookie, body: { stars: 5 } });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "not_ready");
});

test("API: a foreign id is a plain 404 (never «not yours»); bad input 400 with a code; no session 401; cross-site 403 — MUTATSIYA 6", { skip }, async () => {
  const owner = await mkUser();
  const other = await mkUser();
  const gen = await mkGen(owner.id);
  for (const method of ["GET", "PUT"] as const) {
    const r = await api(method, gen, { cookie: other.cookie, body: method === "PUT" ? { stars: 5 } : undefined });
    assert.equal(r.status, 404, method);
    assert.equal(r.body.code, "not_found", `${method}: the same answer as a missing id`);
    assert.equal(r.body.error, "Topilmadi");
  }
  assert.equal((await api("GET", randomUUID(), { cookie: owner.cookie })).body.code, "not_found");
  assert.equal((await api("GET", "abc", { cookie: owner.cookie })).status, 400);
  const bad = await api("PUT", gen, { cookie: owner.cookie, body: { stars: 7 } });
  assert.deepEqual([bad.status, bad.body.code], [400, "bad_stars"]);
  const high = await api("PUT", gen, { cookie: owner.cookie, body: { stars: 5, reason: "design" } });
  assert.deepEqual([high.status, high.body.code], [400, "reason_needs_low"]);
  assert.equal((await api("GET", gen)).status, 401);
  assert.equal((await api("PUT", gen, { cookie: owner.cookie, body: { stars: 5 }, origin: "https://evil.example" })).status, 403);
  assert.equal(await rowOf(gen, owner.id), null, "nothing was written by any refused call");
});
