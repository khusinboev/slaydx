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
import type { PricingDetail, PricingItem, PricingOverview, Simulation } from "../../lib/admin-api/pricing.ts";
import { PricingPage } from "../../components/admin/pricing/PricingPage.tsx";
import { ladderRange, marginTone, parseSort, recommendationOf, recommendationText, sortItems, trendChangePct, usdText } from "../../components/admin/pricing/shared.ts";
import { parsePercentText } from "../../components/admin/pricing/Simulator.tsx";

/**
 * S20 `/admin/pricing` (docs/admin/02-plan.md §17.6, §7.0): loading, empty
 * (group with no tools), error (request id + retry), forbidden; KPI tiles,
 * the coverage banner below 90 %, margin colouring, adjustment highlighted
 * when ≠ 100, the recommendation chip; period / group / sort / open tool in
 * the URL; row → drawer with trend, ladder, simulator (live, debounced,
 * aborting), history; "O'zgartirish" sends `{percent, roundTo, reason}` with
 * a typed confirmation above ±50 points; "100% ga qaytarish" sends
 * `{reason}`; viewers and finance see no edit controls; a stale step-up is
 * asked once and the same request replayed.
 */

const req = createRequire(import.meta.url);
const core = req("../../lib/admin-api/core.ts") as typeof CoreModule;
const { AdminIdentityProvider } = req("../../components/admin/shell/admin-identity.tsx") as typeof IdentityModule;
const { useToastStore } = req("../../components/admin/ui/Toaster.tsx") as typeof ToasterModule;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  core.setStepUpHandler(null);
  useToastStore.getState().clear();
});

const PERMS = {
  owner: ["pricing.view", "pricing.edit"],
  finance: ["pricing.view"],
  viewer: ["pricing.view"],
} as const;
type Role = keyof typeof PERMS;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: URL; init: RequestInit; body: Record<string, unknown> | null; signal: AbortSignal | null | undefined };
function stubFetch(handler: (c: Call, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const c: Call = {
      url: new URL(String(input), "http://localhost"),
      init,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      signal: init.signal,
    };
    calls.push(c);
    return handler(c, calls.length);
  }) as typeof fetch;
  return calls;
}

function renderPage(query = "", role: Role = "owner") {
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
    AdminIdentityProvider,
    { value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null, twoFactor: true }, children: h(
      AppRouterContext.Provider,
      { value: router },
      h(PathnameContext.Provider, { value: "/admin/pricing" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, h(PricingPage))),
    ) },
  );
  return { ...render(node), calls };
}

const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

/* ───────────────────────────── fixtures ───────────────────────────── */

const DAYS = ["2026-03-10", "2026-03-11", "2026-03-12"];
const trend = (values: (number | null)[]) => DAYS.map((day, i) => ({ day, avgCostSoum: values[i] ?? null, jobs: values[i] === null ? 0 : 1 }));

function item(over: Partial<PricingItem> & Pick<PricingItem, "toolId" | "title" | "group">): PricingItem {
  return {
    unit: "job",
    unitLabel: "ish",
    adjust: { percent: 100, roundTo: 500 },
    ladder: [{ label: "Standart", base: 3000, effective: 3000 }],
    jobs: 0,
    completed: 0,
    failed: 0,
    failRate: null,
    refundRate: null,
    avgPrice: null,
    avgCashRevenue: null,
    avgCashRevenueSoum: null,
    avgRevenue: null,
    avgRevenueSoum: null,
    avgUnits: null,
    avgCostUsd: null,
    avgCostSoum: null,
    overheadUsd: null,
    overheadSoum: null,
    fullCostSoum: null,
    costPerUnitSoum: null,
    marginPct: null,
    cashMarginPct: null,
    markup: null,
    pointsSharePct: null,
    bonusCostSoum: null,
    coveragePct: null,
    jobsWithCost: 0,
    recommendedPercent: null,
    sampleSize: 0,
    confidence: "low",
    trend: trend([null, null, null]),
    ...over,
  };
}

const ESSAY_LADDER = [
  { label: "1 varaq", base: 2000, effective: 2000 },
  { label: "2 varaq", base: 2500, effective: 2500 },
  { label: "5 varaq", base: 4000, effective: 4000 },
];

const ESSAY = item({
  toolId: "essay",
  title: "Insho",
  group: "talaba",
  unit: "page",
  unitLabel: "bet",
  ladder: ESSAY_LADDER,
  jobs: 524,
  completed: 510,
  failed: 14,
  failRate: 2.67,
  refundRate: 2.1,
  avgPrice: 2700,
  avgCashRevenue: 1800,
  avgRevenue: 2666.67,
  avgRevenueSoum: 2666.67,
  avgUnits: 2.4,
  avgCostUsd: 0.06,
  avgCostSoum: 720,
  overheadUsd: 0.0067,
  overheadSoum: 80,
  fullCostSoum: 800,
  costPerUnitSoum: 333.33,
  marginPct: 70,
  cashMarginPct: 55.56,
  markup: 3.333,
  pointsSharePct: 25,
  bonusCostSoum: 420,
  coveragePct: 66.67,
  jobsWithCost: 340,
  recommendedPercent: 90,
  sampleSize: 510,
  confidence: "ok",
  trend: trend([700, 800, 900]),
});

