import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SLIDE_PARAMS } from "../lib/generation/slide-params.ts";
import { PURPOSE_DEFAULTS, purposeDefaults } from "../lib/generation/slide-purpose.ts";
import {
  decodeBlocks,
  encodeBlocks,
  renderSlideParam,
  resetBlocksForPurpose,
} from "../components/forms/slide-fields.tsx";

/**
 * WP-G — `ProSlideForm` va `SlideForm` tengligi: maydonlar FAQAT
 * `slideParamsFor(tool)` reyestridan chiziladi.
 *
 * Bu fayl `SlideForm.tsx`/`ProSlideForm.tsx` MODULLARINI to'g'ridan-
 * to'g'ri IMPORT QILMAYDI — ular `next/navigation` (`useRouter`)ni
 * chaqiradi, u esa `npm test` ishlatadigan `--conditions=react-server`
 * ostida `React.createContext` yo'qligi sababli xato beradi (aynan shu
 * sabab bilan loyihada React-render testlari `tests/viewer/` ga
 * ajratilgan — `npm run test:viewer`, react-server SHARTISIZ). Reyestr
 * ↔ forma EKSPORT qilingan massivlar solishtiruvi shuning uchun
 * `tests/viewer/slide-form.test.mts` da (SSR bilan bir joyda).
 *
 * Bu yerda: `slide-fields.tsx` (router import qilmaydi — `renderSlideParam`
 * xaritasi, CSV kodlash, `slidePurpose` → `blocks` standart qaytishi)
 * va ikkala forma faylining MANBA MATNIDAN o'qiladigan tekshiruvlar
 * (`scope="source"`, `renderSlideParam` xaritasida ortiqcha `case` yo'q).
 */

function idsOf(tool: "slide" | "pro-slide"): Set<string> {
  return new Set(SLIDE_PARAMS.filter((p) => p.tools.includes(tool)).map((p) => p.id));
}

/**
 * `renderSlideParam` xaritasida reyestrda YO'Q id bo'lmasligi kerak —
 * masalan olib tashlangan parametrning `case` bandi jimgina qolib
 * ketishi mumkin. Manba matnidan `case "id":` larni ajratib, har biri
 * TO'LIQ reyestrda (`SLIDE_PARAMS`) borligini tekshiradi.
 */
test("renderSlideParam xaritasida reyestrda YO'Q id yo'q", async () => {
  const src = await readFile(new URL("../components/forms/slide-fields.tsx", import.meta.url), "utf8");
  const allIds = new Set(SLIDE_PARAMS.map((p) => p.id));
  const cases = [...src.matchAll(/case\s+"([a-zA-Z]+)":/g)].map((m) => m[1]);
  assert.ok(cases.length > 10, "case bandlari topilmadi — regex yoki fayl yo'li noto'g'ri bo'lishi mumkin");
  for (const id of cases) {
    assert.ok(allIds.has(id), `renderSlideParam «${id}» ni ishlaydi, lekin reyestrda yo'q`);
  }
});

/**
 * Teskari yo'nalish: `renderSlideParam` xaritasidagi HAR bir `case`
 * band ID si aynan shu ikki forma birortasining reyestrida bo'lishi
 * kerak (ya'ni umuman ishlatilmaydigan, olib tashlangan parametr
 * qoldiq bo'lib qolmasin).
 */
test("renderSlideParam dagi har case ikki forma reyestridan birida bor", async () => {
  const src = await readFile(new URL("../components/forms/slide-fields.tsx", import.meta.url), "utf8");
  const cases = [...src.matchAll(/case\s+"([a-zA-Z]+)":/g)].map((m) => m[1]);
  const slideIds = idsOf("slide");
  const proIds = idsOf("pro-slide");
  for (const id of cases) {
    assert.ok(slideIds.has(id) || proIds.has(id), `«${id}» na "slide" na "pro-slide" reyestrida yo'q`);
  }
});

/*
 * «renderSlideParam har generik id uchun JSX qaytaradi (null emas)»,
 * «PurposeField onChange», «BlocksField options» testlari — BU YERDA
 * EMAS: ular JSX ELEMENT YASAYDI (`React.createElement`), bu esa
 * avtomatik jsx runtime talab qiladi. Asosiy `tsconfig.json` da
 * `jsx: "preserve"` (Next/webpack o'zi transformlaydi), shu sabab bu
 * fayl ishlatadigan oddiy `tsx --conditions=react-server` yugurishida
 * ular «React is not defined» bilan qulaydi. `tsconfig.viewer.json`
 * `jsx: "react-jsx"` (avtomatik runtime) beradi — shuning uchun bu uch
 * test `tests/viewer/slide-form.test.mts` da (`npm run test:viewer`).
 * Inline id lar (`topic`/`language`/`slideTemplate`/`slideTheme`/
 * `quality`) esa default'da JSX yasamasdan `null` qaytadi — shuning
 * uchun ularni bu yerda ham sinash mumkin.
 */
