"use client";

import { Suspense, lazy, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { TOOL_BY_SLUG, priceFor, toolBlockedReason } from "@/lib/tools";
import type { FormValues, ToolConfig } from "@/lib/types";
import { VOICE_TEMPLATE_TOOLS, type VoiceTemplateId } from "@/lib/media/voice-templates";
import { TOOL_ICONS } from "@/components/shell/icons";
import { queueToolGeneration } from "@/components/forms/runGeneration";
import type { QueuedMediaJob } from "@/components/forms/MediaComposer";
import type { StudioJob } from "../StudioResults";
import { VoiceResults } from "./VoiceResults";

const MediaComposer = lazy(() => import("@/components/forms/MediaComposer").then((m) => ({ default: m.MediaComposer })));

/** The tool behind a template: the EXISTING podcast / greeting tool (its id, composer, engine and `priceFor`). */
export const templateTool = (id: VoiceTemplateId): ToolConfig => TOOL_BY_SLUG[id]!;

/** The «dan» price on a template card: `priceFor` of the tool's defaults (the standard voice; premium adds per minute). */
export const templateFromPrice = (id: VoiceTemplateId): number => priceFor(templateTool(id), {} as FormValues);

/** The session switch `features.legacyFold` (added by the P8a session block); absent = off. */
export function useLegacyFold(): boolean {
  return useAppStore((s) => (s.features as { legacyFold?: boolean } | null)?.legacyFold === true);
}

/**
 * «Tayyor shablonlar» (docs/studio/P8-SPEC.md «P8b»): the old «Podkast» and «Tabriknoma» tools as the first row of the
 * «Ovoz» tab while `studio.legacy_fold` is on. A card opens the tool's own composer below; the active one is pressed.
 */
export function VoiceTemplatesRow({ active, onPick }: { active: VoiceTemplateId | null; onPick: (id: VoiceTemplateId) => void }) {
  return (
    <section aria-label="Tayyor shablonlar" data-voice-templates className="mb-3">
      <h3 className="text-muted-foreground mb-1.5 text-[13px] font-semibold">Tayyor shablonlar</h3>
      <div className="grid grid-cols-2 gap-2">
        {VOICE_TEMPLATE_TOOLS.map((id) => {
          const tool = templateTool(id);
          const Icon = TOOL_ICONS[tool.icon];
          const on = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              data-voice-template={id}
              onClick={() => onPick(id)}
              className={cn(
                "bg-card focus-visible:ring-ring flex min-h-11 min-w-0 items-start gap-2.5 rounded-[16px] border p-3 text-left outline-none focus-visible:ring-2",
                on ? "border-foreground/40 shadow-sm" : "hover:bg-muted/60",
              )}
            >
              {Icon ? (
                <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-[rgb(var(--tc)/0.14)]" style={{ ["--tc" as string]: tool.tc }}>
                  <Icon className="size-5 text-[rgb(var(--tc))]" />
                </span>
              ) : null}
              <span className="min-w-0">
                <span className="block text-[15px] leading-tight font-bold">{tool.title}</span>
                <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-[12.5px] leading-snug">{tool.description}</span>
                <span className="mt-1 block text-[12.5px] font-semibold tabular-nums" data-voice-template-price>
                  {formatSom(templateFromPrice(id))} dan
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The open template: the tool's own composer (`MediaComposer`, embedded: no page header, the Studio's column) and the
 * template's results (progress → player + «Yuklab olish (MP3)» + «Qayta» + the tool's result page link). A tool the
 * server cannot sell right now (no voice provider) says why, as its old page did.
 */
export function VoiceTemplatePanel({
  id,
  onClose,
  jobs,
  track,
}: {
  id: VoiceTemplateId;
  onClose: () => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
}) {
  const features = useAppStore((s) => s.features);
  const [againError, setAgainError] = useState<string | null>(null);
  const [againBusy, setAgainBusy] = useState(false);
  const tool = templateTool(id);
  const blocked = toolBlockedReason(tool, features);
  const mine = jobs.filter((j) => j.modelId === tool.id);
  const follow = (job: QueuedMediaJob) => track({ id: job.id, modelId: tool.id, modelLabel: tool.title, prompt: job.title, price: job.price, sent: job.values as unknown as Record<string, unknown>, purpose: tool.id });

  /** «Qayta»: the same values to the same tool — the same `priceFor` price, a new job. */
  function again(job: StudioJob) {
    const values = job.sent as unknown as FormValues;
    setAgainError(null);
    setAgainBusy(true);
    queueToolGeneration(tool, values, { repeat: true })
      .then(
        ({ id: newId, price }) => follow({ id: newId, price, title: job.prompt, values }),
        (e: unknown) => setAgainError(e instanceof Error ? e.message : "Xatolik"),
      )
      .finally(() => setAgainBusy(false));
  }

  return (
    <div data-voice-template-panel={id}>
      <div className="bg-accent-soft text-accent-soft-foreground mb-3 flex items-center justify-between gap-2 rounded-[14px] px-3.5 py-2">
        <p className="text-[14.5px] font-bold">{tool.title}</p>
        <button
          type="button"
          data-voice-template-exit
          onClick={onClose}
          className="focus-visible:ring-ring inline-flex min-h-11 items-center gap-1 rounded-[10px] px-2 text-[13.5px] font-semibold outline-none focus-visible:ring-2"
        >
          <X className="size-4" aria-hidden />
          Yopish
        </button>
      </div>
      {blocked ? (
        <p className="text-muted-foreground bg-card rounded-[20px] border p-5 text-[14.5px]" data-voice-template-blocked>
          {blocked} Hisobingizdan hech narsa yechilmadi.
        </p>
      ) : (
        <Suspense fallback={<div className="bg-muted/60 h-64 animate-pulse rounded-[20px]" role="status" aria-label="Yuklanmoqda" />}>
          <MediaComposer key={id} tool={tool} onQueued={follow} />
        </Suspense>
      )}
      <section aria-label="Audiolar" data-voice-template-results className={cn(mine.length > 0 && "mt-5")}>
        {againError ? (
          <p role="alert" data-studio-error className="text-destructive mb-3 text-[14.5px] leading-snug">
            {againError}
          </p>
        ) : null}
        <VoiceResults jobs={mine} busy={againBusy} onAgain={again} />
      </section>
    </div>
  );
}
