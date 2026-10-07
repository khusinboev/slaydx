import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WalletPage } from "../../components/wallet/WalletPage.tsx";
import { describeEntry, formatWhen, ledgerRow } from "../../components/wallet/wallet-model.ts";
import { PayDialog } from "../../components/overlays/PayDialog.tsx";
import { useAppStore } from "../../lib/store.ts";
import { useUi } from "../../lib/ui.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * Redesign W3 «Hamyon» (docs/redesign/PLAN.md): balance hero, signed-out and
 * loading states, «To'ldirish» → the existing PayDialog, `?order=` banners,
 * the «Harakatlar» ledger (labels, signs, ball vs tanga) and the referral card.
 *
 * Mutations (each turned the named test red, then restored):
 *   returnTo "/uz/purchase" → signed out; hero shows `balance` not the total → hero;
 *   «To'ldirish» opens login → PayDialog; unit always «tanga» / no tool lookup /
 *   no income colour → Harakatlar; no 8-row cut → long ledger; no `focus()` →
 *   referral focus; ledger not reloaded on `paid` → ?order= paid; cancelled
 *   branch dropped → ?order= cancelled; no Tashkent offset → wallet-model.
 */

const realFetch = globalThis.fetch;
// jsdom without `pretendToBeVisual`: `document.hidden === true` would park `waitTurn`.
Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useUi.setState({ overlay: null, returnTo: null });
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const USER = {
  id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 3000, quota: 0,
  balance: 12_000, university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "", teacher: "",
  city: "", position: "", organization: "", phone: null, isAdmin: false,
} as api.ServerUser;

const at = (iso: string) => iso;
const LEDGER: api.LedgerEntry[] = [
  { id: "t1", kind: "charge", amount: -3000, note: "slide: Orol dengizi fojiasi", createdAt: at("2026-10-07T05:24:00.000Z") },
  { id: "t2", kind: "topup", amount: 20_000, note: "click orqali to'ldirish", createdAt: at("2026-10-06T16:05:00.000Z") },
  { id: "t3", kind: "bonus", amount: 2000, note: "Do'st taklifi: Aziz", createdAt: at("2026-10-05T08:00:00.000Z") },
  { id: "t4", kind: "refund", amount: 1500, note: "Slayd yaratildi — farq qaytarildi", createdAt: at("2026-10-04T08:00:00.000Z") },
  { id: "t5", kind: "admin_debit", amount: -500, note: "Ma'muriy tuzatish", createdAt: at("2026-10-03T08:00:00.000Z") },
  { id: "t6", kind: "bonus", amount: 5000, note: "Ro'yxatdan o'tish bonusi", createdAt: at("2026-10-02T08:00:00.000Z") },
];

const REFERRAL = {
  code: "k7m3p9qx", botLink: null, webLink: "https://slaydx.uz/uz?ref=k7m3p9qx", rewardPoints: 2000,
  invitedCount: 1, earnedPoints: 2000, recent: [],
};

type Calls = string[];
function stub(opts: { ledger?: api.LedgerEntry[]; me?: () => Response; orderState?: () => api.PaymentOrder["state"] } = {}): Calls {
  const calls: Calls = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(`${(init.method ?? "GET").toUpperCase()} ${url}`);
    if (url === "/api/users/me") return opts.me ? opts.me() : json(200, { user: USER, transactions: opts.ledger ?? LEDGER });
    if (url === "/api/payments/orders") {
      return json(200, {
        orders: [{ id: "o1", provider: "click", purpose: "topup", amountSoum: 10_000, state: opts.orderState?.() ?? "paid", createdAt: "2026-10-06T16:00:00.000Z" }],
        providers: { click: true, payme: true },
      });
    }
    if (url === "/api/referral") return json(200, REFERRAL);
    return json(404, {});
  }) as typeof fetch;
  return calls;
}

const router = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
function mount(search = "") {
  return render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(PathnameContext.Provider, { value: "/uz/wallet" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, h("div", null, h(WalletPage), h(PayDialog)))),
    ),
  );
}

let refreshes = 0;
function signIn() {
  refreshes = 0;
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    user: USER,
    features: { payments: { click: true, payme: true } } as never,
    refreshSession: async () => {
      refreshes++;
    },
  });
}

const hero = () => document.querySelector("[data-wallet-hero]")?.getAttribute("data-wallet-hero") ?? null;
const banner = () => document.querySelector("[data-pay-banner]")?.getAttribute("data-pay-banner") ?? null;

