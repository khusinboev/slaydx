import test from "node:test";
import assert from "node:assert/strict";
import {
  applyResumeOps,
  inverseResumeOps,
  parseResumeOps,
  RESUME_ROW_SECTIONS,
  type ResumeOp,
} from "../lib/generation/resume/edit.ts";
import { docFromResume, RESUME_LIMITS, type ResumeModel } from "../lib/generation/resume/model.ts";
import { SAMPLE_RESUME } from "../lib/generation/resume/samples.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * Rezyume tahrir oplari (Rezyume 2, AUDIT-15).
 *
 * Markazdagi kafolat — AYLANMA: `apply(ops)` dan keyin
 * `apply(inverse(ops))` hujjatni AYNAN eski holatiga qaytaradi. Ctrl+Z
 * shu ikkisining ustida turadi; teskari hisob bir joyda ham noto'g'ri
 * bo'lsa foydalanuvchi «bekor qildim, lekin boshqa narsa o'zgardi»
 * degan natijani oladi va buni faqat deep-equal ushlaydi.
 */

const GEN = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-2222-3333-4444-555555555555";
const asset = (id: string, gen = GEN) => `/api/generations/${gen}/assets/${id}`;

const META: DocMeta = {
  topic: "Moliya tahlilchisi",
  author: "Karimova Dilnoza",
  workLabel: "Rezyume",
  language: "uz",
  toolId: "resume",
} as unknown as DocMeta;

function base(model: ResumeModel = SAMPLE_RESUME): AcademicDoc {
  return docFromResume(model, META);
}

function apply(doc: AcademicDoc, ops: ResumeOp[]) {
  const r = applyResumeOps(doc, ops, { genId: GEN });
  assert.ok(r.ok, r.ok ? "" : `kutilmagan xato: ${r.error}`);
  return r.doc;
}

/** `apply → inverse → apply` aylanmasi hujjatni AYNAN qaytaradimi. */
function roundTrip(name: string, ops: ResumeOp[], doc = base()) {
  const inv = inverseResumeOps(doc, ops, { genId: GEN });
  assert.ok(inv.length, `${name}: teskari ro'yxat bo'sh`);
  const forward = apply(doc, ops);
  const backAgain = apply(forward, inv);
  assert.deepEqual(backAgain, doc, `${name}: aylanma asl holatga qaytmadi`);
  return forward;
}

/* ══════════════════════════════ aylanma ══════════════════════════════ */

test("har bir op turi uchun apply → inverse aylanmasi asl hujjatni qaytaradi", () => {
  roundTrip("text/identity", [{ op: "text", path: "identity.headline", value: "Bosh moliyachi" }]);
  roundTrip("text/summary", [{ op: "text", path: "summary", value: "Yangi qisqacha matn." }]);
  roundTrip("text/row", [{ op: "text", path: "experience.0.role", value: "Direktor" }]);
  roundTrip("text/date", [{ op: "text", path: "experience.1.end", value: "2023-05" }]);
  roundTrip("text/bullet", [{ op: "text", path: "experience.0.bullets.1.text", value: "Boshqa natija." }]);
  roundTrip("text/contact", [{ op: "text", path: "contact.email", value: "a@b.uz" }]);
  roundTrip("text/link", [{ op: "text", path: "links.0.url", value: "https://github.com/x" }]);
  roundTrip("list", [{ op: "list", items: ["Excel", "SQL", "Yangi ko‘nikma"] }]);
  roundTrip("rowAdd", [{ op: "rowAdd", section: "education" }]);
  roundTrip("rowRemove", [{ op: "rowRemove", section: "experience", index: 0 }]);
  roundTrip("rowMove", [{ op: "rowMove", section: "experience", from: 0, to: 1 }]);
  roundTrip("bulletAdd", [{ op: "bulletAdd", row: 0, at: 1, value: "Qo‘shildi" }]);
  roundTrip("bulletRemove", [{ op: "bulletRemove", row: 0, index: 2 }]);
  roundTrip("bulletMove", [{ op: "bulletMove", row: 0, from: 0, to: 2 }]);
  roundTrip("sectionMove", [{ op: "sectionMove", section: "skills", to: 1 }]);
  roundTrip("template", [{ op: "template", template: "card" }]);
  roundTrip("palette", [{ op: "palette", palette: "plum" }]);
  roundTrip("photo", [{ op: "photo", url: asset("abc123"), shape: "circle" }]);
  roundTrip("set", [{ op: "set", model: { ...SAMPLE_RESUME, summary: "Butunlay boshqa" } }]);
});

test("bir necha op ketma-ketligining teskarisi ham aylanadi", () => {
  roundTrip("ketma-ket", [
    { op: "text", path: "identity.fullName", value: "Yangi Ism" },
    { op: "bulletAdd", row: 1, at: 0, value: "Yangi band" },
    { op: "rowMove", section: "languages", from: 0, to: 2 },
    { op: "palette", palette: "ocean" },
  ]);
});

