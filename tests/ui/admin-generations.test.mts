import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { GenerationsTable } from "../../components/admin/generations/GenerationsTable.tsx";
import { GenerationDetail } from "../../components/admin/generations/GenerationDetail.tsx";
import { filtersFromParams, filtersToSearch } from "../../components/admin/generations/GenerationsTable.tsx";

/**
 * S6 / S7 screens (docs/admin/02-plan.md §7.0, §7.1): loading, empty (with
 * "Filtrlarni tozalash"), error (request id + retry), forbidden; filters write
 * the URL (page) or stay local (embedded, user pinned); paging sends the
 * cursor; the export asks for step-up first; detail actions appear only in
 * the allowed state and role, and a refund refetches the detail; the input
 * reveal calls `reveal=1`.
 *
 * Module state (identity context, step-up handler, toasts) is read through
 * `require`, the same instances the components load under tsx.
 */
const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

const realFetch = globalThis.fetch;
const realClick = window.HTMLAnchorElement.prototype.click;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
const realReplaceState = window.history.replaceState;
afterEach(() => {
  window.history.replaceState = realReplaceState;
  cleanup();
  globalThis.fetch = realFetch;
  window.HTMLAnchorElement.prototype.click = realClick;
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
  core.setStepUpHandler(null);
  useToastStore.getState().clear();
});

const PERMS = {
  owner: ["jobs.view", "jobs.input", "jobs.export", "jobs.cancel", "jobs.refund"],
  support: ["jobs.view", "jobs.input", "jobs.cancel", "jobs.refund"],
  finance: ["jobs.view", "jobs.export", "jobs.refund"],
  viewer: ["jobs.view"],
} as const;
type Role = keyof typeof PERMS;

const TOOLS = [
  { value: "referat", label: "Referat" },
  { value: "slide", label: "Slayd" },
];

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; init: RequestInit };
/** Each call takes the next responder; a responder may return a never-settling promise (loading). */
function stubFetch(responders: Array<(c: Call) => Response | Promise<Response>>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), init };
    calls.push(c);
    const next = responders[calls.length - 1];
    assert.ok(next, `kutilmagan ${calls.length}-so'rov: ${String(url)}`);
    return next(c);
  }) as typeof fetch;
  return calls;
}
const qs = (c: Call) => new URL(c.url, "http://localhost").searchParams;

/** `replace` records the page's URL writes (`history.replaceState`) and any `router.replace`. */
type RouterCalls = { replace: string[]; push: string[] };
function makeRouter(): { router: AppRouterInstance; calls: RouterCalls } {
  const calls: RouterCalls = { replace: [], push: [] };
  window.history.replaceState = (_data: unknown, _unused: string, url?: string | URL | null) => {
    calls.replace.push(String(url));
  };
  return {
    calls,
    router: {
      back() {},
      forward() {},
      refresh() {},
      prefetch() {},
      push: (href: string) => void calls.push.push(href),
      replace: (href: string) => void calls.replace.push(href),
    },
  };
}

function mount(node: ReactNode, opts: { role?: Role; search?: string; pathname?: string } = {}) {
  const { router, calls } = makeRouter();
  const role = opts.role ?? "owner";
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(
        PathnameContext.Provider,
        { value: opts.pathname ?? "/admin/generations" },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(opts.search ?? "") },
          h(AdminIdentityProvider, { value: { role, permissions: PERMS[role], name: "Admin", username: null }, children: node }),
        ),
      ),
    ),
  );
  return calls;
}

const ID = "3fa1c2d4-5b6e-4f70-8a91-b2c3d4e5f607";
const ITEM = {
  id: ID,
  userId: "7",
  userName: "Ali Valiyev",
  toolId: "referat",
  topic: "Iqtisodiyot asoslari",
  status: "FAILED",
  price: 1000,
  progress: 100,
  attempts: 2,
  error: "Provayder javob bermadi",
  createdAt: "2026-10-01T05:00:00.000Z",
  startedAt: "2026-10-01T05:00:10.000Z",
  finishedAt: "2026-10-01T05:02:10.000Z",
  durationSec: 120,
  charged: { points: 200, quota: 0, balance: 800 },
  refunded: false,
  costUsd: 0.0123,
  filesPurged: false,
  stuck: false,
};
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, nextCursor: null, total: items.length, totalCapped: false, ...extra });

