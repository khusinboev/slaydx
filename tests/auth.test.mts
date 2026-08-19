import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

/**
 * Telegram imzosini tekshirish.
 *
 * Bu eng muhim sinov: imzo noto'g'ri tekshirilsa, har kim istalgan
 * Telegram ID nomidan kira oladi — ya'ni butun akkaunt tizimi ochiladi.
 *
 * `lib/server/auth` ni to'g'ridan-to'g'ri import qilamiz, lekin u
 * `env.telegramBotToken` ni modul yuklanganda o'qiydi — shuning uchun
 * token testdan oldin o'rnatiladi.
 */

const BOT_TOKEN = "123456:TEST-BOT-TOKEN-FOR-UNIT-TESTS";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { verifyLoginWidget, verifyMiniAppInitData, normalizeIdentifier } = await import(
  "../lib/server/auth.ts"
);

function checkString(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function signWidget(data: Record<string, string>): Record<string, string> {
  const secret = createHash("sha256").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(checkString(data)).digest("hex");
  return { ...data, hash };
}

function signInitData(fields: Record<string, string>): string {
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(checkString(fields)).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const now = () => Math.floor(Date.now() / 1000);

test("Login Widget: to'g'ri imzo qabul qilinadi", () => {
  const profile = verifyLoginWidget(
    signWidget({
      id: "777",
      first_name: "Ali",
      last_name: "Valiyev",
      username: "ali",
      auth_date: String(now()),
    }),
  );
  assert.equal(profile?.telegramId, "777");
  assert.equal(profile?.name, "Ali Valiyev");
  assert.equal(profile?.username, "ali");
});

test("Login Widget: buzilgan maydon rad etiladi", () => {
  const signed = signWidget({ id: "777", first_name: "Ali", auth_date: String(now()) });
  // Tajovuzkor boshqa Telegram ID ni qo'ymoqchi.
  assert.equal(verifyLoginWidget({ ...signed, id: "999" }), null);
});

test("Login Widget: hash yo'q — rad etiladi", () => {
  assert.equal(verifyLoginWidget({ id: "777", auth_date: String(now()) }), null);
});

test("Login Widget: eski auth_date rad etiladi", () => {
  const stale = signWidget({ id: "777", first_name: "Ali", auth_date: String(now() - 90_000) });
  assert.equal(verifyLoginWidget(stale), null);
});

test("Mini App: to'g'ri initData qabul qilinadi", () => {
  const initData = signInitData({
    auth_date: String(now()),
    query_id: "AAA",
    user: JSON.stringify({ id: 42, first_name: "Dilnoza", username: "dil" }),
  });
  const profile = verifyMiniAppInitData(initData);
  assert.equal(profile?.telegramId, "42");
  assert.equal(profile?.name, "Dilnoza");
});

test("Mini App: buzilgan user maydoni rad etiladi", () => {
  const initData = signInitData({
    auth_date: String(now()),
    user: JSON.stringify({ id: 42, first_name: "Dilnoza" }),
  });
  const tampered = initData.replace(/user=[^&]+/, `user=${encodeURIComponent('{"id":1,"first_name":"Admin"}')}`);
  assert.equal(verifyMiniAppInitData(tampered), null);
});

test("Mini App: bo'sh initData rad etiladi", () => {
  assert.equal(verifyMiniAppInitData(""), null);
  assert.equal(verifyMiniAppInitData("hash=abc"), null);
});

test("normalizeIdentifier: bir xil raqam bir xil bucket ga tushadi", () => {
  assert.equal(normalizeIdentifier(" +998 90 123 45 67 "), "+998901234567");
  assert.equal(normalizeIdentifier("ALI"), "ali");
});
