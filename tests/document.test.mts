import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { extractMeta, minPages, parseAuthorLine } from "../lib/generation/meta.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { FormValues, ToolId } from "../lib/types.ts";

/**
 * Hujjat qobig'i: titul sahifa, muallif ma'lumotlari, ramka.
 *
 * Bu tekshiruvlar Sprint 2 da tuzatilgan nuqsonlarni qulflaydi —
 * kurs/guruh titulga chiqishi, imzo qatorlari, ramka faqat inshoda.
 */

function meta(toolId: "coursework" | "essay" | "referat" | "article" | "thesis", values: FormValues) {
  return extractMeta(TOOL_BY_ID[toolId], values);
}

function doc(toolId: "coursework" | "essay" | "referat" | "article" | "thesis", values: FormValues): AcademicDoc {
  return {
    meta: meta(toolId, values),
    titlePage: true,
    toc: false,
    sections: [{ id: "a", title: "Kirish", blocks: [{ kind: "p", text: "Matn." }] }],
  };
}

/** DOCX ichidagi ko'rinadigan matn. */
async function docxText(d: AcademicDoc): Promise<string> {
  const bytes = await renderDocx(d);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// -------------------------------------------------- muallif satri

test("muallif satridan kurs va guruh ajratiladi", () => {
  assert.deepEqual(parseAuthorLine("Aliyev Ali — 3-kurs, 301-guruh"), {
    name: "Aliyev Ali",
    course: "3",
    group: "301",
  });
  assert.deepEqual(parseAuthorLine("Saidova Sevara — 4-kurs"), {
    name: "Saidova Sevara",
    course: "4",
    group: "",
  });
  assert.deepEqual(parseAuthorLine("Toshmatov J., 12a-guruh"), {
    name: "Toshmatov J.",
    course: "",
    group: "12a",
  });
});

test("kurs/guruh yo'q satr o'zgarishsiz qoladi", () => {
  for (const raw of ["Karimova M.", "Aliyev Ali Valiyevich", ""]) {
    const p = parseAuthorLine(raw);
    assert.equal(p.name, raw);
    assert.equal(p.course, "");
    assert.equal(p.group, "");
  }
});

/**
 * Post-render sahifa darvozasi PASTKI chegaraga qaraydi, o'rtachaga emas.
 *
 * «15–20 bet» va'da qilinganda foydalanuvchi kamida 15 ni kutadi.
 * `parsePages` (targetPages uchun) o'rtachani beradi — bu funksiya esa
 * ataylab pastki chegarani.
 */
test("minPages diapazonning pastki chegarasini qaytaradi", () => {
  assert.equal(minPages("10-15", 8), 10);
  assert.equal(minPages("40-45", 8), 40);
  // Yagona son (insho «varaq») — o'zi qaytadi.
  assert.equal(minPages("2", 8), 2);
  // Bo'sh yoki buzuq qiymat — fallback.
  assert.equal(minPages("", 8), 8);
  assert.equal(minPages("noma'lum", 8), 8);
});

test("alohida maydon berilsa u satrdan ustun turadi", () => {
  const m = meta("coursework", { author: "Aliyev Ali — 3-kurs, 301-guruh", course: "4", group: "402" });
  assert.equal(m.course, "4");
  assert.equal(m.group, "402");
  assert.equal(m.author, "Aliyev Ali");
});

// -------------------------------------------------- titul sahifa

test("kurs va guruh titul sahifada ko'rinadi", async () => {
  const text = await docxText(
    doc("coursework", {
      topic: "O'qish ko'nikmasi",
      author: "Aliyev Ali — 3-kurs, 301-guruh",
      university: "TDPU",
      teacher: "Ergashov B.",
    }),
  );
  assert.match(text, /Aliyev Ali/);
  assert.match(text, /3-kurs/);
  assert.match(text, /301-guruh/);
  // Butun satr muallif o'rniga chiqmasligi kerak.
  assert.doesNotMatch(text, /Bajardi: Aliyev Ali — 3-kurs/);
});

test("bajaruvchi va rahbar uchun imzo qatori bor", async () => {
  const text = await docxText(
    doc("coursework", { topic: "X", author: "Aliyev Ali", university: "TDPU", teacher: "Ergashov B." }),
  );
  assert.ok(text.split("____________").length - 1 >= 2, "ikkita imzo chizig'i kutilgan edi");
});

/**
 * Maqola titul sahifasi — «talaba ishi» shabloni emas.
 *
 * Maqola formasi universitet emas, tashkilot/daraja/email yig'adi
 * (muallif PhD/dotsent ham bo'lishi mumkin). Ilgari bu uch maydon
 * viewerda ko'rinar, lekin DOCX faylida umuman render qilinmasdi —
 * fayl esa vazirlik sarlavhali OTME shabloniga tushardi.
 */
test("maqola titulida vazirlik/universitet o'rniga muallif bloki chiqadi", async () => {
  const text = await docxText(
    doc("article", {
      topic: "Qayta tiklanuvchi energiya",
      author: "Aliyev Ali Valiyevich",
      degree: "PhD",
      organization: "Toshkent davlat texnika universiteti",
      email: "ali@example.uz",
    }),
  );
  assert.match(text, /PhD/);
  assert.match(text, /Toshkent davlat texnika universiteti/);
  assert.match(text, /ali@example\.uz/);
  assert.doesNotMatch(text, /VAZIRLIGI/, "maqolada vazirlik sarlavhasi chiqmasligi kerak");
});

test("maqolada muallif/tashkilot bo'sh bo'lsa qatorlar tashlab ketiladi", async () => {
  const text = await docxText(doc("article", { topic: "X", author: "Aliyev Ali" }));
  assert.match(text, /Aliyev Ali/);
  assert.doesNotMatch(text, /VAZIRLIGI/);
});

// -------------------------------------------------- ramka

test("sahifa ramkasi faqat inshoda", async () => {
  const JSZip = (await import("jszip")).default;
  const hasBorder = async (d: AcademicDoc) => {
    const zip = await JSZip.loadAsync(await renderDocx(d));
    return (await zip.file("word/document.xml")!.async("string")).includes("pgBorders");
  };
  assert.equal(await hasBorder(doc("essay", { topic: "Vatan", design: "iris" })), true);
  assert.equal(await hasBorder(doc("referat", { topic: "Dvigatel" })), false);
  assert.equal(await hasBorder(doc("coursework", { topic: "X" })), false);
});

test("mundarijada taxminiy sahifa raqami yo'q", async () => {
  const d = doc("referat", { topic: "X" });
  d.toc = true;
  d.sections = [
    { id: "a", title: "Kirish", blocks: [{ kind: "p", text: "M." }] },
    { id: "b", title: "Xulosa", blocks: [{ kind: "p", text: "M." }] },
  ];
  const text = await docxText(d);
  const toc = text.slice(text.indexOf("MUNDARIJA"), text.indexOf("KIRISH", text.indexOf("MUNDARIJA") + 10));
  assert.doesNotMatch(toc, /\.{3,}\s*\d/, "nuqtali yetakchi + raqam qolmasligi kerak");
});

// -------------------------------------------------- HTML ko'rinish

test("ro'yxat bandlari o'z joyida qoladi, oxiriga ko'chirilmaydi", async () => {
  const { renderHtml } = await import("../lib/generation/render-html.ts");
  const d = doc("referat", { topic: "X" });
  d.sections = [
    {
      id: "keys",
      title: "Keys 1",
      blocks: [
        { kind: "p", text: "Vaziyat tavsifi." },
        { kind: "h3", text: "Topshiriqlar" },
        { kind: "li", text: "Birinchi topshiriq" },
        { kind: "li", text: "Ikkinchi topshiriq" },
        { kind: "h3", text: "Kalit" },
        { kind: "p", text: "Namunaviy javob." },
      ],
    },
  ];
  const html = renderHtml(d);
  const body = html.slice(html.indexOf("Keys 1"));
  assert.ok(
    body.indexOf("Birinchi topshiriq") < body.indexOf("Kalit"),
    "topshiriqlar kalitdan oldin turishi kerak",
  );
  assert.equal(body.split("<ul>").length - 1, 1, "ketma-ket bandlar bitta ro'yxatga yig'ilsin");
});

test("bo'lingan ro'yxatlar alohida <ul> bo'ladi", async () => {
  const { renderHtml } = await import("../lib/generation/render-html.ts");
  const d = doc("referat", { topic: "X" });
  d.sections = [
    {
      id: "a",
      title: "Bo'lim",
      blocks: [
        { kind: "li", text: "A1" },
        { kind: "p", text: "Oraliq matn." },
        { kind: "li", text: "B1" },
      ],
    },
  ];
  const html = renderHtml(d);
  assert.equal(html.split("<ul>").length - 1, 2);
});

// -------------------------------------------------- qo'lda yozilgan reja

test("qo'lda yozilgan reja bob va ostmavzularga ajratiladi", async () => {
  const { parseManualOutline } = await import("../lib/generation/quality.ts");
  const plan = [
    "Kirish",
    "I bob. Nazariy asoslar",
    "  1.1 Tushunchaning mohiyati",
    "  1.2 Tasnif va turlari",
    "II bob. Amaliy tahlil",
    "  2.1 O'zbekiston tajribasi",
    "Xulosa",
    "Foydalanilgan adabiyotlar",
  ].join("\n");
  const out = parseManualOutline(plan);
  assert.equal(out.length, 2, "ikkita bob kutilgan edi");
  assert.deepEqual(out[0].subs, ["Tushunchaning mohiyati", "Tasnif va turlari"]);
  assert.deepEqual(out[1].subs, ["O'zbekiston tajribasi"]);
  // Kirish/Xulosa/Adabiyotlar bob emas — ular tuzilmada alohida.
  assert.ok(!out.some((c) => /kirish|xulosa|adabiyot/i.test(c.title)));
});

test("raqamsiz va surilmagan reja — hammasi bob", async () => {
  const { parseManualOutline } = await import("../lib/generation/quality.ts");
  const out = parseManualOutline("Birinchi masala\nIkkinchi masala\nUchinchi masala");
  assert.equal(out.length, 3);
  assert.ok(out.every((c) => c.subs.length === 0));
});

test("bo'sh yoki yaroqsiz reja bo'sh ro'yxat qaytaradi", async () => {
  const { parseManualOutline } = await import("../lib/generation/quality.ts");
  assert.deepEqual(parseManualOutline(""), []);
  assert.deepEqual(parseManualOutline("Kirish\nXulosa"), []);
  assert.deepEqual(parseManualOutline("ab\ncd"), []);
});

/**
 * Mundarija raqamlashi.
 *
 * Muammo hujjatning PDF ko'rinishida topilgan: bob sarlavhasi RAQAMSIZ
 * chiqardi («ICHKI YONUV DVIGATELLARIDA…»), ostidagi ostmavzu esa
 * «1.1.» bo'lardi — «1» qaysi bobga tegishli ekani ko'rinmasdi. Sabab:
 * raqamni model yozardi va u izchil emas edi.
 *
 * Endi raqam qurilish yo'li bilan qo'yiladi. Sinov ikki narsani
 * ushlaydi: raqam ajratkichi ishonchli tanilishi va mundarija modeli
 * fayl bilan viewer uchun bir xil qatorlarni berishi.
 */
test("sarlavhadagi raqam olib tashlanadi, ammo raqamdan boshlangan so'z saqlanadi", async () => {
  const { stripHeadingNumber, romanNumeral } = await import("../lib/generation/quality.ts");

  assert.equal(stripHeadingNumber("1.1. Ta'rif va mohiyat"), "Ta'rif va mohiyat");
  assert.equal(stripHeadingNumber("I BOB. NAZARIY ASOSLAR"), "NAZARIY ASOSLAR");
  assert.equal(stripHeadingNumber("ГЛАВА I. ТЕОРЕТИЧЕСКИЕ ОСНОВЫ"), "ТЕОРЕТИЧЕСКИЕ ОСНОВЫ");
  assert.equal(stripHeadingNumber("CHAPTER II. PRACTICAL ANALYSIS"), "PRACTICAL ANALYSIS");

  /*
   * Model rim o'rniga ARAB raqamini ham ishlatadi («1-BOB.»). Jonli
   * sinovda bu qolipsiz qolib, `numberOutline` o'z prefiksini ustiga
   * qo'shib «I BOB. 1-BOB. …» kabi qo'sh sarlavha chiqargan.
   */
  assert.equal(stripHeadingNumber("1-BOB. QAYTA TIKLANUVCHI ENERGIYA"), "QAYTA TIKLANUVCHI ENERGIYA");
  assert.equal(stripHeadingNumber("2 BOB. Amaliy qism"), "Amaliy qism");
  assert.equal(stripHeadingNumber("1-ГЛАВА. Введение"), "Введение");

  // Raqamga o'xshagan, lekin raqam BO'LMAGAN boshlanishlar buzilmasligi kerak.
  assert.equal(stripHeadingNumber("IT sohasida raqamlashtirish"), "IT sohasida raqamlashtirish");
  assert.equal(stripHeadingNumber("3D modellashtirish asoslari"), "3D modellashtirish asoslari");
  assert.equal(stripHeadingNumber("COVID-19 pandemiyasi"), "COVID-19 pandemiyasi");
  // Butunlay raqamdan iborat sarlavha bo'sh qolmaydi.
  assert.equal(stripHeadingNumber("2.2"), "2.2");

  assert.equal(romanNumeral(1), "I");
  assert.equal(romanNumeral(3), "III");
});

test("yolg'iz rim harfi muallif initsiali sifatida saqlanadi", async () => {
  const { stripHeadingNumber } = await import("../lib/generation/quality.ts");

  // `I`, `V`, `X`, `L`, `C` — ham rim raqami, ham initsial. Kalit so'zsiz
  // ular initsial deb qaraladi, aks holda familiya initsialsiz qolardi.
  assert.equal(
    stripHeadingNumber("I. Karimov asarlarida ta'lim masalasi"),
    "I. Karimov asarlarida ta'lim masalasi",
  );
  assert.equal(stripHeadingNumber("V. Vernadskiy ta'limoti"), "V. Vernadskiy ta'limoti");
  assert.equal(stripHeadingNumber("L. Tolstoy romanlari"), "L. Tolstoy romanlari");
  assert.equal(stripHeadingNumber("X. Sultonov ijodi"), "X. Sultonov ijodi");
  assert.equal(stripHeadingNumber("C. Darwin nazariyasi"), "C. Darwin nazariyasi");

  // Kalit so'z bilan kelsa — bu bob raqami, kesiladi.
  assert.equal(stripHeadingNumber("I BOB. NAZARIY ASOSLAR"), "NAZARIY ASOSLAR");
  assert.equal(stripHeadingNumber("ГЛАВА I. ТЕОРЕТИЧЕСКИЕ ОСНОВЫ"), "ТЕОРЕТИЧЕСКИЕ ОСНОВЫ");
  assert.equal(stripHeadingNumber("CHAPTER I. FOUNDATIONS"), "FOUNDATIONS");

  // Ikki harfdan boshlab noaniqlik yo'q — kalit so'zsiz ham kesiladi.
  assert.equal(stripHeadingNumber("II. Amaliy tahlil"), "Amaliy tahlil");
  assert.equal(stripHeadingNumber("IV. Bosqich natijalari"), "Bosqich natijalari");
  assert.equal(stripHeadingNumber("IX. Xulosa qismi"), "Xulosa qismi");

  // Qo'shaloq initsial hech qachon raqam emas.
  assert.equal(stripHeadingNumber("I.A. Karimov merosi"), "I.A. Karimov merosi");
});

test("matnsiz bo'lim na hujjatda, na mundarijada chizilmaydi", async () => {
  const { tocRows } = await import("../lib/generation/toc-model.ts");
  const JSZip = (await import("jszip")).default;

  const meta = extractMeta(TOOL_BY_ID["essay"], { topic: "Vatan", pages: "2" } as FormValues);
  const doc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [
      { id: "kirish", title: "Kirish", blocks: [] },
      {
        id: "asosiy",
        title: "Vatan tuygusi",
        blocks: [{ kind: "p" as const, text: "A".repeat(120) }],
      },
      { id: "xulosa", title: "Xulosa", blocks: [] },
    ],
  } as unknown as AcademicDoc;

  const zip = await JSZip.loadAsync(await renderDocx(doc));
  const xml = await zip.file("word/document.xml")!.async("string");
  const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);

  assert.ok(!texts.includes("KIRISH"), "bo'sh KIRISH sarlavhasi chizilmasligi kerak");
  assert.ok(!texts.includes("XULOSA"), "bo'sh XULOSA sarlavhasi chizilmasligi kerak");
  assert.ok(texts.some((t) => t.includes("VATAN")), "to'la bo'lim qolishi kerak");

  assert.deepEqual(
    tocRows(doc).map((r) => r.text),
    ["Vatan tuygusi"],
  );
});

