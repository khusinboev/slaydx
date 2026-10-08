import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";

/**
 * Bot keyboard link tokens (docs/bot/PLAN.md Q1, `lib/server/bot-link.ts`):
 * format, key derivation, strict parsing, MAC, dates, `botAppUrl`, and the
 * pure client helpers in `lib/telegram-miniapp.ts`.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://slaydx.example";

const { signBotLink, verifyBotLink, botAppUrl, BOT_LINK_TTL_SEC, BOT_LINK_LENGTH, BOT_LINK_MAX_LENGTH } = await import(
  "../lib/server/bot-link.ts"
);
const { botLinkSessionAction } = await import("../lib/server/auth.ts");
const {
  botLinkFromSearch,
  botLinkTelegramId,
  botLinkOutcome,
  botChatUrl,
  hasBotLinkParam,
  hasKeyboardLaunchParams,
  isTelegramShellLaunch,
  withoutBotLink,
} = await import("../lib/telegram-miniapp.ts");

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const NOW_SEC = NOW / 1000;
const ID = "7012345678";

/** Re-signs raw bytes 0..12 with the documented key (HKDF-SHA256(SESSION_SECRET, label)). */
function forge(payload: Buffer, secret = process.env.SESSION_SECRET!): string {
  const key = Buffer.from(hkdfSync("sha256", secret, "", "slaydx/bot-link/v1", 32));
  const mac = createHmac("sha256", key).update(payload).digest().subarray(0, 16);
  return Buffer.concat([payload, mac]).toString("base64url");
}
function payload(version: number, id: number, iat: number): Buffer {
  const p = Buffer.alloc(13);
  p.writeUInt8(version, 0);
  p.writeUInt32BE(Math.floor(id / 2 ** 32), 1);
  p.writeUInt32BE(id % 2 ** 32, 5);
  p.writeUInt32BE(iat, 9);
  return p;
}

test("format: 39 URL-safe characters, version 1, id and issue time in the clear, documented HKDF key", () => {
  const t = signBotLink(ID, NOW);
  assert.equal(t.length, BOT_LINK_LENGTH);
  assert.match(t, /^[A-Za-z0-9_-]{39}$/);
  const raw = Buffer.from(t, "base64url");
  assert.equal(raw[0], 1);
  assert.equal(raw.readUInt32BE(9), NOW_SEC);
  assert.equal(t, forge(payload(1, Number(ID), NOW_SEC)), "MAC = HMAC-SHA256(HKDF(SESSION_SECRET, 'slaydx/bot-link/v1'), bytes 0..12)[:16]");
  assert.equal(signBotLink(Number(ID), NOW), t, "number and string ids sign the same");
});

test("verify: a fresh link is valid for 7 days, then expired", () => {
  const t = signBotLink(ID, NOW);
  assert.deepEqual(verifyBotLink(t, NOW), { ok: true, telegramId: ID, issuedAt: NOW_SEC, expiresAt: NOW_SEC + BOT_LINK_TTL_SEC });
  assert.equal(BOT_LINK_TTL_SEC, 7 * 86_400);
  assert.equal(verifyBotLink(t, NOW + (BOT_LINK_TTL_SEC - 1) * 1000).ok, true, "last second");
  assert.deepEqual(verifyBotLink(t, NOW + BOT_LINK_TTL_SEC * 1000), { ok: false, reason: "expired" });
  assert.deepEqual(verifyBotLink(t, NOW + 30 * 86_400_000), { ok: false, reason: "expired" });
});

test("verify: issue dates in the future beyond 60 s skew are refused", () => {
  assert.equal(verifyBotLink(signBotLink(ID, NOW + 60_000), NOW).ok, true, "60 s skew tolerated");
  assert.deepEqual(verifyBotLink(signBotLink(ID, NOW + 61_000), NOW), { ok: false, reason: "future" });
  assert.deepEqual(verifyBotLink(signBotLink(ID, NOW + 86_400_000), NOW), { ok: false, reason: "future" });
});

