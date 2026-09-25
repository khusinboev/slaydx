import test from "node:test";
import assert from "node:assert/strict";
import { auditSlideDoc, type SlideAuditIssue } from "../scripts/slide-audit.mts";

/**
 * `auditSlideDoc` (AUDIT-25 P5) — reja qamrovi, tartib raqami sizishi,
 * uydirma raqamlar, halol skelet sizishi, kesiklar, yupqa mazmun, blok
 * tartibi.
 *
 * Har band uchun: (a) HECH BIR nuqson yo'q holatda `ok: true`, (b) FAQAT
 * shu nuqson kiritilganda ANIQ shu `kind` chiqishi — imkon qadar
 * `deepEqual([...new Set(kinds)], [kind])` bilan (faqat `includes` EMAS,
 * `audit/reviews/AUDIT-25-P5.md` item 8: eski testlar ikkinchi nuqson
 * yashirincha ham qo'zg'alganini payqamasdi). Fixture — qo'lda qurilgan
 * `SlideDocLike`, chunki `eval-out/live/*.doc.json` bu worktree'da yo'q
 * (jonli sinov ishlatilmagan); real 6 ta deka esa
 * `eval-out/audit25-baseline/*.doc.json` — CLI orqali qo'lda tekshirilgan
 * (`npm run slide-audit`), bu yerga fixture sifatida ko'chirilmagan.
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

function uniqueKinds(issues: SlideAuditIssue[]): string[] {
  return [...new Set(kindsOf(issues))].sort();
}

test("toza deka — ok, nuqsonsiz", () => {
  const { ok, issues } = auditSlideDoc(goodDeck());
  assert.equal(ok, true, JSON.stringify(issues));
  assert.deepEqual(issues, []);
});

/* ───────────────────────── 1. Reja qamrovi (agenda bor, plan tegilgan) ───────────────────────── */

test("reja qamrovi: plan yo'qolgan bandda plan-coverage", () => {
  const doc = goodDeck();
  // 2-band (plan:2) barcha slaydlaridan `plan`ni olib tashlaymiz.
  for (const s of doc.slides) if (s.plan === 2) delete (s as { plan?: number }).plan;
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["plan-coverage"]);
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
  assert.deepEqual(uniqueKinds(issues), ["plan-order"]);
});

test("reja sarlavhasi mos emas: plan-title-mismatch", () => {
  const doc = goodDeck();
  const section1 = doc.slides.find((s) => s.layout === "section" && s.plan === 1)!;
  section1.title = "Butunlay boshqa nom";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["plan-title-mismatch"]);
});

test("P11/INT-02: agenda bandi sarlavhaning kesilgan prefiksi («…») bo'lsa — mos, kesik EMAS", () => {
  const doc = goodDeck();
  const agenda = doc.slides.find((s) => s.layout === "agenda")!;
  const section1 = doc.slides.find((s) => s.layout === "section" && s.plan === 1)!;
  section1.title = "Orol dengizining qurishi sabablari va sug'orish tizimlarining ta'siri";
  agenda.bullets![0] = "Orol dengizining qurishi sabablari va…";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, true, JSON.stringify(issues));
  // Prefiks BO'LMASA — hamon nomuvofiqlik.
  agenda.bullets![0] = "Boshqa mavzu haqida…";
  const bad = auditSlideDoc(doc);
  assert.equal(bad.ok, false);
  assert.ok(uniqueKinds(bad.issues).includes("plan-title-mismatch"));
});

test("normTitle case-insensitiv: agenda KATTA/kichik harf va ikkilangan probel — plan-title-mismatch YO'Q (m3 mutantini o'ldiradi)", () => {
  const doc = goodDeck();
  const agenda = doc.slides.find((s) => s.layout === "agenda")!;
  agenda.bullets = ["BIRINCHI  BO'LIM", "Ikkinchi bo'lim", "Uchinchi bo'lim"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, true, JSON.stringify(issues));
  assert.deepEqual(issues, []);
});

