"use client";

import { useEffect, useState } from "react";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { simulatePricing, type PriceAdjust, type Simulation } from "@/lib/admin-api/pricing";

export type SimulationState =
  | { status: "idle" }
  | { status: "loading"; last: Simulation | null }
  | { status: "error"; message: string; last: Simulation | null }
  | { status: "ready"; data: Simulation };

const DEBOUNCE_MS = 250;

/**
 * Live what-if: asks the server for the re-priced ladder and the 30-day
 * projection whenever `adjust` changes (debounced; a newer request aborts the
 * older one). The last good result stays on screen while the next one loads,
 * so a slider does not flicker. The client never prices anything itself.
 */
export function useSimulation(toolId: string, adjust: PriceAdjust | null, includeAdmins = false): SimulationState {
  const [state, setState] = useState<SimulationState>({ status: "idle" });
  const percent = adjust?.percent ?? null;
  const roundTo = adjust?.roundTo ?? null;

  useEffect(() => {
    if (percent === null || roundTo === null) {
      setState({ status: "idle" });
      return;
    }
    const ctl = new AbortController();
    setState((cur) => ({ status: "loading", last: cur.status === "ready" ? cur.data : cur.status === "idle" ? null : cur.last }));
    const timer = setTimeout(() => {
      simulatePricing(toolId, { percent, roundTo }, { signal: ctl.signal, includeAdmins })
        .then((data) => {
          if (!ctl.signal.aborted) setState({ status: "ready", data });
        })
        .catch((e: unknown) => {
          if (isAbortError(e) || ctl.signal.aborted) return;
          setState((cur) => ({ status: "error", message: adminErrorMessage(e), last: cur.status === "loading" ? cur.last : null }));
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [toolId, percent, roundTo, includeAdmins]);

  return state;
}

/** The simulation to show: the fresh one, or the last good one while loading. */
export function shownSimulation(state: SimulationState): Simulation | null {
  if (state.status === "ready") return state.data;
  if (state.status === "loading" || state.status === "error") return state.last;
  return null;
}
