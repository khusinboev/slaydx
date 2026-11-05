import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ID, USER, card, json, list, stubFetch, withRouter, type Req } from "./market-fixture.ts";
import type { ServerGeneration, MarketPurchase } from "../../lib/api-client.ts";

/**
 * Every way into the market, each behind `features.market` (docs/market/PLAN.md §5.1), and «Xaridlarim» (§2.3).
 *
 * Mutations (each turned this file red, restored byte for byte):
 *   M1 `lib/services.ts`: drop `flag: "market"` → «the service tile is gated»;
 *   M2 `MarketRail`: no `!on` return → «the rail: off»;
 *   M3 `MarketRail`: no `items?.length === 0` → «an empty shelf is not drawn»;
 *   M4 `FilePreview`: always draw the badge → «the «Bozordan» badge»;
 *   M5 `MarketOptOut`: no rollback → «the switch goes back when the server refuses»;
 *   M6 `MarketOptOut`: no `!on` return → «opt-out is hidden while dark»;
 *   M7 `MarketSuggest`: no `SUGGEST_MIN_CHARS` → «suggest waits for 8 characters»;
 *   M8 `MarketSuggest`: no `isMarketTool` → «a tool the market does not sell»;
 *   M9 `WalletReturnCard`: trust `?return=` → «an outside target is ignored»;
 *   M10 `PurchaseRow`: offer restore always → «what a row offers comes from the server»;
 *   M11 `SimilarWorks`: no `sold` check → «three cards for a sold tool…».
 */

const { servicesOfGroup, SERVICE_BY_ID, serviceVisible } = await import("../../lib/services.ts");
const { TOOL_ICONS } = await import("../../components/shell/icons.tsx");
const { MarketRail } = await import("../../components/home/hub/MarketRail.tsx");
const { FilePreview } = await import("../../components/home/FilePreview.tsx");
const { MarketOptOut } = await import("../../components/market/MarketOptOut.tsx");
const { MarketSuggest } = await import("../../components/market/MarketSuggest.tsx");
const { WalletReturnCard } = await import("../../components/market/WalletReturnCard.tsx");
const { SimilarWorks } = await import("../../components/market/SimilarWorks.tsx");
const { PurchasesPage } = await import("../../components/market/PurchasesPage.tsx");
const { forgetMarketReturn, rememberMarketReturn } = await import("../../components/market/market-return.ts");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");

const realFetch = globalThis.fetch;
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const pushes: string[] = [];
const ON = { llm: true, images: true, telegram: false, telegramBot: null, market: true } as never;
const OFF = { llm: true, images: true, telegram: false, telegramBot: null, market: false } as never;

afterEach(async () => {
  cleanup();
  await tick();
  globalThis.fetch = realFetch;
  pushes.length = 0;
  forgetMarketReturn();
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({ sessionChecked: false, loggedIn: false, user: null, features: null });
  document.body.innerHTML = "";
});

const signIn = (features: unknown = ON) => useAppStore.setState({ sessionChecked: true, loggedIn: true, user: USER as never, features: features as never });

test("the service tile is gated: «Talaba» lists it only with the switch on; it has an icon, a badge and the page", () => {
  const ids = (f: unknown) => servicesOfGroup("talaba", f as never).map((s) => s.id);
  assert.ok(!ids(null).includes("market"));
  assert.ok(!ids(OFF).includes("market"));
  assert.ok(ids(ON).includes("market"));
  const s = SERVICE_BY_ID.market;
  assert.equal(s.href, "/uz/market");
  assert.equal(s.badge, "−50 %");
  assert.ok(TOOL_ICONS[s.icon], "icon in the table");
  assert.equal(serviceVisible(s, { market: false } as never), false);
});

test("the rail: off → nothing and no request", async () => {
  useAppStore.setState({ features: OFF });
  const { reqs } = stubFetch(() => undefined);
  render(withRouter(h(MarketRail, { index: 3 })));
  await tick();
  assert.ok(!q('[data-hub-section="market"]'));
  assert.equal(reqs.length, 0);
});

test("the rail: on → the 6 popular works + «Hammasi»; skeletons while loading", async () => {
  useAppStore.setState({ features: ON });
  let release = (_: Response) => {};
  const asked: Req[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    asked.push({ url: String(input), method: "GET", body: null, key: null });
    return new Promise<Response>((r) => (release = r));
  }) as typeof fetch;
  render(withRouter(h(MarketRail, { index: 3 })));
  await tick();
  assert.ok(q('[data-hub-market] [data-market-skeleton]'));
  await act(async () => release(json(200, list(["a", "b", "c", "d", "e", "f"].map((i) => card(i))))));
  await waitFor(() => assert.equal(all("[data-hub-market] [data-market-card]").length, 6));
  assert.match(asked[0]!.url, /sort=popular/);
  assert.match(asked[0]!.url, /limit=6/);
  assert.equal(q("[data-hub-market-all]")!.getAttribute("href"), "/uz/market");
});