test("mundarija modeli fayl va viewer uchun bir xil qatorlarni beradi", async () => {
  const { tocRows } = await import("../lib/generation/toc-model.ts");

  const doc = {
    meta: { language: "uz" },
    sections: [
      { id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "matn" }] },
      {
        id: "bob1",
        title: "I BOB. NAZARIY ASOSLAR",
        blocks: [
          { kind: "h2", text: "1.1. Tushuncha" },
          { kind: "p", text: "matn" },
          { kind: "h2", text: "1.2. Tasnif" },
        ],
      },
      { id: "xulosa", title: "Xulosa", blocks: [{ kind: "p", text: "matn" }] },
    ],
    references: ["Manba 1"],
  };

  const rows = tocRows(doc as never);
  assert.deepEqual(
    rows.map((r) => `${r.level}:${r.text}`),
    [
      "1:Kirish",
      "1:I BOB. NAZARIY ASOSLAR",
      "2:1.1. Tushuncha",
      "2:1.2. Tasnif",
      "1:Xulosa",
      "1:FOYDALANILGAN ADABIYOTLAR",
    ],
  );
  // Model o'zi raqam QO'SHMAYDI — aks holda «1. I BOB.» chiqadi.
  assert.ok(!rows.some((r) => /^\d+\.\s+(I |Kirish|Xulosa)/.test(r.text)));
});

