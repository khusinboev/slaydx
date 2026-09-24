import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * `023_indexes.sql` (prod-readiness DB-11) — haqiqiy Postgres ga qarshi,
 * ALOHIDA bazada. Har indeks koddagi aniq so'rov uchun qo'shilgan; bu
 * test o'sha so'rovning rejasi (EXPLAIN) haqiqatan shu indeksni
 * ishlatishini tekshiradi. `enable_seqscan = off` — bo'sh jadvalda ham
 * rejalashtiruvchi indeksni tanlay oladimi, shuni so'raydi (indeks
 * bo'lmasa baribir «Seq Scan» qoladi).
 *
 * Tuzatishsiz (023 yo'q) holatda: beshala so'rov ham «Seq Scan».
 * MUTATSIYA: 023 dan `sessions_revoked_idx` olib tashlandi → «sessiyalar
 * tozalash» testi qizardi (BitmapOr yo'q, Seq Scan).
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const skip = hasDb ? false : "DATABASE_URL yo'q";

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const iso = hasDb ? await createIsolatedDb("indexes") : { isolated: false, drop: async () => {} };
const db = hasDb ? await import("../lib/server/db.ts") : null;

test.after(async () => {
  await db?.pool().end().catch(() => {});
  await iso.drop();
});

async function plan(sql: string): Promise<string> {
  return db!.transaction(async (c) => {
    await c.query("SET LOCAL enable_seqscan = off");
    const r = await c.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`);
    return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
  });
}

const CASES: Array<{ name: string; idx: string; sql: string }> = [
  {
    // lib/server/telegram.ts — havola orqali kirish (autentifikatsiyasiz).
    name: "login havolasi token bo'yicha",
    idx: "login_tickets_token_idx",
    sql: `SELECT nonce FROM login_tickets
           WHERE token_hash = 'x' AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
  },
  {
    // lib/server/session.ts purgeExpiredSessions — har daqiqada.
    name: "sessiyalar tozalash (OR shartining ikkala tomoni)",
    idx: "sessions_revoked_idx",
    sql: `DELETE FROM sessions
           WHERE expires_at < now() - interval '7 days'
              OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`,
  },
  {
    // lib/server/session.ts purgeExpiredSessions — kodlar.
    name: "OTP kodlari tozalash",
    idx: "login_codes_expires_idx",
    sql: `DELETE FROM login_codes WHERE expires_at < now() - interval '1 day'`,
  },
  {
    // lib/server/game-sessions.ts purgeExpiredSessions — worker housekeeping.
    name: "o'yin havolalari tozalash",
    idx: "game_sessions_expires_idx",
    sql: `DELETE FROM game_sessions WHERE expires_at IS NOT NULL AND expires_at < now()`,
  },
  {
    // lib/server/jobs.ts claimJob — navbatdagi eng eski ish.
    name: "navbatdan ish olish (created_at tartibi)",
    idx: "generations_queued_created_idx",
    sql: `SELECT q.id FROM generations q
           WHERE q.status = 'QUEUED' AND q.run_after <= now()
           ORDER BY q.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
  },
];

test("023: har indeks o'z so'rovining rejasida ishlatiladi", { skip }, async () => {
  assert.ok(iso.isolated, "alohida baza yaratilmadi");
  await db!.migrate();
  for (const c of CASES) {
    const p = await plan(c.sql);
    assert.ok(p.includes(c.idx), `${c.name}: «${c.idx}» ishlatilmadi:\n${p}`);
  }
});

test("023: qayta qo'llash xavfsiz (IF NOT EXISTS)", { skip }, async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../lib/server/migrations/023_indexes.sql", import.meta.url), "utf8");
  // Ikkinchi marta bajarish xato bermasin.
  await db!.transaction(async (c) => {
    await c.query(sql);
  });
});
