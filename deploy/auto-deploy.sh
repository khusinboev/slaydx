#!/usr/bin/env bash
# slaydx-auto-deploy — pull-based auto-deploy (cron, every minute, root). No GitHub secrets, no inbound SSH:
# the server itself notices that `origin/main` has a commit whose images CI promoted (`<sha>` tags, only after
# `ci-ok`) and runs `slaydx-deploy <sha>` (backup → pull → migrate → swap → health → automatic rollback).
#
# Never deploys when:  the kill switch file exists ($DISABLE_FILE) · another deploy/auto run holds a lock ·
#   the commit is not a fast-forward of the deployed one · its images are not promoted yet (CI running/failed) ·
#   it already failed once (never retried automatically — a newer commit supersedes it) ·
#   the commit message contains "[skip deploy]" · only docs/tests/CI/deploy-scripts changed ·
#   6 auto deploys already ran in the last hour.
# Alerts (once each): a hung deploy (> 30 min), a tip whose images are still not promoted after 45 min (CI red or the
# registry token expired), a diverged history, a failed deploy, and deploy/ scripts that changed (re-run install-*.sh).
# Anything `slaydx-deploy` refuses (destructive migration, …) is reported and left for a manual deploy.
# Trust model: whoever can push to main can already change what runs here (images, compose, cron scripts);
# auto-deploy adds no new privilege, and CI gates every commit it deploys.
# Telegram notices use the token in /etc/slaydx/backup.env (given to curl on stdin, never printed).
#   touch /etc/slaydx/auto-deploy.disabled   → pause;   rm it → resume
set -euo pipefail
umask 077

APP_DIR=${SLAYDX_APP_DIR:-/opt/slaydx}
STATE_DIR=${SLAYDX_STATE_DIR:-/var/lib/slaydx-deploy}
DEPLOY_CMD=${SLAYDX_DEPLOY_CMD:-/usr/local/bin/slaydx-deploy}
ENV_FILE=${SLAYDX_AUTO_ENV:-/etc/slaydx/backup.env}
LOCK_FILE=${SLAYDX_AUTO_LOCK:-$STATE_DIR/auto-deploy.lock}
DEPLOY_LOCK=${SLAYDX_LOCK_FILE:-/run/lock/slaydx-deploy.lock}
DISABLE_FILE=${SLAYDX_AUTO_DISABLE:-/etc/slaydx/auto-deploy.disabled}
REGISTRY=${SLAYDX_REGISTRY:-ghcr.io/khusinboev}
MAX_PER_HOUR=${SLAYDX_AUTO_MAX_PER_HOUR:-6}
export DOCKER_CONFIG=${SLAYDX_DOCKER_CONFIG:-/etc/slaydx/docker}
# Changes that never need a deploy: every changed path must match.
SKIP_RE='^(docs/|tests/|loadtests/|\.github/|\.claude/|deploy/|[^/]+\.md$|LICENSE$)'

log() { printf '%s auto-deploy: %s\n' "$(date -Is)" "$*"; }
# Same message as the last run → stay quiet (a red CI must not write a line every minute).
log_once() {
  local f="$STATE_DIR/auto-last-log"
  [ "$(cat "$f" 2>/dev/null || true)" = "$*" ] && return 0
  printf '%s\n' "$*" > "$f"
  log "$*"
}
once_file() { [ "$(cat "$STATE_DIR/$1" 2>/dev/null || true)" = "$2" ] && return 1; printf '%s\n' "$2" > "$STATE_DIR/$1"; return 0; }

