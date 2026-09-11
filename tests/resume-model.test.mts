import test from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import {
  DEFAULT_ORDER,
  RESUME_DEGREES,
  RESUME_EDUCATION_KINDS,
  RESUME_LIMITS,
  RESUME_SECTION_IDS,
  degreeLabel,
  docFromResume,
  educationTitle,
  emptyResume,
  formatPeriod,
  hasCodeLabels,
  isResumeEducationKind,
  legacyResumeModel,
  linkKindOf,
  newRowId,
  normalizeDate,
  normalizeResume,
  normalizeYear,
  resumeLabels,
  resumeSections,
  sanitizeLabels,
  sortDesc,
  type ResumeModel,
} from "../lib/generation/resume/model.ts";
import { RESUME_TEMPLATES } from "../lib/generation/resume/templates.ts";
import { planResume } from "../lib/generation/resume/layout.ts";
import { SAMPLE_RESUME } from "../lib/generation/resume/samples.ts";

/**
 * REZYUME MODELI — `AcademicDoc.resume` ning shartnomasi.
 *
 * Model ikki tomondan kirish oladi: LLM javobi va bazadagi eski
 * `doc_json`. Ikkalasi ham buzuq bo'lishi mumkin, shuning uchun
 * `normalizeResume` klamplari va `legacyResumeModel` adapteri alohida
 * qulflanadi.
 */

// ───────────────────────────────────────────── normalizeResume

test("normalizeResume: chegaralar qo'llanadi, buzuq qator tashlanadi", () => {
  const m = normalizeResume({
    language: "RU",
    template: "yo‘q",
    palette: "neon",
    identity: { fullName: "x".repeat(400), headline: "y".repeat(400) },
    contact: { phone: "+998901234567", email: "z".repeat(400), location: "Toshkent" },
    summary: "s".repeat(5000),
    experience: [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `e${i + 1}`, company: `K${i}`, role: "R", start: "2020", end: "2021", bullets: [] })),
      { company: "", role: "", bullets: [] },
    ],
    education: Array.from({ length: 30 }, () => ({ institution: "TDIU", degree: "B" })),
    certificates: Array.from({ length: 30 }, () => ({ name: "ACCA" })),
    languages: Array.from({ length: 30 }, () => ({ language: "Ingliz" })),
    skills: Array.from({ length: 100 }, (_, i) => `k${i}`),
    links: Array.from({ length: 30 }, (_, i) => ({ url: `https://a${i}.uz` })),
    order: ["skills", "skills", "xato", "summary"],
  })!;
  assert.ok(m);
  assert.equal(m.language, "ru");
  assert.equal(m.template, "modern", "noma'lum shablon — modern");
  assert.equal(m.palette, RESUME_TEMPLATES.modern.defaultPalette, "noma'lum palitra — shablon standarti");
  assert.equal(m.identity.fullName.length, RESUME_LIMITS.nameChars);
  assert.equal(m.identity.headline.length, RESUME_LIMITS.headlineChars);
  assert.equal(m.contact.email.length, RESUME_LIMITS.fieldChars);
  assert.equal(m.summary.length, RESUME_LIMITS.summaryChars);
  assert.equal(m.experience.length, RESUME_LIMITS.experience, "bo'sh qator ham tashlanadi, ham chegara ishlaydi");
  assert.equal(m.education.length, RESUME_LIMITS.education);
  assert.equal(m.certificates.length, RESUME_LIMITS.certificates);
  assert.equal(m.languages.length, RESUME_LIMITS.languages);
  assert.equal(m.skills.length, RESUME_LIMITS.skills);
  assert.equal(m.links.length, RESUME_LIMITS.links);
  // Tartib: takror olib tashlanadi, noma'lum id tushadi, qolgani standartdan to'ldiriladi.
  assert.deepEqual(m.order.slice(0, 2), ["skills", "summary"]);
  assert.deepEqual([...m.order].sort(), [...RESUME_SECTION_IDS].sort());
});

