import test from "node:test";
import assert from "node:assert/strict";
import { buildPreview } from "../lib/server/preview.ts";
import { buildSlideDeck } from "../lib/generation/slides.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * P1 — "Mening fayllarim" kartochkasida BIRINCHI SLAYD ko'ruvchidagidek.
 *
 * `buildPreview` slayd dekalari (`doc.slides` bor) uchun endi rasm/matn
 * o'rniga BIRINCHI slaydning to'liq maket modelini (`preview.slide`)
 * qaytaradi — kartochka (`components/home/FilePreview.tsx`) uni
 * `SlideCanvas` bilan ko'ruvchidagidek chizadi. Bu yerda ikkita narsa
 * qulflanadi: (1) qiymatlar `buildSlideDeck` bergan bilan AYNAN bir xil
 * — ikkinchi "chizish manbasi" paydo bo'lmasin; (2) `notes` (notiq
 * matni) tashlanadi — ustun hajmini bekorga oshirmasin.
 */

const meta = extractMeta(TOOL_BY_ID.slide, {
  topic: "Suv aylanishi",
  slideTemplate: "lecture",
} as never);

function slideDoc(slides: SlideModel[], extra: Partial<AcademicDoc> = {}): AcademicDoc {
  return {
    meta,
    titlePage: true,
    toc: true,
    sections: [],
    slides,
    ...extra,
  } as AcademicDoc;
}

// ─────────────────────────────────────────── slayd hujjat → preview.slide

test("slayd hujjat uchun preview.slide birinchi slaydning to'liq modelini beradi", () => {
  const slides: SlideModel[] = [
    { id: "s0", layout: "title", title: "Suv aylanishi", subtitle: "Kirish" },
    { id: "s1", layout: "bullets", title: "Asosiy g'oyalar", bullets: ["A", "B"] },
  ];
  const doc = slideDoc(slides);
  const deck = buildSlideDeck(doc);

  const preview = buildPreview(doc);
  assert.ok(preview, "preview qaytishi kerak");
  const slide = preview.slide;
  assert.ok(slide, "preview.slide bo'lishi kerak — MUTATSIYA: shu maydon yozilmasa shu yerda ushlanadi");

  // Model — birinchi slayd, IKKINCHI EMAS.
  assert.equal(slide!.model.id, "s0");
  assert.equal(slide!.model.title, "Suv aylanishi");
  assert.equal(slide!.model.layout, "title");

  // Maket qiymatlari `buildSlideDeck` bilan AYNAN bir xil — ikkinchi
  // "chizish manbasi" yo'q ("ko'rdim = oldim").
  assert.equal(slide!.themeId, deck.themeId);
  assert.equal(slide!.templateId, deck.templateId);
  assert.equal(slide!.visual, deck.visual);
  assert.equal(slide!.audience, deck.audience);
  assert.deepEqual(slide!.bodyType, deck.bodyType);

  // Eski shakl (`url`/`lines`) endi YO'Q — kartochka ikki xil yo'lni
  // bir vaqtda ko'rsatmasin.
  assert.equal(preview!.url, undefined);
  assert.equal(preview!.lines, undefined);
});

test("preview.slide ikkinchi emas, DOIM birinchi slaydni ko'rsatadi", () => {
  const slides: SlideModel[] = [
    { id: "cover", layout: "title", title: "Muqova" },
    { id: "agenda", layout: "agenda", title: "Reja", bullets: ["1", "2"] },
    { id: "body", layout: "bullets", title: "Tana", bullets: ["X"] },
  ];
  const preview = buildPreview(slideDoc(slides));
  assert.equal(preview?.slide?.model.id, "cover");
});

test("slaydLogo bo'lsa preview.slide.logo asset URL'ni oladi", () => {
  const slides: SlideModel[] = [{ id: "s0", layout: "title", title: "T" }];
  const withLogo = buildPreview(
    slideDoc(slides, { slideLogo: { url: "/api/generations/x/assets/logo.png" } }),
  );
  assert.equal(withLogo?.slide?.logo, "/api/generations/x/assets/logo.png");

  const withoutLogo = buildPreview(slideDoc(slides));
  assert.equal(withoutLogo?.slide?.logo, undefined);
});

// ───────────────────────────────────────────────────── notes tashlanadi

test("notes preview.slide.model'da yo'q — hajmni bekorga oshirmaydi", () => {
  const longNotes = "N".repeat(5000);
  const slides: SlideModel[] = [
    { id: "s0", layout: "bullets", title: "Sarlavha", bullets: ["A"], notes: longNotes },
  ];
  const preview = buildPreview(slideDoc(slides));

  assert.ok(preview?.slide);
  // `notes` maydoni o'zi umuman yo'q (faqat `undefined` emas — kalit yo'q).
  assert.equal(Object.prototype.hasOwnProperty.call(preview!.slide!.model, "notes"), false);
  assert.doesNotMatch(JSON.stringify(preview), /NNNNN/, "notes matni JSON ichida chiqmasligi kerak");

  // MUTATSIYA: `notes` tashlanmasa — 5000 belgili matn hajmni portlatadi.
  const size = Buffer.byteLength(JSON.stringify(preview), "utf8");
  assert.ok(size < 2000, `notes tashlanmasa hajm portlaydi (${size} bayt chiqdi)`);
});

test("odatiy slayd (rasmsiz, qisqa matnli) preview taxminan 4 KB dan kichik", () => {
  const slides: SlideModel[] = [
    {
      id: "s0",
      layout: "bullets",
      title: "Odatiy sarlavha",
      bullets: ["Birinchi band", "Ikkinchi band", "Uchinchi band"],
    },
  ];
  const preview = buildPreview(slideDoc(slides));
  assert.ok(preview?.slide, "preview.slide bo'lishi kerak");
  const size = Buffer.byteLength(JSON.stringify(preview), "utf8");
  assert.ok(size < 4096, `rasmsiz slayd 4 KB dan katta chiqdi: ${size} bayt`);
});

// ──────────────────────────────────────────────── eski yo'l (slaydsiz)

test("doc.slides bo'lmasa eski yo'l (url/lines) ishlayveradi", () => {
  const doc = {
    meta,
    titlePage: true,
    toc: true,
    sections: [
      {
        id: "sec1",
        title: "Bo'lim",
        blocks: [
          { kind: "p", text: "Bu yetarlicha uzun paragraf matni — o'n ikki belgidan ko'p." },
        ],
      },
    ],
  } as AcademicDoc;

  const preview = buildPreview(doc);
  assert.ok(preview);
  assert.equal(preview!.slide, undefined);
  assert.ok(preview!.lines && preview!.lines.length > 0);
});

test("doc.slides bo'sh massiv bo'lsa ham eski yo'lga tushadi (yiqilmaydi)", () => {
  const doc = { meta, titlePage: true, toc: true, sections: [], slides: [] } as AcademicDoc;
  const preview = buildPreview(doc);
  assert.equal(preview, null);
});

test("doc null bo'lsa null qaytadi", () => {
  assert.equal(buildPreview(null), null);
});
