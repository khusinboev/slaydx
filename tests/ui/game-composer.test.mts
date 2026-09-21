import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { GameComposer } from "../../components/forms/GameComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { gameParamsOf } from "../../lib/generation/game-params.ts";
import { gameDefaultTypeId, gameKindOf, gameTypeOf } from "../../lib/generation/games/registry.ts";
import { GAME_LIMITS, type GameKind } from "../../lib/generation/games/types.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";

/**
 * O'YINLAR FORMASI (Formalar 3 / AUDIT-24 WP-D1) — `GameComposer`
 * interaktiv xulqi (`tests/ui/teacher-composer.test.mts` naqshi).
 *
 * Nimani qulflaydi:
 *   • DISPATCH — to'rtala vosita `ToolWorkspace` dan shu formaga tushadi;
 *   • STANDART — forma ochilganda HAR chip guruhi yoqilgan turadi va
 *     qiymatlar REYESTRdan keladi (`forms3-oyinlar-media.md` ⚠ topilmasi:
 *     saralash/tinglashda hech nima tanlanmagan holda ochilardi);
 *   • `hideWhen` — «qarama-qarshi juftlik» turida toifa soni
 *     CHIZILMAYDI (reyestr uni 2 ga qulflaydi, tanlov inert bo'lardi);
 *   • FAYL rejimi — krossvordda `SourceFileRow`, mavzu yashiriladi;
 *   • ▸ Sozlamalar — YOPIQ keladi va xulosa chiplari reyestr yorlig'idan;
 *   • SUBMIT TANASI — `FormValues` kalitlari AYNAN dvigatel kutgan nomlar
 *     bilan ketadi (shartnoma o'zgarmadi);
 *   • QAMROV — `GAME_PARAMS` dagi har id formada `data-field` bilan, va
 *     reyestrda yo'q id chizilmaydi (ikki yo'nalish).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `defaultValuesFor` dan `itemsPerCategory` standarti olib tashlandi
 *      → «standart chiplar» (saralash) qizardi;
 *   2. `SizeRows` da `lockedCategories` sharti o'chirildi → «juftlik
 *      turida toifa soni chizilmaydi» qizardi;
 *   3. `itemCount` `Field` siz chizildi → qamrov (tinglash) qizardi.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };

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
    if (url === "/api/generations" && method === "POST") return json(200, { id: "77777777-7777-4777-8777-777777777777", price: 2000 });
    if (url === "/api/users/me") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}

type GameToolId = "crossword" | "flashcards" | "sorting" | "listening";
const GAME_TOOLS: readonly GameToolId[] = ["crossword", "flashcards", "sorting", "listening"];

function mount(toolId: GameToolId) {
  render(h(AppRouterContext.Provider, { value: router }, h(GameComposer, { tool: TOOL_BY_ID[toolId] })));
}

const submitBody = (calls: Call[]) => (calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { slug: string; values: Record<string, unknown> }).values;

/** Tanlangan segment tugmasining matni (`aria-checked`). */
function checked(fieldId: string): string {
  const on = document.querySelector(`[data-field="${fieldId}"] [aria-checked="true"]`);
  assert.ok(on, `${fieldId}: hech bir variant tanlanmagan`);
  return on!.textContent ?? "";
}

async function fillTopicAndSubmit(toolId: GameToolId, topic = "Fotosintez") {
  await act(async () => {
    fireEvent.change(document.querySelector('[data-field="topic"] input')!, { target: { value: topic } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID[toolId].submitLabel));
  });
}

/* ────────────────────────── dispatch ────────────────────────── */

test("dispatch: ToolWorkspace to'rtala o'yin vositasida GameComposer ni chizadi", async () => {
  stubApi();
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  for (const id of GAME_TOOLS) {
    cleanup();
    render(h(AppRouterContext.Provider, { value: router }, h(ToolWorkspace, { tool: TOOL_BY_ID[id] })));
    const typeField = { crossword: "crosswordType", flashcards: "cardType", sorting: "sortingType", listening: "listeningType" }[id];
    await waitFor(() => assert.ok(document.querySelector(`[data-field="${typeField}"]`), `${id}: GameComposer chizilmadi`));
    // Eski `StandardForm` qobig'i (fieldset + «Qo'shimcha (ixtiyoriy)») qolmasin.
    assert.ok(!screen.queryByText(/Qoʼshimcha \(ixtiyoriy\)/), `${id}: eski StandardForm qobig'i`);
  }
});

