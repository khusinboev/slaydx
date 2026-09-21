import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { TeacherComposer } from "../../components/forms/TeacherComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TEACHER_PARAMS, teacherParamsOf } from "../../lib/generation/teacher-params.ts";
import { teacherKindOf } from "../../lib/generation/teacher/registry.ts";
import { TOOL_BY_ID, missingRequired } from "../../lib/tools.ts";
import type { FormValues, UserProfile } from "../../lib/types.ts";

/**
 * O'qituvchi formasi (AUDIT-24 WP-B, «Formalar 3») — 5 vosita bitta
 * qobiqda: `components/forms/teacher/` (qobiq + 5 kind fayli).
 *
 * Nimani qulflaydi: kartalar tartibi (Shapka OCHIQ karta, ▸ Sozlamalar
 * YOPIQ), reyestr qamrovi ikki yo'nalishda (`data-field` — yetishmagan
 * ham, ortiqcha ham qizaradi), `approver` faqat `bsb`/`chsb` test
 * turida (dvigatel qolgan turlarda uni tashlaydi), FAN BITTA MANBA
 * (o'quv dasturi ↔ matn), test rejim tilalari, xulosa chiplari, sana
 * (kun/oy/yil → `YYYY-MM-DD`), qoralama, submit tanasi va «Tozalash».
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
const TOOL_IDS: ToolId[] = ["lesson-plan", "texnologik-xarita", "glossary", "keys", "test"];

function mount(toolId: ToolId = "test") {
  render(h(AppRouterContext.Provider, { value: router }, h(TeacherComposer, { tool: TOOL_BY_ID[toolId], profile, user: null })));
}

const submitBody = (calls: Call[]) => (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { slug: string; values: Record<string, unknown> }).values;
const fields = () => new Set([...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")!));
const isHidden = (sel: string) => Boolean(document.querySelector(sel)!.closest(".hidden"));
const settings = () => document.querySelector("details[data-settings]") as HTMLDetailsElement | null;

/* ───────────────────────── qamrov ───────────────────────── */

for (const id of TOOL_IDS) {
  test(`qamrov: ${id} — teacherParamsOf dagi har parametr data-field bilan chizilgan`, async () => {
    stubApi();
    await login();
    mount(id);
    if (id === "test") {
      // `approver` faqat bsb/chsb da chiziladi (pastdagi testlar) — qamrov
      // uchun aynan shu turni tanlaymiz.
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Test turi"), { target: { value: "bsb" } });
      });
    }
    const found = fields();
    const missing = teacherParamsOf(teacherKindOf(id)!)
      .map((p) => p.id)
      .filter((fid) => !found.has(fid));
    assert.deepEqual(missing, [], `${id}: formada yo'q maydonlar: ${missing.join(", ")}`);
  });
}

test("qamrov: ORTIQCHA data-field yo'q — har belgi reyestrda (yoki o'quv dasturi fani)", async () => {
  stubApi();
  await login();
  /*
   * `subjectId` — `CurriculumPicker` ning o'z fani: reyestrda alohida
   * parametr emas (dvigatelga `mode`+`topicIds` juftligi orqali
   * ta'sir qiladi), shuning uchun YAGONA ruxsat etilgan istisno.
   */
  const allowed = new Set([...TEACHER_PARAMS.map((p) => p.id), "subjectId"]);
  for (const id of TOOL_IDS) {
    cleanup();
    mount(id);
    const extra = [...fields()].filter((f) => !allowed.has(f));
    assert.deepEqual(extra, [], `${id}: reyestrda yo'q maydon chizilgan: ${extra.join(", ")}`);
  }
});

test("qamrov: kind-xos maydon BOSHQA vositada chizilmaydi (glossariy da test qatorlari yo'q)", async () => {
  stubApi();
  await login();
  mount("glossary");
  const found = fields();
  for (const fid of ["count", "omr", "variants", "duration", "weeklyHours"]) assert.ok(!found.has(fid), `glossariyda ${fid} bo'lmasligi kerak`);
  assert.ok(found.has("termCount"), "glossariyda atama soni bor");
});

