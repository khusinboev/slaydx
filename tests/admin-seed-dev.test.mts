/**
 * `scripts/admin-seed-dev.mts` (docs/admin/02-plan.md §11): the guards refuse
 * without connecting or writing, a run seeds every admin screen's data through
 * the real code paths (every status, state, ledger kind and game kind), a
 * second run adds a second batch, and `--reset` removes exactly the seed rows.
 *
 * The script runs as a child process against fresh databases created next to
 * DATABASE_URL (`createIsolatedDb`), exactly as `npm run admin:seed-dev` would.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createIsolatedDb, type IsolatedDb } from "./helpers/isolated-db.mts";

const base = process.env.DATABASE_URL ?? "";
const hasDb = Boolean(base) && !base.includes("unused");
const localDb = hasDb && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname);
const skip = !hasDb ? "DATABASE_URL yo'q" : !localDb ? "DATABASE_URL lokal emas (skript faqat lokal bazaga yozadi)" : false;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWED_PHONES = ["+998901234567", "+998901112233", "+998907654321", "+998900000001", "+998900000002"];

type Run = { code: number | null; stdout: string; stderr: string; ms: number };

function run(args: string[], env: Record<string, string>): Run {
  const t = Date.now();
  const r = spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "scripts/admin-seed-dev.mts", ...args], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "development", ...env },
    encoding: "utf8",
    timeout: 400_000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: Date.now() - t };
}

let seedDb: IsolatedDb | null = null;
let prodDb: IsolatedDb | null = null;
let seedUrl = "";
let prodUrl = "";
let client: pg.Client | null = null;

const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await client!.query<T>(text, params)).rows;
const n = async (text: string, params: unknown[] = []) => Number((await q<{ n: string }>(text, params))[0]?.n ?? 0);

const TABLES = [
  "users", "sessions", "generations", "generation_files", "transactions", "payment_orders", "payment_events", "ai_usage",
  "game_sessions", "game_results", "error_log", "process_heartbeats", "housekeeping_status", "broadcasts",
  "broadcast_recipients", "admin_accounts", "admin_audit_log", "tool_pricing", "app_settings",
];
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = await n(`SELECT count(*)::text AS n FROM ${t}`);
  return out;
}

const SEED_USERS = `SELECT id FROM users WHERE username LIKE 'seed\\_b%' AND telegram_id >= 9990000000000`;
let baseline: Record<string, number> = {};
const control: Record<string, string> = {};

before(async () => {
  if (skip) return;
  // The "prod"-named database is created from the base URL first (short name), then the seed database.
  prodDb = await createIsolatedDb("prodguard");
  prodUrl = process.env.DATABASE_URL!;
  process.env.DATABASE_URL = base;
  seedDb = await createIsolatedDb("seeddev");
  seedUrl = process.env.DATABASE_URL!;
  process.env.DATABASE_URL = base;
  assert.ok(prodDb.isolated && seedDb.isolated, "test databases could not be created");

  // Migrate the seed database through the product's own migrator, then add rows the seed must never touch.
  migrate(seedUrl);
  client = new pg.Client({ connectionString: seedUrl });
  await client.connect();

  // A real user whose username happens to look like a seed one: only the synthetic Telegram id range marks seed users.
  const [u] = await q<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES (555000111, 'seed_b1_lookalike', 'Haqiqiy foydalanuvchi') RETURNING id::text AS id`,
  );
  control.user = u!.id;
  await q(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'control-hash', now() + interval '1 day')`, [u!.id]);
  const [g] = await q<{ id: string }>(
    `INSERT INTO generations (id, user_id, tool_id, status, topic) VALUES (gen_random_uuid(), $1, 'slide', 'COMPLETED', 'Nazorat ishi') RETURNING id::text AS id`,
    [u!.id],
  );
  control.generation = g!.id;
  await q(`INSERT INTO transactions (user_id, kind, points_delta, reference, note) VALUES ($1, 'bonus', 3000, 'signup:control', 'Bonus')`, [u!.id]);
  const [o] = await q<{ id: string }>(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum, state) VALUES (gen_random_uuid(), $1, 'click', 'topup', 20000, 'created') RETURNING id::text AS id`,
    [u!.id],
  );
  await q(`INSERT INTO payment_events (provider, method, order_id, payload) VALUES ('click', 'prepare', $1, '{}'::jsonb)`, [o!.id]);
  await q(`INSERT INTO ai_usage (source, outcome, user_id, tool_id, calls, usd) VALUES ('free', 'free', $1, 'free:udk', 1, 0.001)`, [u!.id]);
  await q(`INSERT INTO error_log (fingerprint, level, scope, message, process) VALUES ('control-fp', 'error', 'pdf', '[pdf] nazorat xatosi', 'worker@prod-host:1')`);
  await q(
    `INSERT INTO process_heartbeats (process_id, role, hostname, started_at, last_seen_at, concurrency) VALUES ('web@prod-host:1', 'web', 'prod-host', now(), now(), 0)`,
  );
  await q(`INSERT INTO housekeeping_status (step, runs, last_process) VALUES ('uploads', 3, 'worker@prod-host:1')`);
  await q(`INSERT INTO broadcasts (status, text, audience) VALUES ('draft', 'Haqiqiy qoralama', '{"kind":"all"}'::jsonb)`);
  baseline = await counts();
});

/**
 * Applies the migrations to `url` with the product migrator, in a child process: `db.ts` reads
 * DATABASE_URL at import, and this test's own module graph must not point at the seed database.
 */
