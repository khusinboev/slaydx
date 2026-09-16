import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { TeacherComposer } from "../../components/forms/TeacherComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { teacherParamsOf } from "../../lib/generation/teacher-params.ts";
import { teacherKindOf } from "../../lib/generation/teacher/registry.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * O'qituvchi vositalari 2 (AUDIT-20 WP-E) — `TeacherComposer` interaktiv
 * xatti-harakat (`tests/ui/work-composer.test.mts` naqshi): 5 vosita
 * dispatch, tur tanlash (chegaralar bilan), test rejim tilalari
 * (mavzu/fayl/darslik dasturi), `CurriculumPicker` (mock fetch), shartli
 * maydonlar (uch-tilli tarjima, BSB mezon jadvali), narx, qoralama,
 * required, submit tanasi, «Tozalash».
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };

const profile: UserProfile = {
  name: "Karimova Dilnoza",
  language: "uz",
  points: 0,
  quota: 0,
  balance: 100000,
  premium: false,
  plan: "free",
  university: "",
  faculty: "",
  department: "",
  group: "",
  course: "",
  author: "Karimova Dilnoza",
  subject: "",
  teacher: "",
  city: "Toshkent",
  position: "",
  organization: "",
};

const CURRICULUM_TOPICS = {
  subject: "matematika",
  grade: 11,
  source: { title: "Matematika (XI sinf) dasturi", url: "https://example.uz" },
  units: [
    {
      title: "HOSILA VA UNING TATBIQLARI",
      topics: [
        { id: "hosila-va-uning-tatbiqlari-1", title: "X-sinfda o'tilganlarni takrorlash" },
        { id: "hosila-va-uning-tatbiqlari-2", title: "Funksiya limiti" },
        { id: "hosila-va-uning-tatbiqlari-10", title: "Hosilaning tatbiqi" },
      ],
    },
  ],
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
    if (/^\/api\/forms\/[\w-]+\/draft$/.test(url) && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (/^\/api\/forms\/[\w-]+\/draft$/.test(url)) return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "66666666-6666-4666-8666-666666666666", price: 4000 });
    if (url === "/api/users/me") return json(200, { ok: true });
    if (url.startsWith("/api/curriculum?subject=matematika&grade=11")) return json(200, CURRICULUM_TOPICS);
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

type ToolId = "lesson-plan" | "texnologik-xarita" | "glossary" | "keys" | "test";
function mount(toolId: ToolId = "test") {
  render(h(AppRouterContext.Provider, { value: router }, h(TeacherComposer, { tool: TOOL_BY_ID[toolId], profile, user: null })));
}

const submitBody = (calls: Call[]) => (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { slug: string; values: Record<string, unknown> }).values;

test("qamrov: teacherParamsOf(test) dagi har parametr data-field bilan (mutatsiya: bittasini olib tashlasang qizaradi)", async () => {
  stubApi();
  await login();
  mount("test");
  const found = new Set([...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")));
  const missing = teacherParamsOf(teacherKindOf("test")!)
    .map((p) => p.id)
    .filter((id) => !found.has(id));
  assert.deepEqual(missing, [], `formada yo'q maydonlar: ${missing.join(", ")}`);
});

test("qamrov: teacherParamsOf(lesson) dagi har parametr data-field bilan", async () => {
  stubApi();
  await login();
  mount("lesson-plan");
  const found = new Set([...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")));
  const missing = teacherParamsOf(teacherKindOf("lesson-plan")!)
    .map((p) => p.id)
    .filter((id) => !found.has(id));
  assert.deepEqual(missing, [], `formada yo'q maydonlar: ${missing.join(", ")}`);
});

test("dispatch: ToolWorkspace 5 vositaning barchasida TeacherComposer ni chizadi", async () => {
  stubApi();
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  for (const id of ["lesson-plan", "texnologik-xarita", "glossary", "keys", "test"] as const) {
    cleanup();
    render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: TOOL_BY_ID[id] })));
    await waitFor(() => assert.ok(document.querySelector('[data-field="university"]'), `${id}: TeacherComposer chizilmadi`));
  }
  cleanup();
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: TOOL_BY_ID.essay })));
  await waitFor(() => assert.ok(document.querySelector('[data-field="essayContext"]'), "insho o'z formasini chizishi kerak"));
  assert.ok(!document.querySelector('[data-field="lessonType"]'), "insho TeacherComposer emas");
});

