import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import { OrdersTable } from "../../components/admin/payments/OrdersTable.tsx";
import { OrderDetailPage } from "../../components/admin/payments/OrderDetailPage.tsx";
import { FinancePage } from "../../components/admin/finance/FinancePage.tsx";
import { LedgerTable } from "../../components/admin/finance/LedgerTable.tsx";
import { TIMEOUT_TEXT } from "../../components/admin/finance/ReconciliationView.tsx";
import { compactSoum } from "../../components/admin/finance/FinanceSummaryView.tsx";
import { cancelReasonText } from "../../components/admin/payments/labels.ts";

/*
 * Payments and finance screens (docs/admin/02-plan.md §7.0, §7.1 S8–S10):
 * the four states of every list/detail (loading, empty with "Filtrlarni
 * tozalash", error with requestId + retry, 403), filters written to the URL
 * (and NOT in embedded mode), aborted stale requests, keyset paging, the
 * external-refund flow on an order, the reconciliation timeout message, and
 * the step-up export retry.
 *
 * Module state (the core's step-up registry, the toast store, the identity
 * context) is read through `require`, the same instance the components use.
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;

const realFetch = globalThis.fetch;
beforeEach(() => core.setStepUpHandler(null));
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useToastStore.getState().clear();
  core.setStepUpHandler(null);
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

type Call = { url: string; path: string; params: URLSearchParams; method: string; init: RequestInit; body: Record<string, unknown> };
type Handler = (c: Call) => Response | Promise<Response>;

/** Routes by `METHOD /path`; an array answers the n-th call with the n-th handler (last one repeats). Honours the abort signal. */
function stubFetch(routes: Record<string, Handler | Handler[]>): Call[] {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  globalThis.fetch = ((input: string, init: RequestInit = {}) => {
    const url = String(input);
    const [path, qs = ""] = url.split("?");
    const method = (init.method ?? "GET").toUpperCase();
    const call: Call = { url, path: path!, params: new URLSearchParams(qs), method, init, body: typeof init.body === "string" ? JSON.parse(init.body) : {} };
    calls.push(call);
    const key = `${method} ${path}`;
    const route = routes[key];
    assert.ok(route, `kutilmagan so'rov: ${key}`);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const fn = Array.isArray(route) ? route[Math.min(n, route.length - 1)]! : route;
    return new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(fn(call)).then(resolve, reject);
    });
  }) as typeof fetch;
  return calls;
}

const never = () => new Promise<Response>(() => {});

/** Router whose `replace` really changes the URL the hooks read, so filters round-trip like in the browser. */
function Harness({ initial, log, perms, children }: { initial: string; log: string[]; perms: string[]; children: ReactNode }) {
  const [url, setUrl] = useState(initial);
  const [pathname, search = ""] = url.split("?");
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push: (href: string) => void log.push(`push ${href}`),
    replace: (href: string) => {
      log.push(`replace ${href}`);
      setUrl(href);
    },
  };
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: pathname! },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(search) },
        h(AdminIdentityProvider, { value: { adminId: "1", role: "finance", permissions: perms, name: "Moliya", username: null }, children }),
      ),
    ),
  );
}

const FINANCE_PERMS = ["payments.view", "payments.export", "payments.refund_record", "finance.view", "finance.export", "users.view"];
const VIEWER_PERMS = ["payments.view", "finance.view", "users.view"];

function mount(node: ReactNode, initial = "/admin/payments", perms = FINANCE_PERMS) {
  const log: string[] = [];
  const utils = render(h(Harness, { initial, log, perms, children: node }));
  return { ...utils, log };
}

const ORDER_ID = "2b0d6a3e-9c1f-4e8a-b2d7-5f3c1a9e7d40";
const ORDER = {
  id: ORDER_ID,
  userId: "42",
  userName: "Ali Valiyev",
  provider: "click",
  purpose: "topup",
  amountSoum: 20_000,
  state: "paid",
  providerTxn: "771234567",
  prepareId: "1001",
  createdAt: "2026-09-20T05:58:00.000Z",
  createTime: "2026-09-20T06:00:00.000Z",
  performTime: "2026-09-20T06:01:30.000Z",
  cancelTime: null,
  cancelReason: null,
  credited: true,
  externalRefunds: 0,
};
const PENDING = { ...ORDER, id: "8c2f1d4b-3a5e-4c6d-9e8f-1a2b3c4d5e6f", state: "pending", performTime: null, credited: false, provider: "payme", providerTxn: "6512f1e0a3b4c5d6e7f80912" };
const page = (items: unknown[], nextCursor: string | null = null, total = items.length) => ({ items, nextCursor, total, totalCapped: false });
const dataRows = (container: HTMLElement) => container.querySelectorAll("tbody tr[data-row-key]");

