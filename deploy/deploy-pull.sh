#!/usr/bin/env bash
# slaydx-deploy — pull deploy (docs/ops/PLAN.md §3, docs/ops/O1-deploy-pipeline.md §3.6).
#
# Images are built by GitHub Actions and promoted to `ghcr.io/khusinboev/slaydx-{web,worker}:<sha>`
# only after CI is green. This script never builds; it pulls the promoted images of one commit
# that is on origin/main, pre-runs the migrations with the NEW image while the OLD containers
# still serve, swaps the containers and waits for health. If the new version is not healthy it
# rolls back to the images that were running before, automatically, and exits non-zero.
#
# Install (lead/owner, once and after every change — never run it from the checkout, `git reset`
# rewrites the checkout while the deploy runs):   deploy/install-deploy.sh
# Usage:   slaydx-deploy <sha>            (40-hex or an unambiguous 7+ hex prefix)
#
# Order: validate → lock → fetch + ancestry → registry tag exists → disk → backup →
#        ROLLBACK.txt (+ local `:rollback` tags) → pull → checkout → migrate → up → health →
#        state file. A failure before `up` leaves the running containers untouched.
#
# Shared box rules (.claude/deploy.md): every compose call uses `-p slaydx`; nothing here prunes,
# stops or inspects containers of other projects. Registry credentials live only in
# DOCKER_CONFIG=/etc/slaydx/docker (root 700), so other projects' docker commands never see them.
set -Eeuo pipefail
umask 077

PROJECT=slaydx
# Must match `image:` in docker-compose.yml.
REG=ghcr.io/khusinboev
APP_DIR=${SLAYDX_APP_DIR:-/opt/slaydx}
STATE_DIR=${SLAYDX_STATE_DIR:-/var/lib/slaydx-deploy}
BACKUP_DIR=${SLAYDX_BACKUP_DIR:-/root/slaydx-backups}
BACKUP_CMD=${SLAYDX_BACKUP_CMD:-/usr/local/bin/slaydx-backup}
LOCK_FILE=${SLAYDX_LOCK_FILE:-/run/lock/slaydx-deploy.lock}
HEALTH_URL=${SLAYDX_HEALTH_URL:-http://127.0.0.1:3000/api/health}
HEALTH_TRIES=${SLAYDX_HEALTH_TRIES:-48}
HEALTH_INTERVAL=${SLAYDX_HEALTH_INTERVAL:-5}
MIN_FREE_GB=${SLAYDX_MIN_FREE_GB:-5}
export DOCKER_CONFIG=${SLAYDX_DOCKER_CONFIG:-/etc/slaydx/docker}

T0=$(date +%s)
STEP_T=$T0
TIMINGS=""
PHASE=pre          # pre → checkout → swapped → finished (drives the EXIT trap)
SHA=""
PREV_SHA=""
PREV_HEAD=""
PREV_TAG=""
HAVE_ROLLBACK=0

log() { printf '%s [+%ss] %s\n' "$(date +%T)" "$(( $(date +%s) - T0 ))" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
usage() { echo "usage: slaydx-deploy <sha>   (commit on origin/main whose images CI promoted)" >&2; exit 2; }
dc() { docker compose -p "$PROJECT" "$@"; }
step() {  # close the previous step's timer under name $1
  local now; now=$(date +%s)
  TIMINGS="$TIMINGS $1=$(( now - STEP_T ))s"
  STEP_T=$now
}

state_get() {  # $1=key → value from $STATE_DIR/current.env (empty if missing)
  [ -f "$STATE_DIR/current.env" ] || return 0
  sed -n "s/^$1=//p" "$STATE_DIR/current.env" | head -n 1
}

# `.env` is the compose interpolation file, so a manual `docker compose -p slaydx up -d` or
# restart keeps the deployed tag. Only the SLAYDX_TAG line is touched; `sed -i` keeps mode/owner.
# The value is validated (hex sha / `local`) before it gets here, so it is safe in the regex.
set_env_tag() {
  local env_file="$APP_DIR/.env"
  if grep -q '^SLAYDX_TAG=' "$env_file"; then
    sed -i "s/^SLAYDX_TAG=.*/SLAYDX_TAG=$1/" "$env_file"
  else
    printf '\n# Managed by slaydx-deploy / deploy-build.sh: image tag compose runs.\nSLAYDX_TAG=%s\n' "$1" >> "$env_file"
  fi
}

# 0 = healthy; 1 = not yet; 2 = a container crashed (fail fast instead of waiting).
# $1 = expected image tag, or empty to skip the image check (rollback to a build-mode version,
# whose compose file has no `image:` key).
health_once() {
  local want_tag=$1 svc img state health web=0 worker=0
  local out
  out=$(dc ps -a --format '{{.Service}}|{{.Image}}|{{.State}}|{{.Health}}' web worker) || return 1
  while IFS='|' read -r svc img state health; do
    [ -n "$svc" ] || continue
    case "$state" in restarting|exited|dead) return 2 ;; esac
    [ "$state" = running ] || return 1
    [ "$health" = healthy ] || return 1
    if [ -n "$want_tag" ] && [ "$img" != "$REG/slaydx-$svc:$want_tag" ]; then return 1; fi
    case "$svc" in web) web=$((web + 1)) ;; worker) worker=$((worker + 1)) ;; esac
  done <<< "$out"
  [ "$web" -ge 1 ] && [ "$worker" -ge 1 ] || return 1
  curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'
}

