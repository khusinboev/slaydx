import "server-only";
import { AlignmentType, Document, Footer, Packer, PageNumber, Paragraph, TextRun } from "docx";
import { renderOferta, runsOf, ofertaPlainText, type OfertaView } from "../oferta/text";
import { ofertaConfig } from "./oferta";
import { getOrDerive } from "./pdf-cache";
import { toPdf } from "./pdf";

/**
 * The offer as a PDF: the SAME data as the web page (`renderOferta`), built with the `docx` library and
 * converted by the shared LibreOffice gate (`toPdf`). Cached by (version, requisites hash) -- the cache key
 * hashes the plain text, so a changed text or requisites can never be served from an old entry. `null` when
 * LibreOffice is missing or the conversion failed; `SofficeBusyError` (gate busy) propagates so the route
 * answers 503 and the bot falls back to the web link.
 */

const FONT = "Times New Roman";
/** A fixed hex id for the derived cache key (`pdfCacheKey` keeps only `[0-9a-f-]`). */
const CACHE_ID = "0fe47a";

function para(children: TextRun[], opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number; indent?: number } = {}): Paragraph {
  return new Paragraph({
    children,
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 100 },
    indent: opts.indent ? { left: opts.indent } : undefined,
  });
}

/** DOCX bytes of an offer view. */
export async function ofertaDocx(view: OfertaView): Promise<Buffer> {
  const run = (text: string, o: { bold?: boolean; size?: number } = {}) => new TextRun({ text, bold: o.bold, size: o.size ?? 22, font: FONT });
  const children: Paragraph[] = [para([run(view.title.toUpperCase(), { bold: true, size: 26 })], { align: AlignmentType.CENTER, after: 240 })];
  for (const s of view.sections) {
    children.push(para([run(s.heading, { bold: true, size: 24 })], { align: AlignmentType.LEFT, before: 200, after: 100 }));
    for (const c of s.clauses) {
      const runs = runsOf(c.text).map((r) => run(r.text, { bold: r.bold }));
      children.push(para(c.no ? [run(`${c.no} `), ...runs] : runs, { align: c.no ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, after: c.no ? 100 : 40 }));
    }
  }
  children.push(para([run(`Tahrir: v${view.version} · ${view.editionDate}`)], { align: AlignmentType.LEFT, before: 240 }));
  const doc = new Document({
    title: view.title,
    creator: "SlaydX",
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 })] })],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export type OfertaPdf = { bytes: Buffer; version: number; /** Stable id of this exact text + requisites. */ digest: string };

/** The current offer as PDF bytes, or `null` when it cannot be produced. */
export async function currentOfertaPdf(): Promise<OfertaPdf | null> {
  const cfg = await ofertaConfig();
  const view = renderOferta(cfg.requisites, cfg.version);
  const plain = Buffer.from(ofertaPlainText(view), "utf8");
  const bytes = await getOrDerive({
    generationId: CACHE_ID,
    bytes: plain,
    format: "pdf",
    produce: async () => toPdf(await ofertaDocx(view), "oferta.docx"),
  });
  if (!bytes) return null;
  const { createHash } = await import("node:crypto");
  return { bytes, version: cfg.version, digest: createHash("sha256").update(plain).digest("hex").slice(0, 16) };
}
