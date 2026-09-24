// Shared k6 helpers for the SlaydX load scenarios.
// Env: BASE_URL, PROFILE (smoke|full), VUS, DURATION, RAMP, OUT_NAME, TOKENS.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Rate } from "k6/metrics";

export const BASE = __ENV.BASE_URL || "http://127.0.0.1:3300";
export const PROFILE = __ENV.PROFILE || "smoke";
const TOKENS = __ENV.TOKENS || "/data/tokens.json";

export const USERS = new SharedArray("users", () => JSON.parse(open(TOKENS)).users);
export const GEN_USERS = new SharedArray("genUsers", () => JSON.parse(open(TOKENS)).users.filter((u) => u.g.length > 0));
export const META = new SharedArray("meta", () => {
  const d = JSON.parse(open(TOKENS));
  return [{ assetId: d.assetId, thumbAssetId: d.thumbAssetId, fileBytes: d.fileBytes, thumbBytes: d.thumbBytes, assetBytes: d.assetBytes }];
})[0];

export const TREND_STATS = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"];

/** ramping-vus stages: smoke = short flat run, full = ramp → hold → ramp down. */
export function vuStages(fullPeak) {
  const peak = Number(__ENV.VUS || (PROFILE === "smoke" ? 20 : fullPeak));
  const hold = __ENV.DURATION || (PROFILE === "smoke" ? "30s" : "3m");
  const ramp = __ENV.RAMP || (PROFILE === "smoke" ? "5s" : "1m");
  return [
    { duration: ramp, target: peak },
    { duration: hold, target: peak },
    { duration: "10s", target: 0 },
  ];
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function auth(u, extra) {
  return Object.assign({ Cookie: `slaydx_session=${u.t}` }, extra || {});
}

export function think(min, max) {
  sleep(min + Math.random() * (max - min));
}

export function uuid4() {
  const h = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
    else if (i === 14) s += "4";
    else if (i === 19) s += h[8 + Math.floor(Math.random() * 4)];
    else s += h[Math.floor(Math.random() * 16)];
  }
  return s;
}

// ---- actions (each is one user "step") -------------------------------------------

/** (a) landing page + session probe; half the visitors are logged in. */
export function browse() {
  const u = Math.random() < 0.5 ? pick(USERS) : null;
  const headers = u ? auth(u) : {};
  const page = http.get(`${BASE}/uz`, { headers, tags: { name: "GET /uz" } });
  check(page, { "uz 200": (r) => r.status === 200 });
  const s = http.get(`${BASE}/api/auth/session`, { headers, tags: { name: "GET /api/auth/session" } });
  check(s, { "session 200": (r) => r.status === 200 });
  think(1, 3);
}

/** (b) result-page polling at the client cadence (lib/api-client.ts: 1.2 s live, 1–5 s backoff). */
export function poll() {
  const u = GEN_USERS[(__VU - 1) % GEN_USERS.length];
  const id = u.g[__ITER % u.g.length];
  const r = http.get(`${BASE}/api/generations/${id}?since=${__ITER}`, { headers: auth(u), tags: { name: "GET /api/generations/:id" } });
  check(r, { "gen 200": (x) => x.status === 200 });
  if (__ITER % 10 === 0) {
    const l = http.get(`${BASE}/api/generations`, { headers: auth(u), tags: { name: "GET /api/generations" } });
    check(l, { "list 200": (x) => x.status === 200 });
  }
  think(1.2, 5);
}

function bodyCode(r) {
  try {
    return JSON.parse(r.body).code || "";
  } catch {
    return "";
  }
}

export const enqStatus = {
  ok: new Counter("enq_202"),
  admission: new Counter("enq_429_queue_full"),
  inflight: new Counter("enq_429_user_inflight"),
  rate: new Counter("enq_429_rate_limit"),
  insufficient: new Counter("enq_402"),
  other4xx: new Counter("enq_4xx_other"),
  err5xx: new Counter("enq_5xx"),
  neterr: new Counter("enq_network_error"),
};

/** (c) one POST /api/generations: 70 % essay (renders offline → COMPLETED), 30 % image (fails → refund). */
export function enqueue() {
  const u = USERS[Math.floor(Math.random() * USERS.length)];
  const body =
    Math.random() < 0.7
      ? { slug: "essay", values: { topic: `Loadtest burst ${__VU}-${__ITER}`, essayContext: "school" } }
      : { slug: "rasm", values: { prompt: `Loadtest rasm ${__VU}-${__ITER}` } };
  const r = http.post(`${BASE}/api/generations`, JSON.stringify(body), {
    headers: auth(u, { "Content-Type": "application/json", "Idempotency-Key": uuid4() }),
    tags: { name: "POST /api/generations" },
  });
  if (r.status === 202) enqStatus.ok.add(1);
  else if (r.status === 429) {
    const code = bodyCode(r);
    if (code === "queue_full") enqStatus.admission.add(1);
    else if (code === "user_inflight") enqStatus.inflight.add(1);
    else enqStatus.rate.add(1);
  } else if (r.status === 402) enqStatus.insufficient.add(1);
  else if (r.status === 0) enqStatus.neterr.add(1);
  else if (r.status >= 500) enqStatus.err5xx.add(1);
  else enqStatus.other4xx.add(1);
}

