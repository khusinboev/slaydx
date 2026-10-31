"use client";

import { useState } from "react";
import { fmtNumber, fmtUsd } from "@/lib/admin-format";
import { Badge, Button } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import type { RouteItem } from "@/lib/admin-api/providers";
import type { Category } from "./categories";
import { SOURCE_LABEL, propagationNote } from "./format";
import { RouteEditor } from "./RouteEditor";

/**
 * «Ishlatish tartibi»: every routing slot of the category as a numbered list with state dots. «Tahrirlash» swaps one slot
 * for the full editor (same logic, same dialogs); roles without edit rights only read.
 */
export function RoutePanel({ category, canEdit, propagationSec, onChanged }: { category: Category; canEdit: boolean; propagationSec: number; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section aria-label="Ishlatish tartibi" className="bg-card overflow-hidden rounded-xl border">
      <header className="px-4 py-3">
        <h3 className="text-[15px] font-semibold">Ishlatish tartibi</h3>
        <p className="text-muted-foreground text-xs">Birinchisi javob bermasa — zaxira ishlaydi. {canEdit ? propagationNote(propagationSec) : ""}</p>
      </header>
      {category.routes.map((r) => (
        <div key={r.id} data-route-slot={r.id} className="border-t px-4 py-3">
          {editing === r.id ? (
            <div className="flex flex-col gap-2">
              <RouteEditor
                key={`${r.id}:${r.source}:${r.entries.map((e) => `${e.provider}/${e.model ?? ""}`).join(",")}`}
                route={r}
                canEdit={canEdit}
                propagationSec={propagationSec}
                onChanged={() => {
                  setEditing(null);
                  onChanged();
                }}
              />
              <Button size="sm" className="self-start max-[640px]:h-10 max-[640px]:w-full" onClick={() => setEditing(null)}>
                Yopish
              </Button>
            </div>
          ) : (
            <RouteSummary route={r} canEdit={canEdit} onEdit={() => setEditing(r.id)} />
          )}
        </div>
      ))}
      {category.routes.length === 0 ? <p className="text-muted-foreground border-t px-4 py-3 text-[12.5px] leading-snug">{category.noRoutes}</p> : null}
      {category.settings.map((s) => (
        <p key={s.key} className="text-muted-foreground border-t px-4 py-3 text-xs">
          «{s.label}»: <span className="text-foreground font-medium">{s.enabled ? "yoqilgan" : "o'chirilgan"}</span> —{" "}
          <a href="/admin/settings" className="underline underline-offset-2">
            Sozlamalar
          </a>{" "}
          bo&apos;limida o&apos;zgartiriladi.
        </p>
      ))}
    </section>
  );
}

function RouteSummary({ route, canEdit, onEdit }: { route: RouteItem; canEdit: boolean; onEdit: () => void }) {
  return (
    <div data-route={route.id} data-source={route.source} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13.5px] font-semibold">{route.title}</span>
        <Badge tone={route.source === "db" ? "primary" : "neutral"}>{SOURCE_LABEL[route.source]}</Badge>
      </div>
      <p className="text-muted-foreground text-xs leading-snug">{route.help}</p>
      <ol className="flex flex-col gap-1.5" aria-label={route.title}>
        {route.entries.map((e, i) => (
          <li key={`${e.provider}/${e.model ?? ""}`} data-entry={i} data-usable={e.usable ? "1" : "0"} className="bg-muted/30 flex items-center gap-2 rounded-lg border px-2.5 py-2">
            <span className="bg-muted flex size-5 shrink-0 items-center justify-center rounded-md text-[11.5px] font-semibold">{i + 1}</span>
            <span className="min-w-0 flex-1 text-[13px]">{e.model ? `${e.label} · ${e.model}` : e.label}</span>
            <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", e.usable ? "bg-success" : "bg-muted-foreground")} />
            <span className="text-muted-foreground text-[11.5px]">{e.usable ? "Ishlayapti" : "Ishlamayapti"}</span>
          </li>
        ))}
      </ol>
      {canEdit ? (
        <Button size="sm" className="self-start max-[640px]:h-10 max-[640px]:w-full" onClick={onEdit} aria-label={`${route.title}: tahrirlash`}>
          Tahrirlash
        </Button>
      ) : null}
    </div>
  );
}

/** «Sarf · 30 kun»: a bar per provider and kind, by share of the category's money. */
export function SpendPanel({ category }: { category: Category }) {
  const max = category.spendUsd;
  return (
    <section aria-label="Sarf" className="bg-card overflow-hidden rounded-xl border">
      <header className="flex items-baseline px-4 py-3">
        <h3 className="flex-1 text-[15px] font-semibold">Sarf · 30 kun</h3>
        <span data-spend-total className="font-bold tabular-nums">
          {fmtUsd(category.spendUsd)}
        </span>
      </header>
      {category.spendRows.map((r) => (
        <div key={r.key} data-spend-row className="flex flex-col gap-1.5 border-t px-4 py-2.5">
          <div className="flex gap-2 text-[13px]">
            <span className="min-w-0 flex-1">{r.label}</span>
            <span className="text-muted-foreground">{fmtNumber(r.calls)} ta</span>
            <span className="min-w-16 text-right font-semibold tabular-nums">{r.free ? "Bepul" : fmtUsd(r.usd)}</span>
          </div>
          <div className="bg-muted h-1.5 rounded-full">
            <div data-bar className="bg-primary h-1.5 rounded-full" style={{ width: `${max > 0 ? Math.round((r.usd / max) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
      {category.spendRows.length === 0 ? <p className="text-muted-foreground border-t px-4 py-3 text-xs">30 kunda bu toifada so&apos;rov bo&apos;lmagan.</p> : null}
    </section>
  );
}
