"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, ErrorState, Forbidden, Skeleton, StatusPill, type Tone } from "@/components/admin/ui";
import { WALLET_LABEL } from "@/components/admin/money";
import { fmtDateTime, fmtIsoDate, fmtNumber, fmtSoum } from "@/lib/admin-format";
import { getReconciliation, type Reconciliation, type ReconciliationCheck, type ReconciliationSample, type Wallets } from "@/lib/admin-api/payments";
import { ORDER_STATE_LABEL, PROVIDER_LABEL, PURPOSE_LABEL, shortId } from "@/components/admin/payments/labels";
import { useResource } from "@/components/admin/payments/list-state";
import { OptionalRangeFilter } from "@/components/admin/payments/OptionalRange";
import { useReportForbidden } from "./forbidden";

export const TIMEOUT_TEXT = "Vaqt tugadi — oraliqni toraytiring";

const SEVERITY_TONE: Record<ReconciliationCheck["severity"], Tone> = { error: "danger", warning: "warning", info: "info" };
const DOT: Record<ReconciliationCheck["severity"] | "ok", string> = {
  error: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  ok: "bg-success",
};

function walletsText(w: Wallets): string {
  return `${WALLET_LABEL.balance.toLowerCase()} ${fmtNumber(w.balance)} · ${WALLET_LABEL.quota.toLowerCase()} ${fmtNumber(w.quota)} · bonus ${fmtNumber(w.points)}`;
}

/** One sample row: always a link to the related admin screen, built from the id. */
function SampleRow({ s }: { s: ReconciliationSample }) {
  if (s.type === "order") {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[12.5px]">
        <Link href={`/admin/payments/${s.id}`} className="font-mono underline-offset-2 hover:underline" title={s.id}>
          {shortId(s.id)}
        </Link>
        <Link href={`/admin/users/${s.userId}`} className="min-w-0 truncate underline-offset-2 hover:underline">
          {s.userName || `#${s.userId}`}
        </Link>
        <span className="text-muted-foreground">
          {PROVIDER_LABEL[s.provider]} · {PURPOSE_LABEL[s.purpose]} · {ORDER_STATE_LABEL[s.state]}
        </span>
        <span className="ml-auto tabular-nums">{fmtSoum(s.amountSoum)}</span>
        <span className="text-muted-foreground tabular-nums">{fmtDateTime(s.createdAt)}</span>
      </li>
    );
  }
  if (s.type === "generation") {
    const charged = s.charged.balance + s.charged.quota + s.charged.points;
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[12.5px]">
        <Link href={`/admin/generations/${s.id}`} className="font-mono underline-offset-2 hover:underline" title={s.id}>
          {shortId(s.id)}
        </Link>
        <Link href={`/admin/users/${s.userId}`} className="min-w-0 truncate underline-offset-2 hover:underline">
          {s.userName || `#${s.userId}`}
        </Link>
        <span className="text-muted-foreground" title={s.toolId}>
          {s.toolTitle}
        </span>
        {s.delivered ? (
          <span className="text-muted-foreground tabular-nums">
            yetkazildi {fmtNumber(s.delivered.got)} / {fmtNumber(s.delivered.want)}
          </span>
        ) : null}
        <span className="ml-auto tabular-nums">{fmtNumber(charged)} tanga yechilgan</span>
        <span className="text-muted-foreground tabular-nums">{fmtDateTime(s.finishedAt)}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-0.5 px-4 py-2 text-[12.5px]">
      <span className="flex flex-wrap items-center gap-x-3">
        <Link href={`/admin/users/${s.id}`} className="underline-offset-2 hover:underline">
          {s.userName || `#${s.id}`}
        </Link>
        <span className="text-muted-foreground font-mono">#{s.id}</span>
      </span>
      <span className="text-muted-foreground tabular-nums">Hamyon: {walletsText(s.wallet)}</span>
      <span className="text-muted-foreground tabular-nums">Yozuvlar: {walletsText(s.ledger)}</span>
    </li>
  );
}

