import test from "node:test";
import assert from "node:assert/strict";
import { auditSlideDoc, type SlideAuditIssue } from "../scripts/slide-audit.mts";

/**
 * `auditSlideDoc` (AUDIT-25 P5) — reja qamrovi, tartib raqami sizishi,
 * uydirma raqamlar, yupqa mazmun, blok tartibi.
 *
 * Har band uchun: (a) HECH BIR nuqson yo'q holatda `ok: true`, (b) FAQAT
 * shu nuqson kiritilganda ANIQ shu `kind` chiqishi. Fixture — qo'lda
 * qurilgan `SlideDocLike`, chunki `eval-out/live/*.doc.json` bu
 * worktree'da yo'q (jonli sinov ishlatilmagan).
 *
 * Kontrakt eslatmasi: `SlideModel.plan` P1'da (`docs/AUDIT-25.md` §3)
 * e'lon qilingan, bu fayl uni oddiy `number` maydon sifatida yozadi —
 * P1 qo'shgach `SlideModel`ning o'zida bo'ladi, bu yerdagi fixture'lar
 * o'zgarishsiz qoladi.
 */

type Slide = Record<string, unknown> & { layout: string; title: string };

/**
 * "Toza" deka — 12 slayd, 3 reja bandi, HAR bir tekshiruv turidan bittadan
 * yaxshi namuna (bullets/twoCol/process/stats/quiz/quote), HECH bir
 * nuqsonsiz. Har test shundan bitta maydonni buzadi.
 */
function goodDeck(): { slides: Slide[] } {
  return {
    slides: [
      { layout: "title", title: "Orol dengizi fojiasi" },
      { layout: "agenda", title: "Reja", bullets: ["Birinchi bo'lim", "Ikkinchi bo'lim", "Uchinchi bo'lim"] },
      { layout: "section", title: "Birinchi bo'lim", subtitle: "Muammoning kelib chiqishi", plan: 1 },
      {
        layout: "bullets",
        title: "Sabablar",
        plan: 1,
        bullets: [
          "Bu yerda kamida olti so'zdan iborat birinchi band matni bor",
          "Bu yerda ham kamida olti so'zli ikkinchi band matni keladi",
        ],
      },
      { layout: "section", title: "Ikkinchi bo'lim", subtitle: "Oqibatlari va ko'lami", plan: 2 },
      {
        layout: "twoCol",
        title: "Solishtiruv",
        plan: 2,
        leftTitle: "Ijobiy",
        left: ["Birinchi tomon afzalligi haqida gap", "Ikkinchi tomon afzalligi haqida gap"],
        rightTitle: "Salbiy",
        right: ["Birinchi tomon kamchiligi haqida gap", "Ikkinchi tomon kamchiligi haqida gap"],
      },
      {
        layout: "process",
        title: "Bosqichlar",
        plan: 2,
        steps: [
          { n: "1", title: "Boshlanish", text: "Jarayon shu bosqichda boshlanadi va tayyorgarlik ko'riladi albatta" },
          { n: "2", title: "Davom etish", text: "Jarayon davom etadi va natijalar asta-sekin shakllana boshlaydi" },
        ],
      },
      { layout: "section", title: "Uchinchi bo'lim", subtitle: "Choralar va yechimlar", plan: 3 },
      {
        layout: "stats",
        title: "Raqamlarda",
        plan: 3,
        stats: [
          { value: "42%", label: "O'sish sur'ati" },
          { value: "3.5", label: "Millioner aholi" },
        ],
      },
      {
        layout: "quiz",
        title: "Nazorat",
        plan: 3,
        quiz: [
          {
            q: "Qaysi chora eng samarali?",
            options: ["Birinchi variant to'liq matni", "Ikkinchi variant to'liq matni", "Uchinchi variant to'liq matni", "To'rtinchi variant to'liq matni"],
            answer: 0,
          },
        ],
      },
      { layout: "quote", title: "Iqtibos", quote: "Bu yerda kamida sakkizta so'zdan iborat uzun iqtibos matni keladi", quoteBy: "Muallif" },
      { layout: "closing", title: "Xulosa" },
    ],
  };
}

