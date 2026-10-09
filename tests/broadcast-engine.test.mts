import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Broadcast delivery engine (docs/bonus/BONUS3.md C-Q5, package D3):
 * `lib/server/send-limiter.ts`, `broadcast-errors.ts`, `broadcast-delivery.ts`.
 *
 *   • the paced limiter (time-faked): ≤ 25 grants in any 1000 ms window, even spacing, FIFO, global pause;
 *   • error classification and the backoff schedule (pure);
 *   • 429 → ONE global pause for retry_after + 1 s, the recipient re-queued (not failed, no attempt used);
 *   • transient errors → backoff 10, 20, 40, 80, 160 s, then `failed` on the 6th failure;
 *   • permanent errors → `error_kind` on the row, `failedReasons` by kind;
 *   • early abort: 200 permanent failures and nothing delivered → `failed` with a reason;
 *   • lease recovery: an expired `sending` row is delivered, a live one is left alone;
 *   • two loop instances never send to the same recipient twice; only the advisory-lock leader delivers.
 *
 * The real senders run against a stubbed `fetch` (Bot API shape) on a throwaway database.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN-engine";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("bcengine") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const { createLimiter } = await import("../lib/server/send-limiter.ts");
const errors = await import("../lib/server/broadcast-errors.ts");
const bd = await import("../lib/server/broadcast-delivery.ts");

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

/** A fake clock whose concurrent sleepers all wake at their own target (not one after another). */
function fakeClock() {
  const c = {
    t: 0,
    now: () => c.t,
    sleep: async (ms: number) => {
      const target = c.t + ms;
      await Promise.resolve();
      c.t = Math.max(c.t, target);
    },
  };
  return c;
}

/* ────────────────────────────── limiter (pure) ────────────────────────────── */

test("limiter: ≤ 25 grants in ANY 1000 ms window, evenly spaced, FIFO, 8 concurrent senders", async (t) => {
  const clock = fakeClock();
  const lim = createLimiter({ perSecond: 25, now: clock.now, sleep: clock.sleep });
  const grants: Array<{ at: number; who: number }> = [];
  const senders = Array.from({ length: 8 }, (_, who) =>
    (async () => {
      for (let i = 0; i < 25; i++) {
        await lim.acquire();
        grants.push({ at: clock.t, who });
      }
    })(),
  );
  await Promise.all(senders);
  assert.equal(grants.length, 200);
  for (let i = 0; i + 25 < grants.length; i++) {
    const span = grants[i + 25]!.at - grants[i]!.at;
    assert.ok(span >= 1000, `26 grants inside ${span} ms (window ${i})`);
  }
  for (let i = 1; i < grants.length; i++) assert.ok(grants[i]!.at - grants[i - 1]!.at >= 39, `uneven spacing at ${i}`);
  assert.ok(clock.t >= 199 * 40 - 1, `200 grants need ≥ 7.96 s, got ${clock.t} ms`);
  // The measured rate of the fake run: 200 grants over the elapsed fake time.
  const rate = (200 / clock.t) * 1000;
  assert.ok(rate <= 25.2 && rate >= 24, `rate ${rate.toFixed(2)}/s`);
  t.diagnostic(`limiter: 200 grants in ${clock.t} ms = ${rate.toFixed(2)} msg/s (cap 25)`);
});

test("limiter: a pause holds everybody until it ends; shorter pauses never shorten it", async () => {
  const clock = fakeClock();
  const lim = createLimiter({ perSecond: 25, now: clock.now, sleep: clock.sleep });
  await lim.acquire();
  lim.pauseFor(8_000);
  lim.pauseFor(1_000);
  assert.equal(lim.pausedUntil(), 8_000);
  const waiters = await Promise.all([lim.acquire().then(() => clock.t), lim.acquire().then(() => clock.t), lim.whenResumed().then(() => clock.t)]);
  assert.ok(waiters[0]! >= 8_000 && waiters[1]! >= 8_000, `granted during the pause: ${waiters.join(",")}`);
  assert.ok(waiters[2]! >= 8_000, "whenResumed returned early");
});

