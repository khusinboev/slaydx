import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, within, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideForm } from "../../components/forms/SlideForm.tsx";
import { ProSlideForm } from "../../components/forms/ProSlideForm.tsx";
import { SLIDE_TEMPLATES, SLIDE_TEMPLATE_BY_ID } from "../../lib/generation/slide-templates.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Shablon tanlagich (Shablonlar 2, oyna varianti): formada bitta plitka
 * (standart «Avtomatik» — bezak, shablon preview'i emas), bosilsa oyna —
 * har karta HAQIQIY slayd renderi; karta bosilishi bilan tanlov qo'llanib
 * oyna yopiladi; rang swatchlari plitka ostida, plitka preview'i shu rangda.
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "A", language: "uz", points: 0, quota: 0, balance: 0, premium: false, plan: "free",
  university: "", faculty: "", department: "", group: "", course: "", author: "A", subject: "", teacher: "", city: "Toshkent", position: "", organization: "",
};
function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(SlideForm, { tool: TOOL_BY_ID.slide, profile })));
}
function mountPro() {
  render(h(AppRouterContext.Provider, { value: router }, h(ProSlideForm, { tool: TOOL_BY_ID["pro-slide"], profile })));
}
const tile = () => screen.getByRole("button", { name: /^Shablon: / });
const dialog = () => screen.getByRole("dialog", { name: "Shablon tanlash" });
const openDialog = () => {
  fireEvent.click(tile());
  return dialog();
};
const gallery = () => within(dialog()).getByRole("radiogroup", { name: "Shablon" });
const card = (name: string) => within(gallery()).getByRole("radio", { name });
const themeGroup = () => screen.getByRole("radiogroup", { name: "Rang" });
const mainBg = (el: HTMLElement) => (el.querySelector('[data-thumb="main"] > span > div') as HTMLElement).style.background;
// jsdom `style.background` ni `rgb(r, g, b)` shaklida beradi — hex bilan solishtirish uchun.
const rgb = (hex: string) => {
  const n = hex.replace("#", "");
  return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
};

test("standart: formada faqat «Avtomatik» plitkasi — bezak (shablon preview'i YO'Q), oyna yopiq", () => {
  mount();
  const t = tile();
  assert.equal(t.getAttribute("data-template-tile"), "auto");
  assert.ok(t.querySelector("[data-auto-tile]"), "bezakli plitka");
  assert.equal(t.querySelector('[data-src=\'{"f":"title"}\']'), null, "Avtomatik'da hech bir shablon slaydi ko'rsatilmaydi");
  assert.ok(t.textContent?.includes("Mavzuga qarab"));
  assert.equal(screen.queryByRole("dialog", { name: "Shablon tanlash" }), null);
  assert.ok(themeGroup(), "rang swatchlari plitka ostida, oynasiz");
});

test("plitka bosilsa oyna: 11 karta (auto bezak + 10 haqiqiy slayd: titul `data-src` + 3 eskiz); Esc yopadi", () => {
  mount();
  openDialog();
  const cards = within(gallery()).getAllByRole("radio");
  assert.equal(cards.length, SLIDE_TEMPLATES.length);
  for (const c of cards) {
    if (c.getAttribute("data-template-card") === "auto") {
      assert.ok(c.querySelector("[data-auto-tile]"), "auto kartasi — bezak");
      continue;
    }
    assert.ok(c.querySelector('[data-thumb="main"] [data-src=\'{"f":"title"}\']'), `${c.getAttribute("aria-label")}: titul haqiqiy render emas`);
    assert.equal(c.querySelectorAll('[data-thumb="small"]').length, 3, "uchta eskiz");
  }
  assert.equal(card("Avtomatik").getAttribute("aria-checked"), "true", "standart — Avtomatik");
  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(screen.queryByRole("dialog", { name: "Shablon tanlash" }), null, "Esc yopadi");
});

