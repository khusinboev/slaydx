/**
 * Bottom tab bar model (docs/redesign/PLAN.md, F0), pure parts:
 *   - `tabNavAction`: what a tab tap does to the history (PLAN «Back»: collapse to [Bosh, tab]);
 *   - `nearestEntry` / `returnPlan`: profile «Saqlash va yakunlash» back to the index;
 *   - `tabOf` / `tabBarRoute`: active tab for nested routes, routes that hide the bar;
 *   - `pageEnterDir`: slide direction only between tab roots;
 *   - `walletRedirectTarget` + the `/uz/purchase` page: the payment return query survives;
 *   - `PROFILE_STEPS` and the parent rule agree; `mostUsedToolIds` for the «+» sheet.
 *
 * Mutations (each turned this file red):
 *   - `tabNavAction`: drop the «back to Bosh» rule (Bosh → Ishlarim → Bosh pushes Bosh again);
 *   - `tabNavAction`: push between non-home tabs (history grows [Bosh, files, wallet]);
 *   - `tabNavAction`: replace from Bosh (back from the tab would leave the app);
 *   - `tabNavAction`: slot = the current entry's predecessor only (the old one-entry look-back:
 *     Hamyon from a step leaves [Bosh, Profil, shaxsiy, wallet]);
 *   - `tabNavAction`: never «back» to an existing tab root (Profil from a step: back-replace);
 *   - `nearestEntry`: the topmost entry of a run instead of the lowest / the oldest match instead of the nearest;
 *   - `returnPlan`: no nested-run rule (a deep-linked step stays under the index);
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
  nearestEntry,
  pageEnterDir,
  returnPlan,
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

type Want = { kind: string; index?: number };
const B = "/uz";
const P = "/uz/profile";
const S = (s: string) => `/uz/profile/${s}`;

test("tabNavAction: the PLAN «Back» table (history collapses to [Bosh, tab])", () => {
  const rows: Array<[from: string, to: string, stack: Array<string | null>, want: Want]> = [
    // Same root again: scroll to the top, no navigation.
    [B, B, [B], { kind: "scroll-top" }],
    ["/uz/files", "/uz/files", [B, "/uz/files"], { kind: "scroll-top" }],
    ["/uz/files/", "/uz/files", [B, "/uz/files"], { kind: "scroll-top" }],
    // From Bosh into a tab: push (back from the tab returns home).
    [B, "/uz/files", [B], { kind: "push" }],
    [B, "/uz/wallet", [B, "/uz/files", B], { kind: "push" }],
    // The current page is the entry right above Bosh: replace it.
    ["/uz/files", "/uz/wallet", [B, "/uz/files"], { kind: "replace" }],
    ["/uz/wallet", P, [B, "/uz/wallet"], { kind: "replace" }],
    ["/uz/create", "/uz/files", [B, "/uz/create"], { kind: "replace" }],
    [S("ish"), P, [B, S("ish")], { kind: "replace" }],
    // To Bosh: back to the Bosh entry.
    ["/uz/wallet", B, [B, "/uz/wallet"], { kind: "back", index: 0 }],
    ["/uz/create", B, [B, "/uz/create"], { kind: "back", index: 0 }],
    // The review's bug: tab taps on a profile step left the steps in the back path.
    [S("oqish"), "/uz/wallet", [B, P, S("shaxsiy"), S("oqish")], { kind: "back-replace", index: 1 }],
    [S("oqish"), P, [B, P, S("shaxsiy"), S("oqish")], { kind: "back", index: 1 }],
    [S("oqish"), B, [B, P, S("shaxsiy"), S("oqish")], { kind: "back", index: 0 }],
    ["/uz/files", "/uz/wallet", [B, P, S("shaxsiy"), "/uz/files"], { kind: "back-replace", index: 1 }],
    // The NEAREST Bosh, then the lowest of its contiguous run (a same-URL overlay entry left under it).
    ["/uz/files", B, [B, "/uz/wallet", B, "/uz/files"], { kind: "back", index: 2 }],
    ["/uz/files", B, [B, B, "/uz/files"], { kind: "back", index: 0 }],
    ["/uz/wallet", "/uz/files", [B, B, "/uz/wallet"], { kind: "back-replace", index: 1 }],
    // Deep link (no Bosh in the run): the first entry becomes the target; Bosh is its parent (backTo).
    ["/uz/files", B, ["/uz/files"], { kind: "replace" }],
    ["/uz/wallet", B, [], { kind: "replace" }],
    ["/uz/wallet", B, ["/uz/files/9", "/uz/wallet"], { kind: "back-replace", index: 0 }],
    [S("ish"), B, [P, S("ish")], { kind: "back-replace", index: 0 }],
    [S("ish"), P, [P, S("ish")], { kind: "back", index: 0 }],
    [S("oqish"), "/uz/files", [S("shaxsiy"), S("oqish")], { kind: "back-replace", index: 0 }],
    [S("oqish"), "/uz/files", [null, S("oqish")], { kind: "back-replace", index: 0 }],
  ];
  for (const [from, to, stack, want] of rows) {
    const a = tabNavAction({ from, to, stack });
    const label = `${from} → ${to} (stack ${JSON.stringify(stack)})`;
    assert.equal(a.kind, want.kind, label);
    if (a.kind !== "scroll-top") assert.equal(a.href, to.replace(/\/$/, ""), label);
    if (a.kind === "back" || a.kind === "back-replace") assert.equal(a.index, want.index, label);
  }
});

/** A tiny browser history (entries + index) driven only by the decisions; `back()` is the phone back. */
function simulate(start: string[]) {
  let stack = [...start];
  let i = stack.length - 1;
  return {
    tap(to: string) {
      const a = tabNavAction({ from: stack[i]!, to, stack: stack.slice(0, i + 1) });
      if (a.kind === "push") {
        stack = [...stack.slice(0, i + 1), a.href];
        i += 1;
      } else if (a.kind === "replace") stack[i] = a.href;
      else if (a.kind === "back") i = a.index;
      else if (a.kind === "back-replace") {
        i = a.index;
        stack[i] = a.href;
      }
    },
    push(to: string) {
      stack = [...stack.slice(0, i + 1), to];
      i += 1;
    },
    back() {
      i -= 1;
    },
    /** The back path: entries up to the current one. */
    get path() {
      return stack.slice(0, i + 1);
    },
  };
}

