/**
 * TASHQI URL ni xavfsiz yuklash (audit EXT-15).
 *
 * Qachon kerak: URL BIZNING doimiy sozlamamizdan emas, PROVAYDER
 * javobidan kelganda — stock rasm havolasi (Pexels/Pixabay/fal JSON),
 * Aisha TTS audio havolasi, Gemini grounding `uri`si, model taklif
 * qilgan lex.uz sahifasi. Buzilgan yoki yolg'on provayder javobi (yoki
 * uning redirecti) worker'ni `http://169.254.169.254/…` (bulut metadata)
 * yoki ichki xizmatlarga so'rov yuborishga majburlay olmasligi kerak.
 *
 * Qoidalar:
 *  - faqat `https:`;
 *  - xost DNS orqali ochiladi va HAR manzil ommaviy bo'lishi shart
 *    (loopback, xususiy, link-local, CGNAT, multicast, IPv6 ULA/link-local,
 *    IPv4-mapped IPv6 — rad);
 *  - redirect QO'LDA (`redirect: "manual"`): har qadam yuqoridagi
 *    tekshiruvdan qaytadan o'tadi, ko'pi bilan `maxRedirects` (3) ta;
 *  - javob tanasi `maxBytes` dan oshsa o'qish to'xtatiladi;
 *  - butun zanjirga bitta timeout.
 *
 * Qolgan xavf (ataylab qabul qilingan): DNS tekshiruvi va `fetch` ning
 * o'z ulanishi orasida xost boshqa IP ga «qayta bog'lanishi» mumkin
 * (DNS rebinding). Buni yopish uchun ulanishni IP ga mahkamlash kerak
 * (undici dispatcher) — manbalar provayder javobidan keladi, foydalanuvchidan
 * emas, shuning uchun bu qatlam yetarli.
 *
 * Qaytadi: o'qilgan (chegaralangan) tana bilan HAQIQIY `Response`, yoki
 * qoida buzilsa `UnsafeUrlError` OTADI (tarmoq xatosi kabi — chaqiruvchilar
 * `fetch` xatosini allaqachon ushlaydi).
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type LookupFn = (host: string) => Promise<string[]>;

export type SafeFetchOpts = {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  /** Butun zanjir (barcha redirectlar + tana) uchun (standart 20 s). */
  timeoutMs?: number;
  /** Tana chegarasi (standart 12 MB). */
  maxBytes?: number;
  /** Redirect qadamlari chegarasi (standart 3). `0` — redirect kuzatilmaydi, 3xx javob o'zi qaytadi. */
  maxRedirects?: number;
  signal?: AbortSignal;
  /** Test seam — standart `globalThis.fetch` (chaqiruv paytida o'qiladi). */
  fetchImpl?: typeof fetch;
  /** Test seam — standart `setSafeFetchLookup` bilan o'rnatilgan yoki DNS. */
  lookup?: LookupFn;
};

export const SAFE_FETCH_TIMEOUT_MS = 20_000;
export const SAFE_FETCH_MAX_BYTES = 12 * 1024 * 1024;
export const SAFE_FETCH_MAX_REDIRECTS = 3;

export class UnsafeUrlError extends Error {
  readonly reason: "scheme" | "host" | "redirect" | "size";
  constructor(reason: UnsafeUrlError["reason"], message: string) {
    super(`[safe-fetch] ${message}`);
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }
}

const systemLookup: LookupFn = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

let defaultLookup: LookupFn = systemLookup;

/**
 * Standart DNS ochuvchini almashtiradi (`null` — tizim DNS iga qaytadi).
 * Faqat testlar uchun: `fetch` stub qilingan testda haqiqiy DNS so'rovi
 * ketmasin (germetik).
 */
export function setSafeFetchLookup(fn: LookupFn | null): void {
  defaultLookup = fn ?? systemLookup;
}

function v4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function privateV4(ip: string): boolean {
  const p = v4Parts(ip);
  if (!p) return true;
  const [a, b] = p;
  return (
    a === 0 || // «bu tarmoq»
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, bulut metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    a >= 224 // multicast + zaxira + broadcast
  );
}

function privateV6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  // IPv4-mapped / -compatible (`::ffff:10.0.0.1`) — ichidagi IPv4 bo'yicha.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return privateV4(mapped[1]);
  if (/^::ffff:/.test(s)) return true; // hex ko'rinishidagi mapped — ishonmaymiz
  const first = parseInt(s.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;
  return (
    (first & 0xfe00) === 0xfc00 || // ULA fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    (first === 0x2001 && parseInt(s.split(":")[1] || "0", 16) === 0x0db8) // hujjat namunasi
  );
}

