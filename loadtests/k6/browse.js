// (a) browse: GET /uz + GET /api/auth/session, half anonymous, 1–3 s think time.
// full profile: ramp to VUS (default 600) over RAMP, hold DURATION.
import { browse, summary, TREND_STATS, vuStages } from "./lib.js";

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: { browse: { executor: "ramping-vus", startVUs: 0, stages: vuStages(600), gracefulRampDown: "10s" } },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    "http_req_duration{name:GET /uz}": ["p(95)<800"],
    "http_req_duration{name:GET /api/auth/session}": ["p(95)<300"],
  },
};

export default browse;
export const handleSummary = summary("browse");
