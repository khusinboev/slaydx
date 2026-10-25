#!/usr/bin/env bash
# Removes old SlaydX images from the server so every deploy's new pair (web ~2.1 GB, worker ~0.7 GB) does not pile up
# forever. Installed as /usr/local/bin/slaydx-image-prune by deploy/install-ops.sh; runs from cron once a day.
#
# Keeps:  the deployed sha (state `current`), the local `:rollback` tags, the last $SLAYDX_IMAGE_KEEP distinct shas
#         that deployed OK (history.log), and every image a container (running or stopped) still refers to.
# Removes: every other ghcr.io/khusinboev/slaydx-{web,worker}:<tag>, with plain `docker rmi` (never -f), so an image
#          that is somehow still in use is refused by Docker instead of removed. Other projects' images are never touched.
# Skips the whole run while a deploy holds the deploy lock. Always exits 0 (it is housekeeping, not a deploy step).
#   slaydx-image-prune            remove
#   slaydx-image-prune --dry-run  only print what would be removed
set -uo pipefail

REG=ghcr.io/khusinboev
STATE_DIR=${SLAYDX_STATE_DIR:-/var/lib/slaydx-deploy}
LOCK_FILE=${SLAYDX_LOCK_FILE:-/run/lock/slaydx-deploy.lock}
KEEP=${SLAYDX_IMAGE_KEEP:-3}
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { printf '%s image-prune: %s\n' "$(date -Is)" "$*"; }

[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { log "SLAYDX_IMAGE_KEEP must be a positive integer — nothing done"; exit 0; }

exec 9>"$LOCK_FILE" 2>/dev/null || { log "cannot open the deploy lock $LOCK_FILE — nothing done"; exit 0; }
flock -n 9 || { log "a deploy is running — skipped"; exit 0; }

declare -A keep=()
keep[rollback]=1
current=$(tr -d '[:space:]' < "$STATE_DIR/current" 2>/dev/null || true)
[ -n "$current" ] && keep[$current]=1
if [ -f "$STATE_DIR/history.log" ]; then
  # Lines: "<date> <sha> ok <n>s prev=<sha>"; newest last.
  while read -r sha; do keep[$sha]=1; done < <(awk '$3 == "ok" { print $2 }' "$STATE_DIR/history.log" | tac | awk '!seen[$0]++' | head -n "$KEEP")
fi

declare -A used=()
while read -r img; do [ -n "$img" ] && used[$img]=1; done < <(docker ps -a --format '{{.Image}}' 2>/dev/null)

removed=0
refused=0
before=$(df -B1 --output=avail / 2>/dev/null | tail -n 1 | tr -d ' ')
while read -r ref; do
  [ -n "$ref" ] || continue
  tag=${ref##*:}
  [ "$tag" = "<none>" ] && continue
  if [ -n "${keep[$tag]:-}" ] || [ -n "${used[$ref]:-}" ]; then continue; fi
  if [ "$DRY_RUN" = 1 ]; then
    log "would remove $ref"
    removed=$((removed + 1))
  elif docker rmi "$ref" >/dev/null 2>&1; then
    removed=$((removed + 1))
  else
    refused=$((refused + 1))
  fi
done < <(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E "^$REG/slaydx-(web|worker):" | sort -u)

after=$(df -B1 --output=avail / 2>/dev/null | tail -n 1 | tr -d ' ')
freed=$(( (${after:-0} - ${before:-0}) / 1024 / 1024 ))
if [ "$DRY_RUN" = 1 ]; then
  log "dry run: $removed tag(s) would be removed; kept: ${!keep[*]}"
else
  log "removed $removed tag(s), refused $refused, freed ~${freed} MB; kept: ${!keep[*]}"
fi
exit 0