test("normalizeResume: bo'sh kirish va id lar", () => {
  assert.equal(normalizeResume(null), null);
  assert.equal(normalizeResume({}), null);
  assert.equal(normalizeResume({ language: "uz" }), null, "faqat til — hujjat emas");
  assert.ok(normalizeResume({ identity: { fullName: "A" } }));
  // Id berilmasa avtomatik: e1.., d1.., c1.., l1.., k1..
  const m = normalizeResume({
    identity: { fullName: "A" },
    experience: [{ role: "R" }, { role: "R2" }],
    education: [{ degree: "B" }],
    certificates: [{ name: "C" }],
    languages: [{ language: "Ingliz" }],
    links: [{ url: "https://a.uz" }],
  })!;
  assert.deepEqual(m.experience.map((e) => e.id), ["e1", "e2"]);
  assert.equal(m.education[0].id, "d1");
  assert.equal(m.certificates[0].id, "c1");
  assert.equal(m.languages[0].id, "l1");
  assert.equal(m.links[0].id, "k1");
  assert.equal(newRowId("e", 4), "e5");
});

test("normalizeResume: surat va ko'nikma takrori", () => {
  const m = normalizeResume({
    identity: { fullName: "A" },
    skills: [{ text: "Excel" }, { text: "excel" }, { text: "SQL", ai: true }],
    photo: { url: "data:image/png;base64,AA", shape: "square", assetId: "a1", crop: { x: 1, y: 2, zoom: 1.5 } },
  })!;
  assert.deepEqual(m.skills, [{ text: "Excel" }, { text: "SQL", ai: true }]);
  assert.equal(m.photo?.shape, "square");
  assert.deepEqual(m.photo?.crop, { x: 1, y: 2, zoom: 1.5 });
  // Kesim yo'q bo'lsa maydon umuman qo'yilmaydi.
  assert.equal(normalizeResume({ identity: { fullName: "A" }, photo: { url: "u" } })!.photo?.crop, undefined);
});

test("normalizeDate: faqat YYYY / YYYY-MM / now qabul qilinadi", () => {
  assert.equal(normalizeDate("2021-03"), "2021-03");
  assert.equal(normalizeDate("2021-3"), "2021-03", "bir xonali oy to'ldiriladi");
  assert.equal(normalizeDate("2021"), "2021");
  assert.equal(normalizeDate("now"), "now");
  assert.equal(normalizeDate("hozir"), "now");
  assert.equal(normalizeDate("present"), "now");
  assert.equal(normalizeDate("2021-13"), "2021", "yaroqsiz oy tushadi, yil qoladi");
  assert.equal(normalizeDate("1900"), "", "diapazondan tashqari");
  assert.equal(normalizeDate("2200"), "");
  assert.equal(normalizeDate("mart 2021"), "");
  assert.equal(normalizeDate(null), "");
});

// ───────────────────────────────────────────── AUDIT-16: ta'lim

test("normalizeYear: OY TASHLANADI — ta'limda faqat yil so'raladi", () => {
  /*
   * Mahsulot qarori: barcha o'qishlar sentabrdan boshlanadi, shuning
   * uchun ta'lim va sertifikat sanasida oy so'ralmaydi. Eski
   * qoralamalarda va eski hujjatlarda «2019-09» turgan bo'lishi mumkin —
   * u YILGA tushadi, tashlanmaydi.
   */
  assert.equal(normalizeYear("2019-09"), "2019", "oy tashlanadi");
  assert.equal(normalizeYear("2019-9"), "2019");
  assert.equal(normalizeYear("2019"), "2019");
  assert.equal(normalizeYear("now"), "now");
  assert.equal(normalizeYear("hozir"), "now");
  assert.equal(normalizeYear("present"), "now");
  assert.equal(normalizeYear("1900"), "", "diapazondan tashqari");
  assert.equal(normalizeYear("2200"), "");
  assert.equal(normalizeYear("2021-yil"), "", "erkin matn qabul qilinmaydi");
  assert.equal(normalizeYear(null), "");
  // Sertifikatda «hozir» ma'nosiz — u aniq yilda beriladi.
  assert.equal(normalizeYear("now", false), "");
  assert.equal(normalizeYear("2021", false), "2021");
  // `normalizeDate` TEGILMAGAN: tajribada oy ma'noli.
  assert.equal(normalizeDate("2019-09"), "2019-09", "tajriba sanasi oyni saqlaydi");
});

