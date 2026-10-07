import "./setup.ts";
import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * Back navigation, work package N2 (docs/nav/PLAN.md): the result page, the
 * viewers and unsaved edits, on the real N0 history engine (jsdom history).
 *
 *   - ResultView «←» is a `<BackLink>`: back to the page we came from, or the
 *     parent `/uz` (replace) on a fresh deep link; delete REPLACES with `/uz`.
 *   - Slide present mode, SlideToolbar «Boshqa amallar» and the viewer
 *     toolbar «⋯» menu own one history entry each: back closes them, any
 *     other close pops exactly once. Leaving fullscreen closes present mode
 *     and pops once, never twice (Android Chrome's first back).
 *   - `useDocEdit` (owner decision 1): pending edits are SAVED before a back
 *     press / «←» / internal link leaves the page; a failed save keeps the
 *     user on the page with the usual error; the file rebuild is not awaited.
 *
 * Mutations, each caught here (see the N2 report):
 *   - ResultView «←» back to `<Link href="/uz">` → "«←» after generation" fails;
 *   - delete `router.push` → "delete replaces" fails;
 *   - `useOverlayHistory` removed from present / either menu → the matching
 *     "back closes" test fails;
 *   - `useLeaveGuard` removed from `useDocEdit` → "phone back saves first" fails;
 *   - leave save awaiting the rebuild → "rebuild is not awaited" fails.
 */

const nav = await import("../../lib/nav/history.ts");
const { ResultView } = await import("../../components/files/ResultView.tsx");
const { SlideViewer } = await import("../../components/viewers/SlideViewer.tsx");
const { ViewerToolbar } = await import("../../components/viewers/toolbar.tsx");
const { useSlideEdit } = await import("../../components/files/useSlideEdit.ts");
const { useAppStore } = await import("../../lib/store.ts");
const { CONFIRM_MIN_MS } = await import("../../components/overlays/useConfirmClick.ts");
const { applyDocOps } = await import("../../lib/generation/slide-edit.ts");

if (!("IntersectionObserver" in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

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
  back() {
    window.history.back();
  },
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
const here = () => window.location.pathname + window.location.search;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

/** A fresh tab at `path`: engine reset, one unstamped entry. */
function fresh(path: string) {
  nav.__resetNavForTests();
  window.history.pushState(null, "", path);
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  calls.length = 0;
}

const realFetch = globalThis.fetch;
before(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});
afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const withRouter = (node: React.ReactElement) => h(AppRouterContext.Provider, { value: router }, node);

// ═══════════════════════════════════════════════ ResultView

const ID = "11111111-1111-4111-8111-111111111111";

function resultGen() {
  return {
    id: ID,
    type: "referat",
    topic: "Iqlim o'zgarishi",
    status: "COMPLETED",
    createdAt: "2026-09-23T08:00:00.000Z",
    finishedAt: "2026-09-23T08:01:00.000Z",
    price: 3000,
    fileName: "referat.docx",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    preview: null,
    html: null,
    doc: null,
    hasFile: true,
    docVersion: 1,
    fileVersion: 1,
  };
}

function stubResult(): string[] {
  const seen: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    seen.push(`${method} ${url}`);
    if (url === "/api/auth/session") return json(200, { user: null, features: null });
    if (url === `/api/generations/${ID}` && method === "GET") return json(200, { generation: resultGen() });
    if (url === `/api/generations/${ID}` && method === "DELETE") return json(200, { ok: true, refunded: false });
    return json(404, { error: "yo'q" });
  };
  return seen;
}

async function mountResult() {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: false, payme: false } },
  });
  useAppStore.setState({ refreshSession: async () => {} });
  render(withRouter(h(ResultView, { id: ID })));
  for (let k = 0; k < 50 && !document.querySelector('a[aria-label="Orqaga"]'); k++) await settle();
  const back = document.querySelector<HTMLAnchorElement>('a[aria-label="Orqaga"]');
  assert.ok(back, "«←» rendered");
  return back;
}

test("ResultView «←» after generation: back to the filled form (no push → no ping-pong)", async () => {
  stubResult();
  fresh("/uz/slide");
  router.push(`/uz/files/${ID}`); // the composer's push after «Yaratish»
  calls.length = 0;
  const back = await mountResult();
  assert.equal(back.getAttribute("href"), "/uz", "a real link to the parent (open in new tab works)");
  await act(async () => {
    fireEvent.click(back);
  });
  await settle();
  assert.equal(here(), "/uz/slide", "back on the form");
  assert.deepEqual(calls, [], "history back, not a push of /uz");
  assert.equal(sx()?.i, 0);
});

