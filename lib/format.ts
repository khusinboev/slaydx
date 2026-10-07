/**
 * «3 000» with a no-break space — the same text on the server and in every
 * browser. `toLocaleString("uz-UZ")` gives «3,000» where the browser lacks
 * Uzbek ICU data (Telegram's Android WebView, our Chromium) but «3 000» in
 * Node, so server HTML did not hydrate and the app showed both styles.
 */
export function groupDigits(n: number): string {
  const r = Math.round(n);
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return r < 0 ? `−${s}` : s;
}
