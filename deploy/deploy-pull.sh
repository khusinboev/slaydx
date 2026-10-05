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
# Usage:   slaydx-deploy <sha> [--allow-destructive]   (40-hex or an unambiguous 7+ hex prefix)
#
# The deploy itself runs DETACHED (`setsid nohup`, stdin /dev/null, output to
# $LOG_DIR/deploy-<run>-<sha7>.log): a dropped SSH session can no longer kill it between the swap and
# the automatic rollback (security review D1). The command you typed only follows the log file and
# exits with the deploy's exit code; if it dies, the deploy goes on — `tail -f` the log, the result
# is in $STATE_DIR/last-run.env and history.log.
#
# Order: validate → lock → fetch + ancestry → registry tag exists → destructive-migration guard →
#        disk → backup → ROLLBACK.txt (+ local `:rollback` tags) → checkout → pull (+ revision
#        label) → stale one-off cleanup → migrate → up web worker → health → state file.
#        A failure before `up` leaves the running containers untouched.
#
# Shared box rules (.claude/deploy.md): every compose call uses `-p slaydx`; nothing here prunes,
# stops or inspects containers of other projects. Registry credentials live only in
# DOCKER_CONFIG=/etc/slaydx/docker (root 700), so other projects' docker commands never see them.
# The lock ($SLAYDX_LOCK_FILE, default /run/lock/slaydx-deploy.lock) is held for the whole deploy:
# other automation (watchdog auto-restart) must skip while `flock -n` on it fails.
set -Eeuo pipefail
umask 077
# A lost terminal must not kill the deploy: writes to a closed pipe fail (EPIPE) instead of
# killing bash, and the hang-up is ignored. `log` never fails the script on a write error.
trap '' PIPE HUP

