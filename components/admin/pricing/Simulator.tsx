"use client";

import { useId, useState } from "react";
import { PRICE_PERCENT_MAX, PRICE_PERCENT_MIN, type LadderRow, type PriceAdjust, type PricingItem } from "@/lib/admin-api/pricing";
import { fmtNumber } from "@/lib/admin-format";
import { Badge, InfoTip } from "@/components/admin/ui";
import { LadderCompare } from "./LadderCompare";
import { marginTone, pctText, roundToText, soumText, tangaText } from "./shared";
import { shownSimulation, useSimulation } from "./useSimulation";

/** The slider covers the everyday range; the input reaches the API maximum. */
const SLIDER_MAX = 300;

const FIELD = "border-input bg-card focus:ring-ring h-9 rounded-lg border px-2.5 text-[13px] tabular-nums outline-none focus:ring-2";

/** Clamped integer percent from free text; `null` when not a number. */
export function parsePercentText(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  return Math.min(PRICE_PERCENT_MAX, Math.max(PRICE_PERCENT_MIN, Number(s)));
}

/**
 * What-if (§17.6): a slider plus an input for the percent; the server answers
 * with the re-priced ladder and the last 30 days re-priced at the same volume.
 * Nothing here is saved.
 */
export function Simulator({
  item,
  ladder,
  includeAdmins = false,
}: {
  item: Pick<PricingItem, "toolId" | "adjust" | "unitLabel">;
  ladder: ReadonlyArray<LadderRow>;
  /** The page's «Adminlar bilan» switch: the window then holds the admin accounts' jobs too. */
  includeAdmins?: boolean;
}) {
  const ids = useId();
  const [text, setText] = useState(String(item.adjust.percent));
  const percent = parsePercentText(text);
  const proposed: PriceAdjust | null = percent === null ? null : { percent, roundTo: item.adjust.roundTo };
  const state = useSimulation(item.toolId, proposed, includeAdmins);
  const sim = shownSimulation(state);

  return (
    <section aria-label="Simulyator" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={PRICE_PERCENT_MIN}
          max={SLIDER_MAX}
          step={1}
          value={Math.min(SLIDER_MAX, percent ?? item.adjust.percent)}
          onChange={(e) => setText(e.target.value)}
          aria-label="Tuzatish foizi (slayder)"
          className="accent-primary min-w-0 flex-1"
        />
        <label htmlFor={`${ids}-pct`} className="sr-only">
          Tuzatish foizi
        </label>
        <input
          id={`${ids}-pct`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={percent === null}
          className={`${FIELD} w-20 text-right`}
        />
        <span className="text-[13px]">%</span>
      </div>
      {percent === null ? (
        <p className="text-destructive text-xs" role="alert">
          Foiz {PRICE_PERCENT_MIN} dan {PRICE_PERCENT_MAX} gacha butun son bo&apos;lsin.
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="text-destructive text-xs" role="alert">
          {state.message}
        </p>
      ) : null}

      <div aria-busy={state.status === "loading" || undefined} className={state.status === "loading" ? "opacity-70 transition-opacity" : undefined}>
        <LadderCompare current={ladder} proposed={sim?.ladder ?? null} caption="Narx pog'onalari: hozir va yangi" />
      </div>

      {sim ? (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Tushum · {fmtNumber(sim.window.days)} kun</dt>
            <dd className="text-base font-semibold tabular-nums">{tangaText(sim.projected.revenue30d)}</dd>
            <dd className="text-muted-foreground text-xs tabular-nums">hozir {tangaText(sim.current.revenue30d)}</dd>
          </div>
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">AI xarajat · {fmtNumber(sim.window.days)} kun</dt>
            <dd className="text-base font-semibold tabular-nums">{soumText(sim.projected.cost30d)}</dd>
            <dd className="text-muted-foreground text-xs">o&apos;zgarmaydi</dd>
          </div>
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">Marja</dt>
            <dd className="text-base font-semibold tabular-nums">
              <Badge tone={marginTone(sim.projected.marginPct)} dot>
                {pctText(sim.projected.marginPct)}
              </Badge>
            </dd>
            <dd className="text-muted-foreground text-xs tabular-nums">hozir {pctText(sim.current.marginPct)}</dd>
          </div>
        </dl>
      ) : null}

      <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
        <span>
          Oxirgi {sim ? fmtNumber(sim.window.days) : "30"} kundagi {sim ? `${fmtNumber(sim.current.jobs)} ta ` : ""}tayyor ish yangi narxda qayta hisoblanadi; hajm va AI
          xarajati o&apos;zgarmaydi deb olinadi. Saqlanmaydi.
          {sim?.partial ? " Faqat birinchi 20 000 ta ish hisoblandi." : ""}
        </span>
        <InfoTip label="Simulyator qanday hisoblaydi" align="end">
          Talab elastikligi hisobga olinmaydi. Tushum tangada, marja so&apos;mda: tanga × {sim ? fmtNumber(sim.soumPerCoin) : "1"} so&apos;m, to&apos;lov komissiyasi{" "}
          {sim ? pctText(sim.paymentFeePercent) : ""} naqd qismdan ayriladi — jadvaldagi «Marja» bilan bir xil.{" "}
          {sim?.includeAdmins ? "Adminlarning ishlari ham kiritilgan." : "Adminlarning ishlari kiritilmagan."} Yangi narx: asosiy × % ÷ 100,{" "}
          {roundToText(item.adjust.roundTo)} ga yaxlitlanadi (100% — asosiy narxning o&apos;zi).
        </InfoTip>
      </p>
    </section>
  );
}
