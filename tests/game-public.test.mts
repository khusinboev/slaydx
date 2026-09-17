import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_GAME_KINDS,
  isPublicGameKind,
  publicGameKindOf,
  publicGameView,
  publicItemId,
  publicOptionOrder,
  shuffled,
  type PublicGameKind,
} from "../lib/game/public.ts";
import { sampleGameDoc } from "../lib/generation/games/samples.ts";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * O'YINCHI KO'RADIGAN MA'LUMOT (AUDIT-22 R0) — «JAVOB SIZMAYDI».
 *
 * Bu fayl `lib/game/public.ts` ning YAGONA va'dasini qulflaydi: ochiq
 * havolada (`/api/o/[token]`, loginsiz) to'g'ri javob CHIQMAYDI. Har
 * kind uchun tekshiruv ikki qavat:
 *
 *   1. UMUMIY skan — ko'rinish JSON ida taqiqlangan KALIT yo'q
 *      (`answer`, `back`, `explanation`, `items`, `solution`);
 *   2. TURGA XOS skan — javob MATNI (krossvord harflari, kartaning
 *      orqa yuzi, elementning toifasi) JSON da umuman uchramaydi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `publicGameView` da krossvord `cells` ni `cw.grid.cells` dan
 *      nusxaladi (harflar bilan) — «krossvord harflari sizmaydi»;
 *   2. saralash `categories` ga `items` qo'shildi — «toifa elementlari
 *      sizmaydi» va umumiy kalit skani;
 *   3. tinglash elementiga `answer` qo'shildi — umumiy kalit skani;
 *   4. karta ko'rinishiga `back` qo'shildi — «orqa yuz sizmaydi»;
 *   5. test savoliga `answer` qoldirildi — umumiy kalit skani;
 *   6. `publicItemId` tartib indeksidan yasaldi (`i0…iN`) — «id javobni
 *      oshkor qilmaydi» testi;
 *   7. `publicOptionOrder` aynan tartibni qaytardi (aralashtirmadi) —
 *      «variantlar aralashtiriladi» testi;
 *   8. kartaning `back` maydoni boshqa kindda ham (masalan tinglashda)
 *      chiqarilsa — «`back` FAQAT flashcards da» testi;
 *   9. tinglash elementidagi `text` tushib qolsa — «matn (`text`) yo'q
 *      yoki boshqacha» testi (audiosiz rejim ishlamay qolardi).
 */

const KINDS: PublicGameKind[] = [...PUBLIC_GAME_KINDS];

/** Har kind uchun namunaviy hujjat (test — o'qituvchi oilasidan). */
function docFor(kind: PublicGameKind): AcademicDoc {
  if (kind === "quiz") return sampleTeacherDoc("test");
  return sampleGameDoc(kind);
}

function viewOf(kind: PublicGameKind) {
  const v = publicGameView(docFor(kind), kind, { seed: "seed-1" });
  assert.ok(v, `${kind}: ko'rinish qurilmadi`);
  return v!;
}

/** Ko'rinishdagi HAR kalitni yig'adi (ichma-ich). */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const x of v) keysOf(x, out);
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  }
  return out;
}

/**
 * Taqiqlangan kalitlar — javobga olib boradigan har qanday maydon.
 *
 * `items` bu ro'yxatda YO'Q, chunki u ochiq ko'rinishning O'ZIDA bor
 * (saralash elementlari, tinglash topshiriqlari). Uning XAVFLI shakli —
 * TOIFA ichidagi `items` (element ↔ toifa bog'i); u pastdagi maxsus
 * tekshiruv bilan ushlanadi.
 */
/*
 * `back` bu ro'yxatda YO'Q: u ENDI `flashcards` da ATAYLAB chiqadi
 * (o'zini tekshirish, `PublicCard` izohi) — umumiy taqiqdan chiqarilib,
 * pastdagi «UMUMIY» testda kind bo'yicha alohida tekshiriladi.
 */
const FORBIDDEN_KEYS = ["answer", "answers", "solution", "explanation", "correct", "key"];

/** Obyektda bir vaqtda `name` va `items` bo'lsa — element↔toifa bog'i sizgan. */
function leaksCategoryItems(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(leaksCategoryItems);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("name" in o && "items" in o) return true;
    return Object.values(o).some(leaksCategoryItems);
  }
  return false;
}

