import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { canConvert, convertLayout, type EditRules } from "../lib/generation/slide-edit.ts";
import { SLIDE_LIMITS } from "../lib/generation/slide-limits.ts";
import { buildSlideDeck } from "../lib/generation/slides.ts";
import { SLIDE_LAYOUTS, type SlideLayout, type SlideModel } from "../lib/generation/slide-types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";

/**
 * E3 — MAKET O'ZGARTIRISH JADVALI (rejadagi «Qarorlar» bo'limi).
 *
 * Jadvalning HAR katagi sinaladi: 14 × 13 = 182 yo'nalish. Ruxsat
 * etilganlar shu yerda RO'YXAT bilan yozilgan (koddagi `CONVERSIONS`
 * dan import QILINMAYDI — aks holda test kodni emas, o'zini sinardi),
 * qolgan hamma juftlik TAQIQ bo'lishi va sabab matni qaytishi kerak.
 *
 * Taqiq sababi bitta: o'girish UYDIRMA ma'lumot talab qiladi
 * (`→ table` ustunlarni, `→ quiz` to'rt variant va javobni, `→ stats`
 * raqamni, `→ references` havolani) yoki ma'nosiz (`→ title` — muqova
 * dekada bitta).
 */

const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);
const rules: EditRules = buildSlideDeck({
  meta,
  titlePage: true,
  toc: true,
  sections: [],
  slides: [{ id: "s0", layout: "bullets", title: "x" }],
} as AcademicDoc).bodyType;

