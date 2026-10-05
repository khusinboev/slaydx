#!/usr/bin/env bash
#
# scripts/watchdog.sh — box-local SlaydX watchdog (docs/ops/O3-robustness-ops.md §1A,
# owner decision D3 in docs/ops/PLAN.md). Runs from cron every 3 minutes as root:
#
#   /etc/cron.d/slaydx-watchdog
#   */3 * * * * root /opt/slaydx/scripts/watchdog.sh >>/var/log/slaydx-watchdog.log 2>&1
#   0 6 * * *   root /opt/slaydx/scripts/watchdog.sh --digest >>/var/log/slaydx-watchdog.log 2>&1
#
# Checks: public /api/health through the local nginx + TLS, slaydx container state/health/
# restarts/OOM kills, disk %, RAM and swap, oldest ready QUEUED job, FAILED ratio, new error
# fingerprints in `error_log`, REFUND_FAILED, failing housekeeping steps, age of the last full
# backup / hourly ledger dump / restore drill, TLS certificate expiry.
#
# Alerts go to the owner's Telegram chat with the bot token from the same root-only env file
# as scripts/backup.sh (`/etc/slaydx/backup.env`: TELEGRAM_BOT_TOKEN + ALERT_TG_CHAT or
# BACKUP_TG_CHAT). The token is handed to curl on stdin (`-K -`), never on the command line,
# and is never printed.
#
# De-duplication: a condition alerts when it starts failing (some checks only after 2
# consecutive runs, so a deploy's container swap does not page), repeats at most every
# WATCHDOG_REPEAT_SECONDS (1 h) while it keeps failing and sends one "[OK]" when it recovers.
# One-shot events (container restart, OOM kill, new error type, REFUND_FAILED) are sent once.
# State lives in WATCHDOG_STATE_DIR; deleting it only resets de-duplication.
#
# WATCHDOG_AUTO_RESTART=1 (default 0 — alert only, owner decision D3) restarts the compose
# service of a `slaydx-*` container that stayed `unhealthy` for WATCHDOG_RESTART_AFTER runs,
# at most once per WATCHDOG_RESTART_COOLDOWN_MIN per service, with
# `docker compose -p slaydx restart <service>` (all replicas of that service). Nothing outside
# the slaydx compose project is ever touched; the script never prunes, stops or removes.
#
#   --dry-run   print what would be sent/restarted; never writes state, never sends, never restarts
#   --digest    send one daily summary instead of running the checks
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed -e '/^set -euo/d' -e 's/^# \{0,1\}//'
}

DRY_RUN=0
MODE=check
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --digest) MODE=digest ;;
    -h | --help) usage; exit 0 ;;
    *) echo "watchdog: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

ENV_FILE="${WATCHDOG_ENV_FILE:-${BACKUP_ENV_FILE:-/etc/slaydx/backup.env}}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

