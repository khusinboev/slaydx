import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { inRouteRequest } from "./helpers/next-route-request.mts";

/**
 * Bearer session transport for webviews that refuse cookies
 * (docs/auth/COOKIELESS.md), on the test database:
 *   - the token is returned ONLY with `X-Session-Transport: bearer`
 *     (bot-link, Telegram initData, OTP), `no-store`, shorter lifetime;
 *   - `Authorization: Bearer` is accepted by the consumer API with the same
 *     checks as the cookie (unknown / malformed / revoked / expired / blocked
 *     → 401), a valid cookie wins, the admin readers ignore it;
 *   - logout revokes the bearer row; the Origin check on mutations stays;
 *   - one `info` line per bearer issue without the token; redaction.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TRUST_PROXY = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token-never-called";
process.env.DEV_LOGIN_ENABLED = "1";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { createSession, currentSessionRef, SESSION_COOKIE, BEARER_TTL_DAYS, userAgentFamily } = await import("../lib/server/session.ts");
const { signBotLink } = await import("../lib/server/bot-link.ts");
const { log, redact } = await import("../lib/server/log.ts");
const botLink = await import("../app/api/auth/bot-link/route.ts");
const telegram = await import("../app/api/auth/telegram/route.ts");
const otp = await import("../app/api/auth/otp/route.ts");
const sessionRoute = await import("../app/api/auth/session/route.ts");
const me = await import("../app/api/users/me/route.ts");
const adminSession = await import("../app/api/admin/session/route.ts");

const ORIGIN = "http://localhost:3000";
const WEBKITGTK_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const created: string[] = [];

test.after(async () => {
  if (!hasDb) return;
  if (created.length) await query("DELETE FROM users WHERE id::text = ANY($1)", [created]);
  await pool().end();
});

function tgId(): string {
  return String(7_200_000_000 + randomBytes(3).readUIntBE(0, 3));
}
function ip(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

async function user(opts: { telegramId?: string | null } = {}) {
  await ensureMigrated();
  const telegramId = opts.telegramId === undefined ? tgId() : opts.telegramId;
  const uname = `cl-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const uid = String(
    (await query<{ id: string }>("INSERT INTO users (username, name, telegram_id) VALUES ($1, 'Cookiesiz', $2) RETURNING id", [uname, telegramId]))[0]!.id,
  );
  created.push(uid);
  return { uid, telegramId: telegramId! };
}

type Call = { status: number; body: Record<string, unknown>; headers: Headers; setCookie?: string };

async function call(
  fn: (req: Request) => Promise<Response>,
  url: string,
  opts: { method?: string; body?: unknown; bearer?: string; cookie?: string; optIn?: boolean; origin?: string | null; ua?: string; authorization?: string } = {},
): Promise<Call> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": ip(), "user-agent": opts.ua ?? WEBKITGTK_UA };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.authorization) headers.authorization = opts.authorization;
  if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`;
  if (opts.optIn) headers["x-session-transport"] = "bearer";
  const req = new Request(`http://localhost:3000${url}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const { result, setCookies } = await inRouteRequest(req, () => fn(req));
  const text = await result.text();
  return {
    status: result.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    headers: result.headers,
    setCookie: setCookies.map((c) => /^slaydx_session=([^;]*)/.exec(c)?.[1]).find((v) => v !== undefined),
  };
}

const getMe = (opts: Parameters<typeof call>[2] = {}) => call(me.GET, "/api/users/me", opts);

function capture(t: TestContext): string[] {
  const rows: string[] = [];
  const push = (...a: unknown[]) => void rows.push(a.map(String).join(" "));
  t.mock.method(console, "log", push);
  t.mock.method(console, "info", push);
  t.mock.method(console, "warn", push);
  t.mock.method(console, "error", push);
  return rows;
}

/** A fresh bearer token for a new user through the real opt-in bot-link exchange. */
async function bearerLogin() {
  const u = await user();
  const r = await call(botLink.POST, "/api/auth/bot-link", { method: "POST", body: { token: signBotLink(u.telegramId), confirm: true }, optIn: true });
  assert.equal(r.status, 200);
  return { ...u, token: String(r.body.sessionToken) };
}

test("bot-link WITHOUT the opt-in header: cookie only, the body never carries a token", { skip }, async () => {
  const u = await user();
  const r = await call(botLink.POST, "/api/auth/bot-link", { method: "POST", body: { token: signBotLink(u.telegramId), confirm: true } });
  assert.equal(r.status, 200);
  assert.ok(r.setCookie, "cookie set as before");
  assert.deepEqual(Object.keys(r.body), ["user"], "MUTATION: token returned to a cookie client");
  assert.ok(!JSON.stringify(r.body).includes(r.setCookie!), "the raw token is nowhere in the body");
  // Any other header value is not the opt-in.
  const odd = await call(botLink.POST, "/api/auth/bot-link", {
    method: "POST",
    body: { token: signBotLink(u.telegramId), confirm: true },
    authorization: "Bearer x",
  });
  assert.equal(odd.body.sessionToken, undefined);
});

