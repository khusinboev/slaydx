import "./setup.ts";
import { renders, resetRenders } from "./render-count.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { RunningPanel } from "../../components/files/ResultView.tsx";
import { HomeFiles } from "../../components/home/HomeFiles.tsx";
import { useAppStore } from "../../lib/store.ts";
import type * as api from "../../lib/api-client.ts";
import type { LiveView } from "../../components/viewers/useReveal.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * FE-13 — «render bo'roni».
 *
 *  (a) Jonli slayd ko'ruvchisi: yozish animatsiyasi har kadrda `setP` qiladi.
 *      Ilgari butun `SlideViewer`, ikkala `SlideRail` va ulardagi har bir
 *      `SlideCanvas` (har biri `planSlide`) HAR KADRDA qayta chizilardi —
 *      20 slaydda kadriga ~41 maket.
 *  (b) Polling tiki (o'zgarishsiz `live`): `liveDocOf` har renderda
 *      slaydlarni klonlardi → barcha eskizlar qayta chizilardi.
 *  (c) «Mening fayllarim»: har poll `generations` massivini yangi
 *      obyektlar bilan almashtirardi → har slayd kartasi qayta chizilardi.
 *
 * Sanoq React DevTools ilgagi bilan (`render-count.ts`): komponent
 * funksiyasi haqiqatan chaqirilgan marta.
 */

const realFetch = globalThis.fetch;
const realRaf = globalThis.requestAnimationFrame;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  globalThis.requestAnimationFrame = realRaf;
});

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean };

/**
 * `act` TASHQARISIDA kutish: act ichida React barcha kadr yangilanishlarini
 * bitta renderga yig'ib, bo'ronni yashirib qo'yardi.
 */
async function realTime(ms: number) {
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await sleep(ms);
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = true;
  }
}

const N = 20;
const slides: SlideModel[] = Array.from({ length: N }, (_, k) =>
  k === 0
    ? { id: "s0", layout: "title", title: "Sarlavha slaydi", subtitle: "Ikkinchi qator" }
    : { id: `s${k}`, layout: "bullets", title: `Band ${k}`, bullets: ["Birinchi band matni.", "Ikkinchi band matni.", "Uchinchi band."] },
) as SlideModel[];

function live(written: number): LiveView {
  return {
    stage: "text",
    meta: { topic: "Namunaviy mavzu", author: "Aliyev Ali", workLabel: "Taqdimot" } as LiveView["meta"],
    theme: "atlas",
    template: "lecture",
    progress: 40,
    step: "Matn yozilmoqda",
    roles: [],
    slides,
    written: Array.from({ length: written }, (_, k) => k),
    final: false,
    imageWait: [],
    images: { got: 0, want: 0 },
  };
}

function detail(lv: LiveView): api.GenerationDetail {
  return {
    id: "g1",
    type: "slide",
    topic: "Namunaviy mavzu",
    status: "IN_PROGRESS",
    createdAt: "2026-03-01T10:00:00.000Z",
    price: 2000,
    format: "pptx",
    progress: 40,
    step: "Yozilmoqda",
    hasFile: false,
    live: lv,
  } as unknown as api.GenerationDetail;
}

const panel = (gen: api.GenerationDetail) => h(AppRouterContext.Provider, { value: router }, h(RunningPanel, { gen }));

test("FE-13 (b): o'zgarishsiz polling tiki eskizlarni qayta chizmaydi", async () => {
  const lv = live(N - 1);
  const view = render(panel(detail(lv)));
  await waitFor(() => assert.ok(document.querySelector("[data-live-strip]"), "jonli ko'ruvchi yuklandi"));
  await realTime(50);

  resetRenders();
  // Server `live` ni yubormadi → `mergeLive` o'sha obyektni saqlaydi, `gen` esa yangi.
  for (let t = 0; t < 3; t++) {
    await act(async () => view.rerender(panel({ ...detail(lv), progress: 41 + t })));
  }
  assert.ok(renders("SlideCanvas") === 0, `o'zgarishsiz tikda SlideCanvas ${renders("SlideCanvas")} marta chizildi`);
  assert.ok(renders("SlideRail") === 0, `o'zgarishsiz tikda SlideRail ${renders("SlideRail")} marta chizildi`);
});

