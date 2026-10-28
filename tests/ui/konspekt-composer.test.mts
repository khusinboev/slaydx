import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { KonspektComposer } from "../../components/forms/KonspektComposer.tsx";
import { KONSPEKT_FORM_FIELDS } from "../../lib/generation/konspekt/params.ts";
import { TOOL_BY_ID, priceFor } from "../../lib/tools.ts";
import type { FormValues, UserProfile } from "../../lib/types.ts";

/**
 * Konspekt form: every registry id is rendered exactly once, rows that cannot work are hidden, the
 * submitted values carry the defaults (grid, A5×2, alternating margin line, 1-cell rows), price follows
 * the tier, a saved draft restores through the SAME input function the engine reads.
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "Aliyev Ali", language: "uz", points: 0, quota: 0, balance: 100000, university: "TDPU", faculty: "", department: "", group: "", course: "",
  author: "Aliyev Ali", subject: "", teacher: "", city: "Toshkent", position: "", organization: "",
};

type Call = { url: string; method: string; body?: unknown };
function stubApi(draft: Record<string, unknown> | null = null) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (/^\/api\/forms\/[a-z-]+\/draft$/.test(url) && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (/^\/api\/forms\/[a-z-]+\/draft$/.test(url)) return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "55555555-5555-4555-8555-555555555555", price: 3000 });
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
  render(h(AppRouterContext.Provider, { value: router }, h(KonspektComposer, { tool: TOOL_BY_ID.konspekt })));
}

const fields = () => [...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field") ?? "");
const pick = async (group: string, label: string | RegExp) => {
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByText(label));
  });
};

test("every registry id is rendered exactly once; nothing outside the registry; no decorative handwriting fields (headings/underline/cover are not offered)", async () => {
  stubApi();
  await login();
  mount();
  const found = fields();
  for (const id of KONSPEKT_FORM_FIELDS) assert.equal(found.filter((x) => x === id).length, 1, `${id}: exactly one data-field`);
  assert.deepEqual([...new Set(found)].filter((x) => !KONSPEKT_FORM_FIELDS.includes(x)), [], "no field outside the registry");
  for (const gone of ["handHeadings", "handUnderline", "handCover"]) assert.ok(!found.includes(gone), `${gone} is not a konspekt choice`);
  assert.ok(document.querySelector("[data-hand-preview]"), "preview");
});

test("conditional rows: blank paper has cells but no margin line; lined paper has a margin line but no cells", async () => {
  stubApi();
  await login();
  mount();
  await pick("Qog‘oz", "Oq qog‘oz");
  assert.ok(fields().includes("handCells") && !fields().includes("handMargin"));
  await pick("Qog‘oz", "Chiziqli");
  assert.ok(!fields().includes("handCells") && fields().includes("handMargin"));
});

test("submit: defaults reach the server (grid, A5×2, alternate, 1 cell, lively), the tier sets the price, the topic falls back to the file name", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Davlatchilik tarixi" } });
  });
  await pick("Hajm", /^20-30 varaq/);
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.konspekt.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: FormValues }).values;
  assert.equal(values.topic, "Davlatchilik tarixi");
  assert.equal(values.pages, "20-30");
  assert.deepEqual([values.handPaper, values.handFormat, values.handMargin, values.handCells, values.handLively, values.handFont, values.handInk], ["grid", "a5x2", "alternate", "1", "on", "school", "blue"]);
  assert.equal(priceFor(TOOL_BY_ID.konspekt, values), 5000);
});

test("draft restore goes through the engine's input function: values come back as the form state", async () => {
  stubApi({ topic: "Qoralama mavzu", language: "ru", pages: "5-10", handPaper: "blank", handCells: "2", handFormat: "a5", handFont: "pen", handLively: "off" });
  await login();
  mount();
  await waitFor(() => assert.equal((document.querySelector('[data-field="topic"] input') as HTMLInputElement).value, "Qoralama mavzu"));
  const checked = (group: string) => within(screen.getByRole("radiogroup", { name: group })).getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent ?? "";
  assert.equal(checked("Til"), "Русский");
  assert.match(checked("Hajm"), /^5-10 varaq/);
  assert.equal(checked("Qog‘oz"), "Oq qog‘oz");
  assert.equal(checked("Shrift"), "Qalam-pero");
  assert.equal(checked("Yozuv"), "Tekis");
  assert.equal(checked("Format"), "A5 (daftar)");
});
