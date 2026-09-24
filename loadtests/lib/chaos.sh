# shellcheck shell=bash
# Helpers shared by loadtests/chaos/*.sh (sourced after common.sh).

TOKENS_FILE="${TOKENS_FILE:-$STATE_DIR/tokens.json}"
CHAOS_OUT="${OUT_DIR:-$RESULTS_DIR/adhoc}"
mkdir -p "$CHAOS_OUT"

lt_require_stack() {
  [[ -f "$STATE_DIR/label" ]] || lt_die "stack is not up"
  [[ -f "$STATE_DIR/workers.go" ]] || lt_die "workers are not running (stack.sh workers)"
  [[ -f "$TOKENS_FILE" ]] || lt_die "no $TOKENS_FILE (run seed.sh)"
}

# Token of user #i counted from the END of the seeded list (tail users own no seeded jobs).
lt_token_from_tail() {
  jq -r --argjson i "$1" '.users[(.users | length) - 1 - $i].t' "$TOKENS_FILE"
}

# lt_enqueue <count> <slug> <tail_offset> → prints one job id per line (202 only).
lt_enqueue() {
  local n="$1" slug="$2" off="$3" k t body
  for ((k = 0; k < n; k++)); do
    t="$(lt_token_from_tail $((off + k)))"
    if [[ "$slug" == rasm ]]; then
      body="{\"slug\":\"rasm\",\"values\":{\"prompt\":\"Chaos rasm $off-$k\"}}"
    else
      body="{\"slug\":\"essay\",\"values\":{\"topic\":\"Chaos insho $off-$k\",\"essayContext\":\"school\"}}"
    fi
    curl -s -m 15 -H "Cookie: slaydx_session=$t" -H 'Content-Type: application/json' -d "$body" \
      "$BASE_URL/api/generations" | jq -r 'select(.id) | .id'
  done
}

# Wait until every job id is COMPLETED/FAILED/REVOKED; prints the number still open.
lt_wait_terminal() { # lt_wait_terminal <timeout_s> <id...>
  local timeout="$1" left
  shift
  local ids
  ids="$(printf "'%s'," "$@")"
  ids="${ids%,}"
  local deadline=$((SECONDS + timeout))
  while :; do
    left="$(lt_sql "select count(*) from generations where id in ($ids) and status in ('QUEUED','IN_PROGRESS')")"
    [[ "$left" == 0 || $SECONDS -ge $deadline ]] && break
    sleep 2
  done
  echo "$left"
}

# Per-job money check for a set of ids: exactly one charge; FAILED → exactly one refund;
# COMPLETED → no full refund; never more than one refund.
lt_check_jobs_money() { # lt_check_jobs_money <label> <id...>
  local label="$1"
  shift
  local ids bad
  ids="$(printf "'%s'," "$@")"
  ids="${ids%,}"
  bad="$(lt_sql "select count(*) from generations g
      cross join lateral (select count(*) filter (where kind='charge') ch, count(*) filter (where kind='refund') rf
                            from transactions t where t.reference = g.id::text) m
      where g.id in ($ids) and (m.ch <> 1 or m.rf > 1 or (g.status = 'FAILED' and m.rf <> 1))")"
  lt_check "${label}_charged_once_refunded_once" "$([[ "$bad" == 0 ]] && echo 1 || echo 0)" \
    "$# jobs; violations (charge≠1, refund>1, FAILED without exactly one refund): $bad"
  echo "INFO  $label states — $(lt_sql "select string_agg(n||'× '||status||' attempts='||attempts||' refunds='||rf, '; ') from (
      select status, attempts, rf, count(*) n from (select g.status, g.attempts,
        (select count(*) from transactions t where t.kind='refund' and t.reference=g.id::text) rf
        from generations g where g.id in ($ids)) s group by 1,2,3 order by 1,2,3) x")"
}

# Background /api/health prober: one line "epoch code seconds" every 0.5 s. Sets LT_PROBE_PID.
lt_probe_start() { # lt_probe_start <file>
  (
    while :; do
      printf '%s %s\n' "$(date +%s.%N)" "$(curl -s -o /dev/null -m 5 -w '%{http_code} %{time_total}' "$BASE_URL/api/health" 2>/dev/null || echo '000 5')"
      sleep 0.5
    done
  ) >"$1" 2>/dev/null &
  LT_PROBE_PID=$!
}

lt_restarts() { cat "$STATE_DIR/restarts.$1" 2>/dev/null || echo 0; }

# IN_PROGRESS jobs leased by a worker process (lease = "<pid>-<rand>" on main, "<pid>-<rand>:<uuid>" after C26).
lt_jobs_of_pid() {
  lt_sql "select id from generations where status='IN_PROGRESS' and locked_by like '$1-%' order by locked_at"
}

# Background k6 load during a chaos experiment (mixed smoke profile by default).
# Sets LT_K6_PID; summary in $CHAOS_OUT/<name>/k6-<scenario>.json.
lt_k6_bg() { # lt_k6_bg <name> <duration> [scenario]
  local name="$1" dur="$2" scen="${3:-mixed}"
  (
    PROFILE=smoke VUS="${CHAOS_VUS:-30}" MIX_VUS="${CHAOS_VUS:-30}" DURATION="$dur" RAMP=5s ENQ_RPS="${CHAOS_ENQ_RPS:-1}" \
      "$LT_DIR/k6run.sh" "$scen" "$CHAOS_OUT/$name" >"$CHAOS_OUT/$name.log" 2>&1
  ) &
  LT_K6_PID=$!
}

lt_k6_line() { # lt_k6_line <summary.json>
  [[ -f "$1" ]] || { echo "no k6 summary"; return; }
  jq -r '.metrics | "reqs=\(.http_reqs.values.count) failed=\((.http_req_failed.values.rate*10000|round)/100)% p50=\(.http_req_duration.values.med|round)ms p95=\(.http_req_duration.values["p(95)"]|round)ms p99=\(.http_req_duration.values["p(99)"]|round)ms max=\(.http_req_duration.values.max|round)ms"' "$1"
}
