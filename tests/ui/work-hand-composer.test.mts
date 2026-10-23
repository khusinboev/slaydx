import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { WorkComposer } from "../../components/forms/WorkComposer.tsx";
import { WORK_HAND_PARAMS, WORK_PARAMS } from "../../lib/generation/work-params.ts";
import { TOOL_BY_ID, priceFor } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Qo'lyozma mustaqil ish formasi (Program 17 band 10): «Ko'rinish» faqat
 * mustaqil ishda; «Qo'lyozma» tanlansa siyoh/qog'oz/shrift paydo bo'ladi,
 * tanlov submit tanasiga tushadi, qoralama tiklanadi, narx o'zgarmaydi.
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

function mount(toolId: "coursework" | "referat" | "mustaqil-ish") {
  render(h(AppRouterContext.Provider, { value: router }, h(WorkComposer, { tool: TOOL_BY_ID[toolId], profile, user: null })));
}

const fields = () => [...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field") ?? "");
const pick = async (group: string, label: string) => {
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByText(label));
  });
};

test("«Ko'rinish» faqat mustaqil ishda: kurs ishi va referat formasida YO'Q", async () => {
  stubApi();
  await login();
  for (const id of ["coursework", "referat"] as const) {
    mount(id);
    const found = fields();
    for (const p of WORK_HAND_PARAMS) assert.ok(!found.includes(p.id), `${id}: ${p.id} chizilmasligi kerak`);
    cleanup();
  }
});

test("mustaqil ish: standart «Oddiy» — workView bor, sub-parametrlar yo'q; «Qo'lyozma» uchtasini ochadi (har id AYNAN bitta)", async () => {
  stubApi();
  await login();
  mount("mustaqil-ish");
  let found = fields();
  assert.ok(found.includes("workView"));
  for (const id of ["handInk", "handPaper", "handFont"]) assert.ok(!found.includes(id), `${id} «Oddiy» da yashirin`);
  assert.ok(!document.querySelector("[data-hand-preview]"));
  await pick("Ko‘rinish", "Qo‘lyozma");
  found = fields();
  for (const p of WORK_HAND_PARAMS) assert.equal(found.filter((x) => x === p.id).length, 1, `${p.id} aynan bitta data-field`);
  assert.ok(document.querySelector("[data-hand-preview]"), "namuna ko'rinadi");
  // Teskari: reyestrlarda yo'q maydon yo'q.
  const known = new Set([...WORK_PARAMS, ...WORK_HAND_PARAMS].map((p) => p.id));
  assert.deepEqual([...new Set(found)].filter((x) => !known.has(x)), []);
  await pick("Ko‘rinish", "Oddiy (Word)");
  assert.ok(!fields().includes("handInk"), "«Oddiy» ga qaytsa yana yashirin");
});

test("tanlov submit tanasiga tushadi (workView/handInk/handPaper/handFont) va narx o'zgarmaydi", async () => {
  const calls = stubApi();
  await login();
  mount("mustaqil-ish");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Suv resurslari" } });
  });
  await pick("Ko‘rinish", "Qo‘lyozma");
  await pick("Siyoh rangi", "Qora");
  await pick("Qog‘oz", "Katakli");
  await pick("Shrift", "Caveat");
  const preview = document.querySelector("[data-hand-preview]") as HTMLElement;
  assert.ok(preview.className.includes("hand-preview--grid"), "namuna katakli");
  assert.equal(preview.style.getPropertyValue("--hand-ink"), "#1C1C1E", "namuna qora siyoh");
  assert.ok(preview.style.getPropertyValue("--hand-family").includes("Caveat"), "namuna Caveat");
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["mustaqil-ish"].submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const values = (post.body as { values: Record<string, unknown> }).values;
  assert.equal(values.workView, "hand");
  assert.equal(values.handInk, "black");
  assert.equal(values.handPaper, "grid");
  assert.equal(values.handFont, "caveat");
  assert.equal(priceFor(TOOL_BY_ID["mustaqil-ish"], values), priceFor(TOOL_BY_ID["mustaqil-ish"], { ...values, workView: "plain" }), "narx o'zgarmaydi");
});

test("«Oddiy» holatda submit tanasida workView=plain va hand maydonlari YO'Q", async () => {
  const calls = stubApi();
  await login();
  mount("mustaqil-ish");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Suv resurslari" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["mustaqil-ish"].submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> }).values;
  assert.equal(values.workView, "plain");
  assert.ok(!("handInk" in values) && !("handPaper" in values) && !("handFont" in values));
});

test("qoralama tiklanadi: workView=hand + binafsha/katakli/Caveat formaga tushadi", async () => {
  stubApi({ topic: "Qoralama", workView: "hand", handInk: "purple", handPaper: "grid", handFont: "caveat" });
  await login();
  mount("mustaqil-ish");
  await waitFor(() => assert.ok(document.querySelector("[data-hand-preview]")));
  const checked = (g: string) => within(screen.getByRole("radiogroup", { name: g })).getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent;
  assert.equal(checked("Ko‘rinish"), "Qo‘lyozma");
  assert.equal(checked("Siyoh rangi"), "Binafsha");
  assert.equal(checked("Qog‘oz"), "Katakli");
  assert.equal(checked("Shrift"), "Caveat");
});
