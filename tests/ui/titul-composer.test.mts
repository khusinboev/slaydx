import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { TitulComposer } from "../../components/forms/TitulComposer.tsx";
import { titulFieldsOf } from "../../lib/generation/title-page/input.ts";
import { TITUL_LAYOUTS_OF, TITUL_LAYOUT_LABEL, TITUL_WORK_TYPES, TITUL_WORK_TYPE_LABEL } from "../../lib/generation/title-page/types.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * «Titul» form: for every type × layout the drawn `data-field`s are EXACTLY `titulFieldsOf` (each once — the probe
 * test proves each of them changes the page), the price reads «Bepul», the profile prefills the author block, and
 * «Yaratish» sends price 0 with only the drawn fields.
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `TitulComposer` draws «Kurs» for every layout (ignores `shown`) -> «exactly the fields of the page»;
 *   M2. `ToolChrome` shows `formatSom(price)` again -> «Bepul»;
 *   M3. `titulInputValues` sends every field -> «only the drawn fields».
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

type Call = { url: string; method: string; body?: unknown };
function stubApi() {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (/^\/api\/forms\/[a-z-]+\/draft$/.test(url) && method === "GET") return json(200, { draft: null });
    if (/^\/api\/forms\/[a-z-]+\/draft$/.test(url)) return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(202, { id: "55555555-5555-4555-8555-555555555555", price: 0, status: "QUEUED" });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

const PROFILE = {
  name: "Aliyev V.",
  author: "Aliyev V.",
  university: "Toshkent davlat universiteti",
  faculty: "Kompyuter injiniringi",
  department: "Axborot xavfsizligi",
  group: "912-21",
  course: "3",
  teacher: "Karimov B.",
  subject: "Dasturlash asoslari",
  city: "Toshkent",
} as unknown as UserProfile;

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(TitulComposer, { tool: TOOL_BY_ID["title-page"], profile: PROFILE })));
}

const fields = () => [...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field") ?? "");

test("exactly the fields of the page, each once, for every type × layout", async () => {
  stubApi();
  await login();
  mount();
  for (const t of TITUL_WORK_TYPES) {
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "Ish turi" }), { target: { value: t } });
    });
    for (const layout of TITUL_LAYOUTS_OF[t]) {
      await act(async () => {
        fireEvent.click(within(screen.getByRole("radiogroup", { name: "Ko‘rinish" })).getByText(TITUL_LAYOUT_LABEL[layout]));
      });
      const found = fields();
      const want = titulFieldsOf(t, layout, "oliy");
      for (const id of want) assert.equal(found.filter((x) => x === id).length, 1, `${TITUL_WORK_TYPE_LABEL[t]}/${layout}: «${id}» once`);
      assert.deepEqual([...new Set(found)].filter((x) => !want.includes(x as never)), [], `${t}/${layout}: nothing outside the page`);
    }
  }
});

test("price reads «Bepul»; profile prefills; «Yaratish» sends only the drawn fields", async () => {
  const calls = stubApi();
  await login();
  mount();
  const price = document.querySelector("[data-price-total]");
  assert.ok(price);
  assert.equal(price!.textContent, "Bepul");
  assert.ok(screen.getByDisplayValue("Karimov B."), "teacher from the profile");
  fireEvent.change(screen.getByPlaceholderText("Sun’iy intellektning ta’limdagi o‘rni"), { target: { value: "Sun'iy intellekt" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Titulni yaratish/ }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST");
  assert.ok(post, "no POST");
  const body = post!.body as { slug: string; values: Record<string, unknown>; expectedPrice: number };
  assert.equal(body.slug, "titul");
  assert.equal(body.expectedPrice, 0);
  assert.equal(body.values.topic, "Sun'iy intellekt");
  assert.equal(body.values.supervisor, "Karimov B.");
  assert.ok(!("udk" in body.values), "a field the classic page does not draw is not sent");
  assert.deepEqual(Object.keys(body.values).sort(), [...titulFieldsOf("coursework", "classic", "oliy")].sort());
});