/* ───────────────────────────── URL codec ───────────────────────────── */

test("filters ↔ URL: round trip, defaults omitted, junk dropped", () => {
  const f = filtersFromParams(new URLSearchParams("status=FAILED,BOGUS,FAILED&tool=slide&userId=7&from=2026-09-01&to=2026-09-30&stuck=1&sort=duration_desc"), TOOLS);
  assert.deepEqual(f.status, ["FAILED"]);
  assert.equal(f.tool, "slide");
  assert.equal(filtersToSearch(f), "status=FAILED&tool=slide&userId=7&from=2026-09-01&to=2026-09-30&stuck=1&sort=duration_desc");
  const junk = filtersFromParams(new URLSearchParams("tool=nope&userId=1e3&from=2026-02-30&to=2026-03-01&sort=x&hasError=yes"), TOOLS);
  assert.equal(filtersToSearch(junk), "");
});

/* ───────────────────────────── list states ───────────────────────────── */

test("list: skeleton while loading, then rows with tool label, status, money and cost", async () => {
  let release: (r: Response) => void = () => {};
  const calls = stubFetch([() => new Promise<Response>((res) => (release = res))]);
  const { container } = { container: document.body };
  mount(h(GenerationsTable, { tools: TOOLS }));
  assert.ok(container.querySelector("[data-skeleton-row]"), "skeleton rows");
  assert.equal(calls[0].url, "/api/admin/generations?limit=50");
  release(json(200, page([ITEM])));
  const row = await waitFor(() => {
    const r = container.querySelector(`tr[data-row-key="${ID}"]`);
    assert.ok(r);
    return r as HTMLElement;
  });
  const cells = within(row);
  assert.ok(cells.getByText("Iqtisodiyot asoslari"));
  assert.ok(cells.getByText("Referat"));
  assert.ok(cells.getByText("Xato"));
  assert.ok(cells.getByText("Yo'q"), "FAILED + charged + not refunded");
  assert.ok(cells.getByText("$0,0123"));
  assert.ok(cells.getByText("3fa1c2d4"));
  assert.ok(screen.getByText("1 ta natija"));
});

test("list: empty with filters offers 'Filtrlarni tozalash', which resets the URL", async () => {
  stubFetch([(c) => (assert.equal(qs(c).get("status"), "FAILED"), json(200, page([])))]);
  const router = mount(h(GenerationsTable, { tools: TOOLS }), { search: "status=FAILED" });
  await screen.findByText("Generatsiya topilmadi");
  const clear = screen.getAllByRole("button", { name: "Filtrlarni tozalash" });
  fireEvent.click(clear[clear.length - 1]);
  assert.deepEqual(router.replace, ["/admin/generations"]);
});

test("list: error shows the request id; retry refetches", async () => {
  const calls = stubFetch([
    () => json(500, { error: "Server xatosi", requestId: "req-123" }),
    () => json(200, page([ITEM])),
  ]);
  mount(h(GenerationsTable, { tools: TOOLS }));
  await screen.findByText("req-123");
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await screen.findByText("Iqtisodiyot asoslari", { selector: "tr span" });
  assert.equal(calls.length, 2);
});

test("list: 403 renders Forbidden", async () => {
  stubFetch([() => json(403, { error: "Ruxsat yo'q", code: "forbidden" })]);
  mount(h(GenerationsTable, { tools: TOOLS }));
  await screen.findByText("Ruxsat yo'q");
});

test("list: filters write the URL (page mode) and reset paging", async () => {
  stubFetch([() => json(200, page([ITEM]))]);
  const router = mount(h(GenerationsTable, { tools: TOOLS }), { search: "tool=slide" });
  await screen.findByText("Iqtisodiyot asoslari", { selector: "tr span" });
  fireEvent.click(screen.getByRole("button", { name: "Xato bor" }));
  fireEvent.click(screen.getByRole("button", { name: "Osilib qolgan" }));
  fireEvent.change(screen.getByLabelText("Saralash"), { target: { value: "duration_desc" } });
  assert.deepEqual(router.replace, [
    "/admin/generations?tool=slide&hasError=1",
    "/admin/generations?tool=slide&stuck=1",
    "/admin/generations?tool=slide&sort=duration_desc",
  ]);
});

