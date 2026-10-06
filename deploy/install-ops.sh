#!/usr/bin/env bash
# Installs the SlaydX ops cron jobs + log rotation on the server (idempotent; docs/ops/PLAN.md D3, D6):
#   /etc/cron.d/slaydx-backup    nightly full backup (01:30), hourly ledger dump, weekly restore drill
#   /etc/cron.d/slaydx-watchdog  every 3 minutes + a daily digest (alert-only: WATCHDOG_AUTO_RESTART stays 0)
#   /etc/cron.d/slaydx-auto-deploy  every minute: deploy a promoted origin/main commit (deploy/auto-deploy.sh)
#   /etc/logrotate.d/slaydx-ops  weekly, 8 rotations, new files 0600 (logs can carry error text)
# The scripts run from the checkout (/opt/slaydx/scripts, updated by every deploy); the env file
# /etc/slaydx/backup.env (root 600) already holds TELEGRAM_BOT_TOKEN + BACKUP_TG_CHAT.
#   deploy/install-ops.sh            install
#   deploy/install-ops.sh --dry-run  print the files instead of writing them
# Touches only the three files above. Re-run after changing the schedule.
set -euo pipefail
umask 022

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
APP_DIR=${SLAYDX_APP_DIR:-/opt/slaydx}
CRON_DIR=${SLAYDX_CRON_DIR:-/etc/cron.d}
LOGROTATE_DIR=${SLAYDX_LOGROTATE_DIR:-/etc/logrotate.d}
BIN_DIR=${SLAYDX_BIN_DIR:-/usr/local/bin}
BACKUP_LOG=/var/log/slaydx-backup.log
AUTO_LOG=/var/log/slaydx-auto-deploy.log
WATCHDOG_LOG=/var/log/slaydx-watchdog.log

for s in watchdog.sh backup-ledger.sh restore-check.sh; do
  [ -f "$APP_DIR/scripts/$s" ] || { echo "ERROR: $APP_DIR/scripts/$s not found — deploy the new version first" >&2; exit 1; }
done
for b in slaydx-backup slaydx-auto-deploy; do
  [ -x "$BIN_DIR/$b" ] || { echo "ERROR: $BIN_DIR/$b missing — run deploy/install-deploy.sh first" >&2; exit 1; }
done

backup_cron="# SlaydX backups (managed by deploy/install-ops.sh; times are server time, Europe/Berlin)
# nightly full backup: local dump + verified off-box copy + retention
30 1 * * * root umask 077; $BIN_DIR/slaydx-backup >> $BACKUP_LOG 2>&1
# hourly ledger dump (users, transactions, payments): small and quick, 48 h kept locally
5 * * * * root umask 077; $APP_DIR/scripts/backup-ledger.sh >> $BACKUP_LOG 2>&1
# weekly restore drill into a throw-away container (Sunday 05:00): proves the dump restores, alerts on failure
0 5 * * 0 root umask 077; $APP_DIR/scripts/restore-check.sh >> $BACKUP_LOG 2>&1
"
watchdog_cron="# SlaydX watchdog (managed by deploy/install-ops.sh): alert-only; set WATCHDOG_AUTO_RESTART=1 in /etc/slaydx/backup.env to enable restarts
*/3 * * * * root umask 077; $APP_DIR/scripts/watchdog.sh >> $WATCHDOG_LOG 2>&1
0 6 * * * root umask 077; $APP_DIR/scripts/watchdog.sh --digest >> $WATCHDOG_LOG 2>&1
"
auto_cron="# SlaydX auto-deploy (managed by deploy/install-ops.sh): deploys a promoted origin/main commit within a minute.
# Pause: touch /etc/slaydx/auto-deploy.disabled   Resume: rm it   Skip one commit: put [skip deploy] in its message.
* * * * * root umask 077; $BIN_DIR/slaydx-auto-deploy >> $AUTO_LOG 2>&1
"
logrotate_conf="$BACKUP_LOG $WATCHDOG_LOG $AUTO_LOG {
    weekly
    rotate 8
    missingok
    notifempty
    compress
    delaycompress
    create 0600 root root
}
"

write() { # path content
  if [ "$DRY_RUN" = 1 ]; then
    printf '=== %s\n%s\n' "$1" "$2"
  else
    install -d "$(dirname "$1")"
    printf '%s' "$2" > "$1.tmp"
    chmod 0644 "$1.tmp"
    mv "$1.tmp" "$1"
    echo "installed: $1"
  fi
}

write "$CRON_DIR/slaydx-backup" "$backup_cron"
write "$CRON_DIR/slaydx-watchdog" "$watchdog_cron"
write "$CRON_DIR/slaydx-auto-deploy" "$auto_cron"
write "$LOGROTATE_DIR/slaydx-ops" "$logrotate_conf"

if [ "$DRY_RUN" = 0 ]; then
  # Existing logs created by the old cron lines may be world-readable; they can carry error text.
  for f in "$BACKUP_LOG" "$WATCHDOG_LOG" "$AUTO_LOG"; do [ -f "$f" ] && chmod 0600 "$f"; done
  true
fi