test("FE-13 (a): yozish animatsiyasi kadrlari faqat sahnani chizadi, eskiz panellarini emas", async (t) => {
  const view = render(panel(detail(live(N - 2))));
  await waitFor(() => assert.ok(document.querySelector("[data-live-strip]"), "jonli ko'ruvchi yuklandi"));
  await realTime(50);

  let frames = 0;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    frames++;
    return realRaf(cb);
  };
  resetRenders();
  // Yangi slayd yozildi → sahna unga ergashadi va «yozilmoqda» animatsiyasi boshlanadi.
  await act(async () => view.rerender(panel(detail(live(N - 1)))));
  await realTime(1200);

  const canvas = renders("SlideCanvas");
  const rails = renders("SlideRail");
  assert.ok(frames >= 5, `animatsiya kadrlari bo'lishi kerak (kadr: ${frames})`);
  // Yangi slayd hodisasida eskizlar BIR marta yangilanadi (2 panel × N), keyin har kadrda faqat sahna.
  const budget = frames + 2 * N + 4;
  t.diagnostic(`kadr: ${frames}, SlideCanvas: ${canvas}, SlideRail: ${rails}`);
  assert.ok(canvas <= budget, `SlideCanvas ${canvas} marta chizildi (${frames} kadr, chegara ${budget})`);
  assert.ok(rails <= 6, `SlideRail ${rails} marta chizildi (${frames} kadr) — har kadrda chizilmasligi kerak`);
});

/* ───────────────────────── (c) «Mening fayllarim» ───────────────────────── */

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function row(id: string, patch: Record<string, unknown> = {}): api.ServerGeneration {
  return {
    id,
    type: "slide",
    topic: `Taqdimot ${id}`,
    status: "COMPLETED",
    createdAt: "2026-09-20T08:00:00.000Z",
    finishedAt: "2026-09-20T08:05:00.000Z",
    price: 3000,
    fileName: "s.pptx",
    format: "pptx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    fileVersion: 1,
    preview: {
      slide: {
        model: { id: "s0", layout: "title", title: `Sarlavha ${id}`, subtitle: "Ikkinchi qator" },
        themeId: "atlas",
        templateId: "lecture",
        visual: "classic",
        audience: "auto",
        bodyType: { minPt: 18, maxBullets: 6 },
      },
    },
    ...patch,
  } as unknown as api.ServerGeneration;
}

test("FE-13 (c): ro'yxat pollingi o'zgarmagan kartalarni qayta chizmaydi", async () => {
  let progress = 10;
  const page = () => ({
    generations: [
      row("a"),
      row("b"),
      row("c"),
      row("run", { status: "IN_PROGRESS", progress, step: "Yozilmoqda", preview: undefined }),
    ],
    nextCursor: null,
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/generations")) return json(200, page());
    return json(404, { error: "yo'q" });
  }) as typeof fetch;

  useAppStore.setState({ sessionChecked: true, loggedIn: true, generations: page().generations, generationsLoaded: true, generationsCursor: null });
  render(h(AppRouterContext.Provider, { value: router }, h(SearchParamsContext.Provider, { value: new URLSearchParams() }, h(HomeFiles))));
  await waitFor(() => assert.ok(document.querySelectorAll("[data-layer]").length > 0 || renders("SlideCanvas") > 0));

  // 1) Hech narsa o'zgarmagan poll.
  resetRenders();
  await act(async () => {
    await useAppStore.getState().refreshGenerations();
  });
  assert.ok(renders("SlideCanvas") === 0, `o'zgarishsiz pollda SlideCanvas ${renders("SlideCanvas")} marta chizildi`);
  assert.ok(renders("FilePreview") === 0, `o'zgarishsiz pollda FilePreview ${renders("FilePreview")} marta chizildi`);

  // 2) Faqat ishlayotgan karta o'zgardi — tayyor slayd kartalari tegilmaydi.
  progress = 55;
  resetRenders();
  await act(async () => {
    await useAppStore.getState().refreshGenerations();
  });
  assert.ok(renders("SlideCanvas") === 0, `bitta karta o'zgarganda SlideCanvas ${renders("SlideCanvas")} marta chizildi`);
  assert.ok(renders("FilePreview") <= 1, `bitta karta o'zgarganda FilePreview ${renders("FilePreview")} marta chizildi`);
  const bar = [...document.querySelectorAll<HTMLElement>(".bg-primary.h-full")].find((el) => el.style.width === "55%");
  assert.ok(bar, "ishlayotgan kartaning progressi yangilandi");
});
