import test from "node:test";
import assert from "node:assert/strict";
import { composePrompt, withGrounding, IMAGE_STYLES, packImages } from "../lib/generation/image-studio.ts";

/**
 * Rasm studiyasi (Sprint 16).
 *
 * Jonli tekshiruv (`scripts/image-lab.mts`) bir xil sahna va seed bilan
 * 8 uslubdan 6 tasi (foto, kino, illyustratsiya, 3D, minimal, mahsulot)
 * DEYARLI BIR XIL fotografik rasm chiqarganini ko'rsatdi — foydalanuvchi
 * xabar qilgan aynan shu xato. Bu testlar fotodan farqli VOSITA
 * kutiladigan har bir uslubda kod darajasida haqiqatan ham kuchli,
 * bir-biridan farqli lug'at borligini qotiradi — shunda kelajakda
 * kimdir suffiksni yana yumshoq matnga qaytarib qo'ysa, test ushlaydi.
 */

const NON_PHOTO_STYLES = ["illustration", "watercolor", "render3d", "pencil", "chalk"];

test("foto bo'lmagan uslublar aniq «bu foto emas» signalini beradi", () => {
  for (const id of NON_PHOTO_STYLES) {
    const style = IMAGE_STYLES.find((s) => s.id === id)!;
    assert.match(
      style.suffix,
      /NOT a photograph/,
      `${id} uslubi fotorealizmni aniq inkor etishi kerak — aks holda past qadamli modelda fotoga aylanib qoladi`,
    );
  }
});

test("har bir uslubning lug'ati o'ziga xos — nusxa ko'chirish yo'q", () => {
  const suffixes = IMAGE_STYLES.map((s) => s.suffix);
  const unique = new Set(suffixes);
  assert.equal(unique.size, suffixes.length, "ikkita uslub bir xil suffiks bilan qolib ketmasligi kerak");
});

test("uslub identifikatorlari o'zgarmagan (forma ular bilan ishlaydi)", () => {
  const ids = IMAGE_STYLES.map((s) => s.id);
  // `chalk` WP-E da qo'shildi — slayd uslublari (`SLIDE_IMAGE_STYLES`)
  // shu ro'yxatdan oziqlanadi, shuning uchun id lar shu yerda qulflanadi.
  assert.deepEqual(ids, ["photo", "cinematic", "illustration", "watercolor", "render3d", "minimal", "pencil", "chalk", "product"]);
});

test("composePrompt — asosiy mavzu, uslub va freym birga keladi", () => {
  const prompt = composePrompt("a red apple on a table", "watercolor", 1024, 576);
  assert.match(prompt, /MAIN SUBJECT.*a red apple on a table/);
  assert.match(prompt, /NOT a photograph/, "tanlangan uslub suffiksi qo'shilishi kerak");
  assert.match(prompt, /Wide 1024x576/, "landshaft uchun gorizontal freym ko'rsatmasi");
});

test("composePrompt — portret nisbatda vertikal freym ko'rsatmasi", () => {
  const prompt = composePrompt("a tall tree", "photo", 576, 1024);
  assert.match(prompt, /Vertical 576x1024/);
  assert.doesNotMatch(prompt, /Wide/);
});

test("composePrompt — matn/yozuvga qat'iy taqiq bor", () => {
  /*
   * Jonli tekshiruvda model haqiqiy binoga «CHAOSSU» kabi buzuq yozuv
   * chizib qo'ygani aniqlandi. Oddiy "no text" o'rniga devor/peshtoqni
   * ANIQ bo'sh deb belgilash kerak edi.
   */
  const prompt = composePrompt("a building", "photo", 1024, 1024);
  assert.match(prompt, /no text, letters, numbers, signage, plaques, inscriptions/i);
  assert.match(prompt, /blank of any writing/i);
});

test("withGrounding — fakt bo'lsa qo'shiladi, bo'lmasa sahna o'zgarmaydi", () => {
  assert.equal(withGrounding("a mosque", ""), "a mosque");
  assert.equal(
    withGrounding("a mosque", "three separate portals"),
    "a mosque Known visual facts about this exact subject: three separate portals.",
  );
});

test("withGrounding — atrofdagi bo'shliqlar tozalanadi", () => {
  assert.equal(withGrounding("  a mosque  ", ""), "a mosque");
});

test("packImages — kam yetkazilgan hajm delivered maydonida qayd etiladi", () => {
  const files = [{ name: "rasm-1.png", bytes: new Uint8Array([1, 2, 3]), mime: "image/png" }];
  return packImages(files, "test", 4).then((out) => {
    assert.deepEqual(out.delivered, { got: 1, want: 4 });
    assert.equal(out.fileName, "test.png");
  });
});