test("Hamyon: session not checked yet → a busy hero, no buttons, no requests for the ledger", () => {
  useAppStore.setState({ sessionChecked: false, loggedIn: false, user: null });
  const calls = stub();
  mount();
  assert.equal(hero(), "loading");
  assert.equal(document.querySelector("[data-wallet-hero]")!.getAttribute("aria-busy"), "true");
  assert.ok(!screen.queryByRole("button", { name: /To.ldirish/ }));
  assert.ok(!calls.some((c) => c.endsWith("/api/users/me")));
});

test("Hamyon: signed out → «Kirish» opens login returning to /uz/wallet; no ledger, no referral", async () => {
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null });
  const calls = stub();
  mount();
  assert.equal(hero(), "signed-out");
  fireEvent.click(screen.getByRole("button", { name: "Kirish" }));
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/wallet");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.ok(!calls.some((c) => c.endsWith("/api/users/me") || c.endsWith("/api/referral")), calls.join(", "));
  assert.ok(!document.querySelector("[data-referral-card]"));
  assert.ok(!document.querySelector("[data-wallet-ledger]"));
  assert.ok(document.querySelector("[data-wallet-features]"), "the top-up facts stay visible");
});

test("Hamyon: hero shows the spendable total (points + balance) and the bonus share", async () => {
  signIn();
  stub();
  mount();
  assert.equal(hero(), "ready");
  assert.equal(document.querySelector("[data-wallet-total]")!.textContent, "15 000 tanga");
  assert.equal(document.querySelector("[data-wallet-split]")!.textContent, "Shundan 3 000 ball — bonus");
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="ready"]')));
});

test("Hamyon: «To'ldirish» opens the existing PayDialog (presets + Click/Payme)", async () => {
  signIn();
  stub();
  mount();
  assert.ok(!screen.queryByRole("dialog"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "To'ldirish" }));
  });
  assert.equal(useUi.getState().overlay, "pay");
  const dialog = screen.getByRole("dialog");
  assert.match(dialog.textContent ?? "", /To.lov usuli/);
  assert.ok(screen.getByRole("button", { name: "50 000 so'm" })); // redesign W5: was «50k»
});

test("Hamyon: «Harakatlar» — readable label per kind, signed amounts, ball vs tanga, income marked", async () => {
  signIn();
  stub();
  mount();
  await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="ready"]')));
  const rows = [...document.querySelectorAll("[data-ledger-row]")].map((li) => ({
    kind: li.getAttribute("data-ledger-row"),
    title: li.querySelector("[data-ledger-title]")!.textContent,
    amount: li.querySelector("[data-ledger-amount]")!.firstChild!.textContent,
    tone: li.querySelector("[data-ledger-amount]")!.getAttribute("data-ledger-amount"),
    unit: li.querySelector("[data-ledger-unit]")!.textContent,
  }));
  assert.deepEqual(rows, [
    { kind: "charge", title: "Slayd: Orol dengizi fojiasi", amount: "−3 000", tone: "out", unit: "tanga" },
    { kind: "topup", title: "To'ldirish · Click", amount: "+20 000", tone: "in", unit: "tanga" },
    { kind: "bonus", title: "Taklif bonusi · Aziz", amount: "+2 000", tone: "in", unit: "ball" },
    { kind: "refund", title: "Pul qaytarildi", amount: "+1 500", tone: "in", unit: "tanga" },
    { kind: "admin_debit", title: "Ma'muriy tuzatish", amount: "−500", tone: "out", unit: "tanga" },
    { kind: "bonus", title: "Ro'yxatdan o'tish bonusi", amount: "+5 000", tone: "in", unit: "ball" },
  ]);
  const income = document.querySelector('[data-ledger-amount="in"]')!;
  assert.match(income.className, /--success-text/, "income is green");
  assert.doesNotMatch(document.querySelector('[data-ledger-amount="out"]')!.className, /--success-text/);
  // The refund keeps its server note as the detail line.
  assert.match(document.querySelector('[data-ledger-row="refund"]')!.textContent!, /\d\d:\d\d · Slayd yaratildi — farq qaytarildi\+/);
});

test("Hamyon: long ledger shows 8 rows, then all 30 behind a 44 px toggle; empty and error states", async () => {
  signIn();
  const many = Array.from({ length: 30 }, (_, i) => ({ ...LEDGER[0]!, id: `m${i}` }));
  stub({ ledger: many });
  mount();
  await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="ready"]')));
  assert.equal(document.querySelectorAll("[data-ledger-row]").length, 8);
  const more = screen.getByRole("button", { name: "Hammasini ko'rsatish (30)" });
  assert.match(more.className, /\bh-11\b/);
  fireEvent.click(more);
  assert.equal(document.querySelectorAll("[data-ledger-row]").length, 30);
  cleanup();

  stub({ ledger: [] });
  mount();
  await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="empty"]')));
  cleanup();

  let n = 0;
  stub({ me: () => (++n === 1 ? json(500, { error: "x" }) : json(200, { user: USER, transactions: LEDGER })) });
  mount();
  await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="error"]')));
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="ready"]')));
});

