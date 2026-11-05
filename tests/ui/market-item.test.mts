import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ID, USER, UUID_RE, item, json, stubFetch, withRouter, type Req } from "./market-fixture.ts";
import type { MarketItemView } from "../../lib/market/types.ts";

/**
 * The item page and the buy sheet (`components/market/{MarketItemPage,BuySheet,PreviewGallery}.tsx`, §2.1, §2.4, §5.3).
 *
 * Mutations (each turned this file red, restored byte for byte):
 *   M1 `confirm`: no `inFlight` guard and no `busy` disable → «a double click is one request»;
 *   M2 `confirm`: new key on every click → «a lost answer retries with the same key»;
 *   M3 `confirm`: keep the key after a refusal → «a refusal gets a new key»;
 *   M4 `onPrice`: not wired → «409 price_changed: the new price…»;
 *   M5 sheet: `expectedPrice` from the initial prop → the same test;
 *   M6 `missing` check removed → «required fields»;
 *   M7 top-up link: plain `/uz/wallet` → «402 opens the top-up path»;
 *   M8 `needTopUp`: ignore `short` → «a short balance is told before the click»;
 *   M9 `buyAsked`: no check of `fresh` → «?buy=1 reopens the sheet with the fresh price»;
 *   M10 `needLogin`: return false always → «signed out: the login, and back here»;
 *   M11 `action`: drop the `owned` branch → «owned»;
 *   M12 `Slide`: stub without blur → «stubs are blurred with a lock»;
 *   M13 `onGone` not wired → «sold out while the sheet was open»;
 *   M14 `createNew`: overwrite the draft instead of merging → «create on this topic».
 */

const { MarketItemPage } = await import("../../components/market/MarketItemPage.tsx");
const { forgetMarketReturn, storedMarketReturn } = await import("../../components/market/market-return.ts");
const { useAppStore } = await import("../../lib/store.ts");
const { useChannelGate } = await import("../../lib/channel-gate.ts");
const { useUi } = await import("../../lib/ui.ts");

const realFetch = globalThis.fetch;
const realRefreshSession = useAppStore.getState().refreshSession;
const realRefreshGenerations = useAppStore.getState().refreshGenerations;
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const buys = (reqs: Req[]) => reqs.filter((r) => r.url.endsWith("/purchase"));
const pushes: string[] = [];

afterEach(async () => {
  cleanup();
  await tick();
  globalThis.fetch = realFetch;
  pushes.length = 0;
  forgetMarketReturn();
  useUi.setState({ overlay: null, returnTo: null });
  useChannelGate.getState().setGate(null);
  useAppStore.setState({ sessionChecked: false, loggedIn: false, user: null, features: null, refreshSession: realRefreshSession, refreshGenerations: realRefreshGenerations });
  window.history.replaceState(null, "", "/uz/market");
});

function signIn(patch: Record<string, unknown> = {}) {
  useAppStore.setState({ sessionChecked: true, loggedIn: true, user: { ...USER, ...patch } as never, refreshSession: (async () => {}) as never, refreshGenerations: (async () => {}) as never });
}

/** The stock API: the item, channels clear; `purchase` answers the POST. */
function api(view: MarketItemView, purchase?: (r: Req) => Response | undefined) {
  return stubFetch((r) => {
    if (r.url === `/api/market/items/${ID}`) return json(200, view);
    if (r.url.startsWith("/api/channels/required")) return json(200, { ok: true, needsTelegram: false, channels: [] });
    if (r.url.endsWith("/purchase")) return purchase?.(r) ?? json(200, { generationId: "g1", price: view.price, replayed: false });
    return undefined;
  });
}

function mount(opts: { initial?: MarketItemView | null; enabled?: boolean; search?: string } = {}) {
  return render(withRouter(h(MarketItemPage, { id: ID, enabled: opts.enabled ?? true, initial: opts.initial === undefined ? item() : opts.initial }), { pushes, search: opts.search, pathname: `/uz/market/${ID}` }));
}

async function openSheet() {
  await tick();
  await act(async () => void fireEvent.click(q("[data-market-buy]")!));
  await waitFor(() => assert.ok(q("[data-market-buy-sheet]")));
}

