import "./setup.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { sampleArticleDoc } from "../../lib/generation/article/samples.ts";
import type { DocMeta } from "../../lib/generation/types.ts";

/**
 * Maqola ko'ruvchisi — KLIENT yo'li (Maqola 2, WP2). SSR testlari
 * (`tests/viewer/article-*`) faqat o'lchov daraxtini ko'radi (sahifalash
 * `useLayoutEffect` da); bu yerda jsdom da haqiqiy sahifalash o'tadi va
 * VARAQDA KaTeX, o'rinbosar, jadval sarlavhasi, iqtibos belgisi borligi
 * qulflanadi. `katex` importi klient to'plamida ishlashi ham shu yerda
 * tekshiriladi.
 *
 * `useVisiblePage` `IntersectionObserver` ni so'raydi — jsdom da u yo'q.
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

const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

test("jsdom: maqola ko'ruvchisi sahifalaydi, varaqda KaTeX va rasm o'rinbosari bor", async () => {
  const doc = sampleArticleDoc(META);
  const { container } = render(h(WordViewer, { doc }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  const pages = container.querySelectorAll("[data-page]");
  assert.ok(pages.length >= 1, `varaqlar yo'q: ${pages.length}`);
  const inner = container.querySelector(".word-inner.word-article") as HTMLElement | null;
  assert.ok(inner, "maqola varag'i yo'q");
  assert.ok(inner!.style.padding.includes("3cm"), inner!.style.padding);
  assert.ok(container.querySelector("[data-page] .katex"), "varaqda KaTeX yo'q");
  assert.ok(container.querySelector("[data-page] .word-figure-placeholder"), "varaqda o'rinbosar yo'q");
  assert.ok(container.querySelector("[data-page] .word-table-caption"), "jadval sarlavhasi yo'q");
  assert.ok(container.querySelector('[data-page] .word-cite[data-ref-verified="openalex"]'), "iqtibos belgisi yo'q");
  cleanup();
});
