import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tuzilmali jurnal (AUDIT prod-readiness C31: OBS-02, OBS-03, EXT-12).
 *
 * Ilgari ~300 ta `console.*` erkin matn yozardi: `[worker] job X failed: msg`
 * — stack yo'q, so'rov id si yo'q, foydalanuvchi id si yo'q. «Foydalanuvchi
 * soat 14:00 da to'ladi, hech narsa olmadi» degan savolga javob topish uchun
 * `docker compose logs` ni qo'lda varaqlash kerak edi.
 *
 * Endi pul va navbat yo'llari shu funksiya orqali yozadi: har chaqiruv
 * AYNAN BITTA JSON qator (`jq`/`grep` bilan o'qiladi):
 *
 *   {"ts","level","msg","reqId?","jobId?","userId?","genId?","provider?","err?":{"message","stack"}, ...}
 *
 * Qoidalar:
 *   • HECH QACHON xato tashlamaydi — jurnal yiqilishi pul yo'lini yiqitmasin;
 *   • aniq sirlarni yashiradi (kalit, token, `?key=`, `Authorization`,
 *     telefon raqami → oxirgi 2 raqam) — provayder xato tanasida kalit
 *     qaytishi mumkin (Google: «Consumer 'api_key:AIza…' has been suspended»);
 *   • `withLogContext` ichida (route `handler()`, worker ishi) `reqId`/
 *     `jobId`/`userId` har qatorga o'zi qo'shiladi — ichki modullar
 *     (`credits.ts`, `jobs.ts`) ularni argument sifatida olishi shart emas.
 *
 * Faqat Node runtime (`node:async_hooks`): `instrumentation.ts` uni
 * `NEXT_RUNTIME === "nodejs"` da dinamik import qiladi.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  reqId?: string;
  jobId?: string;
  userId?: string;
  genId?: string;
  provider?: string;
};

export type LogFields = LogContext & { err?: unknown; [key: string]: unknown };

const store = new AsyncLocalStorage<LogContext>();

/** `fn` ichidagi (asinxron davomi bilan) har `log()` shu kontekstni oladi. */
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = store.getStore();
  return store.run({ ...parent, ...ctx }, fn);
}

/** Joriy kontekstga maydon qo'shadi (masalan `requireUser` → `userId`). Kontekst yo'q bo'lsa — hech narsa. */
export function addLogContext(ctx: LogContext): void {
  const cur = store.getStore();
  if (cur) Object.assign(cur, ctx);
}

export function currentLogContext(): LogContext {
  return { ...store.getStore() };
}

// ─────────────────────────────── redaksiya

const REDACTED = "[REDACTED]";

/**
 * Qiymati umuman yozilmaydigan maydon nomlari (`payment-events.ts`
 * `SECRET_KEY` bilan bir oila; bu yerda `key` ichida kelganlari ham —
 * `apiKey`, `x-api-key`, `secretKey`).
 */
const SECRET_FIELD = /^(authorization|cookie|set-cookie|password|passwd|secret|token|sign_string|sign|signature|key)$|(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|bot[_-]?token)$/i;