const SLIDE = item({
  toolId: "slide",
  title: "Slayd",
  group: "umumiy",
  unit: "slide",
  unitLabel: "slayd",
  adjust: { percent: 120, roundTo: 500 },
  ladder: [
    { label: "4 slayd", base: 3000, effective: 3500 },
    { label: "30 slayd", base: 8000, effective: 9500 },
  ],
  jobs: 1460,
  completed: 1400,
  failed: 45,
  failRate: 3.11,
  avgPrice: 3600,
  avgCashRevenue: 3400,
  avgRevenue: 3500,
  avgRevenueSoum: 3500,
  fullCostSoum: 2640,
  costPerUnitSoum: 132,
  marginPct: 22.35,
  cashMarginPct: 14.4,
  markup: 1.326,
  pointsSharePct: 48.2,
  bonusCostSoum: 1_250_000,
  coveragePct: 97,
  jobsWithCost: 1358,
  recommendedPercent: 265,
  sampleSize: 1400,
  confidence: "ok",
  trend: trend([2000, 2500, 3000]),
});

const RESUME = item({ toolId: "resume", title: "Rezyume", group: "umumiy", jobs: 3, completed: 3, marginPct: 80, fullCostSoum: 600, markup: 5, recommendedPercent: 60, sampleSize: 3 });

function overview(over: Partial<PricingOverview> = {}): PricingOverview {
  return {
    range: { from: "2026-03-10", to: "2026-03-12", days: 3 },
    items: [ESSAY, SLIDE, RESUME],
    totals: {
      jobs: 1987,
      completed: 1913,
      cashRevenue: 5_900_000,
      cashRevenueSoum: 5_900_000,
      costUsdTools: 310.5,
      costSoumTools: 3_726_000,
      costUsdOther: 12.25,
      costUsdAll: 322.75,
      revenue: 9_100_000,
      revenueSoum: 9_100_000,
      marginRevenueSoum: 8_900_000,
      marginCostSoum: 3_700_000,
      feeSoum: 222_500,
      uncoveredRevenueSoum: 200_000,
      uncoveredTools: ["Maqola"],
      marginPct: 36.85,
      cashMarginPct: 21.5,
      bonusCostSoum: 1_670_000,
      pointsSharePct: 41.3,
    },
    fx: 12_000,
    soumPerCoin: 1,
    targetMarkup: 3,
    paymentFeePercent: 2.5,
    includeAdmins: false,
    adminJobs: 41,
    groups: [
      { id: "umumiy", label: "Umumiy vositalar" },
      { id: "talaba", label: "Talaba ishlari" },
      { id: "oqituvchi", label: "O'qituvchi vositalari" },
    ],
    caveats: ["Birinchi cheklov.", "Ikkinchi cheklov."],
    ...over,
  };
}

function detail(toolId: string): PricingDetail {
  const it = toolId === "slide" ? SLIDE : ESSAY;
  return {
    tool: { toolId, title: it.title, group: it.group, unit: it.unit, unitLabel: it.unitLabel, adjust: it.adjust },
    range: { from: "2025-12-13", to: "2026-03-12", days: 90 },
    trend: Array.from({ length: 90 }, (_, i) => ({ day: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, avgCostSoum: i % 7 === 0 ? null : 700 + i, jobs: i % 7 === 0 ? 0 : 2 })),
    history:
      toolId === "slide"
        ? [{ id: "7", at: "2026-02-20T05:00:00.000Z", admin: "Dilnoza Owner", oldPercent: 100, newPercent: 120, oldRoundTo: 500, newRoundTo: 500, reason: "Rasm generatsiyasi qimmatlashdi" }]
        : [],
    ladder: it.ladder,
    fx: 12_000,
  };
}

function simulation(toolId: string, body: Record<string, unknown>): Simulation {
  const percent = Number(body.percent);
  const roundTo = Number(body.roundTo);
  const it = toolId === "slide" ? SLIDE : ESSAY;
  const adj = (b: number) => (percent === 100 ? b : Math.max(roundTo, Math.round((b * percent) / 100 / roundTo) * roundTo));
  return {
    toolId,
    proposed: { percent, roundTo: roundTo as 100 | 500 | 1000 },
    ladder: it.ladder.map((s) => ({ ...s, effective: adj(s.base) })),
    window: { from: "2026-02-11", to: "2026-03-12", days: 30 },
    // 2 so'm per tanga in this fixture, so the tanga and so'm revenue lines differ visibly.
    current: { revenue30d: 1_300_000, revenue30dSoum: 2_600_000, feeSoum: 65_000, cost30d: 400_000, marginPct: 82.12, jobs: 500 },
    projected: {
      revenue30d: Math.round((1_300_000 * percent) / 100),
      revenue30dSoum: Math.round((2_600_000 * percent) / 100),
      feeSoum: Math.round((2_600_000 * percent * 0.025) / 100),
      cost30d: 400_000,
      marginPct: 100 - (400_000 / ((2_600_000 * percent) / 100)) * 100,
    },
    partial: false,
    fx: 12_000,
    soumPerCoin: 2,
    paymentFeePercent: 2.5,
    includeAdmins: body.includeAdmins === true,
  };
}

