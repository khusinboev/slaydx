import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

/**
 * Admin cryptography (docs/admin/02-plan.md §3.4): RFC 4648 base32 vectors,
 * AES-256-GCM seal/open (round trip, tamper detection on every region,
 * version and context binding), key validation, token/code helpers.
 */

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
process.env.ADMIN_TOTP_KEY = KEY_A;

const crypto = await import("../lib/server/admin-crypto.ts");
const { parseAdminTotpKey } = await import("../lib/server/env.ts");

function withKey<T>(key: string | undefined, fn: () => T): T {
  const prev = process.env.ADMIN_TOTP_KEY;
  if (key === undefined) delete process.env.ADMIN_TOTP_KEY;
  else process.env.ADMIN_TOTP_KEY = key;
  try {
    return fn();
  } finally {
    process.env.ADMIN_TOTP_KEY = prev;
  }
}

function cryptoCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    assert.ok(crypto.isAdminCryptoError(e), `expected AdminCryptoError, got ${String(e)}`);
    return (e as { code: string }).code;
  }
  assert.fail("expected an AdminCryptoError");
}

test("base32: RFC 4648 §10 test vectors (encode with padding, decode back)", () => {
  const vectors: Array<[string, string]> = [
    ["", ""],
    ["f", "MY======"],
    ["fo", "MZXQ===="],
    ["foo", "MZXW6==="],
    ["foob", "MZXW6YQ="],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI======"],
  ];
  for (const [plain, enc] of vectors) {
    assert.equal(crypto.base32Encode(Buffer.from(plain)), enc, `encode ${JSON.stringify(plain)}`);
    assert.equal(crypto.base32Decode(enc).toString(), plain, `decode ${enc}`);
    assert.equal(crypto.base32Decode(enc.replace(/=+$/, "")).toString(), plain, "padding is optional");
    assert.equal(crypto.base32Decode(enc.toLowerCase()).toString(), plain, "case-insensitive");
  }
  assert.equal(crypto.base32Encode(Buffer.from("foobar"), false), "MZXW6YTBOI");
});

test("base32: round trip of random data; invalid characters and impossible lengths throw", () => {
  for (let i = 0; i < 200; i++) {
    const buf = randomBytes(i % 41);
    assert.deepEqual(crypto.base32Decode(crypto.base32Encode(buf)), buf);
  }
  for (const bad of ["MZXW6YT1", "MZXW6YT0", "MZXW6YT8", "MZ XW6YTB", "MZXW-6YTB"]) {
    assert.throws(() => crypto.base32Decode(bad), /base32: invalid/, bad);
  }
  for (const bad of ["M", "MZX", "MZXW6Y"]) {
    assert.throws(() => crypto.base32Decode(bad), /invalid length/, bad);
  }
});

test("seal/open: round trip, fresh IV each time, v1 base64url format", () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const a = crypto.seal(secret, "admin:1");
  const b = crypto.seal(secret, "admin:1");
  assert.match(a, /^v1\.[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b, "same plaintext must not give the same ciphertext (random IV)");
  assert.equal(crypto.open(a, "admin:1"), secret);
  assert.equal(crypto.open(b, "admin:1"), secret);
  assert.ok(!a.includes(secret), "plaintext must not appear in the sealed value");
  assert.equal(crypto.open(crypto.seal("", "x"), "x"), "", "empty plaintext round-trips");
  assert.equal(crypto.open(crypto.seal("ünïcödé ✓", ""), ""), "ünïcödé ✓");
});

test("seal/open: any modified byte (IV, tag or ciphertext) is rejected as tampered", () => {
  const sealed = crypto.seal("JBSWY3DPEHPK3PXP", "admin:7");
  const raw = Buffer.from(sealed.slice(3), "base64url");
  // IV = [0,12), tag = [12,28), ciphertext = [28, …)
  for (const i of [0, 11, 12, 27, 28, raw.length - 1]) {
    const copy = Buffer.from(raw);
    copy[i] = copy[i]! ^ 0x01;
    assert.equal(cryptoCode(() => crypto.open(`v1.${copy.toString("base64url")}`, "admin:7")), "tampered", `byte ${i}`);
  }
  // Truncated ciphertext (tag no longer matches).
  assert.equal(cryptoCode(() => crypto.open(`v1.${raw.subarray(0, raw.length - 1).toString("base64url")}`, "admin:7")), "tampered");
  // The context is authenticated: a ciphertext moved to another admin row does not open.
  assert.equal(cryptoCode(() => crypto.open(sealed, "admin:8")), "tampered");
  assert.equal(cryptoCode(() => crypto.open(sealed, "")), "tampered");
});

