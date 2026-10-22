/**
 * Minimal PDF writer: one JPEG per page (DCTDecode image XObjects).
 *
 * Why self-written: images -> PDF needs nothing but embedding the JPEG bytes
 * as they are, and a new dependency for that is not worth it. The caller
 * (sharp) has already produced baseline sRGB JPEGs; this module only lays
 * them out. Structure: catalog, pages, then page + content + image per page,
 * a classic xref table with exact byte offsets and a trailer.
 */

export type JpegPage = {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
  /** 3 = RGB (default), 1 = grayscale. */
  components?: 1 | 3;
};

/** A page is the image at this density: 150 dpi puts a 1240x1754 px scan on A4. */
const DPI = 150;

const pt = (px: number): string => ((px * 72) / DPI).toFixed(2);

export function buildJpegPdf(pages: readonly JpegPage[]): Buffer {
  if (!pages.length) throw new Error("buildJpegPdf: at least one page is required");
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    parts.push(buf);
    pos += buf.length;
  };
  const begin = (n: number) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
  };

  // The binary comment after the header tells transfer tools the file is binary.
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  // Object numbers: 1 catalog, 2 pages, then 3 per page: page, content, image.
  const pageObj = (i: number) => 3 + i * 3;
  begin(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  begin(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>\nendobj\n`);

  pages.forEach((p, i) => {
    const w = pt(p.width);
    const h = pt(p.height);
    const page = pageObj(i);
    begin(page);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>\nendobj\n`,
    );
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    begin(page + 1);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    begin(page + 2);
    const space = p.components === 1 ? "/DeviceGray" : "/DeviceRGB";
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
    );
    push(Buffer.from(p.jpeg.buffer, p.jpeg.byteOffset, p.jpeg.length));
    push("\nendstream\nendobj\n");
  });

  const count = 3 + pages.length * 3; // objects 0..count-1
  const xref = pos;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
