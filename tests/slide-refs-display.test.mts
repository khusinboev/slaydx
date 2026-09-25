import test from "node:test";
import assert from "node:assert/strict";
import { applyResearchRefs } from "../lib/generation/slide-write.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { SlidePromptCtx } from "../lib/generation/slide-prompt/ctx.ts";
import type { SlideResearch } from "../lib/generation/slide-research.ts";

/**
 * BELTS-AND-BRACES (AUDIT-25 P10, 2026-09-25).
 *
 * `slide-research.ts resolveSources` Google redirectini (`vertexaisearch.
 * cloud.google.com`) HAQIQIY manzilga ochishga harakat qiladi, lekin
 * sekin DNS'da baribir yiqilishi mumkin (jonli holat: 8 ta HEAD bitta
 * 3 s'lik abort ostida hammasi birga o'lgan). Bunday holatda
 * `SlideSource.uri` hali ham redirect bo'lib qoladi.
 *
 * Bu fayl ikkinchi qatlamni qulflaydi: `applyResearchRefs` OCHOLMAGAN
 * manbani references slaydiga URL sifatida YOZMASLIGI kerak — chunki
 * (a) o'quvchiga foydasiz (redirect ID hech narsa aytmaydi) va
 * (b) muddati o'tib havola o'ladi. `slideResearch.sources` (provenance
 * uchun xom `uri`) o'zgarmaydi — faqat KO'RSATILADIGAN `refs` farq
 * qiladi.
 */

function refsSlide(): SlideModel {
  return { id: "s0", layout: "references", title: "Manbalar" };
}

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/zzz";

test("ocholmagan Google redirect — references slaydida URL sifatida YOZILMAYDI, domen qoladi", () => {
  const research: SlideResearch = {
    facts: "x",
    sources: [
      { title: "president.uz", uri: "https://president.uz/a" }, // muvaffaqiyatli ochilgan
      { title: "daryo.uz", uri: REDIRECT }, // ocholmagan — hali ham redirect
    ],
    queries: [],
  };
  const slides = [refsSlide()];
  applyResearchRefs(slides, { research } as SlidePromptCtx);
  const refs = slides[0].refs;
  assert.ok(refs, "refs to'ldirilishi kerak");
  assert.equal(refs!.length, 2);

  // Ochilgan manba — to'liq havola bilan qoladi (o'zgarishsiz).
  assert.equal(refs![0].source, "https://president.uz/a");

  // Ocholmagan manba — MUTATSIYA TEKSHIRUVI: eski kod `source: src.uri`
  // yozar edi va bu yerda REDIRECT chiqar edi. Shu assert ANIQ shuni
  // ushlaydi (qo'lda tekshirildi — pastdagi hisobotda).
  assert.notEqual(refs![1].source, REDIRECT, "redirect URL to'g'ridan-to'g'ri ko'rsatilmasligi kerak");
  assert.ok(!refs![1].source.includes("vertexaisearch"), "redirect xosti umuman ko'rinmasin");
  assert.equal(refs![1].source, "daryo.uz", "domen (title) bilan cheklansin");

  // «Bo'sh qoldirish» YO'Q variant — planReferences ikkinchi qatorni
  // OCH qoldirmasligi kerak (task talabi: bo'sh ikkinchi qator yo'q).
  assert.ok(refs![1].source.length > 0, "bo'sh qator qoldirmaslik — ikkinchi qator OCH qolmasin");
});

test("hammasi ochilgan bo'lsa — hech narsa o'zgarmaydi, hammasi to'liq havola", () => {
  const research: SlideResearch = {
    facts: "x",
    sources: [
      { title: "president.uz", uri: "https://president.uz/a" },
      { title: "daryo.uz", uri: "https://daryo.uz/b" },
    ],
    queries: [],
  };
  const slides = [refsSlide()];
  applyResearchRefs(slides, { research } as SlidePromptCtx);
  assert.deepEqual(
    slides[0].refs,
    [
      { title: "president.uz", source: "https://president.uz/a" },
      { title: "daryo.uz", source: "https://daryo.uz/b" },
    ],
    "muvaffaqiyatli holatda eski xatti-harakat saqlansin",
  );
});

test("references bo'lmagan slaydga tegilmaydi", () => {
  const research: SlideResearch = { facts: "x", sources: [{ title: "a.uz", uri: REDIRECT }], queries: [] };
  const slides: SlideModel[] = [{ id: "s0", layout: "bullets", title: "Boshqa" }];
  applyResearchRefs(slides, { research } as SlidePromptCtx);
  assert.equal(slides[0].refs, undefined, "references bo'lmagan slaydda refs paydo bo'lmasin");
});
