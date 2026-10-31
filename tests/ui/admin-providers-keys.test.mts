import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import type { ProviderItem, ProvidersResponse, PurposeItem, RouteItem, UsageTotals } from "../../lib/admin-api/providers.ts";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ProvidersPage } from "../../components/admin/providers/ProvidersPage.tsx";
import { keyProblem } from "../../components/admin/providers/ProviderDialogs.tsx";
import { buildCategories, kpis, parseTab, providerFigures, worstVerdict } from "../../components/admin/providers/categories.ts";
import { compact, keyState, moneyText, providerStatus, routeText, sameEntries, unitText, usageLine } from "../../components/admin/providers/format.ts";

/**
 * `/admin/providers` «Provayderlar va AI sozlamalari» (program-17 decision D7, redesigned 2026-10-31):
 *   - loading / error / forbidden; the summary tiles; one PURPOSE card per vazifa with its verdict («Yetarli» /
 *     «Yetarli, zaxirasiz» / «Yetarli emas»), the providers that serve it and the editor of its routing slots;
 *   - one PROVIDER card each with the billing badge (To'lovli / Bepul), the need badge, the real status, the price note,
 *     the usage of the chosen period and every action: switch, key in / replace / delete, live test;
 *   - the routing editor: change a model, add a fallback, reorder, remove, save (reason + step-up -> PUT `{entries, reason}`),
 *     discard, reset to default (only when the admin's choice is stored), warnings when nothing in the chain works;
 *   - roles without edit rights see everything and no control; a typed key is never shown again (DOM, toast).
 * After every write the page reloads, so verdicts and numbers always come from the server.
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
  owner: ["settings.view", "settings.edit"],
  finance: ["settings.view"],
  viewer: ["settings.view"],
} as const;
type Role = keyof typeof PERMS;

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };
function stubFetch(responders: Array<(c: Call) => Response | Promise<Response>>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), init, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} };
    calls.push(c);
    const next = responders[calls.length - 1];
    assert.ok(next, `kutilmagan ${calls.length}-so'rov: ${String(url)}`);
    return next(c);
  }) as typeof fetch;
  return calls;
}

function mount(node: ReactNode, role: Role = "owner", query = "") {
  window.history.replaceState(null, "", `/admin/providers${query}`);
  render(
    h(AdminIdentityProvider, {
      value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null, twoFactor: true },
      children: h(SearchParamsContext.Provider, { value: new URLSearchParams(query) as never }, node),
    }),
  );
}

const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

/* ───────────────────────────── fixtures ───────────────────────────── */

