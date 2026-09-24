#!/usr/bin/env bash
# Chaos (ii): SIGKILL worker-1 while it holds jobs.
# Jobs are made slow with provider-mode tarpit (fake Gemini key, the jail holds each call
# TARPIT_SEC then 502), so the kill really lands mid-job. The supervisor restarts the worker
# (like docker restart: unless-stopped). The killed worker's jobs must be reclaimed after
# their lease (budget + 30 s, housekeeping every 60 s) and end exactly once: one charge and,
# since tarpit jobs fail, exactly one refund each.
set -uo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
# shellcheck source=../lib/chaos.sh
. "$LT_DIR/lib/chaos.sh"
lt_require_stack

WAIT_SEC="${WAIT_SEC:-$((JOB_TIMEOUT_MS / 1000 + 30 + 60 + 150))}"
echo "== chaos worker-sigkill ($(cat "$STATE_DIR/label"); wait ≤${WAIT_SEC}s for reclaim)"
"$LT_DIR/stack.sh" provider-mode tarpit
b1="$(lt_restarts worker-1)"
b2="$(lt_restarts worker-2)"
lt_probe_start "$CHAOS_OUT/worker-sigkill.health"

mapfile -t all < <(lt_enqueue 6 essay 0)
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
echo "INFO  worker-1 pid $pid holds ${#victims[@]} job(s) mid-flight: ${victims[*]}"
kill -KILL "$pid"
t0=$SECONDS

new=""
for _ in $(seq 1 30); do
  new="$(lt_pid worker-1 || true)"
  [[ -n "$new" && "$new" != "$pid" ]] && break
  sleep 1
done
lt_check worker_restarted "$([[ -n "$new" && "$new" != "$pid" ]] && echo 1 || echo 0)" "supervisor started a new worker-1 (pid ${new:-none})"

left="$(lt_wait_terminal "$WAIT_SEC" "${victims[@]}")"
lt_check killed_jobs_finish "$([[ "$left" == 0 ]] && echo 1 || echo 0)" "${#victims[@]} killed job(s) terminal after $((SECONDS - t0)) s; still open: $left"
reclaimed="$(lt_sql "select count(*) from generations where id in ($(printf "'%s'," "${victims[@]}" | sed 's/,$//')) and attempts >= 2")"
echo "INFO  killed jobs re-run by another claim (attempts ≥ 2): $reclaimed / ${#victims[@]}"
lt_check_jobs_money killed "${victims[@]}"
left_all="$(lt_wait_terminal 240 "${all[@]}")"
lt_check_jobs_money all_enqueued "${all[@]}"
[[ "$left_all" == 0 ]] || echo "INFO  other enqueued jobs still open: $left_all"

d1=$(($(lt_restarts worker-1) - b1))
d2=$(($(lt_restarts worker-2) - b2))
lt_check no_crash_loop "$([[ $d1 == 1 && $d2 == 0 ]] && echo 1 || echo 0)" "restarts: worker-1 +$d1 (expected 1: the kill), worker-2 +$d2"
kill "$LT_PROBE_PID" 2>/dev/null
bad="$(awk '$2 != 200' "$CHAOS_OUT/worker-sigkill.health" | wc -l)"
lt_check web_unaffected "$([[ "$bad" == 0 ]] && echo 1 || echo 0)" "non-200 /api/health probes during the experiment: $bad"
echo "INFO  jail proxy hits so far: $(wc -l <"$STATE_DIR/jail.csv") (all answered locally, nothing forwarded)"

"$LT_DIR/stack.sh" provider-mode blank
"$LT_DIR/invariants.sh" --wait-idle 120 | sed 's/^/  /'
[[ "${PIPESTATUS[0]}" == 0 ]] || { LT_FAILS=$((LT_FAILS + 1)); echo "FAIL  invariants_after — see above"; }
echo "== worker-sigkill: $LT_FAILS failed check(s)"
exit "$LT_FAILS"