test("karta bosilsa: tanlov + shablonning standart palitrasi, oyna yopiladi, plitkada haqiqiy titul; swatch → plitka shu rangda", () => {
  mount();
  openDialog();
  fireEvent.click(card("Dars / trening"));
  assert.equal(screen.queryByRole("dialog", { name: "Shablon tanlash" }), null, "tanlangach oyna yopiladi");
  const t = tile();
  assert.equal(t.getAttribute("data-template-tile"), "lesson");
  assert.ok(t.querySelector('[data-thumb="main"] [data-src=\'{"f":"title"}\']'), "plitkada shablonning haqiqiy tituli");
  const lumen = getSlideTheme(SLIDE_TEMPLATE_BY_ID.lesson.defaultTheme);
  // MUTATSIYA: `onTheme(tpl.defaultTheme)` olib tashlansa — rang «atlas» da qoladi.
  assert.equal(within(themeGroup()).getByRole("radio", { name: lumen.nameUz }).getAttribute("aria-checked"), "true", "shablonning palitrasi tanlandi");
  const before = mainBg(t);
  const chalk = getSlideTheme("chalk");
  fireEvent.click(within(themeGroup()).getByRole("radio", { name: chalk.nameUz }));
  const after = mainBg(tile());
  assert.notEqual(after, before, "rang o'zgarsa plitka preview'i qayta chiziladi");
  assert.ok(after === rgb(chalk.titleBg) || after === rgb(chalk.bg), `preview chalk rangida: ${after}`);
  openDialog();
  assert.equal(card("Dars / trening").getAttribute("aria-checked"), "true", "oynada tanlangani belgilangan");
});

// ───────────────────────── «O'z shablonim» (faqat pro) ─────────────────────────

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const TPL = {
  assetId: "abcdefabcdefabcdefabcdef",
  name: "Universitet.pptx",
  profile: {
    size: { w: 13.333, h: 7.5 },
    colors: { dk1: "#101820", lt1: "#FFFFFF", accent1: "#C9A227" },
    fonts: { major: "Georgia", minor: "Verdana" },
    masterPath: "ppt/slideMasters/slideMaster1.xml",
    themePath: "ppt/theme/theme1.xml",
    layouts: [
      { path: "ppt/slideLayouts/slideLayout1.xml", name: "Muqova", kind: "cover", placeholders: [{ type: "ctrTitle", idx: null, name: "t", box: { x: 1, y: 2.5, w: 11.3, h: 1.5 } }] },
      { path: "ppt/slideLayouts/slideLayout2.xml", name: "Mazmun", kind: "content", placeholders: [{ type: "title", idx: null, name: "t", box: { x: 0.7, y: 0.5, w: 11.9, h: 1 } }, { type: "body", idx: 1, name: "b", box: { x: 0.7, y: 1.7, w: 11.9, h: 4.9 } }] },
    ],
    roles: { cover: "ppt/slideLayouts/slideLayout1.xml", content: "ppt/slideLayouts/slideLayout2.xml" },
  },
  previews: { cover: { png: PNG, dark: true }, content: { png: PNG, dark: false } },
};

type Call = { url: string; method: string };
function stubTemplateApi(list: unknown[] = []) {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    calls.push({ url, method });
    if (url === "/api/uploads/template" && method === "GET") return json(200, { templates: list });
    if (url === "/api/uploads/template" && method === "POST") {
      const fd = opts?.body as FormData;
      const f = fd.get("file") as File;
      return json(200, { assetId: TPL.assetId, name: f.name, size: f.size, template: { ...TPL, name: f.name } });
    }
    if (url.startsWith("/api/uploads/template/") && method === "DELETE") return json(200, { ok: true });
    return json(404, { error: "yo'q" });
  };
  return calls;
}
const customCard = () => within(gallery()).getByRole("radio", { name: "O‘z shablonim" });
const pptxFile = (name = "Mening namunam.pptx") => new File([new Uint8Array([0x50, 0x4b, 3, 4])], name, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });

test("oddiy slayd oynasida «O‘z shablonim» kartasi YO'Q, pro da bor (Pro · ustamasiz, ogohlantirish bilan)", async () => {
  stubTemplateApi();
  mount();
  openDialog();
  assert.equal(within(gallery()).queryByRole("radio", { name: "O‘z shablonim" }), null);
  cleanup();
  mountPro();
  openDialog();
  const c = customCard();
  assert.equal(c.getAttribute("aria-checked"), "false");
  assert.ok(c.textContent?.includes("ustamasiz"));
  assert.ok(c.textContent?.includes("ko‘proq vaqt oladi"), "ogohlantirish matni");
  assert.equal(within(gallery()).getAllByRole("radio").length, SLIDE_TEMPLATES.length + 1);
});

