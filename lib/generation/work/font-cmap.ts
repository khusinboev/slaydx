/**
 * MINIMAL TTF O'QUVCHI (qo'lyozma shriftlari) — fontkit'siz.
 *
 * Faqat ikki narsa kerak: (1) shrift qaysi belgilarni YOPADI (`cmap`,
 * format 4 va 12) — yo'qligi tofu `□` beradi; (2) qator o'lchamlari
 * (`head.unitsPerEm`, `hhea` ascent/descent) — ko'ruvchi matn
 * asosini (baseline) daftar chizig'iga tushirishi uchun. Izomorf: faqat
 * `Uint8Array`/`DataView`, Node importi yo'q (test va `scripts/
 * check-handwriting-fonts.mts` ishlatadi).
 */

type Tables = Map<string, { offset: number; length: number }>;

function tablesOf(view: DataView): Tables {
  const n = view.getUint16(4);
  const out: Tables = new Map();
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    let tag = "";
    for (let k = 0; k < 4; k++) tag += String.fromCharCode(view.getUint8(o + k));
    out.set(tag, { offset: view.getUint32(o + 8), length: view.getUint32(o + 12) });
  }
  return out;
}

/** Shrift qamrab olgan Unicode nuqtalari (glyph 0 = `.notdef` hisoblanmaydi). */
export function fontCodepoints(bytes: Uint8Array): Set<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cmap = tablesOf(view).get("cmap");
  if (!cmap) throw new Error("cmap jadvali yo'q");
  const base = cmap.offset;
  const count = view.getUint16(base + 2);
  const set = new Set<number>();
  for (let i = 0; i < count; i++) {
    const sub = base + view.getUint32(base + 8 + i * 8);
    const format = view.getUint16(sub);
    if (format === 4) {
      const segs = view.getUint16(sub + 6) / 2;
      const endAt = sub + 14;
      const startAt = endAt + segs * 2 + 2;
      const deltaAt = startAt + segs * 2;
      const rangeAt = deltaAt + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = view.getUint16(endAt + s * 2);
        const start = view.getUint16(startAt + s * 2);
        const delta = view.getInt16(deltaAt + s * 2);
        const rangeOffset = view.getUint16(rangeAt + s * 2);
        for (let c = start; c <= end && c < 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            glyph = view.getUint16(rangeAt + s * 2 + rangeOffset + (c - start) * 2);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) set.add(c);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        const glyph = view.getUint32(at + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start)) set.add(c);
      }
    }
  }
  return set;
}

export type FontMetrics = {
  unitsPerEm: number;
  /** `hhea` — Chrome/LibreOffice shu qiymatlar bilan qator qutisini hisoblaydi. */
  ascent: number;
  descent: number;
  lineGap: number;
};

export function fontMetrics(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = tablesOf(view);
  const head = t.get("head");
  const hhea = t.get("hhea");
  if (!head || !hhea) throw new Error("head/hhea jadvali yo'q");
  return {
    unitsPerEm: view.getUint16(head.offset + 18),
    ascent: view.getInt16(hhea.offset + 4),
    descent: -view.getInt16(hhea.offset + 6),
    lineGap: view.getInt16(hhea.offset + 8),
  };
}

/** `text` dagi shrift YOPMAYDIGAN belgilar (takrorlanmagan). */
export function missingChars(codepoints: Set<number>, text: string): string[] {
  const out = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x20 || cp === 0xa0) continue;
    if (!codepoints.has(cp)) out.add(ch);
  }
  return [...out];
}
