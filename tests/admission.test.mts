import test from "node:test";
import assert from "node:assert/strict";
import { useIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Navbatga qabul va adolatli olish (prod-readiness C22 + C16: CONC-07,
 * SCALE-05; `audit/designs/capacity.md`).
 *
 * Ilgari: har ish navbatga qo'yilishi bilan puli yechilardi va soatlab
 * ETA'siz kutardi; bitta foydalanuvchi ketma-ket ish tashlab, hamma
 * slotni band qila olardi (`claimJob` — global FIFO).
 *
 * Endi (egasi qarori 2026-09-23):
 *   - `POST /api/generations` pul yechishdan OLDIN: foydalanuvchida
 *     QUEUED+IN_PROGRESS ≥ `USER_MAX_INFLIGHT` → 429 `user_inflight`;
 *     `queued × meanServiceSec ÷ totalSlots` > `maxWaitSec` → 429 `queue_full`.
 *     Ikkalasida ham `Retry-After`, pul yechilmaydi, qator yozilmaydi;
 *   - `claimJob` allaqachon ≥ cap ta IN_PROGRESS ishi bor foydalanuvchini o'tkazib yuboradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const { admissionDecision, queueEtaSec } = await import("../lib/server/admission.ts");

const LIMITS = { userMaxInflight: 2, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 900 };

test("admissionDecision: foydalanuvchi chegarasi — 1 ta bo'lsa o'tadi, 2 ta bo'lsa 429 user_inflight", () => {
  assert.equal(admissionDecision({ ...LIMITS, userInflight: 1, queued: 0 }).ok, true);
  const d = admissionDecision({ ...LIMITS, userInflight: 2, queued: 0 });
  assert.equal(d.ok, false);
  assert.ok(!d.ok && d.code === "user_inflight");
  assert.ok(!d.ok && d.retryAfterSec >= 30);
  assert.ok(!d.ok && /navbatda yoki tayyorlanmoqda/.test(d.error));
});

test("admissionDecision: navbat chegarasi — kutish = queued × 200 ÷ 8; 36 ta (900 s) o'tadi, 37 ta rad", () => {
  // 36 × 200 / 8 = 900 — aynan chegara, hali qabul (qat'iy `>`).
  const edge = admissionDecision({ ...LIMITS, userInflight: 0, queued: 36 });
  assert.deepEqual(edge, { ok: true, waitSec: 900 });
  const full = admissionDecision({ ...LIMITS, userInflight: 0, queued: 37 });
  assert.equal(full.ok, false);
  assert.ok(!full.ok && full.code === "queue_full");
  // 37 × 25 = 925 s → 25 s ortiqcha, lekin eng kami 30 s.
  assert.ok(!full.ok && full.retryAfterSec === 30);
  const far = admissionDecision({ ...LIMITS, userInflight: 0, queued: 100 });
  // 100 × 25 = 2 500 s → 1 600 s dan keyin chegaraga tushadi → 27 daqiqa.
  assert.ok(!far.ok && far.retryAfterSec === 1600);
  assert.ok(!far.ok && far.error.includes("taxminan 27 daqiqadan keyin"));
  // Foydalanuvchi chegarasi birinchi tekshiriladi (aniqroq sabab).
  const both = admissionDecision({ ...LIMITS, userInflight: 5, queued: 100 });
  assert.ok(!both.ok && both.code === "user_inflight");
});

test("admissionDecision/queueEtaSec: slot 0 yoki noto'g'ri sozlama cheksizlik bermaydi", () => {
  const d = admissionDecision({ ...LIMITS, totalSlots: 0, userInflight: 0, queued: 1 });
  assert.ok(d.ok && Number.isFinite(d.waitSec));
  assert.equal(queueEtaSec(1, LIMITS), 25);
  assert.equal(queueEtaSec(3, LIMITS), 75);
  assert.equal(queueEtaSec(1, { totalSlots: 0, meanServiceSec: 200 }), 200);
});

// ─────────────────────────────── Postgres (alohida baza)

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await useIsolatedDb("admission") : { isolated: false, drop: async () => {} };

test("POST /api/generations qabul qarori va adolatli claimJob", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const { claimJob } = await import("../lib/server/jobs.ts");
  const route = await import("../app/api/generations/route.ts");
  await migrate();
  // 022_retention.sql (W2-D2) bu tarmoqda hali yo'q bo'lishi mumkin — ustun testda qo'shiladi.
  await query(`ALTER TABLE generations ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ`);
  env.worker.inline = false;
  Object.assign(env.queue, LIMITS);

  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async (name: string, balance = 100_000) => {
    const suffix = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const uid = String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, $2) RETURNING id`,
          [suffix, balance],
        )
      )[0].id,
    );
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const post = async (cookie: string) => {
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ slug: "essay", values: { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" } }),
    });
    const res = await inRequest(req, () => route.POST(req));
    return { status: res.status, retryAfter: res.headers.get("retry-after"), body: (await res.json()) as Record<string, unknown> };
  };
  const wallet = async (uid: string) =>
    (await query<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))[0].balance;
  const rows = async (uid: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM generations WHERE user_id = $1`, [uid]))[0].n);
  const tx = async (uid: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE user_id = $1`, [uid]))[0].n);
  /** Navbatdagi, lekin worker ololmaydigan (`run_after` kelajakda) qator — sanoqqa kiradi. */
  const parked = async (uid: string, status: "QUEUED" | "IN_PROGRESS", n: number) => {
    for (let i = 0; i < n; i++) {
      await query(
        `INSERT INTO generations (id, user_id, tool_id, topic, status, run_after, locked_by, locked_at)
         VALUES (gen_random_uuid(), $1, 'essay', 'band', $2, now() + interval '1 day',
                 CASE WHEN $2 = 'IN_PROGRESS' THEN 'w-test' END, CASE WHEN $2 = 'IN_PROGRESS' THEN now() END)`,
        [uid, status],
      );
    }
  };

  await t.test("uchinchi ish (1 QUEUED + 1 IN_PROGRESS bor) → 429 user_inflight, pul va qator yo'q", async () => {
    const u = await mkUser("adm-inflight");
    await parked(u.uid, "QUEUED", 1);
    await parked(u.uid, "IN_PROGRESS", 1);
    const before = { w: await wallet(u.uid), r: await rows(u.uid), t: await tx(u.uid) };
    const r = await post(u.cookie);
    // MUTATSIYA: `enqueueGeneration` dan qabul tekshiruvini olib tashlash → 202 va pul yechiladi.
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(r.body.code, "user_inflight");
    assert.equal(typeof r.body.error, "string");
    assert.equal(r.retryAfter, String(r.body.retryAfterSec));
    assert.deepEqual({ w: await wallet(u.uid), r: await rows(u.uid), t: await tx(u.uid) }, before, "429 da hech narsa o'zgarmasligi kerak");
  });

  // Global sanoqqa tayanadigan testlar faqat alohida bazada (umumiy bazada boshqa testlarning qatorlari bor).
  const needIso = { skip: iso.isolated ? false : "alohida baza yaratilmadi" };

  await t.test("navbat to'la (kutish > maxWaitSec) → 429 queue_full + Retry-After, pul va qator yo'q", needIso, async () => {
    const filler = await mkUser("adm-filler");
    // 37 × 200 ÷ 8 = 925 s > 900 s.
    const have = Number((await query<{ n: string }>(`SELECT count(*) AS n FROM generations WHERE status = 'QUEUED'`))[0].n);
    await parked(filler.uid, "QUEUED", Math.max(0, 37 - have));
    const u = await mkUser("adm-full");
    const before = { w: await wallet(u.uid), r: await rows(u.uid), t: await tx(u.uid) };
    const r = await post(u.cookie);
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(r.body.code, "queue_full");
    assert.ok(Number(r.retryAfter) >= 30);
    assert.equal(r.retryAfter, String(r.body.retryAfterSec));
    assert.match(String(r.body.error), /Navbat to'la — taxminan \d+ daqiqadan keyin/);
    assert.deepEqual({ w: await wallet(u.uid), r: await rows(u.uid), t: await tx(u.uid) }, before);
    await query(`DELETE FROM generations WHERE user_id = $1`, [filler.uid]);
  });

  await t.test("qabul: bo'sh navbatda 202, pul yechiladi; parallel 3 so'rovdan faqat chegaragacha o'tadi", needIso, async () => {
    // Faqat bu testning sanog'i — boshqa QUEUED qatorlar (oldingi testlar) tozalangan.
    const u = await mkUser("adm-ok");
    const before = Number(await wallet(u.uid));
    const burst = await Promise.all([post(u.cookie), post(u.cookie), post(u.cookie)]);
    const ok = burst.filter((r) => r.status === 202);
    const rejected = burst.filter((r) => r.status === 429);
    // MUTATSIYA: foydalanuvchi qatorini `FOR UPDATE` bilan qulflamaslik → poyga, 3 tasi ham o'tishi mumkin.
    assert.equal(ok.length, 2, JSON.stringify(burst.map((r) => [r.status, r.body.code])));
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].body.code, "user_inflight");
    assert.equal(await rows(u.uid), 2);
    const price = Number(ok[0].body.price);
    assert.equal(Number(await wallet(u.uid)), before - 2 * price);
  });

  await t.test("adolatli claimJob: A da 2 ta IN_PROGRESS + eski QUEUED, B da yangi QUEUED → B olinadi", needIso, async () => {
    await query(`UPDATE generations SET status = 'COMPLETED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
    const a = await mkUser("fair-a");
    const b = await mkUser("fair-b");
    await parked(a.uid, "IN_PROGRESS", 2);
    const aQueued = crypto.randomUUID();
    const bQueued = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, created_at)
       VALUES ($1, $2, 'essay', 'A eski', 'QUEUED', now() - interval '5 minutes'),
              ($3, $4, 'essay', 'B yangi', 'QUEUED', now() - interval '1 minute')`,
      [aQueued, a.uid, bQueued, b.uid],
    );
    const claimed = await claimJob("w-fair");
    // MUTATSIYA: claim'dagi foydalanuvchi IN_PROGRESS sanog'ini olib tashlash (eski FIFO) → A olinadi.
    assert.equal(claimed?.id, bQueued, "A allaqachon 2 slotni band qilgan — B navbatdan o'tishi kerak");
    // A ning ishlaridan biri tugasa — A ning eski ishi olinadi (u abadiy och qolmaydi).
    assert.equal(await claimJob("w-fair"), null, "A hali chegarada — boshqa ish yo'q");
    await query(`UPDATE generations SET status = 'COMPLETED' WHERE id = (SELECT id FROM generations WHERE user_id = $1 AND status = 'IN_PROGRESS' LIMIT 1)`, [a.uid]);
    const next = await claimJob("w-fair");
    assert.equal(next?.id, aQueued);
  });
});