test("list: 'Keyingi' sends the cursor; a row click opens the detail", async () => {
  const calls = stubFetch([
    () => json(200, page([ITEM], { nextCursor: "CUR1", total: 2 })),
    (c) => (assert.equal(qs(c).get("cursor"), "CUR1"), json(200, page([{ ...ITEM, id: "aaaaaaaa-5b6e-4f70-8a91-b2c3d4e5f607" }], { total: 2 }))),
  ]);
  const router = mount(h(GenerationsTable, { tools: TOOLS }));
  await screen.findByText("2 ta natija");
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.ok(document.querySelector('tr[data-row-key="aaaaaaaa-5b6e-4f70-8a91-b2c3d4e5f607"]')));
  assert.equal(calls.length, 2);
  fireEvent.click(document.querySelector('tr[data-row-key="aaaaaaaa-5b6e-4f70-8a91-b2c3d4e5f607"] td')!);
  assert.deepEqual(router.push, ["/admin/generations/aaaaaaaa-5b6e-4f70-8a91-b2c3d4e5f607"]);
});

test("embedded + fixed user: user pinned in every request, no user column, filters stay local", async () => {
  const calls = stubFetch([
    (c) => (assert.equal(qs(c).get("userId"), "7"), json(200, page([ITEM]))),
    (c) => {
      assert.equal(qs(c).get("userId"), "7");
      assert.equal(qs(c).get("unrefunded"), "1");
      return json(200, page([ITEM]));
    },
  ]);
  const router = mount(h(GenerationsTable, { tools: TOOLS, embedded: true, fixedFilters: { userId: "7" } }), { pathname: "/admin/users/7" });
  await screen.findByText("Iqtisodiyot asoslari", { selector: "tr span" });
  assert.ok(!screen.queryByRole("columnheader", { name: "Foydalanuvchi" }), "user column hidden");
  assert.ok(!screen.queryByPlaceholderText("Foydalanuvchi ID"), "user filter hidden");
  fireEvent.click(screen.getByRole("button", { name: "Qaytarilmagan" }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(router.replace, [], "embedded never touches the page URL");
});

test("a filter change drops the cursor: page one of the new filter set", async () => {
  const calls = stubFetch([
    () => json(200, page([ITEM], { nextCursor: "CUR1", total: 2 })),
    (c) => (assert.equal(qs(c).get("cursor"), "CUR1"), json(200, page([ITEM], { total: 2 }))),
    (c) => {
      assert.equal(qs(c).get("cursor"), null, "no stale cursor");
      assert.equal(qs(c).get("hasError"), "1");
      return json(200, page([ITEM]));
    },
  ]);
  mount(h(GenerationsTable, { tools: TOOLS, embedded: true }));
  await screen.findByText("2 ta natija");
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => assert.equal(calls.length, 2));
  await waitFor(() => assert.equal((screen.getByRole("button", { name: "Oldingi" }) as HTMLButtonElement).disabled, false));
  fireEvent.click(screen.getByRole("button", { name: "Xato bor" }));
  await waitFor(() => assert.equal(calls.length, 3));
  await screen.findByText("1 ta natija");
  assert.equal((screen.getByRole("button", { name: "Oldingi" }) as HTMLButtonElement).disabled, true, "the pager stack is reset too");
});

/* ───────────────────────────── export ───────────────────────────── */

/**
 * Exports go through `adminDownload` (fetch → blob → object URL); jsdom has no
 * `URL.createObjectURL`, so it is stubbed and the saved file names are recorded.
 */
function captureDownloads(): string[] {
  const saved: string[] = [];
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push(this.download);
  };
  return saved;
}

