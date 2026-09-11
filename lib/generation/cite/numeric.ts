/**
 * Raqamli (universitet xabarnomasi / konferensiya) ro'yxat satri —
 * Maqola 2, WP5.
 *
 *   Familiya I.O. Sarlavha // Venue. – 2023. – B. 45–67.
 *   Familiya I.O. Sarlavha. – Toshkent: Fan, 2022. – 120 b.
 *
 * TATU xabarnomasi, konferensiya to'plamlari va ko'p universitet
 * jurnallari GOST tavsifining o'zini talab qiladi — farq matn ichidagi
 * iqtibosda («[1]» — `[1; 25-b.]` emas, `layout.ts renderCitations`).
 * Shuning uchun bu uslub GOST formatiga DELEGATSIYA qiladi; farqi:
 * DOI ixtiyoriy (bo'lsa yoziladi), URL yozilmaydi (to'plamlarda
 * elektron manzil talab qilinmaydi va satrni cho'zadi).
 */
import type { Reference } from "../article/types";
import { formatGost } from "./gost";

export function formatNumeric(ref: Reference, lang = "uz"): string {
  return formatGost(ref, lang, { url: false });
}
