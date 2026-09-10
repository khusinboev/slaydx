import type { FormValues, UserProfile } from "./types";

/**
 * Slayd formasidagi muallif maydonlari → profil yangilanishi (Formalar 2).
 *
 * Foydalanuvchi ismini, lavozimini, tashkilotini va fanini BIR MARTA
 * kiritadi — «Yaratish» muvaffaqiyatli bo'lgach o'zgarganlari
 * `PATCH /api/users/me` bilan profilga yoziladi va keyingi safar
 * standart bo'lib chiqadi. Faqat O'ZGARGAN maydonlar yuboriladi: har
 * yaratishda butun profilni qayta yozish tarmoq va jurnal uchun bekor.
 *
 * Bo'sh qiymat ham o'zgarish: foydalanuvchi maydonni ataylab tozalagan
 * bo'lsa, profil ham tozalanadi — aks holda o'chirilgan lavozim keyingi
 * safar yana chiqib qolardi.
 */
export const PROFILE_SYNC_FIELDS = ["author", "position", "organization", "subject"] as const;
export type ProfileSyncField = (typeof PROFILE_SYNC_FIELDS)[number];

export function profilePatchFrom(
  values: FormValues,
  profile: Pick<UserProfile, ProfileSyncField>,
): Partial<Record<ProfileSyncField, string>> {
  const patch: Partial<Record<ProfileSyncField, string>> = {};
  for (const f of PROFILE_SYNC_FIELDS) {
    const next = String(values[f] ?? "").replace(/\s+/g, " ").trim();
    const cur = String(profile[f] ?? "").replace(/\s+/g, " ").trim();
    if (next !== cur) patch[f] = next;
  }
  return patch;
}
