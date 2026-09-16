import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/*
 * KLIENT CHEGARASI: formalar (`components/forms/*Composer.tsx`) va
 * `lib/tools.ts` brauzer bandliga kiradi. Ularning tranzitiv importlari
 * `lib/server/**` yoki `import "server-only"` faylga yetmasligi kerak —
 * aks holda sahifa SSR da 500 beradi (AUDIT-19: `article/input.ts` →
 * `research/googlebooks.ts` → `cache.ts` → `lib/server/db.ts`).
 * jsdom/unit testlar buni ko'rmaydi (tsx `server-only` ni yutadi).
 */
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : path.resolve(path.dirname(from), spec);
  if (/\.(tsx?|mts)$/.test(base) && existsSync(base)) return base;
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  return null;
}

function walk(entry: string): { chain: string[]; server: string | null } {
  const seen = new Map<string, string[]>();
  const stack: [string, string[]][] = [[entry, [entry]]];
  while (stack.length) {
    const [file, chain] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    const src = readFileSync(file, "utf8");
    if (/^import\s+["']server-only["']/m.test(src) || file.includes(`${path.sep}lib${path.sep}server${path.sep}`)) return { chain, server: file };
    for (const m of src.matchAll(/^import\s+(?:type\s+)?[^;]*?from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm)) {
      const spec = m[1] ?? m[2]!;
      // `import type` faqat tiplar — bandlga kirmaydi.
      if (/^import\s+type\s/.test(m[0])) continue;
      const next = resolveImport(file, spec);
      if (next) stack.push([next, [...chain, next]]);
    }
  }
  return { chain: [], server: null };
}

const ENTRIES = ["lib/tools.ts", "components/forms/WorkComposer.tsx", "components/forms/ArticleComposer.tsx", "components/forms/EssayComposer.tsx", "components/forms/ToolWorkspace.tsx"];

for (const e of ENTRIES) {
  test(`klient chegarasi: ${e} server-only modulga yetmaydi`, () => {
    const r = walk(path.join(ROOT, e));
    assert.equal(r.server, null, `server modulga zanjir: ${r.chain.map((f) => path.relative(ROOT, f)).join(" → ")}`);
  });
}