function CheckRow({ c }: { c: ReconciliationCheck }) {
  const ok = !c.timedOut && c.count === 0;
  const dot = ok ? DOT.ok : DOT[c.severity];
  return (
    <li data-check={c.id} className="border-b last:border-b-0">
      <details className="group" open={!ok && !c.timedOut && c.sample.length > 0 && c.severity === "error"}>
        <summary className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px]", ok || c.timedOut ? "list-none" : "cursor-pointer")}>
          <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden="true" />
          <span className="min-w-0 flex-1 font-medium">{c.title}</span>
          {c.timedOut ? (
            <StatusPill tone="warning">{TIMEOUT_TEXT}</StatusPill>
          ) : ok ? (
            <StatusPill tone="success">0</StatusPill>
          ) : (
            <StatusPill tone={SEVERITY_TONE[c.severity]}>
              {fmtNumber(c.count)}
              {c.countCapped ? "+" : ""}
            </StatusPill>
          )}
        </summary>
        {!ok && !c.timedOut && c.sample.length > 0 ? (
          <div className="bg-muted/30 border-t">
            <p className="text-muted-foreground px-4 pt-2 text-xs">
              Namuna: {fmtNumber(c.sample.length)} ta{c.count !== null && c.count > c.sample.length ? ` (jami ${fmtNumber(c.count)}${c.countCapped ? "+" : ""})` : ""}
            </p>
            <ul className="divide-y">
              {c.sample.map((s) => (
                <SampleRow key={`${s.type}:${s.id}`} s={s} />
              ))}
            </ul>
          </div>
        ) : null}
      </details>
    </li>
  );
}

/**
 * S10 "Muvofiqlashtirish" (plan §6.6, §9): runs the six consistency checks on
 * demand (when the tab opens and on "Qayta tekshirish"). Each check is bounded
 * to 10 s on the server; a timed-out check says so, and the optional signup
 * range narrows the wallet check, the expensive one.
 */
export function ReconciliationView({
  walletRange,
  onWalletRangeChange,
  onForbidden,
}: {
  walletRange: { from: string; to: string };
  onWalletRangeChange: (r: { from: string; to: string }) => void;
  /** 403: the page drops its tabs. */
  onForbidden?: () => void;
}) {
  const key = `${walletRange.from}:${walletRange.to}`;
  const { state, retry } = useResource<Reconciliation>(key, (signal) => getReconciliation(walletRange, { signal }));
  const data = state.data;
  const issues = data?.checks.filter((c) => c.timedOut || (c.count ?? 0) > 0).length ?? 0;
  useReportForbidden(state.status === "forbidden", onForbidden);
  // 403: the forbidden state is all there is — no range filter or re-check button above it.
  if (state.status === "forbidden") {
    return (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <OptionalRangeFilter
            label="Hamyon tekshiruvi: ro'yxatdan o'tgan sana"
            from={walletRange.from}
            to={walletRange.to}
            onChange={onWalletRangeChange}
          />
        </div>
        <Button size="sm" onClick={retry} loading={state.status === "loading"} icon={<RefreshCw className="size-3.5" aria-hidden="true" />}>
          Qayta tekshirish
        </Button>
      </div>

      {state.status === "error" ? (
        <div className="bg-card rounded-xl border">
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        </div>
      ) : !data ? (
        <div aria-busy="true" aria-label="Tekshirilmoqda" className="bg-card flex flex-col gap-3 rounded-xl border p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : (
        <Card>
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <h2 className="flex-1 text-sm font-semibold">Muvofiqlashtirish tekshiruvlari</h2>
            {issues === 0 ? (
              <Badge tone="success" dot>
                Hammasi joyida
              </Badge>
            ) : (
              <Badge tone="warning" dot>
                {fmtNumber(issues)} ta tekshiruvda topilma
              </Badge>
            )}
          </header>
          <ul aria-busy={state.status === "loading" || undefined}>
            {data.checks.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
          <p className="text-muted-foreground border-t px-4 py-2 text-xs">
            Tekshirildi: {fmtDateTime(data.generatedAt)}
            {data.walletRange
              ? ` · hamyon tekshiruvi ${fmtIsoDate(data.walletRange.from)} — ${fmtIsoDate(data.walletRange.to)} oralig'ida ro'yxatdan o'tganlar uchun`
              : ""}
          </p>
        </Card>
      )}
    </div>
  );
}
