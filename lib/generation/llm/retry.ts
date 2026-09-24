/**
 * Qayta urinish yordamchilari — audit C28 (EXT-13).
 *
 *  - `backoffMs` — TO'LIQ jitter (`random · base · 2ⁿ`): parallel
 *    yo'laklar umumiy 429 dan keyin bir paytda qayta urilmasin
 *    (qat'iy 500 ms/1 s kutishda hammasi bir lahzada qaytib kelardi);
 *  - `parseRetryAfter` — `Retry-After` sarlavhasi (soniya yoki HTTP-sana);
 *  - `geminiRetryDelayMs` — Gemini kutish vaqtini SARLAVHADA emas,
 *    JSON tanasida beradi: `error.details[]` ichidagi
 *    `google.rpc.RetryInfo.retryDelay` ("34s"). Ilgari u o'qilmasdi va
 *    daqiqalik kvota 0.5 s dan keyin qayta urilardi — aniq yiqilish.
 */

export function backoffMs(attempt: number, baseMs: number, random: () => number = Math.random): number {
  const cap = baseMs * 2 ** Math.max(0, attempt);
  return Math.floor(Math.min(0.999_999, Math.max(0, random())) * cap);
}

/**
 * TENG jitter (`cap/2 + random · cap/2`) — tarmoq uzilishi uchun: kutish
 * kamida yarim asos, aks holda to'liq jitter uch urinishni ~2 s ichida
 * yeb qo'yishi mumkin edi (AUDIT-19 smoke saboqi, review nit 1).
 */
export function equalJitterMs(attempt: number, baseMs: number, random: () => number = Math.random): number {
  const cap = baseMs * 2 ** Math.max(0, attempt);
  return Math.floor(cap / 2) + backoffMs(attempt, baseMs / 2, random);
}

export function parseRetryAfter(raw: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!raw) return undefined;
  const secs = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** `"34s"` / `"1.5s"` (protobuf Duration JSON) → ms. */
export function geminiRetryDelayMs(body: unknown): number | undefined {
  const details = (body as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    const rec = d as { "@type"?: unknown; retryDelay?: unknown };
    if (typeof rec?.["@type"] !== "string" || !rec["@type"].endsWith("google.rpc.RetryInfo")) continue;
    const m = typeof rec.retryDelay === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(rec.retryDelay.trim()) : null;
    if (m) return Math.round(Number(m[1]) * 1000);
  }
  return undefined;
}