test("bot-link WITH `X-Session-Transport: bearer`: 200 + sessionToken (no-store, 7-day row) that authenticates the API", { skip }, async (t) => {
  const rows = capture(t);
  const u = await user();
  const r = await call(botLink.POST, "/api/auth/bot-link", { method: "POST", body: { token: signBotLink(u.telegramId), confirm: true }, optIn: true });
  assert.equal(r.status, 200);
  const token = r.body.sessionToken;
  assert.equal(typeof token, "string", "MUTATION: opt-in ignored");
  assert.match(String(token), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal((r.body.user as { id: string }).id, u.uid);
  const row = await query<{ user_id: string; days: number }>(
    "SELECT user_id::text, EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS days FROM sessions WHERE token_hash = $1",
    [hashOf(String(token))],
  );
  assert.equal(row[0]?.user_id, u.uid, "the token is a normal `sessions` row");
  assert.ok(Math.abs(Number(row[0]!.days) - BEARER_TTL_DAYS) < 0.01, `bearer row lives ${BEARER_TTL_DAYS} days`);

  const viaBearer = await getMe({ bearer: String(token) });
  assert.equal(viaBearer.status, 200, "MUTATION: requireUser ignores Authorization");
  assert.equal((viaBearer.body.user as { id: string }).id, u.uid);

  // Observability: one info line, UA family only, no token, no full UA.
  const issued = rows.filter((l) => l.includes("bearer-mode session issued"));
  assert.equal(issued.length, 1);
  assert.match(issued[0]!, /"uaFamily":"webkitgtk"/);
  assert.match(issued[0]!, /"route":"auth\/bot-link"/);
  assert.ok(rows.every((l) => !l.includes(String(token))), "the token never reaches the logs");
  assert.ok(rows.every((l) => !l.includes("Safari/605")), "the full UA is not logged");
});

test("Telegram initData and OTP: the token only with the opt-in", { skip }, async () => {
  const tg = tgId();
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAHcookieless",
    user: JSON.stringify({ id: Number(tg), first_name: "Cookiesiz" }),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  const initData = new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(dcs).digest("hex") }).toString();

  const plain = await call(telegram.POST, "/api/auth/telegram", { method: "POST", body: { initData } });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.sessionToken, undefined);
  const uid = (plain.body.user as { id: string }).id;
  created.push(uid);
  // The same initData again (the client's retry): a new session with the token.
  const retry = await call(telegram.POST, "/api/auth/telegram", { method: "POST", body: { initData }, optIn: true });
  assert.equal(retry.status, 200);
  assert.equal((await getMe({ bearer: String(retry.body.sessionToken) })).status, 200);

  // A fresh identifier per run: the per-identifier request limit (3 / 10 min) must not make reruns flaky.
  const phone = `cl-otp-${randomBytes(4).toString("hex")}`;
  const issue = await call(otp.POST, "/api/auth/otp?action=request", { method: "POST", body: { identifier: phone } });
  assert.equal(issue.status, 200);
  const verify = await call(otp.POST, "/api/auth/otp?action=verify", {
    method: "POST",
    body: { identifier: phone, code: issue.body.devCode },
    optIn: true,
  });
  assert.equal(verify.status, 200);
  created.push((verify.body.user as { id: string }).id);
  assert.equal((await getMe({ bearer: String(verify.body.sessionToken) })).status, 200);
  const issue2 = await call(otp.POST, "/api/auth/otp?action=request", { method: "POST", body: { identifier: phone } });
  const verify2 = await call(otp.POST, "/api/auth/otp?action=verify", { method: "POST", body: { identifier: phone, code: issue2.body.devCode } });
  assert.equal(verify2.status, 200);
  assert.equal(verify2.body.sessionToken, undefined, "OTP without opt-in: cookie only");
});

test("bearer rejected: unknown, malformed, revoked, expired, blocked user → 401; session GET → user:null", { skip }, async () => {
  assert.equal((await getMe({ bearer: randomBytes(32).toString("base64url") })).status, 401, "unknown token");
  for (const authorization of ["Bearer short", "Basic abc", `Bearer ${"x".repeat(44)}`, `bearer${randomBytes(32).toString("base64url")}`]) {
    assert.equal((await getMe({ authorization })).status, 401, `malformed: ${authorization.slice(0, 12)}`);
  }

  const revoked = await bearerLogin();
  await query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [hashOf(revoked.token)]);
  assert.equal((await getMe({ bearer: revoked.token })).status, 401, "MUTATION: revoked bearer accepted");

  const expired = await bearerLogin();
  await query("UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [hashOf(expired.token)]);
  assert.equal((await getMe({ bearer: expired.token })).status, 401, "expired bearer");

  const blocked = await bearerLogin();
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [blocked.uid]);
  assert.equal((await getMe({ bearer: blocked.token })).status, 401, "blocked user");

  const s = await call(sessionRoute.GET, "/api/auth/session", { bearer: revoked.token });
  assert.equal(s.status, 200);
  assert.equal(s.body.user, null);
});

