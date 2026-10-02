import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * AI cost and providers through the REAL routes (docs/admin/02-plan.md §6.7,
 * §9, §10 T12) on a throwaway Postgres:
 *   - `/api/admin/ai/cost`: every groupBy equals `admin-cost` (`spendBy`) row for
 *     row, totals equal `spendTotals`, coverage equals `spendCoverage`, caveats are
 *     `COST_CAVEATS`, units / unpriced counts present; completed, failed, abandoned,
 *     free and legacy `cost_json` rows are all counted; 400 on every bad param;
 *     60 s cache; the READ ONLY + statement_timeout transaction;
 *   - `/api/admin/ai/providers`: keys are booleans and no seeded fake key value
 *     appears anywhere in the response, breakers/limiters per process with stale
 *     marking, malformed heartbeat JSON is skipped, usage24h agrees with admin-cost;
 *   - permission: support and moderator get 403 (denied audit row), owner / admin /
 *     finance / viewer get 200, no admin session 401, non-admin 404.
 *
 * Mutation checks (each made the named assertion fail, then restored) are listed
 * in the work-package report.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-ai-test-token-never-called";

// Provider keys: start from a known state (`.env.local` may hold real ones), then seed fakes.
const FAKE = {
  GEMINI_API_KEY: "fake-gemini-key-AAAA1111",
  XAI_API_KEY: "fake-xai-key-BBBB2222",
  OPENAI_API_KEY: "fake-openai-key-CCCC3333",
  PEXELS_API_KEY: "fake-pexels-key-DDDD4444",
  AZURE_SPEECH_KEY: "fake-azure-key-EEEE5555",
} as const;
for (const k of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "XAI_API_KEY", "FAL_KEY", "PEXELS_API_KEY", "PIXABAY_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "AISHA_API_KEY"]) {
  delete process.env[k];
}
Object.assign(process.env, FAKE);

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("adminai") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const cost = await import("../lib/server/admin-cost.ts");
const { parseDateRange } = await import("../lib/server/admin-list.ts");
const ai = await import("../lib/server/admin-ai.ts");
const hb = await import("../lib/server/admin-heartbeat.ts");
const { HEARTBEAT_INTERVAL_MS } = await import("../lib/server/heartbeat.ts");
const jc = await import("../lib/generation/job-cost.ts");
const costRoute = await import("../app/api/admin/ai/cost/route.ts");
const providersRoute = await import("../app/api/admin/ai/providers/route.ts");
const { invalidateSettingsCache } = await import("../lib/server/settings.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb && iso.isolated) await ensureMigrated();

// ───────────────────────────── fixtures (admin-wallet.test.mts pattern)

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestAdmin = { id: string; userToken: string; adminId: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkAdmin(role: Role): Promise<TestAdmin> {
  const u = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'AI Test') RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `ai_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(u!.id);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u!.id, role],
  );
  return { id: u!.id, userToken: token, adminId: row!.id };
}

async function sessionFor(role: Role): Promise<{ cookie: string; admin: TestAdmin }> {
  const admin = await mkAdmin(role);
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(admin.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "ai-test", reauth: true }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

type Res<T = Record<string, unknown>> = { status: number; body: T; text: string };

async function call<T = Record<string, unknown>>(which: "cost" | "providers", qs: string, cookie: string | null): Promise<Res<T>> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "ai-test" };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost:3000/api/admin/ai/${which}${qs}`, { headers });
  const route = which === "cost" ? costRoute : providersRoute;
  const res = await inRequest(req, () => route.GET(req, undefined));
  const text = await res.text();
  let body = {} as T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body, text };
}

const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
/** A Tashkent wall-clock instant (UTC+5, no DST). */
const tk = (day: string, time: string): string => new Date(`${day}T${time}+05:00`).toISOString();

const D = "2026-03-10";
const D1 = "2026-03-11";
const SONNET = (inputTokens: number, outputTokens: number) => ({ provider: "anthropic", model: "claude-sonnet-5", inputTokens, outputTokens });
function meter(fill: (c: InstanceType<typeof jc.JobCost>) => void) {
  const c = new jc.JobCost();
  fill(c);
  return c.toJson();
}

