"use client";

import { useState } from "react";
import type { ClientEntry } from "@/lib/studio-core";
import type { StudioJob } from "../StudioResults";
import { useStudioJobs } from "../useStudioJobs";
import type { RawValues } from "../studio-values";
import type { CompareBatch } from "./CompareResults";
import type { MediaCatalog } from "../studio-types";
import { COMPARE_MIN, compareModels, type CompareKind } from "./compare-model";

/** One tab's compare state: on/off, the ticked models (tick order), the shared form bag and the batches followed. */
export type CompareTabState = { on: boolean; ticked: string[]; raw: RawValues; batches: CompareBatch[] };

export const INITIAL_COMPARE: CompareTabState = { on: false, ticked: [], raw: {}, batches: [] };

export type CompareTab = {
  state: CompareTabState;
  setState: (fn: (s: CompareTabState) => CompareTabState) => void;
  jobs: StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
};

/**
 * The page's compare state, one per tab (Rasm, Video): kept while the user moves between tabs, as the tabs' own forms
 * are. The jobs are followed with the Studio's own poller (`useStudioJobs`).
 */
export function useCompare(): Record<CompareKind, CompareTab> {
  const [image, setImage] = useState<CompareTabState>(INITIAL_COMPARE);
  const [video, setVideo] = useState<CompareTabState>(INITIAL_COMPARE);
  const imageJobs = useStudioJobs();
  const videoJobs = useStudioJobs();
  return {
    image: { state: image, setState: setImage, jobs: imageJobs.jobs, track: imageJobs.track },
    video: { state: video, setState: setVideo, jobs: videoJobs.jobs, track: videoJobs.track },
  };
}

/** Whether a tab offers the switch: a compare kind on screen and at least two models of it offered to this user. */
export function compareAvailability(kind: CompareKind | null, catalog: MediaCatalog | null): kind is CompareKind {
  return kind !== null && catalog !== null && compareModels(kind, catalog.models).length >= COMPARE_MIN;
}

/**
 * Switching compare on: the ticks of the last time when two of them are still offered; else the tab's chosen model
 * first and the next offered one. The tab's prompt and settings seed the shared bag (only the shared rows of it are
 * ever sent). Off keeps the ticks for the next time.
 */
export function enableCompare(s: CompareTabState, models: readonly ClientEntry[], chosen: string | null, raw: RawValues): CompareTabState {
  const offered = new Set(models.map((m) => m.id));
  const kept = s.ticked.filter((id) => offered.has(id));
  const first = chosen && offered.has(chosen) ? [chosen] : [];
  const ticked = kept.length >= COMPARE_MIN ? kept : [...new Set([...first, ...kept, ...models.map((m) => m.id)])].slice(0, COMPARE_MIN);
  return { ...s, on: true, ticked, raw: { ...raw } };
}
