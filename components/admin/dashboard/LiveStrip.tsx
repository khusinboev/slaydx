"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { AdminAuthRequiredError, adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { getLive, type Live } from "@/lib/admin-api/metrics";
import { fmtDuration, fmtNumber } from "@/lib/admin-format";
import { Skeleton } from "@/components/admin/ui";

/** Refresh period of the live strip (docs/admin/02-plan.md §7.1 S3, §9). */
export const LIVE_REFRESH_MS = 15_000;

/** Tab visibility; `true` where the Page Visibility API is missing. */
function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function Item({ value, label, tone }: { value: string; label: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {tone ? (
        <span
          aria-hidden="true"
          className={cn("size-2 rounded-full", tone === "ok" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-destructive")}
        />
      ) : null}
      <b className="font-semibold tabular-nums">{value}</b>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * "Hozir": the queue right now. Polls `GET /api/admin/metrics/live` every 15 s
 * only while the tab is visible; a hidden tab stops polling and refreshes at
 * once when it becomes visible again. A failed poll keeps the last numbers
 * and says so.
 */
export function LiveStrip() {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctlRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    getLive({ signal: ctl.signal })
      .then((data) => {
        setLive(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || e instanceof AdminAuthRequiredError) return;
        setError(adminErrorMessage(e));
      });
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      refresh();
      timer = setInterval(refresh, LIVE_REFRESH_MS);
    };
    const onVisibility = () => {
      if (pageVisible()) start();
      else {
        stop();
        ctlRef.current?.abort();
      }
    };
    if (pageVisible()) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      ctlRef.current?.abort();
    };
  }, [refresh]);

  return (
    <section aria-label="Hozirgi holat" className="bg-card flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-2.5 text-[13px]">
      <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Hozir</span>
      {live ? (
        <>
          <Item value={fmtNumber(live.queued)} label="navbatda" tone={live.queued > 0 ? "warn" : "ok"} />
          <Item value={fmtNumber(live.running)} label="ishlanmoqda" />
          <Item value={live.oldestQueuedSec === null ? "—" : fmtDuration(live.oldestQueuedSec)} label="eng eski navbat" />
          <Item value={fmtNumber(live.inflightUsers)} label="foydalanuvchi kutmoqda" />
          <Item value={fmtNumber(live.workersAlive)} label="worker jarayon tirik" tone={live.workersAlive > 0 ? "ok" : "bad"} />
          {live.workersStale > 0 ? <Item value={fmtNumber(live.workersStale)} label="worker jarayon javob bermayapti" tone="warn" /> : null}
        </>
      ) : error ? null : (
        <span className="flex gap-3" aria-busy="true">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
        </span>
      )}
      {error ? (
        <span role="alert" className="text-destructive flex items-center gap-2 text-xs">
          {live ? "Yangilab bo'lmadi: " : "Jonli holat yuklanmadi: "}
          {error}
          <button
            type="button"
            onClick={refresh}
            className="text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
          >
            <RefreshCw className="size-3" aria-hidden="true" />
            Qayta urinish
          </button>
        </span>
      ) : null}
    </section>
  );
}
