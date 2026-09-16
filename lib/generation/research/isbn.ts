/**
 * ISBN yordamchisi — SOF modul (tarmoq/baza yo'q).
 *
 * Nega alohida: `article/input.ts` (forma qiymatlari → dvigatel kiritmasi)
 * `lib/tools.ts` orqali KLIENT bandliga kiradi. U `googlebooks.ts` dan
 * import qilganda zanjir `cache.ts` → `lib/server/db.ts` (`server-only`)
 * ga borib, `/uz/<vosita>` sahifalari 500 berdi (AUDIT-19 smoke).
 */

/**
 * ISBN ni bitta shaklga: defis/bo'shliq tushadi, harflar bosh harfga.
 * Qabul qilinadi — 13 raqam (978/979 bilan boshlanadi) yoki 10 belgi
 * (9 raqam + raqam/X). Aks holda "" (noto'g'ri ISBN bilan qidirmaymiz).
 */
export function normalizeIsbn(raw: unknown): string {
  const t = String(raw ?? "")
    .toUpperCase()
    .replace(/[\s‐-―-]/g, "")
    .replace(/^ISBN:?/, "");
  if (/^97[89]\d{10}$/.test(t)) return t;
  if (/^\d{9}[\dX]$/.test(t)) return t;
  return "";
}

