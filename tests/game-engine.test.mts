import test from "node:test";
import assert from "node:assert/strict";
import {
  answer,
  answerOf,
  answeredCount,
  cellKey,
  createGame,
  crosswordSlots,
  elapsed,
  finish,
  flip,
  goTo,
  isLast,
  next,
  pick,
  place,
  prev,
  progress,
  stepsOf,
  toggleIndex,
} from "../lib/game/engine.ts";
import { publicGameView, publicItemId, type PublicGameKind, type PublicGameView } from "../lib/game/public.ts";
import { scoreAnswers } from "../lib/game/score.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * O'YIN HOLAT MASHINASI (AUDIT-22 WP-C) — `lib/game/engine.ts`.
 *
 * Fayl ikki narsani qulflaydi:
 *
 *   1. HOLAT — har turda qadam, tanlov, progress va taymer qanday
 *      o'zgaradi (jsdom SIZ: dvigatel sof, DOM kerak emas);
 *   2. HALQA — `publicGameView → engine.finish → scoreAnswers` uchidan-
 *      uchiga TO'LIQ ball berishi. Bu eng muhim test: variantlar ochiq
 *      ko'rinishda ATAYLAB aralashtirilgan va agar dvigatel indeksga
 *      qo'l ursa (tartiblasa, asl indeksga o'girsa), server ballni
 *      jimgina noto'g'ri hisoblardi — na `game-public`, na `game-score`
 *      buni ko'rmasdi, chunki ikkalasi ham dvigatelni chaqirmaydi.
 *
 * MUTATSIYALAR (har biri kodda ataylab qilinib, qizargani tasdiqlandi):
 *   1. TARTIB — `normalize()` da `single` javobi oyna qilib saqlandi
 *      (`q.options.length - 1 - i`): 2 test qizardi, shu jumladan
 *      «halqa … TO'LIQ ball». Aynan 1-shartnoma buzilishi;
 *   2. `crosswordSlots` `down` yo'nalishida ham `col + i` bilan yurdi —
 *      3 test qizardi (kataklar, kesishma, halqa);
 *   3. `oneLetter` apostrofni ergashtirmadi (faqat birinchi belgi) —
 *      «`oʻ` bitta katakka sig'adi» qizardi;
 *   4. `move()` `flipped` ni tozalamadi — «kartalar … qadam almashganda
 *      yopiladi» qizardi (o'yinchi keyingi kartaning javobini ko'rardi);
 *   5. `answer()` noto'g'ri qiymatda `INVALID` o'rniga qiymatni yozdi —
 *      5 turning HAMMASIDA test qizardi (6 ta);
 *   6. `answeredCount` krossvordda `every` o'rniga `some` bilan sanadi —
 *      «progress: yarim so'z sanalmaydi» qizardi.
 */

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

function docFor(kind: PublicGameKind): AcademicDoc {
  return kind === "quiz" ? sampleTeacherDoc("test") : sampleGameDoc(kind);
}

function viewOf(kind: PublicGameKind): PublicGameView {
  const v = publicGameView(docFor(kind), kind, { seed: "engine-seed" });
  assert.ok(v, `${kind}: ko'rinish qurilmadi`);
  return v!;
}

/**
 * TO'G'RI javoblarni ochiq ko'rinish TILIDA quradi.
 *
 * Bu — testning yuragi: to'g'ri javob MATNI modeldan olinadi, so'ng
 * uning ochiq (aralashtirilgan) ro'yxatdagi indeksi topiladi. Dvigatel
 * shu indeksni o'zgartirmasdan yuborishi kerak.
 */
