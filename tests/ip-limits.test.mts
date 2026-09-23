import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

/**
 * NAT ortidagi foydalanuvchilar (C29: SCALE-10, BEA-15, ABUSE-05, SECA-03).
 *
 * O'zbek mobil tarmoqlari (CGNAT) va maktab Wi-Fi da yuzlab odam BITTA
 * ochiq IP dan chiqadi. Ilgari yagona kirish yo'lining birinchi qadami
 * (`ticket:new:${ip}`) 5 daqiqada 10 ta edi — 11-o'quvchi bloklanardi.
 *
 * Qoida: IP — faqat toshqin shipi (keng), qat'iy chegara esa SHAXS
 * bo'yicha (brauzer, identifikator, o'yin tokeni) va MUVAFFAQIYATSIZ
 * urinishlar bo'yicha (brute force). Testlar HAQIQIY route'larni va
 * haqiqiy `rate_limits` jadvalini (Postgres) ishlatadi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TRUST_PROXY = "true";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token-never-called";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.DEV_LOGIN_ENABLED = "1";
process.env.APP_URL = "http://localhost:3000";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { POST: TICKET } = await import("../app/api/auth/telegram/ticket/route.ts");
const { GET: ENTER } = await import("../app/api/auth/telegram/enter/route.ts");
const { POST: OTP } = await import("../app/api/auth/otp/route.ts");
const { POST: SUBMIT } = await import("../app/api/o/[token]/submit/route.ts");
const { IP_LIMITS } = await import("../lib/server/ip-limits.ts");

/** Har ishga tushirishda yangi IP — oldingi sinov oynasi aralashmasin. */
function freshIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : false;

test("ticket: bitta IP dan 100 ta turli brauzer 5 daqiqada kira oladi (NAT)", { skip }, async () => {
  const ip = freshIp();
  const statuses: number[] = [];
  for (let i = 0; i < 100; i++) {
    const res = await TICKET(
      new Request("http://localhost:3000/api/auth/telegram/ticket", {
        method: "POST",
        headers: { "x-forwarded-for": ip, origin: "http://localhost:3000", host: "localhost:3000" },
      }),
    );
    statuses.push(res.status);
  }
  const blocked = statuses.filter((s) => s !== 200).length;
  assert.equal(blocked, 0, `MUTATSIYA: NAT ortidagi ${blocked} ta foydalanuvchi bloklandi (${statuses.find((s) => s !== 200)})`);
  assert.ok(IP_LIMITS.ticketPerIp.count >= 300, "IP shipi NAT uchun keng bo'lishi kerak");
});

test("ticket: BITTA brauzer 5 daqiqada 10 tadan ortiq chipta ololmaydi", { skip }, async () => {
  const ip = freshIp();
  // Birinchi javob brauzer cookie'sini beradi — keyingilar shu bilan keladi.
  const first = await TICKET(
    new Request("http://localhost:3000/api/auth/telegram/ticket", {
      method: "POST",
      headers: { "x-forwarded-for": ip, origin: "http://localhost:3000", host: "localhost:3000" },
    }),
  );
  assert.equal(first.status, 200);
  const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^sx_lt=[A-Za-z0-9_-]{16,}$/, "brauzer kaliti cookie sifatida berilmadi");

  const statuses: number[] = [];
  for (let i = 0; i < IP_LIMITS.ticketPerBrowser.count; i++) {
    const res = await TICKET(
      new Request("http://localhost:3000/api/auth/telegram/ticket", {
        method: "POST",
        headers: { "x-forwarded-for": ip, origin: "http://localhost:3000", host: "localhost:3000", cookie },
      }),
    );
    statuses.push(res.status);
  }
  // 1 (birinchi) + 10 = 11-urinish rad etiladi.
  assert.equal(statuses.at(-1), 429, "MUTATSIYA: brauzer bo'yicha chegara yo'q");
  assert.equal(statuses.slice(0, -1).every((s) => s === 200), true);
});

