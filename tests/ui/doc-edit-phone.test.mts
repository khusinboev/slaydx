import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useCallback, useRef, useState } from "react";
import { render, fireEvent, screen, cleanup, within } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { ResumeViewer } from "../../components/viewers/ResumeViewer.tsx";
import { ViewerToolbar } from "../../components/viewers/toolbar.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { DOC_EDIT_HINT_KEY, DOC_EDIT_HINT_TEXT, docFocusZoom, editViewBand, revealOpenField } from "../../components/viewers/EditDoneBar.tsx";
import { DOC_VIEW_KEY } from "../../components/viewers/reading/prefs.ts";
import { applyTeacherOps, type TeacherOp } from "../../lib/generation/teacher/edit.ts";
import { sampleTeacherDoc } from "../../lib/generation/teacher/samples.ts";
import { applyResumeOps, type ResumeOp } from "../../lib/generation/resume/edit.ts";
import { docFromResume } from "../../lib/generation/resume/model.ts";
import { sampleResume } from "../../lib/generation/resume/samples.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Document editors on PHONES (mobile sprint, package E; docs/mobile/PLAN.md
 * lead decision, R3 «Contract» → EditDoneBar, R5 P7) — jsdom with a stubbed
 * coarse `matchMedia` and `visualViewport`.
 *
 * Contract: while a field is open on a phone a fixed 44 px «Bekor / Tayyor»
 * bar sits above the keyboard (`--kb-h`); «Tayyor» commits and «Bekor»
 * cancels through the editor's own Enter/Esc paths; the bar never takes the
 * focus; phone back commits and leaves no stale history entry; «Tahrirlash»
 * is pinned in the toolbar row (also in «O‘qish», where it switches to
 * «Varaq»); a one-time text hint; the resume (and sheet) focus-zooms the
 * edited field and restores the previous zoom. Desktop: unchanged.
 */

const nav = await import("../../lib/nav/history.ts");

