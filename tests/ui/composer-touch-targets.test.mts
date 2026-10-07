import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { render, fireEvent, screen, cleanup, act } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { RowList } from "../../components/forms/RowList.tsx";
import { PhotoField } from "../../components/forms/PhotoField.tsx";
import { MonthPicker } from "../../components/forms/MonthPicker.tsx";
import { YearPicker } from "../../components/forms/YearPicker.tsx";
import { DateRow } from "../../components/forms/teacher/common.tsx";
import { CustomTemplateCard } from "../../components/forms/CustomTemplateCard.tsx";
import { ArticleComposer } from "../../components/forms/ArticleComposer.tsx";
import { EssayComposer } from "../../components/forms/EssayComposer.tsx";
import { SlideForm } from "../../components/forms/SlideForm.tsx";
import { TeacherComposer } from "../../components/forms/teacher/TeacherComposer.tsx";
import { TranslationForm } from "../../components/forms/TranslationForm.tsx";
import { ImageStudio } from "../../components/forms/ImageStudio.tsx";
import { WorkComposer } from "../../components/forms/WorkComposer.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Mobile sprint P12b — every remaining interactive control inside the composers
 * is a 44 px touch target on a coarse pointer (docs/mobile/PLAN.md O5).
 *
 * jsdom cannot evaluate `(pointer: coarse)`, so the contract is locked at the class
 * level, exactly like `touch-layer.test.mts`: the control carries a `pointer-coarse:`
 * size (a REAL size, measurable by rect-based audits) or the `.hit-44` expander, and
 * KEEPS its desktop classes (fine-pointer visuals unchanged). The Chromium audit
 * (scratchpad/mobile/p12b) checks the computed boxes.
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "Karimova Dilnoza", language: "uz", points: 0, quota: 0, balance: 100000,
  university: "TDIU", faculty: "", department: "", group: "", course: "", author: "Karimova Dilnoza", subject: "Biologiya",
  teacher: "", city: "Toshkent", position: "Katta o‘qituvchi", organization: "",
};

/** A real coarse size (min height / height / square) or the `.hit-44` expander. */
const TOUCH = /(?:^|\s)(?:pointer-coarse:(?:min-h-11|h-11|size-11)|hit-44)(?:\s|$)/;
const cls = (el: Element) => el.getAttribute("class") ?? "";
function assertTouch(el: Element | null | undefined, what: string) {
  assert.ok(el, `${what}: element not found`);
  assert.ok(TOUCH.test(cls(el!)), `${what}: no 44 px coarse marker in «${cls(el!)}»`);
}
const byText = (root: ParentNode, sel: string, re: RegExp) => [...root.querySelectorAll(sel)].find((e) => re.test(e.textContent ?? ""));

function stubApi() {
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (/\/draft$/.test(url) && method === "GET") return json(200, { draft: null });
    if (/\/draft$/.test(url)) return json(200, { ok: true, updatedAt: "now" });
    if (url.startsWith("/api/uploads/photo")) return new Response("img", { status: 200 });
    return json(404, { error: "yo'q" });
  };
}
async function login() {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
}
const withRouter = (el: ReturnType<typeof h>) => h(AppRouterContext.Provider, { value: router }, el);

/* ───────────────────────── primitives ───────────────────────── */

test("RowList: «+ qo'shish» and the ↑ ↓ × icon buttons are 44 px on touch, desktop sizes kept", () => {
  render(h(RowList<{ a: string }>, { rows: [{ a: "1" }, { a: "2" }], onChange() {}, render: () => h("span"), add: () => ({ a: "" }), addLabel: "Ish joyi", max: 5, name: "t" }));
  const add = byText(document, "button", /\+ Ish joyi/);
  assertTouch(add, "+ qo'shish");
  // Redesign W6 type sweep: desktop 12 px → 14 px, touch 14.5 px (was 13 px, i.e. smaller than the base would have become).
  assert.match(cls(add!), /(?:^|\s)text-\[14px\](?:\s|$)/, "desktop font size 14 px");
  assert.match(cls(add!), /pointer-coarse:text-\[14\.5px\]/, "touch font size 14.5 px");
  for (const label of ["Yuqoriga", "Pastga", "O'chirish"]) {
    const b = document.querySelector(`button[aria-label="${label}"]`);
    assertTouch(b, label);
    assert.match(cls(b!), /(?:^|\s)size-6(?:\s|$)/, `${label}: desktop size-6 kept`);
  }
  // 3 icon buttons × 2 rows, all expanded
  assert.equal([...document.querySelectorAll("[data-row] button")].filter((b) => TOUCH.test(cls(b))).length, 6);
});

