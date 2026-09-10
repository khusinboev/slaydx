import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { parsePptxTemplate } from "../lib/generation/pptx-template.ts";
import { contentOf, renderPptxWithTemplate, roleFor, xmlEscape } from "../lib/generation/render-pptx-template.ts";
import { sampleDeck } from "../lib/generation/slide-samples.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * «O'z shablonim» — OOXML yozuvchisi (Sprint B, B2).
 *
 * Fikstura: pptxgenjs bilan ikki master (muqova: ctrTitle+subTitle uslubidagi
 * title+body; mazmun: title+body). Yozuvchi eski slaydlarni olib tashlab,
 * dekani placeholder'larga yozadi; natija JSZip bilan qayta o'qiladi va
 * (mavjud bo'lsa) LibreOffice bilan PDF ga o'girilib sahifa soni tekshiriladi.
 */
const run = promisify(execFile);
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function fixture(): Promise<Uint8Array> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";
  pptx.defineSlideMaster({
    title: "COVER",
    background: { color: "0B1F3A" },
    objects: [
      { placeholder: { options: { name: "t", type: "title", x: 0.8, y: 2.2, w: 11.7, h: 1.6, color: "FFFFFF", fontSize: 40 }, text: "Sarlavha" } },
      { placeholder: { options: { name: "s", type: "body", x: 0.8, y: 4.0, w: 11.7, h: 1.0, color: "C9A227", fontSize: 18 }, text: "Izoh" } },
    ],
  });
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "F7F4EC" },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333, h: 0.3, fill: { color: "C9A227" } } },
      { placeholder: { options: { name: "t", type: "title", x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 28 }, text: "Sarlavha" } },
      { placeholder: { options: { name: "b", type: "body", x: 0.7, y: 1.7, w: 11.9, h: 4.9, fontSize: 18 }, text: "Matn" } },
    ],
  });
  pptx.addSlide({ masterName: "COVER" }).addText("Eski muqova", { placeholder: "t" });
  pptx.addSlide({ masterName: "CONTENT" }).addText("Eski mazmun", { placeholder: "t" });
  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return new Uint8Array(buf);
}

function docOf(): AcademicDoc {
  const meta = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Fotosintez", slideCount: 9, speakerNotes: true } as never);
  return { meta, titlePage: false, toc: false, sections: [], slides: sampleDeck("lecture"), slideTemplate: "lecture" } as AcademicDoc;
}

test("namuna master/layoutlari saqlanadi, eski slaydlar ketadi, har SlideModel placeholder'li slaydga aylanadi", async () => {
  const tpl = await fixture();
  const profile = await parsePptxTemplate(tpl);
  const out = await renderPptxWithTemplate(docOf(), "namuna.pptx", tpl, profile, {
    resolveImage: async () => ({ data: PNG_1PX, type: "png" }),
  });
  assert.equal(out.fileName, "namuna.pptx");
  const zip = await JSZip.loadAsync(out.bytes);
  const names = Object.keys(zip.files);
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slides.length, 9, "deka 9 slayd");
  for (const p of [profile.masterPath, profile.themePath!, ...profile.layouts.map((l) => l.path)]) assert.ok(zip.file(p), `${p} saqlanishi kerak`);

  assert.notEqual(profile.roles.cover, profile.roles.content, "ikki content layout: muqova va mazmun har xil layoutda");
  const rels4 = await zip.file("ppt/slides/_rels/slide4.xml.rels")!.async("string");
  const rels1b = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  assert.notEqual(rels4.match(/slideLayout\d+/)?.[0], rels1b.match(/slideLayout\d+/)?.[0], "bandlar slaydi mazmun layoutida");
  const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
  assert.ok(s1.includes("Fotosintez jarayoni va uning bosqichlari"), "titul matni");
  assert.ok(!s1.includes("Eski muqova"), "eski slayd matni yo'q");
  assert.match(s1, /<p:ph type="(title|ctrTitle)"/, "sarlavha placeholder orqali — uslub layoutdan meros");
  assert.ok(!/<a:rPr[^>]*sz=/.test(s1), "shrift o'lchami YOZILMAYDI — namunaniki");
  assert.ok(s1.includes("<a:normAutofit/>"), "sig'masa shrift kichrayadi");

  const s4 = await zip.file("ppt/slides/slide4.xml")!.async("string");
  assert.ok(s4.includes("Xlorofill"), "bandlar matni");
  assert.ok((s4.match(/<a:p>/g) ?? []).length >= 4, "bandlar alohida abzaslar");

  const rels1 = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  assert.match(rels1, /slideLayouts\/slideLayout\d+\.xml/, "slayd o'z layoutiga bog'langan");
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  assert.equal((ct.match(/PartName="\/ppt\/slides\/slide\d+\.xml"/g) ?? []).length, 9, "content types 9 slayd");
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  assert.equal((pres.match(/<p:sldId /g) ?? []).length, 9, "sldIdLst 9 ta");
  const presRels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const slideRels = presRels.match(/Type="[^"]*\/relationships\/slide"/g) ?? [];
  assert.equal(slideRels.length, 9, "presentation rels 9 slayd");
  const ids = Array.from(presRels.matchAll(/Id="(rId\d+)"/g)).map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "rId lar takrorlanmaydi");
  const sldRIds = Array.from(pres.matchAll(/<p:sldId [^>]*r:id="(rId\d+)"/g)).map((m) => m[1]);
  for (const r of sldRIds) assert.ok(presRels.includes(`Id="${r}"`), `${r} rels da bor`);

  assert.ok(names.some((n) => /^ppt\/notesSlides\/notesSlide1\.xml$/.test(n)), "notiq izohi yoziladi");
  assert.ok(!names.some((n) => /^ppt\/media\/slaydx-/.test(n)), "pic placeholder yo'q → rasm YOZILMAYDI");
  for (const n of slides) assert.ok((await zip.file(n)!.async("string")).startsWith("<?xml"), n);
});

