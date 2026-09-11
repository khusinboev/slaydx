/**
 * Maqola 2 (AUDIT-17) WP3 — SVG → PNG (`sharp`, librsvg).
 *
 * Zichlik SVG `viewBox`/`width` va maqsad piksel kengligidan hisoblanadi:
 * 160 mm @ 300 dpi = 1890 px; SVG kengligi 605 px (96 dpi) → density =
 * 72 × 1890 / 605 ≈ 224.9 (librsvg 1 px = 1/72 dyuym deb oladi). `sharp`
 * kasr zichlikni qabul qiladi — kenglik AYNAN 1890 chiqadi (sinaldi).
 *
 * Shriftlar: SVG `font-family` ro'yxati (TNR → Liberation Serif → Noto
 * Serif) — Alpine konteynerida `ttf-liberation` + `font-noto` bor.
 *
 * `sharp` yuklanmasa/xato bersa → `null` (chaqiruvchi fallback ro'yxat).
 * Server-only: dinamik import — modul viewer/klient bundle'iga tortilmaydi.
 */

export type PngOpts = { widthMm?: number; dpi?: number };
export type FigurePng = { png: Buffer; w: number; h: number };

/** SVG kengligi px — `viewBox` (afzal) yoki `width` atributidan. */
export function svgWidthPx(svg: string): number | null {
  const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+[\d.]+\s*"/.exec(svg);
  if (vb) {
    const w = Number(vb[1]);
    if (Number.isFinite(w) && w > 0) return w;
  }
  const wa = /<svg[^>]*\swidth="([\d.]+)(?:px)?"/.exec(svg);
  if (wa) {
    const w = Number(wa[1]);
    if (Number.isFinite(w) && w > 0) return w;
  }
  return null;
}

/** Maqsad kenglik px: 160 mm @ 300 dpi → 1890. */
export function targetWidthPx(widthMm = 160, dpi = 300): number {
  return Math.round((widthMm / 25.4) * dpi);
}

export async function figurePng(svg: string, opts: PngOpts = {}): Promise<FigurePng | null> {
  const svgW = svgWidthPx(svg);
  if (!svgW) return null;
  const target = targetWidthPx(opts.widthMm ?? 160, opts.dpi ?? 300);
  const density = (72 * target) / svgW;
  try {
    const mod = await import("sharp");
    const sharp = mod.default;
    const { data, info } = await sharp(Buffer.from(svg), { density })
      .flatten({ background: "#ffffff" })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) return null;
    return { png: data, w: info.width, h: info.height };
  } catch {
    return null;
  }
}