/* ───────────────────────────── classification (pure) ───────────────────────────── */

test("classify: sent / 429 / transient / permanent kinds", () => {
  const c = errors.classify;
  assert.deepEqual(c({ ok: true }), { type: "sent" });
  assert.deepEqual(c({ ok: false, code: 429, description: "Too Many Requests: retry after 7", retryAfter: 7 }), { type: "rate_limit", retryAfterS: 7 });
  assert.deepEqual(c({ ok: false, code: 429, description: "x" }), { type: "rate_limit", retryAfterS: errors.DEFAULT_RETRY_AFTER_S });
  assert.equal((c({ ok: false, code: 429, description: "x", retryAfter: 99999 }) as { retryAfterS: number }).retryAfterS, errors.MAX_RETRY_AFTER_S);
  assert.equal(c({ ok: false, code: 0, description: "fetch failed" }).type, "transient");
  assert.equal(c({ ok: false, code: 502, description: "Bad Gateway" }).type, "transient");
  const kind = (code: number, description: string) => (c({ ok: false, code, description }) as { kind?: string }).kind;
  assert.equal(kind(403, "Forbidden: bot was blocked by the user"), "blocked");
  assert.equal(kind(403, "Forbidden: bot can't initiate conversation with a user"), "blocked");
  assert.equal(kind(403, "Forbidden: user is deactivated"), "deactivated");
  assert.equal(kind(400, "Bad Request: chat not found"), "chat_not_found");
  assert.equal(kind(400, "Bad Request: wrong file identifier/HTTP URL specified"), "bad_request");
  assert.equal(kind(400, "Bad Request: can't parse entities"), "bad_request");
  assert.equal(kind(401, "Unauthorized"), "other");
  assert.equal(kind(404, "Not Found"), "other");
  assert.ok(errors.isUnreachable("blocked") && errors.isUnreachable("deactivated"));
  assert.ok(!errors.isUnreachable("chat_not_found") && !errors.isUnreachable("bad_request") && !errors.isUnreachable("other"));
});

test("backoff: 10, 20, 40, 80, 160 s, capped at 600; 6 attempts", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(errors.backoffSeconds), [10, 20, 40, 80, 160]);
  assert.equal(errors.backoffSeconds(9), 600);
  assert.equal(errors.MAX_ATTEMPTS, 6);
});

/* ─────────────────────────────── engine (Postgres) ─────────────────────────────── */

