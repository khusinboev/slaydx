import "./setup.ts";
import test, { afterEach, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * The top-up sheet (PayDialog) as a step-by-step wizard (owner 2026-11-12) with the DIRECT Click
 * methods (owner 2026-10-09).
 *
 *  - start: `open("pay")` → the method chooser (only enabled methods, wallet order); `openPay({ method })`
 *    → that method's «Summa» step; a stale / disabled method falls back to the chooser;
 *  - «Summa»: an EMPTY input (grouped digits, «so'm»), quick-fill chips that only fill it, inline
 *    validation 1 000 - 10 000 000; «Davom etish» disabled until valid; the bonus preview uses the
 *    server's `paymentBonusPoints` rounding; `openPay({ amount })` pre-fills a suggestion (any amount);
 *  - the step indicator and the back arrow; phone Back steps back one step, then closes;
 *  - «Karta»: card number + MM/YY -> SMS code -> waiting -> success; the card values are gone afterwards;
 *  - «Telefon raqam»: +998 fixed, 9 digits -> invoice -> waiting -> success;
 *  - «Click ilovasi»: the deeplink opens EXTERNALLY in the Telegram Mini App (`openLink`), by plain
 *    navigation elsewhere, then the dialog waits for the order;
 *  - «Click sahifasi orqali to'lash» (fallback under the Click methods' «Davom etish») keeps the redirect flow;
 *  - without the Merchant API (`clickDirect` off) only the plain «Click» method.
 *
 * Mutations (each verified red, then restored): see the `MUTATION:` notes next to the assertions.
 */

const nav = await import("../../lib/nav/history.ts");
const { groupDigits } = await import("../../lib/format.ts");
const { PayDialog } = await import("../../components/overlays/PayDialog.tsx");
const { openPay, usePayAmount } = await import("../../components/overlays/pay-amount.ts");
const { __setBrowserOpenForTests } = await import("../../lib/open-click-app.ts");
const { WAIT_POLL_BUDGET_MS } = await import("../../components/overlays/pay/WaitStep.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");

const w = window as unknown as Record<string, unknown>;
const realFetch = globalThis.fetch;
// jsdom without `pretendToBeVisual`: `document.hidden === true` would make `waitTurn` wait for the tab to show.
Object.defineProperty(document, "hidden", { configurable: true, get: () => false });

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const router = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;

const CHECKOUT = "https://my.click.uz/services/pay?service_id=777&merchant_id=42&amount=25000.00&transaction_param=o9";

type Req = { method: string; url: string; body: Record<string, unknown> | null };
let reqs: Req[] = [];
let exits: Array<[string, boolean]> = [];
let browserOpens: string[] = [];
let tgOpens: string[] = [];
let refreshes = 0;
let orderState: "created" | "pending" | "paid" | "cancelled" = "pending";
let orderSeq = 0;
/** Overridable per test; return a Response to answer, or undefined for the default. */
let hook: ((r: Req) => Response | undefined) | null = null;

function install(t?: TestContext) {
  if (t) t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const r: Req = { method: init?.method ?? "GET", url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    reqs.push(r);
    const custom = hook?.(r);
    if (custom) return custom;
    if (r.url === "/api/payments/orders" && r.method === "POST") {
      const id = orderSeq === 0 ? "o9" : `o9-${orderSeq}`;
      orderSeq++;
      return json(201, { order: { id, provider: r.body?.provider }, checkoutUrl: CHECKOUT });
    }
    if (r.url === "/api/payments/orders") {
      return json(200, {
        orders: [{ id: "o9", provider: "click", purpose: "topup", amountSoum: 25_000, state: orderState, createdAt: "2026-10-09T08:00:00.000Z" }],
        providers: { click: true, payme: false },
      });
    }
    if (r.url === "/api/payments/click/card") return json(200, { phoneMasked: "+998*******67" });
    if (r.url === "/api/payments/click/card/verify") return json(200, { status: "pending" });
    if (r.url === "/api/payments/click/invoice") return json(200, { status: "sent" });
    return json(404, {});
  };
}

type Payments = { click: boolean; payme: boolean; clickDirect?: boolean; paynet?: boolean };
function setup(payments: Payments, opts: { loggedIn?: boolean; t?: TestContext } = {}) {
  useAppStore.setState({
    loggedIn: opts.loggedIn ?? true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments } as never,
    refreshSession: async () => {
      refreshes++;
    },
  });
  install(opts.t);
}

beforeEach(() => {
  reqs = [];
  exits = [];
  browserOpens = [];
  tgOpens = [];
  refreshes = 0;
  orderState = "pending";
  orderSeq = 0;
  hook = null;
  usePayAmount.setState({ amount: 0, method: null, bonusPercent: null });
  nav.__setLeaveSiteForTests((href, replace) => exits.push([href, replace]));
  __setBrowserOpenForTests((u) => browserOpens.push(u));
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  nav.__setLeaveSiteForTests(null);
  nav.__resetNavForTests();
  __setBrowserOpenForTests(null);
  delete w.TelegramWebviewProxy;
  delete w.Telegram;
  useUi.setState({ overlay: null, returnTo: null });
});

