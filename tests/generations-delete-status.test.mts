import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * `DELETE /api/generations/[id]` javob kodlari (AUDIT prod-readiness BEA-12).
 *
 * Ilgari `cancelGeneration` ham, `deleteGeneration` ham `false` qaytarsa
 * route HAR DOIM 409 «Ishlayotgan hujjatni o'chirib bo'lmaydi» berardi —
 * mavjud bo'lmagan, begona yoki allaqachon o'chirilgan id uchun ham
 * (ikkinchi bosish, ikki tab, tarmoq xatosidan keyin qayta urinish).
 * Endi: qator yo'q (yoki begona) → 404 «Topilmadi», faqat haqiqatan
 * IN_PROGRESS → 409.
 *
 * MUTATSIYA: route'dagi holat tekshiruvi olib tashlansa (eski «har doim
 * 409») — «noma'lum/begona/ikkinchi DELETE → 404» testi qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("gdel") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("DELETE /api/generations/[id]: 404 noma'lum/begona, 409 faqat ishlayotgan", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const route = await import("../app/api/generations/[id]/route.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async (name: string) => {
    const uid = String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
          [`${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
        )
      )[0].id,
    );
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const mkGen = async (uid: string, status: string) => {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status) VALUES ($1, $2, 'essay', 'x', $3)`,
      [id, uid, status],
    );
    return id;
  };
  const del = async (cookie: string, id: string) => {
    const req = new Request(`http://localhost/api/generations/${id}`, { method: "DELETE", headers: { cookie } });
    const res = await inRequest(req, () => route.DELETE(req, { params: Promise.resolve({ id }) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const me = await mkUser("gdel-me");
  const other = await mkUser("gdel-other");

  await t.test("noma'lum id → 404", async () => {
    const r = await del(me.cookie, randomUUID());
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.error, "Topilmadi");
  });

  await t.test("begona id → 404 (begona qator o'chmaydi)", async () => {
    const foreign = await mkGen(other.uid, "COMPLETED");
    const r = await del(me.cookie, foreign);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    const left = await query(`SELECT 1 FROM generations WHERE id = $1`, [foreign]);
    assert.equal(left.length, 1);
  });

  await t.test("ikkinchi DELETE → 200 keyin 404", async () => {
    const id = await mkGen(me.uid, "COMPLETED");
    assert.equal((await del(me.cookie, id)).status, 200);
    const again = await del(me.cookie, id);
    assert.equal(again.status, 404, JSON.stringify(again.body));
  });

  await t.test("haqiqatan ishlayotgan (IN_PROGRESS) → 409, qator joyida", async () => {
    const id = await mkGen(me.uid, "IN_PROGRESS");
    const r = await del(me.cookie, id);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, "Ishlayotgan hujjatni o'chirib bo'lmaydi");
    assert.equal((await query(`SELECT 1 FROM generations WHERE id = $1`, [id])).length, 1);
  });
});