NAME="${WATCHDOG_NAME:-SlaydX}"
CHAT="${ALERT_TG_CHAT:-${BACKUP_TG_CHAT:-}}"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/slaydx-watchdog}"
REPEAT_S="${WATCHDOG_REPEAT_SECONDS:-3600}"
HEALTH_URL="${WATCHDOG_HEALTH_URL:-https://slaydxx.uz/api/health}"
# Resolve the public name to the local nginx: the probe exercises nginx + TLS + web without
# depending on DNS. Set it empty to use normal DNS.
HEALTH_RESOLVE="${WATCHDOG_HEALTH_RESOLVE-slaydxx.uz:443:127.0.0.1}"
CONTAINERS="${WATCHDOG_CONTAINERS:-slaydx-web-1 slaydx-worker-1 slaydx-worker-2 slaydx-postgres-1}"
PROJECT="${WATCHDOG_COMPOSE_PROJECT:-slaydx}"
COMPOSE_DIR="${WATCHDOG_COMPOSE_DIR:-/opt/slaydx}"
AUTO_RESTART="${WATCHDOG_AUTO_RESTART:-0}"
RESTART_AFTER="${WATCHDOG_RESTART_AFTER:-3}"
RESTART_COOLDOWN_MIN="${WATCHDOG_RESTART_COOLDOWN_MIN:-30}"
CGROUP_ROOT="${WATCHDOG_CGROUP_ROOT:-/sys/fs/cgroup}"
DISK_PATH="${WATCHDOG_DISK_PATH:-/}"
DISK_MAX_PCT="${WATCHDOG_DISK_MAX_PCT:-85}"
MEMINFO="${WATCHDOG_MEMINFO:-/proc/meminfo}"
MEM_MIN_MB="${WATCHDOG_MEM_MIN_MB:-400}"
SWAP_MAX_MB="${WATCHDOG_SWAP_MAX_MB:-6144}"
PG_CONTAINER="${PG_CONTAINER:-slaydx-postgres-1}"
PG_USER="${PG_USER:-slaydx}"
PG_DB="${PG_DB:-slaydx}"
QUEUE_MAX_AGE_S="${WATCHDOG_QUEUE_MAX_AGE_S:-600}"
FAIL_WINDOW_MIN="${WATCHDOG_FAIL_WINDOW_MIN:-15}"
FAIL_MIN="${WATCHDOG_FAIL_MIN:-3}"
FAIL_MAX_PCT="${WATCHDOG_FAIL_MAX_PCT:-50}"
BACKUP_DIR="${BACKUP_DIR:-/root/slaydx-backups}"
LEDGER_DIR="${LEDGER_DIR:-$BACKUP_DIR/ledger}"
BACKUP_MAX_AGE_MIN="${WATCHDOG_BACKUP_MAX_AGE_MIN:-1560}"
LEDGER_MAX_AGE_MIN="${WATCHDOG_LEDGER_MAX_AGE_MIN:-150}"
RESTORE_MAX_AGE_MIN="${WATCHDOG_RESTORE_MAX_AGE_MIN:-11520}"
CERT_FILE="${WATCHDOG_CERT_FILE-/etc/letsencrypt/live/slaydxx.uz/cert.pem}"
CERT_MIN_DAYS="${WATCHDOG_CERT_MIN_DAYS:-14}"

# The marker scripts/worker.ts writes for a refund that could not be booked (alert REFUND_FAILED,
# lib/server/worker.ts). tests/watchdog.test.mts keeps the two in sync.
REFUND_MARKER="pul qaytarilmadi"

NOW=$(date +%s)
FAILING=()

num() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

for v in REPEAT_S AUTO_RESTART RESTART_AFTER RESTART_COOLDOWN_MIN DISK_MAX_PCT MEM_MIN_MB SWAP_MAX_MB \
  QUEUE_MAX_AGE_S FAIL_WINDOW_MIN FAIL_MIN FAIL_MAX_PCT BACKUP_MAX_AGE_MIN LEDGER_MAX_AGE_MIN \
  RESTORE_MAX_AGE_MIN CERT_MIN_DAYS; do
  if ! num "${!v}"; then
    echo "watchdog: $v must be a non-negative integer" >&2
    exit 2
  fi
done

if [ "$DRY_RUN" = 0 ]; then
  umask 077
  mkdir -p "$STATE_DIR"
  # Cron starts a run every 3 minutes; a slow docker/psql call must not let two overlap.
  exec 9>"$STATE_DIR/.lock"
  if ! flock -n 9; then
    echo "watchdog: $(date -Iseconds) previous run still active — skipped"
    exit 0
  fi
fi

# ── state helpers (no writes in --dry-run) ─────────────────────────────────────────────
get() { cat -- "$STATE_DIR/$1" 2>/dev/null || true; }
put() { [ "$DRY_RUN" = 1 ] || printf '%s\n' "$2" >"$STATE_DIR/$1"; }
del() { [ "$DRY_RUN" = 1 ] || rm -f -- "$STATE_DIR/$1"; }
mark() { [ "$DRY_RUN" = 1 ] || touch -- "$STATE_DIR/$1"; }
# Seconds since the state file was last touched, -1 when it does not exist.
age_s() {
  local m
  m=$(stat -c %Y -- "$STATE_DIR/$1" 2>/dev/null) || { echo -1; return 0; }
  echo $((NOW - m))
}

