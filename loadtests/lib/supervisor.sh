#!/usr/bin/env bash
# Process supervisor for the load-test stack. Started by `stack.sh up` INSIDE one
# heavy2.sh slot, so the whole stack (jail proxy + web + N workers) shares one
# cgroup memory cap and counts as ONE heavy process.
#
# Behaves like docker `restart: unless-stopped`: a child that exits (crash, SIGKILL,
# SIGTERM from a chaos script) is started again with exponential back-off
# (1 s doubling to 30 s while it keeps dying within 10 s). Every start/exit is
# written to $STATE_DIR/events.log and counted in $STATE_DIR/restarts.<name>.
#
# Workers start only once $STATE_DIR/workers.go exists (lets the seeder claim and
# complete its own jobs before any real worker is running).
set -u
STATE_DIR="$1"
set -a
# shellcheck disable=SC1091
. "$STATE_DIR/stack.env"
set +a
cd "$REPO_DIR" || exit 1

declare -A PID START DELAY NEXT
stopping=0
workers_started=0

ev() { echo "$(date -u +%FT%T.%3NZ) $*" >>"$STATE_DIR/events.log"; }

spawn() {
  local name="$1"
  case "$name" in
    jail)
      (exec node "$LT_DIR/lib/jail-proxy.mjs") >>"$STATE_DIR/logs/jail.log" 2>&1 &
      ;;
    web)
      (
        set -a
        # shellcheck disable=SC1091
        . "$STATE_DIR/web.env"
        set +a
        exec node node_modules/next/dist/bin/next start -p "$WEB_PORT" -H 127.0.0.1
      ) >>"$STATE_DIR/logs/web.log" 2>&1 &
      ;;
    worker-*)
      (
        set -a
        # shellcheck disable=SC1091
        . "$STATE_DIR/worker.env"
        set +a
        exec node --import tsx --conditions=react-server scripts/worker.ts
      ) >>"$STATE_DIR/logs/$name.log" 2>&1 &
      ;;
  esac
  PID[$name]=$!
  START[$name]=$SECONDS
  echo "${PID[$name]}" >"$STATE_DIR/$name.pid"
  ev "start $name ${PID[$name]}"
}

# One-shot heavy tasks (the seeder) run INSIDE this slot/cgroup instead of taking the
# second heavy2 slot: a caller drops $STATE_DIR/tasks/<id>.cmd (a bash script) and waits
# for <id>.rc; output goes to <id>.out.
run_tasks() {
  local f base
  for f in "$STATE_DIR"/tasks/*.cmd; do
    [[ -e "$f" ]] || continue
    base="${f%.cmd}"
    mv "$f" "$base.run" || continue
    ev "task $(basename "$base") start"
    (
      bash "$base.run" >"$base.out" 2>&1
      rc=$?
      echo "$rc" >"$base.rc"
      echo "$(date -u +%FT%T.%3NZ) task $(basename "$base") exit rc=$rc" >>"$STATE_DIR/events.log"
    ) &
  done
}

on_stop() { stopping=1; }
trap on_stop TERM INT

ev "supervisor $$ up (repo=$REPO_DIR)"
echo $$ >"$STATE_DIR/supervisor.pid"
spawn jail
spawn web

mkdir -p "$STATE_DIR/tasks"
while ((!stopping)); do
  run_tasks
  if ((!workers_started)) && [[ -f "$STATE_DIR/workers.go" ]]; then
    for ((i = 1; i <= WORKERS; i++)); do spawn "worker-$i"; done
    workers_started=1
  fi
  for name in "${!PID[@]}"; do
    pid="${PID[$name]}"
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      code=$?
      up=$((SECONDS - START[$name]))
      n=$(($(cat "$STATE_DIR/restarts.$name" 2>/dev/null || echo 0) + 1))
      echo "$n" >"$STATE_DIR/restarts.$name"
      d="${DELAY[$name]:-1}"
      if ((up >= 10)); then d=1; else d=$((d * 2 > 30 ? 30 : d * 2)); fi
      DELAY[$name]=$d
      NEXT[$name]=$((SECONDS + d))
      PID[$name]=""
      ev "exit $name $pid code=$code uptime=${up}s restart#$n in ${d}s"
    elif [[ -z "$pid" ]] && ((SECONDS >= ${NEXT[$name]:-0})); then
      ((stopping)) || spawn "$name"
    fi
  done
  sleep 0.5 &
  wait $! 2>/dev/null
done

ev "supervisor stopping"
for name in "${!PID[@]}"; do
  [[ -n "${PID[$name]}" ]] && kill -TERM "${PID[$name]}" 2>/dev/null
done
# Worker drain grace is 20 s (SHUTDOWN_GRACE_MS); give it a little more.
for _ in $(seq 1 50); do
  alive=0
  for name in "${!PID[@]}"; do
    [[ -n "${PID[$name]}" ]] && kill -0 "${PID[$name]}" 2>/dev/null && alive=1
  done
  ((alive)) || break
  sleep 0.5
done
for name in "${!PID[@]}"; do
  if [[ -n "${PID[$name]}" ]] && kill -0 "${PID[$name]}" 2>/dev/null; then
    ev "force-kill $name ${PID[$name]}"
    kill -KILL "${PID[$name]}" 2>/dev/null
  fi
done
ev "supervisor stopped"
rm -f "$STATE_DIR/supervisor.pid"