function solve(kind: PublicGameKind, view: PublicGameView, doc: AcademicDoc): { id: string; value: unknown }[] {
  const out: { id: string; value: unknown }[] = [];

  if (kind === "quiz" && view.kind === "quiz") {
    for (const q of view.questions) {
      const model = doc.teacher!.test!.questions.find((m) => clean(m.id) === q.id)!;
      if (q.kind === "truefalse") {
        out.push({ id: q.id, value: model.answer as boolean });
      } else if (q.kind === "single") {
        out.push({ id: q.id, value: q.options.indexOf(clean(model.options[model.answer as number])) });
      } else {
        const want = (model.answer as number[]).map((i) => q.options.indexOf(clean(model.options[i])));
        out.push({ id: q.id, value: want });
      }
    }
    return out;
  }

  if (kind === "flashcards" && view.kind === "flashcards") {
    for (const c of view.cards) out.push({ id: c.id, value: true });
    return out;
  }

  if (kind === "sorting" && view.kind === "sorting") {
    for (const cat of doc.game!.sorting!.categories) {
      const catId = clean(cat.id) || publicItemId(cat.name);
      for (const raw of cat.items) out.push({ id: publicItemId(clean(raw)), value: catId });
    }
    return out;
  }

  if (kind === "listening" && view.kind === "listening") {
    for (const it of view.items) {
      const model = doc.game!.listening!.items.find((m) => clean(m.id) === it.id)!;
      out.push({ id: it.id, value: it.options.indexOf(clean(model.options[model.answer])) });
    }
    return out;
  }

  // Krossvord: KATAK kaliti → harf (so'z id → harflar `finish()` da yig'iladi).
  if (view.kind === "crossword") {
    for (const slot of crosswordSlots(view)) {
      const word = doc.game!.crossword!.words.find((w) => w.id === slot.wordId)!;
      slot.cells.forEach((c, i) => out.push({ id: cellKey(c.row, c.col), value: word.answer[i] }));
    }
  }
  return out;
}

/** Barcha to'g'ri javoblarni kiritib, o'yinni yakunlaydi. */
function playAll(kind: PublicGameKind) {
  const doc = docFor(kind);
  const view = viewOf(kind);
  let s = createGame(view, { now: 1_000 });
  for (const { id, value } of solve(kind, view, doc)) s = answer(s, id, value);
  // `...done` ichida YAKUNLANGAN holat keladi (`finishedAt` qo'yilgan) —
  // progress javoblar bilan birga o'zgarmaydi.
  return { doc, view, ...finish(s, { now: 61_000 }) };
}

/* ────────────────────────── qurish va qadamlar ────────────────────────── */

test("createGame: boshlang'ich holat toza va qadam soni turga mos", () => {
  const steps: Record<PublicGameKind, "per-item" | "one"> = {
    quiz: "per-item",
    flashcards: "per-item",
    listening: "per-item",
    crossword: "one",
    sorting: "one",
  };
  for (const [kind, mode] of Object.entries(steps) as [PublicGameKind, "per-item" | "one"][]) {
    const view = viewOf(kind);
    const s = createGame(view, { now: 5 });
    assert.equal(s.kind, kind);
    assert.equal(s.index, 0, `${kind}: birinchi qadam`);
    assert.deepEqual(s.answers, {}, `${kind}: javoblar bo'sh`);
    assert.equal(s.finishedAt, null, `${kind}: tugamagan`);
    assert.equal(s.flipped, false);
    assert.equal(s.picked, null);
    assert.equal(s.startedAt, 5);
    assert.equal(s.steps, stepsOf(view));
    if (mode === "one") assert.equal(s.steps, 1, `${kind}: bitta ekran`);
    else assert.ok(s.steps > 1, `${kind}: elementma-element`);
  }
});

test("next/prev: chegaradan chiqmaydi, `isLast` oxirgi qadamda", () => {
  const s0 = createGame(viewOf("quiz"), { now: 0 });
  assert.equal(prev(s0), s0, "birinchi qadamdan orqaga — O'ZGARMAYDI (yangi obyekt ham emas)");
  let s = s0;
  for (let i = 0; i < s0.steps * 2; i++) s = next(s);
  assert.equal(s.index, s0.steps - 1, "oxirgi qadamda to'xtaydi");
  assert.ok(isLast(s));
  assert.ok(!isLast(s0));
  assert.equal(goTo(s, -5).index, 0, "goTo ham qisqartiriladi");
});