test("normTitle ordinal-strip: bo'lim sarlavhasida '1.' bo'lsa ham plan-title-mismatch YO'Q, ordinal-leak BOR (m5 mutantini o'ldiradi)", () => {
  const doc = goodDeck();
  const section1 = doc.slides.find((s) => s.layout === "section" && s.plan === 1)!;
  section1.title = "1. Birinchi bo'lim";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["ordinal-leak"]);
});

/* ───────────────────────── item 1/2: plan-untagged / plan-extra / agendasiz tekshiruv ───────────────────────── */

test("item 1: agenda bor, lekin BIRORTA slaydda plan yo'q → plan-untagged (coverage 0/N EMAS)", () => {
  const doc = goodDeck();
  for (const s of doc.slides) delete (s as { plan?: number }).plan;
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["plan-untagged"]);
  assert.equal(issues.filter((i) => i.kind === "plan-untagged").length, 1, "har band uchun emas, BITTA umumiy xabar");
});

test("item 2: slayd plan=5 (agenda faqat 3 band beradi) → plan-extra", () => {
  const doc = goodDeck();
  const closingIdx = doc.slides.findIndex((s) => s.layout === "closing");
  doc.slides.splice(closingIdx, 0, {
    layout: "bullets",
    title: "Ortiqcha",
    plan: 5,
    bullets: [
      "Bu yerda olti so'zdan ortiq birinchi gap keladi shu yerda",
      "Bu yerda ham olti so'zdan ortiq ikkinchi gap keladi shu yerda",
    ],
  });
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.kind === "plan-extra" && i.detail.includes("plan=5")), JSON.stringify(issues));
});

test("item 2: agenda yo'q, lekin plan tartibsiz tegilgan → plan-order (agendasiz ham tekshiriladi, §2.1)", () => {
  const doc = goodDeck();
  doc.slides = doc.slides.filter((s) => s.layout !== "agenda");
  const byPlan1 = doc.slides.filter((s) => s.plan === 1);
  const byPlan2 = doc.slides.filter((s) => s.plan === 2);
  const rest = doc.slides.filter((s) => s.plan !== 1 && s.plan !== 2);
  const title = rest.find((s) => s.layout === "title")!;
  const others = rest.filter((s) => s !== title);
  doc.slides = [title, ...byPlan2, ...byPlan1, ...others];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(kindsOf(issues).includes("plan-order"), kindsOf(issues).join(","));
});

test("item 2: agenda yo'q, plan tegilgan va tartibli → reja-* nuqson yo'q (kontiguity o'tadi)", () => {
  const doc = goodDeck();
  doc.slides = doc.slides.filter((s) => s.layout !== "agenda");
  const { issues } = auditSlideDoc(doc);
  assert.ok(!kindsOf(issues).some((k) => k.startsWith("plan-")), kindsOf(issues).join(","));
});

test("item 1: agenda yo'q VA plan yo'q — hech qanday reja-* nuqson chiqmaydi (eski deka, chinakam sukut)", () => {
  const doc = goodDeck();
  doc.slides = doc.slides.filter((s) => s.layout !== "agenda");
  for (const s of doc.slides) delete (s as { plan?: number }).plan;
  const { issues } = auditSlideDoc(doc);
  assert.ok(!kindsOf(issues).some((k) => k.startsWith("plan-")), kindsOf(issues).join(","));
});

/* ───────────────────────── 2. Tartib raqami sizishi (item 3: regex tuzatildi) ───────────────────────── */

test("tartib raqami sizishi: '1. Kirish' → ordinal-leak", () => {
  const doc = goodDeck();
  doc.slides[3].title = "1. Sabablar";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["ordinal-leak"]);
  const leak = issues.find((i) => i.kind === "ordinal-leak");
  assert.equal(leak!.slide, 4);
});

