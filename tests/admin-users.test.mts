import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Users API through the REAL routes (docs/admin/02-plan.md §6.4, §6.4.1,
 * §4.3 invariants, §6.0 Masking, §8, §10 T8/T9) on a throwaway Postgres.
 *
 * Covered: list (every filter, every q class, every sort with keyset paging,
 * masking, generation counts, 400s incl. injection attempts), export (CSV
 * header, masked phone, formula guard, audit `meta.filters`, 403, step-up),
 * detail (masking, stats, audited reveal, denied reveal), the user's ledger,
 * sessions list and revoke-all, block with every side effect in one
 * transaction (and the blocked user's next request refused), unblock,
 * direct message (HTML escaped, bot blocked, transient failure,
 * no_telegram), the self / admin-target guards, Origin and 404 cloak.
 *
 * Telegram is never called: `fetch` is stubbed for the message tests.
 *
 * Mutation checks (each made the named assertion fail, then restored) are
 * listed in the WP2 report.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-users-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminusers") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, currentUser, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { enqueueGeneration } = await import("../lib/server/jobs.ts");
const { createGameSession } = await import("../lib/server/game-sessions.ts");
const payments = await import("../lib/server/payments.ts");
const { ADMIN_CANCEL_NOTE } = await import("../lib/server/admin-job-actions.ts");
const { parseBlockBody, parseMessageBody, parseUserQuery, USER_CSV_HEADER } = await import("../lib/server/admin-users.ts");
const listRoute = await import("../app/api/admin/users/route.ts");
const exportRoute = await import("../app/api/admin/users/export/route.ts");
const detailRoute = await import("../app/api/admin/users/[id]/route.ts");
const txRoute = await import("../app/api/admin/users/[id]/transactions/route.ts");
const sessionsRoute = await import("../app/api/admin/users/[id]/sessions/route.ts");
const revokeRoute = await import("../app/api/admin/users/[id]/sessions/revoke/route.ts");
const blockRoute = await import("../app/api/admin/users/[id]/block/route.ts");
const messageRoute = await import("../app/api/admin/users/[id]/message/route.ts");
const meRoute = await import("../app/api/users/me/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures (admin-wallet.test.mts pattern)

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string; telegramId: string };
type TestAdmin = TestUser & { adminId: string; role: Role };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const UA = "Mozilla/5.0 (X11; Linux x86_64) Chrome/153.0 Safari/537.36";

type UserOpts = {
  name?: string;
  username?: string | null;
  telegramId?: string | null;
  phone?: string | null;
  localId?: string | null;
  plan?: "free" | "pro";
  planExpiresAt?: Date | null;
  points?: number;
  quota?: number;
  balance?: number;
  blocked?: boolean;
  createdAt?: Date;
  university?: string;
  session?: boolean;
};

async function mkUser(o: UserOpts = {}): Promise<TestUser> {
  const tg = o.telegramId === undefined ? String(randomInt(5_000_000_000, 9_000_000_000)) : o.telegramId;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, phone, local_id, plan, plan_expires_at, points, quota, balance, is_blocked, created_at, university)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, now()), $13) RETURNING id::text AS id`,
    [
      tg,
      o.username === undefined ? `u_${randomBytes(5).toString("hex")}` : o.username,
      o.name ?? "Test Foydalanuvchi",
      o.phone ?? null,
      o.localId ?? null,
      o.plan ?? "free",
      o.planExpiresAt ?? null,
      o.points ?? 0,
      o.quota ?? 0,
      o.balance ?? 0,
      o.blocked ?? false,
      o.createdAt ?? null,
      o.university ?? "",
    ],
  );
  const token = o.session === false ? "" : (await createSession(row!.id, { userAgent: UA, ip: "10.0.0.9" })).token;
  return { id: row!.id, userToken: token, telegramId: tg ?? "" };
}

async function mkAdmin(role: Role, user?: TestUser): Promise<TestAdmin> {
  const u = user ?? (await mkUser({ name: `Admin ${role}` }));
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  return { ...u, adminId: row!.id, role };
}

async function openSession(admin: TestAdmin, reauth = true): Promise<Session> {
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(admin.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "users-test", reauth }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

const sessions = new Map<string, Session>();
async function as(role: Role, reauth = true): Promise<Session> {
  const key = `${role}:${reauth}`;
  if (!sessions.has(key)) sessions.set(key, await openSession(await mkAdmin(role), reauth));
  return sessions.get(key)!;
}

type RouteFn = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type Result = { status: number; body: Record<string, unknown>; text: string; headers: Headers };

async function call(
  fn: unknown,
  opts: { cookie?: string | null; method?: string; path: string; id?: string; body?: unknown; origin?: boolean },
): Promise<Result> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "users-test" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== "GET" && opts.origin !== false) headers.origin = "http://localhost:3000";
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost:3000${opts.path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const res = await inRequest(req, () => (fn as RouteFn)(req, { params: Promise.resolve({ id: opts.id ?? "" }) }));
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text, headers: res.headers };
}

const list = (s: Session, qs = "") => call(listRoute.GET, { cookie: s.cookie, path: `/api/admin/users${qs ? `?${qs}` : ""}` });
const detail = (s: Session, id: string, qs = "") => call(detailRoute.GET, { cookie: s.cookie, path: `/api/admin/users/${id}${qs ? `?${qs}` : ""}`, id });
const block = (s: Session, id: string, body: unknown, origin = true) =>
  call(blockRoute.POST, { cookie: s.cookie, method: "POST", path: `/api/admin/users/${id}/block`, id, body, origin });

type Item = Record<string, unknown>;
const items = (r: Result) => r.body.items as Item[];
const ids = (r: Result) => items(r).map((x) => x.id as string);

const audits = (action: string, targetId?: string) =>
  query<{ admin_id: string | null; outcome: string; target_type: string | null; target_id: string | null; reason: string | null; before: Item | null; after: Item | null; meta: Item | null }>(
    `SELECT admin_id::text AS admin_id, outcome, target_type, target_id, reason, before, after, meta FROM admin_audit_log
      WHERE action = $1 AND ($2::text IS NULL OR target_id = $2) ORDER BY id`,
    [action, targetId ?? null],
  );

/** Every page of a keyset list, following `nextCursor`. */
async function allPages(s: Session, qs: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const r = await list(s, `${qs}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(r.status, 200, r.text);
    out.push(...ids(r));
    cursor = r.body.nextCursor as string | null;
    if (!cursor) return out;
  }
  throw new Error("too many pages");
}

