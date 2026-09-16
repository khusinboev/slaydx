import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FormValues, ToolConfig } from "../lib/types.ts";
import {
  defaultPages,
  isToolSlug,
  missingRequired,
  priceFor,
  TOOLS,
  TOOL_BY_ID,
  TOOL_BY_SLUG,
  TOOL_GROUPS,
  topicOf,
  visibleToolGroups,
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
  // Tezis endi maqola formasida (AUDIT-19) — muassasa muallif qatorida (`authors[].org`), alohida maydon yo'q.
  for (const id of ["coursework", "referat", "mustaqil-ish"] as const) {
    const missing = missingRequired(TOOL_BY_ID[id], base);
    assert.ok(
      missing.some((m) => /muassasa/i.test(m)),
      `${id}: universitet talab qilinishi kerak — ${JSON.stringify(missing)}`,
    );
  }
  // Insho ko'pincha maktab ishi — muassasa undan talab qilinmaydi.
  assert.ok(!missingRequired(TOOL_BY_ID.essay, base).some((m) => /muassasa/i.test(m)));
  /*
   * AUDIT-19: insho o'z formasida (`EssayComposer`) — majburiysi
   * KONTEKST (`CUSTOM_REQUIRED.essay`). Maktab inshosi, akademik esse va
   * IELTS Task 2 butunlay boshqa janr: kontekstsiz so'rov navbatga
   * tushib, puli yechilib, boshqa janr chiqishi mumkin edi.
   */
  assert.ok(missingRequired(TOOL_BY_ID.essay, base).some((m) => /kontekst/i.test(m)));
  assert.equal(missingRequired(TOOL_BY_ID.essay, { ...base, essayContext: "ielts_task2" }).length, 0);
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
  /*
   * AUDIT-5 §4.10. `weeklyHours` uchun `min: 1` e'lon qilingan, lekin
   * hech kim uni o'qimasdi: `missingRequired` faqat «bo'sh emasmi» deb
   * so'rardi va `"0"` uzunligi 1 bo'lgani uchun o'tib ketardi. Keyin
   * dvigatel `Math.max(1, weeklyHours)` bilan uni JIM tuzatardi — ya'ni
   * foydalanuvchi kiritgan qiymat e'tiborsiz qolar, xarita esa boshqa
   * hafta soniga qurilardi.
   *
   * AUDIT-20 R0: texnologik xarita `custom: "teacher"` ga o'tdi va
   * `weeklyHours`/`totalHours` `tool.fields` dan `teacher-params.ts`
   * reyestriga ko'chdi — hozir HECH BIR vosita `kind: "number"` maydon
   * e'lon qilmaydi. QOIDA esa o'z kuchida qolishi kerak, shuning uchun
   * u shu yerda SINTETIK `ToolConfig` bilan sinaladi; WP-E
   * (`TeacherComposer` + `teacher/input.ts`) soat diapazonini SERVERDA
   * qayta tekshirishi shart — aks holda AUDIT-5 §4.10 qaytadi.
   */
  const map: ToolConfig = {
    ...TOOL_BY_ID["texnologik-xarita"],
    fields: [
      { kind: "text", name: "subject", legend: "Fan nomi", required: true },
      { kind: "number", name: "weeklyHours", legend: "Haftalik soatlar", min: 1, max: 20, required: true },
      { kind: "number", name: "totalHours", legend: "Jami soatlar (o'quv yili bo'yicha)", min: 1, max: 400, required: true },
    ],
    topicLegend: undefined,
  };

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
  /*
   * Tezis vositasi (AUDIT-19): maqola dvigateli, o'z jadvali — 1–2 bet
   * 4 000, 3–5 bet (kengaytirilgan) 5 000; ruxsatsiz tur → konferensiya
   * tezisi (1–2 tarifi); eski 5–10…20–25 paketlari yo'q.
   */
  const { THESIS_PRICES, thesisTypeId } = await import("../lib/tools.ts");
  const thesis = TOOL_BY_ID.thesis;
  assert.deepEqual(THESIS_PRICES, { "1-2": 4000, "3-5": 5000 });
  assert.equal(thesis.custom, "article");
  assert.equal(defaultPages("thesis"), "1-2");
  assert.equal(priceFor(thesis, {}), 4000);
  assert.equal(priceFor(thesis, { articleType: "conference_thesis", pages: "3-5" }), 4000, "tezis turi 3-5 ni bilmaydi → 1-2 tarifi");
  assert.equal(priceFor(thesis, { articleType: "conference_extended", pages: "3-5" }), 5000);
  assert.equal(priceFor(thesis, { articleType: "conference_extended", pages: "10-15" }), 5000, "ruxsatsiz paket → `normalizeArticlePages` standarti (3-5 bo'lsa shu)");
  assert.equal(priceFor(thesis, { articleType: "imrad_oak", pages: "10-15" }), 4000, "MUTATSIYA: ruxsatsiz tur maqola narxiga o'tsa 12 000 chiqadi");
  assert.equal(thesisTypeId({ articleType: "review_narrative" }), "conference_thesis");
  assert.equal(thesisTypeId({ articleType: "conference_extended" }), "conference_extended");
});