send() {
  local text="$1"
  if [ "$DRY_RUN" = 1 ]; then
    printf 'watchdog: [dry-run] %s\n' "$text"
    return 0
  fi
  if [ -z "$CHAT" ] || [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
    printf 'watchdog: Telegram is not configured (%s) — not sent: %s\n' "$ENV_FILE" "$text" >&2
    return 1
  fi
  if printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
    curl -sS -f -m 10 -o /dev/null -K - \
      --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$text" 2>/dev/null; then
    printf 'watchdog: sent: %s\n' "${text%%$'\n'*}"
    return 0
  fi
  echo "watchdog: Telegram send failed — will retry on the next run" >&2
  return 1
}

# check KEY OK(1|0) MESSAGE [CONSECUTIVE_FAILURES_BEFORE_ALERT]
check() {
  local key=$1 ok=$2 msg=$3 need=${4:-1} n a
  if [ "$ok" = 1 ]; then
    del "fail-$key"
    if [ -e "$STATE_DIR/alert-$key" ]; then
      if send "[OK] $NAME: $msg"; then del "alert-$key"; fi
    fi
    return 0
  fi
  FAILING+=("$key")
  n=$(get "fail-$key")
  num "$n" || n=0
  n=$((n + 1))
  put "fail-$key" "$n"
  if [ "$n" -lt "$need" ]; then return 0; fi
  a=$(age_s "alert-$key")
  if [ "$a" -lt 0 ] || [ "$a" -ge "$REPEAT_S" ]; then
    if send "[ALERT] $NAME: $msg"; then mark "alert-$key"; fi
  fi
  return 0
}

# Newest mtime (epoch seconds) of files matching a glob in a directory, empty when none.
newest_mtime() {
  find "$1" -maxdepth 1 -type f -name "$2" -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1 || true
}

# ── checks ──────────────────────────────────────────────────────────────────────────────
check_health() {
  local code args=()
  [ -z "$HEALTH_RESOLVE" ] || args+=(--resolve "$HEALTH_RESOLVE")
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${args[@]}" "$HEALTH_URL" 2>/dev/null) || true
  num "$code" || code=000
  if [ "$code" = 200 ]; then
    check health 1 "/api/health yana 200 qaytarmoqda"
  else
    check health 0 "/api/health -> $code (sayt ishlamayapti yoki baza yiqilgan)" 2
  fi
}

auto_restart() {
  local c=$1 proj=$2 svc=$3 a
  if [ "$proj" != "$PROJECT" ] || ! [[ "$svc" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "watchdog: $c is not a service of compose project '$PROJECT' — not restarting" >&2
    return 0
  fi
  a=$(age_s "restarted-$svc")
  if [ "$a" -ge 0 ] && [ "$a" -lt $((RESTART_COOLDOWN_MIN * 60)) ]; then
    echo "watchdog: '$svc' was restarted ${a}s ago — waiting for the cooldown"
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then
    echo "watchdog: [dry-run] would run: docker compose -p $PROJECT restart $svc"
    return 0
  fi
  # Mark first: a restart that fails is not retried every 3 minutes, only after the cooldown.
  mark "restarted-$svc"
  if (cd "$COMPOSE_DIR" && docker compose -p "$PROJECT" restart "$svc") >/dev/null 2>&1; then
    send "[ACTION] $NAME: $c sog'lom emas edi — '$svc' xizmati qayta ishga tushirildi" || true
    del "unhealthy-$c"
  else
    send "[ALERT] $NAME: '$svc' xizmatini qayta ishga tushirib bo'lmadi ($c sog'lom emas)" || true
  fi
}

check_containers() {
  local c info st hs oom rc started id proj svc prev n ev p note
  local fmt='{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.State.StartedAt}}|{{.Id}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}'
  note=""
  [ "$AUTO_RESTART" = 1 ] || note=" (avto-restart o'chiq)"
  for c in $CONTAINERS; do
    case "$c" in
      slaydx-*) ;;
      *) echo "watchdog: ignoring non-slaydx container name '$c'" >&2; continue ;;
    esac
    info=$(docker inspect -f "$fmt" "$c" 2>/dev/null) || info=""
    if [ -z "$info" ]; then
      check "ctr-$c" 0 "$c konteyneri topilmadi" 2
      continue
    fi
    IFS='|' read -r st hs oom rc started id proj svc <<<"$info"

    # `starting` is the health-check grace period after a (re)start — not a failure yet.
    if [ "$st" = running ] && [ "$hs" != unhealthy ]; then
      check "ctr-$c" 1 "$c yana ishlayapti ($st/$hs)"
    else
      check "ctr-$c" 0 "$c holati: $st/$hs$note" 2
    fi

    if num "$rc"; then
      prev=$(get "rc-$c")
      if num "$prev" && [ "$rc" -gt "$prev" ]; then
        if send "[ALERT] $NAME: $c qayta ishga tushdi (restartlar $prev -> $rc)"; then put "rc-$c" "$rc"; fi
      else
        put "rc-$c" "$rc"
      fi
    fi

    if [ "$oom" = true ] && [ "$(get "oomflag-$c")" != "$started" ]; then
      if send "[ALERT] $NAME: $c xotira chegarasiga urilib o'ldirildi (OOMKilled)"; then put "oomflag-$c" "$started"; fi
    fi

    # Kernel OOM kills inside the container (e.g. a LibreOffice child) leave the container
    # running, so .State.OOMKilled stays false — the cgroup counter shows them.
    ev=""
    for p in "$CGROUP_ROOT/system.slice/docker-$id.scope/memory.events" "$CGROUP_ROOT/docker/$id/memory.events"; do
      if [ -r "$p" ]; then ev=$p; break; fi
    done
    if [ -n "$ev" ]; then
      n=$(awk '$1 == "oom_kill" { print $2 }' "$ev" 2>/dev/null || true)
      if num "$n"; then
        prev=$(get "oomkill-$c")
        if [ "${prev%% *}" = "$id" ] && num "${prev##* }" && [ "$n" -gt "${prev##* }" ]; then
          if send "[ALERT] $NAME: $c ichida jarayon xotira yetmay o'ldirildi (oom_kill ${prev##* } -> $n)"; then
            put "oomkill-$c" "$id $n"
          fi
        else
          put "oomkill-$c" "$id $n"
        fi
      fi
    fi

    if [ "$hs" = unhealthy ]; then
      n=$(get "unhealthy-$c")
      num "$n" || n=0
      n=$((n + 1))
      put "unhealthy-$c" "$n"
      if [ "$AUTO_RESTART" = 1 ] && [ "$n" -ge "$RESTART_AFTER" ]; then
        auto_restart "$c" "$proj" "$svc"
      fi
    else
      del "unhealthy-$c"
    fi
  done
}

disk_pct() {
  df -P "$DISK_PATH" 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }' || true
}

