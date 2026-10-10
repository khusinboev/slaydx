import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ServerMetrics } from "../../lib/admin-api/system.ts";
import { LoadHistory } from "../../components/admin/system/LoadHistory.tsx";

/**
 * «Yuklama tarixi» section of /admin/system (docs/ops/METRICS.md):
 *   - loading skeleton, then every chart section, the peaks table and one SVG per series group;
 *   - range switch (24 soat / 7 kun / 30 kun) re-requests with the chosen `range` and marks it checked;
 *   - empty state (no samples yet) instead of empty axes; partial data (no host cron / no nginx log)
 *     explains itself per section;
 *   - error state with a working retry; the server's `truncated` flag is shown;
 *   - the layout stacks on a phone (single column grid) and never forces horizontal scroll.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
type Call = { url: URL; signal: AbortSignal | null | undefined };
function stubFetch(handler: (call: Call, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const call: Call = { url: new URL(String(input), "http://localhost"), signal: init.signal };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
  return calls;
}

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

function metrics(over: Partial<ServerMetrics> = {}): ServerMetrics {
  const host = [30, 25, 20, 15, 10, 5].map((m, i) => ({
    t: at(m), cpus: 4, load1: 1 + i * 2, load5: 1 + i, memUsedPct: 60 + i * 5, swapUsedPct: 10, diskPct: 50,
    reqPerMin: 60 + i * 10, s4xxPerMin: 2, s5xxPerMin: i === 5 ? 4 : 0, p95Ms: 300,
  }));
  const app = [30, 25, 20, 15, 10, 5].map((m, i) => ({
    t: at(m), activeUsers: 10 + i * 9, queued: i, running: 2, oldestQueuedSec: i * 20, waitP95Sec: i * 3, durP95Sec: 60,
    completed5m: 4, failed5m: 0, dbConns: 12 + i, dbMaxConns: 100, poolWaiting: 0, loopLagMs: 10, rssMb: 300,
  }));
  const containers = host.flatMap((p, i) => [
    { t: p.t, name: "slaydx-web-1", memMb: 400 + i * 10, cpuPct: 5 },
    { t: p.t, name: "slaydx-worker-1", memMb: 900 + i * 20, cpuPct: 20 },
  ]);
  return {
    range: "24h", from: at(1440), to: at(0), bucketSec: 300, hasData: true, truncated: false, host, app, containers,
    peaks: {
      activeUsers: { at: at(5), value: 55, queued: 5, waitP95Sec: 15 },
      memUsedPct: { at: at(5), value: 85 },
      oldestQueuedSec: { at: at(5), value: 100 },
      waitP95Sec: { at: at(5), value: 15 },
      load1: { at: at(5), value: 11 },
    },
    ...over,
  };
}

const EMPTY = metrics({ hasData: false, host: [], app: [], containers: [], peaks: { activeUsers: null, memUsedPct: null, oldestQueuedSec: null, waitP95Sec: null, load1: null } });
const charts = (el: HTMLElement) => el.querySelectorAll('svg[role="img"]');

test("loading skeleton, then every section, the peaks table and the charts", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls = stubFetch(async () => {
    await gate;
    return json(200, metrics());
  });
  const { container } = render(h(LoadHistory));
  assert.ok(container.querySelector('[aria-busy="true"]'), "loading skeleton");
  release();
  await screen.findByRole("heading", { name: "Eng yuqori nuqtalar" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/admin/system/metrics");
  assert.equal(calls[0].url.searchParams.get("range"), "24h");
  assert.ok(calls[0].signal, "the request carries an AbortSignal");

  for (const title of [
    "Yuklama tarixi", "Xotira va swap", "Protsessor yuklamasi (load)", "Konteynerlar xotirasi", "So'rovlar va xatolar",
    "Foydalanuvchilar, navbat va ish kutishi", "Baza ulanishlari",
  ]) assert.ok(screen.getByRole("heading", { name: title }), title);
  // memory, load, containers, requests, users + queue + wait, db
  assert.equal(charts(container).length, 8);

  // Peaks: value and time of the highest points.
  const body = container.textContent ?? "";
  assert.match(body, /Eng ko'p faol foydalanuvchi/);
  assert.match(body, /shu paytda navbat: 5, ish kutishi p95: 15 s/);
  assert.match(body, /85%/);
  assert.match(body, /1 daq 40 s/); // oldest queued 100 s
  const users = container.querySelector('tr[data-row-key="users"]')!;
  assert.match(users.textContent ?? "", /55/);
  assert.match(users.textContent ?? "", /10\.10\.2026 16:55/); // Tashkent = UTC+5
  assert.ok(!container.textContent!.includes("NaN"));

  // Container series are named without the compose prefix.
  const memChart = container.querySelector('svg[aria-label="Konteynerlar xotirasi, MB"]')!.closest("figure")!;
  assert.match(memChart.textContent ?? "", /web-1/);
  assert.match(memChart.textContent ?? "", /worker-1/);
});

test("range switch re-requests with the chosen range and marks it checked", async () => {
  const calls = stubFetch((c) => json(200, metrics({ range: c.url.searchParams.get("range") as "24h" | "7d" | "30d" })));
  const { container } = render(h(LoadHistory));
  await screen.findByRole("heading", { name: "Eng yuqori nuqtalar" });
  const group = screen.getByRole("radiogroup", { name: "Davr" });
  assert.deepEqual(within(group).getAllByRole("radio").map((r) => r.textContent), ["24 soat", "7 kun", "30 kun"]);
  assert.equal(within(group).getByRole("radio", { name: "24 soat" }).getAttribute("aria-checked"), "true");

  fireEvent.click(within(group).getByRole("radio", { name: "7 kun" }));
  await waitFor(() => assert.equal(calls.at(-1)?.url.searchParams.get("range"), "7d"));
  await screen.findByRole("heading", { name: "Eng yuqori nuqtalar" });
  assert.equal(within(screen.getByRole("radiogroup", { name: "Davr" })).getByRole("radio", { name: "7 kun" }).getAttribute("aria-checked"), "true");
  // Longer ranges label the axis with the date too (DD.MM HH:mm).
  assert.match(container.querySelector("table.sr-only")!.textContent ?? "", /\d\d\.\d\d \d\d:\d\d/);

  fireEvent.click(screen.getByRole("radio", { name: "30 kun" }));
  await waitFor(() => assert.equal(calls.at(-1)?.url.searchParams.get("range"), "30d"));
  assert.deepEqual(calls.map((c) => c.url.searchParams.get("range")), ["24h", "7d", "30d"]);
});

test("empty state: no samples yet -> one explanation, no axes", async () => {
  stubFetch(() => json(200, EMPTY));
  const { container } = render(h(LoadHistory));
  await screen.findByText("Yuklama tarixi hali yo'q");
  assert.equal(charts(container).length, 0);
  assert.ok(!screen.queryByRole("heading", { name: "Eng yuqori nuqtalar" }));
  // The range switch stays usable on an empty history.
  assert.ok(screen.getByRole("radio", { name: "30 kun" }));
});

test("partial data: no host cron / no nginx log explain themselves per section", async () => {
  const noHost = metrics({ host: [], containers: [] });
  stubFetch(() => json(200, noHost));
  const first = render(h(LoadHistory));
  await screen.findByRole("heading", { name: "Eng yuqori nuqtalar" });
  assert.equal(first.container.querySelectorAll("[data-no-data]").length, 4, "memory, load, containers and requests say why they are empty");
  assert.match(first.container.textContent ?? "", /slaydx-metrics cron/);
  // app charts (3 lines + db) still render
  assert.equal(charts(first.container).length, 4);
  cleanup();

  const base = metrics();
  stubFetch(() => json(200, { ...base, host: base.host.map((p) => ({ ...p, reqPerMin: null, s4xxPerMin: null, s5xxPerMin: null, p95Ms: null })) }));
  const second = render(h(LoadHistory));
  await screen.findByRole("heading", { name: "Eng yuqori nuqtalar" });
  assert.equal(second.container.querySelectorAll("[data-no-data]").length, 1);
  assert.match(second.container.querySelector("[data-no-data]")!.textContent ?? "", /access_log/);

  cleanup();
  stubFetch(() => json(200, { ...base, app: [] }));
  const third = render(h(LoadHistory));
  await screen.findByRole("heading", { name: "Eng yuqori nuqtalar" });
  assert.match(third.container.textContent ?? "", /Ilova namunalari yo'q/);
});

test("error shows message and request id; retry loads the data", async () => {
  let n = 0;
  stubFetch(() => {
    n += 1;
    return n === 1 ? json(500, { error: "Ichki xatolik", requestId: "req-load-1" }) : json(200, metrics());
  });
  render(h(LoadHistory));
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /Ichki xatolik/);
  assert.match(alert.textContent ?? "", /req-load-1/);
  fireEvent.click(within(alert).getByRole("button", { name: "Qayta urinish" }));
  await screen.findByRole("heading", { name: "Eng yuqori nuqtalar" });
  assert.ok(!screen.queryByRole("alert"));
});

test("a wrong response shape is an error, not a crash", async () => {
  stubFetch(() => json(200, { items: [] }));
  render(h(LoadHistory));
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /noto'g'ri formatda/);
});

test("truncated history is announced; phone layout is a single stacked column", async () => {
  stubFetch(() => json(200, metrics({ truncated: true })));
  const { container } = render(h(LoadHistory));
  const note = await screen.findByRole("status");
  assert.match(note.textContent ?? "", /qirqilgan/);
  // Charts sit in a one-column grid that becomes two columns only on wide screens.
  const grid = [...container.querySelectorAll("div")].find((d) => d.className.includes("grid-cols-[minmax(0,1fr)]"));
  assert.ok(grid, "chart grid");
  assert.match(grid!.className, /xl:grid-cols-2/);
  // Every figure scales with its container (viewBox + w-full), nothing has a fixed pixel width.
  for (const svg of charts(container)) {
    assert.ok(svg.getAttribute("viewBox"), "viewBox");
    assert.match(svg.getAttribute("class") ?? "", /w-full/);
    assert.equal(svg.getAttribute("width"), null);
  }
});