// ───────────────────────────── seed


let userId = "";

async function gen(o: { tool: string; status: string; finishedAt: string; costJson?: unknown }): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, status, cost_json, created_at, finished_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz - interval '1 minute', $6::timestamptz)`,
    [id, userId, o.tool, o.status, o.costJson ? JSON.stringify(o.costJson) : null, o.finishedAt],
  );
  return id;
}
async function usage(o: { at: string; source: "job" | "free"; outcome: string; genId: string | null; tool: string; cost: ReturnType<typeof meter> | { calls: number; inputTokens: number; outputTokens: number; usd: number; parts?: unknown[] }; parts?: unknown[] }) {
  await query(
    `INSERT INTO ai_usage (at, source, outcome, generation_id, user_id, tool_id, calls, input_tokens, output_tokens, usd, parts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [o.at, o.source, o.outcome, o.genId, userId, o.tool, o.cost.calls, o.cost.inputTokens, o.cost.outputTokens, o.cost.usd, JSON.stringify(o.parts ?? o.cost.parts ?? [])],
  );
}

async function seed(): Promise<void> {
  const u = await queryOne<{ id: string }>(`INSERT INTO users (name) VALUES ('AI cost seed') RETURNING id::text AS id`, []);
  userId = u!.id;

  // Completed with BOTH cost_json and a completed ai_usage row: counted once.
  const costA = meter((c) => {
    c.addLlm(SONNET(1_000_000, 100_000));
    c.addImage("gemini", "gemini-3.1-flash-lite-image", 2);
  });
  const genA = await gen({ tool: "slide", status: "COMPLETED", finishedAt: tk(D, "10:00:00"), costJson: costA });
  await usage({ at: tk(D, "10:00:01"), source: "job", outcome: "completed", genId: genA, tool: "slide", cost: costA });

  // Legacy completed (only cost_json, with parts).
  const costB = meter((c) => {
    c.addLlm(SONNET(20_000, 4_000));
    c.addGrounding(2);
  });
  await gen({ tool: "article", status: "COMPLETED", finishedAt: tk(D, "23:30:00"), costJson: costB });

  // Legacy engine CostMeter cost_json without parts.
  await gen({ tool: "referat", status: "COMPLETED", finishedAt: tk(D, "12:00:00"), costJson: { provider: "openai", model: "gpt-legacy", inputTokens: 1_000, outputTokens: 500, calls: 3, usd: 0.25 } });

  // Failed job: unpriced fal image + an LLM model with no price → unpriced calls.
  const costD = meter((c) => {
    c.addLlm(SONNET(10_000, 2_000));
    c.addUnpricedImage("fal", "fal-ai/flux/dev");
    c.addLlm({ provider: "openrouter", model: "mystery-model", inputTokens: 100, outputTokens: 50 });
  });
  const genD = await gen({ tool: "pro-slide", status: "FAILED", finishedAt: tk(D, "13:00:00"), costJson: costD });
  await usage({ at: tk(D, "13:00:01"), source: "job", outcome: "failed", genId: genD, tool: "pro-slide", cost: costD });

  // Abandoned build of a deleted generation.
  const costE = meter((c) => c.addLlm(SONNET(5_000, 1_000)));
  await usage({ at: tk(D, "14:00:00"), source: "job", outcome: "abandoned", genId: randomUUID(), tool: "image", cost: costE });

  // Free call without parts → the "unknown" pseudo-part.
  await usage({ at: tk(D, "15:00:00"), source: "free", outcome: "free", genId: null, tool: "free:polish", cost: { calls: 1, inputTokens: 10, outputTokens: 5, usd: 0.02 }, parts: [] });

  // Completed without any cost data (coverage denominator only).
  await gen({ tool: "slide", status: "COMPLETED", finishedAt: tk(D, "16:00:00"), costJson: null });

  // Day D+1: a free LLM call.
  const costFree1 = meter((c) => c.addLlm(SONNET(2_000, 300)));
  await usage({ at: tk(D1, "09:00:00"), source: "free", outcome: "free", genId: null, tool: "free:udk", cost: costFree1 });
}

