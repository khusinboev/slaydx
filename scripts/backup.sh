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

# ── Trap va yordamchi funksiyalar — ENG BOSHIDA (reviewer topilmasi) ────
# Ilgari bular pastda, `mkdir`/sozlamalardan KEYIN aniqlangan edi — ya'ni
# eng boshidagi buyruqlar (masalan `mkdir -p "$BACKUP_DIR"`) xato bersa,
# `fail()` HALI MAVJUD EMAS edi va ERR trap ham ro'yxatdan o'tmagan edi.
# `${var:-}` xavfsiz kengaytirish bilan bu funksiyalar/trap'lar hali
# o'zgaruvchilar (`tmp`, `log`, ...) tayinlanmagan bo'lsa ham xavfsiz.
started=$(date +%s)

notify_failure() {
  local msg="$1"
  if [ -n "${BACKUP_TG_CHAT:-}" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    # The token goes to curl on stdin (`-K -`), not on the command line (`ps` shows argv).
    printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
      curl -s -m 10 -o /dev/null -K - \
        --data-urlencode "chat_id=${BACKUP_TG_CHAT}" \
        --data-urlencode "text=SlaydX backup MUVAFFAQIYATSIZ: ${msg}" >/dev/null 2>&1 || true
  fi
}

json_escape() {
  # Tirnoq va backslash'ni JSON uchun qochiradi — bitta qatorli xabarlar yetarli.
  printf '%s' "$1" | tr '\000-\037' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# HAR qanday kutilmagan xato (docker cp, mv, mkdir, stat, ...) ham shu
# yerga tushishi kerak — ilgari faqat pg_dump va hajm tekshiruvi `fail()`ni
# chaqirardi, qolgan yo'llarda `backup.log`ga yozuv YO'Q, alert YO'Q va
# to'liq hajmli `.tmp` fayl abadiy qolib ketardi (reviewer topilmasi).
fail() {
  # `fail()` ICHIDA yana xato bo'lsa (masalan disk to'la — printf/curl ham
  # ishlamay qoladi) cheksiz aylanmasin va baribir `exit 1`ga yetib borsin.
  set +e
  trap - ERR
  local msg="$1"
  echo "backup: XATO — $msg" >&2
  local duration=$(( $(date +%s) - started ))
  # `${log:-}` — bu funksiya `log` HALI tayinlanmagan bosqichda (masalan
  # `mkdir -p "$BACKUP_DIR"`ning o'zi xato bersa) ham chaqirilishi mumkin;
  # bunda yozuv joyi yo'qligi sababli JSON qatordan voz kechamiz, lekin
  # yuqoridagi stderr xabari va Telegram alert baribir yetib boradi.
  if [ -n "${log:-}" ]; then
    printf '{"ts":"%s","status":"error","error":"%s","durationSec":%s}\n' \
      "$(date -Iseconds)" "$(json_escape "$msg")" "$duration" >> "$log" 2>/dev/null
  fi
  notify_failure "$msg"
  exit 1
}

# ERR trap: aniq `|| fail ...` bilan ushlanmagan HAR QANDAY buyruq xatosi
# ham log+alert yo'lidan o'tsin (`docker cp`, `mv`, `mkdir` va h.k.) —
# SKRIPT BOSHIDANOQ amal qiladi.
trap 'fail "kutilmagan xato (satr $LINENO)"' ERR
# `.tmp` (va PG_CONTAINER ichidagi tekshiruv nusxasi) HAR qanday chiqishda
# (muvaffaqiyat, xato, signal) tozalansin — muvaffaqiyatda `.tmp` allaqachon
# `$final`ga ko'chirilgan bo'ladi, shuning uchun `rm -f` xavfsiz. `${x:-}`
# — bular hali tayinlanmagan bo'lsa ham (erta chiqishda) xavfsiz.
trap 'rm -f -- "${tmp:-}" "${errfile:-}" "${gfs_list:-}" 2>/dev/null; [ -n "${PG_CONTAINER:-}" ] && [ -n "${check_name:-}" ] && docker exec "$PG_CONTAINER" rm -f "/tmp/$check_name" >/dev/null 2>&1; true' EXIT

# ── Sozlama fayli (reviewer topilmasi) ──────────────────────────────────
# `cron` BO'SH muhitda ishga tushadi — `.env`ni O'QIMAYDI. `BACKUP_REMOTE`/
# `BACKUP_TG_CHAT`/`TELEGRAM_BOT_TOKEN`ni ATAYLAB shu alohida faylga
# qo'ying (600 huquq, root egasi — sirlar bor), MASALAN `/etc/slaydx/backup.env`:
#   BACKUP_REMOTE=b2:slaydx-backups
#   BACKUP_TG_CHAT=123456789
#   TELEGRAM_BOT_TOKEN=...
# ATAYLAB REPO CHECKOUT'DAN TASHQARIDA (`/opt/slaydx` EMAS): git bilan
# tegishli emas, `docker build`ning `COPY . .` (builder bosqichi) uni
# UMUMAN ko'rmaydi — repo ICHIDA turgan bo'lsa, sirlar image qatlamiga
# yoki `git add -A` bilan PUBLIC repo'ga tushib qolishi mumkin edi
# (reviewer topilmasi, R2a). Fayl bo'lmasa — muammo emas: box tashqarisiga
# nusxa yo'q, faqat ochiq ogohlantirish (pastda).
# `/opt/slaydx/.env`ning o'zini bu yerda source qilmang — u boshqa juda
# ko'p narsani ham export qiladi va bash sintaksisiga mos kelmasligi mumkin.
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/slaydx/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ]; then
  perm=$(stat -c%a "$BACKUP_ENV_FILE" 2>/dev/null || stat -f%Lp "$BACKUP_ENV_FILE" 2>/dev/null || echo "")
  if [ -n "$perm" ] && [ "$perm" != "600" ]; then
    echo "backup: OGOHLANTIRISH — $BACKUP_ENV_FILE huquqi $perm (600 tavsiya etiladi — sirlar bor)" >&2
  fi
  # shellcheck disable=SC1090
  . "$BACKUP_ENV_FILE"
fi

PG_CONTAINER="${PG_CONTAINER:-slaydx-postgres-1}"
PG_USER="${PG_USER:-slaydx}"
PG_DB="${PG_DB:-slaydx}"
BACKUP_DIR="${BACKUP_DIR:-/root/slaydx-backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
# Haqiqiy productionda ~MB o'lchamli bo'ladi; faqat sinov/bo'sh bazalarda
# (masalan CI'ning tashlama Postgres'i) kichikroq shift kerak bo'lishi mumkin.
BACKUP_MIN_SIZE_BYTES="${BACKUP_MIN_SIZE_BYTES:-1048576}"
# Off-box retention (owner decision D6, docs/ops/PLAN.md): `gfs` keeps 7 daily + 4 weekly +
# 6 monthly dumps on an rclone remote; `off` never deletes anything remote. rsync targets are
# never pruned by this script.
BACKUP_REMOTE_RETENTION="${BACKUP_REMOTE_RETENTION:-gfs}"
BACKUP_GFS_DAILY="${BACKUP_GFS_DAILY:-7}"
BACKUP_GFS_WEEKLY="${BACKUP_GFS_WEEKLY:-4}"
BACKUP_GFS_MONTHLY="${BACKUP_GFS_MONTHLY:-6}"
# Test seam: the day (YYYYMMDD) the GFS policy counts from (default: today).
BACKUP_GFS_TODAY="${BACKUP_GFS_TODAY:-$(date +%Y%m%d)}"

for v in BACKUP_KEEP_DAYS BACKUP_GFS_DAILY BACKUP_GFS_WEEKLY BACKUP_GFS_MONTHLY; do
  [[ "${!v}" =~ ^[0-9]+$ ]] || fail "$v butun son bo'lishi kerak"
done
[ "$BACKUP_GFS_DAILY" -ge 1 ] || fail "BACKUP_GFS_DAILY kamida 1 bo'lishi kerak"
[[ "$BACKUP_GFS_TODAY" =~ ^[0-9]{8}$ ]] || fail "BACKUP_GFS_TODAY YYYYMMDD ko'rinishida bo'lishi kerak"
case "$BACKUP_REMOTE_RETENTION" in gfs | off) ;; *) fail "BACKUP_REMOTE_RETENTION faqat gfs yoki off" ;; esac

