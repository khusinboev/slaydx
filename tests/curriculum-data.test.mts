import test from "node:test";
import assert from "node:assert/strict";
import { curriculumFile, curriculumIndex, curriculumTopics, flatTopics, hasCurriculum, pickTopics } from "../lib/curriculum.ts";
import type { CurriculumEntry, CurriculumFile } from "../lib/curriculum.ts";

/**
 * O'QUV DASTURI BAZASINING O'ZI (AUDIT-20 WP-B) — `data/curriculum/`.
 *
 * `tests/curriculum.test.mts` (R0) MODULNI sinaydi (indeks/fayl
 * mosligi, `hasCurriculum`, route shakli). Bu fayl esa MA'LUMOTNI:
 * baza qo'lda emas, `scripts/{fetch,gen}-curriculum.mts` bilan
 * yasaladi va gitda ko'rib chiqiladi, ya'ni parsing nuqsoni (bo'linib
 * ketgan mavzu, kompetensiya bandi mavzu bo'lib qolishi, takroriy id)
 * JIMGINA kommit bo'lib ketishi mumkin — shu testlar buni ushlaydi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `gen-curriculum.mts` dan `dedupe` olib tashlandi — «id unikal»
 *      va «mavzu takrorlanmaydi» testlari;
 *   2. `NOT_A_TOPIC` filtri o'chirildi (nazorat ishi/kompetensiya
 *      qatorlari mavzu bo'lib qoldi) — «uslubiy nasr yo'q» testi;
 *   3. `yearHoursOf` bobning soatini yillik soat deb oldi — «bob soati
 *      yillikdan oshmaydi» testi;
 *   4. `firstSentence` butun bo'lakni sarlavha qildi — «sarlavha
 *      uzunligi» testi;
 *   5. `lib/curriculum.ts FILES` jadvaliga yangi fan qo'shilmadi —
 *      «indeksdagi har fan yuklanadi» testi.
 */

/** Manba tuzilishi: ba'zi hujjat IKKI modulli (fizika+astronomiya, algebra+geometriya). */
const HOURS_SUM_FACTOR = 2.5;
/** Mahsulot va'dasi (AUDIT-20 §1 WP-B): kamida 6 fan haqiqiy manbadan. */
const MIN_SUBJECTS = 6;
const MIN_ENTRIES = 30;

