import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { CM, profileFor, teacherProfile } from "../lib/generation/docx-profile.ts";
import { renderDocx } from "../lib/generation/render-docx.ts";
import { TEACHER_MARGINS_CM } from "../lib/generation/teacher/layout.ts";
import { sampleTeacherDoc } from "../lib/generation/teacher/samples.ts";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * O'QITUVCHI HUJJATI DOCX (AUDIT-20 WP-C).
 *
 * XML NING O'ZI o'qiladi (`word/document.xml`) — foydalanuvchi aynan
 * shuni oladi. Qulflanadigan qarorlar: TITUL BETI YO'Q va birinchi
 * betning o'zida rasmiy shapka; «Tasdiqlayman» o'ng yuqorida; xarita
 * albom, qolganlari portret; test kaliti yangi betdan; javob varianti
 * ro'yxat belgisisiz; `lineRule="auto"` hamma joyda.
 */

const KINDS = ["lesson", "map", "glossary", "keys", "test"] as const;

async function xmlOf(doc: AcademicDoc) {
  const bytes = await renderDocx(doc);
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  return { xml, zip, bytes };
}

function textNodes(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim(),
    )
    .filter(Boolean);
}

function posOf(xml: string, needle: string): number {
  const i = xml.indexOf(`>${needle}<`);
  assert.ok(i >= 0, `«${needle}» topilmadi`);
  return i;
}

/** `needle` matnini o'z ichiga olgan `<w:p>` paragrafi. */
function paraOf(xml: string, needle: string): string {
  const at = posOf(xml, needle);
  const from = Math.max(xml.lastIndexOf("<w:p>", at), xml.lastIndexOf("<w:p ", at));
  const to = xml.indexOf("</w:p>", at);
  assert.ok(from >= 0 && to > from, `«${needle}» paragrafi topilmadi`);
  return xml.slice(from, to);
}

/* ══════════════════════════ shapka va titul ══════════════════════════ */

test("TITUL BETI YO'Q: hujjat rasmiy shapkadan boshlanadi, vazirlik qatori chizilmaydi", async () => {
  for (const kind of KINDS) {
    const { xml } = await xmlOf(sampleTeacherDoc(kind));
    const t = textNodes(xml);
    assert.ok(!t.some((x) => /VAZIRLIGI|МИНИСТЕРСТВО|MINISTRY/.test(x)), `${kind}: titul betidagi vazirlik qatori qoldi`);
    assert.ok(!t.some((x) => x === "Bajardi" || x.startsWith("Bajardi:")), `${kind}: talaba tili «Bajardi» chiqdi`);
    assert.ok(!/<w:titlePg\s*\/>/.test(xml), `${kind}: titul beti kolontituli e'lon qilingan`);
    assert.equal(teacherProfile(kind).titlePage, "none");
    // Birinchi matn tuguni — «Tasdiqlayman» yoki muassasa nomi.
    assert.ok(/Tasdiqlayman|maktabi/.test(t[0]), `${kind}: birinchi tugun shapka emas: «${t[0]}»`);
  }
});

test("«Tasdiqlayman» bloki O'NG YUQORIDA, lavozim va imzo chizig'i bilan", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("lesson"));
  const p = paraOf(xml, "Tasdiqlayman");
  assert.ok(p.includes('<w:jc w:val="right"/>'), "«Tasdiqlayman» o'ngda emas");
  const t = textNodes(xml);
  assert.equal(t[0], "Tasdiqlayman");
  assert.ok(/o‘rinbosari/.test(t[1]), `lavozim ikkinchi qatorda: «${t[1]}»`);
  assert.ok(/^_+$/.test(t[2]), `imzo chizig'i uchinchi qatorda: «${t[2]}»`);
  // Muassasa va hujjat nomi MARKAZDA.
  assert.ok(paraOf(xml, "DARS ISHLANMASI").includes('<w:jc w:val="center"/>'), "hujjat nomi markazda emas");
  assert.ok(paraOf(xml, "DARS ISHLANMASI").includes("<w:b/>"), "hujjat nomi qalin emas");
});

