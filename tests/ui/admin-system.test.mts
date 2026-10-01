import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { ErrorDetail, ErrorItem, SystemStatus } from "../../lib/admin-api/system.ts";
import { SystemPage } from "../../components/admin/system/SystemPage.tsx";
import { ErrorsPage } from "../../components/admin/errors/ErrorsPage.tsx";
import { AdminIdentityProvider } from "../../components/admin/shell/admin-identity.tsx";
import { useToastStore } from "../../components/admin/ui/Toaster.tsx";
import { activeFilterCount, parseFilters, parseOpenId, toApiParams } from "../../components/admin/errors/shared.ts";

/**
 * S15 `/admin/system` and S16 `/admin/errors` (docs/admin/02-plan.md §7.0, §7.1):
 *   - system: the four states, DB / migrations / queue tiles, processes with the
 *     stale badge, housekeeping with the last error, config messages (never values);
 *   - errors: the four states, filters and the open drawer live in the URL, a changed
 *     filter aborts the pending request and resets the cursor, row → drawer with the
 *     stack in a monospace scroll box, single and bulk resolve (typed confirmation,
 *     ≤ 100 ids), no resolve controls without `errors.resolve`.
 */

const realFetch = globalThis.fetch;
/** The Toaster is mounted by the admin layout, not by the pages: read the store the pages push to. */
const toastTexts = () => useToastStore.getState().toasts.map((t) => t.message);
afterEach(() => {
  cleanup();
  useToastStore.getState().clear();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: URL; method: string; body: unknown; signal: AbortSignal | null | undefined };
function stubFetch(handler: (call: Call, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(String(input), "http://localhost"),
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      signal: init.signal,
    };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return calls;
}

const OWNER = ["system.view", "errors.view", "errors.resolve"];
const VIEWER = ["system.view", "errors.view"];

/** `children` goes in the props: the provider's prop type requires it. */
const withIdentity = (permissions: string[], children: ReactNode) =>
  h(AdminIdentityProvider, { value: { role: "owner", permissions, name: "Test", username: null }, children });

function renderAt(pathname: string, query: string, page: () => ReactNode, permissions: string[] = OWNER) {
  const calls = { replace: [] as string[] };
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push() {},
    replace: (href: string) => void calls.replace.push(href),
  };
  const node: ReactNode = withIdentity(
    permissions,
    h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: pathname }, h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, page()))),
  );
  return { ...render(node), calls, node };
}

// ───────────────────────────── system

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function systemBody(over: Partial<SystemStatus> = {}): SystemStatus {
  return {
    db: { ok: true, latencyMs: 4, migrations: { applied: 33, latest: 33, lastApplied: "033_ai_usage.sql" } },
    queue: { queued: 3, running: 2, oldestQueuedSec: 125 },
    processes: [
      { process: "worker@host-a:11", role: "worker", hostname: "host-a", startedAt: iso(3 * 3_600_000), lastSeenAt: iso(5_000), running: 3, concurrency: 4, stale: false },
      { process: "web@host-b:22", role: "web", hostname: "host-b", startedAt: iso(3 * 3_600_000), lastSeenAt: iso(600_000), running: 0, concurrency: 0, stale: true },
    ],
    housekeeping: [
      { step: "purgeOldSources", lastRunAt: iso(40_000), lastOkAt: iso(40_000), lastErrorAt: null, lastError: null, lastRows: 7, runs: 12, failures: 0, lastProcess: "worker@host-a:11" },
      {
        step: "refundUnrefundedFailed",
        lastRunAt: iso(30_000),
        lastOkAt: iso(7_200_000),
        lastErrorAt: iso(30_000),
        lastError: "lock timeout on generations",
        lastRows: 1,
        runs: 20,
        failures: 3,
        lastProcess: "worker@host-b:12",
      },
    ],
    config: { problems: ["NEXT_PUBLIC_TELEGRAM_BOT yo'q — kirish havolasi qurilmaydi"], warnings: ["TTS kaliti yo'q — podkast ishlamaydi"] },
    version: "1.0.0",
    nodeEnv: "production",
    ...over,
  };
}

const renderSystem = (permissions?: string[]) => renderAt("/admin/system", "", () => h(SystemPage), permissions);

