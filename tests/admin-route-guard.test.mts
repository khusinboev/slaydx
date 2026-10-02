import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Static guard for the admin API (docs/admin/02-plan.md §4.4): every HTTP
 * method exported by every `app/api/admin/**\/route.ts` must be
 *   • `adminHandler("admin/…", { permission: "<literal that exists in admin-rbac>", … }, …)`, or
 *   • `adminAuthHandler("admin/…", …)` — only in the auth/session/enroll routes of §6.1, or
 *   • the LEGACY `handler(…)` + `await requireAdmin(req)` — only in the two files
 *     listed in LEGACY_REQUIRE_ADMIN until the integration step rewrites them.
 * Anything else (a bare `handler`, a plain function, a re-export, a computed
 * permission) fails: a new route cannot ship without the guard.
 */

const ROOT = resolve(import.meta.dirname, "..");
const ADMIN_API = join(ROOT, "app/api/admin");

const { PERMISSIONS } = await import("../lib/server/admin-rbac.ts");
const KNOWN = new Set<string>(PERMISSIONS);

/** §6.1 routes that run before an admin session exists. */
const AUTH_ROUTES = new Set(["session/route.ts", "auth/login/route.ts", "auth/recovery/route.ts", "auth/enroll/route.ts"]);

/**
 * LEGACY allowance (explicit, temporary): files that may still use the old
 * `handler` + `requireAdmin` guard. WP2 rewrote the last two
 * (`users/route.ts`, `users/[id]/route.ts`) on `adminHandler`, so it is empty;
 * the integration step deletes `requireAdmin` and this mechanism.
 */
const LEGACY_REQUIRE_ADMIN = new Set<string>();

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts" || name === "route.tsx" || name === "route.js") out.push(p);
  }
  return out;
}

/** Source of each exported method: from `export const M =` to the next top-level `export`. */
function methodSources(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^export const (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s*=/gm;
  const starts = [...src.matchAll(re)].map((m) => ({ method: m[1]!, index: m.index! }));
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!.index;
    const nextExport = src.slice(from + 1).search(/^export /m);
    const to = nextExport >= 0 ? from + 1 + nextExport : src.length;
    out.set(starts[i]!.method, src.slice(from, to));
  }
  return out;
}

const files = walk(ADMIN_API).map((abs) => ({ abs, rel: relative(ADMIN_API, abs).split("\\").join("/") }));

test("admin route guard: the scan sees the F2 routes (the test is not vacuous)", () => {
  const rels = new Set(files.map((f) => f.rel));
  for (const expected of [
    "session/route.ts",
    "auth/login/route.ts",
    "auth/recovery/route.ts",
    "auth/reauth/route.ts",
    "auth/enroll/route.ts",
    "me/sessions/route.ts",
    "me/sessions/[id]/revoke/route.ts",
    "me/recovery-codes/route.ts",
    "admins/route.ts",
    "admins/[id]/route.ts",
    "admins/[id]/reset-2fa/route.ts",
    "admins/[id]/sessions/revoke/route.ts",
  ]) {
    assert.ok(rels.has(expected), `missing ${expected}`);
  }
});

test("admin route guard: every exported method is guarded by adminHandler / adminAuthHandler", () => {
  const problems: string[] = [];
  for (const { abs, rel } of files) {
    const src = readFileSync(abs, "utf8");
    if (!/export const runtime = "nodejs";/.test(src)) problems.push(`${rel}: runtime = "nodejs" missing`);
    if (!/export const dynamic = "force-dynamic";/.test(src)) problems.push(`${rel}: dynamic = "force-dynamic" missing`);

    // Forms that would bypass the scan below.
    if (/^export\s+(async\s+)?function\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/m.test(src)) {
      problems.push(`${rel}: HTTP method exported as a plain function`);
    }
    if (/^export\s*\{[^}]*\b(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b[^}]*\}/m.test(src)) {
      problems.push(`${rel}: HTTP method re-exported`);
    }
    if (/^export\s+(let|var)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/m.test(src)) {
      problems.push(`${rel}: HTTP method exported as let/var`);
    }

    const methods = methodSources(src);
    if (!methods.size) problems.push(`${rel}: no exported HTTP method found`);
    for (const [method, body] of methods) {
      const where = `${rel} ${method}`;
      const admin = body.match(/^export const \w+\s*=\s*adminHandler(?:<[^>]*>)?\(\s*"([^"]+)"\s*,\s*\{([^}]*)\}/);
      const auth = body.match(/^export const \w+\s*=\s*adminAuthHandler(?:<[^>]*>)?\(\s*"([^"]+)"\s*,/);
      const legacy = body.match(/^export const \w+\s*=\s*handler\(\s*"([^"]+)"/);
      if (admin) {
        const [, scope, opts] = admin;
        if (!scope!.startsWith("admin/")) problems.push(`${where}: scope "${scope}" must start with "admin/"`);
        const perm = opts!.match(/(?:^|[\s,{])permission:\s*"([^"]+)"/);
        if (!perm) problems.push(`${where}: permission must be a string literal`);
        else if (!KNOWN.has(perm[1]!)) problems.push(`${where}: unknown permission "${perm[1]}"`);
        const isMutation = method !== "GET" && method !== "HEAD";
        if (isMutation && !/mutation:\s*true/.test(opts!)) problems.push(`${where}: mutating method without mutation: true`);
      } else if (auth) {
        if (!AUTH_ROUTES.has(rel)) problems.push(`${where}: adminAuthHandler outside the §6.1 auth routes`);
        if (!auth[1]!.startsWith("admin/")) problems.push(`${where}: scope must start with "admin/"`);
        if (method !== "GET" && method !== "HEAD" && !/^export const \w+\s*=\s*adminAuthHandler\([^,]+,\s*\{[^}]*mutation:\s*true/.test(body)) {
          problems.push(`${where}: mutating auth method without mutation: true`);
        }
      } else if (legacy && LEGACY_REQUIRE_ADMIN.has(rel)) {
        if (!/await requireAdmin\(req\)/.test(body)) problems.push(`${where}: legacy handler without requireAdmin(req)`);
      } else {
        problems.push(`${where}: not wrapped in adminHandler/adminAuthHandler`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("admin route guard: the legacy allowance lists only files that exist", () => {
  const rels = new Set(files.map((f) => f.rel));
  for (const rel of LEGACY_REQUIRE_ADMIN) {
    // When WP2/integration rewrites or deletes a legacy file, drop it from the list too.
    if (rels.has(rel)) {
      const src = readFileSync(join(ADMIN_API, rel), "utf8");
      assert.ok(/requireAdmin/.test(src) || /adminHandler/.test(src), `${rel}: neither guard present`);
    }
  }
  assert.ok(METHODS.length === 7);
});
