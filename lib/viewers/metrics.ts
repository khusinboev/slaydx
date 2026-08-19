/** Word A4 at 96 dpi — OTME: left 3cm, right 1.5cm, top/bottom 2cm */
export const A4 = {
  wMm: 210,
  hMm: 297,
  wPx: 794,
  hPx: 1123,
  padTopPx: 76,
  padBottomPx: 76,
  padLeftPx: 113,
  padRightPx: 57,
  footerPx: 28,
} as const;

export const LANDSCAPE = {
  wMm: 297,
  hMm: 210,
  wPx: 1123,
  hPx: 794,
  padPx: 48,
} as const;

export const SLIDE = {
  w: 1280,
  h: 720,
} as const;

export const ZOOM_STEPS = [50, 75, 90, 100, 125, 150] as const;

export function contentHeightPx(opts?: { footer?: boolean }) {
  const footer = opts?.footer === false ? 0 : A4.footerPx;
  return A4.hPx - A4.padTopPx - A4.padBottomPx - footer;
}

export function contentWidthPx() {
  return A4.wPx - A4.padLeftPx - A4.padRightPx;
}
