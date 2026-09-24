import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * `Idempotency-Key` + BOSHQA so'rov tanasi → 422 (W3-A review nit 4, W4-B).
 *
 * Ilgari kalit faqat VOSITA bo'yicha solishtirilardi: bir xil kalit bilan
 * boshqa mavzu (boshqa `values`) yuborilsa, server jim holda ASL ishni
 * qaytarardi — klient yangi hujjat buyurtma qildim deb o'ylardi. Stripe
 * uslubi: kalit AYNAN bitta so'rovga tegishli; tana farq qilsa 422.
 * Tana = vosita + tozalangan `values` (JSONB tengligi — kalitlar tartibi
 * ahamiyatsiz).
 *
 * MUTATSIYA: `findByIdempotencyKey` dagi `values_json = $4::jsonb`
 * solishtiruvi `true` bilan almashtirilsa — «boshqa values → 422» qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("idempay") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("Idempotency-Key: tana farq qilsa 422, bir xil tana (kalit tartibi boshqa) — takror", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const { enqueueGeneration } = await import("../lib/server/jobs.ts");
  const route = await import("../app/api/generations/route.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 10, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async (name: string) => {
    const uid = String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`,
          [`${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
        )
      )[0].id,
    );
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const post = async (cookie: string, key: string, body: unknown) => {
    const headers: Record<string, string> = { cookie, "content-type": "application/json", "idempotency-key": key };
    const req = new Request("http://localhost/api/generations", { method: "POST", headers, body: JSON.stringify(body) });
    const res = await inRequest(req, () => route.POST(req));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const count = async (uid: string, sql: string) => Number((await query<{ n: string }>(sql, [uid]))[0].n);
  const rows = (uid: string) => count(uid, `SELECT count(*) AS n FROM generations WHERE user_id = $1`);
  const charges = (uid: string) => count(uid, `SELECT count(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'charge'`);

  await t.test("route: bir xil kalit, boshqa mavzu → 422, ikkinchi ish/yechim yo'q", async () => {
    const u = await mkUser("idp-route");
    const key = randomUUID();
    const a = await post(u.cookie, key, { slug: "essay", values: { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" } });
    assert.equal(a.status, 202, JSON.stringify(a.body));
    const b = await post(u.cookie, key, { slug: "essay", values: { topic: "Boshqa mavzu", essayContext: "academic", essayKind: "argumentative" } });
    assert.equal(b.status, 422, JSON.stringify(b.body));
    assert.equal(await rows(u.uid), 1);
    assert.equal(await charges(u.uid), 1);
  });

  await t.test("route: bir xil tana, kalitlar tartibi boshqa → 202 takror (o'sha id)", async () => {
    const u = await mkUser("idp-order");
    const key = randomUUID();
    const a = await post(u.cookie, key, { slug: "essay", values: { topic: "Tartib", essayContext: "academic", essayKind: "argumentative" } });
    const b = await post(u.cookie, key, { slug: "essay", values: { essayKind: "argumentative", essayContext: "academic", topic: "Tartib" } });
    assert.equal(a.status, 202, JSON.stringify(a.body));
    assert.equal(b.status, 202, JSON.stringify(b.body));
    assert.deepEqual(b.body, a.body);
    assert.equal(await charges(u.uid), 1);
  });

  await t.test("enqueueGeneration: UNIQUE poygasi (23505) yo'lida ham tana solishtiriladi", async () => {
    const pg = (await import("pg")).default;
    const u = await mkUser("idp-race");
    const key = randomUUID();
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      await other.query("BEGIN");
      await other.query(
        `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, idempotency_key)
         VALUES ($1, $2, 'essay', 'raqib', 3000, 'docx', '{"topic":"Raqib"}'::jsonb, $3)`,
        [randomUUID(), u.uid, key],
      );
      const pending = enqueueGeneration({
        userId: u.uid, toolId: "essay", topic: "Poyga", price: 3000, format: "docx",
        values: { topic: "Poyga" }, budgetMs: 60_000, idempotencyKey: key,
      });
      await new Promise((r) => setTimeout(r, 300));
      await other.query("COMMIT");
      assert.deepEqual(await pending, { ok: false, reason: "idempotency_conflict" });
    } finally {
      await other.end();
    }
    assert.equal(await charges(u.uid), 0, "rad etilgan so'rovning yechimi rollback bo'lmadi");
  });
});