test("shapka qatorlari: yorliq QALIN, qiymat oddiy («Fan: Biologiya»)", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("lesson"));
  const t = textNodes(xml);
  for (const [label, value] of [
    ["Fan:", "Biologiya"],
    ["Sinf:", "7-A"],
    ["Tuzuvchi:", "Karimova Dilnoza Baxtiyorovna"],
    ["Sana:", "16.09.2026"],
  ]) {
    const i = t.indexOf(label);
    assert.ok(i >= 0, `«${label}» yorlig'i yo'q`);
    assert.equal(t[i + 1], value, `«${label}» qiymati noto'g'ri`);
  }
  const p = paraOf(xml, "Fan:");
  assert.ok(p.includes("<w:b/>"), "yorliq qalin emas");
  assert.ok(p.indexOf("<w:b/>") < p.indexOf("Biologiya"), "qiymat ham qalin chiqdi");
});

test("test varag'ida o'quvchi maydoni: tagchiziqlar QISQARMAYDI (`cleanText` markdown deb o'qimasin)", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("test"));
  const t = textNodes(xml);
  const i = t.indexOf("F.I.Sh.");
  assert.ok(i >= 0, "o'quvchi maydoni yo'q");
  assert.equal(t[i + 1].length, 22, `F.I.Sh. chizig'i 22 belgi bo'lishi kerak: ${t[i + 1].length}`);
  assert.equal(t[i + 2], "Sinf");
  assert.equal(t[i + 3].length, 8, `sinf chizig'i 8 belgi bo'lishi kerak: ${t[i + 3].length}`);
  assert.ok(t.includes("Baho"), "«Baho» maydoni yo'q");
});

/* ══════════════════════════ sahifa ══════════════════════════ */

test("xarita ALBOM, qolgan to'rt vosita PORTRET; o'lcham A4", async () => {
  const map = (await xmlOf(sampleTeacherDoc("map"))).xml;
  assert.match(map, /w:orient="landscape"/, "texnologik xarita albom bo'lishi kerak");
  assert.match(map, /w:w="16838" w:h="11906"/, "A4 albom o'lchami");
  for (const kind of ["lesson", "glossary", "keys", "test"] as const) {
    const xml = (await xmlOf(sampleTeacherDoc(kind))).xml;
    assert.match(xml, /w:orient="portrait"/, `${kind} portret bo'lishi kerak`);
    assert.match(xml, /w:w="11906" w:h="16838"/, `${kind}: A4 portret o'lchami`);
  }
});

test("chegara `TEACHER_MARGINS_CM` dan — ko'ruvchi varag'i bilan BITTA manba", async () => {
  for (const kind of KINDS) {
    const { xml } = await xmlOf(sampleTeacherDoc(kind));
    const m = /<w:pgMar w:top="(\d+)" w:right="(\d+)" w:bottom="(\d+)" w:left="(\d+)"/.exec(xml);
    assert.ok(m, `${kind}: chegaralar topilmadi`);
    const want = TEACHER_MARGINS_CM[kind];
    assert.equal(Number(m![1]), Math.round(want.top * CM), `${kind}: yuqori chegara`);
    assert.equal(Number(m![2]), Math.round(want.right * CM), `${kind}: o'ng chegara`);
    assert.equal(Number(m![3]), Math.round(want.bottom * CM), `${kind}: past chegara`);
    assert.equal(Number(m![4]), Math.round(want.left * CM), `${kind}: chap chegara`);
  }
});

test("sahifa raqami pastda markazda; titul kolontituli KERAK EMAS", async () => {
  const { zip, xml } = await xmlOf(sampleTeacherDoc("glossary"));
  const footers = Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n));
  assert.equal(footers.length, 1, `titul beti yo'q — bitta kolontitul yetadi, topildi ${footers.length}`);
  const body = await zip.file(footers[0])!.async("string");
  assert.ok(body.includes("PAGE"), "sahifa raqami maydoni yo'q");
  assert.ok(body.includes('<w:jc w:val="center"/>'), "sahifa raqami markazda emas");
  assert.ok(!/<w:titlePg\s*\/>/.test(xml));
});