if (!("IntersectionObserver" in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

const win = window as unknown as Record<string, unknown>;
function stubMedia(match: (q: string) => boolean) {
  win.matchMedia = (q: string) => ({
    matches: match(q),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}
/** A 390 px phone: coarse pointer and < md (not < sm, so the Word viewer opens in «Varaq» unless told otherwise). */
const phone = () => stubMedia((q) => q.includes("pointer: coarse") || q.includes("max-width: 767px"));

afterEach(async () => {
  cleanup();
  delete win.matchMedia;
  delete win.visualViewport;
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
  await settle();
  nav.__resetNavForTests();
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

/* ───────────────────────────── teacher doc (Word viewer) ─── */

const GEN_ID = "gen-e1";
type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Server = { calls: Call[]; patches: Call[]; doc: AcademicDoc; version: number; type: string };

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function stubTeacher(): Server {
  const s: Server = { calls: [], patches: [], doc: JSON.parse(JSON.stringify(sampleTeacherDoc("lesson"))) as AcademicDoc, version: 1, type: "lesson-plan" };
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    s.calls.push({ url, method, body });
    if (method === "PATCH" && url.endsWith("/doc")) {
      s.patches.push({ url, method, body });
      const res = applyTeacherOps(s.doc, (body?.ops ?? []) as TeacherOp[], { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s) });
    }
    if (method === "POST" && url.endsWith("/rebuild")) return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    return json(200, { generation: generation(s) });
  };
  return s;
}

const RESUME_META = { topic: "Moliya tahlilchisi", author: "Karimova Dilnoza", workLabel: "Rezyume", language: "uz", toolId: "resume" } as unknown as DocMeta;

function stubResume(): Server {
  const s: Server = { calls: [], patches: [], doc: docFromResume(sampleResume("modern", undefined, false), RESUME_META), version: 1, type: "resume" };
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    s.calls.push({ url, method, body });
    if (method === "PATCH" && url.endsWith("/doc")) {
      s.patches.push({ url, method, body });
      const res = applyResumeOps(s.doc, (body?.ops ?? []) as ResumeOp[], { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s) });
    }
    return json(200, { generation: generation(s) });
  };
  return s;
}

function generation(s: Server) {
  return { id: GEN_ID, type: s.type, status: "COMPLETED", doc: s.doc, docVersion: s.version, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}
type Gen = ReturnType<typeof generation>;

function Page({ initial, resume }: { initial: Gen; resume?: boolean }) {
  const [gen, setGen] = useState<Gen>(initial);
  const [st, setSt] = useState<EditActionsState | null>(null);
  const genRef = useRef(gen);
  genRef.current = gen;
  const adopt = useCallback((g: unknown) => {
    const merged = { ...genRef.current, ...(g as Gen) };
    genRef.current = merged;
    setGen(merged);
  }, []);
  const viewer = resume
    ? h(ResumeViewer, { doc: gen.doc, gen, onGen: adopt, onEditState: setSt })
    : h(WordViewer, { doc: gen.doc, gen, onGen: adopt, onEditState: setSt });
  return h("div", null, h(EditActions, { state: st }), viewer);
}

async function mount(s: Server, resume = false) {
  render(h(Page, { initial: generation(s), resume }));
  await settle();
}

const pinned = () => document.querySelector("[data-toolbar-pinned]") as HTMLElement | null;
const editToggle = () => screen.getByText("Tahrirlash").closest("button") as HTMLButtonElement;
const bar = () => document.querySelector("[data-edit-done-bar]") as HTMLElement | null;
const saveBtn = () => screen.queryByText(/^Saqlash · /);
const HOMEWORK = "sections.3.blocks.0";

function byPath(path: string, root = "[data-page]"): HTMLElement {
  const el = document.querySelector(`${root} [data-path="${path}"]`);
  assert.ok(el, `«${path}» target`);
  return el as HTMLElement;
}

async function enableEdit() {
  await act(async () => {
    fireEvent.click(editToggle());
  });
  await settle();
}

async function openField(el: HTMLElement) {
  await act(async () => {
    fireEvent.dblClick(el);
  });
  await settle();
  assert.equal(el.getAttribute("contenteditable"), "true", "field opened");
}

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

/* ═══════════════════════════════════════ «Tahrirlash» entry */

test("phone: «Tahrirlash» is pinned in the toolbar row (not in «⋯» / right group), touch-sized, with a visible pencil", async () => {
  phone();
  await mount(stubTeacher());
  const p = pinned();
  assert.ok(p, "pinned group rendered");
  const btn = within(p!).getByText("Tahrirlash").closest("button")!;
  assert.ok(classes(btn).includes("pointer-coarse:min-h-11") && classes(btn).includes("pointer-coarse:min-w-11"), "44 px on touch");
  assert.ok(btn.querySelector("svg"), "pencil icon");
  const right = document.querySelector("[data-toolbar-right]");
  assert.ok(right && !/Tahrirlash/.test(right.textContent ?? ""), "not in the collapsible right group");
});

test("desktop: no pinned group; «Tahrirlash» stays in the right group (unchanged)", async () => {
  await mount(stubTeacher());
  assert.ok(!pinned());
  const right = document.querySelector("[data-toolbar-right]");
  assert.ok(right && /Tahrirlash/.test(right.textContent ?? ""));
});

test("phone «O‘qish»: «Tahrirlash» is visible and one tap switches to «Varaq» with editing on", async () => {
  phone();
  window.localStorage.setItem(DOC_VIEW_KEY, "reading");
  await mount(stubTeacher());
  assert.equal(document.querySelector("[data-view-toggle]")!.getAttribute("data-view-mode"), "reading");
  assert.ok(pinned() && /Tahrirlash/.test(pinned()!.textContent ?? ""), "entry visible while reading");
  await enableEdit();
  assert.equal(document.querySelector("[data-view-toggle]")!.getAttribute("data-view-mode"), "page", "switched to «Varaq»");
  assert.ok(document.querySelector("[data-article-editor]"), "editing enabled");
  assert.equal(editToggle().getAttribute("aria-pressed"), "true");
});

test("resume on a phone: «Tahrirlash» pinned too; desktop keeps it in the right group", async () => {
  phone();
  await mount(stubResume(), true);
  assert.ok(pinned() && /Tahrirlash/.test(pinned()!.textContent ?? ""));
  cleanup();
  delete win.matchMedia;
  await mount(stubResume(), true);
  assert.ok(!pinned());
});

/* ═══════════════════════════════════════ hint */

test("one-time hint: visible text on a phone in edit mode, gone after the first field opens, never again", async () => {
  phone();
  await mount(stubTeacher());
  assert.ok(!document.querySelector("[data-doc-edit-hint]"), "no hint before edit mode");
  await enableEdit();
  const hint = document.querySelector("[data-doc-edit-hint]");
  assert.ok(hint, "hint shown");
  assert.match(hint!.textContent ?? "", new RegExp(DOC_EDIT_HINT_TEXT));
  await openField(byPath(HOMEWORK));
  assert.ok(!document.querySelector("[data-doc-edit-hint]"), "hint hidden once a field opened");
  assert.equal(window.localStorage.getItem(DOC_EDIT_HINT_KEY), "1", "remembered");
  cleanup();
  await mount(stubTeacher());
  await enableEdit();
  assert.ok(!document.querySelector("[data-doc-edit-hint]"), "not shown again");
});

test("hint: «✕» dismisses it; desktop never shows it", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Maslahatni yopish"));
  });
  assert.ok(!document.querySelector("[data-doc-edit-hint]"));
  cleanup();
  window.localStorage.clear();
  delete win.matchMedia;
  await mount(stubTeacher());
  await enableEdit();
  assert.ok(!document.querySelector("[data-doc-edit-hint]"));
});

