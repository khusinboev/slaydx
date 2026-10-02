import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin generations read API through the REAL routes (docs/admin/02-plan.md
 * §6.5 GET rows, §8 audited reads, §9) on a throwaway Postgres. Jobs are seeded
 * through the real queue paths (`enqueueGeneration` → `claimJob` →
 * `setCost`/`commitJobResult`/`failJob`, `cancelGeneration`, `recordAiUsage`).
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - `unrefunded` without `NOT REFUNDED` → the refunded FAILED job is listed;
 *   - `stuckSql` without `+ 30` / with `locked_at >` → the stuck filter set changes;
 *   - per-job cost summing `cost_json` instead of `spendRowsSql` → the
 *     "ai_usage wins over cost_json" and "sum = spendTotals" assertions fail;
 *   - `maskValues(..., { reveal: true })` always → the masked detail shows raw inputs;
 *   - dropping the reveal permission check → finance gets raw inputs (403 expected);
 *   - dropping the `jobs.file.download` audit → the audit-count assertion fails;
 *   - export without the audit row → the export audit assertion fails.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-gens-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("admingens") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const jobs = await import("../lib/server/jobs.ts");
const { refundInTx } = await import("../lib/server/refund-tx.ts");
const { recordAiUsage, flushAiUsage } = await import("../lib/server/ai-usage.ts");
const { spendTotals } = await import("../lib/server/admin-cost.ts");
const { parseDateRange } = await import("../lib/server/admin-list.ts");
const { keysetBatches } = await import("../lib/server/admin-csv.ts");
const gens = await import("../lib/server/admin-generations.ts");
const routes = {
  list: await import("../app/api/admin/generations/route.ts"),
  exportCsv: await import("../app/api/admin/generations/export/route.ts"),
  detail: await import("../app/api/admin/generations/[id]/route.ts"),
  file: await import("../app/api/admin/generations/[id]/file/route.ts"),
};

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type Session = { cookie: string; adminId: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name: string, balance = 0, points = 0): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, $3, $4, 0, $5) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `g_${randomBytes(5).toString("hex")}`, name, points, balance],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function session(role: Role, reauth = true): Promise<Session> {
  const u = await mkUser(`Admin ${role}`);
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "gens-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.userToken}; ${adminCookieName()}=${s.token}`, adminId: acc!.id };
}

type Res = { status: number; body: Record<string, unknown>; text: string; headers: Headers; bytes: Buffer };

async function get(
  which: keyof typeof routes,
  cookie: string | null,
  path: string,
  params: Record<string, string> = {},
): Promise<Res> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.5", "user-agent": "gens-test" };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost:3000${path}`, { method: "GET", headers });
  const ctx = { params: Promise.resolve(params) };
  const res = await inRequest(req, () => (routes[which].GET as (r: Request, c: unknown) => Promise<Response>)(req, ctx));
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString("utf8");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text, headers: res.headers, bytes };
}

const list = (cookie: string | null, qs = "") => get("list", cookie, `/api/admin/generations${qs ? `?${qs}` : ""}`);
const detail = (cookie: string | null, id: string, qs = "") => get("detail", cookie, `/api/admin/generations/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`, { id });
const file = (cookie: string | null, id: string) => get("file", cookie, `/api/admin/generations/${encodeURIComponent(id)}/file`, { id });
const exportCsv = (cookie: string | null, qs = "") => get("exportCsv", cookie, `/api/admin/generations/export${qs ? `?${qs}` : ""}`);

const audits = (adminId: string, action: string) =>
  query<{ outcome: string; target_type: string | null; target_id: string | null; meta: Record<string, unknown> | null }>(
    `SELECT outcome, target_type, target_id, meta FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id`,
    [adminId, action],
  );

type Item = Record<string, unknown> & { id: string; status: string };
const items = (r: Res) => r.body.items as Item[];
const ids = (r: Res) => items(r).map((g) => g.id);

// ───────────────────────────── seed (real queue paths)