// ───────────────────────────── unit (no DB)

test("parseUserQuery: the §6.4.1 classes; overlong input is a 400", () => {
  assert.deepEqual(parseUserQuery("#42"), { kind: "id", value: "42" });
  assert.deepEqual(parseUserQuery("5123456789"), { kind: "numeric", value: "5123456789" });
  assert.deepEqual(parseUserQuery("+998 90 123 45 67"), { kind: "phone", value: "998901234567" });
  assert.deepEqual(parseUserQuery("@Ali_V"), { kind: "username", value: "ali_v" });
  assert.deepEqual(parseUserQuery("Ali Val"), { kind: "name", value: "ali val" });
  assert.equal(parseUserQuery("   "), null);
  assert.equal(parseUserQuery(null), null);
  assert.throws(() => parseUserQuery("a".repeat(201)), (e: { status?: number }) => e.status === 400);
});

test("parseBlockBody: `blocked` and every option must be a real boolean (A5 / T9); defaults per §6.4", () => {
  const ok = parseBlockBody({ blocked: true, reason: "Spam tarqatgani uchun" });
  assert.deepEqual(ok, { blocked: true, reason: "Spam tarqatgani uchun", revokeSessions: true, cancelQueued: false, revokeLinks: false });
  for (const bad of [
    { blocked: "false", reason: "Spam tarqatgani uchun" },
    { blocked: "true", reason: "Spam tarqatgani uchun" },
    { blocked: 1, reason: "Spam tarqatgani uchun" },
    { blocked: null, reason: "Spam tarqatgani uchun" },
    { reason: "Spam tarqatgani uchun" },
    { blocked: true, reason: "Spam tarqatgani uchun", revokeSessions: "false" },
    { blocked: true, reason: "Spam tarqatgani uchun", cancelQueued: 1 },
    { blocked: true, reason: "Spam tarqatgani uchun", revokeLinks: "yes" },
    { blocked: true, reason: "qisq" },
    { blocked: true },
  ]) {
    assert.throws(() => parseBlockBody(bad as Record<string, unknown>), (e: { status?: number }) => e.status === 400, JSON.stringify(bad));
  }
});

test("parseMessageBody: 1..2000 characters after trimming, string only, NUL dropped", () => {
  assert.equal(parseMessageBody({ text: "  Salom\0  " }), "Salom");
  assert.equal(parseMessageBody({ text: "x".repeat(2000) }).length, 2000);
  for (const bad of [{ text: "" }, { text: "   " }, { text: "x".repeat(2001) }, { text: 5 }, {}]) {
    assert.throws(() => parseMessageBody(bad as Record<string, unknown>), (e: { status?: number }) => e.status === 400, JSON.stringify(bad));
  }
});

// ───────────────────────────── seed for the list tests

type Seed = Record<string, TestUser>;
let seed: Seed | null = null;
const DAY = 86_400_000;
/** Signup times are offsets from this instant (fixed once, so day-range assertions cannot straddle midnight). */
const SEED_BASE = Date.now() - 30 * DAY;

/** One shared, deterministic population (isolated DB: these are the only non-admin users with `ls_` usernames). */
async function seedList(): Promise<Seed> {
  if (seed) return seed;
  const base = SEED_BASE;
  const s: Seed = {};
  s.ali = await mkUser({ name: "Ali Valiyev", username: "ls_ali", phone: "+998901234567", balance: 5_000, createdAt: new Date(base + 1 * DAY) });
  s.alisher = await mkUser({ name: "Alisher Karimov", username: "ls_Alisher", balance: 90_000, createdAt: new Date(base + 2 * DAY) });
  s.bek = await mkUser({ name: "Bek", username: "ls_bek", plan: "pro", planExpiresAt: new Date(Date.now() + 10 * DAY), quota: 40, createdAt: new Date(base + 3 * DAY) });
  s.expired = await mkUser({ name: "Eski Pro", username: "ls_expired", plan: "pro", planExpiresAt: new Date(Date.now() - DAY), createdAt: new Date(base + 4 * DAY) });
  s.blocked = await mkUser({ name: "Bloklangan Odam", username: "ls_blocked", blocked: true, createdAt: new Date(base + 5 * DAY) });
  s.otp = await mkUser({ name: "Otp Kirgan", username: "ls_otp", telegramId: null, localId: "+998907654321", createdAt: new Date(base + 6 * DAY) });
  s.pct = await mkUser({ name: "%foiz belgisi", username: "ls_pct", createdAt: new Date(base + 7 * DAY) });
  s.under = await mkUser({ name: "a_b chiziq", username: "ls_under", createdAt: new Date(base + 8 * DAY) });
  s.formula = await mkUser({ name: "=HYPERLINK(\"http://evil\")", username: "ls_formula", balance: 7, createdAt: new Date(base + 9 * DAY) });
  s.nosession = await mkUser({ name: "Sessiyasiz", username: "ls_nosession", session: false, createdAt: new Date(base + 10 * DAY) });
  s.adminUser = await mkUser({ name: "Ichki Admin", username: "ls_admin", createdAt: new Date(base + 11 * DAY) });
  await mkAdmin("support", s.adminUser);
  // Distinct last-seen times for the last_seen sort.
  let k = 0;
  for (const u of Object.values(s)) {
    k++;
    await query(`UPDATE sessions SET last_seen_at = now() - ($2 || ' minutes')::interval WHERE user_id = $1`, [u.id, String(k * 7)]);
  }
  // Two jobs for ali through the real enqueue path (charged from his balance).
  for (const topic of ["Birinchi ish", "Ikkinchi ish"]) {
    const r = await enqueueGeneration({ userId: s.ali.id, toolId: "slide", topic, price: 1_000, format: "pptx", values: {}, budgetMs: 600_000 });
    assert.ok(r.ok);
  }
  seed = s;
  return s;
}

