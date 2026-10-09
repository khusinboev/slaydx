import "server-only";
import { createHash } from "node:crypto";
import { env } from "./env";
import { log } from "./log";

/**
 * Click Merchant API client (docs.click.uz > Merchant API > Requests).
 *
 * Base `https://api.click.uz/v2/merchant`, JSON in / JSON out, every request
 * carries `Auth: <merchant_user_id>:<sha1(timestamp + secret_key)>:<timestamp>`
 * (10-digit unix seconds). Used ONLY to START a payment (invoice to the Click
 * app by phone, one-time card token + SMS confirmation, payment by token).
 * Money is credited exclusively by our Shop API `Complete` (`settleOrder`);
 * nothing in this file touches a balance.
 *
 * Sensitive data rule (owner decision 2026-10-09, one-time tokens only):
 *   - the card number, its expiry and the SMS code exist only in the argument
 *     objects of the functions below and in the outgoing request body. They are
 *     NEVER logged, put into an Error message, returned, or stored;
 *   - the ONLY things this module logs are: stage, order id, chosen method,
 *     HTTP status, Click `error_code` (+ a short `error_note`, which goes
 *     through `log()` redaction and is never built from a request body).
 *
 * Errors: every failure is a `ClickMerchantError` with a short Uzbek
 * `userMessage` that is safe to show to the user. Click does not publish a
 * Merchant API `error_code` table (its "Errors" page lists HTTP statuses only;
 * the public code table, -1..-9, belongs to the Shop API), so the mapping is:
 * (1) that documented table, (2) a few keyword rules on `error_note` for the
 * cases users can act on (balance, expiry, SMS, card not found), (3) a
 * per-stage generic message; unknown codes are logged (`warn`) with the code
 * and the note so the table can be completed from real traffic.
 */

export const CLICK_MERCHANT_BASE = "https://api.click.uz/v2/merchant";
export const CLICK_TIMEOUT_MS = 15_000;

export type ClickStage =
  | "card_request"
  | "card_verify"
  | "card_payment"
  | "invoice_create"
  | "invoice_status"
  | "payment_status";

/** What the caller may do next: `declined` = Click said no (definite); `unavailable` = no usable answer; `config` = our credentials. */
export type ClickFailure = "declined" | "unavailable" | "config" | "unknown";

export class ClickMerchantError extends Error {
  constructor(
    readonly stage: ClickStage,
    readonly failure: ClickFailure,
    /** Short Uzbek text, safe to show to the end user. */
    readonly userMessage: string,
    readonly errorCode: number | null = null,
    /**
     * The request may have reached Click and succeeded (timeout, connection reset, 5xx): for a
     * payment the user must not be told "failed" -- the Shop API Complete may still arrive.
     */
    readonly outcomeUnknown = false,
  ) {
    // Deliberately free of any request/response content.
    super(`click ${stage}: ${failure}${errorCode === null ? "" : ` (error_code ${errorCode})`}`);
    this.name = "ClickMerchantError";
  }
}

export type ClickCtx = {
  /** Our payment order id (log correlation). */
  orderId?: string;
  /** `card` | `phone` | `app` | `page` -- the user's chosen method (log correlation). */
  method?: string;
};

// ────────────────────────────────────────── auth

/** True when the Merchant API credentials are set (the Shop API alone needs only service / merchant id + secret). */
export function clickMerchantConfigured(): boolean {
  return Boolean(env.click.serviceId && env.click.secretKey && env.click.merchantUserId);
}

/** `sha1(timestamp + secret_key)` as lowercase hex (docs.click.uz "Authentication"). */
export function clickAuthDigest(secretKey: string, timestamp: number | string): string {
  return createHash("sha1").update(`${timestamp}${secretKey}`).digest("hex");
}

/** `Auth` header value; `nowMs` is a test seam. The timestamp is unix SECONDS (10 digits). */
export function clickAuthHeader(merchantUserId: string, secretKey: string, nowMs: number = Date.now()): string {
  const timestamp = Math.floor(nowMs / 1000);
  return `${merchantUserId}:${clickAuthDigest(secretKey, timestamp)}:${timestamp}`;
}

