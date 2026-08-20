import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { extractMeta, parseAuthorLine } from "../lib/generation/meta.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";

/**
 * Hujjat qobig'i: titul sahifa, muallif ma'lumotlari, ramka.
 *
 * Bu tekshiruvlar Sprint 2 da tuzatilgan nuqsonlarni qulflaydi —
 * kurs/guruh titulga chiqishi, imzo qatorlari, ramka faqat inshoda.
 */

function meta(toolId: "coursework" | "essay" | "referat", values: FormValues) {
  return extractMeta(TOOL_BY_ID[toolId], values);
}

function doc(toolId: "coursework" | "essay" | "referat", values: FormValues): AcademicDoc {
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
test("uzun matn pul yechilishidan oldin rad etiladi", async () => {
  const { preflightError, TRANSLATION_MAX_CHARS } = await import("../lib/tools.ts");
  const tool = TOOL_BY_ID["translation"];

  assert.equal(preflightError(tool, { sourceText: "salom" } as FormValues), null);
  assert.equal(preflightError(tool, { sourceText: "x".repeat(TRANSLATION_MAX_CHARS) } as FormValues), null);

  const tooLong = preflightError(tool, { sourceText: "x".repeat(TRANSLATION_MAX_CHARS + 1) } as FormValues);
  assert.ok(tooLong && /juda uzun/i.test(tooLong), "uzun matn haqida aniq xabar bo'lishi kerak");

  // Boshqa vositalarga bu chegara tegishli emas.
  assert.equal(preflightError(TOOL_BY_ID["referat"], { sourceText: "x".repeat(100_000) } as FormValues), null);
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
