import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h, Suspense, useCallback, useState } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ArtifactViewer } from "../../components/viewers/ArtifactViewer.tsx";
import { resetViewerChunks, retryableLazy, SLOW_LOAD_MS, ViewerBoundary, ViewerLoading } from "../../components/viewers/ViewerBoundary.tsx";
import { CHUNK_RELOAD_KEY } from "../../lib/chunk-reload.ts";
import type { Generation } from "../../lib/types.ts";

/**
 * Ko'ruvchi bo'lagini yuklash: xato chegarasi + qayta urinish + skelet (V5b).
 *
 * Shartnoma:
 *  - bo'lak yuklanmasa: «Ko'ruvchini yuklab bo'lmadi» + «Qayta urinish»;
 *    qayta urinish `import()` ni HAQIQATAN qayta bajaradi (`React.lazy`
 *    rad etilgan promise'ni keshlaydi — `resetViewerChunks` usiz hech qachon tuzalmasdi);
 *  - ChunkLoadError (deploydan keyin) — qo'shimcha «Sahifani yangilash»;
 *  - Suspense zaxirasi — ramka kattaligidagi skelet, ~10 s dan oshsa maslahat + «Qayta urinish».
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `retry` dan `resetViewerChunks()` olib tashlandi → «qayta urinish import'ni qayta bajaradi» (calls 1 da qoldi);
 *   2. `ViewerBoundary` o'rniga oddiy fragment → «xato chegarasi» testlari (xato yuqoriga chiqdi);
 *   3. `ViewerLoading` dagi `slow ?` sharti doim false → «10 s dan keyin maslahat».
 */

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const chunkErr = () => Object.assign(new Error("Loading chunk 77 failed."), { name: "ChunkLoadError" });
const q = (sel: string) => document.querySelector<HTMLElement>(sel);

/** Haqiqiy bo'lak yuklanishini taqlid qiladi: `fail` true bo'lsa `import()` rad etiladi. */
function setup(opts: { failWith?: () => Error } = {}) {
  const state = { fail: true, calls: 0 };
  const Viewer = retryableLazy(async () => {
    state.calls += 1;
    if (state.fail) throw (opts.failWith ?? chunkErr)();
    return { default: ({ text }: { text: string }) => h("p", { "data-viewer-ok": "" }, text) };
  });
  function Host() {
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => {
      resetViewerChunks();
      setAttempt((a) => a + 1);
    }, []);
    return h(
      ViewerBoundary,
      { key: attempt, attempt, onRetry: retry },
      h(Suspense, { fallback: h(ViewerLoading, { onRetry: retry }) }, h(Viewer, { text: "Hujjat" })),
    );
  }
  return { state, Host };
}

test("bo'lak yuklanmadi: xato chegarasi «Ko'ruvchini yuklab bo'lmadi» + «Qayta urinish» + (ChunkLoadError) «Sahifani yangilash»", async () => {
  // Avtomatik qayta yuklash (bir martalik) bu testda sinalmaydi — jsdom `location.reload` ni bilmaydi.
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  const { Host } = setup();
  render(h(Host));
  await waitFor(() => assert.ok(q("[data-viewer-error]"), "xato holati"));
  assert.match(q("[role=alert]")!.textContent ?? "", /Ko‘ruvchini yuklab bo‘lmadi/);
  assert.ok(q("[data-viewer-retry]"), "«Qayta urinish»");
  assert.match(q("[data-viewer-retry]")!.textContent ?? "", /Qayta urinish/);
  assert.equal(q("[data-viewer-error]")!.getAttribute("data-viewer-error"), "chunk");
  assert.ok(q("[data-viewer-reload]"), "bo'lak xatosida «Sahifani yangilash» ham bor");
  assert.ok(!q("[data-viewer-loading]"), "skelet xato bilan almashdi");
});

test("oddiy (bo'lak emas) xatoda «Sahifani yangilash» yo'q, «Qayta urinish» bor", async () => {
  const { Host } = setup({ failWith: () => new Error("boom") });
  render(h(Host));
  await waitFor(() => assert.ok(q("[data-viewer-error]")));
  assert.equal(q("[data-viewer-error]")!.getAttribute("data-viewer-error"), "render");
  assert.ok(q("[data-viewer-retry]"));
  assert.ok(!q("[data-viewer-reload]"));
});

test("«Qayta urinish» import'ni HAQIQATAN qayta bajaradi: birinchisi rad etildi, ikkinchisi yuklandi", async () => {
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  const { state, Host } = setup();
  render(h(Host));
  await waitFor(() => assert.ok(q("[data-viewer-error]")));
  assert.equal(state.calls, 1);
  state.fail = false; // tarmoq tiklandi
  await act(async () => fireEvent.click(q("[data-viewer-retry]")!));
  await waitFor(() => assert.ok(q("[data-viewer-ok]"), "ko'ruvchi yuklandi"));
  assert.equal(state.calls, 2, "MUTATSIYA: resetViewerChunks yo'q bo'lsa lazy keshlangan rad etishni qayta otardi (calls = 1)");
  assert.equal(q("[data-viewer-ok]")!.textContent, "Hujjat");
  assert.ok(!q("[data-viewer-error]"));
});

