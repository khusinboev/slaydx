import "./setup.ts";
import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResultLayout, type PanelSection } from "../../components/files/ResultLayout.tsx";
import { ResultView } from "../../components/files/ResultView.tsx";
import { PANEL_PREF_KEY } from "../../components/files/result-layout/prefs.ts";
import { reviewSummary } from "../../components/files/result-layout/summary.ts";
import { VIEWER_FRAME, frameClass } from "../../components/files/result-layout/frame.ts";
import { useAppStore } from "../../lib/store.ts";
import { sampleGameDoc } from "../../lib/generation/games/samples.ts";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import type { ArticleReview } from "../../lib/generation/article/types.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Natija sahifasi maketi (viewer redesign V0, `docs/viewer/PLAN.md`).
 *
 * Shartnoma: BITTA sahifa scroll'i (ildizda `overflow-hidden` yo'q),
 * sticky sarlavha + `--result-header-h`, ikkinchi darajali bloklar
 * (hisobot, o'yin havolasi) ko'ruvchi USTIDA emas — panelda: ≥ 1280 px da
 * o'ngdagi yig'iladigan panel (holat `localStorage` da), torroqda
 * chiplar ochadigan pastki varaq (fokus tuzog'i, Escape, fokus qaytadi).
 *
 * Mutatsiyalar (har biri qizardi, hisobot V0 da):
 *   1. ResultView: hisobot `ArtifactViewer` dan OLDIN mazmun ustuniga
 *      qaytarildi → «mazmun ustunida panel yo'q» testi;
 *   2. ResultLayout: ildizga `overflow-hidden` → «ildiz scroll tuzog'i emas»;
 *   3. `writePanelOpen` o'chirildi → «tanlov eslab qolinadi»;
 *   4. `useDialog` o'rniga hech narsa (Escape yo'q) → «Escape yopadi, fokus qaytadi».
 */

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

const win = window as unknown as { matchMedia?: (q: string) => MediaQueryList };
let wide = false;

before(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  win.matchMedia = (q: string) =>
    ({
      matches: wide && q.includes("1280"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList;
});

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  wide = false;
  try {
    window.localStorage.clear();
  } catch {
    // jsdom
  }
});

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

const SECTIONS: PanelSection[] = [
  { id: "review", title: "Tayyorlik hisoboti", chip: "Tayyorlik 77 · 2 xato", tone: "yellow", content: h("button", { type: "button", "data-in-review": "" }, "Hammasini tuzatish") },
  { id: "share", title: "O‘yin havolasi", chip: "O‘yin havolasi", content: h("button", { type: "button", "data-in-share": "" }, "O‘yin havolasi yaratish") },
];

function layout(sections: PanelSection[] = SECTIONS) {
  return render(
    h(ResultLayout, {
      header: h("nav", { "data-test-nav": "" }, h("button", { type: "button" }, "Orqaga")),
      sections,
      frame: "flow",
      children: h("div", { "data-test-content": "" }, "Hujjat"),
    }),
  );
}

/* ───────────────────────────── ResultLayout ───────────────────────────── */

test("ildiz scroll tuzog'i emas: overflow-hidden/overflow-y-auto yo'q, sarlavha sticky top-0, --result-header-h e'lon qilingan", () => {
  layout();
  const root = q("[data-result-layout]")!;
  assert.ok(root, "maket ildizi");
  // Ildizdan mazmungacha BIRORTA ham `overflow-*` klassi yo'q — sahifa `<main>` da aylanadi.
  for (let el: HTMLElement | null = q("[data-test-content]"); el && el !== document.body; el = el.parentElement) {
    assert.ok(!/\boverflow-(hidden|y-auto|auto|y-hidden)\b/.test(el.className), `scroll tuzog'i: <${el.tagName.toLowerCase()} class="${el.className}">`);
  }
  const head = q("[data-result-header]")!;
  assert.match(head.className, /\bsticky\b/);
  assert.match(head.className, /\btop-0\b/);
  assert.ok(head.contains(q("[data-test-nav]")), "sarlavha qatori sticky blok ichida");
  assert.match(root.style.getPropertyValue("--result-header-h"), /^\d+px$/, "sarlavha balandligi o'zgaruvchisi");
  assert.match(root.style.getPropertyValue("--result-fill-h"), /100svh - var\(--app-topbar-h\) - var\(--result-header-h/);
});

test("keng ekran: panel o'ngda, standart OCHIQ, bo'limlar panel ichida, mazmun ustunida emas", () => {
  wide = true;
  layout();
  const panel = q("[data-result-panel]")!;
  assert.equal(panel.getAttribute("data-result-panel"), "dock");
  assert.equal(panel.getAttribute("data-panel-open"), "1");
  assert.match(panel.className, /xl:sticky/);
  assert.match(panel.className, /xl:top-\[var\(--result-header-h\)\]/);
  assert.match(panel.className, /xl:max-h-\[var\(--result-fill-h\)\]/);
  assert.ok(!panel.hasAttribute("role"), "keng rejimda modal emas");
  const content = q("[data-result-content]")!;
  assert.ok(content.contains(q("[data-test-content]")));
  assert.ok(!content.contains(q("[data-in-review]")) && !content.contains(q("[data-in-share]")), "bo'limlar mazmun ustunida emas");
  assert.ok(panel.contains(q("[data-in-review]")) && panel.contains(q("[data-in-share]")));
  const ids = [...document.querySelectorAll("[data-panel-section]")].map((s) => s.getAttribute("data-panel-section"));
  assert.deepEqual(ids, ["review", "share"], "tartib: hisobot, keyin havola");
  // Panelning yagona scroll'i — tanasida, mazmun yo'q.
  assert.match(q("[data-panel-body]")!.className, /overflow-y-auto/);
});

test("keng ekran: yig'ish tugmasi yopadi, tanlov localStorage da eslab qolinadi (qayta ochilganda ham yopiq)", async () => {
  wide = true;
  layout();
  const toggle = q("[data-panel-toggle]")!;
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  await act(async () => fireEvent.click(toggle));
  assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "0");
  assert.match(q("[data-result-panel]")!.className, /xl:hidden/);
  assert.equal(window.localStorage.getItem(PANEL_PREF_KEY), "0");
  cleanup();
  layout();
  assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "0", "qayta ochilganda ham yopiq");
  // Chip panelni yana ochadi va tanlov yangilanadi.
  await act(async () => fireEvent.click(q('[data-panel-chip="share"]')!));
  assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "1");
  assert.equal(window.localStorage.getItem(PANEL_PREF_KEY), "1");
  // Panel ichidagi yopish tugmasi ham.
  await act(async () => fireEvent.click(q("[data-panel-close]")!));
  assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "0");
});

