import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convert, isProtectedToken, type Script } from "../lib/translit/index.ts";
import { EXCEPTIONS } from "../lib/translit/exceptions.ts";
import { EXCEPTIONS_TS_PATH, EXCEPTIONS_TSV_PATH, parseExceptionsTsv, renderExceptions } from "../lib/translit/exceptions-tsv.ts";
import { isSuffixChain } from "../lib/translit/words.ts";

/**
 * Uzbek script converter (owner request 6): Cyrillic <-> current Latin <-> NEW Latin (Law ЎРҚ-1184).
 * Pure unit tests, no DB. Every row of every table is one assertion, so a failure names its row.
 *
 * Characters: ʻ = U+02BB (okina, oʻ gʻ), ʼ = U+02BC (tutuq belgisi).
 *
 * Mutations (each turned a test red, then was restored):
 *   M1. `е -> ye` rule removed in rules.ts cyrToLat (always «e»)        -> «cyr -> lat: е/ye/э» + corpus;
 *   M2. exception lookup removed in words.ts (`lookup` always null)    -> «exceptions» tables + corpus-free dictionary tests;
 *   M3. digraph case broken in rules.ts (`caps ? upper : capitalize` swapped) -> «digraph case» + corpus.
 */

type Row = [name: string, from: Script, to: Script, input: string, expected: string];

function run(title: string, rows: Row[]) {
  test(title, () => {
    for (const [name, from, to, input, expected] of rows) {
      assert.equal(convert(input, from, to), expected, `${name}: ${from}->${to} «${input}»`);
    }
  });
}

/* ───────────────────────── Cyrillic -> current Latin: letters ───────────────────────── */

run("cyr -> lat: letters", [
  ["ш", "cyr", "lat", "шаҳар", "shahar"],
  ["ч", "cyr", "lat", "чой", "choy"],
  ["ў", "cyr", "lat", "ўқув", "oʻquv"],
  ["ғ", "cyr", "lat", "ғалаба", "gʻalaba"],
  ["ҳ", "cyr", "lat", "ҳаво", "havo"],
  ["қ", "cyr", "lat", "қалам", "qalam"],
  ["ж", "cyr", "lat", "жон", "jon"],
  ["х", "cyr", "lat", "хат", "xat"],
  ["й", "cyr", "lat", "йил", "yil"],
  ["нг", "cyr", "lat", "денгиз", "dengiz"],
  ["нг end", "cyr", "lat", "тонг", "tong"],
  ["ё", "cyr", "lat", "ёмғир", "yomgʻir"],
  ["ю", "cyr", "lat", "юрак", "yurak"],
  ["я", "cyr", "lat", "яхши", "yaxshi"],
  ["ё after consonant", "cyr", "lat", "дарё", "daryo"],
  ["ъ", "cyr", "lat", "шаъни", "shaʼni"],
  ["ъ Title", "cyr", "lat", "Таъкид", "Taʼkid"],
  ["ь dropped", "cyr", "lat", "тильда", "tilda"],
  ["ь dropped 2", "cyr", "lat", "альфа", "alfa"],
  ["э", "cyr", "lat", "эрон", "eron"],
  ["э + ъ", "cyr", "lat", "эълон", "eʼlon"],
  ["щ", "cyr", "lat", "щётка", "shchyotka"],
  ["ы", "cyr", "lat", "быт", "bit"],
  ["unknown Cyrillic letter kept", "cyr", "lat", "ѝ", "ѝ"],
]);

run("cyr -> lat: е / ye / э", [
  ["word start", "cyr", "lat", "ер", "yer"],
  ["word start 2", "cyr", "lat", "ешик", "yeshik"],
  ["after consonant", "cyr", "lat", "мева", "meva"],
  ["after consonant 2", "cyr", "lat", "театр", "teatr"],
  ["after vowel", "cyr", "lat", "боев", "boyev"],
  ["after vowel 2", "cyr", "lat", "поезд", "poyezd"],
  ["Title", "cyr", "lat", "Европа", "Yevropa"],
  ["CAPS", "cyr", "lat", "ЕВРОПА", "YEVROPA"],
  ["after ь", "cyr", "lat", "семья", "semya"],
  ["after ь е", "cyr", "lat", "пьеса", "pyesa"],
  ["after ъ", "cyr", "lat", "подъезд", "podʼyezd"],
  ["э is always e", "cyr", "lat", "Эрталаб", "Ertalab"],
  ["single Е Title", "cyr", "lat", "Е", "Ye"],
  ["inside word with й", "cyr", "lat", "йетти", "yetti"],
]);

run("cyr -> lat: ц at word start, after a consonant, after a vowel", [
  ["word start", "cyr", "lat", "цинк", "sink"],
  ["word start Title", "cyr", "lat", "Цинк", "Sink"],
  ["after consonant", "cyr", "lat", "принцесса", "prinsessa"],
  ["after vowel", "cyr", "lat", "оцелот", "otselot"],
  ["after vowel and before и", "cyr", "lat", "лицемер", "litsemer"],
  ["after ь", "cyr", "lat", "пальцо", "palso"],
  ["not an exception prefix (tail is no suffix)", "cyr", "lat", "цирковой", "sirkovoy"],
]);

