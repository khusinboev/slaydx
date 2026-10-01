import test from "node:test";
import assert from "node:assert/strict";

/**
 * RBAC (docs/admin/02-plan.md §4): the full role × permission matrix must
 * equal the §4.3 table, copied here verbatim (✓ = granted, S = step-up). A
 * change to `lib/server/admin-rbac.ts` that is not also a change to the
 * reviewed plan table fails this test.
 */

const rbac = await import("../lib/server/admin-rbac.ts");

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

function parseTable(): Row[] {
  return PLAN_TABLE.trim()
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

test("matrix: every role × permission equals the plan's §4.3 table", () => {
  const rows = parseTable();
  assert.equal(rows.length, 34);
  const matrixPerms = rows.map((r) => r.perm);
  // `self` (§4.2) is implicit for every admin and is not a table row.
  assert.deepEqual([...rbac.PERMISSIONS].filter((p) => p !== "self").sort(), [...matrixPerms].sort());
  for (const row of rows) {
    for (const role of ROLE_COLUMNS) {
      assert.equal(
        rbac.can(role, row.perm as never),
        row.roles.has(role),
        `${role} × ${row.perm}: code says ${rbac.can(role, row.perm as never)}, plan says ${row.roles.has(role)}`,
      );
    }
  }
  for (const role of ROLE_COLUMNS) {
    const expected = rows.filter((r) => r.roles.has(role)).map((r) => r.perm);
    assert.deepEqual(
      rbac.permissionsOf(role).filter((p) => p !== "self").sort(),
      expected.sort(),
      `permissionsOf(${role})`,
    );
    assert.ok(rbac.can(role, "self"), `self is implicit for ${role}`);
  }
});

test("matrix: pricing rows (§4.3, added with §17) are present as specified", () => {
  assert.deepEqual(
    ROLE_COLUMNS.filter((r) => rbac.can(r, "pricing.view")),
    ["owner", "admin", "finance", "viewer"],
  );
  assert.deepEqual(
    ROLE_COLUMNS.filter((r) => rbac.can(r, "pricing.edit")),
    ["owner", "admin"],
  );
  assert.equal(rbac.needsStepUp("pricing.edit"), true);
  assert.equal(rbac.needsStepUp("pricing.view"), false);
});

test("step-up: the S column exactly", () => {
  const rows = parseTable();
  for (const row of rows) {
    assert.equal(rbac.needsStepUp(row.perm as never), row.stepUp, `${row.perm}`);
  }
  assert.deepEqual([...rbac.STEP_UP].sort(), rows.filter((r) => r.stepUp).map((r) => r.perm).sort());
  assert.equal(rbac.needsStepUp("self"), false);
});

test("roles and ranks (§4.1)", () => {
  assert.deepEqual([...rbac.ROLES], [...ROLE_COLUMNS]);
  assert.deepEqual(rbac.ROLE_RANK, { owner: 100, admin: 80, finance: 60, support: 50, moderator: 40, viewer: 10 });
});

test("unknown or tampered roles get nothing", () => {
  for (const role of ["", "root", "OWNER", "owner ", "__proto__", "constructor"]) {
    assert.equal(rbac.isRole(role), false, role);
    assert.equal(rbac.can(role, "dashboard.view"), false, role);
    assert.equal(rbac.can(role, "self"), false, role);
    assert.deepEqual(rbac.permissionsOf(role), [], role);
    assert.equal(rbac.canManageRole(role, "viewer"), false, role);
    assert.equal(rbac.canManageRole("owner", role), false, role);
  }
  assert.equal(rbac.isPermission("admins.manage"), true);
  assert.equal(rbac.isPermission("admins.everything"), false);
});

test("canManageRole: strictly lower rank, owner may manage owners, only with admins.manage", () => {
  const expected: Record<string, string[]> = {
    owner: ["owner", "admin", "finance", "support", "moderator", "viewer"],
    admin: ["finance", "support", "moderator", "viewer"],
    finance: [],
    support: [],
    moderator: [],
    viewer: [],
  };
  for (const actor of ROLE_COLUMNS) {
    assert.deepEqual(
      ROLE_COLUMNS.filter((t) => rbac.canManageRole(actor, t)),
      expected[actor],
      `${actor} manages`,
    );
  }
});

test("ROLE_PERMISSIONS is frozen (no runtime widening)", () => {
  assert.ok(Object.isFrozen(rbac.ROLE_PERMISSIONS));
  assert.ok(Object.isFrozen(rbac.ROLE_PERMISSIONS.viewer));
  assert.throws(() => {
    (rbac.ROLE_PERMISSIONS.viewer as string[]).push("admins.manage");
  });
  assert.equal(rbac.can("viewer", "admins.manage"), false);
});