/**
 * Tarjimada tuzilma saqlanishi.
 *
 * Nuqson: tizim prompti «sarlavha, ro'yxat va paragraf chegaralarini
 * saqlang» deb turardi, JSON sxemasi esa faqat `paragraphs: string[]`
 * berardi — ya'ni model tuzilmani IFODALAY olmasdi va chiqishda hamma
 * narsa `kind: "p"` ga tekislanardi. Sinov yangi sxemani va eski
 * javoblarga chidamlilikni ushlaydi.
 */
test("tarjima bo'laklari turini saqlaydi va eski javobga ham chidaydi", async () => {
  const { translatedBlocks } = await import("../lib/generation/write-specials.ts");

  const typed = translatedBlocks(
    {
      blocks: [
        { kind: "h2", text: "Asosiy qism" },
        { kind: "li", text: "Birinchi band" },
        { kind: "p", text: "Oddiy matn" },
        { kind: "table", text: "Noma'lum tur" },
        { kind: "p", text: "x" },
      ],
    },
    null,
  );
  assert.deepEqual(
    typed.map((b) => b.kind),
    // Noma'lum tur `p` ga tushadi; 1 belgili matn tashlanadi.
    ["h2", "li", "p", "p"],
  );

  // Eski shakl — model yangi sxemaga bo'ysunmasa.
  const legacy = translatedBlocks({ paragraphs: ["Birinchi", "Ikkinchi"] }, null);
  assert.deepEqual(legacy, [
    { kind: "p", text: "Birinchi" },
    { kind: "p", text: "Ikkinchi" },
  ]);

  assert.deepEqual(translatedBlocks(null, null), []);
});

/**
 * Keys rubrikasi.
 *
 * Yarim rubrika (mezoni bor, balli yo'q) yo'qdan yomonroq: o'qituvchi
 * uni ko'radi-yu, baholay olmaydi. Shuning uchun to'liq bo'lmagan
 * rubrika umuman chiqmaydi.
 */
test("baholash rubrikasi to'liq bo'lmasa chiqmaydi", async () => {
  const { rubricBlocks } = await import("../lib/generation/write-specials.ts");
  const { sectionLabels } = await import("../lib/generation/i18n.ts");
  const L = sectionLabels("uz");

  assert.deepEqual(rubricBlocks(undefined, L), []);
  // Ballsiz mezonlar tashlanadi -> 2 tadan kam qoladi -> bo'lim yo'q.
  assert.deepEqual(rubricBlocks([{ criterion: "Tahlil chuqurligi" }, { criterion: "Xulosa" }], L), []);

  const ok = rubricBlocks(
    [
      { criterion: "NPV ni to'g'ri hisoblash", points: 4 },
      { criterion: "Qoplash muddati", points: 3 },
      { criterion: "Tavsiya asoslanganligi", points: 3 },
    ],
    L,
  );
  assert.equal(ok[0].kind, "h3");
  assert.equal(ok.filter((b) => b.kind === "li").length, 3);
  assert.equal(ok[ok.length - 1].text, "Jami: 10 ball");
});

/**
 * Tarjimaning to'liqligi.
 *
 * Uch nuqson bir zanjirda edi:
 *   1. forma 60 000 belgi qabul qilardi, dvigatel esa 48 000 ini ishlardi;
 *   2. ortiqcha bo'lak `chunkSource` oxirida JIM kesilardi;
 *   3. yiqilgan bo'lak bo'sh ro'yxat qaytarardi va qolgani `COMPLETED`
 *      bo'lardi — foydalanuvchi yarim tarjimani to'liq deb olardi.
 */
