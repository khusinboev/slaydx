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
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/root/slaydx-backups}"
IMAGE="${RESTORE_CHECK_IMAGE:-postgres:16-alpine}"
PG_PASSWORD="restore-check-$$"
PG_DB="restorecheck"

dump_file="${1:-}"
if [ -z "$dump_file" ]; then
  dump_file=$(ls -t "$BACKUP_DIR"/slaydx-*.dump 2>/dev/null | head -1 || true)
fi
if [ -z "$dump_file" ] || [ ! -f "$dump_file" ]; then
  echo "restore-check: tiklash uchun dump topilmadi ($BACKUP_DIR)" >&2
  exit 1
fi

container="slaydx-restore-check-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "restore-check: $dump_file -> $container ($IMAGE)"

docker run -d --name "$container" \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  -e POSTGRES_DB="$PG_DB" \
  "$IMAGE" >/dev/null

tries=0
until docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "restore-check: Postgres 30 soniyada ko'tarilmadi" >&2
    exit 1
  fi
  sleep 1
done

docker cp "$dump_file" "$container:/tmp/restore.dump"
if ! docker exec "$container" pg_restore -U postgres -d "$PG_DB" --no-owner --no-acl -j 2 /tmp/restore.dump; then
  echo "restore-check: XATO — pg_restore muvaffaqiyatsiz tugadi" >&2
  exit 1
fi

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

if [ -z "$mismatches" ] || [ "$mismatches" -ne 0 ]; then
  echo "restore-check: XATO — ${mismatches:-?} foydalanuvchida balans jurnal (transactions) bilan mos emas" >&2
  exit 1
fi

echo "restore-check: OK — tiklash muvaffaqiyatli, balans invarianti to'g'ri"
exit 0
