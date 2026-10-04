import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";

/**
 * Signed download URLs (docs/mobile/PLAN.md §4.2): HMAC over {g,u,f,v,exp}
 * with a key derived by HKDF from SESSION_SECRET (info "download-v1"),
 * 15 min TTL, constant-time check, tamper/expiry rejected. Pure — no DB.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { signDownloadToken, verifyDownloadToken, downloadUrl, DOWNLOAD_TOKEN_TTL_SEC, DOWNLOAD_TOKEN_INFO } = await import(
  "../lib/server/downloads/token.ts"
);

const SECRET = "another-test-secret-that-is-long-enough-123";
const GEN = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const base = { g: GEN, u: "42", f: "pdf" as const, v: 3 };

function split(token: string): [string, string] {
  const [p, s] = token.split(".");
  return [p, s];
}

function reencode(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

test("sign → verify round-trip returns exactly the bound claims; TTL is 15 minutes", () => {
  const { token, expiresAt } = signDownloadToken(base, { secret: SECRET, now: NOW });
  assert.equal(DOWNLOAD_TOKEN_TTL_SEC, 900);
  assert.equal(expiresAt.getTime(), NOW + 900_000);
  const v = verifyDownloadToken(token, { secret: SECRET, now: NOW });
  assert.ok(v.ok);
  assert.deepEqual(v.claims, { g: GEN, u: "42", f: "pdf", v: 3, exp: Math.floor(NOW / 1000) + 900 });
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/, "URL-safe, no padding");
  assert.equal(downloadUrl(token), `/api/dl/${token}`);
});

test("multi-use within the TTL (iOS HEAD + GET, Android retries); expired at exp", () => {
  const { token } = signDownloadToken(base, { secret: SECRET, now: NOW });
  for (const dt of [0, 1_000, 60_000, 899_000]) {
    assert.ok(verifyDownloadToken(token, { secret: SECRET, now: NOW + dt }).ok, `valid at +${dt} ms`);
  }
  assert.deepEqual(verifyDownloadToken(token, { secret: SECRET, now: NOW + 900_000 }), { ok: false, reason: "expired" });
  assert.deepEqual(verifyDownloadToken(token, { secret: SECRET, now: NOW + 3_600_000 }), { ok: false, reason: "expired" });
});

test("tampered claims (other user, other version, other format, other generation, longer expiry) fail the MAC", () => {
  const { token } = signDownloadToken(base, { secret: SECRET, now: NOW });
  const [payload, sig] = split(token);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  for (const change of [
    { u: "43" },
    { v: 4 },
    { f: "native" },
    { g: "1f8fad5b-d9cb-469f-a165-70867728950e" },
    { exp: (claims.exp as number) + 86_400 },
  ]) {
    const forged = `${reencode({ ...claims, ...change })}.${sig}`;
    assert.deepEqual(verifyDownloadToken(forged, { secret: SECRET, now: NOW }), { ok: false, reason: "bad_signature" }, JSON.stringify(change));
  }
});

test("a modified MAC, a non-canonical MAC encoding and another secret are rejected", () => {
  const { token } = signDownloadToken(base, { secret: SECRET, now: NOW });
  const [payload, sig] = split(token);
  const flipped = `${payload}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;
  assert.deepEqual(verifyDownloadToken(flipped, { secret: SECRET, now: NOW }), { ok: false, reason: "bad_signature" });
  // 43 base64url chars carry 258 bits: the last char's 2 low bits are padding. Same bytes, other text.
  const last = sig[42];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const twin = alphabet[alphabet.indexOf(last) ^ 1];
  const nonCanonical = `${payload}.${sig.slice(0, 42)}${twin}`;
  assert.deepEqual(Buffer.from(nonCanonical.split(".")[1], "base64url"), Buffer.from(sig, "base64url"), "decodes to the same MAC");
  assert.deepEqual(verifyDownloadToken(nonCanonical, { secret: SECRET, now: NOW }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifyDownloadToken(token, { secret: `${SECRET}x`, now: NOW }), { ok: false, reason: "bad_signature" });
});

test("the MAC key is HKDF(SESSION_SECRET, info download-v1), not the raw secret", () => {
  const { token } = signDownloadToken(base, { secret: SECRET, now: NOW });
  const [payload, sig] = split(token);
  assert.equal(DOWNLOAD_TOKEN_INFO, "download-v1");
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(SECRET), Buffer.alloc(0), "download-v1", 32));
  assert.equal(createHmac("sha256", key).update(payload).digest("base64url"), sig);
  assert.notEqual(createHmac("sha256", SECRET).update(payload).digest("base64url"), sig, "raw secret must not verify");
});

test("default secret is SESSION_SECRET", () => {
  const { token } = signDownloadToken(base, { now: NOW });
  assert.ok(verifyDownloadToken(token, { now: NOW }).ok);
  assert.ok(verifyDownloadToken(token, { secret: process.env.SESSION_SECRET, now: NOW }).ok);
  assert.equal(verifyDownloadToken(token, { secret: SECRET, now: NOW }).ok, false);
});

test("malformed input never reaches crypto or JSON.parse errors", () => {
  for (const bad of [undefined, null, 42, "", "abc", "a.b", `${"A".repeat(700)}.${"B".repeat(43)}`, "x".repeat(60), "a b.c"]) {
    assert.deepEqual(verifyDownloadToken(bad), { ok: false, reason: "malformed" }, String(bad).slice(0, 20));
  }
  // A correctly signed payload with invalid claims is still refused.
  const payload = reencode({ g: "not-a-uuid", u: "42", f: "pdf", v: 1, exp: 9_999_999_999 });
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(SECRET), Buffer.alloc(0), "download-v1", 32));
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  assert.deepEqual(verifyDownloadToken(`${payload}.${sig}`, { secret: SECRET, now: NOW }), { ok: false, reason: "malformed" });
  const unknownFormat = reencode({ g: GEN, u: "42", f: "exe", v: 1, exp: 9_999_999_999 });
  const sig2 = createHmac("sha256", key).update(unknownFormat).digest("base64url");
  assert.deepEqual(verifyDownloadToken(`${unknownFormat}.${sig2}`, { secret: SECRET, now: NOW }), { ok: false, reason: "malformed" });
});

test("signing refuses invalid claims", () => {
  assert.throws(() => signDownloadToken({ ...base, g: "x" }, { secret: SECRET }));
  assert.throws(() => signDownloadToken({ ...base, f: "exe" as never }, { secret: SECRET }));
  assert.throws(() => signDownloadToken({ ...base, v: -1 }, { secret: SECRET }));
  assert.throws(() => signDownloadToken({ ...base, u: "a/b" }, { secret: SECRET }));
});
