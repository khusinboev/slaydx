import test from "node:test";
import assert from "node:assert/strict";

/**
 * C01 (SECA-01 / DEPS-08 / ABUSE-06 / TEST-12) — soxta Telegram kontakt
 * orqali admin bo'lib olish.
 *
 * Ilgari `handleContact` ikkita teshik bilan yozilgan edi:
 *   1. `contact.user_id != null && contact.user_id !== fromId` faqat
 *      user_id BOR va BOSHQA bo'lganda rad etardi — Bot API'da
 *      `Contact.user_id` IXTIYORIY: har qanday vizit-kartochka yoki
 *      MTProto klient (masalan Pyrogram `send_contact`) uni bermaydi,
 *      shuning uchun user_id'siz — hatto forward qilingan — kontakt
 *      "o'zining kontakti" sifatida o'tib ketardi.
 *   2. Telefon xom holda (`+${raqamlar}`) saqlanardi, `isAdminPhone` esa
 *      9 xonali "milliy" shaklni `998` bilan kengaytirardi — ya'ni admin
 *      raqamining mamlakat kodisiz shakli (`+<9 raqam>`) raw-string
 *      unique indeksdan qochib, lekin admin tekshiruvidan o'tardi.
 *
 * Bu fayl ikkalasini ham qulflaydi. Haqiqiy Postgres talab qiladi
 * (`users`, `telegram_updates`). Telegram'ga HECH QANDAY tarmoq
 * so'rovi ketmaydi — `fetch` stub qilingan.
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.DATABASE_URL ??= "postgres://sodda:sodda@localhost:55432/sodda";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-fake-1234567890";

const { ensureMigrated } = await import("../lib/server/db.ts");
await ensureMigrated();

const { handleUpdate } = await import("../lib/server/telegram.ts");
const { isAdminPhone } = await import("../lib/server/admin-phones.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { query } = await import("../lib/server/db.ts");

// `lib/server/admin-phones.ts` dagi ADMIN_PHONES bilan bir xil qiymat.
const ADMIN_E164 = "+998976063896";
const ADMIN_DIGITS = "998976063896";
const ADMIN_9DIGIT = "976063896"; // mamlakat kodisiz milliy shakl

let updateSeq = Date.now() * 1000;
function nextUpdateId(): number {
  return ++updateSeq;
}

type Caught = { url: string; body: Record<string, unknown> };
let calls: Caught[] = [];
const realFetch = globalThis.fetch;

function installFetchMock(): void {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    } as Response;
  }) as typeof fetch;
}

const createdIds: string[] = [];
function trackId(id: string): string {
  createdIds.push(id);
  return id;
}

test.after(async () => {
  globalThis.fetch = realFetch;
  if (createdIds.length) {
    // `users` o'chirilsa `transactions` CASCADE bilan ketadi (001_init.sql).
    await query("DELETE FROM users WHERE telegram_id = ANY($1)", [createdIds]);
  }
});

/** Foydalanuvchi avval saytga «Telegram orqali kirish» orqali bir marta kirgan — haqiqiy yo'l. */
async function makeUser(telegramId: string): Promise<void> {
  await upsertTelegramUser({ telegramId, username: null, name: "Sinov", photoUrl: null });
}

async function userPhone(telegramId: string): Promise<string | null> {
  const rows = await query<{ phone: string | null }>(
    "SELECT phone FROM users WHERE telegram_id = $1",
    [telegramId],
  );
  return rows[0]?.phone ?? null;
}

/**
 * `users.phone` UNIQUE — ikkita test bir xil admin raqamini ketma-ket
 * o'ziga bog'lasa, ikkinchisi haqiqiy `users_phone_key` to'qnashuviga
 * uchraydi (bu TO'G'RI xatti-harakat, `handleContact` shu holatni ham
 * yutmasdan xabar qiladi). Har test o'z holatidan boshlansin uchun,
 * oldingi test qoldirgan bandni bo'shatamiz.
 */
