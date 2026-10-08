import { env } from "./env";

/**
 * Personal WebApp links for the bot's reply keyboard (docs/bot/PLAN.md, owner decision Q1).
 *
 * A reply-keyboard `web_app` button opens the Mini App with EMPTY initData, so the
 * usual silent Mini App login cannot run there. The bot therefore puts a per-user
 * signed link token into each keyboard URL; the Mini App exchanges it for a session.
 *
 * Contract (used by the bot screens package):
 *   botAppUrl(telegramId, "/uz/slide") → absolute https URL of that page carrying the
 *   user's link token, or `null` when the app URL is not public https (localhost),
 *   in which case the caller sends no web_app button.
 *
 * Interim body (B0): the URL without a token; package B1 adds signing, verification
 * and the token → session exchange.
 */
export function botAppUrl(telegramId: number | string, path: string): string | null {
  void telegramId;
  const base = env.appUrl;
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) return null;
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