test("krossvord/saralash: bitta ekran — `next` qadamni o'zgartirmaydi", () => {
  for (const kind of ["crossword", "sorting"] as const) {
    const s = createGame(viewOf(kind), { now: 0 });
    assert.equal(next(s), s, `${kind}: keyingi qadam yo'q`);
    assert.ok(isLast(s), `${kind}: birdan oxirgi`);
  }
});

/* ────────────────────────── quiz ────────────────────────── */

test("quiz single: ochiq indeks yoziladi, chegaradan tashqarisi rad etiladi", () => {
  const view = viewOf("quiz");
  assert.equal(view.kind, "quiz");
  const q = view.kind === "quiz" ? view.questions.find((x) => x.kind === "single")! : null!;
  const s0 = createGame(view, { now: 0 });
  const s1 = answer(s0, q.id, 2);
  assert.equal(answerOf(s1, q.id), 2);
  assert.equal(answer(s1, q.id, 2), s1, "bir xil qiymat — holat o'zgarmaydi (idempotent)");
  assert.equal(answer(s1, q.id, q.options.length), s1, "chegaradan tashqari indeks rad etiladi");
  assert.equal(answer(s1, q.id, -1), s1, "manfiy indeks rad etiladi");
  assert.equal(answer(s1, "yo'q-id", 0), s1, "notanish id rad etiladi");
});

test("quiz multi: `toggleIndex` to'plamni yig'adi, bo'shashi javobni o'chiradi", () => {
  const view = viewOf("quiz");
  const q = view.kind === "quiz" ? view.questions.find((x) => x.kind === "multi")! : null!;
  let s = createGame(view, { now: 0 });
  s = answer(s, q.id, toggleIndex(answerOf(s, q.id), 0));
  s = answer(s, q.id, toggleIndex(answerOf(s, q.id), 2));
  assert.deepEqual(answerOf(s, q.id), [0, 2]);
  s = answer(s, q.id, toggleIndex(answerOf(s, q.id), 0));
  assert.deepEqual(answerOf(s, q.id), [2], "qayta bosish belgini oladi");
  s = answer(s, q.id, toggleIndex(answerOf(s, q.id), 2));
  assert.ok(!(q.id in s.answers), "bo'sh to'plam — javob umuman yozilmaydi");
});

test("quiz truefalse: faqat boolean, variantlar ro'yxati bo'sh", () => {
  const view = viewOf("quiz");
  const q = view.kind === "quiz" ? view.questions.find((x) => x.kind === "truefalse")! : null!;
  assert.deepEqual(q.options, [], "«To'g'ri/Noto'g'ri» tugmasi ekranda, ro'yxatda emas");
  const s0 = createGame(view, { now: 0 });
  assert.equal(answer(s0, q.id, 0), s0, "indeks rad etiladi");
  assert.equal(answer(s0, q.id, "true"), s0, "satr rad etiladi");
  assert.equal(answerOf(answer(s0, q.id, false), q.id), false, "`false` ham HAQIQIY javob");
});

test("quiz: `open`/`match` savollari umuman ekranga chiqmaydi", () => {
  const view = viewOf("quiz");
  const model = docFor("quiz").teacher!.test!.questions;
  assert.ok(
    model.some((q) => q.kind === "open" || q.kind === "match"),
    "namunada o'ynalmaydigan savol bor (aks holda test hech narsani sinamaydi)",
  );
  const shown = view.kind === "quiz" ? view.questions.length : 0;
  assert.ok(shown < model.length, "o'ynalmaydiganlari tushib qolgan");
  assert.equal(stepsOf(view), shown, "qadam soni ekrandagi savollarga teng");
  assert.equal(view.total, shown, "`total` ham shu — server ham shuni sanaydi");
});

