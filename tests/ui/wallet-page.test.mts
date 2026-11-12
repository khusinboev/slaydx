import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WalletPage } from "../../components/wallet/WalletPage.tsx";
import { describeEntry, formatWhen, ledgerRow, providerLabel, topupFeatures } from "../../components/wallet/wallet-model.ts";
import { paymentBonusNote } from "../../lib/payment-bonus.ts";

/** A legacy Bonus 2 first top-up row (history; new payments write `paymentBonusNote`). */
const FIRST_TOPUP_NOTE = "Birinchi to‘ldirish bonusi (10%)";
import { PayDialog } from "../../components/overlays/PayDialog.tsx";
import { openPay, usePayAmount } from "../../components/overlays/pay-amount.ts";
import { useAppStore } from "../../lib/store.ts";
import { useUi } from "../../lib/ui.ts";
import { groupDigits } from "../../lib/format.ts";
import { paynetPayLink } from "../../lib/paynet-link.ts";
import { MAX_TOPUP_SOUM, MIN_TOPUP_SOUM } from "../../lib/topup-limits.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * Redesign W3 «Hamyon» (docs/redesign/PLAN.md): balance hero, signed-out and
 * loading states, «To'ldirish» → the top-up sheet's method chooser, the «To'ldirish
 * usullari» rows (owner 2026-11-12) → the sheet's «Summa» step, `?order=` banners,
 * the «Harakatlar» ledger (labels, signs, bonus so'm vs so'm) and the referral card.
 *
 * Mutations (each turned the named test red, then restored):
 *   returnTo "/uz/purchase" → signed out; hero shows `balance` not the total → hero;
 *   «To'ldirish» opens login → PayDialog; unit always «so'm» / no tool lookup /
 *   no income colour → Harakatlar; no 8-row cut → long ledger; no `focus()` →
 *   referral focus; ledger not reloaded on `paid` → ?order= paid; cancelled
 *   branch dropped → ?order= cancelled; no Tashkent offset → wallet-model;
 *   payment bonus hint: `bonusPercent > 0` gate dropped → «hint hidden …»; `onBonusPercent` not called
 *   on reload → «… after the paid reload»; PAYMENT_BONUS_NOTE_PREFIX branch dropped → wallet-model.
 */

const realFetch = globalThis.fetch;
// jsdom without `pretendToBeVisual`: `document.hidden === true` would park `waitTurn`.
Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useUi.setState({ overlay: null, returnTo: null });
  usePayAmount.setState({ amount: 0, method: null, bonusPercent: null });
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
  assert.equal(document.querySelector("[data-wallet-total]")!.textContent, "15 000 so'm");
  assert.equal(document.querySelector("[data-wallet-split]")!.textContent, "Shundan 3 000 bonus so'm");
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="ready"]')));
});

test("Hamyon: «To'ldirish» opens the top-up sheet at the method chooser (no amount yet)", async () => {
  // MUTATION: the hero opening `openPay({ method: "app" })` → the sheet skips the chooser.
  signIn();
  stub();
  mount();
  assert.ok(!screen.queryByRole("dialog"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "To'ldirish" }));
  });
  assert.equal(useUi.getState().overlay, "pay");
  const dialog = screen.getByRole("dialog");
  assert.match(dialog.textContent ?? "", /To.lov usulini tanlang/);
  assert.ok(dialog.querySelector('[data-pay-step="choose"]'));
  assert.deepEqual([...dialog.querySelectorAll("[data-pay-methods] [data-pay-method]")].map((b) => b.getAttribute("data-pay-method")), ["click", "payme"]);
  assert.ok(!dialog.querySelector("[data-pay-amount-input]"), "the amount comes after the method");
});

/* ───────────────────────────── «To'ldirish usullari» (owner 2026-11-12) ───────────────────────────── */

const walletMethods = () => [...document.querySelectorAll("[data-wallet-methods] [data-wallet-method]")].map((b) => b.getAttribute("data-wallet-method"));

