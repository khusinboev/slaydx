import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * `POST /api/generations` — `Idempotency-Key` (AUDIT prod-readiness W3-A,
 * C34 server: CONC-10, FE-06).
 *
 * Shartnoma (klient — W3-H): sarlavha `Idempotency-Key`, qiymati UUID v4.
 * Bir foydalanuvchi + bir kalit 24 soat ichida → o'sha generatsiya, o'sha
 * status kodi (202) va javob shakli; pul IKKINCHI marta yechilmaydi.
 * Ilgari kalit yo'q edi: COMMIT dan keyin javob yo'qolsa (502/504, tarmoq
 * uzilishi) foydalanuvchining qayta bosishi ikkinchi pullik ish yaratardi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("idem") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("POST /api/generations: Idempotency-Key", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const route = await import("../app/api/generations/route.ts");
  await migrate();
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
  const ESSAY = { slug: "essay", values: { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" } };
  const post = async (cookie: string, key?: string, body: unknown = ESSAY) => {
    const headers: Record<string, string> = { cookie, "content-type": "application/json" };
    if (key !== undefined) headers["idempotency-key"] = key;
    const req = new Request("http://localhost/api/generations", { method: "POST", headers, body: JSON.stringify(body) });
    const res = await inRequest(req, () => route.POST(req));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const balance = async (uid: string) => Number((await query<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))[0].balance);
  const rows = async (uid: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM generations WHERE user_id = $1`, [uid]))[0].n);
  const charges = async (uid: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'charge'`, [uid]))[0].n);

  await t.test("ketma-ket bir xil kalit → bitta ish, bitta yechim, aynan bir xil javob", async () => {
    const u = await mkUser("idem-seq");
    const key = randomUUID();
    const a = await post(u.cookie, key);
    const b = await post(u.cookie, key);
    assert.equal(a.status, 202, JSON.stringify(a.body));
    // MUTATSIYA: kalit e'tiborsiz → ikkinchi ish va ikkinchi yechim.
    assert.equal(b.status, 202, JSON.stringify(b.body));
    assert.deepEqual(b.body, a.body, "takroriy javob asl javobdan farq qildi");
    assert.equal(await rows(u.uid), 1);
    assert.equal(await charges(u.uid), 1);
    assert.equal(await balance(u.uid), 100_000 - Number(a.body.price));
    // Katta-kichik harf farqi — o'sha kalit.
    const c = await post(u.cookie, key.toUpperCase());
    assert.deepEqual(c.body, a.body);
    assert.equal(await rows(u.uid), 1);
  });

  await t.test("parallel bir xil kalit → bitta ish, bitta yechim, hammasiga bir xil id", async () => {
    const u = await mkUser("idem-par");
    const key = randomUUID();
    const burst = await Promise.all([post(u.cookie, key), post(u.cookie, key), post(u.cookie, key)]);
    for (const r of burst) assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(new Set(burst.map((r) => r.body.id)).size, 1, JSON.stringify(burst.map((r) => r.body)));
    assert.equal(await rows(u.uid), 1);
    assert.equal(await charges(u.uid), 1);
    assert.equal(await balance(u.uid), 100_000 - Number(burst[0].body.price));
  });

  await t.test("UNIQUE poygasi (23505): kalit boshqa tranzaksiyada qo'yilgan — pul rollback, o'sha ish qaytadi", async () => {
    const { enqueueGeneration } = await import("../lib/server/jobs.ts");
    const pg = (await import("pg")).default;
    const u = await mkUser("idem-race");
    const key = randomUUID();
    const rival = randomUUID();
    // Raqib tranzaksiya foydalanuvchi qulfini OLMAY kalitli qator qo'yadi va COMMIT ni kechiktiradi.
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      await other.query("BEGIN");
      await other.query(
        `INSERT INTO generations (id, user_id, tool_id, topic, price, format, idempotency_key)
         VALUES ($1, $2, 'essay', 'raqib', 3000, 'docx', $3)`,
        [rival, u.uid, key],
      );
      const pending = enqueueGeneration({
        userId: u.uid, toolId: "essay", topic: "Poyga", price: 3000, format: "docx",
        values: { topic: "Poyga" }, budgetMs: 60_000, idempotencyKey: key,
      });
      // Bizning INSERT UNIQUE indeksda raqibni kutib turadi.
      await new Promise((r) => setTimeout(r, 300));
      await other.query("COMMIT");
      const res = await pending;
      // MUTATSIYA: 23505 ushlanmasa — so'rov 500 bilan yiqiladi (pul rollback, lekin foydalanuvchi xato ko'radi).
      assert.deepEqual(res, { ok: true, id: rival, price: 3000, replayed: true });
    } finally {
      await other.end();
    }
    assert.equal(await rows(u.uid), 1);
    assert.equal(await charges(u.uid), 0, "poygada yutqazgan so'rovning yechimi rollback bo'lmadi");
    assert.equal(await balance(u.uid), 100_000);
  });

  await t.test("har xil kalit (va kalitsiz) → alohida ishlar", async () => {
    const u = await mkUser("idem-diff");
    const a = await post(u.cookie, randomUUID());
    const b = await post(u.cookie, randomUUID());
    const c = await post(u.cookie);
    for (const r of [a, b, c]) assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(new Set([a.body.id, b.body.id, c.body.id]).size, 3);
    assert.equal(await rows(u.uid), 3);
    assert.equal(await charges(u.uid), 3);
  });

  await t.test("kalit foydalanuvchiga bog'liq: boshqa foydalanuvchining o'sha kaliti — o'z ishi", async () => {
    const key = randomUUID();
    const u1 = await mkUser("idem-u1");
    const u2 = await mkUser("idem-u2");
    const a = await post(u1.cookie, key);
    const b = await post(u2.cookie, key);
    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    assert.notEqual(a.body.id, b.body.id, "begona foydalanuvchining ishi qaytdi");
    assert.equal(await rows(u2.uid), 1);
  });

  await t.test("24 soatdan eski kalit — yangi ish", async () => {
    const u = await mkUser("idem-old");
    const key = randomUUID();
    const a = await post(u.cookie, key);
    await query(`UPDATE generations SET created_at = now() - interval '25 hours' WHERE id = $1`, [a.body.id]);
    const b = await post(u.cookie, key);
    assert.equal(b.status, 202, JSON.stringify(b.body));
    assert.notEqual(b.body.id, a.body.id);
    assert.equal(await rows(u.uid), 2);
    assert.equal(await charges(u.uid), 2);
  });

  await t.test("noto'g'ri kalit → 400, pul ham, qator ham yo'q; boshqa vosita bilan o'sha kalit → 422", async () => {
    const u = await mkUser("idem-bad");
    const bad = await post(u.cookie, "salom");
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.equal(await rows(u.uid), 0);
    assert.equal(await charges(u.uid), 0);

    const key = randomUUID();
    assert.equal((await post(u.cookie, key)).status, 202);
    const other = await post(u.cookie, key, { slug: "essay", values: { ...ESSAY.values, topic: "Boshqa mavzu" } });
    // Bir xil vosita — kalit so'rovni aniqlaydi, asl ish qaytadi.
    assert.equal(other.status, 202);
    // Boshqa vosita: avval kalitsiz — so'rov o'zi yaroqli ekanini tasdiqlaymiz.
    const GLOSSARY = { slug: "glossary", values: { topic: "Informatika", university: "TATU", author: "Aliyev A." } };
    const plain = await post(u.cookie, undefined, GLOSSARY);
    assert.equal(plain.status, 202, JSON.stringify(plain.body));
    const clash = await post(u.cookie, key, GLOSSARY);
    assert.equal(clash.status, 422, JSON.stringify(clash.body));
    assert.equal(await rows(u.uid), 2);
    assert.equal(await charges(u.uid), 2);
  });
});
