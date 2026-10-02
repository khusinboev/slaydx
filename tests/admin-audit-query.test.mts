import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Audit log read side through the REAL routes (docs/admin/02-plan.md §6.12, §7.1 S17, §8)
 * on a throwaway Postgres:
 *   - list: exact item shape (no before / after / meta), admin name/username joined, the role
 *     AT THE TIME of the action, every filter, 400 on bad params, injection is just a literal;
 *   - keyset paging walks rows that share one timestamp exactly once, also across export batches;
 *   - detail: the full row, malformed / unknown ids are 404 (never 500);
 *   - export: owner only + step-up, BOM + header, CSV escaping (formula guard, quotes, newlines),
 *     the same filters as the list, ONE `export.audit` row with `meta.filters`;
 *   - permission: audit.view owner/admin 200, finance/support/viewer 403 (and a `denied` row);
 *     audit.export owner only (admin 403);
 *   - the table really is append-only (the trigger refuses UPDATE / DELETE).
 *
 * Audit rows are inserted with explicit timestamps (the table is append-only, so a
 * seed can never be corrected afterwards); the `auth.denied` rows come from the real
 * handler. Mutation checks are listed in the work-package report.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-audit-test-token-never-called";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const iso = hasDb ? await createIsolatedDb("adminaudit") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { ROLE_RANK, ROLES } = await import("../lib/server/admin-rbac.ts");
const { canManageRole } = await import("../lib/server/admin-rbac.ts");
const rankMirror = await import("../components/admin/admins/shared.ts");
const listRoute = await import("../app/api/admin/audit/route.ts");
const detailRoute = await import("../app/api/admin/audit/[id]/route.ts");
const exportRoute = await import("../app/api/admin/audit/export/route.ts");

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb && iso.isolated) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestAdmin = { id: string; userToken: string; adminId: string; name: string; username: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkAdmin(role: Role, name: string): Promise<TestAdmin> {
  const username = `aud_${randomBytes(5).toString("hex")}`;
  const u = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), username, name],
  );
  const { token } = await createSession(u!.id);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u!.id, role],
  );
  return { id: u!.id, userToken: token, adminId: row!.id, name, username };
}

async function sessionFor(role: Role, opts: { reauth?: boolean; name?: string } = {}): Promise<{ cookie: string; admin: TestAdmin }> {
  const admin = await mkAdmin(role, opts.name ?? `Audit ${role}`);
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(admin.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "audit-test", reauth: opts.reauth ?? true }),
  );
  return { cookie: `${SESSION_COOKIE}=${admin.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

type Res<T = Record<string, unknown>> = { status: number; body: T; text: string; headers: Headers };

async function send<T = Record<string, unknown>>(req: Request, run: () => Promise<Response>): Promise<Res<T>> {
  const res = await inRequest(req, run);
  // Buffer decoding keeps the CSV's BOM, which `res.text()` would strip.
  const text = Buffer.from(await res.arrayBuffer()).toString("utf8");
  let body = {} as T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    /* CSV / non-JSON body */
  }
  return { status: res.status, body, text, headers: res.headers };
}

const baseHeaders = (cookie: string | null): Record<string, string> => {
  const h: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "audit-test" };
  if (cookie) h.cookie = cookie;
  return h;
};

type ListBody = { items: Array<Record<string, unknown>>; nextCursor: string | null; total: number | null; totalCapped: boolean; error?: string; code?: string };

function list(qs: string, cookie: string | null) {
  const req = new Request(`http://localhost:3000/api/admin/audit${qs}`, { headers: baseHeaders(cookie) });
  return send<ListBody>(req, () => listRoute.GET(req, undefined));
}

function detail(id: string, cookie: string | null) {
  const req = new Request(`http://localhost:3000/api/admin/audit/${id}`, { headers: baseHeaders(cookie) });
  return send<{ entry?: Record<string, unknown>; error?: string; code?: string }>(req, () => detailRoute.GET(req, { params: Promise.resolve({ id }) }));
}

function exportCsv(qs: string, cookie: string | null) {
  const req = new Request(`http://localhost:3000/api/admin/audit/export${qs}`, { headers: baseHeaders(cookie) });
  return send<{ error?: string; code?: string }>(req, () => exportRoute.GET(req, undefined));
}