test("Hamyon methods: no preset amounts on the page — one row per enabled method, in the wallet order", async () => {
  // MUTATION: `paynet` row without its flag / Payme before Paynet → red.
  for (const [payments, want] of [
    [{ click: true, payme: true, clickDirect: true, paynet: true }, ["app", "card", "phone", "paynet", "payme"]],
    [{ click: true, payme: false, clickDirect: true }, ["app", "card", "phone"]],
    [{ click: true, payme: true }, ["click", "payme"]],
    [{ click: false, payme: false, paynet: true }, ["paynet"]],
  ] as const) {
    signIn();
    useAppStore.setState({ features: { payments } as never });
    stub();
    mount();
    assert.deepEqual(walletMethods(), [...want], JSON.stringify(payments));
    const section = document.querySelector("[data-wallet-methods]")!;
    assert.equal(section.querySelector("h2")!.textContent, "To'ldirish usullari");
    assert.ok(!document.querySelector("[data-wallet-pack], [data-wallet-packs], [data-pay-amount]"), "no amount cards");
    assert.ok(!/\b(10|25|50|100) 000\b/.test(section.textContent ?? ""), "no amount text in the methods section");
    for (const b of section.querySelectorAll("[data-wallet-method]")) {
      assert.match(b.className, /min-h-\[68px\]/, "≥ 44 px rows");
      assert.ok(b.querySelector("svg"), "badge / chevron");
    }
    cleanup();
  }
  signIn();
  useAppStore.setState({ features: { payments: { click: false, payme: false } } as never });
  stub();
  mount();
  assert.deepEqual(walletMethods(), []);
  assert.ok(document.querySelector("[data-wallet-methods-none]"), "nothing to pick: says so");
});

test("Hamyon methods: names and hints of each row", async () => {
  signIn();
  useAppStore.setState({ features: { payments: { click: true, payme: true, clickDirect: true, paynet: true } } as never });
  stub();
  mount();
  const text = (id: string) => document.querySelector(`[data-wallet-method="${id}"]`)!.textContent;
  assert.equal(text("app"), "Click ilovasiClick ilovasida bir bosishda");
  assert.equal(text("card"), "Bank kartasiUzcard, Humo va boshqa kartalar · SMS kod bilan");
  assert.equal(text("phone"), "Telefon raqamClick hisob-fakturasi telefoningizga keladi");
  assert.equal(text("paynet"), "PaynetPaynet ilovasi yoki terminali orqali");
  assert.equal(text("payme"), "PaymePayme sahifasiga o'tasiz");
});

for (const m of ["app", "card", "phone", "paynet", "payme"] as const) {
  test(`Hamyon method «${m}»: opens the sheet at its «Summa» step with an EMPTY amount`, async () => {
    // MUTATION: `openPay` keeping the last amount / the wallet row passing an amount → the input is filled.
    signIn();
    useAppStore.setState({ features: { payments: { click: true, payme: true, clickDirect: true, paynet: true } } as never });
    usePayAmount.setState({ amount: 50_000 });
    const calls = stub();
    mount();
    await act(async () => {
      fireEvent.click(document.querySelector(`[data-wallet-method="${m}"]`)!);
    });
    assert.equal(useUi.getState().overlay, "pay");
    const dialog = screen.getByRole("dialog");
    assert.ok(dialog.querySelector('[data-pay-step="amount"]'));
    assert.equal(dialog.querySelector("[data-pay-chosen]")!.getAttribute("data-pay-chosen"), m);
    assert.equal((dialog.querySelector("[data-pay-amount-input]") as HTMLInputElement).value, "");
    assert.ok((dialog.querySelector("[data-pay-continue]") as HTMLButtonElement).disabled);
    assert.ok(!calls.some((c) => c.startsWith("POST ")), "nothing is created by choosing");
  });
}

test("Hamyon methods signed out: a row opens the login returning to /uz/wallet (the sheet does not open)", async () => {
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null, features: { payments: { click: true, payme: true } } as never });
  stub();
  mount();
  fireEvent.click(document.querySelector('[data-wallet-method="click"]')!);
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/wallet");
});

