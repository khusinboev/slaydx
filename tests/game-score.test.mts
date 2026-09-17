import test from "node:test";
import assert from "node:assert/strict";
import { scoreAnswers, scorePercent, type PlayerAnswers } from "../lib/game/score.ts";
import { publicGameView, publicItemId, publicOptionOrder } from "../lib/game/public.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * BALL SERVER TOMONDA (AUDIT-22 R0) — `lib/game/score.ts`.
 *
 * Testning mantiqi: o'yinchi FAQAT ochiq ko'rinishni ko'radi
 * (`publicGameView`), ya'ni «to'g'ri o'ynash» ni ham shundan qurish
 * kerak. Shuning uchun har testda javoblar ochiq ko'rinishdan yig'iladi
 * — agar `score.ts` va `public.ts` variant tartibi bo'yicha ajralib
 * ketsa, to'g'ri o'ynagan o'quvchi 0 ball olardi va SHU YERDA ko'rinardi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `scoreAnswers` da `publicOptionOrder` chaqirilmadi (indeks aynan
 *      solishtirildi) — «to'g'ri o'ynash 100 %» testi;
 *   2. `multi` javobi to'plam o'rniga tartib bilan solishtirildi —
 *      «ko'p javobli savol» testi;
 *   3. krossvordda apostrof normallashtirilmadi — «apostrof jazolanmaydi»;
 *   4. saralashda element id si tartibdan olindi — «to'g'ri o'ynash» testi
 *      (id lar mos kelmay 0 ball chiqardi);
 *   5. `finish` da `total` javoblar sonidan olindi — «javob bermaslik
 *      jami sonni kamaytirmaydi» testi;
 *   6. `scorePercent` nolga bo'lishdan himoyalanmadi — «bo'sh o'yin» testi.
 */

const quizDoc = (): AcademicDoc => sampleTeacherDoc("test");

/** Ochiq ko'rinish bo'yicha TO'G'RI javoblar to'plami (o'yinchi «hammasini bildi»). */
function perfectAnswers(doc: AcademicDoc, kind: "quiz" | "crossword" | "flashcards" | "sorting" | "listening"): PlayerAnswers {
  const out: PlayerAnswers = {};
  if (kind === "quiz") {
    for (const q of doc.teacher!.test!.questions) {
      if (q.kind === "truefalse") out[q.id] = q.answer as boolean;
      else if (q.kind === "single") {
        const order = publicOptionOrder(q.id, q.options.length);
        out[q.id] = order.indexOf(q.answer as number);
      } else if (q.kind === "multi") {
        const order = publicOptionOrder(q.id, q.options.length);
        out[q.id] = (q.answer as number[]).map((i) => order.indexOf(i));
      }
    }
    return out;
  }
  if (kind === "crossword") {
    for (const w of doc.game!.crossword!.words) out[w.id] = w.answer.join("");
    return out;
  }
  if (kind === "flashcards") {
    for (const c of doc.game!.cards!.cards) out[c.id] = true;
    return out;
  }
  if (kind === "sorting") {
    for (const c of doc.game!.sorting!.categories) for (const item of c.items) out[publicItemId(item)] = c.id;
    return out;
  }
  for (const it of doc.game!.listening!.items) {
    const order = publicOptionOrder(it.id, it.options.length);
    out[it.id] = order.indexOf(it.answer);
  }
  return out;
}

test("TO'G'RI o'ynash — har kindda 100 % (ochiq ko'rinish va ball bitta qoidadan)", () => {
  const cases: [AcademicDoc, "quiz" | "crossword" | "flashcards" | "sorting" | "listening"][] = [
    [quizDoc(), "quiz"],
    [sampleGameDoc("crossword"), "crossword"],
    [sampleGameDoc("flashcards"), "flashcards"],
    [sampleGameDoc("sorting"), "sorting"],
    [sampleGameDoc("listening"), "listening"],
  ];
  for (const [doc, kind] of cases) {
    const view = publicGameView(doc, kind, { seed: "t" })!;
    const r = scoreAnswers(doc, kind, perfectAnswers(doc, kind));
    assert.equal(r.total, view.total, `${kind}: jami son ko'rinishdagidan farq qiladi`);
    assert.equal(r.score, r.total, `${kind}: to'g'ri o'ynagan o'yinchi ${r.score}/${r.total} oldi`);
    assert.equal(scorePercent(r), 100, `${kind}: foiz`);
  }
});

