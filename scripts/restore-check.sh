#!/usr/bin/env bash
#
# scripts/restore-check.sh — eng so'nggi zaxirani MUSTAQIL, vaqtinchalik
# Postgres konteynerga tiklab, asosiy jadvallar va balans invariantini
# tekshiradi (C24, audit/designs/backups.md). Bunday tekshiruv ilgari
# umuman bo'lmagan — tiklash hech qachon sinalmagan edi (INFRA-05).
#
# Konteyner `slaydx-*` oilasiga TEGISHLI EMAS — mustaqil nom bilan
# yaratiladi va tekshiruv oxirida (muvaffaqiyatli yoki xato bo'lsin)
# albatta o'chiriladi. Boshqa (slaydx yoki qo'shni loyiha) konteynerlariga
# UMUMAN tegilmaydi.
#
# Weekly drill (docs/ops/O3-robustness-ops.md §6): the measured duration is the documented
# database RTO. Every run prints its timing and appends a JSON line to `$BACKUP_DIR/backup.log`;
# a success touches `$BACKUP_DIR/.restore-check-ok` (scripts/watchdog.sh alerts when it gets
# old); ANY failure alerts the owner on Telegram (same `/etc/slaydx/backup.env` as backup.sh).
# The image defaults to the exact Postgres image pinned in docker-compose.yml — the same
# version as production, and no extra download because its layers are already on the box.
set -euo pipefail

started=$(date +%s)
fail_msg=""
restore_sec=0

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/slaydx/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$BACKUP_ENV_FILE"
fi

BACKUP_DIR="${BACKUP_DIR:-/root/slaydx-backups}"
COMPOSE_FILE="${RESTORE_CHECK_COMPOSE_FILE:-$(cd "$(dirname "$0")/.." && pwd)/docker-compose.yml}"
PG_PASSWORD="restore-check-$$"
PG_DB="restorecheck"
container="slaydx-restore-check-$$"

notify_failure() {
  if [ -n "${BACKUP_TG_CHAT:-}" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
      curl -s -m 10 -o /dev/null -K - \
        --data-urlencode "chat_id=${BACKUP_TG_CHAT}" \
        --data-urlencode "text=SlaydX tiklash sinovi MUVAFFAQIYATSIZ: $1" >/dev/null 2>&1 || true
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# One JSON line per run in the backup log (only when the directory is writable).
log_run() {
  if [ -d "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ]; then
    printf '{"ts":"%s","kind":"restore-check","status":"%s","durationSec":%s,"restoreSec":%s,"error":"%s"}\n' \
      "$(date -Iseconds)" "$1" "$(($(date +%s) - started))" "$restore_sec" "$(json_escape "${2:-}")" \
      >>"$BACKUP_DIR/backup.log" 2>/dev/null || true
  fi
}

# fail MESSAGE — stop with an explicit reason (the EXIT trap logs it and alerts).
fail() {
  fail_msg="$1"
  echo "restore-check: XATO — $1" >&2
  exit 1
}

finish() {
  local rc=$?
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [ "$rc" -ne 0 ]; then
    [ -n "$fail_msg" ] || fail_msg="kutilmagan xato (exit $rc)"
    log_run error "$fail_msg"
    notify_failure "$fail_msg"
  fi
}
trap finish EXIT

if [ -n "${RESTORE_CHECK_IMAGE:-}" ]; then
  IMAGE="$RESTORE_CHECK_IMAGE"
else
  # The first `image: postgres:<tag>` line of docker-compose.yml — one source of truth.
  IMAGE=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(postgres:[^[:space:]#"]*\).*/\1/p' "$COMPOSE_FILE" 2>/dev/null | head -1 || true)
  [ -n "$IMAGE" ] || fail "Postgres image'ini $COMPOSE_FILE dan aniqlab bo'lmadi (RESTORE_CHECK_IMAGE bilan bering)"
fi

dump_file="${1:-}"
if [ -z "$dump_file" ]; then
  dump_file=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'slaydx-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2- || true)
fi
if [ -z "$dump_file" ] || [ ! -f "$dump_file" ]; then
  fail "tiklash uchun dump topilmadi ($BACKUP_DIR)"
fi

echo "restore-check: $dump_file -> $container ($IMAGE)"

# `--network none` — bu konteyner hech qanday tarmoq kirishiga muhtoj emas
# (faqat `docker exec`/`docker cp` orqali ishlaydi), umumiy box'da qo'shimcha
# yuzaga chiqmasin. `--memory 1g` — vaqtinchalik konteyner ham chegarasiz
# bo'lmasin (reviewer topilmasi).
docker run -d --name "$container" \
  --network none \
  --memory 1g \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  -e POSTGRES_DB="$PG_DB" \
  "$IMAGE" >/dev/null

# Rasmiy postgres image konteyner ichida AVVAL vaqtinchalik (`listen_addresses=''`,
# faqat unix socket) serverni ishga tushiradi va shundan keyingina asosiysini —
# `pg_isready` unix socket orqali shu VAQTINCHALIK serverga ham "tayyor" deb
# javob berishi mumkin, hali `$PG_DB` yaratilmasdan yoki yopilish arafasida
# (reviewer topilmasi — soxta haftalik signal). `-h 127.0.0.1` FAQAT haqiqiy,
# tarmoqqa quloq soluvchi serverga tegadi; qo'shimcha ravishda haqiqiy
# `SELECT 1` so'rovi ham o'tishi shart — ikkalasi birga chinakam tayyorlikni
# bildiradi.
tries=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 \
  && docker exec "$container" psql -h 127.0.0.1 -U postgres -d "$PG_DB" -tAc "SELECT 1" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    fail "Postgres 30 soniyada tayyor bo'lmadi (pg_isready+SELECT 1)"
  fi
  sleep 1
done

docker cp "$dump_file" "$container:/tmp/restore.dump"
restore_started=$(date +%s)
if ! docker exec "$container" pg_restore -U postgres -d "$PG_DB" --no-owner --no-acl -j 2 /tmp/restore.dump; then
  fail "pg_restore muvaffaqiyatsiz tugadi ($(basename "$dump_file"))"
fi
restore_sec=$(($(date +%s) - restore_started))

echo "restore-check: jadval qatorlari soni"
docker exec "$container" psql -U postgres -d "$PG_DB" -tAc "
  SELECT 'users=' || count(*) FROM users
  UNION ALL SELECT 'generations=' || count(*) FROM generations
  UNION ALL SELECT 'transactions=' || count(*) FROM transactions
"

echo "restore-check: balans invarianti (users.balance == SUM(transactions.balance_delta))"
mismatches=$(docker exec "$container" psql -U postgres -d "$PG_DB" -tAc "
  SELECT count(*) FROM (
    SELECT u.id
    FROM users u
    LEFT JOIN transactions t ON t.user_id = u.id
    GROUP BY u.id, u.balance
    HAVING u.balance <> COALESCE(sum(t.balance_delta), 0)
  ) mismatched
" | tr -d '[:space:]')

if ! [[ "$mismatches" =~ ^[0-9]+$ ]] || [ "$mismatches" -ne 0 ]; then
  fail "${mismatches:-?} foydalanuvchida balans jurnal (transactions) bilan mos emas"
fi

duration=$(($(date +%s) - started))
log_run ok ""
if [ -d "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ]; then
  touch "$BACKUP_DIR/.restore-check-ok"
fi
echo "restore-check: OK — tiklash muvaffaqiyatli, balans invarianti to'g'ri (jami ${duration} s, pg_restore ${restore_sec} s)"
exit 0