test("system: loading skeleton, then tiles, processes, housekeeping and config", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls = stubFetch(async () => {
    await gate;
    return json(200, systemBody());
  });
  const { container } = renderSystem();
  assert.ok(container.querySelector('[aria-busy="true"]'), "loading skeleton");
  release();
  await screen.findByText("Ulangan");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/admin/system");
  assert.ok(calls[0].signal, "the request carries an AbortSignal");

  const body = container.textContent ?? "";
  assert.match(body, /4 ms/);
  assert.match(body, /33 \/ 33/);
  assert.match(body, /033_ai_usage\.sql/);
  assert.match(body, /eng eskisi: 2 daq 05 s/);
  assert.match(body, /1\.0\.0/);
  assert.match(body, /production/);

  // Processes: stale badge only on the silent one.
  const stale = container.querySelector('tr[data-row-key="web@host-b:22"]')!;
  const fresh = container.querySelector('tr[data-row-key="worker@host-a:11"]')!;
  assert.ok(within(stale as HTMLElement).getByText("Eskirgan"));
  assert.ok(!within(fresh as HTMLElement).queryByText("Eskirgan"));
  assert.ok(within(fresh as HTMLElement).getByText("Faol"));
  assert.match(fresh.textContent ?? "", /3 \/ 4/);
  assert.match(screen.getByText(/1 ta eskirgan/).textContent ?? "", /1 ta eskirgan/);

  // Housekeeping: the failing step is flagged and shows its last error.
  const failing = container.querySelector('tr[data-row-key="refundUnrefundedFailed"]')!;
  assert.ok(within(failing as HTMLElement).getByText("Xato"));
  assert.ok(within(failing as HTMLElement).getByText("lock timeout on generations"));
  const healthy = container.querySelector('tr[data-row-key="purgeOldSources"]')!;
  assert.ok(!within(healthy as HTMLElement).queryByText("Xato"));

  // Config: problem (alert) and warning, as text.
  assert.match(container.querySelector('[data-config="problem"]')!.textContent ?? "", /NEXT_PUBLIC_TELEGRAM_BOT yo'q/);
  assert.match(container.querySelector('[data-config="warning"]')!.textContent ?? "", /TTS kaliti yo'q/);
  assert.ok(!container.querySelector('[data-config="clean"]'));
});

test("system: clean config, DB down, pending migrations and an idle system render their own states", async () => {
  stubFetch(() =>
    json(
      200,
      systemBody({
        db: { ok: false, latencyMs: null, migrations: { applied: 30, latest: 33, lastApplied: "030_admin_indexes.sql" } },
        queue: { queued: 0, running: 0, oldestQueuedSec: null },
        processes: [],
        housekeeping: [],
        config: { problems: [], warnings: [] },
      }),
    ),
  );
  const { container } = renderSystem(VIEWER);
  await screen.findByText("Ulanmagan");
  const body = container.textContent ?? "";
  assert.match(body, /javob yo'q/);
  assert.match(body, /30 \/ 33/);
  assert.match(body, /kutilayotgan migratsiya bor/);
  assert.match(body, /navbat bo'sh/);
  assert.ok(screen.getByText("Jarayonlardan signal kelmagan"));
  assert.ok(screen.getByText("Fon vazifalari hali ishga tushmagan"));
  assert.ok(container.querySelector('[data-config="clean"]'));
  assert.ok(!container.querySelector('[data-config="problem"]'));
});

test("system: error shows the message and requestId; retry reloads", async () => {
  let n = 0;
  stubFetch(() => {
    n += 1;
    return n === 1 ? json(500, { error: "Ichki xatolik", requestId: "req-sys-7" }) : json(200, systemBody());
  });
  renderSystem();
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /Ichki xatolik/);
  assert.match(alert.textContent ?? "", /req-sys-7/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await screen.findByText("Ulangan");
  assert.ok(!screen.queryByText("Ichki xatolik"), "the error state is gone after a successful retry");
});

test("system: 403 renders the forbidden state without data; the refresh button reloads", async () => {
  stubFetch(() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }));
  renderSystem();
  await screen.findByText("Ruxsat yo'q");
  assert.ok(!screen.queryByText("Ulangan"));
  cleanup();

  const calls = stubFetch(() => json(200, systemBody()));
  renderSystem();
  await screen.findByText("Ulangan");
  fireEvent.click(screen.getByRole("button", { name: "Yangilash" }));
  await waitFor(() => assert.equal(calls.length, 2));
});

// ───────────────────────────── errors

function errorItem(over: Partial<ErrorItem> & { id: string }): ErrorItem {
  return {
    fingerprint: `fp-${over.id}`,
    firstSeenAt: iso(86_400_000),
    lastSeenAt: iso(60_000),
    count: 4,
    level: "error",
    scope: "pdf",
    message: `[pdf] converter exploded ${over.id}`,
    requestId: null,
    userId: null,
    jobId: null,
    path: "/api/pdf",
    process: "web@host-b:22",
    resolvedAt: null,
    resolvedBy: null,
    ...over,
  };
}

const ITEMS: ErrorItem[] = [
  errorItem({ id: "30", scope: "pdf", level: "error", count: 14, message: "[pdf] soffice timeout after 90000ms" }),
  errorItem({ id: "29", scope: "llm", level: "warn", count: 41, message: "[llm] chain fallback used", path: null }),
  errorItem({ id: "28", scope: "payments", level: "error", resolvedAt: iso(30_000), resolvedBy: "7", message: "[payments] amount mismatch" }),
];

const STACK = "Error: soffice timeout\n    at convert (lib/generation/pdf.ts:12:3)\n    at async run (worker.ts:88:5)";

function detailOf(item: ErrorItem, over: Partial<ErrorDetail> = {}): ErrorDetail {
  return { ...item, stack: STACK, ...over };
}

type ListBody = { items: ErrorItem[]; nextCursor: string | null; total: number | null; totalCapped: boolean };
const listBody = (over: Partial<ListBody> = {}): ListBody => ({ items: ITEMS, nextCursor: null, total: ITEMS.length, totalCapped: false, ...over });

const renderErrors = (query = "", permissions?: string[]) => renderAt("/admin/errors", query, () => h(ErrorsPage), permissions);

/** Answers list, detail, single and bulk resolve like the API does. */
function errorsApi(over: { list?: (c: Call) => Response } = {}) {
  // Resolutions are remembered, so a re-read of the detail shows the row as resolved.
  const done = new Set<string>();
  return (c: Call): Response => {
    const path = c.url.pathname;
    if (path === "/api/admin/errors" && c.method === "GET") return over.list ? over.list(c) : json(200, listBody());
    if (path === "/api/admin/errors/resolve" && c.method === "POST") {
      const ids = (c.body as { ids: string[] }).ids;
      for (const id of ids) done.add(id);
      return json(200, { resolved: ids.length });
    }
    const m = /^\/api\/admin\/errors\/(\d+)(\/resolve)?$/.exec(path);
    if (m) {
      const item = ITEMS.find((i) => i.id === m[1])!;
      if (m[2]) done.add(item.id);
      return json(200, { error: detailOf(done.has(item.id) ? { ...item, resolvedAt: new Date().toISOString(), resolvedBy: "1" } : item) });
    }
    return json(404, { error: "Topilmadi" });
  };
}

test("errors: loading skeleton, then the table with level, scope, message, path, process and status", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls = stubFetch(async (c) => {
    await gate;
    return errorsApi()(c);
  });
  const { container } = renderErrors();
  assert.ok(container.querySelector("[data-skeleton-row]"), "skeleton rows while loading");
  release();
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");

  // Default view = open errors: resolved=0, limited page, abortable request.
  assert.equal(calls[0].url.searchParams.get("resolved"), "0");
  assert.equal(calls[0].url.searchParams.get("limit"), "50");
  assert.ok(calls[0].signal);
  assert.deepEqual([...container.querySelectorAll("tr[data-row-key]")].map((r) => r.getAttribute("data-row-key")), ["30", "29", "28"]);
  const row = container.querySelector('tr[data-row-key="30"]')!;
  assert.match(row.textContent ?? "", /14/);
  assert.match(row.textContent ?? "", /error/);
  assert.match(row.textContent ?? "", /Ochiq/);
  assert.match(container.querySelector('tr[data-row-key="28"]')!.textContent ?? "", /Hal qilingan/);
  assert.match(container.textContent ?? "", /3 ta natija/);
  // The list never shows a stack.
  assert.ok(!container.textContent?.includes("at convert"));
});

