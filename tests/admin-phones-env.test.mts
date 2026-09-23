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
 */
async function loadFresh() {
  return import(`../lib/server/admin-phones.ts?t=${Date.now()}-${Math.random()}`);
}

test("ADMIN_PHONES o'rnatilmasa — hardcode ro'yxat ishlaydi", async () => {
  delete process.env.ADMIN_PHONES;
  const { isAdminPhone } = await loadFresh();
  assert.equal(isAdminPhone("+998976063896"), true, "hardcode standart raqam ishlashi kerak");
  assert.equal(isAdminPhone("+998901112233"), false);
});

test("ADMIN_PHONES o'rnatilsa — hardcode ro'yxatni TO'LIQ ALMASHTIRADI (birlashtirmaydi)", async () => {
  process.env.ADMIN_PHONES = "+998901112233";
  const { isAdminPhone } = await loadFresh();
  assert.equal(isAdminPhone("+998901112233"), true, "env'dagi raqam admin bo'lishi kerak");
  assert.equal(
    isAdminPhone("+998976063896"),
    false,
    "env o'rnatilganda ESKI hardcode raqam ENDI admin bo'lmasligi kerak — aks holda almashtirish emas, qo'shish bo'lardi",
  );
  delete process.env.ADMIN_PHONES;
});

test("ADMIN_PHONES vergul bilan ro'yxat va bo'sh joylarni qo'llab-quvvatlaydi", async () => {
  process.env.ADMIN_PHONES = " +998901112233 , +998907654321 ";
  const { isAdminPhone } = await loadFresh();
  assert.equal(isAdminPhone("+998901112233"), true);
  assert.equal(isAdminPhone("+998907654321"), true);
  assert.equal(isAdminPhone("+998976063896"), false);
  delete process.env.ADMIN_PHONES;
});

test("ADMIN_PHONES bo'sh qator bo'lsa hardcode'ga qaytadi (falls back, replace emas)", async () => {
  process.env.ADMIN_PHONES = "";
  const { isAdminPhone } = await loadFresh();
  assert.equal(isAdminPhone("+998976063896"), true, "bo'sh env — 'o'rnatilmagan' bilan bir xil ishlashi kerak");
  delete process.env.ADMIN_PHONES;
});
