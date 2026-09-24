import "server-only";
import { query } from "./db";

/**
 * To'lov webhook'larining xom izi (`025_payment_events.sql`, OBS-09).
 *
 * Har autentifikatsiyadan o'tgan Click/Payme so'rovi (takrorlar ham)
 * bitta qator: provayder, metod, buyurtma, provayder tranzaksiyasi,
 * tozalangan tana va bizning javob kodimiz. Nizo yoki sverkada «provayder
 * aslida nima yubordi» degan savolga shu jadval javob beradi.
 */

export type PaymentEvent = {
  provider: "click" | "payme";
  method: string;
  orderId?: string | null;
  providerTxn?: string | null;
  payload: unknown;
  /** Payme: xato kodi yoki 0 (natija). Click: javobdagi `error`. */
  responseCode: number | null;
};

/**
 * Qiymati saqlanmaydigan kalitlar: imzo, parol, kalit, token, sarlavha.
 * `sign_time` kabi zararsiz maydonlar qoladi — faqat aniq nomlar.
 */
const SECRET_KEY = /^(sign_string|sign|signature|password|passwd|secret|secret_key|key|api_key|token|access_token|authorization)$/i;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;
/** Bitta qator uchun tana chegarasi — webhook tanasi odatda < 2 KB. */
const MAX_PAYLOAD_CHARS = 16_000;
const MAX_FIELD_CHARS = 200;

/** Maxfiy maydonlarni `[REDACTED]` ga almashtiradi (rekursiv, sof). */
export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactPayload(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redactPayload(v, depth + 1);
    }
    return out;
  }
  return value;
}

function clip(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).slice(0, MAX_FIELD_CHARS);
}

/**
 * Hodisani yozadi. HECH QACHON xato tashlamaydi: to'lov allaqachon
 * qayta ishlangan, audit yozuvining yiqilishi provayderga boradigan
 * javobni buzmasligi kerak — lekin jim ham qolmaydi (log).
 */
export async function recordPaymentEvent(e: PaymentEvent): Promise<void> {
  try {
    let json = JSON.stringify(redactPayload(e.payload) ?? null);
    if (json.length > MAX_PAYLOAD_CHARS) json = JSON.stringify({ truncated: true, head: json.slice(0, MAX_PAYLOAD_CHARS) });
    await query(
      `INSERT INTO payment_events (provider, method, order_id, provider_txn, payload, response_code)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [e.provider, clip(e.method) ?? "?", clip(e.orderId), clip(e.providerTxn), json, e.responseCode],
    );
  } catch (err) {
    console.error(`[payments] ${e.provider} hodisasi yozilmadi:`, err instanceof Error ? err.message : err);
  }
}

/**
 * 1 yildan (standart) eski hodisalarni o'chiradi — worker `housekeeping`
 * uchun. Partiyalab: katta jadvalda bitta uzun DELETE qulfni cho'zmasin.
 */
export async function purgePaymentEvents(retentionDays = 365, batch = 5_000): Promise<number> {
  const days = String(Math.max(1, Math.floor(retentionDays)));
  let total = 0;
  for (;;) {
    const rows = await query(
      `DELETE FROM payment_events
        WHERE id IN (
          SELECT id FROM payment_events
           WHERE received_at < now() - ($1 || ' days')::interval
           LIMIT $2)
        RETURNING id`,
      [days, batch],
    );
    total += rows.length;
    if (rows.length < batch) return total;
  }
}
