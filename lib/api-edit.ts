"use client";

import { ApiError, request, type GenerationDetail } from "./api-client";

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
 * (`version`/`status`/`legacy`/`no_prev`) — ularni foydalanuvchi
 * o'qiydigan jumlaga shu yerda o'giramiz, chunki ikkala chaqiruv joyi
 * (matn, rasm) bir xil jumlani kutadi.
 */

export type DocPatchResult = { generation: GenerationDetail };
export type RebuildResult = { fileVersion: number; docVersion: number; rebuilt: boolean };

/** Serverning 409 `code` lari → foydalanuvchi jumlasi. */
const CODE_TEXT: Record<string, string> = {
  version: "Hujjat boshqa joyda o‘zgardi — eng yangi holat yuklandi, tahrirni qaytadan kiriting.",
  status: "Hujjat hozir band — birozdan keyin urinib ko‘ring.",
  legacy: "Bu deka eski formatda — tahrir qilib bo‘lmaydi.",
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

/**
 * Operatsiyalar to'plamini yuboradi (atomar: hammasi yoki hech biri).
 *
 * `ops` ATAYIN `unknown[]`: bitta marshrut (`PATCH …/doc`) endi ikki xil
 * op tilini oladi — slayd (`DocOp`) va rezyume (`ResumeOp`). Qaysi til
 * ekanini SERVER hujjat turidan aniqlaydi (`adapterFor` → `parse`),
 * ya'ni tipni bu yerda toraytirish klientni ikkiga bo'lardi, xavfsizlik
 * esa baribir server tomonda hal qilinadi.
 */
export function patchGenerationDoc(id: string, baseVersion: number, ops: unknown[]) {
  return request<DocPatchResult>(`/api/generations/${id}/doc`, {
    method: "PATCH",
    body: JSON.stringify({ baseVersion, ops }),
  });
}

/** PPTX ni hujjatning oxirgi holatidan qayta yasashni so'raydi (fayl yangi bo'lsa — no-op). */
export function rebuildGeneration(id: string) {
  return request<RebuildResult>(`/api/generations/${id}/rebuild`, { method: "POST" });
}

/**
 * Dekani BIRINCHI tahrirdan OLDINGI holatga qaytaradi («Asl holatga
 * qaytarish»). Tana yo'q — server `doc_prev`dan o'zi tiklaydi. `doc_prev`
 * yo'q bo'lsa 409 `{code:"no_prev"}` — `editErrorText`/`editErrorCode`
 * boshqa 409 kodlar bilan bir xil ishlanadi.
 */
export function restoreGenerationDoc(id: string) {
  return request<DocPatchResult>(`/api/generations/${id}/doc/restore`, { method: "POST" });
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

/** Rezyume surati (kesilgan + ixtiyoriy asl) — `POST …/photo`. */
export function uploadResumePhoto(
  id: string,
  baseVersion: number,
  photo: { file: File; original?: File | null; shape?: "circle" | "square"; crop?: { x: number; y: number; zoom: number } },
) {
  const fd = new FormData();
  fd.append("file", photo.file);
  if (photo.original) fd.append("original", photo.original);
  if (photo.shape) fd.append("shape", photo.shape);
  if (photo.crop) fd.append("crop", JSON.stringify(photo.crop));
  fd.append("baseVersion", String(baseVersion));
  return request<DocPatchResult>(`/api/generations/${id}/photo`, { method: "POST", body: fd });
}

/**
 * Maqola tayyorlik hisobotidagi «Tuzatish» (Maqola 2, WP7) — server
 * `writer` roli bilan bo'lim/annotatsiya/kalit so'z/highlights ni qayta
 * yozadi, hisobotni qayta hisoblaydi; javob `PATCH …/doc` bilan bir xil
 * `generation` (+ qo'llangan `ops`). 409 `version` — boshqa 409 lar kabi
 * `editErrorCode` orqali qayta yuklashga olib keladi. Kredit yechilmaydi.
 */
export function rewriteArticle(id: string, baseVersion: number, fix: { op: "rewrite"; target: string; instruction: string }) {
  return request<DocPatchResult & { ops: unknown[] }>(`/api/generations/${id}/rewrite`, {
    method: "POST",
    body: JSON.stringify({ baseVersion, fix }),
  });
}

/**
 * «Hammasini tuzatish» — avto-sayqal (Maqola 3, AUDIT-18): server hisobotdagi
 * tuzatiladigan bandlarni o'zi tuzatadi va baholovchi bilan qayta baholaydi;
 * ball oshsa yangi hujjat, aks holda eski hujjat + jurnal (`review.polish`).
 * Javob `rewriteArticle` bilan bir xil `generation` (+ `ops`, `polish`).
 * 409 `version` — qayta yuklash; 429 — kunlik chegara (3/maqola, 20/foydalanuvchi).
 */
export function polishArticle(id: string, baseVersion: number) {
  return request<DocPatchResult & { ops: unknown[]; polish: import("./generation/article/types").PolishLog }>(`/api/generations/${id}/polish`, {
    method: "POST",
    body: JSON.stringify({ baseVersion }),
  });
}

/** Suratni olib tashlash — bayt yubormasdan (`remove=1`). */
export function removeResumePhoto(id: string, baseVersion: number) {
  const fd = new FormData();
  fd.append("remove", "1");
  fd.append("baseVersion", String(baseVersion));
  return request<DocPatchResult>(`/api/generations/${id}/photo`, { method: "POST", body: fd });
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
