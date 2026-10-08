import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { inRouteRequest } from "./helpers/next-route-request.mts";

/**
 * `POST /api/auth/bot-link` (docs/bot/PLAN.md Q1) on the test database:
 * happy path, reuse, expired / forged / unknown, revocation (logout,
 * logout-all, admin block), account switch only after confirmation,
 * phone-login sessions never replaced, Origin check, rate limits, and the
 * token never reaching the logs.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TRUST_PROXY = "true";
process.env.APP_URL = "http://localhost:3000";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { signBotLink, BOT_LINK_TTL_SEC } = await import("../lib/server/bot-link.ts");
const { IP_LIMITS } = await import("../lib/server/ip-limits.ts");
const { POST } = await import("../app/api/auth/bot-link/route.ts");
const { DELETE: LOGOUT } = await import("../app/api/auth/session/route.ts");

const created: string[] = [];

test.after(async () => {
  if (!hasDb) return;
  if (created.length) await query("DELETE FROM users WHERE id::text = ANY($1)", [created]);
  await pool().end();
});

/** A random Telegram id far from real ones. */
function tgId(): string {
  return String(7_100_000_000 + randomBytes(3).readUIntBE(0, 3));
}

async function user(opts: { telegramId?: string | null; name?: string; username?: string | null; sessions?: number } = {}) {
  await ensureMigrated();
  const telegramId = opts.telegramId === undefined ? tgId() : opts.telegramId;
  const uname = opts.username === undefined ? `bl-${Date.now()}-${randomBytes(3).toString("hex")}` : opts.username;
  const uid = String(
    (
      await query<{ id: string }>("INSERT INTO users (username, name, telegram_id) VALUES ($1, $2, $3) RETURNING id", [
        uname,
        opts.name ?? "Sinov",
        telegramId,
      ])
    )[0]!.id,
  );
  created.push(uid);
  const tokens: string[] = [];
  for (let i = 0; i < (opts.sessions ?? 0); i++) tokens.push((await createSession(uid)).token);
  return { uid, telegramId: telegramId!, tokens, cookie: tokens[0] ? `${SESSION_COOKIE}=${tokens[0]}` : undefined };
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
async function revoked(token: string): Promise<boolean> {
  const rows = await query<{ revoked_at: Date | null }>("SELECT revoked_at FROM sessions WHERE token_hash = $1", [hashOf(token)]);
  assert.equal(rows.length, 1, "session row not found");
  return rows[0]!.revoked_at !== null;
}
async function ownerOf(token: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    "SELECT user_id::text AS id FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
    [hashOf(token)],
  );
  return rows[0]?.id ?? null;
}

