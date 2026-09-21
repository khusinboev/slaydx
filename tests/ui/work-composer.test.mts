import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { WorkComposer } from "../../components/forms/WorkComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { WORK_PARAMS } from "../../lib/generation/work-params.ts";
import { TOOL_BY_ID, priceFor, formatTanga } from "../../lib/tools.ts";
import { WORK_LIMITS } from "../../lib/generation/work/types.ts";
import { COURSEWORK_PAGES, REFERAT_PAGES, INDEPENDENT_PAGES } from "../../lib/generation/work/registry.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Talaba ishlari 2 (AUDIT-19 WP-E2) — `WorkComposer` interaktiv xatti-harakat.
 *
 * SSR testi (`tests/viewer/work-form.test.mts`) maydonlar BORLIGINI va
 * qamrovni tekshiradi; bu yerda ular ISHLASHI: tur/fan profili tanlovi,
 * vazirlik «o'zim» maydoni, reja usuli + jonli hisob, narx hajm bilan,
 * qoralama debounce/tiklash, submit tanasi, vizuallar o'chirilganda
 * bog'liq maydonlar o'chishi, manbalar ro'yxati, «Tozalash», dispatch
 * (`tests/ui/article-composer.test.mts` naqshi).
 *
 * FORMALAR 3 (AUDIT-24 WP-A) qo'shgani: «Titul» YIG'IQ (asosiyda faqat
 * OTM+muallif), «Hajm» SLAYDER + jonli narx (narx faqat `priceFor` dan —
 * formada hisob yo'q), matn limit hisoblagichlari, `refsMin` min/max
 * atributlari va ▸ Sozlamalar xulosa chiplari.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };

const profile: UserProfile = {
  name: "Aliyev Ali",
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
  author: "Aliyev Ali",
  subject: "",
  teacher: "",
  city: "Toshkent",
  position: "",
  organization: "",
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
    if (/^\/api\/forms\/(coursework|referat|mustaqil-ish)\/draft$/.test(url) && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (/^\/api\/forms\/(coursework|referat|mustaqil-ish)\/draft$/.test(url)) return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "55555555-5555-4555-8555-555555555555", price: 16000 });
    if (url === "/api/extract" && method === "POST") return json(200, { text: "Maktab hisoboti: 3-sinf o'quvchilari." });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

function mount(toolId: "coursework" | "referat" | "mustaqil-ish" = "coursework") {
  render(h(AppRouterContext.Provider, { value: router }, h(WorkComposer, { tool: TOOL_BY_ID[toolId], profile, user: null })));
}

test("qamrov: WORK_PARAMS dagi har parametr data-field bilan (mutatsiya: bittasini olib tashlasang qizaradi)", async () => {
  stubApi();
  await login();
  mount();
  const found = new Set([...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")));
  const missing = WORK_PARAMS.map((p) => p.id).filter((id) => !found.has(id));
  assert.deepEqual(missing, [], `formada yo'q maydonlar: ${missing.join(", ")}`);
});

test("janr turlari: referatda 4 tur (informativ/tahliliy/baholovchi/doklad), tanlash workKind ni o'zgartiradi", async () => {
  const calls = stubApi();
  await login();
  mount("referat");
  const group = () => within(screen.getByRole("radiogroup", { name: "Tur" }));
  assert.deepEqual(
    group()
      .getAllByRole("radio")
      .map((b) => b.textContent),
    ["Informativ referat", "Tahliliy-taqqoslovchi referat", "Baholovchi referat", "Doklad (ma’ruza)"],
  );
  await act(async () => {
    fireEvent.click(group().getByText("Tahliliy-taqqoslovchi referat"));
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Sinov" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "TDPU" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.referat.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> }).values;
  assert.equal(values.workKind, "analytic");
});

test("vazirlik «o'zim yozaman»: matn maydoni ko'rinadi, boshqa tanlovda yashirin (mutatsiya)", async () => {
  stubApi();
  await login();
  mount();
  const isHidden = () => Boolean(document.querySelector('[data-field="ministryCustom"]')!.closest(".hidden"));
  assert.ok(isHidden(), "standart «oliy»da yashirin bo'lishi kerak");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Vazirlik" })).getByText("Boshqa (o'zim yozaman)"));
  });
  assert.ok(!isHidden(), "«custom» tanlanganda ko'rinishi kerak");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="ministryCustom"] input')!, { target: { value: "RAQAMLI TEXNOLOGIYALAR VAZIRLIGI" } });
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Vazirlik" })).getByText("Oliy ta'lim"));
  });
  assert.ok(isHidden(), "«oliy»ga qaytganda yana yashirin bo'lishi kerak");
});

