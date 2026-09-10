import test from "node:test";
import assert from "node:assert/strict";
import type { FormValues } from "../lib/types.ts";
import {
  AI_BULLETS_PER_JOB,
  AI_SKILLS_MAX,
  guardResume,
  inputFacts,
  inputYears,
  orgCandidates,
  orgIsKnown,
  stripUnknownYears,
  type ResumeLlmOut,
} from "../lib/generation/resume/guard.ts";
import { resumeInputFromValues, type ResumeInput } from "../lib/generation/resume/input.ts";

/**
 * REZYUME FAKT QO'RIQCHISI (Rezyume 2, AUDIT-15).
 *
 * Rezyume hujjat emas, DA'VO. Har qoida ALOHIDA sinaladi, chunki har
 * biri mustaqil ravishda noto'g'ri bo'lishi mumkin: bittasi juda
 * yumshoq bo'lsa uydirma o'tadi, juda qattiq bo'lsa haqiqiy tajriba
 * yo'q qilinadi.
 */

const VALUES: FormValues = {
  fullName: "Karimova Dilnoza",
  targetRole: "Moliya tahlilchisi",
  experience: JSON.stringify([
    { id: "e1", company: "Artel Electronics", role: "Moliya tahlilchisi", start: "2019-08", end: "now", bullets: ["2020-yilda byudjet modelini tuzdi."] },
    { id: "e2", company: "Korzinka", role: "Tahlilchi", start: "2017-01", end: "2019-07", bullets: ["Rentabellik tahlilini yuritdi."] },
  ]),
  education: JSON.stringify([{ id: "d1", institution: "TDIU", degree: "Bakalavr, Moliya", start: "2015", end: "2019" }]),
  skills: "Excel,SQL",
};

const input: ResumeInput = resumeInputFromValues(VALUES);

function out(over: Partial<ResumeLlmOut> = {}): ResumeLlmOut {
  return {
    summary: "Byudjetlashtirish bo‘yicha tajribali mutaxassis.",
    headline: "Moliya tahlilchisi",
    experience: [
      { id: "e1", role: "Yetakchi moliya tahlilchisi", bullets: [{ text: "Byudjet modelini tuzdi." }] },
      { id: "e2", role: "Moliya tahlilchisi", bullets: [{ text: "Rentabellik tahlilini yuritdi." }] },
    ],
    education: [{ id: "d1", degree: "Bakalavr, Moliya va kredit" }],
    skills: [{ text: "Excel" }, { text: "SQL" }],
    ...over,
  };
}

const run = (o: ResumeLlmOut, over: { enrich?: boolean; language?: string } = {}) =>
  guardResume(input, o, { enrich: true, language: "uz", ...over });

// ───────────────────────────────────────────── 1: id lar

test("1: noma'lum id tashlanadi, yo'qolgan id kirish bandlari bilan tiklanadi", () => {
  const r = run(
    out({
      experience: [
        { id: "e1", role: "Yetakchi tahlilchi", bullets: [{ text: "Byudjet modelini tuzdi." }] },
        // Kirishda YO'Q ish joyi — model uni o'zi qo'shgan.
        { id: "e7", role: "Bosh direktor", bullets: [{ text: "Kompaniyani boshqardi." }] },
      ],
    }),
  );
  assert.deepEqual(r.out.experience.map((e) => e.id), ["e1", "e2"], "faqat kirish id lari, kirish tartibida");
  assert.equal(r.report.unknownRows, 1);
  assert.equal(r.report.restoredRows, 1, "e2 tushib qolgan — tiklanadi");
  // Tiklangan qator KIRISHDAGI matnni oladi.
  assert.equal(r.out.experience[1].role, "Tahlilchi");
  assert.equal(r.out.experience[1].bullets[0].text, "Rentabellik tahlilini yuritdi.");
  // Ta'limda ham xuddi shunday.
  const e = run(out({ education: [{ id: "d5", degree: "Doktorlik" }] }));
  assert.deepEqual(e.out.education.map((x) => x.id), ["d1"]);
  assert.equal(e.out.education[0].degree, "Bakalavr, Moliya", "kirishdagi daraja tiklandi");
});

// ───────────────────────────────────────────── 2: yillar