test("broadcast engine (Postgres)", { skip }, async (t) => {
  const { migrate, pool, query } = await import("../lib/server/db.ts");
  await migrate();
  const admin = await import("../lib/server/admin-broadcasts.ts");

  type Hit = { chatId: string; at: number; method: string };
  type Fault = { code: number; description: string; retryAfter?: number };
  let hits: Hit[] = [];
  let calls = 0;
  /** (chat id, call number) → a Telegram error, or null for ok. */
  let handler: (chatId: string, n: number) => Fault | null = () => null;
  const clock = fakeClock();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = String(url).split("/").pop()!;
    const body = JSON.parse(String(init?.body)) as { chat_id: string | number };
    const chatId = String(body.chat_id);
    calls++;
    const f = handler(chatId, calls);
    if (f) {
      return new Response(
        JSON.stringify({ ok: false, error_code: f.code, description: f.description, ...(f.retryAfter !== undefined ? { parameters: { retry_after: f.retryAfter } } : {}) }),
        { status: f.code },
      );
    }
    hits.push({ chatId, at: clock.t, method });
    return new Response(JSON.stringify({ ok: true, result: { message_id: hits.length } }));
  }) as typeof fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    await pool().end();
    await iso.drop();
  });

  const reset = async () => {
    await query("DELETE FROM broadcasts");
    hits = [];
    calls = 0;
    handler = () => null;
    clock.t = 1_000_000;
  };
  const mk = async (n: number, status = "queued", text = "Salom") => {
    const id = String(
      (
        await query<{ id: string }>(
          `INSERT INTO broadcasts (status, text, audience, total, queued_at) VALUES ($1, $2, '{"kind":"all"}'::jsonb, $3, now()) RETURNING id`,
          [status, text, n],
        )
      )[0].id,
    );
    await query(`INSERT INTO broadcast_recipients (broadcast_id, user_id, telegram_id) SELECT $1, g, 7000000 + g FROM generate_series(1, $2::int) g`, [id, n]);
    return id;
  };
  const bc = async (id: string) =>
    (await query<{ status: string; sent: number; failed: number; fail_reason: string | null; heartbeat_at: Date | null; started_at: Date | null }>(
      "SELECT status, sent, failed, fail_reason, heartbeat_at, started_at FROM broadcasts WHERE id = $1",
      [id],
    ))[0];
  const rows = async (id: string) =>
    query<{ user_id: string; status: string; attempts: number; error: string | null; error_kind: string | null }>(
      "SELECT user_id::text, status, attempts, error, error_kind FROM broadcast_recipients WHERE broadcast_id = $1 ORDER BY user_id",
      [id],
    );
  const pass = (extra: NonNullable<Parameters<typeof bd.deliverBroadcasts>[0]> = {}) => bd.deliverBroadcasts({ now: clock.now, sleep: clock.sleep, ...extra });

  await t.test("429: ONE global pause for retry_after + 1 s; the recipient is re-queued, not failed", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(20);
    let c0 = -1;
    handler = (chatId, n) => {
      if (n === 6) {
        c0 = clock.t;
        return { code: 429, description: "Too Many Requests: retry after 7", retryAfter: 7 };
      }
      return null;
    };
    const r = await pass({ senders: 4, batchSize: 5 });
    assert.ok(c0 > 0, "the 429 was served");
    assert.equal(r.sent, 20);
    assert.equal(r.failed, 0);
    assert.ok(r.retried >= 1);
    // Nothing new is sent during the pause (≤ 3 messages that were already past the limiter on the other senders).
    const during = hits.filter((h) => h.at > c0 && h.at < c0 + 8_000).length;
    assert.ok(during <= 3, `${during} messages went out during the 429 pause`);
    assert.ok(hits.filter((h) => h.at >= c0 + 8_000).length >= 10, "delivery resumes after retry_after + 1 s");
    const rec = await rows(id);
    assert.ok(rec.every((x) => x.status === "sent"), "every recipient was delivered, none failed");
    assert.ok(rec.every((x) => x.attempts === 1), "a 429 does not use up an attempt");
    assert.equal(new Set(hits.map((h) => h.chatId)).size, 20);
    assert.equal((await bc(id)).status, "done");
  });

  await t.test("transient errors back off 10, 20, 40, 80, 160 s and the 6th failure is final", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(2);
    handler = (chatId) => (chatId === "7000001" ? { code: 502, description: "Bad Gateway" } : null);
    const expected = [10, 20, 40, 80, 160];
    for (let k = 0; k < 5; k++) {
      await query("UPDATE broadcast_recipients SET next_attempt_at = now() WHERE broadcast_id = $1", [id]);
      const r = await pass();
      assert.equal(r.retried, 1, `pass ${k + 1}`);
      const row = (
        await query<{ attempts: number; s: string; status: string }>(
          "SELECT attempts, status, extract(epoch FROM next_attempt_at - now())::text AS s FROM broadcast_recipients WHERE broadcast_id = $1 AND user_id = 1",
          [id],
        )
      )[0];
      assert.equal(row.status, "pending");
      assert.equal(row.attempts, k + 1);
      assert.ok(Math.abs(Number(row.s) - expected[k]!) < 2.5, `backoff after failure ${k + 1} ≈ ${expected[k]} s, got ${row.s}`);
      assert.equal((await bc(id)).status, "sending", "the broadcast waits for the retry");
    }
    await query("UPDATE broadcast_recipients SET next_attempt_at = now() WHERE broadcast_id = $1", [id]);
    const last = await pass();
    assert.equal(last.failed, 1);
    const rec = await rows(id);
    assert.equal(rec[0]!.status, "failed");
    assert.equal(rec[0]!.error_kind, "other");
    assert.match(rec[0]!.error ?? "", /6 urinish/);
    assert.equal(rec[0]!.attempts, 6);
    assert.equal(rec[1]!.status, "sent");
    const b = await bc(id);
    assert.equal(b.status, "done");
    assert.equal(b.failed, 1);
    assert.equal(b.sent, 1);
  });

  await t.test("a transient error that clears is retried to success", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(1);
    let up = false;
    handler = () => (up ? null : { code: 0, description: "fetch failed" });
    assert.equal((await pass()).retried, 1);
    up = true;
    await query("UPDATE broadcast_recipients SET next_attempt_at = now() WHERE broadcast_id = $1", [id]);
    assert.equal((await pass()).sent, 1);
    assert.equal((await rows(id))[0]!.status, "sent");
    assert.equal((await bc(id)).status, "done");
  });

  await t.test("permanent errors are stored by kind; failedReasons uses the kinds", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(6);
    const by: Record<string, Fault> = {
      "7000001": { code: 403, description: "Forbidden: bot was blocked by the user" },
      "7000002": { code: 403, description: "Forbidden: user is deactivated" },
      "7000003": { code: 400, description: "Bad Request: chat not found" },
      "7000004": { code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" },
      "7000005": { code: 401, description: "Unauthorized" },
    };
    handler = (chatId) => by[chatId] ?? null;
    const r = await pass();
    assert.equal(r.failed, 5);
    assert.equal(r.sent, 1);
    assert.deepEqual((await rows(id)).map((x) => x.error_kind), ["blocked", "deactivated", "chat_not_found", "bad_request", "other", null]);
    const { stats } = await admin.getBroadcast(id);
    assert.equal(stats.failed, 5);
    assert.deepEqual(
      stats.failedReasons.map((x) => x.kind).sort(),
      ["bad_request", "blocked", "chat_not_found", "deactivated", "other"],
    );
    assert.ok(stats.failedReasons.every((x) => x.count === 1 && x.error.length > 3));
    assert.equal(stats.failedReasons.find((x) => x.kind === "blocked")!.error, errors.kindLabel("blocked"));
    assert.equal((await bc(id)).status, "done");
  });

  await t.test("early abort: 200 permanent failures and nothing delivered → failed with a reason", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(300, "queued", "Rasm");
    handler = () => ({ code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" });
    const r = await pass();
    assert.equal(r.aborted, 1);
    const b = await bc(id);
    assert.equal(b.status, "failed");
    assert.equal(b.sent, 0);
    assert.ok(b.failed >= 200 && b.failed <= 200 + 8, `failed ${b.failed}`);
    assert.match(b.fail_reason ?? "", /200/);
    assert.match(b.fail_reason ?? "", /Telegram xabarni rad etdi/, "the reason names the dominant kind");
    const left = (await rows(id)).filter((x) => x.status === "pending");
    assert.ok(left.length >= 300 - 208, `${left.length} recipients stay unsent`);
    assert.equal((await rows(id)).filter((x) => x.status === "sending").length, 0, "no row is left leased");
    // A failed broadcast is not picked up again.
    const calls0 = calls;
    await pass();
    assert.equal(calls, calls0);
    // The rest of the audience is untouched: with the dead content fixed nobody was burnt.
    assert.equal(hits.length, 0);
  });

  await t.test("one delivery in the first 200 prevents the early abort", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(260);
    handler = (chatId) => (chatId === "7000001" ? null : { code: 400, description: "Bad Request: chat not found" });
    const r = await pass();
    assert.equal(r.aborted, 0);
    const b = await bc(id);
    assert.equal(b.status, "done");
    assert.equal(b.sent, 1);
    assert.equal(b.failed, 259);
  });

  await t.test("lease recovery: an expired `sending` row is delivered, a live lease is left alone", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(5, "sending");
    await query(
      `UPDATE broadcast_recipients SET status = 'sending', lease_until = now() - interval '1 minute' WHERE broadcast_id = $1 AND user_id IN (1, 2)`,
      [id],
    );
    await query(
      `UPDATE broadcast_recipients SET status = 'sending', lease_until = now() + interval '10 minutes' WHERE broadcast_id = $1 AND user_id = 3`,
      [id],
    );
    const r = await pass();
    assert.equal(r.sent, 4, "2 pending + 2 recovered");
    assert.deepEqual((await rows(id)).map((x) => x.status), ["sent", "sent", "sending", "sent", "sent"]);
    assert.ok(!hits.some((h) => h.chatId === "7000003"), "a live lease belongs to another sender");
    assert.equal((await bc(id)).status, "sending", "not done while a row is in flight");
    await query("UPDATE broadcast_recipients SET lease_until = now() - interval '1 second' WHERE broadcast_id = $1 AND user_id = 3", [id]);
    assert.equal((await pass()).sent, 1);
    assert.equal((await bc(id)).status, "done");
    assert.equal(new Set(hits.map((h) => h.chatId)).size, 5);
  });

  await t.test("a result for a lease that was lost is not counted", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(1, "sending");
    // Another instance re-claimed the row while this sender was inside the HTTP call.
    handler = (chatId) => {
      void chatId;
      return null;
    };
    const slow = pass({
      send: async () => {
        await query("UPDATE broadcast_recipients SET lease_until = now() + interval '5 minutes' WHERE broadcast_id = $1", [id]);
        return { ok: true as const };
      },
    });
    const r = await slow;
    assert.equal(r.sent, 0, "the stale result is dropped");
    assert.equal((await bc(id)).sent, 0);
    assert.equal((await rows(id))[0]!.status, "sending");
  });

  /* ───────────── bot_blocked_at hygiene (docs/bonus/BONUS3.md C-Q5) ───────────── */

  const { handleUpdate } = await import("../lib/server/telegram.ts");
  let tgSeq = 8_100_000;
  let updateSeq = 910_000_000;
  const mkUser = async (name = "Reach Test") =>
    (
      await query<{ id: string; tg: string }>(
        "INSERT INTO users (telegram_id, name) VALUES ($1, $2) RETURNING id::text AS id, telegram_id::text AS tg",
        [++tgSeq, name],
      )
    )[0]!;
  const blockedAt = async (id: string) => (await query<{ b: Date | null }>("SELECT bot_blocked_at AS b FROM users WHERE id = $1", [id]))[0]!.b;
  /** A broadcast whose recipients are the given real users. */
  const mkFor = async (users: Array<{ id: string; tg: string }>) => {
    const id = String(
      (
        await query<{ id: string }>(
          `INSERT INTO broadcasts (status, text, audience, total, queued_at) VALUES ('queued', 'Salom', '{"kind":"all"}'::jsonb, $1, now()) RETURNING id`,
          [users.length],
        )
      )[0].id,
    );
    for (const u of users) await query("INSERT INTO broadcast_recipients (broadcast_id, user_id, telegram_id) VALUES ($1, $2, $3)", [id, u.id, u.tg]);
    return id;
  };

  await t.test("blocked / deactivated set users.bot_blocked_at; other refusals and successes do not", async (tt) => {
    quiet(tt);
    await reset();
    const [blocked, deactivated, gone, fine] = [await mkUser(), await mkUser(), await mkUser(), await mkUser()];
    const id = await mkFor([blocked, deactivated, gone, fine]);
    handler = (chatId) =>
      chatId === blocked.tg
        ? { code: 403, description: "Forbidden: bot was blocked by the user" }
        : chatId === deactivated.tg
          ? { code: 403, description: "Forbidden: user is deactivated" }
          : chatId === gone.tg
            ? { code: 400, description: "Bad Request: chat not found" }
            : null;
    const r = await pass();
    assert.equal(r.failed, 3);
    assert.equal(r.sent, 1);
    assert.ok(await blockedAt(blocked.id), "blocked");
    assert.ok(await blockedAt(deactivated.id), "deactivated");
    assert.equal(await blockedAt(gone.id), null, "chat_not_found is not «blocked»");
    assert.equal(await blockedAt(fine.id), null);
    assert.equal((await bc(id)).status, "done");
    // The first timestamp is kept.
    const first = await blockedAt(blocked.id);
    const { markBotBlocked } = await import("../lib/server/bot-reachability.ts");
    await markBotBlocked({ userId: blocked.id });
    assert.deepEqual(await blockedAt(blocked.id), first);
  });

  await t.test("audiences exclude users with bot_blocked_at (live count, several kinds)", async (tt) => {
    quiet(tt);
    await reset();
    const base = await admin.audienceCount({ kind: "all" });
    const u = await mkUser();
    const v = await mkUser();
    assert.equal((await admin.audienceCount({ kind: "all" })).count, base.count + 2);
    const newBefore = (await admin.audienceCount({ kind: "new_days", days: 1 })).count;
    assert.ok(newBefore >= 2);
    await query("UPDATE users SET bot_blocked_at = now() WHERE id = $1", [u.id]);
    assert.equal((await admin.audienceCount({ kind: "all" })).count, base.count + 1, "a user who blocked the bot is not counted");
    await query("UPDATE users SET bot_blocked_at = now() WHERE id = $1", [v.id]);
    assert.equal((await admin.audienceCount({ kind: "new_days", days: 1 })).count, newBefore - 2);
    await query("UPDATE users SET bot_blocked_at = NULL WHERE id = ANY($1::bigint[])", [[u.id, v.id]]);
    assert.equal((await admin.audienceCount({ kind: "all" })).count, base.count + 2, "cleared → counted again");
  });

  await t.test("my_chat_member: kicked sets, member clears; groups / channels are ignored", async (tt) => {
    quiet(tt);
    await reset();
    const u = await mkUser();
    const upd = (chatId: number, type: string, status: string) => ({
      update_id: ++updateSeq,
      my_chat_member: { chat: { id: chatId, type }, from: { id: chatId }, date: 1, old_chat_member: { status: "member" }, new_chat_member: { status } },
    });
    await handleUpdate(upd(Number(u.tg), "private", "kicked"));
    assert.ok(await blockedAt(u.id), "the user blocked the bot");
    await handleUpdate(upd(Number(u.tg), "private", "member"));
    assert.equal(await blockedAt(u.id), null, "the user unblocked the bot");
    await handleUpdate(upd(Number(u.tg), "private", "kicked"));
    await handleUpdate(upd(Number(u.tg), "channel", "member"));
    await handleUpdate(upd(Number(u.tg), "supergroup", "member"));
    assert.ok(await blockedAt(u.id), "a channel / group update does not clear it");
    await handleUpdate(upd(-1001234567890, "supergroup", "kicked"));
    assert.equal(hits.length, 0, "no reply to a membership update");
  });

  await t.test("/start clears bot_blocked_at; any other text does not", async (tt) => {
    quiet(tt);
    await reset();
    const u = await mkUser();
    await query("UPDATE users SET bot_blocked_at = now() WHERE id = $1", [u.id]);
    const msg = (text: string) => ({
      update_id: ++updateSeq,
      message: { message_id: 1, chat: { id: Number(u.tg), type: "private" }, from: { id: Number(u.tg), first_name: "Reach" }, text },
    });
    await handleUpdate(msg("salom"));
    assert.ok(await blockedAt(u.id), "plain text keeps the flag (only /start or my_chat_member clear it)");
    await handleUpdate(msg("/start"));
    assert.equal(await blockedAt(u.id), null, "/start clears it");
  });

  /* ───────────── pause / resume, progress, heartbeat ───────────── */

  await t.test("pause mid-run: delivery stops before the next message, nothing is left leased; resume finishes without repeats", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(30);
    const chats: string[] = [];
    let n = 0;
    const send = async (chatId: string) => {
      chats.push(chatId);
      if (++n === 3) await query("UPDATE broadcasts SET status = 'paused' WHERE id = $1", [id]);
      return { ok: true as const };
    };
    const r1 = await pass({ send, senders: 2, batchSize: 10 });
    assert.ok(r1.sent >= 3 && r1.sent <= 5, `sent ${r1.sent} (3 + the messages already past the status check)`);
    assert.equal(chats.length, r1.sent);
    const mid = await rows(id);
    assert.equal(mid.filter((x) => x.status === "sending").length, 0, "claimed-but-unsent rows went back to pending");
    assert.equal(mid.filter((x) => x.status === "pending").length, 30 - r1.sent);
    assert.equal((await bc(id)).status, "paused");
    assert.equal((await pass({ send })).sent, 0, "paused broadcasts are skipped");
    assert.equal(chats.length, r1.sent);
    await query("UPDATE broadcasts SET status = 'sending' WHERE id = $1", [id]);
    await pass({ send });
    assert.equal(chats.length, 30);
    assert.equal(new Set(chats).size, 30, "a recipient was sent twice across pause / resume");
    assert.equal((await bc(id)).status, "done");
    assert.equal((await bc(id)).sent, 30);
  });

  /** A rich (bot-composed) broadcast carrying the admin's progress message. */
  const mkRich = async (n: number, notify: Record<string, unknown>) => {
    const id = await mk(n, "queued", "Rasm izohi");
    await query("UPDATE broadcasts SET content = $2::jsonb WHERE id = $1", [id, JSON.stringify({ kind: "text", notify })]);
    return id;
  };

  await t.test("progress message: edited about every progressEveryMs (never faster), then the summary is sent once", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mkRich(40, { chatId: "555", lang: "uz", messageId: 77 });
    const editAt: number[] = [];
    const edited: Array<{ id: string; messageId?: number }> = [];
    const done: string[] = [];
    const r = await pass({
      sendRich: async () => {
        await new Promise((res) => setTimeout(res, 25));
        return { ok: true as const };
      },
      progressEveryMs: 30,
      editProgress: async (bid, notify) => {
        editAt.push(Date.now());
        edited.push({ id: bid, messageId: notify.messageId });
      },
      notifyDone: async (bid) => void done.push(bid),
    });
    assert.equal(r.sent, 40);
    assert.ok(editAt.length >= 2, `the progress message was edited ${editAt.length}× while 40 slow messages went out`);
    assert.ok(edited.every((e) => e.id === id && e.messageId === 77));
    for (let i = 1; i < editAt.length; i++) assert.ok(editAt[i]! - editAt[i - 1]! >= 25, `edits ${i - 1}/${i} only ${editAt[i]! - editAt[i - 1]!} ms apart`);
    assert.deepEqual(done, [id], "the final summary goes out exactly once");
    const edits0 = editAt.length;
    await pass({ progressEveryMs: 30, editProgress: async () => void editAt.push(Date.now()) });
    assert.equal(editAt.length, edits0, "a finished broadcast is not edited any more");
  });

  await t.test("a plain web broadcast has no progress message and no summary", async (tt) => {
    quiet(tt);
    await reset();
    await mk(10);
    let edits = 0;
    let summaries = 0;
    await pass({
      send: async () => {
        await new Promise((res) => setTimeout(res, 10));
        return { ok: true as const };
      },
      progressEveryMs: 10,
      editProgress: async () => void edits++,
      notifyDone: async () => void summaries++,
    });
    assert.equal(edits, 0);
    assert.equal(summaries, 0);
  });

  await t.test("an aborted broadcast also gets its summary (the card names the reason)", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mkRich(260, { chatId: "555", lang: "uz", messageId: 77 });
    const done: string[] = [];
    const r = await pass({
      sendRich: async () => ({ ok: false as const, code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" }),
      notifyDone: async (bid) => void done.push(bid),
      editProgress: async () => {},
    });
    assert.equal(r.aborted, 1);
    assert.deepEqual(done, [id]);
    assert.equal((await bc(id)).status, "failed");
  });

  await t.test("heartbeat, speed and ETA in the detail stats", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(20);
    assert.equal((await bc(id)).heartbeat_at, null);
    await pass({ maxPerTick: 10 });
    const b = await bc(id);
    assert.ok(b.heartbeat_at && Date.now() - b.heartbeat_at.getTime() < 10_000, "heartbeat is fresh");
    assert.ok(b.started_at, "started_at is set");
    const { broadcast, stats } = await admin.getBroadcast(id);
    assert.equal(broadcast.status, "sending");
    assert.ok(broadcast.heartbeatAt);
    assert.equal(stats.sent, 10);
    assert.equal(stats.pending, 10);
    assert.ok(stats.speed > 0, `speed ${stats.speed}`);
    assert.ok(stats.etaSeconds !== null && stats.etaSeconds >= 1, `eta ${stats.etaSeconds}`);
    assert.equal(stats.etaSeconds, Math.ceil(10 / stats.speed));
    // Nothing recent, or not running: no speed, no ETA.
    await query("UPDATE broadcast_recipients SET done_at = now() - interval '5 minutes' WHERE broadcast_id = $1", [id]);
    const quiet0 = (await admin.getBroadcast(id)).stats;
    assert.equal(quiet0.speed, 0);
    assert.equal(quiet0.etaSeconds, null);
  });

  await t.test("two loop instances never send to the same recipient twice", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(160);
    const loops = [0, 1].map(() => bd.startBroadcastLoop({ noLock: true, idleMs: 10, pass: () => pass() }));
    for (let i = 0; i < 400 && (await bc(id)).status !== "done"; i++) await new Promise((r) => setTimeout(r, 25));
    await Promise.all(loops.map((l) => l.stop()));
    assert.equal((await bc(id)).status, "done");
    assert.equal(hits.length, 160);
    assert.equal(new Set(hits.map((h) => h.chatId)).size, 160, "a recipient was sent twice");
    assert.equal((await bc(id)).sent, 160);
  });

  await t.test("only the advisory-lock leader delivers", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(30);
    const passes = [0, 0];
    const loops = [0, 1].map((i) =>
      bd.startBroadcastLoop({
        idleMs: 10,
        pass: () => {
          passes[i]!++;
          return pass();
        },
      }),
    );
    for (let i = 0; i < 400 && (await bc(id)).status !== "done"; i++) await new Promise((r) => setTimeout(r, 25));
    await Promise.all(loops.map((l) => l.stop()));
    assert.equal((await bc(id)).status, "done");
    assert.equal(hits.length, 30);
    assert.ok((passes[0]! > 0) !== (passes[1]! > 0), `exactly one leader ran passes: ${passes.join("/")}`);
  });

  await t.test("measured: 100 real-time messages through 8 senders at the 25/s cap", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk(100);
    // Real clock, real timers: the process-wide limiter (25/s).
    const started = Date.now();
    const r = await bd.deliverBroadcasts();
    const ms = Date.now() - started;
    assert.equal(r.sent, 100);
    assert.equal((await bc(id)).status, "done");
    const rate = (100 / ms) * 1000;
    tt.diagnostic(`measured send rate: 100 messages in ${ms} ms = ${rate.toFixed(1)} msg/s (cap 25)`);
    assert.ok(rate <= 26.5, `rate ${rate.toFixed(1)}/s exceeds the cap`);
    assert.ok(rate >= 15, `rate ${rate.toFixed(1)}/s is far below the cap`);
  });
});
