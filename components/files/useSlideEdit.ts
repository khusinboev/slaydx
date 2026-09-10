"use client";

import { useCallback } from "react";
import { uploadSlideImage } from "@/lib/api-edit";
import { applyDocOps, inverseOps, type DocOp } from "@/lib/generation/slide-edit";
import type { AcademicDoc } from "@/lib/generation/types";
import { useDocEdit, asEditGen as asEditGenBase, SAVED_FLASH_MS, type DocEdit, type EditGen } from "./useDocEdit";

/**
 * Slayd tahririning klient oqimi — YUPQA o'ram.
 *
 * Butun navbat/undo/redo/409/saqlash/qayta yasash mantiqi
 * `useDocEdit.ts` da (Rezyume 2, AUDIT-15 da so'zma-so'z ko'chirildi):
 * bu yerda faqat SLAYDGA xos to'rt nuqta qoladi — qaysi vositalar,
 * hujjatda `doc.slides` bormi, oplar qanday qo'llanadi/teskarilanadi va
 * rasm yuklash chaqiruvi. Hookning nomi, imzosi va qaytaradigan shakli
 * O'ZGARMADI (`tests/ui/slide-viewer-edit.test.mts` shuni qulflaydi).
 */

export { SAVED_FLASH_MS } from "./useDocEdit";
export type { EditGen } from "./useDocEdit";

export type SlideEdit = DocEdit<DocOp> & {
  uploadImage: (index: number, file: File) => Promise<void>;
};

/** Slayd vositalari — server tomonidagi `slideAdapter.tools` bilan bir xil. */
const SLIDE_TOOLS = ["slide", "pro-slide"] as const;

const hasSlides = (doc: AcademicDoc) => Boolean(doc.slides?.length);

/** `unknown` dan tekshirilgan generatsiya — eski eksport saqlanadi. */
export function asEditGen(gen: unknown): EditGen | null {
  return asEditGenBase(gen, SLIDE_TOOLS);
}

export function useSlideEdit({
  gen,
  onGen,
  savedFlashMs = SAVED_FLASH_MS,
}: {
  gen?: unknown;
  onGen?: (g: unknown) => void;
  /** Testlar uchun — standart {@link SAVED_FLASH_MS}. */
  savedFlashMs?: number;
}): SlideEdit {
  const ed = useDocEdit<DocOp>({
    gen,
    onGen,
    savedFlashMs,
    tools: SLIDE_TOOLS,
    hasModel: hasSlides,
    apply: applyDocOps,
    inverse: inverseOps,
  });

  const uploadImage = useCallback(
    async (index: number, file: File) => {
      await ed.serverEdit((baseVersion) => uploadSlideImage(ed.genId, index, file, baseVersion));
    },
    [ed],
  );

  return { ...ed, uploadImage };
}
