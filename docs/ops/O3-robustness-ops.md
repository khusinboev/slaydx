# O3 — Production robustness + ops (research, read-only)

Evidence: `ops/prod-snapshot.txt` (S:line), repo at `main` (`926fcc7` + docs), memory notes (backup cron 2026-10-03, fail2ban/ufw/key-only SSH
from the migration log). Nothing was run against prod.

## TL;DR — ranked (impact ÷ effort; all items add ~0 server load)

| # | Finding | Impact | Effort | Server load |
|---|---------|--------|--------|-------------|
| 1 | **No uptime/health alert at all** (S:151-152 "none"). Docker `HEALTHCHECK`s exist (Dockerfile:91, compose worker:209) but `restart: unless-stopped` **never restarts an `unhealthy` container** — a wedged web/worker stays down silently. Error log is persisted (`lib/server/error-sink.ts`, table `error_log`, mig 029) but **nothing alerts** (only admin-login notices via `notifyAdmin`, `admin-accounts.ts:140`). A provider outage (all jobs FAILED + refunded) is invisible. | High | S | ~0 |
| 2 | **Backups: RPO 24 h on a money ledger**; restore drill (`scripts/restore-check.sh`) exists but has **no alert, no timing, unpinned image** (`postgres:16-alpine` ≠ prod `16.15-alpine3.24` → extra pull); unknown if scheduled. `/root/slaydx-backups` = **4.9 GB / 30 files** (S:149-150) while 7 × ~300 MB `.dump` ≈ 2.1 GB → the rest are almost certainly pre-deploy **plain `.sql`** dumps (`.claude/deploy.md` §1) that `backup.sh:137` never prunes (`-name 'slaydx-*.dump'` only). Google Drive keeps 30 dailies ≈ 9 GB and grows with the DB (free Drive = 15 GB shared with Gmail). | High | S | ~0 (hourly ledger dump ≈ 2 s CPU) |
| 3 | **Disk: 25 GB build cache (24.5 reclaimable) + 27.7 GB images (93 % reclaimable)** (S:28-32) = 52 GB of the 60 GB used. No routine cleanup; deploy.md forbids global prune (correctly). Each deploy adds 2 × ~2 GB images. | Med-High | S | cleanup = brief IO spike, run off-peak |
| 4 | **Memory**: limits are ceilings, not the risk (idle RSS web 97 MB, workers 93 MB, pg 288 MB — S:13-26; loadtest peaks web 351 MB / worker 194 MB, `loadtests/results/after/summary.md`). Real risk = **on-box builds** (2–3 GB) + conversion peaks + neighbours → swap (3.9 GB swap used with 4.5 GB RAM "available" = build residue). No OOM/restart visibility. | Med | S (monitor) / O1 (builds off box) | 0 |
| 5 | **nginx prod ≠ repo template**: prod has no `http2`, no `/_next/static` cache, `proxy_buffering off` site-wide, `Connection "upgrade"` on every request (no upstream keepalive) (S:76-96 vs `deploy/nginx/slaydx.conf.example`). Static JS/CSS is gzip'd by Node per request (Next `compress` default). Low traffic → low urgency. | Low-Med | S | reduces Node CPU |
| 6 | **Postgres**: settings fit (compose:42-56: shared_buffers 256MB/1 GB, work_mem 16MB, autovacuum 0.05, idle-tx 60 s). Gaps: `pg_stat_statements` is preloaded but **`CREATE EXTENSION` never runs** (grep: no migration) → no slow-query stats; `effective_cache_size` default 4 GB > container 1 GB; `random_page_cost` 4 on SSD. DB 413 MB: `generation_files` 198 MB + `generation_assets` 181 MB (S:133-136). Retention purges only bonus-paid docs after 180 d (`lib/server/retention.ts`); paid docs forever → DB and every dump grow linearly. | Low-Med | XS | 0 |
| 7 | **Docker logs**: fine. daemon 10m×3 (S:44), slaydx services 20m×5 (compose:60-65,97-101,147-151) → ≤ 400 MB cap. Only `/var/log/slaydx-backup.log` has no logrotate (tiny). | Low | XS | 0 |
| 8 | **App resilience**: largely done — stale-lock reaper with attempt cap (`jobs.ts:1005-1050`, attempts < 2), deploy requeue, refund reconcile, QUEUED TTL, admission 429 (`admission.ts`), per-user inflight cap, DB rate limits (`ratelimit.ts:52`), soffice gate (`soffice-gate.ts`, PDF_MAX_CONCURRENCY 2), 16-step housekeeping with status table, process guards (`scripts/worker.ts:13`). Gaps are **observability** (item 1), not mechanisms. | Low | — | — |
| 9 | **Security** (list only): key-only SSH, ufw, fail2ban present (migration log). To verify: unattended-upgrades, pending reboot, `server_tokens off`, Docker bypasses ufw (call-tizim `0.0.0.0:8095` public — not ours), compose falls back to `POSTGRES_PASSWORD=slaydx` if `.env` lacks it, HSTS `preload` sent by Next (`next.config.ts:150`) vs template "no preload", leaked call-tizim JWT secret not yet rotated (memory). | Med | XS each | 0 |

