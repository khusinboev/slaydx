import test from "node:test";
import assert from "node:assert/strict";
import { titulInputFromValues, titulLayoutFor, defaultTitulLayout } from "../lib/generation/title-page/input.ts";
import { NAME_BLANK, planTitlePage, titulRuns, tailHeightMm, PT_PER_MM, type TitulPlan } from "../lib/generation/title-page/layout.ts";
import { applyTitulOps, inverseTitulOps, parseTitulOps } from "../lib/generation/title-page/edit.ts";
import { TITUL_LAYOUTS_OF, TITUL_WORK_TYPES, type TitulModel } from "../lib/generation/title-page/types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * «Titul» layout model (`planTitlePage`) — the ONE source both the DOCX and the viewer draw.
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `textPara` keeps an empty generated text (no omission) -> «empty optional fields disappear»;
 *   M2. classic signature value `inp.author` replaced by `inp.author || "?"` -> «signature line stays blank»;
 *   M3. `topicPhrase.before` ignored (phrase always after) -> «Russian: на тему before the topic»;
 *   M4. `titulEditableIds` built from the CURRENT plan (with overrides) -> «undo of a cleared run»;
 *   M5. SLACK_MM set to 0 -> «every type × offered layout … fits the page».
 */

const SAMPLE: FormValues = {
  workType: "coursework",
  layout: "classic",
  ministry: "oliy",
  faculty: "Kompyuter injiniringi",
  department: "Axborot xavfsizligi",
  subject: "Dasturlash asoslari",
  topic: "Sun'iy intellekt",
  author: "Aliyev V.",
  group: "912-21",
  supervisor: "Karimov B.",
  supervisorRole: "katta o'qituvchi",
  city: "Toshkent",
  year: 2026,
};

const model = (v: FormValues): TitulModel => ({ input: titulInputFromValues(v), overrides: {} });
const plan = (v: FormValues): TitulPlan => planTitlePage(model(v));
const texts = (p: TitulPlan) => titulRuns(p).map((r) => r.text);
const byId = (p: TitulPlan) => Object.fromEntries(titulRuns(p).map((r) => [r.id, r.text]));

test("classic = the owner's sample: exact strings in reading order", () => {
  assert.deepEqual(texts(plan(SAMPLE)), [
    "O‘ZBEKISTON RESPUBLIKASI OLIY TA’LIM, FAN VA INNOVATSIYALAR VAZIRLIGI",
    "KOMPYUTER INJINIRINGI FAKULTETI",
    "AXBOROT XAVFSIZLIGI KAFEDRASI",
    "DASTURLASH ASOSLARI FANIDAN",
    "KURS ISHI",
    "Mavzu:",
    "Sun'iy intellekt",
    "Bajardi:",
    "Aliyev V.",
    "(912-21 guruhi)",
    "Qabul qildi:",
    "Karimov B.",
    "(katta o'qituvchi)",
    "TOSHKENT — 2026",
  ]);
  const p = plan(SAMPLE);
  assert.ok(p.border, "classic has the double border by default");
  assert.equal(p.zones.map((z) => z.valign).join(","), "top,center,bottom");
  const heading = p.zones[1]!.items.find((it) => it.k === "p" && it.runs[0]!.id === "heading");
  assert.ok(heading && heading.k === "p" && heading.sizePt === 28 && heading.spacingPt === 2);
});

test("empty optional fields disappear; signature lines stay blank", () => {
  const p = plan({ ...SAMPLE, faculty: "", department: "", subject: "", group: "", supervisorRole: "", author: "", supervisor: "" });
  const ids = byId(p);
  for (const gone of ["faculty", "department", "subject", "author.note", "supervisor.note", "university"]) assert.ok(!(gone in ids), `${gone} must not be drawn`);
  assert.equal(ids["author.value"], "", "author line kept, blank to sign");
  assert.equal(ids["supervisor.value"], "");
  assert.equal(ids["author.label"], "Bajardi:");
  // Non-underlined layouts: the blank is underscores, never a dangling label.
  const m = byId(plan({ ...SAMPLE, layout: "mavzusida", author: "", group: "" }));
  assert.equal(m["author.value"], NAME_BLANK);
  assert.ok(!("author.student" in m));
});

test("every type × offered layout plans, ends with the city line, and fits the page", () => {
  for (const t of TITUL_WORK_TYPES) {
    for (const layout of TITUL_LAYOUTS_OF[t]) {
      const p = plan({ ...SAMPLE, workType: t, layout, direction: "Kompyuter injiniringi", speciality: "Axborot xavfsizligi", course: "3" });
      const all = texts(p);
      assert.ok(all.includes(t === "master" ? "SUN'IY INTELLEKT" : layout === "bmi-official" ? "SUN'IY INTELLEKT" : "Sun'iy intellekt"), `${t}/${layout} topic`);
      assert.match(all[all.length - 1]!, /2026$/, `${t}/${layout} ends with the year`);
      const m = p.page.margin;
      const used = p.zones.reduce((s, z) => s + z.heightMm, 0) + tailHeightMm(p.tail);
      assert.ok(used <= p.page.heightMm - m.top - m.bottom - 2, `${t}/${layout}: ${used.toFixed(1)} mm leaves no slack`);
      assert.ok(p.zones.every((z) => z.heightMm >= 20), `${t}/${layout} zone heights`);
    }
  }
});

