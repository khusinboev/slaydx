import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { slideLabels } from "../lib/generation/i18n.ts";
import {
  applyDocOps,
  canConvert,
  inverseOps,
  newSlide,
  ownAssetUrlRe,
  parseDocOps,
  readSlideField,
  sanitizeSlideModel,
  writeSlideField,
  type DocOp,
  type EditRules,
} from "../lib/generation/slide-edit.ts";
import { photoSlot } from "../lib/generation/slide-layout.ts";
import { SLIDE_LIMITS } from "../lib/generation/slide-limits.ts";
import { renumberSlides } from "../lib/generation/slide-write.ts";
import { buildSlideDeck } from "../lib/generation/slides.ts";
import type { SlideModel, SlideSrc } from "../lib/generation/slide-types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";

/**
 * E3 — sof tahrir mantig'i (`lib/generation/slide-edit.ts`).
 *
 * Har qoida uchun assertion + MUTATSIYA (qoidani kodda buzib, aynan shu
 * test qizarishi tekshirilgan — hisobotdagi jadval). Sinovlar DB/HTTP
 * siz: `applyDocOps` sof funksiya, `AcademicDoc` kirib, `AcademicDoc`
 * chiqadi.
 */

const GEN = "a1b2c3d4-0000-4000-8000-000000000001";
const ASSET = `/api/generations/${GEN}/assets/${"ab".repeat(12)}`;
const ctx = { genId: GEN };

const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);

function rawDoc(slides: SlideModel[]): AcademicDoc {
  return { meta, titlePage: true, toc: true, sections: [], slides, slideTemplate: "lecture" };
}

/** Hujjatni «kanonik» holatga keltiradi: bo'sh o'girish ham renumber + sections qiladi. */
function docOf(slides: SlideModel[]): AcademicDoc {
  const r = applyDocOps(rawDoc(slides), [{ op: "reorder", order: slides.map((_, i) => i) }], ctx);
  assert.equal(r.ok, true);
  return (r as { ok: true; doc: AcademicDoc }).doc;
}

function apply(doc: AcademicDoc, ops: DocOp[]): AcademicDoc {
  const r = applyDocOps(doc, ops, ctx);
  assert.equal(r.ok, true, r.ok ? "" : `kutilmagan xato: ${r.error}`);
  return (r as { ok: true; doc: AcademicDoc }).doc;
}

function failure(doc: AcademicDoc, ops: DocOp[]): { error: string; at: number } {
  const r = applyDocOps(doc, ops, ctx);
  assert.equal(r.ok, false, "operatsiya rad etilishi kerak edi");
  return r as { ok: false; error: string; at: number };
}

const rules: EditRules = buildSlideDeck(rawDoc([{ id: "s0", layout: "bullets", title: "x" }])).bodyType;

const bullets: SlideModel = { id: "s0", layout: "bullets", title: "Bandlar", bullets: ["Bir.", "Ikki."] };
const table: SlideModel = {
  id: "s1",
  layout: "table",
  title: "Jadval",
  table: { headers: ["Ustun A", "Ustun B"], rows: [["a1", "b1"], ["a2", "b2"]] },
};
const quiz: SlideModel = {
  id: "s2",
  layout: "quiz",
  title: "Test",
  quiz: [{ q: "Savol?", options: ["Bir", "Ikki", "Uch", "To‘rt"], answer: 1 }],
  notes: "Javob: B — Ikki",
};
const stats: SlideModel = { id: "s3", layout: "stats", title: "Raqamlar", stats: [{ value: "95%", label: "qoniqish" }, { value: "12", label: "hudud" }] };
const steps: SlideModel = { id: "s4", layout: "process", title: "Bosqichlar", steps: [{ n: "1", title: "Reja", text: "Matn." }, { n: "2", title: "Ijro", text: "" }] };
const refs: SlideModel = { id: "s5", layout: "references", title: "Manbalar", refs: [{ title: "UNESCO", source: "unesco.org" }] };
const twoCol: SlideModel = { id: "s6", layout: "twoCol", title: "Ikki ustun", leftTitle: "Chap", left: ["L1", "L2"], rightTitle: "O‘ng", right: ["R1"] };

const w = (s: SlideModel, src: SlideSrc, value: string) => writeSlideField(s, src, value, rules);
const wOk = (s: SlideModel, src: SlideSrc, value: string): SlideModel => {
  const r = w(s, src, value);
  assert.equal(r.ok, true, r.ok ? "" : `kutilmagan xato: ${r.error}`);
  return (r as { ok: true; slide: SlideModel }).slide;
};

// ═══════════════════════════════════════════ 1. renumber — `slide-write` bilan bir xil