run("cyr -> lat: digraph case follows the word", [
  ["Title ш", "cyr", "lat", "Шарқ", "Sharq"],
  ["CAPS ш", "cyr", "lat", "ШАРҚ", "SHARQ"],
  ["Title ч", "cyr", "lat", "Чирой", "Chiroy"],
  ["CAPS ч", "cyr", "lat", "ЧИРОЙ", "CHIROY"],
  ["Title ў", "cyr", "lat", "Ўзбек", "Oʻzbek"],
  ["CAPS ў", "cyr", "lat", "ЎЗБЕК", "OʻZBEK"],
  ["Title ғ", "cyr", "lat", "Ғазал", "Gʻazal"],
  ["CAPS ғ", "cyr", "lat", "ҒАЗАЛ", "GʻAZAL"],
  ["Title ё", "cyr", "lat", "Ёшлар", "Yoshlar"],
  ["CAPS ю", "cyr", "lat", "ЮРТ", "YURT"],
  ["CAPS я", "cyr", "lat", "ЯНГИ", "YANGI"],
  ["initial is Title", "cyr", "lat", "Ш. Мирзиёев", "Sh. Mirziyoyev"],
  ["single capital Ч", "cyr", "lat", "Ч", "Ch"],
  ["lower stays lower", "cyr", "lat", "шшш", "shshsh"],
  ["CAPS щ", "cyr", "lat", "ЩИТ", "SHCHIT"],
  ["mid-word capital", "cyr", "lat", "МиШа", "MiSha"],
]);

run("cyr -> lat: сҳ needs a tutuq", [
  ["сҳ", "cyr", "lat", "сҳ", "sʼh"],
  ["СҲ", "cyr", "lat", "СҲ", "SʼH"],
  ["Сҳ", "cyr", "lat", "Сҳ", "Sʼh"],
  ["inside", "cyr", "lat", "бисҳа", "bisʼha"],
  ["after ц (ts + h)", "cyr", "lat", "оцҳа", "otsʼha"],
  ["with ш it is a real digraph + h", "cyr", "lat", "машҳур", "mashhur"],
]);

/* ───────────────────────── Latin -> Cyrillic ───────────────────────── */

run("lat -> cyr: letters", [
  ["sh", "lat", "cyr", "shahar", "шаҳар"],
  ["ch", "lat", "cyr", "chiroy", "чирой"],
  ["oʻ", "lat", "cyr", "oʻzbek", "ўзбек"],
  ["gʻ", "lat", "cyr", "gʻalaba", "ғалаба"],
  ["h", "lat", "cyr", "havo", "ҳаво"],
  ["q", "lat", "cyr", "qalam", "қалам"],
  ["x", "lat", "cyr", "xat", "хат"],
  ["j", "lat", "cyr", "jon", "жон"],
  ["ng", "lat", "cyr", "dengiz", "денгиз"],
  ["ng end", "lat", "cyr", "tong", "тонг"],
  ["n + gʻ is not ng", "lat", "cyr", "tongʻ", "тонғ"],
  ["Ng Title", "lat", "cyr", "Ng", "Нг"],
  ["NG CAPS", "lat", "cyr", "NG", "НГ"],
  ["yo", "lat", "cyr", "yomgʻir", "ёмғир"],
  ["yu", "lat", "cyr", "yurak", "юрак"],
  ["ya", "lat", "cyr", "yaxshi", "яхши"],
  ["yoʻ is й + ў", "lat", "cyr", "yoʻl", "йўл"],
  ["yoʻq", "lat", "cyr", "yoʻq", "йўқ"],
  ["yo after vowel", "lat", "cyr", "ayol", "аёл"],
  ["yo after vowel 2", "lat", "cyr", "kuyov", "куёв"],
  ["y before consonant", "lat", "cyr", "mayda", "майда"],
  ["-iya", "lat", "cyr", "jamiyat", "жамият"],
  ["unknown Latin letters kept", "lat", "cyr", "w", "w"],
]);

run("lat -> cyr: e / ye / э", [
  ["e at word start -> э", "lat", "cyr", "ertaga", "эртага"],
  ["e at word start 2", "lat", "cyr", "eng", "энг"],
  ["Title Eron", "lat", "cyr", "Eron", "Эрон"],
  ["e after consonant -> е", "lat", "cyr", "meva", "мева"],
  ["e after consonant 2", "lat", "cyr", "teatr", "театр"],
  ["ye at word start -> е", "lat", "cyr", "yer", "ер"],
  ["Ye Title", "lat", "cyr", "Yer", "Ер"],
  ["YE CAPS", "lat", "cyr", "YEVROPA", "ЕВРОПА"],
  ["ye after vowel -> е", "lat", "cyr", "poyezd", "поезд"],
  ["ye after consonant -> й + е", "lat", "cyr", "kuyyeb", "куййеб"],
  ["e after vowel -> э (lossless)", "lat", "cyr", "ae", "аэ"],
  ["e after tutuq -> э", "lat", "cyr", "taʼeb", "таъэб"],
  ["ye after tutuq -> е", "lat", "cyr", "podʼyezd", "подъезд"],
]);