test("ResultView «←» on a fresh deep link: REPLACE with its parent, the Ishlarim list /uz/files (never leaves the site)", async () => {
  stubResult();
  fresh(`/uz/files/${ID}`);
  const back = await mountResult();
  await act(async () => {
    fireEvent.click(back);
  });
  await settle();
  assert.deepEqual(calls, ["replace /uz/files"], "redesign F0: the file page goes back to the list");
  assert.equal(here(), "/uz/files");
});

test("ResultView delete replaces the page with /uz (the deleted page leaves history)", async () => {
  const seen = stubResult();
  fresh("/uz");
  router.push(`/uz/files/${ID}`);
  calls.length = 0;
  await mountResult();
  // Mobile sprint (PLAN §4.5): delete lives in the «⋯» overflow; the menu item arms the
  // two-step confirm and closes the menu (its history entry), «Rostdan?» replaces «⋯».
  await act(async () => {
    fireEvent.click(document.querySelector("[data-more-button]")!);
  });
  await settle();
  const item = document.querySelector('[data-menu-item="delete"]') as HTMLElement | null;
  assert.ok(item, "«O’chirish» is in the overflow menu");
  assert.match(item!.textContent ?? "", /O’chirish/);
  await act(async () => {
    fireEvent.click(item!);
  });
  await settle();
  assert.ok(!document.querySelector("[data-result-menu]"), "the menu closed");
  assert.ok(!seen.includes(`DELETE /api/generations/${ID}`), "the first step only arms");
  await act(async () => {
    await new Promise((r) => setTimeout(r, CONFIRM_MIN_MS + 20));
  });
  const confirm = document.querySelector("[data-delete-confirm]") as HTMLElement | null;
  assert.ok(confirm, "«Rostdan?» replaced «⋯»");
  assert.match(confirm!.textContent ?? "", /Rostdan\?/);
  await act(async () => {
    fireEvent.click(confirm!);
  });
  await settle();
  assert.ok(seen.includes(`DELETE /api/generations/${ID}`));
  assert.deepEqual(calls, ["replace /uz"]);
  assert.equal(sx()?.i, 1, "same history slot: back from /uz does not return to the deleted page");
});

// ═══════════════════════════════════════════════ Slide viewer: present mode and menu

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh" },
  { id: "s1", layout: "bullets", title: "Birinchi", bullets: ["Bir", "Ikki"] },
];

