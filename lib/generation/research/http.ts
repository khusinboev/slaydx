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
 */

export type HttpOpts = {
  signal?: AbortSignal;
  timeoutMs?: number;
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
  let last: { ok: false; status: number; error: string } = { ok: false, status: 0, error: "no attempt" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) return { ok: false, status: 0, error: "aborted" };
    if (attempt > 0) await sleep(base * 3 ** (attempt - 1));
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: accept, "User-Agent": userAgent(), ...(opts.headers ?? {}) },
        signal: combineSignals(opts.signal, opts.timeoutMs ?? RESEARCH_TIMEOUT_MS),
      });
      if (res.ok) {
        try {
          return await read(res);
        } catch (e) {
          return { ok: false, status: res.status, error: `body: ${e instanceof Error ? e.message : e}` };
        }
      }
      last = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) return last;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      last = { ok: false, status: 0, error: msg };
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
