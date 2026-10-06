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
LOCK_FILE=${SLAYDX_AUTO_LOCK:-/run/lock/slaydx-auto-deploy.lock}
DEPLOY_LOCK=${SLAYDX_LOCK_FILE:-/run/lock/slaydx-deploy.lock}
DISABLE_FILE=${SLAYDX_AUTO_DISABLE:-/etc/slaydx/auto-deploy.disabled}
REGISTRY=${SLAYDX_REGISTRY:-ghcr.io/khusinboev}
MAX_PER_HOUR=${SLAYDX_AUTO_MAX_PER_HOUR:-6}
export DOCKER_CONFIG=${SLAYDX_DOCKER_CONFIG:-/etc/slaydx/docker}
# Changes that never need a deploy: every changed path must match.
SKIP_RE='^(docs/|tests/|loadtests/|\.github/|\.claude/|deploy/|[^/]+\.md$|LICENSE$)'

log() { printf '%s auto-deploy: %s\n' "$(date -Is)" "$*"; }

if [ -f "$ENV_FILE" ]; then
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
# A manual/other deploy in progress: leave it alone.
exec 7>"$DEPLOY_LOCK"
flock -n 7 || exit 0
exec 7>&-

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
  docker manifest inspect "$REGISTRY/$img:$tip" >/dev/null 2>&1 || { log "$short: $img image not promoted yet"; exit 0; }
done

mapfile -t files < <(git diff --name-only "$cur" "$tip")
if [ "${#files[@]}" -gt 0 ] && ! printf '%s\n' "${files[@]}" | grep -qvE "$SKIP_RE"; then
  # Docs/tests/CI only: no restart. Keep the checkout current (cron scripts live in it).
  git reset -q --hard "$tip"
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  log "$short: only docs/tests/CI/deploy files changed — no deploy (checkout updated)"
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
if "$DEPLOY_CMD" "$tip"; then
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  notify "✅ SlaydX yangilandi: $short ($(( $(date +%s) - t0 )) soniya)"
else
  rc=$?
  # `auto-seen` is what stops a retry of this sha; `auto-failed` only records which commit failed (diagnostics).
  printf '%s\n' "$tip" > "$STATE_DIR/auto-failed"
  printf '%s\n' "$tip" > "$STATE_DIR/auto-seen"
  notify "❌ SlaydX avto-deploy muvaffaqiyatsiz: $short (kod $rc). Oldingi versiya tiklandi yoki deploy rad etildi — log: /root/slaydx-backups/deploy-*-$short.log. Bu commit qayta urinilmaydi; yangi commit yoki qo'lda: slaydx-deploy $short"
fi