/* ═══════════════════════════════════════ the bar */

test("phone: the bar shows only while a field is open — fixed above the keyboard, 44 px buttons", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  assert.ok(!bar(), "no bar before a field opens");
  await openField(byPath(HOMEWORK));
  const b = bar();
  assert.ok(b, "bar shown");
  assert.ok(classes(b).includes("fixed"));
  assert.equal(b!.style.bottom, "var(--kb-h, 0px)");
  for (const label of ["Bekor", "Tayyor"]) {
    const btn = within(b!).getByText(label).closest("button")!;
    assert.ok(classes(btn).includes("h-11") && classes(btn).includes("min-w-11"), `${label}: 44 px`);
  }
  assert.ok(document.querySelector("[data-edit-done-spacer]"), "in-flow spacer so the last lines can scroll above it");
});

test("desktop: no bar while a field is open", async () => {
  await mount(stubTeacher());
  await enableEdit();
  await openField(byPath(HOMEWORK));
  assert.ok(!bar());
});

test("«Tayyor» commits through the editor's Enter path (one pending op, new text on the sheet), bar gone", async () => {
  phone();
  const s = stubTeacher();
  await mount(s);
  await enableEdit();
  const el = byPath(HOMEWORK);
  await openField(el);
  el.textContent = "Tayyor bilan saqlandi.";
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await settle();
  assert.ok(!byPath(HOMEWORK).hasAttribute("contenteditable"), "field closed");
  assert.match(saveBtn()?.textContent ?? "", /· 1\b/, "one pending edit");
  assert.ok(/Tayyor bilan saqlandi/.test(byPath(HOMEWORK).textContent ?? ""));
  assert.equal(s.calls.length, 0, "no network before «Saqlash»");
  assert.ok(!bar());
});

test("«Bekor» cancels through the Esc path: original text back, nothing queued", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  const el = byPath(HOMEWORK);
  const before = el.textContent;
  await openField(el);
  el.textContent = "Bekor qilinadigan matn";
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Bekor"));
  });
  await settle();
  assert.equal(byPath(HOMEWORK).textContent, before);
  assert.ok(!saveBtn(), "nothing queued");
  assert.ok(!bar());
});

test("the bar never takes focus: pointerdown/mousedown are cancelled, the field keeps focus", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  const el = byPath(HOMEWORK);
  await openField(el);
  assert.ok(document.activeElement === el, "field focused");
  for (const label of ["Bekor", "Tayyor"]) {
    const btn = within(bar()!).getByText(label).closest("button")!;
    assert.equal(fireEvent.pointerDown(btn, { pointerType: "touch" }), false, `${label}: pointerdown prevented`);
    assert.equal(fireEvent.mouseDown(btn), false, `${label}: mousedown prevented`);
  }
  assert.ok(document.activeElement === el, "focus (and the keyboard) stays on the text");
  assert.equal(el.getAttribute("contenteditable"), "true");
});

test("resume: «Tayyor» commits, «Bekor» restores the text", async () => {
  phone();
  await mount(stubResume(), true);
  await enableEdit();
  const name = byPath("identity.fullName", "[data-resume-editor]");
  await openField(name);
  name.textContent = "Yangi Ism";
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await settle();
  assert.match(saveBtn()?.textContent ?? "", /· 1\b/);
  const head = byPath("identity.headline", "[data-resume-editor]");
  const before = head.textContent;
  await openField(head);
  head.textContent = "Boshqa";
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Bekor"));
  });
  await settle();
  assert.equal(byPath("identity.headline", "[data-resume-editor]").textContent, before);
  assert.match(saveBtn()?.textContent ?? "", /· 1\b/, "still one edit");
});

