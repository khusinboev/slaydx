import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { slideLabels } from "../lib/generation/i18n.ts";
import {
  applyDocOps,
  canConvert,
  convertLayout,
  inverseOps,
  newSlide,
  ownAssetUrlRe,
  parseDocOps,
  readSlideField,
  sanitizeSlideModel,
  writeSlideField,
  TIGHT_IMAGE_ERROR,
  type DocOp,
  type EditRules,
} from "../lib/generation/slide-edit.ts";
import { photoSlot } from "../lib/generation/slide-layout.ts";
import { CLIP_FLOOR_CHARS, NO_IMAGE, SLIDE_LIMITS, clipLimit, fitChars, limitsFor } from "../lib/generation/slide-limits.ts";
import { imageYieldField } from "../lib/generation/slide-quality.ts";
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

// AUDIT-25 P3 W7: `school_1_4` (pol 24 pt) — eng tor auditoriya, `rules` (yuqorida) esa `lecture`
// shabloni orqali standart bakalavr (pol 15 pt) — eng keng. Ikkalasi ham `bodyType` orqali,
// `applyDocOps`ning o'zi ishlatgan YO'Ldan (`buildSlideDeck(doc).bodyType`).
const schoolMeta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture", slideAudience: "school_1_4" } as never);
function schoolRawDoc(slides: SlideModel[]): AcademicDoc {
  return { meta: schoolMeta, titlePage: true, toc: true, sections: [], slides, slideTemplate: "lecture" };
}
const schoolRules: EditRules = buildSlideDeck(schoolRawDoc([{ id: "s0", layout: "bullets", title: "x" }])).bodyType;

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

// AUDIT-25 P7: `layout` op `convertLayout` → `baseOf` orqali slaydni QAYTA quradi — `plan` shu
// oq-ro'yxatdan ham tushib qolmasligi kerak (bo'lim raqami maket o'zgarganda ham saqlanadi).
test("apply: maket o'girilganda reja bandi (plan) saqlanadi", () => {
  const doc = docOf([{ ...bullets, plan: 2 }]);
  const conv = apply(doc, [{ op: "layout", index: 0, layout: "process" }]);
  assert.equal(conv.slides![0].plan, 2, "layout op plan ni tashlab yubordi");
});