function fakeTelegram() {
  w.TelegramWebviewProxy = { postEvent() {} };
  w.Telegram = {
    WebApp: {
      initData: "user=1",
      version: "8.0",
      platform: "ios",
      initDataUnsafe: { user: { id: 700 } },
      openLink: (u: string) => tgOpens.push(u),
    },
  };
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  });
/** Real-timer settle: the overlay exit (`navigateFromOverlay` -> history pop -> `leaveSite`) needs a few real ms. */
const settleReal = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 3));
  });
/** Mocked-timer clock: ticks `ms` in 500 ms steps, letting each fetch / microtask chain finish. */
async function advance(t: TestContext, ms: number) {
  for (let done = 0; done < ms; done += 500) {
    await act(async () => {
      t.mock.timers.tick(500);
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    });
  }
}
function mountDialog() {
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(PathnameContext.Provider, { value: "/uz/wallet" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, h(PayDialog))),
    ),
  );
}
/** Plain `open("pay")` (the hero «To'ldirish», any other opener): the method chooser. */
async function openChooser() {
  mountDialog();
  await act(async () => {
    useUi.getState().open("pay");
  });
  await settle();
}
/** A wallet method row: `openPay({ method })` → that method's «Summa» step. */
async function openAt(m: string, amount?: number) {
  mountDialog();
  await act(async () => {
    openPay({ method: m as never, ...(amount === undefined ? {} : { amount }) });
  });
  await settle();
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const method = (id: string) => q(`[data-pay-method="${id}"]`) as HTMLButtonElement | null;
const amountInput = () => q("[data-pay-amount-input]") as HTMLInputElement;
const continueBtn = () => q("[data-pay-continue]") as HTMLButtonElement;
const step = () => q("[data-pay-step]")?.getAttribute("data-pay-step") ?? null;
const type = (el: Element, value: string) => fireEvent.change(el, { target: { value } });
const orderPosts = () => reqs.filter((r) => r.method === "POST" && r.url === "/api/payments/orders").map((r) => r.body);
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent).join(" | ");
const chooserIds = () => [...document.querySelectorAll("[data-pay-methods] [data-pay-method]")].map((b) => b.getAttribute("data-pay-method"));
const currentStepName = () => q('[data-pay-progress] [aria-current="step"]')?.textContent ?? null;
const stepNames = () => [...document.querySelectorAll("[data-pay-progress] li")].map((li) => li.textContent);
async function goOn() {
  fireEvent.click(continueBtn());
  await settle();
  await settle();
}

const DIRECT = { click: true, payme: false, clickDirect: true };

// ------------------------------------------------------------------ the chooser

test("chooser: open(\"pay\") lists only the enabled methods in the wallet order; unconfigured providers are not drawn", async () => {
  // MUTATION: Paynet listed before the Click methods / Payme without its flag → red.
  setup({ ...DIRECT, payme: true, paynet: true });
  await openChooser();
  assert.equal(step(), "choose");
  assert.deepEqual(chooserIds(), ["app", "card", "phone", "paynet", "payme"]);
  assert.match(method("app")!.textContent ?? "", /^Click ilovasiClick ilovasida bir bosishda/);
  assert.match(method("card")!.textContent ?? "", /^Bank kartasiUzcard \/ Humo, SMS kod bilan/);
  assert.match(method("phone")!.textContent ?? "", /^Telefon raqamClick hisob-fakturasi telefoningizga keladi/);
  assert.match(method("paynet")!.textContent ?? "", /^PaynetPaynet ilovasi yoki terminali orqali/);
  assert.ok(method("app")!.querySelector("svg") && method("paynet")!.querySelector("svg"), "brand marks");
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-pay-methods] button")) {
    assert.match(b.className, /min-h-\[68px\]/, "≥ 44 px rows");
    assert.ok(!b.disabled);
  }
  assert.ok(!q("[data-pay-amount-input]"), "no amount on the chooser");
  assert.ok(!q("[data-pay-back]"), "the first step has no back arrow");
  assert.equal(reqs.length, 0);
  cleanup();

  setup({ click: true, payme: true });
  await openChooser();
  assert.deepEqual(chooserIds(), ["click", "payme"], "no Merchant API: the plain Click page only");
  cleanup();
  setup({ click: false, payme: true });
  await openChooser();
  assert.deepEqual(chooserIds(), ["payme"]);
  cleanup();
  setup({ click: false, payme: false });
  await openChooser();
  assert.deepEqual(chooserIds(), []);
  assert.match(document.body.textContent ?? "", /To.lov provayderi hali ulanmagan/);
});

