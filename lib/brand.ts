/**
 * Brend — bitta manba.
 *
 * Loyiha `sodda.ai` klonidan boshlangan va nom kodning to'rt joyida
 * qattiq yozilgan edi (yon panel, sahifa sarlavhasi, PPTX metadatasi),
 * fallback esa uch joyda takrorlangan. Nomni almashtirish — huquqiy
 * jihatdan ochilishdan oldin BAJARILISHI SHART bo'lgan ish — kod bo'ylab
 * qidiruvni talab qilardi.
 *
 * Endi u ikkita muhit o'zgaruvchisi:
 *   NEXT_PUBLIC_BRAND_NAME  — ko'rinadigan nom
 *   NEXT_PUBLIC_BRAND_LOGO  — `public/` ichidagi logo yo'li
 *
 * `NEXT_PUBLIC_*` build vaqtida o'rnatiladi, shuning uchun bu modulni
 * ham server, ham klient komponentlari import qila oladi.
 */
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || "Sodda.ai";
export const BRAND_LOGO = process.env.NEXT_PUBLIC_BRAND_LOGO || "/logo.png";

/** Fayl metadatasi uchun: bo'shliqsiz, ASCII ga yaqin qisqa nom. */
export const BRAND_SHORT = BRAND_NAME.split(/[\s.]+/)[0] || "Sodda";
