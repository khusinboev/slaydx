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
    const specs: string[] = [];
    for (const m of src.matchAll(/^import\s+(?:type\s+)?[^;]*?from\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm)) {
      // `import type` faqat tiplar — bandlga kirmaydi.
      if (/^import\s+type\s/.test(m[0])) continue;
      specs.push(m[1] ?? m[2]!);
    }
    // Dinamik import ham bandlga kiradi (Next chegara zanjiri `cache.ts` → `db.ts` ni aynan shu orqali ko'rdi).
    for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]!);
    for (const spec of specs) {
      const next = resolveImport(file, spec);
      if (next) stack.push([next, [...chain, next]]);
    }
  }
  return { chain: [], server: null };
}

/*
 * `lib/curriculum.ts` (AUDIT-20 R0) — ATAYLAB izomorf: forma «bu fanda
 * darslik rejimi bormi» degan savolga TARMOQSIZ javob berishi kerak
 * (`hasCurriculum`, `index.json` ~5 KB). Agar u mavzularni `node:fs`
 * bilan o'qishga o'tsa yoki server moduliga ulansa, WP-E ning
 * `CurriculumPicker` i sahifani SSR da 500 qilardi.
 */
const ENTRIES = [
  "lib/tools.ts",
  "lib/curriculum.ts",
  "components/forms/WorkComposer.tsx",
  "components/forms/ArticleComposer.tsx",
  "components/forms/EssayComposer.tsx",
  "components/forms/ToolWorkspace.tsx",
  // AUDIT-20 WP-E: `TeacherComposer` `lib/curriculum.ts` ni bevosita
  // import qiladi (`CurriculumPicker` orqali) — server modulga zanjir
  // sahifani SSR da 500 qilardi.
  "components/forms/TeacherComposer.tsx",
  "components/forms/CurriculumPicker.tsx",
  /*
   * AUDIT-22 R0: ochiq o'yin sahifasi (`app/o/[token]`) LOGINSIZ va
   * `lib/game/public.ts` ni bevosita import qiladi. U izomorf bo'lishi
   * SHART: `lib/server/**` ga zanjir sahifani SSR da 500 qilardi, ya'ni
   * o'quvchi havolani umuman ocha olmasdi.
   */
  "components/game/Player.tsx",
];

for (const e of ENTRIES) {
  test(`klient chegarasi: ${e} server-only modulga yetmaydi`, () => {
    const r = walk(path.join(ROOT, e));
    assert.equal(r.server, null, `server modulga zanjir: ${r.chain.map((f) => path.relative(ROOT, f)).join(" → ")}`);
  });
}
