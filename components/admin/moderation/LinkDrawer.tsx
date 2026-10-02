"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Trash2 } from "lucide-react";
import {
  AdminForbiddenError,
  ApiError,
  adminErrorMessage,
  adminRequestId,
  isAbortError,
  type AdminCallOptions,
} from "@/lib/admin-api/core";
import {
  BULK_DELETE_MAX,
  deleteGameResult,
  deleteGameResults,
  getGameLink,
  revokeGameLink,
  type ModerationLinkDetail,
  type ModerationResult,
} from "@/lib/admin-api/moderation";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Forbidden,
  KeyValueList,
  Skeleton,
  toast,
  type Column,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";
import { GamePreview } from "./GamePreview";
import { LinkStatusPill, kindLabel, shortId } from "./shared";

/** More than this many rows needs a typed confirmation (plan §7.0: bulk actions). */
export const TYPED_CONFIRM_ABOVE = 10;

type State =
  | { kind: "loading" }
  | { kind: "ok"; data: ModerationLinkDetail }
  | { kind: "error"; message: string; requestId?: string }
  | { kind: "forbidden" };

type Pending = { type: "revoke" } | { type: "delete"; ids: string[] };

/**
 * S12 drawer: one game link with the public preview, its results (per-result
 * checkboxes + bulk delete) and the revoke action. Actions show only with
 * `moderation.act` (cosmetic; the server enforces it).
 */
export function LinkDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Drawer open={id !== null} onClose={onClose} title="O'yin havolasi">
      {id !== null ? <DrawerBody key={id} id={id} onChanged={onChanged} /> : null}
    </Drawer>
  );
}