function kindsOf(issues: SlideAuditIssue[]): string[] {
  return issues.map((i) => i.kind);
}

test("toza deka — ok, nuqsonsiz", () => {
  const { ok, issues } = auditSlideDoc(goodDeck());
  assert.equal(ok, true, JSON.stringify(issues));
  assert.deepEqual(issues, []);
});

test("reja qamrovi: plan yo'qolgan bandda plan-coverage", () => {
  const doc = goodDeck();
  // 2-band (plan:2) barcha slaydlaridan `plan`ni olib tashlaymiz.
  for (const s of doc.slides) if (s.plan === 2) delete (s as { plan?: number }).plan;
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("plan-coverage"), kindsOf(issues).join(","));
  assert.ok(issues.some((i) => i.detail.includes("2/3")), JSON.stringify(issues));
});

test("reja tartibi: guruhlar aralashsa plan-order", () => {
  const doc = goodDeck();
  // 1- va 2-band slaydlari o'rinlarini almashtiramiz (section+bullets ↔ section+twoCol+process).
  const byPlan1 = doc.slides.filter((s) => s.plan === 1);
  const byPlan2 = doc.slides.filter((s) => s.plan === 2);
  const rest = doc.slides.filter((s) => s.plan !== 1 && s.plan !== 2);
  const title = rest.find((s) => s.layout === "title")!;
  const agenda = rest.find((s) => s.layout === "agenda")!;
  const tail = rest.filter((s) => s.layout !== "title" && s.layout !== "agenda");
  doc.slides = [title, agenda, ...byPlan2, ...byPlan1, ...tail];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("plan-order"), kindsOf(issues).join(","));
});

test("reja sarlavhasi mos emas: plan-title-mismatch", () => {
  const doc = goodDeck();
  const section1 = doc.slides.find((s) => s.layout === "section" && s.plan === 1)!;
  section1.title = "Butunlay boshqa nom";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("plan-title-mismatch"), kindsOf(issues).join(","));
});

test("tartib raqami sizishi: '1. Kirish' → ordinal-leak", () => {
  const doc = goodDeck();
  doc.slides[3].title = "1. Sabablar";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  const leak = issues.find((i) => i.kind === "ordinal-leak");
  assert.ok(leak, kindsOf(issues).join(","));
  assert.equal(leak!.slide, 4);
});

test("rim raqami sizishi: 'II. Bo'lim' → ordinal-leak", () => {
  const doc = goodDeck();
  doc.slides[4].title = "II. Ikkinchi bo'lim";
  const { issues } = auditSlideDoc(doc);
  assert.ok(kindsOf(issues).includes("ordinal-leak"), kindsOf(issues).join(","));
});

test("uydirma stats raqami: 'Asosiy nuqta' yorlig'i → stray-number", () => {
  const doc = goodDeck();
  const stats = doc.slides.find((s) => s.layout === "stats")!;
  (stats.stats as { value: string; label: string }[]).push({ value: "3", label: "Asosiy nuqta" });
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("stray-number"), kindsOf(issues).join(","));
});

test("process qadam matni sarlavhani takrorlaydi → stray-step-echo", () => {
  const doc = goodDeck();
  const process = doc.slides.find((s) => s.layout === "process")!;
  const step = (process.steps as { n: string; title: string; text: string }[])[0];
  step.text = step.title;
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("stray-step-echo"), kindsOf(issues).join(","));
});

