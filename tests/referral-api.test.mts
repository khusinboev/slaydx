import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { inRouteRequest } from "./helpers/next-route-request.mts";

/**
 * Referral HTTP surface (T3), real route handlers on a real Postgres:
 *   - `GET /api/referral`: session only (401 otherwise), exact shape, other
 *     people by display name only, ≤ 20 recent, `Cache-Control: private, no-store`;
 *   - `POST /api/referral/capture`: same-origin, code-shaped, sets the httpOnly
 *     `sx_ref` cookie (Path=/api/auth, SameSite=Lax, 30 days) for a visitor,
 *     nothing for a signed-in user;
 *   - `POST /api/auth/telegram`: a NEW account created with the signed Mini App
 *     `start_param=ref_<code>` (source bot) or the `sx_ref` cookie (source web)
 *     rewards the inviter; an existing account never; the cookie is cleared;
 *   - `POST /api/auth/telegram/ticket`: the cookie's code rides on the ticket.
 *
 * Mutations (each turned a test red, then restored):
 *   1. `requireUser` → `optionalUser` in GET /api/referral → «401 without a session»;
 *   2. `u.username` added to the recent list → «no PII»;
 *   3. capture route sets the cookie for a signed-in user → «signed-in visitor»;
 *   4. auth route ignores `profile.startParam` → «Mini App start_param»;
 *   5. auth route ignores the cookie → «cookie hand-off»;
 *   6. ticket route ignores the cookie → «ticket carries the code».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TRUST_PROXY = "true";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token-never-called";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.APP_URL = "http://localhost:3000";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { upsertTelegramUser, registerBotUser } = await import("../lib/server/auth.ts");
const { ensureRefCode } = await import("../lib/server/referrals.ts");
const summaryRoute = await import("../app/api/referral/route.ts");
const captureRoute = await import("../app/api/referral/capture/route.ts");
const authRoute = await import("../app/api/auth/telegram/route.ts");
const ticketRoute = await import("../app/api/auth/telegram/ticket/route.ts");
if (hasDb) await ensureMigrated();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const tgIds: string[] = [];

test.after(async () => {
  if (!hasDb) return;
  await query("DELETE FROM referrals WHERE referee_telegram_id::text = ANY($1)", [tgIds]);
  await query("DELETE FROM users WHERE telegram_id::text = ANY($1)", [tgIds]);
  await pool().end();
});

function tgId(): string {
  const id = String(7_600_000_000 + randomInt(0, 99_999_999));
  tgIds.push(id);
  return id;
}
const ip = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;

async function inviter(name = "Taklifchi") {
  const u = await upsertTelegramUser({ telegramId: tgId(), username: "taklifchi_user", name, photoUrl: null });
  const s = await createSession(u.id);
  return { id: u.id, code: await ensureRefCode(u.id), cookie: `${SESSION_COOKIE}=${s.token}` };
}
const pointsOf = async (id: string) => Number((await queryOne<{ points: string }>("SELECT points FROM users WHERE id = $1", [id]))!.points);
const referralOf = (tg: string) =>
  query<{ referrer_user_id: string; source: string; reward_points: number }>(
    "SELECT referrer_user_id::text AS referrer_user_id, source, reward_points FROM referrals WHERE referee_telegram_id = $1",
    [tg],
  );

function request(path: string, init: { method?: string; cookie?: string; body?: unknown; origin?: string | null } = {}): Request {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": ip() };
  if (init.origin !== null) headers.origin = init.origin ?? "http://localhost:3000";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function run(fn: (req: Request) => Promise<Response>, req: Request) {
  const { result, setCookies } = await inRouteRequest(req, () => fn(req));
  const headerCookies = result.headers.getSetCookie?.() ?? [];
  const text = await result.text();
  return { status: result.status, text, body: text ? JSON.parse(text) : null, headers: result.headers, cookies: [...setCookies, ...headerCookies] };
}

/** Mini App initData signed like Telegram does (optional `start_param`). */
function initData(id: string, startParam?: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAHref",
    user: JSON.stringify({ id: Number(id), first_name: "Mini", last_name: "Ilova" }),
    ...(startParam ? { start_param: startParam } : {}),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(dcs).digest("hex") }).toString();
}

