import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WalletPage } from "../../components/wallet/WalletPage.tsx";
import { describeEntry, formatWhen, ledgerRow, providerLabel } from "../../components/wallet/wallet-model.ts";
import { paymentBonusNote } from "../../lib/payment-bonus.ts";

/** A legacy Bonus 2 first top-up row (history; new payments write `paymentBonusNote`). */
const FIRST_TOPUP_NOTE = "Birinchi to‘ldirish bonusi (10%)";
import { PayDialog } from "../../components/overlays/PayDialog.tsx";
import { useAppStore } from "../../lib/store.ts";
import { useUi } from "../../lib/ui.ts";
import { groupDigits } from "../../lib/format.ts";
import { MAX_TOPUP_SOUM, MIN_TOPUP_SOUM } from "../../lib/topup-limits.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * Redesign W3 «Hamyon» (docs/redesign/PLAN.md): balance hero, signed-out and
 * loading states, «To'ldirish» → the existing PayDialog, `?order=` banners,
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
  assert.ok(screen.getByRole("button", { name: `${groupDigits(50_000)} so'm` })); // redesign W5: was «50k»
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
    assert.ok(document.querySelector("[data-wallet-payment-bonus]")!.closest("[data-wallet-packs]"), "inside «Tez to'ldirish»");
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
  assert.ok(document.querySelector("[data-wallet-packs]"));
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

/* ───────────────────────────── Paynet in the top-up dialog (docs/payments/PAYNET.md «UI») ───────────────────────────── */

/**
 * Owner 2026-10-31: the user picks the amount, then Click OR Paynet in the same dialog; the separate wallet card is gone.
 *
 * Mutations (each turned the named test red, then restored):
 *   `paynetOn` gate dropped in PayDialog → "offered only while the server has Paynet configured";
 *   `amountErr` gate re-added to the Paynet row / `openPaynet` → "any amount: the row opens even with an invalid dialog amount";
 *   `needLogin()` dropped from `openPaynet` → "signed out → login";
 *   PaynetStep shows a constant id / the dialog amount again / «X so'm to'lang» step → "shows «Sizning ID raqamingiz» ...";
 *   the «Sizning ID raqamingiz» label / the wrong-ID warning removed → "shows «Sizning ID raqamingiz», the wrong-ID warning ...";
 *   the limits not read from `lib/topup-limits` (hard-coded) → "shows «Sizning ID raqamingiz» ..." (limits line);
 *   an order created on the Paynet tap → "no order is created";
 *   the copy handler copies something else than the ID → "copy button";
 *   `rel` without noreferrer / link drawn without paynetUrl → "safe external link";
 *   the old wallet card re-added → "no separate Paynet card on the wallet page".
 */
const paynetStep = () => document.querySelector('[data-pay-step="paynet"]');
const paynetNotice = () => document.querySelector("[data-paynet-notice]")!;
const docExec = document as unknown as { execCommand?: (c: string) => boolean };
const navAny = navigator as unknown as Record<string, unknown>;
const realExec = docExec.execCommand;
function signInWithPaynet(paynet: boolean | undefined, extra: Record<string, unknown> = {}) {
  signIn();
  useAppStore.setState({ features: { payments: { click: true, payme: true, ...(paynet === undefined ? {} : { paynet }), ...extra } } as never });
}
async function openDialog() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "To'ldirish" }));
  });
  return screen.getByRole("dialog");
}
const paynetRow = (dialog: HTMLElement) => dialog.querySelector('[data-pay-methods] [data-pay-method="paynet"]') as HTMLButtonElement | null;
afterEach(() => {
  delete navAny.clipboard;
  docExec.execCommand = realExec;
});

test("Hamyon Paynet: no separate Paynet card on the wallet page", async () => {
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883" });
  stub();
  mount();
  await waitFor(() => assert.ok(document.querySelector('[data-wallet-ledger="ready"]')));
  assert.ok(!document.querySelector("[data-wallet-paynet]"));
  assert.ok(!/Paynet/.test(document.querySelector("[data-wallet]")!.textContent ?? ""), "no Paynet text on the page itself");
});

