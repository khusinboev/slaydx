import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import { Dashboard } from "../../components/admin/dashboard/Dashboard.tsx";
import { LIVE_REFRESH_MS, LiveStrip } from "../../components/admin/dashboard/LiveStrip.tsx";
import { compactNumber, dayLabel, isDefaultRange, percentDelta, pointsDelta, rangeFromParams } from "../../components/admin/dashboard/format.ts";
import { todayTashkent, addDaysIso } from "../../lib/admin-format.ts";

/**
 * Dashboard S3 (docs/admin/02-plan.md §7.1, §7.0 states): KPI tiles with
 * "oldingi davr" deltas and the AI coverage hint, the four charts, the tools
 * table, the period in the URL, loading / empty (clear filters) / error
 * (requestId + retry) / forbidden, and the live strip that polls every 15 s
 * only while the tab is visible.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - polling without the visibility check → "live strip: hidden tab" sees extra polls;
 *   - no immediate refresh on becoming visible → same test, call count 3 ≠ 2;
 *   - percentDelta tone for up-bad metrics → "percentDelta" test;
 *   - setRange keeping the default range in the URL → "clear filters" expects `/admin`;
 *   - useLoad showing a stale key's result → "period change" test sees the old KPI.
 */

// Context modules are module state: use the instance the components `require`.
const req = createRequire(import.meta.url);
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const NB = " ";
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Handler = (url: URL) => Response | Promise<Response>;
function stubFetch(handler: Handler): URL[] {
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return calls;
}

function makeRouter() {
  const replaced: string[] = [];
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push() {},
    replace: (href: string) => void replaced.push(href),
  };
  return { router, replaced };
}

const VIEWER = ["dashboard.view", "users.view", "jobs.view", "payments.view", "finance.view", "ai.view", "settings.view", "system.view", "errors.view", "pricing.view", "self"];
const MODERATOR = ["dashboard.view", "users.view", "users.block", "jobs.view", "moderation.view", "moderation.act", "self"];

function renderDashboard(opts: { search?: string; permissions?: string[] } = {}) {
  let search = opts.search ?? "";
  const { router, replaced } = makeRouter();
  const tree = (node: ReactNode) =>
    h(
      AppRouterContext.Provider,
      { value: router },
      h(
        PathnameContext.Provider,
        { value: "/admin" },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(search) },
          h(AdminIdentityProvider, { value: { role: "viewer", permissions: opts.permissions ?? VIEWER, name: "Ali", username: null } }, node),
        ),
      ),
    );
  const utils = render(tree(h(Dashboard)));
  /** Simulates the router applying a new URL query. */
  const navigate = (next: string) => {
    search = next;
    utils.rerender(tree(h(Dashboard)));
  };
  return { ...utils, replaced, navigate };
}

// ───────────────────────────── fixtures

const kpis = (o: Partial<Record<string, unknown>> = {}) => ({
  newUsers: 12,
  activeUsers: 40,
  generations: { total: 120, completed: 100, failed: 10, revoked: 2 },
  successRate: 90.91,
  revenueSoum: { total: 1_500_000, click: 1_000_000, payme: 500_000, topup: 1_200_000, pro: 300_000 },
  paidOrders: 9,
  cashSpendTanga: 900_000,
  bonusSpendPoints: 3_000,
  refunds: { count: 4, tanga: 20_000, points: 500 },
  aiCostUsd: 12.5,
  aiCoverage: { jobsWithCost: 94, jobsCompleted: 100, pct: 94 },
  marginSoum: 1_341_250,
  pendingOrders: 1,
  ...o,
});

function overviewBody(from: string, to: string, current = kpis(), previous = kpis({ newUsers: 10, successRate: 92, refunds: { count: 2, tanga: 10_000, points: 0 }, aiCostUsd: 10 })) {
  return { range: { from, to, days: 2, previous: { from: "2026-03-08", to: "2026-03-09", days: 2 } }, soumPerUsd: 12_700, current, previous };
}

const TOOLS = {
  items: [
    { toolId: "slide", title: "Slayd", count: 80, completed: 70, failed: 2, failRate: 2.78, cashSpend: 600_000, aiCostUsd: 7, avgDurationSec: 75 },
    { toolId: "article", title: "Maqola", count: 20, completed: 12, failed: 6, failRate: 33.33, cashSpend: 300_000, aiCostUsd: 5, avgDurationSec: 3725 },
    { toolId: "free:outline", title: "Bepul AI: reja", count: 0, completed: 0, failed: 0, failRate: null, cashSpend: 0, aiCostUsd: 0.5, avgDurationSec: null },
  ],
};
const LIVE = { queued: 3, running: 6, oldestQueuedSec: 48, inflightUsers: 7, workersAlive: 2, workersStale: 1 };

