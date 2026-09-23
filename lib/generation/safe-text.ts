/**
 * Surrogatga xavfsiz matn yordamchilari (AUDIT prod-readiness C03: BEB-01, BEA-02).
 *
 * `String.prototype.slice` UTF-16 KOD BIRLIGI bo'yicha kesadi. Emoji yoki
 * boshqa U+10000+ belgi (matematik kursiv, CJK kengaytmasi…) ikki birlik —
 * yuqori + quyi surrogat. Kesish nuqtasi aynan ular orasiga tushsa,
 * natijada YOLG'IZ yuqori surrogat qoladi. `JSON.stringify` uni `\ud83d`
 * escape'i qilib chiqaradi va Postgres `jsonb` butun yozuvni rad etadi
 * (22P02) — ish fayl saqlangandan keyin yiqilardi. `\u0000` ni ham `jsonb`
 * (22P05), xom NUL ni `text` (22021) rad etadi.
 *
 * Bu fayl klient/server umumiy (`server-only` YO'Q): `meta.ts` va slayd
 * kesish yordamchilari ham shu yerdan oladi. JSONB yozuvi uchun markaziy
 * to'siq — `lib/server/jsonb.ts toJsonb`.
 */

/** 0xD800–0xDBFF — juftlikning birinchi (yuqori) yarmi. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * `s.slice(0, end)` bilan bir xil, faqat oxirgi birlik yolg'iz yuqori
 * surrogat bo'lib qolsa u tashlanadi — juftlik yorilmaydi. Uzunlik
 * chegarasi o'zgarmaydi (natija `end` dan oshmaydi, eng ko'pi bitta
 * birlik qisqa), shuning uchun mavjud `n` chegaralari va testlar joyida.
 */
export function safeSlice(s: string, end: number): string {
  const cut = s.slice(0, end);
  return cut.length > 0 && cut.length < s.length && isHighSurrogate(cut.charCodeAt(cut.length - 1))
    ? cut.slice(0, -1)
    : cut;
}

/**
 * Bazaga (JSONB yoki TEXT) yoziladigan matnni tozalaydi: yolg'iz
 * surrogat → U+FFFD (`toWellFormed`), NUL → olib tashlanadi. Toza matn
 * AYNAN o'zi qaytadi (tez yo'l — katta hujjatda nusxa olinmaydi).
 */
export function cleanText(s: string): string {
  if (s.isWellFormed() && !s.includes("\u0000")) return s;
  return s.toWellFormed().replace(/\u0000/g, "");
}
