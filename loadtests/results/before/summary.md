# Load test — before

```
label=before
repo=/home/adhambek/projects/pythons/slaydbot/slaydx/.claude/worktrees/loadtest-main
commit=76ddf91 docs: holat.md — rasm → Gemini lite, slayd poli prod'da (e380940)
profile=full scenarios=[browse poll enqueue downloads uploads mixed] chaos=[pg-restart worker-sigkill provider-down worker-sigterm]
seed=--users 2000 --gen-users 400 --gens 3 workers=2 x concurrency 4 job_timeout_ms=90000
k6=grafana/k6@sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603 cpus=3 mem=2g
host=12 cores, 14 GB RAM, 5 GB available at start; date=2026-09-24T04:25:35Z
pg_profile=default
```

Numbers are laptop-relative (k6, Postgres, web and workers share one 12-core machine); compare runs, not absolutes.

## Scenarios

| scenario | requests | req/s | p50 ms | p95 ms | p99 ms | max ms | failed % | data in MB | thresholds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| browse | 129434 | 512.7 | 1.5 | 3.7 | 6 | 162 | 0 | 2802.3 | ok |
| downloads | 136080 | 541.9 | 3.5 | 9.2 | 15 | 56 | 0 | 4109.6 | 2 crossed |
| enqueue | 3874 | 20.4 | 8.7 | 14.4 | 21 | 48 | 0 | 4.8 | ok |
| mixed | 167091 | 658.6 | 2.8 | 9.9 | 18.1 | 88 | 0 | 3691.5 | ok |
| poll | 61802 | 243 | 3.4 | 5.8 | 8.8 | 36 | 0 | 113.1 | ok |
| uploads | 8567 | 33.9 | 4.9 | 10 | 16.5 | 70 | 0 | 10.9 | ok |

### Per endpoint / per scenario (submetrics with thresholds)

| run | metric | p50 ms | p95 ms | p99 ms | threshold |
|---|---|---:|---:|---:|---|
| browse | `{name:GET /uz}` | 1.3 | 2.8 | 4.5 | p(95)<800 ok |
| browse | `{name:GET /api/auth/session}` | 1.7 | 4.3 | 6.7 | p(95)<300 ok |
| downloads | `{name:GET /thumb?v=}` | 3.2 | 8.8 | 14.4 | p(95)<300 ok |
| downloads | `{name:GET /file}` | 4.3 | 10.7 | 17.7 | p(95)<500 ok |
| downloads | `{name:GET /assets/:id}` | 3.5 | 8.8 | 13.8 | p(95)<300 ok |
| downloads | `{name:GET /thumb}` | 3.1 | 8.3 | 13.8 | p(95)<300 ok |
| enqueue | `{name:POST /api/generations}` | 8.7 | 14.4 | 21 | p(95)<1000 ok |
| mixed | `{scenario:enqueue}` | 9.1 | 26.1 | 51.7 | p(95)<1000 ok |
| mixed | `{scenario:uploads}` | 5.3 | 16.2 | 27.7 | p(95)<1500 ok |
| mixed | `{scenario:poll}` | 4.3 | 13.6 | 24.8 | p(95)<300 ok |
| mixed | `{scenario:downloads}` | 3.8 | 11.7 | 20.5 | p(95)<500 ok |
| mixed | `{scenario:browse}` | 1.6 | 5.5 | 9.8 | p(95)<800 ok |
| poll | `{name:GET /api/generations}` | 2.1 | 4.2 | 6.6 | p(95)<500 ok |
| poll | `{name:GET /api/generations/:id}` | 3.5 | 5.9 | 9 | p(95)<300 ok |
| uploads | `{name:POST /api/uploads/photo}` | 4.9 | 10 | 16.5 | p(95)<1500 ok |

### Outcome counters

| run | counter | value |
|---|---|---:|
| downloads | cacheable_asset | 0 % |
| downloads | cacheable_thumb_versioned | 0 % |
| downloads | nostore_thumb_unversioned | 100 % |
| enqueue | enq_5xx | 0 |
| enqueue | enq_202 | 3870 |
| enqueue | enq_network_error | 0 |
| enqueue | enq_429_rate_limit | 4 |
| mixed | upload_200 | 1000 |
| mixed | cacheable_asset | 0 % |
| mixed | enq_202 | 750 |
| mixed | upload_429_rate_limit | 1029 |
| mixed | cacheable_thumb_versioned | 0 % |
| mixed | nostore_thumb_unversioned | 100 % |
| uploads | upload_200 | 1000 |
| uploads | upload_429_rate_limit | 7567 |
| uploads | upload_other | 0 |

