import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act, useState } from "react";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
import { EditActions, type EditActionsState } from "../../components/files/EditActions.tsx";
import { ResultView } from "../../components/files/ResultView.tsx";
import { EDIT_MODE_HINT, SAVE_PROMPT_TEXT } from "../../components/viewers/slide-edit/EditModeRow.tsx";
import { EDIT_HINT_TEXT } from "../../components/viewers/slide-edit/EditHint.tsx";
import { applyDocOps, type DocOp } from "../../lib/generation/slide-edit.ts";
import { sampleWorkDoc } from "../../lib/generation/work/samples.ts";
import { sampleResume } from "../../lib/generation/resume/samples.ts";
import { docFromResume } from "../../lib/generation/resume/model.ts";
import { useAppStore } from "../../lib/store.ts";
import * as nav from "../../lib/nav/history.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * EXPLICIT EDIT MODE of the slide viewer (owner request 2026-11-12:
 * «Tahrirlash» on the opened slide; a simple user must understand editing)
 * and the `?edit=1` entry the bot's «Tahrirlash» button uses.
 *
 * Contract (docs/viewer/PLAN.md «Explicit edit mode»):
 *  - view mode (default): a clean viewer — a single click/tap on a text does
 *    nothing, no outlines, no image/answer controls; double click / double
 *    tap is the shortcut into edit mode on that text;
 *  - «Tahrirlash» → `data-slide-edit-mode="on"`: every editable box outlined,
 *    «Matnni bosing va yozing», one click/tap opens a text; nothing is
 *    auto-focused;
 *  - «Tayyor» commits the open text and leaves; unsaved changes → the row
 *    says «O‘zgarishlarni saqlang» (own «Saqlash») and the header button is
 *    highlighted — never auto-saved, never dropped;
 *  - persists across slides; no toggle in presentation / live / passive;
 *  - phone: the labelled pill under the stage, single tap opens, Back closes
 *    the open text first, then leaves edit mode;
 *  - `?edit=1`: slide / Word / resume start in edit mode, the param leaves
 *    the URL, non-editable documents ignore it.
 */

const observers: { cb: () => void; el: Element }[] = [];
(globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
  cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
  }
  observe(el: Element) {
    observers.push({ cb: this.cb, el });
  }
  unobserve() {}
  disconnect() {
    for (let k = observers.length - 1; k >= 0; k--) if (observers[k].cb === this.cb) observers.splice(k, 1);
  }
};
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
/** A 390 px phone: coarse pointer, < md. */
const phone = () => stubMedia((q) => q.includes("pointer: coarse") || q.includes("max-width: 767px"));

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  observers.length = 0;
  delete win.matchMedia;
  globalThis.fetch = realFetch;
  try {
    window.localStorage.clear();
  } catch {
    // ignore
  }
});

const GEN_ID = "gen1";
const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh" },
  { id: "s1", layout: "bullets", title: "Birinchi", bullets: ["Bir", "Ikki"], footer: "Aliyev · TDPU" },
  { id: "s2", layout: "bullets", title: "Ikkinchi", bullets: ["Uch"] },
];
function makeDoc(list: SlideModel[] = slides): AcademicDoc {
  return {
    meta: { topic: "Mavzu", author: "Aliyev", workLabel: "Taqdimot", language: "uz", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides: list,
  } as unknown as AcademicDoc;
}

type Server = { calls: { url: string; method: string; body: Record<string, unknown> | null }[]; doc: AcademicDoc; version: number };
function generation(s: Server) {
  return { id: GEN_ID, type: "slide", status: "COMPLETED", doc: s.doc, docVersion: s.version, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}
function stubServer(init: AcademicDoc = makeDoc()): Server {
  const s: Server = { calls: [], doc: init, version: 1 };
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? (JSON.parse(opts.body) as Record<string, unknown>) : null;
    s.calls.push({ url, method, body });
    if (method === "PATCH" && url.endsWith("/doc")) {
      const res = applyDocOps(s.doc, (body?.ops ?? []) as DocOp[], { genId: GEN_ID });
      if (!res.ok) return json(422, { error: res.error });
      s.doc = res.doc;
      s.version += 1;
      return json(200, { generation: generation(s) });
    }
    if (method === "POST" && url.endsWith("/rebuild")) return json(200, { fileVersion: s.version, docVersion: s.version, rebuilt: true });
    return json(200, { generation: generation(s) });
  }) as typeof fetch;
  return s;
}

