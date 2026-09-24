import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * MIGRATSIYA YURITUVCHISI va HOVUZ SOZLAMASI (prod-readiness C32/C33:
 * DB-07, CONC-12, DB-08) — haqiqiy Postgres ga qarshi, ALOHIDA bazada.
 *
 * Muammo: `migrate()` hovuz ulanishini olardi va uning 30 s
 * `statement_timeout` ini meros qilardi. `docker compose up` web va
 * worker'ni birga ko'taradi; ikkinchisi `pg_advisory_lock` da kutadi va
 * bu kutish 30 s ga hisoblanardi — birinchisining migratsiyasi 30 s dan
 * uzoq bo'lsa ikkinchisi «statement timeout» bilan yiqilardi (bitta
 * uzoq statement esa umuman qo'llanmasdi). `lock_timeout` yo'q edi —
 * `ALTER TABLE` navbatda turib butun trafikni to'xtatardi.
 *
 * Migratsiya papkasi — vaqtinchalik `lib/server/migrations` (joriy
 * papka unga ko'chiriladi, `db.ts` IMPORTIDAN OLDIN), haqiqiy
 * migratsiyalarga tegmaydi.
 *
 * Tuzatishsiz kodda (hovuz ulanishi): 1-test «Migratsiya xatosi
 * (001_slow.sql): canceling statement due to statement timeout».
 *
 * MUTATSIYALAR (har biri qizardi):
 *   1. migratsiya `statement_timeout` 0 o'rniga 30 000 → «ikki parallel»;
 *   2. har fayl `lock_timeout` i olib tashlandi → «lock_timeout» (60 s osildi);
 *   3. advisory qulf kutishi chegarasi olib tashlandi → «advisory qulf kutishi»;
 *   4. `application_name: "slaydx"` (rolsiz) → «hovuz: sozlama»;
 *   5. ogohlantirish chastota chegarasi olib tashlandi → «hovuz to'lishi»;
 *   6. (review R3) `query_timeout: statementTimeout + 5_000` (0 ham) →
 *      «DATABASE_STATEMENT_TIMEOUT_MS=0»;
 *   7. (review R1) eski sinxron `waitingCount > 0` tekshiruvi → «iliq hovuz»
 *      (soxta «hovuz to'lgan … bo'sh 1»);
 *   8. to'liq shart, lekin `setImmediate` siz → «hovuz to'lishi» (iliq
 *      hovuzdagi haqiqiy to'lqin ko'rinmadi).
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const skip = hasDb ? false : "DATABASE_URL yo'q";

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
// Hovuz sozlamasi o'qilishini tekshirish uchun — standartdan farqli qiymatlar.
process.env.DATABASE_POOL_MAX = "3";
process.env.DATABASE_STATEMENT_TIMEOUT_MS = "1500";
process.env.DATABASE_CONNECT_TIMEOUT_MS = "4000";

const LOCK_ID = 727_000_001;

const iso = hasDb ? await createIsolatedDb("migrate") : { isolated: false, drop: async () => {} };
const ROOT = mkdtempSync(path.join(tmpdir(), "slaydx-migrate-"));
const DIR = path.join(ROOT, "lib", "server", "migrations");
mkdirSync(DIR, { recursive: true });
const ORIG_CWD = process.cwd();
process.chdir(ROOT);

const db = hasDb ? await import("../lib/server/db.ts") : null;

const url = () => process.env.DATABASE_URL!;
async function side(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url(), application_name: "migrate-test-side" });
  await c.connect();
  return c;
}
const writeMig = (name: string, sql: string) => writeFileSync(path.join(DIR, name), sql);

test.after(async () => {
  process.chdir(ORIG_CWD);
  await db?.pool().end().catch(() => {});
  await iso.drop();
  rmSync(ROOT, { recursive: true, force: true });
});