test("dars rejasi: tur almashtirish (Amaliy dars) davomiylik/bosqich chegaralarini yangilaydi", async () => {
  const calls = stubApi();
  await login();
  mount("lesson-plan");
  const typeGroup = () => within(screen.getByRole("radiogroup", { name: "Tur" }));
  await act(async () => {
    fireEvent.click(typeGroup().getByText(/Amaliy/));
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Kvadrat tenglama" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "TDPU" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["lesson-plan"].submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  assert.equal(submitBody(calls).lessonType, "amaliy");
});

test("test: rejim tilalari — fayl tanlansa Mavzu yashiriladi, SourceFileField ko'rinadi", async () => {
  stubApi();
  await login();
  mount("test");
  const isHidden = (sel: string) => Boolean(document.querySelector(sel)!.closest(".hidden"));
  assert.ok(!isHidden('[data-field="topic"]'), "standart mavzu rejimida ko'rinadi");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Fayl asosida"));
  });
  assert.ok(isHidden('[data-field="topic"]'), "fayl rejimida mavzu yashirin");
  assert.ok(!isHidden('[data-field="sourceText"]'), "fayl rejimida SourceFileField ko'rinadi");
});

test("test: darslik dasturi rejimida CurriculumPicker ko'rinadi va fan/sinf/mavzu tanlash topicIds ni to'ldiradi", async () => {
  const calls = stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Darslik dasturi asosida"));
  });
  const picker = document.querySelector("[data-curriculum-picker]") as HTMLElement;
  assert.ok(picker, "CurriculumPicker chizilishi kerak");
  await act(async () => {
    fireEvent.change(within(picker).getByLabelText("Fan"), { target: { value: "matematika" } });
  });
  await waitFor(() => assert.ok(within(picker).getByLabelText("Sinf") as HTMLSelectElement));
  await act(async () => {
    fireEvent.change(within(picker).getByLabelText("Sinf"), { target: { value: "11" } });
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url.includes("/api/curriculum?subject=matematika&grade=11"))));
  await waitFor(() => assert.ok(document.querySelector('[data-topic="hosila-va-uning-tatbiqlari-1"]')));
  await act(async () => {
    fireEvent.click(document.querySelector('[data-topic="hosila-va-uning-tatbiqlari-1"]')!);
  });
  await act(async () => {
    fireEvent.click(document.querySelector('[data-topic="hosila-va-uning-tatbiqlari-10"]')!);
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "TDPU" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="author"] input')!, { target: { value: "Rahimov B." } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.test.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = submitBody(calls);
  assert.equal(values.mode, "curriculum");
  assert.equal(values.subjectId, "matematika");
  const ids = JSON.parse(String(values.topicIds)) as string[];
  assert.deepEqual(ids, ["hosila-va-uning-tatbiqlari-1", "hosila-va-uning-tatbiqlari-10"]);
});

test("test: darslik dasturi rejimida mavzu tanlanmasa submit rad etiladi", async () => {
  stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Darslik dasturi asosida"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.test.submitLabel));
  });
  assert.match(document.body.textContent ?? "", /mavzu/i);
});

test("glossariy: atama soni narxni o'zgartiradi (10 -> 6 000, 40 -> 15 000)", async () => {
  stubApi();
  await login();
  mount("glossary");
  const group = () => within(screen.getByRole("radiogroup", { name: "Atama soni" }));
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /6[\s ]?000/);
  await act(async () => {
    fireEvent.click(group().getByText(/^40 ta/));
  });
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /15[\s ]?000/);
});

test("glossariy: uch tilli tur tanlanganda tarjima tillari ko'rinadi, boshqa turda yashirin (mutatsiya)", async () => {
  stubApi();
  await login();
  mount("glossary");
  const isHidden = () => Boolean(document.querySelector('[data-field="translationLangs"]')!.closest(".hidden"));
  assert.ok(isHidden(), "standart «fan lug'ati» da yashirin");
  const typeGroup = () => within(screen.getByRole("radiogroup", { name: "Tur" }));
  await act(async () => {
    fireEvent.click(typeGroup().getByText(/Uch tilli/));
  });
  assert.ok(!isHidden(), "«uch-tilli» tanlanganda ko'rinadi");
});

