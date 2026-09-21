import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { InfographicComposer } from "../../components/forms/InfographicComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { INFOGRAPHIC_PARAMS } from "../../lib/generation/infographic-params.ts";
import { PALETTES } from "../../lib/generation/infographic/types.ts";

/**
 * Infografika formasi (Formalar 3 / AUDIT-24, WP-D2b) — `tests/ui/
 * essay-composer.test.mts` naqshi.
 *
 * Qulflanadigan qoidalar:
 *   • QAMROV — har `INFOGRAPHIC_PARAMS.id` formada `data-field` bilan;
 *   • palitra `ColorDots` — radiogroup, aria-checked, bosish o'zgartiradi;
 *   • blok soni tur chegarasiga kesiladi (`normalizeBlockCountFor`);
 *   • standart tur/blok soni reyestrdan;
 *   • narx tekis 2 000 — tur/blok/palitra/o'lcham O'ZGARTIRMAYDI;
 *   • Sozlamalar yopiq keladi;
 *   • submit tanasida barcha maydonlar, mavzusiz rad etiladi;
 *   • `ToolWorkspace` dispatch (`custom: "infographic"`).
 *
 * Mutatsiya (qo'lda tekshirildi): `onTypeChange` dagi `normalizeBlockCountFor`
 * chaqiruvi olib tashlansa, «process» turida 8 blok chip'i qolib ketardi
 * (reyestr chegarasi 6) — «blok soni tur chegarasiga kesiladi» testi qizaradi.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.infographic;

type Call = { url: string; method: string; body?: unknown };
function stubApi(draft: Record<string, unknown> | null = null) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === "/api/forms/infographic/draft" && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (url === "/api/forms/infographic/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "77777777-7777-4777-8777-777777777777", price: 2000 });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(InfographicComposer, { tool })));
}

const field = (id: string) => document.querySelector(`[data-field="${id}"]`);
const chips = (id: string) => [...document.querySelectorAll(`[data-field="${id}"] button`)] as HTMLButtonElement[];
const chipText = (id: string) => chips(id).map((b) => b.textContent?.trim() ?? "");
const checked = (id: string) => chips(id).find((b) => b.getAttribute("aria-checked") === "true")?.textContent?.trim() ?? "";
const selectValue = (id: string) => (field(id)?.querySelector("select") as HTMLSelectElement | null)?.value ?? "";

async function selectOption(id: string, value: string) {
  await act(async () => {
    fireEvent.change(field(id)!.querySelector("select")!, { target: { value } });
  });
}

/* ══════════════════════════════ qamrov ══════════════════════════════ */