test("renumber: slide-write.renumberSlides bilan AYNAN bir xil natija", () => {
  const src = [
    { id: "title-fix", layout: "title", title: "T" },
    { id: "s0", layout: "bullets", title: "A" },
    { id: "zzz", layout: "bullets", title: "B" },
  ] as SlideModel[];
  const viaEdit = apply(docOf(src), [{ op: "reorder", order: [0, 1, 2] }]).slides!;
  assert.deepEqual(
    viaEdit.map((s) => s.id),
    renumberSlides(src).map((s) => s.id),
  );
});

// ═══════════════════════════════════════════ 2. readSlideField

test("readSlideField: har manba turi model qiymatini qaytaradi", () => {
  assert.equal(readSlideField(bullets, { f: "title" }), "Bandlar");
  assert.equal(readSlideField(bullets, { f: "bullets", i: 1 }), "Ikki.");
  assert.equal(readSlideField(twoCol, { f: "leftTitle" }), "Chap");
  assert.equal(readSlideField(twoCol, { f: "right", i: 0 }), "R1");
  assert.equal(readSlideField(stats, { f: "stats", i: 0, k: "label" }), "qoniqish");
  assert.equal(readSlideField(steps, { f: "steps", i: 1, k: "text" }), "");
  assert.equal(readSlideField(refs, { f: "refs", i: 0, k: "source" }), "unesco.org");
  assert.equal(readSlideField(quiz, { f: "quiz", i: 0, k: "q" }), "Savol?");
  assert.equal(readSlideField(quiz, { f: "quiz", i: 0, k: "option", j: 2 }), "Uch");
  assert.equal(readSlideField(table, { f: "table", k: "header", c: 1 }), "Ustun B");
  assert.equal(readSlideField(table, { f: "table", k: "cell", r: 1, c: 0 }), "a2");
});

test("readSlideField: yo'q maydon → null", () => {
  assert.equal(readSlideField(bullets, { f: "quote" }), null);
  assert.equal(readSlideField(bullets, { f: "bullets", i: 9 }), null);
  assert.equal(readSlideField(table, { f: "table", k: "cell", r: 9, c: 0 }), null);
});

// ═══════════════════════════════════════════ 3. writeSlideField qoidalari

test("write: bo'sh sarlavha — XATO", () => {
  const r = w(bullets, { f: "title" }, "   ");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Sarlavha/);
});

test("write: har qiymat clipTo bilan qisqaradi", () => {
  const s = wOk(bullets, { f: "title" }, "a".repeat(200));
  assert.equal(s.title.length, SLIDE_LIMITS.title);
  const b = wOk(bullets, { f: "bullets", i: 0 }, "b".repeat(500));
  assert.equal(b.bullets?.[0].length, rules.bulletChars);
});

test("write: bo'sh band elementni O'CHIRADI", () => {
  const s = wOk(bullets, { f: "bullets", i: 0 }, "");
  assert.deepEqual(s.bullets, ["Ikki."]);
});

test("write: i === length yangi band QO'SHADI, chegara oshsa xato", () => {
  const s = wOk(bullets, { f: "bullets", i: 2 }, "Uch.");
  assert.deepEqual(s.bullets, ["Bir.", "Ikki.", "Uch."]);
  let full: SlideModel = { ...bullets, bullets: Array.from({ length: rules.maxBullets }, (_, i) => `B${i}`) };
  const r = w(full, { f: "bullets", i: rules.maxBullets }, "Ortiqcha");
  assert.equal(r.ok, false, "maxBullets dan oshib ketmasin");
  // Bo'sh qiymat bilan «qo'shish» — jim no-op, xato emas.
  full = wOk(full, { f: "bullets", i: rules.maxBullets }, "");
  assert.equal(full.bullets?.length, rules.maxBullets);
});

test("write: ustun bandi — colItems chegarasi, bo'sh qiymat o'chiradi", () => {
  const s = wOk(twoCol, { f: "left", i: 0 }, "");
  assert.deepEqual(s.left, ["L2"]);
  const full = { ...twoCol, left: Array.from({ length: SLIDE_LIMITS.colItems }, (_, i) => `L${i}`) };
  assert.equal(w(full, { f: "left", i: SLIDE_LIMITS.colItems }, "Ortiqcha").ok, false);
});

test("write: jadval katagi «» bo'lib SAQLANADI — ustun surilmaydi", () => {
  const s = wOk(table, { f: "table", k: "cell", r: 0, c: 0 }, "");
  assert.deepEqual(s.table?.rows[0], ["", "b1"], "b1 birinchi ustunga surilmasin");
  assert.equal(s.table?.rows[0].length, 2, "ustun soni o'zgarmasin");
});

test("write: jadval ustun sarlavhasi bo'sh bo'lolmaydi", () => {
  assert.equal(w(table, { f: "table", k: "header", c: 0 }, "").ok, false);
});

