import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * Ops sprint P-FE (docs/ops/O4-frontend-speed.md WP-B phase 1 + WP-C): what
 * must NOT be in a route's first load. Like `tests/bundle-split.test.mts`, no
 * build: walk the static (non-type) import graph; `import()` is a chunk
 * boundary and is not followed.
 *
 * Mutations (each turned this file red): a static `import SlideThumb from
 * "./SlideThumb"` in FilePreview; a static `GameSharePanel` import in
 * ResultView; `ESSAY_HIDDEN_GROUPS` imported from `ArticleReviewPanel` in
 * ResultView; `lib/store.ts` importing from `./tools`.
 */
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  if (/\.(tsx?|mts|json)$/.test(base) && existsSync(base)) return base;
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  return null;
}

function staticGraph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const stack: [string, string[]][] = [[entry, [entry]]];
  while (stack.length) {
    const [file, chain] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    if (file.endsWith(".json")) continue;
    const src = readFileSync(file, "utf8");
    const re = /^(?:import|export)\s+(?:type\s+)?[^;]*?from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm;
    for (const m of src.matchAll(re)) {
      if (/^(?:import|export)\s+type\s/.test(m[0])) continue;
      const spec = m[1] ?? m[2]!;
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const next = resolveLocal(file, spec);
      if (next) stack.push([next, [...chain, next]]);
    }
  }
  return seen;
}

function assertUnreachable(entry: string, forbidden: string[]) {
  const g = staticGraph(path.join(ROOT, entry));
  for (const f of forbidden) {
    const hit = g.get(path.join(ROOT, f));
    assert.ok(!hit, `${entry} statically reaches ${f}: ${hit?.map((x) => path.relative(ROOT, x)).join(" → ")}`);
  }
}

function assertReachable(entry: string, file: string) {
  assert.ok(staticGraph(path.join(ROOT, entry)).has(path.join(ROOT, file)), `${entry} no longer reaches ${file} — the check above proves nothing`);
}

test("WP-C: the file list (/uz/files, Ishlarim) and Bosh (/uz) do not ship the slide layout engine; the thumbnail chunk does", () => {
  // The list moved from /uz to /uz/files (redesign F0); Bosh may show file cards too, never the engine.
  for (const entry of ["app/uz/files/page.tsx", "app/uz/page.tsx"]) {
    assertUnreachable(entry, ["components/home/SlideThumb.tsx", "components/viewers/SlideCanvas.tsx", "lib/generation/slide-layout.ts"]);
  }
  // Guard against a vacuous pass: the cards are still on the page, the engine is behind import().
  assertReachable("app/uz/files/page.tsx", "components/home/FilePreview.tsx");
  assertReachable("components/home/SlideThumb.tsx", "lib/generation/slide-layout.ts");
  assert.match(readFileSync(path.join(ROOT, "components/home/FilePreview.tsx"), "utf8"), /lazy\(\(\) => import\("\.\/SlideThumb"\)/);
});

test("WP-C: the result page does not ship the readiness report or the game share panel", () => {
  for (const entry of ["app/uz/files/[id]/page.tsx", "components/files/ResultView.tsx"]) {
    assertUnreachable(entry, ["components/files/GameSharePanel.tsx", "components/viewers/ArticleReviewPanel.tsx", "components/files/ArticleReviewSection.tsx"]);
  }
  assertReachable("components/files/ResultView.tsx", "components/files/lazy-panels.tsx");
  const lazy = readFileSync(path.join(ROOT, "components/files/lazy-panels.tsx"), "utf8");
  assert.match(lazy, /import\("\.\/ArticleReviewSection"\)/);
  assert.match(lazy, /import\("\.\/GameSharePanel"\)/);
});

test("WP-B phase 1: shared layer and registry-free routes do not ship lib/tools.ts", () => {
  for (const entry of ["components/providers.tsx", "app/o/[token]/page.tsx", "lib/store.ts", "lib/ui.ts"]) {
    assertUnreachable(entry, ["lib/tools.ts", "lib/generation/teacher/input.ts", "lib/generation/essay/registry.ts"]);
  }
});