const field = (id: string) => q<HTMLInputElement>(`[data-market-buy-sheet] [data-field="${id}"] input`)!;

// First in the file: a sheet of an earlier test releases its history entry asynchronously, which would race this URL check.
test("?buy=1 (back from the wallet) reopens the sheet with the fresh price, once, and leaves the URL", async () => {
  signIn();
  window.history.replaceState(null, "", `/uz/market/${ID}?buy=1`);
  api(item({ price: 1000 }));
  mount({ search: "buy=1" });
  await waitFor(() => assert.ok(q("[data-market-buy-sheet]")));
  assert.match(q("[data-buy-confirm]")!.textContent!, /1\s000 so'm/);
  assert.equal(window.location.search, "");
});

test("the page shows the title, price, facts, benefits, outline and summary; the client refreshes the view", async () => {
  useAppStore.setState({ sessionChecked: true });
  const { reqs } = api(item({ price: 1000, soldCount: 3 }));
  mount();
  assert.equal(all("[data-market-item-title]")[0]!.textContent, `Referat ${ID}`);
  assert.match(all("[data-price-now]")[0]!.textContent!, /^1\s500/);
  await waitFor(() => assert.match(all("[data-price-now]")[0]!.textContent!, /^1\s000/));
  assert.ok(reqs.some((r) => r.url === `/api/market/items/${ID}`));
  const facts = q("[data-market-facts]")!.textContent!;
  for (const t of ["Referat", "18 bet", "O'zbekcha", "Tarix", "OTM", "3 marta"]) assert.ok(facts.includes(t), t);
  assert.match(q("[data-market-benefits]")!.textContent!, /Word \(DOCX\) va PDF fayl/);
  assert.deepEqual([...q("[data-market-outline]")!.querySelectorAll("li")].map((l) => l.textContent!.replace(/^\d+/, "")), ["Kirish", "Asosiy qism", "Xulosa"]);
});

test("a long outline folds; the rest opens", async () => {
  api(item({ outline: Array.from({ length: 11 }, (_, i) => `Bo'lim ${i}`) }));
  mount({ initial: item({ outline: Array.from({ length: 11 }, (_, i) => `Bo'lim ${i}`) }) });
  assert.equal(q("[data-market-outline]")!.querySelectorAll("li").length, 8);
  fireEvent.click(q("[data-market-outline-more]")!);
  assert.equal(q("[data-market-outline]")!.querySelectorAll("li").length, 11);
});

test("gallery: readable pages, then stubs blurred with a lock; thumbnails move it; alt text is honest", async () => {
  api(item());
  mount();
  const slides = all("[data-gallery-slide]");
  assert.deepEqual(slides.map((s) => s.dataset.gallerySlide), ["page", "page", "stub", "stub", "stub", "stub"]);
  assert.equal(slides[0]!.querySelector("img")!.getAttribute("src"), `/api/market/items/${ID}/preview/1?v=2`);
  assert.equal(slides[0]!.querySelector("img")!.getAttribute("alt"), `Referat ${ID} — 1-sahifa namunasi`);
  assert.match(slides[2]!.querySelector("img")!.className, /blur-/);
  assert.ok(!/blur-/.test(slides[0]!.querySelector("img")!.className));
  assert.match(slides[2]!.textContent!, /Xariddan keyin to‘liq/);
  const thumb = q('[data-gallery-thumb="3"]')!;
  fireEvent.click(thumb);
  assert.equal(thumb.getAttribute("aria-current"), "true");
  fireEvent.keyDown(q("[data-market-gallery]")!, { key: "ArrowLeft" });
  assert.equal(q('[data-gallery-thumb="2"]')!.getAttribute("aria-current"), "true");
  assert.equal(q("[data-market-gallery]")!.getAttribute("aria-roledescription"), "carousel");
});

test("signed out: the login, and back here with the sheet asked for", async () => {
  useAppStore.setState({ sessionChecked: true, loggedIn: false });
  api(item());
  mount();
  await tick();
  fireEvent.click(q("[data-market-buy]")!);
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, `/uz/market/${ID}?buy=1`);
  assert.ok(!q("[data-market-buy-sheet]"));
});

