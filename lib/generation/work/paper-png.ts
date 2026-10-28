/**
 * NOTEBOOK PAGE PNG (handwritten work, DOCX background) — dependency-free.
 *
 * 254 dpi da 1 piksel = 0,1 mm: A4 = 2100 × 2970 px, chiziq oralig'i,
 * qizil chegara va katak butun pikselga tushadi (yaxlitlash xatosi yo'q).
 * Rasm 3 rangli palitrali (indexed) PNG — deyarli bir xil qatorlar, siqilgach
 * ~10–20 KB. `sharp`/`canvas` kerak emas: worker ham, web ham bir xil baytni beradi.
 *
 * Chiziqlar `handGeometry().docxRuleY0Mm` dan boshlanadi: LibreOffice/Word
 * aniq qator balandligida matn asosini 80 % da qo'yadi, chiziq ENG USTI shu
 * asosga tushadi (harflar chiziq ustida «turadi»).
 */
import { crc32, deflateSync } from "node:zlib";
import { HAND_PAPER_SPECS, handGeometry, handRedSide, twToMm, type HandFontId, type HandLayout, type HandPaper } from "./handwriting";

const DPMM = 10; // 254 dpi
export const PAPER_PX = { w: 2100, h: 2970 } as const;

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

const cache = new Map<string, Buffer>();

/** Pixel size of the sheet this layout exports (A4 / A5 page, or the A4 landscape two-up sheet). */
export function paperPx(g: ReturnType<typeof handGeometry>): { w: number; h: number } {
  return { w: Math.round(twToMm(g.sheetTw.width) * DPMM), h: Math.round(twToMm(g.sheetTw.height) * DPMM) };
}

/**
 * Ruled sheet (lined / grid) as an indexed PNG, 1 px = 0.1 mm. `pageIndex` (0 = odd, 1 = even) picks the margin-line
 * side for a single page; the two-up sheet draws pages 0 and 1 side by side. Blank / print paper has no ruling, so
 * there is nothing to draw — callers must check `HAND_PAPER_SPECS[paper].ruled` first. Same key = same Buffer.
 */
export function paperPng(paper: HandPaper, font: HandFontId, layout?: HandLayout, pageIndex = 0): Buffer {
  const spec = HAND_PAPER_SPECS[paper];
  if (!spec.ruled) throw new Error(`paperPng: ${paper} paper has no ruling to draw`);
  const geo = handGeometry(paper, font, layout);
  const first = geo.twoUp ? 0 : pageIndex % 2;
  const key = `${paper}:${font}:${geo.pageFormat}:${geo.twoUp}:${geo.marginMode}:${geo.cellsPerRow}:${first}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { w, h } = paperPx(geo);
  const pageW = Math.round(twToMm(geo.page.widthTw) * DPMM);
  const pitchMm = twToMm(geo.pitchTw);
  const ruleRows = Math.max(1, Math.round(spec.ruleMm * DPMM));
  const redRows = Math.max(1, Math.round(geo.page.redMm * DPMM));

  /* Horizontal rulings: lined = every row; cell paper = every cell (5 mm; a 1-cell row follows the text pitch exactly). */
  const stepMm = paper === "lined" ? pitchMm : geo.cellsPerRow === 2 ? spec.cellMm : pitchMm;
  const hLine = new Uint8Array(h);
  const y0 = geo.docxRuleY0Mm;
  const firstK = Math.ceil(-y0 / stepMm) - 1;
  for (let k = firstK; ; k++) {
    const y = Math.round((y0 + k * stepMm) * DPMM);
    if (y >= h) break;
    for (let r = 0; r < ruleRows; r++) if (y + r >= 0 && y + r < h) hLine[y + r] = 1;
  }

  // Palette: 0 white, 1 ruling, 2 margin line. One template row per kind; the left/right halves draw their own verticals.
  const plain = Buffer.alloc(w + 1, 0);
  const rule = Buffer.alloc(w + 1, 1);
  rule[0] = 0; // row filter (None) — not a palette index
  const halves = geo.twoUp ? 2 : 1;
  for (let half = 0; half < halves; half++) {
    const x0 = half * pageW;
    const side = handRedSide(geo, first + half);
    const redX = side === "right" ? pageW - Math.round(geo.page.redLineMm * DPMM) - redRows : Math.round(geo.page.redLineMm * DPMM);
    if (paper === "grid") {
      /* Vertical cell rules, anchored at the margin line (5 mm cells), only inside this page. */
      const step = spec.cellMm * DPMM;
      for (let x = redX % step; x < pageW; x += step) for (let r = 0; r < ruleRows; r++) {
        const col = x0 + Math.round(x) + r;
        if (col < x0 + pageW) plain[1 + col] = 1;
      }
    }
    if (side) for (let r = 0; r < redRows; r++) {
      plain[1 + x0 + redX + r] = 2;
      rule[1 + x0 + redX + r] = 2;
    }
  }
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) rows.push(hLine[y] ? rule : plain);
  const raw = Buffer.concat(rows);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed
  const plte = Buffer.from([255, 255, 255, ...hexRgb(spec.ruleHex), ...hexRgb(geo.page.redHex)]);
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(DPMM * 1000, 0);
  phys.writeUInt32BE(DPMM * 1000, 4);
  phys[8] = 1; // metre
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("pHYs", phys),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  cache.set(key, png);
  return png;
}