/* ═══════════════════════════════════════ phone back */

async function navPage() {
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/files/1");
  nav.installNav();
}

test("phone back while editing commits (auto-save rule) and stays on the page", async () => {
  phone();
  await navPage();
  await mount(stubTeacher());
  await enableEdit();
  const el = byPath(HOMEWORK);
  await openField(el);
  el.textContent = "Orqaga bilan saqlandi.";
  window.history.back();
  await settle();
  assert.ok(!byPath(HOMEWORK).hasAttribute("contenteditable"), "back ended the edit");
  assert.match(saveBtn()?.textContent ?? "", /· 1\b/, "committed, not dropped");
  assert.equal(window.location.pathname, "/uz/files/1");
  assert.ok(!bar());
});

test("one history entry per edit session: «Tayyor» pops it; switching fields keeps it", async () => {
  phone();
  await navPage();
  await mount(stubTeacher());
  await enableEdit();
  const before = window.history.length;
  await openField(byPath(HOMEWORK));
  assert.equal(window.history.length, before + 1, "one entry pushed");
  // Opening another field commits the first; the session (and its entry) continues.
  await openField(byPath("heading:goal"));
  await settle();
  assert.equal(window.history.length, before + 1, "no second entry");
  const sx = () => (window.history.state as { sx?: { o?: string } } | null)?.sx;
  assert.ok(sx()?.o, "on the overlay entry while editing");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await settle();
  assert.ok(!sx()?.o, "back on the page entry, no orphan overlay entry");
});

test("desktop: opening a field pushes no history entry", async () => {
  await navPage();
  await mount(stubTeacher());
  await enableEdit();
  const before = window.history.length;
  await openField(byPath(HOMEWORK));
  assert.equal(window.history.length, before);
});

/* ═══════════════════════════════════════ keyboard + keep visible */

test("keyboard: while the bar shows, <html> carries --kb-h from visualViewport; removed after «Tayyor»", async () => {
  phone();
  win.visualViewport = { height: 420, offsetTop: 0, scale: 1, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(document.documentElement, "clientHeight", { value: 844, configurable: true });
  await mount(stubTeacher());
  await enableEdit();
  await openField(byPath(HOMEWORK));
  assert.equal(document.documentElement.style.getPropertyValue("--kb-h"), "424px", "lift = layout 844 − visible 420");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await settle();
  assert.equal(document.documentElement.style.getPropertyValue("--kb-h"), "", "listeners gone with the bar");
  delete (document.documentElement as unknown as Record<string, unknown>).clientHeight;
});

test("editViewBand: between the sticky toolbar and the bar, inside the visual viewport", () => {
  const band = editViewBand({ height: 420, offsetTop: 0 }, { toolbarBottom: 152, barTop: 376 });
  assert.equal(band.top, 152);
  assert.equal(band.height, 376 - 152);
  const noChrome = editViewBand({ height: 420, offsetTop: 30 }, { toolbarBottom: null, barTop: null });
  assert.equal(noChrome.top, 30);
  assert.equal(noChrome.height, 420);
});

function rect(top: number, height: number, left = 10, width = 200) {
  return () => ({ top, height, left, width, bottom: top + height, right: left + width, x: left, y: top, toJSON() {} }) as DOMRect;
}

test("revealOpenField scrolls the page so a field under the bar ends up above it (and one under the toolbar below it)", () => {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "scrollHeight", { value: 3000 });
  Object.defineProperty(scroller, "clientHeight", { value: 700 });
  const tb = document.createElement("div");
  tb.setAttribute("data-viewer-toolbar", "sticky");
  tb.getBoundingClientRect = rect(112, 44);
  const field = document.createElement("p");
  scroller.append(tb, field);
  document.body.append(scroller);
  const b = document.createElement("div");
  b.getBoundingClientRect = rect(376, 44);
  try {
    field.getBoundingClientRect = rect(600, 20);
    scroller.scrollTop = 0;
    const d = revealOpenField(field, { height: 420, offsetTop: 0 }, b);
    assert.equal(d.dy, 620 - (376 - 8), "bottom edge 8 px above the bar");
    field.getBoundingClientRect = rect(100, 20);
    const up = revealOpenField(field, { height: 420, offsetTop: 0 }, b);
    assert.equal(up.dy, 100 - (156 + 8), "top edge 8 px below the toolbar");
    field.getBoundingClientRect = rect(200, 20);
    assert.equal(revealOpenField(field, { height: 420, offsetTop: 0 }, b).dy, 0, "visible: no scroll");
  } finally {
    scroller.remove();
  }
});