function migrate(url: string): void {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--conditions=react-server", "-e", `import("./lib/server/db.ts").then(async (m) => { await m.ensureMigrated(); await m.pool().end(); })`],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: url, NODE_ENV: "development" }, encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(r.status, 0, r.stderr);
}

after(async () => {
  await client?.end().catch(() => {});
  await seedDb?.drop().catch(() => {});
  await prodDb?.drop().catch(() => {});
});

/* ───────────────────────────── guards ───────────────────────────── */

test("guard: NODE_ENV=production — exit 1, sabab aytiladi, hech narsa yozilmaydi", { skip }, async () => {
  const r = run([], { DATABASE_URL: seedUrl, NODE_ENV: "production" });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /refused: NODE_ENV is "production"/);
  assert.deepEqual(await counts(), baseline);
});

test("guard: baza nomida 'prod' — ulanmasdan rad etadi (migratsiya ham qo'llanmaydi)", { skip }, async () => {
  assert.ok(new URL(prodUrl).pathname.includes("prod"));
  const r = run([], { DATABASE_URL: prodUrl });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /refused: the database name ".*prod.*" contains "prod"/);
  const c = new pg.Client({ connectionString: prodUrl });
  await c.connect();
  try {
    const rows = (await c.query<{ t: string | null }>(`SELECT to_regclass('public.schema_migrations')::text AS t`)).rows;
    assert.equal(rows[0]?.t, null, "the guard ran before any connection");
  } finally {
    await c.end();
  }
});

test("guard: lokal bo'lmagan host (manzilda ham, ?host= da ham) — exit 1", { skip }, async () => {
  const remote = new URL(seedUrl);
  remote.hostname = "db.example.com";
  const r1 = run([], { DATABASE_URL: remote.toString() });
  assert.equal(r1.code, 1, r1.stderr);
  assert.match(r1.stderr, /refused: the database host "db\.example\.com" is not local/);
  assert.ok(r1.ms < 60_000);

  const override = new URL(seedUrl);
  override.searchParams.set("host", "10.1.2.3");
  const r2 = run([], { DATABASE_URL: override.toString() });
  assert.equal(r2.code, 1, r2.stderr);
  assert.match(r2.stderr, /refused: the database host "10\.1\.2\.3" is not local/);

  const r3 = run([], { DATABASE_URL: "" });
  assert.equal(r3.code, 1);
  assert.match(r3.stderr, /refused: DATABASE_URL is not set/);
  assert.deepEqual(await counts(), baseline);
});