run("lat -> cyr: digraph case", [
  ["Sharq", "lat", "cyr", "Sharq", "Шарқ"],
  ["SHARQ", "lat", "cyr", "SHARQ", "ШАРҚ"],
  ["Chiroy", "lat", "cyr", "Chiroy", "Чирой"],
  ["CHIROY", "lat", "cyr", "CHIROY", "ЧИРОЙ"],
  ["Oʻzbek", "lat", "cyr", "Oʻzbek", "Ўзбек"],
  ["OʻZBEK", "lat", "cyr", "OʻZBEK", "ЎЗБЕК"],
  ["Gʻazal", "lat", "cyr", "Gʻazal", "Ғазал"],
  ["GʻAZAL", "lat", "cyr", "GʻAZAL", "ҒАЗАЛ"],
  ["Yoshlar", "lat", "cyr", "Yoshlar", "Ёшлар"],
  ["YURT", "lat", "cyr", "YURT", "ЮРТ"],
  ["Sh.", "lat", "cyr", "Sh. Mirziyoyev", "Ш. Мирзиёев"],
]);

run("lat -> cyr: sʼh", [
  ["sʼh", "lat", "cyr", "sʼh", "сҳ"],
  ["SʼH", "lat", "cyr", "SʼH", "СҲ"],
  ["Sʼh", "lat", "cyr", "Sʼh", "Сҳ"],
  ["typed with '", "lat", "cyr", "bis'ha", "бисҳа"],
  ["mashhur = sh + h", "lat", "cyr", "mashhur", "машҳур"],
]);

run("lat -> cyr: -tsiya after a vowel", [
  ["-tsiya", "lat", "cyr", "motsiya", "моция"],
  ["-tsion", "lat", "cyr", "natsional", "национал"],
  ["other ts stays т+с", "lat", "cyr", "tsement", "тсемент"],
  ["ts after consonant stays", "lat", "cyr", "parts", "партс"],
]);

run("lat -> cyr: apostrophe variants on input", [
  ["tutuq ASCII '", "lat", "cyr", "ma'no", "маъно"],
  ["tutuq `", "lat", "cyr", "ma`no", "маъно"],
  ["tutuq ‘", "lat", "cyr", "ma‘no", "маъно"],
  ["tutuq ’", "lat", "cyr", "ma’no", "маъно"],
  ["tutuq ʻ", "lat", "cyr", "maʻno", "маъно"],
  ["tutuq ʼ", "lat", "cyr", "maʼno", "маъно"],
  ["tutuq ´", "lat", "cyr", "ma´no", "маъно"],
  ["Eʼlon", "lat", "cyr", "E'lon", "Эълон"],
  ["oʻ with '", "lat", "cyr", "o'zbek", "ўзбек"],
  ["oʻ with `", "lat", "cyr", "o`zbek", "ўзбек"],
  ["oʻ with ‘", "lat", "cyr", "o‘zbek", "ўзбек"],
  ["oʻ with ’", "lat", "cyr", "o’zbek", "ўзбек"],
  ["oʻ with ʻ", "lat", "cyr", "oʻzbek", "ўзбек"],
  ["oʻ with ʼ", "lat", "cyr", "oʼzbek", "ўзбек"],
  ["gʻ with '", "lat", "cyr", "g'alaba", "ғалаба"],
  ["gʻ with ‘", "lat", "cyr", "G‘alaba", "Ғалаба"],
  ["trailing gʻ", "lat", "cyr", "tog'", "тоғ"],
  ["trailing oʻ", "lat", "cyr", "qo'", "қў"],
  ["trailing apostrophe after other letters is a quote", "lat", "cyr", "'salom'", "'салом'"],
  ["typographic quotes around a word", "lat", "cyr", "‘salom’ dedi", "‘салом’ деди"],
]);

/* ───────────────────────── current Latin <-> NEW Latin ───────────────────────── */

run("lat -> new: letter mapping", [
  ["oʻ", "lat", "new", "oʻzbek", "özbek"],
  ["Oʻ", "lat", "new", "Oʻzbek", "Özbek"],
  ["OʻZ", "lat", "new", "OʻZBEK", "ÖZBEK"],
  ["gʻ", "lat", "new", "gʻalaba", "ğalaba"],
  ["Gʻ", "lat", "new", "Gʻazal", "Ğazal"],
  ["sh", "lat", "new", "shahar", "şahar"],
  ["Sh", "lat", "new", "Shahar", "Şahar"],
  ["SH", "lat", "new", "SHAHAR", "ŞAHAR"],
  ["ch", "lat", "new", "chiroy", "çiroy"],
  ["Ch", "lat", "new", "Chiroy", "Çiroy"],
  ["CH", "lat", "new", "CHIROY", "ÇIROY"],
  ["ng stays two letters", "lat", "new", "tong", "tong"],
  ["ng + gʻ", "lat", "new", "tongʻ", "tonğ"],
  ["typed apostrophes are normalised", "lat", "new", "o'zbek g'alaba", "özbek ğalaba"],
  ["tutuq stays", "lat", "new", "ma'no", "maʼno"],
  ["sʼh stays three characters", "lat", "new", "sʼh", "sʼh"],
  ["shh = ş + h", "lat", "new", "mashhur", "maşhur"],
  ["all four", "lat", "new", "Oʻzbek shahri, Gʻarb, chiroyli", "Özbek şahri, Ğarb, çiroyli"],
]);

