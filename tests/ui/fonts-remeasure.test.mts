import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, render } from "@testing-library/react";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Ops sprint WP-A: the document font (Tinos) is no longer preloaded
 * (`app/layout.tsx` `preload: false`), so the viewer's first measurement can
 * run on the fallback face. A finished font load (`document.fonts`
 * `loadingdone`) must re-measure the pages — `useMeasuredPages` (resume and
 * other measured viewers) and `WordViewer` (every Word-type result).
 *
 * jsdom has no layout and no `document.fonts`: the FontFaceSet is a stub
 * EventTarget installed BEFORE the viewer modules load (they attach their
 * listener at module evaluation), and every measured item reports the height
 * `itemH` — "fallback face" heights first, then the "real face" heights.
 *
 * Mutations (each turned the test red):
 *   1. `fontEpoch` removed from the `useMeasuredPages` signature → pages stay 3;
 *   2. `fontEpoch` removed from the `WordViewer` measure effect deps → page count unchanged;
 *   3. `watchFontLoads` listening to "loading" instead of "loadingdone" → both stale.
 */

const fonts = new window.EventTarget() as EventTarget & { status: string; ready: Promise<unknown> };
fonts.status = "loaded";
fonts.ready = Promise.resolve(fonts);
Object.defineProperty(document, "fonts", { configurable: true, value: fonts });

let itemH = 100;
const proto = window.HTMLElement.prototype;
const realRect = proto.getBoundingClientRect;
proto.getBoundingClientRect = function (this: HTMLElement) {
  // Children of the off-screen measure node (`aria-hidden`) — one per flow item.
  if (this.parentElement?.getAttribute("aria-hidden") === "true") {
    return { top: 0, bottom: itemH, height: itemH, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  }
  return realRect.call(this);
};

const { useMeasuredPages } = await import("../../components/viewers/measure.tsx");
const { WordViewer } = await import("../../components/viewers/WordViewer.tsx");
const { sampleArticleDoc } = await import("../../lib/generation/article/samples.ts");

afterEach(() => {
  cleanup();
  itemH = 100;
});

async function fontLoaded() {
  await act(async () => {
    fonts.dispatchEvent(new window.Event("loadingdone"));
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function Harness({ items }: { items: string[] }) {
  const { pages, measureNode } = useMeasuredPages(items, (t) => h("p", null, t), { limit: 250, key: "fixed" });
  return h("div", null, measureNode, h("output", { "data-pages": pages?.length ?? 0 }, pages?.map((p) => p.join(",")).join(" | ")));
}

test("useMeasuredPages: a finished font load re-measures (same items, same key)", async () => {
  const items = ["a", "b", "c", "d", "e", "f"];
  const { container } = render(h(Harness, { items }));
  await settle();
  const out = () => container.querySelector("[data-pages]");
  assert.equal(out()?.getAttribute("data-pages"), "3", "fallback face: 100 px items, 2 per 250 px page");

  // The real face is taller; nothing re-measures until the browser reports the load.
  itemH = 200;
  await settle();
  assert.equal(out()?.getAttribute("data-pages"), "3", "no spurious re-measure without a font event");

  await fontLoaded();
  assert.equal(out()?.getAttribute("data-pages"), "6", "real face: 200 px items, 1 per page");
  assert.equal(out()?.textContent, "a | b | c | d | e | f");
});

const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

test("WordViewer: pagination is measured again after the document font loads", async () => {
  itemH = 40;
  const doc: AcademicDoc = sampleArticleDoc(META);
  const { container } = render(h(WordViewer, { doc }));
  await settle();
  const before = container.querySelectorAll("[data-page]").length;
  assert.ok(before >= 1, "no pages rendered");

  itemH = 300;
  await fontLoaded();
  await settle();
  const after = container.querySelectorAll("[data-page]").length;
  assert.ok(after > before, `pages not re-measured after the font load: ${before} → ${after}`);

  // Same heights again: a second (unrelated) font load reproduces the same pagination.
  await fontLoaded();
  await settle();
  assert.equal(container.querySelectorAll("[data-page]").length, after, "re-measure with unchanged metrics must be stable");
});
