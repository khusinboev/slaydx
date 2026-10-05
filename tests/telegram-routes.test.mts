import "./helpers/next-request.mts"; // AsyncLocalStorage before `next/*`
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";

/**
 * `POST /api/generations/{id}/telegram/save` and `…/share` (docs/mobile/PLAN.md
 * §4.4) through the real `handler` + `requireUser` (session cookie, Next
 * request context), real Postgres for ownership. The route bodies live in
 * `app/api/generations/[id]/telegram/action.ts`; the route files only bind
 * the action to package A's `produceDownload`, so here the producer is
 * injected. The Bot API is a stubbed `fetch` with a fake token.
 *
 * Mutations (each turned a test red):
 *   1. `getGeneration(id, user.id)` → a lookup without the owner — «foreign generation → 404»;
 *   2. `no_telegram` check removed — «account without Telegram → 409 no_telegram»;
 *   3. `formatById` validation skipped — «format not offered → 400 unsupported»;
 *   4. `limit(...)` removed — «21st save in an hour → 429»;
 *   5. default format `pdf` instead of `defaultShareFormat` — «no format → native».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-routes-token-never-sent";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { inRequest } = await import("./helpers/next-request.mts");
const { query, queryOne, pool, ensureMigrated } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { telegramActionHandler, TELEGRAM_LIMITS } = await import("../app/api/generations/[id]/telegram/action.ts");
type Deps = import("../lib/server/telegram-files.ts").TelegramFilesDeps;
if (hasDb) await ensureMigrated();

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const userIds: string[] = [];
after(async () => {
  if (!hasDb) return;
  if (userIds.length) {
    await query("DELETE FROM rate_limits WHERE bucket = ANY($1::text[])", [userIds.flatMap((id) => [`tgsave:${id}`, `tgshare:${id}`])]).catch(() => {});
    await query("DELETE FROM users WHERE id = ANY($1::bigint[])", [userIds]);
  }
  await pool().end();
});

type U = { id: string; telegramId: string | null; cookie: string };
async function mkUser(withTelegram = true): Promise<U> {
  const telegramId = withTelegram ? String(randomInt(6_000_000_000, 6_900_000_000)) : null;
  const row = await queryOne<{ id: string }>("INSERT INTO users (telegram_id, name) VALUES ($1, 'Route Sinov') RETURNING id::text AS id", [telegramId]);
  userIds.push(row!.id);
  const { token } = await createSession(row!.id);
  return { id: row!.id, telegramId, cookie: `${SESSION_COOKIE}=${token}` };
}

async function mkGen(userId: string, o: { tool?: string; format?: string; status?: string } = {}): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, format, file_name, file_version, doc_version)
     VALUES ($1, $2, $3, 'Quyosh tizimi', $4, $5, 'Quyosh tizimi.pptx', 1, 1)`,
    [id, userId, o.tool ?? "slide", o.status ?? "COMPLETED", o.format ?? "pptx"],
  );
  return id;
}

type Call = { method: string; body: unknown };
function harness() {
  const calls: Call[] = [];
  const produced: string[] = [];
  let seq = 0;
  const deps: Deps = {
    fetch: (async (url: string | URL, init?: RequestInit) => {
      const method = /\/(\w+)$/.exec(String(url))![1];
      calls.push({ method, body: init?.body instanceof FormData ? "multipart" : JSON.parse(String(init?.body)) });
      if (method === "savePreparedInlineMessage") return new Response(JSON.stringify({ ok: true, result: { id: "prep-1", expiration_date: 1_900_000_000 } }));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1, document: { file_id: `F-${++seq}` } } }));
    }) as typeof fetch,
    produce: async (_g, _u, format) => {
      produced.push(format);
      return { bytes: Buffer.alloc(1024, 1), fileName: `fayl.${format === "pdf" ? "pdf" : "pptx"}`, mime: format === "pdf" ? "application/pdf" : PPTX, fileVersion: 1 };
    },
  };
  return { deps, calls, produced };
}

type Res = { status: number; body: Record<string, unknown>; headers: Headers };
async function post(action: "save" | "share", deps: Deps, cookie: string | null, id: string, body?: unknown): Promise<Res> {
  const headers: Record<string, string> = { host: "localhost:3000", "content-type": "application/json", "x-forwarded-for": "10.9.8.7" };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost:3000/api/generations/${id}/telegram/${action}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const fn = telegramActionHandler(action, deps);
  const res = await inRequest(req, () => fn(req, { params: Promise.resolve({ id }) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

test("save: owner with Telegram, no body → 200 {ok, duplicate:false, format:'native', botUrl}; the file goes to the session's chat", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  const r = await post("save", h.deps, u.cookie, gen);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, duplicate: false, format: "native", botUrl: "https://t.me/slaydx_test_bot" });
  assert.deepEqual(h.produced, ["native"]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "sendDocument");
  const again = await post("save", h.deps, u.cookie, gen, {});
  assert.deepEqual(again.body, { ok: true, duplicate: true, format: "native", botUrl: "https://t.me/slaydx_test_bot" });
});

test("save ignores any recipient in the body (chat_id / telegramId): always the session's Telegram id", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const first = harness();
  assert.equal((await post("save", first.deps, u.cookie, gen)).status, 200);
  // Past the debounce window the save is a JSON resend, so its chat_id is visible here.
  const later = harness();
  const deps: Deps = { ...later.deps, now: () => new Date(Date.now() + 60_000) };
  const r = await post("save", deps, u.cookie, gen, { format: "native", chat_id: 1, telegramId: "1", user_id: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, false);
  assert.equal(later.calls.length, 1);
  assert.equal((later.calls[0].body as { chat_id: string }).chat_id, u.telegramId);
});

test("share: 200 {preparedId, expiresAt, format, botUrl}; upload then prepared message", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  const r = await post("share", h.deps, u.cookie, gen, { format: "native" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    preparedId: "prep-1",
    expiresAt: new Date(1_900_000_000 * 1000).toISOString(),
    format: "native",
    botUrl: "https://t.me/slaydx_test_bot",
  });
  assert.deepEqual(h.calls.map((c) => c.method), ["sendDocument", "savePreparedInlineMessage"]);
});

test("foreign generation → 404 and nothing is produced or sent", { skip }, async () => {
  const owner = await mkUser();
  const stranger = await mkUser();
  const gen = await mkGen(owner.id);
  const h = harness();
  for (const action of ["save", "share"] as const) {
    const r = await post(action, h.deps, stranger.cookie, gen);
    assert.equal(r.status, 404, action);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.produced.length, 0);
});

test("account without Telegram → 409 no_telegram", { skip }, async () => {
  const local = await mkUser(false);
  const gen = await mkGen(local.id);
  const h = harness();
  for (const action of ["save", "share"] as const) {
    const r = await post(action, h.deps, local.cookie, gen);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "no_telegram");
  }
  assert.equal(h.calls.length, 0);
  // Refused before any work: no rate-limit bucket was spent.
  const spent = await query("SELECT 1 FROM rate_limits WHERE bucket = ANY($1::text[])", [[`tgsave:${local.id}`, `tgshare:${local.id}`]]);
  assert.equal(spent.length, 0);
});

test("format validation: unknown id → 400 unknown_format; not offered for this generation → 400 unsupported", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "essay", format: "docx" });
  const h = harness();
  const unknown = await post("save", h.deps, u.cookie, gen, { format: "exe" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "unknown_format");
  for (const format of ["slides-png", "jpg", "transcript-txt", "results-csv"]) {
    const r = await post("save", h.deps, u.cookie, gen, { format });
    assert.equal(r.status, 400, format);
    assert.equal(r.body.code, "unsupported", format);
  }
  const notString = await post("share", h.deps, u.cookie, gen, { format: 7 });
  assert.equal(notString.body.code, "unknown_format");
  assert.equal(h.produced.length, 0);
});

test("results-csv is offered only when the game has player results", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id, { tool: "sorting", format: "docx" });
  const h = harness();
  const before = await post("save", h.deps, u.cookie, gen, { format: "results-csv" });
  assert.equal(before.body.code, "unsupported");
  const session = randomUUID();
  await query("INSERT INTO game_sessions (id, generation_id, user_id, token, kind) VALUES ($1, $2, $3, $4, 'sorting')", [session, gen, u.id, `t${randomUUID().replace(/-/g, "")}`]);
  await query("INSERT INTO game_results (id, session_id, player_name) VALUES ($1, $2, 'Ali')", [randomUUID(), session]);
  const r = await post("save", h.deps, u.cookie, gen, { format: "results-csv" });
  assert.equal(r.status, 200);
  assert.deepEqual(h.produced, ["results-csv"]);
});

test("unfinished generation → 409 not_ready; bad id → 400; no session → 401", { skip }, async () => {
  const u = await mkUser();
  const running = await mkGen(u.id, { status: "IN_PROGRESS" });
  const h = harness();
  const r = await post("save", h.deps, u.cookie, running);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "not_ready");
  assert.equal((await post("save", h.deps, u.cookie, "not-a-uuid")).status, 400);
  assert.equal((await post("save", h.deps, null, running)).status, 401);
});

test("Bot API 403 → 409 bot_unreachable with botUrl; 5xx → 503 telegram_unavailable; prepare refused → 501 share_unavailable", { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const reply = (body: unknown) => ({ ...harness().deps, fetch: (async () => new Response(JSON.stringify(body))) as typeof fetch });
  const blocked = await post("save", reply({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), u.cookie, gen);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "bot_unreachable");
  assert.equal(blocked.body.botUrl, "https://t.me/slaydx_test_bot");
  const down = await post("save", reply({ ok: false, error_code: 502, description: "Bad Gateway" }), u.cookie, gen);
  assert.equal(down.status, 503);
  assert.equal(down.body.code, "telegram_unavailable");
  assert.equal(down.headers.get("retry-after"), "30", "every 503 carries Retry-After");

  await post("save", harness().deps, u.cookie, gen); // cache the file
  const refused = await post("share", reply({ ok: false, error_code: 400, description: "Bad Request: BOT_INLINE_DISABLED" }), u.cookie, gen);
  assert.equal(refused.status, 501);
  assert.equal(refused.body.code, "share_unavailable");
});

test("producer errors keep their own status and code (e.g. PDF converter busy → 503 busy)", { skip }, async () => {
  const { ApiError } = await import("../lib/server/api.ts");
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const deps: Deps = {
    ...harness().deps,
    produce: async () => {
      throw new ApiError("Fayl tayyorlash navbati band — birozdan keyin qayta urinib ko'ring", 503, { code: "busy", retryAfter: 5 });
    },
  };
  const r = await post("save", deps, u.cookie, gen, { format: "native" });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "busy");
  assert.equal(r.headers.get("retry-after"), "5", "the producer's Retry-After reaches the client");
});

test(`per-user rate limit: save ${TELEGRAM_LIMITS.save.count}/h, then 429 with Retry-After`, { skip }, async () => {
  const u = await mkUser();
  const gen = await mkGen(u.id);
  const h = harness();
  for (let i = 0; i < TELEGRAM_LIMITS.save.count; i++) {
    const r = await post("save", h.deps, u.cookie, gen);
    assert.equal(r.status, 200, `request ${i + 1}`);
  }
  const over = await post("save", h.deps, u.cookie, gen);
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers.get("retry-after")) > 0);
  // Share has its own bucket.
  assert.equal((await post("share", h.deps, u.cookie, gen)).status, 200);
});

test("route files: bind the action to package A's produceDownload, nodejs runtime, maxDuration sized for uploads", async () => {
  const { readFileSync } = await import("node:fs");
  for (const action of ["save", "share"] as const) {
    const src = readFileSync(new URL(`../app/api/generations/[id]/telegram/${action}/route.ts`, import.meta.url), "utf8");
    assert.match(src, /import \{ produceDownload \} from "@\/lib\/server\/downloads\/produce";/, action);
    assert.match(src, new RegExp(`export const POST = telegramActionHandler\\("${action}", \\{ produce: produceDownload \\}\\);`), action);
    assert.match(src, /export const runtime = "nodejs";/, action);
    const max = Number(/export const maxDuration = (\d+);/.exec(src)?.[1]);
    assert.ok(max >= 90, `${action}: maxDuration ${max} < 90 s (upload timeout + conversion)`);
  }
});
