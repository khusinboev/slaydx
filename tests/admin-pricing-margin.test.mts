import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import type { FormValues } from "../lib/types.ts";

/**
 * Margin economics of `/admin/pricing` on ONE hand-computed fixture with MIXED
 * pay data (owner decisions 2026-10-10): the PRIMARY margin / markup /
 * recommendation are on the completed jobs' LISTED price (minus refunds)
 * however it was paid; the CASH margin keeps the earlier formula; the bonus
 * cost is the AI spend of the jobs paid with points; the payment fee is
 * deducted from the revenue; admin accounts' jobs are left out unless asked.
 *
 * Fixture (essay, 12 000 so'm/USD, 1 tanga = 1 so'm, three Tashkent days):
 *   A  cash user    2 500  COMPLETED  cost 0.05
 *   B  points user  3 500  COMPLETED  cost 0.07  (paid 100 % with points)
 *   C  mixed user   3 000  COMPLETED  cost 0.03  (1 000 points + 2 000 money, half refunded: 500 points + 1 000 money)
 *   F  cash user    2 500  FAILED, fully refunded, failed spend 0.02
 *   X  ADMIN        2 000  COMPLETED  cost 0.40
 *   Y  ADMIN        2 000  FAILED, fully refunded, failed spend 0.10
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - admin filter removed (`jobFilter`/`spendFilter` always TRUE) → the admin-exclusion tests;
 *   - payment fee not subtracted (`marginPercent` ignores `feePercent`) → the fee tests;
 *   - points left out of the primary basis (revenue = cash only) → the primary margin and the points share.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-pricing-margin-test-token-never-called";
delete process.env.SOUM_PER_USD;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("pricingmargin") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { enqueueGeneration } = await import("../lib/server/jobs.ts");
const { refundInTx } = await import("../lib/server/refund-tx.ts");
const { refundPartial } = await import("../lib/server/credits.ts");
const { recordAiUsage, flushAiUsage } = await import("../lib/server/ai-usage.ts");
const settings = await import("../lib/server/settings.ts");
const ap = await import("../lib/server/admin-pricing.ts");
const cost = await import("../lib/server/admin-cost.ts");
const { aiCost } = await import("../lib/server/admin-ai.ts");
const { parseDateRange } = await import("../lib/server/admin-list.ts");
const { env } = await import("../lib/server/env.ts");
const { basePriceFor, TOOL_BY_ID } = await import("../lib/tools.ts");
const listRoute = await import("../app/api/admin/pricing/route.ts");
const toolRoute = await import("../app/api/admin/pricing/[toolId]/route.ts");
const simRoute = await import("../app/api/admin/pricing/[toolId]/simulate/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) {
  await ensureMigrated();
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 10, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });
}

// ───────────────────────────── pure

test("marginPercent: (revenue × (1 − fee) − cost) ÷ revenue, null without revenue or cost", () => {
  assert.equal(ap.marginPercent(2500, 680), 72.8);
  assert.equal(ap.marginPercent(2500, 680, 2.5), 70.3);
  // The fee is on the money only: 2.5 % on a 40 % points share is 1.5 % of the revenue.
  assert.equal(ap.feeShare(2.5, 0.4), 1.5);
  assert.equal(ap.feeShare(2.5, null), 2.5);
  assert.equal(ap.feeShare(2.5, 1), 0);
  assert.equal(ap.marginPercent(1000, 1000), 0);
  assert.equal(ap.marginPercent(1000, 1500), -50);
  assert.equal(ap.marginPercent(0, 100), null);
  assert.equal(ap.marginPercent(null, 100), null);
  assert.equal(ap.marginPercent(100, null), null);
  assert.equal(ap.marginPercent(-5, 1), null);
});

test("parsePricingParams: admins = absent/0 (left out) | 1 (included); anything else or repeated is 400", () => {
  const parse = (qs: string) => ap.parsePricingParams(new URL(`http://localhost/api/admin/pricing${qs}`));
  assert.equal(parse("").includeAdmins, false);
  assert.equal(parse("?admins=0").includeAdmins, false);
  assert.equal(parse("?admins=1").includeAdmins, true);
  for (const bad of ["?admins=2", "?admins=true", "?admins=yes", "?admins=1&admins=0", "?admins=%27%20OR%201%3D1"]) {
    assert.throws(() => parse(bad), (e: { status?: number }) => e.status === 400, bad);
  }
  assert.equal(ap.parseIncludeAdminsBody({}), false);
  assert.equal(ap.parseIncludeAdminsBody({ includeAdmins: true }), true);
  assert.equal(ap.parseIncludeAdminsBody({ includeAdmins: false }), false);
  for (const bad of ["true", 1, 0, null, {}]) {
    assert.throws(() => ap.parseIncludeAdminsBody({ includeAdmins: bad }), (e: { status?: number }) => e.status === 400, JSON.stringify(bad));
  }
});

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name: string, wallet: { points?: number; balance?: number } = {}): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, $3, $4, 0, $5) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `m_${randomBytes(5).toString("hex")}`, name, wallet.points ?? 0, wallet.balance ?? 0],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function mkAdmin(role: Role, name: string, wallet: { points?: number; balance?: number } = {}): Promise<TestAdmin> {
  const u = await mkUser(name, wallet);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  return { ...u, adminId: row!.id };
}

async function openSession(admin: TestAdmin): Promise<Session> {
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(admin.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "margin-test", reauth: true }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

type Result = { status: number; body: Record<string, unknown> };

async function readResult(res: Response): Promise<Result> {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, body: {} };
  }
}

function headersFor(cookie: string | null, origin: boolean): Record<string, string> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "margin-test", "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = "http://localhost:3000";
  return headers;
}

async function list(cookie: string | null, qs = ""): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/pricing${qs}`, { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => listRoute.GET(req, undefined)));
}

const ctx = (toolId: string) => ({ params: Promise.resolve({ toolId }) });

async function detail(cookie: string | null, toolId: string, qs = ""): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/pricing/${toolId}${qs}`, { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => toolRoute.GET(req, ctx(toolId))));
}

async function simulate(cookie: string | null, toolId: string, body: unknown): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/pricing/${toolId}/simulate`, { method: "POST", headers: headersFor(cookie, true), body: JSON.stringify(body) });
  return readResult(await inRequest(req, () => simRoute.POST(req, ctx(toolId))));
}

const FX = 12_000;

function tkDay(offset: number): string {
  const nowTk = new Date(Date.now() + 5 * 3_600_000);
  return new Date(Date.UTC(nowTk.getUTCFullYear(), nowTk.getUTCMonth(), nowTk.getUTCDate() + offset)).toISOString().slice(0, 10);
}
const tk = (day: string, time: string): string => new Date(`${day}T${time}+05:00`).toISOString();

const near = (a: number | null, b: number, msg: string, eps = 0.011) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

type Item = Record<string, unknown> & { toolId: string; trend: { day: string; avgCostSoum: number | null; jobs: number }[] };
const itemOf = (r: Result, toolId: string): Item => {
  const found = (r.body.items as Item[]).find((i) => i.toolId === toolId);
  assert.ok(found, `${toolId} ro'yxatda yo'q`);
  return found;
};

async function seedJob(o: {
  user: TestUser;
  /** Essay pages, unless `toolId` + `values` are given. */
  pages?: string;
  toolId?: "essay" | "slide" | "image";
  values?: FormValues;
  at: string;
  status?: "COMPLETED" | "FAILED";
  /** Omitted = a job with NO cost data. */
  usage?: { outcome: "completed" | "failed"; usd: number };
  refund?: "full" | number;
}): Promise<{ id: string; price: number }> {
  const toolId = o.toolId ?? "essay";
  const tool = TOOL_BY_ID[toolId];
  const values: FormValues = o.values ?? { essayContext: "school_dtm", pages: o.pages ?? "2" };
  const price = basePriceFor(tool, values);
  const res = await enqueueGeneration({ userId: o.user.id, toolId, topic: "fixture", price, format: tool.output, values, budgetMs: 1000 });
  assert.ok(res.ok, `seed: ${JSON.stringify(res)}`);
  const finished = new Date(new Date(o.at).getTime() + 300_000).toISOString();
  await query(`UPDATE generations SET created_at = $2, status = $3, finished_at = $4 WHERE id = $1`, [res.id, o.at, o.status ?? "COMPLETED", finished]);
  await query(`UPDATE transactions SET created_at = $2 WHERE reference = $1`, [res.id, o.at]);
  if (o.usage) {
    await recordAiUsage({
      source: "job",
      outcome: o.usage.outcome,
      generationId: res.id,
      userId: o.user.id,
      toolId,
      cost: { provider: "test", model: "fixture", inputTokens: 10, outputTokens: 5, calls: 1, usd: o.usage.usd },
    });
    await flushAiUsage();
    await query(`UPDATE ai_usage SET at = $2 WHERE generation_id = $1`, [res.id, finished]);
  }
  if (o.refund === "full") {
    assert.ok(await transaction((client) => refundInTx(client, o.user.id, res.id, "fixture refund")), "to'liq qaytarish yozilishi kerak edi");
  } else if (typeof o.refund === "number") {
    assert.ok(await refundPartial(o.user.id, res.id, o.refund, "fixture partial refund"), "qisman qaytarish yozilishi kerak edi");
  }
  if (o.refund !== undefined) await query(`UPDATE transactions SET created_at = $2 WHERE reference = $1 AND kind = 'refund'`, [res.id, finished]);
  return { id: res.id, price };
}