test("Hamyon methods: the payment bonus percent from /me reaches the sheet's preview", async () => {
  // MUTATION: `usePayAmount.setBonusPercent` not called from the wallet → no preview in the sheet.
  signIn();
  useAppStore.setState({ features: { payments: { click: true, payme: true, clickDirect: true } } as never });
  stub({ me: meWith(10) });
  mount();
  await waitFor(() => assert.equal(hintText(), "Har bir to‘ldirishga +10% bonus"));
  await act(async () => {
    fireEvent.click(document.querySelector('[data-wallet-method="card"]')!);
  });
  await act(async () => {
    fireEvent.change(document.querySelector("[data-pay-amount-input]")!, { target: { value: "25000" } });
  });
  assert.equal(document.querySelector("[data-pay-bonus-preview]")!.textContent, `+${groupDigits(2_500)} so'm bonus · Balansga jami: ${groupDigits(27_500)} so'm`);
});

test("Hamyon features: the payment line names only the enabled providers", () => {
  // MUTATION: the old fixed «Click yoki Payme» line → red for every case but the second.
  const line = (p: Parameters<typeof topupFeatures>[0]) => topupFeatures(p).find((f) => f.includes("xavfsiz")) ?? null;
  assert.equal(line({ click: true, paynet: true, payme: true }), "Click, Paynet yoki Payme orqali xavfsiz to'lov");
  assert.equal(line({ click: true, payme: true }), "Click yoki Payme orqali xavfsiz to'lov");
  assert.equal(line({ click: true, paynet: true, payme: false }), "Click yoki Paynet orqali xavfsiz to'lov");
  assert.equal(line({ paynet: true }), "Paynet orqali xavfsiz to'lov");
  assert.equal(line({ click: false, payme: false }), null, "no provider: no promise");
  assert.equal(line(null), null);
  assert.equal(topupFeatures({ click: true }).length, 4);
});

test("Hamyon: «Harakatlar» — readable label per kind, signed amounts, bonus so'm vs so'm, income marked", async () => {
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
    { kind: "charge", title: "Slayd: Orol dengizi fojiasi", amount: "−3 000", tone: "out", unit: "so'm" },
    { kind: "topup", title: "To'ldirish · Click", amount: "+20 000", tone: "in", unit: "so'm" },
    { kind: "bonus", title: "Taklif bonusi · Aziz", amount: "+2 000", tone: "in", unit: "bonus so'm" },
    { kind: "refund", title: "Pul qaytarildi", amount: "+1 500", tone: "in", unit: "so'm" },
    { kind: "admin_debit", title: "Ma'muriy tuzatish", amount: "−500", tone: "out", unit: "so'm" },
    { kind: "bonus", title: "Ro'yxatdan o'tish bonusi", amount: "+5 000", tone: "in", unit: "bonus so'm" },
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

// ───────────────────────── payment bonus hint (C-Q4: every paid top-up earns N %)

const hintText = () => document.querySelector("[data-wallet-payment-bonus]")?.textContent ?? null;
const meWith = (paymentBonusPercent: unknown) => () => json(200, { user: USER, transactions: LEDGER, paymentBonusPercent });

test("Hamyon: «Har bir to‘ldirishga +N% bonus» on the top-up area with the percent /me sends", async () => {
  for (const [p, text] of [[10, "Har bir to‘ldirishga +10% bonus"], [25, "Har bir to‘ldirishga +25% bonus"], [50, "Har bir to‘ldirishga +50% bonus"]] as const) {
    signIn();
    stub({ me: meWith(p) });
    mount();
    await waitFor(() => assert.equal(hintText(), text));
    assert.ok(document.querySelector("[data-wallet-payment-bonus]")!.closest("[data-wallet-methods]"), "inside «To'ldirish usullari»");
    const hint = document.querySelector("[data-wallet-payment-bonus]")!;
    assert.ok(hint.compareDocumentPosition(document.querySelector("[data-wallet-methods] ul")!) & Node.DOCUMENT_POSITION_FOLLOWING, "above the method rows");
    cleanup();
  }
  assert.ok(!document.querySelector("[data-wallet-first-bonus]"), "the first top-up hint is gone");
});

test("Hamyon: payment bonus hint hidden at 0 %, for a missing / invalid value, or signed out", async () => {
  // MUTATION: the `bonusPercent > 0` gate dropped → «+0% bonus» rendered.
  for (const value of [0, undefined, "10", 51, -5, 2.5, null]) {
    signIn();
    stub({ me: meWith(value) });
    mount();
    await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="ready"]')));
    assert.ok(!document.querySelector("[data-wallet-payment-bonus]"), `no hint for ${String(value)}`);
    cleanup();
  }
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null });
  stub({ me: meWith(10) });
  mount();
  assert.ok(document.querySelector("[data-wallet-methods]"));
  assert.ok(!document.querySelector("[data-wallet-payment-bonus]"), "signed out: no hint");
});