const VALUES = { topic: "Iqtisodiyot asoslari", pages: "10-15", author: "Ali Valiyev", university: "TDIU" };
let leaseN = 0;

async function enqueue(uid: string, price: number, topic: string, toolId = "referat", budgetMs = 60_000): Promise<string> {
  const res = await jobs.enqueueGeneration({
    userId: uid,
    toolId: toolId as never,
    topic,
    price,
    format: "docx",
    values: { ...VALUES, topic } as never,
    budgetMs,
  });
  assert.ok(res.ok, `enqueue: ${JSON.stringify(res)}`);
  return res.id;
}

/** Enqueue + claim (this job is the only QUEUED one, so the claim takes it). */
async function start(uid: string, price: number, topic: string, toolId = "referat"): Promise<{ id: string; lease: string }> {
  const id = await enqueue(uid, price, topic, toolId);
  const lease = jobs.newLease(`w-gens-${leaseN++}`);
  const claimed = await jobs.claimJob(lease, { userMaxRunning: 100 });
  assert.equal(claimed?.id, id);
  return { id, lease };
}

const COST_A = {
  provider: "gemini",
  model: "gemini-flash",
  inputTokens: 1000,
  outputTokens: 500,
  calls: 2,
  usd: 0.0123,
  parts: [
    { kind: "llm", provider: "gemini", model: "gemini-flash", calls: 2, inputTokens: 1000, outputTokens: 500, units: 0, usd: 0.0083 },
    { kind: "image", provider: "gemini", model: "flash-image", calls: 1, inputTokens: 0, outputTokens: 0, units: 1, usd: 0.004 },
  ],
};

type Seed = {
  userA: TestUser;
  userB: TestUser;
  queued: string;
  running: string;
  stuck: string;
  completedLegacy: string;
  completedUsage: string;
  failedUnrefunded: string;
  failedRefunded: string;
  failedFree: string;
  revoked: string;
  formulaJob: string;
  fileBytes: Buffer;
};

