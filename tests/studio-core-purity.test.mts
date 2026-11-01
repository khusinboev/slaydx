import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * `lib/studio-core/` must stay host-agnostic (docs/studio/P0-SPEC.md §2, PLAN §14): no import may leave the folder,
 * except P0 adapters wrapping today's request builders (`adapters/*` → `lib/generation/{image-provider-*,video,tts}`).
 * No `server-only`, no node built-ins: the client-safe parts are bundled into the browser.
 *
 * Mutation: an `import … from "../server/db"` added to `pricing.ts` turned this red, then removed.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CORE = join(ROOT, "lib/studio-core");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const ADAPTER_ALLOW = /^lib\/generation\/(image-provider[^/]*|video\/[^/]+|tts\/[^/]+|image-provider)$/;

test("studio-core imports stay inside the core", () => {
  const bad: string[] = [];
  for (const f of files(CORE)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"';]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const rel = relative(ROOT, f);
      if (!spec.startsWith(".")) {
        bad.push(`${rel} -> ${spec} (package / built-in)`);
        continue;
      }
      const target = relative(ROOT, resolve(dirname(f), spec)).replace(/\.ts$/, "");
      if (target.startsWith("lib/studio-core")) continue;
      if (rel.startsWith("lib/studio-core/adapters/") && ADAPTER_ALLOW.test(target)) continue;
      bad.push(`${rel} -> ${target}`);
    }
  }
  assert.deepEqual(bad, []);
});
