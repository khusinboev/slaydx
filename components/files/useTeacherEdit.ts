"use client";

import { useEffect, useRef } from "react";
import { applyTeacherOps, inverseTeacherOps, type TeacherOp } from "@/lib/generation/teacher/edit";
import { TEACHER_TOOL_LIST } from "@/lib/generation/teacher/types";
import type { AcademicDoc } from "@/lib/generation/types";
import { asEditGen, useDocEdit, SAVED_FLASH_MS, type DocEdit } from "./useDocEdit";

/**
 * O'qituvchi hujjati tahririning klient oqimi (AUDIT-20 WP-D) —
 * `useWorkEdit` bilan bir xil o'ram (`useDocEdit`), faqat op tili va
 * vositalar ro'yxati boshqa.
 *
 * ESKI hujjat (`doc.teacher` yo'q) qabul QILINMAYDI: `applyTeacherOps`
 * unda op yo'llarini kafolatlay olmaydi (`legacyTeacherModel` modelni
 * meta'dan TAXMIN qiladi) — server (`teacherAdapter.hasModel`) bilan
 * AYNAN bir xil qoida, ya'ni ekranda tahrir tugmasi ko'rinib,
 * saqlashda 409 chiqadigan holat bo'lmaydi.
 *
 * SERVER TAHRIRI («Tuzatish», «Hammasini tuzatish») sahifadan
 * boshlanadi va yangi generatsiya `gen` propi orqali keladi; versiya
 * SAKRAGANDA undo/redo steklari bo'shatiladi (`useWorkEdit` dagi bilan
 * bir xil sabab: eski stek boshqa hujjatga tegishli bo'lardi).
 */

export type TeacherEdit = DocEdit<TeacherOp>;

/** Beshala o'qituvchi vositasi — reyestrdan (`types.ts` YAGONA manba). */
export const TEACHER_TOOLS = TEACHER_TOOL_LIST;

/** Modelli o'qituvchi hujjati — tahrirlanadi (eskisi yo'q). */
const hasTeacher = (doc: AcademicDoc) => Boolean(doc.teacher && doc.sections?.length);

export function useTeacherEdit({
  gen,
  onGen,
  savedFlashMs = SAVED_FLASH_MS,
}: {
  gen?: unknown;
  onGen?: (g: unknown) => void;
  savedFlashMs?: number;
}): TeacherEdit {
  const ed = useDocEdit<TeacherOp>({
    gen,
    onGen,
    savedFlashMs,
    tools: TEACHER_TOOLS,
    hasModel: hasTeacher,
    apply: (doc, ops, ctx) => applyTeacherOps(doc, ops, ctx),
    inverse: (doc, ops, ctx) => inverseTeacherOps(doc, ops, ctx),
  });

  const seenRef = useRef(ed.version);
  const external = asEditGen(gen, TEACHER_TOOLS)?.docVersion ?? 0;
  const { discard } = ed;
  useEffect(() => {
    if (external > seenRef.current && external > ed.version) discard();
    seenRef.current = Math.max(seenRef.current, external, ed.version);
  }, [external, ed.version, discard]);

  return ed;
}