test("localStorage istisno tashlasa ham maket chiziladi (standart ochiq)", () => {
  wide = true;
  const proto = Object.getPrototypeOf(window.localStorage) as Storage;
  const get = proto.getItem;
  const set = proto.setItem;
  proto.getItem = () => {
    throw new Error("SecurityError");
  };
  proto.setItem = () => {
    throw new Error("QuotaExceeded");
  };
  try {
    layout();
    assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "1");
    fireEvent.click(q("[data-panel-toggle]")!);
    assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "0", "yozish yiqilsa ham holat ishlaydi");
  } finally {
    proto.getItem = get;
    proto.setItem = set;
  }
});

test("tor ekran: varaq standart yopiq; chip ochadi (dialog), fokus ichkarida, Tab aylanadi, Escape yopadi va fokus chipga qaytadi", async () => {
  layout();
  const panel = q("[data-result-panel]")!;
  assert.equal(panel.getAttribute("data-result-panel"), "sheet");
  assert.equal(panel.getAttribute("data-panel-open"), "0");
  assert.match(panel.className, /(^|\s)hidden(\s|$)/, "yopiq varaq ko'rinmaydi");
  const chip = q('[data-panel-chip="share"]')!;
  assert.equal(chip.getAttribute("aria-expanded"), "false");
  chip.focus();
  await act(async () => fireEvent.click(chip));
  assert.equal(panel.getAttribute("data-panel-open"), "1");
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.match(panel.className, /\bfixed\b/);
  assert.ok(q("[data-panel-backdrop]"), "fon");
  assert.equal(chip.getAttribute("aria-expanded"), "true");
  await waitFor(() => assert.ok(panel.contains(document.activeElement), "fokus varaq ichida"));
  // Fokus tuzog'i: oxirgi elementdan Tab → birinchisiga.
  const focusables = [...panel.querySelectorAll<HTMLElement>("button")];
  focusables[focusables.length - 1].focus();
  fireEvent.keyDown(window, { key: "Tab" });
  assert.equal(document.activeElement, focusables[0], "Tab varaqdan chiqmaydi");
  await act(async () => fireEvent.keyDown(window, { key: "Escape" }));
  assert.equal(panel.getAttribute("data-panel-open"), "0");
  assert.ok(!panel.hasAttribute("role"));
  assert.equal(document.activeElement, chip, "fokus ochgan chipga qaytdi");
  // Tor ekranda varaq holati localStorage ga YOZILMAYDI (u keng panelning tanlovi).
  assert.equal(window.localStorage.getItem(PANEL_PREF_KEY), null);
});

