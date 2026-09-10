import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { extractMeta, minPages, parseAuthorLine } from "../lib/generation/meta.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
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
  assert.equal(TRANSLATION_MAX_CHARS, 200_000, "Tarjimon 2 chegarasi");
  assert.ok(
    tooLong?.includes(`Chegara ${TRANSLATION_MAX_CHARS.toLocaleString("uz-UZ")}`) && /bo'lib yuboring/.test(tooLong),
    `xabar chegarani va nima qilishni aytishi kerak: ${tooLong}`,
  );

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
  assert.equal(preflightError(TOOL_BY_ID["referat"], { sourceText: "x".repeat(300_000) } as FormValues), null);
});

test("tarjima: fayl rejimi — hajm, uslub va tillar ham serverda tekshiriladi", async () => {
  const { missingRequired, preflightError } = await import("../lib/tools.ts");
  const tool = TOOL_BY_ID["translation"];
  const asset = "a".repeat(24);

  /*
   * Fayl rejimida `sourceText` ATAYLAB bo'sh: matn bazada
   * (`source_uploads`), so'rov tanasida takrorlanmaydi. `CUSTOM_REQUIRED`
   * esa `sourceText` ni majburiy deb e'lon qiladi — MATN rejimi uchun
   * to'g'ri qoida. Shuning uchun fayl rejimi ISTISNO bo'lishi kerak,
   * aks holda haqiqiy yuklangan hujjat «To'ldirilmagan maydon» bilan
   * rad etilardi.
   */
  assert.deepEqual(missingRequired(tool, { sourceAssetId: asset } as FormValues), []);
  assert.ok(
    missingRequired(tool, { sourceAssetId: "" } as FormValues).length > 0,
    "assetsiz bo'sh so'rov hamon rad etilishi kerak",
  );

  // Fayl hajmi ham chegaraga bo'ysunadi (`sourceChars` serverdan keladi).
  const big = preflightError(tool, { sourceAssetId: asset, sourceChars: 250_000 } as FormValues);
  assert.ok(big?.includes(`Chegara ${(200_000).toLocaleString("uz-UZ")}`), `chegara xabari kutilgan edi: ${big}`);
  assert.equal(preflightError(tool, { sourceAssetId: asset, sourceChars: 200_000 } as FormValues), null);

  // Uslub va tillar RO'YXATDAN — to'g'ridan-to'g'ri yuborilgan so'rov ham.
  const good = { sourceAssetId: asset, sourceChars: 1_000 } as FormValues;
  assert.equal(preflightError(tool, { ...good, style: "formal" } as FormValues), null);
  assert.equal(preflightError(tool, { ...good, style: "kulgili" } as FormValues), "Noma'lum uslub");
  assert.equal(preflightError(tool, { ...good, language: "de" } as FormValues), null);
  assert.equal(preflightError(tool, { ...good, language: "klingon" } as FormValues), "Noma'lum til");
  assert.equal(preflightError(tool, { ...good, sourceLang: "avto" } as FormValues), null, "«avto» faqat manba uchun");
  assert.equal(preflightError(tool, { ...good, language: "avto" } as FormValues), "Noma'lum til");
  assert.equal(
    preflightError(tool, { ...good, sourceLang: "uz", language: "uz" } as FormValues),
    "Manba va maqsad tili bir xil",
  );
  assert.equal(preflightError(tool, { ...good, sourceLang: "ru", language: "uz" } as FormValues), null);
});

test("tarjima byudjeti hajmdan hisoblanadi va cap bilan cheklanadi", async () => {
  const { budgetFor, MIN_BUDGET_MS } = await import("../lib/generation/budget.ts");
  const tool = TOOL_BY_ID["translation"];
  const CAP = 660_000;
  const asset = "a".repeat(24);

  /*
   * Ilgari tarjima `FIXED` da qat'iy 240 000 ms edi, chegara esa 48 000
   * belgi. Chegara 200 000 ga ko'tarilgach 240 s ish yarmida uzilardi —
   * ya'ni ENG KATTA hujjat ENG ko'p yiqilardi. Formula:
   * 60 000 + ceil(chars/1000) × 2 500.
   */
  const of = (chars: number) => budgetFor(tool, { sourceAssetId: asset, sourceChars: chars } as FormValues, CAP);
  assert.equal(of(50_000), 60_000 + 50 * 2_500);
  assert.equal(of(200_000), 560_000, "200 000 belgi → 560 s, cap ichida");
  assert.ok(of(200_000) > of(50_000), "kattaroq hujjat ko'proq vaqt oladi");
  // Yaxlitlash yuqoriga: 50 001 belgi 51-mingni to'liq oladi.
  assert.equal(of(50_001), 60_000 + 51 * 2_500);

  // Kichik matn `MIN_BUDGET_MS` ga tayanadi — 60 s dan kam ish yo'q.
  assert.equal(of(1_000), MIN_BUDGET_MS);

  // Matn rejimi ham shu formuladan — hajm `sourceText` uzunligidan.
  assert.equal(budgetFor(tool, { sourceText: "x".repeat(50_000) } as FormValues, CAP), 60_000 + 50 * 2_500);

  // `cap` — operatorning yagona tugmasi: undan oshmaydi.
  assert.equal(budgetFor(tool, { sourceAssetId: asset, sourceChars: 200_000 } as FormValues, 300_000), 300_000);
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
  /*
   * `slide` va `pro-slide` istisno: ularda mavzu REJIMGA bog'liq (fayl
   * rejimida mavzu o'rniga `sourceText`), shuning uchun u `fields` da
   * emas, route'da `topicLegend`/fayl sharti bilan tekshiriladi.
   */
  for (const tool of TOOLS.filter((t) => t.custom && t.custom !== "slide" && t.custom !== "pro-slide")) {
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
  const slideMeta = extractMeta(TOOL_BY_ID.slide, { topic: "X", slideCount: 16 } as FormValues);
  assert.equal(slideMeta.targetPages, 16, "slayder 16 slayd va'da qiladi");
  const deck = (n: number) =>
    ({ meta: slideMeta, titlePage: true, toc: false, sections: [], slides: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, layout: "bullets", title: `S${i}` })) }) as never;

  assert.equal(deliveredCount(slideMeta, deck(16)), undefined, "to'liq deka qaytarishsiz");
  // `unit` — natija sahifasidagi jumla shu so'z bilan yoziladi. Slayd
  // dekasida endi ikki xil miqdor kam chiqishi mumkin (slayd va rasm),
  // ya'ni sonning o'zi qaysi va'da ekanini aytmaydi.
  assert.deepEqual(deliveredCount(slideMeta, deck(14)), { got: 14, want: 16, unit: "slayd" });
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
  assert.deepEqual(deliveredCount(gloMeta, gloDoc(28)), { got: 28, want: 40, unit: "atama" });
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
  assert.deepEqual(deliveredCount(mapMeta, mapDocOf(24)), { got: 24, want: 34, unit: "hafta" });

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

