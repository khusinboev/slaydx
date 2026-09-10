import test from "node:test";
import assert from "node:assert/strict";
import { buildSlideDeck } from "../lib/generation/slides.ts";
import { buildSlideAcademicDoc } from "../lib/generation/slide-write.ts";
import { SLIDE_TEMPLATE_BY_ID } from "../lib/generation/slide-templates.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * Vizualni qadash (AUDIT-14): deka qaysi dizaynda RENDER qilingan bo'lsa,
 * ko'ruvchi, bosh sahifa kartasi va qayta yasash (`rebuildFile`) ham o'sha
 * dizaynda — reyestr o'zgarsa ham. Shablonlar 2 dan keyin `defense` (eski
 * `dense`) `formal` bo'lib chizila boshlagan edi — fayl va sayt ajralgan.
 */
delete process.env.GEMINI_API_KEY;
delete process.env.XAI_API_KEY;

const meta = (tpl: string) => extractMeta(TOOL_BY_ID.slide, { topic: "Himoya", slideTemplate: tpl } as never);
const base = (tpl: string, extra: Partial<AcademicDoc> = {}): AcademicDoc =>
  ({ meta: meta(tpl), titlePage: false, toc: false, sections: [], slideTemplate: tpl, slides: [{ id: "s0", layout: "title", title: "T" }], ...extra }) as AcademicDoc;

test("qadalgan `slideVisual` reyestrdan USTUN: eski deka `defense` + `dense` → dense (formal emas)", () => {
  assert.equal(SLIDE_TEMPLATE_BY_ID.defense.visual, "formal", "reyestr yangilangan");
  assert.equal(buildSlideDeck(base("defense", { slideVisual: "dense" })).visual, "dense");
  assert.equal(buildSlideDeck(base("defense")).visual, "formal", "qadalmagan — joriy reyestr");
  // MUTATSIYA: `isKnownVisual` tekshiruvi olib tashlansa — noma'lum qiymat o'tib ketardi.
  assert.equal(buildSlideDeck(base("defense", { slideVisual: "yo'q-dizayn" as never })).visual, "formal", "noma'lum vizual e'tiborsiz");
});

test("yangi deka render vaqtidagi dizaynni o'zi qadaydi (`buildSlideAcademicDoc` → slideVisual)", async () => {
  const doc = await buildSlideAcademicDoc(meta("lesson"), Date.now() + 30_000);
  assert.equal(doc.slideVisual, SLIDE_TEMPLATE_BY_ID.lesson.visual);
  assert.equal(buildSlideDeck(doc).visual, doc.slideVisual);
});
