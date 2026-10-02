import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Admin moderation of public game content through the REAL routes
 * (docs/admin/02-plan.md §6.8, §8, §10 T5/T6) on a throwaway Postgres.
 * Links are created by the real `createGameSession`, results by the real
 * `addResult`, and the revoke test calls the REAL public route
 * (`app/api/o/[token]/route.ts`) before and after.
 *
 * Mutation checks (each made the named assertion fail, then restored):
 *   - revoke UPDATE writing `expires_at = now() + interval '1 day'` → "public
 *     route answers 404 after revoke" fails;
 *   - dropping the `active` check in `revokeLink` → "second revoke is 409 and
 *     writes no audit row" fails (2 audit rows);
 *   - preview built without `{ seed: token }` → "preview equals the public
 *     route's game" fails (different option order / item ids);
 *   - `auditRow` missing `answers` → "before holds the full deleted row" fails;
 *   - bulk delete writing one audit row for the whole batch → "one audit row
 *     per id" fails;
 *   - dropping the `rows.length !== ids.length` check → "bulk delete with a
 *     missing id is 404 and deletes nothing" fails;
 *   - `likePrefix(...)` replaced by `%${q}%` → "q is a prefix, not a
 *     substring" and "q LIKE metacharacters are literal" fail;
 *   - `moderation.act` permission on revoke changed to `moderation.view` →
 *     "support cannot act" fails (200 instead of 403).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-moderation-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";

const iso = hasDb ? await createIsolatedDb("adminmod") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const jobs = await import("../lib/server/jobs.ts");
const { createGameSession, addResult } = await import("../lib/server/game-sessions.ts");
const { publicGameView } = await import("../lib/game/public.ts");
const { sampleGameDoc } = await import("../lib/generation/games/samples.ts");
const { sampleTeacherDoc } = await import("../lib/generation/teacher/samples.ts");
const publicRoute = await import("../app/api/o/[token]/route.ts");
const routes = {
  list: await import("../app/api/admin/moderation/game-links/route.ts"),
  detail: await import("../app/api/admin/moderation/game-links/[id]/route.ts"),
  revoke: await import("../app/api/admin/moderation/game-links/[id]/revoke/route.ts"),
  delOne: await import("../app/api/admin/moderation/game-results/[id]/delete/route.ts"),
  delMany: await import("../app/api/admin/moderation/game-results/delete/route.ts"),
};

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb) await ensureMigrated();

// ───────────────────────────── fixtures

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type TestUser = { id: string; userToken: string };
type TestAdmin = TestUser & { adminId: string };
type Session = { cookie: string; admin: TestAdmin };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Mod Test"): Promise<TestUser> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, $3, 0, 0, 0) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `m_${randomBytes(5).toString("hex")}`, name],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, userToken: token };
}

async function session(role: Role): Promise<Session> {
  const u = await mkUser();
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc)
     VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const admin: TestAdmin = { ...u, adminId: acc!.id };
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.userToken)]);
  const s = await transaction((client) =>
    createAdminSession(client, { adminId: admin.adminId, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "mod-test", reauth: false }),
  );
  return { cookie: `${SESSION_COOKIE}=${u.userToken}; ${adminCookieName()}=${s.token}`, admin };
}

type Result = { status: number; body: Record<string, unknown> };

async function parse(res: Response): Promise<Result> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

const BASE = "http://localhost:3000/api/admin/moderation";
const headersOf = (cookie: string | null, origin = true): Record<string, string> => {
  const h: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.5", "user-agent": "mod-test", "content-type": "application/json" };
  if (cookie) h.cookie = cookie;
  if (origin) h.origin = "http://localhost:3000";
  return h;
};

async function get(which: "list" | "detail", cookie: string | null, opts: { id?: string; qs?: string } = {}): Promise<Result> {
  const url = which === "list" ? `${BASE}/game-links${opts.qs ?? ""}` : `${BASE}/game-links/${encodeURIComponent(opts.id!)}`;
  const req = new Request(url, { method: "GET", headers: headersOf(cookie, false) });
  const res = await inRequest(req, () =>
    which === "list" ? routes.list.GET(req, undefined) : routes.detail.GET(req, { params: Promise.resolve({ id: opts.id! }) }),
  );
  return parse(res);
}