test("write: stats — qiymat bo'sh bo'lsa element o'chadi, yorliq bo'sh bo'lishi mumkin", () => {
  const dropped = wOk(stats, { f: "stats", i: 0, k: "value" }, "");
  assert.equal(dropped.stats?.length, 1);
  assert.equal(dropped.stats?.[0].value, "12");
  const noLabel = wOk(stats, { f: "stats", i: 0, k: "label" }, "");
  assert.equal(noLabel.stats?.[0].label, "", "yorliq bo'sh qoladi, karta o'chmaydi");
  assert.equal(noLabel.stats?.length, 2);
});

test("write: steps — sarlavha bo'sh bo'lsa bosqich o'chadi", () => {
  const s = wOk(steps, { f: "steps", i: 0, k: "title" }, "");
  assert.equal(s.steps?.length, 1);
  assert.equal(s.steps?.[0].title, "Ijro");
  const t = wOk(steps, { f: "steps", i: 1, k: "text" }, "Yangi matn.");
  assert.equal(t.steps?.length, 2, "matn bo'sh emas — element qoladi");
});

test("write: refs — ikkalasi bo'sh bo'lsa manba o'chadi", () => {
  const half = wOk(refs, { f: "refs", i: 0, k: "source" }, "");
  assert.equal(half.refs?.length, 1, "nomi qolgan manba saqlanadi");
  const gone = wOk(half, { f: "refs", i: 0, k: "title" }, "");
  assert.equal(gone.refs?.length, 0);
});

test("write: quiz varianti bo'sh bo'lolmaydi (A/B/C/D aynan to'rtta)", () => {
  const r = w(quiz, { f: "quiz", i: 0, k: "option", j: 1 }, "");
  assert.equal(r.ok, false);
  assert.equal(w(quiz, { f: "quiz", i: 0, k: "option", j: 4 }, "Beshinchi").ok, false, "beshinchi variant yo'q");
});

test("write: variant o'zgarsa javob izohi QAYTA hisoblanadi", () => {
  const s = wOk(quiz, { f: "quiz", i: 0, k: "option", j: 1 }, "Yangi javob");
  assert.equal(s.notes, "Javob: B — Yangi javob");
  assert.equal((s.notes?.match(/Javob:/g) ?? []).length, 1, "izoh ikki marta yozilmasin");
  // To'g'ri bo'lmagan variant o'zgarsa izoh o'zgarmaydi.
  const other = wOk(quiz, { f: "quiz", i: 0, k: "option", j: 3 }, "Boshqa");
  assert.equal(other.notes, "Javob: B — Ikki");
});

test("write: bo'sh savol — XATO", () => {
  assert.equal(w(quiz, { f: "quiz", i: 0, k: "q" }, "").ok, false);
});

test("write: maketda bo'lmagan maydon — XATO", () => {
  assert.equal(w(bullets, { f: "table", k: "cell", r: 0, c: 0 }, "x").ok, false);
  assert.equal(w(bullets, { f: "leftTitle" }, "x").ok, false);
});

test("write: ixtiyoriy maydon bo'sh bo'lsa KALIT o'chadi (undefined qolmaydi)", () => {
  const s = wOk({ ...bullets, kicker: "Yorliq" }, { f: "kicker" }, "");
  assert.equal("kicker" in s, false);
});

// ═══════════════════════════════════════════ 4. applyDocOps

test("apply: indeks chegarasi", () => {
  const doc = docOf([bullets, table]);
  assert.match(failure(doc, [{ op: "text", index: 5, src: { f: "title" }, value: "x" }]).error, /chegara/);
  assert.equal(failure(doc, [{ op: "text", index: -1, src: { f: "title" }, value: "x" }]).at, 0);
});

test("apply: xato bo'lsa HECH NARSA qo'llanmaydi (atomar)", () => {
  const doc = docOf([bullets, table]);
  const r = failure(doc, [
    { op: "text", index: 0, src: { f: "title" }, value: "Yangi sarlavha" },
    { op: "text", index: 1, src: { f: "title" }, value: "" },
  ]);
  assert.equal(r.at, 1);
  assert.equal(doc.slides![0].title, "Bandlar", "kirish hujjati o'zgarmaydi");
});

test("apply: oxirgi slaydni o'chirib bo'lmaydi", () => {
  const one = docOf([bullets]);
  assert.match(failure(one, [{ op: "delete", index: 0 }]).error, /Oxirgi slayd/);
  const two = docOf([bullets, table]);
  assert.equal(apply(two, [{ op: "delete", index: 0 }]).slides?.length, 1);
});