/* ═══════════════════════════════════════ focus zoom */

const zoomLabel = () => (document.querySelector("[data-zoom-inline] button[title]")?.textContent ?? "").trim();
/** The zoom restore waits for a quiet finger (`DOUBLE_TAP_MS` = 300 ms, review E1). */
const quiet = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 360));
  });

function smallField(el: HTMLElement) {
  el.style.fontSize = "10px";
  el.style.lineHeight = "13px";
  el.getBoundingClientRect = rect(300, 13, 20, 120);
}

test("resume focus zoom: a small field zooms the sheet while editing (glyphs ≥ 14 px); «Tayyor» brings fit back", async () => {
  phone();
  await mount(stubResume(), true);
  await enableEdit();
  assert.equal(zoomLabel(), "100%");
  const name = byPath("identity.fullName", "[data-resume-editor]");
  smallField(name);
  await openField(name);
  assert.equal(zoomLabel(), "140%", "10 px glyphs → 140 %");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await settle();
  assert.equal(zoomLabel(), "140%", "restore waits for the double-tap window");
  await quiet();
  assert.equal(zoomLabel(), "100%", "fit restored");
});

test("resume focus zoom restores the user's own zoom (manual), not fit; desktop never zooms", async () => {
  phone();
  await mount(stubResume(), true);
  await enableEdit();
  await act(async () => {
    fireEvent.click(document.querySelector("[data-zoom-inline] [aria-label='Kattalashtirish']")!);
  });
  const manual = zoomLabel();
  assert.notEqual(manual, "100%");
  const name = byPath("identity.fullName", "[data-resume-editor]");
  smallField(name);
  await openField(name);
  assert.equal(zoomLabel(), "140%");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Bekor"));
  });
  await quiet();
  assert.equal(zoomLabel(), manual, "manual zoom back");
  cleanup();
  delete win.matchMedia;
  await mount(stubResume(), true);
  await enableEdit();
  const n2 = byPath("identity.fullName", "[data-resume-editor]");
  smallField(n2);
  await openField(n2);
  assert.equal(zoomLabel(), "100%", "desktop: no focus zoom");
});

test("Word sheet: the same focus zoom on a phone", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  const el = byPath(HOMEWORK);
  smallField(el);
  await openField(el);
  assert.equal(zoomLabel(), "140%");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await quiet();
  assert.equal(zoomLabel(), "100%");
});

test("review E2: a «−/+» during the edit is kept — the restore does not jump back to the pre-edit zoom", async () => {
  phone();
  await mount(stubResume(), true);
  await enableEdit();
  const name = byPath("identity.fullName", "[data-resume-editor]");
  smallField(name);
  await openField(name);
  assert.equal(zoomLabel(), "140%");
  await act(async () => {
    fireEvent.click(document.querySelector("[data-zoom-inline] [aria-label='Kattalashtirish']")!);
  });
  const chosen = zoomLabel();
  assert.notEqual(chosen, "140%");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await quiet();
  assert.equal(zoomLabel(), chosen, "the user's own zoom stays");
});

test("docFocusZoom: glyphs to 14 px, wrapping fields capped at the column width, max 200 %, never zooms out", () => {
  assert.equal(docFocusZoom({ fontPx: 10, boxW: 100, viewW: 360, base: 0.46 }), 1.4, "inline field: 14 px glyphs");
  assert.equal(docFocusZoom({ fontPx: 13.3, boxW: 600, viewW: 340, base: 0.43 }), Math.round((340 / 600) * 1000) / 1000, "block field: column width");
  assert.equal(docFocusZoom({ fontPx: 18.67, boxW: 624, viewW: 366, base: 0.46 }), Math.round((366 / 624) * 1000) / 1000, "one-line caption is a block too (smoke)");
  assert.equal(docFocusZoom({ fontPx: 5, boxW: 50, viewW: 360, base: 0.46 }), 2, "cap");
  assert.equal(docFocusZoom({ fontPx: 10, boxW: 100, viewW: 360, base: 1.5 }), 1.5, "already readable");
  assert.equal(docFocusZoom({ fontPx: 13.3, boxW: 900, viewW: 340, base: 0.43 }), 0.43, "never below base");
});