# GFS: reads remote file names on stdin and prints the dumps the policy no longer needs.
# Kept: every dump dated within the last BACKUP_GFS_DAILY days, plus the newest dump of each of
# the latest BACKUP_GFS_DAILY days, BACKUP_GFS_WEEKLY ISO weeks and BACKUP_GFS_MONTHLY months
# that have one. Only names shaped `slaydx-YYYYMMDD-HHMMSS.dump` can ever be listed; anything
# else on the remote is left alone.
gfs_prune_list() {
  local cutoff name d w m keep nd=0 nw=0 nm=0 last_d="" last_w="" last_m=""
  cutoff=$(date -d "$BACKUP_GFS_TODAY - $BACKUP_GFS_DAILY days" +%Y%m%d) || return 1
  # Newest first: the dumps of one day / ISO week / month are adjacent, and the first of each
  # group is its newest.
  while IFS= read -r name; do
    d=${name:7:8}
    if ! w=$(date -d "$d" +%G%V 2>/dev/null); then continue; fi
    m=${d:0:6}
    keep=0
    if [[ "$d" > "$cutoff" ]]; then keep=1; fi
    if [ "$d" != "$last_d" ]; then
      nd=$((nd + 1)); last_d=$d
      if [ "$nd" -le "$BACKUP_GFS_DAILY" ]; then keep=1; fi
    fi
    if [ "$w" != "$last_w" ]; then
      nw=$((nw + 1)); last_w=$w
      if [ "$nw" -le "$BACKUP_GFS_WEEKLY" ]; then keep=1; fi
    fi
    if [ "$m" != "$last_m" ]; then
      nm=$((nm + 1)); last_m=$m
      if [ "$nm" -le "$BACKUP_GFS_MONTHLY" ]; then keep=1; fi
    fi
    if [ "$keep" = 0 ]; then printf '%s\n' "$name"; fi
  done < <(grep -E '^slaydx-[0-9]{8}-[0-9]{6}\.dump$' | sort -r || true)
}