test("dispatch: o'yin bo'lmagan vosita GameComposer ga tushmaydi", async () => {
  stubApi();
  await login();
  for (const id of GAME_TOOLS) assert.equal(TOOL_BY_ID[id].custom, "game", `${id}: custom "game" emas`);
  assert.notEqual(TOOL_BY_ID.infographic.custom, "game", "infografika o'z yo'lida qolishi kerak");
  assert.notEqual(TOOL_BY_ID.podcast.custom, "game", "podkast o'z yo'lida qolishi kerak");
});

/* ────────────────────────── standartlar (REYESTRDAN) ────────────────────────── */

test("standart: krossvord — tur, so'z soni va til yoqilgan holda ochiladi", async () => {
  stubApi();
  await login();
  mount("crossword");
  const spec = gameTypeOf("crossword", gameDefaultTypeId("crossword"));
  assert.equal(checked("crosswordType"), spec.label.uz);
  assert.equal(checked("wordCount"), `${spec.limits.wordsDefault} so‘z`);
  assert.equal(checked("language"), "O'zbekcha");
  assert.equal(checked("mode"), "Mavzu asosida");
});

test("standart: flesh kartalar — tur va karta soni reyestrdan, misol kaliti turning standartida", async () => {
  stubApi();
  await login();
  mount("flashcards");
  const spec = gameTypeOf("flashcards", gameDefaultTypeId("flashcards"));
  assert.equal(checked("cardType"), spec.label.uz);
  assert.equal(checked("cardCount"), `${spec.limits.cardsDefault} karta`);
  const sw = document.querySelector('[data-field="includeExample"] [role="switch"]')!;
  assert.equal(sw.getAttribute("aria-checked"), String(spec.limits.includeExampleDefault), "misol kaliti reyestr standartida emas");
});

test("standart: saralash — tur, toifa va element soni yoqilgan (⚠ AUDIT-24 topilmasi yopildi)", async () => {
  stubApi();
  await login();
  mount("sorting");
  const spec = gameTypeOf("sorting", gameDefaultTypeId("sorting"));
  assert.equal(checked("sortingType"), spec.label.uz);
  assert.equal(checked("categoryCount"), `${spec.limits.categoriesDefault} toifa`);
  assert.equal(checked("itemsPerCategory"), `${spec.limits.itemsPerCategoryDefault} element`);
  assert.equal(checked("language"), "O'zbekcha");
});

test("standart: tinglash — tur, topshiriq soni va IKKI XIL til juftligi", async () => {
  stubApi();
  await login();
  mount("listening");
  const spec = gameTypeOf("listening", gameDefaultTypeId("listening"));
  assert.equal(checked("listeningType"), spec.label.uz);
  assert.equal(checked("itemCount"), `${spec.limits.itemsDefault} ta`);
  const native = checked("nativeLanguage");
  const target = checked("targetLanguage");
  assert.notEqual(native, target, "ona tili va o'rganiladigan til teng kelsa mashq ma'nosini yo'qotadi");
  // Tinglashda uchinchi «hujjat tili» maydoni BO'LMAYDI (bezak maydon yo'q).
  assert.ok(!document.querySelector('[data-field="language"]'), "tinglashda «Til» maydoni ortiqcha");
});

/* ────────────────────────── shartli maydonlar ────────────────────────── */

test("hideWhen: «qarama-qarshi juftlik» turida toifa soni chizilmaydi, element soni qoladi", async () => {
  stubApi();
  await login();
  mount("sorting");
  assert.ok(document.querySelector('[data-field="categoryCount"]'), "standart turda toifa soni ko'rinadi");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "O'yin turi" })).getByText(/Qarama-qarshi/));
  });
  assert.ok(!document.querySelector('[data-field="categoryCount"]'), "reyestr 2 ga qulflagan turda tanlov inert bo'lardi");
  assert.ok(document.querySelector('[data-field="itemsPerCategory"]'), "element soni qolishi kerak");
  // Reyestr shartnomasi: aynan shu tur qulflangan.
  assert.deepEqual([...gameTypeOf("sorting", "qarama-qarshi").limits.categories], [2]);
});

test("krossvord: fayl rejimida SourceFileRow ko'rinadi, mavzu yashiriladi", async () => {
  stubApi();
  await login();
  mount("crossword");
  const hidden = (sel: string) => Boolean(document.querySelector(sel)!.closest(".hidden"));
  assert.ok(!hidden('[data-field="topic"]'), "standart rejimda mavzu ko'rinadi");
  assert.ok(hidden('[data-field="sourceText"]'), "mavzu rejimida fayl qatori yashirin");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Rejim" })).getByText("Fayl asosida"));
  });
  assert.ok(hidden('[data-field="topic"]'), "fayl rejimida mavzu yashirin");
  assert.ok(!hidden('[data-field="sourceText"]'), "fayl rejimida fayl qatori ko'rinadi");
  assert.ok(document.querySelector('[data-field="sourceText"] [data-upload]'), "umumiy `SourceFileRow` bo'lagi");
});

