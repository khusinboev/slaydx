# shellcheck shell=bash
# Shared settings for the load/chaos harness. Sourced by every script in loadtests/.
#
# Everything is overridable through the environment. The harness lives in THIS
# checkout (LT_DIR); the application under test lives in REPO_DIR (defaults to
# this checkout, point it at a `git worktree` of another commit to compare).

LT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LT_DIR
export STATE_DIR="${STATE_DIR:-$LT_DIR/.state}"
# While a stack is up, its REPO_DIR wins (down/chaos must act on what is running).
if [[ -f "$STATE_DIR/repo_dir" ]]; then REPO_DIR="$(cat "$STATE_DIR/repo_dir")"; fi
export REPO_DIR="${REPO_DIR:-$(cd "$LT_DIR/.." && pwd)}"
REPO_DIR="$(cd "$REPO_DIR" && pwd)"

export RESULTS_DIR="${RESULTS_DIR:-$LT_DIR/results}"

# Ports / names (all bound to 127.0.0.1 only).
export PG_CONTAINER="${PG_CONTAINER:-slaydx-loadtest-pg}"
export PG_PORT="${PG_PORT:-55441}"
export PG_IMAGE="${PG_IMAGE:-postgres:16.15-alpine3.24}"
export WEB_PORT="${WEB_PORT:-3300}"
export JAIL_PORT="${JAIL_PORT:-3399}"
export BASE_URL="${BASE_URL:-http://127.0.0.1:$WEB_PORT}"
export DATABASE_URL_LT="postgres://slaydx:loadtest@127.0.0.1:$PG_PORT/slaydx"

# Process shape (audit/designs/capacity.md: 2 workers x 4 slots).
export WORKERS="${WORKERS:-2}"
export WORKER_CONCURRENCY_LT="${WORKER_CONCURRENCY:-4}"
# Job budget ceiling. 90 s (= MIN_BUDGET_MS) keeps lease-expiry chaos checks
# under ~4 min; production uses 660 s. Applies to web (budgetFor) and workers.
export JOB_TIMEOUT_MS="${JOB_TIMEOUT_MS:-90000}"

# k6 image pinned by digest (pulled 2026-09-24, k6 v2.3.0).
export K6_IMAGE="${K6_IMAGE:-grafana/k6@sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603}"
export K6_CPUS="${K6_CPUS:-3}"
export K6_MEM="${K6_MEM:-2g}"

# 2-slot machine-wide gate for heavy node processes (FIXER-BRIEF §2).
export HEAVY2="${HEAVY2:-/tmp/claude-1000/-home-adhambek-projects-pythons-slaydbot/c9481df2-e551-4eb4-b6f4-de7690317f2f/scratchpad/heavy2.sh}"
export SHARED_NODE_MODULES="${SHARED_NODE_MODULES:-/home/adhambek/projects/pythons/slaydbot/slaydx/node_modules}"

lt_log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
lt_die() { lt_log "ERROR: $*"; exit 1; }

# psql against the throwaway DB only (never the dev/prod DB).
lt_psql() { PGCONNECT_TIMEOUT=5 psql "$DATABASE_URL_LT" -X -q -v ON_ERROR_STOP=1 "$@"; }
# Single scalar value.
lt_sql() { lt_psql -At -c "$1"; }

lt_health() { curl -s -o /dev/null -m 5 -w '%{http_code}' "$BASE_URL/api/health" 2>/dev/null || true; }

# PID from a pidfile, only if that process is still ours: alive and its cwd is
# REPO_DIR (the supervisor cd's there before spawning). Guards against PID reuse;
# nothing in the harness ever kills by name pattern.
lt_pid() {
  local f="$STATE_DIR/$1.pid" pid
  [[ -f "$f" ]] || return 1
  pid="$(cat "$f")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  [[ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" == "$REPO_DIR" ]] || return 1
  echo "$pid"
}

# Header written by chaos scripts; PASS/FAIL lines are counted by run-all.sh.
LT_FAILS=0
lt_check() { # lt_check <name> <ok:0|1> <detail>
  if [[ "$2" == 1 ]]; then echo "PASS  $1 — $3"; else echo "FAIL  $1 — $3"; LT_FAILS=$((LT_FAILS + 1)); fi
}