// `convertLayout` ning YALANG'OCH tana/subtitle shoxobchasi (`title`/`quote` → `section`/`closing`)
// ham `baseOf` orqali quriladi — shu yo'l alohida sinaladi (bullets→process yuqorida stats/steps
// shoxobchasidan o'tadi, bu esa oxirgi `{...base, subtitle}` shoxobchasidan).
test("apply: title→section o'girilganda ham reja bandi (plan) saqlanadi", () => {
  const doc = docOf([{ id: "s0", layout: "title", title: "Muqova", plan: 4 }]);
  const conv = apply(doc, [{ op: "layout", index: 0, layout: "section" }]);
  assert.equal(conv.slides![0].plan, 4, "title→section (bare-base/subtitle shoxobchasi) plan ni tashlab yubordi");
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

// AUDIT-25 P7 — DEFEKT: ko'ruvchi bandni tahrirlaganda («matn tahrirlagichdan chiqish»)
// klient BUTUN slaydni {op:"set", slide} bilan qaytaradi — `plan` shu yo'lda YO'QOLARDI,
// chunki `sanitizeSlideModel` oq-ro'yxatda yo'q edi. `insert` (masalan slaydni nusxalash /
// undo orqali qaytarish) ham xuddi shu yo'ldan o'tadi.
test("apply: set/insert reja bandini (plan) yo'qotmaydi", () => {
  const doc = docOf([{ ...bullets, plan: 3 }]);
  const edited = apply(doc, [{ op: "set", index: 0, slide: { ...doc.slides![0], title: "Tahrirlangan" } }]);
  assert.equal(edited.slides![0].plan, 3, "«set» plan ni tashlab yubordi");
  assert.equal(edited.slides![0].title, "Tahrirlangan");

  const ins = apply(doc, [{ op: "insert", index: 1, slide: { id: "sX", layout: "bullets", title: "Kirdi", bullets: ["B."], plan: 1 } }]);
  assert.equal(ins.slides![1].plan, 1, "«insert» plan ni tashlab yubordi");
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

// AUDIT-25 P7: undo — reja bandi (plan) bo'lgan slaydda ham aylanma tenglik saqlanishi kerak
// (teskari `set` `sanitizeSlideModel` orqali o'tadi — aynan shu yerda `plan` yo'qolgan bo'lardi).
test("inverse: reja bandi (plan) bo'lgan slaydda undo aylanma tengligi", () => {
  const doc = docOf([{ ...bullets, plan: 3 }, table]);
  roundTrip(doc, [{ op: "text", index: 0, src: { f: "title" }, value: "Yangi sarlavha" }], "text (plan bilan)");
  roundTrip(doc, [{ op: "layout", index: 0, layout: "process" }], "layout (plan bilan)");
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

// AUDIT-25 P7: `plan` (reja bandi, 1-asosli) oq-ro'yxatdan TUSHIB QOLMASLIGI kerak —
// aks holda ko'ruvchida "set"/"insert" bilan tahrirlangan slaydning agenda↔plan bog'i uziladi.
test("sanitize: reja bandi (plan) saqlanadi, yaroqsiz qiymat tashlanadi", () => {
  const kept = sanitizeSlideModel({ layout: "bullets", title: "T", bullets: ["B"], plan: 3 }, GEN, rules);
  assert.equal(kept?.plan, 3, "musbat butun son saqlanishi kerak");
  for (const bad of [0, -1, 1.5, "3", 100, NaN, Infinity]) {
    const s = sanitizeSlideModel({ layout: "bullets", title: "T", bullets: ["B"], plan: bad }, GEN, rules);
    assert.equal(s?.plan, undefined, `yaroqsiz plan (${bad}) tashlanishi kerak edi`);
  }
  // Chegara: 99 saqlanadi, 100 tashlanadi.
  assert.equal(sanitizeSlideModel({ layout: "bullets", title: "T", plan: 99 }, GEN, rules)?.plan, 99);
  // Idempotent: ikkinchi marta sanitizatsiya qilinganda plan yo'qolmaydi.
  assert.equal(sanitizeSlideModel(kept, GEN, rules)?.plan, 3);
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

// AUDIT-25 P7: `plan` klient JSON dan `slideShapeOk` tip tekshiruvidan o'tishi kerak —
// noto'g'ri TIP (satr) 400 bilan rad etiladi, to'g'ri son esa qabul qilinadi.
test("parse: plan:\"3\" — TIP xatosi, son esa qabul qilinadi", () => {
  const bad = parseDocOps([{ op: "set", index: 0, slide: { layout: "bullets", title: "T", plan: "3" } }]);
  assert.equal(bad.ok, false);
  assert.match((bad as { error: string }).error, /slide/);
  assert.equal(parseDocOps([{ op: "set", index: 0, slide: { layout: "bullets", title: "T", plan: 3 } }]).ok, true);
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

// ═══════════════════════════════════════════ 11. AUDIT-25 P3 W7 — tahrir `limitsFor` bilan

/*
 * P3 gacha `slide-edit.ts` faqat STATIK `SLIDE_LIMITS` bilan qirqardi
 * (masalan `stepText: 160`). P3 dan keyin haqiqiy chegara auditoriya
 * shrift POLI (`minPt`) × element SONIga bog'liq (`limitsFor`,
 * `slide-limits.ts`) — generatsiya shu jadvaldan yozadi, lekin tahrir
 * eski statik qopqoqni ishlatishda davom etardi: maktab (24 pt, 3
 * bosqich) qutisiga 150 belgi sig'maydi, lekin `writeSlideField` uni
 * to'liq qabul qilardi — «ko'rdim = oldim» buzilardi (CLAUDE.md).
 *
 * P7 review (W7 CHANGES 1) buni ikkiga ajratdi — ikki kanal, ikki qoida:
 *
 *   (a) `writeSlideField` — foydalanuvchi BITTA maydonni tahrirlaydi.
 *       Chegara `editLimit(limitsFor(...), staticCap, ESKI_UZUNLIK)` —
 *       auditoriya poli YANGI matnni torroq qiladi, lekin ESKI (statik
 *       qopqoqqacha) uzunlikdan QISQARTIRMAYDI. Quyidagi testlarda "yangi
 *       matn" holatlari (eski qiymat bo'sh/qisqa) hamon auditoriya
 *       chegarasiga aynan tushadi — maktab tor, bakalavr keng.
 *   (b) `sanitizeSlideModel` — `set`/`insert` orqali undo/redo/qaytarish
 *       YO'LI. Bu XAVFSIZLIK filtri (oq-ro'yxat, uzunlik/son tavan
 *       qopqog'i), MOSLASHISH siyosati emas — auditoriyadan MUSTAQIL,
 *       doim STATIK `SLIDE_LIMITS` (masalan bitta "Izoh" tahriri +
 *       undo bakalavr 5-bosqichli/5×6 jadvalli slaydni qisqartirmasin).
 *
 * Agar (a) da `editLimit` olib tashlansa (faqat `limitsFor`), mavjud uzun
 * matn ham qisqaradi — pastdagi "109 belgi saqlanadi" testi ushlaydi.
 * Agar (b) ga `limitsFor`/`rules.*Max` qaytarilsa, undo round-trip testi
 * (`roundTrip`, `deepEqual`) ushlaydi.
 */

test("write: bosqich matni auditoriya POLI × SONI bo'yicha qirqiladi (`limitsFor`) — maktab tor, bakalavr keng", () => {
  const twoSteps: SlideModel = {
    id: "s0",
    layout: "process",
    title: "Bosqichlar",
    steps: [
      { n: "1", title: "Bir", text: "" },
      { n: "2", title: "Ikki", text: "" },
    ],
  };
  const long = "a".repeat(150);

  const schoolLim = limitsFor(schoolRules, { steps: twoSteps.steps!.length });
  const schoolResult = writeSlideField(twoSteps, { f: "steps", i: 0, k: "text" }, long, schoolRules);
  assert.equal(schoolResult.ok, true);
  const schoolText = (schoolResult as { slide: SlideModel }).slide.steps![0].text;
  assert.equal(schoolText.length, schoolLim.stepText, "maktab poli chegarasiga aynan qisqarishi kerak");
  assert.ok(schoolLim.stepText < SLIDE_LIMITS.stepText, "maktab chegarasi statik qopqoqdan tor (150 belgi eskicha 'qabul qilinardi')");

  const bachLim = limitsFor(rules, { steps: twoSteps.steps!.length });
  const bachResult = writeSlideField(twoSteps, { f: "steps", i: 0, k: "text" }, long, rules);
  const bachText = (bachResult as { slide: SlideModel }).slide.steps![0].text;
  assert.equal(bachText.length, bachLim.stepText, "bakalavr poli chegarasiga aynan qisqarishi kerak");
  assert.ok(bachLim.stepText > schoolLim.stepText, "bakalavr chegarasi maktabnikidan KATTA bo'lishi kerak (auditoriya poli)");
  assert.ok(bachLim.stepText <= SLIDE_LIMITS.stepText, "hech qaysi auditoriya statik qopqoqdan oshmaydi");
});

test("write: bosqich sarlavhasi ham `limitsFor` bo'yicha (stepTitle)", () => {
  const twoSteps: SlideModel = {
    id: "s0",
    layout: "process",
    title: "Bosqichlar",
    steps: [
      { n: "1", title: "", text: "Matn" },
      { n: "2", title: "Ikki", text: "" },
    ],
  };
  const long = "b".repeat(80);
  const schoolLim = limitsFor(schoolRules, { steps: twoSteps.steps!.length });
  const r = writeSlideField(twoSteps, { f: "steps", i: 0, k: "title" }, long, schoolRules);
  assert.equal((r as { slide: SlideModel }).slide.steps![0].title.length, schoolLim.stepTitle);
  assert.ok(schoolLim.stepTitle < SLIDE_LIMITS.stepTitle);
});

test("write: yorliq (statLabel) auditoriya POLI × karta SONI bo'yicha qirqiladi", () => {
  const two: SlideModel = { id: "s3", layout: "stats", title: "Raqamlar", stats: [{ value: "95%", label: "" }, { value: "12", label: "" }] };
  const long = "c".repeat(150);
  const schoolLim = limitsFor(schoolRules, { stats: two.stats!.length });
  const r = writeSlideField(two, { f: "stats", i: 0, k: "label" }, long, schoolRules);
  assert.equal((r as { slide: SlideModel }).slide.stats![0].label.length, schoolLim.statLabel);
  assert.ok(schoolLim.statLabel <= SLIDE_LIMITS.statLabel);
});

test("write: jadval katak/sarlavha auditoriya POLI × O'LCHAM bo'yicha qirqiladi", () => {
  const t: SlideModel = { id: "s1", layout: "table", title: "Jadval", table: { headers: ["A", "B"], rows: [["", ""], ["", ""]] } };
  const long = "d".repeat(120);
  const cellLim = limitsFor(schoolRules, { cols: 2, rows: 2 });
  const cellR = writeSlideField(t, { f: "table", k: "cell", r: 0, c: 0 }, long, schoolRules);
  assert.equal((cellR as { slide: SlideModel }).slide.table!.rows[0][0].length, cellLim.tableCell);
  assert.ok(cellLim.tableCell <= SLIDE_LIMITS.tableCell);

  const headR = writeSlideField(t, { f: "table", k: "header", c: 0 }, long, schoolRules);
  assert.equal((headR as { slide: SlideModel }).slide.table!.headers[0].length, cellLim.tableHeaderWide);
  assert.ok(cellLim.tableHeaderWide <= SLIDE_LIMITS.tableHeaderWide);
});

test("write: test varianti auditoriya POLI bo'yicha qirqiladi (`limitsFor(...).quizOption`) — son emas, pol", () => {
  const q: SlideModel = { id: "s2", layout: "quiz", title: "Test", quiz: [{ q: "Savol?", options: ["A", "B", "C", "D"], answer: 0 }] };
  const long = "e".repeat(200);
  const schoolLim = limitsFor(schoolRules).quizOption;
  const bachLim = limitsFor(rules).quizOption;
  const schoolR = writeSlideField(q, { f: "quiz", i: 0, k: "option", j: 1 }, long, schoolRules);
  const bachR = writeSlideField(q, { f: "quiz", i: 0, k: "option", j: 1 }, long, rules);
  assert.equal((schoolR as { slide: SlideModel }).slide.quiz![0].options[1].length, schoolLim);
  assert.equal((bachR as { slide: SlideModel }).slide.quiz![0].options[1].length, bachLim);
  assert.ok(schoolLim < bachLim, "maktab quti bakalavrnikidan tor");
  assert.ok(bachLim <= SLIDE_LIMITS.quizOption, "statik qopqoqdan oshmaydi");
});

// P7 review (W7 CHANGES 1b): `sanitizeSlideModel` XAVFSIZLIK filtri — auditoriyadan MUSTAQIL,
// doim STATIK `SLIDE_LIMITS`. school_1_4 va bakalavr BIR XIL natija berishi kerak.
test("sanitize: 5-bosqichli tahrir STATIK qopqoqqa saqlanadi — auditoriyaga QARAB QISQARTIRILMAYDI (undo xavfsizlik filtri)", () => {
  const raw = {
    layout: "process",
    title: "Besh bosqich",
    steps: Array.from({ length: 5 }, (_, i) => ({ n: String(i + 1), title: `B${i + 1}`, text: "Matn" })),
  };
  const school = sanitizeSlideModel(raw, GEN, schoolRules);
  assert.equal(school?.steps?.length, SLIDE_LIMITS.stepsMax, "STATIK qopqoq (5) — school_1_4 ning tor stepsMax (3) EMAS");
  assert.ok(schoolRules.stepsMax < SLIDE_LIMITS.stepsMax, "aks holda bu test hech narsani sinamaydi (ikkalasi bir xil chiqib qolardi)");

  const bach = sanitizeSlideModel(raw, GEN, rules);
  assert.equal(bach?.steps?.length, SLIDE_LIMITS.stepsMax, "bakalavr ham xuddi shu statik qopqoqni oladi — ikkalasi TENG");
});

test("sanitize: stats/table SONI ham STATIK qopqoqqa saqlanadi, matn STATIK uzunlikka (auditoriyadan mustaqil)", () => {
  const rawStats = {
    layout: "stats",
    title: "Raqamlar",
    stats: Array.from({ length: 6 }, (_, i) => ({ value: `${i + 1}%`, label: "x".repeat(150) })),
  };
  const school = sanitizeSlideModel(rawStats, GEN, schoolRules);
  const bach = sanitizeSlideModel(rawStats, GEN, rules);
  assert.equal(school?.stats?.length, SLIDE_LIMITS.statsMax, "STATIK statsMax (4) — school_1_4 ning tor 3 EMAS");
  assert.equal(bach?.stats?.length, SLIDE_LIMITS.statsMax, "bakalavr bilan TENG natija");
  assert.equal(school?.stats?.[0].label.length, SLIDE_LIMITS.statLabel, "yorliq STATIK statLabel (110) ga qirqiladi, auditoriya limitiga emas");
  assert.deepEqual(school, bach, "sanitizeSlideModel natijasi ikkala auditoriyada AYNAN bir xil");

  const rawTable = {
    layout: "table",
    title: "Jadval",
    table: {
      headers: Array.from({ length: 6 }, (_, i) => `Ustun ${i + 1}`),
      rows: Array.from({ length: 8 }, () => Array.from({ length: 6 }, () => "y".repeat(100))),
    },
  };
  const t = sanitizeSlideModel(rawTable, GEN, schoolRules);
  assert.equal(t?.table?.headers.length, SLIDE_LIMITS.tableCols, "STATIK tableCols (5) — school_1_4 ning tor 3 EMAS");
  assert.equal(t?.table?.rows.length, SLIDE_LIMITS.tableRows, "STATIK tableRows (6) — school_1_4 ning tor 4 EMAS");
});

// ═══════════════════════════════════════════ 12. AUDIT-25 P7 W7 CHANGES 1(b) — tahrir mavjud kontentni qisqartirmaydi

/*
 * P7 reviewer probesi: bakalavr `lecture` dekasida 5 bosqich × 109 belgi (process) va 5×6 jadval
 * BOR (masalan P1 to'liq joylashguncha yaratilgan yoki bachelor auditoriyasi static qopqoq bilan
 * yozilgan eski hujjat). `limitsFor(bachelor,{steps:5}).stepText` = 30 — bu ANIQ 109 dan tor,
 * shuning uchun quyidagi testlar `editLimit`/statik-safety-filter YO'Q bo'lsa aynan shu joyda
 * qizarardi (109 → ~30, 5 bosqich → 4, 5×6 → 4×5).
 */
const FIVE_STEP_TEXT = "a".repeat(109);
function fiveStepSlide(): SlideModel {
  return {
    id: "s0",
    layout: "process",
    title: "Besh bosqich",
    steps: Array.from({ length: 5 }, (_, i) => ({ n: String(i + 1), title: `Bosqich ${i + 1}`, text: FIVE_STEP_TEXT })),
  };
}
function bigTableSlide(): SlideModel {
  return {
    id: "s1",
    layout: "table",
    title: "Katta jadval",
    table: {
      headers: Array.from({ length: 5 }, (_, i) => `Ustun ${i + 1}`),
      rows: Array.from({ length: 6 }, (_, r) => Array.from({ length: 5 }, (_, c) => `${r}${c}`)),
    },
  };
}

test("sanity: bakalavr auditoriyasida limitsFor(steps:5) 109 belgidan TOR — aks holda pastdagi testlar bo'sh", () => {
  assert.ok(limitsFor(rules, { steps: 5 }).stepText < 109);
  assert.ok(rules.stepsMax < 5, "bakalavr countRules ham 5 bosqichni ruxsat bermaydi (4 tagacha) — bu «eski hujjat» stsenariysi");
});

test("undo round trip: bakalavr 5-bosqichli (109 belgi) + 5×6 jadvalli deka HECH narsani qisqartirmaydi (P7 review probesi, deepEqual)", () => {
  const doc = docOf([fiveStepSlide(), bigTableSlide()]);
  // Ikkala slaydga ham tegmaydigan op (notes) + undo — deka AYNAN qaytishi kerak.
  roundTrip(
    doc,
    [
      { op: "notes", index: 0, value: "Izoh (process)" },
      { op: "notes", index: 1, value: "Izoh (jadval)" },
    ],
    "notes + undo — 5 bosqich/5×6 jadval saqlansin",
  );
  // roundTrip allaqachon deepEqual qildi; qo'shimcha — asl hujjatning o'zi ham 5/5×6 ekanini tasdiqlaymiz.
  assert.equal(doc.slides![0].steps?.length, 5);
  assert.equal(doc.slides![0].steps?.[0].text.length, 109);
  assert.equal(doc.slides![1].table?.headers.length, 5);
  assert.equal(doc.slides![1].table?.rows.length, 6);
});

test("write: 5-bosqichli bakalavr slaydida 1-bosqichdagi TIPO tuzatish 109 belgini SAQLAYDI (editLimit)", () => {
  const slide = fiveStepSlide();
  // Tipo: 50-belgidan keyin bitta harf almashtirildi, uzunlik O'ZGARMAYDI.
  const typo = `${FIVE_STEP_TEXT.slice(0, 50)}X${FIVE_STEP_TEXT.slice(51)}`;
  assert.equal(typo.length, 109);
  const r = writeSlideField(slide, { f: "steps", i: 0, k: "text" }, typo, rules);
  assert.equal(r.ok, true);
  const text = (r as { slide: SlideModel }).slide.steps![0].text;
  assert.equal(text, typo, "tipo tuzatilgan matn qirqilmasdan saqlanadi");
  assert.equal(text.length, 109, "mavjud uzunlikdan (109) qisqarmaydi — auditoriya limitiga (30) emas");
});

test("convertLayout: bullets→process/stats ham auditoriya POLI bo'yicha qirqiladi va SONga qisqaradi", () => {
  const longBullets: SlideModel = {
    id: "s0",
    layout: "bullets",
    title: "Bandlar",
    bullets: Array.from({ length: 5 }, (_, i) => `${i + 1}% — ${"z".repeat(150)}`),
  };
  const proc = convertLayout(longBullets, "process", schoolRules);
  assert.equal(proc.ok, true);
  const steps = (proc as { slide: SlideModel }).slide.steps!;
  assert.ok(steps.length <= schoolRules.stepsMax, "school_1_4 stepsMax dan ortiq bosqich chiqmasin");
  const stepLim = limitsFor(schoolRules, { steps: steps.length });
  for (const st of steps) assert.ok(st.text.length <= stepLim.stepText, "har bosqich matni SHU songa mos chegarada");

  const st = convertLayout(longBullets, "stats", schoolRules);
  assert.equal(st.ok, true);
  const stats = (st as { slide: SlideModel }).slide.stats!;
  assert.ok(stats.length <= schoolRules.statsMax, "school_1_4 statsMax dan ortiq karta chiqmasin");
  const statLim = limitsFor(schoolRules, { stats: stats.length });
  for (const x of stats) assert.ok(x.label.length <= statLim.statLabel, "har yorliq SHU songa mos chegarada");
});

// ═══════════════════════════════════════════ 13. AUDIT-25 P11 — tahrir deka VIZUALI va RASM holatiga ergashadi

/*
 * P11: `applyDocOps` `limitsFor` ga deka vizualini (`buildSlideDeck(doc).visual`) va slaydning
 * rasm holatini beradi. 8–9 sinf `circle` 3 bosqich: rasmsiz quti 121 belgi, rasm bilan 42;
 * ilgari tahrir doim zaxira jadvalni (45) olardi — generatsiya 100 belgi yozgan bosqichni
 * foydalanuvchi qayta yoza olmasdi. Rasmli slayd esa rasm yonidagi qutiga (42) qirqiladi.
 * MUTATSIYA: `editLimits` `images` ni tashlasa (doim "both") — rasmsiz slayd 42 ga qirqiladi, qizaradi;
 * `applyDocOps` `visual` bermasa — ikkalasi ham 45 (jadval), qizaradi.
 */
const g89Meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture", slideAudience: "school_8_9" } as never);
function circleDoc(slides: SlideModel[]): AcademicDoc {
  return { meta: g89Meta, titlePage: true, toc: true, sections: [], slides, slideTemplate: "lecture", slideVisual: "circle" };
}
/** ~100 belgi — real o'zbekcha bosqich matni. */
const STEP100 = "Quyosh issiqligi suvni bug‘ga aylantiradi, bug‘ esa havoda sovib bulut hosil qiladi va yomg‘ir yog‘adi";
function threeSteps(image: boolean, text = ""): SlideModel {
  return {
    id: "s0",
    layout: "process",
    title: "Suv aylanishi",
    steps: [1, 2, 3].map((i) => ({ n: String(i), title: `Bosqich ${i}`, text })),
    ...(image ? { image: { url: ASSET } } : {}),
  };
}

test("P11 (b): circle 8–9 sinf — rasmsiz bosqich ~100 belgini qabul qiladi, rasmli — rasm yonidagi quti (42)", () => {
  const deck = buildSlideDeck(circleDoc([threeSteps(false)]));
  assert.equal(deck.visual, "circle");
  assert.equal(deck.bodyType.minPt, 20);
  const src = { f: "steps", i: 0, k: "text" } as const;
  const edited = applyDocOps(
    circleDoc([threeSteps(false), threeSteps(true)]),
    [
      { op: "text", index: 0, src, value: STEP100 },
      { op: "text", index: 1, src, value: STEP100 },
    ],
    ctx,
  );
  assert.equal(edited.ok, true, edited.ok ? "" : edited.error);
  const [plain, pictured] = (edited as { ok: true; doc: AcademicDoc }).doc.slides!;
  assert.equal(plain.steps![0].text, STEP100, "rasmsiz slayd: rasmsiz quti (121) — 100 belgi qirqilmaydi");
  const withImage = limitsFor(deck.bodyType, { steps: 3 }, { visual: "circle", images: "both" }).stepText;
  assert.equal(withImage, 42);
  /*
   * P11 sharhi 3: bosqich matni — GAP maydoni, rasmli slaydda ham RASMSIZ quti (jim «…» emas).
   * Rasm yonida sig'magani P12 qo'riqchisiga (`commitDocOps` → `imageYieldField`) aniq 400 bilan qoladi.
   * MUTATSIYA: `editLimits` da `stepText: none.stepText` olib tashlansa — rasmli slayd 42 ga qirqiladi, qizaradi.
   */
  assert.equal(pictured.steps![0].text, STEP100, "rasmli slayd: matn jim qirqilmaydi");
  assert.equal(imageYieldField(pictured, deck.bodyType, "circle"), "stepText", "rasm yonida sig'maydi — qo'riqchi yo'li");
});

test("P11 (b): rasmli slaydda tegilmagan uzun bosqich QISQARMAYDI, tipo tuzatish uzunlikni saqlaydi (W7 editLimit)", () => {
  // Rasmli slayd, bosqichlar allaqachon 100 belgi (masalan rasm keyin qo'yilgan) — rasmli quti 42 dan uzun.
  // Kanonik holat (renumber + sections) — `docOf` naqshi, lekin circle/8–9 sinf dekasi.
  const doc = apply(circleDoc([threeSteps(true, STEP100)]), [{ op: "reorder", order: [0] }]);
  const typo = `${STEP100.slice(0, 20)}X${STEP100.slice(21)}`;
  const r = applyDocOps(doc, [{ op: "text", index: 0, src: { f: "steps", i: 1, k: "text" }, value: typo }], ctx);
  assert.equal(r.ok, true);
  const steps = (r as { ok: true; doc: AcademicDoc }).doc.slides![0].steps!;
  assert.equal(steps[1].text, typo, "tahrirlangan bosqich eski uzunlikda saqlanadi");
  assert.equal(steps[0].text, STEP100, "tegilmagan bosqich o'zgarmaydi");
  assert.equal(steps[2].text, STEP100);
  // Undo aynan qaytaradi.
  roundTrip(doc, [{ op: "text", index: 0, src: { f: "steps", i: 1, k: "text" }, value: typo }], "P11 rasmli bosqich tipo");
});

test("P11 (b): vizualsiz chaqiruvchi (writeSlideField, qisman qoidalar) — zaxira jadval o'zgarmagan", () => {
  const g89Rules: EditRules = buildSlideDeck(circleDoc([threeSteps(false)])).bodyType;
  const r = writeSlideField(threeSteps(false), { f: "steps", i: 0, k: "text" }, STEP100, g89Rules);
  const lim = limitsFor(g89Rules, { steps: 3 }).stepText;
  assert.equal(lim, 45);
  assert.ok((r as { slide: SlideModel }).slide.steps![0].text.length <= lim);
  // Vizual berilsa — shu vizual o'lchovi.
  const v = writeSlideField(threeSteps(false), { f: "steps", i: 0, k: "text" }, STEP100, { ...g89Rules, visual: "circle" });
  assert.equal((v as { slide: SlideModel }).slide.steps![0].text, STEP100);
});

/*
 * P12 sharhi (2-band) + P11 sharhi (1b, 3): rasmli slaydda
 *   — YORLIQ maydoni (bosqich sarlavhasi, stats yorlig'i, katak, variant) — XOM rasmli quti (server
 *     qo'riqchisi ham xom `fitChars` bilan o'lchaydi); quti `CLIP_FLOOR_CHARS` dan tor bo'lib matn
 *     qirqilishi kerak bo'lsa — tahrir RAD etiladi (jim «Suv…» emas);
 *   — GAP maydoni (bosqich matni) — rasmsiz quti, jim qirqilmaydi; rasm yonida sig'masa — qo'riqchi 400.
 * MUTATSIYA: `tooTight` tekshiruvi olib tashlansa (sarlavha jim qirqiladi) yoki `raw: true` olib
 * tashlansa (24 poli — qo'riqchi rad etadigan 5–24 belgi qabul) — qizaradi.
 */
test("P12/P11 1b: rasmli rail 4 bosqich — sarlavha sig'masa RAD, qisqasi xom qutida; matn jim qirqilmaydi (qo'riqchi yo'li)", () => {
  const bachMeta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture", slideAudience: "students_bachelor" } as never);
  const railDoc = (slides: SlideModel[]): AcademicDoc => ({ meta: bachMeta, titlePage: true, toc: true, sections: [], slides, slideTemplate: "lecture", slideVisual: "rail" });
  const four: SlideModel = {
    id: "s0",
    layout: "process",
    title: "To‘rt bosqich",
    steps: ["A", "B", "C", "D"].map((t, i) => ({ n: String(i + 1), title: t, text: "" })),
    image: { url: ASSET },
  };
  const deck = buildSlideDeck(railDoc([four]));
  assert.equal(deck.visual, "rail");
  assert.equal(deck.bodyType.stepsMax, 4);
  const raw = fitChars("stepText", deck.bodyType, "rail", 4);
  assert.ok(raw < CLIP_FLOOR_CHARS, `sinov asosi: rasmli quti ${raw} < ${CLIP_FLOOR_CHARS}`);
  // Bosqich MATNI — gap maydoni: jim qirqilmaydi; rasm yonida sig'maydi → qo'riqchi (400) yo'li.
  const text = "Suv bug‘lanadi va bulut hosil qiladi";
  const r = applyDocOps(railDoc([four]), [{ op: "text", index: 0, src: { f: "steps", i: 0, k: "text" }, value: text }], ctx);
  assert.equal(r.ok, true);
  const s = (r as { ok: true; doc: AcademicDoc }).doc.slides![0];
  assert.equal(s.steps![0].text, text, "bosqich matni jim qirqilmadi");
  assert.equal(imageYieldField(s, deck.bodyType, "rail"), "stepText", "qo'riqchi aniq 400 beradi");
  // Bosqich SARLAVHASI — yorliq: xom rasmli quti tor (< 24) — uzun sarlavha RAD etiladi.
  const titleRaw = limitsFor(deck.bodyType, { steps: 4 }, { visual: "rail", images: "both", raw: true }).stepTitle;
  assert.ok(titleRaw < CLIP_FLOOR_CHARS, `sinov asosi: sarlavha qutisi ${titleRaw}`);
  const long = applyDocOps(railDoc([four]), [{ op: "text", index: 0, src: { f: "steps", i: 0, k: "title" }, value: "Bug‘lanish va kondensatsiya bosqichi" }], ctx);
  assert.equal(long.ok, false, "sarlavha jim «…» bilan qirqilmasligi kerak");
  assert.equal((long as { error: string }).error, TIGHT_IMAGE_ERROR);
  // Sig'adigan (qirqilmaydigan) qisqa qiymat — qabul qilinadi va qo'riqchi ham rad etmaydi.
  const fits = "Suv".slice(0, Math.max(1, titleRaw));
  const short = applyDocOps(railDoc([four]), [{ op: "text", index: 0, src: { f: "steps", i: 0, k: "title" }, value: fits }], ctx);
  assert.equal(short.ok, true, short.ok ? "" : short.error);
  assert.equal((short as { ok: true; doc: AcademicDoc }).doc.slides![0].steps![0].title, fits);
});

/*
 * P11 qayta sharhi: `list` op da eski uzunlik O'RIN bo'yicha edi — `[qisqa, uzun, …]` → `[uzun, qisqa, …]`
 * tartibini almashtirish ko'chgan uzun bandni qirqardi. Mavjud bandning aynan nusxasi — faqat ko'chirilgan.
 * MUTATSIYA: `prev.includes(v)` shoxobchasi olib tashlansa — qizaradi.
 */
test("P11 qayta sharh: list op — uzun bandni ko'chirish (tartib) uni qirqmaydi; yangi uzun band esa qirqiladi", () => {
  const two: SlideModel = { id: "s0", layout: "twoCol", title: "Ikki ustun", leftTitle: "A", rightTitle: "B", left: ["qisqa", STEP100, "c", "d"], right: ["e"] };
  const colMax = clipLimit("colItem", buildSlideDeck(circleDoc([two])).bodyType, "circle", 4, undefined, NO_IMAGE);
  assert.ok(STEP100.length > colMax, `sinov asosi: ${STEP100.length} > ${colMax}`);
  const r = apply(circleDoc([two]), [{ op: "list", index: 0, field: "left", items: [STEP100, "qisqa", "c", "d"] }]);
  assert.deepEqual(r.slides![0].left, [STEP100, "qisqa", "c", "d"], "ko'chirilgan uzun band o'zgarmasligi kerak");
  // Yangi (ro'yxatda yo'q) uzun matn — o'rnidagi eski uzunlik (5) va quti bo'yicha qirqiladi.
  const n = apply(circleDoc([two]), [{ op: "list", index: 0, field: "left", items: [`${STEP100} yana`, STEP100, "c", "d"] }]);
  assert.ok(n.slides![0].left![0].length <= colMax && n.slides![0].left![0].endsWith("…"));
});

// P11 sharhi 3: gap maydonlari tahriri deka vizualining RASMSIZ qutisida (generatsiya bilan bir funksiya).
test("P11 sharh 3: 8–9 sinf circle — 4 bandli ustun bandi ~60 (110 emas), reja bandi reja qatorida; eski uzunlik saqlanadi", () => {
  const two: SlideModel = { id: "s0", layout: "twoCol", title: "Ikki ustun", leftTitle: "A", rightTitle: "B", left: ["a", "b", "c", "d"], right: ["e"] };
  const deck = buildSlideDeck(circleDoc([two]));
  const colMax = clipLimit("colItem", deck.bodyType, "circle", 4, undefined, NO_IMAGE);
  assert.ok(colMax <= 70, `sinov asosi: 4 bandli ustun qutisi ${colMax}`);
  const r = apply(circleDoc([two]), [{ op: "text", index: 0, src: { f: "left", i: 0 }, value: STEP100 }]);
  const got = r.slides![0].left![0];
  assert.ok(got.length <= colMax && got.endsWith("…"), `ustun bandi ${got.length} > ${colMax}`);
  // `list` op ham — shu sonda.
  const l = apply(circleDoc([two]), [{ op: "list", index: 0, field: "left", items: [STEP100, STEP100, STEP100, STEP100] }]);
  for (const x of l.slides![0].left!) assert.ok(x.length <= colMax, `list ${x.length}`);
  // Mavjud uzun band (eski deka) tipo tuzatishda qisqarmaydi (W7 editLimit).
  const old: SlideModel = { ...two, left: [STEP100, "b", "c", "d"] };
  const typo = `${STEP100.slice(0, 10)}X${STEP100.slice(11)}`;
  const t = apply(circleDoc([old]), [{ op: "text", index: 0, src: { f: "left", i: 0 }, value: typo }]);
  assert.equal(t.slides![0].left![0], typo);
  // Reja bandi — reja qatori (`clipLimit("agenda")`, `syncAgenda` bilan bir chegara), `bulletChars` emas.
  const agenda: SlideModel = { id: "s0", layout: "agenda", title: "Reja", bullets: ["a", "b", "c", "d", "e", "f"] };
  const kidsDoc = (slides: SlideModel[]): AcademicDoc => ({ ...circleDoc(slides), meta: extractMeta(TOOL_BY_ID.slide, { topic: "Suv", slideTemplate: "lecture", slideAudience: "school_1_4", planItems: 6 } as never) });
  const kd = buildSlideDeck(kidsDoc([agenda]));
  const agMax = clipLimit("agenda", kd.bodyType, "circle", 6, undefined, NO_IMAGE);
  assert.ok(agMax < kd.bodyType.bulletChars, `sinov asosi: reja qatori ${agMax} < bulletChars ${kd.bodyType.bulletChars}`);
  const a = apply(kidsDoc([agenda]), [{ op: "text", index: 0, src: { f: "bullets", i: 0 }, value: STEP100 }]);
  assert.ok(a.slides![0].bullets![0].length <= agMax, `reja bandi ${a.slides![0].bullets![0].length} > ${agMax}`);
});
