import type { SlideTheme } from "@/lib/generation/slide-types";
import { SLIDE } from "@/lib/viewers/metrics";
import { cssColor } from "@/lib/generation/slide-layout";

/**
 * Matni hali yozilmagan slaydning ESKIZI.
 *
 * Nega bo'sh joy emas: reja tuzilgan zahoti nechta slayd bo'lishi
 * MA'LUM (`plan` hodisasi), ya'ni foydalanuvchi ishning hajmini darhol
 * ko'rishi mumkin. Bo'sh ekran esa «hech narsa bo'lmayapti» degan
 * taassurot beradi. Har skelet o'z RASTINI (`roles[i]` — «Kirish»,
 * «Xulosa» …) yozadi, shuning uchun kutish paytida ham deka mazmuni
 * o'qiladi.
 *
 * O'lcham `SlideCanvas` bilan bir xil (1280×720) — sahnadagi va eskiz
 * panelidagi masshtab hisoblari o'zgarmaydi, almashinuv sakramaydi.
 */
export function SkeletonSlide({
  theme,
  role,
  index,
  compact = false,
}: {
  theme: SlideTheme;
  /** `LiveDeck.roles[i]` — reja bergan slayd vazifasi. */
  role?: string;
  index: number;
  /** Eskiz panelida raqam va rol matni kichikroq chiziladi. */
  compact?: boolean;
}) {
  const bar = cssColor(theme.text, 0.13);
  const strong = cssColor(theme.accent, 0.5);
  return (
    <div
      data-skeleton="1"
      className="relative overflow-hidden"
      style={{ width: SLIDE.w, height: SLIDE.h, background: theme.bg }}
    >
      <div className="absolute" style={{ left: 72, top: 96, width: 96, height: 10, background: strong, borderRadius: 6 }} />
      <div
        className="slx-shimmer absolute"
        style={{ left: 72, top: 140, width: 720, height: 56, background: bar, borderRadius: 10 }}
      />
      {[0, 1, 2].map((n) => (
        <div
          key={n}
          className="slx-shimmer absolute"
          style={{
            left: 72,
            top: 268 + n * 76,
            width: [880, 780, 620][n],
            height: 28,
            background: bar,
            borderRadius: 8,
            animationDelay: `${n * 0.16}s`,
          }}
        />
      ))}
      {role ? (
        <div
          className="absolute"
          style={{
            left: 72,
            top: SLIDE.h - 120,
            color: cssColor(theme.text, 0.55),
            fontSize: compact ? 34 : 26,
            fontWeight: 600,
          }}
        >
          {role}
        </div>
      ) : null}
      <div
        className="absolute"
        style={{ right: 72, bottom: 56, color: cssColor(theme.text, 0.35), fontSize: 24 }}
      >
        {index + 1}
      </div>
    </div>
  );
}
