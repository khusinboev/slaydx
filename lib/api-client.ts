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
  /**
   * Server `Retry-After` sarlavhasi yoki tanadagi `retryAfterSec`/`retryAfter`
   * (soniya) — bo'lmasa `null`. Polling va UI «qachon qayta urinish» ni
   * shundan oladi (C09/C20, W2 shartnomalari).
   */
  readonly retryAfterSec: number | null;

  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.retryAfterSec = retrySecOf(data);
  }
}

function positiveSec(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** Tanadagi `retryAfterSec` (W2 shartnomasi) yoki `retryAfter` (`spend.ts`). */
function retrySecOf(data: Record<string, unknown>): number | null {
  return positiveSec(data.retryAfterSec) ?? positiveSec(data.retryAfter);
}

/**
 * «N soniyadan/daqiqadan keyin» — server `Retry-After` ini o'qiladigan
 * qilib beradi (navbat to'lgan, PDF band, …).
 */
export function retryAfterText(sec: number): string {
  if (sec < 60) return `${sec} soniyadan keyin`;
  return `${Math.ceil(sec / 60)} daqiqadan keyin`;
}

/**
 * Server matniga qayta urinish vaqtini qo'shadi — faqat matnning o'zida
 * raqam bo'lmasa (server «30 soniyadan keyin …» desa takrorlanmaydi).
 */
export function withRetryHint(message: string, sec: number | null): string {
  if (!sec || /\d/.test(message)) return message;
  return `${message} (qayta urinish: ${retryAfterText(sec)})`;
}

/** Har so'rovning standart vaqt chegarasi (FE-14). Uzun yo'llar o'zinikini beradi. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** `fetch` parametrlari + ixtiyoriy vaqt chegarasi (ms). */
export type RequestOptions = RequestInit & { timeoutMs?: number };

const TIMEOUT_TEXT = "Server javob bermadi (vaqt tugadi). Aloqani tekshirib, qayta urinib ko'ring.";
const OFFLINE_TEXT = "Internetga ulanib bo'lmadi. Aloqani tekshiring.";

/**
 * Chaqiruvchi signali + vaqt chegarasi → bitta signal.
 *
 * `AbortSignal.any` eski WebView'larda (Telegram iOS) yo'q — shuning uchun
 * qo'lda ulanadi. Vaqt chegarasi `AbortSignal.timeout` da (bo'lsa):
 * global `setTimeout` ni almashtiradigan testlar uni buzmaydi.
 */
function linkedSignal(ms: number, outer?: AbortSignal | null) {
  const ctrl = new AbortController();
  let timedOut = false;
  const onTimeout = () => {
    timedOut = true;
    ctrl.abort(new DOMException("Vaqt tugadi", "TimeoutError"));
  };
  const onOuter = () => ctrl.abort(outer?.reason);
  const t = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (t) t.addEventListener("abort", onTimeout, { once: true });
  else timer = setTimeout(onTimeout, ms);
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", onOuter, { once: true });
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      t?.removeEventListener("abort", onTimeout);
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

function abortError(): DOMException {
  return new DOMException("Bekor qilindi", "AbortError");
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
 *
 * Har so'rovda vaqt chegarasi bor (standart {@link DEFAULT_TIMEOUT_MS}):
 * mobil aloqa uzilganda `fetch` daqiqalab osilib qolmasin (FE-14). Vaqt
 * tugasa — `ApiError(status 0, {timeout:true})`, ya'ni tarmoq xatosi
 * bilan bir xil (qayta urinsa bo'ladi). Chaqiruvchi o'zi bekor qilsa —
 * `AbortError` (xato emas, UI uni ko'rsatmaydi).
 */
export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: outer, ...rest } = init;
  const link = linkedSignal(timeoutMs, outer);
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        ...rest,
        signal: link.signal,
        // Cookie httpOnly — brauzer o'zi qo'shadi, biz faqat yuborishni so'raymiz.
        credentials: "same-origin",
        headers: {
          ...(rest.body && !(rest.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
          ...rest.headers,
        },
      });
    } catch {
      if (outer?.aborted) throw abortError();
      if (link.timedOut()) throw new ApiError(TIMEOUT_TEXT, 0, { timeout: true });
      // Tarmoq uzilgan — «Xatolik (undefined)» o'rniga tushunarli matn.
      throw new ApiError(OFFLINE_TEXT, 0);
    }

    let text: string;
    try {
      text = await res.text();
    } catch {
      // Tana o'qilayotganda uzildi — vaqt tugadi yoki bekor qilindi.
      if (outer?.aborted) throw abortError();
      if (link.timedOut()) throw new ApiError(TIMEOUT_TEXT, 0, { timeout: true });
      throw new ApiError(OFFLINE_TEXT, 0);
    }
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
      // `Retry-After` sarlavhasi (nginx/route) tanada yo'q bo'lsa — ko'chiriladi.
      const header = positiveSec(res.headers.get("retry-after"));
      throw new ApiError(message, res.status, header && data.retryAfterSec == null ? { ...data, retryAfterSec: header } : data);
    }
    return data as T;
  } finally {
    link.done();
  }
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

/**
 * Telegram Mini App `initData` si — sayt Mini App ichida ochilgan bo'lsa.
 *
 * FE-10: ilgari faqat `window.Telegram.WebApp.initData` o'qilardi, lekin
 * uni yaratuvchi `telegram-web-app.js` hech qachon yuklanmagan — Mini App
 * kirishi o'lik kod edi. Telegram mijozi ma'lumotni ishga tushirish
 * URL ining `#tgWebAppData=…` qismida beradi (SDK ham aynan shuni o'qiydi);
 * tashqi skript (CSP, yuklash vaqti) o'rniga shu yerdan olinadi. Imzo
 * serverda bot tokeni bilan tekshiriladi (`verifyMiniAppInitData`).
 *
 * Birinchi chaqiruvda o'qib keshlanadi: Next yo'riqchisi keyingi
 * o'tishlarda `#` qismini tashlaydi. `sessionStorage` — Mini App ichida
 * sahifa qayta yuklansa ham topilishi uchun. Mini App bo'lmasa `null`.
 */
const MINI_APP_KEY = "slaydx-tg-init";
let miniAppCache: string | null | undefined;
export function miniAppInitData(): string | null {
  if (miniAppCache !== undefined) return miniAppCache;
  if (typeof window === "undefined") return null;
  const sdk = (window as unknown as { Telegram?: { WebApp?: { initData?: unknown } } }).Telegram?.WebApp?.initData;
  let value: string | null = typeof sdk === "string" && sdk ? sdk : null;
  if (!value) {
    const hash = window.location.hash.replace(/^#/, "");
    value = hash ? new URLSearchParams(hash).get("tgWebAppData") : null;
  }
  try {
    if (value) window.sessionStorage.setItem(MINI_APP_KEY, value);
    else value = window.sessionStorage.getItem(MINI_APP_KEY);
  } catch (e) {
    // sessionStorage yopiq (maxfiy rejim) — faqat qayta yuklashdan keyingi zaxira yo'qoladi.
    console.warn("[miniapp] sessionStorage:", e instanceof Error ? e.message : e);
  }
  miniAppCache = value || null;
  return miniAppCache;
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
  /**
   * Bonus-faqat hujjat fayllari retention bo'yicha o'chirilgan vaqt
   * (W2-D2/W2-B, ixtiyoriy — eski server bermaydi). O'rnatilgan bo'lsa
   * eskiz/fayl havolalari o'chgan aktivga olib boradi — UI ularni chizmaydi.
   */
  filesPurgedAt?: string | null;
};

export type GenerationDetail = ServerGeneration & {
  html: string | null;
  doc: AcademicDoc | null;
  hasFile: boolean;
  /**
   * Faqat `QUEUED` da, ixtiyoriy (W2-B shartnomasi): navbatdagi o'rin
   * (1 dan) va taxminiy kutish (s). Eski server yubormaydi — UI
   * mavjudligini tekshirib ko'rsatadi (UX-07).
   */
  queuePosition?: number;
  etaSec?: number;
};

export type GenerationPage = { generations: ServerGeneration[]; nextCursor?: string | null };

/**
 * Fayllar ro'yxati. `cursor` — oldingi javobning `nextCursor` i (shaffof
 * satr, W2-B shartnomasi). Eski server `nextCursor` bermaydi → `null`.
 * Birinchi sahifa kursorini `lib/store.ts` (`generationsCursor`) saqlaydi.
 */
export async function listGenerations(opts: { cursor?: string; limit?: number } = {}): Promise<GenerationPage> {
  const qs = new URLSearchParams();
  if (opts.cursor) qs.set("cursor", opts.cursor);
  if (opts.limit) qs.set("limit", String(opts.limit));
  const q = qs.toString();
  const page = await request<GenerationPage>(`/api/generations${q ? `?${q}` : ""}`);
  const next = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
  return { ...page, nextCursor: next };
}

export function getGeneration(id: string, since?: number, signal?: AbortSignal) {
  const qs = since != null ? `?since=${since}` : "";
  return request<{ generation: GenerationDetail }>(`/api/generations/${id}${qs}`, signal ? { signal } : {});
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

/**
 * Generatsiyani navbatga qo'yadi (pul shu so'rovda yechiladi).
 *
 * 429 `queue_full`/`user_inflight` (W2-B): server pul yechishdan OLDIN
 * rad etadi — foydalanuvchi server matnini va qachon qayta urinishni
 * ko'radi (barcha formalar `e.message` ni `ToolChrome` da chiqaradi).
 * Avtomatik qayta yuborilmaydi: har yuborish — yangi to'lov.
 *
 * Vaqt tugasa ish baribir navbatga tushgan bo'lishi mumkin — matn
 * qayta yuborishdan oldin «Mening fayllarim» ni tekshirishni aytadi.
 *
 * `Idempotency-Key` (C34 / CONC-10): har yuborish NIYATIGA bitta UUID v4
 * ({@link submitKey}). Javobi yo'qolgan so'rovdan (vaqt tugashi, 5xx,
 * tarmoq) keyin xuddi shu forma qayta yuborilsa — kalit O'SHA: server
 * ikkinchi marta pul yechmay, birinchi ishni qaytaradi. Server kalitni
 * hali o'qimasa ham sarlavha zararsiz.
 */
export async function createGeneration(slug: string, values: FormValues, opts: { idempotencyKey?: string } = {}) {
  const body = JSON.stringify({ slug, values });
  const key = opts.idempotencyKey ?? submitKey(body);
  try {
    const res = await request<{ id: string; price: number; status: JobStatus }>("/api/generations", {
      method: "POST",
      body,
      headers: { "Idempotency-Key": key },
      timeoutMs: 60_000,
    });
    settleSubmitKey(key, "done");
    return res;
  } catch (e) {
    settleSubmitKey(key, submitOutcome(e));
    if (e instanceof ApiError && e.status === 429) {
      throw new ApiError(withRetryHint(e.message, e.retryAfterSec), 429, e.data);
    }
    if (e instanceof ApiError && e.data.timeout === true) {
      throw new ApiError(
        "Server javob bermadi. Qayta yuborishdan oldin «Mening fayllarim» ni tekshiring — ish navbatga qo'yilgan bo'lishi mumkin.",
        0,
        e.data,
      );
    }
    throw e;
  }
}

/* ─────────────── Idempotency-Key: bitta niyat — bitta kalit (C34) ─────────────── */

/** Muvaffaqiyatdan keyin shu vaqt ichidagi AYNAN shu forma — o'sha niyat (sahifa o'tishi paytidagi ikkinchi bosish). */
export const SUBMIT_KEY_AFTER_SUCCESS_MS = 30_000;
/** Javobi yo'qolgan yuborishdan keyingi qayta urinish shu vaqt ichida o'sha kalitni oladi. */
export const SUBMIT_KEY_AFTER_UNSURE_MS = 10 * 60_000;

/** Oxirgi yuborish niyati: so'rov tanasi (vosita + qiymatlar), kalit va natija. */
let lastSubmit: { body: string; key: string; state: "pending" | "done" | "unsure"; at: number } | null = null;

function uuidV4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  // `randomUUID` faqat xavfsiz kontekstda (https/localhost) — aks holda qo'lda v4.
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Shu yuborish uchun kalit.
 *
 * Xuddi shu tana (vosita + forma qiymatlari) javobi aniq bo'lmagan
 * urinishdan keyin ({@link SUBMIT_KEY_AFTER_UNSURE_MS}) yoki endigina
 * muvaffaqiyatdan keyin ({@link SUBMIT_KEY_AFTER_SUCCESS_MS}) yuborilsa —
 * o'sha kalit (bitta niyatning takrori). Boshqa forma, aniq rad
 * (4xx — hech narsa yaratilmagan) yoki muddat o'tgan — yangi kalit.
 */
function submitKey(body: string): string {
  const now = Date.now();
  const last = lastSubmit;
  const reuse =
    last !== null &&
    last.body === body &&
    (last.state === "pending" ||
      (last.state === "unsure" && now - last.at < SUBMIT_KEY_AFTER_UNSURE_MS) ||
      (last.state === "done" && now - last.at < SUBMIT_KEY_AFTER_SUCCESS_MS));
  const key = reuse ? last.key : uuidV4();
  lastSubmit = { body, key, state: "pending", at: now };
  return key;
}

function settleSubmitKey(key: string, state: "done" | "unsure" | "rejected") {
  if (lastSubmit?.key !== key) return;
  if (state === "rejected") lastSubmit = null;
  else lastSubmit = { ...lastSubmit, state, at: Date.now() };
}

/**
 * Javob ish yaratilmaganini ANIQ aytadimi. Tarmoq/vaqt tugashi (0), 408,
 * 5xx — so'rov serverga yetib, pul yechilgan bo'lishi mumkin (`unsure`).
 * Qolgan 4xx (400/402/403/409/413/422/429…) — server rad etgan (`rejected`).
 */
function submitOutcome(e: unknown): "unsure" | "rejected" {
  if (!(e instanceof ApiError)) return "unsure";
  if (e.status === 0 || e.status === 408 || e.status >= 500) return "unsure";
  return "rejected";
}

export function deleteGeneration(id: string) {
  // O'chirilgan ishning kaliti qayta ishlatilmasin: keyingi yuborish — yangi niyat.
  lastSubmit = null;
  return request<{ ok: boolean; refunded: boolean }>(`/api/generations/${id}`, { method: "DELETE" });
}

/**
 * Fayl kartasi eskizi (DOCX/PPTX 1-sahifa JPEG) — `lib/server/thumb.ts`.
 *
 * `?v=<fileVersion>` bilan (W2-B): marshrut faqat shunda keshlanadi, tahrir
 * (yangi `fileVersion`) esa keshni o'zi eskirtiradi — eski eskiz qolmaydi.
 */
export function thumbUrl(id: string, fileVersion?: number) {
  return `/api/generations/${id}/thumb${typeof fileVersion === "number" ? `?v=${fileVersion}` : ""}`;
}

/**
 * Fayl manzili. `inline` — brauzer ichida ko'rsatish (iframe, yangi oyna):
 * server `Content-Disposition: inline` beradi; aks holda yuklab olish.
 */
export function fileUrl(id: string, format?: "pdf", opts: { inline?: boolean } = {}) {
  const q = [format ? `format=${format}` : "", opts.inline ? "inline=1" : ""].filter(Boolean).join("&");
  return `/api/generations/${id}/file${q ? `?${q}` : ""}`;
}

/**
 * Faylni yuklab oladi.
 *
 * `<a download>` to'g'ridan-to'g'ri ishlatilmaydi: xato bo'lsa brauzer
 * jimgina JSON xato sahifasini `.docx` nomi bilan saqlab qo'yardi.
 */
export async function downloadGeneration(
  id: string,
  format?: "pdf",
  opts: { headerTimeoutMs?: number } = {},
): Promise<void> {
  /*
   * PDF LibreOffice da o'giriladi (≤90 s) va band bo'lsa bo'sh slotni
   * kutadi — shuning uchun chegara uzun; baribir CHEKSIZ emas (FE-14).
   */
  const link = linkedSignal(opts.headerTimeoutMs ?? (format === "pdf" ? 180_000 : 120_000));
  try {
    let res: Response;
    try {
      res = await fetch(fileUrl(id, format), { credentials: "same-origin", signal: link.signal });
    } catch {
      throw new ApiError(link.timedOut() ? TIMEOUT_TEXT : OFFLINE_TEXT, 0, { timeout: link.timedOut() });
    }
    /*
     * Chegara faqat SARLAVHALARGACHA (server javob berdimi). Tana esa
     * cheklanmaydi: 10–15 MB deka ~1 Mbit/s mobil aloqada 80–120 s
     * keladi — normal ketayotgan yuklash «vaqt tugadi» bilan uzilmasin
     * (review R2). Uzilgan aloqada `blob()` o'zi xato beradi.
     */
    link.done();
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      /*
       * 429 (kishi boshiga PDF chegarasi) va 503 (hamma PDF sloti band) —
       * W2-A shartnomasi: o'zbekcha matn `{error}` da, `Retry-After`
       * sarlavhada. Matn va «qachon qayta urinish» birga ko'rsatiladi.
       */
      const header = positiveSec(res.headers.get("retry-after"));
      const withRetry = header && data.retryAfterSec == null ? { ...data, retryAfterSec: header } : data;
      const base = typeof data.error === "string" && data.error ? data.error : "Fayl yuklab olinmadi";
      throw new ApiError(withRetryHint(base, retrySecOf(withRetry)), res.status, withRetry);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
    const name = match ? decodeURIComponent(match[1]) : "hujjat";

    let blob: Blob;
    try {
      blob = await res.blob();
    } catch {
      throw new ApiError(OFFLINE_TEXT, 0);
    }
    saveBlob(blob, name);
  } finally {
    link.done();
  }
}

function saveBlob(blob: Blob, name: string) {
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

/** Polling UI ga aytadigan holat (C20): uzilish yoki odatdan uzoq kutish. */
export type PollIssue =
  | { kind: "retrying"; message: string; attempt: number }
  | { kind: "slow"; message: string };

/** Sahifa ochilgandan shuncha vaqt o'tsa polling SEKINLASHADI (to'xtamaydi). */
export const POLL_SLOW_AFTER_MS = 20 * 60_000;
/** Sekin rejimdagi oraliq — navbatda kutayotgan yuzlab yorliq serverni bosmasin. */
export const POLL_SLOW_DELAY_MS = 30_000;
/** Uzilishda qayta urinishlar oralig'ining yuqori chegarasi. */
const RETRY_CAP_MS = 30_000;
/** Server `Retry-After` i bundan uzun bo'lsa ham — shu qadar kutiladi. */
const RETRY_AFTER_CAP_MS = 5 * 60_000;

const SLOW_ISSUE: PollIssue = {
  kind: "slow",
  message:
    "Ish odatdagidan uzoq davom etmoqda (navbat katta). Holat har 30 soniyada tekshiriladi — sahifani yopsangiz ham ish davom etadi.",
};

/**
 * Vaqtinchalik xatomi (qayta urinsa bo'ladi): tarmoq/vaqt tugashi (0),
 * 408/425/429 va 5xx (deploy paytidagi 502, OOM qayta ishga tushish).
 * 404/400/403 — yo'q: hujjat o'chirilgan yoki so'rov noto'g'ri.
 */
function isTransient(e: unknown): e is ApiError {
  return (
    e instanceof ApiError &&
    (e.status === 0 || e.status === 408 || e.status === 425 || e.status === 429 || e.status >= 500)
  );
}

/**
 * Keyingi so'rov navbatini kutadi.
 *
 * Yorliq YASHIRIN bo'lsa taymer tugagach ham so'rov ketmaydi — yorliq
 * ko'rinishini kutadi; yorliq ko'ringan yoki internet qaytgan zahoti esa
 * taymerni kutmasdan darhol so'raladi (FE-12). Brauzersiz muhitda
 * (`document` yo'q) — oddiy taymer.
 */
export function waitTurn(ms: number, signal?: AbortSignal, opts: { early?: boolean } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const doc = typeof document !== "undefined" ? document : null;
    const win = typeof window !== "undefined" ? window : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // `early: false` — server `Retry-After` i: yorliqni almashtirish uni qisqartirmasin.
    const early = opts.early !== false;
    let elapsed = false;
    let settled = false;
    const finish = (err?: DOMException) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      doc?.removeEventListener("visibilitychange", onVisible);
      win?.removeEventListener("online", onVisible);
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => finish(abortError());
    const onVisible = () => {
      if (!doc?.hidden && (early || elapsed)) finish();
    };
    doc?.addEventListener("visibilitychange", onVisible);
    win?.addEventListener("online", onVisible);
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      timer = null;
      elapsed = true;
      // Yashirin yorliq — `visibilitychange` gacha kutamiz.
      if (!doc?.hidden) finish();
    }, ms);
  });
}

