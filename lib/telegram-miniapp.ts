/**
 * Telegram Mini App (WebApp) detection — pure, DOM-free, unit-tested.
 *
 * SECURITY (FE-10 lesson, see the note at the end of `lib/store.ts`): the
 * `#tgWebAppData=…` launch parameter is just a URL fragment. Anyone can put
 * their own signed initData there and send the link to a victim; logging in
 * from it is login-CSRF (the victim works and pays inside the attacker's
 * account). So the fragment alone NEVER counts. We additionally require a
 * signal that only a real Telegram client provides and a web page cannot
 * forge from the outside:
 *
 *  - `window.TelegramWebviewProxy.postEvent` — injected by the Telegram
 *    iOS/Android/desktop clients into the Mini App webview before page
 *    scripts run; an ordinary browser never has it;
 *  - `window.external.notify` — the Windows-webview bridge (in Chrome,
 *    Firefox and Safari `window.external` has no `notify`);
 *  - being framed by `https://*.telegram.org` (Telegram Web). Our CSP
 *    `frame-ancestors` (next.config.ts) only lets telegram.org frame us, and
 *    `location.ancestorOrigins` (Firefox: the referrer) names the framer.
 *
 * `tgWebAppData` must also appear exactly once: a Telegram client appends
 * its own launch parameters to the button URL, so a second copy means
 * somebody pre-filled the fragment, and we refuse to guess which one
 * `telegram-web-app.js` would pick.
 *
 * Even then the bridge logs in only when there is NO session at all, so an
 * existing session (the same or a different user) is never replaced.
 */

export const TELEGRAM_WEB_APP_SCRIPT = "https://telegram.org/js/telegram-web-app.js";

/** The subset of `window` the detection reads (keeps it testable without a DOM). */
export type LaunchEnv = {
  TelegramWebviewProxy?: unknown;
  external?: unknown;
  parent?: unknown;
  location: { hash: string; ancestorOrigins?: ArrayLike<string> };
  document: { referrer: string };
};

export type WebviewSignal = "proxy" | "external" | "frame";

const TELEGRAM_ORIGIN = /^https:\/\/(?:[a-z0-9-]+\.)?telegram\.org$/;

function originOf(url: string): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** Which Telegram-injected environment we run in, or `null` for an ordinary browser tab. */
export function telegramWebviewSignal(win: LaunchEnv): WebviewSignal | null {
  const proxy = win.TelegramWebviewProxy as { postEvent?: unknown } | null | undefined;
  if (proxy && typeof proxy.postEvent === "function") return "proxy";
  const ext = win.external as { notify?: unknown } | null | undefined;
  if (ext && typeof ext.notify === "function") return "external";
  if (win.parent != null && win.parent !== win) {
    const ancestors = win.location.ancestorOrigins;
    const framer = ancestors && ancestors.length > 0 ? ancestors[0]! : originOf(win.document.referrer);
    if (framer && TELEGRAM_ORIGIN.test(framer)) return "frame";
  }
  return null;
}

/** `true` when the fragment carries exactly one non-empty `tgWebAppData`. */
export function hasLaunchData(hash: string): boolean {
  const all = new URLSearchParams(hash.replace(/^#/, "")).getAll("tgWebAppData");
  return all.length === 1 && all[0]!.length > 0;
}

/** The page really runs as a Telegram Mini App: a client-injected signal AND launch data. */
export function isTelegramWebApp(win: LaunchEnv): boolean {
  return telegramWebviewSignal(win) !== null && hasLaunchData(win.location.hash);
}

export type AutoLoginState = {
  /** `isTelegramWebApp` held and `telegram-web-app.js` has loaded. */
  webAppReady: boolean;
  /** `Telegram.WebApp.initData` (read at call time, never stored). */
  initData: string;
  /** The server answered the session check (a transient error leaves it false). */
  sessionChecked: boolean;
  loggedIn: boolean;
  /** One attempt per page load: no retry loop, no re-login after sign-out. */
  attempted: boolean;
};

/** Silent Mini App login only for a genuine webview with no session of any user. */
export function shouldAutoLogin(s: AutoLoginState): boolean {
  return s.webAppReady && s.initData.length > 0 && s.sessionChecked && !s.loggedIn && !s.attempted;
}
