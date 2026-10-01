import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { AiCostResponse, AiProvidersResponse } from "../../lib/admin-api/ai.ts";
import { AiPage } from "../../components/admin/ai/AiPage.tsx";
import { parseCostSort, sortCostRows } from "../../components/admin/ai/shared.ts";

/**
 * S11 `/admin/ai` (docs/admin/02-plan.md §7.0, §7.1): the four states of both
 * tabs, the URL as the filter store (tab, period, groupBy, sort), a changed
 * filter aborts the pending request, money as `$` (4 decimals when tiny) with
 * the so'm equivalent at the API's `soumPerUsd`, the coverage banner with the
 * caveats, key presence as Bor / Yo'q, open breakers red, stale processes marked.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: URL; signal: AbortSignal | null | undefined };
function stubFetch(handler: (url: URL, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ url, signal: init.signal });
    return handler(url, calls.length);
  }) as typeof fetch;
  return calls;
}

function renderPage(query = "") {
  const calls = { replace: [] as string[] };
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push() {},
    replace: (href: string) => void calls.replace.push(href),
  };
  const node: ReactNode = h(
    AppRouterContext.Provider,
    { value: router },
    h(PathnameContext.Provider, { value: "/admin/ai" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, h(AiPage))),
  );
  return { ...render(node), calls };
}

const CAVEATS = ["Birinchi cheklov: eski xarajatlar yozilmagan.", "Ikkinchi cheklov: narxlar jadvalida yo'q model 0 dollar."];

function costBody(over: Partial<AiCostResponse> = {}): AiCostResponse {
  return {
    range: { from: "2026-03-10", to: "2026-03-12", days: 3 },
    groupBy: "model",
    rows: [
      { key: "gpt-small", calls: 3, inputTokens: 1_000, outputTokens: 500, units: 0, usd: 0.0042, records: 2, unpricedCalls: 0 },
      { key: "claude-sonnet-5", calls: 12, inputTokens: 2_500_000, outputTokens: 120_000, units: 0, usd: 12.4, records: 5, unpricedCalls: 0 },
      { key: "mystery-model", calls: 4, inputTokens: 100, outputTokens: 50, units: 0, usd: 0, records: 1, unpricedCalls: 4 },
    ],
    totals: { records: 8, calls: 19, inputTokens: 2_501_100, outputTokens: 120_550, usd: 12.4042, unpricedCalls: 4 },
    coverage: { jobsWithCost: 9, jobsCompleted: 10, pct: 90 },
    caveats: CAVEATS,
    soumPerUsd: 12_700,
    ...over,
  };
}

const DAY_ROWS: AiCostResponse["rows"] = [
  { key: "2026-03-10", calls: 5, inputTokens: 1, outputTokens: 1, units: null, usd: 1.5, records: 2, unpricedCalls: 0 },
  { key: "2026-03-11", calls: 0, inputTokens: 0, outputTokens: 0, units: null, usd: 0, records: 0, unpricedCalls: 0 },
  { key: "2026-03-12", calls: 14, inputTokens: 2, outputTokens: 2, units: null, usd: 10.9042, records: 6, unpricedCalls: 4 },
];

/** Answers `groupBy=day` with the daily rows and any other grouping with `costBody`. */
const costHandler = (url: URL) => {
  assert.equal(url.pathname, "/api/admin/ai/cost");
  const by = url.searchParams.get("groupBy");
  return json(200, by === "day" ? costBody({ groupBy: "day", rows: DAY_ROWS }) : costBody({ groupBy: by as AiCostResponse["groupBy"] }));
};

const Q = "from=2026-03-10&to=2026-03-12";

// ───────────────────────────── cost tab

