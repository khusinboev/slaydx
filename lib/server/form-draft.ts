import "server-only";
import { query, queryOne } from "./db";
import { sanitizeValues } from "./validate";
import { ApiError } from "./api";
import { TOOL_BY_ID } from "../tools";
import type { FormValues } from "../types";

/**
 * Umumiy forma qoralamasi (Maqola 2 / AUDIT-17, WP4).
 *
 * `resume_drafts` (Rezyume 2) ning (user, tool) bo'yicha UMUMLASHGAN
 * shakli — `020_article.sql` `form_drafts` jadvali (foydalanuvchiga har
 * VOSITA uchun BITTA qator). Maqola formasi ham rezyume kabi uzun
 * (mualliflar, manbalar, «Natijalarim» matni) — qoralama shart bo'ladi,
 * shuning uchun ikkinchi bir xil jadval yozish o'rniga rezyume shu
 * modulga o'tkaziladi (`resume-draft.ts` — yupqa o'ram).
 *
 * Nega serverda, `localStorage` da emas (`resume-draft.ts` dan
 * ko'chirilgan sabab): forma ko'pincha telefonda boshlanib, kompyuterda
 * tugaydi; fayl/surat aktivi allaqachon serverda — brauzerda saqlash
 * ularni qoralamadan ajratib qo'yardi.
 *
 * Qiymatlar generatsiya so'rovi bilan BIR XIL shaklda (`FormValues`,
 * JSON maydonlar bilan) saqlanadi — tiklashda hech qanday o'girish yo'q.
 */

/** Bitta qoralama ~30–60 KB; 200 KB — 12 ish joyi va uzun bandlar uchun ham yetarli. */
export const DRAFT_MAX_BYTES = 200_000;

export type FormDraft = { data: FormValues; updatedAt: string } | null;

/**
 * `toolId` `TOOL_BY_ID` da bo'lishi shart — aks holda 400.
 *
 * Bu chegara ataylab BOSHIDA: begona/eskirgan `toolId` bilan qator
 * jimgina bazaga yozilib, hech kim o'qimaydigan «yetim» qoralama
 * to'planib qolmasin (route `handler()` `ApiError` ni 400 ga aylantiradi).
 */
function assertToolId(toolId: string): void {
  if (!Object.prototype.hasOwnProperty.call(TOOL_BY_ID, toolId)) {
    throw new ApiError(`Noma'lum vosita: ${toolId}`, 400);
  }
}

export async function getDraft(userId: string, toolId: string): Promise<FormDraft> {
  assertToolId(toolId);
  const row = await queryOne<{ data: FormValues; updated_at: Date }>(
    `SELECT data, updated_at FROM form_drafts WHERE user_id = $1 AND tool_id = $2`,
    [userId, toolId],
  );
  if (!row) return null;
  const data = sanitizeValues(row.data);
  return { data: data ?? {}, updatedAt: new Date(row.updated_at).toISOString() };
}

/** Yozishdan oldin ham tozalanadi — bazaga faqat kutilgan shakl tushadi. */
export async function putDraft(userId: string, toolId: string, raw: unknown): Promise<{ updatedAt: string }> {
  assertToolId(toolId);
  const data = sanitizeValues(raw) ?? {};
  const row = await queryOne<{ updated_at: Date }>(
    `INSERT INTO form_drafts (user_id, tool_id, data, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (user_id, tool_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
     RETURNING updated_at`,
    [userId, toolId, JSON.stringify(data)],
  );
  return { updatedAt: new Date(row?.updated_at ?? Date.now()).toISOString() };
}

/** «Tozalash» — foydalanuvchi o'z ma'lumotini o'zi o'chiradi. */
export async function clearDraft(userId: string, toolId: string): Promise<void> {
  assertToolId(toolId);
  await query(`DELETE FROM form_drafts WHERE user_id = $1 AND tool_id = $2`, [userId, toolId]);
}
