"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Rocket } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  AdminAuthRequiredError,
  AdminForbiddenError,
  AdminNotFoundError,
  adminErrorMessage,
  adminRequestId,
  isAbortError,
} from "@/lib/admin-api/core";
import { BROADCAST_POLL_MS, cancelBroadcast, getBroadcast, type BroadcastDetail as Detail } from "@/lib/admin-api/broadcasts";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Forbidden,
  KeyValueList,
  Skeleton,
  toast,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";
import { SendDialog } from "./SendDialog";
import { STATUS_LABEL, StatusPill, audienceLabel, isCancellable, isInFlight } from "./shared";
import { TestSendButton } from "./TestSendButton";

type State =
  | { kind: "ok"; data: Detail }
  | { kind: "error"; message: string; requestId?: string }
  | { kind: "forbidden" }
  | { kind: "missing" };

function classify(e: unknown): State {
  if (e instanceof AdminForbiddenError) return { kind: "forbidden" };
  if (e instanceof AdminNotFoundError) return { kind: "missing" };
  return { kind: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) };
}

/** Tab visibility; `true` where the Page Visibility API is missing. */
function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** Percent of recipients handled (sent + failed) out of the total; 0 when nothing is queued. */
export function progressPercent(sent: number, failed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.floor(((sent + failed) / total) * 100));
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      <span className={cn("text-xl font-semibold tabular-nums", tone === "ok" && "text-success-text", tone === "bad" && value > 0 && "text-destructive")}>{fmtNumber(value)}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/**
 * S13 `/admin/broadcasts/[id]`: the saved text, the audience, delivery progress,
 * and the actions the state allows: "O'zimga sinov" and "Yuborish" on a draft,
 * "Bekor qilish" while it is not finished.
 *
 * Polls every 5 s ONLY while the broadcast is queued or sending AND the tab is
 * visible (a hidden tab pauses and refreshes at once when it comes back). A
 * failed poll keeps the last numbers.
 */
