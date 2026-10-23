import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { convertDocx, convertPptx, convertTxt, NotTextError } from "../lib/translit/files.ts";
import { makeDocx, makePptx } from "./helpers/office-fixtures.ts";

/**
 * Script conversion of DOCX / PPTX / TXT in place (owner request 6). Pure (no DB, no LibreOffice).
 *
 * Mutations (restored): `mapTextNodes` writing the text without `xmlEscape` -> «xml special characters»;
 * `WORD_PARTS` without headers -> «header and footer»; regexp `<w:t` without the `\s` guard (matches `<w:tab/>`) -> «w:tab».
 */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

const DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Ўзбекистон шаҳарлари</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Тошкент — </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>пойтахт</w:t></w:r><w:r><w:tab/><w:t>чой &amp; нон &lt;5&gt; "ёки"</w:t></w:r></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://kitob.uz/ёзги" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>https://kitob.uz/ёзги</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Шаҳар</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Аҳоли</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t/></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body></w:document>`;

const HEADER_XML = `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>Ҳисобот саҳифаси</w:t></w:r></w:p></w:hdr>`;
const STYLES = `<?xml version="1.0"?><w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="Ҳeading 1"/></w:style></w:styles>`;
const MEDIA = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 0xd0, 0xcf, 0x11]);

async function handDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("word/document.xml", DOC_XML);
  zip.file("word/header1.xml", HEADER_XML);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/media/image1.png", MEDIA);
  return zip.generateAsync({ type: "uint8array" });
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("|");

test("DOCX cyr -> lat: text converted, structure byte-identical", async () => {
  const src = await handDocx();
  const out = await convertDocx(src, "cyr", "lat");
  assert.equal(out.nodes, 8, "7 in the body + 1 in the header");
  assert.ok(out.changed >= 6);
  const before = await JSZip.loadAsync(src);
  const after = await JSZip.loadAsync(out.bytes);
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort(), "same archive entries");

  const doc = await after.file("word/document.xml")!.async("string");
  const was = await before.file("word/document.xml")!.async("string");
  assert.equal(count(doc, /<w:p[ >]/g), count(was, /<w:p[ >]/g), "paragraph count");
  assert.equal(count(doc, /<w:r>/g), count(was, /<w:r>/g), "run count");
  assert.equal(count(doc, /<w:rPr>/g), count(was, /<w:rPr>/g), "run formatting blocks");
  assert.ok(doc.includes("<w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr>"), "bold/size kept verbatim");
  assert.ok(doc.includes("<w:rPr><w:i/></w:rPr>"), "italic kept");
  assert.ok(doc.includes('<w:pStyle w:val="Heading1"/>'), "paragraph style kept");
  assert.ok(doc.includes('<w:t xml:space="preserve">'), "xml:space kept");
  assert.ok(doc.includes("<w:tab/>"), "w:tab is not touched");
  assert.ok(doc.includes("<w:t/>"), "empty self-closed w:t is not touched");
  assert.ok(doc.includes('<w:pgSz w:w="11906" w:h="16838"/>'), "page setup kept");

  assert.equal(textOf(doc), 'Oʻzbekiston shaharlari|Toshkent — |poytaxt|choy &amp; non &lt;5&gt; &quot;yoki&quot;|https://kitob.uz/ёзги|Shahar|Aholi');
  assert.ok(doc.includes('HYPERLINK "https://kitob.uz/ёзги"'), "field instructions are not converted");
});

test("DOCX: header and footer parts are converted; styles and media are byte-identical", async () => {
  const src = await handDocx();
  const out = await convertDocx(src, "cyr", "new");
  const before = await JSZip.loadAsync(src);
  const after = await JSZip.loadAsync(out.bytes);
  assert.equal(textOf(await after.file("word/header1.xml")!.async("string")), "Hisobot sahifasi");
  assert.equal(await after.file("word/styles.xml")!.async("string"), await before.file("word/styles.xml")!.async("string"));
  assert.deepEqual(await after.file("word/media/image1.png")!.async("uint8array"), MEDIA);
  assert.match(textOf(await after.file("word/document.xml")!.async("string")), /^Özbekiston şaharlari\|/, "new Latin letters");
});