test("rim raqami sizishi: 'II. Bo'lim' → ordinal-leak", () => {
  const doc = goodDeck();
  doc.slides[4].title = "II. Ikkinchi bo'lim";
  const { issues } = auditSlideDoc(doc);
  assert.deepEqual(uniqueKinds(issues), ["ordinal-leak"]);
});

test("item 3: '3) Natija' — haqiqiy tartib raqami, ushlanadi", () => {
  const { issues } = auditSlideDoc({ slides: [{ layout: "bullets", title: "3) Natija" }] });
  assert.ok(kindsOf(issues).includes("ordinal-leak"), kindsOf(issues).join(","));
});

test("item 3: '1.5 million gektar yer qurigan' — YOLG'ON signal EMAS (kasr son)", () => {
  const { issues } = auditSlideDoc({ slides: [{ layout: "bullets", title: "1.5 million gektar yer qurigan" }] });
  assert.ok(!kindsOf(issues).includes("ordinal-leak"), kindsOf(issues).join(","));
});

test("item 3: 'M. Ulug'bek merosi' — YOLG'ON signal EMAS (initsial)", () => {
  const { issues } = auditSlideDoc({ slides: [{ layout: "bullets", title: "M. Ulug'bek merosi" }] });
  assert.ok(!kindsOf(issues).includes("ordinal-leak"), kindsOf(issues).join(","));
});

test("item 3: 'D. Mendeleyev jadvali' — YOLG'ON signal EMAS (initsial)", () => {
  const { issues } = auditSlideDoc({ slides: [{ layout: "bullets", title: "D. Mendeleyev jadvali" }] });
  assert.ok(!kindsOf(issues).includes("ordinal-leak"), kindsOf(issues).join(","));
});

/* ───────────────────────── 3. Uydirma raqamlar (eski skelet) ───────────────────────── */

test("uydirma stats raqami: 'Asosiy nuqta' yorlig'i → stray-number", () => {
  const doc = goodDeck();
  const stats = doc.slides.find((s) => s.layout === "stats")!;
  (stats.stats as { value: string; label: string }[]).push({ value: "3", label: "Asosiy nuqta" });
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["stray-number"]);
});

test("process qadam matni sarlavhani takrorlaydi → stray-step-echo (+ thin-process-step, qadam ham qisqa)", () => {
  const doc = goodDeck();
  const process = doc.slides.find((s) => s.layout === "process")!;
  const step = (process.steps as { n: string; title: string; text: string }[])[0];
  step.text = step.title;
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["stray-step-echo", "thin-process-step"]);
});

/* ───────────────────────── 3b. Halol skelet sizishi (item 5, §2.5) ───────────────────────── */

test("item 5: stats qiymati '—' → skeleton-leak", () => {
  const doc = goodDeck();
  const statsSlide = doc.slides.find((s) => s.layout === "stats")!;
  (statsSlide.stats as { value: string; label: string }[])[0] = { value: "—", label: "Band" };
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.kind === "skeleton-leak" && i.detail.includes("stats")), JSON.stringify(issues));
});

test("item 5: bullets bandi aynan '…' → skeleton-leak", () => {
  const doc = goodDeck();
  const bulletsSlide = doc.slides.find((s) => s.layout === "bullets" && s.plan === 1)!;
  bulletsSlide.bullets = ["…", "Bu yerda ham olti so'zdan ortiq ikkinchi band matni bor"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.kind === "skeleton-leak"), JSON.stringify(issues));
});

/* ───────────────────────── 4. Kesiklar (item 4 — HAR matn maydonida) ───────────────────────── */

test("item 4: twoCol.left[0] 'ber…' bilan tugaydi → truncated", () => {
  const doc = goodDeck();
  const twoCol = doc.slides.find((s) => s.layout === "twoCol")!;
  (twoCol.left as string[])[0] = "Bu band o'rtadan kesilgan ber…";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.ok(issues.some((i) => i.kind === "truncated" && i.detail.includes("left[0]")), JSON.stringify(issues));
});

