import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Download routes through the REAL handlers (docs/mobile/PLAN.md §4.2):
 *   POST /api/generations/{id}/download — cookie, ownership, 400/404/409,
 *     ready → signed URL, preparing → ready polling (slow stub converter),
 *     background failure and busy gate surfaced with Retry-After;
 *   GET|HEAD /api/dl/{token} — no cookie, headers for Telegram, HEAD never
 *     converts or counts, 410 for stale/expired, 404 for forged tokens;
 *   GET …/file?format=pdf — now through `produceDownload`;
 *   next.config header rules for /api/dl.
 * LibreOffice is stubbed through `setDownloadDeps`.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.WORKER_INLINE = "false";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL ||= "postgres://unused/unused";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type HasItem = { type: "header" | "cookie" | "query" | "host"; key: string; value?: string };
type HeaderRule = { source: string; headers: { key: string; value: string }[]; has?: HasItem[]; missing?: HasItem[] };

test("next.config: /api/dl gets no-referrer, cross-origin CORP, no-store, locked CSP; other routes unchanged", async () => {
  const nextConfig = (await import("../next.config.ts")).default;
  const loadCustomRoutes = (await import("next/dist/lib/load-custom-routes.js")).default as unknown as (c: unknown) => Promise<{ headers: HeaderRule[] }>;
  const { buildCustomRoute } = (await import("next/dist/server/lib/router-utils/filesystem.js")) as unknown as {
    buildCustomRoute: (type: "header", item: HeaderRule, basePath?: string, caseSensitive?: boolean) => HeaderRule & { match: (p: string) => false | object };
  };
  const { headers } = await loadCustomRoutes({ ...nextConfig, basePath: "", trailingSlash: false, i18n: null });
  const merged = (path: string) => {
    const out: Record<string, string> = {};
    for (const item of headers) {
      const r = buildCustomRoute("header", item, "", false);
      if (!r.match(path) || r.has || r.missing) continue;
      for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
    }
    return out;
  };
  const dl = merged("/api/dl/eyJnIjoiMSJ9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(dl["referrer-policy"], "no-referrer", "the token must not leak via Referer");
  assert.equal(dl["cross-origin-resource-policy"], "cross-origin", "Telegram Web reads it cross-origin");
  assert.equal(dl["cache-control"], "private, no-store");
  assert.equal(dl["x-content-type-options"], "nosniff");
  assert.equal(dl["content-security-policy"], "default-src 'none'; frame-ancestors 'none'; sandbox");
  const page = merged("/uz");
  assert.equal(page["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(page["cross-origin-resource-policy"], "same-origin");
  const prepare = merged(`/api/generations/${randomUUID()}/download`);
  assert.equal(prepare["cache-control"], "private, no-store");
  assert.equal(prepare["cross-origin-resource-policy"], "same-origin");
});

test("n3: Content-Disposition filename* is RFC 8187 (' ( ) * percent-encoded); CR/LF/quotes never reach the header", async () => {
  const { contentDisposition } = await import("../lib/server/pdf-serve.ts");
  const h = contentDisposition(`O'zbek (tarix) *1*.pptx`, "attachment");
  assert.equal(h, `attachment; filename="O'zbek (tarix) *1*.pptx"; filename*=UTF-8''O%27zbek%20%28tarix%29%20%2A1%2A.pptx`);
  const star = /filename\*=UTF-8''(.*)$/.exec(contentDisposition(`a"b\\c\r\nX: 1 ʻ'()*.pdf`))![1];
  assert.match(star, /^[A-Za-z0-9!#$&+\-.^_`|~%]+$/, "only RFC 8187 attr-chars and %XX");
  assert.equal(decodeURIComponent(star), `a"b\\c\r\nX: 1 ʻ'()*.pdf`, "round-trips to the exact name");
  assert.ok(!/[\r\n]/.test(contentDisposition(`a\r\nb`)));
});

test("n7: OPTIONS /api/dl/<token> goes through handler(): 204, CORS for Telegram Web, x-request-id", async () => {
  const dlRoute = await import("../app/api/dl/[token]/route.ts");
  const req = new Request("http://localhost:3000/api/dl/x.y", { method: "OPTIONS", headers: { host: "localhost:3000" } });
  const res = await dlRoute.OPTIONS(req);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://web.telegram.org");
  assert.equal(res.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
  assert.match(res.headers.get("x-request-id") ?? "", /^[A-Za-z0-9._:-]{8,128}$/);
});

test("download routes (Postgres)", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { putGenerationFile } = await import("../lib/server/storage.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { DerivedDiskCache } = await import("../lib/server/pdf-cache.ts");
  const { setDownloadDeps } = await import("../lib/server/downloads/produce.ts");
  const { signDownloadToken } = await import("../lib/server/downloads/token.ts");
  const { SofficeBusyError } = await import("../lib/server/soffice-gate.ts");
  const prepareRoute = await import("../app/api/generations/[id]/download/route.ts");
  const dlRoute = await import("../app/api/dl/[token]/route.ts");
  const fileRoute = await import("../app/api/generations/[id]/file/route.ts");

  await migrate();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = async (tag: string) =>
    String(
      (
        await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`, [
          `test-dlr-${tag}-${stamp}`,
        ])
      )[0].id,
    );
  const user = await mkUser("a");
  const other = await mkUser("b");
  const cookieOf = async (u: string) => `${SESSION_COOKIE}=${(await createSession(u)).token}`;
  const cookie = await cookieOf(user);
  const otherCookie = await cookieOf(other);
  const cacheDir = await mkdtemp(join(tmpdir(), "slaydx-dlr-"));

  /** Controllable stub converter: delay, result, call count. */
  const conv = { calls: 0, delayMs: 0, result: "ok" as "ok" | "null" | "busy" };
  let cache = new DerivedDiskCache({ dir: cacheDir, maxBytes: 64 << 20, maxAgeMs: 60_000 });
  const deps = () => ({
    pdfAvailable: () => true,
    rasterAvailable: () => true,
    cache,
    pdfLimit: async () => {},
    rasterLimit: async () => {},
    prepareBudgetMs: 150,
    convertPdf: async (bytes: Uint8Array, _n: string, beforeRun?: () => Promise<void>) => {
      if (conv.result === "busy") throw new SofficeBusyError(15);
      await beforeRun?.();
      conv.calls += 1;
      await new Promise((r) => setTimeout(r, conv.delayMs));
      return conv.result === "null" ? null : Buffer.from(`%PDF-1.4 ${Buffer.from(bytes).toString("utf8")}`);
    },
  });
  setDownloadDeps(deps());

  t.after(async () => {
    setDownloadDeps(null);
    await query("DELETE FROM rate_limits WHERE bucket LIKE $1 OR bucket LIKE $2", [`%:${user}`, `%:${other}`]);
    await query("DELETE FROM generations WHERE user_id IN ($1, $2)", [user, other]);
    await query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [user, other]);
    await query("DELETE FROM users WHERE id IN ($1, $2)", [user, other]);
    await rm(cacheDir, { recursive: true, force: true });
    await pool().end();
  });

  const mkGen = async (o: { tool?: string; format?: string; mime?: string; fileName?: string; bytes?: Uint8Array; status?: string } = {}) => {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, status, expires_at)
       VALUES ($1, $2, $3, 'Sinov', 100, $4, '{}'::jsonb, 'x', 90000, $5, now() + interval '1 day')`,
      [id, user, o.tool ?? "slide", o.format ?? "pptx", o.status ?? "COMPLETED"],
    );
    await putGenerationFile(id, { bytes: o.bytes ?? Buffer.from(`deck-${id}`), mime: o.mime ?? PPTX, fileName: o.fileName ?? "Fotosintez ʻjarayoni.pptx" });
    return id;
  };
  const downloads = async (id: string) =>
    Number((await query<{ downloads: number }>(`SELECT downloads FROM generation_files WHERE generation_id = $1`, [id]))[0].downloads);

  type Json = Record<string, unknown>;
  const prepare = async (id: string, format: unknown, c: string | null = cookie, origin = "http://localhost:3000") => {
    const headers: Record<string, string> = { host: "localhost:3000", "content-type": "application/json" };
    if (c) headers.cookie = c;
    if (origin) headers.origin = origin;
    const req = new Request(`http://localhost:3000/api/generations/${id}/download`, { method: "POST", headers, body: JSON.stringify({ format }) });
    const res = await inRequest(req, () => prepareRoute.POST(req, { params: Promise.resolve({ id }) }));
    return { status: res.status, headers: res.headers, body: (await res.json()) as Json };
  };
  /** The token route is called WITHOUT a Next request context: no cookie can be involved. */
  const dl = async (url: string, method: "GET" | "HEAD" = "GET") => {
    const token = url.replace(/^\/api\/dl\//, "");
    const req = new Request(`http://localhost:3000${url}`, { method, headers: { host: "localhost:3000" } });
    const handler = method === "GET" ? dlRoute.GET : dlRoute.HEAD;
    const res = await handler(req, { params: Promise.resolve({ token }) });
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
  };
  const ready = async (id: string, format: string) => {
    for (let i = 0; i < 40; i++) {
      const r = await prepare(id, format);
      if (r.body.state === "ready") return r;
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.state, "preparing");
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error("never ready");
  };

  await t.test("POST: auth, CSRF, validation, ownership, not ready", async () => {
    const id = await mkGen();
    assert.equal((await prepare(id, "native", null)).status, 401);
    assert.equal((await prepare(id, "native", cookie, "https://evil.example")).status, 403);
    const unknown = await prepare(id, "exe");
    assert.deepEqual([unknown.status, unknown.body.code], [400, "unknown_format"]);
    const unsupported = await prepare(id, "jpg");
    assert.deepEqual([unsupported.status, unsupported.body.code], [400, "unsupported"]);
    const foreign = await prepare(id, "native", otherCookie);
    assert.deepEqual([foreign.status, foreign.body.code], [404, "not_found"]);
    const notReady = await prepare(await mkGen({ status: "IN_PROGRESS" }), "native");
    assert.deepEqual([notReady.status, notReady.body.code], [409, "not_ready"]);
  });

  await t.test("POST ready → GET /api/dl: stored bytes, Telegram headers, counted once; HEAD: size only, not counted", async () => {
    const bytes = Buffer.from("PPTX baytlari — 1");
    const id = await mkGen({ bytes });
    const before = Date.now();
    const r = await prepare(id, "native");
    assert.equal(r.status, 200);
    assert.equal(r.body.state, "ready");
    assert.equal(r.body.fileName, "Fotosintez ʻjarayoni.pptx");
    assert.equal(r.body.size, bytes.byteLength);
    assert.equal(r.body.mime, PPTX);
    assert.match(String(r.body.url), /^\/api\/dl\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const exp = Date.parse(String(r.body.expiresAt));
    assert.ok(exp >= before + 899_000 && exp <= Date.now() + 900_000, "15 min TTL");
    assert.equal(await downloads(id), 0, "prepare does not count");

    const head = await dl(String(r.body.url), "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.bytes.byteLength, 0, "HEAD has no body");
    assert.equal(head.headers.get("content-length"), String(bytes.byteLength));
    assert.equal(await downloads(id), 0, "HEAD never counts");

    const get = await dl(String(r.body.url));
    assert.equal(get.status, 200);
    assert.ok(get.bytes.equals(bytes));
    assert.equal(get.headers.get("content-type"), PPTX);
    assert.equal(get.headers.get("content-length"), String(bytes.byteLength));
    assert.equal(
      get.headers.get("content-disposition"),
      `attachment; filename="Fotosintez _jarayoni.pptx"; filename*=UTF-8''${encodeURIComponent("Fotosintez ʻjarayoni.pptx")}`,
    );
    assert.equal(get.headers.get("access-control-allow-origin"), "https://web.telegram.org");
    assert.equal(get.headers.get("cache-control"), "private, no-store");
    assert.equal(get.headers.get("x-content-type-options"), "nosniff");
    assert.equal(get.headers.get("referrer-policy"), "no-referrer");
    assert.equal(await downloads(id), 1);
    // Multi-use within the TTL (Android retries, iOS HEAD + GET).
    assert.equal((await dl(String(r.body.url))).status, 200);
    assert.equal(await downloads(id), 2);
    for (const h of ["content-disposition", "access-control-allow-origin", "referrer-policy", "content-type"]) {
      assert.equal(head.headers.get(h), get.headers.get(h), `HEAD and GET agree on ${h}`);
    }
  });

  await t.test("PDF: preparing → ready while a slow conversion runs once in the background; HEAD never converts", async () => {
    cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlr-slow-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    Object.assign(conv, { calls: 0, delayMs: 700, result: "ok" });
    setDownloadDeps(deps());
    const id = await mkGen({ bytes: Buffer.from("slow-deck") });

    const t0 = Date.now();
    const first = await prepare(id, "pdf");
    assert.ok(Date.now() - t0 < 600, `the request is not held for the conversion (${Date.now() - t0} ms)`);
    assert.deepEqual(first.body, { state: "preparing", retryAfterMs: 1500 });
    const second = await prepare(id, "pdf");
    assert.equal(second.body.state, "preparing");
    const done = await ready(id, "pdf");
    assert.equal(conv.calls, 1, "single-flight across polls");
    assert.equal(done.body.fileName, "Fotosintez ʻjarayoni.pdf");
    assert.equal(done.body.mime, "application/pdf");
    const get = await dl(String(done.body.url));
    assert.equal(get.status, 200);
    assert.equal(get.bytes.toString(), "%PDF-1.4 slow-deck");
    assert.equal(done.body.size, get.bytes.byteLength);
    assert.equal(conv.calls, 1, "GET serves the cached PDF");

    // A token whose PDF is not in the cache (evicted): HEAD never converts — 503 + Retry-After, no body, not counted.
    cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlr-empty-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    setDownloadDeps(deps());
    const countedBefore = await downloads(id);
    const head = await dl(String(done.body.url), "HEAD");
    assert.equal(head.status, 503);
    assert.equal(head.headers.get("retry-after"), "5");
    assert.equal(head.bytes.byteLength, 0, "HEAD has no body");
    assert.equal(head.headers.get("access-control-allow-origin"), "https://web.telegram.org");
    assert.equal(conv.calls, 1, "HEAD never converts");
    assert.equal(await downloads(id), countedBefore, "HEAD never counts");
  });

  await t.test("m1: GET after eviction regenerates within the budget; past it → 503 + Retry-After (never a 504), then the background result is served", async () => {
    cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlr-evict-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    Object.assign(conv, { calls: 0, delayMs: 0, result: "ok" });
    setDownloadDeps(deps());
    const id = await mkGen({ bytes: Buffer.from("evicted-deck") });
    const r = await ready(id, "pdf");
    assert.equal(conv.calls, 1);

    // Evicted, fast converter: regenerated inside the budget.
    cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlr-evict2-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    setDownloadDeps({ ...deps(), linkBudgetMs: 2_000 });
    const fast = await dl(String(r.body.url));
    assert.equal(fast.status, 200);
    assert.equal(fast.bytes.toString(), "%PDF-1.4 evicted-deck");
    assert.equal(conv.calls, 2);

    // Evicted again, slow converter (the soffice gate is busy): the GET gives up at the budget.
    cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlr-evict3-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    conv.delayMs = 700;
    setDownloadDeps({ ...deps(), linkBudgetMs: 150 });
    const t0 = Date.now();
    const slow = await dl(String(r.body.url));
    const took = Date.now() - t0;
    assert.equal(slow.status, 503);
    assert.equal(JSON.parse(slow.bytes.toString()).code, "busy");
    assert.equal(slow.headers.get("retry-after"), "15");
    assert.ok(took < 650, `answered at the budget, not after the conversion (${took} ms)`);
    // The conversion finished in the background and landed in the cache: the retry is served without a new one.
    await new Promise((res) => setTimeout(res, 800));
    const retry = await dl(String(r.body.url));
    assert.equal(retry.status, 200);
    assert.equal(retry.bytes.toString(), "%PDF-1.4 evicted-deck");
    assert.equal(conv.calls, 3, "one background conversion, reused by the retry");
    conv.delayMs = 0;
  });

  await t.test("m1: minting a link pins its derived file — LRU pressure does not evict it before the token expires", async () => {
    const pinDir = await mkdtemp(join(tmpdir(), "slaydx-dlr-pin-"));
    cache = new DerivedDiskCache({ dir: pinDir, maxBytes: 200, maxAgeMs: 60_000, hardMaxBytes: 10_000 });
    Object.assign(conv, { calls: 0, delayMs: 0, result: "ok" });
    setDownloadDeps({ ...deps(), prepareBudgetMs: 2_000 });
    const id = await mkGen({ bytes: Buffer.from("pinned") });
    const r = await ready(id, "pdf");
    assert.equal(conv.calls, 1);
    // Other users' conversions fill the cache past maxBytes.
    for (let i = 0; i < 4; i++) await cache.put(`filler-${i}`, Buffer.alloc(100, i));
    const get = await dl(String(r.body.url));
    assert.equal(get.status, 200);
    assert.equal(conv.calls, 1, "served from the pinned cache entry, not converted again");
    // After a restart (pins are in memory) a prepare that hits the cache pins the entry again.
    cache = new DerivedDiskCache({ dir: pinDir, maxBytes: 200, maxAgeMs: 60_000, hardMaxBytes: 10_000 });
    setDownloadDeps({ ...deps(), prepareBudgetMs: 2_000 });
    const again = await prepare(id, "pdf");
    assert.equal(again.body.state, "ready");
    for (let i = 4; i < 8; i++) await cache.put(`filler-${i}`, Buffer.alloc(100, i));
    assert.equal((await dl(String(again.body.url))).status, 200);
    assert.equal(conv.calls, 1);
  });

  await t.test("background failure is reported to the next poll (502), busy gate → 503 + Retry-After", async () => {
    cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlr-fail-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    Object.assign(conv, { calls: 0, delayMs: 300, result: "null" });
    setDownloadDeps(deps());
    const id = await mkGen({ tool: "essay", format: "docx", mime: DOCX, fileName: "Insho.docx" });
    assert.equal((await prepare(id, "pdf")).body.state, "preparing");
    await new Promise((r) => setTimeout(r, 400));
    const failed = await prepare(id, "pdf");
    assert.deepEqual([failed.status, failed.body.code], [502, "failed"]);
    // Reported once; the next tap starts a new attempt.
    Object.assign(conv, { delayMs: 0, result: "ok" });
    assert.equal((await ready(id, "pdf")).body.state, "ready");

    Object.assign(conv, { result: "busy" });
    const id2 = await mkGen({ tool: "essay", format: "docx", mime: DOCX, fileName: "B.docx", bytes: Buffer.from("busy") });
    const busy = await prepare(id2, "pdf");
    assert.equal(busy.status, 503);
    assert.equal(busy.body.code, "busy");
    assert.equal(busy.headers.get("retry-after"), "15");
    Object.assign(conv, { result: "ok" });
  });

  await t.test("410 after an edit or rebuild, 410 when expired or deleted, 404 for forged tokens", async () => {
    const id = await mkGen();
    const r = await prepare(id, "native");
    const url = String(r.body.url);
    assert.equal((await dl(url)).status, 200);

    // Edited in the viewer (doc_version ahead of the file): the old bytes are not what the user sees.
    await query(`UPDATE generations SET doc_version = 1 WHERE id = $1`, [id]);
    const edited = await dl(url);
    assert.equal(edited.status, 410);
    assert.equal(JSON.parse(edited.bytes.toString()).code, "stale");
    assert.equal(edited.headers.get("access-control-allow-origin"), "https://web.telegram.org");
    assert.equal((await dl(url, "HEAD")).status, 410);
    // Rebuilt: a new file_version — the old link stays dead, a new prepare works.
    await query(`UPDATE generations SET file_version = 1 WHERE id = $1`, [id]);
    assert.equal((await dl(url)).status, 410);
    const fresh = await prepare(id, "native");
    assert.equal((await dl(String(fresh.body.url))).status, 200);

    const expired = signDownloadToken({ g: id, u: user, f: "native", v: 1 }, { now: Date.now() - 16 * 60_000 });
    const exp = await dl(`/api/dl/${expired.token}`);
    assert.equal(exp.status, 410);
    assert.equal(JSON.parse(exp.bytes.toString()).code, "expired");

    // Validly signed but for a user who does not own the generation: ownership is SQL → gone.
    const foreign = signDownloadToken({ g: id, u: other, f: "native", v: 1 });
    assert.equal((await dl(`/api/dl/${foreign.token}`)).status, 410);

    const [payload, sig] = String(fresh.body.url).replace("/api/dl/", "").split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), u: other })).toString("base64url");
    assert.equal((await dl(`/api/dl/${forged}.${sig}`)).status, 404);
    assert.equal((await dl(`/api/dl/garbage`)).status, 404);
    assert.equal((await dl(`/api/dl/garbage`, "HEAD")).bytes.byteLength, 0);

    await query(`DELETE FROM generations WHERE id = $1`, [id]);
    assert.equal((await dl(String(fresh.body.url))).status, 410);
  });

  await t.test("GET …/file?format=pdf goes through the shared producer (cache, registry, inline)", async () => {
    cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlr-file-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    Object.assign(conv, { calls: 0, delayMs: 0, result: "ok" });
    setDownloadDeps(deps());
    const id = await mkGen({ tool: "translation", format: "docx", mime: DOCX, fileName: "Tarjima.docx", bytes: Buffer.from("tarjima") });
    const call = async (qs: string, c = cookie) => {
      const req = new Request(`http://localhost:3000/api/generations/${id}/file${qs}`, { headers: { host: "localhost:3000", cookie: c } });
      return inRequest(req, () => fileRoute.GET(req, { params: Promise.resolve({ id }) }));
    };
    const inline = await call("?format=pdf&inline=1");
    assert.equal(inline.status, 200);
    assert.equal(Buffer.from(await inline.arrayBuffer()).toString(), "%PDF-1.4 tarjima");
    assert.match(inline.headers.get("content-disposition") ?? "", /^inline; filename="Tarjima\.pdf"/);
    const attach = await call("?format=pdf");
    assert.match(attach.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(conv.calls, 1, "second request from the derived cache");
    assert.equal((await call("?format=pdf", otherCookie)).status, 404);
    // Audio src / native file path unchanged.
    const native = await call("");
    assert.equal(Buffer.from(await native.arrayBuffer()).toString(), "tarjima");
    // Image results have no PDF (registry): 400 as before.
    const png = await mkGen({ tool: "image", format: "png", mime: "image/png", fileName: "R.png", bytes: Buffer.from("png") });
    const req = new Request(`http://localhost:3000/api/generations/${png}/file?format=pdf`, { headers: { host: "localhost:3000", cookie } });
    assert.equal((await inRequest(req, () => fileRoute.GET(req, { params: Promise.resolve({ id: png }) }))).status, 400);
  });
});