/** Har maket uchun MAZMUNI YETARLI namuna — o'girish faqat jadval bilan cheklansin. */
const SAMPLE: Record<SlideLayout, SlideModel> = {
  title: { id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh matni" },
  agenda: { id: "s0", layout: "agenda", title: "Reja", bullets: ["12 ta bo‘lim", "30 daqiqa"] },
  section: { id: "s0", layout: "section", title: "Bo‘lim", subtitle: "Izoh matni" },
  // Raqamli bandlar: `bullets → stats` jadvalda ✓ («faqat raqamli»).
  bullets: { id: "s0", layout: "bullets", title: "Bandlar", bullets: ["95% qoniqish", "12 hudud", "3 bosqich"] },
  twoCol: { id: "s0", layout: "twoCol", title: "Ikki ustun", leftTitle: "Chap", left: ["L1", "L2"], rightTitle: "O‘ng", right: ["R1"] },
  compare: { id: "s0", layout: "compare", title: "Qiyos", leftTitle: "Birinchi", left: ["A"], rightTitle: "Ikkinchi", right: ["B"] },
  quote: { id: "s0", layout: "quote", title: "Iqtibos", quote: "Suv — hayot manbai.", quoteBy: "Xalq maqoli" },
  stats: { id: "s0", layout: "stats", title: "Raqamlar", stats: [{ value: "95%", label: "qoniqish" }, { value: "12", label: "hudud" }] },
  process: { id: "s0", layout: "process", title: "Bosqichlar", steps: [{ n: "1", title: "Reja", text: "Matn." }, { n: "2", title: "Ijro", text: "Matn." }] },
  table: { id: "s0", layout: "table", title: "Jadval", table: { headers: ["A", "B"], rows: [["a1", "b1"], ["a2", "b2"]] } },
  closing: { id: "s0", layout: "closing", title: "Xulosa", subtitle: "Savollar" },
  quiz: { id: "s0", layout: "quiz", title: "Test", quiz: [{ q: "Savol?", options: ["Bir", "Ikki", "Uch", "To‘rt"], answer: 1 }] },
  references: { id: "s0", layout: "references", title: "Manbalar", refs: [{ title: "UNESCO", source: "unesco.org" }] },
  answers: { id: "s0", layout: "answers", title: "Javoblar", bullets: ["1 — B", "2 — D"] },
};

/** Rejadagi ✓ ro'yxati — «lossy» = ruxsat, lekin ma'lumot yo'qoladi. */
const ALLOWED: Record<string, "ok" | "lossy"> = {
  "bullets>agenda": "ok",
  "agenda>bullets": "ok",
  "twoCol>compare": "ok",
  "compare>twoCol": "ok",
  "title>section": "ok",
  "section>title": "ok",
  "title>closing": "ok",
  "closing>title": "ok",
  "section>closing": "ok",
  "closing>section": "ok",
  "bullets>twoCol": "ok",
  "twoCol>bullets": "lossy",
  "compare>bullets": "lossy",
  "bullets>process": "ok",
  "process>bullets": "lossy",
  "bullets>stats": "ok",
  "stats>bullets": "lossy",
  "quote>section": "ok",
  "quote>closing": "ok",
  "quote>bullets": "lossy",
  "section>quote": "ok",
  "closing>quote": "ok",
  "bullets>quote": "lossy",
  "table>bullets": "lossy",
  "quiz>bullets": "lossy",
  "references>bullets": "lossy",
  "answers>bullets": "lossy",
};

// ═══════════════════════════════════════════ 1. Jadvalning HAR katagi

test("jadval: 14 × 13 yo'nalishning har biri", () => {
  let allowed = 0;
  let denied = 0;
  for (const from of SLIDE_LAYOUTS) {
    for (const to of SLIDE_LAYOUTS) {
      if (from === to) continue;
      const s = SAMPLE[from];
      const want = ALLOWED[`${from}>${to}`];
      const got = canConvert(s, to);
      if (want) {
        assert.equal(got.ok, true, `${from} → ${to}: jadvalda ✓, kod rad etdi (${got.ok ? "" : got.reason})`);
        assert.equal((got as { lossy: boolean }).lossy, want === "lossy", `${from} → ${to}: yo'qotishli bayrog'i mos emas`);
        const conv = convertLayout(s, to, rules);
        assert.equal(conv.ok, true, `${from} → ${to}: canConvert ruxsat berdi, convertLayout rad etdi`);
        assert.equal((conv as { slide: SlideModel }).slide.layout, to);
        allowed++;
      } else {
        assert.equal(got.ok, false, `${from} → ${to}: jadvalda ✗, kod ruxsat berdi`);
        const reason = (got as { reason: string }).reason;
        assert.equal(typeof reason === "string" && reason.length > 0, true, `${from} → ${to}: sabab matni yo'q`);
        assert.equal(convertLayout(s, to, rules).ok, false, `${from} → ${to}: convertLayout ham rad etishi kerak`);
        denied++;
      }
    }
  }
  assert.equal(allowed, Object.keys(ALLOWED).length, "ruxsat etilgan yo'nalishlar soni jadvalga teng");
  assert.equal(allowed + denied, SLIDE_LAYOUTS.length * (SLIDE_LAYOUTS.length - 1));
});

test("bir xil maket — no-op, model o'zgarmaydi", () => {
  const r = convertLayout(SAMPLE.bullets, "bullets", rules);
  assert.equal(r.ok, true);
  assert.deepEqual((r as { slide: SlideModel }).slide, SAMPLE.bullets);
});

// ═══════════════════════════════════════════ 2. Mazmun shartlari

test("bullets → stats: FAQAT har band raqamdan boshlansa", () => {
  const text: SlideModel = { id: "s0", layout: "bullets", title: "T", bullets: ["Birinchi fikr", "Ikkinchi fikr"] };
  const r = canConvert(text, "stats");
  assert.equal(r.ok, false, "raqamsiz bandlardan stats — uydirma");
  assert.match((r as { reason: string }).reason, /raqam/i);
  const mixed: SlideModel = { id: "s0", layout: "bullets", title: "T", bullets: ["95% qoniqish", "yaxshi natija"] };
  assert.equal(canConvert(mixed, "stats").ok, false, "bitta band raqamsiz bo'lsa ham rad etiladi");
  const ok = convertLayout(SAMPLE.bullets, "stats", rules);
  assert.deepEqual((ok as { slide: SlideModel }).slide.stats, [
    { value: "95%", label: "qoniqish" },
    { value: "12", label: "hudud" },
    { value: "3", label: "bosqich" },
  ]);
});

test("bullets → twoCol: kamida ikki band kerak, yarmi chapga", () => {
  const one: SlideModel = { id: "s0", layout: "bullets", title: "T", bullets: ["Yagona band"] };
  assert.equal(canConvert(one, "twoCol").ok, false);
  const r = convertLayout(SAMPLE.bullets, "twoCol", rules);
  const s = (r as { slide: SlideModel }).slide;
  assert.deepEqual(s.left, ["95% qoniqish", "12 hudud"]);
  assert.deepEqual(s.right, ["3 bosqich"]);
  assert.equal(s.bullets, undefined, "eski maydon qolmasin");
});

test("quote → bullets: iqtibos va muallif bandlarga tushadi", () => {
  const s = (convertLayout(SAMPLE.quote, "bullets", rules) as { slide: SlideModel }).slide;
  assert.deepEqual(s.bullets, ["Suv — hayot manbai.", "Xalq maqoli"]);
  assert.equal(s.quote, undefined);
  assert.equal(s.quoteBy, undefined);
});

test("table/quiz/references → bullets: qator, savol, manba matni saqlanadi", () => {
  const t = (convertLayout(SAMPLE.table, "bullets", rules) as { slide: SlideModel }).slide;
  assert.deepEqual(t.bullets, ["a1 — b1", "a2 — b2"]);
  assert.equal(t.table, undefined, "jadval tuzilmasi tashlanadi");
  const q = (convertLayout(SAMPLE.quiz, "bullets", rules) as { slide: SlideModel }).slide;
  assert.deepEqual(q.bullets, ["Savol?"]);
  assert.equal(q.quiz, undefined);
  const r = (convertLayout(SAMPLE.references, "bullets", rules) as { slide: SlideModel }).slide;
  assert.deepEqual(r.bullets, ["UNESCO — unesco.org"]);
  assert.equal(r.refs, undefined);
});

test("twoCol ↔ compare: ustunlar to'liq saqlanadi, sarlavha standarti to'ldiriladi", () => {
  const c = (convertLayout(SAMPLE.twoCol, "compare", rules) as { slide: SlideModel }).slide;
  assert.deepEqual(c.left, ["L1", "L2"]);
  assert.deepEqual(c.right, ["R1"]);
  assert.equal(c.leftTitle, "Chap");
  const bare: SlideModel = { id: "s0", layout: "twoCol", title: "T", leftTitle: "", left: ["A"], rightTitle: "", right: ["B"] };
  const filled = (convertLayout(bare, "compare", rules) as { slide: SlideModel }).slide;
  assert.equal(filled.leftTitle, "Birinchi");
  assert.equal(filled.rightTitle, "Ikkinchi");
});

test("bullets → process: «sarlavha — matn» ajratiladi", () => {
  const s: SlideModel = { id: "s0", layout: "bullets", title: "T", bullets: ["Reja — hujjat tayyorlanadi", "Ijro"] };
  const p = (convertLayout(s, "process", rules) as { slide: SlideModel }).slide;
  assert.deepEqual(p.steps, [
    { n: "1", title: "Reja", text: "hujjat tayyorlanadi" },
    { n: "2", title: "Ijro", text: "" },
  ]);
});

test("title ↔ section ↔ closing: izoh matni ko'chadi va maket chegarasiga qisqaradi", () => {
  const long = { id: "s0", layout: "section", title: "T", subtitle: "a".repeat(SLIDE_LIMITS.subtitleSection) } as SlideModel;
  const c = (convertLayout(long, "closing", rules) as { slide: SlideModel }).slide;
  assert.equal(c.subtitle?.length, SLIDE_LIMITS.subtitleClosing, "closing qutisi kichikroq");
  const q = (convertLayout(SAMPLE.section, "quote", rules) as { slide: SlideModel }).slide;
  assert.equal(q.quote, "Izoh matni");
});

test("o'girishda bandlar Slide Law chegarasiga qisqaradi", () => {
  const many: SlideModel = {
    id: "s0",
    layout: "twoCol",
    title: "T",
    left: ["1", "2", "3", "4"],
    right: ["5", "6", "7", "8"],
  };
  const b = (convertLayout(many, "bullets", rules) as { slide: SlideModel }).slide;
  assert.equal(b.bullets?.length, rules.maxBullets);
});
