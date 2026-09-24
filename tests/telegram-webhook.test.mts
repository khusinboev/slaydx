import test from "node:test";
import assert from "node:assert/strict";

/**
 * Telegram webhook — HAQIQIY route (`app/api/telegram/webhook/route.ts`)
 * va `handleUpdate`, Postgres bilan. Telegram'ga hech qanday tarmoq
 * chaqiruvi yo'q: `fetch` stub.
 *
 * EXT-14: webhook maxfiy kaliti endi `/api/health` bearer'i (`CRON_SECRET`)
 * bilan bir xil emas — alohida `TELEGRAM_WEBHOOK_SECRET`. U o'rnatilmagan
 * bo'lsa (egasi hali qo'ymagan prod), `CRON_SECRET` ga qaytiladi va
 * ishga tushishda OGOHLANTIRISH beriladi.
 *
 * BEA-17 / EXT-05: webhook ilgari «ko'pi bilan bir marta» edi — update id
 * ishlashdan OLDIN yozilar, har xato yutilib 200 qaytardi: Telegram 429/5xx
 * yoki tarmoq uzilishida kirish havolasi jimgina yo'qolardi. Endi id faqat
 * MUVAFFAQIYATLI ishlangandan keyin qoladi, vaqtinchalik xatoda 500
 * qaytadi (Telegram qayta yuboradi), takroriy yetkazish esa ikki marta
 * ishlanmaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-fake-1234567890";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.CRON_SECRET = "cron-secret-for-health-only-000000";
process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret-dedicated-11111111";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const envMod = await import("../lib/server/env.ts");
const { runtimeWarnings } = envMod;
// `env` — `as const` (faqat o'qish tipi); test kalitlarni vaqtincha almashtiradi.
const env = envMod.env as unknown as { telegramWebhookSecret: string; cronSecret: string };
const { query, pool } = await import("../lib/server/db.ts");
const telegram = await import("../lib/server/telegram.ts");
const { POST } = await import("../app/api/telegram/webhook/route.ts");

/* ───────────── fetch stub: Telegram javoblari navbati ───────────── */

type Reply = "ok" | "throw" | { status: number; body: unknown };
let replies: Reply[] = [];
let sent: Record<string, unknown>[] = [];
const realFetch = globalThis.fetch;

function stubTelegram(...queue: Reply[]): void {
  replies = queue;
  sent = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, "faqat Telegram API stub qilingan");
    const r = replies.length ? replies.shift()! : "ok";
    if (r === "throw") throw new TypeError("fetch failed");
    if (r === "ok") {
      sent.push(init?.body ? JSON.parse(String(init.body)) : {});
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
}

const TG_5XX: Reply = { status: 502, body: { ok: false, error_code: 502, description: "Bad Gateway" } };
const TG_429: Reply = { status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 0", parameters: { retry_after: 0 } } };
const TG_403: Reply = { status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } };

let seq = Date.now() * 1000 + 500_000;
const fromIds: number[] = [];
function loginUpdate(): { update_id: number; message: Record<string, unknown> } {
  const fromId = 710_000_000 + Math.floor(Math.random() * 1_000_000);
  fromIds.push(fromId);
  return { update_id: ++seq, message: { chat: { id: fromId, type: "private" }, from: { id: fromId, first_name: "Veb" }, text: "/login" } };
}

async function recorded(updateId: number): Promise<boolean> {
  return (await query("SELECT 1 FROM telegram_updates WHERE update_id = $1", [updateId])).length > 0;
}

function hook(body: unknown, secret: string | null = env.telegramWebhookSecret): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return POST(new Request("https://slaydx.test/api/telegram/webhook", { method: "POST", headers, body: JSON.stringify(body) }));
}

test.after(async () => {
  globalThis.fetch = realFetch;
  if (!hasDb) return;
  if (fromIds.length) await query("DELETE FROM login_tickets WHERE telegram_id = ANY($1)", [fromIds.map(String)]);
  await pool().end();
});

/* ───────────────────────────── EXT-14 ───────────────────────────── */

test("EXT-14: alohida webhook kaliti qabul qilinadi, CRON_SECRET esa RAD etiladi", { skip }, async () => {
  stubTelegram("ok");
  assert.equal((await hook(loginUpdate())).status, 200);
  assert.equal(sent.length, 1);

  stubTelegram();
  const withCron = await hook(loginUpdate(), process.env.CRON_SECRET!);
  assert.equal(withCron.status, 401, "MUTATSIYA: health bearer'i hali ham webhook kaliti");
  assert.equal((await hook(loginUpdate(), null)).status, 401);
  assert.equal(sent.length, 0);
});

test("EXT-14: TELEGRAM_WEBHOOK_SECRET bo'lmasa CRON_SECRET ga qaytiladi va ogohlantiriladi", { skip }, async (t) => {
  const saved = env.telegramWebhookSecret;
  t.after(() => {
    env.telegramWebhookSecret = saved;
  });
  assert.ok(!runtimeWarnings().some((w) => /TELEGRAM_WEBHOOK_SECRET/.test(w)), "kalit bor — ogohlantirish yo'q");

  env.telegramWebhookSecret = "";
  assert.ok(
    runtimeWarnings().some((w) => /TELEGRAM_WEBHOOK_SECRET/.test(w) && /CRON_SECRET/.test(w)),
    "MUTATSIYA: zaxira kalit haqida ogohlantirish yo'q",
  );
  stubTelegram("ok");
  assert.equal((await hook(loginUpdate(), process.env.CRON_SECRET!)).status, 200, "zaxira: CRON_SECRET bilan ishlaydi (prod buzilmasin)");
  assert.equal(sent.length, 1);
});