test("dispatch: ToolWorkspace 5 vositaning barchasida TeacherComposer ni chizadi", async () => {
  stubApi();
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  for (const id of TOOL_IDS) {
    cleanup();
    render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: TOOL_BY_ID[id] })));
    await waitFor(() => assert.ok(document.querySelector('[data-field="university"]'), `${id}: TeacherComposer chizilmadi`));
  }
  cleanup();
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: TOOL_BY_ID.essay })));
  await waitFor(() => assert.ok(document.querySelector('[data-field="essayContext"]'), "insho o'z formasini chizishi kerak"));
  assert.ok(!document.querySelector('[data-field="lessonType"]'), "insho TeacherComposer emas");
});

/* ───────────────────────── kartalar / yig'iqlik ───────────────────────── */

test("▸ Sozlamalar YOPIQ keladi va sahifada umuman ochiq <details> yo'q (Shapka endi karta)", async () => {
  stubApi();
  await login();
  for (const id of TOOL_IDS) {
    cleanup();
    mount(id);
    const d = settings();
    assert.ok(d, `${id}: Sozlamalar bo'limi yo'q`);
    assert.equal(d!.open, false, `${id}: Sozlamalar yopiq kelishi kerak`);
    assert.ok(!document.querySelector("details[open]"), `${id}: ochiq <details> qolmasligi kerak (eski «Shapka» open edi)`);
    assert.match(document.body.textContent ?? "", /Shapka/, `${id}: «Shapka» kartasi ko'rinadi`);
  }
});

test("test: og'ir kind qatorlari (qiyinlik, variantlar, OMR, vaqt) ASOSIY kartada emas, Sozlamalar ichida", async () => {
  stubApi();
  await login();
  mount("test");
  for (const fid of ["questionKinds", "openCount", "difficulty", "variants", "timeMin", "omr", "answerKey", "criteriaTable"]) {
    assert.ok(document.querySelector(`[data-settings] [data-field="${fid}"]`), `${fid} Sozlamalar ichida bo'lishi kerak`);
  }
  // Asosiy karta — faqat tur va savol soni.
  for (const fid of ["testType", "count"]) {
    assert.ok(!document.querySelector(`[data-settings] [data-field="${fid}"]`), `${fid} asosiy kartada qolishi kerak`);
  }
});

test("dars rejasi: bosqich/kompetensiya/baholash Sozlamalarda, tur va davomiylik asosiy kartada", async () => {
  stubApi();
  await login();
  mount("lesson-plan");
  for (const fid of ["stageCount", "competencies", "assessmentStyle", "gradeLetter", "extra"]) {
    assert.ok(document.querySelector(`[data-settings] [data-field="${fid}"]`), `${fid} Sozlamalar ichida bo'lishi kerak`);
  }
  for (const fid of ["lessonType", "duration"]) {
    assert.ok(!document.querySelector(`[data-settings] [data-field="${fid}"]`), `${fid} asosiy kartada bo'lishi kerak`);
  }
});

test("xulosa chiplari: yopiq Sozlamalar tur · sinf · hajm · rejimni ko'rsatadi", async () => {
  stubApi();
  await login();
  mount("test");
  const chips = () => document.querySelector("[data-summary-chips]")!.textContent ?? "";
  assert.match(chips(), /Joriy nazorat ishi/, "tur chipi");
  assert.match(chips(), /8-sinf/, "sinf chipi");
  assert.match(chips(), /savol/, "savol soni chipi");
  assert.match(chips(), /Mavzu asosida/, "rejim chipi");
});

test("xulosa chiplari tanlov bilan yangilanadi (tur almashtirilganda)", async () => {
  stubApi();
  await login();
  mount("glossary");
  const chips = () => document.querySelector("[data-summary-chips]")!.textContent ?? "";
  assert.match(chips(), /Fan lug/, "standart tur chipi");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Glossariy turi"), { target: { value: "uch-tilli" } });
  });
  assert.match(chips(), /Uch tilli/, "yangi tur chipi");
});

/* ───────────────────────── approver (bsb/chsb) ───────────────────────── */

test("approver: test kindida standart «Joriy nazorat ishi» da YO'Q (dvigatel uni tashlaydi)", async () => {
  stubApi();
  await login();
  mount("test");
  assert.ok(!document.querySelector('[data-field="approver"]'), "nazorat turida «Tasdiqlayman» chizilmaydi");
});

