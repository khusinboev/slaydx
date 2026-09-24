#!/usr/bin/env bash
# Full pipeline for one commit:
#   stack up (workers deferred) → seed → workers → [metrics + each k6 scenario + invariants]
#   → chaos experiments → summary.md → stack down
#
#   loadtests/run-all.sh <label>
#   REPO_DIR=/path/to/worktree-of-main loadtests/run-all.sh before
#
# Env: PROFILE=full|smoke (default full), SCENARIOS="browse poll enqueue downloads uploads mixed",
#      CHAOS="pg-restart worker-sigkill provider-down worker-sigterm" (CHAOS=none to skip),
#      SEED_ARGS="--users 2000 --gen-users 400 --gens 3", COOLDOWN=15, KEEP_STACK=1 (leave it up),
#      plus everything k6run.sh / stack.sh accept (VUS, DURATION, RAMP, BASE_RPS, ...).
# Output: loadtests/results/<label>/{k6-*.json, metrics-*.csv, invariants-after-*.txt,
#         chaos-*.txt, chaos/, stack/ (logs), summary.md}
set -uo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"
label="${1:?usage: run-all.sh <label>}"
out="$RESULTS_DIR/$label"
mkdir -p "$out"
export PROFILE="${PROFILE:-full}"
SCENARIOS="${SCENARIOS:-browse poll enqueue downloads uploads mixed}"
CHAOS="${CHAOS:-pg-restart worker-sigkill provider-down worker-sigterm}"
SEED_ARGS="${SEED_ARGS:---users 2000 --gen-users 400 --gens 3}"
COOLDOWN="${COOLDOWN:-15}"

cleanup() {
  [[ -n "${mpid:-}" ]] && kill "$mpid" 2>/dev/null
  if [[ "${KEEP_STACK:-0}" != 1 ]]; then "$LT_DIR/stack.sh" down "$label" 2>&1 | tail -n 3; fi
}
trap cleanup EXIT

{
  echo "label=$label"
  echo "repo=$REPO_DIR"
  echo "commit=$(git -C "$REPO_DIR" rev-parse --short HEAD) $(git -C "$REPO_DIR" log -1 --format=%s | cut -c1-80)"
  echo "profile=$PROFILE scenarios=[$SCENARIOS] chaos=[$CHAOS]"
  echo "seed=$SEED_ARGS workers=$WORKERS x concurrency $WORKER_CONCURRENCY_LT job_timeout_ms=$JOB_TIMEOUT_MS"
  echo "k6=$K6_IMAGE cpus=$K6_CPUS mem=$K6_MEM"
  echo "host=$(nproc) cores, $(free -g | awk '/^Mem:/ {print $2 " GB RAM, " $7 " GB available"}') at start; date=$(date -u +%FT%TZ)"
  for v in VUS DURATION RAMP BASE_RPS BURST_FACTOR STEADY BURST MIX_VUS ENQ_RPS UPLOAD_KB UPLOAD_USERS PG_PROFILE STACK_MEM; do
    [[ -n "${!v:-}" ]] && echo "$v=${!v}"
  done
} >"$out/run.env"
cat "$out/run.env"

WORKERS_DEFER=1 "$LT_DIR/stack.sh" up "$label" || exit 1
echo "pg_profile=$(cat "$STATE_DIR/pg_profile")" >>"$out/run.env"
# shellcheck disable=SC2086
"$LT_DIR/seed.sh" $SEED_ARGS 2>&1 | grep -v UNDICI-EHPA | grep -v trace-warnings | tee "$out/seed.log"
[[ "${PIPESTATUS[0]}" == 0 ]] || { lt_log "seed failed"; exit 1; }
"$LT_DIR/stack.sh" workers || exit 1

for s in $SCENARIOS; do
  INTERVAL="${INTERVAL:-5}" "$LT_DIR/metrics.sh" "$out/metrics-$s.csv" &
  mpid=$!
  "$LT_DIR/k6run.sh" "$s" "$out" 2>&1 | tee "$out/k6-$s.log"
  kill "$mpid" 2>/dev/null
  wait "$mpid" 2>/dev/null
  mpid=""
  "$LT_DIR/invariants.sh" --wait-idle 300 >"$out/invariants-after-$s.txt" 2>&1
  grep -E '^(FAIL|INFO  jobs)' "$out/invariants-after-$s.txt" | sed "s/^/[$s] /"
  sleep "$COOLDOWN"
done

if [[ "$CHAOS" != none ]]; then
  for c in $CHAOS; do
    INTERVAL=2 "$LT_DIR/metrics.sh" "$out/metrics-chaos-$c.csv" &
    mpid=$!
    OUT_DIR="$out/chaos" "$LT_DIR/chaos/$c.sh" 2>&1 | grep -v UNDICI | tee "$out/chaos-$c.txt"
    kill "$mpid" 2>/dev/null
    wait "$mpid" 2>/dev/null
    mpid=""
    sleep "$COOLDOWN"
  done
fi

"$LT_DIR/stack.sh" status >"$out/stack-status-end.txt" 2>&1
"$LT_DIR/lib/summarize.sh" "$out" >"$out/summary.md"
lt_log "summary: $out/summary.md"