test("HAR kind uchun ko'rinish quriladi va vosita xaritasi ikki tomonlama", () => {
  assert.deepEqual([...PUBLIC_GAME_KINDS], ["quiz", "crossword", "flashcards", "sorting", "listening"]);
  assert.equal(publicGameKindOf("test"), "quiz");
  assert.equal(publicGameKindOf("crossword"), "crossword");
  assert.equal(publicGameKindOf("sorting"), "sorting");
  assert.equal(publicGameKindOf("listening"), "listening");
  assert.equal(publicGameKindOf("flashcards"), "flashcards");
  // O'ynalmaydigan vositalar — `null` (share route ularni 400 qiladi).
  for (const id of ["podcast", "greeting", "referat", "lesson-plan", "infographic", ""]) {
    assert.equal(publicGameKindOf(id), null, `${id}: o'yin bo'lib qoldi`);
  }
  assert.ok(isPublicGameKind("quiz"));
  assert.ok(!isPublicGameKind("audio"));
  for (const kind of KINDS) {
    const v = viewOf(kind);
    assert.equal(v.kind, kind);
    assert.ok(v.total > 0, `${kind}: total 0`);
    assert.ok(v.title.length > 0, `${kind}: sarlavha yo'q`);
  }
});

test("UMUMIY: hech bir kind ko'rinishida javobga olib boradigan KALIT yo'q", () => {
  for (const kind of KINDS) {
    const keys = keysOf(viewOf(kind));
    for (const bad of FORBIDDEN_KEYS) {
      assert.ok(!keys.has(bad), `MUTATSIYA: ${kind} ko'rinishida «${bad}» maydoni bor — javob sizadi`);
    }
    assert.ok(!leaksCategoryItems(viewOf(kind)), `MUTATSIYA: ${kind} da toifa o'z elementlari bilan berildi`);
    // MUTATSIYA (8): `back` faqat flashcards da — boshqa hech bir kindda emas.
    if (kind !== "flashcards") assert.ok(!keys.has("back"), `MUTATSIYA: ${kind} da «back» maydoni bor`);
  }
});

test("TEST (quiz): savol + variantlar, to'g'ri variant belgilanmaydi", () => {
  const doc = docFor("quiz");
  const v = viewOf("quiz");
  assert.equal(v.kind, "quiz");
  const model = doc.teacher!.test!;
  const playable = model.questions.filter((q) => q.kind === "single" || q.kind === "multi" || q.kind === "truefalse");
  assert.ok(playable.length > 0, "namunaviy testda o'ynaladigan savol yo'q");
  assert.equal(v.total, playable.length, "o'ynalmaydigan (open/match) savollar `total` ga qo'shildi");
  for (const q of v.questions) {
    assert.ok(q.stem.length > 0);
    assert.ok(!("answer" in (q as object)), `${q.id}: javob maydoni bor`);
    if (q.kind === "truefalse") assert.deepEqual(q.options, []);
    else assert.ok(q.options.length >= 2, `${q.id}: variantlar kam`);
  }
  // `open`/`match` savollar ochiq ko'rinishga UMUMAN tushmaydi.
  const openIds = model.questions.filter((q) => q.kind === "open" || q.kind === "match").map((q) => q.id);
  for (const id of openIds) assert.ok(!v.questions.some((q) => q.id === id), `${id}: avtomatik baholanmaydigan savol o'yinga tushdi`);
});

test("KROSSVORD: to'r SHAKLI va savollar, HARFLAR sizmaydi", () => {
  const doc = docFor("crossword");
  const v = viewOf("crossword");
  assert.equal(v.kind, "crossword");
  const json = JSON.stringify(v);
  const cw = doc.game!.crossword!;
  assert.ok(cw.words.length > 0);
  // MUTATSIYA: `cells` ni harflar bilan berish shu yerda qizaradi.
  for (const w of cw.words) {
    const answer = w.answer.join("");
    assert.ok(!json.includes(answer), `MUTATSIYA: «${answer}» javobi ochiq ko'rinishda`);
  }
  // Katak — BOOLEAN, harf emas.
  for (const row of v.grid.cells) for (const cell of row) assert.equal(typeof cell, "boolean");
  assert.equal(v.grid.cells.length, cw.grid.rows);
  // Raqamlar va savollar bor — o'yinchi to'rni chiza olishi kerak.
  assert.ok(v.grid.numbers.length > 0);
  assert.ok(v.clues.across.length + v.clues.down.length > 0);
  for (const c of [...v.clues.across, ...v.clues.down]) {
    assert.ok(c.length > 0 && c.number > 0 && c.text.length > 0);
  }
});