test("BO'SH javob — 0 ball, lekin `total` kamaymaydi (jami hamma uchun bir xil)", () => {
  for (const kind of ["quiz", "crossword", "flashcards", "sorting", "listening"] as const) {
    const doc = kind === "quiz" ? quizDoc() : sampleGameDoc(kind);
    const empty = scoreAnswers(doc, kind, {});
    const full = scoreAnswers(doc, kind, perfectAnswers(doc, kind));
    assert.equal(empty.score, 0, `${kind}: bo'sh javobda ball bor`);
    // MUTATSIYA: `total` ni javoblar sonidan olish — bitta ham javob
    // bermagan o'quvchi «0/0 = 100 %» olardi.
    assert.equal(empty.total, full.total, `${kind}: jami son javoblar soniga bog'lanib qolgan`);
    assert.equal(scorePercent(empty), 0, `${kind}: foiz`);
  }
});

test("TEST: bitta javobli savol — aralashtirilgan indeks to'g'ri ochiladi", () => {
  const doc = quizDoc();
  const single = doc.teacher!.test!.questions.find((q) => q.kind === "single")!;
  const order = publicOptionOrder(single.id, single.options.length);
  const correct = order.indexOf(single.answer as number);
  const wrong = (correct + 1) % order.length;

  const ok = scoreAnswers(doc, "quiz", { [single.id]: correct });
  assert.equal(ok.results[single.id], true, "to'g'ri tanlov xato deb sanaldi");
  const bad = scoreAnswers(doc, "quiz", { [single.id]: wrong });
  assert.equal(bad.results[single.id], false, "xato tanlov to'g'ri deb sanaldi");
  /*
   * MUTATSIYA: `publicOptionOrder` siz solishtirish — MODEL indeksi
   * yuborilganda «to'g'ri» bo'lardi. O'yinchi model indeksini bilmaydi,
   * ya'ni bu holat faqat mutatsiyada yuzaga keladi.
   */
  if (correct !== (single.answer as number)) {
    const raw = scoreAnswers(doc, "quiz", { [single.id]: single.answer as number });
    assert.equal(raw.results[single.id], false, "MUTATSIYA: model indeksi to'g'ridan-to'g'ri qabul qilindi");
  }
  // Chegaradan tashqaridagi va noto'g'ri turdagi qiymat — shunchaki xato.
  for (const bogus of [99, -1, "0", null, undefined, {}]) {
    assert.equal(scoreAnswers(doc, "quiz", { [single.id]: bogus }).results[single.id], false, `«${String(bogus)}» qabul qilindi`);
  }
});

test("TEST: ko'p javobli savol TO'PLAM sifatida, to'g'ri/noto'g'ri bo'linmaydi", () => {
  const doc = quizDoc();
  const multi = doc.teacher!.test!.questions.find((q) => q.kind === "multi");
  if (!multi) return; // namunada `multi` bo'lmasa — test ma'nosiz emas, o'tkazib yuboriladi.
  const order = publicOptionOrder(multi.id, multi.options.length);
  const want = (multi.answer as number[]).map((i) => order.indexOf(i));
  assert.equal(scoreAnswers(doc, "quiz", { [multi.id]: want }).results[multi.id], true);
  // TARTIB ahamiyatsiz (to'plam).
  assert.equal(scoreAnswers(doc, "quiz", { [multi.id]: [...want].reverse() }).results[multi.id], true, "MUTATSIYA: tartib bo'yicha solishtirildi");
  // Yarim javob — XATO (yarim ball yo'q).
  if (want.length > 1) assert.equal(scoreAnswers(doc, "quiz", { [multi.id]: [want[0]] }).results[multi.id], false);
  // Ortiqcha variant — xato.
  const extra = order.map((_, i) => i);
  if (extra.length > want.length) assert.equal(scoreAnswers(doc, "quiz", { [multi.id]: extra }).results[multi.id], false);
});