test("o'qituvchi hujjatlarida muassasa so'raladi va «Tuzuvchi» yoziladi", async () => {
  const { TOOLS } = await import("../lib/tools.ts");
  const { titleModel } = await import("../lib/generation/title-model.ts");

  /*
   * AYNAN P1-5 (AUDIT-5), uch qismli nuqson:
   *
   * 1. To'rttala o'qituvchi vositasi ham DOCX titulini chizardi, lekin
   *    formada MUASSASA maydoni yo'q edi — qiymat profildan jim kelar,
   *    profil yorlig'i esa «Oliy ta'lim muassasasi». Maktab o'qituvchisi
   *    u yerga o'z maktabini yozmaydi, ya'ni titulda bu qator amalda
   *    BO'SH qolardi.
   * 2. Titulda «Bajardi» turardi — bu TALABA tili. O'qituvchi dars
   *    ishlanmasini TUZADI.
   * 3. Sayt ko'ruvchilari titulni umuman chizmasdi (bu qism
   *    komponentlarda, bu yerda model darajasi sinaladi).
   */
  const teacher = TOOLS.filter((t) => t.group === "oqituvchi");
  assert.equal(teacher.length, 4, "o'qituvchi guruhida to'rt vosita");

  for (const tool of teacher) {
    const names = tool.fields.map((f) => f.name);
    assert.ok(names.includes("university"), `${tool.id}: muassasa maydoni so'ralishi kerak`);
    assert.ok(names.includes("author"), `${tool.id}: tuzuvchi maydoni so'ralishi kerak`);

    // Majburiy EMAS: glossariy shaxsiy ish daftari ham bo'lishi mumkin.
    const uni = tool.fields.find((f) => f.name === "university")!;
    assert.ok(!uni.required, `${tool.id}: muassasa majburiy bo'lmasligi kerak`);
    // Yorliq maktabga mo'ljallangan, «Oliy ta'lim muassasasi» emas.
    assert.ok(!/oliy/i.test(uni.legend), `${tool.id}: yorliq maktabga mos bo'lishi kerak`);

    const model = titleModel(anyDoc(tool.id, { topic: "Mavzu", subject: "Fan", author: "Karimova D." }));
    assert.equal(model.kind, "gost");
    assert.equal(model.authorLabel, "Tuzuvchi", `${tool.id}: «Tuzuvchi» bo'lishi kerak`);
  }

  // Talaba ishlarida «Bajardi» qoladi.
  for (const id of ["coursework", "referat", "essay", "thesis"] as const) {
    const model = titleModel(anyDoc(id, { topic: "Mavzu", author: "Aliyev A." }));
    assert.equal(model.kind, "gost");
    assert.equal(model.authorLabel, "Bajardi", `${id}: «Bajardi» qolishi kerak`);
  }

  // Chiqishda ham ko'rinadi.
  const lesson = await docxText(
    anyDoc("lesson-plan", {
      topic: "Kasrlar",
      subject: "Matematika",
      author: "Karimova Dilnoza",
      university: "15-son umumiy o'rta ta'lim maktabi",
    }),
  );
  assert.match(lesson, /Tuzuvchi: Karimova Dilnoza/, "titulda «Tuzuvchi» bo'lishi kerak");
  assert.ok(!/Bajardi/.test(lesson), "dars rejasida «Bajardi» bo'lmasligi kerak");
  assert.match(lesson, /15-SON UMUMIY O'RTA TA'LIM MAKTABI|15-son umumiy o'rta ta'lim maktabi/i);

  const cw = await docxText(anyDoc("coursework", { topic: "Mavzu", author: "Aliyev Ali" }));
  assert.match(cw, /Bajardi: Aliyev Ali/, "kurs ishida «Bajardi» qoladi");
});