test("yupqa bullets — band soni < 2 → thin-bullets", () => {
  const doc = goodDeck();
  const bulletsSlide = doc.slides.find((s) => s.layout === "bullets")!;
  bulletsSlide.bullets = ["Faqat bitta band bor"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-bullets"), kindsOf(issues).join(","));
});

test("yupqa bullets — o'rtacha so'z < 6 → thin-bullets", () => {
  const doc = goodDeck();
  const bulletsSlide = doc.slides.find((s) => s.layout === "bullets")!;
  bulletsSlide.bullets = ["Qisqa band", "Yana qisqa"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-bullets"), kindsOf(issues).join(","));
});

test("yupqa process qadam — < 6 so'z → thin-process-step", () => {
  const doc = goodDeck();
  const process = doc.slides.find((s) => s.layout === "process")!;
  const step = (process.steps as { n: string; title: string; text: string }[])[0];
  step.text = "Juda qisqa matn";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-process-step"), kindsOf(issues).join(","));
});

test("bo'lim subtitle'siz → thin-section-subtitle", () => {
  const doc = goodDeck();
  const section = doc.slides.find((s) => s.layout === "section" && s.plan === 1)!;
  delete (section as { subtitle?: string }).subtitle;
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-section-subtitle"), kindsOf(issues).join(","));
});

test("twoCol ustuni < 2 band → thin-column", () => {
  const doc = goodDeck();
  const twoCol = doc.slides.find((s) => s.layout === "twoCol")!;
  twoCol.left = ["Faqat bitta band"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-column"), kindsOf(issues).join(","));
});

test("compare ustuni < 2 band → thin-column", () => {
  const doc = goodDeck();
  const twoCol = doc.slides.find((s) => s.layout === "twoCol")!;
  twoCol.layout = "compare";
  twoCol.right = ["Faqat bitta band"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-column"), kindsOf(issues).join(","));
});

test("quiz varianti '…' bilan kesilgan → thin-quiz-option", () => {
  const doc = goodDeck();
  const quiz = doc.slides.find((s) => s.layout === "quiz")!;
  const q = (quiz.quiz as { q: string; options: string[]; answer: number }[])[0];
  q.options[1] = "Kesilgan variant matni…";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-quiz-option"), kindsOf(issues).join(","));
});

test("quiz varianti '...' (uch nuqta) bilan ham ushlanadi → thin-quiz-option", () => {
  const doc = goodDeck();
  const quiz = doc.slides.find((s) => s.layout === "quiz")!;
  const q = (quiz.quiz as { q: string; options: string[]; answer: number }[])[0];
  q.options[1] = "Kesilgan variant matni...";
  const { issues } = auditSlideDoc(doc);
  assert.ok(kindsOf(issues).includes("thin-quiz-option"), kindsOf(issues).join(","));
});

test("iqtibos < 8 so'z → thin-quote", () => {
  const doc = goodDeck();
  const quote = doc.slides.find((s) => s.layout === "quote")!;
  quote.quote = "Qisqa iqtibos";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("thin-quote"), kindsOf(issues).join(","));
});

test("blok tartibi: title birinchi bo'lmasa → block-order", () => {
  const doc = goodDeck();
  const [title, agenda, ...rest] = doc.slides;
  doc.slides = [agenda, title, ...rest];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("block-order"), kindsOf(issues).join(","));
});

test("blok tartibi: closing oxirgi bo'lmasa → block-order", () => {
  const doc = goodDeck();
  const closingIdx = doc.slides.findIndex((s) => s.layout === "closing");
  const [closing] = doc.slides.splice(closingIdx, 1);
  doc.slides.splice(1, 0, closing); // agendadan oldinga surib qo'yamiz
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("block-order"), kindsOf(issues).join(","));
});

test("blok tartibi: agenda ikkinchi o'rinda bo'lmasa → block-order", () => {
  const doc = goodDeck();
  const agendaIdx = doc.slides.findIndex((s) => s.layout === "agenda");
  const [agenda] = doc.slides.splice(agendaIdx, 1);
  doc.slides.splice(3, 0, agenda); // orqaroqqa suramiz
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("block-order"), kindsOf(issues).join(","));
});

test("agenda yo'q deka — reja tekshiruvi sukut (plan-coverage yo'q)", () => {
  const doc = goodDeck();
  doc.slides = doc.slides.filter((s) => s.layout !== "agenda");
  const { issues } = auditSlideDoc(doc);
  assert.ok(!kindsOf(issues).includes("plan-coverage"), kindsOf(issues).join(","));
});

test("bo'sh deka — ok, hech narsa yo'q", () => {
  const { ok, issues } = auditSlideDoc({ slides: [] });
  assert.equal(ok, true);
  assert.deepEqual(issues, []);
});