/**
 * Ish tugaguncha holatni so'rab turadi.
 *
 * Interval o'sib boradi (1s → 5s): uzoq kurs ishi uchun serverni har
 * soniyada bezovta qilmaydi.
 *
 * HECH QACHON «jim» taslim bo'lmaydi (C20). Ilgari 20 daqiqada, ~30 s
 * lik uzilishda yoki istalgan 4xx da xato otib to'xtardi, natija sahifasi
 * esa buni ko'rsatmay qotib qolardi. Endi:
 *   • 20 daqiqadan keyin — to'xtamaydi, har 30 s da so'raydi va bir marta
 *     `onIssue({kind:"slow"})` beradi (UI tushuntiradi);
 *   • tarmoq/vaqt tugashi/429/5xx — cheksiz qayta urinadi, oraliq ≤30 s
 *     (`Retry-After` hurmat qilinadi), ikkinchi ketma-ket xatodan boshlab
 *     `onIssue({kind:"retrying"})`, tiklanganda `onIssue(null)`;
 *   • faqat 404/400/403/401 da xato otadi — UI uni «Qayta tekshirish»
 *     tugmasi bilan ko'rsatadi;
 *   • yorliq yashirin bo'lsa so'ramaydi, ko'ringanda darhol so'raydi;
 *   • `signal` ketayotgan so'rovni ham bekor qiladi.
 * Navbatda qolib ketgan ish baribir tugaydi: server eskirgan QUEUED ni
 * FAILED qiladi (W2-D2 `queue-ttl`), polling esa yakuniy holatda to'xtaydi.
 */
