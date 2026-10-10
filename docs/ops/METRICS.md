# Server load history («Yuklama tarixi»)

Added 2026-10-10 (owner: after the 20 → 2 200 users jump we want to be able to say, days later, *how busy it was,
how heavy the load was and at how many concurrent users it slowed down or ran out of memory*). Until now only `sar`
(host-level) existed; there was no time series of the app or the containers.

Everything lands in ONE table, `server_metrics` (migration `049_server_metrics.sql`): `id`, `at` (default `now()`,
indexed `DESC`), `kind` (`'host'` | `'app'`), `data` (jsonb). Retention is 90 days.

## 1. What is recorded

| kind | written by | every | content (`data`) |
|---|---|---|---|
| `host` | root host cron `deploy/ops/slaydx-metrics.sh` | 5 min | `cpus`, `load1/5/15`, `mem_total_mb`, `mem_used_mb` (= total − available), `mem_avail_mb`, `swap_total_mb`, `swap_used_mb`, `disk_pct` (`/`), `containers[]` (only `slaydx-*`: `name`, `id`, `status`, `restarts`, `oom`, `started_at`, `cpu_pct`, `mem_mb`, `mem_limit_mb`), `nginx` (last 5 min of the slaydx access log: `requests`, `s2xx/s3xx/s4xx/s5xx`, `p50_ms`, `p95_ms`; `null` when the log does not exist) |
| `app` | the housekeeping **leader** worker, `lib/server/server-metrics.ts` | 1 min | `users.active_5m`, `users.seen_1h`, `queue.queued/running/oldest_age_s`, `jobs.completed/failed` (last 5 min), `jobs.wait_p50_s/p95_s` and `jobs.dur_p50_s/p95_s` of those jobs, `db.conns/conns_active/max_conns/size_mb/by_app{}` and `db.pool.total/idle/waiting` (the sampling worker's own pool), `proc.rss_mb/heap_mb/loop_lag_p99_ms/loop_lag_max_ms` (the sampling worker) |
| — | `server_alert_state` table | — | one row per alert rule: firing flag, since, last message time (so a restart never repeats a message) |

Notes on the numbers:

* **Active users** (`users.active_5m`) = distinct users that, in the last 5 minutes, have a job waiting/running, created
  or finished a job, logged in or had their session "seen", or hit a per-user rate-limit bucket (form draft autosave,
  document edit, source extraction, download polling, uploads). It is built only from data the app already writes —
  **no per-request write was added**. It is a floor, not an exact head-count: `sessions.last_seen_at` is written at most
  once an hour (that is the existing design), so a user who is only reading a page is invisible. For the question
  «at how many users did it slow down» the *trend* is what matters; `users.seen_1h` is the second, wider signal.
* `jobs.wait_*` = `started_at − run_after` (how long the job really waited to be picked up; a retry back-off is not
  counted as waiting); `jobs.dur_*` = `finished_at − started_at`. Both over jobs that **finished** in the last 5 minutes.
* `queue.oldest_age_s` = age of the oldest QUEUED job that is runnable now.
* The app sample is taken by one worker only (advisory lock `HOUSEKEEPING_LOCK_ID`) and is skipped when a sample younger
  than 45 s exists, so two workers never double-write. DB connections (`db.conns`) are the whole database, per
  `application_name` in `db.by_app`; `db.pool.*` is only that worker's pool (the web pool is not visible from there).
* Host CPU: the box is shared, so we record `load1/5/15` for the whole host and CPU % per slaydx container.

## 2. Installing the host cron (server, root) — the lead does this

The app side needs nothing: it starts sampling after the deploy that contains migration 049 (the worker leader writes
a row a minute). The host cron must be installed **after that deploy** (the table must exist).

```bash
# 1. get the new files onto the box (deploy/ scripts are NOT updated by slaydx-deploy)
cd /opt/slaydx && git fetch -q origin && git reset -q --hard origin/main

# 2. dry run: shows /etc/cron.d/slaydx-metrics + logrotate, writes nothing
bash deploy/install-ops.sh --dry-run | sed -n '/slaydx-metrics/,+4p'

# 3. install: /usr/local/bin/slaydx-metrics (root-owned copy), /etc/cron.d/slaydx-metrics, logrotate entry
bash deploy/install-ops.sh

# 4. one manual run and look at it (no secrets in the output); --print inserts nothing
/usr/local/bin/slaydx-metrics --print | head -c 600; echo
/usr/local/bin/slaydx-metrics            # inserts one row; silent on success
docker exec -i slaydx-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT at, kind, left(data::text, 80) FROM server_metrics ORDER BY id DESC LIMIT 3"'
tail -n 5 /var/log/slaydx-metrics.log    # empty = good; the script logs ONE line per failure and always exits 0
```

`install-ops.sh` is idempotent and only touches the slaydx cron/logrotate files and `/usr/local/bin/slaydx-metrics`.
Re-run it after the script changes. To stop recording: `rm /etc/cron.d/slaydx-metrics` (the app sample keeps running).

### nginx request counts (optional, one reload)

The shared `access.log` has every site on the box and no host field, so it cannot be split per site. The template
`deploy/nginx/slaydx.conf.example` therefore adds a second, tiny log for the slaydx site only:

```nginx
# http{} (shared context):   log_format slaydx_metrics '$msec $status $request_time';
# slaydx :443 server{}:      access_log /var/log/nginx/slaydx.access.log slaydx_metrics if=$slaydx_loggable;
```

Add those two lines to the live config (`nginx -t && systemctl reload nginx` — a reload does not drop connections),
and rotate the file like `access.log` (e.g. copy the stanza of `/etc/logrotate.d/nginx`, `daily`, `rotate 7`). Without
it everything else is still recorded and the «So'rovlar va xatolar» chart explains why it is empty. Requests carrying
the `?bt=` bot token are deliberately absent from this log too (same `$slaydx_loggable` rule).

## 3. Alerts

Evaluated every minute by the housekeeping leader right after the app sample (`lib/server/server-alerts.ts`). The
message goes (bot, Uzbek) to **every ACTIVE owner-role admin with a linked Telegram**. Thresholds are the named
constants `ALERT_THRESHOLDS` in that file.

| rule | fires when | constant |
|---|---|---|
| `mem_low` | host memory available < 10 % of total | `memAvailMinPct` 10 |
| `swap_high` | swap used > 50 % | `swapMaxPct` 50 |
| `disk_high` | root disk > 85 % | `diskMaxPct` 85 |
| `load_high` | `load1` > 2 × CPUs for 10 min (an unbroken run of host samples spanning 10 min) | `loadPerCpuMax` 2, `loadSustainMin` 10 |
| `queue_stuck` | oldest runnable QUEUED job older than 5 min | `queueMaxAgeSec` 300 |
| `fail_ratio` | > 25 % of the jobs finished in the last 15 min failed (at least 8 jobs) | `failMaxRatio` 0.25, `failWindowMin` 15, `failMinJobs` 8 |
| `container_event` | a slaydx container restarted, was OOM-killed or stopped between two host samples (a replaced container, i.e. a deploy, is not an event) | `eventCooldownMin` 15 |

Behaviour: one `[OGOHLANTIRISH]` message when a rule starts firing; a `[HALI HAM]` reminder at most every
`cooldownMin` (60 min) while it keeps firing; one `[NORMALLASHDI]` message when it clears. A rule that clears and fires
again inside the cooldown of its last message stays quiet until the cooldown is over. The state lives in
`server_alert_state`, and every transition is a compare-and-set on that row, so a restart or two workers cannot repeat
a message. Host rules need fresh host samples (older than 15 min = the cron stopped = the rule keeps its last state,
it does not "recover"). This complements `scripts/watchdog.sh` (which stays the box-level, bot-independent alarm); it
does not replace it.

## 4. Reading it

* **Admin → Tizim holati → «Yuklama tarixi»**: range switch 24 soat / 7 kun / 30 kun; memory + swap, load (with the
  2 × CPU line), per-container memory, requests/min with 4xx/5xx, and — on one time axis — active users, queue depth and
  job wait p95 (this is the «at N users it slowed down» view), DB connections, plus the table «Eng yuqori nuqtalar»
  (peak users with the queue/wait at that moment, peak memory, longest queue wait, peak job wait, peak load) with exact
  timestamps. API: `GET /api/admin/system/metrics?range=24h|7d|30d` (permission `system.view`), downsampled in SQL
  (`date_bin`; max per bucket so spikes stay visible; at most 800 points per series, `truncated` says if more existed).
* Rule of thumb: queue depth and `wait_p95` rising while active users climb = the workers are the limit (raise
  `WORKER_CONCURRENCY` or add a worker). `mem_used` ≥ 90 % with swap growing = memory is the limit (per-container chart
  shows who). `db.conns` close to `max_conns` or `pool.waiting` > 0 = connection limit. Load above 2 × CPUs with queue
  empty = CPU shared with the other projects on the box (compare with `sar`).

## 5. SQL for a post-mortem

Run on the server (nothing needs credentials on the command line; the user/db come from the container's own env):

```bash
docker exec -i slaydx-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
-- everything around 2026-10-10 19:00 Tashkent (+/- 30 min), newest data last
SELECT at AT TIME ZONE 'Asia/Tashkent' AS local_time, kind, data
  FROM server_metrics
 WHERE at BETWEEN timestamptz '2026-10-10 19:00+05' - interval '30 minutes'
              AND timestamptz '2026-10-10 19:00+05' + interval '30 minutes'
 ORDER BY at;
SQL
```

```sql
-- users vs queue vs job wait vs DB connections, 5-minute buckets, last 24 h
SELECT date_bin('5 minutes', at, timestamptz '2000-01-01') AT TIME ZONE 'Asia/Tashkent' AS t,
       max((data->'users'->>'active_5m')::int)      AS users,
       max((data->'queue'->>'queued')::int)         AS queued,
       max((data->'queue'->>'oldest_age_s')::int)   AS oldest_s,
       max((data->'jobs'->>'wait_p95_s')::float8)   AS wait_p95_s,
       max((data->'db'->>'conns')::int)             AS db_conns
  FROM server_metrics
 WHERE kind = 'app' AND at > now() - interval '24 hours'
 GROUP BY 1 ORDER BY 1;

-- the first moments job wait exceeded a minute, and how many users there were
SELECT at AT TIME ZONE 'Asia/Tashkent' AS t, (data->'users'->>'active_5m')::int AS users,
       (data->'queue'->>'queued')::int AS queued, (data->'jobs'->>'wait_p95_s')::float8 AS wait_p95_s
  FROM server_metrics
 WHERE kind = 'app' AND (data->'jobs'->>'wait_p95_s')::float8 > 60
 ORDER BY at LIMIT 10;

-- host memory / swap / load, 5-minute samples
SELECT at AT TIME ZONE 'Asia/Tashkent' AS t, (data->>'mem_avail_mb')::int AS avail_mb,
       (data->>'swap_used_mb')::int AS swap_mb, (data->>'load1')::float8 AS load1, (data->>'disk_pct')::int AS disk_pct
  FROM server_metrics
 WHERE kind = 'host' AND at > now() - interval '24 hours'
 ORDER BY at;

-- which container used how much memory (peak per container, last 7 days)
SELECT c->>'name' AS container, max((c->>'mem_mb')::float8) AS peak_mb, max((c->>'cpu_pct')::float8) AS peak_cpu_pct
  FROM server_metrics m, jsonb_array_elements(m.data->'containers') c
 WHERE m.kind = 'host' AND m.at > now() - interval '7 days'
 GROUP BY 1 ORDER BY 2 DESC;

-- restarts / OOM kills seen by the host sampler
SELECT m.at AT TIME ZONE 'Asia/Tashkent' AS t, c->>'name' AS container, c->>'restarts' AS restarts, c->>'oom' AS oom, c->>'status' AS status
  FROM server_metrics m, jsonb_array_elements(m.data->'containers') c
 WHERE m.kind = 'host' AND ((c->>'oom')::boolean OR (c->>'restarts')::int > 0 OR c->>'status' <> 'running')
 ORDER BY m.at DESC LIMIT 50;

-- alert state and the last time each rule messaged the owners
SELECT rule, firing, since, last_sent_at FROM server_alert_state ORDER BY rule;
```

## 6. Limits and operating notes

* Cost: one row a minute (`app`, ~1 KB) + one row per 5 minutes (`host`, ~2 KB) ≈ 2 MB/day, ≈ 180 MB at 90 days;
  the sampler runs 5 small read-only queries (10 s statement timeout) on one connection; the host script takes a few
  seconds (`docker stats --no-stream`) every 5 minutes. Nothing touches a request path.
* The purge (`purgeServerMetrics`, rows older than 90 days) runs in the housekeeping pass every 6 hours.
* If the host cron stops, host charts have gaps and the host alert rules freeze (no false «normallashdi»); if the leader
  worker is down, `app` rows stop and the existing watchdog / `process_heartbeats` alarms are the signal.
* Rollback: `049_server_metrics.sql` carries its rollback block (drops both tables); remove `/etc/cron.d/slaydx-metrics`
  and `/usr/local/bin/slaydx-metrics` first. The code tolerates an empty table (UI shows the empty state).
