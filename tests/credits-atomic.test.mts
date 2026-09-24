import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * PUL YO'LLARI ATOMAR (AUDIT prod-readiness W3-A, C25 qolgani).
 *
 * 1. Bekor qilish + qaytarish BITTA tranzaksiyada (`cancelGeneration`,
 *    `DELETE /api/generations/{id}`). Ilgari REVOKED alohida COMMIT
 *    bo'lardi, pul esa keyin qaytardi — orada xato bo'lsa ish REVOKED,
 *    pul qaytmagan (tiklash skaneri faqat FAILED ni ko'radi) va qayta
 *    urinish endi QUEUED emasligi uchun hech narsa qilmasdi.
 * 2. `activatePro` (CONC-14): kvota va obuna muddati BITTA tranzaksiyada.
 *    Ilgari kvota COMMIT bo'lib, plan UPDATE yiqilsa provayderning qayta
 *    urinishi `topUp` «allaqachon» deb qaytardi — obuna hech qachon yoqilmasdi.
 *
 * Xato orada TRIGGER bilan kiritiladi (alohida bazada).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("catomic") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q (trigger kerak)";

test("pul yo'llari atomar: bekor qilish + qaytarish, activatePro", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { enqueueGeneration } = await import("../lib/server/jobs.ts");
  const { activatePro } = await import("../lib/server/credits.ts");
  const route = await import("../app/api/generations/[id]/route.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async (name: string, balance = 10_000) => {
    const uid = String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, $2) RETURNING id`,
          [`${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, balance],
        )
      )[0].id,
    );
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const del = async (id: string, cookie: string) => {
    const req = new Request(`http://localhost/api/generations/${id}`, { method: "DELETE", headers: { cookie } });
    const res = await inRequest(req, () => route.DELETE(req, { params: Promise.resolve({ id }) }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const balance = async (uid: string) => Number((await query<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))[0].balance);
  const status = async (id: string) => (await query<{ status: string }>(`SELECT status FROM generations WHERE id = $1`, [id]))[0]?.status ?? null;
  const refunds = async (id: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE kind = 'refund' AND reference = $1`, [id]))[0].n);

  await query(`CREATE OR REPLACE FUNCTION w3a_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'w3a: kiritilgan xato'; END $$`);

  await t.test("bekor qilish: qaytarish yiqilsa — ish QUEUED qoladi, pul yo'q; qayta urinish bir marta qaytaradi", async (tt) => {
    tt.mock.method(console, "error", () => {});
    const u = await mkUser("cancel");
    const r = await enqueueGeneration({
      userId: u.uid, toolId: "essay", topic: "Bekor", price: 3000, format: "docx", values: { topic: "Bekor" }, budgetMs: 60_000,
    });
    assert.ok(r.ok);
    assert.equal(await balance(u.uid), 7000);

    await query(`CREATE TRIGGER w3a_refund_fail BEFORE INSERT ON transactions
                   FOR EACH ROW WHEN (NEW.kind = 'refund') EXECUTE FUNCTION w3a_fail()`);
    const failed = await del(r.id, u.cookie);
    await query(`DROP TRIGGER w3a_refund_fail ON transactions`);
    assert.equal(failed.status, 500, JSON.stringify(failed.body));
    // MUTATSIYA: REVOKED va qaytarish alohida COMMIT → holat REVOKED, pul qaytmagan.
    assert.equal(await status(r.id), "QUEUED", "qaytarish yiqildi, lekin ish REVOKED bo'lib qoldi");
    assert.equal(await refunds(r.id), 0);
    assert.equal(await balance(u.uid), 7000);

    // Teskari tartib: ikkala yozuvdan KEYIN (COMMIT paytida) xato — pul ham qaytmasligi kerak,
    // aks holda ish QUEUED qolib bepul bajarilardi.
    await query(`CREATE CONSTRAINT TRIGGER w3a_revoke_fail AFTER UPDATE ON generations
                   DEFERRABLE INITIALLY DEFERRED
                   FOR EACH ROW WHEN (NEW.status = 'REVOKED') EXECUTE FUNCTION w3a_fail()`);
    const failedLate = await del(r.id, u.cookie);
    await query(`DROP TRIGGER w3a_revoke_fail ON generations`);
    assert.equal(failedLate.status, 500, JSON.stringify(failedLate.body));
    assert.equal(await status(r.id), "QUEUED");
    // MUTATSIYA: qaytarish alohida tranzaksiyada COMMIT bo'lsa — pul qaytgan, ish esa QUEUED.
    assert.equal(await refunds(r.id), 0, "holat o'zgarmadi, lekin pul qaytdi");
    assert.equal(await balance(u.uid), 7000);

    const ok = await del(r.id, u.cookie);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.refunded, true);
    assert.equal(await refunds(r.id), 1);
    assert.equal(await balance(u.uid), 10_000);
    assert.equal(await status(r.id), null, "bekor qilingan ish o'chirilishi kerak edi");

    // Takroriy DELETE — pul ikkinchi marta qaytmaydi.
    const again = await del(r.id, u.cookie);
    assert.equal(again.status, 409);
    assert.equal(await balance(u.uid), 10_000);
  });

  await t.test("bekor qilish: IN_PROGRESS ish bekor qilinmaydi va pul qaytmaydi", async () => {
    const u = await mkUser("cancel-running");
    const r = await enqueueGeneration({
      userId: u.uid, toolId: "essay", topic: "Ish", price: 3000, format: "docx", values: { topic: "Ish" }, budgetMs: 60_000,
    });
    assert.ok(r.ok);
    await query(`UPDATE generations SET status = 'IN_PROGRESS', locked_by = 'w:1', locked_at = now() WHERE id = $1`, [r.id]);
    const res = await del(r.id, u.cookie);
    assert.equal(res.status, 409);
    assert.equal(await status(r.id), "IN_PROGRESS");
    assert.equal(await refunds(r.id), 0);
  });

  await t.test("activatePro: plan UPDATE yiqilsa kvota ham berilmaydi; provayder qayta urinishi obunani yoqadi", async () => {
    const u = await mkUser("pro", 0);
    const ref = `payme:w3a-${Date.now()}`;
    await query(`CREATE TRIGGER w3a_plan_fail BEFORE UPDATE OF plan ON users
                   FOR EACH ROW WHEN (NEW.plan = 'pro') EXECUTE FUNCTION w3a_fail()`);
    await assert.rejects(activatePro(u.uid, 15_000, 30, ref), /kiritilgan xato/);
    await query(`DROP TRIGGER w3a_plan_fail ON users`);
    const mid = (
      await query<{ quota: string; plan: string }>(`SELECT quota, plan FROM users WHERE id = $1`, [u.uid])
    )[0];
    // MUTATSIYA: `topUp` alohida COMMIT → kvota 15 000, plan 'free'.
    assert.equal(Number(mid.quota), 0, "plan yoqilmadi, lekin kvota berildi");
    assert.equal(mid.plan, "free");

    assert.equal(await activatePro(u.uid, 15_000, 30, ref), true, "qayta urinish obunani yoqishi kerak edi");
    const done = (
      await query<{ quota: string; plan: string; days: string }>(
        `SELECT quota, plan, round(extract(epoch FROM plan_expires_at - now()) / 86400) AS days FROM users WHERE id = $1`,
        [u.uid],
      )
    )[0];
    assert.equal(Number(done.quota), 15_000);
    assert.equal(done.plan, "pro");
    assert.equal(Number(done.days), 30);
    // Takroriy webhook — ikkinchi marta hech narsa qo'shilmaydi.
    assert.equal(await activatePro(u.uid, 15_000, 30, ref), false);
    const again = (await query<{ quota: string }>(`SELECT quota FROM users WHERE id = $1`, [u.uid]))[0];
    assert.equal(Number(again.quota), 15_000);
  });
});