test("reja usuli manual: tocText ko'rinadi, jonli hisob «2 bob, 4 paragraf»", async () => {
  stubApi();
  await login();
  mount();
  const outlineHidden = () => Boolean(document.querySelector('[data-field="tocText"]')!.closest(".hidden"));
  assert.ok(outlineHidden(), "avto rejimida reja matni yashirin");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Reja usuli" })).getByText("O'zim yozaman"));
  });
  assert.ok(!outlineHidden(), "manual rejimida reja matni ko'rinadi");
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="tocText"] textarea')!, {
      target: { value: "1-BOB. Nazariy asoslar\n1.1. Tushuncha\n1.2. Yondashuvlar\n2-BOB. Amaliy tahlil\n2.1. Natijalar\n2.2. Tavsiyalar" },
    });
  });
  assert.equal(document.querySelector("[data-outline-summary]")?.textContent, "2 bob, 4 paragraf");
});

const slider = () => screen.getByLabelText("Hajm") as HTMLInputElement;
const slide = async (i: number) => {
  await act(async () => {
    fireEvent.change(slider(), { target: { value: String(i) } });
  });
};

test("hajm SLAYDERI: pog'onalar soni janr ro'yxatiga teng, qiymat «N–M bet» bo'lib chiqadi", async () => {
  stubApi();
  await login();
  mount();
  assert.equal(slider().type, "range", "hajm endi chip emas, slayder");
  assert.equal(slider().min, "0");
  assert.equal(slider().max, String(COURSEWORK_PAGES.length - 1), "kurs ishi 7 pog'ona");
  assert.equal(document.querySelector("[data-range-value]")?.textContent, "20–25 bet", "standart 20-25");
  await slide(0);
  assert.equal(document.querySelector("[data-range-value]")?.textContent, "10–15 bet");
  await slide(COURSEWORK_PAGES.length - 1);
  assert.equal(document.querySelector("[data-range-value]")?.textContent, "40–45 bet");
  assert.ok(!screen.queryByRole("radiogroup", { name: "Hajm" }), "eski 7 chipli radiogroup yo'q");
});

test("narx hajm bilan o'zgaradi: kurs ishi 10-15 bet 12 000 → 20-25 bet 16 000", async () => {
  stubApi();
  await login();
  mount();
  await slide(0);
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /12[\s ]?000/);
  await slide(2);
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /16[\s ]?000/);
});

test("slayder yonidagi narx AYNAN `priceFor` dan (3 vosita, har pog'ona) — qattiq yozilgan raqam emas", async () => {
  const steps = { coursework: COURSEWORK_PAGES, referat: REFERAT_PAGES, "mustaqil-ish": INDEPENDENT_PAGES } as const;
  for (const id of ["coursework", "referat", "mustaqil-ish"] as const) {
    cleanup();
    stubApi();
    await login();
    mount(id);
    const tool = TOOL_BY_ID[id];
    for (let i = 0; i < steps[id].length; i++) {
      await slide(i);
      const want = formatTanga(priceFor(tool, { pages: steps[id][i] }));
      assert.equal(document.querySelector("[data-price]")?.textContent, want, `${id} ${steps[id][i]}: slayder narxi`);
      assert.equal(document.querySelector("[data-price-total]")?.textContent, want, `${id} ${steps[id][i]}: sticky narx bilan bir xil`);
    }
    // Narx qoidasi ham `priceFor` dan: eng arzon va eng qimmat paket.
    const rule = document.querySelector("[data-price-rule]")?.textContent ?? "";
    assert.ok(rule.includes(formatTanga(priceFor(tool, { pages: steps[id][0] }))), `${id}: qoida matnida eng arzon paket`);
    assert.ok(rule.includes(formatTanga(priceFor(tool, { pages: steps[id][steps[id].length - 1] }))), `${id}: qoida matnida eng qimmat paket`);
  }
});