test("PhotoField: Almashtirish / Markazlash / Olib tashlash are 44 px on touch", () => {
  stubApi();
  render(h(PhotoField, { assetId: "a".repeat(32), originalAssetId: "b".repeat(32), shape: "circle", onChange() {} }));
  for (const re of [/Almashtirish/, /Markazlash/, /Olib tashlash/]) assertTouch(byText(document, "button", re), String(re));
});

test("PhotoField: empty state «Surat qo‘shish» is 44 px on touch", () => {
  stubApi();
  render(h(PhotoField, { assetId: "", originalAssetId: "", shape: "circle", onChange() {} }));
  assertTouch(byText(document, "button", /Surat qo‘shish/), "Surat qo‘shish");
});

test("MonthPicker, YearPicker, DateRow: every <select> is h-11 on touch and keeps h-8", () => {
  render(h("div", null, h(MonthPicker, { value: "2020-03", onChange() {}, label: "Boshlanish", allowNow: true }), h(YearPicker, { value: "2020", onChange() {}, label: "Yil", allowNow: true }), h(DateRow, { value: "", onChange() {} })));
  const selects = [...document.querySelectorAll("select")];
  assert.equal(selects.length, 2 + 1 + 3, "month+year, year, day+month+year");
  for (const s of selects) {
    assertTouch(s, s.getAttribute("aria-label") ?? "select");
    assert.match(cls(s), /(?:^|\s)h-8(?:\s|$)/, "desktop h-8 kept");
  }
});

const TPL = {
  assetId: "abcdefabcdefabcdefabcdef",
  name: "Universitet.pptx",
  profile: {
    size: { w: 13.333, h: 7.5 }, colors: { dk1: "#101820", lt1: "#FFFFFF", accent1: "#C9A227" }, fonts: { major: "Georgia", minor: "Verdana" },
    masterPath: "ppt/slideMasters/slideMaster1.xml", themePath: "ppt/theme/theme1.xml",
    layouts: [{ path: "ppt/slideLayouts/slideLayout1.xml", name: "Muqova", kind: "cover", placeholders: [] }],
    roles: { cover: "ppt/slideLayouts/slideLayout1.xml" },
  },
  previews: { cover: { png: "data:image/png;base64,iVBORw0KGgo=", dark: true } },
} as never;

test("CustomTemplateCard: current template — «Boshqa fayl» label and «Olib tashlash» are 44 px on touch", () => {
  stubApi();
  render(h(CustomTemplateCard, { on: true, onPick() {}, onClear() {}, themeId: "chalk", tpl: TPL, list: [], onTpl() {}, onList() {} }));
  assertTouch(byText(document, "label", /Boshqa fayl/), "Boshqa fayl");
  assertTouch(byText(document, "button", /Olib tashlash/), "Olib tashlash");
});

test("CustomTemplateCard: saved-template chips — name button and × are 44 px on touch", () => {
  stubApi();
  render(h(CustomTemplateCard, { on: false, onPick() {}, onClear() {}, themeId: "chalk", tpl: null, list: [TPL], onTpl() {}, onList() {} }));
  assertTouch(byText(document, "button", /Universitet\.pptx/), "chip name");
  assertTouch(document.querySelector('button[aria-label$="o‘chirish"]'), "chip ×");
});

/* ───────────────────────── composers ───────────────────────── */