const csv = (name: string) =>
  new Response('\uFEFF"ID"\r\n', { status: 200, headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="${name}"` } });
const reauth = () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" });

test("export: fresh step-up downloads the CSV with the current filters", async () => {
  const saved = captureDownloads();
  const calls = stubFetch([() => json(200, page([ITEM])), () => csv("generatsiyalar-2026-10-02.csv")]);
  mount(h(GenerationsTable, { tools: TOOLS }), { search: "status=FAILED&unrefunded=1" });
  await screen.findByText("Iqtisodiyot asoslari", { selector: "tr span" });
  fireEvent.click(screen.getByRole("button", { name: "CSV eksport" }));
  await waitFor(() => assert.equal(saved.length, 1));
  assert.equal(saved[0], "generatsiyalar-2026-10-02.csv", "saved under the server's name");
  assert.equal(calls[1]!.url, "/api/admin/generations/export?status=FAILED&unrefunded=1");
});

test("export: stale step-up (401 reauth) opens the dialog; cancelling downloads nothing, confirming retries once", async () => {
  const saved = captureDownloads();
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return asked > 1;
  });
  const calls = stubFetch([() => json(200, page([ITEM])), reauth, reauth, () => csv("generatsiyalar-2026-10-02.csv")]);
  mount(h(GenerationsTable, { tools: TOOLS }));
  await screen.findByText("Iqtisodiyot asoslari", { selector: "tr span" });
  fireEvent.click(screen.getByRole("button", { name: "CSV eksport" }));
  await waitFor(() => assert.equal(asked, 1));
  await waitFor(() => assert.equal((screen.getByRole("button", { name: "CSV eksport" }) as HTMLButtonElement).disabled, false));
  assert.equal(saved.length, 0, "cancelled step-up: no download");
  fireEvent.click(screen.getByRole("button", { name: "CSV eksport" }));
  await waitFor(() => assert.equal(saved.length, 1));
  assert.equal(asked, 2);
  assert.equal(calls.length, 4, "one export request per click plus exactly one retry");
  assert.equal(calls[3]!.url, "/api/admin/generations/export");
});

test("export button is hidden without jobs.export", async () => {
  stubFetch([() => json(200, page([ITEM]))]);
  mount(h(GenerationsTable, { tools: TOOLS }), { role: "support" });
  await screen.findByText("Iqtisodiyot asoslari", { selector: "tr span" });
  assert.ok(!screen.queryByRole("button", { name: "CSV eksport" }));
});

/* ───────────────────────────── detail ───────────────────────────── */

const DETAIL = {
  ...ITEM,
  userUsername: "ali",
  format: "docx",
  step: "Xatolik",
  runAfter: ITEM.createdAt,
  expiresAt: null,
  budgetMs: 60_000,
  lockedBy: null,
  lockedAt: null,
  delivered: null,
  cost: { usd: 0.0123, parts: [{ kind: "llm", provider: "gemini", model: "gemini-flash", calls: 2, inputTokens: 1000, outputTokens: 500, units: 0, usd: 0.0123, outcome: "failed" }] },
  docVersion: 0,
  fileVersion: 0,
  editedAt: null,
  filesPurgedAt: null,
  hasFile: false,
  fileName: null,
  fileMime: null,
  fileSize: null,
  downloads: null,
  inputs: { topic: "Iqtisodiyot asoslari", author: "•••" },
  inputsRevealed: false,
};
const LEDGER = [{ id: "1", kind: "charge", points: -200, quota: 0, balance: -800, note: "referat: x", createdAt: ITEM.createdAt }];
const detailBody = (g: Record<string, unknown> = {}, ledger: unknown[] = LEDGER) => ({ generation: { ...DETAIL, ...g }, ledger, gameLinks: 0 });

test("detail: skeleton, then masked inputs, cost parts, ledger; refund only for FAILED + unrefunded with jobs.refund", async () => {
  let release: (r: Response) => void = () => {};
  stubFetch([() => new Promise<Response>((res) => (release = res))]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }), { role: "finance" });
  assert.ok(document.querySelector('[aria-busy="true"]'), "skeleton");
  release(json(200, detailBody()));
  await screen.findByRole("heading", { name: "Referat" });
  assert.ok(screen.getByText(/"author": "•••"/), "masked inputs");
  assert.ok(screen.getByText("Yashirilgan"), "finance lacks jobs.input: no reveal button");
  assert.ok(screen.getAllByText("gemini · gemini-flash").length > 0);
  assert.ok(screen.getAllByText("Yechildi").length > 0);
  assert.ok(screen.getByRole("button", { name: "Pulni qaytarish" }));
  assert.ok(!screen.queryByRole("button", { name: "Bekor qilish" }));
  assert.ok(!screen.queryByRole("button", { name: "To'xtatish" }));
  assert.ok(!screen.queryByText("Faylni yuklab olish (audit)"));
});

test("detail: refund flow → POST with Idempotency-Key and reason, then the detail is refetched", async () => {
  const calls = stubFetch([
    () => json(200, detailBody()),
    (c) => (assert.equal(c.url, `/api/admin/generations/${ID}/refund`), json(200, { refunded: { points: 200, quota: 0, balance: 800 } })),
    () => json(200, detailBody({ refunded: true }, [...LEDGER, { id: "2", kind: "refund", points: 200, quota: 0, balance: 800, note: "Ma'muriy qaytarish", createdAt: ITEM.finishedAt }])),
  ]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }), { role: "support" });
  fireEvent.click(await screen.findByRole("button", { name: "Pulni qaytarish" }));
  fireEvent.change(screen.getByLabelText("Sabab"), { target: { value: "Provayder xatosi" } });
  fireEvent.click(screen.getByRole("button", { name: "Qaytarish" }));
  await waitFor(() => assert.equal(calls.length, 3));
  assert.match(new Headers(calls[1].init.headers as HeadersInit).get("idempotency-key") ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { reason: "Provayder xatosi" });
  await waitFor(() => assert.ok(!screen.queryByRole("button", { name: "Pulni qaytarish" })));
  assert.ok(screen.getByText(/Pul qaytarildi/));
});

test("detail: cancel only for QUEUED with jobs.cancel; force-stop only for a stuck IN_PROGRESS job", async () => {
  stubFetch([() => json(200, detailBody({ status: "QUEUED", error: null, finishedAt: null, startedAt: null, durationSec: null }))]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }), { role: "support" });
  assert.ok(await screen.findByRole("button", { name: "Bekor qilish" }));
  cleanup();

  stubFetch([() => json(200, detailBody({ status: "QUEUED", error: null }))]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }), { role: "viewer" });
  await screen.findByRole("heading", { name: "Referat" });
  assert.ok(!screen.queryByRole("button", { name: "Bekor qilish" }), "viewer has no jobs.cancel");
  cleanup();

  stubFetch([() => json(200, detailBody({ status: "IN_PROGRESS", stuck: false, lockedBy: "w-1", lockedAt: ITEM.startedAt }))]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }), { role: "owner" });
  await screen.findByRole("heading", { name: "Referat" });
  assert.ok(!screen.queryByRole("button", { name: "To'xtatish" }), "healthy job: no force-stop");
  cleanup();

  stubFetch([() => json(200, detailBody({ status: "IN_PROGRESS", stuck: true, lockedBy: "w-1", lockedAt: ITEM.startedAt }))]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }), { role: "owner" });
  assert.ok(await screen.findByRole("button", { name: "To'xtatish" }));
  assert.ok(screen.getByText(/budjet/), "stuck notice");
});

test("detail: 'Ko'rsatish (audit)' refetches with reveal=1 and shows the raw inputs", async () => {
  const calls = stubFetch([
    () => json(200, detailBody({ hasFile: true, fileName: "a.docx", fileSize: 2048, downloads: 1 })),
    (c) => (assert.equal(qs(c).get("reveal"), "1"), json(200, detailBody({ inputs: { topic: "Iqtisodiyot asoslari", author: "Ali Valiyev" }, inputsRevealed: true }))),
  ]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }), { role: "support" });
  const link = (await screen.findByText("Faylni yuklab olish (audit)")).closest("a")!;
  assert.equal(link.getAttribute("href"), `/api/admin/generations/${ID}/file`);
  fireEvent.click(screen.getByRole("button", { name: "Ko'rsatish (audit)" }));
  await screen.findByText(/"author": "Ali Valiyev"/);
  assert.ok(screen.getByText("Ochiq ko'rsatilmoqda"));
  assert.equal(calls.length, 2);
});

test("detail: 404 → not found, 403 → Forbidden, 500 → request id with retry", async () => {
  stubFetch([() => json(404, { error: "Topilmadi", code: "not_found" })]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }));
  await screen.findByText("Generatsiya topilmadi");
  cleanup();

  stubFetch([() => json(403, { error: "Ruxsat yo'q", code: "forbidden" })]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }));
  await screen.findByText("Ruxsat yo'q");
  cleanup();

  const calls = stubFetch([() => json(500, { error: "Xato", requestId: "req-9" }), () => json(200, detailBody())]);
  mount(h(GenerationDetail, { id: ID, tools: TOOLS }));
  await screen.findByText("req-9");
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await screen.findByRole("heading", { name: "Referat" });
  assert.equal(calls.length, 2);
});
