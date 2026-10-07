/**
 * Safe-area CSS lengths shared by the shell and the overlays (mobile sprint P4).
 *
 * The Telegram bridge writes `--tg-safe-*` / `--tg-content-safe-*` on `<html>`
 * (docs/mobile, package P8); without it (plain browsers, older clients) the
 * CSS `env(safe-area-inset-*)` of the page applies, and 0 outside notched or
 * fullscreen surfaces — so every value below is exactly 0 on a desktop.
 */
export const SAFE_TOP = "var(--tg-safe-top, env(safe-area-inset-top, 0px))";
export const SAFE_BOTTOM = "var(--tg-safe-bottom, env(safe-area-inset-bottom, 0px))";
export const SAFE_LEFT = "var(--tg-safe-left, env(safe-area-inset-left, 0px))";
export const SAFE_RIGHT = "var(--tg-safe-right, env(safe-area-inset-right, 0px))";
/** Telegram's own header floating over the page (fullscreen mode only). */
export const CONTENT_SAFE_TOP = "var(--tg-content-safe-top, 0px)";

/** Everything above the page content: device notch plus Telegram's header. */
export const TOP_INSET = `calc(${SAFE_TOP} + ${CONTENT_SAFE_TOP})`;

/** `max(min, safe)` — keeps `min` of ordinary padding, grows by the safe inset when larger. */
export function atLeast(min: string, safe: string): string {
  return `max(${min}, ${safe})`;
}
