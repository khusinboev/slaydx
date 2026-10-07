import test from "node:test";
import assert from "node:assert/strict";
import { groupDigits } from "../lib/format.ts";

test("groupDigits: «3 000» with a no-break space, same text everywhere (no ICU dependence)", () => {
  assert.equal(groupDigits(3000), "3 000");
  assert.equal(groupDigits(200_000), "200 000");
  assert.equal(groupDigits(1_234_567), "1 234 567");
  assert.equal(groupDigits(999), "999");
  assert.equal(groupDigits(0), "0");
  assert.equal(groupDigits(-2500), "−2 500");
  assert.equal(groupDigits(2999.6), "3 000");
  // Node's own uz-UZ output (what server-rendered HTML used to contain) — kept identical.
  assert.equal(groupDigits(200_000), (200_000).toLocaleString("uz-UZ"));
});
