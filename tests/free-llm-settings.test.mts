import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Free-LLM kill switch and daily caps read the runtime settings
 * (`lib/server/spend.ts` + `lib/server/settings.ts`, docs/admin/02-plan.md
 * §6.10, §13.4).
 *
 * On a throwaway database: no `app_settings` row → exactly the env policy; a
 * row overrides env (switch and caps) for `withFreeLlm` and, once read, for the
 * synchronous route check; a settings read that fails falls back to env; the
 * buckets stay fail-closed (DB error → 503, provider not called); an explicit
 * `deps.policy` still bypasses settings entirely (existing tests' seam).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
// Read by lib/server/env.ts at import time.
process.env.FREE_LLM_DAILY_UDK = "5";
delete process.env.FREE_LLM_DISABLED;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("freellmset") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

type Outcome = { value?: unknown; status?: number; code?: unknown; message?: string };
async function outcome(p: Promise<unknown>): Promise<Outcome> {
  try {
    return { value: await p };
  } catch (e) {
    const err = e as { status?: number; extra?: { code?: unknown }; code?: unknown; message?: string };
    return { status: err.status, code: err.extra?.code ?? err.code, message: err.message };
  }
}

test("free-LLM settings (Postgres)", { skip }, async (t) => {
  const { migrate, pool, query } = await import("../lib/server/db.ts");
  const spend = await import("../lib/server/spend.ts");
  const settings = await import("../lib/server/settings.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });
  const g = globalThis as typeof globalThis & { __slaydxSettingsCache?: unknown };
  const setRow = async (key: string, value: unknown) => {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    settings.invalidateSettingsCache();
  };
  const clearRows = async () => {
    await query("DELETE FROM app_settings");
    settings.invalidateSettingsCache();
  };
  const uid = String((await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ('freeset', 'T') RETURNING id`))[0].id);
  let n = 0;
  const prefix = () => `fls-${process.pid}-${++n}:`;

  await t.test("no row → exactly the env policy", async () => {
    await clearRows();
    const eff = await spend.effectiveFreeLlmPolicy();
    assert.deepEqual(eff, spend.freeLlmPolicy());
    assert.equal(eff.daily.udk, 5);
    assert.equal(eff.disabled, false);
    assert.doesNotThrow(() => spend.assertFreeLlmEnabled());
  });

  await t.test("free_llm.disabled = true overrides env: 503 before buckets and provider", async (tt) => {
    quiet(tt);
    await setRow("free_llm.disabled", true);
    let provider = 0;
    const bucket = prefix();
    const r = await outcome(spend.withFreeLlm({ endpoint: "udk", userId: uid }, async () => ++provider, { bucketPrefix: bucket }));
    assert.equal(r.status, 503);
    assert.equal(r.code, "disabled");
    assert.equal(provider, 0);
    const used = await query("SELECT 1 FROM rate_limits WHERE bucket LIKE $1", [`${bucket}%`]);
    assert.equal(used.length, 0, "no bucket consumed");
    // The synchronous route-level check now sees the setting too.
    assert.throws(() => spend.assertFreeLlmEnabled(), (e: Error & { status?: number }) => e.status === 503);
    // Turning it back on (row false) re-enables both paths.
    await setRow("free_llm.disabled", false);
    assert.equal(await spend.withFreeLlm({ endpoint: "udk", userId: uid }, async () => "ok", { bucketPrefix: prefix() }), "ok");
    assert.doesNotThrow(() => spend.assertFreeLlmEnabled());
  });

  await t.test("daily cap override applies (udk = 1 instead of env 5)", async (tt) => {
    quiet(tt);
    await clearRows();
    await setRow("free_llm.daily.udk", 1);
    const bucket = prefix();
    assert.equal(await spend.withFreeLlm({ endpoint: "udk", userId: uid }, async () => "a", { bucketPrefix: bucket }), "a");
    const second = await outcome(spend.withFreeLlm({ endpoint: "udk", userId: uid }, async () => "b", { bucketPrefix: bucket }));
    assert.equal(second.status, 429);
    await setRow("free_llm.daily.global", 0);
    const global = await outcome(spend.withFreeLlm({ endpoint: "outline", userId: uid }, async () => "c", { bucketPrefix: prefix() }));
    assert.equal(global.status, 503);
    assert.equal(global.code, "global");
  });

  await t.test("settings read fails → env values (no stale override invented)", async (tt) => {
    quiet(tt);
    await setRow("free_llm.disabled", true);
    // Fresh process state: no last-good snapshot to fall back to.
    delete g.__slaydxSettingsCache;
    const p = pool();
    const realQuery = p.query.bind(p);
    tt.mock.method(p, "query", (async (text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string" && /FROM app_settings/.test(text)) throw new Error("ECONNREFUSED");
      return (realQuery as (...a: unknown[]) => unknown)(text, ...rest);
    }) as never);
    const eff = await spend.effectiveFreeLlmPolicy();
    assert.deepEqual(eff, spend.freeLlmPolicy(), "DB error → env");
    assert.equal(await spend.withFreeLlm({ endpoint: "udk", userId: uid }, async () => "env", { bucketPrefix: prefix() }), "env");
    tt.mock.restoreAll();
    await clearRows();
  });

  await t.test("fail-closed unchanged: a bucket DB error → 503, provider not called", async (tt) => {
    quiet(tt);
    await clearRows();
    await spend.effectiveFreeLlmPolicy(); // warm the 15 s settings cache
    const p = pool();
    tt.mock.method(p, "query", async () => {
      throw new Error("ECONNRESET");
    });
    let provider = 0;
    const r = await outcome(spend.withFreeLlm({ endpoint: "udk", userId: uid }, async () => ++provider, { bucketPrefix: prefix() }));
    assert.equal(r.status, 503);
    assert.equal(provider, 0);
    tt.mock.restoreAll();
  });

  await t.test("explicit deps.policy bypasses settings (no settings read)", async (tt) => {
    quiet(tt);
    await setRow("free_llm.disabled", true);
    let settingsReads = 0;
    const p = pool();
    const realQuery = p.query.bind(p);
    tt.mock.method(p, "query", (async (text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string" && /FROM app_settings/.test(text)) settingsReads++;
      return (realQuery as (...a: unknown[]) => unknown)(text, ...rest);
    }) as never);
    const out = await spend.withFreeLlm({ endpoint: "udk", userId: uid }, async () => "seam", {
      policy: { ...spend.FREE_LLM_DEFAULTS },
      bucketPrefix: prefix(),
    });
    assert.equal(out, "seam");
    assert.equal(settingsReads, 0);
    tt.mock.restoreAll();
    await clearRows();
  });
});
