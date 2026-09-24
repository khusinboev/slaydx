import test from "node:test";
import assert from "node:assert/strict";
import { inRouteRequest } from "./helpers/next-route-request.mts";

/**
 * SECA-04: `DELETE /api/auth/session` (bitta sessiyadan chiqish) ilgari
 * `checkOrigin` siz edi. `SESSION_COOKIE_SAMESITE=none` (Telegram web
 * iframe) rejimida boshqa sayt `fetch(..., {method:"DELETE", credentials:
 * "include"})` bilan foydalanuvchini majburan chiqarib yuborardi.
 *
 * Brauzer cross-site DELETE da HAR DOIM `Origin` (va zamonaviylari
 * `Sec-Fetch-Site: cross-site`) yuboradi — ikkala belgi ham 403 berishi
 * kerak, sessiya esa bekor qilinmasligi kerak.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, ensureMigrated, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const route = await import("../app/api/auth/session/route.ts");

const userIds: string[] = [];
test.after(async () => {
  if (!hasDb) return;
  if (userIds.length) await query("DELETE FROM users WHERE id = ANY($1)", [userIds]);
  await pool().end();
});

async function loggedIn(): Promise<{ cookie: string; token: string }> {
  await ensureMigrated();
  const uname = `logout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uid = String((await query<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'Test') RETURNING id", [uname]))[0]!.id);
  userIds.push(uid);
  const { token } = await createSession(uid);
  return { cookie: `${SESSION_COOKIE}=${token}`, token };
}

async function revoked(uidCookie: string): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const token = uidCookie.split("=")[1]!;
  const hash = createHash("sha256").update(token).digest("hex");
  const rows = await query<{ revoked_at: Date | null }>("SELECT revoked_at FROM sessions WHERE token_hash = $1", [hash]);
  assert.equal(rows.length, 1, "sessiya qatori topilmadi (xesh sxemasi o'zgargan?)");
  return rows[0]!.revoked_at !== null;
}

async function logout(headers: Record<string, string>, qs = "") {
  const req = new Request(`http://localhost:3000/api/auth/session${qs}`, {
    method: "DELETE",
    headers: { host: "localhost:3000", ...headers },
  });
  return inRouteRequest(req, () => route.DELETE(req));
}

test("chiqish: begona Origin — 403, sessiya tirik, cookie o'chirilmaydi", { skip }, async () => {
  const { cookie } = await loggedIn();
  const { result, setCookies } = await logout({ cookie, origin: "https://evil.example" });
  assert.equal(result.status, 403, "MUTATSIYA: logout CSRF — begona sayt chiqarib yubordi");
  assert.equal(await revoked(cookie), false);
  assert.equal(setCookies.length, 0);
});

test("chiqish: Origin'siz, lekin `Sec-Fetch-Site: cross-site` — 403", { skip }, async () => {
  const { cookie } = await loggedIn();
  const { result } = await logout({ cookie, "sec-fetch-site": "cross-site" });
  assert.equal(result.status, 403);
  assert.equal(await revoked(cookie), false);
});

test("chiqish: `?all=1` ham begona Origin bilan — 403", { skip }, async () => {
  const { cookie } = await loggedIn();
  const { result } = await logout({ cookie, origin: "https://evil.example" }, "?all=1");
  assert.equal(result.status, 403);
  assert.equal(await revoked(cookie), false);
});

test("chiqish: o'z sahifamizdan — 200, sessiya bekor, cookie tozalanadi", { skip }, async () => {
  const { cookie } = await loggedIn();
  const { result, setCookies } = await logout({ cookie, origin: "http://localhost:3000", "sec-fetch-site": "same-origin" });
  assert.equal(result.status, 200);
  assert.equal(await revoked(cookie), true);
  assert.ok(setCookies.some((c) => c.startsWith(`${SESSION_COOKIE}=;`)), `cookie tozalanmadi: ${setCookies.join(" | ")}`);
});
