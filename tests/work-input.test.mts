import test from "node:test";
import assert from "node:assert/strict";
import { encodeWorkValues, maxVisualsFor, parseWorkFigureKinds, parseWorkOutline, parseWorkUserRefs, workInputFromValues } from "../lib/generation/work/input.ts";
import { workKindOf } from "../lib/generation/work/registry.ts";
import { WORK_LIMITS } from "../lib/generation/work/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * KIRISH QATLAMI (AUDIT-19 WP-A): forma qiymatlaridan `WorkInput` ga.
 * Zond (`work-params`) va dvigatel shu normalizatsiyaga tayanadi, shuning
 * uchun chegaralar va qo'lda yozilgan reja parseri shu yerda qulflanadi.
 */

const BASE: FormValues = {
  topic: "Boshlang'ich sinfda o'qish ko'nikmalarini rivojlantirish",
  workKind: "theory",
  subjectProfile: "humanities",
  language: "uz",
  pages: "25-30",
  author: "Aliyev Ali — 3-kurs, 301-guruh",
  university: "Toshkent davlat universiteti",
  teacher: "Rahimov B.",
  city: "Toshkent",
};

test("normallashtirish: tur, fan profili, til, paket, muallif satri (kurs/guruh ajraladi)", () => {
  const i = workInputFromValues(BASE, "coursework");
  assert.equal(i.genre, "coursework");
  assert.equal(i.kind, "theory");
  assert.equal(i.subject, "humanities");
  assert.equal(i.language, "uz");
  assert.equal(i.pages, "25-30");
  assert.equal(i.author, "Aliyev Ali");
  assert.equal(i.course, "3");
  assert.equal(i.group, "301");
  // Noma'lum qiymatlar — standartga.
  const bad = workInputFromValues({ ...BASE, workKind: "zzz", subjectProfile: "zzz", language: "de", pages: "99-100" }, "coursework");
  assert.equal(bad.kind, "theory");
  assert.equal(bad.subject, "humanities");
  assert.equal(bad.language, "uz");
  assert.equal(bad.pages, "20-25", "noma'lum paket — turning standart chipiga");
});

test("aniq `group`/`course` maydonlari muallif satridan USTUN", () => {
  const i = workInputFromValues({ ...BASE, group: "404-A", course: "4" }, "coursework");
  assert.equal(i.group, "404-A");
  assert.equal(i.course, "4");
  assert.equal(i.author, "Aliyev Ali");
});

test("vazirlik: oliy | maktab | custom; «o'z matnim» faqat custom da saqlanadi", () => {
  assert.equal(workInputFromValues(BASE, "coursework").ministry, "oliy");
  assert.equal(workInputFromValues({ ...BASE, ministry: "maktab" }, "coursework").ministry, "maktab");
  const custom = workInputFromValues({ ...BASE, ministry: "custom", ministryCustom: "RAQAMLI TEXNOLOGIYALAR VAZIRLIGI" }, "coursework");
  assert.equal(custom.ministry, "custom");
  assert.equal(custom.ministryCustom, "RAQAMLI TEXNOLOGIYALAR VAZIRLIGI");
  // `custom` tanlanmagan bo'lsa matn TASHLANADI — titulda ikki vazirlik chiqmasin.
  const oliy = workInputFromValues({ ...BASE, ministry: "oliy", ministryCustom: "BOSHQA VAZIRLIK" }, "coursework");
  assert.equal(oliy.ministryCustom, "");
  // Noma'lum kod — oliy.
  assert.equal(workInputFromValues({ ...BASE, ministry: "zzz" }, "coursework").ministry, "oliy");
});

