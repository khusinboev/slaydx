import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { GameComposer } from "../../components/forms/GameComposer.tsx";
import { gameParamsOf } from "../../lib/generation/game-params.ts";
import { gameKindOf } from "../../lib/generation/games/registry.ts";
import { GAME_TOOL_LIST, type GameKind, type GameToolId } from "../../lib/generation/games/types.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";

/**
 * O'YINLAR FORMASI — SSR (Formalar 3 / AUDIT-24 WP-D1).
 *
 * `tests/viewer/teacher-form.test.mts` naqshi. SSR aynan shu ikki narsani
 * jsdom dan YAXSHIROQ o'lchaydi:
 *   1. BIRINCHI bo'yoq — ▸ Sozlamalar `<details open>` SIZ chiqishi
 *      kerak (yopiq holat native `<details>` bilan, React holatisiz —
 *      aks holda sahifa bir lahza ochiq ko'rinib, keyin yig'ilardi);
 *   2. QAMROV — reyestrning har `id` si markupda `data-field` bilan
 *      (ikki yo'nalish), ya'ni «bezak maydon yo'q» qoidasi hujjat
 *      chizilishidan oldin qulflanadi.
 *
 * `ToolWorkspace` ni SSR bilan sinash mumkin emas (zustand server
 * snapshot'i — `work-form.test.mts` dagi topilma), shuning uchun bu yerda
 * dispatch PREDIKATI (`tool.custom`) tekshiriladi; haqiqiy dispatch —
 * `tests/ui/game-composer.test.mts`.
 */

const mockRouter: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

function renderGame(id: GameToolId): string {
  return renderToStaticMarkup(h(AppRouterContext.Provider, { value: mockRouter }, h(GameComposer, { tool: TOOL_BY_ID[id] })));
}

const html = Object.fromEntries(GAME_TOOL_LIST.map((id) => [id, renderGame(id)])) as Record<GameToolId, string>;

test("to'rtala o'yin vositasi `custom: \"game\"` bilan GameComposer ga dispatch qilinadi", () => {
  assert.equal(GAME_TOOL_LIST.length, 4, `o'yin vositalari: ${GAME_TOOL_LIST.join(", ")}`);
  for (const id of GAME_TOOL_LIST) assert.equal(TOOL_BY_ID[id].custom, "game", `${id}: GameComposer ga dispatch qilinmaydi`);
  // Boshqa oila shu formaga tushib qolmasin (infografika/media — WP-D2).
  assert.notEqual(TOOL_BY_ID.infographic.custom, "game");
  assert.notEqual(TOOL_BY_ID.greeting.custom, "game");
});

test("reyestrdagi (GAME_PARAMS) har parametr formada `data-field` bilan chizilgan", () => {
  for (const id of GAME_TOOL_LIST) {
    const kind = gameKindOf(id) as GameKind;
    const missing = gameParamsOf(kind)
      .map((p) => p.id)
      .filter((pid) => !html[id].includes(`data-field="${pid}"`));
    assert.deepEqual(missing, [], `${id}: formada yo'q parametrlar: ${missing.join(", ")}`);
  }
});

