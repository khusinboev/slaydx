/**
 * Admin ro'yxati — HARDCODE, bazada emas.
 *
 * So'ralgan talab shu edi: admin bazaviy `is_admin` bayrog'i bilan emas,
 * kodda qat'iy ro'yxat bilan belgilanadi. Buning amaliy foydasi —
 * adminlikni o'zgartirish uchun kodni deploy qilish kerak, ya'ni baza
 * buzilsa yoki kimdir noto'g'ri qatorni yangilasa ham begona odam
 * o'zini admin qila olmaydi.
 *
 * Yangi admin qo'shish: shu ro'yxatga raqam yozib, deploy qilinadi.
 *
 * Bu fayl ATAYLAB sof — hech narsa import qilmaydi. `session.ts` (har
 * so'rovda ishlaydi) ham, `admin.ts` (route himoyasi) ham shu yerdan
 * oladi; ikkalasini bittasiga birlashtirish `session.ts` ↔ `admin.ts`
 * aylanma importini keltirib chiqarardi.
 */
const ADMIN_PHONES = ["+998976063896"];

/**
 * Telefon raqamini raqamlarga tekislaydi.
 *
 * Turli formatlar bir xil natija berishi kerak: "+998 97 606 38 96",
 * "998976063896", "+998-97-606-38-96" — hammasi bitta kalitga tushadi.
 * Milliy format (mamlakat kodisiz, 9 xonali, masalan "976063896") ham
 * qo'llab-quvvatlanadi: "998" ustiga qo'yiladi.
 */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length === 9 ? `998${digits}` : digits;
}

/**
 * Admin tekshiruvi UCHUN qat'iy raqamlash — `normalizePhone`dan farqli,
 * 9 xonali qiymatni HECH QACHON `998` bilan kengaytirmaydi.
 *
 * SECA-01/DEPS-08: agar bu yerda ham `normalizePhone` (milliy-format
 * kengaytirish) ishlatilsa, admin raqamining mamlakat kodisiz shakli
 * (`+<9 raqam>`) — hatto boshqa yo'l bilan (masalan eski/qo'lda
 * yozilgan qator) bazaga tushib qolsa ham — admin deb tanilardi. Admin
 * tekshiruvi har doim faqat ANIQ, to'liq raqam bilan solishtirilishi
 * kerak; qisqartirilgan/milliy shakl mos kelmasin.
 */
function strictDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

const ADMIN_STRICT_DIGITS = new Set(ADMIN_PHONES.map(strictDigits));

export function isAdminPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return ADMIN_STRICT_DIGITS.has(strictDigits(phone));
}
