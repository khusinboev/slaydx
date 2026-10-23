import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * GRADUATION PORTRAIT — the paid flow end to end on a real (isolated) Postgres, Gemini stubbed at fetch:
 *   route:  selfie required and must be the caller's own; price per variant (2 000 / 4 000) is charged;
 *   worker: success -> pictures stored, the selfie is DELETED; no picture (no clear face) -> FAILED, full
 *           refund, selfie kept for a retry; 2 asked, 1 came -> COMPLETED + the difference refunded.
 *
 * Mutations (by hand): drop the `deleteUserPhoto` call in the worker -> "selfie deleted" goes red; drop the
 * `photoExists` guard in the route -> "foreign / missing selfie" goes red; make the engine return an empty
 * file instead of throwing -> the refund case goes red.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("portflow") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(n, 3)]);
const OUT_B64 = JPEG(3000).toString("base64");
const imageBody = () => ({ steps: [{ type: "message", content: [{ data: OUT_B64, mime_type: "image/jpeg" }] }] });
const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as never;

test("graduation portrait: route guards, charge, worker delete-after-success, refunds", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  const worker = await import("../lib/server/worker.ts");
  const { getGeneration } = await import("../lib/server/jobs.ts");
  const { recentTransactions } = await import("../lib/server/credits.ts");
  const { photoExists, deleteUserPhoto } = await import("../lib/server/photo.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  const realFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    await pool().end();
    await iso.drop();
  });

  let n = 0;
  const mkUser = async () =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`, [`portrait-${Date.now()}-${n++}`]))[0].id);
  const mkPhoto = async (userId: string, assetId: string, original?: string) => {
    await query(`INSERT INTO photo_uploads (user_id, asset_id, kind, mime, size_bytes, bytes, original_asset_id) VALUES ($1,$2,'crop','image/jpeg',$3,$4,$5)`, [userId, assetId, 1000, JPEG(1000), original ?? null]);
  };
  const balanceOf = async (userId: string) => Number((await query<{ b: string }>(`SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1`, [userId]))[0].b);
  const post = async (userId: string, values: Record<string, unknown>) => {
    const { token } = await createSession(userId);
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "portrait", values }),
    });
    const r = await inRequest(req, () => route.POST(req));
    return { status: r.status, body: (await r.json()) as { id?: string; error?: string } };
  };
  const clearQueue = () => query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
  const runOne = async (id: string) => {
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    await worker.runJob(job!);
  };

  const PHOTO = "0123456789abcdef01234567";
  const ORIGINAL = "fedcba9876543210fedcba98";
  const FORM = { gown: "navy", background: "library", sash: "gold", variants: 1 };

  await t.test("route: no selfie / missing selfie / someone else's selfie -> 400, nothing charged", async () => {
    await clearQueue();
    const me = await mkUser();
    const other = await mkUser();
    await mkPhoto(other, PHOTO);
    const before = await balanceOf(me);
    const none = await post(me, FORM);
    assert.equal(none.status, 400);
    assert.match(String(none.body.error), /Surat/);
    const missing = await post(me, { ...FORM, photoAssetId: PHOTO });
    assert.equal(missing.status, 400, "the selfie of ANOTHER user must not be usable");
    assert.match(String(missing.body.error), /Surat topilmadi/);
    assert.equal(await balanceOf(me), before);
  });

  await t.test("route: own selfie -> queued and charged per variant (2 000 / 4 000)", async () => {
    await clearQueue();
    const me = await mkUser();
    await mkPhoto(me, PHOTO);
    const b0 = await balanceOf(me);
    const one = await post(me, { ...FORM, photoAssetId: PHOTO });
    assert.equal(one.status, 202, JSON.stringify(one.body));
    assert.equal(b0 - (await balanceOf(me)), 2000);
    const b1 = await balanceOf(me);
    const two = await post(me, { ...FORM, variants: 2, photoAssetId: PHOTO });
    assert.equal(two.status, 202, JSON.stringify(two.body));
    assert.equal(b1 - (await balanceOf(me)), 4000);
    const row = (await query<{ values_json: Record<string, unknown> }>(`SELECT values_json FROM generations WHERE id = $1`, [two.body.id]))[0];
    assert.equal(row.values_json.variants, 2);
    assert.equal(row.values_json.photoAssetId, PHOTO);
  });

  await t.test("worker success: the picture is stored, the selfie (and its original) are deleted", async () => {
    await clearQueue();
    const me = await mkUser();
    await mkPhoto(me, ORIGINAL);
    await mkPhoto(me, PHOTO, ORIGINAL);
    const bodies: Array<{ input: Array<Record<string, unknown>> }> = [];
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return res(200, imageBody());
    }) as unknown as typeof fetch;
    const r = await post(me, { ...FORM, photoAssetId: PHOTO });
    assert.equal(r.status, 202);
    await runOne(r.body.id!);
    const gen = await getGeneration(r.body.id!, me);
    assert.equal(gen?.status, "COMPLETED", String(gen?.error));
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].input[0].type, "image", "the selfie from photo_uploads reached the model");
    assert.ok(String(bodies[0].input[1].text).includes("deep navy blue"));
    assert.equal(await photoExists(me, PHOTO), false, "selfie deleted after success");
    assert.equal(await photoExists(me, ORIGINAL), false, "stored original deleted too");
    assert.equal(gen?.doc?.images?.length, 1);
    assert.ok(!JSON.stringify(gen?.doc).includes(JPEG(1000).toString("base64").slice(0, 80)), "selfie bytes are not in the result");
  });

  await t.test("worker: the model returns no picture (no clear face) -> FAILED, full refund, selfie kept for a retry", async () => {
    await clearQueue();
    const me = await mkUser();
    await mkPhoto(me, PHOTO);
    globalThis.fetch = (async () => res(200, { status: "completed", steps: [{ type: "message", content: [{ type: "text", text: "No clear face." }] }] })) as unknown as typeof fetch;
    const before = await balanceOf(me);
    const r = await post(me, { ...FORM, photoAssetId: PHOTO });
    assert.equal(r.status, 202);
    await runOne(r.body.id!);
    const gen = await getGeneration(r.body.id!, me);
    assert.equal(gen?.status, "FAILED");
    assert.match(String(gen?.error), /aniq yuz/);
    assert.equal(await balanceOf(me), before, "the whole price came back");
    assert.ok((await recentTransactions(me)).some((x) => x.kind === "refund"));
    assert.equal(await photoExists(me, PHOTO), true, "selfie kept: the user can retry without re-uploading");
  });

  await t.test("worker: 2 variants paid, 1 came -> COMPLETED and the difference (2 000) is refunded", async () => {
    await clearQueue();
    const me = await mkUser();
    await mkPhoto(me, PHOTO);
    let calls = 0;
    globalThis.fetch = (async () => (++calls === 1 ? res(200, imageBody()) : res(500, { error: "boom" }))) as unknown as typeof fetch;
    const before = await balanceOf(me);
    const r = await post(me, { ...FORM, variants: 2, photoAssetId: PHOTO });
    assert.equal(r.status, 202);
    await runOne(r.body.id!);
    const gen = await getGeneration(r.body.id!, me);
    assert.equal(gen?.status, "COMPLETED", String(gen?.error));
    assert.equal(before - (await balanceOf(me)), 2000, "net cost = one picture");
    assert.deepEqual(gen?.delivered, { got: 1, want: 2 });
  });

  await t.test("deleteUserPhoto: another user's selfie is never touched", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await mkPhoto(a, "aaaaaaaaaaaaaaaaaaaaaaaa");
    assert.equal(await deleteUserPhoto(b, "aaaaaaaaaaaaaaaaaaaaaaaa"), 0);
    assert.equal(await photoExists(a, "aaaaaaaaaaaaaaaaaaaaaaaa"), true);
    assert.equal(await deleteUserPhoto(a, "aaaaaaaaaaaaaaaaaaaaaaaa"), 1);
  });
});