/** Minimal RFC 4180 reader: every cell quoted, quotes doubled, newlines allowed inside a cell. */
function parseCsv(text: string): string[][] {
  assert.equal(text.charCodeAt(0), 0xfeff, "BOM");
  const s = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && s[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

type Ins = {
  at: string;
  adminId?: string | null;
  role?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome?: "ok" | "denied" | "failed";
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string | null;
  ua?: string | null;
  req?: string | null;
};

const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

async function ins(r: Ins): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_audit_log (at, admin_id, actor_role, action, target_type, target_id, outcome, reason, before, after, meta, ip, user_agent, request_id)
     VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14) RETURNING id::text AS id`,
    [r.at, r.adminId ?? null, r.role ?? null, r.action, r.targetType ?? null, r.targetId ?? null, r.outcome ?? "ok", r.reason ?? null, j(r.before), j(r.after), j(r.meta), r.ip ?? null, r.ua ?? null, r.req ?? null],
  );
  return row!.id;
}

const auditCount = async () => Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM admin_audit_log`))!.n);

// ───────────────────────────── seed

const S: {
  owner: { cookie: string; admin: TestAdmin };
  boss: { cookie: string; admin: TestAdmin };
  ids: Record<string, string>;
  tieIds: string[];
  baseline: number;
} = { ids: {}, tieIds: [] } as never;

const TIE_AT = "2026-03-10T10:00:00.000Z";

test("seed: owner + admin accounts and audit rows (equal timestamps, formula reason, system row)", { skip }, async () => {
  S.owner = await sessionFor("owner", { name: "Egasi Test" });
  S.boss = await sessionFor("admin", { name: "Admin Test" });
  const o = S.owner.admin.adminId;
  const a = S.boss.admin.adminId;

  // Seven rows share ONE timestamp: only `id` separates them (keyset tie-break).
  for (let i = 0; i < 7; i++) {
    S.tieIds.push(await ins({ at: TIE_AT, adminId: o, role: "owner", action: "users.wallet.adjust", targetType: "user", targetId: `42`, reason: `tie row ${i} reason`, meta: { n: i } }));
  }
  const I = S.ids;
  I.block = await ins({
    at: "2026-03-09T08:00:00.000Z", adminId: a, role: "admin", action: "users.block", targetType: "user", targetId: "77", reason: "spam akkaunt, qayta-qayta",
    before: { is_blocked: false }, after: { is_blocked: true }, ip: "10.9.9.9", ua: "Mozilla/5.0 test", req: "req-block-1",
  });
  I.setting = await ins({
    at: "2026-03-09T09:00:00.000Z", adminId: o, role: "owner", action: "settings.update", targetType: "setting", targetId: "free_llm.disabled", reason: "kill switch",
    before: { value: false, source: "env" }, after: { value: true, source: "db" },
  });
  I.denied = await ins({ at: "2026-03-09T09:30:00.000Z", adminId: a, role: "admin", action: "auth.denied", outcome: "denied", meta: { permission: "audit.export", scope: "admin/audit/export" } });
  I.failed = await ins({ at: "2026-03-08T07:00:00.000Z", adminId: a, role: "admin", action: "auth.login_failed", targetType: "admin", targetId: a, outcome: "failed", meta: { flow: "totp" }, ip: "10.8.8.8" });
  // CLI / system: no admin at all.
  I.system = await ins({ at: "2026-03-07T06:00:00.000Z", action: "admins.create", targetType: "admin", targetId: o, reason: "CLI bootstrap", after: { role: "owner" }, meta: { via: "cli" } });
  // CSV hazards: formula, quotes, comma, newline, tab-led and a LIKE-metacharacter action.
  I.formula = await ins({ at: "2026-03-06T05:00:00.000Z", adminId: o, role: "owner", action: "settings.reset", targetType: "setting", targetId: "=HYPERLINK(\"http://x\")", reason: "=cmd|' /C calc'!A0" });
  I.csv = await ins({ at: "2026-03-05T05:00:00.000Z", adminId: o, role: "owner", action: "orders.note", targetType: "order", targetId: "0b3a2f6e-1111-4222-8333-444455556666", reason: 'say "hi", then\nnew line', before: { note: "a,b" } });
  I.pct = await ins({ at: "2026-03-04T05:00:00.000Z", adminId: o, role: "owner", action: "tool_100%_off", targetType: "setting", targetId: "x" });
  // Boundary: 2026-03-10 19:30Z is already 2026-03-11 00:30 in Tashkent.
  I.late = await ins({ at: "2026-03-10T19:30:00.000Z", adminId: o, role: "owner", action: "jobs.cancel", targetType: "generation", targetId: "11111111-2222-4333-8444-555566667777", reason: "kech soat" });
  S.baseline = await auditCount();
  assert.ok(S.baseline >= 16);
});