test("tabNavAction simulated: tab ↔ tab, back lands on Bosh; → Bosh does not stack Bosh", () => {
  const h = simulate([B]);
  h.tap("/uz/files");
  h.tap("/uz/wallet");
  assert.deepEqual(h.path, [B, "/uz/wallet"]);
  h.back();
  assert.deepEqual(h.path, [B]);
  h.tap(P);
  h.tap(B);
  assert.deepEqual(h.path, [B], "back to the Bosh entry, no second Bosh");
});

test("tabNavAction simulated: a tab tap on a profile step leaves no step in the back path", () => {
  const fromStep = () => {
    const h = simulate([B]);
    h.tap(P);
    h.push(S("shaxsiy"));
    h.push(S("oqish"));
    return h;
  };
  let h = fromStep();
  h.tap("/uz/wallet");
  assert.deepEqual(h.path, [B, "/uz/wallet"], "Hamyon from a step: back → Bosh");
  h = fromStep();
  h.tap(P);
  assert.deepEqual(h.path, [B, P], "Profil from a step: back → Bosh");
  h = fromStep();
  h.tap(B);
  assert.deepEqual(h.path, [B], "Bosh from a step: back on Bosh leaves");
  h = fromStep();
  h.tap("/uz/files");
  h.tap("/uz/wallet");
  assert.deepEqual(h.path, [B, "/uz/wallet"]);
  // Deep-linked step: the tab takes the first entry; its back then REPLACES it with Bosh (parents.ts).
  h = simulate([S("shaxsiy")]);
  h.push(S("oqish"));
  h.tap("/uz/wallet");
  assert.deepEqual(h.path, ["/uz/wallet"]);
  assert.equal(parentOf("/uz/wallet"), B);
});

test("nearestEntry / returnPlan: back to the nearest earlier entry, else the first nested page, else replace", () => {
  assert.equal(nearestEntry([B, P, S("shaxsiy"), S("oqish")], P), 1);
  assert.equal(nearestEntry([B, P, S("shaxsiy"), P, S("ish")], P), 3, "the nearest one");
  assert.equal(nearestEntry([B, P, P, S("ish")], P), 1, "the lowest of a contiguous run");
  assert.equal(nearestEntry([P], P), -1, "the current page itself is not an earlier entry");
  assert.equal(nearestEntry([B, "/uz/files/"], "/uz/files"), -1);
  assert.equal(nearestEntry(["/uz/files/", "/uz/files/1"], "/uz/files"), 0, "normalised");
  const rows: Array<[stack: Array<string | null>, want: Want]> = [
    // The review's bug: «Saqlash va yakunlash» after the pushed steps → the index, not `ish`.
    [[B, P, S("shaxsiy"), S("oqish"), S("ish"), S("korinish")], { kind: "back", index: 1 }],
    [[B, P, S("xavfsizlik")], { kind: "back", index: 1 }],
    [[B, P, P, S("shaxsiy")], { kind: "back", index: 1 }],
    // Deep-linked step(s): back to the first of them and replace it with the index.
    [[S("shaxsiy"), S("oqish"), S("korinish")], { kind: "back-replace", index: 0 }],
    [[B, S("shaxsiy"), S("oqish")], { kind: "back-replace", index: 1 }],
    [["/uz/files", S("ish"), S("korinish")], { kind: "back-replace", index: 1 }],
    // Nothing to collapse: replace the current page.
    [[S("korinish")], { kind: "replace" }],
    [[B, S("korinish")], { kind: "replace" }],
    [[null, S("ish")], { kind: "replace" }],
    [[], { kind: "replace" }],
  ];
  for (const [stack, want] of rows) {
    const plan = returnPlan(stack, P);
    assert.equal(plan.kind, want.kind, JSON.stringify(stack));
    if (plan.kind !== "replace") assert.equal(plan.index, want.index, JSON.stringify(stack));
  }
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

test("UI copy names the files tab «Ishlarim» (the old «Mening fayllarim» survives only in code comments)", () => {
  const files = ["components/files/ResultView.tsx", "components/viewers/LiveStrip.tsx", "lib/api-client.ts"];
  for (const f of files) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    const copy = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    assert.ok(!copy.some((l) => l.includes("Mening fayllarim")), `${f}: «Mening fayllarim» in UI copy`);
    assert.ok(copy.some((l) => l.includes("«Ishlarim»")), `${f}: points to «Ishlarim»`);
  }
});
