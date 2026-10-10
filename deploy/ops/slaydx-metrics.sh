#!/usr/bin/env bash
#
# deploy/ops/slaydx-metrics.sh -- HOST load sample for the SlaydX load history (docs/ops/METRICS.md).
# Runs from root cron every 5 minutes (/etc/cron.d/slaydx-metrics, written by deploy/install-ops.sh;
# the script itself is installed as the root-owned copy /usr/local/bin/slaydx-metrics) and inserts ONE
# row into `server_metrics` (kind = 'host') through the Postgres container:
#
#   load1/5/15 + CPU count, memory total/used/available (MB), swap total/used, root-disk %,
#   per container (slaydx-* only): status, restarts, OOMKilled, started_at, CPU %, memory MB,
#   nginx request counts of the last 5 minutes (total, 2xx/3xx/4xx/5xx) with p50/p95 request time.
#
# nginx: the shared access log carries every site on the box and has no host field, so the script
# reads a DEDICATED slaydx log (METRICS_NGINX_LOG, default /var/log/nginx/slaydx.access.log) in the
# format `$msec $status $request_time` -- see deploy/nginx/slaydx.conf.example. No such file -> the
# "nginx" field is null; everything else is still recorded.
#
# Safe by construction: flock (one run at a time), every docker call under `timeout`, any failure is
# logged as ONE line and the script still exits 0 (cron must never mail or retry-storm), no secret is
# read or printed -- the DB user/name come from the Postgres container's own environment and the SQL
# travels on stdin.
#
#   --print   print the JSON sample to stdout; no lock, no insert (dry run / debugging)
#   -h        this help
#
# Test seams (tests/server-metrics-script.test.mts): METRICS_PROC, METRICS_DISK_PATH, METRICS_NGINX_LOG,
# METRICS_NOW (epoch seconds), METRICS_LOCK, METRICS_PG_CONTAINER, METRICS_CONTAINER_PREFIX.
set -uo pipefail

usage() { sed -n '2,/^set -uo/p' "$0" | sed -e '/^set -uo/d' -e 's/^# \{0,1\}//'; }

PRINT=0
case "${1:-}" in
  --print) PRINT=1 ;;
  -h | --help) usage; exit 0 ;;
  "") ;;
  *) echo "slaydx-metrics: unknown argument: $1" >&2; exit 0 ;;
esac

PROC="${METRICS_PROC:-/proc}"
DISK_PATH="${METRICS_DISK_PATH:-/}"
NGINX_LOG="${METRICS_NGINX_LOG:-/var/log/nginx/slaydx.access.log}"
NGINX_TAIL_LINES=200000
WINDOW_S=300
PG_CONTAINER="${METRICS_PG_CONTAINER:-slaydx-postgres-1}"
PREFIX="${METRICS_CONTAINER_PREFIX:-slaydx-}"
LOCK="${METRICS_LOCK:-/run/lock/slaydx-metrics.lock}"
NOW="${METRICS_NOW:-$(date +%s)}"
CMD_TIMEOUT=60

fail() { echo "slaydx-metrics: $*" >&2; exit 0; }