test("matn uzunligi pul yechilishidan oldin tekshiriladi", async () => {
  const { preflightError, TRANSLATION_MAX_CHARS, TRANSLATION_MIN_CHARS } = await import(
    "../lib/tools.ts"
  );
  const tool = TOOL_BY_ID["translation"];

  // Ishlaydigan oraliq.
  assert.equal(preflightError(tool, { sourceText: "Salom dunyo, bu sinov matni." } as FormValues), null);
  assert.equal(preflightError(tool, { sourceText: "x".repeat(TRANSLATION_MAX_CHARS) } as FormValues), null);

  const tooLong = preflightError(tool, { sourceText: "x".repeat(TRANSLATION_MAX_CHARS + 1) } as FormValues);
  assert.ok(tooLong && /juda uzun/i.test(tooLong), "uzun matn haqida aniq xabar bo'lishi kerak");

  /*
   * «To'ldirilgan, lekin juda qisqa» — `missingRequired` ushlamaydigan hol
   * (P0-5, AUDIT-5). Bu qoida ilgari FAQAT `TranslationForm` ichida edi,
   * ya'ni to'g'ridan-to'g'ri yuborilgan so'rov uni chetlab o'tardi.
   */
  const tooShort = preflightError(tool, { sourceText: "salom" } as FormValues);
  assert.ok(tooShort && /qisqa/i.test(tooShort), `qisqa matn rad etilishi kerak: ${tooShort}`);
  assert.equal(
    preflightError(tool, { sourceText: "x".repeat(TRANSLATION_MIN_CHARS) } as FormValues),
    null,
    "chegaraning o'zi o'tishi kerak",
  );
  // Bo'sh matn `missingRequired` ning ishi — preflight uni takrorlamaydi.
  assert.equal(preflightError(tool, { sourceText: "" } as FormValues), null);

  // Boshqa vositalarga bu chegara tegishli emas.
  assert.equal(preflightError(TOOL_BY_ID["referat"], { sourceText: "x".repeat(100_000) } as FormValues), null);
});

test("maxsus formali vositalar serverda ham tekshiriladi", async () => {
  const { missingRequired, preflightError, TOOLS } = await import("../lib/tools.ts");

  /*
   * AYNAN P0-5 (AUDIT-5). `image`, `resume` va `translation` o'z
   * formasini chizadi, shuning uchun `fields` bo'sh qolgan edi —
   * `missingRequired` esa aynan `fields` ni aylanadi. Natijada uchala
   * vosita ham serverda TEKSHIRILMASDI: bo'sh so'rov navbatga tushar,
   * PUL YECHILAR, keyin dvigatel xato berib kredit qaytarardi.
   */
  const cases: [string, Record<string, unknown>, string][] = [
    ["image", { prompt: "tog' manzarasi, quyosh botishi" }, "Rasm tavsifi"],
    ["resume", { fullName: "Aliyev Ali", targetRole: "Dasturchi" }, "To'liq ism"],
    ["translation", { sourceText: "Salom dunyo, bu sinov matni." }, "Tarjima qilinadigan matn"],
  ];

  for (const [id, good, legend] of cases) {
    const tool = TOOL_BY_ID[id as keyof typeof TOOL_BY_ID];
    const empty = missingRequired(tool, {} as FormValues);
    assert.ok(empty.length > 0, `${id}: bo'sh so'rov rad etilishi kerak`);
    assert.ok(empty.includes(legend), `${id}: xabarda «${legend}» bo'lishi kerak, chiqdi: ${empty}`);
    assert.deepEqual(missingRequired(tool, good as FormValues), [], `${id}: to'g'ri so'rov o'tishi kerak`);
  }

  // Qisqa (lekin bo'sh emas) rasm tavsifi ham to'siladi.
  const shortPrompt = preflightError(TOOL_BY_ID.image, { prompt: "ab" } as FormValues);
  assert.ok(shortPrompt && /qisqa/i.test(shortPrompt), "qisqa rasm tavsifi rad etilishi kerak");

  /*
   * Deklaratsiya TOOLS ga biriktirilgani uchun har custom vosita kamida
   * bitta majburiy maydonga ega bo'lishi kerak — yangi custom vosita
   * qo'shilganda uni unutib qoldirmaslik uchun.
   */
  for (const tool of TOOLS.filter((t) => t.custom && t.custom !== "slide")) {
    assert.ok(
      tool.fields.some((f) => f.required),
      `${tool.id}: maxsus formali vositada majburiy maydon e'lon qilinishi kerak`,
    );
  }
});

test("chunkSource matnni jim kesmaydi", async () => {
  const { chunkSource, MAX_CHUNKS } = await import("../lib/generation/write-specials.ts");

  // Har abzas o'z bo'lagini egallaydigan eng yomon taqsimot.
  const para = "A".repeat(2_500);
  const chunks = chunkSource(Array.from({ length: 20 }, () => para).join("\n\n"), 4_000);

  assert.equal(chunks.length, 20, "hamma abzas bo'lakka tushishi kerak");
  assert.ok(chunks.length > MAX_CHUNKS, "bu holat chegaradan oshadi va xato berishi kerak");

  // Hech bir belgi yo'qolmagan.
  assert.equal(chunks.join("").replace(/\s/g, "").length, 20 * 2_500);
});

// -------------------------------------------------- hujjat profillari (Sprint 9)

/**
 * DOCX ichidagi xom `word/document.xml`.
 *
 * `docxText` faqat ko'rinadigan matnni beradi; profil esa MAKETNI
 * o'zgartiradi (shrift, tekislash, sahifa yo'nalishi), shuning uchun
 * bu tekshiruvlar XML ustida ishlaydi.
 */
async function docxXml(d: AcademicDoc): Promise<string> {
  const bytes = await renderDocx(d);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("word/document.xml")!.async("string");
}

function anyDoc(toolId: ToolId, values: FormValues, extra: Partial<AcademicDoc> = {}): AcademicDoc {
  return {
    meta: extractMeta(TOOL_BY_ID[toolId], values),
    titlePage: true,
    toc: false,
    sections: [{ id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "Matn." }] }],
    ...extra,
  };
}

test("gost profili akademik tipografiyani saqlaydi", async () => {
  const { profileById } = await import("../lib/generation/docx-profile.ts");
  const gost = profileById("gost");

  // Bu qiymatlar OTME/GOST talabidan kelib chiqadi va o'zgarmasligi kerak.
  assert.equal(gost.type.font, "Times New Roman");
  assert.equal(gost.type.size, 28, "14pt");
  assert.equal(gost.type.line, 360, "1.5 interval");
  assert.equal(gost.type.justify, true);
  assert.equal(gost.page.margin.left, 3 * 567, "chap chekinish 3 sm");
  assert.equal(gost.page.landscape, false);

  const xml = await docxXml(anyDoc("referat", { topic: "Mavzu", author: "A. Valiyev" }));
  assert.match(xml, /w:ascii="Times New Roman"/);
  assert.match(xml, /<w:jc w:val="both"\/>/, "asosiy matn justify bo'lishi kerak");
});

test("rezyume profili akademik qolipni tashlaydi", async () => {
  const doc = anyDoc(
    "resume",
    { topic: "Dasturchi", fullName: "A. Valiyev" },
    {
      titlePage: false,
      sections: [
        { id: "summary", title: "Qisqacha", blocks: [{ kind: "p", text: "Tajribali dasturchi." }, { kind: "p", text: "Toshkent · a@b.uz" }] },
        { id: "exp", title: "Tajriba", blocks: [{ kind: "h3", text: "2020–2024 — Dev" }, { kind: "li", text: "Natija." }] },
        { id: "skills", title: "Ko‘nikma", blocks: [{ kind: "p", text: "Node.js · SQL" }] },
      ],
    },
  );
  const xml = await docxXml(doc);

  assert.match(xml, /w:ascii="Calibri"/, "sans shrift");
  assert.doesNotMatch(xml, /w:ascii="Times New Roman"/, "akademik shrift qolmasligi kerak");
  assert.doesNotMatch(xml, /<w:jc w:val="both"\/>/, "CV da justify bo'lmaydi");
  assert.doesNotMatch(xml, /<w:jc w:val="center"\/>/, "CV da markazlashtirilgan sarlavha bo'lmaydi");
  assert.match(xml, /w:fill="1C1917"/, "to'q yon panel");
  assert.match(xml, /w:color="F97316"/, "sarlavha ostidagi chiziq");

  // Yon panel ko'ruvchidagi tuzilmani takrorlaydi.
  const text = await docxText(doc);
  assert.match(text, /REZYUME/);
  assert.match(text, /Node\.js · SQL/, "ko'nikmalar yon panelda");
  assert.match(text, /2020–2024 — Dev/, "ish joyi sarlavhasi saqlanadi");
});

