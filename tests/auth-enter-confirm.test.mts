import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { inRouteRequest } from "./helpers/next-route-request.mts";

/**
 * SECA-05: botdan boshlangan kirish havolasi orqali login-CSRF.
 *
 * Tajovuzkor botga `/login` yozib, O'Z akkauntiga bog'langan
 * `…/enter?t=<token>` havolasini oladi va qurbonga yuboradi. Ilgari GET
 * darhol sessiya ochardi — qurbon tajovuzkor akkauntida qolar va
 * yuklagan ma'lumotlari (rezyume, surat, to'lov) tajovuzkorga tushardi.
 *
 * Endi: GET faqat tasdiqlash sahifasini ko'rsatadi («Siz <ism> sifatida
 * kirmoqdasiz», token SARFLANMAYDI, cookie YO'Q), sessiya faqat shu
 * sahifadan yuborilgan POST (Origin tekshiruvi) bilan ochiladi. Brauzerda
 * BOSHQA akkaunt ochiq bo'lsa — ogohlantirish.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token-never-called";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { upsertTelegramUser } = await import("../lib/server/auth.ts");
const { createBotLoginLink } = await import("../lib/server/telegram.ts");
const route = await import("../app/api/auth/telegram/enter/route.ts");

const tgIds: string[] = [];
test.after(async () => {
  if (!hasDb) return;
  if (tgIds.length) {
    await query("DELETE FROM users WHERE telegram_id = ANY($1)", [tgIds]);
    await query("DELETE FROM login_tickets WHERE telegram_id = ANY($1)", [tgIds]);
  }
  await pool().end();
});

function freshTg(): string {
  const id = String(8_200_000_000 + randomInt(0, 700_000_000));
  tgIds.push(id);
  return id;
}

function ip(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

/** Tajovuzkorning (yoki egasining) bot havolasidagi token. */
async function botToken(name: string, username: string | null = null): Promise<{ token: string; telegramId: string }> {
  const telegramId = freshTg();
  const link = await createBotLoginLink({ telegramId, username, name, photoUrl: null });
  return { token: new URL(link).searchParams.get("t")!, telegramId };
}

async function consumed(telegramId: string): Promise<boolean> {
  const r = await query<{ consumed_at: Date | null }>("SELECT consumed_at FROM login_tickets WHERE telegram_id = $1", [telegramId]);
  assert.equal(r.length, 1);
  return r[0]!.consumed_at !== null;
}

async function sessionFor(telegramId: string, name: string): Promise<string> {
  const u = await upsertTelegramUser({ telegramId, username: null, name, photoUrl: null });
  const { token } = await createSession(u.id);
  return `${SESSION_COOKIE}=${token}`;
}

function get(token: string, cookie = "") {
  const req = new Request(`http://localhost:3000/api/auth/telegram/enter?t=${token}`, {
    headers: { "x-forwarded-for": ip(), "sec-fetch-site": "cross-site", ...(cookie ? { cookie } : {}) },
  });
  return inRouteRequest(req, () => route.GET(req));
}

function post(token: string, headers: Record<string, string>, cookie = "") {
  const req = new Request("http://localhost:3000/api/auth/telegram/enter", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ip(),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: new URLSearchParams({ t: token }).toString(),
  });
  assert.equal(typeof route.POST, "function", "MUTATSIYA: tasdiqlash POST yo'q");
  return inRouteRequest(req, () => route.POST(req));
}