async function post(
  which: "revoke" | "delOne" | "delMany",
  cookie: string | null,
  id: string | null,
  body: unknown,
  opts: { origin?: boolean } = {},
): Promise<Result> {
  const url =
    which === "revoke" ? `${BASE}/game-links/${encodeURIComponent(id!)}/revoke` : which === "delOne" ? `${BASE}/game-results/${encodeURIComponent(id!)}/delete` : `${BASE}/game-results/delete`;
  const req = new Request(url, { method: "POST", headers: headersOf(cookie, opts.origin !== false), body: JSON.stringify(body) });
  const res = await inRequest(req, () => {
    if (which === "revoke") return routes.revoke.POST(req, { params: Promise.resolve({ id: id! }) });
    if (which === "delOne") return routes.delOne.POST(req, { params: Promise.resolve({ id: id! }) });
    return routes.delMany.POST(req, undefined);
  });
  return parse(res);
}

async function publicGet(token: string): Promise<Result> {
  const req = new Request(`http://localhost:3000/api/o/${token}`, { method: "GET", headers: { host: "localhost:3000" } });
  return parse(await publicRoute.GET(req, { params: Promise.resolve({ token }) }));
}

/** A COMPLETED generation with a game document, then a REAL game session on it. */
async function mkLink(
  owner: TestUser,
  kind: "quiz" | "crossword" | "flashcards" | "sorting" | "listening",
  topic: string,
  opts: { status?: string; docless?: boolean } = {},
): Promise<{ id: string; token: string; generationId: string }> {
  const toolId = kind === "quiz" ? "test" : kind;
  const enq = await jobs.enqueueGeneration({
    userId: owner.id,
    toolId,
    topic,
    price: 0,
    format: "docx",
    values: { topic } as never,
    budgetMs: 60_000,
  });
  assert.ok(enq.ok, `enqueue: ${JSON.stringify(enq)}`);
  const doc = kind === "quiz" ? sampleTeacherDoc("test") : sampleGameDoc(kind);
  await query(`UPDATE generations SET status = $2, doc_json = $3::jsonb WHERE id = $1`, [
    enq.id,
    opts.status ?? "COMPLETED",
    opts.docless ? null : JSON.stringify(doc),
  ]);
  const s = await createGameSession(enq.id, owner.id, kind, {});
  assert.ok(s, "createGameSession returned null");
  return { id: s!.id, token: s!.token, generationId: enq.id };
}

async function mkResult(sessionId: string, name: string, score = 3, total = 5): Promise<string> {
  const r = await addResult({ sessionId, playerName: name, score, total, seconds: 42, answers: { q1: true, q2: false } });
  return r.id;
}

const audits = (adminId: string, action: string) =>
  query<{ outcome: string; target_id: string | null; target_type: string | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; meta: Record<string, unknown> | null }>(
    `SELECT outcome, target_id, target_type, reason, before, after, meta FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id`,
    [adminId, action],
  );
const resultExists = async (id: string) => Boolean(await queryOne(`SELECT 1 FROM game_results WHERE id = $1`, [id]));

const REASON = { reason: "Mavzuda noo'rin so'z topildi" };

// Shared dataset for the list tests: one owner, several kinds and topics.
const ownerA = hasDb ? await mkUser("Alisher Egasi") : ({ id: "0", userToken: "" } as TestUser);
const ownerB = hasDb ? await mkUser("Bahrom Egasi") : ({ id: "0", userToken: "" } as TestUser);
const L = hasDb
  ? {
      quiz: await mkLink(ownerA, "quiz", "Zoologiya testi"),
      crossword: await mkLink(ownerA, "crossword", "Zebra va ot"),
      cards: await mkLink(ownerB, "flashcards", "100% foiz_belgisi"),
      sorting: await mkLink(ownerB, "sorting", "Hayvonlar"),
      listening: await mkLink(ownerB, "listening", "Shahar joylari"),
    }
  : ({} as Record<string, { id: string; token: string; generationId: string }>);
