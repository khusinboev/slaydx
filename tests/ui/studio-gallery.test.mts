import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { USER, installApi, json } from "./studio-fixtures.ts";

const nav = await import("../../lib/nav/history.ts");
const { Gallery, formatStamp } = await import("../../components/studio/Gallery.tsx");
const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { parseGalleryPage } = await import("../../components/studio/studio-api.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { useAppStore } = await import("../../lib/store.ts");

/**
 * Gallery view (`GET /api/media/gallery?cursor=`, newest first, 24 per page).
 *
 * Locked here:
 *   - PAGING: the first page is requested without a cursor, «Yana ko'rsatish» asks for `?cursor=<nextCursor>` and
 *     APPENDS (a repeated id is not shown twice); no `nextCursor` → no button; the end of the list scrolling into view
 *     loads the next page too, and the observer and the button never fetch the same cursor twice;
 *   - cards: thumbnail from the API's list or, without one, the existing `/api/generations/<id>/thumb`; «×N» for a job of
 *     several pictures; the prompt, model and date; a card opens the full result page; «Boshqa modelda» hands the item back;
 *   - states: loading skeleton, empty (with «Rasm yaratish»), first-page error with a retry, a later page's error keeps the list;
 *   - the parser accepts the contract's snake_case and camelCase and drops rows without an id;
 *   - inside the Studio page the gallery has its own history entry: the phone's back returns to the form.
 *
 * Mutations (each turned the named tests red, then restored):
 *   `fetchGallery` ignores the cursor                                    -> «PAGING», «observer…», «states…» (3 of 7);
 *   page 2 REPLACES the list instead of appending                        -> «PAGING», «observer…»;
 *   no id de-duplication                                                 -> «PAGING»;
 *   the observer calls `load(cursor)` without the `busy` guard           -> «observer…one request»;
 *   thumbnail falls back to the full file URL                            -> «cards: API thumbnail list…»;
 *   `parseItem` reads only `createdAt`                                   -> «parser»;
 *   `useOverlayHistory(view === "gallery", …)` removed                   -> «back returns to the form».
 */

const tree = (href: string) => ["", { children: [href] }];
const router = {
  push(href: string) {
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  replace(href: string) {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  refresh() {},
  back() {
    window.history.back();
  },
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;
const realFetch = globalThis.fetch;
const g = globalThis as unknown as { IntersectionObserver?: unknown };

afterEach(async () => {
  cleanup();
  await settle();
  nav.__resetNavForTests();
  globalThis.fetch = realFetch;
  delete g.IntersectionObserver;
  dropMediaCatalog();
  useAppStore.setState({ loggedIn: false, sessionChecked: false, user: null });
});

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
}
const click = async (el: Element | null | undefined) => {
  assert.ok(el, "element to click");
  await act(async () => void fireEvent.click(el));
};
const ids = () => qa("[data-gallery-item]").map((e) => e.getAttribute("data-gallery-item"));
const item = (id: string, patch: Record<string, unknown> = {}) => ({
  id, createdAt: "2026-11-01T10:05:00.000Z", modelId: "google/nano-banana", modelLabel: "Nano Banana", prompt: `Prompt ${id}`, count: 1, ...patch,
});
const mount = (props: Partial<Parameters<typeof Gallery>[0]> = {}) =>
  render(h(AppRouterContext.Provider, { value: router }, h(Gallery, { onOtherModel: () => {}, onCreate: () => {}, ...props })));

test("PAGING: first page without a cursor, «Yana ko'rsatish» asks for ?cursor= and appends (no repeats); the last page has no button", async () => {
  const api = installApi({
    gallery: {
      "": { items: [item("g1"), item("g2")], nextCursor: "c1" },
      c1: { items: [item("g2"), item("g3")], nextCursor: "c2" },
      c2: { items: [item("g4")], nextCursor: null },
    },
  });
  mount();
  assert.ok(q("[data-gallery-loading]"), "skeleton first");
  await settle();
  assert.deepEqual(ids(), ["g1", "g2"]);
  const gallery = () => api.calls.filter((c) => c.url.startsWith("/api/media/gallery")).map((c) => c.url);
  assert.deepEqual(gallery(), ["/api/media/gallery"], "MUTATSIYA: birinchi so'rov kursorsiz");
  await click(q("[data-gallery-more]"));
  await settle();
  assert.deepEqual(ids(), ["g1", "g2", "g3"], "MUTATSIYA: ro'yxat almashsa / takror chiqsa qizaradi");
  assert.deepEqual(gallery(), ["/api/media/gallery", "/api/media/gallery?cursor=c1"], "MUTATSIYA: kursor e'tiborsiz bo'lsa qizaradi");
  await click(q("[data-gallery-more]"));
  await settle();
  assert.deepEqual(ids(), ["g1", "g2", "g3", "g4"]);
  assert.equal(gallery()[2], "/api/media/gallery?cursor=c2");
  assert.ok(!q("[data-gallery-more]"), "no nextCursor: no button");
});

test("observer: the end of the list scrolling into view loads the next page; observer + button make ONE request for a cursor", async () => {
  const observers: Array<{ cb: (e: Array<{ isIntersecting: boolean }>) => void; disconnected: boolean }> = [];
  g.IntersectionObserver = class {
    entry: { cb: (e: Array<{ isIntersecting: boolean }>) => void; disconnected: boolean };
    constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
      this.entry = { cb, disconnected: false };
      observers.push(this.entry);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.entry.disconnected = true;
    }
  };
  let release: (() => void) | null = null;
  let asked = 0;
  installApi({ gallery: { "": { items: [item("g1")], nextCursor: "c1" }, c1: { items: [item("g2")], nextCursor: null } } });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    // Hold the second page so the observer and the button overlap.
    if (String(input) === "/api/media/gallery?cursor=c1") {
      asked++;
      await new Promise<void>((r) => (release = r));
    }
    return inner(input as string, init);
  };
  mount();
  await settle();
  const live = observers.filter((o) => !o.disconnected);
  assert.equal(live.length, 1, "one observer while there is a next page");
  await act(async () => live[0]!.cb([{ isIntersecting: true }]));
  await click(q("[data-gallery-more]"));
  await act(async () => live[0]!.cb([{ isIntersecting: true }]));
  assert.equal(asked, 1, "MUTATSIYA: busy qo'riqchisiz ikki so'rov ketadi");
  await act(async () => release?.());
  await settle();
  assert.deepEqual(ids(), ["g1", "g2"]);
  assert.ok(observers.every((o) => o.disconnected), "no next page: the observer is gone");
});

test("cards: API thumbnail list or the existing thumb endpoint; «×N»; prompt, model, date; links to the result page", async () => {
  installApi({
    gallery: {
      "": {
        items: [
          item("t1", { thumbs: ["/api/generations/t1/assets/a", "/api/generations/t1/assets/b"], count: 2 }),
          item("t2", { fileVersion: 3 }),
        ],
        nextCursor: null,
      },
    },
  });
  mount();
  await settle();
  const src = (id: string) => q<HTMLImageElement>(`[data-gallery-item="${id}"] img`)!.getAttribute("src");
  assert.equal(src("t1"), "/api/generations/t1/assets/a");
  assert.equal(src("t2"), "/api/generations/t2/thumb?v=3", "MUTATSIYA: kichik rasm o'rniga to'liq fayl bo'lsa qizaradi");
  assert.equal(q('[data-gallery-item="t1"] [data-gallery-count]')?.textContent, "×2");
  assert.ok(!q('[data-gallery-item="t2"] [data-gallery-count]'), "a single picture has no badge");
  const card = q('[data-gallery-item="t1"]')!;
  assert.match(card.textContent ?? "", /Prompt t1/);
  assert.match(card.textContent ?? "", /Nano Banana/);
  assert.match(card.textContent ?? "", /\d\d\.11\.2026 \d\d:\d\d/, "a fixed, ICU-free date");
  assert.equal(card.querySelector("a")?.getAttribute("href"), "/uz/files/t1");
});

test("«Boshqa modelda» hands the item (its prompt) back to the page", async () => {
  installApi({ gallery: { "": { items: [item("o1"), item("o2")], nextCursor: null } } });
  const got: string[] = [];
  mount({ onOtherModel: (it) => void got.push(it.prompt) });
  await settle();
  await click(q('[data-gallery-item="o2"] [data-gallery-other-model]'));
  assert.deepEqual(got, ["Prompt o2"]);
});

test("states: empty offers «Rasm yaratish»; a first-page error has a retry; a later page's error keeps the list", async () => {
  installApi({ gallery: { "": { items: [], nextCursor: null } } });
  let created = 0;
  mount({ onCreate: () => void created++ });
  await settle();
  assert.ok(q("[data-gallery-empty]"));
  await click(q("[data-gallery-empty] button"));
  assert.equal(created, 1);
  cleanup();

  let fail = true;
  let asked = 0;
  installApi({ gallery: { "": { items: [item("e1")], nextCursor: null } } });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    if (String(input).startsWith("/api/media/gallery")) asked++;
    return fail && String(input).startsWith("/api/media/gallery") ? json(500, {}) : inner(input as string, init);
  };
  mount();
  await settle();
  assert.ok(q("[data-gallery-error]"), "first-page error");
  assert.ok(!q("[data-gallery]"));
  fail = false;
  await click(q("[data-gallery-error] button"));
  await settle();
  assert.deepEqual(ids(), ["e1"]);
  assert.equal(asked, 2, "the retry asked once more");
  cleanup();

  const pages: Record<string, unknown> = { "": { items: [item("p1")], nextCursor: "c1" } };
  installApi({ gallery: pages });
  mount();
  await settle();
  await click(q("[data-gallery-more]"));
  await settle();
  assert.ok(q("[data-gallery-error]"), "page 2 failed (404 in the stub)");
  assert.deepEqual(ids(), ["p1"], "the list stays");
  assert.ok(q("[data-gallery-more]"), "and can be retried");
});

