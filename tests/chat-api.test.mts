import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { cid, mkUser, stubLlm, wallet } from "./helpers/chat-fixtures.mts";

/**
 * `/api/chat`, `/api/chat/confirm`, `/api/chat/cancel` (owner request 8): login required, CSRF, input checks, the
 * confirm route's status codes. Real Postgres; the model is stubbed at the service level (the routes call the real
 * `llm-roles.complete`, which has no provider key here and so answers `null`).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "https://slaydx.test";
process.env.WORKER_INLINE = "false";
for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "LLM_FAST"]) delete process.env[k];
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("chatapi") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

test("chat API routes", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const chat = await import("../lib/server/chat/service.ts");
  const root = await import("../app/api/chat/route.ts");
  const confirmRoute = await import("../app/api/chat/confirm/route.ts");
  const cancelRoute = await import("../app/api/chat/cancel/route.ts");
  await migrate();
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 20, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const login = async (opts: { balance?: number } = {}) => {
    const uid = await mkUser(query, opts);
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  async function call(handler: (r: Request) => Promise<Response>, url: string, method: string, cookie: string | null, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", ...extra };
    if (cookie) headers.cookie = cookie;
    const req = new Request(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const res = await inRequest(req, () => handler(req));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
  const gens = async (uid: string) => Number((await query<{ n: string }>("SELECT count(*) AS n FROM generations WHERE user_id = $1", [uid]))[0]!.n);

  await t.test("login is required on all three routes", async () => {
    assert.equal((await call(root.GET, "/api/chat", "GET", null)).status, 401);
    assert.equal((await call(root.POST, "/api/chat", "POST", null, { text: "x", clientId: cid() })).status, 401);
    assert.equal((await call(confirmRoute.POST, "/api/chat/confirm", "POST", null, { token: "x", hash: "y" })).status, 401);
    assert.equal((await call(cancelRoute.POST, "/api/chat/cancel", "POST", null, { token: "x" })).status, 401);
  });

  await t.test("a cross-site POST is refused (CSRF)", async () => {
    const u = await login();
    const r = await call(root.POST, "/api/chat", "POST", u.cookie, { text: "x", clientId: cid() }, { "sec-fetch-site": "cross-site", origin: "https://evil.example" });
    assert.equal(r.status, 403);
  });

  await t.test("GET: status with 'Bugun tekin' and an empty history", async () => {
    const u = await login({ balance: 700 });
    const r = await call(root.GET, "/api/chat", "GET", u.cookie);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.status, { enabled: true, freeLimit: 10, freeUsed: 0, freeLeft: 10, pricePerMessage: 100, balance: 700 });
    assert.deepEqual(r.body.messages, []);
  });

  await t.test("POST input checks: 400 for an empty text or a bad client id", async () => {
    const u = await login();
    assert.equal((await call(root.POST, "/api/chat", "POST", u.cookie, { text: "  ", clientId: cid() })).status, 400);
    assert.equal((await call(root.POST, "/api/chat", "POST", u.cookie, { text: "salom", clientId: "x" })).status, 400);
    assert.equal((await call(root.POST, "/api/chat", "POST", u.cookie, { text: "salom" })).status, 400);
  });

  await t.test("no model answer: 503 with a clear message, nothing stored, free count untouched", async (tt) => {
    tt.mock.method(console, "warn", () => {});
    tt.mock.method(console, "error", () => {});
    tt.mock.method(console, "log", () => {});
    const u = await login();
    const r = await call(root.POST, "/api/chat", "POST", u.cookie, { text: "salom", clientId: cid() });
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.code, "no_answer");
    const g = await call(root.GET, "/api/chat", "GET", u.cookie);
    assert.equal((g.body.status as { freeLeft: number }).freeLeft, 10);
    assert.deepEqual(g.body.messages, []);
  });

  await t.test("confirm route: 202 once, then 409 used; a foreign account gets 400; cancel makes it 409", async () => {
    const owner = await login({ balance: 20_000 });
    const other = await login({ balance: 20_000 });
    const llm = stubLlm([
      { reply: "Mana:", propose: { tool: "slide", values: { topic: "Suv", slideCount: 10 } } },
      { reply: "Mana:", propose: { tool: "slide", values: { topic: "Havo" } } },
    ]);
    const mk = async () => {
      const r = await chat.sendChatMessage({ userId: owner.uid, channel: "web", text: "slayd qil", clientId: cid() }, { complete: llm.complete });
      return r.reply.card as { token: string; hash: string; price: number };
    };
    const card = await mk();
    const foreign = await call(confirmRoute.POST, "/api/chat/confirm", "POST", other.cookie, { token: card.token, hash: card.hash });
    assert.equal(foreign.status, 400);
    assert.equal(foreign.body.code, "invalid");
    assert.equal(await gens(other.uid), 0);
    const bad = await call(confirmRoute.POST, "/api/chat/confirm", "POST", owner.cookie, { token: card.token, hash: "0000000000000000" });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.code, "tampered");
    const ok = await call(confirmRoute.POST, "/api/chat/confirm", "POST", owner.cookie, { token: card.token, hash: card.hash });
    assert.equal(ok.status, 202, JSON.stringify(ok.body));
    assert.equal(ok.body.status, "QUEUED");
    assert.equal(ok.body.price, 3000);
    assert.equal((await wallet(query, owner.uid)).total, 17_000);
    const again = await call(confirmRoute.POST, "/api/chat/confirm", "POST", owner.cookie, { token: card.token, hash: card.hash });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "used");
    assert.equal(await gens(owner.uid), 1);

    const card2 = await mk();
    assert.equal((await call(cancelRoute.POST, "/api/chat/cancel", "POST", owner.cookie, { token: card2.token })).body.ok, true);
    const after = await call(confirmRoute.POST, "/api/chat/confirm", "POST", owner.cookie, { token: card2.token, hash: card2.hash });
    assert.equal(after.status, 409);
    assert.equal(await gens(owner.uid), 1);
    // The history GET shows both cards with their states.
    const hist = await call(root.GET, "/api/chat", "GET", owner.cookie);
    const states = (hist.body.messages as Array<{ card?: { state?: string } }>).filter((m) => m.card).map((m) => m.card!.state);
    assert.deepEqual(states, ["used", "used"]);
  });

  await t.test("confirm route: 402 with a top-up link when the wallet is short; 400 for a missing token", async () => {
    const u = await login({ balance: 500 });
    const llm = stubLlm([{ reply: "Mana:", propose: { tool: "slide", values: { topic: "Suv" } } }]);
    const r = await chat.sendChatMessage({ userId: u.uid, channel: "web", text: "slayd", clientId: cid() }, { complete: llm.complete });
    const card = r.reply.card as { token: string; hash: string };
    const short = await call(confirmRoute.POST, "/api/chat/confirm", "POST", u.cookie, { token: card.token, hash: card.hash });
    assert.equal(short.status, 402);
    assert.equal(short.body.required, 3000);
    assert.equal(short.body.available, 500);
    assert.equal(short.body.topUp, "https://slaydx.test/uz/wallet");
    assert.equal((await call(confirmRoute.POST, "/api/chat/confirm", "POST", u.cookie, { hash: card.hash })).status, 400);
    assert.equal(await gens(u.uid), 0);
  });
});
