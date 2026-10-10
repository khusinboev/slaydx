"use client";

import { useId, useState } from "react";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import {
  PRICE_PERCENT_MAX,
  PRICE_PERCENT_MIN,
  PRICE_ROUND_TO,
  updatePricing,
  type LadderRow,
  type PriceAdjust,
  type PriceRoundTo,
  type PricingItemResult,
} from "@/lib/admin-api/pricing";
import { LadderCompare } from "./LadderCompare";
import { parsePercentText } from "./Simulator";
import { BIG_CHANGE_PP, marginTone, pctText, percentLabel, PROPAGATION_NOTE, roundToText } from "./shared";
import { shownSimulation, useSimulation } from "./useSimulation";
import { Badge } from "@/components/admin/ui";

export type PriceEditDialogProps = {
  open: boolean;
  toolId: string;
  title: string;
  adjust: PriceAdjust;
  ladder: ReadonlyArray<LadderRow>;
  /** The page's «Adminlar bilan» switch: the preview's 30-day window follows it, like the table's margin. */
  includeAdmins?: boolean;
  onClose: () => void;
  /** Called with the server's updated item after a successful save. */
  onSaved: (item: PricingItemResult) => void;
};

const FIELD = "border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] tabular-nums outline-none focus:ring-2 disabled:opacity-60";

/**
 * "O'zgartirish" (§17.6): percent (25–1000) and rounding, a live preview of
 * the ladder and the projected margin from the simulate endpoint, a reason
 * (audited) and — when the percent moves by more than ±50 points — the new
 * percent typed again. The step-up code is asked by the admin API core.
 */
export function PriceEditDialog(props: PriceEditDialogProps) {
  if (!props.open) return null;
  return <Body key={props.toolId} {...props} />;
}

function Body({ toolId, title, adjust, ladder, includeAdmins = false, onClose, onSaved }: PriceEditDialogProps) {
  const ids = useId();
  const [text, setText] = useState(String(adjust.percent));
  const [roundTo, setRoundTo] = useState<PriceRoundTo>(adjust.roundTo);
  const percent = parsePercentText(text);
  const next: PriceAdjust | null = percent === null ? null : { percent, roundTo };
  const unchanged = next !== null && next.percent === adjust.percent && next.roundTo === adjust.roundTo;
  const big = next !== null && Math.abs(next.percent - adjust.percent) > BIG_CHANGE_PP;
  const sim = shownSimulation(useSimulation(toolId, next, includeAdmins));

  const invalid = text !== "" && percent === null;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Narxni o'zgartirish — ${title}`}
      description={`Hozir ${percentLabel(adjust.percent)} · yaxlitlash ${roundToText(adjust.roundTo)}. ${PROPAGATION_NOTE}`}
      before={`${percentLabel(adjust.percent)} · ${roundToText(adjust.roundTo)}`}
      after={next === null ? "—" : `${percentLabel(next.percent)} · ${roundToText(next.roundTo)}`}
      reason={{ minLength: 5 }}
      typedConfirmation={big && next ? String(next.percent) : undefined}
      confirmLabel="Qo'llash"
      confirmDisabled={next === null || unchanged}
      onConfirm={async ({ reason }) => {
        if (next === null) return;
        const { item } = await updatePricing(toolId, next, reason);
        toast(`${title}: ${percentLabel(adjust.percent)} → ${percentLabel(next.percent)}. ${PROPAGATION_NOTE}`);
        onSaved(item);
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          <label htmlFor={`${ids}-pct`} className="font-semibold">
            Tuzatish, % <span className="text-muted-foreground font-normal">· {PRICE_PERCENT_MIN}–{PRICE_PERCENT_MAX}</span>
          </label>
          <input
            id={`${ids}-pct`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={`${ids}-hint`}
            className={FIELD}
          />
          <span id={`${ids}-hint`} className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
            {invalid ? `Foiz ${PRICE_PERCENT_MIN} dan ${PRICE_PERCENT_MAX} gacha butun son bo'lsin` : unchanged ? "Hech narsa o'zgarmadi" : ""}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          <label htmlFor={`${ids}-rt`} className="font-semibold">
            Yaxlitlash
          </label>
          <select id={`${ids}-rt`} value={roundTo} onChange={(e) => setRoundTo(Number(e.target.value) as PriceRoundTo)} className={FIELD}>
            {PRICE_ROUND_TO.map((r) => (
              <option key={r} value={r}>
                {roundToText(r)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <LadderCompare current={ladder} proposed={sim?.ladder ?? null} caption="Narx pog'onalari: hozir va yangi" />
      {sim ? (
        <p className="text-[13px]">
          Marja <b className="tabular-nums">{pctText(sim.current.marginPct)}</b> → <b className="tabular-nums">{pctText(sim.projected.marginPct)}</b>{" "}
          <Badge tone={marginTone(sim.projected.marginPct)}>{sim.window.days} kunlik prognoz</Badge>
        </p>
      ) : null}
      {big ? (
        <p className="text-badge-warning-text text-xs font-semibold">Katta o&apos;zgarish (&gt; {BIG_CHANGE_PP} punkt): tasdiqlash uchun yangi foizni qayta yozing.</p>
      ) : null}
    </ConfirmDialog>
  );
}