const idsOf = (r: Res<ListBody>) => r.body.items.map((i) => i.id as string);
/** The seeded rows only (the fixtures' own sessions never write audit rows; denied ones are counted separately). */

// ───────────────────────────── list

const ITEM_KEYS = ["action", "actorRole", "adminId", "adminName", "adminUsername", "at", "id", "ip", "outcome", "reason", "targetId", "targetType"];

test("list: exact item shape without before / after / meta, admin joined, newest first", { skip }, async () => {
  const r = await list("", S.owner.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["items", "nextCursor", "total", "totalCapped"]);
  assert.equal(r.body.total, S.baseline);
  assert.equal(r.body.totalCapped, false);
  for (const it of r.body.items) assert.deepEqual(Object.keys(it).sort(), ITEM_KEYS);
  for (const hidden of ['"before"', '"after"', '"meta"', '"userAgent"', '"requestId"']) assert.ok(!r.text.includes(hidden), `${hidden} never in the list`);

  const ats = r.body.items.map((i) => Date.parse(i.at as string));
  assert.deepEqual([...ats].sort((x, y) => y - x), ats, "newest first");
  assert.equal(r.body.items[0].id, S.ids.late);

  const block = r.body.items.find((i) => i.id === S.ids.block)!;
  assert.equal(block.adminName, "Admin Test");
  assert.equal(block.adminUsername, S.boss.admin.username);
  assert.equal(block.adminId, S.boss.admin.adminId);
  assert.equal(block.actorRole, "admin");
  assert.equal(block.action, "users.block");
  assert.equal(block.targetType, "user");
  assert.equal(block.targetId, "77");
  assert.equal(block.outcome, "ok");
  assert.equal(block.reason, "spam akkaunt, qayta-qayta");
  assert.equal(block.ip, "10.9.9.9");
  assert.equal(block.at, "2026-03-09T08:00:00.000Z");

  const sys = r.body.items.find((i) => i.id === S.ids.system)!;
  assert.equal(sys.adminId, null);
  assert.equal(sys.adminName, null);
  assert.equal(sys.adminUsername, null);
  assert.equal(sys.actorRole, null);
});

test("list: the role is the one AT THE TIME, not the admin's current role", { skip }, async () => {
  const s = await sessionFor("support", { name: "Rol Almashdi" });
  const id = await ins({ at: "2026-03-01T01:00:00.000Z", adminId: s.admin.adminId, role: "support", action: "users.message", targetType: "user", targetId: "5" });
  S.ids.message = id;
  await query(`UPDATE admin_accounts SET role = 'moderator' WHERE id = $1`, [s.admin.adminId]);
  const r = await list(`?adminId=${s.admin.adminId}&action=users.message`, S.owner.cookie);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(idsOf(r), [id]);
  assert.equal(r.body.items[0].actorRole, "support", "history is not rewritten by the role change");
  S.baseline += 1;
});

test("list: keyset paging walks rows that share one timestamp exactly once, in id order", { skip }, async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r: Res<ListBody> = await list(`?action=users.wallet.adjust&limit=2${cursor ? `&cursor=${cursor}` : ""}`, S.owner.cookie);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.items.length <= 2);
    assert.equal(r.body.total, 7, "total is the filtered count on every page");
    seen.push(...idsOf(r));
    cursor = r.body.nextCursor;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 4, "7 rows / 2 per page");
  assert.deepEqual(seen, [...S.tieIds].reverse(), "all seven, no duplicate, no gap, id descending");

  // The whole log in pages of 3 equals the unpaged order.
  const all = idsOf(await list("?limit=100", S.owner.cookie));
  const paged: string[] = [];
  cursor = null;
  do {
    const r: Res<ListBody> = await list(`?limit=3${cursor ? `&cursor=${cursor}` : ""}`, S.owner.cookie);
    paged.push(...idsOf(r));
    cursor = r.body.nextCursor;
  } while (cursor);
  assert.deepEqual(paged, all);
  assert.equal(new Set(paged).size, paged.length);
});

