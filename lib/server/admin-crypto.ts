import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { env, parseAdminTotpKey } from "./env";

/**
 * Admin cryptography (docs/admin/02-plan.md §3.4).
 *
 *   • `seal`/`open` — AES-256-GCM for TOTP secrets at rest. Format
 *     `v1.` + base64url(iv(12) | tag(16) | ciphertext). Any other version, a
 *     malformed payload or a failed tag check is an error, never a fallback.
 *   • `hmacCode` — recovery codes are stored as HMAC-SHA256 under a key
 *     derived from the master key, so a DB dump alone cannot be brute-forced
 *     offline (50-bit codes would otherwise fall to a GPU in minutes).
 *   • `hashToken`/`randomToken` — enrollment and session tokens: 32 random
 *     bytes, only their SHA-256 is stored (same scheme as `session.ts`).
 *
 * The master key is `ADMIN_TOTP_KEY` (base64, exactly 32 bytes). It is never
 * used directly: HKDF derives one sub-key per purpose, so the encryption key
 * and the recovery-code MAC key are independent.
 */

export type AdminCryptoErrorCode = "key_missing" | "key_invalid" | "bad_format" | "bad_version" | "tampered";

export class AdminCryptoError extends Error {
  readonly code: AdminCryptoErrorCode;
  constructor(code: AdminCryptoErrorCode, message: string) {
    super(message);
    this.name = "AdminCryptoError";
    this.code = code;
  }
}

/**
 * Duck-typed check: tsx may load this module twice under different specifiers
 * (docs/admin/01-analysis.md §8.1), which breaks `instanceof` across copies.
 */
export function isAdminCryptoError(e: unknown): e is AdminCryptoError {
  return e instanceof Error && e.name === "AdminCryptoError" && typeof (e as { code?: unknown }).code === "string";
}

type Keys = { raw: string; enc: Buffer; recovery: Buffer; enroll: Buffer };
let cached: Keys | null = null;

function derive(master: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `slaydx:${info}`, 32));
}

/** Throws `AdminCryptoError` (`key_missing`/`key_invalid`) when the key is unusable. */
function keys(): Keys {
  const raw = env.adminTotpKey;
  if (cached && cached.raw === raw) return cached;
  if (!raw) throw new AdminCryptoError("key_missing", "ADMIN_TOTP_KEY is not set");
  const master = parseAdminTotpKey(raw);
  if (!master) throw new AdminCryptoError("key_invalid", "ADMIN_TOTP_KEY must be base64 of exactly 32 bytes");
  cached = {
    raw,
    enc: derive(master, "admin-totp-seal"),
    recovery: derive(master, "admin-recovery"),
    enroll: derive(master, "admin-enroll"),
  };
  return cached;
}

/** `true` when `ADMIN_TOTP_KEY` is present and valid (admin login/enrollment can work). */
export function adminCryptoAvailable(): boolean {
  try {
    keys();
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────── base32 (RFC 4648 §6)

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Uint8Array, pad = true): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  if (pad) while (out.length % 8 !== 0) out += "=";
  return out;
}

/**
 * Decodes base32 (case-insensitive, padding optional). Throws on characters
 * outside the alphabet or on a length no encoder can produce (1, 3 or 6
 * trailing symbols), so a corrupted secret is an error, not a different key.
 */
export function base32Decode(text: string): Buffer {
  const s = text.replace(/=+$/, "").toUpperCase();
  if (![0, 2, 4, 5, 7].includes(s.length % 8)) throw new Error("base32: invalid length");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("base32: invalid character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

// ───────────────────────────── AES-256-GCM seal/open

const VERSION = "v1.";
const IV_LEN = 12;
const TAG_LEN = 16;

function aadFor(context: string): Buffer {
  return Buffer.from(`slaydx-admin-seal:v1:${context}`);
}

/**
 * Encrypts `plain`. `context` is bound as additional authenticated data (the
 * admin id for TOTP secrets), so a ciphertext copied onto another account row
 * does not open there.
 */
export function seal(plain: string, context = ""): string {
  const { enc } = keys();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", enc, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aadFor(context));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION + Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function open(sealed: string, context = ""): string {
  const { enc } = keys();
  if (typeof sealed !== "string" || !sealed.startsWith(VERSION)) {
    throw new AdminCryptoError("bad_version", "unsupported sealed value version");
  }
  const body = sealed.slice(VERSION.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new AdminCryptoError("bad_format", "sealed value is not base64url");
  const raw = Buffer.from(body, "base64url");
  if (raw.length < IV_LEN + TAG_LEN) throw new AdminCryptoError("bad_format", "sealed value is too short");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv("aes-256-gcm", enc, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(aadFor(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong context or modified bytes — GCM cannot tell which.
    throw new AdminCryptoError("tampered", "sealed value failed authentication");
  }
}

// ───────────────────────────── tokens and codes

/** 32 random bytes, base64url (43 chars). */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex — what the DB stores for session and enrollment tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Recovery codes: `XXXX-XXXX-XX` over the base32 alphabet (50 bits). */
export const RECOVERY_CODE_RE = /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{2}$/;

export function generateRecoveryCode(): string {
  // 7 random bytes → 11+ base32 symbols, each a uniform 5-bit slice; keep 10.
  const s = base32Encode(randomBytes(7), false).slice(0, 10);
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 10)}`;
}

/**
 * Canonical form of user input: upper-case, separators and spaces removed.
 * `null` when what remains cannot be a recovery code.
 */
export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{10}$/.test(s) ? s : null;
}

/** HMAC-SHA256 (hex) of a normalized recovery code under the "admin-recovery" sub-key. */
export function hmacCode(code: string): string {
  const normalized = normalizeRecoveryCode(code) ?? code;
  return createHmac("sha256", keys().recovery).update(normalized).digest("hex");
}

/**
 * The TOTP secret offered during enrollment, derived from the enrollment
 * token (20 bytes → base32). Nothing is stored until the code is confirmed:
 * GET and POST with the same token see the same secret, and only someone
 * holding the token (shown once, stored hashed) can compute it.
 */
export function enrollmentSecret(token: string): string {
  const mac = createHmac("sha256", keys().enroll).update(token).digest();
  return base32Encode(mac.subarray(0, 20), false);
}