/* ────────────────── O'qituvchi vositalari 2 (AUDIT-20 R0) ────────────────── */

/**
 * Test yaratuvchi — raqobatchi darajasidagi TEKIS narx (mahsulot egasi
 * qarori 6): savol soni, variant soni, qiyinlik, OMR — HECH BIRI narxga
 * ta'sir qilmaydi. Aks holda «30 savol 3 000, 40 savol 4 000» degan
 * jimgina tarif paydo bo'lardi va forma buni ko'rsatmasdi.
 */
test("test vositasi: tekis 3 000, parametrlar narxni o'zgartirmaydi", () => {
  const t = TOOL_BY_ID.test;
  assert.equal(t.basePrice, 3000);
  assert.equal(t.group, "oqituvchi");
  assert.equal(t.custom, "teacher");
  assert.equal(t.output, "docx");
  assert.equal(priceFor(t, {}), 3000);
  const probes: FormValues[] = [
    { count: 40, variants: 4, omr: true, testType: "dtm" },
    { count: 5, variants: 1, omr: false, testType: "diagnostika" },
    { count: 8, testType: "bsb", criteriaTable: true, openCount: 5 },
    { mode: "file", sourceText: "x".repeat(2000) },
    { price: 1, basePrice: 1 },
  ];
  for (const values of probes) {
    assert.equal(priceFor(t, values), 3000, `MUTATSIYA: parametr narxni o'zgartirdi — ${JSON.stringify(values)}`);
  }
  // `defaultPages` ga TEGMADIK: yangi vosita eski qiymatlarni o'zgartirmasin.
  assert.equal(defaultPages("test"), "10-15");
  assert.equal(defaultPages("essay"), "2");
  assert.equal(defaultPages("coursework"), "20-25");
});

/**
 * Glossariy narxi atama soniga bog'liq (6 000/9 000/15 000) — forma
 * `TeacherComposer` ga ko'chgani bilan bu qoida O'ZGARMAYDI. `termCount`
 * `tool.fields` dan chiqib ketgani uchun narxni jimgina `basePrice` ga
 * tushirib qo'yish — aynan shu sprintning eng oson xatosi bo'lardi.
 */
test("glossariy termCount narxi saqlanadi (fields bo'sh bo'lsa ham)", () => {
  const g = TOOL_BY_ID.glossary;
  assert.equal(g.custom, "teacher");
  assert.deepEqual(g.fields.map((f) => f.name), ["university", "author"], "glossariyda faqat shapka maydonlari qoladi");
  assert.equal(priceFor(g, { termCount: "10" }), 6000);
  assert.equal(priceFor(g, { termCount: "20" }), 9000);
  assert.equal(priceFor(g, { termCount: "40" }), 15000);
  assert.equal(priceFor(g, {}), 6000, "atama soni berilmasa — 10 ta tarifi");
  assert.equal(priceFor(g, { termCount: "999" }), g.basePrice, "noma'lum son → standart tarif, bepul emas");
  assert.ok(priceFor(g, { termCount: "40" }) > priceFor(g, { termCount: "10" }), "MUTATSIYA: termCount qoidasi olib tashlandi");
  // Qolgan 4 vosita — tekis `basePrice` (parametrlar narxsiz).
  assert.equal(priceFor(TOOL_BY_ID["lesson-plan"], { duration: 90, stageCount: 8 }), 4000);
  assert.equal(priceFor(TOOL_BY_ID["texnologik-xarita"], { totalHours: 400, mapType: "choraklik" }), 6000);
  assert.equal(priceFor(TOOL_BY_ID.keys, { caseCount: 8, keysType: "rolli" }), 6000);
});

/**
 * `custom: "teacher"` vositalarida majburiy IKKI maydon — muassasa va
 * tuzuvchi (`CUSTOM_REQUIRED.teacher`), ustiga umumiy mavzu qoidasi.
 * Ular eski `TEACHER_FIELDS` (ixtiyoriy) dan farq qiladi: rasmiy
 * shapkasiz hujjat o'qituvchiga yaroqsiz.
 */