test("list: filters adminId, action prefix, targetType, targetId, outcome, date range, and their combination", { skip }, async () => {
  const want = (...keys: string[]) => keys.map((k) => S.ids[k]).sort();
  const sorted = (r: Res<ListBody>) => idsOf(r).sort();

  assert.deepEqual(sorted(await list(`?adminId=${S.boss.admin.adminId}`, S.owner.cookie)), want("block", "denied", "failed"));
  assert.deepEqual(sorted(await list(`?adminId=${S.boss.admin.adminId}&outcome=ok`, S.owner.cookie)), want("block"));
  assert.deepEqual(sorted(await list("?outcome=denied", S.owner.cookie)), want("denied"));
  assert.deepEqual(sorted(await list("?outcome=failed", S.owner.cookie)), want("failed"));
  assert.deepEqual(sorted(await list("?adminId=999999", S.owner.cookie)), [], "unknown admin: empty, not an error");

  // action = PREFIX, case-sensitive; metacharacters are literal.
  assert.deepEqual(sorted(await list("?action=users.block", S.owner.cookie)), want("block"));
  assert.deepEqual(sorted(await list("?action=users.", S.owner.cookie)), [...S.tieIds, S.ids.block, S.ids.message].sort(), "users.* = 7 tie rows + block + message");
  assert.deepEqual(sorted(await list("?action=block", S.owner.cookie)), [], "a prefix, not a substring");
  assert.deepEqual(sorted(await list("?action=USERS.", S.owner.cookie)), [], "case-sensitive");
  assert.deepEqual(sorted(await list("?action=tool_100%25", S.owner.cookie)), want("pct"), "% and _ are literal");
  assert.deepEqual(sorted(await list("?action=%25", S.owner.cookie)), [], "a bare % does not match everything");
  assert.deepEqual(sorted(await list("?action=_", S.owner.cookie)), []);

  assert.deepEqual(sorted(await list("?targetType=setting", S.owner.cookie)), want("setting", "formula", "pct"));
  assert.deepEqual(sorted(await list("?targetType=user&targetId=77", S.owner.cookie)), want("block"));
  assert.deepEqual(sorted(await list("?targetId=free_llm.disabled", S.owner.cookie)), want("setting"), "targetId alone is exact");
  assert.deepEqual(sorted(await list("?targetId=free_llm", S.owner.cookie)), [], "targetId is exact, not a prefix");
  assert.deepEqual(sorted(await list("?targetType=USER", S.owner.cookie)), [], "targetType is exact");
  assert.deepEqual(sorted(await list(`?targetType=admin&targetId=${S.boss.admin.adminId}`, S.owner.cookie)), want("failed"));

  // Date range = Asia/Tashkent calendar days, `to` inclusive.
  assert.deepEqual(sorted(await list("?from=2026-03-09&to=2026-03-09", S.owner.cookie)), want("block", "setting", "denied"));
  assert.deepEqual(sorted(await list("?from=2026-03-11&to=2026-03-11", S.owner.cookie)), want("late"), "19:30Z on the 10th is the 11th in Tashkent");
  const tenth = await list("?from=2026-03-10&to=2026-03-10", S.owner.cookie);
  assert.deepEqual(sorted(tenth), [...S.tieIds].sort(), "the tie rows (15:00 Tashkent) and not the 00:30 one");
  assert.deepEqual(sorted(await list("?from=2020-01-01&to=2020-01-31", S.owner.cookie)), []);

  // combined
  assert.deepEqual(sorted(await list(`?adminId=${S.owner.admin.adminId}&targetType=setting&action=settings.&from=2026-03-06&to=2026-03-09`, S.owner.cookie)), want("setting", "formula"));
});

