/**
 * Crossref — DOI TASDIQLASH va erkin matnli manbani topish (Maqola 2).
 *
 * Ikki vazifa:
 *   • `verifyDoi(doi)` — foydalanuvchi bergan DOI haqiqatan mavjudmi va
 *     unga qaysi yozuv tegishli (`/works/{doi}`); `verified: "crossref"`.
 *   • `searchBibliographic(text)` — «Karimov A. Ta'limda AI. — Toshkent:
 *     Fan, 2022.» kabi qator bo'yicha `query.bibliographic` qidiruvi;
 *     TOP-1 haqiqatan shu manba bo'lsagina qabul qilinadi (sarlavha
 *     so'zlari yoki muallif+yil mosligi) — Crossref hamma so'rovga
 *     «eng yaqin» narsani qaytaradi, u boshqa maqola bo'lishi mumkin.
 *
 * `mailto` — Crossref «polite pool» (tezroq, barqarorroq).
 */
import type { Reference } from "../article/types";
import { cached, queryKey } from "./cache";
import { getJson, withParams, type HttpOpts } from "./http";

const BASE = "https://api.crossref.org/works";
const CACHE_DAYS = 30;

type CrossrefItem = {
  DOI?: string;
  title?: string[] | null;
  author?: { given?: string; family?: string; name?: string }[] | null;
  issued?: { "date-parts"?: (number | null)[][] | null } | null;
  "published-print"?: { "date-parts"?: (number | null)[][] | null } | null;
  "published-online"?: { "date-parts"?: (number | null)[][] | null } | null;
  "container-title"?: string[] | null;
  publisher?: string | null;
  page?: string | null;
  URL?: string | null;
  score?: number | null;
};

function mailto(): string {
  return (process.env.CROSSREF_MAILTO || process.env.OPENALEX_MAILTO || "").trim();
}

export function normalizeDoi(raw: unknown): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi\s*:?\s*/i, "")
    .replace(/[.,;)\]]+$/, "");
  return /^10\.\d{4,9}\/\S+$/i.test(t) ? t : "";
}

function yearOf(item: CrossrefItem): number | undefined {
  for (const k of ["issued", "published-print", "published-online"] as const) {
    const y = item[k]?.["date-parts"]?.[0]?.[0];
    if (Number.isInteger(y) && Number(y) > 1500) return Number(y);
  }
  return undefined;
}

/** Crossref yozuvi → `Reference` (`verified: "crossref"`). */
export function referenceFromCrossref(item: CrossrefItem | null | undefined, id?: string): Reference | null {
  if (!item) return null;
  const doi = normalizeDoi(item.DOI);
  const title = String(item.title?.[0] ?? "").replace(/\s+/g, " ").trim();
  if (!doi || !title) return null;
  const authors = (item.author ?? [])
    .map((a) => (a.family ? `${a.family}${a.given ? ` ${a.given}` : ""}` : String(a.name ?? "")).trim())
    .filter(Boolean)
    .slice(0, 6);
  const ref: Reference = { id: id ?? `doi:${doi}`, doi, title, authors, verified: "crossref", cited: false, url: `https://doi.org/${doi}` };
  const year = yearOf(item);
  if (year) ref.year = year;
  const venue = String(item["container-title"]?.[0] ?? "").trim();
  if (venue) ref.venue = venue;
  const publisher = String(item.publisher ?? "").trim();
  if (publisher && !venue) ref.publisher = publisher;
  const pages = String(item.page ?? "").trim();
  if (pages) ref.pages = pages;
  return ref;
}

/** `/works/{doi}` — mavjud bo'lsa yozuv, 404 → `null`. */
export async function verifyDoi(rawDoi: string, opts: HttpOpts = {}): Promise<Reference | null> {
  const doi = normalizeDoi(rawDoi);
  if (!doi) return null;
  const url = withParams(`${BASE}/${encodeURIComponent(doi)}`, { mailto: mailto() || undefined });
  const item = await cached(`crossref:${doi.toLowerCase()}`, CACHE_DAYS, async () => {
    const res = await getJson(url, opts);
    if (!res.ok) {
      if (res.status !== 404) console.warn(`[crossref] ${doi}: ${res.error}`);
      return null;
    }
    return (res.json as { message?: CrossrefItem } | null)?.message ?? null;
  });
  return referenceFromCrossref(item);
}

const STOP = new Set(["the", "and", "of", "in", "for", "on", "to", "a", "an", "va", "bilan", "uchun", "и", "в", "на", "для", "с"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/**
 * Topilgan yozuv foydalanuvchi qatoriga MOSMI.
 *
 * Ikki yo'l: sarlavha so'zlarining ≥60% i qatorda bor; yoki birinchi
 * muallif familiyasi va yil ikkalasi qatorda bor. Ikkalasi ham bo'lmasa
 * — bu boshqa manba, `user` deb qoldiriladi (foydalanuvchi bergan
 * matn saqlanadi, tasdiq belgisi berilmaydi).
 */
export function bibliographicMatch(raw: string, ref: Reference): boolean {
  const hay = raw.toLowerCase();
  const tt = tokens(ref.title);
  if (tt.length) {
    const hit = tt.filter((w) => hay.includes(w)).length;
    if (hit / tt.length >= 0.6 && hit >= 2) return true;
  }
  const family = ref.authors[0]?.split(/[\s,]+/)[0]?.toLowerCase() ?? "";
  const yearOk = ref.year ? hay.includes(String(ref.year)) : false;
  return Boolean(family && family.length > 2 && hay.includes(family) && yearOk);
}

/**
 * Erkin matnli manba → Crossref TOP-1, mos bo'lsa `verified:"crossref"`,
 * aks holda `null` (chaqiruvchi `user` sifatida saqlaydi).
 */
export async function searchBibliographic(text: string, opts: HttpOpts = {}): Promise<Reference | null> {
  const q = text.replace(/\s+/g, " ").trim();
  if (q.length < 12) return null;
  const url = withParams(BASE, { "query.bibliographic": q, rows: 3, select: "DOI,title,author,issued,container-title,publisher,page,URL,score", mailto: mailto() || undefined });
  const items = await cached(queryKey("q:crossref", q), CACHE_DAYS, async () => {
    const res = await getJson(url, opts);
    if (!res.ok) {
      console.warn(`[crossref] bibliografik «${q.slice(0, 60)}»: ${res.error}`);
      return null;
    }
    const list = (res.json as { message?: { items?: CrossrefItem[] } } | null)?.message?.items;
    return Array.isArray(list) ? list : null;
  });
  if (!items?.length) return null;
  const top = referenceFromCrossref(items[0]);
  if (!top) return null;
  return bibliographicMatch(q, top) ? top : null;
}