type CostBody = {
  range: { from: string; to: string; days: number };
  groupBy: string;
  rows: Array<{ key: string; title: string | null; calls: number; inputTokens: number; outputTokens: number; units: number | null; usd: number; records: number; unpricedCalls: number }>;
  totals: { records: number; calls: number; inputTokens: number; outputTokens: number; usd: number; unpricedCalls: number };
  coverage: { jobsWithCost: number; jobsCompleted: number; pct: number };
  caveats: string[];
  soumPerUsd: number;
};

// ───────────────────────────── heartbeat staleness rule (no DB)

test("isStale: three missed beats, derived from the heartbeat interval", () => {
  assert.equal(hb.HEARTBEAT_STALE_SEC, (HEARTBEAT_INTERVAL_MS * 3) / 1000);
  const now = Date.parse("2026-10-02T10:00:00Z");
  const ago = (sec: number) => new Date(now - sec * 1000);
  assert.equal(hb.isStale(ago(5), now), false);
  assert.equal(hb.isStale(ago(hb.HEARTBEAT_STALE_SEC), now), false, "exactly at the limit is still alive");
  assert.equal(hb.isStale(ago(hb.HEARTBEAT_STALE_SEC + 1), now), true);
  assert.equal(hb.isStale(ago(600).toISOString(), now), true, "ISO strings");
  assert.equal(hb.isStale("not a date", now), true);
});

// ───────────────────────────── cost

test("cost: every groupBy equals admin-cost exactly; totals, coverage, caveats, units, unpriced", { skip }, async () => {
  const s = await sessionFor("owner");
  await seed();
  ai.clearAiCache();
  const range = parseDateRange(D, D1);

  const totalsWant = await cost.spendTotals(pool(), range);
  const coverageWant = await cost.spendCoverage(pool(), range);
  assert.ok(totalsWant.usd > 0 && totalsWant.records === 7, `seed: ${JSON.stringify(totalsWant)}`);

  for (const by of ai.AI_GROUP_BY) {
    const r = await call<CostBody>("cost", `?from=${D}&to=${D1}&groupBy=${by}`, s.cookie);
    assert.equal(r.status, 200, r.text);
    const b = r.body;
    assert.equal(b.groupBy, by);
    assert.deepEqual(b.range, { from: D, to: D1, days: 2 });

    // Rows equal spendBy, field for field (the API maps groupBy 1:1 onto SpendGroupBy).
    const want = await cost.spendBy(pool(), range, by);
    assert.deepEqual(b.rows, want.map((w) => ({ key: w.key, title: by === "tool" ? ai.toolKeyTitle(w.key) : null, calls: w.calls, inputTokens: w.inputTokens, outputTokens: w.outputTokens, units: w.units, usd: w.usd, records: w.records, unpricedCalls: w.unpricedCalls })), `${by} rows`);

    // Totals equal spendTotals exactly (+ the unpriced count, which is the same for every grouping).
    assert.deepEqual({ ...b.totals, unpricedCalls: undefined }, { ...totalsWant, unpricedCalls: undefined }, `${by} totals`);
    assert.equal(b.totals.unpricedCalls, 2, `${by} unpriced (fal dev + unknown LLM)`);
    assert.equal(b.totals.unpricedCalls, b.rows.reduce((a, x) => a + x.unpricedCalls, 0));

    // Groupings sum to the totals.
    near(b.rows.reduce((a, x) => a + x.usd, 0), totalsWant.usd, `${by} usd sum`);
    assert.equal(b.rows.reduce((a, x) => a + x.calls, 0), totalsWant.calls, `${by} calls sum`);

    assert.deepEqual(b.coverage, coverageWant, `${by} coverage`);
    assert.deepEqual(b.caveats, [...cost.COST_CAVEATS], `${by} caveats`);
    assert.ok(b.caveats.length >= 9 && b.caveats.every((c) => typeof c === "string" && c.length > 20));
    assert.equal(typeof b.soumPerUsd, "number");
    // Only the tool grouping carries a title (the key itself is never rewritten).
    if (by === "tool") assert.ok(b.rows.every((x) => typeof x.title === "string" && x.title.length > 0), "tool: titles");
    else assert.ok(b.rows.every((x) => x.title === null), `${by}: no title`);
    if (by === "day" || by === "tool") assert.ok(b.rows.every((x) => x.units === null), `${by}: no mixed units`);
    else assert.ok(b.rows.every((x) => typeof x.units === "number"), `${by}: units present`);
  }
});

