import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

/**
 * next.config.ts ops rules (ops sprint P-IMG; docs/ops/O4-frontend-speed.md
 * WP-G, docs/ops/O1-deploy-pipeline.md F4). Every check goes through Next's
 * own loaders/matchers, the same code path `next start`/standalone uses.
 */

const nextConfig = (await import("../next.config.ts")).default;

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type RedirectRule = { source: string; destination: string; permanent?: boolean; statusCode?: number };
type Matcher<T> = T & { match: (p: string) => false | Record<string, string> };

const loadCustomRoutes = (await import("next/dist/lib/load-custom-routes.js")).default as unknown as (
  c: unknown,
) => Promise<{ headers: HeaderRule[]; redirects: RedirectRule[] }>;
const { buildCustomRoute } = (await import("next/dist/server/lib/router-utils/filesystem.js")) as unknown as {
  buildCustomRoute: <T>(type: "header" | "redirect", item: T, basePath?: string, caseSensitive?: boolean) => Matcher<T>;
};
const { getRedirectStatus } = (await import("next/dist/lib/redirect-status.js")) as unknown as {
  getRedirectStatus: (r: RedirectRule) => number;
};
const picomatch = (await import("next/dist/compiled/picomatch/index.js")).default as unknown as (
  glob: string | string[],
  opts?: { dot?: boolean; contains?: boolean },
) => (s: string) => boolean;

const routes = await loadCustomRoutes({ ...nextConfig, basePath: "", trailingSlash: false, i18n: null });

function redirectFor(pathname: string): RedirectRule | null {
  for (const item of routes.redirects) {
    const r = buildCustomRoute("redirect", item, "", false);
    if (r.match(pathname)) return item;
  }
  return null;
}

function configHeaders(pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of routes.headers) {
    const r = buildCustomRoute("header", item, "", false);
    if (!r.match(pathname)) continue;
    for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

test("next.config: `/` redirects to `/uz` on the server with a temporary 307", () => {
  const r = redirectFor("/");
  assert.ok(r, "`/` has no config redirect (client-side redirect loads the whole root bundle first)");
  assert.equal(r!.destination, "/uz");
  assert.equal(getRedirectStatus(r!), 307, "must be temporary (307), never a cached 308");
});

test("next.config: no other page or API path is redirected", () => {
  for (const p of ["/uz", "/uz/create", "/uz/purchase", "/admin", "/admin/login", "/api/health", "/api/generations", "/logo.png"]) {
    assert.equal(redirectFor(p), null, `${p} must not be redirected`);
  }
});

test("next.config: hashed static assets keep Next's immutable cache (no config Cache-Control on /_next/static)", () => {
  // Next sets `public, max-age=31536000, immutable` on /_next/static only when
  // no Cache-Control is present yet (router-server.js `!res.getHeader('cache-control')`),
  // so any config rule that sets one there would silently disable it.
  for (const p of ["/_next/static/chunks/app-abc123.js", "/_next/static/css/abc123.css", "/_next/static/media/geist-abc.woff2"]) {
    assert.equal(configHeaders(p)["cache-control"], undefined, `${p}: config Cache-Control overrides immutable`);
  }
});

test("next.config: file tracing drops tests/sources from standalone but keeps runtime reads", () => {
  const excludes = (nextConfig.outputFileTracingExcludes ?? {}) as Record<string, string[]>;
  assert.ok(excludes["*"], "a `*` (all routes) exclude list is required");
  // Same matcher as next/dist/build/collect-build-traces.js: globs joined to the project dir.
  const dir = "/app";
  const isExcluded = picomatch(
    excludes["*"].map((g) => path.join(dir, g)),
    { dot: true, contains: true },
  );
  for (const p of [
    "tests/cache-headers.test.mts",
    "loadtests/k6/smoke.js",
    "docs/ops/PLAN.md",
    "audit/AUDITOR-BRIEF.md",
    "components/viewers/SlideCanvas.tsx",
    "scripts/worker.ts",
    "brand/README.md",
    ".claude/deploy.md",
    "CLAUDE.md",
  ]) {
    assert.ok(isExcluded(path.join(dir, p)), `${p} is still traced into standalone`);
  }
  for (const p of [
    "lib/server/migrations/001_init.sql",
    "lib/server/db.ts",
    "package.json",
    "data/professions.json",
    "public/logo.png",
    "public/samples/CREDITS.md",
    "app/api/health/route.ts",
    "node_modules/next/dist/server/next-server.js",
    "node_modules/sharp/lib/index.js",
    "node_modules/some-pkg/scripts/install.js",
    "node_modules/some-pkg/README.md",
  ]) {
    assert.ok(!isExcluded(path.join(dir, p)), `${p} must stay traced (read at run time)`);
  }
});
