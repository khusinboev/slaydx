import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { WalletAdjustDialog } from "../../components/admin/money/WalletAdjustDialog.tsx";
import { JobActionDialog } from "../../components/admin/money/JobActionDialog.tsx";
import { ExternalRefundDialog } from "../../components/admin/money/ExternalRefundDialog.tsx";
import { confirmText, parseWholeNumber, refundText } from "../../components/admin/money/shared.ts";

/**
 * Money dialogs (docs/admin/02-plan.md §7.0 Mutations, §11 UI): every request
 * carries ONE `Idempotency-Key` per dialog open (reused on retry), the body is
 * exactly what the API expects, 409 insufficient shows the available amount
 * inline, the typed confirmation gates large amounts (wallet threshold, more
 * than half of an order), the button stays disabled while the request is in
 * flight, and success produces a toast.
 */

// tsx loads the components' imports through `require`; the toast store is module
// state, so read it through the same instance (see admin-primitives.test.mts).
const { useToastStore } = createRequire(import.meta.url)("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useToastStore.getState().clear();
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NB = " ";

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
function stubFetch(responses: Array<() => Response | Promise<Response>>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    const next = responses[calls.length - 1];
    assert.ok(next, `kutilmagan ${calls.length}-so'rov`);
    return next();
  }) as typeof fetch;
  return calls;
}
const headerOf = (c: Call, name: string) => new Headers(c.init.headers as HeadersInit).get(name);
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

const USER = { id: "7", name: "Ali Valiyev", username: "ali", points: 0, quota: 0, balance: 100 };
const WALLET_OK = { transactionId: "99", wallet: "balance", before: 100, after: 350, user: { ...USER, balance: 350 } };

function openWallet(extra: Partial<Parameters<typeof WalletAdjustDialog>[0]> = {}) {
  const events: string[] = [];
  render(
    h(WalletAdjustDialog, {
      open: true,
      onClose: () => events.push("close"),
      user: USER,
      confirmThreshold: 1_000_000,
      onDone: () => events.push("done"),
      ...extra,
    }),
  );
  return events;
}
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

/* ───────────────────────────── helpers ───────────────────────────── */

test("shared: confirmText uses typeable spaces, parseWholeNumber tolerates separators, refundText lists the wallets", () => {
  assert.equal(confirmText(1_000_000), "1 000 000");
  assert.equal(confirmText(-2_500), "2 500");
  assert.equal(parseWholeNumber("1 000"), 1000);
  assert.equal(parseWholeNumber(`1${NB}000`), 1000);
  assert.equal(parseWholeNumber("12.5"), null);
  assert.equal(parseWholeNumber("-3"), null);
  assert.equal(parseWholeNumber(""), null);
  assert.equal(refundText(null), "pul qaytarilmadi");
  assert.equal(refundText({ points: 200, quota: 0, balance: 800 }), `qaytarildi: 200 bonus ball, 800 balans`);
});

/* ───────────────────────────── WalletAdjustDialog ───────────────────────────── */

test("WalletAdjustDialog: credit → POST with one Idempotency-Key, exact body, before → after, toast, onDone, close", async () => {
  const calls = stubFetch([() => json(201, WALLET_OK)]);
  const events = openWallet();
  assert.equal(button("Qo'shish").disabled, true, "nothing filled yet");

  fireEvent.change(screen.getByLabelText("Miqdor"), { target: { value: "250" } });
  assert.equal(button("Qo'shish").disabled, true, "reason still missing");
  assert.ok(screen.getByText("350"), "after value computed on the client");
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Xizmat uzilishi uchun" } });
  fireEvent.change(screen.getByLabelText("Sabab turi"), { target: { value: "promo" } });
  assert.equal(button("Qo'shish").disabled, false);
  assert.ok(!screen.queryByLabelText(/Tasdiqlash uchun/), "below the threshold there is no typed confirmation");

  fireEvent.click(button("Qo'shish"));
  await waitFor(() => assert.equal(events.includes("close"), true));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/admin/users/7/wallet-adjustments");
  assert.equal(calls[0].init.method, "POST");
  assert.match(headerOf(calls[0], "idempotency-key") ?? "", UUID_V4);
  assert.deepEqual(calls[0].body, { wallet: "balance", delta: 250, reasonCode: "promo", reason: "Xizmat uzilishi uchun" });
  assert.deepEqual(events, ["done", "close"]);
  assert.ok(toasts().some((m) => m.includes("Balans tuzatildi")), `toast: ${toasts().join(" | ")}`);
});

test("WalletAdjustDialog: only bonus and balance are adjustable — no legacy quota option, even for a quota holder", () => {
  openWallet({ user: { ...USER, quota: 5_000 } });
  const options = Array.from((screen.getByLabelText("Hamyon") as HTMLSelectElement).options).map((o) => o.value);
  assert.deepEqual(options, ["points", "balance"], "MUTATSIYA: quota is read-only since the subscription removal");
  assert.ok(!screen.queryByRole("option", { name: /Kvota/ }));
});

