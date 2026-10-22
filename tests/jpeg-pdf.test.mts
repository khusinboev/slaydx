import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { buildJpegPdf } from "../lib/convert/jpeg-pdf.ts";

/**
 * Self-written JPEG PDF writer: header, exact xref offsets, page count, embedded JPEG bytes intact.
 * Mutations (restored): off-by-one in an xref offset; /Count not updated; JPEG bytes truncated.
 */
async function jpeg(w: number, h: number, color: string) {
  const data = await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
  return { jpeg: data, width: w, height: h };
}

test("structure: header, xref offsets point at objects, page count, trailer", async () => {
  const pages = [await jpeg(300, 400, "#f00"), await jpeg(500, 200, "#0f0"), await jpeg(64, 64, "#00f")];
  const pdf = buildJpegPdf(pages);
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.endsWith("%%EOF\n"));
  assert.match(text, /\/Type \/Pages \/Count 3 /);
  assert.equal((text.match(/\/Type \/Page /g) ?? []).length, 3);

  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const size = Number(/trailer\n<< \/Size (\d+)/.exec(text)![1]);
  assert.equal(size, 3 + pages.length * 3);
  const entries = text.slice(startxref).split("\n").slice(3, 3 + size - 1);
  assert.equal(entries.length, size - 1);
  entries.forEach((line, i) => {
    assert.match(line, /^\d{10} 00000 n $/);
    const off = Number(line.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`);
  });
});

test("every JPEG is embedded byte for byte and sized as 150 dpi points", async () => {
  const p = await jpeg(1240, 1754, "#888");
  const pdf = buildJpegPdf([p]);
  assert.ok(pdf.includes(p.jpeg), "DCT stream intact");
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 595\.2\d 841\.9\d\]/);
  assert.match(pdf.toString("latin1"), new RegExp(`/Width 1240 /Height 1754 /ColorSpace /DeviceRGB .*?/Length ${p.jpeg.length} `));
});

test("no pages is refused", () => {
  assert.throws(() => buildJpegPdf([]));
});