test("errors: filters live in the URL; the scope chip filters; clear resets everything", async () => {
  stubFetch(errorsApi());
  const { calls, container } = renderErrors();
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");

  fireEvent.click(screen.getByRole("radio", { name: "Hal qilingan" }));
  assert.equal(calls.replace.at(-1), "/admin/errors?resolved=1");
  fireEvent.click(screen.getByRole("radio", { name: "Hammasi" }));
  assert.equal(calls.replace.at(-1), "/admin/errors?resolved=all");
  fireEvent.click(screen.getByRole("radio", { name: "Ochiq" }));
  assert.equal(calls.replace.at(-1), "/admin/errors", "the default view drops the param");

  fireEvent.change(screen.getByLabelText("Daraja"), { target: { value: "warn" } });
  assert.equal(calls.replace.at(-1), "/admin/errors?level=warn");

  // Clicking the scope in a row filters by it (and does not open the drawer).
  fireEvent.click(within(container.querySelector('tr[data-row-key="30"]') as HTMLElement).getByRole("button", { name: "pdf" }));
  assert.equal(calls.replace.at(-1), "/admin/errors?scope=pdf");

  // The period filter starts at 7 days.
  fireEvent.click(screen.getByRole("button", { name: "Sana bo'yicha filtr" }));
  const range = new URL(calls.replace.at(-1)!, "http://localhost");
  assert.ok(range.searchParams.get("from") && range.searchParams.get("to") && range.searchParams.get("from")! < range.searchParams.get("to")!);
  cleanup();

  // With filters set the request carries them all, and "Filtrlarni tozalash" resets the URL.
  const calls2 = stubFetch(errorsApi());
  const withFilters = renderErrors("resolved=1&level=error&scope=pdf&q=%5Bpdf%5D&from=2026-03-01&to=2026-03-07");
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  const u = calls2[0].url.searchParams;
  assert.equal(u.get("resolved"), "1");
  assert.equal(u.get("level"), "error");
  assert.equal(u.get("scope"), "pdf");
  assert.equal(u.get("q"), "[pdf]");
  assert.equal(u.get("from"), "2026-03-01");
  assert.equal(u.get("to"), "2026-03-07");
  fireEvent.click(screen.getAllByRole("button", { name: "Filtrlarni tozalash" })[0]);
  assert.equal(withFilters.calls.replace.at(-1), "/admin/errors");
});

