#!/usr/bin/env bash
# Chaos (iv): SIGTERM worker-1 (a deploy) while it holds slow jobs, under mixed load.
# Contract after W3-A/C14: stop claiming, wait up to 20 s (SHUTDOWN_GRACE_MS) for running
# jobs, then release the rest to QUEUED at once (attempt not counted) so another worker
# picks them up — no job may stay IN_PROGRESS under the dead process's lease.
# Before the fix (main) the worker exits after 2 s and its jobs wait for lease expiry.
set -uo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
# shellcheck source=../lib/chaos.sh
. "$LT_DIR/lib/chaos.sh"
lt_require_stack

GRACE_SEC="${GRACE_SEC:-20}"
RELEASE_SLACK="${RELEASE_SLACK:-15}"
WAIT_SEC="${WAIT_SEC:-$((JOB_TIMEOUT_MS / 1000 + 30 + 60 + 150))}"
echo "== chaos worker-sigterm ($(cat "$STATE_DIR/label"); release expected ≤ $((GRACE_SEC + RELEASE_SLACK)) s)"
"$LT_DIR/stack.sh" provider-mode tarpit
b1="$(lt_restarts worker-1)"
lt_k6_bg worker-sigterm-k6 "${K6_SEC:-60}s"

mapfile -t all < <(lt_enqueue 6 essay 100)
((${#all[@]} > 0)) || { lt_check enqueue 0 "no job accepted"; exit 1; }
pid="$(lt_pid worker-1)" || { lt_check worker1_running 0 "worker-1 not running"; exit 1; }
victims=()
for _ in $(seq 1 40); do
  mapfile -t victims < <(lt_jobs_of_pid "$pid")
  ((${#victims[@]} > 0)) && break
  sleep 0.5
done
((${#victims[@]} > 0)) || { lt_check victim_found 0 "worker-1 ($pid) never held a job"; "$LT_DIR/stack.sh" provider-mode blank; exit 1; }
sleep 2
mapfile -t victims < <(lt_jobs_of_pid "$pid")
list="$(printf "'%s'," "${victims[@]}" | sed 's/,$//')"
echo "INFO  worker-1 pid $pid holds ${#victims[@]} job(s): ${victims[*]}"
kill -TERM "$pid"
t0=$SECONDS

held=""
for _ in $(seq 1 $((GRACE_SEC + RELEASE_SLACK))); do
  held="$(lt_sql "select count(*) from generations where id in ($list) and status='IN_PROGRESS' and locked_by like '$pid-%'")"
  [[ "$held" == 0 ]] && break
  sleep 1
done
dt=$((SECONDS - t0))
lt_check drained_or_released "$([[ "$held" == 0 ]] && echo 1 || echo 0)" \
  "jobs still leased by the stopped worker after ${dt}s: $held (0 = finished in grace or released to QUEUED)"
gone=0
for _ in $(seq 1 $((GRACE_SEC + RELEASE_SLACK))); do
  kill -0 "$pid" 2>/dev/null || { gone=1; break; }
  sleep 1
done
lt_check exited_after_sigterm "$gone" "old worker process exited within $((GRACE_SEC + RELEASE_SLACK))s of SIGTERM"
grep -h "to'xtatilmoqda" "$STATE_DIR/logs/worker-1.log" | tail -n 3 | sed 's/^/INFO  worker-1 log: /'

left="$(lt_wait_terminal "$WAIT_SEC" "${victims[@]}")"
lt_check sigtermed_jobs_finish "$([[ "$left" == 0 ]] && echo 1 || echo 0)" "${#victims[@]} job(s) terminal after $((SECONDS - t0)) s; still open: $left"
lt_check_jobs_money sigtermed "${victims[@]}"
lt_wait_terminal 240 "${all[@]}" >/dev/null
lt_check_jobs_money all_enqueued "${all[@]}"

d1=$(($(lt_restarts worker-1) - b1))
lt_check no_crash_loop "$([[ $d1 == 1 ]] && echo 1 || echo 0)" "worker-1 restarts: +$d1 (expected 1: the SIGTERM)"
wait "$LT_K6_PID"
echo "INFO  k6 mixed during experiment — $(lt_k6_line "$CHAOS_OUT/worker-sigterm-k6/k6-mixed.json")"

"$LT_DIR/stack.sh" provider-mode blank
"$LT_DIR/invariants.sh" --wait-idle 120 | sed 's/^/  /'
[[ "${PIPESTATUS[0]}" == 0 ]] || { LT_FAILS=$((LT_FAILS + 1)); echo "FAIL  invariants_after — see above"; }
echo "== worker-sigterm: $LT_FAILS failed check(s)"
exit "$LT_FAILS"
