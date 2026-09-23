/**
 * Bayt beruvchi route'lar (rasm, surat, audio) uchun umumiy yordamchilar
 * (prod-readiness C08: SCALE-01, BEA-07, FE-05, DB-06, SCALE-08).
 *
 * Bu route'lar `next.config.ts` dagi `/api` → `private, no-store`
 * qoidasidan ATAYIN chiqarilgan: aks holda Next konfiguratsiya sarlavhasi
 * route'ning o'z `max-age … immutable` sini yutib yuborardi va har ko'rishda
 * bayt Postgres'dan qayta o'qilardi. Endi kesh sarlavhasi uchun route'ning
 * o'zi javobgar — muvaffaqiyatda o'z keshi, qolgan HAR javobda (400/404/500)
 * `private, no-store`, aks holda xato javobi keshlanib qolishi mumkin.
 */

export const NO_STORE = "private, no-store";

/**
 * Handler javobida `Cache-Control` bo'lmasa `private, no-store` qo'yadi.
 * `handler()` xato javobi (`ApiError` → JSON) sarlavhasiz chiqadi — shu
 * o'ram uni keshlanmaydigan qiladi. Muvaffaqiyatli bayt javobi o'z
 * sarlavhasini o'zi qo'ygan, unga tegilmaydi.
 */
export function noStoreOnError<A extends unknown[]>(
  fn: (req: Request, ...args: A) => Promise<Response>,
): (req: Request, ...args: A) => Promise<Response> {
  return async (req, ...args) => {
    const res = await fn(req, ...args);
    if (!res.headers.has("cache-control")) res.headers.set("Cache-Control", NO_STORE);
    return res;
  };
}

/**
 * `Buffer` ni NUSXASIZ `Response` tanasiga aylantiradi.
 *
 * Ilgari `new Uint8Array(buf)` butun faylni yana bir marta nusxalardi
 * (25 MB fayl — yana 25 MB). Bu esa xuddi shu xotiraga ko'rinish
 * (`byteOffset` bilan — kichik `Buffer` lar Node'ning umumiy havzasida
 * yashaydi). Tip `ArrayBuffer` ga toraytiriladi: `Buffer.from(hex)`
 * hech qachon `SharedArrayBuffer` qaytarmaydi.
 */
export function bytesBody(buf: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength);
}
