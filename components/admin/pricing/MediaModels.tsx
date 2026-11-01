"use client";

import { useCallback, useId, useState } from "react";
import { Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, Skeleton, toast } from "@/components/admin/ui";
import { ApiError } from "@/lib/admin-api/core";
import { getMediaModels, updateMediaModel, type MediaModelItem, type MediaModelState, type MediaModelsOverview } from "@/lib/admin-api/pricing";
import { fmtNumber } from "@/lib/admin-format";
import { cn } from "@/lib/cn";
import { marginTone, markupText, pctText, soumText, usdText, useLoad } from "./shared";

/**
 * «Media modellari» block of «Narxlar» (docs/studio/P1-SPEC.md «Admin»): every Studio model with its provider cost per
 * picture (USD and so'm), the price the user pays at the current markup (the server computes it with the charging
 * function, this screen never prices anything), the margin, the enable switch and the markup override. A change goes
 * through the same confirm dialog as every price write: reason (audited), step-up code (asked by the admin API core).
 */
export function MediaModels({ canEdit }: { canEdit: boolean }) {
  const load = useCallback((signal: AbortSignal) => getMediaModels({ signal }), []);
  const [state, retry] = useLoad<MediaModelsOverview>(load);
  const [fresh, setFresh] = useState<MediaModelsOverview | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (state.status === "forbidden") return null;
  if (state.status === "loading") return <Skeleton className="h-40 w-full rounded-xl" />;
  if (state.status === "error") {
    return (
      <Card>
        <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
      </Card>
    );
  }
  const data = fresh ?? state.data;
  const item = editing ? (data.models.find((m) => m.modelId === editing) ?? null) : null;
  return (
    <Card>
      <CardHeader
        title={`Media modellari (${fmtNumber(data.models.length)})`}
        aside={
          <span className="text-muted-foreground text-xs">
            Narx = xarajat × {markupText(data.markup)} (umumiy ustama), {fmtNumber(data.step)} so‘mga yuqoriga · 1 $ = {soumText(data.soumPerUsd)}
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]" data-testid="media-models">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-4 py-2 font-semibold">Model</th>
              <th className="px-2 py-2 font-semibold">Xarajat / rasm</th>
              <th className="px-2 py-2 font-semibold">Ustama</th>
              <th className="px-2 py-2 font-semibold">Narx / rasm</th>
              <th className="px-2 py-2 font-semibold">Marja</th>
              <th className="px-2 py-2 font-semibold">Holat</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.models.map((m) => (
              <tr key={m.modelId} className="border-t" data-model={m.modelId}>
                <td className="px-4 py-2">
                  <div className="font-semibold">{m.label}</div>
                  <div className="text-muted-foreground text-xs">{m.maker}</div>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {usdText(m.costUsd)}
                  <div className="text-muted-foreground text-xs">{soumText(m.costSoum)}</div>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {markupText(m.markup)}
                  {m.markupOverride === null ? <div className="text-muted-foreground text-xs">umumiy</div> : <div className="text-xs font-semibold">o‘z ustamasi</div>}
                </td>
                <td className="px-2 py-2 tabular-nums font-semibold">
                  {soumText(m.price)}
                  {m.price !== m.priceBase ? <div className="text-muted-foreground text-xs font-normal">asosiy {soumText(m.priceBase)}</div> : null}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  <Badge tone={marginTone(m.marginPct)}>{pctText(m.marginPct)}</Badge>
                  <div className="text-muted-foreground text-xs">{soumText(m.marginSoum)}</div>
                </td>
                <td className="px-2 py-2">
                  <StatusBadge m={m} />
                </td>
                <td className="px-4 py-2 text-right">
                  {canEdit ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m.modelId)} className="max-sm:min-h-11">
                      O‘zgartirish
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && item ? (
        <EditDialog
          key={item.modelId}
          item={item}
          min={data.markupMin}
          max={data.markupMax}
          globalMarkup={data.markup}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setEditing(null);
            setFresh(next);
          }}
          onStale={() => {
            setFresh(null);
            retry();
          }}
        />
      ) : null}
    </Card>
  );
}

function StatusBadge({ m }: { m: MediaModelItem }) {
  if (!m.enabled) return <Badge tone="neutral">O‘chirilgan</Badge>;
  if (!m.providerReady) return <Badge tone="warning">Provayder sozlanmagan</Badge>;
  return <Badge tone="success">Sotuvda</Badge>;
}

const FIELD = "border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] tabular-nums outline-none focus:ring-2";

/** Markup text → number (comma or dot), `null` for blank (= the global markup), `undefined` for invalid. */
export function parseMarkupText(text: string, min: number, max: number): number | null | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(t)) return undefined;
  const n = Number(t);
  return n >= min && n <= max ? n : undefined;
}

const stateText = (s: MediaModelState, globalMarkup: number) =>
  `${s.enabled ? "yoqilgan" : "o‘chirilgan"} · ${s.markup === null ? `umumiy ${markupText(globalMarkup)}` : markupText(s.markup)}`;

function EditDialog({
  item,
  min,
  max,
  globalMarkup,
  onClose,
  onSaved,
  onStale,
}: {
  item: MediaModelItem;
  min: number;
  max: number;
  globalMarkup: number;
  onClose: () => void;
  onSaved: (next: MediaModelsOverview) => void;
  onStale: () => void;
}) {
  const ids = useId();
  const current: MediaModelState = { enabled: item.enabled, markup: item.markupOverride };
  const [enabled, setEnabled] = useState(item.enabled);
  const [text, setText] = useState(item.markupOverride === null ? "" : String(item.markupOverride));
  const markup = parseMarkupText(text, min, max);
  const invalid = markup === undefined;
  const next: MediaModelState | null = invalid ? null : { enabled, markup };
  const unchanged = next !== null && next.enabled === current.enabled && next.markup === current.markup;
  return (
    <ConfirmDialog
      open
      sheet
      onClose={onClose}
      title={`Media model — ${item.label}`}
      description="Narx = provayder xarajati × ustama, 100 so‘mga yuqoriga yaxlitlanadi. O‘zgarish faqat yangi buyurtmalarga ta’sir qiladi."
      before={stateText(current, globalMarkup)}
      after={next ? stateText(next, globalMarkup) : "—"}
      reason={{ minLength: 5 }}
      confirmLabel="Qo‘llash"
      confirmDisabled={next === null || unchanged}
      onConfirm={async ({ reason }) => {
        if (!next) return;
        let res: MediaModelsOverview;
        try {
          res = await updateMediaModel(item.modelId, next, reason, current);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && e.data.code === "stale") onStale();
          throw e;
        }
        toast(`${item.label}: ${stateText(next, globalMarkup)}`);
        onSaved(res);
      }}
    >
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-primary size-4" />
        Studio’da sotiladi
      </label>
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <label htmlFor={`${ids}-mk`} className="font-semibold">
          O‘z ustamasi (×) <span className="text-muted-foreground font-normal">· {min}–{max}, bo‘sh = umumiy {markupText(globalMarkup)}</span>
        </label>
        <input id={`${ids}-mk`} value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoComplete="off" aria-invalid={invalid} className={FIELD} />
        <span className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
          {invalid ? `Ustama ${min} dan ${max} gacha son bo‘lsin` : unchanged ? "Hech narsa o‘zgarmadi" : ""}
        </span>
      </div>
    </ConfirmDialog>
  );
}
