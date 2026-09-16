import test from "node:test";
import assert from "node:assert/strict";
import { planWork, isAppendixId, WORK_CITE_STYLE } from "../lib/generation/work/layout.ts";
import { workVisualNumbers } from "../lib/generation/work/plan.ts";
import { sampleWorkDoc } from "../lib/generation/work/samples.ts";
import { titleModel } from "../lib/generation/title-model.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * TALABA ISHI MAKETI (AUDIT-19 WP-C) — `planWork` YAGONA MANBA.
 *
 * Bu yerda faqat REJA sinaladi: tartib, raqamlash, iqtibos ko'rinishi,
 * adabiyot tartibi, mundarija ↔ matn mosligi. DOCX XML i
 * `work-docx.test.mts` da, ko'ruvchi bilan pariteti
 * `viewer/work-parity.test.mts` da.
 */

const META: DocMeta = {
  topic: "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish",
  workLabel: "Kurs ishi",
  language: "uz",
  toolId: "coursework",
} as unknown as DocMeta;

const h1s = (doc: AcademicDoc) => planWork(doc).body.filter((b) => b.k === "h1").map((b) => b.text);
const texts = (doc: AcademicDoc) => planWork(doc).body.flatMap((b) => ("text" in b ? [b.text] : []));

/* ══════════════════════════════ tartib va sarlavhalar ══════════════════════════════ */

test("tartib: KIRISH → 1-BOB → paragraflar → 2-BOB → XULOSA; ilova ADABIYOTLARDAN KEYIN", () => {
  const plan = planWork(sampleWorkDoc(META));
  const heads = plan.body.filter((b) => b.k === "h1" || b.k === "h2").map((b) => b.text);
  assert.deepEqual(heads, [
    "KIRISH",
    "1-BOB. ADAPTIV O‘QITISH TIZIMLARINING NAZARIY ASOSLARI",
    "1.1. Adaptiv o‘qitish tushunchasi va tasnifi",
    "1.2. Xorijiy va mahalliy tajriba tahlili",
    "2-BOB. TIZIMNI JORIY ETISH VA SAMARADORLIKNI BAHOLASH",
    "2.1. Tizim arxitekturasi va algoritmi",
    "2.2. Samaradorlikni baholash natijalari",
    "XULOSA",
  ]);
  // Ilova ASOSIY tanada emas — alohida oqimda, adabiyotlardan keyin.
  assert.ok(!plan.body.some((b) => b.k === "h1" && b.text === "1-ILOVA"), "ilova tanada turmasin");
  assert.equal(plan.appendix[0]?.k, "h1");
  assert.equal(plan.appendix[0] && "text" in plan.appendix[0] ? plan.appendix[0].text : "", "1-ILOVA");
});

test("bob sarlavhasi `1-BOB. NOM` — ARAB raqami, BOSH HARF (rim «I BOB» EMAS)", () => {
  const heads = h1s(sampleWorkDoc(META));
  const chapter = heads.find((t) => t.includes("BOB"));
  assert.ok(chapter, "bob sarlavhasi topilmadi");
  assert.ok(/^1-BOB\. /.test(chapter!), `«${chapter}» — «1-BOB. » bilan boshlanmadi`);
  assert.ok(!/^I\s*BOB/.test(chapter!), "rim raqami ishlatilgan");
  assert.equal(chapter, chapter!.toUpperCase(), "bob sarlavhasi bosh harfda emas");
});

test("referat — BOB EMAS, BO'LIM: «1. NOM», bob raqami yo'q", () => {
  const doc = sampleWorkDoc({ ...META, workLabel: "Referat", toolId: "referat" } as DocMeta, { genre: "referat", kind: "informative" });
  const heads = h1s(doc);
  assert.ok(!heads.some((t) => t.includes("BOB")), `referatda «BOB» chiqdi: ${heads.join(" | ")}`);
  assert.ok(heads.some((t) => /^1\. /.test(t)), `referat bo'limi «1. » bilan boshlanmadi: ${heads.join(" | ")}`);
  // Bo'lim yangi varaqdan BOSHLANMAYDI (referat 10–15 bet — bo'sh joy qolmasin).
  const first = planWork(doc).body.find((b) => b.k === "h1" && b.head === "chapter");
  assert.ok(first && first.k === "h1" && !first.pageBreak, "referat bo'limi sahifa uzilishi olmasligi kerak");
});