test("krossvorddan boshqa o'yinlarda rejim/fayl maydoni umuman yo'q", async () => {
  stubApi();
  await login();
  for (const id of ["flashcards", "sorting", "listening"] as const) {
    cleanup();
    mount(id);
    assert.ok(!document.querySelector('[data-field="mode"]'), `${id}: rejim tanlovi ortiqcha`);
    assert.ok(!document.querySelector('[data-field="sourceText"]'), `${id}: fayl maydoni ortiqcha`);
  }
});

/* ────────────────────────── Sozlamalar ────────────────────────── */

test("Sozlamalar: YOPIQ keladi, chevron bor, xulosa chiplari tur · soni · til", async () => {
  stubApi();
  await login();
  mount("crossword");
  const details = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(details, "▸ Sozlamalar bloki yo'q");
  assert.equal(details.open, false, "Sozlamalar yopiq kelishi kerak");
  const chips = [...details.querySelectorAll("[data-summary-chips] span")].map((s) => s.textContent);
  const spec = gameTypeOf("crossword", gameDefaultTypeId("crossword"));
  assert.deepEqual(chips, [spec.label.uz, `${spec.limits.wordsDefault} so‘z`, "O'zbekcha"]);
  // Qo'shimcha talab va tozalash tugmasi shu yerda (asosiy oqimni band qilmaydi).
  assert.ok(details.querySelector('[data-field="extra"] textarea'), "qo'shimcha talab maydoni Sozlamalarda");
  assert.ok(details.querySelector("[data-clear-form]"), "«Formani tozalash» Sozlamalarda");
});

test("Sozlamalar xulosasi tanlov bilan yangilanadi (tinglash — til juftligi)", async () => {
  stubApi();
  await login();
  mount("listening");
  const chipText = () => [...document.querySelectorAll("[data-summary-chips] span")].map((s) => s.textContent);
  assert.ok(chipText().some((t) => t?.includes("→")), `til juftligi chipi yo'q: ${chipText().join(" | ")}`);
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Topshiriqlar" })).getByText("20 ta"));
  });
  assert.ok(chipText().includes("20 ta"), `xulosa yangilanmadi: ${chipText().join(" | ")}`);
});

/* ────────────────────────── submit tanasi (shartnoma) ────────────────────────── */

test("submit tanasi: krossvord — mavzu rejimida dvigatel kutgan kalitlar", async () => {
  const calls = stubApi();
  await login();
  mount("crossword");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Savol turi" })).getByText("Ta'rifli"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "So‘zlar" })).getByText("15 so‘z"));
  });
  await fillTopicAndSubmit("crossword", "Fotosintez jarayoni");
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const body = submitBody(calls);
  assert.equal(body.topic, "Fotosintez jarayoni");
  assert.equal(body.crosswordType, "tarifli");
  assert.equal(body.wordCount, "15");
  assert.equal(body.language, "uz");
  assert.equal(body.mode, "topic");
  assert.equal(pushes.at(-1), "/uz/files/77777777-7777-4777-8777-777777777777");
});

test("submit tanasi: saralash — toifa/element kalitlari va tur", async () => {
  const calls = stubApi();
  await login();
  mount("sorting");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Toifalar" })).getByText("6 toifa"));
  });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Har toifada" })).getByText("8 element"));
  });
  await fillTopicAndSubmit("sorting", "Hayvonlar sinflari");
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const body = submitBody(calls);
  assert.equal(body.sortingType, "toifa");
  assert.equal(body.categoryCount, "6");
  assert.equal(body.itemsPerCategory, "8");
  assert.equal(body.topic, "Hayvonlar sinflari");
});

test("submit tanasi: tinglash — til JUFTLIGI va topshiriq soni (hujjat tili yuborilmaydi)", async () => {
  const calls = stubApi();
  await login();
  mount("listening");
  await act(async () => {
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Ona tili" })).getByText("Русский"));
  });
  await fillTopicAndSubmit("listening", "Shahardagi joylar");
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const body = submitBody(calls);
  assert.equal(body.listeningType, "sozlar");
  assert.equal(body.nativeLanguage, "ru");
  assert.equal(body.targetLanguage, "en");
  assert.equal(body.itemCount, String(GAME_LIMITS.listeningCountDefault));
  assert.ok(!("language" in body), "tinglashda «hujjat tili» maydoni yuborilmasligi kerak");
});