/** Uslubiy nasr / kompetensiya / nazorat ishi — mavzu nomi BO'LA OLMAYDI. */
const NOISE = [
  /\bo['‘’ʻ]?quvchilar\b/i,
  /kompetensiya/i,
  /nazorat ishi/i,
  /xatolar ustida ishlash/i,
  /^jihozlar/i,
  /^\d*-?laboratoriya/i,
  /tushuntirish xati/i,
  /\bbiladi\b|\btushunadi\b|\bayta oladi\b/i,
];

async function allFiles(): Promise<{ id: string; file: CurriculumFile }[]> {
  const out: { id: string; file: CurriculumFile }[] = [];
  for (const s of curriculumIndex().subjects) {
    const file = await curriculumFile(s.id);
    assert.ok(file, `${s.id}: indeksda bor, lekin \`lib/curriculum.ts FILES\` jadvalida yuklagichi yo'q`);
    out.push({ id: s.id, file: file! });
  }
  return out;
}

const topicsOf = (e: CurriculumEntry) => e.units.flatMap((u) => u.topics);

/* ────────────────────────── testlar ────────────────────────── */

test("qamrov: ≥6 fan, ≥30 fan×sinf yozuvi, har fanda ≥1 sinf", async () => {
  const idx = curriculumIndex();
  assert.ok(idx.subjects.length >= MIN_SUBJECTS, `fanlar: ${idx.subjects.length} (kerak ≥ ${MIN_SUBJECTS})`);
  const files = await allFiles();
  const entries = files.reduce((a, f) => a + f.file.entries.length, 0);
  assert.ok(entries >= MIN_ENTRIES, `fan×sinf yozuvi: ${entries} (kerak ≥ ${MIN_ENTRIES})`);
  for (const { id, file } of files) {
    assert.ok(file.entries.length >= 1, `${id}: bironta sinf yo'q`);
    // MUTATSIYA-5: `FILES` jadvaliga fan qo'shilmasa `allFiles` yuqorida yiqiladi.
    assert.equal(file.subject.id, id, `${id}: fayl ichidagi fan id boshqa`);
    const grades = file.entries.map((e) => e.grade);
    assert.equal(new Set(grades).size, grades.length, `${id}: takroriy sinf yozuvi`);
  }
});

test("mavzular: id fan+sinf ichida unikal va slug shaklida", async () => {
  for (const { id, file } of await allFiles()) {
    for (const e of file.entries) {
      const ids = topicsOf(e).map((t) => t.id);
      assert.ok(ids.length > 0, `${id} ${e.grade}: mavzu yo'q`);
      // MUTATSIYA-1: `dedupe` olib tashlansa bu yerda takror chiqadi.
      assert.equal(new Set(ids).size, ids.length, `${id} ${e.grade}: takroriy mavzu id`);
      for (const t of ids) assert.match(t, /^[a-z0-9Ѐ-ӿ-]+-\d+$/, `${id} ${e.grade}: id shakli «${t}»`);
    }
  }
});

test("bo'sh bob yo'q; bob va mavzu sarlavhalari 3–200 belgi", async () => {
  for (const { id, file } of await allFiles()) {
    for (const e of file.entries) {
      assert.ok(e.units.length > 0, `${id} ${e.grade}: bob yo'q`);
      for (const u of e.units) {
        assert.ok(u.title.trim().length >= 3 && u.title.length <= 200, `${id} ${e.grade}: bob sarlavhasi «${u.title}»`);
        assert.ok(u.topics.length > 0, `${id} ${e.grade}: «${u.title}» bobida mavzu yo'q`);
        for (const t of u.topics) {
          // MUTATSIYA-4: butun bo'lak sarlavha bo'lsa 200 belgidan oshardi.
          assert.ok(t.title.trim().length >= 3, `${id} ${e.grade}: juda qisqa mavzu «${t.title}»`);
          assert.ok(t.title.length <= 200, `${id} ${e.grade}: juda uzun mavzu (${t.title.length}) «${t.title.slice(0, 60)}…»`);
          assert.equal(t.title, t.title.trim(), `${id} ${e.grade}: chetlari kesilmagan «${t.title}»`);
        }
      }
    }
  }
});

test("mavzu nomlari — MAVZU, uslubiy nasr emas (parser filtri qulflanadi)", async () => {
  const bad: string[] = [];
  for (const { id, file } of await allFiles()) {
    for (const e of file.entries) {
      for (const t of topicsOf(e)) {
        // MUTATSIYA-2: `NOT_A_TOPIC` filtri o'chirilsa o'nlab qator chiqadi.
        if (NOISE.some((re) => re.test(t.title))) bad.push(`${id} ${e.grade}: ${t.title}`);
        // PDF dan kelgan yopishib qolgan so'zlar («Hayotninghujayrasiz»).
        assert.ok(!/[a-z‘’][A-Z]/.test(t.title.slice(0, 40)), `${id} ${e.grade}: yopishib qolgan so'z «${t.title}»`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} ta mavzu nomi uslubiy nasr`);
});

test("bitta bob ichida mavzu nomlari takrorlanmaydi", async () => {
  for (const { id, file } of await allFiles()) {
    for (const e of file.entries) {
      const seen = new Set<string>();
      for (const t of topicsOf(e)) {
        const key = t.title.toLowerCase().replace(/[‘’ʻʼ']/g, "'").replace(/\s+/g, " ");
        assert.ok(!seen.has(key), `${id} ${e.grade}: «${t.title}» ikki marta`);
        seen.add(key);
      }
    }
  }
});

test("soatlar: har bob ≤ yillik soat, yig'indi ≤ 2,5 × yillik (ikki modulli hujjatlar)", async () => {
  let withYear = 0;
  for (const { id, file } of await allFiles()) {
    for (const e of file.entries) {
      for (const u of e.units) {
        if (u.hours === undefined) continue;
        assert.ok(Number.isInteger(u.hours) && u.hours > 0 && u.hours <= 250, `${id} ${e.grade}: «${u.title}» soati ${u.hours}`);
      }
      if (e.hours === undefined) continue;
      withYear++;
      assert.ok(Number.isInteger(e.hours) && e.hours >= 30 && e.hours <= 250, `${id} ${e.grade}: yillik soat ${e.hours}`);
      const sum = e.units.reduce((a, u) => a + (u.hours ?? 0), 0);
      const widest = Math.max(0, ...e.units.map((u) => u.hours ?? 0));
      // MUTATSIYA-3: bobning soati yillik soat deb olinsa bu yerda yiqiladi.
      assert.ok(widest <= e.hours, `${id} ${e.grade}: bitta bob (${widest} soat) yillik soatdan (${e.hours}) katta`);
      assert.ok(sum <= e.hours * HOURS_SUM_FACTOR, `${id} ${e.grade}: boblar yig'indisi ${sum} > ${HOURS_SUM_FACTOR} × ${e.hours}`);
    }
  }
  assert.ok(withYear >= 20, `yillik soati e'lon qilingan yozuvlar: ${withYear} (kerak ≥ 20)`);
});

test("manba: har yozuvda uzbmb.uz PDF havolasi va nashriyot", async () => {
  for (const { id, file } of await allFiles()) {
    assert.match(file.version, /^\d{4}-\d{2}-\d{2}$/, `${id}: versiya`);
    assert.equal(file.version, curriculumIndex().version, `${id}: indeks bilan versiya farq qiladi`);
    for (const e of file.entries) {
      assert.match(e.source.url, /^https:\/\/uzbmb\.uz\/.*\.pdf$/i, `${id} ${e.grade}: manba havolasi «${e.source.url}»`);
      assert.ok(e.source.title.length > 20, `${id} ${e.grade}: manba sarlavhasi qisqa`);
      assert.ok(String(e.source.publisher ?? "").includes("ta'lim markazi"), `${id} ${e.grade}: nashriyot yo'q`);
      assert.equal(e.source.year, 2018, `${id} ${e.grade}: nashr yili`);
      /*
       * Sinf raqami havolada yoki sarlavhada ko'rinsin (yozuv boshqa
       * faylga ulanib qolmasin). Qo'shma hujjatda («6-7-sinf») raqam
       * oraliqning ichida turadi, shuning uchun oddiy `includes` emas.
       */
      const gradeRe = new RegExp(`(^|[^0-9])${e.grade}\\s*(?:[-–]\\s*[0-9]+\\s*)?-?\\s*sinf`, "i");
      const where = `${decodeURIComponent(e.source.url)} ${e.source.title}`;
      assert.ok(gradeRe.test(where), `${id} ${e.grade}: manba boshqa sinfniki — ${e.source.url}`);
    }
  }
});

test("`hasCurriculum` HAQIQIY: bazadagi juftlikda `true`, yo'g'ida `false`", async () => {
  const idx = curriculumIndex();
  for (const s of idx.subjects) for (const g of s.grades) assert.ok(hasCurriculum(s.id, g), `${s.id} ${g}: indeksda bor, lekin hasCurriculum() yo'q dedi`);
  // Manbada YO'Q juftliklar (`CURRICULUM-SOURCES.md` da qayd etilgan bo'shliqlar).
  assert.ok(!hasCurriculum("matematika", 9), "matematika 9-sinf fayli manbada yo'q — baza uni da'vo qilmasin");
  assert.ok(!hasCurriculum("geografiya", 11), "geografiya 11-sinf fayli manbada yo'q");
  assert.ok(!hasCurriculum("astronomiya", 11), "bazada yo'q fan");
  assert.ok(!hasCurriculum("matematika", 0));
});

test("`curriculumTopics` / `pickTopics` haqiqiy ma'lumot ustida ishlaydi", async () => {
  const entry = await curriculumTopics("matematika", 5);
  assert.ok(entry, "matematika 5-sinf yozuvi yo'q");
  const flat = flatTopics(entry!);
  assert.ok(flat.length >= 20, `5-sinf matematikasida ${flat.length} mavzu`);
  const ids = flat.slice(0, 3).map((t) => t.id);
  const picked = pickTopics(entry!, [...ids, "yoq-mavzu-999"]);
  assert.deepEqual(picked.map((t) => t.id), ids, "noma'lum id jimgina tashlanishi kerak edi");
  // Test dvigateli promptga ≤5 mavzu beradi — ro'yxat shunga yetadi.
  assert.ok(flat.length >= 5);
  assert.equal(await curriculumTopics("matematika", 9), null, "bazada yo'q sinf `null` qaytarishi kerak");
});

test("qo'shma hujjat (matematika 6–7) ikkala sinfga ham AYNI mundarijani beradi", async () => {
  const six = await curriculumTopics("matematika", 6);
  const seven = await curriculumTopics("matematika", 7);
  assert.ok(six && seven, "6/7-sinf yozuvlari yo'q");
  // Manba BITTA hujjat — shuning uchun havola ham, mundarija ham bir xil.
  assert.equal(six!.source.url, seven!.source.url, "qo'shma hujjat ikki xil havolaga bog'landi");
  assert.deepEqual(flatTopics(six!).map((t) => t.id), flatTopics(seven!).map((t) => t.id));
  assert.match(six!.source.title, /6–7-sinf/, `qo'shma sinf sarlavhada ko'rinmadi: ${six!.source.title}`);
});

test("tarix uchga bo'lingan: 5–6 umumiy, 7–11 jahon va O'zbekiston alohida", async () => {
  const idx = curriculumIndex();
  const byId = new Map(idx.subjects.map((s) => [s.id, s]));
  assert.deepEqual(byId.get("tarix")?.grades, [5, 6], "umumiy tarix faqat 5–6-sinf bo'lishi kerak");
  assert.deepEqual(byId.get("jahon-tarixi")?.grades, [7, 8, 9, 10, 11]);
  assert.deepEqual(byId.get("ozbekiston-tarixi")?.grades, [7, 8, 9, 10, 11]);
  // Ikki dastur ARALASHMAGAN: 7-sinfda manbalar ham, mavzular ham boshqa.
  const jahon = await curriculumTopics("jahon-tarixi", 7);
  const uz = await curriculumTopics("ozbekiston-tarixi", 7);
  assert.notEqual(jahon!.source.url, uz!.source.url);
  const shared = new Set(flatTopics(jahon!).map((t) => t.title));
  const overlap = flatTopics(uz!).filter((t) => shared.has(t.title));
  assert.ok(overlap.length <= 2, `ikki dastur mavzulari aralashib ketdi: ${overlap.map((t) => t.title).join(" | ")}`);
});