---

## 1. Monitoring / alerting (recommended: 3 layers, zero new servers)

**A. Box-local watchdog** (bash, cron `*/3`, reuses `/etc/slaydx/backup.env` which already holds `TELEGRAM_BOT_TOKEN` + `BACKUP_TG_CHAT`).
Cost: 1 `docker exec psql` + 4 `docker inspect` + 1 local curl per run ≈ <0.2 s CPU. Alerts on state change, repeats ≤ hourly, sends "resolved".
Checks: public health through nginx/TLS, container status+health+OOMKilled+RestartCount, disk ≥ 85 %, MemAvailable < 400 MB / swap > 6 GB,
oldest QUEUED > 10 min, FAILED ratio in last 15 min, **new error fingerprints** (new `error_log.id`), `REFUND_FAILED`, housekeeping step failing,
newest `.dump` older than 26 h, TLS cert < 14 days. Optional auto-restart of an `unhealthy` `slaydx-*` container after 3 consecutive runs (max 1/30 min).

```bash
#!/usr/bin/env bash
# scripts/watchdog.sh — /etc/cron.d/slaydx-watchdog: */3 * * * * root /opt/slaydx/scripts/watchdog.sh >>/var/log/slaydx-watchdog.log 2>&1
# Touches ONLY slaydx-* containers. Never prints secrets.
set -uo pipefail
ENV_FILE=${WATCHDOG_ENV_FILE:-/etc/slaydx/backup.env}; [ -r "$ENV_FILE" ] && . "$ENV_FILE"
CHAT=${ALERT_TG_CHAT:-${BACKUP_TG_CHAT:-}}; ST=/var/lib/slaydx-watchdog; mkdir -p "$ST"
AUTO_RESTART=${WATCHDOG_AUTO_RESTART:-0}
tg(){ [ -n "$CHAT" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && curl -s -m 10 -o /dev/null \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$1"; }
state(){ local k=$1 ok=$2 msg=$3 f="$ST/$1"            # fire on change, repeat hourly, announce recovery
  if [ "$ok" = 1 ]; then [ -f "$f" ] && { tg "[OK] slaydx: $k recovered"; rm -f "$f"; }; return; fi
  if [ ! -f "$f" ] || [ $(( $(date +%s) - $(stat -c %Y "$f") )) -ge 3600 ]; then tg "[ALERT] slaydx: $msg"; touch "$f"; fi; }

code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve slaydxx.uz:443:127.0.0.1 https://slaydxx.uz/api/health)
state health "$([ "$code" = 200 ] && echo 1 || echo 0)" "/api/health -> $code"
for c in slaydx-web-1 slaydx-worker-1 slaydx-worker-2 slaydx-postgres-1; do
  s=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}healthy{{end}} {{.State.OOMKilled}} {{.RestartCount}}' "$c" 2>/dev/null || echo "missing - - -")
  set -- $s; state "ctr-$c" "$([ "$1 $2" = "running healthy" ] && echo 1 || echo 0)" "$c: $1/$2"
  [ "$3" = true ] && state "oom-$c" 0 "$c OOMKilled (restarts=$4)"
  prev=$(cat "$ST/rc-$c" 2>/dev/null || echo "$4"); echo "$4" > "$ST/rc-$c"; [ "$4" -gt "$prev" ] 2>/dev/null && tg "[ALERT] slaydx: $c restarted ($prev->$4)"
  if [ "$AUTO_RESTART" = 1 ] && [ "$2" = unhealthy ]; then n=$(( $(cat "$ST/uh-$c" 2>/dev/null || echo 0) + 1 )); echo $n > "$ST/uh-$c"
    if [ $n -ge 3 ] && [ -z "$(find "$ST/restarted-$c" -mmin -30 2>/dev/null)" ]; then docker restart -t 60 "$c" >/dev/null && touch "$ST/restarted-$c" && tg "[ACTION] slaydx: restarted unhealthy $c"; fi
  else rm -f "$ST/uh-$c"; fi
done
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9); state disk "$([ "$disk" -lt 85 ] && echo 1 || echo 0)" "disk ${disk}%"
avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo); swap=$(free -m | awk '/Swap/{print $3}')
state mem "$([ "$avail" -ge 400 ] && [ "$swap" -lt 6144 ] && echo 1 || echo 0)" "RAM avail ${avail} MB, swap ${swap} MB"
last=$(cat "$ST/errid" 2>/dev/null || echo 0)
q=$(docker exec slaydx-postgres-1 psql -U slaydx -d slaydx -tA -F'|' -c "
 SELECT coalesce(extract(epoch from now()-min(created_at) FILTER (WHERE status='QUEUED')),0)::int,
        count(*) FILTER (WHERE status='FAILED' AND finished_at > now()-interval '15 min'),
        count(*) FILTER (WHERE finished_at > now()-interval '15 min'),
        (SELECT coalesce(max(id),$last) FROM error_log),
        (SELECT count(*) FROM error_log WHERE level='error' AND id > $last),
        (SELECT string_agg(left(scope||': '||message,160), E'\n') FROM (SELECT scope,message FROM error_log WHERE level='error' AND id > $last ORDER BY id LIMIT 3) e),
        (SELECT count(*) FROM error_log WHERE message LIKE '%pul qaytarilmadi%' AND last_seen_at > now()-interval '4 min'),
        (SELECT count(*) FROM housekeeping_status WHERE last_error_at > coalesce(last_ok_at,'epoch'))
 FROM generations WHERE status='QUEUED' OR finished_at > now()-interval '15 min'" 2>/dev/null)
IFS='|' read -r oldq failed done maxid newerr sample refund hk <<<"$q"
state db "$([ -n "$q" ] && echo 1 || echo 0)" "watchdog SQL failed"
if [ -n "$q" ]; then
  state queue "$([ "${oldq:-0}" -lt 600 ] && echo 1 || echo 0)" "oldest QUEUED ${oldq}s"
  state failrate "$([ "${failed:-0}" -lt 3 ] || [ $((failed*2)) -lt "${done:-0}" ] && echo 1 || echo 0)" "$failed/$done jobs FAILED in 15 min (provider down?)"
  [ "${newerr:-0}" -gt 0 ] && [ "$last" != 0 ] && tg "[ERROR] slaydx: $newerr new error type(s)
$sample"
  echo "$maxid" > "$ST/errid"
  [ "${refund:-0}" -gt 0 ] && tg "[ALERT] slaydx: REFUND_FAILED — check admin errors"
  state housekeeping "$([ "${hk:-0}" = 0 ] && echo 1 || echo 0)" "$hk housekeeping step(s) failing"
fi
state backup "$([ -n "$(find /root/slaydx-backups -maxdepth 1 -name 'slaydx-*.dump' -mmin -1560 | head -1)" ] && echo 1 || echo 0)" "no .dump newer than 26 h"
openssl x509 -checkend $((14*86400)) -noout -in /etc/letsencrypt/live/slaydxx.uz/cert.pem >/dev/null 2>&1; state cert "$([ $? = 0 ] && echo 1 || echo 0)" "TLS cert expires < 14 days"
[ -n "${HC_PING_URL:-}" ] && curl -fsS -m 10 -o /dev/null "$HC_PING_URL"   # optional dead-man switch (layer C)
```
(Draft: verify column names against mig 001/029 and the exact REFUND_FAILED message — `worker.ts:764` — in the implementation PR; add a
`--dry-run` that prints instead of sending; unit-test the SQL on the test DB 127.0.0.1:55440.)

