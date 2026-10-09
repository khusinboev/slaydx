import { openExternalLink } from "./telegram-webapp";

/**
 * Opens the Click app deeplink (the `my.click.uz/services/pay` URL): the Click app
 * intercepts it when the OS opens the link.
 *
 *  - inside the Telegram Mini App the webview must NOT navigate to it (the app would
 *    never get it and the Mini App would be lost): `Telegram.WebApp.openLink` hands it
 *    to the system browser / the Click app;
 *  - elsewhere the page navigates (`window.location.assign`): with the Click app installed
 *    the OS catches the link and the tab stays; without it the Click payment page opens,
 *    which is the same fallback the old «Click» button used.
 *
 * Returns how it was opened (the dialog shows a matching hint).
 */
export function openClickApp(url: string): "telegram" | "browser" {
  if (openExternalLink(url)) return "telegram";
  browserOpen(url);
  return "browser";
}

let browserOpen = (url: string): void => {
  window.location.assign(url);
};

/** Test-only: observe the browser navigation (jsdom cannot navigate). */
export function __setBrowserOpenForTests(fn: ((url: string) => void) | null): void {
  browserOpen =
    fn ??
    ((url) => {
      window.location.assign(url);
    });
}