test("WalletAdjustDialog: 409 insufficient shows the available amount inline, the retry reuses the same key", async () => {
  const calls = stubFetch([
    () => json(409, { error: "Mablag' yetarli emas", code: "insufficient", available: 40 }),
    () => json(201, { ...WALLET_OK, before: 40, after: 0 }),
  ]);
  // The dialog's snapshot says 60 points; the server knows only 40 are left (someone spent in between).
  const events2 = openWallet({ user: { ...USER, points: 60 } });
  fireEvent.change(screen.getByLabelText("Amal"), { target: { value: "debit" } });
  fireEvent.change(screen.getByLabelText("Hamyon"), { target: { value: "points" } });
  fireEvent.change(screen.getByLabelText("Miqdor"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Noto'g'ri bonus" } });
  fireEvent.click(button("Yechish"));
  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, "Mablag' yetarli emas. Mavjud: 40");
  assert.equal(events2.length, 0, "dialog stays open");
  assert.equal(calls[0].body.delta, -50);
  assert.equal(calls[0].body.wallet, "points");

  fireEvent.click(button("Yechish"));
  await waitFor(() => assert.equal(events2.includes("close"), true));
  assert.equal(calls.length, 2);
  assert.equal(headerOf(calls[0], "idempotency-key"), headerOf(calls[1], "idempotency-key"), "same key on retry");
});

test("WalletAdjustDialog: at the threshold the formatted amount must be typed and is sent as `confirm`", async () => {
  const calls = stubFetch([() => json(201, { ...WALLET_OK, after: 1100 })]);
  openWallet({ confirmThreshold: 1_000 });
  fireEvent.change(screen.getByLabelText("Miqdor"), { target: { value: "999" } });
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Katta kompensatsiya" } });
  assert.ok(!screen.queryByLabelText(/Tasdiqlash uchun/));
  assert.equal(button("Qo'shish").disabled, false);

  fireEvent.change(screen.getByLabelText("Miqdor"), { target: { value: "1000" } });
  const typed = screen.getByLabelText(/Tasdiqlash uchun/) as HTMLInputElement;
  assert.equal(button("Qo'shish").disabled, true, "typed confirmation required");
  fireEvent.change(typed, { target: { value: "1000" } });
  assert.equal(button("Qo'shish").disabled, true, "must match the formatted amount");
  fireEvent.change(typed, { target: { value: "1 000" } });
  assert.equal(button("Qo'shish").disabled, false);
  fireEvent.click(button("Qo'shish"));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0].body.confirm, "1 000");
  assert.equal(calls[0].body.delta, 1000);
});

