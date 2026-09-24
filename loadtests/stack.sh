#!/usr/bin/env bash
# Throwaway load-test stack: Postgres container + `next start` web + N workers.
#
#   loadtests/stack.sh up <label>            start everything, wait for /api/health 200
#   loadtests/stack.sh workers               start the workers (after `WORKERS_DEFER=1 ... up`)
#   loadtests/stack.sh provider-mode <blank|down|tarpit>
#                                            blank  = every provider key empty (default). Text tools
#                                                     render the offline template → COMPLETED; image
#                                                     tool fails fast → refund
#                                            down   = workers get a FAKE Gemini key; the jail proxy
#                                                     answers 502 at once (LLM tools fail → refund)
#                                            tarpit = FAKE Gemini key; the jail holds each call
#                                                     TARPIT_SEC s, then 502 (slow job, then refund)
#   loadtests/stack.sh status
#   loadtests/stack.sh down <label>          stop everything, remove ONLY slaydx-loadtest-pg
#
# REPO_DIR=<checkout> selects the commit under test (default: this checkout).
# Nothing here calls a real provider: keys are blank and all outbound HTTP(S) from
# node goes to the local jail proxy (NODE_USE_ENV_PROXY=1), which never forwards.
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

STACK_MEM="${STACK_MEM:-3G}"          # cgroup cap for jail+web+workers (one heavy2 slot)
STACK_TIMEOUT="${STACK_TIMEOUT:-14400}" # hard stop after 4 h
PG_PROFILE="${PG_PROFILE:-auto}"      # auto | tuned | default  (PG_CPUS_LT: tuned CPU cap, default 2 = compose PG_CPUS)
TARPIT_SEC="${TARPIT_SEC:-20}"

pg_args() {
  local profile="$PG_PROFILE"
  if [[ "$profile" == auto ]]; then
    if grep -q 'shared_buffers=256MB' "$REPO_DIR/docker-compose.yml" 2>/dev/null; then profile=tuned; else profile=default; fi
  fi
  echo "$profile" >"$STATE_DIR/pg_profile"
  if [[ "$profile" == tuned ]]; then
    # Same flags and limits as the audit branch's docker-compose.yml postgres service.
    echo "--memory 1g --cpus ${PG_CPUS_LT:-2} --shm-size 256m $PG_IMAGE postgres -c max_connections=100 -c shared_buffers=256MB -c work_mem=16MB -c shared_preload_libraries=pg_stat_statements -c log_min_duration_statement=500 -c autovacuum_vacuum_scale_factor=0.05 -c idle_in_transaction_session_timeout=60s"
  else
    # main@76ddf91 compose: stock postgres:16 settings, no limits (1 GB cap kept for the laptop).
    echo "--memory 1g --shm-size 256m $PG_IMAGE postgres -c max_connections=100"
  fi
}

app_env() { # app_env <web|worker> <blank|down|tarpit>
  local role="$1" mode="$2" gemini=""
  # down/tarpit: workers get a FAKE Gemini key so the LLM path really calls fetch —
  # which lands in the jail proxy (reject = 502 at once, tarpit = hang then 502).
  [[ "$role" == worker && "$mode" != blank ]] && gemini="loadtest-fake-gemini-key-not-real"
  cat <<EOF
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
DATABASE_URL=$DATABASE_URL_LT
DATABASE_POOL_MAX=${DATABASE_POOL_MAX:-}
SESSION_SECRET=$(cat "$STATE_DIR/session_secret")
APP_URL=$BASE_URL
TELEGRAM_BOT_TOKEN=100000001:loadtest-fake-token-not-real
NEXT_PUBLIC_TELEGRAM_BOT=slaydx_loadtest_bot
CRON_SECRET=loadtest-cron-secret-not-real
TRUST_PROXY=false
DEV_LOGIN_ENABLED=false
WORKER_INLINE=false
WORKER_CONCURRENCY=$WORKER_CONCURRENCY_LT
WORKER_JOB_TIMEOUT_MS=$JOB_TIMEOUT_MS
NODE_USE_ENV_PROXY=1
HTTPS_PROXY=http://127.0.0.1:$JAIL_PORT
HTTP_PROXY=http://127.0.0.1:$JAIL_PORT
https_proxy=http://127.0.0.1:$JAIL_PORT
http_proxy=http://127.0.0.1:$JAIL_PORT
NO_PROXY=127.0.0.1,localhost
no_proxy=127.0.0.1,localhost
SOFFICE_BIN=/nonexistent/loadtest/soffice
PDFTOPPM_BIN=/nonexistent/loadtest/pdftoppm
GEMINI_API_KEY=$gemini
GEMINI_MODEL=
GEMINI_IMAGE_MODEL=
XAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
OPENAI_API_KEY=
FAL_KEY=
PEXELS_API_KEY=
PIXABAY_API_KEY=
OPENALEX_API_KEY=
OPENALEX_MAILTO=
CROSSREF_MAILTO=
GOOGLE_BOOKS_API_KEY=
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
AISHA_API_KEY=
TTS_GEMINI_MODEL=
CLICK_SERVICE_ID=
CLICK_MERCHANT_ID=
CLICK_SECRET_KEY=
CLICK_MERCHANT_USER_ID=
PAYME_MERCHANT_ID=
PAYME_KEY=
PAYME_TEST_KEY=
ADMIN_PHONES=
EOF
}