test("KARTALAR: old yuz + orqa yuz (o'zini tekshirish) — misol/maslahat sizmaydi", () => {
  const doc = docFor("flashcards");
  const v = viewOf("flashcards");
  assert.equal(v.kind, "flashcards");
  if (v.kind !== "flashcards") return;
  const cards = doc.game!.cards!.cards;
  const pcCards = v.cards;
  assert.equal(v.total, cards.length);
  const json = JSON.stringify(v);
  for (const [i, c] of cards.entries()) {
    const pc = pcCards[i]!;
    assert.equal(pc.front, c.front.replace(/\s+/g, " ").trim(), `«${c.front}» old yuzi yo'q yoki boshqacha`);
    /*
     * MUTATSIYA (8): `back` ENDI ochiq ko'rinishda — bu javob SIZISHI
     * EMAS. Kartalarda server tekshiradigan «to'g'ri javob» umuman yo'q
     * (`score.ts`): ball o'yinchi o'zi bosgan «bildim» soni va orqa yuz
     * bilan hech qachon solishtirilmaydi. Shuning uchun bu yerda
     * TESKARI tekshiruv — `back` YO'Q bo'lib qolsa (ya'ni dvigatel uni
     * yana yashirsa), o'zini tekshirish ekrani ishlamay qoladi.
     */
    assert.equal(pc.back, c.back.replace(/\s+/g, " ").trim(), `«${c.back.slice(0, 30)}…» orqa yuzi yo'q yoki boshqacha`);
    assert.deepEqual(Object.keys(pc).sort(), ["back", "front", "id"], `MUTATSIYA: kartada ortiqcha maydon — ${JSON.stringify(pc)}`);
    // Misol/maslahat — o'zini tekshirish uchun shart emas, hamon sizmaydi.
    if (c.example) assert.ok(!json.includes(c.example), "misol qatori sizdi");
    if (c.hint) assert.ok(!json.includes(c.hint), "maslahat sizdi");
  }
});

test("SARALASH: toifalar NOMI + aralashtirilgan elementlar; element↔toifa bog'i sizmaydi", () => {
  const doc = docFor("sorting");
  const v = viewOf("sorting");
  assert.equal(v.kind, "sorting");
  const model = doc.game!.sorting!;
  assert.equal(v.categories.length, model.categories.length);
  for (const c of v.categories) {
    assert.deepEqual(Object.keys(c).sort(), ["id", "name"], `MUTATSIYA: toifada ortiqcha maydon — ${JSON.stringify(c)}`);
  }
  // Har element ro'yxatda BIR marta va o'z toifasini bildirmaydi.
  const flat = model.categories.flatMap((c) => c.items);
  assert.equal(v.items.length, flat.length);
  assert.deepEqual([...v.items.map((i) => i.text)].sort(), [...flat].sort());
  for (const it of v.items) assert.deepEqual(Object.keys(it).sort(), ["id", "text"]);
  /*
   * MUTATSIYA (id tartibdan): elementlar modelda TOIFA bo'yicha
   * guruhlangan — id `i0…iN` bo'lsa, «birinchi uchtasi birinchi toifa»
   * degani javob bo'lardi. Id lar toifa id sini ham, tartibni ham
   * saqlamasligi kerak.
   */
  for (const it of v.items) {
    assert.equal(it.id, publicItemId(it.text), "element id si matndan olinmagan");
    assert.ok(!/^i\d+$/.test(it.id), `MUTATSIYA: id tartib indeksi — ${it.id}`);
    for (const c of v.categories) assert.ok(!it.id.includes(c.id), "id toifa id sini o'z ichiga oladi");
  }
});

test("SARALASH: elementlar ARALASHTIRILGAN va tartib sessiya tokeniga bog'liq", () => {
  const doc = docFor("sorting");
  const flat = doc.game!.sorting!.categories.flatMap((c) => c.items);
  const a = publicGameView(doc, "sorting", { seed: "token-a" })!;
  const b = publicGameView(doc, "sorting", { seed: "token-b" })!;
  const orderOf = (v: typeof a) => (v.kind === "sorting" ? v.items.map((i) => i.text) : []);
  // Model tartibi bilan bir xil bo'lib qolmasin (aks holda birinchi
  // uchtasi birinchi toifa ekani ko'rinib turardi).
  assert.notDeepEqual(orderOf(a), flat, "MUTATSIYA: elementlar aralashtirilmadi");
  assert.notDeepEqual(orderOf(a), orderOf(b), "ikki havolada tartib bir xil — o'quvchilar ko'chira olardi");
  // Bir xil urug' — bir xil tartib (sahifa qayta yuklansa o'yin sakramasin).
  assert.deepEqual(orderOf(publicGameView(doc, "sorting", { seed: "token-a" })!), orderOf(a));
});