/* ───────────────────────────── GET /api/referral ───────────────────────────── */

test("GET /api/referral: 401 without a session", { skip }, async () => {
  const r = await run(summaryRoute.GET, request("/api/referral"));
  assert.equal(r.status, 401, "MUTATSIYA 1");
});

test("GET /api/referral: exact shape, links, counters, recent names only (no ids/usernames), no-store", { skip }, async () => {
  const inv = await inviter();
  const friendTg = tgId();
  await registerBotUser({ telegramId: friendTg, username: "dost_secret_handle", name: "Dilnoza Do'st", photoUrl: null }, { code: inv.code, source: "bot" });
  const r = await run(summaryRoute.GET, request("/api/referral", { cookie: inv.cookie }));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(Object.keys(r.body).sort(), ["botLink", "code", "earnedPoints", "invitedCount", "recent", "rewardPoints", "webLink"]);
  assert.equal(r.body.code, inv.code);
  assert.equal(r.body.botLink, `https://t.me/slaydx_test_bot?start=ref_${inv.code}`);
  assert.equal(r.body.webLink, `http://localhost:3000/uz?ref=${inv.code}`);
  assert.equal(r.body.invitedCount, 1);
  assert.equal(r.body.earnedPoints, 2000);
  assert.equal(r.body.rewardPoints, 2000);
  assert.deepEqual(r.body.recent.map((x: { name: string }) => x.name), ["Dilnoza Do'st"]);
  assert.deepEqual(Object.keys(r.body.recent[0]).sort(), ["joinedAt", "name"]);
  for (const leak of [friendTg, "dost_secret_handle"]) assert.ok(!r.text.includes(leak), `MUTATSIYA 2: ${leak} must not leave the server`);
  assert.equal(r.headers.get("cache-control"), "private, no-store");
});

/* ───────────────────────────── capture ───────────────────────────── */

test("POST /api/referral/capture: visitor → httpOnly sx_ref (Path=/api/auth, Lax, 30 days); bad code 400; cross-site 403; signed-in → nothing", { skip }, async () => {
  const inv = await inviter();
  const ok = await run(captureRoute.POST, request("/api/referral/capture", { method: "POST", body: { code: inv.code.toUpperCase() } }));
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body, { captured: true });
  const c = ok.cookies.find((x) => x.startsWith("sx_ref="));
  assert.ok(c, "cookie set");
  assert.ok(c.startsWith(`sx_ref=${inv.code};`), "normalised code");
  assert.match(c, /Path=\/api\/auth/);
  assert.match(c, /HttpOnly/i);
  assert.match(c, /SameSite=lax/i);
  assert.match(c, /Max-Age=2592000/);

  for (const code of ["../../x", "", 123, "k7m3p0qx"]) {
    const bad = await run(captureRoute.POST, request("/api/referral/capture", { method: "POST", body: { code } }));
    assert.equal(bad.status, 400, String(code));
    assert.ok(!bad.cookies.some((x) => x.startsWith("sx_ref=")));
  }
  const cross = await run(captureRoute.POST, request("/api/referral/capture", { method: "POST", body: { code: inv.code }, origin: "https://evil.example" }));
  assert.equal(cross.status, 403);

  const signedIn = await run(captureRoute.POST, request("/api/referral/capture", { method: "POST", body: { code: inv.code }, cookie: inv.cookie }));
  assert.equal(signedIn.status, 200);
  assert.deepEqual(signedIn.body, { captured: false });
  assert.ok(!signedIn.cookies.some((x) => x.startsWith("sx_ref=")), "MUTATSIYA 3: a signed-in user is not a new account");
});

/* ───────────────────────────── sign-in hand-off ───────────────────────────── */

