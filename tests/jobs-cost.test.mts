import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * `setCost` — LLM sarf telemetriyasi (Maqola 2 / AUDIT-17, WP4).
 *
 * Birinchi ikki test BAZASIZ (`tests/jobs-live-edit.test.mts` naqshi):
 * hovuzning `query` metodi ushlanadi va SQL matni/parametrlari
 * tekshiriladi — egalik (`locked_by`) predikati va `price` ustuniga
 * TEGMAGANI CI da (DATABASE_URL bo'lmasa ham) sinaladi. Uchinchi test
 * haqiqiy Postgres bilan to'liq yo'lni (yozish, `price` o'zgarmasligi,
 * begona worker yozib yubormasligi) tasdiqlaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { setCost } = await import("../lib/server/jobs.ts");

function sql(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const SAMPLE_COST = { provider: "anthropic", model: "claude-sonnet-5", inputTokens: 25_000, outputTokens: 2_000, calls: 1, usd: 0.09 };

test("setCost: cost_json ni yangilaydi, egalik (locked_by) SQL da, price ga TEGMAYDI (bazasiz)", async (t: TestContext) => {
  const p = pool();
  const seen: { text: string; params: unknown[] }[] = [];
  t.mock.method(p, "query", async (text: string, params: unknown[] = []) => {
    seen.push({ text, params });
    return { rows: [{ id: "g1" }], rowCount: 1 };
  });

  const ok = await setCost("g1", "worker-1", SAMPLE_COST);
  assert.equal(ok, true);
  assert.equal(seen.length, 1, "setCost aynan bitta so'rov yuborishi kerak");

  const text = sql(seen[0].text);
  assert.match(text, /UPDATE generations/);
  assert.match(text, /SET cost_json = \$3/);
  // MUTATSIYA: `AND locked_by = \$2` olib tashlansa, bu qator qizaradi —
  // egalik SQL darajasida bo'lishi SHART (CLAUDE.md).
  assert.match(text, /WHERE id = \$1 AND locked_by = \$2/, "egalik predikati SQL da bo'lishi SHART");
  // MUTATSIYA: `SET` ga `price = ...` qo'shilsa, bu qator qizaradi.
  assert.doesNotMatch(text, /\bprice\s*=/, "narx/kredit bu funksiyaga umuman TEGMASLIGI kerak");
  assert.deepEqual(seen[0].params, ["g1", "worker-1", JSON.stringify(SAMPLE_COST)]);
});

test("setCost: qulf boshqada yoki ish IN_PROGRESS emas — false (bazasiz)", async (t: TestContext) => {
  const p = pool();
  t.mock.method(p, "query", async () => ({ rows: [], rowCount: 0 }));
  const ok = await setCost("g1", "worker-1", SAMPLE_COST);
  assert.equal(ok, false);
});

test(
  "setCost: haqiqiy yozish — price o'zgarmaydi, begona worker yozib yubormaydi",
  { skip: hasDb ? false : "DATABASE_URL yo'q" },
  async (t: TestContext) => {
    const { query, queryOne, migrate } = await import("../lib/server/db.ts");
    await migrate();
    const { randomUUID } = await import("node:crypto");

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`,
      [`jobs_cost_${stamp}`],
    );
    const uid = String(user!.id);
    const gid = randomUUID();
    const workerId = "w-1";

    t.after(async () => {
      await query(`DELETE FROM generations WHERE id = $1`, [gid]).catch(() => {});
      await query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
      await pool().end();
    });

    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, status, locked_by, locked_at)
       VALUES ($1, $2, 'article', 'Sinov', 4000, 'docx', '{}'::jsonb, 'Ishlanmoqda', 90000, 'IN_PROGRESS', $3, now())`,
      [gid, uid, workerId],
    );

    const ok = await setCost(gid, workerId, SAMPLE_COST);
    assert.equal(ok, true);

    const row = await queryOne<{ cost_json: typeof SAMPLE_COST; price: string }>(
      `SELECT cost_json, price::text FROM generations WHERE id = $1`,
      [gid],
    );
    assert.deepEqual(row?.cost_json, SAMPLE_COST);
    assert.equal(row?.price, "4000", "price o'zgarmasligi kerak");

    // Boshqa worker — qulf mos kelmaydi (locked_by ≠), false va yozuv o'zgarmaydi.
    const ok2 = await setCost(gid, "begona-worker", { ...SAMPLE_COST, usd: 999 });
    assert.equal(ok2, false);
    const row2 = await queryOne<{ cost_json: { usd: number } }>(
      `SELECT cost_json FROM generations WHERE id = $1`,
      [gid],
    );
    assert.equal(row2?.cost_json?.usd, 0.09, "begona worker cost_json ni almashtirib yubormadi");
  },
);
