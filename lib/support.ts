/**
 * Where a user goes to reach an admin or the help service: the Telegram
 * support group. One source of truth — the bot (`env.supportUrl`), the web
 * profile row and the user-facing error texts all derive from this file.
 * Client-safe: no server imports.
 */
export const SUPPORT_URL = "https://t.me/SlaydX_support";

/** `t.me/SlaydX_support` — the form used inside plain-text messages. */
export function supportHandle(url: string = SUPPORT_URL): string {
  return url.replace(/^https:\/\//, "");
}

/** A deploy-time override must be an `https://t.me/<path>` URL; anything else falls back to the default. */
export function resolveSupportUrl(raw: string | undefined | null): string {
  const v = (raw ?? "").trim();
  return /^https:\/\/t\.me\/[A-Za-z0-9_+-]{3,64}$/.test(v) ? v : SUPPORT_URL;
}