test("apply: reorder faqat permutatsiya", () => {
  const doc = docOf([bullets, table, quiz]);
  assert.equal(failure(doc, [{ op: "reorder", order: [0, 0, 1] }]).error.includes("permutatsiya"), true);
  assert.equal(failure(doc, [{ op: "reorder", order: [0, 1] }]).error.includes("mos emas"), true);
  const moved = apply(doc, [{ op: "reorder", order: [2, 0, 1] }]);
  assert.deepEqual(
    moved.slides?.map((s) => s.title),
    ["Test", "Bandlar", "Jadval"],
  );
  assert.deepEqual(moved.slides?.map((s) => s.id), ["s0", "s1", "s2"], "o'chirilgandan keyin qayta raqamlanadi");
});

test("apply: rasm URL i FAQAT shu generatsiya aktivi", () => {
  const doc = docOf([bullets]);
  const ok = apply(doc, [{ op: "image", index: 0, url: ASSET, alt: "Alt" }]);
  assert.deepEqual(ok.slides![0].image, { url: ASSET, alt: "Alt" });
  assert.match(failure(doc, [{ op: "image", index: 0, url: "https://evil.example/x.png" }]).error, /tegishli emas/);
  assert.equal(failure(doc, [{ op: "image", index: 0, url: "/api/generations/boshqa-id/assets/aaaaaaaaaaaaaaaaaaaaaaaa" }]).at, 0);
  const removed = apply(ok, [{ op: "image", index: 0, url: null }]);
  assert.equal("image" in removed.slides![0], false);
});

/*
 * AUDIT-9 E2 dan keyin `table`/`process` ham rasm ko'taradi (o'ng
 * chekkadagi tor tasma) — shuning uchun «rasm joyi yo'q» namunasi endi
 * `quiz`. Unda savol + to'rtta variant butun kenglikni egallaydi, ya'ni
 * tasmaga o'rin YO'Q (`photoSlot` → null).
 */
test("apply: maketda rasm joyi bo'lmasa rasm qo'yilmaydi", () => {
  const doc = docOf([quiz]);
  assert.match(failure(doc, [{ op: "image", index: 0, url: ASSET }]).error, /rasm joyi yo'q/);
  // Tasmali maketga esa QO'YILADI — E2 ning to'g'ri tomoni.
  assert.deepEqual(apply(docOf([table]), [{ op: "image", index: 0, url: ASSET }]).slides![0].image, { url: ASSET });
});

/**
 * Maket o'zgarganda rasm taqdiri — QOIDA bo'yicha, ro'yxat bo'yicha emas.
 *
 * Ilgari bu yerda bitta juftlik («bullets → process, rasm tushadi»)
 * qat'iy yozilgan edi. AUDIT-9 E2 dan keyin `process` rasm TASMASINI
 * ko'taradi va o'sha yozuv yolg'onga aylandi. Endi test invariantni
 * o'zini sinaydi: rasm AYNAN `photoSlot` bor maketlarda qoladi. Ro'yxat
 * kelajakda yana o'zgarsa, test o'zi ergashadi.
 */
test("apply: maket o'zgarganda rasm rasm joyi bo'yicha saqlanadi yoki tushadi", () => {
  const doc = docOf([{ ...bullets, image: { url: ASSET } }]);
  const visual = buildSlideDeck(doc).visual;
  let checked = 0;
  for (const to of ["twoCol", "compare", "process", "stats", "quote", "quiz", "table", "section"] as const) {
    if (!canConvert(doc.slides![0], to).ok) continue;
    checked += 1;
    const conv = apply(doc, [{ op: "layout", index: 0, layout: to }]);
    const hasSlot = photoSlot(to, visual) !== null;
    assert.equal(
      "image" in conv.slides![0],
      hasSlot,
      `${to}: rasm ${hasSlot ? "qolishi" : "tushishi"} kerak edi (photoSlot ${hasSlot ? "bor" : "yo'q"})`,
    );
  }
  assert.ok(checked >= 3, `kamida uchta o'girish sinalishi kerak, sinaldi: ${checked}`);
});

test("apply: add — hujjat tilidagi «Yangi slayd», footer qo'shnidan", () => {
  const doc = docOf([{ ...bullets, footer: "Kolontitul" }, table]);
  const added = apply(doc, [{ op: "add", after: 0 }]);
  assert.equal(added.slides?.length, 3);
  assert.equal(added.slides![1].title, slideLabels(meta.language).newSlide);
  assert.equal(added.slides![1].footer, "Kolontitul");
  assert.deepEqual(added.slides?.map((s) => s.id), ["s0", "s1", "s2"]);
  assert.equal(failure(doc, [{ op: "add", after: 7 }]).error.includes("o'rni"), true);
});

test("newSlide: sarlavha tanlangan tilda", () => {
  assert.equal(newSlide(0, "ru").title, "Новый слайд");
  assert.equal(newSlide(0, "en").title, "New slide");
  assert.equal(newSlide(0, "uz").title, "Yangi slayd");
  assert.equal(newSlide(2, "uz").id, "s3");
});

test("apply: insert/set sanitizatsiyadan o'tadi", () => {
  const doc = docOf([bullets]);
  const dirty = { id: "x", layout: "bullets", title: "Kirdi", bullets: ["Band."], evil: "<script>" } as unknown as SlideModel;
  const ins = apply(doc, [{ op: "insert", index: 1, slide: dirty }]);
  assert.equal("evil" in ins.slides![1], false, "oq-ro'yxatdan tashqari maydon tushmaydi");
  assert.equal(ins.slides![1].id, "s1", "id qayta raqamlanadi");
  assert.match(failure(doc, [{ op: "set", index: 0, slide: { layout: "yo‘q", title: "T" } as unknown as SlideModel }]).error, /yaroqsiz/);
});

test("apply: oxirida sections qayta yig'iladi", () => {
  const doc = docOf([{ id: "s0", layout: "title", title: "Muqova" }, bullets]);
  const next = apply(doc, [{ op: "text", index: 1, src: { f: "bullets", i: 0 }, value: "Yangilangan band." }]);
  assert.equal(next.sections.length, 1, "title slaydi mundarijaga tushmaydi");
  assert.deepEqual(next.sections[0].blocks[0], { kind: "p", text: "Yangilangan band." });
});

test("apply: eski format (slides yo'q) — tahrir yopiq", () => {
  const legacy = { meta, titlePage: true, toc: true, sections: [] } as AcademicDoc;
  const r = applyDocOps(legacy, [{ op: "text", index: 0, src: { f: "title" }, value: "x" }], ctx);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /eski format/);
});

