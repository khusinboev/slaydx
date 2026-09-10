import "server-only";
import { query, queryOne } from "./db";
import { sanitizeValues } from "./validate";
import type { FormValues } from "../types";

/**
 * Rezyume formasining qoralamasi (Rezyume 2, 1-band).
 *
 * Nega serverda, `localStorage` da emas: rezyume — foydalanuvchining eng
 * uzun formasi va u ko'pincha telefonda boshlanib, kompyuterda tugaydi.
 * Bundan tashqari surat aktivi (`photoAssetId`) allaqachon serverda —
 * qoralamani brauzerda saqlash ikkisini ajratib qo'yardi.
 *
 * Qiymatlar generatsiya so'rovi bilan BIR XIL shaklda (`FormValues`,
 * JSON maydonlar bilan) saqlanadi: tiklashda hech qanday o'girish yo'q.
 * Route emas, shu modul testlanadi — `cookies()` Next konteksti kerak
 * emas (`logo.ts` naqshi).
 */

/** Bitta qoralama ~30–60 KB; 200 KB — 12 ish joyi va uzun bandlar uchun ham yetarli. */
export const DRAFT_MAX_BYTES = 200_000;

export type ResumeDraft = { data: FormValues; updatedAt: string } | null;

export async function getDraft(userId: string): Promise<ResumeDraft> {
  const row = await queryOne<{ data: FormValues; updated_at: Date }>(
    `SELECT data, updated_at FROM resume_drafts WHERE user_id = $1`,
    [userId],
  );
  if (!row) return null;
  const data = sanitizeValues(row.data);
  return { data: data ?? {}, updatedAt: new Date(row.updated_at).toISOString() };
}

/** Yozishdan oldin ham tozalanadi — bazaga faqat kutilgan shakl tushadi. */
export async function putDraft(userId: string, raw: unknown): Promise<{ updatedAt: string }> {
  const data = sanitizeValues(raw) ?? {};
  const row = await queryOne<{ updated_at: Date }>(
    `INSERT INTO resume_drafts (user_id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
     RETURNING updated_at`,
    [userId, JSON.stringify(data)],
  );
  return { updatedAt: new Date(row?.updated_at ?? Date.now()).toISOString() };
}

/** «Tozalash» — foydalanuvchi o'z ma'lumotini o'zi o'chiradi. */
export async function clearDraft(userId: string): Promise<void> {
  await query(`DELETE FROM resume_drafts WHERE user_id = $1`, [userId]);
}
