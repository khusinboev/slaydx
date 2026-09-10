import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { applySegments, extractSegments } from "../lib/generation/translate/index.ts";
import { fakeTranslate, makeDocx } from "./helpers/office-fixtures.ts";

/**
 * DOCX adapteri — tuzilmani saqlab tarjima.
 *
 * Fikstura HAQIQIY Word tuzilmasi (`docx` kutubxonasi + ikkita xom
 * qo'shimcha): titul uslubi, sarlavha, qalin+oddiy run, tab, havola,
 * ro'yxat, izoh, rasm, jadval, kolontitullar, `PAGE`/`PAGEREF`
 * maydonlari, matn qutisi va `TOC` maydon guruhi.
 */
const run = promisify(execFile);
const SOFFICE = "/usr/bin/soffice";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

async function partOf(bytes: Uint8Array, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file(name)!.async("string");
}

/** `<w:t>` matnlari — ochilmagan holida (entity lar saqlanadi). */
const textsOf = (xml: string) => [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);

/** Berilgan so'zni o'z ichiga olgan `<w:p>` bloki. */
function paraWith(xml: string, needle: string): string {
  const at = xml.indexOf(needle);
  assert.ok(at > 0, `«${needle}» topilmadi`);
  const start = xml.lastIndexOf("<w:p>", at) >= 0 ? xml.lastIndexOf("<w:p>", at) : xml.lastIndexOf("<w:p ", at);
  const end = xml.indexOf("</w:p>", at) + 6;
  return xml.slice(start, end);
}

let cachedSource: Uint8Array | null = null;
async function source(): Promise<Uint8Array> {
  if (!cachedSource) cachedSource = await makeDocx();
  return cachedSource;
}

async function translated(): Promise<Uint8Array> {
  const src = await source();
  const ex = await extractSegments("docx", src);
  const map = new Map(ex.segments.map((s) => [s.id, fakeTranslate(s.text)]));
  return applySegments("docx", src, map);
}

test("DOCX: segment turlari, kontekst, tokenlar va dublikatlar", async () => {
  const ex = await extractSegments("docx", await source());
  const by = new Map(ex.segments.map((s) => [s.id, s]));

  assert.equal(by.get("d0:p0")?.kind, "title", "Title uslubi → title");
  assert.equal(by.get("d0:p1")?.kind, "h", "Heading1 → h");
  assert.equal(by.get("d0:p5")?.kind, "li", "numPr → li");
  assert.equal(by.get("d0:p11")?.kind, "cell", "w:tbl ichida → cell");

  const header = ex.segments.find((s) => s.ctx === "header");
  const footer = ex.segments.find((s) => s.ctx === "footer");
  const note = ex.segments.find((s) => s.ctx === "footnote");
  assert.equal(header?.text, "Yuqori kolontitul");
  assert.equal(note?.kind, "note");
  assert.equal(header?.part, "word/header1.xml");

  // Qalin + oddiy run → ikkita marker.
  assert.equal(by.get("d0:p2")?.text, "⟦r1⟧Muhim so'z⟦/r1⟧⟦r2⟧ va oddiy davomi shu yerda.⟦/r2⟧");
  // Tab bitta run ichida.
  assert.equal(by.get("d0:p3")?.text, "Chap ustun⟦tab⟧O'ng ustun");
  // Havola — alohida zona.
  assert.equal(by.get("d0:p4")?.text, "Havola: ⟦l1⟧saytga o'ting⟦/l1⟧");
  // Izoh havolasi (`w:footnoteReference`) — opaque.
  assert.equal(by.get("d0:p7")?.text, "Izohli jumla⟦1⟧");

  // `PAGE` va `PAGEREF` — butun guruh opaque, natija matni segmentga kirmaydi.
  assert.equal(footer?.text, "Sahifa ⟦1⟧", "PAGE maydoni opaque");
  assert.equal(by.get("d0:p8")?.text, "Birinchi bob⟦tab⟧⟦1⟧", "PAGEREF opaque");
  // `TOC` esa opaque EMAS: natija runlari foydalanuvchi ko'radigan matn.
  assert.equal(by.get("d0:p19")?.text, "⟦1⟧⟦2⟧⟦3⟧Mundarija sarlavhasi⟦4⟧");

  // Matn qutisi ichidagi paragraf — mustaqil segment.
  assert.equal(by.get("d0:p18")?.text, "Matn qutisi ichidagi jumla");

  // Takrorlanuvchi «Birinchi bob» ikkinchi marta `dup` bilan belgilanadi.
  assert.equal(by.get("d0:p8")?.dup, "d0:p1");
  assert.equal(by.get("d0:p1")?.dup, undefined);

  assert.equal(ex.chars, ex.segments.reduce((n, s) => n + s.text.length, 0));
  assert.ok(ex.chars > 300, `chars: ${ex.chars}`);
});