test("toolKeyTitle: registry titles, Uzbek free endpoints, unknown and retired keys", () => {
  assert.equal(ai.toolKeyTitle("pro-slide"), "Pro slayd");
  assert.equal(ai.toolKeyTitle("texnologik-xarita"), "Texnologik xarita");
  assert.equal(ai.toolKeyTitle("free:outline"), "Bepul AI: reja");
  assert.equal(ai.toolKeyTitle("free:udk"), "Bepul AI: UDK");
  assert.equal(ai.toolKeyTitle("free:rewrite"), "Bepul AI: qayta yozish");
  assert.equal(ai.toolKeyTitle("free:polish"), "Bepul AI: sayqal");
  assert.equal(ai.toolKeyTitle("free:new-endpoint"), "Bepul AI: new-endpoint");
  assert.equal(ai.toolKeyTitle("unknown"), "Noma'lum vosita");
  assert.equal(ai.toolKeyTitle(""), "Noma'lum vosita");
  assert.equal(ai.toolKeyTitle("retired-tool"), "retired-tool", "a retired tool keeps its stored id");
  assert.equal(ai.toolKeyTitle("__proto__"), "__proto__", "no prototype lookup");
});

test("cost: completed, failed, abandoned, free and legacy rows are each counted once", { skip }, async () => {
  const s = await sessionFor("viewer");
  ai.clearAiCache();
  const r = await call<CostBody>("cost", `?from=${D}&to=${D}&groupBy=tool`, s.cookie);
  assert.equal(r.status, 200, r.text);
  const byTool = Object.fromEntries(r.body.rows.map((x) => [x.key, x]));
  // slide (job A once), article (legacy), referat (legacy CostMeter), pro-slide (failed), image (abandoned), free:polish.
  assert.deepEqual(Object.keys(byTool).sort(), ["article", "free:polish", "image", "pro-slide", "referat", "slide"]);
  assert.equal(r.body.totals.records, 6);
  assert.equal(byTool["pro-slide"].unpricedCalls, 2);
  near(byTool.referat.usd, 0.25, "legacy referat");
  near(byTool["free:polish"].usd, 0.02, "free");
  // Titles resolved on the server from the registry; free endpoints are readable in Uzbek.
  assert.equal(byTool["pro-slide"].title, "Pro slayd");
  assert.equal(byTool.slide.title, "Slayd");
  assert.equal(byTool.referat.title, "Referat");
  assert.equal(byTool["free:polish"].title, "Bepul AI: sayqal");
  // Coverage: 4 completed jobs on D (A, B, referat, one without cost), 3 have cost data.
  assert.deepEqual(r.body.coverage, { jobsWithCost: 3, jobsCompleted: 4, pct: 75 });

  const kind = await call<CostBody>("cost", `?from=${D}&to=${D}&groupBy=kind`, s.cookie);
  const k = Object.fromEntries(kind.body.rows.map((x) => [x.key, x]));
  assert.equal(k.image.units, 3, "2 gemini + 1 fal image");
  assert.equal(k.grounding.units, 2);
  assert.equal(k.image.unpricedCalls, 1);
});

test("cost: day grouping is zero-filled over the whole range; empty range gives zeros", { skip }, async () => {
  const s = await sessionFor("finance");
  ai.clearAiCache();
  const r = await call<CostBody>("cost", `?from=2020-01-01&to=2020-01-03&groupBy=day`, s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.rows.map((x) => [x.key, x.usd, x.calls]), [["2020-01-01", 0, 0], ["2020-01-02", 0, 0], ["2020-01-03", 0, 0]]);
  assert.deepEqual(r.body.totals, { records: 0, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, unpricedCalls: 0 });
  assert.deepEqual(r.body.coverage, { jobsWithCost: 0, jobsCompleted: 0, pct: 0 });
  const t = await call<CostBody>("cost", `?from=2020-01-01&to=2020-01-03&groupBy=model`, s.cookie);
  assert.deepEqual(t.body.rows, []);
});

