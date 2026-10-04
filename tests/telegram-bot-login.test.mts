import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Botdan boshlangan bir martalik kirish havolasi (`createBotLoginLink`,
 * `handleUpdate` dagi nonce'siz `/start` va `/login`).
 *
 * `tests/telegram-link.test.mts` — saytdan boshlangan oqim (`createTicket`
 * + `attachTicket`) uchun; bu fayl BOTDAN boshlangan oqim va `handleUpdate`
 * marshrutizatsiyasi uchun. Haqiqiy Postgres talab qiladi.
 *
 * `env.appUrl` va `env.telegramBotToken` modul YUKLANGANDA bir marta
 * o'qiladi (`lib/server/env.ts` — `export const env = { appUrl: str(...) }`),
 * shuning uchun `process.env.APP_URL`/`TELEGRAM_BOT_TOKEN` FAQAT shu faylning
 * birinchi importidan oldin o'rnatiladi va butun fayl davomida o'zgarmaydi.
 * `APP_URL=https://slaydx.test` (https) tanlandi — shunda `loginButton`
 * tugma qo'yadi. Lokal (`http://localhost`) holat shu sababli JONLI
 * sinalmaydi — pastda alohida testda `loginButton` manbasi skanerlanib
 * qulflanadi.
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.DATABASE_URL ??= "postgres://sodda:sodda@localhost:55432/sodda";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-fake-1234567890";

const { ensureMigrated } = await import("../lib/server/db.ts");
await ensureMigrated();

const { createBotLoginLink, handleUpdate, createTicket, redeemLoginToken } = await import(
  "../lib/server/telegram.ts"
);
const { query } = await import("../lib/server/db.ts");
const { upsertTelegramUser, SIGNUP_BONUS_POINTS } = await import("../lib/server/auth.ts");

function extractToken(link: string): string {
  return new URL(link).searchParams.get("t") ?? "";
}

/** Har chaqiruvda noyob, BIGINT ga sig'adigan `update_id`. */
let updateSeq = Date.now() * 1000;
function nextUpdateId(): number {
  return ++updateSeq;
}

type Caught = { url: string; body: Record<string, unknown> };

/**
 * `sendMessage` payload'idagi birinchi `url` tugmasi (bo'lsa). `/start` va
 * `/login` endi avval `web_app` tugmasini qo'yadi (uning `url` maydoni yo'q),
 * shuning uchun sayt havolasi qatorlar bo'ylab qidiriladi; aniq klaviatura
 * shakli `tests/telegram-webapp-buttons.test.mts` da qulflangan.
 */
function buttonUrl(body: Record<string, unknown>): string | undefined {
  const markup = body.reply_markup as { inline_keyboard?: { url?: string }[][] } | undefined;
  return markup?.inline_keyboard?.flat().find((b) => typeof b.url === "string")?.url;
}

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

const createdTelegramIds: string[] = [];
function trackId(id: string): string {
  createdTelegramIds.push(id);
  return id;
}

test.after(async () => {
  globalThis.fetch = realFetch;
  if (createdTelegramIds.length) {
    // `users` o'chirilsa `transactions` CASCADE bilan ketadi (001_init.sql).
    await query("DELETE FROM users WHERE telegram_id = ANY($1)", [createdTelegramIds]);
    await query("DELETE FROM login_tickets WHERE telegram_id = ANY($1)", [createdTelegramIds]);
  }
});

test("createBotLoginLink — havola https bilan, token uzun, chipta qatori to'g'ri", async () => {
  const telegramId = trackId("700000001");
  const link = await createBotLoginLink({
    telegramId,
    username: "u1",
    name: "Foydalanuvchi Bir",
    photoUrl: null,
  });

  assert.match(link, /^https:\/\/slaydx\.test\/api\/auth\/telegram\/enter\?t=/);
  const token = extractToken(link);
  assert.ok(token.length >= 32, "token yetarlicha uzun bo'lishi kerak");

  const rows = await query<{
    telegram_id: string;
    consumed_at: string | null;
    token_hash: string | null;
  }>(
    "SELECT telegram_id, consumed_at, token_hash FROM login_tickets WHERE telegram_id = $1",
    [telegramId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.telegram_id, telegramId);
  assert.equal(rows[0]!.consumed_at, null);
  assert.ok(rows[0]!.token_hash, "token_hash yozilgan bo'lishi kerak");
  assert.notEqual(rows[0]!.token_hash, token, "xom token bazada saqlanmasligi kerak");
});

test("createBotLoginLink token BIR MARTA ishlaydi — ikkinchisi 'expired'", async () => {
  const telegramId = trackId("700000002");
  const link = await createBotLoginLink({
    telegramId,
    username: null,
    name: "Ikkinchi",
    photoUrl: null,
  });
  const token = extractToken(link);

  const first = await redeemLoginToken(token);
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.user.telegramId, telegramId);

  const second = await redeemLoginToken(token);
  assert.deepEqual(second, { ok: false, reason: "expired" });
});

test("handleUpdate: nonce'siz /start — sendMessage 'Saytda ochish' tugmasi bilan, havola ishlaydi", async () => {
  installFetchMock();
  const fromId = 700000101;
  const telegramId = trackId(String(fromId));

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId },
      text: "/start",
      from: { id: fromId, username: "start_user", first_name: "Start" },
    },
  });

  assert.equal(calls.length, 1, "sendMessage aynan bir marta chaqirilishi kerak");
  const body = calls[0]!.body;
  assert.equal(body.chat_id, fromId);
  const btnUrl = buttonUrl(body);
  assert.ok(btnUrl, "tugma URL bo'lishi kerak");
  assert.match(btnUrl!, /^https:\/\/slaydx\.test\/api\/auth\/telegram\/enter\?t=/);

  const result = await redeemLoginToken(extractToken(btnUrl!));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.telegramId, telegramId);
});

