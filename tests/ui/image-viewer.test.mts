import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, cleanup } from "@testing-library/react";
import { ImageViewer } from "../../components/viewers/ImageViewer.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * Natija sahifasi yorlig'i (Formalar 3 / AUDIT-24, WP-D2d) —
 * `docs/research/forms3-oqituvchi.md` §4: infografika natija sahifasida
 * «Foto · 1:1 · N rasm» yorlig'i mazmunsiz edi (plakat uslub/nisbatga ega
 * emas). Endi yorliq `doc.infographic` MODELIDAN o'qiladi (`ResultView.tsx`
 * `isPoster` bilan bitta naqsh) — qattiq yozilgan matn emas.
 *
 * Mutatsiya (qo'lda tekshirildi): `poster ? … : …` shartidan `poster ?`
 * olib tashlansa (doim eski yorliq) — ikkinchi test qizaradi.
 */
afterEach(() => cleanup());

function fotoDoc(): AcademicDoc {
  return {
    meta: { topic: "Bahor manzarasi" },
    images: [{ id: "i1", url: "/x.png", w: 800, h: 800, mime: "image/png" }],
    imageStyle: "photo",
    imageRatio: "1:1",
  } as unknown as AcademicDoc;
}

function posterDoc(): AcademicDoc {
  return {
    meta: { topic: "Suv aylanishi" },
    images: [{ id: "i1", url: "/x.png", w: 2480, h: 3508, mime: "image/png" }],
    infographic: {
      v: 1,
      spec: {
        title: "Suv aylanishi — asosiy jihatlari",
        type: "list",
        blocks: [{ id: "b1" }, { id: "b2" }, { id: "b3" }, { id: "b4" }, { id: "b5" }],
        palette: "indigo",
        size: "A4",
        language: "uz",
      },
    },
  } as unknown as AcademicDoc;
}

test("rasm vositasi: eski yorliq «uslub · nisbat · N rasm» saqlanadi", () => {
  render(h(ImageViewer, { doc: fotoDoc() }));
  assert.match(document.body.textContent ?? "", /1:1 · 1 rasm/);
});

test("infografika: yorliq «Infografika · A4 · N blok» (doc.infographic dan)", () => {
  render(h(ImageViewer, { doc: posterDoc() }));
  const text = document.body.textContent ?? "";
  assert.match(text, /Infografika · A4 · 5 blok/);
  assert.doesNotMatch(text, /rasm$/m, "eski «N rasm» so'zi ko'rinmasligi kerak");
  assert.match(text, /Suv aylanishi — asosiy jihatlari/, "sarlavha spec.title dan");
});
