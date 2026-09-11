import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Hujjat ko'ruvchisi shrifti (AUDIT-17 R5). `@theme` dagi
 * `--font-doc: var(--font-tinos), …` `:root` da HISOBLANADI — `--font-tinos`
 * (next/font) faqat `<body>` da bo'lsa `:root` dagi `var()` topilmaydi va
 * `--font-doc` butunlay yaroqsiz bo'ladi; `.word-inner { font-family:
 * var(--font-doc) }` `unset` ga tushib, hujjat Times o'rniga Geist (sans)
 * bilan chizilardi — DOCX 6 bet, ko'ruvchi 7 (CDP `getPlatformFontsForNode`
 * bilan topildi). Ikki himoya: o'zgaruvchilar `<html>` da, `var()` fallback bilan.
 */
test("next/font o'zgaruvchilari <html> da; --font-doc `var(--font-tinos, …)` fallback bilan", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const html = /<html[^>]*className=\{`([^`]*)`\}/.exec(layout);
  assert.ok(html, "<html> da className yo'q");
  for (const v of ["geist.variable", "geistMono.variable", "tinos.variable"]) {
    assert.ok(html![1].includes(`\${${v}}`), `${v} <html> da emas`);
  }
  assert.ok(!/<body[^>]*tinos\.variable/.test(layout), "tinos.variable <body> da qolgan");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const doc = /--font-doc:\s*([^;]+);/.exec(css);
  assert.ok(doc, "--font-doc e'lon qilinmagan");
  assert.match(doc![1], /var\(--font-tinos,\s*"Tinos"\)/, "fallbacksiz var(--font-tinos) — :root da yaroqsiz bo'ladi");
  assert.match(doc![1], /"Times New Roman"/);
});
