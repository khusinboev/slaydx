import test from "node:test";
import assert from "node:assert/strict";

/**
 * Xavfsizlik sarlavhalari (AUDIT-16 tuzatish): sayt O'Z faylini iframe'da
 * ko'rsata olishi kerak — Tarjimon «Fayl» tabi PDF'ni
 * `/api/generations/{id}/file?format=pdf&inline=1` dan oladi. Ilgari
 * `frame-src` faqat Telegram'ga ruxsat berardi → «content blocked».
 */
process.env.SESSION_SECRET ||= "test-session-secret-at-least-32-characters";

type Header = { key: string; value: string };
type Rule = { source: string; headers: Header[] };

async function rules(): Promise<Rule[]> {
  const cfg = (await import("../next.config.ts")).default as { headers?: () => Promise<Rule[]> };
  return cfg.headers!();
}
const csp = (r: Rule) => r.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
const directive = (v: string, name: string) => v.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

test("sayt CSP: frame-src 'self' — o'z PDF'imiz iframe'da ochiladi; Telegram saqlanadi", async () => {
  const site = (await rules()).find((r) => r.source === "/:path*")!;
  const fs = directive(csp(site), "frame-src");
  assert.ok(fs.includes("'self'"), `frame-src da 'self' yo'q: ${fs}`);
  assert.ok(fs.includes("https://oauth.telegram.org"), "Telegram login iframe'i saqlanishi kerak");
  // Boshqa qattiq direktivlar bo'shashmagan.
  assert.ok(directive(csp(site), "object-src").includes("'none'"));
  assert.ok(directive(csp(site), "frame-ancestors").includes("'self'"));
});

test("fayl marshruti: sayt CSP'si o'rniga faqat frame-ancestors 'self' (PDF ko'ruvchisiga halaqit bermaslik)", async () => {
  const file = (await rules()).find((r) => r.source === "/api/generations/:id/file");
  assert.ok(file, "fayl marshruti uchun alohida sarlavha qoidasi yo'q");
  assert.equal(csp(file!), "frame-ancestors 'self'");
});

test("Content-Disposition: standart attachment, inline faqat so'ralganda; nom UTF-8 bilan", async () => {
  const { contentDisposition } = await import("../app/api/generations/[id]/file/route.ts");
  assert.match(contentDisposition("hisobot-ja.pdf"), /^attachment; filename="hisobot-ja\.pdf"; filename\*=UTF-8''hisobot-ja\.pdf$/);
  assert.match(contentDisposition("hisobot-ja.pdf", "inline"), /^inline; filename="hisobot-ja\.pdf"/);
  assert.match(contentDisposition("Ichki yonuv (1)-ja.pdf", "inline"), /filename\*=UTF-8''Ichki%20yonuv%20\(1\)-ja\.pdf$/);
});