test("parser: contract's snake_case and camelCase both read; a row without an id is dropped", () => {
  const page = parseGalleryPage({
    items: [
      { id: "a", created_at: "2026-11-01T08:00:00Z", model_label: "GPT", model_id: "openai/gpt-image", prompt: "p", thumbs: ["/t/a"] },
      { id: "b", createdAt: "2026-11-02T08:00:00Z", modelLabel: "Nano", prompt: "q", imageCount: 4 },
      { prompt: "no id" },
      "junk",
    ],
    nextCursor: "next",
  });
  assert.equal(page.nextCursor, "next");
  assert.deepEqual(page.items.map((i) => i.id), ["a", "b"]);
  assert.equal(page.items[0]!.createdAt, "2026-11-01T08:00:00Z", "MUTATSIYA: faqat createdAt o'qilsa qizaradi");
  assert.equal(page.items[0]!.modelLabel, "GPT");
  assert.equal(page.items[0]!.modelId, "openai/gpt-image");
  assert.equal(page.items[1]!.count, 4);
  assert.deepEqual(page.items[0]!.thumbs, ["/t/a"]);
  assert.deepEqual(parseGalleryPage(null), { items: [], nextCursor: null });
  assert.equal(formatStamp("nope"), "");
});

test("inside the Studio page the gallery has its own history entry: back returns to the form, not off the page", async () => {
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/studio");
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  installApi({ gallery: { "": { items: [item("h1")], nextCursor: null } } });
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: USER as never });
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
  const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
  await click(q("[data-studio-gallery-link]"));
  await settle();
  assert.ok(q("[data-studio-gallery]"));
  assert.ok(sx()?.o, "the gallery owns a history entry");
  await act(async () => {
    window.history.back();
  });
  await settle();
  assert.ok(!q("[data-studio-gallery]"), "MUTATSIYA: tarix yozuvi bo'lmasa orqaga sahifadan chiqib ketadi — qizaradi");
  assert.ok(q("[data-studio-form]"), "back to the form");
  assert.equal(window.location.pathname, "/uz/studio");
});
