import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * `useLeaveGuard` — owner decision 1 (docs/nav/PLAN.md): unsaved edits are
 * auto-saved, then the navigation continues; a failed save keeps the user on
 * the page and reports the error. Covers the three exits: `backTo()` («←»,
 * Telegram), the phone's back (guard entry popstate) and internal links.
 *
 * Mutations, each caught here:
 *   - `backTo` does not consult the guards → "backTo saves first" fails;
 *   - the capture click listener ignores guards → "internal link" fails;
 *   - a failed back-press save does not re-arm → "back press, save fails" fails.
 */

const nav = await import("../../lib/nav/history.ts");
const { useLeaveGuard } = await import("../../components/nav/useLeaveGuard.ts");

const calls: string[] = [];
const tree = (href: string) => ["", { children: [href] }];
const router = {
  push(href: string) {
    calls.push(`push ${href}`);
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  replace(href: string) {
    calls.push(`replace ${href}`);
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
const here = () => window.location.pathname + window.location.search;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

function fresh(path: string) {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
}

let saveOk = true;
let saves = 0;
const errors: string[] = [];
let setPending: (n: number) => void = () => {};
let lastSaving = false;

/** Like `useDocEdit().save`: resolves `true` and clears the queue, or `false` and keeps it. */
async function save(): Promise<boolean> {
  saves++;
  await new Promise((r) => setTimeout(r, 1));
  if (saveOk) setPending(0);
  return saveOk;
}

function Editor() {
  const [pending, set] = useState(0);
  setPending = set;
  const { saving } = useLeaveGuard(pending, save, { onError: (e) => errors.push(e instanceof Error ? e.message : String(e)) });
  lastSaving = saving;
  return h("div", null, h("a", { href: "/uz/create" }, "Yaratish"), h("span", null, `pending ${pending}`));
}

function mount() {
  saves = 0;
  errors.length = 0;
  render(h(AppRouterContext.Provider, { value: router }, h(Editor)));
}

afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  saveOk = true;
});

test("guard entry exists only while edits are pending; Telegram snapshot follows", async () => {
  fresh("/uz/files/1");
  mount();
  assert.equal(sx()?.i, 0);
  act(() => setPending(2));
  await settle();
  assert.equal(sx()?.i, 1);
  assert.ok(sx()?.o);
  assert.equal(nav.getNavSnapshot().guardPending, true);
  assert.equal(nav.getNavSnapshot().overlays, 0, "a guard is not an overlay (BackButton logic)");
  act(() => setPending(0)); // saved by the user's own «Saqlash»
  await settle();
  assert.equal(sx()?.i, 0, "the guard entry is popped exactly once");
  assert.equal(here(), "/uz/files/1");
  assert.equal(nav.getNavSnapshot().guardPending, false);
});

test("backTo saves first, then goes back (one traversal over guard + page)", async () => {
  fresh("/uz");
  router.push("/uz/files/1");
  calls.length = 0;
  mount();
  act(() => setPending(1));
  assert.equal(sx()?.i, 2);
  let started = false;
  await act(async () => {
    started = await nav.backTo();
  });
  await settle();
  assert.equal(saves, 1);
  assert.equal(started, true);
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0);
  assert.deepEqual(calls, []);
});

test("backTo: save fails → stays on the page, error surfaced, guard still armed", async () => {
  fresh("/uz");
  router.push("/uz/files/1");
  calls.length = 0;
  mount();
  act(() => setPending(1));
  saveOk = false;
  let started = true;
  await act(async () => {
    started = await nav.backTo();
  });
  await settle();
  assert.equal(started, false);
  assert.equal(saves, 1);
  assert.deepEqual(errors, ["save failed"]);
  assert.equal(here(), "/uz/files/1");
  assert.equal(sx()?.i, 2);
  assert.ok(sx()?.o);
  assert.equal(lastSaving, false);
});

test("phone back press: guard entry pops, auto-save, then the navigation continues", async () => {
  fresh("/uz");
  router.push("/uz/files/1");
  mount();
  act(() => setPending(3));
  window.history.back();
  await settle();
  await settle();
  assert.equal(saves, 1);
  assert.equal(here(), "/uz");
  assert.equal(sx()?.i, 0);

  // Fresh deep link: after the save the page is replaced by its parent (redesign: Ishlarim `/uz/files`).
  cleanup();
  fresh("/uz/files/2");
  mount();
  act(() => setPending(1));
  window.history.back();
  await settle();
  await settle();
  assert.equal(saves, 1);
  assert.deepEqual(calls, ["replace /uz/files"]);
  assert.equal(here(), "/uz/files");
});

test("root with no in-app history (/o from a QR code): a let-through back press does the real back", async () => {
  window.history.pushState(null, "", "/somewhere-before");
  fresh("/o/Ab3dEf");
  mount();
  act(() => setPending(1));
  window.history.back();
  await settle();
  await settle();
  assert.equal(saves, 1);
  assert.deepEqual(calls, [], "no parent to replace with");
  assert.equal(here(), "/somewhere-before", "left as the user asked");
});

test("phone back press, save fails: stays, error surfaced, guard entry re-armed", async () => {
  fresh("/uz");
  router.push("/uz/files/1");
  mount();
  act(() => setPending(1));
  saveOk = false;
  window.history.back();
  await settle();
  await settle();
  assert.equal(saves, 1);
  assert.deepEqual(errors, ["save failed"]);
  assert.equal(here(), "/uz/files/1");
  assert.equal(sx()?.i, 2, "guard pushed again");
  assert.ok(sx()?.o);
  // The next back press tries again.
  saveOk = true;
  window.history.back();
  await settle();
  await settle();
  assert.equal(saves, 2);
  assert.equal(here(), "/uz");
});

test("internal link while pending: save, then navigate (guard entry replaced); failure stays", async () => {
  let prevented: boolean | null = null;
  const probe = (e: Event) => {
    prevented = e.defaultPrevented;
    e.preventDefault(); // jsdom cannot navigate
  };
  window.addEventListener("click", probe);
  try {
    fresh("/uz");
    router.push("/uz/files/1");
    calls.length = 0;
    mount();
    const link = document.querySelector("a")!;

    // No pending edits: the click is not touched.
    fireEvent.click(link);
    assert.equal(prevented, false);
    assert.equal(saves, 0);

    act(() => setPending(1));
    prevented = null;
    fireEvent.click(link);
    assert.equal(prevented, null, "stopped in the capture phase before anything else saw it");
    await settle();
    assert.equal(saves, 1);
    assert.deepEqual(calls, ["replace /uz/create"]);
    window.history.back();
    await settle();
    assert.equal(here(), "/uz/files/1", "back returns to the editor page, not to its guard entry");

    cleanup();
    fresh("/uz/files/1");
    mount();
    act(() => setPending(1));
    saveOk = false;
    fireEvent.click(document.querySelector("a")!);
    await settle();
    assert.equal(saves, 1);
    assert.deepEqual(calls, []);
    assert.deepEqual(errors, ["save failed"]);
    assert.equal(here(), "/uz/files/1");
  } finally {
    window.removeEventListener("click", probe);
  }
});