test("errors: unknown / over-long / invalid URL values fall back instead of reaching the API", async () => {
  const calls = stubFetch(errorsApi());
  renderErrors(`level=fatal&resolved=2&scope=${"s".repeat(100)}&q=${"q".repeat(300)}&from=2026-13-01&to=2026-03-07&id=abc`);
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  const u = calls[0].url.searchParams;
  assert.equal(u.get("resolved"), "0");
  assert.equal(u.get("level"), null);
  assert.equal(u.get("scope")!.length, 64);
  assert.equal(u.get("q")!.length, 120);
  assert.equal(u.get("from"), null);
  assert.equal(u.get("to"), null);
  assert.equal(calls.length, 1, "an invalid ?id= opens no drawer and fetches nothing");

  const f = parseFilters(new URLSearchParams("resolved=all&level=warn&from=2026-03-01&to=2025-01-01"));
  assert.equal(f.resolved, "all");
  assert.equal(f.from, "", "a reversed range is dropped");
  assert.equal(toApiParams(f).resolved, undefined);
  assert.equal(activeFilterCount(f), 2);
  assert.equal(parseOpenId(new URLSearchParams("id=123")), "123");
  assert.equal(parseOpenId(new URLSearchParams("id=0")), null);
  assert.equal(parseOpenId(new URLSearchParams("id=1e3")), null);
});

test("errors: changing a filter aborts the pending request", async () => {
  const calls = stubFetch(() => new Promise<Response>(() => {}));
  const first = renderErrors();
  await waitFor(() => assert.equal(calls.length, 1));
  const signal = calls[0].signal;
  assert.ok(signal && !signal.aborted);
  const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} };
  first.rerender(
    withIdentity(
      OWNER,
      h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: "/admin/errors" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("level=warn") }, h(ErrorsPage)))),
    ),
  );
  await waitFor(() => assert.ok(signal.aborted, "stale request aborted"));
  await waitFor(() => assert.equal(calls.at(-1)!.url.searchParams.get("level"), "warn"));
});

