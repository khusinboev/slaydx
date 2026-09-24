// (c) enqueue burst: POST /api/generations at BASE_RPS, then 10× for BURST, then back.
// Distinct random users per request (seeded balances are large), 70 % essay / 30 % image.
// 402 and 429 are EXPECTED answers (admission / in-flight cap / rate limit), not failures;
// the split is reported by the enq_* counters. Check the ledger afterwards (lib/invariants.sh).
import http from "k6/http";
import { enqueue, PROFILE, summary, TREND_STATS } from "./lib.js";

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 402, 429));

const base = Number(__ENV.BASE_RPS || (PROFILE === "smoke" ? 2 : 5));
const factor = Number(__ENV.BURST_FACTOR || 10);
const steady = __ENV.STEADY || (PROFILE === "smoke" ? "10s" : "1m");
const burst = __ENV.BURST || (PROFILE === "smoke" ? "10s" : "1m");

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    enqueue: {
      executor: "ramping-arrival-rate",
      startRate: base,
      timeUnit: "1s",
      preAllocatedVUs: Math.max(20, base * factor * 2),
      maxVUs: Math.max(50, base * factor * 6),
      stages: [
        { duration: steady, target: base },
        { duration: "5s", target: base * factor },
        { duration: burst, target: base * factor },
        { duration: "5s", target: base },
        { duration: steady, target: base },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:POST /api/generations}": ["p(95)<1000"],
    enq_5xx: ["count<1"],
    enq_network_error: ["count<1"],
  },
};

export default enqueue;
export const handleSummary = summary("enqueue");
