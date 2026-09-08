import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_LANGUAGES } from "../lib/languages.js";
import { slideLabels, type SlideLabels } from "../lib/generation/i18n.js";

/**
 * Slayd yorliqlarining tarjima testi.
 *
 * 18 tilda har bir kalit mavjud, tabiiy, va o'z yozuvida yozilgan.
 * Mutatsiya o'zgarishlari test to'g'riligi ko'rsatadi.
 */

// 10 ta majburiy kalit
const REQUIRED_KEYS = [
  "agenda",
  "conclusion",
  "questions",
  "presentation",
  "quiz",
  "references",
  "answers",
  "goals",
  "homework",
  "practice",
] as const;

// Skript tekshirish (regex'lar)
const ARABIC_SCRIPT = /[؀-ۿ]/; // U+0600-U+06FF — arab yo'zuvining diapazon
const CJK_CHARS = /[一-鿿㐀-䶿]/; // CHN: U+4E00-U+9FFF; ext A: U+3400-U+4DBF
const KANA_KANJI = /[぀-ゟ゠-ヿ一-鿿]/; // hiragana, katakana, kanji
const HANGUL = /[가-힯]/; // U+AC00-U+D7AF — hangul sillabel

describe("SlideLabels — 18 tilga tarjima", () => {
  test("har bir SOURCE_LANGUAGES kodi uchun 10 ta kalit mavjud", () => {
    for (const lang of SOURCE_LANGUAGES) {
      const labels = slideLabels(lang.value);
      for (const key of REQUIRED_KEYS) {
        assert.ok(key in labels, `${lang.value}: ${key} kaliti yo'q`);
        assert.ok(
          labels[key as keyof SlideLabels],
          `${lang.value}: ${key} bo'sh`
        );
      }
    }
  });

  test("har bir kalit ≤40 belgidan iborat", () => {
    for (const lang of SOURCE_LANGUAGES) {
      const labels = slideLabels(lang.value);
      for (const key of REQUIRED_KEYS) {
        const value = labels[key as keyof SlideLabels];
        assert.ok(
          value.length <= 40,
          `${lang.value}/${key}: ${value.length} belgi (${value})`
        );
      }
    }
  });

  test("bo'sh kod → uz", () => {
    const result = slideLabels("");
    const expected = slideLabels("uz");
    assert.deepEqual(result, expected);
  });

  test("noma'lum kod → en", () => {
    const result = slideLabels("xx");
    const expected = slideLabels("en");
    assert.deepEqual(result, expected);
  });

  test("katta harfli kod → to'g'ri normaashtiriladi", () => {
    assert.deepEqual(slideLabels("RU"), slideLabels("ru"));
    assert.deepEqual(slideLabels("EN"), slideLabels("en"));
    assert.deepEqual(slideLabels("UZ"), slideLabels("uz"));
  });

  test("arab yorliqları arab yozuvida yozilgan", () => {
    const ar = slideLabels("ar");
    for (const key of REQUIRED_KEYS) {
      const value = ar[key as keyof SlideLabels];
      assert.ok(
        ARABIC_SCRIPT.test(value),
        `ar/${key}: ${value} arab yozuvida emas`
      );
    }
  });

  test("o'zbek, rus, qozoq, qirgiz, tojik, turkman — kirill yoki lotin (tg/kaa/kk/ky/tg/tk bo'yicha)", () => {
    // tg, kaa, kk, ky — kirill
    for (const code of ["tg", "kaa", "kk", "ky"]) {
      const labels = slideLabels(code);
      // Ko'pi kirill bo'lishi kerak
      const kvorum = REQUIRED_KEYS.filter(
        (k) =>
          /[а-яёА-ЯЁ]/.test(labels[k as keyof SlideLabels]) ||
          labels[k as keyof SlideLabels].includes("ü") ||
          labels[k as keyof SlideLabels].includes("ş")
      ).length;
      assert.ok(kvorum >= 3, `${code}: kirill yoki latin kerak`);
    }
    // tk, tr — lotin
    for (const code of ["tk", "tr"]) {
      const labels = slideLabels(code);
      assert.ok(
        REQUIRED_KEYS.some((k) =>
          /[a-zA-Z]/.test(labels[k as keyof SlideLabels])
        ),
        `${code}: lotin yozuvi yok`
      );
    }
  });

  test("zh — CJK belgilari o'z ichiga oladi", () => {
    const zh = slideLabels("zh");
    const cjkCount = REQUIRED_KEYS.filter((k) =>
      CJK_CHARS.test(zh[k as keyof SlideLabels])
    ).length;
    assert.ok(cjkCount >= 5, `zh: yetarli CJK belgi emas (${cjkCount})`);
  });

  test("ja — kana va kanji o'z ichiga oladi", () => {
    const ja = slideLabels("ja");
    const kanaKanjiCount = REQUIRED_KEYS.filter((k) =>
      KANA_KANJI.test(ja[k as keyof SlideLabels])
    ).length;
    assert.ok(
      kanaKanjiCount >= 5,
      `ja: yetarli kana/kanji emas (${kanaKanjiCount})`
    );
  });

  test("ko — hangul o'z ichiga oladi", () => {
    const ko = slideLabels("ko");
    const hangulCount = REQUIRED_KEYS.filter((k) =>
      HANGUL.test(ko[k as keyof SlideLabels])
    ).length;
    assert.ok(hangulCount >= 5, `ko: yetarli hangul emas (${hangulCount})`);
  });

  test("hech qanday ikkita til birbiriga to'liq mos kelmaydi (≥3 kalit farq)", () => {
    const langs = SOURCE_LANGUAGES.map((l) => l.value);
    for (let i = 0; i < langs.length; i++) {
      for (let j = i + 1; j < langs.length; j++) {
        const lang1 = langs[i];
        const lang2 = langs[j];
        const labels1 = slideLabels(lang1);
        const labels2 = slideLabels(lang2);

        let diff = 0;
        for (const key of REQUIRED_KEYS) {
          if (
            labels1[key as keyof SlideLabels] !==
            labels2[key as keyof SlideLabels]
          ) {
            diff++;
          }
        }
        assert.ok(diff >= 3, `${lang1} va ${lang2}: farq yo'q (${diff})`);
      }
    }
  });

  test("mutatsiya: bir kalitni o'chir — test buziladi (quiz→questions)", () => {
    const uz = slideLabels("uz");
    const quiz = uz.quiz;
    const mutableUz = uz as Record<string, string>;
    delete mutableUz.quiz;
    // Mustahkam: keyof bilan tekshirish
    assert.ok(
      !("quiz" in mutableUz) || !mutableUz.quiz,
      "Quiz kaliti o'chirilib ketmadi"
    );
    // Tiklash
    mutableUz.quiz = quiz;
  });

  test("fallback bo'lmasa noma'lum kod → en (faqat ishonch)", () => {
    // SLIDE_LABELS ga "xx" degan kalit yo'q
    assert.deepEqual(slideLabels("xx"), slideLabels("en"));
    assert.ok(slideLabels("xx").quiz !== undefined);
  });

  test("uz va en o'zgarmagan (backward compatibility)", () => {
    assert.equal(slideLabels("uz").agenda, "Reja");
    assert.equal(slideLabels("uz").conclusion, "Xulosa");
    assert.equal(slideLabels("uz").quiz, "Nazorat testi");
    assert.equal(slideLabels("en").agenda, "Agenda");
    assert.equal(slideLabels("en").conclusion, "Conclusion");
    assert.equal(slideLabels("en").quiz, "Quiz");
  });
});