const INLINE_IDS = new Set(["topic", "language", "slideTemplate", "slideTheme", "quality"]);

test("renderSlideParam inline id lar (topic/language/slideTemplate/slideTheme/quality) uchun null qaytaradi", () => {
  for (const id of INLINE_IDS) {
    assert.equal(renderSlideParam(id, {}, () => {}), null, `renderSlideParam("${id}") null emas — forma o'zi chizishi kerak edi`);
  }
});

test("renderSlideParam noma'lum id uchun null qaytaradi", () => {
  assert.equal(renderSlideParam("hech-qachon-bolmagan", {}, () => {}), null);
});

// ─────────────────────────────────── CSV kodlash ───────────────────────────

test("blocks: decodeBlocks/encodeBlocks splitCsv/joinCsv bilan bir xil (round-trip)", () => {
  const raw = "reja,test,adabiyotlar";
  const decoded = decodeBlocks(raw);
  assert.deepEqual(decoded, ["reja", "test", "adabiyotlar"]);
  assert.equal(encodeBlocks(decoded), raw);
});

test("decodeBlocks noto'g'ri id larni filtrlaydi, 12 tadan oshsa kesadi", () => {
  assert.deepEqual(decodeBlocks("reja,noma'lum,test"), ["reja", "test"]);
  const many = Array.from({ length: 20 }, () => "reja").join(",");
  assert.equal(decodeBlocks(many).length, 12);
});

test("decodeBlocks bo'sh/undefined uchun bo'sh massiv", () => {
  assert.deepEqual(decodeBlocks(undefined), []);
  assert.deepEqual(decodeBlocks(""), []);
});

// ───────────────────────── slidePurpose → blocks standart ──────────────────

test("resetBlocksForPurpose har tur uchun purposeDefaults bilan bir xil", () => {
  for (const p of Object.keys(PURPOSE_DEFAULTS)) {
    assert.equal(resetBlocksForPurpose(p), encodeBlocks(purposeDefaults(p).blocks));
  }
});

test("resetBlocksForPurpose: lesson va defense turlicha standart beradi", () => {
  const lesson = decodeBlocks(resetBlocksForPurpose("lesson"));
  const defense = decodeBlocks(resetBlocksForPurpose("defense"));
  assert.deepEqual(lesson, ["reja", "maqsadlar", "motivatsiya", "amaliyot", "uyga_vazifa"]);
  assert.deepEqual(defense, ["reja", "diagramma", "jadval", "adabiyotlar"]);
  assert.notDeepEqual(lesson, defense);
});

test("resetBlocksForPurpose noma'lum turda «general» standartiga tushadi", () => {
  assert.equal(resetBlocksForPurpose("hech-qachon-bolmagan"), resetBlocksForPurpose("general"));
});

/**
 * `renderSlideParam` bir nechta hollarda kichik funksiya-komponent
 * qaytaradi (masalan `PurposeField`), maydon o'zi esa uning ICHIDA.
 * Bu komponentlar hooksiz — funksiyani to'g'ridan-to'g'ri chaqirish
 * (`el.type(el.props)`) haqiqiy natijani beradi (sayoz render).
 */
// ───────────────────────────── scope="source" ──────────────────────────────

/**
 * Til tanlagichi ikkala formada ham `scope="source"` bilan chizilishi
 * kerak — shunda `SOURCE_LANGUAGES` (18 til, «Ko'proq» tugmasi bilan)
 * ochiladi, standart (faqat uz/ru/en) emas. Manba matnini o'qiydigan
 * naqsh (`tests/generation.test.mts` dagi eskiz testi kabi) — modulni
 * import qilish shart emas (`next/navigation` react-server ostida
 * ishlamaydi).
 */
test('SlideForm va ProSlideForm LanguagePicker\'ni scope="source" bilan chizadi', async () => {
  const slideSrc = await readFile(new URL("../components/forms/SlideForm.tsx", import.meta.url), "utf8");
  const proSrc = await readFile(new URL("../components/forms/ProSlideForm.tsx", import.meta.url), "utf8");
  assert.ok(/<LanguagePicker[\s\S]*?scope="source"/.test(slideSrc), 'SlideForm da LanguagePicker scope="source" emas');
  assert.ok(/<LanguagePicker[\s\S]*?scope="source"/.test(proSrc), 'ProSlideForm da LanguagePicker scope="source" emas');
});