**B. External probe from GitHub Actions** (no new vendor; free for the public repo; catches "whole box / nginx / DNS down", which A cannot report):
```yaml
# .github/workflows/uptime.yml
name: uptime
on: { schedule: [ { cron: "*/10 * * * *" } ], workflow_dispatch: {} }
permissions: {}
concurrency: { group: uptime, cancel-in-progress: false }
jobs:
  probe:
    runs-on: ubuntu-latest
    timeout-minutes: 4
    steps:
      - env: { TG_TOKEN: "${{ secrets.ALERT_TG_TOKEN }}", TG_CHAT: "${{ secrets.ALERT_TG_CHAT }}" }
        run: |
          for i in 1 2 3; do
            code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://slaydxx.uz/api/health || true)
            [ "$code" = 200 ] && exit 0; sleep 30
          done
          curl -s -m 10 -o /dev/null "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
            --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=[DOWN] slaydxx.uz /api/health -> ${code:-timeout} (GitHub probe)"
          exit 1
```
Caveats: GitHub cron can lag 5–20 min under load and is disabled after 60 days without repo activity; a failed run also emails the owner.
Repeats every 10 min while down (acceptable; or add a cache-key state later). Load on prod: 1 request / 10 min.

**C. Optional dead-man's switch**: healthchecks.io free tier — watchdog (A) and `backup.sh` ping a URL; if pings stop (box frozen, cron dead), it
alerts via its Telegram integration. Alternative to B or complement. UptimeRobot/Better Stack also work but add a vendor account; check their
current free-plan terms (UptimeRobot restricted free use for commercial sites — verify).

