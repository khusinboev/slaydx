"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatSom, groupDigits } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { ClientEntry } from "@/lib/studio-core";
import { Card, Switch } from "@/components/forms/compact";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import { PromptBox } from "../PromptBox";
import { SubmitError } from "../SubmitError";
import { usePromptEnhance } from "../usePromptEnhance";
import { useStudioSend } from "../useStudioSend";
import { StudioWorkbench, useResultsScroll } from "../StudioWorkbench";
import { badgeText } from "../studio-price";
import type { MediaCatalog } from "../studio-types";
import { PROMPT_BYTES_MESSAGE, PROMPT_PARAM, normalizedPrompt, promptBytes, promptLimit, promptMin } from "../studio-values";
import { sendCompare } from "./compare-api";
import { CompareResults } from "./CompareResults";
import { COMPARE_MIN, compareBatch, compareCap, compareLabel, compareModels, droppedLine, memberPrice, memberValues, sharedEntry, sharedParams, toggleModel, type CompareKind } from "./compare-model";
import type { CompareTab } from "./useCompare";
import type { StudioJob } from "../StudioResults";
import { queueGeneration } from "@/components/forms/runGeneration";
import type { FormValues } from "@/lib/types";
import { STUDIO_TOOL_SLUG } from "../studio-entry";
import { STUDIO_TOOL_ID } from "../studio-price";
import { STUDIO_VIDEO_SLUG, STUDIO_VIDEO_TOOL_ID } from "../video/video-price";

/**
 * The «Solishtirish» switch (docs/studio/P7-SPEC.md P7a): above the tab's model picker, on the Rasm tab's drawing mode
 * and the Video tab. Shown only when the user can tick at least two models.
 */
