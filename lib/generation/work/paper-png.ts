/**
 * DAFTAR VARAG'I PNG si (qo'lyozma mustaqil ish, DOCX foni) — bog'liqliksiz.
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
import { HAND_PAGE, HAND_PAPER_SPECS, handGeometry, twToMm, type HandFontId, type HandPaper } from "./handwriting";

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

/** A4 daftar varag'i (PNG bayt). Natija keshlanadi — bir xil kalit bir xil Buffer. */
export function paperPng(paper: HandPaper, font: HandFontId): Buffer {
  const key = `${paper}:${font}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { w, h } = PAPER_PX;
  const spec = HAND_PAPER_SPECS[paper];
  const geo = handGeometry(paper, font);
  const pitchMm = twToMm(spec.pitchTw);
  const ruleRows = Math.max(1, Math.round(spec.ruleMm * DPMM));
  const redRows = Math.max(1, Math.round(HAND_PAGE.redMm * DPMM));
  const redX = Math.round(HAND_PAGE.redLineMm * DPMM);

  /* Gorizontal chiziqlar: chiziqlida har qator, katakli varaqda har katak (5 mm). */
  const stepMm = paper === "lined" ? pitchMm : spec.cellMm;
  const hLine = new Uint8Array(h);
  const y0 = geo.docxRuleY0Mm;
  const first = Math.ceil(-y0 / stepMm) - 1;
  for (let k = first; ; k++) {
    const y = Math.round((y0 + k * stepMm) * DPMM);
    if (y >= h) break;
    for (let r = 0; r < ruleRows; r++) if (y + r >= 0 && y + r < h) hLine[y + r] = 1;
  }

  /* Vertikal katak chiziqlari (faqat katakli): qizil chiziqdan boshlab har 5 mm. */
  const vCols: number[] = [];
  if (paper === "grid") {
    const step = spec.cellMm * DPMM;
    for (let x = redX % step; x < w; x += step) for (let r = 0; r < Math.max(1, Math.round(spec.ruleMm * DPMM)); r++) vCols.push(Math.round(x) + r);
  }

  // Palitra: 0 oq, 1 chiziq, 2 qizil.
  const plain = Buffer.alloc(w + 1, 0);
  for (const x of vCols) if (x < w) plain[1 + x] = 1;
  const rule = Buffer.alloc(w + 1, 1);
  rule[0] = 0; // satr filtri (None) — palitra indeksi emas
  for (let r = 0; r < redRows; r++) {
    plain[1 + redX + r] = 2;
    rule[1 + redX + r] = 2;
  }
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) rows.push(hLine[y] ? rule : plain);
  const raw = Buffer.concat(rows);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed
  const plte = Buffer.from([255, 255, 255, ...hexRgb(spec.ruleHex), ...hexRgb(HAND_PAGE.redHex)]);
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(DPMM * 1000, 0);
  phys.writeUInt32BE(DPMM * 1000, 4);
  phys[8] = 1; // metr
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