test("QAMROV: har `INFOGRAPHIC_PARAMS.id` formada `data-field` bilan chizilgan", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const seen = new Set([...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")).filter(Boolean) as string[]);
  const known = new Set(INFOGRAPHIC_PARAMS.map((p) => p.id));
  assert.deepEqual([...known].filter((id) => !seen.has(id)), [], "reyestr maydoni formada yo'q");
  assert.deepEqual([...seen].filter((id) => !known.has(id)), [], "formada reyestrsiz maydon");
});

/* ══════════════════════════════ palitra ══════════════════════════════ */

test("palitra: ColorDots radiogroup, aria-checked, bosish o'zgartiradi", async () => {
  stubApi();
  await login();
  mount();
  assert.equal(screen.getByLabelText(PALETTES[0]!.label.uz).getAttribute("aria-checked"), "true", "standart palitra — birinchisi");
  const second = screen.getByLabelText(PALETTES[1]!.label.uz);
  assert.equal(second.getAttribute("aria-checked"), "false");
  await act(async () => {
    fireEvent.click(second);
  });
  assert.equal(screen.getByLabelText(PALETTES[1]!.label.uz).getAttribute("aria-checked"), "true");
  assert.equal(screen.getByLabelText(PALETTES[0]!.label.uz).getAttribute("aria-checked"), "false");
});

/* ══════════════════════════════ tur × blok soni ══════════════════════════════ */

test("standart tur — «Ro'yxat» (`infographicDefaultTypeId`), blok soni 5", async () => {
  stubApi();
  await login();
  mount();
  assert.equal(selectValue("infographicType"), "list");
  assert.equal(checked("blockCount"), "5 blok");
});

test("blok soni tur chegarasiga kesiladi: 8 blok tanlab «process» ga o'tsa qiymat ≤6 ga tushadi", async () => {
  stubApi();
  await login();
  mount();
  assert.ok(chipText("blockCount").includes("8 blok"), "list turida 8 blok bor");
  await pick("blockCount", /^8 blok$/);
  assert.equal(checked("blockCount"), "8 blok");
  await selectOption("infographicType", "process");
  await waitFor(() => assert.ok(!chipText("blockCount").includes("8 blok"), "process turida 8 blok chip'i yo'q"));
  /*
   * MUTATSIYA: `onTypeChange` dagi `normalizeBlockCountFor` chaqiruvi
   * olib tashlansa, `ui.blockCount` 8 da QOLADI — bu qiymat endi
   * `blockOptions` ro'yxatida yo'q, shuning uchun HECH BIR chip
   * aria-checked=true bo'lmaydi va `checked()` bo'sh satr qaytaradi.
   */
  const now = checked("blockCount");
  assert.notEqual(now, "", "biror chip tanlangan bo'lishi kerak — qiymat clamp qilingan");
  assert.ok(Number(now.replace(/\D/g, "")) <= 6, `joriy tanlov chegaraga kesilgan: ${now}`);
});

/* ══════════════════════════════ narx ══════════════════════════════ */

test("narx tekis 2 000 — tur/blok/palitra/o'lcham o'zgartirmaydi", async () => {
  stubApi();
  await login();
  mount();
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /2\s?000/);
  await selectOption("infographicType", "timeline");
  await pick("blockCount", /^6 blok$/);
  await act(async () => {
    fireEvent.click(screen.getByLabelText(PALETTES[2]!.label.uz));
  });
  await pick("size", /^A3/);
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /2\s?000/, "narx tekis qolgan");
});

async function pick(id: string, re: RegExp) {
  const btn = chips(id).find((b) => re.test(b.textContent ?? ""));
  assert.ok(btn, `«${re}» tugmasi topilmadi (${id}): ${chipText(id).join(" | ")}`);
  await act(async () => {
    fireEvent.click(btn!);
  });
}

/* ══════════════════════════════ Sozlamalar ══════════════════════════════ */

test("Sozlamalar YOPIQ keladi", async () => {
  stubApi();
  await login();
  mount();
  const details = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(details);
  assert.equal(details.open, false);
});

/* ══════════════════════════════ submit ══════════════════════════════ */

test("submit: tanasida topic/infographicType/blockCount/palette/size/language", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(tool.topicPlaceholder!), { target: { value: "Suv aylanishi" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const body = post.body as { slug: string; values: Record<string, unknown> };
  assert.equal(body.slug, "infografika");
  assert.equal(body.values.topic, "Suv aylanishi");
  assert.equal(body.values.infographicType, "list");
  assert.equal(body.values.blockCount, 5);
  assert.equal(body.values.palette, "indigo");
  assert.equal(body.values.size, "A4");
  assert.equal(body.values.language, "uz");
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});

test("submit: mavzusiz rad etiladi", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  assert.equal(calls.filter((c) => c.url === "/api/generations").length, 0);
  assert.ok(screen.getByText(/Mavzuni kiriting/));
});

/* ══════════════════════════════ dispatch ══════════════════════════════ */

test("vosita sahifasi infografika uchun `InfographicComposer` chizadi (`custom: infographic` dispatch)", async () => {
  stubApi();
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool })));
  await waitFor(() => assert.ok(document.querySelectorAll("[data-field]").length >= 5));
  assert.equal(TOOL_BY_ID.infographic.custom, "infographic");
});
