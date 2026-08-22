"use client";

import type { AcademicDoc } from "./generation/types";
import type { FormValues, Generation, JobStatus, ToolId } from "./types";

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

/** Ro'yxat kartochkasi uchun server tayyorlagan kichik ko'rinish. */
export type GenerationPreview = { url?: string; lines?: string[] };

export type ServerGeneration = Omit<Generation, "values" | "doc" | "html"> & {
  expiresAt: string | null;
  error: string | null;
  preview: GenerationPreview | null;
};

export type GenerationDetail = ServerGeneration & {
  html: string | null;
  doc: AcademicDoc | null;
  hasFile: boolean;
};

export function listGenerations() {
  return request<{ generations: ServerGeneration[] }>("/api/generations");
}

export function getGeneration(id: string) {
  return request<{ generation: GenerationDetail }>(`/api/generations/${id}`);
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

  for (;;) {
    if (signal?.aborted) throw new DOMException("Bekor qilindi", "AbortError");

    let generation: GenerationDetail;
    try {
      generation = (await getGeneration(id)).generation;
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

    onTick(generation);
    if (generation.status !== "QUEUED" && generation.status !== "IN_PROGRESS") return generation;

    // Worker o'chirilgan bo'lsa polling abadiy davom etmasin.
    if (Date.now() > deadline) {
      throw new ApiError("Ish juda uzoq davom etmoqda. Keyinroq «Mening fayllarim» dan tekshiring.", 504);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(5000, Math.round(delay * 1.3));
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
