import "server-only";
import { DRAFT_MAX_BYTES as FORM_DRAFT_MAX_BYTES, clearDraft as clearFormDraft, getDraft as getFormDraft, putDraft as putFormDraft } from "./form-draft";
import type { FormValues } from "../types";

/**
 * Rezyume formasining qoralamasi (Rezyume 2, 1-band).
 *
 * Maqola 2 / AUDIT-17 WP4 dan boshlab bu YUPQA O'RAM: haqiqiy saqlash
 * umumiy `form_drafts` jadvalida, `form-draft.ts` orqali (`toolId =
 * "resume"`). Eski `resume_drafts` jadvaliga ENDI YOZILMAYDI — 020
 * migratsiya bir martalik nusxa ko'chirgan, jadvalning o'zi rollback
 * xavfsizligi uchun 021 gacha qoladi.
 *
 * Import joyi va funksiya imzolari ATAYLAB o'zgarmagan — chaqiruvchi
 * kod (`app/api/resume/draft/route.ts` eski marshrut, testlar) qayta
 * yozilmasin.
 */

export const DRAFT_MAX_BYTES = FORM_DRAFT_MAX_BYTES;

export type ResumeDraft = { data: FormValues; updatedAt: string } | null;

export async function getDraft(userId: string): Promise<ResumeDraft> {
  return getFormDraft(userId, "resume");
}

export async function putDraft(userId: string, raw: unknown): Promise<{ updatedAt: string }> {
  return putFormDraft(userId, "resume", raw);
}

export async function clearDraft(userId: string): Promise<void> {
  return clearFormDraft(userId, "resume");
}