test("an empty or failed shelf is not drawn", async () => {
  useAppStore.setState({ features: ON });
  stubFetch(() => json(200, list([])));
  const first = render(withRouter(h(MarketRail, { index: 3 })));
  await waitFor(() => assert.ok(!q('[data-hub-section="market"]')));
  first.unmount();
  stubFetch(() => json(500, {}));
  render(withRouter(h(MarketRail, { index: 3 })));
  await waitFor(() => assert.ok(!q('[data-hub-section="market"]')));
});

function gen(patch: Partial<ServerGeneration>): ServerGeneration {
  return { id: "g", type: "referat", topic: "Mavzu", status: "COMPLETED", format: "docx", progress: 100, preview: { lines: ["Kirish"] }, ...patch } as ServerGeneration;
}

test("the «Bozordan» badge: only on a bought copy", () => {
  stubFetch(() => undefined);
  const first = render(h("div", null, h(FilePreview, { gen: gen({}) })));
  assert.ok(!q("[data-market-badge]"));
  first.unmount();
  render(h("div", null, h(FilePreview, { gen: gen({ marketItemId: ID }) })));
  assert.equal(q("[data-market-badge]")!.textContent, "Bozordan");
});

test("opt-out is hidden while dark: nothing drawn, nothing asked", async () => {
  signIn(OFF);
  const { reqs } = stubFetch(() => undefined);
  render(h(MarketOptOut));
  await tick();
  assert.ok(!q("[data-market-opt-out]"));
  assert.equal(reqs.length, 0);
});

test("opt-out: reads the server's value, a tap saves it with PUT", async () => {
  signIn();
  const { reqs } = stubFetch((r) => json(200, { optOut: r.method === "PUT" ? r.body!.optOut : false }));
  render(h(MarketOptOut));
  const sw = () => q('[role="switch"]')!;
  await waitFor(() => assert.equal(sw().getAttribute("aria-checked"), "false"));
  assert.equal(sw().getAttribute("aria-label"), "Mening ishlarim bozorga chiqmasin");
  await act(async () => void fireEvent.click(sw()));
  assert.equal(sw().getAttribute("aria-checked"), "true");
  assert.deepEqual(reqs.find((r) => r.method === "PUT")!.body, { optOut: true });
  assert.equal(reqs.find((r) => r.method === "PUT")!.url, "/api/market/opt-out");
});

test("the switch goes back when the server refuses, and says so", async () => {
  signIn();
  stubFetch((r) => (r.method === "PUT" ? json(500, {}) : json(200, { optOut: true })));
  render(h(MarketOptOut));
  await waitFor(() => assert.equal(q('[role="switch"]')!.getAttribute("aria-checked"), "true"));
  await act(async () => void fireEvent.click(q('[role="switch"]')!));
  await waitFor(() => assert.equal(q('[role="switch"]')!.getAttribute("aria-checked"), "true"));
  assert.match(q('[role="alert"]')!.textContent!, /Saqlanmadi/);
});

/** A tool form as the composers draw it. */
function form(kind: "field" | "slide" = "field") {
  return h(
    "div",
    { "data-tool-chrome": "true" },
    kind === "field" ? h("span", { "data-field": "topic" }, h("input", { type: "text", "aria-label": "t", defaultValue: "" })) : h("input", { type: "text", "aria-label": "Taqdimot mavzusini kiriting", defaultValue: "" }),
  );
}

async function type(value: string) {
  const input = q<HTMLInputElement>("[data-tool-chrome] input")!;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("suggest: off → no request", async () => {
  useAppStore.setState({ features: OFF });
  const { reqs } = stubFetch(() => undefined);
  render(withRouter(h("div", null, form(), h(MarketSuggest, { toolId: "referat" }))));
  await type("O'zbekiston tarixi");
  await act(async () => void (await new Promise((r) => setTimeout(r, 700))));
  assert.equal(reqs.length, 0);
});

test("a tool the market does not sell: no request", async () => {
  useAppStore.setState({ features: ON });
  const { reqs } = stubFetch(() => undefined);
  render(withRouter(h("div", null, form(), h(MarketSuggest, { toolId: "resume" }))));
  await type("O'zbekiston tarixi");
  await act(async () => void (await new Promise((r) => setTimeout(r, 700))));
  assert.equal(reqs.length, 0);
});

test("suggest waits for 8 characters and a pause, then one chip right under the field; «×» dismisses it", async () => {
  useAppStore.setState({ features: ON });
  const { reqs } = stubFetch(() => json(200, { items: [card("s1", { title: "Amir Temur davri" })] }));
  render(withRouter(h("div", null, form(), h(MarketSuggest, { toolId: "referat" }))));
  await type("Tarix");
  await act(async () => void (await new Promise((r) => setTimeout(r, 700))));
  assert.equal(reqs.length, 0);
  await type("Amir Temur tarixi");
  assert.equal(reqs.length, 0, "debounced");
  await waitFor(() => assert.ok(q("[data-market-suggest]")), { timeout: 1500 });
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0]!.url, `/api/market/suggest?tool=referat&q=${encodeURIComponent("Amir Temur tarixi").replace(/%20/g, "+")}`);
  assert.equal(q("[data-market-suggest-link]")!.getAttribute("href"), "/uz/market/s1");
  assert.match(q("[data-market-suggest]")!.textContent!, /Tayyor varianti bor: «Amir Temur davri» — 1\s500 so'm/);
  const host = q("[data-market-suggest-host]")!;
  assert.equal(host.previousElementSibling?.getAttribute("data-field"), "topic", "next to the field");
  await act(async () => void fireEvent.click(q("[data-market-suggest-close]")!));
  assert.ok(!q("[data-market-suggest]"));
  assert.ok(!q("[data-market-suggest-host]"), "the host leaves with the chip");
});

