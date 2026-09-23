import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnTo } from "../lib/safe-return.ts";

/**
 * C02/FE-01/SECA-02 — `safeReturnTo` login'dan keyingi yo'naltirishni
 * faqat saytning o'zidagi "/uz" ostidagi yo'llar bilan cheklaydi.
 * Jadval xavfsiz va xavfli qiymatlarni yonma-yon sinaydi (AUDIT
 * fixer-brief §5 "mutation check" uchun har qator alohida ahamiyatli).
 */

const ACCEPT: string[] = ["/uz", "/uz/files/1", "/uz/purchase?order=abc", "/uz/create#top"];

const REJECT: Array<[string, unknown]> = [
  ["javascript: sxemasi", "javascript:alert(1)"],
  ['JavaScript: — katta harf sxema ham "/" bilan boshlanmaydi', "JavaScript:alert(1)"],
  ["boshida bo'shliq bilan yashiringan javascript:", " javascript:alert(1)"],
  ["protokol-nisbiy // — boshqa hostga", "//evil.com"],
  ["teskari chiziq bilan boshlangan /\\evil.com", "/\\evil.com"],
  ["to'liq tashqi https:// manzil", "https://evil.com"],
  ["xom boshqaruv belgisi bilan /uz", "\x01/uz"],
  ["foizli kodlash bilan yashiringan //evil.com", "/%2F%2Fevil.com"],
  ["data: sxemasi", "data:text/html,<script>alert(1)</script>"],
  ["/uz emas boshqa nisbiy yo'l", "/en/files/1"],
  ["bo'sh satr", ""],
  ["string bo'lmagan qiymat (raqam)", 42],
  ["string bo'lmagan qiymat (null)", null],
  ["string bo'lmagan qiymat (obyekt)", { toString: () => "/uz" }],
  // Reviewer topilmasi (`audit/reviews/W1-B.md`): xom satrda "/uz/" bilan
  // boshlanadi, lekin `URL` RESOLVE qilganda ".." "/uz" segmentini yutib,
  // natija "//evil.com" (protokol-nisbiy, boshqa host) bo'lib qoladi.
  ["nuqta segmenti bilan //evil.com", "/uz/..//evil.com"],
  ["foizli nuqta segmenti bilan //evil.com", "/uz/%2e%2e//evil.com"],
  // ".." bilan "/uz" doirasidan butunlay chiqib ketish (boshqa marshrutga).
  ["/uz doirasidan chiqish (..) — boshqa marshrutga", "/uz/../api/auth/logout"],
];

test("safeReturnTo: xavfsiz /uz yo'llarini o'zgarishsiz qaytaradi", () => {
  for (const v of ACCEPT) {
    assert.equal(safeReturnTo(v), v, `qabul qilinishi kerak edi: ${v}`);
  }
});

test("safeReturnTo: zararsiz nuqta segmentini normallashtiradi ('/uz' doirasida qolganda)", () => {
  assert.equal(safeReturnTo("/uz/./files/1"), "/uz/files/1");
});

test("safeReturnTo: xavfli/begona qiymatlarni null qiladi", () => {
  for (const [label, v] of REJECT) {
    assert.equal(safeReturnTo(v), null, `rad etilishi kerak edi (${label}): ${JSON.stringify(v)}`);
  }
});