test("ta'lim: `kind` standarti, eski qator migratsiyasi va yil klampi", () => {
  const m = normalizeResume({
    identity: { fullName: "A" },
    education: [
      // ESKI qator: `kind` ham, `field` ham yo'q, sana oy bilan.
      { id: "d1", institution: "TDIU", degree: "Bakalavr, Moliya va kredit", start: "2015-09", end: "2019-06" },
      // YANGI qator.
      { id: "d2", kind: "school", institution: "15-maktab", field: "", degree: "", start: "2004", end: "2015" },
      // Noma'lum tur — «university» ga tushadi.
      { id: "d3", kind: "akademiya", institution: "X", field: "Y", degree: "magistr", start: "2019", end: "now" },
    ],
  })!;
  assert.equal(m.education[0].kind, "university", "eski qatorda tur yo'q — oliy ta'lim");
  assert.equal(m.education[0].field, "", "eski `degree` matni yo'nalishga AJRATILMAYDI");
  assert.equal(m.education[0].degree, "Bakalavr, Moliya va kredit", "eski erkin matn yo'qolmaydi");
  assert.deepEqual([m.education[0].start, m.education[0].end], ["2015", "2019"], "oy tashlanadi");
  const school = m.education.find((e) => e.id === "d2")!;
  assert.equal(school.kind, "school");
  assert.equal(school.degree, "");
  assert.equal(m.education.find((e) => e.id === "d3")!.kind, "university", "noma'lum tur — oliy ta'lim");
  // Faqat yo'nalish yozilgan qator ham saqlanadi (ilgari `institution || degree` edi).
  const onlyField = normalizeResume({ identity: { fullName: "A" }, education: [{ kind: "course", field: "Python" }] })!;
  assert.equal(onlyField.education.length, 1);
  assert.equal(onlyField.education[0].field, "Python");
});

test("degreeLabel: TILGA ergashadi, tur bilan ma'nosi o'zgaradi, noma'lum ID o'zi qaytadi", () => {
  assert.equal(degreeLabel("university", "magistr", "uz"), "Magistr");
  assert.equal(degreeLabel("university", "magistr", "ru"), "Магистр");
  assert.equal(degreeLabel("university", "magistr", "en"), "Master’s degree");
  // Qolgan 15 til — inglizcha yorliq (daraja fakt, uni model tarjima qilmaydi).
  assert.equal(degreeLabel("university", "magistr", "de"), "Master’s degree");
  assert.equal(degreeLabel("university", "magistr", "ja"), "Master’s degree");
  // Bitta ID, ikki xil tur — ikki xil ma'no.
  assert.equal(degreeLabel("university", "tugallanmagan", "uz"), "Tugallanmagan oliy");
  assert.equal(degreeLabel("college", "tugallanmagan", "uz"), "Tugallanmagan o‘rta maxsus");
  assert.notEqual(degreeLabel("university", "tugallanmagan", "ru"), degreeLabel("college", "tugallanmagan", "ru"));
  // Maktab va kursda daraja YO'Q.
  assert.deepEqual(RESUME_DEGREES.school, []);
  assert.deepEqual(RESUME_DEGREES.course, []);
  assert.equal(degreeLabel("school", "bakalavr", "uz"), "bakalavr", "turga tegishli bo'lmagan ID — matn sifatida");
  // B-8: eski erkin matn o'zgarishsiz qaytadi.
  assert.equal(degreeLabel("university", "Bakalavr, Moliya va kredit", "en"), "Bakalavr, Moliya va kredit");
  assert.equal(degreeLabel("university", "", "uz"), "");
  // Katalog va tanlov ro'yxati bir xil to'plam.
  for (const kind of RESUME_EDUCATION_KINDS) {
    for (const id of RESUME_DEGREES[kind]) {
      assert.notEqual(degreeLabel(kind, id, "uz"), id, `${kind}/${id}: yorliq yo'q`);
      assert.notEqual(degreeLabel(kind, id, "ru"), id, `${kind}/${id}: ruscha yorliq yo'q`);
    }
  }
  assert.ok(isResumeEducationKind("college"));
  assert.ok(!isResumeEducationKind("akademiya"));
});