test("keng jadvalli hujjat albom, nasrli hujjat portret bo'ladi", async () => {
  /*
   * Texnologik xarita — 6 ustunli jadval, portretda «Mavzu» ustuni
   * sig'maydi. Albom shu uchun tanlangan.
   */
  const map = await docxXml(anyDoc("texnologik-xarita", { topic: "Fan", subject: "Fan", author: "A. Valiyev" }));
  assert.match(map, /w:orient="landscape"/, "texnologik xarita albom bo'lishi kerak");
  // `docx` albomda o'lchamlarni almashtiradi: keng tomon oldinda.
  assert.match(map, /w:w="16838" w:h="11906"/, "A4 albom o'lchami");

  /*
   * Dars rejasi ILGARI xarita bilan bitta profilda edi (AUDIT-5 P0-3).
   * Lekin albomning asoslanishi FAQAT xaritaga tegishli: dars jadvali
   * 4 ustunli va hujjatning kichik qismi — asosiysi bosqichlar nasri
   * (6 bosqich × 700 belgigacha). Albomda o'sha nasr ~26 sm satrda
   * chiqar, ya'ni o'qib bo'lmasdi. Ustiga `LessonViewer` portret A4
   * chizardi — foydalanuvchi ko'rgan hujjat boshqa yo'nalishda edi.
   */
  const lesson = await docxXml(anyDoc("lesson-plan", { topic: "Kasrlar", subject: "Matematika", author: "A. Valiyev" }));
  assert.match(lesson, /w:orient="portrait"/, "dars rejasi ko'ruvchi kabi portret bo'lishi kerak");
  assert.match(lesson, /w:w="11906" w:h="16838"/, "A4 portret o'lchami");

  // Akademik ishlar portret bo'lib qoladi.
  const gost = await docxXml(anyDoc("coursework", { topic: "Mavzu", author: "A. Valiyev" }));
  assert.match(gost, /w:orient="portrait"/);
});

test("titul sahifasi ko'ruvchi va DOCX da bir xil modeldan chiziladi", async () => {
  const { titleModel } = await import("../lib/generation/title-model.ts");

  /*
   * AYNAN P0-2 (AUDIT-5). `render-docx` `profileFor().titlePage` ga
   * qarab IKKI xil titul chizardi, sayt ko'ruvchisi esa UCHINCHI,
   * har doim GOST qolipini. Natijada jurnal maqolasi saytda TALABA ISHI
   * bo'lib ko'rinardi: vazirlik sarlavhasi, «Bajardi», «Ilmiy rahbar»,
   * o'quv yili — jurnalga hech qanday aloqasi yo'q qatorlar.
   */
  const fields = {
    topic: "Quyosh energiyasi",
    author: "Aliyev Ali",
    degree: "PhD",
    organization: "Toshkent davlat universiteti",
    email: "ali@example.uz",
    university: "Toshkent davlat universiteti",
    teacher: "Karimov B.",
  };

  // ── Maqola: model «article», DOCX da vazirlik YO'Q, muallif bloki BOR
  const articleDoc = anyDoc("article", fields);
  const articleTitle = titleModel(articleDoc);
  assert.equal(articleTitle.kind, "article", "maqola uchun jurnal tituli bo'lishi kerak");

  const articleXml = await docxText(articleDoc);
  assert.ok(!/VAZIRLIGI/i.test(articleXml), "maqola titulida vazirlik sarlavhasi bo'lmasligi kerak");
  assert.ok(!/Ilmiy rahbar/i.test(articleXml), "maqolada «Ilmiy rahbar» qatori bo'lmasligi kerak");
  assert.match(articleXml, /Aliyev Ali, PhD/, "muallif va daraja bitta qatorda");
  assert.match(articleXml, /ali@example\.uz/, "email titulga tushishi kerak");

  // ── Kurs ishi: model «gost», DOCX da vazirlik BOR
  const courseDoc = anyDoc("coursework", fields);
  const courseTitle = titleModel(courseDoc);
  assert.equal(courseTitle.kind, "gost", "talaba ishi uchun GOST tituli");

  const courseXml = await docxText(courseDoc);
  assert.match(courseXml, /VAZIRLIGI/i, "talaba ishida vazirlik sarlavhasi bo'lishi kerak");
  assert.match(courseXml, /Ilmiy rahbar/i, "talaba ishida rahbar qatori bo'lishi kerak");

  /*
   * Model ikkala tomonni ham boshqaradi: `titleModel` da yangi tur
   * qo'shilsa, `WordViewer` dagi `TitlePage` ni ham TypeScript
   * majburlaydi — jim ajralib ketish mumkin emas.
   */
  assert.equal(titleModel(anyDoc("thesis", fields)).kind, "gost");
  assert.equal(titleModel(anyDoc("essay", fields)).kind, "gost");
});

test("langarli jadval o'z bo'limidan keyin turadi", async () => {
  const table = { caption: "Jadval", anchor: "map", headers: ["A"], rows: [["QATOR"]] };
  const doc = anyDoc("lesson-plan", { topic: "Kasrlar", subject: "Matematika", author: "A. Valiyev" }, {
    sections: [
      { id: "passport", title: "Pasport", blocks: [{ kind: "p", text: "PASPORT-MATNI" }] },
      { id: "map", title: "Xarita", blocks: [{ kind: "p", text: "XARITA-MATNI" }] },
      { id: "oxiri", title: "Oxirgi", blocks: [{ kind: "p", text: "OXIRGI-MATNI" }] },
    ],
    tables: [table],
  });
  const text = await docxText(doc);
  const iMap = text.indexOf("XARITA-MATNI");
  const iRow = text.indexOf("QATOR");
  const iLast = text.indexOf("OXIRGI-MATNI");
  assert.ok(iMap > 0 && iRow > 0 && iLast > 0, "uchala qism ham chiqishi kerak");
  assert.ok(iRow > iMap, "jadval o'z bo'limidan keyin");
  assert.ok(iRow < iLast, "jadval keyingi bo'limdan oldin");
});

test("langarsiz jadval eski joyida — oxirida qoladi", async () => {
  const doc = anyDoc("coursework", { topic: "Mavzu", author: "A. Valiyev" }, {
    sections: [
      { id: "a", title: "A", blocks: [{ kind: "p", text: "BIRINCHI" }] },
      { id: "b", title: "B", blocks: [{ kind: "p", text: "OXIRGI-BOLIM" }] },
    ],
    tables: [{ caption: "J", headers: ["H"], rows: [["QATOR"]] }],
  });
  const text = await docxText(doc);
  assert.ok(text.indexOf("QATOR") > text.indexOf("OXIRGI-BOLIM"), "langarsiz jadval oxirida");
});

test("mavjud bo'lmagan langar jadvalni yo'qotmaydi", async () => {
  const doc = anyDoc("lesson-plan", { topic: "T", subject: "F", author: "A." }, {
    sections: [{ id: "bor", title: "Bor", blocks: [{ kind: "p", text: "MATN" }] }],
    tables: [{ caption: "J", anchor: "yoq", headers: ["H"], rows: [["QATOR"]] }],
  });
  assert.match(await docxText(doc), /QATOR/, "langar topilmasa ham jadval chizilishi kerak");
});