function makeDoc(list: SlideModel[] = slides): AcademicDoc {
  return {
    meta: { topic: "Mavzu", author: "Aliyev", workLabel: "Taqdimot", language: "uz", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides: list,
  } as unknown as AcademicDoc;
}

function slideGen(doc: AcademicDoc, version = 1) {
  return { id: "gen1", type: "slide", status: "COMPLETED", doc, docVersion: version, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

const presenting = () => document.querySelector("[data-slide-stage]")?.getAttribute("data-slide-stage") === "present";

/** jsdom has no Fullscreen API: a controllable `document.fullscreenElement`. */
let fsEl: Element | null = null;
Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fsEl });

async function openPresent() {
  fresh("/uz/files/1");
  router.push("/uz/files/2");
  calls.length = 0;
  render(withRouter(h(SlideViewer, { doc: makeDoc(), gen: slideGen(makeDoc()) })));
  await act(async () => {
    fireEvent.click(screen.getByLabelText("To‘liq ekran"));
  });
  await settle();
  assert.ok(presenting());
  assert.equal(sx()?.i, 2, "present mode pushed its own entry");
  assert.ok(sx()?.o);
}

test("present mode: phone back exits present, the URL stays", async () => {
  await openPresent();
  window.history.back();
  await settle();
  assert.ok(!presenting(), "back closed present mode");
  assert.equal(here(), "/uz/files/2");
  assert.equal(sx()?.i, 1);
  // The next back leaves the page as usual.
  window.history.back();
  await settle();
  assert.equal(here(), "/uz/files/1");
});

test("present mode: X / Escape close and pop the entry exactly once", async () => {
  await openPresent();
  const x = document.querySelector<HTMLButtonElement>(".fixed.inset-0 button:last-of-type")!;
  await act(async () => {
    fireEvent.click(x);
  });
  await settle();
  assert.ok(!presenting());
  assert.equal(sx()?.i, 1, "popped once (not twice: still on the result page)");
  assert.equal(here(), "/uz/files/2");

  await act(async () => {
    fireEvent.keyDown(document.body, { key: "f" });
  });
  await settle();
  assert.ok(presenting());
  assert.equal(sx()?.i, 2);
  await act(async () => {
    fireEvent.keyDown(document.body, { key: "Escape" });
  });
  await settle();
  assert.ok(!presenting());
  assert.equal(sx()?.i, 1);
  assert.equal(here(), "/uz/files/2");
});

test("present mode: leaving fullscreen closes present and pops once (Android Chrome's first back)", async () => {
  await openPresent();
  fsEl = document.documentElement;
  await act(async () => {
    document.dispatchEvent(new window.Event("fullscreenchange"));
  });
  assert.ok(presenting(), "entering fullscreen keeps present mode");
  // Android: the system back only exits fullscreen (no popstate).
  fsEl = null;
  await act(async () => {
    document.dispatchEvent(new window.Event("fullscreenchange"));
  });
  await settle();
  assert.ok(!presenting());
  assert.equal(sx()?.i, 1, "the present entry popped once");
  assert.equal(here(), "/uz/files/2");
});

test("present mode: fullscreen exit AND a popstate for the same press never pop twice", async () => {
  await openPresent();
  fsEl = document.documentElement;
  window.history.back();
  fsEl = null;
  await act(async () => {
    document.dispatchEvent(new window.Event("fullscreenchange"));
  });
  await settle();
  assert.ok(!presenting());
  assert.equal(sx()?.i, 1);
  assert.equal(here(), "/uz/files/2", "still on the result page");
});

test("SlideToolbar «Boshqa amallar»: back closes the menu (URL stays); Escape pops once", async () => {
  fresh("/uz/files/1");
  render(withRouter(h(SlideViewer, { doc: makeDoc(), gen: slideGen(makeDoc()) })));
  const more = document.querySelector<HTMLButtonElement>("[data-slide-more]")!;
  await act(async () => {
    fireEvent.click(more);
  });
  await settle();
  assert.ok(document.querySelector("[data-slide-more-panel]"));
  assert.equal(sx()?.i, 1);
  window.history.back();
  await settle();
  assert.ok(!document.querySelector("[data-slide-more-panel]"), "back closed the menu");
  assert.equal(here(), "/uz/files/1");
  assert.equal(sx()?.i, 0);

  await act(async () => {
    fireEvent.click(more);
  });
  await settle();
  assert.equal(sx()?.i, 1);
  await act(async () => {
    fireEvent.keyDown(document.querySelector("[data-slide-more-panel]")!, { key: "Escape" });
  });
  await settle();
  assert.ok(!document.querySelector("[data-slide-more-panel]"));
  assert.equal(sx()?.i, 0, "popped exactly once");
  assert.equal(here(), "/uz/files/1");
});

test("viewer toolbar «⋯» menu: back closes it; an outside tap closes and pops once", async () => {
  fresh("/uz/files/1");
  const right = h("button", { type: "button" }, "Tahrirlash");
  const { container } = render(
    withRouter(h(ViewerToolbar, { zoom: 100, onZoom: () => {}, page: 1, pages: 2, onPage: () => {}, right, view: "page", onView: () => {} })),
  );
  const trigger = container.querySelector<HTMLButtonElement>("[data-viewer-more]")!;
  await act(async () => {
    fireEvent.click(trigger);
  });
  await settle();
  assert.ok(container.querySelector("[data-viewer-more-panel]"));
  assert.equal(sx()?.i, 1);
  window.history.back();
  await settle();
  assert.ok(!container.querySelector("[data-viewer-more-panel]"), "back closed the menu");
  assert.equal(sx()?.i, 0);
  assert.equal(here(), "/uz/files/1");

  await act(async () => {
    fireEvent.click(trigger);
  });
  await settle();
  await act(async () => {
    fireEvent.pointerDown(document.body);
  });
  await settle();
  assert.ok(!container.querySelector("[data-viewer-more-panel]"));
  assert.equal(sx()?.i, 0, "popped exactly once");
  assert.equal(here(), "/uz/files/1");
});

// ═══════════════════════════════════════════════ useDocEdit: auto-save, then leave

type Srv = {
  version: number;
  doc: AcademicDoc;
  patches: string[];
  failPatch: boolean;
  /** Set: `/rebuild` waits for it (a slow server-side rebuild). */
  rebuildGate: Promise<void> | null;
  rebuilds: number;
};

function stubEditServer(): Srv {
  const s: Srv = { version: 1, doc: makeDoc(), patches: [], failPatch: false, rebuildGate: null, rebuilds: 0 };
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (method === "PATCH" && url.endsWith("/doc")) {
      s.patches.push(here()); // where the user still is when the PATCH goes out
      if (s.failPatch) return json(503, { error: "Server javob bermadi" });
      const body = JSON.parse(String(opts?.body)) as { ops: Parameters<typeof applyDocOps>[1] };
      const res = applyDocOps(s.doc, body.ops, { genId: "gen1" });
      if (!res.ok) return json(422, { error: res.error });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: slideGen(s.doc, s.version) });
    }
    if (method === "POST" && url.endsWith("/rebuild")) {
      s.rebuilds += 1;
      if (s.rebuildGate) await s.rebuildGate;
      return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    }
    return json(200, { generation: slideGen(s.doc, s.version) });
  };
  return s;
}