test("2: kirishda yo'q YIL har matndan olib tashlanadi, kirishdagi yil qoladi", () => {
  const years = inputYears(input);
  assert.ok(years.has("2019") && years.has("2020") && years.has("2015"), "sana ham, band ichidagi raqam ham");
  assert.ok(!years.has("2013"));

  assert.equal(stripUnknownYears("2019 — tahlilchi", years), "2019 — tahlilchi");
  assert.equal(stripUnknownYears("2013 — laborant", years), "— laborant".replace(/^—\s*/, ""), "uydirma yil o'chadi, matn qoladi");
  // Yarim oraliq ma'nosiz — butun oraliq o'chadi.
  assert.ok(!/\d{4}/.test(stripUnknownYears("2013–2019 — bakalavr", years)));
  // Kirishda umuman yil bo'lmasa filtr o'chadi — xom matn yo'q qilinmaydi.
  const bare = resumeInputFromValues({ fullName: "A", experience: JSON.stringify([{ id: "e1", role: "R" }]) });
  assert.equal(stripUnknownYears("2013–2019 — bakalavr", inputYears(bare)), "2013–2019 — bakalavr");

  const r = run(out({ experience: [{ id: "e1", role: "2013-yildan tahlilchi", bullets: [{ text: "2013-yilda tizim joriy qildi." }] }] }));
  assert.ok(!/2013/.test(JSON.stringify(r.out.experience)), "uydirma yil chiqishda qolmasligi kerak");
  assert.ok(r.report.strippedYears > 0);
});

// ───────────────────────────────────────────── 3: boyitish OFF

test("3: boyitish OFF — barcha ai band va ko'nikma o'chadi", () => {
  const o = out({
    experience: [
      {
        id: "e1",
        role: "Tahlilchi",
        bullets: [{ text: "Byudjet modelini tuzdi." }, { text: "Boshqaruv hisobotini tayyorlaydi.", ai: true }],
      },
      { id: "e2", role: "Tahlilchi", bullets: [{ text: "Rentabellik tahlilini yuritdi." }] },
    ],
    skills: [{ text: "Excel" }, { text: "Power BI", ai: true }],
  });
  const off = run(o, { enrich: false });
  assert.ok(!JSON.stringify(off.out).includes('"ai":true'), "OFF da bironta ai band qolmaydi");
  assert.equal(off.out.experience[0].bullets.length, 1);
  assert.deepEqual(off.out.skills.map((s) => s.text), ["Excel"]);
  assert.equal(off.report.droppedBullets, 1);
  assert.equal(off.report.droppedSkills, 1);

  // ON da AYNAN o'shalar saqlanadi — farq faqat bayroqdan.
  const on = run(o, { enrich: true });
  assert.equal(on.out.experience[0].bullets.length, 2);
  assert.equal(on.out.experience[0].bullets[1].ai, true);
  assert.deepEqual(on.out.skills.map((s) => s.text), ["Excel", "Power BI"]);
});

// ───────────────────────────────────────────── 4: boyitish ON chegaralari

test("4: ON — ish joyiga ≤2 ai band, jami ≤6 ai ko'nikma, raqamli ai band o'chadi", () => {
  const aiBullets = Array.from({ length: 5 }, (_, i) => ({ text: `Tipik vazifa raqamsiz variant ${"a".repeat(i)}.`, ai: true as const }));
  const r = run(
    out({
      experience: [
        { id: "e1", role: "Tahlilchi", bullets: [{ text: "Byudjet modelini tuzdi." }, ...aiBullets] },
        { id: "e2", role: "Tahlilchi", bullets: aiBullets },
      ],
      skills: [{ text: "Excel" }, ...Array.from({ length: 10 }, (_, i) => ({ text: `Ko‘nikma ${String.fromCharCode(97 + i)}`, ai: true as const }))],
    }),
  );
  for (const e of r.out.experience) {
    assert.equal(e.bullets.filter((b) => b.ai).length, AI_BULLETS_PER_JOB, `${e.id}: ai band chegarasi`);
  }
  assert.equal(r.out.skills.filter((s) => s.ai).length, AI_SKILLS_MAX);
  assert.equal(r.out.skills.filter((s) => !s.ai).length, 1, "foydalanuvchi ko'nikmasi chegaraga kirmaydi");

  // Raqamli ai band — tekshirib bo'lmaydigan da'vo, o'chadi.
  const num = run(
    out({
      experience: [{ id: "e1", role: "Tahlilchi", bullets: [{ text: "Xarajatni 12 % ga qisqartirdi.", ai: true }, { text: "Hisobot tayyorlaydi.", ai: true }] }],
    }),
  );
  assert.deepEqual(num.out.experience[0].bullets.filter((b) => b.ai).map((b) => b.text), ["Hisobot tayyorlaydi."]);
  // Foydalanuvchi yozgan raqamli band esa SAQLANADI.
  const human = run(out({ experience: [{ id: "e1", role: "Tahlilchi", bullets: [{ text: "2020-yilda 14 ta bo‘lim uchun model tuzdi." }] }] }));
  assert.match(human.out.experience[0].bullets[0].text, /14 ta bo‘lim/);
});