test("educationTitle: «daraja, yo'nalish» — maktabda bo'sh", () => {
  const row = { id: "d1", kind: "university" as const, institution: "TDIU", field: "Moliya", degree: "bakalavr", start: "2015", end: "2019" };
  assert.equal(educationTitle(row, "uz"), "Bakalavr, Moliya");
  assert.equal(educationTitle(row, "en"), "Bachelor’s degree, Moliya", "daraja tilga ergashadi, yo'nalish kirishdan");
  assert.equal(educationTitle({ ...row, field: "" }, "uz"), "Bakalavr", "yo'nalish bo'lmasa faqat daraja");
  assert.equal(educationTitle({ ...row, kind: "course", degree: "", field: "Python asoslari" }, "uz"), "Python asoslari");
  assert.equal(educationTitle({ ...row, kind: "school", degree: "", field: "" }, "uz"), "", "maktabda sarlavha bo'sh");
});

test("maket: ta'lim qatori — «Daraja, yo'nalish» / muassasa; maktabda muassasa sarlavhaga ko'tariladi", () => {
  /*
   * `sectionItems` education bloki (`layout.ts`) — DOCX ham, ko'ruvchi
   * ham shu itemni chizadi. Maktab satrida sarlavha bo'sh qolsa ikkalasi
   * ham qalin satrni tashlab, maktab nomini mayda kulrang matnga tushirib
   * yuborardi; tahrir yo'li esa `degree` ga qarab qolardi.
   */
  const m: ResumeModel = {
    ...emptyResume("en"),
    identity: { fullName: "A", headline: "B" },
    education: [
      { id: "d1", kind: "university", institution: "TDIU", field: "Finance", degree: "bakalavr", start: "2015", end: "2019" },
      { id: "d2", kind: "school", institution: "School No. 15", field: "", degree: "", start: "2004", end: "2015" },
      { id: "d3", kind: "course", institution: "IT Park", field: "Python", degree: "", start: "2023", end: "now" },
    ],
  };
  const rows = planResume(m)
    .zones.flatMap((z) => z.items)
    .filter((it): it is Extract<typeof it, { k: "row" }> => it.k === "row" && it.section === "education");
  assert.equal(rows.length, 3);
  // Maket model tartibini saqlaydi (tartiblash `draftModel` da, `sortDesc`).
  assert.deepEqual(rows.map((r) => r.title), ["Bachelor’s degree, Finance", "School No. 15", "Python"]);
  assert.deepEqual(rows.map((r) => r.sub), ["TDIU", "", "IT Park"]);
  assert.equal(rows[0].titlePath, "education.0.degree");
  assert.equal(rows[0].subPath, "education.0.institution");
  assert.equal(rows[1].titlePath, "education.1.institution", "maktabda sarlavha — muassasa, tahrir yo'li ham shunga");
  assert.equal(rows[1].period, "2004 – 2015", "faqat yil");
  assert.equal(rows[2].period, "2023 – present");
  // Sintez bo'lim ham shu sarlavhani ishlatadi (bosh sahifa kartasi / eski ko'ruvchi).
  const edu = resumeSections(m).find((s) => s.id === "edu")!;
  assert.match(edu.blocks[0].text, /Bachelor’s degree, Finance — TDIU/);
  assert.match(edu.blocks[1].text, /2004 – 2015 — School No\. 15/);
});

test("sertifikat yili ham tanlagichdan: erkin matn tozalanadi", () => {
  const m = normalizeResume({
    identity: { fullName: "A" },
    certificates: [
      { id: "c1", name: "ACCA F3", issuer: "ACCA", year: "2021-08" },
      { id: "c2", name: "IELTS", issuer: "British Council", year: "2021-yil avgust" },
      { id: "c3", name: "PMP", issuer: "PMI", year: "now" },
    ],
  })!;
  assert.equal(m.certificates[0].year, "2021", "oy tashlanadi");
  assert.equal(m.certificates[1].year, "", "erkin matn tushadi");
  assert.equal(m.certificates[2].year, "", "sertifikat «hozir» olinmaydi");
});

// ───────────────────────────────────────────── sortDesc

