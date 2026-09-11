import test from "node:test";
import assert from "node:assert/strict";
import { languageTag, scriptOf, transliterate } from "../lib/generation/cite/translit.ts";
import { formatReferenceEnglish, formatReferencesEnglish } from "../lib/generation/cite/index.ts";
import type { Reference } from "../lib/generation/article/types.ts";

/**
 * OAK «REFERENCES» transliteratsiyasi (Maqola 2, WP5) — BGN/PCGN (rus),
 * rasmiy o'zbek lotin (o'zbek kirill), lotin matn o'zgarmaydi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   • jadvalda «щ → shh» (ГОСТ 7.79 B) — «shch» testi yiqildi;
 *   • «ё → e» — «yo» testi yiqildi;
 *   • `[in Russian]` belgisi olib tashlandi — belgi testi yiqildi;
 *   • o'zbek kirillni rus jadvali bilan o'girish («х → kh», «ж → zh») —
 *     «Toshkent shahri» / «jarayon» testi yiqildi;
 *   • muallifni butun satr sifatida o'girish — «Shchukin, Yo. Yo.» testi
 *     yiqildi («Yo.Yo.» familiya bo'lib qolardi).
 */

test("rus BGN/PCGN: Ташкент → Tashkent, щ → shch, ё → yo, х → kh, ц → ts, е → ye (so'z boshi/unlidan keyin), ъ/ь tushadi", () => {
  assert.equal(transliterate("Ташкент"), "Tashkent");
  assert.equal(transliterate("щи"), "shchi");
  assert.equal(transliterate("Щукин"), "Shchukin");
  assert.equal(transliterate("ёлка Ёлка"), "yolka Yolka");
  assert.equal(transliterate("Ельцин"), "Yeltsin");
  assert.equal(transliterate("Достоевский"), "Dostoyevskiy");
  assert.equal(transliterate("Хрущёв"), "Khrushchyov");
  assert.equal(transliterate("Цифровые технологии в образовании"), "Tsifrovyye tekhnologii v obrazovanii");
  assert.equal(transliterate("объект, семья"), "obyekt, semya");
  // Bosh harflar: ko'p harfli natija keyingi harf ham bosh bo'lsa to'liq bosh.
  assert.equal(transliterate("ЩИ"), "SHCHI");
  assert.equal(transliterate("ВЕСТНИК ТГУ"), "VESTNIK TGU");
});

test("o'zbek kirill (ў қ ғ ҳ bo'yicha aniqlanadi) → rasmiy o'zbek lotin: х → x, ж → j, ў → o‘, қ → q, ғ → g‘, ҳ → h", () => {
  assert.equal(transliterate("Тошкент шаҳри"), "Toshkent shahri");
  assert.equal(transliterate("ўқувчи ғоя қишлоқ"), "o‘quvchi g‘oya qishloq");
  assert.equal(transliterate("жараён хизмат", "uz"), "jarayon xizmat");
  assert.deepEqual(scriptOf("Тошкент шаҳри"), { cyrillic: true, lang: "uz" });
  assert.deepEqual(scriptOf("Ташкент"), { cyrillic: true, lang: "ru" });
});

test("lotin matn o'zgarmaydi; o'zbek lotin `[in Uzbek]`, inglizcha — belgisiz", () => {
  assert.equal(transliterate("O‘zbekiston ta’limi"), "O‘zbekiston ta’limi");
  assert.equal(transliterate("Artificial intelligence"), "Artificial intelligence");
  assert.deepEqual(scriptOf("Ta’limda raqamli texnologiyalar"), { cyrillic: false, lang: "uz" });
  assert.deepEqual(scriptOf("O‘quv jarayoni"), { cyrillic: false, lang: "uz" });
  assert.deepEqual(scriptOf("Artificial intelligence in education"), { cyrillic: false, lang: "en" });
  assert.equal(languageTag("uz"), "[in Uzbek]");
  assert.equal(languageTag("ru"), "[in Russian]");
  assert.equal(languageTag("en"), "");
});

const RU: Reference = { id: "u2", title: "Цифровые технологии в образовании", authors: ["Иванов Иван Иванович", "Щукин Ё.Ё."], year: 2021, venue: "Вестник ТГУ", pages: "12–18", verified: "user", cited: true };
const UZ: Reference = { id: "u1", title: "Ta’limda raqamli texnologiyalar", authors: ["Karimov A."], year: 2022, publisher: "Fan", place: "Toshkent", verified: "user", cited: true };
const EN: Reference = { id: "W1", doi: "10.1/x", title: "Artificial intelligence in education", authors: ["Lin C."], year: 2023, venue: "Smart Learning", verified: "openalex", cited: true };

test("REFERENCES satri: muallif/sarlavha/venue lotinda, `[in Russian]` sarlavhadan keyin, APA 7 inglizcha", () => {
  assert.equal(formatReferenceEnglish(RU), "Ivanov, I. I., & Shchukin, Yo. Yo. (2021). Tsifrovyye tekhnologii v obrazovanii [in Russian]. Vestnik TGU, 12–18.");
  assert.equal(formatReferenceEnglish(UZ), "Karimov, A. (2022). Ta’limda raqamli texnologiyalar [in Uzbek]. Fan.");
  assert.equal(formatReferenceEnglish(EN), "Lin, C. (2023). Artificial intelligence in education. Smart Learning. https://doi.org/10.1/x");
  assert.ok(!formatReferenceEnglish(EN).includes("[in"), "inglizcha sarlavhaga belgi qo'yilmaydi");
  const uzCyr: Reference = { ...RU, id: "u3", title: "Таълимда рақамли технологиялар", authors: ["Каримов А."], venue: "ТАТУ хабарномаси" };
  assert.equal(formatReferenceEnglish(uzCyr), "Karimov, A. (2021). Ta’limda raqamli texnologiyalar [in Uzbek]. TATU xabarnomasi, 12–18.");
});

test("`raw`: kirill erkin matn transliteratsiya + belgi; lotin `raw` o'zgarishsiz; `formatReferencesEnglish` ro'yxat", () => {
  const rawRu: Reference = { ...RU, raw: "Иванов И.И. Цифровая педагогика. – М.: Наука, 2020. – 200 с." };
  assert.equal(formatReferenceEnglish(rawRu), "Ivanov I.I. Tsifrovaya pedagogika. – M.: Nauka, 2020. – 200 s. [in Russian]");
  const rawUz: Reference = { ...UZ, raw: "Karimov A. Ta’limda AI. – T.: Fan, 2022." };
  assert.equal(formatReferenceEnglish(rawUz), "Karimov A. Ta’limda AI. – T.: Fan, 2022.");
  assert.deepEqual(formatReferencesEnglish([EN, rawUz]), [formatReferenceEnglish(EN), "Karimov A. Ta’limda AI. – T.: Fan, 2022."]);
});