const tot = (calls: number, usd: number, extra: Partial<UsageTotals> = {}): UsageTotals => ({ calls, errors: null, inputTokens: 0, outputTokens: 0, units: 0, usd, ...extra });
const DAILY = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(18 + i).padStart(2, "0")}`, calls: i, usd: i / 10 }));

const item = (p: Partial<ProviderItem> & Pick<ProviderItem, "id" | "label">): ProviderItem => ({
  kinds: ["llm"],
  implemented: true,
  testable: true,
  keyFormat: "sk-…",
  enabled: true,
  hasDbKey: false,
  keyHint: null,
  envPresent: false,
  keySource: "none",
  unreadable: false,
  updatedBy: null,
  updatedAt: null,
  usable: false,
  billing: "paid",
  priceNote: "$2 kirish / $10 chiqish (1M token)",
  role: "Test provayder.",
  need: "optional",
  keyless: false,
  keyUrl: null,
  purposes: [],
  breaker: null,
  usage: { today: tot(0, 0), d7: tot(0, 0), d30: tot(0, 0), lastDay: null, kinds: [], models: [], daily: DAILY.map((d) => ({ ...d, calls: 0, usd: 0 })) },
  ...p,
});

const GEMINI = item({
  id: "gemini",
  label: "Google Gemini",
  kinds: ["llm", "image", "tts"],
  envPresent: true,
  keySource: "env",
  usable: true,
  need: "required",
  role: "Asosiy motor: barcha matn vositalari.",
  purposes: ["text", "tts", "image"],
  usage: {
    today: tot(120, 3.5, { inputTokens: 2_000_000, outputTokens: 400_000 }),
    d7: tot(900, 21.25),
    d30: tot(10_276, 70.91, { inputTokens: 90_000_000, outputTokens: 12_000_000, units: 169 }),
    lastDay: "2026-10-31",
    kinds: [
      { kind: "llm", calls: 9847, units: 0, inputTokens: 90_000_000, outputTokens: 12_000_000, usd: 57.95 },
      { kind: "image", calls: 169, units: 169, inputTokens: 0, outputTokens: 0, usd: 5.75 },
    ],
    models: [{ model: "gemini-3.7-flash", kind: "llm", calls: 9847, usd: 57.95 }],
    daily: DAILY,
  },
});
const ANTHROPIC = item({
  id: "anthropic",
  label: "Anthropic (Claude)",
  hasDbKey: true,
  keyHint: "…a1B2",
  keySource: "db",
  usable: true,
  need: "recommended",
  purposes: ["text"],
  updatedBy: "Dilnoza Admin",
  updatedAt: "2026-10-01T09:30:00.000Z",
  usage: { today: tot(0, 0), d7: tot(60, 3), d30: tot(241, 12.02), lastDay: "2026-10-30", kinds: [{ kind: "llm", calls: 241, units: 0, inputTokens: 1, outputTokens: 1, usd: 12.02 }], models: [], daily: DAILY },
});
const PEXELS = item({
  id: "pexels",
  label: "Pexels",
  kinds: ["image"],
  enabled: false,
  envPresent: true,
  billing: "free",
  priceNote: "Bepul · soatiga 200 so'rov limiti bor",
  need: "recommended",
  purposes: ["stock"],
  usage: { today: tot(4, 0, { errors: 0 }), d7: tot(40, 0, { errors: 1 }), d30: tot(120, 0, { errors: 3 }), lastDay: "2026-10-29", kinds: [{ kind: "requests", calls: 120, units: 0, inputTokens: 0, outputTokens: 0, usd: 0 }], models: [], daily: DAILY },
});
const AZURE = item({ id: "azure", label: "Azure Speech", kinds: ["tts"], billing: "free-tier", priceNote: "$16 / 1M belgi · oyiga 500 ming belgi bepul (F0 tarif)", purposes: ["tts"], usage: { ...GEMINI.usage, today: tot(0, 0), d7: tot(0, 0), d30: tot(0, 0), lastDay: null, kinds: [] } });
const KLING = item({ id: "kling", label: "Kling (video)", kinds: ["video"], testable: false, purposes: ["video"] });
const OPENALEX = item({ id: "openalex", label: "OpenAlex", kinds: ["research"], billing: "free", keyless: true, usable: true, need: "recommended", purposes: ["sources"], priceNote: "Bepul" });
const ITEMS = [GEMINI, ANTHROPIC, PEXELS, AZURE, KLING];

const entry = (provider: string, label: string, model: string | null, usable = true) => ({ provider, label, model, usable });
const MODELS = [
  { provider: "gemini", model: "gemini-3.7-flash", inUsdPerM: 0.75, outUsdPerM: 3.75, perImageUsd: null },
  { provider: "gemini", model: "gemini-3.1-pro", inUsdPerM: 2, outUsdPerM: 12, perImageUsd: null },
  { provider: "anthropic", model: "claude-sonnet-5", inUsdPerM: 2, outUsdPerM: 10, perImageUsd: null },
];
const WRITER: RouteItem = {
  id: "llm.writer",
  title: "Yozuvchi",
  help: "Matn yozadi.",
  shape: "chain",
  max: 4,
  providers: [
    { id: "gemini", label: "Google Gemini" },
    { id: "anthropic", label: "Anthropic (Claude)" },
  ],
  models: MODELS,
  usable: { gemini: true, anthropic: true },
  source: "env",
  entries: [entry("gemini", "Google Gemini", "gemini-3.7-flash")],
  fallbackEntries: [entry("gemini", "Google Gemini", "gemini-3.7-flash")],
  updatedBy: null,
  updatedAt: null,
};
const MODEL: RouteItem = { ...WRITER, id: "llm.model", title: "Asosiy matn modeli", shape: "model", max: 1, source: "default", providers: [{ id: "gemini", label: "Google Gemini" }] };
const TTS_ORDER: RouteItem = {
  id: "tts.order",
  title: "Ovoz provayderlari tartibi",
  help: "Birinchisi ishlamasa keyingisi o'qiydi.",
  shape: "order",
  max: 3,
  providers: [
    { id: "azure", label: "Azure Speech" },
    { id: "gemini", label: "Google Gemini" },
  ],
  models: [],
  usable: { azure: false, gemini: true },
  source: "db",
  entries: [entry("azure", "Azure Speech", null, false), entry("gemini", "Google Gemini", null)],
  fallbackEntries: [entry("azure", "Azure Speech", null, false), entry("gemini", "Google Gemini", null)],
  updatedBy: "Dilnoza Admin",
  updatedAt: "2026-10-30T10:00:00.000Z",
};

const purpose = (p: Partial<PurposeItem> & Pick<PurposeItem, "id" | "title">): PurposeItem => ({
  summary: "Test vazifa.",
  need: "required",
  minimum: "Bittasi yetarli.",
  fallback: true,
  providerIds: [],
  premiumIds: [],
  verdict: "ok",
  headline: "Yetarli",
  detail: "Google Gemini ishlayapti.",
  setting: null,
  routes: [],
  ...p,
});
const TEXT = purpose({ id: "text", title: "Matn yozish va baholash", providerIds: ["gemini", "anthropic"], detail: "Google Gemini + Anthropic (Claude) ishlayapti — zaxira bor.", routes: [MODEL, WRITER] });
const TTS = purpose({
  id: "tts",
  title: "Ovoz (TTS)",
  need: "recommended",
  providerIds: ["azure", "gemini"],
  verdict: "single",
  headline: "Yetarli, zaxirasiz",
  detail: "Faqat Google Gemini ishlayapti: u to'xtasa bu vazifa ham to'xtaydi.",
  routes: [TTS_ORDER],
});
const VIDEO = purpose({
  id: "video",
  title: "Video yaratish",
  need: "optional",
  fallback: false,
  providerIds: ["kling"],
  verdict: "off",
  headline: "Sozlamalarda o'chirilgan",
  detail: "Ixtiyoriy vosita.",
  setting: { key: "video.enabled", label: "Video yaratish yoqilgan", enabled: false },
});
const IMAGE = purpose({ id: "image", title: "Rasm chizish", providerIds: ["gemini"], detail: "Google Gemini ishlayapti." });
const STOCK = purpose({ id: "stock", title: "Stok fotolar", need: "recommended", providerIds: ["pexels"], detail: "Pexels ishlamayapti.", verdict: "missing", headline: "Yetarli emas" });
const BODY: ProvidersResponse = {
  items: ITEMS,
  purposes: [TEXT, IMAGE, STOCK, TTS, VIDEO],
  system: {
    processes: [{ process: "web-1", role: "web", lastSeenAt: "2026-10-31T10:00:00.000Z", stale: false }],
    breakers: [{ process: "web-1", name: "gemini", state: "closed", openUntil: null, failures: 0, stale: false }],
    limiters: [{ process: "worker-1", name: "llm", active: 1, waiting: 0, max: 4, stale: false }],
  },
  otherUsage: [{ provider: "xai", calls: 3, usd: 0.05 }],
  total30: { calls: 10_637, usd: 82.93 },
  soumPerUsd: 12_700,
  generatedAt: "2026-10-31T10:00:00.000Z",
  canStoreKeys: true,
  sealingKey: "provider",
  propagationSec: 30,
};

const cardOf = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-provider="${id}"]`);
  assert.ok(el, `${id} kartasi yo'q`);
  return el;
};
const TAB_NAME = { overview: /^Umumiy/, text: /^Matn/, image: /^Rasm/, tts: /^Ovoz/, video: /^Video/, sources: /^Ilmiy/, listen: /^Tinglash/ } as const;
const openTab = (id: keyof typeof TAB_NAME) => fireEvent.click(screen.getByRole("tab", { name: TAB_NAME[id] }));
const editRoute = (title: string) => fireEvent.click(screen.getByRole("button", { name: `${title}: tahrirlash` }));
const routeOf = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-route="${id}"]`);
  assert.ok(el, `${id} sozlamasi ko'rinmayapti`);
  return el;
};
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const ready = async () => screen.findByRole("tablist"); // rendered only once the data is in
const SECRET = "Zq7Kp9Xw3Lm5Rt8Vb2NcQ9ZZ";
/** Testing Library collapses every whitespace run (so'm has a no-break space) before matching. */
const norm = (t: string): string => t.replace(/\s+/g, " ");

/* ───────────────────────────── helpers (no DOM) ───────────────────────────── */