test("sortDesc: hozirgi → end desc → start desc, barqaror", () => {
  const rows = [
    { id: "a", start: "2015", end: "2017" },
    { id: "b", start: "2019-08", end: "now" },
    { id: "c", start: "2017-01", end: "2019-07" },
    { id: "d", start: "2017-06", end: "2019-07" },
    { id: "e", start: "", end: "" },
  ];
  assert.deepEqual(sortDesc(rows).map((r) => r.id), ["b", "d", "c", "a", "e"]);
  // Barqarorlik: bir xil kalitli qatorlar kirish tartibini saqlaydi.
  const same = [{ id: "1", start: "2020", end: "2021" }, { id: "2", start: "2020", end: "2021" }];
  assert.deepEqual(sortDesc(same).map((r) => r.id), ["1", "2"]);
  // Chaqiruv kirish massivini o'zgartirmaydi.
  const src = [...rows];
  sortDesc(src);
  assert.deepEqual(src.map((r) => r.id), rows.map((r) => r.id));
});

// ───────────────────────────────────────────── yorliqlar va sana

test("formatPeriod: uz/ru/en oy nomi, boshqa tilda raqamli, «hozir» yorlig'i", () => {
  const uz = resumeLabels("uz");
  assert.equal(formatPeriod("2021-03", "now", uz, "uz"), "mar 2021 – hozir");
  const ru = resumeLabels("ru");
  assert.equal(formatPeriod("2021-03", "2022-01", ru, "ru"), "мар 2021 – янв 2022");
  const en = resumeLabels("en");
  assert.equal(formatPeriod("2021-03", "now", en, "en"), "Mar 2021 – present");
  // Boshqa til — oy nomi yo'q, raqamli shakl; yorliq esa modeldan/inglizchadan.
  const de = resumeLabels("de");
  assert.equal(formatPeriod("2021-03", "2022-01", de, "de"), "03.2021 – 01.2022");
  assert.equal(formatPeriod("2021-03", "now", { ...de, present: "heute" }, "de"), "03.2021 – heute");
  // Faqat biri bo'lsa o'zi; ikkalasi bo'sh — bo'sh satr.
  assert.equal(formatPeriod("2015", "", uz, "uz"), "2015");
  assert.equal(formatPeriod("", "2019", uz, "uz"), "2019");
  assert.equal(formatPeriod("", "", uz, "uz"), "");
});

test("yorliqlar: uz/ru/en koddan, boshqa til modeldan (yetishmagani inglizcha)", () => {
  assert.equal(hasCodeLabels("uz"), true);
  assert.equal(hasCodeLabels("RU"), true);
  assert.equal(hasCodeLabels("de"), false);
  assert.equal(hasCodeLabels("zh"), false);
  assert.equal(resumeLabels("de").summary, resumeLabels("en").summary, "kod yorlig'i yo'q — inglizcha");

  const de = sanitizeLabels({ summary: "Profil", experience: "Berufserfahrung", skills: "x".repeat(80), links: 5 }, "de");
  assert.equal(de.summary, "Profil");
  assert.equal(de.experience, "Berufserfahrung");
  assert.equal(de.skills, resumeLabels("en").skills, "40 belgidan uzun — rad etiladi");
  assert.equal(de.links, resumeLabels("en").links, "satr emas — rad etiladi");
  assert.equal(de.present, resumeLabels("en").present, "berilmagan kalit inglizcha qoladi");
  assert.deepEqual(sanitizeLabels(null, "uz"), resumeLabels("uz"));
});

test("linkKindOf: URL dan turi aniqlanadi, ishora ustun", () => {
  assert.equal(linkKindOf("https://www.linkedin.com/in/a"), "linkedin");
  assert.equal(linkKindOf("https://github.com/a"), "github");
  assert.equal(linkKindOf("https://dilnoza.uz"), "portfolio");
  assert.equal(linkKindOf(""), "other");
  assert.equal(linkKindOf("https://dilnoza.uz", "github"), "github");
  assert.equal(linkKindOf("https://dilnoza.uz", "yo‘q"), "portfolio", "noma'lum ishora e'tiborsiz");
});

// ───────────────────────────────────────────── resumeSections / docFromResume

test("resumeSections: `order` hurmat qilinadi, bo'sh bo'lim chiqmaydi", () => {
  const m: ResumeModel = { ...SAMPLE_RESUME, order: ["summary", "skills", "experience", "education", "certificates", "languages", "links"] };
  const ids = resumeSections(m).map((s) => s.id);
  assert.deepEqual(ids, ["summary", "skills", "exp", "edu", "certificates", "languages", "links"]);
  // Bo'sh bo'lim tushadi (summary doim qoladi — kontakt satri u yerda).
  const bare: ResumeModel = { ...emptyResume("uz"), identity: { fullName: "A", headline: "B" }, summary: "S" };
  assert.deepEqual(resumeSections(bare).map((s) => s.id), ["summary"]);
  // Kontakt satri — ikkinchi blok (eski `doc_json` shakli bilan mos).
  const sec = resumeSections(SAMPLE_RESUME)[0];
  assert.equal(sec.blocks[0].text, SAMPLE_RESUME.summary);
  assert.match(sec.blocks[1].text, /Toshkent · dilnoza\.karimova@mail\.uz/);
});

