import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TOOLS } from "../lib/tools.ts";
import { TOOL_IDS, TOOL_KINDS, toolKindOf } from "../lib/tool-kinds.ts";
import * as priceAdjust from "../lib/price-adjust.ts";
import * as tools from "../lib/tools.ts";
import { fileCategory } from "../lib/ui.ts";

/**
 * Ops sprint WP-B phase 1: `lib/store.ts` and `lib/ui.ts` (shared client
 * layer of every route) no longer import `lib/tools.ts` and its registries.
 * They read `lib/tool-kinds.ts` (ids, group, output) and
 * `lib/price-adjust.ts` (session price adjustments) instead.
 *
 * Locks:
 *   1. `TOOL_KINDS` is exactly `TOOLS` (ids in order, group and output per tool) —
 *      `TOOLS` stays the single source, the small table cannot drift from it;
 *   2. `fileCategory` gives the same answer as the old `TOOL_BY_ID` rule for every tool;
 *   3. `lib/tools.ts` re-exports the SAME price-adjust bindings (one client registry,
 *      `priceFor` sees what the store sets);
 *   4. the static (non-type) import graph of store/ui does not reach `lib/tools.ts`
 *      or `lib/generation/**`.
 *
 * Mutations (each turned this file red): a wrong `output` for `infographic` in
 * `TOOL_KINDS`; a missing row (`greeting`); `fileCategory` using `tool.output ===
 * "docx"` for tests; `lib/store.ts` importing from `./tools` again; a copied (not
 * re-exported) `setClientPriceAdjustments` in `lib/tools.ts`.
 */

test("TOOL_KINDS matches TOOLS: same ids in the same order, same group and output", () => {
  assert.deepEqual([...TOOL_IDS], TOOLS.map((t) => t.id));
  for (const t of TOOLS) {
    assert.deepEqual(TOOL_KINDS[t.id], { group: t.group, output: t.output }, t.id);
  }
});

test("toolKindOf: own keys only (unknown and prototype names are not tools)", () => {
  assert.deepEqual(toolKindOf("slide"), { group: "umumiy", output: "pptx" });
  for (const bad of ["", "unknown-type", "constructor", "toString", "__proto__"]) {
    assert.ok(toolKindOf(bad) === undefined, bad);
  }
});

test("fileCategory: same answer as the TOOLS-based rule for every tool and for unknown types", () => {
  const old = (type: string) => {
    const tool = TOOLS.find((t) => t.id === type);
    if (!tool) return "docs";
    if (tool.group === "oyinlar") return "games";
    if (tool.id === "test") return "tests";
    if (tool.output === "pptx") return "slide";
    if (tool.output === "png") return "image";
    return "docs";
  };
  for (const t of TOOLS) assert.equal(fileCategory(t.id), old(t.id), t.id);
  for (const t of ["", "legacy-type", "constructor"]) assert.equal(fileCategory(t), "docs", t);
  // Spot checks from FE-08 (each filter has members).
  assert.equal(fileCategory("pro-slide"), "slide");
  assert.equal(fileCategory("infographic"), "image");
  assert.equal(fileCategory("test"), "tests");
  assert.equal(fileCategory("sorting"), "games");
  assert.equal(fileCategory("podcast"), "docs");
});

test("lib/tools re-exports the price-adjust bindings (one client registry)", () => {
  for (const name of [
    "PRICE_PERCENT_MIN",
    "PRICE_PERCENT_MAX",
    "PRICE_ROUND_TO",
    "isPriceAdjust",
    "applyPriceAdjust",
    "parsePriceAdjustments",
    "setClientPriceAdjustments",
    "getClientPriceAdjust",
    "clientAdjustedPrice",
  ] as const) {
    assert.ok((tools as Record<string, unknown>)[name] === (priceAdjust as Record<string, unknown>)[name], `${name} is not the same binding`);
  }
});

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  if (/\.(tsx?|mts)$/.test(base) && existsSync(base)) return base;
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  return null;
}

/** Static, non-type imports only: what lands in the same client chunk. */
function staticGraph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const stack: [string, string[]][] = [[entry, [entry]]];
  while (stack.length) {
    const [file, chain] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^(?:import|export)\s+(?!type\s)(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm)) {
      const next = resolveImport(file, m[1]!);
      if (next) stack.push([next, [...chain, next]]);
    }
  }
  return seen;
}

test("store.ts / ui.ts / price-adjust.ts do not pull lib/tools.ts or lib/generation/** into the shared layer", () => {
  for (const entry of ["lib/store.ts", "lib/ui.ts", "lib/price-adjust.ts", "lib/tool-kinds.ts"]) {
    const graph = staticGraph(path.join(ROOT, entry));
    for (const [file, chain] of graph) {
      const rel = path.relative(ROOT, file);
      assert.ok(rel !== "lib/tools.ts" && !rel.startsWith("lib/generation/"), `${entry} reaches ${rel}: ${chain.map((f) => path.relative(ROOT, f)).join(" → ")}`);
    }
  }
});