test("guard: navbatni bajaradigan jonli worker yoki olinadigan navbat bo'lsa — rad etadi", { skip }, async () => {
  await q(
    `INSERT INTO process_heartbeats (process_id, role, hostname, started_at, last_seen_at, concurrency) VALUES ('worker@laptop:4242', 'worker', 'laptop', now(), now(), 3)`,
  );
  const r1 = run([], { DATABASE_URL: seedUrl });
  await q(`DELETE FROM process_heartbeats WHERE process_id = 'worker@laptop:4242'`);
  assert.equal(r1.code, 1, r1.stderr);
  assert.match(r1.stderr, /worker@laptop:4242/);
  assert.match(r1.stderr, /WORKER_INLINE=false/);

  await q(`UPDATE generations SET status = 'QUEUED', run_after = now() WHERE id = $1`, [control.generation]);
  const r2 = run([], { DATABASE_URL: seedUrl });
  await q(`UPDATE generations SET status = 'COMPLETED' WHERE id = $1`, [control.generation]);
  assert.equal(r2.code, 1, r2.stderr);
  assert.match(r2.stderr, /1 claimable job/);
  assert.deepEqual(await counts(), baseline);
});

test("argumentlar: noma'lum bayroq — exit 2", { skip }, () => {
  const r = run(["--nope"], { DATABASE_URL: seedUrl });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown argument: --nope/);
});

/* ───────────────────────────── seed, second batch, reset ───────────────────────────── */

let first: { batch: number; counts: Record<string, Record<string, number> | number> } | null = null;

