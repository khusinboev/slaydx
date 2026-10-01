import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Error log through the REAL routes (docs/admin/02-plan.md §6.11, §7.1 S16) on a
 * throwaway Postgres. Every row is written by the real error sink
 * (`log("error", …)` → `createErrorSink` → `upsertErrorLog`), never by a bare INSERT:
 *   - list: exact item shape without `stack`, keyset paging over every row, each
 *     filter (level, scope, resolved, from/to, q prefix), 400 on every bad param
 *     and on injection attempts;
 *   - detail: carries the stack; bad / unknown ids are 404, never 500;
 *   - resolve: exactly one `errors.resolve` audit row, a repeat is a no-op without a
 *     second row, and after a resolve a NEW occurrence opens a new row (the
 *     open-fingerprint unique index);
 *   - bulk: ≤ 100 ids, ONE audit row with the ids in meta, skips resolved/unknown;
 *   - permission: errors.view owner/admin/support/viewer 200, finance/moderator 403;
 *     errors.resolve owner/admin only; Origin mandatory on mutations.
 *
 * Mutation checks (each made the named assertion fail, then restored) are listed
 * in the work-package report.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-errors-test-token-never-called";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("adminerrors") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { log, setErrorSink } = await import("../lib/server/log.ts");
const { createErrorSink } = await import("../lib/server/error-sink.ts");
const listRoute = await import("../app/api/admin/errors/route.ts");
const detailRoute = await import("../app/api/admin/errors/[id]/route.ts");
const resolveOneRoute = await import("../app/api/admin/errors/[id]/resolve/route.ts");
const resolveBulkRoute = await import("../app/api/admin/errors/resolve/route.ts");

after(async () => {
  setErrorSink(null);
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb && iso.isolated) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestAdmin = { id: string; userToken: string; adminId: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkAdmin(role: Role): Promise<TestAdmin> {
  const u = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'Errors Test') RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `err_${randomBytes(5).toString("hex")}`],
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
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "errors-test", reauth: true }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

type Res<T = Record<string, unknown>> = { status: number; body: T; text: string };

async function send<T = Record<string, unknown>>(req: Request, run: () => Promise<Response>): Promise<Res<T>> {
  const res = await inRequest(req, run);
  const text = await res.text();
  let body = {} as T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body, text };
}

const baseHeaders = (cookie: string | null): Record<string, string> => {
  const h: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "errors-test" };
  if (cookie) h.cookie = cookie;
  return h;
};

type ListBody = { items: Array<Record<string, unknown>>; nextCursor: string | null; total: number | null; totalCapped: boolean };

function list(qs: string, cookie: string | null) {
  const req = new Request(`http://localhost:3000/api/admin/errors${qs}`, { headers: baseHeaders(cookie) });
  return send<ListBody & { error?: string }>(req, () => listRoute.GET(req, undefined));
}

function detail(id: string, cookie: string | null) {
  const req = new Request(`http://localhost:3000/api/admin/errors/${id}`, { headers: baseHeaders(cookie) });
  return send<{ error: Record<string, unknown> | string; code?: string }>(req, () => detailRoute.GET(req, { params: Promise.resolve({ id }) }));
}