test("tocText parseri: «1-BOB.» va «1.1.» qatorlari bob/paragrafga ajraladi", () => {
  const toc = [
    "Kirish",
    "1-BOB. O'QISH KO'NIKMASINING NAZARIY ASOSLARI",
    "1.1. Ko'nikma tushunchasi",
    "1.2. Yondashuvlar tahlili",
    "2-BOB. AMALIY TAHLIL",
    "2.1. Tashxis natijalari",
    "2.2. Tavsiyalar",
    "Xulosa",
    "Foydalanilgan adabiyotlar",
  ].join("\n");
  const out = parseWorkOutline(toc);
  assert.equal(out.length, 2, "Kirish/Xulosa/Adabiyotlar bob EMAS");
  assert.equal(out[0].title, "O'QISH KO'NIKMASINING NAZARIY ASOSLARI");
  assert.deepEqual(out[0].paragraphs, ["Ko'nikma tushunchasi", "Yondashuvlar tahlili"]);
  assert.equal(out[1].title, "AMALIY TAHLIL");
  assert.deepEqual(out[1].paragraphs, ["Tashxis natijalari", "Tavsiyalar"]);
});

test("tocText parseri: «I BOB», «ГЛАВА 1», «1.» va chekinish shakllari", () => {
  assert.deepEqual(parseWorkOutline("I BOB. Nazariy asos\n  Birinchi jihat\n  Ikkinchi jihat"), [
    { title: "Nazariy asos", paragraphs: ["Birinchi jihat", "Ikkinchi jihat"] },
  ]);
  assert.deepEqual(parseWorkOutline("ГЛАВА 1. Теория\n1.1. Понятие"), [{ title: "Теория", paragraphs: ["Понятие"] }]);
  assert.deepEqual(parseWorkOutline("1. Birinchi bo'lim\n2) Ikkinchi bo'lim"), [
    { title: "Birinchi bo'lim", paragraphs: [] },
    { title: "Ikkinchi bo'lim", paragraphs: [] },
  ]);
  // Mundarijadagi nuqtalar va sahifa raqami tozalanadi.
  assert.deepEqual(parseWorkOutline("1-BOB. Nazariy asoslar ........ 7"), [{ title: "Nazariy asoslar", paragraphs: [] }]);
  assert.deepEqual(parseWorkOutline(""), []);
  assert.deepEqual(parseWorkOutline("Kirish\nXulosa"), []);
});

test("tocText chegaralari: 6 bobdan va 6 paragrafdan oshmaydi", () => {
  const many = Array.from({ length: 9 }, (_, i) => `${i + 1}-BOB. Bob nomi ${i + 1}`).join("\n");
  assert.equal(parseWorkOutline(many).length, WORK_LIMITS.chapters);
  const manyParas = ["1-BOB. Bob", ...Array.from({ length: 9 }, (_, i) => `1.${i + 1}. Paragraf ${i + 1}`)].join("\n");
  assert.equal(parseWorkOutline(manyParas)[0].paragraphs.length, WORK_LIMITS.paragraphs);
});

test("reja MATN hal qiladi: chips `ai` bo'lsa ham tocText ishlatiladi; `manual` da extra ga qaytiladi", () => {
  const toc = "1-BOB. Nazariya\n1.1. Tushuncha";
  const auto = workInputFromValues({ ...BASE, tocMethod: "ai", tocText: toc }, "coursework");
  assert.equal(auto.outline.length, 1, "chips `ai` bo'lsa ham foydalanuvchi rejasi yo'qolmaydi");
  const manual = workInputFromValues({ ...BASE, tocMethod: "manual", tocText: "", extra: toc }, "coursework");
  assert.equal(manual.outline.length, 1, "`manual` rejimida `extra` reja sifatida o'qiladi");
  const none = workInputFromValues({ ...BASE, tocMethod: "ai", tocText: "", extra: toc }, "coursework");
  assert.equal(none.outline.length, 0, "`ai` rejimida `extra` reja EMAS");
});

