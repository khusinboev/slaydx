/**
 * Raster images embedded in a PPTX (prod incident 2026-10-10: 20-slide decks
 * came out at 28 MB and failed the 25 MB storage limit, because every image
 * was embedded exactly as the provider returned it).
 *
 * Rules (`shrinkBuffer`):
 *  - long side is capped (never upscaled): 1600 px normally, 1100 px in the
 *    compact re-pack;
 *  - an image without real transparency becomes a JPEG (quality 80 / 70);
 *  - a PNG with real transparency stays a (palette) PNG;
 *  - an image that is already small and within the cap is left untouched;
 *  - the result is used only when it is smaller than the original;
 *  - anything sharp cannot decode is left untouched (the caller embeds it as is).
 *
 * 1600 px over a 13.33 in wide slide is ~120 dpi: no visible pixelation at
 * slide size, and a typical 1.4 MB generated PNG becomes ~250 KB.
 */
import type { ImageBytes } from "./slide-images";

/** Largest stored file. Mirrors `lib/server/storage.ts MAX_FILE_BYTES` (a test keeps them equal). */
export const PPTX_SIZE_LIMIT = 25 * 1024 * 1024;

export type ImageProfile = { name: "normal" | "compact"; maxSide: number; quality: number };

export const IMAGE_NORMAL: ImageProfile = { name: "normal", maxSide: 1600, quality: 80 };
export const IMAGE_COMPACT: ImageProfile = { name: "compact", maxSide: 1100, quality: 70 };

/** A JPEG within the cap that is already this small is not re-encoded. */
const KEEP_JPEG_BYTES = 350 * 1024;
/** A transparent PNG within the cap that is already this small is kept. */
const KEEP_PNG_BYTES = 300 * 1024;
const MAX_INPUT_PIXELS = 120_000_000;

export type ShrunkBuffer = { bytes: Buffer; type: "jpg" | "png"; w: number; h: number };

/** Smaller copy of `buf`, or `null` when the original should be kept. Never throws. */
export async function shrinkBuffer(buf: Buffer, type: "jpg" | "png", profile: ImageProfile): Promise<ShrunkBuffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    sharp.cache(false);
    const opts = { failOn: "error" as const, limitInputPixels: MAX_INPUT_PIXELS };
    const meta = await sharp(buf, opts).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return null;
    const needsResize = Math.max(w, h) > profile.maxSide;
    const transparent = Boolean(meta.hasAlpha) && !(await sharp(buf, opts).stats()).isOpaque;
    if (!needsResize && buf.byteLength <= (transparent ? KEEP_PNG_BYTES : KEEP_JPEG_BYTES) && (type === "jpg" || transparent)) return null;

    let pipe = sharp(buf, opts)
      .rotate()
      .resize({ width: profile.maxSide, height: profile.maxSide, fit: "inside", withoutEnlargement: true });
    let outType: "jpg" | "png";
    if (transparent) {
      pipe = pipe.png({ compressionLevel: 9, palette: true, quality: profile.quality, effort: 7 });
      outType = "png";
    } else {
      pipe = pipe.flatten({ background: "#ffffff" }).jpeg({ quality: profile.quality, mozjpeg: true });
      outType = "jpg";
    }
    const { data, info } = await pipe.toBuffer({ resolveWithObject: true });
    if (data.byteLength >= buf.byteLength) return null;
    return { bytes: data, type: outType, w: info.width, h: info.height };
  } catch {
    return null;
  }
}

/** `ImageBytes` (data: payload without the `data:` prefix) → smaller `ImageBytes`, or the same object. */
export async function shrinkImage(img: ImageBytes, profile: ImageProfile): Promise<ImageBytes> {
  const comma = img.data.indexOf(",");
  const buf = Buffer.from(comma === -1 ? img.data : img.data.slice(comma + 1), "base64");
  const out = await shrinkBuffer(buf, img.type, profile);
  if (!out) return img;
  const mime = out.type === "png" ? "image/png" : "image/jpeg";
  return { data: `${mime};base64,${out.bytes.toString("base64")}`, type: out.type, w: out.w, h: out.h };
}
