import { createDeflateRaw, crc32 } from "node:zlib";

/**
 * Fayl tahlili chegaralari uchun fiksturalar (W1-D: C04/C06).
 *
 * Hammasi xotirada, tashqi dasturlarsiz yasaladi: PDF — qo'lda yozilgan
 * minimal fayl (Helvetica, siqilmagan kontent), ZIP — o'z yozuvchimiz,
 * chunki JSZip metadatada YOLG'ON hajm yozib bera olmaydi, «zip bomba»
 * sinovining butun ma'nosi esa aynan shunda.
 */

const enc = new TextEncoder();

/** Sahifalardan PDF: har sahifa — `lines[]` qatorlari (bo'sh massiv = bo'sh sahifa). */
export function makePdf(pages: string[][], opts: { fontSize?: number; leading?: number } = {}): Uint8Array {
  const size = opts.fontSize ?? 10;
  const leading = opts.leading ?? 12;
  const n = pages.length;
  // 1 katalog, 2 sahifalar, 3 shrift, keyin har sahifaga (sahifa, kontent) juftligi.
  const objs: string[] = [];
  objs[1] = "<</Type/Catalog/Pages 2 0 R>>";
  const kids = Array.from({ length: n }, (_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs[2] = `<</Type/Pages/Kids[${kids}]/Count ${n}>>`;
  objs[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    let stream = "";
    if (lines.length) {
      stream = `BT /F1 ${size} Tf ${leading} TL 72 770 Td\n`;
      for (const l of lines) stream += `(${l.replace(/[()\\]/g, "")}) Tj T*\n`;
      stream += "ET\n";
    }
    objs[pageId] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R>>>>/Contents ${contentId} 0 R>>`;
    objs[contentId] = `<</Length ${stream.length}>>stream\n${stream}endstream`;
  });

  const parts: string[] = ["%PDF-1.4\n"];
  let offset = parts[0].length;
  const offsets: number[] = [];
  for (let id = 1; id < objs.length; id++) {
    const body = `${id} 0 obj${objs[id]}endobj\n`;
    offsets[id] = offset;
    parts.push(body);
    offset += body.length;
  }
  const xref = offset;
  let tail = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) tail += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  tail += `trailer<</Size ${objs.length}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  parts.push(tail);
  return enc.encode(parts.join(""));
}

/**
 * Darslikka o'xshash matnli PDF: har sahifada `linesPerPage` qator,
 * tinish belgisiz (ya'ni `toBlocks` hech qayerda paragrafni uzmaydi —
 * AUDIT R2 probasidagi eng yomon holat).
 */
export function makeTextbookPdf(pageCount: number, linesPerPage = 55): Uint8Array {
  const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore".split(" ");
  const pages: string[][] = [];
  for (let p = 0; p < pageCount; p++) {
    const lines: string[] = [];
    for (let l = 0; l < linesPerPage; l++) {
      let s = "";
      for (let w = 0; s.length < 85; w++) s += (s ? " " : "") + words[(p * 7 + l * 3 + w) % words.length];
      lines.push(s);
    }
    pages.push(lines);
  }
  return makePdf(pages);
}

/** Bo'sh sahifali PDF — sahifa chegarasi sinovi uchun. */
export function makeBlankPagesPdf(pageCount: number): Uint8Array {
  return makePdf(Array.from({ length: pageCount }, () => []));
}

export type ZipEntrySpec = {
  name: string;
  /** Kichik yozuvlar uchun tayyor bayt. */
  data?: Uint8Array | string;
  /** Katta yozuv: `bytes` hajmdagi takroriy `fill` belgisi — xotirada BUTUNLAY yasalmaydi. */
  repeat?: { fill: string; bytes: number };
  /** Metadatadagi (yolg'on) ochilgan hajm; berilmasa haqiqiysi yoziladi. */
  declaredSize?: number;
  /** `true` — siqilmagan (STORED) yozuv. */
  stored?: boolean;
};

async function deflateEntry(spec: ZipEntrySpec): Promise<{ compressed: Buffer; size: number; crc: number }> {
  if (spec.stored) {
    const raw = Buffer.from(typeof spec.data === "string" ? enc.encode(spec.data) : (spec.data ?? new Uint8Array()));
    return { compressed: raw, size: raw.length, crc: crc32(raw) };
  }
  const deflate = createDeflateRaw({ level: 9 });
  const out: Buffer[] = [];
  deflate.on("data", (c: Buffer) => out.push(c));
  const done = new Promise<void>((resolve, reject) => {
    deflate.on("end", resolve);
    deflate.on("error", reject);
  });
  let size = 0;
  let crc = 0;
  const write = (chunk: Buffer) =>
    new Promise<void>((resolve) => {
      size += chunk.length;
      crc = crc32(chunk, crc);
      if (deflate.write(chunk)) resolve();
      else deflate.once("drain", () => resolve());
    });
  if (spec.repeat) {
    const block = Buffer.alloc(1024 * 1024, spec.repeat.fill);
    let left = spec.repeat.bytes;
    while (left > 0) {
      const n = Math.min(left, block.length);
      await write(n === block.length ? block : block.subarray(0, n));
      left -= n;
    }
  } else {
    await write(Buffer.from(typeof spec.data === "string" ? enc.encode(spec.data) : (spec.data ?? new Uint8Array())));
  }
  deflate.end();
  await done;
  return { compressed: Buffer.concat(out), size, crc };
}

/** Minimal ZIP yozuvchi: lokal sarlavhalar + markaziy katalog + EOCD. */
export async function makeZip(entries: ZipEntrySpec[], opts: { eocdCount?: number } = {}): Promise<Uint8Array> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const spec of entries) {
    const { compressed, size, crc } = await deflateEntry(spec);
    const declared = spec.declaredSize ?? size;
    const name = Buffer.from(spec.name, "utf8");
    const method = spec.stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const count = opts.eocdCount ?? entries.length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

/** Namuna (template) uchun eng kichik to'g'ri PPTX qismlari. */
export const TEMPLATE_PARTS = {
  presentation:
    '<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldMasterIdLst><p:sldMasterId r:id="rId1"/></p:sldMasterIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  presentationRels:
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>',
  masterRels:
    '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas/relationships/theme" Target="../theme/theme1.xml"/></Relationships>',
  master: '<?xml version="1.0"?><p:sldMaster><p:cSld><p:spTree></p:spTree></p:cSld></p:sldMaster>',
  layout:
    '<?xml version="1.0"?><p:sldLayout type="obj"><p:cSld name="Sarlavha va matn"><p:spTree>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr></p:sp>' +
    "</p:spTree></p:cSld></p:sldLayout>",
  theme:
    '<?xml version="1.0"?><a:theme><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="112233"/></a:dk1><a:accent1><a:srgbClr val="AABBCC"/></a:accent1></a:clrScheme>' +
    '<a:fontScheme><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
  contentTypes: '<?xml version="1.0"?><Types></Types>',
};

/** To'g'ri minimal namuna; `override` bilan istalgan qismni almashtirish mumkin. */
export function templateEntries(override: Partial<Record<string, ZipEntrySpec>> = {}): ZipEntrySpec[] {
  const base: Record<string, ZipEntrySpec> = {
    "[Content_Types].xml": { name: "[Content_Types].xml", data: TEMPLATE_PARTS.contentTypes },
    "ppt/presentation.xml": { name: "ppt/presentation.xml", data: TEMPLATE_PARTS.presentation },
    "ppt/_rels/presentation.xml.rels": { name: "ppt/_rels/presentation.xml.rels", data: TEMPLATE_PARTS.presentationRels },
    "ppt/slideMasters/slideMaster1.xml": { name: "ppt/slideMasters/slideMaster1.xml", data: TEMPLATE_PARTS.master },
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: TEMPLATE_PARTS.masterRels,
    },
    "ppt/slideLayouts/slideLayout1.xml": { name: "ppt/slideLayouts/slideLayout1.xml", data: TEMPLATE_PARTS.layout },
    "ppt/theme/theme1.xml": { name: "ppt/theme/theme1.xml", data: TEMPLATE_PARTS.theme },
  };
  for (const [k, v] of Object.entries(override)) if (v) base[k] = v;
  return Object.values(base);
}

/** `fn` davomida heap + ArrayBuffer o'sishining eng katta qiymati (bayt). */
export async function peakGrowth<T>(fn: () => Promise<T>): Promise<{ result: T | undefined; error: unknown; peak: number }> {
  const base = () => {
    const m = process.memoryUsage();
    return m.heapUsed + m.arrayBuffers;
  };
  const start = base();
  let peak = 0;
  const sample = () => {
    peak = Math.max(peak, base() - start);
  };
  const timer = setInterval(sample, 2);
  let result: T | undefined;
  let error: unknown;
  try {
    result = await fn();
  } catch (e) {
    error = e;
  } finally {
    sample();
    clearInterval(timer);
  }
  return { result, error, peak };
}
