import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { SettingsPage } from "../../components/admin/settings/SettingsPage.tsx";
import { checkNumberText, fmtDuration, formatValue, warningsFor } from "../../components/admin/settings/format.ts";
import { TAB_DEFS } from "../../components/admin/settings/layout.ts";

/**
 * S14 `/admin/settings` (docs/admin/02-plan.md §6.10, §7.0, §7.1): loading,
 * empty, error (request id + retry), forbidden; category tabs (`?tab=`,
 * keyboard) with an «Umumiy» overview (flags, overrides, warnings); rows with
 * unit-formatted value, default, «O'zgartirgan» writer and date; search over
 * every tab; the 15 s propagation banner; viewers and finance see no controls;
 * one edit flow per value type (flag switch → dialog, bounded number, tool
 * multi-select) sends exactly `{value, reason}` and marks the row «O'zgartirilgan»;
 * reset sends `{reason}`; a stale step-up is asked once and the same request is
 * replayed; errors stay inline in the dialog.
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

const TOOLS = [
  { value: "essay", label: "Insho" },
  { value: "slide", label: "Slayd" },
  { value: "referat", label: "Referat" },
];

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

/** Router stub that keeps the query in state, so a tab click re-renders with the new `?tab=`. */
let replaced: string[] = [];
function Harness({ query, children }: { query: string; children: ReactNode }) {
  const [qs, setQs] = useState(query);
  const router: AppRouterInstance = {
    back() {},
    forward() {},
    refresh() {},
    prefetch() {},
    push() {},
    replace: (href: string) => {
      replaced.push(href);
      setQs(href.split("?")[1] ?? "");
    },
  };
  return h(
    AppRouterContext.Provider,
    { value: router },
    h(PathnameContext.Provider, { value: "/admin/settings" }, h(SearchParamsContext.Provider, { value: new URLSearchParams(qs) }, children)),
  );
}

function mount(node: ReactNode, role: Role = "owner", tab = "") {
  replaced = [];
  render(
    h(AdminIdentityProvider, {
      value: { adminId: "1", role, permissions: PERMS[role], name: "Admin", username: null, twoFactor: true },
      children: h(Harness, { query: tab ? `tab=${tab}` : "", children: node }),
    }),
  );
}

const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

type Base = {
  key: string;
  label: string;
  description: string;
  group: string;
  min: number | null;
  max: number | null;
  source: "db" | "env" | "default";
  updatedBy: string | null;
  updatedAt: string | null;
};
const base = (b: Partial<Base> & Pick<Base, "key" | "label" | "group">): Base => ({
  description: `${b.label} tavsifi`,
  min: null,
  max: null,
  source: "default",
  updatedBy: null,
  updatedAt: null,
  ...b,
});

const PAUSED = { ...base({ key: "generation.paused", label: "Barcha generatsiyalar to'xtatilgan", group: "Generatsiya" }), type: "bool", value: false, envValue: false };
const PAUSED_TOOLS = { ...base({ key: "generation.paused_tools", label: "To'xtatilgan vositalar", group: "Generatsiya" }), type: "tool_ids", value: [], envValue: [] };
const OUTLINE = {
  ...base({ key: "free_llm.daily.outline", label: "Reja: kunlik limit", group: "Bepul AI", min: 0, max: 1_000_000_000, source: "env" }),
  type: "int",
  value: 7,
  envValue: 7,
};
const SOUM = {
  ...base({ key: "finance.soum_per_usd", label: "Dollar kursi (so'm)", group: "Moliya", min: 1, max: 1_000_000, source: "db", updatedBy: "Dilnoza Admin", updatedAt: "2026-10-01T09:30:00.000Z" }),
  type: "int",
  value: 12_900,
  envValue: 12_700,
};
const MARKUP = { ...base({ key: "pricing.target_markup", label: "Maqsadli ustama (×)", group: "Narxlar", min: 1, max: 20 }), type: "number", value: 3, envValue: 3 };
const ITEMS = [OUTLINE, PAUSED, PAUSED_TOOLS, SOUM, MARKUP];

