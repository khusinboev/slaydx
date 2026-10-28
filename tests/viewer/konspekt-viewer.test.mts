import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { buildKonspektDoc } from "../../lib/generation/konspekt/index.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";


/** Konspekt in the one Word viewer: the measure tree and the DOCX carry the same text; no cover/contents/references. */
const META = { topic: "Davlatchilik tarixi", workLabel: "Konspekt", language: "uz", toolId: "konspekt" } as unknown as DocMeta;
const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i % 5}`).join(" ");

async function konspektDoc(values: Record<string, string> = {}): Promise<AcademicDoc> {
  const fn = (async (_r: string, _s: string, user: string) => {
    const usage = { provider: "stub", model: "stub", inputTokens: 1, outputTokens: 1 };
    if (user.includes("Plan the notes")) return { text: JSON.stringify({ sections: Array.from({ length: 5 }, (_, i) => ({ title: `Bo‘lim ${i + 1}`, brief: "x", words: 200 })) }), usage };
    return { text: JSON.stringify({ blocks: [{ kind: "p", text: words(120, "fakt") }, { kind: "li", text: words(15, "sana") }] }), usage };
  }) as never;
  const r = await buildKonspektDoc(META, { topic: "Davlatchilik tarixi", pages: "5-10", ...values }, { deadline: Date.now() + 90_000, complete: fn });
  assert.ok(r);
  return r.doc;
}

const decode = (s: string) =>
  s.replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCodePoint(parseInt(c, 16))).replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c))).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function htmlTexts(html: string): string[] {
  return html.replace(/<!--[\s\S]*?-->/g, "").split(/<[^>]*>/).map((t) => decode(t).trim()).filter((t) => t && t !== "•");
}
function docxTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decode(m[1]!).trim()).filter((t) => t && t !== "\t");
}
const docxXml = async (doc: AcademicDoc) => (await JSZip.loadAsync(Buffer.from(await renderDocx(doc)))).file("word/document.xml")!.async("string");
function measureTree(doc: AcademicDoc): string {
  const html = renderToStaticMarkup(h(WordViewer, { doc }));
  const i = html.lastIndexOf('<div aria-hidden="true"');
  assert.ok(i > 0, "o'lchov daraxti topilmadi");
  return html.slice(i);
}

test("konspekt: viewer measure tree is a hand sheet with the A5 page, carries the title and sub-headings, no contents/references", async () => {
  const doc = await konspektDoc();
  const html = measureTree(doc);
  assert.ok(/class="[^"]*\bword-hand\b/.test(html.slice(0, 400)));
  assert.ok(html.includes("--hand-sheet-w:148.5mm"), "A5 page in the viewer (two-up is only the export wrapper)");
  const texts = htmlTexts(html);
  assert.ok(texts.includes("Davlatchilik tarixi"), "title");
  assert.ok(texts.includes("Bo‘lim 1") && texts.includes("Bo‘lim 5"), "sub-headings in plain case");
  assert.ok(!texts.some((t) => /^(MUNDARIJA|Mundarija|KIRISH|Kirish|XULOSA|Xulosa)$/.test(t)));
});

test("konspekt «ko'rdim = oldim»: the viewer text equals the DOCX text (alternating margin, 1-cell rows, lively words)", async () => {
  const variants: Record<string, string>[] = [{}, { handPaper: "blank", handFormat: "a5" }, { handFormat: "a4", handCells: "2", handLively: "off" }];
  for (const values of variants) {
    const doc = await konspektDoc(values);
    const view = htmlTexts(measureTree(doc)).join("").replace(/\s+/g, "");
    const file = docxTexts(await docxXml(doc)).join("").replace(/\s+/g, "");
    assert.ok(file.length > 500);
    assert.equal(view, file, JSON.stringify(values));
  }
});