test("ArticleComposer: topic examples, Sozlamalar summary, UDK «Taklif» and the clear-form button are 44 px on touch", async () => {
  stubApi();
  await login();
  render(withRouter(h(ArticleComposer, { tool: TOOL_BY_ID.article, profile, user: null })));
  const chips = [...document.querySelectorAll("button")].filter((b) => (TOOL_BY_ID.article.topicExamples ?? []).includes((b.textContent ?? "").trim()));
  assert.ok(chips.length >= 2, "topic example chips rendered");
  for (const c of chips) assertTouch(c, `example «${c.textContent}»`);
  const summary = byText(document, "summary", /Sozlamalar/);
  assertTouch(summary, "Sozlamalar summary");
  await act(async () => {
    fireEvent.click(summary!);
  });
  assertTouch(document.querySelector("[data-udk-suggest]"), "UDK Taklif");
  assertTouch(document.querySelector("[data-clear-form]"), "Formani tozalash");
});

test("EssayComposer: document-frame chips are 44 px on touch; the CEFR level control is unchanged", async () => {
  stubApi();
  await login();
  render(withRouter(h(EssayComposer, { tool: TOOL_BY_ID.essay })));
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const chips = [...document.querySelectorAll("[data-design]")];
  assert.ok(chips.length >= 4, "design chips rendered");
  for (const c of chips) assertTouch(c, `design ${c.getAttribute("data-design")}`);
  const level = document.querySelector('[data-field="essayLevel"] span.block');
  assert.ok(level, "level control present");
  assert.match(cls(level!), /pointer-coarse:\[&_button\]:min-h-11/, "level control keeps its own 44 px rule");
});

test("SlideForm: «Mavzu/Fayl asosida» tabs and the topic example chips are 44 px on touch", () => {
  stubApi();
  render(withRouter(h(SlideForm, { tool: TOOL_BY_ID.slide, profile })));
  for (const tab of document.querySelectorAll('[role="tab"]')) assertTouch(tab, `tab «${tab.textContent}»`);
  assert.ok(document.querySelectorAll('[role="tab"]').length >= 2);
  const chips = [...document.querySelectorAll("button")].filter((b) => /rounded-full border/.test(cls(b)) && !b.getAttribute("role"));
  assert.ok(chips.length >= 3, "topic example chips rendered");
  for (const c of chips) assertTouch(c, `example «${c.textContent}»`);
});

test("TeacherComposer (test): question-kind chips and the date selects are 44 px on touch", async () => {
  stubApi();
  await login();
  render(withRouter(h(TeacherComposer, { tool: TOOL_BY_ID.test, profile, user: null })));
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const kind = byText(document, "button", /Bir tanlovli/);
  assertTouch(kind, "question-kind chip");
  const dates = [...document.querySelectorAll('select[aria-label^="Sana"]')];
  assert.equal(dates.length, 3);
  for (const s of dates) assertTouch(s, s.getAttribute("aria-label") ?? "date");
});

test("TeacherComposer (glossary): kind chips are 44 px on touch", async () => {
  stubApi();
  await login();
  render(withRouter(h(TeacherComposer, { tool: TOOL_BY_ID.glossary, profile, user: null })));
  await act(async () => {
    fireEvent.click(screen.getByText("Sozlamalar"));
  });
  const chips = [...document.querySelectorAll("button")].filter((b) => /rounded-full border/.test(cls(b)));
  assert.ok(chips.length >= 2, "glossary chips rendered");
  for (const c of chips) assertTouch(c, `chip «${c.textContent}»`);
});

test("TeacherComposer: topic example chips (a tool that ships examples) are 44 px on touch", async () => {
  stubApi();
  await login();
  const tool = { ...TOOL_BY_ID["lesson-plan"], topicExamples: ["Fotosintez jarayoni", "Nyuton qonunlari"] };
  render(withRouter(h(TeacherComposer, { tool, profile, user: null })));
  for (const ex of tool.topicExamples) assertTouch(byText(document, "button", new RegExp(ex)), `example «${ex}»`);
});