check_disk() {
  local pct
  pct=$(disk_pct)
  if ! num "$pct"; then
    check disk 0 "disk bandligini o'qib bo'lmadi ($DISK_PATH)"
  elif [ "$pct" -lt "$DISK_MAX_PCT" ]; then
    check disk 1 "disk ${pct}% (chegara ${DISK_MAX_PCT}%)"
  else
    check disk 0 "disk ${pct}% to'lgan (chegara ${DISK_MAX_PCT}%)"
  fi
}

# Prints "<MemAvailable MB> <swap used MB>".
mem_stats() {
  awk '/^MemAvailable:/ { a = $2 } /^SwapTotal:/ { t = $2 } /^SwapFree:/ { f = $2 }
       END { if (a == "") exit 1; printf "%d %d\n", a / 1024, (t - f) / 1024 }' "$MEMINFO" 2>/dev/null || true
}

check_mem() {
  local avail swap
  read -r avail swap <<<"$(mem_stats)" || true
  if ! num "${avail:-}" || ! num "${swap:-}"; then
    check mem 0 "xotira holatini o'qib bo'lmadi ($MEMINFO)"
  elif [ "$avail" -ge "$MEM_MIN_MB" ] && [ "$swap" -lt "$SWAP_MAX_MB" ]; then
    check mem 1 "RAM bo'sh ${avail} MB, swap ${swap} MB"
  else
    check mem 0 "RAM bo'sh ${avail} MB (min ${MEM_MIN_MB}), swap ${swap} MB (max ${SWAP_MAX_MB})"
  fi
}

# Runs SQL from stdin inside the slaydx Postgres container; unaligned rows, fields split by 0x1f.
psql_rows() {
  docker exec -i "$PG_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" \
    -t -A -F $'\x1f' "$@"
}