test("the slide forms' inline topic field is watched too; nothing found, no chip", async () => {
  useAppStore.setState({ features: ON });
  const { reqs } = stubFetch(() => json(200, { items: [] }));
  render(withRouter(h("div", null, form("slide"), h(MarketSuggest, { toolId: "slide" }))));
  await type("Quyosh tizimi sayyoralari");
  await waitFor(() => assert.equal(reqs.length, 1), { timeout: 1500 });
  await tick();
  assert.ok(!q("[data-market-suggest]"));
});

test("wallet: `?return=` shows the way back and survives the payment trip; an outside target is ignored", async () => {
  stubFetch(() => undefined);
  const path = `/uz/market/${ID}?buy=1`;
  const first = render(withRouter(h(WalletReturnCard), { search: `return=${encodeURIComponent(path)}` }));
  assert.equal(q("[data-market-return]")!.getAttribute("href"), path);
  await tick();
  first.unmount();
  // Back from the provider: `/uz/purchase?order=…` → the wallet, no `?return=`.
  const second = render(withRouter(h(WalletReturnCard), { search: "order=o1" }));
  await tick();
  assert.equal(q("[data-market-return]")!.getAttribute("href"), path);
  second.unmount();

  forgetMarketReturn();
  const third = render(withRouter(h(WalletReturnCard), { search: "return=https%3A%2F%2Fevil.example%2Fuz%2Fmarket%2Fx" }));
  await tick();
  assert.ok(!q("[data-market-return]"));
  third.unmount();
  const fourth = render(withRouter(h(WalletReturnCard), { search: "return=%2Fuz%2Fwallet" }));
  await tick();
  assert.ok(!q("[data-market-return]"));
  fourth.unmount();

  const key = "slaydx.market.return";
  rememberMarketReturn(path);
  window.localStorage.setItem(key, JSON.stringify({ path, at: Date.now() - 3 * 3600 * 1000 }));
  render(withRouter(h(WalletReturnCard)));
  await tick();
  assert.ok(!q("[data-market-return]"), "an old trip is forgotten");
});

test("«Shunga o'xshash tayyor ishlar»: three cards for a sold tool; nothing dark, for other tools, or when none exist", async () => {
  useAppStore.setState({ features: ON });
  const { reqs } = stubFetch(() => json(200, { items: ["a", "b", "c", "d"].map((i) => card(i)) }));
  const first = render(withRouter(h(SimilarWorks, { toolId: "referat", topic: "Amir Temur" })));
  await waitFor(() => assert.equal(all("[data-market-similar] [data-market-card]").length, 3));
  assert.match(reqs[0]!.url, /tool=referat/);
  first.unmount();

  const other = stubFetch(() => undefined);
  const second = render(withRouter(h(SimilarWorks, { toolId: "resume", topic: "Amir Temur" })));
  await tick();
  assert.equal(other.reqs.length, 0);
  second.unmount();

  stubFetch(() => json(200, { items: [] }));
  const third = render(withRouter(h(SimilarWorks, { toolId: "referat", topic: "Amir Temur" })));
  await tick();
  assert.ok(!q("[data-market-similar]"));
  third.unmount();

  useAppStore.setState({ features: OFF });
  const dark = stubFetch(() => undefined);
  render(withRouter(h(SimilarWorks, { toolId: "referat", topic: "Amir Temur" })));
  await tick();
  assert.equal(dark.reqs.length, 0);
});

