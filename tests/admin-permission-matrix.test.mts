import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Permission matrix, end to end (docs/admin/02-plan.md §4.3, §4.4, §11 "permission
 * matrix" row): every `app/api/admin/**\/route.ts` method is discovered from the
 * source (never hand-listed), its literal `permission` is extracted the way
 * `admin-route-guard` does it, and the REAL exported handler is called inside a
 * Next request context for every role, on a throwaway Postgres:
 *   • a role without the permission → exactly 403 `forbidden` and exactly one
 *     `auth.denied` audit row (per call);
 *   • a role with it → never 403 `forbidden`, 401 or the 404 cloak (a validation
 *     400, a coded `not_found` 404 or a 409 for the minimal request are fine);
 *   • non-admins, anonymous callers and disabled accounts → 404 everywhere;
 *   • stale step-up → 401 `reauth` on every route of every S permission;
 *   • a mutation without (or with a foreign) `Origin` → 403;
 *   • expired / revoked admin sessions → 401 `admin_auth`;
 *   • the code matrix equals the §4.3 table, transcribed here as a literal AND
 *     parsed from the plan file, so a drift in either direction fails;
 *   • all of the above in BOTH positions of the 2FA switch (`MODES`): the
 *     refused set is identical, and with the switch off a stale step-up is
 *     simply "no reauth needed" (HANDOFF "Admin 2FA switch").
 *
 * `fetch` is stubbed for the whole file: nothing leaves the process, and the
 * last test asserts no route tried to reach an external host.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - `GRANTS["audit.view"]` widened to every role → the §4.3 equality test,
 *     the matrix test (finance/support/moderator/viewer got 200 on audit/list
 *     and 404 not_found on audit/[id] where 403 forbidden was expected) and
 *     both denied-audit counts failed;
 *   - `permission: "jobs.view"` on generations/export → the least-privilege
 *     shape test ("an export path must use a *.export permission") and the
 *     step-up coverage count (9 routed S permissions instead of 10);
 *   - `STEP_UP` without "settings.edit" → the §4.3 equality test
 *     ("settings.edit step-up: code=false plan=true") and the step-up test
 *     (404 not_found instead of 401 reauth for the stale owner/admin on
 *     settings/[key] PUT and DELETE);
 *   - `writeDeniedAudit` call removed from `adminHandler` → the per-role
 *     denied-audit test (zero rows where one per refused call was expected)
 *     and the total count.
 */

/**
 * Enforcement bugs found by this file that the lead resolves before merge.
 * Each entry is `"<rel route> <METHOD> <role>"`; the assertion still FAILS —
 * the list only labels the failure as already reported. Keep it empty.
 */
const KNOWN_BUGS: readonly string[] = [];

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
// 2FA-mode suite: the strengthened flow (TOTP, step-up) is what these tests pin (docs/admin/HANDOFF.md "Admin 2FA switch").
process.env.ADMIN_2FA_REQUIRED = "true";
// The bot "sends" through the fetch stub below; nothing leaves the process.
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-permission-matrix-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("permmatrix") : { isolated: false, drop: async () => {} };

// ───────────────────────────── fetch stub (installed before any lib import)

const fetchCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
  return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const rbac = await import("../lib/server/admin-rbac.ts");
// The matrix fires every method × role within one minute — far more refused
// calls per admin than the production denied-call budget (30 / 60 s, Phase 4
// finding 1). The budget itself is tested in admin-auth.test.mts; here it is
// raised so every refused call still yields its 403 and one `denied` row.
const { DENIED_RATE } = await import("../lib/server/admin-handler.ts");
DENIED_RATE.limit = 100_000;
const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

/** `pricing/[toolId]` segment: a real tool id from the registry (plan §17.5), never a fake. */
const PRICING_TOOL_ID = "essay";
assert.ok(PRICING_TOOL_ID in TOOL_BY_ID, `${PRICING_TOOL_ID} is not in the tool registry`);

type Role = (typeof rbac.ROLES)[number];
type Permission = (typeof rbac.PERMISSIONS)[number];
const ROLES: readonly Role[] = rbac.ROLES;

// ───────────────────────────── the 2FA switch

/**
 * Both positions of `ADMIN_2FA_REQUIRED` (docs/admin/HANDOFF.md "Admin 2FA
 * switch"). The RBAC matrix, the denied audit, the cloak, the Origin rule and
 * the session binding must be identical in both; only step-up differs: with
 * the switch off no route ever answers 401 reauth. `env.admin2faRequired` is a
 * getter, so flipping the variable between tests re-modes the same handlers.
 */
const MODES = [
  { name: "2fa", flag: "true", stepUp: true },
  { name: "simple", flag: "false", stepUp: false },
] as const;
type Mode = (typeof MODES)[number];
type ModeName = Mode["name"];

let currentMode: Mode = MODES[0];

function setMode(mode: Mode): void {
  currentMode = mode;
  process.env.ADMIN_2FA_REQUIRED = mode.flag;
}

after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures (admin-auth / admin-wallet pattern)

type TestUser = { id: string; userToken: string };
type Session = { id: string; token: string };
type SeededAdmin = TestUser & {
  role: Role;
  adminId: string;
  /** `reauth: true` at creation — step-up is fresh. */
  fresh: Session;
  /** `reauth: false` — step-up permissions must answer 401 reauth. */
  stale: Session;
  /** A second live session per mode, the target of `me/sessions/[id]/revoke` (consumed by the call). */
  spare: Record<ModeName, Session>;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const freshIp = () => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;

async function mkUser(): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, 'Matrix Test') RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `pm_${randomBytes(5).toString("hex")}`],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function mkAccount(u: TestUser, role: Role, status: "active" | "disabled" = "active"): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, $3, now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role, status],
  );
  return row!.id;
}