/** Only the seeded `ls_` users, in the order the API returned them. */
const lsOnly = async (orderedIds: string[]) => {
  const s = await seedList();
  const mine = new Set(Object.values(s).map((u) => u.id));
  return orderedIds.filter((id) => mine.has(id));
};

// ───────────────────────────── list

test("list: exact row shape, phone always masked, generation count, total", { skip }, async () => {
  const s = await seedList();
  const owner = await as("owner");
  const r = await list(owner, `q=${encodeURIComponent("#" + s.ali.id)}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.totalCapped, false);
  assert.equal(r.body.nextCursor, null);
  const row = items(r)[0]!;
  assert.deepEqual(Object.keys(row).sort(), [
    "balance",
    "createdAt",
    "generations",
    "id",
    "isAdmin",
    "isBlocked",
    "lastSeenAt",
    "name",
    "phoneMasked",
    "points",
    "quota",
    "telegramId",
    "username",
  ]);
  assert.equal(row.phoneMasked, "+998 ** *** ** 67");
  assert.equal(row.generations, 2);
  assert.equal(row.balance, 3_000, "5 000 minus two charged jobs");
  assert.equal(typeof row.lastSeenAt, "string");
  assert.ok(!r.text.includes("901234567"), "MUTATSIYA: the raw phone never leaves the list");
  // Even owner (who holds users.pii) gets the masked phone in the list.
  const otp = await list(owner, "q=%2B998907654321");
  assert.equal(otp.status, 200);
  assert.deepEqual(ids(otp), [s.otp.id], "OTP local_id matched exactly by +phone");
  assert.ok(!otp.text.includes("907654321"));
});

test("list: q classes — #id, numeric id / telegram id, +phone exact, @username prefix, name prefix; LIKE metacharacters are literal", { skip }, async () => {
  const s = await seedList();
  const v = await as("viewer");
  assert.deepEqual(ids(await list(v, `q=${s.bek.telegramId}`)), [s.bek.id], "telegram id");
  assert.ok(ids(await list(v, `q=${s.bek.id}`)).includes(s.bek.id), "bare digits also match users.id");
  assert.deepEqual(ids(await list(v, `q=${encodeURIComponent("+998 90 123-45-67")}`)), [s.ali.id], "+phone with separators");
  assert.deepEqual(ids(await list(v, `q=${encodeURIComponent("+99890123456")}`)), [], "MUTATSIYA: a phone prefix finds nothing (exact only)");
  assert.deepEqual(await lsOnly(ids(await list(v, `q=${encodeURIComponent("@LS_ALI")}`))), [s.alisher.id, s.ali.id], "@username prefix, case-insensitive");
  assert.deepEqual(await lsOnly(ids(await list(v, "q=ali"))), [s.alisher.id, s.ali.id], "name prefix");
  assert.deepEqual(await lsOnly(ids(await list(v, "q=valiyev"))), [], "no substring scan");
  assert.deepEqual(await lsOnly(ids(await list(v, `q=${encodeURIComponent("%")}`))), [s.pct.id], "MUTATSIYA: % is literal");
  assert.deepEqual(await lsOnly(ids(await list(v, `q=${encodeURIComponent("a_")}`))), [s.under.id], "_ is literal");
  assert.deepEqual(ids(await list(v, `q=${encodeURIComponent("'; DROP TABLE users; --")}`)), [], "injection text is just a name prefix");
});

test("list: filters blocked / isAdmin / signup range", { skip }, async () => {
  const s = await seedList();
  const v = await as("viewer");
  const blocked = await lsOnly(ids(await list(v, "blocked=1&limit=100")));
  assert.deepEqual(blocked, [s.blocked.id]);
  const active = await lsOnly(ids(await list(v, "blocked=0&limit=100")));
  assert.ok(!active.includes(s.blocked.id) && active.includes(s.ali.id));
  // Subscriptions are removed: a legacy `users.plan` is never read; its quota is shown as read-only history.
  const bekRow = items(await list(v, `q=%23${s.bek.id}`))[0]!;
  assert.ok(!("plan" in bekRow) && !("planExpiresAt" in bekRow), "MUTATSIYA: no plan keys");
  assert.equal(bekRow.quota, 40);
  const admins = await lsOnly(ids(await list(v, "isAdmin=1&limit=100")));
  assert.deepEqual(admins, [s.adminUser.id]);
  assert.equal(items(await list(v, `q=%23${s.adminUser.id}`))[0]!.isAdmin, true);
  const notAdmins = await lsOnly(ids(await list(v, "isAdmin=0&limit=100")));
  assert.ok(!notAdmins.includes(s.adminUser.id) && notAdmins.includes(s.ali.id));
  // Signup range: Tashkent days of bek (base+3) .. otp (base+6).
  const day = (ms: number) => new Date(ms + 5 * 3_600_000).toISOString().slice(0, 10);
  const base = SEED_BASE;
  const ranged = await lsOnly(ids(await list(v, `from=${day(base + 3 * DAY)}&to=${day(base + 6 * DAY)}&limit=100`)));
  assert.deepEqual(ranged, [s.otp.id, s.blocked.id, s.expired.id, s.bek.id]);
});

test("list: every sort pages through keyset without gaps or repeats, in the DB's order", { skip }, async () => {
  const s = await seedList();
  const v = await as("viewer");
  const mine = Object.values(s).map((u) => u.id);
  const expect = async (orderBy: string) =>
    (
      await query<{ id: string }>(
        `SELECT u.id::text AS id FROM users u
           LEFT JOIN LATERAL (SELECT max(last_seen_at) AS ls FROM sessions WHERE user_id = u.id) l ON TRUE
          WHERE u.id = ANY($1::bigint[]) ORDER BY ${orderBy}`,
        [mine],
      )
    ).map((r) => r.id);
  const created = await lsOnly(await allPages(v, "sort=created_desc"));
  assert.deepEqual(created, await expect("u.created_at DESC, u.id DESC"));
  const asc = await lsOnly(await allPages(v, "sort=created_asc"));
  assert.deepEqual(asc, await expect("u.created_at ASC, u.id ASC"));
  const balance = await lsOnly(await allPages(v, "sort=balance_desc"));
  assert.deepEqual(balance, await expect("u.balance DESC, u.id DESC"));
  const seen = await lsOnly(await allPages(v, "sort=last_seen_desc"));
  assert.deepEqual(seen, await expect("l.ls DESC NULLS LAST, u.id DESC"), "MUTATSIYA: last_seen keyset incl. the NULL group");
  assert.equal(seen.at(-1), s.nosession.id, "no sessions → last");
  for (const order of [created, asc, balance, seen]) assert.equal(new Set(order).size, mine.length);
});

test("list: bad params are 400, never 500 (sort / cursor / limit / flags / range / repeated / injection)", { skip }, async () => {
  const v = await as("viewer");
  for (const qs of [
    "sort=created_desc;DROP TABLE users",
    "sort=constructor",
    "sort=name_asc",
    "cursor=zzz",
    `cursor=${Buffer.from(JSON.stringify(["2026-01-01T00:00:00.000000", "1 OR 1=1"])).toString("base64url")}`,
    "limit=0",
    "limit=101",
    "limit=abc",
    "blocked=2",
    "blocked=true",
    "isAdmin=yes",
    "from=2026-13-01",
    "from=2026-09-10&to=2026-09-01",
    "from=2024-01-01&to=2026-01-01",
    "q=a&q=b",
    `q=${"x".repeat(201)}`,
  ]) {
    const r = await list(v, qs);
    assert.equal(r.status, 400, `${qs} → ${r.status} ${r.text}`);
  }
});

test("list/detail: a non-admin gets the 404 cloak, a stale admin session 401 admin_auth", { skip }, async () => {
  const s = await seedList();
  const plain = await call(listRoute.GET, { cookie: `${SESSION_COOKIE}=${s.ali.userToken}`, path: "/api/admin/users" });
  assert.equal(plain.status, 404);
  const anon = await call(detailRoute.GET, { cookie: null, path: `/api/admin/users/${s.ali.id}`, id: s.ali.id });
  assert.equal(anon.status, 404);
  const admin = await mkAdmin("viewer");
  const noAdminCookie = await call(listRoute.GET, { cookie: `${SESSION_COOKIE}=${admin.userToken}`, path: "/api/admin/users" });
  assert.equal(noAdminCookie.status, 401);
  assert.equal(noAdminCookie.body.code, "admin_auth");
});

// ───────────────────────────── export

test("export: step-up CSV with the list filters, masked phone, formula guard, one audit row with meta.filters", { skip }, async () => {
  const s = await seedList();
  const owner = await as("owner");
  const r = await call(exportRoute.GET, { cookie: owner.cookie, path: `/api/admin/users/export?q=${encodeURIComponent("+998901234567")}` });
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="foydalanuvchilar-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = r.text.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], USER_CSV_HEADER.map((h) => `"${h}"`).join(","));
  // Subscriptions are removed: no plan columns; the legacy quota column is labelled as history.
  assert.ok(USER_CSV_HEADER.includes("Kvota (eski)") && !USER_CSV_HEADER.some((h) => h.startsWith("Tarif")), USER_CSV_HEADER.join(","));
  assert.equal(lines.length, 2);
  // A leading "+" is a formula trigger in spreadsheets, so the shared CSV guard prefixes an apostrophe.
  assert.ok(lines[1]!.includes(`"'+998 ** *** ** 67"`), lines[1]);
  assert.ok(!r.text.includes("901234567"), "MUTATSIYA: no raw phone in the export");
  const [row] = await audits("export.users");
  assert.equal(row?.outcome, "ok");
  assert.equal(row?.admin_id, owner.admin.adminId);
  assert.deepEqual(row?.meta, { filters: { sort: "created_desc", qKind: "phone", q: "+998 ** *** ** 67" } }, "a phone search is audited masked");

  const f = await call(exportRoute.GET, { cookie: owner.cookie, path: `/api/admin/users/export?q=${encodeURIComponent("=HYPER")}&blocked=0` });
  assert.equal(f.status, 200);
  assert.ok(f.text.includes(`"'=HYPERLINK(""http://evil"")"`), "MUTATSIYA: formula-injection guard");
  assert.ok(f.text.includes(s.formula.id));
  assert.deepEqual((await audits("export.users")).at(-1)?.meta, { filters: { sort: "created_desc", blocked: false, qKind: "name", q: "=hyper" } });
});

test("export: support lacks users.export (403 + denied row); a stale step-up is 401 reauth", { skip }, async () => {
  const support = await as("support");
  const r = await call(exportRoute.GET, { cookie: support.cookie, path: "/api/admin/users/export" });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "forbidden");
  const denied = await query<{ meta: Item }>(`SELECT meta FROM admin_audit_log WHERE admin_id = $1 AND outcome = 'denied'`, [support.admin.adminId]);
  assert.deepEqual(denied.at(-1)?.meta, { permission: "users.export", scope: "admin/users/export" });
  const finance = await as("finance", false);
  const stale = await call(exportRoute.GET, { cookie: finance.cookie, path: "/api/admin/users/export" });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.code, "reauth");
  const financeFresh = await as("finance");
  assert.equal((await call(exportRoute.GET, { cookie: financeFresh.cookie, path: "/api/admin/users/export?blocked=1" })).status, 200);
});

// ───────────────────────────── detail

type DetailFixture = { u: TestUser; jobs: string[]; linkId: string; orderId: string };
let detailSeed: DetailFixture | null = null;

/** One user with sessions, jobs in several states, a stored file, a public link and a paid order (shared, read-only). */
async function detailFixture(): Promise<DetailFixture> {
  if (detailSeed) return detailSeed;
  const u = await mkUser({
    name: "Dilnoza Detail",
    username: "dt_dilnoza",
    phone: "+998901112233",
    localId: "+998901112233",
    university: "TATU",
    balance: 50_000,
  });
  // A second, revoked session and a jobs history through the real paths.
  const extra = await createSession(u.id, { userAgent: "Telegram Mini App", ip: "10.0.0.8" });
  await query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [sha256(extra.token)]);
  const jobs: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await enqueueGeneration({ userId: u.id, toolId: "slide", topic: `Detal ${i}`, price: 2_000, format: "pptx", values: {}, budgetMs: 600_000 });
    assert.ok(r.ok);
    jobs.push(r.id);
  }
  await query(`UPDATE generations SET status = 'COMPLETED', progress = 100, finished_at = now() WHERE id = ANY($1::uuid[])`, [jobs.slice(0, 2)]);
  await query(`UPDATE generations SET status = 'FAILED', finished_at = now() WHERE id = $1`, [jobs[2]]);
  await query(
    `INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, expires_at) VALUES ($1, 'a.pptx', 'application/octet-stream', 4096, '\\x00', now() + interval '30 days')`,
    [jobs[0]],
  );
  const link = await createGameSession(jobs[1]!, u.id, "quiz");
  assert.ok(link);
  const order = await payments.createOrder({ userId: u.id, provider: "click", purpose: "topup", amountSoum: 25_000 });
  assert.ok(await payments.attachTransaction(order.id, String(randomInt(1_000_000_000, 9_000_000_000)), Date.now()));
  const settled = await payments.settleOrder(order.id, Date.now());
  assert.equal(settled.status, "paid");
  detailSeed = { u, jobs, linkId: link!.id, orderId: order.id };
  return detailSeed;
}

test("detail: masked by default; stats, counts, flags and lastSeenAt from the real rows", { skip }, async () => {
  const { u } = await detailFixture();
  const support = await as("support");
  const r = await detail(support, u.id);
  assert.equal(r.status, 200, r.text);
  const user = r.body.user as Item;
  assert.equal(user.phone, "+998 ** *** ** 33");
  assert.equal(user.localId, "+998 ** *** ** 33");
  assert.equal((user.profile as Item).university, "TATU", "MUTATSIYA: profile fields are shown without users.pii (§6.0)");
  assert.equal((user.profile as Item).faculty, "", "empty stays empty");
  assert.equal(user.revealed, false);
  assert.ok(!r.text.includes("901112233"), "no raw phone in a masked detail");
  assert.equal(user.balance, 50_000 - 4 * 2_000 + 25_000);
  assert.deepEqual(r.body.stats, { generations: 4, completed: 2, failed: 1, spentTanga: 8_000, paidSoum: 25_000, storageBytes: 4096 });
  assert.deepEqual(r.body.counts, { activeSessions: 1, queuedJobs: 1, activeGameLinks: 1 });
  assert.deepEqual(r.body.flags, { isAdminAccount: false, adminRole: null, adminStatus: null, self: false });
  assert.equal(r.body.walletConfirmThreshold, 1_000_000);
  const seen = await queryOne<{ ls: Date }>(`SELECT max(last_seen_at) AS ls FROM sessions WHERE user_id = $1`, [u.id]);
  assert.equal(user.lastSeenAt, new Date(seen!.ls).toISOString());
  assert.equal((await audits("users.pii.view", u.id)).length, 0, "a masked read is not audited");
});

test("detail reveal: users.pii → clear values + exactly one users.pii.view row; without it 403 + denied row and nothing revealed", { skip }, async () => {
  const { u } = await detailFixture();
  const support = await as("support");
  const r = await detail(support, u.id, "reveal=1");
  assert.equal(r.status, 200, r.text);
  const user = r.body.user as Item;
  assert.equal(user.phone, "+998901112233");
  assert.equal(user.localId, "+998901112233");
  assert.equal((user.profile as Item).university, "TATU");
  assert.equal(user.revealed, true);
  const rows = await audits("users.pii.view", u.id);
  assert.equal(rows.length, 1, "MUTATSIYA: exactly one reveal audit row");
  assert.equal(rows[0]!.admin_id, support.admin.adminId);
  assert.equal(rows[0]!.target_type, "user");
  assert.deepEqual(rows[0]!.meta, { fields: ["phone", "localId"] });

  for (const role of ["finance", "viewer", "moderator"] as const) {
    const s = await as(role);
    const d = await detail(s, u.id, "reveal=1");
    assert.equal(d.status, 403, `${role}: MUTATSIYA reveal without users.pii`);
    assert.equal(d.body.code, "forbidden");
    assert.ok(!d.text.includes("901112233"));
    const masked = await detail(s, u.id);
    assert.equal(masked.status, 200, `${role} may still read the masked view`);
    assert.equal((masked.body.user as Item).phone, "+998 ** *** ** 33", `${role}: phone stays masked`);
    assert.equal(((masked.body.user as Item).profile as Item).university, "TATU", `${role}: profile shown`);
    const denied = await query<{ meta: Item }>(`SELECT meta FROM admin_audit_log WHERE admin_id = $1 AND outcome = 'denied'`, [s.admin.adminId]);
    assert.deepEqual(denied.at(-1)?.meta, { permission: "users.pii", scope: "admin/users/get" });
  }
  assert.equal((await audits("users.pii.view", u.id)).length, 1, "denied reveals write no pii.view row");
  assert.equal((await detail(support, u.id, "reveal=yes")).status, 400);
  assert.equal((await detail(support, "999999999")).status, 404);
  assert.equal((await detail(support, "999999999")).body.code, "not_found");
});

// ───────────────────────────── ledger tab

test("transactions: the user's ledger with links, kind filter, keyset paging; 400 / 404", { skip }, async () => {
  const { u, jobs, orderId } = await detailFixture();
  const viewer = await as("viewer");
  const get = (qs: string, id = u.id) => call(txRoute.GET, { cookie: viewer.cookie, path: `/api/admin/users/${id}/transactions?${qs}`, id });
  const all = await get("limit=100");
  assert.equal(all.status, 200, all.text);
  assert.equal(all.body.total, 5, "4 charges + 1 top-up");
  const first = items(all)[0]!;
  assert.deepEqual(Object.keys(first).sort(), ["balance", "createdAt", "generationId", "id", "kind", "note", "orderId", "points", "quota", "reference"]);
  const topup = items(all).find((t) => t.kind === "topup")!;
  assert.equal(topup.orderId, orderId);
  assert.equal(topup.generationId, null);
  assert.equal(topup.balance, 25_000);
  const charges = items(all).filter((t) => t.kind === "charge");
  assert.deepEqual(charges.map((c) => c.generationId).sort(), [...jobs].sort());
  assert.ok(charges.every((c) => (c.balance as number) === -2_000));

  const onlyTopup = await get("kind=topup");
  assert.deepEqual(items(onlyTopup).map((t) => t.kind), ["topup"]);
  const paged: string[] = [];
  let cursor: string | null = null;
  do {
    const p = await get(`limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(p.status, 200);
    paged.push(...ids(p));
    cursor = p.body.nextCursor as string | null;
  } while (cursor);
  assert.deepEqual(paged, ids(all));
  assert.equal((await get("kind=steal")).status, 400);
  assert.equal((await get("limit=1000")).status, 400);
  assert.equal((await get("", "999999999")).status, 404);
});