test("ostmavzu sarlavhasi chapda, abzats chekinishi bilan", async () => {
  /*
   * «Talaba ishlari» ko'ruvchisi (`WordViewer`) va DOCX solishtirilganda
   * eng ko'zga tashlanadigan farq shu edi: `render-docx` `h2` ni
   * `heading()` orqali chizar, gost profilida esa u MARKAZDA turardi —
   * ya'ni har bir ostmavzu («1.1. Tushuncha va tasnif») faylda markazda,
   * saytda chapda ko'rinardi.
   *
   * Bu yerda ko'ruvchi HAQ edi: GOST 7.32 va OTME uslubiy
   * ko'rsatmalarida struktura elementlari (bob, mundarija, adabiyotlar)
   * markazda, ostmavzu esa abzats chekinishidan yoziladi.
   */
  const doc = anyDoc("coursework", { topic: "Mavzu", author: "A. Valiyev" }, {
    sections: [
      {
        id: "bob1",
        title: "I BOB. NAZARIY ASOSLAR",
        blocks: [
          { kind: "h2", text: "1.1. Tushuncha va tasnif" },
          { kind: "p", text: "Tana matni." },
        ],
      },
    ],
  });
  const xml = await docxXml(doc);

  // Ostmavzu paragrafi: HEADING_2 + chapga tekislash + chekinish.
  // `[^]` = ixtiyoriy belgi (yangi qator ham) — `/s` bayrog'i `tsconfig`
  // `target: ES2017` da xato beradi, `[^]` esa hamma joyda ishlaydi.
  const h2 = xml.match(/<w:p\b[^>]*>(?:(?!<\/w:p>)[^])*Heading2(?:(?!<\/w:p>)[^])*<\/w:p>/);
  assert.ok(h2, "HEADING_2 paragrafi topilishi kerak");
  assert.match(h2[0], /w:jc w:val="left"/, "ostmavzu chapga tekislanishi kerak");
  assert.match(h2[0], /w:firstLine="709"/, "abzats chekinishi (1.25 sm = 709 twip) bo'lishi kerak");

  // Bob sarlavhasi esa MARKAZDA qoladi.
  const h1 = xml.match(/<w:p\b[^>]*>(?:(?!<\/w:p>)[^])*Heading1(?:(?!<\/w:p>)[^])*<\/w:p>/);
  assert.ok(h1, "HEADING_1 paragrafi topilishi kerak");
  assert.match(h1[0], /w:jc w:val="center"/, "bob sarlavhasi markazda qolishi kerak");
});

test("matnsiz bo'lim sarlavhasi na faylda, na ko'ruvchida chiziladi", async () => {
  const { docToFlow, tocRows } = await import("../lib/viewers/flow.ts");

  /*
   * `render-docx` matnsiz bo'limni tashlab ketadi (`if (s.blocks.length)`)
   * va `tocRows` ham. `docToFlow` esa har bo'limga sarlavha qo'yardi —
   * saytda «KIRISH» sarlavhasi ostida hech narsa yo'q sahifa ko'rinar,
   * faylda esa u umuman bo'lmasdi.
   */
  const doc = anyDoc("referat", { topic: "Mavzu", author: "A. Valiyev" }, {
    sections: [
      { id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "Bor matn." }] },
      { id: "bosh", title: "BO'SH BO'LIM", blocks: [] },
      { id: "xulosa", title: "Xulosa", blocks: [{ kind: "p", text: "Yakun." }] },
    ],
  });

  const flow = docToFlow(doc);
  const headings = flow.filter((i) => i.type === "h1").map((i) => (i as { text: string }).text);
  assert.ok(!headings.includes("BO'SH BO'LIM"), `bo'sh bo'lim chizilmasligi kerak: ${headings}`);
  assert.ok(headings.includes("Kirish") && headings.includes("Xulosa"));

  // Mundarija ham, fayl ham uni ko'rsatmaydi — uchalasi bir xil qaror.
  assert.ok(!tocRows(doc).some((r) => r.text === "BO'SH BO'LIM"));
  const text = await docxText(doc);
  assert.ok(!/BO'SH BO'LIM/.test(text), "faylda ham bo'lmasligi kerak");
});

test("docToFlow jadval qatorlarini ALOHIDA band qiladi (Sprint 5, B1)", async () => {
  const { docToFlow } = await import("../lib/viewers/flow.ts");

  /*
   * Ilgari 10 qatordan oshgan jadval QATTIQ 10talik bo'laklarga
   * kesilardi — bu son qator balandligiga bog'liq emas edi, ya'ni
   * 10 ta uzun qator baribir bitta varaqdan oshib, jim kesilishi
   * mumkin edi (AUDIT-6 B1). Endi har qator o'z balandligi bo'yicha
   * `paginate.ts` da oqadi — `docToFlow` faqat bitta sarlavha (`table-head`)
   * va har qatorga bitta `table-row` chiqarishi kerak, sonidan qat'iy
   * nazar.
   */
  const doc = anyDoc("referat", { topic: "Mavzu", author: "A. Valiyev" }, {
    sections: [{ id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "Matn." }] }],
    tables: [{ headers: ["A"], rows: Array.from({ length: 23 }, (_, i) => [`Qator ${i}`]) }],
  });

  const flow = docToFlow(doc);
  const heads = flow.filter((i) => i.type === "table-head");
  const rows = flow.filter((i) => i.type === "table-row");
  assert.equal(heads.length, 1, "bitta jadvalga bitta sarlavha");
  assert.equal(rows.length, 23, "har qator ALOHIDA band bo'lishi kerak, 10talik bo'lak emas");
  assert.deepEqual(
    (rows[0] as { row: string[] }).row,
    ["Qator 0"],
    "qator matni saqlanishi kerak",
  );
});