test("Hamyon ?order=: the hint follows /me after the paid reload (still shown — every top-up earns; gone when switched off)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  signIn();
  let state: api.PaymentOrder["state"] = "pending";
  let percent = 10;
  stub({ orderState: () => state, me: () => meWith(percent)() });
  mount("order=o1");
  await advance(t, 1000);
  assert.equal(hintText(), "Har bir to‘ldirishga +10% bonus");
  state = "paid";
  percent = 0;
  await advance(t, 6000);
  assert.equal(banner(), "paid");
  assert.equal(hintText(), null);
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

/* ───────────────────────────── Paynet in the top-up sheet (docs/payments/PAYNET.md «UI») ───────────────────────────── */

/**
 * Owner 2026-11-12: Paynet is one of the «To'ldirish usullari»; the sheet asks the amount first, then the Paynet step
 * shows the user's own SlaydX ID first and biggest (the payer types it into Paynet), the amount, a short wrong-ID
 * warning and «Paynet ilovasini ochish» — the app opens ONLY on that tap (no longer when the method is chosen).
 * Mutations: see the `MUTATION:` notes next to the assertions.
 */
// jsdom has no window.open: the Paynet button opens the app in a new tab; record it.
let opened: Array<[string, string | undefined, string | undefined]> = [];
(window as unknown as { open: unknown }).open = (u: string, target?: string, features?: string) => {
  opened.push([u, target, features]);
  return null;
};
const paynetStep = () => document.querySelector('[data-pay-step="paynet"]');
const paynetNotice = () => document.querySelector("[data-paynet-notice]")!;
const docExec = document as unknown as { execCommand?: (c: string) => boolean };
const navAny = navigator as unknown as Record<string, unknown>;
const realExec = docExec.execCommand;
const tg = window as unknown as Record<string, unknown>;
function signInWithPaynet(paynet: boolean | undefined, extra: Record<string, unknown> = {}) {
  signIn();
  useAppStore.setState({ features: { payments: { click: true, payme: true, ...(paynet === undefined ? {} : { paynet }), ...extra } } as never });
}
const paynetRow = () => document.querySelector('[data-wallet-methods] [data-wallet-method="paynet"]') as HTMLButtonElement | null;
const continueBtn = () => document.querySelector("[data-pay-continue]") as HTMLButtonElement;
/** The wallet's Paynet row → «Summa» (typed `amount`) → «Davom etish». */
async function toPaynet(amount = "37000") {
  await act(async () => {
    fireEvent.click(paynetRow()!);
  });
  await act(async () => {
    fireEvent.change(document.querySelector("[data-pay-amount-input]")!, { target: { value: amount } });
  });
  await act(async () => {
    fireEvent.click(continueBtn());
  });
}
afterEach(() => {
  delete navAny.clipboard;
  docExec.execCommand = realExec;
  delete tg.Telegram;
  delete tg.TelegramWebviewProxy;
});

test("Hamyon Paynet: a method row and a chooser row only while the server has Paynet configured; no separate Paynet card", async () => {
  // MUTATION: the `payments.paynet === true` check dropped in `enabledPayMethods` → a Paynet row without Paynet.
  for (const paynet of [undefined, false]) {
    signInWithPaynet(paynet);
    stub();
    mount();
    assert.ok(!paynetRow(), `no Paynet row for paynet=${String(paynet)}`);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "To'ldirish" }));
    });
    const dialog = screen.getByRole("dialog");
    assert.ok(!dialog.querySelector('[data-pay-method="paynet"]'));
    assert.ok(!/Paynet/.test(dialog.textContent ?? ""), "no Paynet text in the sheet");
    cleanup();
    useUi.setState({ overlay: null });
  }
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883" });
  stub();
  mount();
  await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="ready"]')));
  assert.ok(paynetRow());
  assert.ok(paynetRow()!.querySelector("svg"), "the Paynet mark");
  assert.ok(!document.querySelector("[data-wallet-paynet]"), "the old standalone card is gone");
  assert.ok(!document.querySelector("[data-paynet-id]"), "the ID is shown in the sheet, not on the page");
});