test("chooser → «Summa»: a row opens the EMPTY amount step for that method, with the step indicator and a back arrow", async () => {
  setup({ ...DIRECT, payme: true, paynet: true });
  for (const [m, names] of [
    ["app", ["Summa", "Tasdiqlash"]],
    ["card", ["Summa", "Karta", "Tasdiqlash"]],
    ["phone", ["Summa", "Telefon", "Tasdiqlash"]],
    ["paynet", ["Summa", "Paynet"]],
    ["payme", ["Summa", "To'lov"]],
  ] as const) {
    await openChooser();
    fireEvent.click(method(m)!);
    await settle();
    assert.equal(step(), "amount", m);
    assert.equal(q("[data-pay-chosen]")!.getAttribute("data-pay-chosen"), m, "the chosen method is shown");
    assert.equal(amountInput().value, "", `${m}: the amount starts empty`);
    assert.equal(usePayAmount.getState().amount, 0);
    assert.ok([...document.querySelectorAll("[data-pay-amount]")].every((b) => b.getAttribute("aria-pressed") === "false"), "no chip preselected");
    assert.ok(continueBtn().disabled, "«Davom etish» waits for an amount");
    assert.deepEqual(stepNames(), [...names]);
    assert.equal(currentStepName(), "Summa");
    assert.ok(q("[data-pay-back]"), "back arrow to the chooser");
    cleanup();
    await act(async () => useUi.getState().close());
  }
  assert.equal(reqs.length, 0, "choosing a method sends nothing");
});

test("openPay({ method }): starts at that method's «Summa» (no chooser, no back arrow); a disabled method falls back to the chooser", async () => {
  setup(DIRECT);
  await openAt("card");
  assert.equal(step(), "amount");
  assert.equal(q("[data-pay-chosen]")!.getAttribute("data-pay-chosen"), "card");
  assert.ok(!q("[data-pay-back]"), "the first step: only the close button");
  cleanup();
  await act(async () => useUi.getState().close());
  // MUTATION: `chosen` not checked against the enabled methods → a «Payme» amount step without Payme.
  await openAt("payme");
  assert.equal(step(), "choose");
});

// ------------------------------------------------------------------ amount