/** Default stub: overview, detail, simulate and mutations answered from the fixtures. */
function stubAll(opts: { onPut?: (c: Call) => Response; onDelete?: (c: Call) => Response; overview?: PricingOverview } = {}): Call[] {
  return stubFetch((c) => {
    const p = c.url.pathname;
    const method = (c.init.method ?? "GET").toUpperCase();
    if (p === "/api/admin/pricing" && method === "GET") return json(200, opts.overview ?? overview());
    const m = /^\/api\/admin\/pricing\/([^/]+)(\/simulate)?$/.exec(p);
    assert.ok(m, `kutilmagan so'rov: ${method} ${p}`);
    const toolId = decodeURIComponent(m[1]);
    if (m[2]) return json(200, simulation(toolId, c.body ?? {}));
    if (method === "GET") return json(200, detail(toolId));
    if (method === "PUT") return opts.onPut ? opts.onPut(c) : json(200, { item: { toolId, title: "Insho", adjust: { percent: c.body!.percent, roundTo: c.body!.roundTo }, ladder: simulation(toolId, c.body!).ladder, history: [] } });
    if (method === "DELETE") return opts.onDelete ? opts.onDelete(c) : json(200, { item: { toolId, title: "Insho", adjust: { percent: 100, roundTo: 500 }, ladder: ESSAY_LADDER, history: [] } });
    throw new Error(`kutilmagan ${method} ${p}`);
  });
}

const Q = "from=2026-03-10&to=2026-03-12";
const ready = async () => screen.findByRole("heading", { name: "Vositalar bo'yicha narx va tannarx" });
/** House number format: thousands grouped with a no-break space ("3 600" → "3 600"). */
const nb = (s: string): string => s.replace(/(\d) (?=\d)/g, "$1 ");
const rowOf = (title: string): HTMLElement => {
  const cell = screen.getAllByText(title, { selector: "b" }).find((el) => el.closest("tr"));
  assert.ok(cell, `${title} qatori yo'q`);
  return cell.closest("tr") as HTMLElement;
};

/* ───────────────────────────── helpers (no DOM) ───────────────────────────── */

test("helpers: margin tone, ladder range, recommendation, sort, trend change, percent parsing", () => {
  assert.equal(marginTone(29.9), "danger");
  assert.equal(marginTone(30), "warning");
  assert.equal(marginTone(60), "warning");
  assert.equal(marginTone(60.1), "success");
  assert.equal(marginTone(null), "neutral");
  assert.equal(ladderRange(ESSAY_LADDER, "base"), nb("2 000 – 4 000"));
  assert.equal(ladderRange([{ label: "a", base: 3000, effective: 3500 }], "effective"), nb("3 500"));
  assert.equal(ladderRange([], "base"), "—");
  assert.deepEqual(recommendationOf({ adjust: { percent: 100, roundTo: 500 }, recommendedPercent: 105 }), { kind: "ok", percent: 105 });
  assert.equal(recommendationText(recommendationOf(ESSAY)), "−10% tavsiya");
  assert.equal(recommendationText(recommendationOf(SLIDE)), "+145% tavsiya");
  assert.equal(recommendationText(recommendationOf(RESUME)), "−40% tavsiya");
  assert.equal(recommendationText({ kind: "none" }), "—");
  assert.deepEqual(parseSort(null), { field: "margin", dir: "asc", value: "margin_asc" });
  assert.deepEqual(parseSort("volume_desc"), { field: "volume", dir: "desc", value: "volume_desc" });
  assert.equal(parseSort("drop_table_desc").value, "margin_asc");
  const noMargin = item({ toolId: "keys", title: "Keys", group: "oqituvchi" });
  assert.deepEqual(sortItems([ESSAY, SLIDE, RESUME, noMargin], parseSort("margin_asc")).map((i) => i.toolId), ["slide", "essay", "resume", "keys"]);
  assert.deepEqual(sortItems([ESSAY, SLIDE, RESUME, noMargin], parseSort("margin_desc")).map((i) => i.toolId), ["resume", "essay", "slide", "keys"]);
  assert.deepEqual(sortItems([ESSAY, SLIDE, RESUME], parseSort("volume_desc")).map((i) => i.toolId), ["slide", "essay", "resume"]);
  assert.deepEqual(sortItems([ESSAY, SLIDE, RESUME], parseSort("cost_desc")).map((i) => i.toolId), ["slide", "essay", "resume"]);
  // Trend: second half (800, 900 → 850) vs first half (700) = +21.4 %.
  assert.ok(Math.abs((trendChangePct(trend([700, 800, 900])) ?? 0) - 21.43) < 0.01);
  assert.equal(trendChangePct(trend([null, 800, 900])), null);
  assert.equal(parsePercentText("120"), 120);
  assert.equal(parsePercentText(" 7 "), 25, "clamped to the minimum");
  assert.equal(parsePercentText("5000"), 1000, "clamped to the maximum");
  assert.equal(parsePercentText("12.5"), null);
  assert.equal(parsePercentText(""), null);
});