test("4: takroriy band bir marta qoladi", () => {
  const r = run(
    out({ experience: [{ id: "e1", role: "Tahlilchi", bullets: [{ text: "Byudjet modelini tuzdi." }, { text: "byudjet  modelini tuzdi!" }] }] }),
  );
  assert.equal(r.out.experience[0].bullets.length, 1);
});

// ───────────────────────────────────────────── 5: tashkilot tekshiruvi

test("5: tashkilot tekshiruvi NFKC + kichik harf; qayta ifodalash saqlanadi", () => {
  const facts = "artel electronics · korzinka · tdiu";
  assert.ok(orgIsKnown("Artel Electronics", facts));
  assert.ok(orgIsKnown("ＡＲＴＥＬ Electronics".normalize("NFKC"), facts), "kenglik shakli ham mos kelishi kerak");
  assert.ok(orgIsKnown("Artel Electronics MChJ", facts), "qayta ifodalash — kamida bitta bo'lak yetadi");
  assert.ok(!orgIsKnown("Respublika ta’lim markazi", facts));
  // Fakt umuman bo'lmasa filtr o'chadi.
  assert.ok(orgIsKnown("Istalgan tashkilot", ""));

  // Nomzod ajratish: 2+ bosh harfli so'z yoki 3+ belgili qisqartma.
  assert.deepEqual(orgCandidates("Ishladi Artel Electronics kompaniyasida"), ["Artel Electronics"]);
  assert.deepEqual(orgCandidates("ACCA sertifikatiga ega"), ["ACCA"]);
  // Nemis oti — YOLG'IZ bosh harfli so'z nomzod EMAS (aks holda nemischa qisqacha buziladi).
  assert.deepEqual(orgCandidates("Spezialist mit Erfahrung in der Finanzanalyse"), []);
});

/**
 * JONLI SINOV REGRESSIYASI (uz kirish → `language: en`).
 *
 * Tashkilot tekshiruvi ilgari `role`/`degree` ga ham qo'llanardi va
 * modelning TARJIMASINI («Yetakchi moliya tahlilchisi» → «Lead
 * Financial Analyst») uydirma deb topib, o'zbekcha qiymatga qaytarardi:
 * inglizcha rezyumeda sarlavhalar inglizcha, lavozimlar o'zbekcha
 * chiqardi. Endi tekshiruv faqat band matni va qisqacha uchun.
 */
test("5: lavozim va daraja TARJIMASI saqlanadi — ular ish beruvchi emas", () => {
  const r = run(
    out({
      experience: [
        { id: "e1", role: "Lead Financial Analyst", bullets: [{ text: "Built the annual budget model." }] },
        { id: "e2", role: "Financial Analyst", bullets: [{ text: "Prepared weekly profitability reports." }] },
      ],
      education: [{ id: "d1", degree: "Master of Business Administration" }],
    }),
    { language: "en" },
  );
  assert.equal(r.out.experience[0].role, "Lead Financial Analyst", "lavozim tarjimasi qaytarilmasligi kerak");
  assert.equal(r.out.experience[1].role, "Financial Analyst");
  assert.equal(r.out.education[0].degree, "Master of Business Administration", "daraja tarjimasi qaytarilmasligi kerak");
  // «Business Administration» kirish faktlarida YO'Q — eski qoida uni «uydirma tashkilot» deb qaytarardi.
  assert.deepEqual(orgCandidates("Master of Business Administration"), ["Business Administration"]);
  assert.ok(!orgIsKnown("Business Administration", inputFacts(input)));
  assert.equal(r.report.revertedFields, 0);
  // Ish beruvchi/muassasa nomi model javobiga UMUMAN kirmaydi — xavf yo'q.
  assert.ok(!("company" in r.out.experience[0]));
  assert.ok(!("institution" in r.out.education[0]));
});