test("amount: grouped digits, «so'm» suffix, chips only fill the input, letters dropped, at most 9 digits", async () => {
  setup(DIRECT);
  await openAt("card");
  assert.equal(amountInput().getAttribute("inputmode"), "numeric");
  assert.equal(amountInput().getAttribute("placeholder"), "0");
  assert.match(q("[data-pay-step=\"amount\"]")!.textContent ?? "", /so'm/);
  assert.deepEqual([...document.querySelectorAll("[data-pay-amount]")].map((b) => Number(b.getAttribute("data-pay-amount"))), [10_000, 25_000, 50_000, 100_000]);
  for (const b of document.querySelectorAll("[data-pay-amount]")) assert.match(b.className, /min-h-11/, "44 px chips");
  type(amountInput(), "7500");
  await settle();
  assert.match(amountInput().value, /^7.500$/, "grouped digits");
  assert.equal(usePayAmount.getState().amount, 7_500);
  fireEvent.click(q('[data-pay-amount="50000"]')!);
  await settle();
  assert.equal(usePayAmount.getState().amount, 50_000, "a chip REPLACES the amount (fills, does not add)");
  assert.match(amountInput().value, /^50.000$/);
  assert.equal(q('[data-pay-amount="50000"]')!.getAttribute("aria-pressed"), "true");
  assert.equal(reqs.length, 0, "a chip sends nothing");
  type(amountInput(), "12a3,4");
  await settle();
  assert.equal(usePayAmount.getState().amount, 1_234);
  type(amountInput(), "123456789012");
  await settle();
  assert.equal(usePayAmount.getState().amount, 123_456_789);
});

test("invalid amount: inline message, «Davom etish» and the fallback disabled, nothing is sent; edges 1 000 and 10 000 000 are valid", async () => {
  setup(DIRECT);
  await openAt("card");
  for (const [value, message] of [
    ["999", /Eng kam summa — 1.000 so.m/],
    ["500", /Eng kam summa/],
    ["10000001", /Eng ko.p summa — 10.000.000 so.m/],
  ] as const) {
    type(amountInput(), value);
    await settle();
    assert.match(q("[data-pay-amount-error]")?.textContent ?? "", message, value);
    assert.equal(amountInput().getAttribute("aria-invalid"), "true");
    // MUTATION: `!err` dropped from the continue button's `ready` → enabled at an invalid amount.
    assert.ok(continueBtn().disabled, `continue disabled at ${value}`);
    assert.ok((q("[data-pay-fallback]") as HTMLButtonElement).disabled);
    fireEvent.click(continueBtn());
    fireEvent.submit(q('[data-pay-step="amount"]')!);
    await settle();
  }
  assert.equal(reqs.length, 0, "an invalid amount never reaches the server (button or Enter)");
  assert.equal(step(), "amount");
  // Cleared + blurred: asked for.
  type(amountInput(), "");
  fireEvent.blur(amountInput());
  await settle();
  assert.match(q("[data-pay-amount-error]")?.textContent ?? "", /Summani kiriting/);
  assert.ok(continueBtn().disabled);
  for (const value of ["1000", "10000000"]) {
    type(amountInput(), value);
    await settle();
    assert.ok(!q("[data-pay-amount-error]"), value);
    assert.equal(amountInput().getAttribute("aria-invalid"), "false");
    assert.ok(!continueBtn().disabled, `${value} is valid`);
  }
});

test("bonus preview: «+N so'm bonus · Balansga jami: X so'm» with the server's floor rounding; hidden without a percent", async () => {
  setup(DIRECT);
  usePayAmount.setState({ bonusPercent: 15 });
  await openAt("app");
  const preview = () => q("[data-pay-bonus-preview]");
  assert.match(preview()!.textContent ?? "", /Har bir to.ldirishga \+15% bonus/, "before an amount: the plain hint");
  type(amountInput(), "33333");
  await settle();
  // MUTATION: Math.round instead of the shared `paymentBonusPoints` (floor) → 5 000 / 38 333.
  assert.equal(preview()!.getAttribute("data-pay-bonus-preview"), "4999");
  assert.equal(preview()!.textContent, `+${groupDigits(4_999)} so'm bonus · Balansga jami: ${groupDigits(38_332)} so'm`);
  type(amountInput(), "999");
  await settle();
  assert.equal(preview()!.getAttribute("data-pay-bonus-preview"), "", "no bonus for an invalid amount");
  cleanup();
  await act(async () => useUi.getState().close());
  for (const p of [0, null]) {
    usePayAmount.setState({ bonusPercent: p });
    await openAt("app");
    type(amountInput(), "50000");
    await settle();
    // MUTATION: the `bonusPercent > 0` gate dropped → a «+0% bonus» row.
    assert.ok(!preview(), `no preview at ${String(p)}`);
    cleanup();
    await act(async () => useUi.getState().close());
  }
});

test("openPay({ amount }): a context opener pre-fills ANY amount as a suggestion; junk is ignored (empty); reopening starts empty", async () => {
  // MUTATION: the old preset-only rule (`isTopupPreset`) → 37 700 is dropped.
  setup(DIRECT);
  await openAt("app", 37_700);
  assert.match(amountInput().value, /^37.700$/);
  assert.ok(!continueBtn().disabled);
  await act(async () => useUi.getState().close());
  await settle();
  assert.equal(usePayAmount.getState().amount, 0, "closing forgets the amount");
  await act(async () => useUi.getState().open("pay"));
  await settle();
  assert.equal(step(), "choose", "a plain open after a method open: the chooser");
  fireEvent.click(method("app")!);
  await settle();
  assert.equal(amountInput().value, "", "and an empty amount");
  cleanup();
  for (const junk of [-5, 2.5, Number.NaN]) {
    await act(async () => useUi.getState().close());
    await openAt("app", junk);
    assert.equal(amountInput().value, "", `ignored: ${junk}`);
    cleanup();
  }
});

// ------------------------------------------------------------------ steps, back, focus

test("back arrow: step → previous step (focus back on the chosen row), the amount is kept; Orqaga inside a step does the same", async () => {
  setup(DIRECT);
  await openChooser();
  fireEvent.click(method("card")!);
  await settle();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(document.activeElement, amountInput(), "the amount input is focused");
  type(amountInput(), "30000");
  await goOn();
  assert.equal(step(), "card");
  assert.equal(currentStepName(), "Karta");
  fireEvent.click(q("[data-pay-back]")!);
  await settle();
  assert.equal(step(), "amount");
  assert.match(amountInput().value, /^30.000$/, "the typed amount stays");
  fireEvent.click(q("[data-pay-back]")!);
  await settle();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  assert.equal(step(), "choose");
  // MUTATION: the return-focus branch dropped → focus lands on the first row («Click ilovasi»).
  assert.equal(document.activeElement, method("card"), "focus returns to the row the user chose");
  // «Orqaga» inside the card form = one step back.
  fireEvent.click(method("card")!);
  await settle();
  await goOn();
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  await settle();
  assert.equal(step(), "amount");
});

test("phone Back: one step back per press, then the sheet closes", async () => {
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/wallet");
  nav.installNav();
  setup(DIRECT);
  await openChooser();
  const backPress = async () => {
    await act(async () => {
      window.history.back();
      for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 3));
    });
  };
  fireEvent.click(method("card")!);
  await settleReal();
  type(amountInput(), "20000");
  fireEvent.click(continueBtn());
  await settleReal();
  assert.equal(step(), "card");
  // MUTATION: the per-step `useOverlayHistory` removed → the first Back closes the whole sheet.
  await backPress();
  assert.equal(step(), "amount", "Back: card → amount");
  assert.equal(useUi.getState().overlay, "pay");
  await backPress();
  assert.equal(step(), "choose", "Back: amount → chooser");
  await backPress();
  assert.equal(useUi.getState().overlay, null, "Back on the first step closes the sheet");
  assert.equal(window.location.pathname, "/uz/wallet", "the page stays");
});