check_db() {
  local last out qage queued failed finished maxid newerr sample refund hkfail hksteps prev
  last=$(get errid)
  num "$last" || last=""
  out=$(psql_rows -v "last=${last:-0}" -v "win=$FAIL_WINDOW_MIN" 2>/dev/null <<SQL
SELECT g.queue_age, g.queued, g.failed, g.finished, e.max_id, e.new_count, e.sample, r.refund_total, h.failing, h.steps
FROM (
  SELECT
    -- Age since the job became runnable: a retry waiting for its back-off (run_after in the
    -- future) is not stuck.
    coalesce(extract(epoch FROM now() - min(run_after) FILTER (WHERE status = 'QUEUED' AND run_after <= now())), 0)::bigint AS queue_age,
    count(*) FILTER (WHERE status = 'QUEUED') AS queued,
    count(*) FILTER (WHERE status = 'FAILED' AND finished_at > now() - make_interval(mins => :win)) AS failed,
    count(*) FILTER (WHERE status IN ('COMPLETED', 'FAILED') AND finished_at > now() - make_interval(mins => :win)) AS finished
  FROM generations
  WHERE status = 'QUEUED' OR finished_at > now() - make_interval(mins => :win)
) g,
(
  SELECT
    (SELECT coalesce(max(id), 0) FROM error_log) AS max_id,
    (SELECT count(*) FROM error_log WHERE level = 'error' AND id > :last) AS new_count,
    (SELECT coalesce(string_agg(x, ' || ' ORDER BY id), '') FROM (
       SELECT id, regexp_replace(left(CASE WHEN scope <> '' THEN scope || ': ' ELSE '' END || message, 200), '[[:cntrl:]]+', ' ', 'g') AS x
       FROM error_log WHERE level = 'error' AND id > :last ORDER BY id LIMIT 3) s) AS sample
) e,
(SELECT coalesce(sum(count), 0) AS refund_total FROM error_log WHERE message LIKE '%$REFUND_MARKER%') r,
(
  SELECT count(*) AS failing, coalesce(string_agg(step, ',' ORDER BY step), '') AS steps
  FROM housekeeping_status
  WHERE last_error_at IS NOT NULL AND last_error_at > coalesce(last_ok_at, '-infinity'::timestamptz)
) h;
SQL
  ) || out=""
  IFS=$'\x1f' read -r qage queued failed finished maxid newerr sample refund hkfail hksteps <<<"$out" || true
  for v in "${qage:-}" "${queued:-}" "${failed:-}" "${finished:-}" "${maxid:-}" "${newerr:-}" "${refund:-}" "${hkfail:-}"; do
    if ! num "$v"; then
      check db 0 "watchdog SQL so'rovi ishlamadi ($PG_CONTAINER)" 2
      return 0
    fi
  done
  check db 1 "watchdog SQL so'rovi yana ishlayapti"

  if [ "$qage" -lt "$QUEUE_MAX_AGE_S" ]; then
    check queue 1 "navbat yana harakatda (navbatda $queued ta)"
  else
    check queue 0 "navbatdagi eng eski ish ${qage} s kutmoqda (navbatda $queued ta) — worker ishlamayaptimi?"
  fi

  if [ "$failed" -ge "$FAIL_MIN" ] && [ $((failed * 100)) -ge $((finished * FAIL_MAX_PCT)) ]; then
    check failrate 0 "so'nggi ${FAIL_WINDOW_MIN} daqiqada $failed/$finished ish FAILED (provayder ishlamayaptimi?)"
  else
    check failrate 1 "FAILED ulushi me'yorda ($failed/$finished, ${FAIL_WINDOW_MIN} daqiqa)"
  fi

  # New error fingerprints: every new error_log row is a fingerprint that was not open before.
  # The first run only records the baseline.
  if [ -n "$last" ] && [ "$newerr" -gt 0 ]; then
    if send "[ERROR] $NAME: $newerr ta yangi xato turi
$sample"; then put errid "$maxid"; fi
  else
    put errid "$maxid"
  fi

  prev=$(get refund)
  if num "$prev" && [ "$refund" -gt "$prev" ]; then
    if send "[ALERT] $NAME: REFUND_FAILED — $((refund - prev)) ta ishda pul qaytarilmadi, admin paneldagi xatolarni tekshiring"; then
      put refund "$refund"
    fi
  else
    put refund "$refund"
  fi

  if [ "$hkfail" = 0 ]; then
    check housekeeping 1 "housekeeping qadamlari yana muvaffaqiyatli"
  else
    check housekeeping 0 "$hkfail ta housekeeping qadami xato bermoqda: $hksteps"
  fi
}

# check_age KEY DIR GLOB MAX_MIN LABEL [FALLBACK_GLOB]
check_age() {
  local key=$1 dir=$2 glob=$3 max=$4 label=$5 fallback=${6:-} t age
  t=$(newest_mtime "$dir" "$glob")
  if [ -z "$t" ] && [ -n "$fallback" ]; then t=$(newest_mtime "$dir" "$fallback"); fi
  if ! num "$t"; then
    check "$key" 0 "$label topilmadi ($dir)"
    return 0
  fi
  age=$(((NOW - t) / 60))
  if [ "$age" -lt "$max" ]; then
    check "$key" 1 "$label ${age} daqiqa oldin"
  else
    check "$key" 0 "$label $((age / 60)) soat oldin (chegara $((max / 60)) soat)"
  fi
}

