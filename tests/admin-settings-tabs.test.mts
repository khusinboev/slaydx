import test from "node:test";
import assert from "node:assert/strict";
import { SETTING_KEYS } from "../lib/server/settings.ts";
import { FEATURE_EFFECT, OTHER_TAB, STOP_KEYS, TAB_DEFS, shortHint, tabOfKey } from "../components/admin/settings/layout.ts";

/**
 * The «Sozlamalar» tabs (components/admin/settings/layout.ts) must cover the real
 * catalog: every key in exactly one tab, no stale key, no tab left empty. A new
 * catalog key without a tab would only fall into «Boshqa» — this test makes that a
 * conscious decision.
 */

test("every catalog key is listed in exactly one tab", () => {
  const seen = new Map<string, string>();
  for (const tab of TAB_DEFS) {
    for (const key of tab.keys) {
      assert.ok(!seen.has(key), `${key} is in both «${seen.get(key)}» and «${tab.id}»`);
      seen.set(key, tab.id);
    }
  }
  const missing = SETTING_KEYS.filter((k) => !seen.has(k));
  assert.deepEqual(missing, [], `catalog keys without a tab: ${missing.join(", ")}`);
  const stale = [...seen.keys()].filter((k) => !(SETTING_KEYS as readonly string[]).includes(k));
  assert.deepEqual(stale, [], `tab keys not in the catalog: ${stale.join(", ")}`);
  for (const key of SETTING_KEYS) assert.notEqual(tabOfKey(key), OTHER_TAB, key);
  for (const tab of TAB_DEFS) assert.ok(tab.keys.length > 0, `${tab.id} is empty`);
});

test("tab ids are unique and every feature / stop key exists in the catalog", () => {
  const ids = TAB_DEFS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const key of [...Object.keys(FEATURE_EFFECT), ...STOP_KEYS]) assert.ok((SETTING_KEYS as readonly string[]).includes(key), key);
  // Every feature switch lives in the «Funksiyalar» tab.
  const features = TAB_DEFS.find((t) => t.id === "features");
  assert.ok(features);
  assert.deepEqual([...features.keys].sort(), Object.keys(FEATURE_EFFECT).sort());
});

test("shortHint: first sentence only, long text cut", () => {
  assert.equal(shortHint("Birinchi gap. Ikkinchi gap."), "Birinchi gap.");
  assert.equal(shortHint("Nuqtasiz matn"), "Nuqtasiz matn");
  assert.ok(shortHint("a".repeat(300)).length <= 150);
});