function post(url: string, body: unknown, cookie: string | null, origin: string | null = "http://localhost:3000") {
  const headers = { ...baseHeaders(cookie), "content-type": "application/json" } as Record<string, string>;
  if (origin) headers.origin = origin;
  return new Request(url, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function resolveOne(id: string, body: unknown, cookie: string | null, origin: string | null = "http://localhost:3000") {
  const req = post(`http://localhost:3000/api/admin/errors/${id}/resolve`, body, cookie, origin);
  return send<{ error: Record<string, unknown> | string; code?: string }>(req, () => resolveOneRoute.POST(req, { params: Promise.resolve({ id }) }));
}

function resolveMany(body: unknown, cookie: string | null, origin: string | null = "http://localhost:3000") {
  const req = post("http://localhost:3000/api/admin/errors/resolve", body, cookie, origin);
  return send<{ resolved?: number; error?: string; code?: string }>(req, () => resolveBulkRoute.POST(req, undefined));
}

// ───────────────────────────── seeding through the real sink

const sinkHandle = createErrorSink({ processId: "web@wp7test:1", maxPerMinute: 10_000 });
setErrorSink(sinkHandle.sink, { warn: true });

/** `log()` hands the record to the sink in a microtask; wait until the write settled. */
async function settle(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
  await sinkHandle.flush();
}

async function emit(level: "error" | "warn", msg: string, fields: Record<string, unknown> = {}): Promise<void> {
  log(level, msg, fields);
  await settle();
}

type Row = { id: string; fingerprint: string; count: number; resolved_at: Date | null; last_seen_at: Date };
const rowOf = (message: string) =>
  queryOne<Row>(`SELECT id::text AS id, fingerprint, count, resolved_at, last_seen_at FROM error_log WHERE message LIKE $1 ORDER BY id DESC LIMIT 1`, [`${message}%`]);

/** Pushes a row's last_seen_at to a fixed minute ago so ordering and the date filters are deterministic. */
const lastSeen = (id: string, minutesAgo: number) =>
  query(`UPDATE error_log SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, minutesAgo]);

// Seven distinct fingerprints (words, not digits: the fingerprint normalises numbers).
const SEED: Array<{ key: string; level: "error" | "warn"; msg: string; fields: Record<string, unknown>; err?: Error; ago: number }> = [
  { key: "alpha", level: "error", msg: "[pdf] alpha converter exploded", fields: { reqId: "req-alpha", path: "/api/pdf" }, err: new Error("soffice timeout"), ago: 10 },
  { key: "bravo", level: "error", msg: "[pdf] bravo converter exploded", fields: {}, ago: 20 },
  { key: "charlie", level: "warn", msg: "[llm] charlie fallback used", fields: { jobId: "job-charlie" }, ago: 30 },
  { key: "delta", level: "error", msg: "[payments] delta mismatch", fields: { userId: "42" }, ago: 40 },
  { key: "echo", level: "warn", msg: "[llm] echo slow answer", fields: {}, ago: 50 },
  { key: "foxtrot", level: "error", msg: "[worker] foxtrot lease lost", fields: {}, ago: 60 },
  { key: "golf", level: "error", msg: "100%_literal golf message", fields: {}, ago: 70 },
];
const ids: Record<string, string> = {};

test("seed: every row is written by the real sink (one open row per fingerprint, repeats bump count)", { skip }, async () => {
  for (const s of SEED) {
    await emit(s.level, s.msg, { ...s.fields, ...(s.err ? { err: s.err } : {}) });
    const r = await rowOf(s.msg);
    assert.ok(r, `${s.key} row exists`);
    ids[s.key] = r.id;
  }
  const before = await query(`SELECT 1 FROM error_log`);
  assert.equal(before.length, SEED.length);
  // Same fingerprint again: no new row, count + 1.
  // (the latest occurrence's request id / path win, as the sink documents)
  await emit("error", SEED[0].msg, { ...SEED[0].fields, err: new Error("soffice timeout") });
  assert.equal((await query(`SELECT 1 FROM error_log`)).length, SEED.length);
  assert.equal((await rowOf(SEED[0].msg))!.count, 2);
  for (const s of SEED) await lastSeen(ids[s.key], s.ago);
});

// ───────────────────────────── list

const ITEM_KEYS = [
  "count", "fingerprint", "firstSeenAt", "id", "jobId", "lastSeenAt", "level", "message", "path", "process",
  "requestId", "resolvedAt", "resolvedBy", "scope", "userId",
];

test("list: exact item shape, no stack, newest first, scope/path/ids taken from the record", { skip }, async () => {
  const s = await sessionFor("viewer");
  const r = await list("", s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["items", "nextCursor", "total", "totalCapped"]);
  assert.equal(r.body.total, SEED.length);
  assert.equal(r.body.totalCapped, false);
  assert.equal(r.body.nextCursor, null);
  assert.equal(r.body.items.length, SEED.length);
  for (const it of r.body.items) assert.deepEqual(Object.keys(it).sort(), ITEM_KEYS);
  assert.ok(!r.text.includes('"stack"'), "stack never in the list");
  assert.deepEqual(r.body.items.map((i) => i.id), SEED.map((x) => ids[x.key]), "last seen desc");

  const alpha = r.body.items.find((i) => i.id === ids.alpha)!;
  assert.equal(alpha.scope, "pdf");
  assert.equal(alpha.level, "error");
  assert.equal(alpha.count, 2);
  assert.equal(alpha.requestId, "req-alpha");
  assert.equal(alpha.path, "/api/pdf");
  assert.equal(alpha.process, "web@wp7test:1");
  assert.equal(alpha.resolvedAt, null);
  assert.equal(alpha.resolvedBy, null);
  assert.equal(typeof alpha.firstSeenAt, "string");
  assert.equal(typeof alpha.fingerprint, "string");
  assert.equal(r.body.items.find((i) => i.id === ids.charlie)!.jobId, "job-charlie");
  assert.equal(r.body.items.find((i) => i.id === ids.delta)!.userId, "42");
});

test("list: keyset paging walks every row exactly once", { skip }, async () => {
  const s = await sessionFor("viewer");
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r: Res<ListBody> = await list(`?limit=3${cursor ? `&cursor=${cursor}` : ""}`, s.cookie);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.items.length <= 3);
    assert.equal(r.body.total, SEED.length, "total is the filtered count on every page");
    seen.push(...r.body.items.map((i) => i.id as string));
    cursor = r.body.nextCursor;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, SEED.map((x) => ids[x.key]));
});

test("list: filters level, scope, resolved, q prefix, date range", { skip }, async () => {
  const s = await sessionFor("support");
  const idsOf = (r: Res<ListBody>) => r.body.items.map((i) => i.id as string).sort();
  const want = (...keys: string[]) => keys.map((k) => ids[k]).sort();

  assert.deepEqual(idsOf(await list("?level=warn", s.cookie)), want("charlie", "echo"));
  assert.deepEqual(idsOf(await list("?level=error", s.cookie)), want("alpha", "bravo", "delta", "foxtrot", "golf"));
  assert.deepEqual(idsOf(await list("?scope=pdf", s.cookie)), want("alpha", "bravo"));
  assert.deepEqual(idsOf(await list("?scope=PDF", s.cookie)), [], "scope is an exact, case-sensitive match");
  assert.deepEqual(idsOf(await list("?resolved=1", s.cookie)), []);
  assert.equal((await list("?resolved=0", s.cookie)).body.total, SEED.length);
  // q: case-insensitive message prefix, regex/LIKE metacharacters are literal.
  assert.deepEqual(idsOf(await list("?q=%5Bpdf%5D", s.cookie)), want("alpha", "bravo"));
  assert.deepEqual(idsOf(await list("?q=%5BPDF%5D%20alpha", s.cookie)), want("alpha"));
  assert.deepEqual(idsOf(await list("?q=pdf", s.cookie)), [], "a prefix, not a substring");
  assert.deepEqual(idsOf(await list("?q=100%25_", s.cookie)), want("golf"), "% and _ are literal");
  assert.deepEqual(idsOf(await list("?q=%25", s.cookie)), [], "a bare % does not match everything");
  assert.deepEqual(idsOf(await list("?q=_", s.cookie)), []);
  // combined
  assert.deepEqual(idsOf(await list("?level=error&scope=pdf&q=%5Bpdf%5D%20b", s.cookie)), want("bravo"));
  // date range: Tashkent calendar days; every seeded row was last seen within the last 70 minutes.
  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 5 * 3_600_000 - 86_400_000 * 2).toISOString().slice(0, 10);
  const r = await list(`?from=${yesterday}&to=${today}`, s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.total! >= 1);
  assert.deepEqual(idsOf(await list("?from=2020-01-01&to=2020-01-31", s.cookie)), []);
  // an old row falls outside "to"
  await query(`UPDATE error_log SET last_seen_at = '2020-01-15T10:00:00Z' WHERE id = $1`, [ids.golf]);
  assert.deepEqual(idsOf(await list("?from=2020-01-01&to=2020-01-31", s.cookie)), want("golf"));
  assert.ok(!idsOf(await list(`?from=${yesterday}&to=${today}`, s.cookie)).includes(ids.golf));
  await lastSeen(ids.golf, 70);
});

test("list: 400 on every bad parameter and on injection attempts (never 500)", { skip }, async () => {
  const s = await sessionFor("viewer");
  const bad = [
    "?level=fatal", "?level=error,warn", "?level=ERROR", "?resolved=2", "?resolved=true", "?limit=0", "?limit=101", "?limit=abc",
    "?sort=message", "?sort=last_seen_desc;DROP%20TABLE%20error_log", "?sort=__proto__", "?cursor=garbage",
    `?cursor=${Buffer.from(JSON.stringify(["x", "y"])).toString("base64url")}`,
    "?from=2026-02-30", "?from=yesterday", "?to=2026-13-01", "?from=2026-03-02&to=2026-03-01", "?from=2024-01-01&to=2026-01-01",
    `?q=${"a".repeat(121)}`, `?scope=${"s".repeat(65)}`, "?scope=a&scope=b", "?q=a&q=b", "?level=error&level=warn", "?q=a%00b",
  ];
  for (const qs of bad) {
    const r = await list(qs, s.cookie);
    assert.equal(r.status, 400, `${qs} → ${r.status} ${r.text.slice(0, 120)}`);
    assert.equal(typeof r.body.error, "string");
  }
  // Injection through the free-text params is just a literal search that finds nothing.
  for (const payload of ["'; DROP TABLE error_log; --", "' OR '1'='1", "\\", "%27%20OR%201=1"]) {
    const r = await list(`?q=${encodeURIComponent(payload)}&scope=${encodeURIComponent(payload.slice(0, 40))}`, s.cookie);
    assert.equal(r.status, 200, payload);
    assert.equal(r.body.items.length, 0, payload);
  }
  assert.equal((await query(`SELECT 1 FROM error_log`)).length, SEED.length, "table intact");
});

// ───────────────────────────── detail

test("detail: includes the stack; malformed and unknown ids are 404 (never 500)", { skip }, async () => {
  const s = await sessionFor("viewer");
  const r = await detail(ids.alpha, s.cookie);
  assert.equal(r.status, 200, r.text);
  const e = r.body.error as Record<string, unknown>;
  assert.deepEqual(Object.keys(e).sort(), [...ITEM_KEYS, "stack"].sort());
  assert.equal(e.id, ids.alpha);
  assert.ok(typeof e.stack === "string" && (e.stack as string).includes("soffice timeout"), "stack carries the error");
  assert.equal(e.message, "[pdf] alpha converter exploded: soffice timeout");
  const noStack = await detail(ids.bravo, s.cookie);
  assert.equal((noStack.body.error as Record<string, unknown>).stack, null, "a record without an Error has no stack");

  for (const id of ["0", "-1", "abc", "1.5", "01", "9999999999999999999999", "9223372036854775808", "1%20OR%201=1", "%00"]) {
    const bad = await detail(id, s.cookie);
    assert.equal(bad.status, 404, `${id} → ${bad.status}`);
    assert.equal(bad.body.code, "not_found");
  }
  const none = await detail("9223372036854775807", s.cookie);
  assert.equal(none.status, 404);
  assert.equal(none.body.code, "not_found");
});

// ───────────────────────────── resolve (single)

const audits = (adminId: string) =>
  query<{ action: string; outcome: string; target_type: string | null; target_id: string | null; reason: string | null; before: unknown; after: unknown; meta: Record<string, unknown> | null }>(
    `SELECT action, outcome, target_type, target_id, reason, before, after, meta FROM admin_audit_log WHERE admin_id = $1 ORDER BY id`,
    [adminId],
  );

test("resolve one: updates the row and writes exactly one audit row; a repeat is a no-op", { skip }, async () => {
  const s = await sessionFor("admin");
  const r = await resolveOne(ids.alpha, { reason: "soffice yangilandi, qayta tekshirildi" }, s.cookie);
  assert.equal(r.status, 200, r.text);
  const e = r.body.error as Record<string, unknown>;
  assert.equal(e.id, ids.alpha);
  assert.notEqual(e.resolvedAt, null);
  assert.equal(e.resolvedBy, s.admin.adminId);
  assert.equal(typeof e.stack, "string", "the resolve response is the full detail");
  const a = await audits(s.admin.adminId);
  assert.equal(a.length, 1);
  assert.equal(a[0].action, "errors.resolve");
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_type, "error");
  assert.equal(a[0].target_id, ids.alpha);
  assert.equal(a[0].reason, "soffice yangilandi, qayta tekshirildi");
  assert.deepEqual(a[0].before, { resolved: false });
  assert.deepEqual(a[0].after, { resolved: true });
  assert.equal(a[0].meta?.scope, "pdf");
  assert.equal(a[0].meta?.count, 2);

  const first = (await queryOne<{ resolved_at: Date; resolved_by: string }>(`SELECT resolved_at, resolved_by::text FROM error_log WHERE id = $1`, [ids.alpha]))!;
  const again = await resolveOne(ids.alpha, {}, s.cookie);
  assert.equal(again.status, 200, "resolving a resolved row is not an error");
  assert.equal((again.body.error as Record<string, unknown>).resolvedBy, s.admin.adminId);
  const second = (await queryOne<{ resolved_at: Date; resolved_by: string }>(`SELECT resolved_at, resolved_by::text FROM error_log WHERE id = $1`, [ids.alpha]))!;
  assert.equal(second.resolved_at.getTime(), first.resolved_at.getTime(), "resolved_at is not touched by the repeat");
  assert.equal((await audits(s.admin.adminId)).length, 1, "no second audit row");

  // Another admin repeating it does not steal the resolution either.
  const other = await sessionFor("owner");
  assert.equal((await resolveOne(ids.alpha, {}, other.cookie)).status, 200);
  assert.equal((await queryOne<{ resolved_by: string }>(`SELECT resolved_by::text FROM error_log WHERE id = $1`, [ids.alpha]))!.resolved_by, s.admin.adminId);
  assert.equal((await audits(other.admin.adminId)).length, 0);
});

test("resolve one: the reason is optional but validated; unknown / malformed ids; Origin is mandatory", { skip }, async () => {
  const s = await sessionFor("owner");
  // No reason at all.
  const r = await resolveOne(ids.bravo, {}, s.cookie);
  assert.equal(r.status, 200, r.text);
  const a = await audits(s.admin.adminId);
  assert.equal(a.length, 1);
  assert.equal(a[0].reason, null);

  // Bad reasons change nothing.
  for (const reason of ["abc", "x".repeat(501), 12345, ["a long enough reason"], { reason: "a long enough reason" }]) {
    const bad = await resolveOne(ids.charlie, { reason }, s.cookie);
    assert.equal(bad.status, 400, JSON.stringify(reason).slice(0, 40));
  }
  assert.equal((await rowOf("[llm] charlie"))!.resolved_at, null);
  // A blank reason counts as absent.
  assert.equal((await resolveOne(ids.charlie, { reason: "   " }, s.cookie)).status, 200);

  for (const id of ["abc", "0", "9999999999999999999999"]) assert.equal((await resolveOne(id, {}, s.cookie)).status, 404, id);
  const none = await resolveOne("9223372036854775807", {}, s.cookie);
  assert.equal(none.status, 404);
  assert.equal(none.body.code, "not_found");
  for (const body of ["not json", "[]", "null", `"x"`]) assert.equal((await resolveOne(ids.delta, body, s.cookie)).status, 400, body);
  assert.equal((await resolveOne(ids.delta, "x".repeat(9_000), s.cookie)).status, 413 /* body cap */);

  assert.equal((await resolveOne(ids.delta, {}, s.cookie, null)).status, 403, "no Origin");
  assert.equal((await resolveOne(ids.delta, {}, s.cookie, "https://evil.example")).status, 403, "foreign Origin");
  assert.equal((await rowOf("[payments] delta"))!.resolved_at, null, "nothing changed");
  assert.equal((await audits(s.admin.adminId)).filter((x) => x.action === "errors.resolve").length, 2, "only the two successful resolves");
});

test("after a resolve, a new occurrence opens a NEW row (open-fingerprint unique index), the resolved one stays", { skip }, async () => {
  const resolved = await rowOf("[pdf] alpha"); // resolved above
  assert.ok(resolved?.resolved_at, "precondition: alpha is resolved");
  await emit("error", SEED[0].msg, { err: new Error("soffice timeout"), reqId: "req-alpha-2" });
  const rows = await query<{ id: string; count: number; resolved_at: Date | null; request_id: string | null }>(
    `SELECT id::text AS id, count, resolved_at, request_id FROM error_log WHERE fingerprint = $1 ORDER BY id`,
    [resolved.fingerprint],
  );
  assert.equal(rows.length, 2, "same fingerprint, two rows");
  assert.equal(rows[0].id, ids.alpha);
  assert.notEqual(rows[0].resolved_at, null);
  assert.equal(rows[0].count, 2, "the resolved row is frozen");
  assert.equal(rows[1].resolved_at, null);
  assert.equal(rows[1].count, 1);
  assert.equal(rows[1].request_id, "req-alpha-2");
  // The next repeat bumps the new open row only.
  await emit("error", SEED[0].msg, { err: new Error("soffice timeout") });
  const after2 = await query<{ count: number }>(`SELECT count FROM error_log WHERE fingerprint = $1 ORDER BY id`, [resolved.fingerprint]);
  assert.deepEqual(after2.map((x) => x.count), [2, 2]);
  // And the list shows both: open filter hides the resolved twin.
  const s = await sessionFor("viewer");
  const open = await list("?resolved=0&q=%5Bpdf%5D%20alpha", s.cookie);
  assert.equal(open.body.items.length, 1);
  const done = await list("?resolved=1&q=%5Bpdf%5D%20alpha", s.cookie);
  assert.equal(done.body.items.length, 1);
  assert.equal(done.body.items[0].id, ids.alpha);
  assert.equal(done.body.items[0].resolvedBy !== null, true);
});

// ───────────────────────────── resolve (bulk)

test("bulk resolve: one audit row with the ids in meta; skips resolved and unknown ids; dedupes", { skip }, async () => {
  const s = await sessionFor("admin");
  const open = await query<{ id: string }>(`SELECT id::text AS id FROM error_log WHERE resolved_at IS NULL ORDER BY id`);
  assert.ok(open.length >= 4, "precondition: several open rows");
  const pick = open.slice(0, 3).map((o) => o.id);
  const alreadyResolved = ids.alpha;
  const unknown = "9223372036854775807";
  const r = await resolveMany({ ids: [...pick, pick[0], Number(pick[1]), alreadyResolved, unknown], reason: "partiya tekshirildi" }, s.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { resolved: 3 });
  const a = await audits(s.admin.adminId);
  assert.equal(a.length, 1, "ONE audit row for the whole batch");
  assert.equal(a[0].action, "errors.resolve");
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_type, "error");
  assert.equal(a[0].target_id, null);
  assert.equal(a[0].reason, "partiya tekshirildi");
  assert.deepEqual(a[0].meta?.resolvedIds, [...pick].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1)));
  assert.deepEqual([...(a[0].meta?.ids as string[])].sort(), [...new Set([...pick, alreadyResolved, unknown])].sort());
  assert.equal(a[0].meta?.resolved, 3);
  const rows = await query<{ resolved_by: string }>(`SELECT resolved_by::text AS resolved_by FROM error_log WHERE id = ANY($1::bigint[])`, [pick]);
  assert.ok(rows.every((x) => x.resolved_by === s.admin.adminId));

  // Nothing left to change: 200 {resolved: 0} and no audit row.
  const again = await resolveMany({ ids: pick }, s.cookie);
  assert.deepEqual(again.body, { resolved: 0 });
  assert.equal((await audits(s.admin.adminId)).length, 1);
});

test("bulk resolve: exactly 100 ids pass, 101 / empty / malformed are 400 and change nothing", { skip }, async () => {
  const s = await sessionFor("owner");
  // 100 real ids (fresh rows through the sink).
  const bulk: string[] = [];
  for (let i = 0; i < 100; i++) {
    await emit("error", `[bulk] row ${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${"abcdefghijklmnopqrstuvwxyz"[Math.floor(i / 26)]} failed`);
  }
  const rows = await query<{ id: string }>(`SELECT id::text AS id FROM error_log WHERE scope = 'bulk' ORDER BY id`);
  assert.equal(rows.length, 100);
  bulk.push(...rows.map((x) => x.id));

  const tooMany = await resolveMany({ ids: [...bulk, "1"] }, s.cookie);
  assert.equal(tooMany.status, 400);
  assert.equal((await query(`SELECT 1 FROM error_log WHERE scope = 'bulk' AND resolved_at IS NOT NULL`)).length, 0);

  for (const body of [{ ids: [] }, {}, { ids: "1" }, { ids: [1, "x"] }, { ids: [0] }, { ids: ["1.5"] }, { ids: [null] }, { ids: [{}] }, { ids: ["9223372036854775808"] }, { ids: [bulk[0]], reason: "abc" }]) {
    const bad = await resolveMany(body, s.cookie);
    assert.equal(bad.status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await audits(s.admin.adminId)).length, 0, "no audit row for rejected requests");

  assert.equal((await resolveMany({ ids: bulk }, s.cookie, null)).status, 403, "Origin mandatory");
  const ok = await resolveMany({ ids: bulk }, s.cookie);
  assert.deepEqual(ok.body, { resolved: 100 });
  const a = await audits(s.admin.adminId);
  assert.equal(a.length, 1);
  assert.equal((a[0].meta?.ids as string[]).length, 100);
});

// ───────────────────────────── permission

test("permission: errors.view — owner, admin, support, viewer 200; finance and moderator 403 with a denied audit row", { skip }, async () => {
  const someId = ids.golf;
  for (const role of ["owner", "admin", "support", "viewer"] as const) {
    const s = await sessionFor(role);
    assert.equal((await list("?limit=1", s.cookie)).status, 200, `list ${role}`);
    assert.equal((await detail(someId, s.cookie)).status, 200, `detail ${role}`);
  }
  for (const role of ["finance", "moderator"] as const) {
    const s = await sessionFor(role);
    for (const [name, r] of [["list", await list("?limit=1", s.cookie)], ["detail", await detail(someId, s.cookie)]] as const) {
      assert.equal(r.status, 403, `${name} ${role}`);
      assert.equal(r.body.code, "forbidden");
      assert.ok(!r.text.includes("message") && !r.text.includes("stack"), "a 403 carries no data");
    }
    const a = await audits(s.admin.adminId);
    assert.equal(a.length, 2);
    assert.ok(a.every((x) => x.outcome === "denied"));
  }
});

test("permission: errors.resolve — owner and admin only; others get 403 and nothing changes", { skip }, async () => {
  await emit("error", "[perm] first open row");
  await emit("error", "[perm] second open row");
  const perm = await query<{ id: string }>(`SELECT id::text AS id FROM error_log WHERE scope = 'perm' ORDER BY id`);
  const [first, second] = perm.map((x) => x.id);
  for (const role of ["support", "viewer", "finance", "moderator"] as const) {
    const s = await sessionFor(role);
    const one = await resolveOne(first, {}, s.cookie);
    const many = await resolveMany({ ids: [first, second] }, s.cookie);
    assert.equal(one.status, 403, `one ${role}`);
    assert.equal(many.status, 403, `bulk ${role}`);
    assert.equal(one.body.code, "forbidden");
    const a = await audits(s.admin.adminId);
    assert.ok(a.length === 2 && a.every((x) => x.outcome === "denied"), `${role}: only denied rows`);
  }
  assert.equal((await query(`SELECT 1 FROM error_log WHERE scope = 'perm' AND resolved_at IS NOT NULL`)).length, 0);
  assert.equal((await resolveOne(first, {}, (await sessionFor("admin")).cookie)).status, 200);
  assert.equal((await resolveMany({ ids: [second] }, (await sessionFor("owner")).cookie)).status, 200);
});

test("guard: no admin session is 401 admin_auth, a user without an admin account is 404 (all five routes)", { skip }, async () => {
  const s = await sessionFor("owner");
  const userOnly = s.cookie.split("; ")[0];
  const calls = (cookie: string | null) => [
    list("", cookie),
    detail(ids.golf, cookie),
    resolveOne(ids.golf, {}, cookie),
    resolveMany({ ids: [ids.golf] }, cookie),
  ];
  for (const r of await Promise.all(calls(userOnly))) {
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "admin_auth");
  }
  for (const r of await Promise.all(calls(null))) assert.equal(r.status, 404);
  assert.equal((await rowOf("100%_literal"))!.resolved_at, null, "nothing was resolved by rejected calls");
});