test("jadval ustunlari haqiqiy kenglikka ega", async () => {
  const doc = anyDoc("texnologik-xarita", { topic: "Fan", subject: "Fan", author: "A." }, {
    tables: [{
      caption: "Reja",
      headers: ["№", "Soat", "Mavzu", "Metod", "Natija", "Nazorat"],
      rows: [["1", "2", "Uzun mavzu nomi", "Ma’ruza", "Natija", "Test"]],
    }],
  });
  const xml = await docxXml(doc);
  const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
  assert.equal(grid.length, 6);
  /*
   * Ilgari bu yerda oltita `w:w="100"` (0.18 sm) turardi — ma'nosiz grid,
   * shuning uchun Word avtomatik maketga o'tib ustunlarni deyarli teng
   * chizardi va «Mavzu» matni to'rt qatorga sinardi.
   */
  assert.ok(grid.every((w) => w > 400), `ustunlar haqiqiy kenglikda bo'lishi kerak: ${grid}`);
  assert.ok(grid[2] > grid[0] * 4, "«Mavzu» ustuni «№» dan sezilarli keng");
  assert.match(xml, /<w:tblLayout w:type="fixed"\/>/);
});

test("glossariy atamalarni ikki marta chizmaydi", async () => {
  const { writeGlossaryWithLlm } = await import("../lib/generation/write-specials.ts");
  // Kalitsiz muhitda yozuvchi `null` qaytaradi — bu yerda tuzilmani
  // qo'lda quramiz va rendererning takror chizmasligini tekshiramiz.
  assert.equal(typeof writeGlossaryWithLlm, "function");

  const doc = anyDoc("glossary", { topic: "Fizika", author: "A.", termCount: 2 }, {
    sections: [
      { id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "Kirish matni." }] },
      { id: "atamalar", title: "Atamalar", blocks: [
        { kind: "h3", text: "Entropiya" },
        { kind: "p", text: "Tartibsizlik o‘lchovi." },
      ] },
    ],
  });
  const text = await docxText(doc);
  assert.equal(text.split("Entropiya").length - 1, 1, "atama bir marta chiqishi kerak");
});

/**
 * Profil MAKETI — nafaqat shrift (Sprint 9 keyingi mutatsiya supurgisi).
 *
 * Dastlabki testlar shriftni va tekislashni tekshirardi, lekin sahifa
 * chekinishi, sarlavha rangi va yon panel balandligini emas: ularni
 * o'chirib qo'yish birorta testni yiqitmasdi.
 */
test("albom profili chekinishlarni ham toraytiradi", async () => {
  const xml = await docxXml(anyDoc("texnologik-xarita", { topic: "Fan", subject: "Fan", author: "A." }));
  const m = /<w:pgMar w:top="(\d+)" w:right="(\d+)" w:bottom="(\d+)" w:left="(\d+)"/.exec(xml);
  assert.ok(m, "sahifa chekinishlari topilishi kerak");
  const [top, right, bottom, left] = m!.slice(1).map(Number);

  // GOST: chap 3 sm (1701). Albomda jadvalga joy kerak — 2 sm (1134).
  assert.equal(left, Math.round(2 * 567), `chap chekinish: ${left}`);
  assert.equal(top, Math.round(1.5 * 567));
  assert.equal(bottom, Math.round(1.5 * 567));
  assert.ok(left < 1701, "gost chekinishidan tor bo'lishi kerak");

  // Foydali kenglik portret gost dagidan sezilarli katta.
  const usable = 16838 - left - right;
  assert.ok(usable > 14_000, `albom foydali kengligi: ${usable}`);
});

test("rezyume sarlavhasi qora, yon panel sahifani to'ldiradi", async () => {
  const doc = anyDoc(
    "resume",
    { topic: "Dasturchi", fullName: "A. Valiyev" },
    {
      titlePage: false,
      sections: [
        { id: "summary", title: "Qisqacha", blocks: [{ kind: "p", text: "Matn." }, { kind: "p", text: "Toshkent" }] },
        { id: "exp", title: "Tajriba", blocks: [{ kind: "li", text: "Natija." }] },
      ],
    },
  );
  const xml = await docxXml(doc);

  /*
   * Sarlavha rangi profildan keladi. Berilmasa Word ning «Heading 1»
   * uslubi qoladi va u LibreOffice da to'q sariq chiqadi — ko'ruvchida
   * esa sarlavha qora, faqat ostidagi chiziq rangli.
   */
  assert.match(xml, /<w:color w:val="1C1917"\/>/, "sarlavha matni qora bo'lishi kerak");

  /*
   * Yon panel sahifa balandligini to'ldiradi. Jadval katagi odatda faqat
   * mazmuni qadar cho'ziladi va to'q panel varaqning yarmida uzilib
   * qolardi.
   */
  const h = /<w:trHeight w:val="(\d+)"/.exec(xml);
  assert.ok(h, "qator balandligi berilishi kerak");
  assert.ok(Number(h![1]) > 12_000, `yon panel balandligi: ${h![1]}`);
});

/**
 * Jadval langarini YOZUVCHI qo'yadi (mutatsiya supurgisi topgan teshik).
 *
 * `render-docx` langarni to'g'ri chizishi sinalgan edi, lekin
 * `writeLessonWithLlm`/`writeMapWithLlm` uni umuman QO'YISHI sinalmagan:
 * `anchor` satrini o'chirib tashlaganda birorta test yiqilmasdi va
 * jadval jimgina hujjat oxiriga qaytardi.
 */
test("dars rejasi jadvali «Dars xaritasi» bo'limiga langarlanadi", async () => {
  const { lessonDoc } = await import("../lib/generation/write-specials.ts");
  const meta = extractMeta(TOOL_BY_ID["lesson-plan"], {
    topic: "Oddiy kasrlar",
    subject: "Matematika",
    duration: 45,
  } as FormValues);

  const doc = lessonDoc(meta, {
    goal: "Kasrlarni qo‘shishni o‘rgatish",
    tools: "Doska, tarqatma",
    homework: "42-bet, 7–9 misollar",
    stages: [
      { title: "Tashkiliy", minutes: 10, activity: "Oddiy kasrlar bo‘yicha 1/2 + 1/4 takrorlanadi", result: "Tayyor" },
      { title: "Yangi mavzu", minutes: 20, activity: "Oddiy kasrlar qo‘shiladi: 1/2 + 1/3 = 5/6", result: "Biladi" },
      { title: "Yakun", minutes: 30, activity: "Oddiy kasrlar bo‘yicha mustaqil ish", result: "Yechadi" },
    ],
  });

  assert.ok(doc, "hujjat yig'ilishi kerak");
  assert.equal(doc!.tables?.[0]?.anchor, "map", "jadval «map» bo'limiga langarlanadi");
  assert.ok(doc!.sections.some((s) => s.id === "map"), "langar mavjud bo'limga ishora qilsin");

  // Daqiqalar dars davomiyligiga tenglashadi (invariant shu yerda ham).
  const rows = doc!.tables![0].rows;
  assert.equal(rows.reduce((a, r) => a + Number(r[1]), 0), 45);

  // Jadval haqiqatan o'z bo'limidan keyin chiziladi.
  const text = await docxText(doc!);
  assert.ok(text.indexOf("Yangi mavzu") < text.lastIndexOf("Yangi mavzu"), "bo'lim ham, jadval ham chiqadi");
});