test("keyProblem mirrors the server's key check", () => {
  assert.equal(keyProblem(""), null);
  assert.equal(keyProblem(SECRET), null);
  assert.match(keyProblem("short") ?? "", /qisqa/);
  assert.match(keyProblem("a".repeat(513)) ?? "", /uzun/);
  assert.match(keyProblem("abcd efgh ijkl") ?? "", /bo'sh joy/);
  assert.match(keyProblem("kalit-ўзбек-1234") ?? "", /ASCII/);
});

test("a keyless provider without a key works and says so", () => {
  assert.deepEqual(keyState(OPENALEX), { tone: "neutral", label: "Kalitsiz ishlaydi" });
  assert.equal(providerStatus(OPENALEX).label, "Ishlayapti");
  assert.deepEqual(keyState({ ...OPENALEX, keyless: false }), { tone: "neutral", label: "Yo'q" }, "only a provider that really works without a key");
  assert.equal(keyState({ ...OPENALEX, hasDbKey: true, keyHint: "…z9Y8", keySource: "db" }).label, "Bazada …z9Y8", "a stored key still shows");
});

test("keyState: Bazada …a1B2 / Serverda (env) / Yo'q / unreadable", () => {
  assert.deepEqual(keyState(ANTHROPIC), { tone: "success", label: "Bazada …a1B2" });
  assert.deepEqual(keyState({ ...ANTHROPIC, keyHint: null }), { tone: "success", label: "Bazada" });
  assert.deepEqual(keyState(GEMINI), { tone: "info", label: "Serverda (env)" });
  assert.deepEqual(keyState(KLING), { tone: "neutral", label: "Yo'q" });
  assert.equal(keyState({ ...ANTHROPIC, unreadable: true, envPresent: true }).tone, "warning");
  assert.match(keyState({ ...ANTHROPIC, unreadable: true, envPresent: true }).label, /Env ishlatiladi/);
});

test("providerStatus tells what the provider can do now and why not", () => {
  assert.deepEqual(providerStatus(GEMINI), { tone: "success", label: "Ishlayapti" });
  assert.equal(providerStatus(PEXELS).label, "O'chirilgan");
  assert.equal(providerStatus(KLING).label, "Kalit yo'q");
  assert.equal(providerStatus({ ...GEMINI, breaker: { state: "open", openUntil: null } }).label, "Vaqtincha to'xtagan");
  assert.equal(providerStatus({ ...ANTHROPIC, unreadable: true, usable: false, keySource: "none" }).label, "Kalit o'qilmaydi");
  assert.equal(providerStatus({ ...AZURE, keySource: "env", usable: false }).label, "To'liq sozlanmagan", "a key without its region");
});

test("usage figures: money for paid providers, request counts for free ones", () => {
  assert.equal(compact(1_234_567), "1,2 mln");
  assert.equal(compact(25_000), "25 ming");
  assert.equal(compact(950), "950");
  const paid = usageLine(GEMINI, GEMINI.usage.d30, 12_700);
  assert.equal(paid.primary, moneyText(70.91, 12_700));
  assert.ok(paid.secondary.some((s) => s.includes("so'rov")) && paid.secondary.some((s) => s.includes("token")), paid.secondary.join("|"));
  assert.ok(!paid.secondary.some((s) => s.includes("ta rasm")), "units are shown per kind, never summed across images, voice characters and searches");
  assert.equal(unitText("image", 169), "169 ta rasm");
  assert.equal(unitText("tts", 25_000), "25 ming ta belgi");
  assert.equal(unitText("llm", 5), null);
  assert.equal(unitText("image", 0), null);
  const free = usageLine(PEXELS, PEXELS.usage.d30, 12_700);
  assert.match(free.primary, /^120 ta so'rov$/);
  assert.ok(free.secondary.includes("3 ta xato"));
});

test("routeText and sameEntries", () => {
  assert.equal(routeText([{ provider: "g", label: "Gemini", model: "m1" }, { provider: "a", label: "Claude", model: null }]), "Gemini · m1 → Claude");
  assert.ok(sameEntries([{ provider: "g", model: "m" }], [{ provider: "g", model: "m" }]));
  assert.ok(!sameEntries([{ provider: "g", model: "m" }], [{ provider: "g", model: "n" }]));
  assert.ok(!sameEntries([{ provider: "g", model: null }], [{ provider: "g", model: null }, { provider: "a", model: null }]));
});

/* ───────────────────────────── states ───────────────────────────── */

test("loading: skeleton first", async () => {
  stubFetch([() => new Promise<Response>(() => {})]);
  mount(h(ProvidersPage));
  assert.ok(document.querySelector('[aria-busy="true"]'));
});

test("error: message + request id, retry loads again; forbidden: «Ruxsat yo'q»", async () => {
  const calls = stubFetch([() => json(500, { error: "Ichki xatolik", requestId: "req-909" }), () => json(200, BODY)]);
  mount(h(ProvidersPage));
  await screen.findByText("Ichki xatolik");
  assert.ok(screen.getByText("req-909"));
  fireEvent.click(button("Qayta urinish"));
  await ready();
  assert.equal(calls.length, 2);
  cleanup();
  stubFetch([() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" })]);
  mount(h(ProvidersPage));
  await screen.findByText("Ruxsat yo'q");
});

/* ───────────────────────────── the page ───────────────────────────── */

test("ready: KPI tiles, overview table with a verdict per category, tab dots", async () => {
  const calls = stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  assert.equal(calls[0].url, "/api/admin/providers");

  const summary = within(document.querySelector<HTMLElement>("[data-summary]")!);
  assert.ok(summary.getByText(norm(moneyText(82.93, 12_700))), "30-day total in USD and so'm");
  assert.ok(summary.getByText("Matn (LLM) · 92%"), "biggest category with its share of the attributed spend (69,97 of 75,72)");
  assert.ok(summary.getByText(/Google Gemini \$57,95 · Anthropic \(Claude\) \$12,02/), "its two biggest providers");
  assert.ok(summary.getByText("2 / 5") && summary.getByText("2 to'lovli · 0 bepul"), "usable: gemini and anthropic");
  assert.ok(summary.getByText("2 ta"), "attention: stock without a working provider and voice without a fallback");
  assert.ok(summary.getByText("Stok fotolar: yetarli emas"), "the first reason is named");

  // The tablist has the overview first, and one dot per category = the worst verdict of its purposes.
  const tabs = screen.getAllByRole("tab");
  assert.deepEqual(tabs.map((t) => t.textContent?.replace(/ — .*$/, "")), ["Umumiy", "Matn (LLM)", "Rasm", "Ovoz", "Video"]);
  const dot = (id: keyof typeof TAB_NAME) => screen.getByRole("tab", { name: TAB_NAME[id] }).querySelector("[data-tab-dot]")?.getAttribute("data-tab-dot");
  assert.equal(dot("text"), "ok");
  assert.equal(dot("image"), "missing", "stock is missing");
  assert.equal(dot("tts"), "single");
  assert.equal(dot("video"), "off");
  assert.ok(!screen.getByRole("tab", { name: TAB_NAME.overview }).querySelector("[data-tab-dot]"), "the overview has no dot");

  const row = (id: string) => within(document.querySelector<HTMLElement>(`[data-category="${id}"]`)!);
  assert.equal(document.querySelectorAll("[data-category]").length, 4);
  assert.ok(row("text").getByText("Yetarli") && row("text").getByText("Google Gemini") && row("text").getByText("Anthropic (Claude)"), "primary and fallback");
  assert.ok(row("text").getByText("$69,97"), "30-day spend of the category");
  assert.ok(row("tts").getByText("Yetarli, zaxirasiz"));
  assert.ok(row("tts").getByText("— (yo'q)"), "no second working voice");
  assert.ok(row("video").getByText("O'chirilgan"));
  assert.ok(document.querySelector("[data-other-usage]")?.textContent?.includes("xai"), "history of removed providers stays visible");
  assert.ok(screen.getByText(/^Tizim holati \(/), "system health is at the bottom of the overview");
  assert.equal(document.querySelector<HTMLDetailsElement>("details[data-system]")!.open, false, "folded by default");
  assert.ok(!screen.queryByRole("alert"), "sealing key present: no warning");
});

test("tabs: «Ochish» switches, the tab is in the URL and survives a reload, arrow keys move, unknown ?tab= is the overview", async () => {
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.overview }).getAttribute("aria-selected"), "true");
  assert.equal(window.location.search, "");
  fireEvent.click(within(document.querySelector<HTMLElement>('[data-category="tts"]')!).getByRole("button", { name: "Ochish: Ovoz" }));
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.tts }).getAttribute("aria-selected"), "true");
  assert.equal(window.location.search, "?tab=tts");
  assert.ok(document.querySelector("[data-provider='azure']") && !document.querySelector("[data-category]"), "the voice table, not the overview");
  openTab("overview");
  assert.equal(window.location.search, "", "overview leaves the URL clean");
  openTab("video");
  assert.equal(window.location.search, "?tab=video");

  // Keyboard: roving tabindex + arrows (Tabs primitive), the URL follows.
  const video = screen.getByRole("tab", { name: TAB_NAME.video });
  assert.equal(video.getAttribute("tabindex"), "0");
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.text }).getAttribute("tabindex"), "-1");
  fireEvent.keyDown(video, { key: "ArrowLeft" });
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.tts }).getAttribute("aria-selected"), "true");
  assert.equal(window.location.search, "?tab=tts");
  fireEvent.keyDown(screen.getByRole("tab", { name: TAB_NAME.tts }), { key: "Home" });
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.overview }).getAttribute("aria-selected"), "true");
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.overview }).ownerDocument.activeElement, screen.getByRole("tab", { name: TAB_NAME.overview }), "focus follows");

  // Reload: a fresh mount with ?tab= opens that tab.
  cleanup();
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage), "owner", "?tab=tts");
  await ready();
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.tts }).getAttribute("aria-selected"), "true");
  assert.ok(document.querySelector("[data-provider='azure']"));
  cleanup();
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage), "owner", "?tab=nope");
  await ready();
  assert.equal(screen.getByRole("tab", { name: TAB_NAME.overview }).getAttribute("aria-selected"), "true");
  assert.equal(parseTab("listen"), "listen");
  assert.equal(parseTab(null), "overview");
});

