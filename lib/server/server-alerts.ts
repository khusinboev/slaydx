import "server-only";
import { query, queryOne } from "./db";
import { log } from "./log";
import { botConfigured, sendMessage } from "./telegram";

/**
 * Load alerts to the owners (docs/ops/METRICS.md). Evaluated once a minute by the housekeeping
 * leader right after the app sample is written. Inputs are the stored samples (`server_metrics`)
 * plus one count over `generations`; the host rules therefore only work while the host cron runs.
 *
 * Rules (thresholds below):
 *   mem_low        host memory available < 10 %
 *   swap_high      swap used > 50 %
 *   disk_high      root disk > 85 %
 *   load_high      load1 > 2 x CPUs for 10 minutes
 *   queue_stuck    oldest runnable QUEUED job older than 5 minutes
 *   fail_ratio     > 25 % of the jobs finished in the last 15 minutes failed (at least 8 jobs)
 *   container_event  a slaydx container restarted, was OOM-killed or stopped since the last sample
 *
 * Level rules keep a row in `server_alert_state`: one message when a rule starts firing, a reminder
 * at most every COOLDOWN while it keeps firing, one "normallashdi" message when it recovers. A rule
 * that recovers and fires again inside the cooldown stays silent until the cooldown is over. State is
 * in the DB, so a restart or a second worker never repeats a message. Messages go to every ACTIVE
 * owner with a linked Telegram.
 */

export const ALERT_THRESHOLDS = {
  /** mem_low: fire when MemAvailable / MemTotal is below this percentage. */
  memAvailMinPct: 10,
  /** swap_high: fire when swap used / swap total is above this percentage. */
  swapMaxPct: 50,
  /** disk_high: root disk usage above this percentage. */
  diskMaxPct: 85,
  /** load_high: load1 above this many times the CPU count ... */
  loadPerCpuMax: 2,
  /** ... for this long. */
  loadSustainMin: 10,
  /** queue_stuck: oldest runnable QUEUED job older than this. */
  queueMaxAgeSec: 300,
  /** fail_ratio: window, minimum finished jobs, and the ratio that must be exceeded. */
  failWindowMin: 15,
  failMinJobs: 8,
  failMaxRatio: 0.25,
  /** Minimum time between two messages of the same rule. */
  cooldownMin: 60,
  /** Minimum time between two container-event messages (a crash loop must not page every sample). */
  eventCooldownMin: 15,
  /** A host sample older than this is ignored (the cron stopped): host rules keep their last state. */
  hostStaleMin: 15,
  /** An app sample older than this is ignored the same way. */
  appStaleMin: 5,
} as const;
export type Thresholds = { [K in keyof typeof ALERT_THRESHOLDS]: number };

export type HostContainer = { name: string; id: string; status: string; restarts: number; oom: boolean };
export type HostData = {
  cpus: number | null;
  load1: number | null;
  mem_total_mb: number | null;
  mem_avail_mb: number | null;
  swap_total_mb: number | null;
  swap_used_mb: number | null;
  disk_pct: number | null;
  containers?: HostContainer[];
};
export type StoredSample<T> = { id: number; at: Date; data: T };
export type AppData = { queue?: { oldest_age_s?: number | null } };

/** What a rule found: `firing` true/false, or `null` = cannot tell (no fresh data) -> state untouched. */
export type Finding = { rule: string; firing: boolean | null; alert: string; ok: string };

const fmt = (n: number, d = 0): string => n.toFixed(d);
const pct = (a: number, b: number): number => (b > 0 ? (a / b) * 100 : 0);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ageMin = (at: Date, now: Date): number => (now.getTime() - at.getTime()) / 60_000;

export type EvalInput = {
  now: Date;
  /** Newest host samples, newest first (at least the last ~12 minutes). */
  host: StoredSample<HostData>[];
  app: StoredSample<AppData> | null;
  jobs: { failed: number; finished: number };
};