test("cost: defaults — no params is the last 30 days, grouped by day", { skip }, async () => {
  const s = await sessionFor("admin");
  const r = await call<CostBody>("cost", "", s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.groupBy, "day");
  assert.equal(r.body.range.days, 30);
  assert.equal(r.body.rows.length, 30);
});

test("cost: soumPerUsd comes from the finance.soum_per_usd setting", { skip }, async () => {
  const s = await sessionFor("owner");
  const r = await call<CostBody>("cost", `?from=${D}&to=${D}&groupBy=model`, s.cookie);
  assert.equal(r.body.soumPerUsd, await cost.soumPerUsd());
  // A changed setting shows at once even though the aggregates are cached.
  await query(`INSERT INTO app_settings (key, value) VALUES ('finance.soum_per_usd', '13000'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, []);
  invalidateSettingsCache();
  const again = await call<CostBody>("cost", `?from=${D}&to=${D}&groupBy=model`, s.cookie);
  assert.equal(again.body.soumPerUsd, 13_000);
  await query(`DELETE FROM app_settings WHERE key = 'finance.soum_per_usd'`, []);
  invalidateSettingsCache();
});

test("cost: bad params are 400, never 500; injection attempts are rejected", { skip }, async () => {
  const s = await sessionFor("owner");
  const bad = [
    "?groupBy=outcome",
    "?groupBy=hour",
    "?groupBy=DAY",
    `?groupBy=${encodeURIComponent("day; DROP TABLE ai_usage")}`,
    `?groupBy=${encodeURIComponent("day' OR '1'='1")}`,
    "?groupBy=day&groupBy=tool",
    "?from=2026-13-01",
    "?from=2026-02-30&to=2026-03-01",
    "?from=abc",
    `?from=${encodeURIComponent("2026-03-10' OR 1=1 --")}`,
    "?from=2026-03-10&to=2026-03-01",
    "?from=2024-01-01&to=2026-01-01",
    "?from=2026-03-10&from=2026-03-11",
  ];
  for (const qs of bad) {
    const r = await call("cost", qs, s.cookie);
    assert.equal(r.status, 400, `${qs} → ${r.status} ${r.text}`);
    assert.ok(typeof r.body.error === "string");
  }
  // The table is still there after the injection attempts.
  const ok = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM ai_usage`, []);
  assert.ok(Number(ok!.n) > 0);
  // 366 days is the limit and is accepted.
  const edge = await call("cost", "?from=2025-01-01&to=2026-01-01&groupBy=tool", s.cookie);
  assert.equal(edge.status, 200, edge.text);
});

test("cost: a response is cached for 60 s per (range, groupBy); clearing the cache reloads", { skip }, async () => {
  const s = await sessionFor("owner");
  const day = "2026-04-20";
  ai.clearAiCache();
  const first = await call<CostBody>("cost", `?from=${day}&to=${day}&groupBy=tool`, s.cookie);
  assert.equal(first.body.totals.records, 0);
  await usage({ at: tk(day, "11:00:00"), source: "free", outcome: "free", genId: null, tool: "free:outline", cost: meter((c) => c.addLlm(SONNET(1_000, 100))) });
  const cachedRes = await call<CostBody>("cost", `?from=${day}&to=${day}&groupBy=tool`, s.cookie);
  assert.equal(cachedRes.body.totals.records, 0, "served from the cache");
  // Another groupBy has its own key.
  const other = await call<CostBody>("cost", `?from=${day}&to=${day}&groupBy=model`, s.cookie);
  assert.equal(other.body.totals.records, 1);
  ai.clearAiCache();
  const fresh = await call<CostBody>("cost", `?from=${day}&to=${day}&groupBy=tool`, s.cookie);
  assert.equal(fresh.body.totals.records, 1);
});

