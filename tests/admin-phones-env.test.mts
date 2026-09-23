import test from "node:test";
import assert from "node:assert/strict";

/**
 * `ADMIN_PHONES` env orqali admin ro'yxatini almashtirish (DEPS-01/DEPS-08).
 *
 * `lib/server/admin-phones.ts` modul darajasida `process.env.ADMIN_PHONES`ni
 * BIR MARTA o'qiydi (import paytida) — shuning uchun har test o'z holatini
 * ko'rishi uchun modulni cache-buster query bilan QAYTA import qilamiz.
 * `lib/server/env.ts` bu faylni import QILMAYDI (ataylab sof) — shu sabab
 * bu yerda ham import qilinmaydi, `process.env` to'g'ridan-to'g'ri.
 *
 * MUHIM (C05/no-pii-in-repo): bu faylda haqiqiy admin raqami HECH QACHON
 * yozilmaydi — hardcode fallback bilan solishtirish
 * `ADMIN_PHONES_FALLBACK_FOR_TESTS` orqali, env'ga esa faqat O'YLAB TOPILGAN
 * (sinov) raqamlar beriladi.
 */
async function loadFresh() {
  return import(`../lib/server/admin-phones.ts?t=${Date.now()}-${Math.random()}`);
}

const FAKE_1 = "+998900000001";
const FAKE_2 = "+998900000002";

test("ADMIN_PHONES o'rnatilmasa — hardcode fallback ishlaydi", async () => {
  delete process.env.ADMIN_PHONES;
  const { isAdminPhone, ADMIN_PHONES_FALLBACK_FOR_TESTS } = await loadFresh();
  assert.equal(isAdminPhone(ADMIN_PHONES_FALLBACK_FOR_TESTS), true, "hardcode fallback ishlashi kerak");
  assert.equal(isAdminPhone(FAKE_1), false);
});

test("ADMIN_PHONES o'rnatilsa — hardcode ro'yxatni TO'LIQ ALMASHTIRADI (birlashtirmaydi)", async () => {
  process.env.ADMIN_PHONES = FAKE_1;
  const { isAdminPhone, ADMIN_PHONES_FALLBACK_FOR_TESTS } = await loadFresh();
  assert.equal(isAdminPhone(FAKE_1), true, "env'dagi raqam admin bo'lishi kerak");
  assert.equal(
    isAdminPhone(ADMIN_PHONES_FALLBACK_FOR_TESTS),
    false,
    "env o'rnatilganda ESKI hardcode raqam ENDI admin bo'lmasligi kerak — aks holda almashtirish emas, qo'shish bo'lardi",
  );
  delete process.env.ADMIN_PHONES;
});

test("ADMIN_PHONES vergul bilan ro'yxat va bo'sh joylarni qo'llab-quvvatlaydi", async () => {
  process.env.ADMIN_PHONES = ` ${FAKE_1} , ${FAKE_2} `;
  const { isAdminPhone, ADMIN_PHONES_FALLBACK_FOR_TESTS } = await loadFresh();
  assert.equal(isAdminPhone(FAKE_1), true);
  assert.equal(isAdminPhone(FAKE_2), true);
  assert.equal(isAdminPhone(ADMIN_PHONES_FALLBACK_FOR_TESTS), false);
  delete process.env.ADMIN_PHONES;
});

test("ADMIN_PHONES bo'sh qator bo'lsa hardcode'ga qaytadi (falls back, replace emas)", async () => {
  process.env.ADMIN_PHONES = "";
  const { isAdminPhone, ADMIN_PHONES_FALLBACK_FOR_TESTS } = await loadFresh();
  assert.equal(isAdminPhone(ADMIN_PHONES_FALLBACK_FOR_TESTS), true, "bo'sh env — 'o'rnatilmagan' bilan bir xil ishlashi kerak");
  delete process.env.ADMIN_PHONES;
});