umask 077
mkdir -p "$BACKUP_DIR"

ts=$(date +%Y%m%d-%H%M%S)
final="$BACKUP_DIR/slaydx-$ts.dump"
tmp="$final.tmp"
log="$BACKUP_DIR/backup.log"
check_name="_slaydx_backup_check_$$.dump"
errfile=$(mktemp "${TMPDIR:-/tmp}/slaydx-backup-err.XXXXXX")

echo "backup: $PG_CONTAINER ($PG_DB) -> $final"

docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$tmp" 2>"$errfile" \
  || fail "pg_dump muvaffaqiyatsiz: $(tr '\n' ' ' < "$errfile" 2>/dev/null)"

size=$(stat -c%s "$tmp" 2>/dev/null || stat -f%z "$tmp" 2>/dev/null || echo 0)
if [ "$size" -lt "$BACKUP_MIN_SIZE_BYTES" ]; then
  fail "dump juda kichik ($size bayt < $BACKUP_MIN_SIZE_BYTES) — buzilgan yoki bo'sh bo'lishi mumkin"
fi

# `pg_restore --list` bilan tekshiramiz — validatsiya PG_CONTAINER'ning
# O'ZIDA ishlaydi (host'da postgresql-client kerak emas, versiya ham mos).
docker cp "$tmp" "$PG_CONTAINER:/tmp/$check_name"
if ! docker exec "$PG_CONTAINER" pg_restore --list "/tmp/$check_name" >/dev/null 2>&1; then
  fail "pg_restore --list dumpni o'qiy olmadi — dump buzilgan"
fi
docker exec "$PG_CONTAINER" rm -f "/tmp/$check_name" >/dev/null 2>&1 || true

mv "$tmp" "$final"
duration=$(( $(date +%s) - started ))
echo "backup: OK — $final ($size bayt, $duration s)"

# Eskirgan lokal nusxalarni tozalash (eng yomon holatda YAXSHI dump'ni
# yo'qotmasin deb — bu qadam FATAL emas, faqat ogohlantiradi).
# Pre-deploy dumps (`slaydx-<ts>.sql` from the deploy guide, `slaydx-predeploy-<ts>.dump`) follow
# the same local retention — they used to pile up forever (docs/ops/O3-robustness-ops.md §2).
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'slaydx-*.dump' -o -name 'slaydx-*.sql' -o -name 'slaydx-*.sql.gz' \) \
  -mtime "+$BACKUP_KEEP_DAYS" -delete 2>/dev/null \
  || echo "backup: OGOHLANTIRISH — eskirgan nusxalarni tozalash muvaffaqiyatsiz" >&2

# Box tashqarisiga nusxa — sozlanmagan bo'lsa ochiq ogohlantiramiz (jim
# qolib, "zaxira bor" deb ishonib qolishdan ko'ra yaxshi). LEKIN sozlangan
# bo'lib-da muvaffaqiyatsiz bo'lsa — bu FATAL: reviewer topilmasi (ilgari
# faqat stderr ogohlantirishi bo'lib, umumiy natija baribir "ok" edi).
remote_status="skipped"
if [ "${BACKUP_LOCAL_ONLY:-0}" = 1 ]; then
  # Pre-deploy dump (deploy/deploy-*.sh): a verified LOCAL dump is the rollback point; the multi-minute
  # off-box upload is left to the nightly run. Not a full backup: `.last-ok` is NOT touched below.
  remote_status="local-only"