run("new -> lat: letter mapping", [
  ["ö", "new", "lat", "özbek", "oʻzbek"],
  ["Ö", "new", "lat", "Özbek", "Oʻzbek"],
  ["ÖZ CAPS", "new", "lat", "ÖZBEK", "OʻZBEK"],
  ["ğ", "new", "lat", "ğalaba", "gʻalaba"],
  ["Ğ", "new", "lat", "Ğazal", "Gʻazal"],
  ["ş", "new", "lat", "şahar", "shahar"],
  ["Ş", "new", "lat", "Şahar", "Shahar"],
  ["Ş CAPS", "new", "lat", "ŞAHAR", "SHAHAR"],
  ["ç", "new", "lat", "çiroy", "chiroy"],
  ["Ç", "new", "lat", "Çiroy", "Chiroy"],
  ["Ç CAPS", "new", "lat", "ÇIROY", "CHIROY"],
  ["single Ş is Title", "new", "lat", "Ş", "Sh"],
  ["ng", "new", "lat", "tong", "tong"],
  ["s + h are two letters in the new Latin -> sʼh", "new", "lat", "sh", "sʼh"],
  ["Sh -> Sʼh", "new", "lat", "Sh", "Sʼh"],
  ["tutuq", "new", "lat", "maʼno", "maʼno"],
  ["tutuq typed as '", "new", "lat", "ma'no", "maʼno"],
]);

run("new <-> cyr", [
  ["new -> cyr özbek", "new", "cyr", "özbek", "ўзбек"],
  ["new -> cyr şahar", "new", "cyr", "şahar", "шаҳар"],
  ["new -> cyr çiroy", "new", "cyr", "çiroy", "чирой"],
  ["new -> cyr sh (s + h)", "new", "cyr", "sh", "сҳ"],
  ["new -> cyr ŞAHAR", "new", "cyr", "ŞAHAR", "ШАҲАР"],
  ["new -> cyr ğalaba", "new", "cyr", "Ğalaba", "Ғалаба"],
  ["cyr -> new şahar", "cyr", "new", "шаҳар", "şahar"],
  ["cyr -> new Ўзбек", "cyr", "new", "Ўзбек", "Özbek"],
  ["cyr -> new ЎЗБЕК", "cyr", "new", "ЎЗБЕК", "ÖZBEK"],
  ["cyr -> new çiroy", "cyr", "new", "чирой", "çiroy"],
  ["cyr -> new ğalaba", "cyr", "new", "ғалаба", "ğalaba"],
  ["cyr -> new dengiz (ng stays)", "cyr", "new", "денгиз", "dengiz"],
  ["cyr -> new сҳ", "cyr", "new", "сҳ", "sʼh"],
  ["cyr -> new Ш. initial", "cyr", "new", "Ш. Мирзиёев", "Ş. Mirziyoyev"],
]);

/* ───────────────────────── exceptions ───────────────────────── */

run("exceptions: whole words where the dictionary differs from the letter rules", [
  ["съезд", "cyr", "lat", "съезд", "syezd"],
  ["объект", "cyr", "lat", "объект", "obyekt"],
  ["мўъжиза", "cyr", "lat", "мўъжиза", "moʻjiza"],
  ["немец", "cyr", "lat", "немец", "nemis"],
  ["Нью-Йорк keeps hyphen", "cyr", "lat", "Нью-Йорк", "Nyu-York"],
  ["rayon", "lat", "cyr", "rayon", "район"],
  ["stansiya", "lat", "cyr", "stansiya", "станция"],
  ["sirk", "lat", "cyr", "sirk", "цирк"],
  ["konsert", "lat", "cyr", "konsert", "концерт"],
  ["litsey", "lat", "cyr", "litsey", "лицей"],
  ["syezd", "lat", "cyr", "syezd", "съезд"],
  ["obyekt", "lat", "cyr", "obyekt", "объект"],
  ["moʻjiza (typed ')", "lat", "cyr", "mo'jiza", "мўъжиза"],
  ["foye", "lat", "cyr", "foye", "фойе"],
  ["bulyon", "lat", "cyr", "bulyon", "бульон"],
  ["yanvar", "lat", "cyr", "yanvar", "январь"],
  ["iyun", "lat", "cyr", "iyun", "июнь"],
  ["avtomobil", "lat", "cyr", "avtomobil", "автомобиль"],
  ["Nyu-York", "lat", "cyr", "Nyu-York", "Нью-Йорк"],
  ["new Latin input uses the dictionary too", "new", "cyr", "stansiya", "станция"],
  ["cyr -> new uses the dictionary", "cyr", "new", "мўъжиза", "möjiza"],
  ["cyr -> new съезд", "cyr", "new", "съезд", "syezd"],
]);

