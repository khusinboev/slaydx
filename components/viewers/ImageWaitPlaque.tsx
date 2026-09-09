import type { SlideVisual } from "@/lib/generation/slide-templates";
import { boxStyle, cssColor, photoSlot } from "@/lib/generation/slide-layout";
import type { SlideTheme } from "@/lib/generation/slide-types";

/**
 * «Rasm izlanmoqda…» — rasm kelguncha uning JOYINI band qiladigan
 * plashka.
 *
 * Quti aynan `photoSlot(layout, visual)` dan olinadi, ya'ni rasm
 * yetib kelganda maket SURILMAYDI: plashka o'chadi, o'rniga xuddi
 * shu to'rtburchakda foto paydo bo'ladi. Ilgari bunday joy egallanmasa,
 * matn avval keng chizilib, keyin rasm kelganda torayardi — deka
 * ko'z oldida «sakrardi».
 *
 * Bu komponent SlideStage ning `overlay` slotidan FOYDALANMAYDI — u
 * tahrirlash paketiniki. Jonli qatlam sahna ichida o'z `absolute`
 * qatlamida turadi va slayd bilan birga masshtablanadi.
 */
export function ImageWaitPlaque({
  layout,
  visual = "classic",
  theme,
}: {
  layout: string;
  visual?: SlideVisual;
  theme: SlideTheme;
}) {
  const slot = photoSlot(layout, visual);
  // Maketda rasm joyi yo'q — plashka ham yo'q (aks holda u matn ustiga
  // tushardi).
  if (!slot) return null;
  return (
    <div
      data-image-wait="1"
      className="absolute flex items-center justify-center"
      style={{ ...boxStyle(slot), background: cssColor(theme.text, 0.08) }}
    >
      <span
        className="slx-shimmer rounded-full px-6 py-3"
        style={{ background: cssColor(theme.bg, 0.75), color: cssColor(theme.text, 0.7), fontSize: 26, fontWeight: 600 }}
      >
        Rasm izlanmoqda…
      </span>
    </div>
  );
}
