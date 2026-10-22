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

/**
 * A money amount in the app's single unit — «12 000 so'm» (1 point = 1 so'm,
 * program 17 D1). The only place the word lives; prices, balances and hints
 * all go through it.
 */
export function formatSom(n: number): string {
  return `${groupDigits(n)} so'm`;
}

/** A bonus balance or reward — «2 000 bonus so'm» (spent like paid so'm, but never real money). */
export function formatBonusSom(n: number): string {
  return `${groupDigits(n)} bonus so'm`;
}