/* ────────────────────────── krossvord ────────────────────────── */

test("krossvord: kataklar raqam va yo'nalishdan tiklanadi", () => {
  const view = viewOf("crossword");
  assert.equal(view.kind, "crossword");
  const slots = crosswordSlots(view as Extract<PublicGameView, { kind: "crossword" }>);
  assert.equal(slots.length, view.total, "har so'zga bitta yo'l");
  for (const slot of slots) {
    assert.equal(slot.cells.length, slot.length, `${slot.wordId}: uzunlik mos`);
    const first = slot.cells[0]!;
    for (const [i, c] of slot.cells.entries()) {
      if (slot.dir === "across") {
        assert.equal(c.row, first.row, "gorizontal — qator o'zgarmaydi");
        assert.equal(c.col, first.col + i, "gorizontal — ustun o'sadi");
      } else {
        assert.equal(c.col, first.col, "vertikal — ustun o'zgarmaydi");
        assert.equal(c.row, first.row + i, "vertikal — qator o'sadi");
      }
    }
  }
});

test("krossvord: kesishgan katak IKKI so'zga tegishli va bitta harf bilan to'ladi", () => {
  const view = viewOf("crossword") as Extract<PublicGameView, { kind: "crossword" }>;
  const slots = crosswordSlots(view);
  const seen = new Map<string, string[]>();
  for (const slot of slots) for (const c of slot.cells) seen.set(cellKey(c.row, c.col), [...(seen.get(cellKey(c.row, c.col)) ?? []), slot.wordId]);
  const shared = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  assert.ok(shared.length > 0, "namunaviy to'rda kesishma bor");

  const [key, ids] = shared[0]!;
  const s = answer(createGame(view, { now: 0 }), key, "X");
  const out = finish(s, { now: 1_000 }).answers;
  for (const id of ids) assert.ok(String(out[id]).includes("X"), `${id}: kesishgan harf ikkala so'zda`);
});

test("krossvord: `oʻ` BITTA katakka sig'adi, to'r tashqarisi rad etiladi", () => {
  const view = viewOf("crossword") as Extract<PublicGameView, { kind: "crossword" }>;
  const slot = crosswordSlots(view)[0]!;
  const key = cellKey(slot.cells[0]!.row, slot.cells[0]!.col);
  const s0 = createGame(view, { now: 0 });

  assert.equal(answerOf(answer(s0, key, "oʻ"), key), "Oʻ", "apostrofli harf — bitta katak, katta harf");
  assert.equal(answerOf(answer(s0, key, "abc"), key), "A", "ortiqcha belgilar tushadi");
  assert.equal(answer(s0, cellKey(view.grid.rows + 5, 0), "A"), s0, "to'rdan tashqari katak rad etiladi");
  assert.equal(answer(s0, "salom", "A"), s0, "katak kaliti bo'lmagan id rad etiladi");

  const filled = answer(s0, key, "A");
  assert.ok(!(key in answer(filled, key, "   ").answers), "bo'sh qiymat katakni tozalaydi");
});

/* ────────────────────────── kartalar ────────────────────────── */

test("kartalar: ag'darish, «bildim/bilmadim», qadam almashganda yopiladi", () => {
  const view = viewOf("flashcards");
  const card = view.kind === "flashcards" ? view.cards[0]! : null!;
  let s = createGame(view, { now: 0 });
  assert.equal(s.flipped, false);
  s = flip(s);
  assert.equal(s.flipped, true, "karta ochildi");
  s = answer(s, card.id, true);
  assert.equal(answerOf(s, card.id), true);
  s = next(s);
  assert.equal(s.flipped, false, "keyingi karta YOPIQ keladi");
  assert.equal(s.index, 1);
  assert.equal(answer(s, card.id, 1), s, "boolean bo'lmagan qiymat rad etiladi");
});

