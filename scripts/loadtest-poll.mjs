#!/usr/bin/env node
/**
 * Read-only web-tier load test: «N users waiting on a running job».
 *
 * Every virtual user does what the result page does while a job runs: `GET /api/generations/<id>` every 1.2 s, plus the
 * list `GET /api/generations?limit=20` every ~10 s. NO job is created, nothing is written, no AI is called. Use a
 * FAILED / finished job id of the account whose session cookie you pass (lean row, same DB path as a running job's poll).
 *
 *   BASE=https://… COOKIE='slaydx_session=…' JOB_ID=<uuid> [STAGES=5,10,20,40,80,120,160,200] [STAGE_SEC=60] \
 *   [SSH=root@host] [OUT=report.json] node scripts/loadtest-poll.mjs
 *
 * Safety: each stage ends early (and the whole run stops) when the stage p95 > P95_LIMIT_MS (default 2000), the error
 * rate > 2 %, or — with SSH set — the host load1 > LOAD_LIMIT (default 7) / MemAvailable < MEM_LIMIT_MB (default 700).
 * The cookie is read from the environment and never printed. Without SSH the host guard is off (only latency / errors stop it).
 * A finished/failed job id exercises the lean DB row of a poll; it does not cover the QUEUED ETA path or the live-deck payload.
 */
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = (process.env.BASE || "").replace(/\/$/, "");
const COOKIE = process.env.COOKIE || "";
const JOB_ID = process.env.JOB_ID || "";
if (!BASE || !COOKIE || !JOB_ID) {
  console.error("BASE, COOKIE and JOB_ID are required");
  process.exit(2);
}
const STAGES = (process.env.STAGES || "5,10,20,40,80,120,160,200").split(",").map(Number);
const STAGE_SEC = Number(process.env.STAGE_SEC || 60);
const P95_LIMIT = Number(process.env.P95_LIMIT_MS || 2000);
const LOAD_LIMIT = Number(process.env.LOAD_LIMIT || 7);
const MEM_LIMIT = Number(process.env.MEM_LIMIT_MB || 700);
const SSH = process.env.SSH || "";
const POLL_MS = 1200;

const headers = { cookie: COOKIE, accept: "application/json" };
let stage = null;

async function hit(path) {
  const t0 = performance.now();
  let ok = false;
  let status = 0;
  try {
    const res = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(15_000) });
    status = res.status;
    await res.arrayBuffer();
    ok = res.ok; // 401/403/404 are failures: an expired cookie or a wrong JOB_ID must not look like a fast, healthy run
  } catch {
    status = 0;
  }
  const ms = performance.now() - t0;
  if (stage) {
    stage.lat.push(ms);
    if (!ok) stage.err++;
    if (status === 429) stage.s429++;
  }
}

// Async on purpose: a blocking ssh call would stall the very event loop that measures request latency.
function host() {
  if (!SSH) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("ssh", ["-n", "-o", "ConnectTimeout=8", SSH, "cat /proc/loadavg; grep MemAvailable /proc/meminfo"], { timeout: 15_000 }, (err, out) => {
      if (err) return resolve(null);
      const [load, mem] = String(out).trim().split("\n");
      resolve({ load1: Number(load.split(" ")[0]), memMb: Math.round(Number(String(mem).replace(/\D/g, "")) / 1024) });
    });
  });
}

const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((a.length * p) / 100))] : 0);

async function vu(stop) {
  let n = 0;
  await new Promise((r) => setTimeout(r, Math.random() * POLL_MS));
  while (!stop.v) {
    const t = performance.now();
    await hit(n % 8 === 7 ? "/api/generations?limit=20" : `/api/generations/${JOB_ID}`);
    n++;
    await new Promise((r) => setTimeout(r, Math.max(0, POLL_MS - (performance.now() - t))));
  }
}

const report = [];
let aborted = null;
for (const users of STAGES) {
  stage = { users, lat: [], err: 0, s429: 0 };
  const stop = { v: false };
  const vus = Array.from({ length: users }, () => vu(stop));
  const t0 = Date.now();
  let hostMax = { load1: 0, memMin: Infinity };
  while (Date.now() - t0 < STAGE_SEC * 1000) {
    await new Promise((r) => setTimeout(r, 10_000));
    const h = await host();
    if (h) {
      hostMax = { load1: Math.max(hostMax.load1, h.load1), memMin: Math.min(hostMax.memMin, h.memMb) };
      if (h.load1 > LOAD_LIMIT || h.memMb < MEM_LIMIT) aborted = `host load1=${h.load1} mem=${h.memMb}MB at ${users} users`;
    }
    // Skip the first 15 s (connection warm-up) for the live p95 check.
    const live = stage.lat.slice(Math.floor(stage.lat.length * 0.3));
    if (live.length > 20 && pct(live, 95) > P95_LIMIT * 2) aborted = `p95 ${Math.round(pct(live, 95))} ms at ${users} users`;
    if (live.length > 20 && (stage.err * 100) / Math.max(1, stage.lat.length) > 10) aborted = `error rate > 10 % at ${users} users`;
    if (aborted) break;
  }
  stop.v = true;
  await Promise.all(vus);
  const secs = (Date.now() - t0) / 1000;
  const row = {
    users,
    reqPerSec: Number((stage.lat.length / secs).toFixed(1)),
    p50: Math.round(pct(stage.lat, 50)),
    p95: Math.round(pct(stage.lat, 95)),
    p99: Math.round(pct(stage.lat, 99)),
    errPct: Number(((stage.err * 100) / Math.max(1, stage.lat.length)).toFixed(2)),
    s429: stage.s429,
    hostLoad1Max: hostMax.load1 || null,
    hostMemMinMb: Number.isFinite(hostMax.memMin) ? hostMax.memMin : null,
  };
  report.push(row);
  console.log(JSON.stringify(row));
  if (!aborted && (row.p95 > P95_LIMIT || row.errPct > 2)) aborted = `limit reached at ${users} users (p95 ${row.p95} ms, errors ${row.errPct} %)`;
  if (aborted) break;
}
console.log(aborted ? `STOPPED: ${aborted}` : "COMPLETED all stages");
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ aborted, report }, null, 2));