test("handleUpdate: /login — xuddi shunday havola, lekin har safar YANGI token", async () => {
  installFetchMock();
  const fromId = 700000102;
  trackId(String(fromId));
  const base = { chat: { id: fromId }, from: { id: fromId, username: "login_user", first_name: "Login" } };

  await handleUpdate({ update_id: nextUpdateId(), message: { ...base, text: "/login" } });
  const url1 = buttonUrl(calls[0]!.body)!;

  await handleUpdate({ update_id: nextUpdateId(), message: { ...base, text: "/login" } });
  assert.equal(calls.length, 2);
  const url2 = buttonUrl(calls[1]!.body)!;

  assert.notEqual(extractToken(url1), extractToken(url2), "har /login yangi token berishi kerak");
});

test("handleUpdate: /start <nonce> — eski yo'l (attachTicket) regressiyasiz ishlaydi", async () => {
  installFetchMock();
  const ticket = await createTicket("SlaydXBot");
  const fromId = 700000103;
  const telegramId = trackId(String(fromId));

  await handleUpdate({
    update_id: nextUpdateId(),
    message: {
      chat: { id: fromId },
      text: `/start ${ticket.nonce}`,
      from: { id: fromId, username: "nonce_user", first_name: "Nonce" },
    },
  });

  assert.equal(calls.length, 1);
  const url = buttonUrl(calls[0]!.body)!;
  const result = await redeemLoginToken(extractToken(url));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.telegramId, telegramId);

  // Havola aynan SHU nonce'ga bog'langan chiptadan chiqqanini tasdiqlaymiz.
  const rows = await query<{ nonce: string }>(
    "SELECT nonce FROM login_tickets WHERE nonce = $1 AND consumed_at IS NOT NULL",
    [ticket.nonce],
  );
  assert.equal(rows.length, 1);
});

