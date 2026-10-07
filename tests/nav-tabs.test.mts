/**
 * Bottom tab bar model (docs/redesign/PLAN.md, F0), pure parts:
 *   - `tabNavAction`: what a tab tap does to the history (PLAN «Back»);
 *   - `tabOf` / `tabBarRoute`: active tab for nested routes, routes that hide the bar;
 *   - `pageEnterDir`: slide direction only between tab roots;
 *   - `walletRedirectTarget` + the `/uz/purchase` page: the payment return query survives;
 *   - `PROFILE_STEPS` and the parent rule agree; `mostUsedToolIds` for the «+» sheet.
 *
 * Mutations (each turned this file red):
 *   - `tabNavAction`: drop the `previous === target` back rule (Bosh → Ishlarim → Bosh pushes Bosh again);
 *   - `tabNavAction`: push between non-home tabs (history grows [Bosh, files, wallet]);
 *   - `tabNavAction`: replace from Bosh (back from the tab would leave the app);
 *   - `tabBarRoute`: show on `/uz/[slug]` (the regex for tool slugs) / on `/uz/files/[id]`;
 *   - `walletRedirectTarget`: drop repeated keys (`q.set` instead of `append`) / drop the query;
 *   - `mostUsedToolIds`: ignore the count (recency only).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROFILE_STEPS,
  TABS,
  isProfileStep,
  isTabRoot,
  pageEnterDir,
  tabBarRoute,
  tabNavAction,
  tabOf,
  walletRedirectTarget,
} from "../lib/nav/tabs.ts";
import { matchRoute, parentOf } from "../lib/nav/parents.ts";
import { DEFAULT_TOP_TOOLS, mostUsedToolIds } from "../components/shell/create-sheet.ts";

test("TABS: Bosh · Ishlarim · Hamyon · Profil with their routes (the «+» is not a tab)", () => {
  assert.deepEqual(
    TABS.map((t) => [t.id, t.href, t.label]),
    [
      ["bosh", "/uz", "Bosh"],
      ["ishlarim", "/uz/files", "Ishlarim"],
      ["hamyon", "/uz/wallet", "Hamyon"],
      ["profil", "/uz/profile", "Profil"],
    ],
  );
});

test("tabNavAction: the PLAN «Back» table", () => {
  const rows: Array<[from: string, to: string, previous: string | null, kind: string]> = [
    // Same root again: scroll to the top, no navigation.
    ["/uz", "/uz", null, "scroll-top"],
    ["/uz/files", "/uz/files", "/uz", "scroll-top"],
    ["/uz/files/", "/uz/files", "/uz", "scroll-top"],
    // From Bosh into a tab: push (back from the tab returns home).
    ["/uz", "/uz/files", null, "push"],
    ["/uz", "/uz/wallet", "/uz/files", "push"],
    // Between non-home tabs: replace (history stays [Bosh, current tab]).
    ["/uz/files", "/uz/wallet", "/uz", "replace"],
    ["/uz/wallet", "/uz/profile", "/uz", "replace"],
    ["/uz/create", "/uz/files", "/uz", "replace"],
    // To Bosh: back when the entry under the page is Bosh, else replace.
    ["/uz/wallet", "/uz", "/uz", "back"],
    ["/uz/files", "/uz", null, "replace"],
    ["/uz/wallet", "/uz", "/uz/files/9", "replace"],
    ["/uz/create", "/uz", "/uz", "back"],
    // A profile step: the profile index under it is the target → back, not a duplicate entry.
    ["/uz/profile/ish", "/uz/profile", "/uz/profile", "back"],
    ["/uz/profile/ish", "/uz/profile", "/uz", "replace"],
    ["/uz/profile/ish", "/uz", "/uz/profile", "replace"],
  ];
  for (const [from, to, previous, kind] of rows) {
    const a = tabNavAction({ from, to, previous });
    assert.equal(a.kind, kind, `${from} → ${to} (previous ${previous})`);
    if (a.kind !== "scroll-top") assert.equal(a.href, to.replace(/\/$/, ""));
  }
});

test("tabNavAction simulated: Bosh → Ishlarim → Hamyon → back lands on Bosh; → Bosh does not stack Bosh", () => {
  // A tiny history: entries + index, driven only by the decisions.
  let stack = ["/uz"];
  let i = 0;
  const tap = (to: string) => {
    const a = tabNavAction({ from: stack[i]!, to, previous: i > 0 ? stack[i - 1]! : null });
    if (a.kind === "push") {
      stack = [...stack.slice(0, i + 1), a.href];
      i += 1;
    } else if (a.kind === "replace") stack[i] = a.href;
    else if (a.kind === "back") i -= 1;
  };
  tap("/uz/files");
  tap("/uz/wallet");
  assert.deepEqual(stack.slice(0, i + 1), ["/uz", "/uz/wallet"]);
  i -= 1; // phone back
  assert.equal(stack[i], "/uz");
  tap("/uz/profile");
  tap("/uz");
  assert.equal(i, 0, "back to the Bosh entry, no second Bosh");
  assert.equal(stack[i], "/uz");
});

test("tabOf: nested routes keep their tab; tool pages have none", () => {
  const rows: Array<[string, string | null]> = [
    ["/uz", "bosh"],
    ["/uz/", "bosh"],
    ["/uz/files", "ishlarim"],
    ["/uz/files/3f1c", "ishlarim"],
    ["/uz/wallet", "hamyon"],
    ["/uz/purchase", "hamyon"],
    ["/uz/profile", "profil"],
    ["/uz/profile/korinish", "profil"],
    ["/uz/create", null],
    ["/uz/slide", null],
    ["/uz/login", null],
    ["/admin", null],
  ];
  for (const [p, id] of rows) assert.equal(tabOf(p), id, p);
  assert.ok(isTabRoot("/uz") && isTabRoot("/uz/files") && isTabRoot("/uz/wallet") && isTabRoot("/uz/profile"));
  assert.ok(!isTabRoot("/uz/profile/ish") && !isTabRoot("/uz/files/1") && !isTabRoot("/uz/create"));
});

test("tabBarRoute: shown on the shell pages, hidden on tool forms, the result page, login and unknown routes", () => {
  for (const p of ["/uz", "/uz/files", "/uz/wallet", "/uz/profile", "/uz/profile/shaxsiy", "/uz/profile/xavfsizlik", "/uz/create", "/uz/files?filter=docs"]) {
    assert.equal(tabBarRoute(p), true, `shown on ${p}`);
  }
  for (const p of ["/uz/slide", "/uz/pro-slide", "/uz/referat", "/uz/files/3f1c2a9e", "/uz/login", "/uz/admin", "/uz/profile/nope", "/o/abc", "/admin"]) {
    assert.equal(tabBarRoute(p), false, `hidden on ${p}`);
  }
});

test("pageEnterDir: slides only between two tab roots, in the tab order; everything else fades", () => {
  assert.equal(pageEnterDir("/uz", "/uz/files"), "left", "towards a tab further right: content enters from the right");
  assert.equal(pageEnterDir("/uz/profile", "/uz/wallet"), "right");
  assert.equal(pageEnterDir("/uz/wallet", "/uz"), "right");
  assert.equal(pageEnterDir("/uz/files", "/uz/profile"), "left");
  assert.equal(pageEnterDir(null, "/uz/files"), "none", "first paint");
  assert.equal(pageEnterDir("/uz/profile", "/uz/profile/ish"), "none", "steps use their own slide");
  assert.equal(pageEnterDir("/uz/create", "/uz/slide"), "none");
  assert.equal(pageEnterDir("/uz/files/1", "/uz/files"), "none");
});

test("walletRedirectTarget: /uz/purchase?… → /uz/wallet?… with the query intact", () => {
  assert.equal(walletRedirectTarget({}), "/uz/wallet");
  assert.equal(walletRedirectTarget(undefined), "/uz/wallet");
  assert.equal(walletRedirectTarget({ order: "o-42" }), "/uz/wallet?order=o-42");
  assert.equal(walletRedirectTarget({ order: "o 1&x=2" }), "/uz/wallet?order=o+1%26x%3D2", "encoded, nothing injected");
  assert.equal(walletRedirectTarget({ a: ["1", "2"], b: undefined, c: "" }), "/uz/wallet?a=1&a=2&c=");
});

test("/uz/purchase page: a server redirect through walletRedirectTarget (no client code, no own UI)", () => {
  const src = readFileSync(new URL("../app/uz/purchase/page.tsx", import.meta.url), "utf8");
  assert.ok(!/["']use client["']/.test(src), "server component");
  assert.match(src, /redirect\(\s*walletRedirectTarget\(\s*await searchParams\s*\)\s*\)/);
  assert.ok(!/PurchasePage/.test(src), "the page itself renders nothing");
});

test("profile steps: the five steps, the parent rule and the [step] page agree", () => {
  assert.deepEqual([...PROFILE_STEPS], ["shaxsiy", "oqish", "ish", "korinish", "xavfsizlik"]);
  for (const s of PROFILE_STEPS) {
    assert.ok(isProfileStep(s));
    assert.equal(matchRoute(`/uz/profile/${s}`)?.route, "/uz/profile/[step]", s);
    assert.equal(parentOf(`/uz/profile/${s}`), "/uz/profile", s);
  }
  assert.ok(!isProfileStep("nope") && !isProfileStep("") && !isProfileStep("SHAXSIY"));
  const page = readFileSync(new URL("../app/uz/profile/[step]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!isProfileStep\(step\)\) notFound\(\);/, "unknown step → 404");
});

test("mostUsedToolIds: most frequent first, ties by recency, unknown skipped, topped up with defaults", () => {
  const known = new Set(["slide", "referat", "essay", "test", "image", "coursework"]);
  const gens = (types: string[]) => types.map((type) => ({ type }));
  // newest first: image (1), referat ×3, slide ×2
  assert.deepEqual(mostUsedToolIds(gens(["image", "referat", "slide", "referat", "slide", "referat", "ghost"]), known), [
    "referat",
    "slide",
    "image",
    "essay",
  ]);
  // tie: the more recent one first
  assert.deepEqual(mostUsedToolIds(gens(["coursework", "image"]), known, 2), ["coursework", "image"]);
  assert.deepEqual(mostUsedToolIds([], known), [...DEFAULT_TOP_TOOLS]);
  assert.deepEqual(mostUsedToolIds(gens(["slide", "slide"]), known), ["slide", "referat", "essay", "test"], "no duplicate default");
});
