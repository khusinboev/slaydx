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

test("TranslationViewer: iframe ekran balandligini oladi (peshtoq scroll bilan chiqib ketgach)", () => {
  const src = readFileSync(new URL("../../components/viewers/TranslationViewer.tsx", import.meta.url), "utf8");
  assert.match(src, /h-\[calc\(100vh-4\.5rem\)\][^"]*"[^>]*data-file-preview/, "iframe balandligi 100vh ga bog'liq");
  assert.doesNotMatch(src, /<div className="min-h-0 flex-1 overflow-y-auto" data-translation-scroll>/, "ichki scroll qutisi olib tashlangan");
});
