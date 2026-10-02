import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement as h, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as CoreModule from "../../lib/admin-api/core.ts";
import type * as IdentityModule from "../../components/admin/shell/admin-identity.tsx";
import type * as ToasterModule from "../../components/admin/ui/Toaster.tsx";
import { SettingsPage } from "../../components/admin/settings/SettingsPage.tsx";
import { checkNumberText, formatValue, groupItems } from "../../components/admin/settings/format.ts";

/**
 * S14 `/admin/settings` (docs/admin/02-plan.md §6.10, §7.0, §7.1): loading,
 * empty, error (request id + retry), forbidden; grouped cards with value,
 * source badge, env value and last writer; the 15 s propagation banner;
 * viewers and finance see no edit buttons; one edit flow per value type
 * (switch, bounded number, tool multi-select) sends exactly `{value, reason}`
 * and flips the row to "Admin qiymati"; reset sends `{reason}`; a stale
 * step-up is asked once and the same request is replayed; errors stay
 * inline in the dialog.
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

function mount(node: ReactNode, role: Role = "owner") {
  render(h(AdminIdentityProvider, { value: { role, permissions: PERMS[role], name: "Admin", username: null }, children: node }));
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
const ready = async () => screen.findByText("Bepul AI");

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

test("formatValue / groupItems", () => {
  assert.equal(formatValue({ type: "bool" }, true, TOOLS), "Yoqilgan");
  assert.equal(formatValue({ type: "bool" }, false, TOOLS), "O'chiq");
  assert.equal(formatValue({ type: "tool_ids" }, [], TOOLS), "Hech biri");
  assert.equal(formatValue({ type: "tool_ids" }, ["slide", "gone"], TOOLS), "Slayd, gone");
  assert.equal(formatValue({ type: "int" }, 1234567, TOOLS), "1\u00a0234\u00a0567");
  assert.equal(formatValue({ type: "number" }, 2.5, TOOLS), "2,5");
  const groups = groupItems(ITEMS as never);
  assert.deepEqual(groups.map((g) => g.group), ["Bepul AI", "Generatsiya", "Moliya", "Narxlar"]);
  assert.deepEqual(groups[1].items.map((i) => i.key), ["generation.paused", "generation.paused_tools"]);
});

/* ───────────────────────────── four states ───────────────────────────── */

test("loading: skeleton while the request is pending", async () => {
  stubFetch([() => new Promise<Response>(() => {})]);
  mount(h(SettingsPage, { tools: TOOLS }));
  assert.ok(document.querySelector('[aria-busy="true"]'));
  assert.ok(!screen.queryByText("Bepul AI"));
  assert.ok(screen.getByText(/15 soniyagacha/), "banner is shown from the start");
});

