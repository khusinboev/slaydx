import test from "node:test";
import assert from "node:assert/strict";

/**
 * LLM javobidan JSON ajratish (Sprint 14, N-11).
 *
 * `parseLlmJson` — TO'QQIZTA xizmatning yagona kirish nuqtasi: slayd,
 * glossariy, keys, dars rejasi, texnologik xarita, tarjima, rezyume,
 * IMRAD va annotatsiya. Hammasi `{ json: true }` bilan so'raydi va
 * javobni shu funksiya orqali o'qiydi.
 *
 * Shunga qaramay u SINOVSIZ edi. Ichida qo'lda yozilgan qavs hisoblovchi
 * holat mashinasi (`scan`, `dropLastToken`, `repairTruncated`) bor —
 * ya'ni yiqilsa JIM yiqiladi: `parseLlmObject` `null` qaytaradi, xizmat
 * «model javob bermadi» deb xato beradi va sabab modelga to'nkaladi.
 */

const { parseLlmJson, parseLlmObject } = await import("../lib/generation/json.ts");

test("toza JSON o'qiladi", () => {
  assert.deepEqual(parseLlmJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLlmJson('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(parseLlmJson('{"terms":[{"term":"A","def":"B"}]}'), {
    terms: [{ term: "A", def: "B" }],
  });
});