/** The level rules. Pure: no I/O, `now` is an input. */
export function evaluateLevelRules(inp: EvalInput, th: Thresholds = ALERT_THRESHOLDS): Finding[] {
  const out: Finding[] = [];
  const latest = inp.host[0];
  const hostFresh = latest && ageMin(latest.at, inp.now) <= th.hostStaleMin ? latest.data : null;

  const mem = (() => {
    if (!hostFresh || !isNum(hostFresh.mem_total_mb) || !isNum(hostFresh.mem_avail_mb)) return null;
    return { total: hostFresh.mem_total_mb, avail: hostFresh.mem_avail_mb, pct: pct(hostFresh.mem_avail_mb, hostFresh.mem_total_mb) };
  })();
  out.push({
    rule: "mem_low",
    firing: mem ? mem.pct < th.memAvailMinPct : null,
    alert: mem ? `Server xotirasi tugayapti: bo'sh xotira ${fmt(mem.pct, 1)}% (${fmt(mem.avail)} MB / ${fmt(mem.total)} MB). Chegara: ${th.memAvailMinPct}%.` : "",
    ok: mem ? `Server xotirasi normallashdi: bo'sh xotira ${fmt(mem.pct, 1)}% (${fmt(mem.avail)} MB / ${fmt(mem.total)} MB).` : "",
  });

  const swap = (() => {
    if (!hostFresh || !isNum(hostFresh.swap_total_mb) || !isNum(hostFresh.swap_used_mb)) return null;
    if (hostFresh.swap_total_mb <= 0) return { used: 0, total: 0, pct: 0 };
    return { used: hostFresh.swap_used_mb, total: hostFresh.swap_total_mb, pct: pct(hostFresh.swap_used_mb, hostFresh.swap_total_mb) };
  })();
  out.push({
    rule: "swap_high",
    firing: swap ? swap.pct > th.swapMaxPct : null,
    alert: swap ? `Swap to'lib bormoqda: ${fmt(swap.pct)}% band (${fmt(swap.used)} MB / ${fmt(swap.total)} MB). Chegara: ${th.swapMaxPct}%.` : "",
    ok: swap ? `Swap normallashdi: ${fmt(swap.pct)}% band (${fmt(swap.used)} MB).` : "",
  });

  const disk = hostFresh && isNum(hostFresh.disk_pct) ? hostFresh.disk_pct : null;
  out.push({
    rule: "disk_high",
    firing: disk === null ? null : disk > th.diskMaxPct,
    alert: disk === null ? "" : `Server diski to'lyapti: ${fmt(disk)}% band. Chegara: ${th.diskMaxPct}%.`,
    ok: disk === null ? "" : `Server diski normallashdi: ${fmt(disk)}% band.`,
  });

  // load_high: the newest sample decides recovery at once; firing needs an unbroken run of samples
  // above the limit that spans `loadSustainMin` (the cron samples every 5 minutes).
  const load = (() => {
    if (!hostFresh || !isNum(hostFresh.load1) || !isNum(hostFresh.cpus) || hostFresh.cpus <= 0) return null;
    const limit = th.loadPerCpuMax * hostFresh.cpus;
    if (hostFresh.load1 <= limit) return { state: false as const, load1: hostFresh.load1, limit, cpus: hostFresh.cpus };
    let oldest = latest.at;
    for (const s of inp.host) {
      if (!isNum(s.data.load1) || !isNum(s.data.cpus) || s.data.cpus <= 0 || s.data.load1 <= th.loadPerCpuMax * s.data.cpus) break;
      oldest = s.at;
    }
    const spanMin = (latest.at.getTime() - oldest.getTime()) / 60_000;
    // 30 s of slack: sample times jitter by a few seconds around the 5 minute cron.
    return { state: spanMin >= th.loadSustainMin - 0.5 ? (true as const) : null, load1: hostFresh.load1, limit, cpus: hostFresh.cpus };
  })();
  out.push({
    rule: "load_high",
    firing: load ? load.state : null,
    alert: load ? `Server yuklamasi yuqori: load ${fmt(load.load1, 1)} (${load.cpus} yadro, chegara ${fmt(load.limit, 1)}) ${th.loadSustainMin} daqiqadan beri.` : "",
    ok: load ? `Server yuklamasi normallashdi: load ${fmt(load.load1, 1)} (${load.cpus} yadro).` : "",
  });

  const appFresh = inp.app && ageMin(inp.app.at, inp.now) <= th.appStaleMin ? inp.app.data : null;
  const qAge = appFresh && isNum(appFresh.queue?.oldest_age_s) ? (appFresh.queue!.oldest_age_s as number) : null;
  out.push({
    rule: "queue_stuck",
    firing: qAge === null ? null : qAge > th.queueMaxAgeSec,
    alert: qAge === null ? "" : `Navbat to'planib qoldi: eng eski ish ${fmt(qAge / 60, 1)} daqiqadan beri kutmoqda. Chegara: ${th.queueMaxAgeSec / 60} daqiqa.`,
    ok: qAge === null ? "" : `Navbat normallashdi: eng eski kutayotgan ish ${fmt(qAge)} soniya.`,
  });

  const { failed, finished } = inp.jobs;
  const ratio = finished > 0 ? failed / finished : 0;
  out.push({
    rule: "fail_ratio",
    firing: finished >= th.failMinJobs && ratio > th.failMaxRatio,
    alert: `Ishlar ko'p xato bilan tugayapti: oxirgi ${th.failWindowMin} daqiqada ${failed} / ${finished} ta (${fmt(ratio * 100)}%). Chegara: ${fmt(th.failMaxRatio * 100)}%.`,
    ok: `Ishlar xatosi normallashdi: oxirgi ${th.failWindowMin} daqiqada ${failed} / ${finished} ta (${fmt(ratio * 100)}%).`,
  });
  return out;
}

