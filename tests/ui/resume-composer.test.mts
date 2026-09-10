import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResumeComposer } from "../../components/forms/ResumeComposer.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Rezyume formasi — interaktiv xatti-harakat (Rezyume 2).
 *
 * SSR testi (`tests/viewer/resume-form.test.mts`) maydonlar BORLIGINI
 * tekshiradi; bu yerda ular ISHLASHI: tumbler blokni ochadi, qoralama
 * debounce'dan keyin BIR marta saqlanadi, «Yaratish» tuzilmali JSON
 * yuboradi, «Tozalash» qoralamani o'chiradi.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.resume;
const profile: UserProfile = {
  name: "Karimova Dilnoza", language: "uz", points: 0, quota: 0, balance: 100000, premium: false, plan: "free",
  university: "", faculty: "", department: "", group: "", course: "", author: "Karimova Dilnoza", subject: "",
  teacher: "", city: "Toshkent", position: "", organization: "",
};

type Call = { url: string; method: string; body?: unknown };
function stubApi(draft: Record<string, unknown> | null = null) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === "/api/resume/draft" && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (url === "/api/resume/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "33333333-3333-4333-8333-333333333333", price: 3000 });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

/** Store ichidagi `loggedIn` — qoralama faqat kirgan foydalanuvchi uchun so'raladi. */
async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(ResumeComposer, { tool, profile })));
}

test("tumbler blokni ochadi va yopadi (sertifikat standart holatda yopiq)", async () => {
  stubApi();
  await login();
  mount();
  assert.equal(document.querySelector('[data-rowlist="certificates"]'), null, "boshida yopiq");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Sertifikatlar"));
  });
  assert.ok(document.querySelector('[data-rowlist="certificates"]'), "tumbler blokni ochdi");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Sertifikatlar"));
  });
  assert.equal(document.querySelector('[data-rowlist="certificates"]'), null, "qayta yopildi");
});

test("qoralama: yozgandan keyin BIR marta PUT (debounce), tarkibida forma qiymatlari", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "998901234567" } });
  });
  // Debounce ichida hali yuborilmagan.
  assert.equal(calls.filter((c) => c.method === "PUT").length, 0, "darhol yuborilmaydi");
  await waitFor(
    () => {
      assert.ok(calls.filter((c) => c.method === "PUT").length >= 1, "debounce'dan keyin saqlanadi");
    },
    { timeout: 4000 },
  );
  const puts = calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1, `bitta PUT kutilgan edi, ${puts.length} ta`);
  const data = (puts[0].body as { data: Record<string, unknown> }).data;
  assert.equal(data.phone, "+998901234567", "telefon normal shaklda");
  assert.equal(data.enrich, true, "boyitish standart holatda yoqilgan");
});

test("qoralama tiklanadi: serverdagi qiymatlar formaga tushadi", async () => {
  stubApi({ fullName: "Aliyev Ali", targetRole: "Buxgalter", phone: "+998712000000", language: "ru" });
  await login();
  mount();
  await waitFor(() => {
    assert.equal((screen.getByLabelText("Telefon") as HTMLInputElement).value, "+998 71 200 00 00");
  });
  assert.equal((screen.getByLabelText("Maqsadli lavozim") as HTMLInputElement).value, "Buxgalter");
  assert.equal((screen.getByLabelText("Chiqish tili") as HTMLSelectElement).value, "ru");
});

test("Yaratish: tuzilmali satrlar JSON bo'lib ketadi, topic — lavozim", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Maqsadli lavozim"), { target: { value: "Moliya tahlilchisi" } });
  });
  // Bitta ish joyi qo'shamiz.
  await act(async () => {
    fireEvent.click(screen.getByText("+ Ish joyi"));
  });
  const company = document.querySelector('[data-rowlist="experience"] input') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(company, { target: { value: "Artel" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => {
    assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST"), "generatsiya so'rovi ketdi");
  });
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const values = (post.body as { values: Record<string, unknown> }).values;
  assert.equal(values.topic, "Moliya tahlilchisi", "topic — maqsadli lavozim");
  assert.equal(values.fullName, "Karimova Dilnoza");
  const rows = JSON.parse(String(values.experience)) as { company: string }[];
  assert.equal(rows[0].company, "Artel", "ish joyi JSON bo'lib yuborildi");
  // Yopiq bloklar bo'sh massiv bo'lib ketadi — model yo'q ma'lumot ustida ishlamaydi.
  assert.equal(JSON.parse(String(values.certificates)).length, 0);
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});

test("«Formani tozalash»: ikkinchi bosishda DELETE ketadi va forma bo'shaydi", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Maqsadli lavozim"), { target: { value: "Buxgalter" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const btn = screen.getByText("Formani tozalash");
  await act(async () => {
    fireEvent.click(btn);
  });
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0, "birinchi bosish faqat ogohlantiradi");
  await act(async () => {
    fireEvent.click(screen.getByText(/Ishonchingiz komilmi/));
  });
  await waitFor(() => {
    assert.equal(calls.filter((c) => c.method === "DELETE").length, 1, "ikkinchi bosishda o'chiriladi");
  });
  assert.equal((screen.getByLabelText("Maqsadli lavozim") as HTMLInputElement).value, "");
});