wait_healthy() {
  local i rc
  for (( i = 1; i <= HEALTH_TRIES; i++ )); do
    rc=0; health_once "$1" || rc=$?
    [ "$rc" -eq 0 ] && return 0
    [ "$rc" -eq 2 ] && { log "a container is restarting/exited"; return 1; }
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

rollback() {
  set +e
  log "ROLLBACK: new version ${SHA:0:7} failed — restoring ${PREV_SHA:0:7} (tag ${PREV_TAG})"
  dc logs --tail=60 web worker
  git reset --quiet --hard "$PREV_HEAD"
  if [ "$HAVE_ROLLBACK" = 1 ]; then
    if SLAYDX_TAG=rollback dc up -d --no-build && SLAYDX_TAG=rollback wait_healthy ""; then
      log "rolled back: previous images are serving again"
    else
      log "!!! previous version is NOT healthy either — check by hand (ROLLBACK.txt: $BACKUP_DIR/ROLLBACK.txt)"
    fi
  else
    log "!!! no previous containers were recorded — nothing to roll back to; check by hand"
  fi
  printf '%s %s FAILED rolled_back_to=%s\n' "$(date -Is)" "$SHA" "$PREV_SHA" >> "$STATE_DIR/history.log"
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then
    case "$PHASE" in
      checkout)
        git reset --quiet --hard "$PREV_HEAD" || true
        log "aborted before the swap — the running version was not touched" ;;
      swapped) rollback ;;
    esac
  fi
  exit "$rc"
}

