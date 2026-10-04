import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { isDownloadFormatId, type DownloadFormatId } from "@/lib/downloads/formats";
import { env } from "../env";

/**
 * Signed download URLs (docs/mobile/PLAN.md §4.2, R1-download.md §4, §6).
 *
 * `Telegram.WebApp.downloadFile` makes the Telegram client fetch the file
 * itself (Android DownloadManager, iOS URLSession, Telegram Web cross-origin
 * fetch): no session cookie reaches us. The URL therefore authorizes itself:
 * `/api/dl/<payload>.<mac>` where
 *
 *   payload = base64url(JSON {g, u, f, v, exp})   — generation, owner, format,
 *                                                   file_version, expiry (unix s)
 *   mac     = base64url(HMAC-SHA256(key, payload))
 *   key     = HKDF-SHA256(SESSION_SECRET, info "download-v1")
 *
 * The key is derived (same pattern as `admin-crypto.ts`), so a download MAC can
 * never be confused with any other use of the session secret. Tokens are
 * multi-use within the TTL (iOS sends HEAD then GET, Android's DownloadManager
 * retries) and bound to `file_version`: after an edit the route answers 410.
 * The MAC is checked in constant time before the payload is parsed.
 */

export const DOWNLOAD_TOKEN_TTL_SEC = 15 * 60;
/** HKDF info string (contract value — changing it invalidates every issued link). */
export const DOWNLOAD_TOKEN_INFO = "download-v1";

export type DownloadClaims = {
  /** Generation id. */
  g: string;
  /** Owner user id (the route re-checks ownership in SQL). */
  u: string;
  /** Registry format id. */
  f: DownloadFormatId;
  /** `generations.file_version` the bytes were prepared for. */
  v: number;
  /** Expiry, unix seconds. */
  exp: number;
};

export type TokenOptions = {
  /** Test seam: the secret (default `env.sessionSecret`). */
  secret?: string;
  /** Test seam: clock in ms (default `Date.now()`). */
  now?: number;
};

export type VerifyResult =
  | { ok: true; claims: DownloadClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

const MAC_LEN = 32;
/** base64url payload (≤ 600 chars) + "." + 43-char MAC. Anything else is rejected before any crypto. */
const TOKEN_RE = /^([A-Za-z0-9_-]{16,600})\.([A-Za-z0-9_-]{43})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_RE = /^[0-9A-Za-z_-]{1,64}$/;

let cachedKey: { secret: string; key: Buffer } | null = null;

function keyFor(secret: string): Buffer {
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), DOWNLOAD_TOKEN_INFO, 32));
  cachedKey = { secret, key };
  return key;
}

function mac(payload: string, secret: string): Buffer {
  return createHmac("sha256", keyFor(secret)).update(payload).digest();
}

/** Mints a token for `claims` valid for `DOWNLOAD_TOKEN_TTL_SEC` from now. */
export function signDownloadToken(
  claims: Omit<DownloadClaims, "exp">,
  opts: TokenOptions & { ttlSec?: number } = {},
): { token: string; expiresAt: Date } {
  const now = opts.now ?? Date.now();
  const exp = Math.floor(now / 1000) + (opts.ttlSec ?? DOWNLOAD_TOKEN_TTL_SEC);
  if (!UUID_RE.test(claims.g) || !USER_RE.test(claims.u) || !isDownloadFormatId(claims.f)) {
    throw new Error("download token: invalid claims");
  }
  if (!Number.isInteger(claims.v) || claims.v < 0) throw new Error("download token: invalid file version");
  // Fixed key order: the payload is what the MAC covers.
  const body: DownloadClaims = { g: claims.g.toLowerCase(), u: claims.u, f: claims.f, v: claims.v, exp };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const sig = mac(payload, opts.secret ?? env.sessionSecret).toString("base64url");
  return { token: `${payload}.${sig}`, expiresAt: new Date(exp * 1000) };
}

function parseClaims(payload: string): DownloadClaims | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.g !== "string" || !UUID_RE.test(c.g)) return null;
  if (typeof c.u !== "string" || !USER_RE.test(c.u)) return null;
  if (!isDownloadFormatId(c.f)) return null;
  if (typeof c.v !== "number" || !Number.isInteger(c.v) || c.v < 0) return null;
  if (typeof c.exp !== "number" || !Number.isInteger(c.exp)) return null;
  return { g: c.g, u: c.u, f: c.f, v: c.v, exp: c.exp };
}

/**
 * Verifies a token: shape, MAC (constant time), claims, then expiry.
 * A bad MAC is reported before the payload is even decoded.
 */
export function verifyDownloadToken(token: unknown, opts: TokenOptions = {}): VerifyResult {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };
  const m = TOKEN_RE.exec(token);
  if (!m) return { ok: false, reason: "malformed" };
  const [, payload, sig] = m;
  const given = Buffer.from(sig, "base64url");
  const want = mac(payload, opts.secret ?? env.sessionSecret);
  if (given.length !== MAC_LEN || !timingSafeEqual(given, want)) return { ok: false, reason: "bad_signature" };
  // Canonical base64url only: a re-encoded MAC with different trailing bits must not pass.
  if (given.toString("base64url") !== sig) return { ok: false, reason: "bad_signature" };
  const claims = parseClaims(payload);
  if (!claims) return { ok: false, reason: "malformed" };
  const now = opts.now ?? Date.now();
  if (Math.floor(now / 1000) >= claims.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

/** Relative URL the client (and Telegram) downloads from. */
export function downloadUrl(token: string): string {
  return `/api/dl/${token}`;
}
