import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { ViewerToolbar } from "../../components/viewers/toolbar.tsx";
import {
  DOC_VIEW_KEY,
  NARROW_QUERY,
  defaultDocView,
  detectPhone,
  initialDocView,
  isPhone,
  readDocView,
  writeDocView,
} from "../../components/viewers/reading/prefs.ts";
import { READING_CSS, readingVars } from "../../components/viewers/reading/ReadingView.tsx";
import { readingSections } from "../../components/viewers/reading/sections.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import { sampleWorkDoc } from "../../lib/generation/work/samples.ts";
import { sampleTeacherDoc } from "../../lib/generation/teacher/samples.ts";
import { sampleGameDoc } from "../../lib/generation/games/samples.ts";
import { TEACHER_KINDS } from "../../lib/generation/teacher/types.ts";
import { GAME_KINDS } from "../../lib/generation/games/types.ts";
import { docToFlow, type FlowItem } from "../../lib/viewers/flow.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * «O‘qish / Varaq» (viewer polish V5a, owner decision in docs/viewer/PLAN.md
 * «Phase 2»): phones open paged documents in a reflowed reading mode built
 * from the SAME flow items and block renderers as the sheets; one toggle
 * switches to the exact A4 view, where editing and printing happen.
 *
 * jsdom has no layout: the viewport (`matchMedia`), measured heights and
 * observers are stubbed.
 *
 * Mutations (each turned a test red):
 *   1. `defaultDocView`: `phone ? "reading" : "page"` → `"page"` → «phone opens O‘qish».
 *   2. `isPhone`: `env.narrow ||` dropped → «phone opens O‘qish» and the truth table.
 *   3. `ScrollIf` returns the bare table → «every table is inside its own scroll block».
 *   4. `PageBody` game-grid wrapper removed → same test (game sheets).
 *   5. `editing` without `&& !reading` + toggle keeping `editOn` → «no editing affordances».
 */