const D = tkDay(-5);
const D2 = tkDay(-3);
const RANGE = `?from=${D}&to=${D2}`;
const RANGE_ADMINS = `${RANGE}&admins=1`;

async function setFee(percent: number | null): Promise<void> {
  if (percent === null) await query(`DELETE FROM app_settings WHERE key = 'pricing.payment_fee_percent'`);
  else {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ('pricing.payment_fee_percent', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(percent)],
    );
  }
  settings.invalidateSettingsCache();
}

test("two margins, bonus cost, fee and admin exclusion against a hand-computed mixed-pay fixture", { skip }, async (t) => {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('finance.soum_per_usd', $1::jsonb), ('pricing.target_markup', '3'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(FX)],
  );
  await setFee(2.5);

  const cashUser = await mkUser("Cash", { balance: 1_000_000 });
  const pointsUser = await mkUser("Points", { points: 1_000_000 });
  const mixedUser = await mkUser("Mixed", { points: 1000, balance: 1_000_000 });
  const adminA = await mkAdmin("owner", "Admin Owner", { balance: 1_000_000 });

  const a = await seedJob({ user: cashUser, pages: "2", at: tk(D, "10:00:00"), usage: { outcome: "completed", usd: 0.05 } });
  const b = await seedJob({ user: pointsUser, pages: "4", at: tk(D, "11:00:00"), usage: { outcome: "completed", usd: 0.07 } });
  // C: 3 000 = 1 000 points (the wallet's points go first) + 2 000 money; half refunded → 500 points + 1 000 money back.
  const c = await seedJob({ user: mixedUser, pages: "3", at: tk(D, "12:00:00"), usage: { outcome: "completed", usd: 0.03 }, refund: 0.5 });
  const f = await seedJob({ user: cashUser, pages: "2", at: tk(D, "13:00:00"), status: "FAILED", usage: { outcome: "failed", usd: 0.02 }, refund: "full" });
  const x = await seedJob({ user: adminA, pages: "1", at: tk(D, "14:00:00"), usage: { outcome: "completed", usd: 0.4 } });
  const y = await seedJob({ user: adminA, pages: "1", at: tk(D, "15:00:00"), status: "FAILED", usage: { outcome: "failed", usd: 0.1 }, refund: "full" });
  assert.deepEqual([a.price, b.price, c.price, f.price, x.price, y.price], [2500, 3500, 3000, 2500, 2000, 2000]);
  const charge = await queryOne<{ points_delta: string; balance_delta: string }>(`SELECT points_delta, balance_delta FROM transactions WHERE kind = 'charge' AND reference = $1`, [c.id]);
  assert.deepEqual([charge!.points_delta, charge!.balance_delta], ["-1000", "-2000"], "C: aralash to'lov");
  const refund = await queryOne<{ points_delta: string; balance_delta: string }>(`SELECT points_delta, balance_delta FROM transactions WHERE kind = 'refund' AND reference = $1`, [c.id]);
  assert.deepEqual([refund!.points_delta, refund!.balance_delta], ["500", "1000"], "C: yarmi qaytdi");
  ap.clearPricingCache();

  const owner = await openSession(await mkAdmin("owner", "Dilnoza Owner"));

  await t.test("default view (admins left out): the PRIMARY margin is on the completed jobs' listed price, however paid", async () => {
    const r = await list(owner.cookie, RANGE);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.includeAdmins, false);
    assert.equal(r.body.paymentFeePercent, 2.5);
    assert.equal(r.body.adminJobs, 1, "bitta admin ishi chiqarilgan");
    const e = itemOf(r, "essay");
    // A + B + C (net of C's half refund) = 2 500 + 3 500 + 1 500 = 7 500 ÷ 3 completed.
    assert.equal(e.completed, 3);
    assert.equal(e.avgRevenue, 2500);
    assert.equal(e.avgRevenueSoum, 2500);
    // completed spend 0.15 ÷ 3 = 0.05 USD = 600 so'm; overhead 0.02 ÷ 3 = 80 so'm; full cost 680.
    assert.equal(e.avgCostSoum, 600);
    assert.equal(e.overheadSoum, 80);
    assert.equal(e.fullCostSoum, 680);
    // The 2.5 % fee is on the CASH share only: points paid 4 000 of 7 500 (53.33 %), so the fee is 2.5 % × 46.67 % = 1.1667 % of the revenue.
    // margin (2 500 × (1 − 0.011667) − 680) ÷ 2 500 = 71.63 %.
    assert.equal(e.marginPct, 71.63);
    // markup on the revenue left after the fee: 2 470.83 ÷ 680 = 3.634; 100 × 3 ÷ 3.6336 = 82.6 → 85 (the target holds net of the fee).
    assert.equal(e.markup, 3.634);
    assert.equal(e.recommendedPercent, 85);
    assert.equal(e.confidence, "low");
    assert.equal(e.sampleSize, 3);
  });

  await t.test("default view: the CASH margin keeps the earlier formula (money only, every job created in range)", async () => {
    const e = itemOf(await list(owner.cookie, RANGE), "essay");
    // jobs created in range, admins out: A, B, C, F = 4. Cash kept: A 2 500 + B 0 + C (2 000 − 1 000) + F (2 500 − 2 500) = 3 500.
    assert.equal(e.jobs, 4);
    assert.equal(e.avgCashRevenue, 875);
    // (875 − 680) ÷ 875 = 22.29 %.
    assert.equal(e.cashMarginPct, 22.29);
    assert.notEqual(e.cashMarginPct, e.marginPct);
  });

  await t.test("default view: bonus cost and points share", async () => {
    const r = await list(owner.cookie, RANGE);
    const e = itemOf(r, "essay");
    // Points really spent on the completed jobs: B 3 500 + C 500 (after the refund) = 4 000 of the 7 500 paid → 53.33 %.
    assert.equal(e.pointsSharePct, 53.33);
    // Bonus cost = the tool's spend (0.15 completed + 0.02 failed = 0.17 USD = 2 040 so'm) × 4 000 ÷ 7 500 = 1 088.
    assert.equal(e.bonusCostSoum, 1088);
    // The tool with no jobs has neither.
    const none = itemOf(r, "resume");
    assert.equal(none.pointsSharePct, null);
    assert.equal(none.bonusCostSoum, null);
    assert.equal(none.marginPct, null);
    assert.equal(none.cashMarginPct, null);
  });

  await t.test("default view: totals — primary, cash, fee, bonus; admin spend is not in the all-in figure", async () => {
    const totals = (await list(owner.cookie, RANGE)).body.totals as Record<string, number | null>;
    assert.equal(totals.revenue, 7500);
    assert.equal(totals.revenueSoum, 7500);
    assert.equal(totals.feeSoum, 87.5, "7 500 × 2.5 % × the cash share 46.67 %");
    near(totals.costUsdTools, 0.17, "costUsdTools", 1e-6);
    near(totals.costSoumTools, 2040, "costSoumTools");
    // (7 500 − 87.5 − 2 040) ÷ 7 500 = 71.63 %; cash (3 500 − 2 040) ÷ 3 500 = 41.71 %.
    assert.equal(totals.marginPct, 71.63);
    assert.equal(totals.cashRevenue, 3500);
    assert.equal(totals.cashMarginPct, 41.71);
    assert.equal(totals.bonusCostSoum, 1088);
    assert.equal(totals.pointsSharePct, 53.33);
    near(totals.costUsdAll, 0.17, "the admin accounts' 0.50 USD is not in the pricing page's all-in spend", 1e-6);
    assert.equal(totals.jobs, 4);
    assert.equal(totals.completed, 3);
  });

  await t.test("«Adminlar bilan» (admins=1): the admin jobs join every figure; the AI cost page is NOT filtered", async () => {
    const r = await list(owner.cookie, RANGE_ADMINS);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.includeAdmins, true);
    assert.equal(r.body.adminJobs, 1, "adminJobs does not depend on the toggle");
    const e = itemOf(r, "essay");
    // + X (2 000, completed): 9 500 ÷ 4. Spend 0.55 ÷ 4 = 0.1375 USD = 1 650; overhead (0.02 + 0.10) ÷ 4 = 0.03 = 360; full 2 010.
    assert.equal(e.completed, 4);
    assert.equal(e.avgRevenue, 2375);
    assert.equal(e.fullCostSoum, 2010);
    // Points paid 4 000 of the 9 500 (42.1 %): fee 2.5 % × 57.9 % = 1.4474 %; (2 375 × (1 − 0.014474) − 2 010) ÷ 2 375 = 13.92 %.
    assert.equal(e.marginPct, 13.92);
    assert.equal(e.markup, 1.164);
    // Cash: + X 2 000 + Y (2 000 − 2 000) over 6 jobs created: 5 500 ÷ 6 = 916.67 → (916.67 − 2 010) ÷ 916.67 = −119.27 %.
    assert.equal(e.jobs, 6);
    assert.equal(e.avgCashRevenue, 916.67);
    assert.equal(e.cashMarginPct, -119.27);
    const totals = r.body.totals as Record<string, number | null>;
    near(totals.costUsdAll, 0.67, "with admins the all-in spend is every spend row", 1e-6);
    const range = parseDateRange(D, D2);
    near(totals.costUsdAll, (await cost.spendTotals(pool(), range)).usd, "= spendTotals (dashboard)", 1e-6);
    // The AI cost page never filters: it shows every spend row whatever the pricing toggle says.
    near((await aiCost(range, "tool")).totals.usd, 0.67, "AI page = all rows", 1e-6);
    // Bad value → 400, nothing silently ignored.
    assert.equal((await list(owner.cookie, `${RANGE}&admins=2`)).status, 400);
    assert.equal((await list(owner.cookie, `${RANGE}&admins=1&admins=0`)).status, 400);
  });

  await t.test("the drawer's trend follows the toggle", async () => {
    const day = (await detail(owner.cookie, "essay", "?days=7")).body.trend as { day: string; avgCostSoum: number | null; jobs: number }[];
    assert.ok(Array.isArray(day));
    // Default: (0.15 ÷ 3 + 0.02 ÷ 3) × 12 000 = 680 over the three completed jobs of day D.
    assert.deepEqual(day.find((p) => p.day === D), { day: D, avgCostSoum: 680, jobs: 3 });
    const withAdmins = (await detail(owner.cookie, "essay", "?days=7&admins=1")).body.trend as typeof day;
    // With admins: (0.55 ÷ 4 + 0.12 ÷ 4) × 12 000 = 2 010 over four.
    assert.deepEqual(withAdmins.find((p) => p.day === D), { day: D, avgCostSoum: 2010, jobs: 4 });
    assert.equal((await detail(owner.cookie, "essay", "?admins=x")).status, 400);
  });

  await t.test("the payment fee setting moves the margin at once (fee 0 / 2.5 / 10), never the markup or the cash margin", async () => {
    await setFee(null); // back to the default: 0
    const e0 = itemOf(await list(owner.cookie, RANGE), "essay");
    assert.equal(e0.marginPct, 72.8, "komissiyasiz (2 500 − 680) ÷ 2 500");
    await setFee(10);
    const o10 = await list(owner.cookie, RANGE);
    const e10 = itemOf(o10, "essay");
    // 10 % on the cash share 46.67 % = 4.667 % of the revenue: (2 500 × 0.95333 − 680) ÷ 2 500 = 68.13 %.
    assert.equal(e10.marginPct, 68.13);
    // The markup is on the revenue after the fee, so it falls with the fee (2 383.33 ÷ 680) and the recommendation rises: 100 × 3 ÷ 3.505 = 85.6 → 85.
    assert.equal(e0.markup, 3.676);
    assert.equal(e10.markup, 3.505);
    assert.ok((e10.recommendedPercent as number) >= (e0.recommendedPercent as number));
    assert.equal(e10.cashMarginPct, e0.cashMarginPct);
    assert.equal((o10.body.totals as Record<string, number>).feeSoum, 350);
    await setFee(2.5);
    assert.equal(itemOf(await list(owner.cookie, RANGE), "essay").marginPct, 71.63);
  });

  await t.test("simulator uses the same revenue (completed, net of refunds, fee) and the same toggle", async () => {
    const r = await simulate(owner.cookie, "essay", { percent: 120, roundTo: 500 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.includeAdmins, false);
    assert.equal(r.body.paymentFeePercent, 2.5);
    const current = r.body.current as Record<string, number | null>;
    const projected = r.body.projected as Record<string, number | null>;
    // Current = the table's revenue: 7 500 over 3 completed jobs; cost 0.17 USD × 12 000 = 2 040.
    assert.equal(current.jobs, 3);
    assert.equal(current.revenue30d, 7500);
    assert.equal(current.feeSoum, 87.5, "fee on the cash share (46.67 %) of the window");
    assert.equal(current.cost30d, 2040);
    // (7 500 − 87.5 − 2 040) ÷ 7 500 = 71.63 % — the SAME number as the table's total.
    assert.equal(current.marginPct, 71.63);
    // 120 %: A 2 500 → 3 000, B 3 500 → 4 000, C 3 000 → 3 500 × (1 500 ÷ 3 000 kept) = 1 750 → 8 750.
    assert.equal(projected.revenue30d, 8750);
    assert.equal(projected.feeSoum, 102.08);
    assert.equal(projected.cost30d, 2040);
    // (8 750 − 102.08 − 2 040) ÷ 8 750 = 75.52 %.
    assert.equal(projected.marginPct, 75.52);

    const withAdmins = await simulate(owner.cookie, "essay", { percent: 120, roundTo: 500, includeAdmins: true });
    assert.equal(withAdmins.status, 200, JSON.stringify(withAdmins.body));
    assert.equal(withAdmins.body.includeAdmins, true);
    const wc = withAdmins.body.current as Record<string, number | null>;
    // + X: 9 500 over 4; cost 0.67 USD = 8 040 (X's 0.40 and Y's 0.10 spend join in).
    assert.equal(wc.jobs, 4);
    assert.equal(wc.revenue30d, 9500);
    assert.equal(wc.cost30d, 8040);
    assert.equal((withAdmins.body.projected as Record<string, number>).revenue30d, 8750 + 2500);
    assert.equal((await simulate(owner.cookie, "essay", { percent: 120, roundTo: 500, includeAdmins: "yes" })).status, 400);

    // And with no fee the simulator's margin is the plain one.
    await setFee(0);
    const plain = (await simulate(owner.cookie, "essay", { percent: 100, roundTo: 500 })).body.current as Record<string, number | null>;
    assert.equal(plain.feeSoum, 0);
    assert.equal(plain.marginPct, 72.8);
    await setFee(2.5);
  });

  await t.test("RBAC: a viewer reads the new figures and the toggle; support is still 403", async () => {
    const viewer = await openSession(await mkAdmin("viewer", "Viewer"));
    const r = await list(viewer.cookie, RANGE_ADMINS);
    assert.equal(r.status, 200);
    assert.equal(itemOf(r, "essay").completed, 4);
    const support = await openSession(await mkAdmin("support", "Support"));
    assert.equal((await list(support.cookie, RANGE_ADMINS)).status, 403);
  });
});