// ═══════════════════════════════════════════ 5. inverseOps — aylanma tenglik

/** `applyDocOps(applyDocOps(doc, ops), inverse)` AYNAN `doc` ga qaytishi kerak. */
function roundTrip(doc: AcademicDoc, ops: DocOp[], label: string) {
  const inverse = inverseOps(doc, ops, ctx);
  const back = apply(apply(doc, ops), inverse);
  assert.deepEqual(back, doc, `${label}: teskari operatsiya asl holatga qaytarmadi`);
}

test("inverse: har op turi uchun aylanma tenglik", () => {
  const doc = docOf([{ ...bullets, footer: "F" }, table, quiz, stats, twoCol]);
  roundTrip(doc, [{ op: "text", index: 0, src: { f: "title" }, value: "Boshqa sarlavha" }], "text");
  roundTrip(doc, [{ op: "text", index: 0, src: { f: "bullets", i: 0 }, value: "" }], "text (element o'chishi)");
  roundTrip(doc, [{ op: "text", index: 0, src: { f: "bullets", i: 2 }, value: "Uch." }], "text (element qo'shish)");
  roundTrip(doc, [{ op: "text", index: 1, src: { f: "table", k: "cell", r: 0, c: 0 }, value: "" }], "text (jadval)");
  roundTrip(doc, [{ op: "text", index: 2, src: { f: "quiz", i: 0, k: "option", j: 1 }, value: "Yangi" }], "text (quiz + izoh)");
  roundTrip(doc, [{ op: "notes", index: 0, value: "Nutq matni" }], "notes");
  roundTrip(doc, [{ op: "image", index: 0, url: ASSET }], "image");
  roundTrip(doc, [{ op: "layout", index: 0, layout: "process" }], "layout");
  roundTrip(doc, [{ op: "add", after: 1 }], "add");
  roundTrip(doc, [{ op: "delete", index: 2 }], "delete");
  roundTrip(doc, [{ op: "insert", index: 1, slide: { id: "sX", layout: "bullets", title: "Kirdi", bullets: ["Band."] } }], "insert");
  roundTrip(doc, [{ op: "set", index: 0, slide: { id: "sX", layout: "bullets", title: "Almashdi", bullets: ["Band."] } }], "set");
  roundTrip(doc, [{ op: "reorder", order: [4, 0, 3, 1, 2] }], "reorder");
});

test("inverse: ketma-ket operatsiyalar teskari TARTIBDA qaytariladi", () => {
  const doc = docOf([bullets, table, quiz]);
  roundTrip(
    doc,
    [
      { op: "text", index: 0, src: { f: "title" }, value: "Bir" },
      { op: "delete", index: 1 },
      { op: "add", after: 0 },
      { op: "reorder", order: [2, 1, 0] },
    ],
    "aralash zanjir",
  );
});

// ═══════════════════════════════════════════ 6. sanitizeSlideModel

test("sanitize: oq-ro'yxat — noma'lum maydon tushmaydi", () => {
  const s = sanitizeSlideModel({ id: "s0", layout: "bullets", title: "T", bullets: ["B"], danger: 1, onClick: "x" }, GEN, rules);
  assert.deepEqual(Object.keys(s!).sort(), ["bullets", "id", "layout", "title"]);
});