let hook: ReturnType<typeof useSlideEdit> | null = null;
function Editor({ gen }: { gen: unknown }) {
  hook = useSlideEdit({ gen, savedFlashMs: 5 });
  return h("div", null, h("a", { href: "/uz/create" }, "Yaratish"), h("span", null, `pending ${hook.pending}`));
}

async function typeChange(s: Srv) {
  fresh("/uz/slide");
  router.push("/uz/files/gen1");
  calls.length = 0;
  render(withRouter(h(Editor, { gen: slideGen(s.doc) })));
  await act(async () => {
    hook!.run([{ op: "text", index: 1, src: { f: "title" }, value: "Yangi sarlavha" }]);
  });
  await settle();
  assert.equal(hook!.pending, 1);
  assert.equal(sx()?.i, 2, "the guard entry is on top of the result page");
  assert.equal(nav.getNavSnapshot().guardPending, true, "Telegram closing confirmation on");
}

test("useDocEdit: phone back with «Saqlash · 1» pending saves first, then goes back", async () => {
  const s = stubEditServer();
  await typeChange(s);
  window.history.back();
  for (let k = 0; k < 4; k++) await settle();
  assert.deepEqual(s.patches, ["/uz/files/gen1"], "the PATCH went out before leaving");
  assert.equal(s.doc.slides?.[1]?.title, "Yangi sarlavha", "the change is on the server");
  assert.equal(here(), "/uz/slide", "then the back press continued to the form");
  assert.equal(sx()?.i, 0);
});

test("useDocEdit: «←» (backTo) saves first; the file rebuild is not awaited", async () => {
  const s = stubEditServer();
  let release = () => {};
  s.rebuildGate = new Promise<void>((r) => (release = r));
  await typeChange(s);
  let started: Promise<boolean> = Promise.resolve(false);
  act(() => {
    started = nav.backTo();
  });
  for (let k = 0; k < 4; k++) await settle();
  try {
    assert.equal(s.patches.length, 1);
    assert.equal(s.rebuilds, 1, "the rebuild still starts (in the background)");
    assert.equal(here(), "/uz/slide", "navigation did not wait for the rebuild");
  } finally {
    release();
    await settle();
  }
  assert.equal(await started, true);
});

test("useDocEdit: internal link with pending edits saves first, then navigates", async () => {
  const s = stubEditServer();
  await typeChange(s);
  await act(async () => {
    fireEvent.click(screen.getByText("Yaratish"));
  });
  for (let k = 0; k < 4; k++) await settle();
  assert.deepEqual(s.patches, ["/uz/files/gen1"]);
  assert.equal(here(), "/uz/create");
});

test("useDocEdit: the save fails → the user stays, the usual error shows, the guard re-arms", async () => {
  const s = stubEditServer();
  s.failPatch = true;
  await typeChange(s);
  window.history.back();
  for (let k = 0; k < 4; k++) await settle();
  assert.equal(s.patches.length, 1);
  assert.equal(here(), "/uz/files/gen1", "stayed on the page");
  assert.equal(hook!.pending, 1, "the queue is intact");
  assert.equal(hook!.saveFailed, true, "«Qayta urinish · N»");
  assert.match(hook!.error ?? "", /Saqlanmadi/);
  assert.equal(sx()?.i, 2, "guard entry pushed again: the next back retries");

  // «←» also stays while the server keeps failing.
  let started = true;
  await act(async () => {
    started = await nav.backTo();
  });
  await settle();
  assert.equal(started, false);
  assert.equal(here(), "/uz/files/gen1");

  // Server back: the next back press saves and leaves.
  s.failPatch = false;
  window.history.back();
  for (let k = 0; k < 4; k++) await settle();
  assert.equal(s.doc.slides?.[1]?.title, "Yangi sarlavha");
  assert.equal(here(), "/uz/slide");
});

test("useDocEdit: the user's own «Saqlash» drops the guard entry (one pop), beforeunload stays while pending", async () => {
  const s = stubEditServer();
  await typeChange(s);
  const ev = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, "tab close still warns");
  await act(async () => {
    await hook!.save();
  });
  await settle();
  assert.equal(hook!.pending, 0);
  assert.equal(sx()?.i, 1, "guard entry popped once, still on the result page");
  assert.equal(here(), "/uz/files/gen1");
  assert.equal(nav.getNavSnapshot().guardPending, false);
});
