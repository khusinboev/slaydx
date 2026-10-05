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
import { isRootPath } from "./nav/parents";

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

/**
 * Telegram BackButton and closing confirmation (docs/nav/R4-back-nav.md §4).
 *
 * The decision is pure; `MiniAppBridge` applies it. On Android the hardware /
 * gesture back fires `backButtonClicked` while the button is visible and
 * closes the Mini App otherwise (asking first when closing confirmation is
 * on); it never walks the WebView history. So the button is visible exactly
 * when back has something in-app to do: an overlay to close, or a non-root
 * page to leave. Roots (`/uz`, `/o/*`, `/admin`, …) hide it, and back there
 * closes the app.
 */
export type TelegramBackInput = {
  /** Open overlay layers (`lib/nav/history.ts` snapshot). */
  overlays: number;
  pathname: string;
  /** Some leave guard has unsaved work. */
  pending: boolean;
  /** `Telegram.WebApp.isVersionAtLeast`: members newer than the client are never called. */
  isVersionAtLeast: (version: string) => boolean;
};

export type TelegramBackState = {
  /** `true` show, `false` hide, `null` the client has no BackButton (< 6.1): do not touch it. */
  backButton: boolean | null;
  /** `true` enable, `false` disable, `null` unsupported (< 6.2). */
  closingConfirmation: boolean | null;
};

/** `BackButton` and `backButtonClicked`. */
export const TG_BACK_BUTTON_VERSION = "6.1";
/** `enableClosingConfirmation` / `disableClosingConfirmation`. */
export const TG_CLOSING_CONFIRMATION_VERSION = "6.2";

function supports(check: (v: string) => boolean, v: string): boolean {
  try {
    return check(v) === true;
  } catch {
    return false;
  }
}

export function telegramBackState(s: TelegramBackInput): TelegramBackState {
  const backButton = supports(s.isVersionAtLeast, TG_BACK_BUTTON_VERSION) ? s.overlays > 0 || !isRootPath(s.pathname) : null;
  const closingConfirmation = supports(s.isVersionAtLeast, TG_CLOSING_CONFIRMATION_VERSION) ? s.pending : null;
  return { backButton, closingConfirmation };
}

/* ---------------------------------------------------------------------------
 * Mini App shell (docs/mobile/PLAN.md O6, O8; R5 §3.G): vertical swipes,
 * Telegram header / background / bottom-bar colours, safe-area CSS variables,
 * and the in-app «←» decision. Pure parts here; `MiniAppBridge` applies them.
 * ------------------------------------------------------------------------- */

/** `disableVerticalSwipes` / `enableVerticalSwipes`. */
export const TG_VERTICAL_SWIPES_VERSION = "7.7";
/** `setBackgroundColor` with any `#RRGGBB`. */
export const TG_BACKGROUND_COLOR_VERSION = "6.1";
/** `setHeaderColor` with any `#RRGGBB` (6.1–6.8 accept only Telegram's colour keys, so they are skipped). */
export const TG_HEADER_COLOR_VERSION = "6.9";
/** `setBottomBarColor`. */
export const TG_BOTTOM_BAR_COLOR_VERSION = "7.10";
/** `safeAreaInset`, `contentSafeAreaInset` and their `*Changed` events. */
export const TG_SAFE_AREA_VERSION = "8.0";

/** `true` when the client is at least `v`; a throwing or missing check is `false`. */
export function clientSupports(isVersionAtLeast: ((v: string) => boolean) | undefined, v: string): boolean {
  return typeof isVersionAtLeast === "function" && supports(isVersionAtLeast, v);
}

/**
 * `#rgb`, `#rrggbb`, `rgb(r, g, b)` or opaque `rgba(…)` → lower-case `#rrggbb`;
 * anything else (keywords, translucent, `oklch`, garbage) → `null`. Telegram
 * accepts only `#RRGGBB`.
 */
export function normalizeHexColor(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1]!;
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
  if (!rgb) return null;
  if (rgb[4] !== undefined) {
    const a = rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    if (!(a >= 1)) return null;
  }
  const parts = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n));
  if (parts.some((n) => n > 255)) return null;
  return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** What to send to Telegram for the page colour; `null` = leave that member alone. */
export type TelegramChromeColors = { header: string | null; background: string | null; bottomBar: string | null };

/**
 * The page colour (the app's `--page-bg`, behind the top bar and the content)
 * for Telegram's header, background and bottom bar, each gated by the client
 * version. An unreadable colour sends nothing.
 */
export function telegramChromeColors(
  color: string | null | undefined,
  isVersionAtLeast: ((v: string) => boolean) | undefined,
): TelegramChromeColors {
  const c = normalizeHexColor(color);
  const ok = (v: string) => c !== null && clientSupports(isVersionAtLeast, v);
  return {
    header: ok(TG_HEADER_COLOR_VERSION) ? c : null,
    background: ok(TG_BACKGROUND_COLOR_VERSION) ? c : null,
    bottomBar: ok(TG_BOTTOM_BAR_COLOR_VERSION) ? c : null,
  };
}