test("sanitize: yaroqsiz maket yoki bo'sh sarlavha → null", () => {
  assert.equal(sanitizeSlideModel({ layout: "hacker", title: "T" }, GEN, rules), null);
  assert.equal(sanitizeSlideModel({ layout: "bullets", title: "  " }, GEN, rules), null);
  assert.equal(sanitizeSlideModel("matn", GEN, rules), null);
});

test("sanitize: 3 variantli savol tashlanadi, slayd bandlarga tushadi", () => {
  const s = sanitizeSlideModel(
    { layout: "quiz", title: "T", quiz: [{ q: "S?", options: ["A", "B", "C"], answer: 1 }], bullets: ["Zaxira."] },
    GEN,
    rules,
  );
  assert.equal(s?.layout, "bullets");
  assert.equal(s?.quiz, undefined);
});

test("sanitize: rasm faqat O'Z aktividan", () => {
  const own = sanitizeSlideModel({ layout: "bullets", title: "T", image: { url: ASSET } }, GEN, rules);
  assert.equal(own?.image?.url, ASSET);
  const alien = sanitizeSlideModel({ layout: "bullets", title: "T", image: { url: "https://evil.example/a.png" } }, GEN, rules);
  assert.equal(alien?.image, undefined);
});

test("sanitize: jadval kataklari FILTRLANMAYDI, qator ustunga tenglashadi", () => {
  const s = sanitizeSlideModel(
    { layout: "table", title: "T", table: { headers: ["A", "B", "C"], rows: [["", "b", "c"], ["a2"]] } },
    GEN,
    rules,
  );
  assert.deepEqual(s?.table?.rows[0], ["", "b", "c"], "bo'sh katak saqlanadi");
  assert.deepEqual(s?.table?.rows[1], ["a2", "", ""], "qator ustun soniga to'ldiriladi");
});

test("sanitize: idempotent — ikkinchi marta o'zgartirmaydi", () => {
  for (const s of [bullets, table, quiz, stats, steps, refs, twoCol]) {
    const once = sanitizeSlideModel(s, GEN, rules);
    assert.deepEqual(sanitizeSlideModel(once, GEN, rules), once, `${s.layout}: sanitizatsiya barqaror emas`);
  }
});

test("ownAssetUrlRe: begona genId regexga sizib kirmaydi", () => {
  assert.equal(ownAssetUrlRe(GEN).test(ASSET), true);
  assert.equal(ownAssetUrlRe("a.*").test("/api/generations/boshqa/assets/aaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(ownAssetUrlRe(GEN).test(`${ASSET}/../../x`), false);
});

// ═══════════════════════════════════════════ 7. parseDocOps

test("parse: to'g'ri tana DocOp[] ga aylanadi", () => {
  const r = parseDocOps([{ op: "text", index: 0, src: { f: "bullets", i: 1 }, value: "Matn" }]);
  assert.equal(r.ok, true);
  assert.deepEqual((r as { ops: DocOp[] }).ops[0], { op: "text", index: 0, src: { f: "bullets", i: 1 }, value: "Matn" });
});

test("parse: __proto__ rad etiladi", () => {
  const raw = JSON.parse('[{"op":"set","index":0,"slide":{"layout":"bullets","title":"T","__proto__":{"admin":true}}}]');
  const r = parseDocOps(raw);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Taqiqlangan kalit/);
});

test("parse: chart:\"yes\" — TIP xatosi, jim tashlanmaydi", () => {
  const r = parseDocOps([{ op: "set", index: 0, slide: { layout: "stats", title: "T", chart: "yes" } }]);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /slide/);
  assert.equal(parseDocOps([{ op: "set", index: 0, slide: { layout: "stats", title: "T", chart: true } }]).ok, true);
});

test("parse: 51 operatsiya va 4000+ belgi rad etiladi", () => {
  const one = { op: "notes", index: 0, value: "x" };
  assert.equal(parseDocOps(Array.from({ length: 50 }, () => one)).ok, true);
  assert.equal(parseDocOps(Array.from({ length: 51 }, () => one)).ok, false);
  assert.equal(parseDocOps([{ op: "notes", index: 0, value: "a".repeat(4001) }]).ok, false);
  assert.equal(parseDocOps([]).ok, false);
  assert.equal(parseDocOps({ op: "notes" }).ok, false);
});

test("parse: shakl tekshiruvi — src, index, layout, order", () => {
  assert.equal(parseDocOps([{ op: "text", index: 0, src: { f: "bullets" }, value: "x" }]).ok, false, "i yo'q");
  assert.equal(parseDocOps([{ op: "text", index: "0", src: { f: "title" }, value: "x" }]).ok, false, "index matn");
  assert.equal(parseDocOps([{ op: "text", index: 0, src: { f: "yo‘q" }, value: "x" }]).ok, false, "noma'lum manba");
  assert.equal(parseDocOps([{ op: "layout", index: 0, layout: "hacker" }]).ok, false);
  assert.equal(parseDocOps([{ op: "reorder", order: [0, "1"] }]).ok, false);
  assert.equal(parseDocOps([{ op: "drop", index: 0 }]).ok, false, "noma'lum operatsiya");
  assert.equal(parseDocOps([{ op: "add", after: -1 }]).ok, true, "boshiga qo'shish (-1) ruxsat");
});