test("profil prefill: universitet/muallif/fan nomi boshlang'ich qiymatlar", async () => {
  const localProfile: UserProfile = { ...profile, university: "Buxoro davlat universiteti", subject: "Iqtisodiyot nazariyasi" };
  stubApi();
  await login();
  render(h(AppRouterContext.Provider, { value: router }, h(WorkComposer, { tool: TOOL_BY_ID.coursework, profile: localProfile, user: null })));
  assert.equal((document.querySelector('[data-field="university"] input') as HTMLInputElement).value, "Buxoro davlat universiteti");
  assert.equal((document.querySelector('[data-field="author"] input') as HTMLInputElement).value, "Aliyev Ali");
  assert.equal((document.querySelector('[data-field="subjectName"] input') as HTMLInputElement).value, "Iqtisodiyot nazariyasi");
});

test("qoralama: yozgandan keyin BIR marta PUT (debounce)", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Yangi mavzu" } });
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
  assert.equal(data.topic, "Yangi mavzu");
});

test("qoralama tiklanadi: serverdagi qiymatlar formaga tushadi", async () => {
  stubApi({
    topic: "Tiklangan mavzu",
    workKind: "applied",
    subjectProfile: "technical",
    language: "ru",
    pages: "15-20",
    university: "TATU",
    author: "Karimov K.",
    userRefs: "[]",
    figureKinds: "[]",
  });
  await login();
  mount();
  await waitFor(() => {
    assert.equal((document.querySelector('[data-field="topic"] input') as HTMLInputElement).value, "Tiklangan mavzu");
  });
  assert.equal((document.querySelector('[data-field="university"] input') as HTMLInputElement).value, "TATU");
  assert.equal(document.querySelector("[data-range-value]")?.textContent, "15–20 bet", "hajm qoralamadan tiklandi");
});

test("Yaratish: submit tanasida workKind/subjectProfile/tocText/ministryCustom/userRefs (JSON)", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "To'liq sinov" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "TDPU" } });
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Vazirlik" })).getByText("Boshqa (o'zim yozaman)"));
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="ministryCustom"] input')!, { target: { value: "TATU VAZIRLIGI" } });
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Reja usuli" })).getByText("O'zim yozaman"));
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="tocText"] textarea')!, { target: { value: "1-BOB. Kirish\n1.1. Tushuncha" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.coursework.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const values = (post.body as { slug: string; values: Record<string, unknown> }).values;
  assert.equal(post.body && (post.body as { slug: string }).slug, "coursework");
  assert.equal(values.workKind, "theory");
  assert.equal(values.subjectProfile, "humanities");
  assert.equal(values.tocText, "1-BOB. Kirish\n1.1. Tushuncha");
  assert.equal(values.ministryCustom, "TATU VAZIRLIGI");
  assert.equal(typeof values.userRefs, "string");
  assert.doesNotThrow(() => JSON.parse(String(values.userRefs)));
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});

test("includeVisuals o'chirilsa figureCount/figureKinds/tableCount o'chadi (mutatsiya: `disabled` bog'lanishi)", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const figureButtons = () => [...document.querySelectorAll('[data-field="figureCount"] button')] as HTMLButtonElement[];
  const kindChips = () => [...document.querySelectorAll('[data-field="figureKinds"] button')] as HTMLButtonElement[];
  const tableButtons = () => [...document.querySelectorAll('[data-field="tableCount"] button')] as HTMLButtonElement[];
  assert.ok(kindChips().every((b) => !b.disabled), "vizuallar yoqilganda sxema turlari faol");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Vizuallar"));
  });
  assert.ok(kindChips().every((b) => b.disabled), "vizuallar o'chirilganda sxema turlari o'chishi kerak");
  assert.ok(figureButtons().length > 0 && tableButtons().length > 0, "sonlar tanlovi hamon ko'rinadi (faqat sxema turlari o'chadi)");
});

