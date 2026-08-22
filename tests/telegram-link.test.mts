import test from "node:test";
import assert from "node:assert/strict";

/**
 * Telegram bir martalik kirish havolasi.
 *
 * Eski oqim (5 xonali kod) o'rniga: bot havola beradi, sessiya havolani
 * BOSGAN brauzerda ochiladi. Bu haqiqiy Postgres talab qiladi — chipta
 * jadvali va tranzaksiya ustida ishlaydi.
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.DATABASE_URL ??= "postgres://sodda:sodda@localhost:55432/sodda";
process.env.APP_URL ??= "http://localhost:3000";

const { ensureMigrated } = await import("../lib/server/db.ts");
await ensureMigrated();

const { createTicket, attachTicket, redeemLoginToken } = await import("../lib/server/telegram.ts");
const { query } = await import("../lib/server/db.ts");

function extractToken(link: string): string {
  return new URL(link).searchParams.get("t") ?? "";
}

test("chipta yaratiladi va bot uni bog'laganda havola qaytadi", async () => {
  const ticket = await createTicket("SlaydXBot");
  assert.match(ticket.url, /^https:\/\/t\.me\/SlaydXBot\?start=/);

  const link = await attachTicket(ticket.nonce, {
    telegramId: "111222333",
    username: "sinov_user",
    name: "Sinov Foydalanuvchi",
    photoUrl: null,
  });

  assert.ok(link, "havola qaytishi kerak");
  assert.match(link!, /^http:\/\/localhost:3000\/api\/auth\/telegram\/enter\?t=/);
  assert.ok(extractToken(link!).length >= 32, "token yetarlicha uzun bo'lishi kerak");
});

test("havola BIR MARTALIK — ikkinchi ishlatishda rad etiladi", async () => {
  const ticket = await createTicket("SlaydXBot");
  const link = await attachTicket(ticket.nonce, {
    telegramId: "222333444",
    username: null,
    name: "Ikkinchi Sinov",
    photoUrl: null,
  });
  const token = extractToken(link!);

  const first = await redeemLoginToken(token);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.user.telegramId, "222333444");

  const second = await redeemLoginToken(token);
  assert.deepEqual(second, { ok: false, reason: "expired" });
});

test("noto'g'ri yoki uydirma token rad etiladi", async () => {
  const result = await redeemLoginToken("bu-token-hech-qachon-bermagan-narsa-1234567890");
  assert.deepEqual(result, { ok: false, reason: "expired" });

  const tooShort = await redeemLoginToken("qisqa");
  assert.deepEqual(tooShort, { ok: false, reason: "invalid" });
});

test("bot hali Start bosmagan chiptadan kirib bo'lmaydi", async () => {
  const ticket = await createTicket("SlaydXBot");
  // `attachTicket` chaqirilmagan — `token_hash` bazada NULL, ya'ni
  // eski hujum yo'li (chiptaning nonce'ini token sifatida yuborish)
  // hech qanday qatorga mos kelmaydi. Natija `redeemLoginToken` uchun
  // «bunday token yo'q» bilan bir xil — bu ataylab shunday: ikkalasini
  // farqlash tashqi kuzatuvchiga qaysi chipta mavjudligini bildirardi.
  const result = await redeemLoginToken(ticket.nonce);
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("token bazada faqat XESH holida saqlanadi", async () => {
  const ticket = await createTicket("SlaydXBot");
  const link = await attachTicket(ticket.nonce, {
    telegramId: "333444555",
    username: null,
    name: "Xesh Sinovi",
    photoUrl: null,
  });
  const token = extractToken(link!);

  const row = await query<{ token_hash: string | null }>(
    "SELECT token_hash FROM login_tickets WHERE nonce = $1",
    [ticket.nonce],
  );
  assert.ok(row[0]?.token_hash, "token_hash yozilgan bo'lishi kerak");
  assert.notEqual(row[0]!.token_hash, token, "xom token bazada saqlanmasligi kerak");
});

test("eskirgan chiptaga bog'lash muvaffaqiyatsiz bo'ladi", async () => {
  // Muddati o'tgan chiptani to'g'ridan-to'g'ri kiritamiz — real vaqtda
  // 5 daqiqa kutmaslik uchun.
  const nonce = "expired-nonce-for-test-" + Date.now();
  await query("INSERT INTO login_tickets (nonce, expires_at) VALUES ($1, now() - interval '1 minute')", [
    nonce,
  ]);
  const link = await attachTicket(nonce, {
    telegramId: "444555666",
    username: null,
    name: "Eskirgan",
    photoUrl: null,
  });
  assert.equal(link, null);
});