async function seed(): Promise<Seed> {
  const userA = await mkUser("Gen Ali", 1_000_000, 500);
  const userB = await mkUser("Gen Vali", 1_000_000);

  // COMPLETED, legacy cost: cost_json only (no ai_usage row) → its usd counts.
  const c1 = await start(userA.id, 3_000, "Tayyor ish (eski xarajat)");
  assert.ok(await jobs.setCost(c1.id, c1.lease, COST_A as never));
  const fileBytes = Buffer.from(`PK\u0003\u0004 admin-gens-${randomUUID()}`);
  assert.ok(
    await jobs.commitJobResult(c1.id, c1.lease, { bytes: fileBytes, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "Tayyor ish.docx" }, [], {
      html: "<p>x</p>",
      doc: null,
      fileName: "Tayyor ish.docx",
      preview: null,
      delivered: { got: 3, want: 4, unit: "rasm" },
    }),
  );

  // COMPLETED with both cost_json and a completed ai_usage row: ai_usage wins (spendRowsSql).
  const c2 = await start(userA.id, 2_000, "Tayyor ish (ai_usage)", "slide");
  assert.ok(await jobs.setCost(c2.id, c2.lease, { ...COST_A, usd: 0.5 } as never));
  assert.ok(await jobs.commitJobResult(c2.id, c2.lease, { bytes: Buffer.from("pptx"), mime: "application/octet-stream", fileName: "d.pptx" }, [], { html: "", doc: null, fileName: "d.pptx", preview: null }));
  assert.ok(await recordAiUsage({ source: "job", outcome: "completed", generationId: c2.id, userId: userA.id, toolId: "slide", cost: { ...COST_A, usd: 0.02 } as never }));

  // FAILED, charged, NOT refunded; a failed-attempt spend row.
  const f1 = await start(userA.id, 1_500, "Xato ish (qaytarilmagan)");
  assert.ok(await jobs.failJob(f1.id, f1.lease, "Provayder javob bermadi"));
  assert.ok(await recordAiUsage({ source: "job", outcome: "failed", generationId: f1.id, userId: userA.id, toolId: "referat", cost: { ...COST_A, usd: 0.007, parts: [] } as never }));

  // FAILED and refunded.
  const f2 = await start(userA.id, 1_000, "Xato ish (qaytarilgan)");
  assert.ok(await jobs.failJob(f2.id, f2.lease, "Ish vaqti tugadi"));
  assert.ok(await transaction((client) => refundInTx(client, userA.id, f2.id, "test")));

  // FAILED, never charged (price 0) → not "unrefunded".
  const f3 = await start(userA.id, 0, "Bepul xato ish");
  assert.ok(await jobs.failJob(f3.id, f3.lease, "Xato"));

  // REVOKED by the user.
  const r1 = await enqueue(userA.id, 800, "Bekor qilingan ish");
  assert.ok(await jobs.cancelGeneration(r1, userA.id));

  // Formula-looking topic (CSV injection probe), other user and tool.
  const x = await start(userB.id, 500, "=SUM(1+1)", "slide");
  assert.ok(await jobs.commitJobResult(x.id, x.lease, { bytes: Buffer.from("x"), mime: "application/octet-stream", fileName: "x.pptx" }, [], { html: "", doc: null, fileName: "x.pptx", preview: null }));

  // IN_PROGRESS stuck: lease older than budget (60 s) + 30 s.
  const s = await start(userA.id, 1_200, "Osilib qolgan ish");
  await query(`UPDATE generations SET locked_at = now() - interval '91 seconds' WHERE id = $1`, [s.id]);
  // IN_PROGRESS healthy: lease 89 s old, inside budget + 30 s.
  const run = await start(userA.id, 1_100, "Ishlayotgan ish");
  await query(`UPDATE generations SET locked_at = now() - interval '89 seconds' WHERE id = $1`, [run.id]);

  // QUEUED last, so no claim above took it.
  const q = await enqueue(userA.id, 900, "Navbatdagi ish");
  await flushAiUsage();

  return {
    userA,
    userB,
    queued: q,
    running: run.id,
    stuck: s.id,
    completedLegacy: c1.id,
    completedUsage: c2.id,
    failedUnrefunded: f1.id,
    failedRefunded: f2.id,
    failedFree: f3.id,
    revoked: r1,
    formulaJob: x.id,
    fileBytes,
  };
}

const S = hasDb ? await seed() : (null as unknown as Seed);
const ALL = 10;

// ───────────────────────────── list

test("list: default sort, exact item shape, canonical cost, charge/refund/stuck flags, capped count", { skip }, async () => {
  const s = await session("viewer");
  const r = await list(s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["items", "nextCursor", "total", "totalCapped"]);
  assert.equal(r.body.total, ALL);
  assert.equal(r.body.totalCapped, false);
  assert.equal(r.body.nextCursor, null);
  const all = items(r);
  assert.equal(all.length, ALL);
  const created = all.map((g) => Date.parse(g.createdAt as string));
  assert.deepEqual(created, [...created].sort((a, b) => b - a), "created_desc");

  const c1 = all.find((g) => g.id === S.completedLegacy)!;
  assert.deepEqual(Object.keys(c1).sort(), [
    "attempts", "charged", "costUsd", "createdAt", "durationSec", "error", "filesPurged", "finishedAt", "id", "price",
    "progress", "refunded", "startedAt", "status", "stuck", "toolId", "topic", "userId", "userName",
  ]);
  assert.equal(c1.status, "COMPLETED");
  assert.equal(c1.userId, S.userA.id);
  assert.equal(c1.userName, "Gen Ali");
  assert.equal(c1.toolId, "referat");
  assert.equal(c1.price, 3_000);
  assert.deepEqual(c1.charged, { points: 500, quota: 0, balance: 2_500 });
  assert.equal(c1.refunded, false);
  assert.equal(c1.costUsd, 0.0123, "legacy: cost_json usd");
  assert.equal(typeof c1.durationSec, "number");
  assert.equal(c1.stuck, false);

  const byId = new Map(all.map((g) => [g.id, g]));
  assert.equal(byId.get(S.completedUsage)!.costUsd, 0.02, "a completed ai_usage row wins over cost_json (admin-cost)");
  assert.equal(byId.get(S.failedUnrefunded)!.costUsd, 0.007, "failed-attempt spend counts");
  assert.equal(byId.get(S.queued)!.costUsd, null);
  assert.equal(byId.get(S.failedRefunded)!.refunded, true);
  assert.equal(byId.get(S.revoked)!.refunded, true);
  assert.equal(byId.get(S.stuck)!.stuck, true);
  assert.equal(byId.get(S.running)!.stuck, false);
  assert.equal(byId.get(S.queued)!.durationSec, null);
  assert.equal(byId.get(S.failedFree)!.charged && JSON.stringify(byId.get(S.failedFree)!.charged), JSON.stringify({ points: 0, quota: 0, balance: 0 }));

  // Every job's cost adds up to the canonical totals of admin-cost.
  const sum = all.reduce((acc, g) => acc + ((g.costUsd as number | null) ?? 0), 0);
  const today = parseDateRange(null, null, { defaultDays: 1 });
  const totals = await spendTotals(pool(), today);
  assert.equal(Number(sum.toFixed(6)), totals.usd);
});