test("headline margin: unit cost × completed jobs (not the raw spend); tools with no cost data are flagged, not free", { skip }, async () => {
  const user = await mkUser("Coverage", { balance: 10_000_000 });
  const day = tkDay(-20);
  const range = `?from=${day}&to=${tkDay(-18)}`;
  await setFee(null);
  const slide = { slideCount: 10 };
  // 10 completed slide jobs at 3 000: seven measured at 0.10 USD, THREE with no cost data; one failed job (0.05 USD overhead).
  for (let i = 0; i < 10; i++) {
    const at = tk(day, `${String(8 + i).padStart(2, "0")}:00:00`);
    await seedJob({ user, toolId: "slide", values: slide, at, ...(i < 7 ? { usage: { outcome: "completed" as const, usd: 0.1 } } : {}) });
  }
  await seedJob({ user, toolId: "slide", values: slide, at: tk(day, "20:00:00"), status: "FAILED", usage: { outcome: "failed", usd: 0.05 }, refund: "full" });
  // Two completed image jobs with NO cost data at all: revenue 2 × 2 000 that cannot be margin.
  for (let i = 0; i < 2; i++) await seedJob({ user, toolId: "image", values: { prompt: "a cat" }, at: tk(day, `0${i + 1}:00:00`) });
  ap.clearPricingCache();
  const owner = await openSession(await mkAdmin("owner", "Coverage Owner"));

  const r = await list(owner.cookie, range);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = itemOf(r, "slide");
  // unit cost: 0.10 + 0.05 ÷ 10 = 0.105 USD = 1 260 so'm; margin (3 000 − 1 260) ÷ 3 000 = 58 %.
  assert.equal(s.completed, 10);
  assert.equal(s.fullCostSoum, 1260);
  assert.equal(s.marginPct, 58);
  const totals = r.body.totals as Record<string, unknown> & { uncoveredTools: string[] };
  // The headline cost is 1 260 × 10 = 12 600 (NOT the raw spend 0.75 USD = 9 000, which would read 70 %).
  assert.equal(totals.marginCostSoum, 12600);
  assert.equal(totals.marginRevenueSoum, 30000);
  assert.equal(totals.marginPct, 58);
  near(totals.costSoumTools as number, 9000, "the measured spend is still reported as it is");
  // The image jobs have no cost data: out of the margin, named, with their revenue.
  assert.deepEqual(totals.uncoveredTools, ["Rasm"]);
  assert.equal(totals.uncoveredRevenueSoum, 4000);
  assert.equal(totals.revenueSoum, 34000, "the revenue total still shows every completed job");
  assert.equal(itemOf(r, "image").marginPct, null);

  // The simulator's cost is the same unit cost × the window's jobs, so its «current» margin is the row's.
  const sim = await simulate(owner.cookie, "slide", { percent: 100, roundTo: 500 });
  assert.equal(sim.status, 200, JSON.stringify(sim.body));
  const cur = sim.body.current as Record<string, number | null>;
  assert.equal(cur.jobs, 10);
  assert.equal(cur.revenue30d, 30000);
  assert.equal(cur.cost30d, 12600, "unit cost × jobs, not the raw spend 9 000");
  assert.equal(cur.marginPct, 58, "the same number as the table row");
  // No cost data at all (image): no cost, no margin — never a free tool.
  const none = (await simulate(owner.cookie, "image", { percent: 100, roundTo: 500 })).body.current as Record<string, number | null>;
  assert.equal(none.cost30d, null);
  assert.equal(none.marginPct, null);
});
