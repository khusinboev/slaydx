import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { buildEssayDoc } from "../../lib/generation/essay/engine.ts";
import { extractMeta } from "../../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../../lib/tools.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";


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

/** A handwritten ESSAY in the one Word viewer: the engine's text, the layout on doc.work, parity with the DOCX, no cover page. */
const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
const para = (tag: string, n: number) => `Bu ${tag} bandi asosiy fikrni aniq bayon qiladi va misol bilan asoslaydi. ${filler(n, tag)}.`;
const stub = (async (role: string, _system: string, user: string) => {
  if (role === "judge") return null;
  if (user.startsWith("Plan the essay")) {
    return { text: JSON.stringify({ thesisStatement: "Muntazam kitob o‘qish fikrlashni rivojlantiradi.", paragraphs: Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, role: i === 0 ? "intro" : i === 4 ? "conclusion" : "body", topicSentence: i > 0 && i < 4 ? `Bu band ${i} da’voni bayon qiladi.` : undefined, brief: `Band ${i + 1}`, words: 110 })) }) };
  }
  return { text: JSON.stringify({ blocks: [1, 2, 3, 4, 5].map((i) => ({ kind: "p", text: para(`band${i}`, 60) })) }) };
}) as never;

async function essayDoc(values: Record<string, string>): Promise<AcademicDoc> {
  const tool = TOOL_BY_ID.essay;
  const v = { topic: "Ona tilim — g‘ururim", pages: "2", essayContext: "school_dtm", essayKind: "reflective", language: "uz", design: "iris", ...values };
  const built = await buildEssayDoc(extractMeta(tool, v), v, { deadline: Date.now() + 90_000, complete: stub, judge: false, polish: false });
  assert.ok(built);
  return built.doc;
}

test("hand essay: one section under the title, no cover page, A5/A4 hand sheet; the plain essay has no doc.work", async () => {
  assert.equal((await essayDoc({})).work, undefined);
  const doc = await essayDoc({ workView: "hand", handFormat: "a5" });
  assert.equal(doc.titlePage, false);
  assert.equal(doc.work!.genre, "essay");
  const html = measureTree(doc);
  assert.ok(/class="[^"]*\bword-hand\b/.test(html.slice(0, 400)));
  assert.ok(html.includes("--hand-sheet-w:148.5mm"));
  const texts = htmlTexts(html);
  assert.ok(texts.includes(doc.sections[0]!.title), "the essay title is the page title");
  assert.equal(texts.filter((t) => t === doc.sections[0]!.title).length, 1, "the title is drawn once (no duplicate sub-heading)");
});

test("hand essay «ko'rdim = oldim»: viewer text equals DOCX text across layouts", async () => {
  const variants: Record<string, string>[] = [{ workView: "hand" }, { workView: "hand", handPaper: "grid", handCells: "1", handFormat: "a5x2", handMargin: "alternate" }, { workView: "hand", handPaper: "blank", handLively: "off" }];
  for (const values of variants) {
    const doc = await essayDoc(values);
    const view = htmlTexts(measureTree(doc)).join("").replace(/\s+/g, "");
    const file = docxTexts(await docxXml(doc)).join("").replace(/\s+/g, "");
    assert.ok(file.length > 400);
    assert.equal(view, file, JSON.stringify(values));
  }
});
