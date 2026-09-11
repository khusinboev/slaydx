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

/** Yotiq (landscape) varaqdagi foydalanish mumkin bo'lgan balandlik. */
export function landscapeContentHeightPx(opts?: { footer?: boolean }) {
  const footer = opts?.footer === false ? 0 : A4.footerPx;
  // `.word-inner-ls` padding: 12mm yuqori, 14mm past.
  const padTop = Math.round((12 / 25.4) * 96);
  const padBottom = Math.round((14 / 25.4) * 96);
  return LANDSCAPE.hPx - padTop - padBottom - footer;
}

/** Millimetr → CSS piksel (96 dpi) — DOCX `mm × 56.7` twip bilan bir juft. */
export function mmPx(mm: number): number {
  return (mm / 25.4) * 96;
}

/**
 * Rezyume chekinishlari — YAGONA MANBA (Rezyume 2, AUDIT-15).
 *
 * Bu sonlarni ko'ruvchi (`ResumePage` CSS `padding`) ham, DOCX
 * (`renderResumeDocx` katak `margins`/sahifa chegarasi) ham AYNAN shu
 * yerdan oladi. Ilgari rezyume ko'ruvchisi `px-8 py-8` (Tailwind), DOCX
 * esa 340/280 twip ishlatardi — ikkalasi mustaqil sonlar edi va ekran
 * bilan fayl bir-biriga mos kelmasdi.
 *
 * Panelli (`sidebar-*`) shablonlarda sahifa chegarasi 0 — chekinishni
 * katakning o'zi beradi; bir ustunli va bannerda esa sahifa chegarasi
 * (`marginsMm`) ishlaydi.
 */
export const RESUME_PAD_MM = {
  aside: { x: 8, y: 11 },
  mainSide: { x: 9, y: 11 },
  /** Banner ostidagi birinchi bo'limgacha bo'shliq. */
  bannerGap: 8,
  banner: { x: 10, y: 8 },
} as const;

/**
 * Ko'nikmalar oqimidagi ajratgich — ko'ruvchi ham, DOCX ham AYNAN shuni
 * chizadi. DOCX da haqiqiy "chip" (fon bilan o'ralgan inline blok) yo'q:
 * run shading qator uzilishida sinadi va ko'p so'zli ko'nikma ramkasidan
 * chiqib ketadi (LibreOffice ko'zdan kechiruvida ko'rilgan). Shuning uchun
 * ikkala tomon ham oddiy oqim chizadi va ajratgich HAQIQIY matn bo'ladi.
 */
export const CHIP_SEP = " · ";

/** `resumeMainPadMm` / `resumeMainHeightPx` uchun kerakli shablon maydonlari. */
export type ResumeMetricsTemplate = {
  columns: "single" | "sidebar-left" | "sidebar-right" | "split-main";
  /** AUDIT-16: banner endi ustun tuzilmasi emas, SARLAVHA uslubi. */
  header: "plain" | "centered" | "banner" | "card" | "aside";
  bannerMm: number;
  marginsMm: { top: number; bottom: number; left: number; right: number };
};

/** Asosiy ustun chekinishi (mm). `pageIndex > 0` da banner qaytmaydi. */
export function resumeMainPadMm(t: ResumeMetricsTemplate, pageIndex = 0): { x: number; top: number; bottom: number } {
  if (t.columns === "sidebar-left" || t.columns === "sidebar-right") {
    return { x: RESUME_PAD_MM.mainSide.x, top: RESUME_PAD_MM.mainSide.y, bottom: RESUME_PAD_MM.mainSide.y };
  }
  if (t.header === "banner") {
    const banner = pageIndex === 0 ? t.bannerMm + RESUME_PAD_MM.bannerGap : RESUME_PAD_MM.bannerGap;
    return { x: t.marginsMm.left, top: banner, bottom: t.marginsMm.bottom };
  }
  return { x: t.marginsMm.left, top: t.marginsMm.top, bottom: t.marginsMm.bottom };
}

/**
 * Rezyume asosiy ustuni uchun foydali balandlik (px).
 *
 * Shablonga BOG'LIQ: bannerli maketda birinchi varaq banner balandligicha
 * qisqaradi, panelli maketda esa sahifa chegarasi o'rniga katak
 * chekinishi ishlaydi. Ilgari bu qat'iy `A4.hPx - 64 - 36` edi va olti
 * shablonning beshtasida noto'g'ri bo'lardi.
 */
export function resumeMainHeightPx(t: ResumeMetricsTemplate, pageIndex = 0): number {
  const pad = resumeMainPadMm(t, pageIndex);
  return Math.round(A4.hPx - mmPx(pad.top + pad.bottom) - A4.footerPx);
}