test("approver: bsb va chsb turlarida BOR, dtm/olimpiada/diagnostika da yana yo'qoladi (mutatsiya)", async () => {
  stubApi();
  await login();
  mount("test");
  const pick = async (v: string) => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Test turi"), { target: { value: v } });
    });
  };
  await pick("bsb");
  assert.ok(document.querySelector('[data-field="approver"]'), "bsb: ko'rinadi");
  await pick("chsb");
  assert.ok(document.querySelector('[data-field="approver"]'), "chsb: ko'rinadi");
  for (const v of ["dtm", "olimpiada", "diagnostika", "nazorat"]) {
    await pick(v);
    assert.ok(!document.querySelector('[data-field="approver"]'), `${v}: ko'rinmasligi kerak`);
  }
});

test("approver: dars rejasi va xaritada DOIM bor, glossariy/keysda umuman yo'q", async () => {
  stubApi();
  await login();
  for (const id of ["lesson-plan", "texnologik-xarita"] as const) {
    cleanup();
    mount(id);
    assert.ok(document.querySelector('[data-field="approver"]'), `${id}: «Tasdiqlayman» bo'lishi kerak`);
  }
  for (const id of ["glossary", "keys"] as const) {
    cleanup();
    mount(id);
    assert.ok(!document.querySelector('[data-field="approver"]'), `${id}: reyestrda yo'q, chizilmasin`);
  }
});

test("approver: bsb turida yozilgan matn submit tanasiga tushadi", async () => {
  const calls = stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Test turi"), { target: { value: "bsb" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="approver"] input')!, { target: { value: "Metodik birlashma raisi" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Hosila" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "42-maktab" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.test.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  assert.equal(submitBody(calls).approver, "Metodik birlashma raisi");
});

/* ───────────────────────── fan bitta manba ───────────────────────── */

test("fan sinxroni: o'quv dasturidan fan tanlansa matn qatori yashirinadi va avto nom ko'rinadi", async () => {
  stubApi();
  await login();
  mount("lesson-plan");
  assert.ok(!isHidden('[data-field="subject"]'), "boshida erkin matn ko'rinadi");
  const picker = document.querySelector("[data-curriculum-picker]") as HTMLElement;
  await act(async () => {
    fireEvent.change(within(picker).getByLabelText("Fan"), { target: { value: "matematika" } });
  });
  assert.ok(isHidden('[data-field="subject"]'), "dastur fani tanlangach matn qatori yashirin");
  assert.ok(document.querySelector("[data-subject-auto]"), "avto nom ko'rsatiladi");
  assert.match(document.querySelector("[data-subject-auto]")!.textContent ?? "", /Matematika/i);
});

