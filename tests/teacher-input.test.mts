import test from "node:test";
import assert from "node:assert/strict";
import { encodeTeacherValues, parseTeacherList, teacherInputFromValues, teacherTypeIdOf } from "../lib/generation/teacher/input.ts";
import { TEACHER_LIMITS } from "../lib/generation/teacher/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import type { DocMeta } from "../lib/generation/types.ts";

/**
 * O'QITUVCHI KIRISHI (AUDIT-20 WP-A).
 *
 * Bu faylning MAQSADI — «forma nima yuborsa ham server o'z chegarasini
 * qo'yadi» qoidasini qulflash (R0 ochiq band 3). Shuning uchun deyarli
 * har test ATAYLAB yaroqsiz qiymat beradi: 999 daqiqalik dars, 500
 * soatlik fan, boshqa turdan qolib ketgan tarjima ustunlari, buzuq JSON.
 */

const metaOf = (toolId: "lesson-plan" | "texnologik-xarita" | "glossary" | "keys", values: FormValues): DocMeta =>
  extractMeta(TOOL_BY_ID[toolId], values);

const lessonInput = (values: FormValues) => teacherInputFromValues(metaOf("lesson-plan", values), values, "lesson");
const mapInput = (values: FormValues) => teacherInputFromValues(metaOf("texnologik-xarita", values), values, "map");
const glossaryInput = (values: FormValues) => teacherInputFromValues(metaOf("glossary", values), values, "glossary");
const keysInput = (values: FormValues) => teacherInputFromValues(metaOf("keys", values), values, "keys");

test("tur formadagi kind maydonidan olinadi, noma'lumi standartga tushadi", () => {
  assert.equal(teacherTypeIdOf("lesson", { lessonType: "nazorat" }), "nazorat");
  assert.equal(teacherTypeIdOf("lesson", { lessonType: "yo'q-bunday-tur" }), "yangi-mavzu");
  assert.equal(teacherTypeIdOf("glossary", {}), "fan-lugati");
  assert.equal(teacherTypeIdOf("keys", { keysType: "rolli" }), "rolli");
  // Xarita turi bilan `mapType` parametri AYNI maydon.
  assert.equal(teacherTypeIdOf("map", { mapType: "choraklik" }), "choraklik");
});

test("davomiylik turning ruxsat etgan chiplariga tushadi", () => {
  // `nazorat` turi faqat 45/90 ni qabul qiladi — 30 ga eng yaqini 45.
  assert.equal(lessonInput({ lessonType: "nazorat", duration: 30 }).duration, 45);
  assert.equal(lessonInput({ lessonType: "yangi-mavzu", duration: 30 }).duration, 30);
  // Absurd qiymat ham chegarada qoladi.
  const wild = lessonInput({ lessonType: "yangi-mavzu", duration: 999 });
  assert.ok(wild.duration <= TEACHER_LIMITS.durationMax, `davomiylik: ${wild.duration}`);
  assert.equal(wild.duration, 90);
});

test("bosqich soni turning [min,max] oralig'iga siqiladi", () => {
  // `nazorat`: 4–6.
  assert.equal(lessonInput({ lessonType: "nazorat", stageCount: 8 }).stageCount, 6);
  assert.equal(lessonInput({ lessonType: "nazorat", stageCount: 1 }).stageCount, 4);
  assert.equal(lessonInput({ lessonType: "yangi-mavzu", stageCount: 8 }).stageCount, 8);
  // Berilmasa — turning standarti.
  assert.equal(lessonInput({ lessonType: "nazorat" }).stageCount, 4);
});

test("jami soat haftalik soatdan kam bo'la olmaydi va chegarada qoladi", () => {
  const low = mapInput({ weeklyHours: 6, totalHours: 2 });
  assert.equal(low.weeklyHours, 6);
  assert.ok(low.totalHours >= low.weeklyHours, `jami: ${low.totalHours}`);
  const wild = mapInput({ weeklyHours: 99, totalHours: 9999 });
  assert.ok(wild.weeklyHours <= TEACHER_LIMITS.weeklyHoursMax);
  assert.ok(wild.totalHours <= TEACHER_LIMITS.totalHoursMax);
});

test("atama soni turning minimumi va umumiy maksimumi orasida", () => {
  assert.equal(glossaryInput({ glossaryType: "fan-lugati", termCount: 40 }).termCount, 40);
  // `fan-lugati` uchun `termsMin` 10 — 3 so'ralsa 10 ga ko'tariladi.
  assert.equal(glossaryInput({ glossaryType: "fan-lugati", termCount: 3 }).termCount, 10);
  assert.equal(glossaryInput({ glossaryType: "fan-lugati", termCount: 500 }).termCount, TEACHER_LIMITS.termsMax);
  // `imtihon-atamalari` standarti 20.
  assert.equal(glossaryInput({ glossaryType: "imtihon-atamalari" }).termCount, 20);
});