# A value is emitted only when it looks like a plain non-negative number; anything else becomes null.
num() { if [[ "${1:-}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then printf '%s' "$1"; else printf 'null'; fi; }
# Identifier-ish strings only (container names, ids, timestamps): nothing that could break JSON or SQL.
safe() { printf '%s' "${1:-}" | tr -cd 'A-Za-z0-9_.:+-'; }

if [ "$PRINT" = 0 ]; then
  command -v flock >/dev/null 2>&1 || fail "flock not found"
  umask 077
  exec 9>"$LOCK" || fail "cannot open lock $LOCK"
  flock -n 9 || exit 0
fi

# -- host: load, cpu, memory, swap, disk ---------------------------------------------------------
load1="" load5="" load15=""
read -r load1 load5 load15 _ <"$PROC/loadavg" 2>/dev/null || true
cpus=$(grep -c '^processor' "$PROC/cpuinfo" 2>/dev/null || true)
[[ "$cpus" =~ ^[1-9][0-9]*$ ]] || cpus=$(nproc 2>/dev/null || echo "")

mem_line=$(awk '
  $1 == "MemTotal:" { t = $2 } $1 == "MemAvailable:" { a = $2 }
  $1 == "SwapTotal:" { st = $2 } $1 == "SwapFree:" { sf = $2 }
  END { printf "%d %d %d %d", t / 1024, a / 1024, st / 1024, (st - sf) / 1024 }' "$PROC/meminfo" 2>/dev/null || true)
read -r mem_total mem_avail swap_total swap_used <<<"${mem_line:-}"
mem_used=""
if [[ "${mem_total:-}" =~ ^[0-9]+$ && "${mem_avail:-}" =~ ^[0-9]+$ && "$mem_total" -gt 0 ]]; then mem_used=$((mem_total - mem_avail)); fi

disk_pct=$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }' || true)

# -- containers (slaydx-* only) ------------------------------------------------------------------
declare -A cpu_of mem_of memlim_of
names=""
if command -v docker >/dev/null 2>&1; then
  names=$(timeout "$CMD_TIMEOUT" docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E "^${PREFIX}[A-Za-z0-9_.-]+\$" | sort || true)
fi

# "356.2MiB" -> 356.2 (MiB). Handles B, kB, KiB, MB, MiB, GB, GiB, TB, TiB; anything else -> empty.
to_mb() {
  awk -v s="$1" 'BEGIN {
    if (!match(s, /[0-9.]+/)) { exit }
    v = substr(s, RSTART, RLENGTH); u = substr(s, RSTART + RLENGTH)
    if (u == "B") m = v / 1048576
    else if (u == "kB" || u == "KB") m = v * 1000 / 1048576
    else if (u == "KiB") m = v / 1024
    else if (u == "MB" || u == "MiB") m = v
    else if (u == "GB" || u == "GiB") m = v * 1024
    else if (u == "TB" || u == "TiB") m = v * 1048576
    else { exit }
    printf "%.1f", m }'
}

if [ -n "$names" ]; then
  # shellcheck disable=SC2086  # word-splitting of the validated container names is intended
  stats=$(timeout "$CMD_TIMEOUT" docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' $names 2>/dev/null || true)
  while IFS='|' read -r n cpu usage; do
    [ -n "$n" ] || continue
    n=$(safe "$n")
    cpu_of[$n]=$(num "${cpu%\%}")
    used=${usage%% / *}
    lim=${usage##* / }
    mem_of[$n]=$(to_mb "${used// /}")
    memlim_of[$n]=$(to_mb "${lim// /}")
  done <<<"$stats"
fi

containers_json=""
if [ -n "$names" ]; then
  # shellcheck disable=SC2086
  inspect=$(timeout "$CMD_TIMEOUT" docker inspect -f '{{.Name}}|{{.Id}}|{{.State.Status}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.StartedAt}}' $names 2>/dev/null || true)
  while IFS='|' read -r n id st rc oom started; do
    [ -n "$n" ] || continue
    n=$(safe "${n#/}")
    [ -n "$n" ] || continue
    id=$(safe "${id:0:12}")
    oomj=false
    [ "$oom" = true ] && oomj=true
    rcv=$(num "$rc")
    [ "$rcv" = null ] && rcv=0
    item=$(printf '{"name":"%s","id":"%s","status":"%s","restarts":%s,"oom":%s,"started_at":"%s","cpu_pct":%s,"mem_mb":%s,"mem_limit_mb":%s}' \
      "$n" "$id" "$(safe "$st")" "$rcv" "$oomj" "$(safe "$started")" \
      "$(num "${cpu_of[$n]:-}")" "$(num "${mem_of[$n]:-}")" "$(num "${memlim_of[$n]:-}")")
    containers_json="${containers_json:+$containers_json,}$item"
  done <<<"$inspect"
fi

# -- nginx (dedicated slaydx access log, last 5 minutes) -----------------------------------------
nginx_json=null
if [ -r "$NGINX_LOG" ]; then
  since=$((NOW - WINDOW_S))
  win=$(mktemp 2>/dev/null) || win=""
  if [ -n "$win" ]; then
    tail -n "$NGINX_TAIL_LINES" "$NGINX_LOG" 2>/dev/null |
      awk -v since="$since" '$1 + 0 >= since && $2 ~ /^[0-9][0-9][0-9]$/ { print $2, $3 }' >"$win" || true
    counts=$(awk '{ c++; k = substr($1, 1, 1); if (k == "2") a++; else if (k == "3") b++; else if (k == "4") d++; else if (k == "5") e++ }
      END { printf "%d %d %d %d %d", c, a, b, d, e }' "$win")
    read -r rq r2 r3 r4 r5 <<<"$counts"
    p50=null p95=null
    if [ "${rq:-0}" -gt 0 ]; then
      pct=$(awk '$2 ~ /^[0-9.]+$/ { print $2 }' "$win" | sort -n | awk '
        { v[NR] = $1 }
        END { if (NR == 0) { print "null null"; exit }
              i50 = int(0.50 * (NR - 1)) + 1; i95 = int(0.95 * (NR - 1) + 0.999999) + 1; if (i95 > NR) i95 = NR
              printf "%.0f %.0f", v[i50] * 1000, v[i95] * 1000 }')
      read -r p50 p95 <<<"$pct"
    fi
    nginx_json=$(printf '{"window_s":%d,"requests":%d,"s2xx":%d,"s3xx":%d,"s4xx":%d,"s5xx":%d,"p50_ms":%s,"p95_ms":%s}' \
      "$WINDOW_S" "${rq:-0}" "${r2:-0}" "${r3:-0}" "${r4:-0}" "${r5:-0}" "$(num "$p50")" "$(num "$p95")")
    rm -f -- "$win"
  fi
fi

json=$(printf '{"v":1,"cpus":%s,"load1":%s,"load5":%s,"load15":%s,"mem_total_mb":%s,"mem_used_mb":%s,"mem_avail_mb":%s,"swap_total_mb":%s,"swap_used_mb":%s,"disk_pct":%s,"containers":[%s],"nginx":%s}' \
  "$(num "${cpus:-}")" "$(num "${load1:-}")" "$(num "${load5:-}")" "$(num "${load15:-}")" \
  "$(num "${mem_total:-}")" "$(num "${mem_used:-}")" "$(num "${mem_avail:-}")" \
  "$(num "${swap_total:-}")" "$(num "${swap_used:-}")" "$(num "${disk_pct:-}")" \
  "$containers_json" "$nginx_json")

if [ "$PRINT" = 1 ]; then
  printf '%s\n' "$json"
  exit 0
fi

# -- insert (SQL on stdin; DB user/name are the container's own POSTGRES_USER / POSTGRES_DB) -----
command -v docker >/dev/null 2>&1 || fail "docker not found"
err=$(printf "INSERT INTO server_metrics (kind, data) VALUES ('host', \$m\$%s\$m\$::jsonb);\n" "$json" |
  timeout "$CMD_TIMEOUT" docker exec -i "$PG_CONTAINER" sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2>&1 >/dev/null) ||
  fail "insert failed: $(printf '%s' "$err" | head -n 1 | cut -c1-200)"
exit 0