test("kurs ishida bob YANGI VARAQDAN, tuzilmaviy elementlar ham", () => {
  const plan = planWork(sampleWorkDoc(META));
  const breaks = plan.body.filter((b) => b.k === "h1" && b.pageBreak).map((b) => (b.k === "h1" ? b.text : ""));
  assert.ok(breaks.includes("KIRISH"));
  assert.ok(breaks.includes("XULOSA"));
  assert.ok(breaks.some((t) => t.startsWith("1-BOB.")));
  assert.ok(breaks.some((t) => t.startsWith("2-BOB.")));
  // Paragraf DAVOMIDA — o'z varag'ini talab qilmaydi.
  assert.ok(!plan.body.some((b) => b.k === "h2" && "pageBreak" in b), "paragrafda pageBreak maydoni bo'lmasin");
});

/* ══════════════════════════════ mundarija ══════════════════════════════ */

test("mundarija matn bilan AYNAN bir xil; bob 1-daraja, paragraf 2-daraja", () => {
  const plan = planWork(sampleWorkDoc(META));
  const bodyHeads = plan.body.filter((b) => b.k === "h1" || b.k === "h2").map((b) => b.text);
  const appendixHeads = plan.appendix.filter((b) => b.k === "h1").map((b) => (b.k === "h1" ? b.text : ""));
  assert.deepEqual(plan.toc.map((r) => r.text), [...bodyHeads, plan.refsLabel, ...appendixHeads]);
  const byText = new Map(plan.toc.map((r) => [r.text, r.level]));
  assert.equal(byText.get("KIRISH"), 1);
  assert.equal(byText.get("1-BOB. ADAPTIV O‘QITISH TIZIMLARINING NAZARIY ASOSLARI"), 1);
  assert.equal(byText.get("1.1. Adaptiv o‘qitish tushunchasi va tasnifi"), 2);
  assert.equal(byText.get(plan.refsLabel), 1);
  assert.equal(byText.get("1-ILOVA"), 1);
});

/* ══════════════════════════════ raqamlash ══════════════════════════════ */

test("jadval/rasm raqamlari BOB bo'yicha va `workVisualNumbers` bilan bir xil", () => {
  const doc = sampleWorkDoc(META);
  const plan = planWork(doc);
  const shared = workVisualNumbers(doc);
  assert.deepEqual(plan.numbers.tables, shared.tables, "jadval raqamlari hisobot bilan farq qildi");
  assert.deepEqual(plan.numbers.figures, shared.figures, "rasm raqamlari hisobot bilan farq qildi");
  // Jadval `ch1.2` da, sxema `ch2.1` da.
  assert.equal(plan.numbers.tables.t1, "1.1");
  assert.equal(plan.numbers.figures.f1, "2.1");
  const table = plan.body.find((b) => b.k === "table");
  assert.ok(table && table.k === "table");
  assert.equal(table.numberLine, "1.1-jadval");
  const figure = plan.body.find((b) => b.k === "figure");
  assert.ok(figure && figure.k === "figure");
  assert.ok(figure.caption.startsWith("2.1-rasm. "), `«${figure.caption}»`);
});

test("referatda raqam TEKIS — «1-jadval», «1-rasm» (bob raqamisiz)", () => {
  const doc = sampleWorkDoc({ ...META, toolId: "referat" } as DocMeta, { genre: "referat", kind: "informative" });
  const plan = planWork(doc);
  assert.equal(plan.numbers.tables.t1, "1");
  assert.equal(plan.numbers.figures.f1, "1");
  const table = plan.body.find((b) => b.k === "table");
  assert.ok(table && table.k === "table" && table.numberLine === "1-jadval", "referat jadvali «1-jadval» bo'lishi kerak");
});

test("formula raqami bob bo'yicha — `(2.1)`", () => {
  const plan = planWork(sampleWorkDoc(META));
  const f = plan.body.find((b) => b.k === "formula");
  assert.ok(f && f.k === "formula");
  assert.equal(f.number, "(2.1)");
});