test("tarjima ustunlari FAQAT uch tilli turda qoladi", () => {
  const tri = glossaryInput({ glossaryType: "uch-tilli", translationLangs: "ru,en" });
  assert.deepEqual(tri.translationLangs, ["ru", "en"]);
  // Forma turni almashtirgach eski qiymat «osilib» qolmasin.
  const plain = glossaryInput({ glossaryType: "fan-lugati", translationLangs: "ru,en" });
  assert.deepEqual(plain.translationLangs, []);
  // Uch tilli turda faqat `ru` tanlansa — faqat `ru`.
  assert.deepEqual(glossaryInput({ glossaryType: "uch-tilli", translationLangs: "ru" }).translationLangs, ["ru"]);
});

test("keys soni va auditoriyasi normallashadi", () => {
  assert.equal(keysInput({ caseCount: 8 }).caseCount, 8);
  assert.equal(keysInput({ caseCount: 99 }).caseCount, TEACHER_LIMITS.casesMax);
  assert.equal(keysInput({ caseCount: 1 }).caseCount, TEACHER_LIMITS.casesMin);
  assert.equal(keysInput({ audience: "maktab" }).audience, "maktab");
  assert.equal(keysInput({ audience: "boshqa" }).audience, "otm");
});

test("sinf harfi va sana faqat to'g'ri shaklda qabul qilinadi", () => {
  assert.equal(lessonInput({ gradeLetter: "a" }).gradeLetter, "A");
  assert.equal(lessonInput({ gradeLetter: "AB" }).gradeLetter, "");
  assert.equal(lessonInput({ gradeLetter: "7" }).gradeLetter, "");
  assert.equal(lessonInput({ date: "2026-09-16" }).date, "2026-09-16");
  assert.equal(lessonInput({ date: "16.09.2026" }).date, "");
});

test("JSON maydon uch shaklda ham o'qiladi, buzug'i jimgina bo'sh qoladi", () => {
  assert.deepEqual(parseTeacherList('["A","B"]', 5), ["A", "B"]);
  assert.deepEqual(parseTeacherList("A, B", 5), ["A", "B"]);
  assert.deepEqual(parseTeacherList(["A", "A", "B"], 5), ["A", "B"]);
  assert.deepEqual(parseTeacherList("[not json", 5), []);
  assert.deepEqual(parseTeacherList(null, 5), []);
  // Kompetensiyalar chegarasi reyestrdan.
  const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => `K${i}`));
  assert.equal(lessonInput({ competencies: many }).competencies.length, TEACHER_LIMITS.competenciesMax);
});

test("xaritada mavzu fan nomi bo'lishi mumkin — `subject` bo'sh qolmaydi", () => {
  const i = mapInput({ topic: "Informatika" });
  assert.equal(i.subject, "Informatika");
  // Fan alohida berilsa u ustun.
  assert.equal(mapInput({ topic: "Informatika", subject: "Matematika" }).subject, "Matematika");
});

test("encodeTeacherValues faqat SHU kindning maydonlarini yozadi", () => {
  const glossary = encodeTeacherValues(glossaryInput({ glossaryType: "uch-tilli", termCount: 20, topic: "Biologiya" }));
  assert.equal(glossary.glossaryType, "uch-tilli");
  assert.equal(glossary.termCount, 20);
  assert.equal(glossary.translationLangs, "ru,en");
  // Xarita/dars maydonlari qoralamaga tushmasin (zond uchun yolg'on signal).
  assert.equal(glossary.weeklyHours, undefined);
  assert.equal(glossary.duration, undefined);
  assert.equal(glossary.caseCount, undefined);

  const map = encodeTeacherValues(mapInput({ mapType: "choraklik", weeklyHours: 3, totalHours: 102 }));
  assert.equal(map.mapType, "choraklik");
  assert.equal(map.weeklyHours, 3);
  assert.equal(map.termCount, undefined);
});

test("kirish → encode → kirish aylanishi qiymatlarni saqlaydi", () => {
  const values: FormValues = {
    topic: "Fotosintez jarayoni",
    subject: "Biologiya",
    grade: 7,
    gradeLetter: "B",
    date: "2026-09-16",
    language: "ru",
    university: "15-son maktab",
    author: "Karimova Dilnoza",
    approver: "Direktor o'rinbosari",
    lessonType: "amaliy",
    duration: 90,
    stageCount: 6,
    competencies: '["Axborot bilan ishlash"]',
    assessmentStyle: "bsb",
    extra: "Interaktiv usullarga urg'u bering.",
  };
  const first = lessonInput(values);
  const again = lessonInput(encodeTeacherValues(first) as FormValues);
  assert.deepEqual(again, first);
});