/* ───────────────────────────── states ───────────────────────────── */

test("loading skeleton, then KPI tiles, coverage banner with caveats and the table with colouring and chips", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls = stubFetch(async (c) => {
    await gate;
    assert.equal(c.url.pathname, "/api/admin/pricing");
    return json(200, overview());
  });
  const { container } = renderPage(Q);
  assert.ok(container.querySelector('[aria-busy="true"]'), "loading skeleton");
  release();
  await ready();
  assert.equal(calls[0].url.searchParams.get("from"), "2026-03-10");
  assert.equal(calls[0].url.searchParams.get("to"), "2026-03-12");

  // KPI tiles: the primary «Marja» (listed price, fee deducted), the separate «Naqd marja», the bonus cost, the fee.
  assert.ok(screen.getByText("36,9%"));
  const marginTile = screen.getByText("Marja", { selector: "span" }).parentElement!;
  assert.match(marginTile.textContent ?? "", /ball bilan to'langani ham/);
  assert.match(marginTile.textContent ?? "", /komissiya 2,5%/);
  assert.match(marginTile.textContent ?? "", /Tannarxi o'lchanmagan vositalar jamiga kirmagan: Maqola/);
  const cashTile = screen.getByText("Naqd marja", { selector: "span.uppercase" }).parentElement!;
  assert.ok(within(cashTile).getByText("21,5%"));
  assert.match(cashTile.textContent ?? "", /ball hisobga olinmaydi/);
  const bonusTile = screen.getByText("Bonus xarajati", { selector: "span.uppercase" }).parentElement!;
  assert.equal((bonusTile.children[1] as HTMLElement).textContent, nb("1 670 000 so'm"));
  assert.match(bonusTile.textContent ?? "", /tushumning 41,3% qismi ball bilan to'langan/);
  const feeTile = screen.getByText("To'lov komissiyasi", { selector: "span.uppercase" }).parentElement!;
  assert.ok(within(feeTile).getByText("2,5%"));
  assert.ok(within(feeTile).getByText("Sozlama: To'lov komissiyasi (%)"));
  assert.ok(!document.body.textContent?.includes("pricing.payment_fee_percent"), "never the raw key");
  // One short hint per money column says what it is computed on.
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
  for (const [name, hint] of [
    ["Ustama ×", "tushum (komissiyadan keyin) ÷ tannarx"],
    ["Marja % · tavsiya", "narx (ball ham) − tannarx − komissiya (naqd qismdan)"],
    ["Naqd marja · bonus", "naqd tushum bo'yicha · bonus = ball bilan to'langan ishlar tannarxi"],
  ] as const) {
    assert.ok(headers.some((t) => t.includes(name) && t.includes(hint)), `${name}: ${hint}`);
  }
  // AI cost tile: the paid tools' so'm figure, plus the other spend (free AI, unknown) and the
  // all-in total that equals the dashboard / AI page number (P4 money review, finding 3; UX #4).
  const costTile = screen.getByText("AI xarajat · pullik vositalar · 3 kun").parentElement!;
  const costValue = costTile.children[1] as HTMLElement;
  assert.equal(costValue.textContent, nb("3 726 000 so'm"));
  // The value wraps between the number and the unit instead of being cut off at 360 px.
  const wrap = costValue.querySelector(".whitespace-normal");
  assert.ok(wrap, "value wraps");
  const costHint = within(costTile).getByText(/jami/).textContent ?? "";
  // Dollars use 2 decimals, like the dashboard and the AI page.
  assert.equal(usdText(310.5), "$310,50");
  assert.ok(costHint.includes(usdText(310.5)), `tools usd in hint: ${costHint}`);
  assert.ok(costHint.includes(`boshqa ${usdText(12.25)}`), `other spend in hint: ${costHint}`);
  assert.ok(costHint.includes(`jami AI ${usdText(322.75)}`), `all-in total in hint: ${costHint}`);
  assert.ok(costHint.includes("marjaga kirmaydi"), `difference explained: ${costHint}`);
  assert.ok(!/\$\d+,\d{3}/.test(costHint), `no 4-decimal dollars: ${costHint}`);
  assert.ok(screen.getByText("12 000"));
  assert.ok(screen.getByText("3,0×"));
  // Setting hints are Uzbek labels, never raw keys.
  assert.ok(screen.getByText("Sozlama: Dollar kursi (so'm)"));
  assert.ok(screen.getByText("Sozlama: Maqsadli ustama (×)"));
  assert.ok(!document.body.textContent?.includes("finance.soum_per_usd"));
  assert.ok(!document.body.textContent?.includes("pricing.target_markup"));
  // Units: the price columns say tanga; the note states the tanga → so'm conversion.
  assert.ok(screen.getByRole("columnheader", { name: "Narx, tanga" }));
  // 1280 px: base and effective share one column and the chip sits under the margin, so
  // there is no separate "Tavsiya" column to fall off the card's right edge.
  assert.ok(!screen.queryByRole("columnheader", { name: "Tavsiya" }));
  assert.match(nb(document.body.textContent ?? ""), /1 tanga = 1 so'm/);
  assert.ok(screen.getByText("Slayd", { selector: "span" }), "tool below 30 % named in the tile hint");

  // Coverage banner: essay is at 66,67 %.
  const banner = screen.getByRole("region", { name: "Qamrov ogohlantirishi" });
  assert.match(banner.textContent ?? "", /Insho \(67%\)/);
  assert.ok(!/Slayd \(/.test(banner.textContent ?? ""), "97 % is not listed");
  fireEvent.click(within(banner).getByText(/Hisobga olinmaydigan/));
  assert.ok(within(banner).getByText("Birinchi cheklov."));

  // Table rows: margin ascending by default → Slayd first.
  // Direct body rows only: every sparkline carries its own screen-reader table.
  const table = screen.getByRole("table", { name: "Vositalar bo'yicha narx va tannarx" });
  const rows = Array.from(table.querySelectorAll(":scope > tbody > tr"));
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent ?? "", /^Slayd/);
  const slide = rowOf("Slayd");
  assert.ok(within(slide).getByText("▲ 120%"), "adjustment highlighted");
  assert.ok(within(slide).getByText("3 500 – 9 500"));
  assert.ok(within(slide).getByText("asosiy 3 000 – 8 000"));
  assert.ok(within(slide).getByText("22%"));
  assert.ok(within(slide).getByText("+145% tavsiya"));
  assert.ok(within(slide).getByText("2 640 so'm / ish"));
  assert.ok(within(slide).getByText("132 so'm / slayd"));
  assert.ok(within(slide).getByText("1,3×"));
  assert.ok(within(slide).getByText("1 460"));
  // The earlier cash formula sits in its own column, the bonus cost (so'm + points share) in another.
  assert.ok(within(slide).getByText("14%"), "cash margin");
  assert.ok(within(slide).getByText("bonus 1 250 000 so'm"), "bonus cost");
  assert.ok(within(slide).getByText("ball ulushi 48%"), "points share");
  assert.ok(within(slide).getByRole("img", { name: "Slayd: 3 kunlik tannarx trendi" }));
  const essay = rowOf("Insho");
  assert.ok(within(essay).getByText("100%"));
  assert.ok(within(essay).getByText("70%"), "primary margin");
  assert.ok(within(essay).getByText("56%"), "cash margin");
  assert.ok(within(essay).getByText("bonus 420 so'm"), "bonus cost");
  assert.ok(within(essay).getByText("ball ulushi 25%"));
  assert.ok(within(essay).getByText("−10% tavsiya"));
  assert.ok(within(essay).getByText("333 so'm / bet"));
  const resume = rowOf("Rezyume");
  assert.ok(within(resume).getByText("kam ishonch"));
  assert.ok(within(resume).getByText("80%"));
  // The edit controls live in the drawer, not in the table.
  assert.ok(!screen.queryByRole("button", { name: "O'zgartirish" }));
});

test("error state shows the request id and retry reloads; forbidden renders Ruxsat yo'q", async () => {
  let n = 0;
  stubFetch(() => {
    n += 1;
    return n === 1 ? json(500, { error: "Kutilmagan xatolik", requestId: "req-pricing-1" }) : json(200, overview());
  });
  renderPage(Q);
  const err = await screen.findByText("Kutilmagan xatolik");
  assert.ok(err);
  assert.ok(screen.getByText(/req-pricing-1/));
  fireEvent.click(button("Qayta urinish"));
  await ready();
  cleanup();

  stubFetch(() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }));
  renderPage(Q);
  assert.ok(await screen.findByText("Ruxsat yo'q"));
  assert.ok(!screen.queryByLabelText("Vosita guruhi"), "filters hidden when forbidden");
});

test("empty: a group with no tools shows the empty state; «Filtrlarni tozalash» clears the URL", async () => {
  stubAll();
  const { calls } = renderPage(`${Q}&group=oqituvchi`);
  await ready();
  assert.ok(await screen.findByText("Bu guruhda vosita yo'q"));
  // Two clear buttons: the filter bar's and the empty state's; the empty state's is the later one.
  const clears = screen.getAllByRole("button", { name: "Filtrlarni tozalash" });
  assert.equal(clears.length, 2);
  fireEvent.click(clears[1]);
  assert.equal(calls.replace.at(-1), "/admin/pricing");
});

/* ───────────────────────────── URL state ───────────────────────────── */

test("filters and sort live in the URL: group select, column sort, row click opens the drawer via ?tool=", async () => {
  stubAll();
  const { calls } = renderPage(Q);
  await ready();
  fireEvent.change(screen.getByLabelText("Vosita guruhi"), { target: { value: "talaba" } });
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&group=talaba`);
  fireEvent.click(screen.getByRole("button", { name: /Ishlar \(3 kun\)/ }));
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&sort=volume_desc`);
  // Margin is the active (default) sort, so its header toggles to the reverse direction.
  fireEvent.click(screen.getByRole("button", { name: /Marja %/ }));
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&sort=margin_desc`);
  fireEvent.click(rowOf("Insho"));
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&tool=essay`);
});

