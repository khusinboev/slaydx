import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import type { CostJson } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * Pricing and unit economics (docs/admin/02-plan.md §17) through the REAL
 * routes on a throwaway Postgres.
 *
 * Pure: the unit map covers every tool; every ladder step's `base` equals
 * `basePriceFor` (= `priceFor` on the server) for its inputs; recommendation,
 * body and `days` parsing.
 *
 * Metrics against a HAND-COMPUTED fixture (seeded through `enqueueGeneration`
 * → real charge rows, `refundInTx`, `recordAiUsage`): every §17.4 definition
 * for two tools (essay, slide) plus units for translation/image, a tool with
 * no data, the Tashkent day trend, caching and the two time bases.
 *
 * Mutations: PUT upserts + history + ONE `pricing.update` audit row in one
 * transaction (a failing insert rolls everything back), 100 % PUT removes the
 * row, unchanged → 409 `state`; DELETE resets with `pricing.reset`, already at
 * 100 % → 409; unknown tool 404; bad bodies 400; roles (finance/viewer read
 * only, support/moderator 403 + denied audit, stale step-up 401 reauth, no
 * Origin 403, non-admin 404).
 *
 * End to end: after PUT the REAL `POST /api/generations` charges the adjusted
 * price (ledger row = effective price) and answers 409 `price_changed` to the
 * old `expectedPrice`; after DELETE every ladder and the charge are
 * byte-identical to `priceFor`.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - revenue sign flipped (`+` instead of `-`) → essay avgCashRevenue;
 *   - points_delta added to the cash sum → essay avgCashRevenue (points job);
 *   - overhead divided by failed instead of completed → essay overheadUsd;
 *   - pages midpoint → lower bound → essay avgUnits/costPerUnit;
 *   - markup from cash revenue instead of avgPrice → essay markup;
 *   - `applyPriceAdjust` roundTo ignored in the simulator → projected revenue;
 *   - `invalidatePricingCache()` dropped after PUT → the e2e charge keeps the base price;
 *   - history insert moved outside `adminTx` → the rollback test finds a stray history row;
 *   - audit `before` built from the new values → before/after assertions.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-pricing-test-token-never-called";
delete process.env.SOUM_PER_USD;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminpricing") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { enqueueGeneration } = await import("../lib/server/jobs.ts");
const { refundInTx } = await import("../lib/server/refund-tx.ts");
const { recordAiUsage, flushAiUsage } = await import("../lib/server/ai-usage.ts");
const settings = await import("../lib/server/settings.ts");
const pricingServer = await import("../lib/server/pricing.ts");
const ap = await import("../lib/server/admin-pricing.ts");
const { env } = await import("../lib/server/env.ts");
const { applyPriceAdjust, basePriceFor, priceFor, TOOL_BY_ID, TOOLS } = await import("../lib/tools.ts");
const listRoute = await import("../app/api/admin/pricing/route.ts");
const toolRoute = await import("../app/api/admin/pricing/[toolId]/route.ts");
const simRoute = await import("../app/api/admin/pricing/[toolId]/simulate/route.ts");
const generationsRoute = await import("../app/api/generations/route.ts");

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

test("UNIT_OF names every registry tool and the labels are Uzbek", () => {
  for (const t of TOOLS) assert.ok(ap.UNIT_OF[t.id], `${t.id} birligi yo'q`);
  assert.equal(ap.UNIT_OF.slide, "slide");
  assert.equal(ap.UNIT_OF["pro-slide"], "slide");
  for (const id of ["coursework", "referat", "mustaqil-ish", "essay", "article", "thesis"] as const) assert.equal(ap.UNIT_OF[id], "page", id);
  assert.equal(ap.UNIT_OF.translation, "kchars");
  assert.equal(ap.UNIT_OF.image, "image");
  assert.equal(ap.UNIT_OF.glossary, "term");
  assert.equal(ap.UNIT_OF.resume, "job");
  assert.equal(ap.UNIT_LABELS.kchars, "1 000 belgi");
});

test("every tool has a ladder whose base is exactly basePriceFor/priceFor of its inputs", () => {
  for (const tool of TOOLS) {
    const inputs = ap.ladderInputs(tool.id);
    const ladder = ap.ladderFor(tool.id);
    assert.ok(inputs.length >= 1, `${tool.id}: pog'ona yo'q`);
    assert.equal(ladder.length, inputs.length);
    inputs.forEach((s, i) => {
      assert.ok(s.label.trim().length > 0);
      assert.equal(ladder[i].label, s.label);
      assert.equal(ladder[i].base, basePriceFor(tool, s.values), `${tool.id} ${s.label}`);
      assert.equal(ladder[i].base, priceFor(tool, s.values), `${tool.id} ${s.label} (priceFor serverda = base)`);
    });
  }
  // Tier tables, not constants: the ladders follow the registry.
  assert.deepEqual(ap.ladderFor("slide").map((s) => s.base), [3000, 3000, 3000, 8000]);
  assert.deepEqual(ap.ladderFor("pro-slide").map((s) => s.base), [8000, 24000, 60000]);
  assert.deepEqual(ap.ladderFor("image").map((s) => s.base), [2000, 3500, 6000]);
  assert.deepEqual(ap.ladderFor("article").map((s) => s.base), [4000, 6000, 8000, 12000]);
  assert.deepEqual(ap.ladderFor("thesis").map((s) => s.base), [4000, 5000]);
  assert.deepEqual(ap.ladderFor("translation").map((s) => s.base), [3000, 5000, 11000]);
  assert.deepEqual(ap.ladderFor("glossary").map((s) => s.base), [6000, 9000, 15000]);
  assert.deepEqual(ap.ladderFor("essay").map((s) => s.base), [2000, 2500, 3000, 3500, 4000]);
  assert.deepEqual(ap.ladderFor("resume"), [{ label: "Standart", base: 3000 }]);
  // Effective ladder = applyPriceAdjust of each base; 100 % leaves it untouched.
  const eff = ap.effectiveLadder(ap.ladderFor("slide"), { percent: 120, roundTo: 500 });
  assert.deepEqual(
    eff.map((s) => s.effective),
    [3000, 3000, 3000, 8000].map((b) => applyPriceAdjust(b, { percent: 120, roundTo: 500 })),
  );
  assert.deepEqual(ap.effectiveLadder(ap.ladderFor("slide"), null).map((s) => s.effective), [3000, 3000, 3000, 8000]);
});

