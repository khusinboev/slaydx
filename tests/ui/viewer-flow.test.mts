import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, type ReactNode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { ResumeViewer } from "../../components/viewers/ResumeViewer.tsx";
import { ViewerToolbar } from "../../components/viewers/toolbar.tsx";
import { VIEWER_FRAME, frameClass } from "../../components/files/result-layout/frame.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import { docFromResume } from "../../lib/generation/resume/model.ts";
import { sampleResume } from "../../lib/generation/resume/samples.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Varaqli ko'ruvchilar SAHIFA scroll'ida (viewer redesign V1,
 * `docs/viewer/PLAN.md` «Contract for V1–V4 → V1»):
 *
 *   - ramka (`[data-viewer-frame=flow]`) va varaqlar orasida vertikal
 *     scroll qutisi yo'q (`overflow-*`, `h-full`, `min-h-[70vh]`);
 *   - toolbar natija sarlavhasi ostiga yopishadi (`sticky
 *     top-[var(--result-header-h)] z-10`), slayd toolbari esa YO'Q
 *     (opt-in prop, standart o'chiq);
 *   - standart zoom RAMKA enidan (ResizeObserver), pastga, ≤ 125 %,
 *     telefonda haqiqiy sig'dirish; qo'lda zoom keyingi o'lcham
 *     o'zgarishida saqlanadi, «%» tugmasi qayta sig'diradi;
 *   - qo'lda zoom ustundan keng bo'lsa gorizontal scroll faqat varaq
 *     QATORIDA (`[data-page-row]`), barcha varaqlar ajdodida emas;
 *   - sahifa hisoblagichi viewport (`root: null`) bo'yicha, yopishqoq
 *     sarlavha `rootMargin` bilan chiqarilgan.
 *
 * jsdom da layout yo'q: ramka eni (`clientWidth`), varaq to'rtburchaklari
 * (`getBoundingClientRect`), `ResizeObserver`/`IntersectionObserver`
 * boshqariladigan taqlid bilan beriladi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `Workspace` ga `overflow-auto` qaytarildi → «scroll qutisi yo'q»;
 *   2. `useFitZoom` da `auto.current = false` olib tashlandi → «qo'lda zoom saqlanadi»;
 *   3. `useVisiblePage` da `root: null` o'rniga anchor → «viewport ildiz»;
 *   4. `PageRow` `wide` sharti olib tashlandi (doim overflow) → «sig'dirilganda qator scroll emas».
 */

/* ── boshqariladigan kuzatuvchilar ── */
type RoCb = () => void;
const ros: { cb: RoCb; els: Element[] }[] = [];
(globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
  rec: { cb: RoCb; els: Element[] };
  constructor(cb: RoCb) {
    this.rec = { cb, els: [] };
    ros.push(this.rec);
  }
  observe(el: Element) {
    this.rec.els.push(el);
  }
  unobserve() {}
  disconnect() {
    const i = ros.indexOf(this.rec);
    if (i >= 0) ros.splice(i, 1);
  }
};

type IoRec = { cb: () => void; opts: IntersectionObserverInit; els: Element[] };
const ios: IoRec[] = [];
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
  rec: IoRec;
  constructor(cb: () => void, opts: IntersectionObserverInit) {
    this.rec = { cb, opts, els: [] };
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

/* ── layout taqlidi ── */
let frameW = 1200;
/** Varaq (`data-page`) → ekrandagi to'rtburchak; berilmagan bo'lsa 0. */
let pageRects: Record<string, { top: number; bottom: number }> = {};
const proto = window.HTMLElement.prototype;
const realRect = proto.getBoundingClientRect;
Object.defineProperty(proto, "clientWidth", {
  configurable: true,
  get(this: HTMLElement) {
    return this.hasAttribute("data-viewer-frame") ? frameW : 0;
  },
});
proto.getBoundingClientRect = function (this: HTMLElement) {
  const p = this.getAttribute("data-page");
  if (p) {
    const r = pageRects[p] ?? { top: 0, bottom: 0 };
    return { top: r.top, bottom: r.bottom, height: r.bottom - r.top, left: 0, right: 0, width: 0, x: 0, y: r.top, toJSON() {} } as DOMRect;
  }
  // O'lchov qutisi bandlari: har biri 300 px — maqola bir necha varaqqa bo'linsin.
  if (this.parentElement?.getAttribute("aria-hidden") === "true") {
    return { top: 0, bottom: 300, height: 300, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  }
  return realRect.call(this);
};

afterEach(() => {
  cleanup();
  frameW = 1200;
  pageRects = {};
});

const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

/** Natija sahifasidagidek: `ArtifactViewer` ramkasi + `ResultLayout` o'zgaruvchilari. */
function inFrame(kind: "article" | "resume", child: ReactNode) {
  return h(
    "div",
    { style: { "--app-topbar-h": "3.5rem", "--result-header-h": "100px" } as React.CSSProperties },
    h("div", { "data-viewer-frame": "flow", "data-viewer-kind": kind, className: frameClass(VIEWER_FRAME[kind]) }, child),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function zoomLabel(c: HTMLElement): string {
  const btn = [...c.querySelectorAll("[data-viewer-toolbar] button")].find((b) => /%$/.test(b.textContent ?? ""));
  assert.ok(btn, "zoom tugmasi yo'q");
  return btn.textContent ?? "";
}

function counter(c: HTMLElement): string {
  const span = c.querySelector("[data-viewer-toolbar] span.tabular-nums");
  assert.ok(span, "sahifa hisoblagichi yo'q");
  return (span.textContent ?? "").replace(/\s+/g, " ").trim();
}

async function resizeFrame(w: number) {
  frameW = w;
  await act(async () => {
    for (const r of [...ros]) if (r.els.some((e) => e.hasAttribute("data-viewer-frame"))) r.cb();
  });
}

const TRAP = /(^|\s)(overflow-(auto|scroll|hidden|y-auto|y-scroll)|h-full|min-h-\[70vh\])(\s|$)/;

function assertNoVerticalScroller(c: HTMLElement) {
  const frame = c.querySelector("[data-viewer-frame]");
  assert.ok(frame, "ramka yo'q");
  // Varaq qatori o'zi ham tekshiriladi: standart (sig'dirilgan) zoomda u scroll konteyneri emas.
  const rows = c.querySelectorAll("[data-page-row]");
  assert.ok(rows.length > 0, "varaq qatori yo'q");
  for (const row of rows) {
    for (let el: Element | null = row; el && el !== frame; el = el.parentElement) {
      assert.ok(!TRAP.test(el.className), `varaq ajdodida scroll qutisi/qat'iy balandlik: «${el.className}»`);
    }
  }
}

test("WordViewer: ramka va varaqlar orasida vertikal scroll qutisi yo'q, toolbar sticky (sarlavha ostida, z-10)", async () => {
  const { container } = render(inFrame("article", h(WordViewer, { doc: sampleArticleDoc(META) })));
  await settle();
  assert.ok(container.querySelectorAll("[data-page]").length >= 2, "maqola bir necha varaqqa bo'linmadi");
  assertNoVerticalScroller(container);
  const root = container.querySelector('[data-viewer-root="word"]');
  assert.ok(root && !/\bh-full\b|min-h-\[70vh\]/.test(root.className), root?.className);
  const bar = container.querySelector('[data-viewer-toolbar="sticky"]');
  assert.ok(bar, "toolbar sticky emas");
  for (const cls of ["sticky", "top-[var(--result-header-h,0px)]", "z-10"]) assert.ok(bar.classList.contains(cls), `toolbar: ${cls} yo'q`);
  assert.ok(!bar.classList.contains("z-20") && !bar.classList.contains("z-30"), "toolbar sarlavhadan (z-20) pastda bo'lsin");
});

test("ViewerToolbar: sticky — opt-in; standart (slayd `fill` ramkasi) sahifaga yopishmaydi", () => {
  const noop = () => {};
  const { container } = render(h(ViewerToolbar, { zoom: 75, onZoom: noop, page: 1, pages: 3, onPage: noop }));
  const bar = container.firstElementChild as HTMLElement;
  assert.ok(!bar.classList.contains("sticky"), bar.className);
  assert.ok(!bar.hasAttribute("data-viewer-toolbar"));
});

test("WordViewer: standart zoom ramka enidan — 125 % chegara, pastga yaxlitlash, telefonda haqiqiy sig'dirish, ResizeObserver bilan qayta", async () => {
  frameW = 1600;
  const { container } = render(inFrame("article", h(WordViewer, { doc: sampleArticleDoc(META) })));
  await settle();
  assert.equal(zoomLabel(container), "125%", "keng ustunda 125 % chegara");
  await resizeFrame(900);
  assert.equal(zoomLabel(container), "100%", "113 % → 100 (pastga)");
  await resizeFrame(390);
  assert.equal(zoomLabel(container), "49%", "telefon: 390/794 → 49 %, 50 % pol yo'q");
  // Sig'dirilganda varaq qatori scroll konteyneri EMAS.
  for (const row of container.querySelectorAll("[data-page-row]")) assert.ok(!/overflow/.test(row.className), row.className);
});

test("WordViewer: qo'lda zoom o'lcham o'zgarsa saqlanadi, ustundan keng bo'lsa scroll faqat varaq QATORIDA; «%» qayta sig'diradi", async () => {
  frameW = 900;
  const { container, getByLabelText } = render(inFrame("article", h(WordViewer, { doc: sampleArticleDoc(META) })));
  await settle();
  assert.equal(zoomLabel(container), "100%");
  fireEvent.click(getByLabelText("Kattalashtirish"));
  assert.equal(zoomLabel(container), "125%");
  await resizeFrame(880);
  assert.equal(zoomLabel(container), "125%", "qo'lda tanlangan zoom bosilib ketmasin");
  // 794 × 1.25 = 993 > 880 — gorizontal scroll har varaq qatorida.
  const rows = [...container.querySelectorAll("[data-page-row]")];
  assert.ok(rows.length >= 2);
  for (const row of rows) assert.ok(row.classList.contains("overflow-x-auto"), `qator: ${row.className}`);
  // Hech bir ajdod (barcha varaqlarni o'z ichiga olgan) scroll konteyneri emas.
  for (let el = rows[0].parentElement; el && !el.hasAttribute("data-viewer-frame"); el = el.parentElement) {
    assert.ok(!/(^|\s)overflow-/.test(el.className), `ajdod scroll: ${el.className}`);
  }
  fireEvent.click(container.querySelector("[data-viewer-toolbar] button.min-w-12") as HTMLElement);
  assert.equal(zoomLabel(container), "100%", "«%» — qayta sig'dirish");
  assert.ok(!rows.some((r) => r.isConnected && r.classList.contains("overflow-x-auto")), "sig'gach qator scroll emas");
});

test("WordViewer: sahifa hisoblagichi viewport bo'yicha — root null, rootMargin yopishqoq sarlavha (topbar + header + toolbar), eng ko'p ko'ringan varaq", async () => {
  const { container } = render(inFrame("article", h(WordViewer, { doc: sampleArticleDoc(META) })));
  await settle();
  const n = container.querySelectorAll("[data-page]").length;
  assert.ok(n >= 3, `kamida 3 varaq kerak: ${n}`);
  const io = ios.find((r) => r.els.some((e) => e.hasAttribute("data-page")));
  assert.ok(io, "varaqlar kuzatilmayapti");
  assert.equal(io.opts.root, null, "ildiz — viewport (sahifa scroll'i)");
  assert.equal(io.opts.rootMargin, "-196px 0px 0px 0px", "56 (topbar) + 100 (sarlavha) + 40 (toolbar)");
  assert.ok(Array.isArray(io.opts.threshold) && io.opts.threshold.length >= 10, "zich chegaralar — ekrandan baland varaq ham");
  assert.equal(counter(container), `1 / ${n}`);
  // 3-varaq ko'rinishda eng ko'p joy egallaydi; 2-varaq pasti sarlavha ORTIDA (196 dan yuqorida).
  pageRects = { "2": { top: -500, bottom: 300 }, "3": { top: 330, bottom: 1400 } };
  await act(async () => io.cb());
  assert.equal(counter(container), `3 / ${n}`);
  // Sarlavha ostidagi qism hisoblanmaydi: 2-varaqning 196…300 = 104 px, 3-varaqning 760…800 = 40 px.
  pageRects = { "2": { top: -800, bottom: 300 }, "3": { top: 760, bottom: 1800 } };
  await act(async () => io.cb());
  assert.equal(counter(container), `2 / ${n}`);
});

function resumeDoc(): AcademicDoc {
  return docFromResume(sampleResume("modern", undefined, false), { ...META, toolId: "resume", workLabel: "Rezyume" } as unknown as DocMeta);
}

test("ResumeViewer: Word bilan bir xil qobiq — scroll qutisi yo'q, sticky toolbar, ramka eniga sig'dirish (telefonda 100 % emas)", async () => {
  frameW = 390;
  const { container } = render(inFrame("resume", h(ResumeViewer, { doc: resumeDoc() })));
  await settle();
  assertNoVerticalScroller(container);
  const root = container.querySelector('[data-viewer-root="resume"]');
  assert.ok(root && !/\bh-full\b|min-h-\[70vh\]/.test(root.className), root?.className);
  assert.ok(container.querySelector('[data-viewer-toolbar="sticky"]'), "rezyume toolbari sticky emas");
  assert.equal(zoomLabel(container), "49%", "ilgari qat'iy 100 % — telefonda varaq yarmi kesilardi");
  await resizeFrame(1600);
  assert.equal(zoomLabel(container), "125%");
  const io = ios.find((r) => r.els.length > 0);
  assert.ok(io && io.opts.root === null, "rezyume hisoblagichi ham viewport bo'yicha");
});
