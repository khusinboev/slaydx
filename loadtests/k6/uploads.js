// (e) uploads: POST /api/uploads/photo (UPLOAD_KB, default 30 KB) from a pool of UPLOAD_USERS
// (default 50) users, so the per-user rate limit (20/300 s) and count quota (50 photos) are hit.
// 413 (quota) and 429 (rate limit) are expected answers; split in upload_* counters.
import http from "k6/http";
import { summary, TREND_STATS, upload, vuStages } from "./lib.js";

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 413, 429));

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: { uploads: { executor: "ramping-vus", startVUs: 0, stages: vuStages(100), gracefulRampDown: "10s" } },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:POST /api/uploads/photo}": ["p(95)<1500"],
    upload_other: ["count<1"],
  },
};

export default upload;
export const handleSummary = summary("uploads");