async function openSession(u: TestUser, adminId: string, reauth: boolean): Promise<Session> {
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "permission-matrix-test", reauth }),
  );
  return { id: s.id, token: s.token };
}

function cookieOf(u: TestUser | null, s?: Session | null): string | null {
  if (!u) return null;
  const parts = [`${SESSION_COOKIE}=${u.userToken}`];
  if (s) parts.push(`${adminCookieName()}=${s.token}`);
  return parts.join("; ");
}

async function seedAdmin(role: Role): Promise<SeededAdmin> {
  const u = await mkUser();
  const adminId = await mkAccount(u, role);
  return {
    ...u,
    role,
    adminId,
    fresh: await openSession(u, adminId, true),
    stale: await openSession(u, adminId, false),
    spare: { "2fa": await openSession(u, adminId, true), simple: await openSession(u, adminId, true) },
  };
}

type Seed = {
  admins: Record<Role, SeededAdmin>;
  /** The subject of `users/[id]/**` calls (never a caller). */
  targetUser: TestUser;
  /** A logged-in user without an admin account (the 404 cloak subject). */
  plainUser: TestUser;
  /** An extra, never-calling active admin: the subject of `admins/[id]/**` calls. */
  targetAdmin: { user: TestUser; adminId: string };
  disabled: { user: TestUser; session: Session };
  expired: Session;
  revoked: Session;
};

async function seedAll(): Promise<Seed> {
  const admins = {} as Record<Role, SeededAdmin>;
  for (const role of ROLES) admins[role] = await seedAdmin(role);
  const targetUser = await mkUser();
  const plainUser = await mkUser();
  const tu = await mkUser();
  const targetAdmin = { user: tu, adminId: await mkAccount(tu, "viewer") };
  const du = await mkUser();
  const disabledId = await mkAccount(du, "owner", "disabled");
  const disabled = { user: du, session: await openSession(du, disabledId, true) };
  const owner = admins.owner;
  const expired = await openSession(owner, owner.adminId, true);
  await query(`UPDATE admin_sessions SET idle_expires_at = now() - interval '1 minute' WHERE id = $1`, [expired.id]);
  const revoked = await openSession(owner, owner.adminId, true);
  await query(`UPDATE admin_sessions SET revoked_at = now(), revoke_reason = 'test' WHERE id = $1`, [revoked.id]);
  return { admins, targetUser, plainUser, targetAdmin, disabled, expired, revoked };
}

// Seeded BEFORE the first `test()`: node:test ends the file once the declared tests finish,
// so a top-level await after a declaration would race the `after` hook (pool closed).
const seed: Seed | null = hasDb ? await seedAll() : null;

// ───────────────────────────── route manifest (generated from the source tree)

const ROOT = resolve(import.meta.dirname, "..");
const ADMIN_API = join(ROOT, "app/api/admin");
type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
type RouteFn = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

