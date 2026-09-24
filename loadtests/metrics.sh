#!/usr/bin/env bash
# Samples the running stack every INTERVAL s (default 5) and appends CSV rows
#   ts,metric,key,value
# metric: rss_kb / cpu_s (per process, from the pidfiles; cpu_s is cumulative),
#         restarts (per process), pg_conn (key = application_name|state),
#         queue (key = QUEUED / IN_PROGRESS / oldest_queued_s), pg_mem_mib / pg_cpu_pct (container).
#   loadtests/metrics.sh <out.csv> [duration_s]      (runs until killed when no duration)
set -uo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"
out="${1:?usage: metrics.sh <out.csv> [duration_s]}"
dur="${2:-0}"
interval="${INTERVAL:-5}"
tick="$(getconf CLK_TCK)"
[[ -f "$out" ]] || echo "ts,metric,key,value" >"$out"
end=$((SECONDS + dur))
trap 'exit 0' TERM INT

while ((dur == 0 || SECONDS < end)); do
  ts="$(date -u +%FT%TZ)"
  {
    for f in "$STATE_DIR"/*.pid; do
      [[ -f "$f" ]] || continue
      n="$(basename "$f" .pid)"
      [[ "$n" == supervisor ]] && continue
      pid="$(cat "$f")"
      if [[ -r "/proc/$pid/stat" ]]; then
        rss="$(awk '/^VmRSS:/ {print $2}' "/proc/$pid/status" 2>/dev/null)"
        cpu="$(awk -v t="$tick" '{printf "%.2f", ($14 + $15) / t}' "/proc/$pid/stat" 2>/dev/null)"
        echo "$ts,rss_kb,$n,${rss:-0}"
        echo "$ts,cpu_s,$n,${cpu:-0}"
      else
        echo "$ts,rss_kb,$n,0"
      fi
      echo "$ts,restarts,$n,$(cat "$STATE_DIR/restarts.$n" 2>/dev/null || echo 0)"
    done
    lt_sql "select '$ts,pg_conn,' || coalesce(nullif(application_name,''),'(none)') || '|' || coalesce(state,'(null)') || ',' || count(*)
              from pg_stat_activity where datname = 'slaydx' and pid <> pg_backend_pid() group by application_name, state" 2>/dev/null
    lt_sql "select '$ts,queue,QUEUED,' || count(*) filter (where status='QUEUED') || E'\n' ||
                   '$ts,queue,IN_PROGRESS,' || count(*) filter (where status='IN_PROGRESS') || E'\n' ||
                   '$ts,queue,oldest_queued_s,' || coalesce(round(extract(epoch from now() - min(created_at) filter (where status='QUEUED'))),0)
              from generations where status in ('QUEUED','IN_PROGRESS')" 2>/dev/null
    if [[ "${METRICS_DOCKER:-1}" == 1 ]]; then
      docker stats --no-stream --format '{{.MemUsage}}|{{.CPUPerc}}' "$PG_CONTAINER" 2>/dev/null |
        awk -F'|' -v ts="$ts" '{split($1,a," "); m=a[1]; u=m; gsub(/[0-9.]/,"",u); gsub(/[A-Za-z]/,"",m);
          if (u=="GiB") m*=1024; else if (u=="KiB") m/=1024; gsub(/%/,"",$2);
          printf "%s,pg_mem_mib,%s,%.1f\n%s,pg_cpu_pct,%s,%s\n", ts, "postgres", m, ts, "postgres", $2}'
    fi
  } >>"$out"
  sleep "$interval" &
  wait $!
done