preflight() {
  command -v docker >/dev/null || lt_die "docker missing"
  command -v psql >/dev/null || lt_die "psql missing"
  command -v jq >/dev/null || lt_die "jq missing"
  [[ -x "$HEAVY2" ]] || lt_die "heavy2 gate not found at $HEAVY2 (set HEAVY2=...)"
  [[ -f "$REPO_DIR/package.json" && -f "$REPO_DIR/scripts/worker.ts" ]] || lt_die "REPO_DIR=$REPO_DIR is not a slaydx checkout"
  # Next loads .env* files even under `next start`: a symlinked .env.local would bring
  # real provider keys back. Refuse instead of trusting precedence rules.
  local f
  for f in .env .env.local .env.production .env.production.local; do
    [[ -e "$REPO_DIR/$f" ]] && lt_die "$REPO_DIR/$f exists — remove/unlink it first (it would load real provider keys)"
  done
  if [[ ! -e "$REPO_DIR/node_modules" ]]; then
    [[ -d "$SHARED_NODE_MODULES" ]] || lt_die "no node_modules in $REPO_DIR and $SHARED_NODE_MODULES missing"
    # Turbopack refuses a node_modules symlink pointing outside its workspace root
    # ("Symlink node_modules is invalid"); the root it infers is the outermost dir with a
    # lockfile, so the checkout must live INSIDE the tree that owns the shared node_modules.
    local owner
    owner="$(dirname "$SHARED_NODE_MODULES")"
    [[ "$REPO_DIR/" == "$owner/"* ]] ||
      lt_die "REPO_DIR must be inside $owner for the shared node_modules to work with Turbopack (e.g. git worktree add --detach $owner/.claude/worktrees/loadtest-main 76ddf91)"
    ln -s "$SHARED_NODE_MODULES" "$REPO_DIR/node_modules"
    lt_log "linked node_modules -> $SHARED_NODE_MODULES (never npm install)"
  fi
  for p in "$WEB_PORT" "$PG_PORT" "$JAIL_PORT"; do
    if ss -Hltn "sport = :$p" | grep -q .; then lt_die "port $p already in use"; fi
  done
  if docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    lt_die "container $PG_CONTAINER already exists (run: stack.sh down <label>)"
  fi
}

start_pg() {
  # shellcheck disable=SC2046
  docker run -d --name "$PG_CONTAINER" --label slaydx-loadtest=1 \
    -p "127.0.0.1:$PG_PORT:5432" \
    -e POSTGRES_USER=slaydx -e POSTGRES_PASSWORD=loadtest -e POSTGRES_DB=slaydx \
    $(pg_args) >/dev/null
  for _ in $(seq 1 60); do
    lt_sql "select 1" >/dev/null 2>&1 && { lt_log "postgres up ($(cat "$STATE_DIR/pg_profile") profile) on 127.0.0.1:$PG_PORT"; return; }
    sleep 1
  done
  lt_die "postgres did not become ready"
}

build_if_needed() {
  local want have=""
  want="$(git -C "$REPO_DIR" rev-parse HEAD)$(git -C "$REPO_DIR" diff --quiet HEAD -- . ':!loadtests' || echo -dirty)"
  [[ -f "$REPO_DIR/.next/LOADTEST_HEAD" ]] && have="$(cat "$REPO_DIR/.next/LOADTEST_HEAD")"
  if [[ -f "$REPO_DIR/.next/BUILD_ID" && "$have" == "$want" && "${FORCE_BUILD:-0}" != 1 ]]; then
    lt_log "reusing .next build of $want"
    return
  fi
  lt_log "building $want with next build (through heavy2, -m 4G) ..."
  (
    cd "$REPO_DIR"
    HEAVY_SH="$LT_DIR/../scripts/heavy.sh" "$HEAVY2" -m 4G -t 900 \
      env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_TELEGRAM_BOT=slaydx_loadtest_bot \
      node node_modules/next/dist/bin/next build --turbopack
  ) >"$STATE_DIR/logs/build.log" 2>&1 || { tail -30 "$STATE_DIR/logs/build.log" >&2; lt_die "next build failed (log: $STATE_DIR/logs/build.log)"; }
  echo "$want" >"$REPO_DIR/.next/LOADTEST_HEAD"
}