run("exceptions: case is preserved (lower, Title, UPPER)", [
  ["Немец", "cyr", "lat", "Немец", "Nemis"],
  ["НЕМЕЦ", "cyr", "lat", "НЕМЕЦ", "NEMIS"],
  ["Съезд", "cyr", "lat", "Съезд", "Syezd"],
  ["СЪЕЗД", "cyr", "lat", "СЪЕЗД", "SYEZD"],
  ["Rayon", "lat", "cyr", "Rayon", "Район"],
  ["RAYON", "lat", "cyr", "RAYON", "РАЙОН"],
  ["Stansiya", "lat", "cyr", "Stansiya", "Станция"],
  ["Nyu-York hyphen Title", "lat", "cyr", "Nyu-York", "Нью-Йорк"],
  ["lower hyphen part", "lat", "cyr", "nyu-york", "нью-йорк"],
  ["mixed case skips the dictionary", "cyr", "lat", "СъЕзд", "SʼYezd"],
]);

run("exceptions: inflected forms (stem prefix + suffix chain), both directions", [
  ["цирки", "cyr", "lat", "цирки", "sirki"],
  ["Цирки", "cyr", "lat", "Цирки", "Sirki"],
  ["концертлар", "cyr", "lat", "концертлар", "konsertlar"],
  ["КОНЦЕРТЛАР", "cyr", "lat", "КОНЦЕРТЛАР", "KONSERTLAR"],
  ["немецлар", "cyr", "lat", "немецлар", "nemislar"],
  ["немецларнинг (suffix chain)", "cyr", "lat", "немецларнинг", "nemislarning"],
  ["станцияда", "cyr", "lat", "станцияда", "stansiyada"],
  ["съездда", "cyr", "lat", "съездда", "syezdda"],
  ["объектлар", "cyr", "lat", "объектлар", "obyektlar"],
  ["longest stem wins: объектив", "cyr", "lat", "объективлар", "obyektivlar"],
  ["longest stem wins: центр over цент", "cyr", "lat", "марказий центрга", "markaziy sentrga"],
  ["stansiyada", "lat", "cyr", "stansiyada", "станцияда"],
  ["sirkda", "lat", "cyr", "sirkda", "циркда"],
  ["konsertlar", "lat", "cyr", "konsertlar", "концертлар"],
  ["rayonlar", "lat", "cyr", "rayonlar", "районлар"],
  ["rayonda", "lat", "cyr", "rayonda", "районда"],
  ["Rayonning", "lat", "cyr", "Rayonning", "Районнинг"],
  ["obyektlar", "lat", "cyr", "obyektlar", "объектлар"],
  ["new Latin stem", "new", "cyr", "stansiyada", "станцияда"],
  ["a tail that is no suffix is NOT a stem match (vinegar)", "lat", "cyr", "sirka", "сирка"],
  ["not a suffix chain: цирковой", "cyr", "lat", "цирковой", "sirkovoy"],
  ["stem shorter than 3 is never a stem", "cyr", "lat", "яш", "yash"],
  ["inflected, uppercase tail context: ц after vowel", "cyr", "lat", "станцияси", "stansiyasi"],
]);

test("exceptions: suffix chain validator", () => {
  const atoms = new Set(["lar", "ning", "da", "i"]);
  assert.equal(isSuffixChain("larning", atoms), true);
  assert.equal(isSuffixChain("lardai", atoms), true);
  assert.equal(isSuffixChain("a", atoms), false);
  assert.equal(isSuffixChain("", atoms), false);
  assert.equal(isSuffixChain("l".repeat(40), atoms), false, "tails over the cap are refused");
});

test("exceptions: the list is non-trivial and every entry converts to itself in both directions", () => {
  assert.ok(EXCEPTIONS.length >= 100);
  for (const [cyr, lat] of EXCEPTIONS) {
    assert.equal(convert(cyr, "cyr", "lat"), lat, `cyr->lat «${cyr}»`);
  }
  // Reverse: every entry whose Latin form is unique round-trips (first entry wins for a shared Latin form).
  const seen = new Set<string>();
  for (const [cyr, lat] of EXCEPTIONS) {
    if (seen.has(lat.toLowerCase())) continue;
    seen.add(lat.toLowerCase());
    assert.equal(convert(lat, "lat", "cyr"), cyr, `lat->cyr «${lat}»`);
  }
});

/* ───────────────────────── exceptions.ts is generated from the TSV ───────────────────────── */

