# Load test — after

```
label=after
repo=/home/adhambek/projects/pythons/slaydbot/slaydx/.claude/worktrees/loadtest-after
commit=cb7aee3 W4 gate: update 5 stale assertions to intended W4 contracts (telegram transient 
profile=full scenarios=[browse poll enqueue downloads uploads mixed] chaos=[pg-restart worker-sigkill provider-down worker-sigterm]
seed=--users 2000 --gen-users 400 --gens 3 workers=2 x concurrency 4 job_timeout_ms=90000
k6=grafana/k6@sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603 cpus=3 mem=2g
host=12 cores, 14 GB RAM, 5 GB available at start; date=2026-09-24T05:10:01Z
pg_profile=tuned
```

Numbers are laptop-relative (k6, Postgres, web and workers share one 12-core machine); compare runs, not absolutes.

## Scenarios

| scenario | requests | req/s | p50 ms | p95 ms | p99 ms | max ms | failed % | data in MB | thresholds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| browse | 129382 | 513.5 | 1.5 | 3.6 | 5.6 | 36 | 0 | 2758.8 | ok |
| downloads | 128088 | 508.7 | 11.7 | 77.1 | 90 | 149 | 0 | 3875.1 | ok |
| enqueue | 3874 | 20.4 | 9.8 | 16.9 | 20.5 | 47 | 0 | 5.2 | ok |
| mixed | 166682 | 657.2 | 3.2 | 12.1 | 22.6 | 178 | 0 | 3658.3 | ok |
| poll | 61649 | 243.2 | 3.6 | 6.3 | 10.7 | 135 | 0 | 117.6 | ok |
| uploads | 8554 | 33.8 | 5.5 | 17.5 | 24.1 | 45 | 0 | 11.3 | ok |

### Per endpoint / per scenario (submetrics with thresholds)

| run | metric | p50 ms | p95 ms | p99 ms | threshold |
|---|---|---:|---:|---:|---|
| browse | `{name:GET /uz}` | 1.3 | 2.7 | 4.1 | p(95)<800 ok |
| browse | `{name:GET /api/auth/session}` | 1.7 | 4.2 | 6.3 | p(95)<300 ok |
| downloads | `{name:GET /thumb?v=}` | 12.2 | 81.9 | 92.2 | p(95)<300 ok |
| downloads | `{name:GET /assets/:id}` | 10 | 67.5 | 78.6 | p(95)<300 ok |
| downloads | `{name:GET /thumb}` | 12 | 79.7 | 92 | p(95)<300 ok |
| downloads | `{name:GET /file}` | 13.8 | 75.9 | 89.8 | p(95)<500 ok |
| enqueue | `{name:POST /api/generations}` | 9.8 | 16.9 | 20.5 | p(95)<1000 ok |
| mixed | `{scenario:downloads}` | 4.4 | 14.3 | 25.3 | p(95)<500 ok |
| mixed | `{scenario:uploads}` | 6.5 | 23.2 | 45.6 | p(95)<1500 ok |
| mixed | `{scenario:enqueue}` | 13 | 45.1 | 76.8 | p(95)<1000 ok |
| mixed | `{scenario:browse}` | 1.7 | 5.9 | 10.2 | p(95)<800 ok |
| mixed | `{scenario:poll}` | 5 | 15.8 | 27.9 | p(95)<300 ok |
| poll | `{name:GET /api/generations/:id}` | 3.7 | 6.4 | 10.7 | p(95)<300 ok |
| poll | `{name:GET /api/generations}` | 2.4 | 4.8 | 9.8 | p(95)<500 ok |
| uploads | `{name:POST /api/uploads/photo}` | 5.5 | 17.5 | 24.1 | p(95)<1500 ok |

### Outcome counters