test("errors: paging passes the cursor; a filter change returns to the first page", async () => {
  const calls = stubFetch((c) => (c.url.searchParams.get("cursor") ? json(200, listBody({ items: [ITEMS[2]], nextCursor: null, total: 3 })) : json(200, listBody({ items: ITEMS.slice(0, 2), nextCursor: "CUR1", total: 3 }))));
  const { container } = renderErrors();
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  fireEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await screen.findAllByText("[payments] amount mismatch");
  assert.equal(calls.at(-1)!.url.searchParams.get("cursor"), "CUR1");
  assert.deepEqual([...container.querySelectorAll("tr[data-row-key]")].map((r) => r.getAttribute("data-row-key")), ["28"]);
  fireEvent.click(screen.getByRole("button", { name: "Oldingi" }));
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  assert.equal(calls.at(-1)!.url.searchParams.get("cursor"), null, "back to the first page");
});

test("errors: empty — with filters offers to clear them, the default view just says nothing is open", async () => {
  stubFetch(() => json(200, listBody({ items: [], total: 0 })));
  const withFilters = renderErrors("level=warn");
  await screen.findByText("Filtrlarga mos xato topilmadi");
  fireEvent.click(within(screen.getByText("Filtrlarga mos xato topilmadi").closest("div")!.parentElement as HTMLElement).getByRole("button", { name: "Filtrlarni tozalash" }));
  assert.equal(withFilters.calls.replace.at(-1), "/admin/errors");
  cleanup();

  stubFetch(() => json(200, listBody({ items: [], total: 0 })));
  renderErrors();
  await screen.findByText("Ochiq xato yo'q");
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
});

test("errors: error shows the message and requestId, retry loads the data; 403 renders Forbidden", async () => {
  let n = 0;
  const api = errorsApi();
  stubFetch((c) => {
    n += 1;
    return n === 1 ? json(500, { error: "Ichki xatolik", requestId: "req-err-9" }) : api(c);
  });
  renderErrors();
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /req-err-9/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  cleanup();

  stubFetch(() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }));
  renderErrors();
  await screen.findByText("Ruxsat yo'q");
  assert.ok(!screen.queryByText("[pdf] soffice timeout after 90000ms"));
});

test("errors: a row opens the drawer via ?id=; the drawer shows the stack in a monospace scroll box", async () => {
  const calls = stubFetch(errorsApi());
  const { calls: nav, container } = renderErrors();
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  fireEvent.click(container.querySelector('tr[data-row-key="30"]') as HTMLElement);
  assert.equal(nav.replace.at(-1), "/admin/errors?id=30");
  cleanup();

  // The URL carries the open id: the drawer loads the detail.
  const detailCalls = stubFetch(
    errorsApi({}),
  );
  renderErrors("id=30");
  const dialog = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(dialog).findByText(/at convert/);
  assert.ok(detailCalls.some((c) => c.url.pathname === "/api/admin/errors/30"));
  const stack = dialog.querySelector("pre[data-stack]")!;
  assert.equal(stack.textContent, STACK);
  assert.match(stack.className, /font-mono/);
  assert.match(stack.className, /overflow-auto/);
  assert.match(dialog.textContent ?? "", /\[pdf\] soffice timeout after 90000ms/);
  assert.ok(within(dialog).getByRole("button", { name: "Hal qilindi deb belgilash" }));
  assert.ok(calls.length >= 1);
});

test("errors: markup in a message or stack is shown as text, never interpreted", async () => {
  const evil = errorItem({ id: "30", message: "<img src=x onerror=alert(1)> [pdf] boom" });
  stubFetch((c) => {
    if (c.url.pathname === "/api/admin/errors/30") return json(200, { error: detailOf(evil, { stack: "<script>alert(1)</script>" }) });
    return json(200, listBody({ items: [evil], total: 1 }));
  });
  const { container } = renderErrors("id=30");
  const dialog = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(dialog).findByText("<script>alert(1)</script>");
  assert.ok(!container.querySelector("img"), "no element was created from the message");
  assert.ok(!document.querySelector("script[src], img[src]"));
  assert.ok(within(dialog).getAllByText(/<img src=x onerror=alert\(1\)>/).length >= 1);
});