/* ───────────────────────────── helpers ───────────────────────────── */

test("labels: Payme cancel reasons are named, Click carries its own error code; compact axis numbers", () => {
  assert.equal(cancelReasonText(4, "payme"), "Muddati tugadi (4)");
  assert.equal(cancelReasonText(99, "payme"), "99");
  assert.equal(cancelReasonText(-5017, "click"), "Click xato kodi: -5017");
  assert.equal(cancelReasonText(null, "payme"), null);
  assert.equal(compactSoum(1_250_000), "1,3 mln");
  assert.equal(compactSoum(350_000), "350 ming");
  assert.equal(compactSoum(0), "0");
});

/* ───────────────────────────── OrdersTable ───────────────────────────── */

test("OrdersTable: skeleton while loading, then rows with links built from ids; the request carries the URL filters", async () => {
  let release: (r: Response) => void = () => {};
  const calls = stubFetch({ "GET /api/admin/orders": () => new Promise<Response>((r) => (release = r)) });
  const { container } = mount(h(OrdersTable), "/admin/payments?state=paid,pending,bogus&provider=click&sort=amount_desc");
  assert.ok(container.querySelector("[data-skeleton-row]"), "skeleton rows while loading");
  assert.ok(container.querySelector('[aria-busy="true"]'));
  await waitFor(() => assert.equal(calls.length, 1));
  assert.equal(calls[0]!.params.get("state"), "paid,pending", "junk states from the URL are never sent");
  assert.equal(calls[0]!.params.get("provider"), "click");
  assert.equal(calls[0]!.params.get("sort"), "amount_desc");
  assert.equal(calls[0]!.params.get("limit"), "50");

  release(json(200, page([ORDER, PENDING], null, 2)));
  await waitFor(() => assert.equal(dataRows(container).length, 2));
  const row = container.querySelector(`tr[data-row-key="${ORDER_ID}"]`) as HTMLElement;
  assert.ok(within(row).getByText("2b0d6a3e"));
  assert.equal(within(row).getByText("2b0d6a3e").closest("a")?.getAttribute("href"), `/admin/payments/${ORDER_ID}`);
  assert.equal(within(row).getByText("Ali Valiyev").closest("a")?.getAttribute("href"), "/admin/users/42");
  assert.ok(within(row).getByText("To'langan"));
  assert.ok(within(row).getByText("771234567"));
  assert.ok(screen.getByText("2 ta natija"));
  assert.ok(screen.getByRole("button", { name: "CSV yuklab olish" }), "export shown with payments.export");
  // 1280 px layout (UX #8): the default sort column, credited and external refunds come
  // before provider details and the long txn id; long text is capped with a `title`.
  const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
  assert.deepEqual(headers.slice(0, 7), ["Buyurtma", "Foydalanuvchi", "Summa", "Holat", "Yaratilgan", "Hisobga yozildi", "Tashqi qaytarish"]);
  const user = within(row).getByText("Ali Valiyev");
  assert.ok(user.className.includes("max-w-[9rem]") && user.className.includes("truncate"));
  assert.equal(user.getAttribute("title"), "Ali Valiyev");
  const txn = within(row).getByText("771234567");
  assert.ok(txn.className.includes("max-w-[10rem]") && txn.className.includes("truncate"));
});

test("OrdersTable: filter change writes the URL, resets paging and aborts the stale request", async () => {
  const calls = stubFetch({ "GET /api/admin/orders": [() => never(), () => json(200, page([ORDER]))] });
  const { log } = mount(h(OrdersTable));
  await waitFor(() => assert.equal(calls.length, 1));
  fireEvent.change(screen.getByLabelText("Provayder"), { target: { value: "payme" } });
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[0]!.init.signal?.aborted, true, "the first request was aborted");
  assert.deepEqual(log, ["replace /admin/payments?provider=payme"]);
  assert.equal(calls[1]!.params.get("provider"), "payme");
  assert.equal(calls[1]!.params.get("cursor"), null);

  const search = screen.getByLabelText("Buyurtma qidirish");
  fireEvent.change(search, { target: { value: "771234567" } });
  fireEvent.keyDown(search, { key: "Enter" });
  await waitFor(() => assert.equal(calls.length, 3));
  assert.equal(log.at(-1), "replace /admin/payments?provider=payme&q=771234567");
  assert.equal(calls[2]!.params.get("q"), "771234567");
});