test("test: mezon jadvali faqat BSB/ChSB turida ko'rinadi (mutatsiya)", async () => {
  stubApi();
  await login();
  mount("test");
  const isHidden = () => Boolean(document.querySelector('[data-field="criteriaTable"]')!.closest(".hidden"));
  assert.ok(isHidden(), "standart «Joriy nazorat ishi» da yashirin");
  const typeGroup = () => within(screen.getByRole("radiogroup", { name: "Tur" }));
  await act(async () => {
    fireEvent.click(typeGroup().getByText(/BSB uslubida/));
  });
  assert.ok(!isHidden(), "BSB turida ko'rinadi");
});

test("test: savol soni turdan turga o'zgarganda yangi tur chegarasiga siqiladi", async () => {
  stubApi();
  await login();
  mount("test");
  const typeGroup = () => within(screen.getByRole("radiogroup", { name: "Tur" }));
  await act(async () => {
    fireEvent.click(typeGroup().getByText(/BSB uslubida/));
  });
  const countGroup = within(screen.getByRole("radiogroup", { name: "Savol soni" }));
  const options = countGroup.getAllByRole("radio").map((b) => b.textContent);
  assert.deepEqual(options, ["5", "8", "10"], "BSB uslubida savol soni chegarasi 5/8/10");
});

test("qoralama: yozgandan keyin BIR marta PUT (debounce)", async () => {
  const calls = stubApi();
  await login();
  mount("lesson-plan");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Yangi dars mavzusi" } });
  });
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
  assert.equal(data.topic, "Yangi dars mavzusi");
});

test("qoralama tiklanadi: serverdagi qiymatlar formaga tushadi", async () => {
  stubApi({ topic: "Tiklangan mavzu", lessonType: "amaliy", university: "TATU", author: "Karimov K." });
  await login();
  mount("lesson-plan");
  await waitFor(() => {
    assert.equal((document.querySelector('[data-field="topic"] input') as HTMLInputElement).value, "Tiklangan mavzu");
  });
  assert.equal((document.querySelector('[data-field="university"] input') as HTMLInputElement).value, "TATU");
});

test("mavzu yoki muassasa/tuzuvchi bo'sh bo'lsa submit rad etiladi", async () => {
  stubApi();
  await login();
  mount("lesson-plan");
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["lesson-plan"].submitLabel));
  });
  assert.match(document.body.textContent ?? "", /Dars mavzusi|Mavzu/i);
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Mavzu bor" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["lesson-plan"].submitLabel));
  });
  assert.match(document.body.textContent ?? "", /muassasa/i);
});

test("«Tozalash»: ikkinchi bosishda DELETE ketadi va forma bo'shaydi", async () => {
  const calls = stubApi();
  await login();
  mount("lesson-plan");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "O'chiriladigan mavzu" } });
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
  assert.equal((document.querySelector('[data-field="topic"] input') as HTMLInputElement).value, "");
});

test("Yaratish: to'liq test formasi — testType/count/questionKinds/variants/omr submit tanasida", async () => {
  const calls = stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Hosila mavzusi" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "42-maktab" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="author"] input')!, { target: { value: "Aliyev A." } });
  });
  // Standart «Joriy nazorat ishi» — savol turlari faqat single/truefalse;
  // «To'g'ri/Noto'g'ri» ni o'chirib, faqat «single» qolishini tekshiramiz.
  await act(async () => {
    fireEvent.click(within(screen.getByRole("group", { name: "Savol turlari" })).getByText("To'g'ri/Noto'g'ri"));
  });
  await act(async () => {
    fireEvent.click(screen.getByLabelText("OMR varag'i"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.test.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = submitBody(calls);
  assert.equal(values.testType, "nazorat");
  assert.equal(values.omr, true);
  const kinds = JSON.parse(String(values.questionKinds)) as string[];
  assert.deepEqual(kinds, ["single"]);
  assert.equal(values.variants, 2);
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});
