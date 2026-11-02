"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { usePricingVersion } from "@/lib/store";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import type { Badge, ClientEntry } from "@/lib/studio-core";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "@/components/overlays/OverlayFrame";
import { useDialog } from "@/components/overlays/useDialog";
import { useMediaCatalog } from "./studio-api";
import { BADGE_LABEL, FILTER_BADGES, badgeText, initials, unitPrice } from "./studio-price";
import type { MediaCatalog, StudioPricing } from "./studio-types";

/** How many model cards the row shows before «Barcha modellar». */
export const ROW_CARDS = 3;

export type MediaModelPickerProps = {
  /** Catalog purpose (`studio.image`): the allowed models and the default come from the server for it. */
  purpose: string;
  /** Chosen model id. */
  value: string;
  onChange: (modelId: string) => void;
  /** The form's current values: the price per picture on every card follows them (ratio, quality …). */
  values: Readonly<Record<string, unknown>>;
  /**
   * The catalog, when the host already loaded it (Studio does: its settings come from the same entries). Without it
   * the picker loads `purpose` itself — that is what makes it embeddable in any form.
   */
  catalog?: MediaCatalog;
  /** Controlled sheet (the host can open it, e.g. «Boshqa modelda»); uncontrolled when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Card price text of a model (the Video tab: «~10 700 so'm / 5 s»); default «~X so'm / rasm». */
  priceOf?: (model: ClientEntry) => string;
};

/** The cards the row shows: the first `max` models, with the chosen one always among them. */
export function rowModels(models: readonly ClientEntry[], value: string, max = ROW_CARDS): ClientEntry[] {
  const head = models.slice(0, max);
  if (head.some((m) => m.id === value)) return head;
  const chosen = models.find((m) => m.id === value);
  return chosen ? [...head.slice(0, Math.max(0, max - 1)), chosen] : head;
}

/**
 * MediaModelPicker (docs/studio/PLAN.md §18): the chosen model + a few alternatives as cards, and the «Barcha modellar»
 * bottom sheet (a centred dialog on a desktop) with filter chips. Every card shows the price of ONE picture, computed
 * from the same catalog entry and pricing context as the submit button (`studio-price.ts`).
 *
 * The sheet is a `useDialog` overlay: it has its own history entry, so the phone's back button and the Telegram
 * BackButton close it before leaving the page. «Tanlash» applies the highlighted model; closing otherwise keeps the
 * previous choice.
 */