test("custom teacher: muassasa + tuzuvchi + mavzu majburiy, TEACHER_FIELDS takrorlanmaydi", () => {
  for (const id of ["lesson-plan", "texnologik-xarita", "glossary", "keys", "test"] as const) {
    const tool = TOOL_BY_ID[id];
    assert.equal(tool.custom, "teacher", `${id}: custom teacher emas`);
    /*
     * MUTATSIYA: `TEACHER_FIELDS` avtomat qo'shilishi `custom` bo'lgan
     * vositalarga ham tegsa, `university` IKKI marta chiqadi va
     * «To'ldirilmagan maydon» ro'yxati takrorlanadi.
     */
    assert.deepEqual(tool.fields.map((f) => f.name), ["university", "author"], `${id}: maydonlar ro'yxati`);
    assert.ok(tool.fields.every((f) => f.required), `${id}: shapka maydonlari majburiy bo'lishi kerak`);

    const missing = missingRequired(tool, {});
    assert.ok(missing.includes("Ta'lim muassasasi nomi"), `${id}: muassasa tekshirilmadi`);
    assert.ok(missing.includes("Tuzuvchi (F.I.Sh)"), `${id}: tuzuvchi tekshirilmadi`);
    assert.ok(missing.includes(tool.topicLegend!), `${id}: mavzu tekshirilmadi`);
    assert.deepEqual(missingRequired(tool, { topic: "Fotosintez", university: "15-son maktab", author: "Karimova D." }), []);
  }
  // Test vositasi FAYL rejimida mavzu o'rniga manba matni so'raydi.
  const t = TOOL_BY_ID.test;
  assert.deepEqual(missingRequired(t, { mode: "file", university: "15-son maktab", author: "Karimova D." }), ["Manba fayl matni"]);
  assert.deepEqual(missingRequired(t, { mode: "file", sourceText: "matn", university: "15-son maktab", author: "K." }), []);
});

/* ────────────────── 2-dastur: o'yinlar + infografika (AUDIT-21 R0) ────────────────── */

/**
 * Uchala vosita ham TEKIS 2 000 (mahsulot egasi qarori 6 — raqobatchi
 * darajasi). Bu testning asosiy ishi — tarifning jimgina paydo bo'lishini
 * to'sish: «20 so'z 2 500, 8 blok 3 000» degan narx formada ko'rinmasdi,
 * chunki `ToolChrome` `priceFor` natijasini bitta raqam qilib chizadi.
 *
 * Mutatsiya: `priceFor` ga `if (tool.id === "crossword") return 2000 +
 * words * 50` qo'shildi — zond ro'yxatidagi har qatorda qizardi.
 */
test("krossvord / flesh kartalar / infografika: tekis 2 000, parametrlar narxni o'zgartirmaydi", () => {
  const probes: FormValues[] = [
    { wordCount: 20, crosswordType: "tarifli", language: "ru" },
    { wordCount: 5, crosswordType: "klassik" },
    { cardCount: 20, cardType: "qa", includeExample: "ha" },
    { cardCount: 5, includeExample: "yoq" },
    { infographicType: "timeline", blockCount: 8, palette: "berry", size: "A3" },
    { infographicType: "list", blockCount: 3, size: "A4" },
    { mode: "file", sourceText: "x".repeat(5000) },
    { pages: "25-30", termCount: 40, imageCount: 4 },
    { price: 1, basePrice: 1 },
  ];
  for (const id of ["crossword", "flashcards", "infographic"] as const) {
    const tool = TOOL_BY_ID[id];
    assert.equal(tool.basePrice, 2000, `${id}: tayanch narx`);
    assert.equal(priceFor(tool, {}), 2000, `${id}: bo'sh forma`);
    for (const values of probes) {
      assert.equal(priceFor(tool, values), 2000, `MUTATSIYA: ${id} da parametr narxni o'zgartirdi — ${JSON.stringify(values)}`);
    }
  }
  // Mavjud narxlarga TEGILMADI: yangi vositalar eski tariflarni buzmasin.
  assert.equal(priceFor(TOOL_BY_ID.test, {}), 3000);
  assert.equal(priceFor(TOOL_BY_ID.image, { imageCount: 4 }), 6000);
  assert.equal(priceFor(TOOL_BY_ID.glossary, { termCount: 40 }), 15000);
  assert.equal(defaultPages("crossword"), "10-15", "yangi vosita `defaultPages` ni o'zgartirmasin");
});

