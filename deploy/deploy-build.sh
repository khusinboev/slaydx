#!/usr/bin/env bash
# slaydx-deploy-build — FALLBACK deploy that builds the images ON THE SERVER (the pre-ops
# `deploy.sh` behaviour). Use it only when GHCR or GitHub Actions is unavailable: it loads the
# shared box for ~8–10 min (docs/ops/O1-deploy-pipeline.md §0). Normal path: slaydx-deploy <sha>.
#
# Usage:   slaydx-deploy-build [<sha>]      (default: origin/main; the commit must be on origin/main)
#
# Builds with SLAYDX_TAG=local (`ghcr.io/khusinboev/slaydx-{web,worker}:local`, never pushed),
# records ROLLBACK.txt and local `:rollback` tags like the pull deploy, runs `up -d` and polls
# /api/health. No automatic rollback (as before); on failure it prints the rollback command.
# Shares the lock with slaydx-deploy, so the two never run at the same time.
set -Eeuo pipefail
umask 077

PROJECT=slaydx
REG=ghcr.io/khusinboev
APP_DIR=${SLAYDX_APP_DIR:-/opt/slaydx}
STATE_DIR=${SLAYDX_STATE_DIR:-/var/lib/slaydx-deploy}
BACKUP_DIR=${SLAYDX_BACKUP_DIR:-/root/slaydx-backups}
BACKUP_CMD=${SLAYDX_BACKUP_CMD:-/usr/local/bin/slaydx-backup}
LOCK_FILE=${SLAYDX_LOCK_FILE:-/run/lock/slaydx-deploy.lock}
HEALTH_URL=${SLAYDX_HEALTH_URL:-http://127.0.0.1:3000/api/health}
HEALTH_TRIES=${SLAYDX_HEALTH_TRIES:-40}
HEALTH_INTERVAL=${SLAYDX_HEALTH_INTERVAL:-3}

T0=$(date +%s)
log() { printf '%s [+%ss] %s\n' "$(date +%T)" "$(( $(date +%s) - T0 ))" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
usage() { echo "usage: slaydx-deploy-build [<sha>]   (default origin/main)" >&2; exit 2; }
dc() { docker compose -p "$PROJECT" "$@"; }

main() {
  [ "$#" -le 1 ] || usage
  local arg=${1:-origin/main}
  case "$arg" in -h|--help) usage ;; esac
  if [ "$arg" != origin/main ]; then
    arg=${arg,,}
    [[ "$arg" =~ ^[0-9a-f]{7,40}$ ]] || { echo "not a commit sha: $1" >&2; usage; }
  fi

  mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "another deploy is running (lock $LOCK_FILE)"

  cd "$APP_DIR"
  [ -f .env ] || die "$APP_DIR/.env is missing"
  git fetch --quiet origin main || die "git fetch failed"
  local sha
  sha=$(git rev-parse --verify --quiet "${arg}^{commit}") || die "commit not found: $arg"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "unexpected rev-parse result: $sha"
  git merge-base --is-ancestor "$sha" origin/main || die "$sha is not on origin/main — refusing"

  local prev_head prev_sha prev_tag
  prev_head=$(git rev-parse HEAD)
  prev_sha=$( [ -f "$STATE_DIR/current.env" ] && sed -n 's/^sha=//p' "$STATE_DIR/current.env" | head -n 1 || true)
  prev_sha=${prev_sha:-$prev_head}
  prev_tag=$( [ -f "$STATE_DIR/current.env" ] && sed -n 's/^tag=//p' "$STATE_DIR/current.env" | head -n 1 || true)
  prev_tag=${prev_tag:-local}
  log "build deploy ${sha:0:7} (previous ${prev_sha:0:7}, tag $prev_tag)"

  "$BACKUP_CMD" || die "backup failed ($BACKUP_CMD) — nothing changed"

  local web_id="" worker_id="" cid
  cid=$(dc ps -q web | head -n 1)
  [ -z "$cid" ] || web_id=$(docker inspect -f '{{.Image}}' "$cid")
  cid=$(dc ps -q worker | head -n 1)
  [ -z "$cid" ] || worker_id=$(docker inspect -f '{{.Image}}' "$cid")
  if [ -n "$web_id" ] && [ -n "$worker_id" ]; then
    docker tag "$web_id" "$REG/slaydx-web:rollback"
    docker tag "$worker_id" "$REG/slaydx-worker:rollback"
  fi
  printf '%s\ntag=%s\nweb_image=%s\nworker_image=%s\nat=%s\nreplaced_by=%s\n' \
    "$prev_sha" "$prev_tag" "$web_id" "$worker_id" "$(date -Is)" "$sha" > "$BACKUP_DIR/ROLLBACK.txt"

  git reset --quiet --hard "$sha"
  export SLAYDX_TAG=local
  dc build || die "build failed — still serving the previous containers; checkout is at ${sha:0:7}, reset with: git -C $APP_DIR reset --hard $prev_head"
  dc up -d

  local i
  for (( i = 1; i <= HEALTH_TRIES; i++ )); do
    if curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
      # Persist the tag only when healthy, so manual compose commands keep running `:local`.
      if grep -q '^SLAYDX_TAG=' .env; then
        sed -i 's/^SLAYDX_TAG=.*/SLAYDX_TAG=local/' .env
      else
        printf '\n# Managed by slaydx-deploy / deploy-build.sh: image tag compose runs.\nSLAYDX_TAG=local\n' >> .env
      fi
      printf '%s\n' "$sha" > "$STATE_DIR/current"
      printf 'sha=%s\ntag=local\nmode=build\nat=%s\n' "$sha" "$(date -Is)" > "$STATE_DIR/current.env"
      printf '%s %s ok-build %ss prev=%s\n' "$(date -Is)" "$sha" "$(( $(date +%s) - T0 ))" "$prev_sha" >> "$STATE_DIR/history.log"
      log "deployed ${sha:0:7} (built on the server) in $(( $(date +%s) - T0 ))s"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  printf '%s %s FAILED-build prev=%s\n' "$(date -Is)" "$sha" "$prev_sha" >> "$STATE_DIR/history.log"
  log "health check failed. Roll back by hand:"
  log "  cd $APP_DIR && git reset --hard $prev_head && SLAYDX_TAG=rollback docker compose -p slaydx up -d --no-build"
  exit 1
}

main "$@"