function Page({ doc, gen, initialEdit, live }: { doc: AcademicDoc; gen?: unknown; initialEdit?: boolean; live?: unknown }) {
  const [st, setSt] = useState<EditActionsState | null>(null);
  return h("div", null, h(EditActions, { state: st }), h(SlideViewer, { doc, gen, onEditState: setSt, initialEdit, live }));
}
function open(s: Server, extra: { initialEdit?: boolean } = {}) {
  render(h(Page, { doc: s.doc, gen: generation(s), ...extra }));
}

const root = () => document.querySelector("[data-slide-edit-mode]") as HTMLElement | null;
const mode = () => root()?.getAttribute("data-slide-edit-mode") ?? null;
const toggle = () => document.querySelector("[data-slide-edit-toggle]") as HTMLButtonElement | null;
const frame = () => document.querySelector("[data-slide-frame]") as HTMLElement;
function stage(sel: string): HTMLElement {
  const el = frame().querySelector(sel);
  assert.ok(el, `stage: ${sel}`);
  return el as HTMLElement;
}
const titleEl = () => stage(`[data-src='{"f":"title"}']`);
const boxOpen = () => screen.queryByLabelText("Matnni tahrirlash") !== null;
const box = () => screen.getByLabelText("Matnni tahrirlash");
const saveBtn = () => screen.queryByText(/^Saqlash · /);
const targets = () => frame().querySelectorAll("[data-slide-edit-target]:not([data-slide-edit-target='image'])");
/** Editable text layers on the STAGE slide (single fields + whole lists). */
function editableLayers(): number {
  const lists = frame().querySelectorAll("[data-src-list]").length;
  const singles = Array.from(frame().querySelectorAll("[data-src]")).filter((el) => !el.closest("[data-src-list]")).length;
  return lists + singles;
}
function pause(ms: number) {
  return act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

// ═══════════════════════════════════════ desktop

test("view mode: single click on a text opens nothing; no outlines; toggle off", () => {
  const s = stubServer();
  open(s);
  assert.equal(mode(), "off");
  assert.equal(toggle()!.getAttribute("aria-pressed"), "false");
  assert.equal(toggle()!.textContent, "Tahrirlash");
  fireEvent.mouseDown(titleEl());
  fireEvent.click(titleEl());
  assert.ok(!boxOpen(), "a clean viewer: one click does not edit");
  assert.equal(targets().length, 0);
  assert.ok(!document.querySelector("[data-slide-edit-row]"), "desktop view mode: no row under the stage");
});

test("«Tahrirlash» enters edit mode: root on, every editable box outlined, hint shown, nothing auto-focused", () => {
  const s = stubServer();
  open(s);
  fireEvent.click(toggle()!);
  // MUTATION: `editMode` ignored for `data-slide-edit-mode` → stays "off".
  assert.equal(mode(), "on");
  assert.equal(toggle()!.getAttribute("aria-pressed"), "true");
  assert.equal(toggle()!.textContent, "Tayyor", "the button turns into «Tayyor»");
  const n = editableLayers();
  assert.ok(n >= 2);
  assert.equal(targets().length, n, "one outline per editable text box of the slide");
  assert.ok(screen.getByText(EDIT_MODE_HINT), "«Matnni bosing va yozing»");
  assert.equal(document.querySelector("[data-slide-edit-row]")!.getAttribute("data-slide-edit-row"), "edit");
  assert.ok(!boxOpen(), "no text is auto-opened (decision: the user picks what to change)");
});

test("edit mode: single click opens the text; «Tayyor» commits it, leaves, and asks to save (no auto-PATCH)", async () => {
  const s = stubServer();
  open(s);
  fireEvent.click(toggle()!);
  fireEvent.click(titleEl());
  assert.ok(boxOpen(), "single click opened the title");
  box().textContent = "Yangi muqova";
  // Pressing «Tayyor»: mousedown outside the slide, then the click.
  fireEvent.mouseDown(toggle()!);
  fireEvent.click(toggle()!);
  assert.equal(mode(), "off", "left edit mode");
  assert.ok(!boxOpen());
  assert.equal(saveBtn()?.textContent, "Saqlash · 1", "the text became one pending op");
  await pause(300);
  assert.equal(s.calls.length, 0, "never auto-saved");
  // MUTATION: drop `setRemind(true)` in `exitEdit` → no prompt, no highlight.
  assert.ok(screen.getByText(new RegExp(`^${SAVE_PROMPT_TEXT} · 1$`)), "save prompt");
  assert.ok(saveBtn()!.closest("button")!.hasAttribute("data-edit-attention"), "header «Saqlash · N» highlighted");
  await act(async () => {
    fireEvent.click(document.querySelector("[data-slide-save-prompt-save]") as HTMLElement);
  });
  await pause(50);
  assert.equal(s.calls.filter((c) => c.method === "PATCH").length, 1, "the prompt's «Saqlash» saved");
  assert.equal(s.doc.slides?.[0].title, "Yangi muqova");
  assert.ok(!document.querySelector("[data-slide-save-prompt]"), "prompt gone after saving");
});

test("«Tayyor» with nothing changed: no save prompt", () => {
  const s = stubServer();
  open(s);
  fireEvent.click(toggle()!);
  fireEvent.click(toggle()!);
  assert.equal(mode(), "off");
  assert.ok(!document.querySelector("[data-slide-save-prompt]"));
  assert.ok(!document.querySelector("[data-slide-edit-row]"));
});

test("double click in view mode is the shortcut: enters edit mode on that text", () => {
  const s = stubServer();
  open(s);
  fireEvent.doubleClick(titleEl());
  assert.equal(mode(), "on");
  assert.equal(box().textContent, "Muqova");
});

test("edit mode persists across slide changes (arrows and thumbnails); outlines follow the slide", () => {
  const s = stubServer();
  open(s);
  fireEvent.click(toggle()!);
  fireEvent.click(screen.getByLabelText("Keyingi sahifa"));
  assert.equal(mode(), "on");
  assert.equal(targets().length, editableLayers(), "outlines of slide 2");
  fireEvent.click(document.querySelectorAll("[data-thumb-index]")[2]);
  assert.equal(mode(), "on");
  fireEvent.click(stage(`[data-src='{"f":"title"}']`));
  assert.equal(box().textContent, "Ikkinchi", "single click works on the new slide");
});

test("Escape (no text open) leaves edit mode", () => {
  const s = stubServer();
  open(s);
  fireEvent.click(toggle()!);
  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.equal(mode(), "off");
});

test("presentation pauses edit mode (no toggle, no edit layer); leaving it comes back to edit mode", async () => {
  const s = stubServer();
  open(s);
  fireEvent.click(toggle()!);
  await act(async () => {
    fireEvent.click(screen.getByLabelText("To‘liq ekran"));
  });
  assert.ok(!toggle(), "no toggle in the presentation");
  assert.ok(!document.querySelector("[data-slide-editor]"));
  assert.equal(mode(), "off");
  await act(async () => {
    fireEvent.keyDown(document.body, { key: "Escape" });
  });
  assert.equal(mode(), "on");
});

test("live generation and the passive viewer have no toggle; initialEdit is ignored there", () => {
  const doc = makeDoc();
  const live = {
    stage: "text",
    meta: doc.meta,
    theme: "atlas",
    template: "lecture",
    progress: 20,
    step: "Matn yozilmoqda",
    roles: ["Muqova", "Kirish", "Xulosa"],
    slides,
    written: [0],
    final: false,
    imageWait: [],
    images: { got: 0, want: 0 },
  };
  render(h(Page, { doc, live, initialEdit: true }));
  assert.ok(!toggle() && !root(), "live: no edit mode");
  cleanup();
  render(h(Page, { doc, initialEdit: true }));
  assert.ok(!toggle() && !root(), "passive: no edit mode");
});

test("toggle a11y: aria-pressed, visible focus ring, label not colour-only", () => {
  const s = stubServer();
  open(s);
  const t = toggle()!;
  assert.ok(t.className.includes("focus-visible:ring-2"));
  assert.ok(t.querySelector("svg"), "icon + text label");
  fireEvent.click(t);
  assert.equal(toggle()!.getAttribute("aria-pressed"), "true");
});

// ═══════════════════════════════════════ phone

async function sizeStage() {
  const el = document.querySelector("[data-slide-stage]") as HTMLElement;
  Object.defineProperty(el, "clientWidth", { value: 390, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 219, configurable: true });
  await act(async () => {
    for (const o of [...observers]) if (o.el === el) o.cb();
  });
}
function tap(el: HTMLElement, id: number) {
  const at = { clientX: 50, clientY: 40 };
  fireEvent.pointerDown(el, { pointerType: "touch", pointerId: id, isPrimary: true, ...at });
  fireEvent.pointerUp(el, { pointerType: "touch", pointerId: id, isPrimary: true, ...at });
  fireEvent.touchEnd(el, { cancelable: true });
}

test("phone: a labelled 44 px «Tahrirlash» pill under the stage (not in the toolbar); reworded one-time hint", async () => {
  phone();
  const s = stubServer();
  open(s);
  await sizeStage();
  const t = toggle()!;
  assert.equal(t.getAttribute("data-slide-edit-toggle"), "pill");
  assert.ok(!document.querySelector("[data-slide-toolbar]")!.contains(t), "not in the crowded toolbar");
  assert.ok(!document.querySelector("[data-slide-stage]")!.contains(t), "never over the slide");
  assert.ok(document.querySelector("[data-slide-edit-row]")!.contains(t));
  assert.ok(t.className.split(/\s+/).includes("h-11"), "44 px");
  assert.equal(t.textContent, "Tahrirlash", "label visible");
  assert.ok(screen.getByText(EDIT_HINT_TEXT), "hint points at the button");
  assert.match(EDIT_HINT_TEXT, /«Tahrirlash»/);
  fireEvent.click(t);
  assert.equal(mode(), "on");
  assert.ok(!screen.queryByText(EDIT_HINT_TEXT), "entering edit mode = hint learned");
  assert.ok(!boxOpen(), "phone: nothing focused — the keyboard must not cover the slide");
});

test("phone: one tap opens a text in edit mode; one tap in view mode does nothing", async () => {
  phone();
  const s = stubServer();
  open(s);
  await sizeStage();
  tap(titleEl(), 1);
  assert.ok(!boxOpen(), "view mode: a tap is just a tap");
  fireEvent.click(toggle()!);
  tap(titleEl(), 2);
  assert.ok(boxOpen(), "edit mode: one tap opens");
  assert.ok(document.activeElement === box(), "focused inside the gesture");
});

test("phone back: closes the open text first (commit), then leaves edit mode, then the page stays", async () => {
  phone();
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/files/1");
  nav.installNav();
  const s = stubServer();
  open(s);
  await sizeStage();
  await act(async () => {
    fireEvent.click(toggle()!);
  });
  await pause(20);
  await act(async () => {
    tap(titleEl(), 1);
  });
  await pause(20);
  box().textContent = "Orqaga";
  window.history.back();
  await pause(40);
  assert.ok(!boxOpen(), "first back ended the text edit");
  assert.equal(mode(), "on", "…and only the text");
  assert.equal(saveBtn()?.textContent, "Saqlash · 1", "committed, not dropped");
  // MUTATION: remove the `OverlayHistoryLayer` → back leaves the page instead.
  window.history.back();
  await pause(40);
  assert.equal(mode(), "off", "second back left edit mode");
  assert.equal(window.location.pathname, "/uz/files/1", "still on the page");
});

test("phone back after the double-tap shortcut (mode + text in ONE commit): text first, then mode", async () => {
  phone();
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz/files/2");
  nav.installNav();
  const s = stubServer();
  open(s);
  await sizeStage();
  await act(async () => {
    tap(titleEl(), 1);
    tap(titleEl(), 2);
  });
  await pause(20);
  assert.equal(mode(), "on");
  assert.ok(boxOpen());
  window.history.back();
  await pause(40);
  assert.ok(!boxOpen(), "back closed the text");
  assert.equal(mode(), "on", "edit mode is the lower layer");
  window.history.back();
  await pause(40);
  assert.equal(mode(), "off");
  assert.equal(window.location.pathname, "/uz/files/2");
});

// ═══════════════════════════════════════ ?edit=1 through ResultView

const ID = "33333333-3333-4333-8333-333333333333";
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
function resultGen(type: string, doc: AcademicDoc) {
  return {
    id: ID,
    type,
    topic: "Mavzu",
    status: "COMPLETED",
    createdAt: "2026-11-12T08:00:00.000Z",
    finishedAt: "2026-11-12T08:01:00.000Z",
    price: 3000,
    fileName: "fayl",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    preview: null,
    html: null,
    doc,
    hasFile: true,
    hasPrev: false,
    docVersion: 1,
    fileVersion: 1,
    imageRedraws: 0,
  };
}
function mountResult(g: ReturnType<typeof resultGen>, search: string) {
  nav.__resetNavForTests();
  window.history.replaceState(null, "", `/uz/files/${ID}${search}`);
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/session") return json(200, { user: null, features: null });
    if ((init?.method ?? "GET") === "GET" && url.startsWith(`/api/generations/${ID}`)) return json(200, { generation: g });
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: false, payme: false } },
    refreshSession: async () => {},
  });
  render(h(AppRouterContext.Provider, { value: router }, h(ResultView, { id: ID })));
}
const docToggle = () => document.querySelector("[data-edit-toggle]") as HTMLElement | null;