if (hasDb) {
  // Spread the creation times so the keyset order is deterministic, and kill one link.
  const order = [L.quiz, L.crossword, L.cards, L.sorting, L.listening];
  for (let i = 0; i < order.length; i++) {
    await query(`UPDATE game_sessions SET created_at = now() - ($2 || ' hours')::interval WHERE id = $1`, [order[i].id, String((order.length - i) * 5)]);
  }
  await query(`UPDATE game_sessions SET created_at = '2026-03-15T08:00:00Z' WHERE id = $1`, [L.cards.id]);
  await query(`UPDATE game_sessions SET created_at = '2026-03-15T19:30:00Z' WHERE id = $1`, [L.sorting.id]);
  await query(`UPDATE game_sessions SET expires_at = now() - interval '1 hour' WHERE id = $1`, [L.listening.id]);
  await mkResult(L.quiz.id, "Aziz", 4, 5);
  await mkResult(L.quiz.id, "Malika", 5, 5);
  await mkResult(L.crossword.id, "<img src=x onerror=alert(1)>", 1, 5);
}

// ───────────────────────────── list

test("list: exact item shape, newest first, result counts, active mirrors the public rule", { skip }, async () => {
  const s = await session("moderator");
  const r = await get("list", s.cookie, { qs: `?userId=${ownerA.id}` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ["items", "nextCursor", "total", "totalCapped"]);
  const items = r.body.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);
  // `crossword` was created later than `quiz`.
  assert.deepEqual(
    items.map((i) => i.topic),
    ["Zebra va ot", "Zoologiya testi"],
  );
  const first = items[0];
  assert.deepEqual(Object.keys(first).sort(), ["active", "createdAt", "expiresAt", "generationId", "id", "kind", "results", "topic", "userId", "userName"]);
  assert.equal(first.id, L.crossword.id);
  assert.equal(first.generationId, L.crossword.generationId);
  assert.equal(first.userId, ownerA.id);
  assert.equal(first.userName, "Alisher Egasi");
  assert.equal(first.kind, "crossword");
  assert.equal(first.active, true);
  assert.equal(first.results, 1);
  assert.equal(items[1].results, 2);
  assert.equal(r.body.total, 2);
  assert.equal(r.body.totalCapped, false);
  assert.ok(!JSON.stringify(r.body).includes(L.crossword.token), "the token must never be listed");
  assert.ok(!JSON.stringify(r.body).includes("doc_json"), "no wide columns");

  const all = await get("list", s.cookie);
  const dead = (all.body.items as Array<Record<string, unknown>>).find((i) => i.id === L.listening.id)!;
  assert.equal(dead.active, false, "expires_at in the past = dead, as the public route treats it");
});

test("list: filters active, kind, userId, date range", { skip }, async () => {
  const s = await session("support"); // support has moderation.view
  const ids = async (qs: string) => ((await get("list", s.cookie, { qs })).body.items as Array<{ id: string }>).map((i) => i.id).sort();
  assert.deepEqual(await ids("?active=0"), [L.listening.id]);
  const act = await ids("?active=1");
  assert.ok(!act.includes(L.listening.id) && act.includes(L.quiz.id));
  assert.deepEqual(await ids("?kind=sorting"), [L.sorting.id]);
  assert.deepEqual(await ids(`?userId=${ownerB.id}&active=1`), [L.cards.id, L.sorting.id].sort());
  // Tashkent calendar days: `cards` = 2026-03-15 13:00 (+05), `sorting` = 2026-03-16 00:30 (+05) = 2026-03-15 19:30 UTC.
  assert.deepEqual(await ids("?from=2026-03-15&to=2026-03-15"), [L.cards.id]);
  assert.deepEqual(await ids("?from=2026-03-16&to=2026-03-16"), [L.sorting.id]);
  assert.deepEqual(await ids("?from=2026-03-15&to=2026-03-16"), [L.cards.id, L.sorting.id].sort());
  assert.deepEqual(await ids("?from=2026-03-14&to=2026-03-14"), []);
  const future = await get("list", s.cookie, { qs: "?from=2099-01-01&to=2099-01-02" });
  assert.equal(future.status, 200);
  assert.deepEqual(future.body.items, []);
  const past = await get("list", s.cookie, { qs: "?from=2000-01-01&to=2000-01-02" });
  assert.deepEqual(past.body.items, []);
});

