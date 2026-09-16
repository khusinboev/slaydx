import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { docToFlow } from "../../lib/viewers/flow.ts";
import { viewerKind } from "../../lib/viewers/kind.ts";
import { academicDocFromHtml } from "../../lib/viewers/from-html.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * ESKI O'QITUVCHI HUJJATI (`doc.teacher` yo'q) — AUDIT-20 WP-C, X-5.
 *
 * Bazadagi minglab dars rejasi / texnologik xarita / glossariy / keys
 * `doc_json` ida model yo'q. Ular ilgari O'Z ko'ruvchilarida
 * (`LessonViewer`/`TableViewer`/`GlossaryViewer`/`KeysViewer`)
 * ochilardi; o'sha to'rt ko'ruvchi O'CHIRILDI, ya'ni eski hujjat endi
 * `WordViewer` + `planTeacher` yo'lidan ochiladi.
 *
 * Bu fayl shuni qulflaydi: (1) hujjat ochiladi va MAZMUNI yo'qolmaydi,
 * (2) ko'ruvchi va DOCX baribir bir xil matn beradi, (3) modeldan
 * keladigan bandlar (maqsad, bosqich, kalit) O'YLAB TOPILMAYDI,
 * (4) HTML dan tiklangan (id siz) hujjat ham yiqilmaydi.
 */

const META = (toolId: string, over: Partial<DocMeta> = {}): DocMeta =>
  ({
    toolId,
    workLabel: "Hujjat",
    topic: "Kasrlar",
    language: "uz",
    subject: "Matematika",
    author: "A. Valiyev",
    university: "15-son maktab",
    grade: 5,
    duration: 45,
    weeklyHours: 2,
    totalHours: 68,
    ...over,
  }) as unknown as DocMeta;

/** Eski dars rejasi — `write-specials.ts lessonDoc` chiqaradigan shakl. */
function legacyLesson(): AcademicDoc {
  return {
    meta: META("lesson-plan"),
    titlePage: true,
    toc: false,
    sections: [
      { id: "passport", title: "Dars pasporti", blocks: [{ kind: "p", text: "Fan: Matematika. Sinf: 5. Davomiyligi: 45 daq." }, { kind: "p", text: "Maqsad: kasrlarni qo‘shishni o‘rgatish." }] },
      {
        id: "map",
        title: "Darsning texnologik xaritasi",
        blocks: [
          { kind: "h3", text: "1. Tashkiliy qism (5 daq)" },
          { kind: "p", text: "Sinf davomati tekshiriladi." },
          { kind: "h3", text: "Uyga vazifa" },
          { kind: "p", text: "5 ta misol yechish." },
        ],
      },
    ],
    tables: [
      {
        caption: "Vaqt taqsimoti",
        anchor: "map",
        widths: [42, 13, 45],
        headers: ["Bosqich", "Daqiqa", "Kutilgan natija"],
        rows: [["Tashkiliy qism", "5", "Darsga tayyorgarlik"], ["Yangi mavzu", "20", "Kasrlarni qo‘sha oladi"]],
      },
    ],
  };
}

/** Eski texnologik xarita — `mapDoc` shakli (jadval `passport` ga langarlangan). */
function legacyMap(): AcademicDoc {
  return {
    meta: META("texnologik-xarita"),
    titlePage: true,
    toc: false,
    sections: [{ id: "passport", title: "1. Fan pasporti", blocks: [{ kind: "p", text: "Fan: Matematika. Haftalik soat: 2." }] }],
    tables: [
      {
        caption: "O‘quv yili bo‘yicha taqsimot",
        anchor: "passport",
        headers: ["Hafta", "Soat", "Mavzu", "Metod", "Kutilgan natija", "Nazorat"],
        rows: [["1", "2", "Kirish", "Ma’ruza", "Tushunchani ayta oladi", "Og‘zaki so‘rov"]],
      },
    ],
  };
}

