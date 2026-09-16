import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { EssayComposer } from "../../components/forms/EssayComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import { ESSAY_PARAMS } from "../../lib/generation/essay-params.ts";

/**
 * Insho formasi (Talaba ishlari 2 / AUDIT-19, WP-E1) — interaktiv.
 *
 * Qulflanadigan qoidalar:
 *   • QAMROV — har `ESSAY_PARAMS.id` formada `data-field` bilan chizilgan
 *     («bezak maydon yo'q», mahsulot egasi qarori 5);
 *   • kontekst turlar ro'yxatini, tilni va hajm o'lchovini BELGILAYDI
 *     (IELTS → faqat ingliz, qat'iy 250+; akademik → so'z, maktab → varaq);
 *   • narx varaqdan — so'z bilan o'lchanadigan kontekstda ham
 *     (`pagesForWords`, 1 varaq ≈ 250 so'z);
 *   • adabiy turda asar nomi va epigraf maydonlari OCHILADI, boshqasida yo'q;
 *   • qoralama PUT/tiklash; submit tanasi.
 *
 * Mutatsiyalar (har biri qizardi): IELTS til majburiyati olib tashlansa
 * («kontekst tilni belgilaydi»); `pagesForWords` o'rniga qattiq 1 varaq
 * qo'yilsa («narx so'zdan varaqqa»); `onContext` normallashtirish
 * aylanasi olib tashlansa («tur kontekst bilan almashadi»).
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.essay;

type Call = { url: string; method: string; body?: unknown };
function stubApi(draft: Record<string, unknown> | null = null) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === "/api/forms/essay/draft" && method === "GET") return json(200, { draft: draft ? { data: draft, updatedAt: "now" } : null });
    if (url === "/api/forms/essay/draft") return json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "55555555-5555-4555-8555-555555555555", price: 2500 });
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
  render(h(AppRouterContext.Provider, { value: router }, h(EssayComposer, { tool })));
}

const field = (id: string) => document.querySelector(`[data-field="${id}"]`);
const chips = (id: string) => [...document.querySelectorAll(`[data-field="${id}"] button`)] as HTMLButtonElement[];
const chipText = (id: string) => chips(id).map((b) => b.textContent?.trim() ?? "");
const checked = (id: string) => chips(id).find((b) => b.getAttribute("aria-checked") === "true")?.textContent?.trim() ?? "";
const topicInput = () => screen.getByPlaceholderText(tool.topicPlaceholder!) as HTMLInputElement;

/** Segment/chip tugmasini matn bo'lagi bo'yicha bosadi. */
async function pick(id: string, re: RegExp) {
  const btn = chips(id).find((b) => re.test(b.textContent ?? ""));
  assert.ok(btn, `«${re}» tugmasi topilmadi: ${chipText(id).join(" | ")}`);
  await act(async () => {
    fireEvent.click(btn!);
  });
}

/* ══════════════════════════════ qamrov ══════════════════════════════ */

test("QAMROV: har `ESSAY_PARAMS.id` formada `data-field` bilan chizilgan (kontekstlar bo'ylab)", async () => {
  stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });

  /*
   * Ba'zi maydonlar KONTEKSTGA bog'liq (so'z maqsadi — akademikda, asar
   * nomi/epigraf — adabiy turda), shuning uchun qamrov uch holatda
   * yig'iladi. Bu ham shartnomaning bir qismi: maydon PAYDO bo'lishi
   * kerak bo'lgan holat bor.
   */
  const seen = new Set<string>();
  const collect = () => {
    for (const el of document.querySelectorAll("[data-field]")) {
      const id = el.getAttribute("data-field");
      if (id) seen.add(id);
    }
  };
  collect();
  // Maktab + adabiy tur → asar nomi va epigraf.
  await pick("essayKind", /Adabiy/i);
  collect();
  // Akademik → so'z maqsadi.
  await pick("essayContext", /akademik/i);
  collect();
  await pick("essayContext", /IELTS/i);
  collect();

  const missing = ESSAY_PARAMS.map((p) => p.id).filter((id) => !seen.has(id));
  assert.deepEqual(missing, [], `reyestrdagi maydon formada yo'q: ${missing.join(", ")}`);
  // Teskari tomoni: formada reyestrda YO'Q maydon bo'lmasin.
  const known = new Set(ESSAY_PARAMS.map((p) => p.id));
  const extra = [...seen].filter((id) => !known.has(id));
  assert.deepEqual(extra, [], `formada reyestrsiz maydon: ${extra.join(", ")}`);
});

/* ══════════════════════════════ kontekst ══════════════════════════════ */