test("qayta urinish yana yiqilsa — xato holati qaytadi (cheksiz skelet emas)", async () => {
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  const { state, Host } = setup();
  render(h(Host));
  await waitFor(() => assert.ok(q("[data-viewer-error]")));
  await act(async () => fireEvent.click(q("[data-viewer-retry]")!));
  await waitFor(() => assert.equal(state.calls, 2));
  await waitFor(() => assert.ok(q("[data-viewer-error]")));
});

test("Turbopack keshlagan rad etish: bo'lak xatosida qayta urinish ham yiqilsa — «Sahifani yangilash» asosiy tugma bo'ladi", async () => {
  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  const { state, Host } = setup(); // fail doim true — qayta urinish ham yiqiladi
  render(h(Host));
  await waitFor(() => assert.ok(q("[data-viewer-error]")));
  // Birinchi xatoda «Qayta urinish» asosiy.
  assert.match(q("[data-viewer-retry]")!.className, /bg-primary/);
  assert.ok(!/bg-primary/.test(q("[data-viewer-reload]")!.className));
  await act(async () => fireEvent.click(q("[data-viewer-retry]")!));
  await waitFor(() => assert.equal(state.calls, 2));
  await waitFor(() => assert.ok(q("[data-viewer-error]")));
  assert.match(q("[data-viewer-reload]")!.className, /bg-primary/, "MUTATSIYA: `stuck` olib tashlansa yangilash tugmasi ikkinchi darajali qolardi");
  assert.match(q("[data-viewer-error]")!.textContent ?? "", /Qayta urinish yordam bermadi/);
  assert.ok(q("[data-viewer-retry]"), "qayta urinish baribir turadi");
});

test("skelet: yuklanayotganda ramkani to'ldiradi (role=status, aria-busy), 10 s gacha maslahat yo'q", async () => {
  render(h(ViewerLoading, { onRetry() {} }));
  const box = q("[data-viewer-loading]")!;
  assert.equal(box.getAttribute("role"), "status");
  assert.equal(box.getAttribute("aria-busy"), "true");
  assert.match(box.className, /\bflex-1\b/, "ramka kattaligini to'ldiradi");
  assert.match(box.textContent ?? "", /Yuklanmoqda/);
  assert.ok(box.querySelector(".animate-pulse"), "skelet");
  assert.ok(!q("[data-viewer-slow]"), "darhol maslahat yo'q");
  assert.equal(SLOW_LOAD_MS, 10_000, "chegara ~10 s");
});

test("skelet: sekin yuklanganda maslahat va «Qayta urinish» (qayta urinish onRetry ni chaqiradi)", async () => {
  let retried = 0;
  render(h(ViewerLoading, { onRetry: () => (retried += 1), slowMs: 30 }));
  await waitFor(() => assert.ok(q("[data-viewer-slow]"), "MUTATSIYA: slow sharti doim false bo'lsa maslahat chiqmasdi"));
  assert.match(q("[data-viewer-slow]")!.textContent ?? "", /uzoq davom/);
  fireEvent.click(q("[data-viewer-slow] [data-viewer-retry]")!);
  assert.equal(retried, 1);
});

test("ArtifactViewer: haqiqiy rasm ko'ruvchisi chegara ichida yuklanadi (ramka + data-viewer-frame saqlanadi)", async () => {
  const gen = {
    id: "g-img",
    type: "image",
    topic: "Bahor",
    status: "COMPLETED",
    format: "png",
    fileName: "bahor.png",
    doc: { meta: { topic: "Bahor" }, images: [{ id: "i1", url: "/i1.png", w: 800, h: 800, mime: "image/png" }], imageStyle: "photo", imageRatio: "1:1" },
  } as unknown as Generation;
  render(h(ArtifactViewer, { gen }));
  const frame = q("[data-viewer-frame]")!;
  assert.equal(frame.getAttribute("data-viewer-kind"), "image");
  assert.ok(q("[data-viewer-loading]"), "birinchi kadrda skelet (ramka ichida)");
  await waitFor(() => assert.ok(q("[data-image-viewer]"), "ko'ruvchi yuklandi"), { timeout: 4000 });
  assert.ok(frame.contains(q("[data-image-viewer]")));
  assert.ok(!q("[data-viewer-loading]") && !q("[data-viewer-error]"));
});

test("ArtifactViewer manbasi: chegara + zaxira skelet + resetViewerChunks ulangan (`key` bo'yicha qayta o'rnatish)", () => {
  const src = readFileSync(new URL("../../components/viewers/ArtifactViewer.tsx", import.meta.url), "utf8");
  assert.match(src, /<ViewerBoundary key=\{attempt\} attempt=\{attempt\} onRetry=\{retry\}>/);
  assert.match(src, /fallback=\{<ViewerLoading onRetry=\{retry\} \/>\}/);
  assert.match(src, /resetViewerChunks\(\);\s*\n\s*setAttempt/);
  assert.ok(!/\blazy\(/.test(src.replace(/retryableLazy\(/g, "")), "to'g'ridan-to'g'ri `lazy(` yo'q — hammasi qayta urinadigan o'ramda");
  assert.ok(src.includes("export const SlideViewer = retryableLazy("), "jonli ko'rinish uchun SlideViewer eksporti saqlangan");
});