/* ══════════════════════════ sarlavha va tipografiya ══════════════════════════ */

test("bo'lim sarlavhasi CHAPDA, qalin, QORA va «Heading 1» uslubida", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("lesson"));
  const p = paraOf(xml, "Dars maqsadi");
  assert.ok(p.includes('<w:jc w:val="left"/>'), "o'qituvchi hujjatida sarlavha chapda turadi");
  assert.ok(p.includes("<w:b/>"), "sarlavha qalin emas");
  assert.ok(p.includes('w:val="000000"'), "sarlavha rangi aniq qora bo'lishi kerak (Word uslubi ko'k chizadi)");
  assert.ok(p.includes('w:val="Heading1"'), "«Heading 1» uslubi yo'q — Word mundarijasi ko'rmaydi");
  // BOSH HARFGA o'girilmaydi: rasmiy shaklda bo'lim nomlari oddiy yoziladi.
  assert.ok(textNodes(xml).includes("Dars maqsadi"), "sarlavha BOSH HARFGA aylantirilgan");
});

test("tipografiya: TNR, dars ishlanmasi 12 pt / 1,15 va HAR `w:line` bilan `lineRule=\"auto\"`", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("lesson"));
  assert.ok(xml.includes('w:ascii="Times New Roman"'), "Times New Roman yo'q");
  assert.ok(xml.includes('<w:sz w:val="24"/>'), "12 pt (24 yarim-punkt) yo'q");
  assert.ok(xml.includes('w:line="276"'), "1,15 interval (276) yo'q");
  const spacings = [...xml.matchAll(/<w:spacing[^>]*\/>/g)].map((m) => m[0]).filter((s) => s.includes("w:line="));
  assert.ok(spacings.length > 20, `sinov ma'noli bo'lishi uchun ko'p paragraf kerak (${spacings.length})`);
  assert.deepEqual(spacings.filter((s) => !s.includes('w:lineRule="auto"')), [], '`lineRule="auto"` siz `w:line` topildi');
});

/* ══════════════════════════ jadval ══════════════════════════ */

test("jadval: raqam TEPA O'NGDA `keepNext` bilan, `tblGrid` haqiqiy kenglikda, katak 10 pt", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("map"));
  const numberP = paraOf(xml, "1-jadval");
  assert.ok(numberP.includes('<w:jc w:val="right"/>'), "jadval raqami o'ngda emas");
  assert.ok(numberP.includes("<w:keepNext/>"), "raqam jadvaldan ajralib qolishi mumkin");
  assert.ok(xml.includes("<w:tblGrid>"), "`tblGrid` yo'q — LibreOffice ustunlarni teng chizadi");
  const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
  assert.equal(grid.length % 6, 0, `xarita jadvali 6 ustunli: ${grid.length}`);
  assert.ok(grid.every((w) => w > 400), `ustunlar haqiqiy kenglikda: ${grid.slice(0, 6)}`);
  assert.ok(grid[2] > grid[0] * 3, "«Mavzu» ustuni «Hafta» dan sezilarli keng");
  assert.ok(xml.includes('<w:tblLayout w:type="fixed"/>'));
  assert.equal(teacherProfile("map").tableSize, 20, "xarita katagi 10 pt");
});

test("dars ishlanmasi: vaqt jadvali bosqichlar NASRIDAN KEYIN, uyga vazifadan oldin", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("lesson"));
  const stages = posOf(xml, "Dars bosqichlari");
  const tableCap = posOf(xml, "Vaqt taqsimoti");
  const homework = posOf(xml, "Uyga vazifa");
  assert.ok(stages < tableCap, "vaqt jadvali bosqichlardan oldin chizilgan");
  assert.ok(tableCap < homework, "vaqt jadvali uyga vazifadan keyin qolib ketdi");
});

/* ══════════════════════════ test maketi ══════════════════════════ */