test("aggregations run in a READ ONLY transaction with a 10 s statement_timeout", { skip }, async () => {
  const out = await ai.aiReadOnlyTx(async (client) => {
    const ro = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
    const st = await client.query<{ statement_timeout: string }>("SHOW statement_timeout");
    let writeCode = "";
    try {
      await client.query("SAVEPOINT w");
      await client.query("INSERT INTO app_settings (key, value) VALUES ('ai.test.readonly', 'true'::jsonb)");
    } catch (e) {
      writeCode = (e as { code?: string }).code ?? "";
    }
    return { ro: ro.rows[0].transaction_read_only, st: st.rows[0].statement_timeout, writeCode };
  });
  assert.equal(out.ro, "on");
  assert.equal(out.st, "10s");
  assert.equal(out.writeCode, "25006", "a write inside the aggregation transaction is refused");
  assert.equal((await queryOne(`SELECT 1 FROM app_settings WHERE key = 'ai.test.readonly'`, [])), null);
});

// ───────────────────────────── providers

async function beat(o: { id: string; role: "web" | "worker"; ageSec: number; breakers: unknown; limiters: unknown }) {
  await query(
    `INSERT INTO process_heartbeats (process_id, role, hostname, started_at, last_seen_at, running, concurrency, breakers, limiters)
     VALUES ($1, $2, 'host', now() - interval '1 hour', now() - ($3::int * interval '1 second'), 0, 0, $4::jsonb, $5::jsonb)
     ON CONFLICT (process_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, breakers = EXCLUDED.breakers, limiters = EXCLUDED.limiters`,
    [o.id, o.role, o.ageSec, JSON.stringify(o.breakers), JSON.stringify(o.limiters)],
  );
}

type ProvidersBody = {
  keys: Record<string, unknown>;
  processes: Array<{ process: string; role: string; lastSeenAt: string; stale: boolean }>;
  breakers: Array<{ process: string; name: string; state: string; openUntil: string | null; failures: number; stale: boolean }>;
  limiters: Array<{ process: string; name: string; active: number; waiting: number; max: number; stale: boolean }>;
  usage24h: Array<{ provider: string; model: string; calls: number; usd: number }>;
  soumPerUsd: number;
};

test("providers: keys are booleans, true exactly for the configured ones, and no key value is ever returned", { skip }, async () => {
  const s = await sessionFor("finance");
  const r = await call<ProvidersBody>("providers", "", s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body.keys).sort(), [...ai.PROVIDER_KEY_NAMES].sort());
  for (const [k, v] of Object.entries(r.body.keys)) assert.equal(typeof v, "boolean", `keys.${k}`);
  assert.deepEqual(r.body.keys, {
    gemini: true,
    anthropic: false,
    openai: true,
    openrouter: false,
    xai: true,
    fal: false,
    pexels: true,
    pixabay: false,
    azureTts: false, // key without region is not usable
    aisha: false,
  });
  // T12: no fake key value (or fragment of one) anywhere in the response text.
  for (const value of Object.values(FAKE)) {
    assert.ok(!r.text.includes(value), `response leaked ${value.slice(0, 12)}…`);
    assert.ok(!r.text.includes(value.slice(5, 20)), "response leaked a key fragment");
  }
  // Region present → azureTts true; whitespace-only key → false.
  process.env.AZURE_SPEECH_REGION = "fake-region";
  process.env.AISHA_API_KEY = "   ";
  try {
    const keys = ai.providerKeys();
    assert.equal(keys.azureTts, true);
    assert.equal(keys.aisha, false);
    assert.ok(Object.values(keys).every((v) => typeof v === "boolean"));
  } finally {
    delete process.env.AZURE_SPEECH_REGION;
    delete process.env.AISHA_API_KEY;
  }
});

