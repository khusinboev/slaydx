import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Natija sahifasi scroll modeli.
 *
 * AUDIT-16 §7 da faqat tarjima oqimda edi (ildiz `overflow-y-auto`),
 * boshqa vositalar `overflow-hidden` qutida qolardi va hujjat oxiri
 * kesilardi (viewer redesign R1 §1). V0 dan HAMMA vosita bitta sahifa
 * scroll'ida (AppShell `<main>`): `ResultView`/`ResultLayout` da scroll
 * tuzog'i yo'q, sarlavha har doim `sticky top-0`, balandligi
 * `--result-header-h`. DOM darajasidagi tekshiruv (ildizdan mazmungacha
 * `overflow-*` yo'q, tarjima ham) — `tests/ui/result-layout.test.mts`;
 * bu yerda manba matni shartnomasi.
 */
afterEach(() => {});

test("ResultView/ResultLayout: bitta sahifa scroll'i — ildizda overflow yo'q, sarlavha HAR DOIM sticky top-0, ramka belgisi", () => {
  const src = readFileSync(new URL("../../components/files/ResultView.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../../components/files/ResultLayout.tsx", import.meta.url), "utf8");
  // Ramka turi bo'yicha (ilgari: `flow = completed && translation`).
  assert.match(src, /const frame = viewerFrame\(viewerKind\(gen\.type\)\);/, "ramka sharti — ko'ruvchi turi");
  assert.match(src, /<ResultLayout header=\{header\} notices=\{notices\} sections=\{sections\} frame=\{completed && !expired \? frame\.mode : undefined\}>/, "sahifa ResultLayout ichida");
  // ResultView da birorta klass ham scroll tuzog'i emas (yagona istisno — progress bar ichi).
  const classes = [...src.matchAll(/className=(?:"([^"]*)"|\{cn\(([\s\S]*?)\)\})/g)].map((m) => m[1] ?? m[2] ?? "");
  const traps = classes.filter((c) => /overflow-(hidden|y-auto|auto)/.test(c) && !/bg-muted h-2 overflow-hidden rounded-full/.test(c));
  assert.deepEqual(traps, [], "ResultView da overflow tuzog'i");
  // Ildiz: oqimli flex ustun, overflow yo'q (ilgari: `flow ? "overflow-y-auto" : "overflow-hidden"`).
  assert.match(layout, /data-result-layout\s+data-result-frame=\{frame\}\s+className="flex shrink-0 grow flex-col"/, "ildiz klassi");
  // Sarlavha: shartsiz sticky (ilgari: `flow ? "shrink-0" : "sticky top-0"`).
  assert.match(layout, /data-result-header\s+className="[^"]*\bsticky top-0\b[^"]*"/, "sarlavha har doim sticky");
  assert.match(layout, /setProperty\("--result-header-h"/, "sarlavha balandligi o'zgaruvchisi");
  assert.doesNotMatch(src + layout, /data-result-flow/, "eski belgi o'rniga `data-result-frame`/`data-viewer-frame`");
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

test("TranslationViewer: iframe sticky sarlavha ostidagi qolgan ekranni oladi (--result-fill-h, V4)", () => {
  const src = readFileSync(new URL("../../components/viewers/TranslationViewer.tsx", import.meta.url), "utf8");
  assert.match(src, /h-\[var\(--result-fill-h,100svh\)\][^"]*"[^>]*data-file-preview/, "iframe balandligi --result-fill-h dan");
  assert.doesNotMatch(src, /calc\(100vh/, "100vh ga bog'lanish qolmasin (sticky sarlavha hisobga olinmasdi)");
  assert.doesNotMatch(src, /<div className="min-h-0 flex-1 overflow-y-auto" data-translation-scroll>/, "ichki scroll qutisi olib tashlangan");
});
