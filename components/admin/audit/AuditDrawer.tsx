"use client";

import { useCallback } from "react";
import Link from "next/link";
import { getAuditEntry, type AuditEntry } from "@/lib/admin-api/audit";
import { fmtDateTime } from "@/lib/admin-format";
import { Badge, Button, CopyButton, Drawer, ErrorState, Forbidden, JsonView, KeyValueList, Skeleton, useLoad } from "@/components/admin/ui";
import { roleLabel } from "@/components/admin/shell";
import { cn } from "@/lib/cn";
import { OutcomeBadge, TargetCell } from "./cells";
import { diffSnapshots, type DiffRow } from "./shared";

/** Time with seconds (Asia/Tashkent): the list shows minutes, forensic work needs the second. */
function stampWithSeconds(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = new Date(t + 5 * 3_600_000).getUTCSeconds();
  return `${fmtDateTime(iso)}:${String(s).padStart(2, "0")}`;
}

/**
 * Detail drawer of one audit row (S17): who / what / when, a before → after
 * diff with the changed keys highlighted, and `meta` as text. Every value is a
 * React text node (JSON text), never HTML.
 */
export function AuditDrawer({
  id,
  onClose,
  onFilter,
}: {
  id: string;
  onClose: () => void;
  /** "Show only this action / admin": a URL patch for the list's filters. */
  onFilter: (patch: Record<string, string | null>) => void;
}) {
  const load = useCallback((signal: AbortSignal) => getAuditEntry(id, { signal }), [id]);
  const [state, reload] = useLoad(load);
  const data = state.status === "ready" ? state.data : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title="Audit yozuvi"
      description={data ? <span className="font-mono text-xs break-all">#{data.id} · {data.action}</span> : undefined}
      footer={
        data ? (
          <>
            <Button size="sm" onClick={() => onFilter({ action: data.action })}>
              Shu amal bo&apos;yicha filtrlash
            </Button>
            {data.adminId ? (
              <Button size="sm" onClick={() => onFilter({ adminId: data.adminId })}>
                Shu admin bo&apos;yicha filtrlash
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : state.status === "forbidden" ? (
        <Forbidden />
      ) : state.status === "error" ? (
        <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
      ) : (
        <Body e={state.data} />
      )}
    </Drawer>
  );
}

function Body({ e }: { e: AuditEntry }) {
  const rows = diffSnapshots(e.before, e.after);
  const hasMeta = e.meta !== null && e.meta !== undefined;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={e.outcome} />
        {e.actorRole ? <Badge tone="primary">{roleLabel(e.actorRole)}</Badge> : null}
      </div>

      <KeyValueList
        items={[
          { label: "Vaqt", value: stampWithSeconds(e.at) },
          {
            label: "Admin",
            value: e.adminId ? (
              <span className="flex flex-col">
                <span>{e.adminName ?? `#${e.adminId}`}</span>
                {e.adminUsername ? <span className="text-muted-foreground text-xs">@{e.adminUsername}</span> : null}
              </span>
            ) : (
              <span className="text-muted-foreground">Tizim (CLI)</span>
            ),
          },
          { label: "Amal", value: e.action, mono: true },
          { label: "Nishon", value: e.targetType || e.targetId ? <TargetCell type={e.targetType} id={e.targetId} /> : null },
          { label: "Sabab", value: e.reason },
          { label: "IP", value: e.ip, mono: true },
          { label: "Brauzer", value: e.userAgent, mono: true },
          {
            label: "So'rov ID",
            value: e.requestId ? (
              <span className="inline-flex flex-wrap items-center gap-1">
                <span className="select-all">{e.requestId}</span>
                <CopyButton value={e.requestId} />
              </span>
            ) : null,
            mono: true,
          },
          {
            label: "Foydalanuvchi",
            value: e.actorUserId ? (
              <Link href={`/admin/users/${encodeURIComponent(e.actorUserId)}`} className="text-primary underline-offset-2 hover:underline">
                #{e.actorUserId}
              </Link>
            ) : null,
          },
        ]}
      />

      <section aria-label="O'zgarish" className="flex flex-col gap-1.5">
        <h3 className="text-muted-foreground text-[11px] font-semibold uppercase">O&apos;zgarish (oldin → keyin)</h3>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">Bu yozuvda oldingi va keyingi holat saqlanmagan.</p>
        ) : (
          <DiffTable rows={rows} />
        )}
      </section>

      {hasMeta ? (
        <section aria-label="Qo'shimcha ma'lumot" className="flex flex-col gap-1.5">
          <h3 className="text-muted-foreground text-[11px] font-semibold uppercase">Qo&apos;shimcha (meta)</h3>
          <JsonView value={e.meta} maxHeightClass="max-h-64" />
        </section>
      ) : null}
    </>
  );
}

const KIND_ROW: Record<DiffRow["kind"], string> = {
  changed: "bg-warning/10",
  added: "bg-success/10",
  removed: "bg-destructive/10",
  same: "",
};

const KIND_LABEL: Record<DiffRow["kind"], string> = {
  changed: "o'zgargan",
  added: "qo'shilgan",
  removed: "olib tashlangan",
  same: "o'zgarmagan",
};

function DiffTable({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <caption className="sr-only">Oldingi va keyingi qiymatlar</caption>
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th scope="col" className="px-2.5 py-1.5 font-semibold">Maydon</th>
            <th scope="col" className="px-2.5 py-1.5 font-semibold">Oldin</th>
            <th scope="col" className="px-2.5 py-1.5 font-semibold">Keyin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-diff={r.kind} title={KIND_LABEL[r.kind]} className={cn("border-b align-top last:border-0", KIND_ROW[r.kind])}>
              <th scope="row" className="px-2.5 py-1.5 text-left font-mono font-medium break-all">
                {r.key}
                {r.kind !== "same" ? <span className="sr-only"> ({KIND_LABEL[r.kind]})</span> : null}
              </th>
              <td className={cn("px-2.5 py-1.5 font-mono break-all whitespace-pre-wrap", r.kind === "removed" || r.kind === "changed" ? "text-destructive" : "text-muted-foreground")}>
                {r.before ?? "—"}
              </td>
              <td className={cn("px-2.5 py-1.5 font-mono break-all whitespace-pre-wrap", r.kind === "added" || r.kind === "changed" ? "text-badge-success-text font-semibold" : "text-muted-foreground")}>
                {r.after ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