// ------------------------------------------------------------------ provider pages

test("plain «Click» (no Merchant API) posts the page order with the typed amount and leaves with the replace exit", async () => {
  setup({ click: true, payme: false });
  await openAt("click");
  type(amountInput(), "12000");
  fireEvent.click(continueBtn());
  await settleReal();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 12_000, purpose: "topup", method: "page" }]);
  assert.deepEqual(exits, [[CHECKOUT, true]]);
});

test("Payme: the typed amount, then the Payme page (replace exit)", async () => {
  setup({ click: false, payme: true });
  await openAt("payme");
  type(amountInput(), "64000");
  fireEvent.click(continueBtn());
  await settleReal();
  assert.deepEqual(orderPosts(), [{ provider: "payme", amount: 64_000, purpose: "topup" }]);
  assert.deepEqual(exits, [[CHECKOUT, true]]);
});

test("fallback «Click sahifasi orqali to'lash» under the Click methods keeps the old redirect flow (method: page)", async () => {
  setup(DIRECT);
  await openAt("app");
  assert.equal(q("[data-pay-fallback]")!.textContent, "Click sahifasi orqali to'lash");
  type(amountInput(), "40000");
  fireEvent.click(q("[data-pay-fallback]")!);
  await settleReal();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 40_000, purpose: "topup", method: "page" }]);
  assert.deepEqual(exits, [[CHECKOUT, true]]);
});

test("signed out: «Davom etish» of every method opens the login (returning to the wallet), no order", async () => {
  setup({ ...DIRECT, payme: true }, { loggedIn: false });
  for (const m of ["card", "phone", "app", "payme"]) {
    await openAt(m, 20_000);
    fireEvent.click(continueBtn());
    await settle();
    assert.equal(useUi.getState().overlay, "login", m);
    assert.equal(useUi.getState().returnTo, "/uz/wallet");
    cleanup();
  }
  assert.equal(reqs.length, 0);
});

test("API error on creating the order shows the message on the amount step and re-enables «Davom etish»", async () => {
  setup(DIRECT);
  hook = (r) => (r.url === "/api/payments/orders" ? json(503, { error: "Click hali ulanmagan" }) : undefined);
  await openAt("card", 25_000);
  await goOn();
  assert.match(alertText(), /Click hali ulanmagan/);
  assert.equal(step(), "amount");
  assert.ok(!continueBtn().disabled);
});

// ------------------------------------------------------------------ Karta

async function toCardForm(amount?: string) {
  if (amount !== undefined) type(amountInput(), amount);
  await goOn();
}

test("Karta: the typed amount in the order; inline validation (number, expiry) blocks the request; valid input asks Click for the SMS", async () => {
  setup(DIRECT);
  await openAt("card");
  await toCardForm("7500");
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 7_500, purpose: "topup", method: "card" }]);
  assert.ok(q('[data-pay-step="card"]'), "the card form follows the amount");
  assert.equal(currentStepName(), "Karta");
  const number = q("[data-pay-card-number]") as HTMLInputElement;
  const expiry = q("[data-pay-card-expiry]") as HTMLInputElement;
  assert.equal(number.getAttribute("autocomplete"), "cc-number");
  assert.equal(expiry.getAttribute("autocomplete"), "cc-exp");
  assert.ok(screen.getByLabelText("Karta raqami") === number && screen.getByLabelText("Amal qilish muddati") === expiry, "labelled inputs");

  // Empty -> both messages, no request.
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  assert.match(alertText(), /Karta raqamini kiriting/);
  assert.match(alertText(), /Amal qilish muddatini kiriting/);
  // Typing formats: groups of 4 and MM/YY.
  type(number, "62621234567890129999123");
  await settle();
  assert.equal(number.value, "6262 1234 5678 9012 999", "groups of 4, capped at 19 digits");
  type(number, "8600123456789012");
  type(expiry, "1299");
  await settle();
  assert.equal(number.value, "8600 1234 5678 9012");
  assert.equal(expiry.value, "12/99");
  // Too short, expired date.
  type(number, "4111 1111");
  type(expiry, "0120");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  assert.match(alertText(), /16 ta raqam/);
  assert.match(alertText(), /tugagan/);
  assert.ok(!reqs.some((r) => r.url === "/api/payments/click/card"), "nothing sent while invalid");

  type(number, "8600123456789012");
  type(expiry, "12/99");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  const start = reqs.find((r) => r.url === "/api/payments/click/card")!;
  assert.deepEqual(start.body, { orderId: "o9", cardNumber: "8600 1234 5678 9012", expireDate: "1299" });
  assert.ok(q('[data-pay-step="card-sms"]'), "SMS step");
  assert.match(document.body.textContent ?? "", /\+998\*{7}67/, "masked phone from Click");
  assert.match(document.body.textContent ?? "", /7.500 so.m/);
  const sms = q("[data-pay-sms]") as HTMLInputElement;
  assert.equal(sms.getAttribute("autocomplete"), "one-time-code");
});