## Resources — metrics-browse.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 1 | 1 |
| pg conns slaydx (idle) | 12 | 7 |
| pg conns TOTAL (all apps/states) | 12 | |
| postgres container CPU % | 26 | 0 |
| postgres container MB | 217 | 206 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 322 | 322 |
| RSS MB worker-1 | 184 | 143 |
| RSS MB worker-2 | 183 | 142 |

## Resources — metrics-chaos-pg-restart.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (idle) | 12 | 5 |
| pg conns TOTAL (all apps/states) | 12 | |
| postgres container CPU % | 7 | 1 |
| postgres container MB | 215 | 74 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 12 | 0 |
| queue QUEUED | 3 | 3 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 281 | 281 |
| RSS MB worker-1 | 192 | 182 |
| RSS MB worker-2 | 190 | 181 |

## Resources — metrics-chaos-provider-down.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 2 | 1 |
| pg conns slaydx (idle) | 14 | 2 |
| pg conns TOTAL (all apps/states) | 14 | |
| postgres container CPU % | 10 | 0 |
| postgres container MB | 95 | 68 |
| queue IN_PROGRESS | 8 | 0 |
| queue oldest_queued_s | 70 | 0 |
| queue QUEUED | 28 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 5 | 5 |
| restarts worker-2 | 4 | 4 |
| RSS MB jail | 56 | 56 |
| RSS MB web | 287 | 287 |
| RSS MB worker-1 | 147 | 118 |
| RSS MB worker-2 | 150 | 145 |

## Resources — metrics-chaos-worker-sigkill.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (idle) | 13 | 3 |
| pg conns TOTAL (all apps/states) | 13 | |
| postgres container CPU % | 11 | 0 |
| postgres container MB | 89 | 70 |
| queue IN_PROGRESS | 6 | 0 |
| queue oldest_queued_s | 128 | 0 |
| queue QUEUED | 4 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 3 | 3 |
| restarts worker-2 | 2 | 2 |
| RSS MB jail | 49 | 49 |
| RSS MB web | 281 | 281 |
| RSS MB worker-1 | 182 | 117 |
| RSS MB worker-2 | 181 | 143 |

## Resources — metrics-chaos-worker-sigterm.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 1 | 1 |
| pg conns slaydx (idle) | 15 | 2 |
| pg conns TOTAL (all apps/states) | 15 | |
| postgres container CPU % | 10 | 8 |
| postgres container MB | 118 | 91 |
| queue IN_PROGRESS | 12 | 0 |
| queue oldest_queued_s | 344 | 344 |
| queue QUEUED | 66 | 4 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 8 | 8 |
| restarts worker-2 | 6 | 6 |
| RSS MB jail | 56 | 56 |
| RSS MB web | 288 | 288 |
| RSS MB worker-1 | 170 | 143 |
| RSS MB worker-2 | 158 | 133 |

## Resources — metrics-downloads.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 3 | 1 |
| pg conns slaydx (idle) | 12 | 12 |
| pg conns TOTAL (all apps/states) | 12 | |
| postgres container CPU % | 94 | 33 |
| postgres container MB | 219 | 218 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 317 | 317 |
| RSS MB worker-1 | 179 | 179 |
| RSS MB worker-2 | 178 | 178 |

## Resources — metrics-enqueue.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 1 | 1 |
| pg conns slaydx (idle) | 9 | 3 |
| pg conns TOTAL (all apps/states) | 9 | |
| postgres container CPU % | 23 | 9 |
| postgres container MB | 204 | 195 |
| queue IN_PROGRESS | 2 | 0 |
| queue oldest_queued_s | 91 | 91 |
| queue QUEUED | 2377 | 1948 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 251 | 251 |
| RSS MB worker-1 | 191 | 191 |
| RSS MB worker-2 | 190 | 185 |