export function BroadcastDetail({ id }: { id: string }) {
  const canSend = useCan("broadcasts.send");
  const [state, setState] = useState<State | null>(null);
  const [reload, setReload] = useState(0);
  const [sendOpen, setSendOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const ctlRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    getBroadcast(id, { signal: ctl.signal })
      .then((data) => setState({ kind: "ok", data }))
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || e instanceof AdminAuthRequiredError) return;
        // A failed poll keeps what is on screen; only the first load (or a manual reload) shows the error.
        setState((prev) => (prev?.kind === "ok" ? prev : classify(e)));
      });
  }, [id]);

  useEffect(() => {
    refresh();
    return () => ctlRef.current?.abort();
    // `reload` re-runs the initial load (retry button, after an action).
  }, [refresh, reload]);

  const status = state?.kind === "ok" ? state.data.broadcast.status : null;
  const polling = status !== null && isInFlight(status);

  useEffect(() => {
    if (!polling) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(refresh, BROADCAST_POLL_MS);
    };
    const onVisibility = () => {
      if (pageVisible()) {
        refresh();
        start();
      } else {
        stop();
        ctlRef.current?.abort();
      }
    };
    if (pageVisible()) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [polling, refresh]);

  const back = (
    <Link href="/admin/broadcasts" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12.5px]">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      E&apos;lonlar
    </Link>
  );

  if (!state) return <DetailSkeleton />;
  if (state.kind === "forbidden") return <Forbidden />;
  if (state.kind === "missing") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="bg-card rounded-xl border">
          <EmptyState title="Xabar topilmadi" description="Bu xabar o'chirilgan yoki havola noto'g'ri." />
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="bg-card rounded-xl border">
          <ErrorState message={state.message} requestId={state.requestId} onRetry={() => setReload((n) => n + 1)} />
        </div>
      </div>
    );
  }

  const { broadcast: b, stats } = state.data;
  const percent = progressPercent(b.sent, b.failed, b.total);
  const queuedOrMore = b.status !== "draft";

  const actions: ReactNode[] = [];
  if (canSend && b.status === "draft") {
    actions.push(<TestSendButton key="test" id={b.id} />);
    actions.push(
      <Button key="send" variant="primary" icon={<Rocket className="size-4" aria-hidden="true" />} onClick={() => setSendOpen(true)}>
        Yuborish…
      </Button>,
    );
  }
  if (canSend && isCancellable(b.status)) {
    actions.push(
      <Button key="cancel" variant="dangerOutline" icon={<Ban className="size-4" aria-hidden="true" />} onClick={() => setCancelOpen(true)}>
        Bekor qilish
      </Button>,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-2">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">Xabar #{b.id}</h1>
          <StatusPill status={b.status} />
        </div>
        <p className="text-muted-foreground text-[12.5px]">{audienceLabel(b.audience)}</p>
      </header>

      {actions.length ? <div className="flex flex-wrap gap-2">{actions}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Matn" />
          <CardBody>
            <p className="max-h-80 overflow-y-auto text-[13px] break-words whitespace-pre-wrap">{b.text}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Ma'lumot" />
          <CardBody>
            <KeyValueList
              items={[
                { label: "Auditoriya", value: audienceLabel(b.audience) },
                { label: "Muallif", value: b.createdByName || "—" },
                { label: "Yaratilgan", value: <span className="tabular-nums">{fmtDateTime(b.createdAt)}</span> },
                { label: "Navbatga qo'yilgan", value: b.queuedAt ? <span className="tabular-nums">{fmtDateTime(b.queuedAt)}</span> : null },
                { label: "Tugagan", value: b.finishedAt ? <span className="tabular-nums">{fmtDateTime(b.finishedAt)}</span> : null },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Yuborish jarayoni"
          description={polling ? "Har 5 soniyada yangilanadi" : undefined}
          aside={<span className="text-sm font-semibold tabular-nums">{queuedOrMore ? `${percent}%` : "—"}</span>}
        />
        <CardBody className="flex flex-col gap-4">
          {queuedOrMore ? (
            <div
              role="progressbar"
              aria-label="Yuborish jarayoni"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
            >
              <div className="bg-primary h-full rounded-full transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          ) : (
            <p className="text-muted-foreground text-[13px]">Hali yuborilmagan. Avval o&apos;zingizga sinov yuboring, so&apos;ng «Yuborish…» tugmasini bosing.</p>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Counter label="Jami" value={stats.total} />
            <Counter label="Yuborildi" value={stats.sent} tone="ok" />
            <Counter label="Xato" value={stats.failed} tone="bad" />
            <Counter label={b.status === "cancelled" ? "Yuborilmagan" : "Kutmoqda"} value={stats.pending} />
          </div>
          {stats.failedReasons.length ? (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[12.5px] font-semibold">Xato sabablari</h3>
              <ul className="flex flex-col gap-1 text-[13px]">
                {stats.failedReasons.map((r) => (
                  <li key={r.error} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words">{r.error}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">{fmtNumber(r.count)} ta</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <SendDialog
        open={sendOpen}
        broadcast={b}
        onClose={() => setSendOpen(false)}
        onSent={(next) => setState({ kind: "ok", data: { broadcast: next, stats: { total: next.total, sent: 0, failed: 0, pending: next.total, failedReasons: [] } } })}
      />
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Xabarni bekor qilish"
        description={
          b.status === "draft"
            ? "Qoralama bekor qilinadi va endi yuborib bo'lmaydi."
            : "Hali yuborilmagan qabul qiluvchilarga xabar yuborilmaydi. Ketgan xabarlar qaytmaydi."
        }
        target={`Xabar #${b.id} · ${audienceLabel(b.audience)}`}
        before={STATUS_LABEL[b.status]}
        after={STATUS_LABEL.cancelled}
        reason={{ minLength: 5 }}
        danger
        confirmLabel="Bekor qilish"
        cancelLabel="Yopish"
        onConfirm={async ({ reason }) => {
          try {
            await cancelBroadcast(b.id, reason);
          } finally {
            // Also after a 409 (state changed meanwhile): show what the server says now.
            setReload((n) => n + 1);
          }
          toast("Xabar bekor qilindi");
        }}
      />
    </div>
  );
}