test("Hamyon Paynet: offered in the dialog only while the server has Paynet configured", async () => {
  for (const paynet of [undefined, false]) {
    signInWithPaynet(paynet);
    stub();
    mount();
    const dialog = await openDialog();
    assert.ok(!paynetRow(dialog), `no Paynet row for paynet=${String(paynet)}`);
    assert.ok(!/Paynet/.test(dialog.textContent ?? ""), "no Paynet text in the dialog");
    cleanup();
  }
  for (const direct of [false, true]) {
    signInWithPaynet(true, { clickDirect: direct });
    stub();
    mount();
    const dialog = await openDialog();
    const methods = [...dialog.querySelectorAll("[data-pay-methods] [data-pay-method]")].map((b) => b.getAttribute("data-pay-method"));
    assert.equal(methods.at(-1), "paynet", `Paynet after the Click methods (clickDirect=${direct}): ${methods.join(",")}`);
    assert.ok(methods.length > 1, "Click / Payme still listed");
    cleanup();
  }
  // Paynet alone: no «provider not connected» warning, the row is there.
  signIn();
  useAppStore.setState({ features: { payments: { click: false, payme: false, paynet: true } } as never });
  stub();
  mount();
  const dialog = await openDialog();
  assert.ok(paynetRow(dialog));
  assert.ok(!/hali ulanmagan/.test(dialog.textContent ?? ""));
});

test("Hamyon Paynet: any amount — the row opens even with an invalid dialog amount (Paynet credits what is paid there)", async () => {
  signInWithPaynet(true);
  stub();
  mount();
  const dialog = await openDialog();
  const input = dialog.querySelector("input") as HTMLInputElement;
  for (const value of ["5", "", "99999999"]) {
    await act(async () => {
      fireEvent.change(input, { target: { value } });
    });
    const row = paynetRow(screen.getByRole("dialog"))!;
    assert.equal(row.disabled, false, `enabled for ${JSON.stringify(value)}`);
    assert.equal((screen.getByRole("dialog").querySelector('[data-pay-method="payme"]') as HTMLButtonElement).disabled, true, "Payme still needs a valid amount");
  }
  await act(async () => {
    fireEvent.click(paynetRow(screen.getByRole("dialog"))!);
  });
  assert.ok(paynetStep(), "the Paynet step opens");
});

test("Hamyon Paynet: shows «Sizning ID raqamingiz», the wrong-ID warning and the any-amount rule, four steps; no amount is required; no order is created; «Orqaga» returns", async () => {
  signInWithPaynet(true);
  const calls = stub();
  mount();
  const dialog = await openDialog();
  const input = dialog.querySelector("input") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { value: "37000" } });
  });
  await act(async () => {
    fireEvent.click(paynetRow(dialog)!);
  });
  const step = paynetStep() as HTMLElement;
  assert.ok(step, "the Paynet step opens");
  assert.ok(within(dialog).getByRole("heading", { name: "Paynet orqali to'lash" }));
  assert.ok(!step.querySelector("[data-paynet-amount]"), "no amount to pay is shown");
  assert.ok(!(step.textContent ?? "").includes(groupDigits(37000)), "the dialog amount is not repeated as a requirement");
  const id = step.querySelector("[data-paynet-id]") as HTMLElement;
  assert.equal(id.textContent, "u1", "the user's id, nothing else");
  assert.ok(id.className.includes("text-[28px]"), "large");
  assert.equal(id.previousElementSibling?.textContent, "Sizning ID raqamingiz", "the ID is labelled as the user's own");
  // Prod incident 2026-10-31 (the amount «3000» typed into the ID field paid user #3000): the warning sits right under the ID.
  const warning = step.querySelector("[data-paynet-warning]")!;
  assert.equal(
    warning.textContent,
    "ID maydoniga summani emas, shu raqamni kiriting; to'lashdan oldin Paynet ko'rsatgan ism sizniki ekanini tekshiring.",
  );
  assert.ok(warning.compareDocumentPosition(step.querySelector("[data-paynet-steps]")!) & Node.DOCUMENT_POSITION_FOLLOWING, "warning before the steps");
  assert.equal(
    step.querySelector("[data-paynet-any-amount]")!.textContent,
    `Paynet'da istalgan summani to'lashingiz mumkin: eng kami ${groupDigits(MIN_TOPUP_SOUM)}, eng ko'pi ${groupDigits(MAX_TOPUP_SOUM)} so'm. Balansga aynan to'lagan summangiz tushadi.`,
  );
  const steps = [...step.querySelectorAll("[data-paynet-steps] li")].map((li) => li.textContent);
  assert.deepEqual(steps, [
    "1Paynet ilovasi yoki terminalini oching",
    "2«SlaydX» xizmatini tanlang",
    "3ID maydoniga ID raqamingizni kiriting",
    "4Paynet ko'rsatgan ism sizniki ekanini tekshirib, istalgan summani to'lang — u balansga darhol tushadi",
  ]);
  assert.ok(within(step).getByRole("button", { name: "SlaydX ID ni nusxalash" }).className.includes("h-11"), "44 px touch target");
  assert.ok(!calls.some((c) => c === "POST /api/payments/orders"), `no order: ${calls.join(" | ")}`);
  await act(async () => {
    fireEvent.click(within(step).getByRole("button", { name: "Orqaga" }));
  });
  assert.ok(!paynetStep());
  assert.ok(paynetRow(screen.getByRole("dialog")), "back on the method list");
});

