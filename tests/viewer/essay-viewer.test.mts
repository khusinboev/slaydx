import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { viewerKind } from "../../lib/viewers/kind.ts";
import { ESSAY_DESIGNS } from "../../lib/languages.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Insho ko'ruvchisi (AUDIT-19 WP-E1) — dvigatel almashdi, KO'RINISH esa
 * o'zgarmasligi kerak: `WordViewer` + `design` ramkasi, bitta bo'lim,
 * mundarijasiz. Yangisi — tahrir proplari (`ArtifactViewer case "essay"`).
 *
 * «Ko'rdim = oldim»: ramka sharti `render-docx.ts` dagi bilan bir xil
 * manbadan (`ESSAY_DESIGNS`, `meta.design`) — aks holda ekranda ramka
 * ko'rinib, yuklab olingan faylda bo'lmasdi.
 *
 * Mutatsiya: `ArtifactViewer` dan insho tahrir proplari olib tashlansa
 * oxirgi test qizaradi.
 */

const META = {
  topic: "Kitob o‘qishning foydasi",
  author: "N. Valiyeva",
  workLabel: "Insho",
  language: "uz",
  toolId: "essay",
  targetPages: 2,
  design: "nature",
} as unknown as DocMeta;

function essayDoc(over: Partial<DocMeta> = {}): AcademicDoc {
  return {
    meta: { ...META, ...over },
    titlePage: false,
    toc: false,
    sections: [
      {
        id: "essay",
        title: "Kitob o‘qishning foydasi",
        blocks: [
          { kind: "quote", text: "So‘z — qalb kaliti — Alisher Navoiy" },
          { kind: "p", text: "Kitob o‘qish tafakkurni kengaytiradi va nutqni boyitadi. ".repeat(4) },
          { kind: "p", text: "Ikkinchi band shaxsiy tajribamdan misol keltiradi. ".repeat(4) },
        ],
      },
    ],
    essay: {
      v: 1,
      context: "school_dtm",
      kind: "literary",
      language: "uz",
      words: { min: 368, max: 575, aim: 460 },
      paragraphs: [],
      rubric: "dtm24",
      design: "nature",
      workTitle: "O‘tkan kunlar",
      epigraph: { text: "So‘z — qalb kaliti", author: "Alisher Navoiy" },
    },
  };
}

const html = (doc: AcademicDoc) => renderToStaticMarkup(h(WordViewer, { doc }));

test("insho `design` ramkasi FAYLDA saqlanadi va rang `ESSAY_DESIGNS` dan (dvigatel almashdi — ko'rinish emas)", async () => {
  assert.equal(viewerKind("essay"), "essay", "insho o'z ko'ruvchi turida qoladi");

  const JSZip = (await import("jszip")).default;
  const { renderDocx } = await import("../../lib/generation/render-docx.ts");
  const border = async (doc: AcademicDoc) => {
    const zip = await JSZip.loadAsync(await renderDocx(doc));
    const xml = await zip.file("word/document.xml")!.async("string");
    return /<w:pgBorders[\s\S]*?w:color="([0-9a-fA-F]{6})"/.exec(xml)?.[1]?.toLowerCase() ?? null;
  };

  /*
   * Ramka — inshoning KO'RINADIGAN belgisi. Rang `design` dan olinadi,
   * qattiq yozilmaydi: aks holda 10 ta ramka o'rniga bittasi qolardi.
   * Yangi dvigatel `design` ni `meta` ga va `doc.essay` ga yozadi
   * (`extractMeta` + `EssayModel`) — shu qator uzilsa ramka yo'qolardi.
   */
  const hex = (v: string) => ESSAY_DESIGNS.find((d) => d.value === v)!.from.replace("#", "").toLowerCase();
  assert.equal(await border(essayDoc()), hex("nature"), "«nature» ramkasi faylga tushmadi");
  assert.equal(await border(essayDoc({ design: "iris" })), hex("iris"), "ikkinchi ramka rangi ham modeldan");

  // Insho bo'lmagan hujjatda ramka YO'Q (GOST 7.32 ramka talab qilmaydi).
  const referat = { ...essayDoc(), meta: { ...META, toolId: "referat" } as DocMeta };
  assert.equal(await border(referat), null, "ramka faqat inshoda");
});

test("insho bitta bo'limda chiziladi: mundarija yo'q, epigraf iqtibos bloki sifatida birinchi", () => {
  const doc = essayDoc();
  assert.equal(doc.sections.length, 1, "insho dvigateli bitta `essay` bo'limi beradi");
  assert.equal(doc.toc, false, "inshoda mundarija yo'q");

  const out = html(doc);
  assert.ok(out.includes("Kitob o‘qishning foydasi"), "sarlavha chizilishi kerak");
  assert.ok(out.includes("So‘z — qalb kaliti"), "epigraf ko'rinishi kerak");
  // Epigraf MATNDAN oldin: «ko'rdim = oldim» — DOCX da ham birinchi blok.
  assert.ok(out.indexOf("So‘z — qalb kaliti") < out.indexOf("tafakkurni kengaytiradi"), "epigraf matndan oldin turishi kerak");
  assert.ok(!/word-toc/.test(out), "mundarija chizilmasligi kerak");
});

test("`ArtifactViewer` insho uchun ham tahrir proplarini uzatadi (`useArticleEdit` `essay` ni biladi)", () => {
  const viewer = readFileSync(new URL("../../components/viewers/ArtifactViewer.tsx", import.meta.url), "utf8");
  /*
   * MUTATSIYA: `case "essay"` dagi proplar olib tashlansa (`<WordViewer
   * doc={doc} />`), ko'ruvchi tahrirni umuman yoqmasdi — server
   * (`essayAdapter`) tayyor bo'lsa ham tugma chiqmasdi.
   */
  assert.match(viewer, /case "essay":[\s\S]{0,400}?<WordViewer doc=\{doc\} gen=\{detail\} onGen=\{onDetail\} onEditState=\{onEditState\} \/>/, "insho tahrir proplarisiz");

  const hook = readFileSync(new URL("../../components/files/useArticleEdit.ts", import.meta.url), "utf8");
  assert.match(hook, /const ARTICLE_TOOLS = \["article", "thesis", "essay"\] as const;/, "tahrir hooki inshoni bilishi kerak");
});