test("list filters: status multi, tool, userId, hasError, unrefunded, stuck, date range", { skip }, async () => {
  const s = await session("support");
  const sorted = (a: string[]) => [...a].sort();

  assert.deepEqual(sorted(ids(await list(s.cookie, "status=FAILED,REVOKED"))), sorted([S.failedUnrefunded, S.failedRefunded, S.failedFree, S.revoked]));
  assert.deepEqual(ids(await list(s.cookie, "status=QUEUED")), [S.queued]);
  assert.deepEqual(sorted(ids(await list(s.cookie, "tool=slide"))), sorted([S.completedUsage, S.formulaJob]));
  assert.deepEqual(ids(await list(s.cookie, `userId=${S.userB.id}`)), [S.formulaJob]);
  assert.deepEqual(sorted(ids(await list(s.cookie, "hasError=1"))), sorted([S.failedUnrefunded, S.failedRefunded, S.failedFree]));
  assert.equal((await list(s.cookie, "hasError=0")).body.total, ALL - 3);

  const unref = await list(s.cookie, "unrefunded=1");
  assert.deepEqual(ids(unref), [S.failedUnrefunded], "charged + FAILED + no refund row only");
  assert.equal(unref.body.total, 1);
  assert.deepEqual(ids(await list(s.cookie, "stuck=1")), [S.stuck], "lease older than budget + 30 s only");
  assert.deepEqual(ids(await list(s.cookie, "stuck=1&status=COMPLETED")), []);

  const today = parseDateRange(null, null, { defaultDays: 1 });
  assert.equal((await list(s.cookie, `from=${today.fromDay}&to=${today.toDay}`)).body.total, ALL);
  const past = await list(s.cookie, "from=2024-01-01&to=2024-01-31");
  assert.equal(past.status, 200);
  assert.deepEqual(past.body.items, []);
  assert.equal(past.body.total, 0);
  assert.equal((await list(s.cookie, `tool=slide&userId=${S.userA.id}`)).body.total, 1);
});