test("cost: loading skeleton, then KPI, coverage banner with caveats, chart and table sorted by usd desc", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls = stubFetch(async (url) => {
    await gate;
    return costHandler(url);
  });
  const { container } = renderPage(Q);
  assert.ok(container.querySelector('[aria-busy="true"]'), "loading skeleton");
  release();
  await screen.findAllByText("claude-sonnet-5");

  // Requests: the table grouping (default "model") and the day grouping for the chart, both with the URL period.
  assert.deepEqual(calls.map((c) => c.url.searchParams.get("groupBy")), ["model", "day"]);
  for (const c of calls) {
    assert.equal(c.url.searchParams.get("from"), "2026-03-10");
    assert.equal(c.url.searchParams.get("to"), "2026-03-12");
  }

  // Default sort: usd descending.
  const rowKeys = [...container.querySelectorAll("tr[data-row-key]")].map((r) => r.getAttribute("data-row-key"));
  assert.deepEqual(rowKeys, ["claude-sonnet-5", "gpt-small", "mystery-model"]);

  // Money: $ with two digits for amounts, four for tiny ones, and the so'm equivalent at soumPerUsd.
  const table = screen.getByRole("table", { name: /AI xarajat: model/ });
  assert.ok(within(table).getAllByText("$12,40").length >= 1);
  assert.ok(within(table).getAllByText("$0,0042").length >= 1);
  assert.ok(within(table).getAllByText(/157\s480\s+so'm/).length >= 1, "12.40 × 12 700");
  assert.ok(within(table).getAllByText(/53\s+so'm/).length >= 1, "0.0042 × 12 700, rounded");
  assert.ok(within(table).getAllByText(/narx noma'lum: 4/).length >= 1, "unpriced calls flagged");

  // Coverage banner + the caveats list.
  const note = screen.getByLabelText("Qamrov va cheklovlar");
  assert.match(note.textContent ?? "", /Qamrov: 90%/);
  assert.match(note.textContent ?? "", /10 ta tugallangan ishning 9 tasida/);
  assert.match(note.textContent ?? "", /4 ta chaqiruvning narxi noma'lum/);
  for (const c of CAVEATS) assert.ok(within(note).getByText(c));

  // Daily chart present with its data table.
  assert.ok(screen.getByText("Kunlik AI xarajat"));
  assert.ok(container.querySelector('svg[role="img"]'));
});

test("cost: filters live in the URL — group-by, sort, period and clear reset", async () => {
  stubFetch(costHandler);
  const { calls, container } = renderPage(Q);
  await screen.findAllByText("claude-sonnet-5");

  fireEvent.click(screen.getByRole("radio", { name: "Provayder" }));
  assert.deepEqual(calls.replace.at(-1), "/admin/ai?from=2026-03-10&to=2026-03-12&groupBy=provider");
  // Back to the default grouping drops the param.
  fireEvent.click(screen.getByRole("radio", { name: "Model" }));
  assert.equal(calls.replace.at(-1), "/admin/ai?from=2026-03-10&to=2026-03-12");

  // Sorting by the Chaqiruvlar column: first click is descending.
  fireEvent.click(screen.getByRole("button", { name: /Chaqiruvlar/ }));
  assert.equal(calls.replace.at(-1), "/admin/ai?from=2026-03-10&to=2026-03-12&sort=calls_desc");

  // A period preset writes from/to.
  fireEvent.click(screen.getByRole("button", { name: "7 kun" }));
  const last = new URL(calls.replace.at(-1)!, "http://localhost");
  assert.ok(last.searchParams.get("from") && last.searchParams.get("to") && last.searchParams.get("from")! <= last.searchParams.get("to")!);
  assert.ok(container);
});

test("cost: the URL sort and groupBy are applied; an unknown groupBy/sort/range in the URL falls back, never a 400", async () => {
  const calls = stubFetch(costHandler);
  const { container } = renderPage(`${Q}&groupBy=tool&sort=calls_asc`);
  await screen.findAllByText("claude-sonnet-5");
  assert.deepEqual(calls.map((c) => c.url.searchParams.get("groupBy")), ["tool", "day"]);
  const rowKeys = [...container.querySelectorAll("tr[data-row-key]")].map((r) => r.getAttribute("data-row-key"));
  assert.deepEqual(rowKeys, ["gpt-small", "mystery-model", "claude-sonnet-5"], "calls ascending");
  cleanup();

  const calls2 = stubFetch(costHandler);
  renderPage("from=2026-99-99&to=2026-03-12&groupBy=outcome&sort=drop_table");
  await screen.findAllByText("claude-sonnet-5");
  assert.equal(calls2[0].url.searchParams.get("groupBy"), "model");
  assert.match(calls2[0].url.searchParams.get("from") ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(calls2[0].url.searchParams.get("from"), "2026-99-99");
});

test("cost: groupBy=day is one request (the chart reuses it) and the table lists days as DD.MM.YYYY", async () => {
  const calls = stubFetch(costHandler);
  const { container } = renderPage(`${Q}&groupBy=day`);
  await screen.findAllByText("10.03.2026");
  assert.equal(calls.length, 1);
  assert.ok(container.querySelector("tr[data-row-key='2026-03-11']"), "zero days stay in the table");
  // Units are not shown for day/tool groupings.
  assert.ok(!screen.queryByRole("columnheader", { name: /Birlik/ }));
});

test("cost: part groupings show the units column", async () => {
  stubFetch(costHandler);
  renderPage(`${Q}&groupBy=kind`);
  await screen.findAllByText("claude-sonnet-5");
  assert.ok(screen.getByRole("columnheader", { name: /Birlik/ }));
});

test("cost: changing a filter aborts the pending request", async () => {
  const calls = stubFetch(() => new Promise<Response>(() => {}));
  const first = renderPage(Q);
  await waitFor(() => assert.equal(calls.length, 1));
  const signal = calls[0].signal;
  assert.ok(signal && !signal.aborted);
  // A different groupBy re-renders the page with a new loader: the first request is aborted.
  first.rerender(
    h(
      AppRouterContext.Provider,
      { value: { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as AppRouterInstance },
      h(PathnameContext.Provider, { value: "/admin/ai" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(`${Q}&groupBy=tool`) }, h(AiPage))),
    ),
  );
  await waitFor(() => assert.ok(signal.aborted, "stale request aborted"));
  await waitFor(() => assert.equal(calls.at(-1)!.url.searchParams.get("groupBy"), "tool"));
});

test("cost: empty — no spend in the range; 'Filtrlarni tozalash' only when filters are set", async () => {
  const empty = costBody({ rows: [], totals: { records: 0, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, unpricedCalls: 0 }, coverage: { jobsWithCost: 0, jobsCompleted: 0, pct: 0 } });
  stubFetch(() => json(200, empty));
  const withFilters = renderPage(`${Q}&groupBy=tool`);
  await screen.findByText("Bu oraliqda AI xarajati yo'q");
  assert.ok(screen.getByText("Bu oraliqda tugallangan ish yo'q."));
  fireEvent.click(screen.getAllByRole("button", { name: "Filtrlarni tozalash" })[0]);
  assert.equal(withFilters.calls.replace.at(-1), "/admin/ai");
  cleanup();

  // Default period and grouping: nothing to clear.
  stubFetch(() => json(200, empty));
  renderPage();
  await screen.findByText("Bu oraliqda AI xarajati yo'q");
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
});

test("cost: error shows the message and requestId, retry loads the data", async () => {
  let n = 0;
  stubFetch((url) => {
    n += 1;
    if (n <= 1) return json(500, { error: "Ichki xatolik", requestId: "req-ai-42" });
    return costHandler(url);
  });
  renderPage(Q);
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /Ichki xatolik/);
  assert.match(alert.textContent ?? "", /req-ai-42/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await screen.findAllByText("claude-sonnet-5");
  assert.ok(!screen.queryByRole("alert"));
});

test("cost: 403 renders the forbidden state, with no data", async () => {
  stubFetch(() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }));
  renderPage(Q);
  await screen.findByText("Ruxsat yo'q");
  assert.ok(!screen.queryByText("claude-sonnet-5"));
});

// ───────────────────────────── providers tab

const NOW = Date.now();
const providers: AiProvidersResponse = {
  keys: { gemini: true, anthropic: false, openai: true, openrouter: false, xai: false, fal: false, pexels: true, pixabay: false, azureTts: true, aisha: false },
  processes: [
    { process: "worker@host-a:11", role: "worker", lastSeenAt: new Date(NOW - 5_000).toISOString(), stale: false },
    { process: "web@host-b:22", role: "web", lastSeenAt: new Date(NOW - 600_000).toISOString(), stale: true },
  ],
  breakers: [
    { process: "worker@host-a:11", name: "gemini", state: "open", openUntil: new Date(NOW + 42_000).toISOString(), failures: 0, stale: false },
    { process: "worker@host-a:11", name: "image:pexels", state: "closed", openUntil: null, failures: 2, stale: false },
    { process: "web@host-b:22", name: "gemini", state: "open", openUntil: new Date(NOW + 42_000).toISOString(), failures: 9, stale: true },
  ],
  limiters: [
    { process: "worker@host-a:11", name: "gemini", active: 10, waiting: 3, max: 10, stale: false },
    { process: "worker@host-a:11", name: "anthropic", active: 0, waiting: 0, max: 4, stale: false },
  ],
  usage24h: [
    { provider: "gemini", model: "gemini-3.7-flash", calls: 4_120, usd: 38.4, },
    { provider: "unknown", model: "unknown", calls: 2, usd: 0.03 },
  ],
  soumPerUsd: 12_700,
};

test("providers: key grid (Bor / Yo'q), open breaker red, stale process neutral and marked, limiter load, 24 h usage", async () => {
  const calls = stubFetch(() => json(200, providers));
  const { container } = renderPage("tab=providers");
  assert.ok(container.querySelector('[aria-busy="true"]'), "loading skeleton");
  await screen.findByText("API kalitlari");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/admin/ai/providers");

  // Keys: one tile per provider, present exactly where the API said true.
  const present = Object.fromEntries([...container.querySelectorAll("li[data-key]")].map((li) => [li.getAttribute("data-key"), li.getAttribute("data-present")]));
  assert.deepEqual(present, { gemini: "1", anthropic: "0", openai: "1", openrouter: "0", xai: "0", fal: "0", pexels: "1", pixabay: "0", azureTts: "1", aisha: "0" });
  assert.equal(within(container.querySelector("li[data-key='gemini']") as HTMLElement).getByText("Bor").textContent, "Bor");
  assert.ok(within(container.querySelector("li[data-key='anthropic']") as HTMLElement).getByText("Yo'q"));

  // Breakers: the live open one is red; the stale process's open one is NOT red and is marked.
  const liveRow = [...container.querySelectorAll("tr[data-row-key]")].find((r) => r.getAttribute("data-row-key") === "worker@host-a:11|gemini")!;
  const liveBadge = within(liveRow as HTMLElement).getByText("Ochiq");
  assert.match(liveBadge.className, /destructive/);
  assert.match(liveRow.textContent ?? "", /soniyadan keyin/, "open until");
  const staleRow = [...container.querySelectorAll("tr[data-row-key]")].find((r) => r.getAttribute("data-row-key") === "web@host-b:22|gemini")!;
  const staleBadge = within(staleRow as HTMLElement).getByText("Ochiq");
  assert.doesNotMatch(staleBadge.className, /destructive/);
  assert.ok(within(staleRow as HTMLElement).getByText("Eskirgan"));
  const closed = [...container.querySelectorAll("tr[data-row-key]")].find((r) => r.getAttribute("data-row-key") === "worker@host-a:11|image:pexels")!;
  assert.match(within(closed as HTMLElement).getByText("Yopiq").className, /success/);
  assert.ok(screen.getByText("1 ta ochiq"));
  assert.ok(screen.getByText("1 ta eskirgan jarayon"));

  // Limiter: a full limiter shows load 10 / 10 and the queue.
  const lim = [...container.querySelectorAll("tr[data-row-key]")].find((r) => r.getAttribute("data-row-key") === "worker@host-a:11|gemini" && /\/\s*10/.test(r.textContent ?? "") && /3/.test(r.textContent ?? ""))!;
  assert.ok(lim);

  // 24 h usage with so'm; the unknown pair in Uzbek.
  assert.ok(screen.getAllByText("$38,40").length >= 1);
  assert.ok(screen.getAllByText(/487\s680\s+so'm/).length >= 1, "38.4 × 12 700");
  assert.ok(screen.getAllByText("noma'lum").length >= 2);
});

test("providers: no processes yet → an empty state, not a blank table", async () => {
  stubFetch(() => json(200, { ...providers, processes: [], breakers: [], limiters: [], usage24h: [] }));
  renderPage("tab=providers");
  await screen.findByText("Jarayonlardan signal kelmagan");
  assert.ok(screen.getByText("Limiter ma'lumoti yo'q"));
  assert.ok(screen.getByText("Oxirgi 24 soatda AI xarajati yo'q"));
});

test("providers: error with requestId and retry; 403 forbidden", async () => {
  let n = 0;
  stubFetch(() => {
    n += 1;
    return n === 1 ? json(500, { error: "Ichki xatolik", requestId: "req-prov-7" }) : json(200, providers);
  });
  renderPage("tab=providers");
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /req-prov-7/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await screen.findByText("API kalitlari");
  cleanup();

  stubFetch(() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }));
  renderPage("tab=providers");
  await screen.findByText("Ruxsat yo'q");
  assert.ok(!screen.queryByText("API kalitlari"));
});

test("providers: the refresh button reloads", async () => {
  const calls = stubFetch(() => json(200, providers));
  renderPage("tab=providers");
  await screen.findByText("API kalitlari");
  fireEvent.click(screen.getByRole("button", { name: /Yangilash/ }));
  await waitFor(() => assert.equal(calls.length, 2));
});

test("tabs: the active tab is in the URL; switching writes it (default tab omits the param)", async () => {
  stubFetch(costHandler);
  const { calls } = renderPage(Q);
  await screen.findAllByText("claude-sonnet-5");
  fireEvent.click(screen.getByRole("tab", { name: "Provayderlar" }));
  assert.equal(calls.replace.at(-1), "/admin/ai?from=2026-03-10&to=2026-03-12&tab=providers");
  assert.equal(screen.getByRole("tab", { name: "Xarajat" }).getAttribute("aria-selected"), "true");
});

// ───────────────────────────── sort helpers

test("parseCostSort / sortCostRows: whitelist, direction, stable ties", () => {
  assert.deepEqual(parseCostSort(null), { field: "usd", dir: "desc", value: "usd_desc" });
  assert.equal(parseCostSort("calls_asc").field, "calls");
  for (const bad of ["drop_table", "usd", "usd_up", "key_asc;--", ""]) assert.equal(parseCostSort(bad).value, "usd_desc", bad);
  const rows = costBody().rows;
  assert.deepEqual(sortCostRows(rows, { field: "usd", dir: "desc" }).map((r) => r.key), ["claude-sonnet-5", "gpt-small", "mystery-model"]);
  assert.deepEqual(sortCostRows(rows, { field: "usd", dir: "asc" }).map((r) => r.key), ["mystery-model", "gpt-small", "claude-sonnet-5"]);
  assert.deepEqual(sortCostRows(rows, { field: "key", dir: "asc" }).map((r) => r.key), ["claude-sonnet-5", "gpt-small", "mystery-model"]);
  const tied = rows.map((r) => ({ ...r, usd: 1 }));
  assert.deepEqual(sortCostRows(tied, { field: "usd", dir: "desc" }).map((r) => r.key), ["claude-sonnet-5", "gpt-small", "mystery-model"]);
});
