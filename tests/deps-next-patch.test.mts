import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * DEPS-04: `next@15.5.23` da `npm audit` critical (GHSA-p293-qw3h-jr36 —
 * Windows RCE, GHSA-2xp9-vwfh-vxw4 — AVIF rasm optimizatori) edi. Ikkalasi
 * bu deployda yetib bo'lmas edi (Linux, `images.unoptimized`), lekin bir
 * minor ichidagi tuzatish (15.5.24+) bepul. 15.5.26 `sharp ^0.35.4` ni ham
 * qabul qiladi — `next` ichidagi zaif `sharp` nusxasi (GHSA-f88m-g3jw-g9cj,
 * GHSA-rgj7-g3m4-5g8c) yo'qoladi.
 *
 * Qolgan (yamoqsiz) bandlar: `next` o'zi QAT'IY `postcss@8.4.31` ni
 * bog'laydi (15.5.x ning hammasida) — faqat `next build` da, ishonchli
 * CSS bilan; `pptxgenjs` → `image-size` — o'lik kod; `js-yaml` — faqat
 * ESLint (dev). Batafsil — `audit/findings/security-secrets-deps.md`.
 */

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

function atLeast(v: string | undefined, min: [number, number, number]): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");
  if (!m) return false;
  const got = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) if (got[i] !== min[i]) return got[i]! > min[i];
  return true;
}

test("DEPS-04: next va eslint-config-next 15.5.24+ (critical advisory yamog'i), 15.5 minor ichida", () => {
  const next = lock.packages["node_modules/next"]?.version;
  const cfg = lock.packages["node_modules/eslint-config-next"]?.version;
  assert.ok(atLeast(next, [15, 5, 24]), `next ${next} — GHSA-p293-qw3h-jr36/GHSA-2xp9-vwfh-vxw4 yamog'i yo'q`);
  assert.match(next ?? "", /^15\.5\./, "major/minor o'zgarmasin (bu band faqat patch)");
  assert.equal(cfg, next, "eslint-config-next next bilan bir versiyada");
  assert.equal(lock.packages["node_modules/@next/env"]?.version, next);
});

test("DEPS-04: next ichida zaif sharp nusxasi yo'q — yuqori darajadagi sharp 0.35.4+", () => {
  assert.ok(!lock.packages["node_modules/next/node_modules/sharp"], "next/node_modules/sharp (<0.35.4) qaytib keldi");
  assert.ok(atLeast(lock.packages["node_modules/sharp"]?.version, [0, 35, 4]));
});
