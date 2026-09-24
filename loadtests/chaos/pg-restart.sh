#!/usr/bin/env bash
# Chaos (i): Postgres goes away for DOWN_SEC in the middle of mixed load, then comes back.
#   docker stop -t 5 (fast shutdown: every connection is terminated) → sleep DOWN_SEC → docker start
# Expect: web and workers survive (or restart at most once — no crash loop), /api/health is
# 200 again within RECOVER_SEC of Postgres being ready and stays 200, workers take new jobs,
# and the ledger/job invariants hold afterwards.
set -uo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
# shellcheck source=../lib/chaos.sh
. "$LT_DIR/lib/chaos.sh"
lt_require_stack

LOAD_SEC="${LOAD_SEC:-90}"
KILL_AT="${KILL_AT:-20}"
DOWN_SEC="${DOWN_SEC:-10}"
RECOVER_SEC="${RECOVER_SEC:-30}"
echo "== chaos pg-restart ($(cat "$STATE_DIR/label"); mixed load ${LOAD_SEC}s, postgres down ${DOWN_SEC}s at +${KILL_AT}s)"

declare -A before
for n in web worker-1 worker-2; do before[$n]="$(lt_restarts "$n")"; done
probe="$CHAOS_OUT/pg-restart.health"
lt_probe_start "$probe"
lt_k6_bg pg-restart-k6 "${LOAD_SEC}s"

sleep "$KILL_AT"
t_kill="$(date +%s.%N)"
docker stop -t 5 "$PG_CONTAINER" >/dev/null
sleep "$DOWN_SEC"
docker start "$PG_CONTAINER" >/dev/null
until lt_sql "select 1" >/dev/null 2>&1; do sleep 0.2; done
t_pg="$(date +%s.%N)"
echo "INFO  postgres unavailable for $(awk -v a="$t_kill" -v b="$t_pg" 'BEGIN{printf "%.1f", b-a}') s"

# Recovery: first /api/health 200 after Postgres is back.
t_ok=""
for _ in $(seq 1 $((RECOVER_SEC * 4))); do
  if [[ "$(lt_health)" == 200 ]]; then t_ok="$(date +%s.%N)"; break; fi
  sleep 0.25
done
if [[ -n "$t_ok" ]]; then
  lt_check web_recovers 1 "/api/health 200 $(awk -v a="$t_pg" -v b="$t_ok" 'BEGIN{printf "%.1f", b-a}')s after postgres ready (limit ${RECOVER_SEC}s)"
else
  lt_check web_recovers 0 "/api/health not 200 within ${RECOVER_SEC}s after postgres ready"
fi

wait "$LT_K6_PID"
kill "$LT_PROBE_PID" 2>/dev/null

# Workers still claim work after the outage.
mapfile -t ids < <(lt_enqueue 4 essay 200)
if ((${#ids[@]} == 0)); then
  lt_check workers_take_new_jobs 0 "could not enqueue after the outage"
else
  left="$(lt_wait_terminal 120 "${ids[@]}")"
  lt_check workers_take_new_jobs "$([[ "$left" == 0 ]] && echo 1 || echo 0)" "${#ids[@]} jobs enqueued after the outage, still open after 120 s: $left"
fi

for n in web worker-1 worker-2; do
  d=$(($(lt_restarts "$n") - ${before[$n]}))
  lt_check "${n}_no_crash_loop" "$([[ $d -le 1 ]] && echo 1 || echo 0)" "process restarts during experiment: $d (0 = survived, 1 = crashed once and came back)"
done
lt_check stack_alive_after "$([[ -n "$(lt_pid web)" && -n "$(lt_pid worker-1)" && -n "$(lt_pid worker-2)" ]] && echo 1 || echo 0)" "web + both workers running at the end"

after_fail="$(awk -v t="${t_ok:-9e18}" '$1 > t && $2 != 200' "$probe" | wc -l)"
during_fail="$(awk -v a="$t_kill" -v t="${t_ok:-9e18}" '$1 >= a && $1 <= t && $2 != 200' "$probe" | wc -l)"
lt_check health_stable_after_recovery "$([[ "$after_fail" == 0 ]] && echo 1 || echo 0)" "non-200 /api/health probes after recovery: $after_fail"
echo "INFO  non-200 /api/health probes during the outage: $during_fail (expected: health reports the DB)"
echo "INFO  k6 mixed during experiment — $(lt_k6_line "$CHAOS_OUT/pg-restart-k6/k6-mixed.json")"
awk -v a="$(date -u -d "@${t_kill%.*}" +%FT%T)" '$1 >= a && / exit /' "$STATE_DIR/events.log" | sed 's/^/INFO  event /'

"$LT_DIR/invariants.sh" --wait-idle 240 | sed 's/^/  /'
[[ "${PIPESTATUS[0]}" == 0 ]] || { LT_FAILS=$((LT_FAILS + 1)); echo "FAIL  invariants_after — see above"; }
echo "== pg-restart: $LT_FAILS failed check(s)"
exit "$LT_FAILS"