test("handleUpdate: boshqa matn — kirish havolasi YO'Q, /login eslatiladi", async () => {
  installFetchMock();
  const fromId = 700000104;
  trackId(String(fromId));

  await handleUpdate({
    update_id: nextUpdateId(),
    message: { chat: { id: fromId }, text: "salom", from: { id: fromId, first_name: "Salom" } },
  });

  assert.equal(calls.length, 1);
  const body = calls[0]!.body;
  assert.ok(!body.reply_markup, "reply_markup bo'lmasligi kerak");
  assert.match(String(body.text), /\/login/);
});

test("handleUpdate: takroriy update_id — ikkinchi marta hech narsa yubormaydi", async () => {
  installFetchMock();
  const fromId = 700000105;
  trackId(String(fromId));
  const id = nextUpdateId();
  const update = {
    update_id: id,
    message: { chat: { id: fromId }, text: "/login", from: { id: fromId, first_name: "Dup" } },
  };

  await handleUpdate(update);
  assert.equal(calls.length, 1);

  await handleUpdate(update);
  assert.equal(calls.length, 1, "takroriy update_id qayta sendMessage chaqirmasligi kerak");
});

test("eskirgan chipta — redeemLoginToken rad etadi", async () => {
  const telegramId = trackId("700000106");
  const link = await createBotLoginLink({
    telegramId,
    username: null,
    name: "Eski",
    photoUrl: null,
  });
  const token = extractToken(link);

  await query(
    "UPDATE login_tickets SET expires_at = now() - interval '1 minute' WHERE telegram_id = $1",
    [telegramId],
  );

  const result = await redeemLoginToken(token);
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("loginButton — lokal manzil holati manba skani bilan qulflangan", async () => {
  // `env.appUrl` bu faylda `https://slaydx.test` ga muzlatilgan (modul
  // yuklanishida o'qiladi), shuning uchun `http://localhost` shoxini
  // jonli chaqirib bo'lmaydi. Mantiqni manba matnidan tekshiramiz: lokal
  // manzilda tugma YO'Q (reply_markup bo'sh) — `sendLoginLink` shunda
  // havolani matnga qo'shadi.
  const src = await readFile(
    new URL("../lib/server/telegram.ts", import.meta.url),
    "utf8",
  );
  const fnMatch = src.match(/function loginButton\([\s\S]*?\n\}/);
  assert.ok(fnMatch, "loginButton funksiyasi topilishi kerak");
  const fn = fnMatch![0];
  assert.ok(
    fn.includes("localhost") && fn.includes("127\\.0\\.0\\.1") && fn.includes("0\\.0\\.0\\.0"),
    "lokal manzilni aniqlaydigan mantiq saqlanishi kerak",
  );
  assert.match(fn, /if \(!isPublic\) return \{\};/, "lokal bo'lsa tugma qaytarilmasligi kerak");

  const sendMatch = src.match(/async function sendLoginLink\([\s\S]*?\n\}/);
  assert.ok(sendMatch, "sendLoginLink funksiyasi topilishi kerak");
  assert.ok(
    sendMatch![0].includes('"reply_markup" in btn ? intro : `${intro}') &&
      sendMatch![0].includes("${link}`"),
    "tugma bo'lmasa havola matnga qo'shilishi kodda qulflangan bo'lishi kerak",
  );
});

/*
 * Botga /start bosgan odam saytga kirmasa ham bazaga yoziladi — admin panel
 * uni ko'radi va ball bera oladi. Bonus bir marta, mavjud surat saqlanadi,
 * guruh chati va botlar yozilmaydi.
 */

type UserRow = { id: string; points: string; name: string; username: string | null; photo_url: string | null };

async function userByTelegramId(telegramId: string): Promise<UserRow | undefined> {
  const rows = await query<UserRow>(
    "SELECT id, points::text AS points, name, username, photo_url FROM users WHERE telegram_id = $1",
    [telegramId],
  );
  return rows[0];
}

async function signupBonusCount(userId: string): Promise<number> {
  const rows = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM transactions WHERE user_id = $1 AND reference = $2",
    [userId, `signup:${userId}`],
  );
  return Number(rows[0]!.n);
}

test("handleUpdate: /start — saytga kirmagan foydalanuvchi bazaga yoziladi, bonus BIR MARTA, keyingi kirish o'sha akkauntga", async () => {
  installFetchMock();
  const fromId = 700000201;
  const telegramId = trackId(String(fromId));
  const message = {
    chat: { id: fromId, type: "private" },
    text: "/start",
    from: { id: fromId, username: "bot_only", first_name: "Bot", last_name: "Only" },
  };

  await handleUpdate({ update_id: nextUpdateId(), message });
  const user = await userByTelegramId(telegramId);
  assert.ok(user, "/start dan keyin users qatori bo'lishi kerak");
  assert.equal(user.name, "Bot Only");
  assert.equal(user.username, "bot_only");
  assert.equal(Number(user.points), SIGNUP_BONUS_POINTS);
  assert.equal(await signupBonusCount(user.id), 1);

  await handleUpdate({ update_id: nextUpdateId(), message });
  const again = await userByTelegramId(telegramId);
  assert.equal(again!.id, user.id);
  assert.equal(Number(again!.points), SIGNUP_BONUS_POINTS, "ikkinchi /start bonus bermaydi");
  assert.equal(await signupBonusCount(user.id), 1);

  const result = await redeemLoginToken(extractToken(buttonUrl(calls[1]!.body)!));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.user.id, user.id, "saytga kirish o'sha akkauntni ochadi");
  assert.equal(await signupBonusCount(user.id), 1, "saytga kirish ham bonusni takrorlamaydi");
});

