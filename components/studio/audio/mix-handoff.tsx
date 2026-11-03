"use client";

import { createContext, useContext } from "react";
import type { MixHandoff } from "./mix-api";

/**
 * P8c «Keyingi qadam» → «Montaj» (docs/studio/P8-SPEC.md «P8c»): the Studio page provides the handoff; the result cards
 * (`VideoResults`, `VoiceResults`) read it, so the tabs between them need no new props. Absent (`null`, e.g. on a page
 * outside the Studio) = no «Montaj» buttons. Nothing is charged by a handoff: the «Montaj» form opens with the result
 * pre-picked and its own priced button is the job.
 */
export const MixHandoffContext = createContext<((kind: MixHandoff, generationId: string) => void) | null>(null);

export function useMixHandoff(): ((kind: MixHandoff, generationId: string) => void) | null {
  return useContext(MixHandoffContext);
}
