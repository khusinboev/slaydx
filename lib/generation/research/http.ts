/**
 * OpenAlex/Crossref uchun umumiy HTTP qatlami: 10 s timeout, 2 qayta
 * urinish (429/5xx/tarmoq — eksponensial: 500 ms, 1 500 ms), `mailto`
 * odob-axloq hovuzi (Crossref «polite pool», OpenAlex ham shuni tavsiya
 * qiladi) va `User-Agent`.
 *
 * Nega alohida: ikkala manba ham bir xil siyosatni talab qiladi; ikki
 * joyda yozilsa biri 429 da retry qilib, ikkinchisi qilmasdi.
 *
 * 4xx (429 dan tashqari) QAYTA URINILMAYDI — noto'g'ri DOI/so'rov
 * ikkinchi marta ham noto'g'ri. Timeout ham: u byudjetni allaqachon
 * yeb bo'lgan (`llm.ts` bilan bir xil qaror).
 *
 * Audit C28: kutishlar to'liq jitter'li, `deadline` hurmat qilinadi, 429
 * esa host saqlagichini ochadi (quyidagi `QUOTA_*` izohi).
 */
import { breakerFor } from "../llm/breaker";
import { backoffMs, parseRetryAfter } from "../llm/retry";

export type HttpOpts = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Bosqich muddati (epoch ms, audit EXT-03). Berilsa har urinish timeout'i
   * qolgan vaqt bilan cheklanadi va vaqt `RESEARCH_MIN_ATTEMPT_MS` dan kam
   * qolsa yangi urinish boshlanmaydi.
   */
  deadline?: number;
  retries?: number;
  /** Birinchi kutish (ms); keyingisi ×3. Testda 0. */
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
};

export type HttpJson = { ok: true; status: number; json: unknown } | { ok: false; status: number; error: string };
export type HttpText = { ok: true; status: number; text: string } | { ok: false; status: number; error: string };

export const RESEARCH_TIMEOUT_MS = 10_000;
export const RESEARCH_RETRIES = 2;
/** Muddatgacha shundan kam qolsa yangi urinish boshlanmaydi. */
export const RESEARCH_MIN_ATTEMPT_MS = 1_000;
/**
 * 429 (kvota) siyosati (audit EXT-07): qisqa `Retry-After` (≤ 3 s, yoki
 * sarlavhasiz) — BITTA qayta urinish (soniyalik chegara, masalan OpenAlex
 * 10 so'rov/s); ikkinchi 429 yoki uzun `Retry-After` (kunlik kvota) — shu
 * HOST saqlagichi `Retry-After` muddatiga (5 s … 10 min, sarlavhasiz — 10 s)
 * ochiladi va u davrda so'rovlar tarmoqqa chiqmasdan `{ok:false, 429}`
 * bilan qaytadi: manba bo'sh keladi, hujjat esa baribir yoziladi.
 */
const QUOTA_RETRY_MAX_MS = 3_000;
/**
 * `Retry-After` yo'q ikkinchi 429 — ko'pincha soniyalik chegara (OpenAlex
 * 10 so'rov/s), kunlik kvota emas: 60 s butun hostni o'chirib maqolalarni
 * manbasiz qoldirardi (review nit 2). Kunlik kvota o'zi uzun `Retry-After` beradi.
 */
const QUOTA_COOLDOWN_DEFAULT_MS = 10_000;
const QUOTA_COOLDOWN_MIN_MS = 5_000;
const QUOTA_COOLDOWN_MAX_MS = 10 * 60_000;

function hostBreaker(url: string) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // URL emas — butun satr kalit bo'ladi (manba baribir bitta).
  }
  return breakerFor(`research:${host}`, { cooldownMs: QUOTA_COOLDOWN_DEFAULT_MS });
}

/** `OPENALEX_MAILTO` → `CROSSREF_MAILTO` → bo'sh (mailto qo'shilmaydi). */
export function contactMail(): string {
  return (process.env.OPENALEX_MAILTO || process.env.CROSSREF_MAILTO || "").trim();
}

export function userAgent(): string {
  const mail = contactMail();
  return mail ? `SlaydX/1.0 (mailto:${mail})` : "SlaydX/1.0";
}