| run | counter | value |
|---|---|---:|
| downloads | nostore_thumb_unversioned | 100 % |
| downloads | cacheable_asset | 100 % |
| downloads | cacheable_thumb_versioned | 100 % |
| enqueue | enq_429_queue_full | 2341 |
| enqueue | enq_429_rate_limit | 6 |
| enqueue | enq_network_error | 0 |
| enqueue | enq_429_user_inflight | 1 |
| enqueue | enq_5xx | 0 |
| enqueue | enq_202 | 1526 |
| mixed | nostore_thumb_unversioned | 100 % |
| mixed | upload_413_quota | 258 |
| mixed | enq_202 | 751 |
| mixed | upload_200 | 496 |
| mixed | cacheable_asset | 100 % |
| mixed | cacheable_thumb_versioned | 100 % |
| mixed | upload_429_rate_limit | 1293 |
| uploads | upload_200 | 2000 |
| uploads | upload_429_rate_limit | 6554 |
| uploads | upload_other | 0 |

## Resources — metrics-browse.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 1 | 1 |
| pg conns slaydx-web@pop-os (idle) | 7 | 5 |
| pg conns slaydx-worker@pop-os (idle) | 3 | 3 |
| pg conns TOTAL (all apps/states) | 10 | |
| postgres container CPU % | 14 | 1 |
| postgres container MB | 252 | 247 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 320 | 320 |
| RSS MB worker-1 | 187 | 145 |
| RSS MB worker-2 | 189 | 143 |

## Resources — metrics-chaos-pg-restart.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 1 | 1 |
| pg conns slaydx-web@pop-os (idle) | 10 | 3 |
| pg conns slaydx-worker@pop-os (idle) | 5 | 5 |
| pg conns slaydx-worker@pop-os (idle in transaction) | 1 | 1 |
| pg conns TOTAL (all apps/states) | 15 | |
| postgres container CPU % | 8 | 0 |
| postgres container MB | 340 | 90 |
| queue IN_PROGRESS | 1 | 1 |
| queue oldest_queued_s | 12 | 0 |
| queue QUEUED | 1 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 291 | 291 |
| RSS MB worker-1 | 195 | 182 |
| RSS MB worker-2 | 194 | 181 |

## Resources — metrics-chaos-provider-down.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 2 | 2 |
| pg conns slaydx-web@pop-os (idle) | 6 | 2 |
| pg conns slaydx-web@pop-os (idle in transaction) | 1 | 1 |
| pg conns slaydx-worker@pop-os (idle) | 17 | 2 |
| pg conns TOTAL (all apps/states) | 23 | |
| postgres container CPU % | 33 | 33 |
| postgres container MB | 124 | 80 |
| queue IN_PROGRESS | 2 | 0 |
| queue oldest_queued_s | 3 | 0 |
| queue QUEUED | 20 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 5 | 5 |
| restarts worker-2 | 4 | 4 |
| RSS MB jail | 49 | 49 |
| RSS MB web | 295 | 295 |
| RSS MB worker-1 | 150 | 122 |
| RSS MB worker-2 | 148 | 121 |

## Resources — metrics-chaos-worker-sigkill.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (idle) | 2 | 1 |
| pg conns slaydx-worker@pop-os (idle) | 10 | 2 |
| pg conns TOTAL (all apps/states) | 11 | |
| postgres container CPU % | 30 | 30 |
| postgres container MB | 94 | 80 |
| queue IN_PROGRESS | 6 | 0 |
| queue oldest_queued_s | 129 | 0 |
| queue QUEUED | 2 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 3 | 3 |
| restarts worker-2 | 2 | 2 |
| RSS MB jail | 49 | 49 |
| RSS MB web | 291 | 291 |
| RSS MB worker-1 | 151 | 151 |
| RSS MB worker-2 | 184 | 150 |