test(
  "ikki parallel yurituvchi: 30 s dan uzoq migratsiya — ikkinchisi kutadi va muvaffaqiyatli, hech biri takror qo'llamaydi",
  { skip, timeout: 120_000 },
  async () => {
    assert.ok(iso.isolated, "alohida baza yaratilmadi — test umumiy bazani buzmasin");
    writeMig(
      "001_slow.sql",
      `-- sekin sinov migratsiyasi
CREATE TABLE IF NOT EXISTS mig_probe (id SERIAL PRIMARY KEY, who TEXT);
INSERT INTO mig_probe (who) VALUES ('once');
SELECT pg_sleep(31);`,
    );
    const spy = await side();
    try {
      const t0 = Date.now();
      const a = db!.migrate();
      const b = db!.migrate();
      // Migratsiya ulanishi pg_stat_activity da kim ekanini ko'rsatadi.
      await new Promise((r) => setTimeout(r, 1500));
      const names = (
        await spy.query<{ application_name: string }>(
          "SELECT application_name FROM pg_stat_activity WHERE datname = current_database()",
        )
      ).rows.map((r) => r.application_name);
      assert.ok(
        names.filter((n) => /^slaydx-[a-z]+(@\S+)?-migrate$/.test(n)).length >= 2,
        `migratsiya ulanishlari nomlanmagan: ${JSON.stringify(names)}`,
      );
      const results = await Promise.allSettled([a, b]);
      for (const r of results) {
        assert.equal(r.status, "fulfilled", `yurituvchi yiqildi: ${r.status === "rejected" ? (r.reason as Error).message : ""}`);
      }
      assert.ok(Date.now() - t0 >= 31_000, "migratsiya haqiqatan uzoq davom etmagan");
      const probe = await spy.query<{ n: number }>("SELECT count(*)::int AS n FROM mig_probe");
      assert.equal(probe.rows[0].n, 1, "migratsiya ikki marta qo'llandi");
      const done = await spy.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM schema_migrations WHERE name = '001_slow.sql'",
      );
      assert.equal(done.rows[0].n, 1);
      // Qulf qo'yib yuborilgan — boshqa sessiya darhol oladi.
      const free = await spy.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_ID]);
      assert.equal(free.rows[0].ok, true, "advisory qulf ushlab qolingan");
      await spy.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]);
    } finally {
      await spy.end();
    }
  },
);

test("advisory qulf kutishi chegaralangan: band bo'lsa aniq xato bilan to'xtaydi", { skip, timeout: 30_000 }, async () => {
  writeMig("002_noop.sql", "-- bo'sh sinov\nSELECT 1;");
  const holder = await side();
  try {
    await holder.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    const t0 = Date.now();
    await assert.rejects(db!.migrate({ lockWaitMs: 800 }), /qulf/i);
    const took = Date.now() - t0;
    assert.ok(took >= 700 && took < 10_000, `kutish chegarasi ishlamadi: ${took} ms`);
    // Hech narsa qo'llanmagan.
    const r = await holder.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '002_noop.sql'");
    assert.equal(r.rows[0].n, 0);
  } finally {
    await holder.query("SELECT pg_advisory_unlock_all()");
  }
  // Qulf bo'shagach — muvaffaqiyatli.
  await db!.migrate({ lockWaitMs: 800 });
  const r = await holder.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '002_noop.sql'");
  assert.equal(r.rows[0].n, 1);
  await holder.end();
});