test("ko'ruvchi CSS o'lchamlari hujjat profilidan chetlashmaydi", async () => {
  const { readFile } = await import("node:fs/promises");
  const { profileById } = await import("../lib/generation/docx-profile.ts");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  /*
   * Ko'ruvchi statik CSS bilan chiziladi, DOCX esa `DocProfile` dan.
   * Ular ajralib ketsa foydalanuvchi saytda boshqa o'lchamdagi hujjatni
   * ko'radi. Bu test ikkalasini BOG'LAYDI: profil qiymati o'zgarsa,
   * CSS ham yangilanishi kerak.
   *
   * `docx` yarim-punktda o'lchaydi (22 = 11 pt), CSS esa punktda.
   */
  const gost = profileById("gost");
  const pt = (halfPt: number) => halfPt / 2;

  const rule = (selector: string) => {
    const m = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`, "s"));
    assert.ok(m, `${selector} qoidasi topilishi kerak`);
    return m[0];
  };

  // Tana matni: 28 yarim-punkt = 14 pt, 1.5 interval, justify, 1.25 sm.
  assert.equal(pt(gost.type.size), 14);
  assert.match(rule(".word-inner"), /font-size:\s*14pt/);
  assert.match(rule(".word-inner"), /line-height:\s*1\.5/);
  assert.match(rule(".word-p"), /text-align:\s*justify/);
  assert.match(rule(".word-p"), /text-indent:\s*1\.25cm/);

  // Jadval katagi: profildagi `tableSize`.
  assert.match(
    rule(".word-table"),
    new RegExp(`font-size:\\s*${pt(gost.tableSize)}pt`),
    `jadval katagi ${pt(gost.tableSize)}pt bo'lishi kerak (profil: ${gost.tableSize} yarim-punkt)`,
  );

  // Hoshiyalar: 2 sm / 1.5 sm / 2 sm / 3 sm (CM = 567 twip → mm).
  const mm = (twip: number) => Math.round((twip / 567) * 10);
  const m = gost.page.margin;
  assert.match(
    rule(".word-inner"),
    new RegExp(`padding:\\s*${mm(m.top)}mm\\s+${mm(m.right)}mm\\s+${mm(m.bottom)}mm\\s+${mm(m.left)}mm`),
    `hoshiyalar profil bilan bir xil bo'lishi kerak: ${mm(m.top)}/${mm(m.right)}/${mm(m.bottom)}/${mm(m.left)}mm`,
  );

  // Ostmavzu chapda va chekinishli — DOCX `subHeading` bilan bir xil.
  assert.match(rule(".word-h2"), /text-align:\s*left/);
  assert.match(rule(".word-h2"), /text-indent:\s*1\.25cm/);
  // Bandlar tekislanmaydi (DOCX bullet paragrafi ham tekislamaydi).
  assert.match(rule(".word-li"), /text-align:\s*left/);
});

/* ─────────────────────────── AUDIT-6 · Sprint 1 ─────────────────────────── */

test("A6: titul yili hujjat bilan muzlaydi, render vaqtidan olinmaydi", async () => {
  const { titleModel } = await import("../lib/generation/title-model.ts");

  /*
   * Ilgari `title-model.ts` yilni `new Date()` dan olardi: DOCX baytlari
   * yaratilganda muzlar, ko'ruvchi esa har ochilganda qayta hisoblardi.
   * Dekabrda yaratilib yanvarda ochilgan hujjatda ekran «2026», fayl
   * «2025» ko'rsatardi. Endi yil `meta.year` da muzlaydi.
   */
  const base = anyDoc("coursework", { topic: "Mavzu", author: "Aliyev A." });
  const frozen = { ...base, meta: { ...base.meta, year: 2019 } };

  const model = titleModel(frozen);
  assert.equal(model.kind, "gost");
  if (model.kind !== "gost") return;
  assert.equal(model.cityYear, "Toshkent — 2019");
  assert.ok(model.academicYear.includes("2019") && model.academicYear.includes("2020"));

  // Fayl ham shu yilni chizadi — ya'ni ekran = fayl.
  const xml = await docxText(frozen);
  assert.match(xml, /Toshkent — 2019/);
  assert.ok(!/202[3-9]/.test(xml), `faylda joriy yil bo'lmasligi kerak: ${xml.match(/20\d\d/g)}`);

  // `meta.year` bo'lmasa (eski `doc_json`) render vaqti yiliga qaytadi —
  // regressiya emas, avvalgi xatti-harakat.
  const legacyModel = titleModel({ ...base, meta: { ...base.meta, year: undefined } });
  assert.equal(legacyModel.kind === "gost" && legacyModel.cityYear, `Toshkent — ${new Date().getFullYear()}`);
});

test("A6: extractMeta yilni to'ldiradi", async () => {
  const m = extractMeta(TOOL_BY_ID.referat, { topic: "X" } as FormValues);
  assert.equal(m.year, new Date().getFullYear());
});