**In-app alerting (not recommended now)**: hooking Telegram into `error-sink.ts` couples alerting to the app being alive and adds code on every
error path; the watchdog SQL gives the same "new fingerprint" signal decoupled from the app.

**Daily digest (optional)**: same script at 09:00 Tashkent with `--digest`: jobs 24 h (done/failed), new errors, DB size, disk, swap, newest
backup + remote status. One message/day.

## 2. Disk + log rotation + SAFE cleanup

- Logs: OK (item 7). Add `/etc/logrotate.d/slaydx` for `/var/log/slaydx-*.log` (weekly, rotate 4, compress).
- Build cache 25 GB: buildkit cache is global but **cache-only** (deleting other projects' cache never touches their images/containers/volumes;
  it only makes their next build slower). If O1 moves builds to GHCR, one `docker builder prune -af` frees ~25 GB and nothing refills it.
  Until then: `docker builder prune -f --filter until=168h` after each deploy (owner decision — global command).
- Images: project-scoped, never global:
```bash
# scripts/docker-cleanup.sh — slaydx-only. Keeps :latest + newest :pre-* per repo; removes dangling slaydx-built images.
set -euo pipefail
for repo in slaydx-web slaydx-worker; do
  docker images "$repo" --format '{{.CreatedAt}}\t{{.Tag}}' | awk -F'\t' '$2 ~ /^pre-/' | sort -r | tail -n +2 | cut -f2 \
    | xargs -r -I{} docker rmi "$repo:{}"
done
# Compose labels images it builds; VERIFY first: docker image inspect slaydx-web:latest --format '{{json .Config.Labels}}'
docker image prune -f --filter "label=com.docker.compose.project=slaydx"
```
  (With GHCR images the label check changes — images then carry OCI labels from the CI build; filter on `reference=ghcr.io/khusinboev/slaydx*`.)
- Backups dir: prune pre-deploy dumps too (`find /root/slaydx-backups -maxdepth 1 -name 'slaydx-*.sql' -mtime +14 -delete`) and switch the
  pre-deploy dump to `pg_dump -Fc` (plain `.sql` doubles bytea as hex; `backup.sh:3-10` comments). Verify with `ls -la` first.
- Derived cache volume: self-capped 500 MB soft / 1 GB hard (`pdf-cache.ts:47,172`). Volumes total 817 MB (S:31). OK.

## 3. Memory / swap / OOM

- Committed ceilings: web 2 g + 2 × worker 2 g + pg 1 g = 7 g on a 7.8 GB box shared with ~19 host services, host PG, Redis, Ollama.
  Real use ≈ 0.6 GB. Worst realistic peak per container: worker = 4 jobs + ≤ 2 soffice (gate per process) + sharp ≈ 1–1.2 GB; web = Next
  ~350 MB + 2 soffice + pdftoppm ≈ 0.8–1 GB. Fits — **except while `docker compose build` runs on the box** (2–3 GB) → swap. That is the main
  memory fix and belongs to O1 (builds on GitHub).
- No `memswap_limit` → each container may also use swap up to its limit (Docker default = 2× mem_limit), so in-container OOM is unlikely;
  the failure mode is slow swapping, which the watchdog's MemAvailable/swap check surfaces.
- No `NODE_OPTIONS`. Optional: `NODE_OPTIONS=--max-old-space-size=1024` on web/worker so a leak fails fast (restart) instead of swapping.
  Low priority; measure first.