test("fan sinxroni: dasturdan tanlangan fan submit tanasidagi `subject` ga tushadi", async () => {
  const calls = stubApi();
  await login();
  mount("lesson-plan");
  const picker = document.querySelector("[data-curriculum-picker]") as HTMLElement;
  await act(async () => {
    fireEvent.change(within(picker).getByLabelText("Fan"), { target: { value: "matematika" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Hosila" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "42-maktab" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["lesson-plan"].submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  assert.match(String(submitBody(calls).subject), /Matematika/i);
});

test("fan sinxroni: dastur fanini bo'shatsa erkin matn qatori qaytadi", async () => {
  stubApi();
  await login();
  mount("lesson-plan");
  const picker = () => document.querySelector("[data-curriculum-picker]") as HTMLElement;
  await act(async () => {
    fireEvent.change(within(picker()).getByLabelText("Fan"), { target: { value: "matematika" } });
  });
  assert.ok(isHidden('[data-field="subject"]'));
  await act(async () => {
    fireEvent.change(within(picker()).getByLabelText("Fan"), { target: { value: "" } });
  });
  assert.ok(!isHidden('[data-field="subject"]'), "fan bo'shatilgach matn qatori qaytadi");
  assert.match((document.querySelector('[data-field="subject"] input') as HTMLInputElement).value, /Matematika/i, "avto to'lgan nom saqlanadi");
});

/* ───────────────────────── test rejimlari ───────────────────────── */

test("test: fayl rejimi — Mavzu yashiriladi, ixcham fayl qatori ko'rinadi", async () => {
  stubApi();
  await login();
  mount("test");
  assert.ok(!isHidden('[data-field="topic"]'), "standart mavzu rejimida ko'rinadi");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Fayl asosida"));
  });
  assert.ok(isHidden('[data-field="topic"]'), "fayl rejimida mavzu yashirin");
  assert.ok(!isHidden('[data-field="sourceText"]'), "fayl rejimida fayl qatori ko'rinadi");
  assert.ok(document.querySelector('[data-field="sourceText"] [data-upload]'), "umumiy `SourceFileRow` ishlatiladi");
});

test("test: fayl tanlanmasdan yaratish rad etiladi", async () => {
  stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Fayl asosida"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.test.submitLabel));
  });
  assert.match(document.body.textContent ?? "", /fayl tanlang/i);
});

test("test: darslik dasturi rejimi — fan/sinf/mavzu tanlash topicIds ni to'ldiradi", async () => {
  const calls = stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Darslik dasturi asosida"));
  });
  const picker = document.querySelector("[data-curriculum-picker]") as HTMLElement;
  assert.ok(picker, "CurriculumPicker chizilishi kerak");
  assert.ok(!isHidden("[data-curriculum-picker]"), "darslik rejimida ko'rinadi");
  assert.ok(!isHidden('[data-field="topic"]'), "darslik rejimida mavzu qatori KO'RINADI (server uni talab qiladi)");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Hosila bo'yicha nazorat ishi" } });
  });
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
  /*
   * Klient va SERVER shartnomasi bitta: `missingRequired` (`lib/tools.ts`)
   * darslik rejimida ham mavzuni talab qiladi — jonli smoke shu yerda
   * 400 olgan edi (AUDIT-24 WP-B topilmasi).
   */
  assert.deepEqual(missingRequired(TOOL_BY_ID.test, values as FormValues), [], "server majburiy maydonlar ro'yxati bo'sh bo'lishi kerak");
});

test("darslik rejimi: mavzu bo'sh bo'lsa forma o'zi rad etadi (server 400 gacha bormaydi)", async () => {
  const calls = stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Darslik dasturi asosida"));
  });
  const picker = document.querySelector("[data-curriculum-picker]") as HTMLElement;
  await act(async () => {
    fireEvent.change(within(picker).getByLabelText("Fan"), { target: { value: "matematika" } });
  });
  await act(async () => {
    fireEvent.change(within(picker).getByLabelText("Sinf"), { target: { value: "11" } });
  });
  await waitFor(() => assert.ok(document.querySelector('[data-topic="hosila-va-uning-tatbiqlari-1"]')));
  await act(async () => {
    fireEvent.click(document.querySelector('[data-topic="hosila-va-uning-tatbiqlari-1"]')!);
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "TDPU" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.test.submitLabel));
  });
  assert.ok(!calls.some((c) => c.url === "/api/generations"), "mavzusiz so'rov yuborilmaydi");
  assert.match(document.body.textContent ?? "", /mavzu/i);
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

/* ───────────────────────── sana ───────────────────────── */

test("sana: kun/oy/yil o'zbekcha tanlanadi va ISO ko'rinishida yuboriladi", async () => {
  const calls = stubApi();
  await login();
  mount("lesson-plan");
  assert.ok(!document.querySelector('input[type="date"]'), "brauzerning mm/dd/yyyy maydoni ishlatilmaydi");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Sana — kun"), { target: { value: "16" } });
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Sana — oy"), { target: { value: "09" } });
  });
  const year = String(new Date().getFullYear());
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Sana — yil"), { target: { value: year } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Hosila" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "42-maktab" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["lesson-plan"].submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  assert.equal(submitBody(calls).date, `${year}-09-16`);
});

test("sana: yarim to'ldirilgan sana YUBORILMAYDI, lekin tanlov ekranda qoladi", async () => {
  const calls = stubApi();
  await login();
  mount("lesson-plan");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Sana — kun"), { target: { value: "16" } });
  });
  assert.equal((screen.getByLabelText("Sana — kun") as HTMLSelectElement).value, "16", "tanlov ko'rinib turadi");
  assert.equal((screen.getByLabelText("Sana — oy") as HTMLSelectElement).value, "", "oy hali tanlanmagan");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Hosila" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "42-maktab" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID["lesson-plan"].submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  // `teacher/input.ts isoDate` faqat `YYYY-MM-DD` ni qabul qiladi — yarim sana bo'sh ketadi.
  assert.ok(!submitBody(calls).date, "yarim sana yuborilmaydi");
});

