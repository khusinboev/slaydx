import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import JSZip from "jszip";
import { WordViewer } from "../../components/viewers/WordViewer.tsx";
import { HandCover } from "../../components/viewers/TitlePage.tsx";
import { renderDocx } from "../../lib/generation/render-docx.ts";
import { planWork } from "../../lib/generation/work/layout.ts";
import { sampleWorkDoc } from "../../lib/generation/work/samples.ts";
import { titleModel } from "../../lib/generation/title-model.ts";
import { handCoverLines, handCssVars, handGeometry, handStyleOf, HAND_INK_HEX, type WorkHand } from "../../lib/generation/work/handwriting.ts";
import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Qo'lyozma mustaqil ish — KO'RUVCHI (Program 17 band 10): uslub o'zgaruvchilari
 * varaqqa yetib boradi, matn DOCX bilan bir xil («ko'rdim = oldim»), muqova
 * `handCoverLines` dan, CSS qoidalari mavjud.
 */

const META = { topic: "Oliy ta’limda adaptiv o‘qitish", workLabel: "Mustaqil ish", language: "uz", toolId: "mustaqil-ish" } as unknown as DocMeta;

function handDoc(hand: WorkHand = { ink: "blue", paper: "lined", font: "badscript" }): AcademicDoc {
  const doc = sampleWorkDoc(META, { genre: "independent", kind: "written" });
  doc.work!.hand = hand;
  doc.sections.find((s) => s.id === "ch1.1")!.blocks.push({ kind: "p", text: "Oʻzbek gʻoyasi [u1]." });
  return doc;
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
const fromToc = (list: string[]) => list.slice(list.indexOf("MUNDARIJA"));

test("qo'lyozma: o'lchov daraxti `word-hand` sinfi va --hand-* o'zgaruvchilarni oladi (siyoh, shrift, qator oralig'i, kenglik)", () => {
  const html = measureTree(handDoc({ ink: "purple", paper: "grid", font: "caveat" }));
  const g = handGeometry("grid", "caveat");
  assert.ok(/class="[^"]*\bword-hand\b/.test(html.slice(0, 400)), "word-hand sinfi");
  assert.ok(html.includes(`--hand-ink:#${HAND_INK_HEX.purple}`), "siyoh");
  assert.ok(html.includes("--hand-family:&quot;Caveat&quot;"), "shrift");
  assert.ok(html.includes(`--hand-pitch:${g.pitchPx}px`), "qator oralig'i");
  assert.ok(html.includes(`width:${(g.contentTw / 1440) * 25.4}mm`), "o'lchov kengligi daftar chegarasidan");
  assert.ok(html.includes("line-height:var(--hand-pitch)"));
});

test("oddiy mustaqil ish: `word-hand` YO'Q (regressiya)", () => {
  const doc = handDoc();
  delete doc.work!.hand;
  const html = renderToStaticMarkup(h(WordViewer, { doc }));
  assert.ok(!html.includes("word-hand") && !html.includes("--hand-"));
});

test("«ko'rdim = oldim»: qo'lyozma ko'ruvchi matni DOCX matniga AYNAN teng (mundarijadan boshlab; `ʻ` → `‘` ikkala tomonda)", async () => {
  for (const hand of [{ ink: "blue", paper: "lined", font: "badscript" }, { ink: "black", paper: "grid", font: "caveat" }] as WorkHand[]) {
    const doc = handDoc(hand);
    const view = fromToc(htmlTexts(measureTree(doc)));
    const file = fromToc(docxTexts(await docxXml(doc)));
    assert.ok(file.length > 40);
    assert.deepEqual(view, file);
    assert.ok(file.some((t) => t.includes("O‘zbek g‘oyasi")), "‘ ga almashgan");
  }
});

test("rasm o'rniga ramka va formula oddiy matn: ko'ruvchida <img> ham KaTeX ham yo'q", () => {
  const doc = handDoc();
  doc.work!.figures[0]!.url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const html = measureTree(doc);
  assert.ok(!/<img\b/.test(html), "rasm chizilmaydi");
  assert.ok(html.includes("word-figure-placeholder") && html.includes("[2.1-rasm]"));
  assert.ok(!html.includes("data-formula") && !html.includes("katex"), "KaTeX yo'q");
  assert.ok(html.includes("Δ = (x̄₂ - x̄₁)/(x̄₁) · 100%"));
});

test("muqova: `HandCover` qatorlari `handCoverLines` dan va DOCX muqovasi bilan bir xil matn", async () => {
  const doc = handDoc();
  const T = titleModel(doc);
  assert.equal(T.kind, "gost");
  if (T.kind !== "gost") return;
  const html = renderToStaticMarkup(h(HandCover, { title: T, font: "badscript" }));
  const view = htmlTexts(html).map((t) => t.replace(/:$/, ""));
  const expected = handCoverLines(T).flatMap((l) => (l.role === "gap" ? [] : l.role === "center" ? [l.text] : [...(l.label ? [l.label] : []), l.text]));
  assert.deepEqual(view, expected);
  assert.ok(!html.includes(T.ministry[0]!), "rasmiy vazirlik qatori yo'q");
  const file = docxTexts(await docxXml(doc));
  const head = file.slice(0, file.indexOf("MUNDARIJA")).map((t) => t.replace(/:$/, "")).filter((t) => t !== "");
  assert.deepEqual(head, expected, "DOCX muqovasi ham xuddi shu qatorlar");
});

test("CSS: `.word-hand` qoidalari mavjud (fon chiziqlari, shrift, qator oralig'i, jadval, rasm ramkasi) va o'zgaruvchilar handCssVars dagilarga mos", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  for (const needle of [".word-sheet.word-hand", ".word-sheet.word-hand--grid", ".word-hand .word-p", ".word-hand .word-table", ".word-hand .word-figure-placeholder", "repeating-linear-gradient(to bottom", ".hand-preview"]) {
    assert.ok(css.includes(needle), `globals.css da «${needle}» yo'q`);
  }
  // CSS o'qigan HAR `--hand-*` o'zgaruvchi `handCssVars` da e'lon qilingan (jim bo'sh qiymat bo'lmasin).
  const used = new Set([...css.matchAll(/var\((--hand-[a-z0-9-]+)\)/g)].map((m) => m[1]!));
  const declared = new Set(Object.keys(handCssVars(handStyleOf({ ink: "blue", paper: "lined", font: "badscript" }))));
  declared.add("--hand-vlines"); // CSS o'zi e'lon qiladi (`.word-sheet.word-hand`)
  const undeclared = [...used].filter((v) => !declared.has(v));
  assert.deepEqual(undeclared, [], `CSS e'lon qilinmagan o'zgaruvchi o'qiydi: ${undeclared.join(", ")}`);
});

test("planWork: ko'ruvchi varag'i uchun uslub reja bilan keladi", () => {
  const plan = planWork(handDoc());
  assert.equal(plan.style?.kind, "handwritten");
});