test("?edit=1 → slide viewer starts in edit mode; the param leaves the URL (other params stay)", async () => {
  mountResult(resultGen("slide", makeDoc()), "?edit=1&from=bot");
  await waitFor(() => assert.equal(mode(), "on"), { timeout: 5000 });
  assert.equal(targets().length, editableLayers(), "outlines drawn");
  // MUTATION: remove `clearEditQuery()` → the search still has edit=1.
  assert.equal(window.location.search, "?from=bot", "edit removed, nothing else touched");
  assert.equal(window.location.pathname, `/uz/files/${ID}`);
});

test("no ?edit → slide viewer opens in view mode", async () => {
  mountResult(resultGen("slide", makeDoc()), "");
  await waitFor(() => assert.equal(mode(), "off"), { timeout: 5000 });
});

test("?edit=1 → Word viewer (kurs ishi) starts with «Tahrirlash» pressed and edit targets on the sheet", async () => {
  const meta = { topic: "Adaptiv o‘qitish", workLabel: "Kurs ishi", language: "uz", toolId: "coursework" } as unknown as DocMeta;
  const doc = JSON.parse(JSON.stringify(sampleWorkDoc(meta))) as AcademicDoc;
  mountResult(resultGen("coursework", doc), "?edit=1");
  await waitFor(() => assert.equal(docToggle()?.getAttribute("aria-pressed"), "true"), { timeout: 5000 });
  assert.equal(docToggle()!.textContent, "Tayyor");
  await waitFor(() => assert.ok(document.querySelector("[data-page] [data-path]"), "edit targets"), { timeout: 5000 });
  assert.equal(window.location.search, "");
});

