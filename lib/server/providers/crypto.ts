import "server-only";
import { hkdfSync } from "node:crypto";
import { AdminCryptoError, openWith, sealWith } from "../admin-crypto";
import { env, parseAdminTotpKey } from "../env";

/**
 * Encryption of provider API keys at rest (program-17 decision D7).
 *
 * Primitive: the AES-256-GCM core of `admin-crypto.ts` (`sealWith`/`openWith`), but under a SEPARATE key, so the
 * provider store is not coupled to the TOTP secrets' key.
 *
 *   master key   `PROVIDER_KEYS_KEY` (base64 of exactly 32 bytes) when set; otherwise `ADMIN_TOTP_KEY`.
 *                A set but malformed `PROVIDER_KEYS_KEY` is an error, never a silent fall back to the other key.
 *   sealing key  HKDF-SHA256(master, salt = empty, info = "slaydx/provider-keys/v1", 32 bytes) in BOTH cases:
 *                the master is never used directly, and the derived key differs from every key `admin-crypto.ts`
 *                derives from the same master (different `info`), so one leaked purpose does not open the other.
 *   format       `pk1.` + base64url(iv(12) | tag(16) | ciphertext); the column is `bytea` holding those ASCII bytes.
 *                The version prefix lets a future format coexist; any other prefix is `bad_version`, never a guess.
 *   AAD          `slaydx-provider-key:v1:<providerId>`: a ciphertext copied onto another provider's row does not open.
 *
 * Changing the master key (or switching from the `ADMIN_TOTP_KEY` fallback to `PROVIDER_KEYS_KEY`) makes existing
 * ciphertexts unreadable (`tampered`): the store reports them as unreadable and the admin enters the keys again.
 */

/** HKDF `info` of the sealing key. Part of the format: changing it orphans every stored key. */
export const PROVIDER_KEYS_CONTEXT = "slaydx/provider-keys/v1";

const VERSION = "pk1.";

/** HKDF-SHA256 sub-key of `master` for `context` (exported for the tests: a different context gives a different key). */
export function deriveProviderSealKey(master: Buffer, context: string = PROVIDER_KEYS_CONTEXT): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), context, 32));
}

type Cached = { providerRaw: string; adminRaw: string; key: Buffer };
let cached: Cached | null = null;

/** Throws `AdminCryptoError` (`key_missing`/`key_invalid`) when no usable master key exists. */
function sealKey(): Buffer {
  const providerRaw = env.providerKeysKey;
  const adminRaw = env.adminTotpKey;
  if (cached && cached.providerRaw === providerRaw && cached.adminRaw === adminRaw) return cached.key;
  let master: Buffer | null;
  if (providerRaw) {
    master = parseAdminTotpKey(providerRaw);
    if (!master) throw new AdminCryptoError("key_invalid", "PROVIDER_KEYS_KEY must be base64 of exactly 32 bytes");
  } else {
    if (!adminRaw) throw new AdminCryptoError("key_missing", "neither PROVIDER_KEYS_KEY nor ADMIN_TOTP_KEY is set");
    master = parseAdminTotpKey(adminRaw);
    if (!master) throw new AdminCryptoError("key_invalid", "ADMIN_TOTP_KEY must be base64 of exactly 32 bytes");
  }
  cached = { providerRaw, adminRaw, key: deriveProviderSealKey(master) };
  return cached.key;
}

function aadFor(providerId: string): Buffer {
  return Buffer.from(`slaydx-provider-key:v1:${providerId}`);
}

/** `true` when a usable master key exists, i.e. keys can be stored and read. */
export function providerCryptoAvailable(): boolean {
  try {
    sealKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypts `plain` for `providerId`; the result is what the `key_ciphertext` column holds. */
export function sealProviderKey(providerId: string, plain: string): Buffer {
  return Buffer.from(sealWith(sealKey(), VERSION, aadFor(providerId), plain), "ascii");
}

/** Decrypts a `key_ciphertext` value of `providerId`. Throws `AdminCryptoError` on a wrong provider, key or modified bytes. */
export function openProviderKey(providerId: string, blob: Buffer): string {
  return openWith(sealKey(), VERSION, aadFor(providerId), blob.toString("ascii"));
}