test("list: q is a case-insensitive topic prefix, not a substring; LIKE metacharacters are literal", { skip }, async () => {
  const s = await session("moderator");
  const topics = async (q: string) => ((await get("list", s.cookie, { qs: `?q=${encodeURIComponent(q)}` })).body.items as Array<{ topic: string }>).map((i) => i.topic).sort();
  assert.deepEqual(await topics("zoo"), ["Zoologiya testi"]);
  assert.deepEqual(await topics("ZEB"), ["Zebra va ot"]);
  assert.deepEqual(await topics("z"), ["Zebra va ot", "Zoologiya testi"]);
  assert.deepEqual(await topics("ologiya"), [], "a substring must not match");
  // `%` and `_` are escaped: only the topic that literally starts with "100%" matches.
  assert.deepEqual(await topics("100%"), ["100% foiz_belgisi"]);
  assert.deepEqual(await topics("%"), [], "a bare % is literal, not a wildcard");
  assert.deepEqual(await topics("_"), []);
  assert.deepEqual(await topics("' OR 1=1 --"), []);
  assert.deepEqual(await topics("a'; DROP TABLE game_sessions; --"), []);
  assert.ok(Number((await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM game_sessions`))!.n) >= 5, "the table survived");
  // 100 characters pass, 101 do not.
  assert.equal((await get("list", s.cookie, { qs: `?q=${"a".repeat(100)}` })).status, 200);
  assert.equal((await get("list", s.cookie, { qs: `?q=${"a".repeat(101)}` })).status, 400);
});

test("list: bad input is 400, never 500", { skip }, async () => {
  const s = await session("moderator");
  for (const qs of [
    "?limit=0",
    "?limit=101",
    "?limit=abc",
    "?cursor=not-a-cursor",
    "?kind=audio",
    "?active=2",
    "?userId=abc",
    "?userId=-1",
    "?sort=created_asc",
    "?sort=constructor",
    "?sort=created_desc;DROP TABLE users",
    "?from=2026-13-01",
    "?from=2026-02-01&to=2026-01-01",
    "?from=2020-01-01&to=2026-01-01",
    "?q=a&q=b",
    "?kind=quiz&kind=sorting",
  ]) {
    const r = await get("list", s.cookie, { qs });
    assert.equal(r.status, 400, `${qs} → ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(typeof r.body.error, "string");
  }
});

test("list: keyset paging walks every row once", { skip }, async () => {
  const s = await session("moderator");
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r: Result = await get("list", s.cookie, { qs: `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` });
    assert.equal(r.status, 200);
    for (const i of r.body.items as Array<{ id: string }>) seen.push(i.id);
    cursor = (r.body.nextCursor as string | null) ?? null;
    pages++;
  } while (cursor && pages < 100);
  const total = Number((await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM game_sessions`))!.n);
  assert.equal(new Set(seen).size, seen.length, "no duplicates across pages");
  assert.equal(seen.length, total);
  assert.ok(pages >= 3);
  // Forged cursors are rejected.
  const bad = Buffer.from(JSON.stringify(["2026-01-01T00:00:00.000000", "not-a-uuid"])).toString("base64url");
  assert.equal((await get("list", s.cookie, { qs: `?cursor=${bad}` })).status, 400);
});

// ───────────────────────────── detail

test("detail: link + the exact public preview + results; the token never leaves the server", { skip }, async () => {
  const s = await session("support");
  for (const [name, l] of Object.entries({ quiz: L.quiz, crossword: L.crossword, cards: L.cards, sorting: L.sorting, listening: L.listening })) {
    // A dead link still shows its preview to the admin; check the live ones against the public route.
    const r = await get("detail", s.cookie, { id: l.id });
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(Object.keys(r.body).sort(), ["link", "preview", "results"]);
    assert.ok(r.body.preview, `${name}: preview missing`);
    assert.ok(!JSON.stringify(r.body).includes(l.token), `${name}: token leaked`);
    if (l !== L.listening) {
      const pub = await publicGet(l.token);
      assert.equal(pub.status, 200);
      assert.deepEqual(r.body.preview, pub.body.game, `${name}: preview equals the public route's game`);
    }
  }
  const r = await get("detail", s.cookie, { id: L.quiz.id });
  const link = r.body.link as Record<string, unknown>;
  assert.equal(link.id, L.quiz.id);
  assert.equal(link.results, 2);
  const results = r.body.results as Array<Record<string, unknown>>;
  assert.equal(results.length, 2);
  assert.deepEqual(Object.keys(results[0]).sort(), ["createdAt", "id", "playerName", "score", "total"]);
  assert.deepEqual(results.map((x) => x.playerName).sort(), ["Aziz", "Malika"]);
  // Answers are stripped: no field named like a key or correct flag in the preview.
  const text = JSON.stringify((r.body.preview as Record<string, unknown>));
  for (const forbidden of ['"answer"', '"correct"', '"explanation"', '"solution"']) assert.ok(!text.includes(forbidden), forbidden);
  // The same builder as the public route.
  const row = await queryOne<{ doc_json: never }>(`SELECT doc_json FROM generations WHERE id = $1`, [L.quiz.generationId]);
  assert.deepEqual(r.body.preview, JSON.parse(JSON.stringify(publicGameView(row!.doc_json, "quiz", { seed: L.quiz.token }))));
  // Player names are returned as plain data (React escapes them in the UI).
  const xss = await get("detail", s.cookie, { id: L.crossword.id });
  assert.equal(((xss.body.results as Array<{ playerName: string }>)[0]).playerName, "<img src=x onerror=alert(1)>");
});

test("detail: preview is null when the job is not COMPLETED or has no document; 200 results cap; 404s", { skip }, async () => {
  const s = await session("moderator");
  const owner = await mkUser();
  const notDone = await mkLink(owner, "sorting", "Tayyor emas", { status: "COMPLETED", docless: true });
  const r0 = await get("detail", s.cookie, { id: notDone.id });
  assert.equal(r0.status, 200);
  assert.equal(r0.body.preview, null);
  await query(`UPDATE generations SET doc_json = $2::jsonb WHERE id = $1`, [notDone.generationId, JSON.stringify(sampleGameDoc("sorting"))]);
  await query(`UPDATE generations SET status = 'FAILED' WHERE id = $1`, [notDone.generationId]);
  assert.equal((await get("detail", s.cookie, { id: notDone.id })).body.preview, null);
  assert.equal((await publicGet(notDone.token)).status, 404, "the public route agrees");

  const busy = await mkLink(owner, "flashcards", "Ko'p natija");
  await query(
    `INSERT INTO game_results (id, session_id, player_name, score, total, seconds, created_at)
     SELECT gen_random_uuid(), $1, 'O''yinchi ' || g, 1, 2, 3, now() - (g || ' seconds')::interval FROM generate_series(1, 205) g`,
    [busy.id],
  );
  const r = await get("detail", s.cookie, { id: busy.id });
  assert.equal((r.body.results as unknown[]).length, 200);
  assert.equal((r.body.link as { results: number }).results, 205);
  assert.equal(((r.body.results as Array<{ playerName: string }>)[0]).playerName, "O'yinchi 1", "newest first");

  assert.equal((await get("detail", s.cookie, { id: randomUUID() })).status, 404);
  for (const bad of ["abc", "1", "../x", "00000000-0000-0000-0000-00000000000g"]) {
    const x = await get("detail", s.cookie, { id: bad });
    assert.equal(x.status, 404, bad);
    assert.equal(x.body.code, "not_found");
  }
});

// ───────────────────────────── revoke

test("revoke: public route answers 404 afterwards; one audit row with before/after expires_at", { skip }, async () => {
  const s = await session("moderator");
  const owner = await mkUser();
  const l = await mkLink(owner, "crossword", "Bekor qilinadigan havola");
  assert.equal((await publicGet(l.token)).status, 200, "alive before");
  const before = await queryOne<{ expires_at: Date }>(`SELECT expires_at FROM game_sessions WHERE id = $1`, [l.id]);

  const r = await post("revoke", s.cookie, l.id, REASON);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body), ["link"]);
  const link = r.body.link as Record<string, unknown>;
  assert.equal(link.id, l.id);
  assert.equal(link.active, false);
  assert.ok(new Date(link.expiresAt as string).getTime() <= Date.now());

  const pub = await publicGet(l.token);
  assert.equal(pub.status, 404, "the public route treats the revoked link as dead");

  const a = await audits(s.admin.adminId, "moderation.revoke");
  assert.equal(a.length, 1);
  assert.equal(a[0].outcome, "ok");
  assert.equal(a[0].target_type, "game_session");
  assert.equal(a[0].target_id, l.id);
  assert.equal(a[0].reason, REASON.reason);
  assert.deepEqual(a[0].before, { expiresAt: before!.expires_at.toISOString(), active: true });
  assert.equal(a[0].after!.active, false);
  assert.equal(a[0].after!.expiresAt, link.expiresAt);
  assert.ok(!JSON.stringify(a[0]).includes(l.token), "the token is never audited");
});