test("seal/open: wrong version, malformed payload and a different key are rejected", () => {
  const sealed = crypto.seal("x", "c");
  assert.equal(cryptoCode(() => crypto.open(`v2.${sealed.slice(3)}`, "c")), "bad_version");
  assert.equal(cryptoCode(() => crypto.open(sealed.slice(3), "c")), "bad_version");
  assert.equal(cryptoCode(() => crypto.open("", "c")), "bad_version");
  assert.equal(cryptoCode(() => crypto.open("v1.", "c")), "bad_format");
  assert.equal(cryptoCode(() => crypto.open("v1.abc+def", "c")), "bad_format");
  assert.equal(cryptoCode(() => crypto.open(`v1.${Buffer.alloc(27).toString("base64url")}`, "c")), "bad_format");
  withKey(KEY_B, () => {
    assert.equal(cryptoCode(() => crypto.open(sealed, "c")), "tampered", "another key must not open it");
  });
  assert.equal(crypto.open(sealed, "c"), "x", "back on the original key it opens again");
});

test("key: missing or invalid ADMIN_TOTP_KEY disables admin crypto with a typed error", () => {
  assert.equal(crypto.adminCryptoAvailable(), true);
  withKey(undefined, () => {
    assert.equal(crypto.adminCryptoAvailable(), false);
    assert.equal(cryptoCode(() => crypto.seal("x")), "key_missing");
    assert.equal(cryptoCode(() => crypto.hmacCode("AAAA-BBBB-CC")), "key_missing");
  });
  const valid32 = randomBytes(32).toString("base64");
  const invalid = [
    randomBytes(31).toString("base64"),
    randomBytes(33).toString("base64"),
    randomBytes(16).toString("hex"),
    "not base64 at all!!",
    `${valid32.slice(0, 10)} ${valid32.slice(10)}`,
    // base64url alphabet (`-`/`_`) is not the documented format.
    Buffer.alloc(32, 0xfb).toString("base64url"),
  ];
  for (const bad of invalid) {
    withKey(bad, () => {
      assert.equal(crypto.adminCryptoAvailable(), false, `accepted: ${bad}`);
      assert.equal(cryptoCode(() => crypto.seal("x")), "key_invalid");
    });
  }
  // Canonical encoding only: different trailing bits decode to the same 32
  // bytes with a lenient decoder, but are a different string → rejected.
  const last = valid32[42]!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const alt = alphabet[(alphabet.indexOf(last) & ~0b11) | ((alphabet.indexOf(last) + 1) & 0b11)]!;
  const nonCanonical = `${valid32.slice(0, 42)}${alt}=`;
  assert.equal(Buffer.from(nonCanonical, "base64").length, 32);
  assert.equal(parseAdminTotpKey(nonCanonical), null, "non-canonical base64 must be rejected");
  assert.ok(parseAdminTotpKey(valid32), "canonical key accepted");
  assert.ok(parseAdminTotpKey(valid32.replace(/=+$/, "")), "padding is optional");
  withKey(valid32, () => assert.equal(crypto.adminCryptoAvailable(), true));
});

test("tokens: randomToken is 32 bytes base64url and unique; hashToken is SHA-256 hex", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const t = crypto.randomToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(t, "base64url").length, 32);
    seen.add(t);
  }
  assert.equal(seen.size, 500);
  assert.equal(crypto.hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(crypto.hashToken("abc"), createHash("sha256").update("abc").digest("hex"));
});

test("recovery codes: XXXX-XXXX-XX over base32, normalized input, keyed HMAC", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const c = crypto.generateRecoveryCode();
    assert.match(c, crypto.RECOVERY_CODE_RE);
    seen.add(c);
  }
  assert.ok(seen.size > 995, "codes must not repeat in practice (50 bits)");

  const code = "ABCD-EFGH-23";
  assert.equal(crypto.normalizeRecoveryCode(code), "ABCDEFGH23");
  assert.equal(crypto.normalizeRecoveryCode(" abcd efgh 23 "), "ABCDEFGH23");
  for (const bad of ["ABCD-EFGH-21", "ABCD-EFGH", "ABCD-EFGH-234", "", 12345, null, "A".repeat(100)]) {
    assert.equal(crypto.normalizeRecoveryCode(bad), null, `accepted ${String(bad)}`);
  }
  const h = crypto.hmacCode(code);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(crypto.hmacCode("abcdefgh23"), h, "the stored hash is of the normalized code");
  assert.notEqual(h, createHash("sha256").update("ABCDEFGH23").digest("hex"), "must be keyed, not a bare hash");
  withKey(KEY_B, () => assert.notEqual(crypto.hmacCode(code), h, "a different master key gives a different MAC"));
});

test("enrollmentSecret: deterministic per token, 20 bytes of base32, independent across tokens and keys", () => {
  const t1 = crypto.randomToken();
  const t2 = crypto.randomToken();
  const s1 = crypto.enrollmentSecret(t1);
  assert.match(s1, /^[A-Z2-7]{32}$/);
  assert.equal(crypto.base32Decode(s1).length, 20);
  assert.equal(crypto.enrollmentSecret(t1), s1);
  assert.notEqual(crypto.enrollmentSecret(t2), s1);
  withKey(KEY_B, () => assert.notEqual(crypto.enrollmentSecret(t1), s1));
});