test("list paging: keyset over limit=3 visits every job once; created_asc and duration_desc orders", { skip }, async () => {
  const s = await session("owner");
  for (const sort of ["created_desc", "created_asc", "duration_desc"]) {
    const seen: Item[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await list(s.cookie, `limit=3&sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.total, ALL);
      seen.push(...items(r));
      cursor = r.body.nextCursor as string | null;
      pages += 1;
    } while (cursor && pages < 10);
    assert.equal(pages, 4, sort);
    assert.equal(new Set(seen.map((g) => g.id)).size, ALL, `${sort}: every job exactly once`);
    if (sort === "created_asc") {
      const t = seen.map((g) => Date.parse(g.createdAt as string));
      assert.deepEqual(t, [...t].sort((a, b) => a - b));
    }
    if (sort === "duration_desc") {
      const d = seen.map((g) => g.durationSec as number | null);
      const firstNull = d.indexOf(null);
      assert.ok(firstNull > 0, "finished jobs first");
      assert.ok(d.slice(firstNull).every((x) => x === null), "NULLS LAST");
      const nums = d.slice(0, firstNull) as number[];
      assert.deepEqual(nums, [...nums].sort((a, b) => b - a));
    }
  }
});

test("list: invalid input is a 400 (never a 500), injection attempts included", { skip }, async () => {
  const s = await session("owner");
  for (const qs of [
    "status=DONE",
    "status=FAILED,FAILED'--",
    "status=FAILED&status=QUEUED",
    "tool=nope",
    "tool=referat'%20OR%201=1--",
    "sort=bogus",
    "sort=constructor",
    "sort=created_desc;DROP%20TABLE%20generations",
    "limit=0",
    "limit=101",
    "limit=abc",
    "cursor=xyz",
    `cursor=${Buffer.from(JSON.stringify(["2026-02-30T00:00:00.000000", randomUUID()])).toString("base64url")}`,
    "userId=abc",
    "userId=0",
    "userId=1%20OR%201=1",
    "hasError=yes",
    "unrefunded=true",
    "stuck=2",
    "from=2026-02-30&to=2026-03-01",
    "from=2024-01-01&to=2025-06-01",
    "from=2026-03-01&to=2026-02-01",
  ]) {
    const r = await list(s.cookie, qs);
    assert.equal(r.status, 400, `${qs}: ${r.status} ${r.text}`);
    assert.equal(typeof r.body.error, "string");
  }
  assert.equal((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM generations`))!.n, String(ALL), "table intact");
});

test("guard: non-admin 404, no admin session 401, every role holds jobs.view", { skip }, async () => {
  const plain = await mkUser("Oddiy");
  assert.equal((await list(`${SESSION_COOKIE}=${plain.userToken}`)).status, 404);
  assert.equal((await list(null)).status, 404);
  const s = await session("moderator");
  const noAdminCookie = s.cookie.split("; ")[0];
  const r = await list(noAdminCookie);
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "admin_auth");
  assert.equal((await list(s.cookie)).status, 200);
});

// ───────────────────────────── detail

test("detail: masked inputs, lifecycle, ledger, cost parts, file info, game links", { skip }, async () => {
  await query(
    `INSERT INTO game_sessions (id, generation_id, user_id, token, kind) VALUES ($1, $2, $3, $4, 'quiz')`,
    [randomUUID(), S.completedLegacy, S.userA.id, randomBytes(12).toString("hex")],
  );
  const s = await session("viewer");
  const r = await detail(s.cookie, S.completedLegacy);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["gameLinks", "generation", "ledger"]);
  const g = r.body.generation as Record<string, unknown>;
  assert.equal(g.id, S.completedLegacy);
  assert.equal(g.status, "COMPLETED");
  assert.equal(g.userName, "Gen Ali");
  assert.equal(g.budgetMs, 60_000);
  assert.equal(g.lockedBy, null);
  assert.equal(g.stuck, false);
  assert.deepEqual(g.delivered, { got: 3, want: 4, unit: "rasm" });
  assert.equal(g.hasFile, true);
  assert.equal(g.fileName, "Tayyor ish.docx");
  assert.equal(g.fileSize, S.fileBytes.byteLength);
  assert.equal(g.downloads, 0);
  assert.equal(g.docVersion, 0);
  assert.equal(g.fileVersion, 0);
  assert.deepEqual(g.charged, { points: 500, quota: 0, balance: 2_500 });
  assert.equal(g.refunded, false);
  assert.equal(g.inputsRevealed, false);
  assert.deepEqual(g.inputs, { topic: "Tayyor ish (eski xarajat)", pages: "•••", author: "•••", university: "•••" });
  assert.ok(!("values" in g) && !("html" in g) && !("doc" in g), "no wide columns");
  const cost = g.cost as { usd: number; parts: Array<Record<string, unknown>> };
  assert.equal(cost.usd, 0.0123);
  assert.equal(cost.parts.length, 2);
  assert.deepEqual(cost.parts[1], { kind: "image", provider: "gemini", model: "flash-image", calls: 1, inputTokens: 0, outputTokens: 0, units: 1, usd: 0.004, outcome: "completed" });
  const ledger = r.body.ledger as Array<Record<string, unknown>>;
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].kind, "charge");
  assert.equal(ledger[0].balance, -2_500);
  assert.equal(ledger[0].points, -500);
  assert.equal(r.body.gameLinks, 1);

  const st = (await detail(s.cookie, S.stuck)).body.generation as Record<string, unknown>;
  assert.equal(st.stuck, true);
  assert.equal(st.status, "IN_PROGRESS");
  assert.match(String(st.lockedBy), /^w-gens-/);
  assert.equal(st.cost, null);

  const fr = await detail(s.cookie, S.failedRefunded);
  assert.equal((fr.body.generation as Record<string, unknown>).refunded, true);
  assert.deepEqual((fr.body.ledger as Array<{ kind: string }>).map((t) => t.kind), ["charge", "refund"]);
  assert.equal(((await detail(s.cookie, S.queued)).body.generation as Record<string, unknown>).hasFile, false);
});

