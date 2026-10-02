"use client";

import { DataTable, EmptyState, ErrorState, Forbidden, StatusPill, type Column } from "@/components/admin/ui";
import { useResource } from "@/components/admin/payments";
import { fmtDateTime } from "@/lib/admin-format";
import { listUserSessions, type AdminUserSession } from "@/lib/admin-api/users";
import { deviceLabel } from "./labels";

function sessionState(s: AdminUserSession) {
  if (s.active) return <StatusPill tone="success" dot>Faol</StatusPill>;
  if (s.revokedAt) return <StatusPill tone="danger" dot>Bekor qilingan</StatusPill>;
  return <StatusPill dot>Muddati o&apos;tgan</StatusPill>;
}

/** The user's login sessions (users.sessions); `reloadKey` refetches after a revoke or block. */
export function UserSessionsTab({ userId, reloadKey }: { userId: string; reloadKey: number }) {
  const { state, retry } = useResource(`${userId}:${reloadKey}`, (signal) => listUserSessions(userId, { signal }));

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

  const columns: Column<AdminUserSession>[] = [
    { id: "created", header: "Yaratilgan", className: "tabular-nums whitespace-nowrap", cell: (s) => fmtDateTime(s.createdAt) },
    { id: "seen", header: "Oxirgi faollik", className: "tabular-nums whitespace-nowrap", cell: (s) => fmtDateTime(s.lastSeenAt) },
    { id: "expires", header: "Tugaydi", className: "tabular-nums whitespace-nowrap", cell: (s) => fmtDateTime(s.expiresAt) },
    {
      id: "device",
      header: "Qurilma",
      className: "max-w-[14rem]",
      cell: (s) => (
        <span className="block truncate" title={s.userAgent ?? undefined}>
          {deviceLabel(s.userAgent)}
        </span>
      ),
    },
    { id: "state", header: "Holat", cell: sessionState },
    { id: "revoked", header: "Bekor qilingan", className: "tabular-nums whitespace-nowrap", cell: (s) => (s.revokedAt ? fmtDateTime(s.revokedAt) : "—") },
  ];

  return (
    <DataTable
      caption="Foydalanuvchi sessiyalari"
      columns={columns}
      rows={state.data?.items ?? []}
      rowKey={(s) => s.id}
      loading={state.status === "loading"}
      skeletonRows={3}
      empty={<EmptyState title="Sessiyalar yo'q" description="Tugagan va bekor qilingan sessiyalar 7 kundan keyin o'chiriladi." />}
    />
  );
}
