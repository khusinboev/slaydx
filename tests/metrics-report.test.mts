import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * BIZNES METRIKALARI HISOBOTI (AUDIT prod-readiness C31: OBS-13, OBS-11).
 *
 * `scripts/metrics-report.mts collectMetrics(days)` — FAQAT o'qiydi (READ
 * ONLY tranzaksiya) va oxirgi N kun uchun: vosita×holat bo'yicha ishlar,
 * yiqilish va qaytarish ulushi, o'rtacha davomiylik, tushum (to'lovlar)
 * va yechimlar, navbat kutishi p50/p95, eng ko'p xato matnlari.
 *
 * Alohida Postgres bazada ma'lum qatorlar yoziladi va raqamlar aniq tekshiriladi;
 * oynadan tashqaridagi (30 kun oldingi) qatorlar hisobga tushmasligi ham.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("metrics") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("collectMetrics: raqamlar aniq, oyna chegarasi, faqat o'qish", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { collectMetrics } = await import("../scripts/metrics-report.mts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const [{ id: uid }] = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ('metrics-u', 'M', 0, 0, 0) RETURNING id`,
  );
  const gen = (tool: string, status: string, createdAgo: string, waitSec: number | null, runSec: number | null, error: string | null = null) =>
    query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, status, error,
                                created_at, started_at, finished_at)
       VALUES (gen_random_uuid(), $1, $2, 't', 3000, 'docx', '{}'::jsonb, $3, $4,
               now() - $5::interval,
               CASE WHEN $6::int IS NULL THEN NULL ELSE now() - $5::interval + make_interval(secs => $6::int) END,
               CASE WHEN $7::int IS NULL THEN NULL ELSE now() - $5::interval + make_interval(secs => $6::int + $7::int) END)`,
      [uid, tool, status, error, createdAgo, waitSec, runSec],
    );
  await gen("essay", "COMPLETED", "2 hours", 10, 50);
  await gen("essay", "COMPLETED", "3 hours", 30, 60);
  await gen("essay", "FAILED", "4 hours", 20, 5, "Ish vaqti tugadi");
  await gen("slide", "QUEUED", "5 minutes", null, null);
  await gen("essay", "COMPLETED", "30 days", 1, 1); // oynadan tashqarida

  const tx = (kind: string, balance: number, quota: number, ref: string, ago = "1 hour") =>
    query(
      `INSERT INTO transactions (user_id, kind, balance_delta, quota_delta, reference, created_at)
       VALUES ($1, $2, $3, $4, $5, now() - $6::interval)`,
      [uid, kind, balance, quota, ref, ago],
    );
  await tx("charge", -3000, 0, "c1");
  await tx("charge", -2000, -1000, "c2");
  await tx("charge", -3000, 0, "c3");
  await tx("refund", 3000, 0, "c3");
  await tx("topup", 10000, 0, "click:1");
  await tx("subscription", 0, 15000, "payme:2");
  await tx("topup", 99999, 0, "click:old", "30 days");

  const order = (provider: string, purpose: string, amount: number, state: string, ago = "1 hour") =>
    query(
      `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now() - $6::interval, now() - $6::interval)`,
      [uid, provider, purpose, amount, state, ago],
    );
  await order("click", "topup", 10000, "paid");
  await order("payme", "pro", 15000, "paid");
  await order("payme", "topup", 5000, "cancelled");
  await order("payme", "topup", 7000, "created");
  await order("click", "topup", 50000, "paid", "30 days");

  const before = (await query<{ n: string }>("SELECT count(*) AS n FROM transactions"))[0].n;
  const m = await collectMetrics(7);
  const after = (await query<{ n: string }>("SELECT count(*) AS n FROM transactions"))[0].n;
  assert.equal(after, before, "hisobot yozmasligi kerak");

  assert.equal(m.days, 7);
  const cell = (tool: string, status: string) => m.jobs.find((r) => r.tool === tool && r.status === status)?.count ?? 0;
  assert.equal(cell("essay", "COMPLETED"), 2, "oynadan tashqaridagi ish ham sanaldi");
  assert.equal(cell("essay", "FAILED"), 1);
  assert.equal(cell("slide", "QUEUED"), 1);

  // Yiqilish: FAILED / (COMPLETED + FAILED) = 1/3.
  assert.ok(Math.abs(m.failureRate! - 1 / 3) < 1e-9, `failureRate ${m.failureRate}`);
  // Qaytarish: qaytarilgan yechimlar / yechimlar = 1/3.
  assert.ok(Math.abs(m.refundRate! - 1 / 3) < 1e-9, `refundRate ${m.refundRate}`);

  const essay = m.duration.find((r) => r.tool === "essay")!;
  assert.equal(Math.round(essay.avgSec), 55, "o'rtacha davomiylik (tugagan ishlar)");

  // Navbat kutishi: [10, 20, 30] s → p50 = 20, p95 = 29 (chiziqli interpolyatsiya).
  assert.equal(Math.round(m.queueWait.p50Sec!), 20);
  assert.equal(Math.round(m.queueWait.p95Sec!), 29);

  assert.equal(m.money.paidSoum, 25_000, "to'langan buyurtmalar (so'm)");
  assert.deepEqual(
    m.money.paidByProvider.map((r) => [r.provider, r.purpose, r.orders, r.soum]).sort(),
    [["click", "topup", 1, 10_000], ["payme", "pro", 1, 15_000]],
  );
  assert.equal(m.money.topupCredited, 10_000);
  assert.equal(m.money.subscriptions, 1);
  assert.equal(m.money.charged, 9_000, "yechimlar (barcha hamyonlar)");
  assert.equal(m.money.chargedBalance, 8_000, "haqiqiy balansdan yechilgan");
  assert.equal(m.money.refunded, 3_000);
  assert.equal(m.money.netCharged, 6_000);
  assert.deepEqual(
    m.orders.map((r) => [r.state, r.count]).sort(),
    [["cancelled", 1], ["created", 1], ["paid", 2]],
  );

  assert.deepEqual(m.topErrors, [{ error: "Ish vaqti tugadi", count: 1 }]);
});