test("OrdersTable: keyset paging forward and back", async () => {
  const calls = stubFetch({
    "GET /api/admin/orders": (c) => (c.params.get("cursor") ? json(200, page([PENDING], null, 2)) : json(200, page([ORDER], "CUR1", 2))),
  });
  const { container } = mount(h(OrdersTable));
  await waitFor(() => assert.equal(dataRows(container).length, 1));
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.ok(container.querySelector(`tr[data-row-key="${PENDING.id}"]`)));
  assert.equal(calls.at(-1)!.params.get("cursor"), "CUR1");
  fireEvent.click(screen.getByRole("button", { name: "Oldingi" }));
  await waitFor(() => assert.ok(container.querySelector(`tr[data-row-key="${ORDER_ID}"]`)));
  assert.equal(calls.at(-1)!.params.get("cursor"), null);
});

test("OrdersTable: empty without filters vs. with filters (clear removes them from the URL)", async () => {
  stubFetch({ "GET /api/admin/orders": () => json(200, page([])) });
  mount(h(OrdersTable));
  assert.ok(await screen.findByText("Buyurtmalar yo'q"));
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
  cleanup();

  stubFetch({ "GET /api/admin/orders": () => json(200, page([])) });
  const { log } = mount(h(OrdersTable), "/admin/payments?purpose=pro&from=2026-09-01&to=2026-09-30&tab=x");
  assert.ok(await screen.findByText("Filtrlarga mos buyurtma topilmadi"));
  const clear = screen.getAllByRole("button", { name: "Filtrlarni tozalash" });
  fireEvent.click(clear[clear.length - 1]!);
  await waitFor(() => assert.equal(log.at(-1), "replace /admin/payments?tab=x", "only the table's own keys are cleared"));
});

test("OrdersTable: error shows the requestId and retry refetches; 403 renders Ruxsat yo'q", async () => {
  const calls = stubFetch({
    "GET /api/admin/orders": [() => json(500, { error: "Ichki xatolik", requestId: "req-123" }), () => json(200, page([ORDER]))],
  });
  const { container } = mount(h(OrdersTable));
  assert.ok(await screen.findByText("req-123"));
  assert.ok(screen.getByText("Ichki xatolik"));
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.equal(dataRows(container).length, 1));
  assert.equal(calls.length, 2);
  cleanup();

  stubFetch({ "GET /api/admin/orders": () => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }) });
  mount(h(OrdersTable), "/admin/payments", VIEWER_PERMS);
  assert.ok(await screen.findByText("Ruxsat yo'q"));
  assert.ok(!screen.queryByRole("button", { name: "CSV yuklab olish" }), "no export button without payments.export");
});

test("OrdersTable embedded with fixedFilters: userId pinned in every request, user column/filter hidden, URL never written", async () => {
  const calls = stubFetch({ "GET /api/admin/orders": () => json(200, page([ORDER])) });
  const { container, log } = mount(h(OrdersTable, { embedded: true, fixedFilters: { userId: "42" } }), "/admin/users/42?tab=payments");
  await waitFor(() => assert.equal(dataRows(container).length, 1));
  assert.equal(calls[0]!.params.get("userId"), "42");
  assert.equal(calls[0]!.params.get("limit"), "20");
  assert.ok(!screen.queryByLabelText("Foydalanuvchi ID bo'yicha filtr"));
  assert.ok(!within(container.querySelector("thead") as HTMLElement).queryByText("Foydalanuvchi"));
  fireEvent.change(screen.getByLabelText("Maqsad"), { target: { value: "pro" } });
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[1]!.params.get("purpose"), "pro");
  assert.equal(calls[1]!.params.get("userId"), "42");
  assert.deepEqual(log, [], "embedded mode never touches the URL");
  fireEvent.click(screen.getByRole("button", { name: "Filtrlarni tozalash" }));
  await waitFor(() => assert.equal(calls.length, 3));
  assert.equal(calls[2]!.params.get("purpose"), null);
  assert.equal(calls[2]!.params.get("userId"), "42", "clear keeps the pinned user");
});