test("A7: ma'nosiz o'rinbosar universitet titulda chizilmaydi", async () => {
  const { titleModel } = await import("../lib/generation/title-model.ts");

  /*
   * Ilgari bu shart FAQAT `render-docx.ts` da turardi — `TitlePage`
   * (sayt) `«Oliy ta'lim muassasasi»` ni baribir chizardi. Endi model
   * bitta qaror qiladi.
   */
  const placeholder = anyDoc("coursework", {
    topic: "Mavzu",
    author: "Aliyev A.",
    university: "Oliy ta'lim muassasasi",
  });
  const m = titleModel(placeholder);
  assert.equal(m.kind === "gost" && m.university, "", "o'rinbosar nom «» ga aylanishi kerak");

  const xml = await docxText(placeholder);
  assert.ok(!/OLIY TA'LIM MUASSASASI/i.test(xml), "faylda ham chizilmasligi kerak");

  // Haqiqiy nom o'zgarishsiz o'tadi.
  const realModel = titleModel(anyDoc("coursework", { topic: "Mavzu", author: "Aliyev A.", university: "TDPU" }));
  assert.equal(realModel.kind, "gost");
  assert.equal(realModel.kind === "gost" && realModel.university, "TDPU");
});

test("A9: jadval ustun kengliklari DOCX va ko'ruvchi uchun yagona manbadan", async () => {
  const { columnPercents, evenPercents } = await import("../lib/generation/table-columns.ts");

  // Texnologik xarita — 6 ustun, «Mavzu» eng keng.
  assert.deepEqual(columnPercents(["№", "Soat", "Mavzu", "Metod", "Natija", "Nazorat"]), [5, 8, 33, 15, 25, 14]);
  assert.equal(columnPercents(["№", "Soat", "Mavzu", "Metod", "Natija", "Nazorat"])!.reduce((a, b) => a + b, 0), 100);
  // Model bergan har qanday boshqa jadval — teng taqsimot (qat'iy qolip
  // faqat 6 ustunli xarita uchun; dars jadvali `DocTable.widths` beradi).
  assert.equal(columnPercents(["A", "B", "C"]), null);
  assert.equal(columnPercents(["Bosqich", "Daqiqa", "Faoliyat", "Natija"]), null);
  assert.deepEqual(evenPercents(3), [33, 33, 33]);
  assert.deepEqual(evenPercents(0), [100]);

  // DOCX renderi ham shu moduldan — grid nisbati saqlanadi.
  const xml = await docxXml(
    anyDoc("texnologik-xarita", { topic: "Fan", subject: "Fan", author: "A." }, {
      tables: [{ caption: "Reja", headers: ["№", "Soat", "Mavzu", "Metod", "Natija", "Nazorat"], rows: [["1", "2", "M", "L", "N", "T"]] }],
    }),
  );
  const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
  assert.equal(grid.length, 6);
  assert.ok(grid[2] > grid[0] * 4, "«Mavzu» ustuni «№» dan keng qoladi");
});

test("A4: ko'ruvchi yorliqlari hujjat tiliga ergashadi", async () => {
  const { sectionLabels } = await import("../lib/generation/i18n.ts");
  const { languageName } = await import("../lib/languages.ts");

  // Uch tilda ham yangi ko'ruvchi maydonlari bor (bir tilda tushib qolsa
  // ko'ruvchi `undefined` chizadi).
  for (const code of ["uz", "ru", "en"] as const) {
    const L = sectionLabels(code);
    for (const key of ["viewerGlossary", "viewerKeys", "viewerLesson", "viewerMap", "viewerResume", "fieldContact", "fieldLanguage", "continued"] as const) {
      assert.equal(typeof L[key], "string", `${code}.${key} bo'lishi kerak`);
      assert.ok((L[key] as string).length > 0);
    }
    assert.equal(typeof L.unitTerms(3), "string");
    assert.equal(typeof L.unitCases(3), "string");
  }

  // Ruscha va inglizcha aniq boshqa matn (o'zbekchaga tushib qolmagan).
  assert.equal(sectionLabels("ru").viewerGlossary, "Глоссарий");
  assert.equal(sectionLabels("en").viewerLesson, "Lesson plan");
  assert.match(sectionLabels("ru").unitTerms(5), /5 терминов/);

  // `LessonViewer` xom til kodi emas, til NOMINI ko'rsatadi (A4).
  assert.equal(languageName("ru"), "Русский");
  assert.equal(languageName("en"), "English");
});

test("A4: rezyume DOCX yorliqlari ham hujjat tiliga ergashadi", async () => {
  /*
   * `ResumeViewer` "Rezyume" / "Aloqa" / "Ko'nikmalar" ni qattiq o'zbekcha
   * chizardi, DOCX `resumeBody` ham. Ruscha rezyumeda ekran va fayl bir
   * xil o'zbekcha yorliq berardi. Endi ikkalasi ham `sectionLabels` dan.
   */
  const ruDoc = anyDoc(
    "resume",
    { topic: "Разработчик", fullName: "И. Петров", language: "ru" },
    {
      titlePage: false,
      sections: [
        { id: "summary", title: "Кратко о себе", blocks: [{ kind: "p", text: "Опытный разработчик." }, { kind: "p", text: "Москва" }] },
        { id: "exp", title: "Опыт работы", blocks: [{ kind: "h3", text: "2020-2024 - Dev" }] },
        { id: "skills", title: "Навыки", blocks: [{ kind: "p", text: "Node.js" }] },
      ],
    },
  );
  const text = await docxText(ruDoc);
  assert.match(text, /РЕЗЮМЕ/, "ruscha rezyumeda «РЕЗЮМЕ»");
  assert.match(text, /КОНТАКТЫ/, "ruscha «КОНТАКТЫ»");
  assert.ok(!/REZYUME|ALOQA/.test(text), "o'zbekcha yorliq qolmasligi kerak");
});

test("A2: keys hujjatida mundarija yo'q (ko'ruvchi bilan bir xil)", async () => {
  const { writeKeysWithLlm } = await import("../lib/generation/write-specials.ts");

  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;

  const keysJson = JSON.stringify({
    intro: "Kirish matni yetarli uzunlikda bo'lishi uchun bir necha so'z.",
    cases: Array.from({ length: 4 }, (_, i) => ({
      title: `Vaziyat ${i + 1}`,
      situation: `Aniq ism-vaziyatli keys ${i + 1} tavsifi, yetarlicha uzun.`,
      tasks: ["Birinchi topshiriq", "Ikkinchi topshiriq"],
      key: `Namunaviy kalit ${i + 1}.`,
      rubric: [
        { criterion: "Tahlil chuqurligi", points: 5 },
        { criterion: "Asoslash", points: 5 },
      ],
    })),
  });

  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: keysJson }] } }] }),
    }) as never) as typeof fetch;

  try {
    const meta = extractMeta(TOOL_BY_ID.keys, { topic: "Pedagogika", language: "uz" } as FormValues);
    const doc = await writeKeysWithLlm(meta, Date.now() + 120_000);
    assert.ok(doc, "keys hujjati yozilishi kerak");
    assert.equal(doc.toc, false, "keys hujjatida `toc` yo'q bo'lishi kerak");

    // Fayl ham mundarija sarlavhasini chizmaydi.
    const textOut = await docxText(doc);
    assert.ok(!/Mundarija/i.test(textOut), "DOCX da «Mundarija» sarlavhasi bo'lmasligi kerak");
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
});