test("Karta: SMS code -> waiting -> success; the balance refreshes; the card values are dropped", async (t) => {
  setup(DIRECT, { t });
  await openAt("card", 25_000);
  await toCardForm();
  type(q("[data-pay-card-number]")!, "9860 1234 5678 9012");
  type(q("[data-pay-card-expiry]")!, "1299");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  // A bad code: a server message, still on the SMS step.
  hook = (r) => (r.url === "/api/payments/click/card/verify" ? json(422, { error: "SMS kod noto'g'ri yoki eskirgan. Kodni tekshirib qayta kiriting", code: "click_declined" }) : undefined);
  const sms = q("[data-pay-sms]")!;
  type(sms, "12");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  assert.match(alertText(), /SMS kod 4-8/, "client-side check first");
  type(sms, "000000");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  assert.match(alertText(), /SMS kod noto'g'ri/);
  assert.ok(q('[data-pay-step="card-sms"]'));
  // The right code: Click charges the card, the order is still pending -> waiting view.
  hook = null;
  type(sms, "482915");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  const confirm = reqs.filter((r) => r.url === "/api/payments/click/card/verify").at(-1)!;
  assert.deepEqual(confirm.body, { orderId: "o9", smsCode: "482915" });
  assert.ok(q('[data-pay-step="wait"] [data-pay-result="polling"]'), "waiting for the Shop API Complete");
  assert.equal(currentStepName(), "Tasdiqlash", "the last step of the indicator");
  assert.match(document.body.textContent ?? "", /To.lov tekshirilmoqda/);
  assert.ok(!q("[data-pay-card-number]") && !q("[data-pay-sms]"), "the card form is gone");
  assert.ok(!(document.body.innerHTML.includes("9860") || document.body.innerHTML.includes("5678 9012")), "card values are dropped");

  await advance(t, 3_000);
  assert.ok(q('[data-pay-result="polling"]'), "still pending");
  orderState = "paid";
  await advance(t, 6_000);
  assert.ok(q('[data-pay-result="paid"]'), "paid");
  assert.match(document.body.textContent ?? "", /To.lov qabul qilindi/);
  assert.match(document.body.textContent ?? "", /25.000 so.m balansingizga/);
  assert.ok(refreshes >= 1, "the balance shown everywhere refreshes");
  fireEvent.click(q("[data-pay-done]")!);
  await settle();
  assert.equal(useUi.getState().overlay, null, "«Yopish» closes the dialog");
});