test("the sheet is prefilled from the profile, marks required fields, and states price and balance", async () => {
  signIn({ city: "Samarqand" });
  api(item());
  mount();
  await openSheet();
  assert.equal(field("author").value, "Valiyev Ali");
  assert.equal(field("university").value, "TDIU");
  assert.equal(field("group").value, "301");
  assert.equal(field("city").value, "Samarqand");
  assert.match(q("[data-market-buy-sheet]")!.textContent!, /Muallif \*/);
  assert.match(q("[data-buy-balance]")!.textContent!, /5\s000 so'm/);
  assert.match(q("[data-buy-confirm]")!.textContent!, /^Tasdiqlash — 1\s500 so'm$/);
  assert.match(field("author").className, /text-\[16px\]/);
});

test("required fields: nothing is sent until they are filled", async () => {
  signIn({ author: "", name: "+998901234567", university: "" });
  const { reqs } = api(item());
  mount();
  await openSheet();
  assert.equal(field("author").value, "", "a phone number is not a name");
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  assert.equal(q("[data-buy-missing]")!.textContent, "To‘ldiring: Muallif, OTM");
  assert.equal(buys(reqs).length, 0);
  fireEvent.change(field("author"), { target: { value: "Ali" } });
  fireEvent.change(field("university"), { target: { value: "TDIU" } });
  assert.ok(!q("[data-buy-missing]"));
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.equal(buys(reqs).length, 1));
});

test("success: expected price, trimmed fields, an Idempotency-Key; the buyer lands on his generation", async () => {
  signIn({ faculty: " Iqtisodiyot " });
  const { reqs } = api(item());
  let refreshed = 0;
  useAppStore.setState({ refreshGenerations: (async () => void (refreshed += 1)) as never });
  mount();
  await openSheet();
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.deepEqual(pushes, ["/uz/files/g1"]));
  const r = buys(reqs)[0]!;
  assert.equal(r.method, "POST");
  assert.match(r.key!, UUID_RE);
  assert.equal(r.body!.expectedPrice, 1500);
  assert.deepEqual(r.body!.fields, { author: "Valiyev Ali", university: "TDIU", faculty: "Iqtisodiyot", group: "301", course: "3", city: "Toshkent" });
  assert.equal(refreshed, 1);
});

test("a double click is one request", async () => {
  signIn();
  let release = (_: Response) => {};
  const { reqs } = api(item(), () => undefined);
  const base = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/purchase")) {
      void base(input, init);
      return new Promise<Response>((r) => (release = r));
    }
    return base(input, init);
  }) as typeof fetch;
  mount();
  await openSheet();
  const btn = q<HTMLButtonElement>("[data-buy-confirm]")!;
  await act(async () => {
    fireEvent.click(btn);
    fireEvent.click(btn);
  });
  assert.equal(btn.disabled, true);
  assert.equal(buys(reqs).length, 1);
  await act(async () => release(json(200, { generationId: "g1", price: 1500, replayed: false })));
});

test("a lost answer retries with the same key; a refusal gets a new key", async () => {
  signIn();
  let answer: () => Response | undefined = () => json(500, { error: "Xato" });
  const { reqs } = api(item(), () => answer());
  mount();
  await openSheet();
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.equal(q("[data-buy-error]")!.textContent, "Xato"));
  answer = () => json(429, { error: "Navbat to'la" });
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.equal(q("[data-buy-error]")!.textContent, "Navbat to'la"));
  answer = () => json(200, { generationId: "g2", price: 1500, replayed: true });
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.deepEqual(pushes, ["/uz/files/g2"]));
  const keys = buys(reqs).map((r) => r.key);
  assert.equal(keys[0], keys[1], "unsure → the same key");
  assert.notEqual(keys[1], keys[2], "refused → a new key");
});

