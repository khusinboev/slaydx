import test from "node:test";
import assert from "node:assert/strict";
import { PROFESSIONS, professionById, searchProfessions, skillsForRole } from "../lib/professions.ts";

/**
 * Kasblar ma'lumot bazasi (Rezyume 2, 2-band; AUDIT-16 da kengaytirilgan).
 *
 * Ma'lumot `data/professions.json` da — `scripts/gen-professions.mts`
 * ESCO va hh.ru taksonomiyalaridan yasab, kommit qilingan. Test uning
 * TUZILMASINI va qidiruv sifatini qulflaydi: ro'yxat qayta yasalganda
 * yoki kengaytirilganda buzilgan yozuv jimgina o'tib ketmasin.
 */

/** Generatorda e'lon qilingan 24 sektor — boshqasi paydo bo'lsa xato. */
const SECTORS = new Set([
  "it", "moliya", "talim", "tibbiyot", "huquq", "savdo", "marketing", "ishlab-chiqarish",
  "qurilish", "logistika", "xizmat", "davlat", "qishloq", "energetika", "media", "dizayn",
  "hr", "mamuriy", "transport", "turizm", "sport", "fan", "sanat", "xavfsizlik",
]);

test("ro'yxat: 1 000 dan ko'p, id lar unikal va kebab-case", () => {
  assert.ok(PROFESSIONS.length >= 1000, `jami: ${PROFESSIONS.length}`);
  const ids = new Set<string>();
  for (const p of PROFESSIONS) {
    assert.match(p.id, /^[a-z0-9-]+$/, `id: ${p.id}`);
    assert.ok(!ids.has(p.id), `takrorlangan id: ${p.id}`);
    ids.add(p.id);
  }
});

test("har yozuvda uz/ru/en nomi, tanilgan sektor va 5–12 ta ko'nikma bor", () => {
  for (const p of PROFESSIONS) {
    for (const f of ["uz", "ru", "en"] as const) {
      assert.ok(p[f].trim().length > 1, `${p.id}: ${f} bo'sh`);
    }
    assert.ok(SECTORS.has(p.sector), `${p.id}: notanish sektor «${p.sector}»`);
    assert.ok(p.skills.length >= 5 && p.skills.length <= 12, `${p.id}: ${p.skills.length} ta ko'nikma`);
    const seen = new Set<string>();
    for (const s of p.skills) {
      assert.ok(s.trim() && s.length <= 40, `${p.id}: ko'nikma «${s}»`);
      assert.ok(!seen.has(s.toLowerCase()), `${p.id}: takrorlangan ko'nikma «${s}»`);
      seen.add(s.toLowerCase());
    }
  }
});

test("nomlar takrorlanmaydi (bir kasb ikki sektorda bo'lsa birlashtirilgan)", () => {
  /*
   * Nomlar UCH tilda ham tekshiriladi: ESCO inglizcha, hh.ru ruscha nom
   * beradi, ikkalasi ham bitta o'zbekcha lavozimga aylanishi mumkin.
   * Faqat `uz` bo'yicha tekshirilsa, «Buxgalter» va «Bosh hisobchi»
   * kabi juftlik ro'yxatda ikki marta qolib ketardi.
   */
  for (const field of ["uz", "ru", "en"] as const) {
    const names = new Set<string>();
    for (const p of PROFESSIONS) {
      const key = p[field].trim().toLowerCase().replace(/[‘’ʻʼ`']/g, "'");
      assert.ok(!names.has(key), `takrorlangan ${field} nom: ${p[field]} (${p.id})`);
      names.add(key);
    }
  }
});

test("o'zbekcha matnda apostrof BIR xil: o' va g', tipografik belgi yo'q", () => {
  /*
   * Ro'yxat ikki bosqichda (2026-03 va AUDIT-16) yasalgani uchun LLM
   * gohida `oʻ`/`o‘` qaytaradi. Aralashsa forma ro'yxatida bir xil
   * kasb ikki xil ko'rinadi — buni faqat ko'z bilan ushlash qiyin.
   */
  for (const p of PROFESSIONS) {
    for (const s of [p.uz, ...p.skills, ...p.aliases]) {
      assert.doesNotMatch(s, /[‘’ʻʼ´`]/, `${p.id}: «${s}» da tipografik apostrof`);
    }
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

test("qidiruv: ALIAS ham indeksda — nom emas, faqat muqobil yozuv", () => {
  /*
   * MUTATSIYA maqsadi: `lib/professions.ts` indeksidan `p.aliases`
   * olib tashlansa, shu test qizaradi. «bojxonachi» hech bir kasbning
   * uz/ru/en NOMI emas — u faqat alias sifatida mavjud, shuning uchun
   * alias indeksi yo'qolsa natija BO'SH qoladi.
   */
  const hit = searchProfessions("bojxonachi", 4)[0];
  assert.ok(hit, "alias bo'yicha natija bo'lishi kerak");
  assert.equal(hit.match, "alias");
  assert.match(hit.label.toLowerCase(), /bojxona/);
  for (const p of PROFESSIONS) {
    for (const f of ["uz", "ru", "en"] as const) {
      assert.ok(!p[f].toLowerCase().includes("bojxonachi"), `«bojxonachi» endi ${f} nomida — boshqa namuna tanlang`);
    }
  }
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
  /*
   * MUTATSIYA: indeks har qidiruvda qayta qurilsa yoki « + so'rov»
   * satri sikl ICHIDA yasalsa, shu chegara buziladi. Ro'yxat 1 000+
   * yozuvga o'sgani uchun bu endi nazariy emas — eski, ichma-ich
   * obyektli indeks bilan o'lchov 300 ms atrofiga chiqardi.
   */
  searchProfessions("mu", 8); // JIT isishi o'lchovga tushmasin
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) searchProfessions("mu", 8);
  const ms = Date.now() - t0;
  assert.ok(ms < 300, `${ms} ms`);
});