test("exceptions.ts is in sync with the TSV (regenerate with `npm run translit:exceptions`)", () => {
  const tsv = readFileSync(new URL(`../${EXCEPTIONS_TSV_PATH}`, import.meta.url), "utf8");
  const ts = readFileSync(new URL(`../${EXCEPTIONS_TS_PATH}`, import.meta.url), "utf8");
  const rows = parseExceptionsTsv(tsv);
  assert.equal(ts, renderExceptions(rows), "exceptions.ts differs from what the generator renders from the TSV");
  assert.deepEqual(
    EXCEPTIONS.map(([c, l]) => [c, l]),
    rows.map((r) => [r.cyr, r.lat]),
  );
});

test("exceptions TSV parser: strict about malformed and duplicate rows", () => {
  const head = "kirill\tlotin\tturkum\tizoh\n";
  assert.equal(parseExceptionsTsv(`${head}цирк\tsirk\tts\n\nцех\tsex\tts\ttest`).length, 2);
  assert.throws(() => parseExceptionsTsv(`${head}цирк\tsirk\nЦирк\tsirkx`), /duplicate Cyrillic/);
  assert.throws(() => parseExceptionsTsv(`${head}цирк\tsirk\nцех\tSirk`), /duplicate Latin/);
  assert.throws(() => parseExceptionsTsv(`${head}circ\tsirk`), /not a Cyrillic/);
  assert.throws(() => parseExceptionsTsv(`${head}цирк\tсирк`), /not a Latin/);
  assert.throws(() => parseExceptionsTsv(`${head}цирк\tmo'jiza`), /not a Latin/, "ASCII apostrophe must be ʻ/ʼ in the list");
  assert.throws(() => parseExceptionsTsv(`${head}цирк`), /not a Latin/);
});

/* ───────────────────────── what must NOT be converted ───────────────────────── */

run("preserved: URLs, e-mails, numbers, punctuation, foreign words", [
  ["https URL", "cyr", "lat", "https://slaydx.uz/Ўзбек?q=шаҳар", "https://slaydx.uz/Ўзбек?q=шаҳар"],
  ["URL in a sentence", "cyr", "lat", "Сайт: https://kitob.uz/ёзги ва китоб", "Sayt: https://kitob.uz/ёзги va kitob"],
  ["e-mail", "cyr", "lat", "Почта: ali.valiyev@mail.uz", "Pochta: ali.valiyev@mail.uz"],
  ["e-mail with Cyrillic local part is kept whole", "cyr", "lat", "шаҳар@mail.uz", "шаҳар@mail.uz"],
  ["www", "cyr", "lat", "www.kitob.uz сайти", "www.kitob.uz sayti"],
  ["bare domain", "cyr", "lat", "kitob.uz китоблари", "kitob.uz kitoblari"],
  ["URL, latin source", "lat", "cyr", "Sayt: https://kitob.uz/oʻzbek", "Сайт: https://kitob.uz/oʻzbek"],
  ["e-mail, latin source", "lat", "cyr", "pochta: shahar@mail.uz", "почта: shahar@mail.uz"],
  ["e-mail, new Latin source", "new", "lat", "şahar@mail.uz", "şahar@mail.uz"],
  ["iPhone inside Cyrillic", "cyr", "lat", "Мен iPhone олдим", "Men iPhone oldim"],
  ["Google inside Cyrillic", "cyr", "lat", "Google қидирув", "Google qidiruv"],
  ["Chrome is not Çrome", "cyr", "new", "Ўзбек Chrome Shop", "Özbek Chrome Shop"],
  ["Latin word glued with a Cyrillic suffix", "cyr", "lat", "Google'да", "Google'da"],
  ["digits and punctuation", "cyr", "lat", "1991-йил, 12:30, 5 000 сўм, (ёки) «тирноқ»!", "1991-yil, 12:30, 5 000 soʻm, (yoki) «tirnoq»!"],
  ["digits and punctuation, back", "lat", "cyr", "1991-yil, 12:30, 5 000 soʻm, (yoki) «tirnoq»!", "1991-йил, 12:30, 5 000 сўм, (ёки) «тирноқ»!"],
  ["emoji and symbols", "cyr", "lat", "Салом 👋 №5 — 100%", "Salom 👋 №5 — 100%"],
  ["line breaks and tabs", "cyr", "lat", "Салом\n\nдунё\t!\r\nҳа", "Salom\n\ndunyo\t!\r\nha"],
  ["camelCase Latin kept (latin source)", "lat", "cyr", "iPhone va shahar", "iPhone ва шаҳар"],
  ["w kept (latin source)", "lat", "cyr", "Wi-Fi tarmogʻi", "Wi-Fi тармоғи"],
  ["stray c kept (latin source)", "lat", "new", "Coca-Cola va shahar", "Coca-Cola va şahar"],
  ["A4 stays", "cyr", "lat", "A4 қоғоз", "A4 qogʻoz"],
  ["empty", "cyr", "lat", "", ""],
  ["only spaces", "cyr", "lat", "   ", "   "],
  ["same script is the identity", "lat", "lat", "Oʻzbek o'zbek", "Oʻzbek o'zbek"],
  ["same script cyr", "cyr", "cyr", "Ўзбек", "Ўзбек"],
  ["same script new", "new", "new", "Özbek", "Özbek"],
]);

