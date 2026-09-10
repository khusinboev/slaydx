"use client";

import { useCallback } from "react";
import { removeResumePhoto, uploadResumePhoto } from "@/lib/api-edit";
import { applyResumeOps, inverseResumeOps, type ResumeOp } from "@/lib/generation/resume/edit";
import { legacyResumeModel, type ResumeModel } from "@/lib/generation/resume/model";
import type { AcademicDoc } from "@/lib/generation/types";
import { useDocEdit, SAVED_FLASH_MS, type DocEdit } from "./useDocEdit";

/**
 * Rezyume tahririning klient oqimi — `useSlideEdit` bilan bir xil
 * o'ram (`useDocEdit`), faqat op tili va server chaqiruvlari boshqa.
 *
 * ESKI HUJJAT (B-8): `doc.resume` bo'lmasa hujjat `legacyResumeModel`
 * bilan modelga ko'tariladi — SERVER ham aynan shunday qiladi
 * (`resumeAdapter.prepare`), ya'ni klientdagi optimistik nusxa va
 * `PATCH` dan qaytgan nusxa bir xil shaklda bo'ladi.
 */

export type ResumeEdit = DocEdit<ResumeOp> & {
  /** Ekrandagi model — `doc.resume` yoki eski hujjatdan ko'tarilgani. */
  model: ResumeModel | null;
  /** Kesilgan (va bo'lsa asl) suratni serverga yuboradi. */
  uploadPhoto: (photo: {
    file: File;
    original?: File | null;
    shape?: "circle" | "square";
    crop?: { x: number; y: number; zoom: number };
  }) => Promise<void>;
  removePhoto: () => Promise<void>;
};

const RESUME_TOOLS = ["resume"] as const;

/**
 * Rezyume hujjatida model DOIM bor deb hisoblanadi: yangi hujjatda
 * `doc.resume`, eskisida bo'limlardan tiklanadi. `legacy` faqat butunlay
 * bo'sh hujjatda yoqiladi.
 */
const hasResume = (doc: AcademicDoc) => Boolean(doc.resume || doc.sections?.length);

/** `doc.resume` yo'q bo'lsa eski hujjatdan model tiklaydi (server bilan bir xil). */
export function resumeDocOf(doc: AcademicDoc): AcademicDoc {
  return doc.resume ? doc : { ...doc, resume: legacyResumeModel(doc) };
}

export function useResumeEdit({
  gen,
  onGen,
  savedFlashMs = SAVED_FLASH_MS,
}: {
  gen?: unknown;
  onGen?: (g: unknown) => void;
  savedFlashMs?: number;
}): ResumeEdit {
  const ed = useDocEdit<ResumeOp>({
    gen,
    onGen,
    savedFlashMs,
    tools: RESUME_TOOLS,
    hasModel: hasResume,
    // `applyResumeOps` modelli hujjat kutadi — eski hujjat shu yerda
    // ko'tariladi (serverdagi `prepare` bilan bir xil qadam).
    apply: (doc, ops, ctx) => applyResumeOps(resumeDocOf(doc), ops, ctx),
    inverse: (doc, ops, ctx) => inverseResumeOps(resumeDocOf(doc), ops, ctx),
  });

  const uploadPhoto = useCallback(
    async (photo: { file: File; original?: File | null; shape?: "circle" | "square"; crop?: { x: number; y: number; zoom: number } }) => {
      await ed.serverEdit((baseVersion) => uploadResumePhoto(ed.genId, baseVersion, photo));
    },
    [ed],
  );

  const removePhoto = useCallback(async () => {
    await ed.serverEdit((baseVersion) => removeResumePhoto(ed.genId, baseVersion));
  }, [ed]);

  const model = ed.doc ? (ed.doc.resume ?? legacyResumeModel(ed.doc)) : null;
  return { ...ed, model, uploadPhoto, removePhoto };
}