/* ═══════════════════════════════════════ double tap */

function tap(el: HTMLElement, id: number) {
  fireEvent.pointerDown(el, { pointerType: "touch", pointerId: id, isPrimary: true, clientX: 40, clientY: 40 });
  fireEvent.pointerUp(el, { pointerType: "touch", pointerId: id, isPrimary: true, clientX: 40, clientY: 40 });
}

test("touch double TAP opens a field without `dblclick` (Word and resume); a single tap does not", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  const el = byPath(HOMEWORK);
  await act(async () => tap(el, 1));
  assert.ok(!el.hasAttribute("contenteditable"), "one tap: nothing");
  await act(async () => tap(el, 2));
  assert.equal(el.getAttribute("contenteditable"), "true", "double tap opened it");
  assert.ok(document.activeElement === el);
  cleanup();
  await mount(stubResume(), true);
  await enableEdit();
  const name = byPath("identity.fullName", "[data-resume-editor]");
  await act(async () => tap(name, 3));
  await act(async () => tap(name, 4));
  assert.equal(name.getAttribute("contenteditable"), "true");
});

test("double-tap echo (Chromium smoke): the compat mousedown is cancelled and the late dblclick does not open another field", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  const el = byPath(HOMEWORK);
  await act(async () => tap(el, 11));
  await act(async () => tap(el, 12));
  assert.equal(el.getAttribute("contenteditable"), "true");
  // The browser's compat mousedown lands elsewhere after the focus zoom: it must not blur the new field.
  assert.equal(fireEvent.mouseDown(document.body), false, "compat mousedown cancelled");
  // …and its synthetic dblclick (also elsewhere) must not open another field.
  const other = byPath("heading:goal");
  await act(async () => {
    fireEvent.dblClick(other);
  });
  assert.ok(!other.hasAttribute("contenteditable"), "echo dblclick ignored");
  assert.equal(el.getAttribute("contenteditable"), "true", "the tapped field stays open");
  assert.equal(fireEvent.mouseDown(document.body), true, "only ONE mousedown is swallowed");
});

test("review E1: double TAP on field B while A is open → A saved once, B open; the zoom does not jump between the taps", async () => {
  phone();
  await mount(stubResume(), true);
  await enableEdit();
  const a = byPath("identity.fullName", "[data-resume-editor]");
  smallField(a);
  // Touch taps, not `dblclick`: a dblclick right after the previous test's tap-open is treated as its echo.
  await act(async () => tap(a, 19));
  await act(async () => tap(a, 20));
  await settle();
  assert.equal(a.getAttribute("contenteditable"), "true");
  // The browser's compat mousedown of A's own second tap (consumes the opening swallow).
  fireEvent.mouseDown(a);
  assert.equal(zoomLabel(), "140%");
  a.textContent = "Avval saqlanadi";
  const b = byPath("identity.headline", "[data-resume-editor]");
  smallField(b);
  // First tap on B: its compat mousedown is cancelled, so A keeps the focus — no blur, no commit, no re-render under the finger.
  // No waits between the taps: the detector's 300 ms window must not depend on machine load.
  await act(async () => {
    tap(b, 21);
  });
  assert.equal(fireEvent.mouseDown(b), false, "first tap's compat mousedown cancelled");
  assert.equal(a.getAttribute("contenteditable"), "true", "A still open after one tap on B");
  assert.ok(!saveBtn(), "nothing committed yet");
  assert.equal(zoomLabel(), "140%", "sheet unchanged under the finger");
  // Second tap, inside the double-tap window.
  await act(async () => tap(b, 22));
  assert.equal(b.getAttribute("contenteditable"), "true", "B opened by the double tap");
  await quiet();
  assert.equal(zoomLabel(), "140%", "B open: zoom kept after the window");
  assert.match(saveBtn()?.textContent ?? "", /· 1\b/, "exactly one op for A");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  await quiet();
  assert.equal(zoomLabel(), "100%", "restored after the last edit");
});