if [ -f "$ENV_FILE" ]; then
  # Sourced as root: refuse a file anyone but root could have written.
  if [ "$(stat -c %u "$ENV_FILE")" != "${SLAYDX_AUTO_ENV_OWNER:-0}" ] || [ $(( 0$(stat -c %a "$ENV_FILE") & 022 )) -ne 0 ]; then
    echo "$(date -Is) auto-deploy: $ENV_FILE must be owned by root and not group/world writable — refusing" >&2
    exit 0
  fi
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
CHAT=${ALERT_TG_CHAT:-${BACKUP_TG_CHAT:-}}
notify() {
  [ -n "$CHAT" ] && [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || { log "Telegram is not configured — not sent: $1"; return 0; }
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
    curl -sS -f -m 10 -o /dev/null -K - --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$1" 2>/dev/null \
    || log "Telegram send failed"
}

[ ! -e "$DISABLE_FILE" ] || exit 0
mkdir -p "$STATE_DIR" "$(dirname "$LOCK_FILE")"
exec 8>"$LOCK_FILE"
flock -n 8 || exit 0
# A manual/other deploy in progress: leave it alone — but say so once if it has been running suspiciously long.
mkdir -p "$(dirname "$DEPLOY_LOCK")"
exec 7>"$DEPLOY_LOCK"
if ! flock -n 7; then
  started=$(cat "$STATE_DIR/auto-started" 2>/dev/null || echo 0)
  if [ "$started" -gt 0 ] && [ $(( $(date +%s) - started )) -gt 1800 ] && once_file auto-stale-notified "$started"; then
    notify "⚠️ SlaydX: deploy 30 daqiqadan beri tugamadi (qulf band). Tekshiring: /root/slaydx-backups/deploy-*.log"
  fi
  exit 0
fi

state_get() { [ -f "$STATE_DIR/current.env" ] && sed -n "/^$1=/{s/^$1=//p;q}" "$STATE_DIR/current.env" || true; }
cd "$APP_DIR"
timeout 60 git fetch -q origin main || { log "git fetch failed — will retry"; exit 0; }
tip=$(git rev-parse origin/main)
[[ "$tip" =~ ^[0-9a-f]{40}$ ]] || { log "unexpected origin/main value"; exit 0; }
cur=$(state_get sha)
[[ "$cur" =~ ^[0-9a-f]{40}$ ]] || { log "no deployed baseline in $STATE_DIR/current.env — run slaydx-deploy once by hand"; exit 0; }
seen=$(cat "$STATE_DIR/auto-seen" 2>/dev/null || true)
[ "$tip" != "$cur" ] && [ "$tip" != "$seen" ] || exit 0
short=${tip:0:7}

if ! git merge-base --is-ancestor "$cur" "$tip"; then
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  notify "⚠️ SlaydX auto-deploy: $short deployed commit ${cur:0:7} ning davomi emas (history o'zgargan). Qo'lda: slaydx-deploy $short"
  exit 0
fi

if git log -1 --format=%B "$tip" | grep -qiF '[skip deploy]'; then
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  log "$short skipped: [skip deploy]"
  exit 0
fi

# Only deploy once CI promoted BOTH images for this exact commit.
for img in slaydx-web slaydx-worker; do
  if ! docker manifest inspect "$REGISTRY/$img:$tip" >/dev/null 2>&1; then
    log_once "$short: $img image not promoted yet"
    ct=$(git log -1 --format=%ct "$tip" 2>/dev/null || echo 0)
    if [ "$ct" -gt 0 ] && [ $(( $(date +%s) - ct )) -gt 2700 ] && once_file auto-unpromoted-notified "$tip"; then
      notify "⚠️ SlaydX: $short uchun image'lar 45 daqiqadan beri tayyor emas (CI qizil yoki GHCR tokeni eskirgan?). Avto-deploy kutmoqda."
    fi
    exit 0
  fi
done

mapfile -d '' -t files < <(git diff -z --name-only "$cur" "$tip")
skip_all=1
deploy_scripts_changed=0
for f in "${files[@]}"; do
  [[ $f =~ $SKIP_RE ]] || { skip_all=0; break; }
done
for f in "${files[@]}"; do
  case $f in deploy/*) deploy_scripts_changed=1; break ;; esac
done
if [ "${#files[@]}" -gt 0 ] && [ "$skip_all" = 1 ]; then
  # Docs/tests/CI only: no restart. Keep the checkout current (cron scripts live in it).
  git reset -q --hard "$tip"
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  log "$short: only docs/tests/CI/deploy files changed — no deploy (checkout updated)"
  if [ "$deploy_scripts_changed" = 1 ]; then
    notify "ℹ️ SlaydX: $short da deploy/ skriptlari o'zgargan — serverga qo'lda o'rnating: bash /opt/slaydx/deploy/install-deploy.sh && bash /opt/slaydx/deploy/install-ops.sh"
  fi
  exit 0
fi

# Hourly cap (a burst of pushes must not turn into a burst of restarts).
now=$(date +%s)
times="$STATE_DIR/auto-times"
touch "$times"
recent=$(awk -v t="$now" 't - $1 < 3600' "$times" | wc -l)
if [ "$recent" -ge "$MAX_PER_HOUR" ]; then
  log "$short: $recent auto deploys in the last hour — waiting"
  exit 0
fi
echo "$now" >> "$times"
awk -v t="$now" 't - $1 < 86400' "$times" > "$times.new" && mv "$times.new" "$times"

notify "🚀 SlaydX avto-deploy boshlandi: $short ($(git log -1 --format=%s "$tip" | cut -c1-80))"
t0=$now
printf '%s\n' "$t0" > "$STATE_DIR/auto-started"
# slaydx-deploy takes the deploy lock itself: release ours right before. fd 8 is closed for the child so a hung deploy
# cannot keep the auto lock (the deploy lock alone gates the next runs).
exec 7>&-
out=$(mktemp "$STATE_DIR/auto-out.XXXXXX")
rc=0
"$DEPLOY_CMD" "$tip" >"$out" 2>&1 8>&- || rc=$?
cat "$out"
if [ "$rc" -ne 0 ] && grep -qF 'another deploy is running' "$out"; then
  rm -f "$out" "$STATE_DIR/auto-started"
  log "$short: another deploy started in the meantime — will retry"
  exit 0
fi
rm -f "$out" "$STATE_DIR/auto-started"
if [ "$rc" -eq 0 ]; then
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  notify "✅ SlaydX yangilandi: $short ($(( $(date +%s) - t0 )) soniya)"
else
  # `auto-seen` is what stops a retry of this sha; `auto-failed` only records which commit failed (diagnostics).
  printf '%s\n' "$tip" > "$STATE_DIR/auto-failed"
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  notify "❌ SlaydX avto-deploy muvaffaqiyatsiz: $short (kod $rc). Oldingi versiya tiklandi yoki deploy rad etildi — log: /root/slaydx-backups/deploy-*-$short.log. Bu commit qayta urinilmaydi; yangi commit yoki qo'lda: slaydx-deploy $short"
fi
