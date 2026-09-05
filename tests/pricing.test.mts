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

/**
 * Insho narxi varaqqa bog'liq (N-6).
 *
 * Ilgari 1 varaq ham, 5 varaq ham 2 000 tanga turardi — forma 1–5
 * varaq tanlovini bersa ham, `priceFor` da `essay` uchun alohida shart
 * yo'q edi, shuning uchun har doim `tool.basePrice` qaytardi.
 */
test("insho narxi varaqqa bog'liq", () => {
  const essay = TOOL_BY_ID.essay;
  assert.equal(priceFor(essay, { pages: "1" }), essay.basePrice);
  assert.ok(priceFor(essay, { pages: "5" }) > priceFor(essay, { pages: "1" }));
  let prev = 0;
  for (const p of ["1", "2", "3", "4", "5"]) {
    const price = priceFor(essay, { pages: p });
    assert.ok(price >= prev, `${p} varaq narxi kamayib ketdi`);
    prev = price;
  }
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

/**
 * Glossariy atama soni narxga ta'sir qiladi (N-7).
 *
 * Ilgari atama soni tanlanmasdi — doim ~14 ta, doim 6 000 tanga. Endi
 * 10/20/40 tanlanadi va narx shunga bog'liq; tanlanmasa (eski xatti-
 * harakat) 10 talik — ya'ni asosiy narx — ishlatiladi.
 */
test("glossariy atama soni narxga ta'sir qiladi", () => {
  const glossary = TOOL_BY_ID.glossary;
  assert.equal(priceFor(glossary, { termCount: "10" }), 6000);
  assert.ok(priceFor(glossary, { termCount: "20" }) > priceFor(glossary, { termCount: "10" }));
  assert.ok(priceFor(glossary, { termCount: "40" }) > priceFor(glossary, { termCount: "20" }));
  assert.equal(priceFor(glossary, {}), glossary.basePrice);
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

test("kalitsiz xizmat sotilmaydi", async () => {
  const { TOOLS, TOOL_BY_ID, toolBlockedReason } = await import("../lib/tools.ts");

  /*
   * AYNAN N-6 (Sprint 14). `/api/auth/session` `llm` va `images`
   * bayroqlarini allaqachon qaytarardi, lekin UI da ikkalasi ham HECH
   * QAYERDA o'qilmasdi. `FAL_KEY` yo'q bo'lsa «Rasm generate» to'liq
   * ko'rinar va sotilardi: to'lov → navbat → «FAL_KEY missing» → xato →
   * qaytarish. Pul qaytadi, vaqt qaytmaydi.
   */
  const all = { llm: true, images: true };
  const noImages = { llm: true, images: false };
  const noLlm = { llm: false, images: true };
  const nothing = { llm: false, images: false };

  // Hammasi sozlangan — hech narsa to'silmaydi.
  for (const t of TOOLS) {
    assert.equal(toolBlockedReason(t, all), null, `${t.id} to'silmasligi kerak`);
  }

  // Rasm kaliti yo'q — FAQAT rasm vositasi to'siladi.
  assert.ok(toolBlockedReason(TOOL_BY_ID.image, noImages), "rasm vositasi to'silishi kerak");
  for (const t of TOOLS.filter((x) => x.custom !== "image")) {
    assert.equal(toolBlockedReason(t, noImages), null, `${t.id}: matn xizmati ishlashi kerak`);
  }

  /*
   * Matn kaliti yo'q — barcha matn xizmatlari to'siladi. Sabab
   * `buildArtifact` da: kalit BOR bo'lsa u xato tashlaydi, kalit YO'Q
   * bo'lsa esa shablon hujjatni qaytaradi va TO'LIQ narx olinadi. Ya'ni
   * kalitsiz rejim dev/demo uchun, sotuv uchun emas.
   */
  for (const t of TOOLS.filter((x) => x.custom !== "image")) {
    assert.ok(toolBlockedReason(t, noLlm), `${t.id}: matn kalitisiz sotilmasligi kerak`);
  }
  // Rasm vositasi matn kalitiga BOG'LIQ EMAS — u fal.ai bilan ishlaydi.
  assert.equal(toolBlockedReason(TOOL_BY_ID.image, noLlm), null);

  // Hech narsa sozlanmagan — hamma vosita to'silади.
  for (const t of TOOLS) {
    assert.ok(toolBlockedReason(t, nothing), `${t.id}: hech narsasiz sotilmasligi kerak`);
  }

  /*
   * Bayroqlar hali kelmagan (`null`) — hech narsa to'silmaydi.
   * Sessiya tekshiruvidan oldin vositani o'chirib qo'yish uni bir lahza
   * yo'q qilib ko'rsatish bo'lardi.
   */
  for (const t of TOOLS) {
    assert.equal(toolBlockedReason(t, null), null, `${t.id}: bayroqsiz to'silmasligi kerak`);
    assert.equal(toolBlockedReason(t, undefined), null);
  }

  // Xabar sababni AYTISHI kerak — «xatolik» emas.
  const msg = toolBlockedReason(TOOL_BY_ID.image, noImages)!;
  assert.ok(msg.length > 20 && /kalit/i.test(msg), `sabab tushunarli bo'lishi kerak: ${msg}`);
});
