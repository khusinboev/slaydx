import test from "node:test";
import assert from "node:assert/strict";

/**
 * C01 (SECA-01 / DEPS-08 / ABUSE-06 / TEST-12) — soxta Telegram kontakt
 * orqali admin bo'lib olish.
 *
 * Ilgari `handleContact` uchta teshik bilan yozilgan edi:
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
 *   3. (R1, ko'rib chiquvchi topdi) Birinchi tuzatishda bu ikkinchi
 *      teshikni "saqlashda ham 9 xonalini 998 bilan kengaytirish" bilan
 *      yopishga urinildi — lekin bu YANGI xato edi: (a) o'ZINING
 *      to'g'ri kontaktini ulashgan foydalanuvchi uchun ham xuddi shu
 *      kengaytirish ishlab, admin raqamiga TASODIFAN to'g'ri kelib
 *      qolishi mumkin edi; (b) haqiqiy qisqa xalqaro raqamlarni
 *      (+299/+298/+376 kabi) buzardi. To'g'ri yechim: hech qanday
 *      mamlakat-kodi TAXMINI yo'q — Telegram YUBORGANDEK xom saqlash,
 *      faqat uzunlik (7–15 raqam, E.164 diapazoni) tekshiriladi.
 *
 * Nit: kontakt faqat SHAXSIY chatda (`chat.type === "private"`)
 * qabul qilinadi.
 *
 * Bu fayl barchasini qulflaydi. Haqiqiy Postgres talab qiladi
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
      chat: { id: fromId, type: "private" },
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
      chat: { id: fromId, type: "private" },
      from: { id: fromId, first_name: "Attacker2" },
      contact: { phone_number: ADMIN_DIGITS, user_id: fromId + 1 },
    },
  });

  assert.equal(await userPhone(telegramId), null);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Faqat o'zingizning raqamingizni ulashing/);
});

test("forward qilingan xabar (forward_date) — user_id o'ziniki bo'lsa ham rad etiladi", async () => {
  installFetchMock();
  const fromId = 800000003;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId, type: "private" },
      from: { id: fromId, first_name: "Fwd" },
      contact: { phone_number: "998911112233", user_id: fromId },
      forward_date: 1_700_000_000,
    },
  });

  assert.equal(await userPhone(telegramId), null, "forward qilingan kontakt saqlanmasligi kerak");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Faqat o'zingizning raqamingizni ulashing/);
});

test("forward qilingan xabar (forward_origin) — user_id o'ziniki bo'lsa ham rad etiladi", async () => {
  // Zamonaviy Bot API `forward_date`/`forward_from` o'rniga `forward_origin`
  // obyektini beradi — shuni alohida tekshiramiz, ikkalasi bir xil bo'lib
  // qolmasin.
  installFetchMock();
  const fromId = 800000006;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId, type: "private" },
      from: { id: fromId, first_name: "FwdOrigin" },
      contact: { phone_number: "998911112244", user_id: fromId },
      forward_origin: { type: "user", sender_user: { id: fromId } },
    },
  });

  assert.equal(await userPhone(telegramId), null, "forward_origin bilan kelgan kontakt saqlanmasligi kerak");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Faqat o'zingizning raqamingizni ulashing/);
});

test("guruh chatida ulashilgan kontakt — rad etiladi (faqat shaxsiy chat qabul qilinadi)", async () => {
  installFetchMock();
  const fromId = 800000007;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId, type: "group" },
      from: { id: fromId, first_name: "GroupUser" },
      contact: { phone_number: ADMIN_DIGITS, user_id: fromId },
    },
  });

  assert.equal(await userPhone(telegramId), null, "guruh chatidagi kontakt saqlanmasligi kerak");
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
      chat: { id: fromId, type: "private" },
      from: { id: fromId, first_name: "RealAdmin" },
      contact: { phone_number: ADMIN_DIGITS, user_id: fromId },
    },
  });

  const stored = await userPhone(telegramId);
  assert.equal(stored, ADMIN_E164, "Telegram yuborgan to'liq raqam xom holda saqlanadi");
  assert.ok(isAdminPhone(stored), "haqiqiy admin raqami admin deb tanilishi kerak");
  assert.match(String(calls[0]!.body.text), /Admin sifatida tasdiqlandingiz/);
});

test("R1: o'zining kontakti, lekin 9 xonali (mamlakat kodisiz) raqam — XOM saqlanadi, admin BO'LMAYDI", async () => {
  // Ownership tekshiruvi to'g'ri (user_id === fromId) — bu HAQIQIY
  // foydalanuvchi, lekin uning raqami (yoki xato/qisqa xalqaro raqam)
  // 9 ta xonadan iborat, tasodifan admin raqamining "milliy" shakli
  // bilan bir xil ko'rinadi. Mamlakat-kodi TAXMIN qilinmasligi kerak —
  // shu qiymat qanday kelgan bo'lsa, xuddi shunday (`+976063896`)
  // saqlanadi va admin raqamiga (`+998976063896`, 12 xona) MOS
  // KELMAYDI. Buni ko'rib chiquvchi R1 sifatida talab qildi: birinchi
  // versiyada bu yerda saqlashda ham 998 bilan kengaytirish bo'lgani
  // uchun test ADMIN kutgan edi — bu ham SECA-01/DEPS-08ning davomi
  // ekan (haqiqiy egasi ham tasodifan admin bo'lib qolishi mumkin edi).
  installFetchMock();
  await freeAdminPhone();
  const fromId = 800000005;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId, type: "private" },
      from: { id: fromId, first_name: "NineDigit" },
      contact: { phone_number: ADMIN_9DIGIT, user_id: fromId },
    },
  });

  const stored = await userPhone(telegramId);
  assert.equal(stored, `+${ADMIN_9DIGIT}`, "hech qanday mamlakat-kodi taxmini bo'lmasligi kerak");
  assert.notEqual(stored, ADMIN_E164);
  assert.equal(isAdminPhone(stored), false, "9 xonali qiymat admin bilan MOS KELMASLIGI kerak");
});

test("uzunligi shubhali raqam (7 xonadan kam) — rad etiladi, saqlanmaydi", async () => {
  installFetchMock();
  const fromId = 800000008;
  const telegramId = trackId(String(fromId));
  await makeUser(telegramId);

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId, type: "private" },
      from: { id: fromId, first_name: "Short" },
      contact: { phone_number: "12345", user_id: fromId },
    },
  });

  assert.equal(await userPhone(telegramId), null, "E.164 dan tashqari uzunlik saqlanmasligi kerak");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Faqat o'zingizning raqamingizni ulashing/);
});

test("isAdminPhone admin raqamining 9 xonali (mamlakat kodisiz) shaklini rad etadi", () => {
  assert.equal(isAdminPhone(`+${ADMIN_9DIGIT}`), false);
  assert.equal(isAdminPhone(ADMIN_9DIGIT), false);
});