// ── AUDIT-7 O-1: rasm kelmagani jim qolmasin ─────────────────────────

/**
 * Rasm bosqichi uchun umumiy sozlash.
 *
 * LLM kaliti O'CHIRILADI (`writeSlideImagePrompts` tarmoqqa chiqmasin —
 * u holda faqat zaxira promptlar ishlatiladi), `FAL_KEY` esa QO'YILADI:
 * `attachSlideImages` kalitsiz holatda umuman rasm va'da qilmaydi.
 */
function slideImageEnv() {
  const saved = {
    fal: process.env.FAL_KEY,
    gemini: process.env.GEMINI_API_KEY,
    xai: process.env.XAI_API_KEY,
    fetch: globalThis.fetch,
  };
  process.env.FAL_KEY = "test-fal-key";
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  return () => {
    globalThis.fetch = saved.fetch;
    if (saved.fal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = saved.fal;
    if (saved.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.gemini;
    if (saved.xai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = saved.xai;
  };
}

const bulletDeck = (n: number): SlideModel[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    layout: "bullets" as const,
    title: `Slayd ${i + 1}`,
  }));

/**
 * AYNAN O-1 (AUDIT-7). Jonli sinovda fal.ai 19 ta so'rovning 19 tasini
 *
 *   [fal] 403 User is locked. Reason: TOP_UP.
 *
 * bilan rad etdi. Deka rasmsiz `COMPLETED` bo'ldi, «Premium uzun ·
 * sifatliroq rasm · 8 000» ning butun narxi olindi va foydalanuvchi
 * buni HECH QAYERDAN bilmadi: yagona signal `console.warn` edi, ya'ni
 * faqat server jurnalida.
 */
test("fal.ai hisobni bloklasa rasm bosqichi buni hisobotga yozadi", async () => {
  const { attachSlideImages } = await import("../lib/generation/slide-images.ts");
  const restore = slideImageEnv();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return {
      ok: false,
      status: 403,
      json: async () => ({ detail: "User is locked. Reason: TOP_UP." }),
    } as never;
  }) as typeof fetch;

  try {
    const slides = bulletDeck(16);
    const report = await attachSlideImages(slides, "Fotosintez", "classic", 60_000, { premium: true });

    assert.ok(report.want > 0, "premium dekada rasm sloti rejalashtirilishi kerak");
    assert.equal(report.got, 0, "403 dan keyin bironta ham rasm biriktirilmasligi kerak");
    assert.equal(report.blocked, report.want, "hamma slot bloklangan deb sanalishi kerak");
    assert.equal(report.skipped, 0, "bu vaqt muammosi EMAS — `skipped` bilan aralashmasin");
    assert.match(String(report.blockReason), /User is locked/, "sabab hisobotda qolishi kerak");
    assert.equal(slides.filter((s) => s.image).length, 0);

    /*
     * Blok aniqlangach qolgan so'rov yuborilmaydi: javob kalit/hisob
     * darajasida, ya'ni keyingisi ham albatta shu 403 ni oladi.
     * `mapPool` yo'lakligi 3 — shuncha so'rov allaqachon yo'lda
     * bo'lishi mumkin, undan ortig'i yo'q.
     */
    assert.ok(calls <= 3, `blokdan keyin so'rov to'xtashi kerak, yuborilgani: ${calls}`);
    assert.ok(calls < report.want, `${report.want} ta o'rniga ${calls} ta so'rov ketishi kerak`);
  } finally {
    restore();
  }
});

/**
 * Ikkinchi holat — vaqt tugashi. Ilgari u ham, blok ham bir xil
 * jimlik bilan o'tardi (`console.warn`), ya'ni jurnalga qarab «hisobni
 * to'ldirish kerakmi yoki byudjetni oshirish kerakmi» degan savolga
 * javob berib bo'lmasdi.
 */