test("texnologik xarita jadvali pasportga langarlanadi", async () => {
  const { mapDoc } = await import("../lib/generation/write-specials.ts");
  const meta = extractMeta(TOOL_BY_ID["texnologik-xarita"], {
    topic: "Algebra",
    subject: "Algebra",
    weeklyHours: 2,
    totalHours: 20,
  } as FormValues);

  const doc = mapDoc(meta, {
    intro: "Xarita fan dasturiga muvofiq tuzilgan.",
    weeks: Array.from({ length: 10 }, (_, i) => ({
      topic: `${i + 1}-darsning aniq mavzusi: tenglamalar ${i + 1}`,
      method: "Amaliy",
      result: `Natija ${i + 1}`,
      control: "Yozma",
    })),
  });

  assert.ok(doc, "hujjat yig'ilishi kerak");
  assert.equal(doc!.tables?.[0]?.anchor, "passport");
  assert.ok(doc!.sections.some((s) => s.id === "passport"));

  // Soat ustuni yig'indisi pasportdagi jami soatga QAT'IY teng.
  const rows = doc!.tables![0].rows;
  assert.equal(rows.reduce((a, r) => a + Number(r[1]), 0), 20);
});

test("xarita 70% dan kam noyob mavzuda hujjat bermaydi", async () => {
  const { mapDoc } = await import("../lib/generation/write-specials.ts");
  const meta = extractMeta(TOOL_BY_ID["texnologik-xarita"], {
    topic: "Algebra",
    subject: "Algebra",
    weeklyHours: 2,
    totalHours: 20,
  } as FormValues);

  // Hammasi bir xil mavzu — takror tashlangach 1 tasi qoladi.
  const doc = mapDoc(meta, {
    weeks: Array.from({ length: 10 }, () => ({ topic: "Bir xil mavzu", method: "Amaliy", result: "R", control: "Test" })),
  });
  assert.equal(doc, null, "takroriy xarita yaroqsiz — tsikl bilan to'ldirilmaydi");
});

test("shablon glossariysida atama nomi takrorlanmaydi", async () => {
  const { buildAcademicDoc } = await import("../lib/generation/content.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  /*
   * AYNAN N-9 (Sprint 14). `terms` massivida atama nomi ALLAQACHON
   * mavzuni tutardi («Fotosintez: tasnif»), sarlavha esa yana
   * prefikslanar va «Fotosintez: Fotosintez: tasnif» chiqardi.
   *
   * Bu faqat LLM kalitisiz yo'lda ko'rinadi — lekin aynan o'sha yo'l
   * demolarda va kalitsiz muhitda ishlatiladi.
   */
  const meta = extractMeta(TOOL_BY_ID.glossary, { topic: "Fotosintez" } as never);
  const doc = buildAcademicDoc(meta, {});

  const headings = doc.sections
    .flatMap((s) => s.blocks)
    .filter((b) => b.kind === "h3")
    .map((b) => b.text);

  assert.ok(headings.length > 0, "atama sarlavhalari bo'lishi kerak");
  for (const h of headings) {
    const hits = h.split("Fotosintez").length - 1;
    assert.ok(hits <= 1, `mavzu sarlavhada bir martadan ko'p takrorlanmasligi kerak: «${h}»`);
  }

  // Sarlavhalar noyob bo'lishi kerak — ko'ruvchi ularni kalit sifatida ishlatadi.
  assert.equal(new Set(headings).size, headings.length, "atama sarlavhalari noyob bo'lishi kerak");
});

test("IMRAD annotatsiyasiz maqola qat'iy darvozadan o'tmaydi", async () => {
  const { writeImradWithLlm } = await import("../lib/generation/write-specials.ts");
  const { hardMissing } = await import("../lib/generation/structure.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  /*
   * AYNAN P0-4 (AUDIT-5). `structure.ts` da annotatsiya QAT'IY darvoza
   * deb e'lon qilingan (`HARD = {"abstract"}`), lekin IMRAD yo'li bo'sh
   * annotatsiya o'rniga bir jumlalik stub qo'yardi:
   *
   *   «Maqolada «X» IMRAD tuzilmasi asosida yoritiladi»
   *
   * Natijada darvoza IMRAD da HECH QACHON ishga tushmasdi — qat'iy deb
   * yozilgan tekshiruv amalda bezak edi. Jurnalga yuborib bo'lmaydigan
   * «maqola» to'liq narxda COMPLETED bo'lardi.
   *
   * Sinov jonli LLM siz: `fetch` stub qilinadi. Annotatsiya so'roviga
   * BO'SH javob, bo'lim so'rovlariga matn qaytariladi — ya'ni maqola
   * yozildi, faqat annotatsiya chiqmadi.
   */
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;

  const para = (n: number) =>
    Array.from({ length: n }, (_, i) => `Bu ${i + 1}-paragraf. `.repeat(14)).join("\n\n");
  let abstractCalls = 0;

  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    const body = String(init?.body ?? "");
    const isAbstract = body.includes("Annotatsiya.");
    if (isAbstract) abstractCalls += 1;
    // Annotatsiya — bo'sh JSON; bo'limlar — to'la matn.
    const text = isAbstract ? "{}" : para(4);
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
    } as never;
  }) as typeof fetch;

  try {
    const meta = extractMeta(TOOL_BY_ID.article, {
      topic: "Quyosh energiyasi",
      kind: "imrad",
      pages: "3-5",
    } as never);

    const doc = await writeImradWithLlm(meta, Date.now() + 120_000);

    assert.ok(doc, "bo'limlar yozilgani uchun hujjat qurilishi kerak");
    assert.ok(doc.sections.length >= 4, "IMRAD to'rt bo'limi bo'lishi kerak");

    // 1) Stub QO'YILMAYDI.
    assert.ok(
      !doc.abstracts?.length,
      `annotatsiya bo'sh qolishi kerak, chiqdi: ${JSON.stringify(doc.abstracts)}`,
    );

    // 2) Qat'iy darvoza ENDI ishga tushadi — `buildArtifact` shuni tashlaydi.
    assert.deepEqual(
      hardMissing(meta, doc),
      ["abstract"],
      "annotatsiyasiz IMRAD maqolasi qat'iy darvozadan yiqilishi kerak",
    );

    // 3) Bitta o'tkinchi yiqilish butun maqolani yo'q qilmasligi uchun
    //    qayta urinish bor.
    assert.equal(abstractCalls, 2, "annotatsiyaga ikkinchi urinish berilishi kerak");
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
});

