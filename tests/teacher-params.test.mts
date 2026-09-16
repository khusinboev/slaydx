import test from "node:test";
import assert from "node:assert/strict";
import { TEACHER_FORM_FIELDS, TEACHER_JSON_FIELDS, TEACHER_PARAMS, teacherParamsOf } from "../lib/generation/teacher-params.ts";
import { TEACHER_KINDS } from "../lib/generation/teacher/types.ts";

/**
 * «BEZAK MAYDON YO'Q» reyestri (AUDIT-20 R0).
 *
 * Differensial ZOND (parametrni o'zgartirib, hujjatdagi farqni
 * o'lchash) WP-E da ulanadi — dvigatel WP-A/WP-B da yoziladi. Bu yerda
 * REYESTRNING O'ZI qulflanadi: har maydonning egasi (`kinds`), ta'siri
 * (`impacts`) va zond juftligi (`probeA ≠ probeB`) bor. Reyestrsiz
 * maydon formaga chiqsa, uni hech narsa tekshirmaydi — aynan shu
 * naqshdan `lesson-plan` da o'lik `extra` maydoni qolgan edi.
 */

test("har parametr unikal id ga ega va shakli to'g'ri", () => {
  const ids = TEACHER_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `takroriy id: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(", ")}`);
  assert.deepEqual(TEACHER_FORM_FIELDS, ids);
  for (const p of TEACHER_PARAMS) {
    assert.ok(/^[a-zA-Z][a-zA-Z0-9]*$/.test(p.id), `${p.id}: forma maydon nomi shakli (sanitizeValues oq ro'yxati)`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond juftligi bir xil — farqni o'lchab bo'lmaydi`);
  }
});

test("har parametrning egasi va TA'SIRI bor; noma'lum kind yo'q", () => {
  for (const p of TEACHER_PARAMS) {
    assert.ok(p.kinds.length > 0, `${p.id}: hech qaysi vositaga tegishli emas`);
    for (const k of p.kinds) assert.ok((TEACHER_KINDS as readonly string[]).includes(k), `${p.id}: noma'lum kind ${k}`);
    assert.equal(new Set(p.kinds).size, p.kinds.length, `${p.id}: takroriy kind`);
    assert.ok(p.impacts.length > 0, `${p.id}: «bezak maydon» — impacts bo'sh`);
    assert.equal(new Set(p.impacts).size, p.impacts.length, `${p.id}: takroriy impact`);
  }
  // Har vositada kamida mavzu + shapka + o'z parametrlari bo'lsin.
  for (const kind of TEACHER_KINDS) {
    const own = teacherParamsOf(kind);
    assert.ok(own.length >= 8, `${kind}: ${own.length} parametr — juda kam`);
    for (const id of ["topic", "subject", "language", "university", "author"]) assert.ok(own.some((p) => p.id === id), `${kind}: «${id}» yo'q`);
  }
  // Test — eng boy forma (rejim, tur, savol soni, variant, OMR…).
  assert.ok(teacherParamsOf("test").length > teacherParamsOf("glossary").length);
});

test("narx faqat glossariy `termCount` da; JSON maydonlar reyestrdan", () => {
  const priced = TEACHER_PARAMS.filter((p) => p.impacts.includes("price"));
  assert.deepEqual(priced.map((p) => p.id), ["termCount"], "MUTATSIYA: parametr narxga ta'sir qilsa, raqobatchi narxi buziladi");
  assert.deepEqual([...priced[0].kinds], ["glossary"]);
  // JSON maydonlar reyestrda ham bor (aks holda `validate.ts` ularni 4 000 belgida kesardi).
  for (const f of TEACHER_JSON_FIELDS) {
    const p = TEACHER_PARAMS.find((x) => x.id === f);
    assert.ok(p, `${f}: JSON maydon reyestrda yo'q`);
    assert.equal(p!.encode, "json", `${f}: encode json bo'lishi kerak`);
  }
  // `probeWith` faqat boshqa parametr ochadigan maydonlarda (shartli ko'rinish).
  for (const p of TEACHER_PARAMS.filter((x) => x.probeWith)) {
    const keys = Object.keys(p.probeWith!);
    assert.ok(keys.length > 0, `${p.id}: bo'sh probeWith`);
    for (const k of keys) assert.ok(TEACHER_PARAMS.some((x) => x.id === k), `${p.id}: probeWith «${k}» reyestrda yo'q`);
  }
});