export function CompareSwitch({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  const max = compareCap(useAppStore((s) => s.features?.compareMax));
  // A per-user in-flight cap below two makes every batch a 429: no switch at all.
  if (max < COMPARE_MIN) return null;
  return (
    <div className="bg-card mb-3 flex items-center justify-between gap-3 rounded-[16px] border px-3.5 py-2" data-compare-switch>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">Solishtirish</p>
        <p className="text-muted-foreground text-[12.5px] leading-snug">Bitta so‘rov — {COMPARE_MIN}–{max} ta model yonma-yon</p>
      </div>
      <Switch ariaLabel="Solishtirish" checked={checked} onChange={onChange} />
    </div>
  );
}

/**
 * The compare form + its results, in place of the tab's own form: ONE prompt, 2–4 ticked models (only those the
 * catalog offers this user now), the rows every ticked model shares (each other parameter takes the model's default),
 * and the sticky «Solishtirish · N model · ~X so'm» button, X = the plain sum of each model's own price — the same
 * preview functions as the tab's own button. The server re-prices every model and refuses the whole batch (nothing
 * charged) when any differs.
 */
export function ComparePanel({
  kind,
  catalog,
  tab,
  balance,
  typing,
  gated,
  reload,
  onPick,
}: {
  kind: CompareKind;
  catalog: MediaCatalog;
  tab: CompareTab;
  /** Spendable balance (Video: the PAID one); `null` while unknown. */
  balance: number | null;
  typing: boolean;
  gated: boolean;
  reload: (silent?: boolean) => void;
  /** «Shu modelni tanlash»: compare off, that model chosen in the tab's own form, the same prompt. */
  onPick: (modelId: string, prompt: string) => void;
}) {
  // 400: a model or value is no longer accepted — the offered list may have changed; 409: a price moved.
  const { submitting, error, setError, run } = useStudioSend((refused) => {
    reload(true);
    if (!refused) void useAppStore.getState().refreshSession();
  });
  const { resultsRef, scrollToResults } = useResultsScroll();
  const { state, setState } = tab;
  const models = compareModels(kind, catalog.models);
  const entries = state.ticked.map((id) => models.find((m) => m.id === id)).filter((m): m is ClientEntry => m !== undefined);
  const shared = sharedEntry(entries);
  const max = compareCap(useAppStore((s) => s.features?.compareMax));
  const ready = entries.length >= COMPARE_MIN && entries.length <= max && shared !== null;
  const batch = ready ? compareBatch(kind, entries, state.raw, catalog.pricing) : null;
  const sharedRows = sharedParams(entries);

  const setRaw = (name: string, value: unknown) => setState((s) => ({ ...s, raw: { ...s.raw, [name]: value } }));
  const toggle = (id: string) => setState((s) => ({ ...s, ticked: toggleModel(s.ticked, id, max) }));
  const limit = shared ? promptLimit(shared) : 2000;
  const prompt = String(state.raw[PROMPT_PARAM] ?? "");
  // Every ticked model: the prompt goes to each, and the tightest byte limit decides.
  const bytes = promptBytes(entries, prompt);
  const { enhance, enhancing } = usePromptEnhance(
    kind,
    () => prompt.replace(/\s+/g, " ").trim(),
    (v) => setRaw(PROMPT_PARAM, v.slice(0, limit)),
    setError,
  );

  /** What a cell's retry costs now: that model's job at the values it was sent (the same preview as the batch). */
  function retryPrice(job: StudioJob): number {
    const target = models.find((m) => m.id === job.modelId);
    return target ? memberPrice(kind, target, job.sent, catalog.pricing) : job.price;
  }

  /**
   * P11 §D: a failed cell is retried alone — one new job of that model with the values it was sent, at the price shown,
   * through the tab's own tool (not a second batch); the new job takes the cell's place in the batch.
   */
  async function retry(job: StudioJob) {
    const target = models.find((m) => m.id === job.modelId);
    if (!target) {
      setError("Bu model hozir mavjud emas — boshqa modelni tanlang.");
      return;
    }
    const tool = kind === "video" ? { slug: STUDIO_VIDEO_SLUG, id: STUDIO_VIDEO_TOOL_ID, title: job.prompt.slice(0, 72), output: "mp4" as const } : { slug: STUDIO_TOOL_SLUG, id: STUDIO_TOOL_ID, title: job.prompt.slice(0, 72), output: "png" as const };
    await run(async () => {
      const queued = await queueGeneration(tool, job.sent as unknown as FormValues, retryPrice(job), { repeat: true });
      tab.track({ id: queued.id, modelId: target.id, modelLabel: target.label, prompt: job.prompt, price: queued.price, sent: job.sent });
      setState((s) => ({ ...s, batches: s.batches.map((b) => (b.ids.includes(job.id) ? { ...b, ids: b.ids.map((id) => (id === job.id ? queued.id : id)) } : b)) }));
      void useAppStore.getState().refreshSession();
    });
  }

  async function submit() {
    if (!batch || !shared) {
      setError(`Kamida ${COMPARE_MIN} ta model belgilang`);
      return;
    }
    if (normalizedPrompt(shared, state.raw).length < promptMin(shared)) {
      setError(kind === "video" ? "Videoda nima bo‘lishini yozing" : "Nima chizish kerakligini yozing");
      return;
    }
    const text = normalizedPrompt(shared, state.raw);
    if (bytes) {
      setError(PROMPT_BYTES_MESSAGE);
      return;
    }
    await run(async () => {
      const res = await sendCompare({ kind, members: batch.members.map((m) => ({ values: m.values, expectedPrice: m.price })), expectedTotal: batch.total });
      for (const [i, item] of res.items.entries()) {
        const m = batch.members[i];
        tab.track({ id: item.id, modelId: item.modelId, modelLabel: m?.entry.label ?? item.modelId, prompt: text, price: item.price, sent: m?.values ?? {} });
      }
      setState((s) => ({ ...s, batches: [{ group: res.group, prompt: text, ids: res.items.map((x) => x.id) }, ...s.batches.filter((b) => b.group !== res.group)] }));
      // The balance line follows the charge.
      void useAppStore.getState().refreshSession();
      scrollToResults();
    });
  }

  return (
    <div data-compare-panel={kind} className="min-w-0">
      <StudioWorkbench
        resultsRef={resultsRef}
        hasResults={state.batches.length > 0}
        empty="Solishtirish natijalari shu yerda yonma-yon ko‘rinadi."
        label="Solishtirish natijalari"
        results={<CompareResults kind={kind} batches={state.batches} jobs={tab.jobs} onPick={onPick} onRetry={(j) => void retry(j)} retryPrice={retryPrice} busy={submitting} />}
        form={
          <>
        <PromptBox
          value={prompt}
          onChange={(v) => setRaw(PROMPT_PARAM, v.slice(0, limit))}
          limit={limit}
          bytes={bytes}
          min={shared ? promptMin(shared) : 1}
          label={kind === "video" ? "Videoda nima bo‘lsin?" : "Nimani chizamiz?"}
          onEnhance={() => void enhance()}
          enhancing={enhancing}
        />
        <Card title="Modellar" aside={<span className="text-muted-foreground tabular-nums" data-compare-count>{entries.length} / {max}</span>}>
          <p className="text-muted-foreground mb-2 text-[13px]">{COMPARE_MIN}–{max} ta modelni belgilang — har biri o‘z narxida alohida ish bo‘ladi.</p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-compare-models>
            {models.map((m) => {
              const on = state.ticked.includes(m.id);
              const full = !on && state.ticked.length >= max;
              // The card price: that model's job at the shared values of the CURRENT tick set plus this model.
              const set = on ? entries : [...entries, m];
              const price = memberPrice(kind, m, memberValues(m, state.raw, sharedParams(set)), catalog.pricing);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-disabled={full || undefined}
                    data-compare-model={m.id}
                    onClick={() => (full ? setError(`Ko‘pi bilan ${max} ta model`) : toggle(m.id))}
                    className={cn(
                      "focus-visible:ring-ring flex min-h-14 w-full items-center gap-2.5 rounded-[14px] border-2 px-3 py-2 text-left outline-none focus-visible:ring-2",
                      on ? "border-primary bg-accent-soft/40" : "border-transparent bg-muted/60",
                      full && "opacity-50",
                    )}
                  >
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border-2", on ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40")} aria-hidden>
                      {on ? <Check className="size-4" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{m.label}</span>
                      <span className="text-muted-foreground block truncate text-[12.5px]">
                        ~{groupDigits(price)} so‘m{m.badges.length ? ` · ${badgeText(m)}` : ""}
                      </span>
                      {/* P11 §D: what this ticked model runs at its own default, since the shared rows do not ask for it. */}
                      {on && droppedLine(m, sharedRows) ? (
                        <span className="text-muted-foreground block text-[12px] leading-snug" data-compare-dropped={m.id}>
                          {droppedLine(m, sharedRows)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
        {shared && sharedRows.some((p) => p.name !== PROMPT_PARAM) ? <ParamRows entry={shared} raw={state.raw} onChange={setRaw} /> : null}
        {kind === "video" ? (
          <p className="text-muted-foreground mb-3 text-[13px] leading-snug">
            Har video alohida ish: bir necha daqiqada tayyor bo‘ladi, faqat to‘langan balans bilan; biror model tayyorlay olmasa, faqat o‘sha videoning puli qaytariladi.
          </p>
        ) : null}
        <SubmitError error={error} gated={gated} />
        <PriceButton
          count={entries.length}
          // Never `null`: the button keeps the compare wording («Solishtirish») while fewer than two models are ticked.
          price={batch ? batch.total : 0}
          balance={balance}
          loading={submitting}
          disabled={!ready}
          typing={typing}
          onSubmit={() => void submit()}
          label={compareLabel(entries.length, batch ? batch.total : null, formatSom)}
          paidOnly={kind === "video"}
        />
          </>
        }
      />
    </div>
  );
}
