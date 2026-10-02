"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Forbidden, useLoad, type Column } from "@/components/admin/ui";
import { roleLabel } from "@/components/admin/shell";
import { OutcomeBadge } from "@/components/admin/audit/cells";
import { listAudit, type AuditItem } from "@/lib/admin-api/audit";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";

/** Rows shown in the tab; the full, filterable history is one link away. */
export const USER_AUDIT_LIMIT = 10;

/** The audit journal filtered to this user (the same query the tab runs), optionally with one row's drawer open. */
export function userAuditHref(userId: string, rowId?: string): string {
  const q = new URLSearchParams({ targetType: "user", targetId: userId });
  if (rowId) q.set("id", rowId);
  return `/admin/audit?${q.toString()}`;
}

/**
 * S5 tab "Audit" (plan §7.1): the newest admin actions that targeted this user,
 * through the audit API (`audit.view`; the parent shows the tab only with it,
 * the server enforces it). A row opens it in the audit journal's drawer.
 */
export function UserAuditTab({ userId, reloadKey }: { userId: string; reloadKey: number }) {
  const router = useRouter();
  const load = useCallback(
    (signal: AbortSignal) => {
      void reloadKey; // a block / wallet change on this page writes a new row: refetch.
      return listAudit({ targetType: "user", targetId: userId, limit: USER_AUDIT_LIMIT }, { signal });
    },
    [userId, reloadKey],
  );
  const [state, retry] = useLoad(load);

  if (state.status === "forbidden") {
    return (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="bg-card rounded-xl border">
        <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
      </div>
    );
  }

  const columns: Column<AuditItem>[] = [
    { id: "action", header: "Amal", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { id: "at", header: "Vaqt", className: "whitespace-nowrap tabular-nums", cell: (r) => fmtDateTime(r.at) },
    {
      id: "admin",
      header: "Admin",
      cell: (r) =>
        r.adminId ? (
          <span className="block max-w-[10rem] truncate" title={r.adminName ?? undefined}>
            {r.adminName ?? `#${r.adminId}`}
            {r.actorRole ? <span className="text-muted-foreground"> · {roleLabel(r.actorRole)}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">Tizim (CLI)</span>
        ),
    },
    { id: "outcome", header: "Natija", cell: (r) => <OutcomeBadge outcome={r.outcome} /> },
    {
      id: "reason",
      header: "Sabab",
      cell: (r) =>
        r.reason ? (
          <span className="block max-w-[16rem] truncate" title={r.reason}>
            {r.reason}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  const data = state.status === "ready" ? state.data : null;
  const total = data?.total ?? null;
  const more = data !== null && (data.nextCursor !== null || data.totalCapped);

  return (
    <Card>
      <CardHeader
        title="Audit"
        description="Shu foydalanuvchiga nisbatan bajarilgan admin amallari, eng yangisi birinchi."
        aside={
          <Link
            href={userAuditHref(userId)}
            className="border-input hover:bg-muted inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap"
          >
            Audit jurnalida ochish
          </Link>
        }
      />
      <CardBody className="flex flex-col gap-2">
        <DataTable
          caption="Foydalanuvchiga oid audit yozuvlari"
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={state.status === "loading"}
          skeletonRows={3}
          onRowClick={(r) => router.push(userAuditHref(userId, r.id))}
          empty={<EmptyState title="Audit yozuvlari yo'q" description="Bu foydalanuvchiga nisbatan hali admin amali bajarilmagan." />}
        />
        {more && total !== null ? (
          <p className="text-muted-foreground text-xs">
            Oxirgi {fmtNumber(USER_AUDIT_LIMIT)} ta ko&apos;rsatilgan, jami {data?.totalCapped ? `${fmtNumber(total)}+` : fmtNumber(total)} ta — qolganlari audit jurnalida.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