function seriesBody(url: URL) {
  const metric = url.searchParams.get("metric");
  const days = [url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""];
  const values: Record<string, Record<string, number>> = {
    revenue: { total: 750_000, click: 0, payme: 0, topup: 0, pro: 0, orders: 1 },
    generations: { total: 60, completed: 50, failed: 5, revoked: 1 },
    signups: { users: 6 },
    ai_cost: { usd: 6.25, records: 50 },
  };
  return { metric, range: { from: days[0], to: days[1], days: 2 }, points: days.map((day) => ({ day, values: values[metric ?? ""] })) };
}

/** Every endpoint answers; `override` can replace one by path suffix. */
function happy(override: Partial<Record<"overview" | "tools" | "live" | "series", Handler>> = {}): Handler {
  return (url) => {
    const ep = url.pathname.split("/").pop() as "overview" | "tools" | "live" | "series";
    if (override[ep]) return override[ep]!(url);
    if (ep === "overview") return json(200, overviewBody(url.searchParams.get("from")!, url.searchParams.get("to")!));
    if (ep === "tools") return json(200, TOOLS);
    if (ep === "live") return json(200, LIVE);
    return json(200, seriesBody(url));
  };
}

const tile = (label: string) => {
  // The tile label is the uppercase caption of KpiTile.
  const el = screen.getByText(label, { selector: "span.uppercase" }).parentElement;
  assert.ok(el, `tile ${label}`);
  return el as HTMLElement;
};

// ───────────────────────────── pure helpers

test("percentDelta / pointsDelta: sign, rounding, previous 0, polarity", () => {
  assert.deepEqual(percentDelta(112, 100, "up-good"), { text: "+12%", direction: "up", tone: "good" });
  assert.deepEqual(percentDelta(112, 100, "up-bad"), { text: "+12%", direction: "up", tone: "bad" });
  assert.deepEqual(percentDelta(95, 100, "up-bad"), { text: "-5%", direction: "down", tone: "good" });
  assert.deepEqual(percentDelta(5, 0, "up-good"), { text: "oldingi davrda 0", direction: "up", tone: "good" });
  assert.deepEqual(percentDelta(0, 0, "up-good"), { text: "0%", direction: "flat", tone: "neutral" });
  assert.deepEqual(percentDelta(100_001, 100_000, "up-good"), { text: "0%", direction: "flat", tone: "neutral" });
  assert.deepEqual(percentDelta(-50, -100, "up-good"), { text: "+50%", direction: "up", tone: "good" });
  assert.deepEqual(pointsDelta(90.91, 92, "up-good"), { text: "-1,1 p.p.", direction: "down", tone: "bad" });
  assert.equal(pointsDelta(null, 92, "up-good"), null);
  assert.deepEqual(pointsDelta(50, 50.01, "up-good"), { text: "0 p.p.", direction: "flat", tone: "neutral" });
});

test("rangeFromParams / isDefaultRange / compactNumber / dayLabel", () => {
  const today = "2026-03-11";
  assert.deepEqual(rangeFromParams(new URLSearchParams("from=2026-03-01&to=2026-03-05"), today), { range: { from: "2026-03-01", to: "2026-03-05" }, fromUrl: true });
  for (const bad of ["", "from=2026-03-05&to=2026-03-01", "from=2026-02-30&to=2026-03-01", "from=2024-01-01&to=2026-01-01", "from=2026-03-01"]) {
    assert.deepEqual(rangeFromParams(new URLSearchParams(bad), today), { range: { from: "2026-02-10", to: today }, fromUrl: false }, bad);
  }
  assert.equal(isDefaultRange({ from: "2026-02-10", to: today }, today), true);
  assert.equal(isDefaultRange({ from: "2026-02-11", to: today }, today), false);
  assert.equal(compactNumber(1_250_000), "1,3 mln");
  assert.equal(compactNumber(350_000), "350 ming");
  assert.equal(compactNumber(2_500), "2,5 ming");
  assert.equal(compactNumber(0.5), "0,5");
  assert.equal(dayLabel("2026-03-10"), "10.03");
});

// ───────────────────────────── screen states

test("loading: KPI and table skeletons while requests are pending", () => {
  stubFetch(() => new Promise<Response>(() => {}));
  const { container } = renderDashboard();
  assert.ok(container.querySelector('[aria-busy="true"]'), "skeleton container");
  assert.ok(screen.getByText("Yangi foydalanuvchilar"), "skeleton tiles keep their labels");
  assert.ok(screen.getByRole("heading", { name: "Bosh sahifa" }));
});

