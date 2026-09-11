import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ArticleComposer } from "../../components/forms/ArticleComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Maqola formasi — interaktiv xatti-harakat (Maqola 2, WP6).
 *
 * SSR testi (`tests/viewer/article-form.test.mts`) maydonlar BORLIGINI
 * tekshiradi; bu yerda ular ISHLASHI: tur tanlanganda profil/hajm
 * mosligi, profil dialogi, mualliflar ro'yxati, manba qatori, CSV jadval,
 * kalit so'zlar chegarasi, narx hajmga qarab o'zgarishi, qoralama
 * debounce, «Tozalash», submit tanasi (`tests/ui/resume-composer.test.mts`
 * naqshi).
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.article;
const profile: UserProfile = {
  name: "Karimova Dilnoza", language: "uz", points: 0, quota: 0, balance: 100000, premium: false, plan: "free",
  university: "", faculty: "", department: "", group: "", course: "", author: "Karimova Dilnoza", subject: "",
  teacher: "", city: "Toshkent", position: "", organization: "TDIU",
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
    if (url === "/api/forms/article/draft" && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (url === "/api/forms/article/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "44444444-4444-4444-8444-444444444444", price: 6000 });
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
  render(h(AppRouterContext.Provider, { value: router }, h(ArticleComposer, { tool, profile, user: null })));
}

test("tur tanlanganda profil TURNING standartiga o'tadi, hajm ro'yxatga moslashadi", async () => {
  stubApi();
  await login();
  mount();
  // Standart: imrad_oak → oak profili.
  assert.ok(screen.getByText("OAK jurnali (IMRAD + Xulosa)"));
  await act(async () => {
    fireEvent.click(screen.getByText("OAK jurnali (IMRAD + Xulosa)"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog", { name: "Maqola turi" })).getByText("Xalqaro (Elsevier / IEEE uslubi)"));
  });
  // `elsevier_ieee_style` ning standart profili — ieee; pages ["5-10","10-15"], "3-5" da qolmaydi.
  await waitFor(() => {
    assert.ok(screen.getByText("IEEE / Elsevier"), "profil IEEE ga o'zgardi");
  });
  assert.ok(screen.getByText(/5–10 bet/), "hajm ro'yxati yangi turga mos");
  assert.ok(!screen.queryByText(/3–5 bet/), "turga mos kelmaydigan hajm chipi (3-5) yo'q — elsevier_ieee_style faqat 5-10/10-15");
});

test("foydalanuvchi profilni QO'LDA tanlasa, keyingi tur almashinuvi ustidan yozmaydi", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText("OAK jurnali (IMRAD + Xulosa)"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog", { name: "Maqola turi" })).getByText("Original tadqiqot (IMRAD)"));
  });
  // `imrad_classic` standart profili — apa. Endi QO'LDA boshqa profil tanlaymiz.
  await waitFor(() => assert.ok(screen.getByText("Xalqaro — APA 7")));
  await act(async () => {
    fireEvent.click(screen.getByText("Xalqaro — APA 7"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog", { name: "Nashr profili" })).getByText("IEEE / Elsevier"));
  });
  await waitFor(() => assert.ok(screen.getByText("IEEE / Elsevier")));
  // Endi turni yana almashtiramiz — profil QOLISHI kerak (foydalanuvchi tanlovi ustuvor).
  await act(async () => {
    fireEvent.click(screen.getByText("Original tadqiqot (IMRAD)"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog", { name: "Maqola turi" })).getByText("OAK jurnali (IMRAD + Xulosa)"));
  });
  await waitFor(() => assert.ok(screen.getByText("IEEE / Elsevier"), "qo'lda tanlangan profil saqlanib qoldi"));
});

test("narx hajm bilan o'zgaradi: 3-5 bet 6 000 → 10-15 bet 12 000", async () => {
  stubApi();
  await login();
  mount();
  assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /6[\s ]?000/);
  await act(async () => {
    fireEvent.click(screen.getByText(/10–15 bet/));
  });
  await waitFor(() => {
    assert.match(document.querySelector("[data-price-total]")?.textContent ?? "", /12[\s ]?000/);
  });
});

test("vizuallar soni PAKETGA bog'liq: 3–5 bet → 0–1 (standart 1), 10–15 → 0–4; kichik paketga qaytganda kesiladi; tezisda yo'q", async () => {
  stubApi();
  await login();
  mount();
  const opts = () => [...document.querySelectorAll('[data-field="figureCount"] button')].map((b) => b.textContent?.trim());
  const pressed = () => document.querySelector('[data-field="figureCount"] button[aria-checked="true"]')?.textContent?.trim();
  assert.deepEqual(opts(), ["0", "1"]);
  assert.equal(pressed(), "1");
  await act(async () => {
    fireEvent.click(screen.getByText(/10–15 bet/));
  });
  assert.deepEqual(opts(), ["0", "1", "2", "3", "4"]);
  await act(async () => {
    fireEvent.click(document.querySelector('[data-field="figureCount"] button:nth-child(4)')!);
  });
  assert.equal(pressed(), "3");
  await act(async () => {
    fireEvent.click(screen.getByText(/3–5 bet/));
  });
  assert.deepEqual(opts(), ["0", "1"]);
  assert.equal(pressed(), "1", "3 → paketga kesildi");
  // Tezis (1–2 bet) — sxema yo'q, tanlov chizilmaydi.
  await act(async () => {
    fireEvent.click(screen.getByText("OAK jurnali (IMRAD + Xulosa)"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("dialog", { name: "Maqola turi" })).getByText("Konferensiya tezisi"));
  });
  assert.deepEqual(opts(), []);
  assert.match(document.querySelector('[data-field="figureCount"]')?.textContent ?? "", /^0$/);
});

test("mualliflar: qo'shish/o'chirish, ≤6 chegara", async () => {
  stubApi();
  await login();
  mount();
  const list = () => document.querySelectorAll('[data-rowlist="authors"] [data-row]');
  assert.equal(list().length, 1, "boshida bitta qator (profildan prefill)");
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      fireEvent.click(screen.getByText("+ Muallif"));
    });
  }
  assert.equal(list().length, 6, "6 tadan oshmaydi");
  await act(async () => {
    fireEvent.click(within(list()[list().length - 1] as HTMLElement).getByLabelText("O'chirish"));
  });
  assert.equal(list().length, 5);
});

test("mening manbalarim: DOI/Matn satri, submitda userRefs JSON bo'lib ketadi", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText("+ Manba"));
  });
  const row = document.querySelector('[data-rowlist="userRefs"] [data-row]') as HTMLElement;
  const doiInput = within(row).getByPlaceholderText("10.1186/s40561-023-00260-y") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(doiInput, { target: { value: "10.1186/s40561-023-00260-y" } });
  });
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(tool.topicPlaceholder!), { target: { value: "Sinov mavzu" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> }).values;
  const refs = JSON.parse(String(values.userRefs)) as { doi?: string }[];
  assert.equal(refs[0].doi, "10.1186/s40561-023-00260-y");
});

