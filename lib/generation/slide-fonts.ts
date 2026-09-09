/**
 * Slayd SHRIFT OILALARI — reyestr, yagona manba.
 *
 * Foydalanuvchi ko'ruvchida matn qutisiga shrift tanlaydi (`style` op,
 * `SlideModel.font`). Tanlov ikki joyda o'qiladi va IKKALASI shu
 * ro'yxatdan: `applyFontOverrides` (`slide-layout.ts`) qatlamga `face`
 * yozadi — `render-pptx.ts` uni `fontFace` sifatida faylga qo'yadi,
 * `SlideCanvas` esa `fontCss(face)` bilan brauzerga beradi.
 *
 * Nega aynan shu 8 ta: hammasi Windows va macOS da O'RNATILGAN (PPTX
 * ochilganda almashmaydi), o'zbek `ʻ` (U+02BB) belgisini chizadi va
 * Linux da metrik mos almashuvi bor (Liberation/Carlito/Caladea/Gelasio)
 * — ya'ni sayt ko'ruvchisi uch platformada ham deyarli bir xil joylaydi.
 * Google Fonts ATAYLAB yo'q: saytda chiroyli, lekin foydalanuvchi
 * kompyuterida bo'lmagani uchun PowerPoint uni almashtiradi — «ko'rdim =
 * oldim» buziladi.
 *
 * `em` — o'rtacha belgi kengligi (shrift o'lchamiga nisbatan). Maket
 * shriftni Arial (`CHAR_EM` = 0.55) uchun sig'diradi; kengroq shrift
 * tanlanganda `applyFontOverrides` o'lchamni `CHAR_EM / em` ga
 * kichraytiradi, matn qutidan chiqib ketmasin.
 */
export const SLIDE_FONTS = [
  { id: "arial", label: "Arial", face: "Arial", css: 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif', em: 0.55 },
  { id: "calibri", label: "Calibri", face: "Calibri", css: 'Calibri, Carlito, "Segoe UI", sans-serif', em: 0.5 },
  { id: "times", label: "Times New Roman", face: "Times New Roman", css: '"Times New Roman", "Liberation Serif", Times, serif', em: 0.48 },
  { id: "georgia", label: "Georgia", face: "Georgia", css: 'Georgia, Gelasio, "DejaVu Serif", serif', em: 0.57 },
  { id: "verdana", label: "Verdana", face: "Verdana", css: 'Verdana, "DejaVu Sans", Geneva, sans-serif', em: 0.63 },
  { id: "tahoma", label: "Tahoma", face: "Tahoma", css: 'Tahoma, "DejaVu Sans Condensed", Geneva, sans-serif', em: 0.55 },
  { id: "trebuchet", label: "Trebuchet MS", face: "Trebuchet MS", css: '"Trebuchet MS", "Fira Sans", sans-serif', em: 0.53 },
  { id: "cambria", label: "Cambria", face: "Cambria", css: 'Cambria, Caladea, "Droid Serif", serif', em: 0.52 },
] as const;

export type SlideFont = (typeof SLIDE_FONTS)[number];
export type SlideFontId = SlideFont["id"];

export const FONT_BY_ID: Record<SlideFontId, SlideFont> = Object.fromEntries(
  SLIDE_FONTS.map((f) => [f.id, f]),
) as Record<SlideFontId, SlideFont>;

const BY_FACE: Record<string, SlideFont> = Object.fromEntries(SLIDE_FONTS.map((f) => [f.face, f]));

export function isSlideFontId(v: unknown): v is SlideFontId {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(FONT_BY_ID, v);
}

/**
 * PPTX `fontFace` nomidan brauzer uchun CSS ro'yxati.
 *
 * Reyestrda yo'q nom (eski hujjat, qo'lda yozilgan) — nomning o'zi
 * qo'shtirnoqda + `sans-serif` zaxira; bo'sh nom — bo'sh satr (chaqiruvchi
 * standart `SLIDE_FONT` ga qaytadi).
 */
export function fontCss(face: string): string {
  const f = BY_FACE[face];
  if (f) return f.css;
  const clean = face.replace(/["\\]/g, "").trim();
  return clean ? `"${clean}", sans-serif` : "";
}