async function freeAdminPhone(): Promise<void> {
  await query("UPDATE users SET phone = NULL WHERE phone = $1", [ADMIN_E164]);
}

test("user_id'siz kontakt (soxta vizit kartochkasi, admin raqamining 9 xonali shakli) — rad etiladi, saqlanmaydi, admin bo'lmaydi", async () => {
  installFetchMock();
  const fromId = 800000001;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId },
      from: { id: fromId, first_name: "Attacker" },
      contact: { phone_number: ADMIN_9DIGIT }, // user_id YO'Q — DEPS-08/SECA-01 hujumi
    },
  });

  assert.equal(await userPhone(telegramId), null, "telefon saqlanmasligi kerak");
  assert.equal(calls.length, 1, "rad etish xabari yuborilishi kerak");
  assert.match(String(calls[0]!.body.text), /Faqat o'zingizning raqamingizni ulashing/);
});

test("boshqa foydalanuvchining user_id bilan yuborilgan kontakt — rad etiladi", async () => {
  installFetchMock();
  const fromId = 800000002;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId },
      from: { id: fromId, first_name: "Attacker2" },
      contact: { phone_number: ADMIN_DIGITS, user_id: fromId + 1 },
    },
  });

  assert.equal(await userPhone(telegramId), null);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Faqat o'zingizning raqamingizni ulashing/);
});

test("forward qilingan xabar — user_id o'ziniki bo'lsa ham rad etiladi", async () => {
  installFetchMock();
  const fromId = 800000003;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId },
      from: { id: fromId, first_name: "Fwd" },
      contact: { phone_number: "998911112233", user_id: fromId },
      forward_date: 1_700_000_000,
    },
  });

  assert.equal(await userPhone(telegramId), null, "forward qilingan kontakt saqlanmasligi kerak");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Faqat o'zingizning raqamingizni ulashing/);
});

test("o'zining xalqaro shakldagi admin raqami — qabul qilinadi va admin bo'ladi", async () => {
  installFetchMock();
  await freeAdminPhone();
  const fromId = 800000004;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId },
      from: { id: fromId, first_name: "RealAdmin" },
      contact: { phone_number: ADMIN_DIGITS, user_id: fromId },
    },
  });

  const stored = await userPhone(telegramId);
  assert.equal(stored, ADMIN_E164, "kanonik E.164 shaklda saqlanishi kerak");
  assert.ok(isAdminPhone(stored), "haqiqiy admin raqami admin deb tanilishi kerak");
  assert.match(String(calls[0]!.body.text), /Admin sifatida tasdiqlandingiz/);
});

test("o'zining kontakti, lekin 9 xonali (mamlakat kodisiz) raqam yuborilsa — baribir kanonik shaklda saqlanadi va admin bo'ladi", async () => {
  // Ownership tekshiruvi to'g'ri (user_id === fromId), lekin raqamning
  // o'zi 9 xonali. Bu DEPS-08: xom saqlashda bunday qiymat unique
  // indeksdan qochib ketardi. Endi saqlash bosqichida ham kanonik
  // shaklga keltiriladi.
  installFetchMock();
  await freeAdminPhone();
  const fromId = 800000005;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId },
      from: { id: fromId, first_name: "NineDigit" },
      contact: { phone_number: ADMIN_9DIGIT, user_id: fromId },
    },
  });

  const stored = await userPhone(telegramId);
  assert.equal(stored, ADMIN_E164, "9 xonali kirish ham kanonik E.164 shaklda saqlanishi kerak");
  assert.ok(isAdminPhone(stored));
});

test("isAdminPhone admin raqamining 9 xonali (mamlakat kodisiz) shaklini rad etadi", () => {
  assert.equal(isAdminPhone(`+${ADMIN_9DIGIT}`), false);
  assert.equal(isAdminPhone(ADMIN_9DIGIT), false);
});