/* ── environment stubs ── */
let narrow = false;
let coarse = false;
(window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = ((q: string) =>
  ({
    matches: q === NARROW_QUERY ? narrow : q === "(pointer: coarse)" ? coarse : false,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as never;

type IoRec = { cb: () => void; els: Element[] };
const ios: IoRec[] = [];
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
  rec: IoRec;
  constructor(cb: () => void) {
    this.rec = { cb, els: [] };
    ios.push(this.rec);
  }
  observe(el: Element) {
    this.rec.els.push(el);
  }
  unobserve() {}
  disconnect() {
    const i = ios.indexOf(this.rec);
    if (i >= 0) ios.splice(i, 1);
  }
  takeRecords() {
    return [];
  }
};
(window as unknown as Record<string, unknown>).innerHeight = 800;

const scrolled: Element[] = [];
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView = function (this: Element) {
  scrolled.push(this);
};
/** Reading section (`data-reading-page`) → rect; measuring-box items are 300 px tall so documents span pages. */
let sectionRects: Record<string, { top: number; bottom: number }> = {};
const realRect = window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const rect = (top: number, bottom: number) =>
    ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
  const p = this.getAttribute("data-reading-page");
  if (p) {
    const r = sectionRects[p] ?? { top: 0, bottom: 0 };
    return rect(r.top, r.bottom);
  }
  if (this.parentElement?.getAttribute("aria-hidden") === "true") return rect(0, 300);
  return realRect.call(this);
};

afterEach(() => {
  cleanup();
  narrow = false;
  coarse = false;
  sectionRects = {};
  scrolled.length = 0;
  window.localStorage.clear();
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

async function show(doc: AcademicDoc, extra: Record<string, unknown> = {}) {
  const r = render(h("div", { "data-viewer-frame": "flow" }, h(WordViewer, { doc, ...extra })));
  await settle();
  return r.container;
}

function readingView(c: HTMLElement): HTMLElement | null {
  return c.querySelector<HTMLElement>("[data-reading-view]");
}

function toggle(c: HTMLElement, label: "O‘qish" | "Varaq"): HTMLButtonElement {
  const btn = [...c.querySelectorAll<HTMLButtonElement>("[data-view-toggle] button")].find((b) => b.textContent === label);
  assert.ok(btn, `toggle «${label}» yo'q`);
  return btn;
}

function texts(root: Element | null, skip?: string): string[] {
  if (!root) return [];
  const out: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (skip && n.parentElement?.closest(skip)) continue;
    const t = (n.textContent ?? "").trim();
    if (t) out.push(t);
  }
  return out;
}

function measureBox(c: HTMLElement): HTMLElement {
  const box = c.querySelector<HTMLElement>('div[aria-hidden="true"][class*="-left-[12000px]"]');
  assert.ok(box, "o'lchov qutisi yo'q");
  return box;
}

/* ── fixtures: every covered family ── */
const meta = (m: Record<string, unknown>) => m as unknown as DocMeta;
const ESSAY: AcademicDoc = {
  meta: meta({ topic: "Kitob o‘qishning foydasi", author: "N. Valiyeva", workLabel: "Insho", language: "uz", toolId: "essay", design: "nature" }),
  titlePage: false,
  toc: false,
  sections: [
    {
      id: "essay",
      title: "Kitob o‘qishning foydasi",
      blocks: [
        { kind: "quote", text: "So‘z — qalb kaliti" },
        { kind: "p", text: "Kitob o‘qish tafakkurni kengaytiradi va nutqni boyitadi." },
        { kind: "li", text: "Birinchi fikr" },
        { kind: "li", text: "Ikkinchi fikr" },
      ],
    },
  ],
} as unknown as AcademicDoc;

const FAMILIES: [string, () => AcademicDoc][] = [
  ["article", () => sampleArticleDoc(meta({ topic: "Sun’iy intellekt", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" }))],
  [
    "thesis",
    () => sampleArticleDoc(meta({ topic: "Sun’iy intellekt", author: "K", workLabel: "Tezis", language: "uz", toolId: "thesis" }), { type: "conference_thesis" }),
  ],
  ["essay", () => ESSAY],
  ["coursework", () => sampleWorkDoc(meta({ topic: "Adaptiv o‘qitish", workLabel: "Kurs ishi", language: "uz", toolId: "coursework" }))],
  ["referat", () => sampleWorkDoc(meta({ topic: "Adaptiv o‘qitish", workLabel: "Referat", language: "uz", toolId: "referat" }), { genre: "referat" })],
  ["mustaqil-ish", () => sampleWorkDoc(meta({ topic: "Adaptiv o‘qitish", workLabel: "Mustaqil ish", language: "uz", toolId: "mustaqil-ish" }))],
  ...TEACHER_KINDS.map((k): [string, () => AcademicDoc] => [`teacher:${k}`, () => sampleTeacherDoc(k)]),
  ...GAME_KINDS.map((k): [string, () => AcademicDoc] => [`game:${k}`, () => sampleGameDoc(k)]),
];

/* ═════════ default mode and persistence ═════════ */

test("isPhone / defaultDocView: narrow viewport or a touch device with a phone-sized screen reads; a stored choice wins", () => {
  assert.equal(isPhone({ narrow: true, coarse: false, screenMin: 0 }), true);
  assert.equal(isPhone({ narrow: false, coarse: true, screenMin: 390 }), true, "phone in landscape (844×390)");
  assert.equal(isPhone({ narrow: false, coarse: true, screenMin: 768 }), false, "tablet");
  assert.equal(isPhone({ narrow: false, coarse: false, screenMin: 390 }), false, "small desktop window is narrow-checked, not screen-checked");
  assert.equal(isPhone({ narrow: false, coarse: true, screenMin: 0 }), false, "unknown screen");
  assert.equal(defaultDocView(null, true), "reading");
  assert.equal(defaultDocView(null, false), "page");
  assert.equal(defaultDocView("page", true), "page");
  assert.equal(defaultDocView("reading", false), "reading");
});

test("detectPhone / initialDocView read the viewport and the stored choice", () => {
  narrow = true;
  assert.equal(detectPhone(), true);
  assert.equal(initialDocView(), "reading");
  narrow = false;
  assert.equal(detectPhone(), false);
  assert.equal(initialDocView(), "page");
  writeDocView("reading");
  assert.equal(readDocView(), "reading");
  assert.equal(initialDocView(), "reading");
  window.localStorage.setItem(DOC_VIEW_KEY, "garbage");
  assert.equal(readDocView(), null);
});

test("prefs survive a throwing localStorage (private window, blocked storage)", () => {
  const ls = Object.getOwnPropertyDescriptor(window, "localStorage")!;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  try {
    assert.equal(readDocView(), null);
    assert.doesNotThrow(() => writeDocView("page"));
    narrow = true;
    assert.equal(initialDocView(), "reading");
  } finally {
    Object.defineProperty(window, "localStorage", ls);
  }
});

test("phone (< 640 px) opens «O‘qish»; desktop opens «Varaq»", async () => {
  const doc = FAMILIES[0][1]();
  narrow = true;
  let c = await show(doc);
  assert.ok(readingView(c), "telefonda o'qish rejimi yo'q");
  assert.equal(c.querySelector("[data-view-toggle]")?.getAttribute("data-view-mode"), "reading");
  assert.equal(toggle(c, "O‘qish").getAttribute("aria-pressed"), "true");
  cleanup();

  narrow = false;
  c = await show(doc);
  assert.ok(!readingView(c), "kompyuterda o'qish rejimi ochilmasligi kerak");
  assert.equal(toggle(c, "Varaq").getAttribute("aria-pressed"), "true");
  assert.ok(!c.querySelector(".viewer-workspace")?.classList.contains("hidden"), "varaqlar ko'rinishi kerak");
});

test("the toggle switches both ways and the choice is remembered per browser", async () => {
  const doc = FAMILIES[3][1]();
  narrow = true;
  let c = await show(doc);
  assert.ok(readingView(c));
  await act(async () => {
    fireEvent.click(toggle(c, "Varaq"));
  });
  assert.ok(!readingView(c), "Varaq bosilgach o'qish yopilmadi");
  assert.equal(window.localStorage.getItem(DOC_VIEW_KEY), "page");
  cleanup();

  // Same phone, next document: the stored «Varaq» wins over the phone default.
  c = await show(doc);
  assert.ok(!readingView(c), "saqlangan tanlov e'tiborsiz qoldi");
  await act(async () => {
    fireEvent.click(toggle(c, "O‘qish"));
  });
  assert.ok(readingView(c));
  assert.equal(window.localStorage.getItem(DOC_VIEW_KEY), "reading");
  cleanup();

  // Desktop with a stored «O‘qish» opens reading too.
  narrow = false;
  c = await show(doc);
  assert.ok(readingView(c));
});

/* ═════════ reading render, every family ═════════ */

for (const [name, make] of FAMILIES) {
  test(`${name}: reading mode renders the same flow — title, headings, lists, tables in their own scroll block`, async () => {
    const doc = make();
    const items = docToFlow(doc);
    writeDocView("reading");
    const c = await show(doc);
    const rv = readingView(c);
    assert.ok(rv, "o'qish rejimi yo'q");
    const article = rv.querySelector("article.reading-doc");
    assert.ok(article);

    // Title page from `titleModel` (the same TitlePage as the sheet).
    const title = rv.querySelector("[data-reading-title]");
    if (items.some((it) => it.type === "title")) {
      assert.ok(title, "titul yo'q");
      assert.ok((title.textContent ?? "").includes(doc.meta.topic), "titulda mavzu yo'q");
    } else assert.ok(!title, "titulsiz hujjatda titul paydo bo'ldi");

    // Headings keep their level, lists stay lists.
    const count = (t: FlowItem["type"]) => items.filter((it) => it.type === t).length;
    assert.ok(rv.querySelectorAll(".word-h2").length >= count("h2"), "h2 yo'qoldi");
    assert.ok(rv.querySelectorAll(".word-h3").length >= count("h3"), "h3 yo'qoldi");
    assert.ok(rv.querySelectorAll(".word-h1").length >= count("h1"), "h1 yo'qoldi");
    assert.equal(rv.querySelectorAll(".word-li").length, count("li"), "ro'yxat bandlari soni");

    // Every table (doc tables, game clue tables, card grids) scrolls inside its own block.
    const tables = [...rv.querySelectorAll("table")].filter((t) => !t.parentElement?.closest("table"));
    const expected = count("table-head") + count("game-clues") + count("game-cards");
    assert.equal(tables.length, expected, "jadvallar soni");
    for (const t of tables) {
      const box = t.closest("[data-reading-scroll]");
      assert.ok(box, "jadval o'z scroll blokida emas");
      assert.equal(box.getAttribute("role"), "region");
      assert.equal(box.getAttribute("tabindex"), "0");
    }
    // A table is ONE table in reading mode (no «davomi» split) and its caption stays outside the scroll block.
    const docTables = tables.filter((t) => t.classList.contains("word-table"));
    assert.equal(docTables.length, count("table-head"));
    assert.equal(docTables.reduce((n, t) => n + t.querySelectorAll("tbody > tr").length, 0), count("table-row"), "jadval qatorlari");
    for (const t of docTables) assert.ok(!t.closest("[data-reading-scroll]")!.querySelector(".word-table-caption"), "sarlavha scroll ichida");

    // «ko'rdim = oldim»: reading shows exactly the measured flow, word for word (title page aside).
    assert.deepEqual(texts(article, "[data-reading-title]"), texts(measureBox(c)), "o'qish matni varaq oqimidan farq qiladi");

    // Images and formulas sit inside the readable column.
    const figures = rv.querySelectorAll(".word-figure").length;
    assert.equal(figures, count("figure"));
  });
}

test("reading CSS: legible body, scroll blocks, images and formulas fit the width, dark mode", () => {
  const css = READING_CSS.replace(/\s+/g, " ");
  assert.match(css, /\.reading-shell \.reading-doc\{[^}]*font-size:17px/);
  assert.match(css, /\.reading-scroll\{[^}]*max-width:100%;overflow-x:auto/);
  assert.match(css, /\.reading-scroll--cols>table\{min-width:max\(100%,calc\(var\(--reading-cols,1\) \* 7\.5rem\)\)\}/);
  assert.match(css, /\.word-figure-img\{max-width:100%;height:auto/);
  assert.match(css, /\.word-formula-body\{[^}]*min-width:0;overflow-x:auto/);
  assert.match(css, /\.dark \.reading-shell \.reading-doc \.word-table :is\(th,td\)\{border-color:/);
  assert.match(css, /\.dark \.reading-shell \.reading-doc pre\{background:#26221c/);
  // Every rule is scoped to the reading wrapper: the sheet path never sees it.
  for (const rule of css.split("}").map((r) => r.trim()).filter(Boolean)) {
    assert.match(rule, /^(\.dark )?\.reading-shell \.reading-doc/, `scopsiz qoida: ${rule}`);
  }
  // Sheet margins/size do not carry over, the profile's variables do.
  assert.deepEqual(readingVars({ padding: "2cm", fontSize: "14pt", lineHeight: "1.5", "--doc-h1-align": "left" } as never), { "--doc-h1-align": "left" });
});

test("texnologik xarita (landscape) tables get a per-column minimum width, so they scroll instead of squeezing", async () => {
  writeDocView("reading");
  const c = await show(sampleTeacherDoc("map"));
  const boxes = [...c.querySelectorAll<HTMLElement>("[data-reading-view] [data-reading-scroll]")];
  assert.ok(boxes.length > 0);
  for (const b of boxes) {
    assert.ok(b.classList.contains("reading-scroll--cols"));
    const cols = Number(b.style.getPropertyValue("--reading-cols"));
    assert.equal(cols, b.querySelectorAll("table > colgroup > col").length || b.querySelector("tr")?.children.length);
  }
});

test("game cards keep a white paper sheet in dark mode; crossword clues scroll by columns", async () => {
  writeDocView("reading");
  let c = await show(sampleGameDoc("flashcards"));
  const paper = c.querySelectorAll("[data-reading-view] .reading-paper");
  assert.ok(paper.length > 0, "kartalar qog'oz blokida emas");
  cleanup();
  c = await show(sampleGameDoc("crossword"));
  assert.ok(c.querySelector("[data-reading-view] .reading-scroll--cols"), "savollar jadvali ustun kengligisiz");
});

/* ═════════ editing and printing only in «Varaq» ═════════ */

function editableGen(doc: AcademicDoc) {
  return { id: "gen-r1", type: doc.meta.toolId, status: "COMPLETED", doc, docVersion: 1, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

test("no editing affordances in «O‘qish»; «Varaq» shows the sheets with editing available", async () => {
  const doc = sampleWorkDoc(meta({ topic: "Adaptiv o‘qitish", workLabel: "Kurs ishi", language: "uz", toolId: "coursework" }));
  // Start in «Varaq» and switch editing ON, then go to reading: the edit layer must not survive.
  const c = await show(doc, { gen: editableGen(doc), onGen: () => {} });
  const edit = [...c.querySelectorAll("button")].find((b) => b.textContent === "Tahrirlash");
  assert.ok(edit, "Varaqda tahrir tugmasi bo'lishi kerak");
  await act(async () => {
    fireEvent.click(edit);
  });
  assert.ok(c.querySelector("[data-path]"), "tahrir nishonlari yoqilmadi");
  await act(async () => {
    fireEvent.click(toggle(c, "O‘qish"));
  });
  const rv = readingView(c);
  assert.ok(rv);
  assert.ok(![...c.querySelectorAll("button")].some((b) => b.textContent === "Tahrirlash"), "Tahrirlash o'qishda ko'rinmasligi kerak");
  for (const aria of ["Bekor qilish", "Qaytarish", "Kichraytirish", "Kattalashtirish"]) {
    assert.ok(!c.querySelector(`[aria-label="${aria}"]`), `${aria} o'qishda bo'lmasligi kerak`);
  }
  assert.ok(!c.querySelector("[data-path]"), "o'qishda tahrir nishonlari qoldi");
  assert.ok(!c.querySelector("[contenteditable]"));
  assert.ok(!c.querySelector("[data-viewer-more]"), "o'qishda yashiriladigan amal yo'q — menyu ham yo'q");

  await act(async () => {
    fireEvent.click(toggle(c, "Varaq"));
  });
  assert.ok(!readingView(c));
  assert.ok(c.querySelector(".word-sheet"), "varaq yo'q");
  assert.ok([...c.querySelectorAll("button")].some((b) => b.textContent === "Tahrirlash"), "Varaqda tahrir qaytmadi");
  assert.ok(!c.querySelector("[data-path]"), "tahrir o'z-o'zidan qayta yoqilmasligi kerak");
});

test("print uses «Varaq»: sheets stay mounted (hidden on screen, print:block), reading is no-print", async () => {
  writeDocView("reading");
  const c = await show(FAMILIES[4][1]());
  const ws = c.querySelector(".viewer-workspace");
  assert.ok(ws, "varaqlar foni yo'q");
  assert.ok(ws.classList.contains("hidden") && ws.classList.contains("print:block"), ws.className);
  assert.ok(ws.querySelectorAll(".word-sheet").length > 1, "bosma uchun varaqlar chizilmagan");
  assert.ok(readingView(c)?.classList.contains("no-print"));
  const globals = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(globals, /@media print \{\s*\.no-print \{\s*display: none !important;/);
});

/* ═════════ page counter in «O‘qish» ═════════ */

test("readingSections: items grouped by their file page; a table stays one block", () => {
  const T = { caption: "", headers: ["a", "b"], rows: [] };
  const items: FlowItem[] = [
    { type: "h1", id: "h", text: "H" },
    { type: "p", id: "p1", text: "x" },
    { type: "table-head", id: "t", table: T as never },
    { type: "table-row", id: "t:0", row: ["1", "2"] },
    { type: "table-row", id: "t:1", row: ["3", "4"] },
    { type: "p", id: "p2", text: "y" },
  ];
  const pages: FlowItem[][] = [
    [items[0], { ...items[1], id: "p1~0" } as FlowItem],
    [{ ...items[1], id: "p1~1" } as FlowItem, items[2], items[3]],
    [items[4]],
    [items[5]],
  ];
  const s = readingSections(items, pages);
  assert.deepEqual(
    s.map((x) => [x.page, x.items.map((i) => i.id)]),
    [
      [1, ["h", "p1"]],
      [2, ["t", "t:0", "t:1"]],
      [4, ["p2"]],
    ],
  );
  assert.deepEqual(readingSections(items, null).map((x) => x.page), [1]);
});

test("the counter shows the FILE page of the text in view; next/prev jump to it", async () => {
  writeDocView("reading");
  const c = await show(FAMILIES[3][1]());
  const secs = [...c.querySelectorAll<HTMLElement>("[data-reading-page]")];
  assert.ok(secs.length > 2, `bo'limlar: ${secs.length}`);
  const pages = secs.map((s) => Number(s.getAttribute("data-reading-page")));
  assert.deepEqual([...pages].sort((a, b) => a - b), pages, "bo'limlar tartibi");
  const target = pages[2];
  for (const p of pages) sectionRects[String(p)] = p === target ? { top: 100, bottom: 790 } : { top: 900, bottom: 1400 };
  await act(async () => {
    for (const r of [...ios]) r.cb();
  });
  const counter = c.querySelector("[data-page-counter]");
  assert.ok(counter);
  assert.match(counter.textContent ?? "", new RegExp(`^${target} / \\d+$`));
  assert.equal(counter.getAttribute("title"), "Fayldagi sahifa");

  await act(async () => {
    fireEvent.click(c.querySelector('[aria-label="Keyingi sahifa"]')!);
  });
  const hit = scrolled.at(-1);
  assert.ok(hit, "scrollIntoView chaqirilmadi");
  assert.ok(Number(hit.getAttribute("data-reading-page")) <= target + 1, "keyingi sahifa bo'limiga o'tmadi");
});

/* ═════════ toolbar: toggle + «Boshqa amallar» ═════════ */

function bar(props: Record<string, unknown>) {
  return render(
    h(ViewerToolbar, {
      zoom: 46,
      onZoom: () => {},
      page: 1,
      pages: 3,
      onPage: () => {},
      onFit: () => {},
      sticky: true,
      ...props,
    } as never),
  ).container;
}

test("toolbar: right-hand controls are container-collapsed (never a sideways scroller); counter and toggle always inline", () => {
  const right = h("button", { type: "button", "data-r": "1" }, "Tahrirlash");
  let c = bar({ right, view: "page", onView: () => {} });
  const tb = c.querySelector("[data-viewer-toolbar]")!;
  assert.ok(tb.classList.contains("@container"), "toolbar container query qutisi emas");
  assert.ok(!/overflow-x-auto/.test(tb.innerHTML.replace(/data-extra[^>]*>/g, "")), "toolbarda yon scroll qoldi");
  const inline = c.querySelector("[data-toolbar-right]")!;
  assert.match(inline.className, /\bhidden\b.*@3xl:flex/);
  assert.match(c.querySelector("[data-viewer-more]")!.parentElement!.className, /@3xl:hidden/);
  assert.match(c.querySelector("[data-zoom-inline]")!.className, /\bhidden\b.*@lg:flex/);
  // Counter and toggle are not inside any collapsing wrapper.
  for (const sel of ["[data-page-counter]", "[data-view-toggle]"]) {
    const el = c.querySelector(sel)!;
    assert.ok(el.parentElement === tb, `${sel} yig'iladigan o'ramda`);
  }
  cleanup();
  c = bar({ right, rightWidth: "wide" });
  assert.match(c.querySelector("[data-toolbar-right]")!.className, /@5xl:flex/);
  assert.ok(!c.querySelector("[data-view-toggle]"), "rezyumeda O'qish/Varaq yo'q");
});

test("«Boshqa amallar»: opens with focus on the first control, arrows move, Escape returns focus, outside tap closes", async () => {
  const clicks: string[] = [];
  const right = [
    h("button", { key: "a", type: "button", onClick: () => clicks.push("undo") }, "A"),
    h("button", { key: "b", type: "button", onClick: () => clicks.push("edit") }, "B"),
  ];
  const c = bar({ right, view: "page", onView: () => {} });
  const trigger = c.querySelector<HTMLButtonElement>("[data-viewer-more]")!;
  assert.equal(trigger.getAttribute("aria-label"), "Boshqa amallar");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.ok(!c.querySelector("[data-viewer-more-panel]"), "yopiq menyu DOM da");

  await act(async () => {
    fireEvent.click(trigger);
  });
  const panel = c.querySelector<HTMLElement>("[data-viewer-more-panel]")!;
  assert.ok(panel);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(trigger.getAttribute("aria-controls"), panel.id);
  // Zoom (collapsed below @lg) comes first, then the right-hand controls.
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Kichraytirish");
  assert.ok(panel.querySelector("[data-more-zoom]"));
  assert.match(panel.querySelector("[data-more-right]")!.className, /@3xl:hidden/);
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  assert.equal(document.activeElement?.textContent, "B", "↑ oxirgisiga aylanmadi");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Kichraytirish");
  await act(async () => {
    fireEvent.click([...panel.querySelectorAll("button")].find((b) => b.textContent === "B")!);
  });
  assert.deepEqual(clicks, ["edit"], "menyudagi tugma ishlamadi");

  await act(async () => {
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  });
  assert.ok(!c.querySelector("[data-viewer-more-panel]"), "Escape yopmadi");
  assert.ok(document.activeElement === trigger, "fokus tugmaga qaytmadi");

  await act(async () => {
    fireEvent.click(trigger);
  });
  assert.ok(c.querySelector("[data-viewer-more-panel]"));
  await act(async () => {
    fireEvent.pointerDown(document.body);
  });
  assert.ok(!c.querySelector("[data-viewer-more-panel]"), "tashqariga bosish yopmadi");
});

test("«O‘qish» toolbar: no zoom, no menu; the toggle reports the mode", () => {
  const seen: string[] = [];
  const c = bar({ view: "reading", onView: (v: string) => seen.push(v) });
  assert.ok(!c.querySelector('[aria-label="Kichraytirish"]'));
  assert.ok(!c.querySelector("[data-viewer-more]"));
  const g = c.querySelector("[data-view-toggle]")!;
  assert.equal(g.getAttribute("role"), "group");
  assert.equal(g.getAttribute("data-view-mode"), "reading");
  fireEvent.click([...g.querySelectorAll("button")].find((b) => b.textContent === "Varaq")!);
  assert.deepEqual(seen, ["page"]);
});
