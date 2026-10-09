import "./setup.ts";
import test, { afterEach, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

/**
 * PayDialog (wallet): free amount + the three DIRECT Click methods (owner decision 2026-10-09).
 *
 *  - amount: presets + a free input (grouped digits, inline validation 1 000 - 10 000 000); the
 *    methods stay disabled and the total reads «—» while the amount is invalid;
 *  - «Karta»: card number + MM/YY (inline validation, nothing sent while invalid) -> SMS code with
 *    the masked phone -> waiting (order polling) -> success; the card values are gone afterwards;
 *  - «Telefon raqam»: +998 fixed, 9 digits -> invoice -> waiting -> success;
 *  - «Click ilovasi»: the deeplink opens EXTERNALLY in the Telegram Mini App (`openLink`), by plain
 *    navigation elsewhere, then the dialog waits for the order;
 *  - «Click sahifasi orqali to'lash» (fallback link) keeps the old redirect flow;
 *  - without the Merchant API (`clickDirect` off) only the plain «Click» button is drawn.
 *
 * Mutations (each verified red): amount validation disabled ("invalid amount"); deeplink opened
 * with plain navigation inside Telegram ("Telegram: openLink"); card number kept after success
 * ("card values are dropped"); order reuse removed ("one order per amount+method").
 */

const nav = await import("../../lib/nav/history.ts");
const { groupDigits } = await import("../../lib/format.ts");
const { PayDialog } = await import("../../components/overlays/PayDialog.tsx");
const { DEFAULT_TOPUP, usePayAmount } = await import("../../components/overlays/pay-amount.ts");
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

function setup(
  payments: { click: boolean; payme: boolean; clickDirect?: boolean },
  opts: { loggedIn?: boolean; t?: TestContext } = {},
) {
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
  usePayAmount.setState({ amount: DEFAULT_TOPUP });
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
async function openDialog() {
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(PathnameContext.Provider, { value: "/uz/wallet" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, h(PayDialog))),
    ),
  );
  await act(async () => {
    useUi.getState().open("pay");
  });
  await settle();
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const method = (id: string) => q(`[data-pay-method="${id}"]`) as HTMLButtonElement | null;
const amountInput = () => q("[data-pay-input]") as HTMLInputElement;
const total = () => q("[data-pay-total]")?.textContent ?? "";
const type = (el: Element, value: string) => fireEvent.change(el, { target: { value } });
const orderPosts = () => reqs.filter((r) => r.method === "POST" && r.url === "/api/payments/orders").map((r) => r.body);
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent).join(" | ");

const DIRECT = { click: true, payme: false, clickDirect: true };

// ------------------------------------------------------------------ amount

test("amount: presets stay, a free amount is typed with grouped digits and replaces the preset", async () => {
  setup(DIRECT);
  await openDialog();
  assert.equal(document.querySelectorAll("[data-pay-amount]").length, 4);
  assert.equal(amountInput().value, groupDigits(25_000), "the default preset fills the input");
  assert.equal(q('[data-pay-amount="25000"]')!.getAttribute("aria-pressed"), "true");
  type(amountInput(), "7500");
  await settle();
  assert.match(amountInput().value, /^7.500$/, "grouped digits");
  assert.equal(usePayAmount.getState().amount, 7_500);
  assert.ok([...document.querySelectorAll("[data-pay-amount]")].every((b) => b.getAttribute("aria-pressed") === "false"), "no preset is marked");
  assert.match(total(), /7.500 so.m/);
  // Typing a preset's value marks that preset; clicking a preset overwrites the typed amount.
  type(amountInput(), "50000");
  await settle();
  assert.equal(q('[data-pay-amount="50000"]')!.getAttribute("aria-pressed"), "true");
  fireEvent.click(q('[data-pay-amount="10000"]')!);
  await settle();
  assert.equal(usePayAmount.getState().amount, 10_000);
  assert.match(amountInput().value, /^10.000$/);
  // Letters and symbols are dropped; the field takes at most 9 digits.
  type(amountInput(), "12a3,4");
  await settle();
  assert.equal(usePayAmount.getState().amount, 1_234);
  type(amountInput(), "123456789012");
  await settle();
  assert.equal(usePayAmount.getState().amount, 123_456_789);
});

