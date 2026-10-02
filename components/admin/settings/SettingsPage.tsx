"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { useCan } from "@/components/admin/shell";
import { Card, CardHeader, EmptyState, ErrorState, Forbidden, Skeleton } from "@/components/admin/ui";
import type { SettingItem } from "@/lib/admin-api/settings";
import { groupItems, PROPAGATION_NOTE, type ToolOption } from "./format";
import { SettingEditDialog } from "./SettingEditDialog";
import { SettingResetDialog } from "./SettingResetDialog";
import { SettingRow } from "./SettingRow";
import { useSettings } from "./useSettings";

function Loading() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      {[3, 2].map((rows, i) => (
        <Card key={i}>
          <div className="border-b px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex flex-col gap-2 border-t px-4 py-3.5 first:border-t-0">
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-3 w-80 max-w-full" />
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

/**
 * S14 `/admin/settings`: runtime flags in cards by group (Bepul AI,
 * Generatsiya, Moliya, Narxlar). Each row shows the effective value, its
 * source, the env value and the last writer. Viewers and finance only read;
 * editors get "O'zgartirish" and, for DB overrides, "Standartga qaytarish".
 * `tools` is the registry the server page passes in (this module must not
 * import `lib/tools.ts`).
 */
export function SettingsPage({ tools }: { tools: ReadonlyArray<ToolOption> }) {
  const canEdit = useCan("settings.edit");
  const { state, reload, replace } = useSettings();
  const [editing, setEditing] = useState<SettingItem | null>(null);
  const [resetting, setResetting] = useState<SettingItem | null>(null);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Sozlamalar</h1>
        <p className="text-muted-foreground text-[13px]">
          Qayta deploy qilmasdan o&apos;zgartiriladigan qiymatlar.{canEdit ? "" : " Sizda faqat ko'rish huquqi bor."}
        </p>
      </header>

      <div role="note" className="bg-info/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
        <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{PROPAGATION_NOTE}</p>
      </div>

      {state.status === "loading" ? <Loading /> : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <Card>
          <EmptyState title="Sozlamalar yo'q" description="Katalogda sozlama topilmadi." />
        </Card>
      ) : null}
      {state.status === "ready"
        ? groupItems(state.items).map((g) => (
            <Card key={g.group}>
              <CardHeader title={g.group} />
              <ul>
                {g.items.map((item) => (
                  <SettingRow key={item.key} item={item} tools={tools} canEdit={canEdit} onEdit={setEditing} onReset={setResetting} />
                ))}
              </ul>
            </Card>
          ))
        : null}

      <SettingEditDialog
        item={editing}
        tools={tools}
        onClose={() => setEditing(null)}
        onSaved={(item) => {
          replace(item);
          setEditing(null);
        }}
      />
      <SettingResetDialog
        item={resetting}
        tools={tools}
        onClose={() => setResetting(null)}
        onReset={(item) => {
          replace(item);
          setResetting(null);
        }}
        onStale={reload}
      />
    </div>
  );
}