test("o'yin/plakat vositalarining shartnomasi: guruh, chiqish, forma, majburiy maydonlar", () => {
  const crossword = TOOL_BY_ID.crossword;
  const cards = TOOL_BY_ID.flashcards;
  const poster = TOOL_BY_ID.infographic;

  assert.equal(crossword.group, "oyinlar");
  assert.equal(cards.group, "oyinlar");
  assert.equal(poster.group, "oqituvchi");
  assert.equal(crossword.output, "docx");
  assert.equal(cards.output, "docx");
  assert.equal(poster.output, "png");

  // STANDART forma — `custom` YO'Q (maydonlar orasida bog'liqlik yo'q).
  for (const t of [crossword, cards, poster]) {
    assert.equal(t.custom, undefined, `${t.id}: custom forma kerak emas edi`);
    assert.ok(t.extraOptional, `${t.id}: «Qo'shimcha talablar» maydoni yoqilmagan`);
    assert.ok(t.topicLegend, `${t.id}: mavzu so'ralmaydi`);
    // Slug lar takrorlanmasin va yo'naltirish ishlasin.
    assert.ok(isToolSlug(t.slug), `${t.id}: slug ro'yxatda yo'q`);
    assert.equal(TOOL_BY_SLUG[t.slug].id, t.id);
    // Har chip maydonida variantlar bor (bo'sh `chips` formada ko'rinmasdi).
    for (const f of t.fields) {
      if (f.kind === "chips") assert.ok(f.options && f.options.length >= 2, `${t.id}/${f.name}: chip variantlari yo'q`);
    }
  }

  // Fayl rejimi FAQAT krossvordda (hisobot §2).
  assert.ok(crossword.modes, "krossvordda fayl rejimi bo'lishi kerak");
  assert.equal(cards.modes, undefined, "kartalar mavzudan tuziladi — fayl rejimi yo'q");
  assert.equal(poster.modes, undefined);

  // Mavzu majburiy; fayl rejimida uning o'rniga manba matni.
  assert.deepEqual(missingRequired(crossword, {}), [crossword.topicLegend]);
  assert.deepEqual(missingRequired(crossword, { mode: "file" }), ["Manba fayl matni"]);
  assert.deepEqual(missingRequired(crossword, { mode: "file", sourceText: "matn" }), []);
  assert.deepEqual(missingRequired(cards, { topic: "Hujayra" }), []);
  assert.deepEqual(missingRequired(poster, { topic: "Suv aylanishi" }), []);
  // Mavzusiz plakat navbatga tushmasin (pul yechilib, bo'sh ish ketmasin).
  assert.deepEqual(missingRequired(poster, {}), [poster.topicLegend]);
});

test("bo'lim yorliqlari bitta manbadan; bo'sh bo'lim ko'rinmaydi", () => {
  const groups = visibleToolGroups();
  const ids = groups.map((g) => g.id);
  assert.deepEqual(ids, ["umumiy", "talaba", "oqituvchi", "oyinlar"], `bo'limlar: ${ids.join(", ")}`);
  assert.equal(groups.find((g) => g.id === "oyinlar")?.label, "O'yinlar");
  // `media` e'lon qilingan, lekin vositasi yo'q — CHIZILMAYDI.
  assert.ok(TOOL_GROUPS.some((g) => g.id === "media"), "media bo'limi reyestrdan yo'qoldi");
  assert.ok(!ids.includes("media"), "MUTATSIYA: bo'sh «Media» bo'limi ko'rindi");
  // HAR vosita chiziladigan bo'limga tegishli — aks holda u sotib olinmaydi.
  for (const t of TOOLS) assert.ok(ids.includes(t.group), `${t.id}: «${t.group}» bo'limi hech qayerda chizilmaydi`);
  // Ikki komponent ham SHU manbadan o'qiydi (qo'lda yozilgan nusxa qolmasin).
  for (const f of ["../components/home/CreateGrid.tsx", "../components/shell/Sidebar.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /visibleToolGroups\(\)/, `${f}: guruhlar ro'yxati qo'lda yozilgan`);
  }
  // Har vosita ikonkasi HAQIQATAN mavjud (topilmasa kartochka bo'sh chiqardi).
  const icons = readFileSync(new URL("../components/shell/icons.tsx", import.meta.url), "utf8");
  for (const t of TOOLS) assert.ok(icons.includes(`"${t.icon}"`) || new RegExp(`^\\s*${t.icon}:`, "m").test(icons), `${t.id}: «${t.icon}» ikonkasi TOOL_ICONS da yo'q`);
});