wait_health() {
  local deadline=$((SECONDS + ${1:-180})) code
  while ((SECONDS < deadline)); do
    code="$(lt_health)"
    [[ "$code" == 200 ]] && return 0
    sleep 1
  done
  return 1
}

cmd_up() {
  local label="${1:?usage: stack.sh up <label>}"
  [[ -f "$STATE_DIR/label" ]] && lt_die "a stack is already up (label $(cat "$STATE_DIR/label")); run stack.sh down first"
  preflight
  rm -rf "$STATE_DIR"
  mkdir -p "$STATE_DIR/logs"
  echo "$label" >"$STATE_DIR/label"
  echo "$REPO_DIR" >"$STATE_DIR/repo_dir"
  head -c 48 /dev/urandom | base64 | tr -d '\n/+=' >"$STATE_DIR/session_secret"
  echo reject >"$STATE_DIR/jail.mode"
  echo blank >"$STATE_DIR/provider.mode"
  cat >"$STATE_DIR/stack.env" <<EOF
REPO_DIR=$REPO_DIR
LT_DIR=$LT_DIR
WEB_PORT=$WEB_PORT
WORKERS=$WORKERS
JAIL_PORT=$JAIL_PORT
JAIL_MODE_FILE=$STATE_DIR/jail.mode
JAIL_LOG=$STATE_DIR/jail.csv
TARPIT_SEC=$TARPIT_SEC
EOF
  app_env web blank >"$STATE_DIR/web.env"
  app_env worker blank >"$STATE_DIR/worker.env"
  : >"$STATE_DIR/jail.csv"

  start_pg
  build_if_needed

  lt_log "starting supervisor (jail + web${WORKERS_DEFER:+, workers deferred}) in one heavy2 slot, -m $STACK_MEM"
  (
    cd "$REPO_DIR"
    HEAVY_SH="$LT_DIR/../scripts/heavy.sh" setsid nohup "$HEAVY2" -m "$STACK_MEM" -t "$STACK_TIMEOUT" \
      bash "$LT_DIR/lib/supervisor.sh" "$STATE_DIR" >"$STATE_DIR/logs/supervisor.log" 2>&1 </dev/null &
  )
  local waited=0
  until [[ -f "$STATE_DIR/supervisor.pid" ]]; do
    sleep 1
    waited=$((waited + 1))
    ((waited == 5)) && lt_log "waiting for a free heavy2 slot ..."
    ((waited > ${SLOT_WAIT:-1800})) && lt_die "no heavy2 slot after ${SLOT_WAIT:-1800}s"
  done
  wait_health 180 || { tail -30 "$STATE_DIR/logs/web.log" >&2; lt_die "web did not answer /api/health 200"; }
  lt_log "web healthy at $BASE_URL (web pid $(cat "$STATE_DIR/web.pid"))"
  verify_jail
  if [[ -z "${WORKERS_DEFER:-}" ]]; then cmd_workers; fi
}

# Proves node on this machine routes fetch through the jail (NODE_USE_ENV_PROXY honoured).
verify_jail() {
  local before after
  before=$(wc -l <"$STATE_DIR/jail.csv")
  (
    set -a
    # shellcheck disable=SC1091
    . "$STATE_DIR/web.env"
    set +a
    node -e "fetch('https://jail-selftest.invalid/').then(()=>{},()=>{})" 2>/dev/null
  ) || true
  after=$(wc -l <"$STATE_DIR/jail.csv")
  ((after > before)) || lt_die "jail self-test failed: node did not use the proxy — refusing to continue"
  lt_log "jail proxy verified (node fetch is routed to 127.0.0.1:$JAIL_PORT, nothing is forwarded)"
}

cmd_workers() {
  [[ -f "$STATE_DIR/label" ]] || lt_die "stack is not up"
  touch "$STATE_DIR/workers.go"
  local i pid ok
  for ((i = 1; i <= WORKERS; i++)); do
    ok=0
    for _ in $(seq 1 120); do
      pid="$(lt_pid "worker-$i" || true)"
      if [[ -n "$pid" ]] && grep -q "ishga tushdi" "$STATE_DIR/logs/worker-$i.log" 2>/dev/null; then ok=1; break; fi
      sleep 1
    done
    ((ok)) || { tail -20 "$STATE_DIR/logs/worker-$i.log" >&2; lt_die "worker-$i did not start"; }
  done
  lt_log "$WORKERS workers running (concurrency $WORKER_CONCURRENCY_LT each)"
}

