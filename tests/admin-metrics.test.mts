import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Dashboard metrics (`lib/server/admin-metrics.ts`, docs/admin/02-plan.md
 * §6.3, §9) through the REAL routes on a throwaway Postgres.
 *
 * One hand-built fixture over R = 2026-03-10..2026-03-11 (Tashkent) and its
 * previous period P = 2026-03-08..2026-03-09. Every expected number below is
 * computed by hand in the comments, not by re-running the SQL:
 *   - range edges are Tashkent midnights (00:00:00 in, next 00:00:00 out);
 *   - revenue uses perform_time (ms), not created_at; cash vs points split;
 *   - refunds are counted when they happen (a P charge refunded in R lowers R);
 *   - the tools table's cash sums to the overview's cashSpendTanga, also for a
 *     deleted generation (tool taken from the charge note);
 *   - AI cost/coverage equal admin-cost.ts for the same range;
 *   - series are zero-filled per Tashkent day; live is never cached.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - revenue by created_at instead of perform_time → overview + series;
 *   - perform_time upper bound inclusive (O3 at the next midnight) → overview + series;
 *   - cash spend not net of refunds → overview (15000 ≠ 7300) + tools;
 *   - points counted as cash → overview + tools;
 *   - no charge-note fallback for deleted jobs → tools (coursework row missing);
 *   - successRate over all jobs (incl. revoked/queued) → overview (50 ≠ 75);
 *   - activeUsers without the last_seen branch → overview (4 ≠ 5);
 *   - no `SET TRANSACTION READ ONLY` → the read-only helper test inserts a row;
 *   - the cache never hits → cache test;
 *   - previous range one day too long → previousRangeOf;
 *   - worker stale threshold ×10 → live (the 5-min-old worker counted alive).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const iso = hasDb ? await createIsolatedDb("metrics") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { setSettingInTx, invalidateSettingsCache } = await import("../lib/server/settings.ts");
const { createOrder, settleOrder } = await import("../lib/server/payments.ts");
/** The removed Pro subscription's price (the former `PRO_PLAN.priceSoum`): legacy orders only. */
const LEGACY_PRO_SOUM = 15_000;
const metrics = await import("../lib/server/admin-metrics.ts");
const cost = await import("../lib/server/admin-cost.ts");
const { parseDateRange } = await import("../lib/server/admin-list.ts");
const routes = {
  overview: await import("../app/api/admin/metrics/overview/route.ts"),
  series: await import("../app/api/admin/metrics/series/route.ts"),
  tools: await import("../app/api/admin/metrics/tools/route.ts"),
  live: await import("../app/api/admin/metrics/live/route.ts"),
};

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

/** A Tashkent wall-clock instant (UTC+5, no DST). */
const tk = (day: string, time: string): string => new Date(`${day}T${time}+05:00`).toISOString();
const ms = (instant: string): number => Date.parse(instant);
const D10 = "2026-03-10";
const D11 = "2026-03-11";
const D12 = "2026-03-12";
const D09 = "2026-03-09";
const D08 = "2026-03-08";
const RATE = 12_500;

// ───────────────────────────── unit (no DB)

test("previousRangeOf: the equal-length range that ends the day before", () => {
  const r = parseDateRange(D10, D11);
  const p = metrics.previousRangeOf(r);
  assert.equal(p.fromDay, D08);
  assert.equal(p.toDay, D09);
  assert.equal(p.days, 2);
  assert.equal(p.fromTs, tk(D08, "00:00:00"));
  assert.equal(p.toTsExclusive, r.fromTs);
  const one = metrics.previousRangeOf(parseDateRange("2026-03-01", "2026-03-01"));
  assert.deepEqual([one.fromDay, one.toDay, one.days], ["2026-02-28", "2026-02-28", 1]);
  const year = metrics.previousRangeOf(parseDateRange("2025-03-11", "2026-03-11"));
  assert.deepEqual([year.fromDay, year.toDay, year.days], ["2024-03-10", "2025-03-10", 366]);
});