## Resources — metrics-mixed.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 2 | 1 |
| pg conns slaydx (idle) | 12 | 12 |
| pg conns slaydx (idle in transaction) | 1 | 1 |
| pg conns TOTAL (all apps/states) | 12 | |
| postgres container CPU % | 73 | 0 |
| postgres container MB | 236 | 226 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 1 | 0 |
| queue QUEUED | 4 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 340 | 340 |
| RSS MB worker-1 | 192 | 182 |
| RSS MB worker-2 | 192 | 181 |

## Resources — metrics-poll.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 2 | 2 |
| pg conns slaydx (idle) | 12 | 11 |
| pg conns TOTAL (all apps/states) | 12 | |
| postgres container CPU % | 46 | 0 |
| postgres container MB | 219 | 210 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 311 | 311 |
| RSS MB worker-1 | 143 | 143 |
| RSS MB worker-2 | 143 | 143 |

## Resources — metrics-uploads.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx (active) | 1 | 1 |
| pg conns slaydx (idle) | 12 | 5 |
| pg conns TOTAL (all apps/states) | 12 | |
| postgres container CPU % | 11 | 0 |
| postgres container MB | 218 | 201 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 48 | 48 |
| RSS MB web | 281 | 281 |
| RSS MB worker-1 | 179 | 179 |
| RSS MB worker-2 | 178 | 178 |

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
| worker-sigterm | 16 | 1 | drained_or_released  |

Details (FAIL and INFO lines):

```
# chaos-pg-restart.txt
== chaos pg-restart (before; mixed load 90s, postgres down 10s at +20s)
INFO  postgres unavailable for 10.6 s
INFO  non-200 /api/health probes during the outage: 20 (expected: health reports the DB)
INFO  k6 mixed during experiment — reqs=3185 failed=5.59% p50=3ms p95=8ms p99=14ms max=27ms
== pg-restart: 0 failed check(s)
# chaos-provider-down.txt
== chaos provider-down (before; 30 jobs per phase under browse load)
INFO  blank_image enqueue→failed p95: 2.8s
INFO  blank_image states — 30× FAILED attempts=1 refunds=1
INFO  down_llm enqueue→failed p95: 97.0s
INFO  down_llm states — 30× FAILED attempts=1 refunds=1
INFO  jail proxy intercepted 360 outbound provider call(s); targets:  360 generativelanguage.googleapis.com:443;
INFO  k6 browse during experiment — reqs=2062 failed=0% p50=2ms p95=4ms p99=5ms max=6ms
== provider-down: 0 failed check(s)
# chaos-worker-sigkill.txt
== chaos worker-sigkill (before; wait ≤330s for reclaim)
INFO  worker-1 pid 1027880 holds 2 job(s) mid-flight: 80d51af8-ebb8-481d-b328-54c06762bab7 57ce0344-63a7-43d7-8793-7978cc4bd653
INFO  killed jobs re-run by another claim (attempts ≥ 2): 2 / 2
INFO  killed states — 2× FAILED attempts=2 refunds=1
INFO  all_enqueued states — 4× FAILED attempts=1 refunds=1; 2× FAILED attempts=2 refunds=1
INFO  jail proxy hits so far: 27 (all answered locally, nothing forwarded)
== worker-sigkill: 0 failed check(s)
# chaos-worker-sigterm.txt
== chaos worker-sigterm (before; release expected ≤ 35 s)
INFO  worker-1 pid 1044701 holds 4 job(s): ba25bc54-f3f4-468f-ae77-529a214ad819 f7f6f130-7f49-421f-a6c1-07eb689ce4f3 69a64ed4-b6e2-44b5-82e7-22fa351c7fb2 413f8cea-8fb8-4c7b-9ac4-15e87d0f4cc9
FAIL  drained_or_released — jobs still leased by the stopped worker after 37s: 4 (0 = finished in grace or released to QUEUED)
INFO  worker-1 log: [worker] to'xtatilmoqda...
INFO  worker-1 log: [worker] to'xtatilmoqda...
INFO  worker-1 log: [worker] to'xtatilmoqda...
INFO  sigtermed states — 4× FAILED attempts=2 refunds=1
INFO  all_enqueued states — 2× FAILED attempts=1 refunds=1; 4× FAILED attempts=2 refunds=1
INFO  k6 mixed during experiment — reqs=2160 failed=0% p50=3ms p95=8ms p99=12ms max=19ms
== worker-sigterm: 1 failed check(s)
```