test("a changed period aborts the pending request and refetches", async () => {
  const seen: Call[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const c: Call = { url: new URL(String(input), "http://localhost"), init, body: null, signal: init.signal };
    seen.push(c);
    await new Promise((r) => setTimeout(r, 30));
    return json(200, overview());
  }) as typeof fetch;
  const first = renderPage(Q);
  first.unmount();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].signal?.aborted, true, "unmount aborts the in-flight request");
  renderPage("from=2026-03-01&to=2026-03-05");
  await ready();
  assert.equal(seen[1].url.searchParams.get("from"), "2026-03-01");
});

/* ───────────────────────────── admin jobs switch ───────────────────────────── */

test("«Adminlar bilan»: off by default (no admins param, the note says how many admin jobs are left out); the checkbox writes ?admins=1; clear resets it", async () => {
  const calls = stubAll();
  const { calls: nav } = renderPage(Q);
  await ready();
  assert.equal(calls[0].url.searchParams.get("admins"), null, "default view does not ask for admin jobs");
  const box = screen.getByRole("checkbox", { name: "Adminlar bilan" }) as HTMLInputElement;
  assert.equal(box.checked, false);
  assert.ok(screen.getByText("Adminlarning 41 ta tugallangan ishi hisobga olinmagan."));
  fireEvent.click(box);
  assert.equal(nav.replace.at(-1), `/admin/pricing?${Q}&admins=1`);
  cleanup();

  const calls2 = stubAll({ overview: overview({ includeAdmins: true }) });
  const second = renderPage(`${Q}&admins=1`);
  await ready();
  assert.equal(calls2[0].url.searchParams.get("admins"), "1", "the switch is part of the request");
  assert.equal((screen.getByRole("checkbox", { name: "Adminlar bilan" }) as HTMLInputElement).checked, true);
  assert.ok(screen.getByText("Adminlarning 41 ta tugallangan ishi ham hisobga olingan."));
  // Switching it off removes the param (the default), and the filter bar's clear button resets it with the rest.
  fireEvent.click(screen.getByRole("checkbox", { name: "Adminlar bilan" }));
  assert.equal(second.calls.replace.at(-1), `/admin/pricing?${Q}`);
  fireEvent.click(screen.getByRole("button", { name: "Filtrlarni tozalash" }));
  assert.equal(second.calls.replace.at(-1), "/admin/pricing");
});

