import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_SYNC_FIELDS, profilePatchFrom } from "../lib/profile-sync.ts";
import { profileDefaults } from "../lib/tools.ts";

/**
 * Muallif ma'lumotlari profilga QAYTIB yoziladi (Formalar 2): faqat
 * o'zgarganlari, bo'sh qiymat ham o'zgarish sifatida.
 */
const profile = { author: "Aliyev Ali", position: "", organization: "12-maktab", subject: "Biologiya" };

test("o'zgarmagan forma → bo'sh patch (tarmoq bekorga ketmaydi)", () => {
  assert.deepEqual(profilePatchFrom({ ...profile }, profile), {});
  // Bo'shliqlar farq emas.
  assert.deepEqual(profilePatchFrom({ ...profile, author: "  Aliyev   Ali " }, profile), {});
});

test("faqat o'zgargan maydonlar; bo'sh qiymat ham yuboriladi (foydalanuvchi tozalagan)", () => {
  const patch = profilePatchFrom({ ...profile, position: "Fizika o‘qituvchisi", organization: "" }, profile);
  // MUTATSIYA: `if (next !== cur)` sharti olib tashlansa — to'rtala maydon keladi; bo'sh qiymat filtrlansa — organization yo'qoladi.
  assert.deepEqual(patch, { position: "Fizika o‘qituvchisi", organization: "" });
});

test("forma qiymati yo'q (undefined) bo'lsa — bo'sh deb hisoblanadi", () => {
  assert.deepEqual(profilePatchFrom({}, { ...profile, position: "x" }), { author: "", organization: "", subject: "", position: "" });
});

test("profileDefaults: position va organization (universitet zaxirasi bilan) formaga tushadi", () => {
  const d = profileDefaults({ author: "A", university: "TDPU" });
  assert.equal(d.position, "");
  assert.equal(d.organization, "TDPU", "tashkilot bo'lmasa universitet");
  assert.equal(profileDefaults({ university: "TDPU", organization: "12-maktab" }).organization, "12-maktab");
  for (const f of PROFILE_SYNC_FIELDS) assert.ok(f in d, `${f} standart qiymatlarda bo'lishi kerak`);
});