/** Eski glossariy — `glossaryDoc` shakli (atama `h3`, ta'rif `p`). */
function legacyGlossary(): AcademicDoc {
  return {
    meta: META("glossary", { topic: "Fizika" }),
    titlePage: true,
    toc: false,
    sections: [
      { id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "Glossariy fizika kursining asosiy atamalarini qamrab oladi." }] },
      { id: "atamalar", title: "Atamalar ro‘yxati", blocks: [{ kind: "h3", text: "Entropiya" }, { kind: "p", text: "Tartibsizlik o‘lchovi." }] },
    ],
  };
}

/** Eski keys — `keysDoc` shakli (har vaziyat alohida bo'lim). */
function legacyKeys(): AcademicDoc {
  return {
    meta: META("keys", { topic: "Pedagogika" }),
    titlePage: true,
    toc: false,
    sections: [
      { id: "kirish", title: "Kirish", blocks: [{ kind: "p", text: "Keys topshiriqlari seminar uchun." }] },
      {
        id: "keys1",
        title: "Keys 1. Sinfdagi nizo",
        blocks: [{ kind: "p", text: "Ikki o‘quvchi o‘rtasida nizo kelib chiqdi." }, { kind: "h3", text: "Topshiriqlar" }, { kind: "li", text: "Nizo sababini aniqlang." }],
      },
    ],
  };
}

const DOCS: [string, () => AcademicDoc][] = [
  ["dars rejasi", legacyLesson],
  ["texnologik xarita", legacyMap],
  ["glossariy", legacyGlossary],
  ["keys", legacyKeys],
];

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function htmlTexts(html: string): string[] {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<[^>]*>/)
    .map((t) => decode(t).trim())
    .filter((t) => t && t !== "•");
}

function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decode(m[1]).trim()).filter((t) => t && t !== "\t");
}

function viewerHtml(doc: AcademicDoc): string {
  const html = renderToStaticMarkup(h(WordViewer, { doc }));
  const i = html.lastIndexOf('<div aria-hidden="true"');
  assert.ok(i > 0, "o'lchov daraxti topilmadi");
  return html.slice(i);
}

/* ══════════════════════════ ochilish ══════════════════════════ */

test("beshala eski vosita `teacher` ko'ruvchisiga yo'naltiriladi (eski qiymatlar olib tashlandi)", () => {
  for (const id of ["lesson-plan", "texnologik-xarita", "glossary", "keys", "test"]) {
    assert.equal(viewerKind(id as never), "teacher", `${id}: ko'ruvchi turi`);
  }
});

for (const [name, make] of DOCS) {
  test(`eski ${name}: MAZMUNI to'liq ochiladi, brend-muqova va titul beti yo'q`, () => {
    const doc = make();
    const t = htmlTexts(viewerHtml(doc));
    // Nasr saqlanadi.
    for (const s of doc.sections) {
      if (s.title) assert.ok(t.includes(s.title.replace(/^\d+\.\s*/, "")) || t.includes(s.title), `«${s.title}» sarlavhasi yo'qoldi`);
      for (const b of s.blocks) assert.ok(t.includes(b.text), `«${b.text.slice(0, 30)}…» matni yo'qoldi`);
    }
    // Rasmiy shapka bor, titul betining vazirlik qatori yo'q.
    assert.ok(t.includes("15-son maktab"), "muassasa shapkada ko'rinmadi");
    assert.ok(t.includes("Tuzuvchi:") && t.includes("A. Valiyev"), "«Tuzuvchi» qatori yo'q");
    assert.ok(!t.some((x) => /VAZIRLIGI/.test(x)), "eski titul beti qoldi");
    assert.ok(!viewerHtml(doc).includes('class="h-[40mm]"'), "titul beti o'rni chizildi");
  });
}