/**
 * Container events between two consecutive host samples of the SAME container id: a higher restart
 * count, a fresh OOM flag, or a running container that is no longer running. A container that was
 * replaced (new id, e.g. a deploy) is not an event. Returns Uzbek lines.
 */
export function containerEvents(prev: HostData | undefined, cur: HostData): string[] {
  const out: string[] = [];
  if (!prev?.containers || !cur.containers) return out;
  const before = new Map(prev.containers.map((c) => [c.name, c]));
  for (const c of cur.containers) {
    const p = before.get(c.name);
    if (!p || p.id !== c.id) continue;
    const restarted = c.restarts > p.restarts;
    const oom = c.oom && (!p.oom || restarted);
    if (oom) out.push(`${c.name}: xotira chegarasiga urilib o'ldirildi (OOMKilled)${restarted ? `, qayta ishga tushdi (${p.restarts} -> ${c.restarts})` : ""}`);
    else if (restarted) out.push(`${c.name}: qayta ishga tushdi (restartlar ${p.restarts} -> ${c.restarts})`);
    else if (p.status === "running" && c.status !== "running") out.push(`${c.name}: to'xtadi (holat: ${c.status})`);
  }
  return out;
}

// ───────────────────────────── state machine (pure)

export type RuleState = { rule: string; firing: boolean; since: Date | null; lastSentAt: Date | null };
export type Action = { rule: string; send: "alert" | "remind" | "recover" | null; next: { firing: boolean; since: Date | null; lastSentAt: Date | null } | null };

/**
 * Decides what to do for one finding. `null` finding (no data) and "nothing changed" return
 * `next: null` (state untouched, nothing sent).
 *   not firing -> firing    : send an alert (unless the last message of this rule is younger than
 *                             the cooldown: then wait, state stays "not firing")
 *   firing -> firing        : a reminder once the cooldown has passed
 *   firing -> not firing    : one recovery message
 */
export function decide(f: Finding, st: RuleState | undefined, now: Date, cooldownMin: number): Action {
  if (f.firing === null) return { rule: f.rule, send: null, next: null };
  const cooled = !st?.lastSentAt || now.getTime() - st.lastSentAt.getTime() >= cooldownMin * 60_000;
  if (f.firing) {
    if (!st?.firing) {
      if (!cooled) return { rule: f.rule, send: null, next: null };
      return { rule: f.rule, send: "alert", next: { firing: true, since: now, lastSentAt: now } };
    }
    if (cooled) return { rule: f.rule, send: "remind", next: { firing: true, since: st.since, lastSentAt: now } };
    return { rule: f.rule, send: null, next: null };
  }
  if (st?.firing) return { rule: f.rule, send: "recover", next: { firing: false, since: null, lastSentAt: now } };
  return { rule: f.rule, send: null, next: null };
}

// ───────────────────────────── I/O

const NAME = "SlaydX";
const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderMessage(kind: "alert" | "remind" | "recover", f: Finding, sinceMin?: number): string {
  if (kind === "recover") return `[NORMALLASHDI] ${NAME}: ${escapeHtml(f.ok)}`;
  if (kind === "remind") return `[HALI HAM] ${NAME}: ${escapeHtml(f.alert)}${sinceMin ? ` (${Math.round(sinceMin)} daqiqadan beri)` : ""}`;
  return `[OGOHLANTIRISH] ${NAME}: ${escapeHtml(f.alert)}`;
}