test("revoke: second revoke is 409 and writes no audit row; expired-by-time link also 409", { skip }, async () => {
  const s = await session("admin");
  const owner = await mkUser();
  const l = await mkLink(owner, "sorting", "Ikki marta");
  assert.equal((await post("revoke", s.cookie, l.id, REASON)).status, 200);
  const again = await post("revoke", s.cookie, l.id, REASON);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "state");
  assert.equal((await audits(s.admin.adminId, "moderation.revoke")).length, 1);

  const old = await mkLink(owner, "flashcards", "Muddati o'tgan");
  await query(`UPDATE game_sessions SET expires_at = now() - interval '2 days' WHERE id = $1`, [old.id]);
  const exp = await post("revoke", s.cookie, old.id, REASON);
  assert.equal(exp.status, 409);
  assert.equal((await audits(s.admin.adminId, "moderation.revoke")).length, 1);
  const expAfter = await queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM game_sessions WHERE id = $1 AND expires_at < now() - interval '1 day'`, [old.id]);
  assert.equal(expAfter!.n, "1", "an already dead link is left untouched");

  // A NULL expiry (never expires) is active and revocable.
  const forever = await mkLink(owner, "listening", "Muddatsiz");
  await query(`UPDATE game_sessions SET expires_at = NULL WHERE id = $1`, [forever.id]);
  assert.equal((await publicGet(forever.token)).status, 200);
  const rf = await post("revoke", s.cookie, forever.id, REASON);
  assert.equal(rf.status, 200);
  assert.deepEqual((await audits(s.admin.adminId, "moderation.revoke")).at(-1)!.before, { expiresAt: null, active: true });
  assert.equal((await publicGet(forever.token)).status, 404);
});

test("revoke: reason required (400), unknown / malformed id (404), missing Origin (403)", { skip }, async () => {
  const s = await session("moderator");
  const owner = await mkUser();
  const l = await mkLink(owner, "quiz", "Sababsiz");
  for (const body of [{}, { reason: "" }, { reason: "abc" }, { reason: "x".repeat(501) }, { reason: 5 }, { reason: null }]) {
    const r = await post("revoke", s.cookie, l.id, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await post("revoke", s.cookie, l.id, [])).status, 400, "an array body is not an object");
  assert.equal((await post("revoke", s.cookie, randomUUID(), REASON)).status, 404);
  assert.equal((await post("revoke", s.cookie, "not-a-uuid", REASON)).status, 404);
  assert.equal((await post("revoke", s.cookie, l.id, REASON, { origin: false })).status, 403);
  assert.equal((await audits(s.admin.adminId, "moderation.revoke")).length, 0, "no refusal is audited as ok");
  assert.equal((await publicGet(l.token)).status, 200, "still alive");
});

// ───────────────────────────── delete one

test("delete result: row gone, audit `before` holds the full deleted row, repeat is 404", { skip }, async () => {
  const s = await session("moderator");
  const owner = await mkUser();
  const l = await mkLink(owner, "quiz", "Natija o'chirish");
  const rid = (await addResult({ sessionId: l.id, submissionId: randomUUID(), playerName: "Yomon ism", score: 2, total: 5, seconds: 61, answers: { a: true, b: false }, ipHash: "abcd1234" })).id;
  const keep = await mkResult(l.id, "Yaxshi ism");
  const full = await queryOne<Record<string, unknown>>(
    `SELECT id::text AS id, session_id::text AS session_id, player_name, score, total, seconds, answers_json, ip_hash, submission_id, created_at FROM game_results WHERE id = $1`,
    [rid],
  );

  const r = await post("delOne", s.cookie, rid, REASON);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true });
  assert.ok(!(await resultExists(rid)));
  assert.ok(await resultExists(keep), "other results stay");

  const a = await audits(s.admin.adminId, "moderation.result.delete");
  assert.equal(a.length, 1);
  assert.equal(a[0].target_type, "game_result");
  assert.equal(a[0].target_id, rid);
  assert.equal(a[0].reason, REASON.reason);
  assert.equal(a[0].after, null);
  assert.deepEqual(a[0].before, {
    id: rid,
    sessionId: l.id,
    playerName: "Yomon ism",
    score: 2,
    total: 5,
    seconds: 61,
    answers: { a: true, b: false },
    ipHash: "abcd1234",
    submissionId: full!.submission_id,
    createdAt: (full!.created_at as Date).toISOString(),
  });
  assert.deepEqual(a[0].meta, { sessionId: l.id });

  const again = await post("delOne", s.cookie, rid, REASON);
  assert.equal(again.status, 404);
  assert.equal((await audits(s.admin.adminId, "moderation.result.delete")).length, 1);
  assert.equal((await post("delOne", s.cookie, "nope", REASON)).status, 404);
  assert.equal((await post("delOne", s.cookie, keep, { reason: "ab" })).status, 400);
  assert.ok(await resultExists(keep));
});

// ───────────────────────────── delete many

test("bulk delete: one audit row PER id with the full row, all in one go", { skip }, async () => {
  const s = await session("owner");
  const owner = await mkUser();
  const l = await mkLink(owner, "flashcards", "Ommaviy o'chirish");
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) ids.push(await mkResult(l.id, `Ism ${i}`, i, 12));
  const keep = await mkResult(l.id, "Qoladi");

  const r = await post("delMany", s.cookie, null, { ids: ids.map((x, i) => (i % 2 ? x.toUpperCase() : x)), reason: REASON.reason });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, deleted: 12 });
  for (const id of ids) assert.ok(!(await resultExists(id)));
  assert.ok(await resultExists(keep));

  const a = await audits(s.admin.adminId, "moderation.result.delete");
  assert.equal(a.length, 12, "one audit row per id");
  assert.deepEqual(a.map((x) => x.target_id).sort(), [...ids].sort());
  for (const row of a) {
    assert.equal(row.reason, REASON.reason);
    const b = row.before as Record<string, unknown>;
    assert.equal(b.sessionId, l.id);
    assert.deepEqual(Object.keys(b).sort(), ["answers", "createdAt", "id", "ipHash", "playerName", "score", "seconds", "sessionId", "submissionId", "total"]);
    assert.deepEqual(row.meta, { sessionId: l.id, bulk: true, count: 12 });
  }
  // Duplicated ids in one request collapse to one delete / one audit row.
  const x = await mkResult(l.id, "Takror");
  const dup = await post("delMany", s.cookie, null, { ids: [x, x, x.toUpperCase()], reason: REASON.reason });
  assert.deepEqual(dup.body, { ok: true, deleted: 1 });
  assert.equal((await audits(s.admin.adminId, "moderation.result.delete")).length, 13);
});

test("bulk delete with a missing id is 404 listing it and deletes nothing, writes no audit rows", { skip }, async () => {
  const s = await session("moderator");
  const owner = await mkUser();
  const l = await mkLink(owner, "sorting", "Yo'q id");
  const a = await mkResult(l.id, "A");
  const b = await mkResult(l.id, "B");
  const ghost = randomUUID();
  const r = await post("delMany", s.cookie, null, { ids: [a, ghost, b], reason: REASON.reason });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, "not_found");
  assert.deepEqual(r.body.missing, [ghost]);
  assert.ok((await resultExists(a)) && (await resultExists(b)), "nothing was deleted");
  assert.equal((await audits(s.admin.adminId, "moderation.result.delete")).length, 0);
});

test("bulk delete validation: ids 1..100 UUIDs, reason required", { skip }, async () => {
  const s = await session("moderator");
  const owner = await mkUser();
  const l = await mkLink(owner, "listening", "Tekshiruv");
  const a = await mkResult(l.id, "A");
  const bad: unknown[] = [
    { reason: REASON.reason },
    { ids: [], reason: REASON.reason },
    { ids: "x", reason: REASON.reason },
    { ids: [a], reason: "" },
    { ids: [a] },
    { ids: [a, "not-a-uuid"], reason: REASON.reason },
    { ids: [a, 5], reason: REASON.reason },
    { ids: [a, null], reason: REASON.reason },
    { ids: Array.from({ length: 101 }, () => randomUUID()), reason: REASON.reason },
    { ids: [{ id: a }], reason: REASON.reason },
  ];
  for (const body of bad) {
    const r = await post("delMany", s.cookie, null, body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
  // Exactly 100 is accepted (all ghosts → 404 with 100 missing, not 400).
  const hundred = Array.from({ length: 100 }, () => randomUUID());
  const r = await post("delMany", s.cookie, null, { ids: hundred, reason: REASON.reason });
  assert.equal(r.status, 404);
  assert.equal((r.body.missing as string[]).length, 100);
  assert.ok(await resultExists(a));
  assert.equal((await post("delMany", s.cookie, null, { ids: [a], reason: REASON.reason }, { origin: false })).status, 403);
});

test("deleting the last results of a link keeps the link; revoked links keep their results until deleted", { skip }, async () => {
  const s = await session("moderator");
  const owner = await mkUser();
  const l = await mkLink(owner, "quiz", "Havola qoladi");
  const a = await mkResult(l.id, "A");
  await post("delOne", s.cookie, a, REASON);
  const r = await get("detail", s.cookie, { id: l.id });
  assert.equal((r.body.link as { results: number }).results, 0);
  assert.deepEqual(r.body.results, []);
});

// ───────────────────────────── permissions

test("permissions: viewer and finance cannot view (403 + denied audit); support can view but cannot act; moderator and admin and owner can", { skip }, async () => {
  const owner = await mkUser();
  const l = await mkLink(owner, "sorting", "Ruxsatlar");
  const res = await mkResult(l.id, "Kimdir");

  for (const role of ["viewer", "finance"] as const) {
    const s = await session(role);
    for (const r of [await get("list", s.cookie), await get("detail", s.cookie, { id: l.id })]) {
      assert.equal(r.status, 403, role);
      assert.equal(r.body.code, "forbidden");
    }
    assert.equal((await post("revoke", s.cookie, l.id, REASON)).status, 403);
    assert.equal((await post("delOne", s.cookie, res, REASON)).status, 403);
    assert.equal((await post("delMany", s.cookie, null, { ids: [res], reason: REASON.reason })).status, 403);
    const denied = await audits(s.admin.adminId, "auth.denied");
    assert.ok(denied.length >= 2 && denied.every((d) => d.outcome === "denied"));
  }

  const support = await session("support");
  assert.equal((await get("list", support.cookie)).status, 200);
  assert.equal((await get("detail", support.cookie, { id: l.id })).status, 200);
  for (const r of [
    await post("revoke", support.cookie, l.id, REASON),
    await post("delOne", support.cookie, res, REASON),
    await post("delMany", support.cookie, null, { ids: [res], reason: REASON.reason }),
  ]) {
    assert.equal(r.status, 403, "support cannot act");
    assert.equal(r.body.code, "forbidden");
  }
  assert.equal((await publicGet(l.token)).status, 200, "the denied revoke changed nothing");
  assert.ok(await resultExists(res));

  for (const role of ["moderator", "admin", "owner"] as const) {
    const s = await session(role);
    assert.equal((await get("list", s.cookie)).status, 200, role);
  }
  // No session / not an admin: the cloak is 404.
  assert.equal((await get("list", null)).status, 404);
  const plain = await mkUser();
  assert.equal((await get("list", `${SESSION_COOKIE}=${plain.userToken}`)).status, 404);
});

test("the default sort is backed by game_sessions_created_idx (created_at DESC, id DESC)", { skip }, async () => {
  const idx = await queryOne<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'game_sessions_created_idx'`);
  assert.ok(idx, "the 030 index exists");
  assert.match(idx!.indexdef, /created_at DESC, id DESC/);
  // With sequential scans disabled the planner must walk that index for the keyset order.
  const plan = await transaction(async (client) => {
    await client.query("SET LOCAL enable_seqscan = off");
    const r = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN SELECT gs.id FROM game_sessions gs ORDER BY gs.created_at DESC, gs.id DESC LIMIT 51`);
    return r.rows.map((x) => x["QUERY PLAN"]).join("\n");
  });
  assert.match(plan, /game_sessions_created_idx/);
});