/** IP ommaviy internetga tegishli emasmi (loopback/xususiy/link-local/…). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip.replace(/^\[|\]$/g, ""));
  if (v === 4) return privateV4(ip);
  if (v === 6) return privateV6(ip);
  return true;
}

/** URL ni tekshiradi: https + ommaviy xost. Xato bo'lsa `UnsafeUrlError`. */
export async function assertPublicHttpsUrl(raw: string, lookup: LookupFn = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("scheme", "URL emas");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("scheme", `faqat https (${url.protocol})`);
  if (url.username || url.password) throw new UnsafeUrlError("host", "URL da login/parol");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) throw new UnsafeUrlError("host", `ichki xost: ${host}`);
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("host", `ichki manzil: ${host}`);
    return url;
  }
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch (e) {
    throw new UnsafeUrlError("host", `DNS ochilmadi: ${host} (${e instanceof Error ? e.message : "xato"})`);
  }
  if (!addrs.length) throw new UnsafeUrlError("host", `DNS bo'sh: ${host}`);
  const bad = addrs.find(isPrivateAddress);
  if (bad) throw new UnsafeUrlError("host", `${host} ichki manzilga ochiladi (${bad})`);
  return url;
}

function combine(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const t = AbortSignal.timeout(Math.max(1, timeoutMs));
  return signal ? AbortSignal.any([signal, t]) : t;
}

/** Chaqiruvchilar o'qiydigan sarlavhalar — faqat `get` i bor javob (test stub) uchun. */
const KNOWN_HEADERS = ["location", "content-type", "content-length", "retry-after"];

function copyHeaders(h: unknown): Headers {
  const out = new Headers();
  if (h && typeof (h as Headers).forEach === "function") {
    (h as Headers).forEach((v, k) => out.set(k, v));
  } else if (h && typeof (h as Headers).get === "function") {
    for (const k of KNOWN_HEADERS) {
      const v = (h as Headers).get(k);
      if (typeof v === "string") out.set(k, v);
    }
  }
  return out;
}

/** Tanani `maxBytes` gacha o'qiydi; oshsa `UnsafeUrlError("size")`. */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers?.get?.("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new UnsafeUrlError("size", `javob ${declared} bayt > ${maxBytes}`);
  }
  if (!res.body || typeof res.body.getReader !== "function") {
    // Oqimsiz javob (test stub'lari) — butun tana, keyin chegara.
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new UnsafeUrlError("size", `javob ${buf.byteLength} bayt > ${maxBytes}`);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UnsafeUrlError("size", `javob ${maxBytes} baytdan oshdi`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * Provayder bergan URL ni yuklaydi (yuqoridagi qoidalar bilan).
 * Tarmoq xatosi/timeout — `fetch` kabi OTILADI; qoida buzilishi — `UnsafeUrlError`.
 */
export async function safeFetchUrl(raw: string, opts: SafeFetchOpts = {}): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const maxRedirects = opts.maxRedirects ?? SAFE_FETCH_MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  const signal = combine(opts.signal, opts.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS);
  let url = await assertPublicHttpsUrl(raw, lookup);
  for (let hop = 0; ; hop++) {
    const res = await fetchImpl(url.toString(), {
      method: opts.method ?? "GET",
      headers: opts.headers,
      redirect: "manual",
      signal,
    });
    const status = typeof res.status === "number" && res.status > 0 ? res.status : res.ok ? 200 : 502;
    if (REDIRECT.has(status)) {
      if (maxRedirects === 0) {
        await res.body?.cancel().catch(() => {});
        return new Response(null, { status, headers: copyHeaders(res.headers) });
      }
      const loc = res.headers?.get?.("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new UnsafeUrlError("redirect", `${status} Location siz`);
      if (hop + 1 > maxRedirects) throw new UnsafeUrlError("redirect", `redirect ${maxRedirects} tadan ko'p`);
      // Har qadam QAYTADAN tekshiriladi: https → http yoki ichki xostga o'tish rad.
      url = await assertPublicHttpsUrl(new URL(loc, url).toString(), lookup);
      continue;
    }
    const body = opts.method === "HEAD" ? null : await readCapped(res, maxBytes);
    // 1xx/204/304 tanasiz bo'lishi shart — `Response` konstruktori aks holda otadi.
    const bodyless = status === 204 || status === 205 || status === 304 || status < 200;
    return new Response(bodyless ? null : body, { status: status < 200 || status > 599 ? 502 : status, headers: copyHeaders(res.headers) });
  }
}
