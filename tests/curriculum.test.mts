import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  curriculumFile,
  curriculumIndex,
  curriculumSubject,
  curriculumTopics,
  flatTopics,
  hasCurriculum,
  pickTopics,
} from "../lib/curriculum.ts";

/**
 * O'QUV DASTURI BAZASI (AUDIT-20 R0) — `data/curriculum/`.
 *
 * Baza qo'lda emas, `scripts/*curriculum*.mts` bilan yasaladi (WP-B) va
 * gitda ko'rib chiqiladi, shuning uchun uni FAYL sifatida tekshirish
 * kerak: parsing xatosi (bo'linib ketgan mavzu, takroriy id, bo'sh bob)
 * jimgina kommit bo'lib ketmasin. R4 hisoboti (`docs/research/curriculum.md`
 * §4.5) shu ro'yxatni beradi.
 *
 * Mutatsiya (qizardi): `matematika.json` da ikkita mavzuga bir xil `id`
 * qo'yildi — «id unikal» testi; bitta bobning `topics` i bo'shatildi —
 * «bo'sh bob yo'q» testi.
 */

test("indeks yuklanadi: versiya, manba, fan id lari unikal", () => {
  const idx = curriculumIndex();
  assert.match(idx.version, /^\d{4}-\d{2}-\d{2}$/, `versiya sanasi: ${idx.version}`);
  assert.ok(idx.sources.length >= 1, "manba ro'yxati bo'sh — halollik chegarasi buziladi");
  for (const s of idx.sources) {
    assert.ok(s.title.length > 10, `manba sarlavhasi: ${s.title}`);
    assert.match(s.url, /^https:\/\//, `manba havolasi: ${s.url}`);
  }
  assert.ok(idx.subjects.length >= 1, "indeksda fan yo'q");
  const ids = idx.subjects.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `takroriy fan id: ${ids.join(", ")}`);
  for (const s of idx.subjects) {
    assert.match(s.id, /^[a-z0-9-]+$/, `fan id shakli: ${s.id}`);
    // Uch tilli nom (`professions.json` naqshi) — forma qidiruvi shunga tayanadi.
    for (const lang of ["uz", "ru", "en"] as const) assert.ok(s[lang].length >= 3, `${s.id}: ${lang} nomi yo'q`);
    assert.ok(s.grades.length >= 1, `${s.id}: sinf ro'yxati bo'sh`);
    for (const g of s.grades) assert.ok(Number.isInteger(g) && g >= 1 && g <= 11, `${s.id}: sinf ${g}`);
    assert.equal(new Set(s.grades).size, s.grades.length, `${s.id}: takroriy sinf`);
  }
});

test("indeks va fan fayllari MOS: har sinf faylda bor, ortiqcha yozuv yo'q", async () => {
  for (const s of curriculumIndex().subjects) {
    const file = await curriculumFile(s.id);
    assert.ok(file, `${s.id}: indeksda bor, lekin fayl yuklagichi yo'q (lib/curriculum.ts FILES)`);
    assert.equal(file!.subject.id, s.id, `${s.id}: fayl ichidagi fan id boshqa`);
    const grades = file!.entries.map((e) => e.grade).sort((a, b) => a - b);
    assert.deepEqual(grades, [...s.grades].sort((a, b) => a - b), `${s.id}: indeks va fayl sinflari farq qiladi`);
  }
});

test("mavzu id lari fan+sinf ichida unikal", async () => {
  for (const s of curriculumIndex().subjects)
    for (const g of s.grades) {
      const entry = await curriculumTopics(s.id, g);
      assert.ok(entry, `${s.id}/${g}: yozuv topilmadi`);
      const ids = flatTopics(entry!).map((t) => t.id);
      assert.ok(ids.length >= 1, `${s.id}/${g}: mavzu yo'q`);
      const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
      assert.equal(dupes.length, 0, `${s.id}/${g}: takroriy mavzu id — ${dupes.join(", ")}`);
      for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, `${s.id}/${g}: id shakli «${id}»`);
    }
});