test("DOCX: aylanma — matn almashadi, tuzilma bayt darajasida qoladi", async () => {
  const src = await source();
  const out = await translated();
  const before = await partOf(src, "word/document.xml");
  const after = await partOf(out, "word/document.xml");

  for (const re of [/<w:tbl>/g, /<w:tc>/g, /<w:drawing>/g, /<w:fldChar\b/g, /<w:numPr>/g, /<w:hyperlink\b/g, /<w:fldSimple\b/g, /<w:txbxContent>/g]) {
    assert.equal(count(after, re), count(before, re), `${re} soni o'zgarmasin`);
  }

  const texts = textsOf(after);
  for (const t of texts) {
    if (!/\p{L}/u.test(t)) continue;
    assert.ok(t.startsWith("[T]"), `tarjima qilinmagan matn: ${t}`);
  }
  // `PAGEREF` keshi (raqam) — harfsiz, tegilmagan.
  assert.ok(texts.includes("2"), "maydon keshi joyida qoladi");

  // Har yozilgan `<w:t>` da `xml:space="preserve"` bo'lishi SHART.
  assert.equal(count(after, /<w:t>/g), 0, "bo'shliqsiz `<w:t>` qolmasin");

  // Qalin paragraf: `rPr` soni o'zgarmagan va `<w:b/>` MARKERLANGAN runda.
  /*
   * `docx` kutubxonasi apostrofni `&apos;` qilib yozadi, bizning
   * `xmlEscape` esa (XML da shart bo'lmagani uchun) uni xom qoldiradi —
   * shuning uchun ikki tomonda qidiruv matni har xil.
   */
  const boldBefore = paraWith(before, "Muhim so&apos;z");
  const boldAfter = paraWith(after, "Muhim so'z");
  assert.equal(count(boldAfter, /<w:rPr>/g), count(boldBefore, /<w:rPr>/g), "qalin paragrafda rPr soni");
  assert.match(boldAfter, /<w:rPr><w:b\/>[\s\S]*?<\/w:rPr><w:t xml:space="preserve">\[T\]Muhim/);
  const plainRun = boldAfter.slice(boldAfter.lastIndexOf("<w:r", boldAfter.indexOf("[T] va oddiy")));
  assert.ok(!plainRun.includes("<w:b/>"), "oddiy run qalin bo'lib qolmasin");

  // Tab tokeni `<w:tab/>` bo'lib qaytadi.
  assert.match(paraWith(after, "Chap ustun"), /\[T\]Chap ustun<\/w:t><w:tab\/><w:t xml:space="preserve">\[T\]O/);

  // Havola matni havola ICHIDA qoladi (r:id tegilmaydi).
  const linkPara = paraWith(after, "saytga");
  assert.match(linkPara, /<w:hyperlink[^>]*r:id="[^"]+"><w:r[^>]*>[\s\S]*?\[T\]saytga/);

  // Matn qutisi: ichki paragraf tarjima qilingan, tashqi `w:drawing` butun.
  assert.match(after, /<w:txbxContent><w:p><w:r><w:t xml:space="preserve">\[T\]Matn qutisi ichidagi jumla<\/w:t><\/w:r><\/w:p><\/w:txbxContent>/);

  // Kolontitul va izohlar ham tarjima qilinadi.
  assert.deepEqual(textsOf(await partOf(out, "word/header1.xml")), ["[T]Yuqori kolontitul"]);
  assert.deepEqual(textsOf(await partOf(out, "word/footer1.xml")), ["[T]Sahifa "]);
  assert.deepEqual(textsOf(await partOf(out, "word/footnotes.xml")), ["[T]Izoh matni fikstura uchun"]);

  // Media va uslublar tegilmagan.
  const zipA = await JSZip.loadAsync(src);
  const zipB = await JSZip.loadAsync(out);
  assert.deepEqual(Object.keys(zipB.files).sort(), Object.keys(zipA.files).sort(), "arxiv tarkibi");
  for (const name of ["word/styles.xml", "word/numbering.xml", "word/settings.xml"]) {
    assert.equal(await zipB.file(name)!.async("string"), await zipA.file(name)!.async("string"), name);
  }
  const png = Object.keys(zipA.files).find((n) => n.startsWith("word/media/") && !zipA.files[n].dir)!;
  assert.deepEqual(await zipB.file(png)!.async("uint8array"), await zipA.file(png)!.async("uint8array"), "rasm bayti");
});