test("tamper: every single-bit flip of every byte is refused", () => {
  const t = signBotLink(ID, NOW);
  const raw = Buffer.from(t, "base64url");
  for (let i = 0; i < raw.length; i++) {
    for (let bit = 0; bit < 8; bit++) {
      const copy = Buffer.from(raw);
      copy[i]! ^= 1 << bit;
      const r = verifyBotLink(copy.toString("base64url"), NOW);
      assert.equal(r.ok, false, `byte ${i} bit ${bit}`);
    }
  }
  // Another account's id with the original MAC, a later date with the original MAC.
  const other = Buffer.concat([payload(1, 7012345679, NOW_SEC), raw.subarray(13)]).toString("base64url");
  assert.deepEqual(verifyBotLink(other, NOW), { ok: false, reason: "signature" });
  const later = Buffer.concat([payload(1, Number(ID), NOW_SEC + 3600), raw.subarray(13)]).toString("base64url");
  assert.deepEqual(verifyBotLink(later, NOW + 3600_000), { ok: false, reason: "signature" });
});

test("key: another SESSION_SECRET, the raw secret as key, or the session-hash scheme never verify", () => {
  const p = payload(1, Number(ID), NOW_SEC);
  assert.deepEqual(verifyBotLink(forge(p, "another-secret-another-secret-another-secret"), NOW), { ok: false, reason: "signature" });
  const rawKeyMac = createHmac("sha256", process.env.SESSION_SECRET!).update(p).digest().subarray(0, 16);
  assert.deepEqual(verifyBotLink(Buffer.concat([p, rawKeyMac]).toString("base64url"), NOW), { ok: false, reason: "signature" });
});

test("version: an unknown version byte is refused even with a valid MAC", () => {
  for (const v of [0, 2, 255]) {
    assert.deepEqual(verifyBotLink(forge(payload(v, Number(ID), NOW_SEC)), NOW), { ok: false, reason: "version" }, `v${v}`);
  }
});

test("strict parsing: type, length, alphabet, padding, non-canonical base64url, id range", () => {
  const t = signBotLink(ID, NOW);
  for (const bad of [undefined, null, 42, {}, [t], ""]) assert.deepEqual(verifyBotLink(bad, NOW), { ok: false, reason: "malformed" });
  assert.deepEqual(verifyBotLink(`${t}=`, NOW), { ok: false, reason: "malformed" }, "padding");
  assert.deepEqual(verifyBotLink(`${t} `, NOW), { ok: false, reason: "malformed" });
  assert.deepEqual(verifyBotLink(t.replace(/-|_/g, "+"), NOW).ok, false, "standard base64 alphabet");
  assert.deepEqual(verifyBotLink(t.slice(0, -1), NOW), { ok: false, reason: "malformed" }, "short");
  assert.deepEqual(verifyBotLink(`${t}AAAA`, NOW), { ok: false, reason: "malformed" }, "long");
  assert.deepEqual(verifyBotLink("A".repeat(BOT_LINK_MAX_LENGTH + 1), NOW), { ok: false, reason: "malformed" }, "over max length");
  assert.deepEqual(verifyBotLink("A".repeat(10_000), NOW), { ok: false, reason: "malformed" });
  // The last character carries 2 unused bits: a different spelling of the same bytes is refused.
  const last = t.at(-1)!;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const twin = t.slice(0, -1) + alphabet[alphabet.indexOf(last) ^ 1];
  assert.deepEqual(Buffer.from(twin, "base64url"), Buffer.from(t, "base64url"), "same bytes");
  assert.deepEqual(verifyBotLink(twin, NOW), { ok: false, reason: "malformed" }, "non-canonical");
  // Id 0 and ids above 2^53 - 1 (signed correctly) are refused.
  assert.deepEqual(verifyBotLink(forge(payload(1, 0, NOW_SEC)), NOW), { ok: false, reason: "malformed" });
  const huge = Buffer.alloc(13);
  huge.writeUInt8(1, 0);
  huge.writeUInt32BE(0x20_0000, 1);
  huge.writeUInt32BE(NOW_SEC, 9);
  assert.deepEqual(verifyBotLink(forge(huge), NOW), { ok: false, reason: "malformed" });
  assert.equal(verifyBotLink(signBotLink(Number.MAX_SAFE_INTEGER, NOW), NOW).ok, true, "2^53 - 1 is fine");
});

