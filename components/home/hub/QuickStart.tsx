"use client";

import Link from "next/link";
import { ArrowRight, ChevronRight, LayoutGrid } from "lucide-react";
import { SERVICE_BY_ID, serviceVisible, type ServiceConfig } from "@/lib/services";
import { TOOL_BY_ID, clientAdjustedPrice, toolBlockedReason } from "@/lib/tools";
import { useAppStore, usePricingVersion } from "@/lib/store";
import type { ToolConfig } from "@/lib/types";
import { cn } from "@/lib/cn";
import { TOOL_ICONS } from "@/components/shell/icons";
import { QUICK_TOOL_IDS, outputLabel, quickDetail } from "./hub-model";

const CARD =
  "group focus-visible:ring-ring relative flex min-h-[7.25rem] flex-col justify-between gap-3 rounded-[var(--radius-card)] border p-3.5 text-left shadow-[var(--shadow-card)] outline-none focus-visible:ring-2";

/**
 * «Tez boshlash»: Slayd, Referat, Insho, Rezyume as four large cards (2 × 2) —
 * tinted icon chip (`TOOLS[].tc`), title, one line of real registry data
 * (output format badge, «from» price as the catalogue shows it). Links to
 * `/uz/<slug>` behind the hub's login gate. A tool whose provider key is
 * missing (`toolBlockedReason`) is drawn disabled with the reason, as in the
 * catalogue — it is not sold.
 */
export function QuickStart({ onPick }: { onPick: (href: string) => void }) {
  const features = useAppStore((s) => s.features);
  usePricingVersion(); // admin price adjustments re-render the «from» prices
  return (
    <div className="flex flex-col gap-2.5">
      {serviceVisible(SERVICE_BY_ID.chat, features) ? (
        <PromoCard service={SERVICE_BY_ID.chat} promise="Savol bering yoki hujjat buyuring" note="Kuniga 10 ta tekin" cta="Suhbatni boshlash" onPick={onPick} />
      ) : null}
      <ul className="grid grid-cols-2 gap-2.5" data-hub-quick>
        {QUICK_TOOL_IDS.map((id, i) => {
          const tool = TOOL_BY_ID[id];
          return (
            <li key={id} className="min-w-0">
              <QuickCard tool={tool} first={i === 0} blocked={toolBlockedReason(tool, features)} onPick={onPick} />
            </li>
          );
        })}
      </ul>
      {serviceVisible(SERVICE_BY_ID.domla, features) ? (
        <PromoCard service={SERVICE_BY_ID.domla} promise="Slaydingizni ovoz bilan himoya qiling" note="Domla savol beradi, siz javob berasiz" cta="Boshlash" onPick={onPick} />
      ) : null}
      {/* Owner request 2026-10-08: a big «Barcha vositalar» under the four cards → the full catalogue. */}
      <Link
        href="/uz/create"
        data-hub-all-tools
        className="focus-visible:ring-ring flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border bg-[var(--accent-soft)] px-4 text-[16px] font-semibold text-[var(--accent-soft-foreground)] shadow-[var(--shadow-card)] outline-none focus-visible:ring-2"
      >
        <LayoutGrid className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Barcha vositalar</span>
        <ChevronRight className="size-5 shrink-0 opacity-70" aria-hidden />
      </Link>
    </div>
  );
}

function QuickCard({
  tool,
  first,
  blocked,
  onPick,
}: {
  tool: ToolConfig;
  first: boolean;
  blocked: string | null;
  onPick: (href: string) => void;
}) {
  const Icon = TOOL_ICONS[tool.icon];
  const href = `/uz/${tool.slug}`;
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="flex size-11 items-center justify-center rounded-[14px] bg-[rgb(var(--tc)/0.14)]">
          {Icon ? <Icon className="size-[22px] text-[rgb(var(--tc))]" aria-hidden /> : null}
        </span>
        <span
          data-quick-format
          className="text-muted-foreground bg-muted/80 rounded-full px-2 py-0.5 text-[12.5px] leading-tight font-semibold tracking-wide"
        >
          {outputLabel(tool)}
        </span>
      </span>
      <span className="block min-w-0">
        <span className="block truncate text-[16.5px] leading-snug font-semibold">{tool.title}</span>
        <span
          data-quick-detail
          className={cn(
            "mt-0.5 block truncate text-[13.5px] leading-snug",
            blocked ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {blocked ? "Vaqtincha o‘chiq" : quickDetail(clientAdjustedPrice(tool.id, tool.basePrice))}
        </span>
        {/* The full reason (it is long: four lines on a 360 px card) for screen readers and the tooltip. */}
        {blocked ? <span className="sr-only">{blocked}</span> : null}
      </span>
    </>
  );
  const style = { ["--tc" as string]: tool.tc };
  if (blocked) {
    return (
      <div data-quick-tool={tool.id} aria-disabled="true" title={blocked} style={style} className={cn(CARD, "bg-card opacity-60")}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href={href}
      data-quick-tool={tool.id}
      onClick={() => onPick(href)}
      style={style}
      className={cn(
        CARD,
        "hover:border-primary/40 transition-[border-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        first ? "bg-accent-soft/60 dark:bg-accent-soft" : "bg-card",
      )}
    >
      {body}
    </Link>
  );
}

/**
 * A full-width promo card for a link-only service (`lib/services.ts`): tinted
 * icon chip, title, one-line promise, a note (free quota / how it works) and a
 * ≥ 44 px call-to-action. Same tokens as the tool cards: no gradient, no emoji.
 */
function PromoCard({
  service,
  promise,
  note,
  cta,
  onPick,
}: {
  service: ServiceConfig;
  promise: string;
  note: string;
  cta: string;
  onPick: (href: string) => void;
}) {
  const Icon = TOOL_ICONS[service.icon];
  return (
    <Link
      href={service.href}
      data-hub-promo={service.id}
      onClick={() => onPick(service.href)}
      style={{ ["--tc" as string]: service.tc }}
      className="bg-card hover:border-primary/40 focus-visible:ring-ring flex flex-col gap-3 rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)] outline-none transition-[border-color,transform] duration-150 focus-visible:ring-2 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <span className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-[rgb(var(--tc)/0.14)]">
          {Icon ? <Icon className="size-6 text-[rgb(var(--tc))]" aria-hidden /> : null}
        </span>
        <span className="block min-w-0">
          <span className="block text-[17px] leading-snug font-semibold">{service.title}</span>
          <span className="text-muted-foreground block text-[14px] leading-snug">{promise}</span>
        </span>
      </span>
      <span className="flex items-center justify-between gap-3">
        <span data-promo-note className="text-muted-foreground min-w-0 text-[13.5px] leading-snug font-medium">
          {note}
        </span>
        <span
          data-promo-cta
          className="bg-primary text-primary-foreground inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-semibold"
        >
          {cta}
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </span>
    </Link>
  );
}