// ═══════════════════════════════════════════ 8. canConvert chip'lari

test("canConvert: shu slaydda mumkin bo'lmagan o'girish sababi bor", () => {
  const r = canConvert(bullets, "table");
  assert.equal(r.ok, false);
  assert.equal(typeof (r as { reason: string }).reason, "string");
  assert.notEqual((r as { reason: string }).reason, "");
});

// ═══════════════════════════════════════════ 9. `list` op — butun ro'yxat (PowerPoint kabi quti)

test("list: butun ro'yxat almashadi, bo'sh bandlar tashlanadi, har band chegaraga qisqaradi", () => {
  const doc = docOf([bullets]);
  const long = "x".repeat(rules.bulletChars + 50);
  const next = apply(doc, [{ op: "list", index: 0, field: "bullets", items: ["Yangi bir", "  ", "", "Yangi ikki", long] }]);
  const list = next.slides![0].bullets!;
  assert.deepEqual(list.slice(0, 2), ["Yangi bir", "Yangi ikki"], "bo'sh/faqat bo'shliq bandlar o'chadi");
  assert.equal(list.length, 3);
  assert.ok(list[2].length <= rules.bulletChars, "uzun band chegaraga qisqaradi");
  // Bo'sh ro'yxat ham mumkin — foydalanuvchi hamma bandni o'chirdi.
  assert.deepEqual(apply(doc, [{ op: "list", index: 0, field: "bullets", items: [] }]).slides![0].bullets, []);
});

test("list: band soni chegaradan oshsa 422 — hech narsa qo'llanmaydi", () => {
  const doc = docOf([bullets]);
  const tooMany = Array.from({ length: rules.maxBullets + 1 }, (_, i) => `Band ${i}`);
  const f = failure(doc, [{ op: "list", index: 0, field: "bullets", items: tooMany }]);
  assert.match(f.error, /tadan ortiq band/);
  assert.equal(f.at, 0);
  const max = Array.from({ length: rules.maxBullets }, (_, i) => `Band ${i}`);
  assert.equal(apply(doc, [{ op: "list", index: 0, field: "bullets", items: max }]).slides![0].bullets!.length, rules.maxBullets);
});

