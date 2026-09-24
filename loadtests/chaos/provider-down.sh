#!/usr/bin/env bash
# Chaos (iii): AI provider down, under browse load.
#   Phase A — blank keys (the default stack): the image tool has no provider at all and
#             fails fast → refund. (Text tools render the offline template and COMPLETE
#             with blank keys, so they are not a "provider down" case.)
#   Phase B — provider-mode down: workers get a fake Gemini key, the jail answers 502 at
#             once → every LLM job (essay) fails fast → refund.
# Expect: every job terminal within FAIL_SEC, exactly one charge + one refund each, the web
# stays responsive (k6 browse p95 / error rate), nothing leaves the laptop (jail log).
set -uo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
# shellcheck source=../lib/chaos.sh
. "$LT_DIR/lib/chaos.sh"
lt_require_stack

N="${N:-30}"
FAIL_SEC="${FAIL_SEC:-120}"
P95_MS="${P95_MS:-500}"
echo "== chaos provider-down ($(cat "$STATE_DIR/label"); $N jobs per phase under browse load)"
"$LT_DIR/stack.sh" provider-mode blank
lt_k6_bg provider-down-k6 "${K6_SEC:-60}s" browse

phase() { # phase <name> <slug> <tail_offset>
  local name="$1" slug="$2" off="$3" t0 ids left slow
  t0=$SECONDS
  mapfile -t ids < <(
    for ((k = 0; k < N; k += 5)); do
      for ((j = k; j < k + 5 && j < N; j++)); do lt_enqueue 1 "$slug" $((off + j)) & done
      wait
    done
  )
  if ((${#ids[@]} == 0)); then lt_check "${name}_enqueue" 0 "no job accepted"; return; fi
  left="$(lt_wait_terminal "$FAIL_SEC" "${ids[@]}")"
  lt_check "${name}_jobs_terminal" "$([[ "$left" == 0 ]] && echo 1 || echo 0)" "${#ids[@]} jobs, still open after $((SECONDS - t0)) s: $left"
  local list
  list="$(printf "'%s'," "${ids[@]}" | sed 's/,$//')"
  local st
  st="$(lt_sql "select count(*) filter (where status='FAILED') || '/' || count(*) from generations where id in ($list)")"
  lt_check "${name}_jobs_failed_not_faked" "$([[ "${st%/*}" == "${#ids[@]}" ]] && echo 1 || echo 0)" "FAILED/total: $st"
  slow="$(lt_sql "select coalesce(round(percentile_cont(0.95) within group (order by extract(epoch from finished_at - created_at))::numeric, 1), 0)
                    from generations where id in ($list) and finished_at is not null")"
  echo "INFO  $name enqueue→failed p95: ${slow}s"
  lt_check_jobs_money "$name" "${ids[@]}"
}

jail0="$(wc -l <"$STATE_DIR/jail.csv")"
phase blank_image rasm 300
"$LT_DIR/stack.sh" provider-mode down
phase down_llm essay 400
jail1="$(wc -l <"$STATE_DIR/jail.csv")"
echo "INFO  jail proxy intercepted $((jail1 - jail0)) outbound provider call(s); targets: $(tail -n $((jail1 - jail0)) "$STATE_DIR/jail.csv" | cut -d, -f3 | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
lt_check provider_calls_jailed "$([[ $((jail1 - jail0)) -gt 0 ]] && echo 1 || echo 0)" "fake-key LLM calls reached the local jail (proves they did not reach the internet)"
"$LT_DIR/stack.sh" provider-mode blank

wait "$LT_K6_PID"
k="$CHAOS_OUT/provider-down-k6/k6-browse.json"
echo "INFO  k6 browse during experiment — $(lt_k6_line "$k")"
if [[ -f "$k" ]]; then
  p95="$(jq -r '.metrics.http_req_duration.values["p(95)"] | round' "$k")"
  fr="$(jq -r '.metrics.http_req_failed.values.rate' "$k")"
  lt_check web_responsive "$(awk -v p="$p95" -v f="$fr" -v l="$P95_MS" 'BEGIN{print (p < l && f < 0.01) ? 1 : 0}')" "browse p95 ${p95} ms (< ${P95_MS}), error rate $fr (< 0.01)"
else
  lt_check web_responsive 0 "no k6 summary"
fi

"$LT_DIR/invariants.sh" --wait-idle 120 | sed 's/^/  /'
[[ "${PIPESTATUS[0]}" == 0 ]] || { LT_FAILS=$((LT_FAILS + 1)); echo "FAIL  invariants_after — see above"; }
echo "== provider-down: $LT_FAILS failed check(s)"
exit "$LT_FAILS"
