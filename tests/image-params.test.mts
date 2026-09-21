import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { composePrompt, imageRatioById } from "../lib/generation/image-studio.ts";
import { IMAGE_FORM_FIELDS, IMAGE_PARAMS, type ImageParamImpact } from "../lib/generation/image-params.ts";

/**
 * RASM PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati (WP-E,
 * `tests/slide-params.test.mts`/`tests/resume-params.test.mts` naqshi).
 *
 * Zond sof funksiyalar orqali: `composePrompt` (prompt matni),
 * `imageRatioById` (chiqish o'lchami), `priceFor` (narx). Tarmoqqa
 * chiqadigan `buildImageArtifact`/`expandPrompt` bu yerda CHAQIRILMAYDI.
 */

const image = TOOL_BY_ID.image;

const BASE: FormValues = {
  prompt: "a mountain village at sunrise",
  imageStyle: "photo",
  imageRatio: "1:1",
  imageCount: 1,
};

function signature(v: FormValues) {
  const merged = { ...BASE, ...v };
  const styleId = String(merged.imageStyle || "photo");
  const ratio = imageRatioById(String(merged.imageRatio || "1:1"));
  return {
    prompt: composePrompt(String(merged.prompt || ""), styleId, ratio.w, ratio.h),
    size: `${ratio.w}x${ratio.h}`,
    price: priceFor(image, merged),
  };
}

test("reyestr: id lar noyob, har parametrda ta'sir va ikki xil zond bor", () => {
  const ids = new Set<string>();
  for (const p of IMAGE_PARAMS) {
    assert.ok(!ids.has(p.id), `${p.id}: takror`);
    ids.add(p.id);
    assert.ok(p.impacts.length > 0, `${p.id}: ta'sir e'lon qilinmagan — bezak maydon`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond qiymatlari bir xil`);
  }
  assert.deepEqual(IMAGE_FORM_FIELDS, ["prompt", "imageStyle", "imageRatio", "imageCount"]);
});

test("har parametr e'lon qilingan HAR ta'sirda A ≠ B beradi", () => {
  for (const p of IMAGE_PARAMS) {
    const sigA = signature({ [p.id]: p.probeA });
    const sigB = signature({ [p.id]: p.probeB });
    for (const impact of p.impacts as ImageParamImpact[]) {
      assert.notDeepEqual(sigA[impact], sigB[impact], `${p.id}: e'lon qilingan «${impact}» ta'sirida A va B farq qilmadi`);
    }
  }
});

test("e'lon qilinmagan ta'sirlarda boshqa parametrlar bir-biriga qarab o'zgarmaydi (izolyatsiya)", () => {
  // MUTATSIYA: `imageCount` narxni o'zgartirmasa (masalan `priceFor` chaqirilmasa) — bu test qizil bo'ladi.
  const a = signature({ imageCount: 1 });
  const b = signature({ imageCount: 4 });
  assert.equal(a.price, 2000);
  assert.equal(b.price, 6000);
  assert.notEqual(a.price, b.price);
  // Narxga bog'liq bo'lmagan `prompt`/`size` `imageCount` o'zgarganda o'zgarmasligi kerak.
  assert.equal(a.prompt, b.prompt);
  assert.equal(a.size, b.size);
});

test("imageRatio o'lchamni HAM, promptdagi freym ko'rsatmasini HAM o'zgartiradi", () => {
  const square = signature({ imageRatio: "1:1" });
  const portrait = signature({ imageRatio: "9:16" });
  assert.notEqual(square.size, portrait.size);
  assert.match(square.prompt, /Wide|Vertical/);
  assert.match(portrait.prompt, /Vertical/);
});
