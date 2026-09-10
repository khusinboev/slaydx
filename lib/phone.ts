/**
 * Telefon raqamini ko'rsatish uchun formatlash (Rezyume 2, 1-band).
 *
 * Izomorf — jsdom testi ham, SSR ham, server ham chaqira oladi.
 * Saqlanadigan shakl DOIM `+` va raqamlar (`normalizePhone`); bo'shliqlar
 * faqat KO'RSATISH uchun qo'shiladi, aks holda bir xil raqam ikki xil
 * yozilib rezyumeda ham, profilda ham ajralib ketardi.
 */

/** Faqat raqamlar (boshidagi `+` yo'qoladi, `00` prefiksi ham). */
export function digitsOf(raw: string): string {
  const d = (raw || "").replace(/\D+/g, "");
  return d.startsWith("00") ? d.slice(2) : d;
}

/** Saqlash shakli: `+998901234567`. Bo'sh kirish → "". */
export function normalizePhone(raw: string): string {
  const d = digitsOf(raw).slice(0, 15);
  return d ? `+${d}` : "";
}

/** Guruhlash naqshlari — mamlakat kodi bo'yicha (raqamlar kodsiz). */
const GROUPS: Record<string, number[]> = {
  // O'zbekiston: +998 90 123 45 67 — asosiy foydalanuvchi.
  "998": [2, 3, 2, 2],
  // Rossiya/Qozog'iston: +7 912 345 67 89.
  "7": [3, 3, 2, 2],
  // AQSh/Kanada: +1 415 555 0123.
  "1": [3, 3, 4],
};

/** Mamlakat kodi: ro'yxatdagi eng uzun mos prefiks, aks holda 2 raqam. */
function splitCountry(d: string): { cc: string; rest: string } {
  for (const cc of ["998", "7", "1"]) {
    if (d.startsWith(cc)) return { cc, rest: d.slice(cc.length) };
  }
  return { cc: d.slice(0, 2), rest: d.slice(2) };
}

/**
 * Ko'rsatish shakli: `+998 90 123 45 67`.
 *
 * Noma'lum kod uchun umumiy 3-3-4 guruhlash. Kirish to'liq bo'lmasa
 * (foydalanuvchi hali yozayotgan bo'lsa) — bor raqamlargacha formatlanadi.
 */
export function formatPhone(raw: string): string {
  const d = digitsOf(raw).slice(0, 15);
  if (!d) return "";
  const { cc, rest } = splitCountry(d);
  if (!rest) return `+${cc}`;
  const groups = GROUPS[cc] ?? [3, 3, 4];
  const parts: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= rest.length) break;
    parts.push(rest.slice(i, i + g));
    i += g;
  }
  // Naqshdan oshgan raqamlar (uzun xalqaro raqam) oxiriga qo'shiladi.
  if (i < rest.length) parts.push(rest.slice(i));
  return `+${cc} ${parts.join(" ")}`.trim();
}
