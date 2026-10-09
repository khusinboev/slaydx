import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Telegram broadcast delivery (`lib/server/broadcast-delivery.ts`,
 * docs/admin/02-plan.md §6.9). The real `sendMessage` runs against a stubbed
 * `fetch` (Telegram Bot API shape), on a throwaway database.
 *
 * Covered: stored plain text is HTML-escaped (parse_mode HTML); pacing of the
 * shared limiter (25/s); 403/400 → recipient `failed` with an error kind; a
 * transient error (5xx) re-queues the recipient with backoff while the others
 * still go out, a later pass delivers it; a cancel stops delivery before the
 * next message; two concurrent deliverers never send to the same recipient
 * twice; status becomes `done` when nothing is pending; no bot token → nothing
 * happens. The engine's own behaviour (429 pause, lease recovery, early abort,
 * pause / resume, blocked users) is in tests/broadcast-engine.test.mts.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-TOKEN-broadcast";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("broadcast") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

const bd = await import("../lib/server/broadcast-delivery.ts");

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

test("escapeTelegramHtml", () => {
  assert.equal(bd.escapeTelegramHtml(`<b>A & B</b> "q" 'a'`), "&lt;b&gt;A &amp; B&lt;/b&gt; &quot;q&quot; 'a'");
  assert.equal(bd.escapeTelegramHtml("&amp;"), "&amp;amp;");
});

test("no bot token configured → nothing is read or sent", async () => {
  let sends = 0;
  const r = await bd.deliverBroadcasts({ configured: () => false, send: async () => (sends++, { ok: true }) });
  assert.deepEqual(r, { rows: 0, sent: 0, failed: 0, retried: 0, finished: 0, aborted: 0 });
  assert.equal(sends, 0);
});