test("the switch reaches the drawer: detail GET carries admins=1, the simulator and the edit preview send includeAdmins", async () => {
  const calls = stubAll({ overview: overview({ includeAdmins: true }) });
  renderPage(`${Q}&admins=1&tool=slide`);
  const dialog = await screen.findByRole("dialog");
  const d = within(dialog);
  await d.findByText("Rasm generatsiyasi qimmatlashdi");
  const detailCall = calls.find((c) => c.url.pathname === "/api/admin/pricing/slide" && (c.init.method ?? "GET") === "GET");
  assert.equal(detailCall?.url.searchParams.get("admins"), "1");
  await waitFor(() => assert.ok(calls.some((c) => c.url.pathname.endsWith("/simulate"))));
  assert.deepEqual(calls.find((c) => c.url.pathname.endsWith("/simulate"))?.body, { percent: 120, roundTo: 500, includeAdmins: true });
  await d.findByText("1 560 000 tanga");
  assert.ok(d.getByText(/Adminlarning ishlari ham hisobga olingan/));
  fireEvent.click(d.getByRole("button", { name: "O'zgartirish" }));
  const edit = (await screen.findAllByRole("dialog")).at(-1)!;
  fireEvent.change(within(edit).getByLabelText(/Tuzatish, %/), { target: { value: "130" } });
  await waitFor(() => {
    const sims = calls.filter((c) => c.url.pathname === "/api/admin/pricing/slide/simulate");
    assert.deepEqual(sims.at(-1)?.body, { percent: 130, roundTo: 500, includeAdmins: true });
  });
});

/* ───────────────────────────── drawer ───────────────────────────── */