test("seed: har ekran uchun ma'lumot — har holat, buyurtma holati, jurnal turi va o'yin turi bor", { skip }, async () => {
  const r = run(["--json"], { DATABASE_URL: seedUrl });
  assert.equal(r.code, 0, r.stderr);
  first = JSON.parse(r.stdout.trim().split("\n").at(-1)!);
  assert.equal(first!.batch, 1);
  const c = first!.counts as Record<string, Record<string, number>>;

  for (const s of ["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED", "REVOKED"]) assert.ok(c.generations![s]! >= 1, `status ${s}`);
  for (const s of ["created", "pending", "paid", "cancelled"]) assert.ok(c.paymentOrders![s]! >= 1, `order ${s}`);
  for (const k of ["charge", "refund", "topup", "bonus", "subscription", "admin_credit", "admin_debit", "quota_merge"]) assert.ok(c.transactions![k]! >= 1, `ledger ${k}`);
  for (const k of ["quiz", "crossword", "flashcards", "sorting", "listening"]) assert.ok(c.gameSessions![k]! >= 1, `game ${k}`);
  for (const k of ["completed", "failed", "abandoned", "free"]) assert.ok(c.aiUsage![k]! >= 1, `ai_usage ${k}`);
  for (const k of ["draft", "done"]) assert.ok(c.broadcasts![k]! >= 1, `broadcast ${k}`);
  assert.equal(c.users!.total, 40);
  assert.ok(c.users!.blocked! >= 1 && c.users!.withPhone! >= 1);
  assert.ok(!("pro" in c.users!), "subscriptions are removed: no Pro user count");
  const total = Object.values(c.generations!).reduce((a, b) => a + b, 0);
  assert.ok(total > 100, `enough generations for paging (${total})`);

  // The printed summary is what the database holds.
  const byStatus = await q<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM generations WHERE user_id IN (${SEED_USERS}) GROUP BY status`,
  );
  assert.deepEqual(Object.fromEntries(byStatus.map((x) => [x.status, Number(x.n)])), c.generations);
  const byKind = await q<{ kind: string; n: string }>(`SELECT kind, count(*)::text AS n FROM transactions WHERE user_id IN (${SEED_USERS}) GROUP BY kind`);
  assert.deepEqual(Object.fromEntries(byKind.map((x) => [x.kind, Number(x.n)])), c.transactions);
  const now = await counts();
  assert.equal(now.users, baseline.users! + 40);
  assert.equal(now.error_log, baseline.error_log! + Number(first!.counts.errorLog));
  assert.equal(now.process_heartbeats, baseline.process_heartbeats! + Number(first!.counts.heartbeats));
  assert.ok(Number(first!.counts.gameResults) >= 1 && Number(first!.counts.paymentEvents) >= 1);
  assert.ok(c.sessions!.total! >= 1 && c.sessions!.revoked! >= 1, "sessions, the blocked users' revoked");

  // Real money paths: every seed wallet equals its ledger; no money row was written by hand.
  assert.equal(
    await n(
      `SELECT count(*)::text AS n FROM users u
         LEFT JOIN (SELECT user_id, sum(points_delta) p, sum(quota_delta) qq, sum(balance_delta) b FROM transactions GROUP BY user_id) t ON t.user_id = u.id
        WHERE u.id IN (${SEED_USERS}) AND (u.points <> COALESCE(t.p, 0) OR u.quota <> COALESCE(t.qq, 0) OR u.balance <> COALESCE(t.b, 0))`,
    ),
    0,
  );
  assert.equal(await n(`SELECT count(*)::text AS n FROM generations WHERE user_id IN (${SEED_USERS}) AND status = 'COMPLETED' AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'charge' AND t.reference = generations.id::text) AND price > 0`), 0);
  assert.equal(await n(`SELECT count(*)::text AS n FROM generations WHERE user_id IN (${SEED_USERS}) AND status = 'REVOKED' AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'refund' AND t.reference = generations.id::text)`), 0);
  assert.equal(await n(`SELECT count(*)::text AS n FROM payment_orders WHERE user_id IN (${SEED_USERS}) AND state = 'paid' AND perform_time = 0`), 0);
  // Legacy Pro history (SUBS-REMOVAL §3): every paid pro order has its own `subscription` quota credit,
  // and after the 034-style merge no seeded user holds quota; each merge row moves quota into balance 1:1.
  assert.equal(
    await n(
      `SELECT count(*)::text AS n FROM payment_orders o WHERE o.user_id IN (${SEED_USERS}) AND o.purpose = 'pro' AND o.state = 'paid'
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.kind = 'subscription' AND t.quota_delta = 15000 AND t.balance_delta = 0
                             AND t.reference = o.provider || ':' || o.provider_txn)`,
    ),
    0,
  );
  assert.ok((await n(`SELECT count(*)::text AS n FROM payment_orders WHERE user_id IN (${SEED_USERS}) AND purpose = 'pro' AND state = 'paid'`)) >= 1);
  assert.equal(await n(`SELECT count(*)::text AS n FROM users WHERE id IN (${SEED_USERS}) AND quota <> 0`), 0, "quota merged into balance");
  assert.equal(
    await n(
      `SELECT count(*)::text AS n FROM transactions WHERE user_id IN (${SEED_USERS}) AND kind = 'quota_merge'
          AND NOT (quota_delta < 0 AND balance_delta = -quota_delta AND points_delta = 0 AND reference = 'quota-merge:' || user_id::text)`,
    ),
    0,
  );

  // Safety: nothing a worker could claim, running seed jobs can never be retried.
  assert.equal(await n(`SELECT count(*)::text AS n FROM generations WHERE status = 'QUEUED' AND run_after <= now()`), 0);
  assert.equal(await n(`SELECT count(*)::text AS n FROM generations WHERE user_id IN (${SEED_USERS}) AND status = 'IN_PROGRESS' AND attempts < 2`), 0);

  // Phones only from the synthetic allowlist; Telegram ids synthetic.
  const phones = (await q<{ phone: string }>(`SELECT phone FROM users WHERE id IN (${SEED_USERS}) AND phone IS NOT NULL`)).map((x) => x.phone);
  assert.ok(phones.length >= 1 && phones.every((p) => ALLOWED_PHONES.includes(p)), phones.join(","));
  assert.equal(await n(`SELECT count(*)::text AS n FROM users WHERE username LIKE 'seed\\_%' AND telegram_id < 9990000000000 AND id <> $1`, [control.user]), 0);

  // Timestamps spread over the last 60 days (backdated after the API stamped now()).
  const [span] = await q<{ oldest: string; newest: string; days: string }>(
    `SELECT extract(epoch FROM now() - min(created_at))::text AS oldest, extract(epoch FROM now() - max(created_at))::text AS newest,
            count(DISTINCT (created_at AT TIME ZONE 'Asia/Tashkent')::date)::text AS days
       FROM generations WHERE user_id IN (${SEED_USERS})`,
  );
  assert.ok(Number(span!.oldest) > 30 * 86_400 && Number(span!.oldest) <= 61 * 86_400, `oldest ${span!.oldest}`);
  assert.ok(Number(span!.newest) >= 0);
  assert.ok(Number(span!.days) >= 25, `jobs on ${span!.days} distinct days`);
  assert.ok((await n(`SELECT count(DISTINCT (created_at AT TIME ZONE 'Asia/Tashkent')::date)::text AS n FROM users WHERE id IN (${SEED_USERS})`)) >= 20);
  assert.equal(await n(`SELECT count(*)::text AS n FROM payment_orders WHERE user_id IN (${SEED_USERS}) AND created_at > now()`), 0);

  // Untouched: pricing, settings, admin accounts and the audit log; the look-alike real user and its rows.
  for (const t of ["tool_pricing", "app_settings", "admin_accounts", "admin_audit_log"]) assert.equal(now[t], baseline[t], t);
  assert.equal(await n(`SELECT count(*)::text AS n FROM housekeeping_status WHERE step = 'uploads' AND last_process = 'worker@prod-host:1'`), 1);
});

test("seed: ikkinchi yurish xatosiz ikkinchi partiya qo'shadi", { skip }, async () => {
  assert.ok(first, "the first run passed");
  const r = run(["--json", "--owner-telegram-id", "123456789"], { DATABASE_URL: seedUrl });
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  const second = JSON.parse(lines.find((l) => l.startsWith("{"))!);
  assert.equal(second.batch, 2);
  assert.equal(second.counts.users.total, 80);
  assert.equal(await n(`SELECT count(*)::text AS n FROM users WHERE username LIKE 'seed\\_b2\\_%'`), 40);
  assert.match(r.stdout, /npm run admin:create -- --telegram-id 123456789 --role owner/);
  assert.equal(await n(`SELECT count(*)::text AS n FROM admin_accounts`), baseline.admin_accounts);
});

test("--reset: faqat skript yaratgan qatorlarni o'chiradi", { skip }, async () => {
  const r = run(["--reset", "--json"], { DATABASE_URL: seedUrl });
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1)!);
  assert.equal(out.reset.users, 80);
  assert.deepEqual(await counts(), baseline);
  // The look-alike user (seed_ prefix but a real Telegram id) and every control row survive.
  assert.equal(await n(`SELECT count(*)::text AS n FROM users WHERE id = $1`, [control.user]), 1);
  assert.equal(await n(`SELECT count(*)::text AS n FROM generations WHERE id = $1`, [control.generation]), 1);
  assert.equal(await n(`SELECT count(*)::text AS n FROM error_log WHERE fingerprint = 'control-fp'`), 1);

  const again = run(["--reset", "--json"], { DATABASE_URL: seedUrl });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout.trim().split("\n").at(-1)!).reset.users, 0);
});