test("isProtectedToken", () => {
  for (const t of ["a@b.uz", "https://x.uz", "http://x", "ftp://h", "www.x.uz", "mailto:a", "kitob.uz", "x.com,", "(site.org)"]) {
    assert.equal(isProtectedToken(t), true, t);
  }
  for (const t of ["шаҳар", "kitob", "5.000", "tugadi.", "salom,"]) assert.equal(isProtectedToken(t), false, t);
});

/* ───────────────────────── corpus: 31 sentences, every direction ───────────────────────── */

/** [Cyrillic, current Latin] — hand written; the new Latin is derived by an independent oracle below. */
const CORPUS: [string, string][] = [
  ["Ўзбекистон Республикаси мустақил, суверен, демократик давлатдир.", "Oʻzbekiston Respublikasi mustaqil, suveren, demokratik davlatdir."],
  ["Ҳар бир инсон тенг ҳуқуқ ва эркинликка эга.", "Har bir inson teng huquq va erkinlikka ega."],
  ["Тошкент шаҳри мамлакатимизнинг пойтахтидир.", "Toshkent shahri mamlakatimizning poytaxtidir."],
  ["Мен ҳар куни эрталаб соат олтида туриб, сайр қиламан.", "Men har kuni ertalab soat oltida turib, sayr qilaman."],
  ["Китоб — билим манбаи, ақл-идрок чироғи.", "Kitob — bilim manbai, aql-idrok chirogʻi."],
  ["Бугун об-ҳаво ажойиб: қуёш порлаб, осмон тип-тиниқ.", "Bugun ob-havo ajoyib: quyosh porlab, osmon tip-tiniq."],
  ["Талабалар кутубхонада имтиҳонга тайёрланишмоқда.", "Talabalar kutubxonada imtihonga tayyorlanishmoqda."],
  ["Ўқитувчи дарсни янги усулда тушунтирди.", "Oʻqituvchi darsni yangi usulda tushuntirdi."],
  ["Қишлоқ хўжалиги ходимлари ҳосилни ўз вақтида йиғиб олишди.", "Qishloq xoʻjaligi xodimlari hosilni oʻz vaqtida yigʻib olishdi."],
  ["Бизнинг мақсадимиз — ватан равнақи ва халқ фаровонлигидир.", "Bizning maqsadimiz — vatan ravnaqi va xalq farovonligidir."],
  ["Узоқ йиллик тажриба шуни кўрсатдики, ҳаракат қилган ютади.", "Uzoq yillik tajriba shuni koʻrsatdiki, harakat qilgan yutadi."],
  ["Мактабдаги ўқувчилар бугун экскурсияга боришди.", "Maktabdagi oʻquvchilar bugun ekskursiyaga borishdi."],
  ["Эрталабки нонушта учун янги пишган нон ва чой тайёрладик.", "Ertalabki nonushta uchun yangi pishgan non va choy tayyorladik."],
  ["Бу ҳақда яқинда эълон қилинган маълумотлар ишончли.", "Bu haqda yaqinda eʼlon qilingan maʼlumotlar ishonchli."],
  ["Ёзги таътил вақтида оилам билан денгиз бўйига бордик.", "Yozgi taʼtil vaqtida oilam bilan dengiz boʻyiga bordik."],
  ["Ҳурматли ҳамкасблар, анжуманимизга хуш келибсиз!", "Hurmatli hamkasblar, anjumanimizga xush kelibsiz!"],
  ["Алишер Навоий ўзбек адабиётининг буюк асосчисидир.", "Alisher Navoiy oʻzbek adabiyotining buyuk asoschisidir."],
  ["Наврўз — баҳор байрами, ўзбек халқининг севимли айёми.", "Navroʻz — bahor bayrami, oʻzbek xalqining sevimli ayyomi."],
  ["Ёш олимлар янги кашфиёт устида ишлаяпти.", "Yosh olimlar yangi kashfiyot ustida ishlayapti."],
  ["Юртимизда тинчлик ва осойишталик барқарор.", "Yurtimizda tinchlik va osoyishtalik barqaror."],
  ["Ҳамма ёқда байрам кайфияти ҳукм суради.", "Hamma yoqda bayram kayfiyati hukm suradi."],
  ["Эртага соат ўнда мажлис бошланади, илтимос, кечикманг.", "Ertaga soat oʻnda majlis boshlanadi, iltimos, kechikmang."],
  ["Менинг севимли фанларим — математика, физика ва тарих.", "Mening sevimli fanlarim — matematika, fizika va tarix."],
  ["Дарёнинг нариги соҳилида катта боғ бор.", "Daryoning narigi sohilida katta bogʻ bor."],
  ["Ўзбекча таомлар орасида палов энг машҳури ҳисобланади.", "Oʻzbekcha taomlar orasida palov eng mashhuri hisoblanadi."],
  ["Ота-оналаримизнинг дуоси билан ҳаммаси яхши бўлади.", "Ota-onalarimizning duosi bilan hammasi yaxshi boʻladi."],
  ["Хотира майдонида ёдгорлик ва ҳайкал ўрнатилди.", "Xotira maydonida yodgorlik va haykal oʻrnatildi."],
  ["ШАҲАР ҲОКИМИ ҚЎШИҚ ВА РАҚС КЕЧАСИНИ ОЧДИ.", "SHAHAR HOKIMI QOʻSHIQ VA RAQS KECHASINI OCHDI."],
  ["Қонун ижроси барчамиз учун бурч ва шарафли вазифадир.", "Qonun ijrosi barchamiz uchun burch va sharafli vazifadir."],
  ["Ғолиблар мукофотланди: Ғайрат, Ўткир ва Шоира.", "Gʻoliblar mukofotlandi: Gʻayrat, Oʻtkir va Shoira."],
  // The alphabet line of the law (Art. 1), one letter per word: A B D E F G Ğ H I J K L M N O Ö P Q R S Ş Ç T U V X Y Z
  ["А Б Д Э Ф Г Ғ Ҳ И Ж К Л М Н О Ў П Қ Р С Ш Ч Т У В Х Й З", "A B D E F G Gʻ H I J K L M N O Oʻ P Q R S Sh Ch T U V X Y Z"],
];

