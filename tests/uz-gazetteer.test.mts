import test from "node:test";
import assert from "node:assert/strict";
import { groundUzbekScene } from "../lib/generation/uz-gazetteer.ts";

/**
 * O'zbekistonga oid vizual faktlar bazasi (Sprint 16).
 *
 * Jonli tekshiruvda (`scripts/image-lab.mts`) rasm modeli «Registon»ni
 * bitta yagona binoga, «palov»ni oddiy guruch-go'shtga aylantirdi —
 * ya'ni AI o'zbek voqeligini yuzaki biladi. Bu funksiya taniqli
 * mavzular uchun HAQIQIY tafsilotni deterministik ravishda qo'shadi.
 */

test("mashhur joy nomi topilsa aniq tafsilot qaytadi", () => {
  const detail = groundUzbekScene("Registon maydoni erta tongda");
  assert.match(detail, /Sher-Dor/i, "Registon UCH alohida madrasadan iboratligi aytilishi kerak");
  assert.match(detail, /tiger/i);
});

test("aloqasiz matnda hech narsa qo'shilmaydi", () => {
  assert.equal(groundUzbekScene("kosmik kema tungi osmonda uchmoqda"), "");
  assert.equal(groundUzbekScene(""), "");
});

test("katta-kichik harf va inglizcha yozilishga sezgir emas", () => {
  assert.notEqual(groundUzbekScene("REGISTAN SQUARE"), "");
  assert.notEqual(groundUzbekScene("registon"), "");
});

test("bir nechta mavzu bo'lsa hammasi qo'shiladi, lekin takrorlanmaydi", () => {
  const detail = groundUzbekScene("Registon va yana Registon haqida rasm");
  const count = detail.split("Sher-Dor").length - 1;
  assert.equal(count, 1, "bitta faktlar bloki bir marta qo'shilishi kerak, ikki marta emas");

  const combo = groundUzbekScene("Chorsu bozorida palov sotishmoqda");
  assert.match(combo, /Chorsu Bazaar/);
  assert.match(combo, /golden-orange/);
});

test("'non' so'zi ingliz 'nonfiction' kabi so'zlarni ushlab olmaydi", () => {
  /*
   * `\bnon\b` chegarasi bo'lmasa, "nonfiction", "nonstop" kabi har
   * qanday inglizcha so'z ham tandir haqidagi izohni ilova qilib
   * yuborardi — bu O'ZBEK "non" so'zi bilan aloqasi yo'q soxta signal.
   */
  assert.equal(groundUzbekScene("a nonfiction book about history"), "");
  assert.notEqual(groundUzbekScene("issiq non tandirdan"), "");
});

test("palov taomining haqiqiy ko'rinishi (oq guruch emas) ta'kidlanadi", () => {
  const detail = groundUzbekScene("mazali osh tayyorlanmoqda");
  assert.match(detail, /never plain white rice/i);
});

test("O'zbekiston bayrog'i haqiqiy ranglari bilan tasvirlanadi", () => {
  const detail = groundUzbekScene("o'zbekiston bayrog'i hilpiramoqda");
  assert.match(detail, /light blue, white, green/i);
  assert.match(detail, /twelve white stars/i);
});