test("list: 400 on every bad parameter, injection attempts are literal searches (never 500)", { skip }, async () => {
  const before = await auditCount();
  const bad = [
    "?outcome=OK", "?outcome=ok,denied", "?outcome=maybe", "?limit=0", "?limit=101", "?limit=abc", "?sort=action", "?sort=at_desc;DROP%20TABLE%20admin_audit_log",
    "?sort=__proto__", "?cursor=garbage", `?cursor=${Buffer.from(JSON.stringify(["x", "y"])).toString("base64url")}`,
    "?from=2026-02-30", "?from=yesterday", "?to=2026-13-01", "?from=2026-03-02&to=2026-03-01", "?from=2024-01-01&to=2026-01-01",
    "?adminId=abc", "?adminId=0", "?adminId=-1", "?adminId=1.5", "?adminId=1%20OR%201=1", "?adminId=9223372036854775808", "?adminId=1&adminId=2",
    `?action=${"a".repeat(101)}`, `?targetType=${"t".repeat(65)}`, `?targetId=${"i".repeat(201)}`,
    "?action=a&action=b", "?targetType=a&targetType=b", "?targetId=a&targetId=b", "?action=a%00b", "?targetType=a%00b", "?targetId=a%00b", "?outcome=ok&outcome=denied",
  ];
  for (const qs of bad) {
    const r = await list(qs, S.owner.cookie);
    assert.equal(r.status, 400, `${qs} → ${r.status} ${r.text.slice(0, 120)}`);
    assert.equal(typeof r.body.error, "string");
  }
  for (const payload of ["'; DROP TABLE admin_audit_log; --", "' OR '1'='1", "\\", "%27%20OR%201=1", "x') UNION SELECT 1 --"]) {
    for (const key of ["action", "targetType", "targetId"]) {
      const r = await list(`?${key}=${encodeURIComponent(payload)}`, S.owner.cookie);
      assert.equal(r.status, 200, `${key}=${payload}`);
      assert.equal(r.body.items.length, 0, `${key}=${payload}`);
    }
  }
  assert.equal(await auditCount(), before, "table intact (and no list ever writes)");
});

// ───────────────────────────── detail

test("detail: full row with before / after / meta / user agent / request id; bad and unknown ids are 404", { skip }, async () => {
  const r = await detail(S.ids.block, S.boss.cookie);
  assert.equal(r.status, 200, r.text);
  const e = r.body.entry!;
  assert.deepEqual(Object.keys(e).sort(), [...ITEM_KEYS, "actorUserId", "before", "after", "meta", "requestId", "userAgent"].sort());
  assert.equal(e.id, S.ids.block);
  assert.deepEqual(e.before, { is_blocked: false });
  assert.deepEqual(e.after, { is_blocked: true });
  assert.equal(e.meta, null);
  assert.equal(e.userAgent, "Mozilla/5.0 test");
  assert.equal(e.requestId, "req-block-1");
  assert.equal(e.adminName, "Admin Test");

  const d = await detail(S.ids.denied, S.owner.cookie);
  assert.deepEqual((d.body.entry as Record<string, unknown>).meta, { permission: "audit.export", scope: "admin/audit/export" });
  assert.equal((d.body.entry as Record<string, unknown>).before, null);

  for (const id of ["0", "-1", "abc", "1.5", "01", "9999999999999999999999", "9223372036854775808", "1%20OR%201=1", "%00"]) {
    const bad = await detail(id, S.owner.cookie);
    assert.equal(bad.status, 404, `${id} → ${bad.status}`);
    assert.equal(bad.body.code, "not_found");
  }
  const none = await detail("9223372036854775807", S.owner.cookie);
  assert.equal(none.status, 404);
  assert.equal(none.body.code, "not_found");
});

// ───────────────────────────── permissions

test("permission: audit.view owner/admin only; finance, support, moderator, viewer get 403 and a denied row", { skip }, async () => {
  assert.equal((await list("", S.owner.cookie)).status, 200);
  assert.equal((await list("", S.boss.cookie)).status, 200);
  assert.equal((await detail(S.ids.block, S.boss.cookie)).status, 200);
  for (const role of ["finance", "support", "moderator", "viewer"] as const) {
    const s = await sessionFor(role);
    const r = await list("", s.cookie);
    assert.equal(r.status, 403, role);
    assert.equal(r.body.code, "forbidden");
    assert.equal((await detail(S.ids.block, s.cookie)).status, 403, role);
    const denied = await query<{ outcome: string; meta: { permission: string } }>(
      `SELECT outcome, meta FROM admin_audit_log WHERE admin_id = $1 ORDER BY id`,
      [s.admin.adminId],
    );
    assert.equal(denied.length, 2, `${role}: one denied row per refused call`);
    assert.ok(denied.every((d) => d.outcome === "denied" && d.meta.permission === "audit.view"));
  }
  // No session at all: not an admin → 404 cloak.
  assert.equal((await list("", null)).status, 404);
  S.baseline = await auditCount();
});

