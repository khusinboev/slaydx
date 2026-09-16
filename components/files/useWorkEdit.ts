"use client";

import { useEffect, useRef } from "react";
import { applyWorkOps, inverseWorkOps, type WorkOp } from "@/lib/generation/work/edit";
import type { AcademicDoc } from "@/lib/generation/types";
import { asEditGen, useDocEdit, SAVED_FLASH_MS, type DocEdit } from "./useDocEdit";

/**
 * Talaba ishi tahririning klient oqimi (AUDIT-19 WP-C) —
 * `useArticleEdit` bilan bir xil o'ram (`useDocEdit`), faqat op tili va
 * vositalar ro'yxati boshqa.
 *
 * ESKI hujjat (`doc.work` yo'q) qabul QILINMAYDI: `applyWorkOps` unda
 * op yo'llarini kafolatlay olmaydi (bob/paragraf id lari yo'q) — server
 * (`workAdapter.hasModel`) bilan AYNAN bir xil qoida, ya'ni ekranda
 * tahrir tugmasi ko'rinib, saqlashda 409 chiqadigan holat bo'lmaydi.
 *
 * SERVER TAHRIRI («Tuzatish») sahifadan boshlanadi va yangi generatsiya
 * `gen` propi orqali keladi; versiya SAKRAGANDA undo/redo steklari
 * bo'shatiladi (`useArticleEdit` dagi bilan bir xil sabab: eski stek
 * boshqa hujjatga tegishli bo'lardi).
 */

export type WorkEdit = DocEdit<WorkOp>;

export const WORK_TOOLS = ["coursework", "referat", "mustaqil-ish"] as const;

/** Modelli talaba ishi — tahrirlanadi (eskisi yo'q). */
const hasWork = (doc: AcademicDoc) => Boolean(doc.work && doc.sections?.length);

export function useWorkEdit({
  gen,
  onGen,
  savedFlashMs = SAVED_FLASH_MS,
}: {
  gen?: unknown;
  onGen?: (g: unknown) => void;
  savedFlashMs?: number;
}): WorkEdit {
  const ed = useDocEdit<WorkOp>({
    gen,
    onGen,
    savedFlashMs,
    tools: WORK_TOOLS,
    hasModel: hasWork,
    apply: (doc, ops, ctx) => applyWorkOps(doc, ops, ctx),
    inverse: (doc, ops, ctx) => inverseWorkOps(doc, ops, ctx),
  });

  const seenRef = useRef(ed.version);
  const external = asEditGen(gen, WORK_TOOLS)?.docVersion ?? 0;
  const { discard } = ed;
  useEffect(() => {
    if (external > seenRef.current && external > ed.version) discard();
    seenRef.current = Math.max(seenRef.current, external, ed.version);
  }, [external, ed.version, discard]);

  return ed;
}
