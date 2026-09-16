/**
 * Google Books API (Talaba ishlari 2, AUDIT-19 WP-B) — DARSLIK va
 * MONOGRAFIYA manbalari.
 *
 * Nega kerak: kurs ishi/referat adabiyotlari ro'yxatining yarmidan ko'pi
 * kitob bo'ladi (BuxDU uslubiy ko'rsatmasi: 15–20 manba, asosan darslik
 * va monografiya), OpenAlex esa deyarli faqat jurnal maqolasini biladi.
 * Model o'zi kitob YOZIB BERMAYDI (uydirma ISBN/nashriyot) — bu yerdan
 * topilgan yozuvgina `verified:"googlebooks"` bo'ladi.
 *
 * API: `GET /books/v1/volumes?q=…&maxResults=…&printType=books&langRestrict=…`.
 * Kalit (`GOOGLE_BOOKS_API_KEY`) IXTIYORIY: kalitsiz ham ishlaydi (anonim
 * kvota IP bo'yicha), kalit bilan kuniga 1 000 so'rov. Shuning uchun
 * deploy uchun majburiy emas — `.env.example` da izoh bilan.
 *
 * ISBN: `industryIdentifiers` da ISBN_13 va ISBN_10 bo'lishi mumkin —
 * ISBN_13 USTUN (dedup kaliti bitta bo'lsin; bir kitobning ikki shakli
 * ikki manba bo'lib ro'yxatga tushmasin).
 */
import type { Reference } from "../types";
import { cached, queryKey } from "./cache";
import { getJson, withParams, type HttpOpts } from "./http";
import { normalizeIsbn } from "./isbn";

// Sof yordamchi `isbn.ts` da — forma/klient kodi (`article/input.ts` → `tools.ts`)
// bu faylni tortmasin: `cache.ts` → `lib/server/db.ts` server-only.
export { normalizeIsbn } from "./isbn";

const BASE = "https://www.googleapis.com/books/v1/volumes";
const CACHE_DAYS = 30;
/** Bir so'rovga qaytadigan kitob soni (API chegarasi 40). */
export const BOOKS_MAX_RESULTS = 10;
export const BOOKS_TIMEOUT_MS = 10_000;

export type BooksOpts = HttpOpts & {
  /** `langRestrict` — hujjat tili (kurs ishi o'zbekcha bo'lsa o'zbek darsligi ustun). */
  lang?: "uz" | "ru" | "en";
  /** Berilsa so'rov `isbn:<…>` ga aylanadi (aniq kitob). */
  isbn?: string;
  maxResults?: number;
};

type RawIdentifier = { type?: string | null; identifier?: string | null };

type RawVolume = {
  id?: string | null;
  volumeInfo?: {
    title?: string | null;
    subtitle?: string | null;
    authors?: string[] | null;
    publisher?: string | null;
    publishedDate?: string | null;
    pageCount?: number | null;
    industryIdentifiers?: RawIdentifier[] | null;
    canonicalVolumeLink?: string | null;
    infoLink?: string | null;
  } | null;
};

function apiKey(): string {
  return (process.env.GOOGLE_BOOKS_API_KEY || "").trim();
}

/** ISBN_13 ustun; bo'lmasa ISBN_10; bo'lmasa "". */
export function isbnOf(ids: RawIdentifier[] | null | undefined): string {
  const list = Array.isArray(ids) ? ids : [];
  const pick = (type: string) => normalizeIsbn(list.find((i) => String(i?.type ?? "").toUpperCase() === type)?.identifier);
  return pick("ISBN_13") || pick("ISBN_10") || "";
}