test("PPTX tanlash → «Tahlil qilinmoqda…» → tanlanadi, oyna yopiladi, plitkada namunada chizilgan titul (fon PNG + data-src); rang qatori o'chadi", async () => {
  const calls = stubTemplateApi();
  mountPro();
  openDialog();
  const input = within(customCard()).getByLabelText("PPTX namuna") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [pptxFile()] } });
  });
  await waitFor(() => assert.equal(tile().getAttribute("data-template-tile"), "custom"));
  assert.ok(calls.some((c) => c.method === "POST" && c.url === "/api/uploads/template"), "yuklash so'rovi ketdi");
  assert.equal(screen.queryByRole("dialog", { name: "Shablon tanlash" }), null, "tanlangach oyna yopiladi");
  const t = tile();
  assert.ok(t.querySelector('[data-thumb="main"] [data-src=\'{"f":"title"}\']'), "titul haqiqiy render");
  assert.ok(t.querySelector(`[data-thumb="main"] img[src="${PNG}"]`), "fon — namunaning layout PNG si");
  assert.ok(t.textContent?.includes("Mening namunam.pptx"));
  assert.ok(screen.getByText("Namunaning o‘z ranglari"));
  assert.equal(screen.queryByRole("radiogroup", { name: "Rang" }), null);
  // Oynada: namuna kartasi tanlangan, ichki shablonlar emas; 3 eskiz.
  openDialog();
  assert.equal(customCard().getAttribute("aria-checked"), "true");
  assert.equal(customCard().querySelectorAll('[data-thumb="small"]').length, 3);
  assert.equal(card("Avtomatik").getAttribute("aria-checked"), "false");
  // Ichki shablon bosilsa — namuna bekor (templateAssetId tozalanadi).
  fireEvent.click(card("Ma’ruza"));
  assert.equal(tile().getAttribute("data-template-tile"), "lecture");
  assert.ok(screen.getByRole("radiogroup", { name: "Rang" }), "rang qatori qaytdi");
  // Karta qayta bosilsa — oxirgi namuna qayta tanlanadi (fayl qayta yuklanmaydi).
  const posts = calls.filter((x) => x.method === "POST").length;
  openDialog();
  assert.equal(customCard().getAttribute("aria-checked"), "false");
  fireEvent.click(customCard());
  assert.equal(tile().getAttribute("data-template-tile"), "custom");
  assert.equal(calls.filter((x) => x.method === "POST").length, posts);
});

test("noto'g'ri fayl (docx) — serverga bormasdan xato; oldingi namunalar ro'yxatdan tanlanadi va o'chiriladi", async () => {
  const calls = stubTemplateApi([TPL]);
  mountPro();
  await waitFor(() => assert.ok(calls.some((c) => c.method === "GET")));
  openDialog();
  await waitFor(() => assert.ok(within(customCard()).getByText("Universitet.pptx")));
  const input = within(customCard()).getByLabelText("PPTX namuna") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], "x.docx")] } });
  });
  assert.ok(within(customCard()).getByText("Faqat PPTX (PowerPoint) fayl"));
  assert.ok(!calls.some((c) => c.method === "POST"), "docx serverga yuborilmaydi");
  fireEvent.click(within(customCard()).getByText("Universitet.pptx"));
  assert.equal(tile().getAttribute("data-template-tile"), "custom", "ro'yxatdan tanlandi, oyna yopildi");
  openDialog();
  fireEvent.click(within(customCard()).getByText("Olib tashlash"));
  assert.equal(customCard().getAttribute("aria-checked"), "false");
  fireEvent.click(within(customCard()).getByRole("button", { name: "Universitet.pptx — o‘chirish" }));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith(TPL.assetId))));
  assert.equal(within(customCard()).queryByText("Universitet.pptx"), null);
});
