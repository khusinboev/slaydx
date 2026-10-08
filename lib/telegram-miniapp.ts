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
 * Even then the bridge logs in silently only when there is NO session. A
 * session of ANOTHER Telegram account (two accounts on one phone share the
 * webview's cookie jar) is replaced only after the user confirms it
 * (`miniAppLoginAction` → `switch`), because Telegram Android's ordinary
 * in-app browser injects `TelegramWebviewProxy` too. A session without a
 * Telegram account (phone login) is never replaced.
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

/**
 * The Telegram user id inside SIGNED launch data (`user.id`, with a `hash`
 * present), as a string; `null` for empty, unsigned or malformed data. Only a
 * decision input — the server verifies the signature before anything happens.
 */
export function signedInitDataUserId(initData: string): string | null {
  try {
    if (!initData) return null;
    const p = new URLSearchParams(initData);
    if (!p.get("hash")) return null;
    const raw = p.get("user");
    if (!raw) return null;
    const id = (JSON.parse(raw) as { id?: unknown } | null)?.id;
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return String(id);
    if (typeof id === "string" && /^[1-9]\d*$/.test(id)) return id;
    return null;
  } catch {
    return null;
  }
}

/** «Name (@username)», «Name», «@username» or `null` — the account switch prompt's wording. */
export function accountLabel(u: { name?: unknown; username?: unknown } | null | undefined): string | null {
  const name = typeof u?.name === "string" ? u.name.trim() : "";
  const raw = typeof u?.username === "string" ? u.username.trim().replace(/^@/, "") : "";
  const at = raw ? `@${raw}` : "";
  if (name && at) return `${name} (${at})`;
  return name || at || null;
}

/**
 * The Mini App user's display label from the launch data (UNVERIFIED, shown
 * only in the switch prompt — the person deciding sees both names), or `null`.
 */
export function initDataUserLabel(initData: string): string | null {
  try {
    const raw = new URLSearchParams(initData).get("user");
    if (!raw) return null;
    const u = JSON.parse(raw) as { first_name?: unknown; last_name?: unknown; username?: unknown } | null;
    const name = [u?.first_name, u?.last_name].filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" ");
    return accountLabel({ name, username: u?.username });
  } catch {
    return null;
  }
}

export type MiniAppLoginState = {
  /** The genuine-webview check held and `telegram-web-app.js` has loaded. */
  webAppReady: boolean;
  /** `Telegram.WebApp.initData` (read at call time, never stored). */
  initData: string;
  /** The server answered the session check (a transient error leaves it false). */
  sessionChecked: boolean;
  loggedIn: boolean;
  /** The session user's `telegramId` (`null`: an account without Telegram, e.g. phone login). */
  sessionTelegramId: string | null | undefined;
  /** The Mini App user id already tried in this page load: one attempt per id, no loop, no re-login after sign-out. */
  attemptedFor: string | null;
};

/**
 * What the bridge does with the launch data:
 *  - `login` — no session: sign in silently;
 *  - `switch` — the session is ANOTHER Telegram account (two accounts on one
 *    phone share the webview cookies): ASK first, and only on «O'tish» sign in
 *    as the Mini App user (replacing this browser's session). Never silent:
 *    Telegram Android's ordinary in-app browser also injects
 *    `TelegramWebviewProxy` and shares the cookies, so a chat link carrying
 *    someone else's `#tgWebAppData` passes the genuine check (login-CSRF,
 *    security review B1);
 *  - `none` — not ready, unsigned data, same account, an account without
 *    Telegram (never replaced automatically), or this id was already tried.
 */
export type MiniAppLoginAction = "none" | "login" | "switch";