test("409 price_changed: the new price on the sheet and the page; the next confirm sends it with a new key", async () => {
  signIn();
  let first = true;
  const { reqs } = api(item(), () => {
    if (!first) return undefined;
    first = false;
    return json(409, { error: "Narx o'zgardi", code: "price_changed", price: 2000 });
  });
  mount();
  await openSheet();
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.match(q("[data-buy-price-changed]")!.textContent!, /2\s000 so'm/));
  assert.match(q("[data-buy-confirm]")!.textContent!, /2\s000 so'm/);
  assert.match(all("[data-market-item] [data-price-now]")[0]!.textContent!, /2\s000/);
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.equal(buys(reqs).length, 2));
  assert.equal(buys(reqs)[1]!.body!.expectedPrice, 2000);
  assert.notEqual(buys(reqs)[0]!.key, buys(reqs)[1]!.key);
});

test("402 opens the top-up path: amounts, the wallet link with the way back, and the stored return", async () => {
  signIn();
  const { reqs } = api(item(), () => json(402, { error: "Balans yetarli emas", required: 1500, available: 200 }));
  mount();
  await openSheet();
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.ok(q("[data-buy-topup]")));
  assert.match(q("[data-buy-topup]")!.textContent!, /kerak 1\s500 so'm, mavjud 200 so'm/);
  assert.ok(!q("[data-buy-confirm]"));
  const link = q<HTMLAnchorElement>("[data-buy-topup-link]")!;
  assert.equal(link.getAttribute("href"), `/uz/wallet?return=${encodeURIComponent(`/uz/market/${ID}?buy=1`)}`);
  fireEvent.click(link);
  assert.equal(storedMarketReturn(), `/uz/market/${ID}?buy=1`);
  assert.equal(buys(reqs).length, 1);
});

test("a short balance is told before the click: no request", async () => {
  signIn({ balance: 100 });
  const { reqs } = api(item());
  mount();
  await openSheet();
  assert.ok(q("[data-buy-topup]"));
  assert.ok(!q("[data-buy-confirm]"));
  assert.equal(buys(reqs).length, 0);
});

test("?buy=1 on an owned or sold-out item does not open a sheet", async () => {
  signIn();
  api(item({ status: "sold_out" }));
  mount({ search: "buy=1", initial: item({ status: "sold_out" }) });
  await tick();
  await tick();
  assert.ok(!q("[data-market-buy-sheet]"));
  assert.ok(q("[data-market-unavailable]"));
});

test("already owned while the sheet was open: the buyer goes to his copy", async () => {
  signIn();
  api(item(), () => json(409, { error: "x", code: "already_owned", generationId: "g9" }));
  mount();
  await openSheet();
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.deepEqual(pushes, ["/uz/files/g9"]));
  assert.ok(!q("[data-market-buy-sheet]"));
});

test("sold out while the sheet was open: the sheet closes, the page says so, no buy button", async () => {
  signIn();
  api(item(), () => json(410, { error: "x", code: "sold_out" }));
  mount();
  await openSheet();
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.ok(!q("[data-market-buy-sheet]")));
  assert.match(q("[data-market-note-line]")!.textContent!, /sotilib bo'ldi/);
  assert.ok(!q("[data-market-buy]"));
  assert.ok(q("[data-market-unavailable]"));
});

