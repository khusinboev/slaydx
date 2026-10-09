import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * VOICE CHOICE — SERVER VALIDATION AND JOB VALUES (`POST /api/generations`).
 *
 * Contract: for the two audio tools the route turns `values.voice` into `female` | `male`
 * BEFORE the job is stored — a missing field (an old cached client) and an unknown value
 * both become `female`, and the stored `generations.values_json.voice` is the normalized
 * value (the worker reads the job's values, so what is stored is what is synthesized).
 * Like the other audio params (`mode`, `podcastType`, `durationMin`) a bad value is
 * normalized, not rejected: the request still succeeds and is charged once.
 * Non-audio tools are left alone (no `voice` key is invented).
 *
 * Mutations: (1) delete the normalization line in `app/api/generations/route.ts` -> the
 * "bad value / missing" cases store `robot` / no key; (2) normalize for every tool ->
 * the essay case gains a `voice` key.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("voiceroute") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

test("POST /api/generations: voice is female|male in the stored job values", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  // One fresh user per request: the route rate-limits a user to 5 creations a minute.
  let n = 0;
  const post = async (slug: string, values: Record<string, unknown>) => {
    const uid = String(
      (await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 1000000) RETURNING id`, [`voice-${Date.now()}-${n++}`]))[0].id,
    );
    const { token } = await createSession(uid);
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ slug, values }),
    });
    const res = await inRequest(req, () => route.POST(req));
    return { status: res.status, body: (await res.json()) as { id?: string; error?: string } };
  };
  const stored = async (id: string) => (await query<{ values_json: Record<string, unknown> }>(`SELECT values_json FROM generations WHERE id = $1`, [id]))[0].values_json;

  const podcast = { topic: "Sun'iy intellekt ta'limda", mode: "topic", podcastType: "intervyu", durationMin: 2, language: "uz" };
  const greeting = { recipient: "Dilnoza opa", relation: "ustozim", occasion: "ustoz-kuni", durationMin: 1, language: "uz" };

  for (const [slug, base] of [["podcast", podcast], ["greeting", greeting]] as const) {
    await t.test(`${slug}: male is stored as male`, async () => {
      const r = await post(slug, { ...base, voice: "male" });
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.equal((await stored(r.body.id!)).voice, "male");
    });
    await t.test(`${slug}: female is stored as female`, async () => {
      const r = await post(slug, { ...base, voice: "female" });
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.equal((await stored(r.body.id!)).voice, "female");
    });
    await t.test(`${slug}: an old client (no voice field) is stored as female`, async () => {
      const r = await post(slug, { ...base });
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.equal((await stored(r.body.id!)).voice, "female");
    });
    for (const bad of ["robot", "", "MALE ", 7, true, null]) {
      await t.test(`${slug}: bad value ${JSON.stringify(bad)} is normalized (male-with-spaces is still male, the rest female)`, async () => {
        const r = await post(slug, { ...base, voice: bad });
        assert.equal(r.status, 202, JSON.stringify(r.body));
        assert.equal((await stored(r.body.id!)).voice, bad === "MALE " ? "male" : "female");
      });
    }
  }

  await t.test("a non-audio tool does not get a voice key", async () => {
    const r = await post("essay", { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative", voice: "male" });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const values = await stored(r.body.id!);
    // The client sent `voice`; the route did not normalize it for a tool that has no such field.
    assert.equal(values.voice, "male");
    const r2 = await post("essay", { topic: "Suv aylanishi 2", essayContext: "academic", essayKind: "argumentative" });
    assert.ok(!("voice" in (await stored(r2.body.id!))), "no voice key may be invented for an essay");
  });
});