test("item 4: quoteBy '…' bilan tugaydi → truncated", () => {
  const doc = goodDeck();
  const quoteSlide = doc.slides.find((s) => s.layout === "quote")!;
  quoteSlide.quoteBy = "Muallif ismi to'liq yozilmagan qol…";
  const { issues } = auditSlideDoc(doc);
  assert.ok(issues.some((i) => i.kind === "truncated" && i.detail.includes("quoteBy")), JSON.stringify(issues));
});

test("item 4: bo'lim subtitle '…' bilan tugaydi → truncated (defense-14 baseline naqshi)", () => {
  const doc = goodDeck();
  const section1 = doc.slides.find((s) => s.layout === "section" && s.plan === 1)!;
  section1.subtitle = "Bu yerda matn to'satdan kesilib qol…";
  const { issues } = auditSlideDoc(doc);
  assert.ok(issues.some((i) => i.kind === "truncated" && i.detail.includes("subtitle")), JSON.stringify(issues));
});

test("item 4: quiz varianti '…' bilan kesilgan → truncated (eski 'thin-quiz-option' o'rnini bosadi)", () => {
  const doc = goodDeck();
  const quiz = doc.slides.find((s) => s.layout === "quiz")!;
  const q = (quiz.quiz as { q: string; options: string[]; answer: number }[])[0];
  q.options[1] = "Kesilgan variant matni…";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["truncated"]);
});

test("item 4: quiz varianti '...' (uch nuqta) bilan ham ushlanadi → truncated", () => {
  const doc = goodDeck();
  const quiz = doc.slides.find((s) => s.layout === "quiz")!;
  const q = (quiz.quiz as { q: string; options: string[]; answer: number }[])[0];
  q.options[1] = "Kesilgan variant matni...";
  const { issues } = auditSlideDoc(doc);
  assert.ok(issues.some((i) => i.kind === "truncated" && i.detail.includes("quiz")), JSON.stringify(issues));
});

test("item 4: tinish belgisidan keyingi qasddan '...' — truncated EMAS (harf talabi, \\p{L})", () => {
  const doc = goodDeck();
  const twoCol = doc.slides.find((s) => s.layout === "twoCol")!;
  (twoCol.left as string[])[0] = "Tayyor!...";
  const { issues } = auditSlideDoc(doc);
  assert.ok(!issues.some((i) => i.kind === "truncated"), JSON.stringify(issues));
});

/* ───────────────────────── 5. Yupqa mazmun (item 9a/9b) ───────────────────────── */

test("yupqa bullets — band soni < 2 → thin-bullets", () => {
  const doc = goodDeck();
  const bulletsSlide = doc.slides.find((s) => s.layout === "bullets")!;
  bulletsSlide.bullets = ["Faqat bitta band bor"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["thin-bullets"]);
});

test("yupqa bullets — o'rtacha so'z < 6 → thin-bullets", () => {
  const doc = goodDeck();
  const bulletsSlide = doc.slides.find((s) => s.layout === "bullets")!;
  bulletsSlide.bullets = ["Qisqa band", "Yana qisqa"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["thin-bullets"]);
});

test("item 9b: blok slayd (plan YO'Q — masalan maqsadlar) qisqa bullets bilan — thin-bullets YO'Q", () => {
  const doc = goodDeck();
  doc.slides.splice(2, 0, { layout: "bullets", title: "Maqsadlar", bullets: ["Bilish", "Tushunish"] });
  const { issues } = auditSlideDoc(doc);
  assert.ok(!issues.some((i) => i.kind === "thin-bullets" && i.slide === 3), JSON.stringify(issues));
});

test("yupqa process qadam — < 6 so'z → thin-process-step", () => {
  const doc = goodDeck();
  const process = doc.slides.find((s) => s.layout === "process")!;
  const step = (process.steps as { n: string; title: string; text: string }[])[0];
  step.text = "Juda qisqa matn";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["thin-process-step"]);
});