test("`flip`/`pick` faqat o'z turida ishlaydi", () => {
  const quiz = createGame(viewOf("quiz"), { now: 0 });
  assert.equal(flip(quiz), quiz, "testda ag'dariladigan karta yo'q");
  assert.equal(pick(quiz, "x"), quiz, "testda qo'lga olinadigan element yo'q");
  const cards = createGame(viewOf("flashcards"), { now: 0 });
  assert.equal(pick(cards, "x"), cards, "kartalarda `pick` yo'q");
});

/* ────────────────────────── saralash ────────────────────────── */

test("saralash: tanlab-joylash (`pick` → `place`) va notanish toifa rad etiladi", () => {
  const view = viewOf("sorting") as Extract<PublicGameView, { kind: "sorting" }>;
  const item = view.items[0]!;
  const cat = view.categories[0]!;
  let s = createGame(view, { now: 0 });

  assert.equal(place(s, cat.id), s, "qo'l bo'sh — joylash ish bermaydi");
  s = pick(s, item.id);
  assert.equal(s.picked, item.id);
  assert.equal(pick(s, item.id).picked, null, "qayta bosish tanlovni bekor qiladi");
  assert.equal(pick(s, "yo'q").picked, item.id, "notanish element tanlovni buzmaydi");

  s = place(s, cat.id);
  assert.equal(answerOf(s, item.id), cat.id);
  assert.equal(s.picked, null, "joylashdan keyin qo'l bo'shaydi");
  assert.equal(answer(s, item.id, "yo'q-toifa"), s, "notanish toifa rad etiladi");
  assert.ok(!(item.id in answer(s, item.id, null).answers), "`null` — elementni taxtaga qaytaradi");
});

/* ────────────────────────── tinglash ────────────────────────── */

test("tinglash: variant indeksi yoziladi, audio yo'qligi o'yinni to'xtatmaydi", () => {
  const view = viewOf("listening") as Extract<PublicGameView, { kind: "listening" }>;
  const it = view.items[0]!;
  const s0 = createGame(view, { now: 0 });
  assert.equal(answerOf(answer(s0, it.id, 1), it.id), 1);
  assert.equal(answer(s0, it.id, it.options.length), s0, "variantdan tashqari indeks rad etiladi");
  assert.equal(answer(s0, it.id, "salom"), s0, "son bo'lmagan qiymat rad etiladi");
  // `<input value>` dan kelgan satr SONGA aylantiriladi — `score.ts`
  // `asIndex` ham aynan shunday qiladi, ya'ni payload shakli (`number`)
  // ikki tomonda bir xil qoladi.
  assert.equal(answerOf(answer(s0, it.id, "1"), it.id), 1, "raqamli satr songa aylanadi");
  // WP-A gacha TTS yo'q — `audioAssetId` bo'lmasa ham qadam va javob ishlaydi.
  assert.equal(s0.steps, view.items.length, "audio bo'lmasa ham har topshiriq qadam");
});

/* ────────────────────────── progress va taymer ────────────────────────── */

test("progress: javob berilgan ELEMENTLAR sanaladi, yarim so'z sanalmaydi", () => {
  const view = viewOf("crossword") as Extract<PublicGameView, { kind: "crossword" }>;
  const slot = crosswordSlots(view).find((s) => s.cells.length > 1)!;
  let s = createGame(view, { now: 0 });
  assert.deepEqual(progress(s), { done: 0, total: view.total, percent: 0 });

  s = answer(s, cellKey(slot.cells[0]!.row, slot.cells[0]!.col), "A");
  assert.equal(answeredCount(s), 0, "bitta harf — so'z hali to'lmagan");
  for (const c of slot.cells) s = answer(s, cellKey(c.row, c.col), "A");
  assert.ok(answeredCount(s) >= 1, "to'lgan so'z sanaladi");
});

