"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { getError, resolveError, type ErrorDetail } from "@/lib/admin-api/system";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import { Badge, Button, ConfirmDialog, CopyButton, Drawer, ErrorState, Forbidden, KeyValueList, Skeleton, toast, useLoad } from "@/components/admin/ui";
import { UUID_RE } from "./shared";

/**
 * Detail drawer of one error (S16): fields, the full message and the stack in a
 * monospace scroll box. Everything is rendered as React text (never as HTML).
 * "Hal qilindi" (single resolve, reason optional) is offered only to
 * `errors.resolve`; the server enforces it anyway.
 */
export function ErrorDrawer({
  id,
  canResolve,
  onClose,
  onChanged,
}: {
  id: string;
  canResolve: boolean;
  onClose: () => void;
  /** Called after a successful resolve so the list refreshes. */
  onChanged: () => void;
}) {
  const load = useCallback((signal: AbortSignal) => getError(id, { signal }), [id]);
  const [state, reload] = useLoad(load);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const data = state.status === "ready" ? state.data : null;

  return (
    <>
      <Drawer
        open
        // Escape is a window-level listener in both dialogs: while the confirm is open it must not close the drawer too.
        onClose={() => {
          if (!confirmOpen) onClose();
        }}
        title="Xato tafsiloti"
        description={data ? <span className="font-mono text-xs">#{data.id}</span> : undefined}
        footer={
          data && canResolve && !data.resolvedAt ? (
            <Button variant="primary" onClick={() => setConfirmOpen(true)} icon={<CircleCheck className="size-3.5" aria-hidden="true" />}>
              Hal qilindi deb belgilash
            </Button>
          ) : undefined
        }
      >
        {state.status === "loading" ? (
          <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : state.status === "forbidden" ? (
          <Forbidden />
        ) : state.status === "error" ? (
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        ) : (
          <DetailBody e={state.data} />
        )}
      </Drawer>
      {data ? (
        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Xatoni hal qilindi deb belgilash"
          description="Xuddi shu xato qayta yuz bersa, u yangi ochiq yozuv sifatida paydo bo'ladi."
          target={<span className="font-mono text-xs break-words">{data.message.slice(0, 160)}</span>}
          before="Ochiq"
          after="Hal qilingan"
          reason={{ required: false, label: "Izoh (ixtiyoriy)" }}
          confirmLabel="Belgilash"
          onConfirm={async (ctx) => {
            await resolveError(data.id, ctx.reason);
            toast("Xato hal qilindi deb belgilandi");
            // The reload below swaps the drawer body for a skeleton (which unmounts this dialog), so close it first.
            setConfirmOpen(false);
            reload();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function DetailBody({ e }: { e: ErrorDetail }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={e.level === "error" ? "danger" : "warning"} dot>
          {e.level}
        </Badge>
        {e.resolvedAt ? <Badge tone="success">Hal qilingan</Badge> : <Badge>Ochiq</Badge>}
        <span className="text-muted-foreground text-xs tabular-nums">{fmtNumber(e.count)} marta</span>
      </div>

      <section aria-label="Xabar">
        <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase">Xabar</h3>
        <p className="bg-muted rounded-lg px-3 py-2 font-mono text-[12.5px] break-words whitespace-pre-wrap">{e.message}</p>
      </section>

      <KeyValueList
        items={[
          { label: "Joy (scope)", value: e.scope || "—", mono: true },
          { label: "Birinchi marta", value: fmtDateTime(e.firstSeenAt) },
          { label: "Oxirgi marta", value: fmtDateTime(e.lastSeenAt) },
          { label: "Yo'l", value: e.path, mono: true },
          { label: "Jarayon", value: e.process, mono: true },
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
            value: e.userId ? (
              <Link href={`/admin/users/${encodeURIComponent(e.userId)}`} className="text-primary underline-offset-2 hover:underline">
                #{e.userId}
              </Link>
            ) : null,
          },
          {
            label: "Ish (job)",
            value: e.jobId ? (
              UUID_RE.test(e.jobId) ? (
                <Link href={`/admin/generations/${encodeURIComponent(e.jobId)}`} className="text-primary underline-offset-2 hover:underline">
                  {e.jobId}
                </Link>
              ) : (
                e.jobId
              )
            ) : null,
            mono: true,
          },
          { label: "Hal qilingan", value: e.resolvedAt ? `${fmtDateTime(e.resolvedAt)}${e.resolvedBy ? ` · admin #${e.resolvedBy}` : ""}` : null },
        ]}
      />

      <section aria-label="Stek izi" className="flex min-h-0 flex-col gap-1">
        <h3 className="text-muted-foreground text-[11px] font-semibold uppercase">Stek izi</h3>
        {e.stack ? (
          <pre
            tabIndex={0}
            data-stack
            className="bg-muted max-h-80 overflow-auto rounded-lg px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre"
          >
            {e.stack}
          </pre>
        ) : (
          <p className="text-muted-foreground text-[13px]">Bu yozuvda stek izi yo&apos;q.</p>
        )}
      </section>
    </>
  );
}