export type SafeAreaInset = { top?: unknown; bottom?: unknown; left?: unknown; right?: unknown };

/**
 * CSS variables written on `<html>` inside a genuine Mini App. For other
 * packages (fixed / sticky bars, sheets, dialogs):
 *
 *   --tg-safe-top | -bottom | -left | -right   device safe area (notch, home
 *       indicator): Telegram's `safeAreaInset` (8.0+) in px; on older clients
 *       `env(safe-area-inset-*, 0px)`.
 *   --tg-content-safe-top | -bottom            Telegram's own UI over the page
 *       (`contentSafeAreaInset`, 8.0+; fullscreen mode), else `0px`.
 *
 * Updated on `safeAreaChanged` / `contentSafeAreaChanged`. Outside Telegram
 * the variables are not set, so always give a fallback:
 *   padding-bottom: var(--tg-safe-bottom, env(safe-area-inset-bottom, 0px));
 *   top: calc(var(--tg-safe-top, env(safe-area-inset-top, 0px)) + var(--tg-content-safe-top, 0px));
 */
export const SAFE_AREA_CSS_VARS = [
  "--tg-safe-top",
  "--tg-safe-bottom",
  "--tg-safe-left",
  "--tg-safe-right",
  "--tg-content-safe-top",
  "--tg-content-safe-bottom",
] as const;
export type SafeAreaCssVar = (typeof SAFE_AREA_CSS_VARS)[number];

function px(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? `${Math.round(n)}px` : null;
}

/** Values for `SAFE_AREA_CSS_VARS` from Telegram's insets (missing / invalid → fallback). */
export function safeAreaCssVars(
  safe: SafeAreaInset | null | undefined,
  content: SafeAreaInset | null | undefined,
): Record<SafeAreaCssVar, string> {
  const side = (k: "top" | "bottom" | "left" | "right") => px(safe?.[k]) ?? `env(safe-area-inset-${k}, 0px)`;
  return {
    "--tg-safe-top": side("top"),
    "--tg-safe-bottom": side("bottom"),
    "--tg-safe-left": side("left"),
    "--tg-safe-right": side("right"),
    "--tg-content-safe-top": px(content?.top) ?? "0px",
    "--tg-content-safe-bottom": px(content?.bottom) ?? "0px",
  };
}

/**
 * Shell state published by `MiniAppBridge` for the rest of the app (an
 * in-memory store, framework-free; React reads it through
 * `components/telegram/useMiniAppShell.ts`).
 *
 *  - `active` — the page runs as a genuine Telegram Mini App (set right after
 *    hydration, before Telegram's script has loaded);
 *  - `backButton` — Telegram's BackButton: `"pending"` until the script has
 *    loaded and the bridge applied it, then `true` (it works: supported, click
 *    wired, shown on every non-root page per docs/nav/PLAN.md) or `false`
 *    (client < 6.1, a call threw, or the script failed to load).
 */
export type MiniAppShellState = { readonly active: boolean; readonly backButton: boolean | "pending" };

const INACTIVE: MiniAppShellState = Object.freeze({ active: false, backButton: false });
let shell: MiniAppShellState = INACTIVE;
const shellListeners = new Set<() => void>();

export function getMiniAppShellState(): MiniAppShellState {
  return shell;
}
/** Server render and hydration: never a Mini App (no hydration mismatch). */
export function getServerMiniAppShellState(): MiniAppShellState {
  return INACTIVE;
}
export function subscribeMiniAppShell(listener: () => void): () => void {
  shellListeners.add(listener);
  return () => {
    shellListeners.delete(listener);
  };
}
/** Merges `patch` (`null` resets); listeners run only when something changed. Inactive ⇒ no BackButton. */
export function setMiniAppShellState(patch: Partial<MiniAppShellState> | null): void {
  const merged = patch === null ? INACTIVE : { ...shell, ...patch };
  const next = merged.active ? merged : INACTIVE;
  if (next.active === shell.active && next.backButton === shell.backButton) return;
  shell = next.active ? Object.freeze({ active: true, backButton: next.backButton }) : INACTIVE;
  for (const l of [...shellListeners]) l();
}

/**
 * O6: the in-app «←» (`BackLink`) is hidden inside a genuine Mini App while
 * Telegram's BackButton does the job — working, or being set up (script
 * still loading). When the client has no BackButton (< 6.1), a call threw or
 * the script failed, the «←» stays: there is always one back. Browsers are
 * never affected (`active` is false there).
 */
export function shouldHideInAppBack(s: MiniAppShellState): boolean {
  return s.active && s.backButton !== false;
}
