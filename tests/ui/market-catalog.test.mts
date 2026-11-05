import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { USER, card, json, list, stubFetch, withRouter, type Req } from "./market-fixture.ts";

/**
 * «Ishlar bozori» catalog (`components/market/MarketCatalog.tsx`, docs/market/PLAN.md §5.2).
 *
 * Mutations (each turned this file red, restored byte for byte):
 *   M1 catalog effect: always refetch (drop the `initialKey` check) → «the server's first page is not asked again»;
 *   M2 `apply`: no `replaceSearch` → «a chip updates the query»;
 *   M3 search effect: no `SEARCH_MIN` guard → «search waits for two characters»;
 *   M4 `load`: no `seen` set → «the next page appends, a repeated row once»;
 *   M5 `if (status === "closed" || !live)`: drop `!live` → «dark: a calm page, no request»;
 *   M6 `isClosed`: always false → «switched off mid-visit»;
 *   M7 card `off > 0`: always draw the badge → «no discount, no badge»;
 *   M8 `MarketCover`: no `onError` → «a busy preview keeps a neutral face»;
 *   M9 empty state: no `dirty` branch → «no results» test;
 *   M10 `FilterSheet`: `useDialog(false, …)` → «Escape closes the filter sheet».
 */

const { MarketCatalog } = await import("../../components/market/MarketCatalog.tsx");
const { useAppStore } = await import("../../lib/store.ts");

const realFetch = globalThis.fetch;
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const listCalls = (reqs: Req[]) => reqs.filter((r) => r.url.startsWith("/api/market/items"));
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

afterEach(async () => {
  cleanup();
  await tick();
  globalThis.fetch = realFetch;
  useAppStore.setState({ sessionChecked: false, loggedIn: false, user: null, features: null });
  window.history.replaceState(null, "", "/uz/market");
});

function mount(opts: { enabled?: boolean; initial?: ReturnType<typeof list> | null; search?: string } = {}) {
  return render(withRouter(h(MarketCatalog, { enabled: opts.enabled ?? true, initial: opts.initial ?? null }), { search: opts.search }));
}

test("the server's first page draws at once and is not asked again", async () => {
  const { reqs } = stubFetch(() => json(200, list([])));
  mount({ initial: list([card("a"), card("b")]) });
  await tick();
  assert.equal(all("[data-market-card]").length, 2);
  assert.equal(listCalls(reqs).length, 0);
  assert.ok(!q("[data-market-skeleton]"));
});

test("without a server page: skeletons, then the grid", async () => {
  let release = (_: Response) => {};
  stubFetch(() => new Promise<Response>((r) => (release = r)));
  mount();
  assert.equal(all("[data-market-skeleton]").length, 8);
  assert.equal(q("[data-market-grid]")!.dataset.marketGrid, "loading");
  await act(async () => release(json(200, list([card("a")]))));
  await waitFor(() => assert.equal(all("[data-market-card]").length, 1));
  assert.ok(!q("[data-market-skeleton]"));
});

