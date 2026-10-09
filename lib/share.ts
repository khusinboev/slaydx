/**
 * One share helper for every «Ulashish» in the web app (docs/share/AUDIT.md).
 *
 * Why it exists: `navigator.share` is missing on Firefox and on Linux Chrome, limited on
 * Windows/macOS (no DOCX/PPTX files) and unreliable in Telegram's webviews, so a share button that
 * only calls it does nothing on a PC. The order here is the same for every entry point:
 *
 *   1. inside the Telegram Mini App → Telegram's own «send to a chat» sheet
 *      (`openTelegramLink`, works on phones and on Telegram Desktop) — the flow that already worked;
 *   2. otherwise the native share sheet (`navigator.share`), when present and willing;
 *   3. otherwise `{ status: "fallback" }` — the caller opens the fallback menu
 *      (`components/share/ShareMenu.tsx`: copy the link / share in Telegram).
 *
 * A user dismissing the native sheet (`AbortError`) is `cancelled`: no toast, no fallback. Any other
 * failure is a `fallback`, never silence.
 *
 * Everything the helper reads from the page goes through {@link ShareEnv}, so the logic is tested
 * with stubbed environments (phone / desktop / Telegram phone / Telegram Desktop). `navigator.share`
 * needs the tap's transient activation: {@link shareLink} and {@link shareFiles} call it
 * synchronously (before their first `await`), so call them straight from the click handler.
 *
 * Safety: only public, intended URLs are shared ({@link isShareableUrl}); a personal `?bt=`
 * sign-in link, a signed download URL or Telegram launch data is refused.
 */
import { telegramShareUrl } from "./referral";
import { getTelegramWebApp, isInMiniAppShell, openTelegramLink } from "./telegram-webapp";

/** What a link share carries. `text` and `title` are optional context for the receiving app. */
export type LinkShare = { url: string; text?: string; title?: string };

/** The slice of `navigator` the helper uses (all members optional: browsers differ). */
export type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText?: (text: string) => Promise<void> };
};

export type ShareEnv = {
  nav: ShareNavigator | undefined;
  /** The page runs inside Telegram's Mini App shell (phone or desktop client). */
  inTelegram: boolean;
  /** `Telegram.WebApp.platform` (`android`, `ios`, `tdesktop`, `macos`, `weba`, `webk`, …), or `null`. */
  telegramPlatform: string | null;
  /** Opens a `t.me` link inside Telegram; `false` when the Mini App accessor is unavailable. */
  openTelegramLink: (url: string) => boolean;
  /** Opens a URL in a new browser tab; `false` when the browser refused. */
  openWindow: (url: string) => boolean;
};

/** How a share attempt ended. `fallback` means «show the fallback menu». */
export type ShareOutcome =
  | { status: "shared" }
  | { status: "telegram" }
  | { status: "cancelled" }
  | { status: "blocked" }
  | { status: "fallback"; reason: "unsupported" | "error" };

/* ───────────────────────────── environment ───────────────────────────── */

function openInNewTab(url: string): boolean {
  try {
    // `noopener` makes `window.open` return null even on success, so only a throw means failure.
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

/** The live environment of the current page (read at tap time: Telegram's script may load late). */
export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as unknown as ShareNavigator);
  let platform: string | null = null;
  try {
    const p = getTelegramWebApp()?.platform;
    platform = typeof p === "string" ? p : null;
  } catch {
    platform = null;
  }
  return { nav, inTelegram: isInMiniAppShell(), telegramPlatform: platform, openTelegramLink, openWindow: openInNewTab };
}

/* ───────────────────────────── URL safety ───────────────────────────── */

/**
 * Pure: the URL may leave the app in a shared message. Only absolute http(s) URLs to a PAGE:
 * no credentials, no `/api/` path (signed `/api/dl/<token>` downloads), no personal sign-in
 * `bt` parameter, no Telegram launch data (`tgWebApp…`, which carries a signed `initData`).
 * Public game links (`/o/<token>`) and referral links (`?ref=`) pass.
 */
export function isShareableUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return false;
  for (const key of u.searchParams.keys()) {
    const k = key.toLowerCase();
    if (k === "bt" || k.startsWith("tgwebapp")) return false;
  }
  return !/tgwebapp/i.test(u.hash);
}

/** A same-origin path (`/o/…`) becomes absolute; an absolute URL is returned as written. */
export function resolveShareUrl(url: string, base?: string): string {
  try {
    return new URL(url, base ?? (typeof window !== "undefined" ? window.location.href : undefined)).href;
  } catch {
    return url;
  }
}

/** `https://t.me/share/url?url=…&text=…` — Telegram's own «send to a chat» page/sheet. */
export function telegramShareHref(data: LinkShare): string {
  return telegramShareUrl(data.url, data.text ?? "");
}

/* ───────────────────────────── native share ───────────────────────────── */