// ────────────────────────────────────────── error mapping

const MSG = {
  config: "Click orqali to'lov hozircha mavjud emas. Boshqa usulni tanlang",
  unavailable: "Click javob bermadi. Birozdan keyin qayta urinib ko'ring",
  generic: "Click so'rovni qabul qilmadi. Qayta urinib ko'ring yoki boshqa usulni tanlang",
} as const;

const STAGE_FALLBACK: Record<ClickStage, string> = {
  card_request: "Karta ma'lumotlari qabul qilinmadi. Raqam va muddatni tekshiring yoki boshqa usulni tanlang",
  card_verify: "SMS kod noto'g'ri yoki eskirgan. Kodni tekshirib qayta kiriting",
  card_payment: "To'lov o'tmadi. Boshqa kartani yoki usulni tanlang",
  invoice_create: "Hisob yuborilmadi. Telefon raqamini tekshiring yoki boshqa usulni tanlang",
  invoice_status: MSG.generic,
  payment_status: MSG.generic,
};

/** The documented public table (docs.click.uz > Shop API > Errors), the only numeric table Click publishes. */
const BY_CODE: Readonly<Record<number, string>> = {
  [-1]: MSG.config, // SIGN CHECK FAILED: our Auth header / credentials were not accepted
  [-2]: "Summa noto'g'ri",
  [-4]: "Bu buyurtma allaqachon to'langan",
  [-5]: "Buyurtma topilmadi",
  [-6]: "To'lov topilmadi",
  [-9]: "To'lov bekor qilingan",
};

/** Keyword rules on Click's (English / Russian) `error_note`; first match wins. */
const NOTE_RULES: Array<{ test: RegExp; stages?: ClickStage[]; message: string }> = [
  { test: /insufficient|not enough|недостаточно|не хватает/i, message: "Kartada mablag' yetarli emas" },
  { test: /limit|лимит/i, message: "Karta limiti oshib ketgan. Boshqa karta yoki usulni tanlang" },
  { test: /expire|expired|срок/i, stages: ["card_request", "card_payment"], message: "Kartaning amal qilish muddati noto'g'ri yoki tugagan" },
  { test: /sms|otp|confirm|код|code/i, stages: ["card_verify"], message: "SMS kod noto'g'ri yoki eskirgan. Kodni tekshirib qayta kiriting" },
  { test: /(card|карт\S*).*(not found|not exist|block|invalid|не найден|не существует|заблок)|(not found|invalid|blocked).*(card|карт)/i, stages: ["card_request", "card_payment"], message: "Karta topilmadi yoki bloklangan. Boshqa karta yoki usulni tanlang" },
  { test: /phone|абонент|телефон|номер|subscriber|not found|не найден/i, stages: ["invoice_create"], message: "Bu telefon raqami Click'da topilmadi. Raqamni tekshiring" },
];

/** Maps a Click `error_code` / `error_note` to a user message (exported for the tests). */
export function clickErrorMessage(stage: ClickStage, code: number | null, note: string): { message: string; known: boolean } {
  if (code !== null && BY_CODE[code]) return { message: BY_CODE[code], known: true };
  const n = String(note ?? "");
  for (const r of NOTE_RULES) {
    if (r.stages && !r.stages.includes(stage)) continue;
    if (r.test.test(n)) return { message: r.message, known: true };
  }
  return { message: STAGE_FALLBACK[stage], known: false };
}

// ────────────────────────────────────────── transport

type Json = Record<string, unknown>;

/**
 * Removes every sensitive value of THIS request (card number, expiry, SMS code, card token) from a
 * text that came back from Click before it is logged -- belt and braces on top of `log()` redaction,
 * for the short values (expiry, SMS code) no pattern can recognise.
 */
function scrubSensitive(text: string, body?: Json): string {
  let out = text;
  for (const k of ["card_number", "expire_date", "sms_code", "card_token"]) {
    const v = body?.[k];
    if (typeof v === "string" && v.length > 0) out = out.split(v).join("[REDACTED]");
  }
  return out;
}