test("?edit=1 → resume viewer starts in edit mode", async () => {
  const meta = { topic: "Moliya tahlilchisi", author: "Karimova Dilnoza", workLabel: "Rezyume", language: "uz", toolId: "resume" } as unknown as DocMeta;
  mountResult(resultGen("resume", docFromResume(sampleResume("modern", undefined, false), meta)), "?edit=1");
  await waitFor(() => assert.equal(docToggle()?.getAttribute("aria-pressed"), "true"), { timeout: 5000 });
  await waitFor(() => assert.ok(document.querySelector("[data-resume-editor] [data-path]"), "edit targets"), { timeout: 5000 });
  assert.equal(window.location.search, "");
});

test("?edit=1 on a non-editable document (old-format deck) is ignored and still removed", async () => {
  const legacy = {
    meta: { topic: "Eski hujjat", author: "Aliyev", workLabel: "Taqdimot" },
    titlePage: false,
    toc: false,
    sections: [{ id: "k1", title: "Kirish", blocks: [{ kind: "p", text: "Matn." }] }],
  } as unknown as AcademicDoc;
  mountResult(resultGen("slide", legacy), "?edit=1");
  await waitFor(() => assert.ok(document.querySelector("[data-slide-stage]")), { timeout: 5000 });
  assert.ok(!root() && !toggle(), "no edit mode on a deck that cannot be edited");
  assert.equal(window.location.search, "");
});