const rowOf = (key: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-setting="${key}"]`);
  assert.ok(el, `${key} qatori yo'q`);
  return el;
};
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const ready = async () => screen.findByRole("tablist");
const tabNames = () => screen.getAllByRole("tab").map((t) => (t.textContent ?? "").replace(/\d+$/, ""));

/* ───────────────────────────── helpers (no DOM) ───────────────────────────── */

test("checkNumberText: butun son, o'nlik vergul, chegaralar", () => {
  const int = { type: "int" as const, min: 0, max: 100 };
  assert.deepEqual(checkNumberText(int, "42"), { ok: true, value: 42 });
  assert.deepEqual(checkNumberText(int, " 1 0 "), { ok: true, value: 10 });
  for (const bad of ["", "abc", "-1", "1.5", "101", "1e3", "0x10"]) {
    assert.equal(checkNumberText(int, bad).ok, false, bad);
  }
  const num = { type: "number" as const, min: 1, max: 20 };
  assert.deepEqual(checkNumberText(num, "2,5"), { ok: true, value: 2.5 });
  assert.deepEqual(checkNumberText(num, "2.5"), { ok: true, value: 2.5 });
  assert.equal(checkNumberText(num, "0.5").ok, false);
  assert.equal(checkNumberText(num, "20.01").ok, false);
  assert.equal(checkNumberText(num, "1,2,3").ok, false);
});

test("formatValue: units by key (so'm, %, daqiqa, soat, ×)", () => {
  assert.equal(formatValue({ type: "bool" }, true, TOOLS), "Yoqilgan");
  assert.equal(formatValue({ type: "bool" }, false, TOOLS), "O'chiq");
  assert.equal(formatValue({ type: "tool_ids" }, [], TOOLS), "Hech biri");
  assert.equal(formatValue({ type: "tool_ids" }, ["slide", "gone"], TOOLS), "Slayd, gone");
  assert.equal(formatValue({ type: "int" }, 1234567, TOOLS), "1\u00a0234\u00a0567");
  assert.equal(formatValue({ type: "number" }, 2.5, TOOLS), "2,5");
  assert.equal(formatValue({ type: "int", key: "finance.soum_per_usd" }, 12900, TOOLS), "12\u00a0900\u00a0so'm");
  assert.equal(formatValue({ type: "int", key: "payment_bonus_percent" }, 10, TOOLS), "10%");
  assert.equal(formatValue({ type: "int", key: "queue.max_wait_sec" }, 900, TOOLS), "15 daqiqa");
  assert.equal(formatValue({ type: "int", key: "queue.max_wait_sec" }, 200, TOOLS), "3 daqiqa 20 soniya");
  assert.equal(formatValue({ type: "int", key: "queue.mean_service_sec" }, 0, TOOLS), "Avtomatik");
  assert.equal(formatValue({ type: "int", key: "tests.minutes_all" }, 60, TOOLS), "60 daqiqa");
  assert.equal(formatValue({ type: "int", key: "daily_quiz.hour" }, 8, TOOLS), "08:00");
  assert.equal(formatValue({ type: "number", key: "pricing.target_markup" }, 3, TOOLS), "×3");
  assert.equal(fmtDuration(45), "45 soniya");
});

test("warningsFor: oferta without requisites, zero payment fee, stops that are ON", () => {
  const OFERTA = { ...base({ key: "oferta.gate_enabled", label: "Oferta", group: "Oferta" }), type: "bool", value: true, envValue: false };
  const REQ = { ...base({ key: "oferta.requisites", label: "Rekvizit", group: "Oferta" }), type: "text", value: "  ", envValue: "" };
  const FEE = { ...base({ key: "pricing.payment_fee_percent", label: "Komissiya", group: "Narxlar" }), type: "number", value: 0, envValue: 0 };
  const ids = (items: unknown[]) => warningsFor(items as never).map((w) => w.id);
  assert.deepEqual(ids([OFERTA, REQ, FEE]), ["oferta", "fee"]);
  assert.deepEqual(ids([{ ...OFERTA, value: false }, REQ, { ...FEE, value: 2 }]), [], "nothing to warn about");
  assert.deepEqual(ids([OFERTA, { ...REQ, value: "MChJ Test" }]), [], "requisites filled");
  assert.deepEqual(ids([{ ...PAUSED, value: true }]), ["paused"]);
  assert.deepEqual(ids([{ ...PAUSED_TOOLS, value: ["essay"] }]), ["paused_tools"]);
});