PROJECT=slaydx
# Must match `image:` in docker-compose.yml.
REG=ghcr.io/khusinboev
APP_DIR=${SLAYDX_APP_DIR:-/opt/slaydx}
STATE_DIR=${SLAYDX_STATE_DIR:-/var/lib/slaydx-deploy}
BACKUP_DIR=${SLAYDX_BACKUP_DIR:-/root/slaydx-backups}
LOG_DIR=${SLAYDX_LOG_DIR:-$BACKUP_DIR}
BACKUP_CMD=${SLAYDX_BACKUP_CMD:-/usr/local/bin/slaydx-backup}
LOCK_FILE=${SLAYDX_LOCK_FILE:-/run/lock/slaydx-deploy.lock}
HEALTH_URL=${SLAYDX_HEALTH_URL:-http://127.0.0.1:3000/api/health}
HEALTH_TRIES=${SLAYDX_HEALTH_TRIES:-48}
HEALTH_INTERVAL=${SLAYDX_HEALTH_INTERVAL:-5}
FOLLOW_INTERVAL=${SLAYDX_FOLLOW_INTERVAL:-1}
START_TIMEOUT=${SLAYDX_START_TIMEOUT:-60}
MIN_FREE_GB=${SLAYDX_MIN_FREE_GB:-5}
export DOCKER_CONFIG=${SLAYDX_DOCKER_CONFIG:-/etc/slaydx/docker}
# Added migration lines matching this (SQL comments stripped) need --allow-destructive: after a
# failed health check the OLD code runs on the NEW schema, so migrations must stay additive.
DESTRUCTIVE_RE='(^|[^A-Z_])(DROP|RENAME|TRUNCATE)([^A-Z_]|$)|SET NOT NULL|ALTER COLUMN .* TYPE'

T0=$(date +%s)
STEP_T=$T0
TIMINGS=""
PHASE=pre          # pre → checkout → swapped → finished (drives the EXIT trap)
SHA=""
PREV_SHA=""
PREV_HEAD=""
PREV_TAG=""
HAVE_ROLLBACK=0
HAVE_LOCK=0
ARG=""
ALLOW_DESTRUCTIVE=0
RUN_ID=${SLAYDX_RUN_ID:-}

log() { printf '%s [+%ss] %s\n' "$(date +%T)" "$(( $(date +%s) - T0 ))" "$*" 2>/dev/null || true; }
die() { log "ERROR: $*"; exit 1; }
usage() { echo "usage: slaydx-deploy <sha> [--allow-destructive]   (commit on origin/main whose images CI promoted)" >&2; exit 2; }
dc() { docker compose -p "$PROJECT" "$@"; }
step() {  # close the previous step's timer under name $1
  local now; now=$(date +%s)
  TIMINGS="$TIMINGS $1=$(( now - STEP_T ))s"
  STEP_T=$now
}

parse_args() {
  local a
  for a in "$@"; do
    case "$a" in
      -h|--help) usage ;;
      --allow-destructive) ALLOW_DESTRUCTIVE=1 ;;
      *) [ -z "$ARG" ] || usage; ARG=${a,,} ;;
    esac
  done
  [ -n "$ARG" ] || usage
  [[ "$ARG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "not a commit sha: $ARG" >&2; usage; }
}

state_get() {  # $1=key → value from $STATE_DIR/current.env (empty if missing)
  [ -f "$STATE_DIR/current.env" ] || return 0
  sed -n "/^$1=/{s/^$1=//p;q}" "$STATE_DIR/current.env"
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
# whose compose file has no `image:` key). One-off `compose run` containers (`slaydx-<svc>-run-*`,
# e.g. an interrupted migration or a manual admin script) are not part of the service: ignored
# (security review D2 — an exited one-off used to fail every deploy and its rollback).
health_once() {
  local want_tag=$1 name svc img state health web=0 worker=0
  local out
  out=$(dc ps -a --format '{{.Name}}|{{.Service}}|{{.Image}}|{{.State}}|{{.Health}}' web worker) || return 1
  while IFS='|' read -r name svc img state health; do
    [ -n "$svc" ] || continue
    case "$name" in *-run-*) continue ;; esac
    case "$state" in restarting|exited|dead) return 2 ;; esac
    [ "$state" = running ] || return 1
    [ "$health" = healthy ] || return 1
    if [ -n "$want_tag" ] && [ "$img" != "$REG/slaydx-$svc:$want_tag" ]; then return 1; fi
    case "$svc" in web) web=$((web + 1)) ;; worker) worker=$((worker + 1)) ;; esac
  done <<< "$out"
  [ "$web" -ge 1 ] && [ "$worker" -ge 1 ] || return 1
  # No `curl | grep -q`: grep exiting early can SIGPIPE curl, and pipefail turns that into a failure.
  local body
  body=$(curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null) || return 1
  [[ "$body" == *'"status":"ok"'* ]]
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
    if SLAYDX_TAG=rollback dc up -d --no-build --no-deps web worker && SLAYDX_TAG=rollback wait_healthy ""; then
      log "rolled back: previous images are serving again"
      log "note: .env keeps SLAYDX_TAG=$PREV_TAG (same images as :rollback); run 'slaydx-deploy ${PREV_SHA:0:7}' or fix forward"
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
  # The exit code is recorded for whoever follows the run (and for later inspection).
  if [ -n "$RUN_ID" ]; then
    printf 'rc=%s\n' "$rc" > "$STATE_DIR/runs/$RUN_ID" 2>/dev/null || true
  fi
  if [ -n "$RUN_ID" ] && [ "$HAVE_LOCK" = 1 ]; then
    printf 'run=%s\nsha=%s\nrc=%s\nlog=%s\nat=%s\n' "$RUN_ID" "${SHA:-$ARG}" "$rc" "${SLAYDX_RUN_LOG:-}" "$(date -Is)" \
      > "$STATE_DIR/last-run.env" 2>/dev/null || true
  fi
  exit "$rc"
}

# Destructive statements among the ADDED lines of migration files between the running checkout
# and the target commit (comments stripped).
destructive_migrations() {
  local diff
  diff=$(git diff "$PREV_HEAD" "$SHA" -- lib/server/migrations) || return 2
  printf '%s\n' "$diff" | sed -n 's/^+\([^+]\)/\1/p' | sed 's/--.*$//' | tr '[:lower:]' '[:upper:]' \
    | grep -E "$DESTRUCTIVE_RE" || true
}