/** Telegram ids of every ACTIVE owner-role admin with a linked Telegram account. */
export async function ownerTelegramIds(): Promise<string[]> {
  const rows = await query<{ tg: string }>(
    `SELECT u.telegram_id::text AS tg
       FROM admin_accounts a JOIN users u ON u.id = a.user_id
      WHERE a.role = 'owner' AND a.status = 'active' AND u.telegram_id IS NOT NULL AND NOT u.is_blocked
      ORDER BY a.id`,
  );
  return rows.map((r) => r.tg);
}

export type Send = (chatId: string, text: string) => Promise<boolean>;
const defaultSend: Send = async (chatId, text) => {
  if (!botConfigured()) return false;
  try {
    return await sendMessage(chatId, text);
  } catch (e) {
    log("warn", "[metrics] alert message failed", { err: e });
    return false;
  }
};

type StateRow = { rule: string; firing: boolean; since: Date | null; last_sent_at: Date | null; detail: Record<string, unknown> };

async function loadStates(): Promise<Map<string, StateRow>> {
  const rows = await query<StateRow>("SELECT rule, firing, since, last_sent_at, detail FROM server_alert_state");
  return new Map(rows.map((r) => [r.rule, r]));
}

/**
 * Sends `text` to every owner. Returns true when at least one delivery succeeded or there is nobody
 * to tell (so the state moves on instead of retrying every minute forever).
 */
async function notify(text: string, send: Send): Promise<boolean> {
  const ids = await ownerTelegramIds();
  if (ids.length === 0) {
    log("warn", "[metrics] alert has no recipient (no active owner with a linked Telegram)");
    return true;
  }
  let ok = false;
  for (const id of ids) if (await send(id, text)) ok = true;
  return ok;
}

type Row<T> = { id: string; at: Date; data: T };
const toSample = <T>(r: Row<T> | undefined | null): StoredSample<T> | null => (r ? { id: Number(r.id), at: new Date(r.at), data: r.data } : null);

export type RunAlertsOptions = {
  now?: Date;
  send?: Send;
  thresholds?: Thresholds;
  /** Test seam: awaited after the state rows are read and before any decision (lets a test interleave two passes). */
  afterRead?: () => Promise<void>;
};
export type RunAlertsResult = { sent: Array<{ rule: string; kind: string }> };

/**
 * One evaluation pass. Safe to call from several processes: every transition is a compare-and-set
 * on the rule's row (`last_sent_at` must still be what we read), so only one caller sends.
 */
export async function runAlerts(opts: RunAlertsOptions = {}): Promise<RunAlertsResult> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? defaultSend;
  const th = opts.thresholds ?? ALERT_THRESHOLDS;
  const sent: RunAlertsResult["sent"] = [];

  const hostRows = await query<Row<HostData>>(
    `SELECT id::text, at, data FROM server_metrics WHERE kind = 'host' AND at <= $1 AND at > $1::timestamptz - interval '40 minutes' ORDER BY at DESC LIMIT 12`,
    [now],
  );
  const appRow = await queryOne<Row<AppData>>(
    "SELECT id::text, at, data FROM server_metrics WHERE kind = 'app' AND at <= $1 ORDER BY at DESC LIMIT 1",
    [now],
  );
  const jobs = await queryOne<{ failed: number; finished: number }>(
    `SELECT count(*) FILTER (WHERE status = 'FAILED')::int AS failed, count(*)::int AS finished
       FROM generations
      WHERE created_at > $1::timestamptz - interval '6 hours'
        AND finished_at > $1::timestamptz - make_interval(mins => $2) AND finished_at <= $1
        AND status IN ('COMPLETED', 'FAILED')`,
    [now, th.failWindowMin],
  );
  const host = hostRows.map((r) => toSample(r)!);
  const states = await loadStates();
  await opts.afterRead?.();

  const findings = evaluateLevelRules({ now, host, app: toSample(appRow), jobs: jobs ?? { failed: 0, finished: 0 } }, th);
  for (const f of findings) {
    const row = states.get(f.rule);
    const st: RuleState | undefined = row ? { rule: f.rule, firing: row.firing, since: row.since, lastSentAt: row.last_sent_at } : undefined;
    const act = decide(f, st, now, th.cooldownMin);
    if (!act.send || !act.next) continue;
    // Compare-and-set first: if another process moved this rule, it also sent the message.
    const claimed = await query(
      `INSERT INTO server_alert_state (rule, firing, since, last_sent_at, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (rule) DO UPDATE SET firing = EXCLUDED.firing, since = EXCLUDED.since, last_sent_at = EXCLUDED.last_sent_at, updated_at = now()
        WHERE server_alert_state.last_sent_at IS NOT DISTINCT FROM $5::timestamptz
       RETURNING rule`,
      [f.rule, act.next.firing, act.next.since, act.next.lastSentAt, st?.lastSentAt ?? null],
    );
    if (claimed.length === 0) continue;
    const sinceMin = st?.since ? (now.getTime() - st.since.getTime()) / 60_000 : undefined;
    const delivered = await notify(renderMessage(act.send, f, sinceMin), send);
    if (delivered) {
      sent.push({ rule: f.rule, kind: act.send });
    } else {
      // Nobody got it: put the old state back so the next pass tries again.
      await query(
        `UPDATE server_alert_state SET firing = $2, since = $3, last_sent_at = $4, updated_at = now() WHERE rule = $1`,
        [f.rule, st?.firing ?? false, st?.since ?? null, st?.lastSentAt ?? null],
      );
    }
  }

  await runContainerEvents(hostRows, states.get("container_event"), now, th, send, sent);
  return { sent };
}