test("handleUpdate: istalgan shaxsiy xabar (/login, oddiy matn) ham foydalanuvchini yozadi", async () => {
  installFetchMock();
  for (const [fromId, text] of [[700000202, "/login"], [700000203, "salom"]] as const) {
    const telegramId = trackId(String(fromId));
    await handleUpdate({
      update_id: nextUpdateId(),
      message: { chat: { id: fromId, type: "private" }, text, from: { id: fromId, first_name: "Matn" } },
    });
    assert.ok(await userByTelegramId(telegramId), `${text} dan keyin users qatori bo'lishi kerak`);
  }
});

test("handleUpdate: /start mavjud akkauntning suratini o'chirmaydi, ism/username yangilanadi", async () => {
  installFetchMock();
  const fromId = 700000204;
  const telegramId = trackId(String(fromId));
  await upsertTelegramUser({ telegramId, username: "old_name", name: "Eski", photoUrl: "https://t.me/i/userpic/a.jpg" });

  await handleUpdate({
    update_id: nextUpdateId(),
    message: { chat: { id: fromId, type: "private" }, text: "/start", from: { id: fromId, username: "new_name", first_name: "Yangi" } },
  });

  const user = await userByTelegramId(telegramId);
  assert.equal(user!.photo_url, "https://t.me/i/userpic/a.jpg");
  assert.equal(user!.name, "Yangi");
  assert.equal(user!.username, "new_name");
  assert.equal(await signupBonusCount(user!.id), 1);
});

test("handleUpdate: guruh chati va bot jo'natuvchi bazaga YOZILMAYDI", async () => {
  installFetchMock();
  const groupFrom = 700000205;
  trackId(String(groupFrom));
  await handleUpdate({
    update_id: nextUpdateId(),
    message: { chat: { id: -100700000205, type: "group" }, text: "/start", from: { id: groupFrom, first_name: "Guruh" } },
  });
  assert.equal(await userByTelegramId(String(groupFrom)), undefined);

  const botFrom = 700000206;
  trackId(String(botFrom));
  await handleUpdate({
    update_id: nextUpdateId(),
    message: { chat: { id: botFrom, type: "private" }, text: "/start", from: { id: botFrom, is_bot: true, first_name: "Bot" } },
  });
  assert.equal(await userByTelegramId(String(botFrom)), undefined);
});