test("ready: tiles, deltas, coverage hint, charts, tools table and live strip; default period = last 30 days", async () => {
  const calls = stubFetch(happy());
  renderDashboard();
  await waitFor(() => assert.ok(within(tile("Tushum")).getByText(`1${NB}500${NB}000${NB}so'm`)));

  const today = todayTashkent();
  const ov = calls.find((u) => u.pathname === "/api/admin/metrics/overview");
  assert.ok(ov);
  assert.equal(ov.searchParams.get("to"), today);
  assert.equal(ov.searchParams.get("from"), addDaysIso(today, -29));
  const metrics = calls.filter((u) => u.pathname === "/api/admin/metrics/series").map((u) => u.searchParams.get("metric")).sort();
  assert.deepEqual(metrics, ["ai_cost", "generations", "revenue", "signups"]);

  assert.ok(within(tile("Yangi foydalanuvchilar")).getByText("+20%"));
  assert.ok(within(tile("Muvaffaqiyat")).getByText("-1,1 p.p."));
  const refunds = tile("Qaytarishlar");
  assert.ok(within(refunds).getByText("+100%"));
  assert.ok(within(refunds).getByText("+100%").className.includes("text-destructive"), "more refunds is bad");
  assert.ok(within(tile("AI xarajat")).getByText("Qamrov: 94% (94/100 tayyor ish)"));
  assert.ok(screen.getByText(/tayyor ishlarning 94% ida bor/));
  assert.ok(screen.getByRole("link", { name: "AI xarajat" }), "viewer has ai.view → link to the AI page");
  assert.ok(screen.getByText(/oldingi davr \(08\.03\.2026 — 09\.03\.2026\)/));

  for (const title of ["Kunlik tushum, so'm", "Kunlik generatsiyalar: tayyor va xato", "Kunlik yangi foydalanuvchilar", "Kunlik AI xarajat, dollar"]) {
    await waitFor(() => assert.ok(screen.getByRole("img", { name: title }), title));
  }

  await waitFor(() => assert.ok(screen.getAllByText("Slayd").length > 0));
  assert.ok(screen.getAllByText("Bepul AI: reja").length > 0);
  assert.ok(screen.getAllByText("33,3%").length > 0);
  assert.ok(screen.getAllByText("1 soat 02 daq").length > 0);

  const live = screen.getByRole("region", { name: "Hozirgi holat" });
  await waitFor(() => assert.ok(within(live).getByText("navbatda")));
  assert.ok(within(live).getByText("48 s"));
  assert.ok(within(live).getByText("worker jarayon javob bermayapti"));
});

test("a role without ai.view sees every number but no link to the AI page", async () => {
  stubFetch(happy());
  renderDashboard({ permissions: MODERATOR });
  await waitFor(() => assert.ok(screen.getByText(/tayyor ishlarning 94% ida bor/)));
  assert.ok(!screen.queryByRole("link", { name: "AI xarajat" }));
});

test("URL period: requests carry from/to of the URL", async () => {
  const calls = stubFetch(happy());
  renderDashboard({ search: "from=2026-03-10&to=2026-03-11" });
  await waitFor(() => assert.ok(screen.getByText(/Davr: 10\.03\.2026 — 11\.03\.2026/)));
  await waitFor(() => assert.ok(calls.some((u) => u.pathname.endsWith("/tools"))));
  for (const u of calls.filter((x) => !x.pathname.endsWith("/live"))) {
    assert.equal(u.searchParams.get("from"), "2026-03-10", u.toString());
    assert.equal(u.searchParams.get("to"), "2026-03-11", u.toString());
  }
});

test("period change: the old period's numbers disappear and its requests are aborted", async () => {
  const signals: Array<{ url: URL; signal: AbortSignal | undefined }> = [];
  const base = happy();
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    signals.push({ url, signal: init.signal ?? undefined });
    // The second period never answers.
    if (url.searchParams.get("from") === "2026-02-01") return new Promise<Response>(() => {});
    return base(url);
  }) as typeof fetch;
  const { navigate } = renderDashboard({ search: "from=2026-03-10&to=2026-03-11" });
  await waitFor(() => assert.ok(within(tile("Tushum")).getByText(`1${NB}500${NB}000${NB}so'm`)));
  navigate("from=2026-02-01&to=2026-02-28");
  await waitFor(() => assert.ok(screen.getByText(/Davr: 01\.02\.2026 — 28\.02\.2026/)));
  assert.ok(!within(tile("Tushum")).queryByText(`1${NB}500${NB}000${NB}so'm`), "no stale KPI");
  const pending = signals.filter((s) => s.url.searchParams.get("from") === "2026-02-01");
  assert.ok(pending.length >= 6, "overview, tools and four series for the new period");
  navigate("from=2026-03-10&to=2026-03-11");
  // The new period replaced the pending one: every request of it was aborted.
  assert.ok(pending.every((s) => s.signal?.aborted), "pending requests aborted");
});