# The detached deploy.
run_deploy() {
  if [ -n "$RUN_ID" ]; then mkdir -p "$STATE_DIR/runs"; fi
  trap on_exit EXIT
  mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "another deploy is running (lock $LOCK_FILE)"
  HAVE_LOCK=1
  if [ -n "$RUN_ID" ]; then printf 'running\n' > "$STATE_DIR/runs/$RUN_ID"; fi

  cd "$APP_DIR"
  [ -f .env ] || die "$APP_DIR/.env is missing"
  docker compose version >/dev/null 2>&1 \
    || die "'docker compose' not found with DOCKER_CONFIG=$DOCKER_CONFIG (see deploy/install-deploy.sh)"

  # 1) The commit: must resolve, be a full sha and be on origin/main.
  git fetch --quiet origin main || die "git fetch failed"
  SHA=$(git rev-parse --verify --quiet "${ARG}^{commit}") || die "commit not found: $ARG"
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "unexpected rev-parse result: $SHA"
  git merge-base --is-ancestor "$SHA" origin/main || die "$SHA is not on origin/main — refusing"

  # 2) The promoted tag must exist for BOTH images (only CI's promote job, after tests pass,
  #    creates `:<sha>`; `build-<sha>` alone is not deployable).
  local s
  for s in web worker; do
    docker manifest inspect "$REG/slaydx-$s:$SHA" >/dev/null 2>&1 \
      || die "$REG/slaydx-$s:$SHA not in the registry — did CI promote it? (or the registry token expired)"
  done

  PREV_HEAD=$(git rev-parse HEAD)
  PREV_SHA=$(state_get sha); PREV_SHA=${PREV_SHA:-$PREV_HEAD}
  PREV_TAG=$(state_get tag); PREV_TAG=${PREV_TAG:-local}

  # 3) Additive-migrations rule (expand/contract), enforced.
  local bad rc=0
  bad=$(destructive_migrations) || rc=$?
  [ "$rc" -eq 0 ] || die "git diff of lib/server/migrations failed"
  if [ -n "$bad" ]; then
    log "destructive migration statements between ${PREV_HEAD:0:7} and ${SHA:0:7}:"
    printf '%s\n' "$bad" | while IFS= read -r l; do log "  $l"; done
    [ "$ALLOW_DESTRUCTIVE" = 1 ] || die "refusing: an automatic rollback would run the old code on this schema (re-run with --allow-destructive after review)"
    log "--allow-destructive given: continuing"
  fi

  local free_gb
  free_gb=$(df --output=avail -BG "$APP_DIR" | tail -n 1 | tr -dc 0-9)
  [ "${free_gb:-0}" -ge "$MIN_FREE_GB" ] || die "only ${free_gb:-0} GB free (< $MIN_FREE_GB GB)"
  log "deploy ${SHA:0:7} (previous ${PREV_SHA:0:7}, tag $PREV_TAG)"
  step validate

  # 4) Backup first (daily cron's script; it verifies the dump). A failed backup stops the deploy.
  "$BACKUP_CMD" || die "backup failed ($BACKUP_CMD) — nothing changed"
  log "backup done"
  step backup

  # 5) Rollback point: tag the images that are running now as local `:rollback` (never pushed),
  #    so the automatic rollback restores exactly them whatever the previous mode was.
  # First id only, without `| head` (SIGPIPE under pipefail with 2 worker replicas).
  local web_id="" worker_id="" cid
  cid=$(dc ps -q web); cid=${cid%%$'\n'*}
  [ -z "$cid" ] || web_id=$(docker inspect -f '{{.Image}}' "$cid")
  cid=$(dc ps -q worker); cid=${cid%%$'\n'*}
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

  # 6) Compose file of the same commit as the images (image refs, env list, flags) — before the
  #    pull, because a pre-ops compose file has no `image:` key to pull. Containers do not read
  #    the checkout, so the old ones keep serving; any failure until `up` restores it (EXIT trap).
  PHASE=checkout
  export SLAYDX_TAG=$SHA
  git reset --quiet --hard "$SHA"
  dc config -q || die "compose config invalid at $SHA"

  # 7) Pull while the old containers keep serving. The OCI revision label must name this commit
  #    (tags are mutable for anyone with packages:write); a missing label is only a warning.
  dc pull web worker || die "pull failed"
  local rev
  for s in web worker; do
    docker image inspect "$REG/slaydx-$s:$SHA" >/dev/null 2>&1 || die "$REG/slaydx-$s:$SHA missing after pull"
    rev=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$REG/slaydx-$s:$SHA" 2>/dev/null || true)
    case "$rev" in
      "$SHA") ;;
      ""|"<no value>") log "WARNING: $REG/slaydx-$s:$SHA has no revision label" ;;
      *) die "$REG/slaydx-$s:$SHA is labelled revision=$rev, expected $SHA — refusing" ;;
    esac
  done
  log "images pulled"
  step pull

  # 8) Migrations with the NEW image while the OLD containers still serve: a failing migration
  #    costs no downtime. Exited one-off containers of this project (an interrupted earlier
  #    `compose run`) are removed first; running ones (someone's admin script) are left alone.
  local stale
  stale=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" \
    --filter label=com.docker.compose.oneoff=True --filter status=exited)
  if [ -n "$stale" ]; then
    log "removing exited one-off containers: $(printf '%s' "$stale" | tr '\n' ' ')"
    # shellcheck disable=SC2086  # ids are hex, one per line
    docker rm $stale >/dev/null || log "WARNING: could not remove some one-off containers"
  fi
  dc run --rm --no-deps -T worker ./node_modules/.bin/tsx --conditions=react-server scripts/migrate.ts \
    || die "migration failed — old version keeps serving"
  log "migrations done"
  step migrate

  # 9) Swap web + worker only (`--no-deps`): postgres is NOT recreated by a deploy. A changed
  #    postgres `command:` is applied as its own step: `docker compose -p slaydx up -d postgres`.
  #    From here on any failure rolls back (EXIT trap).
  PHASE=swapped
  dc up -d --no-build --no-deps web worker || die "compose up failed"
  log "containers recreated, waiting for health"
  step up
  wait_healthy "$SHA" || die "health check failed (web /api/health + Docker health of web and worker)"
  step health

  # 10) Record.
  PHASE=finished
  set_env_tag "$SHA"
  printf '%s\n' "$SHA" > "$STATE_DIR/current"
  printf 'sha=%s\ntag=%s\nmode=pull\nat=%s\n' "$SHA" "$SHA" "$(date -Is)" > "$STATE_DIR/current.env"
  printf '%s %s ok %ss prev=%s\n' "$(date -Is)" "$SHA" "$(( $(date +%s) - T0 ))" "$PREV_SHA" >> "$STATE_DIR/history.log"
  log "deployed ${SHA:0:7} in $(( $(date +%s) - T0 ))s —$TIMINGS"
}

