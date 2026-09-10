"use client";

import type { AcademicDoc } from "./generation/types";
import type { FormValues, Generation, JobStatus, ToolId } from "./types";
import type { SlideModel, SlideThemeId } from "./generation/slide-types";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "./generation/slide-templates";
import type { BodyRules } from "./generation/slide-audience";

/**
 * Server API bilan yagona aloqa nuqtasi.
 *
 * Ilgari klient hamma narsani o'zi hal qilardi: balansni ham, fayl
 * saqlashni ham. Endi haqiqat serverda — bu modul faqat so'rov yuboradi.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * Sessiya tugaganda chaqiriladi.
 *
 * `lib/store.ts` shu yerga ulanadi — aylanma import bo'lmasligi uchun
 * to'g'ridan-to'g'ri store ni chaqirmaymiz.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/**
 * `lib/api-edit.ts` (tahrir API funksiyalari) shu funksiyani qayta
 * ishlatadi — ikkinchi `fetch` o'ramini yozmaslik uchun. Boshqa hech
 * qanday funksiya bu faylga QO'SHILMAYDI (tahrir alohida faylda).
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // Cookie httpOnly — brauzer o'zi qo'shadi, biz faqat yuborishni so'raymiz.
      credentials: "same-origin",
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
      },
    });
  } catch {
    // Tarmoq uzilgan — «Xatolik (undefined)» o'rniga tushunarli matn.
    throw new ApiError("Internetga ulanib bo'lmadi. Aloqani tekshiring.", 0);
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    // Sessiya tugagan bo'lsa butun ilova bilib tursin — aks holda
    // foydalanuvchi har sahifada tushunarsiz xatoga urilardi.
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized?.();
    const message =
      typeof data.error === "string" && data.error
        ? data.error
        : res.status === 401
          ? "Sessiya tugagan — qaytadan kiring"
          : res.status >= 500
            ? "Server javob bermadi. Birozdan keyin urinib ko'ring."
            : `Xatolik (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

/* ─────────────────────────────── Auth ─────────────────────────────── */

export type ServerUser = {
  id: string;
  telegramId: string | null;
  username: string | null;
  name: string;
  photoUrl: string | null;
  language: string;
  points: number;
  quota: number;
  balance: number;
  plan: "free" | "pro";
  planExpiresAt: string | null;
  premium: boolean;
  university: string;
  faculty: string;
  department: string;
  group: string;
  course: string;
  author: string;
  subject: string;
  teacher: string;
  city: string;
  /** Slayd muallifi lavozimi va tashkiloti (015). */
  position: string;
  organization: string;
  phone: string | null;
  isAdmin: boolean;
};

export type Features = {
  llm: boolean;
  images: boolean;
  telegram: boolean;
  telegramBot: string | null;
  devLogin: boolean;
  /** Server DOCX/PPTX ni PDF ga o'gira oladimi (LibreOffice o'rnatilganmi). */
  pdf: boolean;
  payments: { click: boolean; payme: boolean };
};

export function fetchSession() {
  return request<{ user: ServerUser | null; features: Features }>("/api/auth/session");
}

export function requestOtp(identifier: string) {
  return request<{ sent: boolean; delivery: string; devCode?: string }>("/api/auth/otp?action=request", {
    method: "POST",
    body: JSON.stringify({ identifier }),
  });
}

export function verifyOtp(identifier: string, code: string) {
  return request<{ user: ServerUser }>("/api/auth/otp?action=verify", {
    method: "POST",
    body: JSON.stringify({ identifier, code }),
  });
}