test("lock_timeout: jadval qulfi band — ALTER navbatni uzoq to'sib turmaydi, fayl qo'llanmaydi", { skip, timeout: 60_000 }, async () => {
  writeMig("003_alter.sql", "-- qulf sinovi\nALTER TABLE mig_probe ADD COLUMN IF NOT EXISTS extra INT;");
  const reader = await side();
  const other = await side();
  try {
    // Uzoq o'quvchi tranzaksiya (ACCESS SHARE) — ALTER ACCESS EXCLUSIVE kutadi.
    await reader.query("BEGIN");
    await reader.query("SELECT count(*) FROM mig_probe");
    const t0 = Date.now();
    const run = db!.migrate({ lockTimeoutMs: 400, lockRetries: 2, lockRetryDelayMs: 100 });
    // ALTER navbatda turganda boshqa o'quvchi ham kutadi — lekin faqat qisqa vaqt.
    await new Promise((r) => setTimeout(r, 100));
    const q0 = Date.now();
    await other.query("SELECT count(*) FROM mig_probe");
    assert.ok(Date.now() - q0 < 3_000, "ALTER navbati boshqa so'rovlarni uzoq to'sdi");
    await assert.rejects(run, /003_alter\.sql[\s\S]*lock timeout/i);
    assert.ok(Date.now() - t0 < 10_000, "lock_timeout ishlamadi");
    const done = await other.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '003_alter.sql'");
    assert.equal(done.rows[0].n, 0, "yiqilgan migratsiya qo'llangan deb yozildi");
  } finally {
    await reader.query("ROLLBACK");
  }
  try {
    // Qulf bir necha soniyada bo'shasa — qayta urinish bilan o'tadi.
    await reader.query("BEGIN");
    await reader.query("SELECT count(*) FROM mig_probe");
    setTimeout(() => void reader.query("ROLLBACK"), 700);
    await db!.migrate({ lockTimeoutMs: 300, lockRetries: 6, lockRetryDelayMs: 200 });
    const col = await other.query(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'mig_probe' AND column_name = 'extra'",
    );
    assert.equal(col.rows[0].n, 1);
  } finally {
    await reader.end();
    await other.end();
  }
});

test("yiqilgan migratsiya: aniq xato, ulanish yopiladi, qulf qo'yib yuboriladi", { skip, timeout: 30_000 }, async () => {
  writeMig("004_broken.sql", "-- xato sinovi\nSELECT * FROM no_such_table_xyz;");
  await assert.rejects(db!.migrate(), /Migratsiya xatosi \(004_broken\.sql\)/);
  const spy = await side();
  try {
    // Backend yopilishi pg_stat_activity ga bir zumda yetib bormasligi mumkin.
    let n = -1;
    for (let i = 0; i < 20 && n !== 0; i++) {
      if (i) await new Promise((r) => setTimeout(r, 100));
      const left = await spy.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'slaydx-%-migrate'",
      );
      n = left.rows[0].n;
    }
    assert.equal(n, 0, "migratsiya ulanishi ochiq qoldi");
    const free = await spy.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_ID]);
    assert.equal(free.rows[0].ok, true);
  } finally {
    await spy.end();
  }
  rmSync(path.join(DIR, "004_broken.sql"));
});

test("hovuz: sozlama env'dan o'qiladi, application_name va keepAlive bor", { skip }, async () => {
  const cfg = db!.poolConfig();
  assert.equal(cfg.max, 3, "DATABASE_POOL_MAX o'qilmadi");
  assert.equal(cfg.statement_timeout, 1500);
  assert.equal(cfg.connectionTimeoutMillis, 4000);
  assert.ok((cfg.query_timeout ?? 0) > 1500, "mijoz tomoni vaqt chegarasi server chegarasidan katta bo'lishi kerak");
  assert.equal(cfg.keepAlive, true);
  assert.match(String(cfg.application_name), /^slaydx-[a-z]+(@\S+)?$/);
  assert.ok(String(cfg.application_name).length <= 63);

  const [row] = await db!.query<{ app: string; st: string }>(
    "SELECT current_setting('application_name') AS app, current_setting('statement_timeout') AS st",
  );
  assert.equal(row.app, cfg.application_name);
  assert.equal(row.st, "1500ms");
});

test("DATABASE_STATEMENT_TIMEOUT_MS=0 — chegara yo'q (mijoz tomonida ham)", { skip, timeout: 30_000 }, async () => {
  const prev = process.env.DATABASE_STATEMENT_TIMEOUT_MS;
  process.env.DATABASE_STATEMENT_TIMEOUT_MS = "0";
  let cfg;
  try {
    cfg = db!.poolConfig();
  } finally {
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = prev;
  }
  assert.equal(cfg.statement_timeout, 0);
  assert.ok(!cfg.query_timeout, `mijoz tomoni chegarasi qoldi: ${cfg.query_timeout}`);
  // Jonli: 5 s dan uzoq so'rov bekor qilinmaydi (ilgari 0 + 5 000 = 5 s edi).
  const p = new pg.Pool({ ...cfg, max: 1 });
  try {
    await p.query("SELECT pg_sleep(5.5)");
  } finally {
    await p.end();
  }
});

