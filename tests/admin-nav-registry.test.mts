import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Admin nav registry (docs/admin/02-plan.md §7.0, §7.1) and the login `next`
 * sanitiser (open-redirect guard). The registry is the single list later
 * packages add pages to, so its permissions are pinned to the server RBAC
 * matrix here.
 */

const reg = await import("../components/admin/shell/nav-registry.ts");
const rbac = await import("../lib/server/admin-rbac.ts");

const ROOT = path.resolve(import.meta.dirname, "..");

// Plan §13.2 "F3b": every module route and its required permission.
const EXPECTED: ReadonlyArray<[string, string]> = [
  ["/admin", "dashboard.view"],
  ["/admin/users", "users.view"],
  ["/admin/generations", "jobs.view"],
  ["/admin/payments", "payments.view"],
  ["/admin/finance", "finance.view"],
  ["/admin/ai", "ai.view"],
  ["/admin/pricing", "pricing.view"],
  ["/admin/bonus", "bonus.view"],
  ["/admin/moderation", "moderation.view"],
  ["/admin/broadcasts", "broadcasts.view"],
  ["/admin/settings", "settings.view"],
  ["/admin/system", "system.view"],
  ["/admin/errors", "errors.view"],
  ["/admin/audit", "audit.view"],
  ["/admin/admins", "admins.view"],
  ["/admin/account", "self"],
];

test("nav registry: every permission exists in the server RBAC matrix", () => {
  for (const item of reg.ADMIN_NAV) {
    assert.ok(rbac.isPermission(item.permission), `${item.href}: unknown permission ${item.permission}`);
  }
});

test("nav registry: hrefs and labels are unique, under /admin, in known groups", () => {
  const hrefs = reg.ADMIN_NAV.map((i) => i.href);
  assert.equal(new Set(hrefs).size, hrefs.length, `duplicate href in ${hrefs.join(", ")}`);
  const labels = reg.ADMIN_NAV.map((i) => i.label);
  assert.equal(new Set(labels).size, labels.length, "duplicate label");
  const groups = new Set(reg.ADMIN_NAV_GROUPS.map((g) => g.id));
  for (const item of reg.ADMIN_NAV) {
    assert.ok(item.href === "/admin" || item.href.startsWith("/admin/"), item.href);
    assert.ok(item.label.trim().length > 0, `${item.href}: empty label`);
    assert.ok(groups.has(item.group), `${item.href}: unknown group ${item.group}`);
  }
  for (const g of reg.ADMIN_NAV_GROUPS) {
    assert.ok(reg.ADMIN_NAV.some((i) => i.group === g.id), `group ${g.id} has no items`);
  }
});

test("nav registry: exactly the plan's module routes with their permissions", () => {
  assert.deepEqual(
    reg.ADMIN_NAV.map((i) => [i.href, i.permission]),
    EXPECTED,
  );
});

test("nav registry: per-role visibility follows the server matrix", () => {
  for (const role of rbac.ROLES) {
    const perms = rbac.permissionsOf(role);
    const visible = reg.visibleNav(perms).map((i) => i.href);
    const expected = EXPECTED.filter(([, p]) => rbac.can(role, p as Parameters<typeof rbac.can>[1])).map(([h]) => h);
    assert.deepEqual(visible, expected, role);
    // Every role reaches the dashboard and its own account.
    assert.ok(visible.includes("/admin") && visible.includes("/admin/account"), role);
  }
  assert.equal(reg.visibleNav(rbac.permissionsOf("owner")).length, EXPECTED.length);
  const moderator = reg.visibleNav(rbac.permissionsOf("moderator")).map((i) => i.href);
  assert.deepEqual(moderator, ["/admin", "/admin/users", "/admin/generations", "/admin/moderation", "/admin/account"]);
  assert.deepEqual(reg.visibleNav([]), [], "no permissions, no nav");
  assert.deepEqual(reg.visibleNav(rbac.permissionsOf("intruder")), [], "unknown role sees nothing");
});

