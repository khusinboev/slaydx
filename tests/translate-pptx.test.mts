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
import { fakeTranslate, makePptx } from "./helpers/office-fixtures.ts";

/**
 * PPTX adapteri — slayd maketi, tema va diagrammalar tegilmasdan
 * matn almashadi.
 */
const run = promisify(execFile);
const SOFFICE = "/usr/bin/soffice";
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

let cached: Uint8Array | null = null;
async function source(): Promise<Uint8Array> {
  if (!cached) cached = await makePptx();
  return cached;
}

async function partOf(bytes: Uint8Array, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file(name)!.async("string");
}

async function translated(): Promise<Uint8Array> {
  const src = await source();
  const ex = await extractSegments("pptx", src);
  return applySegments("pptx", src, new Map(ex.segments.map((s) => [s.id, fakeTranslate(s.text)])));
}

test("PPTX: segment turlari, kontekst va tokenlar", async () => {
  const ex = await extractSegments("pptx", await source());
  const by = new Map(ex.segments.map((s) => [s.id, s]));

  assert.equal(by.get("s1:p0")?.kind, "title", "p:ph type=title → title");
  assert.equal(by.get("s1:p0")?.ctx, "slide 1");
  assert.equal(by.get("s3:p1")?.kind, "cell", "a:tc ichida → cell");
  assert.equal(by.get("n2:p0")?.kind, "note", "notesSlide → note");
  assert.equal(by.get("n2:p0")?.ctx, "notes 2");

  // Qalin + oddiy run → markerlar; `<a:br/>` → ⟦br⟧.
  assert.equal(by.get("s2:p1")?.text, "⟦r1⟧Qalin qism⟦br⟧⟦/r1⟧⟦r2⟧ va oddiy davomi⟦/r2⟧");
  // `<a:fld>` (slayd raqami) — opaque, matni segmentga kirmaydi.
  assert.equal(by.get("s3:p0")?.text, "Jadval slaydi⟦1⟧");

  // Slaydlar RAQAM bo'yicha tartibda (slide10 slide2 dan keyin).
  const slides = ex.segments.filter((s) => s.part.includes("/slides/")).map((s) => s.part);
  assert.deepEqual([...new Set(slides)], [
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide3.xml",
  ]);

  assert.deepEqual(ex.warnings, ["1 ta diagramma/SmartArt matni tarjima qilinmadi"]);
});

test("PPTX: aylanma — matn almashadi, maket va diagramma tegilmaydi", async () => {
  const src = await source();
  const out = await translated();

  for (const name of ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml", "ppt/notesSlides/notesSlide2.xml"]) {
    const before = await partOf(src, name);
    const after = await partOf(out, name);
    for (const re of [/<a:tbl>/g, /<a:endParaRPr\b/g, /<p:ph\b/g, /<a:p>/g, /<a:fld\b/g]) {
      assert.equal(count(after, re), count(before, re), `${name} ${re}`);
    }
    for (const m of after.matchAll(/<a:t>([^<]*)<\/a:t>/g)) {
      if (!/\p{L}/u.test(m[1])) continue;
      assert.ok(m[1].startsWith("[T]"), `${name}: tarjima qilinmagan «${m[1]}»`);
    }
  }

  const slide2 = await partOf(out, "ppt/slides/slide2.xml");
  // `<a:br/>` runlar ORASIDA tiklanadi va qalin run qalinligicha qoladi.
  assert.match(slide2, /b="1"[\s\S]{0,200}?<a:t>\[T\]Qalin qism<\/a:t><\/a:r><a:br\/><a:r>/);

  // Slayd raqami maydoni BAYT-BA-BAYT joyida.
  const slide3 = await partOf(out, "ppt/slides/slide3.xml");
  assert.match(slide3, /<a:fld id="\{7B2A1C64-0000-0000-0000-000000000001\}" type="slidenum"><a:rPr lang="en-US"\/><a:t>3<\/a:t><\/a:fld>/);

  // Notiq izohi tarjima qilinadi.
  const notes = await partOf(out, "ppt/notesSlides/notesSlide2.xml");
  assert.match(notes, /\[T\]Ma'ruzachi uchun izoh matni\./);

  // Diagramma, master, layout, tema — o'zgarmaydi.
  const zipA = await JSZip.loadAsync(src);
  const zipB = await JSZip.loadAsync(out);
  const same = Object.keys(zipA.files).filter(
    (n) => !zipA.files[n].dir && (n.startsWith("ppt/charts/") || n.startsWith("ppt/slideLayouts/") || n.startsWith("ppt/slideMasters/") || n.startsWith("ppt/theme/")),
  );
  assert.ok(same.length >= 3, `taqqoslanadigan qismlar: ${same.length}`);
  for (const name of same) {
    assert.equal(await zipB.file(name)!.async("string"), await zipA.file(name)!.async("string"), name);
  }
});

test("PPTX: tarjimasiz xarita faylni umuman o'zgartirmaydi", async () => {
  const src = await source();
  const out = await applySegments("pptx", src, new Map());
  for (const name of ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]) {
    assert.equal(await partOf(out, name), await partOf(src, name), name);
  }
});

test(
  "PPTX: LibreOffice ochadi va slayd soni o'zgarmaydi",
  { skip: !existsSync(SOFFICE) || !existsSync("/usr/bin/pdfinfo") },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "slaydx-tr-pptx-"));
    const pages = async (bytes: Uint8Array, name: string) => {
      const src = join(dir, `${name}.pptx`);
      await writeFile(src, bytes);
      await run(
        SOFFICE,
        ["--headless", "--norestore", `-env:UserInstallation=file://${join(dir, name)}`, "--convert-to", "pdf", "--outdir", dir, src],
        { timeout: 180_000 },
      );
      const { stdout } = await run("pdfinfo", [join(dir, `${name}.pdf`)]);
      return Number(stdout.match(/Pages:\s+(\d+)/)?.[1]);
    };
    assert.equal(await pages(await translated(), "tarjima"), 3, "uchta slayd");
  },
);
