import test from "node:test";
import assert from "node:assert/strict";
import { GAME_FORM_FIELDS, GAME_PARAMS, gameParamsOf, type GameParamImpact } from "../lib/generation/game-params.ts";
import { GAME_KINDS } from "../lib/generation/games/types.ts";
import { crosswordInputFromValues } from "../lib/generation/games/crossword/input.ts";
import type { FormValues } from "../lib/types.ts";
import type { DocMeta } from "../lib/generation/types.ts";

/**
 * «BEZAK MAYDON YO'Q» reyestri — bosma o'yinlar (AUDIT-21 R0/WP-A).
 *
 * `teacher-params.test.mts` naqshi. Farqi: krossvordning kirishi
 * (`crosswordInputFromValues`) WP-A da ALLAQACHON tayyor, shuning uchun
 * differensial zond unga qarshi HAQIQIY ishlaydi. Flesh kartalarniki
 * (`games/flashcards/input.ts`) WP-B da yoziladi — hali yo'q bo'lsa
 * dinamik import bilan sinab ko'riladi va topilmasa parametr
 * `ENGINE_NOT_WIRED` ro'yxatiga yozilib O'TKAZIB YUBORILADI (AUDIT-20
 * naqshi: dvigatelsiz zond «yolg'on qizil» bermasligi kerak — bu ham
 * «yolg'on yashil» bermasligi kerak, shuning uchun REYESTR bandi
 * baribir sinaladi, faqat ZOND o'zi kutiladi).
 */

test("har parametr unikal id ga ega va shakli to'g'ri", () => {
  const ids = GAME_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, `takroriy id: ${ids.filter((v, i) => ids.indexOf(v) !== i).join(", ")}`);
  assert.deepEqual(GAME_FORM_FIELDS, ids);
  for (const p of GAME_PARAMS) {
    assert.ok(/^[a-zA-Z][a-zA-Z0-9]*$/.test(p.id), `${p.id}: forma maydon nomi shakli`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond juftligi bir xil — farqni o'lchab bo'lmaydi`);
  }
});

test("har parametrning egasi va TA'SIRI bor; noma'lum kind yo'q", () => {
  for (const p of GAME_PARAMS) {
    assert.ok(p.kinds.length > 0, `${p.id}: hech qaysi vositaga tegishli emas`);
    for (const k of p.kinds) assert.ok((GAME_KINDS as readonly string[]).includes(k), `${p.id}: noma'lum kind ${k}`);
    assert.equal(new Set(p.kinds).size, p.kinds.length, `${p.id}: takroriy kind`);
    assert.ok(p.impacts.length > 0, `${p.id}: «bezak maydon» — impacts bo'sh`);
    assert.equal(new Set(p.impacts).size, p.impacts.length, `${p.id}: takroriy impact`);
  }
  // Har vositada kamida mavzu + til + o'z parametrlari bo'lsin.
  for (const kind of GAME_KINDS) {
    const own = gameParamsOf(kind);
    assert.ok(own.length >= 3, `${kind}: ${own.length} parametr — juda kam`);
    assert.ok(own.some((p) => p.id === "topic"), `${kind}: «topic» yo'q`);
    /*
     * AUDIT-22: tinglash o'yinida bitta «Til» o'rniga JUFTLIK bor
     * (`nativeLanguage` + `targetLanguage`) — uchinchi maydon u yerda
     * hech narsaga ta'sir qilmasdi («bezak maydon yo'q»).
     */
    const langIds = own.map((p) => p.id);
    assert.ok(langIds.includes("language") || (langIds.includes("nativeLanguage") && langIds.includes("targetLanguage")), `${kind}: til so'ralmaydi`);
  }
  // Krossvord — fayl rejimi tufayli boyroq forma (mode/sourceText qo'shimcha).
  assert.ok(gameParamsOf("crossword").length > gameParamsOf("flashcards").length);
});

test("narx HECH BIR parametrga bog'liq emas (egasi qarori 6 — ikkalasi ham tekis 2 000)", () => {
  // `GameParamImpact` ITTIFOQIDA «price» umuman yo'q — tur darajasida qulflangan;
  // baribir RUNTIME da ham tekshiramiz (kimdir ittifoqni kengaytirsa ham ushlansin).
  const impacts = new Set<string>(GAME_PARAMS.flatMap((p) => p.impacts as readonly string[]));
  assert.ok(!impacts.has("price"), "MUTATSIYA: biror parametr narxga ta'sir qilsa, tekis narx va'dasi buziladi");
  const KNOWN: readonly GameParamImpact[] = ["prompt", "structure", "layout", "grid", "review", "source", "language", "budget"];
  for (const p of GAME_PARAMS) for (const im of p.impacts) assert.ok((KNOWN as readonly string[]).includes(im), `${p.id}: noma'lum impact ${im}`);
});