/**
 * container_event: walks the host samples newer than the last processed one (kept in
 * `server_alert_state.detail.last_host_id`) and reports restarts / OOM / stops between consecutive
 * samples. The first pass ever only sets the baseline. Within the event cooldown nothing is sent and
 * nothing is marked processed, so the events are reported (together) once the cooldown is over.
 */
async function runContainerEvents(
  newestFirst: Row<HostData>[],
  row: StateRow | undefined,
  now: Date,
  th: Thresholds,
  send: Send,
  sent: RunAlertsResult["sent"],
): Promise<void> {
  if (newestFirst.length === 0) return;
  const asc = [...newestFirst].reverse();
  const newest = asc[asc.length - 1];
  const lastId = row && typeof row.detail?.last_host_id === "string" ? Number(row.detail.last_host_id) : null;
  const save = (lastSentAt: Date | null, expected: Date | null) =>
    query(
      `INSERT INTO server_alert_state (rule, firing, last_sent_at, detail, updated_at)
       VALUES ('container_event', false, $1, jsonb_build_object('last_host_id', $2::text), now())
       ON CONFLICT (rule) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at, detail = EXCLUDED.detail, updated_at = now()
        WHERE server_alert_state.last_sent_at IS NOT DISTINCT FROM $3::timestamptz
       RETURNING rule`,
      [lastSentAt, newest.id, expected],
    );
  if (lastId === null) {
    await save(row?.last_sent_at ?? null, row?.last_sent_at ?? null);
    return;
  }
  const fresh = asc.filter((r) => Number(r.id) > lastId);
  if (fresh.length === 0) return;
  const lines: string[] = [];
  let prev = asc.find((r) => Number(r.id) === lastId)?.data ?? undefined;
  for (const r of fresh) {
    for (const l of containerEvents(prev, r.data)) lines.push(`${l} (${new Date(r.at).toISOString().slice(11, 16)} UTC)`);
    prev = r.data;
  }
  if (lines.length === 0) {
    await save(row?.last_sent_at ?? null, row?.last_sent_at ?? null);
    return;
  }
  const last = row?.last_sent_at ?? null;
  if (last && now.getTime() - last.getTime() < th.eventCooldownMin * 60_000) return; // report later, together
  const claimed = await save(now, last);
  if (claimed.length === 0) return;
  const text = `[OGOHLANTIRISH] ${NAME}: konteyner hodisalari\n${lines.slice(0, 10).map(escapeHtml).join("\n")}`;
  if (await notify(text, send)) sent.push({ rule: "container_event", kind: "alert" });
  else await query(`UPDATE server_alert_state SET last_sent_at = $1, detail = jsonb_build_object('last_host_id', $2::text) WHERE rule = 'container_event'`, [last, String(lastId)]);
}
