"use client";

/**
 * NATIJA EKRANI (AUDIT-22 WP-C).
 *
 * Ball SERVERDAN keladi (`POST /api/o/[token]/submit` javobi) — o'yinchi
 * tomoni uni hisoblamaydi va hisoblay olmaydi. Qaysi topshiriq xato
 * bo'lgani KO'RSATILMAYDI: aks holda havolani olgan o'quvchi bir
 * urinishdan keyin butun javob varag'ini bilib olardi va uni sinfga
 * tarqatardi (`submit` route izohi).
 *
 * «Yana o'ynash» — YANGI urinish: natijalar jadvaliga yangi qator
 * tushadi (o'qituvchi nechanchi urinish ekanini vaqt bo'yicha ko'radi),
 * chunki urinishni «yangilash» kimdir ballini pasaytirganda eski, yaxshi
 * natijani jimgina yo'q qilardi.
 */
export function Result({
  score,
  total,
  percent,
  name,
  onAgain,
}: {
  score: number;
  total: number;
  percent: number;
  name: string;
  onAgain: () => void;
}) {
  const tone = percent >= 80 ? "Zo‘r natija!" : percent >= 50 ? "Yaxshi, yana mashq qiling." : "Takrorlab, qayta urinib ko‘ring.";

  return (
    <section className="bg-card rounded-2xl border p-6 text-center" data-game-result>
      <p className="text-muted-foreground text-sm">{name}</p>
      <h1 className="mt-1 text-lg font-semibold">Natija</h1>

      <p className="mt-3 text-4xl font-bold tabular-nums" data-score>
        {score} <span className="text-muted-foreground text-2xl font-medium">/ {total}</span>
      </p>
      <p className="text-primary mt-1 text-lg font-semibold tabular-nums" data-percent>
        {percent}%
      </p>

      <div className="bg-muted mt-4 h-2 overflow-hidden rounded-full" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="bg-primary h-full" style={{ width: `${percent}%` }} />
      </div>

      <p className="mt-4 text-sm">{tone}</p>
      <p className="text-muted-foreground mt-1 text-xs">Natijangiz o‘qituvchingizga yuborildi.</p>

      <button
        type="button"
        data-again
        className="bg-primary text-primary-foreground mt-5 h-12 w-full rounded-xl text-[16px] font-semibold"
        onClick={onAgain}
      >
        Yana o‘ynash
      </button>
    </section>
  );
}
