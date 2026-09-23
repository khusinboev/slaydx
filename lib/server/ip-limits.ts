import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Ochiq (sessiyasiz) yo'llarning chastota chegaralari — BIR joyda (C29:
 * SCALE-10, BEA-15, ABUSE-05, SECA-03).
 *
 * Muammo: O'zbek mobil operatorlari CGNAT ortida — yuzlab abonent BITTA
 * ochiq IPv4 dan chiqadi; maktab sinfi ham bitta IP. Ilgari yagona kirish
 * yo'lining birinchi qadami `ticket:new:${ip}` 5 daqiqada 10 ta edi —
 * Telegram postidan keyingi to'lqinda yoki sinfda 11-foydalanuvchi 429
 * olardi.
 *
 * Qoida:
 *   • IP — faqat TOSHQIN SHIPI (baza/botni ko'mib tashlamaslik uchun),
 *     NAT ga sig'adigan darajada keng;
 *   • qat'iy chegara SHAXS bo'yicha — brauzer (`sx_lt` cookie),
 *     identifikator (OTP), Telegram ID, o'yin tokeni;
 *   • taxmin qilish (brute force) himoyasi — faqat MUVAFFAQIYATSIZ
 *     urinishlar sanaladi (`peekRate` + xatoda `rateLimit`), shunda
 *     muvaffaqiyatli kirishlar NAT chelagini to'ldirmaydi.
 *
 * Sonlarni o'zgartirish faqat shu yerda. Egasi prod'dagi fan-in ni
 * `SELECT ip_hash, count(DISTINCT user_id) FROM sessions ...` bilan
 * tekshirib, kerak bo'lsa moslaydi.
 */
export const IP_LIMITS = {
  /** Kirish chiptasi — IP shipi (≈ 1 chipta/s bitta NAT dan). */
  ticketPerIp: { count: 300, windowSec: 300 },
  /** Kirish chiptasi — bitta brauzer (qayta bosishlar uchun yetarli). */
  ticketPerBrowser: { count: 10, windowSec: 300 },

  /** Sehrli havola — barcha urinishlar shipi. */
  enterPerIp: { count: 600, windowSec: 300 },
  /** Sehrli havola — faqat yaroqsiz/eskirgan tokenlar. */
  enterFailPerIp: { count: 60, windowSec: 300 },

  /** Telegram widget/Mini App — IP shipi (imzo tekshiruvidan oldin). */
  tgPerIp: { count: 300, windowSec: 300 },
  /** Imzosi buzuq so'rovlar (IP bo'yicha). */
  tgBadPerIp: { count: 30, windowSec: 300 },
  /** Bitta Telegram hisobi (imzo tasdiqlangandan keyin). */
  tgPerAccount: { count: 10, windowSec: 300 },

  /** OTP so'rash — bitta raqam/nom (SMS/bot spam). */
  otpRequestPerIdentifier: { count: 3, windowSec: 600 },
  /** OTP so'rash — IP shipi. */
  otpRequestPerIp: { count: 150, windowSec: 600 },
  /** OTP tekshirish — bitta identifikator (kod 5 urinishda o'ladi, bu ustiga). */
  otpVerifyPerIdentifier: { count: 10, windowSec: 600 },
  /** OTP tekshirish — IP shipi (barcha urinishlar). */
  otpVerifyPerIp: { count: 300, windowSec: 600 },
  /** OTP tekshirish — IP dan faqat XATO kodlar (turli raqamlarga «purkash»). */
  otpVerifyFailPerIp: { count: 30, windowSec: 600 },

  /** O'yin natijasi — bitta o'yin, bitta IP (ikki sinf bir IP da ham sig'adi). */
  submitPerGamePerIp: { count: 120, windowSec: 60 },
  /** O'yin natijasi — IP shipi (barcha o'yinlar). */
  submitPerIp: { count: 600, windowSec: 60 },
} as const;

/** Brauzer kaliti cookie'si — faqat chastota chegarasi uchun, sessiya EMAS. */
export const BROWSER_KEY_COOKIE = "sx_lt";
const BROWSER_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * So'rovdagi brauzer kaliti yoki yangisi (`fresh` — javobda cookie qo'yiladi).
 *
 * Cookie'ni tashlab yuborgan skript har safar yangi kalit oladi — uni
 * IP shipi to'xtatadi; oddiy brauzer esa o'z ulushini sarflaydi.
 */
export function browserKey(req: Request): { id: string; fresh: boolean } {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== BROWSER_KEY_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (BROWSER_KEY_RE.test(value)) return { id: value, fresh: false };
  }
  return { id: randomBytes(18).toString("base64url"), fresh: true };
}
