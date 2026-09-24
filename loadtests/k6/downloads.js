// (d) downloads: GET …/file, …/thumb?v=0, …/thumb, …/assets/:id for seeded COMPLETED jobs.
// Cache headers are recorded as rates: cacheable_thumb_versioned / cacheable_asset should be 1
// (max-age … immutable) and nostore_thumb_unversioned should be 1 (private, no-store).
// Bytes moved: data_received in the summary. Thumbs are pre-seeded assets (no LibreOffice).
import { download, summary, TREND_STATS, vuStages } from "./lib.js";

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: { downloads: { executor: "ramping-vus", startVUs: 0, stages: vuStages(200), gracefulRampDown: "10s" } },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:GET /file}": ["p(95)<500"],
    "http_req_duration{name:GET /thumb?v=}": ["p(95)<300"],
    "http_req_duration{name:GET /thumb}": ["p(95)<300"],
    "http_req_duration{name:GET /assets/:id}": ["p(95)<300"],
    cacheable_thumb_versioned: ["rate>0.99"],
    nostore_thumb_unversioned: ["rate>0.99"],
    cacheable_asset: ["rate>0.99"],
  },
};

export default download;
export const handleSummary = summary("downloads");