test("hovuz: iliq, bo'sh ulanishi bor hovuzda ogohlantirish YO'Q", { skip }, async () => {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    warns.push(a.map(String).join(" "));
  };
  try {
    const g = globalThis as { __slaydxPoolPressure?: { lastWarn: number } };
    if (g.__slaydxPoolPressure) g.__slaydxPoolPressure.lastWarn = 0;
    await db!.query("SELECT 1");
    // Ketma-ket: bo'sh ulanish bor — hech narsa kutmaydi.
    await db!.query("SELECT 1");
    await db!.query("SELECT 1");
    await db!.transaction((c) => c.query("SELECT 1"));
    // Hovuz chegarasidan kam parallel so'rov ham to'lish emas.
    await Promise.all([db!.query("SELECT 1"), db!.query("SELECT 1")]);
    assert.equal(
      warns.filter((w) => /\[db\] hovuz/.test(w)).length,
      0,
      `soxta «hovuz to'lgan»: ${JSON.stringify(warns)}`,
    );
  } finally {
    console.warn = orig;
  }
});

test("processRole: web / worker / migrate / cli", { skip }, () => {
  const { processRole } = db!;
  assert.equal(processRole(["node", "server.js"], {}), "web");
  assert.equal(processRole(["node", "/app/scripts/worker.ts"], {}), "worker");
  assert.equal(processRole(["node", "/app/scripts/migrate.ts"], {}), "migrate");
  assert.equal(processRole(["node", "/app/scripts/topup.ts"], {}), "cli");
  assert.equal(processRole(["node", "/app/scripts/worker.ts"], { NEXT_RUNTIME: "nodejs" }), "web");
});

test("hovuz to'lishi: ogohlantirish chiqadi, lekin cheklangan chastotada", { skip, timeout: 30_000 }, async () => {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    warns.push(a.map(String).join(" "));
  };
  try {
    const burst = () => Promise.all(Array.from({ length: 8 }, () => db!.query("SELECT pg_sleep(0.2)")));
    const g0 = globalThis as { __slaydxPoolPressure?: { lastWarn: number } };
    if (g0.__slaydxPoolPressure) g0.__slaydxPoolPressure.lastWarn = 0;
    await burst();
    const first = warns.filter((w) => /\[db\] hovuz/.test(w));
    assert.equal(first.length, 1, `birinchi to'lqinda bitta ogohlantirish kutilgan: ${JSON.stringify(warns)}`);
    assert.match(first[0], /kutmoqda/);
    await burst();
    assert.equal(warns.filter((w) => /\[db\] hovuz/.test(w)).length, 1, "ogohlantirish cheklanmagan (spam)");
    // Chegara oynasi o'tgach — yana ogohlantiradi, bostirilganlar sonini aytadi.
    const g = globalThis as { __slaydxPoolPressure?: { lastWarn: number } };
    assert.ok(g.__slaydxPoolPressure, "bosim holati globalThis da emas");
    g.__slaydxPoolPressure.lastWarn = 0;
    await burst();
    const all = warns.filter((w) => /\[db\] hovuz/.test(w));
    assert.equal(all.length, 2);
    assert.match(all[1], /yana \d+ marta/);
    // Hovuzdan tranzaksiya ham xuddi shunday kuzatiladi.
    g.__slaydxPoolPressure.lastWarn = 0;
    await Promise.all(
      Array.from({ length: 6 }, () => db!.transaction((c) => c.query("SELECT pg_sleep(0.2)"))),
    );
    assert.equal(warns.filter((w) => /\[db\] hovuz/.test(w)).length, 3);
  } finally {
    console.warn = orig;
  }
});
