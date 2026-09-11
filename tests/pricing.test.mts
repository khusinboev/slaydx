import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPages,
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
  /*
   * Klient nima yuborsa ham narx SERVERDA hisoblanadi. Kutilgan qiymat
   * `basePrice` emas, STANDART TARIF narxi (P1-7): standart hajm
   * `defaultPages` dan keladi va insho uchun u «2 varaq» — dvigatel ham
   * aynan shuncha yozadi. Ilgari narx «1 varaq» tarifidan (`basePrice`)
   * hisoblanar, dvigatel esa 2 varaq yozardi.
   */
  const fromForged = priceFor(essay, { price: 1, basePrice: 1 });
  assert.equal(fromForged, priceFor(essay, { pages: defaultPages(essay.id) }));
  assert.notEqual(fromForged, 1, "klient qiymati narxga ta'sir qilmasligi kerak");

  // Boshqa vositalarda ham soxta `price` e'tiborsiz qoladi.
  assert.equal(
    priceFor(TOOL_BY_ID.coursework, { price: 1, pages: "40-45" }),
    priceFor(TOOL_BY_ID.coursework, { pages: "40-45" }),
  );
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

test("slayd narxi slayderdan: 20 tagacha 3 000, keyingi har slayd +500 (paket yo'q)", () => {
  const slide = TOOL_BY_ID.slide;
  assert.equal(priceFor(slide, {}), 3000, "standart 10 slayd");
  assert.equal(priceFor(slide, { slideCount: 20 }), 3000);
  assert.equal(priceFor(slide, { slideCount: 25 }), 5500);
  assert.equal(priceFor(slide, { slideCount: 30 }), 8000);
  assert.equal(priceFor(slide, { slideCount: 999 }), 8000, "30 dan yuqori qisiladi");
  // Eski paket qiymati bilan aldash — narxga ta'sir qilmaydi.
  assert.equal(priceFor(slide, { quality: "premium_long" }), 3000);
  assert.equal(priceFor(slide, { slideCount: -5 }), 3000);
});

test("tarjima narxi hajmdan: 10 000 gacha 3 000, keyingi har 5 000 (yoki qismi) +1 000", async () => {
  const { translationPrice } = await import("../lib/tools.ts");
  /*
   * Ilgari tarjima hajmdan qat'i nazar 3 000 turardi: 500 belgilik xat
   * ham, 48 000 belgilik hujjat ham. Yaxlitlash YUQORIGA (`ceil`) —
   * 10 001 belgi ham to'liq qadamni oladi, chunki modelga baribir yangi
   * partiya ketadi.
   */
  const table: [number, number][] = [
    [8, 3000],
    [10_000, 3000],
    [10_001, 4000],
    [15_000, 4000],
    [15_001, 5000],
    [200_000, 41_000],
  ];
  for (const [chars, want] of table) {
    assert.equal(translationPrice(chars), want, `${chars} belgi`);
  }
  // Manfiy/soxta son bilan bepul qilishga urinish.
  assert.equal(translationPrice(-500), 3000);
  assert.equal(translationPrice(Number.NaN), 3000);
});