test("Karta: «Kodni qayta yuborish» unlocks after 60 s, asks Click again for the SAME card, restarts the countdown; a server cap shows its message", async (t) => {
  setup(DIRECT, { t });
  await openAt("card", 25_000);
  await toCardForm();
  type(q("[data-pay-card-number]")!, "6262 1234 5678 9012");
  type(q("[data-pay-card-expiry]")!, "1299");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  const cardPosts = () => reqs.filter((r) => r.url === "/api/payments/click/card");
  assert.equal(cardPosts().length, 1);
  const resend = () => q("[data-pay-resend]") as HTMLButtonElement;
  // MUTATION: no countdown — the button is usable at once.
  assert.ok(resend().disabled, "locked right after the first code");
  assert.match(resend().textContent ?? "", /\(60 s\)/);
  fireEvent.click(resend());
  await settle();
  assert.equal(cardPosts().length, 1, "nothing sent while locked");
  await advance(t, 60_000);
  assert.ok(!resend().disabled, "unlocked after 60 s");
  assert.equal(resend().textContent, "Kodni qayta yuborish");
  fireEvent.click(resend());
  await settle();
  await settle();
  assert.equal(cardPosts().length, 2);
  // MUTATION: resending without the card (or another card) — Click needs the same number + expiry.
  assert.deepEqual(cardPosts()[1]!.body, cardPosts()[0]!.body, "the same card and order");
  assert.match(q("[data-pay-notice]")?.textContent ?? "", /Yangi kod yuborildi/);
  assert.ok(resend().disabled, "the countdown restarts");
  assert.ok(q('[data-pay-step="card-sms"]'), "still on the SMS step");
  // The per-order cap on the server: its message is shown, the step stays.
  hook = (r) => (r.url === "/api/payments/click/card" ? json(429, { error: "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring" }) : undefined);
  await advance(t, 60_000);
  fireEvent.click(resend());
  await settle();
  await settle();
  assert.match(alertText(), /Juda ko'p urinish/);
  assert.ok(q('[data-pay-step="card-sms"]'));
});

test("Karta: the card route already saw the order paid -> success at once, no polling", async (t) => {
  setup(DIRECT, { t });
  hook = (r) => (r.url === "/api/payments/click/card/verify" ? json(200, { status: "paid" }) : undefined);
  await openAt("card", 25_000);
  await toCardForm();
  type(q("[data-pay-card-number]")!, "8600123456789012");
  type(q("[data-pay-card-expiry]")!, "1299");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  type(q("[data-pay-sms]")!, "482915");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  assert.ok(q('[data-pay-result="paid"]'));
  assert.ok(refreshes >= 1);
  const before = reqs.filter((r) => r.url === "/api/payments/orders" && r.method === "GET").length;
  await advance(t, 20_000);
  assert.equal(reqs.filter((r) => r.url === "/api/payments/orders" && r.method === "GET").length, before, "no polling after success");
});

test("Karta: a spent token (409 no_token) sends the user back to the card form with the server message", async () => {
  setup(DIRECT);
  await openAt("card", 25_000);
  await toCardForm();
  type(q("[data-pay-card-number]")!, "8600123456789012");
  type(q("[data-pay-card-expiry]")!, "1299");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  hook = (r) => (r.url === "/api/payments/click/card/verify" ? json(409, { error: "SMS so'ralmagan yoki muddati o'tgan. Karta ma'lumotlarini qayta kiriting", code: "no_token" }) : undefined);
  type(q("[data-pay-sms]")!, "482915");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  assert.ok(q('[data-pay-step="card"]'), "back to the card form");
  assert.match(alertText(), /SMS so.ralmagan yoki muddati o.tgan/);
});

test("Karta: Click declines the card (422) -> the message is shown on the form, the button re-enables", async () => {
  setup(DIRECT);
  hook = (r) => (r.url === "/api/payments/click/card" ? json(422, { error: "Karta topilmadi yoki bloklangan. Boshqa karta yoki usulni tanlang", code: "click_declined" }) : undefined);
  await openAt("card", 25_000);
  await toCardForm();
  type(q("[data-pay-card-number]")!, "8600123456789012");
  type(q("[data-pay-card-expiry]")!, "1299");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  assert.match(alertText(), /Karta topilmadi/);
  assert.ok(q('[data-pay-step="card"]'));
  assert.ok(!(q("[data-pay-submit]") as HTMLButtonElement).disabled);
});

test("one order per amount+method: back and «Davom etish» again reuse it; another amount or method creates a new one", async () => {
  // MUTATION: order reuse removed → 2 posts after the first round trip.
  setup(DIRECT);
  await openChooser();
  fireEvent.click(method("card")!);
  await settle();
  await toCardForm("25000");
  fireEvent.click(q("[data-pay-back]")!);
  await settle();
  await toCardForm();
  assert.equal(orderPosts().length, 1, "the same order is reused");
  fireEvent.click(q("[data-pay-back]")!);
  await settle();
  await toCardForm("30000");
  assert.equal(orderPosts().length, 2, "a new amount is a new order");
  assert.equal(orderPosts()[1]!.amount, 30_000);
  fireEvent.click(q("[data-pay-back]")!);
  await settle();
  fireEvent.click(q("[data-pay-back]")!);
  await settle();
  fireEvent.click(method("phone")!);
  await settle();
  await goOn();
  assert.equal(orderPosts().length, 3, "another method is a new order");
  assert.deepEqual(orderPosts()[2], { provider: "click", amount: 30_000, purpose: "topup", method: "phone" });
});

test("reopening the dialog starts at the chooser again (no leftover step, amount or card values)", async () => {
  setup(DIRECT);
  await openChooser();
  fireEvent.click(method("card")!);
  await settle();
  await toCardForm("25000");
  type(q("[data-pay-card-number]")!, "8600123456789012");
  await act(async () => {
    useUi.getState().close();
  });
  await act(async () => {
    useUi.getState().open("pay");
  });
  await settle();
  assert.equal(step(), "choose");
  assert.ok(!q("[data-pay-card-number]"));
  fireEvent.click(method("card")!);
  await settle();
  assert.equal(amountInput().value, "", "the amount is not remembered");
  await toCardForm("25000");
  assert.equal((q("[data-pay-card-number]") as HTMLInputElement).value, "", "the card number is not remembered");
});

// ------------------------------------------------------------------ Telefon raqam

test("Telefon raqam: the typed amount; +998 + 9 digits (validated), invoice sent, waiting for the app, then success", async (t) => {
  setup(DIRECT, { t });
  await openAt("phone");
  type(amountInput(), "18000");
  await goOn();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 18_000, purpose: "topup", method: "phone" }]);
  assert.equal(currentStepName(), "Telefon");
  const phone = q("[data-pay-phone]") as HTMLInputElement;
  assert.ok(screen.getByLabelText("Telefon raqam") === phone);
  assert.equal(phone.getAttribute("autocomplete"), "tel-national");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  assert.match(alertText(), /Telefon raqamini kiriting/);
  type(phone, "90 123");
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  assert.match(alertText(), /9 ta raqam/);
  assert.ok(!reqs.some((r) => r.url === "/api/payments/click/invoice"));

  type(phone, "901234567");
  await settle();
  assert.equal(phone.value, "90 123 45 67");
  hook = (r) => (r.url === "/api/payments/click/invoice" ? json(422, { error: "Bu telefon raqami Click'da topilmadi. Raqamni tekshiring", code: "click_declined" }) : undefined);
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  assert.match(alertText(), /Click'da topilmadi/);
  assert.ok(q('[data-pay-step="phone"]'), "stays on the form for a retry");

  hook = null;
  fireEvent.click(q("[data-pay-submit]")!);
  await settle();
  await settle();
  const inv = reqs.filter((r) => r.url === "/api/payments/click/invoice").at(-1)!;
  assert.deepEqual(inv.body, { orderId: "o9", phone: "998901234567" });
  assert.ok(q('[data-pay-step="wait"] [data-pay-result="polling"]'));
  assert.match(document.body.textContent ?? "", /Hisob Click ilovasiga yuborildi/);
  assert.match(document.body.textContent ?? "", /Click ilovasini oching/);

  orderState = "paid";
  await advance(t, 4_000);
  assert.ok(q('[data-pay-result="paid"]'), "the user confirmed in the app -> Complete -> paid");
  assert.ok(refreshes >= 1);
});