/** `AbortError` = the user dismissed the sheet. Duck-typed: the error may come from another realm. */
export function isShareAbort(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

/** `navigator.share` exists in this environment. */
export function hasNativeShare(env: Pick<ShareEnv, "nav"> = browserShareEnv()): boolean {
  return typeof env.nav?.share === "function";
}

type NativeResult = "shared" | "cancelled" | "unsupported" | "error";

/**
 * Calls `navigator.share(data)` — synchronously up to the call, so the tap's user activation is
 * still valid. `unsupported`: no `share`, or `canShare` says it cannot take this data
 * (`probe: false` skips that check — files were probed with {@link canShareFile} before the download).
 */
async function nativeShare(data: ShareData, nav: ShareNavigator | undefined, probe = true): Promise<NativeResult> {
  if (!nav || typeof nav.share !== "function") return "unsupported";
  try {
    if (probe && typeof nav.canShare === "function" && !nav.canShare(data)) return "unsupported";
    await nav.share(data);
    return "shared";
  } catch (e) {
    return isShareAbort(e) ? "cancelled" : "error";
  }
}

/**
 * Shares a link. Inside Telegram: Telegram's sheet first; else the native sheet; else `fallback`
 * (open {@link ShareMenu}). Never throws.
 */
export async function shareLink(data: LinkShare, env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  if (!isShareableUrl(data.url)) return { status: "blocked" };
  if (env.inTelegram && env.openTelegramLink(telegramShareHref(data))) return { status: "telegram" };
  const payload: ShareData = { url: data.url };
  if (data.title) payload.title = data.title;
  if (data.text) payload.text = data.text;
  const r = await nativeShare(payload, env.nav);
  if (r === "shared") return { status: "shared" };
  if (r === "cancelled") return { status: "cancelled" };
  return { status: "fallback", reason: r };
}

/**
 * Shares files through the native sheet (the «Ulashish» second tap of a downloaded file). Telegram
 * has its own file route (`shareMessage`), so this is only for ordinary browsers.
 */
export async function shareFiles(
  files: File[],
  opts: { title?: string; text?: string } = {},
  env: Pick<ShareEnv, "nav"> = browserShareEnv(),
): Promise<ShareOutcome> {
  const payload: ShareData = { files };
  if (opts.title) payload.title = opts.title;
  if (opts.text) payload.text = opts.text;
  const r = await nativeShare(payload, env.nav, false);
  if (r === "shared") return { status: "shared" };
  if (r === "cancelled") return { status: "cancelled" };
  return { status: "fallback", reason: r };
}

/**
 * Pure probe: this browser's Web Share accepts a file of this type (`navigator.canShare({files})`).
 * Chromium refuses DOCX/PPTX/XLSX; Firefox and Linux Chrome have no file sharing at all.
 */
export function canShareFile(
  f: { ext: string; mime: string },
  nav: unknown = typeof navigator !== "undefined" ? navigator : undefined,
): boolean {
  try {
    const n = nav as ShareNavigator | undefined;
    if (!n || typeof n.canShare !== "function" || typeof n.share !== "function" || typeof File === "undefined") return false;
    return n.canShare({ files: [new File([""], `fayl.${f.ext}`, { type: f.mime })] }) === true;
  } catch {
    return false;
  }
}

/* ───────────────────────────── Telegram share ───────────────────────────── */

/**
 * «Telegramda ulashish»: Telegram's share sheet inside the Mini App, otherwise the
 * `t.me/share/url` page in a new tab (Telegram Web / the installed app). Call it straight from a
 * click (popup blockers). `false` when the link is not shareable or nothing could be opened.
 */
export function openTelegramShare(data: LinkShare, env: ShareEnv = browserShareEnv()): boolean {
  if (!isShareableUrl(data.url)) return false;
  const href = telegramShareHref(data);
  if (env.inTelegram && env.openTelegramLink(href)) return true;
  return env.openWindow(href);
}

/* ───────────────────────────── clipboard ───────────────────────────── */

type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Copies `text`. The async Clipboard API first; where it is missing or refused (HTTP origins,
 * older Telegram webviews, Firefox without permission) `execCommand("copy")` runs on `opts.field`
 * (a visible read-only field, selected so the user can also copy by hand if this fails too) or,
 * without one, on a hidden textarea. Resolves `false` only when every route failed.
 */
export async function copyToClipboard(
  text: string,
  opts: { field?: TextField | null; nav?: ShareNavigator; doc?: Document } = {},
): Promise<boolean> {
  const nav = opts.nav ?? (typeof navigator === "undefined" ? undefined : (navigator as unknown as ShareNavigator));
  try {
    if (nav?.clipboard && typeof nav.clipboard.writeText === "function") {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: use the selection route below.
  }
  const doc = opts.doc ?? (typeof document === "undefined" ? undefined : document);
  if (!doc || typeof doc.execCommand !== "function") return false;
  const field = opts.field && opts.field.isConnected ? opts.field : null;
  if (field) {
    try {
      field.focus();
      field.select();
      field.setSelectionRange(0, text.length);
      return doc.execCommand("copy");
    } catch {
      return false;
    }
  }
  const area = doc.createElement("textarea");
  const previous = doc.activeElement as HTMLElement | null;
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  // 16 px: iOS zooms into smaller focused fields. Off-screen but selectable.
  area.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px";
  try {
    doc.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    try {
      previous?.focus?.();
    } catch {
      // The previous element went away: nothing to restore.
    }
  }
}