export async function pollGeneration(
  id: string,
  onTick: (g: GenerationDetail) => void,
  signal?: AbortSignal,
  onIssue?: (issue: PollIssue | null) => void,
): Promise<GenerationDetail> {
  let delay = 1000;
  const slowAt = Date.now() + POLL_SLOW_AFTER_MS;
  let slow = false;
  let failures = 0;
  let prev: GenerationDetail | null = null;

  for (;;) {
    if (signal?.aborted) throw abortError();

    let generation: GenerationDetail;
    try {
      const since = prev?.live != null ? prev.liveSeq : undefined;
      generation = (await getGeneration(id, since, signal)).generation;
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (!isTransient(e)) throw e;
      failures++;
      // ±20 % tasodif: deploydagi 502 dan keyin hamma ochiq yorliq bir lahzada urilmasin.
      const backoff = Math.min(RETRY_CAP_MS, 2000 * failures * (0.8 + Math.random() * 0.4));
      const serverWait = Math.min(RETRY_AFTER_CAP_MS, (e.retryAfterSec ?? 0) * 1000);
      const wait = Math.max(backoff, serverWait);
      // Birinchi xato ko'pincha bir lahzalik — ikkinchisidan boshlab aytamiz.
      if (failures >= 2) {
        onIssue?.({
          kind: "retrying",
          message: `Aloqa yo'q yoki server band — holat ${retryAfterText(Math.ceil(wait / 1000))} qayta tekshiriladi.`,
          attempt: failures,
        });
      }
      // Server `Retry-After` i hal qilgan kutish yorliq almashtirish bilan qisqarmaydi.
      await waitTurn(wait, signal, { early: serverWait <= backoff });
      continue;
    }
    if (failures >= 2) onIssue?.(slow ? SLOW_ISSUE : null);
    failures = 0;

    const merged = mergeLive(prev, generation);
    prev = merged;
    onTick(merged);
    if (merged.status !== "QUEUED" && merged.status !== "IN_PROGRESS") return merged;

    if (!slow && Date.now() >= slowAt) {
      slow = true;
      onIssue?.(SLOW_ISSUE);
    }
    // Jonli deka (IN_PROGRESS + live) sekinlashmaydi — u haqiqatan ishlayapti.
    const live = merged.status === "IN_PROGRESS" && Boolean(merged.live);
    await waitTurn(slow && !live ? Math.max(POLL_SLOW_DELAY_MS, delay) : delay, signal);
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
    timeoutMs: 90_000,
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
    return await request<TemplateUploadResponse>("/api/uploads/template", { method: "POST", body: form, timeoutMs: 150_000 });
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

/* ─────────────────────── Maqola: UDK taklifi (AUDIT-18) ─────────────────────── */

export type UdkSuggestion = { udk: string; label: string; note: string };

/**
 * UDK taklifi (`ArticleComposer` «Taklif» tugmasi): `POST /api/article/udk`
 * `{topic, language}` → `{udk, label, note}`. Bu TAKLIF — `note` doim
 * «tekshiring» deydi; forma uni maydonga qo'yadi, foydalanuvchi tasdiqlaydi.
 */
export function suggestUdk(topic: string, language: string) {
  return request<UdkSuggestion>("/api/article/udk", { method: "POST", body: JSON.stringify({ topic, language }), timeoutMs: 60_000 });
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
      timeoutMs: 90_000,
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
      timeoutMs: 60_000,
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
 * Rezyume surati (Rezyume 2): kesilgan nusxa + ixtiyoriy asl + kesish
 * ma'lumoti. Server shartnomasi — `POST /api/uploads/photo`.
 *
 * Xato matnlari status bo'yicha shu yerda belgilanadi (`uploadLogo`
 * izohiga qarang): klient serverning aniq so'z tanlashiga qaram
 * bo'lmasligi kerak.
 */
export async function uploadResumePhoto(input: {
  blob: Blob;
  original?: File | null;
  crop?: { x: number; y: number; zoom: number };
  shape: "circle" | "square";
}): Promise<{ assetId: string; mime: string; size: number; shape: "circle" | "square"; originalAssetId?: string }> {
  const form = new FormData();
  form.append("file", input.blob, input.shape === "circle" ? "photo.png" : "photo.jpg");
  if (input.original) form.append("original", input.original);
  if (input.crop) form.append("crop", JSON.stringify(input.crop));
  form.append("shape", input.shape);
  try {
    return await request("/api/uploads/photo", { method: "POST", body: form, timeoutMs: 60_000 });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 413) throw new ApiError("Surat 5 MB dan katta", e.status, e.data);
      if (e.status === 415) throw new ApiError("Faqat PNG yoki JPEG", e.status, e.data);
      if (e.status === 422) throw new ApiError("Surat juda katta — kichikroq faylni tanlang", e.status, e.data);
      if (e.status === 429) throw new ApiError("Juda ko‘p urinish", e.status, e.data);
    }
    throw e;
  }
}

