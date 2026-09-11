import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { docToFlow, titleModel } from "../../lib/viewers/flow.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * ESKI maqolalar — Maqola 2 dan oldin yaratilgan `doc_json` (`doc.article`
 * YO'Q, titul sahifali, mundarijali, jadval oxirida). Bazadagi minglab
 * qator shunday. Ko'ruvchi ham, DOCX ham ularni AVVALGIDEK ochishi shart:
 * bu test aynan eski yo'lning o'zgarmaganini qulflaydi.
 */

const META: DocMeta = {
  topic: "Raqamli ta’lim",
  author: "Aliyev Ali",
  workLabel: "Maqola",
  language: "uz",
  toolId: "article",
  kind: "standard",
  organization: "TDIU",
  email: "a@b.uz",
  degree: "PhD",
  city: "Toshkent",
  year: 2025,
} as unknown as DocMeta;

function legacyDoc(): AcademicDoc {
  return {
    meta: META,
    titlePage: true,
    toc: true,
    sections: [
      { id: "s1", title: "Kirish", blocks: [{ kind: "p", text: "Eski matn [1]." }, { kind: "h2", text: "Ostmavzu" }, { kind: "p", text: "Davomi." }] },
      { id: "s2", title: "Xulosa", blocks: [{ kind: "p", text: "Tamom [2]." }] },
    ],
    tables: [{ caption: "Eski jadval", headers: ["A", "B"], rows: [["1", "2"]], anchor: "s1" }],
    references: ["Birinchi manba. — T., 2020.", "Second source, 2021."],
    referencesNote: "Bu ro‘yxat tekshirilmagan.",
    abstracts: [{ lang: "uz", label: "Annotatsiya", text: "Qisqa annotatsiya.", keywords: "a, b" }],
  } as unknown as AcademicDoc;
}

test("oqim: titul → mundarija → annotatsiya (eski shakl) → bo'limlar → jadval oxirida → adabiyotlar", () => {
  const items = docToFlow(legacyDoc());
  assert.deepEqual(
    items.map((it) => it.type),
    ["title", "toc", "abstract", "h1", "p", "h2", "p", "h1", "p", "table-head", "table-row", "h1", "refNote", "ref", "ref"],
  );
  const abs = items.find((it) => it.type === "abstract");
  assert.ok(abs && abs.type === "abstract" && !abs.inline && !abs.keywordsLabel, "eski annotatsiya inline bo'lmasligi kerak");
  const p = items.find((it) => it.type === "p");
  assert.ok(p && p.type === "p" && p.text === "Eski matn [1]." && !p.spans, "eski matn o'zgarmasligi, iqtibos bo'laklari bo'lmasligi kerak");
  const ref = items.find((it) => it.type === "ref");
  assert.ok(ref && ref.type === "ref" && ref.line === undefined && ref.n === 1);
  const th = items.find((it) => it.type === "table-head");
  assert.ok(th && th.type === "table-head" && !th.captionAlign && th.table.caption === "Eski jadval");
});

test("titul modeli `kind: article` bo'lib qoladi (muallif bloki, vazirlik emas)", () => {
  const T = titleModel(legacyDoc());
  assert.equal(T.kind, "article");
  if (T.kind === "article") {
    assert.equal(T.authorLine, "Aliyev Ali, PhD");
    assert.equal(T.organization, "TDIU");
    assert.equal(T.cityYear, "Toshkent — 2025");
  }
});

test("ko'ruvchi: eski maqola `.word-article` siz, sarlavha BOSH HARF (CSS), annotatsiya eski shaklda, KaTeX yo'q", () => {
  const out = renderToStaticMarkup(h(WordViewer, { doc: legacyDoc() }));
  assert.ok(!out.includes("word-article"), "eski maqola yangi varaq sinfiga o'tib ketdi");
  assert.ok(!out.includes("word-udk") && !out.includes("word-cite") && !out.includes("katex"));
  assert.ok(out.includes('<div class="word-h1">Annotatsiya</div>'), "eski annotatsiya sarlavhasi yo'q");
  assert.ok(out.includes("Kalit so‘zlar: a, b") || out.includes("Kalit so‘zlar<!-- -->: <!-- -->a, b"), "eski kalit so'zlar qatori");
  assert.ok(out.includes('<div class="word-h1">Kirish</div>'));
  assert.ok(out.includes("1. Birinchi manba") || out.includes("1<!-- -->. <!-- -->Birinchi manba"));
  // O'lchov daraxti eski qat'iy o'lchamlarda (165 mm, 14 pt, 1.5).
  assert.ok(out.includes("w-[165mm]") && out.includes("text-[14pt]"));
});

test("DOCX: eski maqola titul + mundarija + BOSH HARFLI sarlavha + jadval oxirida — avvalgidek", async () => {
  const bytes = await renderDocx(legacyDoc());
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  const t = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1].trim()).filter(Boolean);
  assert.equal(t[0], "MAQOLA", "titul birinchi bo'lishi kerak");
  assert.ok(t.includes("«Raqamli ta’lim»"));
  assert.ok(t.includes("Aliyev Ali, PhD") && t.includes("TDIU") && t.includes("Toshkent — 2025"));
  assert.ok(t.includes("MUNDARIJA"));
  assert.ok(t.includes("KIRISH") && t.includes("XULOSA"));
  assert.ok(t.includes("Kalit so‘zlar: a, b"));
  assert.ok(t.includes("Bu ro‘yxat tekshirilmagan."));
  assert.ok(t.includes("1. Birinchi manba. — T., 2020."));
  assert.ok(!t.some((s) => s.startsWith("UDK")), "eski maqolada UDK yo'q");
  assert.ok(!xml.includes("<m:oMath>"));
  assert.ok(xml.indexOf("<w:tbl>") > xml.indexOf(">Tamom [2].<"), "jadval oxirida (eski `tablePlacement: end`)");
  assert.ok(xml.includes("<w:titlePg/>"));
  // Eski profil: 14 pt, chegara 2/1.5/2/3 sm.
  assert.ok(xml.includes('<w:pgMar w:top="1134" w:right="851" w:bottom="1134" w:left="1701"'));
});