# Print the bytes of $1 between offset $2 and its current size; echo the new offset.
# `head -c` reads the file (never a pipe writer that can be cut short), `tail -c +N` reads all.
follow_chunk() {
  local size
  size=$(stat -c %s "$1" 2>/dev/null || echo "$2")
  if [ "$size" -gt "$2" ]; then
    head -c "$size" "$1" | tail -c +"$(( $2 + 1 ))" >&3 2>/dev/null || true
  fi
  echo "$size"
}

# The command the operator typed: start the deploy detached and follow its log.
launch() {
  mkdir -p "$STATE_DIR/runs" "$LOG_DIR" "$(dirname "$LOCK_FILE")"
  flock -n "$LOCK_FILE" true || die "another deploy is running (lock $LOCK_FILE)"
  RUN_ID="$(date +%Y%m%d-%H%M%S)-$$"
  local logf="$LOG_DIR/deploy-$RUN_ID-${ARG:0:7}.log" status="$STATE_DIR/runs/$RUN_ID" self
  self=$(readlink -f "${BASH_SOURCE[0]}")
  : > "$logf"
  find "$LOG_DIR" -maxdepth 1 -name 'deploy-*.log' -mtime +30 -delete 2>/dev/null || true
  find "$STATE_DIR/runs" -maxdepth 1 -type f -mtime +30 -delete 2>/dev/null || true
  local args=("$ARG")
  [ "$ALLOW_DESTRUCTIVE" = 0 ] || args+=(--allow-destructive)
  SLAYDX_DEPLOY_DETACHED=1 SLAYDX_RUN_ID=$RUN_ID SLAYDX_RUN_LOG=$logf \
    setsid nohup bash "$self" "${args[@]}" </dev/null >>"$logf" 2>&1 &
  log "deploy started detached (run $RUN_ID); log: $logf"
  log "if this session drops, the deploy continues: tail -f $logf"

  local off=0 st started
  started=$(date +%s)
  exec 3>&1
  while :; do
    off=$(follow_chunk "$logf" "$off")
    st=$(cat "$status" 2>/dev/null || true)
    case "$st" in rc=*) break ;; esac
    if [ -z "$st" ]; then
      [ $(( $(date +%s) - started )) -le "$START_TIMEOUT" ] \
        || { log "ERROR: the deploy did not start within ${START_TIMEOUT}s — see $logf"; exit 1; }
    elif flock -n "$LOCK_FILE" true; then
      # Lock free but no exit status: the deploy process died (killed). Re-check once for a late rc.
      st=$(cat "$status" 2>/dev/null || true)
      case "$st" in rc=*) break ;; esac
      off=$(follow_chunk "$logf" "$off")
      log "ERROR: the deploy process ended without an exit status — see $logf"; exit 1
    fi
    sleep "$FOLLOW_INTERVAL"
  done
  follow_chunk "$logf" "$off" >/dev/null
  rm -f "$status"
  exit "${st#rc=}"
}

parse_args "$@"
if [ "${SLAYDX_DEPLOY_DETACHED:-}" = 1 ]; then
  run_deploy
else
  launch
fi