// ───────────────────────────── sessions

test("sessions: list (users.sessions) and revoke-all with one audit row; viewer 403; self 409; reason required", { skip }, async () => {
  const u = await mkUser({ name: "Sessiya Egasi" });
  await createSession(u.id, { userAgent: "Telegram Mini App", ip: "10.0.0.7" });
  const support = await as("support");
  const listed = await call(sessionsRoute.GET, { cookie: support.cookie, path: `/api/admin/users/${u.id}/sessions`, id: u.id });
  assert.equal(listed.status, 200, listed.text);
  assert.equal(items(listed).length, 2);
  assert.deepEqual(Object.keys(items(listed)[0]!).sort(), ["active", "createdAt", "expiresAt", "id", "lastSeenAt", "revokedAt", "userAgent"]);
  assert.ok(items(listed).every((x) => x.active === true && x.revokedAt === null));

  const viewer = await as("viewer");
  assert.equal((await call(sessionsRoute.GET, { cookie: viewer.cookie, path: `/api/admin/users/${u.id}/sessions`, id: u.id })).status, 403);

  const revoke = (s: Session, id: string, body: unknown) =>
    call(revokeRoute.POST, { cookie: s.cookie, method: "POST", path: `/api/admin/users/${id}/sessions/revoke`, id, body });
  assert.equal((await revoke(support, u.id, {})).status, 400);
  assert.equal((await revoke(support, u.id, { reason: "abc" })).status, 400);
  const r = await revoke(support, u.id, { reason: "Akkaunt o'g'irlangan deb xabar berdi" });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { revoked: 2 });
  const live = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
  assert.equal(Number(live!.n), 0, "MUTATSIYA: sessions really revoked");
  const rows = await audits("users.sessions.revoke", u.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.reason, "Akkaunt o'g'irlangan deb xabar berdi");
  assert.deepEqual(rows[0]!.before, { activeSessions: 2 });
  assert.deepEqual(rows[0]!.after, { activeSessions: 0 });
  // The user's own next request is anonymous.
  const me = await call(meRoute.GET, { cookie: `${SESSION_COOKIE}=${u.userToken}`, path: "/api/users/me" });
  assert.equal(me.status, 401);

  const self = await revoke(support, support.admin.id, { reason: "O'zimni chiqarib yuborish" });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "self");
  assert.equal((await revoke(viewer, u.id, { reason: "Ruxsatsiz urinish" })).status, 403);
  assert.equal((await revoke(support, "999999999", { reason: "Mavjud emas foydalanuvchi" })).status, 404);
});