main() {
  [ "$#" -eq 1 ] || usage
  case "$1" in -h|--help) usage ;; esac
  local arg=${1,,}
  [[ "$arg" =~ ^[0-9a-f]{7,40}$ ]] || { echo "not a commit sha: $1" >&2; usage; }

  mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "another deploy is running (lock $LOCK_FILE)"
  trap on_exit EXIT

  cd "$APP_DIR"
  [ -f .env ] || die "$APP_DIR/.env is missing"
  docker compose version >/dev/null 2>&1 \
    || die "'docker compose' not found with DOCKER_CONFIG=$DOCKER_CONFIG (see deploy/install-deploy.sh)"

  # 1) The commit: must resolve, be a full sha and be on origin/main.
  git fetch --quiet origin main || die "git fetch failed"
  SHA=$(git rev-parse --verify --quiet "${arg}^{commit}") || die "commit not found: $arg"
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "unexpected rev-parse result: $SHA"
  git merge-base --is-ancestor "$SHA" origin/main || die "$SHA is not on origin/main — refusing"

  # 2) The promoted tag must exist for BOTH images (only CI's promote job, after tests pass,
  #    creates `:<sha>`; `build-<sha>` alone is not deployable).
  local s
  for s in web worker; do
    docker manifest inspect "$REG/slaydx-$s:$SHA" >/dev/null 2>&1 \
      || die "$REG/slaydx-$s:$SHA not in the registry — did CI promote it? (or the registry token expired)"
  done

  local free_gb
  free_gb=$(df --output=avail -BG "$APP_DIR" | tail -n 1 | tr -dc 0-9)
  [ "${free_gb:-0}" -ge "$MIN_FREE_GB" ] || die "only ${free_gb:-0} GB free (< $MIN_FREE_GB GB)"

  PREV_HEAD=$(git rev-parse HEAD)
  PREV_SHA=$(state_get sha); PREV_SHA=${PREV_SHA:-$PREV_HEAD}
  PREV_TAG=$(state_get tag); PREV_TAG=${PREV_TAG:-local}
  log "deploy ${SHA:0:7} (previous ${PREV_SHA:0:7}, tag $PREV_TAG)"
  step validate

  # 3) Backup first (daily cron's script; it verifies the dump). A failed backup stops the deploy.
  "$BACKUP_CMD" || die "backup failed ($BACKUP_CMD) — nothing changed"
  log "backup done"
  step backup

  # 4) Rollback point: tag the images that are running now as local `:rollback` (never pushed),
  #    so the automatic rollback restores exactly them whatever the previous mode was.
  local web_id="" worker_id="" cid
  cid=$(dc ps -q web | head -n 1)
  [ -z "$cid" ] || web_id=$(docker inspect -f '{{.Image}}' "$cid")
  cid=$(dc ps -q worker | head -n 1)
  [ -z "$cid" ] || worker_id=$(docker inspect -f '{{.Image}}' "$cid")
  if [ -n "$web_id" ] && [ -n "$worker_id" ]; then
    docker tag "$web_id" "$REG/slaydx-web:rollback"
    docker tag "$worker_id" "$REG/slaydx-worker:rollback"
    HAVE_ROLLBACK=1
  else
    log "WARNING: web/worker are not running — no automatic rollback possible"
  fi
  # Line 1 = previous sha (the manual procedure in .claude/deploy.md reads it).
  printf '%s\ntag=%s\nweb_image=%s\nworker_image=%s\nat=%s\nreplaced_by=%s\n' \
    "$PREV_SHA" "$PREV_TAG" "$web_id" "$worker_id" "$(date -Is)" "$SHA" > "$BACKUP_DIR/ROLLBACK.txt"
  step rollback-point

  # 5) Pull while the old containers keep serving.
  export SLAYDX_TAG=$SHA
  dc pull web worker || die "pull failed"
  for s in web worker; do
    docker image inspect "$REG/slaydx-$s:$SHA" >/dev/null 2>&1 || die "$REG/slaydx-$s:$SHA missing after pull"
  done
  log "images pulled"
  step pull

  # 6) Compose file of the same commit as the images (env list, flags), then migrations with
  #    the NEW image while the OLD containers still serve: a failing migration costs no downtime.
  #    Migrations are additive by rule (expand/contract); boot-time ensureMigrated stays as a
  #    safety net and is a no-op after this.
  PHASE=checkout
  git reset --quiet --hard "$SHA"
  dc config -q || die "compose config invalid at $SHA"
  dc run --rm --no-deps -T worker ./node_modules/.bin/tsx --conditions=react-server scripts/migrate.ts \
    || die "migration failed — old version keeps serving"
  log "migrations done"
  step migrate

  # 7) Swap. From here on any failure rolls back (EXIT trap).
  PHASE=swapped
  dc up -d --no-build || die "compose up failed"
  log "containers recreated, waiting for health"
  step up
  wait_healthy "$SHA" || die "health check failed (web /api/health + Docker health of web and worker)"
  step health

  # 8) Record.
  PHASE=finished
  set_env_tag "$SHA"
  printf '%s\n' "$SHA" > "$STATE_DIR/current"
  printf 'sha=%s\ntag=%s\nmode=pull\nat=%s\n' "$SHA" "$SHA" "$(date -Is)" > "$STATE_DIR/current.env"
  printf '%s %s ok %ss prev=%s\n' "$(date -Is)" "$SHA" "$(( $(date +%s) - T0 ))" "$PREV_SHA" >> "$STATE_DIR/history.log"
  log "deployed ${SHA:0:7} in $(( $(date +%s) - T0 ))s —$TIMINGS"
}

main "$@"