test("Hamyon Paynet: the amount comes first — «Davom etish» disabled while it is invalid; choosing opens nothing", async () => {
  opened = [];
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883", paynetPrefill: true });
  const calls = stub();
  mount();
  await act(async () => {
    fireEvent.click(paynetRow()!);
  });
  assert.ok(document.querySelector('[data-pay-step="amount"]'));
  assert.equal(opened.length, 0, "choosing Paynet opens nothing");
  const input = document.querySelector("[data-pay-amount-input]") as HTMLInputElement;
  for (const value of ["5", "", "99999999"]) {
    await act(async () => {
      fireEvent.change(input, { target: { value } });
    });
    assert.equal(continueBtn().disabled, true, `disabled for ${JSON.stringify(value)}`);
  }
  await act(async () => {
    fireEvent.change(input, { target: { value: "30000" } });
  });
  assert.equal(continueBtn().disabled, false);
  assert.ok(!paynetStep());
  assert.ok(!calls.some((c) => c.startsWith("POST ")));
});

test("Hamyon Paynet: with PAYNET_APP_PREFILL nothing opens until «Paynet ilovasini ochish»; then a NEW tab with the ID and the TYPED amount (tiyin)", async () => {
  // MUTATIONS: the app opened on «Davom etish» (the old `openPaynet`) / `a` in so'm / `c` dropped / same-tab
  // navigation / prefill ignoring the switch → this test is red.
  opened = [];
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883", paynetPrefill: true });
  stub();
  mount();
  await toPaynet("37000");
  assert.ok(paynetStep(), "the Paynet step");
  assert.deepEqual(opened, [], "not opened by «Davom etish»");
  assert.ok(!document.querySelector("[data-paynet-launched]"));
  const open = document.querySelector("[data-paynet-open]") as HTMLButtonElement;
  assert.equal(open.textContent, "Paynet ilovasini ochish");
  await act(async () => {
    fireEvent.click(open);
  });
  assert.deepEqual(opened, [["https://app.paynet.test/?m=54883&c=u1&a=3700000", "_blank", "noopener,noreferrer"]]);
  assert.equal(opened[0]![0], paynetPayLink("https://app.paynet.test/?m=54883", "u1", 37_000), "exactly the shared link builder");
  assert.ok(paynetStep(), "the step stays as the fallback (this tab was not replaced)");
  assert.match(document.querySelector("[data-paynet-launched]")!.textContent ?? "", /ID va summa tayyor/);
  // Reopening the sheet forgets the launch.
  await act(async () => {
    useUi.getState().close();
  });
  await act(async () => {
    useUi.getState().open("pay");
  });
  assert.ok(!paynetStep() && !document.querySelector("[data-paynet-launched]"), "back to the chooser on reopen");
});