test("bot keyboard links (docs/bot/PLAN.md Q1): admin revoke voids them even with NO live session; a block always voids them", { skip }, async () => {
  const linksBefore = async (id: string) =>
    (await queryOne<{ t: Date | null }>(`SELECT bot_links_before AS t FROM users WHERE id = $1`, [id]))!.t;
  const support = await as("support");
  const u = await mkUser({ name: "Havola Egasi" });
  await query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [u.id]);
  assert.equal(await linksBefore(u.id), null, "a single-device logout does not void links");
  const t0 = Date.now() - 1000;
  const r = await call(revokeRoute.POST, {
    cookie: support.cookie, method: "POST", path: `/api/admin/users/${u.id}/sessions/revoke`, id: u.id, body: { reason: "Havolalar sizib chiqdi" },
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { revoked: 0 });
  const t = await linksBefore(u.id);
  assert.ok(t && t.getTime() >= t0, "MUTATSIYA: admin revoke without live sessions left the bot links alive");

  const v = await mkUser({ name: "Bloklanadigan" });
  const mod = await as("moderator");
  const b = await block(mod, v.id, { blocked: true, reason: "Spam havolalar tarqatdi", revokeSessions: false });
  assert.equal(b.status, 200, b.text);
  const tb = await linksBefore(v.id);
  assert.ok(tb && tb.getTime() >= t0, "MUTATSIYA: a block without session revoke left the bot links alive (an unblock would revive them)");
});

