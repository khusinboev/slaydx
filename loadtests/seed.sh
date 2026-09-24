#!/usr/bin/env bash
# Runs seed.mts against the RUNNING stack (its DB + env).
#   loadtests/seed.sh [--users 2000 --gen-users 400 --gens 3 ...]
# The node process runs INSIDE the stack's heavy2 slot (the supervisor executes it as a
# task, same cgroup memory cap), so it never waits for / takes a second heavy slot.
# SEED_VIA=heavy2 runs it through its own heavy2 slot instead.
# Writes $STATE_DIR/tokens.json (or $SEED_OUT). Refuses while workers run, because
# they would claim the seed jobs (start the stack with WORKERS_DEFER=1).
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"
[[ -f "$STATE_DIR/label" ]] || lt_die "stack is not up"
if [[ -f "$STATE_DIR/workers.go" && "${SEED_ALLOW_WORKERS:-0}" != 1 && " $* " != *" --gen-users 0 "* ]]; then
  lt_die "workers are running — seed with WORKERS_DEFER=1 before 'stack.sh workers', or pass --gen-users 0"
fi
out="${SEED_OUT:-$STATE_DIR/tokens.json}"

if [[ "${SEED_VIA:-stack}" == heavy2 ]]; then
  cd "$REPO_DIR"
  set -a
  # shellcheck disable=SC1091
  . "$STATE_DIR/web.env"
  set +a
  exec env HEAVY_SH="$LT_DIR/../scripts/heavy.sh" "$HEAVY2" -m 2G -t 1800 \
    node --import tsx --conditions=react-server "$LT_DIR/seed.mts" --out "$out" "$@"
fi

lt_pid supervisor >/dev/null || lt_die "supervisor is not running"
id="seed-$(date +%s)-$$"
task="$STATE_DIR/tasks/$id"
mkdir -p "$STATE_DIR/tasks"
{
  printf 'cd %q || exit 1\nset -a\n. %q\nset +a\n' "$REPO_DIR" "$STATE_DIR/web.env"
  printf 'exec node --import tsx --conditions=react-server %q --out %q' "$LT_DIR/seed.mts" "$out"
  printf ' %q' "$@"
  printf '\n'
} >"$task.tmp"
mv "$task.tmp" "$task.cmd"
lt_log "seed queued as supervisor task $id"
deadline=$((SECONDS + ${SEED_TIMEOUT:-1800}))
until [[ -f "$task.rc" ]]; do
  ((SECONDS < deadline)) || lt_die "seed did not finish in ${SEED_TIMEOUT:-1800}s (see $task.out)"
  sleep 1
done
grep -v -e UNDICI-EHPA -e trace-warnings "$task.out" || true
exit "$(cat "$task.rc")"
