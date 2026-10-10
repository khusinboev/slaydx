/**
 * Back navigation, pure parts (docs/nav/PLAN.md, R4 §4 and §6):
 *   - `parentOf` / `isRootPath`: the parent-route map, checked against EVERY
 *     `app/**\/page.tsx`, so a new page without a mapping fails here;
 *   - `telegramBackState`: when the Telegram BackButton shows and when closing
 *     confirmation is on, gated by the client's `isVersionAtLeast`.
 *
 * Mutations: drop the `/uz/[slug]` rule → the page enumeration fails; make
 * `/uz/files/[id]` a root → the table fails; ignore `overlays` or the version
 * gate in `telegramBackState` → the Telegram table fails. Redesign (F0): drop
 * `wallet` from `UZ_RESERVED` → `/uz/wallet` falls into `[slug]` and the table
 * fails; make a tab a root → `isRootPath` fails; drop the `[step]` rule → the
 * page enumeration fails.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTE_RULES, isRootPath, matchRoute, parentOf, adminListOf } from "../lib/nav/parents.ts";
import { telegramBackState } from "../lib/telegram-miniapp.ts";

const APP = fileURLToPath(new URL("../app/", import.meta.url));

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

/** `app/admin/(panel)/users/[id]/page.tsx` → `/admin/users/[id]` (route groups dropped). */
function routeOf(file: string): string {
  const segs = relative(APP, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

/** A concrete URL path for a route pattern. */
function sample(route: string): string {
  return route
    .replace("[slug]", "slide")
    .replace("[id]", "3f1c2a9e-0000-4000-8000-000000000001")
    .replace("[step]", "shaxsiy")
    .replace("[token]", "Ab3dEf");
}

test("every app/**/page.tsx has exactly one parent rule (no unmapped route)", () => {
  const routes = pages(APP).map(routeOf).sort();
  assert.ok(routes.length >= 25, `pages found: ${routes.length}`);
  const unmapped = routes.filter((r) => matchRoute(sample(r)) == null);
  assert.deepEqual(unmapped, [], "add these routes to lib/nav/parents.ts ROUTE_RULES");
  // and every rule maps a real page (no stale rules)
  const sampled = routes.map(sample);
  const stale = ROUTE_RULES.filter((rule) => !sampled.some((p) => rule.match.test(p))).map((r) => r.route);
  assert.deepEqual(stale, []);
});

test("parentOf: the R4 §6 table", () => {
  const table: Array<[string, string | null, string?]> = [
    ["/", null],
    ["/uz", null],
    ["/o/Ab3dEf", null],
    ["/admin", "/uz/profile"],
    ["/admin/login", null],
    ["/admin/enroll", null],
    ["/uz/create", "/uz"],
    ["/uz/purchase", "/uz", "?order=42"],
    ["/uz/profile", "/uz"],
    // Bottom tabs (redesign): `/uz` is the only root; steps go back to the profile index.
    ["/uz/files", "/uz"],
    ["/uz/wallet", "/uz"],
    ["/uz/wallet", "/uz", "?order=42"],
    ["/uz/profile/shaxsiy", "/uz/profile"],
    ["/uz/profile/oqish", "/uz/profile"],
    ["/uz/profile/ish", "/uz/profile"],
    ["/uz/profile/korinish", "/uz/profile"],
    ["/uz/profile/xavfsizlik", "/uz/profile"],
    ["/uz/files/3f1c2a9e", "/uz/files"],
    ["/uz/slide", "/uz/create"],
    ["/uz/pro-slide", "/uz/create"],
    ["/uz/coursework", "/uz/create"],
    ["/uz/login", "/uz"],
    ["/uz/login", "/uz/files/9", "?returnTo=%2Fuz%2Ffiles%2F9"],
    ["/uz/login", "/uz", "?returnTo=https%3A%2F%2Fevil.example"],
    ["/uz/login", "/uz", "?returnTo=javascript%3Aalert(1)"],
    ["/uz/admin", "/uz"],
    ["/admin/users", "/admin"],
    ["/admin/audit", "/admin"],
    ["/admin/account", "/admin"],
    ["/admin/bonus", "/admin"],
    ["/admin/users/42", "/admin/users"],
    ["/admin/generations/3f1c", "/admin/generations"],
    ["/admin/payments/7", "/admin/payments"],
    ["/admin/broadcasts/5", "/admin/broadcasts"],
    ["/uz/create/", "/uz"],
  ];
  for (const [path, parent, search] of table) {
    assert.equal(parentOf(path, search), parent, `${path}${search ?? ""}`);
  }
});

test("parentOf: unknown routes stay on the site", () => {
  assert.equal(parentOf("/uz/files/1/extra"), "/uz");
  // An unknown profile step has no rule (the page 404s) and is not a tool slug either.
  assert.equal(matchRoute("/uz/profile/nope"), null);
  assert.equal(parentOf("/uz/profile/nope"), "/uz");
  // The tab segments are pages, not `/uz/[slug]` tool slugs — and the slug rule itself
  // refuses them too (rule order must not be the only thing keeping `/uz/wallet` off a tool form).
  for (const p of ["/uz/files", "/uz/wallet", "/uz/profile", "/uz/purchase"]) assert.equal(matchRoute(p)?.route, p, p);
  const slug = ROUTE_RULES.find((r) => r.route === "/uz/[slug]")!;
  for (const seg of ["create", "purchase", "wallet", "profile", "login", "files", "admin"]) {
    assert.equal(slug.match.test(`/uz/${seg}`), false, `/uz/${seg} is reserved`);
  }
  assert.equal(slug.match.test("/uz/slide"), true);
  assert.equal(parentOf("/admin/nope/1/2"), "/admin");
  assert.equal(parentOf("/elsewhere"), "/uz");
});

test("isRootPath and adminListOf", () => {
  for (const p of ["/uz", "/o/x", "/admin/login", "/admin/enroll", "/"]) assert.equal(isRootPath(p), true, p);
  for (const p of [
    "/uz/create",
    "/uz/files/1",
    "/uz/slide",
    "/admin",
    "/admin/users",
    "/admin/users/1",
    "/o",
    "/uz/unknown/x",
    "/uz/files",
    "/uz/wallet",
    "/uz/profile",
    "/uz/profile/ish",
  ]) {
    assert.equal(isRootPath(p), false, p);
  }
  assert.equal(adminListOf("/admin/users/1"), "/admin/users");
  assert.equal(adminListOf("/admin/audit/1"), null);
  assert.equal(adminListOf("/admin/users"), null);
});

const v = (version: string) => (min: string) => {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 2; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

test("telegramBackState: BackButton iff an overlay is open or the route is not a root", () => {
  const rows: Array<[overlays: number, pathname: string, back: boolean]> = [
    [0, "/uz", false],
    [0, "/o/Ab3dEf", false],
    [0, "/admin", true],
    [0, "/admin/pricing", true],
    [0, "/admin/login", false],
    [0, "/admin/enroll", false],
    [1, "/uz", true],
    [2, "/o/Ab3dEf", true],
    [0, "/uz/create", true],
    [0, "/uz/files/1", true],
    [0, "/uz/slide", true],
    [0, "/uz/files", true],
    [0, "/uz/wallet", true],
    [0, "/uz/profile/korinish", true],
    [0, "/admin/users/4", true],
    [1, "/uz/files/1", true],
  ];
  for (const [overlays, pathname, back] of rows) {
    const s = telegramBackState({ overlays, pathname, pending: false, isVersionAtLeast: v("8.0") });
    assert.equal(s.backButton, back, `${overlays} overlays at ${pathname}`);
    assert.equal(s.closingConfirmation, false);
  }
});

test("telegramBackState: closing confirmation while a save is pending; version gates", () => {
  assert.deepEqual(telegramBackState({ overlays: 0, pathname: "/uz/files/1", pending: true, isVersionAtLeast: v("8.0") }), {
    backButton: true,
    closingConfirmation: true,
  });
  // 6.1 has the BackButton but not closing confirmation.
  assert.deepEqual(telegramBackState({ overlays: 0, pathname: "/uz/files/1", pending: true, isVersionAtLeast: v("6.1") }), {
    backButton: true,
    closingConfirmation: null,
  });
  // 6.0: neither member exists, nothing may be called.
  assert.deepEqual(telegramBackState({ overlays: 3, pathname: "/uz/files/1", pending: true, isVersionAtLeast: v("6.0") }), {
    backButton: null,
    closingConfirmation: null,
  });
  // A throwing / missing isVersionAtLeast counts as unsupported.
  assert.deepEqual(
    telegramBackState({
      overlays: 1,
      pathname: "/uz",
      pending: true,
      isVersionAtLeast: () => {
        throw new Error("old client");
      },
    }),
    { backButton: null, closingConfirmation: null },
  );
});