test("Hamyon Paynet: signed out → the Paynet row opens login, not the step", async () => {
  signInWithPaynet(true);
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null });
  stub();
  mount();
  // Signed out the hero has no «To'ldirish»; the dialog is opened the way the quick top-up cards open it.
  await act(async () => {
    useUi.getState().open("pay");
  });
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(paynetRow(dialog)!);
  });
  assert.ok(!paynetStep());
  assert.equal(useUi.getState().overlay, "login");
});

test("Hamyon Paynet: signed in but the user not loaded yet → stays on the method list (no empty step)", async () => {
  // MUTATION: `!user` dropped from `openPaynet` → the dialog switches to an empty «Paynet orqali to'lash» view.
  signInWithPaynet(true);
  useAppStore.setState({ user: null });
  stub();
  mount();
  await act(async () => {
    useUi.getState().open("pay");
  });
  const dialog = screen.getByRole("dialog");
  await act(async () => {
    fireEvent.click(paynetRow(dialog)!);
  });
  assert.ok(paynetRow(screen.getByRole("dialog")), "still on the method list");
  assert.ok(!within(screen.getByRole("dialog")).queryByRole("heading", { name: "Paynet orqali to'lash" }));
  assert.equal(useUi.getState().overlay, "pay");
});

test("Hamyon Paynet: copy button writes the ID to the clipboard and says so", async () => {
  signInWithPaynet(true);
  stub();
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void written.push(t) }, configurable: true });
  mount();
  const dialog = await openDialog();
  await act(async () => {
    fireEvent.click(paynetRow(dialog)!);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "SlaydX ID ni nusxalash" }));
  });
  assert.deepEqual(written, ["u1"]);
  assert.equal(paynetNotice().textContent, "SlaydX ID nusxalandi");
  assert.equal(paynetNotice().getAttribute("data-paynet-notice"), "ok");
});

test("Hamyon Paynet: copy falls back to execCommand without the Clipboard API, and reports a failure", async () => {
  signInWithPaynet(true);
  stub();
  const exec: string[] = [];
  docExec.execCommand = (c: string) => (exec.push(c), true);
  mount();
  const dialog = await openDialog();
  await act(async () => {
    fireEvent.click(paynetRow(dialog)!);
  });
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
  assert.equal(document.querySelector("[data-paynet-id]")!.textContent, "u1", "the ID stays visible to copy by hand");
});

test("Hamyon Paynet: «Paynet ilovasida to'lash» is a safe external link shown only when the server sends paynetUrl", async () => {
  signInWithPaynet(true, { paynetUrl: "https://app.paynet.test/?m=54883" });
  stub();
  mount();
  let dialog = await openDialog();
  await act(async () => {
    fireEvent.click(paynetRow(dialog)!);
  });
  const link = document.querySelector("[data-paynet-open]") as HTMLAnchorElement;
  assert.ok(link, "MUTATION: the link block removed");
  assert.equal(link.getAttribute("href"), "https://app.paynet.test/?m=54883");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(link.getAttribute("rel") ?? "", /noopener/);
  assert.match(link.getAttribute("rel") ?? "", /noreferrer/);
  assert.match(link.textContent ?? "", /Paynet ilovasida to'lash/);
  cleanup();
  signInWithPaynet(true, { paynetUrl: null });
  stub();
  mount();
  dialog = await openDialog();
  await act(async () => {
    fireEvent.click(paynetRow(dialog)!);
  });
  assert.ok(paynetStep(), "the step still works");
  assert.ok(!document.querySelector("[data-paynet-open]"), "no link without paynetUrl");
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