test("Hamyon Paynet: prefill switched off → the bare merchant link on the tap, the note asks to type the ID; no link → no button", async () => {
  // MUTATION: prefill applied without `paynetPrefill` → the unverified c/a params reach the app.
  opened = [];
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883" });
  stub();
  mount();
  await toPaynet("25000");
  assert.deepEqual(opened, []);
  await act(async () => {
    fireEvent.click(document.querySelector("[data-paynet-open]")!);
  });
  assert.deepEqual(opened, [["https://app.paynet.test/?m=54883", "_blank", "noopener,noreferrer"]]);
  assert.match(document.querySelector("[data-paynet-launched]")!.textContent ?? "", /ID ni kiriting/);
  assert.ok(!/summa tayyor/.test(document.querySelector("[data-paynet-launched]")!.textContent ?? ""));
  cleanup();
  useUi.setState({ overlay: null });
  opened = [];
  signInWithPaynet(true, { paynetUrl: null, paynetPrefill: true });
  stub();
  mount();
  await toPaynet("25000");
  assert.ok(paynetStep(), "the step still works (manual payment)");
  assert.ok(!document.querySelector("[data-paynet-open]"), "no button without paynetUrl");
  assert.deepEqual(opened, []);
});

test("Telegram: «Paynet ilovasini ochish» opens the link EXTERNALLY (WebApp.openLink), not window.open", async () => {
  const tgOpens: string[] = [];
  tg.TelegramWebviewProxy = { postEvent() {} };
  tg.Telegram = { WebApp: { initData: "user=1", version: "8.0", platform: "ios", initDataUnsafe: { user: { id: 700 } }, openLink: (u: string) => tgOpens.push(u) } };
  opened = [];
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883", paynetPrefill: true });
  stub();
  mount();
  await toPaynet("12000");
  await act(async () => {
    fireEvent.click(document.querySelector("[data-paynet-open]")!);
  });
  assert.deepEqual(tgOpens, ["https://app.paynet.test/?m=54883&c=u1&a=1200000"]);
  assert.deepEqual(opened, []);
});

test("Hamyon Paynet: the ID first and biggest, then the typed amount, a short wrong-ID warning, the button; the steps folded; no order; back → «Summa»", async () => {
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883" });
  const calls = stub();
  mount();
  await toPaynet("37000");
  const step = paynetStep() as HTMLElement;
  assert.ok(within(screen.getByRole("dialog")).getByRole("heading", { name: "Paynet orqali to'lash" }));
  assert.equal(document.querySelector('[data-pay-progress] [aria-current="step"]')!.textContent, "Paynet");
  const card = step.querySelector("[data-paynet-id-card]") as HTMLElement;
  assert.equal(step.firstElementChild, card, "the ID card is the first thing in the step");
  assert.match(card.className, /emerald/, "brand-tinted card");
  assert.equal(card.querySelector("h3")!.textContent, "Sizning SlaydX ID raqamingiz");
  const id = step.querySelector("[data-paynet-id]") as HTMLElement;
  assert.equal(id.textContent, "u1", "the user's id, nothing else");
  // MUTATION: the size back to 28 px → red (very large digits, owner 2026-11-12).
  const px = Number(/text-\[(\d+)px\]/.exec(id.className)?.[1] ?? 0);
  assert.ok(px >= 44 && px <= 56, `ID font ${px}px is 44–56 px`);
  assert.match(id.className, /font-mono/);
  assert.equal(card.querySelector("[data-paynet-id-hint]")!.textContent, "Paynet ilovasida «ID» maydoniga aynan shu raqamni kiriting");
  const copy = within(card).getByRole("button", { name: "SlaydX ID ni nusxalash" });
  assert.match(copy.className, /\bh-12\b/, "big copy button");
  assert.equal(copy.textContent, "Nusxalash");
  assert.equal(step.querySelector("[data-paynet-amount]")!.textContent, `${groupDigits(37_000)} so'm`, "the amount typed in step 1");
  assert.match(step.querySelector("[data-paynet-summary]")!.textContent ?? "", /^To'lov summasi/);
  // Prod incident 2026-10-31 (the amount «3000» typed into the ID field paid user #3000): the warning keeps its meaning.
  const warning = step.querySelector("[data-paynet-warning]")!;
  assert.equal(warning.textContent, "ID maydoniga summani yozmang. To'lashdan oldin Paynet ko'rsatgan ism sizniki ekanini tekshiring.");
  const order = ["[data-paynet-id-card]", "[data-paynet-summary]", "[data-paynet-warning]", "[data-paynet-open]", "[data-paynet-howto]"].map((s) => step.querySelector(s)!);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `order ${i}`);
  }
  const howto = step.querySelector("[data-paynet-howto]") as HTMLDetailsElement;
  assert.equal(howto.tagName, "DETAILS");
  assert.equal(howto.open, false, "the steps are folded");
  assert.equal(howto.querySelector("summary")!.textContent, "Qanday to'lanadi?");
  assert.deepEqual([...step.querySelectorAll("[data-paynet-steps] li")].map((li) => li.textContent), [
    "1Paynet ilovasi yoki terminalini oching",
    "2«SlaydX» xizmatini tanlang",
    "3ID maydoniga ID raqamingizni kiriting",
    "4Paynet ko'rsatgan ism sizniki ekanini tekshirib, to'lang — summa balansga darhol tushadi",
  ]);
  assert.equal(
    step.querySelector("[data-paynet-any-amount]")!.textContent,
    `Balansga Paynet'da aynan to'lagan summangiz tushadi (eng kami ${groupDigits(MIN_TOPUP_SOUM)}, eng ko'pi ${groupDigits(MAX_TOPUP_SOUM)} so'm).`,
  );
  assert.ok(!calls.some((c) => c === "POST /api/payments/orders"), `no order: ${calls.join(" | ")}`);
  await act(async () => {
    fireEvent.click(document.querySelector("[data-pay-back]")!);
  });
  assert.ok(!paynetStep());
  assert.ok(document.querySelector('[data-pay-step="amount"]'), "back on «Summa»");
  assert.match((document.querySelector("[data-pay-amount-input]") as HTMLInputElement).value, /^37.000$/);
});