cmd_provider_mode() {
  local mode="${1:?usage: stack.sh provider-mode <blank|down|tarpit>}" i old new
  [[ "$mode" == blank || "$mode" == down || "$mode" == tarpit ]] || lt_die "mode must be blank, down or tarpit"
  [[ -f "$STATE_DIR/label" ]] || lt_die "stack is not up"
  [[ "$(cat "$STATE_DIR/provider.mode")" == "$mode" ]] && { lt_log "provider mode already $mode"; return; }
  app_env worker "$mode" >"$STATE_DIR/worker.env"
  if [[ "$mode" == tarpit ]]; then echo tarpit >"$STATE_DIR/jail.mode"; else echo reject >"$STATE_DIR/jail.mode"; fi
  echo "$mode" >"$STATE_DIR/provider.mode"
  [[ -f "$STATE_DIR/workers.go" ]] || return 0
  # Rolling restart (SIGTERM = graceful drain) so workers pick up the new env.
  for ((i = 1; i <= WORKERS; i++)); do
    old="$(lt_pid "worker-$i")" || continue
    kill -TERM "$old"
    for _ in $(seq 1 90); do
      new="$(lt_pid "worker-$i" || true)"
      [[ -n "$new" && "$new" != "$old" ]] && break
      sleep 1
    done
    [[ -n "$new" && "$new" != "$old" ]] || lt_die "worker-$i did not come back"
    sleep 3
  done
  lt_log "provider mode now $mode (workers restarted)"
}

cmd_status() {
  [[ -f "$STATE_DIR/label" ]] || { echo "stack: down"; return; }
  echo "label:    $(cat "$STATE_DIR/label")"
  echo "repo:     $REPO_DIR"
  echo "provider: $(cat "$STATE_DIR/provider.mode")  pg: $(cat "$STATE_DIR/pg_profile" 2>/dev/null)"
  echo "health:   $(lt_health)"
  local f n
  for f in "$STATE_DIR"/*.pid; do
    n="$(basename "$f" .pid)"
    printf '%-12s pid=%-8s alive=%s restarts=%s\n' "$n" "$(cat "$f")" \
      "$(kill -0 "$(cat "$f")" 2>/dev/null && echo yes || echo no)" "$(cat "$STATE_DIR/restarts.$n" 2>/dev/null || echo 0)"
  done
  echo "queue:    $(lt_sql "select string_agg(status||'='||c, ' ') from (select status, count(*) c from generations group by 1 order by 1) s" 2>/dev/null)"
  echo "jail hits: $(wc -l <"$STATE_DIR/jail.csv") (1 = the start-up self-test)"
}

cmd_down() {
  local label="${1:?usage: stack.sh down <label>}" have="" pid n f
  [[ -f "$STATE_DIR/label" ]] && have="$(cat "$STATE_DIR/label")"
  if [[ -n "$have" && "$have" != "$label" && "${FORCE:-0}" != 1 ]]; then
    lt_die "running stack has label '$have', not '$label' (FORCE=1 to stop anyway)"
  fi
  if pid="$(lt_pid supervisor)"; then
    lt_log "stopping supervisor $pid (graceful, ≤30 s)"
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  fi
  # Fallback: anything still alive from our pidfiles (cwd-verified, never pattern kills).
  for f in "$STATE_DIR"/*.pid; do
    [[ -f "$f" ]] || continue
    n="$(basename "$f" .pid)"
    if pid="$(lt_pid "$n")"; then
      lt_log "killing leftover $n ($pid)"
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  if docker ps -a --filter "label=slaydx-loadtest=1" --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    docker rm -f "$PG_CONTAINER" >/dev/null && lt_log "removed container $PG_CONTAINER"
  fi
  if [[ -d "$STATE_DIR" ]]; then
    local keep="$RESULTS_DIR/$label/stack"
    mkdir -p "$keep"
    cp -r "$STATE_DIR/logs" "$STATE_DIR"/events.log "$STATE_DIR"/jail.csv "$keep/" 2>/dev/null || true
    for f in "$STATE_DIR"/restarts.*; do [[ -f "$f" ]] && cp "$f" "$keep/"; done
    rm -rf "$STATE_DIR"
    lt_log "logs kept in $keep"
  fi
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  workers) cmd_workers ;;
  provider-mode) shift; cmd_provider_mode "$@" ;;
  status) cmd_status ;;
  down) shift; cmd_down "$@" ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
