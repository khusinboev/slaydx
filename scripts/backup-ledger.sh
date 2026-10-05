#!/usr/bin/env bash
#
# scripts/backup-ledger.sh — hourly dump of the money/user tables (owner decision D6,
# docs/ops/PLAN.md; docs/ops/O3-robustness-ops.md §6). The daily full dump (scripts/backup.sh)
# leaves a 24 h recovery point for payments and credits; this one takes the small ledger tables
# every hour, so after a disaster the full dump can be topped up with at most one hour of lost
# money movements:
#
#   /etc/cron.d/slaydx-backup
#   5 * * * * root /opt/slaydx/scripts/backup-ledger.sh >>/var/log/slaydx-backup.log 2>&1
#
# Output: `$LEDGER_DIR/ledger-YYYYMMDD-HH.dump` (pg_dump custom format, verified with
# `pg_restore --list`). One file per hour — a re-run in the same hour atomically replaces it.
# Files older than LEDGER_KEEP_HOURS (48) are deleted. A failure alerts the owner on Telegram
# (same `/etc/slaydx/backup.env` as backup.sh; the token is passed to curl on stdin).
#
# Restore: never straight over a live database. Load the file into a scratch database
# (`createdb ledger_scratch && pg_restore -d ledger_scratch --no-owner ledger-….dump`), then copy
# the rows newer than the restored full dump — .claude/deploy.md «Soatlik ledger zaxirasi».
#
# Touches ONLY PG_CONTAINER (read-only pg_dump); never another container.
set -euo pipefail

started=$(date +%s)

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/slaydx/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$BACKUP_ENV_FILE"
fi

PG_CONTAINER="${PG_CONTAINER:-slaydx-postgres-1}"
PG_USER="${PG_USER:-slaydx}"
PG_DB="${PG_DB:-slaydx}"
BACKUP_DIR="${BACKUP_DIR:-/root/slaydx-backups}"
LEDGER_DIR="${LEDGER_DIR:-$BACKUP_DIR/ledger}"
LEDGER_KEEP_HOURS="${LEDGER_KEEP_HOURS:-48}"
# Money and identity: balances (users), the journal every balance is derived from
# (transactions), payment orders, provider callbacks and external refunds.
LEDGER_TABLES="${LEDGER_TABLES:-users transactions payment_orders payment_events payment_refunds}"

notify_failure() {
  local msg="$1"
  if [ -n "${BACKUP_TG_CHAT:-}" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
      curl -s -m 10 -o /dev/null -K - \
        --data-urlencode "chat_id=${BACKUP_TG_CHAT}" \
        --data-urlencode "text=SlaydX ledger zaxirasi MUVAFFAQIYATSIZ: ${msg}" >/dev/null 2>&1 || true
  fi
}

fail() {
  set +e
  trap - ERR
  local msg="$1"
  echo "backup-ledger: XATO — $msg" >&2
  if [ -n "${log:-}" ]; then
    printf '{"ts":"%s","status":"error","error":"%s","durationSec":%s}\n' \
      "$(date -Iseconds)" "$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')" "$(($(date +%s) - started))" >>"$log" 2>/dev/null
  fi
  notify_failure "$msg"
  exit 1
}

trap 'fail "kutilmagan xato (satr $LINENO)"' ERR
trap 'rm -f -- "${tmp:-}" "${errfile:-}" 2>/dev/null; true' EXIT

[[ "$LEDGER_KEEP_HOURS" =~ ^[0-9]+$ ]] && [ "$LEDGER_KEEP_HOURS" -ge 1 ] \
  || fail "LEDGER_KEEP_HOURS musbat butun son bo'lishi kerak"

table_args=()
for t in $LEDGER_TABLES; do
  [[ "$t" =~ ^[a-z_][a-z0-9_]*$ ]] || fail "noto'g'ri jadval nomi: $t"
  table_args+=(-t "public.$t")
done
[ "${#table_args[@]}" -gt 0 ] || fail "LEDGER_TABLES bo'sh"

umask 077
mkdir -p "$LEDGER_DIR"
log="$LEDGER_DIR/ledger.log"

# Two overlapping runs (a slow dump at the top of the hour) must not race on the same file.
exec 9>"$LEDGER_DIR/.lock"
flock -n 9 || { echo "backup-ledger: oldingi ishga tushirish hali tugamagan — o'tkazib yuborildi"; exit 0; }

final="$LEDGER_DIR/ledger-$(date +%Y%m%d-%H).dump"
tmp="$final.tmp"
errfile=$(mktemp "${TMPDIR:-/tmp}/slaydx-ledger-err.XXXXXX")

# --strict-names: a renamed/missing table is an error, not a silently smaller dump.
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc --strict-names "${table_args[@]}" "$PG_DB" >"$tmp" 2>"$errfile" \
  || fail "pg_dump muvaffaqiyatsiz: $(tr '\n' ' ' <"$errfile" 2>/dev/null)"

size=$(stat -c%s "$tmp")
[ "$size" -gt 0 ] || fail "dump bo'sh"

# Verified inside the Postgres container (same version), reading the archive from stdin.
docker exec -i "$PG_CONTAINER" pg_restore --list <"$tmp" >/dev/null 2>"$errfile" \
  || fail "pg_restore --list dumpni o'qiy olmadi: $(tr '\n' ' ' <"$errfile" 2>/dev/null)"

mv -f "$tmp" "$final"

find "$LEDGER_DIR" -maxdepth 1 -type f -name 'ledger-*.dump' -mmin "+$((LEDGER_KEEP_HOURS * 60))" -delete 2>/dev/null \
  || echo "backup-ledger: OGOHLANTIRISH — eskirgan ledger fayllarini tozalash muvaffaqiyatsiz" >&2

duration=$(($(date +%s) - started))
printf '{"ts":"%s","status":"ok","file":"%s","sizeBytes":%s,"durationSec":%s}\n' \
  "$(date -Iseconds)" "$final" "$size" "$duration" >>"$log"
echo "backup-ledger: OK — $final ($size bayt, $duration s)"
exit 0