elif [ -n "${BACKUP_REMOTE:-}" ]; then
  remote_status="failed"
  case "$BACKUP_REMOTE" in
    *@*:*)
      # rsync manzili: user@host:/yo'l. Nusxalashdan keyin `--dry-run` bilan
      # qayta solishtiramiz ("o'lcham bo'yicha tasdiqlash") — bo'sh chiqish
      # hech narsa ko'chirilishi kerak emasligini, ya'ni nusxa TO'LIQ va
      # mos ekanini bildiradi.
      if rsync -az "$final" "$BACKUP_REMOTE/" \
        && [ -z "$(rsync -az --dry-run --out-format='%n' "$final" "$BACKUP_REMOTE/" 2>/dev/null)" ]; then
        remote_status="ok"
      fi
      ;;
    *)
      # rclone check compares directories, not single files: check the backup dir
      # against the remote one-way, limited to this dump (verified on Google Drive, 2026-10-03).
      # rclone masofaviy nomi: masalan b2:slaydx-backups. `rclone check`
      # hajm/hash bo'yicha haqiqiy tasdiqlaydi.
      if rclone copy "$final" "$BACKUP_REMOTE/" \
        && rclone check "$BACKUP_DIR" "$BACKUP_REMOTE" --one-way --include "$(basename "$final")" >/dev/null 2>&1; then
        remote_status="ok"
      fi
      ;;
  esac
  if [ "$remote_status" != "ok" ]; then
    # Lokal dump $final O'ZI yaxshi va qoladi (faqat `$tmp` EXIT trap bilan
    # tozalanadi) — lekin off-box nusxa yo'qligi butun run'ni MUVAFFAQIYATSIZ
    # deb belgilaydi, chunki tasodifiy nom bilan jim qolib ketmasligi kerak.
    fail "box tashqarisiga nusxalash muvaffaqiyatsiz ($BACKUP_REMOTE) — lokal dump $final o'zi yaxshi, lekin off-box nusxa YO'Q"
  fi
else
  echo "backup: OGOHLANTIRISH — BACKUP_REMOTE sozlanmagan ($BACKUP_ENV_FILE), box TASHQARISIGA nusxa YO'Q (disk/server yo'qolsa zaxira ham yo'qoladi)" >&2
fi

# Off-box GFS retention — only after this run's copy was verified, only on rclone remotes.
# Two independent guards keep recent dumps: the computed list never contains a dump dated
# within BACKUP_GFS_DAILY days, and rclone's own `--min-age` filter skips anything younger even
# if it were listed. A failed prune is not fatal (the backup itself is good) but is reported.
retention_status="skipped"
pruned=0
if [ "$remote_status" = ok ] && [ "$BACKUP_REMOTE_RETENTION" = gfs ]; then
  case "$BACKUP_REMOTE" in
    *@*:*) ;;
    *)
      retention_status="failed"
      gfs_list=$(mktemp "${TMPDIR:-/tmp}/slaydx-gfs.XXXXXX")
      if listing=$(rclone lsf --files-only --max-depth 1 "$BACKUP_REMOTE" 2>/dev/null) \
        && printf '%s\n' "$listing" | gfs_prune_list > "$gfs_list"; then
        pruned=$(grep -c . "$gfs_list" || true)
        if [ "$pruned" -eq 0 ]; then
          retention_status="ok"
        elif rclone delete "$BACKUP_REMOTE" --files-from-raw "$gfs_list" --min-age "${BACKUP_GFS_DAILY}d" --max-depth 1 >/dev/null 2>&1; then
          retention_status="ok"
          echo "backup: GFS — box tashqarisidagi $pruned ta eskirgan nusxa o'chirildi"
        fi
      fi
      if [ "$retention_status" != ok ]; then
        echo "backup: OGOHLANTIRISH — box tashqarisidagi GFS tozalash muvaffaqiyatsiz ($BACKUP_REMOTE), dump o'zi yaxshi" >&2
      fi
      ;;
  esac
fi

printf '{"ts":"%s","status":"ok","file":"%s","sizeBytes":%s,"durationSec":%s,"remote":"%s","retention":"%s","pruned":%s}\n' \
  "$(date -Iseconds)" "$final" "$size" "$duration" "$remote_status" "$retention_status" "$pruned" >> "$log"
# scripts/watchdog.sh alerts when this marker is older than 26 h (verified dump + off-box copy).
# A local-only (pre-deploy) dump has no off-box copy, so it must not refresh the marker.
if [ "$remote_status" != "local-only" ]; then
  touch "$BACKUP_DIR/.last-ok"
fi

exit 0