test("byudjet tugagani blokdan alohida sanaladi", async () => {
  const { attachSlideImages } = await import("../lib/generation/slide-images.ts");
  const restore = slideImageEnv();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return { ok: false, status: 403, json: async () => ({ detail: "User is locked." }) } as never;
  }) as typeof fetch;

  try {
    const slides = bulletDeck(16);
    // Byudjet nol — birinchi tekshiruvdayoq hamma slot o'tkazib yuboriladi.
    const report = await attachSlideImages(slides, "Fotosintez", "classic", 0, { premium: true });

    assert.ok(report.want > 0);
    assert.equal(report.skipped, report.want, "hamma slot «vaqt tugadi» deb sanalishi kerak");
    assert.equal(report.blocked, 0, "vaqt tugashi blok emas");
    assert.equal(calls, 0, "byudjet tugaganda provayderga so'rov ketmasligi kerak");
  } finally {
    restore();
  }
});

/**
 * Va'da qilingan rasm soni YAGONA manbadan (`plannedImageSlots`) —
 * `deliveredCount` uni qayta hisoblamaydi. Ikkinchi nusxa `photoSlot`
 * yoki `imageBudget` o'zgarganda jimgina ajralib ketardi.
 */
test("rasm va'dasi reja bilan bir xil songa asoslanadi", async () => {
  const { attachSlideImages, plannedImageSlots, imageBudget } = await import(
    "../lib/generation/slide-images.ts"
  );
  const restore = slideImageEnv();
  globalThis.fetch = (async () =>
    ({ ok: false, status: 403, json: async () => ({ detail: "User is locked." }) }) as never) as typeof fetch;

  try {
    const slides = bulletDeck(16);
    const planned = plannedImageSlots(slides, "classic", true);
    assert.equal(planned.length, imageBudget(16, true), "16 slaydli premium dekada byudjet bog'lovchi");

    const report = await attachSlideImages(slides, "Fotosintez", "classic", 60_000, { premium: true });
    assert.equal(report.want, planned.length, "hisobotdagi va'da reja bilan bir xil bo'lishi kerak");

    // Kalitsiz muhitda rasm umuman va'da qilinmaydi — aks holda har
    // lokal deka «kam yetkazildi» bo'lib, pul qaytarilardi.
    delete process.env.FAL_KEY;
    const noKey = await attachSlideImages(bulletDeck(16), "Fotosintez", "classic", 60_000, { premium: true });
    assert.equal(noKey.want, 0, "FAL_KEY yo'q bo'lsa rasm va'da qilinmaydi");
  } finally {
    restore();
  }
});

/**
 * Hisobot `doc.slideImages` orqali `deliveredCount` ga yetib boradi va
 * PULGA aylanadi.
 *
 * Ulush 0.25: paket narxlaridan chiqarilgan (`priceFor`) — slayd bahosi
 * (5 000−3 000)/(14−10) = 500, ya'ni premium uzun 8 000 = 5 000 + 2×500
 * + 2 000, «sifatliroq rasm» ustamasi 2 000 tanga = 8 000 ning 1/4 i.
 */
test("premium paket yo'q (Formalar 2): 16 slaydli oddiy dekada rasm nol kelsa to'liq qaytadi, qisman kamomad ulushsiz qayd etiladi", async () => {
  const { deliveredCount } = await import("../lib/generation/delivered.ts");
  const { shortfallRatio } = await import("../lib/server/worker.ts");

  // Ilgari `quality: "premium_long"` (8 000, rasm ustamasi 1/4). Endi paket
  // yo'q — 16 slayd slayderdan, `premiumVisuals` doim false, rasm ustamasi 0.
  const premiumMeta = extractMeta(TOOL_BY_ID.slide, {
    topic: "Fotosintez",
    slideCount: 16,
  } as FormValues);
  assert.equal(premiumMeta.premiumVisuals, false);
  const deck = (slides: number, images?: { want: number; got: number }) =>
    ({
      meta: premiumMeta,
      titlePage: true,
      toc: false,
      sections: [],
      slides: bulletDeck(slides),
      ...(images
        ? { slideImages: { ...images, blocked: images.want - images.got, skipped: 0, failed: 0 } }
        : {}),
    }) as never as AcademicDoc;

  /*
   * 16 slayd to'liq, 13 rasmdan 0 tasi keldi — HECH NARSA yetkazilmadi.
   *
   * Mahsulot qarori: kontent umuman bo'lmasa TO'LIQ qaytariladi. Ulush
   * (0.25) QISMAN kamomadni o'lchash uchun — u yozuvda saqlanadi, lekin
   * nol yetkazishda hisobga olinmaydi.
   */
  const zero = deliveredCount(premiumMeta, deck(16, { want: 13, got: 0 }));
  assert.deepEqual(zero, { got: 0, want: 13, unit: "rasm", refundShare: 0 });
  assert.equal(shortfallRatio(zero), 1, "rasm umuman chiqmasa narxning hammasi qaytadi");

  // Yarmi kelgan bo'lsa — qayd etiladi, lekin ustama yo'q, pul qaytmaydi.
  const half = deliveredCount(premiumMeta, deck(16, { want: 12, got: 6 }));
  assert.deepEqual(half, { got: 6, want: 12, unit: "rasm", refundShare: 0 });
  assert.equal(shortfallRatio(half), null, "ustama olinmagan miqdorning qismi uchun pul qaytmaydi");

  // To'liq yetkazilganda qaytarish yo'q.
  assert.equal(deliveredCount(premiumMeta, deck(16, { want: 13, got: 13 })), undefined);

  /*
   * Hisobot yo'q (eski `doc_json`, yoki rasm bosqichi umuman
   * ishlamagan muhit) — va'da ham yo'q. Aks holda har eski deka
   * ochilganda «rasm kelmadi» deb pul qaytarilardi.
   */
  assert.equal(deliveredCount(premiumMeta, deck(16)), undefined, "hisobotsiz deka qaytarishsiz");
});

