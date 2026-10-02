import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Uzbek permission labels (components/admin/shell/permission-labels.ts) are
 * pinned to the server RBAC matrix (lib/server/admin-rbac.ts): every
 * permission any role can hold has a label, there are no labels for unknown
 * keys, and the client module reaches the server module only through
 * `import type` (erased at build time, so no server code in the bundle).
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - deleting the `users.wallet` label → "every permission has a label";
 *   - a value-import of admin-rbac in permission-labels.ts → "type-only import".
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const rbac = await import("../lib/server/admin-rbac.ts");
const labels = await import("../components/admin/shell/permission-labels.ts");

test("permission labels: every permission of the server matrix has a non-empty Uzbek label", () => {
  const missing = rbac.PERMISSIONS.filter((p) => typeof labels.PERMISSION_LABELS[p] !== "string" || labels.PERMISSION_LABELS[p].trim() === "");
  assert.deepEqual(missing, []);
  // Every permission any role actually holds (the matrix the UI shows) is covered too.
  for (const role of rbac.ROLES) {
    for (const p of rbac.ROLE_PERMISSIONS[role]) assert.notEqual(labels.permissionLabel(p), p, `${role}: ${p} shown as a raw key`);
  }
});

test("permission labels: no label for a key the server does not know; labels are distinct", () => {
  const known = new Set<string>(rbac.PERMISSIONS);
  assert.deepEqual(Object.keys(labels.PERMISSION_LABELS).filter((k) => !known.has(k)), []);
  const values = Object.values(labels.PERMISSION_LABELS);
  assert.equal(new Set(values).size, values.length, "two permissions share a label");
  assert.ok(Object.isFrozen(labels.PERMISSION_LABELS));
});

test("permissionLabel: unknown or prototype keys fall back to the raw key", () => {
  assert.equal(labels.permissionLabel("users.view"), "Foydalanuvchilarni ko'rish");
  assert.equal(labels.permissionLabel("future.permission"), "future.permission");
  assert.equal(labels.permissionLabel("toString"), "toString");
  assert.equal(labels.permissionLabel("__proto__"), "__proto__");
});

test("permission labels: the client module imports the server RBAC module as a type only", () => {
  const src = readFileSync(path.join(ROOT, "components/admin/shell/permission-labels.ts"), "utf8");
  const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["'];?$/gm)];
  const server = imports.filter((m) => /lib\/server\//.test(m[2]!));
  assert.ok(server.length >= 1, "expected the type import of admin-rbac");
  for (const m of server) assert.ok(m[1], `value import of ${m[2]} in a client module`);
  assert.ok(!/require\(|import\(/.test(src), "no dynamic server import");
});
