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
 * Bu fayl ATAYLAB sof — hech narsa import qilmaydi (shu jumladan
 * `lib/server/env.ts`): `process.env.ADMIN_PHONES` to'g'ridan-to'g'ri shu
 * yerda o'qiladi. `session.ts` (har so'rovda ishlaydi) ham, `admin.ts`
 * (route himoyasi) ham shu yerdan oladi; ikkalasini bittasiga birlashtirish
 * `session.ts` ↔ `admin.ts` aylanma importini keltirib chiqarardi.
 *
 * DEPS-01/DEPS-08 (audit/production-readiness): admin raqami ochiq
 * (public) repo'da hardcode qilingani PII/recon xavfi. Shuning uchun
 * `ADMIN_PHONES` env o'rnatilgan bo'lsa (vergul bilan ro'yxat, masalan
 * `ADMIN_PHONES=+998901112233,+998907654321`), u hardcode ro'yxatni
 * TO'LIQ ALMASHTIRADI (fallback emas — aks holda raqam baribir ochiq
 * qoladi). Env O'RNATILMASA, pastdagi hardcode ishlaydi — bu ATAYLAB:
 * prod'ga `ADMIN_PHONES` qo'shilmasdan deploy qilinsa ham admin kirishi
 * buzilmasin. EGASI QADAMI: prod `.env`ga `ADMIN_PHONES` qo'shing, keyin
 * quyidagi hardcode qatorni reponi kommit qilib o'chirib tashlash mumkin.
 *
 * Yagona joy — bu hardcode fallback qatorda. Repo bo'ylab (audit/production-
 * readiness C05, `tests/no-pii-in-repo.test.mts`) real admin raqamining
 * FAQAT shu bitta nusxasiga ruxsat berilgan; boshqa hech qaysi fayl/izoh/
 * test bu raqamni takrorlamasin (testlar quyidagi
 * `ADMIN_PHONES_FALLBACK_FOR_TESTS` orqali solishtirsin).
 */
const ADMIN_PHONES_FALLBACK = ["+998976063896"];

const ADMIN_PHONES_ENV = (process.env.ADMIN_PHONES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_PHONES = ADMIN_PHONES_ENV.length > 0 ? ADMIN_PHONES_ENV : ADMIN_PHONES_FALLBACK;

/**
 * FAQAT testlar uchun — `tests/admin-phones-env.test.mts` fallback
 * xatti-harakatini ("env o'rnatilmasa hardcode ishlaydi") real raqamni
 * o'zida qayta yozmasdan tekshirishi uchun.
 */
export const ADMIN_PHONES_FALLBACK_FOR_TESTS = ADMIN_PHONES_FALLBACK[0];

/**
 * Telefon raqamini raqamlarga tekislaydi.
 *
 * Turli formatlar bir xil natija berishi kerak: "+998 90 000 00 01",
 * "998900000001", "+998-90-000-00-01" — hammasi bitta kalitga tushadi
 * (raqamlar shunchaki FORMAT namunasi, admin bilan bog'liq emas).
 * Milliy format (mamlakat kodisiz, 9 xonali, masalan "900000001") ham
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