test("KROSSVORD: registr va apostrof jazolanmaydi, boshqa so'z esa xato", () => {
  const doc = sampleGameDoc("crossword");
  const w = doc.game!.crossword!.words[0];
  const answer = w.answer.join("");
  const variants = [answer, answer.toLowerCase(), ` ${answer} `, answer.replace(/[ʻʼ'’]/g, "")];
  for (const v of variants) {
    assert.equal(scoreAnswers(doc, "crossword", { [w.id]: v }).results[w.id], true, `«${v}» to'g'ri deb qabul qilinmadi`);
  }
  assert.equal(scoreAnswers(doc, "crossword", { [w.id]: "BOSHQASO" }).results[w.id], false);
  assert.equal(scoreAnswers(doc, "crossword", { [w.id]: "" }).results[w.id], false, "bo'sh javob to'g'ri sanaldi");
});

test("SARALASH: element o'z toifasida — to'g'ri, qo'shni toifada — xato", () => {
  const doc = sampleGameDoc("sorting");
  const cats = doc.game!.sorting!.categories;
  const item = cats[0].items[0];
  const id = publicItemId(item);
  assert.equal(scoreAnswers(doc, "sorting", { [id]: cats[0].id }).results[id], true);
  assert.equal(scoreAnswers(doc, "sorting", { [id]: cats[1].id }).results[id], false, "boshqa toifa to'g'ri sanaldi");
  assert.equal(scoreAnswers(doc, "sorting", { [id]: "yoq-toifa" }).results[id], false);
  // Jami — barcha elementlar (toifa emas).
  const total = cats.reduce((n, c) => n + c.items.length, 0);
  assert.equal(scoreAnswers(doc, "sorting", {}).total, total, "jami toifa soniga teng bo'lib qoldi");
  // Qisman to'g'ri o'yin — ball ham qisman.
  const half: PlayerAnswers = {};
  for (const it of cats[0].items) half[publicItemId(it)] = cats[0].id;
  const r = scoreAnswers(doc, "sorting", half);
  assert.equal(r.score, cats[0].items.length);
  assert.ok(r.score < r.total);
});

test("TINGLASH: aralashtirilgan variant indeksi ochiladi, chegaradan tashqarisi xato", () => {
  const doc = sampleGameDoc("listening");
  const it = doc.game!.listening!.items[0];
  const order = publicOptionOrder(it.id, it.options.length);
  const correct = order.indexOf(it.answer);
  assert.equal(scoreAnswers(doc, "listening", { [it.id]: correct }).results[it.id], true);
  assert.equal(scoreAnswers(doc, "listening", { [it.id]: (correct + 1) % order.length }).results[it.id], false);
  assert.equal(scoreAnswers(doc, "listening", { [it.id]: 99 }).results[it.id], false);
  assert.equal(scoreAnswers(doc, "listening", { [it.id]: "1" }).results[it.id], false, "satr indeks qabul qilindi");
});

test("KARTALAR: ball — «bildim» deb belgilangan kartalar soni (o'zini tekshirish)", () => {
  const doc = sampleGameDoc("flashcards");
  const cards = doc.game!.cards!.cards;
  const partial: PlayerAnswers = { [cards[0].id]: true, [cards[1].id]: false };
  const r = scoreAnswers(doc, "flashcards", partial);
  assert.equal(r.total, cards.length);
  assert.equal(r.score, 1);
  // `true` dan boshqa hamma narsa — «bilmadim» (satr «true» ham).
  assert.equal(scoreAnswers(doc, "flashcards", { [cards[0].id]: "true" }).score, 0);
});

test("buzuq/yot javoblar ballni buzmaydi va istisno tashlamaydi", () => {
  const doc = sampleGameDoc("sorting");
  const cats = doc.game!.sorting!.categories;
  const id = publicItemId(cats[0].items[0]);
  const noisy = {
    [id]: cats[0].id,
    "yot-kalit": "qiymat",
    __proto__: { hacked: true },
    constructor: "x",
  } as unknown as PlayerAnswers;
  const r = scoreAnswers(doc, "sorting", noisy);
  assert.equal(r.score, 1, "yot kalitlar ballga qo'shildi");
  assert.ok(!("yot-kalit" in r.results), "yot kalit natijaga tushdi");
  // `null`/massiv javoblar ham xato bermaydi.
  assert.equal(scoreAnswers(doc, "sorting", null as unknown as PlayerAnswers).score, 0);
  assert.equal(scoreAnswers(doc, "sorting", [] as unknown as PlayerAnswers).score, 0);
});

test("foiz: yaxlitlash bitta joyda, bo'sh o'yinda 0", () => {
  assert.equal(scorePercent({ score: 1, total: 3 }), 33);
  assert.equal(scorePercent({ score: 2, total: 3 }), 67);
  assert.equal(scorePercent({ score: 0, total: 10 }), 0);
  // MUTATSIYA: nolga bo'lish — `NaN%` natijalar jadvaliga tushardi.
  assert.equal(scorePercent({ score: 0, total: 0 }), 0);
});