test("university cap: a clear note and a way to similar works; paused: the reason", async () => {
  signIn();
  let body: Record<string, unknown> = { error: "x", code: "university_cap" };
  let status = 409;
  api(item(), () => json(status, body));
  mount();
  await openSheet();
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.match(q("[data-buy-cap]")!.textContent!, /muassasangizda allaqachon olingan/));
  assert.match(q<HTMLAnchorElement>('[data-buy-note] a')!.getAttribute("href")!, /^\/uz\/market\?q=Referat/);
  status = 503;
  body = { error: "x", code: "paused" };
  await act(async () => void fireEvent.click(q("[data-buy-confirm]")!));
  await waitFor(() => assert.match(q("[data-buy-error]")!.textContent!, /xarid to'xtatilgan/));
});

test("mandatory channels: the gate card in the sheet, confirm off, nothing charged", async () => {
  signIn();
  stubFetch((r) => {
    if (r.url === `/api/market/items/${ID}`) return json(200, item());
    if (r.url.startsWith("/api/channels/required")) return json(200, { ok: false, needsTelegram: false, channels: [{ id: "1", title: "Kanal", joinUrl: "https://t.me/x" }] });
    return undefined;
  });
  mount();
  await openSheet();
  await waitFor(() => assert.match(q("[data-market-buy-sheet]")!.textContent!, /Kanal/));
  assert.equal(q<HTMLButtonElement>("[data-buy-confirm]")!.disabled, true);
});

test("owned: «Ishlarimda ochish»; a lost copy: «Qayta tiklash» opens the new one; no buy button", async () => {
  signIn();
  const owned = item({ owned: { generationId: "g5", purchaseId: "p5" } });
  api(owned);
  const first = mount({ initial: owned });
  await tick();
  assert.ok(!q("[data-market-buy]"));
  assert.equal(all("[data-market-open-owned]")[0]!.getAttribute("href"), "/uz/files/g5");
  first.unmount();

  const lost = item({ owned: { generationId: null, purchaseId: "p5" } });
  stubFetch((r) => {
    if (r.url === `/api/market/items/${ID}`) return json(200, lost);
    if (r.url === "/api/market/purchases/p5/restore") return json(200, { generationId: "g6", restored: true });
    return undefined;
  });
  mount({ initial: lost });
  await tick();
  await act(async () => void fireEvent.click(all("[data-market-restore]")[0]!));
  await waitFor(() => assert.deepEqual(pushes, ["/uz/files/g6"]));
});

test("an owner of a retired item: no public page, the fresh view still opens his copy", async () => {
  signIn();
  api(item({ status: "sold_out", owned: { generationId: "g5", purchaseId: "p5" } }));
  mount({ initial: null });
  await waitFor(() => assert.equal(all("[data-market-open-owned]")[0]!.getAttribute("href"), "/uz/files/g5"));
});

test("an unknown item: skeleton, then a calm note with a way back", async () => {
  useAppStore.setState({ sessionChecked: true });
  stubFetch(() => json(404, { error: "Topilmadi" }));
  mount({ initial: null });
  assert.ok(q("[data-market-item-skeleton]"));
  await waitFor(() => assert.match(document.body.textContent!, /Bu ish topilmadi/));
});

test("switched off: a calm page; dark: no request for an anonymous visitor", async () => {
  useAppStore.setState({ sessionChecked: true });
  const { reqs } = stubFetch(() => undefined);
  const first = mount({ enabled: false, initial: null });
  await tick();
  assert.ok(q("[data-market-closed]"));
  assert.equal(reqs.length, 0);
  first.unmount();
  stubFetch(() => json(503, { code: "market_disabled", error: "x" }));
  mount();
  await waitFor(() => assert.ok(q("[data-market-closed]")));
});

test("create on this topic: the tool's draft keeps its values, gets the topic, the form opens", async () => {
  signIn();
  const { reqs } = stubFetch((r) => {
    if (r.url === `/api/market/items/${ID}`) return json(200, item());
    if (r.url === "/api/forms/referat/draft" && r.method === "GET") return json(200, { draft: { data: { language: "ru", topic: "Eski" }, updatedAt: "x" } });
    return undefined;
  });
  mount();
  await tick();
  await act(async () => void fireEvent.click(q("[data-market-create]")!));
  await waitFor(() => assert.deepEqual(pushes, ["/uz/referat"]));
  const put = reqs.find((r) => r.method === "PUT")!;
  assert.deepEqual(put.body, { data: { language: "ru", topic: `Referat ${ID}` } });
});

test("report: the reason goes out once; signed out it asks for the login first", async () => {
  signIn();
  const { reqs } = stubFetch((r) => {
    if (r.url === `/api/market/items/${ID}`) return json(200, item());
    if (r.url.endsWith("/report")) return json(200, { reported: true });
    return undefined;
  });
  mount();
  await tick();
  fireEvent.click(q("[data-market-report]")!);
  await act(async () => void fireEvent.click(q("[data-market-report-send]")!));
  await waitFor(() => assert.ok(q("[data-market-report-done]")));
  assert.deepEqual(reqs.find((r) => r.url.endsWith("/report"))!.body, { reason: "copyright" });
});

test("the phone bar: price and the one action, docked above the tab bar and the safe area", async () => {
  api(item());
  mount();
  const bar = q("[data-market-buybar]")!;
  assert.match(bar.className, /sticky/);
  assert.match(bar.className, /--tabbar-h/);
  assert.match(bar.className, /--tg-safe-bottom/);
  assert.match(bar.className, /lg:hidden/);
  assert.ok(bar.querySelector("[data-market-buy]"));
  assert.ok(bar.querySelector("[data-market-price]"));
});
