import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Ops sprint WP-A (docs/ops/PLAN.md lead decision "fonts"): only the UI font
 * (Geist) is preloaded. Tinos (document viewer, ~287 KB in 12 files) and
 * Geist Mono (admin/code fields) load on first use; the viewer re-measures
 * its pages when they arrive (`components/viewers/fonts-ready.ts`,
 * `tests/ui/fonts-remeasure.test.mts`).
 *
 * Mutations: dropping `preload: false` from Tinos or Geist Mono, or adding it
 * to Geist, each turned this test red.
 */
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

function fontConfig(fn: string): string {
  const m = new RegExp(`=\\s*${fn}\\(\\{([\\s\\S]*?)\\}\\);`).exec(layout);
  assert.ok(m, `${fn}({...}) not found in app/layout.tsx`);
  return m![1];
}

test("Tinos and Geist Mono are not preloaded; Geist (first paint) still is", () => {
  assert.match(fontConfig("Tinos"), /\bpreload:\s*false\b/, "Tinos must not be preloaded");
  assert.match(fontConfig("Geist_Mono"), /\bpreload:\s*false\b/, "Geist Mono must not be preloaded");
  assert.doesNotMatch(fontConfig("Geist"), /\bpreload:/, "Geist (UI text, first paint) keeps the default preload");
});

test("the measured viewers subscribe to font loads", () => {
  const measure = readFileSync(new URL("../components/viewers/measure.tsx", import.meta.url), "utf8");
  const word = readFileSync(new URL("../components/viewers/WordViewer.tsx", import.meta.url), "utf8");
  for (const [name, src] of [["measure.tsx", measure], ["WordViewer.tsx", word]] as const) {
    assert.match(src, /import \{ useFontEpoch \} from "\.\/fonts-ready";/, `${name} does not use useFontEpoch`);
  }
});
