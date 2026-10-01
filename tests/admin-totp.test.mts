import test from "node:test";
import assert from "node:assert/strict";

/**
 * TOTP (RFC 6238) for the admin second factor: Appendix B SHA-1 vectors,
 * the ±1 step window, the replay guard (`step > lastStep`), input strictness,
 * the key URI and the QR SVG.
 */

const { hotp, totpCode, totpStep, verifyTotp, generateTotpSecret, otpauthUri, qrSvg } = await import(
  "../lib/server/admin-totp.ts"
);
const { base32Encode, base32Decode } = await import("../lib/server/admin-crypto.ts");

// RFC 6238 Appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const SEED = Buffer.from("12345678901234567890", "ascii");
const SEED_B32 = base32Encode(SEED, false);
const VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("RFC 6238 Appendix B (SHA-1): 8-digit vectors via HOTP", () => {
  assert.equal(SEED_B32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  for (const [t, code] of VECTORS) {
    assert.equal(hotp(SEED, Math.floor(t / 30), 8), code, `T=${t}`);
  }
});

test("6-digit codes are the last 6 digits of the RFC vectors; totpStep is floor(t/30)", () => {
  for (const [t, code] of VECTORS) {
    assert.equal(totpStep(t * 1000), Math.floor(t / 30));
    assert.equal(totpCode(SEED_B32, totpStep(t * 1000)), code.slice(-6), `T=${t}`);
  }
});

test("verifyTotp: accepts steps now-1, now, now+1; rejects now±2", () => {
  const now = 1111111111 * 1000;
  const step = totpStep(now);
  for (const d of [-1, 0, 1]) {
    const res = verifyTotp(SEED_B32, totpCode(SEED_B32, step + d), now, 0);
    assert.deepEqual(res, { ok: true, step: step + d }, `d=${d}`);
  }
  for (const d of [-2, 2, -10]) {
    assert.deepEqual(verifyTotp(SEED_B32, totpCode(SEED_B32, step + d), now, 0), { ok: false }, `d=${d}`);
  }
});

test("verifyTotp: replay guard — a step <= lastStep is never accepted again", () => {
  const now = 2000000000 * 1000;
  const step = totpStep(now);
  const code = totpCode(SEED_B32, step);
  assert.deepEqual(verifyTotp(SEED_B32, code, now, step - 1), { ok: true, step });
  assert.deepEqual(verifyTotp(SEED_B32, code, now, step), { ok: false }, "the same step twice");
  assert.deepEqual(verifyTotp(SEED_B32, code, now, step + 1), { ok: false }, "an older step after a newer one");
  // The previous window's code after the current one was used: rejected too.
  assert.deepEqual(verifyTotp(SEED_B32, totpCode(SEED_B32, step - 1), now, step), { ok: false });
  // A future-window code is fine once (clock skew), and then burns that step.
  assert.deepEqual(verifyTotp(SEED_B32, totpCode(SEED_B32, step + 1), now, step), { ok: true, step: step + 1 });
});

test("verifyTotp: malformed input is rejected without throwing", () => {
  const now = Date.now();
  const good = totpCode(SEED_B32, totpStep(now));
  for (const bad of [
    "",
    good.slice(0, 5),
    `${good}0`,
    ` ${good}`,
    good.replace(/\d$/, "x"),
    "１２３４５６",
    Number(good),
    null,
    undefined,
    { code: good },
  ]) {
    assert.deepEqual(verifyTotp(SEED_B32, bad, now, 0), { ok: false }, `accepted ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(verifyTotp("not*base32", good, now, 0), { ok: false }, "a corrupt secret fails closed");
  assert.deepEqual(verifyTotp(SEED_B32, good, now, 0).ok, true);
});

test("verifyTotp: a wrong code for another secret does not pass", () => {
  const other = generateTotpSecret();
  const now = Date.now();
  let accepted = 0;
  for (let i = 0; i < 50; i++) {
    const code = totpCode(generateTotpSecret(), totpStep(now));
    if (verifyTotp(other, code, now, 0).ok) accepted++;
  }
  assert.ok(accepted <= 1, `unexpectedly many cross-secret matches: ${accepted}`);
});

test("generateTotpSecret: 20 random bytes as unpadded base32", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const s = generateTotpSecret();
    assert.match(s, /^[A-Z2-7]{32}$/);
    assert.equal(base32Decode(s).length, 20);
    seen.add(s);
  }
  assert.equal(seen.size, 100);
});

test("otpauthUri: label, secret, issuer and the RFC parameters; special characters encoded", () => {
  const uri = otpauthUri({ issuer: "SlaydX", account: "ali & vali", secret: SEED_B32 });
  const u = new URL(uri);
  assert.equal(u.protocol, "otpauth:");
  assert.ok(uri.startsWith("otpauth://totp/SlaydX:ali%20%26%20vali?"), uri);
  assert.equal(u.searchParams.get("secret"), SEED_B32);
  assert.equal(u.searchParams.get("issuer"), "SlaydX");
  assert.equal(u.searchParams.get("algorithm"), "SHA1");
  assert.equal(u.searchParams.get("digits"), "6");
  assert.equal(u.searchParams.get("period"), "30");
});

test("qrSvg: renders an SVG locally", async () => {
  const svg = await qrSvg(otpauthUri({ issuer: "SlaydX", account: "a", secret: SEED_B32 }));
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
});