export function loginWithTelegram(payload: { initData?: string; widget?: Record<string, string> }) {
  return request<{ user: ServerUser }>("/api/auth/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type Ticket = { nonce: string; url: string; expiresAt: string };

/**
 * Telegram kirish chiptasi — bot havolasi.
 *
 * Sessiya bu chaqiruvdan emas, foydalanuvchi botdagi «Saytga kirish»
 * tugmasini bosganda ochiladi (alohida oynada). Bu oyna sessiyani
 * `fetchSession` bilan so'rab kutadi — `LoginModal` dagi polling shu.
 */
export function createLoginTicket() {
  return request<Ticket>("/api/auth/telegram/ticket", { method: "POST", body: "{}" });
}

export function logout(all = false) {
  return request<{ ok: boolean }>(`/api/auth/session${all ? "?all=1" : ""}`, { method: "DELETE" });
}

export function updateProfile(patch: Partial<ServerUser>) {
  return request<{ user: ServerUser }>("/api/users/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export type LedgerEntry = { id: string; kind: string; amount: number; note: string; createdAt: string };

export function fetchMe() {
  return request<{ user: ServerUser; transactions: LedgerEntry[] }>("/api/users/me");
}

/* ──────────────────────────── Admin ────────────────────────────────── */

export type AdminUser = {
  id: string;
  name: string;
  username: string | null;
  telegramId: string | null;
  localId: string | null;
  phone: string | null;
  points: number;
  quota: number;
  balance: number;
  plan: string;
  isBlocked: boolean;
  createdAt: string;
};

export function fetchAdminUsers(q: string, page = 1) {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  return request<{ users: AdminUser[]; total: number; page: number; pageSize: number }>(
    `/api/admin/users?${params}`,
  );
}

export function fetchAdminUser(id: string) {
  return request<{ user: ServerUser; transactions: LedgerEntry[] }>(`/api/admin/users/${id}`);
}

export type Wallet = "points" | "quota" | "balance";

export function adjustAdminWallet(id: string, wallet: Wallet, delta: number, note?: string) {
  return request<{ user: ServerUser; before: number; after: number }>(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ wallet, delta, note }),
  });
}

export function setAdminBlocked(id: string, blocked: boolean) {
  return request<{ user: ServerUser }>(`/api/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify({ blocked }),
  });
}

/* ──────────────────────────── Generations ─────────────────────────── */

/**
 * Slayd dekalari uchun BIRINCHI slaydning to'liq maket modeli — kartochka
 * (`FilePreview.tsx`) uni `SlideCanvas` bilan ko'ruvchidagidek chizadi
 * ("ko'rdim = oldim"). `lib/server/jobs.ts`dagi bir xil nom bilan mos.
 */
export type GenerationPreviewSlide = {
  model: Omit<SlideModel, "notes">;
  themeId: SlideThemeId;
  templateId: SlideTemplateId;
  visual: SlideVisual;
  audience: SlideAudience;
  bodyType: BodyRules;
  logo?: string;
};

/** Ro'yxat kartochkasi uchun server tayyorlagan kichik ko'rinish. */
export type GenerationPreview = { url?: string; lines?: string[]; slide?: GenerationPreviewSlide };

export type ServerGeneration = Omit<Generation, "values" | "doc" | "html"> & {
  expiresAt: string | null;
  error: string | null;
  preview: GenerationPreview | null;
  /**
   * Tahrir/jonli ustunlari (F1 poydevor) — HAMMASI ixtiyoriy va standart
   * bilan, eski server javoblari (ustunlar hali yo'q) buzilmasligi uchun.
   * Haqiqiy qiymatlarni keyingi paketlar (`E4`/`L4`) to'ldiradi.
   */
  docVersion?: number;
  fileVersion?: number;
  imageRedraws?: number;
  /** `doc_prev` bor — «Asl holatga qaytarish» tugmasi uchun (014_doc_prev). */
  hasPrev?: boolean;
  editedAt?: string | null;
  liveSeq?: number;
  live?: unknown | null;
};

export type GenerationDetail = ServerGeneration & {
  html: string | null;
  doc: AcademicDoc | null;
  hasFile: boolean;
};

export function listGenerations() {
  return request<{ generations: ServerGeneration[] }>("/api/generations");
}

export function getGeneration(id: string, since?: number) {
  const qs = since != null ? `?since=${since}` : "";
  return request<{ generation: GenerationDetail }>(`/api/generations/${id}${qs}`);
}

/**
 * Server javobidagi `live` ni oldingi holat bilan qo'shadi (L4).
 *
 * `next.live === undefined` — server kalitni umuman yubormagan
 * (o'zgarish yo'q, `since` mos kelgan): oldingi `live` saqlanadi.
 * `null` esa haqiqiy qiymat — jonli deka yo'qligini bildiradi va
 * saqlanmaydi.
 */
export function mergeLive(prev: GenerationDetail | null, next: GenerationDetail): GenerationDetail {
  if (next.live !== undefined) return next;
  return { ...next, live: prev?.live };
}

/**
 * Keyingi so'rovgacha kutish vaqti.
 *
 * Jonli deka bor va ish hali `IN_PROGRESS` bo'lsa — tez-tez so'raymiz
 * (1.2s), aks holda eski backoff (1s → 5s gacha o'sadi).
 */
export function nextPollDelay(g: GenerationDetail, delay: number): number {
  if (g.status === "IN_PROGRESS" && g.live) return 1200;
  return Math.min(5000, Math.round(delay * 1.3));
}

export function createGeneration(slug: string, values: FormValues) {
  return request<{ id: string; price: number; status: JobStatus }>("/api/generations", {
    method: "POST",
    body: JSON.stringify({ slug, values }),
  });
}

export function deleteGeneration(id: string) {
  return request<{ ok: boolean; refunded: boolean }>(`/api/generations/${id}`, { method: "DELETE" });
}

export function fileUrl(id: string, format?: "pdf") {
  return `/api/generations/${id}/file${format ? `?format=${format}` : ""}`;
}

/**
 * Faylni yuklab oladi.
 *
 * `<a download>` to'g'ridan-to'g'ri ishlatilmaydi: xato bo'lsa brauzer
 * jimgina JSON xato sahifasini `.docx` nomi bilan saqlab qo'yardi.
 */
export async function downloadGeneration(id: string, format?: "pdf"): Promise<void> {
  const res = await fetch(fileUrl(id, format), { credentials: "same-origin" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error || "Fayl yuklab olinmadi", res.status);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : "hujjat";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari yuklashni boshlashi uchun bir oz kutamiz.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Ish tugaguncha holatni so'rab turadi.
 *
 * Interval o'sib boradi (1s → 4s): uzoq kurs ishi uchun serverni
 * har soniyada bezovta qilmaydi.
 */
export async function pollGeneration(
  id: string,
  onTick: (g: GenerationDetail) => void,
  signal?: AbortSignal,
): Promise<GenerationDetail> {
  let delay = 1000;
  const deadline = Date.now() + 20 * 60_000;
  let networkErrors = 0;
  let prev: GenerationDetail | null = null;

  for (;;) {
    if (signal?.aborted) throw new DOMException("Bekor qilindi", "AbortError");

    let generation: GenerationDetail;
    try {
      const since = prev?.live != null ? prev.liveSeq : undefined;
      generation = (await getGeneration(id, since)).generation;
      networkErrors = 0;
    } catch (e) {
      // Vaqtinchalik tarmoq uzilishida polling to'xtamasin, lekin
      // cheksiz ham urinmasin.
      if (e instanceof ApiError && (e.status === 0 || e.status >= 500) && networkErrors < 5) {
        networkErrors++;
        await new Promise((r) => setTimeout(r, 2000 * networkErrors));
        continue;
      }
      throw e;
    }

    const merged = mergeLive(prev, generation);
    prev = merged;
    onTick(merged);
    if (merged.status !== "QUEUED" && merged.status !== "IN_PROGRESS") return merged;

    // Worker o'chirilgan bo'lsa polling abadiy davom etmasin.
    if (Date.now() > deadline) {
      throw new ApiError("Ish juda uzoq davom etmoqda. Keyinroq «Mening fayllarim» dan tekshiring.", 504);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = nextPollDelay(merged, delay);
  }
}

/* ───────────────────────────── Payments ───────────────────────────── */

export type PaymentOrder = {
  id: string;
  provider: "click" | "payme";
  purpose: "topup" | "pro";
  amountSoum: number;
  state: "created" | "pending" | "paid" | "cancelled";
  createdAt: string;
};

export function createOrder(input: {
  provider: "click" | "payme";
  purpose: "topup" | "pro";
  amount?: number;
}) {
  return request<{ order: PaymentOrder; checkoutUrl: string }>("/api/payments/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listOrders() {
  return request<{
    orders: PaymentOrder[];
    plan: { priceSoum: number; days: number; quota: number };
    providers: { click: boolean; payme: boolean };
  }>("/api/payments/orders");
}

/* ───────────────────────────── Extract ────────────────────────────── */

export async function extractText(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ text: string; chars?: number; error?: string }>("/api/extract", {
    method: "POST",
    body: form,
  });
}

/* ─────────────────────────── O'z shablonim ─────────────────────────── */

export type CustomTemplateLite = import("./generation/pptx-template").CustomTemplate;
export type TemplateUploadResponse = { assetId: string; name: string; size: number; template: CustomTemplateLite };

/**
 * PPTX namunasini yuklaydi (`TemplateGallery` «O'z shablonim», Shablonlar 2).
 * `POST /api/uploads/template`, `multipart/form-data`, maydon `file`.
 * Server tahlil + rasterlash qiladi (20–40 s) — chaqiruvchi «kutish» holatini ko'rsatadi.
 */
export async function uploadTemplate(file: File): Promise<TemplateUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  try {
    return await request<TemplateUploadResponse>("/api/uploads/template", { method: "POST", body: form });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 413) throw new ApiError("Fayl 20 MB dan katta", e.status, e.data);
      if (e.status === 415) throw new ApiError("Faqat PPTX (PowerPoint) fayl", e.status, e.data);
      if (e.status === 429) throw new ApiError("Juda ko‘p urinish — birozdan keyin", e.status, e.data);
    }
    throw e;
  }
}

export async function listTemplates(): Promise<CustomTemplateLite[]> {
  const r = await request<{ templates: CustomTemplateLite[] }>("/api/uploads/template");
  return r.templates ?? [];
}

export async function deleteTemplate(assetId: string): Promise<void> {
  await request<{ ok: true }>(`/api/uploads/template/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

/* ─────────────────────── Tarjima manbasi (Tarjimon 2) ─────────────────────── */

/**
 * Javob tipi SERVER bilan bitta manbadan (`lib/generation/source-types.ts`).
 * U izomorf fayl — `import "server-only"` yo'q, shuning uchun klient uni
 * xavfsiz o'qiy oladi.
 */
export type { SourceUploadResult } from "./generation/source-types";

/**
 * Tarjima manbasini yuklaydi (`TranslationForm`, WP4).
 *
 * Server shartnomasi: `POST /api/uploads/source`, `multipart/form-data`,
 * maydon `file`. Javobdagi `chars` — narx hisoblanadigan ISHONCHLI son.
 *
 * 422 da server xabari SAQLANADI (`uploadTemplate` dan farqi): u yerda
 * xato turlari ikkita edi, bu yerda esa uchta va ularning matni bir-biriga
 * o'xshamaydi — «skaner nusxa», «matn topilmadi», «N belgi — chegara
 * 200 000». Umumiy matn bilan almashtirilsa foydalanuvchi nima
 * qilishini bilmay qolardi.
 */
export async function uploadSource(file: File): Promise<import("./generation/source-types").SourceUploadResult> {
  const form = new FormData();
  form.append("file", file);
  try {
    return await request<import("./generation/source-types").SourceUploadResult>("/api/uploads/source", {
      method: "POST",
      body: form,
    });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 413) throw new ApiError("Fayl 20 MB dan katta", e.status, e.data);
      if (e.status === 415) {
        throw new ApiError("Format qo‘llanmaydi: DOCX, PPTX, XLSX, PDF, TXT, MD, CSV", e.status, e.data);
      }
      if (e.status === 429) throw new ApiError("Juda ko‘p urinish — birozdan keyin", e.status, e.data);
    }
    throw e;
  }
}

export async function deleteSource(assetId: string): Promise<void> {
  await request<{ ok: true }>(`/api/uploads/source/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

/* ────────────────────────────── Logotip ────────────────────────────── */

/**
 * Pro slayd logotipini yuklaydi (`LogoField`).
 *
 * Server shartnomasi (WP-F, parallel yozilgan): `POST /api/uploads/logo`,
 * `multipart/form-data`, maydon `file`. Xato matnlari `request()` dan
 * kelgan server xabaridan QAT'IY NAZAR shu yerda status bo'yicha
 * qattiq belgilanadi — klient nima ko'rsatishini bilishi uchun serverning
 * aniq so'z tanlashiga qaram bo'lmaslik kerak.
 */
export async function uploadLogo(file: File): Promise<{ assetId: string; mime: string; size: number }> {
  const form = new FormData();
  form.append("file", file);
  try {
    return await request<{ assetId: string; mime: string; size: number }>("/api/uploads/logo", {
      method: "POST",
      body: form,
    });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 413) throw new ApiError("Logo 2 MB dan katta", e.status, e.data);
      if (e.status === 415) throw new ApiError("Faqat PNG yoki JPEG", e.status, e.data);
      if (e.status === 429) throw new ApiError("Juda ko‘p urinish", e.status, e.data);
    }
    throw e;
  }
}

/**
 * Ish rejasini oldindan olish. Bepul va kredit yechmaydi —
 * `app/api/outline/route.ts` izohiga qarang.
 */
export async function draftOutline(slug: string, values: FormValues) {
  return request<{ text: string }>("/api/outline", {
    method: "POST",
    body: JSON.stringify({ slug, values }),
  });
}

export type { ToolId };
