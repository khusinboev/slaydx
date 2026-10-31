"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { ApiError, request } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatBonusSom } from "@/lib/format";
import { RATING_MAX_CHARS, feedbackHint, normalizeFeedback } from "@/lib/rating";
import { AutoTextarea } from "../common/AutoTextarea";

/** `GET /api/ratings` (`lib/server/ratings.ts RatingStatus`). */
export type RatingStatusView = { rated: boolean; stars: number | null; hasFinished: boolean; rewardPoints: number };

const FOCUS = "focus-visible:ring-ring focus-visible:ring-offset-card focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";
const CARD = "bg-card min-w-0 rounded-[20px] border p-5";
const SOFT = { background: "var(--accent-soft, rgba(245, 158, 11, 0.16))" } as const;

/**
 * «Ilovani baholang» (profile; docs/program-17/PLAN.md item 9): 1-5 stars and written feedback, paid
 * once as bonus so'm. The server (`POST /api/ratings`) is the authority — it needs a finished
 * generation and re-checks the text with the same rules (`lib/rating.ts`) this card uses for its live
 * hint. After a rating the card only says «Rahmat». `onRated` lets the page refresh the balance.
 */
export function RatingCard({ className = "mb-6", onRated }: { className?: string; onRated?: () => void } = {}) {
  const [status, setStatus] = useState<RatingStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState<number | null>(null);
  const root = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    request<RatingStatusView>("/api/ratings")
      .then(setStatus)
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  // The bot's «Ilovani baholash» task opens `/uz/profile#rating`.
  useEffect(() => {
    if (status && window.location.hash === "#rating") root.current?.scrollIntoView?.({ block: "center" });
  }, [status]);

  const textHint = feedbackHint(text);
  // What is still missing, in one visible line (a disabled button alone never says why: owner report 2026-10-31).
  const hint = textHint ?? (stars < 1 ? "Yulduzchalardan birini bosib baho bering (1–5)." : null);
  const canSubmit = Boolean(status?.hasFinished) && hint === null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ stars: number; rewardPoints: number; credited: boolean }>("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars, feedback: normalizeFeedback(text) }),
      });
      setPaid(r.credited ? r.rewardPoints : 0);
      setStatus((s) => (s ? { ...s, rated: true, stars: r.stars } : s));
      onRated?.();
    } catch (e) {
      if (e instanceof ApiError && e.data.code === "already_rated") {
        setStatus((s) => (s ? { ...s, rated: true } : s));
        return;
      }
      setError(e instanceof Error && e.message ? e.message : "Yuborib bo'lmadi. Qayta urinib ko'ring.");
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <section ref={root} id="rating" className={cn(CARD, className)} data-rating-card="error">
        <h2 className="text-[17px] font-semibold">Ilovani baholang</h2>
        <p className="text-muted-foreground mt-1 text-[15px]">Ma&apos;lumot yuklanmadi.</p>
        <button type="button" onClick={load} className={cn("hover:bg-muted mt-3 inline-flex h-11 items-center rounded-[14px] border px-4 text-[15px] font-medium", FOCUS)}>
          Qayta urinish
        </button>
      </section>
    );
  }
  if (!status) {
    return (
      <section ref={root} id="rating" className={cn(CARD, className)} aria-busy="true" aria-label="Yuklanmoqda" data-rating-card="loading">
        <div className="bg-muted h-6 w-48 rounded motion-safe:animate-pulse" />
        <div className="bg-muted mt-4 h-11 w-full rounded-[14px] motion-safe:animate-pulse" />
      </section>
    );
  }

  if (status.rated) {
    return (
      <section ref={root} id="rating" className={cn(CARD, className)} data-rating-card="rated" aria-live="polite">
        <h2 className="text-[17px] font-semibold">Rahmat!</h2>
        <p className="text-muted-foreground mt-1 text-[15px]" data-rating-thanks>
          Fikringiz qabul qilindi{status.stars ? ` (${status.stars} ★)` : ""}.
          {paid ? <span className="ml-1 font-medium text-emerald-700 dark:text-emerald-400" data-rating-paid>+{formatBonusSom(paid)}</span> : null}
        </p>
      </section>
    );
  }

  const reward = status.rewardPoints > 0 ? formatBonusSom(status.rewardPoints) : null;
  return (
    <section ref={root} id="rating" className={cn(CARD, className)} data-rating-card="ready" aria-labelledby="rating-title">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] text-amber-700 dark:text-amber-400" style={SOFT} aria-hidden="true">
          <Star className="size-[22px]" />
        </span>
        <div className="min-w-0">
          <h2 id="rating-title" className="text-[17px] leading-snug font-semibold">
            Ilovani baholang
          </h2>
          <p className="text-muted-foreground mt-0.5 text-[14px] leading-snug" data-rating-lead>
            {reward ? `Baho va fikr uchun +${reward} — bir martalik. ` : ""}Fikr yozish majburiy.
          </p>
        </div>
      </div>

      {status.hasFinished ? null : (
        <div className="bg-muted/70 mt-3 rounded-[14px] px-3 py-2.5 text-[14px]" data-rating-locked>
          <p>Baholash uchun avval kamida bitta hujjat yarating — tayyor bo&apos;lgach shu yerda baholay olasiz.</p>
          <Link href="/uz/create" data-rating-create className={cn("text-primary mt-1.5 inline-flex min-h-11 items-center font-semibold underline", FOCUS)}>
            Hujjat yaratish
          </Link>
        </div>
      )}

      <div role="radiogroup" aria-label="Baho" className="mt-4 flex justify-between gap-1" data-rating-stars>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} yulduz`}
            disabled={!status.hasFinished}
            data-rating-star={n}
            onClick={() => setStars(n)}
            className={cn("flex h-12 min-w-11 flex-1 items-center justify-center rounded-[14px] disabled:opacity-50", FOCUS)}
          >
            <Star className={cn("size-8", n <= stars ? "fill-amber-400 text-amber-500" : "text-muted-foreground/50")} aria-hidden="true" />
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Fikringiz</span>
        <AutoTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!status.hasFinished}
          minRows={3}
          maxRows={8}
          maxLength={RATING_MAX_CHARS}
          placeholder="Ilova sizga qanday yordam berdi? Nimani yaxshilash kerak?"
          data-rating-text
          className={cn("border-input bg-background w-full min-w-0 rounded-[14px] border px-3 py-2.5 text-[16px] leading-snug", FOCUS)}
        />
      </label>
      <p
        aria-live="polite"
        data-rating-hint={hint ? "need" : "ok"}
        className={cn("mt-1.5 min-h-5 text-[13px]", hint ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400")}
      >
        {status.hasFinished ? (hint ?? "Hammasi tayyor — «Yuborish» tugmasini bosing.") : ""}
      </p>
      {error ? (
        <p role="alert" className="text-destructive mt-1 text-[13px]" data-rating-error>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        data-rating-submit
        className={cn(
          "bg-primary text-primary-foreground mt-3 inline-flex h-12 w-full items-center justify-center rounded-[14px] px-4 text-[16px] font-semibold transition-transform active:scale-[0.98] disabled:opacity-50 motion-reduce:transform-none",
          FOCUS,
        )}
      >
        {busy ? "Yuborilmoqda…" : reward ? `Yuborish va +${reward} olish` : "Yuborish"}
      </button>
    </section>
  );
}