test("kod panjarasi va atrofdagi matn olib tashlanadi", () => {
  // Model «Faqat JSON qaytaring» ko'rsatmasiga qaramay tez-tez o'raydi.
  assert.deepEqual(parseLlmJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLlmJson('```JSON\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLlmJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLlmJson('Mana natija:\n{"a":1}\nUmid qilamanki foydali.'), { a: 1 });
  // BOM — ba'zi provayderlar qo'shadi.
  assert.deepEqual(parseLlmJson('﻿{"a":1}'), { a: 1 });
});

test("bo'sh va JSON bo'lmagan kirish `null` beradi", () => {
  assert.equal(parseLlmJson(null), null);
  assert.equal(parseLlmJson(undefined), null);
  assert.equal(parseLlmJson(""), null);
  assert.equal(parseLlmJson("   "), null);
  assert.equal(parseLlmJson("Kechirasiz, bu so'rovni bajara olmayman."), null);
  assert.equal(parseLlmJson("```json\n```"), null);
});

test("kesilgan javob tiklanadi — bu funksiyaning asosiy vazifasi", () => {
  /*
   * Eng ko'p uchraydigan holat: javob `maxOutputTokens` ga urilib,
   * JSON o'rtasida uziladi. Oddiy `JSON.parse` bunda BUTUN javobni
   * yo'qotardi — 16 slaydlik deka yoki 40 atamalik glossariy bir
   * belgi yetishmagani uchun butunlay tashlanardi.
   */

  // Massiv o'rtasida uzilgan — to'liq elementlar saqlanishi kerak.
  const cutArray = parseLlmJson('{"slides":[{"title":"Bir"},{"title":"Ikki"},{"title":"Uch');
  assert.ok(cutArray, "kesilgan massiv tiklanishi kerak");
  const slides = (cutArray as { slides: { title: string }[] }).slides;
  assert.deepEqual(
    slides.map((s) => s.title),
    ["Bir", "Ikki"],
    "tugallanmagan element tashlanadi, tugallanganlari qoladi",
  );
  assert.equal(slides.length, 2, "oxirida bo'sh obyekt qolmasligi kerak");

  // Satr o'rtasida uzilgan.
  const cutString = parseLlmJson('{"intro":"Boshlandi","def":"yarim');
  assert.deepEqual(cutString, { intro: "Boshlandi" });

  // Son o'rtasida uzilgan.
  const cutNumber = parseLlmJson('{"minutes":45,"total":1');
  assert.ok(cutNumber, "kesilgan son bo'lsa ham qolgani tiklanishi kerak");
  assert.equal((cutNumber as { minutes: number }).minutes, 45);

  // Ichma-ich obyekt uzilgan.
  const nested = parseLlmJson('{"uz":{"text":"Salom","keywords":"a,b"},"en":{"text":"Hel');
  assert.deepEqual(nested, { uz: { text: "Salom", keywords: "a,b" } });

  /*
   * Faqat ochiluvchi qavs — sintaktik jihatdan `{}` ga tiklanadi, lekin
   * unda ma'lumot yo'q. `null` halolroq: «model javob bermadi» aynan shu
   * holat, `{}` esa chaqiruvchini maydonlari `undefined` bo'lgan obyekt
   * bilan chalg'itardi.
   */
  assert.equal(parseLlmJson("{"), null);
  assert.equal(parseLlmJson("["), null);
  // Tugallangan bo'sh javobga bu tegmaydi — u tiklashgacha yetib kelmaydi.
  assert.deepEqual(parseLlmJson("{}"), {});
});

test("tiklashdan keyin oxirida bo'sh idish qolmaydi", () => {
  /*
   * Javob element BOSHIDA uzilsa, tiklash tugallanmagan bo'lakni
   * tashlab, ochiq qolgan `{` ni yopardi va massiv oxirida `{}` paydo
   * bo'lardi. Sintaktik jihatdan to'g'ri, lekin ma'nosiz — va u
   * hujjatgacha yetib borardi:
   *
   *   • `lessonDoc` — «Bosqich» deb nomlangan, matnsiz dars bosqichi;
   *   • `writeKeysWithLlm` — vaziyati ham, javobi ham bo'sh «Keys N».
   *
   * Bu nuqson AYNAN shu testlar yozilganda topildi (N-11).
   */
  assert.deepEqual(parseLlmJson('{"cases":[{"title":"K1","key":"J"},{'), {
    cases: [{ title: "K1", key: "J" }],
  });
  assert.deepEqual(parseLlmJson('{"weeks":[{"topic":"A"},{"topic":"B"},{"top'), {
    weeks: [{ topic: "A" }, { topic: "B" }],
  });
  // Ichma-ich massiv ham tozalanadi — bo'sh `rubric` umuman qolmaydi.
  assert.deepEqual(parseLlmJson('{"cases":[{"tasks":["a","b"],"rubric":[{'), {
    cases: [{ tasks: ["a", "b"] }],
  });

  /*
   * Obyektning OXIRGI kaliti ham shu holatga tushadi. Uch tilli
   * annotatsiyada bu `{"uz":{…}, "en":{}}` berardi — chaqiruvchi «til
   * keldi, lekin matni yo'q» degan noaniq holatga tushardi.
   */
  assert.deepEqual(parseLlmJson('{"uz":{"text":"Salom","keywords":"a"},"en":{"text":"Hel'), {
    uz: { text: "Salom", keywords: "a" },
  });

  /*
   * TUGALLANGAN javobga tegilmaydi: `{}` model ataylab yozgan bo'lishi
   * mumkin va uni tashlash ma'lumot yo'qotish bo'lardi.
   */
  assert.deepEqual(parseLlmJson('{"a":[{"x":1},{}]}'), { a: [{ x: 1 }, {}] });
  assert.deepEqual(parseLlmJson('{"empty":{}}'), { empty: {} });
});

test("ortiqcha vergul va qochirilgan tirnoq to'g'ri o'qiladi", () => {
  // Model ba'zan oxirgi elementdan keyin vergul qoldiradi.
  assert.deepEqual(parseLlmJson('{"a":1,'), { a: 1 });
  assert.deepEqual(parseLlmJson('{"list":[1,2,'), { list: [1, 2] });

  // Qochirilgan tirnoq satr ichida — qavs hisoblovchi unga aldanmasligi kerak.
  assert.deepEqual(parseLlmJson('{"q":"u \\"dedi\\" shunday"}'), { q: 'u "dedi" shunday' });
  // Satr ichidagi qavs ham qavs hisoblanmasligi kerak.
  assert.deepEqual(parseLlmJson('{"code":"if (x) { y(); }"}'), { code: "if (x) { y(); }" });
  // Satr ichida uzilgan, ichida qavs bor.
  const tricky = parseLlmJson('{"ok":"bor","code":"function f() {');
  assert.deepEqual(tricky, { ok: "bor" });

  /*
   * Qochirilgan tirnoqdan KEYIN qavs — `scan` ning escape hisobi aynan
   * shu yerda sinaladi.
   *
   * Yuqoridagi holatlar buni QAMRAMAYDI: to'liq javob `JSON.parse` dan
   * o'tib ketadi va `scan` umuman chaqirilmaydi. Faqat UZILGAN javobda
   * `scan` ishlaydi, va agar `\"` escape deb hisoblanmasa, satr erta
   * tugagan deb qaraladi — undan keyingi `{` esa haqiqiy qavs deb
   * sanalib, qavs steki buziladi.
   *
   * Bu bo'shliqni mutatsiya supurgisi ochdi: escape qatorini o'chirganda
   * birorta test yiqilmagan edi.
   */
  assert.deepEqual(parseLlmJson('{"a":"x \\" { y","b":"kesildi'), { a: 'x " { y' });
  assert.deepEqual(parseLlmJson('{"code":"if (a) \\"b\\" { c(); }","next":"kes'), {
    code: 'if (a) "b" { c(); }',
  });
});

test("mos kelmagan qavs tiklanmaydi", () => {
  /*
   * `scan` muvozanat buzilganini ko'rsa `broken` qaytaradi va tiklash
   * to'xtaydi. Bu ATAYIN: buzuq tuzilmani «tuzatib» yuborish modeldan
   * kelmagan ma'lumotni o'ylab topish bo'lardi.
   */
  assert.equal(parseLlmJson('{"a":1]'), null);
  assert.equal(parseLlmJson('{"a":[1,2}'), null);
});

test("parseLlmObject faqat obyekt qabul qiladi", () => {
  /*
   * Chaqiruvchilar (`writeResumeWithLlm`, `writeAbstracts`, `translatedBlocks`…)
   * natijaga `data?.field` deb murojaat qiladi. Massiv yoki son qaytsa
   * bu jim `undefined` berardi, ya'ni xato o'rniga bo'sh hujjat chiqardi.
   */
  assert.deepEqual(parseLlmObject('{"a":1}'), { a: 1 });
  assert.equal(parseLlmObject("[1,2,3]"), null, "massiv obyekt emas");
  assert.equal(parseLlmObject("42"), null);
  assert.equal(parseLlmObject('"matn"'), null);
  assert.equal(parseLlmObject("null"), null);
  assert.equal(parseLlmObject(null), null);
});

test("haqiqiy shakldagi javoblar — har xizmat o'z sxemasini oladi", () => {
  /*
   * Regressiya qo'riqchisi: quyidagilar dvigatelda AYNAN shu shaklda
   * so'raladi. Biror tiklash qoidasi buzilsa, bu javoblardan biri
   * `null` bo'lib qoladi va tegishli xizmat «model javob bermadi» deb
   * xato beradi — sabab esa modelga to'nkalardi.
   */

  // Dars rejasi — daqiqalar bilan, oxiri kesilgan.
  const lesson = parseLlmObject<{ stages?: { title: string; minutes: number; activity?: string }[] }>(
    '```json\n{"goal":"Maqsad","tools":"Doska","stages":[{"title":"Tashkiliy","minutes":3,"activity":"Salom","result":"Tayyor"},{"title":"Yangi mavzu","minutes":20,"activity":"Tush',
  );
  /*
   * Ikkinchi bosqich `activity` da uzilgan, lekin sarlavhasi va daqiqasi
   * bor — u SAQLANADI. Uni tashlash modeldan kelgan matnni yo'qotish
   * bo'lardi; `lessonDoc` esa bo'sh `activity` ni o'zi hal qiladi.
   */
  assert.equal(lesson?.stages?.length, 2, "qisman to'la bosqich saqlanishi kerak");
  assert.equal(lesson.stages[0].minutes, 3);
  assert.equal(lesson.stages[1].title, "Yangi mavzu");
  assert.equal(lesson.stages[1].minutes, 20);
  assert.equal(lesson.stages[1].activity, undefined);

  // Keys — rubrika bilan.
  const keys = parseLlmObject<{ cases?: { rubric?: { points: number }[] }[] }>(
    '{"intro":"Kirish","cases":[{"title":"Keys 1","situation":"Vaziyat","tasks":["a","b"],"key":"Javob","rubric":[{"criterion":"Tahlil","points":5},{"criterion":"Yechim","points":5}]}]}',
  );
  assert.equal(keys?.cases?.[0].rubric?.length, 2);

  // Tarjima — bloklar bilan.
  const tr = parseLlmObject<{ blocks?: { kind: string; text: string }[] }>(
    '{"title":"Sarlavha","blocks":[{"kind":"h2","text":"Bob"},{"kind":"p","text":"Matn"}]}',
  );
  assert.equal(tr?.blocks?.length, 2);
  assert.equal(tr.blocks[0].kind, "h2");

  // Annotatsiya — uch tilli ichma-ich obyekt.
  const abs = parseLlmObject<Record<string, { text: string }>>(
    '{"uz":{"text":"Annotatsiya","keywords":"a"},"ru":{"text":"Аннотация","keywords":"б"},"en":{"text":"Abstract","keywords":"c"}}',
  );
  assert.equal(Object.keys(abs ?? {}).length, 3);
  assert.equal(abs?.ru.text, "Аннотация");

  // Texnologik xarita — uzun massiv.
  const map = parseLlmObject<{ weeks?: unknown[] }>(
    `{"intro":"Xarita","weeks":[${Array.from({ length: 34 }, (_, i) => `{"topic":"Mavzu ${i + 1}","method":"Ma'ruza","result":"Natija","control":"Test"}`).join(",")}]}`,
  );
  assert.equal(map?.weeks?.length, 34, "34 haftalik xarita to'liq o'qilishi kerak");
});
