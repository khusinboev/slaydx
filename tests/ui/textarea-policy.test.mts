import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, type ReactElement } from "react";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideForm } from "../../components/forms/SlideForm.tsx";
import { ProSlideForm } from "../../components/forms/ProSlideForm.tsx";
import { TranslationForm } from "../../components/forms/TranslationForm.tsx";
import { ImageStudio } from "../../components/forms/ImageStudio.tsx";
import { EssayComposer } from "../../components/forms/EssayComposer.tsx";
import { WorkComposer } from "../../components/forms/WorkComposer.tsx";
import { ToolWorkspace } from "../../components/forms/ToolWorkspace.tsx";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { ToolConfig, UserProfile } from "../../lib/types.ts";

/**
 * Textarea policy (docs/TEXTAREA-POLICY.md), consumer side: every form
 * textarea is an AutoTextarea, so none has a drag handle (inline
 * `resize: none`, no `resize-*` class) and none is sized by an `h-*` class.
 * The translation source field is the one large field (`max-height: 60vh`).
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "Aliyev Ali", language: "uz", points: 0, quota: 0, balance: 100000,
  university: "TDPU", faculty: "", department: "", group: "", course: "", author: "Aliyev Ali", subject: "Biologiya",
  teacher: "", city: "Toshkent", position: "", organization: "",
};

function mount(el: ReactElement) {
  render(h(AppRouterContext.Provider, { value: router }, el));
}

function assertNoHandle(label: string) {
  const areas = Array.from(document.querySelectorAll("textarea"));
  assert.ok(areas.length > 0, `${label}: formada textarea topilmadi`);
  for (const ta of areas) {
    const name = ta.getAttribute("aria-label") ?? ta.getAttribute("placeholder") ?? "(nomsiz)";
    assert.equal(ta.style.resize, "none", `${label}: «${name}» da resize tutqichi bor`);
    assert.ok(!/\bresize(-\w+)?\b/.test(ta.className), `${label}: «${name}» da resize klassi: ${ta.className}`);
    assert.ok(!/(^|\s)(min-|max-)?h-/.test(ta.className), `${label}: «${name}» balandligi klass bilan berilgan: ${ta.className}`);
  }
}

test("slayd formalari: har textarea'da resize tutqichi yo'q", () => {
  mount(h(SlideForm, { tool: TOOL_BY_ID.slide, profile }));
  assertNoHandle("slide");
  cleanup();
  mount(h(ProSlideForm, { tool: TOOL_BY_ID["pro-slide"], profile }));
  assertNoHandle("pro-slide");
});

test("rasm, insho va ish formalari (LimitedTextarea): resize tutqichi yo'q", () => {
  mount(h(ImageStudio, { tool: TOOL_BY_ID.image }));
  assertNoHandle("image");
  cleanup();
  mount(h(EssayComposer, { tool: TOOL_BY_ID.essay }));
  assertNoHandle("essay");
  cleanup();
  mount(h(WorkComposer, { tool: TOOL_BY_ID.coursework, profile, user: null }));
  assertNoHandle("work");
});

test("tarjimon: manba matni katta chegara (60vh), lug'at 10 qatorli; ikkalasida tutqich yo'q", () => {
  mount(h(TranslationForm, { tool: TOOL_BY_ID.translation }));
  assertNoHandle("translation");
  const src = document.querySelector('textarea[aria-label="Tarjima qilinadigan matn"]') as HTMLTextAreaElement;
  // MUTATSIYA: `maxHeight="60vh"` olib tashlansa shu yerda yiqiladi.
  assert.equal(src.style.maxHeight, "60vh", "manba matni 60vh gacha o'sadi");
  assert.equal(src.rows, 6, "manba matni 6 qatordan boshlanadi");
  const glossary = document.querySelector('textarea[aria-label="O‘z lug‘atim"]') as HTMLTextAreaElement;
  assert.ok(glossary, "lug'at maydoni bor");
  assert.equal(glossary.style.maxHeight, "", "lug'at qator chegarasi bilan (60vh emas)");
  assert.equal(glossary.rows, 3);
});

test("ToolWorkspace zaxira formasi (StandardForm): «Qo'shimcha talablar» textarea'sida tutqich yo'q", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({
    loggedIn: true,
    sessionChecked: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: true, pdf: true, payments: { click: false, payme: false } },
  });
  // `custom` olib tashlansa vosita StandardForm ga tushadi.
  const tool: ToolConfig = { ...TOOL_BY_ID.coursework, custom: undefined, extraOptional: true };
  mount(h(ToolWorkspace, { tool }));
  await waitFor(() => assert.ok(screen.getByText(/Qo.shimcha \(ixtiyoriy\)/)));
  fireEvent.click(screen.getByText(/Qo.shimcha \(ixtiyoriy\)/));
  await waitFor(() => assert.ok(document.querySelector("textarea")));
  assertNoHandle("standard");
});