// ------------------------------------------------------------------ Click ilovasi

test("Click ilovasi in a browser: order (method: app) with the typed amount, the deeplink opened by navigation, the dialog waits and can reopen the link", async (t) => {
  setup(DIRECT, { t });
  await openAt("app");
  type(amountInput(), "15000");
  await goOn();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 15_000, purpose: "topup", method: "app" }]);
  assert.deepEqual(browserOpens, [CHECKOUT]);
  assert.deepEqual(exits, [], "not the overlay exit: the dialog stays to watch the order");
  assert.ok(q('[data-pay-step="wait"] [data-pay-result="polling"]'));
  assert.equal(currentStepName(), "Tasdiqlash");
  assert.match(document.body.textContent ?? "", /Click ilovasida tasdiqlang/);
  fireEvent.click(q("[data-pay-reopen]")!);
  assert.deepEqual(browserOpens, [CHECKOUT, CHECKOUT]);
  orderState = "paid";
  await advance(t, 4_000);
  assert.ok(q('[data-pay-result="paid"]'));
});

test("Telegram: Click ilovasi opens the deeplink EXTERNALLY (WebApp.openLink), never by navigating the webview", async (t) => {
  setup(DIRECT, { t });
  fakeTelegram();
  await openAt("app", 25_000);
  await goOn();
  assert.deepEqual(tgOpens, [CHECKOUT]);
  assert.deepEqual(browserOpens, [], "the webview is not navigated");
  assert.deepEqual(exits, []);
  assert.ok(q('[data-pay-result="polling"]'));
});

test("waiting: after 5 minutes without payment — «tasdiqlanmadi» + «Tekshirish» that checks at once", async (t) => {
  setup(DIRECT, { t });
  await openAt("app", 25_000);
  await goOn();
  await advance(t, WAIT_POLL_BUDGET_MS + 15_000);
  assert.ok(q('[data-pay-result="stalled"]'));
  assert.match(document.body.textContent ?? "", /To.lov hali tasdiqlanmadi/);
  const n = reqs.filter((r) => r.url === "/api/payments/orders" && r.method === "GET").length;
  assert.ok(n >= 10 && n <= 40, `bounded polling: ${n}`);
  await advance(t, 60_000);
  assert.equal(reqs.filter((r) => r.url === "/api/payments/orders" && r.method === "GET").length, n, "silent once stopped");
  orderState = "paid";
  fireEvent.click(q("[data-pay-recheck]")!);
  await advance(t, 1_000);
  assert.ok(q('[data-pay-result="paid"]'));
});

test("waiting: a cancelled order says so and offers «Orqaga» back to the amount step (polling stops)", async (t) => {
  setup(DIRECT, { t });
  orderState = "cancelled";
  await openAt("app", 25_000);
  await goOn();
  await advance(t, 3_000);
  assert.ok(q('[data-pay-result="cancelled"]'));
  assert.match(document.body.textContent ?? "", /To.lov bekor qilindi/);
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  await settle();
  assert.equal(step(), "amount", "back to the amount");
  assert.match(amountInput().value, /^25.000$/);
});