test("EXT-14: ikkala kalit ham yo'q — 503 (webhook o'chiq)", { skip }, async (t) => {
  const saved = { w: env.telegramWebhookSecret, c: env.cronSecret };
  t.after(() => {
    env.telegramWebhookSecret = saved.w;
    env.cronSecret = saved.c;
  });
  env.telegramWebhookSecret = "";
  env.cronSecret = "";
  assert.equal((await hook(loginUpdate(), "anything")).status, 503);
});

/* ─────────────────────────── BEA-17 / EXT-05 ─────────────────────── */

test("BEA-17: Telegram 5xx — handleUpdate xato beradi, update BELGILANMAYDI; qayta yetkazish ishlanadi, uchinchisi yo'q", { skip }, async () => {
  const u = loginUpdate();
  stubTelegram(TG_5XX);
  await assert.rejects(telegram.handleUpdate(u as never), telegram.TelegramTransientError);
  assert.equal(await recorded(u.update_id), false, "MUTATSIYA: muvaffaqiyatsiz update 'ishlangan' deb qoldi");

  stubTelegram("ok");
  await telegram.handleUpdate(u as never);
  assert.equal(sent.length, 1, "qayta yetkazishda havola yuborildi");
  assert.equal(await recorded(u.update_id), true);

  await telegram.handleUpdate(u as never);
  assert.equal(sent.length, 1, "muvaffaqiyatdan keyin takror ishlanmaydi");
});

test("BEA-17: tarmoq xatosi va 429 (bitta qayta urinishdan keyin ham) — vaqtinchalik", { skip }, async () => {
  const a = loginUpdate();
  stubTelegram("throw");
  await assert.rejects(telegram.handleUpdate(a as never), telegram.TelegramTransientError);
  assert.equal(await recorded(a.update_id), false);

  const b = loginUpdate();
  stubTelegram(TG_429, TG_429);
  await assert.rejects(telegram.handleUpdate(b as never), telegram.TelegramTransientError);
  assert.equal(await recorded(b.update_id), false);

  // Bitta 429 dan keyin muvaffaqiyat — `call()` ning o'z qayta urinishi (EXT-05).
  const c = loginUpdate();
  stubTelegram(TG_429, "ok");
  await telegram.handleUpdate(c as never);
  assert.equal(sent.length, 1);
  assert.equal(await recorded(c.update_id), true);
});

test("BEA-17: doimiy xato (403 — bot bloklangan) qayta urinilmaydi: update ishlangan deb yoziladi", { skip }, async () => {
  const u = loginUpdate();
  stubTelegram(TG_403);
  await telegram.handleUpdate(u as never);
  assert.equal(await recorded(u.update_id), true);
});

test("BEA-17 route: vaqtinchalik xato → 500 (Telegram qayta yuboradi), qayta → 200 va BITTA xabar, takror → yangi xabar yo'q", { skip }, async () => {
  const u = loginUpdate();
  stubTelegram(TG_5XX);
  const first = await hook(u);
  assert.equal(first.status, 500, "MUTATSIYA: xato yutilib 200 qaytdi — Telegram qayta yubormaydi");

  stubTelegram("ok");
  assert.equal((await hook(u)).status, 200);
  assert.equal(sent.length, 1);
  assert.equal((await hook(u)).status, 200);
  assert.equal(sent.length, 1, "takroriy yetkazish ikki marta ishlanmadi");
});

test("BEA-17: bir xil update PARALLEL ikki marta kelsa — bitta xabar", { skip }, async () => {
  const u = loginUpdate();
  stubTelegram("ok", "ok");
  const res = await Promise.all([hook(u), hook(u)]);
  assert.deepEqual(res.map((r) => r.status), [200, 200]);
  assert.equal(sent.length, 1);
});

test("webhook: buzuq JSON yoki update_id siz tana — 200 (qayta yuborish foyda bermaydi)", { skip }, async () => {
  stubTelegram();
  const bad = await POST(
    new Request("https://slaydx.test/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": env.telegramWebhookSecret },
      body: "{not json",
    }),
  );
  assert.equal(bad.status, 200);
  assert.equal((await hook({ message: { text: "/login" } })).status, 200);
  assert.equal(sent.length, 0);
});

test("EXT-14: TELEGRAM_WEBHOOK_SECRET web konteyneriga uzatiladi va .env.example da hujjatlangan", async () => {
  const { readFileSync } = await import("node:fs");
  const yaml = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const web = yaml.slice(yaml.indexOf("\n  web:"), yaml.indexOf("\n  worker:"));
  assert.match(web, /\n\s+TELEGRAM_WEBHOOK_SECRET: \$\{TELEGRAM_WEBHOOK_SECRET:-\}/, "compose faqat sanab o'tilganini uzatadi");
  const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /^TELEGRAM_WEBHOOK_SECRET=$/m);
  assert.match(example, /secret_token=<TELEGRAM_WEBHOOK_SECRET>/, "setWebhook yo'riqnomasi yangi kalit bilan");
});
