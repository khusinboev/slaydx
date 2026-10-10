import type { MouseEvent } from "react";
import { SUPPORT_URL } from "./support";
import { openTelegramLink } from "./telegram-webapp";

/**
 * Click handler for an `<a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">`:
 * inside the Telegram Mini App the group opens through `WebApp.openTelegramLink` (navigating
 * the webview would replace the app); everywhere else — and when Telegram refuses — the
 * anchor's own new-tab navigation runs.
 */
export function onSupportClick(e: MouseEvent<HTMLAnchorElement>): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  // `openTelegramLink` is a no-op (false) outside the Mini App shell.
  if (openTelegramLink(SUPPORT_URL)) e.preventDefault();
}
