/**
 * Surat kesish matematikasi (Rezyume 2, 6-band) — izomorf.
 *
 * Kesish KLIENTDA `<canvas>` bilan bajariladi, lekin hisob-kitob shu
 * yerda: canvas'siz unit test yozish uchun (jsdom da `getContext`
 * yo'q). Dialog ham, test ham bir xil funksiyani chaqiradi.
 *
 * Model: `crop = {x, y, zoom}` — `x`/`y` suratning KO'RINADIGAN
 * markazi (0..1 asl surat koordinatasida), `zoom` ≥ 1 (1 = surat
 * ramkaga to'liq sig'adi, kattasi — yaqinlashtiriladi).
 */

export type Crop = { x: number; y: number; zoom: number };
export const DEFAULT_CROP: Crop = { x: 0.5, y: 0.5, zoom: 1 };
export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 4;
/** Chiqish tomoni (kvadrat) — DOCX uchun 36 mm da ~136 px, zaxira bilan. */
export const CROP_OUT_SIZE = 600;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return CROP_MIN_ZOOM;
  return Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, z));
}

/**
 * Ramkaga tushadigan manba to'rtburchagi (asl surat pikselida).
 *
 * `cover` mantiqi: kvadrat ramka to'liq to'ladi — qisqa tomon bo'yicha
 * kesiladi. Markaz chegaradan chiqib ketmasligi uchun klamplanadi, aks
 * holda foydalanuvchi suratni ramkadan «sudrab chiqarib» oq maydon
 * qoldirardi.
 */
export function cropRect(imgW: number, imgH: number, crop: Crop): { sx: number; sy: number; size: number } {
  const zoom = clampZoom(crop.zoom);
  const base = Math.min(imgW, imgH);
  const size = Math.max(1, base / zoom);
  const cx = Math.min(1, Math.max(0, Number.isFinite(crop.x) ? crop.x : 0.5)) * imgW;
  const cy = Math.min(1, Math.max(0, Number.isFinite(crop.y) ? crop.y : 0.5)) * imgH;
  const sx = Math.min(Math.max(cx - size / 2, 0), Math.max(imgW - size, 0));
  const sy = Math.min(Math.max(cy - size / 2, 0), Math.max(imgH - size, 0));
  return { sx, sy, size };
}

/** Sudrash (piksel) → yangi markaz. Ramka o'lchamiga nisbatan hisoblanadi. */
export function panCrop(crop: Crop, dxPx: number, dyPx: number, frame: number, imgW: number, imgH: number): Crop {
  const { size } = cropRect(imgW, imgH, crop);
  const k = size / Math.max(1, frame);
  const x = Math.min(1, Math.max(0, crop.x - (dxPx * k) / Math.max(1, imgW)));
  const y = Math.min(1, Math.max(0, crop.y - (dyPx * k) / Math.max(1, imgH)));
  return { x, y, zoom: clampZoom(crop.zoom) };
}