function DrawerBody({ id, onChanged }: { id: string; onChanged: () => void }) {
  const canAct = useCan("moderation.act");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    const opts: AdminCallOptions = { signal: ctl.signal };
    getGameLink(id, opts)
      .then((data) => setState({ kind: "ok", data }))
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (e instanceof AdminForbiddenError) setState({ kind: "forbidden" });
        else setState({ kind: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) });
      });
    return () => ctl.abort();
  }, [id, reload]);

  const refresh = useCallback(() => {
    setSelected(new Set());
    setReload((n) => n + 1);
    onChanged();
  }, [onChanged]);

  if (state.kind === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state.kind === "forbidden") return <Forbidden />;
  if (state.kind === "error") {
    return <ErrorState message={state.message} requestId={state.requestId} onRetry={() => setReload((n) => n + 1)} />;
  }

  const { link, preview, results } = state.data;
  const bySelection = results.filter((r) => selected.has(r.id));
  const tooMany = selected.size > BULK_DELETE_MAX;

  const columns: Column<ModerationResult>[] = [
    { id: "name", header: "Ism", className: "max-w-[10rem] break-words", cell: (r) => r.playerName },
    { id: "score", header: "Ball", align: "right", className: "tabular-nums whitespace-nowrap", cell: (r) => `${fmtNumber(r.score)}/${fmtNumber(r.total)}` },
    { id: "time", header: "Vaqt", className: "tabular-nums whitespace-nowrap", cell: (r) => fmtDateTime(r.createdAt) },
    ...(canAct
      ? [
          {
            id: "act",
            header: "",
            align: "right" as const,
            cell: (r: ModerationResult) => (
              <Button size="sm" variant="dangerOutline" onClick={() => setPending({ type: "delete", ids: [r.id] })}>
                O&apos;chirish
              </Button>
            ),
          },
        ]
      : []),
  ];

  const pendingResults = pending?.type === "delete" ? results.filter((r) => pending.ids.includes(r.id)) : [];

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold break-words">{link.topic || "—"}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <LinkStatusPill active={link.active} />
          <span className="text-muted-foreground text-xs">{kindLabel(link.kind)}</span>
        </div>
      </div>

      <KeyValueList
        items={[
          {
            label: "Egasi",
            value: (
              <Link href={`/admin/users/${encodeURIComponent(link.userId)}`} className="hover:text-primary underline-offset-2 hover:underline">
                {link.userName || `#${link.userId}`}
              </Link>
            ),
          },
          {
            label: "Ish",
            value: (
              <Link href={`/admin/generations/${encodeURIComponent(link.generationId)}`} className="hover:text-primary font-mono text-xs underline-offset-2 hover:underline">
                {shortId(link.generationId)}
              </Link>
            ),
          },
          { label: "Yaratilgan", value: fmtDateTime(link.createdAt) },
          { label: "Tugaydi", value: link.expiresAt ? fmtDateTime(link.expiresAt) : "Muddatsiz" },
          { label: "Natijalar", value: fmtNumber(link.results) },
        ]}
      />

      {canAct && link.active ? (
        <div>
          <Button variant="danger" icon={<Ban className="size-4" aria-hidden="true" />} onClick={() => setPending({ type: "revoke" })}>
            Havolani o&apos;chirish
          </Button>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">Ochiq ko&apos;rinish</h3>
        <GamePreview view={preview} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">
            Natijalar ({fmtNumber(link.results)}
            {link.results > results.length ? `, oxirgi ${fmtNumber(results.length)} ta ko'rsatilgan` : ""})
          </h3>
          {canAct && selected.size > 0 ? (
            <Button
              size="sm"
              variant="danger"
              disabled={tooMany}
              icon={<Trash2 className="size-3.5" aria-hidden="true" />}
              onClick={() => setPending({ type: "delete", ids: bySelection.map((r) => r.id) })}
            >
              Tanlanganlarni o&apos;chirish ({fmtNumber(selected.size)})
            </Button>
          ) : null}
        </div>
        {tooMany ? (
          <p role="status" className="text-destructive text-xs">
            Bir vaqtda ko&apos;pi bilan {BULK_DELETE_MAX} ta natija o&apos;chiriladi. Tanlovni kamaytiring.
          </p>
        ) : null}
        <DataTable
          columns={columns}
          rows={results}
          rowKey={(r) => r.id}
          caption="Havola natijalari"
          selectable={canAct}
          selected={selected}
          onSelectedChange={setSelected}
          maxHeightClass="max-h-96"
          empty={<EmptyState title="Natija yo'q" description="Bu havola bo'yicha hali hech kim o'ynamagan." />}
        />
      </section>

      <ConfirmDialog
        open={pending?.type === "revoke"}
        onClose={() => setPending(null)}
        title="Havolani o'chirish"
        description="Havola darhol ishlamay qoladi: o'yinchilar sahifani ocholmaydi. Natijalar saqlanadi."
        target={
          <span>
            {link.topic} · <span className="text-muted-foreground">{kindLabel(link.kind)}</span>
          </span>
        }
        before="faol"
        after="o'chirilgan"
        reason={{ minLength: 5 }}
        danger
        confirmLabel="Havolani o'chirish"
        onConfirm={async ({ reason }) => {
          try {
            await revokeGameLink(link.id, reason);
          } catch (e) {
            // 409: somebody else (or the clock) already killed it; show the current state behind the dialog.
            if (e instanceof ApiError && e.status === 409) refresh();
            throw e;
          }
          toast("Havola o'chirildi");
          refresh();
        }}
      />

      <ConfirmDialog
        open={pending?.type === "delete"}
        onClose={() => setPending(null)}
        title={pendingResults.length === 1 ? "Natijani o'chirish" : "Natijalarni o'chirish"}
        description="Natija qaytarib bo'lmaydigan tarzda o'chiriladi. To'liq nusxasi audit jurnaliga yoziladi."
        target={
          pendingResults.length === 1 ? (
            <span className="break-words">
              {pendingResults[0]!.playerName} · {fmtNumber(pendingResults[0]!.score)}/{fmtNumber(pendingResults[0]!.total)}
            </span>
          ) : (
            <span>{fmtNumber(pendingResults.length)} ta natija</span>
          )
        }
        reason={{ minLength: 5 }}
        typedConfirmation={pendingResults.length > TYPED_CONFIRM_ABOVE ? String(pendingResults.length) : undefined}
        danger
        confirmLabel="O'chirish"
        onConfirm={async ({ reason }) => {
          const ids = pendingResults.map((r) => r.id);
          if (ids.length === 1) await deleteGameResult(ids[0]!, reason);
          else await deleteGameResults(ids, reason);
          toast(ids.length === 1 ? "Natija o'chirildi" : `${fmtNumber(ids.length)} ta natija o'chirildi`);
          refresh();
        }}
      />
    </>
  );
}