test("broadcast delivery (Postgres)", { skip }, async (t) => {
  const { migrate, pool, query } = await import("../lib/server/db.ts");
  await migrate();

  type Sent = { chatId: string; text: string; parseMode: unknown; at: number };
  let sent: Sent[] = [];
  /** chat id → Telegram error code to answer with (default: ok). */
  let fail = new Map<string, number>();
  const DESCRIPTION: Record<number, string> = { 403: "Forbidden: bot was blocked by the user", 400: "Bad Request: chat not found", 502: "Bad Gateway" };
  let clock = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    assert.match(u, /^https:\/\/api\.telegram\.org\/bot123456:TEST-TOKEN-broadcast\/sendMessage$/);
    const body = JSON.parse(String(init?.body)) as { chat_id: string | number; text: string; parse_mode: unknown };
    const chatId = String(body.chat_id);
    const code = fail.get(chatId);
    if (code) {
      return new Response(JSON.stringify({ ok: false, error_code: code, description: DESCRIPTION[code] ?? `err ${code}` }), { status: code });
    }
    sent.push({ chatId, text: body.text, parseMode: body.parse_mode, at: clock });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
  }) as typeof fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    await pool().end();
    await iso.drop();
  });

  const fakeTime = { now: () => clock, sleep: async (ms: number) => void (clock += ms) };
  const reset = async () => {
    await query("DELETE FROM broadcasts");
    sent = [];
    fail = new Map();
  };
  const mk = async (text: string, n: number, status = "queued") => {
    const id = String(
      (
        await query<{ id: string }>(
          `INSERT INTO broadcasts (status, text, audience, total, queued_at) VALUES ($1, $2, '{"kind":"all"}'::jsonb, $3, now()) RETURNING id`,
          [status, text, n],
        )
      )[0].id,
    );
    await query(
      `INSERT INTO broadcast_recipients (broadcast_id, user_id, telegram_id)
       SELECT $1, g, 7000000 + g FROM generate_series(1, $2::int) g`,
      [id, n],
    );
    return id;
  };
  const bc = async (id: string) =>
    (await query<{ status: string; sent: number; failed: number; finished_at: Date | null }>(
      "SELECT status, sent, failed, finished_at FROM broadcasts WHERE id = $1",
      [id],
    ))[0];
  const recipients = async (id: string) =>
    query<{ user_id: string; status: string; error: string | null; sent_at: Date | null }>(
      "SELECT user_id, status, error, sent_at FROM broadcast_recipients WHERE broadcast_id = $1 ORDER BY user_id",
      [id],
    );

  await t.test("text is HTML-escaped, counters and status follow, done when drained", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk("Yangi <b>imkoniyat</b> & chegirma", 3);
    const r = await bd.deliverBroadcasts(fakeTime);
    assert.deepEqual(r, { rows: 3, sent: 3, failed: 0, retried: 0, finished: 1, aborted: 0 });
    assert.equal(sent.length, 3);
    for (const s of sent) {
      assert.equal(s.text, "Yangi &lt;b&gt;imkoniyat&lt;/b&gt; &amp; chegirma");
      assert.equal(s.parseMode, "HTML");
    }
    const b = await bc(id);
    assert.equal(b.status, "done");
    assert.equal(b.sent, 3);
    assert.ok(b.finished_at);
    assert.ok((await recipients(id)).every((x) => x.status === "sent" && x.sent_at));
    // Idempotent: a further tick sends nothing.
    assert.equal((await bd.deliverBroadcasts(fakeTime)).sent, 0);
    assert.equal(sent.length, 3);
  });

  await t.test("403 and 400 → failed with an error; others still sent", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk("Salom", 4);
    fail.set("7000002", 403);
    fail.set("7000003", 400);
    const r = await bd.deliverBroadcasts(fakeTime);
    assert.equal(r.sent, 2);
    assert.equal(r.failed, 2);
    const rec = await recipients(id);
    assert.deepEqual(rec.map((x) => x.status), ["sent", "failed", "failed", "sent"]);
    assert.equal(rec[1].error, "Forbidden: bot was blocked by the user");
    assert.deepEqual(
      await query("SELECT user_id::text, error_kind FROM broadcast_recipients WHERE broadcast_id = $1 AND status = 'failed' ORDER BY user_id", [id]),
      [
        { user_id: "2", error_kind: "blocked" },
        { user_id: "3", error_kind: "chat_not_found" },
      ],
    );
    const b = await bc(id);
    assert.equal(b.status, "done");
    assert.equal(b.failed, 2);
    assert.equal(b.sent, 2);
  });

  await t.test("transient error → re-queued with backoff, the rest still go out; delivered by a later pass", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk("Salom", 3);
    fail.set("7000002", 502);
    const r1 = await bd.deliverBroadcasts(fakeTime);
    assert.equal(r1.sent, 2, "a transient error no longer ends the pass");
    assert.equal(r1.retried, 1);
    let rec = await recipients(id);
    assert.deepEqual(rec.map((x) => x.status), ["sent", "pending", "sent"]);
    const wait = (
      await query<{ attempts: number; s: string }>(
        "SELECT attempts, extract(epoch FROM next_attempt_at - now())::text AS s FROM broadcast_recipients WHERE broadcast_id = $1 AND user_id = 2",
        [id],
      )
    )[0];
    assert.equal(wait.attempts, 1);
    assert.ok(Number(wait.s) > 8 && Number(wait.s) <= 10, `first backoff ≈ 10 s, got ${wait.s}`);
    assert.equal((await bc(id)).status, "sending");
    // Still backing off: nothing to do.
    assert.equal((await bd.deliverBroadcasts(fakeTime)).sent, 0);
    fail.clear();
    await query("UPDATE broadcast_recipients SET next_attempt_at = now() WHERE broadcast_id = $1", [id]);
    const r2 = await bd.deliverBroadcasts(fakeTime);
    assert.equal(r2.sent, 1);
    rec = await recipients(id);
    assert.ok(rec.every((x) => x.status === "sent"));
    assert.equal((await bc(id)).status, "done");
    assert.equal((await bc(id)).sent, 3);
  });

  await t.test("rate: 100 messages through 8 senders are paced to 25 per second", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk("Salom", 100);
    clock = 0;
    const r1 = await bd.deliverBroadcasts(fakeTime);
    assert.equal(r1.sent, 100);
    assert.ok(clock >= 99 * 40 - 1, `100 messages need ≥ 3.96 s of pacing, got ${clock} ms`);
    assert.ok(clock < 5_000, `and not much more, got ${clock} ms`);
    assert.equal((await bc(id)).status, "done");
    assert.equal(new Set(sent.map((s) => s.chatId)).size, 100);
  });

  await t.test("cancel is respected before the next message", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk("Salom", 10);
    let n = 0;
    const r = await bd.deliverBroadcasts({
      ...fakeTime,
      send: async () => {
        n++;
        if (n === 3) await query("UPDATE broadcasts SET status = 'cancelled' WHERE id = $1", [id]);
        return { ok: true as const };
      },
    });
    assert.equal(r.sent, 3);
    assert.equal(n, 3);
    const b = await bc(id);
    assert.equal(b.status, "cancelled");
    assert.equal(b.sent, 3);
    assert.equal((await recipients(id)).filter((x) => x.status === "pending").length, 7);
    // Later ticks do not touch a cancelled broadcast; a draft is never sent either.
    await mk("Qoralama", 2, "draft");
    assert.equal((await bd.deliverBroadcasts(fakeTime)).sent, 0);
    assert.equal(n, 3);
  });

  await t.test("two concurrent deliverers never send to the same recipient twice", async (tt) => {
    quiet(tt);
    await reset();
    const id = await mk("Salom", 40);
    const chats: string[] = [];
    const send = async (chatId: string) => {
      chats.push(chatId);
      await new Promise((r) => setTimeout(r, 2));
      return { ok: true as const };
    };
    const [a, b] = await Promise.all([
      bd.deliverBroadcasts({ send, sleep: async () => {} }),
      bd.deliverBroadcasts({ send, sleep: async () => {} }),
    ]);
    assert.equal(a.sent + b.sent, 40);
    assert.equal(chats.length, 40);
    assert.equal(new Set(chats).size, 40, "a recipient was sent twice");
    const row = await bc(id);
    assert.equal(row.sent, 40);
    assert.equal(row.status, "done");
  });
});