test("a card: price, struck original, discount, meta, sold count, link, alt text", () => {
  stubFetch(() => undefined);
  mount({ initial: list([card("a", { rating: { avg: 4.6, count: 5 } })]) });
  const c = q<HTMLAnchorElement>('[data-market-card="a"]')!;
  assert.equal(c.getAttribute("href"), "/uz/market/a");
  assert.match(c.querySelector("[data-price-now]")!.textContent!, /^1\s500 so'm$/);
  assert.match(c.querySelector("[data-price-old]")!.textContent!, /^3\s000$/);
  assert.equal(c.querySelector("[data-price-old]")!.tagName, "S");
  assert.equal(c.querySelector("[data-market-off]")!.textContent, "−50 %");
  assert.match(c.textContent!, /Referat · 18 bet · O'zbekcha/);
  assert.match(c.textContent!, /12 marta olingan/);
  assert.match(c.querySelector("[data-market-rating]")!.textContent!, /4\.6/);
  assert.equal(c.querySelector("img")!.getAttribute("alt"), "Referat a — 1-sahifa namunasi");
});

test("no discount, no badge; a sold-out card says so instead; decks get the wide cover", () => {
  stubFetch(() => undefined);
  mount({ initial: list([card("a", { price: 3000 }), card("b", { status: "sold_out" }), card("c", { toolId: "slide", slideCount: 12, pages: null })]) });
  assert.ok(!q('[data-market-card="a"] [data-market-off]'));
  assert.ok(!q('[data-market-card="a"] [data-price-old]'));
  assert.equal(q('[data-market-card="b"] [data-market-soldout]')!.textContent, "Sotuvda yo‘q");
  assert.ok(!q('[data-market-card="b"] [data-market-off]'));
  assert.equal(q('[data-market-card="c"] [data-market-cover]')!.dataset.marketCover, "wide");
  assert.equal(q('[data-market-card="a"] [data-market-cover]')!.dataset.marketCover, "page");
});

test("a busy preview keeps a neutral face, never a broken image", () => {
  stubFetch(() => undefined);
  mount({ initial: list([card("a")]) });
  fireEvent.error(q('[data-market-card="a"] img')!);
  assert.ok(!q('[data-market-card="a"] img'));
  assert.match(q("[data-market-cover-fallback]")!.textContent!, /Referat a/);
});

test("a chip updates the query and the request; aria-pressed follows; «Hammasi» clears it", async () => {
  const { reqs } = stubFetch(() => json(200, list([card("z")])));
  mount({ initial: list([card("a")]) });
  const chip = () => q('[data-market-tool="slide"][data-market-scope="row"]')!;
  assert.equal(chip().getAttribute("aria-pressed"), "false");
  await act(async () => void fireEvent.click(chip()));
  await waitFor(() => assert.ok(listCalls(reqs).some((r) => r.url.includes("tool=slide"))));
  assert.equal(window.location.search, "?tool=slide");
  assert.equal(chip().getAttribute("aria-pressed"), "true");
  await act(async () => void fireEvent.click(q('[data-market-tool="all"][data-market-scope="row"]')!));
  assert.equal(window.location.search, "");
});

test("the URL opens with its filters; the request carries them", async () => {
  const { reqs } = stubFetch(() => json(200, list([card("a")])));
  mount({ search: "tool=essay&subject=tarix&level=otm&sort=cheap&q=temur" });
  await waitFor(() => assert.equal(all("[data-market-card]").length, 1));
  const url = new URL(listCalls(reqs)[0]!.url, "http://x");
  assert.deepEqual(Object.fromEntries(url.searchParams), { tool: "essay", subject: "tarix", level: "otm", sort: "cheap", q: "temur", limit: "24" });
  assert.equal((q("[data-market-search] input") as HTMLInputElement).value, "temur");
});

test("search waits for two characters and a pause; clearing brings the catalog back", async () => {
  const { reqs } = stubFetch(() => json(200, list([card("s")])));
  mount({ initial: list([card("a")]) });
  const input = q<HTMLInputElement>("[data-market-search] input")!;
  assert.match(input.className, /text-\[16px\]/, "16 px: iOS does not zoom the page");
  fireEvent.change(input, { target: { value: "t" } });
  await act(async () => void (await new Promise((r) => setTimeout(r, 420))));
  assert.equal(listCalls(reqs).length, 0);
  fireEvent.change(input, { target: { value: "tarix" } });
  await waitFor(() => assert.ok(listCalls(reqs).some((r) => r.url.includes("q=tarix"))), { timeout: 1500 });
  assert.equal(window.location.search, "?q=tarix");
  fireEvent.click(q('[aria-label="Qidiruvni tozalash"]')!);
  await waitFor(() => assert.equal(window.location.search, ""), { timeout: 1500 });
});

test("«Filtr» opens the sheet: level and sort apply, the count shows, Escape closes it", async () => {
  const { reqs } = stubFetch(() => json(200, list([card("a")])));
  mount({ initial: list([card("a")]) });
  fireEvent.click(q("[data-market-filter-open]")!);
  const sheet = q("[data-market-sheet]")!;
  assert.ok(sheet);
  await act(async () => void fireEvent.click([...sheet.querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => b.textContent === "Kollej")!));
  await waitFor(() => assert.ok(listCalls(reqs).some((r) => r.url.includes("level=kollej"))));
  assert.equal(q("[data-market-filter-open]")!.getAttribute("aria-label"), "Filtr, 1 ta tanlangan");
  await act(async () => void fireEvent.keyDown(window, { key: "Escape" }));
  await waitFor(() => assert.ok(!q("[data-market-sheet]")));
});

test("the next page appends by «Yana ko'rsatish», a repeated row once; a failed page keeps the list", async () => {
  let fail = false;
  const { reqs } = stubFetch((r) => {
    if (!r.url.includes("cursor=c1")) return undefined;
    if (fail) return json(500, {});
    return json(200, list([card("b"), card("c")]));
  });
  mount({ initial: list([card("a"), card("b")], "c1") });
  fail = true;
  await act(async () => void fireEvent.click(q("[data-market-more]")!));
  await waitFor(() => assert.match(document.body.textContent!, /Keyingi sahifa yuklanmadi/));
  assert.equal(all("[data-market-card]").length, 2);
  fail = false;
  await act(async () => void fireEvent.click(q("[data-market-more]")!));
  await waitFor(() => assert.equal(all("[data-market-card]").length, 3));
  assert.deepEqual(all("[data-market-card]").map((c) => c.dataset.marketCard), ["a", "b", "c"]);
  assert.ok(!q("[data-market-more]"));
  assert.equal(listCalls(reqs).length, 2);
});

test("no results: the way out names the tool and resets; an empty shop is a calm note", async () => {
  stubFetch(() => json(200, list([])));
  const first = mount({ search: "tool=essay" });
  await waitFor(() => assert.match(document.body.textContent!, /Hech narsa topilmadi/));
  assert.equal(q("[data-market-empty-create]")!.getAttribute("href"), "/uz/essay");
  await act(async () => void fireEvent.click(q("[data-market-empty-reset]")!));
  await waitFor(() => assert.match(document.body.textContent!, /Bozor tez orada ochiladi/));
  assert.equal(window.location.search, "");
  first.unmount();
});

test("a failed first page: a retry, not an empty shop", async () => {
  let ok = false;
  stubFetch(() => (ok ? json(200, list([card("a")])) : json(500, {})));
  mount();
  await waitFor(() => assert.match(document.body.textContent!, /Bozor yuklanmadi/));
  ok = true;
  await act(async () => void fireEvent.click(q("[data-market-retry]")!));
  await waitFor(() => assert.equal(all("[data-market-card]").length, 1));
});

test("dark: a calm page, no request, nothing of the shop", async () => {
  const { reqs } = stubFetch(() => undefined);
  mount({ enabled: false });
  await tick();
  assert.ok(q("[data-market-closed]"));
  assert.match(document.body.textContent!, /Bozor tez orada ochiladi/);
  assert.equal(reqs.length, 0);
  assert.ok(!q("[data-market-card]") && !q("[data-market-skeleton]"));
});

test("dark, for an admin: the catalog (he checks the shop before it opens)", async () => {
  useAppStore.setState({ sessionChecked: true, loggedIn: true, user: { ...USER, isAdmin: true } as never });
  stubFetch(() => json(200, list([card("a")])));
  mount({ enabled: false });
  await waitFor(() => assert.equal(all("[data-market-card]").length, 1));
  assert.ok(!q("[data-market-closed]"));
});

test("switched off mid-visit: every market API says 503, the page goes calm", async () => {
  stubFetch(() => json(503, { error: "Bozor vaqtincha yopiq.", code: "market_disabled" }));
  mount();
  await waitFor(() => assert.ok(q("[data-market-closed]")));
});

test("«Xaridlarim» is in the header only for a signed-in user", async () => {
  stubFetch(() => undefined);
  const first = mount({ initial: list([card("a")]) });
  assert.ok(!q("[data-market-purchases-link]"));
  first.unmount();
  useAppStore.setState({ sessionChecked: true, loggedIn: true, user: USER as never });
  mount({ initial: list([card("a")]) });
  assert.equal(q("[data-market-purchases-link]")!.getAttribute("href"), "/uz/market/purchases");
  assert.equal(q("[data-market-purchases-link]")!.getAttribute("aria-label"), "Xaridlarim");
});

test("touch: every chip is 44 px tall and pressed state is a real aria state", () => {
  stubFetch(() => undefined);
  mount({ initial: list([card("a")]) });
  for (const chip of all("[data-market-tool]")) {
    assert.match(chip.className, /min-h-11/);
    assert.ok(chip.hasAttribute("aria-pressed"));
    assert.equal(chip.tagName, "BUTTON");
  }
});
