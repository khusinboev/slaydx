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
import type { PriceAdjust, PricingDetail, PricingItem, PricingOverview, Simulation } from "../../lib/admin-api/pricing.ts";
import { PricingPage } from "../../components/admin/pricing/PricingPage.tsx";
import { attentionList, attentionOf } from "../../components/admin/pricing/attention.ts";
import { changeText, ladderRange, marginTone, parseSort, recommendationState, sortItems, trendChangePct, usdText, type RecContext } from "../../components/admin/pricing/shared.ts";
import { parsePercentText } from "../../components/admin/pricing/Simulator.tsx";

/**
 * S20 `/admin/pricing` as a decision panel (docs/admin/pricing-redesign.md):
 * the «Diqqat talab qiladi» strip (content, ranking, one path per entry), six
 * health KPIs with previous-period deltas and «?» hints, the tool table on
 * desktop and custom cards + a «Saralash» select on phones (CSS breakpoints:
 * both are in the DOM, visibility by `sm:` classes), the tool sheet (decision
 * block, cost composition, ladder, trend, simulator, history), the one-click
 * recommendation (confirm with reason, typed confirmation above ±50 points,
 * PUT payload with `expected`, 409 stale → reload, never without
 * `pricing.edit`, refused for stale / low-confidence / changed-in-period),
 * manual edit and reset, URL state, loading / error / forbidden / empty.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - ApplyRecommendationDialog sends the PUT on open, without the confirm → «apply from the strip» (no PUT before confirm);
 *   - the apply dialog's reason made optional → «apply from the strip» and «apply from the sheet» (reason required);
 *   - `expected` dropped from the apply PUT → «apply from the strip» / «apply from the sheet» (payload);
 *   - `onStale` not called on 409 → «apply from the sheet» (overview reloaded);
 *   - the "edited" / "changed-in-period" blocks removed from recommendationState → «blocked recommendations»;
 *   - attention sorted by impact only (severity ignored) → «attention: ranking».
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
  const node: ReactNode = h(AdminIdentityProvider, {
    value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null, twoFactor: true },
    children: h(
      AppRouterContext.Provider,
      { value: router },
      h(PathnameContext.Provider, { value: "/admin/pricing" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, h(PricingPage))),
    ),
  });
  return { ...render(node), calls };
}

const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const method = (c: Call) => (c.init.method ?? "GET").toUpperCase();

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
    costParts: [],
    unpricedCalls: 0,
    lastChangeAt: null,
    ...over,
  };
}

const ESSAY_LADDER = [
  { label: "1 varaq", base: 2000, effective: 2000 },
  { label: "2 varaq", base: 2500, effective: 2500 },
  { label: "5 varaq", base: 4000, effective: 4000 },
];

/** Healthy margin, recommendation −10 % (applicable), coverage 67 % → a «warning» entry. */
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
  costParts: [{ kind: "llm", soum: 800, sharePct: 100 }],
});

/** Low margin at 120 %, recommendation 265 % (+121 %, applicable, > 50 points) → «critical». */
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
  overheadSoum: 240,
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
  costParts: [
    { kind: "image", soum: 1800, sharePct: 68.18 },
    { kind: "llm", soum: 840, sharePct: 31.82 },
  ],
  unpricedCalls: 0,
  // Changed before the range (2026-03-10): the recommendation stands.
  lastChangeAt: "2026-02-20T05:00:00.000Z",
});

/** Recommendation −40 % but only 3 completed jobs: blocked as «kam ishonch». */
const RESUME = item({ toolId: "resume", title: "Rezyume", group: "umumiy", jobs: 3, completed: 3, marginPct: 80, fullCostSoum: 600, markup: 5, recommendedPercent: 60, sampleSize: 3 });