test("POST /api/auth/telegram: Mini App start_param=ref_<code> creating the account → inviter +2000 (source bot)", { skip }, async () => {
  const inv = await inviter();
  const before = await pointsOf(inv.id);
  const id = tgId();
  const r = await run(authRoute.POST, request("/api/auth/telegram", { method: "POST", body: { initData: initData(id, `ref_${inv.code}`) } }));
  assert.equal(r.status, 200, r.text);
  assert.equal((await pointsOf(inv.id)) - before, 2000, "MUTATSIYA 4");
  assert.deepEqual(await referralOf(id), [{ referrer_user_id: inv.id, source: "bot", reward_points: 2000 }]);
  // The same Mini App link again (a second launch): nothing more.
  const again = await run(authRoute.POST, request("/api/auth/telegram", { method: "POST", body: { initData: initData(id, `ref_${inv.code}`) } }));
  assert.equal(again.status, 200);
  assert.equal((await pointsOf(inv.id)) - before, 2000);
});

test("POST /api/auth/telegram: sx_ref cookie on a NEW account → reward (source web) and the cookie is cleared; an EXISTING account → nothing, cleared too", { skip }, async () => {
  const inv = await inviter();
  const before = await pointsOf(inv.id);
  const id = tgId();
  const r = await run(authRoute.POST, request("/api/auth/telegram", { method: "POST", body: { initData: initData(id) }, cookie: `sx_ref=${inv.code}` }));
  assert.equal(r.status, 200, r.text);
  assert.equal((await pointsOf(inv.id)) - before, 2000, "MUTATSIYA 5");
  assert.deepEqual(await referralOf(id), [{ referrer_user_id: inv.id, source: "web", reward_points: 2000 }]);
  const cleared = r.cookies.find((x) => x.startsWith("sx_ref="));
  assert.ok(cleared && /Max-Age=0/.test(cleared) && /Path=\/api\/auth/.test(cleared), `cookie cleared: ${cleared}`);

  const existingTg = tgId();
  await upsertTelegramUser({ telegramId: existingTg, username: null, name: "Eski", photoUrl: null });
  const mid = await pointsOf(inv.id);
  const r2 = await run(authRoute.POST, request("/api/auth/telegram", { method: "POST", body: { initData: initData(existingTg) }, cookie: `sx_ref=${inv.code}` }));
  assert.equal(r2.status, 200);
  assert.equal(await pointsOf(inv.id), mid, "existing account: no reward");
  assert.equal((await referralOf(existingTg)).length, 0);
  assert.ok(r2.cookies.some((x) => x.startsWith("sx_ref=") && /Max-Age=0/.test(x)));
});

test("POST /api/auth/telegram without any code: no referral, no cookie header", { skip }, async () => {
  const id = tgId();
  const r = await run(authRoute.POST, request("/api/auth/telegram", { method: "POST", body: { initData: initData(id) } }));
  assert.equal(r.status, 200);
  assert.equal((await referralOf(id)).length, 0);
  assert.ok(!r.cookies.some((x) => x.startsWith("sx_ref=")));
});

test("POST /api/auth/telegram/ticket: the browser's sx_ref code rides on the login ticket; without it — none", { skip }, async () => {
  const inv = await inviter();
  const r = await run(ticketRoute.POST, request("/api/auth/telegram/ticket", { method: "POST", body: {}, cookie: `sx_ref=${inv.code}; sx_lt=${randomBytes(18).toString("base64url")}` }));
  assert.equal(r.status, 200, r.text);
  const row = await queryOne<{ ref_code: string | null }>("SELECT ref_code FROM login_tickets WHERE nonce = $1", [r.body.nonce]);
  assert.equal(row!.ref_code, inv.code, "MUTATSIYA 6");
  const plain = await run(ticketRoute.POST, request("/api/auth/telegram/ticket", { method: "POST", body: {}, cookie: `sx_lt=${randomBytes(18).toString("base64url")}` }));
  const none = await queryOne<{ ref_code: string | null }>("SELECT ref_code FROM login_tickets WHERE nonce = $1", [plain.body.nonce]);
  assert.equal(none!.ref_code, null);
  const junk = await run(ticketRoute.POST, request("/api/auth/telegram/ticket", { method: "POST", body: {}, cookie: `sx_ref=<script>; sx_lt=${randomBytes(18).toString("base64url")}` }));
  const j = await queryOne<{ ref_code: string | null }>("SELECT ref_code FROM login_tickets WHERE nonce = $1", [junk.body.nonce]);
  assert.equal(j!.ref_code, null, "a malformed cookie value is never stored");
});
