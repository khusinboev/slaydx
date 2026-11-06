"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import type { StudioJob } from "./StudioResults";

type NewJob = Omit<StudioJob, "gen" | "error">;

/**
 * The Studio generations this page follows. `track` adds a job at the top and polls it to its end
 * (`api.pollGeneration`: backs off, survives a flaky network, never gives up on a transient error); the page leaving
 * aborts every poll. The job itself lives on the server — closing the page loses nothing, «Ishlarim» and the gallery
 * still hold it.
 *
 * `restore` adds a job the server still has running after a refresh. Those are polled only while `open` (their tab is on
 * screen): a refresh must not start one loop per job for work nobody is looking at. Opening the tab starts them, leaving
 * it stops them.
 */
export function useStudioJobs(open = true): { jobs: StudioJob[]; track: (job: NewJob) => void; restore: (job: NewJob) => void } {
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const polls = useRef(new Map<string, AbortController>());
  const restored = useRef(new Set<string>());
  const [restoredTick, setRestoredTick] = useState(0);

  const patch = useCallback((id: string, change: Partial<StudioJob>) => {
    setJobs((list) => list.map((j) => (j.id === id ? { ...j, ...change } : j)));
  }, []);

  const follow = useCallback(
    (id: string) => {
      if (polls.current.has(id)) return;
      const ctrl = new AbortController();
      polls.current.set(id, ctrl);
      api
        .pollGeneration(
          id,
          (gen) => {
            patch(id, { gen });
            // «Ishlarim» shows the same state (the result page does the same on every tick).
            useAppStore.getState().upsertGeneration(gen);
          },
          ctrl.signal,
        )
        // A finished job may have refunded something (a failed or short result): the balance line must follow.
        .then(() => {
          restored.current.delete(id);
          void useAppStore.getState().refreshSession();
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          restored.current.delete(id);
          patch(id, { error: e instanceof Error ? e.message : "Natija yuklanmadi" });
        })
        .finally(() => {
          if (polls.current.get(id) === ctrl) polls.current.delete(id);
        });
    },
    [patch],
  );

  const track = useCallback(
    (job: NewJob) => {
      // The same id answered twice (a replayed request) is followed once, and its live card stays as it is.
      if (polls.current.has(job.id)) return;
      setJobs((list) => [{ ...job, gen: null, error: null }, ...list.filter((j) => j.id !== job.id)]);
      follow(job.id);
    },
    [follow],
  );

  const restore = useCallback((job: NewJob) => {
    if (polls.current.has(job.id)) return;
    setJobs((list) => (list.some((j) => j.id === job.id) ? list : [{ ...job, gen: null, error: null }, ...list]));
    restored.current.add(job.id);
    setRestoredTick((n) => n + 1);
  }, []);

  useEffect(() => {
    for (const id of restored.current) {
      if (open) {
        follow(id);
      } else {
        polls.current.get(id)?.abort();
        polls.current.delete(id);
      }
    }
  }, [open, restoredTick, follow]);

  useEffect(() => {
    const running = polls.current;
    return () => {
      for (const c of running.values()) c.abort();
      running.clear();
    };
  }, []);

  return { jobs, track, restore };
}