test("errors: single resolve from the drawer — optional reason, request, toast, list refresh", async () => {
  const calls = stubFetch(errorsApi());
  renderErrors("id=30");
  const dialog = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(dialog).findByText(/at convert/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Hal qilindi deb belgilash" }));
  const confirm = await screen.findByRole("dialog", { name: "Xatoni hal qilindi deb belgilash" });
  // The reason is optional: confirm is enabled at once.
  const ok = within(confirm).getByRole("button", { name: "Belgilash" });
  assert.equal((ok as HTMLButtonElement).disabled, false);
  fireEvent.change(within(confirm).getByLabelText(/Izoh/), { target: { value: "soffice yangilandi" } });
  const listsBefore = calls.filter((c) => c.url.pathname === "/api/admin/errors" && c.method === "GET").length;
  fireEvent.click(ok);
  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST" && c.url.pathname === "/api/admin/errors/30/resolve")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.deepEqual(post.body, { reason: "soffice yangilandi" });
  await waitFor(() => assert.ok(toastTexts().includes("Xato hal qilindi deb belgilandi")));
  await waitFor(() => assert.equal(calls.filter((c) => c.url.pathname === "/api/admin/errors" && c.method === "GET").length, listsBefore + 1, "list reloaded"));
  // The drawer now shows the resolved state and no resolve button.
  await waitFor(() => assert.ok(!within(screen.getByRole("dialog", { name: "Xato tafsiloti" })).queryByRole("button", { name: "Hal qilindi deb belgilash" })));
});

test("errors: resolving without a reason sends an empty body; a server error stays inline in the dialog", async () => {
  let fail = true;
  const api = errorsApi();
  const calls = stubFetch((c) => {
    if (c.method === "POST" && fail) return json(500, { error: "Ichki xatolik", requestId: "req-1" });
    return api(c);
  });
  renderErrors("id=30");
  const dialog = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(dialog).findByText(/at convert/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Hal qilindi deb belgilash" }));
  const confirm = await screen.findByRole("dialog", { name: "Xatoni hal qilindi deb belgilash" });
  fireEvent.click(within(confirm).getByRole("button", { name: "Belgilash" }));
  await within(confirm).findByText("Ichki xatolik");
  assert.deepEqual(calls.find((c) => c.method === "POST")!.body, {});
  fail = false;
  fireEvent.click(within(confirm).getByRole("button", { name: "Belgilash" }));
  await waitFor(() => assert.equal(calls.filter((c) => c.method === "POST").length, 2));
});

test("errors: bulk resolve — checkboxes, count in the button, typed confirmation, only open ids are sent", async () => {
  const calls = stubFetch(errorsApi());
  const { container } = renderErrors();
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  const bulk = screen.getByRole("button", { name: /Hal qilindi deb belgilash \(0\)/ }) as HTMLButtonElement;
  assert.equal(bulk.disabled, true, "nothing selected");

  // Select all: the resolved row is ticked too but never counted or sent.
  fireEvent.click(container.querySelector('thead input[type="checkbox"]') as HTMLElement);
  const bulk2 = screen.getByRole("button", { name: /Hal qilindi deb belgilash \(2\)/ }) as HTMLButtonElement;
  assert.equal(bulk2.disabled, false);
  fireEvent.click(bulk2);

  const confirm = await screen.findByRole("dialog", { name: "Xatolarni hal qilindi deb belgilash" });
  assert.match(confirm.textContent ?? "", /2 ta ochiq xato/);
  const submit = within(confirm).getByRole("button", { name: "Belgilash" }) as HTMLButtonElement;
  assert.equal(submit.disabled, true, "typed confirmation required for a bulk action");
  fireEvent.change(within(confirm).getByLabelText(/deb yozing/), { target: { value: "2" } });
  assert.equal(submit.disabled, false);
  fireEvent.click(submit);

  await waitFor(() => assert.ok(calls.some((c) => c.method === "POST")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url.pathname, "/api/admin/errors/resolve");
  assert.deepEqual(post.body, { ids: ["30", "29"] });
  await waitFor(() => assert.ok(toastTexts().includes("2 ta xato hal qilindi deb belgilandi")));
  // The list reloaded and the selection was dropped.
  await waitFor(() => assert.ok(screen.getByRole("button", { name: /Hal qilindi deb belgilash \(0\)/ })));
  assert.ok(calls.filter((c) => c.method === "GET" && c.url.pathname === "/api/admin/errors").length >= 2);
});

test("errors: one selected row needs no typed confirmation", async () => {
  const calls = stubFetch(errorsApi());
  const { container } = renderErrors();
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  fireEvent.click(container.querySelector('tr[data-row-key="29"] input[type="checkbox"]') as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: /Hal qilindi deb belgilash \(1\)/ }));
  const confirm = await screen.findByRole("dialog", { name: "Xatolarni hal qilindi deb belgilash" });
  assert.ok(!within(confirm).queryByLabelText(/deb yozing/));
  fireEvent.click(within(confirm).getByRole("button", { name: "Belgilash" }));
  await waitFor(() => assert.deepEqual(calls.find((c) => c.method === "POST")?.body, { ids: ["29"] }));
});

test("errors: selection is dropped when the filter changes", async () => {
  stubFetch(errorsApi());
  const { container } = renderErrors();
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  fireEvent.click(container.querySelector('tr[data-row-key="30"] input[type="checkbox"]') as HTMLElement);
  assert.ok(screen.getByRole("button", { name: /\(1\)/ }));
  cleanup();
  // A different filter set (new mount with another URL) starts with nothing selected.
  stubFetch(errorsApi());
  renderErrors("level=error");
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  assert.ok(screen.getByRole("button", { name: /\(0\)/ }));
});

test("errors: a viewer (no errors.resolve) sees no checkboxes, no bulk button and no resolve button in the drawer", async () => {
  stubFetch(errorsApi());
  const { container } = renderErrors("id=30", VIEWER);
  const dialog = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(dialog).findByText(/at convert/);
  assert.ok(!within(dialog).queryByRole("button", { name: /Hal qilindi/ }));
  assert.ok(!screen.queryByRole("button", { name: /Hal qilindi deb belgilash \(/ }));
  assert.equal(container.querySelectorAll('input[type="checkbox"]').length, 0);
  cleanup();

  // The same page without the drawer: the table is readable, row click still opens the detail.
  stubFetch(errorsApi());
  const noDrawer = renderErrors("", VIEWER);
  await screen.findAllByText("[pdf] soffice timeout after 90000ms");
  assert.equal(noDrawer.container.querySelectorAll('input[type="checkbox"]').length, 0);
  assert.ok(!screen.queryByRole("button", { name: /Hal qilindi/ }));
});

test("errors: the drawer links a user and a job by id, never a raw URL; 404 detail shows an error", async () => {
  const JOB = "11111111-2222-4333-8444-555555555555";
  const item = errorItem({ id: "30", userId: "42", jobId: JOB, requestId: "req-detail-1" });
  stubFetch((c) => (c.url.pathname === "/api/admin/errors/30" ? json(200, { error: detailOf(item) }) : json(200, listBody({ items: [item], total: 1 }))));
  renderErrors("id=30");
  const dialog = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(dialog).findByText(/at convert/);
  assert.equal(within(dialog).getByRole("link", { name: "#42" }).getAttribute("href"), "/admin/users/42");
  assert.equal(within(dialog).getByRole("link", { name: JOB }).getAttribute("href"), `/admin/generations/${JOB}`);
  assert.ok(within(dialog).getByText("req-detail-1"));
  cleanup();

  // A job id that is not a UUID is shown as text, not linked.
  const odd = errorItem({ id: "30", jobId: "javascript:alert(1)" });
  stubFetch((c) => (c.url.pathname === "/api/admin/errors/30" ? json(200, { error: detailOf(odd) }) : json(200, listBody({ items: [odd], total: 1 }))));
  renderErrors("id=30");
  const d2 = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(d2).findByText("javascript:alert(1)");
  assert.ok(!within(d2).queryByRole("link", { name: "javascript:alert(1)" }));
  cleanup();

  stubFetch((c) => (c.url.pathname === "/api/admin/errors/30" ? json(404, { error: "Xato topilmadi", code: "not_found" }) : json(200, listBody())));
  renderErrors("id=30");
  const d3 = await screen.findByRole("dialog", { name: "Xato tafsiloti" });
  await within(d3).findByText("Xato topilmadi");
});