test("Hamyon: recent payments list with state labels", async () => {
  signIn();
  stub({ orderState: () => "cancelled" });
  mount();
  await waitFor(() => assert.ok(document.querySelector("[data-wallet-orders]")));
  const li = document.querySelector("[data-wallet-orders] li")!;
  assert.match(li.textContent!, /^Click · 10 000 so'm/);
  assert.equal(li.querySelector("[data-order-state]")!.textContent, "Bekor");
});

test("Hamyon: «Do'st taklif qilish» moves focus to the referral card", async () => {
  signIn();
  stub();
  mount();
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="ready"]')));
  fireEvent.click(screen.getByRole("button", { name: "Do'st taklif qilish" }));
  assert.equal(document.activeElement?.id, "wallet-referral");
  assert.ok(document.activeElement!.querySelector("[data-referral-card]"));
});

async function advance(t: import("node:test").TestContext, ms: number) {
  for (let done = 0; done < ms; done += 500) {
    await act(async () => {
      t.mock.timers.tick(500);
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    });
  }
}

test("Hamyon ?order=: pending → paid banner, balance refreshed, ledger reloaded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  signIn();
  let state: api.PaymentOrder["state"] = "pending";
  const calls = stub({ orderState: () => state });
  mount("order=o1");
  await advance(t, 1000);
  assert.equal(banner(), "pending");
  const meBefore = calls.filter((c) => c === "GET /api/users/me").length;
  state = "paid";
  await advance(t, 6000);
  assert.equal(banner(), "paid");
  assert.match(document.querySelector("[data-pay-banner]")!.textContent!, /To.lov qabul qilindi/);
  assert.ok(refreshes >= 1, "store balance refreshed");
  assert.ok(calls.filter((c) => c === "GET /api/users/me").length > meBefore, "ledger reloaded after the payment");
});

test("Hamyon ?order=: cancelled → «bekor qilindi»", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  signIn();
  stub({ orderState: () => "cancelled" });
  mount("order=o1");
  await advance(t, 4000);
  assert.equal(banner(), "cancelled");
  assert.equal(refreshes, 0);
});

test("wallet-model: Tashkent-time labels and kind fallbacks", () => {
  const now = Date.parse("2026-10-07T12:00:00.000Z"); // 17:00 in Tashkent
  assert.equal(formatWhen("2026-10-07T05:24:00.000Z", now), "Bugun, 10:24");
  assert.equal(formatWhen("2026-10-06T16:05:00.000Z", now), "Kecha, 21:05");
  assert.equal(formatWhen("2026-10-06T19:30:00.000Z", now), "Bugun, 00:30", "after Tashkent midnight is today");
  assert.equal(formatWhen("2026-10-05T08:00:00.000Z", now), "5-oktabr, 13:00");
  assert.equal(formatWhen("2025-12-31T08:00:00.000Z", now), "31-dekabr 2025");
  assert.equal(formatWhen("nope", now), "");

  assert.deepEqual(describeEntry({ kind: "charge", note: "unknown-tool: x" }), { title: "unknown-tool: x", detail: "" });
  assert.deepEqual(describeEntry({ kind: "charge", note: "" }), { title: "Hujjat uchun to'lov", detail: "" });
  assert.deepEqual(describeEntry({ kind: "topup", note: "" }), { title: "Balans to'ldirildi", detail: "" });
  assert.deepEqual(describeEntry({ kind: "topup", note: "payme orqali to'ldirish" }), { title: "To'ldirish · Payme", detail: "" });
  assert.equal(describeEntry({ kind: "subscription", note: "Pro obuna (eski buyurtma) — balansga" }).title, "To'lov balansga tushdi");
  assert.doesNotMatch(JSON.stringify(describeEntry({ kind: "subscription", note: "Pro obuna" })), /Pro|obuna/, "no Pro/obuna wording");
  assert.doesNotMatch(describeEntry({ kind: "quota_merge", note: "Kvota balansga o'tkazildi: 5 tanga" }).title, /kvota/i);
  assert.deepEqual(describeEntry({ kind: "something_new", note: "" }), { title: "Hisob harakati", detail: "" });
  assert.equal(ledgerRow({ id: "z", kind: "quota_merge", amount: 0, note: "", createdAt: "2026-10-07T05:24:00.000Z" }, now).amount, "0");
  assert.equal(ledgerRow({ id: "z", kind: "quota_merge", amount: 0, note: "", createdAt: "2026-10-07T05:24:00.000Z" }, now).tone, "zero");
});