test("signBotLink refuses ids that are not positive safe integers", () => {
  for (const bad of [0, -1, 1.5, "abc", "012", "", Number.MAX_SAFE_INTEGER + 2, "99999999999999999"]) {
    assert.throws(() => signBotLink(bad as never, NOW), /invalid Telegram id/, String(bad));
  }
});

test("botAppUrl: https APP_URL + path + bt, existing query and fragment kept, stale bt replaced", () => {
  const u = new URL(botAppUrl(ID, "/uz/slide")!);
  assert.equal(u.origin, "https://slaydx.example");
  assert.equal(u.pathname, "/uz/slide");
  const bt = u.searchParams.get("bt")!;
  const v = verifyBotLink(bt);
  assert.equal(v.ok && v.telegramId, ID);
  const q = new URL(botAppUrl(ID, "uz/create?tool=image&bt=old#top")!);
  assert.equal(q.pathname, "/uz/create");
  assert.equal(q.searchParams.get("tool"), "image");
  assert.deepEqual(q.searchParams.getAll("bt").length, 1);
  assert.notEqual(q.searchParams.get("bt"), "old");
  assert.equal(q.hash, "#top");
  assert.equal(botAppUrl(ID, "//evil.example/x"), null, "protocol-relative path cannot leave the origin");
  assert.equal(botAppUrl(ID, "/\\evil.example"), null);
  assert.equal(botAppUrl("not-an-id", "/uz"), null);
});

test("botAppUrl: null for http / localhost app URLs (no web_app button)", async () => {
  // `env` is computed once at import: patch the field for this test.
  const { env } = await import("../lib/server/env.ts");
  const e = env as unknown as { appUrl: string };
  const saved = e.appUrl;
  try {
    for (const appUrl of ["http://slaydx.example", "https://localhost:3000", "https://127.0.0.1"]) {
      e.appUrl = appUrl;
      assert.equal(botAppUrl(ID, "/uz"), null, appUrl);
    }
    e.appUrl = "https://slaydx.example/base";
    assert.equal(new URL(botAppUrl(ID, "/uz")!).pathname, "/base/uz", "an APP_URL with a path prefix");
  } finally {
    e.appUrl = saved;
  }
});

test("botLinkSessionAction: a new session or a switch only when confirmed; the owner's own session silent; phone never replaced", () => {
  assert.equal(botLinkSessionAction(null, "42", false), "confirm_login", "review MAJOR: never a silent login");
  assert.equal(botLinkSessionAction(null, "42", true), "create");
  assert.equal(botLinkSessionAction({ telegramId: "42" }, "42", false), "reuse");
  assert.equal(botLinkSessionAction({ telegramId: 42 as unknown as string }, "42", false), "reuse");
  assert.equal(botLinkSessionAction({ telegramId: "77" }, "42", false), "confirm_switch", "never a silent switch");
  assert.equal(botLinkSessionAction({ telegramId: "77" }, "42", true), "replace");
  assert.equal(botLinkSessionAction({ telegramId: null }, "42", true), "refuse_phone");
  assert.equal(botLinkSessionAction({ telegramId: "" }, "42", false), "refuse_phone");
});