test("test: variantlar, KALIT va OMR varag'i YANGI BETDAN", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("test"));
  for (const head of ["Variant A", "Variant B", "Javoblar kaliti", "Javoblar varag‘i"]) {
    assert.ok(paraOf(xml, head).includes("<w:pageBreakBefore/>"), `«${head}» yangi betdan boshlanmadi`);
  }
  // Ko'rsatma birinchi bo'lim — u uzilish OLMAYDI (bo'sh bet qolmasin).
  assert.ok(!paraOf(xml, "Ko‘rsatma").includes("<w:pageBreakBefore/>"), "ko'rsatma sababsiz yangi betga ko'chdi");
});

test("test: javob varianti RO'YXAT BELGISIZ, harf matnning o'zida; kalit ustidagi ogohlantirish qalin", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("test"));
  const opt = paraOf(xml, "A) Tilakoid membranalarida");
  assert.ok(!opt.includes("<w:numPr>"), "javob varianti ro'yxat markeri bilan chizildi (ikkita marker bo'lardi)");
  assert.ok(opt.includes('<w:ind w:left="'), "javob varianti chekinishsiz");
  const note = paraOf(xml, "O‘QITUVCHI UCHUN — o‘quvchiga tarqatilmaydi");
  assert.ok(note.includes("<w:b/>"), "ogohlantirish qalin emas");
  const t = textNodes(xml);
  // Ochiq savol javobi — matnsiz chiziqlar (nuqtali chiziq matn tuguni bo'lib qolmasin).
  assert.ok(!t.some((x) => /^[.…]{4,}$/.test(x)), "javob chizig'i matn tuguni sifatida chizildi");
});

test("ochiq savol javobi: HAR chiziq alohida jadval qatori (paragraf chegaralari birlashib ketmasin)", async () => {
  /*
   * KO'Z TEKSHIRUVI topgan nuqson: pastki chegarali ketma-ket bo'sh
   * paragraflarni LibreOffice bitta blokka birlashtirib, chiziqni faqat
   * OXIRIDA chizardi — to'rt chiziq o'rniga bitta, ustida katta bo'sh
   * joy. Jadval qatorlari birlashmaydi.
   */
  const { xml } = await xmlOf(sampleTeacherDoc("test"));
  const open = xml.indexOf("Javobingizni asoslang.");
  assert.ok(open > 0, "ochiq savol topilmadi");
  const after = xml.slice(open, open + 6000);
  const tbl = after.indexOf("<w:tbl>");
  assert.ok(tbl >= 0 && tbl < after.indexOf("Variant B"), "javob chiziqlari jadval bilan chizilmadi");
  const block = after.slice(tbl, after.indexOf("</w:tbl>", tbl));
  assert.equal((block.match(/<w:tr>/g) ?? []).length, 4, "to'rtta javob chizig'i kutilgan");
  assert.ok(!/<w:t[ >]/.test(block), "javob chizig'i MATN tuguni qo'shdi (paritetga shovqin)");
});