- `WORKER_CONCURRENCY=4 × 2 replicas` stays (owner decision C22). Do not lower limits until the watchdog has a week of OOM/restart data.
- Host-wide `vm.swappiness` tuning = owner decision (affects all projects); not needed once builds leave the box.

## 4. Postgres

- `036_pg_stat_statements.sql`: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` (slaydx is the image superuser). Then the admin panel or a
  manual query can list the top-10 slow statements. ~0 cost (module already loaded).
- compose flags (optional, planner-only, no restart risk beyond the pg restart itself): `effective_cache_size=640MB`, `random_page_cost=1.1`,
  `log_autovacuum_min_duration=5s`. Requires a postgres container restart (≈5 s downtime) → bundle with a deploy.
- Indexes: hot paths covered (`generations_user_idx`, partial `generations_running_user_idx`, admin indexes in 030, `error_log_last_seen_idx`).
  With pg_stat_statements on, re-check after 1 week rather than guessing.
- Growth: bytea tables ≈ 92 % of the DB. Paid docs are kept forever → dumps grow linearly. Track size in the daily digest. Long-term options
  (owner): retention for unpaid FAILED leftovers already exists; files of paid docs could move to disk/object storage — large change, not now.
- Vacuum: autovacuum 0.05 is set; bytea purges leave TOAST free space reused in place — fine at this size.

## 5. nginx (prod file `/etc/nginx/sites-available/slaydx`)

Port these from `deploy/nginx/slaydx.conf.example`:
1. `/_next/static/` with `proxy_cache` + `proxy_buffering on;` (**must** be set — prod has `proxy_buffering off` site-wide and `proxy_cache`
   needs buffering) + `expires 1y`. Offloads Node gzip/serving of hashed assets.
2. `map $http_upgrade $connection_upgrade { default upgrade; '' close; }` (http{} level, name-prefixed `slaydx_` to avoid clashes) and
   `upstream slaydx_web { server 127.0.0.1:3000; keepalive 16; }` with `proxy_set_header Connection $connection_upgrade;` — today every request
   opens a fresh TCP connection to Node.
3. HTTP/2: Ubuntu 24.04 ships nginx 1.24 (no per-server `http2 on;`, that is ≥ 1.25.1). `listen 443 ssl http2;` is a **socket option shared by
   every site on :443** (nodavlattalim, talim24, abitur24, vakant) → owner decision (usually harmless, but it changes neighbours).
4. Keep `client_max_body_size 32m` (matches 20 MB app caps + margin) and prod's `proxy_read_timeout 300s` (do not copy the template's 60 s
   default blindly — PDF timeout 50 s and edit routes 45–60 s fit, but 300 s is safer for downloads; `/api/dl/` needs ≥120 s).
5. Brotli: not available in the stock package — skip. Apply with `nginx -t && systemctl reload nginx` (reload only).

## 6. Backup / restore

- Have: daily 01:30 `pg_dump -Fc` (~300 MB) + `pg_restore --list` verify + Telegram on failure + Drive copy (30-day prune) + `restore-check.sh`.
- Gaps + fixes:
  1. **RPO 24 h** for payments/credits. Cheap fix: hourly "ledger" dump without bytea data, 24 rotating slots:
     `pg_dump -Fc --exclude-table-data='generation_files' --exclude-table-data='generation_assets' --exclude-table-data='*_uploads'
     --exclude-table-data='source_cache' slaydx > ledger-$(date +%H).dump` (non-bytea part ≈ 30 MB raw → a few MB, ~2 s). Optional Drive copy.
  2. **Restore drill**: schedule `restore-check.sh` weekly (verify `/etc/cron.d/slaydx-backup` has it), pin `RESTORE_CHECK_IMAGE` to
     `postgres:16.15-alpine3.24` (reuses prod layers, no extra download), print duration, Telegram on failure (copy `backup.sh`'s `fail()`).
     The measured duration becomes the documented RTO (estimate for DB-only: Drive download ~1 min + `pg_restore -j2` 1–3 min; full-box loss
     is dominated by provisioning + image pull — with GHCR images that drops from ~10 min of building to ~2 min of pulling).
  3. Drive retention: 30 dailies ≈ 9 GB and growing → GFS (7 daily + 4 Sunday + 3 first-of-month ≈ 14 copies ≈ 4.2 GB) in the server
     wrapper `/usr/local/bin/slaydx-backup`.
  4. Pre-deploy dumps: use `-Fc` and prune (section 2).

## 7. Security quick wins (list only — no changes)

Verify `unattended-upgrades` enabled + `needrestart`/pending reboot; `server_tokens off;`; `PermitRootLogin prohibit-password` +
`PasswordAuthentication no` (reported key-only); fail2ban jails include `sshd` (+ optional `nginx-limit-req`); Docker publishes bypass ufw
(only `127.0.0.1:` binds for slaydx — compliant; call-tizim `0.0.0.0:8095` is not ours); ensure `.env` has `POSTGRES_PASSWORD` (compose
default `slaydx`); align HSTS `preload` (Next sends it, template says no); rotate the call-tizim secret leaked during migration (owner);
optional nginx `limit_req` on `/api/auth` and `POST /api/generations` as a cheap pre-filter before DB-backed rate limits.

## 8. App resilience

Mechanisms exist (item 8 in TL;DR). Remaining gaps are covered by the watchdog: unhealthy-without-restart, FAILED-rate spikes (provider/key
outage), REFUND_FAILED, housekeeping failures, stuck queue. Deploy 502 window (deploy.md §2b, INFRA-07) is O1's area.

---

## (b) Concrete changes — see snippets above. (c) Work packages (exclusive file ownership)

| WP | Files (exclusive) | Content | Effort |
|----|-------------------|---------|--------|
| O3-A watchdog | `scripts/watchdog.sh` (new), `tests/watchdog.test.mts` (new: SQL on test DB 55440 + dry-run), `.claude/deploy.md` §Monitoring | layer A + digest | 0.5–1 d |
| O3-B uptime | `.github/workflows/uptime.yml` (new) | layer B (owner adds 2 secrets) | 1 h |
| O3-C backups | `scripts/backup.sh`, `scripts/restore-check.sh`, `scripts/backup-ledger.sh` (new) | hourly ledger dump, drill alert+timing+pinned image, `.sql` prune | 0.5 d |
| O3-D cleanup | `scripts/docker-cleanup.sh` (new) | slaydx-scoped image cleanup; deploy.sh hook coordinated with O1 (O1 owns deploy flow) | 1 h |
| O3-E postgres | `lib/server/migrations/036_pg_stat_statements.sql` (new), `docker-compose.yml` postgres `command:` only | extension + planner flags | 1 h |
| O3-F nginx | `deploy/nginx/slaydx.conf.example` | static cache + buffering note + keepalive/map; owner applies on server | 1 h |

Server-side installs (owner or lead with owner OK): cron files, logrotate, `/etc/slaydx/backup.env` keys (`HC_PING_URL`, optional `ALERT_TG_CHAT`).

## (d) OWNER decisions

1. **Monitoring stack** — (a, rec.) local watchdog + GitHub Actions probe; (b) watchdog + healthchecks.io dead-man switch; (c) watchdog only.
2. **Auto-restart of unhealthy slaydx containers** — (a, rec.) alert-only for 1 week, then enable `WATCHDOG_AUTO_RESTART=1`; (b) enable now; (c) never.
3. **Build cache** — (a, rec.) one-time `docker builder prune -af` right after builds move to GitHub (O1); (b) weekly `--filter until=168h` now;
   (c) leave it (cache-only, but 25 GB).
4. **RPO / Drive retention** — (a, rec.) hourly ledger dump local + GFS on Drive; (b) only GFS; (c) keep as is (24 h RPO, 30 dailies).
5. **HTTP/2 on shared :443** — (a, rec.) enable (benefits all sites, test each after reload); (b) wait for nginx ≥ 1.25 (per-server `http2 on`).

## (e) Risks + rollback

- Watchdog false alarms / spam → state-change + hourly repeat; disable = remove `/etc/cron.d/slaydx-watchdog`. Auto-restart off by default.
- `docker restart` of web causes the same short 502 window as a deploy → capped 1/30 min, only after 3 consecutive unhealthy runs.
- Image cleanup could remove the rollback tag → script keeps newest `:pre-*`; run only after a successful deploy health check.
- Postgres flag change needs a pg container restart (~5 s) → bundle with a deploy; rollback = drop the flags.
- Migration 036 is additive (`DROP EXTENSION pg_stat_statements` to revert).
- nginx edits: `nginx -t` before reload; keep a copy of the current file (`cp …/slaydx …/slaydx.bak-<date>`); reload never drops neighbours.
- GitHub probe runs on a public repo: no secrets in output (token only in env, curl `-o /dev/null`).
