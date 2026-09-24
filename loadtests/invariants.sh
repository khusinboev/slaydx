#!/usr/bin/env bash
# Data-integrity checks on the load-test DB. Prints PASS/FAIL lines; exit code = #FAIL.
#   loadtests/invariants.sh [--wait-idle SEC]
# --wait-idle: first wait (≤ SEC) until no job is QUEUED/IN_PROGRESS, so in-flight work
# from the last scenario can finish (or be reclaimed) before money is counted.
set -uo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

wait_idle=0
[[ "${1:-}" == --wait-idle ]] && wait_idle="${2:-0}"
if ((wait_idle > 0)); then
  deadline=$((SECONDS + wait_idle))
  while ((SECONDS < deadline)); do
    busy="$(lt_sql "select count(*) from generations where status in ('QUEUED','IN_PROGRESS')" 2>/dev/null || echo "?")"
    [[ "$busy" == 0 ]] && break
    sleep 2
  done
  echo "INFO  idle-wait — busy jobs left: $(lt_sql "select count(*) from generations where status in ('QUEUED','IN_PROGRESS')")"
fi

v() { lt_sql "$1" 2>&1 | tr -d ' '; }
c() { # c <name> <sql returning a count that must be 0> <what it means>
  local n
  n="$(v "$2")"
  if [[ "$n" == 0 ]]; then lt_check "$1" 1 "$3: 0"; else lt_check "$1" 0 "$3: $n"; fi
}

echo "INFO  jobs by status — $(lt_sql "select coalesce(string_agg(status||'='||n, ' '), 'none') from (select status, count(*) n from generations group by 1 order by 1) s")"
echo "INFO  ledger rows — $(lt_sql "select coalesce(string_agg(kind||'='||n, ' '), 'none') from (select kind, count(*) n from transactions group by 1 order by 1) s")"

c ledger_matches_wallet \
  "select count(*) from users u left join (select user_id, sum(points_delta) p, sum(quota_delta) q, sum(balance_delta) b from transactions group by user_id) t on t.user_id = u.id
    where u.points <> coalesce(t.p,0) or u.quota <> coalesce(t.q,0) or u.balance <> coalesce(t.b,0)" \
  "users whose points/quota/balance != sum(transactions)"
c no_negative_wallet "select count(*) from users where points < 0 or quota < 0 or balance < 0" "users with a negative wallet"
c no_double_charge "select count(*) from (select reference from transactions where kind='charge' and reference is not null group by 1 having count(*) > 1) x" "references charged twice"
c no_double_refund "select count(*) from (select reference from transactions where kind='refund' and reference is not null group by 1 having count(*) > 1) x" "references refunded twice"
c refund_le_charge \
  "select count(*) from transactions r join transactions ch on ch.kind='charge' and ch.reference = r.reference
    where r.kind='refund' and (r.points_delta + r.quota_delta + r.balance_delta) > -(ch.points_delta + ch.quota_delta + ch.balance_delta)" \
  "refunds larger than their charge"
c refund_has_charge "select count(*) from transactions r where r.kind='refund' and not exists (select 1 from transactions ch where ch.kind='charge' and ch.reference = r.reference)" "refunds without a charge"
c paid_job_has_charge "select count(*) from generations g where g.price > 0 and not exists (select 1 from transactions t where t.kind='charge' and t.reference = g.id::text)" "paid jobs without a charge row"
c charge_has_job \
  "select count(*) from transactions t where t.kind='charge' and t.reference ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not exists (select 1 from generations g where g.id::text = t.reference)" \
  "charges whose job row is missing"
c failed_job_refunded \
  "select count(*) from generations g where g.status='FAILED' and g.price > 0 and not exists (select 1 from transactions t where t.kind='refund' and t.reference = g.id::text)" \
  "FAILED paid jobs without a refund"
c completed_has_file \
  "select count(*) from generations g where g.status='COMPLETED' and not exists (select 1 from generation_files f where f.generation_id = g.id)" \
  "COMPLETED jobs without a stored file"
# Lease = budget (or WORKER_JOB_TIMEOUT_MS for budget_ms=0) + 30 s; +90 s for the 60 s housekeeping tick.
c no_stuck_in_progress \
  "select count(*) from generations where status='IN_PROGRESS'
    and locked_at < now() - ((case when budget_ms > 0 then budget_ms/1000 else $((JOB_TIMEOUT_MS / 1000)) end) + 120 || ' seconds')::interval" \
  "IN_PROGRESS jobs past lease + housekeeping"
echo "INFO  completed-but-refunded (partial delivery refunds are legal) — $(v "select count(*) from generations g where g.status='COMPLETED' and exists (select 1 from transactions t where t.kind='refund' and t.reference = g.id::text)")"
exit "$LT_FAILS"