test("kalit jadvali ustunlari ANIQ kenglikda — «Variant A» sarlavhasi sinmaydi", async () => {
  const { xml } = await xmlOf(sampleTeacherDoc("test"));
  // «Variant A» matni IKKI joyda: variant bo'limi sarlavhasida va kalit
  // jadvali ustunida — kerakligi ogohlantirishdan KEYINGISI.
  const after = posOf(xml, "O‘QITUVCHI UCHUN — o‘quvchiga tarqatilmaydi");
  const at = xml.indexOf(">Variant A<", after);
  assert.ok(at > 0, "kalit jadvalida variant ustuni yo'q");
  // Sarlavhadan OLDINGI eng yaqin `tblGrid` — aynan kalit jadvaliniki.
  const from = xml.lastIndexOf("<w:tblGrid>", at);
  assert.ok(from >= 0, "kalit jadvalining `tblGrid` i yo'q");
  const grid = xml.slice(from, xml.indexOf("</w:tblGrid>", from));
  const cols = [...grid.matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(cols.length, 6);
  // «№» eng tor, «Bloom» eng keng — teng taqsimotda sarlavha ikki qatorga sinardi.
  assert.ok(cols[0] < cols[1], "«№» ustuni variant ustunidan keng qolib ketdi");
  assert.ok(cols[4] > cols[1], "«Bloom» ustuni variant ustunidan tor");
});

/* ══════════════════════════ eski hujjat ══════════════════════════ */

function legacyLessonDoc(): AcademicDoc {
  const meta = {
    toolId: "lesson-plan",
    workLabel: "Dars rejasi",
    topic: "Kasrlar",
    language: "uz",
    subject: "Matematika",
    author: "A. Valiyev",
    university: "15-son maktab",
    grade: 5,
    duration: 45,
  } as unknown as DocMeta;
  return {
    meta,
    titlePage: true,
    toc: false,
    sections: [
      { id: "passport", title: "Dars pasporti", blocks: [{ kind: "p", text: "PASPORT-MATNI" }] },
      { id: "map", title: "Darsning texnologik xaritasi", blocks: [{ kind: "p", text: "XARITA-MATNI" }] },
    ],
    tables: [{ caption: "Vaqt taqsimoti", anchor: "map", headers: ["Bosqich", "Daqiqa", "Natija"], rows: [["Tashkiliy", "5", "QATOR"]] }],
  };
}

test("eski hujjat (`doc.teacher` yo'q): mazmun O'ZGARMAYDI, faqat titul beti o'rniga shapka", async () => {
  const { xml } = await xmlOf(legacyLessonDoc());
  const t = textNodes(xml);
  assert.equal(profileFor(legacyLessonDoc().meta).titlePage, "none");
  assert.ok(t.includes("15-son maktab"), "muassasa shapkada");
  assert.ok(t.includes("Tuzuvchi:") && t.includes("A. Valiyev"), "«Tuzuvchi» qatori");
  assert.ok(t.includes("PASPORT-MATNI") && t.includes("XARITA-MATNI"), "nasr yo'qoldi");
  const iMap = t.indexOf("XARITA-MATNI");
  const iRow = t.indexOf("QATOR");
  assert.ok(iRow > iMap, "langarlangan jadval o'z bo'limidan keyin qolishi kerak");
  assert.equal(t.filter((x) => x === "QATOR").length, 1, "jadval ikki marta chizildi");
  assert.ok(!t.some((x) => /VAZIRLIGI/.test(x)), "eski titul beti qoldi");
});

/* ══════════════════════════ LibreOffice (ixtiyoriy) ══════════════════════════ */

function sofficeReady(): boolean {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/** Beshala kind uchun kutilgan bet oralig'i — maket YIQILGANINI ushlaydi. */
const PAGE_RANGE: Record<(typeof KINDS)[number], [number, number]> = {
  lesson: [1, 4],
  map: [1, 4],
  glossary: [1, 4],
  keys: [1, 5],
  // Ko'rsatma + 2 variant + kalit + OMR — har biri o'z betidan.
  test: [4, 8],
};

test("LibreOffice: beshala namuna ochiladi, bet soni kutilgan oraliqda, xarita ALBOM", { skip: sofficeReady() ? false : "LibreOffice yo'q" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "teacher-docx-"));
  for (const kind of KINDS) {
    const src = join(dir, `${kind}.docx`);
    writeFileSync(src, Buffer.from(await renderDocx(sampleTeacherDoc(kind))));
    execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, src], { stdio: "ignore", timeout: 180_000 });
    const pdf = readdirSync(dir).find((f) => f === `${kind}.pdf`);
    assert.ok(pdf, `${kind}: PDF yaratilmadi`);
    const info = execFileSync("pdfinfo", [join(dir, pdf!)], { encoding: "utf8", timeout: 30_000 });
    const pages = Number(/Pages:\s*(\d+)/.exec(info)?.[1] ?? 0);
    const [min, max] = PAGE_RANGE[kind];
    assert.ok(pages >= min && pages <= max, `${kind}: ${min}–${max} bet kutilgan, chiqdi ${pages}`);
    const size = /Page size:\s*([\d.]+) x ([\d.]+)/.exec(info);
    assert.ok(size, `${kind}: bet o'lchami topilmadi`);
    const wide = Number(size![1]) > Number(size![2]);
    assert.equal(wide, kind === "map", `${kind}: yo'nalish noto'g'ri (${size![1]} x ${size![2]})`);
  }
});
