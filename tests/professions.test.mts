import test from "node:test";
import assert from "node:assert/strict";
import { PROFESSIONS, professionById, searchProfessions, skillsForRole } from "../lib/professions.ts";

/**
 * Kasblar ma'lumot bazasi (Rezyume 2, 2-band).
 *
 * Ma'lumot `data/professions.json` da — bir marta yasalgan va kommit
 * qilingan. Test uning TUZILMASINI va qidiruv sifatini qulflaydi:
 * ro'yxat qayta yasalganda buzilgan yozuv jimgina o'tib ketmasin.
 */

test("ro'yxat: 300 dan ko'p, id lar unikal va kebab-case", () => {
  assert.ok(PROFESSIONS.length >= 300, `jami: ${PROFESSIONS.length}`);
  const ids = new Set<string>();
  for (const p of PROFESSIONS) {
    assert.match(p.id, /^[a-z0-9-]+$/, `id: ${p.id}`);
    assert.ok(!ids.has(p.id), `takrorlangan id: ${p.id}`);
    ids.add(p.id);
  }
});

test("har yozuvda uz/ru/en nomi va 5–12 ta ko'nikma bor", () => {
  for (const p of PROFESSIONS) {
    for (const f of ["uz", "ru", "en"] as const) {
      assert.ok(p[f].trim().length > 1, `${p.id}: ${f} bo'sh`);
    }
    assert.ok(p.skills.length >= 5 && p.skills.length <= 12, `${p.id}: ${p.skills.length} ta ko'nikma`);
    for (const s of p.skills) {
      assert.ok(s.trim() && s.length <= 40, `${p.id}: ko'nikma «${s}»`);
    }
    assert.ok(p.sector.trim(), `${p.id}: sektor yo'q`);
  }
});

test("nomlar takrorlanmaydi (bir kasb ikki sektorda bo'lsa birlashtirilgan)", () => {
  const names = new Set<string>();
  for (const p of PROFESSIONS) {
    const key = p.uz.trim().toLowerCase().replace(/[‘’ʻʼ`']/g, "'");
    assert.ok(!names.has(key), `takrorlangan nom: ${p.uz}`);
    names.add(key);
  }
});

test("qidiruv: ruscha, inglizcha va o'zbekcha yozuvdan bir xil kasbga tushadi", () => {
  /*
   * MUTATSIYA: `ru`/`en` kalitlari indeksdan olib tashlansa, natija
   * ALIAS orqali baribir topilishi mumkin — shuning uchun `match`
   * maydoni ham tekshiriladi: aynan ruscha/inglizcha NOM ishlagani
   * qulflanadi (alias tasodifan qoplab qo'ymasin).
   */
  const ru = searchProfessions("бухг", 4)[0];
  assert.match(ru.label.toLowerCase(), /buxgalter/);
  assert.equal(ru.match, "ru");
  const en = searchProfessions("accountant", 4)[0];
  assert.match(en.label.toLowerCase(), /buxgalter/);
  assert.equal(en.match, "en");
  assert.match(searchProfessions("front", 4)[0].label.toLowerCase(), /frontend/);
  // Prefiks to'liq moslikdan keyin turadi: «o'qituvchi» so'zi ichida.
  assert.ok(searchProfessions("o'qituvchi", 8).length >= 4);
  // Apostrof shakli farq qilsa ham topiladi (NFKC + normalizatsiya).
  assert.ok(searchProfessions("o‘qituvchi", 8).length >= 4);
});

test("qidiruv chegarasi va bo'sh so'rov", () => {
  assert.equal(searchProfessions("mu", 3).length, 3);
  assert.ok(searchProfessions("", 5).length === 5, "bo'sh so'rov ham tavsiya beradi");
  assert.equal(searchProfessions("zzzqqq", 5).length, 0);
});

test("skillsForRole: aniq nom bo'yicha o'sha kasb ko'nikmalari", () => {
  const p = PROFESSIONS.find((x) => x.uz === "Frontend dasturchi");
  assert.ok(p, "namuna kasb topilishi kerak");
  assert.deepEqual(skillsForRole("Frontend dasturchi"), p!.skills);
  // Yozilgan matn ro'yxatda bo'lmasa — eng yaqin kasbdan; umuman bo'lmasa bo'sh.
  assert.deepEqual(skillsForRole(""), []);
  assert.ok(professionById(p!.id));
});

test("tezlik: 1 000 qidiruv 300 ms dan tez (forma har harfda chaqiradi)", () => {
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) searchProfessions("mu", 8);
  const ms = Date.now() - t0;
  assert.ok(ms < 300, `${ms} ms`);
});