## Resources — metrics-chaos-worker-sigterm.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (idle) | 4 | 2 |
| pg conns slaydx-worker@pop-os (active) | 1 | 1 |
| pg conns slaydx-worker@pop-os (idle) | 19 | 2 |
| pg conns TOTAL (all apps/states) | 23 | |
| postgres container CPU % | 13 | 1 |
| postgres container MB | 146 | 101 |
| queue IN_PROGRESS | 8 | 0 |
| queue oldest_queued_s | 49 | 0 |
| queue QUEUED | 37 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 8 | 8 |
| restarts worker-2 | 6 | 6 |
| RSS MB jail | 49 | 48 |
| RSS MB web | 289 | 289 |
| RSS MB worker-1 | 153 | 149 |
| RSS MB worker-2 | 152 | 149 |

## Resources — metrics-downloads.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 5 | 1 |
| pg conns slaydx-web@pop-os (idle) | 10 | 10 |
| pg conns slaydx-worker@pop-os (idle) | 5 | 3 |
| pg conns TOTAL (all apps/states) | 13 | |
| postgres container CPU % | 104 | 28 |
| postgres container MB | 289 | 288 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 334 | 334 |
| RSS MB worker-1 | 189 | 189 |
| RSS MB worker-2 | 181 | 181 |

## Resources — metrics-enqueue.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 1 | 1 |
| pg conns slaydx-web@pop-os (idle) | 7 | 1 |
| pg conns slaydx-web@pop-os (idle in transaction) | 1 | 1 |
| pg conns slaydx-worker@pop-os (active) | 2 | 1 |
| pg conns slaydx-worker@pop-os (idle) | 5 | 4 |
| pg conns TOTAL (all apps/states) | 10 | |
| postgres container CPU % | 36 | 6 |
| postgres container MB | 270 | 270 |
| queue IN_PROGRESS | 1 | 0 |
| queue oldest_queued_s | 3 | 0 |
| queue QUEUED | 37 | 3 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 253 | 253 |
| RSS MB worker-1 | 194 | 189 |
| RSS MB worker-2 | 193 | 189 |

## Resources — metrics-mixed.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 3 | 2 |
| pg conns slaydx-web@pop-os (idle) | 10 | 10 |
| pg conns slaydx-web@pop-os (idle in transaction) | 1 | 1 |
| pg conns slaydx-worker@pop-os (active) | 1 | 1 |
| pg conns slaydx-worker@pop-os (idle) | 6 | 5 |
| pg conns slaydx-worker@pop-os (idle in transaction) | 2 | 2 |
| pg conns TOTAL (all apps/states) | 16 | |
| postgres container CPU % | 86 | 0 |
| postgres container MB | 350 | 348 |
| queue IN_PROGRESS | 1 | 0 |
| queue oldest_queued_s | 1 | 0 |
| queue QUEUED | 4 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 352 | 352 |
| RSS MB worker-1 | 195 | 194 |
| RSS MB worker-2 | 194 | 185 |

## Resources — metrics-poll.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 3 | 1 |
| pg conns slaydx-web@pop-os (idle) | 10 | 7 |
| pg conns slaydx-worker@pop-os (idle) | 3 | 3 |
| pg conns TOTAL (all apps/states) | 13 | |
| postgres container CPU % | 52 | 1 |
| postgres container MB | 264 | 255 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 299 | 299 |
| RSS MB worker-1 | 146 | 146 |
| RSS MB worker-2 | 143 | 143 |

## Resources — metrics-uploads.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 2 | 1 |
| pg conns slaydx-web@pop-os (idle) | 10 | 3 |
| pg conns slaydx-worker@pop-os (idle) | 3 | 3 |
| pg conns TOTAL (all apps/states) | 13 | |
| postgres container CPU % | 18 | 0 |
| postgres container MB | 326 | 318 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 289 | 289 |
| RSS MB worker-1 | 189 | 185 |
| RSS MB worker-2 | 181 | 181 |

## Data invariants after each scenario

| after | PASS | FAIL | failed checks |
|---|---:|---:|---|
| browse | 11 | 0 |  |
| downloads | 11 | 0 |  |
| enqueue | 11 | 0 |  |
| mixed | 11 | 0 |  |
| poll | 11 | 0 |  |
| uploads | 11 | 0 |  |