test("permission: the real denied rows show up in the list with role at the time", { skip }, async () => {
  const r = await list("?action=auth.denied&outcome=denied&limit=100", S.owner.cookie);
  assert.equal(r.status, 200, r.text);
  const roles = new Set(r.body.items.map((i) => i.actorRole));
  for (const role of ["finance", "support", "moderator", "viewer"]) assert.ok(roles.has(role), `${role} denied row is listed`);
});

// ───────────────────────────── export

test("export: owner only — an admin gets 403 and a denied row; a stale step-up is 401 reauth, nothing exported", { skip }, async () => {
  const before = await auditCount();
  const r = await exportCsv("", S.boss.cookie);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "forbidden");
  const denied = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM admin_audit_log WHERE admin_id = $1 AND outcome = 'denied' AND meta->>'permission' = 'audit.export'`,
    [S.boss.admin.adminId],
  );
  assert.equal(denied!.n, "2", "seeded denied row + this one");
  assert.equal(await auditCount(), before + 1, "only the denied row was added");

  const stale = await sessionFor("owner", { reauth: false });
  const re = await exportCsv("", stale.cookie);
  assert.equal(re.status, 401);
  assert.equal(re.body.code, "reauth");
  const none = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM admin_audit_log WHERE action = 'export.audit' AND admin_id = $1`, [stale.admin.adminId]);
  assert.equal(none!.n, "0");
  S.baseline = await auditCount();
});

test("export: BOM, header, escaped cells, same filters as the list, ONE export.audit row with meta.filters", { skip }, async () => {
  const owner = await sessionFor("owner", { name: "Eksport Egasi" });
  const r = await exportCsv("", owner.cookie);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.headers.get("content-type") ?? "", /^text\/csv; charset=utf-8/);
  assert.match(r.headers.get("content-disposition") ?? "", /^attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");

  const rows = parseCsv(r.text);
  const header = rows[0];
  assert.deepEqual(header, ["id", "at", "at_utc", "admin_id", "admin_name", "admin_username", "actor_user_id", "actor_role", "action", "target_type", "target_id", "outcome", "reason", "ip", "user_agent", "request_id", "before", "after", "meta"]);
  assert.ok(rows.slice(1).every((c) => c.length === header.length), "every row has every column");
  // The export row is written BEFORE the first byte, so the file contains it too.
  assert.equal(rows.length - 1, S.baseline + 1);
  const col = (name: string) => header.indexOf(name);

  const formula = rows.find((c) => c[col("id")] === S.ids.formula)!;
  assert.equal(formula[col("reason")], "'=cmd|' /C calc'!A0", "formula guard on reason");
  assert.equal(formula[col("target_id")], `'=HYPERLINK("http://x")`, "formula guard on target_id, quotes survive");
  assert.ok(!/,"=/.test(r.text), "no raw formula cell");
  const csv = rows.find((c) => c[col("id")] === S.ids.csv)!;
  assert.equal(csv[col("reason")], 'say "hi", then\nnew line', "quotes, comma and newline round-trip");
  assert.equal(csv[col("before")], '{"note":"a,b"}');
  assert.equal(csv[col("at")], "05.03.2026 10:00:00", "Tashkent time with seconds");
  assert.equal(csv[col("at_utc")], "2026-03-05T05:00:00.000Z");
  const block = rows.find((c) => c[col("id")] === S.ids.block)!;
  assert.equal(block[col("admin_name")], "Admin Test");
  assert.equal(block[col("actor_role")], "admin");
  assert.equal(block[col("user_agent")], "Mozilla/5.0 test");
  assert.equal(block[col("request_id")], "req-block-1");
  assert.equal(block[col("after")], '{"is_blocked":true}');
  const sys = rows.find((c) => c[col("id")] === S.ids.system)!;
  assert.equal(sys[col("admin_id")], "");
  assert.equal(sys[col("meta")], '{"via":"cli"}');

  const a = await query<{ outcome: string; target_type: string; meta: unknown; reason: string | null }>(
    `SELECT outcome, target_type, meta, reason FROM admin_audit_log WHERE action = 'export.audit' AND admin_id = $1`,
    [owner.admin.adminId],
  );
  assert.equal(a.length, 1);
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_type, "audit_log");
  assert.deepEqual(a[0].meta, { filters: {} });

  // Filtered export: same filters as the list, recorded in meta.filters.
  const qs = `?adminId=${S.boss.admin.adminId}&outcome=ok&action=users.&from=2026-03-09&to=2026-03-09&targetType=user&targetId=77`;
  const f = await exportCsv(qs, owner.cookie);
  assert.equal(f.status, 200);
  const frows = parseCsv(f.text);
  assert.equal(frows.length, 2);
  assert.equal(frows[1][col("id")], S.ids.block);
  const fl = await list(qs, owner.cookie);
  assert.deepEqual(idsOf(fl), [S.ids.block]);
  const a2 = await query<{ meta: unknown }>(`SELECT meta FROM admin_audit_log WHERE action = 'export.audit' AND admin_id = $1 ORDER BY id`, [owner.admin.adminId]);
  assert.equal(a2.length, 2);
  assert.deepEqual(a2[1].meta, {
    filters: { adminId: S.boss.admin.adminId, action: "users.", targetType: "user", targetId: "77", outcome: "ok", from: "2026-03-09", to: "2026-03-09" },
  });

  // A rejected export is not audited.
  const bad = await exportCsv("?outcome=bogus", owner.cookie);
  assert.equal(bad.status, 400);
  assert.equal((await query(`SELECT 1 FROM admin_audit_log WHERE action = 'export.audit' AND admin_id = $1`, [owner.admin.adminId])).length, 2);
  S.baseline = await auditCount();
});