test("ready: grouped cards, values, source badges, env value, who and when", async () => {
  const calls = stubFetch([() => json(200, { items: ITEMS })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  assert.equal(calls[0].url, "/api/admin/settings");
  for (const title of ["Bepul AI", "Generatsiya", "Moliya", "Narxlar"]) assert.ok(screen.getByText(title), title);
  assert.ok(screen.getByRole("note").textContent?.includes("O'zgarish boshqa jarayonlarga 15 soniyagacha yetib boradi."));

  const outline = within(rowOf("free_llm.daily.outline"));
  assert.ok(outline.getByText("Env qiymati"));
  assert.ok(outline.getByText("7", { selector: "b" }));
  assert.ok(!outline.queryByText(/O'zgartirgan:/), "no writer without an override");
  assert.ok(!outline.queryByRole("button", { name: "Standartga qaytarish" }), "env source: nothing to reset");

  const paused = within(rowOf("generation.paused"));
  assert.equal(paused.getAllByText("O'chiq").length, 2, "value badge + env value");
  assert.ok(paused.getByText("Standart qiymat"));

  const soum = within(rowOf("finance.soum_per_usd"));
  assert.ok(soum.getByText("Admin qiymati"));
  assert.ok(soum.getByText("12 900", { selector: "b" }));
  assert.ok(soum.getByText("12 700"), "env value shown next to the override");
  assert.ok(soum.getByText("Dilnoza Admin"));
  assert.ok(soum.getByText(/01\.10\.2026 14:30/), "Tashkent time");
  assert.ok(soum.getByRole("button", { name: "Standartga qaytarish" }));

  assert.equal(within(rowOf("generation.paused_tools")).getAllByText("Hech biri").length, 2, "value + env value");
  assert.ok(within(rowOf("pricing.target_markup")).getByText("3", { selector: "b" }));
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
    stubFetch([() => json(200, { items: ITEMS })]);
    mount(h(SettingsPage, { tools: TOOLS }), role);
    await ready();
    assert.ok(!screen.queryByRole("button", { name: "O'zgartirish" }), role);
    assert.ok(!screen.queryByRole("button", { name: "Standartga qaytarish" }), role);
    assert.ok(screen.getByText(/faqat ko'rish huquqi/));
    // The override is still visible.
    assert.ok(within(rowOf("finance.soum_per_usd")).getByText("Admin qiymati"));
    cleanup();
  }
});

/* ───────────────────────────── edit flows ───────────────────────────── */

test("bool: switch + reason → PUT {value, reason}; the row flips to «Admin qiymati» and offers the reset", async () => {
  const saved = { ...PAUSED, value: true, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();

  fireEvent.click(within(rowOf("generation.paused")).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("Sozlamani o'zgartirish"));
  const sw = within(dialog).getByRole("switch") as HTMLButtonElement;
  assert.equal(sw.getAttribute("aria-checked"), "false");
  assert.equal(button("Saqlash").disabled, true, "reason missing");
  fireEvent.click(sw);
  assert.equal(sw.getAttribute("aria-checked"), "true");
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
  assert.ok(row.getByText("Admin qiymati"));
  assert.ok(row.getByRole("button", { name: "Standartga qaytarish" }));
});

test("int: bounds are checked as you type; the value is sent as a number", async () => {
  const saved = { ...OUTLINE, value: 12, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }));
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
  assert.ok(within(rowOf("free_llm.daily.outline")).getByText("Admin qiymati"));
});

test("number: decimal comma accepted, range 1–20 enforced", async () => {
  const saved = { ...MARKUP, value: 2.5, source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }));
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
  assert.ok(within(rowOf("pricing.target_markup")).getByText("2,5", { selector: "b" }));
});

test("tool_ids: options come from the server page; tick, «Hammasini tanlash», «Tozalash»; body is the id list", async () => {
  const saved = { ...PAUSED_TOOLS, value: ["essay", "referat"], source: "db", updatedBy: "Admin", updatedAt: "2026-10-02T07:00:00.000Z" };
  const calls = stubFetch([() => json(200, { items: ITEMS }), () => json(200, { item: saved })]);
  mount(h(SettingsPage, { tools: TOOLS }));
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
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  fireEvent.click(within(rowOf("generation.paused")).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("switch"));
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
  mount(h(SettingsPage, { tools: TOOLS }));
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
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  fireEvent.click(within(rowOf("generation.paused")).getByRole("button", { name: "O'zgartirish" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("switch"));
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
  mount(h(SettingsPage, { tools: TOOLS }));
  await ready();
  fireEvent.click(within(rowOf("finance.soum_per_usd")).getByRole("button", { name: "Standartga qaytarish" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(within(dialog).getByText("12 900"), "before");
  assert.ok(within(dialog).getByText("12 700", { selector: "span.font-semibold" }), "after = env value");
  assert.equal((within(dialog).getByRole("button", { name: "Standartga qaytarish" }) as HTMLButtonElement).disabled, true, "reason required");
  fireEvent.change(within(dialog).getByLabelText("Sabab"), { target: { value: "Kurs barqarorlashdi" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Standartga qaytarish" }));
  await waitFor(() => assert.ok(!screen.queryByRole("dialog")));
  assert.equal(calls[1].url, "/api/admin/settings/finance.soum_per_usd");
  assert.equal(calls[1].init.method, "DELETE");
  assert.deepEqual(calls[1].body, { reason: "Kurs barqarorlashdi" });
  assert.ok(toasts().some((m) => m.includes("Standart qiymat tiklandi")));
  const row = within(rowOf("finance.soum_per_usd"));
  assert.ok(row.getByText("Env qiymati"));
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
  mount(h(SettingsPage, { tools: TOOLS }));
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
  assert.ok(within(rowOf("finance.soum_per_usd")).getByText("Env qiymati"));
});