test("TranslationForm: the language-swap button is 44 px on touch", () => {
  stubApi();
  render(withRouter(h(TranslationForm, { tool: TOOL_BY_ID.translation })));
  assertTouch(document.querySelector('button[aria-label="Tillarni almashtirish"]'), "swap languages");
});

test("ImageStudio: prompt example chips are 44 px on touch", () => {
  stubApi();
  render(withRouter(h(ImageStudio, { tool: TOOL_BY_ID.image })));
  const chips = [...document.querySelectorAll("button")].filter((b) => /rounded-full border/.test(cls(b)) && /truncate/.test(cls(b)));
  assert.ok(chips.length >= 3, "example chips rendered");
  for (const c of chips) assertTouch(c, `example «${c.textContent}»`);
});

/* ───────────────────── TopicChips (P3 primitive) in every composer ───────────────────── */

const EX = ["Fotosintez jarayoni", "Nyuton qonunlari"];
const chipsOf = () => [...document.querySelectorAll("[data-topic-chips] button")] as HTMLButtonElement[];

test("every composer with topic suggestions renders the shared TopicChips and picking fills the field", async () => {
  stubApi();
  await login();
  const cases: Array<{ name: string; el: () => ReturnType<typeof h>; input: () => HTMLInputElement | HTMLTextAreaElement; expect: string[] }> = [
    { name: "article", el: () => h(ArticleComposer, { tool: TOOL_BY_ID.article, profile, user: null }), input: () => document.querySelector('[data-field="topic"] input, [data-field="topic"] textarea') as HTMLInputElement, expect: TOOL_BY_ID.article.topicExamples ?? [] },
    { name: "work", el: () => h(WorkComposer, { tool: { ...TOOL_BY_ID.coursework, topicExamples: EX }, profile, user: null }), input: () => document.querySelector("input[type=text], textarea") as HTMLInputElement, expect: EX },
    { name: "teacher", el: () => h(TeacherComposer, { tool: { ...TOOL_BY_ID["lesson-plan"], topicExamples: EX }, profile, user: null }), input: () => document.querySelector('[data-field="topic"] input, [data-field="topic"] textarea') as HTMLInputElement, expect: EX },
    { name: "slide", el: () => h(SlideForm, { tool: TOOL_BY_ID.slide, profile }), input: () => document.querySelector('input[type="text"]') as HTMLInputElement, expect: [] },
    { name: "image", el: () => h(ImageStudio, { tool: TOOL_BY_ID.image }), input: () => document.querySelector("textarea") as HTMLTextAreaElement, expect: [] },
  ];
  for (const c of cases) {
    render(withRouter(c.el()));
    await act(async () => {});
    const chips = chipsOf();
    assert.ok(document.querySelector("[data-topic-chips]"), `${c.name}: TopicChips container rendered`);
    assert.ok(chips.length >= 2, `${c.name}: chips rendered`);
    for (const e of c.expect) assert.ok(chips.some((b) => b.textContent === e), `${c.name}: example «${e}» present`);
    for (const b of chips) assertTouch(b, `${c.name} chip`);
    const pick = chips[1];
    await act(async () => {
      fireEvent.click(pick);
    });
    assert.ok(c.input(), `${c.name}: topic input found`);
    assert.equal(c.input().value.trim(), (pick.textContent ?? "").trim(), `${c.name}: picking a chip fills the field`);
    cleanup();
  }
});

test("ToolWorkspace's fallback StandardForm also uses TopicChips (no inline chip map left in any composer)", () => {
  const dir = new URL("../../components/forms/", import.meta.url);
  const src = (f: string) => readFileSync(new URL(f, dir), "utf8");
  assert.match(src("ToolWorkspace.tsx"), /<TopicChips /);
  for (const f of ["ArticleComposer.tsx", "WorkComposer.tsx", "SlideComposer.tsx", "ImageStudio.tsx", "teacher/TeacherComposer.tsx", "ToolWorkspace.tsx"]) {
    assert.doesNotMatch(src(f), /topicExamples\.map|TOPIC_EXAMPLES\.map|EXAMPLES\.map/, `${f}: inline suggestion chip map`);
  }
});