test("export: 401 reauth → step-up → retried once; the CSV is saved with the server's filename", async () => {
  const saved: string[] = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
  const Anchor = (globalThis as unknown as { window: { HTMLAnchorElement: typeof HTMLAnchorElement } }).window.HTMLAnchorElement;
  const realClick = Anchor.prototype.click;
  Anchor.prototype.click = function (this: HTMLAnchorElement) {
    saved.push(this.download);
  };
  let stepUps = 0;
  core.setStepUpHandler(async () => {
    stepUps += 1;
    return true;
  });
  try {
    const calls = stubFetch({
      "GET /api/admin/orders": () => json(200, page([ORDER])),
      "GET /api/admin/orders/export": [
        () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }),
        () => new Response("﻿\"Buyurtma ID\"\r\n", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="buyurtmalar-2026-10-02.csv"' } }),
      ],
    });
    mount(h(OrdersTable), "/admin/payments?state=paid&q=771234567");
    await waitFor(() => assert.equal(calls.length, 1));
    fireEvent.click(screen.getByRole("button", { name: "CSV yuklab olish" }));
    await waitFor(() => assert.deepEqual(saved, ["buyurtmalar-2026-10-02.csv"]));
    assert.equal(stepUps, 1);
    const exports = calls.filter((c) => c.path === "/api/admin/orders/export");
    assert.equal(exports.length, 2);
    assert.equal(exports[1]!.params.get("state"), "paid");
    assert.equal(exports[1]!.params.get("q"), "771234567");
    assert.equal(exports[1]!.params.get("cursor"), null);
    await waitFor(() => assert.ok(useToastStore.getState().toasts.some((t) => t.message.includes("Eksport tayyor"))));
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    Anchor.prototype.click = realClick;
  }
});

/* ───────────────────────────── OrderDetailPage ───────────────────────────── */

const DETAIL = {
  order: { ...ORDER, userUsername: "ali", updatedAt: "2026-09-20T06:01:30.000Z", settlementReference: "click:771234567", recordedSoum: 0, remainingSoum: 20_000 },
  events: [
    { id: "1", provider: "click", method: "prepare", providerTxn: "771234567", responseCode: 0, receivedAt: "2026-09-20T06:00:00.000Z", payload: { sign_string: "[REDACTED]", note: "<script>alert(1)</script>" } },
    { id: "2", provider: "click", method: "complete", providerTxn: "771234567", responseCode: -9, receivedAt: "2026-09-20T06:01:30.000Z", payload: { action: "1" } },
  ],
  eventsCapped: false,
  ledger: [
    { id: "77", userId: "42", userName: "Ali Valiyev", kind: "topup", points: 0, quota: 0, balance: 20_000, reference: "click:771234567", note: "click orqali to'ldirish", createdAt: "2026-09-20T06:01:30.000Z", link: { type: "order", id: ORDER_ID }, role: "credit" },
  ],
  refunds: [],
};

test("OrderDetailPage: loading skeleton, then fields with provider times in Tashkent, redacted payload as text, ledger row", async () => {
  let release: (r: Response) => void = () => {};
  stubFetch({ [`GET /api/admin/orders/${ORDER_ID}`]: () => new Promise<Response>((r) => (release = r)) });
  const { container } = mount(h(OrderDetailPage, { id: ORDER_ID }), `/admin/payments/${ORDER_ID}`);
  assert.ok(container.querySelector('[aria-busy="true"]'));
  release(json(200, DETAIL));
  await screen.findByText("Webhook voqealari");
  const kv = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
  assert.equal(kv("Provayderda yaratilgan (create_time)"), "20.09.2026 11:00", "create_time ms → Tashkent");
  assert.equal(kv("To'langan (perform_time)"), "20.09.2026 11:01");
  assert.equal(kv("Yaratilgan"), "20.09.2026 10:58");
  assert.equal(kv("Bekor qilingan (cancel_time)"), "—");
  assert.equal(kv("Hisob havolasi"), "click:771234567");
  assert.ok(screen.getByText("javob 0"));
  assert.ok(screen.getByText("javob -9"));
  const pre = container.querySelectorAll("pre");
  assert.ok([...pre].some((p) => (p.textContent ?? "").includes("<script>alert(1)</script>")), "payload shown literally");
  assert.ok(!container.querySelector("script"), "never interpreted as markup");
  assert.ok([...pre].some((p) => (p.textContent ?? "").includes("[REDACTED]")));
  assert.ok(screen.getByText("+20 000"), "credit delta");
  assert.ok(screen.getByText("Qayd etilmagan"));
});