test("providers: breakers and limiters per process, stale marked, malformed JSON skipped", { skip }, async () => {
  const s = await sessionFor("owner");
  await query(`DELETE FROM process_heartbeats`, []);
  const until = new Date(Date.now() + 40_000).toISOString();
  await beat({
    id: "worker@host-a:11",
    role: "worker",
    ageSec: 5,
    breakers: [
      { name: "gemini", state: "open", openUntil: until, failures: 0 },
      { name: "image:pexels", state: "closed", openUntil: null, failures: 2 },
      { name: "xai", state: "half-open", openUntil: null, failures: 0 },
    ],
    limiters: [{ name: "gemini", active: 7, waiting: 2, max: 10 }],
  });
  await beat({
    id: "web@host-b:22",
    role: "web",
    ageSec: 600,
    breakers: [{ name: "gemini", state: "open", openUntil: until, failures: 9 }],
    limiters: [{ name: "gemini", active: 1, waiting: 0, max: 10 }],
  });
  // Hand-edited garbage must not break the page.
  await beat({ id: "worker@host-c:33", role: "worker", ageSec: 1, breakers: [{ name: 5 }, "x", null, { name: "ok", state: "weird", failures: -3, openUntil: "not a date" }], limiters: { not: "an array" } });

  const r = await call<ProvidersBody>("providers", "", s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.processes.map((p) => [p.process, p.role, p.stale]), [
    ["web@host-b:22", "web", true],
    ["worker@host-a:11", "worker", false],
    ["worker@host-c:33", "worker", false],
  ]);
  const gemA = r.body.breakers.find((b) => b.process === "worker@host-a:11" && b.name === "gemini");
  assert.deepEqual(gemA, { process: "worker@host-a:11", name: "gemini", state: "open", openUntil: until, failures: 0, stale: false });
  assert.equal(r.body.breakers.find((b) => b.process === "worker@host-a:11" && b.name === "xai")?.state, "half-open");
  const gemStale = r.body.breakers.find((b) => b.process === "web@host-b:22");
  assert.equal(gemStale?.stale, true);
  assert.equal(gemStale?.failures, 9);
  // Garbage: only the one object with a name survives, normalised.
  assert.deepEqual(r.body.breakers.filter((b) => b.process === "worker@host-c:33"), [
    { process: "worker@host-c:33", name: "ok", state: "closed", openUntil: null, failures: 0, stale: false },
  ]);
  assert.deepEqual(r.body.limiters.filter((l) => l.process === "worker@host-c:33"), []);
  assert.deepEqual(r.body.limiters.find((l) => l.process === "worker@host-a:11"), { process: "worker@host-a:11", name: "gemini", active: 7, waiting: 2, max: 10, stale: false });
  assert.equal(r.body.limiters.find((l) => l.process === "web@host-b:22")?.stale, true);
  await query(`DELETE FROM process_heartbeats`, []);
  const empty = await call<ProvidersBody>("providers", "", s.cookie);
  assert.deepEqual([empty.body.processes, empty.body.breakers, empty.body.limiters], [[], [], []]);
});