test("Hamyon Paynet: signed out → «Davom etish» opens login, not the step", async () => {
  signInWithPaynet(true);
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null });
  stub();
  mount();
  // Signed out the wallet row opens the login itself; a context opener can still open the sheet at Paynet.
  await act(async () => {
    openPay({ method: "paynet", amount: 20_000 });
  });
  await act(async () => {
    fireEvent.click(continueBtn());
  });
  assert.ok(!paynetStep());
  assert.equal(useUi.getState().overlay, "login");
});

test("Hamyon Paynet: signed in but the user not loaded yet → «Davom etish» stays disabled (no empty step)", async () => {
  // MUTATION: `canContinue` for Paynet dropped → the step is entered with no ID to show.
  signInWithPaynet(true);
  useAppStore.setState({ user: null });
  stub();
  mount();
  await act(async () => {
    openPay({ method: "paynet", amount: 20_000 });
  });
  assert.ok(continueBtn().disabled);
  await act(async () => {
    fireEvent.click(continueBtn());
  });
  assert.ok(!paynetStep());
  assert.equal(useUi.getState().overlay, "pay");
});

test("Hamyon Paynet: copy button writes the ID to the clipboard, says so and flips to «Nusxalandi»", async () => {
  // MUTATION: the copy handler copies the amount / the label → red.
  signInWithPaynet(true);
  stub();
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void written.push(t) }, configurable: true });
  mount();
  await toPaynet();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "SlaydX ID ni nusxalash" }));
  });
  assert.deepEqual(written, ["u1"]);
  assert.equal(paynetNotice().textContent, "SlaydX ID nusxalandi");
  assert.equal(paynetNotice().getAttribute("data-paynet-notice"), "ok");
  assert.equal(screen.getByRole("button", { name: "SlaydX ID ni nusxalash" }).textContent, "Nusxalandi");
});

test("Hamyon Paynet: copy falls back to execCommand without the Clipboard API, and reports a failure", async () => {
  signInWithPaynet(true);
  stub();
  const exec: string[] = [];
  docExec.execCommand = (c: string) => (exec.push(c), true);
  mount();
  await toPaynet();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "SlaydX ID ni nusxalash" }));
  });
  assert.deepEqual(exec, ["copy"], "no navigator.clipboard → selection route");
  assert.equal(paynetNotice().textContent, "SlaydX ID nusxalandi");

  docExec.execCommand = () => false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "SlaydX ID ni nusxalash" }));
  });
  assert.equal(paynetNotice().getAttribute("data-paynet-notice"), "error");
  assert.match(paynetNotice().textContent ?? "", /Nusxalab bo'lmadi/);
  assert.equal(screen.getByRole("button", { name: "SlaydX ID ni nusxalash" }).textContent, "Nusxalash", "no «copied» on a failure");
  assert.equal(document.querySelector("[data-paynet-id]")!.textContent, "u1", "the ID stays visible to copy by hand");
});