test("OrderDetailPage: external refund flow — dialog → POST with Idempotency-Key and exact body → toast → detail reloaded", async () => {
  const refunded = { ...DETAIL, order: { ...DETAIL.order, recordedSoum: 5_000, remainingSoum: 15_000, externalRefunds: 1 }, refunds: [
    { id: "9", amountSoum: 5_000, kind: "refund", reason: "Click orqali qaytarildi", clawbackWallet: "balance", clawbackAmount: 5_000, shortfall: 0, clawbackTxId: "80", createdBy: "3", createdByName: "Moliya", createdAt: "2026-10-01T08:00:00.000Z" },
  ] };
  const calls = stubFetch({
    [`GET /api/admin/orders/${ORDER_ID}`]: [() => json(200, DETAIL), () => json(200, refunded)],
    [`POST /api/admin/orders/${ORDER_ID}/external-refund`]: () =>
      json(201, {
        refund: refunded.refunds[0],
        clawback: { wallet: "balance", requested: 5_000, debited: 5_000, shortfall: 0 },
        recordedSoum: 5_000,
        remainingSoum: 15_000,
      }),
  });
  mount(h(OrderDetailPage, { id: ORDER_ID }), `/admin/payments/${ORDER_ID}`);
  fireEvent.click(await screen.findByRole("button", { name: "Tashqi qaytarishni qayd etish" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Summa (so'm)"), { target: { value: "5000" } });
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Click orqali qaytarildi" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Qayd etish" }));
  await waitFor(() => assert.equal(calls.filter((c) => c.method === "GET").length, 2, "detail refetched"));
  assert.ok(await screen.findByText(/Balansdan yechildi: 5 000/), "the recorded refund appears after the reload");
  await waitFor(() => assert.ok(!screen.queryByRole("dialog"), "the dialog closed"));
  const post = calls.find((c) => c.method === "POST")!;
  assert.match(new Headers(post.init.headers as HeadersInit).get("idempotency-key") ?? "", UUID_V4);
  assert.deepEqual(post.body, { kind: "refund", amountSoum: 5_000, reason: "Click orqali qaytarildi", clawback: true });
  assert.ok(screen.getByText("qolgan 15 000 so'm", { exact: false }));
  assert.ok(useToastStore.getState().toasts.some((t) => t.message.startsWith("Qayd etildi")));
});

test("OrderDetailPage: no refund action without payments.refund_record or for an unpaid order; 404 and malformed id", async () => {
  stubFetch({ [`GET /api/admin/orders/${ORDER_ID}`]: () => json(200, DETAIL) });
  mount(h(OrderDetailPage, { id: ORDER_ID }), `/admin/payments/${ORDER_ID}`, VIEWER_PERMS);
  assert.ok(await screen.findByText("Webhook voqealari"));
  assert.ok(!screen.queryByRole("button", { name: "Tashqi qaytarishni qayd etish" }));
  cleanup();

  stubFetch({ [`GET /api/admin/orders/${ORDER_ID}`]: () => json(200, { ...DETAIL, order: { ...DETAIL.order, state: "pending", performTime: null } }) });
  mount(h(OrderDetailPage, { id: ORDER_ID }), `/admin/payments/${ORDER_ID}`);
  assert.ok(await screen.findByText("Webhook voqealari"));
  assert.ok(!screen.queryByRole("button", { name: "Tashqi qaytarishni qayd etish" }));
  cleanup();

  stubFetch({ [`GET /api/admin/orders/${ORDER_ID}`]: () => json(404, { error: "Topilmadi", code: "not_found" }) });
  mount(h(OrderDetailPage, { id: ORDER_ID }), `/admin/payments/${ORDER_ID}`);
  assert.ok(await screen.findByText("Buyurtma topilmadi"));
  cleanup();

  const calls = stubFetch({});
  mount(h(OrderDetailPage, { id: "not-a-uuid" }), "/admin/payments/not-a-uuid");
  assert.ok(screen.getByText("Buyurtma topilmadi"));
  await tick(10);
  assert.equal(calls.length, 0, "a malformed id never reaches the API");
});

/* ───────────────────────────── FinancePage ───────────────────────────── */

const SUMMARY = {
  range: { from: "2026-09-10", to: "2026-09-11", days: 2 },
  revenue: {
    total: { soum: 135_000, orders: 3 },
    byDay: [
      { day: "2026-09-10", soum: 0, orders: 0, click: 0, payme: 0, topup: 0, pro: 0 },
      { day: "2026-09-11", soum: 135_000, orders: 3, click: 100_000, payme: 35_000, topup: 120_000, pro: 15_000 },
    ],
    byProvider: { click: { soum: 100_000, orders: 1 }, payme: { soum: 35_000, orders: 2 } },
    byPurpose: { topup: { soum: 120_000, orders: 2 }, pro: { soum: 15_000, orders: 1 } },
  },
  cashSpend: { charges: 8, points: 0, quota: 0, balance: 26_500 },
  refunds: { count: 2, points: 0, quota: 0, balance: 3_000 },
  adjustments: { count: 1, points: 0, quota: 0, balance: -10_000 },
  liabilities: { points: 50, quota: 15_000, balance: 112_507, users: 3 },
  externalRefunds: { count: 2, amountSoum: 25_000, refunds: 1, chargebacks: 1, clawedBack: { balance: 10_000, quota: 0 }, shortfall: 0 },
  generatedAt: "2026-10-01T08:00:00.000Z",
};

test("FinancePage summary: range from the URL, KPI tiles, tab switch writes the URL", async () => {
  const calls = stubFetch({
    "GET /api/admin/finance/summary": () => json(200, SUMMARY),
    "GET /api/admin/transactions": () => json(200, page([])),
  });
  const { log } = mount(h(FinancePage), "/admin/finance?from=2026-09-10&to=2026-09-11");
  assert.ok((await screen.findAllByText("135 000 so'm")).length >= 1);
  assert.equal(calls[0]!.params.get("from"), "2026-09-10");
  assert.equal(calls[0]!.params.get("to"), "2026-09-11");
  assert.ok(screen.getByText("112 507 tanga"), "liabilities: balance");
  assert.ok(screen.getByText("74,1% · 1 ta"), "Click share of revenue");
  fireEvent.click(screen.getByRole("tab", { name: "Hisob kitobi" }));
  await waitFor(() => assert.equal(log.at(-1), "replace /admin/finance?from=2026-09-10&to=2026-09-11&tab=ledger"));
  assert.ok(await screen.findByText("Hisob yozuvlari yo'q"));
});

test("FinancePage 403 on any tab: only the forbidden state, no tabs, period or filters (UX #9)", async () => {
  const forbidden = () => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" });
  for (const [url, label] of [
    ["/admin/finance", "Xulosa davri"],
    ["/admin/finance?tab=ledger", "Havola bo'yicha filtr"],
    ["/admin/finance?tab=reconciliation", "Qayta tekshirish"],
  ] as const) {
    stubFetch({
      "GET /api/admin/finance/summary": forbidden,
      "GET /api/admin/transactions": forbidden,
      "GET /api/admin/finance/reconciliation": forbidden,
    });
    mount(h(FinancePage), url);
    await screen.findByText("Ruxsat yo'q");
    await waitFor(() => assert.ok(!screen.queryByRole("tablist"), `${url}: no tabs`));
    assert.ok(!screen.queryByLabelText(label), `${url}: no ${label}`);
    assert.ok(!screen.queryByRole("button", { name: label }), `${url}: no ${label} button`);
    assert.ok(!screen.queryByRole("group", { name: "Filtrlar" }), `${url}: no filter bar`);
    assert.equal(screen.getAllByText("Ruxsat yo'q").length, 1);
    cleanup();
  }
});

test("FinancePage reconciliation: counts, sample links by id, the timeout message; error + retry", async () => {
  const RECON = {
    checks: [
      { id: "paid_without_ledger", title: "To'langan, lekin hisobga yozilmagan buyurtmalar", severity: "error", count: 1, countCapped: false, timedOut: false, sample: [{ type: "order", id: ORDER_ID, userId: "42", userName: "Ali Valiyev", provider: "click", purpose: "topup", amountSoum: 7_000, state: "paid", createdAt: "2026-09-12T07:00:00.000Z", credited: false }] },
      { id: "wallet_ledger_mismatch", title: "Hamyon qoldig'i hisob yozuvlari yig'indisiga teng emas", severity: "error", count: null, countCapped: false, timedOut: true, sample: [] },
      { id: "failed_unrefunded", title: "Xato bilan tugagan, puli qaytarilmagan ishlar", severity: "error", count: 1, countCapped: false, timedOut: false, sample: [{ type: "generation", id: "5f0c2d1e-7b3a-4c9d-8e6f-0a1b2c3d4e5f", userId: "42", userName: "Ali Valiyev", toolId: "slide", toolTitle: "Slayd", finishedAt: "2026-10-01T07:00:00.000Z", charged: { points: 0, quota: 0, balance: 3_000 }, delivered: null }] },
      { id: "partial_refund_missing", title: "Qisman yetkazilgan, farqi qaytarilmagan ishlar", severity: "warning", count: 0, countCapped: false, timedOut: false, sample: [] },
      { id: "orders_pending_12h", title: "12 soatdan ortiq kutilayotgan buyurtmalar", severity: "warning", count: 0, countCapped: false, timedOut: false, sample: [] },
      { id: "orders_created_24h", title: "24 soatdan ortiq «yaratilgan» holatida qolgan buyurtmalar", severity: "info", count: 0, countCapped: false, timedOut: false, sample: [] },
    ],
    walletRange: null,
    generatedAt: "2026-10-01T08:00:00.000Z",
  };
  const calls = stubFetch({
    "GET /api/admin/finance/reconciliation": [() => json(500, { error: "Server javob bermadi", requestId: "req-rc" }), () => json(200, RECON), () => json(200, RECON)],
  });
  const { container, log } = mount(h(FinancePage), "/admin/finance?tab=reconciliation");
  assert.ok(await screen.findByText("req-rc"));
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  assert.ok(await screen.findByText(TIMEOUT_TEXT));
  const paid = container.querySelector('[data-check="paid_without_ledger"]') as HTMLElement;
  assert.equal(within(paid).getByText("2b0d6a3e").closest("a")?.getAttribute("href"), `/admin/payments/${ORDER_ID}`);
  const failed = container.querySelector('[data-check="failed_unrefunded"]') as HTMLElement;
  assert.equal(within(failed).getByText("5f0c2d1e").closest("a")?.getAttribute("href"), "/admin/generations/5f0c2d1e-7b3a-4c9d-8e6f-0a1b2c3d4e5f");
  // The sample names the tool by its server-resolved Uzbek title; the raw id is only the tooltip.
  assert.equal(within(failed).getByText("Slayd").getAttribute("title"), "slide");
  assert.ok(!within(failed).queryByText("slide"));
  assert.ok(screen.getByText("3 ta tekshiruvda topilma"));

  // Narrowing the wallet check: the range goes to the URL and to the request.
  fireEvent.click(screen.getByRole("radio", { name: "Davr tanlash" }));
  await waitFor(() => assert.match(log.at(-1) ?? "", /^replace \/admin\/finance\?tab=reconciliation&wfrom=\d{4}-\d{2}-\d{2}&wto=\d{4}-\d{2}-\d{2}$/));
  await waitFor(() => assert.equal(calls.length, 3));
  assert.match(calls[2]!.params.get("from") ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

test("LedgerTable: reference rendered as a link only when it resolved; embedded + fixed user never writes the URL", async () => {
  const entries = [
    { id: "5", userId: "42", userName: "Ali Valiyev", kind: "charge", points: 0, quota: -500, balance: -2_500, reference: "5f0c2d1e-7b3a-4c9d-8e6f-0a1b2c3d4e5f", note: "Generatsiya", createdAt: "2026-10-01T07:00:00.000Z", link: { type: "generation", id: "5f0c2d1e-7b3a-4c9d-8e6f-0a1b2c3d4e5f" } },
    { id: "4", userId: "42", userName: "Ali Valiyev", kind: "bonus", points: 50, quota: 0, balance: 0, reference: "signup:42", note: "=1+1", createdAt: "2026-10-01T06:00:00.000Z", link: null },
  ];
  const calls = stubFetch({ "GET /api/admin/transactions": () => json(200, page(entries)) });
  const { container, log } = mount(h(LedgerTable, { embedded: true, fixedFilters: { userId: "42" } }), "/admin/users/42");
  await waitFor(() => assert.equal(dataRows(container).length, 2));
  assert.equal(calls[0]!.params.get("userId"), "42");
  const charge = container.querySelector('tr[data-row-key="5"]') as HTMLElement;
  assert.equal(within(charge).getByText(entries[0]!.reference).closest("a")?.getAttribute("href"), `/admin/generations/${entries[0]!.reference}`);
  assert.ok(within(charge).getByText("-2 500"));
  const bonus = container.querySelector('tr[data-row-key="4"]') as HTMLElement;
  assert.ok(!within(bonus).getByText("signup:42").closest("a"), "an unresolved reference is plain text");
  fireEvent.change(screen.getByLabelText("Havola bo'yicha filtr"), { target: { value: "signup:42" } });
  fireEvent.keyDown(screen.getByLabelText("Havola bo'yicha filtr"), { key: "Enter" });
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[1]!.params.get("reference"), "signup:42");
  assert.deepEqual(log, []);
});

/* ───────────────────────────── subscription removal: legacy "(eski)" labels ───────────────────────────── */

test("FinancePage summary: legacy Pro revenue and quota liability show with «(eski)» only while non-zero", async () => {
  stubFetch({ "GET /api/admin/finance/summary": () => json(200, SUMMARY) });
  mount(h(FinancePage), "/admin/finance?from=2026-09-10&to=2026-09-11");
  await screen.findByText("112 507 tanga");
  assert.ok(screen.getByText("Majburiyat: kvota (eski)"), "15 000 legacy quota is still owed");
  assert.ok(screen.getByText("15 000 tanga"));
  const breakdown = screen.getByRole("region", { name: "Tushum taqsimoti" });
  assert.ok(within(breakdown).getByText("Pro obuna (eski)"), "a legacy Pro order in range");
  assert.ok(!screen.queryByText(/Pro kvota/));
  cleanup();

  const none = {
    ...SUMMARY,
    revenue: { ...SUMMARY.revenue, byPurpose: { topup: { soum: 120_000, orders: 2 }, pro: { soum: 0, orders: 0 } } },
    cashSpend: { ...SUMMARY.cashSpend, quota: 0 },
    adjustments: { ...SUMMARY.adjustments, quota: 0 },
    liabilities: { ...SUMMARY.liabilities, quota: 0 },
  };
  stubFetch({ "GET /api/admin/finance/summary": () => json(200, none) });
  mount(h(FinancePage), "/admin/finance?from=2026-09-10&to=2026-09-11");
  await screen.findByText("112 507 tanga");
  assert.ok(!screen.queryByText(/kvota/i), "MUTATSIYA: no quota tile or hint once everything is 0");
  const b2 = screen.getByRole("region", { name: "Tushum taqsimoti" });
  assert.ok(within(b2).getByText("Balansni to'ldirish"));
  assert.ok(!within(b2).queryByText(/Pro/), "MUTATSIYA: no Pro row without Pro orders");
});

test("OrdersTable: a legacy Pro order is marked «Pro (eski)»; the purpose filter says «Pro obuna (eski)»", async () => {
  stubFetch({ "GET /api/admin/orders": () => json(200, page([{ ...ORDER, id: ORDER_ID, purpose: "pro", amountSoum: 15_000 }])) });
  const { container } = mount(h(OrdersTable));
  await waitFor(() => assert.equal(dataRows(container).length, 1));
  assert.ok(within(dataRows(container)[0] as HTMLElement).getByText("Pro (eski)"));
  const purpose = screen.getByLabelText("Maqsad") as HTMLSelectElement;
  assert.ok(Array.from(purpose.options).some((o) => o.value === "pro" && o.textContent === "Pro obuna (eski)"));
});

test("LedgerTable: a quota_merge row shows «Kvota → balans»; the quota column hides when no row on the page moved quota", async () => {
  const merge = { id: "8", userId: "42", userName: "Ali Valiyev", kind: "quota_merge", points: 0, quota: -12_000, balance: 12_000, reference: "quota-merge:42", note: "Kvota balansga o'tkazildi: 12000 tanga", createdAt: "2026-10-02T06:00:00.000Z", link: null };
  const topup = { id: "7", userId: "42", userName: "Ali Valiyev", kind: "topup", points: 0, quota: 0, balance: 20_000, reference: "click:1", note: null, createdAt: "2026-10-01T06:00:00.000Z", link: null };
  stubFetch({ "GET /api/admin/transactions": () => json(200, page([merge, topup])) });
  const { container } = mount(h(LedgerTable, { embedded: true, fixedFilters: { userId: "42" } }), "/admin/users/42");
  await waitFor(() => assert.equal(dataRows(container).length, 2));
  const row = container.querySelector('tr[data-row-key="8"]') as HTMLElement;
  assert.ok(within(row).getByText("Kvota → balans"));
  assert.ok(within(container.querySelector("thead") as HTMLElement).getByText("Kvota (eski)"));
  cleanup();

  stubFetch({ "GET /api/admin/transactions": () => json(200, page([topup])) });
  const second = mount(h(LedgerTable, { embedded: true, fixedFilters: { userId: "42" } }), "/admin/users/42");
  await waitFor(() => assert.equal(dataRows(second.container).length, 1));
  assert.ok(!within(second.container.querySelector("thead") as HTMLElement).queryByText(/Kvota/), "MUTATSIYA: an all-zero quota column is hidden");
});
