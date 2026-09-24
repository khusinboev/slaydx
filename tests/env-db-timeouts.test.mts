import test from "node:test";
import assert from "node:assert/strict";

/**
 * BAZA VAQT CHEGARALARI `env` ORQALI (W3 wrap-up (c)).
 *
 * `DATABASE_STATEMENT_TIMEOUT_MS` va `DATABASE_CONNECT_TIMEOUT_MS` ilgari
 * `db.ts` ichida `process.env` dan to'g'ridan-to'g'ri o'qilardi. Endi
 * `env.ts` accessor'lari — semantika AYNAN o'sha:
 *   • bo'sh → standart (30 000 / 5 000);
 *   • `0` → 0 («chegara yo'q»; mijoz tomonida ham — `query_timeout` yo'q);
 *   • manfiy, kasr, matn → standart;
 *   • chaqiruv paytida o'qiladi (qayta ishga tushirishsiz sinov/`db-migrate.test`).
 *
 * Bazasiz.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { env } = await import("../lib/server/env.ts");
const { poolConfig } = await import("../lib/server/db.ts");

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const S = "DATABASE_STATEMENT_TIMEOUT_MS";
const C = "DATABASE_CONNECT_TIMEOUT_MS";

test("env: standartlar — statement 30 000 ms, connect 5 000 ms", () => {
  withEnv({ [S]: undefined, [C]: undefined }, () => {
    assert.equal(env.databaseStatementTimeoutMs, 30_000);
    assert.equal(env.databaseConnectTimeoutMs, 5_000);
  });
  withEnv({ [S]: "  ", [C]: "" }, () => {
    assert.equal(env.databaseStatementTimeoutMs, 30_000);
    assert.equal(env.databaseConnectTimeoutMs, 5_000);
  });
});

test("env: 0 — «chegara yo'q» (standartga qaytmaydi)", () => {
  withEnv({ [S]: "0", [C]: "0" }, () => {
    // MUTATSIYA: `n > 0` sharti (0 → standart) — qizaradi.
    assert.equal(env.databaseStatementTimeoutMs, 0);
    assert.equal(env.databaseConnectTimeoutMs, 0);
  });
});

test("env: yaroqsiz qiymat → standart; to'g'risi — o'zi; chaqiruv paytida o'qiladi", () => {
  for (const bad of ["-5", "1.5", "abc", "10ms"]) {
    withEnv({ [S]: bad, [C]: bad }, () => {
      assert.equal(env.databaseStatementTimeoutMs, 30_000, `S=${bad}`);
      assert.equal(env.databaseConnectTimeoutMs, 5_000, `C=${bad}`);
    });
  }
  withEnv({ [S]: "1500", [C]: " 4000 " }, () => {
    assert.equal(env.databaseStatementTimeoutMs, 1500);
    assert.equal(env.databaseConnectTimeoutMs, 4000);
  });
});

test("poolConfig: qiymatlar `env` dan — 0 da mijoz tomoni chegarasi ham yo'q", () => {
  withEnv({ [S]: "1500", [C]: "4000" }, () => {
    const cfg = poolConfig();
    assert.equal(cfg.statement_timeout, 1500);
    assert.equal(cfg.query_timeout, 6500);
    assert.equal(cfg.connectionTimeoutMillis, 4000);
  });
  withEnv({ [S]: "0", [C]: "0" }, () => {
    const cfg = poolConfig();
    assert.equal(cfg.statement_timeout, 0);
    assert.ok(!cfg.query_timeout, `mijoz tomoni chegarasi qoldi: ${cfg.query_timeout}`);
    assert.equal(cfg.connectionTimeoutMillis, 0);
  });
  withEnv({ [S]: undefined, [C]: undefined }, () => {
    const cfg = poolConfig();
    assert.equal(cfg.statement_timeout, 30_000);
    assert.equal(cfg.query_timeout, 35_000);
    assert.equal(cfg.connectionTimeoutMillis, 5_000);
  });
});