test("kontekst turlar ro'yxatini belgilaydi: maktab 5 tur, IELTS 5 boshqa tur; nomuvofiq tur birinchisiga tushadi", async () => {
  stubApi();
  await login();
  mount();

  assert.equal(checked("essayContext"), "Maktab / DTM inshosi");
  const school = chipText("essayKind");
  assert.ok(school.some((t) => /Mulohaza/i.test(t)), `maktab turlari: ${school.join(" | ")}`);
  assert.ok(school.some((t) => /Adabiy/i.test(t)));

  // Maktabda ADABIY turni tanlaymiz — IELTS da bunday tur yo'q.
  await pick("essayKind", /Adabiy/i);
  await pick("essayContext", /IELTS/i);

  const ielts = chipText("essayKind");
  assert.ok(!ielts.some((t) => /Adabiy/i.test(t)), `IELTS da adabiy tahlil bo'lmasligi kerak: ${ielts.join(" | ")}`);
  assert.ok(ielts.some((t) => /Fikr|Opinion|Muhokama/i.test(t)), `IELTS turlari: ${ielts.join(" | ")}`);
  // MUTATSIYA: normallashtirish aylanasi olib tashlansa tanlangan tur hech biriga mos kelmasdi.
  assert.ok(chips("essayKind").some((b) => b.getAttribute("aria-checked") === "true"), "kontekstga mos tur tanlangan bo'lishi kerak");
});

test("IELTS: til FAQAT ingliz va hajm qat'iy 250+ (varaq chipi yo'q), narx 1 varaq — 2 000", async () => {
  stubApi();
  await login();
  mount();
  // Avval maktab: o'zbek, varaq chiplari bor.
  assert.equal(chipText("language").length, 1, "maktab inshosi faqat o'zbekcha");
  assert.ok(chipText("pages").length >= 5, "maktabda 1–5 varaq chipi");

  await pick("essayContext", /IELTS/i);
  await waitFor(() => assert.equal(checked("language"), "English"));
  /*
   * MUTATSIYA: `essayLanguage` majburiyati olib tashlansa bu yerda uch
   * til chiqardi va foydalanuvchi o'zbekcha «IELTS inshosi» so'ray olardi.
   */
  assert.deepEqual(chipText("language"), ["English"], "IELTS da boshqa til taklif qilinmaydi");
  assert.equal(chips("pages").length, 0, "IELTS da varaq tanlovi yo'q");
  assert.match(field("pages")?.textContent ?? "", /250\+ so‘z/);
  assert.match(field("pages")?.textContent ?? "", /2\s000/, "IELTS narxi — eng kichik paket");
});

test("akademik esse: hajm SO'Z bilan, narx varaqdan hisoblanadi (500 → 2 varaq 2 500, 1 000 → 4 varaq 3 500)", async () => {
  stubApi();
  await login();
  mount();
  await pick("essayContext", /akademik/i);
  await waitFor(() => assert.ok(chips("wordTarget").length === 3, "500/750/1000"));

  const labels = chipText("wordTarget");
  /*
   * MUTATSIYA: `pagesForWords` o'rniga qattiq bitta varaq qo'yilsa,
   * uchala chip ham 2 000 tanga ko'rsatardi — foydalanuvchi 1 000 so'zni
   * 500 so'z narxiga so'rab olardi.
   */
  assert.ok(labels.some((t) => /500 so‘z · 2\s500/.test(t)), labels.join(" | "));
  assert.ok(labels.some((t) => /750 so‘z · 3\s000/.test(t)), labels.join(" | "));
  assert.ok(labels.some((t) => /1000 so‘z · 3\s500/.test(t)), labels.join(" | "));

  // Akademikda uchala til ham ochiq.
  assert.deepEqual(chipText("language"), ["O‘zbek", "Русский", "English"]);
});

test("maktab inshosi: varaq chipi narx bilan va tanlov narxni o'zgartiradi (1 → 2 000, 5 → 4 000)", async () => {
  stubApi();
  await login();
  mount();
  assert.ok(chipText("pages").some((t) => /1 varaq · 2\s000/.test(t)), chipText("pages").join(" | "));
  assert.ok(chipText("pages").some((t) => /5 varaq · 4\s000/.test(t)));
  // Standart — 2 varaq (`defaultPages("essay")`), pastdagi «Yaratish» narxi ham shu.
  assert.match(checked("pages"), /^2 varaq/);
  assert.ok(/2\s500 tanga/.test(document.body.textContent ?? ""), "standart narx 2 500");
  await pick("pages", /^5 varaq/);
  await waitFor(() => assert.ok(/4\s000 tanga/.test(document.body.textContent ?? ""), "5 varaq narxi 4 000"));
});

/* ══════════════════════════════ materiallar ══════════════════════════════ */

test("adabiy tur: «Asar nomi» va «Epigraf» maydonlari ochiladi; boshqa turda yo'q", async () => {
  stubApi();
  await login();
  mount();
  assert.ok(!field("workTitle"), "mulohazali inshoda asar nomi so'ralmaydi");
  assert.ok(!field("epigraph"));

  await pick("essayKind", /Adabiy/i);
  await waitFor(() => assert.ok(field("workTitle"), "adabiy tahlilda asar nomi kerak"));
  assert.ok(field("epigraph"), "adabiy tahlilda epigraf ixtiyoriy maydon sifatida bo'ladi");
  // Hisobot paneli havolalari aynan shu id larga boradi (`NEED_HREF`).
  assert.ok(document.getElementById("workTitle"), "«Sizdan kutiladi» havolasi uchun id");
  assert.ok(document.getElementById("epigraph"));
  assert.ok(document.getElementById("userFacts"));

  // Turni qaytarsak — maydonlar yopiladi va qiymat ham ketadi (`essayInputFromValues` siyosati).
  await pick("essayKind", /Mulohaza/i);
  await waitFor(() => assert.ok(!field("workTitle")));
});