// ───────────────────────────── block

async function blockFixture() {
  const u = await mkUser({ name: "Buzg'unchi", balance: 20_000, points: 0 });
  await createSession(u.id, { userAgent: "Second device", ip: "10.0.0.6" });
  const done = await enqueueGeneration({ userId: u.id, toolId: "slide", topic: "Tayyor", price: 3_000, format: "pptx", values: {}, budgetMs: 600_000 });
  assert.ok(done.ok);
  await query(`UPDATE generations SET status = 'COMPLETED', progress = 100, finished_at = now() WHERE id = $1`, [done.id]);
  const link = await createGameSession(done.id, u.id, "quiz");
  assert.ok(link);
  const queued: string[] = [];
  for (const topic of ["Navbatda 1", "Navbatda 2"]) {
    const r = await enqueueGeneration({ userId: u.id, toolId: "slide", topic, price: 4_000, format: "pptx", values: {}, budgetMs: 600_000 });
    assert.ok(r.ok);
    queued.push(r.id);
  }
  return { u, queued, linkId: link!.id, completed: done.id };
}

test("block: all side effects in one transaction — sessions revoked, queued jobs REVOKED with refunds, links expired, one audit row", { skip }, async () => {
  const { u, queued, linkId, completed } = await blockFixture();
  const before = await queryOne<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [u.id]);
  assert.equal(Number(before!.balance), 20_000 - 3_000 - 8_000);
  const mod = await as("moderator");
  const r = await block(mod, u.id, { blocked: true, reason: "Spam havolalar tarqatdi", revokeSessions: true, cancelQueued: true, revokeLinks: true });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.sideEffects, { sessionsRevoked: 2, jobsCancelled: 2, refunds: 2, linksRevoked: 1 });
  assert.equal((r.body.user as Item).isBlocked, true);
  assert.equal((r.body.user as Item).balance, 20_000 - 3_000, "MUTATSIYA: both queued jobs refunded");

  const jobs = await query<{ id: string; status: string }>(`SELECT id::text AS id, status FROM generations WHERE user_id = $1 ORDER BY created_at`, [u.id]);
  assert.deepEqual(
    jobs.map((j) => j.status),
    ["COMPLETED", "REVOKED", "REVOKED"],
  );
  const refunds = await query<{ reference: string; balance_delta: string; note: string }>(
    `SELECT reference, balance_delta, note FROM transactions WHERE user_id = $1 AND kind = 'refund' ORDER BY reference`,
    [u.id],
  );
  assert.deepEqual(refunds.map((x) => x.reference), [...queued].sort());
  assert.ok(refunds.every((x) => Number(x.balance_delta) === 4_000 && x.note === ADMIN_CANCEL_NOTE));
  const live = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
  assert.equal(Number(live!.n), 0);
  const link = await queryOne<{ dead: boolean }>(`SELECT expires_at <= now() AS dead FROM game_sessions WHERE id = $1`, [linkId]);
  assert.equal(link!.dead, true, "MUTATSIYA: the public link is expired");
  assert.equal((await queryOne<{ status: string }>(`SELECT status FROM generations WHERE id = $1`, [completed]))!.status, "COMPLETED");

  const rows = await audits("users.block", u.id);
  assert.equal(rows.length, 1, "MUTATSIYA: exactly one audit row");
  assert.equal(rows[0]!.admin_id, mod.admin.adminId);
  assert.equal(rows[0]!.reason, "Spam havolalar tarqatdi");
  assert.deepEqual(rows[0]!.before, { is_blocked: false });
  assert.deepEqual(rows[0]!.after, { is_blocked: true });
  assert.deepEqual(rows[0]!.meta, {
    options: { revokeSessions: true, cancelQueued: true, revokeLinks: true },
    sideEffects: { sessionsRevoked: 2, jobsCancelled: 2, refunds: 2, linksRevoked: 1 },
    refunded: { points: 0, quota: 0, balance: 8_000 },
    jobIds: [...queued].sort(),
  });

  const again = await block(mod, u.id, { blocked: true, reason: "Yana bir marta bloklash" });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "unchanged");
  assert.equal((await audits("users.block", u.id)).length, 1);
});