/**
 * Standart paket yorlig'ida rasm haqida so'z yo'q («Standart · 10 slayd
 * · 3 000») va narxda unga ustama ham yo'q — QISMAN kamomad uchun pul
 * qaytarilmaydi, lekin u QAYD ETILADI.
 *
 * Rasm UMUMAN chiqmasa esa paketdan qat'i nazar to'liq qaytariladi:
 * foydalanuvchi va'da qilingan mahsulotning bir qismini emas, butun
 * bir turini olmaydi.
 */
test("standart paketda qisman kamomad qayd etiladi, nol kamomadda pul to'liq qaytadi", async () => {
  const { deliveredCount } = await import("../lib/generation/delivered.ts");
  const { shortfallRatio } = await import("../lib/server/worker.ts");

  const stdMeta = extractMeta(TOOL_BY_ID.slide, { topic: "Fotosintez", quality: "standard" } as FormValues);
  assert.equal(stdMeta.premiumVisuals, false);
  const doc = (got: number) =>
    ({
      meta: stdMeta,
      titlePage: true,
      toc: false,
      sections: [],
      slides: bulletDeck(10),
      slideImages: { want: 8, got, blocked: 8 - got, skipped: 0, failed: 0 },
    }) as never as AcademicDoc;

  // Qisman: 8 tadan 5 tasi keldi — qayd etiladi, pul qaytmaydi.
  const partial = deliveredCount(stdMeta, doc(5));
  assert.deepEqual(partial, { got: 5, want: 8, unit: "rasm", refundShare: 0 });
  assert.equal(shortfallRatio(partial), null, "ustama olinmagan miqdorning QISMI uchun pul qaytmaydi");

  // Nol: bitta ham rasm chiqmadi — to'liq qaytariladi.
  const zero = deliveredCount(stdMeta, doc(0));
  assert.deepEqual(zero, { got: 0, want: 8, unit: "rasm", refundShare: 0 });
  assert.equal(shortfallRatio(zero), 1, "rasm umuman chiqmasa standart paketda ham to'liq qaytadi");
});

/**
 * Slayd dekasida IKKI va'da bor (slayd soni va rasm soni), `delivered`
 * maydoni esa bitta. Pul jihatdan og'irrog'i yoziladi.
 */
test("slayd va rasm kamomadidan og'irrog'i yoziladi", async () => {
  const { deliveredCount } = await import("../lib/generation/delivered.ts");

  const premiumMeta = extractMeta(TOOL_BY_ID.slide, {
    topic: "Fotosintez",
    quality: "premium_long",
  } as FormValues);
  const deck = (slides: number, images: { want: number; got: number }) =>
    ({
      meta: premiumMeta,
      titlePage: true,
      toc: false,
      sections: [],
      slides: bulletDeck(slides),
      slideImages: { ...images, blocked: images.want - images.got, skipped: 0, failed: 0 },
    }) as never as AcademicDoc;

  // Slayd 14/16 → 0.125; rasm 0/13 → 1.0 × 0.25 = 0.25. Rasm og'irroq.
  assert.equal(deliveredCount(premiumMeta, deck(14, { want: 13, got: 0 }))?.unit, "rasm");

  // Slayd 8/16 → 0.5; rasm 12/13 → 0.077 × 0.25 ≈ 0.019. Slayd og'irroq.
  assert.equal(deliveredCount(premiumMeta, deck(8, { want: 13, got: 12 }))?.unit, "slayd");
});

/**
 * Uchdan-uchiga simlash: rasm bosqichining hisoboti `buildSlideAcademicDoc`
 * dan `doc.slideImages` ga, u yerdan `deliveredCount` ga yetib boradimi.
 * Aynan shu zanjir uzilgani uchun 403 jim qolgan edi.
 */
test("bloklangan hisob deka yo'lida `delivered` ga aylanadi", async () => {
  const { buildSlideAcademicDoc } = await import("../lib/generation/slide-write.ts");
  const { deliveredCount } = await import("../lib/generation/delivered.ts");
  const { shortfallRatio } = await import("../lib/server/worker.ts");
  const restore = slideImageEnv();
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 403,
      json: async () => ({ detail: "User is locked. Reason: TOP_UP." }),
    }) as never) as typeof fetch;

  // Oddiy slayd rasmlari endi faqat bepul stock (Formalar 2): bloklangan hisob — Pexels 403.
  const savedPexels = process.env.PEXELS_API_KEY;
  process.env.PEXELS_API_KEY = "test-pexels-key";
  try {
    const meta = extractMeta(TOOL_BY_ID.slide, {
      topic: "Fotosintez jarayoni",
      slideCount: 16,
    } as FormValues);
    const doc = await buildSlideAcademicDoc(meta, Date.now() + 30_000);

    assert.ok(doc.slideImages, "rasm bosqichi hisoboti hujjatda saqlanishi kerak");
    assert.ok(doc.slideImages.want > 0, "stock kaliti bor deka rasm va'da qiladi");
    assert.equal(doc.slideImages.got, 0);

    const d = deliveredCount(meta, doc);
    assert.ok(d, "rasmsiz deka `delivered` bilan belgilanishi kerak");
    assert.equal(d.unit, "rasm");
    assert.equal(d.got, 0);
    assert.ok(shortfallRatio(d)! > 0, "worker qisman qaytarishi kerak");
  } finally {
    if (savedPexels === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = savedPexels;
    restore();
  }
});