/** Yuklangan suratning manzili — forma qayta ochilganda ko'rsatish uchun. */
export function photoUrl(assetId: string): string {
  return `/api/uploads/photo/${assetId}`;
}

/**
 * Umumiy forma qoralamasi (Maqola 2 / AUDIT-17, WP4) — `useFormDraft(toolId)`.
 *
 * Ilgari faqat rezyume uchun bor edi (`/api/resume/draft`); endi har
 * vosita `/api/forms/{toolId}/draft` orqali xuddi shu jadvaldan
 * (`form_drafts`) o'qiydi/yozadi — server tomoni `lib/server/form-draft.ts`.
 */
export function getDraft(toolId: string) {
  return request<{ draft: { data: FormValues; updatedAt: string } | null }>(`/api/forms/${toolId}/draft`);
}
export function putDraft(toolId: string, data: FormValues) {
  return request<{ updatedAt: string }>(`/api/forms/${toolId}/draft`, { method: "PUT", body: JSON.stringify({ data }) });
}
export function clearDraft(toolId: string) {
  return request<{ ok: true }>(`/api/forms/${toolId}/draft`, { method: "DELETE" });
}

/**
 * O'quv dasturi bazasi (AUDIT-20 WP-E) — `CurriculumPicker` (test
 * darslik rejimi, dars rejasi/xarita ixtiyoriy mavzu tanlovi).
 *
 * Indeks (fan × sinf) `lib/curriculum.ts curriculumIndex()` dan KLIENT
 * o'zi o'qiydi (statik `index.json`, ~5 KB) — tarmoqsiz. Mavzular esa
 * fan faylining o'zi (≈1–1,5 MB) klient bandliga kirmasligi uchun shu
 * yerdan, `/api/curriculum?subject=&grade=`.
 */