function purchase(id: string, patch: Partial<MarketPurchase> = {}): MarketPurchase {
  return {
    id,
    itemId: `i-${id}`,
    toolId: "referat",
    title: `Xarid ${id}`,
    cover: `/api/market/items/i-${id}/preview/1?v=1`,
    price: 1500,
    originalPrice: 3000,
    createdAt: "2026-11-05T08:00:00.000Z",
    generationId: `g-${id}`,
    generationStatus: "COMPLETED",
    state: "ready",
    canRestore: false,
    canRate: false,
    rating: null,
    ...patch,
  };
}

test("«Xaridlarim»: signed out asks for the login; dark is the calm page", async () => {
  useAppStore.setState({ sessionChecked: true, features: ON });
  const { reqs } = stubFetch(() => undefined);
  const first = render(withRouter(h(PurchasesPage)));
  await tick();
  fireEvent.click(q("[data-purchases-login]")!);
  assert.equal(useUi.getState().returnTo, "/uz/market/purchases");
  assert.equal(reqs.length, 0);
  first.unmount();
  useAppStore.setState({ features: OFF });
  render(withRouter(h(PurchasesPage)));
  await tick();
  assert.ok(q("[data-market-closed]"));
});

test("what a row offers comes from the server: open, restore, refunded, blocked, rate", async () => {
  signIn();
  const rows = [
    purchase("a"),
    purchase("b", { state: "restorable", canRestore: true, generationId: null, generationStatus: null }),
    purchase("c", { state: "refunded" }),
    purchase("d", { state: "blocked", generationId: null }),
    purchase("e", { canRate: true }),
    purchase("f", { state: "refund_pending", generationStatus: "FAILED" }),
  ];
  stubFetch((r) => {
    if (r.url === "/api/market/purchases") return json(200, { purchases: rows });
    if (r.url === "/api/market/purchases/b/restore") return json(200, { generationId: "g-new", restored: true });
    return undefined;
  });
  render(withRouter(h(PurchasesPage), { pushes }));
  await waitFor(() => assert.equal(all("[data-purchase]").length, 6));
  const row = (id: string) => q(`[data-purchase="${id}"]`)!;
  assert.equal(row("a").querySelector("[data-purchase-open]")!.getAttribute("href"), "/uz/files/g-a");
  assert.match(row("a").textContent!, /Referat · 05\.11\.2026 · 1\s500 so'm/);
  assert.ok(!row("a").querySelector("[data-purchase-restore]") && !row("a").querySelector("[data-purchase-rate]"));
  assert.equal(row("c").querySelector("[data-purchase-state]")!.textContent, "Qaytarilgan");
  assert.ok(!row("c").querySelector("[data-purchase-open]"));
  assert.equal(row("d").querySelector("[data-purchase-state]")!.textContent, "Cheklangan");
  assert.equal(row("f").querySelector("[data-purchase-state]")!.textContent, "Pul qaytarilmoqda");
  await act(async () => void fireEvent.click(row("b").querySelector("[data-purchase-restore]")!));
  await waitFor(() => assert.deepEqual(pushes, ["/uz/files/g-new"]));
});

test("rating: stars are required, the text goes along, the row shows the result", async () => {
  signIn();
  const { reqs } = stubFetch((r) => {
    if (r.url === "/api/market/purchases") return json(200, { purchases: [purchase("e", { canRate: true })] });
    if (r.url.endsWith("/rating")) return json(200, r.body);
    return undefined;
  });
  render(withRouter(h(PurchasesPage)));
  await waitFor(() => assert.ok(q("[data-purchase-rate]")));
  fireEvent.click(q("[data-purchase-rate]")!);
  assert.equal(q<HTMLButtonElement>("[data-rating-save]")!.disabled, true);
  fireEvent.click(q('[data-rating-star="4"]')!);
  assert.equal(q('[data-rating-star="4"]')!.getAttribute("aria-checked"), "true");
  fireEvent.change(q("[data-rating-form] textarea")!, { target: { value: "  Yaxshi ish " } });
  await act(async () => void fireEvent.click(q("[data-rating-save]")!));
  await waitFor(() => assert.ok(q("[data-purchase-rating]")));
  assert.deepEqual(reqs.find((r) => r.url.endsWith("/rating"))!.body, { stars: 4, text: "Yaxshi ish" });
  assert.match(q("[data-purchase-rating]")!.textContent!, /4/);
  assert.ok(!q("[data-rating-form]"));
});

test("no purchases yet: a calm note with the way to the shop; a failed list offers a retry", async () => {
  signIn();
  stubFetch(() => json(200, { purchases: [] }));
  const first = render(withRouter(h(PurchasesPage)));
  await waitFor(() => assert.match(document.body.textContent!, /Hali xarid qilmagansiz/));
  first.unmount();
  stubFetch(() => json(500, {}));
  render(withRouter(h(PurchasesPage)));
  await waitFor(() => assert.match(document.body.textContent!, /Xaridlar yuklanmadi/));
});