test("a valid cookie wins over the bearer; an invalid cookie does not shadow a valid bearer", { skip }, async () => {
  const a = await user();
  const cookieA = (await createSession(a.uid)).token;
  const b = await bearerLogin();
  const both = await getMe({ cookie: cookieA, bearer: b.token });
  assert.equal((both.body.user as { id: string }).id, a.uid, "cookie wins");
  const stale = await getMe({ cookie: randomBytes(32).toString("base64url"), bearer: b.token });
  assert.equal(stale.status, 200);
  assert.equal((stale.body.user as { id: string }).id, b.uid, "dead cookie + live bearer → bearer");
});

test("«O'tish» in bearer mode: the bearer session is the current one — switch asked first, then replaced (old row revoked)", { skip }, async () => {
  const a = await bearerLogin();
  const b = await user();
  const link = signBotLink(b.telegramId);
  const ask = await call(botLink.POST, "/api/auth/bot-link", { method: "POST", body: { token: link }, bearer: a.token, optIn: true });
  assert.equal(ask.status, 409);
  assert.equal(ask.body.code, "switch_confirm", "the bearer session is seen as this webview's session");
  const go = await call(botLink.POST, "/api/auth/bot-link", { method: "POST", body: { token: link, confirm: true }, bearer: a.token, optIn: true });
  assert.equal(go.status, 200);
  assert.equal((go.body.user as { id: string }).id, b.uid);
  assert.equal((await getMe({ bearer: a.token })).status, 401, "account A's bearer row is revoked");
  const now = await getMe({ bearer: String(go.body.sessionToken) });
  assert.equal((now.body.user as { id: string }).id, b.uid);
  // The link owner's own bearer session is reused: no new token.
  const again = await call(botLink.POST, "/api/auth/bot-link", { method: "POST", body: { token: link, confirm: true }, bearer: String(go.body.sessionToken), optIn: true });
  assert.equal(again.status, 200);
  assert.equal(again.body.sessionToken, undefined);
});

test("admin stays cookie-only: currentSessionRef() without req ignores the bearer; the admin session route 404s", { skip }, async () => {
  const b = await bearerLogin();
  const req = new Request("http://localhost:3000/api/x", { headers: { authorization: `Bearer ${b.token}` } });
  const { result } = await inRouteRequest(req, async () => ({ bare: await currentSessionRef(), withReq: await currentSessionRef(req) }));
  assert.equal(result.bare, null, "MUTATION: cookie-only reader accepts Authorization");
  assert.equal(result.withReq?.user.id, b.uid);
  const admin = await call((req) => adminSession.GET(req, {}), "/api/admin/session", { bearer: b.token });
  assert.equal(admin.status, 404);
});

test("mutations: a foreign Origin is refused even with a valid bearer; our Origin passes", { skip }, async () => {
  const b = await bearerLogin();
  const evil = await call(me.PATCH, "/api/users/me", { method: "PATCH", body: { city: "Samarqand" }, bearer: b.token, origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  const ok = await call(me.PATCH, "/api/users/me", { method: "PATCH", body: { city: "Samarqand" }, bearer: b.token });
  assert.equal(ok.status, 200);
});

test("logout with the bearer revokes its row; logout-all with the bearer revokes every row", { skip }, async () => {
  const b = await bearerLogin();
  const out = await call(sessionRoute.DELETE, "/api/auth/session", { method: "DELETE", bearer: b.token });
  assert.equal(out.status, 200);
  assert.equal((await getMe({ bearer: b.token })).status, 401, "MUTATION: logout leaves the bearer row alive");

  const c = await bearerLogin();
  const other = (await createSession(c.uid)).token;
  const all = await call(sessionRoute.DELETE, "/api/auth/session?all=1", { method: "DELETE", bearer: c.token });
  assert.equal(all.status, 200);
  assert.equal((await getMe({ bearer: c.token })).status, 401);
  assert.equal((await getMe({ cookie: other })).status, 401, "the other device too");
});

test("redaction: sessionToken fields, JSON and Authorization never reach a log line", (t) => {
  const rows = capture(t);
  const secret = randomBytes(32).toString("base64url");
  log("info", `answer {"user":{},"sessionToken":"${secret}"}`, { sessionToken: secret, session_token: secret, headers: { authorization: `Bearer ${secret}` } });
  log("error", `failed with Authorization: Bearer ${secret}`);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((l) => !l.includes(secret)), "MUTATION: sessionToken logged");
  assert.ok(!redact(`sessionToken=${secret}`).includes(secret));
});

test("userAgentFamily: coarse families only", () => {
  assert.equal(userAgentFamily(WEBKITGTK_UA), "webkitgtk");
  assert.equal(userAgentFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"), "webview2");
  assert.equal(userAgentFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko)"), "wkwebview-mac");
  assert.equal(userAgentFamily("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129 Mobile"), "android");
  assert.equal(userAgentFamily(null), "other");
});
