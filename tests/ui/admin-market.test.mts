import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { MarketPage } from "../../components/admin/market/MarketPage.tsx";
import { piiPlace, rejectReasonText } from "../../components/admin/market/shared.tsx";
import { marketWorkDoc } from "../helpers/market-fixtures.mts";

/**
 * /admin/market (docs/market/PLAN.md §6): the page opens without a refetch loop, the review drawer shows the PII flags
 * with the sanitised preview next to them, approve sends only what changed plus the Idempotency-Key, the actions follow
 * the role (cosmetic; the server enforces them), bulk approve is careful, and the other tabs draw the server's numbers.
 *
 * Mutations (each turned the named test red, then restored byte for byte):
 *   1. the page's loader back to an inline arrow in `useLoad`        -> «opens with bounded requests», and the source test
 *      in admin-studio-library;
 *   2. `<Flags item={item} />` removed from the drawer               -> «drawer: the PII flags»;
 *   3. `editsOf` returns the whole form                              -> «approve: only what changed»;
 *   4. `canManage` forced to true in `Loaded`                        -> «a view-only role»;
 *   5. the typed confirmation condition `> 100`                      -> «bulk: more than 10»;
 *   6. the `withFlags === selected.size` disable removed             -> «bulk: only flagged works»;
 *   7. `confirmDisabled={code === ""}` removed from `CodeDialog`     -> «reject needs a reason code»;
 *   8. the price dialog's `next` always the old value                -> «price: an empty field clears».
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

const realFetch = globalThis.fetch;
const realReplaceState = window.history.replaceState;
afterEach(() => {
  window.history.replaceState = realReplaceState;
  cleanup();
  globalThis.fetch = realFetch;
  core.setStepUpHandler(null);
  useToastStore.getState().clear();
});

const PERMS = {
  owner: ["market.view", "market.manage", "pricing.edit", "finance.export", "users.pii"],
  moderator: ["market.view", "market.manage"],
  viewer: ["market.view"],
} as const;
type Role = keyof typeof PERMS;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
type Call = { method: string; body: Record<string, unknown> | null; path: string; search: URLSearchParams; headers: Headers };

const ID = "3fa1c2d4-5b6e-4f70-8a91-b2c3d4e5f607";
const ID2 = "3fa1c2d4-5b6e-4f70-8a91-b2c3d4e5f608";
const OVERVIEW = { enabled: false, candidates: 2, active: 1, soldOut: 0, retired: 0, errors: 0, reported: 0, trgm: false, previews: true };
const ITEM = {
  id: ID,
  toolId: "referat",
  toolTitle: "Referat",
  status: "candidate",
  title: "Energetika tarixi",
  subject: "tarix",
  level: "otm",
  language: "uz",
  pages: 12,
  slideCount: null,
  quality: 90,
  flags: 0,
  duplicates: 0,
  createdAt: "2026-11-01T05:00:00.000Z",
  approvedAt: null,
  retiredAt: null,
  sourceFinishedAt: "2026-10-30T05:00:00.000Z",
  soldCount: 0,
  maxCopies: null,
  revenue: 0,
  price: 2000,
  originalPrice: 4000,
  priceOverride: null,
  rating: null,
  reports: 0,
  hidden: false,
  authorOptOut: false,
  rejectReason: null,
};
const DETAIL = {
  ...ITEM,
  flags: 1,
  summary: "Qisqa tavsif",
  outline: ["Kirish", "Xulosa"],
  flagsList: [{ kind: "phone", path: "sections.2.blocks.0.text", excerpt: "Bog'lanish: ____ raqami" }],
  previewPages: 2,
  previewVersion: 3,
  hasDoc: true,
  neutralFile: null,
  reportsList: [],
  source: null,
};
const list = (items: unknown[]) => ({ items, nextCursor: null, total: items.length, totalCapped: false });
const STATS = {
  from: "2026-10-07",
  to: "2026-11-05",
  days: 30,
  purchases: 3,
  gross: 6000,
  refunds: { count: 1, amount: 2000 },
  revenue: 4000,
  avgPrice: 2000,
  views: 30,
  conversion: 10,
  daily: [{ day: "2026-11-05", purchases: 3, revenue: 6000 }],
  topItems: [{ id: ID, label: "Energetika tarixi", purchases: 3, revenue: 6000 }],
  byTool: [{ id: "referat", label: "Referat", purchases: 3, revenue: 6000 }],
  bySubject: [{ id: "tarix", label: "Tarix", purchases: 3, revenue: 6000 }],
};

function stub(over: (c: Call) => Response | null = () => null): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url), "http://localhost");
    const c: Call = { method: init.method ?? "GET", body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, path: u.pathname, search: u.searchParams, headers: new Headers(init.headers) };
    calls.push(c);
    const custom = over(c);
    if (custom) return custom;
    if (c.path.endsWith("/overview")) return json(200, OVERVIEW);
    if (c.path.endsWith("/market/items")) return json(200, list([ITEM]));
    if (c.path.endsWith(`/items/${ID}`)) return json(200, DETAIL);
    if (c.path.endsWith("/doc")) return json(500, { error: "stub" });
    if (c.path.endsWith("/buyers")) return json(200, { items: [] });
    if (c.path.endsWith("/stats")) return json(200, STATS);
    if (c.path.endsWith("/tool-pricing")) return json(200, { percent: 50, items: [{ toolId: "essay", title: "Insho", percent: null, effective: 50, disabled: false, active: 2 }] });
    return json(200, { id: ID, status: "active" });
  }) as typeof fetch;
  return calls;
}

function mount(role: Role = "moderator", search = "") {
  window.history.replaceState = () => {};
  const router = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
  return render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(
        PathnameContext.Provider,
        { value: "/admin/market" },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(search) },
          h(AdminIdentityProvider, { value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null, twoFactor: true }, children: h(MarketPage) }),
        ),
      ),
    ),
  );
}

const openDrawer = async () => {
  // The table and the phone cards both hold the row.
  fireEvent.click((await screen.findAllByText("Energetika tarixi"))[0]!);
  return within(await screen.findByRole("dialog"));
};

test("page: opens with bounded requests, no refetch loop; the tab badge is the server's count", async () => {
  const calls = stub();
  const { container } = mount();
  await screen.findAllByText("Energetika tarixi");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  assert.equal(calls.filter((c) => c.path.endsWith("/overview")).length, 1, "one overview");
  assert.equal(calls.filter((c) => c.path.endsWith("/market/items")).length, 1, "one list");
  assert.equal(calls.find((c) => c.path.endsWith("/market/items"))!.search.get("status"), "candidate");
  assert.match(within(screen.getByRole("tablist")).getByRole("tab", { name: /Navbat/ }).textContent ?? "", /2/);
  assert.match(container.textContent ?? "", /O'chiq/);
});

test("drawer: the PII flags stand next to the sanitised preview", async () => {
  stub();
  mount();
  const d = await openDrawer();
  await d.findByText(/PII topildi: 1 joy/);
  assert.ok(d.getByText("Telefon"));
  assert.ok(d.getByText("3-bo'lim, 1-band"), "a place, not a JSON path");
  assert.ok(d.getByText("Bog'lanish: ____ raqami"));
  assert.ok(d.getByText("Tozalangan nusxa"));
});

test("approve: only what changed, with the reason and an Idempotency-Key", async () => {
  const calls = stub();
  mount();
  const d = await openDrawer();
  fireEvent.change(await d.findByLabelText("Sarlavha"), { target: { value: "Yangi sarlavha" } });
  fireEvent.click(d.getByRole("button", { name: "Tasdiqlash" }));
  const confirm = await screen.findByRole("dialog", { name: "Ishni tasdiqlash" });
  fireEvent.change(within(confirm).getByLabelText("Sabab"), { target: { value: "Sifat yaxshi" } });
  fireEvent.click(within(confirm).getByRole("button", { name: "Tasdiqlash" }));
  await waitFor(() => assert.ok(calls.some((c) => c.path.endsWith("/approve"))));
  const post = calls.find((c) => c.path.endsWith("/approve"))!;
  assert.deepEqual(post.body, { reason: "Sifat yaxshi", title: "Yangi sarlavha" });
  assert.ok(post.headers.get("Idempotency-Key"));
});

test("the sanitised document opens in the real viewer for a reviewer; a row without one says so", async () => {
  const doc = marketWorkDoc("referat", "Mavzu", 11, { words: 60 });
  stub((c) => (c.path.endsWith("/doc") ? json(200, { doc }) : null));
  mount();
  await openDrawer();
  await waitFor(() => assert.ok(document.querySelector("[data-market-doc]")));
  await waitFor(() => assert.match(document.querySelector("[data-market-doc]")!.textContent ?? "", /Mavzu: «Mavzu»/), { timeout: 15_000 });
  cleanup();
  stub((c) => (c.path.endsWith(`/items/${ID}`) ? json(200, { ...DETAIL, hasDoc: false, flagsList: [] }) : null));
  mount();
  const d = await openDrawer();
  await d.findByText(/ko'rsatiladigan hujjat yo'q/);
});

test("a view-only role sees the rasters and no action", async () => {
  stub();
  mount("viewer");
  const d = await openDrawer();
  await d.findByText(/PII topildi/);
  assert.ok(!d.queryByRole("button", { name: "Tasdiqlash" }));
  assert.ok(!d.queryByRole("button", { name: "Rad etish" }));
  assert.ok(!d.queryByLabelText("Sarlavha"));
  const img = d.getByAltText("1-sahifa") as HTMLImageElement;
  assert.ok(img.src.endsWith(`/api/admin/market/items/${ID}/preview/1?v=3`));
  assert.ok(!screen.queryByRole("button", { name: "Skanerlash" }), "no scan without market.manage");
});

test("reject needs a reason code", async () => {
  const calls = stub();
  mount();
  const d = await openDrawer();
  fireEvent.click(await d.findByRole("button", { name: "Rad etish" }));
  const dlg = await screen.findByRole("dialog", { name: "Ishni rad etish" });
  fireEvent.change(within(dlg).getByLabelText("Izoh"), { target: { value: "Mualliflik muammosi" } });
  const button = within(dlg).getByRole("button", { name: "Rad etish" }) as HTMLButtonElement;
  assert.equal(button.disabled, true);
  fireEvent.change(within(dlg).getByLabelText("Sabab"), { target: { value: "copyright" } });
  assert.equal(button.disabled, false);
  fireEvent.click(button);
  await waitFor(() => assert.ok(calls.some((c) => c.path.endsWith("/reject"))));
  assert.deepEqual(calls.find((c) => c.path.endsWith("/reject"))!.body, { reason: "Mualliflik muammosi", code: "copyright" });
});

test("price: only with pricing.edit; an empty field clears the override", async () => {
  const calls = stub((c) => (c.path.endsWith(`/items/${ID}`) ? json(200, { ...DETAIL, status: "active", priceOverride: 1500 }) : null));
  mount("owner");
  const d = await openDrawer();
  fireEvent.click(await d.findByRole("button", { name: "Narx" }));
  const dlg = await screen.findByRole("dialog", { name: "Bozor narxi" });
  fireEvent.change(within(dlg).getByLabelText(/Narx, so/), { target: { value: "" } });
  fireEvent.change(within(dlg).getByLabelText("Sabab"), { target: { value: "Narx formulaga qaytdi" } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Qo'llash" }));
  await waitFor(() => assert.ok(calls.some((c) => c.path.endsWith("/price"))));
  assert.deepEqual(calls.find((c) => c.path.endsWith("/price"))!.body, { price: null, reason: "Narx formulaga qaytdi" });
});

const selectAll = (container: HTMLElement) => {
  for (const box of container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')) fireEvent.click(box);
};

test("bulk: a flagged work is named, only flagged works disable the button", async () => {
  stub((c) => (c.path.endsWith("/market/items") ? json(200, list([{ ...ITEM, flags: 2 }])) : null));
  const { container } = mount();
  await screen.findAllByText("Energetika tarixi");
  selectAll(container);
  const bar = container.querySelector("[data-bulk-bar]") as HTMLElement;
  assert.ok(bar);
  assert.match(bar.textContent ?? "", /PII topilgan 1 ta ish alohida tekshiriladi/);
  assert.equal((within(bar).getByRole("button", { name: "Tanlanganlarni tasdiqlash" }) as HTMLButtonElement).disabled, true);
});

test("bulk: more than 10 needs the count typed; the request carries every id", async () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ ...ITEM, id: `3fa1c2d4-5b6e-4f70-8a91-b2c3d4e5f6${String(i).padStart(2, "0")}`, title: `Ish ${i}` }));
  const calls = stub((c) => {
    if (c.path.endsWith("/market/items")) return json(200, list(items));
    if (c.path.endsWith("/bulk-approve")) return json(200, { approved: 11, results: [] });
    return null;
  });
  const { container } = mount();
  await screen.findAllByText("Ish 0");
  selectAll(container);
  fireEvent.click(screen.getByRole("button", { name: "Tanlanganlarni tasdiqlash" }));
  const dlg = await screen.findByRole("dialog", { name: "Tanlangan ishlarni tasdiqlash" });
  fireEvent.change(within(dlg).getByLabelText("Sabab"), { target: { value: "Hammasi ko'rildi" } });
  const go = within(dlg).getByRole("button", { name: "Tasdiqlash" }) as HTMLButtonElement;
  assert.equal(go.disabled, true);
  fireEvent.change(within(dlg).getByLabelText(/deb yozing/), { target: { value: "11" } });
  assert.equal(go.disabled, false);
  fireEvent.click(go);
  await waitFor(() => assert.ok(calls.some((c) => c.path.endsWith("/bulk-approve"))));
  const post = calls.find((c) => c.path.endsWith("/bulk-approve"))!;
  assert.equal((post.body!.ids as string[]).length, 11);
  assert.equal(post.body!.reason, "Hammasi ko'rildi");
  assert.ok(ID2, "fixture id kept for the single-item tests");
});

test("sales tab: the server's numbers; the CSV button needs finance.export", async () => {
  const calls = stub();
  mount("owner", "tab=sales");
  await screen.findByText("Tushum");
  const body = document.body.textContent ?? "";
  assert.match(body, /4\s000/);
  assert.match(body, /10/);
  assert.ok(screen.getAllByText("Eng ko'p sotilgan 10 ish").length > 0);
  assert.ok(screen.getByRole("button", { name: "CSV" }));
  assert.equal(calls.find((c) => c.path.endsWith("/stats"))!.search.get("days"), "30");
  cleanup();
  stub();
  mount("viewer", "tab=sales");
  await screen.findByText("Tushum");
  assert.ok(!screen.queryByRole("button", { name: "CSV" }));
});

test("settings tab: the link to the Bozor tab, the note about pg_trgm, the percent dialog", async () => {
  const calls = stub();
  mount("owner", "tab=settings");
  const link = (await screen.findByText("«Bozor» sozlamalari")) as HTMLAnchorElement;
  assert.ok(link.getAttribute("href")!.endsWith("/admin/settings?tab=market"));
  await screen.findByText(/pg_trgm: yo'q/);
  fireEvent.click((await screen.findAllByRole("button", { name: "O'zgartirish" }))[0]!);
  const dlg = await screen.findByRole("dialog", { name: "Ulush — Insho" });
  fireEvent.change(within(dlg).getByLabelText(/Ulush, %/), { target: { value: "5" } });
  fireEvent.change(within(dlg).getByLabelText("Sabab"), { target: { value: "Insho arzonroq bo'lsin" } });
  const go = within(dlg).getByRole("button", { name: "Qo'llash" }) as HTMLButtonElement;
  assert.equal(go.disabled, true, "below 10 %");
  fireEvent.change(within(dlg).getByLabelText(/Ulush, %/), { target: { value: "40" } });
  fireEvent.click(go);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "PUT")));
  const put = calls.find((c) => c.method === "PUT")!;
  assert.ok(put.path.endsWith("/tool-pricing/essay"));
  assert.deepEqual(put.body, { percent: 40, reason: "Insho arzonroq bo'lsin" });
});

test("403 on the page shows only the forbidden state", async () => {
  stub((c) => (c.path.endsWith("/overview") ? json(403, { error: "Ruxsat yo'q", code: "forbidden" }) : null));
  const { container } = mount("viewer");
  await waitFor(() => assert.ok(!screen.queryByRole("tablist")));
  assert.ok(!container.querySelector("table"));
});

test("piiPlace and rejectReasonText read for people", () => {
  assert.equal(piiPlace("slides.4.notes"), "5-slayd");
  assert.equal(piiPlace("sections.0.title"), "1-bo'lim");
  assert.equal(piiPlace("meta.topic"), "meta.topic");
  assert.equal(rejectReasonText("sanitize_error: TypeError"), "Tozalashda xato: TypeError");
  assert.equal(rejectReasonText("copyright"), "Mualliflik huquqi");
  assert.equal(rejectReasonText(null), "—");
});
