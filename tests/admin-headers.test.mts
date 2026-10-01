import test from "node:test";
import assert from "node:assert/strict";

/**
 * Admin response headers from `next.config.ts` (docs/admin/02-plan.md §10
 * T16, T17), resolved with Next's own loader and matcher exactly like
 * `tests/cache-headers.test.mts` — i.e. what production sends.
 *
 * Next keeps ONE value per header key (a later matching rule overwrites an
 * earlier one), so the admin CSP must be the full site CSP with only
 * `frame-ancestors` tightened; a bare `frame-ancestors 'none'` would silently
 * drop `script-src`/`object-src` on admin pages.
 */

process.env.SESSION_SECRET ||= "test-session-secret-at-least-32-characters";

type HasItem = { type: "header" | "cookie" | "query" | "host"; key: string; value?: string };
type HeaderRule = { source: string; headers: { key: string; value: string }[]; has?: HasItem[]; missing?: HasItem[] };

const nextConfig = (await import("../next.config.ts")).default;
const loadCustomRoutes = (await import("next/dist/lib/load-custom-routes.js")).default as unknown as (
  c: unknown,
) => Promise<{ headers: HeaderRule[] }>;
const { buildCustomRoute } = (await import("next/dist/server/lib/router-utils/filesystem.js")) as unknown as {
  buildCustomRoute: (
    type: "header",
    item: HeaderRule,
    basePath?: string,
    caseSensitive?: boolean,
  ) => HeaderRule & { match: (p: string) => false | Record<string, string> };
};
const { matchHas } = (await import("next/dist/shared/lib/router/utils/prepare-destination.js")) as unknown as {
  matchHas: (req: unknown, query: Record<string, string>, has?: HasItem[], missing?: HasItem[]) => false | object;
};

async function configHeaders(pathname: string): Promise<Record<string, string>> {
  const { headers } = await loadCustomRoutes({ ...nextConfig, basePath: "", trailingSlash: false, i18n: null });
  const out: Record<string, string> = {};
  for (const item of headers) {
    const route = buildCustomRoute("header", item, "", false);
    if (!route.match(pathname)) continue;
    if ((route.has || route.missing) && !matchHas({ headers: {} }, {}, route.has, route.missing)) continue;
    // Same as Next's resolve-routes: one value per key, the later rule wins.
    for (const h of route.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(";").map((d) => {
      const t = d.trim();
      const sp = t.indexOf(" ");
      return sp < 0 ? [t, ""] : [t.slice(0, sp), t.slice(sp + 1)];
    }),
  );
}

const ADMIN_PAGES = ["/admin", "/admin/login", "/admin/enroll", "/admin/users/123", "/admin/audit"];
const ADMIN_API = ["/api/admin/session", "/api/admin/auth/login", "/api/admin/admins/5/reset-2fa", "/api/admin/users"];

test("admin pages: not framable, noindex, no-store — and the rest of the site CSP is kept", async () => {
  const site = directives((await configHeaders("/uz"))["content-security-policy"]!);
  for (const path of ADMIN_PAGES) {
    const h = await configHeaders(path);
    const csp = directives(h["content-security-policy"] ?? "");
    assert.equal(csp.get("frame-ancestors"), "'none'", `${path}: frame-ancestors`);
    for (const [name, value] of site) {
      if (name === "frame-ancestors") continue;
      assert.equal(csp.get(name), value, `${path}: site CSP directive ${name} lost or changed`);
    }
    assert.equal(h["x-robots-tag"], "noindex, nofollow", `${path}: X-Robots-Tag`);
    assert.equal(h["cache-control"], "no-store", `${path}: Cache-Control`);
    // Site-wide hardening still applies.
    assert.equal(h["x-content-type-options"], "nosniff");
    assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
  }
});

test("admin API: not framable, noindex, and still `private, no-store`", async () => {
  for (const path of ADMIN_API) {
    const h = await configHeaders(path);
    assert.equal(directives(h["content-security-policy"] ?? "").get("frame-ancestors"), "'none'", path);
    assert.ok(directives(h["content-security-policy"] ?? "").has("script-src"), `${path}: site CSP kept`);
    assert.equal(h["x-robots-tag"], "noindex, nofollow", path);
    assert.equal(h["cache-control"], "private, no-store", path);
  }
});

test("consumer paths are unchanged: Telegram may still frame them, no noindex", async () => {
  for (const path of ["/", "/uz", "/uz/admin", "/administrator", "/admins", "/api/generations", "/api/adminx"]) {
    const h = await configHeaders(path);
    const fa = directives(h["content-security-policy"] ?? "").get("frame-ancestors") ?? "";
    assert.match(fa, /https:\/\/web\.telegram\.org/, `${path}: Mini App framing must keep working`);
    assert.equal(h["x-robots-tag"], undefined, `${path}: unexpected X-Robots-Tag`);
  }
});
