"use client";

import { applyTitulOps, inverseTitulOps, type TitulOp } from "@/lib/generation/title-page/edit";
import type { AcademicDoc } from "@/lib/generation/types";
import { useDocEdit, SAVED_FLASH_MS, type DocEdit } from "./useDocEdit";

/**
 * «Titul» edit flow — the generic `useDocEdit` queue (optimistic doc, «Saqlash»
 * sends the ops, the server rebuilds the DOCX) with the title-page op language.
 * Same rule as the server (`titulAdapter.hasModel`): only a doc with `titul`.
 */

export type TitulEdit = DocEdit<TitulOp>;

export const TITUL_TOOLS = ["title-page"] as const;

const hasTitul = (doc: AcademicDoc) => Boolean(doc.titul);

export function useTitulEdit({ gen, onGen, savedFlashMs = SAVED_FLASH_MS }: { gen?: unknown; onGen?: (g: unknown) => void; savedFlashMs?: number }): TitulEdit {
  return useDocEdit<TitulOp>({
    gen,
    onGen,
    savedFlashMs,
    tools: TITUL_TOOLS,
    hasModel: hasTitul,
    apply: (doc, ops) => applyTitulOps(doc, ops),
    inverse: (doc, ops) => inverseTitulOps(doc, ops),
  });
}