/* ══════════════════════════════ iqtibos va adabiyotlar ══════════════════════════════ */

test("iqtibos `[3]` / `[3, 45-b.]` shaklida — nuqtali vergulsiz", () => {
  const plan = planWork(sampleWorkDoc(META));
  assert.equal(plan.cite, WORK_CITE_STYLE);
  const all = texts(sampleWorkDoc(META)).join("\n");
  assert.ok(/\[\d+\]/.test(all), "raqamli iqtibos topilmadi");
  assert.ok(/\[\d+, 45-b\.\]/.test(all), `lokatorli iqtibos vergul bilan bo'lishi kerak: ${all.match(/\[[^\]]*45[^\]]*\]/)?.[0]}`);
  assert.ok(!/\[\d+; /.test(all), "GOST uslubidagi nuqtali vergul ishlatilgan");
  // Xom `[W…]`/`[u1]` id lari ekranga CHIQMAYDI.
  assert.ok(!/\[(?:W\d+|u\d|lex:)/.test(all), "xom manba id si matnda qoldi");
});

test("`[fig:f1]` havolasi raqamga o'giriladi", () => {
  const all = texts(sampleWorkDoc(META)).join("\n");
  assert.ok(!all.includes("[fig:f1]"), "rasm havolasi xom qoldi");
  assert.ok(all.includes("2.1-rasm"), "matnda rasmga havola yo'q");
});

test("adabiyotlar O'zbekiston tartibida: qonun → Prezident → VM → kitob → maqola → statistika → internet", () => {
  const plan = planWork(sampleWorkDoc(META));
  assert.equal(plan.refs.length, 15, "15 manbaning hammasi ro'yxatda bo'lishi kerak");
  assert.deepEqual(plan.refs.map((r) => r.n), Array.from({ length: 15 }, (_, i) => i + 1));
  const ids = plan.refs.map((r) => r.ref.id);
  const at = (id: string) => ids.indexOf(id);
  assert.ok(at("lex:1") < at("lex:2"), "qonun Prezident farmonidan oldin");
  assert.ok(at("lex:2") < at("lex:3"), "Prezident farmoni VM qaroridan oldin");
  assert.ok(at("lex:3") < at("u1"), "normativ hujjatlar kitobdan oldin");
  assert.ok(Math.max(at("u1"), at("u6")) < at("W2741809807"), "kitoblar maqoladan oldin");
  assert.ok(at("W7731") < at("st1"), "maqola statistikadan oldin");
  assert.ok(at("st1") < at("w1"), "statistika internetdan oldin");
  // GOST shakli: «Karimov A. N. Ta’limda raqamli texnologiyalar. – Toshkent: Fan, 2022. – 240 b.»
  const book = plan.refs.find((r) => r.ref.id === "u1")!;
  assert.ok(book.text.includes("– Toshkent: Fan, 2022"), `GOST kitob shakli emas: ${book.text}`);
  assert.equal(book.line, `${book.n}. ${book.text}`);
});

test("ro'yxatga FAQAT `cited` manba kiradi", () => {
  const doc = sampleWorkDoc(META);
  doc.work!.references = doc.work!.references.map((r) => (r.id === "u6" ? { ...r, cited: false } : r));
  const plan = planWork(doc);
  assert.equal(plan.refs.length, 14);
  assert.ok(!plan.refs.some((r) => r.ref.id === "u6"), "iqtibos qilinmagan manba ro'yxatga kirdi");
  // Qolganlarining raqami UZLUKSIZ qayta beriladi.
  assert.deepEqual(plan.refs.map((r) => r.n), Array.from({ length: 14 }, (_, i) => i + 1));
});

/* ══════════════════════════════ titul ══════════════════════════════ */

test("titul 9 maydon: vazirlik, OTM, fakultet, kafedra, «FAN» fanidan, mavzu, Bajardi, Tekshirdi, shahar–yil", () => {
  const doc = sampleWorkDoc(META);
  const T = titleModel(doc);
  assert.equal(T.kind, "gost");
  if (T.kind !== "gost") return;
  assert.ok(T.ministry[0].includes("O‘ZBEKISTON RESPUBLIKASI"));
  assert.ok(T.ministry.join(" ").includes("OLIY TA’LIM, FAN VA INNOVATSIYALAR VAZIRLIGI"));
  assert.equal(T.university, "Toshkent axborot texnologiyalari universiteti");
  assert.equal(T.faculty, "Dasturiy injiniring fakulteti");
  assert.equal(T.department, "Axborot ta’lim texnologiyalari kafedrasi");
  assert.equal(T.subjectLine, "«Ta’limda axborot texnologiyalari» fanidan");
  assert.equal(T.workLabel, "Kurs ishi");
  assert.equal(T.topicLabel, "Mavzu:");
  assert.equal(T.topic, META.topic);
  assert.equal(T.authorLabel, "Bajardi");
  assert.equal(T.author, "301-guruh, Aliyev Ali Valiyevich");
  assert.equal(T.teacherLabel, "Tekshirdi");
  assert.equal(T.teacher, "PhD, dotsent Karimova Dilnoza Baxtiyorovna");
  assert.ok(T.cityYear.startsWith("Toshkent"));
  // «Fan: …» qatori TAKRORLANMAYDI — fan nomi allaqachon `subjectLine` da.
  assert.ok(!T.subject);
});

test("vazirlik «o'z matnim» — ikki qator; bo'sh bo'lsa rasmiy matnga qaytadi", () => {
  const doc = sampleWorkDoc(META);
  doc.work!.ministry = "custom";
  doc.work!.ministryCustom = "O‘ZBEKISTON RESPUBLIKASI RAQAMLI TEXNOLOGIYALAR VAZIRLIGI\nOLIY TA’LIM, FAN VA INNOVATSIYALAR VAZIRLIGI";
  const T = titleModel(doc);
  assert.equal(T.kind, "gost");
  if (T.kind !== "gost") return;
  assert.deepEqual(T.ministry, [
    "O‘ZBEKISTON RESPUBLIKASI RAQAMLI TEXNOLOGIYALAR VAZIRLIGI",
    "OLIY TA’LIM, FAN VA INNOVATSIYALAR VAZIRLIGI",
  ]);

  doc.work!.ministryCustom = "   ";
  const back = titleModel(doc);
  assert.ok(back.kind === "gost" && back.ministry.join(" ").includes("OLIY TA’LIM"), "bo'sh matnda rasmiy qatorga qaytmadi");
});

/* ══════════════════════════════ profil ══════════════════════════════ */

test("chegara fan profilidan: gumanitar o'ng 1,0 sm, texnik 1,5 sm; qolgani 2/2/3", () => {
  const tech = planWork(sampleWorkDoc(META, { subject: "technical" }));
  const hum = planWork(sampleWorkDoc(META, { subject: "humanities" }));
  assert.deepEqual(tech.page.marginsCm, { top: 2, bottom: 2, left: 3, right: 1.5 });
  assert.deepEqual(hum.page.marginsCm, { top: 2, bottom: 2, left: 3, right: 1.0 });
  assert.equal(tech.page.sizePt, 14);
  assert.equal(tech.page.tableSizePt, 12);
  assert.equal(tech.page.smallPt, 10);
});

test("jadval «Manba:» qatori va sxema manbasi yorliq bilan", () => {
  const plan = planWork(sampleWorkDoc(META));
  const table = plan.body.find((b) => b.k === "table");
  assert.ok(table && table.k === "table");
  assert.equal(table.source, "Manba: muallif tomonidan tuzilgan");
  const fig = plan.body.find((b) => b.k === "figure");
  assert.ok(fig && fig.k === "figure");
  assert.equal(fig.source, "Manba: muallif tomonidan tuzilgan");
});

test("`isAppendixId` — `appendix-1`/`appendix2`/`appendix`; bob id si emas", () => {
  assert.ok(isAppendixId("appendix-1"));
  assert.ok(isAppendixId("appendix2"));
  assert.ok(isAppendixId("appendix"));
  assert.ok(!isAppendixId("ch1"));
  assert.ok(!isAppendixId("appendices-list"));
});