test("block without revoking sessions: the blocked user's next request is still refused (session.ts), unblock restores only the flag", { skip }, async () => {
  const { u, queued } = await blockFixture();
  const me = () => call(meRoute.GET, { cookie: `${SESSION_COOKIE}=${u.userToken}`, path: "/api/users/me" });
  assert.equal((await me()).status, 200, "before the block the user is signed in");
  const support = await as("support");
  const r = await block(support, u.id, { blocked: true, reason: "Shikoyat bo'yicha tekshiruv", revokeSessions: false });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.sideEffects, { sessionsRevoked: 0, jobsCancelled: 0, refunds: 0, linksRevoked: 0 });
  assert.equal((await me()).status, 401, "MUTATSIYA: a blocked user's live session is refused");
  const req = new Request("http://localhost:3000/", { headers: { cookie: `${SESSION_COOKIE}=${u.userToken}` } });
  assert.equal(await inRequest(req, () => currentUser()), null);
  const statuses = await query<{ status: string }>(`SELECT status FROM generations WHERE id = ANY($1::uuid[])`, [queued]);
  assert.ok(statuses.every((x) => x.status === "QUEUED"), "no cancel unless asked");

  const un = await block(support, u.id, { blocked: false, reason: "Tekshiruv tugadi, xato blok", revokeSessions: true, cancelQueued: true });
  assert.equal(un.status, 200, un.text);
  assert.equal((un.body.user as Item).isBlocked, false);
  assert.deepEqual(un.body.sideEffects, { sessionsRevoked: 0, jobsCancelled: 0, refunds: 0, linksRevoked: 0 }, "MUTATSIYA: unblock ignores side effects");
  assert.equal((await me()).status, 200, "the kept session works again");
  const rows = await audits("users.unblock", u.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.before, { is_blocked: true });
  assert.deepEqual(rows[0]!.after, { is_blocked: false });
  const unAgain = await block(support, u.id, { blocked: false, reason: "Ikkinchi marta ochish" });
  assert.equal(unAgain.status, 409);
});