test("export: batches of 1 000 cover thousands of rows with equal timestamps exactly once", { skip }, async () => {
  await query(
    `INSERT INTO admin_audit_log (at, admin_id, actor_role, action, target_type, target_id, outcome)
     SELECT '2026-02-01T00:00:00Z'::timestamptz, $1::bigint, 'owner', 'bulk.row', 'bulk', g::text, 'ok' FROM generate_series(1, 2300) g`,
    [S.owner.admin.adminId],
  );
  const owner = await sessionFor("owner", { name: "Ommaviy Egasi" });
  const r = await exportCsv("?action=bulk.row", owner.cookie);
  assert.equal(r.status, 200);
  const rows = parseCsv(r.text);
  assert.equal(rows.length - 1, 2300);
  const targets = rows.slice(1).map((c) => c[10]);
  assert.equal(new Set(targets).size, 2300, "no duplicates across the 3 batches");
  const l = await list("?action=bulk.row&limit=1", S.owner.cookie);
  assert.equal(l.body.total, 2300);
  S.baseline = await auditCount();
});

// ───────────────────────────── invariants

test("append-only: the trigger refuses UPDATE and DELETE (this module never writes either)", { skip }, async () => {
  await assert.rejects(query(`UPDATE admin_audit_log SET reason = 'x' WHERE id = $1`, [S.ids.block]), /append-only/);
  await assert.rejects(query(`DELETE FROM admin_audit_log WHERE id = $1`, [S.ids.block]), /append-only/);
  const row = await queryOne<{ reason: string }>(`SELECT reason FROM admin_audit_log WHERE id = $1`, [S.ids.block]);
  assert.equal(row!.reason, "spam akkaunt, qayta-qayta");
});

test("the client rank table mirrors the server's ROLE_RANK (UI shows only what the server would accept)", () => {
  assert.deepEqual(Object.keys(rankMirror.ROLE_RANK).sort(), [...ROLES].sort());
  for (const role of ROLES) assert.equal(rankMirror.ROLE_RANK[role], ROLE_RANK[role], role);
  assert.deepEqual([...rankMirror.ROLE_ORDER], [...ROLES]);
  // Every actor × target pair agrees with the server's rule (admins.manage + strictly lower rank, owner → owner).
  for (const actor of ROLES) {
    for (const target of ROLES) assert.equal(rankMirror.canManageRole(actor, target), canManageRole(actor, target), `${actor} → ${target}`);
  }
});
