# Load test — after-pgcpu2

```
label=after-pgcpu2
repo=/home/adhambek/projects/pythons/slaydbot/slaydx/.claude/worktrees/loadtest-after
commit=cb7aee3 W4 gate: update 5 stale assertions to intended W4 contracts (telegram transient 
profile=full scenarios=[downloads] chaos=[none]
seed=--users 2000 --gen-users 400 --gens 3 workers=2 x concurrency 4 job_timeout_ms=90000
k6=grafana/k6@sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603 cpus=3 mem=2g
host=12 cores, 14 GB RAM, 5 GB available at start; date=2026-09-24T05:47:14Z
pg_profile=tuned
```

Numbers are laptop-relative (k6, Postgres, web and workers share one 12-core machine); compare runs, not absolutes.

## Scenarios

| scenario | requests | req/s | p50 ms | p95 ms | p99 ms | max ms | failed % | data in MB | thresholds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| downloads | 135404 | 539.8 | 4.1 | 11.8 | 23.9 | 106 | 0 | 4095.8 | ok |

### Per endpoint / per scenario (submetrics with thresholds)

| run | metric | p50 ms | p95 ms | p99 ms | threshold |
|---|---|---:|---:|---:|---|
| downloads | `{name:GET /thumb?v=}` | 4 | 12.4 | 25.2 | p(95)<300 ok |
| downloads | `{name:GET /file}` | 4.5 | 12.3 | 25.7 | p(95)<500 ok |
| downloads | `{name:GET /thumb}` | 3.9 | 12 | 24.4 | p(95)<300 ok |
| downloads | `{name:GET /assets/:id}` | 3.8 | 10.2 | 19.2 | p(95)<300 ok |

### Outcome counters

| run | counter | value |
|---|---|---:|
| downloads | cacheable_asset | 100 % |
| downloads | cacheable_thumb_versioned | 100 % |
| downloads | nostore_thumb_unversioned | 100 % |

## Resources — metrics-downloads.csv

| series | peak | last |
|---|---:|---:|
| pg conns slaydx-web@pop-os (active) | 4 | 1 |
| pg conns slaydx-web@pop-os (idle) | 10 | 10 |
| pg conns slaydx-worker@pop-os (idle) | 3 | 3 |
| pg conns TOTAL (all apps/states) | 13 | |
| postgres container CPU % | 115 | 38 |
| postgres container MB | 272 | 266 |
| queue IN_PROGRESS | 0 | 0 |
| queue oldest_queued_s | 0 | 0 |
| queue QUEUED | 0 | 0 |
| restarts jail | 0 | 0 |
| restarts web | 0 | 0 |
| restarts worker-1 | 0 | 0 |
| restarts worker-2 | 0 | 0 |
| RSS MB jail | 47 | 47 |
| RSS MB web | 314 | 314 |
| RSS MB worker-1 | 148 | 121 |
| RSS MB worker-2 | 150 | 121 |

## Data invariants after each scenario

| after | PASS | FAIL | failed checks |
|---|---:|---:|---|
| downloads | 11 | 0 |  |