test("invalid amount: inline message, methods disabled, total «—», nothing is sent; edges 1 000 and 10 000 000 are valid", async () => {
  setup(DIRECT);
  await openDialog();
  for (const [value, message] of [
    ["999", /Eng kam summa — 1.000 so.m/],
    ["500", /Eng kam summa/],
    ["10000001", /Eng ko.p summa — 10.000.000 so.m/],
  ] as const) {
    type(amountInput(), value);
    await settle();
    assert.match(q("[data-pay-amount-error]")?.textContent ?? "", message, value);
    assert.equal(amountInput().getAttribute("aria-invalid"), "true");
    for (const m of ["card", "phone", "app"]) assert.ok(method(m)!.disabled, `${m} disabled at ${value}`);
    assert.ok((q("[data-pay-fallback]") as HTMLButtonElement).disabled);
    assert.match(total(), /—/);
    fireEvent.click(method("card")!);
    await settle();
  }
  assert.equal(reqs.length, 0, "an invalid amount never reaches the server");
  // Cleared + blurred: asked for.
  type(amountInput(), "");
  fireEvent.blur(amountInput());
  await settle();
  assert.match(q("[data-pay-amount-error]")?.textContent ?? "", /Summani kiriting/);
  for (const value of ["1000", "10000000"]) {
    type(amountInput(), value);
    await settle();
    assert.equal(q("[data-pay-amount-error]"), null, value);
    assert.equal(amountInput().getAttribute("aria-invalid"), "false");
    assert.ok(!method("card")!.disabled, `${value} is valid`);
  }
});

// ------------------------------------------------------------------ what is drawn

test("Merchant API on: Karta, Telefon raqam, Click ilovasi (≥ 56 px rows) + the small Click-page fallback; Payme as a row", async () => {
  setup({ ...DIRECT, payme: true });
  await openDialog();
  assert.deepEqual(
    [...document.querySelectorAll("[data-pay-methods] [data-pay-method]")].map((b) => b.getAttribute("data-pay-method")),
    ["card", "phone", "app", "payme"],
  );
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-pay-methods] button")) {
    assert.ok(b.className.includes("min-h-14"), "≥ 56 px");
    assert.ok(!b.disabled);
  }
  assert.match(method("card")!.textContent ?? "", /^Karta/);
  assert.match(method("phone")!.textContent ?? "", /^Telefon raqam/);
  assert.match(method("app")!.textContent ?? "", /^Click ilovasi/);
  const fallback = q("[data-pay-fallback]")!;
  assert.equal(fallback.textContent, "Click sahifasi orqali to'lash");
  assert.ok(!document.body.textContent?.includes("Karta orqali"), "the Uzcard / Humo split is gone");
  assert.ok(!document.body.textContent?.includes("Uzcard"), "no card-system restriction in the copy");
});

test("Merchant API off: only the plain «Click» button (and Payme); unconfigured providers are not drawn", async () => {
  setup({ click: true, payme: true });
  await openDialog();
  assert.deepEqual([...document.querySelectorAll("[data-pay-methods] button")].map((b) => b.textContent), ["Click", "Payme"]);
  assert.ok(!q("[data-pay-fallback]") && !method("card"));
  cleanup();
  setup({ click: false, payme: true });
  await openDialog();
  assert.deepEqual([...document.querySelectorAll("[data-pay-methods] button")].map((b) => b.textContent), ["Payme"]);
  cleanup();
  setup({ click: false, payme: false });
  await openDialog();
  assert.deepEqual([...document.querySelectorAll("[data-pay-methods] button")], []);
  assert.match(document.body.textContent ?? "", /To.lov provayderi hali ulanmagan/);
});

test("plain «Click» posts the page order (method: page) and leaves with the replace exit", async () => {
  setup({ click: true, payme: false });
  await openDialog();
  fireEvent.click(method("click")!);
  await settleReal();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 25_000, purpose: "topup", method: "page" }]);
  assert.deepEqual(exits, [[CHECKOUT, true]]);
});

test("fallback link «Click sahifasi orqali to'lash» keeps the old redirect flow (method: page)", async () => {
  setup(DIRECT);
  await openDialog();
  type(amountInput(), "40000");
  fireEvent.click(q("[data-pay-fallback]")!);
  await settleReal();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 40_000, purpose: "topup", method: "page" }]);
  assert.deepEqual(exits, [[CHECKOUT, true]]);
});

test("signed out: every method opens the login (returning to the wallet), no order", async () => {
  setup(DIRECT, { loggedIn: false });
  await openDialog();
  for (const m of ["card", "phone", "app"]) {
    useUi.setState({ overlay: "pay", returnTo: null });
    await settle();
    fireEvent.click(method(m)!);
    await settle();
    assert.equal(useUi.getState().overlay, "login", m);
    assert.equal(useUi.getState().returnTo, "/uz/wallet");
  }
  assert.equal(reqs.length, 0);
});

test("API error on creating the order shows the message and re-enables the methods", async () => {
  setup(DIRECT);
  hook = (r) => (r.url === "/api/payments/orders" ? json(503, { error: "Click hali ulanmagan" }) : undefined);
  await openDialog();
  fireEvent.click(method("card")!);
  await settle();
  await settle();
  assert.match(alertText(), /Click hali ulanmagan/);
  assert.ok(!method("card")!.disabled && !method("app")!.disabled);
});

// ------------------------------------------------------------------ Karta