test("metricsRangeOf / seriesMetricOf: strict params, 400 never 500", () => {
  const u = (qs: string) => new URL(`http://x/api/admin/metrics/overview?${qs}`);
  const r = metrics.metricsRangeOf(u(""), Date.parse("2026-03-11T12:00:00Z"));
  assert.deepEqual([r.fromDay, r.toDay, r.days], ["2026-02-10", D11, 30], "default: the last 30 days ending today");
  for (const qs of ["from=2026-13-01", "from=2026-03-11&to=2026-03-10", "from=2025-01-01&to=2026-03-10", "from=a&from=b", "from=2026-03-10'%20OR%201=1--"]) {
    assert.throws(() => metrics.metricsRangeOf(u(qs)), (e: { status: number }) => e.status === 400, qs);
  }
  assert.equal(metrics.seriesMetricOf(u("metric=ai_cost")), "ai_cost");
  for (const qs of ["", "metric=", "metric=Revenue", "metric=revenue;DROP%20TABLE%20users", "metric=revenue&metric=signups"]) {
    assert.throws(() => metrics.seriesMetricOf(u(qs)), (e: { status: number }) => e.status === 400, qs);
  }
});

test("toolTitle: registry titles, free-LLM keys, unknown", () => {
  assert.equal(metrics.toolTitle("slide"), "Slayd");
  assert.equal(metrics.toolTitle("free:outline"), "Bepul AI: reja");
  assert.equal(metrics.toolTitle("unknown"), "Noma'lum");
  assert.equal(metrics.toolTitle("retired-tool"), "retired-tool");
});

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(createdAt: string, name = "Metrics Test"): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, created_at) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `m_${randomBytes(5).toString("hex")}`, name, createdAt],
  );
  return row!.id;
}

async function session(role: Role | null): Promise<string> {
  const uid = await mkUser(new Date().toISOString(), "Admin");
  const { token } = await createSession(uid);
  if (!role) return `${SESSION_COOKIE}=${token}`;
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [uid, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "metrics-test", reauth: false }),
  );
  return `${SESSION_COOKIE}=${token}; ${adminCookieName()}=${s.token}`;
}

type Res = { status: number; body: Record<string, unknown> };
async function get(ep: keyof typeof routes, qs: string, cookie: string | null): Promise<Res> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "metrics-test" };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost:3000/api/admin/metrics/${ep}${qs ? `?${qs}` : ""}`, { headers });
  const res = await inRequest(req, () => routes[ep].GET(req, undefined));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type Gen = { id?: string; user: string; tool: string; status: string; createdAt: string; startedAt?: string; finishedAt?: string; costJson?: object };
async function gen(g: Gen): Promise<string> {
  const id = g.id ?? randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, status, created_at, started_at, finished_at, cost_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [id, g.user, g.tool, g.status, g.createdAt, g.startedAt ?? null, g.finishedAt ?? null, g.costJson ? JSON.stringify(g.costJson) : null],
  );
  return id;
}
type Wallets = { points?: number; quota?: number; balance?: number };
/** Ledger row exactly as credits.ts writes it: charges negative, refunds positive. */
async function ledger(kind: "charge" | "refund", user: string, ref: string, at: string, w: Wallets, note = "") {
  const sign = kind === "charge" ? -1 : 1;
  await query(
    `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [user, kind, sign * (w.points ?? 0), sign * (w.quota ?? 0), sign * (w.balance ?? 0), ref, note, at],
  );
}
async function usage(at: string, outcome: string, genId: string | null, tool: string, usd: number) {
  await query(
    `INSERT INTO ai_usage (at, source, outcome, generation_id, user_id, tool_id, calls, usd)
     VALUES ($1, $2, $3, $4, NULL, $5, 1, $6)`,
    [at, outcome === "free" ? "free" : "job", outcome, genId, tool, usd],
  );
}
/**
 * Paid order through the real payments path; perform_time is epoch ms. A legacy
 * Pro order is inserted by SQL (`createOrder` accepts top-ups only since the
 * subscription removal) and then settled by the real `settleOrder`.
 */
