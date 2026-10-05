import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { inRouteRequest } from "./helpers/next-route-request.mts";

/**
 * Hotfix (owner report after e6383b9): one phone, two Telegram accounts. The
 * accounts share the Mini App webview's cookies, so account 2 used to land in
 * account 1's session. `POST /api/auth/telegram` with verified Mini App
 * initData now:
 *  - another account's session on this cookie → that ONE session row is
 *    revoked (its other devices stay) and a new cookie for the Mini App user;
 *  - the same account → no new session (no churn), no Set-Cookie;
 *  - invalid initData → 401, the old session untouched.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TRUST_PROXY = "true";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token-never-called";
process.env.APP_URL = "http://localhost:3000";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { miniAppSessionAction } = await import("../lib/server/auth.ts");
const { POST } = await import("../app/api/auth/telegram/route.ts");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const created: string[] = [];
const tgIds: string[] = [];

test.after(async () => {
  if (!hasDb) return;
  if (tgIds.length) {
    const rows = await query<{ id: string }>("SELECT id::text AS id FROM users WHERE telegram_id::text = ANY($1)", [tgIds]);
    created.push(...rows.map((r) => r.id));
  }
  if (created.length) await query("DELETE FROM users WHERE id::text = ANY($1)", [created]);
  await pool().end();
});

/** A random Telegram id far from real ones. */
function tgId(): string {
  const id = String(7_000_000_000 + randomBytes(3).readUIntBE(0, 3));
  tgIds.push(id);
  return id;
}

/** initData signed like Telegram does (HMAC over every field but `hash`). */
function initData(id: string, opts: { authDate?: number; tamper?: boolean } = {}): string {
  const fields: Record<string, string> = {
    auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: "AAHswitch",
    user: JSON.stringify({ id: Number(id), first_name: "Sinov" }),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  let hash = createHmac("sha256", secret).update(dcs).digest("hex");
  if (opts.tamper) hash = hash.replace(/^./, (c) => (c === "0" ? "1" : "0"));
  return new URLSearchParams({ ...fields, hash }).toString();
}

async function userWithSession(telegramId: string | null) {
  await ensureMigrated();
  const uname = `switch-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const uid = String(
    (await query<{ id: string }>("INSERT INTO users (username, name, telegram_id) VALUES ($1, 'Sinov', $2) RETURNING id", [uname, telegramId]))[0]!.id,
  );
  created.push(uid);
  const here = await createSession(uid);
  const elsewhere = await createSession(uid); // the same account on another device
  return { uid, cookie: `${SESSION_COOKIE}=${here.token}`, here: here.token, elsewhere: elsewhere.token };
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
async function revoked(token: string): Promise<boolean> {
  const rows = await query<{ revoked_at: Date | null }>("SELECT revoked_at FROM sessions WHERE token_hash = $1", [hashOf(token)]);
  assert.equal(rows.length, 1, "session row not found (hash scheme changed?)");
  return rows[0]!.revoked_at !== null;
}
async function sessionsOf(uid: string): Promise<number> {
  return Number((await query<{ n: string }>("SELECT count(*)::text AS n FROM sessions WHERE user_id = $1", [uid]))[0]!.n);
}

function ip(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

async function login(body: unknown, cookie?: string) {
  const req = new Request("http://localhost:3000/api/auth/telegram", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": ip(),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const { result, setCookies } = await inRouteRequest(req, () => POST(req));
  const newToken = setCookies.map((c) => /^slaydx_session=([^;]*)/.exec(c)?.[1]).find((v) => v);
  return { status: result.status, json: (await result.json()) as { user?: { id: string; telegramId: string | null } }, newToken };
}

test("miniAppSessionAction: create / reuse / replace, ids compared as strings", () => {
  assert.equal(miniAppSessionAction(null, "42"), "create");
  assert.equal(miniAppSessionAction({ telegramId: "42" }, "42"), "reuse");
  assert.equal(miniAppSessionAction({ telegramId: 42 as unknown as string }, "42"), "reuse");
  assert.equal(miniAppSessionAction({ telegramId: "77" }, "42"), "replace");
  assert.equal(miniAppSessionAction({ telegramId: "4" }, "42"), "replace");
  assert.equal(miniAppSessionAction({ telegramId: null }, "42"), "replace");
});

test("different Telegram account on this cookie + valid initData → new cookie for the Mini App user, only this session revoked", { skip }, async () => {
  const a1 = await userWithSession(tgId());
  const id2 = tgId();
  const r = await login({ initData: initData(id2) }, a1.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.json.user?.telegramId, id2, "signed in as the Mini App user");
  assert.ok(r.newToken && r.newToken !== a1.here, "a new session cookie is set");
  assert.equal(await revoked(a1.here), true, "MUTATION: account 1's session on this webview stays alive");
  assert.equal(await revoked(a1.elsewhere), false, "account 1's other devices stay signed in");
  const owner = await query<{ telegram_id: string }>(
    "SELECT u.telegram_id::text AS telegram_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL",
    [hashOf(r.newToken!)],
  );
  assert.equal(owner[0]?.telegram_id, id2, "the new cookie belongs to the Mini App user");
});

test("invalid initData with another account's session → 401, old session untouched, no cookie", { skip }, async () => {
  const a1 = await userWithSession(tgId());
  const id2 = tgId();
  for (const bad of [initData(id2, { tamper: true }), initData(id2, { authDate: Math.floor(Date.now() / 1000) - 2 * 86_400 })]) {
    const r = await login({ initData: bad }, a1.cookie);
    assert.equal(r.status, 401);
    assert.ok(!r.newToken);
    assert.equal(await revoked(a1.here), false);
  }
});

test("same Telegram account → no new session (no churn), no Set-Cookie", { skip }, async () => {
  const id = tgId();
  const a = await userWithSession(id);
  const before = await sessionsOf(a.uid);
  const r = await login({ initData: initData(id) }, a.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.json.user?.id, a.uid);
  assert.ok(!r.newToken, "MUTATION: same account got a fresh cookie");
  assert.equal(await sessionsOf(a.uid), before);
  assert.equal(await revoked(a.here), false);
});

test("no session → today's behaviour: a new session for the Mini App user", { skip }, async () => {
  const id = tgId();
  const r = await login({ initData: initData(id) });
  assert.equal(r.status, 200);
  assert.equal(r.json.user?.telegramId, id);
  assert.ok(r.newToken);
});
