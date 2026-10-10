"use client";

import { CircleCheck } from "lucide-react";
import type { PricingItem } from "@/lib/admin-api/pricing";
import { fmtNumber } from "@/lib/admin-format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/admin/ui";
import { ATTENTION_LIMIT, type AttentionEntry, type AttentionKind, type Severity } from "./attention";
import { RecommendationAction } from "./bits";
import { COVERAGE_WARN_PCT, REC_BLOCK_HINT, markupText, pctText } from "./shared";

const SEVERITY_DOT: Record<Severity, string> = { critical: "bg-destructive", warning: "bg-warning", info: "bg-info" };
const SEVERITY_WORD: Record<Severity, string> = { critical: "Muhim", warning: "Ogohlantirish", info: "Taklif" };

/** Headline and one supporting line per reason; short, with the numbers that matter. */
function reasonOf(e: AttentionEntry, targetMarkup: number): { title: string; detail: string } {
  const i = e.item;
  const markup = `Ustama ${markupText(i.markup)} · maqsad ${markupText(targetMarkup)}`;
  const byKind: Record<AttentionKind, () => { title: string; detail: string }> = {
    loss: () => ({ title: `Zarar: marja ${pctText(i.marginPct, 0)}`, detail: markup }),
    "low-margin": () => ({ title: `Marja past: ${pctText(i.marginPct, 0)}`, detail: markup }),
    "no-cost": () => ({ title: "Tannarx yozilmayapti", detail: `${fmtNumber(i.completed)} ta tayyor ish tannarxsiz — marjaga kirmagan` }),
    unpriced: () => ({ title: "Narxi noma'lum xizmat", detail: `${fmtNumber(i.unpricedCalls)} ta chaqiruv 0 $ deb olingan — tannarx past ko'rinadi` }),
    "low-coverage": () => ({ title: `Tannarx qamrovi ${pctText(i.coveragePct, 0)}`, detail: `${fmtNumber(COVERAGE_WARN_PCT)}% dan past — marja haqiqatdagidan yaxshi ko'rinishi mumkin` }),
    "below-target": () => ({ title: "Ustama maqsaddan past", detail: markup }),
    overpriced: () => ({ title: "Ustama maqsaddan yuqori", detail: `${markup} — narxni tushirish mumkin` }),
  };
  return byKind[e.kind]();
}

/**
 * «Diqqat talab qiladi»: the page's first answer. At most `ATTENTION_LIMIT` tools, most
 * important first (`attentionList`), each with one way forward: «Qo'llash» for an applicable
 * recommendation (with `pricing.edit`), «Ko'rish» to open the tool.
 */
export function AttentionStrip({
  entries,
  targetMarkup,
  canEdit,
  hasJobs,
  onOpen,
  onApply,
}: {
  entries: ReadonlyArray<AttentionEntry>;
  targetMarkup: number;
  canEdit: boolean;
  /** Any completed job in the period: without one there is nothing to judge. */
  hasJobs: boolean;
  onOpen: (item: PricingItem) => void;
  onApply: (item: PricingItem) => void;
}) {
  const shown = entries.slice(0, ATTENTION_LIMIT);
  const more = entries.length - shown.length;
  return (
    <section aria-labelledby="pricing-attention" className="bg-card rounded-xl border">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 id="pricing-attention" className="text-sm font-semibold">
          Diqqat talab qiladi
        </h2>
        {entries.length > 0 ? <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">{fmtNumber(entries.length)}</span> : null}
      </header>
      {shown.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 px-4 py-3.5 text-[13px]">
          <CircleCheck className="text-success size-4 shrink-0" aria-hidden="true" />
          {hasJobs ? "Hammasi me'yorda: marja va tannarx ma'lumotida e'tibor talab qiladigan narsa yo'q." : "Bu davrda tugallangan ish yo'q — baholash uchun ma'lumot yo'q."}
        </p>
      ) : (
        <ol className="divide-y">
          {shown.map((e) => {
            const { title, detail } = reasonOf(e, targetMarkup);
            const blocked = e.rec.kind === "change" && e.rec.block !== null ? REC_BLOCK_HINT[e.rec.block] : null;
            return (
              <li key={e.item.toolId} data-attention={e.item.toolId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEVERITY_DOT[e.severity])} aria-hidden="true" />
                  <div className="min-w-0 text-[13px]">
                    <p>
                      <span className="sr-only">{SEVERITY_WORD[e.severity]}: </span>
                      <b className="font-semibold">{e.item.title}</b>
                      <span className="text-muted-foreground"> · </span>
                      <span>{title}</span>
                    </p>
                    <p className="text-muted-foreground text-xs" title={blocked ?? undefined}>
                      {detail}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-[18px] sm:shrink-0 sm:justify-end sm:pl-0">
                  {e.rec.kind === "change" ? <RecommendationAction rec={e.rec} title={e.item.title} canEdit={canEdit} onApply={() => onApply(e.item)} /> : null}
                  <Button size="sm" variant="ghost" onClick={() => onOpen(e.item)} className="max-sm:min-h-11" aria-label={`Ko'rish: ${e.item.title}`}>
                    Ko&apos;rish
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {more > 0 ? <p className="text-muted-foreground border-t px-4 py-2 text-xs">Yana {fmtNumber(more)} ta vosita — jadvalda belgilangan.</p> : null}
    </section>
  );
}
