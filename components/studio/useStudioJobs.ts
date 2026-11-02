"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import type { StudioJob } from "./StudioResults";

/**
 * The Studio generations this page follows. `track` adds a job at the top and polls it to its end
 * (`api.pollGeneration`: backs off, survives a flaky network, never gives up on a transient error); the page leaving
 * aborts every poll. The job itself lives on the server — closing the page loses nothing, «Ishlarim» and the gallery
 * still hold it.
 */
export function useStudioJobs(): { jobs: StudioJob[]; track: (job: Omit<StudioJob, "gen" | "error">) => void } {
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const polls = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, change: Partial<StudioJob>) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...change } : j)));
  }, []);

  const track = useCallback(
    (job: Omit<StudioJob, "gen" | "error">) => {
      setJobs((list) => [{ ...job, gen: null, error: null }, ...list.filter((j) => j.id !== job.id)]);
      // The same id answered twice (a replayed request) is followed once.
      if (polls.current.has(job.id)) return;
      const ctrl = new AbortController();
      polls.current.set(job.id, ctrl);
      api
        .pollGeneration(
          job.id,
          (gen) => {
            patch(job.id, { gen });
            // «Ishlarim» shows the same state (the result page does the same on every tick).
            useAppStore.getState().upsertGeneration(gen);
          },
          ctrl.signal,
        )
        // A finished job may have refunded something (a failed or short result): the balance line must follow.
        .then(() => void useAppStore.getState().refreshSession())
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          patch(job.id, { error: e instanceof Error ? e.message : "Natija yuklanmadi" });
        })
        .finally(() => {
          if (polls.current.get(job.id) === ctrl) polls.current.delete(job.id);
        });
    },
    [patch],
  );

  useEffect(() => {
    const open = polls.current;
    return () => {
      for (const c of open.values()) c.abort();
      open.clear();
    };
  }, []);

  return { jobs, track };
}