test("progress: to'liq o'ynalgan o'yinda 100 %", () => {
  for (const kind of ["quiz", "crossword", "flashcards", "sorting", "listening"] as const) {
    const { state, view } = playAll(kind);
    assert.deepEqual(progress(state), { done: view.total, total: view.total, percent: 100 }, `${kind}: progress to'liq`);
  }
});

test("taymer: faqat o'lchaydi, `finish` ikki marta bosilsa vaqt o'zgarmaydi", () => {
  const s = createGame(viewOf("quiz"), { now: 10_000 });
  assert.equal(elapsed(s, 70_000), 60, "davom etayotgan o'yin — joriy vaqtgacha");
  const a = finish(s, { now: 70_000 });
  assert.equal(a.seconds, 60);
  assert.equal(a.state.finishedAt, 70_000);
  const b = finish(a.state, { now: 999_000 });
  assert.equal(b.seconds, 60, "yakunlangan o'yin vaqti QOTADI");
  assert.equal(b.state, a.state, "ikkinchi yakunlash yangi holat yasamaydi");
  assert.equal(answer(a.state, "x", 0), a.state, "yakunlangandan keyin javob qabul qilinmaydi");

  const skewed = createGame(viewOf("quiz"), { now: 5_000_000 });
  assert.equal(elapsed(skewed, 0), 0, "brauzer soati orqaga ketsa — manfiy emas");
  assert.equal(elapsed(createGame(viewOf("quiz"), { now: 0 }), 999_999_999), 86_400, "yuqori chegara");
});

/* ────────────────────────── payload va halqa ────────────────────────── */

test("payload: har turda `scoreAnswers` kutgan SHAKL", () => {
  const shape: Record<PublicGameKind, (v: unknown) => boolean> = {
    quiz: (v) => typeof v === "number" || typeof v === "boolean" || Array.isArray(v),
    crossword: (v) => typeof v === "string",
    flashcards: (v) => typeof v === "boolean",
    sorting: (v) => typeof v === "string",
    listening: (v) => typeof v === "number",
  };
  for (const kind of Object.keys(shape) as PublicGameKind[]) {
    const { answers, view } = playAll(kind);
    const keys = Object.keys(answers);
    assert.equal(keys.length, view.total, `${kind}: har element uchun bitta yozuv`);
    for (const k of keys) assert.ok(shape[kind](answers[k]), `${kind}: ${k} shakli noto'g'ri — ${JSON.stringify(answers[k])}`);
  }
});

test("halqa: `publicGameView → engine.finish → scoreAnswers` TO'LIQ ball beradi", () => {
  for (const kind of ["quiz", "crossword", "flashcards", "sorting", "listening"] as const) {
    const { doc, answers, view } = playAll(kind);
    const scored = scoreAnswers(doc, kind, answers);
    assert.equal(scored.total, view.total, `${kind}: jami mos`);
    assert.equal(scored.score, scored.total, `${kind}: hamma javob to'g'ri — dvigatel tartibga TEGMAGAN`);
  }
});

test("halqa: bo'sh o'yin 0 ball, bitta xato javob aynan 1 ball kamaytiradi", () => {
  const doc = docFor("listening");
  const view = viewOf("listening") as Extract<PublicGameView, { kind: "listening" }>;
  const empty = scoreAnswers(doc, "listening", finish(createGame(view, { now: 0 }), { now: 1 }).answers);
  assert.equal(empty.score, 0, "javobsiz o'yin — 0");
  assert.equal(empty.total, view.total);

  const right = solve("listening", view, doc);
  let s = createGame(view, { now: 0 });
  for (const { id, value } of right) s = answer(s, id, value);
  const first = right[0]!;
  const wrong = (Number(first.value) + 1) % view.items[0]!.options.length;
  s = answer(s, first.id, wrong);
  const scored = scoreAnswers(doc, "listening", finish(s, { now: 1 }).answers);
  assert.equal(scored.score, view.total - 1, "bitta xato — aynan bitta ball");
  assert.equal(scored.results[first.id], false);
});