test("drawer: detail fetched with days=90, headline figures, ladder, trend chart, history; simulator is live and debounced", async () => {
  const calls = stubAll();
  renderPage(`${Q}&tool=slide`);
  const dialog = await screen.findByRole("dialog");
  const d = within(dialog);
  await d.findByText("Rasm generatsiyasi qimmatlashdi");
  const detailCall = calls.find((c) => c.url.pathname === "/api/admin/pricing/slide" && (c.init.method ?? "GET") === "GET");
  assert.ok(detailCall);
  assert.equal(detailCall.url.searchParams.get("days"), "90");
  assert.ok(d.getByText("Dilnoza Owner", { exact: false }));
  assert.ok(d.getByText("100% → 120%"));
  assert.ok(d.getByRole("img", { name: "Slayd: 90 kunlik tannarx trendi (so'm / ish)" }));
  assert.ok(d.getByText("3 600 tanga / ish"));
  // Both margins, their bases and the bonus cost are explained next to the numbers.
  assert.ok(d.getByText("3 500 tanga / tugallangan ish"), "primary basis: listed price of a completed job");
  assert.ok(d.getByText("ro'yxat narxi − tannarx − komissiya 2,5% (naqd qismdan); ustama komissiyadan keyingi tushum bo'yicha"));
  assert.ok(d.getByText("Naqd marja"));
  assert.ok(d.getByText("faqat naqd pul tushumi bo'yicha"));
  assert.ok(d.getByText("Bonus xarajati"));
  assert.ok(d.getByText("1 250 000 so'm"));
  assert.ok(d.getByText("ball ulushi 48% — ball bilan to'langan ishlarning tannarxi"));
  assert.ok(d.getByText("2 640 so'm / ish · 132 so'm / slayd"));
  assert.ok(d.getByText("tanlama: 1 400 ta tayyor ish"));
  // Simulator: the first call is for the current percent; typing 150 sends 150 after the debounce.
  await waitFor(() => assert.ok(calls.some((c) => c.url.pathname === "/api/admin/pricing/slide/simulate")));
  const sim0 = calls.filter((c) => c.url.pathname.endsWith("/simulate"));
  assert.deepEqual(sim0[0].body, { percent: 120, roundTo: 500 });
  await d.findByText("1 560 000 tanga");
  // Revenue is tanga; the margin compares its so'm value (× soumPerCoin = 2 here) with the so'm cost.
  assert.ok(d.getByText("= 3 120 000 so'm"));
  assert.ok(d.getByText(/so'mda, o'zgarmaydi/));
  // The simulator's margin is the table's: same revenue basis, fee deducted.
  assert.ok(d.getByText("jadvaldagi «Marja» bilan bir xil: komissiya 2,5% ayrilgan"));
  assert.ok(d.getByText(/tugallangan ishlarning ro'yxat narxi/));
  assert.ok(d.getByText("yaxlitlash 500 tanga"));
  fireEvent.change(d.getByLabelText("Tuzatish foizi"), { target: { value: "150" } });
  await waitFor(() => {
    const sims = calls.filter((c) => c.url.pathname.endsWith("/simulate"));
    assert.deepEqual(sims.at(-1)?.body, { percent: 150, roundTo: 500 });
  });
  await d.findByText("1 950 000 tanga");
  // The ladder compare shows base, current and the new price with the difference.
  const sim = d.getByRole("region", { name: "Simulyator" });
  assert.ok(within(sim).getByText("4 500"), "3 000 × 1.5");
  assert.ok(within(sim).getByText("+1 000"), "difference to the current 3 500");
  // Edit controls are present for the owner.
  assert.ok(d.getByRole("button", { name: "O'zgartirish" }));
  assert.equal((d.getByRole("button", { name: "100% ga qaytarish" }) as HTMLButtonElement).disabled, false);
});

test("viewer and finance: no edit controls in the drawer, read-only badge in the header", async () => {
  for (const role of ["viewer", "finance"] as const) {
    stubAll();
    renderPage(`${Q}&tool=essay`, role);
    const dialog = await screen.findByRole("dialog");
    assert.ok(screen.getByText("Faqat ko'rish"));
    assert.ok(!within(dialog).queryByRole("button", { name: "O'zgartirish" }), role);
    assert.ok(!within(dialog).queryByRole("button", { name: "100% ga qaytarish" }), role);
    assert.ok(within(dialog).getByText(/«Narxlarni o'zgartirish» ruxsati kerak/));
    cleanup();
  }
});

/* ───────────────────────────── edit flow ───────────────────────────── */

test("edit: PUT {percent, roundTo, reason}, toast, row and drawer updated without a reload", async () => {
  const calls = stubAll();
  renderPage(`${Q}&tool=essay`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "O'zgartirish" }));
  const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
  const dq = within(dialog);
  const confirm = dq.getByRole("button", { name: "Qo'llash" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true, "unchanged + no reason");
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "120" } });
  fireEvent.change(dq.getByLabelText("Yaxlitlash"), { target: { value: "1000" } });
  // Live preview from the simulate endpoint with the dialog's values.
  await waitFor(() => {
    const sims = calls.filter((c) => c.url.pathname === "/api/admin/pricing/essay/simulate");
    assert.deepEqual(sims.at(-1)?.body, { percent: 120, roundTo: 1000 });
  });
  await dq.findByText("30 kunlik prognoz");
  assert.ok(dq.getByText("5 000"), "4 000 × 1.2 = 4 800 → 5 000 at roundTo 1000");
  assert.ok(!dq.queryByLabelText(/deb yozing/), "no typed confirmation for +20 points");
  assert.equal(confirm.disabled, true, "reason still missing");
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Tannarx oshdi" } });
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1, "edit dialog closed, drawer stays"));
  const put = calls.find((c) => (c.init.method ?? "").toUpperCase() === "PUT");
  assert.ok(put);
  assert.equal(put.url.pathname, "/api/admin/pricing/essay");
  assert.deepEqual(put.body, { percent: 120, roundTo: 1000, reason: "Tannarx oshdi" });
  assert.ok(toasts().some((m) => m.includes("Insho: 100% → 120%")));
  // The table row shows the new adjustment and effective ladder; no second overview fetch.
  const essay = rowOf("Insho");
  assert.ok(within(essay).getByText("▲ 120%"));
  assert.ok(within(essay).getByText("2 000 – 5 000"));
  assert.equal(calls.filter((c) => c.url.pathname === "/api/admin/pricing").length, 1);
  // The drawer's reset button is now enabled.
  assert.equal((within(screen.getByRole("dialog")).getByRole("button", { name: "100% ga qaytarish" }) as HTMLButtonElement).disabled, false);
});