test("WalletAdjustDialog: a client-side insufficient debit never reaches the network; in flight the button is disabled", async () => {
  let release: (() => void) | null = null;
  const calls = stubFetch([() => new Promise<Response>((r) => (release = () => r(json(201, WALLET_OK))))]);
  openWallet();
  fireEvent.change(screen.getByLabelText("Amal"), { target: { value: "debit" } });
  fireEvent.change(screen.getByLabelText("Miqdor"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Sinov uchun" } });
  assert.equal(button("Yechish").disabled, true);
  assert.match(screen.getByText(/Mavjud: 100/).textContent ?? "", /Mavjud: 100/);
  assert.equal(calls.length, 0);

  fireEvent.change(screen.getByLabelText("Miqdor"), { target: { value: "100" } });
  assert.equal(button("Yechish").disabled, false);
  fireEvent.click(button("Yechish"));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(button("Yechish").disabled, true, "disabled while the request is in flight");
  assert.equal(button("Bekor qilish").disabled, true);
  release!();
  await waitFor(() => assert.ok(toasts().length));
});

/* ───────────────────────────── JobActionDialog ───────────────────────────── */

test("JobActionDialog: refund sends the Idempotency-Key and the reason; cancel sends no key; 409 state is shown inline", async () => {
  const calls = stubFetch([
    () => json(200, { refunded: { points: 0, quota: 0, balance: 1000 } }),
    () => json(409, { error: "Ish holati REVOKED; faqat QUEUED ish uchun mumkin", code: "state", status: "REVOKED" }),
  ]);
  const gen = { id: "0f3a1c2e-1111-4222-8333-444455556666", status: "FAILED", price: 1000, topic: "Referat" };
  const closed: string[] = [];
  const { unmount } = render(h(JobActionDialog, { open: true, onClose: () => closed.push("refund"), action: "refund", generation: gen }));
  assert.ok(screen.getByText("qaytarilmagan"));
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Worker yiqilgan edi" } });
  fireEvent.click(button("Qaytarish"));
  await waitFor(() => assert.equal(closed.length, 1));
  assert.equal(calls[0].url, `/api/admin/generations/${gen.id}/refund`);
  assert.match(headerOf(calls[0], "idempotency-key") ?? "", UUID_V4);
  assert.deepEqual(calls[0].body, { reason: "Worker yiqilgan edi" });
  assert.ok(toasts().some((m) => m === `Pul qaytarildi: 1${NB}000 balans`), `toast: ${toasts().join(" | ")}`);
  unmount();

  render(h(JobActionDialog, { open: true, onClose: () => closed.push("cancel"), action: "cancel", generation: { ...gen, status: "QUEUED" } }));
  assert.ok(screen.getByText("QUEUED") && screen.getByText("REVOKED"));
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Takroriy ish" } });
  assert.equal(button("Bekor qilish").disabled, false, "the dialog's own cancel button is distinct");
  fireEvent.click(button("Ishni bekor qilish"));
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /faqat QUEUED/);
  assert.equal(calls[1].url, `/api/admin/generations/${gen.id}/cancel`);
  assert.equal(headerOf(calls[1], "idempotency-key"), null, "cancel/fail carry no key (state machine)");
  assert.equal(closed.length, 1, "dialog stays open on the error");
});

/* ───────────────────────────── ExternalRefundDialog ───────────────────────────── */

test("ExternalRefundDialog: remaining amount by default, typed confirmation above half the order, clawback flag and key in the request", async () => {
  const calls = stubFetch([
    () =>
      json(201, {
        refund: { id: "5", orderId: "o", amountSoum: 15000, kind: "refund", reason: "r", clawbackWallet: "balance", clawbackAmount: 9000, shortfall: 6000, clawbackTxId: "77", createdBy: "1", createdAt: "" },
        clawback: { wallet: "balance", requested: 15000, debited: 9000, shortfall: 6000 },
        recordedSoum: 20000,
        remainingSoum: 0,
      }),
  ]);
  const order = { id: "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d", amountSoum: 20_000, purpose: "topup" as const, recordedSoum: 5_000 };
  const events: string[] = [];
  render(h(ExternalRefundDialog, { open: true, onClose: () => events.push("close"), order, onDone: () => events.push("done") }));
  const amount = screen.getByLabelText("Summa (so'm)") as HTMLInputElement;
  assert.equal(amount.value, "15000", "defaults to what is still unrecorded");
  const clawback = screen.getByLabelText(/Hamyondan yechish/) as HTMLInputElement;
  assert.equal(clawback.checked, true);
  // The default text normalizer collapses NBSP to a space.
  assert.ok(screen.getByText("20 000 so'm"), "before → after shows the recorded total after the call");

  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Click orqali qaytarildi" } });
  const typed = screen.getByLabelText(/Tasdiqlash uchun/) as HTMLInputElement;
  assert.equal(button("Qayd etish").disabled, true, "15 000 > half of 20 000 → typed confirmation");
  fireEvent.change(typed, { target: { value: "15 000" } });
  assert.equal(button("Qayd etish").disabled, false);

  fireEvent.change(amount, { target: { value: "16000" } });
  assert.equal(button("Qayd etish").disabled, true, "above the remaining amount");
  fireEvent.change(amount, { target: { value: "4000" } });
  assert.ok(!screen.queryByLabelText(/Tasdiqlash uchun/), "small amount needs no typed confirmation");
  fireEvent.change(amount, { target: { value: "15000" } });
  fireEvent.change(screen.getByLabelText(/Tasdiqlash uchun/), { target: { value: "15 000" } });
  fireEvent.change(screen.getByLabelText("Turi"), { target: { value: "chargeback" } });

  fireEvent.click(button("Qayd etish"));
  await waitFor(() => assert.equal(events.includes("close"), true));
  assert.equal(calls[0].url, `/api/admin/orders/${order.id}/external-refund`);
  assert.match(headerOf(calls[0], "idempotency-key") ?? "", UUID_V4);
  assert.deepEqual(calls[0].body, { kind: "chargeback", amountSoum: 15000, reason: "Click orqali qaytarildi", clawback: true });
  assert.deepEqual(events, ["done", "close"]);
  assert.ok(toasts().some((m) => m.includes("yetishmadi")), `toast: ${toasts().join(" | ")}`);
});

test("ExternalRefundDialog: 409 amount shows the remaining soum inline; unchecking clawback sends false", async () => {
  const calls = stubFetch([() => json(409, { error: "Summa oshdi", code: "amount", remaining: 2000 })]);
  const order = { id: "7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d", amountSoum: 10_000, purpose: "pro" as const, recordedSoum: 0 };
  render(h(ExternalRefundDialog, { open: true, onClose: () => {}, order }));
  // A legacy Pro order is clawed back from the balance (its quota was merged into it).
  assert.ok(screen.getByText(/^Balansdan shu summaga mos miqdor yechiladi/), "MUTATSIYA: pro → balance, not quota");
  assert.ok(!screen.queryByText(/kvota/i));
  fireEvent.change(screen.getByLabelText("Summa (so'm)"), { target: { value: "3000" } });
  fireEvent.click(screen.getByLabelText(/Hamyondan yechish/));
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Payme chargeback" } });
  fireEvent.click(button("Qayd etish"));
  const alert = await screen.findByRole("alert");
  assert.equal(alert.textContent, `Summa qolgan miqdordan oshmasligi kerak. Qolgan: 2${NB}000 so'm`);
  assert.equal(calls[0].body.clawback, false);
  assert.equal(calls[0].body.amountSoum, 3000);
});