## Chaos

| experiment | PASS | FAIL | failed checks |
|---|---:|---:|---|
| pg-restart | 18 | 0 |  |
| provider-down | 19 | 0 |  |
| worker-sigkill | 17 | 0 |  |
| worker-sigterm | 17 | 0 |  |

Details (FAIL and INFO lines):

```
# chaos-pg-restart.txt
== chaos pg-restart (after; mixed load 90s, postgres down 10s at +20s)
INFO  postgres unavailable for 10.9 s
INFO  non-200 /api/health probes during the outage: 21 (expected: health reports the DB)
INFO  k6 mixed during experiment — reqs=3153 failed=6.22% p50=4ms p95=9ms p99=18ms max=51ms
== pg-restart: 0 failed check(s)
# chaos-provider-down.txt
== chaos provider-down (after; 30 jobs per phase under browse load)
INFO  blank_image enqueue→failed p95: 2.4s
INFO  blank_image states — 30× FAILED attempts=1 refunds=1
INFO  down_llm enqueue→failed p95: 4.2s
INFO  down_llm states — 30× FAILED attempts=1 refunds=1
INFO  jail proxy intercepted 10 outbound provider call(s); targets:  10 generativelanguage.googleapis.com:443;
INFO  k6 browse during experiment — reqs=2072 failed=0% p50=2ms p95=4ms p99=4ms max=19ms
== provider-down: 0 failed check(s)
# chaos-worker-sigkill.txt
== chaos worker-sigkill (after; wait ≤330s for reclaim)
INFO  worker-1 pid 1112128 holds 2 job(s) mid-flight: 043515dd-d451-457d-bed6-c3bc68444303 089075f7-a929-4382-babe-d3764e6d2827
INFO  killed jobs re-run by another claim (attempts ≥ 2): 2 / 2
INFO  killed states — 2× FAILED attempts=2 refunds=1
INFO  all_enqueued states — 4× FAILED attempts=1 refunds=1; 2× FAILED attempts=2 refunds=1
INFO  jail proxy hits so far: 12 (all answered locally, nothing forwarded)
== worker-sigkill: 0 failed check(s)
# chaos-worker-sigterm.txt
== chaos worker-sigterm (after; release expected ≤ 35 s)
INFO  worker-1 pid 1124041 holds 4 job(s): 7d8b1a49-0d3a-411b-9e09-0c719a0cedfb 57410339-a7c4-42b0-867e-0cb4d1ca533e 1a2891c9-8122-48b2-9f3f-28e9284f7e26 53d0eb48-73c4-4aad-b8a4-e23578d4c17c
INFO  worker-1 log: {"ts":"2026-09-24T05:43:39.773Z","level":"info","msg":"[worker] SIGTERM: to'xtatilmoqda..."}
INFO  worker-1 log: {"ts":"2026-09-24T05:43:39.773Z","level":"info","msg":"[worker] to'xtatilmoqda: 4 ta ish tugashi kutilmoqda (≤ 20 s)","jobIds":["1a2891c9-8122-48b2-9f3f-28e9284f7e26","53d0eb48-73c4-4aad-b8a4-e23578d4c17c","7d8b1a49-0d
INFO  worker-1 log: {"ts":"2026-09-24T05:43:59.781Z","level":"warn","msg":"[worker] to'xtatilmoqda: 4 ta tugallanmagan ish navbatga qaytarildi (urinish sanalmadi, boshqa worker darhol oladi): 57410339-a7c4-42b0-867e-0cb4d1ca533e, 7d8b1a49-0
INFO  sigtermed states — 4× FAILED attempts=1 refunds=1
INFO  all_enqueued states — 6× FAILED attempts=1 refunds=1
INFO  k6 mixed during experiment — reqs=2216 failed=0% p50=4ms p95=10ms p99=18ms max=47ms
== worker-sigterm: 0 failed check(s)
```