export const cacheOk = {
  thumbV: new Rate("cacheable_thumb_versioned"),
  thumbNoV: new Rate("nostore_thumb_unversioned"),
  asset: new Rate("cacheable_asset"),
};

/** (d) file download + thumbnails + slide/image asset, as the file list / viewer does. */
export function download() {
  const u = pick(GEN_USERS);
  const id = pick(u.g);
  const h = auth(u);
  const f = http.get(`${BASE}/api/generations/${id}/file`, { headers: h, tags: { name: "GET /file" } });
  check(f, { "file 200": (r) => r.status === 200, "file bytes": (r) => r.body && r.body.length === META.fileBytes });
  const tv = http.get(`${BASE}/api/generations/${id}/thumb?v=0`, { headers: h, tags: { name: "GET /thumb?v=" } });
  check(tv, { "thumb 200": (r) => r.status === 200 });
  cacheOk.thumbV.add(/max-age=\d+/.test(tv.headers["Cache-Control"] || ""));
  const t = http.get(`${BASE}/api/generations/${id}/thumb`, { headers: h, tags: { name: "GET /thumb" } });
  cacheOk.thumbNoV.add(/no-store/.test(t.headers["Cache-Control"] || ""));
  const a = http.get(`${BASE}/api/generations/${id}/assets/${META.assetId}`, { headers: h, tags: { name: "GET /assets/:id" } });
  check(a, { "asset 200": (r) => r.status === 200 });
  cacheOk.asset.add(/max-age=\d+/.test(a.headers["Cache-Control"] || ""));
  think(0.5, 2);
}

// 1×1 PNG; random bytes appended after IEND make every upload a new content-hash asset.
const PNG_1X1 = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
  0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63,
  0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
];
const UPLOAD_KB = Number(__ENV.UPLOAD_KB || 30);
const UPLOAD_USERS = Number(__ENV.UPLOAD_USERS || 50);

export const upStatus = {
  ok: new Counter("upload_200"),
  rate: new Counter("upload_429_rate_limit"),
  quota: new Counter("upload_413_quota"),
  other: new Counter("upload_other"),
};

/** (e) resume photo upload (POST /api/uploads/photo) from a small user pool → hits rate limit + count quota. */
export function upload() {
  const u = USERS[Math.floor(Math.random() * Math.min(UPLOAD_USERS, USERS.length))];
  const bytes = new Uint8Array(PNG_1X1.length + UPLOAD_KB * 1024);
  bytes.set(PNG_1X1, 0);
  for (let i = PNG_1X1.length; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  const r = http.post(
    `${BASE}/api/uploads/photo`,
    { file: http.file(bytes.buffer, "photo.png", "image/png"), shape: "circle" },
    { headers: auth(u), tags: { name: "POST /api/uploads/photo" } },
  );
  if (r.status === 200) upStatus.ok.add(1);
  else if (r.status === 429) upStatus.rate.add(1);
  else if (r.status === 413) upStatus.quota.add(1);
  else upStatus.other.add(1);
  think(1, 4);
}

// ---- summary ---------------------------------------------------------------------

/** handleSummary: full JSON to /out/<name>.json plus one compact line on stdout. */
export function summary(name) {
  return (data) => {
    const m = data.metrics;
    const d = m.http_req_duration && m.http_req_duration.values;
    const line =
      `[k6:${name}] reqs=${m.http_reqs ? m.http_reqs.values.count : 0} ` +
      `rps=${m.http_reqs ? m.http_reqs.values.rate.toFixed(1) : 0} ` +
      `p50=${d ? d.med.toFixed(1) : "-"}ms p95=${d ? d["p(95)"].toFixed(1) : "-"}ms p99=${d ? d["p(99)"].toFixed(1) : "-"}ms ` +
      `failed=${m.http_req_failed ? (m.http_req_failed.values.rate * 100).toFixed(2) : 0}%\n`;
    const out = {};
    out[`/out/k6-${name}.json`] = JSON.stringify(data, null, 1);
    out.stdout = line;
    return out;
  };
}
