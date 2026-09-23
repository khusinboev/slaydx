#!/usr/bin/env bash
#
# scripts/backup.sh — Postgres'ni kunlik siqilgan formatda zaxiralaydi (C24,
# audit/designs/backups.md). Ilgari zaxira faqat qo'lda, deploy oldidan
# olinardi va bitta diskda saqlanardi (INFRA-05) — bu skript cron orqali
# muntazam, tekshirilgan va (sozlansa) box TASHQARISIGA nusxa oladi.
#
# FAQAT `PG_CONTAINER`ga (standart `slaydx-postgres-1`) tegadi — boshqa
# konteynerlarga UMUMAN tegmaydi, `docker compose down`/prune hech qachon
# chaqirilmaydi (`.claude/deploy.md`: box uchta loyiha bilan umumiy).
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-slaydx-postgres-1}"
PG_USER="${PG_USER:-slaydx}"
PG_DB="${PG_DB:-slaydx}"
BACKUP_DIR="${BACKUP_DIR:-/root/slaydx-backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
# Haqiqiy productionda ~MB o'lchamli bo'ladi; faqat sinov/bo'sh bazalarda
# (masalan CI'ning tashlama Postgres'i) kichikroq shift kerak bo'lishi mumkin.
BACKUP_MIN_SIZE_BYTES="${BACKUP_MIN_SIZE_BYTES:-1048576}"

umask 077
mkdir -p "$BACKUP_DIR"

ts=$(date +%Y%m%d-%H%M%S)
started=$(date +%s)
final="$BACKUP_DIR/slaydx-$ts.dump"
tmp="$final.tmp"
log="$BACKUP_DIR/backup.log"
check_name="_slaydx_backup_check_$$.dump"

notify_failure() {
  local msg="$1"
  if [ -n "${BACKUP_TG_CHAT:-}" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    curl -s -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${BACKUP_TG_CHAT}" \
      --data-urlencode "text=SlaydX backup MUVAFFAQIYATSIZ: ${msg}" >/dev/null 2>&1 || true
  fi
}

json_escape() {
  # Tirnoq va backslash'ni JSON uchun qochiradi — bitta qatorli xabarlar yetarli.
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

fail() {
  local msg="$1"
  echo "backup: XATO — $msg" >&2
  rm -f "$tmp"
  local duration=$(( $(date +%s) - started ))
  printf '{"ts":"%s","status":"error","error":"%s","durationSec":%s}\n' \
    "$(date -Iseconds)" "$(json_escape "$msg")" "$duration" >> "$log"
  notify_failure "$msg"
  exit 1
}

echo "backup: $PG_CONTAINER ($PG_DB) -> $final"

docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$tmp" 2>/tmp/slaydx-backup-err.$$ \
  || fail "pg_dump muvaffaqiyatsiz: $(cat /tmp/slaydx-backup-err.$$ 2>/dev/null | tr '\n' ' ')"
rm -f "/tmp/slaydx-backup-err.$$"

size=$(stat -c%s "$tmp" 2>/dev/null || stat -f%z "$tmp" 2>/dev/null || echo 0)
if [ "$size" -lt "$BACKUP_MIN_SIZE_BYTES" ]; then
  fail "dump juda kichik ($size bayt < $BACKUP_MIN_SIZE_BYTES) — buzilgan yoki bo'sh bo'lishi mumkin"
fi

# `pg_restore --list` bilan tekshiramiz — validatsiya PG_CONTAINER'ning
# O'ZIDA ishlaydi (host'da postgresql-client kerak emas, versiya ham mos).
docker cp "$tmp" "$PG_CONTAINER:/tmp/$check_name"
if ! docker exec "$PG_CONTAINER" pg_restore --list "/tmp/$check_name" >/dev/null 2>&1; then
  docker exec "$PG_CONTAINER" rm -f "/tmp/$check_name" >/dev/null 2>&1 || true
  fail "pg_restore --list dumpni o'qiy olmadi — dump buzilgan"
fi
docker exec "$PG_CONTAINER" rm -f "/tmp/$check_name" >/dev/null 2>&1 || true

mv "$tmp" "$final"
duration=$(( $(date +%s) - started ))
echo "backup: OK — $final ($size bayt, $duration s)"

# Eskirgan lokal nusxalarni tozalash.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'slaydx-*.dump' -mtime "+$BACKUP_KEEP_DAYS" -delete 2>/dev/null || true

# Box tashqarisiga nusxa — sozlanmagan bo'lsa ochiq ogohlantiramiz (jim
# qolib, "zaxira bor" deb ishonib qolishdan ko'ra yaxshi).
remote_status="skipped"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  case "$BACKUP_REMOTE" in
    *@*:*)
      # rsync manzili: user@host:/yo'l
      if rsync -az "$final" "$BACKUP_REMOTE/"; then remote_status="ok"; else remote_status="failed"; fi
      ;;
    *)
      # rclone masofaviy nomi: masalan b2:slaydx-backups
      if rclone copy "$final" "$BACKUP_REMOTE/"; then remote_status="ok"; else remote_status="failed"; fi
      ;;
  esac
  if [ "$remote_status" != "ok" ]; then
    echo "backup: OGOHLANTIRISH — box tashqarisiga nusxalash muvaffaqiyatsiz ($BACKUP_REMOTE)" >&2
  fi
else
  echo "backup: OGOHLANTIRISH — BACKUP_REMOTE sozlanmagan, box TASHQARISIGA nusxa YO'Q (disk/server yo'qolsa zaxira ham yo'qoladi)" >&2
fi

printf '{"ts":"%s","status":"ok","file":"%s","sizeBytes":%s,"durationSec":%s,"remote":"%s"}\n' \
  "$(date -Iseconds)" "$final" "$size" "$duration" "$remote_status" >> "$log"

exit 0