test("headings per type, lab number and practical work", () => {
  const h = (v: FormValues) => byId(plan({ ...SAMPLE, ...v })).heading;
  assert.equal(h({ workType: "coursework" }), "KURS ISHI");
  assert.equal(h({ workType: "bmi", layout: "classic" }), "BITIRUV MALAKAVIY ISHI");
  assert.equal(h({ workType: "independent" }), "MUSTAQIL ISH");
  assert.equal(h({ workType: "referat" }), "REFERAT");
  assert.equal(h({ workType: "practice" }), "AMALIYOT HISOBOTI");
  assert.equal(h({ workType: "lab", labNumber: "3" }), "LABORATORIYA ISHI № 3");
  assert.equal(h({ workType: "lab", labKind: "practical" }), "AMALIY ISH");
  assert.equal(h({ workType: "master" }), "DISSERTATSIYA");
});

test("layouts follow the type: offered list, default, fallback", () => {
  assert.equal(defaultTitulLayout("bmi"), "bmi-official");
  assert.equal(defaultTitulLayout("master"), "dissertation");
  assert.equal(titulLayoutFor("coursework", "bmi-official"), "classic", "a layout not offered for the type falls back");
  assert.equal(titulInputFromValues({ workType: "master", layout: "classic" }).layout, "dissertation");
  assert.equal(titulInputFromValues({ layout: "mavzusida" }).border, false, "border default: classic only");
  assert.equal(titulInputFromValues({}).border, true);
});

test("BMI official: approval block, direction, NAME, TOPIC, «mavzusidagi», heading, supervisor with a sign blank", () => {
  const p = plan({ ...SAMPLE, workType: "bmi", layout: "bmi-official", course: "4", direction: "Kompyuter injiniringi", directionCode: "60610100", approver: "Rahimov S.", reviewer: "dotsent Yusupov A." });
  const t = texts(p);
  const i = (s: string) => t.indexOf(s);
  assert.ok(i("Himoyaga ruxsat etilsin") > 0);
  assert.equal(byId(p)["approve.title"], "Kompyuter injiniringi fakulteti dekani");
  assert.equal(byId(p)["author.direction"], "60610100 – “Kompyuter injiniringi” yo‘nalishi");
  assert.equal(byId(p)["author.student"], "4-kurs 912-21 talabasi");
  assert.ok(i("ALIYEV V.") < i("SUN'IY INTELLEKT") && i("SUN'IY INTELLEKT") < i("mavzusidagi") && i("mavzusidagi") < i("BITIRUV MALAKAVIY ISHI"));
  assert.equal(byId(p)["supervisor.label"], "Ilmiy rahbar:");
  assert.equal(byId(p)["reviewer.value"], "dotsent Yusupov A.");
  assert.equal(byId(plan({ ...SAMPLE, workType: "bmi", layout: "bmi-official", approverRole: "head" }))["approve.title"], "Axborot xavfsizligi kafedrasi mudiri");
  assert.ok(!("reviewer.label" in byId(plan({ ...SAMPLE, workType: "bmi", layout: "bmi-official" }))), "no reviewer -> no label");
});

test("dissertation: kafedra in quotes, manuscript + UDK, purpose line, DISSERTATSIYA, caps city", () => {
  const p = byId(plan({ ...SAMPLE, workType: "master", udk: "004.8", specialityCode: "70610101", speciality: "Axborot xavfsizligi" }));
  assert.equal(p.department, "“AXBOROT XAVFSIZLIGI” KAFEDRASI");
  assert.equal(p.manuscript, "Qo‘lyozma huquqida");
  assert.equal(p["udk.value"], "004.8");
  assert.equal(p.purpose, "70610101 – Axborot xavfsizligi mutaxassisligi bo‘yicha magistr akademik darajasini olish uchun yozilgan");
  assert.equal(p.cityYear, "TOSHKENT – 2026");
  assert.ok(!("faculty" in p), "the dissertation arrangement has no faculty line");
});