test("ma'lumot jadvali: to'g'ri CSV qabul qilinadi, xato format ogohlantirish beradi", async () => {
  stubApi();
  await login();
  mount();
  const ta = screen.getByPlaceholderText(/CSV: sarlavha qatori/);
  await act(async () => {
    fireEvent.change(ta, { target: { value: "faqat bitta qator" } });
  });
  assert.match(document.body.textContent ?? "", /Jadval o‘qilmadi/, "xato format ogohlantirish");
  await act(async () => {
    fireEvent.change(ta, { target: { value: "2022,2023,2024\nTalabalar,80,110,120" } });
  });
  assert.doesNotMatch(document.body.textContent ?? "", /Jadval o‘qilmadi/, "to'g'ri CSV da ogohlantirish yo'q");
});

test("kalit so'zlar ≤12 ta bilan cheklanadi", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const input = screen.getByLabelText("Kalit so‘zlar") as HTMLInputElement;
  for (let i = 0; i < 13; i++) {
    await act(async () => {
      fireEvent.change(input, { target: { value: `so'z${i}` } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
  }
  assert.equal(document.querySelectorAll("[data-combo-chip]").length, 12, "13-chisi qabul qilinmaydi");
});

test("qoralama: yozgandan keyin BIR marta PUT (debounce)", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(tool.topicPlaceholder!), { target: { value: "Yangi mavzu" } });
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
  assert.equal(data.articleType, "imrad_oak");
});

test("qoralama tiklanadi: serverdagi qiymatlar formaga tushadi", async () => {
  stubApi({
    topic: "Tiklangan mavzu",
    articleType: "imrad_oak",
    pubProfile: "oak",
    language: "ru",
    pages: "5-10",
    authors: '[{"name":"Tiklangan Muallif"}]',
    keywords: "[]",
    userRefs: "[]",
  });
  await login();
  mount();
  await waitFor(() => {
    assert.equal((screen.getByPlaceholderText(tool.topicPlaceholder!) as HTMLInputElement).value, "Tiklangan mavzu");
  });
  assert.ok(screen.getByText(/5–10 bet/), "hajm qoralamadan tiklandi");
  assert.equal((document.querySelector('[data-rowlist="authors"] [data-row] input') as HTMLInputElement).value, "Tiklangan Muallif");
});

test("«Tozalash»: ikkinchi bosishda DELETE ketadi va forma bo'shaydi", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(tool.topicPlaceholder!), { target: { value: "O'chiriladigan mavzu" } });
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
  assert.equal((screen.getByPlaceholderText(tool.topicPlaceholder!) as HTMLInputElement).value, "");
});

test("Yaratish: JSON maydonlar (authors/userRefs/keywords) satr sifatida, topic/articleType/pubProfile/pages tanasida", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(tool.topicPlaceholder!), { target: { value: "To'liq sinov" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const values = (post.body as { values: Record<string, unknown> }).values;
  assert.equal(values.topic, "To'liq sinov");
  assert.equal(values.articleType, "imrad_oak");
  assert.equal(values.pubProfile, "oak");
  assert.equal(values.pages, "3-5");
  assert.equal(typeof values.authors, "string");
  assert.equal(typeof values.userRefs, "string");
  assert.equal(typeof values.keywords, "string");
  assert.doesNotThrow(() => JSON.parse(String(values.authors)));
  assert.doesNotThrow(() => JSON.parse(String(values.userRefs)));
  assert.doesNotThrow(() => JSON.parse(String(values.keywords)));
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});

test("vosita sahifasi maqola uchun AYNAN yangi formani chizadi (dispatch)", async () => {
  stubApi();
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool })));
  await waitFor(() => {
    assert.ok(document.querySelectorAll("[data-field]").length > 10, "yangi formaning maydonlari");
  });
  assert.ok(document.body.textContent?.includes("Nashr profili"), "maqolaga xos karta ko'rinadi");
});
