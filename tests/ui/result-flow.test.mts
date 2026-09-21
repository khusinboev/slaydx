import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Natija sahifasi oqim rejimi (AUDIT-16 §7): tarjima natijasida butun sahifa
 * scroll bo'ladi — peshtoq `sticky` emas, ildiz `overflow-y-auto`. Boshqa
 * vositalarda (slayd) eski qat'iy tuzilma saqlanadi. `ResultView` tarmoqqa
 * bog'liq (`useGeneration`), shuning uchun shartnoma manba matni bo'yicha
 * qulflanadi — SSR/jsdom'da stub qilishdan ko'ra aniqroq va arzon.
 */
afterEach(() => {});

test("ResultView: flow = completed && translation; ildiz overflow-y-auto, nav sticky emas", () => {
  const src = readFileSync(new URL("../../components/files/ResultView.tsx", import.meta.url), "utf8");
  assert.match(src, /const flow = completed && gen\.type === "translation";/, "flow sharti");
  assert.match(src, /flow \? "overflow-y-auto" : "overflow-hidden"/, "ildiz scroll rejimi");
  assert.match(src, /flow \? "shrink-0" : "sticky top-0"/, "peshtoq oqimda sticky emas");
  assert.match(src, /data-result-flow=\{flow \? "1" : undefined\}/, "smoke uchun belgi");
});

test("ResultView: insho uchun «Tuzatish yo'q» izohi hisobot panelida (AUDIT-24 WP-C)", () => {
  /*
   * Insho `noFix` (bandma-band «Tuzatish» yo'q) — sabab foydalanuvchiga
   * hech qayerda tushuntirilmasdi (`forms3-talaba.md` §4 topilmasi).
   * MUTATSIYA: `isEssay ?` sharti olib tashlansa izoh HAR vositada
   * chiqib qolardi (masalan maqolada ham) — shu shart shu yerda qulflanadi.
   */
  const src = readFileSync(new URL("../../components/files/ResultView.tsx", import.meta.url), "utf8");
  assert.match(src, /data-essay-nofix-note/, "izoh belgisi bo'lishi kerak");
  assert.match(
    src,
    /isEssay \? \([\s\S]{0,400}data-essay-nofix-note/,
    "izoh FAQAT insho uchun (`isEssay` sharti bilan) chizilishi kerak",
  );
  assert.match(src, /Insho bitta matn — «Hammasini tuzatish» butun matnni qayta ko‘radi\./, "izoh matni");
});

test("TranslationViewer: iframe ekran balandligini oladi (peshtoq scroll bilan chiqib ketgach)", () => {
  const src = readFileSync(new URL("../../components/viewers/TranslationViewer.tsx", import.meta.url), "utf8");
  assert.match(src, /h-\[calc\(100vh-4\.5rem\)\][^"]*"[^>]*data-file-preview/, "iframe balandligi 100vh ga bog'liq");
  assert.doesNotMatch(src, /<div className="min-h-0 flex-1 overflow-y-auto" data-translation-scroll>/, "ichki scroll qutisi olib tashlangan");
});
