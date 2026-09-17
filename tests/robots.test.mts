import test from "node:test";
import assert from "node:assert/strict";
import robotsImport from "../app/robots.ts";

/*
 * `tsx`/esbuild interop bu loyihada "app/*.ts" konvensiya fayllarining
 * default eksportini IKKI QAVAT o'raydi (`{ default: [Getter] }`) — bu
 * `app/sitemap.ts` bilan ham takrorlanadi, faylga xos emas. Shuning
 * uchun ikkala shaklni ham qo'llab-quvvatlaymiz.
 */
const robots = (robotsImport as unknown as { default?: typeof robotsImport }).default ?? robotsImport;

/**
 * ROBOTS.TXT (AUDIT-22 R) — `/o/` (o'yin havolalari) qidiruvga tushmasin.
 *
 * `app/o/[token]/page.tsx`ning o'zida ham `robots: noindex, nofollow`
 * bor (sahifa darajasida), lekin robots.txt darajasidagi `disallow` —
 * ikkinchi qatlam: robot sahifani UMUMAN OLMASIN (bitta havolani
 * kimdir boshqa saytdan bog'lab qo'yса, `noindex` metasi robot uni
 * bir marta yuklamaguncha ko'rinmaydi).
 *
 * MUTATSIYA: `disallow` dan `/o/` olib tashlansa bu test qizaradi.
 */
test("robots: `/o/` (o'yin havolalari) va `/api/` disallow", () => {
  const r = robots();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  const disallow = ([] as string[]).concat(rule?.disallow ?? []);
  assert.ok(disallow.includes("/o/"), "MUTATSIYA: «/o/» disallow ro'yxatida yo'q");
  assert.ok(disallow.includes("/api/"), "«/api/» disallow ro'yxatida yo'q");
  assert.equal(rule?.allow, "/", "umumiy sayt ruxsat etilgan bo'lishi kerak");
});