/* ───────────────────────────── four states ───────────────────────────── */

test("loading: skeleton while the request is pending", async () => {
  stubFetch([() => new Promise<Response>(() => {})]);
  mount(h(SettingsPage, { tools: TOOLS }));
  assert.ok(document.querySelector('[aria-busy="true"]'));
  assert.ok(!screen.queryByText("Bepul AI"));
  assert.ok(screen.getByText(/15 soniyagacha/), "banner is shown from the start");
});

test("ready: «Umumiy» first; rows show value with unit, default, who and when", async () => {
  const calls = stubFetch([() => json(200, { items: ITEMS })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "free");
  await ready();
  assert.equal(calls[0].url, "/api/admin/settings");
  assert.ok(screen.getByRole("note").textContent?.includes("O'zgarish boshqa jarayonlarga 15 soniyagacha yetib boradi."));

  const outline = within(rowOf("free_llm.daily.outline"));
  assert.ok(outline.getByText("7 birlik", { selector: "b" }));
  assert.equal(document.querySelector("[data-setting='free_llm.daily.outline'] [data-setting-default]")?.textContent, "7 birlik");
  assert.ok(!outline.queryByText(/O'zgartirgan:/), "no writer without an override");
  assert.ok(!outline.queryByText("O'zgartirilgan"));
  assert.ok(!outline.queryByRole("button", { name: "Standartga qaytarish" }), "nothing to reset");
  assert.ok(outline.getByRole("button", { name: "O'zgartirish" }));
});

test("overridden row: badge, «O'zgartirgan: admin · sana», default next to the value, reset button", async () => {
  stubFetch([() => json(200, { items: ITEMS })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "pricing");
  await ready();
  const soum = within(rowOf("finance.soum_per_usd"));
  assert.ok(soum.getByText("O'zgartirilgan"));
  assert.ok(soum.getByText("12 900 so'm", { selector: "b" }));
  assert.equal(document.querySelector("[data-setting='finance.soum_per_usd'] [data-setting-default]")?.textContent, "12\u00a0700\u00a0so'm", "default (env) value");
  assert.ok(soum.getByText("Dilnoza Admin"));
  assert.ok(soum.getByText(/01\.10\.2026 14:30/), "Tashkent time");
  assert.ok(soum.getByRole("button", { name: "Standartga qaytarish" }));
  assert.ok(within(rowOf("pricing.target_markup")).getByText("×3", { selector: "b" }));
  assert.ok(!within(rowOf("pricing.target_markup")).queryByText("O'zgartirilgan"));
});

test("tabs: tablist, «Umumiy» default, URL ?tab=, arrow keys, roving tabindex, unknown tab falls back", async () => {
  stubFetch([() => json(200, { items: ITEMS })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  assert.equal(screen.getByRole("tablist").getAttribute("aria-label"), "Sozlamalar bo'limlari");
  const names = tabNames();
  assert.equal(names[0], "Umumiy");
  for (const t of TAB_DEFS) assert.ok(names.includes(t.label), t.label);
  const tab = (name: string) => screen.getAllByRole("tab").find((t) => (t.textContent ?? "").startsWith(name)) as HTMLElement;
  assert.equal(tab("Umumiy").getAttribute("aria-selected"), "true");
  assert.equal(tab("Umumiy").getAttribute("tabindex"), "0");
  assert.equal(tab("Pul va bonuslar").getAttribute("tabindex"), "-1");
  assert.ok(screen.getByRole("tabpanel").textContent?.includes("Ogohlantirishlar"));

  fireEvent.click(tab("Narx va marja"));
  assert.equal(replaced.at(-1), "/admin/settings?tab=pricing");
  await waitFor(() => assert.equal(tab("Narx va marja").getAttribute("aria-selected"), "true"));
  assert.ok(rowOf("finance.soum_per_usd"));
  assert.ok(!document.querySelector("[data-setting='generation.paused']"), "other tabs' rows are not rendered");

  fireEvent.keyDown(tab("Narx va marja"), { key: "ArrowRight" });
  assert.equal(replaced.at(-1), "/admin/settings?tab=queue");
  await waitFor(() => assert.ok(document.querySelector("[data-setting='generation.paused']")));
  fireEvent.keyDown(tab("Navbat va generatsiya"), { key: "Home" });
  assert.equal(replaced.at(-1), "/admin/settings", "«Umumiy» has no ?tab=");
  cleanup();

  stubFetch([() => json(200, { items: ITEMS })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "no-such-tab");
  await ready();
  assert.equal(screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent, "Umumiy");
});

test("tab badge counts the overridden settings of that tab", async () => {
  stubFetch([() => json(200, { items: ITEMS })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  const tab = (name: string) => screen.getAllByRole("tab").find((t) => (t.textContent ?? "").startsWith(name)) as HTMLElement;
  assert.equal(tab("Narx va marja").textContent, "Narx va marja1");
  assert.equal(tab("Navbat va generatsiya").textContent, "Navbat va generatsiya");
});

test("«Umumiy»: flag states, overridden list with who/when, warnings with a jump to the tab", async () => {
  const OFERTA = { ...base({ key: "oferta.gate_enabled", label: "Oferta qabul qilishni talab qilish", group: "Oferta" }), type: "bool", value: true, envValue: false };
  const REQ = { ...base({ key: "oferta.requisites", label: "Ijrochi rekvizitlari", group: "Oferta" }), type: "text", value: "", envValue: "" };
  const TESTS_ON = { ...base({ key: "tests.enabled", label: "Test ishlash yoqilgan", group: "Testlar" }), type: "bool", value: true, envValue: false, source: "db", updatedBy: "Aziz", updatedAt: "2026-10-03T08:00:00.000Z" };
  const VIDEO_OFF = { ...base({ key: "video.enabled", label: "Video yaratish yoqilgan", group: "Video" }), type: "bool", value: false, envValue: false };
  const FEE = { ...base({ key: "pricing.payment_fee_percent", label: "To'lov komissiyasi (%)", group: "Narxlar", min: 0, max: 10 }), type: "number", value: 0, envValue: 0 };
  stubFetch([() => json(200, { items: [...ITEMS, OFERTA, REQ, TESTS_ON, VIDEO_OFF, FEE] })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  const flag = (key: string) => within(document.querySelector<HTMLElement>(`[data-overview="${key}"]`)!);
  assert.ok(flag("tests.enabled").getByText("Yoqilgan"));
  assert.ok(flag("video.enabled").getByText("O'chiq"));
  assert.ok(flag("generation.paused").getByText("Ishlayapti"), "a stop switch that is OFF reads «Ishlayapti»");

  const warn = (id: string) => within(document.querySelector<HTMLElement>(`[data-warning="${id}"]`)!);
  assert.ok(warn("oferta").getByText(/rekvizitlar bo'sh/));
  assert.ok(warn("fee").getByText(/marja/));
  fireEvent.click(warn("fee").getByRole("button", { name: "Tuzatish" }));
  assert.equal(replaced.at(-1), "/admin/settings?tab=pricing");
  await waitFor(() => assert.ok(rowOf("pricing.payment_fee_percent")));
  cleanup();

  stubFetch([() => json(200, { items: [...ITEMS, TESTS_ON] })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  const changed = within(rowOf("tests.enabled"));
  assert.ok(changed.getByText("Aziz"), "who changed it");
  assert.ok(changed.getByText(/03\.10\.2026 13:00/), "when (Tashkent)");
  assert.ok(rowOf("finance.soum_per_usd"), "every override is listed on the overview");
  assert.ok(!document.querySelector("[data-setting='pricing.target_markup']"), "defaults are not");
});

test("«Funksiyalar»: one row per switch with the plain «Yoqilsa: …» sentence", async () => {
  const TESTS_ON = { ...base({ key: "tests.enabled", label: "Test ishlash yoqilgan", group: "Testlar" }), type: "bool", value: false, envValue: false };
  stubFetch([() => json(200, { items: [TESTS_ON] })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "features");
  await ready();
  const row = within(rowOf("tests.enabled"));
  assert.ok(row.getByText(/^Yoqilsa: foydalanuvchilar sayt va botda pullik test topshira oladi/));
  assert.equal(row.getByRole("switch").getAttribute("aria-checked"), "false");
  assert.equal(row.getAllByText("O'chiq").length, 2, "current value + default");
});

test("search: filters across every tab, hides the tab strip, finds by key and by value; empty result", async () => {
  stubFetch([() => json(200, { items: ITEMS })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  const box = screen.getByLabelText("Sozlamalardan qidirish") as HTMLInputElement;
  fireEvent.change(box, { target: { value: "dollar" } });
  assert.ok(rowOf("finance.soum_per_usd"));
  assert.ok(!document.querySelector("[data-setting='generation.paused']"));
  assert.ok(!screen.queryByRole("tablist"), "results replace the tab strip");
  fireEvent.change(box, { target: { value: "paused_tools" } });
  assert.ok(rowOf("generation.paused_tools"));
  assert.ok(!document.querySelector("[data-setting='finance.soum_per_usd']"));
  fireEvent.change(box, { target: { value: "12 900" } });
  assert.ok(rowOf("finance.soum_per_usd"), "the formatted value is searchable");
  fireEvent.change(box, { target: { value: "zzzz" } });
  assert.ok(screen.getByText("Hech narsa topilmadi"));
  fireEvent.change(box, { target: { value: "" } });
  assert.ok(screen.getByRole("tablist"));
});

test("empty: no settings → EmptyState", async () => {
  stubFetch([() => json(200, { items: [] })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await screen.findByText("Sozlamalar yo'q");
});

test("error: message + request id, retry loads again", async () => {
  const calls = stubFetch([
    () => json(500, { error: "Ichki xatolik", requestId: "req-777" }),
    () => json(200, { items: ITEMS }),
  ]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await screen.findByText("Ichki xatolik");
  assert.ok(screen.getByText("req-777"));
  fireEvent.click(button("Qayta urinish"));
  await ready();
  assert.equal(calls.length, 2);
  assert.ok(!screen.queryByText("Ichki xatolik"));
});

test("forbidden: 403 renders «Ruxsat yo'q»", async () => {
  stubFetch([() => json(403, { error: "Bu amal uchun ruxsatingiz yo'q", code: "forbidden" })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await screen.findByText("Ruxsat yo'q");
});

test("viewer and finance: values only, no edit or reset buttons", async () => {
  for (const role of ["viewer", "finance"] as const) {
    for (const tab of ["pricing", "queue"]) {
      stubFetch([() => json(200, { items: ITEMS })]);
      mount(h(SettingsPage, { tools: TOOLS }), role, tab);
      await ready();
      assert.ok(!screen.queryByRole("button", { name: "O'zgartirish" }), role);
      assert.ok(!screen.queryByRole("button", { name: "Standartga qaytarish" }), role);
      assert.ok(!screen.queryByRole("switch"), `${role}: no switch either`);
      assert.ok(screen.getByText(/faqat ko'rish huquqi/));
      if (tab === "pricing") assert.ok(within(rowOf("finance.soum_per_usd")).getByText("O'zgartirilgan"), "the override is still visible");
      cleanup();
    }
  }
});

/* ───────────────────────────── edit flows ───────────────────────────── */

test("bool: switch + reason → PUT {value, reason}; the row flips to «Admin qiymati» and offers the reset", async () => {
  const saved = { ...PAUSED, value: true, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "queue");
  await ready();

  const rowSwitch = within(rowOf("generation.paused")).getByRole("switch") as HTMLButtonElement;
  assert.equal(rowSwitch.getAttribute("aria-checked"), "false");
  assert.ok(!within(rowOf("generation.paused")).queryByRole("button", { name: "O'zgartirish" }), "a flag has a switch, not an edit button");
  fireEvent.click(rowSwitch);
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Sozlamani o'zgartirish"));
  assert.equal(rowSwitch.getAttribute("aria-checked"), "false", "the row switch only asks; nothing changes before the dialog is confirmed");
  const sw = within(dialog).getByRole("switch") as HTMLButtonElement;
  assert.equal(sw.getAttribute("aria-checked"), "true", "the dialog opens on the flipped value");
  assert.equal(button("Saqlash").disabled, true, "reason missing");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Texnik ishlar" } });
  assert.equal(button("Saqlash").disabled, false);
  fireEvent.click(button("Saqlash"));

  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls.length, 2, "no refetch: the response replaces the row");
  assert.equal(calls[1].url, "/api/admin/settings/generation.paused");
  assert.equal(calls[1].init.method, "PUT");
  assert.deepEqual(calls[1].body, { value: true, reason: "Texnik ishlar" });
  assert.ok(toasts().some((m) => m.includes("15 soniyagacha")), toasts().join(" | "));
  const row = within(rowOf("generation.paused"));
  assert.ok(row.getByText("Yoqilgan"));
  assert.equal(row.getByRole("switch").getAttribute("aria-checked"), "true");
  assert.ok(row.getByText("O'zgartirilgan"));
  assert.ok(row.getByRole("button", { name: "Standartga qaytarish" }));
});

test("int: bounds are checked as you type; the value is sent as a number", async () => {
  const saved = { ...OUTLINE, value: 12, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "free");
  await ready();
  fireEvent.click(within(rowOf("free_llm.daily.outline")).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("Yangi qiymat") as HTMLInputElement;
  assert.equal(input.value, "7");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kunlik limitni oshirish" } });

  for (const bad of ["", "abc", "-3", "1.5", "2000000000"]) {
    fireEvent.change(input, { target: { value: bad } });
    assert.equal(button("Saqlash").disabled, true, `«${bad}» bilan saqlab bo'lmaydi`);
  }
  fireEvent.change(input, { target: { value: "-3" } });
  assert.ok(within(dialog).getByText(/butun son/), "inline error text");
  fireEvent.change(input, { target: { value: "12" } });
  assert.equal(button("Saqlash").disabled, false);
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.deepEqual(calls[1].body, { value: 12, reason: "Kunlik limitni oshirish" });
  assert.equal(typeof calls[1].body.value, "number");
  assert.ok(within(rowOf("free_llm.daily.outline")).getByText("O'zgartirilgan"));
  assert.ok(within(rowOf("free_llm.daily.outline")).getByText("12 birlik", { selector: "b" }));
});

test("number: decimal comma accepted, range 1–20 enforced", async () => {
  const saved = { ...MARKUP, value: 2.5, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "pricing");
  await ready();
  fireEvent.click(within(rowOf("pricing.target_markup")).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("Yangi qiymat") as HTMLInputElement;
  assert.ok(within(dialog).getByText("1 dan 20 gacha"), "bounds hint");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Ustamani tushirish" } });
  fireEvent.change(input, { target: { value: "21" } });
  assert.equal(button("Saqlash").disabled, true);
  fireEvent.change(input, { target: { value: "0,5" } });
  assert.equal(button("Saqlash").disabled, true);
  fireEvent.change(input, { target: { value: "2,5" } });
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.deepEqual(calls[1].body, { value: 2.5, reason: "Ustamani tushirish" });
  assert.ok(within(rowOf("pricing.target_markup")).getByText("×2,5", { selector: "b" }));
});

test("payment fee: sits in the «Narx va marja» tab, bounds 0–10, decimal comma, body is {value: 2.5, reason}", async () => {
  const FEE = { ...base({ key: "pricing.payment_fee_percent", label: "To'lov komissiyasi (%)", group: "Narxlar", min: 0, max: 10 }), type: "number", value: 0, envValue: 0 };
  const saved = { ...FEE, value: 2.5, source: "db", updatedBy: "Admin", updatedAt: "2026-10-10T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: [...ITEMS, FEE] }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "pricing");
  await ready();
  const row = rowOf("pricing.payment_fee_percent");
  assert.ok(within(row).getByText("To'lov komissiyasi (%)"));
  assert.equal(row.closest("ul")?.contains(rowOf("pricing.target_markup")), true, "same card as the target markup");
  fireEvent.click(within(row).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("Yangi qiymat") as HTMLInputElement;
  assert.ok(within(dialog).getByText("0 dan 10 gacha"), "bounds hint");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Click komissiyasi 2,5%" } });
  for (const bad of ["11", "-1", "abc", ""]) {
    fireEvent.change(input, { target: { value: bad } });
    assert.equal(button("Saqlash").disabled, true, `«${bad}» bilan saqlab bo'lmaydi`);
  }
  fireEvent.change(input, { target: { value: "2,5" } });
  assert.equal(button("Saqlash").disabled, false);
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.deepEqual(calls[1].body, { value: 2.5, reason: "Click komissiyasi 2,5%" });
  assert.ok(calls[1].url.endsWith("/api/admin/settings/pricing.payment_fee_percent"), calls[1].url);
  assert.ok(within(rowOf("pricing.payment_fee_percent")).getByText("2,5%", { selector: "b" }));
});

test("tool_ids: options come from the server page; tick, «Hammasini tanlash», «Tozalash»; body is the id list", async () => {
  const saved = { ...PAUSED_TOOLS, value: ["essay", "referat"], source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "queue");
  await ready();
  fireEvent.click(within(rowOf("generation.paused_tools")).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  const box = (name: string) => within(dialog).getByRole("checkbox", { name }) as HTMLInputElement;
  assert.deepEqual(within(dialog).getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked), [false, false, false]);

  fireEvent.click(button("Hammasini tanlash"));
  assert.deepEqual(within(dialog).getAllByRole("checkbox").map((c) => (c as HTMLInputElement).checked), [true, true, true]);
  fireEvent.click(button("Tozalash"));
  assert.ok(within(dialog).getByText("Tanlangan: 0 ta"));
  fireEvent.click(box("Insho"));
  fireEvent.click(box("Referat"));
  assert.ok(within(dialog).getByText("Tanlangan: 2 ta"));
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Provayder nosoz" } });
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.deepEqual(calls[1].body, { value: ["essay", "referat"], reason: "Provayder nosoz" });
  const row = within(rowOf("generation.paused_tools"));
  assert.ok(row.getByText("Insho"));
  assert.ok(row.getByText("Referat"));
  assert.equal(row.getAllByText("Hech biri").length, 1, "only the env value is still «Hech biri»");
});

test("a failing save keeps the dialog open with the server's message; a retry goes through", async () => {
  const saved = { ...PAUSED, value: true, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([
    () => json(200, { items: ITEMS }),
    () => json(400, { error: "Qiymat true yoki false bo'lishi kerak" }),
    () => json(200, { item: saved }),
  ]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "queue");
  await ready();
  fireEvent.click(within(rowOf("generation.paused")).getByRole("switch"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Texnik ishlar" } });
  fireEvent.click(button("Saqlash"));
  const alert = await within(dialog).findByRole("alert");
  assert.equal(alert.textContent, "Qiymat true yoki false bo'lishi kerak");
  assert.ok(screen.getByRole("dialog"), "dialog stays open");
  assert.ok(within(rowOf("generation.paused")).getAllByText("O'chiq").length >= 1, "row unchanged");
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls.length, 3);
});

test("step-up: 401 reauth → the code is asked once and the SAME request is replayed", async () => {
  const saved = { ...OUTLINE, value: 3, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  let asked = 0;
  core.setStepUpHandler(async () => {
    asked += 1;
    return true;
  });
  const calls = stubFetch([
    () => json(200, { items: ITEMS }),
    () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }),
    () => json(200, { item: saved }),
  ]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "free");
  await ready();
  fireEvent.click(within(rowOf("free_llm.daily.outline")).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Yangi qiymat"), { target: { value: "3" } });
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Limitni kamaytirish" } });
  fireEvent.click(button("Saqlash"));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(asked, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].body, calls[2].body);
  assert.equal(calls[2].init.method, "PUT");
});

test("step-up cancelled: nothing changes, the dialog stays with a message", async () => {
  core.setStepUpHandler(async () => false);
  stubFetch([
    () => json(200, { items: ITEMS }),
    () => json(401, { error: "Bu amal uchun kodni qayta kiriting", code: "reauth" }),
  ]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "queue");
  await ready();
  fireEvent.click(within(rowOf("generation.paused")).getByRole("switch"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Texnik ishlar" } });
  fireEvent.click(button("Saqlash"));
  const alert = await within(dialog).findByRole("alert");
  assert.match(alert.textContent ?? "", /bekor qilindi/);
  assert.ok(within(rowOf("generation.paused")).getAllByText("O'chiq").length >= 1);
});

/* ───────────────────────────── reset ───────────────────────────── */

test("reset: DELETE {reason}; the row returns to the env value and loses the reset button", async () => {
  const restored = { ...SOUM, value: 12_700, source: "env", updatedBy: null, updatedAt: null };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: restored })]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "pricing");
  await ready();
  fireEvent.click(within(rowOf("finance.soum_per_usd")).getByRole("button", { name: "Standartga qaytarish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("12 900 so'm"), "before");
  assert.ok(within(dialog).getByText("12 700 so'm", { selector: "span.font-semibold" }), "after = env value");
  assert.equal((within(dialog).getByRole("button", { name: "Standartga qaytarish" }) as HTMLButtonElement).disabled, true, "reason required");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kurs barqarorlashdi" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Standartga qaytarish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/settings/finance.soum_per_usd");
  assert.equal(calls[1].init.method, "DELETE");
  assert.deepEqual(calls[1].body, { reason: "Kurs barqarorlashdi" });
  assert.ok(toasts().some((m) => m.includes("Standart qiymat tiklandi")));
  const row = within(rowOf("finance.soum_per_usd"));
  assert.ok(!row.queryByText("O'zgartirilgan"), "no override badge any more");
  assert.ok(row.getByText("12 700 so'm", { selector: "b" }));
  assert.ok(!row.queryByRole("button", { name: "Standartga qaytarish" }));
  assert.ok(!row.queryByText(/O'zgartirgan:/));
});

test("reset 409 state (someone else reset it): inline message and the list reloads", async () => {
  const fresh = ITEMS.map((i) => (i.key === "finance.soum_per_usd" ? { ...SOUM, value: 12_700, source: "env", updatedBy: null, updatedAt: null } : i));
  const calls = stubFetch([
    () => json(200, { items: ITEMS }),
    () => json(409, { error: "Bu sozlama allaqachon standart qiymatda", code: "state" }),
    () => json(200, { items: fresh }),
  ]);
  mount(h(SettingsPage, { tools: TOOLS }), "owner", "pricing");
  await ready();
  fireEvent.click(within(rowOf("finance.soum_per_usd")).getByRole("button", { name: "Standartga qaytarish" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kurs barqarorlashdi" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Standartga qaytarish" }));
  const alert = await within(dialog).findByRole("alert");
  assert.equal(alert.textContent, "Bu sozlama allaqachon standart qiymatda");
  await waitFor(() => assert.equal(calls.length, 3), undefined);
  fireEvent.click(within(dialog).getByRole("button", { name: "Bekor qilish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  await ready();
  assert.ok(!within(rowOf("finance.soum_per_usd")).queryByText("O'zgartirilgan"));
  assert.ok(within(rowOf("finance.soum_per_usd")).getByText("12 700 so'm", { selector: "b" }));
});