function ip(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

type Res = { status: number; json: Record<string, unknown> & { user?: { id: string; telegramId: string | null } }; newToken?: string };

async function exchange(
  body: unknown,
  opts: { cookie?: string; ip?: string; origin?: string | null; site?: string } = {},
): Promise<Res> {
  const headers: Record<string, string> = {
    host: "localhost:3000",
    "content-type": "application/json",
    "x-forwarded-for": opts.ip ?? ip(),
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? "http://localhost:3000";
  if (opts.site) headers["sec-fetch-site"] = opts.site;
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new Request("http://localhost:3000/api/auth/bot-link", { method: "POST", headers, body: JSON.stringify(body) });
  const { result, setCookies } = await inRouteRequest(req, () => POST(req));
  const newToken = setCookies.map((c) => /^slaydx_session=([^;]+)/.exec(c)?.[1]).find((v) => v);
  return { status: result.status, json: (await result.json()) as Res["json"], newToken };
}

test("no session + valid link → 200, the link owner's session cookie", { skip }, async () => {
  const u = await user();
  const r = await exchange({ token: signBotLink(u.telegramId) });
  assert.equal(r.status, 200);
  assert.equal(r.json.user?.id, u.uid);
  assert.ok(r.newToken, "MUTATION: no session cookie");
  assert.equal(await ownerOf(r.newToken!), u.uid);
});

test("already signed in as the link owner → 200, no new session (idempotent)", { skip }, async () => {
  const u = await user({ sessions: 1 });
  const r = await exchange({ token: signBotLink(u.telegramId) }, { cookie: u.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.user?.id, u.uid);
  assert.ok(!r.newToken, "MUTATION: a fresh cookie for the same account");
  assert.equal(await revoked(u.tokens[0]!), false);
  const n = await query<{ n: string }>("SELECT count(*)::text AS n FROM sessions WHERE user_id = $1", [u.uid]);
  assert.equal(n[0]!.n, "1");
});

test("expired link (7 days) → 401 bot_link_expired, no cookie; 1 s before → 200", { skip }, async () => {
  const u = await user();
  const old = signBotLink(u.telegramId, Date.now() - BOT_LINK_TTL_SEC * 1000 - 1000);
  const r = await exchange({ token: old });
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "bot_link_expired");
  assert.match(String(r.json.error), /Botga qayting/);
  assert.ok(!r.newToken);
  const ok = await exchange({ token: signBotLink(u.telegramId, Date.now() - (BOT_LINK_TTL_SEC - 5) * 1000) });
  assert.equal(ok.status, 200);
});

test("forged, malformed, wrong-version or unknown-account links → 401 bot_link_invalid / 400, no cookie", { skip }, async () => {
  const u = await user();
  const good = signBotLink(u.telegramId);
  const raw = Buffer.from(good, "base64url");
  raw[20]! ^= 1;
  for (const token of [raw.toString("base64url"), good.slice(0, -2), "x".repeat(39)]) {
    const r = await exchange({ token });
    assert.equal(r.status, 401, token);
    assert.equal(r.json.code, "bot_link_invalid");
    assert.ok(!r.newToken);
  }
  const unknown = await exchange({ token: signBotLink(tgId()) });
  assert.equal(unknown.status, 401, "a signed id without an account");
  assert.equal(unknown.json.code, "bot_link_invalid");
  for (const body of [{}, { token: 42 }, { token: "" }, { token: "A".repeat(65) }, { token: ["x"] }]) {
    const r = await exchange(body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test("revocation: logout-all after issue voids the link; a link issued after the logout works", { skip }, async () => {
  const u = await user({ sessions: 2 });
  const before = signBotLink(u.telegramId, Date.now() - 60_000);
  const req = new Request("http://localhost:3000/api/auth/session?all=1", {
    method: "DELETE",
    headers: { host: "localhost:3000", origin: "http://localhost:3000", cookie: u.cookie! },
  });
  const out = await inRouteRequest(req, () => LOGOUT(req));
  assert.equal(out.result.status, 200);
  assert.equal(await revoked(u.tokens[1]!), true, "logout-all revoked the other device");
  const r = await exchange({ token: before });
  assert.equal(r.status, 401, "MUTATION: a link survived «barcha qurilmalardan chiqish»");
  assert.equal(r.json.code, "bot_link_expired");
  assert.ok(!r.newToken);
  const after = signBotLink(u.telegramId, Date.now() + 2000);
  assert.equal((await exchange({ token: after })).status, 200, "a fresh link (/start) signs in again");
});

test("revocation: a single logout, or an admin revoke, after issue also voids the link; older revocations do not", { skip }, async () => {
  const u = await user({ sessions: 1 });
  await query("UPDATE sessions SET revoked_at = now() - interval '2 hours' WHERE user_id = $1", [u.uid]);
  const link = signBotLink(u.telegramId, Date.now() - 3600_000);
  assert.equal((await exchange({ token: link })).status, 200, "revoked before the link was issued: no effect");
  await query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [u.uid]);
  const r = await exchange({ token: link });
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "bot_link_expired");
});

test("blocked account → 403 account_blocked, no cookie", { skip }, async () => {
  const u = await user();
  await query("UPDATE users SET is_blocked = true WHERE id = $1", [u.uid]);
  const r = await exchange({ token: signBotLink(u.telegramId) });
  assert.equal(r.status, 403, "MUTATION: a blocked account got a session");
  assert.equal(r.json.code, "account_blocked");
  assert.ok(!r.newToken);
});

test("another Telegram account signed in → 409 switch_confirm (nothing changes), then confirm → switch, only this session revoked", { skip }, async () => {
  const a = await user({ sessions: 2, name: "Avval" });
  const b = await user({ name: "Bek Ali", username: "bekali" });
  const token = signBotLink(b.telegramId, Date.now() - 3 * 86_400_000);
  const ask = await exchange({ token }, { cookie: a.cookie });
  assert.equal(ask.status, 409, "MUTATION: a silent account switch");
  assert.equal(ask.json.code, "switch_confirm");
  assert.equal(ask.json.to, "Bek Ali (@bekali)");
  assert.ok(!ask.newToken);
  assert.equal(await revoked(a.tokens[0]!), false);
  for (const confirm of ["true", 1, "yes"]) {
    const loose = await exchange({ token, confirm }, { cookie: a.cookie });
    assert.equal(loose.status, 409, `confirm must be the boolean true, not ${JSON.stringify(confirm)}`);
  }
  const go = await exchange({ token, confirm: true }, { cookie: a.cookie });
  assert.equal(go.status, 200);
  assert.equal(go.json.user?.id, b.uid);
  assert.ok(go.newToken);
  assert.equal(await ownerOf(go.newToken!), b.uid);
  assert.equal(await revoked(a.tokens[0]!), true, "this webview's old session is revoked");
  assert.equal(await revoked(a.tokens[1]!), false, "account A's other device stays signed in");
});

test("phone-login session → 409 switch_phone_session even with confirm, phone session untouched", { skip }, async () => {
  const phone = await user({ telegramId: null, sessions: 1 });
  const b = await user();
  for (const confirm of [false, true]) {
    const r = await exchange({ token: signBotLink(b.telegramId), confirm }, { cookie: phone.cookie });
    assert.equal(r.status, 409, "MUTATION: a phone-login session was replaced");
    assert.equal(r.json.code, "switch_phone_session");
    assert.ok(!r.newToken);
  }
  assert.equal(await revoked(phone.tokens[0]!), false);
});

test("Origin: cross-site requests are refused before anything else", { skip }, async () => {
  const u = await user();
  const token = signBotLink(u.telegramId);
  const foreign = await exchange({ token }, { origin: "https://evil.example" });
  assert.equal(foreign.status, 403, "MUTATION: Origin check dropped");
  assert.ok(!foreign.newToken);
  const site = await exchange({ token }, { site: "cross-site" });
  assert.equal(site.status, 403);
  assert.equal((await exchange({ token }, { origin: null })).status, 200, "no Origin (not a browser): allowed like every route");
});

test("rate limits: forged tokens fill the IP's bad bucket (then even a valid link waits); 10 per account per 5 min", { skip }, async () => {
  const u = await user();
  const addr = ip();
  const forged = Buffer.from(signBotLink(u.telegramId), "base64url");
  forged[25]! ^= 1;
  for (let i = 0; i < IP_LIMITS.tgBadPerIp.count; i++) {
    assert.equal((await exchange({ token: forged.toString("base64url") }, { ip: addr })).status, 401);
  }
  const blocked = await exchange({ token: signBotLink(u.telegramId) }, { ip: addr });
  assert.equal(blocked.status, 429, "MUTATION: the bad bucket is not checked");
  assert.ok(!blocked.newToken);
  // Expired links (valid MAC) are not counted as attacks.
  const addr2 = ip();
  const old = signBotLink(u.telegramId, Date.now() - 8 * 86_400_000);
  for (let i = 0; i < IP_LIMITS.tgBadPerIp.count + 2; i++) assert.equal((await exchange({ token: old }, { ip: addr2 })).status, 401);
  const v = await user();
  for (let i = 0; i < IP_LIMITS.tgPerAccount.count; i++) assert.equal((await exchange({ token: signBotLink(v.telegramId) })).status, 200);
  const over = await exchange({ token: signBotLink(v.telegramId) });
  assert.equal(over.status, 429, "MUTATION: no per-account limit");
});

test("the token never reaches the logs or the response", { skip }, async () => {
  const u = await user();
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, write: process.stdout.write, ewrite: process.stderr.write };
  const grab = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.log = console.warn = console.error = console.info = grab;
  process.stdout.write = ((chunk: unknown) => (lines.push(String(chunk)), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
  const tokens = [signBotLink(u.telegramId), signBotLink(u.telegramId, Date.now() - 9 * 86_400_000)];
  const bodies: string[] = [];
  try {
    for (const t of tokens) bodies.push(JSON.stringify((await exchange({ token: t })).json));
    const broken = Buffer.from(tokens[0]!, "base64url");
    broken[3]! ^= 1;
    bodies.push(JSON.stringify((await exchange({ token: broken.toString("base64url") })).json));
  } finally {
    Object.assign(console, { log: orig.log, warn: orig.warn, error: orig.error, info: orig.info });
    process.stdout.write = orig.write;
    process.stderr.write = orig.ewrite;
  }
  for (const t of tokens) {
    assert.ok(!lines.some((l) => l.includes(t)), "token in a log line");
    assert.ok(!bodies.some((b) => b.includes(t)), "token echoed in a response");
  }
});