test("Hamyon Paynet: a Paynet top-up reads «To'ldirish · Paynet» in the ledger and «Paynet» in recent payments", () => {
  // MUTATION: `paynet` dropped from wallet-model PROVIDERS → «Balans to'ldirildi» / the raw code.
  assert.deepEqual(describeEntry({ kind: "topup", note: "paynet orqali to'ldirish" }), { title: "To'ldirish · Paynet", detail: "" });
  assert.equal(providerLabel("paynet"), "Paynet");
  assert.equal(providerLabel("click"), "Click");
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
  // C-Q4 payment bonus rows (settleOrder, `paymentBonusNote`) read «To‘lov bonusi (N%)», in bonus so'm.
  assert.deepEqual(describeEntry({ kind: "bonus", note: paymentBonusNote(15) }), { title: "To‘lov bonusi (15%)", detail: "" });
  const pay = ledgerRow({ id: "p", kind: "bonus", amount: 5_000, note: paymentBonusNote(10), createdAt: "2026-10-07T05:24:00.000Z" }, now);
  assert.deepEqual([pay.title, pay.amount, pay.unit, pay.tone], ["To‘lov bonusi (10%)", "+5 000", "bonus", "in"]);
  // A legacy first top-up bonus row (Bonus 2 history) still reads «Birinchi to‘ldirish bonusi», in bonus so'm.
  assert.deepEqual(describeEntry({ kind: "bonus", note: FIRST_TOPUP_NOTE }), { title: "Birinchi to‘ldirish bonusi", detail: "" });
  const first = ledgerRow({ id: "f", kind: "bonus", amount: 20_000, note: FIRST_TOPUP_NOTE, createdAt: "2026-10-07T05:24:00.000Z" }, now);
  assert.deepEqual([first.title, first.amount, first.unit, first.tone], ["Birinchi to‘ldirish bonusi", "+20\u00a0000", "bonus", "in"]);
  // Channel bonus notes (bonus-channels.ts) read as titles, not raw notes.
  assert.deepEqual(describeEntry({ kind: "bonus", note: "Kanal obunasi: SlaydX yangiliklari" }), { title: "Kanal obunasi bonusi · SlaydX yangiliklari", detail: "" });
  assert.deepEqual(describeEntry({ kind: "bonus", note: "Kanalda qolish bonusi: Talabalar" }), { title: "Kanalda qolish bonusi · Talabalar", detail: "" });
  assert.deepEqual(describeEntry({ kind: "topup", note: "" }), { title: "Balans to'ldirildi", detail: "" });
  assert.deepEqual(describeEntry({ kind: "topup", note: "payme orqali to'ldirish" }), { title: "To'ldirish · Payme", detail: "" });
  assert.equal(describeEntry({ kind: "subscription", note: "Pro obuna (eski buyurtma) — balansga" }).title, "To'lov balansga tushdi");
  assert.doesNotMatch(JSON.stringify(describeEntry({ kind: "subscription", note: "Pro obuna" })), /Pro|obuna/, "no Pro/obuna wording");
  assert.doesNotMatch(describeEntry({ kind: "quota_merge", note: "Kvota balansga o'tkazildi: 5 tanga" }).title, /kvota/i);
  assert.deepEqual(describeEntry({ kind: "something_new", note: "" }), { title: "Hisob harakati", detail: "" });
  assert.equal(ledgerRow({ id: "z", kind: "quota_merge", amount: 0, note: "", createdAt: "2026-10-07T05:24:00.000Z" }, now).amount, "0");
  assert.equal(ledgerRow({ id: "z", kind: "quota_merge", amount: 0, note: "", createdAt: "2026-10-07T05:24:00.000Z" }, now).tone, "zero");
});
