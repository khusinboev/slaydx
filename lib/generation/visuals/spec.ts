import type { Box, PlanCtx, SlidePlan } from "../slide-layout";
import type { SlideLayout, SlideModel, SlideTheme } from "../slide-types";

/**
 * DIZAYN SPETSIFIKATSIYASI (Shablonlar 2).
 *
 * Har shablonning o'z dizayni bor (`lib/generation/visuals/<id>.ts`):
 * u o'zi chizadigan maketlarni `plan` xaritasida beradi (kamida titul,
 * bo'lim, bandlar, reja, iqtibos, yakun — shular dizaynni bir qarashda
 * ajratib turadi), qolgan maketlar (ikki ustun, raqamlar, bosqichlar,
 * jadval, test, manbalar, javoblar) `base` — eski yetti oiladan biri —
 * bilan `slide-layout.ts` dagi tarmoqlardan chiziladi.
 *
 * Rasm joyi (`photo`) ham dizaynniki: dumaloq rasm uchun KVADRAT quti,
 * chap/o'ng ustun, to'la ekran. `slide-images.ts` shu qutiga qarab rasm
 * nisbatini so'raydi, `ImageWaitPlaque` va muharrir tugmalari ham shu
 * yerdan o'qiydi — ya'ni «rasm qayerda» degan savolga BITTA javob.
 *
 * Qoidalar (testlar bilan qulflangan, `tests/slide-visuals.test.mts`):
 *   1. Har qatlam slayd ichida (0..13.333 × 0..7.5), kolontitul `FOOT_Y`.
 *   2. Modeldan kelgan har matn `src`/`srcLines` ko'tarsin (tahrir);
 *      dekorativ matn (raqam, «→», tirnoq) `src`siz.
 *   3. Ranglar faqat O'LCHANGAN juftliklar: `text/bg`, `muted/bg`,
 *      `accentInk/bg|surface`, `titleText/titleBg`, `titleMuted/titleBg`;
 *      `accent` — faqat to'ldirish, matn rangi emas.
 *   4. Rasm YO'Q bo'lsa ham maket buzilmasin (rangli blok/dekor).
 *   5. `ctx.reserve` — logo bo'lsa yuqori sarlavha shuncha toraysin.
 */
export type PlanFn = (s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx) => SlidePlan;

export const LEGACY_VISUALS = ["classic", "hero-split", "cards", "lab", "timeline", "magazine", "dense"] as const;
export type LegacyVisual = (typeof LEGACY_VISUALS)[number];

export const DESIGN_VISUALS = [
  "academic",
  "circle",
  "notebook",
  "formal",
  "story",
  "split",
  "bold",
  "dashboard",
  "rail",
  "editorial",
] as const;
export type DesignVisual = (typeof DESIGN_VISUALS)[number];

export type VisualSpec = {
  id: DesignVisual;
  /** Maxsus chizilmagan maketlar uchun eski oila. */
  base: LegacyVisual;
  /** Rasm joyi (dyuym) maket bo'yicha; `null` — bu maketda rasm YO'Q. Yo'q kalit — `base` qoidasi. */
  photo?: Partial<Record<SlideLayout, Box | null>>;
  /** Rasm to'la ekran va matn ustida turadigan maketlar (`sidePhotoBox` to'qnashuv sanamaydi). */
  fullBleed?: SlideLayout[];
  /** Dizayn o'zi chizadigan maketlar. */
  plan: Partial<Record<SlideLayout, PlanFn>>;
};

export function isDesignVisual(v: string): v is DesignVisual {
  return (DESIGN_VISUALS as readonly string[]).includes(v);
}