test("bo'sh bob va bo'sh/buzuq mavzu sarlavhasi yo'q", async () => {
  for (const s of curriculumIndex().subjects)
    for (const g of s.grades) {
      const entry = (await curriculumTopics(s.id, g))!;
      // Manba HAR yozuvda: foydalanuvchi asl hujjatga qaytishi mumkin bo'lsin.
      assert.ok(entry.source.title.length > 10, `${s.id}/${g}: manba sarlavhasi yo'q`);
      assert.match(entry.source.url, /^https:\/\//, `${s.id}/${g}: manba havolasi`);
      assert.ok(entry.units.length >= 1, `${s.id}/${g}: bob yo'q`);
      for (const u of entry.units) {
        assert.ok(u.title.trim().length >= 3, `${s.id}/${g}: bob sarlavhasi bo'sh`);
        assert.ok(u.topics.length >= 1, `${s.id}/${g}: «${u.title}» bobi BO'SH — parsing xatosi`);
        if (u.hours !== undefined) assert.ok(Number.isInteger(u.hours) && u.hours > 0, `${s.id}/${g}: «${u.title}» soati ${u.hours}`);
        for (const t of u.topics) {
          const len = t.title.trim().length;
          // R4 §4.5d: juda qisqa — parsing xatosi, juda uzun — bo'linmagan blok.
          assert.ok(len >= 3 && len <= 200, `${s.id}/${g}: mavzu uzunligi ${len} — «${t.title}»`);
        }
      }
    }
});

test("hasCurriculum faqat mavjud juftlikda; noma'lum fan/sinf → null", async () => {
  assert.equal(hasCurriculum("matematika", 11), true);
  assert.equal(hasCurriculum("matematika", 9), false, "bazada yo'q sinf `true` bermasin (X-2)");
  assert.equal(hasCurriculum("kimyo", 11), false, "bazada yo'q fan");
  assert.equal(hasCurriculum("", 11), false);
  assert.equal(hasCurriculum("matematika", Number.NaN), false);
  // `null` — «bazada yo'q»; bo'sh ro'yxat EMAS (route 404 ni shundan chiqaradi).
  assert.equal(await curriculumTopics("kimyo", 11), null);
  assert.equal(await curriculumTopics("matematika", 9), null);
  assert.equal(await curriculumFile("kimyo"), null);
  assert.ok(curriculumSubject("matematika"));
  assert.equal(curriculumSubject("yo'q-bunday"), null);
});

test("mavzu tanlovi: `pickTopics` noma'lum id ni tashlaydi, tartibni saqlaydi", async () => {
  const entry = (await curriculumTopics("matematika", 11))!;
  const all = flatTopics(entry);
  assert.ok(all.length >= 5, `mavzular soni: ${all.length}`);
  const picked = pickTopics(entry, [all[2].id, "yo'q-bunday-id", all[0].id]);
  assert.deepEqual(picked.map((t) => t.id), [all[0].id, all[2].id], "tartib bazanikidan olinadi, so'rovnikidan emas");
  assert.deepEqual(pickTopics(entry, []), []);
  assert.deepEqual(pickTopics(entry, ["", "  "]), []);
});

test("route shakli: 401 (login), 60/daqiqa chegara, 400/404 shoxlari", () => {
  /*
   * Route `requireUser` → `ensureMigrated()` → baza demakdir, shuning
   * uchun bu yerda mantiq emas, SHARTNOMA tekshiriladi (`logo.test.mts`
   * naqshi: 200/404 mazmuni `curriculumTopics` da, u yuqorida sinaldi).
   */
  const src = readFileSync(new URL("../app/api/curriculum/route.ts", import.meta.url), "utf8");
  assert.match(src, /export const GET = handler\("curriculum",/);
  // Loginsiz — 401 (`requireUser`); anonim skraping uchun ochiq emas.
  assert.match(src, /await requireUser\(req\)/);
  // Chegara 60/daqiqa, foydalanuvchi bo'yicha.
  assert.match(src, /limit\(`curriculum:\$\{user\.id\}`, LIMIT_PER_MIN, 60\)/);
  assert.match(src, /const LIMIT_PER_MIN = 60;/);
  // Bazada yo'q fan/sinf — 404, bo'sh ro'yxat emas.
  assert.match(src, /hasCurriculum\(subject, grade\)\) throw new ApiError\([^)]*404\)/);
  // Buzuq parametr — 400.
  assert.match(src, /ApiError\("Fan ko'rsatilmagan", 400\)/);
  assert.match(src, /grade < 1 \|\| grade > 11/);
  // 200 javobining SHAKLI (forma shunga tayanadi).
  assert.match(src, /json\(\{ subject, grade: entry\.grade, source: entry\.source, units: entry\.units \}\)/);
});