test("recommendedPercent: toward the target markup, 5 % steps, clamped, null without a markup", () => {
  assert.equal(ap.recommendedPercent(100, 3.375, 3), 90);
  assert.equal(ap.recommendedPercent(100, 2.2917, 3), 130);
  assert.equal(ap.recommendedPercent(120, 3, 3), 120);
  assert.equal(ap.recommendedPercent(100, 0.1, 3), 1000);
  assert.equal(ap.recommendedPercent(100, 100, 3), 25);
  assert.equal(ap.recommendedPercent(100, null, 3), null);
  assert.equal(ap.recommendedPercent(100, 0, 3), null);
});

test("parseAdjustBody / parseTrendDays", () => {
  assert.deepEqual(ap.parseAdjustBody({ percent: 120, roundTo: 500 }), { percent: 120, roundTo: 500 });
  for (const bad of [{ percent: 24, roundTo: 500 }, { percent: 1001, roundTo: 500 }, { percent: 120.5, roundTo: 500 }, { percent: "120", roundTo: 500 }, { percent: 120, roundTo: 200 }, { percent: 120 }, {}]) {
    assert.throws(() => ap.parseAdjustBody(bad), (e: { status?: number }) => e.status === 400, JSON.stringify(bad));
  }
  assert.equal(ap.parseTrendDays(null), 90);
  assert.equal(ap.parseTrendDays(""), 90);
  assert.equal(ap.parseTrendDays("30"), 30);
  for (const bad of ["0", "91", "abc", "-5", "1.5"]) assert.throws(() => ap.parseTrendDays(bad), (e: { status?: number }) => e.status === 400, bad);
});

// ───────────────────────────── fixtures (admin-settings.test.mts pattern)

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Pricing Test", wallet: { points?: number; quota?: number; balance?: number } = {}): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `p_${randomBytes(5).toString("hex")}`, name, wallet.points ?? 0, wallet.quota ?? 0, wallet.balance ?? 0],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function mkAdmin(role: Role, name?: string): Promise<TestAdmin> {
  const u = await mkUser(name ?? `Admin ${role}`);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  return { ...u, adminId: row!.id };
}

async function openSession(admin: TestAdmin, reauth = true): Promise<Session> {
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(admin.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "pricing-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

const session = async (role: Role, reauth = true, name?: string) => openSession(await mkAdmin(role, name), reauth);

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
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "pricing-test", "content-type": "application/json" };
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
  const req = new Request(`http://localhost:3000/api/admin/pricing/${encodeURIComponent(toolId)}${qs}`, { method: "GET", headers: headersFor(cookie, false) });
  return readResult(await inRequest(req, () => toolRoute.GET(req, ctx(toolId))));
}

async function simulate(cookie: string | null, toolId: string, body: unknown, opts: { origin?: boolean } = {}): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/pricing/${encodeURIComponent(toolId)}/simulate`, {
    method: "POST",
    headers: headersFor(cookie, opts.origin !== false),
    body: JSON.stringify(body),
  });
  return readResult(await inRequest(req, () => simRoute.POST(req, ctx(toolId))));
}

async function put(cookie: string | null, toolId: string, body: unknown, opts: { origin?: boolean; raw?: string } = {}): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/pricing/${encodeURIComponent(toolId)}`, {
    method: "PUT",
    headers: headersFor(cookie, opts.origin !== false),
    body: opts.raw ?? JSON.stringify(body),
  });
  return readResult(await inRequest(req, () => toolRoute.PUT(req, ctx(toolId))));
}