test("sana: faqat dars rejasi va testda bor (reyestr `kinds`)", async () => {
  stubApi();
  await login();
  for (const id of ["lesson-plan", "test"] as const) {
    cleanup();
    mount(id);
    assert.ok(document.querySelector('[data-field="date"]'), `${id}: sana bo'lishi kerak`);
  }
  for (const id of ["texnologik-xarita", "glossary", "keys"] as const) {
    cleanup();
    mount(id);
    assert.ok(!document.querySelector('[data-field="date"]'), `${id}: sana chizilmasin`);
  }
});

/* ───────────────────────── kind mantiqlari ───────────────────────── */

test("dars rejasi: tur almashtirish (Amaliy dars) submit tanasiga tushadi", async () => {
  const calls = stubApi();
  await login();
  mount("lesson-plan");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Dars turi"), { target: { value: "amaliy" } });
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

test("xarita: haftalik soat yillik soatdan oshmaydi (chegaralar)", async () => {
  stubApi();
  await login();
  mount("texnologik-xarita");
  const total = () => document.querySelector('[data-field="totalHours"] input') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(total(), { target: { value: "2" } });
  });
  assert.equal(Number(total().value), 4, "yillik soat haftalik soatdan kam bo'lmaydi");
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

test("glossariy: uch tilli turda tarjima tillari ko'rinadi, boshqa turda yashirin (mutatsiya)", async () => {
  stubApi();
  await login();
  mount("glossary");
  assert.ok(isHidden('[data-field="translationLangs"]'), "standart «fan lug'ati» da yashirin");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Glossariy turi"), { target: { value: "uch-tilli" } });
  });
  assert.ok(!isHidden('[data-field="translationLangs"]'), "«uch-tilli» tanlanganda ko'rinadi");
});

test("test: mezon jadvali faqat BSB/ChSB turida ko'rinadi (mutatsiya)", async () => {
  stubApi();
  await login();
  mount("test");
  assert.ok(isHidden('[data-field="criteriaTable"]'), "standart «Joriy nazorat ishi» da yashirin");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Test turi"), { target: { value: "bsb" } });
  });
  assert.ok(!isHidden('[data-field="criteriaTable"]'), "BSB turida ko'rinadi");
});

test("test: savol soni turdan turga o'zgarganda yangi tur chegarasiga siqiladi", async () => {
  stubApi();
  await login();
  mount("test");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Test turi"), { target: { value: "bsb" } });
  });
  const countGroup = within(screen.getByRole("radiogroup", { name: "Savol soni" }));
  const options = countGroup.getAllByRole("radio").map((b) => b.textContent);
  assert.deepEqual(options, ["5", "8", "10"], "BSB uslubida savol soni chegarasi 5/8/10");
});

/* ───────────────────────── qoralama / submit / tozalash ───────────────────────── */

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
  assert.equal((screen.getByLabelText("Dars turi") as HTMLSelectElement).value, "amaliy");
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
  await act(async () => {
    fireEvent.click(screen.getByText("Formani tozalash"));
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
  const omrSwitch = screen.getByLabelText("OMR varag'i");
  assert.equal(omrSwitch.getAttribute("aria-checked"), "true", "OMR standart yoqiq");
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

test("qo'shimcha matn: hisoblagich bilan cheklangan (umumiy `LimitedTextarea`)", async () => {
  stubApi();
  await login();
  mount("keys");
  const ta = document.querySelector('[data-field="extra"] textarea') as HTMLTextAreaElement;
  assert.ok(ta, "qo'shimcha maydoni Sozlamalar ichida");
  await act(async () => {
    fireEvent.change(ta, { target: { value: "Interaktiv usullarga urg'u bering." } });
  });
  assert.match(document.querySelector('[data-field="extra"] [data-counter]')!.textContent ?? "", /\d/, "hisoblagich ko'rinadi");
});