export function miniAppLoginAction(s: MiniAppLoginState): MiniAppLoginAction {
  if (!s.webAppReady || !s.sessionChecked) return "none";
  const id = signedInitDataUserId(s.initData);
  if (id === null || s.attemptedFor === id) return "none";
  if (!s.loggedIn) return "login";
  const sessionId = s.sessionTelegramId == null ? "" : String(s.sessionTelegramId);
  if (sessionId === "") return "none";
  return sessionId === id ? "none" : "switch";
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

/* ---------------------------------------------------------------------------
 * Bot keyboard links (docs/bot/PLAN.md Q1). A reply-keyboard `web_app` button
 * opens the app with EMPTY initData; the bot puts a signed personal token in
 * the URL (`?bt=…`, `lib/server/bot-link.ts`) and `MiniAppBridge` exchanges it
 * for a session at `POST /api/auth/bot-link`, then removes it from the URL.
 * ------------------------------------------------------------------------- */

/** The query parameter that carries the bot link token. */
export const BOT_LINK_PARAM = "bt";
const BOT_LINK_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The bot link token in a `location.search`, or `null`: absent, repeated (we
 * refuse to guess which copy is meant) or not token-shaped. The server
 * verifies it; this only decides whether to ask.
 */
export function botLinkFromSearch(search: string): string | null {
  try {
    const all = new URLSearchParams(search).getAll(BOT_LINK_PARAM);
    if (all.length !== 1) return null;
    return BOT_LINK_SHAPE.test(all[0]!) ? all[0]! : null;
  } catch {
    return null;
  }
}

/**
 * The Telegram user id inside a version-1 bot link token, UNVERIFIED (as a
 * string), or `null`. Only a UX decision input — «this link is the account
 * already signed in, skip the request»; the server verifies the MAC.
 */
export function botLinkTelegramId(token: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]{39}$/.test(token)) return null;
    const bin = atob(token.replace(/-/g, "+").replace(/_/g, "/") + "=");
    if (bin.length !== 29 || bin.charCodeAt(0) !== 1) return null;
    const word = (at: number) =>
      ((bin.charCodeAt(at) << 24) >>> 0) + (bin.charCodeAt(at + 1) << 16) + (bin.charCodeAt(at + 2) << 8) + bin.charCodeAt(at + 3);
    const hi = word(1);
    if (hi >= 0x20_0000) return null; // above 2^53 - 1
    const id = hi * 0x1_0000_0000 + word(5);
    return id > 0 ? String(id) : null;
  } catch {
    return null;
  }
}

/** `true` when the search has any `bt` parameter (a malformed one is removed too). */
export function hasBotLinkParam(search: string): boolean {
  try {
    return new URLSearchParams(search).has(BOT_LINK_PARAM);
  } catch {
    return false;
  }
}

/**
 * Same-origin path + query + fragment of `href` without the `bt` parameter
 * (every other parameter kept in order), for `history.replaceState`.
 */
export function withoutBotLink(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(BOT_LINK_PARAM);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}

/**
 * Launch parameters Telegram appends to every Mini App URL (`tgWebAppVersion`)
 * but WITHOUT launch data: a reply-keyboard `web_app` button (initData is
 * empty there). Exactly one well-formed version, and `tgWebAppData` absent or
 * empty.
 */
export function hasKeyboardLaunchParams(hash: string): boolean {
  try {
    const p = new URLSearchParams(hash.replace(/^#/, ""));
    const versions = p.getAll("tgWebAppVersion");
    if (versions.length !== 1 || !/^\d+(\.\d+){0,3}$/.test(versions[0]!)) return false;
    return p.getAll("tgWebAppData").every((v) => v === "");
  } catch {
    return false;
  }
}

/**
 * The page runs inside a Telegram webview opened as a Mini App — with launch
 * data (`isTelegramWebApp`) or from a reply-keyboard button (no launch data).
 * Used only for the shell (script, ready/expand, BackButton, colours): with
 * empty initData there is nothing to sign in with, so the login-CSRF rule of
 * `isTelegramWebApp` is not weakened.
 */
export function isTelegramShellLaunch(win: LaunchEnv): boolean {
  if (telegramWebviewSignal(win) === null) return false;
  return hasLaunchData(win.location.hash) || hasKeyboardLaunchParams(win.location.hash);
}

/** `https://t.me/<bot>` (the bot chat: «/start» sends fresh links), or `null` without a valid username. */
export function botChatUrl(botUsername: string | null | undefined): string | null {
  const bot = (botUsername ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{3,64}$/.test(bot) ? `https://t.me/${bot}` : null;
}

/** What the bridge shows after `POST /api/auth/bot-link`. */
export type BotLinkOutcome =
  | { kind: "signed-in" }
  | { kind: "confirm"; to: string | null }
  | { kind: "kept" }
  | { kind: "expired"; message: string | null }
  | { kind: "error"; message: string | null };

/**
 * Pure: the bridge's reaction to the exchange answer.
 *  - 2xx → signed in (or the same account kept);
 *  - 409 `switch_confirm` → ask before switching (`to` is the link owner's label);
 *  - any other 409 (a phone-login session is never replaced) → keep the session quietly;
 *  - 401 → the friendly «botga qayting» state; 403 → the same with the server's reason;
 *  - anything else (400, 429, 5xx, network) → a short error with the same way back.
 */
export function botLinkOutcome(status: number, data: { code?: unknown; to?: unknown; error?: unknown } | null): BotLinkOutcome {
  const message = typeof data?.error === "string" ? data.error : null;
  if (status >= 200 && status < 300) return { kind: "signed-in" };
  if (status === 409) {
    return data?.code === "switch_confirm" ? { kind: "confirm", to: typeof data.to === "string" ? data.to : null } : { kind: "kept" };
  }
  if (status === 401) return { kind: "expired", message: null };
  if (status === 403) return { kind: "expired", message };
  return { kind: "error", message };
}