function isConfigCode(code: number | null): boolean {
  return code === -1;
}

async function call(
  stage: ClickStage,
  httpMethod: "GET" | "POST" | "DELETE",
  path: string,
  ctx: ClickCtx,
  body?: Json,
): Promise<Json> {
  if (!clickMerchantConfigured()) {
    throw new ClickMerchantError(stage, "config", MSG.config);
  }
  const logFields = { stage, orderId: ctx.orderId, method: ctx.method };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CLICK_TIMEOUT_MS);
  let status = 0;
  let text = "";
  try {
    const res = await globalThis.fetch(`${CLICK_MERCHANT_BASE}${path}`, {
      method: httpMethod,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Auth: clickAuthHeader(env.click.merchantUserId, env.click.secretKey),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
      cache: "no-store",
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    // Only the failure KIND is logged -- never the error object (it could echo request details).
    const timedOut = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
    log("warn", "[click-merchant] request failed", { ...logFields, reason: timedOut ? "timeout" : "network" });
    throw new ClickMerchantError(stage, "unavailable", MSG.unavailable, null, true);
  } finally {
    clearTimeout(timer);
  }

  let data: Json | null = null;
  try {
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Json;
  } catch {
    data = null;
  }

  const rawCode = data?.error_code;
  const code = typeof rawCode === "number" ? rawCode : typeof rawCode === "string" && /^-?\d+$/.test(rawCode) ? Number(rawCode) : null;

  if (status === 401 || status === 403) {
    log("error", "[click-merchant] credentials rejected", { ...logFields, httpStatus: status });
    throw new ClickMerchantError(stage, "config", MSG.config, code);
  }
  if (status >= 500) {
    log("warn", "[click-merchant] Click server error", { ...logFields, httpStatus: status });
    throw new ClickMerchantError(stage, "unavailable", MSG.unavailable, code, true);
  }
  if (!data || code === null) {
    log("warn", "[click-merchant] unreadable answer", { ...logFields, httpStatus: status });
    throw new ClickMerchantError(stage, "unknown", STAGE_FALLBACK[stage], null, status >= 200 && status < 300);
  }
  if (code !== 0) {
    const note = scrubSensitive(typeof data.error_note === "string" ? data.error_note.slice(0, 160) : "", body);
    const mapped = clickErrorMessage(stage, code, note);
    if (isConfigCode(code)) {
      log("error", "[click-merchant] credentials rejected", { ...logFields, httpStatus: status, errorCode: code });
    } else {
      log("info", "[click-merchant] declined", {
        ...logFields,
        httpStatus: status,
        errorCode: code,
        // Unknown codes carry the note so the table can be completed from real traffic.
        ...(mapped.known ? {} : { errorNote: note }),
      });
    }
    throw new ClickMerchantError(stage, isConfigCode(code) ? "config" : mapped.known ? "declined" : "unknown", mapped.message, code);
  }
  log("info", "[click-merchant] ok", { ...logFields, httpStatus: status, errorCode: 0 });
  return data;
}

// ────────────────────────────────────────── typed calls

const serviceId = (): number => Number(env.click.serviceId);

function idOf(stage: ClickStage, v: unknown): string {
  const s = typeof v === "number" || typeof v === "string" ? String(v) : "";
  if (!/^\d{1,19}$/.test(s)) throw new ClickMerchantError(stage, "unknown", STAGE_FALLBACK[stage], null, true);
  return s;
}

/** `POST /card_token/request` -- Click texts a code to the card owner's phone. One-time token (`temporary: 1`). */
export async function requestCardToken(
  input: { cardNumber: string; expireDate: string },
  ctx: ClickCtx = {},
): Promise<{ cardToken: string; phoneMasked: string }> {
  const d = await call("card_request", "POST", "/card_token/request", ctx, {
    service_id: serviceId(),
    card_number: input.cardNumber,
    expire_date: input.expireDate,
    temporary: 1,
  });
  const token = typeof d.card_token === "string" ? d.card_token : "";
  if (!token) throw new ClickMerchantError("card_request", "unknown", STAGE_FALLBACK.card_request, null, false);
  return { cardToken: token, phoneMasked: typeof d.phone_number === "string" ? d.phone_number : "" };
}

/** `POST /card_token/verify` -- confirms the SMS code; returns the MASKED card number only. */
export async function verifyCardToken(
  input: { cardToken: string; smsCode: string },
  ctx: ClickCtx = {},
): Promise<{ cardMasked: string }> {
  const d = await call("card_verify", "POST", "/card_token/verify", ctx, {
    service_id: serviceId(),
    card_token: input.cardToken,
    sms_code: input.smsCode,
  });
  return { cardMasked: typeof d.card_number === "string" ? d.card_number : "" };
}

/** Click `payment_status`: < 0 error, 0 created, 1 processing, 2 paid (docs.click.uz "Status Field Values"). */
export type ClickPaymentStatus = number;

/** `POST /card_token/payment` -- charges the verified token; `transaction_parameter` = our order id. */
export async function payWithCardToken(
  input: { cardToken: string; amountSoum: number; orderId: string },
  ctx: ClickCtx = {},
): Promise<{ paymentId: string; paymentStatus: ClickPaymentStatus }> {
  const d = await call("card_payment", "POST", "/card_token/payment", ctx, {
    service_id: serviceId(),
    card_token: input.cardToken,
    amount: input.amountSoum,
    transaction_parameter: input.orderId,
  });
  const paymentStatus = typeof d.payment_status === "number" ? d.payment_status : Number(d.payment_status);
  if (Number.isFinite(paymentStatus) && paymentStatus < 0) {
    log("info", "[click-merchant] payment declined", { stage: "card_payment", orderId: ctx.orderId, method: ctx.method, paymentStatus });
    throw new ClickMerchantError("card_payment", "declined", STAGE_FALLBACK.card_payment, paymentStatus);
  }
  return { paymentId: idOf("card_payment", d.payment_id), paymentStatus: Number.isFinite(paymentStatus) ? paymentStatus : 1 };
}

/** `POST /invoice/create` -- sends an invoice to the Click app of `phone` (`998XXXXXXXXX`). */
export async function createInvoice(
  input: { phone: string; amountSoum: number; orderId: string },
  ctx: ClickCtx = {},
): Promise<{ invoiceId: string }> {
  const d = await call("invoice_create", "POST", "/invoice/create", ctx, {
    service_id: serviceId(),
    amount: input.amountSoum,
    phone_number: input.phone,
    merchant_trans_id: input.orderId,
  });
  return { invoiceId: idOf("invoice_create", d.invoice_id) };
}

/** `GET /invoice/status/:service_id/:invoice_id`. */
export async function invoiceStatus(
  invoiceId: string,
  ctx: ClickCtx = {},
): Promise<{ invoiceStatus: number; note: string }> {
  const id = idOf("invoice_status", invoiceId);
  const d = await call("invoice_status", "GET", `/invoice/status/${serviceId()}/${id}`, ctx);
  return { invoiceStatus: Number(d.invoice_status), note: typeof d.invoice_status_note === "string" ? d.invoice_status_note : "" };
}

/** `GET /payment/status/:service_id/:payment_id`. */
export async function paymentStatus(paymentId: string, ctx: ClickCtx = {}): Promise<{ paymentStatus: ClickPaymentStatus }> {
  const id = idOf("payment_status", paymentId);
  const d = await call("payment_status", "GET", `/payment/status/${serviceId()}/${id}`, ctx);
  return { paymentStatus: Number(d.payment_status) };
}

/** `GET /payment/status_by_mti/:service_id/:merchant_trans_id/YYYY-MM-DD` (merchant_trans_id = our order id). */
export async function paymentStatusByOrder(
  orderId: string,
  date: string,
  ctx: ClickCtx = {},
): Promise<{ paymentId: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ClickMerchantError("payment_status", "unknown", MSG.generic);
  }
  const d = await call("payment_status", "GET", `/payment/status_by_mti/${serviceId()}/${orderId}/${date}`, { ...ctx, orderId }, undefined);
  return { paymentId: idOf("payment_status", d.payment_id) };
}