test("suratni olib tashlash ham aylanadi", () => {
  const withPhoto = apply(base(), [{ op: "photo", url: asset("aa11"), shape: "circle" }]);
  roundTrip("photo/remove", [{ op: "photo", url: "" }], withPhoto);
});

/* ══════════════════════════════ ai nishoni ══════════════════════════════ */

const AI_MODEL: ResumeModel = {
  ...SAMPLE_RESUME,
  enriched: true,
  experience: SAMPLE_RESUME.experience.map((e, i) =>
    i === 0 ? { ...e, bullets: e.bullets.map((b, j) => (j === 0 ? { ...b, ai: true as const } : b)) } : e,
  ),
  skills: [{ text: "Excel" }, { text: "Prognozlash", ai: true }],
};

test("`ai` bandni matn bilan tahrirlash nishonni TOZALAYDI", () => {
  const doc = base(AI_MODEL);
  assert.equal(doc.resume?.experience[0].bullets[0].ai, true, "sinov ma'noli bo'lishi uchun band `ai` bo'lsin");
  const next = apply(doc, [{ op: "text", path: "experience.0.bullets.0.text", value: "Qo‘lda yozildi" }]);
  assert.equal(next.resume?.experience[0].bullets[0].text, "Qo‘lda yozildi");
  assert.equal(next.resume?.experience[0].bullets[0].ai, undefined, "`ai` nishoni qolib ketdi");
});

test("`ai` bandning teskarisi nishonni ham qaytaradi (`set` orqali)", () => {
  const doc = base(AI_MODEL);
  const ops: ResumeOp[] = [{ op: "text", path: "experience.0.bullets.0.text", value: "Qo‘lda yozildi" }];
  const inv = inverseResumeOps(doc, ops, { genId: GEN });
  assert.equal(inv[0].op, "set", "`ai` band uchun teskari op butun model bo'lishi kerak");
  assert.deepEqual(apply(apply(doc, ops), inv), doc);
});

test("`list` o'zgarmagan ko'nikmaning `ai` nishonini saqlaydi, o'zgarganini yo'q", () => {
  const doc = base(AI_MODEL);
  const next = apply(doc, [{ op: "list", items: ["Excel", "Prognozlash", "Prognoz"] }]);
  assert.deepEqual(next.resume?.skills, [{ text: "Excel" }, { text: "Prognozlash", ai: true }, { text: "Prognoz" }]);
});

/* ══════════════════════════════ chegaralar ══════════════════════════════ */

test("qator chegarasi oshirilmaydi", () => {
  let doc = base();
  for (let i = doc.resume!.education.length; i < RESUME_LIMITS.education; i++) {
    doc = apply(doc, [{ op: "rowAdd", section: "education" }]);
  }
  const over = applyResumeOps(doc, [{ op: "rowAdd", section: "education" }], { genId: GEN });
  assert.equal(over.ok, false);
});

test("band chegarasi oshirilmaydi", () => {
  let doc = base();
  for (let i = doc.resume!.experience[0].bullets.length; i < RESUME_LIMITS.bullets; i++) {
    doc = apply(doc, [{ op: "bulletAdd", row: 0 }]);
  }
  const over = applyResumeOps(doc, [{ op: "bulletAdd", row: 0 }], { genId: GEN });
  assert.equal(over.ok, false);
});

test("ko'nikmalar chegarasi va takrorlari kesiladi", () => {
  const items = Array.from({ length: RESUME_LIMITS.skills + 10 }, (_, i) => `K${i}`).concat(["K0", "k1"]);
  const doc = apply(base(), [{ op: "list", items }]);
  assert.equal(doc.resume?.skills.length, RESUME_LIMITS.skills);
  assert.equal(new Set(doc.resume?.skills.map((s) => s.text.toLowerCase())).size, RESUME_LIMITS.skills);
});

test("chegaradan tashqaridagi indeks rad etiladi (`at` bilan)", () => {
  for (const op of [
    { op: "rowRemove", section: "experience", index: 99 },
    { op: "rowMove", section: "experience", from: 0, to: 99 },
    { op: "bulletRemove", row: 99, index: 0 },
    { op: "bulletMove", row: 0, from: 0, to: 99 },
    { op: "sectionMove", section: "skills", to: 99 },
  ] as ResumeOp[]) {
    const r = applyResumeOps(base(), [op], { genId: GEN });
    assert.equal(r.ok, false, `${op.op} rad etilmadi`);
    if (!r.ok) assert.equal(r.at, 0);
  }
});

test("yiqilgan op HECH NARSANI qo'llamaydi (atomarlik)", () => {
  const doc = base();
  const r = applyResumeOps(
    doc,
    [
      { op: "text", path: "identity.fullName", value: "Birinchi" },
      { op: "rowRemove", section: "experience", index: 99 },
    ],
    { genId: GEN },
  );
  assert.equal(r.ok, false);
  assert.equal(doc.resume?.identity.fullName, SAMPLE_RESUME.identity.fullName);
});

/* ══════════════════════════════ surat egaligi ══════════════════════════════ */