test("refsMin: janr standarti (kurs 15 / referat 5 / mustaqil 8), foydalanuvchi oshirishi mumkin", () => {
  assert.equal(workInputFromValues(BASE, "coursework").refsMin, 15);
  assert.equal(workInputFromValues({ ...BASE, workKind: "informative", pages: "10-15" }, "referat").refsMin, workKindOf("referat", "informative").refsMin);
  assert.equal(workInputFromValues({ ...BASE, workKind: "written", pages: "10-15" }, "independent").refsMin, 8);
  assert.equal(workInputFromValues({ ...BASE, refsMin: 25 }, "coursework").refsMin, 25);
  assert.equal(workInputFromValues({ ...BASE, refsMin: 999 }, "coursework").refsMin, 40, "yuqori chegara");
  assert.equal(workInputFromValues({ ...BASE, refsMin: -5 }, "coursework").refsMin, 0);
});

test("vizuallar: profil standarti, paket chegarasi, `includeVisuals: false` hammasini o'chiradi", () => {
  // Gumanitar profil standarti — 1 sxema + 1 jadval.
  const def = workInputFromValues(BASE, "coursework");
  assert.equal(def.figureCount, 1);
  assert.equal(def.tableCount, 1);
  const off = workInputFromValues({ ...BASE, includeVisuals: false, figureCount: 3, tableCount: 3 }, "coursework");
  assert.equal(off.figureCount, 0);
  assert.equal(off.tableCount, 0);
  // Paket chegarasi: 10–15 betga 6 sxema sig'maydi.
  assert.equal(maxVisualsFor("10-15"), 3);
  assert.equal(maxVisualsFor("40-45"), 6);
  assert.equal(workInputFromValues({ ...BASE, pages: "10-15", figureCount: 9 }, "coursework").figureCount, 3);
  assert.equal(workInputFromValues({ ...BASE, pages: "40-45", figureCount: 9 }, "coursework").figureCount, WORK_LIMITS.figures);
  // Eski forma `images: "no"` ham vizualni o'chiradi.
  assert.equal(workInputFromValues({ ...BASE, images: "no" }, "coursework").includeVisuals, false);
});

test("sxema turlari va foydalanuvchi manbalari: JSON/CSV, noma'lumlar tashlanadi, id lar bo'shliqsiz", () => {
  assert.deepEqual(parseWorkFigureKinds('["cycle","zzz","matrix"]'), ["cycle", "matrix"]);
  assert.deepEqual(parseWorkFigureKinds("cycle, matrix, cycle"), ["cycle", "matrix"]);
  assert.deepEqual(parseWorkFigureKinds(""), []);
  const refs = parseWorkUserRefs({
    userRefs: JSON.stringify([
      { raw: "Karimov A. Pedagogika. — Toshkent: Fan, 2022." },
      { doi: "https://doi.org/10.1186/s40561-023-00260-y", year: 2023 },
      {},
      { isbn: "978-9943-01-234-5", title: "Ona tili metodikasi" },
    ]),
  });
  assert.deepEqual(refs.map((r) => r.id), ["u1", "u2", "u3"], "bo'sh qator tushadi, id lar bo'shliqsiz");
  assert.equal(refs[1].doi, "10.1186/s40561-023-00260-y", "DOI prefiksi olib tashlanadi");
  assert.equal(refs[2].title, "Ona tili metodikasi");
  // Buzuq/kesilgan JSON — bo'sh ro'yxat (ish yiqilmaydi).
  assert.deepEqual(parseWorkUserRefs({ userRefs: "[{\"raw\":\"Kari" }), []);
});

test("encodeWorkValues → workInputFromValues aylanishi qiymatlarni saqlaydi (qoralama)", () => {
  const values: FormValues = {
    ...BASE,
    ministry: "custom",
    ministryCustom: "IKKINCHI VAZIRLIK",
    tocText: "1-BOB. Nazariya\n1.1. Tushuncha",
    userFacts: "120 o'quvchi, 4,6 ball",
    userRefs: JSON.stringify([{ raw: "Karimov A. Pedagogika. — Toshkent: Fan, 2022." }]),
    figureKinds: '["cycle"]',
    refsMin: 18,
  };
  const first = workInputFromValues(values, "coursework");
  const again = workInputFromValues(encodeWorkValues(first), "coursework");
  assert.deepEqual(again, first);
});