test("detail: 404 for unknown or malformed ids; reveal flag validation", { skip }, async () => {
  const s = await session("owner");
  for (const id of [randomUUID(), "abc", "1", `${randomUUID()}x`, "' OR 1=1 --"]) {
    const r = await detail(s.cookie, id);
    assert.equal(r.status, 404, `${id}: ${r.text}`);
    assert.equal(r.body.code, "not_found");
  }
  assert.equal((await detail(s.cookie, S.queued, "reveal=2")).status, 400);
  assert.equal((await detail(s.cookie, S.queued, "reveal=1&reveal=1")).status, 400);
  assert.equal((await detail(s.cookie, S.queued, "reveal=0")).status, 200);
  assert.equal((await audits(s.adminId, "jobs.input.view")).length, 0, "no reveal, no audit");
});

test("detail reveal=1: jobs.input shows raw inputs with ONE audit row; a role without it gets 403 + denied", { skip }, async () => {
  const sup = await session("support");
  const r = await detail(sup.cookie, S.completedLegacy, "reveal=1");
  assert.equal(r.status, 200, r.text);
  const g = r.body.generation as Record<string, unknown>;
  assert.equal(g.inputsRevealed, true);
  assert.deepEqual(g.inputs, { ...VALUES, topic: "Tayyor ish (eski xarajat)" });
  const a = await audits(sup.adminId, "jobs.input.view");
  assert.equal(a.length, 1);
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_type, "generation");
  assert.equal(a[0].target_id, S.completedLegacy);

  // A missing job is a 404 and is not audited.
  assert.equal((await detail(sup.cookie, randomUUID(), "reveal=1")).status, 404);
  assert.equal((await audits(sup.adminId, "jobs.input.view")).length, 1);

  const fin = await session("finance");
  const denied = await detail(fin.cookie, S.completedLegacy, "reveal=1");
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "forbidden");
  assert.ok(!denied.text.includes("Ali Valiyev"), "no raw inputs in the refusal");
  assert.equal((await audits(fin.adminId, "jobs.input.view")).length, 0);
  const d = await audits(fin.adminId, "auth.denied");
  assert.equal(d.length, 1);
  assert.equal(d[0].outcome, "denied");
  assert.equal(d[0].meta?.permission, "jobs.input");
});

// ───────────────────────────── file