test("tor ekran: fonni bosish varaqni yopadi", async () => {
  layout();
  await act(async () => fireEvent.click(q('[data-panel-chip="review"]')!));
  assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "1");
  await act(async () => fireEvent.click(q("[data-panel-backdrop]")!));
  assert.equal(q("[data-result-panel]")!.getAttribute("data-panel-open"), "0");
});

test("bo'lim yo'q — panel ham, chip ham yo'q", () => {
  layout([]);
  assert.ok(!q("[data-result-panel]"));
  assert.ok(!q("[data-result-chips]"));
  assert.ok(q("[data-test-content]"));
});

test("chip xulosasi: ball, xato va e'tibor soni, rang chegaralari panel halqasi bilan bir xil (80/60)", () => {
  const checks = [
    { id: "a", level: "red", label: "A" },
    { id: "b", level: "red", label: "B" },
    { id: "c", level: "yellow", label: "C" },
    { id: "d", level: "green", label: "D" },
  ] as ArticleReview["checks"];
  assert.deepEqual(reviewSummary({ score: 77, checks }), { score: 77, errors: 2, warnings: 1, label: "Tayyorlik 77 · 2 xato · 1 e’tibor", tone: "yellow" });
  assert.equal(reviewSummary({ score: 92, checks: [] }).label, "Tayyorlik 92");
  assert.equal(reviewSummary({ score: 80, checks: [] }).tone, "green");
  assert.equal(reviewSummary({ score: 59, checks: [] }).tone, "red");
});