async function toCardForm() {
  fireEvent.click(method("card")!);
  await settle();
  await settle();
}

test("Karta: inline validation (number, expiry) blocks the request; valid input asks Click for the SMS", async () => {
  setup(DIRECT);
  await openDialog();
  type(amountInput(), "7500");
  await toCardForm();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 7_500, purpose: "topup", method: "card" }]);
  assert.ok(q('[data-pay-step="card"]'), "the card form replaces the methods");
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
  type(number, "86001234567890129999");
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
  await openDialog();
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
  assert.ok(q('[data-pay-result="polling"]'), "waiting for the Shop API Complete");
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

test("Karta: the card route already saw the order paid -> success at once, no polling", async (t) => {
  setup(DIRECT, { t });
  hook = (r) => (r.url === "/api/payments/click/card/verify" ? json(200, { status: "paid" }) : undefined);
  await openDialog();
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
  await openDialog();
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
  await openDialog();
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

test("one order per amount+method: Orqaga and the same method again reuse it; another amount creates a new one", async () => {
  setup(DIRECT);
  await openDialog();
  await toCardForm();
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  await settle();
  assert.ok(method("card"), "home again");
  await toCardForm();
  assert.equal(orderPosts().length, 1, "the same order is reused");
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  await settle();
  type(amountInput(), "30000");
  await toCardForm();
  assert.equal(orderPosts().length, 2, "a new amount is a new order");
  assert.equal(orderPosts()[1]!.amount, 30_000);
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  await settle();
  fireEvent.click(method("phone")!);
  await settle();
  await settle();
  assert.equal(orderPosts().length, 3, "another method is a new order");
});

test("reopening the dialog starts at the methods again (no leftover step or card values)", async () => {
  setup(DIRECT);
  await openDialog();
  await toCardForm();
  type(q("[data-pay-card-number]")!, "8600123456789012");
  await act(async () => {
    useUi.getState().close();
  });
  await act(async () => {
    useUi.getState().open("pay");
  });
  await settle();
  assert.ok(method("card") && !q("[data-pay-card-number]"));
  await toCardForm();
  assert.equal((q("[data-pay-card-number]") as HTMLInputElement).value, "", "the card number is not remembered");
});

// ------------------------------------------------------------------ Telefon raqam

test("Telefon raqam: +998 + 9 digits (validated), invoice sent, waiting for the app, then success", async (t) => {
  setup(DIRECT, { t });
  await openDialog();
  fireEvent.click(method("phone")!);
  await settle();
  await settle();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 25_000, purpose: "topup", method: "phone" }]);
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
  assert.ok(q('[data-pay-result="polling"]'));
  assert.match(document.body.textContent ?? "", /Hisob Click ilovasiga yuborildi/);
  assert.match(document.body.textContent ?? "", /Click ilovasini oching/);

  orderState = "paid";
  await advance(t, 4_000);
  assert.ok(q('[data-pay-result="paid"]'), "the user confirmed in the app -> Complete -> paid");
  assert.ok(refreshes >= 1);
});

// ------------------------------------------------------------------ Click ilovasi

test("Click ilovasi in a browser: order (method: app), the deeplink opened by navigation, the dialog waits and can reopen the link", async (t) => {
  setup(DIRECT, { t });
  await openDialog();
  type(amountInput(), "15000");
  fireEvent.click(method("app")!);
  await settle();
  await settle();
  assert.deepEqual(orderPosts(), [{ provider: "click", amount: 15_000, purpose: "topup", method: "app" }]);
  assert.deepEqual(browserOpens, [CHECKOUT]);
  assert.deepEqual(exits, [], "not the overlay exit: the dialog stays to watch the order");
  assert.ok(q('[data-pay-result="polling"]'));
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
  await openDialog();
  fireEvent.click(method("app")!);
  await settle();
  await settle();
  assert.deepEqual(tgOpens, [CHECKOUT]);
  assert.deepEqual(browserOpens, [], "the webview is not navigated");
  assert.deepEqual(exits, []);
  assert.ok(q('[data-pay-result="polling"]'));
});

test("waiting: after 5 minutes without payment — «tasdiqlanmadi» + «Tekshirish» that checks at once", async (t) => {
  setup(DIRECT, { t });
  await openDialog();
  fireEvent.click(method("app")!);
  await settle();
  await settle();
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

test("waiting: a cancelled order says so and offers «Orqaga» (polling stops)", async (t) => {
  setup(DIRECT, { t });
  orderState = "cancelled";
  await openDialog();
  fireEvent.click(method("app")!);
  await settle();
  await settle();
  await advance(t, 3_000);
  assert.ok(q('[data-pay-result="cancelled"]'));
  assert.match(document.body.textContent ?? "", /To.lov bekor qilindi/);
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  await settle();
  assert.ok(method("card"), "back to the methods");
});