test("category tab: banner, provider rows with billing / status / key / usage, route order and spend bars", async () => {
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  const banner = within(document.querySelector<HTMLElement>('[aria-label="Toifa holati"]')!);
  assert.ok(banner.getByText("Yetarli") && banner.getByText(/zaxira bor/) && banner.getByText(/Yetarlilik:/));
  assert.equal(document.querySelectorAll("[data-provider]").length, 2, "only the text providers");

  const gemini = within(cardOf("gemini"));
  assert.ok(gemini.getByText("To'lovli") && gemini.getByText("Majburiy") && gemini.getByText("Ishlayapti"));
  assert.ok(gemini.getByText(/\$2 kirish/), "price note in the name cell");
  assert.equal(gemini.getByRole("switch").getAttribute("aria-checked"), "true");
  assert.equal(cardOf("gemini").querySelector("[data-key-state]")!.textContent, "Serverda (env)");
  assert.ok(gemini.getByRole("button", { name: "Kalitni kiritish" }) && gemini.getByRole("button", { name: "Tekshirish" }));
  assert.ok(!gemini.queryByRole("button", { name: "O'chirish" }), "nothing stored: nothing to delete");
  // Gemini serves text AND voice: in the Matn tab its 30-day figure is the text share only ($57,95), not the $70,91 total.
  assert.ok(gemini.getByText("$57,95") && !gemini.queryByText("$70,91"), "30 days are split by kind across tabs");
  assert.ok(gemini.getByText("9 847 ta so'rov"));

  const claude = within(cardOf("anthropic"));
  assert.equal(cardOf("anthropic").querySelector("[data-key-state]")!.textContent, "Bazada …a1B2");
  assert.ok(claude.getByRole("button", { name: "Almashtirish" }) && claude.getByRole("button", { name: "O'chirish" }));
  assert.ok(claude.getByText("Dilnoza Admin") && claude.getByText(/01\.10\.2026 14:30/), "who changed it, Tashkent time");

  // Right column: numbered route entries with state, then the spend bars.
  const slot = within(document.querySelector<HTMLElement>('[data-route-slot="llm.writer"]')!);
  assert.ok(slot.getByText("Yozuvchi") && slot.getByText("Google Gemini · gemini-3.7-flash") && slot.getByText("Ishlayapti"));
  assert.equal(document.querySelector("[data-route-slot='llm.writer'] [data-entry='0']")!.getAttribute("data-usable"), "1");
  const spend = [...document.querySelectorAll("[data-spend-row]")].map((r) => r.textContent ?? "");
  assert.equal(spend.length, 2, "gemini image belongs to the Rasm tab, not here");
  assert.ok(spend[0].includes("Google Gemini · Matn") && spend[0].includes("$57,95"));
  assert.ok(spend[1].includes("Anthropic (Claude) · Matn") && spend[1].includes("$12,02"));
  assert.equal(document.querySelector("[data-spend-total]")!.textContent, "$69,97");
  assert.equal((document.querySelector("[data-spend-row] [data-bar]") as HTMLElement).style.width, "83%");

  // Free provider, switched off, in the image tab.
  openTab("image");
  const pexels = within(cardOf("pexels"));
  assert.ok(pexels.getByText("Bepul") && pexels.getByText("O'chirilgan"));
  assert.equal(cardOf("pexels").getAttribute("data-usable"), "0");
  assert.ok(pexels.getByText("120 ta so'rov"), "free providers: requests, not money");
  const rows = [...document.querySelectorAll("[data-spend-row]")].map((r) => r.textContent ?? "");
  assert.ok(rows.some((r) => /Pexels · So'rovlar.*Bepul/.test(r)) && rows.some((r) => /Google Gemini · Rasm.*\$5,75/.test(r)), rows.join("|"));

  openTab("tts");
  assert.ok(within(cardOf("azure")).getByText("Bepul limit bilan"));
  assert.match(document.querySelector<HTMLElement>('[aria-label="Toifa holati"]')!.textContent ?? "", /to'xtasa bu vazifa ham to'xtaydi/);
  openTab("video");
  assert.ok(!within(cardOf("kling")).queryByRole("button", { name: "Tekshirish" }), "no live test for kling");
  assert.ok(screen.getByText("Sozlamalar", { selector: "a" }), "the flag lives in Sozlamalar");
  assert.ok(screen.getByText(/30 kunda bu toifada so'rov bo'lmagan/));
});

test("the period switch changes the usage figures (today / 7 / 30), shared providers say so", async () => {
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  assert.ok(within(cardOf("gemini")).getByText("$57,95"), "30 days by default");
  fireEvent.click(screen.getByRole("radio", { name: "Bugun" }));
  assert.ok(within(cardOf("gemini")).getByText("$3,50"));
  assert.match(cardOf("gemini").textContent ?? "", /barcha toifalar/, "no per-kind split for today: the total is shown and labelled");
  fireEvent.click(screen.getByRole("radio", { name: "7 kun" }));
  assert.ok(within(cardOf("gemini")).getByText("$21,25"));
  assert.ok(!/barcha toifalar/.test(cardOf("anthropic").textContent ?? ""), "a single-tab provider is never labelled shared");
  fireEvent.click(screen.getByRole("radio", { name: "30 kun" }));
  assert.ok(within(cardOf("gemini")).getByText("$57,95"));
});

test("categories model: worst verdict, tab mapping, primary/fallback, kpis", () => {
  assert.equal(worstVerdict(["ok", "single"]), "single");
  assert.equal(worstVerdict(["ok", "missing", "single"]), "missing");
  assert.equal(worstVerdict(["off", "ok"]), "ok", "an off purpose is not a problem");
  assert.equal(worstVerdict(["off", "off"]), "off");
  const cats = buildCategories(BODY);
  assert.deepEqual(cats.map((c) => c.id), ["text", "image", "tts", "video"]);
  assert.deepEqual(cats.find((c) => c.id === "image")!.purposes.map((p) => p.id), ["image", "stock"], "image + stock = Rasm");
  const merged = buildCategories({ ...BODY, purposes: [...BODY.purposes, purpose({ id: "stt", title: "Tinglash" }), purpose({ id: "search", title: "Qidiruv", verdict: "single", fallback: false })] });
  assert.equal(merged.find((c) => c.id === "image")!.verdict, "missing", "worst of the two");
  assert.equal(merged.find((c) => c.id === "listen")!.verdict, "single", "stt + search = Tinglash va qidiruv");
  const tts = cats.find((c) => c.id === "tts")!;
  assert.equal(tts.primary, "Google Gemini", "the voice order decides, and azure is down");
  assert.equal(tts.fallback, "— (yo'q)");
  assert.equal(cats.find((c) => c.id === "text")!.fallback, "Anthropic (Claude)");
  const k = kpis(BODY, cats);
  assert.deepEqual([k.usable, k.total, k.paidUsable, k.freeUsable, k.attention], [2, 5, 2, 0, 2]);
  assert.deepEqual(k.top && [k.top.label, k.top.share], ["Matn (LLM)", 92]);
  assert.equal(providerFigures(GEMINI, "tts", "d30", 2).usd, 0, "gemini has no voice kind in the fixture");
  assert.equal(providerFigures(GEMINI, "text", "d30", 1).usd, 70.91, "a single-tab provider shows its total");
});

test("no sealing key: warning, key buttons disabled, switches still work; fallback key: recommendation only then", async () => {
  stubFetch([() => json(200, { ...BODY, canStoreKeys: false, sealingKey: "none" })]);
  mount(h(ProvidersPage));
  await ready();
  openTab("video");
  assert.ok(document.querySelector("[data-crypto-missing]"));
  assert.match(screen.getByRole("alert").textContent ?? "", /PROVIDER_KEYS_KEY/);
  assert.equal(within(cardOf("kling")).getByRole("button", { name: "Kalitni kiritish" }).hasAttribute("disabled"), true);
  assert.equal(within(cardOf("kling")).getByRole("switch").hasAttribute("disabled"), false);
  cleanup();
  stubFetch([() => json(200, { ...BODY, sealingKey: "admin" })]);
  mount(h(ProvidersPage));
  await ready();
  assert.match(document.querySelector("[data-key-fallback]")?.textContent ?? "", /Tavsiya: serverda PROVIDER_KEYS_KEY o'rnating/);
  assert.ok(!document.querySelector("[data-crypto-missing]"));
});

test("viewer and finance: read only -- no switch, no buttons, no editor, no key hint", async () => {
  for (const role of ["viewer", "finance"] as const) {
    stubFetch([() => json(200, { ...BODY, items: ITEMS.map((i) => ({ ...i, keyHint: null })) })]);
    mount(h(ProvidersPage), role);
    await ready();
    for (const tab of ["text", "image", "tts", "video"] as const) {
      openTab(tab);
      assert.equal(screen.queryAllByRole("switch").length, 0, `${role}/${tab}`);
      for (const name of [/Kalitni kiritish/, /Almashtirish/, /^O'chirish/, /Tekshirish/, /Saqlash/, /Zaxira qo'shish/, /tahrirlash/, /Yuqoriga/]) {
        assert.equal(screen.queryAllByRole("button", { name }).length, 0, `${role}/${tab}: ${String(name)}`);
      }
      assert.equal(document.querySelectorAll("select").length, 0, `${role}/${tab}: no selects`);
    }
    assert.ok(screen.getByText(/faqat ko'rish huquqi/));
    openTab("text");
    assert.equal(cardOf("anthropic").querySelector("[data-key-state]")!.textContent, "Bazada", `${role}: no hint`);
    assert.ok(!document.body.textContent?.includes("a1B2"));
    assert.ok(within(document.querySelector<HTMLElement>('[data-route-slot="llm.writer"]')!).getByText("Google Gemini · gemini-3.7-flash"), `${role}: the order is still readable`);
    cleanup();
  }
});

/* ───────────────────────────── routing editor ───────────────────────────── */

test("«Tahrirlash» swaps one slot for its editor inline; «Yopish» goes back; the other slots stay summaries", async () => {
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  assert.equal(document.querySelectorAll("select").length, 0, "summaries only");
  editRoute("Yozuvchi");
  assert.equal(routeOf("llm.writer").querySelectorAll("select").length, 1);
  assert.ok(screen.getByRole("button", { name: "Asosiy matn modeli: tahrirlash" }), "others still folded");
  assert.equal(routeOf("llm.writer").getAttribute("data-source"), "env");
  assert.ok(within(routeOf("llm.writer")).getByText("Server sozlamasi (env)"));
  fireEvent.click(screen.getByRole("button", { name: "Yopish" }));
  assert.equal(document.querySelectorAll("select").length, 0);
  openTab("tts");
  assert.ok(screen.getByRole("button", { name: "Ovoz provayderlari tartibi: tahrirlash" }));
});

test("chain editor: change the model, add a fallback, reorder, remove; save sends exactly {entries, reason} and reloads", async () => {
  const saved: RouteItem = {
    ...WRITER,
    source: "db",
    entries: [entry("anthropic", "Anthropic (Claude)", "claude-sonnet-5"), entry("gemini", "Google Gemini", "gemini-3.7-flash")],
    updatedBy: "Admin",
    updatedAt: "2026-10-31T10:00:00.000Z",
  };
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(200, { route: saved }),
    () => json(200, { ...BODY, purposes: [{ ...TEXT, routes: [MODEL, saved] }, TTS, VIDEO] }),
  ]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  editRoute("Yozuvchi");
  const editor = within(routeOf("llm.writer"));
  assert.ok(!editor.queryByRole("button", { name: "Saqlash" }) || (editor.getByRole("button", { name: "Saqlash" }) as HTMLButtonElement).disabled, "nothing changed yet");

  fireEvent.click(editor.getByRole("button", { name: "Zaxira qo'shish" }));
  assert.equal(routeOf("llm.writer").querySelectorAll("[data-entry]").length, 2);
  assert.ok(editor.getByText("Zaxira 1"));
  const first = editor.getByLabelText("Yozuvchi: 1-qator") as HTMLSelectElement;
  assert.ok([...first.options].some((o) => o.textContent?.includes("$0,75 / $3,75 (1M token)")), "every option shows its price");
  fireEvent.change(editor.getByLabelText("Yozuvchi: 2-qator"), { target: { value: "anthropic|claude-sonnet-5" } });
  fireEvent.click(editor.getByRole("button", { name: "Anthropic (Claude)ni yuqoriga" }));
  assert.equal((editor.getByLabelText("Yozuvchi: 1-qator") as HTMLSelectElement).value, "anthropic|claude-sonnet-5");

  fireEvent.click(editor.getByRole("button", { name: "Saqlash" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getAllByText(/Google Gemini · gemini-3\.7-flash/).length >= 1, "before and after both name it");
  assert.ok(within(dialog).getByText(/Anthropic \(Claude\) · claude-sonnet-5 → Google Gemini · gemini-3\.7-flash/), "after");
  assert.equal(within(dialog).getByRole("button", { name: "Saqlash" }).hasAttribute("disabled"), true, "reason missing");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Baholovchi Claude bo'lsin" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Saqlash" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/providers/routes/llm.writer");
  assert.equal(calls[1].init.method, "PUT");
  assert.deepEqual(calls[1].body, {
    entries: [
      { provider: "anthropic", model: "claude-sonnet-5" },
      { provider: "gemini", model: "gemini-3.7-flash" },
    ],
    reason: "Baholovchi Claude bo'lsin",
  });
  await waitFor(() => assert.equal(calls.length, 3), { timeout: 2000 });
  assert.ok(toasts().some((m) => m.includes("30 soniyagacha")));
  await waitFor(() => assert.equal(routeOf("llm.writer").getAttribute("data-source"), "db"));
});

test("chain editor guards: duplicates cannot be saved, the last row cannot be removed, discard restores, reset only for a stored choice", async () => {
  const stored: RouteItem = { ...WRITER, source: "db", entries: [entry("gemini", "Google Gemini", "gemini-3.7-flash"), entry("anthropic", "Anthropic (Claude)", "claude-sonnet-5")], fallbackEntries: WRITER.entries };
  const calls = stubFetch([
    () => json(200, { ...BODY, purposes: [{ ...TEXT, routes: [stored] }] }),
    () => json(200, { route: { ...WRITER } }),
    () => json(200, BODY),
  ]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  editRoute("Yozuvchi");
  const editor = within(routeOf("llm.writer"));
  assert.ok(editor.getByRole("button", { name: "Standartga qaytarish" }), "stored choice -> reset offered");

  fireEvent.change(editor.getByLabelText("Yozuvchi: 2-qator"), { target: { value: "gemini|gemini-3.7-flash" } });
  assert.ok(editor.getByText(/ikki marta/));
  assert.equal((editor.getByRole("button", { name: "Saqlash" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(editor.getByRole("button", { name: "Bekor qilish" }));
  assert.equal((editor.getByLabelText("Yozuvchi: 2-qator") as HTMLSelectElement).value, "anthropic|claude-sonnet-5", "discard restores");

  fireEvent.click(editor.getByRole("button", { name: "Anthropic (Claude)ni olib tashlash" }));
  assert.equal((editor.getByRole("button", { name: "Google Geminini olib tashlash" }) as HTMLButtonElement).disabled, true, "the last row stays");

  fireEvent.click(editor.getByRole("button", { name: "Standartga qaytarish" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Eski holatga" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Qaytarish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/providers/routes/llm.writer");
  assert.equal(calls[1].init.method, "DELETE");
  assert.deepEqual(calls[1].body, { reason: "Eski holatga" });
});

test("model slot: one select, no list controls; voice order: every voice listed, reorder only", async () => {
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  editRoute("Asosiy matn modeli");
  const model = within(routeOf("llm.model"));
  assert.equal(routeOf("llm.model").querySelectorAll("select").length, 1);
  assert.ok(!model.queryByRole("button", { name: /yuqoriga|pastga|olib tashlash|qo'shish/ }), "a single model has no list controls");

  openTab("tts");
  editRoute("Ovoz provayderlari tartibi");
  const order = within(routeOf("tts.order"));
  assert.ok(order.getByText("Birinchi") && order.getByText("Zaxira 1"));
  assert.equal(routeOf("tts.order").querySelectorAll("select").length, 0, "voices have no models to pick");
  assert.ok(!order.queryByRole("button", { name: /olib tashlash|qo'shish/ }), "an order has every provider; a provider is switched off with its own switch");
  assert.ok(!order.queryByText(/hech bir provayder hozir ishlamayapti/), "gemini still works");
  assert.ok(order.getByText(/Birinchi provayder ishlamayapti/), "azure first but down: say so");
  fireEvent.click(order.getByRole("button", { name: "Google Geminini yuqoriga" }));
  assert.equal(routeOf("tts.order").querySelector("[data-entry='0']")!.textContent?.includes("Google Gemini"), true);
  assert.ok(!order.queryByText(/Birinchi provayder ishlamayapti/), "a working one leads now");
});

test("a stored voice order that lists only some voices shows all of them; the unlisted run last", async () => {
  const partial: RouteItem = { ...TTS_ORDER, entries: [entry("gemini", "Google Gemini", null)] };
  stubFetch([() => json(200, { ...BODY, purposes: [{ ...TTS, routes: [partial] }] })]);
  mount(h(ProvidersPage));
  await ready();
  openTab("tts");
  editRoute("Ovoz provayderlari tartibi");
  const rows = [...routeOf("tts.order").querySelectorAll("[data-entry]")].map((e) => e.textContent ?? "");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes("Google Gemini") && rows[1].includes("Azure Speech"), rows.join(" | "));
  assert.equal((within(routeOf("tts.order")).getByRole("button", { name: "Saqlash" }) as HTMLButtonElement).disabled, true, "showing the full list is not a change");
});

test("a value from the server's env that is outside the price book stays visible, is flagged and cannot be saved", async () => {
  const odd: RouteItem = { ...WRITER, entries: [entry("gemini", "Google Gemini", "gemini-2.5-flash")], fallbackEntries: [entry("gemini", "Google Gemini", "gemini-2.5-flash")] };
  stubFetch([() => json(200, { ...BODY, purposes: [{ ...TEXT, routes: [odd] }] })]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  editRoute("Yozuvchi");
  const editor = within(routeOf("llm.writer"));
  const select = editor.getByLabelText("Yozuvchi: 1-qator") as HTMLSelectElement;
  assert.equal(select.value, "gemini|gemini-2.5-flash", "the real value is selected, not silently the first option");
  assert.ok([...select.options].some((o) => o.textContent?.includes("narxsiz")));
  assert.match(routeOf("llm.writer").querySelector("[data-unpriced]")!.textContent ?? "", /gemini-2\.5-flash.*saqlab bo'lmaydi/);
  fireEvent.click(editor.getByRole("button", { name: "Zaxira qo'shish" }));
  assert.equal((editor.getByRole("button", { name: "Saqlash" }) as HTMLButtonElement).disabled, true, "an unpriced model blocks saving");
  fireEvent.change(select, { target: { value: "gemini|gemini-3.1-pro" } });
  assert.ok(!routeOf("llm.writer").querySelector("[data-unpriced]"), "choosing a priced model clears the warning");
  assert.equal((editor.getByRole("button", { name: "Saqlash" }) as HTMLButtonElement).disabled, false);
});

test("rows keep their identity while edited or moved, so keyboard focus survives", async () => {
  stubFetch([() => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  editRoute("Yozuvchi");
  const editor = within(routeOf("llm.writer"));
  fireEvent.click(editor.getByRole("button", { name: "Zaxira qo'shish" }));
  const second = editor.getByLabelText("Yozuvchi: 2-qator") as HTMLSelectElement;
  fireEvent.change(second, { target: { value: "anthropic|claude-sonnet-5" } });
  assert.ok(editor.getByLabelText("Yozuvchi: 2-qator") === second, "changing a value does not remount its select");
  fireEvent.click(editor.getByRole("button", { name: "Anthropic (Claude)ni yuqoriga" }));
  assert.ok(editor.getByLabelText("Yozuvchi: 1-qator") === second, "moving a row moves the same element");
});

test("a chain with no working provider is called out", async () => {
  const dead: RouteItem = { ...WRITER, usable: { gemini: true, anthropic: false }, entries: [entry("anthropic", "Anthropic (Claude)", "claude-sonnet-5", false)] };
  const items = ITEMS.map((i) => (i.id === "anthropic" ? { ...i, usable: false } : i));
  stubFetch([() => json(200, { ...BODY, items, purposes: [{ ...TEXT, verdict: "missing", headline: "Yetarli emas", routes: [dead] }] })]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  editRoute("Yozuvchi");
  assert.match(within(routeOf("llm.writer")).getByRole("alert").textContent ?? "", /hech bir provayder hozir ishlamayapti/);
});

/* ───────────────────────────── key dialog ───────────────────────────── */

test("«Kalitni kiritish»: password field, reason, exact body, the key is never shown again, the page reloads", async () => {
  const saved = { ...KLING, hasDbKey: true, keyHint: `…${SECRET.slice(-4)}`, keySource: "db" as const };
  const calls = stubFetch([() => json(200, BODY), () => json(200, { item: saved }), () => json(200, { ...BODY, items: ITEMS.map((i) => (i.id === "kling" ? saved : i)) })]);
  mount(h(ProvidersPage));
  await ready();
  openTab("video");

  fireEvent.click(within(cardOf("kling")).getByRole("button", { name: "Kalitni kiritish" }));
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("API kalit") as HTMLInputElement;
  assert.equal(input.type, "password", "never a visible text field");
  assert.equal(input.getAttribute("autocomplete"), "new-password");
  assert.equal(input.getAttribute("spellcheck"), "false");
  const save = () => within(dialog).getByRole("button", { name: "Saqlash" }) as HTMLButtonElement;
  assert.equal(save().disabled, true, "nothing typed");
  fireEvent.change(input, { target: { value: "short" } });
  assert.match(within(dialog).getByText(/qisqa/).textContent ?? "", /kamida 8/);
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Yangi kalit olindi" } });
  assert.equal(save().disabled, true, "invalid key");
  fireEvent.change(input, { target: { value: `  ${SECRET}  ` } });
  fireEvent.click(save());

  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/providers/kling/key");
  assert.equal(calls[1].init.method, "PUT");
  assert.deepEqual(calls[1].body, { key: SECRET, reason: "Yangi kalit olindi" }, "trimmed, exactly key + reason");
  await waitFor(() => assert.equal(cardOf("kling").querySelector("[data-key-state]")!.textContent, `Bazada …${SECRET.slice(-4)}`));
  assert.ok(toasts().some((m) => m.includes("30 soniyagacha")));
  assert.ok(!document.body.innerHTML.includes(SECRET), "not in the DOM");
  assert.ok(!toasts().join("|").includes(SECRET), "not in a toast");
  for (const i of document.querySelectorAll("input")) assert.notEqual((i as HTMLInputElement).value, SECRET);
});

test("«Almashtirish»: a server error stays inline and the typed key is kept for a retry; cancelling discards the key", async () => {
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(503, { error: "Shifrlash kaliti sozlanmagan", code: "crypto_unavailable" }),
    () => json(200, { item: { ...ANTHROPIC, keyHint: `…${SECRET.slice(-4)}` } }),
    () => json(200, BODY),
  ]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  fireEvent.click(within(cardOf("anthropic")).getByRole("button", { name: "Almashtirish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Kalitni almashtirish"));
  fireEvent.change(within(dialog).getByLabelText("API kalit"), { target: { value: SECRET } });
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kalit eskirgan edi" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Almashtirish" }));
  assert.equal((await within(dialog).findByRole("alert")).textContent, "Shifrlash kaliti sozlanmagan");
  assert.equal((within(dialog).getByLabelText("API kalit") as HTMLInputElement).value, SECRET);
  fireEvent.click(within(dialog).getByRole("button", { name: "Almashtirish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls.length >= 3, true);
  assert.ok(!document.body.innerHTML.includes(SECRET));

  openTab("video");
  fireEvent.click(within(cardOf("kling")).getByRole("button", { name: "Kalitni kiritish" }));
  const d2 = await screen.findByRole("dialog");
  fireEvent.change(within(d2).getByLabelText("API kalit"), { target: { value: SECRET } });
  fireEvent.click(within(d2).getByRole("button", { name: "Bekor qilish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.ok(!document.body.innerHTML.includes(SECRET));
});

/* ───────────────────────────── delete, switch, test ───────────────────────────── */

test("«O'chirish» (key): a reason, DELETE {reason}, then the page reloads", async () => {
  const calls = stubFetch([() => json(200, BODY), () => json(200, { item: { ...ANTHROPIC, hasDbKey: false } }), () => json(200, BODY)]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  fireEvent.click(within(cardOf("anthropic")).getByRole("button", { name: "O'chirish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText(/Muhitda \(env\) kalit yo'q/), "no env fallback: warns");
  assert.equal(button("Kalitni o'chirish").disabled, true, "reason missing");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kalit sizib chiqdi" } });
  fireEvent.click(button("Kalitni o'chirish"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/providers/anthropic/key");
  assert.equal(calls[1].init.method, "DELETE");
  assert.deepEqual(calls[1].body, { reason: "Kalit sizib chiqdi" });
  await waitFor(() => assert.equal(calls.length, 3));
});

test("the switch: confirmation, PUT {enabled, reason}; a 409 reloads the page", async () => {
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(200, { item: { ...GEMINI, enabled: false } }),
    () => json(200, BODY),
    () => json(409, { error: "Provayder allaqachon yoqilgan", code: "state" }),
    () => json(200, BODY),
  ]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  fireEvent.click(within(cardOf("gemini")).getByRole("switch"));
  let dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Provayderni o'chirish"));
  const confirm = within(dialog).getByRole("button", { name: "O'chirish" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true, "reason missing");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kvota tugadi" } });
  fireEvent.click(confirm);
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/providers/gemini/enabled");
  assert.deepEqual(calls[1].body, { enabled: false, reason: "Kvota tugadi" });
  await waitFor(() => assert.equal(calls.length, 3));

  openTab("image");
  fireEvent.click(within(cardOf("pexels")).getByRole("switch"));
  dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Provayderni yoqish"));
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Qayta yoqish" } });
  fireEvent.click(button("Yoqish"));
  await within(dialog).findByRole("alert");
  await waitFor(() => assert.equal(calls.length, 5), { timeout: 2000 });
});

test("«Tekshirish»: shows the server's answer inline; a cancelled step-up leaves no message", async () => {
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(200, { ok: true, message: "Kalit qabul qilindi" }),
    () => json(200, { ok: false, message: "Provayder rad etdi (HTTP 401)" }),
  ]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  fireEvent.click(within(cardOf("gemini")).getByRole("button", { name: "Tekshirish" }));
  await waitFor(() => assert.equal(cardOf("gemini").querySelector("[data-test-result]")?.getAttribute("data-test-result"), "ok"));
  assert.equal(calls[1].url, "/api/admin/providers/gemini/test");
  assert.equal(calls[1].init.method, "POST");
  fireEvent.click(within(cardOf("gemini")).getByRole("button", { name: "Tekshirish" }));
  await waitFor(() => assert.equal(cardOf("gemini").querySelector("[data-test-result]")?.getAttribute("data-test-result"), "fail"));
  assert.match(cardOf("gemini").querySelector("[data-test-result]")!.textContent ?? "", /HTTP 401/);

  cleanup();
  core.setStepUpHandler(async () => false);
  stubFetch([() => json(200, BODY), () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" })]);
  mount(h(ProvidersPage));
  await ready();
  openTab("text");
  fireEvent.click(within(cardOf("gemini")).getByRole("button", { name: "Tekshirish" }));
  await waitFor(() => assert.ok(!within(cardOf("gemini")).getByRole("button", { name: "Tekshirish" }).hasAttribute("aria-busy")));
  assert.equal(cardOf("gemini").querySelector("[data-test-result]"), null);
});

test("step-up: 401 reauth on a route save -> the code is asked once and the SAME request is replayed", async () => {
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return true;
  });
  const saved: RouteItem = { ...TTS_ORDER, entries: [entry("gemini", "Google Gemini", null), entry("azure", "Azure Speech", null, false)] };
  const calls = stubFetch([
    () => json(200, BODY),
    () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }),
    () => json(200, { route: saved }),
    () => json(200, BODY),
  ]);
  mount(h(ProvidersPage));
  await ready();
  openTab("tts");
  editRoute("Ovoz provayderlari tartibi");
  const order = within(routeOf("tts.order"));
  fireEvent.click(order.getByRole("button", { name: "Google Geminini yuqoriga" }));
  fireEvent.click(order.getByRole("button", { name: "Saqlash" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Gemini birinchi bo'lsin" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Saqlash" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(asked, 1);
  assert.deepEqual(calls[1].body, calls[2].body);
  assert.deepEqual(calls[1].body.entries, [
    { provider: "gemini", model: null },
    { provider: "azure", model: null },
  ]);
});