test("list: ustunlar `colItems`/`colItem` chegarasi bilan, maketda yo'q maydon — xato", () => {
  const doc = docOf([twoCol, bullets]);
  const left = apply(doc, [{ op: "list", index: 0, field: "left", items: ["A", "B", "C"] }]);
  assert.deepEqual(left.slides![0].left, ["A", "B", "C"]);
  assert.deepEqual(left.slides![0].right, ["R1"], "boshqa ustun tegilmaydi");
  const five = ["1", "2", "3", "4", "5"].slice(0, SLIDE_LIMITS.colItems + 1);
  assert.match(failure(doc, [{ op: "list", index: 0, field: "right", items: five }]).error, /tadan ortiq band/);
  assert.match(failure(doc, [{ op: "list", index: 1, field: "left", items: ["x"] }]).error, /ustun yo'q/);
  assert.match(failure(doc, [{ op: "list", index: 0, field: "bullets", items: ["x"] }]).error, /bandlar yo'q/);
  assert.match(failure(doc, [{ op: "list", index: 0, field: "steps" as never, items: [] }]).error, /Noma'lum ro'yxat/);
});

test("list: teskarisi — butun slayd (`set`), aylanma tenglik", () => {
  const doc = docOf([bullets, twoCol]);
  roundTrip(doc, [{ op: "list", index: 0, field: "bullets", items: ["Faqat bitta"] }], "list bullets");
  roundTrip(doc, [{ op: "list", index: 1, field: "right", items: [] }], "list right (bo'sh)");
});

test("parse: list — field ro'yxatdan, items matnlar massivi", () => {
  const ok = parseDocOps([{ op: "list", index: 0, field: "left", items: ["a", "b"] }]);
  assert.equal(ok.ok, true);
  assert.deepEqual((ok as { ops: DocOp[] }).ops[0], { op: "list", index: 0, field: "left", items: ["a", "b"] });
  assert.equal(parseDocOps([{ op: "list", index: 0, field: "steps", items: [] }]).ok, false, "steps ro'yxat maydoni emas");
  assert.equal(parseDocOps([{ op: "list", index: 0, field: "bullets", items: "a" }]).ok, false, "items massiv bo'lsin");
  assert.equal(parseDocOps([{ op: "list", index: 0, field: "bullets", items: ["a", 1] }]).ok, false, "faqat matnlar");
  assert.equal(parseDocOps([{ op: "list", field: "bullets", items: [] }]).ok, false, "index shart");
});

// ═══════════════════════════════════════════ 10. Asl rasm (`imageOrig`) va `imageRestore`

test("image: o'chirish/almashtirish ASL rasmni `imageOrig` ga ko'chiradi — faqat BIRINCHI marta", () => {
  const orig = { url: ASSET, alt: "Asl" };
  const doc = docOf([{ ...bullets, image: orig }]);
  const removed = apply(doc, [{ op: "image", index: 0, url: null }]);
  assert.equal("image" in removed.slides![0], false);
  assert.deepEqual(removed.slides![0].imageOrig, orig, "«Rasmsiz» asl rasmni saqlab qo'yadi");

  const other = `/api/generations/${GEN}/assets/${"cd".repeat(12)}`;
  const replaced = apply(doc, [{ op: "image", index: 0, url: other }]);
  assert.deepEqual(replaced.slides![0].image, { url: other });
  assert.deepEqual(replaced.slides![0].imageOrig, orig, "o'z rasmi qo'yilganda ham asl saqlanadi");

  // Ikkinchi almashtirish aslni USTIDAN YOZMAYDI — foydalanuvchi doim AI rasmga qaytoladi.
  const third = `/api/generations/${GEN}/assets/${"ef".repeat(12)}`;
  const again = apply(replaced, [{ op: "image", index: 0, url: third }]);
  assert.deepEqual(again.slides![0].imageOrig, orig);
  const removedAgain = apply(replaced, [{ op: "image", index: 0, url: null }]);
  assert.deepEqual(removedAgain.slides![0].imageOrig, orig);

  // Rasmi yo'q slaydga rasm qo'yish `imageOrig` yaratmaydi (qaytaradigan narsa yo'q).
  const fresh = apply(docOf([bullets]), [{ op: "image", index: 0, url: other }]);
  assert.equal("imageOrig" in fresh.slides![0], false);
});

test("imageRestore: asl rasm qaytadi va `imageOrig` o'chadi; asl bo'lmasa xato", () => {
  const orig = { url: ASSET, alt: "Asl" };
  const doc = docOf([{ ...bullets, image: orig }]);
  const removed = apply(doc, [{ op: "image", index: 0, url: null }]);
  const restored = apply(removed, [{ op: "imageRestore", index: 0 }]);
  assert.deepEqual(restored.slides![0].image, orig);
  assert.equal("imageOrig" in restored.slides![0], false, "qaytarilgach asl nusxa kerak emas");
  assert.deepEqual(restored, doc, "qaytarish aynan boshlang'ich hujjatni beradi");
  assert.match(failure(docOf([bullets]), [{ op: "imageRestore", index: 0 }]).error, /asl rasm yo'q/);
  // Rasmsiz maketga ko'chgan slaydda ham qaytarib bo'lmaydi (rasm hech qayerda chizilmasdi).
  const noSlot = docOf([{ ...quiz, imageOrig: orig }]);
  assert.match(failure(noSlot, [{ op: "imageRestore", index: 0 }]).error, /rasm joyi yo'q/);
});

test("imageRestore: teskarisi `set` — aylanma tenglik; parse index talab qiladi", () => {
  const doc = docOf([{ ...bullets, image: { url: ASSET } }]);
  roundTrip(doc, [{ op: "image", index: 0, url: null }], "image null (imageOrig bilan)");
  roundTrip(apply(doc, [{ op: "image", index: 0, url: null }]), [{ op: "imageRestore", index: 0 }], "imageRestore");
  const p = parseDocOps([{ op: "imageRestore", index: 2 }]);
  assert.deepEqual((p as { ops: DocOp[] }).ops, [{ op: "imageRestore", index: 2 }]);
  assert.equal(parseDocOps([{ op: "imageRestore" }]).ok, false);
});

test("sanitize/shape: `imageOrig` faqat O'Z aktividan, shakli `image` kabi tekshiriladi", () => {
  const own = sanitizeSlideModel({ layout: "bullets", title: "T", imageOrig: { url: ASSET, alt: "a" } }, GEN, rules);
  assert.deepEqual(own?.imageOrig, { url: ASSET, alt: "a" });
  const alien = sanitizeSlideModel({ layout: "bullets", title: "T", imageOrig: { url: "https://evil.example/a.png" } }, GEN, rules);
  assert.equal(alien?.imageOrig, undefined);
  assert.equal(parseDocOps([{ op: "set", index: 0, slide: { layout: "bullets", title: "T", imageOrig: { url: 5 } } }]).ok, false, "url matn bo'lsin");
  assert.equal(parseDocOps([{ op: "set", index: 0, slide: { layout: "bullets", title: "T", imageOrig: "x" } }]).ok, false);
});
