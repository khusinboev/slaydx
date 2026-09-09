import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { SlideViewer } from "../../components/viewers/SlideViewer.tsx";
// `__SlideViewerOld.fixture.tsx` — F2 bo'linishidan OLDINGI `SlideViewer.tsx`
// bilan bayt-baytiga bir xil (`git show f8c33c8:components/viewers/SlideViewer.tsx`
// dan olingan, faqat eksport nomi `SlideViewerOld` ga o'zgartirilgan — shu
// direktoriyada turgani uchun `./toolbar`, `./SlideCanvas` importlari
// oldingidek to'g'ri joyni ko'rsatadi). Parity testi shu ikkisini solishtiradi.
import { SlideViewerOld } from "../../components/viewers/__SlideViewerOld.fixture.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * F2 — `SlideViewer.tsx` seam'larga bo'lindi (`SlideRail`, `SlideStage`,
 * `useSlideKeys`), lekin xatti-harakat 1:1 saqlanishi SHART: keyingi ikki
 * paket (jonli generatsiya, tahrirlash) parallel tegadi, shuning uchun
 * bo'linish o'zi hech narsani o'zgartirmasligi kerak.
 */

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Sarlavha slaydi", subtitle: "Ikkinchi qator" },
  { id: "s1", layout: "bullets", title: "Band slaydi", bullets: ["Birinchi band.", "Ikkinchi band.", "Uchinchi band."] },
  { id: "s2", layout: "bullets", title: "Yakuniy slayd", bullets: ["Xulosa gapi."] },
];

function sampleDoc(): AcademicDoc {
  return {
    meta: {
      topic: "Namunaviy mavzu",
      author: "Aliyev Ali",
      workLabel: "Taqdimot",
      speakerNotes: true,
    },
    titlePage: false,
    toc: false,
    sections: [],
    slides,
  } as unknown as AcademicDoc;
}

test("SlideViewer SSR HTML bo'linishdan OLDIN va KEYIN AYNAN bir xil", () => {
  const doc = sampleDoc();
  const before = renderToStaticMarkup(h(SlideViewerOld, { doc }));
  const after = renderToStaticMarkup(h(SlideViewer, { doc }));
  assert.equal(after, before, "SlideViewer bo'linishi HTML chiqishini o'zgartirmasligi kerak");
});

test("SlideViewer: overlay berilsa sahnada qo'shimcha element chiqadi", () => {
  const doc = sampleDoc();
  const marker = "seam-overlay-marker";
  const withOverlay = renderToStaticMarkup(
    h(SlideViewer, {
      doc,
      overlay: () => h("div", { "data-testid": marker }, "overlay"),
    }),
  );
  assert.ok(withOverlay.includes(marker), "overlay slot chizilishi kerak");
});

test("SlideViewer: overlay berilmasa qo'shimcha element chiqmaydi", () => {
  const doc = sampleDoc();
  const marker = "seam-overlay-marker";
  const withoutOverlay = renderToStaticMarkup(h(SlideViewer, { doc }));
  assert.ok(!withoutOverlay.includes(marker), "overlay berilmasa markyor chiqmasligi kerak");

  const before = renderToStaticMarkup(h(SlideViewerOld, { doc }));
  assert.equal(withoutOverlay, before, "overlay yo'q holatda HTML eski komponent bilan bir xil qolishi kerak");
});