test("begona surat URL i rad etiladi", () => {
  for (const url of [asset("abc", OTHER), "https://evil.example/x.png", "/api/generations/x/assets/../../etc"]) {
    const r = applyResumeOps(base(), [{ op: "photo", url }], { genId: GEN });
    assert.equal(r.ok, false, `${url} qabul qilindi`);
  }
});

test("`set` opidagi begona surat URL i ham rad etiladi", () => {
  const r = applyResumeOps(
    base(),
    [{ op: "set", model: { ...SAMPLE_RESUME, photo: { url: asset("abc", OTHER), shape: "circle", assetId: "abc" } } }],
    { genId: GEN },
  );
  assert.equal(r.ok, false);
});

test("o'z aktivi qabul qilinadi va `assetId` URL dan olinadi", () => {
  const doc = apply(base(), [{ op: "photo", url: asset("deadbeef") }]);
  assert.equal(doc.resume?.photo?.assetId, "deadbeef");
  assert.equal(doc.resume?.photo?.shape, "circle");
});

/* ══════════════════════════════ sections qayta sintezi ══════════════════════════════ */

test("model o'zgarsa `sections` va `meta` qayta sintez qilinadi", () => {
  const doc = apply(base(), [
    { op: "text", path: "experience.0.role", value: "Moliya direktori" },
    { op: "text", path: "identity.fullName", value: "Yangi Ism" },
    { op: "text", path: "identity.headline", value: "Yangi lavozim" },
  ]);
  const exp = doc.sections.find((s) => s.id === "exp");
  assert.ok(exp, "«exp» bo'limi yo'q");
  assert.ok(
    exp!.blocks.some((b) => b.text.includes("Moliya direktori")),
    "yangi lavozim `sections` ga tushmadi — eski kod (karta, qidiruv) eski matnni ko'radi",
  );
  assert.equal(doc.meta.author, "Yangi Ism");
  assert.equal(doc.meta.topic, "Yangi lavozim");
});

test("bo'lim tartibi o'zgarsa `sections` tartibi ham o'zgaradi", () => {
  const doc = apply(base(), [{ op: "sectionMove", section: "skills", to: 1 }]);
  const ids = doc.sections.map((s) => s.id);
  assert.ok(ids.indexOf("skills") < ids.indexOf("exp"), `kutilgan tartib emas: ${ids.join(",")}`);
});

/* ══════════════════════════════ parseResumeOps ══════════════════════════════ */

test("parseResumeOps yaroqli tanani qabul qiladi", () => {
  const r = parseResumeOps([
    { op: "text", path: "summary", value: "matn" },
    { op: "template", template: "banner" },
    { op: "rowAdd", section: "links", at: 0 },
  ]);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.ops.length, 3);
});

test("parseResumeOps yaroqsiz tanani rad etadi", () => {
  const bad: unknown[] = [
    null,
    [],
    "matn",
    [{ op: "nomalum" }],
    [{ op: "text", path: "identity.__proto__", value: "x" }],
    [{ op: "text", path: "experience.0.bullets.0", value: "x" }],
    [{ op: "text", path: "summary", value: 5 }],
    [{ op: "text", path: "summary", value: "a".repeat(RESUME_LIMITS.summaryChars + 1) }],
    [{ op: "list", items: "Excel" }],
    [{ op: "list", items: Array.from({ length: RESUME_LIMITS.skills + 1 }, () => "x") }],
    [{ op: "rowAdd", section: "summary" }],
    [{ op: "rowMove", section: "experience", from: 0 }],
    [{ op: "template", template: "yoq" }],
    [{ op: "palette", palette: "yoq" }],
    [{ op: "photo", url: 5 }],
    [{ op: "photo", url: "/a", crop: { x: 1 } }],
    [{ op: "set", model: null }],
    // `JSON.parse` `__proto__` ni HAQIQIY o'z-mulk qilib yaratadi (obyekt
    // literalidan farqli) — server tanani aynan shu yo'l bilan oladi.
    [JSON.parse('{"__proto__":{"x":1},"op":"text","path":"summary","value":"x"}')],
    Array.from({ length: 51 }, () => ({ op: "text", path: "summary", value: "x" })),
  ];
  for (const raw of bad) {
    const r = parseResumeOps(raw);
    assert.equal(r.ok, false, `qabul qilindi: ${JSON.stringify(raw).slice(0, 90)}`);
  }
});

test("`RESUME_PATH_RE` bo'lmagan yo'l parse bosqichida to'xtaydi", () => {
  for (const path of ["experience", "identity", "labels.summary", "experience.100.role", "constructor"]) {
    const r = parseResumeOps([{ op: "text", path, value: "x" }]);
    assert.equal(r.ok, false, `«${path}» qabul qilindi`);
  }
});

test("qator bo'limlari ro'yxati modeldagi maydonlar bilan mos", () => {
  const m = SAMPLE_RESUME as unknown as Record<string, unknown>;
  for (const s of RESUME_ROW_SECTIONS) assert.ok(Array.isArray(m[s]), `«${s}» modelda ro'yxat emas`);
});