test("providers: usage24h by provider/model agrees with admin-cost over the same window", { skip }, async () => {
  const s = await sessionFor("viewer");
  await query(`DELETE FROM ai_usage`, []);
  await query(`DELETE FROM generations`, []);
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const cost1 = meter((c) => {
    c.addLlm(SONNET(100_000, 10_000));
    c.addImage("gemini", "gemini-3.1-flash-lite-image", 3);
  });
  const cost2 = meter((c) => c.addLlm({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 50_000, outputTokens: 5_000 }));
  await usage({ at: hoursAgo(1), source: "job", outcome: "completed", genId: randomUUID(), tool: "slide", cost: cost1 });
  await usage({ at: hoursAgo(2), source: "job", outcome: "failed", genId: randomUUID(), tool: "slide", cost: cost2 });
  await usage({ at: hoursAgo(3), source: "free", outcome: "free", genId: null, tool: "free:outline", cost: cost2 });
  // A row with spend but no parts → unknown/unknown.
  await usage({ at: hoursAgo(4), source: "free", outcome: "free", genId: null, tool: "free:udk", cost: { calls: 2, inputTokens: 10, outputTokens: 5, usd: 0.03 }, parts: [] });
  // Legacy completed job finished 5 h ago (cost_json only, no parts).
  await gen({ tool: "referat", status: "COMPLETED", finishedAt: hoursAgo(5), costJson: { provider: "openai", model: "gpt-legacy", inputTokens: 10, outputTokens: 5, calls: 1, usd: 0.5 } });
  // Outside the window: 30 h ago must not appear.
  await usage({ at: hoursAgo(30), source: "free", outcome: "free", genId: null, tool: "free:rewrite", cost: meter((c) => c.addLlm(SONNET(900_000, 90_000))) });
  ai.clearAiCache();

  const r = await call<ProvidersBody>("providers", "", s.cookie);
  assert.equal(r.status, 200, r.text);
  const u = r.body.usage24h;
  const pair = (p: string, m: string) => u.find((x) => x.provider === p && x.model === m);
  assert.ok(pair("anthropic", "claude-sonnet-5"));
  assert.ok(pair("gemini", "gemini-3.7-flash"));
  assert.ok(pair("gemini", "gemini-3.1-flash-lite-image"));
  assert.equal(pair("gemini", "gemini-3.1-flash-lite-image")?.calls, 3);
  assert.ok(pair("unknown", "unknown"), "row without parts");
  near(pair("openai", "gpt-legacy")?.usd ?? -1, 0.5, "legacy cost_json");
  assert.ok(u.every((x, i) => i === 0 || u[i - 1].usd >= x.usd), "sorted by usd desc");

  // Same canonical rows, different grouping: sums equal spendTotals / spendBy over the window.
  const window = { fromTs: new Date(Date.now() - 24 * 3_600_000).toISOString(), toTsExclusive: new Date(Date.now() + 1000).toISOString() };
  const totals = await cost.spendTotals(pool(), window);
  near(u.reduce((a, x) => a + x.usd, 0), totals.usd, "usage24h usd = spendTotals");
  assert.equal(u.reduce((a, x) => a + x.calls, 0), totals.calls);
  const byProvider = await cost.spendBy(pool(), window, "provider");
  const byModel = await cost.spendBy(pool(), window, "model");
  for (const p of byProvider) near(u.filter((x) => x.provider === p.key).reduce((a, x) => a + x.usd, 0), p.usd, `provider ${p.key}`);
  for (const m of byModel) near(u.filter((x) => x.model === m.key).reduce((a, x) => a + x.usd, 0), m.usd, `model ${m.key}`);
  assert.equal(typeof r.body.soumPerUsd, "number");
});

// ───────────────────────────── permission

test("permission: ai.view — owner, admin, finance, viewer get 200; support and moderator get 403 with a denied audit row", { skip }, async () => {
  for (const which of ["cost", "providers"] as const) {
    const qs = which === "cost" ? `?from=${D}&to=${D}&groupBy=tool` : "";
    for (const role of ["owner", "admin", "finance", "viewer"] as const) {
      const s = await sessionFor(role);
      const r = await call(which, qs, s.cookie);
      assert.equal(r.status, 200, `${which} ${role}: ${r.text}`);
    }
    for (const role of ["support", "moderator"] as const) {
      const s = await sessionFor(role);
      const r = await call(which, qs, s.cookie);
      assert.equal(r.status, 403, `${which} ${role}`);
      assert.equal(r.body.code, "forbidden");
      const audit = await query<{ outcome: string; action: string }>(`SELECT outcome, action FROM admin_audit_log WHERE admin_id = $1`, [s.admin.adminId]);
      assert.equal(audit.length, 1, `${which} ${role}: one denied row`);
      assert.equal(audit[0].outcome, "denied");
      assert.ok(!r.text.includes("usd") && !r.text.includes("rows"), "a 403 carries no data");
    }
  }
});

test("guard: no admin session is 401 admin_auth, a user without an admin account is 404", { skip }, async () => {
  const s = await sessionFor("owner");
  const userOnly = s.cookie.split("; ")[0];
  for (const which of ["cost", "providers"] as const) {
    const r401 = await call(which, "", userOnly);
    assert.equal(r401.status, 401);
    assert.equal(r401.body.code, "admin_auth");
    const r404 = await call(which, "", null);
    assert.equal(r404.status, 404);
  }
});