test("5: band matnida uydirma tashkilot bo'lsa band tushadi (ai band)", () => {
  const r = run(
    out({
      experience: [
        {
          id: "e1",
          role: "Tahlilchi",
          bullets: [{ text: "Byudjet modelini tuzdi." }, { text: "Respublika Taʼlim Markazi bilan ishladi.", ai: true }],
        },
      ],
    }),
  );
  assert.equal(r.out.experience[0].bullets.length, 1, "uydirma tashkilotli ai band tushadi");
  assert.equal(r.report.droppedBullets, 1);
});

test("B-7: CJK/arab chiqishda tashkilot tekshiruvi o'tkazib yuboriladi, yil tekshiruvi qoladi", () => {
  const zhOut = out({
    summary: "金融分析师，拥有 Artel Electronics 的工作经验。",
    experience: [{ id: "e1", role: "高级财务分析师", bullets: [{ text: "编制年度预算模型。" }] }],
  });
  const zh = run(zhOut, { language: "zh" });
  assert.equal(zh.report.orgCheckSkipped, true);
  assert.equal(zh.out.experience[0].role, "高级财务分析师", "xitoycha lavozim uydirma deb tashlanmaydi");
  assert.ok(zh.out.summary.length > 0, "xitoycha qisqacha butunlay yo'q qilinmaydi");
  for (const code of ["ja", "ko", "ar"]) assert.equal(run(zhOut, { language: code }).report.orgCheckSkipped, true);
  assert.equal(run(zhOut, { language: "de" }).report.orgCheckSkipped, false);
  // Yil qoidasi tildan qat'i nazar ishlaydi.
  const badYear = run(out({ summary: "2013 年入职。" }), { language: "zh" });
  assert.equal(badYear.out.summary, "", "uydirma yilli jumla CJK da ham tashlanadi");
});

// ───────────────────────────────────────────── 6: qisqacha

test("6: qisqachadan uydirma yil yoki uydirma tashkilot bo'lgan JUMLA tashlanadi", () => {
  const r = run(
    out({
      summary:
        "Byudjetlashtirish bo‘yicha tajribali mutaxassis. 2013-yildan boshlab moliya sohasida. Artel Electronics kompaniyasida byudjet modelini tuzgan. Respublika Taʼlim Markazida metodist bo‘lgan.",
    }),
  );
  assert.match(r.out.summary, /Byudjetlashtirish bo‘yicha tajribali mutaxassis\./);
  assert.match(r.out.summary, /Artel Electronics/, "kirishdagi kompaniya qoladi");
  assert.doesNotMatch(r.out.summary, /2013/, "uydirma yilli jumla tashlanadi");
  assert.doesNotMatch(r.out.summary, /Taʼlim Markazida/, "uydirma tashkilotli jumla tashlanadi");
  assert.equal(r.report.droppedSentences, 2);
});

test("6: barcha jumla tashlansa qisqacha bo'sh qaytadi (chaqiruvchi zaxiraga o'tadi)", () => {
  const r = run(out({ summary: "2013-yilda ishga kirdi." }));
  assert.equal(r.out.summary, "");
  assert.equal(r.report.droppedSentences, 1);
});

// ───────────────────────────────────────────── umumiy

test("qo'riqchi hech qachon kirishdagi kompaniya/sanani o'zgartirmaydi", () => {
  const r = run(out());
  // Chiqishda kompaniya/sana UMUMAN yo'q — ular `mergeLlm` da kirishdan olinadi.
  assert.deepEqual(Object.keys(r.out.experience[0]).sort(), ["bullets", "id", "role"]);
  assert.deepEqual(Object.keys(r.out.education[0]).sort(), ["degree", "id"]);
});