test("xmlEscape va rol/mazmun xaritasi", () => {
  assert.equal(xmlEscape('A & B <c> "d"'), "A &amp; B &lt;c&gt; &quot;d&quot;");
  assert.equal(xmlEscape("ab"), "ab");
  const roles = { cover: "c", content: "k", two: "t", picture: "p", section: "s" };
  assert.equal(roleFor("title", false, roles), "cover");
  assert.equal(roleFor("closing", true, roles), "cover");
  assert.equal(roleFor("section", false, roles), "section");
  assert.equal(roleFor("section", false, { cover: "c" }), "cover", "section layout yo'q → muqova");
  assert.equal(roleFor("twoCol", false, roles), "two");
  assert.equal(roleFor("twoCol", false, { content: "k" }), "content");
  assert.equal(roleFor("bullets", true, roles), "picture");
  assert.equal(roleFor("bullets", false, roles), "content");
  assert.equal(roleFor("stats", true, roles), "content");
  const two = contentOf({ id: "x", layout: "twoCol", title: "T", leftTitle: "L", left: ["a"], rightTitle: "R", right: ["b"] });
  assert.equal(two.bodies.length, 2);
  assert.deepEqual(two.bodies[0][0], { text: "L", bold: true });
  const st = contentOf({ id: "x", layout: "stats", title: "T", stats: [{ value: "95%", label: "qoniqish" }] });
  assert.equal(st.bodies[0][0].text, "95% — qoniqish");
  const tb = contentOf({ id: "x", layout: "table", title: "T", table: { headers: ["a"], rows: [["1"]] } });
  assert.ok(tb.table);
});

test("LibreOffice chiqqan faylni ochadi va PDF sahifa soni slaydlar soniga teng", { skip: !existsSync("/usr/bin/soffice") || !existsSync("/usr/bin/pdfinfo") }, async () => {
  const tpl = await fixture();
  const profile = await parsePptxTemplate(tpl);
  const out = await renderPptxWithTemplate(docOf(), "namuna.pptx", tpl, profile);
  const dir = await mkdtemp(join(tmpdir(), "slaydx-tpl-"));
  const src = join(dir, "namuna.pptx");
  await writeFile(src, out.bytes);
  await run("soffice", ["--headless", "--norestore", `-env:UserInstallation=file://${join(dir, "profile")}`, "--convert-to", "pdf", "--outdir", dir, src], { timeout: 180_000 });
  const { stdout } = await run("pdfinfo", [join(dir, "namuna.pdf")]);
  const pages = Number(stdout.match(/Pages:\s+(\d+)/)?.[1]);
  assert.equal(pages, 9, `PDF sahifalari: ${pages}`);
  assert.ok((await readFile(join(dir, "namuna.pdf"))).length > 5000);
});