test("va'da qilingan miqdor kam chiqsa farq qaytariladi", async () => {
  const { deliveredCount } = await import("../lib/generation/delivered.ts");
  const { shortfallRatio } = await import("../lib/server/worker.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { mapWeeks } = await import("../lib/generation/write-specials.ts");

  /*
   * AYNAN P1-1 va P1-2 (AUDIT-5). Uchta vositada narx bevosita SONGA
   * bog'langan va o'sha son foydalanuvchiga ochiq ko'rsatiladi:
   *
   *   slayd     — «Premium uzun · 16 slayd · 8 000»
   *   glossariy — «40 ta atama», narx 6 000 / 9 000 / 15 000
   *   xarita    — haftalar foydalanuvchi kiritgan soatlardan
   *
   * Ularning sifat darvozasi FLOOR edi (0.85 va 0.70) va u «umuman
   * yaroqlimi» degan savolga javob beradi — «va'da bajarildimi» ga emas.
   * 16 slayd o'rniga 14, 40 atama o'rniga 28 chiqsa ish COMPLETED bo'lar
   * va TO'LIQ pul olinardi.
   */

  // ── Slayd: 16 va'da, 14 yetkazildi
  const slideMeta = extractMeta(TOOL_BY_ID.slide, { topic: "X", quality: "premium_long" } as FormValues);
  assert.equal(slideMeta.targetPages, 16, "premium_long 16 slayd va'da qiladi");
  const deck = (n: number) =>
    ({ meta: slideMeta, titlePage: true, toc: false, sections: [], slides: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, layout: "bullets", title: `S${i}` })) }) as never;

  assert.equal(deliveredCount(slideMeta, deck(16)), undefined, "to'liq deka qaytarishsiz");
  assert.deepEqual(deliveredCount(slideMeta, deck(14)), { got: 14, want: 16 });
  assert.equal(shortfallRatio(deliveredCount(slideMeta, deck(14))), 0.125, "8 000 dan 12.5% qaytadi");
  // Nisbat suzuvchi son — `splitRatio` uni baribir yaxlitlaydi, shuning
  // uchun tekshiruv aniq tenglik emas, yaqinlik bilan.
  const near = (a: number | null, b: number, msg: string) =>
    assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${msg}: ${a}`);

  // Ortiq yetkazish qaytarish sababi emas.
  assert.equal(deliveredCount(slideMeta, deck(18)), undefined);

  // ── Glossariy: 40 va'da, atamalar `h3` sarlavhalar
  const gloMeta = extractMeta(TOOL_BY_ID.glossary, { topic: "X", termCount: "40" } as FormValues);
  const gloDoc = (n: number) =>
    ({
      meta: gloMeta,
      titlePage: true,
      toc: false,
      sections: [
        { id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "Matn" }] },
        {
          id: "atamalar",
          title: "Atamalar",
          blocks: Array.from({ length: n }, (_, i) => ({ kind: "h3", text: `Atama ${i}` })),
        },
      ],
    }) as never;

  assert.equal(deliveredCount(gloMeta, gloDoc(40)), undefined);
  // 70% darvozasi 28 tani o'tkazadi — ilgari 15 000 to'liq olinardi.
  assert.deepEqual(deliveredCount(gloMeta, gloDoc(28)), { got: 28, want: 40 });
  near(shortfallRatio(deliveredCount(gloMeta, gloDoc(28))), 0.3, "15 000 dan 30% qaytadi");

  // ── Xarita: haftalar soatlardan
  const mapMeta = extractMeta(TOOL_BY_ID["texnologik-xarita"], {
    subject: "Biologiya",
    weeklyHours: 4,
    totalHours: 136,
  } as FormValues);
  const weeks = mapWeeks(mapMeta);
  assert.equal(weeks, 34, "136 / 4 = 34 hafta");
  const mapDocOf = (n: number) =>
    ({
      meta: mapMeta,
      titlePage: true,
      toc: false,
      sections: [],
      tables: [{ headers: ["A"], rows: Array.from({ length: n }, (_, i) => [`R${i}`]) }],
    }) as never;

  assert.equal(deliveredCount(mapMeta, mapDocOf(34)), undefined);
  assert.deepEqual(deliveredCount(mapMeta, mapDocOf(24)), { got: 24, want: 34 });

  // ── Qolgan vositalarda miqdor va'da qilinmaydi.
  const cw = extractMeta(TOOL_BY_ID.coursework, { topic: "X" } as FormValues);
  assert.equal(deliveredCount(cw, { meta: cw, titlePage: true, toc: true, sections: [] } as never), undefined);
});

test("buildArtifact yetkazilgan miqdorni faylga biriktiradi", async () => {
  const { buildArtifact } = await import("../lib/generation/index.ts");
  const { shortfallRatio } = await import("../lib/server/worker.ts");

  /*
   * Yuqoridagi test QARORNI sinaydi, bu esa SIMLASHNI: `buildArtifact`
   * hisobni haqiqatan `BuiltFile.delivered` ga qo'yadimi. Aynan shunday
   * bir qatorli simlash AUDIT-3 §18 da mutatsiyadan omon qolgan edi —
   * mantiq sinalgan, ulanish esa yo'q.
   *
   * Jonli LLM kerak emas: kalitsiz muhitda `buildArtifact` shablon
   * yo'liga tushadi (`content.ts`), u glossariy uchun qat'iy 12 atama
   * beradi. Foydalanuvchi 40 ta so'ragan bo'lsa, farq qaytishi kerak.
   */
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;

  try {
    const file = await buildArtifact(
      TOOL_BY_ID.glossary,
      { topic: "Fotosintez atamalari", termCount: "40", language: "uz" } as FormValues,
      { deadline: Date.now() + 30_000 },
    );

    assert.ok(file.bytes.byteLength > 0, "DOCX chiqishi kerak");
    assert.ok(file.delivered, "kam yetkazilgani `delivered` da qayd etilishi kerak");
    assert.equal(file.delivered.want, 40, "va'da 40 atama");
    assert.ok(file.delivered.got < 40, `shablon 40 ta bera olmaydi: ${file.delivered.got}`);
    assert.ok(file.delivered.got > 0, "atamalar sanalishi kerak");

    // Worker shu qiymatdan pul qaroriga o'tadi.
    const ratio = shortfallRatio(file.delivered);
    assert.ok(ratio !== null && ratio > 0 && ratio < 1, `qaytarish ulushi: ${ratio}`);

    /*
     * Miqdor va'da qilinmagan vositada maydon bo'sh qoladi — aks holda
     * har hujjatda pul qaytarilardi.
     */
    const essay = await buildArtifact(
      TOOL_BY_ID.essay,
      { topic: "Ona tilim", pages: "1", author: "A. Valiyev" } as FormValues,
      { deadline: Date.now() + 30_000 },
    );
    assert.equal(essay.delivered, undefined, "inshoda miqdor va'dasi yo'q");
  } finally {
    if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
});

test("akademik sarlavha rangi qat'iy qora", async () => {
  /*
   * Rang berilmasa Word ning «Heading 1» uslubi qoladi: Word uni ko'k,
   * LibreOffice esa ko'k/to'q sariq chizadi. Ya'ni PDF ga o'girilgan yoki
   * LibreOffice da ochilgan HAR BIR topshiriladigan ish rangli
   * sarlavhalar bilan chiqardi — OTME va GOST 7.32 talablarida ilmiy
   * ishda bu havaskorlik belgisi.
   *
   * Nuqson AUDIT-3 §17.4 da ochiq qoldirilgan, AUDIT-4 §7 va AUDIT-5 §5
   * da takrorlangan edi. Sprint 15 dagi jonli tekshiruvda renderlangan
   * PDF ko'z bilan ko'rilgach tuzatildi.
   */
  const { profileById } = await import("../lib/generation/docx-profile.ts");

  // Har bir profil sarlavha rangini ANIQ belgilashi kerak — Word uslubiga
  // tayanish emas.
  for (const id of ["gost", "article", "essay", "landscape", "lesson", "reference", "resume"] as const) {
    const p = profileById(id);
    assert.ok(p.heading.color, `${id}: sarlavha rangi belgilanishi kerak`);
  }

  // Akademik janrlarda u AYNAN qora.
  for (const id of ["gost", "article", "essay", "landscape", "lesson"] as const) {
    assert.equal(profileById(id).heading.color, "000000", `${id}: qora bo'lishi kerak`);
  }

  // Chiqishda ham ko'rinadi.
  const xml = await docxXml(anyDoc("coursework", { topic: "Mavzu", author: "A. Valiyev" }));
  assert.match(xml, /<w:color w:val="000000"\/>/, "DOCX da qora rang yozilishi kerak");
});
