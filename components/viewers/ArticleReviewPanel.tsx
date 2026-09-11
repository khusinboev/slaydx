import type { ArticleReview, ReviewCheck, ReviewLevel } from "@/lib/generation/article/types";

/**
 * Tayyorlik hisoboti paneli (Maqola 2, AUDIT-17 WP5).
 *
 * Ball halqasi (0–100: ≥80 yashil, 60–79 sariq, <60 qizil) + 5 blok —
 * Tuzilma · Manbalar · Vizuallar · Ilmiy mazmun · AI izi — har birida
 * `ReviewCheck` ro'yxati (✅/⚠️/❌, yorliq, izoh), baholovchi izohlari va
 * `fix` li bandlarda «Tuzatish» tugmasi — `onFix(fix)` (WP7: `ResultView`
 * → `POST …/rewrite`); `fixing` — hozir bajarilayotgan nishon (o'sha tugma
 * «Tuzatilmoqda…», qolganlari o'chiq). `onFix` berilmasa tugma o'chiq.
 *
 * SSR-toza: hook yo'q, `review` dan tashqari hech narsaga bog'liq emas —
 * `renderToStaticMarkup` bilan sinaladi (`tests/viewer/article-review-panel`).
 * Guruh jadvali SHU YERDA (review.ts emas): review.ts dvigatelni import
 * qiladi, mijoz bundle'iga kirmasligi kerak.
 */

export type ReviewGroupId = "structure" | "sources" | "visuals" | "science" | "ai";

export const REVIEW_GROUPS: { id: ReviewGroupId; label: string; checks: readonly string[] }[] = [
  { id: "structure", label: "Tuzilma", checks: ["structure", "udk", "abstracts", "keywords", "authors", "length", "highlights"] },
  { id: "sources", label: "Manbalar", checks: ["citations", "verified", "refsCount", "recent", "doi"] },
  { id: "visuals", label: "Vizuallar", checks: ["visuals", "prisma"] },
  { id: "science", label: "Ilmiy mazmun", checks: ["limitations"] },
  { id: "ai", label: "AI izi", checks: ["unsourcedNumbers", "userFacts", "filler", "repetition"] },
];

/** Tekshiruv id si → guruh (`judge:*` — ilmiy mazmun; noma'lum → tuzilma). */
export function reviewGroupOf(id: string): ReviewGroupId {
  if (id.startsWith("judge:")) return "science";
  return REVIEW_GROUPS.find((g) => g.checks.includes(id))?.id ?? "structure";
}

const ICON: Record<ReviewLevel, string> = { green: "✅", yellow: "⚠️", red: "❌" };
const LEVEL_WORD: Record<ReviewLevel, string> = { green: "yaxshi", yellow: "e’tibor", red: "xato" };

export function scoreTone(score: number): "green" | "yellow" | "red" {
  return score >= 80 ? "green" : score >= 60 ? "yellow" : "red";
}

const TONE_CLASS: Record<"green" | "yellow" | "red", string> = {
  green: "text-emerald-600",
  yellow: "text-amber-500",
  red: "text-red-600",
};

/** Ball halqasi — SVG, radius 26, aylana ≈163.4; `stroke-dasharray` ulushga qarab. */
function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative size-16 shrink-0" data-review-score={score} data-review-tone={tone} title={`Tayyorlik: ${score}/100`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/60" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${filled.toFixed(1)} ${c.toFixed(1)}`}
          className={TONE_CLASS[tone]}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center text-lg font-semibold ${TONE_CLASS[tone]}`}>{score}</div>
    </div>
  );
}

type FixFn = (fix: NonNullable<ReviewCheck["fix"]>) => void;

function CheckRow({ c, onFix, fixing }: { c: ReviewCheck; onFix?: FixFn; fixing?: string | null }) {
  const busy = Boolean(fixing);
  const mine = Boolean(c.fix && fixing === c.fix.target);
  return (
    <li className="flex items-start gap-2 py-1 text-sm" data-review-check={c.id} data-review-level={c.level}>
      <span className="shrink-0" role="img" aria-label={LEVEL_WORD[c.level]}>
        {ICON[c.level]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{c.label}</div>
        {c.detail ? <div className="text-muted-foreground text-xs">{c.detail}</div> : null}
      </div>
      {c.fix && c.level !== "green" ? (
        <button
          type="button"
          className="bg-card shrink-0 rounded-md border px-2 py-0.5 text-xs disabled:opacity-50"
          disabled={!onFix || busy}
          title={onFix ? c.fix.instruction : "Tez orada"}
          onClick={onFix && !busy ? () => onFix(c.fix!) : undefined}
          data-review-fix={c.fix.target}
          aria-busy={mine || undefined}
        >
          {mine ? "Tuzatilmoqda…" : "Tuzatish"}
        </button>
      ) : null}
    </li>
  );
}

export function ArticleReviewPanel({ review, onFix, fixing }: { review: ArticleReview; onFix?: FixFn; fixing?: string | null }) {
  const byGroup = new Map<ReviewGroupId, ReviewCheck[]>(REVIEW_GROUPS.map((g) => [g.id, []]));
  for (const c of review.checks) byGroup.get(reviewGroupOf(c.id))!.push(c);
  const red = review.checks.filter((c) => c.level === "red").length;
  const yellow = review.checks.filter((c) => c.level === "yellow").length;
  const built = review.builtAt ? new Date(review.builtAt) : null;
  return (
    <section className="bg-card rounded-xl border p-3 text-sm" data-article-review aria-label="Tayyorlik hisoboti">
      <header className="flex items-center gap-3">
        <ScoreRing score={review.score} />
        <div className="min-w-0">
          <div className="font-semibold">Tayyorlik hisoboti</div>
          <div className="text-muted-foreground text-xs">
            {red ? `${red} xato` : "xato yo‘q"} · {yellow ? `${yellow} e’tibor` : "e’tibor talab qilmaydi"} · tasdiqlangan manbalar {Math.round(review.verifiedShare * 100)}% · yangi manbalar{" "}
            {Math.round(review.recentShare * 100)}%
            {built && !Number.isNaN(built.getTime()) ? ` · ${built.toLocaleDateString("uz-UZ")}` : ""}
          </div>
        </div>
      </header>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REVIEW_GROUPS.map((g) => {
          const items = byGroup.get(g.id) ?? [];
          return (
            <div key={g.id} className="rounded-lg border p-2" data-review-group={g.id}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide">{g.label}</div>
              {items.length ? (
                <ul className="divide-y">
                  {items.map((c) => (
                    <CheckRow key={c.id} c={c} onFix={onFix} fixing={fixing} />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-xs">Tekshiruv yo‘q</p>
              )}
            </div>
          );
        })}
        <div className="rounded-lg border p-2 sm:col-span-2 lg:col-span-3" data-review-notes>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide">Baholovchi izohlari</div>
          {review.judgeNotes.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {review.judgeNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">Izoh yo‘q</p>
          )}
        </div>
      </div>
    </section>
  );
}