test("mening manbalarim: DOI/ISBN/Matn rejimlari, submitda userRefs JSON", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText("+ Manba"));
  });
  const row = document.querySelector('[data-rowlist="userRefs"] [data-row]') as HTMLElement;
  await act(async () => {
    fireEvent.click(within(row).getByText("ISBN"));
  });
  const isbnInput = within(row).getByPlaceholderText("978-0-13-468599-1") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(isbnInput, { target: { value: "978-0-13-468599-1" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Manba sinovi" } });
  });
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="university"] input')!, { target: { value: "TDPU" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.coursework.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> }).values;
  const refs = JSON.parse(String(values.userRefs)) as { isbn?: string }[];
  // Klient xom matnni yuboradi — normallashtirish (`978-0-...` → belgilar
  // olib tashlanishi) SERVERDA `work/input.ts parseWorkUserRefs` da bo'ladi.
  assert.equal(refs[0].isbn, "978-0-13-468599-1");
});

test("mavzu yoki OTM/muallif bo'sh bo'lsa submit rad etiladi", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.coursework.submitLabel));
  });
  assert.match(document.body.textContent ?? "", /Mavzuni kiriting/);
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "Mavzu bor" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.coursework.submitLabel));
  });
  assert.match(document.body.textContent ?? "", /muassasa/i);
});

test("«Tozalash»: ikkinchi bosishda DELETE ketadi va forma bo'shaydi", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: "O'chiriladigan mavzu" } });
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
  assert.equal((document.querySelector('[data-field="topic"] input') as HTMLInputElement).value, "");
});

test("dispatch: ToolWorkspace coursework/referat/mustaqil-ish uchun WorkComposer ni, insho/maqola uchun BOSHQA formani chizadi", async () => {
  stubApi();
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  for (const id of ["coursework", "referat", "mustaqil-ish"] as const) {
    cleanup();
    render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: TOOL_BY_ID[id] })));
    await waitFor(() => assert.ok(document.querySelector('[data-field="workKind"]'), `${id}: WorkComposer chizilmadi`));
  }
  cleanup();
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: TOOL_BY_ID.essay })));
  await waitFor(() => assert.ok(document.querySelector('[data-field="essayContext"]'), "insho o'z formasini (EssayComposer) chizishi kerak"));
  assert.ok(!document.querySelector('[data-field="workKind"]'), "insho WorkComposer emas");
});


/* ───────────── FORMALAR 3 (AUDIT-24 WP-A) — yangi tuzilma ───────────── */

test("Titul YIG'IQ: asosiyda faqat OTM+muallif, qolgan 7 maydon yopiq ▸ Sozlamalar ichida", async () => {
  stubApi();
  await login();
  mount();
  const settings = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(settings, "▸ Sozlamalar bloki bor");
  assert.equal(settings.open, false, "yopiq keladi (mutatsiya: `open` qo'yilsa qizaradi)");
  // Asosiy oqimda (Sozlamalardan tashqarida) faqat majburiy ikkitasi.
  const outside = [...document.querySelectorAll("[data-field]")]
    .filter((el) => !settings.contains(el))
    .map((el) => el.getAttribute("data-field"));
  assert.deepEqual(
    outside,
    ["topic", "workKind", "subjectProfile", "subjectName", "pages", "language", "university", "author"],
    "titulning qolgan maydonlari asosiy oqimda turmasligi kerak",
  );
  for (const id of ["faculty", "department", "group", "course", "teacher", "teacherDegree", "city", "ministry"]) {
    assert.ok(settings.querySelector(`[data-field="${id}"]`), `${id} ▸ Sozlamalar ichida`);
  }
  assert.ok(document.querySelector('[data-field="university"] input'), "OTM asosiyda va tahrirlanadi");
});

test("majburiy maydonlar «*» bilan belgilanadi (CUSTOM_REQUIRED.work bilan bir xil ikkitasi)", async () => {
  stubApi();
  await login();
  mount();
  assert.ok(screen.getByText("OTM *"), "OTM majburiy");
  assert.ok(screen.getByText("Muallif *"), "Muallif majburiy");
  assert.ok(screen.getByText("Fakultet"), "fakultet ixtiyoriy — yulduzchasiz");
});