test("bo'lim subtitle'siz → thin-section-subtitle", () => {
  const doc = goodDeck();
  const section = doc.slides.find((s) => s.layout === "section" && s.plan === 1)!;
  delete (section as { subtitle?: string }).subtitle;
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["thin-section-subtitle"]);
});

test("twoCol ustuni < 2 band → thin-column", () => {
  const doc = goodDeck();
  const twoCol = doc.slides.find((s) => s.layout === "twoCol")!;
  twoCol.left = ["Faqat bitta band"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["thin-column"]);
});

test("compare ustuni < 2 band → thin-column", () => {
  const doc = goodDeck();
  const twoCol = doc.slides.find((s) => s.layout === "twoCol")!;
  twoCol.layout = "compare";
  twoCol.right = ["Faqat bitta band"];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["thin-column"]);
});

test("item 9a: qisqa iqtibos (< 8 so'z) ENDI belgilanmaydi — §2.6(b) da bunday qoida yo'q", () => {
  const doc = goodDeck();
  const quote = doc.slides.find((s) => s.layout === "quote")!;
  quote.quote = "Qisqa savol?";
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, true, JSON.stringify(issues));
  assert.deepEqual(issues, []);
});

/* ───────────────────────── 6. Blok qamrovi / tartib ───────────────────────── */

test("blok tartibi: title birinchi bo'lmasa (FAQAT title qoidasi qo'zg'aladi) → block-order #1 (m1 mutantini o'ldiradi)", () => {
  const doc = goodDeck();
  const bullets1 = doc.slides.find((s) => s.layout === "bullets" && s.plan === 1)!;
  const agenda = doc.slides.find((s) => s.layout === "agenda")!;
  const title = doc.slides.find((s) => s.layout === "title")!;
  const rest = doc.slides.filter((s) => s !== bullets1 && s !== agenda && s !== title);
  // Agenda #2  da QOLADI (bullets1 birinchi o'ringa chiqadi, title uchinchiga tushadi) — faqat title qoidasi buziladi.
  doc.slides = [bullets1, agenda, title, ...rest];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["block-order"]);
  assert.ok(issues.some((i) => i.kind === "block-order" && i.slide === 1), JSON.stringify(issues));
});

test("blok tartibi: closing oxirgi bo'lmasa (FAQAT closing qoidasi qo'zg'aladi) → block-order #N (m2 mutantini o'ldiradi)", () => {
  const doc = goodDeck();
  const n = doc.slides.length;
  const closingIdx = doc.slides.findIndex((s) => s.layout === "closing");
  const quoteIdx = doc.slides.findIndex((s) => s.layout === "quote");
  // Faqat OXIRGI ikkita slaydni almashtiramiz — agenda #2 da, title #1 da qoladi.
  [doc.slides[closingIdx], doc.slides[quoteIdx]] = [doc.slides[quoteIdx], doc.slides[closingIdx]];
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["block-order"]);
  assert.ok(issues.some((i) => i.kind === "block-order" && i.slide === n), JSON.stringify(issues));
});

test("blok tartibi: agenda ikkinchi o'rinda bo'lmasa → block-order", () => {
  const doc = goodDeck();
  const agendaIdx = doc.slides.findIndex((s) => s.layout === "agenda");
  const [agenda] = doc.slides.splice(agendaIdx, 1);
  doc.slides.splice(3, 0, agenda); // orqaroqqa suramiz
  const { ok, issues } = auditSlideDoc(doc);
  assert.equal(ok, false);
  assert.deepEqual(uniqueKinds(issues), ["block-order"]);
});

test("bo'sh deka — ok, hech narsa yo'q", () => {
  const { ok, issues } = auditSlideDoc({ slides: [] });
  assert.equal(ok, true);
  assert.deepEqual(issues, []);
});
