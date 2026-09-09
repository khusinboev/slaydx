"use client";

import { ApiError, request, type GenerationDetail } from "./api-client";
import type { DocOp } from "./generation/slide-edit";

/**
 * Ko'ruvchidagi tahrir API si — ALOHIDA fayl.
 *
 * `api-client.ts` ga tegilmaydi (u jonli generatsiya paketiniki), lekin
 * `request()` qayta ishlatiladi: cookie, 401 ishlovi, xato matnlari va
 * JSON tahlili bir joyda qolsin. Bu yerdagi har funksiya bitta HTTP
 * so'rov — navbat, koalessiya, undo va optimistik render
 * `components/files/useSlideEdit.ts` da.
 *
 * Xato matnlari O'ZBEKCHA: server `{error}` bersa uni `request` ko'taradi,
 * lekin 409 lar faqat MASHINA uchun `{code}` yuboradi
 * (`version`/`status`/`legacy`/`redraw_limit`) — ularni foydalanuvchi
 * o'qiydigan jumlaga shu yerda o'giramiz, chunki uchala chaqiruv joyi
 * (matn, rasm, qayta chizish) bir xil jumlani kutadi.
 */

export type DocPatchResult = { generation: GenerationDetail };
export type RebuildResult = { fileVersion: number; docVersion: number; rebuilt: boolean };

/** Serverning 409 `code` lari → foydalanuvchi jumlasi. */
const CODE_TEXT: Record<string, string> = {
  version: "Hujjat boshqa joyda o‘zgardi — eng yangi holat yuklandi, tahrirni qaytadan kiriting.",
  status: "Hujjat hozir band — birozdan keyin urinib ko‘ring.",
  legacy: "Bu deka eski formatda — tahrir qilib bo‘lmaydi.",
  redraw_limit: "Qayta chizish limiti tugadi — bu dekada boshqa rasm chizilmaydi.",
};

/**
 * Xatoni o'zbekcha jumlaga aylantiradi.
 *
 * `code` birinchi o'rinda: server 409 da `error` matnini yubormasligi
 * mumkin, `code` esa har doim bor. Aks holda `ApiError` ning o'z matni
 * (server bergan `error` yoki `request` ning standart jumlasi).
 */
export function editErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    const code = typeof e.data.code === "string" ? e.data.code : "";
    if (code && CODE_TEXT[code]) return CODE_TEXT[code];
    if (e.status === 413) return "Fayl juda katta — 5 MB gacha rasm yuklang.";
    if (e.status === 415) return "Faqat PNG yoki JPEG rasm qabul qilinadi.";
    if (e.status === 429) return "Juda tez-tez — biroz kuting va qaytadan urinib ko‘ring.";
    return e.message;
  }
  return e instanceof Error && e.message ? e.message : "Saqlab bo‘lmadi";
}

/** `409 {code}` ni ajratadi — `useSlideEdit` shunga qarab qayta yuklaydi. */
export function editErrorCode(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  return typeof e.data.code === "string" ? e.data.code : "version";
}

/** Operatsiyalar to'plamini yuboradi (atomar: hammasi yoki hech biri). */
export function patchGenerationDoc(id: string, baseVersion: number, ops: DocOp[]) {
  return request<DocPatchResult>(`/api/generations/${id}/doc`, {
    method: "PATCH",
    body: JSON.stringify({ baseVersion, ops }),
  });
}

/** PPTX ni hujjatning oxirgi holatidan qayta yasashni so'raydi (fayl yangi bo'lsa — no-op). */
export function rebuildGeneration(id: string) {
  return request<RebuildResult>(`/api/generations/${id}/rebuild`, { method: "POST" });
}

/** Foydalanuvchi rasmini slaydga qo'yadi (multipart — `Content-Type` ni brauzer yozadi). */
export function uploadSlideImage(id: string, index: number, file: File, baseVersion: number) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("baseVersion", String(baseVersion));
  return request<DocPatchResult>(`/api/generations/${id}/slides/${index}/image`, {
    method: "POST",
    body: fd,
  });
}

/** Rasmni qaytadan chizdiradi (bepul, dekaga `IMAGE_REDRAW_LIMIT` marta). */
export function regenerateSlideImage(id: string, index: number, baseVersion: number, hint?: string) {
  return request<DocPatchResult>(`/api/generations/${id}/slides/${index}/image/regenerate`, {
    method: "POST",
    body: JSON.stringify(hint ? { baseVersion, hint } : { baseVersion }),
  });
}

/**
 * Yuklab olishdan OLDIN faylni hujjat bilan tenglashtiradi.
 *
 * `ResultView` ni hook'ga bog'lamaslik uchun alohida: u faqat versiyalarni
 * biladi (`onGen` orqali yangilanadi). Fayl allaqachon yangi bo'lsa
 * so'rov umuman yuborilmaydi.
 */
export async function ensureGenerationFresh(g: {
  id: string;
  docVersion?: number;
  fileVersion?: number;
}): Promise<RebuildResult | null> {
  if ((g.fileVersion ?? 0) >= (g.docVersion ?? 0)) return null;
  return rebuildGeneration(g.id);
}
