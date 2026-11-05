import "server-only";
import { ApiError, handler, limit } from "../api";
import { env } from "../env";
import { noStoreOnError } from "../http-bytes";
import { BROWSER_KEY_COOKIE, browserKey, IP_LIMITS } from "../ip-limits";
import { clientIp } from "../ratelimit";
import { marketEnabled } from "./items";

/**
 * The shared edge of `/api/market/**` (docs/market/PLAN.md §3.1): every JSON answer, errors included, is `private,
 * no-store`, because only the preview rasters may ever sit in a cache. A route that sets its own `Cache-Control` keeps it.
 */

const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function marketHandler<A extends unknown[]>(scope: string, fn: (req: Request, ...args: A) => Promise<Response>) {
  return noStoreOnError(handler(`market/${scope}`, fn));
}

/** 503 `market_disabled` unless the market is on. An admin account walks the dark market: approval needs a look as a user. */
export async function assertMarketOpen(user: { isAdmin?: boolean } | null): Promise<void> {
  if (await marketEnabled()) return;
  if (user?.isAdmin) return;
  throw new ApiError("Bozor vaqtincha yopiq.", 503, { code: "market_disabled" });
}

/** The money routes refuse a request without a key: a lost answer must never turn into a second purchase attempt. */
export function requireIdempotencyKey(req: Request): string {
  const key = req.headers.get("idempotency-key")?.trim().toLowerCase() ?? "";
  if (!IDEMPOTENCY_KEY_RE.test(key)) throw new ApiError("Idempotency-Key UUID bo'lishi kerak", 400);
  return key;
}

/** The catalog's two buckets (§3.1): the wide per-IP ceiling, then the per-browser limit scrapers hit first. */
export async function limitCatalogRead(req: Request): Promise<{ id: string; fresh: boolean }> {
  const browser = browserKey(req);
  const { marketListPerBrowser: perBrowser, marketListPerIp: perIp } = IP_LIMITS;
  await limit(`market:list:b:${browser.id}`, perBrowser.count, perBrowser.windowSec);
  await limit(`market:list:ip:${clientIp(req)}`, perIp.count, perIp.windowSec);
  return browser;
}

export function withBrowserCookie<T extends Response & { cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => unknown } }>(res: T, browser: { id: string; fresh: boolean }): T {
  if (browser.fresh) {
    res.cookies.set(BROWSER_KEY_COOKIE, browser.id, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/api/market", maxAge: 30 * 24 * 3600 });
  }
  return res;
}