test("formada reyestrda YO'Q `data-field` bo'lmaydi (teskari yo'nalish)", () => {
  for (const id of GAME_TOOL_LIST) {
    const kind = gameKindOf(id) as GameKind;
    const known = new Set(gameParamsOf(kind).map((p) => p.id));
    const found = [...html[id].matchAll(/data-field="([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
    const stray = [...new Set(found)].filter((pid) => !known.has(pid));
    assert.deepEqual(stray, [], `${id}: reyestrda yo'q maydonlar: ${stray.join(", ")}`);
    const twice = found.filter((v, i) => found.indexOf(v) !== i);
    assert.deepEqual(twice, [], `${id}: ikki joyda chizilgan maydonlar: ${twice.join(", ")}`);
  }
});

test("▸ Sozlamalar BIRINCHI bo'yoqda yopiq (`<details>` `open` siz) va xulosa chiplari bor", () => {
  for (const id of GAME_TOOL_LIST) {
    assert.ok(html[id].includes('data-settings="settings"'), `${id}: Sozlamalar bloki yo'q`);
    assert.ok(!/<details[^>]*\sopen/.test(html[id]), `${id}: Sozlamalar ochiq holda SSR qilindi`);
    assert.ok(html[id].includes("data-summary-chips"), `${id}: yopiq holatda xulosa chiplari yo'q`);
  }
});

test("standart tanlovlar SSR da ALLAQACHON yoqilgan (`aria-checked=\"true\"`)", () => {
  /*
   * Yoqilgan tanovlar soni ANIQ: krossvord — rejim/tur/so'z/til,
   * kartalar — tur/karta/til (misol kaliti `switch`), saralash —
   * tur/toifa/element/til, tinglash — tur/topshiriq/ona/o'rganiladigan.
   * Aniq son ataylab: «kamida 3» bo'lsa bitta standart yo'qolganda ham
   * test yashil qolardi (mutatsiya 1 shuni ko'rsatdi).
   */
  const EXPECTED: Record<GameToolId, number> = { crossword: 4, flashcards: 3, sorting: 4, listening: 4 };
  for (const id of GAME_TOOL_LIST) {
    const on = (html[id].match(/aria-checked="true"/g) ?? []).length;
    assert.equal(on, EXPECTED[id], `${id}: ${on} ta tanlov yoqilgan — standartlar reyestrdan to'liq o'qilmadi`);
  }
  // Reyestr yorliqlari markupda ko'rinadi (chip matni qo'lda yozilmagan).
  assert.ok(html.crossword.includes("Klassik"), "krossvord standart turi");
  assert.ok(html.flashcards.includes("Atama — ta&#x27;rif") || html.flashcards.includes("Atama — ta'rif"), "karta standart turi");
  assert.ok(html.sorting.includes("Toifalar bo&#x27;yicha") || html.sorting.includes("Toifalar bo'yicha"), "saralash standart turi");
  assert.ok(html.listening.includes("So&#x27;zlar") || html.listening.includes("So'zlar"), "tinglash standart turi");
});

test("narx — tekis 2 000, faqat sticky footerda", () => {
  for (const id of GAME_TOOL_LIST) {
    assert.match(html[id], /data-price-total[^>]*>[^<]*2[\s ]?000/, `${id}: narx 2 000 emas`);
    assert.ok(!html[id].includes("data-price-rule"), `${id}: formada narx qoidasi ortiqcha (tekis narx)`);
  }
});

test("fayl rejimi FAQAT krossvordda (`tool.modes`) — qolgan uchtasida rejim tanlovi yo'q", () => {
  assert.ok(html.crossword.includes('data-field="mode"'), "krossvordda rejim tanlovi bo'lishi kerak");
  assert.ok(html.crossword.includes('data-field="sourceText"'), "krossvordda fayl qatori bo'lishi kerak");
  for (const id of ["flashcards", "sorting", "listening"] as const) {
    assert.ok(!html[id].includes('data-field="mode"'), `${id}: rejim tanlovi ortiqcha`);
    assert.ok(!html[id].includes('data-field="sourceText"'), `${id}: fayl maydoni ortiqcha`);
  }
});

test("tinglashda uchinchi «hujjat tili» maydoni yo'q, til JUFTLIGI bor", () => {
  assert.ok(!html.listening.includes('data-field="language"'), "tinglashda «Til» bezak maydon bo'lardi");
  assert.ok(html.listening.includes('data-field="nativeLanguage"'));
  assert.ok(html.listening.includes('data-field="targetLanguage"'));
  for (const id of ["crossword", "flashcards", "sorting"] as const) {
    assert.ok(html[id].includes('data-field="language"'), `${id}: hujjat tili so'ralmaydi`);
    assert.ok(!html[id].includes('data-field="nativeLanguage"'), `${id}: til juftligi ortiqcha`);
  }
});