function overview(over: Partial<PricingOverview> = {}): PricingOverview {
  const totals: PricingOverview["totals"] = {
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
  };
  return {
    range: { from: "2026-03-10", to: "2026-03-12", days: 3 },
    items: [ESSAY, SLIDE, RESUME],
    totals,
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
    // Margin +5 p.p., revenue +30 %, AI cost +20 % (bad), cash margin and bonus flat.
    previous: {
      range: { from: "2026-03-07", to: "2026-03-09", days: 3 },
      totals: { ...totals, marginPct: 31.85, revenueSoum: 7_000_000, costSoumTools: 3_105_000 },
    },
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

const putResult = (toolId: string, body: Record<string, unknown>) =>
  json(200, { item: { toolId, title: toolId, adjust: { percent: body.percent, roundTo: body.roundTo }, ladder: simulation(toolId, body).ladder, history: [] } });

/** Default stub: overview, detail, simulate and mutations answered from the fixtures. */
function stubAll(opts: { onPut?: (c: Call) => Response; onDelete?: (c: Call) => Response; overview?: PricingOverview | (() => PricingOverview) } = {}): Call[] {
  return stubFetch((c) => {
    const p = c.url.pathname;
    if (p === "/api/admin/pricing" && method(c) === "GET") return json(200, typeof opts.overview === "function" ? opts.overview() : (opts.overview ?? overview()));
    const m = /^\/api\/admin\/pricing\/([^/]+)(\/simulate)?$/.exec(p);
    assert.ok(m, `kutilmagan so'rov: ${method(c)} ${p}`);
    const toolId = decodeURIComponent(m[1]);
    if (m[2]) return json(200, simulation(toolId, c.body ?? {}));
    if (method(c) === "GET") return json(200, detail(toolId));
    if (method(c) === "PUT") return opts.onPut ? opts.onPut(c) : putResult(toolId, c.body!);
    if (method(c) === "DELETE") return opts.onDelete ? opts.onDelete(c) : json(200, { item: { toolId, title: "Insho", adjust: { percent: 100, roundTo: 500 }, ladder: ESSAY_LADDER, history: [] } });
    throw new Error(`kutilmagan ${method(c)} ${p}`);
  });
}

const Q = "from=2026-03-10&to=2026-03-12";
const ready = async () => screen.findByRole("heading", { name: /^Vositalar \(\d+\)$/ });
/** House number format: thousands grouped with a no-break space (U+00A0). */
const nb = (s: string): string => s.replace(/(\d) (?=\d)/g, "$1\u00a0");
const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\u00a0/g, " ");
const rowOf = (title: string): HTMLElement => {
  const cell = screen.getAllByText(title, { selector: "b" }).find((el) => el.closest("tr"));
  assert.ok(cell, `${title} qatori yo'q`);
  return cell.closest("tr") as HTMLElement;
};
const cardOf = (container: HTMLElement, toolId: string): HTMLElement => {
  const card = container.querySelector(`[data-card-list] [data-card-key="${toolId}"]`);
  assert.ok(card, `${toolId} kartasi yo'q`);
  return card as HTMLElement;
};
const strip = () => screen.getByRole("region", { name: "Diqqat talab qiladi" });
const stripIds = () => Array.from(strip().querySelectorAll("[data-attention]")).map((el) => el.getAttribute("data-attention"));
const tileOf = (label: string): HTMLElement => screen.getByText(label, { selector: "span.uppercase" }).closest("div") as HTMLElement;
const lastDialog = async () => (await screen.findAllByRole("dialog")).at(-1)!;

const ctx = (over: Partial<RecContext> = {}): RecContext => ({ basis: new Map<string, PriceAdjust>(), rangeFrom: "2026-03-10", ...over });

/* ───────────────────────────── helpers (no DOM) ───────────────────────────── */

test("helpers: margin tone, ladder range, recommendation state and its blocks, change text, sort, trend, percent parsing", () => {
  assert.equal(marginTone(29.9), "danger");
  assert.equal(marginTone(30), "warning");
  assert.equal(marginTone(60), "warning");
  assert.equal(marginTone(60.1), "success");
  assert.equal(marginTone(null), "neutral");
  assert.equal(ladderRange(ESSAY_LADDER, "base"), nb("2 000 – 4 000"));
  assert.equal(ladderRange([], "base"), "—");

  // Recommendation: ±5 points is "ok"; otherwise the price change against the current price.
  assert.deepEqual(recommendationState({ ...ESSAY, recommendedPercent: 105 }, ctx()), { kind: "ok", target: 105 });
  assert.deepEqual(recommendationState({ ...ESSAY, recommendedPercent: null }, ctx()), { kind: "none" });
  const slide = recommendationState(SLIDE, ctx());
  assert.equal(slide.kind, "change");
  assert.ok(slide.kind === "change" && slide.direction === "up" && slide.target === 265 && slide.block === null);
  assert.equal(changeText(slide.kind === "change" ? slide.changePct : 0), "+121%", "265 ÷ 120 − 1");
  assert.equal(changeText(-10), "−10%");
  // Blocks, in priority order: edited after load, price changed inside the range, small sample.
  const edited = recommendationState({ ...SLIDE, adjust: { percent: 150, roundTo: 500 } }, ctx({ basis: new Map([["slide", SLIDE.adjust]]) }));
  assert.ok(edited.kind === "change" && edited.block === "edited");
  const inPeriod = recommendationState({ ...SLIDE, lastChangeAt: "2026-03-09T20:00:00.000Z" }, ctx());
  assert.ok(inPeriod.kind === "change" && inPeriod.block === "changed-in-period", "01:00 Tashkent on 03-10 is inside the range");
  const before = recommendationState({ ...SLIDE, lastChangeAt: "2026-03-09T18:00:00.000Z" }, ctx());
  assert.ok(before.kind === "change" && before.block === null, "23:00 Tashkent on 03-09 is before the range");
  const low = recommendationState(RESUME, ctx());
  assert.ok(low.kind === "change" && low.block === "low-confidence");

  assert.deepEqual(parseSort(null), { field: "margin", dir: "asc", value: "margin_asc" });
  assert.equal(parseSort("drop_table_desc").value, "margin_asc");
  const noMargin = item({ toolId: "keys", title: "Keys", group: "oqituvchi" });
  assert.deepEqual(sortItems([ESSAY, SLIDE, RESUME, noMargin], parseSort("margin_asc")).map((i) => i.toolId), ["slide", "essay", "resume", "keys"]);
  assert.deepEqual(sortItems([ESSAY, SLIDE, RESUME], parseSort("volume_desc")).map((i) => i.toolId), ["slide", "essay", "resume"]);
  assert.ok(Math.abs((trendChangePct(trend([700, 800, 900])) ?? 0) - 21.43) < 0.01);
  assert.equal(trendChangePct(trend([null, 800, 900])), null);
  assert.equal(parsePercentText("120"), 120);
  assert.equal(parsePercentText(" 7 "), 25, "clamped to the minimum");
  assert.equal(parsePercentText("5000"), 1000, "clamped to the maximum");
  assert.equal(parsePercentText("12.5"), null);
  assert.equal(usdText(310.5), "$310,50");
});

/** A loss, a tool without cost data and a below-target one, besides the three base tools. */
const THESIS = item({ toolId: "thesis", title: "Tezis", group: "talaba", jobs: 42, completed: 40, avgRevenueSoum: 2000, fullCostSoum: 2240, marginPct: -12, markup: 0.88, recommendedPercent: 340, sampleSize: 40, confidence: "ok", coveragePct: 100 });
const ARTICLE = item({ toolId: "article", title: "Maqola", group: "umumiy", jobs: 125, completed: 120, avgRevenueSoum: 6000, sampleSize: 120, confidence: "ok", coveragePct: 0 });
const IMAGE = item({ toolId: "image", title: "Rasm", group: "media", jobs: 100, completed: 100, avgRevenueSoum: 800, fullCostSoum: 400, marginPct: 50, markup: 2, recommendedPercent: 150, sampleSize: 100, confidence: "ok", coveragePct: 100 });
const ALL = [ESSAY, SLIDE, RESUME, THESIS, ARTICLE, IMAGE];

test("attention: ranking by severity then money at stake; one reason per tool; nothing for healthy or empty tools", () => {
  const list = attentionList(ALL, { ...ctx(), targetMarkup: 3 });
  assert.deepEqual(
    list.map((e) => [e.item.toolId, e.kind, e.severity]),
    [
      // critical: slide's gap to target (1,674 × 2 640 × 1 400 ≈ 6,2 mln) outweighs the thesis loss (12 % × 80 000).
      ["slide", "low-margin", "critical"],
      ["thesis", "loss", "critical"],
      // warning: 720 000 of revenue without cost data, then essay's 33 % uncovered revenue (≈ 453 000).
      ["article", "no-cost", "warning"],
      ["essay", "low-coverage", "warning"],
      // info: below target (40 000) and the blocked, low-confidence overpricing (3 600).
      ["image", "below-target", "info"],
      ["resume", "overpriced", "info"],
    ],
  );
  assert.ok(Math.abs(list[1].impactSoum - 9600) < 1e-6, "loss impact = 12 % × 2 000 × 40");
  // Unpriced calls outrank coverage; a low margin without an applicable recommendation is only "info".
  assert.equal(attentionOf({ ...IMAGE, unpricedCalls: 3, recommendedPercent: 100 }, { ...ctx(), targetMarkup: 3 })?.kind, "unpriced");
  assert.equal(attentionOf({ ...SLIDE, confidence: "low" }, { ...ctx(), targetMarkup: 3 })?.severity, "info");
  // Healthy (recommendation within 15 %), or no completed jobs: nothing to decide.
  assert.equal(attentionOf({ ...IMAGE, recommendedPercent: 110 }, { ...ctx(), targetMarkup: 3 }), null);
  assert.equal(attentionOf(item({ toolId: "keys", title: "Keys", group: "oqituvchi" }), { ...ctx(), targetMarkup: 3 }), null);
});

/* ───────────────────────────── page states ───────────────────────────── */

test("loading skeleton, then the strip, the KPIs with deltas and «?» hints, the table; the fine print is collapsed", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const calls = stubFetch(async (c) => {
    await gate;
    assert.equal(c.url.pathname, "/api/admin/pricing");
    return json(200, overview({ items: ALL }));
  });
  const { container } = renderPage(Q);
  assert.ok(container.querySelector('[aria-busy="true"]'), "loading skeleton");
  release();
  await ready();
  assert.equal(calls[0].url.searchParams.get("from"), "2026-03-10");

  // The strip comes first, before the KPIs: five entries, the sixth counted.
  const kpis = screen.getByRole("region", { name: /^Asosiy ko'rsatkichlar/ });
  assert.ok(strip().compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_FOLLOWING, "the strip comes before the KPIs");
  assert.deepEqual(stripIds(), ["slide", "thesis", "article", "essay", "image"]);
  assert.match(text(strip()), /Yana 1 ta vosita/);
  const slideEntry = strip().querySelector('[data-attention="slide"]') as HTMLElement;
  assert.match(text(slideEntry), /Slayd · Marja past: 22%/);
  assert.match(text(slideEntry), /Ustama 1,3× · maqsad 3,0×/);
  assert.ok(within(slideEntry).getByRole("button", { name: "Tavsiyani qo'llash: Slayd, narx +121%" }));
  assert.match(text(strip().querySelector('[data-attention="thesis"]')), /Zarar: marja -12%/);
  assert.match(text(strip().querySelector('[data-attention="article"]')), /Tannarx yozilmayapti.*120 ta tayyor ish tannarxsiz/);
  assert.ok(within(strip().querySelector('[data-attention="article"]') as HTMLElement).getByRole("button", { name: "Ko'rish: Maqola" }));
  assert.ok(!within(strip().querySelector('[data-attention="article"]') as HTMLElement).queryByRole("button", { name: /Tavsiyani qo'llash/ }), "no recommendation without cost");

  // Six KPIs, settings folded into one; deltas against the previous period.
  for (const label of ["Marja", "Naqd marja", "Tushum", "AI xarajat", "Bonus xarajati", "Maqsadli ustama"]) assert.ok(tileOf(label), label);
  assert.ok(!screen.queryByText("Kurs (so'm / USD)"), "no separate FX tile");
  assert.match(text(tileOf("Marja")), /36,9%.*\+5 p\.p\..*1 ta vosita tannarxsiz/);
  assert.match(text(tileOf("Tushum")), /9 100 000 so'm.*\+30%/);
  const cost = tileOf("AI xarajat");
  assert.match(text(cost), /3 726 000 so'm.*\+20%.*\$310,50/);
  assert.ok(cost.querySelector(".text-destructive"), "more AI cost is bad");
  assert.match(text(tileOf("Maqsadli ustama")), /3,0×.*komissiya 2,5% · \$1 = 12 000 so'm/);
  // «?» opens a short basis; Escape closes it.
  fireEvent.click(button("Izoh: Marja"));
  const note = screen.getByRole("note");
  assert.match(text(note), /ball bilan to'langani ham.*komissiyasi 2,5%.*Tannarxi o'lchanmagan: Maqola/);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(!screen.queryByRole("note"));
  assert.ok(!document.body.textContent?.includes("pricing.payment_fee_percent"), "never a raw setting key");

  // Table: 7 columns, margin ascending → Slayd first.
  const table = screen.getByRole("table", { name: "Vositalar bo'yicha narx va tannarx" });
  assert.equal(table.querySelectorAll(":scope > thead > tr > th").length, 7);
  const rows = Array.from(table.querySelectorAll(":scope > tbody > tr"));
  assert.match(text(rows[0]), /^Tezis/);
  const slide = rowOf("Slayd");
  assert.match(text(slide), /3 500 – 9 500.*120% · asosiy 3 000 – 8 000/);
  assert.match(text(slide), /2 640 so'm.*132 so'm \/ slayd/);
  assert.match(text(slide), /22% \(past\)/);
  assert.ok(within(slide).getByRole("img", { name: "Ustama 1,3×, maqsad 3,0×" }));
  assert.match(text(slide), /\+121%/);
  assert.ok(within(slide).getByRole("button", { name: /Tavsiyani qo'llash: Slayd/ }));
  assert.match(text(rowOf("Rezyume")), /−40%.*kam ishonch/);
  assert.ok(!within(rowOf("Rezyume")).queryByRole("button", { name: /Tavsiyani qo'llash/ }), "low confidence: not one click");
  assert.match(text(rowOf("Maqola")), /tannarx yo'q/);

  // No wall of text: the glossary and the data limitations are collapsed disclosures.
  const notes = Array.from(container.querySelectorAll("details"));
  assert.equal(notes.length, 2);
  assert.ok(notes.every((d) => !d.open));
  assert.match(text(notes[1].querySelector("summary")), /Ma'lumot cheklovlari \(2\)/);
  fireEvent.click(notes[1].querySelector("summary")!);
  assert.ok(screen.getByText("Birinchi cheklov."));
});

test("phone: custom tool cards (not the generic label/value list) and a «Saralash» select; desktop: the table", async () => {
  stubAll();
  const { container, calls } = renderPage(Q);
  await ready();
  // Both layouts are in the DOM; the breakpoint decides (kit DataTable: table `hidden sm:block`, cards `sm:hidden`).
  const tableBox = screen.getByRole("table", { name: "Vositalar bo'yicha narx va tannarx" }).parentElement!;
  assert.ok(tableBox.className.includes("hidden") && tableBox.className.includes("sm:block"));
  const cards = container.querySelector("[data-card-list]")!;
  assert.ok(cards.className.includes("sm:hidden"));
  const slide = cardOf(container, "slide");
  assert.ok(!slide.querySelector("dl"), "custom card, not the generic list");
  assert.match(text(slide), /Slayd.*3 500 – 9 500 tanga · 120%/);
  assert.match(text(slide), /22% \(past\)/);
  assert.match(text(slide), /Tannarx 2 640 so'm \/ ish · 1 460 ish/);
  const apply = within(slide).getByRole("button", { name: /Tavsiyani qo'llash: Slayd/ });
  assert.ok(apply.className.includes("max-sm:min-h-11"), "44 px on phones");
  // A card tap opens the sheet; the button inside it does not.
  fireEvent.click(apply);
  assert.ok(!calls.replace.some((u) => u.includes("tool=")), "Qo'llash is not a card tap");
  assert.ok((await lastDialog()).textContent?.includes("Tavsiyani qo'llash — Slayd"));
  fireEvent.click(within(await lastDialog()).getByRole("button", { name: "Bekor qilish" }));
  fireEvent.click(slide);
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&tool=slide`);
  // Phone sort.
  const select = screen.getByLabelText("Saralash") as HTMLSelectElement;
  assert.ok(select.closest(".sm\\:hidden"), "the select is phone-only");
  assert.ok(select.className.includes("h-11"));
  fireEvent.change(select, { target: { value: "cost_desc" } });
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&sort=cost_desc`);
});

test("error state shows the request id and retry reloads; forbidden renders Ruxsat yo'q", async () => {
  let n = 0;
  stubFetch(() => {
    n += 1;
    return n === 1 ? json(500, { error: "Kutilmagan xatolik", requestId: "req-pricing-1" }) : json(200, overview());
  });
  renderPage(Q);
  assert.ok(await screen.findByText("Kutilmagan xatolik"));
  assert.ok(screen.getByText(/req-pricing-1/));
  fireEvent.click(button("Qayta urinish"));
  await ready();
  cleanup();

  stubFetch(() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" }));
  renderPage(Q);
  assert.ok(await screen.findByText("Ruxsat yo'q"));
  assert.ok(!screen.queryByLabelText("Vosita guruhi"), "filters hidden when forbidden");
  assert.ok(!screen.queryByRole("region", { name: "Diqqat talab qiladi" }));
});

test("empty: a group with no tools shows the empty state and a calm strip; no completed jobs says so", async () => {
  stubAll();
  const { calls } = renderPage(`${Q}&group=oqituvchi`);
  await ready();
  assert.ok(await screen.findByText("Bu guruhda vosita yo'q"));
  assert.match(text(strip()), /Hammasi me'yorda/);
  const clears = screen.getAllByRole("button", { name: "Filtrlarni tozalash" });
  assert.equal(clears.length, 2);
  fireEvent.click(clears[1]);
  assert.equal(calls.replace.at(-1), "/admin/pricing");
  cleanup();

  const base = overview();
  stubAll({ overview: overview({ items: [item({ toolId: "keys", title: "Keys", group: "oqituvchi" })], totals: { ...base.totals, completed: 0, marginPct: null } }) });
  renderPage(Q);
  await ready();
  assert.match(text(strip()), /Bu davrda tugallangan ish yo'q/);
});

/* ───────────────────────────── URL state ───────────────────────────── */

test("filters and sort live in the URL: group select, column sort, row click and «Ko'rish» open the sheet via ?tool=", async () => {
  stubAll({ overview: overview({ items: ALL }) });
  const { calls } = renderPage(Q);
  await ready();
  fireEvent.change(screen.getByLabelText("Vosita guruhi"), { target: { value: "talaba" } });
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&group=talaba`);
  fireEvent.click(screen.getByRole("button", { name: /^Ishlar/ }));
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&sort=volume_desc`);
  fireEvent.click(screen.getByRole("button", { name: /^Marja · ustama/ }));
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&sort=margin_desc`);
  fireEvent.click(rowOf("Insho"));
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&tool=essay`);
  fireEvent.click(button("Ko'rish: Maqola"));
  assert.equal(calls.replace.at(-1), `/admin/pricing?${Q}&tool=article`);
});

test("a group filter narrows the strip too", async () => {
  stubAll({ overview: overview({ items: ALL }) });
  renderPage(`${Q}&group=talaba`);
  await ready();
  assert.deepEqual(stripIds(), ["thesis", "essay"]);
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

test("«Adminlar bilan»: off by default; the checkbox writes ?admins=1; the note says how many admin jobs are in or out; clear resets it", async () => {
  const calls = stubAll();
  const { calls: nav } = renderPage(Q);
  await ready();
  assert.equal(calls[0].url.searchParams.get("admins"), null);
  const box = screen.getByRole("checkbox", { name: "Adminlar bilan" }) as HTMLInputElement;
  assert.equal(box.checked, false);
  assert.ok(screen.getByText("Adminlarning 41 ta tugallangan ishi hisobga olinmagan."));
  fireEvent.click(box);
  assert.equal(nav.replace.at(-1), `/admin/pricing?${Q}&admins=1`);
  cleanup();

  const calls2 = stubAll({ overview: overview({ includeAdmins: true }) });
  const second = renderPage(`${Q}&admins=1`);
  await ready();
  assert.equal(calls2[0].url.searchParams.get("admins"), "1");
  assert.ok(screen.getByText("Adminlarning 41 ta tugallangan ishi ham hisobga olingan."));
  fireEvent.click(screen.getByRole("button", { name: "Filtrlarni tozalash" }));
  assert.equal(second.calls.replace.at(-1), "/admin/pricing");
});

/* ───────────────────────────── tool sheet ───────────────────────────── */

test("sheet: decision block first, economics, cost composition, ladder, 90-day trend, simulator, history; admins switch reaches it", async () => {
  const calls = stubAll({ overview: overview({ includeAdmins: true }) });
  renderPage(`${Q}&admins=1&tool=slide`);
  const dialog = await screen.findByRole("dialog");
  const d = within(dialog);
  await d.findByText("Rasm generatsiyasi qimmatlashdi");
  const detailCall = calls.find((c) => c.url.pathname === "/api/admin/pricing/slide" && method(c) === "GET");
  assert.equal(detailCall?.url.searchParams.get("days"), "90");
  assert.equal(detailCall?.url.searchParams.get("admins"), "1");
  assert.match(text(dialog), /3 500 – 9 500 tanga · birlik: slayd · 1 460 ish/);
  // Decision block: the first section, with the margin, the markup bar and the recommendation.
  const decision = d.getByRole("region", { name: "Holat" });
  assert.equal(dialog.querySelector("section"), decision, "the decision comes first");
  assert.match(text(decision), /Marja.*22,4% \(past\)/);
  assert.ok(within(decision).getByRole("img", { name: "Ustama 1,3×, maqsad 3,0×" }));
  assert.match(text(decision), /Tavsiya \+121%.*Tuzatish 120% → 265%.*Tanlama: 1 400 ta tayyor ish/);
  assert.ok(within(decision).getByRole("button", { name: /Tavsiyani qo'llash: Slayd/ }));
  // Economics in one list.
  assert.ok(d.getByText("3 600 tanga / ish"));
  assert.ok(d.getByText("3 500 tanga / tayyor ish"));
  assert.ok(d.getByText("2 640 so'm / ish · 132 so'm / slayd"));
  assert.ok(d.getByText("1 250 000 so'm · ball ulushi 48%"));
  // Cost composition from the overview item.
  assert.match(text(dialog), /Rasm\s*1 800 so'm\s*68%/);
  assert.match(text(dialog), /Matn \(LLM\)\s*840 so'm\s*32%/);
  // Trend and history.
  assert.ok(d.getByRole("img", { name: "Slayd: 90 kunlik tannarx trendi (so'm / ish)" }));
  assert.ok(d.getByText("100% → 120%"));
  // Simulator: live (debounced) with the switch.
  await waitFor(() => assert.deepEqual(calls.filter((c) => c.url.pathname.endsWith("/simulate")).at(-1)?.body, { percent: 120, roundTo: 500, includeAdmins: true }));
  await d.findByText("1 560 000 tanga");
  fireEvent.change(d.getByLabelText("Tuzatish foizi"), { target: { value: "150" } });
  await waitFor(() => assert.deepEqual(calls.filter((c) => c.url.pathname.endsWith("/simulate")).at(-1)?.body, { percent: 150, roundTo: 500, includeAdmins: true }));
  await d.findByText("1 950 000 tanga");
  const sim = d.getByRole("region", { name: "Simulyator" });
  assert.ok(within(sim).getByText("+1 000"), "difference to the current 3 500");
  // A «?» inside the sheet: Escape closes the tip, not the sheet.
  fireEvent.click(d.getByRole("button", { name: "Izoh: Simulyator qanday hisoblaydi" }));
  assert.match(text(screen.getByRole("note")), /Adminlarning ishlari ham kiritilgan/);
  fireEvent.keyDown(document, { key: "Escape" });
  assert.ok(!screen.queryByRole("note"));
  assert.equal(screen.getAllByRole("dialog").length, 1, "the sheet stays open");
  // Footer actions for the owner.
  assert.ok(d.getByRole("button", { name: "O'zgartirish" }));
  assert.equal((d.getByRole("button", { name: "100% ga qaytarish" }) as HTMLButtonElement).disabled, false);
});

test("viewer and finance: no edit controls and no «Qo'llash» anywhere; read-only badge", async () => {
  for (const role of ["viewer", "finance"] as const) {
    stubAll({ overview: overview({ items: ALL }) });
    renderPage(`${Q}&tool=slide`, role);
    const dialog = await screen.findByRole("dialog");
    assert.ok(screen.getByText("Faqat ko'rish"));
    assert.ok(!within(dialog).queryByRole("button", { name: "O'zgartirish" }), role);
    assert.ok(!within(dialog).queryByRole("button", { name: "100% ga qaytarish" }), role);
    assert.ok(!screen.queryByRole("button", { name: /Tavsiyani qo'llash/ }), `${role}: no one-click apply`);
    assert.match(text(strip()), /\+121%/, "the recommendation is still shown");
    assert.ok(within(dialog).getByText(/«Narxlarni o'zgartirish» ruxsati kerak/));
    cleanup();
  }
});

/* ───────────────────────────── one-click recommendation ───────────────────────────── */

test("apply from the strip: before/after ladder and margin, reason and typed confirmation required, PUT with expected, row patched", async () => {
  const calls = stubAll();
  renderPage(Q);
  await ready();
  fireEvent.click(within(strip()).getByRole("button", { name: /Tavsiyani qo'llash: Slayd/ }));
  const dialog = await lastDialog();
  const dq = within(dialog);
  assert.match(text(dialog), /Tavsiyani qo'llash — Slayd/);
  assert.match(text(dialog), /Narx \+121%: ustama 1,3× dan maqsadli 3,0× ga/);
  assert.match(text(dialog), /120% · 500 tanga.*265% · 500 tanga/);
  // Preview from the simulate endpoint with the recommended percent.
  await waitFor(() => assert.deepEqual(calls.filter((c) => c.url.pathname === "/api/admin/pricing/slide/simulate").at(-1)?.body, { percent: 265, roundTo: 500 }));
  assert.ok(await dq.findByText("21 000"), "30 slayd: 8 000 × 2,65 = 21 200 → 21 000");
  assert.match(text(dialog), /Marja · 30 kun prognozi:\s*82,1%.*94,2%/);
  // Nothing is sent before the confirm; the reason and (> 50 points) the typed percent are required.
  assert.equal(calls.filter((c) => method(c) === "PUT").length, 0, "no PUT before confirm");
  const confirm = dq.getByRole("button", { name: "Qo'llash" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(dq.getByLabelText(/deb yozing/), { target: { value: "265" } });
  assert.equal(confirm.disabled, true, "reason still missing");
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Tav" } });
  assert.equal(confirm.disabled, true, "reason shorter than 5");
  fireEvent.change(dq.getByLabelText(/deb yozing/), { target: { value: "260" } });
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Tavsiya: ustamani maqsadga" } });
  assert.equal(confirm.disabled, true, "wrong typed percent");
  fireEvent.change(dq.getByLabelText(/deb yozing/), { target: { value: "265" } });
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(screen.queryAllByRole("dialog").length, 0, "dialog closed"));
  const puts = calls.filter((c) => method(c) === "PUT");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].url.pathname, "/api/admin/pricing/slide");
  // The same endpoint as the manual edit, with the adjustment that was shown as the precondition.
  assert.deepEqual(puts[0].body, { percent: 265, roundTo: 500, reason: "Tavsiya: ustamani maqsadga", expected: { percent: 120, roundTo: 500 } });
  assert.ok(toasts().some((m) => m.includes("Slayd: 120% → 265%")));
  // Row patched without a reload; the applied percent now equals the recommendation.
  assert.match(text(rowOf("Slayd")), /265% · asosiy/);
  assert.match(text(rowOf("Slayd")), /Mos/);
  assert.ok(!within(rowOf("Slayd")).queryByRole("button", { name: /Tavsiyani qo'llash/ }));
  assert.equal(calls.filter((c) => c.url.pathname === "/api/admin/pricing").length, 1);
});

test("apply from the sheet: 409 stale → error toast and the overview reloads; the dialog does not reapply", async () => {
  const calls = stubAll({ onPut: () => json(409, { error: "Narx boshqa admin tomonidan o'zgartirilgan. Sahifani yangilab, qayta ko'rib chiqing.", code: "stale" }) });
  renderPage(`${Q}&tool=essay`);
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(within(sheet).getByRole("button", { name: /Tavsiyani qo'llash: Insho/ }));
  const dialog = await lastDialog();
  assert.match(text(dialog), /100% · 500 tanga.*90% · 500 tanga/);
  assert.ok(!within(dialog).queryByLabelText(/deb yozing/), "−10 points: no typed confirmation");
  assert.equal((within(dialog).getByRole("button", { name: "Qo'llash" }) as HTMLButtonElement).disabled, true, "reason required");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Ustama maqsaddan yuqori" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Qo'llash" }));
  await waitFor(() => assert.equal(calls.filter((c) => c.url.pathname === "/api/admin/pricing").length, 2, "overview reloaded"));
  assert.ok(toasts().some((m) => m.includes("boshqa admin tomonidan o'zgartirilgan")));
  const put = calls.find((c) => method(c) === "PUT");
  assert.deepEqual(put?.body, { percent: 90, roundTo: 500, reason: "Ustama maqsaddan yuqori", expected: { percent: 100, roundTo: 500 } });
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1, "only the sheet remains"));
  assert.equal(calls.filter((c) => method(c) === "PUT").length, 1);
});

test("blocked recommendations: price changed inside the range, low confidence → shown with the reason, never one click", async () => {
  const changed = { ...SLIDE, lastChangeAt: "2026-03-11T08:00:00.000Z" };
  stubAll({ overview: overview({ items: [ESSAY, changed, RESUME] }) });
  renderPage(`${Q}&tool=slide`);
  const sheet = await screen.findByRole("dialog");
  assert.match(text(rowOf("Slayd")), /\+121%.*narx davr ichida o'zgargan/);
  assert.ok(!screen.queryByRole("button", { name: /Tavsiyani qo'llash: Slayd/ }));
  assert.match(text(within(sheet).getByRole("region", { name: "Holat" })), /Narx shu davr ichida o'zgargan/);
  // In the strip: slide's low margin without a one-click path drops to "info"; the reason is its hover text.
  assert.ok(stripIds().includes("slide"));
  assert.match(text(rowOf("Rezyume")), /kam ishonch/);
  assert.ok(!screen.queryByRole("button", { name: /Tavsiyani qo'llash: Rezyume/ }));
});

/* ───────────────────────────── manual edit and reset ───────────────────────────── */

test("edit: PUT {percent, roundTo, reason, expected}, toast, row and sheet updated without a reload; the recommendation turns stale", async () => {
  const calls = stubAll();
  renderPage(`${Q}&tool=essay`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await lastDialog();
  const dq = within(dialog);
  const confirm = dq.getByRole("button", { name: "Qo'llash" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true, "unchanged + no reason");
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "120" } });
  fireEvent.change(dq.getByLabelText("Yaxlitlash"), { target: { value: "1000" } });
  await waitFor(() => assert.deepEqual(calls.filter((c) => c.url.pathname === "/api/admin/pricing/essay/simulate").at(-1)?.body, { percent: 120, roundTo: 1000 }));
  await dq.findByText("30 kunlik prognoz");
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Tannarx oshdi" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1, "edit dialog closed, sheet stays"));
  const put = calls.find((c) => method(c) === "PUT");
  assert.deepEqual(put?.body, { percent: 120, roundTo: 1000, reason: "Tannarx oshdi", expected: { percent: 100, roundTo: 500 } });
  assert.ok(toasts().some((m) => m.includes("Insho: 100% → 120%")));
  assert.match(text(rowOf("Insho")), /2 000 – 5 000.*120% · asosiy/);
  assert.match(text(rowOf("Insho")), /yangilang/);
  assert.equal(calls.filter((c) => c.url.pathname === "/api/admin/pricing").length, 1);
  assert.equal((within(screen.getByRole("dialog")).getByRole("button", { name: "100% ga qaytarish" }) as HTMLButtonElement).disabled, false);
});

test("edit above ±50 points needs the new percent typed; wrong text keeps the button disabled", async () => {
  stubAll();
  renderPage(`${Q}&tool=essay`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "O'zgartirish" }));
  const dq = within(await lastDialog());
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "160" } });
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Katta sinov o'zgarishi" } });
  const typed = await dq.findByLabelText(/deb yozing/);
  const confirm = dq.getByRole("button", { name: "Qo'llash" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(typed, { target: { value: "150" } });
  assert.equal(confirm.disabled, true, "wrong number");
  fireEvent.change(typed, { target: { value: "160" } });
  assert.equal(confirm.disabled, false);
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "140" } });
  assert.ok(!dq.queryByLabelText(/deb yozing/));
});

test("edit: a server error stays inline; step-up 401 reauth asks once and replays the same PUT; 409 stale reloads", async () => {
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
      return putResult("essay", c.body!);
    },
  });
  renderPage(`${Q}&tool=essay`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "O'zgartirish" }));
  const dq = within(await lastDialog());
  fireEvent.change(dq.getByLabelText(/Tuzatish, %/), { target: { value: "110" } });
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Kichik tuzatish" } });
  fireEvent.click(dq.getByRole("button", { name: "Qo'llash" }));
  assert.equal((await dq.findByRole("alert")).textContent, "Foiz 25 dan 1000 gacha butun son bo'lishi kerak");
  fireEvent.click(dq.getByRole("button", { name: "Qo'llash" }));
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1));
  assert.equal(asked, 1);
  const putCalls = calls.filter((c) => method(c) === "PUT");
  assert.equal(putCalls.length, 3);
  assert.deepEqual(putCalls[1].body, putCalls[2].body);
  cleanup();

  const calls2 = stubAll({ onPut: () => json(409, { error: "Narx boshqa admin tomonidan o'zgartirilgan.", code: "stale" }) });
  renderPage(`${Q}&tool=essay`);
  const drawer2 = await screen.findByRole("dialog");
  fireEvent.click(within(drawer2).getByRole("button", { name: "O'zgartirish" }));
  const dq2 = within(await lastDialog());
  fireEvent.change(dq2.getByLabelText(/Tuzatish, %/), { target: { value: "110" } });
  fireEvent.change(dq2.getByLabelText("Sabab"), { target: { value: "Kichik tuzatish" } });
  fireEvent.click(dq2.getByRole("button", { name: "Qo'llash" }));
  await waitFor(() => assert.equal(calls2.filter((c) => c.url.pathname === "/api/admin/pricing").length, 2, "overview reloaded"));
});

test("reset: DELETE {reason}; 409 state reloads the overview", async () => {
  const calls = stubAll();
  renderPage(`${Q}&tool=slide`);
  const drawer = await screen.findByRole("dialog");
  fireEvent.click(within(drawer).getByRole("button", { name: "100% ga qaytarish" }));
  const dq = within(await lastDialog());
  assert.ok(dq.getByText("120% · 500 tanga"), "before");
  assert.ok(dq.getByText("100% · 500", { selector: "span.font-semibold" }), "after");
  const confirm = dq.getByRole("button", { name: "Qaytarish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(dq.getByLabelText("Sabab"), { target: { value: "Aksiya tugadi" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1));
  const del = calls.find((c) => method(c) === "DELETE");
  assert.deepEqual(del?.body, { reason: "Aksiya tugadi" });
  assert.ok(toasts().some((m) => m.includes("100% ga qaytarildi")));
  assert.match(text(rowOf("Slayd")), /asosiy narx/);
  assert.equal((within(screen.getByRole("dialog")).getByRole("button", { name: "100% ga qaytarish" }) as HTMLButtonElement).disabled, true);
  cleanup();

  const calls2 = stubAll({ onDelete: () => json(409, { error: "Bu vosita allaqachon 100 % da", code: "state" }) });
  renderPage(`${Q}&tool=slide`);
  const drawer2 = await screen.findByRole("dialog");
  fireEvent.click(within(drawer2).getByRole("button", { name: "100% ga qaytarish" }));
  const dialog2 = await lastDialog();
  fireEvent.change(within(dialog2).getByLabelText("Sabab"), { target: { value: "Aksiya tugadi" } });
  fireEvent.click(within(dialog2).getByRole("button", { name: "Qaytarish" }));
  await waitFor(() => assert.equal(calls2.filter((c) => c.url.pathname === "/api/admin/pricing").length, 2, "overview reloaded"));
  await waitFor(() => assert.equal(screen.getAllByRole("dialog").length, 1, "only the drawer remains"));
});
