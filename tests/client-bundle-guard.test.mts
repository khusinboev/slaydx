import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

/**
 * KLIENT TO'PLAMI QO'RIQCHISI (audit W4-A R1).
 *
 * `"use client"` fayllaridan statik/dinamik importlar bo'ylab butun graf
 * yuriladi; unda Node-ga xos modul (`node:*`, `fs`, `dns`…) yoki faqat
 * serverda yashaydigan modullar (`safe-fetch`, `job-cost`, `server-only`)
 * bo'lmasligi SHART. Aks holda `next build` (Turbopack) «does not support
 * external modules (request: node:…)» bilan yiqiladi — W4-A da aynan shu
 * bo'ldi: `ImageStudio.tsx` katalog uchun `image-studio.ts` ni import
 * qilar, u esa `safe-fetch` (`node:dns`) va `job-cost` (`node:async_hooks`)
 * ni tortardi. Build'siz, bir soniyalik manba skani.
 */

const ROOT = resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["app", "components", "lib"];
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"];
const SERVER_ONLY_FILES = new Set(["lib/generation/safe-fetch.ts", "lib/generation/job-cost.ts"]);
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

function isClient(src: string): boolean {
  // Direktiva fayl boshida (izohlardan keyin) turadi.
  const head = src.replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n|\s)*/, "");
  return /^["']use client["']/.test(head);
}

/** Qiymat importlari (`import type`/`export type` o'chiriladi — to'plamga tushmaydi). */
function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const m of src.matchAll(re)) if (!m[2]) out.push(m[3]);
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
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

test("klient grafida node:* / Node built-in / server-only modul yo'q", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const clients = files.filter((f) => isClient(readFileSync(f, "utf8")));
  assert.ok(clients.length > 50, `"use client" fayllari topilmadi (${clients.length}) — skaner buzilgan`);

  const problems: string[] = [];
  const parent = new Map<string, string | null>(clients.map((c) => [c, null]));
  const chainOf = (f: string): string => {
    const parts: string[] = [];
    for (let cur: string | null | undefined = f; cur; cur = parent.get(cur)) parts.unshift(relative(ROOT, cur));
    return parts.join(" → ");
  };
  const queue = [...clients];
  while (queue.length) {
    const file = queue.shift()!;
    if (SERVER_ONLY_FILES.has(relative(ROOT, file))) {
      problems.push(`${chainOf(file)} (faqat server)`);
      continue;
    }
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (BUILTINS.has(spec) || spec === "server-only") {
        problems.push(`${chainOf(file)} → ${spec}`);
        continue;
      }
      const next = resolveLocal(file, spec);
      if (!next || parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  assert.deepEqual(problems, [], `klient to'plamiga server moduli tushadi:\n  ${problems.join("\n  ")}`);
});

test("rasm katalogi klient uchun xavfsiz modulda — image-studio.ts server yo'lida qoladi", () => {
  for (const f of ["components/forms/ImageStudio.tsx", "components/viewers/ImageViewer.tsx"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/from\s+["']@\/lib\/generation\/image-studio["']/.test(src), `${f}: server moduli image-studio.ts ni import qilmasin`);
  }
  const opts = readFileSync(join(ROOT, "lib/generation/image-studio-options.ts"), "utf8");
  assert.equal(specifiers(opts).length, 0, "image-studio-options.ts hech narsa import qilmasin");
});
