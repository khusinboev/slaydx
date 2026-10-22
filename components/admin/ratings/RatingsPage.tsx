"use client";

import { useCallback, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Card, CardHeader, EmptyState, ErrorState, Forbidden, Skeleton } from "@/components/admin/ui";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import { AdminAuthRequiredError, AdminForbiddenError, adminErrorMessage, adminGet, adminRequestId, isAbortError } from "@/lib/admin-api/core";

type RatingItem = { userId: string; name: string; username: string | null; stars: number; feedback: string; createdAt: string };
type RatingsData = { count: number; average: number | null; distribution: number[]; items: RatingItem[] };
type State =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; data: RatingsData };

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${n} yulduz`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={i <= n ? "size-4 fill-amber-400 text-amber-500" : "text-muted-foreground/40 size-4"} aria-hidden="true" />
      ))}
    </span>
  );
}

/**
 * `/admin/ratings` «Baholar»: what users wrote when they rated the app (read-only; permission
 * `bonus.view`, enforced by `GET /api/admin/ratings`). Average and star distribution on top, newest first.
 */
export function RatingsPage() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; value: State }>({ attempt: 0, value: { status: "loading" } });

  useEffect(() => {
    const ctl = new AbortController();
    adminGet<RatingsData>("/api/admin/ratings", undefined, { signal: ctl.signal })
      .then((data) => setLoaded({ attempt, value: { status: "ready", data } }))
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || e instanceof AdminAuthRequiredError) return;
        const value: State =
          e instanceof AdminForbiddenError ? { status: "forbidden" } : { status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) };
        setLoaded({ attempt, value });
      });
    return () => ctl.abort();
  }, [attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const state: State = loaded.attempt === attempt ? loaded.value : { status: "loading" };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Baholar</h1>
        <p className="text-muted-foreground text-[13px]">Foydalanuvchilar ilovani baholab yozgan fikrlar (faqat ko&apos;rish).</p>
      </header>

      {state.status === "loading" ? (
        <Card>
          <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-3 p-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </Card>
      ) : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : null}
      {state.status === "ready" && state.data.count === 0 ? (
        <Card>
          <EmptyState icon={<Star className="size-8" />} title="Hali baho yo'q" description="Foydalanuvchilar profilda ilovani baholaganda shu yerda ko'rinadi." />
        </Card>
      ) : null}
      {state.status === "ready" && state.data.count > 0 ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4" data-ratings-summary>
              <div>
                <div className="text-[28px] leading-none font-semibold tabular-nums" data-ratings-average>
                  {state.data.average === null ? "—" : state.data.average.toFixed(2)}
                </div>
                <div className="text-muted-foreground mt-1 text-[13px]">o&apos;rtacha · {fmtNumber(state.data.count)} ta baho</div>
              </div>
              <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums">
                {[5, 4, 3, 2, 1].map((s) => (
                  <li key={s}>
                    {s}★ · {fmtNumber(state.data.distribution[s - 1] ?? 0)}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
          <Card>
            <CardHeader title="Fikrlar" description="Yangilari yuqorida." />
            <ul data-ratings-list>
              {state.data.items.map((r) => (
                <li key={r.userId} className="flex min-w-0 flex-col gap-1.5 border-t px-4 py-3.5 first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <Stars n={r.stars} />
                    <span className="text-muted-foreground text-[12px] tabular-nums">{fmtDateTime(r.createdAt)}</span>
                  </div>
                  <p className="text-[14px] leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap">{r.feedback}</p>
                  <a href={`/admin/users/${r.userId}`} className="text-muted-foreground hover:text-foreground w-fit text-[12px] underline-offset-2 hover:underline">
                    {r.name || "Foydalanuvchi"}
                    {r.username ? ` · @${r.username}` : ""} · #{r.userId}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}