test("▸ Sozlamalar xulosa chiplari: tur · profil · hajm · vizual · reja · fayl", async () => {
  stubApi();
  await login();
  mount();
  const chips = () => [...document.querySelectorAll("[data-summary-chips] span")].map((s) => s.textContent);
  assert.deepEqual(chips(), ["Nazariy kurs ishi", "Gumanitar fanlar", "20–25 bet", "1 sxema, 1 jadval", "reja: avto", "faylsiz"]);
  await slide(0);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Vizuallar"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Reja usuli" })).getByText("O'zim yozaman"));
  });
  assert.deepEqual(chips(), ["Nazariy kurs ishi", "Gumanitar fanlar", "10–15 bet", "vizualsiz", "reja: o‘zim", "faylsiz"]);
});

test("matn limitlari: mavzu/natijalar/qo'shimcha kesiladi va hisoblagich ko'rsatiladi", async () => {
  stubApi();
  await login();
  mount();
  const topic = document.querySelector('[data-field="topic"] input') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(topic, { target: { value: "M".repeat(WORK_LIMITS.topicChars + 50) } });
  });
  assert.equal(topic.value.length, WORK_LIMITS.topicChars, "mavzu server limitida kesiladi");
  assert.match(document.querySelector('[data-field="topic"] [data-counter]')?.textContent ?? "", /\/ 300$/, "mavzu hisoblagichi limitni ko'rsatadi");

  const facts = screen.getByLabelText("Natijalarim") as HTMLTextAreaElement;
  assert.equal(facts.maxLength, WORK_LIMITS.userFactsChars, "natijalar limiti `WORK_LIMITS` dan");
  await act(async () => {
    fireEvent.change(facts, { target: { value: "F".repeat(20) } });
  });
  assert.equal(
    document.querySelector('[data-field="userFacts"] [data-counter]')?.textContent,
    `20 / ${WORK_LIMITS.userFactsChars.toLocaleString("uz-UZ")}`,
  );

  const extra = screen.getByLabelText("Qo‘shimcha") as HTMLTextAreaElement;
  await act(async () => {
    fireEvent.change(extra, { target: { value: "E".repeat(WORK_LIMITS.extraChars + 10) } });
  });
  assert.equal(extra.value.length, WORK_LIMITS.extraChars, "qo'shimcha kesiladi");
});

test("refsMin: min/max HTML atributlari va chegaradan tashqari qiymat klamp qilinadi", async () => {
  stubApi();
  await login();
  mount();
  const input = document.querySelector('[data-field="refsMin"] input') as HTMLInputElement;
  assert.equal(input.type, "number");
  assert.equal(input.min, "0", "chegara brauzerga ham ko'rinadi");
  assert.equal(input.max, "40");
  assert.equal(input.value, "15", "kurs ishi standarti reyestrdan");
  await act(async () => {
    fireEvent.change(input, { target: { value: "100" } });
  });
  assert.equal((document.querySelector('[data-field="refsMin"] input') as HTMLInputElement).value, "40", "40 dan oshmaydi");
});

test("teskari qamrov: formada WORK_PARAMS da yo'q `data-field` chizilmaydi", async () => {
  stubApi();
  await login();
  mount();
  const known = new Set(WORK_PARAMS.map((p) => p.id));
  const found = [...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field") ?? "");
  const stray = [...new Set(found)].filter((id) => !known.has(id));
  assert.deepEqual(stray, [], `reyestrda yo'q maydonlar: ${stray.join(", ")}`);
  assert.equal(found.length, new Set(found).size, "har maydon AYNAN bitta joyda chiziladi");
});

test("fayl qatori: yuklangan hujjat `sourceText` ga tushadi va xulosa chipi «fayl bor» bo'ladi", async () => {
  stubApi();
  await login();
  mount();
  const input = screen.getByLabelText("Hujjat") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["x"], "manba.docx")] } });
  });
  await waitFor(() => assert.ok(screen.getByText("manba.docx"), "fayl nomi qatorda"));
  await waitFor(() => assert.ok(screen.getByText(/belgi$/), "olingan matn uzunligi ko'rinadi"));
  await waitFor(() => assert.ok([...document.querySelectorAll("[data-summary-chips] span")].some((s) => s.textContent === "fayl bor")));
  assert.ok(!document.querySelector("[data-source-file]"), "katta dashed quti o'rniga bitta qator");
});
