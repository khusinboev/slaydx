#!/usr/bin/env bash
# Builds summary.md from a results directory (k6-*.json, metrics*.csv, invariants-*.txt, chaos-*.txt).
#   loadtests/lib/summarize.sh <results_dir>  > summary.md
set -uo pipefail
dir="${1:?results dir}"

echo "# Load test — $(basename "$dir")"
echo
if [[ -f "$dir/run.env" ]]; then
  echo '```'
  cat "$dir/run.env"
  echo '```'
  echo
fi
echo "Numbers are laptop-relative (k6, Postgres, web and workers share one 12-core machine); compare runs, not absolutes."
echo

echo "## Scenarios"
echo
echo "| scenario | requests | req/s | p50 ms | p95 ms | p99 ms | max ms | failed % | data in MB | thresholds |"
echo "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"
for f in "$dir"/k6-*.json; do
  [[ -f "$f" ]] || continue
  n="$(basename "$f" .json)"
  n="${n#k6-}"
  jq -r --arg n "$n" '
    .metrics as $m
    | ([$m | to_entries[] | select(.value.thresholds) | .value.thresholds | to_entries[] | select(.value.ok | not) | .key] | length) as $bad
    | "| \($n) | \($m.http_reqs.values.count) | \($m.http_reqs.values.rate*10|round/10) | \($m.http_req_duration.values.med*10|round/10) | \($m.http_req_duration.values["p(95)"]*10|round/10) | \($m.http_req_duration.values["p(99)"]*10|round/10) | \($m.http_req_duration.values.max|round) | \($m.http_req_failed.values.rate*10000|round/100) | \($m.data_received.values.count/1048576*10|round/10) | \(if $bad == 0 then "ok" else "\($bad) crossed" end) |"' "$f"
done
echo

echo "### Per endpoint / per scenario (submetrics with thresholds)"
echo
echo "| run | metric | p50 ms | p95 ms | p99 ms | threshold |"
echo "|---|---|---:|---:|---:|---|"
for f in "$dir"/k6-*.json; do
  [[ -f "$f" ]] || continue
  n="$(basename "$f" .json)"
  jq -r --arg n "${n#k6-}" '
    .metrics | to_entries[] | select(.key | startswith("http_req_duration{")) | select(.key != "http_req_duration{expected_response:true}")
    | "| \($n) | `\(.key | sub("^http_req_duration"; ""))` | \(.value.values.med*10|round/10) | \(.value.values["p(95)"]*10|round/10) | \(.value.values["p(99)"]*10|round/10) | \([.value.thresholds // {} | to_entries[] | "\(.key) \(if .value.ok then "ok" else "CROSSED" end)"] | join(", ")) |"' "$f"
done
echo

echo "### Outcome counters"
echo
echo "| run | counter | value |"
echo "|---|---|---:|"
for f in "$dir"/k6-*.json; do
  [[ -f "$f" ]] || continue
  n="$(basename "$f" .json)"
  jq -r --arg n "${n#k6-}" '
    .metrics | to_entries[] | select(.key | test("^(enq_|upload_|cacheable_|nostore_)"))
    | "| \($n) | \(.key) | \(if .value.values.count != null then .value.values.count else "\(.value.values.rate*1000|round/10) %" end) |"' "$f"
done
echo

for m in "$dir"/metrics*.csv; do
  [[ -f "$m" ]] || continue
  echo "## Resources — $(basename "$m")"
  echo
  echo "| series | peak | last |"
  echo "|---|---:|---:|"
  awk -F, 'NR > 1 {
      if ($2 == "rss_kb") { k = "RSS MB " $3; v = $4 / 1024 }
      else if ($2 == "pg_conn") { split($3, p, "|"); k = "pg conns " p[1] " (" p[2] ")"; v = $4 }
      else if ($2 == "queue") { k = "queue " $3; v = $4 }
      else if ($2 == "pg_mem_mib") { k = "postgres container MB"; v = $4 }
      else if ($2 == "pg_cpu_pct") { k = "postgres container CPU %"; v = $4 }
      else if ($2 == "restarts") { k = "restarts " $3; v = $4 }
      else next
      if (!(k in peak) || v + 0 > peak[k] + 0) peak[k] = v
      last[k] = v
    }
    $2 == "pg_conn" { tot[$1] += $4 }
    END {
      for (t in tot) if (tot[t] > maxtot) maxtot = tot[t]
      for (k in peak) printf "| %s | %.0f | %.0f |\n", k, peak[k], last[k]
      printf "| pg conns TOTAL (all apps/states) | %d | |\n", maxtot
    }' "$m" | sort
  echo
done

if compgen -G "$dir/invariants-*.txt" >/dev/null; then
  echo "## Data invariants after each scenario"
  echo
  echo "| after | PASS | FAIL | failed checks |"
  echo "|---|---:|---:|---|"
  for f in "$dir"/invariants-*.txt; do
    n="$(basename "$f" .txt)"
    echo "| ${n#invariants-after-} | $(grep -c '^PASS' "$f") | $(grep -c '^FAIL' "$f") | $(grep '^FAIL' "$f" | cut -c7- | cut -d' ' -f1 | tr '\n' ' ') |"
  done
  echo
fi

if compgen -G "$dir/chaos-*.txt" >/dev/null; then
  echo "## Chaos"
  echo
  echo "| experiment | PASS | FAIL | failed checks |"
  echo "|---|---:|---:|---|"
  for f in "$dir"/chaos-*.txt; do
    n="$(basename "$f" .txt)"
    echo "| ${n#chaos-} | $(grep -c 'PASS  ' "$f") | $(grep -c 'FAIL  ' "$f") | $(grep 'FAIL  ' "$f" | sed 's/^ *FAIL  //' | cut -d' ' -f1 | tr '\n' ' ') |"
  done
  echo
  echo "Details (FAIL and INFO lines):"
  echo
  echo '```'
  for f in "$dir"/chaos-*.txt; do
    echo "# $(basename "$f")"
    grep -E '^(FAIL|INFO|==)' "$f" | cut -c1-240
  done
  echo '```'
fi
