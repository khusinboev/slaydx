"use client";

import { useCallback, useState } from "react";
import { Star } from "lucide-react";
import { Card, CardHeader, EmptyState, ErrorState, Forbidden, Segmented, Skeleton, useLoad } from "@/components/admin/ui";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import { adminGet } from "@/lib/admin-api/core";
import { RATING_REASONS, RATING_REASON_LABELS, type RatingReason } from "@/lib/generation-rating";

type LowRating = {
  generationId: string;
  toolId: string;
  toolTitle: string;
  topic: string;
  stars: number;
  reason: RatingReason | null;
  comment: string | null;
  source: "bot" | "web";
  userId: string;
  at: string;
};
type ToolRow = {
  toolId: string;
  title: string;
  count: number;
  average: number;
  distribution: number[];
  low: number;
  lowShare: number;
  reasons: Record<RatingReason, number>;
};
export type WorkRatingsData = { days: number; count: number; average: number | null; low: number; tools: ToolRow[]; recentLow: LowRating[] };

const DAYS = [
  { value: "7", label: "7 kun" },
  { value: "30", label: "30 kun" },
  { value: "90", label: "90 kun" },
] as const;

/** The two most frequent reasons of a tool, e.g. «Rasmlar 4 · Matn 2»; `—` when none was given. */
export function topReasons(reasons: Record<RatingReason, number>): string {
  const top = RATING_REASONS.filter((r) => reasons[r] > 0)
    .sort((a, b) => reasons[b] - reasons[a] || RATING_REASONS.indexOf(a) - RATING_REASONS.indexOf(b))
    .slice(0, 2);
  return top.length ? top.map((r) => `${RATING_REASON_LABELS[r]} ${fmtNumber(reasons[r])}`).join(" · ") : "—";
}

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/**
 * «Ish baholari»: how users rated their own works (bot «⭐ Baholash» and the web API), per tool,
 * plus the newest low ratings with a link to the generation (read-only; `GET /api/admin/ratings/works`,
 * permission `bonus.view`, like the page, enforced by the server).
 */
export function WorkRatings() {
  const [days, setDays] = useState("30");
  const load = useCallback((signal: AbortSignal) => adminGet<WorkRatingsData>("/api/admin/ratings/works", { days }, { signal }), [days]);
  const [state, retry] = useLoad(load);

  return (
    <Card>
      <CardHeader
        title="Ish baholari"
        description="Foydalanuvchilar o'z ishlarini 1–5 yulduz bilan baholagan (bot va sayt)."
        aside={<Segmented options={DAYS} value={days} onChange={setDays} ariaLabel="Davr" />}
      />
      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-56 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      ) : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} /> : null}
      {state.status === "ready" && state.data.count === 0 ? (
        <EmptyState icon={<Star className="size-8" />} title="Bu davrda baho yo'q" description="Foydalanuvchi botda fayl ostidagi «Baholash» tugmasini bosganda shu yerda ko'rinadi." />
      ) : null}
      {state.status === "ready" && state.data.count > 0 ? (
        <div className="flex min-w-0 flex-col" data-work-ratings>
          <p className="text-muted-foreground px-4 pt-3 text-[13px] tabular-nums" data-work-ratings-total>
            O&apos;rtacha <b className="text-foreground">{state.data.average === null ? "—" : state.data.average.toFixed(1)}</b> ·{" "}
            {fmtNumber(state.data.count)} ta baho · ≤3: {fmtNumber(state.data.low)} ta
          </p>
          <div className="overflow-x-auto px-4 py-3">
            <table className="w-full min-w-[480px] text-[13px] tabular-nums">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Vosita</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Baholar</th>
                  <th className="py-1.5 pr-3 text-right font-medium">O&apos;rtacha</th>
                  <th className="py-1.5 pr-3 text-right font-medium">≤3</th>
                  <th className="py-1.5 font-medium">Asosiy sabablar</th>
                </tr>
              </thead>
              <tbody>
                {state.data.tools.map((t) => (
                  <tr key={t.toolId} className="border-t" data-work-rating-tool={t.toolId}>
                    <td className="py-1.5 pr-3">{t.title}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtNumber(t.count)}</td>
                    <td className="py-1.5 pr-3 text-right">{t.average.toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-right">{pct(t.lowShare)}</td>
                    <td className="py-1.5">{topReasons(t.reasons)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.data.recentLow.length ? (
            <div className="border-t">
              <h3 className="px-4 pt-3 text-xs font-semibold">Oxirgi past baholar</h3>
              <ul data-work-ratings-low>
                {state.data.recentLow.map((r) => (
                  <li key={`${r.generationId}:${r.userId}`} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-[13px]">
                    <span className="tabular-nums">{r.stars}★</span>
                    <a href={`/admin/generations/${r.generationId}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                      {r.topic || "Mavzusiz"}
                    </a>
                    <span className="text-muted-foreground text-xs">
                      {r.toolTitle}
                      {r.reason ? ` · ${RATING_REASON_LABELS[r.reason]}` : ""} · {fmtDateTime(r.at)}
                    </span>
                    {r.comment ? <p className="text-muted-foreground w-full text-xs [overflow-wrap:anywhere]">{r.comment}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