/** Matn ichidagi sir shakllari — tartib muhim (avval aniqroq). */
const TEXT_RULES: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  // `Authorization: Bearer xxx`, `Basic xxx`, `Bearer xxx` — qiymat yashiriladi, sxema qoladi.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, (_m, scheme: string) => `${scheme} ${REDACTED}`],
  // URL/forma parametrlari: `?key=…`, `&api_key=…`, `token=…`, `sign_string=…`.
  [
    /([?&;\s]|^)((?:api[_-]?)?key|access_token|token|secret|sign_string|password|signature)=([^&\s"'#]+)/gi,
    (_m, pre: string, name: string) => `${pre}${name}=${REDACTED}`,
  ],
  // Google API kaliti (`AIza` + 35), Anthropic/OpenRouter/OpenAI (`sk-…`), xAI (`xai-…`).
  [/AIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bxai-[A-Za-z0-9_-]{8,}/g, REDACTED],
  // Telegram bot tokeni: `123456789:AA…` (35 belgi).
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, REDACTED],
  // O'zbekiston raqami (+998 XX XXX XX XX, bo'shliq/tire bilan yoki yopishiq) — oxirgi 2 raqam qoladi.
  [/(?<![\w-])\+?998[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?(\d{2})(?![\w-])/g, (_m, last: string) => `***${last}`],
  // Boshqa xalqaro raqam — faqat `+` bilan (aks holda vaqt belgisi/summa buzilardi).
  [/(?<![\w-])\+\d(?:[\s-]?\d){7,13}(?![\w-])/g, (m) => `***${m.replace(/\D/g, "").slice(-2)}`],
];

/** Matndagi sirlarni yashiradi. Sof funksiya — test va boshqa modullar ham ishlatadi. */
export function redact(text: string): string {
  let out = String(text);
  for (const [re, rep] of TEXT_RULES) {
    out = out.replace(re, rep as never);
  }
  return out;
}

const MAX_STRING = 4_000;
const MAX_DEPTH = 5;
const MAX_KEYS = 50;

function clip(s: string): string {
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[+${s.length - MAX_STRING}]` : s;
}

/** Xato obyektini `{message, stack, name?, code?}` ga aylantiradi (redaksiya bilan). */
export function serializeError(e: unknown): { message: string; stack?: string; name?: string; code?: string } {
  if (e instanceof Error) {
    const out: { message: string; stack?: string; name?: string; code?: string } = {
      message: clip(redact(e.message)),
    };
    if (e.stack) out.stack = clip(redact(e.stack));
    if (e.name && e.name !== "Error") out.name = e.name;
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") out.code = String(code);
    return out;
  }
  return { message: clip(redact(safeString(e))) };
}

function safeString(v: unknown): string {
  try {
    if (typeof v === "string") return v;
    if (v === undefined) return "undefined";
    const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    return s ?? String(v);
  } catch {
    // Aylanma yoki getter xatosi — oddiy `String` yetarli (jurnal buzilmasin).
    try {
      return String(v);
    } catch {
      return "[unprintable]";
    }
  }
}

/** Maydon qiymatini JSON-xavfsiz va redaksiya qilingan ko'rinishga keltiradi. */
function sanitize(v: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return clip(redact(v));
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "function" || typeof v === "symbol") return undefined;
  if (v instanceof Error) return serializeError(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v !== "object") return safeString(v);
  if (seen.has(v)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[depth]";
  seen.add(v);
  if (Array.isArray(v)) return v.slice(0, MAX_KEYS).map((x) => sanitize(x, depth + 1, seen));
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const k of Object.keys(v)) {
    if (n++ >= MAX_KEYS) break;
    let x: unknown;
    try {
      x = (v as Record<string, unknown>)[k];
    } catch {
      x = "[getter threw]";
    }
    out[k] = SECRET_FIELD.test(k) && x !== undefined && x !== null && x !== "" ? REDACTED : sanitize(x, depth + 1, seen);
  }
  return out;
}

const ORDER = ["reqId", "jobId", "userId", "genId", "provider"] as const;

/**
 * Bitta JSON qator yozadi. HECH QACHON xato tashlamaydi.
 *
 * `fields.err` — istalgan qiymat; `Error` bo'lsa `{message, stack}` (OBS-03).
 * Qolgan maydonlar (masalan `attempt`, `stage`, `orderId`) o'z nomi bilan qo'shiladi.
 */
export function log(level: LogLevel, msg: string, fields?: LogFields | null): void {
  let line: string;
  try {
    const ctx = store.getStore();
    const row: Record<string, unknown> = { ts: new Date().toISOString(), level, msg: clip(redact(String(msg ?? ""))) };
    const seen = new WeakSet<object>();
    const merged: Record<string, unknown> = { ...ctx };
    if (fields && typeof fields === "object") {
      for (const k of Object.keys(fields)) {
        let x: unknown;
        try {
          x = (fields as Record<string, unknown>)[k];
        } catch {
          x = "[getter threw]";
        }
        if (x !== undefined) merged[k] = x;
      }
    }
    for (const k of ORDER) {
      if (merged[k] !== undefined && merged[k] !== null) row[k] = sanitize(String(merged[k]), 0, seen);
    }
    for (const [k, x] of Object.entries(merged)) {
      if ((ORDER as readonly string[]).includes(k) || k === "err" || x === undefined) continue;
      if (k === "ts" || k === "level" || k === "msg") continue;
      row[k] = SECRET_FIELD.test(k) && x !== null && x !== "" ? REDACTED : sanitize(x, 0, seen);
    }
    if (merged.err !== undefined && merged.err !== null) row.err = serializeError(merged.err);
    line = JSON.stringify(row);
  } catch (e) {
    // Oxirgi to'siq: jurnal hech qachon chaqiruvchini yiqitmaydi.
    line = JSON.stringify({ ts: new Date().toISOString(), level, msg: "log serializatsiyasi yiqildi", logErr: String(e) });
  }
  try {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    // stdout yopilgan (EPIPE) — yozadigan joy yo'q, chaqiruvchi davom etadi.
  }
}