test("DOCX: 4 tadan ko'p formatli run — dominant runga tushadi", async () => {
  const src = await source();
  const ex = await extractSegments("docx", src);
  const six = ex.segments.find((s) => s.text.startsWith("bir ikki"))!;
  // Olti run — marker YO'Q (chegara 4).
  assert.equal(six.text, "bir ikki uch to'rt besh olti va eng uzun qism shu yerda turadi");
  assert.ok(!/⟦r\d/.test(six.text), "6 run uchun marker qo'yilmaydi");

  const out = await applySegments("docx", src, new Map([[six.id, fakeTranslate(six.text)]]));
  const para = paraWith(await partOf(out, "word/document.xml"), "bir ikki");
  assert.equal(count(para, /<w:r[ >]/g), 1, "hammasi bitta (dominant) runga yig'iladi");
  // Dominant = eng uzun matnli run, ya'ni chizilgan (`strike`) oxirgisi.
  assert.match(para, /<w:strike\/>/);
});

test("DOCX: buzilgan markerlar va bo'sh tarjima — xavfsiz qaytish yo'li", async () => {
  const src = await source();
  const doc = await partOf(src, "word/document.xml");

  // Juftini yo'qotgan `⟦r1⟧` → dominant runga (matn yo'qolmaydi).
  const broken = await applySegments("docx", src, new Map([["d0:p2", "⟦r1⟧Buzilgan marker matni"]]));
  const brokenPara = paraWith(await partOf(broken, "word/document.xml"), "Buzilgan");
  assert.equal(count(brokenPara, /<w:r[ >]/g), 1, "muvozanatsiz marker → bitta run");
  assert.match(brokenPara, /Buzilgan marker matni/);
  assert.ok(!/⟦/.test(brokenPara), "tokenlar hujjatga sizib chiqmaydi");

  // Bo'sh tarjima — ASL matn qoladi.
  const empty = await applySegments("docx", src, new Map([["d0:p1", "   "]]));
  assert.equal(paraWith(await partOf(empty, "word/document.xml"), "Birinchi bob"), paraWith(doc, "Birinchi bob"));

  // Xarita bo'sh bo'lsa hujjat XML i umuman o'zgarmaydi.
  const untouched = await applySegments("docx", src, new Map());
  assert.equal(await partOf(untouched, "word/document.xml"), doc);
});

test(
  "DOCX: LibreOffice tarjima faylni ochadi va sahifa soni o'zgarmaydi",
  { skip: !existsSync(SOFFICE) || !existsSync("/usr/bin/pdfinfo") },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "slaydx-tr-docx-"));
    const pages = async (bytes: Uint8Array, name: string) => {
      const src = join(dir, `${name}.docx`);
      await writeFile(src, bytes);
      await run(
        SOFFICE,
        ["--headless", "--norestore", `-env:UserInstallation=file://${join(dir, name)}`, "--convert-to", "pdf", "--outdir", dir, src],
        { timeout: 180_000 },
      );
      const { stdout } = await run("pdfinfo", [join(dir, `${name}.pdf`)]);
      return Number(stdout.match(/Pages:\s+(\d+)/)?.[1]);
    };
    const before = await pages(await source(), "asl");
    const after = await pages(await translated(), "tarjima");
    assert.ok(before >= 1, `asl sahifalari: ${before}`);
    assert.equal(after, before, "tarjima sahifa sonini o'zgartirmasin");
  },
);