/** «2019-05-02» / «2019» → 2019; noto'g'ri → undefined. */
export function yearOf(publishedDate: unknown): number | undefined {
  const m = String(publishedDate ?? "").match(/^(\d{4})/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return y >= 1400 && y <= 2100 ? y : undefined;
}

/**
 * Bitta volume → `Reference` (`kind:"book"`, `verified:"googlebooks"`).
 * Id yoki sarlavha yo'q — `null` (bunday yozuv iqtibos qilinmaydi).
 */
export function referenceFromVolume(v: RawVolume | null | undefined): Reference | null {
  const id = String(v?.id ?? "").trim();
  const info = v?.volumeInfo ?? {};
  const base = String(info.title ?? "").replace(/\s+/g, " ").trim();
  if (!id || !base) return null;
  const subtitle = String(info.subtitle ?? "").replace(/\s+/g, " ").trim();
  const ref: Reference = {
    id: `gb:${id}`,
    kind: "book",
    title: subtitle ? `${base.replace(/[:\s]+$/, "")}: ${subtitle}` : base,
    authors: (info.authors ?? []).map((a) => String(a ?? "").trim()).filter(Boolean).slice(0, 6),
    verified: "googlebooks",
    cited: false,
  };
  const isbn = isbnOf(info.industryIdentifiers);
  if (isbn) ref.isbn = isbn;
  const year = yearOf(info.publishedDate);
  if (year) ref.year = year;
  const publisher = String(info.publisher ?? "").trim();
  if (publisher) ref.publisher = publisher;
  if (Number.isInteger(info.pageCount) && Number(info.pageCount) > 0) ref.pageCount = Number(info.pageCount);
  const url = String(info.canonicalVolumeLink ?? info.infoLink ?? "").trim();
  if (/^https?:\/\//.test(url)) ref.url = url;
  return ref;
}

function booksUrl(q: string, opts: BooksOpts): string {
  return withParams(BASE, {
    q,
    maxResults: Math.max(1, Math.min(40, opts.maxResults ?? BOOKS_MAX_RESULTS)),
    printType: "books",
    langRestrict: opts.lang || undefined,
    key: apiKey() || undefined,
  });
}

/**
 * Kitob qidiruvi. XATO TASHLAMAYDI — bo'sh ro'yxat (manba topilmasligi
 * oddiy holat: o'zbek darsligi Google Books da kam). Kesh `gb:` 30 kun.
 */
export async function searchBooks(query: string, opts: BooksOpts = {}): Promise<Reference[]> {
  const isbn = normalizeIsbn(opts.isbn);
  const q = isbn ? `isbn:${isbn}` : query.replace(/\s+/g, " ").trim();
  if (!q) return [];
  const url = booksUrl(q, opts);
  const key = queryKey("gb", `${q}|${opts.lang ?? ""}|${opts.maxResults ?? BOOKS_MAX_RESULTS}`);
  const raw = await cached(key, CACHE_DAYS, async () => {
    const res = await getJson(url, { ...opts, timeoutMs: opts.timeoutMs ?? BOOKS_TIMEOUT_MS });
    if (!res.ok) {
      console.warn(`[googlebooks] qidiruv «${q.slice(0, 60)}»: ${res.error}`);
      return null;
    }
    const items = (res.json as { items?: RawVolume[] } | null)?.items;
    return Array.isArray(items) ? items : [];
  });
  if (!raw) return [];
  return raw.map(referenceFromVolume).filter((r): r is Reference => Boolean(r));
}

/**
 * Foydalanuvchi bergan ISBN → TASDIQLANGAN kitob yozuvi (`resolveUserRefs`).
 * Topilmasa `null` — chaqiruvchi foydalanuvchi matnini o'zi saqlaydi
 * (`verified:"user"`), lekin biz uni «tasdiqlangan» deb ko'rsatmaymiz.
 */
export async function verifyIsbn(isbn: string, opts: HttpOpts = {}): Promise<Reference | null> {
  const norm = normalizeIsbn(isbn);
  if (!norm) return null;
  const found = await searchBooks("", { ...opts, isbn: norm, maxResults: 1 });
  const ref = found[0];
  if (!ref) return null;
  // Qidiruv ISBN_10 bilan bo'lsa ham yozuvda ISBN_13 qoladi; ISBN umuman
  // kelmagan bo'lsa foydalanuvchi berganini yozamiz (dedup kaliti kerak).
  return ref.isbn ? ref : { ...ref, isbn: norm };
}
