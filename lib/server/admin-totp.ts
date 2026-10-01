import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { base32Decode, base32Encode } from "./admin-crypto";

/**
 * TOTP (RFC 6238) for the admin second factor: HMAC-SHA1, 6 digits, 30 s
 * step, ±1 step window (docs/admin/02-plan.md §3.1). SHA-1 is what every
 * authenticator app supports by default; HOTP's truncation keeps it safe here.
 */

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

/** 20 random bytes (the RFC 4226 recommended length) as unpadded base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20), false);
}

/** RFC 4226 HOTP. Exported for the RFC 6238 Appendix B vectors (8 digits). */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("hotp: invalid counter");
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

export function totpCode(secretB32: string, step: number): string {
  return hotp(base32Decode(secretB32), step);
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Checks `code` against steps now-1 … now+1 and accepts only a step strictly
 * greater than `lastStep` (replay guard; the caller then persists the step
 * atomically). Every candidate is compared in constant time and the loop
 * never exits early, so timing does not reveal which window matched.
 */
export function verifyTotp(secretB32: string, code: unknown, nowMs: number, lastStep: number): TotpResult {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return { ok: false };
  let key: Buffer;
  try {
    key = base32Decode(secretB32);
  } catch {
    return { ok: false };
  }
  const now = totpStep(nowMs);
  const given = Buffer.from(code);
  let matched = -1;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const step = now + d;
    if (step < 0) continue;
    const expected = Buffer.from(hotp(key, step));
    const equal = timingSafeEqual(expected, given);
    if (equal && step > lastStep && step > matched) matched = step;
  }
  return matched >= 0 ? { ok: true, step: matched } : { ok: false };
}

/** Key URI for authenticator apps (Google Authenticator "Key Uri Format"). */
export function otpauthUri(p: { issuer: string; account: string; secret: string }): string {
  const issuer = encodeURIComponent(p.issuer);
  const label = `${issuer}:${encodeURIComponent(p.account)}`;
  const params = new URLSearchParams({
    secret: p.secret,
    issuer: p.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** QR code (SVG markup) of the key URI; generated server-side, no third party sees the secret. */
export async function qrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 240 });
}
