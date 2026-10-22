import test from "node:test";
import assert from "node:assert/strict";
import { formatBonusSom, formatSom, groupDigits } from "../lib/format.ts";

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

test("formatSom / formatBonusSom: the one unit word of the app (program 17 D1) — «12 000 so'm», «2 000 bonus so'm»", () => {
  assert.equal(formatSom(12_000), "12\u00a0000 so'm");
  assert.equal(formatSom(0), "0 so'm");
  assert.equal(formatSom(-500), "\u2212500 so'm");
  assert.equal(formatSom(2999.6), "3\u00a0000 so'm");
  assert.equal(formatBonusSom(2000), "2\u00a0000 bonus so'm");
  assert.equal(formatBonusSom(0), "0 bonus so'm");
  // Never the old words.
  for (const out of [formatSom(5000), formatBonusSom(5000)]) assert.doesNotMatch(out, /tanga|ball|coin/i);
});