test("tarjima narxi: fayl rejimida `sourceChars`, matn rejimida matnning O'ZI", () => {
  const t = TOOL_BY_ID.translation;
  const asset = "a".repeat(24);

  // Fayl rejimi: `sourceChars` ni SERVER to'ldiradi (`sourceCharsForRequest`).
  assert.equal(priceFor(t, { sourceAssetId: asset, sourceChars: 50_000 }), 11_000);

  /*
   * Matn rejimi: klientning `sourceChars` i E'TIBORSIZ. Aks holda
   * 200 000 belgilik matnni `sourceChars: 1` bilan yuborib, 3 000
   * tangaga tarjima qildirish mumkin bo'lardi.
   */
  const long = "x".repeat(50_000);
  assert.equal(priceFor(t, { sourceText: long, sourceChars: 1 }), 11_000);
  assert.equal(priceFor(t, { sourceText: "Salom dunyo" }), 3000);
  assert.equal(priceFor(t, {}), 3000, "bo'sh forma — tayanch narx");
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

test("sonli maydonda diapazon ham tekshiriladi", () => {
  const map = TOOL_BY_ID["texnologik-xarita"];

  /*
   * AUDIT-5 §4.10. `weeklyHours` uchun `min: 1` e'lon qilingan, lekin
   * hech kim uni o'qimasdi: `missingRequired` faqat «bo'sh emasmi» deb
   * so'rardi va `"0"` uzunligi 1 bo'lgani uchun o'tib ketardi. Keyin
   * dvigatel `Math.max(1, weeklyHours)` bilan uni JIM tuzatardi — ya'ni
   * foydalanuvchi kiritgan qiymat e'tiborsiz qolar, xarita esa boshqa
   * hafta soniga qurilardi.
   */
  const ok = { subject: "Biologiya", weeklyHours: 4, totalHours: 136 };
  assert.deepEqual(missingRequired(map, ok), []);

  assert.deepEqual(missingRequired(map, { ...ok, weeklyHours: 0 }), ["Haftalik soatlar"]);
  assert.deepEqual(missingRequired(map, { ...ok, totalHours: 0 }), [
    "Jami soatlar (o'quv yili bo'yicha)",
  ]);

  // Yuqori chegara ham amal qiladi (`max: 20`).
  assert.deepEqual(missingRequired(map, { ...ok, weeklyHours: 99 }), ["Haftalik soatlar"]);

  // Son bo'lmagan qiymat ham rad etiladi.
  assert.deepEqual(missingRequired(map, { ...ok, weeklyHours: "ko'p" }), ["Haftalik soatlar"]);

  // Matn maydonlariga bu qoida tegmaydi.
  assert.deepEqual(missingRequired(map, { ...ok, subject: "0" }), [], "«0» matn sifatida to'g'ri");
});

test("manba ogohlantirishi ko'ruvchiga ham tushadi", async () => {
  const { docToFlow } = await import("../lib/viewers/flow.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");

  /*
   * AUDIT-5 P1-6. DOCX da adabiyotlar ustida «Bu ro'yxat TEKSHIRILMAGAN»
   * ogohlantirishi chiziladi, ko'ruvchida esa umuman yo'q edi.
   * Foydalanuvchi saytda ishonchli ko'rinadigan ro'yxatni ko'rar,
   * ogohlantirishni faqat faylni ochgandan keyin topardi — bu aynan
   * akademik halollik uchun qo'shilgan matn.
   */
  const meta = extractMeta(TOOL_BY_ID.referat, { topic: "Mavzu" });
  const doc = {
    meta,
    titlePage: true,
    toc: true,
    sections: [{ id: "kirish", title: "Kirish", blocks: [{ kind: "p" as const, text: "Matn" }] }],
    references: ["Muallif. Nom. – Toshkent: Nashriyot, 2020."],
    referencesNote: "Bu ro'yxat tasdiqlanmagan.",
  };

  const flow = docToFlow(doc as never);
  const note = flow.find((i) => i.type === "refNote");
  assert.ok(note, "ogohlantirish oqimda bo'lishi kerak");
  assert.equal((note as { text: string }).text, "Bu ro'yxat tasdiqlanmagan.");

  // Ogohlantirish ro'yxatdan OLDIN turishi kerak.
  const iNote = flow.findIndex((i) => i.type === "refNote");
  const iRef = flow.findIndex((i) => i.type === "ref");
  assert.ok(iNote >= 0 && iRef > iNote, "ogohlantirish manbalardan oldin");

  // Ogohlantirish bo'lmasa ortiqcha element qo'shilmaydi.
  const plain = docToFlow({ ...doc, referencesNote: undefined } as never);
  assert.equal(plain.filter((i) => i.type === "refNote").length, 0);
});

/**
 * Maqola 2 (AUDIT-17): narx HAJMGA qarab, hammasi ichida — tezis 1–2 bet
 * 4 000, 3–5 bet 6 000, 5–10 bet 8 000, 10–15 bet 12 000 (mahsulot egasi
 * qarori 4). Tur hajmni cheklaydi: tezis «10–15» so'rasa ham 1–2 tarifi.
 */
test("maqola narxi ARTICLE_PRICES jadvalidan — 4 satr, tur hajmni cheklaydi", async () => {
  const { ARTICLE_PRICES } = await import("../lib/tools.ts");
  const article = TOOL_BY_ID.article;
  assert.deepEqual(ARTICLE_PRICES, { "1-2": 4000, "3-5": 6000, "5-10": 8000, "10-15": 12000 });
  assert.equal(priceFor(article, { articleType: "conference_thesis", pages: "1-2" }), 4000);
  assert.equal(priceFor(article, { articleType: "imrad_oak", pages: "3-5" }), 6000);
  assert.equal(priceFor(article, { articleType: "imrad_oak", pages: "5-10" }), 8000);
  assert.equal(priceFor(article, { articleType: "imrad_oak", pages: "10-15" }), 12000);
  // Standart hajm — `defaultPages("article")` = 3-5.
  assert.equal(priceFor(article, {}), 6000);
  assert.equal(defaultPages("article"), "3-5");
  // Tezis 10-15 bet bo'lmaydi → 1-2 tarifi; sharh 1-2 bet bo'lmaydi → 5-10.
  assert.equal(priceFor(article, { articleType: "conference_thesis", pages: "10-15" }), 4000);
  assert.equal(priceFor(article, { articleType: "review_narrative", pages: "1-2" }), 8000);
  // Soxta qiymat — standart tarif, bepul emas.
  assert.equal(priceFor(article, { pages: "0-0", price: 1 }), 6000);
});
