import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * Load alerts (docs/ops/METRICS.md): which rule fires on which sample, the cooldown, the single
 * "normallashdi" message, no spam after a restart or from two processes, and who gets the message.
 *
 * Mutations that turn this red: `decide` without the cooldown (reminders every minute, a flapping rule
 * pages again at once); not storing the firing flag (a message every pass); sending to every admin
 * role instead of active owners; a load rule that does not require the sustained span; no
 * compare-and-set on the state row (two processes both send).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("srvalerts") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

const A = await import("../lib/server/server-alerts.ts");

const NOW = new Date("2026-10-10T12:00:00Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

const HEALTHY_HOST: import("../lib/server/server-alerts.ts").HostData = {
  cpus: 4, load1: 1, mem_total_mb: 8000, mem_avail_mb: 2000, swap_total_mb: 4000, swap_used_mb: 100, disk_pct: 50,
  containers: [{ name: "slaydx-web-1", id: "aaaaaaaaaaaa", status: "running", restarts: 0, oom: false }],
};
const sampleOf = (at: Date, data: import("../lib/server/server-alerts.ts").HostData, id = 1) => ({ id, at, data });

// ───────────────────────────── pure rules

test("evaluateLevelRules: every rule fires on its own threshold and clears again", () => {
  const input = (host: Partial<typeof HEALTHY_HOST>, app: number | null = 0, jobs = { failed: 0, finished: 0 }) => ({
    now: NOW,
    host: [sampleOf(NOW, { ...HEALTHY_HOST, ...host })],
    app: app === null ? null : { id: 1, at: NOW, data: { queue: { oldest_age_s: app } } },
    jobs,
  });
  const firing = (inp: ReturnType<typeof input>) => Object.fromEntries(A.evaluateLevelRules(inp).map((f) => [f.rule, f.firing]));

  assert.deepEqual(firing(input({})), { mem_low: false, swap_high: false, disk_high: false, load_high: false, queue_stuck: false, fail_ratio: false });
  assert.equal(firing(input({ mem_avail_mb: 799 })).mem_low, true, "< 10 % available");
  assert.equal(firing(input({ mem_avail_mb: 800 })).mem_low, false, "exactly 10 % is fine");
  assert.equal(firing(input({ swap_used_mb: 2001 })).swap_high, true, "> 50 % swap");
  assert.equal(firing(input({ swap_used_mb: 2000 })).swap_high, false);
  assert.equal(firing(input({ swap_total_mb: 0, swap_used_mb: 0 })).swap_high, false, "no swap configured");
  assert.equal(firing(input({ disk_pct: 86 })).disk_high, true, "> 85 % disk");
  assert.equal(firing(input({ disk_pct: 85 })).disk_high, false);
  assert.equal(firing(input({}, 301)).queue_stuck, true, "> 5 minutes in the queue");
  assert.equal(firing(input({}, 300)).queue_stuck, false);
  assert.equal(firing(input({}, 0, { failed: 3, finished: 10 })).fail_ratio, true, "30 % > 25 %");
  assert.equal(firing(input({}, 0, { failed: 2, finished: 8 })).fail_ratio, false, "25 % exactly is not above");
  assert.equal(firing(input({}, 0, { failed: 7, finished: 7 })).fail_ratio, false, "fewer than 8 jobs: not enough data");
});

test("evaluateLevelRules: no fresh data -> null (state untouched), not a false recovery", () => {
  const stale = A.evaluateLevelRules({ now: NOW, host: [sampleOf(min(-16), { ...HEALTHY_HOST, mem_avail_mb: 1 })], app: null, jobs: { failed: 0, finished: 0 } });
  const by = Object.fromEntries(stale.map((f) => [f.rule, f.firing]));
  assert.deepEqual([by.mem_low, by.swap_high, by.disk_high, by.load_high, by.queue_stuck], [null, null, null, null, null]);
  assert.equal(by.fail_ratio, false, "the job ratio comes from the DB, not from the host cron");
  assert.equal(A.evaluateLevelRules({ now: NOW, host: [], app: null, jobs: { failed: 0, finished: 0 } })[0].firing, null);
});

test("load_high needs the load above 2 x CPUs for 10 minutes; recovery is immediate", () => {
  const high = { ...HEALTHY_HOST, load1: 8.5 }; // 4 CPUs -> limit 8
  const rule = (host: ReturnType<typeof sampleOf>[]) =>
    A.evaluateLevelRules({ now: NOW, host, app: null, jobs: { failed: 0, finished: 0 } }).find((f) => f.rule === "load_high")!.firing;
  assert.equal(rule([sampleOf(NOW, high, 3)]), null, "one high sample: not sustained yet");
  assert.equal(rule([sampleOf(NOW, high, 3), sampleOf(min(-5), high, 2)]), null, "5 minutes: still pending");
  assert.equal(rule([sampleOf(NOW, high, 3), sampleOf(min(-5), high, 2), sampleOf(min(-10), high, 1)]), true, "10 minutes: firing");
  assert.equal(
    rule([sampleOf(NOW, high, 3), sampleOf(min(-5), HEALTHY_HOST, 2), sampleOf(min(-10), high, 1)]),
    null,
    "a healthy sample in between breaks the run",
  );
  assert.equal(rule([sampleOf(NOW, HEALTHY_HOST, 3), sampleOf(min(-5), high, 2), sampleOf(min(-10), high, 1)]), false, "the newest sample is healthy: recovered");
});

test("containerEvents: restart, OOM, stop; a replaced container (deploy) is not an event", () => {
  const web = (o: Partial<(typeof HEALTHY_HOST.containers)[0]>) => ({ ...HEALTHY_HOST, containers: [{ ...HEALTHY_HOST.containers![0], ...o }] });
  assert.deepEqual(A.containerEvents(HEALTHY_HOST, HEALTHY_HOST), []);
  assert.match(A.containerEvents(HEALTHY_HOST, web({ restarts: 1 }))[0], /slaydx-web-1: qayta ishga tushdi \(restartlar 0 -> 1\)/);
  assert.match(A.containerEvents(HEALTHY_HOST, web({ restarts: 1, oom: true }))[0], /OOMKilled/);
  assert.match(A.containerEvents(HEALTHY_HOST, web({ oom: true }))[0], /OOMKilled/);
  assert.deepEqual(A.containerEvents(web({ oom: true }), web({ oom: true })), [], "the same OOM flag is reported once");
  assert.match(A.containerEvents(HEALTHY_HOST, web({ status: "exited" }))[0], /to'xtadi/);
  assert.deepEqual(A.containerEvents(HEALTHY_HOST, web({ id: "bbbbbbbbbbbb" })), [], "new container id = deploy, not a crash");
  assert.deepEqual(A.containerEvents(undefined, HEALTHY_HOST), []);
});

test("decide: alert once, remind only after the cooldown, one recovery, flaps stay quiet", () => {
  const f = (firing: boolean | null) => ({ rule: "mem_low", firing, alert: "a", ok: "o" });
  const st = (firing: boolean, since: Date | null, sent: Date | null) => ({ rule: "mem_low", firing, since, lastSentAt: sent });
  assert.equal(A.decide(f(true), undefined, NOW, 60).send, "alert");
  assert.equal(A.decide(f(true), st(true, NOW, NOW), min(30), 60).send, null, "no reminder inside the cooldown");
  assert.equal(A.decide(f(true), st(true, NOW, NOW), min(60), 60).send, "remind");
  assert.equal(A.decide(f(false), st(true, NOW, NOW), min(1), 60).send, "recover", "recovery is never delayed");
  assert.equal(A.decide(f(false), st(false, null, NOW), min(1), 60).send, null);
  assert.equal(A.decide(f(true), st(false, null, NOW), min(5), 60).send, null, "fires again 5 minutes after the last message: quiet");
  assert.equal(A.decide(f(true), st(false, null, NOW), min(61), 60).send, "alert");
  assert.equal(A.decide(f(null), st(true, NOW, NOW), min(120), 60).send, null);
  assert.equal(A.decide(f(null), undefined, NOW, 60).next, null);
});

// ───────────────────────────── with the database

test("runAlerts (haqiqiy Postgres): recipients, once, cooldown, recovery, restart, two processes", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  await migrate();
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });

  // Recipients: ONE active owner with Telegram. Others must never be told.
  let tgSeq = 7_000_000_000;
  const admin = async (role: string, status: string, telegram: boolean, blocked = false) => {
    const tg = telegram ? ++tgSeq : null;
    const u = await query<{ id: string }>(`INSERT INTO users (name, telegram_id, is_blocked) VALUES ($1, $2, $3) RETURNING id::text AS id`, [`${role}-${status}`, tg, blocked]);
    await query(`INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, $2, $3)`, [u[0].id, role, status]);
    return tg === null ? null : String(tg);
  };
  const OWNER = (await admin("owner", "active", true))!;
  await admin("owner", "active", false); // owner without a linked Telegram
  await admin("owner", "disabled", true); // disabled owner
  await admin("owner", "pending", true); // pending owner
  await admin("admin", "active", true); // not an owner
  await admin("owner", "active", true, true); // blocked user

  const sent: Array<{ to: string; text: string }> = [];
  let failSend = false;
  const send = async (to: string, text: string) => {
    if (failSend) return false;
    sent.push({ to, text });
    return true;
  };
  const run = async (at: Date) => (await A.runAlerts({ now: at, send })).sent;
  const reset = async () => {
    await query("DELETE FROM server_metrics");
    await query("DELETE FROM server_alert_state");
    await query("DELETE FROM generations");
    sent.length = 0;
    failSend = false;
  };
  const putHost = (at: Date, over: Partial<typeof HEALTHY_HOST> = {}) =>
    query(`INSERT INTO server_metrics (at, kind, data) VALUES ($1, 'host', $2::jsonb)`, [at, JSON.stringify({ ...HEALTHY_HOST, ...over })]);
  const putApp = (at: Date, oldest = 0) =>
    query(`INSERT INTO server_metrics (at, kind, data) VALUES ($1, 'app', $2::jsonb)`, [at, JSON.stringify({ queue: { oldest_age_s: oldest } })]);

  await t.test("healthy box: nothing is sent", async () => {
    await reset();
    await putHost(NOW);
    await putApp(NOW);
    assert.deepEqual(await run(NOW), []);
    assert.equal(sent.length, 0);
  });

  await t.test("a firing rule messages ONLY the active owner with Telegram, once, in Uzbek", async () => {
    await reset();
    await putHost(NOW, { mem_avail_mb: 400 });
    assert.deepEqual(await run(NOW), [{ rule: "mem_low", kind: "alert" }]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, OWNER);
    assert.match(sent[0].text, /^\[OGOHLANTIRISH\] SlaydX: Server xotirasi tugayapti: bo'sh xotira 5\.0%/);
    // The same condition on the next passes (and "after a restart": no in-memory state) stays silent.
    await putHost(min(1), { mem_avail_mb: 400 });
    assert.deepEqual(await run(min(1)), []);
    await putHost(min(2), { mem_avail_mb: 400 });
    assert.deepEqual(await run(min(2)), []);
    assert.equal(sent.length, 1, "spam: the same alert was sent again");
  });

  await t.test("cooldown: no reminder at +30 min, one reminder at +60 min, then silent again", async () => {
    await putHost(min(30), { mem_avail_mb: 400 });
    assert.deepEqual(await run(min(30)), []);
    await putHost(min(60), { mem_avail_mb: 400 });
    assert.deepEqual(await run(min(60)), [{ rule: "mem_low", kind: "remind" }]);
    assert.match(sent.at(-1)!.text, /^\[HALI HAM\] SlaydX: .* \(60 daqiqadan beri\)$/);
    await putHost(min(61), { mem_avail_mb: 400 });
    assert.deepEqual(await run(min(61)), []);
  });

  await t.test("recovery: one «normallashdi» message, then a quick relapse stays quiet until the cooldown is over", async () => {
    await putHost(min(70));
    assert.deepEqual(await run(min(70)), [{ rule: "mem_low", kind: "recover" }]);
    assert.match(sent.at(-1)!.text, /^\[NORMALLASHDI\] SlaydX: Server xotirasi normallashdi/);
    await putHost(min(71));
    assert.deepEqual(await run(min(71)), [], "recovery is announced once");
    await putHost(min(75), { mem_avail_mb: 300 });
    assert.deepEqual(await run(min(75)), [], "relapse inside the cooldown of the last message: quiet");
    await putHost(min(131), { mem_avail_mb: 300 });
    assert.deepEqual(await run(min(131)), [{ rule: "mem_low", kind: "alert" }]);
  });

  await t.test("each remaining rule fires exactly once on its own sample", async () => {
    const cases: Array<{ rule: string; text: RegExp; setup: () => Promise<void> }> = [
      { rule: "swap_high", text: /Swap to'lib bormoqda: 75%/, setup: () => putHost(NOW, { swap_used_mb: 3000 }) },
      { rule: "disk_high", text: /Server diski to'lyapti: 91%/, setup: () => putHost(NOW, { disk_pct: 91 }) },
      {
        rule: "load_high",
        text: /Server yuklamasi yuqori: load 9\.0 \(4 yadro/,
        setup: async () => {
          for (const m of [-10, -5, 0]) await putHost(min(m), { load1: 9 });
        },
      },
      {
        rule: "queue_stuck",
        text: /Navbat to'planib qoldi: eng eski ish 7\.0 daqiqadan/,
        setup: async () => {
          await putHost(NOW);
          await putApp(NOW, 420);
        },
      },
      {
        rule: "fail_ratio",
        text: /Ishlar ko'p xato bilan tugayapti: oxirgi 15 daqiqada 4 \/ 10 ta \(40%\)/,
        setup: async () => {
          await putHost(NOW);
          const u = (await query<{ id: string }>(`INSERT INTO users (name) VALUES ('fr') RETURNING id::text AS id`))[0].id;
          for (let i = 0; i < 10; i++) {
            await query(
              `INSERT INTO generations (id, user_id, tool_id, status, created_at, run_after, started_at, finished_at)
               VALUES ($1, $2, 'slide', $3, $4, $4, $4, $5)`,
              [randomUUID(), u, i < 4 ? "FAILED" : "COMPLETED", min(-20), min(-3)],
            );
          }
        },
      },
    ];
    for (const c of cases) {
      await reset();
      await c.setup();
      assert.deepEqual(await run(NOW), [{ rule: c.rule, kind: "alert" }], c.rule);
      assert.match(sent[0].text, c.text, c.rule);
      assert.deepEqual(await run(min(1)), [], `${c.rule}: second pass must be silent`);
      assert.equal(sent.length, 1, `${c.rule}: sent more than once`);
    }
  });

  await t.test("container events: baseline first, then one message per event window; cooldown merges a crash loop", async () => {
    await reset();
    const web = (o: Record<string, unknown>) => ({ containers: [{ ...HEALTHY_HOST.containers![0], ...o }] });
    await putHost(min(-30), web({}));
    assert.deepEqual(await run(min(-30)), [], "first pass only sets the baseline");
    await putHost(min(-25), web({}));
    assert.deepEqual(await run(min(-25)), []);
    await putHost(min(-20), web({ restarts: 1 }));
    assert.deepEqual(await run(min(-20)), [{ rule: "container_event", kind: "alert" }]);
    assert.match(sent[0].text, /konteyner hodisalari\nslaydx-web-1: qayta ishga tushdi \(restartlar 0 -&gt; 1\)/); // HTML-escaped for Telegram
    assert.deepEqual(await run(min(-19)), [], "the same sample is not reported twice");
    await putHost(min(-15), web({ restarts: 2 }));
    assert.deepEqual(await run(min(-15)), [], "inside the 15 minute event cooldown");
    await putHost(min(-4), web({ restarts: 2, oom: true }));
    assert.deepEqual(await run(min(-4)), [{ rule: "container_event", kind: "alert" }], "reported together after the cooldown");
    assert.match(sent[1].text, /qayta ishga tushdi \(restartlar 1 -&gt; 2\)[\s\S]*OOMKilled/);
    assert.deepEqual(await run(min(0)), []);
    assert.equal(sent.length, 2);
  });

  await t.test("a deploy (new container id) is not a restart alert", async () => {
    await reset();
    await putHost(min(-10), {});
    await run(min(-10));
    await putHost(min(-5), { containers: [{ ...HEALTHY_HOST.containers![0], id: "cccccccccccc" }] });
    assert.deepEqual(await run(min(-5)), []);
  });

  await t.test("delivery failure keeps the alert pending; it goes out on the next pass", async () => {
    await reset();
    await putHost(NOW, { disk_pct: 95 });
    failSend = true;
    assert.deepEqual(await run(NOW), []);
    failSend = false;
    await putHost(min(1), { disk_pct: 95 });
    assert.deepEqual(await run(min(1)), [{ rule: "disk_high", kind: "alert" }]);
  });

  await t.test("two processes that both read the old state send the message once (compare-and-set)", async () => {
    await reset();
    await putHost(NOW, { disk_pct: 95 });
    // Barrier: both passes finish reading the (empty) state before either one decides.
    let arrived = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const afterRead = async () => {
      if (++arrived === 2) release();
      await gate;
    };
    const pass = async () => (await A.runAlerts({ now: NOW, send, afterRead })).sent;
    const [a, b] = await Promise.all([pass(), pass()]);
    assert.equal(a.length + b.length, 1, JSON.stringify([a, b]));
    assert.equal(sent.length, 1);
  });

  await t.test("no owner to tell: no crash, the state still moves on", async () => {
    await reset();
    await query("UPDATE admin_accounts SET status = 'disabled' WHERE role = 'owner'");
    await putHost(NOW, { disk_pct: 95 });
    await run(NOW);
    assert.equal(sent.length, 0);
    assert.equal((await query("SELECT 1 FROM server_alert_state WHERE rule = 'disk_high' AND firing")).length, 1);
  });
});