test("ramka shartnomasi: slayd — fill, qolganlari — flow; fill/boxed balandligi --result-fill-h", () => {
  assert.equal(VIEWER_FRAME.slides.mode, "fill");
  for (const k of ["academic", "essay", "article", "teacher", "game", "resume", "image", "audio", "translation"] as const) {
    assert.equal(VIEWER_FRAME[k].mode, "flow", k);
  }
  assert.equal(VIEWER_FRAME.translation.boxed, false, "tarjima allaqachon oqimda");
  assert.match(frameClass(VIEWER_FRAME.slides), /h-\[var\(--result-fill-h/);
  assert.match(frameClass(VIEWER_FRAME.article), /h-\[var\(--result-fill-h/, "V1 gacha: eski ichki scroll ishlashi uchun qat'iy balandlik");
  assert.match(frameClass(VIEWER_FRAME.translation), /min-h-\[var\(--result-fill-h/);
  assert.doesNotMatch(frameClass(VIEWER_FRAME.translation), /(^|\s)h-\[/, "oqimda qat'iy balandlik yo'q");
});

/* ───────────────────────────── ResultView ───────────────────────────── */

const ID = "22222222-2222-4222-8222-222222222222";
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const REVIEW = {
  score: 77,
  checks: [
    { id: "structure", level: "green", label: "Tuzilma" },
    { id: "filler", level: "red", label: "«Suv» iboralar", fix: { op: "rewrite", target: "intro", instruction: "x" } },
    { id: "udk", level: "yellow", label: "UDK" },
  ],
  judgeNotes: [],
  verifiedShare: 1,
  recentShare: 1,
  builtAt: "2026-09-12T00:00:00.000Z",
} as unknown as ArticleReview;

function gen(type: string, doc: AcademicDoc, patch: Record<string, unknown> = {}) {
  return {
    id: ID,
    type,
    topic: "Hujayra tuzilishi",
    status: "COMPLETED",
    createdAt: "2026-09-23T08:00:00.000Z",
    finishedAt: "2026-09-23T08:01:00.000Z",
    price: 3000,
    fileName: "fayl.docx",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    preview: null,
    html: null,
    doc,
    hasFile: true,
    docVersion: 1,
    fileVersion: 1,
    ...patch,
  };
}

function mountResult(g: ReturnType<typeof gen>) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/auth/session") return json(200, { user: null, features: null });
    if (url.endsWith("/share")) return json(200, { sessions: [] });
    if (url.includes("/results")) return json(200, { results: [], count: 0 });
    if (method === "GET" && url.startsWith(`/api/generations/${ID}`)) return json(200, { generation: g });
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

function listeningDoc(): AcademicDoc {
  const d = sampleGameDoc("listening");
  d.game!.review = REVIEW;
  return d;
}

test("ResultView (tinglash o'yini): hisobot va o'yin havolasi PANELDA, ko'ruvchi mazmun ustunida va undan oldin hech narsa yo'q", async () => {
  wide = true;
  mountResult(gen("listening", listeningDoc()));
  await waitFor(() => assert.ok(q("[data-game-share]"), "havola paneli chizilmadi"), { timeout: 4000 });
  const panel = q("[data-result-panel]")!;
  const content = q("[data-result-content]")!;
  const frame = await waitFor(() => {
    const f = q("[data-viewer-frame]");
    assert.ok(f, "ko'ruvchi ramkasi");
    return f;
  });
  assert.ok(content.contains(frame), "ko'ruvchi mazmun ustunida");
  assert.equal(frame.getAttribute("data-viewer-frame"), "flow");
  assert.equal(frame.getAttribute("data-viewer-kind"), "game");
  // Hisobot va havola — panel ICHIDA, mazmun ustunida EMAS.
  assert.ok(panel.contains(q("[data-article-review-panel]")), "hisobot panelda");
  assert.ok(panel.contains(q("[data-article-review]")), "ArticleReviewPanel panelda");
  assert.ok(panel.contains(q("[data-game-share]")), "GameSharePanel panelda");
  assert.ok(!content.contains(q("[data-article-review]")), "hisobot ko'ruvchi ustida emas");
  assert.ok(!content.contains(q("[data-game-share]")), "havola ko'ruvchi ustida emas");
  // Mazmun ustunida ko'ruvchidan OLDIN hech qanday blok yo'q (yetkazish qatori ham yo'q bu holatda).
  assert.equal(content.firstElementChild, frame, "ko'ruvchi mazmun ustunining birinchi bolasi");
  // Bo'lim tartibi: hisobot → havola.
  const ids = [...panel.querySelectorAll("[data-panel-section]")].map((s) => s.getAttribute("data-panel-section"));
  assert.deepEqual(ids, ["review", "share"]);
  // Sarlavha chiplari xulosani beradi.
  assert.match(q('[data-panel-chip="review"]')!.textContent ?? "", /Tayyorlik 77 · 1 xato · 1 e’tibor/);
  assert.match(q('[data-panel-chip="share"]')!.textContent ?? "", /O‘yin havolasi/);
  assert.equal(q("[data-result-layout]")!.getAttribute("data-result-frame"), "flow");
});

test("ResultView (tor ekran): chip varaqni ochadi va hisobot amallari ishlaydi", async () => {
  mountResult(gen("listening", listeningDoc()));
  const chip = await waitFor(() => {
    const c = q('[data-panel-chip="review"]');
    assert.ok(c);
    return c;
  }, { timeout: 4000 });
  const panel = q("[data-result-panel]")!;
  assert.equal(panel.getAttribute("data-result-panel"), "sheet");
  assert.equal(panel.getAttribute("data-panel-open"), "0");
  await act(async () => fireEvent.click(chip));
  assert.equal(panel.getAttribute("data-panel-open"), "1");
  assert.ok(panel.contains(q("[data-polish-button]")), "«Hammasini tuzatish» varaqda");
});

test("ResultView (tarjima): oqim ramkasi, panel yo'q, ildizda scroll tuzog'i yo'q", async () => {
  // `tests/viewer/translation-viewer.test.mts` dagi hisobot shakli.
  const doc = {
    meta: { toolId: "translation", language: "en", topic: "x" },
    titlePage: false,
    toc: false,
    sections: [{ id: "body", title: "", blocks: [{ kind: "p", text: "Photosynthesis" }] }],
    translation: {
      sourceLang: "avto",
      detected: "uz",
      target: "en",
      style: "formal",
      glossary: [],
      warnings: [],
      pairs: [{ id: "a", src: "Fotosintez", dst: "Photosynthesis", kind: "h" }],
      segments: 1,
      translated: 1,
      chars: 10,
      sourceKind: "text",
    },
  } as unknown as AcademicDoc;
  mountResult(gen("translation", doc, { format: "txt" }));
  const frame = await waitFor(() => {
    const f = q('[data-viewer-frame="flow"][data-viewer-kind="translation"]');
    assert.ok(f, "tarjima ramkasi");
    return f;
  }, { timeout: 4000 });
  assert.ok(!frame.hasAttribute("data-viewer-boxed"), "tarjima qat'iy quti emas");
  assert.ok(!q("[data-result-panel]"));
  for (let el: HTMLElement | null = frame; el && el !== document.body; el = el.parentElement) {
    assert.ok(!/\boverflow-(hidden|y-auto|auto)\b/.test(el.className), `scroll tuzog'i: ${el.className}`);
  }
});

test("ResultView (maqola): «Fayl yangilanmoqda…» faqat yuklash paytida — eskirgan fayl (fileVersion < docVersion) jim turganda «Yuklab olish»", async () => {
  const meta = { topic: "Sun’iy intellekt", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;
  const d = JSON.parse(JSON.stringify(sampleArticleDoc(meta))) as AcademicDoc;
  d.article!.review = REVIEW;
  mountResult(gen("article", d, { docVersion: 3, fileVersion: 1 }));
  const btn = await waitFor(() => {
    const b = q("[data-file-stale]");
    assert.ok(b, "eskirgan fayl belgisi");
    return b;
  }, { timeout: 4000 });
  assert.match(btn.textContent ?? "", /Yuklab olish/);
  assert.doesNotMatch(btn.textContent ?? "", /Fayl yangilanmoqda/, "MUTATSIYA: `fileStale ||` qaytarilsa yozuv abadiy turardi");
  assert.equal(btn.getAttribute("title"), "Fayl oxirgi tahrirlar bilan yangilanib yuklanadi");
});
