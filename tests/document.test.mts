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