async function paidOrder(user: string, provider: "click" | "payme", purpose: "topup" | "pro", amount: number, createdAt: string, performAt: string) {
  const o =
    purpose === "pro"
      ? (await queryOne<{ id: string }>(
          `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum) VALUES ($1, $2, $3, 'pro', $4) RETURNING id::text AS id`,
          [randomUUID(), user, provider, amount],
        ))!
      : await createOrder({ userId: user, provider, purpose, amountSoum: amount });
  await query(`UPDATE payment_orders SET created_at = $2 WHERE id = $1`, [o.id, createdAt]);
  const out = await settleOrder(o.id, ms(performAt));
  assert.equal(out.status, "paid");
}
async function order(user: string, state: string, createdAt: string) {
  await query(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state, created_at) VALUES ($1, $2, 'payme', 'topup', 30000, $3, $4)`,
    [randomUUID(), user, state, createdAt],
  );
}
async function sessionRow(user: string, createdAt: string, lastSeenAt: string) {
  await query(
    `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, now() + interval '30 days')`,
    [user, sha256(randomUUID()), createdAt, lastSeenAt],
  );
}

let seeded: Promise<void> | null = null;
function seed(): Promise<void> {
  seeded ??= (async () => {
    await ensureMigrated();
    await transaction(async (c) => {
      await setSettingInTx(c, "finance.soum_per_usd", RATE, null);
    });
    invalidateSettingsCache();

    // Users. newUsers R = U1 (00:00:00 edge) + U2 = 2; P = U4 = 1; U3 is the day after R.
    const U0 = await mkUser("2026-01-01T00:00:00Z", "U0 old");
    const U1 = await mkUser(tk(D10, "00:00:00"));
    const U2 = await mkUser(tk(D11, "23:59:59"));
    await mkUser(tk(D12, "00:00:00"));
    const U4 = await mkUser(tk(D09, "12:00:00"));
    const U5 = await mkUser("2026-01-01T00:00:00Z");
    const U6 = await mkUser("2026-01-01T00:00:00Z");
    const U7 = await mkUser("2026-01-01T00:00:00Z");

    // Sessions. U5 last seen in R; U6 logged in during R (last seen after R);
    // U7's last touch is after R and it logged in before R → not counted (lower bound).
    await sessionRow(U5, "2026-02-01T00:00:00Z", tk(D10, "20:00:00"));
    await sessionRow(U6, tk(D11, "08:00:00"), tk(D12, "10:00:00"));
    await sessionRow(U7, "2026-02-01T00:00:00Z", "2026-03-20T00:00:00Z");

    // Generations created in R (G1, G2, G3, G4, G5, G10), in P (G6, G7), after R (G9).
    const G1 = await gen({ user: U1, tool: "slide", status: "COMPLETED", createdAt: tk(D10, "10:00:00"), startedAt: tk(D10, "10:00:00"), finishedAt: tk(D10, "10:01:40"), costJson: { usd: 0.5, calls: 1, inputTokens: 0, outputTokens: 0 } });
    const G2 = await gen({ user: U2, tool: "slide", status: "COMPLETED", createdAt: tk(D11, "12:00:00"), startedAt: tk(D11, "12:00:00"), finishedAt: tk(D11, "12:00:50"), costJson: { usd: 0.25, calls: 1, inputTokens: 0, outputTokens: 0 } });
    const G3 = await gen({ user: U0, tool: "article", status: "FAILED", createdAt: tk(D11, "13:00:00"), startedAt: tk(D11, "13:00:00"), finishedAt: tk(D11, "13:05:00") });
    const G4 = await gen({ user: U0, tool: "referat", status: "REVOKED", createdAt: tk(D10, "14:00:00"), finishedAt: tk(D10, "14:01:00") });
    const G5 = await gen({ user: U0, tool: "slide", status: "QUEUED", createdAt: tk(D11, "20:00:00") });
    await gen({ user: U1, tool: "slide", status: "COMPLETED", createdAt: tk(D10, "18:00:00"), startedAt: tk(D10, "18:00:30"), finishedAt: tk(D10, "18:01:00") }); // G10: no cost data
    const G6 = await gen({ user: U4, tool: "image", status: "COMPLETED", createdAt: tk(D09, "10:00:00"), startedAt: tk(D09, "10:00:00"), finishedAt: tk(D09, "10:00:20"), costJson: { usd: 0.3, calls: 1, inputTokens: 0, outputTokens: 0 } });
    const G7 = await gen({ user: U0, tool: "slide", status: "FAILED", createdAt: tk(D09, "11:00:00"), startedAt: tk(D09, "11:00:00"), finishedAt: tk(D09, "11:02:00") });
    const G9 = await gen({ user: U0, tool: "slide", status: "COMPLETED", createdAt: tk(D12, "00:00:00"), startedAt: tk(D12, "00:00:00"), finishedAt: tk(D12, "00:01:00"), costJson: { usd: 1, calls: 1, inputTokens: 0, outputTokens: 0 } });
    const G8 = randomUUID(); // deleted by its owner: only the ledger keeps it

    // Ledger. Charges carry the jobs.ts note `<toolId>: <topic>`.
    await ledger("charge", U1, G1, tk(D10, "10:00:00"), { balance: 3000 }, "slide: A");
    await ledger("charge", U2, G2, tk(D11, "12:00:00"), { points: 1000, balance: 2000 }, "slide: B");
    await ledger("charge", U0, G3, tk(D11, "13:00:00"), { quota: 5000 }, "article: C");
    await ledger("charge", U0, G4, tk(D10, "14:00:00"), { points: 500 }, "referat: D");
    await ledger("charge", U0, G5, tk(D11, "20:00:00"), { balance: 1000 }, "slide: E");
    await ledger("charge", U0, G8, tk(D10, "15:00:00"), { balance: 4000 }, "coursework: F");
    await ledger("charge", U4, G6, tk(D09, "10:00:00"), { balance: 800 }, "image: G");
    await ledger("charge", U0, G7, tk(D09, "11:00:00"), { balance: 700 }, "slide: H");
    await ledger("charge", U0, G9, tk(D12, "00:00:00"), { balance: 9999 }, "slide: I");
    await ledger("refund", U0, G3, tk(D11, "13:10:00"), { quota: 5000 });
    await ledger("refund", U0, G4, tk(D10, "14:01:00"), { points: 500 });
    await ledger("refund", U0, G7, tk(D10, "00:30:00"), { balance: 700 }); // P charge, refunded in R
    await ledger("refund", U2, G2, tk(D11, "12:30:00"), { points: 500, balance: 1000 }); // partial
    await ledger("refund", U0, G8, tk(D11, "09:00:00"), { balance: 1000 }); // deleted job, partial
    // Rows of other kinds never count as spend.
    await query(`INSERT INTO transactions (user_id, kind, balance_delta, note, created_at) VALUES ($1, 'admin_credit', 50000, 'x', $2)`, [U0, tk(D10, "12:00:00")]);

    // AI spend. G1: cost_json + completed ai_usage → once (0.5). G2 legacy (0.25). G3 failed (0.1).
    await usage(tk(D10, "10:01:41"), "completed", G1, "slide", 0.5);
    await usage(tk(D11, "13:05:00"), "failed", G3, "article", 0.1);
    await usage(tk(D10, "16:00:00"), "free", null, "free:outline", 0.05);

    // Orders. O1 created in P but performed in R; O3 performed at the first instant after R.
    await paidOrder(U0, "click", "topup", 50_000, tk(D09, "23:00:00"), tk(D10, "08:00:00"));
    await paidOrder(U1, "payme", "pro", LEGACY_PRO_SOUM, tk(D11, "23:00:00"), tk(D11, "23:59:59"));
    await paidOrder(U0, "payme", "topup", 20_000, tk(D11, "23:00:00"), tk(D12, "00:00:00"));
    await paidOrder(U4, "click", "topup", 10_000, tk(D09, "17:00:00"), tk(D09, "18:00:00"));
    await order(U0, "pending", tk(D10, "11:00:00"));
    await order(U0, "created", tk(D10, "11:00:00"));
    await order(U0, "cancelled", tk(D10, "11:00:00"));
    await order(U0, "pending", tk(D08, "10:00:00"));
  })();
  return seeded;
}

// ───────────────────────────── overview

test("overview: every KPI of R and of the previous period P, hand-computed", { skip }, async () => {
  await seed();
  metrics.clearMetricsCache();
  const owner = await session("owner");
  const r = await get("overview", `from=${D10}&to=${D11}`, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.range, { from: D10, to: D11, days: 2, previous: { from: D08, to: D09, days: 2 } });
  assert.equal(r.body.soumPerUsd, RATE);

  const cur = r.body.current as Record<string, unknown>;
  assert.deepEqual(cur, {
    newUsers: 2, // U1, U2
    activeUsers: 5, // jobs: U0, U1, U2; sessions: U5 (last seen), U6 (login)
    generations: { total: 6, completed: 3, failed: 1, revoked: 1 }, // G1 G2 G10 | G3 | G4 | G5 queued
    successRate: 75, // 3 / (3 + 1)
    revenueSoum: { total: 65_000, click: 50_000, payme: 15_000, topup: 50_000, pro: 15_000 }, // O1 + O2
    paidOrders: 2,
    // charges cash 3000 + 2000 + 5000 + 1000 + 4000 = 15000; refunds cash 5000 + 700 + 1000 + 1000 = 7700
    cashSpendTanga: 7_300,
    // charges points 1000 + 500 = 1500; refunds points 500 + 500 = 1000
    bonusSpendPoints: 500,
    refunds: { count: 5, tanga: 7_700, points: 1_000 },
    aiCostUsd: 0.9, // 0.5 + 0.25 + 0.1 + 0.05
    // G1, G2 of G1, G2, G10; the rollout is G1's own finish (its ai_usage row follows 1 s later), nothing is earlier.
    aiCoverage: { jobsWithCost: 2, jobsCompleted: 3, pct: (2 / 3) * 100, rolloutAt: tk(D10, "10:01:40"), historicalCompleted: 0, historicalWithCost: 0 },
    marginSoum: 65_000 - 11_250, // 0.9 × 12 500 = 11 250
    pendingOrders: 1,
  });

  const prev = r.body.previous as Record<string, unknown>;
  assert.deepEqual(prev, {
    newUsers: 1, // U4
    activeUsers: 2, // jobs: U4 (G6), U0 (G7)
    generations: { total: 2, completed: 1, failed: 1, revoked: 0 },
    successRate: 50,
    revenueSoum: { total: 10_000, click: 10_000, payme: 0, topup: 10_000, pro: 0 }, // O4
    paidOrders: 1,
    cashSpendTanga: 1_500, // 800 + 700; G7's refund happened in R
    bonusSpendPoints: 0,
    refunds: { count: 0, tanga: 0, points: 0 },
    aiCostUsd: 0.3,
    // G6 finished before the first ai_usage row: historical, so it neither counts as covered nor as a gap.
    aiCoverage: { jobsWithCost: 0, jobsCompleted: 0, pct: 0, rolloutAt: tk(D10, "10:01:40"), historicalCompleted: 1, historicalWithCost: 1 },
    marginSoum: 10_000 - 3_750,
    pendingOrders: 1,
  });

  // AI numbers are exactly the canonical admin-cost ones for the same range.
  const range = parseDateRange(D10, D11);
  assert.equal(cur.aiCostUsd, (await cost.spendTotals(pool(), range)).usd);
  assert.deepEqual(cur.aiCoverage, await cost.spendCoverage(pool(), range));
});

test("overview: an empty range is all zeros with null rates", { skip }, async () => {
  await seed();
  const r = await get("overview", "from=2025-01-01&to=2025-01-31", await session("viewer"));
  assert.equal(r.status, 200);
  const cur = r.body.current as Record<string, unknown>;
  assert.equal(cur.successRate, null);
  assert.equal(cur.newUsers, 0);
  assert.equal(cur.aiCostUsd, 0);
  assert.deepEqual(cur.aiCoverage, { jobsWithCost: 0, jobsCompleted: 0, pct: 0, rolloutAt: tk(D10, "10:01:40"), historicalCompleted: 0, historicalWithCost: 0 });
  assert.equal(cur.marginSoum, 0);
});

// ───────────────────────────── series

test("series: zero-filled Tashkent days for every metric, hand-computed", { skip }, async () => {
  await seed();
  metrics.clearMetricsCache();
  const cookie = await session("viewer");
  const days = (body: Record<string, unknown>) => (body.points as Array<{ day: string; values: Record<string, number> }>);

  const rev = await get("series", `metric=revenue&from=${D10}&to=${D11}`, cookie);
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  assert.equal(rev.body.metric, "revenue");
  assert.deepEqual(days(rev.body), [
    { day: D10, values: { total: 50_000, click: 50_000, payme: 0, topup: 50_000, pro: 0, orders: 1 } },
    { day: D11, values: { total: 15_000, click: 0, payme: 15_000, topup: 0, pro: 15_000, orders: 1 } },
  ]);

  const gens = await get("series", `metric=generations&from=${D08}&to=${D12}`, cookie);
  assert.deepEqual(days(gens.body), [
    { day: D08, values: { total: 0, completed: 0, failed: 0, revoked: 0 } },
    { day: D09, values: { total: 2, completed: 1, failed: 1, revoked: 0 } }, // G6, G7
    { day: D10, values: { total: 3, completed: 2, failed: 0, revoked: 1 } }, // G1, G10, G4
    { day: D11, values: { total: 3, completed: 1, failed: 1, revoked: 0 } }, // G2, G3, G5
    { day: D12, values: { total: 1, completed: 1, failed: 0, revoked: 0 } }, // G9
  ]);

  const signups = await get("series", `metric=signups&from=${D10}&to=${D12}`, cookie);
  assert.deepEqual(days(signups.body).map((p) => p.values.users), [1, 1, 1]);

  const ai = await get("series", `metric=ai_cost&from=${D10}&to=${D11}`, cookie);
  const aiPts = days(ai.body);
  assert.deepEqual(aiPts.map((p) => p.day), [D10, D11]);
  assert.ok(Math.abs(aiPts[0].values.usd - 0.55) < 1e-9, "G1 0.5 + free 0.05");
  assert.ok(Math.abs(aiPts[1].values.usd - 0.35) < 1e-9, "G2 0.25 + G3 0.1");
  assert.deepEqual(aiPts.map((p) => p.values.records), [2, 2]);

  const refunds = await get("series", `metric=refunds&from=${D10}&to=${D11}`, cookie);
  assert.deepEqual(days(refunds.body), [
    { day: D10, values: { count: 2, tanga: 700, points: 500 } }, // G7, G4
    { day: D11, values: { count: 3, tanga: 7_000, points: 500 } }, // G3, G2 partial, G8
  ]);

  // Sums agree with the overview of the same range.
  const ov = (await get("overview", `from=${D10}&to=${D11}`, cookie)).body.current as Record<string, Record<string, number>>;
  const sum = (pts: ReturnType<typeof days>, k: string) => pts.reduce((a, p) => a + p.values[k], 0);
  assert.equal(sum(days(rev.body), "total"), ov.revenueSoum.total);
  assert.equal(sum(days(refunds.body), "tanga"), ov.refunds.tanga);
});

test("series: 400 for a bad metric or range (never 500)", { skip }, async () => {
  await seed();
  const cookie = await session("viewer");
  for (const qs of ["", "metric=users", "metric=revenue%27%3B--", "metric=revenue&metric=refunds", "metric=revenue&from=2026-02-30", "metric=revenue&from=2024-01-01&to=2026-01-01"]) {
    const r = await get("series", qs, cookie);
    assert.equal(r.status, 400, `${qs}: ${JSON.stringify(r.body)}`);
    assert.equal(typeof r.body.error, "string");
  }
});

// ───────────────────────────── tools

test("tools: per-tool rows, cash sums to the overview KPI, deleted job attributed by its note", { skip }, async () => {
  await seed();
  metrics.clearMetricsCache();
  const cookie = await session("moderator");
  const r = await get("tools", `from=${D10}&to=${D11}`, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const items = r.body.items as Array<Record<string, unknown>>;
  assert.deepEqual(
    items.map((i) => ({ ...i, aiCostUsd: Number((i.aiCostUsd as number).toFixed(6)) })),
    [
      // G1, G2, G5, G10; cash 3000 + 2000 + 1000 − 1000 (G2 partial) − 700 (G7 refund) = 4300; avg (100 + 50 + 30) / 3
      { toolId: "slide", title: "Slayd", count: 4, completed: 3, failed: 0, failRate: 0, cashSpend: 4_300, aiCostUsd: 0.75, avgDurationSec: 60 },
      // G3: quota 5000 charged and refunded
      { toolId: "article", title: "Maqola", count: 1, completed: 0, failed: 1, failRate: 100, cashSpend: 0, aiCostUsd: 0.1, avgDurationSec: null },
      // G4: points only
      { toolId: "referat", title: "Referat", count: 1, completed: 0, failed: 0, failRate: null, cashSpend: 0, aiCostUsd: 0, avgDurationSec: null },
      { toolId: "free:outline", title: "Bepul AI: reja", count: 0, completed: 0, failed: 0, failRate: null, cashSpend: 0, aiCostUsd: 0.05, avgDurationSec: null },
      // G8 deleted: 4000 − 1000, tool from the charge note
      { toolId: "coursework", title: "Kurs ishi", count: 0, completed: 0, failed: 0, failRate: null, cashSpend: 3_000, aiCostUsd: 0, avgDurationSec: null },
    ],
  );
  const ov = (await get("overview", `from=${D10}&to=${D11}`, cookie)).body.current as Record<string, number>;
  assert.equal(items.reduce((a, i) => a + (i.cashSpend as number), 0), ov.cashSpendTanga);
  assert.ok(Math.abs(items.reduce((a, i) => a + (i.aiCostUsd as number), 0) - ov.aiCostUsd) < 1e-9);
  assert.equal(items.reduce((a, i) => a + (i.count as number), 0), (ov.generations as unknown as Record<string, number>).total);
});

// ───────────────────────────── live

test("live: queue now, oldest queued age, in-flight users, worker heartbeats; never cached", { skip }, async () => {
  await seed();
  await query(`DELETE FROM process_heartbeats`);
  await query(
    `INSERT INTO process_heartbeats (process_id, role, hostname, started_at, last_seen_at, concurrency)
     VALUES ('worker@a:1', 'worker', 'a', now() - interval '1 hour', now() - interval '10 seconds', 4),
            ('worker@b:2', 'worker', 'b', now() - interval '1 hour', now() - interval '5 minutes', 4),
            ('web@c:3', 'web', 'c', now() - interval '1 hour', now(), 0)`,
  );
  const cookie = await session("viewer");
  const r1 = await get("live", "", cookie);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const expectAge = (Date.now() - ms(tk(D11, "20:00:00"))) / 1000; // G5, the only QUEUED job
  assert.ok(Math.abs((r1.body.oldestQueuedSec as number) - expectAge) < 10, `${r1.body.oldestQueuedSec} vs ${expectAge}`);
  assert.deepEqual({ ...r1.body, oldestQueuedSec: 0 }, { queued: 1, running: 0, oldestQueuedSec: 0, inflightUsers: 1, workersAlive: 1, workersStale: 1 });

  // A new running job of another user shows up at once (no cache).
  const u = await mkUser(new Date().toISOString());
  const id = await gen({ user: u, tool: "slide", status: "IN_PROGRESS", createdAt: new Date().toISOString(), startedAt: new Date().toISOString() });
  const r2 = await get("live", "", cookie);
  assert.equal(r2.body.running, 1);
  assert.equal(r2.body.inflightUsers, 2);
  await query(`DELETE FROM generations WHERE id = $1`, [id]);
});

// ───────────────────────────── cache, transaction, guard

test("cache: overview/series/tools are cached 60 s per params, live is not", { skip }, async () => {
  await seed();
  metrics.clearMetricsCache();
  const cookie = await session("viewer");
  const qs = `from=${D10}&to=${D11}`;
  const a = await get("overview", qs, cookie);
  const extra = await mkUser(tk(D10, "12:00:00"));
  const b = await get("overview", qs, cookie);
  assert.equal((b.body.current as Record<string, number>).newUsers, (a.body.current as Record<string, number>).newUsers, "served from cache");
  const other = await get("overview", `from=${D10}&to=${D10}`, cookie);
  assert.equal((other.body.current as Record<string, number>).newUsers, 2, "different params → fresh: U1 + the new user");
  metrics.clearMetricsCache();
  const c = await get("overview", qs, cookie);
  assert.equal((c.body.current as Record<string, number>).newUsers, 3);
  await query(`DELETE FROM users WHERE id = $1`, [extra]);
  metrics.clearMetricsCache();
});

/**
 * P4 money review, finding 4: only the raw aggregates may live in the 60 s
 * cache; `soumPerUsd` and the derived `marginSoum` are applied per request, so
 * a changed FX setting shows at once. Mutation check: caching the computed
 * margin again → `soumPerUsd` and `marginSoum` of the second call are stale.
 */
test("overview: a changed finance.soum_per_usd shows in marginSoum at once while the aggregates stay cached", { skip }, async () => {
  await seed();
  metrics.clearMetricsCache();
  const cookie = await session("viewer");
  const qs = `from=${D10}&to=${D11}`;
  const kpis = (r: { body: Record<string, unknown> }, which: "current" | "previous") =>
    r.body[which] as { newUsers: number; aiCostUsd: number; revenueSoum: { total: number }; marginSoum: number };
  const a = await get("overview", qs, cookie);
  assert.equal(a.body.soumPerUsd, RATE);
  assert.equal(kpis(a, "current").marginSoum, kpis(a, "current").revenueSoum.total - Math.round(kpis(a, "current").aiCostUsd * RATE));

  const extra = await mkUser(tk(D10, "12:00:00")); // would change newUsers if the aggregates were recomputed
  const NEW_RATE = 20_000;
  await transaction((c) => setSettingInTx(c, "finance.soum_per_usd", NEW_RATE, null));
  invalidateSettingsCache();
  try {
    const b = await get("overview", qs, cookie);
    assert.equal(b.body.soumPerUsd, NEW_RATE, "MUTATSIYA: the rate must not come from the metrics cache");
    for (const which of ["current", "previous"] as const) {
      const was = kpis(a, which);
      const now = kpis(b, which);
      assert.equal(now.marginSoum, was.revenueSoum.total - Math.round(was.aiCostUsd * NEW_RATE), `${which} marginSoum at the new rate`);
      assert.equal(now.aiCostUsd, was.aiCostUsd);
      assert.equal(now.newUsers, was.newUsers, `${which} aggregates served from the cache`);
    }
  } finally {
    await transaction((c) => setSettingInTx(c, "finance.soum_per_usd", RATE, null));
    invalidateSettingsCache();
    await query(`DELETE FROM users WHERE id = $1`, [extra]);
    metrics.clearMetricsCache();
  }
});

test("read-only transaction with a 10 s statement timeout", { skip }, async () => {
  await seed();
  const out = await metrics.readOnlyMetricsTx(async (c) => (await c.query<{ t: string }>("SELECT current_setting('statement_timeout') AS t")).rows[0].t);
  assert.equal(out, "10s");
  await assert.rejects(
    metrics.readOnlyMetricsTx((c) => c.query(`INSERT INTO users (name) VALUES ('nope')`)),
    (e: { code?: string }) => e.code === "25006",
  );
});

test("guard: every role has dashboard.view; non-admin 404; no admin session 401", { skip }, async () => {
  await seed();
  for (const role of ["owner", "admin", "finance", "support", "moderator", "viewer"] as const) {
    const cookie = await session(role);
    for (const ep of ["overview", "tools", "live"] as const) {
      const r = await get(ep, ep === "live" ? "" : `from=${D10}&to=${D11}`, cookie);
      assert.equal(r.status, 200, `${role} ${ep}`);
    }
    assert.equal((await get("series", `metric=signups&from=${D10}&to=${D11}`, cookie)).status, 200, `${role} series`);
  }
  const plain = await session(null);
  for (const ep of ["overview", "series", "tools", "live"] as const) {
    assert.equal((await get(ep, "", plain)).status, 404, `non-admin ${ep}`);
    assert.equal((await get(ep, "", null)).status, 404, `anonymous ${ep}`);
  }
  // An admin whose admin cookie is missing: 401 admin_auth.
  const owner = await session("owner");
  const r = await get("overview", "", owner.split("; ")[0]);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "admin_auth");
});

test("overview/tools: 400 for bad ranges and injection attempts (never 500)", { skip }, async () => {
  await seed();
  const cookie = await session("viewer");
  for (const ep of ["overview", "tools"] as const) {
    for (const qs of ["from=2026-13-01", "from=2026-03-11&to=2026-03-10", "from=2025-03-10&to=2026-03-11", "to=x", "from=2026-03-10%27%20OR%201%3D1--", "from=2026-03-10&from=2026-03-11"]) {
      const r = await get(ep, qs, cookie);
      assert.equal(r.status, 400, `${ep} ${qs}: ${JSON.stringify(r.body)}`);
    }
  }
});