/** Independent oracle for current Latin -> new Latin on this corpus (no sʼh, no foreign words in it). */
const LAW_ALPHABET = "A B D E F G Ğ H I J K L M N O Ö P Q R S Ş Ç T U V X Y Z";
function newLatinOracle(lat: string): string {
  return lat
    .replace(/Oʻ/g, "Ö")
    .replace(/oʻ/g, "ö")
    .replace(/Gʻ/g, "Ğ")
    .replace(/gʻ/g, "ğ")
    .replace(/SH|Sh/g, "Ş")
    .replace(/sh/g, "ş")
    .replace(/CH|Ch/g, "Ç")
    .replace(/ch/g, "ç");
}

test("corpus: 31 sentences (incl. the law's alphabet line) convert in all 6 directions", () => {
  assert.equal(CORPUS.length, 31);
  assert.equal(newLatinOracle(CORPUS.at(-1)![1]), LAW_ALPHABET, "the oracle reproduces the law's own alphabet line");
  CORPUS.forEach(([cyr, lat], i) => {
    const nw = newLatinOracle(lat);
    const at = `#${i + 1}`;
    assert.equal(convert(cyr, "cyr", "lat"), lat, `${at} cyr->lat`);
    assert.equal(convert(cyr, "cyr", "new"), nw, `${at} cyr->new`);
    assert.equal(convert(lat, "lat", "cyr"), cyr, `${at} lat->cyr`);
    assert.equal(convert(nw, "new", "cyr"), cyr, `${at} new->cyr`);
    assert.equal(convert(lat, "lat", "new"), nw, `${at} lat->new`);
    assert.equal(convert(nw, "new", "lat"), lat, `${at} new->lat`);
  });
});

test("corpus: new-Latin round trips are the identity (cyr->new->cyr and lat->new->lat)", () => {
  CORPUS.forEach(([cyr, lat], i) => {
    assert.equal(convert(convert(cyr, "cyr", "new"), "new", "cyr"), cyr, `#${i + 1} cyr->new->cyr`);
    assert.equal(convert(convert(lat, "lat", "new"), "new", "lat"), lat, `#${i + 1} lat->new->lat`);
    assert.equal(convert(convert(cyr, "cyr", "lat"), "lat", "cyr"), cyr, `#${i + 1} cyr->lat->cyr`);
  });
});

test("corpus: one big text (all sentences, mixed with line breaks) round-trips and keeps its line structure", () => {
  const cyr = CORPUS.map(([c]) => c).join("\n");
  const lat = CORPUS.map(([, l]) => l).join("\n");
  assert.equal(convert(cyr, "cyr", "lat"), lat);
  assert.equal(convert(convert(cyr, "cyr", "new"), "new", "cyr"), cyr);
  assert.equal(convert(lat, "lat", "cyr").split("\n").length, CORPUS.length);
});

test("sʼh survives the new Latin (the only place a tutuq separates two letters)", () => {
  for (const cyr of ["Исҳоқ", "асҳоб", "сҳ", "бисҳа", "СҲ"]) {
    const nw = convert(cyr, "cyr", "new");
    assert.match(nw, /sʼh|SʼH|Sʼh/i, `${cyr} -> ${nw}`);
    assert.equal(convert(nw, "new", "cyr"), cyr);
  }
});

test("determinism: converting twice gives the same output; input is never mutated", () => {
  const src = CORPUS.map(([c]) => c).join(" ");
  assert.equal(convert(src, "cyr", "new"), convert(src, "cyr", "new"));
});

test("performance: a 2 MB Cyrillic text converts in well under 10 seconds", () => {
  const chunk = CORPUS.map(([c]) => c).join(" ") + "\n";
  const big = chunk.repeat(Math.ceil((2 * 1024 * 1024) / Buffer.byteLength(chunk)));
  const t0 = Date.now();
  const out = convert(big, "cyr", "new");
  assert.ok(out.length > 1_000_000);
  assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
});