test("nav registry: navItemFor picks the longest matching module", () => {
  assert.equal(reg.navItemFor("/admin")?.href, "/admin");
  assert.equal(reg.navItemFor("/admin/users")?.href, "/admin/users");
  assert.equal(reg.navItemFor("/admin/users/42")?.href, "/admin/users");
  assert.equal(reg.navItemFor("/admin/generations/abc/x")?.href, "/admin/generations");
  // Unknown sub-paths fall back to the dashboard; look-alike prefixes do not match.
  assert.equal(reg.navItemFor("/admin/nope")?.href, "/admin");
  assert.equal(reg.navItemFor("/admin/usersx")?.href, "/admin");
  assert.equal(reg.navItemFor("/administrator"), null);
  assert.equal(reg.navItemFor("/uz/admin"), null);
});

test("next sanitiser: same-origin /admin paths are kept (with query and hash)", () => {
  assert.equal(reg.sanitizeAdminNext("/admin"), "/admin");
  assert.equal(reg.sanitizeAdminNext("/admin/users"), "/admin/users");
  assert.equal(reg.sanitizeAdminNext("/admin/users/42?tab=ledger#top"), "/admin/users/42?tab=ledger#top");
  assert.equal(reg.sanitizeAdminNext("/admin/generations?status=FAILED,QUEUED"), "/admin/generations?status=FAILED,QUEUED");
  assert.equal(reg.sanitizeAdminNext("/admin?x=1"), "/admin?x=1");
});

test("next sanitiser: open-redirect and loop attempts fall back to /admin", () => {
  const bad: unknown[] = [
    undefined,
    null,
    42,
    ["/admin/users"],
    "",
    "admin/users",
    "//evil.example/admin",
    "//evil.example/admin/users",
    "///evil.example/admin",
    "/\\evil.example/admin",
    "\\\\evil.example\\admin",
    "/admin\\..\\uz",
    "https://evil.example/admin",
    "https://evil.example/admin/users?x=1",
    "http://localhost/admin",
    "javascript:alert(1)//admin",
    "data:text/html,<b>admin</b>",
    " /admin",
    "/admin\n/evil",
    "/admin\t",
    "/uz",
    "/uz/admin",
    "/administrator",
    "/admins",
    "/admin@evil.example",
    "/admin/../uz",
    "/admin/%2e%2e/uz",
    "/admin/%2E%2E/%2E%2E/uz",
    "/admin/./../api/admin/session",
    "/admin/login",
    "/admin/login?next=/admin/users",
    "/admin/login/",
    "/admin/enroll?token=abc",
    `/admin/${"a".repeat(2100)}`,
  ];
  for (const raw of bad) {
    assert.equal(reg.sanitizeAdminNext(raw), reg.DEFAULT_ADMIN_PATH, `accepted: ${JSON.stringify(raw)}`);
  }
  assert.equal(reg.DEFAULT_ADMIN_PATH, "/admin");
});

test("adminLoginHref: encodes a safe next, drops an unsafe or default one", () => {
  assert.equal(reg.adminLoginHref("/admin/users?q=ali"), "/admin/login?next=%2Fadmin%2Fusers%3Fq%3Dali");
  assert.equal(reg.adminLoginHref("/admin/account"), "/admin/login?next=%2Fadmin%2Faccount");
  assert.equal(reg.adminLoginHref("/admin"), "/admin/login");
  assert.equal(reg.adminLoginHref("//evil.example"), "/admin/login");
  assert.equal(reg.adminLoginHref("/admin/login?next=/admin"), "/admin/login");
});

test("role labels: every server role has an Uzbek label", () => {
  for (const role of rbac.ROLES) {
    assert.ok(reg.ROLE_LABELS[role], role);
    assert.equal(reg.roleLabel(role), reg.ROLE_LABELS[role]);
  }
  assert.equal(reg.roleLabel("intruder"), "intruder");
});

test("jsdom role fixture in tests/ui/admin-shell.test.mts equals the server matrix", () => {
  // jsdom tests cannot load `server-only` modules, so they keep a copy; this keeps the copy honest.
  const src = readFileSync(path.join(ROOT, "tests/ui/admin-shell.test.mts"), "utf8");
  const m = src.match(/\/\* ROLE_FIXTURE_BEGIN \*\/([\s\S]*?)\/\* ROLE_FIXTURE_END \*\//);
  assert.ok(m, "ROLE_FIXTURE markers not found");
  const fixture = JSON.parse(m[1]) as Record<string, string[]>;
  const server = Object.fromEntries(rbac.ROLES.map((r) => [r, [...rbac.ROLE_PERMISSIONS[r]]]));
  assert.deepEqual(fixture, server);
});
