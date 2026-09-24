// (b) poll: each VU is a logged-in user on a result page polling
// GET /api/generations/:id every 1.2–5 s, plus GET /api/generations every 10th poll.
// full profile: ramp to VUS (default 800 ≈ 250 req/s) over RAMP, hold DURATION.
import { poll, summary, TREND_STATS, vuStages } from "./lib.js";

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: { poll: { executor: "ramping-vus", startVUs: 0, stages: vuStages(800), gracefulRampDown: "10s" } },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300"],
    "http_req_duration{name:GET /api/generations/:id}": ["p(95)<300"],
    "http_req_duration{name:GET /api/generations}": ["p(95)<500"],
  },
};

export default poll;
export const handleSummary = summary("poll");
