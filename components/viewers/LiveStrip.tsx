import type { LiveView } from "./useReveal";

/**
 * Jonli holat tasmasi — ko'ruvchi TAGIDA turadigan bir qatorli holat.
 *
 * Nega progress bar emas, tasma: deka allaqachon ekranda chizilyapti,
 * ya'ni asosiy maydonni holat kartochkasi egallashi noto'g'ri bo'lardi.
 * Ko'rsatiladigan raqamlar HAQIQIY (`liveProgress`/`liveStep` — dvigatel
 * hodisalaridan), soxta `1 − e^(−t/T)` egri chizig'i emas: «7/12 slayd»
 * ni sanab bo'ladi, foizni esa yo'q.
 */
export function LiveStrip({ live }: { live: LiveView }) {
  const total = live.slides.length;
  const parts: string[] = [];
  if (total > 0) parts.push(`${live.written.length}/${total} slayd`);
  if (live.images.want > 0) parts.push(`${live.images.got}/${live.images.want} rasm`);
  if (live.research) parts.push(`${live.research.sources} manba`);

  return (
    <div data-live-strip="1" className="no-print shrink-0 border-t border-white/10 bg-[#252525] px-4 py-2 text-white">
      <div className="flex items-center gap-3 text-[12px]">
        <span
          className="slx-typing inline-block size-2 shrink-0 rounded-full bg-emerald-400"
          aria-hidden="true"
        />
        <span className="truncate font-medium">{live.step}</span>
        <span className="ml-auto shrink-0 tabular-nums text-white/60">{parts.join(" · ")}</span>
        <span className="shrink-0 tabular-nums text-white/80">{live.progress}%</span>
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={live.progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-emerald-400 transition-all" style={{ width: `${live.progress}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-white/45">
        Sahifani yopsangiz ham ish davom etadi — keyin «Mening fayllarim» dan ochasiz.
      </p>
    </div>
  );
}
