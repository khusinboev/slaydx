import test from "node:test";
import assert from "node:assert/strict";
import { digitsOf, formatPhone, normalizePhone } from "../lib/phone.ts";

/**
 * Telefon formatlash (Rezyume 2, 1-band).
 *
 * Saqlash shakli va KO'RSATISH shakli ataylab ajratilgan: bazaga
 * `+998901234567`, ekranga `+998 90 123 45 67`. Aks holda bir xil raqam
 * bo'shliqlari bilan ikki xil yozilib, profil va rezyume ajralib ketardi.
 */

test("normalizePhone: har qanday yozuvdan bitta shakl", () => {
  assert.equal(normalizePhone("+998 90 123 45 67"), "+998901234567");
  assert.equal(normalizePhone("998-90-123-45-67"), "+998901234567");
  // Xalqaro `00` prefiksi `+` bilan bir xil ma'noda.
  assert.equal(normalizePhone("00998901234567"), "+998901234567");
  assert.equal(normalizePhone("(90) 123 45 67"), "+901234567");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone("   "), "");
  assert.equal(digitsOf("+998 (90) 123-45-67"), "998901234567");
});

test("formatPhone: O'zbekiston raqami 2-3-2-2 guruhlanadi", () => {
  assert.equal(formatPhone("+998901234567"), "+998 90 123 45 67");
  // Foydalanuvchi yozayotgan payt: to'liq bo'lmagan raqam ham formatlanadi.
  assert.equal(formatPhone("99890"), "+998 90");
  assert.equal(formatPhone("998901"), "+998 90 1");
  assert.equal(formatPhone("998"), "+998");
});

test("formatPhone: boshqa mamlakat kodlari o'z naqshi bilan", () => {
  // MUTATSIYA: `GROUPS` jadvalini olib tashlab hamma joyda 3-3-4 qilinsa,
  // birinchi assertion 998 uchun «+998 901 234 567» berib qizil bo'ladi.
  assert.equal(formatPhone("+79123456789"), "+7 912 345 67 89");
  assert.equal(formatPhone("+14155550123"), "+1 415 555 0123");
  // Ro'yxatda yo'q kod: 2 raqamli kod + umumiy 3-3-4.
  assert.equal(formatPhone("+491701234567"), "+49 170 123 4567");
});

test("formatPhone: 15 raqamdan (E.164 chegarasi) oshmaydi va bo'sh kirish bo'sh qoladi", () => {
  assert.equal(formatPhone(""), "");
  assert.equal(digitsOf(formatPhone("9".repeat(30))).length, 15);
});