test("filter → URL: a preset replaces the URL query (default period → bare /admin)", async () => {
  stubFetch(happy());
  const { replaced } = renderDashboard({ search: "from=2026-03-10&to=2026-03-11" });
  fireEvent.click(screen.getByRole("button", { name: "7 kun" }));
  const today = todayTashkent();
  assert.deepEqual(replaced, [`/admin?from=${addDaysIso(today, -6)}&to=${today}`]);
  fireEvent.click(screen.getByRole("button", { name: "30 kun" }));
  assert.equal(replaced[1], "/admin");
});

test("empty: no tools in a filtered period → 'Filtrlarni tozalash' resets the URL", async () => {
  stubFetch(happy({ tools: () => json(200, { items: [] }) }));
  const { replaced } = renderDashboard({ search: "from=2025-01-01&to=2025-01-31" });
  await waitFor(() => assert.ok(screen.getByText("Bu davrda ish bo'lmagan")));
  fireEvent.click(screen.getByRole("button", { name: "Filtrlarni tozalash" }));
  assert.deepEqual(replaced, ["/admin"]);
});

test("empty in the default period has no clear-filters button", async () => {
  stubFetch(happy({ tools: () => json(200, { items: [] }) }));
  renderDashboard();
  await waitFor(() => assert.ok(screen.getByText("Bu davrda ish bo'lmagan")));
  assert.ok(!screen.queryByRole("button", { name: "Filtrlarni tozalash" }));
});

test("error: requestId shown, retry reloads the KPIs", async () => {
  let fail = true;
  stubFetch(
    happy({
      overview: (url) =>
        fail ? json(500, { error: "Serverda xatolik", requestId: "req-123" }) : json(200, overviewBody(url.searchParams.get("from")!, url.searchParams.get("to")!)),
    }),
  );
  renderDashboard();
  await waitFor(() => assert.ok(screen.getByText("req-123")));
  assert.ok(screen.getByText("Serverda xatolik"));
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() => assert.ok(within(tile("Tushum")).getByText(`1${NB}500${NB}000${NB}so'm`)));
  assert.ok(!screen.queryByText("req-123"));
});

test("forbidden: a 403 from the overview renders 'Ruxsat yo'q'", async () => {
  stubFetch(happy({ overview: () => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }) }));
  renderDashboard();
  await waitFor(() => assert.ok(screen.getByText("Ruxsat yo'q")));
  assert.ok(!screen.queryByRole("heading", { name: "Bosh sahifa" }));
});

// ───────────────────────────── live strip polling

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new window.Event("visibilitychange"));
}
const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
});

test("live strip: polls every 15 s while visible, stops when hidden, refreshes at once when visible again", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => setVisibility("visible"));
  let n = 0;
  // Distinct numbers so the polled `queued` value is unambiguous on screen.
  const calls = stubFetch(() => json(200, { ...LIVE, running: 16, inflightUsers: 17, workersAlive: 19, workersStale: 0, queued: ++n }));
  render(h(LiveStrip));
  await flush();
  assert.equal(calls.length, 1, "first load");
  assert.ok(screen.getByText("1"));

  act(() => t.mock.timers.tick(LIVE_REFRESH_MS));
  await flush();
  assert.equal(calls.length, 2, "one poll after 15 s");
  assert.ok(screen.getByText("2"));

  setVisibility("hidden");
  act(() => t.mock.timers.tick(LIVE_REFRESH_MS * 3));
  await flush();
  assert.equal(calls.length, 2, "no polling while hidden");

  setVisibility("visible");
  await flush();
  assert.equal(calls.length, 3, "immediate refresh on return");
  act(() => t.mock.timers.tick(LIVE_REFRESH_MS));
  await flush();
  assert.equal(calls.length, 4, "polling resumed");
  assert.ok(calls.every((u) => u.pathname === "/api/admin/metrics/live"));
});

test("live strip: a failed poll keeps the last numbers and offers a retry", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let fail = false;
  stubFetch(() => (fail ? json(500, { error: "Baza javob bermadi", requestId: "r1" }) : json(200, LIVE)));
  render(h(LiveStrip));
  await flush();
  assert.ok(screen.getByText("48 s"));
  fail = true;
  act(() => t.mock.timers.tick(LIVE_REFRESH_MS));
  await flush();
  assert.ok(screen.getByText(/Yangilab bo'lmadi/));
  assert.ok(screen.getByText("48 s"), "last numbers kept");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await flush();
  assert.ok(!screen.queryByText(/Yangilab bo'lmadi/));
});