test("DOCX: round trip cyr -> new -> cyr restores every text node", async () => {
  const src = await handDocx();
  const there = await convertDocx(src, "cyr", "new");
  const back = await convertDocx(there.bytes, "new", "cyr");
  const a = await (await JSZip.loadAsync(src)).file("word/document.xml")!.async("string");
  const b = await (await JSZip.loadAsync(back.bytes)).file("word/document.xml")!.async("string");
  assert.equal(textOf(b).replaceAll("&quot;", '"'), textOf(a).replaceAll("&quot;", '"'));
});

test("DOCX: xml special characters survive (escaped again)", async () => {
  const out = await convertDocx(await handDocx(), "cyr", "lat");
  const doc = await (await JSZip.loadAsync(out.bytes)).file("word/document.xml")!.async("string");
  assert.ok(doc.includes("&amp;") && doc.includes("&lt;5&gt;"));
  // the XML is still well formed: every <w:t> closes
  assert.equal(count(doc, /<w:t(?:\s[^>]*)?>/g), count(doc, /<\/w:t>/g));
});

test("DOCX: a real docx (library-made, Latin Uzbek) converted lat -> cyr keeps paragraphs, tables, numbering", async () => {
  const src = await makeDocx();
  const out = await convertDocx(src, "lat", "cyr");
  const before = await JSZip.loadAsync(src);
  const after = await JSZip.loadAsync(out.bytes);
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort());
  const was = await before.file("word/document.xml")!.async("string");
  const doc = await after.file("word/document.xml")!.async("string");
  for (const tag of [/<w:p[ >]/g, /<w:r[ >]/g, /<w:tbl>/g, /<w:tc>/g, /<w:numPr>/g, /<w:drawing>/g, /<w:rPr>/g, /<w:hyperlink[ >]/g]) {
    assert.equal(count(doc, tag), count(was, tag), String(tag));
  }
  assert.ok(out.changed > 3);
  assert.ok(/[А-Яа-я]/.test(textOf(doc)), "now Cyrillic");
  for (const name of Object.keys(before.files)) {
    if (name === "word/document.xml" || /^word\/(?:header|footer|footnotes|endnotes|comments)/.test(name)) continue;
    const a = before.file(name);
    if (a && !a.dir) assert.deepEqual(await after.file(name)!.async("uint8array"), await a.async("uint8array"), `${name} untouched`);
  }
});

test("DOCX: a corrupt or non-docx archive is refused, not half-converted", async () => {
  await assert.rejects(() => convertDocx(new Uint8Array([1, 2, 3, 4]), "cyr", "lat"));
});

/* ───────────────────────────── PPTX ───────────────────────────── */

const SLIDE = `<?xml version="1.0"?><p:sld ${A} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="uz-Cyrl-UZ" b="1"/><a:t>Ўзбекистон</a:t></a:r><a:br/><a:r><a:rPr i="1"/><a:t>тарихи</a:t></a:r></a:p><a:p><a:r><a:t>Шаҳар &amp; қишлоқ</a:t></a:r></a:p></p:txBody></p:sp>
<p:graphicFrame><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Чорсу</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`;
const NOTES = `<?xml version="1.0"?><p:notes ${A} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:p><a:r><a:t>Маъруза учун эслатма</a:t></a:r></a:p></p:notes>`;
const LAYOUT = `<?xml version="1.0"?><p:sldLayout ${A} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><a:p><a:r><a:t>Шаблон матни</a:t></a:r></a:p></p:sldLayout>`;