test("review E1 (Word sheet): a double tap on B with A open → A saved once, B open", async () => {
  phone();
  await mount(stubTeacher());
  await enableEdit();
  const a = byPath(HOMEWORK);
  await act(async () => tap(a, 51));
  await act(async () => tap(a, 52));
  assert.equal(a.getAttribute("contenteditable"), "true");
  fireEvent.mouseDown(a);
  a.textContent = "Word: avval saqlanadi.";
  const b = byPath("heading:goal");
  await act(async () => tap(b, 53));
  assert.equal(fireEvent.mouseDown(b), false, "first tap's compat mousedown cancelled");
  assert.equal(a.getAttribute("contenteditable"), "true", "A kept open by one tap on B");
  await act(async () => tap(b, 54));
  assert.equal(b.getAttribute("contenteditable"), "true", "B open");
  assert.match(saveBtn()?.textContent ?? "", /· 1\b/, "A committed once");
});

test("review E1 fallback: if the browser still blurs A on the first tap, the zoom waits and the second tap opens B", async () => {
  phone();
  await mount(stubResume(), true);
  await enableEdit();
  const a = byPath("identity.fullName", "[data-resume-editor]");
  smallField(a);
  await act(async () => tap(a, 41));
  await act(async () => tap(a, 42));
  await settle();
  a.textContent = "Blur bilan saqlandi";
  const b = byPath("identity.headline", "[data-resume-editor]");
  await act(async () => {
    tap(b, 43);
    fireEvent.focusOut(a);
  });
  assert.ok(!a.hasAttribute("contenteditable"), "A committed by the blur");
  assert.equal(zoomLabel(), "140%", "no restore while a double tap may be in progress");
  await act(async () => tap(b, 44));
  assert.equal(b.getAttribute("contenteditable"), "true", "B opened");
  assert.match(saveBtn()?.textContent ?? "", /· 1\b/);
});

test("review E1: a finger still down pauses the restore; it runs 300 ms after the finger lifts", async () => {
  phone();
  await mount(stubResume(), true);
  await enableEdit();
  const a = byPath("identity.fullName", "[data-resume-editor]");
  smallField(a);
  await act(async () => tap(a, 31));
  await act(async () => tap(a, 32));
  await settle();
  assert.equal(zoomLabel(), "140%");
  await act(async () => {
    fireEvent.click(within(bar()!).getByText("Tayyor"));
  });
  const b = byPath("identity.headline", "[data-resume-editor]");
  await act(async () => {
    fireEvent.pointerDown(b, { pointerType: "touch", pointerId: 33, isPrimary: true, clientX: 40, clientY: 40 });
  });
  await quiet();
  assert.equal(zoomLabel(), "140%", "finger down: no restore under it");
  await act(async () => {
    fireEvent.pointerUp(b, { pointerType: "touch", pointerId: 33, isPrimary: true, clientX: 40, clientY: 40 });
  });
  await settle();
  assert.equal(zoomLabel(), "140%", "just lifted: still waiting");
  await quiet();
  assert.equal(zoomLabel(), "100%", "restored after the quiet window");
});

/* ═══════════════════════════════════════ toolbar touch sizes */

test("viewer toolbar on touch: 44 px row, hit-44 on row icons and view toggle, real 44 px zoom controls", () => {
  render(
    h(ViewerToolbar, { zoom: 46, onZoom() {}, page: 1, pages: 3, onPage() {}, onFit() {}, sticky: true, view: "page", onView() {}, right: h("span", null, "x") }),
  );
  const bar = document.querySelector("[data-viewer-toolbar]")!;
  assert.ok(classes(bar).includes("pointer-coarse:h-11"), "row 44 px on touch");
  assert.ok(classes(bar).includes("h-10"), "desktop row unchanged");
  for (const l of ["Oldingi sahifa", "Keyingi sahifa", "Boshqa amallar"]) assert.ok(classes(screen.getByLabelText(l)).includes("hit-44"), `${l}: hit-44`);
  // Review E3: the two segments are 4 px apart — real 44 px height, not overlapping `.hit-44` areas.
  for (const t of ["O‘qish", "Varaq"]) {
    const c = classes(screen.getByText(t));
    assert.ok(c.includes("pointer-coarse:min-h-11") && !c.includes("hit-44"), `${t}: real 44 px`);
  }
  for (const l of ["Kichraytirish", "Kattalashtirish"]) {
    const c = classes(screen.getByLabelText(l));
    assert.ok(c.includes("pointer-coarse:min-h-11") && c.includes("pointer-coarse:min-w-11"), `${l}: 44 px`);
  }
  assert.ok(classes(screen.getByText("46%")).includes("pointer-coarse:min-h-11"));
});
