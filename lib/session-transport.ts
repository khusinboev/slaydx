"use client";

/**
 * Client side of the bearer session transport (docs/auth/COOKIELESS.md).
 *
 * Normal browsers never touch this module's state: the session is the
 * httpOnly cookie. Only after a login was proven to leave the webview without
 * a usable cookie (`lib/api-client.ts loginExchange`) does the client hold the
 * session token here — in memory, mirrored to `sessionStorage` when that is
 * available (it dies with the webview; never `localStorage`, never a URL) —
 * and `request()` / `useApiSrc` send it as `Authorization: Bearer` to our own
 * consumer API. The admin panel never gets it (it stays cookie-only).
 */

export const TRANSPORT_HEADER = "X-Session-Transport";
const TOKEN_KEY = "slaydx-session-bearer";
const NO_COOKIES_KEY = "slaydx-cookies-unusable";

let token: string | null = null;
let cookiesUnusable = false;
let loaded = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Blocked storage (cookie-refusing webviews often block it too): memory only.
    return null;
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const s = storage();
    token = s?.getItem(TOKEN_KEY) || null;
    cookiesUnusable = s?.getItem(NO_COOKIES_KEY) === "1" || token !== null;
  } catch {
    /* unreadable storage: start empty */
  }
}

function write(key: string, value: string | null) {
  try {
    const s = storage();
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* quota / blocked: the memory copy is enough for this page */
  }
}

function emit() {
  for (const fn of listeners) fn();
}

/** The bearer token while the tab is in bearer mode, else `null`. */
export function bearerToken(): string | null {
  load();
  return token;
}

/** Enters bearer mode with `value` (implies cookies are unusable in this tab). */
export function setBearerToken(value: string) {
  load();
  token = value;
  cookiesUnusable = true;
  write(TOKEN_KEY, value);
  write(NO_COOKIES_KEY, "1");
  emit();
}

/** Leaves bearer mode (logout, a 401, a failed probe). The "cookies unusable" memory stays. */
export function clearBearerToken() {
  load();
  if (token === null) return;
  token = null;
  write(TOKEN_KEY, null);
  emit();
}

/** A login in this tab already proved the cookie unusable: the next login opts in on its first attempt. */
export function cookiesKnownUnusable(): boolean {
  load();
  return cookiesUnusable;
}

export function markCookiesUnusable() {
  load();
  cookiesUnusable = true;
  write(NO_COOKIES_KEY, "1");
}

/** Our own consumer API (relative `/api/…`, never `/api/admin/…`, never another origin). */
export function isConsumerApiPath(url: string): boolean {
  let path = url;
  if (!url.startsWith("/")) {
    if (typeof window === "undefined") return false;
    try {
      const u = new URL(url, window.location.href);
      if (u.origin !== window.location.origin) return false;
      path = u.pathname;
    } catch {
      return false;
    }
  } else if (url.startsWith("//")) {
    return false;
  }
  return path.startsWith("/api/") && !path.startsWith("/api/admin/");
}

/** `{ Authorization }` for a consumer API URL in bearer mode, else `{}`. */
export function bearerHeaders(url: string): Record<string, string> {
  const t = bearerToken();
  return t && isConsumerApiPath(url) ? { Authorization: `Bearer ${t}` } : {};
}

export function subscribeBearer(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only: forget all state (memory; storage is the test's business). */
export function __resetSessionTransportForTests() {
  token = null;
  cookiesUnusable = false;
  loaded = false;
  emit();
}
