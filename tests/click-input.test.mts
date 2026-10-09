import test from "node:test";
import assert from "node:assert/strict";
import {
  cardNumberError,
  formatCardNumber,
  formatExpiry,
  formatPhoneLocal,
  normalizeCardNumber,
  normalizePhone,
  normalizeSmsCode,
  parseExpiry,
  phoneError,
  smsCodeError,
} from "../lib/click-input.ts";
import { MAX_TOPUP_SOUM, MIN_TOPUP_SOUM, topupAmountError, topupRangeMessage } from "../lib/topup-limits.ts";

/**
 * Pure input rules shared by the wallet dialog (inline hints) and the Click API routes
 * (validation). Synthetic numbers only.
 */

test("card number: 16 digits with an Uzcard (8600, 5614) or Humo (9860) prefix", () => {
  assert.equal(normalizeCardNumber("8600 1234 5678 9012"), "8600123456789012");
  assert.equal(normalizeCardNumber("5614123456789012"), "5614123456789012");
  assert.equal(normalizeCardNumber("9860-1234-5678-9012"), "9860123456789012");
  for (const bad of ["", "8600 1234 5678 901", "8600 1234 5678 90123", "4111 1111 1111 1111", "1234123412341234", "8600abcd"]) {
    assert.equal(normalizeCardNumber(bad), null, bad);
  }
  assert.equal(cardNumberError("8600 1234 5678 9012"), null);
  assert.match(cardNumberError("")!, /kiriting/);
  assert.match(cardNumberError("8600 1234")!, /16 ta raqam/);
  assert.match(cardNumberError("4111 1111 1111 1111")!, /Uzcard.*Humo/);
  assert.equal(formatCardNumber("86001234567890129999"), "8600 1234 5678 9012", "capped at 16 digits");
  assert.equal(formatCardNumber("86001"), "8600 1");
});

test("expiry: MM/YY -> MMYY, month 01-12, valid through the end of its month", () => {
  const now = new Date(2026, 9, 9); // 2026-10-09
  assert.deepEqual(parseExpiry("12/28", now), { ok: true, mmyy: "1228" });
  assert.deepEqual(parseExpiry("1228", now), { ok: true, mmyy: "1228" });
  assert.deepEqual(parseExpiry("10 / 26", now), { ok: true, mmyy: "1026" }, "the current month is still valid");
  for (const bad of ["09/26", "12/25", "00/28", "13/28", "1/28", "", "12/2", "abcd"]) {
    assert.equal(parseExpiry(bad, now).ok, false, bad);
  }
  assert.match((parseExpiry("09/26", now) as { error: string }).error, /tugagan/);
  assert.equal(formatExpiry("1228"), "12/28");
  assert.equal(formatExpiry("12"), "12");
  assert.equal(formatExpiry("1"), "1");
});

test("phone: +998 and 9 digits, any common spelling -> 998XXXXXXXXX", () => {
  for (const ok of ["+998 90 123 45 67", "998901234567", "90 123 45 67", "(90) 123-45-67", "+998901234567"]) {
    assert.equal(normalizePhone(ok), "998901234567", ok);
  }
  for (const bad of ["", "123", "+7 900 123 45 67", "9989012345678", "90 123 45 6"]) assert.equal(normalizePhone(bad), null, bad);
  assert.equal(phoneError("90 123 45 67"), null);
  assert.match(phoneError("90 123")!, /9 ta raqam/);
  assert.equal(formatPhoneLocal("901234567"), "90 123 45 67");
  assert.equal(formatPhoneLocal("+998901234567"), "90 123 45 67");
  assert.equal(formatPhoneLocal("90"), "90");
});

test("sms code: 4-8 digits", () => {
  assert.equal(normalizeSmsCode("482915"), "482915");
  assert.equal(normalizeSmsCode("48 29 15"), "482915");
  for (const bad of ["", "123", "123456789", "abcdef"]) assert.equal(normalizeSmsCode(bad), null, bad);
  assert.equal(smsCodeError("482915"), null);
  assert.match(smsCodeError("12")!, /4-8/);
});

test("top-up limits: 1 000 - 10 000 000 so'm, one shared source", () => {
  assert.equal(MIN_TOPUP_SOUM, 1_000);
  assert.equal(MAX_TOPUP_SOUM, 10_000_000);
  for (const ok of [1_000, 1_001, 25_000, 10_000_000]) assert.equal(topupAmountError(ok), null, String(ok));
  for (const bad of [0, -5, 999, 10_000_001, Number.NaN, Number.POSITIVE_INFINITY]) assert.notEqual(topupAmountError(bad), null, String(bad));
  assert.match(topupAmountError(999)!, /Eng kam summa/);
  assert.match(topupAmountError(10_000_001)!, /Eng ko'p summa/);
  assert.match(topupRangeMessage(), /^Summa 1\s000 — 10\s000\s000 so'm/);
});