test("enter: bitta IP dan faqat MUVAFFAQIYATSIZ urinishlar sanaladi (brute force)", { skip }, async () => {
  const ip = freshIp();
  const reasons: string[] = [];
  for (let i = 0; i <= IP_LIMITS.enterFailPerIp.count; i++) {
    const res = await ENTER(
      new Request(`http://localhost:3000/api/auth/telegram/enter?t=${randomBytes(32).toString("base64url")}`, {
        headers: { "x-forwarded-for": ip },
      }),
    );
    assert.equal(res.status, 303);
    reasons.push(decodeURIComponent(new URL(res.headers.get("location")!).searchParams.get("xato") ?? ""));
  }
  const tooMany = reasons.map((r, i) => (/Juda ko'p/.test(r) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(tooMany, [IP_LIMITS.enterFailPerIp.count], `faqat ${IP_LIMITS.enterFailPerIp.count + 1}-urinish bloklanishi kerak`);
  assert.ok(IP_LIMITS.enterFailPerIp.count >= 60, "MUTATSIYA: eski 30/IP chegarasi NAT ni bloklaydi");
});

async function otp(ip: string, action: "request" | "verify", body: Record<string, string>): Promise<Response> {
  return OTP(
    new Request(`http://localhost:3000/api/auth/otp${action === "verify" ? "?action=verify" : ""}`, {
      method: "POST",
      headers: { "x-forwarded-for": ip, origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("otp: bitta identifikatorga 10 dan ortiq tekshiruv — 429 (IP shipi kengaygan bo'lsa ham)", { skip }, async () => {
  const ip = freshIp();
  const identifier = `nat${randomBytes(4).toString("hex")}`;
  assert.equal((await otp(ip, "request", { identifier })).status, 200);
  const statuses: number[] = [];
  for (let i = 0; i <= IP_LIMITS.otpVerifyPerIdentifier.count; i++) {
    statuses.push((await otp(freshIp(), "verify", { identifier, code: "00000" })).status);
  }
  assert.equal(statuses.at(-1), 429, "MUTATSIYA: identifikator bo'yicha chegara yo'q");
  assert.ok(statuses.slice(0, -1).every((s) => s === 401));
});

test("otp: bitta IP dan turli identifikatorlarga 30 xato tekshiruvdan keyin — 429", { skip }, async () => {
  const ip = freshIp();
  const statuses: number[] = [];
  for (let i = 0; i <= IP_LIMITS.otpVerifyFailPerIp.count; i++) {
    statuses.push((await otp(ip, "verify", { identifier: `spray${randomBytes(4).toString("hex")}`, code: "12345" })).status);
  }
  assert.equal(statuses.at(-1), 429, "MUTATSIYA: IP bo'yicha xato urinishlar sanalmayapti");
  assert.ok(statuses.slice(0, -1).every((s) => s === 401));
});

test("o:submit: bitta sinf (IP) bir daqiqada 35+ natija yubora oladi, token bo'yicha shift bor", { skip }, async () => {
  const ip = freshIp();
  // Bazada yo'q token — chegaralardan o'tsa 404, bloklansa 429.
  const token = randomBytes(16).toString("base64url").slice(0, 22);
  const send = () =>
    SUBMIT(
      new Request(`http://localhost:3000/api/o/${token}/submit`, {
        method: "POST",
        headers: { "x-forwarded-for": ip, origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ name: "Ali", answers: {} }),
      }),
      { params: Promise.resolve({ token }) },
    );
  const statuses: number[] = [];
  for (let i = 0; i <= IP_LIMITS.submitPerGamePerIp.count; i++) statuses.push((await send()).status);
  const first429 = statuses.indexOf(429);
  assert.ok(first429 === -1 || first429 >= 35, `MUTATSIYA: sinf ${first429 + 1}-natijada bloklandi`);
  assert.equal(statuses.at(-1), 429, "o'yin tokeni + IP bo'yicha shift yo'q");
});

test("tg (widget/Mini App): imzosi buzuq so'rovlar IP bo'yicha sanaladi — 31-si 429", { skip }, async () => {
  const { POST: TG } = await import("../app/api/auth/telegram/route.ts");
  const ip = freshIp();
  const statuses: number[] = [];
  for (let i = 0; i <= IP_LIMITS.tgBadPerIp.count; i++) {
    const res = await TG(
      new Request("http://localhost:3000/api/auth/telegram", {
        method: "POST",
        headers: { "x-forwarded-for": ip, origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ initData: `user=%7B%22id%22%3A${i}%7D&hash=deadbeef` }),
      }),
    );
    statuses.push(res.status);
  }
  assert.equal(statuses.at(-1), 429, "MUTATSIYA: buzuq imzolar sanalmayapti");
  assert.ok(statuses.slice(0, -1).every((s) => s === 401));
  assert.ok(IP_LIMITS.tgPerIp.count >= 300, "IP shipi NAT uchun keng bo'lishi kerak");
});
