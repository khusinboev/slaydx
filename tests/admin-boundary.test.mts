import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * ADMIN CHEGARASI (plan §2, §12).
 *
 * Statik manba skani (build yo'q):
 *   1. admin klient kodi (`components/admin/**`, `lib/admin-api/**`,
 *      `lib/admin-format.ts`, `app/admin/**`) hech qachon `lib/server/**` yoki
 *      `server-only` modulga yetmaydi (qiymat importlari; `import type` mumkin);
 *   2. iste'molchi kirish nuqtalari admin kodini STATIK import qilmaydi
 *      (aks holda admin URL'lari va kodi har foydalanuvchi bandliga tushadi — A8);
 *   3. `components/admin/**` da HTML ni xom kiritish API'si yo'q.
 */

const ROOT = resolve(import.meta.dirname, "..");
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"];
const CODE = /\.(tsx?|mts)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CODE.test(name)) out.push(p);
  }
  return out;
}

/** Qiymat importlari. `dynamic` — `import()` ham hisobga olinadimi. */
function specifiers(src: string, dynamic: boolean): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) if (!m[2]) out.push(m[3]);
  if (dynamic) for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, `index${e}`))];
  if (/\.(m?js)$/.test(base)) candidates.push(base.replace(/\.m?js$/, ".ts"));
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const rel = (f: string) => relative(ROOT, f);

/** `entries` dan boshlab grafni yuradi; `bad` ga tushgan har fayl uchun zanjir qaytaradi. */
function findViolations(
  entries: string[],
  opts: { dynamic: boolean; bad: (file: string, src: string, specs: string[]) => string | null },
): string[] {
  const parent = new Map<string, string | null>(entries.map((e) => [e, null]));
  const chainOf = (f: string): string => {
    const parts: string[] = [];
    for (let cur: string | null | undefined = f; cur; cur = parent.get(cur)) parts.unshift(rel(cur));
    return parts.join(" → ");
  };
  const problems: string[] = [];
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift()!;
    const src = readFileSync(file, "utf8");
    const specs = specifiers(src, opts.dynamic);
    const why = opts.bad(file, src, specs);
    if (why) problems.push(`${chainOf(file)} (${why})`);
    for (const spec of specs) {
      const next = resolveLocal(file, spec);
      if (!next || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  return problems;
}

const isUnder = (file: string, dir: string) => file.startsWith(join(ROOT, dir) + "/");

/** `"use client"` at the top of the module (after comments). */
function isClientModule(file: string): boolean {
  const head = readFileSync(file, "utf8").replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|\s)*/, "");
  return /^["']use client["']/.test(head);
}

function adminFiles(): string[] {
  return [
    ...walk(join(ROOT, "components/admin")),
    ...walk(join(ROOT, "lib/admin-api")),
    // Only the CLIENT modules of app/admin. Its server components (the gate
    // layouts, thin pages) run only on the server and must read the session and
    // RBAC from lib/server (plan §12); whatever they render on the client lives
    // in components/admin, which is scanned in full above.
    ...walk(join(ROOT, "app/admin")).filter(isClientModule),
    join(ROOT, "lib/admin-format.ts"),
  ];
}

test("admin klient kodi lib/server/** va server-only modullarga yetmaydi", () => {
  const entries = adminFiles();
  assert.ok(entries.length > 30, `admin fayllari topilmadi (${entries.length}) — skaner buzilgan`);
  // The app/admin filter must still pick up its client modules (e.g. the error boundary).
  if (existsSync(join(ROOT, "app/admin/(panel)/error.tsx"))) {
    assert.ok(
      entries.includes(join(ROOT, "app/admin/(panel)/error.tsx")),
      "app/admin klient modullari skanerdan tushib qolgan",
    );
  }
  const problems = findViolations(entries, {
    dynamic: true,
    bad: (file, src, specs) => {
      if (isUnder(file, "lib/server")) return "lib/server moduli";
      if (specs.includes("server-only") || /^\s*import\s+["']server-only["']/m.test(src)) return "server-only";
      return null;
    },
  });
  assert.deepEqual(problems, [], `admin klient grafiga server kodi tushadi:\n  ${problems.join("\n  ")}`);
});

test("iste'molchi kirish nuqtalari components/admin/** va lib/admin-api/** ni statik import qilmaydi", () => {
  const entries = [
    ...walk(join(ROOT, "app/uz")).filter((f) => /\/page\.tsx$/.test(f) && !isUnder(f, "app/uz/admin")),
    join(ROOT, "app/page.tsx"),
    ...walk(join(ROOT, "app/o")),
    ...walk(join(ROOT, "components/shell")),
    join(ROOT, "lib/store.ts"),
    join(ROOT, "lib/api-client.ts"),
  ].filter((f) => existsSync(f));
  assert.ok(entries.length > 8, `kirish nuqtalari topilmadi (${entries.length}) — skaner buzilgan`);
  const problems = findViolations(entries, {
    dynamic: false, // `import()` — alohida bo'lak, birinchi yuklanishga kirmaydi
    bad: (file) => (isUnder(file, "components/admin") || isUnder(file, "lib/admin-api") ? "admin kodi iste'molchi bandlida" : null),
  });
  assert.deepEqual(problems, [], `iste'molchi bandliga admin kodi tushadi:\n  ${problems.join("\n  ")}`);
});

test("components/admin/** da dangerouslySetInnerHTML yo'q", () => {
  const files = walk(join(ROOT, "components/admin"));
  assert.ok(files.length > 20, "components/admin fayllari topilmadi");
  const hits = files.filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML")).map(rel);
  assert.deepEqual(hits, []);
});
