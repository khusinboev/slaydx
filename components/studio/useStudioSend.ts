"use client";

import { useState } from "react";
import { ApiError, PriceChangedError } from "@/lib/api-client";
import type { FormValues } from "@/lib/types";
import { queueGeneration, type GenerationTarget } from "@/components/forms/runGeneration";

/**
 * The one submit path of the Studio forms: the error line and the «Yaratilmoqda...» state of a tab.
 *
 * `onStale` runs when the server refused what the form shows, nothing charged: `refused` = a 400 (a model or a value is
 * no longer accepted, the offered list may have changed), otherwise a 409 (the price moved). The tab re-reads what it
 * offers.
 *
 * `send` and `run` answer whether the job went through: the caller clears its draft only then.
 */
export function useStudioSend(onStale?: (refused: boolean) => void) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(job: () => Promise<void>): Promise<boolean> {
    setError(null);
    setSubmitting(true);
    try {
      await job();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
      const refused = e instanceof ApiError && e.status === 400;
      if (refused || e instanceof PriceChangedError) onStale?.(refused);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  /** Queues one job; `{ repeat: true }`: a second press is a new job, not a double click. */
  function send(target: GenerationTarget, values: Record<string, unknown>, price: number, onQueued: (queued: { id: string; price: number }) => void): Promise<boolean> {
    return run(async () => onQueued(await queueGeneration(target, values as unknown as FormValues, price, { repeat: true })));
  }

  return { submitting, error, setError, run, send };
}
