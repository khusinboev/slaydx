/** Short Uzbek month names for the one-line card meta («5 okt»). */
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"] as const;

/**
 * «5 okt» (same year as `now`) or «5 okt 2025» — the date line of a phone
 * file card. Invalid input gives an empty string, never «NaN».
 */
export function formatFileDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