test("eski hujjat: MODELDAN keladigan bandlar O'YLAB TOPILMAYDI", () => {
  const items = docToFlow(legacyLesson());
  const types = new Set(items.map((i) => i.type));
  assert.ok(!types.has("kv"), "eski dars rejasiga «Ta’limiy maqsad:» bandlari qo'shildi");
  assert.ok(!types.has("opt"), "eski hujjatga test javob variantlari qo'shildi");
  assert.ok(!types.has("note"), "eski hujjatga ogohlantirish qo'shildi");
  assert.ok(!types.has("teacher-approve"), "eski hujjatda «Tasdiqlayman» bo'lmagan — o'ylab topilmaydi");
  // Lekin shapka va jadval bor.
  assert.ok(types.has("teacher-org") && types.has("teacher-field"));
  assert.ok(types.has("table-head") && types.has("table-number"));
});

/* ══════════════════════════ paritet ══════════════════════════ */

for (const [name, make] of DOCS) {
  test(`eski ${name}: ko'ruvchi va DOCX matni bir xil (paritet legacy da ham)`, async () => {
    const doc = make();
    const zip = await JSZip.loadAsync(Buffer.from(await renderDocx(doc)));
    const fromDocx = docxTexts(await zip.file("word/document.xml")!.async("string"));
    assert.deepEqual(htmlTexts(viewerHtml(doc)), fromDocx);
  });
}

/* ══════════════════════════ chidamlilik ══════════════════════════ */

test("langarlangan jadval o'z bo'limidan keyin, BIR marta chiziladi", () => {
  const t = htmlTexts(viewerHtml(legacyLesson()));
  const i = t.indexOf("5 ta misol yechish.");
  const row = t.indexOf("Darsga tayyorgarlik");
  assert.ok(i > 0 && row > i, "jadval o'z bo'limidan keyin turishi kerak");
  assert.equal(t.filter((x) => x === "Darsga tayyorgarlik").length, 1, "jadval ikki marta chizildi");
});

test("HTML dan tiklangan hujjat (NOMA'LUM id lar `s0`, `s1`) ham yiqilmaydi", () => {
  /*
   * `academicDocFromHtml` bo'limlarga `s0`, `s1` … id beradi — ular
   * reyestrdagi id lar («passport», «stages») emas. `planTeacher`
   * shunda ham hujjatni TARTIB bilan chizishi kerak: sarlavha
   * `section.title` dan, biriktirma esa yo'q.
   */
  const doc: AcademicDoc = {
    meta: META("lesson-plan"),
    titlePage: true,
    toc: false,
    sections: [
      { id: "s0", title: "Dars pasporti", blocks: [{ kind: "p", text: "Matn bir." }] },
      { id: "s1", title: "Xarita", blocks: [{ kind: "p", text: "Matn ikki." }] },
    ],
  };
  const items = docToFlow(doc);
  const t = items.map((i) => ("text" in i ? i.text : "")).filter(Boolean);
  assert.ok(t.includes("Matn bir.") && t.includes("Matn ikki."), `matn yo'qoldi: ${t.join(" | ")}`);
  assert.ok(t.includes("Dars pasporti") && t.includes("Xarita"), "noma'lum id li bo'lim sarlavhasi yo'qoldi");
  assert.ok(items.some((i) => i.type === "teacher-title"), "shapka chizilmadi");
});

test("`academicDocFromHtml` bilan qurilgan bo'sh hujjat ham `teacher` yo'lidan o'tadi", () => {
  const gen = { type: "lesson-plan", topic: "Kasrlar", values: {}, html: "" };
  const doc = academicDocFromHtml("", gen as never);
  assert.equal(viewerKind(doc.meta.toolId), "teacher");
  const items = docToFlow(doc);
  assert.ok(items.some((i) => i.type === "teacher-title"), "shapka chizilmadi");
});

test("bo'sh hujjat (bo'limsiz) — xato tashlamaydi, shapka baribir chiziladi", () => {
  const doc: AcademicDoc = { meta: META("keys"), titlePage: true, toc: false, sections: [] };
  const items = docToFlow(doc);
  assert.ok(items.some((i) => i.type === "teacher-title"));
  assert.ok(!items.some((i) => i.type === "h1"));
});