test("edit above ±50 points needs the new percent typed; wrong text keeps the button disabled", async () => {
  stubAll();
  renderPage(`${Q}&tool=essay`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "O'zgartirish" }));
  const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
  const dq = within(dialog);
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "160" } });
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Katta sinov o'zgarishi" } });
  const typed = await dq.findByLabelText(/deb yozing/);
  const confirm = dq.getByRole("button", { name: "Qo'llash" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(typed, { target: { value: "150" } });
  assert.equal(confirm.disabled, true, "wrong number");
  fireEvent.change(typed, { target: { value: "160" } });
  assert.equal(confirm.disabled, false);
  // Back under the threshold: the typed field disappears.
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "140" } });
  assert.ok(!dq.queryByLabelText(/deb yozing/));
});

test("edit: a server error stays inline; step-up 401 reauth asks once and replays the same PUT", async () => {
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return true;
  });
  let puts = 0;
  const calls = stubAll({
    onPut: (c) => {
      puts += 1;
      if (puts === 1) return json(400, { error: "Foiz 25 dan 1000 gacha butun son bo'lishi kerak" });
      if (puts === 2) return json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" });
      return json(200, { item: { toolId: "essay", title: "Insho", adjust: { percent: 110, roundTo: 500 }, ladder: simulation("essay", c.body!).ladder, history: [] } });
    },
  });
  renderPage(`${Q}&tool=essay`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "O'zgartirish" }));
  const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
  const dq = within(dialog);
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "110" } });
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Kichik tuzatish" } });
  fireEvent.click(dq.getByRole("button", { name: "Qo'llash" }));
  const alert = await dq.findByRole("alert");
  assert.equal(alert.textContent, "Foiz 25 dan 1000 gacha butun son bo'lishi kerak");
  fireEvent.click(dq.getByRole("button", { name: "Qo'llash" }));
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1));
  assert.equal(asked, 1);
  const putCalls = calls.filter((c) => (c.init.method ?? "").toUpperCase() === "PUT");
  assert.equal(putCalls.length, 3);
  assert.deepEqual(putCalls[1].body, putCalls[2].body);
});

/* ───────────────────────────── reset flow ───────────────────────────── */

test("reset: DELETE {reason}; 409 state reloads the overview", async () => {
  const calls = stubAll();
  renderPage(`${Q}&tool=slide`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "100% ga qaytarish" }));
  const dialog = (await screen.findAllByRole("dialog")).at(-1)!;
  const dq = within(dialog);
  assert.ok(dq.getByText("120% · 500 tanga"), "before");
  assert.ok(dq.getByText("100% · 500", { selector: "span.font-semibold" }), "after");
  assert.ok(dq.getByText("8 000", { selector: "td.font-semibold" }), "ladder back to base");
  const confirm = dq.getByRole("button", { name: "Qaytarish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Aksiya tugadi" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1));
  const del = calls.find((c) => (c.init.method ?? "").toUpperCase() === "DELETE");
  assert.ok(del);
  assert.equal(del.url.pathname, "/api/admin/pricing/slide");
  assert.deepEqual(del.body, { reason: "Aksiya tugadi" });
  assert.ok(toasts().some((m) => m.includes("100% ga qaytarildi")));
  assert.ok(within(rowOf("Slayd")).getByText("100%"));
  assert.equal((within(screen.getByRole("dialog")).getByRole("button", { name: "100% ga qaytarish" }) as HTMLButtonElement).disabled, true);
  cleanup();

  // 409: someone else already reset → the overview is reloaded.
  const calls2 = stubAll({ onDelete: () => json(409, { error: "Bu vosita allaqachon 100 % da", code: "state" }) });
  renderPage(`${Q}&tool=slide`);
  const drawer2 = await screen.findByRole("dialog");
  fireEvent.click(within(drawer2).getByRole("button", { name: "100% ga qaytarish" }));
  const dialog2 = (await screen.findAllByRole("dialog")).at(-1)!;
  fireEvent.change(within(dialog2).getByLabelText("Sabab"), { target: { value: "Aksiya tugadi" } });
  fireEvent.click(within(dialog2).getByRole("button", { name: "Qaytarish" }));
  // The overview is reloaded (its skeleton replaces the table, so the drawer and dialog unmount
  // and remount from the fresh data); the server's state wins.
  await waitFor(() => assert.equal(calls2.filter((c) => c.url.pathname === "/api/admin/pricing").length, 2, "overview reloaded"));
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1, "only the drawer remains"));
  assert.equal((within(screen.getByRole("dialog")).getByRole("button", { name: "100% ga qaytarish" }) as HTMLButtonElement).disabled, false, "fixture still says 120 %");
});