async function handPptx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  zip.file("ppt/slides/slide1.xml", SLIDE);
  zip.file("ppt/notesSlides/notesSlide1.xml", NOTES);
  zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  zip.file("ppt/media/image1.png", MEDIA);
  return zip.generateAsync({ type: "uint8array" });
}
const aText = (xml: string) => [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("|");

test("PPTX cyr -> lat: slide + notes text converted, formatting and layouts untouched", async () => {
  const src = await handPptx();
  const out = await convertPptx(src, "cyr", "lat");
  assert.equal(out.nodes, 5);
  const after = await JSZip.loadAsync(out.bytes);
  const slide = await after.file("ppt/slides/slide1.xml")!.async("string");
  assert.equal(aText(slide), "Oʻzbekiston|tarixi|Shahar &amp; qishloq|Chorsu");
  for (const keep of ['<a:pPr algn="ctr"/>', '<a:rPr lang="uz-Cyrl-UZ" b="1"/>', '<a:rPr i="1"/>', "<a:br/>", "<a:tbl>"]) assert.ok(slide.includes(keep), keep);
  assert.equal(count(slide, /<a:p>/g), 3);
  assert.equal(aText(await after.file("ppt/notesSlides/notesSlide1.xml")!.async("string")), "Maʼruza uchun eslatma");
  assert.equal(await after.file("ppt/slideLayouts/slideLayout1.xml")!.async("string"), LAYOUT, "layouts are not converted");
  assert.deepEqual(await after.file("ppt/media/image1.png")!.async("uint8array"), MEDIA);
});

test("PPTX: a real pptx (library-made) converted lat -> new keeps slides, tables and notes", async () => {
  const src = await makePptx();
  const out = await convertPptx(src, "lat", "new");
  const before = await JSZip.loadAsync(src);
  const after = await JSZip.loadAsync(out.bytes);
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort());
  for (const name of Object.keys(before.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const a = await before.file(name)!.async("string");
    const b = await after.file(name)!.async("string");
    for (const tag of [/<a:p>/g, /<a:r>/g, /<a:tbl>/g, /<a:tc>/g, /<p:sp>/g, /<a:br\/>/g]) assert.equal(count(b, tag), count(a, tag), `${name} ${tag}`);
  }
  assert.ok(out.nodes > 8);
  const all = (await Promise.all(Object.keys(after.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => after.file(n)!.async("string")))).map(aText).join("|");
  assert.match(all, /Taqdimot sarlavhasi/);
  assert.match(all, /Ikkinçi band/, "ch -> ç in the new Latin");
});

/* ───────────────────────────── TXT ───────────────────────────── */

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(b);

test("TXT: converted, BOM and CRLF line endings kept, trailing newline kept", () => {
  const src = "﻿Салом, Ўзбекистон!\r\nШаҳар\r\n\r\nэълон\n";
  const out = convertTxt(enc(src), "cyr", "lat");
  assert.equal(dec(out.bytes).replace(/^﻿/, "﻿"), "﻿Salom, Oʻzbekiston!\r\nShahar\r\n\r\neʼlon\n");
  assert.equal(new Uint8Array(out.bytes)[0], 0xef, "BOM bytes are written back");
  assert.equal(out.changed, 1);
});

test("TXT: no BOM stays without BOM; a Latin file converts to Cyrillic and back", () => {
  const lat = "Oʻzbekiston shaharlari:\n- Toshkent\n- Samarqand\n";
  const cyr = convertTxt(enc(lat), "lat", "cyr");
  assert.equal(dec(cyr.bytes), "Ўзбекистон шаҳарлари:\n- Тошкент\n- Самарқанд\n");
  assert.equal(dec(convertTxt(cyr.bytes, "cyr", "lat").bytes), lat);
  assert.notEqual(new Uint8Array(cyr.bytes)[0], 0xef);
});

test("TXT: binary / non-UTF-8 content is refused", () => {
  assert.throws(() => convertTxt(new Uint8Array([0x50, 0x00, 0x01, 0x02]), "cyr", "lat"), NotTextError);
  assert.throws(() => convertTxt(new Uint8Array([0xff, 0xfe, 0xfd, 0x80]), "cyr", "lat"), NotTextError);
});

test("TXT: URLs and e-mails inside the file are kept", () => {
  const out = convertTxt(enc("Сайт https://kitob.uz/ёзги, почта ali@mail.uz"), "cyr", "new");
  assert.equal(dec(out.bytes), "Sayt https://kitob.uz/ёзги, poçta ali@mail.uz");
});