export type CurriculumTopicsResponse = {
  subject: string;
  grade: number;
  source: { title: string; url: string; year?: number; publisher?: string };
  units: { title: string; hours?: number; quarter?: number; topics: { id: string; title: string }[] }[];
};
export function fetchCurriculumTopics(subjectId: string, grade: number) {
  return request<CurriculumTopicsResponse>(`/api/curriculum?subject=${encodeURIComponent(subjectId)}&grade=${grade}`);
}

/**
 * Eski rezyumega xos nomlar — orqaga moslik uchun qoladi (ichkarida
 * generik funksiyalarni chaqiradi, ikkinchi fetch o'ramini takrorlamaydi).
 * Hech kim import qilmasa ham, tashqi/eski kod ular bilan ishlashda
 * davom etadi.
 */
export function fetchResumeDraft() {
  return getDraft("resume");
}
export function saveResumeDraft(data: FormValues) {
  return putDraft("resume", data);
}
export function clearResumeDraft() {
  return clearDraft("resume");
}

/**
 * Ish rejasini oldindan olish. Bepul va kredit yechmaydi —
 * `app/api/outline/route.ts` izohiga qarang.
 */
export async function draftOutline(slug: string, values: FormValues) {
  return request<{ text: string }>("/api/outline", {
    method: "POST",
    body: JSON.stringify({ slug, values }),
    // LLM chaqiruvi (qayta urinish bilan 2 tagacha) — standart 30 s kam.
    timeoutMs: 90_000,
  });
}

export type { ToolId };
