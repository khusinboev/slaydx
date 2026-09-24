#!/usr/bin/env bash
# Run one k6 scenario (Docker grafana/k6, --network host) against the running stack.
#   loadtests/k6run.sh <browse|poll|enqueue|downloads|uploads|mixed> [out_dir]
# Env passed through to k6: PROFILE (smoke|full), VUS, DURATION, RAMP, BASE_RPS, BURST_FACTOR,
# STEADY, BURST, MIX_VUS, ENQ_RPS, UPLOAD_KB, UPLOAD_USERS. Summary: <out_dir>/k6-<name>.json.
# Exit code is k6's (99 = a threshold was crossed; the run itself still completed).
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"
name="${1:?scenario name}"
out="${2:-$RESULTS_DIR/adhoc}"
tokens="${TOKENS_FILE:-$STATE_DIR/tokens.json}"
[[ -f "$LT_DIR/k6/$name.js" ]] || lt_die "no scenario k6/$name.js"
[[ -f "$tokens" ]] || lt_die "no tokens file $tokens (run seed.sh)"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
tdir="$(cd "$(dirname "$tokens")" && pwd)"

envs=()
for v in PROFILE VUS DURATION RAMP BASE_RPS BURST_FACTOR STEADY BURST MIX_VUS ENQ_RPS UPLOAD_KB UPLOAD_USERS; do
  [[ -n "${!v:-}" ]] && envs+=(-e "$v=${!v}")
done
lt_log "k6 $name (profile ${PROFILE:-smoke}) -> $out/k6-$name.json"
set +e
docker run --rm --network host --name "slaydx-loadtest-k6-$name-$$" \
  -u "$(id -u):$(id -g)" --cpus "$K6_CPUS" --memory "$K6_MEM" \
  -v "$LT_DIR/k6:/scripts:ro" -v "$tdir:/data:ro" -v "$out:/out" \
  -e "BASE_URL=$BASE_URL" -e "TOKENS=/data/$(basename "$tokens")" "${envs[@]}" \
  "$K6_IMAGE" run --quiet --no-usage-report "/scripts/$name.js" 2>&1 | grep -v '^\s*$' | tail -n 40
rc="${PIPESTATUS[0]}"
set -e
[[ -f "$out/k6-$name.json" ]] || lt_die "k6 $name produced no summary (rc=$rc)"
exit "$rc"