function combineSignals(a: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  if (!a) return t;
  // Node 20+: `AbortSignal.any`; yo'q bo'lsa faqat timeout.
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  return typeof anyFn === "function" ? anyFn([a, t]) : t;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * GET → JSON. Muvaffaqiyatsizlikda XATO TASHLAMAYDI — `{ok:false}`:
 * manba topilmasligi maqola dvigateli uchun oddiy holat, istisno emas.
 */
/**
 * Retry sikli — javob TANASI o'qilmasdan qaytadi (`read` uni o'qiydi).
 * `getJson` va `getText` shu yagona siyosatdan foydalanadi: lex.uz HTML
 * sahifasi ham 429/5xx da xuddi OpenAlex kabi qayta so'raladi.
 */
async function request<T>(
  url: string,
  accept: string,
  opts: HttpOpts,
  read: (res: Response) => Promise<{ ok: true; status: number } & T>,
): Promise<({ ok: true; status: number } & T) | { ok: false; status: number; error: string }> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const retries = opts.retries ?? RESEARCH_RETRIES;
  const base = opts.retryBaseMs ?? 500;
  const breaker = hostBreaker(url);
  const left = () => (opts.deadline === undefined ? Number.POSITIVE_INFINITY : opts.deadline - Date.now());
  let last: { ok: false; status: number; error: string } = { ok: false, status: 0, error: "no attempt" };
  let wait = 0;
  let saw429 = false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) return { ok: false, status: 0, error: "aborted" };
    if (!breaker.allow()) return { ok: false, status: 429, error: "manba kvotasi tugagan — vaqtincha o'tkazib yuborildi" };
    if (attempt > 0) {
      // Kutish + minimal urinish muddatga sig'masa — yangi urinish yo'q.
      if (left() - wait < RESEARCH_MIN_ATTEMPT_MS) return last;
      await sleep(wait);
    }
    if (attempt === 0 && left() < RESEARCH_MIN_ATTEMPT_MS) return { ok: false, status: 0, error: "muddat tugadi" };
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: accept, "User-Agent": userAgent(), ...(opts.headers ?? {}) },
        signal: combineSignals(opts.signal, Math.min(opts.timeoutMs ?? RESEARCH_TIMEOUT_MS, left())),
      });
      if (res.ok) {
        breaker.success();
        try {
          return await read(res);
        } catch (e) {
          return { ok: false, status: res.status, error: `body: ${e instanceof Error ? e.message : e}` };
        }
      }
      last = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      if (res.status === 429) {
        const after = parseRetryAfter(res.headers?.get?.("retry-after"));
        if (saw429 || attempt >= retries || (after !== undefined && after > QUOTA_RETRY_MAX_MS)) {
          const cooldown = Math.min(QUOTA_COOLDOWN_MAX_MS, Math.max(QUOTA_COOLDOWN_MIN_MS, after ?? QUOTA_COOLDOWN_DEFAULT_MS));
          breaker.trip(cooldown, "429 kvota");
          return last;
        }
        saw429 = true;
        wait = after ?? backoffMs(0, base);
        continue;
      }
      // To'liq jitter'li kutish (audit EXT-13): ~base, ~3·base.
      wait = backoffMs(0, base * 3 ** attempt);
      const retryable = res.status >= 500;
      if (!retryable) return last;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      last = { ok: false, status: 0, error: msg };
      wait = backoffMs(0, base * 3 ** attempt);
      // Timeout — qayta urinilmaydi (byudjet ketgan); tarmoq xatosi — uriniladi.
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return last;
    }
  }
  return last;
}

export async function getJson(url: string, opts: HttpOpts = {}): Promise<HttpJson> {
  return request<{ json: unknown }>(url, "application/json", opts, async (res) => ({ ok: true, status: res.status, json: await res.json() }));
}

/**
 * GET → matn (HTML). lex.uz hujjat sahifasi JSON bermaydi — tasdiq
 * sarlavha/sana/raqamni HTML dan o'qish orqali bo'ladi.
 */
export async function getText(url: string, opts: HttpOpts = {}): Promise<HttpText> {
  return request<{ text: string }>(url, "text/html,application/xhtml+xml", opts, async (res) => ({ ok: true, status: res.status, text: await res.text() }));
}

/** URL so'rov parametrlarini yig'adi; bo'sh qiymatlar tashlanadi. */
export function withParams(base: string, params: Record<string, string | number | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}