test("client helpers: bt read once (repeated / malformed → null), removed with every other parameter kept", () => {
  const t = signBotLink(ID, NOW);
  assert.equal(botLinkFromSearch(`?bt=${t}`), t);
  assert.equal(botLinkFromSearch(`?x=1&bt=${t}&y=2`), t);
  assert.equal(botLinkFromSearch(`?bt=${t}&bt=${t}`), null, "repeated");
  assert.equal(botLinkFromSearch("?bt=a%20b"), null);
  assert.equal(botLinkFromSearch(`?bt=${"A".repeat(65)}`), null);
  assert.equal(botLinkFromSearch("?x=1"), null);
  assert.equal(hasBotLinkParam("?bt="), true);
  assert.equal(hasBotLinkParam("?x=1"), false);
  assert.equal(withoutBotLink(`https://a.example/uz/slide?bt=${t}`), "/uz/slide");
  assert.equal(withoutBotLink(`/uz/slide?x=1&bt=${t}#h`), "/uz/slide?x=1#h", "relative (returnTo)");
  assert.equal(withoutBotLink(`https://a.example/uz/slide?x=1&bt=${t}&y=2#tgWebAppVersion=8.0`), "/uz/slide?x=1&y=2#tgWebAppVersion=8.0");
  assert.equal(botLinkTelegramId(t), ID);
  assert.equal(botLinkTelegramId(signBotLink(Number.MAX_SAFE_INTEGER, NOW)), String(Number.MAX_SAFE_INTEGER));
  assert.equal(botLinkTelegramId(signBotLink(1, NOW)), "1");
  assert.equal(botLinkTelegramId("x"), null);
  assert.equal(botLinkTelegramId(forge(payload(2, 5, NOW_SEC))), null, "unknown version");
  assert.equal(botChatUrl("@SlaydxBot"), "https://t.me/SlaydxBot");
  assert.equal(botChatUrl("bad name"), null);
  assert.equal(botChatUrl(null), null);
});

test("botLinkOutcome: 200 signed in, 409 confirm / kept, 401 expired, 403 with the reason, else error", () => {
  assert.deepEqual(botLinkOutcome(200, { }), { kind: "signed-in" });
  assert.deepEqual(botLinkOutcome(409, { code: "switch_confirm", to: "Ali (@ali)" }), { kind: "confirm", to: "Ali (@ali)" });
  assert.deepEqual(botLinkOutcome(409, { code: "switch_phone_session", error: "x" }), { kind: "kept" });
  assert.deepEqual(botLinkOutcome(409, { code: "login_confirm", to: "Ali (@ali)" }), { kind: "login", to: "Ali (@ali)" });
  assert.deepEqual(botLinkOutcome(401, { code: "bot_link_expired", error: "x" }), { kind: "expired", message: null });
  assert.deepEqual(botLinkOutcome(403, { code: "account_blocked", error: "Bloklangan" }), { kind: "expired", message: "Bloklangan" });
  assert.deepEqual(botLinkOutcome(429, { error: "Juda ko'p" }), { kind: "error", message: "Juda ko'p" });
  assert.deepEqual(botLinkOutcome(0, null), { kind: "error", message: null });
});

test("keyboard launch: Telegram's launch parameters without launch data count for the shell only with a webview signal", () => {
  assert.equal(hasKeyboardLaunchParams("#tgWebAppVersion=8.0&tgWebAppPlatform=android"), true);
  assert.equal(hasKeyboardLaunchParams("#tgWebAppData=&tgWebAppVersion=9.1"), true, "empty launch data");
  assert.equal(hasKeyboardLaunchParams("#tgWebAppData=x&tgWebAppVersion=9.1"), false, "launch data: the genuine rule applies");
  assert.equal(hasKeyboardLaunchParams("#tgWebAppVersion=8.0&tgWebAppVersion=8.0"), false);
  assert.equal(hasKeyboardLaunchParams("#tgWebAppVersion=evil"), false);
  assert.equal(hasKeyboardLaunchParams(""), false);
  const loc = (hash: string) => ({ hash });
  const proxy = { postEvent() {} };
  assert.equal(isTelegramShellLaunch({ TelegramWebviewProxy: proxy, location: loc("#tgWebAppVersion=8.0"), document: { referrer: "" } }), true);
  assert.equal(isTelegramShellLaunch({ location: loc("#tgWebAppVersion=8.0"), document: { referrer: "" } }), false, "plain browser");
  assert.equal(isTelegramShellLaunch({ TelegramWebviewProxy: proxy, location: loc(""), document: { referrer: "" } }), false, "no launch parameters");
});
