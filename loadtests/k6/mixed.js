// (f) mixed: all actions at once with realistic weights of MIX_VUS (default 800 full / 20 smoke):
//   browse 45 % · poll 35 % · downloads 12 % · uploads 3 % (VUs) + enqueue at ENQ_RPS (arrival rate).
import http from "k6/http";
import { PROFILE, summary, TREND_STATS, vuStages } from "./lib.js";

export { browse, poll, download, upload, enqueue } from "./lib.js";

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 402, 413, 429));

const total = Number(__ENV.MIX_VUS || (PROFILE === "smoke" ? 20 : 800));
const share = (w) => Math.max(1, Math.round(total * w));
const stagesFor = (w) => vuStages(1).map((s) => (s.target > 0 ? { duration: s.duration, target: share(w) } : s));
const hold = vuStages(1).reduce((acc, s) => acc + parseDur(s.duration), 0);
const enqRps = Number(__ENV.ENQ_RPS || (PROFILE === "smoke" ? 1 : 3));

function parseDur(d) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(d);
  if (!m) return 0;
  return Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2]];
}

const vus = (fn, w) => ({ executor: "ramping-vus", exec: fn, startVUs: 0, stages: stagesFor(w), gracefulRampDown: "10s" });

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    browse: vus("browse", 0.45),
    poll: vus("poll", 0.35),
    downloads: vus("download", 0.12),
    uploads: vus("upload", 0.03),
    enqueue: {
      executor: "constant-arrival-rate",
      exec: "enqueue",
      rate: enqRps,
      timeUnit: "1s",
      duration: `${Math.round(hold)}s`,
      preAllocatedVUs: Math.max(5, enqRps * 4),
      maxVUs: Math.max(20, enqRps * 20),
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    "http_req_duration{scenario:browse}": ["p(95)<800"],
    "http_req_duration{scenario:poll}": ["p(95)<300"],
    "http_req_duration{scenario:downloads}": ["p(95)<500"],
    "http_req_duration{scenario:uploads}": ["p(95)<1500"],
    "http_req_duration{scenario:enqueue}": ["p(95)<1000"],
  },
};

export default function () {}
export const handleSummary = summary("mixed");