check_backups() {
  # backup.sh touches .last-ok only after a verified dump AND a verified off-box copy.
  check_age backup "$BACKUP_DIR" .last-ok "$BACKUP_MAX_AGE_MIN" "oxirgi muvaffaqiyatli to'liq zaxira" 'slaydx-*.dump'
  if [ -d "$LEDGER_DIR" ]; then
    check_age ledger "$LEDGER_DIR" 'ledger-*.dump' "$LEDGER_MAX_AGE_MIN" "oxirgi soatlik ledger zaxirasi"
  fi
  if [ -e "$BACKUP_DIR/.restore-check-ok" ]; then
    check_age restore "$BACKUP_DIR" .restore-check-ok "$RESTORE_MAX_AGE_MIN" "oxirgi muvaffaqiyatli tiklash sinovi"
  fi
}

check_cert() {
  local end
  [ -n "$CERT_FILE" ] || return 0
  if [ ! -r "$CERT_FILE" ]; then
    check cert 0 "TLS sertifikatini o'qib bo'lmadi ($CERT_FILE)"
  elif openssl x509 -checkend $((CERT_MIN_DAYS * 86400)) -noout -in "$CERT_FILE" >/dev/null 2>&1; then
    check cert 1 "TLS sertifikati yangilandi"
  else
    end=$(openssl x509 -enddate -noout -in "$CERT_FILE" 2>/dev/null | cut -d= -f2 || true)
    check cert 0 "TLS sertifikati ${CERT_MIN_DAYS} kundan kam qoldi (tugaydi: ${end:-?}) — certbot renew ishlayaptimi?"
  fi
}

# ── daily digest ────────────────────────────────────────────────────────────────────────
age_text() {
  local t
  t=$(newest_mtime "$1" "$2")
  if num "$t"; then echo "$(((NOW - t) / 60)) daqiqa oldin"; else echo "yo'q"; fi
}

digest() {
  local out done24 failed24 queued err24 dbsize avail swap pct active f none
  out=$(psql_rows 2>/dev/null <<'SQL'
SELECT
  count(*) FILTER (WHERE status = 'COMPLETED' AND finished_at > now() - interval '24 hours'),
  count(*) FILTER (WHERE status = 'FAILED' AND finished_at > now() - interval '24 hours'),
  count(*) FILTER (WHERE status = 'QUEUED'),
  (SELECT count(*) FROM error_log WHERE level = 'error' AND first_seen_at > now() - interval '24 hours'),
  pg_size_pretty(pg_database_size(current_database()))
FROM generations
WHERE status = 'QUEUED' OR finished_at > now() - interval '24 hours';
SQL
  ) || out=""
  IFS=$'\x1f' read -r done24 failed24 queued err24 dbsize <<<"$out" || true
  read -r avail swap <<<"$(mem_stats)" || true
  pct=$(disk_pct)
  active=""
  none="yo'q"
  for f in "$STATE_DIR"/alert-*; do
    [ -e "$f" ] || continue
    active="$active ${f##*/alert-}"
  done
  send "[DIGEST] $NAME, 24 soat:
ishlar: ${done24:-?} tayyor, ${failed24:-?} FAILED, navbatda ${queued:-?}
yangi xato turlari: ${err24:-?}
baza: ${dbsize:-?}; disk: ${pct:-?}%; RAM bo'sh: ${avail:-?} MB; swap: ${swap:-?} MB
to'liq zaxira: $(age_text "$BACKUP_DIR" .last-ok); ledger: $(age_text "$LEDGER_DIR" 'ledger-*.dump')
faol ogohlantirishlar:${active:- $none}" || true
}

if [ "$MODE" = digest ]; then
  digest
  exit 0
fi

check_health
check_containers
check_disk
check_mem
check_db
check_backups
check_cert

if [ "${#FAILING[@]}" -eq 0 ]; then
  echo "watchdog: $(date -Iseconds) ok"
else
  echo "watchdog: $(date -Iseconds) failing: ${FAILING[*]}"
fi
exit 0