/* ══════════════════════════════ qoralama va submit ══════════════════════════════ */

test("qoralama: yozgandan keyin BIR marta PUT (debounce), tanasida essayContext/essayKind", async () => {
  const calls = stubApi();
  await login();
  mount();
  await act(async () => {
    fireEvent.change(topicInput(), { target: { value: "Ona tilim — g‘ururim" } });
  });
  assert.equal(calls.filter((c) => c.method === "PUT").length, 0, "darhol yuborilmaydi");
  await waitFor(() => assert.ok(calls.filter((c) => c.method === "PUT").length >= 1, "debounce'dan keyin saqlanadi"), { timeout: 4000 });
  const puts = calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1, `bitta PUT kutilgan edi, ${puts.length} ta`);
  const data = (puts[0].body as { data: Record<string, unknown> }).data;
  assert.equal(data.topic, "Ona tilim — g‘ururim");
  assert.equal(data.essayContext, "school_dtm");
  assert.equal(data.essayKind, "reflective");
});

test("qoralama tiklanadi: IELTS konteksti, turi va tili formaga tushadi", async () => {
  stubApi({ topic: "Tiklangan mavzu", essayContext: "ielts_task2", essayKind: "discussion", language: "uz", pages: "4" });
  await login();
  mount();
  await waitFor(() => assert.equal(topicInput().value, "Tiklangan mavzu"));
  assert.equal(checked("essayContext"), "IELTS Writing Task 2");
  /*
   * Qoralamada «uz» va «4 varaq» turgan bo'lsa ham, tiklash SERVER
   * qoidasidan o'tadi (`essayInputFromValues`): IELTS — ingliz tili,
   * qat'iy hajm. Aks holda forma bilan dvigatel ayril bo'lardi.
   */
  assert.equal(checked("language"), "English");
  assert.equal(chips("pages").length, 0);
});

test("Yaratish: submit tanasida slug «essay» va essayContext/essayKind/wordTarget/epigraph", async () => {
  const calls = stubApi();
  await login();
  mount();
  await pick("essayKind", /Adabiy/i);
  await act(async () => {
    fireEvent.change(topicInput(), { target: { value: "«O‘tkan kunlar» romanida sevgi va burch" } });
  });
  const inputs = [...(field("epigraph")?.querySelectorAll("input") ?? [])] as HTMLInputElement[];
  await act(async () => {
    fireEvent.change(field("workTitle")!.querySelector("input")!, { target: { value: "O‘tkan kunlar" } });
    fireEvent.change(inputs[0], { target: { value: "So‘z — qalb kaliti" } });
    fireEvent.change(inputs[1], { target: { value: "Alisher Navoiy" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const post = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!;
  const body = post.body as { slug: string; values: Record<string, unknown> };
  assert.equal(body.slug, "essay");
  assert.equal(body.values.essayContext, "school_dtm");
  assert.equal(body.values.essayKind, "literary");
  assert.equal(body.values.workTitle, "O‘tkan kunlar");
  assert.equal(body.values.epigraph, "So‘z — qalb kaliti");
  assert.equal(body.values.epigraphAuthor, "Alisher Navoiy");
  assert.equal(body.values.pages, "2");
  await waitFor(() => assert.ok(pushes.some((u) => u.includes("/uz/files/"))));
});

test("akademik submit: wordTarget tanasida va `pages` undan hisoblangan (750 → 3)", async () => {
  const calls = stubApi();
  await login();
  mount();
  await pick("essayContext", /akademik/i);
  await pick("wordTarget", /^750/);
  await act(async () => {
    fireEvent.change(topicInput(), { target: { value: "Raqamli savodxonlik va tanqidiy fikrlash" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const values = (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> }).values;
  assert.equal(values.essayContext, "academic");
  assert.equal(values.wordTarget, "750");
  assert.equal(values.pages, "3", "750 so'z ≈ 3 varaq — narx shu paketdan");
});

/* ══════════════════════════════ dispatch ══════════════════════════════ */

test("vosita sahifasi insho uchun AYNAN yangi formani chizadi (`custom: essay` dispatch)", async () => {
  stubApi();
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool })));
  await waitFor(() => assert.ok(document.querySelectorAll("[data-field]").length >= 8, "yangi formaning maydonlari"));
  assert.ok(document.body.textContent?.includes("Mavzu va kontekst"), "inshoga xos karta ko'rinadi");
  // Eski standart forma «Hujjat dizaynini tanlang» legendasi bilan kelardi — u endi yo'q.
  assert.ok(!document.body.textContent?.includes("Hujjat dizaynini tanlang"));
});
