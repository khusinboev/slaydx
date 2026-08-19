import test from "node:test";
import assert from "node:assert/strict";
import {
  isToolSlug,
  missingRequired,
  priceFor,
  TOOLS,
  TOOL_BY_ID,
  TOOL_BY_SLUG,
  topicOf,
} from "../lib/tools.ts";

/**
 * Narx — server tomonda hisoblanadi, shuning uchun uning barqarorligi
 * to'g'ridan-to'g'ri pul masalasi.
 */

test("har bir vosita uchun narx musbat va butun son", () => {
  for (const tool of TOOLS) {
    const price = priceFor(tool, {});
    assert.ok(Number.isInteger(price) && price > 0, `${tool.id}: ${price}`);
  }
});

test("klient yuborgan 'price' e'tiborga olinmaydi", () => {
  const essay = TOOL_BY_ID.essay;
  assert.equal(priceFor(essay, { price: 1, basePrice: 1 }), essay.basePrice);
});

test("kattaroq hajm — qimmatroq", () => {
  const cw = TOOL_BY_ID.coursework;
  assert.ok(priceFor(cw, { pages: "40-45" }) > priceFor(cw, { pages: "10-15" }));

  const ref = TOOL_BY_ID.referat;
  assert.ok(priceFor(ref, { pages: "25-30" }) > priceFor(ref, { pages: "10-15" }));
});

test("noma'lum hajm — standart narx, 0 emas", () => {
  const cw = TOOL_BY_ID.coursework;
  assert.equal(priceFor(cw, { pages: "yo'q-bunday" }), cw.basePrice);
  assert.ok(priceFor(TOOL_BY_ID.referat, { pages: "999" }) > 0);
});

test("slayd sifat paketlari", () => {
  const slide = TOOL_BY_ID.slide;
  assert.equal(priceFor(slide, { quality: "standard" }), 3000);
  assert.equal(priceFor(slide, { quality: "premium_long" }), 8000);
  assert.equal(priceFor(slide, { quality: "aldash" }), 3000);
});

test("rasm soni narxga ta'sir qiladi", () => {
  const img = TOOL_BY_ID.image;
  assert.ok(priceFor(img, { imageCount: 4 }) > priceFor(img, { imageCount: 1 }));
  // Manfiy son bilan bepul qilishga urinish.
  assert.ok(priceFor(img, { imageCount: -5 }) > 0);
});

test("slug xaritasi to'liq va id bilan mos", () => {
  for (const tool of TOOLS) {
    assert.equal(TOOL_BY_SLUG[tool.slug], tool);
    assert.equal(TOOL_BY_ID[tool.id], tool);
    assert.ok(isToolSlug(tool.slug));
  }
  assert.equal(isToolSlug("../../etc/passwd"), false);
  assert.equal(isToolSlug("constructor"), false);
  // `rasm` slug'i `image` id ga tegishli — ular teng emas.
  assert.equal(TOOL_BY_SLUG.rasm.id, "image");
});

test("topicOf hech qachon bo'sh qaytarmaydi", () => {
  for (const tool of TOOLS) {
    assert.ok(topicOf({}, tool).length > 0, tool.id);
  }
  assert.ok(topicOf({ topic: "   " }, TOOL_BY_ID.essay).length > 0);
});

// ------------------------------------------------- majburiy maydonlar

test("OTME ishlari universitetsiz qabul qilinmaydi", () => {
  const base = { topic: "Mavzu", author: "Aliyev A." };
  for (const id of ["coursework", "referat", "thesis", "mustaqil-ish"] as const) {
    const missing = missingRequired(TOOL_BY_ID[id], base);
    assert.ok(
      missing.some((m) => /muassasa/i.test(m)),
      `${id}: universitet talab qilinishi kerak — ${JSON.stringify(missing)}`,
    );
  }
  // Insho ko'pincha maktab ishi — undan talab qilinmaydi.
  assert.equal(missingRequired(TOOL_BY_ID.essay, base).length, 0);
});

test("mavzu talab qilinadi, «fayl asosida» rejimida esa manba matni", () => {
  const referat = TOOL_BY_ID.referat;
  const full = { author: "A", university: "TDPU" };
  assert.ok(missingRequired(referat, full).some((m) => /mavzu/i.test(m)));
  assert.equal(missingRequired(referat, { ...full, topic: "X" }).length, 0);

  // Fayl rejimida mavzu emas, manba matni kerak.
  assert.ok(missingRequired(referat, { ...full, mode: "file" }).some((m) => /manba/i.test(m)));
  assert.equal(missingRequired(referat, { ...full, mode: "file", sourceText: "matn" }).length, 0);
});

test("to'liq to'ldirilgan forma bo'sh ro'yxat qaytaradi", () => {
  const ok = missingRequired(TOOL_BY_ID.coursework, {
    topic: "O'qish ko'nikmasi",
    author: "Karimova M.",
    university: "TDPU",
  });
  assert.deepEqual(ok, []);
});
