import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { BOT_LINK_PARAM } from "../telegram-miniapp";

/**
 * Personal WebApp links for the bot's reply keyboard (docs/bot/PLAN.md, owner decision Q1).
 *
 * A reply-keyboard `web_app` button opens the Mini App with EMPTY initData, so the
 * usual silent Mini App login cannot run there. The bot therefore puts a per-user
 * signed link token into each keyboard URL (`?bt=…`); the page exchanges it for a
 * session at `POST /api/auth/bot-link`.
 *
 * Token (version 1), base64url without padding, exactly 39 characters:
 *
 *   byte 0       version (1)
 *   bytes 1..8   Telegram user id, unsigned 64-bit big-endian (1 … 2^53-1)
 *   bytes 9..12  issued-at, unix seconds, unsigned 32-bit big-endian
 *   bytes 13..28 HMAC-SHA256(key, bytes 0..12), first 16 bytes
 *
 * The key is derived from SESSION_SECRET with HKDF-SHA256 under the label
 * `slaydx/bot-link/v1`, so it never equals the session or OTP keys and rotating
 * SESSION_SECRET voids every outstanding link. Validity is `BOT_LINK_TTL_SEC`
 * (7 days) from issue. Revocation is not in the token: the exchange rejects a
 * link issued before any later revocation of one of the user's sessions
 * (`botLinkAccount` in `lib/server/auth.ts`, `sessions.revoked_at`) and any link
 * of a blocked user.
 *
 * The token is a bearer credential: never log it, never put it in an error message.
 */

export const BOT_LINK_VERSION = 1;
/** Validity of a link from issue (owner decision Q1: 7 days; the bot refreshes on /start and «Profilim»). */
export const BOT_LINK_TTL_SEC = 7 * 86_400;
/** Issue dates this far ahead of the server clock are tolerated (clock skew between processes). */
export const BOT_LINK_SKEW_SEC = 60;
/** Exact length of a version-1 token (29 bytes, base64url). */
export const BOT_LINK_LENGTH = 39;
/** Anything longer is refused before decoding. */
export const BOT_LINK_MAX_LENGTH = 64;

const PAYLOAD_BYTES = 13;
const MAC_BYTES = 16;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const KEY_LABEL = "slaydx/bot-link/v1";

let cachedKey: { secret: string; key: Buffer } | null = null;

function linkKey(): Buffer {
  const secret = env.sessionSecret;
  if (cachedKey?.secret !== secret) {
    cachedKey = { secret, key: Buffer.from(hkdfSync("sha256", secret, "", KEY_LABEL, 32)) };
  }
  return cachedKey.key;
}

function mac(payload: Buffer): Buffer {
  return createHmac("sha256", linkKey()).update(payload).digest().subarray(0, MAC_BYTES);
}

/** A Telegram user id as a positive safe integer, or `null`. */
function telegramIdOf(raw: number | string): number | null {
  const s = typeof raw === "number" ? (Number.isSafeInteger(raw) ? String(raw) : "") : String(raw).trim();
  if (!/^[1-9]\d{0,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Signs a link for `telegramId`, issued at `nowMs`. Throws on an invalid id. */
export function signBotLink(telegramId: number | string, nowMs: number = Date.now()): string {
  const id = telegramIdOf(telegramId);
  if (id === null) throw new Error("bot link: invalid Telegram id");
  const iat = Math.floor(nowMs / 1000);
  if (!(iat > 0 && iat <= 0xffff_ffff)) throw new Error("bot link: issue time out of range");
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt8(BOT_LINK_VERSION, 0);
  payload.writeUInt32BE(Math.floor(id / 0x1_0000_0000), 1);
  payload.writeUInt32BE(id % 0x1_0000_0000, 5);
  payload.writeUInt32BE(iat, 9);
  return Buffer.concat([payload, mac(payload)]).toString("base64url");
}

export type BotLinkFailure = "malformed" | "version" | "signature" | "expired" | "future";
export type BotLinkCheck =
  | { ok: true; telegramId: string; issuedAt: number; expiresAt: number }
  | { ok: false; reason: BotLinkFailure };

/**
 * Strict, constant-time verification. Order: shape (type, length, alphabet,
 * canonical base64url) → version → MAC → dates. Only a token whose MAC holds
 * can be reported `expired`/`future`: those reasons never confirm anything
 * about a forged token.
 */
export function verifyBotLink(token: unknown, nowMs: number = Date.now()): BotLinkCheck {
  if (typeof token !== "string" || token.length > BOT_LINK_MAX_LENGTH || !TOKEN_RE.test(token)) {
    return { ok: false, reason: "malformed" };
  }
  const raw = Buffer.from(token, "base64url");
  // Non-canonical spellings (trailing bits) decode to the same bytes: refuse them.
  if (raw.length < 1 || raw.toString("base64url") !== token) return { ok: false, reason: "malformed" };
  if (raw[0] !== BOT_LINK_VERSION) return { ok: false, reason: "version" };
  if (token.length !== BOT_LINK_LENGTH || raw.length !== PAYLOAD_BYTES + MAC_BYTES) {
    return { ok: false, reason: "malformed" };
  }
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  if (!timingSafeEqual(mac(payload), raw.subarray(PAYLOAD_BYTES))) return { ok: false, reason: "signature" };

  const hi = payload.readUInt32BE(1);
  const id = hi * 0x1_0000_0000 + payload.readUInt32BE(5);
  // `hi` above 2^21 - 1 means an id beyond Number.MAX_SAFE_INTEGER.
  if (hi >= 0x20_0000 || id < 1) return { ok: false, reason: "malformed" };
  const issuedAt = payload.readUInt32BE(9);
  const nowSec = Math.floor(nowMs / 1000);
  if (issuedAt > nowSec + BOT_LINK_SKEW_SEC) return { ok: false, reason: "future" };
  const expiresAt = issuedAt + BOT_LINK_TTL_SEC;
  if (nowSec >= expiresAt) return { ok: false, reason: "expired" };
  return { ok: true, telegramId: String(id), issuedAt, expiresAt };
}

/**
 * `${APP_URL}${path}` with the user's link token in `?bt=` (an existing query
 * and fragment are kept; a stale `bt` is replaced). `null` when the app URL is
 * not public https (localhost, http) or the id / path is unusable — the caller
 * then sends no web_app button.
 */
export function botAppUrl(telegramId: number | string, path: string): string | null {
  const base = env.appUrl;
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) return null;
  if (telegramIdOf(telegramId) === null) return null;
  const rel = path.startsWith("/") ? path : `/${path}`;
  // `//host` or `/\host` would make the URL parser leave our origin.
  if (/^\/[/\\]/.test(rel)) return null;
  let url: URL;
  let origin: string;
  try {
    origin = new URL(base).origin;
    url = new URL(`${base.replace(/\/$/, "")}${rel}`);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  url.searchParams.delete(BOT_LINK_PARAM);
  url.searchParams.set(BOT_LINK_PARAM, signBotLink(telegramId));
  return url.toString();
}