test("`probeWith` faqat reyestrda bor parametrga ishora qiladi (shartli maydon)", () => {
  for (const p of GAME_PARAMS.filter((x) => x.probeWith)) {
    const keys = Object.keys(p.probeWith!);
    assert.ok(keys.length > 0, `${p.id}: bo'sh probeWith`);
    for (const k of keys) assert.ok(GAME_PARAMS.some((x) => x.id === k), `${p.id}: probeWith «${k}» reyestrda yo'q`);
  }
  // `sourceText` faqat `mode: "file"` da ma'noli (krossvord fayl rejimi).
  const sourceText = GAME_PARAMS.find((p) => p.id === "sourceText");
  assert.deepEqual(sourceText?.probeWith, { mode: "file" });
});

/*
 * `crosswordInputFromValues` faqat FALLBACK sifatida `meta`ni o'qiydi
 * (`values.X ?? meta.X`), zond esa har doim TO'LIQ `values` yuboradi —
 * shuning uchun bo'sh (soxta) `meta` xavfsiz.
 */
const FAKE_META = {} as unknown as DocMeta;

/** WP-B/WP-C hali ulanmagan parametrlar — `${id} (${kind})` shaklida. */
const ENGINE_NOT_WIRED: string[] = [];

/**
 * Kirish funksiyasi — WP-B ulanmagan bo'lsa `null` (import muvaffaqiyatsiz).
 *
 * Yo'l O'ZGARUVCHIDA (`games/engine.ts` naqshi): STATIK `import()` bilan
 * yozilsa `tsc` fayl yo'qligida butun test to'plamini yiqitardi — modul
 * o'zgaruvchi bilan ISHLASH vaqtida qidiriladi, bog'lanish vaqtida emas.
 */
async function flashcardsInputFromValues(): Promise<((meta: DocMeta, values: FormValues) => unknown) | null> {
  try {
    const path = "../lib/generation/games/flashcards/input.ts";
    const mod = (await import(path)) as { flashcardsInputFromValues?: (meta: DocMeta, values: FormValues) => unknown };
    return mod.flashcardsInputFromValues ?? null;
  } catch {
    return null;
  }
}

test("differensial zond: probeA/probeB natijasi FARQ qiladi — krossvord (WP-A, ulangan)", () => {
  for (const p of GAME_PARAMS) {
    if (!p.kinds.includes("crossword")) continue;
    const base: FormValues = { ...(p.probeWith as FormValues | undefined) };
    const valuesA: FormValues = { ...base, [p.id]: p.probeA };
    const valuesB: FormValues = { ...base, [p.id]: p.probeB };
    const inputA = crosswordInputFromValues(FAKE_META, valuesA);
    const inputB = crosswordInputFromValues(FAKE_META, valuesB);
    assert.notDeepEqual(inputA, inputB, `${p.id} (crossword): probeA/probeB bir xil kiritma berdi — bezak maydon bo'lishi mumkin`);
  }
});

test("differensial zond: flesh kartalar — WP-B ulangan bo'lsa sinaladi, bo'lmasa ANIQ o'tkazib yuboriladi", async () => {
  const flashcardsInput = await flashcardsInputFromValues();
  for (const p of GAME_PARAMS) {
    if (!p.kinds.includes("flashcards")) continue;
    if (!flashcardsInput) {
      ENGINE_NOT_WIRED.push(`${p.id} (flashcards)`);
      continue;
    }
    const base: FormValues = { ...(p.probeWith as FormValues | undefined) };
    const valuesA: FormValues = { ...base, [p.id]: p.probeA };
    const valuesB: FormValues = { ...base, [p.id]: p.probeB };
    assert.notDeepEqual(flashcardsInput(FAKE_META, valuesA), flashcardsInput(FAKE_META, valuesB), `${p.id} (flashcards): probeA/probeB bir xil kiritma berdi`);
  }
  const flashcardsParamCount = GAME_PARAMS.filter((p) => p.kinds.includes("flashcards")).length;
  if (!flashcardsInput) {
    // WP-B hali yo'q — HAMMA flesh karta parametri o'tkazib yuborilgan bo'lishi kerak (yashirin muvaffaqiyat emas).
    assert.equal(ENGINE_NOT_WIRED.length, flashcardsParamCount, "o'tkazib yuborilganlar soni flesh karta parametrlari soniga teng bo'lishi kerak");
    console.log(`   [game-params] WP-B hali ulanmagan — o'tkazib yuborildi: ${ENGINE_NOT_WIRED.join(", ")}`);
  } else {
    assert.equal(ENGINE_NOT_WIRED.length, 0, "WP-B ulangan — hech narsa o'tkazib yuborilmasligi kerak");
  }
});