test("docFromResume: meta topic/author model bilan sinxron, titul va mundarija yo'q", () => {
  const meta = { toolId: "resume", language: "uz", topic: "eski", author: "eski" } as unknown as AcademicDoc["meta"];
  const doc = docFromResume(SAMPLE_RESUME, meta);
  assert.equal(doc.titlePage, false);
  assert.equal(doc.toc, false);
  assert.equal(doc.meta.topic, "Moliya tahlilchisi");
  assert.equal(doc.meta.author, "Karimova Dilnoza");
  assert.equal(doc.meta.language, "uz");
  assert.equal(doc.resume, SAMPLE_RESUME, "model hujjatga qadaladi (yagona manba)");
  assert.ok(doc.sections.length > 1, "rollback uchun sintez bo'limlar ham bor");
});

// ───────────────────────────────────────────── B-8: eski hujjat

test("B-8: legacyResumeModel eski 4 bo'limli doc_json ni modelga o'giradi", () => {
  const doc = {
    meta: { language: "uz", author: "Aliyev Ali", topic: "Dasturchi", city: "Toshkent" },
    titlePage: false,
    toc: false,
    sections: [
      { id: "summary", title: "Qisqacha", blocks: [{ kind: "p", text: "Tajribali dasturchi." }, { kind: "p", text: "Toshkent · a@b.uz · +998901234567" }] },
      {
        id: "exp",
        title: "Ish tajribasi",
        blocks: [
          { kind: "h3", text: "2020–2024 — Dev — Epam" },
          { kind: "li", text: "Xizmatlarni yozdi." },
          { kind: "li", text: "Testlarni qo‘shdi." },
          { kind: "h3", text: "2018–2020 — Junior" },
          { kind: "li", text: "Interfeys yig‘di." },
        ],
      },
      { id: "edu", title: "Ta’lim", blocks: [{ kind: "p", text: "TATU, Axborot tizimlari, 2018" }] },
      { id: "skills", title: "Ko‘nikmalar", blocks: [{ kind: "p", text: "Node.js · SQL, React" }] },
    ],
  } as unknown as AcademicDoc;

  const m = legacyResumeModel(doc);
  assert.equal(m.identity.fullName, "Aliyev Ali");
  assert.equal(m.identity.headline, "Dasturchi");
  assert.equal(m.summary, "Tajribali dasturchi.");
  // Kontakt satri ajratiladi.
  assert.equal(m.contact.email, "a@b.uz");
  assert.equal(m.contact.phone, "+998901234567");
  assert.equal(m.contact.location, "Toshkent");
  // Ish joylari h3 bo'yicha guruhlanadi, bandlar o'z joyiga tushadi.
  assert.equal(m.experience.length, 2);
  assert.deepEqual(m.experience.map((e) => e.id), ["e1", "e2"]);
  assert.equal(m.experience[0].bullets.length, 2);
  assert.equal(m.experience[1].bullets.length, 1);
  assert.equal(m.education[0].institution, "TATU, Axborot tizimlari, 2018");
  // Eski hujjatda ko'nikmalar bitta satrda edi — vergul va «·» bo'yicha ajraladi.
  assert.deepEqual(m.skills.map((s) => s.text), ["Node.js", "SQL", "React"]);
  // Eski sarlavhalar yorliq sifatida saqlanadi.
  assert.equal(m.labels.summary, "Qisqacha");
  assert.equal(m.labels.experience, "Ish tajribasi");
  // Bo'sh hujjat ham yiqilmaydi.
  const empty = legacyResumeModel({ meta: { language: "uz" }, sections: [] } as unknown as AcademicDoc);
  assert.equal(empty.experience.length, 0);
  assert.deepEqual(empty.order, DEFAULT_ORDER);
});