export function MediaModelPicker({ purpose, value, onChange, values, catalog, open, onOpenChange, priceOf }: MediaModelPickerProps) {
  usePricingVersion(); // an admin price adjustment re-renders the prices on the cards
  const own = useMediaCatalog(purpose, !catalog);
  const [innerOpen, setInnerOpen] = useState(false);
  const sheetOpen = open ?? innerOpen;
  const setOpen = (o: boolean) => {
    if (open === undefined) setInnerOpen(o);
    onOpenChange?.(o);
  };

  const loaded = catalog ?? (own.state.status === "ready" ? own.state.catalog : null);
  if (!loaded) {
    return (
      <section aria-label="Model" data-model-picker className="mb-3">
        <Heading />
        {own.state.status === "error" ? (
          <p role="alert" className="text-destructive text-[14.5px]" data-model-error>
            {own.state.message}{" "}
            <button type="button" onClick={() => own.reload()} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
              Qayta urinish
            </button>
          </p>
        ) : (
          <div className="bg-muted/60 h-[5.25rem] animate-pulse rounded-[18px]" role="status" aria-label="Modellar yuklanmoqda" data-model-loading />
        )}
      </section>
    );
  }

  const { models, pricing } = loaded;
  if (models.length === 0) {
    return (
      <section aria-label="Model" data-model-picker className="mb-3">
        <Heading />
        <p className="text-muted-foreground text-[14.5px]" data-model-empty>
          Hozircha modellar mavjud emas. Birozdan keyin qayta urinib ko‘ring.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Model" data-model-picker className="mb-3">
      <Heading
        action={
          <button
            type="button"
            data-model-all
            onClick={() => setOpen(true)}
            className="text-accent-soft-foreground focus-visible:ring-ring pointer-coarse:min-h-11 -my-2 rounded-[10px] px-2 py-2 text-[13.5px] font-semibold outline-none focus-visible:ring-2"
          >
            Barcha modellar
          </button>
        }
      />
      <div role="group" aria-label="Model" className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-model-row>
        {rowModels(models, value).map((m) => (
          <ModelCard key={m.id} model={m} selected={m.id === value} text={priceOf ? priceOf(m) : priceText(unitPrice(m, values, pricing))} onPick={() => onChange(m.id)} />
        ))}
      </div>
      {sheetOpen ? (
        <ModelSheet
          models={models}
          pricing={pricing}
          values={values}
          value={value}
          onPick={onChange}
          onClose={() => setOpen(false)}
          priceOf={priceOf}
        />
      ) : null}
    </section>
  );
}

function Heading({ action }: { action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-muted-foreground text-[13px] font-semibold tracking-[0.06em] uppercase">Model</h2>
      {action}
    </div>
  );
}

function priceText(price: number): string {
  return `~${groupDigits(price)} so'm / rasm`;
}

function ModelCard({ model, selected, text, onPick }: { model: ClientEntry; selected: boolean; text: string; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-model-card={model.id}
      onClick={onPick}
      className={cn(
        "bg-card focus-visible:ring-ring min-h-[5.25rem] min-w-0 rounded-[18px] border-2 p-3 text-left outline-none transition-colors focus-visible:ring-2",
        selected ? "border-primary" : "border-border hover:border-foreground/25",
      )}
    >
      <span className="block truncate text-[15px] font-bold">{model.label}</span>
      {badgeText(model) ? <span className="text-muted-foreground mt-0.5 block truncate text-[12.5px]">{badgeText(model)}</span> : null}
      <span className="text-accent-soft-foreground mt-1.5 block text-[13px] font-semibold tabular-nums" data-model-price>
        {text}
      </span>
    </button>
  );
}

function ModelSheet({
  models,
  pricing,
  values,
  value,
  onPick,
  onClose,
  priceOf,
}: {
  models: readonly ClientEntry[];
  pricing: StudioPricing;
  values: Readonly<Record<string, unknown>>;
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
  priceOf?: (model: ClientEntry) => string;
}) {
  const phone = useCoarsePointer();
  const [draft, setDraft] = useState(value);
  const [filter, setFilter] = useState<Badge | null>(null);
  const panelRef = useDialog(true, onClose);
  // A chip is drawn only when some model carries its badge (no chip that leads to an empty list).
  const chips = FILTER_BADGES.filter((b) => models.some((m) => m.badges.includes(b)));
  const shown = filter ? models.filter((m) => m.badges.includes(filter)) : models;
  const video = models.some((m) => m.kind === "video");
  const chip = "pointer-coarse:min-h-11 focus-visible:ring-ring rounded-[12px] px-3 py-1.5 text-[13.5px] outline-none focus-visible:ring-2";
  return (
    <OverlayFrame label={video ? "Video modelini tanlash" : "Rasm modelini tanlash"} phone={phone} sheet className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}>
      <OverlayScrim onClose={onClose} />
      <OverlayPanel ref={panelRef} phone={phone} sheet className={phone ? "min-h-[70svh]" : "max-w-lg"}>
        <div data-model-sheet>
          <OverlayHeader title={video ? "Video modeli" : "Rasm modeli"} phone={phone} onClose={onClose} className="mb-2" />
          <div role="group" aria-label="Filtr" className="mb-3 flex flex-wrap gap-1.5" data-model-chips>
            <button type="button" data-model-chip="all" aria-pressed={filter === null} onClick={() => setFilter(null)} className={cn(chip, filter === null ? "bg-foreground text-background font-semibold" : "bg-muted")}>
              Hammasi
            </button>
            {chips.map((b) => (
              <button key={b} type="button" data-model-chip={b} aria-pressed={filter === b} onClick={() => setFilter(b)} className={cn(chip, filter === b ? "bg-foreground text-background font-semibold" : "bg-muted")}>
                {BADGE_LABEL[b]}
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-2" data-model-list>
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  data-model-option={m.id}
                  aria-pressed={draft === m.id}
                  onClick={() => setDraft(m.id)}
                  className={cn(
                    "bg-card focus-visible:ring-ring flex min-h-[4.5rem] w-full items-center gap-3 rounded-[18px] border-2 p-2.5 text-left outline-none focus-visible:ring-2",
                    draft === m.id ? "border-primary" : "border-border",
                  )}
                >
                  <span aria-hidden className="bg-accent-soft text-accent-soft-foreground flex size-11 shrink-0 items-center justify-center rounded-[12px] text-[15px] font-extrabold">
                    {initials(m.label)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15.5px] font-bold">{m.label}</span>
                    <span className="text-muted-foreground mt-0.5 block truncate text-[12.5px]">{[m.maker, badgeText(m)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-accent-soft-foreground shrink-0 text-right text-[14px] font-bold tabular-nums" data-model-price>
                    {priceOf ? priceOf(m) : priceText(unitPrice(m, values, pricing))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="bg-card sticky bottom-0 -mx-5 mt-3 px-5 pt-2 pb-1">
            <button
              type="button"
              data-model-confirm
              onClick={() => {
                onPick(draft);
                onClose();
              }}
              className="bg-primary text-primary-foreground focus-visible:ring-ring h-12 w-full rounded-[16px] text-[15px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Tanlash
            </button>
          </div>
        </div>
      </OverlayPanel>
    </OverlayFrame>
  );
}