test("file: jobs.input downloads the stored bytes as a no-store attachment with one audit row", { skip }, async () => {
  const s = await session("support");
  const r = await file(s.cookie, S.completedLegacy);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.bytes.equals(S.fileBytes), "exact bytes");
  assert.match(r.headers.get("content-disposition") ?? "", /^attachment; filename="Tayyor ish\.docx"/);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("content-length"), String(S.fileBytes.byteLength));
  const a = await audits(s.adminId, "jobs.file.download");
  assert.equal(a.length, 1);
  assert.equal(a[0].target_id, S.completedLegacy);
  assert.equal(a[0].meta?.size, S.fileBytes.byteLength);
  const dl = await queryOne<{ downloads: number }>(`SELECT downloads FROM generation_files WHERE generation_id = $1`, [S.completedLegacy]);
  assert.equal(dl!.downloads, 0, "an admin look is not a user download");

  const none = await file(s.cookie, S.queued);
  assert.equal(none.status, 404);
  assert.equal((await file(s.cookie, "nope")).status, 404);
  assert.equal((await audits(s.adminId, "jobs.file.download")).length, 1, "404s are not audited");

  const v = await session("viewer");
  const denied = await file(v.cookie, S.completedLegacy);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "forbidden");
});

// ───────────────────────────── export

test("export: step-up CSV with BOM, header, escaped formula cells, same filters, one audit row with meta.filters", { skip }, async () => {
  const s = await session("finance");
  const r = await exportCsv(s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get("content-type") ?? "", /^text\/csv; charset=utf-8/);
  assert.match(r.headers.get("content-disposition") ?? "", /^attachment; filename="generatsiyalar-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.text.charCodeAt(0), 0xfeff, "BOM");
  const lines = r.text.slice(1).trimEnd().split("\r\n");
  assert.equal(lines[0], gens.GENERATIONS_CSV_HEADER.map((h) => `"${h}"`).join(","));
  assert.equal(lines.length, ALL + 1);
  const formula = lines.find((l) => l.includes(S.formulaJob))!;
  assert.ok(formula.includes(`"'=SUM(1+1)"`), `escaped: ${formula}`);
  assert.ok(!/,"=SUM/.test(r.text), "no raw formula cell");
  assert.ok(lines.some((l) => l.startsWith(`"${S.completedUsage}"`) && l.includes(`"0.02"`)), "cost column");

  const a = await audits(s.adminId, "export.generations");
  assert.equal(a.length, 1);
  assert.equal(a[0].outcome, "ok");
  assert.deepEqual(a[0].meta, { filters: { sort: "created_desc" } });

  const f = await exportCsv(s.cookie, `status=FAILED&unrefunded=1&userId=${S.userA.id}&sort=created_asc`);
  assert.equal(f.status, 200);
  const fl = f.text.slice(1).trimEnd().split("\r\n");
  assert.equal(fl.length, 2);
  assert.ok(fl[1].startsWith(`"${S.failedUnrefunded}"`));
  const a2 = await audits(s.adminId, "export.generations");
  assert.equal(a2.length, 2);
  assert.deepEqual(a2[1].meta, { filters: { sort: "created_asc", status: ["FAILED"], userId: S.userA.id, unrefunded: true } });

  assert.equal((await exportCsv(s.cookie, "sort=bogus")).status, 400);
  assert.equal((await audits(s.adminId, "export.generations")).length, 2, "a rejected export is not audited");
});

test("export: role without jobs.export → 403; stale step-up → 401 reauth; nothing audited", { skip }, async () => {
  const v = await session("support");
  const r = await exportCsv(v.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "forbidden");
  const o = await session("owner", false);
  const re = await exportCsv(o.cookie);
  assert.equal(re.status, 401);
  assert.equal(re.body.code, "reauth");
  assert.equal((await audits(v.adminId, "export.generations")).length + (await audits(o.adminId, "export.generations")).length, 0);
});

test("export batches: keyset batches of 2 cover the same rows as the list, in order", { skip }, async () => {
  const params = gens.parseGenerationsQuery(new URL("http://x/?sort=duration_desc"));
  const out: string[] = [];
  for await (const b of keysetBatches(gens.exportPageFetcher(params), 2)) out.push(...b.map((g) => g.id));
  const s = await session("owner");
  assert.deepEqual(out, ids(await list(s.cookie, "sort=duration_desc")));
});