type Entry = {
  /** e.g. `users/[id]/block/route.ts` */
  rel: string;
  /** e.g. `/api/admin/users/[id]/block` */
  path: string;
  method: Method;
  kind: "admin" | "auth";
  scope: string;
  /** `null` only for `adminAuthHandler` routes (§6.1). */
  permission: Permission | null;
  mutation: boolean;
  fn: RouteFn;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/** Source of each exported method: from `export const M =` to the next top-level `export`. */
function methodSources(src: string): Map<Method, string> {
  const out = new Map<Method, string>();
  const re = /^export const (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s*=/gm;
  const starts = [...src.matchAll(re)].map((m) => ({ method: m[1] as Method, index: m.index! }));
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!.index;
    const nextExport = src.slice(from + 1).search(/^export /m);
    const to = nextExport >= 0 ? from + 1 + nextExport : src.length;
    out.set(starts[i]!.method, src.slice(from, to));
  }
  return out;
}

async function buildManifest(): Promise<{ entries: Entry[]; problems: string[] }> {
  const entries: Entry[] = [];
  const problems: string[] = [];
  for (const abs of walk(ADMIN_API).sort()) {
    const rel = relative(ADMIN_API, abs).split("\\").join("/");
    const path = `/api/admin/${rel.replace(/\/?route\.ts$/, "")}`.replace(/\/$/, "");
    const src = readFileSync(abs, "utf8");
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    const methods = methodSources(src);
    if (!methods.size) problems.push(`${rel}: no exported HTTP method`);
    for (const [method, body] of methods) {
      const where = `${rel} ${method}`;
      const fn = mod[method];
      if (typeof fn !== "function") {
        problems.push(`${where}: export is not a function`);
        continue;
      }
      const admin = body.match(/^export const \w+\s*=\s*adminHandler(?:<[^>]*>)?\(\s*"([^"]+)"\s*,\s*\{([^}]*)\}/);
      const auth = body.match(/^export const \w+\s*=\s*adminAuthHandler(?:<[^>]*>)?\(\s*"([^"]+)"\s*,\s*\{([^}]*)\}/);
      if (admin) {
        const [, scope, opts] = admin;
        const perm = opts!.match(/(?:^|[\s,{])permission:\s*"([^"]+)"/)?.[1];
        if (!perm || !rbac.isPermission(perm)) {
          problems.push(`${where}: permission cannot be determined (${perm ?? "no literal"})`);
          continue;
        }
        entries.push({ rel, path, method, kind: "admin", scope: scope!, permission: perm, mutation: /mutation:\s*true/.test(opts!), fn: fn as RouteFn });
      } else if (auth) {
        const [, scope, opts] = auth;
        entries.push({ rel, path, method, kind: "auth", scope: scope!, permission: null, mutation: /mutation:\s*true/.test(opts!), fn: fn as RouteFn });
      } else {
        problems.push(`${where}: not an adminHandler/adminAuthHandler call with a literal options object`);
      }
    }
  }
  return { entries, problems };
}

const manifest = await buildManifest();
const ENTRIES = manifest.entries;
const ADMIN_ENTRIES = ENTRIES.filter((e) => e.kind === "admin");
const MUTATIONS = ENTRIES.filter((e) => e.mutation);

test("manifest: every exported method of every admin route has a determinable guard", () => {
  assert.deepEqual(manifest.problems, []);
  // Not vacuous: the F2 routes and several later packages are present.
  const rels = new Set(ENTRIES.map((e) => `${e.rel} ${e.method}`));
  for (const expected of [
    "session/route.ts GET",
    "session/route.ts DELETE",
    "auth/login/route.ts POST",
    "auth/reauth/route.ts POST",
    "admins/route.ts POST",
    "users/[id]/block/route.ts POST",
    "users/[id]/wallet-adjustments/route.ts POST",
    "generations/export/route.ts GET",
    "settings/[key]/route.ts PUT",
    "audit/export/route.ts GET",
  ]) {
    assert.ok(rels.has(expected), `manifest misses ${expected}`);
  }
  assert.ok(ADMIN_ENTRIES.length >= 60, `only ${ADMIN_ENTRIES.length} adminHandler methods found`);
  for (const e of ENTRIES) {
    assert.ok(e.scope.startsWith("admin/"), `${e.rel} ${e.method}: scope ${e.scope}`);
    if (e.method !== "GET" && e.method !== "HEAD") assert.equal(e.mutation, true, `${e.rel} ${e.method}: mutation: true missing`);
  }
  // Auth routes (§6.1) plus the simple-mode entry are the only adminAuthHandler users.
  assert.deepEqual(
    [...new Set(ENTRIES.filter((e) => e.kind === "auth").map((e) => e.rel))].sort(),
    ["auth/auto/route.ts", "auth/enroll/route.ts", "auth/login/route.ts", "auth/recovery/route.ts", "session/route.ts"],
  );
});

/**
 * Least-privilege shape (§4.2 naming): a route is self-consistent with whatever
 * literal it declares, so the matrix alone cannot see a route guarded by the
 * WRONG permission. These rules can: the permission's namespace must match the
 * path family, an export path must use `*.export`, a mutation never a `*.view`,
 * and a read uses a step-up permission only when it is an export.
 */
const PATH_FAMILIES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/^users\//, ["users"]],
  [/^generations\//, ["jobs"]],
  [/^orders\//, ["payments"]],
  [/^(transactions|finance)\//, ["finance"]],
  [/^ai\//, ["ai"]],
  [/^moderation\//, ["moderation"]],
  [/^broadcasts\//, ["broadcasts"]],
  [/^settings\//, ["settings"]],
  [/^system\//, ["system"]],
  [/^errors\//, ["errors"]],
  [/^audit\//, ["audit"]],
  [/^admins\//, ["admins"]],
  [/^metrics\//, ["dashboard"]],
  [/^pricing\//, ["pricing"]],
  [/^(me\/|auth\/reauth\/)/, ["self"]],
];

/**
 * The ONLY non-GET routes allowed on a `*.view` permission, each with its plan
 * reference. Every entry must exist in the manifest (a removed route is a stale
 * entry) and must be proven write-free by its own test below. Never widen the
 * rule itself.
 */
const VIEW_MUTATION_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  [
    "pricing/[toolId]/simulate/route.ts POST",
    "plan §17.5: a read-only what-if on {percent, roundTo}; POST only for its body, writes no row and no audit",
  ],
]);

test("manifest: every route's permission fits its path family and verb class (least privilege)", () => {
  const problems: string[] = [];
  const known = new Set(ADMIN_ENTRIES.map((e) => `${e.rel} ${e.method}`));
  for (const key of VIEW_MUTATION_ALLOWLIST.keys()) {
    if (!known.has(key)) problems.push(`allow-list entry "${key}" is not a route any more — remove it`);
  }
  for (const e of ADMIN_ENTRIES) {
    const perm = e.permission!;
    const where = `${e.rel} ${e.method} [${perm}]`;
    const allowed = VIEW_MUTATION_ALLOWLIST.has(`${e.rel} ${e.method}`);
    const family = PATH_FAMILIES.find(([re]) => re.test(e.rel));
    if (!family) {
      problems.push(`${where}: path family unknown — extend PATH_FAMILIES`);
      continue;
    }
    const ns = perm === "self" ? "self" : perm.split(".")[0]!;
    if (!family[1].includes(ns)) problems.push(`${where}: namespace "${ns}" does not belong to ${family[0]}`);
    if (/\/export\//.test(e.rel) && !perm.endsWith(".export")) problems.push(`${where}: an export path must use a *.export permission`);
    if (!/\/export\//.test(e.rel) && perm.endsWith(".export")) problems.push(`${where}: *.export on a non-export path`);
    if (e.mutation && perm.endsWith(".view") && !allowed) problems.push(`${where}: a mutation guarded by a *.view permission`);
    if (allowed && !(e.mutation && perm.endsWith(".view"))) problems.push(`${where}: allow-listed but no longer a *.view mutation — remove the entry`);
    if (!e.mutation && PLAN_STEP_UP.has(perm) && !perm.endsWith(".export")) problems.push(`${where}: a read guarded by a step-up (money/admin) permission`);
  }
  assert.deepEqual(problems, []);
});

// ───────────────────────────── §4.3 literal and plan-file equality

const ROLE_COLUMNS = ["owner", "admin", "finance", "support", "moderator", "viewer"] as const;

// | Permission | owner | admin | finance | support | moderator | viewer | Step-up |
const PLAN_TABLE = `
| dashboard.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| users.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| users.pii | ✓ | ✓ | | ✓ | | | |
| users.export | ✓ | ✓ | ✓ | | | | S |
| users.block | ✓ | ✓ | | ✓ | ✓ | | |
| users.sessions | ✓ | ✓ | | ✓ | | | |
| users.wallet | ✓ | ✓ | ✓ | | | | S |
| users.message | ✓ | ✓ | | ✓ | | | |
| jobs.view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| jobs.input | ✓ | ✓ | | ✓ | | | |
| jobs.export | ✓ | ✓ | ✓ | | | | S |
| jobs.cancel | ✓ | ✓ | | ✓ | | | |
| jobs.refund | ✓ | ✓ | ✓ | ✓ | | | |
| payments.view | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| payments.export | ✓ | ✓ | ✓ | | | | S |
| payments.refund_record | ✓ | ✓ | ✓ | | | | S |
| finance.view | ✓ | ✓ | ✓ | | | ✓ | |
| finance.export | ✓ | ✓ | ✓ | | | | S |
| ai.view | ✓ | ✓ | ✓ | | | ✓ | |
| moderation.view | ✓ | ✓ | | ✓ | ✓ | | |
| moderation.act | ✓ | ✓ | | | ✓ | | |
| broadcasts.view | ✓ | ✓ | | ✓ | | | |
| broadcasts.send | ✓ | ✓ | | | | | S |
| settings.view | ✓ | ✓ | ✓ | | | ✓ | |
| settings.edit | ✓ | ✓ | | | | | S |
| system.view | ✓ | ✓ | ✓ | ✓ | | ✓ | |
| errors.view | ✓ | ✓ | | ✓ | | ✓ | |
| errors.resolve | ✓ | ✓ | | | | | |
| audit.view | ✓ | ✓ | | | | | |
| audit.export | ✓ | | | | | | S |
| pricing.view | ✓ | ✓ | ✓ | | | ✓ | |
| pricing.edit | ✓ | ✓ | | | | | S |
| admins.view | ✓ | ✓ | | | | | |
| admins.manage | ✓ | ✓ (rank-limited) | | | | | S |
`;

type Row = { perm: string; roles: Set<string>; stepUp: boolean };

function parseTable(text: string): Row[] {
  return text
    .trim()
    .split("\n")
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      assert.equal(cells.length, 8, `bad row: ${line}`);
      const [perm, ...rest] = cells;
      const roles = new Set<string>();
      ROLE_COLUMNS.forEach((r, i) => {
        if (rest[i]!.startsWith("✓")) roles.add(r);
        else assert.equal(rest[i], "", `unexpected cell ${rest[i]} in ${perm}`);
      });
      return { perm: perm!, roles, stepUp: rest[6] === "S" };
    });
}

/** The §4.3 table as it stands in the plan file (rows between the header and the invariants). */
function planFileTable(): string {
  const md = readFileSync(join(ROOT, "docs/admin/02-plan.md"), "utf8");
  const start = md.indexOf("### 4.3 Permission matrix");
  assert.ok(start > 0, "§4.3 heading not found in docs/admin/02-plan.md");
  const section = md.slice(start, md.indexOf("**Additional server-side invariants**", start));
  const rows = section.split("\n").filter((l) => /^\| [a-z]+\.[a-z_]+ \|/.test(l));
  assert.ok(rows.length > 0, "§4.3 table rows not found");
  return rows.join("\n");
}

/**
 * The runtime expectations below come from the PLAN literal, not from
 * `admin-rbac` — a widened grant in the code fails the matrix test itself, not
 * only the static comparison. `self` (§4.2) is implicit for every admin.
 */
const PLAN_ROWS = parseTable(PLAN_TABLE);
const PLAN_GRANTS = new Map(PLAN_ROWS.map((r) => [r.perm, r.roles]));
const PLAN_STEP_UP = new Set(PLAN_ROWS.filter((r) => r.stepUp).map((r) => r.perm));

function planAllows(role: Role, perm: Permission): boolean {
  if (perm === "self") return true;
  const roles = PLAN_GRANTS.get(perm);
  assert.ok(roles, `permission "${perm}" is used by a route but has no §4.3 row`);
  return roles.has(role);
}

const planStepUp = (perm: Permission): boolean => PLAN_STEP_UP.has(perm);

test("matrix: admin-rbac equals the §4.3 literal AND the §4.3 table in the plan file (role × permission × step-up)", () => {
  const literal = parseTable(PLAN_TABLE);
  assert.equal(literal.length, 34);
  assert.deepEqual(parseTable(planFileTable()), literal, "the transcribed literal drifted from docs/admin/02-plan.md §4.3");
  assert.deepEqual([...rbac.PERMISSIONS].filter((p) => p !== "self").sort(), literal.map((r) => r.perm).sort());
  const diffs: string[] = [];
  for (const row of literal) {
    const perm = row.perm as Permission;
    for (const role of ROLE_COLUMNS) {
      if (rbac.can(role, perm) !== row.roles.has(role)) diffs.push(`${perm} × ${role}: code=${rbac.can(role, perm)} plan=${row.roles.has(role)}`);
    }
    if (rbac.needsStepUp(perm) !== row.stepUp) diffs.push(`${perm} step-up: code=${rbac.needsStepUp(perm)} plan=${row.stepUp}`);
  }
  assert.deepEqual(diffs, []);
  for (const role of ROLE_COLUMNS) assert.equal(rbac.can(role, "self"), true, `${role} lacks the implicit self permission`);
  assert.equal(rbac.needsStepUp("self"), false);
});

// ───────────────────────────── calling a route

type Result = { status: number; body: Record<string, unknown> };

/**
 * A syntactically valid value for every dynamic segment. Real seeded rows where
 * a fake id would hit an F2 route's uncoded 404; otherwise a well-formed id that
 * the route answers with a coded `not_found` (or a validation 400). A new
 * dynamic segment the table does not know fails the call, on purpose.
 */
function paramsFor(e: Entry, role: Role | null): Record<string, string> {
  const s = seed!;
  const out: Record<string, string> = {};
  for (const seg of e.rel.match(/\[([^\]]+)\]/g) ?? []) {
    const name = seg.slice(1, -1);
    let value: string | null = null;
    if (e.rel.startsWith("users/[id]")) value = s.targetUser.id;
    else if (e.rel.startsWith("admins/[id]")) value = s.targetAdmin.adminId;
    else if (e.rel.startsWith("me/sessions/[id]")) value = role ? s.admins[role].spare[currentMode.name].id : "900000000000";
    else if (/^(audit|errors|broadcasts)\/\[id\]/.test(e.rel)) value = "900000000000";
    else if (/^(generations|orders|moderation\/game-links|moderation\/game-results)\/\[id\]/.test(e.rel)) value = randomUUID();
    else if (e.rel.startsWith("settings/[key]")) value = "no_such_setting";
    else if (e.rel.startsWith("pricing/[toolId]")) value = PRICING_TOOL_ID;
    assert.ok(value !== null, `${e.rel}: no fixture value for dynamic segment [${name}] — extend paramsFor()`);
    out[name] = value;
  }
  return out;
}

async function call(
  e: Entry,
  cookie: string | null,
  opts: { origin?: boolean | string; role?: Role | null; body?: Record<string, unknown> } = {},
): Promise<Result> {
  const params = paramsFor(e, opts.role ?? null);
  const path = e.path.replace(/\[([^\]]+)\]/g, (_m, name: string) => encodeURIComponent(params[name]!));
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": freshIp(), "user-agent": "permission-matrix-test" };
  if (cookie) headers.cookie = cookie;
  const origin = opts.origin ?? true;
  if (origin === true) headers.origin = "http://localhost:3000";
  else if (typeof origin === "string") headers.origin = origin;
  let body: string | undefined;
  if (e.mutation) {
    headers["content-type"] = "application/json";
    headers["Idempotency-Key"] = randomUUID();
    body = JSON.stringify(opts.body ?? {});
  }
  const req = new Request(`http://localhost:3000${path}`, { method: e.method, headers, body });
  const res = await inRequest(req, () => e.fn(req, { params: Promise.resolve(params) }));
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}

const label = (e: Entry, who: string) => `${e.rel} ${e.method} [${e.permission ?? "auth"}] as ${who}`;
const show = (r: Result) => `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
const isForbidden = (r: Result) => r.status === 403 && r.body.code === "forbidden";
/** The "not an admin" cloak: a 404 without the `not_found` code of a missing resource. */
const isCloak = (r: Result) => r.status === 404 && r.body.code !== "not_found";

function flag(key: string, msg: string): string {
  return KNOWN_BUGS.includes(key) ? `KNOWN_BUG ${msg}` : msg;
}

const emptyByRole = (): Record<Role, string[]> => ({ owner: [], admin: [], finance: [], support: [], moderator: [], viewer: [] });

// ───────────────────────────── the matrix

/** (permission, scope) of every refused call, per admin and per mode — the expected `denied` rows. */
const expectedDeniedByMode: Record<Mode["name"], Record<Role, string[]>> = { "2fa": emptyByRole(), simple: emptyByRole() };
const serverErrors: string[] = [];
let matrixCases = 0;

for (const mode of MODES) {
  test(`[${mode.name}] matrix: every route × method × role — 403 forbidden without the permission, never 403/401/cloak with it`, { skip }, async () => {
    setMode(mode);
    const s = seed!;
    const expectedDenied = expectedDeniedByMode[mode.name];
    const failures: string[] = [];
    const histogram = new Map<string, number>();
    let cases = 0;
    for (const e of ADMIN_ENTRIES) {
      for (const role of ROLES) {
        const a = s.admins[role];
        const r = await call(e, cookieOf(a, a.fresh), { role });
        cases++;
        const bucket = `${r.status}${typeof r.body.code === "string" ? ` ${r.body.code}` : ""}`;
        histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
        const key = `${e.rel} ${e.method} ${role}`;
        if (r.status >= 500) serverErrors.push(`[${mode.name}] ${label(e, role)} → ${show(r)}`);
        if (planAllows(role, e.permission!)) {
          if (isForbidden(r) || r.status === 401 || isCloak(r)) {
            failures.push(flag(key, `[${mode.name}] ${label(e, role)}: has the permission but got ${show(r)}`));
          }
        } else {
          expectedDenied[role].push(`${e.permission}|${e.scope}`);
          if (!isForbidden(r)) failures.push(flag(key, `[${mode.name}] ${label(e, role)}: lacks the permission, expected 403 forbidden, got ${show(r)}`));
        }
      }
    }
    matrixCases += cases;
    console.log(
      `matrix [${mode.name}]: ${ADMIN_ENTRIES.length} methods × ${ROLES.length} roles = ${cases} cases; statuses: ${[...histogram].sort().map(([k, v]) => `${k}=${v}`).join(", ")}`,
    );
    assert.deepEqual(failures, []);
    assert.equal(cases, ADMIN_ENTRIES.length * ROLES.length);
    // Every role is refused somewhere and allowed somewhere: the matrix is exercised in both directions.
    for (const role of ROLES) {
      if (role !== "owner") assert.ok(expectedDenied[role].length > 0, `${role} was never refused`);
      assert.ok(expectedDenied[role].length < ADMIN_ENTRIES.length, `${role} was never allowed`);
    }
  });
}

test("matrix: the switch changes no 403 — the refused set of every role is the same in both modes", { skip }, () => {
  assert.ok(matrixCases > 0, "the matrix tests did not run");
  for (const role of ROLES) {
    assert.deepEqual([...expectedDeniedByMode.simple[role]].sort(), [...expectedDeniedByMode["2fa"][role]].sort(), `refused calls of ${role}`);
  }
});

test("matrix: each refused call wrote exactly one `auth.denied` audit row (permission + scope) in each mode, allowed calls none", { skip }, async () => {
  const s = seed!;
  assert.ok(matrixCases > 0, "the matrix tests did not run");
  for (const role of ROLES) {
    const rows = await query<{ outcome: string; actor_role: string; meta: { permission?: string; scope?: string } | null }>(
      `SELECT outcome, actor_role, meta FROM admin_audit_log WHERE admin_id = $1 AND action = 'auth.denied' ORDER BY id`,
      [s.admins[role].adminId],
    );
    for (const r of rows) {
      assert.equal(r.outcome, "denied");
      assert.equal(r.actor_role, role);
    }
    const got = rows.map((r) => `${r.meta?.permission}|${r.meta?.scope}`).sort();
    const expected = MODES.flatMap((m) => expectedDeniedByMode[m.name][role]).sort();
    assert.deepEqual(got, expected, `denied audit rows of ${role}`);
  }
});

test("matrix: no route answered 5xx to the minimal request of a permitted role", { skip }, () => {
  assert.ok(matrixCases > 0, "the matrix test did not run");
  assert.deepEqual(serverErrors, []);
});

test("allow-list: pricing/[toolId]/simulate POST on pricing.view really writes nothing (no pricing row, no history, no audit)", { skip }, async () => {
  const s = seed!;
  const e = ADMIN_ENTRIES.find((x) => x.rel === "pricing/[toolId]/simulate/route.ts" && x.method === "POST");
  assert.ok(e, "the allow-listed route exists");
  const counts = async () => {
    const r = await queryOne<{ pricing: number; history: number; audit: number }>(
      `SELECT (SELECT count(*) FROM tool_pricing)::int AS pricing,
              (SELECT count(*) FROM tool_price_history)::int AS history,
              (SELECT count(*) FROM admin_audit_log)::int AS audit`,
    );
    return r!;
  };
  const before = await counts();
  // viewer holds pricing.view but not pricing.edit: the weakest role the route admits.
  const viewer = s.admins.viewer;
  const r = await call(e, cookieOf(viewer, viewer.fresh), { role: "viewer", body: { percent: 150, roundTo: 100 } });
  assert.equal(r.status, 200, show(r));
  assert.ok(Array.isArray(r.body.ladder), "a simulation answers with a ladder");
  assert.deepEqual(await counts(), before, "the simulation wrote a row");
});

// ───────────────────────────── cross-cutting checks

for (const mode of MODES) {
  test(
    mode.stepUp
      ? `[${mode.name}] step-up: every route of every S permission answers 401 reauth to a permitted role whose reauth_at is stale`
      : `[${mode.name}] step-up: no route answers 401 reauth — a stale reauth_at is irrelevant without a second factor`,
    { skip },
    async () => {
      setMode(mode);
      const s = seed!;
      const failures: string[] = [];
      const covered = new Set<Permission>();
      for (const e of ADMIN_ENTRIES) {
        if (!planStepUp(e.permission!)) continue;
        for (const role of ROLES) {
          if (!planAllows(role, e.permission!)) continue;
          const a = s.admins[role];
          const r = await call(e, cookieOf(a, a.stale), { role });
          const reauth = r.status === 401 && r.body.code === "reauth";
          if (mode.stepUp) {
            if (reauth) covered.add(e.permission!);
            else failures.push(flag(`${e.rel} ${e.method} ${role} stale`, `${label(e, `${role} (stale step-up)`)}: expected 401 reauth, got ${show(r)}`));
          } else {
            // Same answer as a fresh session: never reauth, forbidden, 401 or the cloak.
            if (reauth || isForbidden(r) || r.status === 401 || isCloak(r)) {
              failures.push(`[simple] ${label(e, `${role} (stale step-up)`)}: expected no reauth, got ${show(r)}`);
            } else {
              covered.add(e.permission!);
            }
          }
        }
      }
      assert.deepEqual(failures, []);
      // Every S permission of §4.3 has at least one route by now (WP11 brought pricing.edit), and each one was exercised.
      const routed = new Set<string>(ADMIN_ENTRIES.map((e) => e.permission!));
      assert.deepEqual([...PLAN_STEP_UP].filter((p) => !routed.has(p)), [], "a step-up permission has no route");
      assert.deepEqual([...covered].sort(), [...PLAN_STEP_UP].sort(), "every S permission is covered by at least one route");
      // A stale session is not a broken session: a non-S route still works with it.
      const plain = ADMIN_ENTRIES.find((e) => e.rel === "me/sessions/route.ts" && e.method === "GET")!;
      const r = await call(plain, cookieOf(s.admins.owner, s.admins.owner.stale), { role: "owner" });
      assert.equal(r.status, 200, show(r));
    },
  );

  test(`[${mode.name}] cloak: non-admin and anonymous callers get 404 on every route (auth routes included)`, { skip }, async () => {
    setMode(mode);
    const s = seed!;
    const failures: string[] = [];
    for (const e of ENTRIES) {
      for (const [who, cookie] of [
        ["anonymous", null],
        ["non-admin user", cookieOf(s.plainUser)],
      ] as const) {
        const r = await call(e, cookie);
        if (r.status !== 404 || r.body.code === "not_found") failures.push(`${label(e, who)}: expected the 404 cloak, got ${show(r)}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  test(`[${mode.name}] cloak: a disabled admin account gets 404 on every route, even with a live admin session cookie`, { skip }, async () => {
    setMode(mode);
    const s = seed!;
    const failures: string[] = [];
    for (const e of ENTRIES) {
      const r = await call(e, cookieOf(s.disabled.user, s.disabled.session));
      if (r.status !== 404 || r.body.code === "not_found") failures.push(`${label(e, "disabled owner")}: expected the 404 cloak, got ${show(r)}`);
    }
    assert.deepEqual(failures, []);
  });

  test(`[${mode.name}] origin: every mutation without an Origin header, or with a foreign one, gets 403 — before any auth step`, { skip }, async () => {
    setMode(mode);
    const s = seed!;
    const owner = s.admins.owner;
    const failures: string[] = [];
    assert.ok(MUTATIONS.length >= 25, `only ${MUTATIONS.length} mutations found`);
    for (const e of MUTATIONS) {
      const none = await call(e, cookieOf(owner, owner.fresh), { origin: false, role: "owner" });
      if (none.status !== 403 || none.body.code === "forbidden") failures.push(`${label(e, "owner, no Origin")}: expected 403, got ${show(none)}`);
      const evil = await call(e, cookieOf(owner, owner.fresh), { origin: "https://evil.example", role: "owner" });
      if (evil.status !== 403 || evil.body.code === "forbidden") failures.push(`${label(e, "owner, foreign Origin")}: expected 403, got ${show(evil)}`);
      // Anonymous without Origin: still 403 (the Origin check runs before the cloak).
      const anon = await call(e, null, { origin: false });
      if (anon.status !== 403) failures.push(`${label(e, "anonymous, no Origin")}: expected 403, got ${show(anon)}`);
    }
    assert.deepEqual(failures, []);
    // Reads do not need an Origin.
    const read = ADMIN_ENTRIES.find((e) => e.rel === "me/sessions/route.ts" && e.method === "GET")!;
    assert.equal((await call(read, cookieOf(owner, owner.fresh), { origin: false, role: "owner" })).status, 200);
  });

  test(`[${mode.name}] sessions: an expired or revoked admin session gets 401 admin_auth on every adminHandler route`, { skip }, async () => {
    setMode(mode);
    const s = seed!;
    const owner = s.admins.owner;
    const failures: string[] = [];
    for (const e of ADMIN_ENTRIES) {
      for (const [state, session] of [
        ["expired", s.expired],
        ["revoked", s.revoked],
      ] as const) {
        const r = await call(e, cookieOf(owner, session), { role: "owner" });
        if (r.status !== 401 || r.body.code !== "admin_auth") failures.push(`${label(e, `owner (${state} session)`)}: expected 401 admin_auth, got ${show(r)}`);
      }
      // A user session without any admin cookie is the same 401 (an admin that has not logged in to the panel).
      const r = await call(e, cookieOf(owner, null), { role: "owner" });
      if (r.status !== 401 || r.body.code !== "admin_auth") failures.push(`${label(e, "owner (no admin cookie)")}: expected 401 admin_auth, got ${show(r)}`);
    }
    assert.deepEqual(failures, []);
  });
}

test("audit: the cross-cutting checks (cloak, step-up, origin, sessions) never write a `denied` row", { skip }, async () => {
  const s = seed!;
  const ids = ROLES.map((r) => s.admins[r].adminId);
  const n = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'auth.denied' AND (admin_id = ANY($1::bigint[]) OR admin_id IS NULL)`,
    [ids],
  );
  const expected = MODES.reduce((acc, m) => acc + ROLES.reduce((inner, r) => inner + expectedDeniedByMode[m.name][r].length, 0), 0);
  assert.ok(expected > 0, "the matrix test did not run");
  assert.equal(n!.n, expected);
  const other = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM admin_audit_log WHERE action = 'auth.denied' AND admin_id <> ALL($1::bigint[])`, [ids]);
  assert.equal(other!.n, 0, "a non-matrix account wrote a denied row");
});

test("network: no route reached out through fetch (Telegram/LLM/providers) during the whole file", () => {
  const external = fetchCalls.filter((c) => !c.includes("://127.0.0.1") && !c.includes("://localhost"));
  assert.deepEqual(external, [], "the fetch stub was called with a real host");
  assert.deepEqual(fetchCalls, []);
});
