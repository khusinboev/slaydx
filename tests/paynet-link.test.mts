import test from "node:test";
import assert from "node:assert/strict";
import { paynetPayLink } from "../lib/paynet-link.ts";

/**
 * The prefilled Paynet app link (owner 2026-11-01): `c` = payer id, `a` = amount in TIYIN.
 * Mutations (each red): `a` in so'm; `c` not set; the https check dropped.
 */
test("paynetPayLink: keeps the merchant, adds the payer id and the amount in tiyin", () => {
  assert.equal(paynetPayLink("https://app.paynet.uz/?m=54883", "1234", 25_000), "https://app.paynet.uz/?m=54883&c=1234&a=2500000");
  assert.equal(paynetPayLink("https://app.paynet.uz/?m=54883", "vk-77", 1_000), "https://app.paynet.uz/?m=54883&c=vk-77&a=100000");
});

test("paynetPayLink: replaces stale c/a on the base, omits a for a non-positive or fractional amount", () => {
  assert.equal(paynetPayLink("https://app.paynet.uz/?m=1&c=old&a=5", "9", 0), "https://app.paynet.uz/?m=1&c=9");
  assert.equal(paynetPayLink("https://app.paynet.uz/?m=1", "9", 10.5), "https://app.paynet.uz/?m=1&c=9");
  assert.equal(paynetPayLink("https://app.paynet.uz/?m=1&a=5", "9", 2_000), "https://app.paynet.uz/?m=1&a=200000&c=9");
});

test("paynetPayLink: null for a non-https or unparsable base", () => {
  assert.equal(paynetPayLink("http://app.paynet.uz/?m=1", "9", 1_000), null);
  assert.equal(paynetPayLink("javascript:alert(1)", "9", 1_000), null);
  assert.equal(paynetPayLink("not a url", "9", 1_000), null);
});