test("TINGLASH: audio id + variantlar; to'g'ri javob indeksi sizmaydi", () => {
  const doc = docFor("listening");
  const v = viewOf("listening");
  assert.equal(v.kind, "listening");
  const model = doc.game!.listening!;
  assert.equal(v.total, model.items.length);
  for (const [i, it] of v.items.entries()) {
    const src = model.items[i];
    assert.deepEqual(Object.keys(it).sort(), src.audioAssetId ? ["audioAssetId", "id", "options", "text"] : ["id", "options", "text"]);
    /*
     * MUTATSIYA (9): `text` tushib qolsa (yoki bo'sh bo'lsa) — audio
     * yo'q/yiqilgan holatda o'yinchi tomoni o'qib javob berolmay
     * qoladi (`Listening.tsx` «Tinglab bo'lmadi — o'qing»). `text` —
     * eshitiladigan matn (`targetLanguage`), JAVOB EMAS: to'g'ri javob
     * `options` ichida, boshqa (ona) tilda.
     */
    assert.equal(it.text, src.text.replace(/\s+/g, " ").trim(), "matn (`text`) yo'q yoki boshqacha");
    // Variantlar to'plami saqlanadi, TARTIB esa boshqa (aralashtirilgan).
    assert.deepEqual([...it.options].sort(), [...src.options].sort(), "variantlar to'plami o'zgardi");
    /*
     * MUTATSIYA: `publicOptionOrder` ni aynan tartib bilan almashtirish —
     * model to'g'ri javobni tizimli ravishda bir joyga qo'ysa (masalan
     * doim 0-indeks), o'yinchi buni darrov payqardi.
     */
    const order = publicOptionOrder(it.id, src.options.length);
    assert.deepEqual(it.options, order.map((k) => src.options[k]), "tartib `publicOptionOrder` bilan mos emas");
  }
  // Kamida bitta elementda tartib O'ZGARGAN bo'lsin (aralashtirish ishlayotgani).
  assert.ok(
    v.items.some((it, i) => it.options.join("|") !== model.items[i].options.join("|")),
    "MUTATSIYA: hech bir element aralashtirilmadi",
  );
});

test("model bo'sh yoki boshqa kind bo'lsa — `null` (route uni 404 qiladi)", () => {
  const cw = docFor("crossword");
  // Krossvord hujjati «saralash» deb so'ralsa — ko'rinish yo'q.
  assert.equal(publicGameView(cw, "sorting"), null);
  assert.equal(publicGameView(cw, "listening"), null);
  assert.equal(publicGameView(cw, "quiz"), null, "o'qituvchi testi bo'lmagan hujjat quiz bo'ldi");
  // Bo'sh hujjat.
  const empty = { meta: { topic: "X", language: "uz" }, titlePage: false, toc: false, sections: [] } as unknown as AcademicDoc;
  for (const kind of KINDS) assert.equal(publicGameView(empty, kind), null, `${kind}: bo'sh hujjatdan ko'rinish qurildi`);
});

test("determinizm: `publicItemId` va `shuffled` sof funksiyalar", () => {
  assert.equal(publicItemId("Mushuk"), publicItemId("  mushuk  "), "id normallashtirilmagan");
  assert.notEqual(publicItemId("Mushuk"), publicItemId("It"));
  assert.match(publicItemId("Mushuk"), /^i[0-9a-z]+$/);
  const src = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(shuffled(src, "x"), shuffled(src, "x"));
  assert.notDeepEqual(shuffled(src, "x"), shuffled(src, "y"));
  assert.deepEqual([...shuffled(src, "x")].sort(), src, "aralashtirish element yo'qotdi");
  // ASL massiv o'zgarmaydi.
  assert.deepEqual(src, ["a", "b", "c", "d", "e", "f"]);
  // Variantlar tartibi — butun almashtirish (permutatsiya).
  const order = publicOptionOrder("i1", 4);
  assert.deepEqual([...order].sort(), [0, 1, 2, 3]);
  assert.deepEqual(publicOptionOrder("i1", 4), order);
});

test("izomorf: `lib/game/public.ts` server moduliga ulanmaydi", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/game/public.ts", import.meta.url), "utf8");
  assert.ok(!/from "\.\.\/server\//.test(src), "server moduli import qilingan");
  assert.ok(!/^import .*(node:|server-only)/m.test(src), "Node/server moduli import qilingan — klient bandliga kira olmaydi");
});