async function del(cookie: string | null, toolId: string, body: unknown, opts: { origin?: boolean } = {}): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/admin/pricing/${encodeURIComponent(toolId)}`, {
    method: "DELETE",
    headers: headersFor(cookie, opts.origin !== false),
    body: JSON.stringify(body),
  });
  return readResult(await inRequest(req, () => toolRoute.DELETE(req, ctx(toolId))));
}

const audits = (adminId: string, action?: string) =>
  query<{ action: string; outcome: string; target_type: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown; meta: unknown }>(
    `SELECT action, outcome, target_type, target_id, reason, before, after, meta FROM admin_audit_log
      WHERE admin_id = $1 AND ($2::text IS NULL OR action = $2) ORDER BY id`,
    [adminId, action ?? null],
  );
const pricingRows = () => query<{ tool_id: string; percent: number; round_to: number; updated_by: string | null }>(`SELECT tool_id, percent, round_to, updated_by::text AS updated_by FROM tool_pricing ORDER BY tool_id`);
const historyRows = (toolId: string) =>
  query<{ old_percent: number; new_percent: number; old_round_to: number; new_round_to: number; reason: string; admin_id: string | null }>(
    `SELECT old_percent, new_percent, old_round_to, new_round_to, reason, admin_id::text AS admin_id FROM tool_price_history WHERE tool_id = $1 ORDER BY id`,
    [toolId],
  );

const REASON = "Tannarx oshgani uchun narx tuzatildi";
const FX = 12_000;

/** Tashkent calendar day `offset` days from today, as `YYYY-MM-DD`. */
function tkDay(offset: number): string {
  const nowTk = new Date(Date.now() + 5 * 3_600_000);
  const d = new Date(Date.UTC(nowTk.getUTCFullYear(), nowTk.getUTCMonth(), nowTk.getUTCDate() + offset));
  return d.toISOString().slice(0, 10);
}
/** A Tashkent wall-clock instant (UTC+5, no DST). */
const tk = (day: string, time: string): string => new Date(`${day}T${time}+05:00`).toISOString();

const near = (a: number | null, b: number, msg: string, eps = 0.011) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

type Item = Record<string, unknown> & { toolId: string; ladder: { label: string; base: number; effective: number }[]; adjust: { percent: number; roundTo: number }; trend: { day: string; avgCostSoum: number | null; jobs: number }[] };
const itemOf = (r: Result, toolId: string): Item => {
  const found = (r.body.items as Item[]).find((i) => i.toolId === toolId);
  assert.ok(found, `${toolId} ro'yxatda yo'q`);
  return found;
};

/** One seeded job: charged through `enqueueGeneration` (real ledger rows), then dated and finished by hand. */
async function seedJob(o: {
  user: TestUser;
  toolId: "essay" | "slide" | "translation" | "image" | "glossary";
  values: FormValues;
  createdAt: string;
  status?: "COMPLETED" | "FAILED" | "QUEUED";
  finishedAt?: string;
  costJson?: CostJson | null;
  usage?: { outcome: "completed" | "failed" | "abandoned"; usd: number; at?: string };
  refund?: boolean;
}): Promise<{ id: string; price: number }> {
  const tool = TOOL_BY_ID[o.toolId];
  const price = basePriceFor(tool, o.values);
  const res = await enqueueGeneration({ userId: o.user.id, toolId: o.toolId, topic: "fixture", price, format: tool.output, values: o.values, budgetMs: 1000 });
  assert.ok(res.ok, `seed ${o.toolId}: ${JSON.stringify(res)}`);
  const status = o.status ?? "COMPLETED";
  await query(
    `UPDATE generations SET created_at = $2, status = $3, finished_at = $4, cost_json = $5::jsonb WHERE id = $1`,
    [res.id, o.createdAt, status, o.finishedAt ?? null, o.costJson ? JSON.stringify(o.costJson) : null],
  );
  await query(`UPDATE transactions SET created_at = $2 WHERE reference = $1`, [res.id, o.createdAt]);
  if (o.usage) {
    const cost: CostJson = { provider: "test", model: "fixture", inputTokens: 10, outputTokens: 5, calls: 1, usd: o.usage.usd };
    await recordAiUsage({ source: "job", outcome: o.usage.outcome, generationId: res.id, userId: o.user.id, toolId: o.toolId, cost });
    await flushAiUsage();
    await query(`UPDATE ai_usage SET at = $2 WHERE generation_id = $1 AND outcome = $3`, [res.id, o.usage.at ?? o.finishedAt ?? o.createdAt, o.usage.outcome]);
  }
  if (o.refund) {
    const ok = await transaction((client) => refundInTx(client, o.user.id, res.id, "fixture refund"));
    assert.ok(ok, "refund yozilishi kerak edi");
    await query(`UPDATE transactions SET created_at = $2 WHERE reference = $1 AND kind = 'refund'`, [res.id, o.finishedAt ?? o.createdAt]);
  }
  return { id: res.id, price };
}

const D = tkDay(-5);
const D1 = tkDay(-4);
const D2 = tkDay(-3);
const D_BEFORE = tkDay(-6);
const RANGE = `?from=${D}&to=${D2}`;

test("metrics against a hand-computed fixture; detail; simulator; mutations; roles; end to end", { skip }, async (t) => {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('finance.soum_per_usd', $1::jsonb), ('pricing.target_markup', '3'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(FX)],
  );
  settings.invalidateSettingsCache();

  const cashUser = await mkUser("Cash", { balance: 1_000_000 });
  const pointsUser = await mkUser("Points", { points: 50_000 });
  const quotaUser = await mkUser("Quota", { quota: 50_000 });

  // ---- essay (unit: page) --------------------------------------------------
  // J1: pages 2 → 2 500, balance, COMPLETED, cost 0.05 (ai_usage completed row).
  const j1 = await seedJob({ user: cashUser, toolId: "essay", values: { essayContext: "school_dtm", pages: "2" }, createdAt: tk(D, "10:00:00"), finishedAt: tk(D, "10:05:00"), usage: { outcome: "completed", usd: 0.05 } });
  // J2: pages 4 → 3 500, balance, COMPLETED, legacy cost_json only (0.07).
  const j2 = await seedJob({ user: cashUser, toolId: "essay", values: { essayContext: "school_dtm", pages: "4" }, createdAt: tk(D, "11:00:00"), finishedAt: tk(D, "11:05:00"), costJson: { provider: "gemini", model: "legacy", inputTokens: 100, outputTokens: 50, calls: 1, usd: 0.07 } });
  // J3: pages 1 → 2 000, paid with POINTS (not cash), COMPLETED, no cost data.
  const j3 = await seedJob({ user: pointsUser, toolId: "essay", values: { essayContext: "school_dtm", pages: "1" }, createdAt: tk(D, "12:00:00"), finishedAt: tk(D, "12:05:00") });
  // J4: pages 2 → 2 500, balance, FAILED and fully refunded, failed usage 0.02.
  const j4 = await seedJob({ user: cashUser, toolId: "essay", values: { essayContext: "school_dtm", pages: "2" }, createdAt: tk(D, "13:00:00"), status: "FAILED", finishedAt: tk(D, "13:05:00"), usage: { outcome: "failed", usd: 0.02 }, refund: true });
  // J5: pages 3 → 3 000, quota, still QUEUED (counts as a job, no outcome).
  const j5 = await seedJob({ user: quotaUser, toolId: "essay", values: { essayContext: "school_dtm", pages: "3" }, createdAt: tk(D1, "09:00:00"), status: "QUEUED" });
  assert.deepEqual([j1.price, j2.price, j3.price, j4.price, j5.price], [2500, 3500, 2000, 2500, 3000]);

  // ---- slide (unit: slide) -------------------------------------------------
  const s1 = await seedJob({ user: cashUser, toolId: "slide", values: { slideCount: 10 }, createdAt: tk(D, "08:00:00"), finishedAt: tk(D, "08:10:00"), usage: { outcome: "completed", usd: 0.1 } });
  // S2: finished the next day; cost in BOTH cost_json and ai_usage → counted once.
  const s2 = await seedJob({
    user: cashUser,
    toolId: "slide",
    values: { slideCount: 30 },
    createdAt: tk(D, "09:00:00"),
    finishedAt: tk(D1, "09:10:00"),
    costJson: { provider: "gemini", model: "x", inputTokens: 1, outputTokens: 1, calls: 1, usd: 0.3 },
    usage: { outcome: "completed", usd: 0.3 },
  });
  // S3: created BEFORE the range, finished inside it → in completed/cost, not in jobs/revenue.
  const s3 = await seedJob({ user: cashUser, toolId: "slide", values: { slideCount: 20 }, createdAt: tk(D_BEFORE, "20:00:00"), finishedAt: tk(D, "01:00:00"), usage: { outcome: "completed", usd: 0.2 } });
  assert.deepEqual([s1.price, s2.price, s3.price], [3000, 8000, 3000]);

  // ---- translation (unit: 1 000 chars) and image (unit: image, default 1) --
  await seedJob({ user: cashUser, toolId: "translation", values: { sourceAssetId: "a", sourceChars: 15_000, sourceText: "" }, createdAt: tk(D1, "10:00:00"), finishedAt: tk(D1, "10:30:00"), usage: { outcome: "completed", usd: 0.5 } });
  await seedJob({ user: cashUser, toolId: "image", values: { prompt: "a cat" }, createdAt: tk(D1, "11:00:00"), finishedAt: tk(D1, "11:01:00"), usage: { outcome: "completed", usd: 0.034 } });
  // An abandoned row of a deleted slide job (no generation) still counts as overhead; a free-LLM row is not a tool.
  await recordAiUsage({ source: "job", outcome: "abandoned", generationId: randomUUID(), userId: cashUser.id, toolId: "slide", cost: { provider: "t", model: "m", inputTokens: 1, outputTokens: 1, calls: 1, usd: 0.06 } });
  await recordAiUsage({ source: "free", outcome: "free", userId: cashUser.id, toolId: "free:outline", cost: { provider: "t", model: "m", inputTokens: 1, outputTokens: 1, calls: 1, usd: 9 } });
  await flushAiUsage();
  await query(`UPDATE ai_usage SET at = $1 WHERE outcome IN ('abandoned', 'free')`, [tk(D2, "12:00:00")]);
  ap.clearPricingCache();

  const owner = await session("owner", true, "Dilnoza Owner");

  await t.test("essay: every §17.4 metric equals the hand calculation", async () => {
    const r = await list(owner.cookie, RANGE);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.range, { from: D, to: D2, days: 3 });
    assert.equal(r.body.fx, FX);
    assert.equal(r.body.targetMarkup, 3);
    assert.ok(Array.isArray(r.body.caveats) && (r.body.caveats as string[]).length > 0);
    assert.deepEqual((r.body.groups as { id: string }[]).map((g) => g.id), ["umumiy", "talaba", "oqituvchi", "oyinlar", "media"]);
    assert.equal((r.body.items as Item[]).length, TOOLS.length, "har bir vosita bitta qator");

    const e = itemOf(r, "essay");
    assert.equal(e.title, "Insho");
    assert.equal(e.group, "talaba");
    assert.equal(e.unit, "page");
    assert.equal(e.unitLabel, "bet");
    assert.deepEqual(e.adjust, { percent: 100, roundTo: 500 });
    assert.deepEqual(e.ladder.map((s) => [s.base, s.effective]), [[2000, 2000], [2500, 2500], [3000, 3000], [3500, 3500], [4000, 4000]]);
    // jobs = 5 created in range; avgPrice = 13 500 ÷ 5.
    assert.equal(e.jobs, 5);
    assert.equal(e.avgPrice, 2700);
    // cash = 2 500 + 3 500 + 0 (points) + (2 500 − 2 500 refund) + 3 000 (quota) = 9 000 → ÷ 5.
    assert.equal(e.avgCashRevenue, 1800);
    assert.equal(e.refundRate, 20);
    // units: pages 2, 4, 1, 2, 3 → 2.4.
    assert.equal(e.avgUnits, 2.4);
    // finished basis: 3 completed (J1–J3), 1 failed (J4).
    assert.equal(e.completed, 3);
    assert.equal(e.failed, 1);
    assert.equal(e.failRate, 25);
    // completed spend 0.05 + 0.07 over 2 jobs with cost → 0.06 USD = 720 so'm.
    assert.equal(e.avgCostUsd, 0.06);
    assert.equal(e.avgCostSoum, 720);
    // overhead 0.02 ÷ 3 completed = 0.006667 USD = 80 so'm.
    near(e.overheadUsd as number, 0.0066667, "overheadUsd", 1e-6);
    assert.equal(e.overheadSoum, 80);
    assert.equal(e.fullCostSoum, 800);
    // 800 ÷ 2.4 = 333.33 so'm per page.
    assert.equal(e.costPerUnitSoum, 333.33);
    // margin (1 800 − 800) ÷ 1 800 = 55.56 %; markup 2 700 ÷ 800 = 3.375.
    assert.equal(e.marginPct, 55.56);
    assert.equal(e.markup, 3.375);
    // coverage 2 of 3 completed jobs have cost data.
    assert.equal(e.coveragePct, 66.67);
    assert.equal(e.jobsWithCost, 2);
    // recommendation: 100 × 3 ÷ 3.375 = 88.9 → 90; 3 completed < 20 → low.
    assert.equal(e.recommendedPercent, 90);
    assert.equal(e.sampleSize, 3);
    assert.equal(e.confidence, "low");
    // trend: zero-filled Tashkent days; day D = (0.12 ÷ 2 + 0.02 ÷ 3) × 12 000 = 800.
    assert.deepEqual(e.trend, [
      { day: D, avgCostSoum: 800, jobs: 3 },
      { day: D1, avgCostSoum: null, jobs: 0 },
      { day: D2, avgCostSoum: null, jobs: 0 },
    ]);
  });

  await t.test("slide: two time bases, dedupe, abandoned overhead, units from slideCount", async () => {
    const r = await list(owner.cookie, RANGE);
    const s = itemOf(r, "slide");
    // Orders: S1 + S2 (S3 was created before the range).
    assert.equal(s.jobs, 2);
    assert.equal(s.avgPrice, 5500);
    assert.equal(s.avgCashRevenue, 5500);
    assert.equal(s.avgUnits, 20);
    assert.equal(s.refundRate, 0);
    // Outcomes: S1, S2, S3 all finished inside the range.
    assert.equal(s.completed, 3);
    assert.equal(s.failed, 0);
    assert.equal(s.failRate, 0);
    // Completed spend 0.10 + 0.30 (once) + 0.20 = 0.60 over 3 → 0.20 USD = 2 400 so'm.
    assert.equal(s.avgCostUsd, 0.2);
    assert.equal(s.avgCostSoum, 2400);
    // Abandoned row 0.06 ÷ 3 completed = 0.02 USD = 240 so'm.
    assert.equal(s.overheadUsd, 0.02);
    assert.equal(s.overheadSoum, 240);
    assert.equal(s.fullCostSoum, 2640);
    assert.equal(s.costPerUnitSoum, 132);
    // margin (5 500 − 2 640) ÷ 5 500 = 52 %; markup 5 500 ÷ 2 640 = 2.083.
    assert.equal(s.marginPct, 52);
    assert.equal(s.markup, 2.083);
    assert.equal(s.coveragePct, 100);
    assert.equal(s.jobsWithCost, 3);
    // 100 × 3 ÷ 2.0833 = 144 → 145.
    assert.equal(s.recommendedPercent, 145);
    assert.deepEqual(s.trend, [
      // D: S1 (0.10) + S3 (0.20) completed, no overhead that day → 0.15 USD = 1 800.
      { day: D, avgCostSoum: 1800, jobs: 2 },
      // D1: S2 → 0.30 USD = 3 600.
      { day: D1, avgCostSoum: 3600, jobs: 1 },
      // D2: the abandoned row only → no completed job → null.
      { day: D2, avgCostSoum: null, jobs: 0 },
    ]);
  });

  await t.test("translation units = sourceChars ÷ 1000; image units default 1; no data → nulls; totals", async () => {
    const r = await list(owner.cookie, RANGE);
    const tr = itemOf(r, "translation");
    assert.equal(tr.avgUnits, 15);
    assert.equal(tr.avgPrice, 4000);
    assert.equal(tr.fullCostSoum, 6000);
    assert.equal(tr.costPerUnitSoum, 400);
    const im = itemOf(r, "image");
    assert.equal(im.avgUnits, 1);
    assert.equal(im.fullCostSoum, 408);
    assert.equal(im.costPerUnitSoum, 408);
    const none = itemOf(r, "resume");
    assert.equal(none.jobs, 0);
    for (const k of ["avgPrice", "avgCashRevenue", "avgUnits", "avgCostUsd", "fullCostSoum", "costPerUnitSoum", "marginPct", "markup", "coveragePct", "recommendedPercent"]) {
      assert.equal(none[k], null, k);
    }
    assert.equal(none.confidence, "low");
    assert.deepEqual(none.ladder, [{ label: "Standart", base: 3000, effective: 3000 }]);
    assert.deepEqual(
      none.trend.map((p) => p.avgCostSoum),
      [null, null, null],
    );
    // Totals over the registry tools: free:* rows are not tools.
    const totals = r.body.totals as Record<string, number | null>;
    assert.equal(totals.jobs, 5 + 2 + 1 + 1);
    assert.equal(totals.completed, 3 + 3 + 1 + 1);
    assert.equal(totals.cashRevenue, 9000 + 11000 + 4000 + 2000);
    near(totals.costUsd, 0.14 + 0.66 + 0.5 + 0.034, "costUsd", 1e-6);
    near(totals.costSoum, (0.14 + 0.66 + 0.5 + 0.034) * FX, "costSoum");
  });

  await t.test("range params: default 30 days, bad dates 400, > 366 days 400, repeated param 400", async () => {
    const r = await list(owner.cookie);
    assert.equal(r.status, 200);
    assert.equal((r.body.range as { days: number }).days, 30);
    assert.equal((await list(owner.cookie, "?from=2026-13-01")).status, 400);
    assert.equal((await list(owner.cookie, "?from=2025-01-01&to=2026-06-01")).status, 400);
    assert.equal((await list(owner.cookie, "?from=2026-03-02&to=2026-03-01")).status, 400);
    assert.equal((await list(owner.cookie, `?from=${D}&from=${D1}`)).status, 400);
    assert.equal((await list(owner.cookie, "?from=' OR 1=1 --")).status, 400);
  });

  await t.test("detail: 90-day zero-filled trend, days ≤ 90, ladder, empty history; unknown tool 404", async () => {
    const r = await detail(owner.cookie, "slide");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const tool = r.body.tool as Record<string, unknown>;
    assert.deepEqual(tool, { toolId: "slide", title: "Slayd", group: "umumiy", unit: "slide", unitLabel: "slayd", adjust: { percent: 100, roundTo: 500 } });
    const trend = r.body.trend as { day: string; avgCostSoum: number | null; jobs: number }[];
    assert.equal(trend.length, 90);
    assert.equal(trend[89].day, tkDay(0));
    assert.deepEqual(trend.find((p) => p.day === D), { day: D, avgCostSoum: 1800, jobs: 2 });
    assert.deepEqual(trend.find((p) => p.day === D1), { day: D1, avgCostSoum: 3600, jobs: 1 });
    assert.deepEqual(r.body.history, []);
    assert.deepEqual((r.body.ladder as { base: number }[]).map((s) => s.base), [3000, 3000, 3000, 8000]);
    assert.equal(r.body.fx, FX);
    const short = await detail(owner.cookie, "slide", "?days=7");
    assert.equal((short.body.trend as unknown[]).length, 7);
    assert.equal((await detail(owner.cookie, "slide", "?days=91")).status, 400);
    assert.equal((await detail(owner.cookie, "slide", "?days=abc")).status, 400);
    const missing = await detail(owner.cookie, "no-such-tool");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "not_found");
    assert.equal((await detail(owner.cookie, "../admins")).status, 404);
  });

  await t.test("simulator: ladder re-priced and the last 30 days re-priced at the same volume", async () => {
    const r = await simulate(owner.cookie, "essay", { percent: 120, roundTo: 500 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.proposed, { percent: 120, roundTo: 500 });
    assert.deepEqual(
      (r.body.ladder as { base: number; effective: number }[]).map((s) => s.effective),
      [2000, 2500, 3000, 3500, 4000].map((b) => applyPriceAdjust(b, { percent: 120, roundTo: 500 })),
    );
    const current = r.body.current as Record<string, number | null>;
    const projected = r.body.projected as Record<string, number | null>;
    // Current: the five essay jobs as listed = 13 500; cost = (0.12 + 0.02) × 12 000 = 1 680.
    assert.equal(current.jobs, 5);
    assert.equal(current.revenue30d, 13500);
    assert.equal(current.cost30d, 1680);
    assert.equal(current.marginPct, 87.56);
    // Projected: bases 2 500, 3 500, 2 000, 2 500, 3 000 × 1.2 rounded to 500 = 3 000 + 4 000 + 2 500 + 3 000 + 3 500 = 16 000.
    assert.equal(projected.revenue30d, 16000);
    assert.equal(projected.cost30d, 1680);
    assert.equal(projected.marginPct, 89.5);
    assert.equal(r.body.partial, false);
    assert.equal((r.body.window as { days: number }).days, 30);
    // 100 % → the base ladder and the current revenue, byte for byte.
    const same = await simulate(owner.cookie, "essay", { percent: 100, roundTo: 1000 });
    assert.equal((same.body.projected as { revenue30d: number }).revenue30d, 13500);
    assert.deepEqual((same.body.ladder as { base: number; effective: number }[]).map((s) => s.effective - s.base), [0, 0, 0, 0, 0]);
    // Validation and 404.
    assert.equal((await simulate(owner.cookie, "essay", { percent: 20, roundTo: 500 })).status, 400);
    assert.equal((await simulate(owner.cookie, "essay", { percent: 120, roundTo: 250 })).status, 400);
    assert.equal((await simulate(owner.cookie, "nope", { percent: 120, roundTo: 500 })).status, 404);
  });

  await t.test("PUT: row + history + ONE pricing.update audit row in one transaction; overview shows it at once", async () => {
    const r = await put(owner.cookie, "essay", { percent: 120, roundTo: 500, reason: REASON });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const item = r.body.item as Record<string, unknown>;
    assert.equal(item.toolId, "essay");
    assert.deepEqual(item.adjust, { percent: 120, roundTo: 500 });
    assert.deepEqual((item.ladder as { base: number; effective: number }[]).map((s) => s.effective), [2500, 3000, 3500, 4000, 5000]);
    const hist = item.history as Record<string, unknown>[];
    assert.equal(hist.length, 1);
    assert.equal(hist[0].admin, "Dilnoza Owner");
    assert.equal(hist[0].oldPercent, 100);
    assert.equal(hist[0].newPercent, 120);
    assert.equal(hist[0].oldRoundTo, 500);
    assert.equal(hist[0].newRoundTo, 500);
    assert.equal(hist[0].reason, REASON);

    assert.deepEqual(await pricingRows(), [{ tool_id: "essay", percent: 120, round_to: 500, updated_by: owner.admin.adminId }]);
    assert.deepEqual(await historyRows("essay"), [{ old_percent: 100, new_percent: 120, old_round_to: 500, new_round_to: 500, reason: REASON, admin_id: owner.admin.adminId }]);
    const a = await audits(owner.admin.adminId);
    assert.equal(a.length, 1);
    assert.deepEqual(a[0], {
      action: "pricing.update",
      outcome: "ok",
      target_type: "tool",
      target_id: "essay",
      reason: REASON,
      before: { percent: 100, roundTo: 500 },
      after: { percent: 120, roundTo: 500 },
      meta: null,
    });

    // The overview reads adjustments fresh (aggregates stay cached): effective ladder and recommendation move.
    const o = itemOf(await list(owner.cookie, RANGE), "essay");
    assert.deepEqual(o.adjust, { percent: 120, roundTo: 500 });
    assert.deepEqual(o.ladder.map((s) => s.effective), [2500, 3000, 3500, 4000, 5000]);
    // 120 × 3 ÷ 3.375 = 106.7 → 105.
    assert.equal(o.recommendedPercent, 105);
    const d = await detail(owner.cookie, "essay");
    assert.equal((d.body.history as unknown[]).length, 1);
  });

  await t.test("PUT: unchanged → 409 state (no row, no audit); second change keeps old → new; 100 % removes the row", async () => {
    const same = await put(owner.cookie, "essay", { percent: 120, roundTo: 500, reason: REASON });
    assert.equal(same.status, 409);
    assert.equal(same.body.code, "state");
    assert.equal((await audits(owner.admin.adminId)).length, 1);

    const r2 = await put(owner.cookie, "essay", { percent: 150, roundTo: 1000, reason: "Ikkinchi o'zgarish sinovi" });
    assert.equal(r2.status, 200);
    assert.deepEqual((await historyRows("essay")).at(-1), { old_percent: 120, new_percent: 150, old_round_to: 500, new_round_to: 1000, reason: "Ikkinchi o'zgarish sinovi", admin_id: owner.admin.adminId });
    const a = await audits(owner.admin.adminId, "pricing.update");
    assert.deepEqual(a.at(-1)?.before, { percent: 120, roundTo: 500 });
    assert.deepEqual(a.at(-1)?.after, { percent: 150, roundTo: 1000 });

    const back = await put(owner.cookie, "essay", { percent: 100, roundTo: 500, reason: "Formulaga qaytarish (PUT orqali)" });
    assert.equal(back.status, 200);
    assert.deepEqual(await pricingRows(), [], "100 % = qator yo'q");
    assert.deepEqual((back.body.item as { adjust: unknown }).adjust, { percent: 100, roundTo: 500 });
    assert.equal((await historyRows("essay")).length, 3);
    assert.equal((await audits(owner.admin.adminId, "pricing.update")).length, 3);
  });

  await t.test("PUT validation: 400 for bad percent/roundTo/reason/JSON, 404 unknown tool, nothing written", async () => {
    const before = (await audits(owner.admin.adminId)).length;
    for (const body of [
      { percent: 24, roundTo: 500, reason: REASON },
      { percent: 1001, roundTo: 500, reason: REASON },
      { percent: 110.5, roundTo: 500, reason: REASON },
      { percent: "110", roundTo: 500, reason: REASON },
      { percent: 110, roundTo: 300, reason: REASON },
      { percent: 110, roundTo: "500", reason: REASON },
      { percent: 110, roundTo: 500, reason: "qis" },
      { percent: 110, roundTo: 500, reason: "x".repeat(501) },
      { percent: 110, roundTo: 500 },
    ]) {
      const r = await put(owner.cookie, "slide", body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await put(owner.cookie, "slide", null, { raw: "{not json" })).status, 400);
    const nf = await put(owner.cookie, "no-such-tool", { percent: 110, roundTo: 500, reason: REASON });
    assert.equal(nf.status, 404);
    assert.equal(nf.body.code, "not_found");
    assert.deepEqual(await pricingRows(), []);
    assert.equal((await audits(owner.admin.adminId)).length, before);
  });

  await t.test("DELETE: resets with history + pricing.reset audit; already at 100 % → 409 and nothing written", async () => {
    assert.equal((await put(owner.cookie, "slide", { percent: 80, roundTo: 100, reason: "Aksiya: slayd arzonroq" })).status, 200);
    const r = await del(owner.cookie, "slide", { reason: "Aksiya tugadi" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual((r.body.item as { adjust: unknown }).adjust, { percent: 100, roundTo: 500 });
    assert.deepEqual(await pricingRows(), []);
    assert.deepEqual((await historyRows("slide")).at(-1), { old_percent: 80, new_percent: 100, old_round_to: 100, new_round_to: 500, reason: "Aksiya tugadi", admin_id: owner.admin.adminId });
    const a = await audits(owner.admin.adminId, "pricing.reset");
    assert.equal(a.length, 1);
    assert.deepEqual(a[0].before, { percent: 80, roundTo: 100 });
    assert.deepEqual(a[0].after, { percent: 100, roundTo: 500 });
    assert.equal(a[0].reason, "Aksiya tugadi");

    const again = await del(owner.cookie, "slide", { reason: "Aksiya tugadi" });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "state");
    assert.equal((await audits(owner.admin.adminId, "pricing.reset")).length, 1);
    assert.equal((await historyRows("slide")).length, 2);
    assert.equal((await del(owner.cookie, "slide", { reason: "x" })).status, 400);
    assert.equal((await del(owner.cookie, "ghost", { reason: "Aksiya tugadi" })).status, 404);
  });

  await t.test("atomicity: a failing audit insert (last step) rolls back the tool_pricing row and the history row", async () => {
    // The upsert and the history insert succeed; the audit row — written last, in the same
    // transaction — violates a temporary CHECK, so the whole change must disappear.
    await query(`ALTER TABLE admin_audit_log ADD CONSTRAINT wp11_tmp_no_glossary CHECK (target_id IS DISTINCT FROM 'glossary')`);
    try {
      const r = await put(owner.cookie, "glossary", { percent: 130, roundTo: 500, reason: REASON });
      assert.equal(r.status, 500, JSON.stringify(r.body));
    } finally {
      await query(`ALTER TABLE admin_audit_log DROP CONSTRAINT wp11_tmp_no_glossary`);
    }
    assert.deepEqual(await pricingRows(), []);
    assert.deepEqual(await historyRows("glossary"), []);
    assert.equal((await query(`SELECT 1 FROM admin_audit_log WHERE target_id = 'glossary'`)).length, 0);
    assert.equal(await pricingServer.getToolPricing("glossary"), null);
  });

  await t.test("roles: finance/viewer read, PUT/DELETE 403 + denied audit; support/moderator 403; stale step-up 401; no Origin 403; non-admin 404", async () => {
    for (const role of ["finance", "viewer"] as const) {
      const s = await session(role);
      assert.equal((await list(s.cookie, RANGE)).status, 200, role);
      assert.equal((await detail(s.cookie, "essay")).status, 200, role);
      assert.equal((await simulate(s.cookie, "essay", { percent: 110, roundTo: 500 })).status, 200, role);
      const p = await put(s.cookie, "essay", { percent: 110, roundTo: 500, reason: REASON });
      assert.equal(p.status, 403, role);
      assert.equal(p.body.code, "forbidden");
      assert.equal((await del(s.cookie, "essay", { reason: REASON })).status, 403, role);
      const denied = await audits(s.admin.adminId, "auth.denied");
      assert.equal(denied.length, 2, `${role}: denied audit`);
      assert.equal(denied[0].outcome, "denied");
      assert.deepEqual(denied[0].meta, { permission: "pricing.edit", scope: "admin/pricing/update" });
    }
    for (const role of ["support", "moderator"] as const) {
      const s = await session(role);
      const r = await list(s.cookie, RANGE);
      assert.equal(r.status, 403, role);
      assert.equal((await detail(s.cookie, "essay")).status, 403, role);
      assert.equal((await simulate(s.cookie, "essay", { percent: 110, roundTo: 500 })).status, 403, role);
      assert.equal((await put(s.cookie, "essay", { percent: 110, roundTo: 500, reason: REASON })).status, 403, role);
    }
    const adminRole = await session("admin");
    assert.equal((await put(adminRole.cookie, "keys", { percent: 110, roundTo: 500, reason: REASON })).status, 200, "admin roli tahrirlaydi");
    assert.equal((await del(adminRole.cookie, "keys", { reason: REASON })).status, 200);

    const stale = await session("owner", false);
    const r = await put(stale.cookie, "essay", { percent: 110, roundTo: 500, reason: REASON });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "reauth");
    assert.equal((await list(stale.cookie, RANGE)).status, 200, "o'qish step-up talab qilmaydi");

    assert.equal((await put(owner.cookie, "essay", { percent: 110, roundTo: 500, reason: REASON }, { origin: false })).status, 403);
    assert.equal((await del(owner.cookie, "essay", { reason: REASON }, { origin: false })).status, 403);
    assert.equal((await simulate(owner.cookie, "essay", { percent: 110, roundTo: 500 }, { origin: false })).status, 403, "POST without Origin");

    const plain = await mkUser("Plain");
    assert.equal((await list(`${SESSION_COOKIE}=${plain.userToken}`, RANGE)).status, 404);
    assert.equal((await put(`${SESSION_COOKIE}=${plain.userToken}`, "essay", { percent: 110, roundTo: 500, reason: REASON })).status, 404);
    assert.equal((await list(null, RANGE)).status, 404);
    assert.deepEqual(await pricingRows(), []);
  });

  await t.test("end to end: after PUT the real POST /api/generations charges the adjusted price and rejects the old expectedPrice; after DELETE prices equal priceFor", async () => {
    const ESSAY_VALUES = { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" };
    const base = priceFor(TOOL_BY_ID.essay, ESSAY_VALUES);
    const user = await mkUser("Buyer", { balance: 100_000 });
    const post = async (extra: Record<string, unknown>) => {
      await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
      const req = new Request("http://localhost/api/generations", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${user.userToken}`, "content-type": "application/json", "idempotency-key": randomUUID() },
        body: JSON.stringify({ slug: "essay", values: ESSAY_VALUES, ...extra }),
      });
      return readResult(await inRequest(req, () => generationsRoute.POST(req)));
    };
    const ledger = () =>
      query<{ kind: string; cash: string; reference: string }>(
        `SELECT kind, -(balance_delta + quota_delta) AS cash, reference FROM transactions WHERE user_id = $1 ORDER BY id`,
        [user.id],
      );

    // Warm the 15 s pricing snapshot first: without `invalidatePricingCache()` after the PUT the
    // product path would keep charging the base price until the TTL expires.
    assert.equal(await pricingServer.effectivePrice(TOOL_BY_ID.essay, ESSAY_VALUES), base);
    assert.equal((await put(owner.cookie, "essay", { percent: 120, roundTo: 500, reason: "Narx +20 % sinovi" })).status, 200);
    const effective = applyPriceAdjust(base, { percent: 120, roundTo: 500 });
    assert.notEqual(effective, base);
    assert.equal(await pricingServer.effectivePrice(TOOL_BY_ID.essay, ESSAY_VALUES), effective, "kesh invalidatsiya qilingan");

    const stale = await post({ expectedPrice: base });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
    assert.equal(stale.body.code, "price_changed");
    assert.equal(stale.body.price, effective);
    assert.deepEqual(await ledger(), [], "409 da pul yechilmaydi");

    const ok = await post({ expectedPrice: effective });
    assert.equal(ok.status, 202, JSON.stringify(ok.body));
    assert.equal(ok.body.price, effective);
    const rows = await ledger();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "charge");
    assert.equal(Number(rows[0].cash), effective, "jurnaldagi yechim = amaldagi narx");
    assert.equal(rows[0].reference, ok.body.id);

    assert.equal((await del(owner.cookie, "essay", { reason: "Sinov tugadi" })).status, 200);
    assert.equal(await pricingServer.effectivePrice(TOOL_BY_ID.essay, ESSAY_VALUES), base);
    const again = await post({ expectedPrice: base });
    assert.equal(again.status, 202, JSON.stringify(again.body));
    assert.equal(again.body.price, base);
    // Every ladder of every tool is byte-identical to priceFor again.
    const o = await list(owner.cookie, RANGE);
    for (const item of o.body.items as Item[]) {
      assert.deepEqual(item.adjust, { percent: 100, roundTo: 500 }, item.toolId);
      const inputs = ap.ladderInputs(item.toolId as never);
      item.ladder.forEach((s, i) => {
        assert.equal(s.effective, s.base, `${item.toolId} ${s.label}`);
        assert.equal(s.effective, priceFor(TOOL_BY_ID[item.toolId as never], inputs[i].values), `${item.toolId} ${s.label} = priceFor`);
      });
    }
  });
});
