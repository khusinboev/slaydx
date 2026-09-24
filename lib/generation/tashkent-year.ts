/**
 * Hujjat yili — TOSHKENT vaqti bo'yicha (Asia/Tashkent, UTC+5, yozgi
 * vaqt yo'q).
 *
 * Nega: server (Docker) UTC da ishlaydi va `new Date().getFullYear()`
 * jarayon vaqt mintaqasini oladi. 31-dekabr 19:00–24:00 UTC oralig'ida
 * Toshkentda allaqachon 1-yanvar — o'sha paytda yaratilgan referat
 * titulida «Toshkent — 2026» o'rniga eski yil chiqardi. Izomorf (klient
 * ko'ruvchisi ham `title-model.ts` orqali o'qiydi): `Intl`/mintaqa
 * bazasiga tayanmaydi, faqat qat'iy +5 soat siljish.
 */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function tashkentYear(at: Date | number = Date.now()): number {
  const ms = typeof at === "number" ? at : at.getTime();
  return new Date(ms + TASHKENT_OFFSET_MS).getUTCFullYear();
}