test("block guards: strict boolean 400, self 409, viewer/finance 403, admin target needs admins.manage, Origin required, 404", { skip }, async () => {
  const u = await mkUser({ name: "Oddiy" });
  const support = await as("support");
  const bad = await block(support, u.id, { blocked: "false", reason: "Satr qiymati bilan urinish" });
  assert.equal(bad.status, 400, "MUTATSIYA: Boolean(\"false\") used to block (A5)");
  assert.equal((await queryOne<{ b: boolean }>(`SELECT is_blocked AS b FROM users WHERE id = $1`, [u.id]))!.b, false);
  const self = await block(support, support.admin.id, { blocked: true, reason: "O'zimni bloklash urinishi" });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "self");
  for (const role of ["viewer", "finance"] as const) {
    const s = await as(role);
    const r = await block(s, u.id, { blocked: true, reason: "Ruxsatsiz bloklash urinishi" });
    assert.equal(r.status, 403, role);
    assert.equal(r.body.code, "forbidden");
  }
  const noOrigin = await block(support, u.id, { blocked: true, reason: "Origin sarlavhasisiz so'rov" }, false);
  assert.equal(noOrigin.status, 403);
  assert.equal((await block(support, "999999999", { blocked: true, reason: "Mavjud bo'lmagan foydalanuvchi" })).status, 404);

  // The target holds an admin account: support / moderator lack admins.manage → 403; owner may.
  const target = await mkAdmin("finance");
  for (const role of ["support", "moderator"] as const) {
    const r = await block(await as(role), target.id, { blocked: true, reason: "Admin hisobini bloklash urinishi" });
    assert.equal(r.status, 403, `MUTATSIYA: ${role} on an admin target`);
    assert.equal(r.body.code, "admin_target");
  }
  const revokeBySupport = await call(revokeRoute.POST, {
    cookie: support.cookie,
    method: "POST",
    path: `/api/admin/users/${target.id}/sessions/revoke`,
    id: target.id,
    body: { reason: "Admin sessiyalarini bekor qilish" },
  });
  assert.equal(revokeBySupport.status, 403);
  const owner = await as("owner");
  const ok = await block(owner, target.id, { blocked: true, reason: "Egasi admin foydalanuvchisini bloklaydi" });
  assert.equal(ok.status, 200, ok.text);
  // A rank-limited admin cannot block an owner's user account.
  const ownerTarget = await mkAdmin("owner");
  const adminRole = await as("admin");
  const rank = await block(adminRole, ownerTarget.id, { blocked: true, reason: "Egasini bloklash urinishi" });
  assert.equal(rank.status, 403);
  assert.equal(rank.body.code, "admin_target");
});

// ───────────────────────────── message

type TgCall = { url: string; body: Record<string, unknown> };
async function withTelegram<T>(reply: () => Response | Promise<Response>, fn: (calls: TgCall[]) => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  const calls: TgCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith("https://api.telegram.org/bot123456:admin-users-test-token-never-called/"), url);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return reply();
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const tgJson = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

test("message: HTML-escaped sendMessage, {sent:true}; audit keeps only the length", { skip }, async () => {
  const u = await mkUser({ name: "Xabar Oluvchi" });
  const support = await as("support");
  const text = `Salom <b>${"&"}</b> "do'st" <a href="http://evil">bosing</a>`;
  const r = await withTelegram(
    () => tgJson({ ok: true, result: { message_id: 1 } }),
    async (calls) => {
      const res = await call(messageRoute.POST, { cookie: support.cookie, method: "POST", path: `/api/admin/users/${u.id}/message`, id: u.id, body: { text } });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.body.chat_id, u.telegramId);
      assert.equal(calls[0]!.body.parse_mode, "HTML");
      assert.equal(
        calls[0]!.body.text,
        "Salom &lt;b&gt;&amp;&lt;/b&gt; &quot;do'st&quot; &lt;a href=&quot;http://evil&quot;&gt;bosing&lt;/a&gt;",
        "MUTATSIYA: T8 escape",
      );
      return res;
    },
  );
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { sent: true });
  const rows = await audits("users.message", u.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]!.meta, { length: text.length, sent: true });
  const raw = await queryOne<{ j: string }>(`SELECT row_to_json(l)::text AS j FROM admin_audit_log l WHERE action = 'users.message' AND target_id = $1`, [u.id]);
  assert.ok(!raw!.j.includes("bosing"), "MUTATSIYA: the text is never stored");
});

test("message: bot blocked → {sent:false}; transient → 503; no telegram → 409; moderator 403; bad text 400", { skip }, async () => {
  const u = await mkUser({ name: "Botni Bloklagan" });
  const support = await as("support");
  const send = (s: Session, id: string, body: unknown) => call(messageRoute.POST, { cookie: s.cookie, method: "POST", path: `/api/admin/users/${id}/message`, id, body });
  const blocked = await withTelegram(
    () => tgJson({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }),
    () => send(support, u.id, { text: "Salom" }),
  );
  assert.equal(blocked.status, 200, blocked.text);
  assert.deepEqual(blocked.body, { sent: false });
  const down = await withTelegram(
    () => {
      throw new TypeError("fetch failed");
    },
    () => send(support, u.id, { text: "Salom" }),
  );
  assert.equal(down.status, 503);
  assert.equal(down.body.code, "telegram_unavailable");
  const metas = (await audits("users.message", u.id)).map((x) => x.meta);
  assert.deepEqual(metas, [
    { length: 5, sent: false },
    { length: 5, sent: false, transient: true },
  ]);

  const noTg = await mkUser({ name: "Telegramsiz", telegramId: null });
  const r409 = await withTelegram(
    () => tgJson({ ok: true }),
    async (calls) => {
      const res = await send(support, noTg.id, { text: "Salom" });
      assert.equal(calls.length, 0, "no Telegram call without a chat");
      return res;
    },
  );
  assert.equal(r409.status, 409);
  assert.equal(r409.body.code, "no_telegram");
  assert.equal((await send(await as("moderator"), u.id, { text: "Salom" })).status, 403);
  assert.equal((await send(support, u.id, { text: "" })).status, 400);
  assert.equal((await send(support, u.id, { text: "x".repeat(2001) })).status, 400);
  assert.equal((await send(support, "999999999", { text: "Salom" })).status, 404);
});
