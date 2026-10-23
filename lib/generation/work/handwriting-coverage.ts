/**
 * Qo'lyozma shriftlari QAMROV MEZONI — script va test BITTA ro'yxatdan o'qiydi.
 *
 * Talab: lotin (o'zbek `oʻ gʻ`), kirill (o'zbek `ў қ ғ ҳ`, rus), raqam va
 * tinish belgilari. Shrift yopmaydigan belgi tofu `□` beradi — yoki
 * `handwriting.ts` dagi `fallback` (`ʻ` → `‘`) bilan almashtiriladi, yoki
 * shrift tanlanmaydi.
 */
export const HAND_REQUIRED_TEXT = {
  latin: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  punctuation: ".,;:!?-–—…()[]/%+=*«»“”‘’'№°•·×",
  /** `ʻ` (U+02BB) va `ʼ` (U+02BC) — `oʻ`, `gʻ`, `maʼno`. */
  uzbekLatin: "ʻʼ",
  uzbekCyrillic: "ЎўҚқҒғҲҳ",
  cyrillic: "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя",
} as const;

export const HAND_REQUIRED_ALL = Object.values(HAND_REQUIRED_TEXT).join("");