test("submit tanasi: flesh kartalar — misol kaliti «ha»/«yoq» satri", async () => {
  const calls = stubApi();
  await login();
  mount("flashcards");
  await act(async () => {
    fireEvent.click(document.querySelector('[data-field="includeExample"] [role="switch"]')!);
  });
  await fillTopicAndSubmit("flashcards", "Biologiya atamalari");
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  const body = submitBody(calls);
  assert.equal(body.cardType, "term-def");
  assert.equal(body.includeExample, "ha");
  assert.equal(body.cardCount, String(GAME_LIMITS.countDefault));
});

test("mavzusiz yuborilmaydi — xato ko'rsatiladi, navbatga so'rov ketmaydi", async () => {
  const calls = stubApi();
  await login();
  mount("sorting");
  await act(async () => {
    fireEvent.click(screen.getByText(TOOL_BY_ID.sorting.submitLabel));
  });
  assert.ok(!calls.some((c) => c.url === "/api/generations"), "bo'sh so'rov navbatga tushdi");
  assert.ok(screen.getByText(/to‘ldirilishi kerak/), "xato matni yo'q");
});

/* ────────────────────────── narx ────────────────────────── */

test("narx — tekis 2 000 va FAQAT sticky footerda (formada hisob yo'q)", async () => {
  stubApi();
  await login();
  for (const id of GAME_TOOLS) {
    cleanup();
    mount(id);
    const total = document.querySelector("[data-price-total]");
    assert.ok(total, `${id}: narx ko'rsatkichi yo'q`);
    assert.match(total!.textContent ?? "", /2[\s ]?000/, `${id}: narx 2 000 emas`);
    assert.ok(!document.querySelector("[data-price]"), `${id}: formada ikkinchi narx ko'rsatkichi`);
  }
});

/* ────────────────────────── qoralama ────────────────────────── */

test("qoralama: saqlangan qiymatlar tiklanadi, noma'lum qiymat reyestr standartiga tushadi", async () => {
  stubApi({ topic: "Amir Temur davri", crosswordType: "tarifli", wordCount: "999", language: "ru" });
  await login();
  mount("crossword");
  await waitFor(() => assert.equal((document.querySelector('[data-field="topic"] input') as HTMLInputElement).value, "Amir Temur davri"));
  assert.equal(checked("crosswordType"), "Ta'rifli", "qoralamadagi tur tiklanmadi");
  assert.equal(checked("wordCount"), `${GAME_LIMITS.countDefault} so‘z`, "noma'lum so'z soni standartga tushishi kerak");
  assert.equal(checked("language"), "Русский");
});

/* ────────────────────────── qamrov (bezak maydon yo'q) ────────────────────────── */

test("qamrov: GAME_PARAMS dagi har id mos vositada `data-field` bilan chizilgan", async () => {
  stubApi();
  await login();
  for (const id of GAME_TOOLS) {
    cleanup();
    mount(id);
    const kind = gameKindOf(id) as GameKind;
    const found = new Set([...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")));
    const missing = gameParamsOf(kind)
      .map((p) => p.id)
      .filter((pid) => !found.has(pid));
    assert.deepEqual(missing, [], `${id}: formada yo'q maydonlar: ${missing.join(", ")}`);
  }
});

test("qamrov (teskari): formada reyestrda YO'Q maydon chizilmaydi va har id BITTA marta", async () => {
  stubApi();
  await login();
  for (const id of GAME_TOOLS) {
    cleanup();
    mount(id);
    const kind = gameKindOf(id) as GameKind;
    const known = new Set(gameParamsOf(kind).map((p) => p.id));
    const found = [...document.querySelectorAll("[data-field]")].map((el) => el.getAttribute("data-field")!);
    const stray = [...new Set(found)].filter((pid) => !known.has(pid));
    assert.deepEqual(stray, [], `${id}: reyestrda yo'q maydonlar: ${stray.join(", ")}`);
    const twice = found.filter((v, i) => found.indexOf(v) !== i);
    assert.deepEqual(twice, [], `${id}: ikki joyda chizilgan maydonlar: ${twice.join(", ")}`);
  }
});

test("qo'shimcha talab reyestr chegarasida kesiladi (hisoblagich bilan)", async () => {
  stubApi();
  await login();
  mount("flashcards");
  const area = document.querySelector('[data-field="extra"] textarea') as HTMLTextAreaElement;
  await act(async () => {
    fireEvent.change(area, { target: { value: "x".repeat(GAME_LIMITS.extraChars + 50) } });
  });
  assert.equal(area.value.length, GAME_LIMITS.extraChars, "chegaradan uzun matn kesilmadi");
  assert.ok(document.querySelector('[data-field="extra"] [data-counter]'), "hisoblagich yo'q");
});