const SAME = { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" };

test("GET havola: tasdiqlash sahifasi — ism ko'rinadi, token sarflanmaydi, sessiya OCHILMAYDI", { skip }, async () => {
  await ensureMigrated();
  const { token, telegramId } = await botToken("Ali <b>Valiyev</b>", "ali_v");
  const { result, setCookies } = await get(token);
  assert.equal(result.status, 200, "MUTATSIYA: GET o'zi kirib yubordi (login-CSRF)");
  assert.match(result.headers.get("content-type") ?? "", /text\/html/);
  const html = await result.text();
  assert.match(html, /Siz <b>Ali &lt;b&gt;Valiyev&lt;\/b&gt;<\/b> \(@ali_v\) sifatida kirmoqdasiz/, "ism HTML-ekranlangan holda ko'rsatiladi");
  assert.match(html, /<form method="post" action="\/api\/auth\/telegram\/enter">/);
  assert.ok(html.includes(`name="t" value="${token}"`), "token formada");
  assert.equal(await consumed(telegramId), false, "GET token'ni sarflamaydi");
  assert.ok(!setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`)), "GET sessiya cookie bermaydi");
  assert.match(result.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(result.headers.get("referrer-policy"), "no-referrer");
});

test("GET: brauzerda BOSHQA akkaunt ochiq — ogohlantirish", { skip }, async () => {
  const victimCookie = await sessionFor(freshTg(), "Qurbon Egasi");
  const { token } = await botToken("Tajovuzkor");
  const { result } = await get(token, victimCookie);
  assert.equal(result.status, 200);
  const html = await result.text();
  assert.match(html, /Qurbon Egasi/, "ochiq akkaunt nomi ko'rsatiladi");
  assert.match(html, /boshqa akkaunt/i, "MUTATSIYA: ogohlantirish yo'q");
});

test("GET: brauzerda AYNAN shu akkaunt ochiq — darhol saytga, token sarflanmaydi", { skip }, async () => {
  const { token, telegramId } = await botToken("O'zim");
  const cookie = await sessionFor(telegramId, "O'zim");
  const { result } = await get(token, cookie);
  assert.equal(result.status, 303);
  assert.equal(new URL(result.headers.get("location")!).pathname, "/uz");
  assert.equal(await consumed(telegramId), false);
});

test("POST boshqa saytdan (Origin begona / Sec-Fetch-Site cross-site) — 403, token butun", { skip }, async () => {
  const { token, telegramId } = await botToken("Tajovuzkor");
  const a = await post(token, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
  assert.equal(a.result.status, 403, "MUTATSIYA: POST Origin tekshiruvisiz");
  const b = await post(token, { "sec-fetch-site": "cross-site" });
  assert.equal(b.result.status, 403);
  assert.equal(await consumed(telegramId), false);
  assert.ok(![...a.setCookies, ...b.setCookies].some((c) => c.startsWith(`${SESSION_COOKIE}=`)));
});

test("POST o'z sahifamizdan — sessiya ochiladi, eski boshqa sessiya bekor, token bir martalik", { skip }, async () => {
  const oldCookie = await sessionFor(freshTg(), "Eski Akkaunt");
  const { token, telegramId } = await botToken("Yangi Kiruvchi");
  const { result, setCookies } = await post(token, SAME, oldCookie);
  assert.equal(result.status, 303);
  assert.equal(new URL(result.headers.get("location")!).pathname, "/uz");
  const sess = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`));
  assert.ok(sess, `sessiya cookie yo'q: ${setCookies.join(" | ")}`);
  assert.equal(await consumed(telegramId), true);

  // Yangi sessiya aynan chipta egasiniki.
  const { createHash } = await import("node:crypto");
  const raw = sess!.split(";")[0]!.split("=")[1]!;
  const owner = await query<{ telegram_id: string }>(
    "SELECT u.telegram_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
    [createHash("sha256").update(raw).digest("hex")],
  );
  assert.equal(owner[0]?.telegram_id, telegramId);
  // Akkaunt almashdi — eski sessiya bazada ham yopiladi.
  const oldRaw = oldCookie.split("=")[1]!;
  const old = await query<{ revoked_at: Date | null }>("SELECT revoked_at FROM sessions WHERE token_hash = $1", [
    createHash("sha256").update(oldRaw).digest("hex"),
  ]);
  assert.ok(old[0]?.revoked_at, "eski sessiya bekor qilinishi kerak");

  const again = await post(token, SAME);
  assert.equal(again.result.status, 303);
  assert.match(decodeURIComponent(new URL(again.result.headers.get("location")!).searchParams.get("xato") ?? ""), /eskirgan/);
});

test("GET yaroqsiz token — login sahifasiga xato bilan (avvalgidek)", { skip }, async () => {
  const { result } = await get(randomBytes(32).toString("base64url"));
  assert.equal(result.status, 303);
  assert.match(decodeURIComponent(new URL(result.headers.get("location")!).searchParams.get("xato") ?? ""), /eskirgan|yaroqsiz/);
});