test("label languages: Uzbek Cyrillic and Russian (incl. «на тему» before the topic)", () => {
  const cy = byId(plan({ ...SAMPLE, lang: "uz-cyrl" }));
  assert.equal(cy.heading, "КУРС ИШИ");
  assert.equal(cy["author.label"], "Бажарди:");
  assert.equal(cy["supervisor.label"], "Қабул қилди:");
  assert.equal(cy.cityYear, "ТОШКЕНТ — 2026", "a typed «Toshkent» follows the label script");
  assert.equal(cy.ministry, "ЎЗБЕКИСТОН РЕСПУБЛИКАСИ ОЛИЙ ТАЪЛИМ, ФАН ВА ИННОВАЦИЯЛАР ВАЗИРЛИГИ");
  const ru = plan({ ...SAMPLE, lang: "ru", layout: "mavzusida" });
  const t = texts(ru);
  assert.equal(byId(ru).heading, "КУРСОВАЯ РАБОТА");
  assert.ok(t.indexOf("на тему") >= 0 && t.indexOf("на тему") < t.indexOf("Sun'iy intellekt"), "Russian: на тему before the topic");
  const uz = texts(plan({ ...SAMPLE, layout: "mavzusida" }));
  assert.ok(uz.indexOf("mavzusida") > uz.indexOf("Sun'iy intellekt"), "Uzbek: mavzusida after the topic");
  assert.equal(byId(plan({ ...SAMPLE, city: "Samarqand", lang: "ru" })).cityYear, "SAMARQAND — 2026", "another city stays as typed");
});

test("checker label choice and ministry variants", () => {
  assert.equal(byId(plan({ ...SAMPLE, checkerLabel: "checked" }))["supervisor.label"], "Tekshirdi:");
  assert.equal(byId(plan({ ...SAMPLE, checkerLabel: "supervisor" }))["supervisor.label"], "Ilmiy rahbar:");
  assert.equal(byId(plan({ ...SAMPLE, ministry: "maktab" })).ministry, "O‘ZBEKISTON RESPUBLIKASI MAKTABGACHA VA MAKTAB TA’LIMI VAZIRLIGI");
  assert.ok(!("ministry" in byId(plan({ ...SAMPLE, ministry: "none" }))));
  const c = byId(plan({ ...SAMPLE, ministry: "custom", ministryCustom: "Raqamli texnologiyalar vazirligi\nIkkinchi qator" }));
  assert.equal(c["ministry.0"], "RAQAMLI TEXNOLOGIYALAR VAZIRLIGI");
  assert.equal(c["ministry.1"], "IKKINCHI QATOR");
});

test("maximal fields shrink a zone deterministically instead of overflowing it (estimate)", () => {
  const long = (n: number) => "Universitetining ".repeat(20).slice(0, n);
  const p = plan({ ...SAMPLE, university: long(150), faculty: long(100), department: long(100), ministry: "custom", ministryCustom: `${long(160)}\n${long(160)}` });
  const top = p.zones[0]!;
  const first = top.items[0]!;
  assert.ok(first.k === "p" && first.sizePt < 17.5, "the head shrank");
  assert.deepEqual(planTitlePage(model({ ...SAMPLE, university: long(150) })), planTitlePage(model({ ...SAMPLE, university: long(150) })), "pure");
  assert.ok(PT_PER_MM > 2.8);
});

/* ── in-place edits ── */

const docOf = (v: FormValues): AcademicDoc => ({ meta: {} as AcademicDoc["meta"], titlePage: false, toc: false, sections: [], titul: model(v) });

test("edit: a run's text is replaced verbatim; null restores; unknown ids are refused", () => {
  const d = docOf(SAMPLE);
  const r = applyTitulOps(d, [{ op: "text", id: "heading", value: "KURS  ISHI\n(loyiha)" }]);
  assert.ok(r.ok);
  assert.equal(byId(planTitlePage(r.doc.titul!)).heading, "KURS ISHI (loyiha)");
  const back = applyTitulOps(r.doc, [{ op: "text", id: "heading", value: null }]);
  assert.ok(back.ok);
  assert.equal(byId(planTitlePage(back.doc.titul!)).heading, "KURS ISHI");
  assert.equal(applyTitulOps(d, [{ op: "text", id: "reviewer.value", value: "x" }]).ok, false, "a run not on this page");
  assert.equal(applyTitulOps(d, [{ op: "text", id: "__proto__", value: "x" }]).ok, false);
  assert.equal(parseTitulOps([{ op: "text", id: "a b", value: "x" }]).ok, false);
  assert.equal(parseTitulOps([{ op: "text", id: "topic.value", value: 3 }]).ok, false);
  assert.equal(parseTitulOps({}).ok, false);
});

test("edit: clearing a run removes its paragraph; undo of a cleared run works", () => {
  const d = docOf(SAMPLE);
  const ops = [{ op: "text" as const, id: "department", value: "" }];
  const r = applyTitulOps(d, ops);
  assert.ok(r.ok);
  assert.ok(!("department" in byId(planTitlePage(r.doc.titul!))));
  const inv = inverseTitulOps(d, ops);
  const u = applyTitulOps(r.doc, inv);
  assert.ok(u.ok, "the undo op is accepted although the run is not drawn now");
  assert.equal(byId(planTitlePage(u.doc.titul!)).department, "AXBOROT XAVFSIZLIGI KAFEDRASI");
  // Signature line: a typed name lands on the line.
  const s = applyTitulOps(docOf({ ...SAMPLE, author: "" }), [{ op: "text", id: "author.value", value: "Valiyev A." }]);
  assert.ok(s.ok);
  assert.equal(byId(planTitlePage(s.doc.titul!))["author.value"], "Valiyev A.");
});
