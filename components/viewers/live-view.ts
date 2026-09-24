import type { LiveView } from "./useReveal";

/**
 * `live` propi `unknown` bo'lib keladi (transport paketi uni serverdan
 * xom JSON sifatida oladi). Ko'ruvchi ishonchsiz ma'lumotdan chizmasligi
 * uchun shakl SHU YERDA bir marta tekshiriladi: kerakli maydonlardan
 * biri yetishmasa jonli rejim umuman yoqilmaydi va oddiy ko'ruvchi
 * ishlaydi.
 *
 * Alohida barg modulda (FE-11): natija sahifasi shu tekshiruv uchun
 * butun `SlideViewer` ni (va `planSlide` dvigatelini) birinchi
 * yuklanishga tortmasin — ko'ruvchining o'zi `import()` bilan keladi.
 */
export function asLiveView(live: unknown): LiveView | null {
  if (!live || typeof live !== "object") return null;
  const v = live as Partial<LiveView>;
  if (!Array.isArray(v.slides) || v.slides.length === 0) return null;
  if (!Array.isArray(v.written) || !Array.isArray(v.roles) || !Array.isArray(v.imageWait)) return null;
  if (!v.images || typeof v.images.got !== "number" || typeof v.images.want !== "number") return null;
  if (typeof v.progress !== "number" || typeof v.step !== "string") return null;
  // `liveDocOf` shu uchtasisiz hujjat qura olmaydi.
  if (!v.meta || typeof v.meta !== "object" || typeof v.theme !== "string" || typeof v.template !== "string") return null;
  return v as LiveView;
}
